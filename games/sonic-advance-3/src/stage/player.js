// The characters, rewritten from the original's player code: a character's state is a callback run each frame, which
// moves it, works out what it stands on, and picks an animation. So far: arriving, running with nothing pressed or the
// d-pad, stopping, standing and falling. The labels are the decompilation's, for the European release, which
// proof/names.json moves to the USA copy's addresses. Jumping, turning round and the partner's AI aren't ported yet, so
// Tails stands where he stops.

import { createSprite, updateSprite, displaySprite, transformSprite, SPRITE } from '../sprite.js';
import { acrossX, acrossY, findGround } from './collision.js';
import { SINE, sin8, cos8, arcTan2 } from './trig.js';
import { KEY } from '../core.js';

export const SONIC = 0, TAILS = 2;
const IDLE_ANIMS = 0xCE450, ANIM_TABLE = 0xCE45A, SPEEDS = 0xCE92A;
const FACING_LEFT = 0x1, ROLLING = 0x2, IN_AIR = 0x4, LOCK_AIR = 0x8, COLLIDING = 0x20, WALL = 0x40, UNDERWATER = 0x80, DEAD = 0x100, HIT = 0x200;
const GRAVITY_SWITCHED = 0x10000, IGNORE_INPUT = 0x08000000, HIDDEN = 0x04000000, TALKING = 0x10000000, CLEAR_ON_STATE = 0x23EFF458;
const Q = v => Math.trunc(v * 256);
const I = v => v >> 8;
const s16 = v => (v << 16) >> 16;
const s8 = v => (v << 24) >> 24;
const u8 = v => v & 0xFF;
const abs = Math.abs;

/** A character, as InitializePlayer and 0x08013FA0 (sub_8013F4C) set one up, in gPlayers order. */
export function createPlayer(stage, id, character, partnerId, role) {
  const p = {
    stage, id, character, partnerId, role, callback: null,
    qWorldX: stage.respawnX << 8, qWorldY: stage.respawnY << 8, qSpeedAirX: 0, qSpeedAirY: 0, qSpeedGround: 0,
    moveState: IGNORE_INPUT, moveState2: 0, spriteOffsetX: 6, spriteOffsetY: 0xE, layer: 1, angle: 0,
    unk88: Q(9.5), unk8C: Q(7.5), unk90: 8, unk94: 0x40, unk4E: 0, unk5A: 0, unkA0: 0x100, unkA2: 0x100,
    anim0: 0, anim1: -1, anim2: -1, state1: -1, state0Sub: 0, someFlag1: 0, idleCounter: 360, keyInput: 0, keyInput2: 0, unk22: 0, qCamOffsetX: 0, qCamOffsetY: 0,
    unk28: [0], unk29: [0], framesInvulnerable: 0, partner: null, timerSpeedup: 0,
    body: { s: null, tf: { rotation: 0, qScaleX: 0x100, qScaleY: 0x100, x: 0, y: 0 } }, limbs: null,
  };
  p.callback = arrive;
  return p;
}

const idleOf = (p, c) => c.rom.s16(IDLE_ANIMS + p.character * 2);

// 0x08013060 and 0x08013160, the sprites: the body, and for Tails his tails, each with its tiles in sprite memory
function createSprites(c, p) {
  p.body.s = createSprite({
    tiles: 0x10000 + (p.id === 0 ? 0 : 0x800), frameFlags: 0x1000 | p.id | SPRITE.ROT_SCALE_ENABLE, anim: p.anim2 & 0xFFFF,
    x: I(p.qWorldX), y: I(p.qWorldY), oamFlags: (p.id === 0 ? 16 : 17 + p.id) << 6, palId: p.id, variant: u8(p.state1), prevAnim: 0xFFFF,
  });
  if (p.character === TAILS) {
    p.limbs = {
      s: createSprite({
        tiles: 0x10000 + 0x1000, anim: idleOf(p, c) + 11, variant: 1, frameFlags: 3 | 0x1000 | 0x40000 | 0x20,
        x: I(p.qWorldX), y: I(p.qWorldY), oamFlags: (p.id === 0 ? 16 : 17 + p.id) << 6, palId: p.id,
      }),
      tf: { rotation: 0, qScaleX: 0x100, qScaleY: 0x100, x: 0, y: 0 },
    };
  }
}

