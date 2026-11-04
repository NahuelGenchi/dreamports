// A fight's camera and its queue of sprites, rewritten from the original's instructions, with the decompilation's
// src/unknown_08017c5c.cpp as a guide. The camera turns and zooms over the arena: what a fighter's position comes to on
// the screen (0x0801816c, 0x08018204) and the rotating layers' parameters (0x08016684) both come from it. Sprites wait
// in a queue of 16-byte entries, sorted by depth, which the V-blank turns into OAM entries in the buffer it copies.
//
// All of it is in work RAM at the original's addresses (bus.js), except what core.js keeps: the buffer, c.oamBuffer, and
// the rotating layers' parameters, c.affine and c.affineHalf.

import { copyAtVblank, hideSpriteBuffer } from './core.js';
import { read8, read16, reads16, read32, write8, write16, write32, divArm, s16, u16 } from './bus.js';

const SINE = 0x0804DF7C, QUARTER_TURN = 0x800;

// the camera
const ZOOM = 0x03001B04, ANGLE = 0x03001B08, TILT = 0x030016C8, CAMERA_X = 0x03001B2C, CAMERA_Y = 0x030016C0;
const HEIGHT_SHIFT = 0x03001384, FACING = 0x03001370, CAMERA_LEAD = 0x030016BC;

// the queue: how many, how many of them keep their priority (0x08017f6c), and the entries
const QUEUED = 0x030017CC, KEPT = 0x030017C8, QUEUE = 0x030033E0, ENTRY_SIZE = 16;
// the rotation matrices waiting, and how many
const MATRICES_QUEUED = 0x03001388, MATRICES = 0x03003190;
// the next OAM entry and the next matrix the V-blank writes
const NEXT_OAM = 0x030033CC, NEXT_MATRIX = 0x03003170;
// the screen's top and bottom, for what's worth drawing (0x08017f58)
const VIEW_TOP = 0x030016D0, VIEW_BOTTOM = 0x030017C0;
// the counters of 0x0801ffe4 and 0x08020034, over the same buffer
const BUFFER_MATRICES = 0x030044C0, BUFFER_SPRITES = 0x030048D4;

const sine = (c, angle) => reads16(c, SINE + angle * 2);

/** 0x08016684: the rotating layers 2 and 3's parameters from the camera, into the half the V-blank doesn't copy. */
export function layersFromCamera(c) {
  const zoom = reads16(c, ZOOM), angle = reads16(c, ANGLE), tilt = reads16(c, TILT);
  const cos = sine(c, angle + QUARTER_TURN), sin = sine(c, angle);
  const pa = u16(divArm(zoom, cos << 3));
  const pb = u16(divArm(zoom, Math.imul(sin, tilt) >> 5));
  const pc = u16(-divArm(zoom, sin << 3));
  const pd = u16(divArm(zoom, Math.imul(cos, tilt) >> 5));
  const cameraX = reads16(c, CAMERA_X), cameraY = reads16(c, CAMERA_Y);
  const across = (Math.imul(sin, cameraY) - Math.imul(cos, cameraX)) >> 13;
  const along = (-Math.imul(sin, cameraX) - Math.imul(cos, cameraY)) >> 13;
  const scale = zoom << 7;
  const left = Math.imul(across, scale) >> 20;
  const top = divArm(tilt, Math.imul(scale, along)) >> 12;
  const originX = left + 120;
  const firstX = Math.imul(s16(pa), originX), firstY = Math.imul(s16(pc), originX);
  const out = c.affine[c.affineHalf ^ 1];
  const reference = (at, row) => {
    const x = (0x10000 - Math.imul(s16(pb), row) - firstX) | 0;
    const y = (0x10000 - Math.imul(s16(pd), row) - firstY) | 0;
    out[at] = pa; out[at + 1] = pb; out[at + 2] = pc; out[at + 3] = pd;
    out[at + 4] = x; out[at + 5] = (x & 0x0FFF0000) >> 16;
    out[at + 6] = y; out[at + 7] = (y & 0x0FFF0000) >> 16;
  };
  // layer 2's row is off by the shift 0x080182ac works out, and 2 more
  reference(0, top - reads16(c, HEIGHT_SHIFT) + 82);
  reference(8, top + 80);
}

