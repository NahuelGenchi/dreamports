// The sound engine on the audio thread (the kit's sound/processor.js), with the game's own: the stage's music
// manager runs each frame's calls (music.js), the optional Sonic Rush boost's sound effects play on their own DS
// engine and clock (nitro.js), and the optional Boost Mode's on a second GBA engine reading the Sonic Advance 2
// ROM, each added to the Sonic Advance one's output.

import { GbaSoundProcessor } from '../../../../kit/gba/sound/processor.js';
import { createSynth } from '../../../../kit/gba/sound/synth.js';
import { createMusicManager } from './music.js';
import { createNitro } from './nitro.js';

class SonicAdvanceSound extends GbaSoundProcessor {
  constructor() {
    super();
    this.rush = null;
    this.sa2 = null;
    this.mixL = this.mixR = null;
  }

  manager(engine) { return createMusicManager(engine); }

  message(data) {
    if (data.type === 'rush') this.rush = createNitro(data.sound, sampleRate);
    else if (data.type === 'rushSe') this.rush?.startSeqArc(...data.se);
    else if (data.type === 'sa2') this.sa2 = createSynth(new Uint8Array(data.rom), data.layout, sampleRate);
    else if (data.type === 'sa2Call') this.sa2?.call(data.name, ...data.args);
    else super.message(data);
  }

  mix(left, right) {
    if (this.rush) this.rush.render(left, right, this.gain);
    if (this.sa2) {
      if (this.mixL?.length !== left.length) { this.mixL = new Float32Array(left.length); this.mixR = new Float32Array(left.length); }
      this.sa2.render(this.mixL, this.mixR, this.gain);
      for (let j = 0; j < left.length; j++) { left[j] += this.mixL[j]; right[j] += this.mixR[j]; }
    }
  }
}

registerProcessor('gba-sound', SonicAdvanceSound);