/** 0x08004178, InitializePlayer: the character's three tasks, what it does each frame, draws, and keeps for next frame. */
export function initializePlayer(c, p) {
  c.createTask(playerMain, p, 0x3000 + p.id);
  c.createTask(playerDraw, p, 0x3010 + p.id);
  c.createTask(t => { t.data.moveState2 = t.data.moveState; }, p, 0x3020 + p.id);   // 0x080050E0
  createSprites(c, p);
}

// sub_80142CC, sub_8014258 and sub_80144B4: the speeds it can reach, from the rings it has, and how fast it looks
function speeds(c, p) {
  p.unk8C = Q(7.5);
  p.unk88 = Q(9.5);
  p.unk90 = c.rom.s16(SPEEDS);
  p.unk94 = c.rom.s16(SPEEDS + 2);
  const q = abs(p.qSpeedGround);
  p.state0Sub = q <= Q(1.25) ? 0 : q <= Q(2.5) ? 1 : q <= Q(4) ? 2 : q <= Q(7) ? 3 : q <= Q(9) ? 4 : 5;
}

// 0x080045EC, Task_80045EC: the keys, or for a partner what its AI presses, then its state
function playerMain(t) {
  const p = t.data, { stage } = p, { c } = stage;
  speeds(c, p);
  if (p.role === 1) {
    if (p.moveState & IGNORE_INPUT) {
      p.keyInput = 0;
      p.keyInput2 = 0;
      p.unk22 = c.input;
    } else {
      const before = p.unk22 || p.keyInput;
      p.unk22 = 0;
      p.keyInput = c.input;
      p.keyInput2 = (before ^ p.keyInput) & p.keyInput;
    }
  } else if (p.ai) {
    const before = p.keyInput;
    if (stage.state !== 9 && stage.state !== 4) {
      p.keyInput = p.ai(p, p.partner);
      p.keyInput2 = (before ^ p.keyInput) & p.keyInput;
    }
  }
  if (!(p.moveState & TALKING)) p.callback(p);
}

// 0x08005068, Task_8005068
function playerDraw(t) {
  const p = t.data, { c } = p.stage;
  pickAnimation(c, p);
  animateAndDisplay(c, p);
  animateLimbs(c, p);
  if (p.stage.state === 3 && p.framesInvulnerable > 0 && p.anim0 !== 0x66) p.framesInvulnerable--;
}

const setCallback = (p, callback) => { p.callback = callback; };   // 0x0800D8C0, SetPlayerCallback
const clearOnState = p => {
  p.moveState &= ~(CLEAR_ON_STATE | ROLLING | IN_AIR);
  p.unk99 = 0;
  p.unk9A = 0;
  p.qCamOffsetY = 0;
};

// 0x080042F4 (sub_80042F4): keeps its feet where they are when its height changes
function feet(p, offsetY) {
  if (p.spriteOffsetY === offsetY) return;
  let a = u8(p.angle);
  const v = a + 0x20;
  if (v > 0) a = a !== 0 ? u8(v - 1) : 0x20;
  else a = a !== 0 ? u8(v) : 0x1F;
  const d = Q(offsetY - p.spriteOffsetY);
  switch (a >> 6) {
    case 0: p.qWorldY -= d; return;
    case 2: p.qWorldY += d; return;
    case 1: p.qWorldX += d; return;
    default: p.qWorldX -= d;
  }
}
const standing = p => {   // sub_8012FA0
  feet(p, 14);
  p.spriteOffsetX = 6;
  p.spriteOffsetY = 14;
};
const curled = p => {     // sub_8012FC0
  feet(p, 9);
  p.spriteOffsetX = 6;
  p.spriteOffsetY = 9;
};
const curledOffsets = p => {   // Player_8012FF0
  p.spriteOffsetX = 6;
  p.spriteOffsetY = 9;
};

/** Whether it's still coming out of a ring: what the rings look at to push it. */
export const isArriving = p => p.callback === arrive || p.callback === arriving;

// 0x0800522C, Player_800522C and 0x080052C8: coming out of the ring, in the air, until the fade in has ended
function arrive(p) {
  p.moveState &= ~(CLEAR_ON_STATE);
  p.moveState |= IGNORE_INPUT | ROLLING | IN_AIR;
  p.qSpeedAirX = 0;
  p.qSpeedAirY = 0;
  curled(p);
  p.anim0 = 0x13;
  p.callback = arriving;
  arriving(p);
}
function arriving(p) {
  if (keepInBounds(p)) return;
  if (!(p.moveState & IN_AIR)) {
    groundMoves(p);
    slopeSpeed(p);
    groundToAir(p);
    move(p);
    followGround(p);
  } else {
    airAnimation(p);
    gravity(p);
    move(p);
    turnUpright(p);
    airCollision(p);
  }
  // landing asks for another state, but until the fade in has ended it stays in this one, with the buttons off
  if (p.stage.state === 3) {
    p.framesInvulnerable = 0;
    p.moveState &= ~IGNORE_INPUT;
    p.callback = p.moveState & IN_AIR ? startFalling : startStanding;
  } else p.callback = arriving;
}

