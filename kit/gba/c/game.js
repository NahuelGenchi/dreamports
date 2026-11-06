// A game written in C, built to WebAssembly, on the JavaScript kit's page: it hands the game the player's copy, runs
// its frames with the buttons held, and draws them, while the page around it (the start screen, settings, touch
// controller, achievements and the proof tools' part, proof.js) stays the JavaScript kit's. What it gives back is what
// a JavaScript game's page has: `video`, the video hardware as video.js's (its VRAM, colours, OAM and registers, which
// the proof tools compare with the original's) with `drawFrame`, and `step(keys)`, the game's frame.

import { proof } from '../proof.js';
import { cartridgeSave } from '../save.js';

/**
 * Loads the game's WebAssembly from `url` and starts it with `rom` (rom/rom.js), its save memory kept in the browser
 * under `save` (save.js), and returns { video, step(keys) }.
 */
export async function loadGame(url, rom, { save = null } = {}) {
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
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
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
  game.dp_start();

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
  return { video, step: keys => game.dp_step(keys) };
}