// What an entry's kind makes of its OAM entry: the first two attributes' fixed bits, and what else goes in them
const LIFT = 1, MODE = 2, MATRIX = 4, FLIP = 8;
const KINDS = new Map([
  [0, [0x0300, 0x8000, MATRIX]], [1, [0x8300, 0x8000, MATRIX]], [2, [0x8300, 0x4000, MATRIX]],
  [10, [0x0000, 0xC000, LIFT | FLIP]], [11, [0x0000, 0x8000, LIFT | FLIP]], [12, [0x4000, 0x8000, LIFT | FLIP]],
  [13, [0x8000, 0x8000, LIFT | FLIP]], [14, [0x0000, 0x4000, LIFT | FLIP]], [20, [0x4000, 0x8000, LIFT | FLIP]],
  [30, [0x0000, 0x4000, LIFT | MODE | FLIP]], [31, [0x4000, 0x8000, LIFT | MODE | FLIP]],
  [32, [0x8000, 0x8000, LIFT | MODE | FLIP]], [33, [0x0000, 0x8000, LIFT | MODE | FLIP]],
  [34, [0x0000, 0x0000, LIFT | MODE | FLIP]], [98, [0x0000, 0x8000, LIFT | FLIP]],
  [100, [0x0300, 0x4000, MODE | MATRIX]], [101, [0x4300, 0x8000, MODE | MATRIX]], [102, [0x8300, 0x8000, MODE | MATRIX]],
  [103, [0x0300, 0x8000, MODE | MATRIX]], [104, [0x0300, 0x0000, MODE | MATRIX]], [105, [0x0300, 0xC000, MODE | MATRIX]],
  [106, [0x4300, 0xC000, MODE | MATRIX]],
  [110, [0x0000, 0x4000, MODE | FLIP]], [111, [0x4000, 0x8000, MODE | FLIP]], [112, [0x8000, 0x8000, MODE | FLIP]],
  [113, [0x0000, 0x8000, MODE | FLIP]], [114, [0x0000, 0x0000, MODE | FLIP]], [115, [0x0000, 0xC000, MODE | FLIP]],
  [116, [0x4000, 0x4000, MODE | FLIP]], [117, [0x4000, 0xC000, MODE | FLIP]], [118, [0x4000, 0x0000, MODE | FLIP]],
  [120, [0x8000, 0x0000, 0]], [130, [0x2300, 0xC000, MODE | MATRIX]], [131, [0x2000, 0xC000, MODE | FLIP]],
]);

// A kind that has no case leaves the attributes on the stack as the last sprite left them, and writes those again.
const attributes = new Uint16Array(3);

/**
 * 0x08016b30: one queue entry, as its four words, as an OAM entry in the buffer. The words hold, from the first byte:
 * x, y, height, depth (16 bits each), tile (16), priority, matrix, palette, kind, mode and flip.
 */
export function drawQueuedSprite(c, word0, word1, word2, word3) {
  const x = word0 & 0xFFFF, y = word0 >>> 16, height = word1 & 0xFFFF;
  const tile = word2 & 0xFFFF, priority = (word2 >>> 16) & 0xFF, matrix = word2 >>> 24;
  const palette = word3 & 0xFF, kind = (word3 >>> 8) & 0xFF, mode = (word3 >>> 16) & 0xFF, flip = word3 >>> 24;
  const shape = KINDS.get(kind);
  if (shape) {
    const [first, second, what] = shape;
    attributes[0] = (((what & LIFT ? y - height : y) & 0xFF) | first | (what & MODE ? (mode & 3) << 10 : 0));
    attributes[1] = (x & 0x1FF) | second | (what & MATRIX ? (matrix & 31) << 9 : 0) | (what & FLIP ? (flip & 3) << 12 : 0);
    attributes[2] = (tile & 0x3FF) | ((priority & 3) << 10) | ((palette & 15) << 12);
  }
  writeNextSprite(c, attributes[0], attributes[1], attributes[2]);
}

