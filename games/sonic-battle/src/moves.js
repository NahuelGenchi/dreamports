// The fight's frame in Training mode and the fighters' state machines, as far as a fight's opening reaches: both
// fighters drop from above, land and stand, with nothing pressed. Each fighter's record is 252 bytes in work RAM, and
// what's not reached yet says so when it is: a throw, naming the original's function, in place of each path left out.
//
// A fighter's frame goes: the script of its state runs (fighterThink), it moves (moveFighter), what hit it counts
// (takeHits), then, once all have moved, its own attacks reach the others (reachOthers), its keys are read
// (readFighterKeys) and its state changes (fighterAct).

import { queueRegister } from './core.js';
import { read8, read16, read32, reads16, reads32, write8, write16, write32, s16, u16 } from './bus.js';
import {
  fn08016684, fn080175d4, fn080176e4, fn08017c5c, fn08017d58, fn08017ed0, fn08017f6c, fn080182ac, fn080182e4,
  fn08018300, fn08018318,
} from './sprites.js';
import { fn08013214 } from './hud.js';
import { fn0800673c, fn08006e64, fn08006ff4, fn0800b098 } from './fighters.js';
import { fn0800f9c0, fn08011c7c } from './arena.js';

const FIGHTERS = 0x03001C40, RECORD = 252;
const SETUP = 0x03001620;                    // gUnknown_03001620: what the fight is
const SLOTS = 0x03001634;                    // who stands in each of the four places, 255 for nobody
const PLAYER = 0x03001380;                   // the place the person plays
const KEYS = 0x03001B30, KEYS_PER_FIGHTER = 64, KEYS_PRESSED = 20, KEYS_RELEASED = 40, KEYS_NOW = 60;
const SCRIPTS = 0x08ED68A8, SCRIPTS_PER_CHARACTER = 280;
const DIRECTIONS = 0x0806B2D4;               // ten bytes per camera angle: the way each direction of the pad faces
const CAMERA_TURN = 0x0300204C;
const RANDOM = 0x0300019C;
const LIMIT_RIGHT = 0x03002B74, LIMIT_LEFT = 0x03002BD0, LIMIT_DOWN = 0x03002B80, LIMIT_UP = 0x03002B70;
const WALL_COUNT = 0x03002B84, WALLS = 0x03002B90, FLOOR = 0x03001384;

// a record's fields, by what the code does with them
const X = 0, Y = 2, Z = 4, OLD_X = 6, OLD_Y = 8, OLD_Z = 10, ANIMATION = 22, SCRIPT_AT = 24, SCRIPT_FRAME = 26,
  PAUSE = 28, PAUSE_NEXT = 29, PAUSE_DONE = 30, STATE = 20, CHARACTER_NOW = 23, WALK = 32, SLOW = 34, FACING = 36,
  LAST_FACING = 37, FALL = 38, TOP_SPEED = 40, MAX_SPEED = 42, SPEED_X = 44, SPEED_Y = 46, SPEED_Z = 48, BUMPED = 50,
  GROUND = 52, ATTACKS = 116, FLAGS = 180, CAMERA = 159, CHARACTER = 196, HEALTH = 191, KEYS_FOR_NEXT = 200;
const FLAG_GROUNDED = 0x1, FLAG_LANDED = 0x2, FLAG_IN_AIR = 0x4, FLAG_LOCKED = 0x100000, FLAG_NEW_STATE = 0x200000,
  FLAG_CHAIN = 0x400000;

const notPorted = (address, what) => { throw new Error(`0x${address}: ${what} isn't ported`); };
const record = i => FIGHTERS + i * RECORD;
const keysNow = (c, i) => { const at = KEYS + i * KEYS_PER_FIGHTER; return at + read8(c, at + KEYS_NOW) * 2; };
const held = (c, i) => read16(c, keysNow(c, i));
const pressed = (c, i) => read16(c, keysNow(c, i) + KEYS_PRESSED);
const isActive = (c, i) => read8(c, SLOTS + i) !== 255;
const addFlags = (c, rec, bits) => write32(c, rec + FLAGS, read32(c, rec + FLAGS) | bits);
const clearFlags = (c, rec, bits) => write32(c, rec + FLAGS, read32(c, rec + FLAGS) & ~bits);
// an arithmetic shift by a register, which fills with the sign from 32 on
const asrBy = (value, by) => (by >= 32 ? value >> 31 : value >> by);

/** 0x08020144: the next random number. */
function nextRandom(c) {
  const value = (Math.imul(read32(c, RANDOM), 0x14FA05) + 0xC0AF) >>> 0;
  write32(c, RANDOM, value);
  return value;
}

/** 0x0801fcd8: a sound effect with its place on the screen asked for, at most 32 a frame. */
function queueEffect(c, sound, place) {
  const count = read8(c, 0x03004470);
  if (count > 31) return 0;
  write16(c, 0x03004480 + count * 4, sound);
  write16(c, 0x03004480 + count * 4 + 2, place);
  write8(c, 0x03004470, count + 1);
  return 1;
}

/** 0x080205d0: the fade's next step, and whether it's over. */
function stepFade(c) {
  const kind = read8(c, 0x03004B04);
  if (kind === 0) return 1;
  if (kind === 1) {
    const level = read16(c, 0x03004B00);
    if (level & 0x8000) return 1;
    const next = u16(level + read16(c, 0x03004B08));
    write16(c, 0x03004B00, next);
    if (next > 0x8000) {
      write16(c, 0x03004B00, 0x8000);
      queueRegister(c, 84, 16);
    } else queueRegister(c, 84, (next & 0xF800) >> 11);
  } else if (kind === 2) {
    const level = read16(c, 0x03004B00), by = read16(c, 0x03004B08);
    if (level === 0) return 1;
    if (level < by) {
      write16(c, 0x03004B00, 0);
      queueRegister(c, 84, 0);
    } else {
      write16(c, 0x03004B00, level - by);
      queueRegister(c, 84, (u16(level - by) & 0xF800) >> 11);
    }
  }
  return 0;
}

/** 0x08020944: no fade any more. */
function endFade(c) {
  queueRegister(c, 80, 0);
  queueRegister(c, 84, 0);
  write8(c, 0x03004B04, 0);
  write16(c, 0x03004B00, 0);
  write16(c, 0x03004B08, 0);
}

// ---------------------------------------------------------------------------------------------- The keys of a frame

/** 0x08017964: a fighter's keys forgotten, and what every fighter will press next. */
function forgetKeys(c, i) {
  const at = KEYS + i * KEYS_PER_FIGHTER;
  write8(c, at + KEYS_NOW, 0);
  for (let k = 0; k < 10; k++) {
    write16(c, at + k * 2, 0);
    write16(c, at + KEYS_PRESSED + k * 2, 0);
    write16(c, at + KEYS_RELEASED + k * 2, 0);
  }
  for (let j = 0; j < 4; j++) write16(c, record(j) + KEYS_FOR_NEXT, 0);
}

