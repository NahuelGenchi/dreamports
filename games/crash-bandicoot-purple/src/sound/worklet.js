// The game's sound on the audio thread, or on the page for the proof tools (the kit's sound/audio.js): its own engine,
// GAX (gax.js), which it runs in place of the kit's, on the player's copy.

import { GbaSoundProcessor } from '../../../../kit/gba/sound/processor.js';
import { createGax } from './gax.js';

class CrashPurpleSound extends GbaSoundProcessor {
  constructor() {
    super();
    this.gax = null;
  }

  message(data) {
    if (data.type === 'rom') this.gax = createGax(new Uint8Array(data.rom), sampleRate);
    else if (data.type === 'call') this.gax?.call(data.name, ...data.args);
    else super.message(data);
  }

  process(inputs, outputs) {
    const [left, right] = outputs[0];
    this.gax?.render(left, right, this.gain);
    return true;
  }
}

registerProcessor('gba-sound', CrashPurpleSound);
