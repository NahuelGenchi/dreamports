// The soft reset's buttons (VBlankIntr in SAT-R's src/core.c): A, B, Start and Select held together at a V-blank
// restart the game, unless a screen has turned it off (FLAGS_8000). The screens on the GBA engine (gba/engine.js)
// see them in its V-blank, with `engine.nextKeys`; the act and the ending, which run on their own, ask here once
// a frame. The V-blank reads the buttons itself, not what the step read at its start: the kit's `nextHeld`.

/** Whether `input` (engine/input.js) holds the four buttons at the V-blank at the end of this step. */
export function holdsSoftReset(input) {
  const held = input.nextHeld();
  return held.has('jump') && held.has('attack') && held.has('start') && held.has('select');
}