/** 0x080175aa, the end of 0x08016b30: the three attributes as the next OAM entry. */
export function writeNextSprite(c, first, second, third) {
  const at = read16(c, NEXT_OAM);
  spriteInBuffer(c, at, first, second, third);
  write16(c, NEXT_OAM, at + 1);
}

/** 0x08017690: every queue entry to the buffer. Those past the kept ones get their priority from their height: 2 above 29, or else 3. */
export function drawQueue(c) {
  for (let i = 0; i < read8(c, QUEUED); i = (i + 1) & 0xFF) {
    const entry = QUEUE + i * ENTRY_SIZE;
    if (i >= read8(c, KEPT)) write8(c, entry + 10, reads16(c, entry + 4) > 29 ? 2 : 3);
    drawQueuedSprite(c, read32(c, entry), read32(c, entry + 4), read32(c, entry + 8), read32(c, entry + 12));
  }
}

/** 0x080175d4: the queue past the kept entries sorted by depth, the deepest first, a bubble at a time. */
export function sortQueue(c) {
  let pass = 1;
  for (let round = (read8(c, KEPT) + 1) & 0xFF; round < read8(c, QUEUED); round = (round + 1) & 0xFF) {
    for (let i = read8(c, KEPT); i < read8(c, QUEUED) - pass; i = (i + 1) & 0xFF) {
      const a = QUEUE + i * ENTRY_SIZE, b = a + ENTRY_SIZE;
      if (reads16(c, a + 6) < reads16(c, b + 6)) {
        for (let word = 0; word < ENTRY_SIZE; word += 4) {
          const kept = read32(c, a + word);
          write32(c, a + word, read32(c, b + word));
          write32(c, b + word, kept);
        }
      }
    }
    pass = (pass + 1) & 0xFF;
  }
}

/** 0x080176e4: the camera's angle an eighth of the way to `target`, the short way round; a full turn is 0x2000. */
export function turnCamera(c, target) {
  let wanted = s16(target);
  while (wanted > 0x2000) wanted = s16(wanted - 0x2000);
  while (wanted < 0) wanted = s16(wanted + 0x2000);
  const apart = reads16(c, ANGLE) - wanted;
  if (apart > 0x1000) write16(c, ANGLE, read16(c, ANGLE) - 0x2000);
  else if (apart < -0x1000) write16(c, ANGLE, read16(c, ANGLE) + 0x2000);
  let angle = s16(read16(c, ANGLE) - ((reads16(c, ANGLE) - wanted) >> 3));
  while (angle > 0x1FFF) angle = s16(angle - 0x2000);
  while (angle < 0) angle = s16(angle + 0x2000);
  write16(c, ANGLE, angle);
}

/** 0x08017d58: the sprites queued to the buffer now, and the next V-blank asked to go on. */
export function drawSpritesNow(c) {
  restartBuffer(c);
  hideSpriteBuffer(c);
  drawQueue(c);
  drawMatrices(c);
  c.vblankCopies = 1;
}

/** 0x08017ed0: nothing queued, of sprites or matrices. */
export function clearQueue(c) {
  write8(c, QUEUED, 0);
  write8(c, KEPT, 0);
  write8(c, MATRICES_QUEUED, 0);
}

/** 0x08017eec: the next sprite and matrix the V-blank writes are the first ones. */
export function restartBuffer(c) {
  write16(c, NEXT_OAM, 0);
  write16(c, NEXT_MATRIX, 0);
}

/**
 * 0x08017f00: an entry on the queue, as its four words. The original's CpuFastSet copies eight words, four of them from
 * its stack into the next entry, whatever the next sprite overwrites, and nothing reads past the count.
 */
export function queueSprite(c, word0, word1, word2, word3) {
  const count = read8(c, QUEUED), at = QUEUE + count * ENTRY_SIZE;
  write32(c, at, word0);
  write32(c, at + 4, word1);
  write32(c, at + 8, word2);
  write32(c, at + 12, word3);
  write8(c, QUEUED, count + 1);
}

