// The original's integer trigonometry. The sine table is 1.25 turns of 1024 steps in Q2.14, each entry truncated toward
// zero, as Sonic Advance Dreamport's src/engine/trig.js has it. The arctangent is the console's BIOS call, which the
// game asks for and which comes with no code of the game's own, so it follows mGBA's own version of it, _ArcTan and
// _ArcTan2 in src/gba/bios.c, with their numbers and their order of steps.
//
// Copyright (c) 2013-2015 Jeffrey Pfau, for that code in mGBA.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/. As its section 3.3 allows, this file
// is also part of this game under GPL-3.0-or-later.

export const SINE = Int16Array.from({ length: 1280 }, (_, i) => Math.trunc(Math.sin(i * 2 * Math.PI / 1024) * 16384));
export const sin8 = angle => SINE[angle & 0x3FF] >> 6;
export const cos8 = angle => SINE[(angle & 0x3FF) + 256] >> 6;

const LAST_ARCTAN_TERM = 0xA9, ARCTAN_TERMS = [0x390, 0x91C, 0xFB6, 0x16AA, 0x2081, 0x3651, 0xA2F9];

// the arctangent of a ratio in Q14, from -1 to 1, as a sum of terms in its square
function arcTanOfRatio(ratio) {
  const minusSquare = -((ratio * ratio) >> 14);
  let sum = LAST_ARCTAN_TERM;
  for (const term of ARCTAN_TERMS) sum = ((sum * minusSquare) >> 14) + term;
  return (ratio * sum) >> 16;
}
const ratioOf = (top, bottom) => Math.trunc((top << 14) / bottom);

/** Angle of (x, y) in 65536 steps per turn, y pointing down. */
export function arcTan2(x, y) {
  if (y === 0) return x >= 0 ? 0 : 0x8000;
  if (x === 0) return y >= 0 ? 0x4000 : 0xC000;
  let angle;
  if (y > 0) {
    if (x >= y) angle = arcTanOfRatio(ratioOf(y, x));
    else if (-x >= y) angle = arcTanOfRatio(ratioOf(y, x)) + 0x8000;
    else angle = 0x4000 - arcTanOfRatio(ratioOf(x, y));
  } else if (x < 0 && -x > -y) angle = arcTanOfRatio(ratioOf(y, x)) + 0x8000;
  else if (x > 0 && x >= -y) angle = arcTanOfRatio(ratioOf(y, x)) + 0x10000;
  else angle = 0xC000 - arcTanOfRatio(ratioOf(x, y));
  return angle & 0xFFFF;
}
