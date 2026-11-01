
export class VoiceAudio extends EventTarget {
  constructor(sendCommand, sendFrame) {
    super(); this.sendCommand = sendCommand; this.sendFrame = sendFrame;
    this.muted = true; this.outputMuted = true; this.canSend = false;
    this.mode = 'ptt'; this.codec = 4; this.threshold = 0.025; this.packetPending = 0;
    this.inputDevice = ''; this.stopped = false;
  }
  event(type, detail) { if (!this.stopped) this.dispatchEvent(new CustomEvent(type, { detail })); }
  assertActive() { if (this.stopped) throw new DOMException('The audio connection ended.', 'AbortError'); }
  async start() {
    this.assertActive();
    if (this.starting) return this.starting;
    const operation = this.initialize(); this.starting = operation;
    try { await operation; } finally { if (this.starting === operation) this.starting = undefined; }
  }
  async initialize() {
    this.assertActive();
    if (this.context) { await this.context.resume(); return; }
    this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    if (this.context.sampleRate !== 48000 || !this.context.audioWorklet) throw new Error('This browser cannot create the required 48 kHz audio worklet.');
    await this.context.audioWorklet.addModule('/voice-worklet.mjs');
    this.assertActive();
    this.playback = new AudioWorkletNode(this.context, 'vox-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.playback.connect(this.context.destination);
    this.worker = new Worker('/voice-worker.mjs', { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (this.stopped) return;
      if (data.type === 'ready') this.ready?.();
      else if (data.type === 'encoded') {
        const sent = this.sendFrame(data.frame) !== false;
        if (!sent) this.ptt(false);
      } else if (data.type === 'pcm' && !this.outputMuted && Date.now() - data.at < 100 && this.context?.state === 'running') {
        this.playback.port.postMessage({ pcm: data.pcm }, [data.pcm.buffer]);
      } else if (data.type === 'packet_ack') this.packetPending = Math.max(0, this.packetPending - 1);
      else if (data.type === 'capture_ack') this.capture?.port.postMessage({ type: 'ack' });
      else if (data.type === 'error') { this.mute(); this.event('error', 'Audio processing failed. Microphone stopped; reconnect audio to retry.'); }
      else if (['speaking', 'transmitting', 'stats'].includes(data.type)) this.event(data.type, data);
    };
    this.worker.onerror = () => { this.mute(); this.event('error', 'The audio worker failed. Reconnect to restart it.'); };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Audio codec initialization timed out.')), 10000);
      this.ready = () => { clearTimeout(timer); resolve(); };
      this.cancelInitialization = () => { clearTimeout(timer); reject(new DOMException('The audio connection ended.', 'AbortError')); };
      this.worker.postMessage({ type: 'init' });
    });
    this.cancelInitialization = undefined;
    this.assertActive();
    for (const [clientId, volume] of this.gains || []) this.worker.postMessage({ type: 'volume', clientId, volume });
    this.context.onstatechange = () => {
      if (this.context?.state !== 'running') { this.ptt(false); this.mute(); this.clearPlayback(); this.event('error', 'Audio paused by the browser. Resume listening, then enable the microphone again.'); }
    };
    await this.context.resume();
    this.assertActive();
  }
  configure() {
    if (this.stopped) return;
    this.worker?.postMessage({ type: 'configure', mode: this.mode, muted: this.muted, outputMuted: this.outputMuted, canSend: this.canSend, codec: this.codec, threshold: this.threshold });
    this.capture?.port.postMessage({ type: 'enabled', value: !this.muted && this.canSend && !this.outputMuted });
  }
  sync() { if (this.stopped) return; this.sendCommand({ type: 'audio_state', inputMuted: this.muted, outputMuted: this.outputMuted }); this.configure(); }
  async listen(enabled) {
    if (enabled && ![4, 5].includes(this.codec)) throw new Error('This channel uses an unsupported codec. Join an Opus Voice or Opus Music channel.');
    if (enabled) await this.start();
    this.assertActive();
    this.outputMuted = !enabled;
    if (!enabled) this.mute();
    this.clearPlayback(); this.sync();
  }
  permissions(event) { this.canSend = event.canSend; this.configure(); }
  channel(codec) {
    if (this.codec === codec) return;
    this.codec = codec;
    this.mute(); this.worker?.postMessage({ type: 'reset' }); this.clearPlayback();
    if (![4, 5].includes(codec)) this.event('error', 'This channel uses a codec that is not supported yet. Join an Opus Voice or Opus Music channel.');
  }
  async microphone(deviceId = this.inputDevice) {
    this.assertActive();
    if (this.outputMuted) throw new Error('Enable listening before enabling your microphone.');
    if (![4, 5].includes(this.codec)) throw new Error('Microphone requires an Opus channel.');
    this.mute();
    const captureGeneration = this.captureGeneration;
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.capture?.disconnect();
    this.inputDevice = deviceId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
    if (this.stopped || this.outputMuted || captureGeneration !== this.captureGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.source = this.context.createMediaStreamSource(stream);
    this.capture = new AudioWorkletNode(this.context, 'vox-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.capture.port.onmessage = ({ data }) => {
      if (this.muted || !this.canSend || !this.context || typeof data.at !== 'number' || (this.context.currentTime - data.at) * 1000 > 100) { this.capture?.port.postMessage({ type: 'ack' }); return; }
      this.worker.postMessage({ type: 'capture', pcm: data.pcm, at: Date.now() }, [data.pcm.buffer]);
    };
    // The worklet emits silence. Its output keeps capture scheduled without local sidetone.
    this.source.connect(this.capture); this.capture.connect(this.context.destination);
    for (const track of stream.getAudioTracks()) {
      track.onended = () => { this.mute(); this.event('error', 'Microphone disconnected. Select a device and enable it again.'); };
      track.onmute = () => { this.ptt(false); this.mute(); this.event('error', 'Microphone input became unavailable.'); };
    }
    this.muted = false; this.sync();
  }
  mute() {
    this.captureGeneration = (this.captureGeneration || 0) + 1;
    this.muted = true;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
    this.ptt(false); this.sync();
  }
  ptt(pressed) { this.worker?.postMessage({ type: 'ptt', pressed: !this.muted && this.canSend && pressed }); }
  volume(clientId, volume) {
    this.gains ||= new Map();
    if (!this.gains.has(clientId) && this.gains.size >= 128) this.gains.delete(this.gains.keys().next().value);
    volume = Math.max(0, Math.min(2, Number(volume) || 0)); this.gains.set(clientId, volume);
    this.worker?.postMessage({ type: 'volume', clientId, volume });
  }
  clearPlayback() { this.playback?.port.postMessage({ type: 'clear' }); }
  receive(frame) {
    if (!this.worker || this.outputMuted || this.packetPending >= 64) return;
    this.packetPending++;
    this.worker.postMessage({ type: 'packet', frame }, [frame]);
  }
  stop() {
    if (!this.stopped && (!this.muted || !this.outputMuted)) { this.muted = true; this.outputMuted = true; this.sync(); }
    this.stopped = true; this.mute();
    this.cancelInitialization?.(); this.cancelInitialization = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.stop(); });
    this.source?.disconnect(); this.capture?.disconnect(); this.playback?.disconnect();
    this.worker?.terminate(); this.worker = null;
    if (this.context) { this.context.onstatechange = null; void this.context.close(); this.context = null; }
  }
}
