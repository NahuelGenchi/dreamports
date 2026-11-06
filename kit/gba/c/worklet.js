// The sound of a game in C on its own audio thread (game.js): a second copy of the game's WebAssembly, of which only the
// sound runs (sound.c). It gets the player's copy, then the calls the game makes, after each of its frames, and keeps its
// own GBA frame clock from the output's sample count, so the music keeps time even when the page's frames stall.

const CALL_WORDS = 5;

class GbaCSound extends AudioWorkletProcessor {
  constructor() {
    super();
    this.game = null;
    // what goes wrong here can't reach the page's console on its own, so it is sent back for game.js to show
    this.port.onmessage = ({ data }) => {
      try { this.message(data); } catch (err) { this.game = null; this.port.postMessage({ type: 'error', message: String(err?.stack ?? err) }); }
    };
  }

  message(data) {
    if (data.type === 'start') {
      // the module is small enough to make at once, which an audio thread allows
      const nothing = () => {};
      const { exports } = new WebAssembly.Instance(new WebAssembly.Module(data.code), { dreamports: { save_read: nothing, save_write: nothing } });
      const rom = new Uint8Array(data.rom), at = exports.dp_rom(rom.length);
      new Uint8Array(exports.memory.buffer, at, rom.length).set(rom);
      exports.dp_sound_output(sampleRate, 0);
      exports.dp_sound_gain(data.gain);
      this.game = exports;
      this.max = exports.dp_sound_render_max();
    } else if (data.type === 'calls') {
      const calls = data.calls;
      for (let i = 0; i + CALL_WORDS <= calls.length; i += CALL_WORDS) this.game?.dp_sound_call(calls[i], calls[i + 1], calls[i + 2], calls[i + 3], calls[i + 4]);
    } else if (data.type === 'gain') this.game?.dp_sound_gain(data.value);
  }

  process(inputs, outputs) {
    const [left, right] = outputs[0], game = this.game;
    if (!game) return true;
    const at = game.dp_sound_render(left.length) >> 2;
    // a view onto the copy's memory, made again only if it grows, as the audio thread makes nothing new as it plays
    if (this.samples?.buffer !== game.memory.buffer) this.samples = new Float32Array(game.memory.buffer);
    const samples = this.samples;
    left.set(samples.subarray(at, at + left.length));
    right.set(samples.subarray(at + this.max, at + this.max + right.length));
    return true;
  }
}

registerProcessor('gba-c-sound', GbaCSound);