/** 0x08017f34: a rotation matrix on its queue, its four values in two words. */
export function queueMatrix(c, word0, word1) {
  const count = read8(c, MATRICES_QUEUED), at = MATRICES + count * 8;
  write32(c, at, word0);
  write32(c, at + 4, word1);
  write8(c, MATRICES_QUEUED, count + 1);
}

/** 0x08017f58: the rows between which 0x08006ff4 thinks a sprite is on the screen. */
export function setViewRows(c, top, bottom) {
  write8(c, VIEW_TOP, top);
  write8(c, VIEW_BOTTOM, bottom);
}

/** 0x08017f6c: every entry queued so far keeps its place and its priority. */
export function keepQueued(c) {
  write8(c, KEPT, read8(c, QUEUED));
}

/** 0x08017fb0: every rotation matrix queued, to the buffer. */
export function drawMatrices(c) {
  for (let i = 0; i < read8(c, MATRICES_QUEUED); i = (i + 1) & 0xFF) {
    const at = MATRICES + i * 8, first = read32(c, at), second = read32(c, at + 4), n = read16(c, NEXT_MATRIX);
    matrixInBuffer(c, n, first & 0xFFFF, first >>> 16, second & 0xFFFF, second >>> 16);
    write16(c, NEXT_MATRIX, n + 1);
  }
}

/**
 * 0x0801816c: a place in the arena relative to the camera and turned by its angle. Returns [x, y], and when `outX` and
 * `outY` are addresses, writes them there too, as the original does.
 */
export function viewFromArena(c, outX, outY, x, y) {
  const across = s16(s16(x) - read16(c, CAMERA_X)), along = s16(s16(y) - read16(c, CAMERA_Y));
  const angle = reads16(c, ANGLE), cos = sine(c, angle + QUARTER_TURN), sin = sine(c, angle);
  const viewX = (Math.imul(cos, across) - Math.imul(sin, along)) >> 13;
  const viewY = (Math.imul(across, sin) + Math.imul(cos, along)) >> 13;
  if (outX) write16(c, outX, viewX);
  if (outY) write16(c, outY, viewY);
  return [s16(viewX), s16(viewY)];
}

/**
 * 0x08018204: a place relative to the camera as a place on the screen, whose middle is 120, 80. Returns [x, y], and when
 * `outX` and `outY` are addresses, writes them there too.
 */
export function screenFromView(c, outX, outY, x, y) {
  const zoom = reads16(c, ZOOM);
  const screenX = (Math.imul(zoom, s16(x)) >> 13) + 120;
  const scale = divArm(reads16(c, TILT), zoom << 8);
  const screenY = (Math.imul(scale, s16(y)) >> 13) + 80;
  if (outX) write16(c, outX, screenX);
  if (outY) write16(c, outY, screenY);
  return [s16(screenX), s16(screenY)];
}

/** 0x080182ac: the shift of layer 2's row in 0x08016684, from the zoom and the tilt. */
export function setHeightShift(c) {
  write16(c, HEIGHT_SHIFT, Math.imul(reads16(c, ZOOM), 42) >> 9);
  const part = divArm(reads16(c, TILT), reads16(c, HEIGHT_SHIFT));
  write16(c, HEIGHT_SHIFT, read16(c, HEIGHT_SHIFT) - part);
}

/** 0x080182e4: the zoom an eighth of the way to `target`. */
export function zoomCamera(c, target) {
  const step = (reads16(c, ZOOM) - s16(target)) >> 3;
  write16(c, ZOOM, read16(c, ZOOM) - step);
}

/** 0x08018300: the tilt halfway to `target`. */
export function tiltCamera(c, target) {
  write16(c, TILT, (reads16(c, TILT) + s16(target)) >> 1);
}

/** 0x08018318: the camera an eighth of the way to `x`, `y`, with its lead along whichever axis it's facing. */
export function moveCamera(c, x, y) {
  let toX = u16(x), toY = u16(y);
  const facing = (read8(c, FACING) - 2) & 0xFF;
  if (facing <= 1) toX = u16(s16(toX) + read16(c, CAMERA_LEAD));
  else toY = u16(s16(toY) + read16(c, CAMERA_LEAD));
  const stepX = (reads16(c, CAMERA_X) - s16(toX)) >> 3;
  write16(c, CAMERA_X, read16(c, CAMERA_X) - stepX);
  const stepY = (reads16(c, CAMERA_Y) - s16(toY)) >> 3;
  write16(c, CAMERA_Y, read16(c, CAMERA_Y) - stepY);
}

