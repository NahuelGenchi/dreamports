// The rings a stage has: those the characters touch are taken, and those the camera can see are drawn. Rewritten from
// CreateStageRingsManager, at 0x08029B10, and Task_RingsMgrStage, at 0x08029E10. The lightning shield's pull on rings
// comes with the shield. Below them, the rings a character drops when it's hit and those a beaten enemy gives
// (gTask_03001CFC.c).

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { unRle } from './entities.js';
import { tileUpDown } from './collision.js';
import { SINE } from './trig.js';

const RING_DATA = 0xCEBD0, ANIM_RING = 1333, ANIM_RING_COLLECT_EFFECT = 1334, OBJ_VRAM = 0x10000;
const REGION = 256, TILE = 8, DISPLAY_W = 240, DISPLAY_H = 160;
const TAKEN = 0xFE, END = 0xFF, MOST_EFFECTS = 8, MOST_RINGS = 999, MOST_LIVES = 255;
const SE_RING = 117, PLAYER_SE1 = 1, PLAYER_SE2 = 2;
const HURT = 0x66, ANIM_RING_LOOSE = 0x535, RING_SLOTS = 32, MOST_DROPPED = 32, SE_LOST_RINGS = 0x76;
const LOOSE_FRAMES = 0xB4, TOUCHABLE_FROM = 0x94, BLINKS_FROM = 0x1F, LOOSE_GRAVITY = 0x12, FIRST_ANGLE = 0x488, REWARD_ANGLE = 0x478;
const s16 = v => (v << 16) >> 16;

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
  if (p.pose === HURT) return;   // while it's hit
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

// Create_gTask_03001CFC: the rings that are loose, none so far
export function createLooseRings(stage) {
  const { c } = stage;
  const s = createSprite({ tiles: OBJ_VRAM + 0x4180, frameFlags: 0x41200, anim: ANIM_RING_LOOSE, oamFlags: 0x400, animSpeed: 0x20 });
  const slots = Array.from({ length: RING_SLOTS }, () => ({ life: 0, layer: 0, x: 0, y: 0, velX: 0, velY: 0, turn: 0 }));
  stage.looseRings = slots;
  c.createTask(() => {   // Task_802B71C and sub_802B3B8
    updateSprite(c, s);
    for (const ring of slots) {
      if (ring.life === 0) continue;
      ring.x += ring.velX;
      ring.y += ring.velY;
      const x = ring.x >> 8, y = ring.y >> 8;
      takeLooseRing(stage, ring, x, y);
      bounce(ring, x, y);
      drawLooseRing(stage, s, ring, x - stage.camera.x, y - stage.camera.y);
      ring.turn = (ring.turn & ~3) | ((ring.turn + 1) & 3);
      ring.life--;
    }
  }, null, 0x2001);
}

/** sub_802AE64: a character's rings fly off in pairs, each a little slower and steeper than the last, at most 32 of them. */
export function dropRings(stage, p, rings) {
  if (rings === 0) return;
  const { c } = stage, count = Math.min(rings, MOST_DROPPED);
  c.playSong(SE_LOST_RINGS);
  let angle = FIRST_ANGLE, velX = 0, velY = 0, dropped = 0;
  for (const ring of stage.looseRings) {
    if (ring.life !== 0) continue;
    ring.life = LOOSE_FRAMES;
    ring.layer = p.layer;
    ring.x = p.x;
    ring.y = p.y;
    if (angle >= 0) {
      const high = angle >> 8, shift = high > 5 ? 9 - high : high;
      velX = SINE[(angle & 0xFF) * 4] >> shift;
      velY = SINE[(angle & 0xFF) * 4 + 256] >> shift;
      velX -= velX >> 2;
      velY -= velY >> 2;
      angle = (angle + 0x10) | 0x80;
    }
    ring.velX = s16(velX);
    ring.velY = s16(velY);
    angle = -angle;
    velX = -velX;
    ring.turn = c.random() & 0x10000 ? 0 : 4;
    ring.turn |= dropped & 3;
    if (++dropped >= count) break;
  }
}

/** Task_14_805C03C: the ring a beaten enemy leaves, going straight up, in the character's layer. */
export function rewardRing(stage, p, x, y) {
  let free = 0, ring = stage.looseRings[RING_SLOTS - 1];
  for (let i = 0; i < RING_SLOTS; i++) {
    if (stage.looseRings[i].life === 0) {
      free = i;
      ring = stage.looseRings[i];
      break;
    }
  }
  const high = REWARD_ANGLE >> 8, speed = SINE[(REWARD_ANGLE & 0xFF) * 4 + 256] >> high;
  ring.layer = p.layer > 1 ? 1 : p.layer;
  ring.life = LOOSE_FRAMES;
  ring.x = x * 256;
  ring.y = y * 256;
  ring.velX = 0;
  ring.velY = s16(speed - (speed >> 1));
  ring.turn = free % 4;
}

// sub_802B1A0: after its first moments a character can take it back, unless it's still reeling from a hit
function takeLooseRing(stage, ring, x, y) {
  if (ring.life > TOUCHABLE_FROM) return;
  stage.players.forEach((p, i) => {
    if (ring.done === stage.timer) return;
    if (p.pose === HURT && p.invulnerable !== 0) return;
    const box = p.sprite.hitboxes?.[0];
    if (!box) return;
    const left = (p.x >> 8) + box.left, top = (p.y >> 8) + box.top;
    const across = x - TILE <= left ? x + TILE >= left : left + box.right - box.left >= x - TILE;
    if (!across) return;
    const upDown = y - 2 * TILE <= top ? y >= top : top + box.bottom - box.top >= y - 2 * TILE;
    if (!upDown) return;
    createCollectEffect(stage, x, y);
    addRing(stage);
    ring.life = 1;
    ring.done = stage.timer;
  });
}

// sub_802AFFC: one in two never meets the ground, and the others only every fourth frame
function bounce(ring, x, y) {
  if (ring.velY > 0 && !(ring.turn & 7)) {
    const gap = tileUpDown(y, x, ring.layer, 8);
    if (gap <= 0) {
      ring.y += gap * 256;
      ring.velY = s16((ring.velY >> 2) - ring.velY);
    }
  }
  ring.velY = s16(ring.velY + LOOSE_GRAVITY);
}

// sub_802B160: it blinks in its last half second
function drawLooseRing(stage, s, ring, x, y) {
  if (x + 7 < 0 || x + 7 >= 255 || y <= -TILE || y >= 0xA8) return;
  if (ring.life <= BLINKS_FROM && stage.timer & 2) return;
  s.oamBaseIndex = 0xFF;
  s.x = x;
  s.y = y;
  displaySprite(stage.c, s);
}

// what a sprite's frame says about where its anchor is
function spriteOffset(c, s) {
  const { rom } = c, tables = 0x3314F0;
  const list = rom.u32(rom.u32(tables + 4) - 0x08000000 + s.anim * 4) - 0x08000000;
  const d = list + (s.frameNum >>> 28 === 0 ? s.frameNum * 12 : (s.frameNum & 0xFFFFFFF) * 16);
  return { x: rom.s16(d + 8), y: rom.s16(d + 10) };
}
