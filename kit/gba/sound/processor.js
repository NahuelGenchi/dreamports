// The sound engine on the audio thread: it keeps its own GBA frame clock from the output's sample count, so
// the music keeps time even when the page's frames stall. Messages from the page queue engine calls for the
// start of the next sound frame, as a game call made during one frame is sequenced on the next. A multiplayer
// game on one page runs one engine per GBA (`count`), added together, with the music heard from the first one
// only.
//
// A game with sounds of its own, such as an extra's, makes its own processor from this one in its own worklet
// module and registers it as 'gba-sound': it handles its own messages in message() and passes the rest on, adds
// its sounds to the output in mix(), and can give the engine its music manager in manager() (synth.js).
//
// For the proof tools (audio.js) it runs on the page instead, and is told `raw`: it then makes the mix as the console
// does, at full scale and without the coupling capacitor, so each sample is the console's own level.

import { createSynth } from './synth.js';

export class GbaSoundProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synths = [];
    this.gain = 1;
    this.raw = false;
    this.port.onmessage = ({ data }) => this.message(data);
  }

  /** Handles a message from the page (audio.js). */
  message(data) {
    if (data.type === 'rom') {
      const rom = new Uint8Array(data.rom);
      this.synths = Array.from({ length: data.count ?? 1 }, (_, i) => {
        const synth = createSynth(rom, data.layout, sampleRate, this.manager);
        synth.engine.muted.music = i > 0;
        return synth;
      });
    } else if (data.type === 'call') this.synths[data.gba ?? 0]?.call(data.name, ...data.args);
    else if (data.type === 'gain') this.gain = this.raw ? 1 : data.value;
    else if (data.type === 'raw') { this.raw = true; this.gain = 1; }
  }

  /** Adds the game's own sounds to the output, after the GBAs'. */
  mix(left, right) {}

  process(inputs, outputs) {
    const [left, right] = outputs[0];
    if (this.synths.length === 1) this.synths[0].render(left, right, this.gain, !this.raw);
    else if (this.synths.length > 1) {
      if (this.l?.length !== left.length) { this.l = new Float32Array(left.length); this.r = new Float32Array(right.length); }
      const l = this.l, r = this.r;
      left.fill(0); right.fill(0);
      for (const synth of this.synths) {
        synth.render(l, r, this.gain, !this.raw);
        for (let i = 0; i < left.length; i++) { left[i] += l[i]; right[i] += r[i]; }
      }
    }
    this.mix(left, right);
    return true;
  }
}
