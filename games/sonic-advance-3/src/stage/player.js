// The characters, written from how the original's player code behaves, as read in its decompilation. Each frame a
// character does what its `behave` says, which moves it and works out what it stands on, and then it's drawn with the
// animation its `pose` asks for. So far: coming out of the ring, running, braking, turning round, standing, falling and
// jumping, meeting walls and ceilings, thrown by springs, looking up, crouching, rolling, the spin dash, Tails flying and being
// hit, grinding on rails, thrown off ramps and the boost, with the partner pressing its own buttons (partner.js). Comments name the original's functions by the decompilation's labels, which
// proof/names.json moves to the USA copy's addresses, or by those addresses.

import { createSprite, updateSprite, displaySprite, transformSprite, SPRITE } from '../sprite.js';
import { groundUpDown, groundSideways } from './collision.js';
import { SINE, sin8, cos8, arcTan2 } from './trig.js';
import { KEY } from '../core.js';
import { createMind, partnerButtons } from './partner.js';
import { dropRings } from './rings.js';

export const SONIC = 0, TAILS = 2;
/** What a character's `flags` say. */
export const FLAG = { FACING_LEFT: 0x1, CURLED: 0x2, IN_AIR: 0x4, NO_AIR_STEERING: 0x8, SPIN_DASHING: 0x10, ON_OBJECT: 0x20, AT_WALL: 0x40, GRINDING: 0x20000, FLYING: 0x40000, BUTTONS_OFF: 0x08000000 };
const { FACING_LEFT, CURLED, IN_AIR, NO_AIR_STEERING, SPIN_DASHING, ON_OBJECT, AT_WALL, GRINDING, FLYING, BUTTONS_OFF } = FLAG;

const FIRST_ANIMATIONS = 0xCE450, POSE_ANIMATIONS = 0xCE45A, RUN_RATES = 0xCE92A, SPIN_DASH_SPEEDS = 0xCE230;   // the last is gUnknown_080CE5B8
// 0x080578E8: a sprite the title card's colour effect takes in, as it does while the card covers the stage
const BLENDED = 0x80;
export const POSE = { STAND: 0, LOOK_UP: 1, CROUCH: 2, LOOK_AROUND: 6, LOOK_AROUND_PARTNER: 7, RUN: 8, SPIN_DASH: 0xA, ROLL: 0xB, TURN: 0xC, TURN_FROM_SKID: 0xD, SKID: 0x10, SKID_FAST: 0x11, AIR_SLOW: 0x13, AIR_FAST: 0x14, FALLING: 0x18, PUSH: 0x21, HURT: 0x66, GRIND: 0x6F, FLY: 0xCE, FLY_TURN: 0xCF, FLY_TIRED: 0xD0 };
const OWN_ANIMATIONS = 0xA5;   // from this pose on, a pose's animation is the same for every character
const ANIM_FINISHED = 0x4000, SE_STOPPING = 0x73, ANIM_DUST = 0x534, DUST_TILES = 4;
const SE_SPIN_ATTACK = 0x6D, SE_SPIN_RELEASE = 0x6E, SE_GRINDING = 0x72, SE_JUMP = 0x74, SE_FLYING = 0x78;
const ANIM_GRINDING = 1329, GRINDING_TILES = 20, RAIL_LEAP = 39, FRONT_LAYER = 0, BACK_LAYER = 1;
const ANIM_SPIN_DUST_SMALL = 0x532, ANIM_SPIN_DUST = 0x533, SPIN_DUST_TILES = 0x14;

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const GRAVITY = 42, FALL_LIMIT = 15 * PX, COAST = 8;
const JUMP_SPEED = 0x4E0, SHORT_JUMP_SPEED = -3 * PX, ROLL_FRICTION = 8, ROLL_STOPS_BELOW = 0.5 * PX;
const SPIN_DASH_START = 2 * PX, SPIN_DASH_REV = 2 * PX, SPIN_DASH_MIN_REV = 8 * PX;
const FLY_FRAMES = 0xF0, FLY_RISE_LIMIT = -0.75 * PX, FLY_RISE = 0x18, FLY_SINK = 8, FLY_RISE_FRAMES = 0x20;
const LOOK_WAIT = 0x28, LOOK_STEP = 0x20, LOOK_UP_RETURN = 4, LOOK_UP_FURTHEST = -4.3125 * PX, CROUCH_FURTHEST = 0x3BF;
const SKID_FROM = 2 * PX, STEEP_SLIP = 1.875 * PX, SLIP_FRAMES = 30, LOOK_AROUND_AFTER = 360, SETTLE_FRAMES = 10;
const GAIT_TOPS = [1.25 * PX, 2.5 * PX, 4 * PX, 7 * PX, 9 * PX];
const SPRING_SPEEDS = 0xCF0E8, SPRING_STRENGTHS = 0xCF0E0, THROWN = 0x6C, THROWN_FAST = 0x6D, THROWN_FROM = 640;
const SPRING_CLEARS = 0x23AEF45E | 0x18000000;
const STANDING_HEIGHT = 14, CURLED_HEIGHT = 9, HALF_WIDTH = 6;
const BOOST_AFTER = 0xCE93E, SE_BOOST = 0xDD, ANIM_RAMP = 870, THROWN_FROM_RAMP = 0x6E, RAMP_RISE = 4.875 * PX, SE_LAUNCH_PAD = 0x114;
const HURT_SPEED = 1.5 * PX, HURT_RISE = -3 * PX, INVULNERABLE_FRAMES = 120;
const CAMERA_LEFT_OF_PLACE = 120, CAMERA_ABOVE_PLACE = 84, PARTNER_BEHIND = 30;

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
    acceleration: 8, braking: 0x40, topSpeed: 7.5 * PX, speedLimit: 9.5 * PX, slipFrames: 0, idleTimer: LOOK_AROUND_AFTER, dustClock: 0,
    camOffsetY: 0, invulnerable: 0, spinDashSpeed: 0, flyFrames: 0, flyLift: 0, restartAnimation: false, rail: 0, nextRail: 0, boosting: false, boostCounter: 0,
    pose: POSE.STAND, shownPose: -1, animation: -1, variant: -1, gait: 0,
    held: 0, pressed: 0, heldWithButtonsOff: 0,
    sprite: null, turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 0, y: 0 }, tails: null,
  };
}