// 0x08005380, Player_8005380: standing still, or running if it isn't still
function startStanding(p) {
  clearOnState(p);
  standing(p);
  if (p.qSpeedGround !== 0 || ((p.angle + 0x20) & 0xC0) !== 0) {
    startRunning(p);
    return;
  }
  p.idleCounter = 360;
  p.anim0 = 0;
  p.callback = stand;
  stand(p);
}
// 0x08005434, Player_8005434
function stand(p) {
  if ((p.moveState & (HIT | COLLIDING | IN_AIR)) === HIT) return;
  groundMoves(p);
  slopeSpeed(p);
  idleAnimation(p);
  if (keepInBounds(p)) return;
  groundToAir(p);
  move(p);
  followGround(p);
  fallOffSteep(p);
  if (keepInBounds(p)) return;
  if (p.qSpeedGround !== 0) p.callback = run;
}
// 0x08005528, Player_8005528
function startRunning(p) {
  clearOnState(p);
  standing(p);
  p.anim0 = 8;
  p.unk5A = 0;
  p.idleCounter = 0;
  p.callback = run;
  run(p);
}
// 0x080055B8, Player_80055B8
function run(p) {
  if ((p.moveState & (HIT | COLLIDING | IN_AIR)) === HIT) return;
  groundMoves(p);
  slopeSpeed(p);
  if (keepInBounds(p)) return;
  groundToAir(p);
  move(p);
  followGround(p);
  fallOffSteep(p);
  if (p.qSpeedGround === 0 && !((p.angle + 0x20) & 0xC0)) {
    if (p.idleCounter < 10) p.idleCounter++;
    else p.callback = startStanding;
  } else p.idleCounter = 0;
}

// Player_800DB30 and sub_800DF10: falling
function startFalling(p) {
  p.moveState = (p.moveState & 0xDDFFFFBF) | ROLLING | IN_AIR;
  p.anim0 = abs(p.qSpeedAirX) < Q(1.25) ? 0x13 : 0x14;
  curledOffsets(p);
  p.callback = fall;
  fall(p);
}
function startFallingOff(p) {   // Player_800DAF4
  p.moveState = (p.moveState & 0xDDFFFFBF) | IN_AIR;
  p.callback = fall;
  fall(p);
}
function fall(p) {
  airAnimation(p);
  airSteering(p);
  if (keepInBounds(p)) return;
  gravity(p);
  move(p);
  turnUpright(p);
  airCollision(p);
  if ((p.moveState & (COLLIDING | IN_AIR)) === COLLIDING) {
    setCallback(p, startStanding);
    p.qSpeedGround = p.qSpeedAirX;
    p.angle = 0;
  }
}

// sub_8014AF8: after six seconds still, it looks around
function idleAnimation(p) {
  if (p.qSpeedGround === 0 && !((p.angle + 0x20) & 0xC0) && !(p.moveState & (IGNORE_INPUT | COLLIDING | WALL | IN_AIR | ROLLING))) {
    if (p.idleCounter > 0) p.idleCounter--;
    else p.anim0 = p.id === 0 ? 6 : 7;
  } else p.idleCounter = 360;
}

// sub_8015064: dies at the bottom, and stays within the camera's limits
function keepInBounds(p) {
  if (p.moveState & DEAD) return true;
  const cam = p.stage.camera;
  let x = p.qWorldX, y = p.qWorldY;
  if (x < Q(cam.minX + 12)) x = Q(cam.minX + 12);
  else if (x > Q(cam.maxX) - Q(11) - 1) x = Q(cam.maxX) - Q(11) - 1;
  if (y < Q(cam.minY)) y = Q(cam.minY);
  else if (y > Q(cam.maxY) - 1) y = Q(cam.maxY) - 1;
  if (x !== p.qWorldX) {
    p.qSpeedAirX = 0;
    p.qSpeedGround = 0;
  }
  if (y !== p.qWorldY) {
    p.qSpeedAirY = 0;
    p.qSpeedGround = 0;
  }
  p.qWorldX = x;
  p.qWorldY = y;
  return false;
}

