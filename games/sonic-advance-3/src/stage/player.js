// The characters, written from how the original's player code behaves, as read in its decompilation. Each frame a
// character does what its `behave` says, which moves it and works out what it stands on, and then it's drawn with the
// animation its `pose` asks for. So far: coming out of the ring, running, braking, turning round, standing and falling,
// with the partner pressing its own buttons (partner.js). Comments name the original's functions by the decompilation's
// labels, which proof/names.json moves to the USA copy's addresses, or by those addresses. Jumping isn't made yet.

import { createSprite, updateSprite, displaySprite, transformSprite, SPRITE } from '../sprite.js';
import { groundUpDown, groundSideways } from './collision.js';
import { SINE, sin8, cos8, arcTan2 } from './trig.js';
import { KEY } from '../core.js';
import { createMind, partnerButtons } from './partner.js';

export const SONIC = 0, TAILS = 2;
/** What a character's `flags` say. */
export const FLAG = { FACING_LEFT: 0x1, CURLED: 0x2, IN_AIR: 0x4, ON_OBJECT: 0x20, AT_WALL: 0x40, BUTTONS_OFF: 0x08000000 };
const { FACING_LEFT, CURLED, IN_AIR, ON_OBJECT, AT_WALL, BUTTONS_OFF } = FLAG;

const FIRST_ANIMATIONS = 0xCE450, POSE_ANIMATIONS = 0xCE45A, RUN_RATES = 0xCE92A;
export const POSE = { STAND: 0, LOOK_AROUND: 6, LOOK_AROUND_PARTNER: 7, RUN: 8, TURN: 0xC, TURN_FROM_SKID: 0xD, SKID: 0x10, SKID_FAST: 0x11, AIR_SLOW: 0x13, AIR_FAST: 0x14, PUSH: 0x21 };
const ANIM_FINISHED = 0x4000, SE_STOPPING = 0x73, ANIM_DUST = 0x534, DUST_TILES = 4;

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const GRAVITY = 42, TOP_SPEED = 7.5 * PX, SPEED_LIMIT = 9.5 * PX, FALL_LIMIT = 15 * PX, COAST = 8;
const SKID_FROM = 2 * PX, STEEP_SLIP = 1.875 * PX, SLIP_FRAMES = 30, LOOK_AROUND_AFTER = 360, SETTLE_FRAMES = 10;
const GAIT_TOPS = [1.25 * PX, 2.5 * PX, 4 * PX, 7 * PX, 9 * PX];
const STANDING_HEIGHT = 14, CURLED_HEIGHT = 9, HALF_WIDTH = 6;

const pixel = v => v >> 8;
const s16 = v => (v << 16) >> 16;
const s8 = v => (v << 24) >> 24;
const byte = v => v & 0xFF;
const steep = angle => ((angle + 0x20) & 0xC0) !== 0;
const isFlat = p => p.groundSpeed === 0 && !steep(p.angle);

/** A character, its place and speeds in 1/256 of a pixel (0x08013FA0, what a stage starts one with). */
export function createPlayer(stage, id, character, isLeader) {
  return {
    stage, id, character, isLeader, behave: comeOutOfRing,
    x: stage.respawnX * PX, y: stage.respawnY * PX, velX: 0, velY: 0, groundSpeed: 0,
    flags: BUTTONS_OFF, flagsLastFrame: 0, halfWidth: HALF_WIDTH, halfHeight: STANDING_HEIGHT, layer: 1, angle: 0,
    acceleration: 8, braking: 0x40, slipFrames: 0, idleTimer: LOOK_AROUND_AFTER, dustClock: 0,
    pose: POSE.STAND, shownPose: -1, animation: -1, variant: -1, gait: 0,
    held: 0, pressed: 0, heldWithButtonsOff: 0,
    sprite: null, turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 0, y: 0 }, tails: null,
  };
}

const firstAnimation = (c, p) => c.rom.s16(FIRST_ANIMATIONS + p.character * 2);