// the next place in a fighter's ten frames of keys, with these keys in it
function keepKeys(c, i, now, justPressed, justReleased) {
  const at = KEYS + i * KEYS_PER_FIGHTER;
  let next = (read8(c, at + KEYS_NOW) + 1) & 0xFF;
  write8(c, at + KEYS_NOW, next);
  if (next > 9) { next = 0; write8(c, at + KEYS_NOW, 0); }
  write16(c, at + KEYS_PRESSED + next * 2, justPressed);
  write16(c, at + KEYS_RELEASED + next * 2, justReleased);
  write16(c, at + next * 2, now);
}

/** 0x080177b8: the person's keys go to their fighter, and the others' from what each will press next. */
function readAllKeys(c, player) {
  keepKeys(c, player, c.keys.held, c.keys.pressed, c.keys.released);
  for (let j = 0; j < 4; j++) {
    if (j === player) { write16(c, record(j) + KEYS_FOR_NEXT, c.keys.held); continue; }
    const now = read16(c, record(j) + KEYS_FOR_NEXT), old = held(c, j), changed = now ^ old;
    keepKeys(c, j, now, now & changed, old & changed);
  }
}

/** 0x080178d0: every fighter's keys from what each will press next, with no person playing. */
function readNextKeys(c) {
  for (let j = 0; j < 4; j++) {
    const now = read16(c, record(j) + KEYS_FOR_NEXT), old = held(c, j), changed = now ^ old;
    keepKeys(c, j, now, now & changed, old & changed);
  }
}

/** 0x0801c090: what the dummy in the fourth place presses, by the mode Training is in. */
function dummyKeys(c) {
  const dummy = record(3), keys = dummy + KEYS_FOR_NEXT, clock = SETUP + 134;
  write8(c, dummy + 141, 0);
  write8(c, dummy + CAMERA, read8(c, record(read32(c, PLAYER)) + CAMERA));
  if (!(read32(c, dummy + FLAGS) & FLAG_GROUNDED)) return;
  write8(c, clock, read8(c, clock) + 1);
  const mode = read8(c, SETUP + 38), time = read8(c, clock);
  const every = (frames, value) => {
    if (time === frames) { write8(c, clock, 0); write16(c, keys, value); return true; }
    write16(c, keys, 0);
    return false;
  };
  if (mode === 1) every(40, 1);
  else if (mode === 2) {
    const state = read16(c, dummy + STATE);
    if (state === 66 || state === 68) write16(c, keys, 0);
    else if (time <= 29) write16(c, keys, 64);
    else if (time <= 59) write16(c, keys, 16);
    else if (time <= 89) write16(c, keys, 128);
    else if (time <= 119) write16(c, keys, 32);
    else write8(c, clock, 0);
  } else if (mode === 3) every(20, 0x200);
  else if (mode === 4) every(30, 2);
  else if (mode === 5) {
    if (time !== 40) { write16(c, keys, 0); return; }
    write8(c, clock, 0);
    // 0x0804b55c is the division's remainder, unsigned
    const pick = (nextRandom(c) % 3) & 0xFF;
    if (pick === 0) write16(c, keys, read8(c, dummy + 17) === 0 ? 34 : 18);
    else if (pick === 1) write16(c, keys, 66);
    else if (pick === 2) write16(c, keys, 130);
  } else if (mode === 6) {
    every(40, read8(c, dummy + 17) === 0 ? 18 : 34);
  }
}

/** 0x080034f0: the way the pad's direction faces, by the fighter's camera. */
function padFacing(c, i) {
  const keys = held(c, i);
  let at = 0;
  if ((keys & 0x20) && (keys & 0x80)) at = 1;
  else if ((keys & 0x10) && (keys & 0x80)) at = 3;
  else if ((keys & 0x20) && (keys & 0x40)) at = 7;
  else if ((keys & 0x10) && (keys & 0x40)) at = 9;
  else if (keys & 0x80) at = 2;
  else if (keys & 0x20) at = 4;
  else if (keys & 0x10) at = 6;
  else if (keys & 0x40) at = 8;
  return read8(c, DIRECTIONS + read8(c, record(i) + CAMERA) * 10 + at);
}

// ------------------------------------------------------------------------------------------------ A state's script

// 0x08007ec8's switch: which of a character's scripts each state runs (and what it's kept as in ANIMATION)
const SCRIPT_OF = new Map([
  [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 20], [19, 21], [20, 24], [21, 27], [22, 30], [23, 33],
  [24, 36], [52, 56], [53, 57], [54, 60], [55, 62], [56, 63], [65, 39], [66, 40], [67, 43], [68, 47], [69, 41],
  [70, 48], [71, 45], [80, 49], [81, 50], [82, 51], [83, 52], [84, 53], [85, 54], [96, 64], [252, 65], [253, 66],
  [254, 67], [255, 68], [261, 6], [273, 19], [275, 22], [276, 25], [277, 28], [278, 31], [279, 34], [280, 37],
  [309, 58], [311, 61], [323, 44], [325, 42], [327, 46], [336, 55], [531, 23], [532, 26], [533, 29], [534, 32],
  [535, 35], [536, 38], [565, 59],
]);

/** 0x08007ec8: a new state starts its script from the top, and the state's script runs a frame. Partly: not Emerl's. */
function fighterThink(c, i) {
  const rec = record(i);
  const next = read8(c, rec + PAUSE_NEXT);
  if (next !== 0) {
    write8(c, rec + PAUSE_DONE, 1);
    write8(c, rec + PAUSE, next);
    write8(c, rec + PAUSE_NEXT, 0);
  }
  const done = read8(c, rec + PAUSE_DONE);
  if (read8(c, rec + PAUSE) !== 0 && done !== 1) return;
  if (done === 1) write8(c, rec + PAUSE_DONE, 0);
  if (read32(c, rec + FLAGS) & FLAG_NEW_STATE) {
    write16(c, rec + SCRIPT_AT, 0);
    write16(c, rec + SCRIPT_FRAME, 0);
    write16(c, rec + 160, 0);
    write16(c, rec + 162, 0);
    clearFlags(c, rec, FLAG_NEW_STATE);
  }
  const character = read8(c, rec + CHARACTER);
  if (character === 9) notPorted('0800964C', 'the character 9');
  const slot = SCRIPT_OF.get(read16(c, rec + STATE));
  if (slot === undefined) return;
  runScript(c, read32(c, SCRIPTS + character * SCRIPTS_PER_CHARACTER + slot * 4), i);
  write8(c, rec + ANIMATION, slot);
}

