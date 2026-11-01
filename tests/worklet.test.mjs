import test from 'node:test';
import assert from 'node:assert/strict';
const processors = new Map();
// Processor logic only. This does not simulate browser audio scheduling or permissions.
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { sent: [], postMessage(message) { this.sent.push(message); } }; }
};
globalThis.registerProcessor = (name, processor) => processors.set(name, processor);
globalThis.currentTime = 3;
await import('../public/voice-worklet.mjs');

test('capture worklet is muted by default and bounds outstanding frames with capture timestamps', () => {
  const Capture = processors.get('vox-capture'); const capture = new Capture();
  const inputs = [[new Float32Array(960).fill(0.1)]];
  capture.process(inputs); assert.equal(capture.port.sent.length, 0);
  capture.port.onmessage({ data: { type: 'enabled', value: true } });
  for (let i = 0; i < 100; i++) capture.process(inputs);
  assert.equal(capture.port.sent.length, 2); assert.equal(capture.pending, 2);
  assert.equal(capture.port.sent[0].pcm.length, 960); assert.equal(capture.port.sent[0].at, 3);
  capture.port.onmessage({ data: { type: 'ack' } }); capture.process(inputs);
  assert.equal(capture.port.sent.length, 3);
  capture.port.onmessage({ data: { type: 'enabled', value: false } }); capture.process(inputs);
  assert.equal(capture.port.sent.length, 3);
});

test('playback worklet drops stale backlog at the queue cap and clears on mute', () => {
  const Playback = processors.get('vox-playback'); const playback = new Playback();
  for (let i = 1; i <= 5; i++) playback.port.onmessage({ data: { pcm: new Float32Array(1920).fill(i / 10) } });
  assert.equal(playback.frames.length, 1);
  const output = [[new Float32Array(128), new Float32Array(128)]];
  playback.process([], output); assert.equal(output[0][0][0], 0.5); assert.equal(output[0][1][0], 0.5);
  playback.port.onmessage({ data: { type: 'clear' } });
  assert.equal(playback.frames.length, 0); assert.equal(playback.offset, 0);
  const silent = [[new Float32Array(128), new Float32Array(128)]];
  playback.process([], silent); assert.ok(silent[0].every(channel => channel.every(sample => sample === 0)));
});

