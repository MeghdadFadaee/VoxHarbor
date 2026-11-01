import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import { hiddenPrompt } from './hidden-prompt.mjs';
import { ProtocolConnection } from '../public/protocol-connection.mjs';

const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.origin !== process.argv[2]) throw new Error('Pass an exact production HTTPS origin');
const seconds = Number(process.argv[3] || 315);
if (!Number.isInteger(seconds) || seconds < 300 || seconds > 700) throw new Error('Recovery verification needs 300..700 seconds');
let password = await hiddenPrompt('Production owner password');
let cookie; let csrf; let connection; let interrupt; let end;
const report = { testedAt: new Date().toISOString(), origin: origin.origin, microphoneEnabled: false, listening: false,
  phases: [], transports: [], protocolErrors: [], incomingVoice: 0, outgoingVoice: 0, capObserved: false, abruptInterruption: false };
async function api(path, input, signal) {
  const response = await fetch(new URL(path, origin), { redirect: 'error', signal: signal || AbortSignal.timeout(15000),
    method: input === undefined ? 'GET' : 'POST',
    headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} on ${path}`), { status: response.status });
  if (path === '/api/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.json();
}
try {
  ({ csrf } = await api('/api/login', { password })); password = '';
  report.identityBefore = (await api('/api/identity')).identity;
  if (!report.identityBefore) throw new Error('An existing production identity is required');
  let transport;
  connection = new ProtocolConnection({
    url: origin.origin.replace('https:', 'wss:') + '/api/ts3',
    session: async ({ signal }) => { const session = await api('/api/session', undefined, signal); csrf = session.csrf; return session; },
    socket: url => {
      const socket = new WebSocket(url, { origin: origin.origin, headers: { Cookie: cookie }, handshakeTimeout: 15000 });
      transport = { openedAt: new Date().toISOString(), snapshots: 0, maxChannels: 0, maxParticipants: 0 };
      const entry = transport;
      report.transports.push(transport);
      const send = socket.send.bind(socket); socket.send = data => { if (typeof data !== 'string') report.outgoingVoice++; return send(data); };
      socket.on('close', code => { entry.closedAt = new Date().toISOString(); entry.closeCode = code; });
      return socket;
    },
    phase: phase => {
      report.phases.push({ at: new Date().toISOString(), ...phase });
      console.log(`Recovery: ${phase.state}${phase.delay ? ` (${Math.ceil(phase.delay / 1000)}s)` : ''}`);
    },
    expired: () => { report.authExpired = true; },
    event: event => {
      if (event instanceof ArrayBuffer) { report.incomingVoice++; return; }
      if (event.type === 'runtime') report.runtime = { node: event.node, platform: event.platform, arch: event.arch, region: event.region, deployment: event.deployment };
      else if (event.type === 'ts3_status' && event.status === 'session_limit') report.capObserved = true;
      else if (event.type === 'ts3_error') report.protocolErrors.push({ at: new Date().toISOString(), code: event.code });
      else if (event.type === 'ts3_audio_status' && (event.canSend || event.canReceive)) report.unexpectedAudioPermission = true;
      else if (event.type === 'ts3_state') {
        transport.snapshots++; transport.maxChannels = Math.max(transport.maxChannels, event.channels.length); transport.maxParticipants = Math.max(transport.maxParticipants, event.participants.length);
        if (report.capObserved && !report.abruptInterruption && !interrupt) interrupt = setTimeout(() => {
          if (!connection.connected) return;
          report.abruptInterruption = true; console.log('Interrupting this verification socket only.'); connection.socket.terminate();
        }, 30000);
      }
    },
  });
  const settings = await api('/api/preferences');
  if (!settings.connection) throw new Error('Save a connection through the owner UI before verification');
  connection.start({ connectionId: settings.connection.id });
  await new Promise(resolve => { end = setTimeout(resolve, seconds * 1000); });
  report.recovered = connection.connected; connection.stop();
  report.identityAfter = (await api('/api/identity')).identity;
  report.identityPreserved = report.identityBefore.uid === report.identityAfter?.uid;
  report.passed = report.recovered && report.capObserved && report.abruptInterruption && report.transports.filter(item => item.snapshots > 0).length >= 3 && report.identityPreserved && !report.authExpired && !report.incomingVoice && !report.outgoingVoice && !report.unexpectedAudioPermission;
} catch (error) { report.failure = error.message; report.passed = false; }
finally {
  clearTimeout(interrupt); clearTimeout(end); connection?.stop(); password = '';
  if (cookie && csrf) await api('/api/logout', {}).catch(() => {});
}
if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