/** 0x0800290c: the words of this frame of a script, between two marks. */
function runScript(c, script, i) {
  const rec = record(i);
  const word = () => read32(c, script + reads16(c, rec + SCRIPT_AT) * 4);
  const isMark = () => (word() & 0xFFFF0000) >>> 0 === 0xFFF00000;
  const onward = () => write16(c, rec + SCRIPT_AT, read16(c, rec + SCRIPT_AT) + 1);
  while (!isMark()) onward();
  const mark = word() & 0xFFFF, frame = reads16(c, rec + SCRIPT_FRAME);
  if (mark !== frame) {
    // the script ended before this frame: back to standing
    if ((mark >>> 0) < (frame >>> 0)) {
      setState(c, i, 0);
      for (const field of [SPEED_X, SPEED_Y, SPEED_Z, WALK, SLOW, FALL, 104]) write16(c, rec + field, 0);
      write16(c, rec + TOP_SPEED, 0x300);
      write16(c, rec + MAX_SPEED, 0x300);
      clearFlags(c, rec, FLAG_LOCKED | FLAG_CHAIN);
    }
  } else {
    onward();
    let going = true;
    while (!isMark() && going) {
      going = runScriptWord(c, rec, i, word());
      onward();
    }
  }
  write16(c, rec + SCRIPT_FRAME, read16(c, rec + SCRIPT_FRAME) + 1);
}

// one word of 0x0800290c, and whether the words go on
function runScriptWord(c, rec, i, word) {
  const op = (word & 0xFFFF0000) >>> 0, value = word & 0xFFFF, signed = s16(word), boost = read8(c, rec + 155);
  switch (op) {
    case 0x00010000: {
      // a speed, by the way it faces, with the diagonals shorter
      const diagonal = ((Math.imul(signed, 11) << 12) >>> 16), negative = -s16(diagonal);
      switch (read8(c, rec + FACING)) {
        case 1: write16(c, rec + SPEED_X, negative); write16(c, rec + SPEED_Y, diagonal); break;
        case 2: write16(c, rec + SPEED_Y, value); break;
        case 3: write16(c, rec + SPEED_X, diagonal); write16(c, rec + SPEED_Y, diagonal); break;
        case 4: write16(c, rec + SPEED_X, -value); break;
        case 6: write16(c, rec + SPEED_X, value); break;
        case 7: write16(c, rec + SPEED_X, negative); write16(c, rec + SPEED_Y, negative); break;
        case 8: write16(c, rec + SPEED_Y, -value); break;
        case 9: write16(c, rec + SPEED_X, diagonal); write16(c, rec + SPEED_Y, negative); break;
        default:
      }
      break;
    }
    case 0x00020000: write16(c, rec + SPEED_Z, value); break;
    case 0x00100000: {
      let walk = u16(signed + (signed >> 2));
      if (boost === 7) walk = u16(s16(walk) + (s16(walk) >> 2));
      else if (boost === 8) walk = u16(s16(walk) + (s16(walk) >> 1));
      write16(c, rec + WALK, walk);
      break;
    }
    case 0x00110000: write16(c, rec + SLOW, value + (signed >> 2)); break;
    case 0x00120000: {
      let fall = value;
      if (boost === 1) fall = signed - (signed >> 3);
      else if (boost === 2) fall = signed - (signed >> 2);
      else if (boost === 3) fall = signed + (signed >> 3);
      else if (boost === 4) fall = signed + (signed >> 2);
      write16(c, rec + FALL, fall);
      break;
    }
    case 0x001F0000: {
      let top = value;
      if (boost === 5) top = signed + (signed >> 2);
      else if (boost === 6) top = signed + (signed >> 1);
      write16(c, rec + MAX_SPEED, top);
      break;
    }
    case 0x00200000: write16(c, rec + 96, value); break;
    case 0x00210000: write16(c, rec + 98, value); break;
    case 0x00220000: write16(c, rec + 100, value); break;
    case 0x00230000: write8(c, rec + 102, value); break;
    case 0x00240000: write16(c, rec + 104, value); break;
    case 0x00250000: {
      write8(c, rec + 106, value);
      write8(c, rec + 126, 0);
      write8(c, rec + 125, 255);
      write32(c, rec + ATTACKS, 0);
      if (read8(c, SETUP + 137 + i) === 0) {
        const count = SETUP + 58 + i * 2;
        write16(c, count, read16(c, count) + 1);
        write8(c, SETUP + 137 + i, 1);
      }
      break;
    }
    case 0x00260000: write8(c, rec + 113, value); break;
    case 0x00270000: write8(c, rec + 107, value); break;
    case 0x00330000: write8(c, rec + 186, value); break;
    case 0x00340000: write8(c, rec + 187, value); break;
    case 0x00F00000:
      setState(c, i, value);
      return false;
    case 0x00FF0000: {
      for (const field of [SPEED_X, SPEED_Y, SPEED_Z, WALK, SLOW, 104]) write16(c, rec + field, 0);
      write16(c, rec + TOP_SPEED, 0x7FFF);
      write16(c, rec + MAX_SPEED, 0x7FFF);
      write16(c, rec + FALL, 8);
      const state = read16(c, rec + STATE);
      if ([65, 67, 0x143, 69, 54, 71].includes(state)) {
        write16(c, rec + TOP_SPEED, 0x300);
        write16(c, rec + MAX_SPEED, 0x300);
      }
      break;
    }
    case 0x01000000: clearFlags(c, rec, FLAG_LOCKED); break;
    case 0x01100000: addFlags(c, rec, FLAG_LOCKED); break;
    case 0x01200000: addFlags(c, rec, FLAG_CHAIN); break;
    case 0x01300000: clearFlags(c, rec, FLAG_CHAIN); break;
    case 0x01400000: addFlags(c, rec, 0x800000); break;
    case 0x01500000:
      if (read8(c, rec + 149) === 3) write8(c, rec + 147, 0);
      break;
    case 0x10000000: setFrame(c, rec, value); break;
    case 0x11000000: write16(c, rec + 160, value); break;
    case 0x12000000: write16(c, rec + 162, value); break;
    case 0x20000000: write16(c, rec + 166, value); break;
    case 0x22000000: write16(c, rec + 168, value); break;
    case 0x23000000: setVoice(c, rec, value); break;
    case 0x24000000: write8(c, rec + 172, 1); break;
    case 0x28000000: playAtFighter(c, rec, value); break;
    case 0xFFFE0000:
      // from the top: the two count up to 0 on the way out
      write16(c, rec + SCRIPT_AT, 0xFFFF);
      write16(c, rec + SCRIPT_FRAME, 0xFFFF);
      break;
    default:
  }
  return true;
}

