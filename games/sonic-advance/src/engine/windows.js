// How mGBA 0.10.5, the reference, reads the windows' registers and draws a line in pieces for them, which the act's
// renderer has to follow where a window edge changes what a layer shows (renderer.js). This follows mGBA's own code,
// in src/gba/renderers/video-software.c: its handling of the registers REG_WIN0H to REG_WIN1V, and _breakWindow and
// _breakWindowInner, with their order of steps.
//
// Copyright (c) 2013-2015 Jeffrey Pfau, for that code in mGBA.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/. As its section 3.3 allows, this file
// is also part of this game under GPL-3.0-or-later.

import { SCREEN_W, SCREEN_H } from './constants.js';

// A window's lines or edges: a start past the screen's end and past its own end counts as 0
export function windowRange(value, max) {
  let start = value >> 8, end = value & 0xFF;
  if (start > max && start > end) start = 0;
  if (end > max) { end = max; if (start > max) start = max; }
  return [start, end];
}

// Each piece's end, on the original screen's `line`, empty pieces and the way it trims those it overwrites included
export function windowPieces(blend, line) {
  const ends = [SCREEN_W];
  let n = 1;
  const inner = (start, end) => {
    if (end <= 0) return;
    let startX = 0;
    for (let a = 0; a < n; a++) {
      if (start < ends[a]) {
        const old = ends[a];
        if (start > startX) {
          ends.splice(a, 0, ends[a]);
          n++;
          ends[a] = start;
          a++;
        }
        ends[a] = end;
        if (end >= old) {
          for (a++; n > a + 1 && end >= ends[a]; a++) { ends[a] = ends[a + 1]; n--; }
        } else {
          a++;
          ends.splice(a, 0, old);
          n++;
        }
        return;
      }
      startX = ends[a];
    }
  };
  for (const w of [1, 0]) {
    const [top, bottom] = windowRange(blend.v[w], SCREEN_H);
    if (bottom >= top ? line < top || line >= bottom : line >= bottom && line < top) continue;
    const at = blend.base + line * 4 + w * 2;
    const [left, right] = windowRange(blend.drawn ? blend.buf[at] | (blend.buf[at + 1] << 8) : blend.h[w], SCREEN_W);
    if (right < left) { inner(0, right); inner(left, SCREEN_W); } else inner(left, right);
  }
  return ends.slice(0, n);
}