// sub_8005800 and what it calls: the d-pad's speed on the ground, or slowing down without it, and the animation that goes with it
function groundMoves(p) {
  let anim = -1;
  if (p.unk4E === 0 && p.keyInput & (KEY.LEFT | KEY.RIGHT)) {
    if (p.qSpeedGround > 0) {
      if (p.keyInput & KEY.RIGHT) accelerate(p, false);
      else anim = brake(p);
    } else if (p.qSpeedGround < 0) {
      if (p.keyInput & KEY.LEFT) accelerate(p, true);
      else anim = brake(p);
    } else anim = startOff(p);
  } else anim = slowDown(p);
  if (anim !== -1) p.anim0 = anim;
  meetWalls(p);
  if ((p.moveState & (IN_AIR | WALL)) === WALL && !((p.angle + 0x20) & 0xC0)) {
    if ((p.keyInput & KEY.RIGHT && !(p.keyInput2 & KEY.RIGHT)) || (p.keyInput & KEY.LEFT && !(p.keyInput2 & KEY.LEFT))) p.anim0 = 0x21;
    else p.anim0 = 0;
  } else {
    const a = p.anim0;
    if (a !== 0 && a !== 0x11 && a !== 0x10 && a !== 3 && a !== 0xE && a !== 0xF && a !== 0x12) p.anim0 = 8;
  }
  if (p.moveState2 & WALL) p.moveState &= ~WALL;
}
function accelerate(p, left) {   // sub_80059A0
  p.anim0 = 8;
  let v = left ? -p.qSpeedGround : p.qSpeedGround;
  if (v < p.unk8C) {
    v += p.unk90;
    if (v > p.unk8C) v = p.unk8C;
  }
  if (left) {
    p.qSpeedGround = -v;
    p.moveState |= FACING_LEFT;
  } else {
    p.qSpeedGround = v;
    p.moveState &= ~FACING_LEFT;
  }
}
function slowDown(p) {           // sub_8005B04
  if (p.qSpeedGround === 0 && !((p.angle + 0x20) & 0xC0)) return 0;
  let q = abs(p.qSpeedGround) - 8;
  if (q < 0 && !((p.angle + 0x20) & 0xC0)) {
    p.qSpeedGround = 0;
    p.idleCounter = 360;
    return 0;
  }
  if (p.qSpeedGround < 0) q = -q;
  p.qSpeedGround = q;
  return 8;
}
function brake(p) {              // sub_8005A24
  let result = 0xFF;
  let q = abs(p.qSpeedGround) - p.unk94;
  const a = p.anim0;
  if (a >= 16 && a <= 18) result = a;
  else if (q >= 512) {
    result = p.state0Sub > 3 ? 0x11 : 0x10;
    playOrContinue(p, 0x73);
  }
  if (q > 0 && q < 512 && ((p.qSpeedGround < 0 && p.moveState & FACING_LEFT) || (p.qSpeedGround > 0 && !(p.moveState & FACING_LEFT)))) p.callback = turning;
  if (p.qSpeedGround < 0) q = -q;
  p.qSpeedGround = s16(q);
  return result === 0xFF ? -1 : result;
}
function startOff(p) {           // sub_8005B78
  if ((p.moveState & FACING_LEFT) !== ((p.keyInput & KEY.RIGHT) >> 4)) {
    if (p.moveState & FACING_LEFT) p.qSpeedGround -= p.unk90;
    else p.qSpeedGround += p.unk90;
    standing(p);
  } else p.callback = turning;
  return 8;
}
// Turning round on the spot isn't made yet, which A character running needs: for now it goes on as it was
function turning(p) {
  p.callback = run;
}
function playOrContinue(p, song) {
  if (p.id === p.stage.playerIndex) p.stage.c.playSong(song);
}

