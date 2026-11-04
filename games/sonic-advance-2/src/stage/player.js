// The character, written from how the original's player code behaves, as read in its decompilation. So far: Sonic where a
// stage puts him, running, turning and braking on the ground, and falling back to it when it goes from under him. Jumping,
// crouching and the rest of what he does aren't made yet, nor the boost that long running at his top speed brings.

import { createSprite, updateSprite, displaySprite, transformSprite, ANIM_OVER, SPRITE } from '../sprite.js';
import { groundUpDown, groundSideways } from './collision.js';
import { KEY } from '../core.js';
import { SINE, sin8, cos8 } from './trig.js';

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const SPAWNS = 0xD6374, FIRST_ANIMATIONS = 0xD672C, STATE_ANIMATIONS = 0xD6736;
const HALF_WIDTH = 6, HALF_HEIGHT = 14;
const JUMP_BUTTONS = KEY.A | KEY.B | KEY.R;   // what the original's held buttons start as, gPlayerControls's jump, attack and trick
/** What a character's `flags` say. */
export const FLAG = { FACING_LEFT: 0x1, IN_AIR: 0x2, AT_WALL: 0x20, BUTTONS_OFF: 0x200000 };
const { FACING_LEFT, IN_AIR, AT_WALL, BUTTONS_OFF } = FLAG;
/** The states an animation can be chosen by, as sCharStateAnimInfo lists them. */
export const STATE = { STANDING: 0, TURN_SLOW: 5, TURN_AFTER_BRAKE: 6, BRAKE: 7, BRAKE_FAST: 8, RUNNING: 9 };

const ACCELERATION = 8, BRAKING = 64;   // playerBoostPhysicsTable's, as they are with few rings
const TOP_SPEED = 6 * PX, SPEED_LIMIT = 9 * PX, FALL_LIMIT = 15 * PX, GRAVITY = 42, COAST = 8;
const BRAKES_FROM = 2 * PX, SLIPS_UNDER = 1.875 * PX, SLIP_FRAMES = 30, SE_BRAKE = 115;
const LEAVES_GROUND = 11, GAIT_TOPS = [1.25 * PX, 2.5 * PX, 4 * PX, 9 * PX, 10 * PX];
const DUST = { tiles: 0x10000 + 0x2300, anim: 848, order: 8, most: 20 };

const pixel = v => v >> 8;
const byte = v => v & 0xFF;
const s8 = v => (v << 24) >> 24;
const steep = angle => (byte(angle + 0x20) & 0xC0) !== 0;

/** The character's animations, for those who set one by themselves (countdown.js). */
export const playerAnimations = c => c.rom.s16(FIRST_ANIMATIONS);

/** 0x08021604 and 0x08021694, what a stage starts a character with. */
export function createPlayer(stage, level) {
  const { c } = stage, { rom } = c, at = SPAWNS + level * 4;
  const p = {
    stage, x: rom.s16(at) * PX, y: rom.s16(at + 2) * PX, velX: 0, velY: 0, groundSpeed: 0, flags: BUTTONS_OFF,
    halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT, layer: 1, angle: 0, state: STATE.STANDING, shownState: -1, animation: -1, variant: -1, restart: false,
    held: JUMP_BUTTONS, pressed: JUMP_BUTTONS, gait: 0, slipFrames: 0, behave: touchGround, dustLeft: DUST.most,
    sprite: createSprite({ tiles: 0x10000, anim: 0xFFFF, variant: 0xFF, oamFlags: 16 << 6, frameFlags: 0x2000 | SPRITE.ROT_SCALE_ENABLE }),
    turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 0, y: 0 },
  };
  c.createTask(frame, p, 0x3000);
  return p;
}

// Player_HandleWalkAnim: how fast it's going, for the running animations
function chooseGait(p) {
  const speed = Math.abs(p.groundSpeed), gait = GAIT_TOPS.findIndex(top => speed <= top);
  p.gait = gait < 0 ? GAIT_TOPS.length : gait;
}

// Player_HandleInputs: the buttons a character is pressing, which stay as they were while its buttons are off, and which are new
function readButtons(p, input) {
  const before = p.held;
  if (!(p.flags & BUTTONS_OFF)) p.held = input;
  p.pressed = (before ^ p.held) & p.held;
}

// Player_HandleSpriteYOffsetChange: a new height, with its feet staying where they are
function setHeight(p, halfHeight) {
  if (p.halfHeight === halfHeight) return;
  const grown = (halfHeight - p.halfHeight) * PX, angle = p.angle !== 0 ? byte(p.angle + 0x1F) : 0x20;
  switch (angle >> 6) {
    case 0: p.y -= grown; break;
    case 1: p.x += grown; break;
    case 2: p.y += grown; break;
    default: p.x -= grown;
  }
  p.halfHeight = halfHeight;
}

