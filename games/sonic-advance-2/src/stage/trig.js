// The original's sine table: 1.25 turns of 1024 steps in Q2.14, each entry truncated toward zero, as Sonic Advance
// Dreamport's src/engine/trig.js has it.

export const SINE = Int16Array.from({ length: 1280 }, (_, i) => Math.trunc(Math.sin(i * 2 * Math.PI / 1024) * 16384));
export const sin8 = angle => SINE[angle & 0x3FF] >> 6;
export const cos8 = angle => SINE[(angle & 0x3FF) + 256] >> 6;
