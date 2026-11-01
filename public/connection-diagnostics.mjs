// Explicit fields only: no URLs, close reasons, messages, account IDs or media.
const numbers = new Set(['attempt', 'delay', 'closeCode', 'durationMs', 'lastMessageAgeMs', 'roundTripMs', 'channels', 'participants', 'sequence']);
const words = new Set(['type', 'state', 'stage', 'code']);
export function safeDiagnostic(input) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (numbers.has(key) && Number.isFinite(value) && value >= 0) result[key] = value;
    if (words.has(key) && typeof value === 'string' && /^[a-z][a-z_]{0,63}$/.test(value)) result[key] = value;
    if (key === 'receivedState' && typeof value === 'boolean') result[key] = value;
  }
  return result;
}