/** Puts the characters and the camera somewhere in the stage, for a recording's start point (main.js). */
export function placeCharacters(stage, x, y) {
  for (const p of stage.players) {
    p.x = (p.isLeader ? x : x - PARTNER_BEHIND) * PX;
    p.y = y * PX;
  }
  stage.camera.x = x - CAMERA_LEFT_OF_PLACE;
  stage.camera.y = y - CAMERA_ABOVE_PLACE;
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
  const rate = RUN_RATES + (p.stage.rings > 10 ? 4 : 0);   // sub_8014258: with more rings Tails, whose ability it is with Sonic, speeds up faster
  p.acceleration = c.rom.s16(rate);
  p.braking = c.rom.s16(rate + 2);
  p.topSpeed = (p.flags & CURLED ? 10 : 7.5) * PX;
  p.speedLimit = (p.flags & CURLED ? 12 : 9.5) * PX;
  const speed = Math.abs(p.groundSpeed), gait = GAIT_TOPS.findIndex(top => speed <= top);
  p.gait = gait < 0 ? GAIT_TOPS.length : gait;
  if (p.isLeader) readButtons(p, c.input);
  else partnerReadButtons(p);
  p.behave(p);
}

// sub_80143E0: holding its top speed on the ground for long enough, more rings sooner, it goes faster until it slows down
function boost(p, after) {
  const speed = Math.abs(p.groundSpeed);
  if (p.flags & IN_AIR) {
    if (!p.boosting) p.boostCounter = 0;
  } else if (p.boosting) {
    p.boostCounter = after;
    if (speed < 4.75 * PX) stopBoost(p);
  } else if (speed < p.topSpeed) p.boostCounter = 0;
  else if (p.boostCounter >= after) {
    p.boosting = true;
    if (p.isLeader) {
      p.stage.camera.catchUpX = 4 * PX;
      p.stage.c.playSong(SE_BOOST);
    }
  }
}
function stopBoost(p) {   // Player_BoostModeDisengage
  p.boosting = false;
  p.boostCounter = 0;
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
  // sub_8014670: it only stops blinking once it's back on its feet
  if (p.stage.state === 3 && p.pose !== POSE.HURT && p.invulnerable > 0) p.invulnerable--;
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

// 0x0800522C: its first frame, with the buttons off: in an overworld in the air and curled up, and in an act standing
function comeOutOfRing(p) {
  p.flags |= BUTTONS_OFF;
  if (p.stage.act === 2) {
    p.flags |= CURLED | IN_AIR;
    p.velX = 0;
    p.velY = 0;
    setHeight(p, CURLED_HEIGHT);
    p.pose = POSE.AIR_SLOW;
  } else {
    setHeight(p, STANDING_HEIGHT);
    p.pose = POSE.STAND;
  }
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

// what every one of its moves clears as it starts
function newMove(p) {
  p.flags &= ~(CURLED | IN_AIR | NO_AIR_STEERING | SPIN_DASHING | AT_WALL | GRINDING | FLYING);
  p.camOffsetY = 0;
}

// 0x08005380 and 0x08005434: standing still, or if it's moving, running
function startStanding(p) {
  newMove(p);
  p.rail = 0;
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  if (!isFlat(p)) {
    startRunning(p);
    return;
  }
  p.idleTimer = LOOK_AROUND_AFTER;
  stopBoost(p);
  p.pose = POSE.STAND;
  p.behave = stand;
  stand(p);
}
function stand(p) {
  if (startCrouching(p) || startLookingUp(p)) return;
  steerOnGround(p);
  if (startJumpIfPressed(p)) return;
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
  newMove(p);
  p.rail = 0;
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.pose = POSE.RUN;
  p.dustClock = 0;
  p.idleTimer = 0;
  p.behave = run;
  run(p);
}
function run(p) {
  if (startCrouching(p)) return;
  steerOnGround(p);
  if (startJumpIfPressed(p)) return;
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
  afterAir(p);
}
// sub_8017004: come down on an object
function afterAir(p) {
  if ((p.flags & (ON_OBJECT | IN_AIR)) === ON_OBJECT) {
    p.behave = startStanding;
    p.groundSpeed = p.velX;
    p.angle = 0;
  }
}

/** Player_800BB34 and Player_800E6CC: thrown back from a blow, curled up and falling, until it's on the way down. */
export function hitWallRebound(p) {
  if (p.velX < 0) p.velX = 0x200;
  else if (p.velX > 0) p.velX = -0x200;
  p.flags = (p.flags & ~ON_OBJECT) | CURLED | IN_AIR;
  curlUpBody(p);
  p.pose = POSE.AIR_SLOW;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.angle = 0;
  p.groundSpeed = 0;
  p.behave = reboundingFromWall;
  reboundingFromWall(p);
}
function reboundingFromWall(p) {
  curlAnimation(p);
  keepInBounds(p);
  gravityAndMove(p);
  collideInAir(p);
  afterAir(p);
  if (p.velY >= 0) {
    p.pose = POSE.FALLING;
    p.halfWidth = HALF_WIDTH;
    p.halfHeight = STANDING_HEIGHT;
    p.behave = slipOff;
  }
}

/** Player_8014550: hit, unless it's blinking from the last time. In an act the leader drops its rings. With none it only
 * reels here, as losing a life isn't made yet (Player_HitWithoutRingsUpdate). */
export function hurtPlayer(p) {
  const { stage } = p;
  if (p.invulnerable > 0) return;
  if (p.flags & GRINDING) leaveRail(p);
  stopBoost(p);
  p.camOffsetY = 0;
  if (p.isLeader && stage.act >= 3) {
    const rings = stage.rings;
    stage.rings = 0;
    dropRings(stage, p, rings);
  }
  p.flags &= ~ON_OBJECT;
  p.standingOn = null;
  p.behave = startHurt;
  p.invulnerable = INVULNERABLE_FRAMES;
}
// Player_8008CD0 and Player_800E1E4: thrown back and up, away from where it was going unless that was fast, until it lands
function startHurt(p) {
  p.invulnerable = INVULNERABLE_FRAMES;
  if (p.character === TAILS) stopFlyingSound(p);
  if (Math.abs(p.velX) <= 2.5 * PX) {
    const vx = s16(p.velX);
    if (vx > 0xA0) p.velX = -HURT_SPEED;
    else if (vx < -0.625 * PX) p.velX = HURT_SPEED;
    else p.velX = p.flags & FACING_LEFT ? HURT_SPEED : -HURT_SPEED;
  } else p.velX = p.velX >= 0 ? HURT_SPEED : -HURT_SPEED;
  p.pose = POSE.HURT;
  p.velY = HURT_RISE;
  p.camOffsetY = 0;
  p.flags = (p.flags & ~(NO_AIR_STEERING | SPIN_DASHING | AT_WALL | FLYING | BUTTONS_OFF | ON_OBJECT | CURLED)) | IN_AIR;
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.behave = hurtFalling;
  hurtFalling(p);
}
function hurtFalling(p) {
  keepInBounds(p);
  p.velY += GRAVITY;
  move(p);
  stopAtWalls(p);
  collideInAir(p);
  afterAir(p);
}

/** Task_8039230: a rail has caught a character, which starts grinding on its next move. */
export function catchOnRail(p, rail, angle) {
  p.angle = angle;
  p.nextRail = rail;
  p.behave = startGrinding;
}
const stopGrindingSound = p => { if (p.id === p.stage.playerIndex) p.stage.c.stopSong(SE_GRINDING); };
function leaveRail(p) {
  p.flags &= ~GRINDING;
  p.layer = BACK_LAYER;
  stopGrindingSound(p);
}
// Player_80098D8: on the rail, at the speed it came in with, or at least a pixel a frame
function startGrinding(p) {
  newMove(p);
  p.flags |= GRINDING;
  setHeight(p, STANDING_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.pose = POSE.GRIND;
  p.groundSpeed = p.velX > -PX && p.velX < PX ? (p.velX < 0 ? -PX : PX) : p.velX;
  p.layer = FRONT_LAYER;
  p.rail = p.nextRail;
  p.dustClock = 0;
  if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_GRINDING);
  p.behave = grinding;
  grinding(p);
}
// sub_80099FC: the rail's slope and the d-pad change its speed, walls throw it back, and the button jumps off
function grinding(p) {
  if (p.flags & IN_AIR) {
    stopGrindingSound(p);
    p.behave = slipOff;
    return;
  }
  railSpeed(p);
  keepInBounds(p);
  alongGround(p);
  bounceOffWall(p);
  p.flags = p.groundSpeed < 0 ? p.flags | FACING_LEFT : p.flags & ~FACING_LEFT;
  if (startJumpIfPressed(p)) {
    leaveRail(p);
    return;
  }
  grindingSparks(p);
  settle(p);
  if (p.groundSpeed === 0 && p.angle === 0) {
    leaveRail(p);
    p.halfWidth = HALF_WIDTH;
    p.halfHeight = STANDING_HEIGHT;
    p.pose = POSE.FALLING;
    p.behave = slipOff;
  }
}
// sub_80151C4
function railSpeed(p) {
  p.groundSpeed += (sin8(p.angle * 4) * 5) >> 5;
  if (p.held & KEY.LEFT) {
    if (p.groundSpeed < 0 || p.groundSpeed > PX) p.groundSpeed -= COAST;
  } else if (p.held & KEY.RIGHT) {
    if (p.groundSpeed + PX < 0 || p.groundSpeed + PX > PX) p.groundSpeed += COAST;
  }
}
// sub_8014FA4
function bounceOffWall(p) {
  const direction = byte(p.angle + (p.flags & FACING_LEFT ? 0x40 : 0xC0)), gap = distanceInDirection(p, direction) * PX;
  if (gap > 0) return;
  switch (byte(direction + 0x20) >> 6) {
    case 0:
      p.y += gap;
      p.velY = -p.velY;
      break;
    case 1:
      p.x -= gap;
      p.velX = -p.velX;
      break;
    case 2:
      p.y -= gap;
      p.velY = -p.velY;
      p.velX = -p.velX;
      break;
    default:
      p.x += gap;
      p.velX = -p.velX;
  }
  p.groundSpeed = -p.groundSpeed;
}
// sub_800D81C, sub_80171C0 and Task_801952C_2C: sparks every eighth frame, which stay where they were made
function grindingSparks(p) {
  p.dustClock = (p.dustClock + 1) & 0xF;
  if ((p.dustClock & 7) !== 7) return;
  const { stage } = p, { c } = stage, x = pixel(p.x), y = pixel(p.y) + STANDING_HEIGHT;
  const s = createSprite({ tiles: stage.allocTiles(GRINDING_TILES), anim: ANIM_GRINDING, frameFlags: (p.sprite.frameFlags & 0x3000) | (p.groundSpeed > 0 ? SPRITE.X_FLIP : 0), oamFlags: p.sprite.oamFlags + 0x40 });
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
/** Player_800D978: off the rail where it ends, on its feet. */
export function offRailEnd(p) {
  leaveRail(p);
  p.rail = 0;
  startStanding(p);
}
/** Player_800D9B4 and Player_8006654: thrown off the rail's end, away from it. */
export function leapOffRail(p) {
  leaveRail(p);
  newMove(p);
  p.flags |= IN_AIR;
  p.halfWidth = HALF_WIDTH;
  p.halfHeight = STANDING_HEIGHT;
  p.pose = THROWN_FAST;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  const away = byte(p.angle - 0x40) * 4;
  p.velX += (cos8(away) * RAIL_LEAP) >> 3;
  p.velY += (sin8(away) * RAIL_LEAP) >> 3;
  p.behave = fall;
  fall(p);
}

// sub_8031BAC: on a ramp it can jump from at the foot of it, or going down it, but going up it the ramp's own launch does it
function onRamp(p) {
  const s = p.standingOn;
  if (!(p.flags & ON_OBJECT) || !s || s.anim !== ANIM_RAMP || s.variant > 1) return 0;
  if (p.gait <= 1) return 1;
  return s.frameFlags & SPRITE.X_FLIP ? (p.groundSpeed > 0 ? 1 : 2) : p.groundSpeed >= 0 ? 2 : 1;
}
/** sub_8031C10: a character comes on to a ramp, which it runs up. */
export function ontoRamp(p, ramp) {
  p.flags |= ON_OBJECT;
  p.standingOn = ramp;
  if (p.flags & IN_AIR) p.groundSpeed = p.velX;
  p.behave = startRunning;
}
/** sub_80322D8 and Player_8009F7C: off the ramp, thrown up and on, with the d-pad doing nothing until it lands. */
export function launchedFromRamp(p, speedX, speedY, toLeft) {
  p.flags = toLeft ? p.flags | FACING_LEFT : p.flags & ~FACING_LEFT;
  p.flags = (p.flags & ~(SPIN_DASHING | AT_WALL | GRINDING | FLYING | BUTTONS_OFF | ON_OBJECT)) | IN_AIR | NO_AIR_STEERING;
  p.standingOn = null;
  p.camOffsetY = 0;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.velX += speedX;
  p.velY = speedY - RAMP_RISE;
  if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_LAUNCH_PAD);
  p.pose = THROWN_FROM_RAMP;
  p.behave = thrownUp;
  thrownUp(p);
}

/** Task_SpringMain: a spring sets its throw going, which the character's next move carries out. */
export function thrownBySpring(p, direction, strength) {
  const downwards = direction === 1 || direction === 5 || direction === 7, fast = !downwards && p.velX > THROWN_FROM;
  p.behave = () => throwBySpring(p, direction, strength, downwards ? POSE.FALLING : fast ? THROWN_FAST : THROWN, downwards || fast ? fall : thrownUp);
}
// Player_800EA0C, Player_8009B4C and Player_8009BF0, and sub_8009D74: its speeds from the spring's way and strength. It
// keeps its height, even curled up, until it lands
function throwBySpring(p, direction, strength, pose, then) {
  const { rom } = p.stage.c;
  p.flags = (p.flags & ~SPRING_CLEARS) | IN_AIR;
  p.camOffsetY = 0;
  p.rail = 0;
  const speedX = rom.s16(SPRING_SPEEDS + direction * 4), speedY = rom.s16(SPRING_SPEEDS + direction * 4 + 2), by = rom.u8(SPRING_STRENGTHS + strength);
  if (speedX !== 0) {
    p.velX = s16((speedX * by) >> 4);
    if (p.velX < 0) p.flags |= FACING_LEFT;
    else if (p.velX > 0) p.flags &= ~FACING_LEFT;
  }
  if (speedY !== 0) p.velY = s16((speedY * by) >> 4);
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.variant = 0;
  p.pose = pose;
  p.behave = then;
  then(p);
}
// Player_8006C70: thrown up or sideways, what it shows changes as it starts to come down
function thrownUp(p) {
  if (p.variant === 0 && p.velY >= 0) p.variant = 1;
  else if (p.variant === 1 && p.sprite.frameFlags & ANIM_FINISHED) {
    p.sprite.frameFlags &= ~ANIM_FINISHED;
    p.variant = 2;
  }
  steerInAir(p);
  keepInBounds(p);
  gravityAndMove(p);
  collideInAir(p);
  afterAir(p);
}

/** sub_80044CC: a character that has beaten something from the air bounces off it. */
export function reboundFromEnemy(p) {
  if ((p.flags & (CURLED | IN_AIR)) !== (CURLED | IN_AIR)) return;
  p.velX >>= 1;
  if (p.velY >= 0) p.velY = HURT_RISE;
  startFalling(p);
}

// sub_801480C and sub_8012E54: with the button pressed and room over its head, it's off on its next frame
function startJumpIfPressed(p) {
  if (!(p.pressed & KEY.A)) return false;
  const ramp = onRamp(p);
  if (ramp === 2 || roomOverHead(p) <= 3) return false;
  if (ramp !== 0) p.y -= 2 * PX;
  p.behave = startJump;
  p.flags &= ~ON_OBJECT;
  p.standingOn = null;
  return true;
}
function roomOverHead(p) {
  const x = pixel(p.x), y = pixel(p.y), reach = p.halfWidth + 2, h = p.halfHeight;
  const layer = p.velY < 3 * PX ? p.layer | ONE_WAY : p.layer;
  const twoSides = find => Math.min(find(-1), find(1));
  switch (byte(p.angle + 0x80 + 0x20) >> 6) {
    case 0: return twoSides(side => groundUpDown(y + h, x + side * reach, p.velY < 0 ? p.layer | ONE_WAY : p.layer, 8));
    case 1: return Math.min(groundSideways(x - reach, y - h, layer, -8), groundSideways(x - reach, y + h, layer, -8));
    case 2: return twoSides(side => groundUpDown(y - h, x + side * reach, layer, -8));
    default: return Math.min(groundSideways(x + reach, y - h, layer, 8), groundSideways(x + reach, y + h, layer, 8));
  }
}

// Player_8006250 and sub_80063B4: a jump, away from the ground it's on, curled up from the first frame. If it was rolling
// the d-pad does nothing until it lands
function startJump(p) {
  const wasRolling = p.flags & CURLED;
  newMove(p);
  p.flags |= CURLED | IN_AIR | (wasRolling ? NO_AIR_STEERING : 0);
  p.flags &= ~ON_OBJECT;
  curlUpBody(p);
  p.pose = Math.abs(p.velX) < 0x140 ? POSE.AIR_SLOW : POSE.AIR_FAST;
  const away = byte(p.angle - 0x40) * 4;
  p.velX += (JUMP_SPEED * cos8(away)) >> 8;
  p.velY += (JUMP_SPEED * sin8(away)) >> 8;
  if (p.id === p.stage.playerIndex) p.stage.c.continueSong(SE_JUMP);
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.behave = jumpRising;
  jumpRising(p);
}
// sub_800EDC8 and sub_800EE38: letting go of the button on the way up cuts it short
function jumpRising(p) {
  if (startFlyingIfPressed(p)) return;
  if (p.velY < SHORT_JUMP_SPEED && !(p.held & KEY.A)) {
    p.velY = SHORT_JUMP_SPEED;
    p.behave = jumpFalling;
  } else if (p.velY > 0) p.behave = jumpFalling;
  fall(p);
}
function jumpFalling(p) {
  if (!startFlyingIfPressed(p)) fall(p);
}

// sub_8017058 and sub_80167A4: Tails pressing the button again in the air does nothing else this frame, and it flies from the next
function startFlyingIfPressed(p) {
  if (p.character !== TAILS || !(p.pressed & KEY.A)) return false;
  p.behave = startFlying;
  return true;
}
// sub_801BDD8
function startFlying(p) {
  if (p.flags & CURLED) {
    p.flags &= ~CURLED;
    p.halfWidth = HALF_WIDTH;
    p.halfHeight = STANDING_HEIGHT;
  }
  p.flyFrames = FLY_FRAMES;
  p.flyLift = 1;
  p.velY = 0;
  p.pose = POSE.FLY;
  p.flags = (p.flags | FLYING | IN_AIR) & ~NO_AIR_STEERING;
  p.behave = fly;
  fly(p);
}
// sub_801B2E4, sub_801B458 and sub_800E04C: each press lifts it for a while, until it tires and can only sink
function fly(p) {
  if (p.flyFrames !== 0) p.flyFrames--;
  if (p.flyLift !== 1) {
    if (p.velY < FLY_RISE_LIMIT) p.flyLift = 1;
    else {
      p.velY -= FLY_RISE;
      if (++p.flyLift === FLY_RISE_FRAMES) p.flyLift = 1;
    }
  } else {
    if (p.pressed & KEY.A && p.velY >= FLY_RISE_LIMIT && p.flyFrames !== 0) p.flyLift = 2;
    p.velY += FLY_SINK;
  }
  keepInBounds(p);
  if (p.flyFrames === 0) {
    p.pose = POSE.FLY_TIRED;
    stopFlyingSound(p);
  } else {
    const turning = (p.held & KEY.LEFT && !(p.flags & FACING_LEFT)) || (p.held & KEY.RIGHT && p.flags & FACING_LEFT);
    if (turning) p.pose = POSE.FLY_TURN;
    else if (p.pose !== POSE.FLY_TURN || p.sprite.frameFlags & ANIM_FINISHED) p.pose = POSE.FLY;
    if (p.id === p.stage.playerIndex) p.stage.c.continueSong(SE_FLYING);
  }
  p.acceleration >>= 1;
  steerInAir(p);
  move(p);
  turnUpright(p);
  collideInAir(p);
  afterAir(p);
  keepInBounds(p);
  if (!(p.flags & IN_AIR)) {
    p.behave = startStanding;
    stopFlyingSound(p);
  }
}
const stopFlyingSound = p => { if (p.id === p.stage.playerIndex) p.stage.c.stopSong(SE_FLYING); };

// Player_8007FE8 and sub_8014A60: holding only down, standing it crouches, and moving it rolls
function startCrouching(p) {
  if ((p.held & (KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT)) !== KEY.DOWN) return false;
  if (p.groundSpeed === 0 && !steep(p.angle) && !(p.flags & (CURLED | IN_AIR))) {
    p.behave = crouchDown;
    return true;
  }
  if (Math.abs(p.groundSpeed) >= ROLL_STOPS_BELOW && !(p.flags & (CURLED | IN_AIR))) {
    p.behave = startRolling;
    if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_SPIN_ATTACK);
    return true;
  }
  return false;
}
// sub_8016EDC: holding only up, standing still
function startLookingUp(p) {
  if ((p.held & (KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT)) !== KEY.UP) return false;
  if (p.groundSpeed !== 0 || steep(p.angle) || p.flags & (CURLED | IN_AIR)) return false;
  p.behave = lookUp;
  return true;
}
function crouchDown(p) {
  newMove(p);
  startLook(p, POSE.CROUCH);
  p.behave = crouching;
  crouching(p);
}
function lookUp(p) {     // Player_80082BC
  newMove(p);
  startLook(p, POSE.LOOK_UP);
  p.behave = lookingUp;
  lookingUp(p);
}
function startLook(p, pose) {
  p.pose = pose;
  p.groundSpeed = 0;
  p.idleTimer = LOOK_WAIT;
}
// Player_8008080 and Player_8008354: held, after a moment the camera moves. Let go, it gets up, with the camera coming back
function crouching(p) {
  const shown = (p.animation - firstAnimation(p.stage.c, p)) & 0xFFFF;
  if (p.pose === POSE.CROUCH && p.pressed & KEY.A) {
    p.camOffsetY = 0;
    p.behave = startSpinDash;
    return;
  }
  p.pose = POSE.CROUCH;
  if (keepLooking(p, shown, KEY.DOWN, () => { if (p.camOffsetY <= CROUCH_FURTHEST) p.camOffsetY += LOOK_STEP; }, () => { if (p.camOffsetY > 0) p.camOffsetY -= LOOK_STEP; })) return;
  stayPutOnGround(p);
}
function lookingUp(p) {
  const shown = (p.animation - firstAnimation(p.stage.c, p)) & 0xFFFF;
  p.pose = POSE.LOOK_UP;
  if (keepLooking(p, shown, KEY.UP, () => { if (p.camOffsetY > LOOK_UP_FURTHEST) p.camOffsetY -= LOOK_STEP; }, () => { if (p.camOffsetY < 0) p.camOffsetY += LOOK_UP_RETURN; })) return;
  stayPutOnGround(p);
}
function keepLooking(p, shown, button, towards, back) {
  const pad = p.held & (KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT), own = shown === p.pose;
  if (pad === 0) {
    if (own && p.variant === 0) {
      p.variant = 1;
      p.sprite.frameFlags &= ~ANIM_FINISHED;
    }
  } else if (pad !== button) {
    p.behave = startStanding;
    p.camOffsetY = 0;
  }
  if (own && p.variant === 0) {
    if (p.idleTimer > 0) p.idleTimer--;
    else towards();
    return false;
  }
  if (own && p.variant !== 1) return false;
  if (own) back();
  if (p.variant === 1 && p.sprite.frameFlags & ANIM_FINISHED) {
    p.behave = startStanding;
    if (!own) return true;
    p.camOffsetY = 0;
  }
  return false;
}
// what crouching and looking up do once they've had their say, sub_8014E70 stopping them at walls
function stayPutOnGround(p) {
  slopeSpeed(p);
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  if (startJumpIfPressed(p)) {
    p.camOffsetY = 0;
    return;
  }
  settle(p);
  slipOffSteepGround(p);
  if (p.flags & IN_AIR) p.camOffsetY = 0;
}

// Player_800872C and Player_80087CC: revving up while it holds down, and off at a speed by how much it has, when it lets go
function startSpinDash(p) {
  newMove(p);
  p.flags |= SPIN_DASHING | CURLED;
  p.pose = POSE.SPIN_DASH;
  setHeight(p, CURLED_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.spinDashSpeed = SPIN_DASH_START;
  p.velX = 0;
  p.velY = 0;
  p.groundSpeed = 0;
  createSpinDust(p);
  if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_SPIN_ATTACK);
  p.behave = spinDash;
  spinDash(p);
}
function spinDash(p) {
  const shown = (p.animation - firstAnimation(p.stage.c, p)) & 0xFFFF;
  if (!(p.held & KEY.DOWN)) {
    p.flags &= ~SPIN_DASHING;
    const speed = p.stage.c.rom.s16(SPIN_DASH_SPEEDS + Math.min(p.spinDashSpeed >> 8, 8) * 2);
    p.groundSpeed = p.flags & FACING_LEFT ? -speed : speed;
    p.behave = startRolling;
    if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_SPIN_RELEASE);
    return;
  }
  let rev = p.spinDashSpeed;
  if (rev !== 0) rev = Math.max(0, rev - (rev >> 5));
  if (p.pressed & KEY.A) {
    rev = Math.max(rev + SPIN_DASH_REV, SPIN_DASH_MIN_REV);
    p.variant = 1;
    p.restartAnimation = true;
    if (p.id === p.stage.playerIndex) p.stage.c.playSong(SE_SPIN_ATTACK);
  }
  p.spinDashSpeed = rev;
  if (shown === POSE.SPIN_DASH && p.variant === 1 && p.sprite.frameFlags & ANIM_FINISHED) p.variant = 0;
  slopeSpeed(p);
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  settle(p);
  slipOffSteepGround(p);
  if (p.flags & IN_AIR) p.behave = startStanding;
}
// Task_8018238_30: the dust behind a spin dash, which goes when it does
function createSpinDust(p) {
  const { stage } = p, { c } = stage;
  const s = createSprite({ tiles: stage.allocTiles(SPIN_DUST_TILES), anim: ANIM_SPIN_DUST, frameFlags: 0x1000 | (p.flags & FACING_LEFT ? 0 : SPRITE.X_FLIP) });
  c.createTask(t => {
    if (p.pose !== POSE.SPIN_DASH) {
      stage.freeTiles(s.tiles);
      c.destroyTask(t);
      return;
    }
    s.anim = p.spinDashSpeed < PX ? ANIM_SPIN_DUST_SMALL : ANIM_SPIN_DUST;
    s.x = pixel(p.x) - stage.camera.x;
    s.y = pixel(p.y) - stage.camera.y + CURLED_HEIGHT;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x3100);
}

// Player_800891C and Player_80089CC: rolling, until it has all but stopped, with the d-pad doing nothing
function startRolling(p) {
  newMove(p);
  p.flags |= CURLED;
  setHeight(p, CURLED_HEIGHT);
  p.halfWidth = HALF_WIDTH;
  p.pose = POSE.ROLL;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.behave = roll;
  roll(p);
}
function roll(p) {
  if (p.groundSpeed > 0) p.groundSpeed -= ROLL_FRICTION;
  else if (p.groundSpeed < 0) p.groundSpeed += ROLL_FRICTION;
  if (Math.abs(p.groundSpeed) < ROLL_STOPS_BELOW) p.groundSpeed = 0;
  if (p.groundSpeed === 0) {
    startStanding(p);
    return;
  }
  slopeSpeed(p);
  keepInBounds(p);
  alongGround(p);
  if (p.flags & IN_AIR) p.velY += GRAVITY;
  stopAtWalls(p);
  if (startJumpIfPressed(p)) return;
  settle(p);
  slipOffSteepGround(p);
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
  if (speed >= p.topSpeed) p.boostCounter += p.acceleration;
  const faster = speed < p.topSpeed ? Math.min(speed + p.acceleration, p.topSpeed) : speed;
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
    if (p.id === p.stage.playerIndex) p.stage.c.continueSong(SE_STOPPING);
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
  p.rail = 0;
  stopBoost(p);
  p.groundSpeed = 0;
  p.flags ^= FACING_LEFT;
  p.behave = turn;
  turn(p);
}
function turn(p) {
  if (startCrouching(p) || startLookingUp(p)) return;
  if (p.sprite.frameFlags & ANIM_FINISHED) {
    p.behave = startStanding;
    return;
  }
  keepInBounds(p);
  alongGround(p);
  stopAtWalls(p);
  if (startJumpIfPressed(p)) return;
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

// sub_8015144: going uphill slows it down and downhill speeds it up, curled up by much more and uphill by a quarter of that
function slopeSpeed(p) {
  if (byte(p.angle + 0x60) >= 0xC0 || p.groundSpeed === 0) return;
  if (!(p.flags & CURLED)) {
    p.groundSpeed += (sin8(p.angle * 4) * 3) >> 5;
    return;
  }
  const pull = sin8(p.angle * 4) * 60, full = pull >> 8, against = p.groundSpeed > 0 ? full <= 0 : full >= 0;
  p.groundSpeed += against ? full >> 2 : full;
}

// Player_801479C and sub_8016D30, then sub_8012EB8: along the ground at its speed, and on to where the ground is now
function moveAlongGround(p) {
  alongGround(p);
  settle(p);
}
function alongGround(p) {
  p.groundSpeed = Math.max(-p.speedLimit, Math.min(p.speedLimit, p.groundSpeed));
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
  if (p.flags & NO_AIR_STEERING) return;
  const step = p.acceleration * 2;
  let speed = p.velX;
  if (p.held & KEY.LEFT) {
    p.flags |= FACING_LEFT;
    if (speed - step >= -p.topSpeed) speed -= step;
    else if (speed > -p.topSpeed) speed = -p.topSpeed;
  } else if (p.held & KEY.RIGHT) {
    p.flags &= ~FACING_LEFT;
    if (speed + step <= p.topSpeed) speed += step;
    else if (speed < p.topSpeed) speed = p.topSpeed;
  }
  p.velX = s16(speed);
}
// sub_8016D30 and sub_8016EB0: falling, and turning back upright
function gravityAndMove(p) {
  p.velY += GRAVITY;
  move(p);
  turnUpright(p);
}
function turnUpright(p) {
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
  p.animation = (p.pose < OWN_ANIMATIONS ? firstAnimation(c, p) : 0) + c.rom.s16(entry);
  if (p.pose === POSE.RUN) {
    p.animation = firstAnimation(c, p) + POSE.RUN;
    p.variant = p.gait;
    s.animSpeed = Math.max(8, Math.min(0x80, Math.abs((p.groundSpeed >> 5) + (p.groundSpeed >> 6))));   // the faster, the quicker its legs
  }
  if (p.restartAnimation || s.anim !== (p.animation & 0xFFFF) || s.variant !== byte(p.variant)) {
    p.restartAnimation = false;
    s.anim = p.animation & 0xFFFF;
    s.variant = byte(p.variant);
    s.prevVariant = 0xFF;
    if (s.hitboxes) for (const box of s.hitboxes) if (box) box.index = -1;
  }
  p.shownPose = p.pose;
}

// Player_AnimateAndDisplay: running it tilts with the ground, and otherwise it only faces left or right
function drawBody(c, p) {
  const s = p.sprite, cam = p.stage.camera;
  s.frameFlags = (s.frameFlags & ~SPRITE.OBJ_MODE) | (p.stage.cardCover ? BLENDED : 0);
  s.x = pixel(p.x) - cam.x;
  s.y = pixel(p.y) - cam.y;
  s.frameFlags = (s.frameFlags & ~SPRITE.PRIORITY) | (p.pose === POSE.GRIND ? 0 : 0x1000);
  if (p.pose === POSE.RUN || p.pose === POSE.GRIND) {
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
  if (!p.stage.cardHides && !blinkedOff(p)) displaySprite(c, s);
}
// Player_AnimateAndDisplay: blinking, every other pair of frames
const blinkedOff = p => p.invulnerable !== 0 && p.stage.timer & 2;
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
  s.frameFlags = (s.frameFlags & ~SPRITE.OBJ_MODE) | (p.stage.cardCover ? BLENDED : 0);
  if (!p.stage.cardHides && !blinkedOff(p)) displaySprite(c, s);
}
