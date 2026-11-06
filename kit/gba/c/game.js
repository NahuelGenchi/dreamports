// A game written in C, built to WebAssembly, on the JavaScript kit's page: it hands the game the player's copy, runs
// its frames with the buttons held, and draws them, while the page around it (the start screen, settings, touch
// controller, achievements and the proof tools' part, proof.js) stays the JavaScript kit's. What it gives back is what
// a JavaScript game's page has: `video`, the video hardware as video.js's (its VRAM, colours, OAM and registers, which
// the proof tools compare with the original's) with `drawFrame`, `step(keys)`, the game's frame, and `sound`.
//
// The game's sound (sound.c) plays as the JavaScript kit's does (sound/audio.js). For a player, the game hands its calls
// over after each frame, and a second copy of the same WebAssembly plays them on an audio thread of its own
// (worklet.js), keeping its own time. For the proof tools it plays on the page, a frame of it after each of the game's
// frames, as the console mixes it: 65,536 samples a second, in the console's 10-bit steps, without the gain and the
// filter the speakers get.

import { proof } from '../proof.js';
import { cartridgeSave } from '../save.js';

const GAIN = 0.5;   // the GBA's full scale is loud next to other pages; half of it leaves headroom
const PROOF_RATE = 65536;   // the rate the console mixes its sound at once the sound library has started
const CALL_WORDS = 5;

/**
 * Loads the game's WebAssembly from `url` and starts it with `rom` (rom/rom.js), its save memory kept in the browser
 * under `save` (save.js), and the words of the page's address in `query`, which gba_start_point reads (a recording's
 * start point under the proof tools, such as ?proof&unlocked=1), and returns { video, step(keys) }.
 */
export async function loadGame(url, rom, { save = null, query = globalThis.location?.search ?? '' } = {}) {
  // the proof tools play a game as a player who has never saved, as JavaScript games do
  const kept = save ? cartridgeSave(save, proof ? null : undefined) : null;
  let memory = null;
  const imports = {
    dreamports: {
      save_read(at, size) {
        const bytes = kept?.read();
        if (bytes) new Uint8Array(memory.buffer, at, size).set(bytes.subarray(0, size));
      },
      save_write(at, size) { kept?.write(new Uint8Array(memory.buffer, at, size).slice()); },
    },
  };
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The game's code isn't there (${response.status}).`);
  const code = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(code, imports);
  const game = instance.exports;
  memory = game.memory;

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

  // room for the copy first, as making it can grow the memory, which leaves an earlier view of it empty
  const at = game.dp_rom(rom.size);
  new Uint8Array(memory.buffer, at, rom.size).set(rom.bytes);
  const words = new TextEncoder().encode(query);
  new Uint8Array(memory.buffer, game.dp_start_point(words.length), words.length).set(words);
  const sound = createSound(game, code, rom);
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
  return { video, sound, step: keys => { game.dp_step(keys); sound.frameDone(); } };
}

// The game's sound: on the page for the proof tools, or handed over to the audio thread. Browsers keep audio paused
// until the page has been interacted with; choosing the copy counts, and any later key press or tap resumes it too.
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
  let ctx = null, node = null, muted = false, held = false;
  const waiting = [];
  const post = message => (node ? node.port.postMessage(message) : waiting.push(message));
  const resume = () => { if (ctx?.state === 'suspended' && !held) ctx.resume().catch(() => {}); };
  const calls = () => {
    const count = game.dp_sound_taken_count();
    return count ? Array.from(new Int32Array(memory(), game.dp_sound_taken(), count * CALL_WORDS)) : null;
  };
  async function start() {
    const c = new AudioContext({ latencyHint: 'interactive' });
    ctx = c;
    await c.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    node = new AudioWorkletNode(c, 'gba-c-sound', { numberOfInputs: 0, outputChannelCount: [2] });
    node.connect(c.destination);
    node.port.onmessage = ({ data }) => { if (data.type === 'error') console.warn('No sound:', data.message); };
    node.port.postMessage({ type: 'start', code, rom: rom.bytes.slice().buffer, gain: muted ? 0 : GAIN });
    for (const message of waiting.splice(0)) node.port.postMessage(message);
    resume();
  }
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);
  return {
    /** Once the game has started: its sound starts too, if it has any and the browser plays sound. */
    started() {
      const first = calls();
      if (!game.dp_sound_running() || !globalThis.AudioWorkletNode) return;
      if (first) post({ type: 'calls', calls: first });
      start().catch(err => console.warn('No sound:', err));
    },
    /** After each of the game's frames: the calls it made go to the audio thread. */
    frameDone() {
      const made = calls();
      if (made && game.dp_sound_running()) post({ type: 'calls', calls: made });
    },
    get muted() { return muted; },
    set muted(value) { muted = value; post({ type: 'gain', value: muted ? 0 : GAIN }); },
    /** Stops the sound where it is while the game is held (its settings are open), and goes on with it after */
    get held() { return held; },
    set held(value) {
      if (value === held) return;
      held = value;
      if (held) ctx?.suspend().catch(() => {}); else resume();
    },
  };
}
