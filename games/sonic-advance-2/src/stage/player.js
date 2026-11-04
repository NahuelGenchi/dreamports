// The character, written from how the original's player code behaves, as read in its decompilation. So far: Sonic where a
// stage puts him, with the ground under his feet, and the animation his state asks for. Running, jumping and the rest
// of what he does aren't made yet.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../sprite.js';
import { groundUpDown } from './collision.js';

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const SPAWNS = 0xD6374, FIRST_ANIMATIONS = 0xD672C, STATE_ANIMATIONS = 0xD6736;
const HALF_WIDTH = 6, HALF_HEIGHT = 14;
const MAX_GAP = 11;
/** What a character's `flags` say. */
export const FLAG = { FACING_LEFT: 0x1, IN_AIR: 0x2, BUTTONS_OFF: 0x200000 };
const STANDING = 0;

/** The character's animations, for those who set one by themselves (countdown.js). */
export const playerAnimations = c => c.rom.s16(FIRST_ANIMATIONS);

/** 0x08021604 and 0x08021694, what a stage starts a character with. */
export function createPlayer(stage, level) {
  const { c } = stage, { rom } = c, at = SPAWNS + level * 4;
  const p = {
    stage, x: rom.s16(at) * PX, y: rom.s16(at + 2) * PX, velX: 0, velY: 0, groundSpeed: 0, flags: FLAG.BUTTONS_OFF,
    halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT, layer: 1, angle: 0, state: STANDING, shownState: -1, animation: -1, variant: -1, restart: false,
    sprite: createSprite({ tiles: 0x10000, anim: 0xFFFF, variant: 0xFF, oamFlags: 16 << 6, frameFlags: 0x2000 | SPRITE.ROT_SCALE_ENABLE }),
  };
  c.createTask(frame, p, 0x3000);
  return p;
}

// for as long as nothing moves him: he settles on the ground under his two feet
function settle(p) {
  const y = (p.y >> 8) + p.halfHeight, x = p.x >> 8, reach = p.halfWidth + 2;
  const gap = Math.min(groundUpDown(y, x - reach, p.layer, 8), groundUpDown(y, x + reach, p.layer, 8));
  if (gap <= MAX_GAP) p.y += gap * PX;
}

// 0x0802486C: the animation his state asks for, unless something set its own
function chooseAnimation(c, p) {
  const { rom } = c, s = p.sprite;
  if (p.state !== p.shownState) {
    p.animation = rom.u16(STATE_ANIMATIONS + p.state * 4) + rom.s16(FIRST_ANIMATIONS);
    p.variant = rom.u16(STATE_ANIMATIONS + p.state * 4 + 2);
    s.animSpeed = 0x10;
  }
  if (p.restart || s.anim !== p.animation || s.variant !== p.variant) {
    p.restart = false;
    s.anim = p.animation;
    s.variant = p.variant;
    s.prevVariant = 0xFF;
  }
  p.shownState = p.state;
}

// 0x08024B10: on the screen, facing the way he's going
function draw(c, p) {
  const s = p.sprite, cam = p.stage.camera;
  s.x = (p.x >> 8) - cam.x;
  s.y = (p.y >> 8) - cam.y;
  s.frameFlags &= ~(SPRITE.ROT_SCALE_ENABLE | SPRITE.ROT_SCALE | SPRITE.Y_FLIP);
  if (p.flags & FLAG.FACING_LEFT) {
    s.frameFlags &= ~SPRITE.X_FLIP;
    s.x++;
  } else s.frameFlags |= SPRITE.X_FLIP;
  updateSprite(c, s);
  displaySprite(c, s);
}

// a frame of him
function frame(t) {
  const p = t.data, { c } = p.stage;
  settle(p);
  chooseAnimation(c, p);
  draw(c, p);
}