/** 0x08004178, InitializePlayer: its sprites (0x08013060, 0x08013160), and its tasks: its frame, drawing it, and keeping its flags. */
export function initializePlayer(c, p) {
  const order = (p.id === 0 ? 16 : 17 + p.id) << 6;
  p.sprite = createSprite({
    tiles: 0x10000 + p.id * 0x800, frameFlags: 0x1000 | p.id | SPRITE.ROT_SCALE_ENABLE, anim: 0xFFFF,
    x: pixel(p.x), y: pixel(p.y), oamFlags: order, palId: p.id, variant: 0xFF, prevAnim: 0xFFFF,
  });
  if (p.character === TAILS) {
    p.tails = {
      sprite: createSprite({
        tiles: 0x11000, anim: firstAnimation(c, p) + 11, variant: 1, frameFlags: 3 | 0x1000 | 0x40000 | SPRITE.ROT_SCALE_ENABLE,
        x: pixel(p.x), y: pixel(p.y), oamFlags: order, palId: p.id,
      }),
      turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 0, y: 0 },
    };
  }
  p.stage.mind = createMind(c);
  c.createTask(playFrame, p, 0x3000 + p.id);
  c.createTask(drawFrame, p, 0x3010 + p.id);
  c.createTask(t => { t.data.flagsLastFrame = t.data.flags; }, p, 0x3020 + p.id);   // 0x080050E0
}

// 0x080045EC, then sub_80142CC and sub_80144B4: what it can do this frame, then what it does
function playFrame(t) {
  const p = t.data, { c } = p.stage;
  p.acceleration = c.rom.s16(RUN_RATES);
  p.braking = c.rom.s16(RUN_RATES + 2);
  const speed = Math.abs(p.groundSpeed), gait = GAIT_TOPS.findIndex(top => speed <= top);
  p.gait = gait < 0 ? GAIT_TOPS.length : gait;
  if (p.isLeader) readButtons(p, c.input);
  else partnerReadButtons(p);
  p.behave(p);
}

// sub_8004B14: the buttons a character is pressing, and which of them are new
function readButtons(p, input) {
  if (p.flags & BUTTONS_OFF) {
    p.held = 0;
    p.pressed = 0;
    p.heldWithButtonsOff = input;
    return;
  }
  const before = p.heldWithButtonsOff || p.held;
  p.heldWithButtonsOff = 0;
  p.held = input;
  p.pressed = input & ~before;
}

// what 0x080045EC does for the partner: its own buttons, from what it decides, and which of them are new
function partnerReadButtons(p) {
  const { stage } = p, before = p.held;
  p.held = partnerButtons(stage.mind, p, stage.players[stage.playerIndex]);
  p.pressed = (before ^ p.held) & p.held;
}

// 0x08005068
function drawFrame(t) {
  const p = t.data, { c } = p.stage;
  chooseAnimation(c, p);
  drawBody(c, p);
  drawTails(c, p);
}

// 0x080042F4 (sub_80042F4), and sub_8012FA0 and sub_8012FC0: a new height, with its feet staying where they are
const quadrant = angle => byte(angle + 0x1F) >> 6;
function setHeight(p, halfHeight) {
  const grown = (halfHeight - p.halfHeight) * PX;
  switch (quadrant(p.angle)) {
    case 0: p.y -= grown; break;
    case 1: p.x += grown; break;
    case 2: p.y += grown; break;
    default: p.x -= grown;
  }
  p.halfHeight = halfHeight;
}
const curlUpBody = p => {   // Player_8012FF0
  p.halfWidth = HALF_WIDTH;
  p.halfHeight = CURLED_HEIGHT;
};

/** Whether it's still coming out of a ring, which is when the rings push it. */
export const isArriving = p => p.behave === comeOutOfRing || p.behave === arriving;