// 0x0800290c's picture of a frame, which three characters' aimed moves turn to the way they face
function setFrame(c, rec, value) {
  write16(c, rec + 164, value);
  const character = read8(c, rec + CHARACTER_NOW);
  if (character > 10) return;
  const state = read16(c, rec + STATE), facing = read8(c, rec + FACING);
  const angle = DIRECTIONS + read8(c, 0x03001370) * 10;
  const up = facing === read8(c, angle + 2), down = facing === read8(c, angle + 8);
  const add = by => write16(c, rec + 164, read16(c, rec + 164) + by);
  const offset = (table, base) => read16(c, table + (read16(c, rec + 164) - base) * 2);
  if (character === 0 || character === 9 || character === 10) {
    if (state === 19 || state === 20) {
      if (up) add(8);
      else if (down) add(16);
    } else if (state === 0x115) {
      if (up) add(4);
      else if (down) add(8);
    }
  } else if (character === 1) {
    if (state === 19) {
      if (up) add(21);
      else if (down) add(42);
      write16(c, rec + 160, offset(0x08055800, 172) - 8);
      write16(c, rec + 162, offset(0x0805587E, 172));
    } else if (state === 20) {
      if (up) add(10);
      else if (down) add(20);
      write16(c, rec + 160, offset(0x08055994, 236) - 8);
      write16(c, rec + 162, offset(0x080559D8, 236));
    }
  } else if (character === 2 && state === 21) {
    if (up) add(12);
    else if (down) add(24);
    write16(c, rec + 160, offset(0x080576E8, 184));
  }
}

// 0x0800290c's voice of a move, which some characters choose by how they stand
function setVoice(c, rec, value) {
  const voice = rec + 170;
  write16(c, voice, value);
  if (value === 3) {
    const time = u16(c.vblanks);
    write16(c, rec + 166, read16(c, rec + 166) - 200 + Math.imul(time + 5, time + 1) % 400);
    write16(c, rec + 168, read16(c, rec + 168) - 10 + Math.imul(time + 8, time) % 20);
  }
  const character = read8(c, rec + CHARACTER_NOW);
  if ((character === 0 || character === 9 || character === 10) && read16(c, voice) === 50) {
    const angle = DIRECTIONS + read8(c, 0x03001370) * 10, facing = read8(c, rec + FACING);
    if (facing === read8(c, angle + 2)) write16(c, voice, 51);
    else if (facing === read8(c, angle + 8)) write16(c, voice, 53);
  }
  if (character === 7 || character === 17 || character === 18) {
    const charge = read8(c, rec + 143);
    if (read16(c, voice) === 180 && charge > 2) write16(c, voice, charge <= 5 ? 181 : 182);
    if (read16(c, voice) === 177 && charge > 2) write16(c, voice, charge <= 3 ? 178 : 179);
    if (read8(c, rec + FACING) === 0) {
      const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10, side = read8(c, rec + 16);
      if (side === 0) write8(c, rec + FACING, read8(c, camera + 4));
      else if (side === 1) write8(c, rec + FACING, read8(c, camera + 6));
    }
  }
  if (read8(c, rec + 199) <= 6) write8(c, rec + 199, 7);
}

// 0x0800290c's sound of a move, when the fighter's on the screen or near it
function playAtFighter(c, rec, sound) {
  const x = read16(c, rec + 12);
  if (((x + 48) << 16) >>> 0 > 0x1200000) return;
  const y = reads16(c, rec + 14);
  if (y > read8(c, 0x030017C0) || y < read8(c, 0x030016D0) - 64) return;
  const place = s16(x - 96);
  queueEffect(c, sound, place > 127 ? 127 : (place < -127 ? -127 : place));
}

/**
 * 0x08001b0c: a fighter takes a state, and its script starts next. Partly: the states a fighter dropping in, landing
 * and standing takes. The others do more here, and throw.
 */
function setState(c, i, state) {
  const rec = record(i);
  write16(c, rec + STATE, state);
  write32(c, rec + FLAGS, (read32(c, rec + FLAGS) | FLAG_NEW_STATE) & ~FLAG_CHAIN);
  if (state === 54 && read8(c, rec + 149) === 3) write8(c, rec + 147, 0);
  if (read8(c, rec + 147) <= 71) write8(c, rec + 149, 0);
  else write8(c, rec + 149, read8(c, rec + 149) & 1);
  write8(c, rec + 126, 0);
  write8(c, SETUP + 137 + i, 0);
  if (read8(c, rec + CHARACTER) === 9) {
    write8(c, rec + CHARACTER_NOW, read8(c, 0x030013B0 + (fn0800b098(c, state) & 0xFF) + i * 156));
  }
  if (read8(c, rec + 199) <= 4) write8(c, rec + 199, 5);
  switch (state) {
    case 0:
      write8(c, rec + 138, 0);
      write8(c, rec + 198, 0);
      write8(c, rec + 192, 0);
      break;
    case 8: case 52: case 71:
      clearFlags(c, rec, FLAG_LANDED);
      break;
    case 1: case 2: case 3: case 5: case 6: case 261:
      break;
    default:
      notPorted('08001B0C', `state ${state}`);
  }
}

// ------------------------------------------------------------------------------------------------ Moving a fighter

/** 0x080127d0: how a fighter going from where it was to where it is meets the walls and the edges of the arena. */
function meetWalls(c, x, y, oldX, oldY) {
  const out = { wallX: 0, wallY: 0, edgeX: 0, edgeY: 0, bits: 0 };
  const keepLargest = (field, value) => { if (Math.abs(value) > Math.abs(out[field])) out[field] = s16(value); };
  // where the line crosses a wall's edge, at along on the other axis
  const cross = (startOther, endOther, start, edge, end) => (
    startOther === endOther ? startOther
      : startOther - Math.trunc(Math.imul(start - edge, startOther - endOther) / (start - end)));
  const count = read8(c, WALL_COUNT);
  for (let w = 0; w < count; w = (w + 4) & 0xFF) {
    const left = reads16(c, WALLS + w * 2), right = reads16(c, WALLS + (w + 1) * 2);
    const top = reads16(c, WALLS + (w + 2) * 2), bottom = reads16(c, WALLS + (w + 3) * 2);
    if (left < oldX && right > oldX && top < oldY && bottom > oldY
      && left < x && right > x && top < y && bottom > y) {
      // inside and staying inside
      out.bits = 15;
      out.wallX = 0;
      out.wallY = 0;
      continue;
    }
    if (top >= oldY && top < y) {
      const at = cross(oldX, x, oldY, top, y);
      if (at >= left && at <= right) { out.bits |= 4; keepLargest('wallY', y - top + 16); }
    }
    if (bottom <= oldY && bottom > y) {
      const at = cross(oldX, x, oldY, bottom, y);
      if (at >= left && at <= right) { out.bits |= 8; keepLargest('wallY', y - bottom - 16); }
    }
    if (left >= oldX && left < x) {
      const at = cross(oldY, y, oldX, left, x);
      if (at >= top && at <= bottom) { out.bits |= 1; keepLargest('wallX', x - left + 16); }
    }
    if (right <= oldX && right > x) {
      const at = cross(oldY, y, oldX, right, x);
      if (at >= top && at <= bottom) { out.bits |= 2; keepLargest('wallX', x - right - 16); }
    }
  }
  if (x > reads16(c, LIMIT_RIGHT)) {
    out.edgeX = s16(x - read16(c, LIMIT_RIGHT));
    out.bits |= 16;
  } else if (x < reads16(c, LIMIT_LEFT)) {
    out.edgeX = s16(x - read16(c, LIMIT_LEFT));
    out.bits |= 32;
  }
  if (y > reads16(c, LIMIT_DOWN)) {
    out.edgeY = s16(y - read16(c, LIMIT_DOWN));
    out.bits |= 64;
  } else if (y < reads16(c, LIMIT_UP)) {
    out.edgeY = s16(y - read16(c, LIMIT_UP));
    out.bits |= 128;
  }
  return out;
}

