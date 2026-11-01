import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncoder, createDecoder, getPacketInfo, Application } from 'libopus-wasm';
import { encodeVoice, decodeVoice } from '../public/voice-frame.mjs';
import { JitterBuffer } from '../public/jitter-buffer.mjs';
import { Worker } from 'node:worker_threads';

test('voice frame rejects malformed, oversized, spoofed and reverse-direction input', () => {
  const bytes = encodeVoice({ direction: 1, sequence: 65535, data: new Uint8Array([1, 2, 3]) });
  assert.equal(decodeVoice(bytes, 1).sequence, 65535);
  for (const index of [0, 1, 2, 6, 7]) {
    const invalid = bytes.slice(); invalid[index] = 255;
    assert.throws(() => decodeVoice(invalid, 1));
  }
  assert.throws(() => decodeVoice(bytes, 2));
  assert.throws(() => decodeVoice(new Uint8Array(1284), 1));
  assert.throws(() => decodeVoice(new Uint8Array(7), 1));
  assert.equal(decodeVoice(encodeVoice({ direction: 2, clientId: 42, data: new Uint8Array() }), 2).end, true);
});

test('jitter buffer orders wrapped sequences, discards duplicates and late packets', () => {
  const queue = new JitterBuffer({ prebuffer: 0 });
  for (const sequence of [65534, 0, 65535, 1, 1]) queue.push({ sequence });
  assert.deepEqual(Array.from({ length: 4 }, () => queue.pull().packet.sequence), [65534, 65535, 0, 1]);
  assert.equal(queue.stats.duplicate, 1);
  queue.push({ sequence: 0 });
  assert.equal(queue.stats.late, 1);
});

test('jitter buffer supplies following packet for FEC, bounds backlog and ends dead speakers', () => {
  const queue = new JitterBuffer({ prebuffer: 0 });
  queue.push({ sequence: 8 }); queue.push({ sequence: 10 });
  assert.equal(queue.pull().type, 'packet');
  const gap = queue.pull(); assert.equal(gap.type, 'loss'); assert.equal(gap.next.sequence, 10);
  assert.equal(queue.pull().packet.sequence, 10);
  queue.push({ sequence: 200 });
  assert.equal(queue.packets.size, 1); assert.equal(queue.stats.overflow, 1);
  assert.equal(queue.pull().packet.sequence, 200);
  assert.deepEqual([queue.pull().type, queue.pull().type, queue.pull().type, queue.pull().type], ['loss', 'loss', 'end', 'idle']);
  for (let sequence = 300; sequence < 1000; sequence++) queue.push({ sequence });
  assert.ok(queue.packets.size <= 12);
});

test('real Opus encodes 20 ms PCM, independently decodes speakers and conceals packet loss', async () => {
  const encoder = await createEncoder({ sampleRate: 48000, channels: 1, application: Application.Voip, frameSize: 960, fec: true, packetLossPercent: 15 });
  const decoders = await Promise.all(Array.from({ length: 4 }, () => createDecoder({ sampleRate: 48000, channels: 2, maxFrameSize: 960 })));
  try {
    let energy = 0;
    for (let frame = 0; frame < 30; frame++) {
      const pcm = Float32Array.from({ length: 960 }, (_, i) => Math.sin((frame * 960 + i) * 2 * Math.PI * 440 / 48000) * 0.15);
      const packet = encoder.encodeFloat(pcm, { maxPacketBytes: 1275 });
      assert.equal((await getPacketInfo(packet, { sampleRate: 48000 })).samples, 960);
      for (const decoder of decoders) {
        const result = frame === 10 ? decoder.decodePacketLossFloat(960) : decoder.decodeFloat(packet, { maxFrameSize: 960 });
        assert.equal(result.length, 1920);
        for (const sample of result) { assert.ok(Number.isFinite(sample)); energy += sample * sample; }
      }
    }
    assert.ok(energy > 100, 'Decoded tone must contain actual signal');
  } finally { encoder.free(); decoders.forEach(decoder => decoder.free()); }
});

test('application worker mixes speakers and enforces PTT, voice activation, mute and permission gates', async t => {
  const worker = new Worker(new URL('./fixtures/audio-worker-node.mjs', import.meta.url));
  t.after(() => worker.terminate());
  let encoded = 0; let energy = 0; let acknowledged = 0; const speakers = new Set(); const errors = [];
  let ready;
  const initialized = new Promise(resolve => { ready = resolve; });
  worker.on('error', error => errors.push(error.message));
  worker.on('message', event => {
    if (event.type === 'ready') ready();
    else if (event.type === 'error') errors.push(event.code);
    else if (event.type === 'packet_ack') acknowledged++;
    else if (event.type === 'encoded') {
      const packet = decodeVoice(event.frame, 1);
      if (packet.end) return;
      encoded++;
      for (const clientId of [40, 41, 42]) {
        if (clientId === 42 && encoded % 11 === 0) continue;
        const frame = encodeVoice({ direction: 2, clientId, sequence: (65520 + encoded) & 65535, data: packet.data });
        worker.postMessage({ type: 'packet', frame: frame.buffer }, [frame.buffer]);
      }
    } else if (event.type === 'pcm') {
      for (const value of event.pcm) { assert.ok(Number.isFinite(value) && Math.abs(value) <= 1); energy += value * value; }
    } else if (event.type === 'speaking') event.ids.forEach(id => speakers.add(id));
  });
  worker.postMessage({ type: 'init' });
  await Promise.race([initialized, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Worker initialization timed out')), 5000); timer.unref(); })]);
  worker.postMessage({ type: 'configure', mode: 'ptt', muted: false, outputMuted: false, canSend: true, codec: 4, threshold: 0.025 });
  worker.postMessage({ type: 'ptt', pressed: true });
  // A malformed server packet must be dropped, without breaking other speakers.
  worker.postMessage({ type: 'packet', frame: new Uint8Array([1, 2]).buffer });
  for (let frame = 0; frame < 45; frame++) {
    const pcm = Float32Array.from({ length: 960 }, (_, i) => 0.1 * Math.sin((frame * 960 + i) * 2 * Math.PI * 440 / 48000));
    worker.postMessage({ type: 'capture', pcm, at: Date.now() }, [pcm.buffer]);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  worker.postMessage({ type: 'ptt', pressed: false });
  await new Promise(resolve => setTimeout(resolve, 100));
  const before = encoded;
  worker.postMessage({ type: 'capture', pcm: new Float32Array(960).fill(0.1), at: Date.now() });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(encoded, before, 'PTT release must stop transmission');
  const configure = overrides => worker.postMessage({ type: 'configure', mode: 'vad', muted: false, outputMuted: false, canSend: true, codec: 4, threshold: 0.025, ...overrides });
  const capture = async amplitude => {
    worker.postMessage({ type: 'capture', pcm: new Float32Array(960).fill(amplitude), at: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 40));
  };
  configure({}); await capture(0); assert.equal(encoded, before, 'VAD silence must not transmit');
  await capture(0.1); assert.equal(encoded, before + 1, 'VAD above threshold must transmit');
  for (const gate of [{ muted: true }, { outputMuted: true }, { canSend: false }, { codec: 3 }]) {
    configure(gate); const count = encoded; await capture(0.1);
    assert.equal(encoded, count, 'Mute, output, permission and codec gates must each stop transmission');
  }
  assert.ok(encoded > 30); assert.ok(energy > 50); assert.ok(acknowledged > 70);
  assert.deepEqual([...speakers].sort(), [40, 41, 42]); assert.deepEqual(errors, []);
});
