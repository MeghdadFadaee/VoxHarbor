/** @typedef {import('../src/protocol/types').ProtocolEvent} ProtocolEvent */
import { VoiceAudio } from './voice.mjs';
import { AudioRecovery } from './audio-recovery.mjs';
import { ProtocolConnection } from './protocol-connection.mjs';
const $ = id => document.getElementById(id);
let csrf;
let transport;
let capabilities;
let protocolLoadGeneration = 0;
let identity;
let connectionRequested = false;
let connectionGeneration = 0;
let connected = false;
let audio;
const audioRecovery = new AudioRecovery();
let latestState;
let speaking = new Set();
const volumes = new Map();
export function getParticipantVolume(id) { return volumes.get(id) ?? 1; }
export function setParticipantVolume(id, value) {
  if (!Number.isInteger(id) || !Number.isFinite(value)) return;
  const volume = Math.max(0, Math.min(2, value)); volumes.set(id, volume); audio?.volume(id, volume);
  window.dispatchEvent(new CustomEvent('voxharbor-volume', { detail: { id, volume } }));
}
const pendingCommands = new Map();
let nextCommandId = 1;
export function clientCommand(command) {
  if (!connected) return Promise.reject(new Error('Connect to the server first.'));
  if (pendingCommands.size >= 16) return Promise.reject(new Error('Wait for the current actions to finish.'));
  const requestId = nextCommandId++; if (nextCommandId > 0xffffffff) nextCommandId = 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingCommands.delete(requestId); reject(new Error('The server did not confirm this action. Check the current state before trying again.')); }, 16000);
    pendingCommands.set(requestId, { resolve, reject, timer, command });
    if (!transport.send({ type: 'command', requestId, command })) { clearTimeout(timer); pendingCommands.delete(requestId); reject(new Error('The connection ended before the action was sent.')); }
  });
}
export async function joinChannel(channelId, password = '') {
  await clientCommand({ type: 'join_channel', channelId, ...(password ? { password } : {}) });
  stopAudio();
  $('ts3-channel').value = String(channelId);
}
function cancelCommands() {
  for (const pending of pendingCommands.values()) { clearTimeout(pending.timer); pending.reject(new Error('The connection ended. The action was not retried.')); }
  pendingCommands.clear();
}
function sendCommand(command) {
  transport?.send(command);
}
function audioButtons() {
  $('voice-listen').disabled = !connected;
  $('voice-mic').disabled = !connected || !audio || audio.outputMuted;
  $('voice-listen').textContent = audio && !audio.outputMuted ? 'Stop listening' : 'Enable listening';
  $('voice-mic').textContent = audio && !audio.muted ? 'Mute microphone' : 'Enable microphone';
  $('voice-ptt').disabled = !audio || audio.muted || !audio.canSend || audio.mode !== 'ptt';
  $('voice-ptt').hidden = $('voice-mode').value !== 'ptt' || !audio || audio.muted;
  $('voice-transmission').hidden = !audio || audio.muted;
  const microphoneOn = Boolean(audio && !audio.muted); const listening = Boolean(audio && !audio.outputMuted);
  $('voice-mic').setAttribute('aria-pressed', String(microphoneOn)); $('voice-listen').setAttribute('aria-pressed', String(listening));
  $('voice-heading').textContent = microphoneOn ? $('voice-transmission').classList.contains('transmitting') ? 'On air.' : 'Ready to talk.' : 'Off air.';
  $('voice-description').textContent = microphoneOn ? 'Your microphone is ready. You control when you transmit.' : 'Your microphone is off. You choose when to join in.';
  $('room-listening-status').textContent = listening ? 'Listening on' : 'Listening off';
  $('ribbon-mute').hidden = !microphoneOn;
  $('ribbon-audio').textContent = `${listening ? 'Listening on' : 'Listening off'} / ${microphoneOn ? 'Microphone enabled' : 'Microphone off'}`;
}
function setupAudio() {
  if (audio) return;
  audio = new VoiceAudio(sendCommand, frame => transport?.voice(frame) ?? false);
  for (const [clientId, volume] of volumes) audio.volume(clientId, volume);
  audio.addEventListener('error', event => { stopAudio(); $('voice-status').textContent = event.detail; audioButtons(); });
  audio.addEventListener('transmitting', event => {
    $('voice-transmission').textContent = event.detail.active ? '● Transmitting' : 'Microphone idle';
    $('ribbon-audio').textContent = event.detail.active ? 'On air · Microphone transmitting' : audio && !audio.muted ? 'Microphone enabled' : 'Microphone off';
    $('voice-transmission').classList.toggle('transmitting', event.detail.active); $('voice-heading').textContent = event.detail.active ? 'On air.' : audio && !audio.muted ? 'Ready to talk.' : 'Off air.';
  });
  audio.addEventListener('speaking', event => {
    speaking = new Set(event.detail.ids);
    window.dispatchEvent(new CustomEvent('voxharbor-speaking', { detail: [...speaking] }));
  });
  audio.addEventListener('stats', event => {
    const { lost, late, overflow, rejected } = event.detail;
    $('voice-quality').textContent = `Audio packets: ${lost} missing · ${late} late · ${overflow} queue resets · ${rejected} rejected`;
  });
  applyAudioSettings();
  updateCodec();
}
function updateCodec() {
  const own = latestState?.participants.find(client => client.id === latestState.ownClientId);
  const channel = latestState?.channels.find(channel => channel.id === own?.channelId);
  if (channel) audio?.channel(channel.codec);
}
function stopAudio({ recovery = false } = {}) {
  if (!recovery) audioRecovery.clear();
  audio?.stop(); audio = undefined; speaking.clear(); if (!recovery) { const ids = [...volumes.keys()]; volumes.clear(); for (const id of ids) window.dispatchEvent(new CustomEvent('voxharbor-volume', { detail: { id, volume: 1 } })); }
  window.dispatchEvent(new CustomEvent('voxharbor-speaking', { detail: [] }));
  $('voice-status').textContent = recovery && audioRecovery.pending ? 'Connection interrupted. Your audio recovery choices will apply after reconnect.' : 'Listening and microphone are off.'; $('voice-quality').textContent = '';
  $('voice-transmission').textContent = 'Microphone off';
  $('voice-transmission').classList.remove('transmitting');
  audioButtons();
}
const errorMessages = {
  native_unavailable: 'The native protocol executable is not available in this deployment.',
  identity_required: 'Create or import an identity before connecting.',
  another_session_is_active: 'Another session for your account is active. Disconnect it first, or wait for its lease to expire.',
  connection_rate_limit: 'Connection limit reached. Wait one minute before trying again.',
  identity_storage_or_destination_error: 'Identity storage or destination validation failed. Check the encryption key, Redis and public server address.',
  handshake_timeout: 'The server handshake timed out. The result is inconclusive; check the voice port, firewall and server availability.',
  connection_failed: 'The full-client protocol connection failed. Check the voice port, server password and server availability.',
  server_rejected_connection: 'The server rejected the connection. Check its password, version and identity requirements.',
  server_permission_or_command_error: 'The server denied a command. Server permissions still apply.',
  session_lease_lost: 'Session ownership could not be renewed. The protocol connection was stopped.',
  packet_receive_window_exceeded: 'The incoming packet sequence exceeded the protocol receive window. The connection was stopped.',
  connection_required: 'Save your connection settings before connecting.',
  connection_settings_changed: 'Connection settings changed in another session. Reload and connect again.',
  connection_settings_not_saved: 'The server action succeeded, but its connection settings could not be saved. Save them before reconnecting.',
  packet_authentication_failed: 'A server packet failed authentication. The connection was stopped.',
};
async function request(path, input) {
  const response = await fetch(path, { signal: AbortSignal.timeout(15000), method: input === undefined ? 'GET' : 'POST',
    ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(input) }) });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('voxharbor-owner-expired'));
    const data = await response.json();
    throw new Error(data.error || 'Protocol operation failed');
  }
  return response;
}
function buttons() {
  const ready = capabilities?.nativeAvailable && capabilities?.identityEncryptionConfigured;
  $('identity-create').disabled = !ready || Boolean(identity);
  $('identity-import').disabled = !ready || Boolean(identity);
  $('identity-export').disabled = !ready || !identity;
  $('ts3-connect').disabled = !ready || !identity || connectionRequested;
  $('ts3-disconnect').disabled = !connectionRequested;
  for (const button of document.querySelectorAll('[data-disconnect]')) button.disabled = !connectionRequested;
  $('connection-requirement').hidden = Boolean(identity);
  $('identity-needed').hidden = !ready || Boolean(identity);
  $('workspace-readiness').textContent = !capabilities ? 'Loading connection capabilities…' : !ready ? 'The server connection service is unavailable. Please try again later.' : '';
  $('workspace-readiness').hidden = Boolean(ready);
  $('editor-connect').disabled = !ready || !identity || connectionRequested;
  document.querySelector('.identity-grid').hidden = Boolean(identity);
  window.dispatchEvent(new Event('voxharbor-capabilities'));
}
function showIdentity() {
  $('identity-status').textContent = identity ? `UID ${identity.uid} · security level ${identity.level}` : 'No identity stored. Create one once or import your existing identity.';
  buttons();
}
export async function loadProtocol(token) {
  const generation = ++protocolLoadGeneration;
  csrf = token;
  try {
    const nextCapabilities = await (await request('/api/protocol')).json();
    const nextIdentity = (await (await request('/api/identity')).json()).identity;
    if (generation !== protocolLoadGeneration) return;
    capabilities = nextCapabilities; identity = nextIdentity;
    $('native-status').textContent = !capabilities.nativeAvailable ? 'Native build unavailable' : !capabilities.identityEncryptionConfigured ? 'Configure the separate identity encryption key' : 'Protocol adapter ready · audio starts only when you enable it';
    showIdentity();
  } catch (error) { if (generation === protocolLoadGeneration) { $('native-status').textContent = error.message; $('workspace-readiness').hidden = false; $('workspace-readiness').textContent = 'Connection capabilities could not be loaded. Reload to try again.'; } }
}
export function resetProtocol() {
  ++connectionGeneration; ++protocolLoadGeneration;
  cancelCommands();
  connected = false; stopAudio(); latestState = undefined;
  $('voice-resume-mic').checked = false; $('voice-mode').value = 'ptt'; $('voice-threshold').value = '25';
  $('voice-input').value = ''; $('voice-output').value = '';
  transport?.stop('Session ended'); transport = undefined;
  connectionRequested = false;
  identity = undefined; capabilities = undefined;
  csrf = undefined;
  $('ts3-password').value = '';
  $('ts3-channel-password').value = '';
  $('ts3-channels').replaceChildren();
  $('ts3-state-summary').textContent = ''; $('ts3-status').textContent = 'Not connected';
  $('identity-status').textContent = 'Loading identity…'; $('native-status').textContent = 'Loading protocol capabilities…';
  window.dispatchEvent(new Event('voxharbor-reset'));
  buttons();
}
$('identity-create').addEventListener('click', async () => {
  $('identity-create').disabled = true; const generation = protocolLoadGeneration;
  try {
    const result = (await (await request('/api/identity/create', {})).json()).identity;
    if (generation !== protocolLoadGeneration) return;
    identity = result;
    showIdentity();
    $('ts3-status').textContent = 'Identity encrypted and stored. The same identity will be reused.';
  } catch (error) { if (generation === protocolLoadGeneration) { $('ts3-status').textContent = error.message; buttons(); } }
});
$('identity-import').addEventListener('change', async event => {
  const generation = protocolLoadGeneration;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 16384) throw new Error('Identity file must be smaller than 16 KiB');
    const value = await file.text(); if (generation !== protocolLoadGeneration) return;
    const result = (await (await request('/api/identity/import', { value })).json()).identity;
    if (generation !== protocolLoadGeneration) return; identity = result;
    showIdentity();
  } catch (error) { if (generation === protocolLoadGeneration) $('ts3-status').textContent = error.message; }
  finally { if (generation === protocolLoadGeneration) event.target.value = ''; }
});
$('identity-export').addEventListener('click', async () => {
  const generation = protocolLoadGeneration;
  if (!window.confirm('Export the private TeamSpeak identity? Anyone holding this file can use your identity. Store the backup securely.')) return;
  try {
    const response = await request('/api/identity/export', {});
    const blob = await response.blob(); if (generation !== protocolLoadGeneration) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'VoxHarbor-identity.ini';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { if (generation === protocolLoadGeneration) $('ts3-status').textContent = error.message; }
});
function renderState(event) {
  const previousChannel = latestState?.participants.find(client => client.id === latestState.ownClientId)?.channelId;
  const ownChannel = event.participants.find(client => client.id === event.ownClientId)?.channelId;
  if (previousChannel && previousChannel !== ownChannel) stopAudio();
  latestState = event; updateCodec();
  $('ts3-state-summary').textContent = `${event.server.name} · ${event.channels.length} channels · ${event.participants.length} visible participants · event update ${event.sequence}`;
  window.dispatchEvent(new CustomEvent('voxharbor-state', { detail: event }));
  window.dispatchEvent(new CustomEvent('voxharbor-protocol-diagnostic', { detail: { type: 'state', channels: event.channels.length, participants: event.participants.length, sequence: event.sequence } }));
}
$('ts3-connect').addEventListener('click', async () => {
  if (connectionRequested) return;
  const host = $('ts3-host').value.trim(); const port = Number($('ts3-port').value);
  const nickname = $('ts3-nickname').value.trim();
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1024 || port > 65535 || !nickname) {
    $('native-status').textContent = 'Enter a server hostname, a port from 1024 to 65535, and your nickname.'; return;
  }
  if (!transport) transport = new ProtocolConnection({
    url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ts3`,
    session: async ({ signal }) => {
      const response = await fetch('/api/session', { signal });
      if (!response.ok) throw Object.assign(new Error('Session unavailable'), { status: response.status });
      const session = await response.json(); csrf = session.csrf; return session;
    },
    disconnected: () => {
      cancelCommands();
      audioRecovery.interrupted(audio, $('voice-resume-mic').checked, !document.hidden);
      connected = false; stopAudio({ recovery: true });
      if (latestState && !$('ts3-state-summary').textContent.includes('last received state')) $('ts3-state-summary').textContent += ' · disconnected (last received state)';
    },
    diagnostic: detail => window.dispatchEvent(new CustomEvent('voxharbor-protocol-diagnostic', { detail })),
    expired: () => window.dispatchEvent(new Event('voxharbor-owner-expired')),
    phase: ({ state, delay, code, status }) => {
      window.dispatchEvent(new CustomEvent('voxharbor-protocol-diagnostic', { detail: { type: 'phase', state, ...(delay ? { delay } : {}), ...(code ? { code } : {}) } }));
      if (['stopped', 'failed', 'expired'].includes(state)) { audioRecovery.clear(); $('voice-status').textContent = 'Listening and microphone are off.'; }
      connectionRequested = Boolean(transport?.desired); connected = state === 'connected';
      window.dispatchEvent(new CustomEvent('voxharbor-connection', { detail: { state, delay } }));
      buttons(); audioButtons();
      const messages = {
        stopped: 'Disconnected. Microphone and listening are off.',
        connecting: status ? `Connection: ${status.replaceAll('_', ' ')}…` : 'Opening authenticated protocol transport…',
        connected: 'Connected through the full TeamSpeak client protocol.',
        retrying: `Reconnecting in ${Math.ceil((delay || 0) / 1000)} seconds. Audio will resume according to your reconnect choices.`,
        offline: 'Network offline. Reconnection will resume when the network returns.',
        failed: errorMessages[code] || 'Automatic recovery stopped. Check the connection error, then connect again.',
        expired: 'Session expired or was signed out.',
      };
      $('ts3-status').textContent = messages[state] || state;
    },
    event: message => {
      if (message instanceof ArrayBuffer) { audio?.receive(message); return; }
      if (message.type === 'ts3_state') {
        renderState(message);
        void audioRecovery.restore({ visible: !document.hidden, create: () => { setupAudio(); return audio; },
          valid: active => audio === active && connected && !document.hidden,
          output: $('voice-output').value, microphone: $('voice-input').value,
          resumeMicrophone: () => $('voice-resume-mic').checked,
          status: text => { $('voice-status').textContent = text; audioButtons(); } });
      }
      else if (message.type === 'ts3_identity') { identity = { ...identity, uid: message.uid, level: message.level }; showIdentity(); }
      else if (message.type === 'ts3_audio_status') { audio?.permissions(message); audioButtons(); }
      else if (message.type === 'ts3_connection_saved') window.dispatchEvent(new CustomEvent('voxharbor-connection-saved', { detail: message.preferences }));
      else if (message.type === 'ts3_message') window.dispatchEvent(new CustomEvent('voxharbor-message', { detail: message }));
      else if (message.type === 'ts3_command_result') {
        const pending = pendingCommands.get(message.requestId); if (!pending) return;
        clearTimeout(pending.timer); pendingCommands.delete(message.requestId);
        if (message.ok) pending.resolve();
        else pending.reject(new Error(message.code === 'server_denied_command' ? `The server denied this action${Number.isInteger(message.serverError) ? ` (error ${message.serverError}${Number.isInteger(message.missingPermission) ? `, permission ${message.missingPermission}` : ''})` : ''}. Check your permissions and any required password.` : message.code === 'command_not_sent' ? 'The action was not sent. Its recipient or channel may have changed.' : 'The action could not be confirmed. Check the current server state.'));
      }
      else if (message.type === 'ts3_error') $('ts3-status').textContent = errorMessages[message.code] || `Protocol error: ${message.code}`;
    },
  });
  const generation = ++connectionGeneration;
  const input = { host, port, nickname, channelId: $('ts3-channel').value ? Number($('ts3-channel').value) : null };
  if ($('ts3-password').value) input.password = $('ts3-password').value;
  if ($('ts3-channel-password').value) input.channelPassword = $('ts3-channel-password').value;
  if ($('settings-dialog').dataset.bookmarkId) input.bookmarkId = $('settings-dialog').dataset.bookmarkId;
  if ($('connection-clear-passwords').checked) { input.password = ''; input.channelPassword = ''; }
  for (const id of ['ts3-password', 'ts3-channel-password']) { $(id).value = ''; } $('connection-clear-passwords').checked = false;
  connectionRequested = true; buttons();
  $('ts3-status').textContent = 'Saving encrypted connection settings…';
  window.dispatchEvent(new CustomEvent('voxharbor-connection', { detail: { state: 'connecting' } }));
  try {
    const preferences = await (await request('/api/connection', input)).json();
    if (generation !== connectionGeneration || !csrf) return;
    window.dispatchEvent(new CustomEvent('voxharbor-connection-saved', { detail: preferences }));
    window.dispatchEvent(new CustomEvent('voxharbor-destination', { detail: preferences.connection }));
    transport.start({ connectionId: preferences.connection.id });
  } catch (error) {
    if (generation !== connectionGeneration) return;
    connectionRequested = false; buttons();
    $('ts3-status').textContent = error.message;
    $('native-status').textContent = error.message;
    window.dispatchEvent(new CustomEvent('voxharbor-connection', { detail: { state: 'failed' } }));
  } finally { input.password = ''; input.channelPassword = ''; }

});
window.addEventListener('offline', () => transport?.offline());
window.addEventListener('online', () => transport?.online());

async function devices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const entries = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [['voice-input', 'audioinput'], ['voice-output', 'audiooutput']]) {
    const select = $(id); const previous = select.value;
    select.replaceChildren(new Option('System default', ''));
    for (const device of entries.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default')) select.add(new Option(device.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${select.length}`, device.deviceId));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
}
function applyAudioSettings() {
  if (!audio) { audioButtons(); return; }
  audio.mode = $('voice-mode').value;
  audio.threshold = Number($('voice-threshold').value) / 1000;
  audio.configure(); audioButtons();
}
$('voice-listen').addEventListener('click', async () => {
  audioRecovery.clear();
  $('voice-listen').disabled = true;
  setupAudio(); const active = audio;
  try {
    await active.listen(active.outputMuted);
    if (audio !== active) return;
    $('voice-status').textContent = audio.outputMuted ? 'Listening stopped. Microphone muted.' : 'Listening enabled. Microphone remains off until you enable it.';
    $('voice-output').disabled = typeof audio.context?.setSinkId !== 'function';
    await devices();
  } catch (error) { if (audio === active) { stopAudio(); $('voice-status').textContent = error.message; } }
  finally { audioButtons(); }
});
$('voice-mic').addEventListener('click', async () => {
  audioRecovery.clear();
  $('voice-mic').disabled = true;
  const active = audio;
  try {
    if (active.muted) await active.microphone($('voice-input').value);
    else active.mute();
    if (audio !== active) return;
    $('voice-status').textContent = audio.muted ? 'Microphone muted.' : audio.mode === 'ptt' ? 'Microphone ready. Hold the talk button or Space while this page has focus.' : 'Voice activation enabled. Speech above the threshold is transmitted when the server permits it.';
    await devices();
  } catch (error) { if (audio === active) { audio?.mute(); $('voice-status').textContent = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Enable it in your browser, then try again.' : error.message; } }
  finally { audioButtons(); }
});
$('voice-resume-mic').addEventListener('change', () => {
  if (!$('voice-resume-mic').checked && audioRecovery.restoring) {
    audioRecovery.clear(); audio?.mute(); audioButtons();
    $('voice-status').textContent = 'Automatic microphone recovery cancelled. Enable the microphone to talk.';
  }
});
for (const id of ['voice-mode', 'voice-threshold']) $(id).addEventListener('change', applyAudioSettings);
$('voice-input').addEventListener('change', async () => {
  audio?.mute(); audioButtons();
  $('voice-status').textContent = 'Input device changed. Enable the microphone to use it.';
});
$('voice-output').addEventListener('change', async () => {
  try {
    if (typeof audio?.context?.setSinkId !== 'function') throw new Error('Output selection is unavailable in this browser. Use system audio settings.');
    await audio.context.setSinkId($('voice-output').value);
  } catch (error) { $('voice-status').textContent = error.message; }
});
const releaseTalk = () => audio?.ptt(false);
$('voice-ptt').addEventListener('pointerdown', event => { if (!$('voice-ptt').disabled) { event.target.setPointerCapture(event.pointerId); audio?.ptt(true); } });
for (const type of ['keydown', 'keyup']) $('voice-ptt').addEventListener(type, event => {
  if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); audio?.ptt(type === 'keydown'); }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('voice-ptt').addEventListener(type, releaseTalk);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || event.target.isContentEditable || audio?.mode !== 'ptt') return;
  event.preventDefault(); audio?.ptt(true);
});
document.addEventListener('keyup', event => { if (event.code === 'Space') releaseTalk(); });
window.addEventListener('blur', releaseTalk);
document.addEventListener('visibilitychange', () => { if (document.hidden) { audioRecovery.clear(); audio?.mute(); audioButtons(); } });
navigator.mediaDevices?.addEventListener('devicechange', () => { audioRecovery.clear(); audio?.mute(); audioButtons(); void devices().catch(() => {}); });
$('ts3-disconnect').addEventListener('click', () => {
  ++connectionGeneration; connectionRequested = false; buttons();
  transport?.stop();
});
window.addEventListener('pagehide', () => { ++connectionGeneration; transport?.stop('Page closed'); });
