// The rings a character loses as it's hit, flying off and falling, which it can take again before they fade. Rewritten from
// the decompilation's InitPlayerHitRingsScatter, InitScatteringRings and
// RingsScatterSingleplayer_NormalGravity.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { groundInTile } from './collision.js';
import { addRing, createEffect } from './rings.js';
import { STATE } from './player.js';
import { SINE } from './trig.js';

const ANIM_RING = 726, OBJ_VRAM = 0x10000, RING_FLAGS = 0x42200, ORDER = 20;
const MOST = 32, FRAMES_ALIVE = 180, TAKEN_FROM = 0x94, FADES_UNDER = 32, GRAVITY = 0x12, SE_RINGS_LOST = 118;
const FIRST_THROW = 0x488, THROW_STEP = 0x10, THROW_HALF = 0x80, SEES_GROUND = 7, GOES_THROUGH = 4;
const TILE = 8, DISPLAY_W = 240, DISPLAY_H = 160;

/** InitPlayerHitRingsScatter, as a stage starts. Its sprite turns from then on, twice as fast as the rings on the map. */
export function createRingsScatter(stage) {
  const { c } = stage;
  stage.scatter = {
    stage, rings: Array.from({ length: MOST }, () => ({ x: 0, y: 0, velX: 0, velY: 0, left: 0, layer: 0, step: 0 })),
    sprite: createSprite({ tiles: OBJ_VRAM + 0x1F00, anim: ANIM_RING, animSpeed: 0x20, frameFlags: RING_FLAGS, oamFlags: ORDER << 6, oamBaseIndex: 0xFF }),
  };
  c.createTask(scatterFrame, stage.scatter, 0x2001);
}

/** InitScatteringRings: as many as it had, up to 32, thrown in pairs that go either way, in rings of them each wider than the last. */
export function scatterRings(stage, x, y, count) {
  if (count === 0) return;
  const { rings } = stage.scatter, left = Math.min(count, MOST);
  stage.c.playSong(SE_RINGS_LOST);
  let turn = FIRST_THROW, velX = 0, velY = 0, thrown = 0;
  for (const ring of rings) {
    if (ring.left !== 0) continue;
    ring.left = FRAMES_ALIVE;
    ring.layer = stage.player.layer;
    ring.x = x * 256;
    ring.y = y * 256;
    if (turn >= 0) {
      const whole = turn >> 8, shift = whole > 5 ? 9 - whole : whole, angle = (turn & 0xFF) * 4;
      velX = SINE[angle] >> shift;
      velY = SINE[angle + 256] >> shift;
      velX -= velX >> 2;
      velY -= velY >> 2;
      turn = (turn + THROW_STEP) | THROW_HALF;
    }
    ring.velX = velX;
    ring.velY = velY;
    turn = -turn;
    velX = -velX;
    ring.step = (stage.random() & 0x10000 ? 0 : GOES_THROUGH) | (thrown & 3);
    if (++thrown >= left) return;
  }
}

// RECT_TOUCHING_RING, with the character's box as it last had it, even when that's switched off
function touching(p, x, y) {
  const box = p.sprite.boxes?.[0] ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const left = (p.x >> 8) + box.left, top = (p.y >> 8) + box.top;
  return ((x - TILE <= left && x + TILE >= left) || (x - TILE >= left && left + box.right - box.left >= x - TILE))
    && ((y - 2 * TILE <= top && y >= top) || (y - 2 * TILE >= top && top + box.bottom - box.top >= y - 2 * TILE));
}

// RingsScatterSingleplayer_NormalGravity
function scatterFrame(t) {
  const scatter = t.data, { stage, sprite: s } = scatter, { c, camera: cam, player: p } = stage, m = c.oamMalloc;
  updateSprite(c, s);
  const { rom } = c, offsetX = rom.s16(s.dimensions + 8), offsetY = rom.s16(s.dimensions + 10);
  let shown = false;
  for (const ring of scatter.rings) {
    if (ring.left === 0) continue;
    ring.x += ring.velX;
    ring.y += ring.velY;
    const x = ring.x >> 8, y = ring.y >> 8, screenX = x - cam.x, screenY = y - cam.y;
    if (ring.left <= TAKEN_FROM && (p.state !== STATE.HIT_AIR || p.invulnerable === 0) && touching(p, x, y)) {
      createEffect(stage.ringsManager, x, y);
      addRing(stage);
      ring.left = 0;
      continue;
    }
    if (ring.velY > 0 && !(ring.step & SEES_GROUND)) {
      const gap = groundInTile(y, x, ring.layer, 8);
      if (gap <= 0) {
        ring.y += gap * 256;
        ring.velY = (ring.velY >> 2) - ring.velY;
      }
    }
    ring.velY += GRAVITY;
    if (screenX + TILE > 0 && screenX + TILE < DISPLAY_W + 2 * TILE && screenY > -TILE && screenY < DISPLAY_H + TILE && (ring.left >= FADES_UNDER || !(stage.frames & 2))) {
      if (!shown || s.oamBaseIndex === 0xFF) {
        s.oamBaseIndex = 0xFF;
        s.x = screenX;
        s.y = screenY;
        displaySprite(c, s);
        shown = true;
      } else {
        const k = c.allocOam(ORDER);
        if (k >= 0) {
          const from = s.oamBaseIndex * 4;
          m[k * 4] = (m[from] & 0xFF00) + ((screenY - offsetY) & 0xFF);
          m[k * 4 + 1] = (m[from + 1] & 0xFE00) + ((screenX - offsetX) & 0x1FF);
          m[k * 4 + 2] = m[from + 2];
        }
      }
    }
    ring.step = (ring.step & ~3) | ((ring.step + 1) & 3);
    ring.left--;
  }
}
