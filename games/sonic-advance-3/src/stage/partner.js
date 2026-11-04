// The second character, written from how the original's partner code behaves, as read in its decompilation (partner_ai.c).
// Each frame the partner works out buttons for itself, as if someone held a controller: it aims a little behind the
// character in charge, and a game of chance, by how far off it is, picks what it does next. So far: standing, a press
// towards its target, steering as it falls, looking up or down, and starting a jump, a spin or flying, which it can't do
// yet. Coming back when it's left far behind, and going for rings, belong to the pieces that make those.
// The numbers it draws are the game's own (`c.random`), so a recording gets the same ones from the same start.
// Comments name the USA copy's addresses, as this stretch sits away from the decompilation's labels by much the same.

import { KEY } from '../core.js';
import { FLAG, POSE } from './player.js';

const PX = 256;   // positions and speeds are in 1/256 of a pixel
const MOVES = KEY.LEFT | KEY.RIGHT;
const NEAR = 24 * PX, FOLLOW_GAP = 12 * PX, SPIN_FAR = 120 * PX;
const SIDEKICK_MOVES = 0xA00043, CAN_SPIN = 2;   // sub_80141EC's table, for Tails beside Sonic

// the original's numbers for what it's doing, and how much each outranks another (0x080E3254's third column)
const REST = 0, WAIT = 1, STEP = 2, JUMP = 3, LOOK_UP = 4, LOOK_DOWN = 5, SPIN = 7, STEER = 8, FLY = 9;
const RANK = { [REST]: 0, [WAIT]: 1, [STEP]: 2, [JUMP]: 3, [LOOK_UP]: 0, [LOOK_DOWN]: 0, [SPIN]: 4, [STEER]: 5, [FLY]: 6 };

// 0x080B758C and 0x080B88A4: made for each character as it starts, which draws a number each time
export function createMind(c) {
  const mind = { c, doing: REST, act: null, frames: 0, hold: 0, input: 0, targetX: 0, targetY: 0, gapX: 0, gapY: 0, offsetX: 0, clock: 0, restless: 0 };
  doNext(mind, REST);
  return mind;
}

const chance = (mind, odds) => odds > ((mind.c.random() << 8) >>> 16);
const nextFrames = mind => ((mind.c.random() >>> 8) & 0x1F) + 60;

// 0x080B8990: what it does from now on, and how long it may go on before it stops to think again
function doNext(mind, doing) {
  mind.doing = doing;
  mind.act = ACTS[doing];
  mind.frames = nextFrames(mind);
}
// 0x080B8958: only if it outranks what it's doing
function consider(mind, doing) {
  if (mind.doing !== doing && RANK[mind.doing] <= RANK[doing]) doNext(mind, doing);
}
// 0x080B89D8: if the chance comes up
function tryTo(mind, doing, comesUp) {
  if (!comesUp) return false;
  consider(mind, doing);
  return true;
}
function backToRest(mind) {
  mind.doing = REST;
  mind.act = ACTS[REST];
  mind.frames = nextFrames(mind);
}

