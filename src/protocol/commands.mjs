const id = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value > 0 && value <= max;
const uid = value => value === undefined || /^[A-Za-z0-9+/]{27}=$/.test(value);
const text = (value, bytes, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && Buffer.byteLength(value) <= bytes && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
// Construct fresh typed controls. Never forward arbitrary protocol names or arguments.
export function normalizeCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  switch (input.type) {
    case 'join_channel':
      return id(input.channelId) && (input.password === undefined || text(input.password, 1024, true)) && (input.password?.length ?? 0) <= 256
        ? { type: input.type, channel_id: input.channelId, password: input.password || null } : null;
    case 'subscribe':
      return id(input.channelId) && typeof input.subscribed === 'boolean' ? { type: input.type, channel_id: input.channelId, subscribed: input.subscribed } : null;
    case 'nickname':
      return text(input.name, 256) && [...input.name].length <= 64 ? { type: input.type, name: input.name.trim() } : null;
    case 'away':
      return typeof input.away === 'boolean' && text(input.message ?? '', 500, true) ? { type: input.type, away: input.away, message: input.message || '' } : null;
    case 'text_message':
      return ['channel', 'server', 'private'].includes(input.target) && text(input.message, 1000) && (input.target !== 'channel' || id(input.channelId)) && (input.target !== 'private' || (id(input.clientId, 65535) && uid(input.clientUid)))
        ? { type: input.type, target: input.target, channel_id: input.target === 'channel' ? input.channelId : null, client_id: input.target === 'private' ? input.clientId : null, client_uid: input.target === 'private' ? input.clientUid || null : null, message: input.message } : null;
    case 'poke':
      return id(input.clientId, 65535) && uid(input.clientUid) && text(input.message, 500, true) ? { type: input.type, client_id: input.clientId, client_uid: input.clientUid || null, message: input.message } : null;
    default: return null;
  }
}
