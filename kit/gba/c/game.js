// A game written in C, built to WebAssembly, on the JavaScript kit's page: it hands the game the player's copy, runs
// its frames with the buttons held, and draws them, while the page around it (the start screen, settings, touch
// controller, achievements and the proof tools' part, proof.js) stays the JavaScript kit's. Loading the game and its
// audio thread are what every console's kit in C shares (kit/c/game.js). What it gives back is what a JavaScript game's
// page has: `video`, the video hardware as video.js's (its VRAM, colours, OAM and registers, which the proof tools
// compare with the original's) with `drawFrame`, `step(keys)`, the game's frame, and `sound`, and `game`, what its
// WebAssembly exports, for what is the game's own, such as a link cable between several GBAs on one page.
//
// The game's sound (sound.c) plays as the JavaScript kit's does (sound/audio.js). For a player, the game hands its calls
// over after each frame, and a second copy of the same WebAssembly plays them on an audio thread of its own
// (worklet.js), keeping its own time. For the proof tools it plays on the page, a frame of it after each of the game's
// frames, as the console mixes it: 65,536 samples a second, in the console's 10-bit steps, without the gain and the
// filter the speakers get.

import { proof } from '../proof.js';
import { createAudio, openGame } from '../../c/game.js';

const PROOF_RATE = 65536;   // the rate the console mixes its sound at once the sound library has started
const CALL_WORDS = 5;

/**
 * Loads the game's WebAssembly from `url` and starts it with `rom` (rom/rom.js), its save memory kept in the browser
 * under `save` (save.js), and the words of the page's address in `query`, which gba_start_point reads (a recording's
 * start point under the proof tools, such as ?proof&unlocked=1), and returns { video, step(keys) }. With `heard` false the
 * game plays no sound, as each GBA after the first of a page with several does: only the first one's is heard.
 */
export async function loadGame(url, rom, { save = null, query = globalThis.location?.search ?? '', heard = true } = {}) {
  const { game, code } = await openGame(url, rom.bytes, { save, query });
  const memory = game.memory;

  // the views onto the game's memory, made again whenever it grows, which leaves the old ones empty
  let views = null;
  const view = () => {
    if (views?.buffer !== memory.buffer) {
      const buffer = memory.buffer;
      views = {
        buffer,
        vram: new Uint8Array(buffer, game.dp_vram(), 0x18000),
        pal: new Uint16Array(buffer, game.dp_pal(), 512),
        oam: new Uint16Array(buffer, game.dp_oam(), 512),
        io: new Uint16Array(buffer, game.dp_io(), 0x58 >> 1),
      };
    }
    return views;
  };

  const sound = heard ? createSound(game, code, rom) : SILENT;
  game.dp_start();
  sound.started();

  const video = {
    get vram() { return view().vram; },
    get pal() { return view().pal; },
    get oam() { return view().oam; },
    get io() { return view().io; },
    underlay: null,
    /** Draws the frame into `out`, 240 × 160 words as an ImageData holds them. */
    drawFrame(out) {
      out.set(new Uint32Array(memory.buffer, game.dp_draw(), out.length));
      // with ?proof, what prove compares with the original's (proof.js)
      if (globalThis.dreamportsProof) dreamportsProof.video = video;
    },
  };
  // `next`, when given, is what the frame's V-blank finds held (input.js nextGbaKeys), for gba_vblank_keys
  return { game, video, sound, step: (keys, next) => { if (next !== undefined) game.dp_vblank_keys(next); game.dp_step(keys); sound.frameDone(); } };
}

// a game that plays no sound: its calls stay with it, and nothing hears them
const SILENT = { started() {}, frameDone() {}, muted: false, held: false };

// The game's sound: on the page for the proof tools, or handed over to the audio thread.
function createSound(game, code, rom) {
  const memory = () => game.memory.buffer;
  if (proof?.mode === 'play') {
    game.dp_sound_output(PROOF_RATE, 1);
    const max = game.dp_sound_render_max();
    return {
      started() {
        if (!game.dp_sound_running()) return;
        proof.listen((left, right) => {
          const at = game.dp_sound_render(left.length) >> 2, samples = new Float32Array(memory());
          left.set(samples.subarray(at, at + left.length));
          right.set(samples.subarray(at + max, at + max + right.length));
        }, PROOF_RATE);
      },
      frameDone() {},
      muted: false, held: false,
    };
  }

  game.dp_sound_hand_over(1);
  const audio = createAudio({ module: new URL('./worklet.js', import.meta.url), processor: 'gba-c-sound', first: gain => ({ type: 'start', code, rom: rom.bytes.slice().buffer, gain }) });
  const calls = () => {
    const count = game.dp_sound_taken_count();
    return count ? Array.from(new Int32Array(memory(), game.dp_sound_taken(), count * CALL_WORDS)) : null;
  };
  return {
    /** Once the game has started: its sound starts too, if it has any and the browser plays sound. */
    started() {
      const first = calls();
      if (!game.dp_sound_running() || !globalThis.AudioWorkletNode) return;
      if (first) audio.post({ type: 'calls', calls: first });
      audio.open();
    },
    /** After each of the game's frames: the calls it made go to the audio thread. */
    frameDone() {
      const made = calls();
      if (made && game.dp_sound_running()) audio.post({ type: 'calls', calls: made });
    },
    get muted() { return audio.muted; },
    set muted(value) { audio.muted = value; },
    /** Stops the sound where it is while the game is held (its settings are open), and goes on with it after */
    get held() { return audio.held; },
    set held(value) { audio.held = value; },
  };
}