// sub_8014E70: stops at walls ahead, and looks behind when it's slow
function meetWalls(p) {
  let met = false;
  for (let i = 0; i < 2; i++) {
    let dir = 0x40;
    if (p.qSpeedGround !== 0) {
      if (p.qSpeedGround > 0) dir = 0xC0;
    } else if (!(p.moveState & FACING_LEFT)) dir = 0xC0;
    if (i !== 0) {
      if (abs(p.qSpeedGround) <= Q(3)) dir = u8(dir + 0x80);
      else continue;
    }
    const a = u8(p.angle + dir);
    const d = Q(wallDistance(a, p));
    if (d <= 0) {
      met = true;
      const side = (a + 0x20 & 0xC0) >> 6;
      if (side === 0) {
        p.qWorldY += d;
        p.angle = 0;
        if (i === 0) {
          p.qSpeedAirY = 0;
          p.qSpeedGround = 0;
        }
      } else if (side === 2) {
        p.qWorldY -= d;
        p.angle = 0;
        if (i === 0) {
          p.qSpeedAirY = 0;
          p.qSpeedAirX = 0;
          p.qSpeedGround = 0;
        }
        p.moveState |= IN_AIR;
      } else {
        p.qWorldX += side === 1 ? -d : d;
        if (i === 0) {
          p.moveState |= WALL;
          p.qSpeedAirX = 0;
          p.qSpeedGround = 0;
        }
      }
    }
  }
  if (met) {
    p.unk99 = 0;
    p.unk9A = 0;
  }
}
// sub_8011BFC
function wallDistance(a, p) {
  const x = I(p.qWorldX), y = I(p.qWorldY);
  p.unk29[0] = a;
  p.unk28[0] = a;
  const sa = s8(a), v = s8(a + 0x20);
  const turned = u8(a + (((v > 0 && sa > 0) || (v <= 0 && sa <= 0)) ? 0x1F : 0x20));
  switch (turned >> 6) {
    case 0: return findGround(2, 2 + y + p.spriteOffsetX, x, p.layer, 8, null, acrossY);
    case 2: return findGround(2, -2 + y - p.spriteOffsetX, x, p.layer, -8, null, acrossY);
    case 1: return findGround(2, -2 + x - p.spriteOffsetX, y, p.layer, -8, null, acrossX);
    default: return findGround(2, 2 + x + p.spriteOffsetX, y, p.layer, 8, null, acrossX);
  }
}

// sub_8015144: slopes speed it up or slow it down
function slopeSpeed(p) {
  if (u8(p.angle + 0x60) < 0xC0 && p.qSpeedGround !== 0) p.qSpeedGround += (sin8(p.angle * 4) * 3) >> 5;
}
// Player_801479C: its speed on the ground, as speeds in the air
function groundToAir(p) {
  if (p.qSpeedGround > s16(p.unk88)) p.qSpeedGround = p.unk88;
  else if (p.qSpeedGround < -s16(p.unk88)) p.qSpeedGround = -p.unk88;
  const q = p.qSpeedGround;
  p.qSpeedAirX = (cos8(p.angle * 4) * q) >> 8;
  if (!(p.moveState & IN_AIR)) p.qSpeedAirY = 0;
  p.qSpeedAirY += (sin8(p.angle * 4) * q) >> 8;
}
// sub_8016D30
function move(p) {
  p.qWorldX += p.qSpeedAirX;
  p.qSpeedAirY = Math.min(p.qSpeedAirY, Q(15));
  p.qWorldY += p.qSpeedAirY;
}
// sub_8012EB8 and sub_801139C: stays on the ground, or falls off it
function followGround(p) {
  if (p.moveState & COLLIDING) {
    p.unk29[0] = 0;
    p.unk28[0] = 0;
    return;
  }
  let a = s8(p.angle);
  if (a + 0x20 > 0) a += a <= 0 ? 0x20 : 0x1F;
  else a += a > 0 ? 0x20 : 0x1F;
  const side = [0, 2, 1, 3][u8(a) >> 6];
  if (groundDistance(side, p)) {
    p.moveState |= IN_AIR;
    setCallback(p, startFallingOff);
    return;
  }
  p.moveState &= ~IN_AIR;
}
// sub_80116A4: 1 when the ground is too far away to stay on
function groundDistance(side, p) {
  const x = I(p.qWorldX), y = I(p.qWorldY);
  let a, b;
  switch (side) {
    case 0:
      a = findGround(2, y + p.spriteOffsetY, x - 2 - p.spriteOffsetX, p.layer, 8, p.unk28, acrossY);
      b = findGround(2, y + p.spriteOffsetY, x + 2 + p.spriteOffsetX, p.layer, 8, p.unk29, acrossY);
      break;
    case 1:
      a = findGround(2, y - p.spriteOffsetY, x + 2 + p.spriteOffsetX, p.layer, -8, p.unk28, acrossY);
      b = findGround(2, y - p.spriteOffsetY, x - 2 - p.spriteOffsetX, p.layer, -8, p.unk29, acrossY);
      break;
    case 2:
      a = findGround(2, x - p.spriteOffsetY, y - 2 - p.spriteOffsetX, p.layer, -8, p.unk28, acrossX);
      b = findGround(2, x - p.spriteOffsetY, y + 2 + p.spriteOffsetX, p.layer, -8, p.unk29, acrossX);
      break;
    default:
      a = findGround(2, x + p.spriteOffsetY, y + 2 + p.spriteOffsetX, p.layer, 8, p.unk28, acrossX);
      b = findGround(2, x + p.spriteOffsetY, y - 2 - p.spriteOffsetX, p.layer, 8, p.unk29, acrossX);
  }
  const d = Math.min(a, b);
  let wx = p.qWorldX, wy = p.qWorldY;
  if (d !== 0) {
    if (d < 0) {
      if (d < -14) return 0;
    } else {
      const speed = side & 2 ? p.qSpeedAirY : p.qSpeedAirX;
      if (d > Math.min(I(abs(speed)) + 3, 11)) return 1;
    }
    switch (side) {
      case 0: wy += Q(d); break;
      case 1: wy -= Q(d); break;
      case 2: wx -= Q(d); break;
      default: wx += Q(d);
    }
  }
  const angle = a < b ? p.unk28[0] : p.unk29[0];
  if (side & 2) p.qWorldX = wx;
  else p.qWorldY = wy;
  if (!(angle & 1)) p.angle = angle;
  return 0;
}
// sub_8016E00: too steep and too slow, it falls
function fallOffSteep(p) {
  if (p.unk4E !== 0) p.unk4E--;
  else if ((p.angle + 0x20) & 0xC0 && abs(p.qSpeedGround) < Q(1.875)) {
    setCallback(p, startFallingOff);
    p.unk4E = 30;
  }
}

