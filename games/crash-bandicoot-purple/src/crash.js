// Crash on foot in a level: how he moves, meets the level's lines and changes from one state to another, rewritten from
// how the original does it, from its own instructions. Each function is named by its address in the USA copy.

import { playAnimation, stepAnimation } from './sprites.js';
import { FLOOR_THROUGH, FLOOR, WALL_ON_LEFT, WALL_ON_RIGHT, CEILING, findLines, pointAbove, pointBeside, within } from './collision.js';

const CARTRIDGE = 0x08000000;
// 0x0807768C: his animations, and 0x080777C0: the moves, each a speed, how fast it changes and where it stops, across then down
const ANIMATIONS = 0x0807768C, MOVES = 0x080777C0;
// 0x08076DD4: how fast he has to be falling for a jump's next animations
const FALL_FIRST = 0x08076DD4, FALL_SECOND = 0x08076DD8, FALL_DOUBLE = 0x08076DDC, FALL_SPIN = 0x08076DE4;
const KEY_A = 0x1, KEY_B = 0x2, KEY_RIGHT = 0x10, KEY_LEFT = 0x20, KEY_DOWN = 0x80;
// the sounds he makes
const SOUND_JUMP = 0x08085D60, SOUND_DOUBLE = 0x08085D6C, SOUND_SPIN = 0x08085D54, SOUND_LAND = 0x08085D78, SOUND_FOURTH = 0x08085D60;
// 0x08021E74: how long he stands before he does one of his other standing animations
const WAIT = 0x12B;

const animation = (c, n) => c.rom.u32(ANIMATIONS - CARTRIDGE + n * 4);
const word = (c, at) => c.rom.view.getInt32(at - CARTRIDGE, true);

/** 0x08021B08 with 0x08022AB8: Crash at his place, standing still and falling to the ground (`sprite` from createActor). */
export function createCrash(c, sprite, tree) {
  const { box } = sprite, rect = { x: sprite.x - (box.w << 7), y: sprite.y - (box.h << 7), w: box.w << 8, h: box.h << 8 };
  const crash = {
    sprite, tree,
    state: 0, waited: 0,
    speedX: { speed: 0, change: 0, stop: 0 }, speedY: { speed: 0, change: 0, stop: 0 },
    last: rect, lastX: sprite.x, lastY: sprite.y, movedX: 0, movedY: 0,
    floors: 0, wallsLeft: 0, wallsRight: 0, ceilings: 0, grounded: false,
  };
  moveAcross(c, crash, 1, leftHeld(c));
  moveDown(c, crash, 15);
  return crash;
}

const leftHeld = c => (c.held & KEY_LEFT) !== 0, rightHeld = c => (c.held & KEY_RIGHT) !== 0;
const onGround = crash => crash.floors !== 0;   // 0x080105EC

// 0x08023D70 and 0x08038E1C: a row of 0x080777C0's moves across, the other way if `flip`
function moveAcross(c, crash, row, flip) {
  const at = MOVES + row * 24, sign = flip ? -1 : 1;
  crash.speedX = { speed: sign * word(c, at), change: word(c, at + 4), stop: sign * word(c, at + 8) };
}

// 0x08023D54 and 0x08038DE4: its moves down
function moveDown(c, crash, row) {
  const at = MOVES + row * 24 + 12;
  crash.speedY = { speed: word(c, at), change: word(c, at + 4), stop: word(c, at + 8) };
}

// 0x08023D8C
const play = (c, crash, n, clock) => playAnimation(crash.sprite, animation(c, n), clock);

// 0x080002D8: a speed a step nearer where it stops
function stepSpeed(s) {
  if (s.speed < s.stop) s.speed = Math.min(s.speed + s.change, s.stop);
  else if (s.speed > s.stop) s.speed = Math.max(s.speed - s.change, s.stop);
}

const rectOf = ({ sprite: { x, y, box } }) => ({ x: x - (box.w << 7), y: y - (box.h << 7), w: box.w << 8, h: box.h << 8 });

// 0x0800F914: floors he stands on at his middle, and 0x0800F9E4 at his middle or either side (0x08010794, 0x08010738)
function landOn(crash, lines, sides) {
  const { sprite } = crash, half = sprite.box.w << 7, h = sprite.box.h << 7;
  for (const line of lines) {
    const p = pointAbove(line, sprite.x, sprite.y);
    if (within(line, p.x, p.y) || (sides && (within(line, p.x - half, p.y) || within(line, p.x + half, p.y)))) {
      sprite.y = p.y - 0x100 - h;
      crash.floors++;
    }
  }
}

