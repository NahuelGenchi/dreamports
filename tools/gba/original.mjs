// Plays the original in the reference emulator (original.c): the buttons held at each frame in, and out what
// each frame shows, what it sounds like and which of the code map's functions ran in it.

import { ORIGINAL, isBuilt, build } from './build.mjs';
import { playReference, runReference } from '../lib/run-reference.mjs';
import { STATE_BYTES } from '../lib/state.mjs';

/** The Game Boy Advance's buttons, a bit each, as its KEYINPUT register and kit/gba/input.js have them. */
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };

export const WIDTH = 240, HEIGHT = 160;

/** The program that plays the original says every instruction that ran and each way every branch went (lib/played.mjs). */
export const seesInstructions = true;

/** It says what each branch went by, and its branches are ones the tools can work out the way of (untouched.mjs). */
export const saysWhy = true;

/** A search of the original can count what hasn't been played, and spread over how long it has played (lib/explore.h). */
export const searchesWhatRan = true;

/** It also gives the cartridge's save memory each time it changes (lib/saves.mjs). */
export const seesSaves = true;

/** It hashes stretches of the work memory as each frame ends, for a game that keeps its own at the console's addresses (lib/memory.mjs). */
export const seesMemory = true;

/** It can start the original from a save memory, a file given as `startSave`, in place of one never written. */
export const startsFromSave = true;

/** A file's size that is a Game Boy Advance cartridge's save memory: its EEPROM, SRAM or flash. */
export const isSaveMemory = size => [0x200, 0x2000, 0x8000, 0x10000, 0x20000].includes(size);

/** Builds the reference emulator if it isn't built yet. */
export function ensureOriginal(log) {
  if (!isBuilt()) build(log);
}

/** Runs the original along with a person, as lib/run-reference.mjs says. */
export const playOriginal = copy => playReference({ program: ORIGINAL, args: [copy, 'live'], width: WIDTH, height: HEIGHT });

/** Runs `frames` frames of the original from power-on, as lib/run-reference.mjs says, its sound 65536 samples a second.
 *  With `startSave`, a file, its cartridge holds that save as it starts. */
export const runOriginal = ({ copy, startSave, ...rest }) => runReference({
  ...rest, ...(startSave ? { env: { ...rest.env, DP_SAVE_START: startSave } } : {}), program: ORIGINAL, width: WIDTH, height: HEIGHT, stateBytes: STATE_BYTES,
  args: names => [copy, String(rest.frames), names.buttons, names.functions, names.pictures, names.sound, names.sets, names.states],
});

/** What runs the route finder's search on a copy, in the folder `spec` is in (lib/explore.h): the program, what it's given, and how many bytes a frame's buttons take in its files. */
export const searchOriginal = ({ copy, spec }) => ({ program: ORIGINAL, args: [copy, 'route', spec], buttonBytes: 2 });
