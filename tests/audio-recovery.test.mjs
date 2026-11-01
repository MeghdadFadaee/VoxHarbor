import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioRecovery } from '../public/audio-recovery.mjs';
import { safeDiagnostic } from '../public/connection-diagnostics.mjs';
function fixture() {
  const recovery = new AudioRecovery(); const calls = [];
  const audio = { outputMuted: false, muted: false, context: { setSinkId: async id => calls.push(['output', id]) },
    listen: async enabled => calls.push(['listen', enabled]), microphone: async id => calls.push(['mic', id]), mute: () => calls.push(['mute']) };
  const options = { visible: true, create: () => audio, valid: () => true, output: 'speaker', microphone: 'input', resumeMicrophone: () => true, status: text => calls.push(['status', text]) };
  return { recovery, audio, options, calls };
}
test('recovery restores listening and selected devices but requires microphone opt-in', async () => {
  for (const optIn of [false, true]) {
    const f = fixture(); f.recovery.interrupted(f.audio, optIn, true);
    // Repeated disconnect callbacks during authentication must retain intent.
    f.recovery.interrupted(undefined, optIn, true);
    await f.recovery.restore(f.options);
    assert.ok(f.calls.some(([type]) => type === 'listen'));
    assert.ok(f.calls.some(([type, id]) => type === 'output' && id === 'speaker'));
    assert.equal(f.calls.some(([type]) => type === 'mic'), optIn);
    const count = f.calls.length; await f.recovery.restore(f.options); assert.equal(f.calls.length, count);
  }
});
test('muted audio, background pages, cancellation and revoked opt-in never resume microphone', async () => {
  for (const scenario of ['muted', 'hidden', 'clear', 'optout']) {
    const f = fixture(); if (scenario === 'muted') f.audio.muted = true;
    f.recovery.interrupted(f.audio, true, scenario !== 'hidden');
    if (scenario === 'clear') f.recovery.clear();
    if (scenario === 'optout') f.options.resumeMicrophone = () => false;
    await f.recovery.restore(f.options); assert.equal(f.calls.some(([type]) => type === 'mic'), false);
  }
  const f = fixture(); f.audio.outputMuted = true; f.recovery.interrupted(f.audio, true, true);
  await f.recovery.restore(f.options); assert.deepEqual(f.calls, []);
});
test('late listening completion cannot re-enable microphone after logout or a hidden page', async () => {
  const f = fixture(); let resolve;
  f.audio.listen = () => new Promise(done => { resolve = done; });
  f.recovery.interrupted(f.audio, true, true); const restoring = f.recovery.restore(f.options);
  f.recovery.clear(); resolve(); await restoring;
  assert.equal(f.calls.some(([type]) => type === 'mic'), false);
});
test('automatic audio failures leave microphone muted with an actionable status', async () => {
  const f = fixture(); f.audio.listen = async () => { throw new Error('browser blocked'); };
  f.recovery.interrupted(f.audio, true, true); await f.recovery.restore(f.options);
  assert.ok(f.calls.some(([type]) => type === 'mute')); assert.ok(f.calls.some(([type, text]) => type === 'status' && text.includes('could not resume')));
});
test('connection log excludes secrets and arbitrary payloads', () => {
  assert.deepEqual(safeDiagnostic({ type: 'transport_closed', closeCode: 1006, durationMs: 240000, receivedState: true,
    password: 'private', host: 'private.example', reason: 'private message', code: 'invalid secret@example.com', roundTripMs: -1,
    csrf: 'secret', participants: [{ name: 'private' }] }), { type: 'transport_closed', closeCode: 1006, durationMs: 240000, receivedState: true });
});