// 0x0800F568: where he's gone since the last frame against the lines there: up, down, left and right
function meetLines(crash) {
  const { sprite, tree, last } = crash, { box } = sprite;
  let rect = rectOf(crash);
  if (last.y - rect.y > 0) {
    // 0x0800F7A0 and 0x0800FAA8
    const lines = [];
    findLines(tree, CEILING, rect.x, rect.y, rect.w, last.y - rect.y, lines);
    for (const line of lines) {
      const p = pointAbove(line, sprite.x, sprite.y), half = box.w << 7;
      if (within(line, p.x, p.y) || within(line, p.x - half, p.y) || within(line, p.x + half, p.y)) {
        sprite.y = p.y + (box.h << 7) + 0x100;
        crash.ceilings++;
      }
    }
    rect = rectOf(crash);
  }
  const bottom = rect.y + rect.h, lastBottom = last.y + last.h;
  if (bottom - lastBottom > 0) {
    // 0x0800F6F4
    const through = [];
    findLines(tree, FLOOR_THROUGH, rect.x, lastBottom, rect.w, bottom - lastBottom, through);
    landOn(crash, through, false);
    if (!onGround(crash)) {
      const floors = [];
      findLines(tree, FLOOR, rect.x, lastBottom, rect.w, bottom - lastBottom, floors);
      landOn(crash, floors, true);
    }
    rect = rectOf(crash);
  }
  const h = box.h << 7;
  if (last.x - rect.x > 0) {
    // 0x0800F818 and 0x0800FB68
    const lines = [];
    findLines(tree, WALL_ON_LEFT, rect.x, rect.y, last.x - rect.x, rect.h, lines);
    for (const line of lines) {
      const p = pointBeside(line, sprite.x, sprite.y);
      if (within(line, p.x, p.y) || within(line, p.x, p.y - h) || within(line, p.x, p.y + h)) {
        sprite.x = p.x + (box.w << 7) + 0x100;
        crash.wallsLeft++;
      }
    }
    rect = rectOf(crash);
  }
  const right = rect.x + rect.w, lastRight = last.x + last.w;
  if (right - lastRight > 0) {
    // 0x0800F890 and 0x0800FC20
    const lines = [];
    findLines(tree, WALL_ON_RIGHT, lastRight, rect.y, right - lastRight, rect.h, lines);
    for (const line of lines) {
      const p = pointBeside(line, sprite.x, sprite.y);
      if (within(line, p.x, p.y) || within(line, p.x, p.y - h) || within(line, p.x, p.y + h)) {
        sprite.x = p.x - 0x100 - (box.w << 7);
        crash.wallsRight++;
      }
    }
  }
}

// 0x08010150: whether a box holds a line of a kind, as 0x08023270 asks for his head, and 0x08023334 and 0x080232D0 his sides
const lineIn = (crash, kind, x, y, w, h) => findLines(crash.tree, kind, x, y, w, h) !== 0;
const headFree = crash => { const r = rectOf(crash); return !lineIn(crash, CEILING, r.x, r.y - 0x100, r.w, r.h); };
const rightFree = crash => { const r = rectOf(crash); return !lineIn(crash, WALL_ON_RIGHT, r.x + r.w, r.y, 0x100, r.h); };
const leftFree = crash => { const r = rectOf(crash); return !lineIn(crash, WALL_ON_LEFT, r.x - 0x100, r.y, 0x100, r.h); };

// 0x08022B50: back to standing, with one of his standing animations
function stand(c, crash, which, clock) {
  play(c, crash, which & 3, clock);
  moveAcross(c, crash, 1, crash.sprite.flipX);
  moveDown(c, crash, 1);
  crash.state = 1;
  crash.waited = 0;
}

// 0x08022C70: running, the way he faces
function run(c, crash, clock) {
  const left = leftHeld(c);
  crash.sprite.flipX = left;
  play(c, crash, 4, clock);
  moveAcross(c, crash, 2, left);
  moveDown(c, crash, 2);
  crash.state = 2;
}

// 0x08022D30: landing, which stands him still
function land(c, crash, clock) {
  play(c, crash, 9, clock);
  c.playSound(SOUND_LAND);
  moveAcross(c, crash, 1, crash.sprite.flipX);
  moveDown(c, crash, 1);
  crash.state = 19;
}