// sub_801350C: from curled up to the fall as it comes down, for the air's animations 19 to 21
function airAnimation(p) {
  const { c } = p.stage, s = p.body.s, anim = u16of(p.anim2 - idleOf(p, c));
  if (p.anim0 === 19 || p.anim0 === 20) {
    if (p.state1 === 0 && s.frameFlags & 0x4000 && (anim === 19 || anim === 20)) {
      p.state1 = 1;
      p.moveState |= ROLLING;
      curledOffsets(p);
      return;
    }
    if (p.qSpeedAirY <= 0 || p.state1 !== 1) return;
    if (anim === 19 || anim === 20) {
      const d = findGround(5, I(p.qWorldY) + p.spriteOffsetY, I(p.qWorldX), p.layer, 8, null, acrossY);
      if (d <= 32) p.state1 = 2;
    }
  }
}
const u16of = v => v & 0xFFFF;
// sub_8014940: the d-pad in the air
function airSteering(p) {
  const acc = p.unk90 * 2, max = p.unk8C;
  if (p.anim0 === 0x66 || p.moveState & LOCK_AIR) return;
  let q = p.qSpeedAirX;
  if (p.keyInput & KEY.LEFT) {
    p.moveState |= FACING_LEFT;
    q -= acc;
    if (q < -max) {
      q += acc;
      if (q > -max) q = -max;
    }
  } else if (p.keyInput & KEY.RIGHT) {
    p.moveState &= ~FACING_LEFT;
    q += acc;
    if (q > max) {
      q -= acc;
      if (q < max) q = max;
    }
  }
  p.qSpeedAirX = s16(q);
}
const gravity = p => { p.qSpeedAirY += p.moveState & UNDERWATER ? Q(0.046875) : Q(0.1640625); };
// sub_8016EB0
function turnUpright(p) {
  let a = s8(p.angle);
  if (a < 0) a = Math.min(a + 2, 0);
  else if (a > 0) a = Math.max(a - 2, 0);
  p.angle = u8(a);
}
// sub_80110E8: below, or above, the ground under both its sides
function airFloor(side, p, angle) {
  const x = s16(I(p.qWorldX)), y = s16(I(p.qWorldY));
  const a = [0], b = [0];
  let near, far;
  if (side === 2) {
    let layer = p.layer;
    if (p.qSpeedAirY < Q(3)) layer |= 0x80;
    near = findGround(2, y - p.spriteOffsetY, x - 2 - p.spriteOffsetX, layer, -8, a, acrossY);
    far = findGround(2, y - p.spriteOffsetY, x + 2 + p.spriteOffsetX, layer, -8, b, acrossY);
  } else {
    let layer = p.layer;
    if (p.qSpeedAirY < 0) layer |= 0x80;
    near = findGround(2, y + p.spriteOffsetY, x - 2 - p.spriteOffsetX, layer, 8, a, acrossY);
    far = findGround(2, y + p.spriteOffsetY, x + 2 + p.spriteOffsetX, layer, 8, b, acrossY);
  }
  angle[0] = near < far ? a[0] : b[0];
  if (angle[0] & 1) angle[0] = 0;
  return near < far ? near : far;
}
function airWalls(p, withAll) {
  const layered = () => (p.qSpeedAirY < Q(3) ? p.layer | 0x80 : p.layer);
  let d = findGround(2, -3 - p.spriteOffsetX + I(p.qWorldX), I(p.qWorldY), layered(), -8, null, acrossX);
  if (d <= 0) {
    p.qWorldX -= Q(d);
    p.qSpeedAirX = 0;
    if (withAll === 'left') p.qSpeedGround = p.qSpeedAirY;
  }
  if (withAll === 'left') return;
  d = findGround(2, 3 + p.spriteOffsetX + I(p.qWorldX), I(p.qWorldY), layered(), 8, null, acrossX);
  if (d <= 0) {
    p.qWorldX += Q(d);
    p.qSpeedAirX = 0;
    if (withAll === 'right') p.qSpeedGround = p.qSpeedAirY;
  }
}
// sub_8012F10: landing
function land(p) {
  setCallback(p, startStanding);
  if (p.moveState & ROLLING) {
    p.moveState &= ~ROLLING;
    feet(p, 0xE);
  }
  p.spriteOffsetX = 6;
  p.spriteOffsetY = 14;
  p.moveState &= ~0xC;
}
// Player_80149E4 and sub_8011D08, sub_8011E70, sub_8011FB8 and sub_8012118, by the way it's moving: walls and ground in the air
function airCollision(p) {
  const y = s16(p.qSpeedAirY), x = s16(p.qSpeedAirX);
  let a = 0;
  if (x !== 0 || y !== 0) a = u8(arcTan2(x, y) >> 8);
  a = u8(a - 0x20) & ~0x3F;
  const angle = [0];
  switch (a >> 6) {
    case 0: {
      airWalls(p, false);
      const d = airFloor(3, p, angle);
      if (d < 0) {
        const sp = s8(angle[0]);
        p.angle = angle[0];
        p.qWorldY += d << 8;
        land(p);
        if ((angle[0] + 0x20) & 0x40) {
          p.qSpeedAirX = 0;
          if (p.qSpeedAirY > Q(11.8125)) p.qSpeedAirY = Q(11.8125);
          p.qSpeedGround = sp < 0 ? -abs(p.qSpeedAirY) : abs(p.qSpeedAirY);
        } else if (((angle[0] + 0x10) & 0x20) === 0) {
          p.qSpeedAirY = 0;
          p.qSpeedGround = p.qSpeedAirX;
        } else {
          p.qSpeedAirY >>= 1;
          p.qSpeedGround = sp < 0 ? -abs(p.qSpeedAirY) : abs(p.qSpeedAirY);
        }
      }
      break;
    }
    case 2: {
      airWalls(p, false);
      const d = airFloor(2, p, angle);
      if (d <= 0) {
        p.qWorldY -= d << 8;
        if (((angle[0] + 0x20) & 0x40) && s8(angle[0]) - 0x40 > 0) {
          p.angle = angle[0];
          land(p);
          p.qSpeedGround = abs(p.qSpeedAirY);
          return;
        }
        p.qSpeedAirY = 0;
      }
      break;
    }
    default: {
      airWalls(p, a >> 6 === 1 ? 'left' : 'right');
      let d = airFloor(2, p, angle);
      if (d <= 0) {
        p.qWorldY -= Q(d);
        if (p.qSpeedAirY < 0) p.qSpeedAirY = 0;
      } else if (p.qSpeedAirY >= 0) {
        d = airFloor(3, p, angle);
        if (d <= 0) {
          p.qWorldY += d << 8;
          p.angle = angle[0];
          land(p);
          p.qSpeedAirY = 0;
          p.qSpeedGround = p.qSpeedAirX;
        }
      }
    }
  }
}