// how much 0x0800597c slows a speed toward zero, as a 16-bit number
function slowed(speed, slow, rawSlow, rawSpeed) {
  if (speed < -slow) return rawSlow;
  return u16(speed > slow ? -rawSlow : -rawSpeed);
}

const FORWARD_X = [0, -11, 0, 11, -16, 0, 16, -11, 0, 11];
const FORWARD_Y = [0, 11, 16, 11, 0, 0, 0, -11, -16, -11];

/** 0x0800597c: a fighter's speeds and place for a frame, pushed by those it stands near, and stopped by walls. */
function moveFighter(c, i) {
  const rec = record(i);
  if (!(read32(c, rec + FLAGS) & FLAG_LOCKED) || read16(c, rec + STATE) === 255) {
    const facing = read8(c, rec + FACING);
    if (facing !== 0) write8(c, rec + LAST_FACING, facing);
    write8(c, rec + FACING, padFacing(c, i));
  }
  // the gauges' numbers catch up with what they count
  const health = read8(c, rec + HEALTH), shownHealth = read16(c, rec + 194);
  if (health < shownHealth) write16(c, rec + 194, shownHealth - (Math.abs(health - shownHealth) > 10 ? 2 : 1));
  else if (health > shownHealth) write16(c, rec + 194, shownHealth + (Math.abs(health - shownHealth) > 10 ? 2 : 1));
  const power = read8(c, rec + 147), shownPower = read8(c, rec + 148);
  if (power < shownPower) write8(c, rec + 148, shownPower - 1);
  else if (power > shownPower) write8(c, rec + 148, shownPower + 1);
  if (read8(c, rec + 147) > 71) {
    write8(c, rec + 147, 72);
    write8(c, rec + 149, read8(c, rec + 149) | 1);
  }
  const pause = read8(c, rec + PAUSE);
  if (pause !== 0) { write8(c, rec + PAUSE, pause - 1); return; }

  const facing = read8(c, rec + FACING), walk = reads16(c, rec + WALK), slow = reads16(c, rec + SLOW);
  const rawSlow = read16(c, rec + SLOW);
  const forwardX = (Math.imul(FORWARD_X[facing], walk) << 12) >>> 16;
  const forwardY = (Math.imul(FORWARD_Y[facing], walk) << 12) >>> 16;
  let slowX = slowed(reads16(c, rec + SPEED_X), slow, rawSlow, read16(c, rec + SPEED_X));
  let slowY = slowed(reads16(c, rec + SPEED_Y), slow, rawSlow, read16(c, rec + SPEED_Y));
  const diagonal = facing === 1 || facing === 3 || facing === 7 || facing === 9;
  if (diagonal) {
    slowX = (Math.imul(s16(slowX), 11) << 12) >>> 16;
    slowY = (Math.imul(s16(slowY), 11) << 12) >>> 16;
  }
  write16(c, rec + SPEED_X, s16(slowX) + read16(c, rec + SPEED_X) + s16(forwardX));
  write16(c, rec + SPEED_Y, s16(slowY) + read16(c, rec + SPEED_Y) + s16(forwardY));
  const top = read16(c, rec + MAX_SPEED);
  write16(c, rec + TOP_SPEED, ((diagonal ? Math.imul(top, 11) >>> 4 : top) + read16(c, rec + TOP_SPEED)) >> 1);
  const limit = read16(c, rec + TOP_SPEED);
  const within = field => {
    const speed = reads16(c, rec + field);
    if (speed > limit) write16(c, rec + field, limit);
    else if (speed < -limit) write16(c, rec + field, -limit);
  };
  within(SPEED_X);
  within(SPEED_Y);
  if (reads16(c, rec + Z) > reads16(c, rec + GROUND)) {
    const fall = s16(read16(c, rec + SPEED_Z) - read16(c, rec + FALL));
    write16(c, rec + SPEED_Z, fall);
    if (fall > 256) write16(c, rec + SPEED_Z, 256);
    else if (fall < -256) write16(c, rec + SPEED_Z, -256);
  }
  if (read16(c, rec + STATE) !== 254) {
    const x = read16(c, rec + X), y = read16(c, rec + Y), z = read16(c, rec + Z);
    write16(c, rec + OLD_X, x);
    write16(c, rec + OLD_Y, y);
    write16(c, rec + OLD_Z, z);
    write16(c, rec + X, x + (reads16(c, rec + SPEED_X) >> 4));
    write16(c, rec + Y, y + (reads16(c, rec + SPEED_Y) >> 4));
    write16(c, rec + Z, z + (reads16(c, rec + SPEED_Z) >> 4));
  }
  const height = reads16(c, rec + Z), ground = reads16(c, rec + GROUND);
  if (height < ground) write16(c, rec + Z, ground);
  else if (height > 196) write16(c, rec + Z, 196);

  for (let j = 0; j < 4; j++) {
    if (j === i || !isActive(c, j)) continue;
    pushApart(c, i, j);
  }

  const character = read8(c, rec + CHARACTER_NOW), state = read16(c, rec + STATE);
  if ((character === 2 && state === 278) || (character === 3 && state === 0x115)) {
    write16(c, rec + Z, read16(c, rec + GROUND));
  } else if (character === 20 && state === 22) {
    notPorted('0800597C', 'the character 20 state 22');
  }
  const met = meetWalls(c, reads16(c, rec + X), reads16(c, rec + Y), reads16(c, rec + OLD_X), reads16(c, rec + OLD_Y));
  write8(c, rec + BUMPED, met.bits);
  if (met.bits & 15) {
    if (reads16(c, rec + Z) >= reads16(c, FLOOR)) { met.wallX = 0; met.wallY = 0; }
    if (met.wallX === 0 && met.wallY === 0) {
      write8(c, rec + BUMPED, read8(c, rec + BUMPED) & 0xF0);
      const floor = read16(c, FLOOR);
      write16(c, rec + GROUND, floor);
      if (reads16(c, rec + Z) < s16(floor)) write16(c, rec + Z, floor);
    } else if (read16(c, rec + STATE) === 255) {
      write8(c, rec + BUMPED, read8(c, rec + BUMPED) & 0xF0);
      write16(c, rec + GROUND, read16(c, FLOOR));
    } else write16(c, rec + GROUND, 0);
  } else write16(c, rec + GROUND, 0);
  if (read16(c, rec + STATE) === 255) {
    write16(c, rec + Z, i === read32(c, PLAYER) ? read16(c, rec + GROUND) : 80);
  }
  if ((character === 2 && state === 278) || (character === 3 && state === 0x115)) {
    if (read8(c, rec + BUMPED) & 15) write16(c, rec + GROUND, read16(c, FLOOR));
    write8(c, rec + BUMPED, read8(c, rec + BUMPED) & 0xF0);
  }
  const bumped = read8(c, rec + BUMPED);
  if (bumped & 15) {
    write16(c, rec + X, read16(c, rec + X) - u16(met.wallX));
    write16(c, rec + Y, read16(c, rec + Y) - u16(met.wallY));
  }
  if (bumped & 0xF0) {
    write16(c, rec + X, read16(c, rec + X) - u16(met.edgeX));
    write16(c, rec + Y, read16(c, rec + Y) - u16(met.edgeY));
  }
  if (read8(c, rec + 236) !== 0) notPorted('0800F5BC', 'a fighter that leaves its things behind');
}