// 0x08022DE4 and 0x08023FD8: crouching, and getting up, whose animation runs backward
function crouch(c, crash, clock) {
  play(c, crash, 13, clock);
  moveAcross(c, crash, 1, leftHeld(c));
  moveDown(c, crash, 1);
  crash.state = 21;
}
function getUp(c, crash, clock) {
  play(c, crash, 13, clock);
  crash.sprite.backward = true;
  moveAcross(c, crash, 1, leftHeld(c));
  moveDown(c, crash, 1);
  crash.state = 22;
}

// 0x0802421C and 0x0802411C: a jump, standing or running
function jump(c, crash, state, clock) {
  play(c, crash, 5, clock);
  moveDown(c, crash, 4);
  crash.state = state;
  c.playSound(SOUND_JUMP);
}

// 0x08024170 and 0x080240A8: a second jump in the air
function jumpAgain(c, crash, n, row, state, clock) {
  play(c, crash, n, clock);
  moveDown(c, crash, row);
  crash.state = state;
  c.playSound(SOUND_DOUBLE);
}

// 0x08024278 and 0x080242A4: a spin in the air and on the ground, `counted` frames in
function spinInAir(c, crash, counted, clock) {
  play(c, crash, 10, clock);
  crash.state = 4;
  crash.waited = counted;
}
function spin(c, crash, counted, clock) {
  play(c, crash, 10, clock);
  moveDown(c, crash, 3);
  crash.state = 3;
  crash.waited = counted;
}

// 0x08024034: walking off an edge
function fall(c, crash, clock) {
  play(c, crash, 12, clock);
  moveDown(c, crash, 15);
  crash.state = 20;
}

const jumpPressed = (c, crash) => (c.pressed & KEY_A) !== 0 && headFree(crash);   // 0x08023DE8, 0x08023270
const spinPressed = c => (c.pressed & KEY_B) !== 0;   // 0x08023DD8

// 0x08023030: steering, on the ground or in the air, with a row of 0x080777C0's moves
function steer(c, crash, row) {
  const left = leftHeld(c), right = rightHeld(c), { sprite, speedX } = crash, at = MOVES + row * 24;
  if (left === right) { moveAcross(c, crash, 1, false); return; }
  if (right) {
    sprite.flipX = false;
    if (!rightFree(crash)) { moveAcross(c, crash, 1, false); return; }
    if (word(c, at + 8) > speedX.speed) { speedX.change = word(c, at + 4); speedX.stop = word(c, at + 8); }
    return;
  }
  sprite.flipX = true;
  if (!leftFree(crash)) { moveAcross(c, crash, 1, true); return; }
  if (-word(c, at + 8) < speedX.speed) { speedX.change = word(c, at + 4); speedX.stop = -word(c, at + 8); }
}

// 0x08021E74: standing, which starts everything else
function standing(c, crash, clock) {
  const left = leftHeld(c), right = rightHeld(c), { sprite } = crash;
  if (right && left) {
    const rFree = rightFree(crash), lFree = leftFree(crash);
    if (lFree !== rFree) {
      sprite.flipX = !rFree;
      run(c, crash, clock);
    }
  } else if (right) {
    sprite.flipX = false;
    if (rightFree(crash)) run(c, crash, clock);
  } else if (left) {
    sprite.flipX = true;
    if (leftFree(crash)) run(c, crash, clock);
  } else if (c.held & KEY_DOWN) crouch(c, crash, clock);
  jumpOrSpin(c, crash, clock);
  if (!onGround(crash)) fall(c, crash, clock);
  const playing = sprite.animation.address;
  if (playing === animation(c, 0)) {
    if (crash.state !== 1) return;
    if (crash.waited > WAIT && sprite.frame === 0) stand(c, crash, c.random(), clock);
    else crash.waited++;
    return;
  }
  // the fourth makes a sound partway through (0x08034238 keeps it from starting again while it plays)
  if (playing === animation(c, 3) && sprite.frame === 14 && !c.soundPlaying(SOUND_FOURTH)) c.playSound(SOUND_FOURTH);
  if (sprite.ended) stand(c, crash, 0, clock);
}

// what 0x08021E74 and 0x08022144 do with A and B on the ground
function jumpOrSpin(c, crash, clock, state = 6) {
  const up = jumpPressed(c, crash), turn = spinPressed(c);
  if (up) {
    if (turn) { moveDown(c, crash, 4); spinInAir(c, crash, 0, clock); }
    else jump(c, crash, state, clock);
  } else if (turn) spin(c, crash, 0, clock);
}

