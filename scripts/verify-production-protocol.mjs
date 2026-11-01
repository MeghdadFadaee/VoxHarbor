import { hiddenPrompt } from './hidden-prompt.mjs';
import { writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

// Explicit owner login; never read browser cookies or save passwords/session tokens.
const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.origin !== process.argv[2]) throw new Error('Pass the exact production HTTPS origin');
const seconds = Number(process.argv[3] || 60);
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 280) throw new Error('Duration must be 5..280 seconds');
if (!process.stdin.isTTY) throw new Error('An interactive hidden password prompt is required');
let password = await hiddenPrompt('Owner password');
let cookie;
let csrf;
async function request(path, body) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} on ${path}`);
  if (path === '/api/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.json();
}
const result = { testedAt: new Date().toISOString(), origin: origin.origin, environment: 'actual-vercel-production',
  microphoneEnabled: false, listening: false, events: [], snapshots: 0, maxChannels: 0, maxParticipants: 0, incomingVoicePackets: 0 };
const record = event => result.events.push({ at: new Date().toISOString(), ...event });
try {
  ({ csrf } = await request('/api/login', { password })); password = '';
  result.runtime = (await request('/api/session')).runtime;
  result.capabilities = await request('/api/protocol');
  result.identityBefore = (await request('/api/identity')).identity;
  if (!result.identityBefore) throw new Error('Create/import the production identity through the owner UI first');
  const settings = await request('/api/preferences');
  if (!settings.connection) throw new Error('Save a connection through the owner UI before verification');
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL('/api/ts3', origin).href.replace('https:', 'wss:'), {
      origin: origin.origin, headers: { Cookie: cookie }, handshakeTimeout: 15000,
    });
    const deadline = setTimeout(() => { record({ type: 'test_stop' }); socket.close(1000, 'Verification window finished'); }, seconds * 1000);
    const watchdog = setTimeout(() => { socket.terminate(); reject(new Error('Protocol transport did not close')); }, (seconds + 10) * 1000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'connect', csrf, connectionId: settings.connection.id })));
    socket.on('message', (data, binary) => {
      if (binary) { result.incomingVoicePackets++; return; }
      const event = JSON.parse(data.toString());
      if (event.type === 'ts3_state') {
        result.snapshots++;
        result.maxChannels = Math.max(result.maxChannels, event.channels.length);
        result.maxParticipants = Math.max(result.maxParticipants, event.participants.length);
        result.lastSequence = event.sequence;
      } else if (event.type === 'ts3_status') record({ type: event.type, status: event.status });
      else if (event.type === 'ts3_error') record({ type: event.type, code: event.code, inconclusive: event.inconclusive === true });
      else if (event.type === 'ts3_audio_status') record({ type: event.type, canSend: event.canSend, canReceive: event.canReceive });
      else if (event.type === 'ts3_identity') result.connectedIdentity = { uid: event.uid, level: event.level };
    });
    socket.on('error', () => record({ type: 'transport_error' }));
    socket.on('close', code => {
      clearTimeout(deadline); clearTimeout(watchdog); record({ type: 'transport_close', code }); resolve();
    });
  });
  result.identityAfter = (await request('/api/identity')).identity;
  result.identityPreserved = result.identityAfter?.uid === result.identityBefore.uid;
  result.connected = result.events.some(event => event.status === 'connected');
} catch (error) {
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  if (cookie && csrf) await request('/api/logout', {}).catch(() => {});
}
result.passed = Boolean(result.connected && result.identityPreserved && !result.failure && !result.events.some(event => ['ts3_error', 'transport_error'].includes(event.type)));
if (!result.passed) process.exitCode = 1;
const json = JSON.stringify(result, null, 2) + '\n';
if (process.argv[4]) await writeFile(process.argv[4], json);
console.log(json);
