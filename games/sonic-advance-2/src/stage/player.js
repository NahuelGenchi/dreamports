// The character, written from how the original's player code behaves, as read in its decompilation. So far: Sonic where a
// stage puts him, running, turning and braking on the ground, crouching, rolling and his spin dash, jumping, falling and
// landing, and what he meets on the way. What the attack and trick buttons do, and looking up, aren't made yet, nor the boost
// that long running at his top speed brings.

import { createSprite, updateSprite, displaySprite, transformSprite, ANIM_OVER, SPRITE } from '../sprite.js';
import { groundUpDown, groundSideways } from './collision.js';
import { KEY } from '../core.js';
import { SINE, sin8, cos8, arcTan2 } from './trig.js';

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const SPAWNS = 0xD6374, FIRST_ANIMATIONS = 0xD672C, STATE_ANIMATIONS = 0xD6736;
const HALF_WIDTH = 6, HALF_HEIGHT = 14, HALF_HEIGHT_CURLED = 9;
const JUMP_BUTTONS = KEY.A | KEY.B | KEY.R;   // what the original's held buttons start as, gPlayerControls's jump, attack and trick
const CAMERA_LEFT_OF_PLACE = 120, CAMERA_ABOVE_PLACE = 80;
const JUMP_BUTTON = KEY.A, DPAD = KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT;
/** What a character's `flags` say. */
export const FLAG = { FACING_LEFT: 0x1, IN_AIR: 0x2, CURLED: 0x4, NO_AIR_STEERING: 0x10, AT_WALL: 0x20, JUMPED: 0x100, SPIN_DASHING: 0x400, BUTTONS_OFF: 0x200000 };
const { FACING_LEFT, IN_AIR, CURLED, NO_AIR_STEERING, AT_WALL, JUMPED, SPIN_DASHING, BUTTONS_OFF } = FLAG;
/** The states an animation can be chosen by, as sCharStateAnimInfo lists them. */
export const STATE = { STANDING: 0, CROUCH: 2, SPIN_DASH: 3, ROLLING: 4, TURN_SLOW: 5, TURN_AFTER_BRAKE: 6, BRAKE: 7, BRAKE_FAST: 8, RUNNING: 9, JUMP: 10, JUMP_FAST: 11 };

const ACCELERATIONS = [8, 12, 14, 16, 18], BRAKING = 64;   // playerBoostPhysicsTable's, for each boostThreshold
const TOP_SPEED = 6 * PX, SPEED_LIMIT = 9 * PX, SPEED_LIMIT_CURLED = 15 * PX, FALL_LIMIT = 15 * PX, GRAVITY = 42, COAST = 8;
const JUMP = 4.875 * PX, JUMP_LET_GO = 3 * PX, JUMP_FAST_FROM = 1.25 * PX, SE_JUMP = 116, NEEDS_ROOM = 4;
const SEES_GROUND_WITHIN = 32, ONE_WAY_UNDER = 3 * PX, ONE_WAY = 0x80;
const ROLL_BRAKING = 24, ROLL_TURNS = 96, ROLL_COAST = 8, ROLL_STOPS_UNDER = 128, ROLLS_FROM = 128;
const SE_SPIN_ATTACK = 109, SE_SPIN_DASH_RELEASE = 110;
const SPIN_DASH_FIRST = 6 * PX, SPIN_DASH_STEP = 0.375 * PX, SPIN_DASH_CHARGE = 2 * PX, SPIN_DASH_MOST = 8;
const BRAKES_FROM = 2 * PX, SLIPS_UNDER = 1.875 * PX, SLIP_FRAMES = 30, SE_BRAKE = 115;
const LEAVES_GROUND = 11, GAIT_TOPS = [1.25 * PX, 2.5 * PX, 4 * PX, 9 * PX, 10 * PX];
const DUST = { tiles: 0x10000 + 0x2300, anim: 848, order: 8, most: 20 };
const SPIN_DASH_DUST = { tiles: 20, anim: 846, big: 847, order: 8, bigOver: 2 * PX };

const pixel = v => v >> 8;
const byte = v => v & 0xFF;
const s8 = v => (v << 24) >> 24;
const s16 = v => (v << 16) >> 16;
const steep = angle => (byte(angle + 0x20) & 0xC0) !== 0;

/** The character's animations, for those who set one by themselves (countdown.js). */
export const playerAnimations = c => c.rom.s16(FIRST_ANIMATIONS);