// Player_TouchGround: on its feet, running if it's moving
function touchGround(p) {
  p.flags &= ~(IN_AIR | AT_WALL);
  setHeight(p, HALF_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.state = p.groundSpeed !== 0 ? STATE.RUNNING : STATE.STANDING;
  p.behave = onGround;
  onGround(p);
}

// Player_Idle, which is all of its time on the ground, without what the buttons other than left and right start
function onGround(p) {
  steerOnGround(p);
  moveAlongGround(p);
}

// Player_8025548: turning round, on the spot, until the animation has ended
function turningRound(p) {
  if (p.sprite.frameFlags & ANIM_OVER) p.behave = touchGround;
  moveAlongGround(p);
}

// Player_Skidding: it stops, and faces the other way
function startTurning(p) {
  p.flags &= ~AT_WALL;
  p.state = p.state === STATE.BRAKE || p.state === STATE.BRAKE_FAST ? STATE.TURN_AFTER_BRAKE : STATE.TURN_SLOW;
  p.sprite.frameFlags &= ~ANIM_OVER;
  p.groundSpeed = 0;
  p.flags ^= FACING_LEFT;
  p.behave = turningRound;
  turningRound(p);
}

// what comes after steering, on the ground: the slope, then its place, and the ground under it
function moveAlongGround(p) {
  if (byte(p.angle + 0x60) < 0xC0 && p.groundSpeed !== 0) p.groundSpeed += (sin8(p.angle * 4) * 3) >> 5;
  keepInBounds(p);
  // sub_8023260: at most its speed limit, along the ground it's on
  p.groundSpeed = Math.max(-SPEED_LIMIT, Math.min(SPEED_LIMIT, p.groundSpeed));
  p.velX = (cos8(p.angle * 4) * p.groundSpeed) >> 8;
  if (!(p.flags & IN_AIR)) p.velY = 0;
  p.velY += (sin8(p.angle * 4) * p.groundSpeed) >> 8;
  move(p);
  settleOnGround(p);
  // too steep and too slow, it comes off, and the d-pad does nothing for a while (PLAYERFN_UPDATE_UNK2A)
  if (p.slipFrames !== 0) p.slipFrames--;
  else if (steep(p.angle) && Math.abs(p.groundSpeed) < SLIPS_UNDER) {
    p.groundSpeed = 0;
    p.flags |= IN_AIR;
    p.slipFrames = SLIP_FRAMES;
  }
  if (p.flags & IN_AIR) p.behave = fall;
}

// PLAYERFN_UPDATE_POSITION
function move(p) {
  p.x += p.velX;
  p.velY = Math.min(p.velY, FALL_LIMIT);
  p.y += p.velY;
}

// sub_80232D0: the stage's edges are as far as it can go, and running into them stops it
function keepInBounds(p) {
  const cam = p.stage.camera;
  const x = Math.max(cam.minX * PX, Math.min(cam.maxX * PX - 1, p.x));
  const y = Math.max(cam.minY * PX, Math.min(cam.maxY * PX - 1, p.y));
  if (x !== p.x) p.velX = p.groundSpeed = 0;
  if (y !== p.y) p.velY = p.groundSpeed = 0;
  p.x = x;
  p.y = y;
}

// Player_HandleGroundMovement: what the d-pad does on the ground, and the state that goes with it
function steerOnGround(p) {
  const left = p.held & KEY.LEFT, right = p.held & KEY.RIGHT, speed = p.groundSpeed, way = speed > 0 ? 1 : -1;
  let state = -1;
  if (p.slipFrames === 0 && (left || right)) {
    if (speed === 0) {
      if (Boolean(p.flags & FACING_LEFT) !== Boolean(right)) {
        p.groundSpeed = p.flags & FACING_LEFT ? -ACCELERATION : ACCELERATION;
        state = STATE.RUNNING;
        setHeight(p, HALF_HEIGHT);
        p.halfWidth = HALF_WIDTH;
      } else p.behave = startTurning;
    } else if (speed > 0 ? right : left) {
      if (Math.abs(speed) < TOP_SPEED) p.groundSpeed = way * Math.min(Math.abs(speed) + ACCELERATION, TOP_SPEED);
      p.flags = speed > 0 ? p.flags & ~FACING_LEFT : p.flags | FACING_LEFT;
    } else if (Math.abs(speed) >= BRAKES_FROM) {
      const braking = p.state === STATE.BRAKE || p.state === STATE.BRAKE_FAST;
      state = braking ? p.state : p.gait > 3 ? STATE.BRAKE_FAST : STATE.BRAKE;
      p.groundSpeed -= way * BRAKING;
      raiseDust(p);
      p.stage.c.playSong(SE_BRAKE);
    } else {
      p.groundSpeed -= way * BRAKING;
      const forwards = speed > 0 ? !(p.flags & FACING_LEFT) : p.flags & FACING_LEFT;
      if (Math.sign(p.groundSpeed) === way && forwards) {
        if (p.state === STATE.BRAKE || p.state === STATE.BRAKE_FAST) state = STATE.BRAKE;
        p.behave = startTurning;
      }
    }
  } else if (speed !== 0) {
    const slower = Math.abs(speed) - COAST;
    state = slower <= 0 ? STATE.STANDING : STATE.RUNNING;
    p.groundSpeed = slower <= 0 ? 0 : way * slower;
  } else state = STATE.STANDING;
  if (state !== -1) p.state = state;
  else if (p.state === STATE.BRAKE || p.state === STATE.BRAKE_FAST) p.state = STATE.RUNNING;
  stopAtWalls(p);
}

// sub_802302C: how far the ground is, the way it's looking
function distanceAhead(p, direction) {
  const x = pixel(p.x), y = pixel(p.y), reach = p.halfWidth + 2, signed = s8(direction);
  const inHalf = byte(direction + 0x20) >= 1 && byte(direction + 0x20) <= 0x7F;
  const near = byte(direction + (inHalf === signed <= 0 ? 0x20 : 0x1F));
  switch (near >> 6) {
    case 0: return groundUpDown(y + reach, x, p.layer, 8);
    case 2: return groundUpDown(y - reach, x, p.layer, -8);
    case 1: return groundSideways(x - reach, y, p.layer, -8);
    default: return groundSideways(x + reach, y, p.layer, 8);
  }
}

// sub_8023128: ground in the way it's going stops it and pushes it out
function stopAtWalls(p) {
  if (p.groundSpeed === 0) return;
  const direction = byte(p.angle + (p.groundSpeed < 0 ? 0x40 : -0x40));
  const gap = distanceAhead(p, direction) * PX;
  if (gap > 0) return;
  switch (byte(direction + 0x20) >> 6) {
    case 0:
      p.y += gap;
      p.velY = 0;
      break;
    case 1:
      p.x -= gap;
      p.velX = p.groundSpeed = 0;
      p.flags |= AT_WALL;
      break;
    case 2:
      p.y -= gap;
      p.velY = 0;
      p.flags |= IN_AIR;
      break;
    default:
      p.x += gap;
      p.velX = p.groundSpeed = 0;
      p.flags |= AT_WALL;
  }
}

// sub_8022D6C, and sub_80228C0, sub_80229EC, sub_8022B18 and sub_8022C44 for each surface it can be on: on to where the
// ground is now, with its angle, unless the ground has gone from under it
function settleOnGround(p) {
  const signed = s8(p.angle);
  const surface = byte(p.angle + (signed <= 0 ? 0x20 : 0x1F)) >> 6;
  const upDown = surface === 0 || surface === 2, towards = surface === 0 || surface === 3 ? 1 : -1;
  // the foot it looks at first, which keeps its angle when both are as far
  const firstFoot = surface === 0 || surface === 1 ? -1 : 1;
  const along = pixel(upDown ? p.y : p.x) + towards * p.halfHeight, centre = pixel(upDown ? p.x : p.y);
  const find = upDown ? groundUpDown : groundSideways;
  const firstAngle = [0], secondAngle = [0], reach = 2 + p.halfWidth;
  const first = find(along, centre + firstFoot * reach, p.layer, towards * 8, firstAngle);
  const second = find(along, centre - firstFoot * reach, p.layer, towards * 8, secondAngle);
  const gap = Math.min(first, second);
  if (gap < -LEAVES_GROUND) return;
  if (gap > 0 && gap > Math.min(pixel(Math.abs(upDown ? p.velX : p.velY)) + 3, LEAVES_GROUND)) {
    p.flags = (p.flags | IN_AIR) & ~AT_WALL;
    return;
  }
  if (upDown) p.y += towards * gap * PX;
  else p.x += towards * gap * PX;
  const angle = first < second ? firstAngle[0] : secondAngle[0];
  if (!(angle & 1)) p.angle = angle;
}

// A part of Player_Jumping: only falling back to the ground, as far as running needs it. How it steers in the air, and what it
// meets on the way, are A character jumping's.
function fall(p) {
  keepInBounds(p);
  p.velY += GRAVITY;
  move(p);
  const tilt = s8(p.angle);
  p.angle = byte(tilt < 0 ? Math.min(tilt + 2, 0) : Math.max(tilt - 2, 0));
  if (p.velY < 0) return;
  // sub_8021C4C, what's under its two sides
  const from = pixel(p.y) + p.halfHeight, x = pixel(p.x), reach = 2 + p.halfWidth, angle = [0], other = [0];
  const left = groundUpDown(from, x - reach, p.layer, 8, angle), right = groundUpDown(from, x + reach, p.layer, 8, other);
  const gap = Math.min(left, right);
  if (gap >= 0) return;
  const found = left < right ? angle[0] : other[0];
  const limit = -(pixel(p.velY) + 6);
  if (gap < limit && Math.max(left, right) < limit) return;
  p.y += gap * PX;
  p.angle = found & 1 ? 0 : found;
  // sub_8021BE0, and how much of its speed it keeps as it lands, by how steep the ground is
  p.flags &= ~IN_AIR;
  p.behave = touchGround;
  if (byte(found + 32) & 0x40) {
    p.velX = 0;
    p.velY = Math.min(p.velY, 11.8125 * PX);
  } else if (!(byte(found + 16) & 0x20)) {
    p.velY = 0;
    p.groundSpeed = p.velX;
    return;
  } else p.velY >>= 1;
  p.groundSpeed = s8(found) < 0 ? -Math.abs(p.velY) : Math.abs(p.velY);
}

// sub_8029FA4, CreateBrakingDustEffect and Task_BrakingDustEffect: as it brakes, every fourth frame, a puff that stays where it
// starts, up to twenty of them at a time, each turned at random
function raiseDust(p) {
  const { stage } = p, { c } = stage;
  if (stage.frames & 3 || p.dustLeft === 0) return;
  p.dustLeft--;
  const flips = stage.random() & (SPRITE.X_FLIP | SPRITE.Y_FLIP);
  const s = createSprite({ tiles: DUST.tiles, anim: DUST.anim, oamFlags: DUST.order << 6, frameFlags: (2 << 12) | flips });
  const x = pixel(p.x), y = pixel(p.y) + p.halfHeight;
  c.createTask(t => {
    if (s.frameFlags & ANIM_OVER) {
      p.dustLeft++;
      c.destroyTask(t);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x4001);
}

// 0x0802486C: the animation its state asks for, unless something set its own
function chooseAnimation(c, p) {
  const { rom } = c, s = p.sprite;
  if (p.state !== p.shownState) {
    p.animation = rom.u16(STATE_ANIMATIONS + p.state * 4) + rom.s16(FIRST_ANIMATIONS);
    p.variant = rom.u16(STATE_ANIMATIONS + p.state * 4 + 2);
    s.animSpeed = 0x10;
  }
  if (p.state === STATE.RUNNING) {
    p.animation = rom.u16(STATE_ANIMATIONS + p.state * 4) + rom.s16(FIRST_ANIMATIONS);
    p.variant = p.gait;
    s.animSpeed = Math.max(8, Math.min(0x80, Math.abs((p.groundSpeed >> 5) + (p.groundSpeed >> 6))));   // the faster, the quicker its legs
  }
  if (p.restart || s.anim !== p.animation || s.variant !== p.variant) {
    p.restart = false;
    s.anim = p.animation;
    s.variant = p.variant;
    s.prevVariant = 0xFF;
  }
  p.shownState = p.state;
}

// 0x08024B10: on the screen. Running it leans with the ground, and otherwise it only faces the way it's going
function draw(c, p) {
  const s = p.sprite, cam = p.stage.camera, { turn } = p;
  s.x = pixel(p.x) - cam.x;
  s.y = pixel(p.y) - cam.y;
  if (p.state === STATE.RUNNING) {
    s.frameFlags = (s.frameFlags & ~(SPRITE.X_FLIP | SPRITE.Y_FLIP | SPRITE.ROT_SCALE)) | SPRITE.ROT_SCALE_ENABLE;
    turn.rotation = p.angle << 2;
    turn.scaleX = p.flags & FACING_LEFT ? PX : -PX;
    turn.scaleY = PX;
    turn.x = p.flags & FACING_LEFT ? s.x : s.x - 1;
    turn.y = s.y;
    updateSprite(c, s);
    transformSprite(c, s, turn, SINE);
  } else {
    s.frameFlags &= ~(SPRITE.ROT_SCALE_ENABLE | SPRITE.ROT_SCALE | SPRITE.Y_FLIP);
    if (p.flags & FACING_LEFT) {
      s.frameFlags &= ~SPRITE.X_FLIP;
      s.x++;
    } else s.frameFlags |= SPRITE.X_FLIP;
    updateSprite(c, s);
  }
  displaySprite(c, s);
}

// Task_PlayerMain: a frame of it
function frame(t) {
  const p = t.data, { c } = p.stage;
  chooseGait(p);
  readButtons(p, c.input);
  p.behave(p);
  chooseAnimation(c, p);
  draw(c, p);
}