// 0x0800522C: its first frame, in the air and curled up, with the buttons off
function comeOutOfRing(p) {
  p.flags |= BUTTONS_OFF | CURLED | IN_AIR;
  p.velX = 0;
  p.velY = 0;
  setHeight(p, CURLED_HEIGHT);
  p.pose = POSE.AIR_SLOW;
  arriving(p);
}
// 0x080052C8: until the fade in has ended it keeps to this, on the ground or not, whatever landing asked for
function arriving(p) {
  keepInBounds(p);
  if (p.flags & IN_AIR) fallAndLand(p);
  else {
    steerOnGround(p);
    slopeSpeed(p);
    moveAlongGround(p);
  }
  p.behave = arriving;
  if (p.stage.state === 3) {
    p.flags &= ~BUTTONS_OFF;
    p.behave = p.flags & IN_AIR ? startFalling : startStanding;
  }
}
function fallAndLand(p) {
  curlAnimation(p);
  gravityAndMove(p);
  collideInAir(p);
}

const backOnGround = p => { p.flags &= ~(CURLED | IN_AIR | AT_WALL); };

// 0x08005380 and 0x08005434: standing still, or if it's moving, running
function startStanding(p) {
  backOnGround(p);
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  if (!isFlat(p)) {
    startRunning(p);
    return;
  }
  p.idleTimer = LOOK_AROUND_AFTER;
  p.pose = POSE.STAND;
  p.behave = stand;
  stand(p);
}
function stand(p) {
  steerOnGround(p);
  slopeSpeed(p);
  lookAround(p);
  keepInBounds(p);
  moveAlongGround(p);
  slipOffSteepGround(p);
  keepInBounds(p);
  if (p.groundSpeed !== 0) p.behave = startRunning;
}
// 0x08005528 and 0x080055B8: running, until it has been still for a moment
function startRunning(p) {
  backOnGround(p);
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.pose = POSE.RUN;
  p.dustClock = 0;
  p.idleTimer = 0;
  p.behave = run;
  run(p);
}
function run(p) {
  steerOnGround(p);
  slopeSpeed(p);
  keepInBounds(p);
  moveAlongGround(p);
  slipOffSteepGround(p);
  skidDust(p);
  if (!isFlat(p)) p.idleTimer = 0;
  else if (p.idleTimer < SETTLE_FRAMES) p.idleTimer++;
  else p.behave = startStanding;
}

// Player_800DB30, Player_800DAF4 and sub_800DF10: in the air, curled up if it left the ground by itself, or just falling
function startFalling(p) {
  p.flags = (p.flags & ~AT_WALL) | CURLED | IN_AIR;
  p.pose = Math.abs(p.velX) < 1.25 * PX ? POSE.AIR_SLOW : POSE.AIR_FAST;
  curlUpBody(p);
  p.behave = fall;
  fall(p);
}
function slipOff(p) {
  p.flags = (p.flags & ~AT_WALL) | IN_AIR;
  p.behave = fall;
  fall(p);
}
function fall(p) {
  curlAnimation(p);
  steerInAir(p);
  keepInBounds(p);
  gravityAndMove(p);
  collideInAir(p);
  if ((p.flags & (ON_OBJECT | IN_AIR)) === ON_OBJECT) {
    p.behave = startStanding;
    p.groundSpeed = p.velX;
    p.angle = 0;
  }
}

// sub_8014AF8: six seconds still, and it looks around
function lookAround(p) {
  if (!isFlat(p) || p.flags & (BUTTONS_OFF | AT_WALL | IN_AIR | CURLED)) p.idleTimer = LOOK_AROUND_AFTER;
  else if (p.idleTimer > 0) p.idleTimer--;
  else p.pose = p.id === 0 ? POSE.LOOK_AROUND : POSE.LOOK_AROUND_PARTNER;
}

// sub_8015064: the camera's limits are as far as it can go, and running into them stops it
function keepInBounds(p) {
  const cam = p.stage.camera;
  const x = Math.max((cam.minX + 12) * PX, Math.min((cam.maxX - 11) * PX - 1, p.x));
  const y = Math.max(cam.minY * PX, Math.min(cam.maxY * PX - 1, p.y));
  if (x !== p.x) p.velX = p.groundSpeed = 0;
  if (y !== p.y) p.velY = p.groundSpeed = 0;
  p.x = x;
  p.y = y;
}

