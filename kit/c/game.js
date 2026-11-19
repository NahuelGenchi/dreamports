// A game written in C, built to WebAssembly, on the page every console's games share (kit/gba/'s start screen,
// settings, touch controller and the proof tools' part, proof.js). What every console's kit in C shares is here:
// `openGame` loads the game's WebAssembly and hands it the player's copy, the save memory the browser kept and the words
// of the page's address, and `createAudio` plays sound on an audio thread of its own. A console with a kit in C of its
// own builds on them, as the Game Boy Advance's does (kit/gba/c/game.js). `loadGame` runs a game on a console with no
// kit in C of its own: it draws its own picture at its own size, and makes its own sound at the console's rate
// (kit/c/console.c), and the page gets `step(buttons)`, `draw()` and `sound`, as a JavaScript game on such a console
// has `step()`, `draw(pixels)` and `size` (tools/libretro/new-game/main.js.template).

import { proof } from '../gba/proof.js';
import { soundContext } from '../gba/ui/host.js';
import { cartridgeSave, proofStorage } from '../gba/save.js';
import { CONSOLES } from '../consoles.js';

/** How loud a game's sound plays: a console's full scale is loud next to other pages, and half of it leaves headroom. */
export const GAIN = 0.5;

/**
 * Loads the game's WebAssembly from `url` and gives it the player's copy, `bytes`, its save memory kept in the browser
 * under `save` (save.js), and the words of the page's address in `query`, which kit_start_point reads (a recording's
 * start point under the proof tools, such as ?proof&unlocked=1). A disc is given as `disc` instead (kit/copy/disc.js),
 * read a few sectors at a time as the game asks for them (discOf). It returns { game, code }: the module's exports,
 * which the console's kit starts with game.dp_start(), and its code, for a second copy on an audio thread.
 */
