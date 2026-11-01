class VoxCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Float32Array(960); this.offset = 0; this.pending = 0; this.enabled = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'ack') this.pending = Math.max(0, this.pending - 1);
      else if (data.type === 'enabled') { this.enabled = data.value; this.offset = 0; }
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || !this.enabled) return true;
    for (const value of input) {
      this.frame[this.offset++] = value;
      if (this.offset === 960) {
        if (this.pending < 2) {
          const frame = this.frame;
          this.port.postMessage({ pcm: frame, at: currentTime }, [frame.buffer]);
          this.pending++;
          this.frame = new Float32Array(960);
        }
        this.offset = 0;
      }
    }
    return true;
  }
}
class VoxPlayback extends AudioWorkletProcessor {
  constructor() {
    super(); this.frames = []; this.offset = 0; this.enabled = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'clear') { this.frames = []; this.offset = 0; }
      else if (data.pcm instanceof Float32Array && data.pcm.length === 1920) {
        // At most 80 ms after the jitter buffer. Drop old samples on overrun.
        if (this.frames.length >= 4) { this.frames = []; this.offset = 0; }
        this.frames.push(data.pcm);
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    for (let i = 0; i < output[0].length; i++) {
      const frame = this.frames[0];
      if (!frame) break;
      output[0][i] = frame[this.offset * 2];
      if (output[1]) output[1][i] = frame[this.offset * 2 + 1];
      if (++this.offset >= 960) { this.frames.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('vox-capture', VoxCapture);
registerProcessor('vox-playback', VoxPlayback);
