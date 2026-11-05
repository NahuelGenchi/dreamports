// The console's ArcTan and ArcTan2 (swi 10, called through 0x0804a590), a BIOS call that comes with no code of the
// game's own, so it follows mGBA's own version of it, _ArcTan and _ArcTan2 in src/gba/bios.c, with their numbers and
// their order of steps.
//
// Copyright (c) 2013-2015 Jeffrey Pfau, for that code in mGBA.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/. As its section 3.3 allows, this file
// is also part of this game under GPL-3.0-or-later.

function arcTan(i) {
  const a = -(Math.imul(i, i) >> 14);
  let b = (Math.imul(0xA9, a) >> 14) + 0x390;
  for (const next of [0x91C, 0xFB6, 0x16AA, 0x2081, 0x3651, 0xA2F9]) b = (Math.imul(b, a) >> 14) + next;
  return Math.imul(i, b) >> 16;
}
/** The angle of (x, y), as a 16-bit angle. */
export function arcTan2(x, y) {
  if (y === 0) return x >= 0 ? 0 : 0x8000;
  if (x === 0) return y >= 0 ? 0x4000 : 0xC000;
  const over = (n, d) => Math.trunc((n << 14) / d);
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return arcTan(over(y, x)) & 0xFFFF; }
    else if (-x >= y) return (arcTan(over(y, x)) + 0x8000) & 0xFFFF;
    return (0x4000 - arcTan(over(x, y))) & 0xFFFF;
  }
  if (x <= 0) { if (-x > -y) return (arcTan(over(y, x)) + 0x8000) & 0xFFFF; }
  else if (x >= -y) return arcTan(over(y, x)) & 0xFFFF;
  return (0xC000 - arcTan(over(x, y))) & 0xFFFF;
}