// the middle of 0x0800597c: how far another fighter is, and how a solid one pushes this one
function pushApart(c, i, j) {
  const rec = record(i), other = record(j);
  const x = reads16(c, rec + X), y = reads16(c, rec + Y), near = 169 << 10;
  const dx = s16(read16(c, rec + X) - read16(c, other + X)), dy = s16(read16(c, rec + Y) - read16(c, other + Y));
  write16(c, rec + 54 + j * 2, dx);
  write16(c, rec + 62 + j * 2, dy);
  write32(c, rec + 72 + j * 4, Math.imul(dx, dx) + Math.imul(dy, dy));
  const dz = s16(read16(c, other + Z) - read16(c, rec + Z));
  write16(c, rec + 88 + j * 2, dz);
  if (!(read32(c, other + FLAGS) & FLAG_GROUNDED)) return;
  if (Math.abs(dz) >= read8(c, rec + 186)) return;
  const otherState = read16(c, other + STATE);
  if (otherState >= 252 && otherState <= 255) return;
  const character = read8(c, rec + CHARACTER_NOW), state = read16(c, rec + STATE);
  if ((character === 2 && state === 278) || (character === 3 && state === 0x115)) return;
  const distance = reads32(c, rec + 72 + j * 4);
  if (distance >= near) return;
  const push = ((near - distance) >> 16) << (read32(c, rec + FLAGS) & 1 ? 7 : 5);
  if (Math.abs(dx) < Math.abs(dy)) {
    write16(c, rec + SPEED_X, read16(c, rec + SPEED_X) + (x > reads16(c, other + X) ? push : -push));
  } else {
    write16(c, rec + SPEED_Y, read16(c, rec + SPEED_Y) + (y > reads16(c, other + Y) ? push : -push));
  }
}

// ------------------------------------------------------------------------------------- Hits, keys and state changes

/** 0x080036dc and 0x080040fa: what hit a fighter, and the gauges after. Partly: nothing hits it in the opening. */
function takeHits(c, i) {
  const rec = record(i), state = read16(c, rec + STATE);
  if (state >= 252 && state <= 255) return;
  if (read8(c, rec + PAUSE) !== 0 && read8(c, rec + PAUSE_NEXT) !== 0) return;
  const bit = 0x2000 << i;
  for (let j = 0; j < 4; j++) {
    if (j === i || !isActive(c, j)) continue;
    if (read32(c, record(j) + ATTACKS) & bit) notPorted('080036DC', 'being hit');
    const thrown = read16(c, record(j) + 174);
    if (thrown === 0) clearFlags(c, rec, 0x40000);
    else if (((thrown & 0x1800) >> 11) === i) notPorted('080036DC', 'being hit by a thing');
  }
  if (read8(c, rec + PAUSE) !== 0) return;
  if (read32(c, rec + FLAGS) & 0x3FFF8) notPorted('080040FA', 'being knocked back');
  const taken = read16(c, rec + 240), damage = SETUP + 98 + i * 2;
  write16(c, damage, read16(c, damage) + taken);
  const health = read8(c, rec + HEALTH);
  if (taken > health) {
    write16(c, rec + 240, health);
    write8(c, rec + HEALTH, 0);
  } else write8(c, rec + HEALTH, health - taken);
  const most = read16(c, 0x03001B28);
  if (read8(c, rec + HEALTH) > most) write8(c, rec + HEALTH, most);
  const power = (read8(c, rec + 242) + read8(c, rec + 147)) & 0xFF;
  write8(c, rec + 147, power > 72 ? 72 : power);
  write16(c, rec + 240, 0);
  write16(c, rec + 242, 0);
  const shield = read8(c, rec + 151);
  if (shield !== 0) write8(c, rec + 151, shield - 1);
}

/** 0x080066d8: a hit that took a fighter's frame stays one frame more, and every other mark of an attack goes. */
function holdHits(c) {
  for (let i = 0; i < 4; i++) {
    const rec = record(i);
    if ((read32(c, rec + ATTACKS) & 0x1F00) === 0x900 && !(read32(c, rec + FLAGS) & 0x1000000)) {
      addFlags(c, rec, 0x1000000);
    } else {
      write32(c, rec + ATTACKS, 0);
      clearFlags(c, rec, 0x1000000);
    }
  }
}

/** 0x08006134: a fighter's attack reaches the others. Partly: nobody attacks in the opening. */
function reachOthers(c, i) {
  const rec = record(i);
  if (read32(c, rec + FLAGS) & 0x40000) return;
  const state = read16(c, rec + STATE);
  if (state === 0x145 || state === 54) return;
  if ((read32(c, rec + ATTACKS) & 0x1F00) === 0x900) return;
  write32(c, rec + ATTACKS, 0);
  if (read8(c, rec + 106) & 2) notPorted('08006134', 'an attack aimed by the pad');
  if (read16(c, rec + 104) !== 0) notPorted('08006134', 'an attack');
}

/** 0x08005310: the moves a fighter's keys ask for, and its short timers. Partly: nothing is pressed in the opening. */
function readFighterKeys(c, i) {
  const rec = record(i), asks = read8(c, rec + 138), state = read16(c, rec + STATE);
  if (!(asks & 0xF8) && state !== 4 && (pressed(c, i) & 0x1F2)) notPorted('08005310', 'a key pressed');
  const character = read8(c, rec + CHARACTER_NOW);
  if (state === 13 || (state === 15 && (character === 2 || character === 5))
    || (state === 21 && (character === 2 || character === 4))) {
    notPorted('08005310', `state ${state}`);
  }
  clearFlags(c, rec, 0x800000 | 0x4000000 | 0x2000000);
  if (state === 66) notPorted('08005310', 'state 66');
  for (const timer of [109, 110, 112]) {
    const left = read8(c, rec + timer);
    if (left !== 0) write8(c, rec + timer, left - 1);
  }
  if (state === 55) notPorted('08005310', 'state 55');
  if (read8(c, rec + 145) !== 0 || read8(c, rec + 146) !== 0) notPorted('08005310', 'a poison timer');
}