// sub_801320C (0x08013260), which animation from its state
function pickAnimation(c, p) {
  const { rom } = c, s = p.body.s, idle = idleOf(p, c);
  if (p.anim0 !== p.anim1) {
    const a0 = rom.s16(ANIM_TABLE + p.anim0 * 4), a1 = rom.s16(ANIM_TABLE + p.anim0 * 4 + 2);
    if (a1 !== -1) {
      p.anim2 = a0;
      p.state1 = a1;
    }
    s.animSpeed = 0x10;
  }
  if (p.anim0 === 8) {
    p.anim2 = idle + 8;
    p.state1 = p.state0Sub;
    const q = (p.qSpeedGround >> 5) + (p.qSpeedGround >> 6);
    let speed = abs(q);
    speed = speed >= 8 ? Math.min(speed, 0x80) : 8;
    s.animSpeed = speed;
  } else if (p.anim0 < 0xA5) p.anim2 = rom.s16(ANIM_TABLE + p.anim0 * 4) + idle;
  if (p.someFlag1 || s.anim !== (p.anim2 & 0xFFFF) || s.variant !== u8(p.state1)) {
    p.someFlag1 = 0;
    s.anim = p.anim2 & 0xFFFF;
    s.variant = u8(p.state1);
    s.prevVariant = 0xFF;
  }
  p.anim1 = p.anim0;
}

