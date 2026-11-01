// Versioned binary transport; no tokens, passwords or identity material in audio frames.
export const MAX_OPUS_PACKET = 1275;
export function encodeVoice({ direction, clientId = 0, sequence = 0, codec = 4, whisper = false, data }) {
  if (!(data instanceof Uint8Array) || data.length > MAX_OPUS_PACKET || ![1, 2].includes(direction) || ![4, 5].includes(codec)) throw new Error('Invalid voice frame');
  const result = new Uint8Array(8 + data.length);
  const header = new DataView(result.buffer);
  result[0] = 1; result[1] = direction;
  header.setUint16(2, clientId); header.setUint16(4, sequence);
  result[6] = codec; result[7] = (data.length <= 1 ? 1 : 0) | (whisper ? 2 : 0);
  result.set(data, 8);
  return result;
}
export function decodeVoice(bytes, direction) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 8 + MAX_OPUS_PACKET) throw new Error('Invalid voice frame size');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 1 || bytes[1] !== direction || ![4, 5].includes(bytes[6]) || bytes[7] & ~3 ||
      Boolean(bytes[7] & 1) !== (bytes.length <= 9) || (direction === 1 && (header.getUint16(2) !== 0 || bytes[7] & 2))) throw new Error('Invalid voice frame header');
  return { clientId: header.getUint16(2), sequence: header.getUint16(4), codec: bytes[6], end: Boolean(bytes[7] & 1), whisper: Boolean(bytes[7] & 2), data: bytes.subarray(8) };
}