// what 0x0800486c leaves alone in the air, instead of letting a fighter fall
const KEEPS_ITS_STATE_IN_THE_AIR = new Set([
  4, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 52, 54, 66, 67, 68, 69, 70, 71, 80, 81, 82, 83, 84,
  85, 96, 252, 253, 254, 255, 0x111, 0x113, 0x114, 0x115, 0x116, 0x117, 0x118, 0x135, 0x143, 0x145, 0x147, 0x150,
  0x213, 0x214, 0x215, 0x216, 0x217, 0x218,
]);
const STANDS = new Set([0, 1, 2, 3, 5, 10, 11, 12, 13, 14, 52, 0x105, 0x135]);
const PAD = 0xF0;

/** 0x0800486c: a fighter's next state, by where it stands and its keys. Partly: with nothing pressed, and no hits. */
function fighterAct(c, i) {
  const rec = record(i);
  for (let j = 0; j < 4; j++) {
    if (j !== i && isActive(c, j) && (read8(c, record(j) + 127) & 15) === i) notPorted('0800486C', 'a hit landed');
  }
  if (read8(c, rec + 157) !== 0 || read8(c, rec + 156) !== 0) notPorted('0800486C', 'a super attack');
  landOrFall(c, i);
  if (read8(c, rec + PAUSE) !== 0) return;
  let flags = read32(c, rec + FLAGS);
  if ((flags & 0x800000) && (flags & 0x2000000) && (flags & 0x4000000)) notPorted('0800486C', 'a charged attack');
  if (read16(c, rec + STATE) === 16) notPorted('0800486C', 'state 16');
  if ((flags & 0x80000) && reads16(c, rec + SCRIPT_FRAME) > 6) notPorted('0800486C', 'a charge let go');
  const keys = pressed(c, i);
  if (read16(c, rec + STATE) === 4 && (keys & 2)) notPorted('0800486C', 'a charge held');
  if (flags & FLAG_GROUNDED) {
    if (keys & PAD) notPorted('0800486C', 'a dash');
    let state = read16(c, rec + STATE);
    if (!STANDS.has(state)) return;
    if (keys & 1) notPorted('0800486C', 'a jump');
    if (keys & 0x200) notPorted('0800486C', 'a guard');
    if (read8(c, rec + 17) !== read8(c, rec + 18)) {
      if (state === 2 || state === 3 || state === 5) setState(c, i, 5);
      else if (state === 0 || state === 0x105 || state === 1) setState(c, i, 0x105);
    } else if (state === 0 && (held(c, i) & PAD)) {
      setState(c, i, 1);
    } else if (!(held(c, i) & PAD)) {
      state = read16(c, rec + STATE);
      if (state === 2 || (state === 1 && reads16(c, rec + SCRIPT_AT) > 11)) setState(c, i, 3);
      else if (state === 1) setState(c, i, 0);
    }
    flags = read32(c, rec + FLAGS);
    if (flags & FLAG_CHAIN) notPorted('0800486C', 'an attack chained');
    if (flags & FLAG_LOCKED) return;
    if (read8(c, rec + 138) & 0xF9) notPorted('0800486C', 'an attack asked for');
    return;
  }
  if (!(flags & FLAG_IN_AIR)) return;
  const state = read16(c, rec + STATE);
  if (state === 6 || state === 7 || state === 9) {
    if (flags & FLAG_LOCKED) return;
    if (keys & 0x103) notPorted('0800486C', 'a key pressed in the air');
    return;
  }
  if (!KEEPS_ITS_STATE_IN_THE_AIR.has(state)) setState(c, i, 6);
}

/** 0x0800444c: a fighter touching the ground or leaving it. Partly: not a bounce off a wall, nor falling out of a fight. */
function landOrFall(c, i) {
  const rec = record(i);
  if (read8(c, rec + PAUSE) !== 0) return;
  const state = read16(c, rec + STATE);
  if (read8(c, rec + BUMPED) !== 0 && (state === 66 || state === 81)) notPorted('0800444C', 'a bounce off a wall');
  const inAir = () => {
    write32(c, rec + FLAGS, (read32(c, rec + FLAGS) & ~(FLAG_GROUNDED | FLAG_LANDED)) | FLAG_IN_AIR);
    write8(c, rec + 244, 0);
  };
  if (reads16(c, rec + Z) === reads16(c, rec + GROUND)) {
    const flying = state === 7 || state === 66 || state === 67 || state === 0x143 || reads16(c, rec + SPEED_Z) > 0;
    if (!flying || state === 6) {
      write8(c, rec + 184, 2);
      const flags = read32(c, rec + FLAGS);
      if (flags & FLAG_GROUNDED) write32(c, rec + FLAGS, flags & ~FLAG_LANDED);
      else {
        write32(c, rec + FLAGS, flags | FLAG_LANDED | FLAG_GROUNDED);
        write16(c, rec + SPEED_Z, 0);
      }
      clearFlags(c, rec, FLAG_IN_AIR);
    } else inAir();
    if (reads16(c, rec + Z) === reads16(c, rec + OLD_Z)) {
      const still = (read8(c, rec + 244) + 1) & 0xFF;
      write8(c, rec + 244, still);
      if (still > 8) write16(c, rec + SPEED_Z, 0);
    } else write8(c, rec + 244, 0);
  } else inAir();
  // Training's fighters never lose health
  if (read8(c, SETUP + 125) === 4) for (let j = 0; j < 4; j++) write8(c, record(j) + HEALTH, 100);
  if (read8(c, rec + HEALTH) === 0) notPorted('0800444C', 'a fighter out of health');
  const flags = read32(c, rec + FLAGS), now = read16(c, rec + STATE);
  if (flags & FLAG_LANDED) {
    if (now === 0x145) { setState(c, i, 70); return; }
    if (now === 70 || now === 0x147 || now === 84 || now === 68) { setState(c, i, 71); return; }
    if (now === 6) { setState(c, i, 8); return; }
    if (now === 71) { setState(c, i, 52); return; }
    const character = read8(c, rec + CHARACTER_NOW);
    if ((character === 0 || character === 10 || character === 20 || character === 2) && now === 22) {
      setState(c, i, 278);
      return;
    }
    if (character === 2 && now === 278) return;
    if (character === 3 && now === 0x115) return;
    if (character === 8 && now === 24) { setState(c, i, 280); return; }
    if (now === 0x147 || now === 52) return;
    if ((character === 7 || character === 17 || character === 18) && u16(now - 0x215) <= 1) return;
    setState(c, i, 8);
  } else if (flags & FLAG_GROUNDED) {
    if (now === 0x145) setState(c, i, 70);
    else if (now === 6) setState(c, i, 8);
  }
}

// --------------------------------------------------------------------------------------------- The things of a fight