/** 0x08018390: the camera's angle. */
export const cameraAngle = c => reads16(c, ANGLE);

/** 0x0801ffe4: a matrix in the buffer at its counter's place (its count times two bytes in), and the place it took, or 255. */
export function addMatrixToBuffer(c, a, b, d, e) {
  const count = read8(c, BUFFER_MATRICES);
  if (count > 31) return 255;
  c.oamBuffer[count + 3] = a;
  c.oamBuffer[count + 7] = b;
  c.oamBuffer[count + 11] = d;
  c.oamBuffer[count + 15] = e;
  write8(c, BUFFER_MATRICES, count + 1);
  return count;
}

/** 0x08020034: a sprite in the buffer at its counter's place: 1 if it fit, or 0 once the counter has run past 127. */
export function addSpriteToBuffer(c, first, second, third) {
  const count = read8(c, BUFFER_SPRITES);
  if (count & 0x80) return 0;
  c.oamBuffer[count * 4] = first;
  c.oamBuffer[count * 4 + 1] = second;
  c.oamBuffer[count * 4 + 2] = third;
  write8(c, BUFFER_SPRITES, count + 1);
  return 1;
}

/** 0x08020074: the rest of the buffer's sprites hidden, and the next V-blank asked to copy it. */
export function hideRestOfBuffer(c) {
  for (let i = read8(c, BUFFER_SPRITES); i < 128; i++) c.oamBuffer[i * 4] = 0x200;
  c.oamBufferFull = 1;
}

/** 0x080200bc: sprite `n`'s three attributes in the buffer. */
export function spriteInBuffer(c, n, first, second, third) {
  const at = u16(n) * 4;
  c.oamBuffer[at] = first;
  c.oamBuffer[at + 1] = second;
  c.oamBuffer[at + 2] = third;
}

/** 0x080200d8: rotation matrix `n`'s four values in the buffer, each in the spare word of a sprite. */
export function matrixInBuffer(c, n, a, b, d, e) {
  const at = u16(n) * 16;
  c.oamBuffer[at + 3] = a;
  c.oamBuffer[at + 7] = b;
  c.oamBuffer[at + 11] = d;
  c.oamBuffer[at + 15] = e;
}

/**
 * The sprites' part of the V-blank (0x080185d8): when 0x08017c5c has asked for it, 0x08017eec, 0x0801ff30, 0x08017690 and
 * 0x08017fb0, and the request answered. Whoever calls this does 0x0801694c first, since this clears the request.
 */
export function vblankWork(c) {
  if (!c.vblankCopies) return;
  restartBuffer(c);
  hideSpriteBuffer(c);
  drawQueue(c);
  drawMatrices(c);
  c.vblankCopies = 0;
}

export { layersFromCamera as fn08016684, drawQueuedSprite as fn08016b30, writeNextSprite as fn080175aa };
export { drawQueue as fn08017690, sortQueue as fn080175d4, turnCamera as fn080176e4, copyAtVblank as fn08017c5c };
export { drawSpritesNow as fn08017d58, clearQueue as fn08017ed0, restartBuffer as fn08017eec, queueSprite as fn08017f00 };
export { queueMatrix as fn08017f34, setViewRows as fn08017f58, keepQueued as fn08017f6c, drawMatrices as fn08017fb0 };
export { viewFromArena as fn0801816c, screenFromView as fn08018204, setHeightShift as fn080182ac };
export { zoomCamera as fn080182e4, tiltCamera as fn08018300, moveCamera as fn08018318, cameraAngle as fn08018390 };
export { hideSpriteBuffer as fn0801ff30, addMatrixToBuffer as fn0801ffe4, addSpriteToBuffer as fn08020034 };
export { hideRestOfBuffer as fn08020074, spriteInBuffer as fn080200bc, matrixInBuffer as fn080200d8 };