// sub_8005800: what the d-pad does on the ground, and the pose that goes with it
function steerOnGround(p) {
  const left = p.held & KEY.LEFT, right = p.held & KEY.RIGHT;
  if (p.slipFrames !== 0 || !(left || right)) coast(p);
  else if (p.groundSpeed === 0) setOff(p);
  else if (p.groundSpeed > 0 ? right : left) speedUp(p, p.groundSpeed < 0);
  else brake(p);
  stopAtWalls(p);
  if ((p.flags & (IN_AIR | AT_WALL)) === AT_WALL && !steep(p.angle)) {
    const stillPushing = (right && !(p.pressed & KEY.RIGHT)) || (left && !(p.pressed & KEY.LEFT));
    p.pose = stillPushing ? POSE.PUSH : POSE.STAND;
  } else if (![POSE.STAND, POSE.SKID, POSE.SKID_FAST].includes(p.pose)) p.pose = POSE.RUN;
  if (p.flagsLastFrame & AT_WALL) p.flags &= ~AT_WALL;
}
function speedUp(p, toLeft) {       // sub_80059A0
  const speed = Math.abs(p.groundSpeed);
  const faster = speed < TOP_SPEED ? Math.min(speed + p.acceleration, TOP_SPEED) : speed;
  p.groundSpeed = toLeft ? -faster : faster;
  p.flags = toLeft ? p.flags | FACING_LEFT : p.flags & ~FACING_LEFT;
  p.pose = POSE.RUN;
}
function coast(p) {                 // sub_8005B04
  if (isFlat(p)) {
    p.pose = POSE.STAND;
    return;
  }
  const slower = Math.abs(p.groundSpeed) - COAST;
  if (slower < 0 && !steep(p.angle)) {
    p.groundSpeed = 0;
    p.idleTimer = LOOK_AROUND_AFTER;
    p.pose = POSE.STAND;
    return;
  }
  p.groundSpeed = p.groundSpeed < 0 ? -slower : slower;
  p.pose = POSE.RUN;
}
function brake(p) {                 // sub_8005A24
  const slower = Math.abs(p.groundSpeed) - p.braking, skidding = p.pose === POSE.SKID || p.pose === POSE.SKID_FAST;
  if (!skidding && slower >= SKID_FROM) {
    p.pose = p.gait > 3 ? POSE.SKID_FAST : POSE.SKID;
    if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_STOPPING);
  }
  const movingForward = p.groundSpeed < 0 ? p.flags & FACING_LEFT : !(p.flags & FACING_LEFT);
  if (slower > 0 && slower < SKID_FROM && movingForward) p.behave = turning;
  p.groundSpeed = s16(p.groundSpeed < 0 ? -slower : slower);
}
function setOff(p) {                // sub_8005B78
  const facingLeft = p.flags & FACING_LEFT;
  if (facingLeft ? p.held & KEY.RIGHT : !(p.held & KEY.RIGHT)) p.behave = turning;
  else {
    p.groundSpeed += facingLeft ? -p.acceleration : p.acceleration;
    setHeight(p, STANDING_HEIGHT);
    p.halfWidth = HALF_WIDTH;
  }
  p.pose = POSE.RUN;
}
// Player_800D9F4 and sub_800DA60: stopping dead to face the other way, until its animation has played
function turning(p) {
  p.flags &= ~AT_WALL;
  p.pose = p.pose === POSE.SKID || p.pose === POSE.SKID_FAST ? POSE.TURN_FROM_SKID : POSE.TURN;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.groundSpeed = 0;
  p.flags ^= FACING_LEFT;
  p.behave = turn;
  turn(p);
}
function turn(p) {
  if (p.sprite.frameFlags & ANIM_FINISHED) {
    p.behave = startStanding;
    return;
  }
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  settle(p);
  slipOffSteepGround(p);
}