/** 0x0800c728: the things of a fight for a frame, and the screen's shake. Partly: only things waiting to appear. */
function updateThings(c) {
  for (let i = 0; i < 4; i++) write16(c, record(i) + 174, 0);
  for (let k = 0; k < 12; k++) {
    const thing = 0x030017D0 + k * 68;
    if (read16(c, thing + 56) === 0) continue;
    const wait = read8(c, thing + 54);
    if (wait === 0) notPorted('0800CEC8', `a thing of kind ${read16(c, thing + 56)}`);
    write8(c, thing + 54, wait - 1);
  }
  const shake = read8(c, 0x030016CC);
  if (shake === 0) {
    write16(c, 0x030016BC, 0);
    write8(c, 0x03001C30, 0);
    write8(c, 0x030016CC, 0);
    return;
  }
  const up = read8(c, 0x03001C30) === 0;
  write16(c, 0x030016BC, ((up ? shake : -shake) * 3) << 7);
  write8(c, 0x03001C30, up ? 1 : 0);
  write8(c, 0x030016CC, shake - 1);
}

// --------------------------------------------------------------------------------------------------------- The view

/** 0x0801a04c: the view follows a fighter from its camera's side. */
function followFighter(c, i) {
  fn0800673c(c, i & 0xFF);
  if (i <= 3) {
    const VIEW = 0x03002040, camera = read8(c, record(i) + CAMERA);
    const screenX = read16(c, 0x08071222 + camera * 2) + read16(c, 0x03001374);
    write16(c, VIEW + 8, screenX);
    const screenY = read16(c, 0x0807122A + camera * 2) + read16(c, 0x03001B24);
    write16(c, VIEW + 10, screenY);
    const free = !(read16(c, 0x03001398 + i * 2) & 0x200);
    const back = read16(c, 0x03002100) << 4, shift = read8(c, 0x03001B00), turn = read16(c, VIEW + 12);
    const angle = reads => read16(c, 0x0807121A + reads);
    if (camera === 0) {
      if (free) fn08018318(c, reads16(c, VIEW + 8), s16(screenY - back));
      fn080176e4(c, s16(angle(0) + asrBy(-reads16(c, VIEW + 8), shift) + turn));
    } else if (camera === 1) {
      if (free) fn08018318(c, reads16(c, VIEW + 8), s16(screenY + back));
      fn080176e4(c, s16(angle(2) + asrBy(reads16(c, VIEW + 8), shift) + turn));
    } else if (camera === 2) {
      if (free) fn08018318(c, s16(screenX - back), reads16(c, VIEW + 10));
      fn080176e4(c, s16(angle(4) + asrBy(reads16(c, VIEW + 10), shift) + turn));
    } else if (camera === 3) {
      if (free) fn08018318(c, s16(screenX + back), reads16(c, VIEW + 10));
      fn080176e4(c, s16(angle(6) + asrBy(-reads16(c, VIEW + 10), shift) + turn));
    }
  }
  fn08018300(c, s16(0x200 + read16(c, 0x03002100)));
  fn080182e4(c, 0x200);
}

// -------------------------------------------------------------------------------------------------------- The frames

/**
 * 0x0801c28c, Training mode's callback, up to its 0x080006d0: the dummy's keys, the camera's turn, and every fighter.
 * That function waits for the V-blank there (0x0804a5d0, the BIOS's), so the logic of a fight runs every second
 * frame: what comes after the wait is this callback's other half, trainingAfterWait, the next frame.
 */
function trainingFrame(c) {
  dummyKeys(c);
  const player = read32(c, PLAYER);
  readAllKeys(c, player);
  const state = read16(c, record(player) + STATE);
  if (state === 55) {
    const keys = held(c, player);
    if (keys & 32) write16(c, CAMERA_TURN, read16(c, CAMERA_TURN) - 128);
    else if (keys & 16) write16(c, CAMERA_TURN, read16(c, CAMERA_TURN) + 128);
    else write16(c, CAMERA_TURN, 0);
  } else if (state === 53) {
    if (pressed(c, player) & 0x200) notPorted('0801C28C', 'turning the camera');
  } else write16(c, CAMERA_TURN, 0);
  fn08006e64(c);
  updateThings(c);
  for (let i = 0; i < 4; i++) {
    if (!isActive(c, i)) continue;
    fighterThink(c, i);
    moveFighter(c, i);
    takeHits(c, i);
  }
  holdHits(c);
  for (let i = 0; i < 4; i++) {
    if (!isActive(c, i)) continue;
    reachOthers(c, i);
    readFighterKeys(c, i);
    fighterAct(c, i);
  }
  trainingAfterWait(c);
  c.afterWait = true;   // 0x080006d0: a frame of the fight takes two of the console's
}

// 0x0801c28c after its wait: pausing, the fade, the view, and everything drawn
function trainingAfterWait(c) {
  const player = read32(c, PLAYER);
  if ((pressed(c, player) & 8) && read8(c, record(player) + HEALTH) !== 0) notPorted('0801BD90', 'pausing');
  if (stepFade(c)) endFade(c);
  followFighter(c, player);
  fn080182ac(c);
  fn08016684(c);
  fn08017ed0(c);
  fn08013214(c, 0);
  fn08017f6c(c);
  fn08006ff4(c, 4);
  fn0800f9c0(c);
  fn08011c7c(c);
  fn080175d4(c);
  fn08017d58(c);
  fn08017c5c(c);
}

/** Not ported: 0x0801ad38, a fight other than Training after the choice of special attacks. */
function afterChoice() {
  notPorted('0801AD38', 'a fight other than Training');
}

/** Not ported: 0x0801b394, a fight other than Training. */
function fightFrame() {
  notPorted('0801B394', 'a fight other than Training');
}

export {
  afterChoice, fightFrame, trainingFrame, forgetKeys, readAllKeys, readNextKeys, dummyKeys, padFacing, fighterThink,
  runScript, setState, meetWalls, moveFighter, takeHits, holdHits, reachOthers, readFighterKeys, fighterAct, landOrFall,
  updateThings, followFighter, queueEffect, stepFade, endFade, nextRandom,
};
export { afterChoice as fn0801ad38 };
export { fightFrame as fn0801b394 };
export { trainingFrame as fn0801c28c };
export { forgetKeys as fn08017964 };
export { readAllKeys as fn080177b8 };
export { readNextKeys as fn080178d0 };
export { dummyKeys as fn0801c090 };
export { padFacing as fn080034f0 };
export { fighterThink as fn08007ec8 };
export { runScript as fn0800290c };
export { setState as fn08001b0c };
export { meetWalls as fn080127d0 };
export { moveFighter as fn0800597c };
export { takeHits as fn080036dc };
export { holdHits as fn080066d8 };
export { reachOthers as fn08006134 };
export { readFighterKeys as fn08005310 };
export { fighterAct as fn0800486c };
export { landOrFall as fn0800444c };
export { updateThings as fn0800c728 };
export { followFighter as fn0801a04c };
export { queueEffect as fn0801fcd8 };
export { stepFade as fn080205d0 };
export { endFade as fn08020944 };
export { nextRandom as fn08020144 };
