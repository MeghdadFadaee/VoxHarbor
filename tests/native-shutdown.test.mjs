import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnProtocol } from '../src/platform/native-protocol.mjs';

for (const event of [{ type: 'status', status: 'disconnected' }, { type: 'error', code: 'connection_failed' }]) {
test(`terminal native ${event.type} delivers stdin EOF so the child and lease can finish`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voxharbor-shutdown-'));
  const executable = join(directory, 'protocol');
  // Reproduce a reader still waiting on stdin after its terminal status.
  await writeFile(executable, `#!/bin/sh\nread -r request\nprintf '%s\\n' '${JSON.stringify(event)}'\ncat >/dev/null\n`, { mode: 0o700 });
  let timeout;
  let native;
  try {
    const events = [];
    native = spawnProtocol({ protocolBinary: executable }, { op: 'connect', seconds: 20 }, event => events.push(event));
    await Promise.race([native.done, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Terminal child did not exit promptly')), 2000); })]);
    assert.deepEqual(events, [event]);
  } finally {
    clearTimeout(timeout); native?.stop(); await rm(directory, { recursive: true, force: true });
  }
});
}
