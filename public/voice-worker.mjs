import { createEncoder, createDecoder, getPacketInfo, Application, Signal } from './vendor/opus/index.js';
import { JitterBuffer } from './jitter-buffer.mjs';
import { encodeVoice, decodeVoice } from './voice-frame.mjs';

const speakers = new Map();
const volumes = new Map();
let encoder;
let mode = 'ptt';
let pressed = false;
let muted = true;
let outputMuted = true;
let canSend = false;
let codec = 4;
let threshold = 0.025;
let hangover = 0;
let transmitting = false;
let sequence = 0;
let generation = 0;
let pendingPackets = 0;
let clock;
let lastTick = 0;
let reportTicks = 0;
let rejected = 0;
let currentSpeaking = '';
function status(active) {
  if (transmitting === active) return;
  transmitting = active;
  postMessage({ type: 'transmitting', active });
}
function endTransmission() {
  hangover = 0;
  if (transmitting) {
    const frame = encodeVoice({ direction: 1, sequence: sequence++ & 65535, codec, data: new Uint8Array() });
    postMessage({ type: 'encoded', frame }, [frame.buffer]);
  }
  status(false);
}
function resetSpeakers() {
  generation++;
  for (const speaker of speakers.values()) speaker.decoder?.free();
  speakers.clear();
}
async function receive(frame) {
  if (outputMuted) return;
  const packet = decodeVoice(new Uint8Array(frame), 2);
  if (!packet.end && (await getPacketInfo(packet.data, { sampleRate: 48000 })).samples !== 960) { rejected++; return; }
  let speaker = speakers.get(packet.clientId);
  if (!speaker) {
    if (packet.end || speakers.size >= 32) { rejected++; return; }
    speaker = { queue: new JitterBuffer(), volume: volumes.get(packet.clientId) ?? 1, last: performance.now(), decoder: null, ready: null };
    speakers.set(packet.clientId, speaker);
    const currentGeneration = generation;
    speaker.ready = createDecoder({ sampleRate: 48000, channels: 2, maxFrameSize: 960 }).then(decoder => {
      if (generation !== currentGeneration || speakers.get(packet.clientId) !== speaker) { decoder.free(); return; }
      speaker.decoder = decoder;
    });
  }
  await speaker.ready;
  if (speakers.get(packet.clientId) !== speaker || !speaker.decoder || outputMuted) return;
  speaker.last = performance.now();
  speaker.queue.push(packet);
}
function tick() {
  const now = performance.now();
  // A suspended/background worker must never replay its backlog on resume.
  if (now - lastTick > 100) resetSpeakers();
  lastTick = now;
  if (outputMuted) return;
  const mix = new Float32Array(1920);
  const speaking = [];
  for (const [id, speaker] of speakers) {
    if (!speaker.decoder) continue;
    const item = speaker.queue.pull();
    let pcm;
    try {
      if (item.type === 'packet') pcm = speaker.decoder.decodeFloat(item.packet.data, { maxFrameSize: 960 });
      else if (item.type === 'loss') pcm = item.next && !item.next.end ? speaker.decoder.decodeFloat(item.next.data, { decodeFec: true, frameSize: 960, maxFrameSize: 960 }) : speaker.decoder.decodePacketLossFloat(960);
    } catch { rejected++; speaker.queue.clear(); }
    if (pcm) {
      speaking.push(id);
      for (let i = 0; i < Math.min(pcm.length, mix.length); i++) mix[i] += pcm[i] * speaker.volume;
    }
    if (now - speaker.last > 3000) { speaker.decoder.free(); speakers.delete(id); }
  }
  // Bound summed output when several speakers transmit together.
  for (let i = 0; i < mix.length; i++) mix[i] = Math.max(-1, Math.min(1, mix[i]));
  postMessage({ type: 'pcm', pcm: mix, at: Date.now() }, [mix.buffer]);
  const ids = speaking.sort((a, b) => a - b).join(',');
  if (ids !== currentSpeaking) { currentSpeaking = ids; postMessage({ type: 'speaking', ids: speaking }); }
  if (++reportTicks % 50 === 0) {
    const stats = { lost: 0, late: 0, overflow: 0, received: 0, rejected };
    for (const speaker of speakers.values()) for (const key of ['lost', 'late', 'overflow', 'received']) stats[key] += speaker.queue.stats[key];
    postMessage({ type: 'stats', ...stats, speakers: speakers.size });
  }
}
onmessage = async ({ data: event }) => {
  try {
    if (event.type === 'init') {
      encoder = await createEncoder({ sampleRate: 48000, channels: 1, application: Application.Voip, signal: Signal.Voice, frameSize: 960, bitrate: 32000, complexity: 5, fec: true, packetLossPercent: 10 });
      lastTick = performance.now();
      clock = setInterval(tick, 20);
      postMessage({ type: 'ready' });
    } else if (event.type === 'configure') {
      endTransmission();
      mode = event.mode; pressed = false; muted = event.muted; outputMuted = event.outputMuted;
      canSend = event.canSend; codec = event.codec; threshold = event.threshold;
      if (outputMuted) resetSpeakers();
    } else if (event.type === 'ptt') { pressed = Boolean(event.pressed); if (!pressed) endTransmission(); }
    else if (event.type === 'volume') {
      if (!volumes.has(event.clientId) && volumes.size >= 128) volumes.delete(volumes.keys().next().value);
      const volume = Math.max(0, Math.min(2, Number(event.volume) || 0));
      volumes.set(event.clientId, volume);
      const speaker = speakers.get(event.clientId); if (speaker) speaker.volume = volume;
    }
    else if (event.type === 'packet') {
      if (++pendingPackets > 64) { pendingPackets--; postMessage({ type: 'packet_ack' }); return; }
      try { await receive(event.frame); } catch { rejected++; }
      finally { pendingPackets--; postMessage({ type: 'packet_ack' }); }
    } else if (event.type === 'capture') {
      try {
        if (!encoder || muted || outputMuted || !canSend || ![4, 5].includes(codec) || Date.now() - event.at > 100) { endTransmission(); return; }
        let energy = 0;
        for (const value of event.pcm) energy += value * value;
        const level = Math.sqrt(energy / event.pcm.length);
        if (level >= threshold) hangover = 10;
        const active = mode === 'ptt' ? pressed : hangover-- > 0;
        if (!active) { endTransmission(); return; }
        const packet = encoder.encodeFloat(event.pcm, { maxPacketBytes: 1275 });
        const frame = encodeVoice({ direction: 1, sequence: sequence++ & 65535, codec, data: packet });
        postMessage({ type: 'encoded', frame }, [frame.buffer]);
        status(true);
      } finally { postMessage({ type: 'capture_ack' }); }
    } else if (event.type === 'reset') { endTransmission(); resetSpeakers(); }
    else if (event.type === 'stop') { clearInterval(clock); endTransmission(); resetSpeakers(); encoder?.free(); close(); }
  } catch { postMessage({ type: 'error', code: 'audio_processing_failed' }); }
};
