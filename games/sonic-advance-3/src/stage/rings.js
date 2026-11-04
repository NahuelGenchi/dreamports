// The rings a stage has: those the characters touch are taken, and those the camera can see are drawn. Rewritten from
// CreateStageRingsManager, at 0x08029B10, and Task_RingsMgrStage, at 0x08029E10. The lightning shield's pull on rings
// comes with the shield.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { unRle } from './entities.js';

const RING_DATA = 0xCEBD0, ANIM_RING = 1333, ANIM_RING_COLLECT_EFFECT = 1334, OBJ_VRAM = 0x10000;
const REGION = 256, TILE = 8, DISPLAY_W = 240, DISPLAY_H = 160;
const TAKEN = 0xFE, END = 0xFF, MOST_EFFECTS = 8, MOST_RINGS = 999, MOST_LIVES = 255;
const SE_RING = 117, PLAYER_SE1 = 1, PLAYER_SE2 = 2;

export function createRings(stage) {
  const { c } = stage, { rom } = c;
  const data = unRle(rom, rom.u32(RING_DATA + stage.level * 4) - 0x08000000);
  const s = createSprite({ tiles: OBJ_VRAM + 0x4180, frameFlags: 0x41200, anim: ANIM_RING, x: DISPLAY_W / 2, y: DISPLAY_H / 2, oamFlags: 0x280 });
  const regionsX = data.getUint32(4, true) & 0xFFFF, regionsY = data.getUint32(8, true) & 0xFFFF;
  c.createTask(() => drawRings(stage, s, data, regionsX, regionsY), null, 0x2800);
}

function drawRings(stage, s, data, regionsX, regionsY) {
  const { c, camera: cam } = stage, m = c.oamMalloc, table = 12;
  let drawn = 0;
  updateSprite(c, s);
  const offset = spriteOffset(c, s);
  for (const p of stage.players) takeRings(stage, p, data, regionsX, regionsY);
  for (let ry = cam.y >> 8; ry * REGION < cam.y + DISPLAY_H && ry < regionsY; ry++) {
    for (let rx = cam.x >> 8; rx * REGION < cam.x + DISPLAY_W && rx < regionsX; rx++) {
      const start = data.getUint32(table + (regionsX * ry + rx) * 4, true);
      if (start === 0) continue;
      for (let at = table + start - 8; data.getUint8(at) !== END; at += 2) {
        if (data.getUint8(at) === TAKEN) continue;
        const x = data.getUint8(at) * TILE + rx * REGION - cam.x, y = data.getUint8(at + 1) * TILE + ry * REGION - cam.y;
        if (x < -TILE || x + TILE > DISPLAY_W + 2 * TILE || y < 0 || y - 2 * TILE > DISPLAY_H) continue;
        if (drawn === 0 || s.oamBaseIndex === 0xFF) {
          s.oamBaseIndex = 0xFF;
          s.x = x;
          s.y = y;
          displaySprite(c, s);
        } else {
          // the first ring's entry, at this one's place
          const k = c.allocOam((s.oamFlags & 0x7C0) >> 6);
          if (k < 0) return;
          const from = s.oamBaseIndex * 4;
          m[k * 4] = (m[from] & 0xFF00) + ((y - offset.y) & 0xFF);
          m[k * 4 + 1] = (m[from + 1] & 0xFE00) + ((x - offset.x) & 0x1FF);
          m[k * 4 + 2] = m[from + 2];
        }
        drawn++;
      }
    }
  }
}