export async function openGame(url, bytes, { save = null, query = globalThis.location?.search ?? '', disc = null } = {}) {
  // the proof tools play a game as a player who has never saved, as JavaScript games do, but for a player's report,
  // which starts from the save it carries
  const kept = save ? cartridgeSave(save, proof ? proofStorage() : undefined) : null;
  let memory = null;
  const imports = {
    // a function of the original a game made a function at a time calls and has no C for yet: the game stops there
    env: new Proxy({}, { get: (_, name) => () => { throw new Error(`The game called ${String(name)}, which has no code in it yet.`); } }),
    dreamports: {
      save_read(at, size) {
        const saved = kept?.read();
        if (saved) new Uint8Array(memory.buffer, at, size).set(saved.subarray(0, size));
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
  // room for the copy first, as making it can grow the memory, which leaves an earlier view of it empty
  if (bytes) {
    const at = game.dp_rom(bytes.length);
    new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
  }
  if (disc) {
    if (!game.dp_disc) throw new Error("This console's kit in C reads no disc.");
    game.dp_disc(disc.kind === 'cd' ? 1 : 2, disc.sectors, disc.layerBreak);
    for (const t of disc.tracks) game.dp_disc_track(t.number, TRACK_TYPES[t.type], t.first, t.pregap, t.sectors);
  }
  const words = new TextEncoder().encode(query);
  new Uint8Array(memory.buffer, game.dp_start_point(words.length), words.length).set(words);
  return { game, code };
}

/**
 * Sound on an audio thread of its own: the worklet `module`'s `processor`, at `sampleRate` (or the browser's own), whose
 * first message is `first(gain)`. Browsers keep audio paused until the page has been interacted with; choosing the copy
 * counts, and any later key press or tap resumes it too. It returns { open(), post(message, transfer), muted, held }:
 * `open` starts it, `post` sends the audio thread a message, held until it's there, and `held` stops the sound where it
 * is while the game is held (its settings are open).
 */
export function createAudio({ module, processor, sampleRate = 0, first }) {
  let ctx = null, node = null, muted = false, held = false;
  const waiting = [];
  const post = (message, transfer = []) => (node ? node.port.postMessage(message, transfer) : waiting.push([message, transfer]));
  const resume = () => { if (ctx?.state === 'suspended' && !held) ctx.resume().catch(() => {}); };
  async function open() {
    // at another rate than asked, the browser's own or the launcher's, the worklet keeps up
    const { context: c, Node } = soundContext(sampleRate);
    ctx = c;
    await c.audioWorklet.addModule(module);
    node = new Node(c, processor, { numberOfInputs: 0, outputChannelCount: [2] });
    node.connect(c.destination);
    node.port.onmessage = ({ data }) => { if (data.type === 'error') console.warn('No sound:', data.message); };
    node.port.postMessage(first(muted ? 0 : GAIN));
    for (const [message, transfer] of waiting.splice(0)) node.port.postMessage(message, transfer);
    resume();
  }
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);
  return {
    open() { open().catch(err => console.warn('No sound:', err)); },
    post,
    get muted() { return muted; },
    set muted(value) { muted = value; post({ type: 'gain', value: muted ? 0 : GAIN }); },
    get held() { return held; },
    set held(value) {
      if (value === held) return;
      held = value;
      if (held) ctx?.suspend().catch(() => {}); else resume();
    },
  };
}

// a track's kind as kit/c/disc.h numbers it
const TRACK_TYPES = { audio: 0, mode1: 1, mode2: 2 };

/**
 * The disc's side of a game in C (kit/c/disc.c): `serve()` gives the game the sectors it asked for, read from the disc
 * a few at a time, and resolves once there are none left to give. The game asks after any call the page makes, as its
 * drive is told to seek or as it finds a sector it doesn't have, and in that case it pauses partway through its frame
 * (game.dp_paused()) until the page calls its frame again.
 */
export function discOf(game, disc) {
  return {
    /** Whether the game has asked for sectors, or waits for them. */
    get wanted() { return !!(game.dp_disc_wanted() || game.dp_paused()); },
    async serve() {
      for (let count; (count = game.dp_disc_wanted());) {
        const bytes = await disc.read(game.dp_disc_wanted_lba(), count);
        // where they go is asked only now, as nothing in the game ran while they were read
        new Uint8Array(game.memory.buffer, game.dp_disc_buffer(), bytes.length).set(bytes);
        game.dp_disc_have();
      }
    },
  };
}

/** The buttons `input` (input.js) holds, as a console with no kit in C of its own gives them to game_step: a bit for
 *  each of its buttons in kit/consoles.js, in that order (console.h). */
export function buttonsOf(input, id) {
  let bits = 0;
  CONSOLES[id].buttons.forEach((name, bit) => { if (input[name.toLowerCase()]) bits |= 1 << bit; });
  return bits >>> 0;
}

/**
 * Loads the game's WebAssembly from `url` and starts it with the player's copy, `bytes`, or its disc, `disc`, on console
 * `console` (an id in kit/consoles.js) with no kit in C of its own, and returns { step(buttons), draw(), sound }.
 * `step` runs a frame with buttonsOf's buttons held, and `draw` draws the last one, as { pixels, width, height }, the
 * words an ImageData of that size holds, at the size the game shows now. With a disc, `step` returns a promise when
 * the frame needs sectors the page hasn't given it yet: the page then runs no other frame, and draws none, until it
 * settles. `save` and `query` are openGame's.
 */
export async function loadGame(url, bytes, { console: id, save = null, query, disc = null } = {}) {
  const machine = CONSOLES[id];
  if (!machine) throw new Error(`There's no console called ${id} in kit/consoles.js.`);
  const { game } = await openGame(url, bytes, { save, disc, ...(query === undefined ? {} : { query }) });
  const sound = createSound(game, machine.sound, machine.frame[0] / machine.frame[1]);
  const sectors = disc && discOf(game, disc);
  game.dp_start();
  // what the game asked for as it started, before its first frame
  if (sectors?.wanted) await sectors.serve();
  sound.started();
  // a frame paused for its disc goes on, with the same buttons, once its sectors are there
  const goOn = async buttons => {
    for (;;) {
      await sectors.serve();
      if (!game.dp_paused()) return;
      game.dp_step(buttons);
    }
  };
  // what follows a frame once it has ended
  const frameDone = () => {
    // the frame's draw list, on a console whose kit keeps one, for the proof tools (kit/ps2/c/ps2.c)
    if (globalThis.dreamportsProof && game.dp_draw_list) {
      dreamportsProof.drawList = game.dp_draw_list() >>> 0;
      // the frame's whole list, read only when it's wanted, as it's the last frame's until the next one runs
      dreamportsProof.drawListBytes = () => {
        const size = game.dp_draw_list_size() >>> 0;
        return size === 0xFFFFFFFF ? null : new Uint8Array(game.memory.buffer, game.dp_draw_list_bytes(), size).slice();
      };
    }
    sound.frameDone();
  };
  return {
    step(buttons) {
      game.dp_step(buttons);
      if (sectors?.wanted) return goOn(buttons).then(frameDone);
      frameDone();
    },
    draw() {
      const at = game.dp_draw(), width = game.dp_width(), height = game.dp_height();
      return { width, height, pixels: new Uint32Array(game.memory.buffer, at, width * height) };
    },
    sound,
  };
}

// The game's sound, `rate` samples a second, a frame lasting `seconds`: for the proof tools, the samples a frame's time
// holds after each frame, as they hear a JavaScript game's (proof.js); for a player, the same samples sent to an audio
// thread that plays them as they come (worklet.js).
function createSound(game, rate, seconds) {
  const max = game.dp_sound_render_max();
  const render = (left, right) => {
    for (let done = 0; done < left.length;) {
      const count = Math.min(max, left.length - done), at = game.dp_sound_render(count) >> 2, samples = new Float32Array(game.memory.buffer);
      left.set(samples.subarray(at, at + count), done);
      right.set(samples.subarray(at + max, at + max + count), done);
      done += count;
    }
  };
  const none = { started() {}, frameDone() {}, muted: false, held: false };
  if (proof?.mode === 'play') {
    proof.listen(render, rate, seconds);
    return none;
  }
  if (!globalThis.AudioWorkletNode) return none;
  const audio = createAudio({ module: new URL('./worklet.js', import.meta.url), processor: 'dp-c-sound', sampleRate: rate, first: gain => ({ type: 'start', rate, gain }) });
  const step = rate * seconds;
  let played = 0;
  return {
    /** Once the game has started: its sound starts too, if the browser plays sound. */
    started() { audio.open(); },
    /** After each of the game's frames: the samples its time holds go to the audio thread. */
    frameDone() {
      const count = Math.floor((played + 1) * step) - Math.floor(played * step);
      played++;
      const left = new Float32Array(count), right = new Float32Array(count);
      render(left, right);
      audio.post({ type: 'samples', left, right }, [left.buffer, right.buffer]);
    },
    get muted() { return audio.muted; },
    set muted(value) { audio.muted = value; },
    get held() { return audio.held; },
    set held(value) { audio.held = value; },
  };
}