// sub_800D7C8 and sub_8017134: braking hard it kicks up a puff of dust every fourth frame
function skidDust(p) {
  if (p.pose !== POSE.SKID && p.pose !== POSE.SKID_FAST) return;
  p.dustClock = (p.dustClock + 1) % 16;
  if ((p.dustClock & 3) === 3) createDust(p);
}
function createDust(p) {
  const { stage } = p, { c } = stage, x = pixel(p.x), y = pixel(p.y) + STANDING_HEIGHT;
  const s = createSprite({ tiles: stage.allocTiles(DUST_TILES), anim: ANIM_DUST, frameFlags: 0x1000 });
  // Task_801952C_2C and TaskDestructor_801932C
  c.createTask(t => {
    if (s.frameFlags & ANIM_FINISHED) {
      stage.freeTiles(s.tiles);
      c.destroyTask(t);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x3100);
}

// sub_8014E70 and sub_8011BFC: walls in the way it's going, and behind it when it's slow, stop it and push it out
function stopAtWalls(p) {
  // the way it's going, or if it isn't going anywhere, the way it faces
  const ahead = () => (p.groundSpeed !== 0 ? p.groundSpeed < 0 : p.flags & FACING_LEFT) ? 0x40 : 0xC0;
  stopAtWall(p, byte(p.angle + ahead()), true);
  if (Math.abs(p.groundSpeed) <= 3 * PX) stopAtWall(p, byte(p.angle + ahead() + 0x80), false);
}
function stopAtWall(p, direction, first) {
  const gap = distanceInDirection(p, direction) * PX;
  if (gap > 0) return;
  switch (byte(direction + 0x20) >> 6) {
    case 0:
      p.y += gap;
      p.angle = 0;
      if (first) p.velY = p.groundSpeed = 0;
      break;
    case 2:
      p.y -= gap;
      p.angle = 0;
      if (first) p.velX = p.velY = p.groundSpeed = 0;
      p.flags |= IN_AIR;
      break;
    default:
      p.x += byte(direction + 0x20) >> 6 === 1 ? -gap : gap;
      if (first) {
        p.flags |= AT_WALL;
        p.velX = p.groundSpeed = 0;
      }
  }
}
function distanceInDirection(p, direction) {
  const x = pixel(p.x), y = pixel(p.y), reach = p.halfWidth + 2;
  // exactly between left and up it looks up, and everywhere else it goes by the quadrant
  switch (direction === 0x60 ? 2 : quadrant(direction)) {
    case 0: return groundUpDown(y + reach, x, p.layer, 8);
    case 1: return groundSideways(x - reach, y, p.layer, -8);
    case 2: return groundUpDown(y - reach, x, p.layer, -8);
    default: return groundSideways(x + reach, y, p.layer, 8);
  }
}

// sub_8015144: going uphill slows it down and downhill speeds it up
function slopeSpeed(p) {
  if (byte(p.angle + 0x60) < 0xC0 && p.groundSpeed !== 0) p.groundSpeed += (sin8(p.angle * 4) * 3) >> 5;
}

// Player_801479C and sub_8016D30, then sub_8012EB8: along the ground at its speed, and on to where the ground is now
function moveAlongGround(p) {
  alongGround(p);
  settle(p);
}
function alongGround(p) {
  p.groundSpeed = Math.max(-SPEED_LIMIT, Math.min(SPEED_LIMIT, p.groundSpeed));
  p.velX = (cos8(p.angle * 4) * p.groundSpeed) >> 8;
  p.velY = (p.flags & IN_AIR ? p.velY : 0) + ((sin8(p.angle * 4) * p.groundSpeed) >> 8);
  move(p);
}
function settle(p) {
  if (!(p.flags & ON_OBJECT) && settleOnGround(p)) {
    p.flags |= IN_AIR;
    p.behave = slipOff;
  } else p.flags &= ~IN_AIR;
}
function move(p) {
  p.x += p.velX;
  p.velY = Math.min(p.velY, FALL_LIMIT);
  p.y += p.velY;
}

// sub_801139C and sub_80116A4: true if the ground has gone from under it. Each surface a character can run on, the way
// it's looked for, and which of its two feet goes first, which is the angle it keeps when both are as far
const SURFACES = [
  { upDown: true, towards: 1, firstFoot: -1 },    // a floor
  { upDown: false, towards: -1, firstFoot: -1 },  // a wall on its left
  { upDown: true, towards: -1, firstFoot: 1 },    // a ceiling
  { upDown: false, towards: 1, firstFoot: 1 },    // a wall on its right
];
function settleOnGround(p) {
  const { upDown, towards, firstFoot } = SURFACES[quadrant(p.angle)];
  const along = pixel(upDown ? p.y : p.x) + towards * p.halfHeight, centre = pixel(upDown ? p.x : p.y);
  const find = upDown ? groundUpDown : groundSideways;
  const foot = (side, angle) => find(along, centre + side * (p.halfWidth + 2), p.layer, towards * 8, angle);
  const firstAngle = [0], secondAngle = [0];
  const first = foot(firstFoot, firstAngle), second = foot(-firstFoot, secondAngle);
  const gap = Math.min(first, second);
  if (gap < -14) return false;
  if (gap > 0 && gap > Math.min(pixel(Math.abs(upDown ? p.velX : p.velY)) + 3, 11)) return true;
  if (upDown) p.y += towards * gap * PX;
  else p.x += towards * gap * PX;
  const angle = first < second ? firstAngle[0] : secondAngle[0];
  if (!(angle & 1)) p.angle = angle;
  return false;
}
// sub_8016E00: too steep and too slow, it comes off, and the d-pad does nothing for a while
function slipOffSteepGround(p) {
  if (p.slipFrames !== 0) p.slipFrames--;
  else if (steep(p.angle) && Math.abs(p.groundSpeed) < STEEP_SLIP) {
    p.behave = slipOff;
    p.slipFrames = SLIP_FRAMES;
  }
}

// sub_801350C: curling up as it leaves the ground, and opening out once the ground is close below it
function curlAnimation(p) {
  if (p.pose !== POSE.AIR_SLOW && p.pose !== POSE.AIR_FAST) return;
  const shown = (p.animation - firstAnimation(p.stage.c, p)) & 0xFFFF;
  if (shown !== POSE.AIR_SLOW && shown !== POSE.AIR_FAST) return;
  if (p.variant === 0 && p.sprite.frameFlags & ANIM_FINISHED) {
    p.variant = 1;
    p.flags |= CURLED;
    curlUpBody(p);
  } else if (p.velY > 0 && p.variant === 1 && groundUpDown(pixel(p.y) + p.halfHeight, pixel(p.x), p.layer, 8, null, 5) <= 32) p.variant = 2;
}
// sub_8014940: the d-pad in the air, which can only speed it up to its top speed
function steerInAir(p) {
  const step = p.acceleration * 2;
  let speed = p.velX;
  if (p.held & KEY.LEFT) {
    p.flags |= FACING_LEFT;
    if (speed - step >= -TOP_SPEED) speed -= step;
    else if (speed > -TOP_SPEED) speed = -TOP_SPEED;
  } else if (p.held & KEY.RIGHT) {
    p.flags &= ~FACING_LEFT;
    if (speed + step <= TOP_SPEED) speed += step;
    else if (speed < TOP_SPEED) speed = TOP_SPEED;
  }
  p.velX = s16(speed);
}
// sub_8016D30 and sub_8016EB0: falling, and turning back upright
function gravityAndMove(p) {
  p.velY += GRAVITY;
  move(p);
  const tilt = s8(p.angle);
  p.angle = byte(tilt < 0 ? Math.min(tilt + 2, 0) : Math.max(tilt - 2, 0));
}

// sub_80110E8: the nearer of what's under, or over, its two sides, with its angle in `angle[0]`
function groundAtFeet(p, towards, layer, angle) {
  const x = s16(pixel(p.x)), from = s16(pixel(p.y)) + towards * p.halfHeight, reach = p.halfWidth + 2;
  const leftAngle = [0], rightAngle = [0];
  const left = groundUpDown(from, x - reach, layer, towards * 8, leftAngle);
  const right = groundUpDown(from, x + reach, layer, towards * 8, rightAngle);
  const found = left < right ? leftAngle[0] : rightAngle[0];
  angle[0] = found & 1 ? 0 : found;
  return Math.min(left, right);
}
const ONE_WAY = 0x80;
// what it can pass through going up: while it's rising, or for a ceiling, unless it's falling fast
const floorUnder = (p, angle) => groundAtFeet(p, 1, p.velY < 0 ? p.layer | ONE_WAY : p.layer, angle);
const ceilingOver = (p, angle) => groundAtFeet(p, -1, p.velY < 3 * PX ? p.layer | ONE_WAY : p.layer, angle);

function wallInTheAir(p, side) {
  const layer = p.velY < 3 * PX ? p.layer | ONE_WAY : p.layer;
  const gap = groundSideways(pixel(p.x) + side * (p.halfWidth + 3), pixel(p.y), layer, side * 8);
  if (gap > 0) return false;
  p.x += side * gap * PX;
  p.velX = 0;
  return true;
}
// sub_8012F10: back on the ground
function land(p, angle) {
  p.angle = angle;
  p.behave = startStanding;
  if (p.flags & CURLED) {
    p.flags &= ~CURLED;
    setHeight(p, STANDING_HEIGHT);
  }
  p.halfWidth = HALF_WIDTH;
  p.halfHeight = STANDING_HEIGHT;
  p.flags &= ~IN_AIR;
}
const signedLike = (angle, speed) => (s8(angle) < 0 ? -Math.abs(speed) : Math.abs(speed));

// Player_80149E4: what it can run into, by which way it's going: sub_8011D08 down, sub_8011E70 up, sub_8011FB8 left and
// sub_8012118 right
function collideInAir(p) {
  const vx = s16(p.velX), vy = s16(p.velY), going = vx !== 0 || vy !== 0 ? byte(arcTan2(vx, vy) >> 8) : 0;
  const angle = [0];
  switch (byte(going - 0x20) >> 6) {
    case 0: {
      wallInTheAir(p, -1);
      wallInTheAir(p, 1);
      const gap = floorUnder(p, angle);
      if (gap < 0) {
        p.y += gap * PX;
        land(p, angle[0]);
        landingSpeed(p, angle[0]);
      }
      break;
    }
    case 2: {
      wallInTheAir(p, -1);
      wallInTheAir(p, 1);
      const gap = ceilingOver(p, angle);
      if (gap > 0) break;
      p.y -= gap * PX;
      if ((angle[0] + 0x20) & 0x40 && s8(angle[0]) > 0x40) {
        land(p, angle[0]);
        p.groundSpeed = Math.abs(p.velY);
      } else p.velY = 0;
      break;
    }
    default: {
      if (wallInTheAir(p, byte(going - 0x20) >> 6 === 1 ? -1 : 1)) p.groundSpeed = p.velY;
      const overhead = ceilingOver(p, angle);
      if (overhead <= 0) {
        p.y -= overhead * PX;
        if (p.velY < 0) p.velY = 0;
      } else if (p.velY >= 0) {
        const gap = floorUnder(p, angle);
        if (gap <= 0) {
          p.y += gap * PX;
          land(p, angle[0]);
          p.velY = 0;
          p.groundSpeed = p.velX;
        }
      }
    }
  }
}
// how much of its speed it keeps as it lands, by how steep the ground is
function landingSpeed(p, angle) {
  if ((angle + 0x20) & 0x40) {
    p.velX = 0;
    p.velY = Math.min(p.velY, 11.8125 * PX);
    p.groundSpeed = signedLike(angle, p.velY);
  } else if ((angle + 0x10) & 0x20) {
    p.velY >>= 1;
    p.groundSpeed = signedLike(angle, p.velY);
  } else {
    p.velY = 0;
    p.groundSpeed = p.velX;
  }
}

// sub_801320C (0x08013260): the animation its pose asks for, in this character's own
function chooseAnimation(c, p) {
  const s = p.sprite, entry = POSE_ANIMATIONS + p.pose * 4;
  if (p.pose !== p.shownPose) {
    const variant = c.rom.s16(entry + 2);
    if (variant !== -1) p.variant = variant;
    s.animSpeed = 0x10;
  }
  p.animation = firstAnimation(c, p) + c.rom.s16(entry);
  if (p.pose === POSE.RUN) {
    p.animation = firstAnimation(c, p) + POSE.RUN;
    p.variant = p.gait;
    s.animSpeed = Math.max(8, Math.min(0x80, Math.abs((p.groundSpeed >> 5) + (p.groundSpeed >> 6))));   // the faster, the quicker its legs
  }
  if (s.anim !== (p.animation & 0xFFFF) || s.variant !== byte(p.variant)) {
    s.anim = p.animation & 0xFFFF;
    s.variant = byte(p.variant);
    s.prevVariant = 0xFF;
  }
  p.shownPose = p.pose;
}

// Player_AnimateAndDisplay: running it tilts with the ground, and otherwise it only faces left or right
function drawBody(c, p) {
  const s = p.sprite, cam = p.stage.camera;
  s.x = pixel(p.x) - cam.x;
  s.y = pixel(p.y) - cam.y;
  s.frameFlags = (s.frameFlags & ~SPRITE.PRIORITY) | 0x1000;
  if (p.pose === POSE.RUN) {
    s.frameFlags = (s.frameFlags & ~(SPRITE.X_FLIP | SPRITE.Y_FLIP | SPRITE.ROT_SCALE)) | p.id | SPRITE.ROT_SCALE_ENABLE;
    faceAndTurn(p, p.turn, p.angle * 4, s.x, s.y);
    updateSprite(c, s);
    transformSprite(c, s, p.turn, SINE);
  } else {
    p.turn.rotation = 0;
    s.frameFlags &= ~(SPRITE.ROT_SCALE | SPRITE.ROT_SCALE_ENABLE | SPRITE.Y_FLIP);
    if (p.flags & FACING_LEFT) {
      s.frameFlags &= ~SPRITE.X_FLIP;
      s.x++;
    } else s.frameFlags |= SPRITE.X_FLIP;
    updateSprite(c, s);
  }
  displaySprite(c, s);
}
function faceAndTurn(p, turn, rotation, x, y) {
  turn.rotation = rotation;
  turn.scaleX = p.flags & FACING_LEFT ? PX : -PX;
  turn.scaleY = PX;
  turn.x = p.flags & FACING_LEFT ? x : x - 1;
  turn.y = y;
}

// Player_RollingAnimateAndDisplayLimbs: Tails's tails, which show on their own while he's curled up, and point away from
// the way he's going
function drawTails(c, p) {
  if (!p.tails) return;
  const { sprite: s, turn } = p.tails, cam = p.stage.camera;
  s.animSpeed = 0x10;
  const shown = (p.animation - firstAnimation(c, p)) & 0xFFFF;
  const curled = ((shown === POSE.AIR_SLOW || shown === POSE.AIR_FAST) && p.variant === 1) || ((shown === 11 || shown === 0x83) && p.variant === 0);
  if (!curled) return;
  const vx = s16(p.velX), vy = s16(p.velY);
  const pointing = vx !== 0 || vy !== 0 ? byte((arcTan2(vx, vy) >> 8) + 0x40) : p.flags & FACING_LEFT ? 0xC0 : 0x40;
  s.frameFlags = (s.frameFlags & ~SPRITE.ROT_SCALE) | 5 | SPRITE.ROT_SCALE_ENABLE;
  faceAndTurn(p, turn, pointing * 4, pixel(p.x) - cam.x, pixel(p.y) - cam.y);
  updateSprite(c, s);
  transformSprite(c, s, turn, SINE);
  displaySprite(c, s);
}