// looking up or down, by what the leader's doing
function chanceLookUp(mind, leader) {
  return chance(mind, leader.pose === 1 ? 0x1000 : leader.pose === POSE.LOOK_AROUND ? 0x10 : 0x20);   // 0x080B8BE8
}
function chanceLookDown(mind, leader) {
  return chance(mind, leader.pose === 2 ? 0x1000 : leader.pose === POSE.LOOK_AROUND ? 0x10 : 0x20);   // 0x080B8C30
}
// 0x080B8B3C: stopping to wait, likelier the stiller the leader is
function chanceWait(mind, leader) {
  const { pose } = leader;
  return chance(mind, pose === POSE.STAND || pose === POSE.LOOK_AROUND ? 0xF00 : pose === 1 || pose === 2 ? 0x100 : 0x20);
}
// 0x080B8B8C: a press towards the target, nearly always when it's far
function chanceStep(mind, self) {
  if (mind.doing === JUMP || self.flags & FLAG.IN_AIR) return false;
  return chance(mind, Math.abs(mind.gapX) > NEAR ? 0x8000 : 0x100);
}
// 0x080B7894: a spin dash, likelier the further it's been left behind
function chanceSpin(mind, self) {
  if (mind.doing === SPIN || self.flags & FLAG.IN_AIR || (SIDEKICK_MOVES & 6) !== CAN_SPIN) return false;
  const gapX = Math.abs(mind.gapX);
  let odds = 0x10;
  if (gapX > SPIN_FAR) odds = Math.min((gapX - SPIN_FAR) >> 11, 0x100) + 0x100;
  else if (mind.gapY < -SPIN_FAR) odds = Math.min((Math.abs(mind.gapY) - SPIN_FAR) >> 11, 0x80) + 0x80;
  return chance(mind, odds);
}
// 0x080B7764: a jump, likelier when it's pushing at a wall the leader isn't, or the target is above it
function chanceJump(mind, self, leader) {
  if (mind.doing === JUMP || self.flags & FLAG.IN_AIR) return false;
  let odds;
  if (leader.flags & FLAG.IN_AIR) odds = leader.y < self.y + 8 * PX ? 0xF00 : 0x100;
  else if (self.pose === POSE.PUSH) odds = leader.pose !== POSE.PUSH ? 0x1000 : (Math.abs(mind.gapX) + Math.abs(mind.gapY)) >> 8;
  else if ((mind.gapX ^ self.groundSpeed) >= 0) {
    const above = mind.gapY <= -8 * PX;
    if (Math.abs(mind.gapX) < Math.abs(self.groundSpeed * 64)) odds = above ? 0x400 : 0x100;
    else odds = above ? 0x40 : 0x20;
  } else odds = mind.gapY > 0 ? 0x20 : mind.gapY <= -16 * PX ? 0x200 : 0x80;
  return chance(mind, odds);
}

// 0x080B7948: flying up to a target above it, when it has all but stopped rising
function chanceFly(mind, self) {
  const rising = 0.65625 * PX;
  if (mind.doing === FLY || !(self.flags & FLAG.IN_AIR) || mind.gapY >= -16 * PX || self.velY <= -rising) return false;
  return chance(mind, self.velY < rising ? 0x2000 : 0x200);
}

// 0x080B725C: where it's aiming, and what it might do about it
function decide(mind, self, leader) {
  // 0x080B7448: now and again it picks another place near the leader to aim for
  if ((mind.clock & 0x3F) === 0x3F && !(mind.c.random() & 0xF00)) {
    mind.offsetX = ((mind.c.random() << 15) >>> 19) - 16 * PX;
  }
  mind.targetX = leader.x + mind.offsetX + (leader.flags & FLAG.FACING_LEFT ? FOLLOW_GAP : -FOLLOW_GAP);
  mind.targetY = leader.y;
  if (Math.abs(mind.targetX - self.x) < NEAR && Math.abs(mind.targetY - self.y) < NEAR) {
    if (tryTo(mind, LOOK_UP, chanceLookUp(mind, leader))) return;
    if (tryTo(mind, LOOK_DOWN, chanceLookDown(mind, leader))) return;
    if (chanceWait(mind, leader)) doNext(mind, WAIT);
    return;
  }
  mind.gapX = mind.targetX - self.x;   // 0x080B8A40
  mind.gapY = mind.targetY - self.y;
  if (tryTo(mind, FLY, chanceFly(mind, self))) return;
  if (tryTo(mind, STEER, mind.doing !== STEER && self.flags & FLAG.IN_AIR)) return;
  if (tryTo(mind, SPIN, chanceSpin(mind, self))) return;
  if (tryTo(mind, JUMP, chanceJump(mind, self, leader))) return;
  if (tryTo(mind, STEP, chanceStep(mind, self))) return;
  tryTo(mind, WAIT, chanceWait(mind, leader));
}

const towardsTarget = (mind, buttons) => {
  let pressed = buttons & ~MOVES;
  if (mind.gapX > 2 * PX) pressed |= KEY.RIGHT;
  if (mind.gapX < -2 * PX) pressed |= KEY.LEFT;
  return pressed;
};

