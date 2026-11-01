import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAudio } from '../public/voice.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
}

test('disconnect during worklet initialization cannot resurrect listening', async t => {
  const loading = deferred(); let closed = 0; const commands = [];
  globals(t, { AudioContext: class {
    sampleRate = 48000; state = 'running'; audioWorklet = { addModule: () => loading.promise };
    async close() { closed++; }
  } });
  const audio = new VoiceAudio(command => commands.push(command), () => {});
  const pending = audio.listen(true); audio.stop(); loading.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(closed, 1); assert.equal(audio.outputMuted, true); assert.equal(audio.muted, true); assert.equal(commands.length, 0);
});

test('disconnect cancels pending codec initialization and terminates its worker', async t => {
  let terminated = 0; const commands = [];
  globals(t, {
    AudioContext: class { sampleRate = 48000; state = 'running'; audioWorklet = { addModule: async () => {} }; destination = {}; async close() {} },
    AudioWorkletNode: class { port = { postMessage() {} }; connect() {} disconnect() {} },
    Worker: class { postMessage() {} terminate() { terminated++; } },
  });
  const audio = new VoiceAudio(command => commands.push(command), () => {});
  const pending = audio.listen(true); await settle(); audio.stop();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(terminated, 1); assert.equal(audio.worker, null); assert.equal(audio.context, null); assert.equal(commands.length, 0);
});

test('disconnect during AudioContext resume cannot enable output afterward', async () => {
  const resume = deferred(); const audio = new VoiceAudio(() => assert.fail('Ended audio must not send control'), () => {});
  audio.context = { resume: () => resume.promise, close: async () => {} };
  const pending = audio.listen(true); audio.stop(); resume.resolve();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(audio.outputMuted, true);
});

for (const action of ['mute', 'stop']) test(`pending microphone permission is canceled by ${action}`, async t => {
  const permission = deferred(); let stopped = 0; const commands = [];
  globals(t, { navigator: { mediaDevices: { getUserMedia: () => permission.promise } } });
  const audio = new VoiceAudio(command => commands.push(command), () => {}); audio.outputMuted = false;
  const pending = audio.microphone(); audio[action]();
  permission.resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(audio.muted, true); assert.equal(audio.stream, undefined);
  assert.equal(commands.some(command => command.inputMuted === false), false);
});

test('a disposed audio instance cannot deliver delayed worker errors to the new connection', () => {
  const audio = new VoiceAudio(() => {}, () => {}); let events = 0;
  audio.addEventListener('error', () => events++); audio.stop(); audio.event('error', 'late failure'); assert.equal(events, 0);
});

test('ending active audio deafens and mutes the native connection once', () => {
  const commands = []; const audio = new VoiceAudio(command => commands.push(command), () => {});
  audio.outputMuted = false; audio.muted = false; audio.stop(); audio.stop();
  assert.deepEqual(commands, [{ type: 'audio_state', inputMuted: true, outputMuted: true }]);
});

test('a participant muted before listening stays at zero volume after codec startup', async t => {
  const messages = [];
  globals(t, {
    AudioContext: class { sampleRate = 48000; state = 'running'; audioWorklet = { addModule: async () => {} }; destination = {}; async resume() {} async close() {} },
    AudioWorkletNode: class { port = { postMessage() {} }; connect() {} disconnect() {} },
    Worker: class { postMessage(message) { messages.push(message); if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); } terminate() {} },
  });
  const audio = new VoiceAudio(() => {}, () => {}); audio.volume(42, 0);
  await audio.listen(true);
  assert.ok(messages.some(message => message.type === 'volume' && message.clientId === 42 && message.volume === 0));
  audio.stop();
});

test('concurrent listening requests share initialization and cannot bypass codec readiness', async t => {
  const loading = deferred(); let workers = 0; let contexts = 0; let complete = false;
  globals(t, {
    AudioContext: class { constructor() { contexts++; } sampleRate = 48000; state = 'running'; audioWorklet = { addModule: () => loading.promise }; destination = {}; async resume() {} async close() {} },
    AudioWorkletNode: class { port = { postMessage() {} }; connect() {} disconnect() {} },
    Worker: class { constructor() { workers++; } postMessage(message) { if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); } terminate() {} },
  });
  const audio = new VoiceAudio(() => {}, () => {});
  const first = audio.listen(true); const second = audio.listen(true).then(() => { complete = true; });
  await settle(); assert.equal(complete, false); assert.equal(audio.outputMuted, true); assert.equal(workers, 0);
  loading.resolve(); await Promise.all([first, second]);
  assert.equal(contexts, 1); assert.equal(workers, 1); assert.equal(audio.outputMuted, false); audio.stop();
});
