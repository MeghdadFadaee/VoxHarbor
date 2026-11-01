// Choices live only in this signed-in page, never in shared browser storage.
export class AudioRecovery {
  constructor() { this.clear(); }
  clear() { this.pending = undefined; this.generation = (this.generation || 0) + 1; }
  interrupted(audio, resumeMicrophone, visible) {
    if (!audio) return;
    this.pending = !audio.outputMuted ? { microphone: !audio.muted && resumeMicrophone && visible } : undefined;
  }
  async restore({ visible, create, valid, output = '', microphone = '', resumeMicrophone, status }) {
    const choice = this.pending; this.pending = undefined;
    if (!choice || !visible) return;
    const generation = this.generation;
    const active = create();
    this.restoring = active;
    const current = () => generation === this.generation && valid(active);
    try {
      await active.listen(true);
      if (!current()) return;
      if (output && typeof active.context?.setSinkId === 'function') await active.context.setSinkId(output);
      if (!current()) return;
      if (choice.microphone && resumeMicrophone()) await active.microphone(microphone);
      if (current()) status(choice.microphone && !active.muted ? 'Listening and microphone resumed after reconnect.' : 'Listening resumed. Microphone remains off.');
    } catch {
      if (current()) { active.mute(); status('Audio could not resume automatically. Enable listening and the microphone to retry.'); }
    } finally {
      if (this.restoring === active) this.restoring = undefined;
    }
  }
}
