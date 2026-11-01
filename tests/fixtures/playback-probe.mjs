class PlaybackProbe extends AudioWorkletProcessor {
  constructor() { super(); this.count = 0; this.energy = 0; }
  process(inputs) {
    for (const value of inputs[0]?.[0] || []) { this.energy += value * value; this.count++; }
    if (this.count >= 4800) { this.port.postMessage({ samples: this.count, energy: this.energy }); this.count = 0; this.energy = 0; }
    return true; // Output remains silence.
  }
}
registerProcessor('playback-probe', PlaybackProbe);