// the rings a character's box touches: the box is its half-width and half-height either side of it, and the regions looked
// at reach a little further right and down than it does. Both characters add to the count, as the partner counts as a
// player here (its `someIndex` is 2), and being out of play, which stops a character taking them, comes with what puts it there.
function takeRings(stage, p, data, regionsX, regionsY) {
  const table = 12, x = p.x >> 8, y = p.y >> 8;
  const left = x - p.halfWidth, right = x + p.halfWidth, top = y - p.halfHeight, bottom = y + p.halfHeight;
  // the original's region numbers are unsigned, so a box past the map's top or left edge looks at no regions at all
  if (top < 0 || left - TILE < 0) return;
  for (let ry = top >> 8; ry <= (bottom + TILE) >> 8 && ry < regionsY; ry++) {
    for (let rx = (left - TILE) >> 8; rx <= (right + 2 * TILE) >> 8 && rx < regionsX; rx++) {
      const start = data.getUint32(table + (regionsX * ry + rx) * 4, true);
      if (start === 0) continue;
      for (let at = table + start - 8; data.getUint8(at) !== END; at += 2) {
        if (data.getUint8(at) === TAKEN) continue;
        const ringX = data.getUint8(at) * TILE + rx * REGION, ringY = data.getUint8(at + 1) * TILE + ry * REGION;
        if (touching(left, right, top, bottom, ringX, ringY)) {
          addRing(stage);
          createCollectEffect(stage, ringX, ringY);
          data.setUint8(at, TAKEN);
        }
      }
    }
  }
}

// RECT_TOUCHING_RING: a ring is 8 pixels either side of its place across, and the 16 pixels above its place up and down
function touching(left, right, top, bottom, ringX, ringY) {
  const across = (ringX - TILE <= left && ringX + TILE >= left) || (ringX - TILE >= left && right >= ringX - TILE);
  const upDown = (ringY - 2 * TILE <= top && ringY >= top) || (ringY - 2 * TILE >= top && bottom >= ringY - 2 * TILE);
  return across && upDown;
}

// 0x080025A8, AddRings: a life at every hundred, whose fanfare comes with the music manager, and never more than 999
function addRing(stage) {
  const before = stage.rings;
  stage.rings = Math.min(before + 1, MOST_RINGS);
  if (Math.trunc((before + 1) / 100) !== Math.trunc(before / 100)) stage.lives = Math.min(stage.lives + 1, MOST_LIVES);
}

// 0x08029C84, CreateCollectRingEffect: its sparkle, at most 8 at once, and its sound
function createCollectEffect(stage, x, y) {
  if (stage.ringEffects >= MOST_EFFECTS) return;
  const { c } = stage;
  const s = createSprite({ tiles: OBJ_VRAM + 0x4380, frameFlags: 0x41200, anim: ANIM_RING_COLLECT_EFFECT, x, y, oamFlags: 0x280 });
  c.createTask(t => showCollectEffect(t, stage, s), null, 0x2810);
  stage.ringEffects++;
  playRingSound(stage);
}

// 0x08029BE0, PlayRingCollectSE: from one side, then the other, by whether the count is odd
function playRingSound(stage) {
  const odd = stage.rings & 1;
  stage.c.playSoundOn(odd ? PLAYER_SE2 : PLAYER_SE1, SE_RING, 0x80, odd ? -0x40 : 0x40);
}

// Task_802ACF0: the sparkle stays where the ring was in the stage, and goes when its animation ends
function showCollectEffect(t, stage, s) {
  const { c, camera: cam } = stage, x = s.x, y = s.y;
  s.x -= cam.x;
  s.y -= cam.y;
  const running = updateSprite(c, s);
  displaySprite(c, s);
  if (!running) {
    stage.ringEffects--;
    c.destroyTask(t);
    return;
  }
  s.x = x;
  s.y = y;
}

// what a sprite's frame says about where its anchor is
function spriteOffset(c, s) {
  const { rom } = c, tables = 0x3314F0;
  const list = rom.u32(rom.u32(tables + 4) - 0x08000000 + s.anim * 4) - 0x08000000;
  const d = list + (s.frameNum >>> 28 === 0 ? s.frameNum * 12 : (s.frameNum & 0xFFFFFFF) * 16);
  return { x: rom.s16(d + 8), y: rom.s16(d + 10) };
}