// 0x080B9218: what it's pressing, until the time's up
function holdOn(mind) {
  if (mind.hold-- <= 0) backToRest(mind);
  return mind.input;
}
const holdFor = (mind, frames) => {
  mind.hold = frames;
  mind.act = holdOn;
};
// 0x080B7E90: the jump's first frames, until it's on its way down or never left the ground
function jumping(mind, self) {
  let input = mind.input;
  if (mind.hold-- <= 0) {
    input = towardsTarget(mind, input);
    if (mind.targetY >= self.y || !(self.flags & FLAG.IN_AIR) || self.velY >= 0) {
      input &= ~KEY.A;
      backToRest(mind);
    }
  }
  return input;
}
// 0x080B7F50: pressing A again and again while crouched, for a spin dash, until the time's up
function revving(mind) {
  let input = mind.input;
  if (input & KEY.A) input &= ~KEY.A;
  else if ((mind.hold & 0xF) === 0xF) input |= KEY.A;
  if (mind.hold-- <= 0) {
    input &= ~(KEY.A | KEY.DOWN);
    backToRest(mind);
  }
  return input;
}

// 0x080B8F9C: with nothing else pressed, the jump button, and with something else, letting go of that first
function pressJump(mind) {
  if (mind.input & ~MOVES) return mind.input & MOVES;
  mind.hold = 4;
  mind.act = jumping;
  return (mind.input & MOVES) | KEY.A;
}

// 0x080E3254's first column, for what it can do on the ground
const ACTS = {
  [REST]: mind => mind.input,                                       // 0x080B8DC0
  [WAIT](mind) {                                                    // 0x080B8DD4
    holdFor(mind, ((mind.c.random() >>> 8) & 0x1F) + 6);
    return 0;
  },
  [STEP](mind, self) {                                              // 0x080B8E0C
    const input = mind.targetX > self.x ? KEY.RIGHT : mind.targetX < self.x ? KEY.LEFT : 0;
    backToRest(mind);
    return input;
  },
  [JUMP](mind, self) {                                              // 0x080B8E64
    if (self.flags & FLAG.IN_AIR) return mind.input;
    mind.act = pressJump;
    return pressJump(mind);
  },
  [LOOK_UP](mind) {                                                 // 0x080B8EAC
    holdFor(mind, ((mind.c.random() >>> 8) & 0x3F) + 0x20);
    return KEY.UP;
  },
  [LOOK_DOWN](mind) {                                               // 0x080B8EE4
    holdFor(mind, ((mind.c.random() >>> 8) & 0x3F) + 0x20);
    return KEY.DOWN;
  },
  [SPIN](mind, self) {                                              // 0x080B8F58
    if (self.groundSpeed === 0) {
      mind.hold = (mind.c.random() & 0x3F) + 0x10;
      mind.act = revving;
    }
    return KEY.DOWN;
  },
  [STEER](mind, self) {                                             // 0x080B7FE4
    if (self.flags & FLAG.IN_AIR) return towardsTarget(mind, mind.input);
    backToRest(mind);
    return mind.input;
  },
  [FLY](mind, self, leader) {                                       // 0x080B8074
    if (!(self.flags & FLAG.IN_AIR)) {
      backToRest(mind);
      return mind.input & ~KEY.A;
    }
    let input = towardsTarget(mind, mind.input) ^ KEY.A;
    if (mind.gapY > 0 && (!(leader.flags & FLAG.IN_AIR) || mind.gapY > 16 * PX)) input &= ~KEY.A;
    return input;
  },
};

// 0x080B74F0: how keen it is to go for what's near, which only draws a number until there's a ring to go for
function restless(mind, leader) {
  let keen = mind.restless;
  if (leader.pressed & ~(KEY.UP | KEY.DOWN)) keen += 90;
  else if (leader.held & ~(KEY.UP | KEY.DOWN)) keen += 2;
  mind.restless = Math.max(0, Math.min(((mind.c.random() >>> 4) & 0xFF) + 120, keen) - 1);
}

/** 0x080B75E0, a frame of it: the buttons the partner holds now. */
export function partnerButtons(mind, self, leader) {
  decide(mind, self, leader);
  mind.input = mind.act(mind, self, leader);
  if (mind.frames-- < 0) doNext(mind, REST);   // 0x080B88E8
  restless(mind, leader);
  mind.clock++;
  return mind.input;
}