// the states of a jump (0x0802242C and those after it): steering, and what A or B does in the air
function inTheAir(c, crash, clock, again) {
  steer(c, crash, 2);
  const up = jumpPressed(c, crash), turn = spinPressed(c);
  if (up) {
    if (turn) { moveDown(c, crash, again.row); spinInAir(c, crash, 0, clock); return true; }
    jumpAgain(c, crash, again.n, again.row, again.state, clock);
    return true;
  }
  if (turn) { spinInAir(c, crash, 0, clock); return true; }
  return false;
}

// the states with no second jump left, where only B does anything
function afterJumps(c, crash, clock) {
  steer(c, crash, 2);
  if (spinPressed(c)) { spinInAir(c, crash, 0, clock); return true; }
  return false;
}

const FIRST_JUMP = { n: 8, row: 9, state: 10 }, RUNNING_JUMP = { n: 7, row: 10, state: 15 };

// 0x08021C58: what he does this frame, by his state
function runState(c, crash, clock) {
  const { sprite } = crash, falling = crash.movedY;
  const landed = () => { if (onGround(crash)) land(c, crash, clock); };
  switch (crash.state) {
    case 0:   // 0x08021DD4
      if (sprite.animation.loops ? onGround(crash) : sprite.ended) stand(c, crash, 0, clock);
      break;
    case 1:
      standing(c, crash, clock);
      break;
    case 2:   // 0x08022144
      if (sprite.flipX ? !leftHeld(c) || crash.wallsLeft : !rightHeld(c) || crash.wallsRight) stand(c, crash, 0, clock);
      jumpOrSpin(c, crash, clock, 12);
      if (!onGround(crash)) fall(c, crash, clock);
      break;
    case 3:   // 0x08022240
      if (crash.waited === 1) c.playSound(SOUND_SPIN);
      else if (crash.waited > 23) {
        const left = leftHeld(c), right = rightHeld(c);
        if (left === right) stand(c, crash, 0, clock);
        else {
          sprite.flipX = left;
          if (left ? leftFree(crash) : rightFree(crash)) run(c, crash, clock);
          else stand(c, crash, 0, clock);
        }
      }
      crash.waited++;
      steer(c, crash, 3);
      if ((c.pressed & KEY_A) && headFree(crash)) {
        if (crash.state === 2) jump(c, crash, 12, clock);
        else if (crash.state === 1) jump(c, crash, 6, clock);
        else { moveDown(c, crash, 4); spinInAir(c, crash, crash.waited, clock); }
      }
      if (!onGround(crash)) { moveDown(c, crash, 15); spinInAir(c, crash, crash.waited, clock); }
      break;
    case 4:   // 0x0802239C
      steer(c, crash, 3);
      if (crash.waited === 1) c.playSound(SOUND_SPIN);
      else if (crash.waited <= 23) {
        if (onGround(crash)) spin(c, crash, crash.waited, clock);
      } else {
        if (falling < 0) { play(c, crash, 11, clock); crash.state = 5; }
        else { play(c, crash, 6, clock); crash.state = 11; }
        landed();
      }
      crash.waited++;
      break;
    case 5:   // 0x08024624
      afterJumps(c, crash, clock);
      landed();
      break;
    case 6:   // 0x0802242C
      if (!inTheAir(c, crash, clock, FIRST_JUMP) && sprite.ended) {
        if (c.held & KEY_A) { play(c, crash, 6, clock); moveDown(c, crash, 7); crash.state = 8; }
        else { play(c, crash, 6, clock); moveDown(c, crash, 6); crash.state = 7; }
      }
      landed();
      break;
    case 7:   // 0x080224DC
      if (!inTheAir(c, crash, clock, FIRST_JUMP) && falling > word(c, FALL_FIRST)) crash.state = 9;
      landed();
      break;
    case 8:   // 0x0802257C
      if (!inTheAir(c, crash, clock, FIRST_JUMP) && falling > word(c, FALL_DOUBLE)) crash.state = 9;
      landed();
      break;
    case 9:   // 0x0802261C
      if (!inTheAir(c, crash, clock, FIRST_JUMP) && falling > word(c, FALL_SECOND)) crash.state = 18;
      landed();
      break;
    case 10:   // 0x080245C8
      if (!afterJumps(c, crash, clock) && falling > word(c, FALL_DOUBLE)) crash.state = 11;
      landed();
      break;
    case 11:   // 0x0802456C
      if (!afterJumps(c, crash, clock) && falling > word(c, FALL_SECOND)) crash.state = 17;
      landed();
      break;
    case 12:   // 0x080226BC
      if (!inTheAir(c, crash, clock, RUNNING_JUMP) && sprite.ended) { play(c, crash, 7, clock); crash.state = 13; }
      landed();
      break;
    case 13:   // 0x08022754
      if (!inTheAir(c, crash, clock, RUNNING_JUMP) && falling > word(c, FALL_SPIN)) crash.state = 14;
      landed();
      break;
    case 14:   // 0x080227F4
      if (!inTheAir(c, crash, clock, RUNNING_JUMP) && falling > word(c, FALL_SPIN)) crash.state = 18;
      landed();
      break;
    case 15:   // 0x08024510
    case 16:   // 0x080244B4
      if (!afterJumps(c, crash, clock) && falling > word(c, FALL_SPIN)) crash.state = 17;
      landed();
      break;
    case 17:   // 0x08024470
      afterJumps(c, crash, clock);
      landed();
      break;
    case 18:   // 0x08022894
      inTheAir(c, crash, clock, FIRST_JUMP);
      landed();
      break;
    case 19:   // 0x08024428
      standing(c, crash, clock);
      if (crash.state === 19 && sprite.ended) stand(c, crash, 0, clock);
      break;
    case 20:   // 0x080243E4
      afterJumps(c, crash, clock);
      landed();
      break;
    case 21:   // 0x08022924
      if (!(c.held & KEY_DOWN)) getUp(c, crash, clock);
      jumpOrSpin(c, crash, clock);
      if (!onGround(crash)) fall(c, crash, clock);
      break;
    case 22:   // 0x080243B4
      if (sprite.ended) stand(c, crash, 0, clock);
      if (!onGround(crash)) fall(c, crash, clock);
      break;
  }
}

