// Packet sequence numbers wrap at 65536. A talk spurt begins after 60 ms.
export const sequenceDistance = (a, b) => ((a - b + 32768) & 65535) - 32768;
export class JitterBuffer {
  constructor({ capacity = 12, prebuffer = 3, maxLoss = 3 } = {}) {
    this.capacity = capacity; this.prebuffer = prebuffer; this.maxLoss = maxLoss;
    this.packets = new Map(); this.expected = null; this.wait = 0; this.loss = 0;
    this.stats = { late: 0, duplicate: 0, overflow: 0, lost: 0, received: 0 };
  }
  clear() { this.packets.clear(); this.expected = null; this.wait = 0; this.loss = 0; }
  push(packet) {
    const id = packet.sequence;
    this.stats.received++;
    if (this.expected === null) { this.expected = id; this.wait = this.prebuffer; }
    const delta = sequenceDistance(id, this.expected);
    if (delta < 0) { this.stats.late++; return false; }
    if (this.packets.has(id)) { this.stats.duplicate++; return false; }
    if (delta >= this.capacity || this.packets.size >= this.capacity) {
      this.clear(); this.expected = id; this.wait = this.prebuffer;
      this.stats.overflow++;
    }
    this.packets.set(id, packet);
    return true;
  }
  pull() {
    if (this.expected === null) return { type: 'idle' };
    if (this.wait > 0) { this.wait--; return { type: 'wait' }; }
    const packet = this.packets.get(this.expected);
    this.packets.delete(this.expected);
    this.expected = (this.expected + 1) & 65535;
    if (packet) {
      this.loss = 0;
      if (packet.end) { this.clear(); return { type: 'end' }; }
      return { type: 'packet', packet };
    }
    this.stats.lost++; this.loss++;
    if (this.loss >= this.maxLoss) { this.clear(); return { type: 'end' }; }
    // The next packet may carry in-band FEC for exactly this missing packet.
    return { type: 'loss', next: this.packets.get(this.expected) };
  }
}