// Player_AnimateAndDisplay
function animateAndDisplay(c, p) {
  const s = p.body.s, tf = p.body.tf, cam = p.stage.camera;
  const x = I(p.qWorldX) - cam.x, y = I(p.qWorldY) - cam.y;
  s.x = x;
  s.y = y;
  tf.x = x;
  tf.y = y;
  if (p.anim0 === 8) {
    tf.rotation = p.angle * 4;
    s.frameFlags &= ~(SPRITE.X_FLIP | SPRITE.Y_FLIP | SPRITE.ROT_SCALE);
    s.frameFlags |= p.id | SPRITE.ROT_SCALE_ENABLE;
    tf.qScaleX = p.moveState & FACING_LEFT ? 0x100 : -0x100;
    if (tf.qScaleX < 0) tf.x--;
    tf.qScaleY = 0x100;
    tf.qScaleX = (tf.qScaleX * p.unkA0) >> 8;
    tf.qScaleY = (tf.qScaleY * p.unkA2) >> 8;
    s.frameFlags = (s.frameFlags & ~SPRITE.PRIORITY) | 0x1000;
    updateSprite(c, s);
    transformSprite(c, s, tf, SINE);
  } else {
    tf.rotation = 0;
    s.frameFlags &= ~(SPRITE.ROT_SCALE | SPRITE.ROT_SCALE_ENABLE);
    if (!(p.moveState & FACING_LEFT)) s.frameFlags |= SPRITE.X_FLIP;
    else {
      s.frameFlags &= ~SPRITE.X_FLIP;
      s.x++;
    }
    s.frameFlags &= ~SPRITE.Y_FLIP;
    s.frameFlags = (s.frameFlags & ~SPRITE.PRIORITY) | 0x1000;
    updateSprite(c, s);
  }
  let show = true;
  if (!(p.moveState & DEAD) && (p.moveState & HIDDEN || (!(p.moveState & HIT) && p.framesInvulnerable !== 0 && p.stage.timer & 2))) show = false;
  if (show) displaySprite(c, s);
}

// Player_RollingAnimateAndDisplayLimbs, Tails's tails
function animateLimbs(c, p) {
  if (!p.limbs) return;
  const { s, tf } = p.limbs, cam = p.stage.camera;
  tf.x = I(p.qWorldX) - cam.x;
  tf.y = I(p.qWorldY) - cam.y;
  s.animSpeed = 0x10;
  const anim = u16of(p.anim2 - idleOf(p, c));
  if (!(((anim === 19 || anim === 20) && p.state1 === 1) || (anim === 11 && p.state1 === 0))) {
    if (anim !== 0x83 || p.state1 !== 0) return;
  }
  const vx = s16(p.qSpeedAirX), vy = s16(p.qSpeedAirY);
  const theta = vx !== 0 || vy !== 0 ? u8((arcTan2(vx, vy) >> 8) + 0x40) : p.moveState & FACING_LEFT ? 0xC0 : 0x40;
  tf.rotation = theta * 4;
  s.frameFlags = (s.frameFlags & ~SPRITE.ROT_SCALE) | 5 | SPRITE.ROT_SCALE_ENABLE;
  tf.qScaleX = p.moveState & FACING_LEFT ? 0x100 : -0x100;
  if (tf.qScaleX < 0) tf.x--;
  tf.qScaleY = 0x100;
  tf.qScaleX = (tf.qScaleX * p.unkA0) >> 8;
  tf.qScaleY = (tf.qScaleY * p.unkA2) >> 8;
  updateSprite(c, s);
  transformSprite(c, s, tf, SINE);
  if (!(p.moveState & DEAD) && (p.moveState & HIDDEN || (p.framesInvulnerable !== 0 && p.stage.timer & 2))) return;
  displaySprite(c, s);
}