/** 0x08021604 and 0x08021694, what a stage starts a character with. */
export function createPlayer(stage, level) {
  const { c } = stage, { rom } = c, at = SPAWNS + level * 4;
  const p = {
    stage, x: rom.s16(at) * PX, y: rom.s16(at + 2) * PX, velX: 0, velY: 0, groundSpeed: 0, flags: BUTTONS_OFF,
    halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT, layer: 1, angle: 0, state: STATE.STANDING, shownState: -1, animation: -1, variant: -1, restart: false,
    held: JUMP_BUTTONS, pressed: JUMP_BUTTONS, gait: 0, slipFrames: 0, behave: touchGround, dustLeft: DUST.most, speedLimit: SPEED_LIMIT, acceleration: ACCELERATIONS[0], spinDashCharge: 0,
    sprite: createSprite({ tiles: 0x10000, anim: 0xFFFF, variant: 0xFF, oamFlags: 16 << 6, frameFlags: 0x2000 | SPRITE.ROT_SCALE_ENABLE }),
    turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 0, y: 0 },
  };
  c.createTask(frame, p, 0x3000);
  return p;
}

/** Somewhere else in the stage, with the camera there too, for a recording's start point. */
export function placePlayer(stage, x, y) {
  stage.player.x = x * PX;
  stage.player.y = y * PX;
  stage.camera.x = x - CAMERA_LEFT_OF_PLACE;
  stage.camera.y = y - CAMERA_ABOVE_PLACE;
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

// Player_TransitionCancelFlyingAndBoost, of what can be going on so far
const stopWhatItWasDoing = p => { p.flags &= ~(AT_WALL | JUMPED | NO_AIR_STEERING | SPIN_DASHING); };

// the animation's place among the character's, by its state's number
const animationIs = (p, state) => p.animation - playerAnimations(p.stage.c) === state;

// Player_TouchGround: on its feet, running if it's moving
function touchGround(p) {
  stopWhatItWasDoing(p);
  p.flags &= ~(IN_AIR | CURLED);
  setHeight(p, HALF_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.state = p.groundSpeed !== 0 ? STATE.RUNNING : STATE.STANDING;
  p.behave = onGround;
  onGround(p);
}

// Player_Idle, which is all of its time on the ground, without looking up and the attack button
function onGround(p) {
  if (tryCrouchOrRoll(p) || tryJump(p)) return;
  steerOnGround(p);
  slopeAndMove(p);
}

// Player_8025548: turning round, on the spot, until the animation has ended
function turningRound(p) {
  if (tryCrouchOrRoll(p) || tryJump(p)) return;
  if (p.sprite.frameFlags & ANIM_OVER) p.behave = touchGround;
  slopeAndMove(p);
}

// Player_TryCrouchOrSpinAttack: down, and nothing else on the d-pad. What it starts takes over on the next frame
function tryCrouchOrRoll(p) {
  if ((p.held & DPAD) !== KEY.DOWN || p.flags & (CURLED | IN_AIR)) return false;
  if (p.groundSpeed === 0 && !steep(p.angle)) p.behave = startCrouching;
  else if (Math.abs(p.groundSpeed) >= ROLLS_FROM) {
    p.behave = startRolling;
    p.stage.c.playSong(SE_SPIN_ATTACK);
  } else return false;
  return true;
}

// sub_8022F58: how far the ground is, the way it's looking, from both sides of its feet, head or back
function roomTowards(p, direction) {
  switch (byte(direction + 0x20) >> 6) {
    case 0: return groundBelow(p).gap;
    case 1: return sideRoom(p, -1);
    case 2: return groundAbove(p).gap;
    default: return sideRoom(p, 1);
  }
}

// sub_802195C and sub_8021A34: its head and its feet, against a wall on one side
function sideRoom(p, side) {
  const x = pixel(p.x) + side * (2 + p.halfWidth), y = pixel(p.y), layer = p.velY < ONE_WAY_UNDER ? p.layer | ONE_WAY : p.layer;
  return Math.min(groundSideways(x, y - p.halfHeight, layer, side * 8), groundSideways(x, y + p.halfHeight, layer, side * 8));
}

// the ground from both sides of a line across it, with the angle of the nearer. It keeps the second's when they're as far
function nearerOfTwo(from, x, reach, layer, stride) {
  const first = [0], second = [0];
  const left = groundUpDown(from, x - reach, layer, stride, first), right = groundUpDown(from, x + reach, layer, stride, second);
  const found = left < right ? first[0] : second[0];
  return { gap: Math.min(left, right), other: Math.max(left, right), angle: found & 1 ? 0 : found };
}

// sub_8029B0C, sub_8029BB8: what's under its feet
const groundBelow = p => nearerOfTwo(pixel(p.y) + p.halfHeight, pixel(p.x), 2 + p.halfWidth, p.velY < 0 ? p.layer | ONE_WAY : p.layer, 8);
// sub_8029AC0, sub_8021B08: what's over its head
const groundAbove = p => nearerOfTwo(pixel(p.y) - p.halfHeight, pixel(p.x), 2 + p.halfWidth, p.velY < ONE_WAY_UNDER ? p.layer | ONE_WAY : p.layer, -8);

// Player_TryJump: the button, with room above it. The jump starts on the next frame
function tryJump(p) {
  if (!(p.pressed & JUMP_BUTTON) || roomTowards(p, byte(p.angle + 0x80)) < NEEDS_ROOM) return false;
  p.behave = startJump;
  return true;
}

// Player_InitJump
function startJump(p) {
  stopWhatItWasDoing(p);
  p.flags |= JUMPED | IN_AIR;
  if (p.flags & CURLED) p.flags |= NO_AIR_STEERING;
  p.state = Math.abs(p.velX) < JUMP_FAST_FROM ? STATE.JUMP : STATE.JUMP_FAST;
  const up = byte(p.angle - 0x40) * 4;
  p.velX += (cos8(up) * JUMP) >> 8;
  p.velY += (sin8(up) * JUMP) >> 8;
  p.sprite.frameFlags &= ~ANIM_OVER;
  p.stage.c.playSong(SE_JUMP);
  p.behave = inAir;
  inAir(p);
}

// Player_InitCrouch and Player_Crouch: down until it's let go, as the animation ends, or something else is pressed
function startCrouching(p) {
  p.flags &= ~AT_WALL;
  p.state = STATE.CROUCH;
  p.groundSpeed = 0;
  p.behave = crouching;
  crouching(p);
}

function crouching(p) {
  const crouched = animationIs(p, STATE.CROUCH);
  if (p.state === STATE.CROUCH && p.pressed & JUMP_BUTTON) {
    startSpinDash(p);
    return;
  }
  if (tryJump(p)) return;
  const dpad = p.held & DPAD;
  if (dpad === 0) {
    if (crouched && p.variant === 0) {
      p.variant = 1;
      p.sprite.frameFlags &= ~ANIM_OVER;
    }
  } else if (dpad !== KEY.DOWN) p.behave = touchGround;
  if (crouched && p.variant === 1 && p.sprite.frameFlags & ANIM_OVER) p.behave = touchGround;
  slopeAndMove(p);
}

// Player_InitSpindash
function startSpinDash(p) {
  p.state = STATE.SPIN_DASH;
  p.flags = (p.flags | SPIN_DASHING | CURLED) & ~(AT_WALL | IN_AIR);
  setHeight(p, HALF_HEIGHT_CURLED);
  p.spinDashCharge = 0;
  p.velX = p.velY = p.groundSpeed = 0;
  p.stage.c.playSong(SE_SPIN_ATTACK);
  raiseSpinDashDust(p);
  p.behave = spinDashing;
  spinDashing(p);
}

// Player_Spindash: each press charges it, it goes down by itself, and letting go of down sends it off, on the next frame
function spinDashing(p) {
  if (!(p.held & KEY.DOWN)) {
    p.flags &= ~SPIN_DASHING;
    const speed = SPIN_DASH_FIRST + Math.min(p.spinDashCharge >> 8, SPIN_DASH_MOST) * SPIN_DASH_STEP;
    p.groundSpeed = p.flags & FACING_LEFT ? -speed : speed;
    p.behave = startRolling;
    p.stage.c.playSong(SE_SPIN_DASH_RELEASE);
  } else {
    let charge = p.spinDashCharge;
    if (charge !== 0) charge = Math.max(charge - ((charge << 3) >> 8), 0);
    if (p.pressed & JUMP_BUTTON) {
      p.stage.c.playPitched(SE_SPIN_ATTACK, charge & ~0x7F);
      charge = Math.max(charge + SPIN_DASH_CHARGE, SPIN_DASH_MOST * PX);
      p.variant = 1;
      p.restart = true;
    }
    p.spinDashCharge = charge;
    if (animationIs(p, STATE.SPIN_DASH) && p.variant === 1 && p.sprite.frameFlags & ANIM_OVER) p.variant = 0;
  }
  if (p.flags & IN_AIR) {
    drag(p);
    keepInBounds(p);
    p.velY += GRAVITY;
    move(p);
    levelOut(p);
    meetGroundInAir(p);
    return;
  }
  rollDownSlope(p);
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  move(p);
  settleOnGround(p);
  slipOff(p);
}

// Player_SpinAttack
function startRolling(p) {
  p.sprite.frameFlags &= ~ANIM_OVER;
  p.state = STATE.ROLLING;
  setHeight(p, HALF_HEIGHT_CURLED);
  p.halfWidth = HALF_WIDTH;
  p.flags |= CURLED;
  p.behave = rolling;
  rolling(p);
}

// the steeper the ground, the faster downhill and, by a quarter of that, the slower uphill
function rollDownSlope(p) {
  if (byte(p.angle + 0x60) >= 0xC0 || p.groundSpeed === 0) return;
  let slope = (sin8(p.angle * 4) * 60) >> 8;
  if (p.groundSpeed > 0 ? slope <= 0 : slope >= 0) slope >>= 2;
  p.groundSpeed += slope;
}

// Player_Rolling
function rolling(p) {
  if (tryJump(p)) return;
  if (p.slipFrames === 0) {
    const sideways = p.held & (KEY.LEFT | KEY.RIGHT), speed = p.groundSpeed;
    if (sideways === KEY.LEFT) {
      if (speed <= 0) p.flags |= FACING_LEFT;
      else p.groundSpeed = speed - ROLL_BRAKING < 0 ? -ROLL_TURNS : speed - ROLL_BRAKING;
    } else if (sideways === KEY.RIGHT) {
      if (speed >= 0) p.flags &= ~FACING_LEFT;
      else p.groundSpeed = speed + ROLL_BRAKING > 0 ? ROLL_TURNS : speed + ROLL_BRAKING;
    }
  }
  p.groundSpeed -= Math.sign(p.groundSpeed) * ROLL_COAST;
  if (Math.abs(p.groundSpeed) < ROLL_STOPS_UNDER) p.groundSpeed = 0;
  if (p.groundSpeed === 0) {
    p.behave = touchGround;
    touchGround(p);
    return;
  }
  rollDownSlope(p);
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  if (p.flags & IN_AIR) p.velY += GRAVITY;
  move(p);
  settleOnGround(p);
  slipOff(p);
  if (p.flags & IN_AIR) p.behave = inAir;
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

// sub_8023260: at most its speed limit, along the ground it's on
function alongGround(p) {
  p.groundSpeed = Math.max(-p.speedLimit, Math.min(p.speedLimit, p.groundSpeed));
  p.velX = (cos8(p.angle * 4) * p.groundSpeed) >> 8;
  if (!(p.flags & IN_AIR)) p.velY = 0;
  p.velY += (sin8(p.angle * 4) * p.groundSpeed) >> 8;
}

// PLAYERFN_UPDATE_UNK2A: too steep and too slow, it comes off, and the d-pad does nothing for a while
function slipOff(p) {
  if (p.slipFrames !== 0) p.slipFrames--;
  else if (steep(p.angle) && Math.abs(p.groundSpeed) < SLIPS_UNDER) {
    p.groundSpeed = 0;
    p.flags |= IN_AIR;
    p.slipFrames = SLIP_FRAMES;
  }
}

// what comes after steering, on the ground: the slope, then its place, and the ground under it
function slopeAndMove(p) {
  if (byte(p.angle + 0x60) < 0xC0 && p.groundSpeed !== 0) p.groundSpeed += (sin8(p.angle * 4) * 3) >> 5;
  keepInBounds(p);
  alongGround(p);
  move(p);
  settleOnGround(p);
  slipOff(p);
  if (p.flags & IN_AIR) p.behave = inAir;
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
        p.groundSpeed = p.flags & FACING_LEFT ? -p.acceleration : p.acceleration;
        state = STATE.RUNNING;
        setHeight(p, HALF_HEIGHT);
        p.halfWidth = HALF_WIDTH;
      } else p.behave = startTurning;
    } else if (speed > 0 ? right : left) {
      if (Math.abs(speed) < TOP_SPEED) p.groundSpeed = way * Math.min(Math.abs(speed) + p.acceleration, TOP_SPEED);
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

// sub_80236C8: going up, it loses a little of its speed along the way
function drag(p) {
  if (p.velY >= 0) return;
  const part = s16(p.velX) >> 5;
  if (part < 0) p.velX = Math.min(p.velX - part, 0);
  else if (part > 0) p.velX = Math.max(p.velX - part, 0);
}

// Player_AirInputControls: twice what it has on the ground, up to its top speed, and it never slows down what's above that
function steerInAir(p) {
  if (p.flags & NO_AIR_STEERING) return;
  const step = p.acceleration * 2;
  if (p.held & KEY.LEFT) {
    p.flags |= FACING_LEFT;
    const faster = p.velX - step;
    if (faster >= -TOP_SPEED) p.velX = faster;
    else if (p.velX > -TOP_SPEED) p.velX = -TOP_SPEED;
  } else if (p.held & KEY.RIGHT) {
    p.flags &= ~FACING_LEFT;
    const faster = p.velX + step;
    if (faster <= TOP_SPEED) p.velX = faster;
    else if (p.velX < TOP_SPEED) p.velX = TOP_SPEED;
  }
}

// sub_80246DC: the jump's animation curls up as it ends, and uncurls with the ground coming near as it falls
function jumpAnimation(p) {
  if (p.state !== STATE.JUMP && p.state !== STATE.JUMP_FAST) return;
  if (!animationIs(p, STATE.JUMP) && !animationIs(p, STATE.JUMP_FAST)) return;
  if (p.variant === 0 && p.sprite.frameFlags & ANIM_OVER) {
    p.variant = 1;
    p.flags |= CURLED;
    setHeight(p, HALF_HEIGHT_CURLED);
    p.halfWidth = HALF_WIDTH;
  } else if (p.velY > 0 && p.variant === 1 && groundUpDown(pixel(p.y) + p.halfHeight, pixel(p.x), p.layer, 8, null, 5) <= SEES_GROUND_WITHIN) p.variant = 2;
}

// PLAYERFN_UPDATE_ROTATION: back to level, as it's in the air
function levelOut(p) {
  const tilt = s8(p.angle);
  p.angle = byte(tilt < 0 ? Math.min(tilt + 2, 0) : Math.max(tilt - 2, 0));
}

// Player_Jumping, which is all of its time in the air
function inAir(p) {
  if (p.flags & JUMPED && p.velY < -JUMP_LET_GO && !(p.held & JUMP_BUTTON)) p.velY = -JUMP_LET_GO;
  jumpAnimation(p);
  steerInAir(p);
  drag(p);
  keepInBounds(p);
  p.velY += GRAVITY;
  move(p);
  levelOut(p);
  meetGroundInAir(p);
}

// sub_8021BE0: on the ground again, on its feet
function land(p) {
  p.behave = touchGround;
  p.flags &= ~(NO_AIR_STEERING | IN_AIR);
  if (p.flags & CURLED) {
    p.flags &= ~CURLED;
    setHeight(p, HALF_HEIGHT);
  }
  p.halfWidth = HALF_WIDTH;
  p.halfHeight = HALF_HEIGHT;
}

// the walls on both sides of it, in sub_8021C4C and sub_8021DB8, which stop it and push it out
function wallsBothSides(p) {
  const layer = p.velY < ONE_WAY_UNDER ? p.layer | ONE_WAY : p.layer;
  let gap = groundSideways(pixel(p.x) - (3 + p.halfWidth), pixel(p.y), layer, -8);
  if (gap <= 0) {
    p.x -= gap * PX;
    p.velX = 0;
  }
  gap = groundSideways(pixel(p.x) + (3 + p.halfWidth), pixel(p.y), layer, 8);
  if (gap <= 0) {
    p.x += gap * PX;
    p.velX = 0;
  }
}

// sub_8021C4C: going down, it lands on what's under it, and how much of its speed it keeps is by how steep that is
function meetGroundFalling(p) {
  wallsBothSides(p);
  const { gap, other, angle } = groundBelow(p);
  if (gap >= 0) return;
  const limit = -(pixel(p.velY) + 6);
  if (gap < limit && other < limit) return;
  p.angle = angle;
  p.y += gap * PX;
  land(p);
  if ((angle + 32) & 0x40) {
    p.velX = 0;
    p.velY = Math.min(p.velY, 11.8125 * PX);
  } else if (!((angle + 16) & 0x20)) {
    p.velY = 0;
    p.groundSpeed = p.velX;
    return;
  } else p.velY >>= 1;
  p.groundSpeed = s8(angle) < 0 ? -Math.abs(p.velY) : Math.abs(p.velY);
}

// sub_8021DB8: going up, a ceiling stops it, unless it's steep enough to run on from there
function meetGroundRising(p) {
  wallsBothSides(p);
  const { gap, angle } = groundAbove(p);
  if (gap > 0) return;
  p.y -= gap * PX;
  if ((angle + 32) & 0x40 && s8(angle) - 0x40 > 0) {
    p.angle = angle;
    land(p);
    p.groundSpeed = Math.abs(p.velY);
    return;
  }
  p.velY = 0;
}

// sub_8021EE4 and sub_802203C: going sideways, the wall on that side, then its head, then its feet
function meetGroundSideways(p, side) {
  const layer = p.velY < ONE_WAY_UNDER ? p.layer | ONE_WAY : p.layer;
  const wall = groundSideways(pixel(p.x) + side * (3 + p.halfWidth), pixel(p.y), layer, side * 8);
  if (wall <= 0) {
    p.x += side * wall * PX;
    p.velX = 0;
    p.groundSpeed = p.velY;
  }
  const above = groundAbove(p);
  if (above.gap <= 0) {
    p.y -= above.gap * PX;
    if (p.velY < 0) p.velY = 0;
  } else if (p.velY >= 0) {
    const below = groundBelow(p);
    if (below.gap <= 0) {
      p.y += below.gap * PX;
      p.angle = below.angle;
      land(p);
      p.velY = 0;
      p.groundSpeed = p.velX;
    }
  }
}

// sub_8022190: which way it's going says what it can meet
function meetGroundInAir(p) {
  const vx = s16(p.velX), vy = s16(p.velY), going = vx !== 0 || vy !== 0 ? byte(arcTan2(vx, vy) >> 8) : 0;
  switch (byte(going - 0x20) >> 6) {
    case 0: meetGroundFalling(p); break;
    case 2: meetGroundRising(p); break;
    case 1: meetGroundSideways(p, -1); break;
    default: meetGroundSideways(p, 1);
  }
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

// CreateSpindashDustEffect, with Task_SpindashDustEffect and Task_SpindashDustEffectBig: dust at its feet while it charges,
// and more of it when the charge is high
function raiseSpinDashDust(p) {
  const { stage } = p, { c } = stage, tiles = stage.allocTiles(SPIN_DASH_DUST.tiles);
  const s = createSprite({ tiles, anim: SPIN_DASH_DUST.anim, oamFlags: SPIN_DASH_DUST.order << 6, frameFlags: 2 << 12 });
  c.createTask(t => {
    if (!(p.flags & SPIN_DASHING)) {
      stage.freeTiles(tiles);
      c.destroyTask(t);
      return;
    }
    const anim = p.spinDashCharge > SPIN_DASH_DUST.bigOver ? SPIN_DASH_DUST.big : SPIN_DASH_DUST.anim;
    if (s.anim !== anim) {
      s.anim = anim;
      s.variant = 0;
      s.prevVariant = 0xFF;
    }
    s.x = pixel(p.x) - stage.camera.x;
    s.y = pixel(p.y) + p.halfHeight - stage.camera.y;
    if (p.flags & FACING_LEFT) s.frameFlags &= ~SPRITE.X_FLIP;
    else s.frameFlags |= SPRITE.X_FLIP;
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

// 0x0802989C, Player_HandleBoostThreshold: the more rings it has, the quicker it gets going
function boostThreshold(rings) {
  if (rings >= 150) return 4;
  if (rings >= 100) return 3;
  if (rings >= 50) return 2;
  return rings > 10 ? 1 : 0;
}

// Task_PlayerMain: a frame of it
function frame(t) {
  const p = t.data, { c } = p.stage;
  p.acceleration = ACCELERATIONS[boostThreshold(p.stage.rings)];
  p.speedLimit = p.flags & CURLED ? SPEED_LIMIT_CURLED : SPEED_LIMIT;   // Player_ApplyBoostPhysics
  chooseGait(p);
  readButtons(p, c.input);
  p.behave(p);
  chooseAnimation(c, p);
  draw(c, p);
}
