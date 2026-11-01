import { encodeVoice, decodeVoice } from '/voice-frame.mjs';
const result = document.getElementById('result');
document.getElementById('run').onclick = async event => {
  event.target.disabled = true;
  let context; let worker; let oscillator;
  const report = { environment: 'local-browser-synthetic-only', browser: navigator.userAgent, sampleRate: 0, encoded: 0, decoded: 0, decodedEnergy: 0, playbackEnergy: 0, playbackSamples: 0, peak: 0, speaking: [], errors: [], stats: null };
  try {
    result.textContent = 'Testing…';
    context = new AudioContext({ sampleRate: 48000 }); report.sampleRate = context.sampleRate;
    if (context.sampleRate !== 48000) throw new Error('48 kHz unavailable');
    await context.audioWorklet.addModule('/voice-worklet.mjs');
    await context.audioWorklet.addModule('/probe.mjs');
    const capture = new AudioWorkletNode(context, 'vox-capture');
    const playback = new AudioWorkletNode(context, 'vox-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const probe = new AudioWorkletNode(context, 'playback-probe');
    playback.connect(probe); probe.connect(context.destination);
    probe.port.onmessage = ({ data }) => { report.playbackEnergy += data.energy; report.playbackSamples += data.samples; };
    const silent = context.createGain(); silent.gain.value = 0; capture.connect(silent); silent.connect(context.destination);
    oscillator = context.createOscillator(); oscillator.frequency.value = 440;
    const level = context.createGain(); level.gain.value = 0.12; oscillator.connect(level); level.connect(capture);
    worker = new Worker('/voice-worker.mjs', { type: 'module' });
    let ready;
    const initialized = new Promise(resolve => { ready = resolve; });
    const talking = new Set();
    worker.onerror = error => report.errors.push(error.message);
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') ready();
      else if (data.type === 'capture_ack') capture.port.postMessage({ type: 'ack' });
      else if (data.type === 'encoded') {
        const packet = decodeVoice(data.frame, 1); if (packet.end) return;
        report.encoded++;
        for (const clientId of [41, 42, 43]) {
          if (clientId === 42 && report.encoded % 13 === 0) continue;
          const frame = encodeVoice({ direction: 2, clientId, sequence: (65520 + report.encoded) & 65535, codec: 4, data: packet.data });
          worker.postMessage({ type: 'packet', frame: frame.buffer }, [frame.buffer]);
        }
      } else if (data.type === 'pcm') {
        report.decoded++;
        for (const value of data.pcm) { report.decodedEnergy += value * value; report.peak = Math.max(report.peak, Math.abs(value)); }
        playback.port.postMessage({ pcm: data.pcm }, [data.pcm.buffer]);
      } else if (data.type === 'speaking') { data.ids.forEach(id => talking.add(id)); report.speaking = [...talking]; }
      else if (data.type === 'stats') report.stats = data;
      else if (data.type === 'error') report.errors.push(data.code);
    };
    worker.postMessage({ type: 'init' });
    await Promise.race([initialized, new Promise((_, reject) => setTimeout(() => reject(new Error('Codec initialization timeout')), 10000))]);
    worker.postMessage({ type: 'configure', mode: 'ptt', muted: false, outputMuted: false, canSend: true, codec: 4, threshold: 0.025 });
    worker.postMessage({ type: 'ptt', pressed: true });
    capture.port.onmessage = ({ data }) => worker.postMessage({ type: 'capture', pcm: data.pcm, at: Date.now() }, [data.pcm.buffer]);
    capture.port.postMessage({ type: 'enabled', value: true });
    await context.resume(); oscillator.start();
    await new Promise(resolve => setTimeout(resolve, 2400));
    worker.postMessage({ type: 'ptt', pressed: false });
    capture.port.postMessage({ type: 'enabled', value: false });
    const atRelease = report.encoded;
    await new Promise(resolve => setTimeout(resolve, 200));
    report.pttReleaseStopped = report.encoded <= atRelease + 1;
    report.pass = report.encoded > 50 && report.decodedEnergy > 10 && report.playbackEnergy > 10 && report.peak <= 1 && report.speaking.length === 3 && report.pttReleaseStopped && report.errors.length === 0;
  } catch (error) { report.errors.push(error.message); report.pass = false; }
  finally { oscillator?.stop(); worker?.terminate(); await context?.close(); }
  result.textContent = JSON.stringify(report, null, 2); event.target.disabled = false;
};
