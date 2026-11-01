import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

export function protocolBinary(config) {
  return config.protocolBinary || fileURLToPath(new URL('../../native/bin/voxharbor-protocol', import.meta.url));
}
export async function nativeAvailable(config) {
  try { await access(protocolBinary(config), constants.X_OK); return true; } catch { return false; }
}

export function spawnProtocol(config, request, onEvent) {
  const child = spawn(protocolBinary(config), [], {
    stdio: ['pipe', 'pipe', 'ignore'],
    // Never inherit deployment secrets into the protocol implementation.
    env: { PATH: '/usr/bin:/bin', RUST_BACKTRACE: '0' },
    windowsHide: true,
  });
  child.stdin.on('error', () => {});
  let failed;
  let stopTimer;
  const watchdog = setTimeout(() => child.kill('SIGKILL'), ((request.seconds || 20) + 5) * 1000);
  const exited = new Promise(resolve => {
    child.once('error', () => { failed = new Error('Native protocol executable unavailable'); resolve(-1); });
    child.once('close', code => resolve(code));
  });
  const done = (async () => {
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    try {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      for await (const chunk of child.stdout) {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) throw new Error('Native protocol output capacity exceeded');
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line) {
            const event = JSON.parse(line);
            await onEvent(event);
            // Tokio's stdin reader can remain blocked after the connection ends.
            // Deliver EOF so runtime shutdown completes and the session lease releases.
            const terminal = event.type === 'error' || (event.type === 'status' && event.status === 'disconnected');
            if (terminal && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
          }
        }
      }
      const code = await exited;
      if (failed || code !== 0 || buffer.trim()) throw new Error('Native protocol operation failed');
    } catch (error) {
      child.kill('SIGKILL');
      throw new Error(error.message === 'Native protocol executable unavailable' ? error.message : 'Native protocol operation failed');
    } finally { clearTimeout(watchdog); clearTimeout(stopTimer); }
  })();
  return {
    done,
    send(command) {
      if (child.exitCode !== null || child.stdin.destroyed || child.stdin.writableEnded || stopTimer) return false;
      // Drop voice before it accumulates in the pipe. Never replay stale microphone audio.
      if (child.stdin.writableLength > 8192) return false;
      child.stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    },
    stop() {
      if (child.exitCode !== null || stopTimer) return;
      child.stdin.end('{"op":"disconnect"}\n');
      stopTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    },
  };
}

export async function identityOperation(config, request) {
  let result;
  const native = spawnProtocol(config, request, event => {
    if (['identity_internal', 'identity_metadata', 'export_internal'].includes(event.type)) result = event;
    else if (event.type === 'error') throw new Error('Identity operation failed');
  });
  await native.done;
  if (!result) throw new Error('Native identity response missing');
  return result;
}