// 0x08023DF8 and 0x080239C4: his head meeting a ceiling on the way up
function bump(c, crash, clock) {
  if (![6, 9, 10, 11, 12, 14, 15, 16].includes(crash.state)) return;
  if (crash.sprite.animation.address !== animation(c, 6)) play(c, crash, 6, clock);
  const at = MOVES + 15 * 24 + 12;
  if (crash.speedY.speed > word(c, at)) {
    crash.speedY.change = word(c, at + 4);
    crash.speedY.stop = word(c, at + 8);
  } else moveDown(c, crash, 15);
  crash.state = 17;
}

// 0x08023150: touching the ground, from whatever he was doing
function touchDown(c, crash, clock) {
  const { state } = crash;
  if (state === 4) {
    const { waited } = crash;
    play(c, crash, 10, clock);
    moveDown(c, crash, 3);
    crash.state = 3;
    crash.waited = waited;
  } else if ([6, 9, 10, 11, 12, 14, 15, 16, 17, 18, 20].includes(state)) land(c, crash, clock);
}

/** 0x08038520 with 0x0800F264: a frame of Crash: his animation, his move, the lines he meets, then what he does next. */
export function updateCrash(c, crash, clock) {
  const { sprite } = crash;
  stepAnimation(sprite, clock);
  // 0x0801CDF4
  stepSpeed(crash.speedX);
  sprite.x += crash.speedX.speed;
  stepSpeed(crash.speedY);
  sprite.y += crash.speedY.speed;
  crash.floors = crash.wallsLeft = crash.wallsRight = crash.ceilings = 0;
  meetLines(crash);
  // 0x0800F480
  crash.grounded = onGround(crash);
  crash.last = rectOf(crash);
  crash.movedX = sprite.x - crash.lastX;
  crash.movedY = sprite.y - crash.lastY;
  crash.lastX = sprite.x;
  crash.lastY = sprite.y;
  // 0x08023E54
  if (crash.ceilings) bump(c, crash, clock);
  if (onGround(crash)) touchDown(c, crash, clock);
  runState(c, crash, clock);
  // 0x08038FB4 with 0x0800F50C: the box of the animation he's in now, with his feet where they were on the ground
  sprite.box = sprite.animation;
  if (crash.grounded && crash.last.h !== sprite.box.h << 8) {
    sprite.y = crash.last.y + crash.last.h - (sprite.box.h << 7);
  }
}

/** 0x08007794 and 0x08007B4C: how far ahead of him and above him the camera looks, by his state and the way he faces. */
export function cameraLook(crash) {
  const { state, sprite } = crash;
  let x = sprite.flipX ? -0x1A00 : 0x1A00, y = -0x1A00;
  if ((state >= 4 && state <= 16) || state === 20) y += 0x1100;
  else if (state === 21) y += 0x2200;
  return { x, y };
}
