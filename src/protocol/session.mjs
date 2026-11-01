import { randomBytes } from 'node:crypto';
import { spawnProtocol, nativeAvailable } from '../platform/native-protocol.mjs';
import { resolveTeamSpeak } from '../transport/destination.mjs';
import { decodeVoice, encodeVoice } from '../../public/voice-frame.mjs';
import { normalizeCommand } from './commands.mjs';

const LEASE = 'voxharbor:protocol:v1:active-owner';
const safeText = value => String(value || '').slice(0, 256);
export function createProtocolControl(ws, { config, store, vault, preferences, csrf, close }) {
  let native;
  let starting = false;
  let stopped = false;
  let leaseToken;
  let renewal;
  let liveness;
  let lastHeartbeat = Date.now();
  let pendingState;
  let flush;
  let audioReady = false;
  let canSend = false;
  let connectionId;
  let audioWindow = 0;
  let audioCount = 0;
  const pendingCommands = new Map();
  const emit = event => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 1024 * 1024) { close(1008, 'Protocol output capacity exceeded'); return; }
    ws.send(JSON.stringify(event));
  };
  async function release() {
    clearInterval(renewal);
    clearInterval(liveness);
    clearInterval(flush);
    for (const pending of pendingCommands.values()) clearTimeout(pending.timer);
    pendingCommands.clear();
    pendingState = undefined;
    const token = leaseToken;
    leaseToken = undefined;
    if (token) await store.compareDelete(LEASE, token);
  }
  async function stop() {
    stopped = true;
    clearInterval(liveness);
    native?.stop();
    // The lease is held until the child exits, preventing overlapping identities.
    if (!native && !starting) await release();
  }
  function normalizeState(event) {
    if (!Array.isArray(event.channels) || !Array.isArray(event.participants) || event.channels.length > 4096 || event.participants.length > 4096) throw new Error('State capacity exceeded');
    return {
      type: 'ts3_state', sequence: event.sequence, ownClientId: event.ownClientId,
      server: { name: safeText(event.server?.name) },
      channels: event.channels.map(channel => ({ id: channel.id, parentId: channel.parentId, name: safeText(channel.name), order: channel.order, subscribed: Boolean(channel.subscribed), codec: channel.codec, passwordProtected: Boolean(channel.passwordProtected), topic: safeText(channel.topic) })),
      participants: event.participants.map(client => ({ id: client.id, channelId: client.channelId, name: safeText(client.name), inputMuted: Boolean(client.inputMuted), outputMuted: Boolean(client.outputMuted), awayMessage: typeof client.awayMessage === 'string' ? safeText(client.awayMessage) : null, uid: /^[A-Za-z0-9+/]{27}=$/.test(client.uid || '') ? client.uid : null })),
    };
  }
  return {
    stop,
    voice(data) {
      let frame;
      try { frame = decodeVoice(new Uint8Array(data), 1); }
      catch { return close(1003, 'Invalid voice frame'); }
      if (!native || !audioReady || stopped) return;
      if (Date.now() - audioWindow >= 1000) { audioWindow = Date.now(); audioCount = 0; }
      if (++audioCount > 65) return close(1008, 'Voice rate exceeded');
      if (!canSend) return;
      native.send({ op: 'audio', codec: frame.codec, data: Buffer.from(frame.data).toString('base64') });
    },
    async command(data) {
      let input;
      try { input = JSON.parse(data.toString('utf8')); } catch { return close(1003, 'Expected a protocol command'); }
      if (input.csrf !== csrf) return close(4403, 'Protocol CSRF check failed');
      if (input.type === 'ping') {
        if (!Number.isSafeInteger(input.nonce) || input.nonce < 0 || input.nonce > 0xffffffff) return close(1003, 'Invalid protocol heartbeat');
        lastHeartbeat = Date.now();
        emit({ type: 'ts3_pong', nonce: input.nonce }); return;
      }
      if (input.type === 'disconnect') { await stop(); return; }
      if (input.type === 'command') {
        const command = normalizeCommand(input.command);
        if (!Number.isSafeInteger(input.requestId) || input.requestId < 1 || input.requestId > 0xffffffff || !command) return close(1003, 'Invalid client command');
        if (!native || !audioReady || stopped) return emit({ type: 'ts3_command_result', requestId: input.requestId, ok: false, code: 'not_connected' });
        if (pendingCommands.size >= 16 || pendingCommands.has(input.requestId)) return emit({ type: 'ts3_command_result', requestId: input.requestId, ok: false, code: 'command_capacity' });
        const timer = setTimeout(() => {
          pendingCommands.delete(input.requestId);
          emit({ type: 'ts3_command_result', requestId: input.requestId, ok: false, code: 'command_timeout' });
        }, 15000);
        pendingCommands.set(input.requestId, { timer, command });
        if (!native.send({ op: 'command', request_id: input.requestId, command })) {
          clearTimeout(pendingCommands.get(input.requestId).timer); pendingCommands.delete(input.requestId);
          emit({ type: 'ts3_command_result', requestId: input.requestId, ok: false, code: 'command_not_sent' });
        }
        return;
      }
      if (input.type === 'audio_state') {
        if (!native || !audioReady || stopped) return;
        if (typeof input.inputMuted !== 'boolean' || typeof input.outputMuted !== 'boolean') return close(1003, 'Invalid audio state');
        canSend = false;
        if (!native.send({ op: 'audio_state', input_muted: input.inputMuted, output_muted: input.outputMuted })) {
          await stop(); close(1011, 'Audio state could not be applied');
        }
        return;
      }
      if (input.type !== 'connect') return close(1003, 'Unknown protocol command');
      if (native || starting || stopped) return;
      if (!/^[a-f0-9]{32}$/.test(input.connectionId || '') || ['nickname', 'destination', 'password', 'channelId', 'channelPassword'].some(key => Object.hasOwn(input, key)) ||
          (input.heartbeat !== undefined && typeof input.heartbeat !== 'boolean')) {
        return emit({ type: 'ts3_error', code: 'invalid_connection_options' });
      }
      starting = true;
      try {
        const connection = await preferences.activeConnection(input.connectionId);
        connectionId = connection.id;
        if (!await nativeAvailable(config)) throw new Error('native_unavailable');
        if (!await store.limit('voxharbor:protocol:connect-rate', 6, 60)) throw new Error('connection_rate_limit');
        const identity = await vault.read();
        if (!identity) throw new Error('identity_required');
        const target = await resolveTeamSpeak({ ts3Host: connection.host, ts3Port: connection.port });
        if (stopped || ws.readyState !== 1) return;
        const token = randomBytes(32).toString('hex');
        if (!await store.putIfAbsent(LEASE, token, 35)) throw new Error('another_session_is_active');
        leaseToken = token;
        if (stopped || ws.readyState !== 1) { await release(); return; }
        let renewing = false;
        if (input.heartbeat === true) {
          lastHeartbeat = Date.now();
          liveness = setInterval(() => {
            if (Date.now() - lastHeartbeat < 35000 || stopped) return;
            emit({ type: 'ts3_error', code: 'owner_transport_timeout', inconclusive: true });
            void stop().finally(() => close(4000, 'Owner transport heartbeat expired'));
          }, 10000);
        }
        renewal = setInterval(async () => {
          if (renewing || !leaseToken) return;
          renewing = true;
          try {
            if (!await store.compareSet(LEASE, token, token, 35)) throw new Error();
          } catch { emit({ type: 'ts3_error', code: 'session_lease_lost' }); await stop(); }
          finally { renewing = false; }
        }, 10000);
        flush = setInterval(() => {
          if (pendingState) { const next = pendingState; pendingState = undefined; emit(next); }
        }, 100);
        native = spawnProtocol(config, {
          op: 'connect', identity: identity.identity, address: target.address,
          nickname: connection.nickname, password: connection.password || null, seconds: 240,
          channel_id: connection.channelId || null, channel_password: connection.channelPassword || null,
        }, async event => {
          if (event.type === 'identity_internal') {
            const metadata = await vault.update(event);
            emit({ type: 'ts3_identity', ...metadata });
          } else if (event.type === 'state') pendingState = normalizeState(event);
          else if (event.type === 'message') {
            if (!['channel', 'server', 'private', 'poke'].includes(event.target) || !Number.isInteger(event.clientId)) return;
            emit({ type: 'ts3_message', target: event.target, clientId: event.clientId, targetClientId: event.targetClientId, uid: /^[A-Za-z0-9+/]{27}=$/.test(event.uid || '') ? event.uid : null, targetUid: /^[A-Za-z0-9+/]{27}=$/.test(event.targetUid || '') ? event.targetUid : null, name: safeText(event.name), message: String(event.message || '').slice(0, 4096), channelId: event.channelId });
          } else if (event.type === 'client_command_result') {
            if (!pendingCommands.has(event.requestId)) return;
            const pending = pendingCommands.get(event.requestId);
            clearTimeout(pending.timer); pendingCommands.delete(event.requestId);
            if (event.ok && ['join_channel', 'nickname'].includes(pending.command.type)) {
              const changes = pending.command.type === 'join_channel' ? { channelId: pending.command.channel_id, channelPassword: pending.command.password || '' } : { nickname: pending.command.name };
              let saved;
              try { saved = await preferences.updateConnection(connectionId, changes); } catch { /* Server action succeeded; never replay it after a storage failure. */ }
              if (saved) emit({ type: 'ts3_connection_saved', preferences: saved });
              else emit({ type: 'ts3_error', code: 'connection_settings_not_saved' });
            }
            emit({ type: 'ts3_command_result', requestId: event.requestId, ok: Boolean(event.ok), ...(!event.ok ? { code: event.code === 'command_not_sent' ? 'command_not_sent' : 'server_denied_command', ...(Number.isSafeInteger(event.serverError) ? { serverError: event.serverError } : {}), ...(Number.isSafeInteger(event.missingPermission) ? { missingPermission: event.missingPermission } : {}) } : {}) });
          }
          else if (event.type === 'audio_status') {
            canSend = Boolean(event.canSend);
            emit({ type: 'ts3_audio_status', canSend, canReceive: Boolean(event.canReceive) });
          } else if (event.type === 'audio') {
            if (ws.readyState !== 1 || ws.bufferedAmount > 8192 || ![4, 5].includes(event.codec)) return;
            const data = Buffer.from(event.data, 'base64');
            if (data.length > 1275) return;
            ws.send(encodeVoice({ direction: 2, clientId: event.clientId, sequence: event.sequence, codec: event.codec, whisper: event.whisper, data }), { binary: true });
          } else if (event.type === 'command_result' && !event.ok) emit({ type: 'ts3_error', code: 'server_permission_or_command_error' });
          else if (event.type === 'status') {
            audioReady = event.status === 'connected';
            if (!audioReady) canSend = false;
            emit({ type: 'ts3_status', status: safeText(event.status), ...(event.requiredLevel ? { requiredLevel: event.requiredLevel } : {}) });
          }
          else if (event.type === 'error' || event.type === 'warning') emit({ type: 'ts3_error', code: safeText(event.code), inconclusive: Boolean(event.inconclusive) });
        });
        void native.done.catch(() => emit({ type: 'ts3_error', code: 'native_protocol_failed' })).finally(async () => {
          if (pendingState) emit(pendingState);
          await release().catch(() => {});
          close(1000, 'Protocol session ended');
        });
      } catch (error) {
        await release().catch(() => {});
        const publicCodes = ['native_unavailable', 'identity_required', 'another_session_is_active', 'connection_rate_limit'];
        const settingsCode = ['connection_required', 'connection_settings_changed'].includes(error.code) ? error.code : null;
        emit({ type: 'ts3_error', code: settingsCode || (publicCodes.includes(error.message) ? error.message : 'identity_storage_or_destination_error') });
        close(1011, 'Protocol setup failed');
      } finally { starting = false; }
    },
  };
}
