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
import { clearEffect, fn0800673c, fn08006e64, fn08006ff4, fn0800b098, fn0800c1c8 } from './fighters.js';
import { fn0800f9c0, fn08011c7c } from './arena.js';

const FIGHTERS = 0x03001C40, RECORD = 252;
const SETUP = 0x03001620;                    // gUnknown_03001620: what the fight is
const SLOTS = 0x03001634;                    // who stands in each of the four places, 255 for nobody
const CHOICES = 0x030013B0, CHOICE_SIZE = 156;   // each player's skill for each of Emerl's states
const PLAYER = 0x03001380;                   // the place the person plays
const KEYS = 0x03001B30, KEYS_PER_FIGHTER = 64, KEYS_PRESSED = 20, KEYS_RELEASED = 40, KEYS_NOW = 60;
const SCRIPTS = 0x08ED68A8, SCRIPTS_PER_CHARACTER = 280;
const DIRECTIONS = 0x0806B2D4;               // ten bytes per camera angle: the way each direction of the pad faces
const CAMERA_TURN = 0x0300204C;
const RANDOM = 0x0300019C;
const VIEW_FACING = 0x03001370;   // which way the camera faces, 0 to 3
const LIMIT_RIGHT = 0x03002B74, LIMIT_LEFT = 0x03002BD0, LIMIT_DOWN = 0x03002B80, LIMIT_UP = 0x03002B70;
const WALL_COUNT = 0x03002B84, WALLS = 0x03002B90, FLOOR = 0x03001384;

// a record's fields, by what the code does with them
const X = 0, Y = 2, Z = 4, OLD_X = 6, OLD_Y = 8, OLD_Z = 10, ANIMATION = 22, SCRIPT_AT = 24, SCRIPT_FRAME = 26,
  PAUSE = 28, PAUSE_NEXT = 29, PAUSE_DONE = 30, STATE = 20, CHARACTER_NOW = 23, WALK = 32, SLOW = 34, FACING = 36,
  LAST_FACING = 37, FALL = 38, TOP_SPEED = 40, MAX_SPEED = 42, SPEED_X = 44, SPEED_Y = 46, SPEED_Z = 48, BUMPED = 50,
  GROUND = 52, ATTACKS = 116, FLAGS = 180, CAMERA = 159, CHARACTER = 196, HEALTH = 191, KEYS_FOR_NEXT = 200;
const FLAG_GROUNDED = 0x1, FLAG_LANDED = 0x2, FLAG_IN_AIR = 0x4, FLAG_LOCKED = 0x100000, FLAG_NEW_STATE = 0x200000,
  FLAG_CHAIN = 0x400000;

// the sound effects asked for, and how many; each song's record in gSongTable, with its player at the fifth byte
const EFFECT_COUNT = 0x03004470, EFFECTS = 0x03004480, SONG_TABLE = 0x08BF7244, HALF_VOLUME_SOUND = 0x333;

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
  const count = read8(c, EFFECT_COUNT);
  if (count > 31) return 0;
  write16(c, EFFECTS + count * 4, sound);
  write16(c, EFFECTS + count * 4 + 2, place);
  write8(c, EFFECT_COUNT, count + 1);
  return 1;
}

/**
 * 0x0801fc60, in the interrupt at the display's line 1 (0x080185cc, 0x08018654): the sound effects asked for start, each
 * through 0x0801f618, with its player straight at the start (0x0801f644) and panned to its place (0x0801f66c).
 */
function playQueuedEffects(c) {
  const count = read8(c, EFFECT_COUNT);
  for (let n = 0; n < count; n++) {
    const sound = read16(c, EFFECTS + n * 4), place = (read16(c, EFFECTS + n * 4 + 2) << 24) >> 24;
    const player = read16(c, SONG_TABLE + sound * 8 + 4);
    c.sound?.play(sound);
    c.sound?.call('immInit', player);
    c.sound?.call('panpotControl', player, 0xFFFF, place);
    // 0x0801f6a0: this one sound at half its volume
    if (sound === HALF_VOLUME_SOUND) c.sound?.volume(player, 0xFFFF, 0x80);
  }
  write8(c, EFFECT_COUNT, 0);
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

/**
 * 0x080180f0: whether any of `mask` was pressed in `count` of a fighter's last ten frames of keys, starting `back`
 * frames before this one.
 */
function pressedBefore(c, i, back, count, mask) {
  const at = KEYS + i * KEYS_PER_FIGHTER;
  let place = read8(c, at + KEYS_NOW) - Math.min(back, 9);
  if (place < 0) place += 10;
  for (let n = 0; n < count; n++) {
    if (read16(c, at + KEYS_PRESSED + place * 2) & mask) return true;
    // a place past the ninth reads on into the released keys, as the original's does
    place = place > 9 ? 0 : place + 1;
  }
  return false;
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

/** 0x08007ec8: a new state starts its script from the top, and the state's script runs a frame. */
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
  const slot = SCRIPT_OF.get(read16(c, rec + STATE));
  if (slot === undefined) return;
  // 0x0800964C: Emerl runs the script and animation of the character its skill slot has, and the frame ends there
  const chosen = character === 9 ? read8(c, CHOICES + i * CHOICE_SIZE + slot) : character;
  runScript(c, read32(c, SCRIPTS + chosen * SCRIPTS_PER_CHARACTER + slot * 4), i);
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

/** The way each character guards, as the cartridge's two 11-byte tables at 0x0806B3FC and 0x0806B407 give it. */
const guardFrames = (c, character, table) => read8(c, table + (character & 0xFF));

/** The way an attack's kind knocks its victim about: the flag that picks the hit state (0x080036dc's own switch). */
const KIND_REACTION = [0, 0x8, 0x10, 0x20, 0x40, 0, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000];

/**
 * 0x08001b0c: a fighter takes a state, and its script starts next. The states of its attacks, its guard and the hits it
 * takes set what their own scripts start from here.
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
  // the direction a guard or an aimed attack turns to, from the way the character looks
  const faceCamera = () => {
    if (read8(c, rec + 36) !== 0) return;
    const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10;
    write8(c, rec + 36, read8(c, camera + (read8(c, rec + 16) === 0 ? 4 : 6)));
  };
  switch (state) {
    case 0:
      write8(c, rec + 138, 0);
      write8(c, rec + 198, 0);
      write8(c, rec + 192, 0);
      break;
    case 8: case 52: case 71:
      clearFlags(c, rec, FLAG_LANDED);
      break;
    case 9:
      if (read8(c, rec + CHARACTER_NOW) !== 3 && read8(c, rec + CHARACTER_NOW) !== 10) write8(c, rec + 184, 1);
      break;
    case 53:
      // the guard starts slowly, and turns to the way its character looks
      write8(c, rec + 188, 99);
      write8(c, rec + 189, 99);
      write8(c, rec + 190, 0);
      faceCamera();
      break;
    case 55:
      // the guard itself: two rates, one for health and one for the power gauge, and it lets go when L does
      write8(c, rec + 188, guardFrames(c, read8(c, rec + CHARACTER_NOW), 0x0806B3FC));
      write8(c, rec + 189, guardFrames(c, read8(c, rec + CHARACTER_NOW), 0x0806B407));
      if ((held(c, i) & 0x200) === 0) setState(c, i, 56);
      write8(c, rec + 36, 0);
      break;
    case 54: case 65: case 66: case 67: case 68: case 69: case 80: case 81: case 82: case 83: case 84: case 85: case 0x145:
      // a hit's state keeps itself for what comes after it, and the frame it was hit on
      write16(c, rec + 238, state);
      write8(c, rec + 184, 1);
      break;
    case 70:
      write8(c, rec + 30, 1);
      write8(c, rec + 28, 5);
      break;
    case 0x135:
      // a blocked hit: the guard's own marks of what it hit go
      write8(c, rec + 126, 0);
      write8(c, rec + 125, 255);
      write32(c, rec + ATTACKS, 0);
      break;
    case 565:
      // the guard's end: with L still held, it turns to healing (0x137, then 55)
      if (held(c, i) & 0x200) setState(c, i, 0x137);
      break;
    default:
      if (state >= 10 && state <= 24 && state !== 16) {
        // an attack: the hits it has already made go, and it turns to face where the camera has it
        if (state >= 19) {
          write8(c, rec + 149, read8(c, rec + 149) | 2);
          write8(c, rec + 138, 0);
          write8(c, rec + 184, 0);
        }
        if (read32(c, rec + FLAGS) & FLAG_NEW_STATE) {
          write8(c, rec + 126, 0);
          write8(c, rec + 125, 255);
          clearFlags(c, rec, FLAG_CHAIN);
        }
        faceCamera();
      } else {
        // the states with nothing of their own here
      }
  }
  // (0x08002762) what the special attacks' states do with their things
  if (state === 21) {
    if (read8(c, rec + 23) !== 0) return;
    for (let k = 0; k < 12; k++) {
      const thing = 0x030017D0 + k * 68;
      if (read8(c, thing + 53) === i && read16(c, thing + 56) === 35) notPorted('08002780', 'a fighter that flies to its ring');
    }
  } else if (state === 22) {
    if (read8(c, rec + 23) === 8) write16(c, rec + SPEED_Z, 256 - (read16(c, rec + Z) - read16(c, rec + 52)));
  } else if (state === 23 || state === 24) {
    leaveThings(c, i);
    write8(c, rec + 236, 0);
  }
}

// 0x0800f5bc: a fighter's things that wait for it go off, each turned into its blast at its place
const THING_BLASTS = [[40, 41], [45, 41], [60, 62], [61, 62], [80, 82], [81, 82], [100, 102], [101, 102], [120, 122],
  [121, 122], [140, 142], [141, 142], [161, 165], [162, 165], [163, 166], [164, 166], [200, 201]];
const BLAST_OF = new Map(THING_BLASTS);
function leaveThings(c, i) {
  for (let k = 0; k < 12; k++) {
    const thing = 0x030017D0 + k * 68;
    if (read8(c, thing + 53) !== i) continue;
    const blast = BLAST_OF.get(read16(c, thing + 56));
    if (blast === undefined) continue;
    const facing = read8(c, thing + 64), x = read16(c, thing + 58), y = read16(c, thing + 60), z = read16(c, thing + 62);
    const full = read8(c, thing + 65);
    clearEffect(c, k);
    // the Sets' blasts sit one lower than the thing they came from, as 0x0800f5bc leaves them
    fn0800c1c8(c, blast, facing, x, y, blast === 122 ? s16(z - 1) : z, 0, 0, 0, 0, i, full);
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

/**
 * 0x080125dc: where a point meets a wall or an edge of the arena. Each wall it is inside pushes it out the shortest
 * way, and the edges of the arena push it back in; the bits say which sides it met.
 */
function meetThingWalls(c, x, y) {
  const out = { wallX: 0, wallY: 0, edgeX: 0, edgeY: 0, bits: 0 };
  const count = read8(c, WALL_COUNT);
  for (let w = 0; w < count; w += 4) {
    const left = reads16(c, WALLS + w * 2), right = reads16(c, WALLS + (w + 1) * 2);
    const top = reads16(c, WALLS + (w + 2) * 2), bottom = reads16(c, WALLS + (w + 3) * 2);
    if (!(left < x && x < right && top < y && y < bottom)) continue;
    const dx = [x - left, x - right], dy = [y - top, y - bottom];
    const across = Math.abs(dx[0]) < Math.abs(dx[1]) ? 0 : 1;
    const down = Math.abs(dy[0]) < Math.abs(dy[1]) ? 0 : 1;
    out.bits |= 1 << across;
    out.bits |= 1 << (down + 2);
    if (Math.abs(dx[across]) < Math.abs(dy[down])) out.wallX = dx[across];
    else out.wallY = dy[down];
  }
  if (x > reads16(c, LIMIT_RIGHT)) { out.edgeX = s16(x - read16(c, LIMIT_RIGHT)); out.bits |= 16; }
  else if (x < reads16(c, LIMIT_LEFT)) { out.edgeX = s16(x - read16(c, LIMIT_LEFT)); out.bits |= 32; }
  if (y > reads16(c, LIMIT_DOWN)) { out.edgeY = s16(y - read16(c, LIMIT_DOWN)); out.bits |= 64; }
  else if (y < reads16(c, LIMIT_UP)) { out.edgeY = s16(y - read16(c, LIMIT_UP)); out.bits |= 128; }
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
  // a fighter whose mine has felt someone sets its things off (0x08006106)
  if (read8(c, rec + 236) !== 0) leaveThings(c, i);
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

// the flags a hit's kind leaves on its victim, and the state each picks when the hit settles (0x080040fa)
// the kinds of hit that turn the victim the way it's thrown (0x0800399a); a blocked hit's kick back (9) doesn't
const THROWN_KINDS = new Set([1, 2, 3, 4, 6, 8, 10, 11, 12, 13, 14, 15]);
const REACTION_FLAGS = 0x800 | 0x80 | 0x20 | 0x40 | 0x10 | 0x8 | 0x200 | 0x100 | 0x400 | 0x1000 | 0x2000 | 0x4000 | 0x8000
  | 0x10000 | 0x20000;

/**
 * 0x080036dc, from its hit loop to 0x080040fa: the attacks that reached a fighter this frame. An attack's flags say how
 * hard it hit: its kind picks the reaction, its high bits the way the victim is thrown, and its low byte the damage.
 */
function takeHits(c, i) {
  const rec = record(i), state = read16(c, rec + STATE);
  if ((state >= 252 && state <= 253) || state === 254 || state === 255) return;
  if (read8(c, rec + PAUSE) !== 0 && read8(c, rec + PAUSE_NEXT) !== 0) { settleHits(c, i); return; }
  const bit = 0x2000 << i;
  for (let j = 0; j < 4; j++) {
    if (j === i || !isActive(c, j)) continue;
    const attacker = record(j), attacks = read32(c, attacker + ATTACKS);
    if (!(attacks & bit)) continue;
    const kind = (attacks >> 8) & 0x1F, guard = read8(c, rec + 141) & 0x30;
    // a fighter guarding, still shielded, or guarding the right way against this kind, blocks it
    const now = read16(c, rec + STATE);
    if (now === 53 || now === 0x135 || read8(c, rec + 151) !== 0
      || ((kind === 10 || kind === 11 || kind === 12) && guard === 0x20)
      || ((kind === 13 || kind === 14) && guard === 0x10) || (kind === 15 && guard === 0x30)) {
      guardHit(c, i, j);
      break;
    }
    clearFlags(c, rec, 0x40000);
    if (KIND_REACTION[kind] !== 0) addFlags(c, rec, KIND_REACTION[kind]);
    // the way the attacker's flags threw it: the four directions its record can face, for the kinds that throw
    const way = (attacks >>> (24 + i * 2)) & 15;
    if (THROWN_KINDS.has(kind) && way <= 3) {
      const facing = way === 0 ? 8 : way === 1 ? 6 : way === 2 ? 4 : 2;
      write8(c, rec + 36, facing);
      write8(c, rec + 37, facing);
    }
    write8(c, rec + 124, j);
    write8(c, rec + 127, kind > 9 ? 255 : 15);
    // the damage: the attack's low byte, lighter or heavier by the victim's size against the attacker's own
    const power = attacks & 0xFF;
    if (kind === 9) {
      write16(c, rec + 240, 0);
      write16(c, rec + 242, 0);
    } else if (power === 63) {
      write16(c, rec + 240, read8(c, rec + HEALTH));
      write8(c, rec + 192, 1);
    } else {
      const weight = (read8(c, SETUP + 20 + i) >> 1) - read8(c, SETUP + 12 + j);
      let damage = s16(power) - ((s16(power) * weight) >> 4);
      if (damage <= 0) damage = 1;
      write16(c, rec + 240, damage);
      let gained = (damage << 16) >> 19;
      if (gained <= 0) gained = 1;
      if (read8(c, rec + 155) === 9) gained <<= 1;
      write16(c, rec + 242, gained);
    }
    write8(c, rec + PAUSE_NEXT, (attacks >>> 17) & 0x7F);
  }
  // a thing's hit, kept in its owner's record at 174: the damage in its low six bits, the kind above them, the fighter
  // it reached in bits 11 and 12, and the frames it holds for above those
  for (let j = 0; j < 4; j++) {
    if (j === i || !isActive(c, j)) continue;
    const attacker = record(j), raw = read16(c, attacker + 174);
    if (raw === 0 || ((raw >> 11) & 3) !== i) continue;
    const kind = (raw >> 6) & 0x1F, guard = read8(c, rec + 141) & 0x30;
    const now = read16(c, rec + STATE);
    if (now === 53 || now === 0x135 || read8(c, rec + 151) !== 0
      || ((kind === 10 || kind === 11 || kind === 12) && guard === 0x20)
      || ((kind === 13 || kind === 14) && guard === 0x10) || (kind === 15 && guard === 0x30)) {
      guardHit(c, i, j);
      break;
    }
    clearFlags(c, rec, 0x40000);
    addFlags(c, rec, 1 << (kind + 2));
    write8(c, rec + 124, j);
    write8(c, rec + 127, kind > 9 ? 255 : 15);
    const power = raw & 0x3F;
    if (power === 63) {
      write16(c, rec + 240, read8(c, rec + HEALTH));
      write8(c, rec + 192, 1);
    } else {
      const weight = (read8(c, SETUP + 20 + i) >> 1) - read8(c, SETUP + 12 + j);
      let damage = s16(power) - ((s16(power) * weight) >> 4);
      if (damage <= 0) damage = 1;
      write16(c, rec + 240, damage);
      let gained = (damage << 16) >> 19;
      if (gained <= 0) gained = 1;
      if (read8(c, rec + 155) === 9) gained <<= 1;
      write16(c, rec + 242, gained);
    }
    write8(c, rec + PAUSE_NEXT, raw >> 13);
    break;
  }
  settleHits(c, i);
}

/**
 * 0x080036dc's guard, from 0x08003bd4: a blocked hit. The guard holds as state 0x135, for as long as the attack would
 * have stopped it, and the attacker is marked as hit back, with nothing taken (kind 9), while half the attack's
 * strength goes to the guard's power gauge. A blocked hit ends the fighter's look at the others' attacks this frame.
 */
function guardHit(c, i, j) {
  const rec = record(i), attacker = record(j);
  if ((read8(c, rec + 126) >> j) & 1) return;
  if (read8(c, rec + 151) === 5) return;
  addFlags(c, rec, 0x40000);
  write8(c, rec + 151, 6);
  if (read8(c, rec + PAUSE) === 0) {
    setState(c, i, 0x135);
    write8(c, rec + PAUSE_DONE, 1);
    write8(c, rec + PAUSE, (read32(c, attacker + ATTACKS) & 0xFE0000) >>> 17);
  }
  write32(c, rec + ATTACKS, read32(c, rec + ATTACKS) | 0x40000);
  // linked play counts it only for the player, or the player's partner when it counts
  if (read8(c, 0x0300138C) !== 0 && i !== read32(c, PLAYER)) {
    if (i !== read32(c, PLAYER) + 2 || read8(c, SETUP + 28 + i) === 0) return;
  }
  write8(c, rec + 126, read8(c, rec + 126) | ((read32(c, rec + ATTACKS) >>> 13) & 15));
  write32(c, rec + ATTACKS, 0x900 | (0x2000 << j));
  if (read8(c, rec + 125) === 255) write8(c, rec + 125, j);
  write32(c, rec + 120, read32(c, rec + ATTACKS));
  write16(c, rec + 176, 0);
  const power = read8(c, attacker + ATTACKS);
  if (power === 63) {
    write8(c, rec + 147, 72);
    write16(c, rec + 242, 0);
    return;
  }
  let gained = power >> 1;
  if (gained === 0) gained = 1;
  if (read8(c, rec + 155) === 9) gained <<= 1;
  write16(c, rec + 242, gained);
}

/** 0x0800410c and 0x08004382: the hit's reaction, and then the health and the gauges. */
function settleHits(c, i) {
  const rec = record(i);
  if (read8(c, rec + PAUSE) !== 0) return;
  let flags = read32(c, rec + FLAGS);
  if (flags & REACTION_FLAGS) {
    write8(c, rec + 184, 1);
    if (read8(c, rec + 36) === 0) write8(c, rec + 36, read8(c, rec + 37));
    if (flags & 0x80) setState(c, i, 68);
    else if (flags & 0x800) setState(c, i, 54);
    else if (flags & 0x200) setState(c, i, 0x145);
    else if (flags & 0x400) setState(c, i, 0x147);
    else if (flags & 0x1000) setState(c, i, 80);
    else if (flags & 0x2000) setState(c, i, 81);
    else if (flags & 0x4000) setState(c, i, 82);
    else if (flags & 0x8000) setState(c, i, 83);
    else if (flags & 0x10000) setState(c, i, 84);
    else if (flags & 0x20000) setState(c, i, 85);
    else if (flags & 0x20) setState(c, i, 67);
    else if (flags & 0x40) setState(c, i, 0x143);
    else if (flags & 0x10) setState(c, i, 66);
    else if (flags & (0x8 | 0x100)) setState(c, i, flags & 4 ? 69 : 65);
    // the reaction happened: its flags go, and the hit's frame shows
    flags = (read32(c, rec + FLAGS) | 0x100000) & ~(REACTION_FLAGS | 0x200 | 0x400 | 0x800 | 0x1000 | 0x2000 | 0x4000
      | 0x8000 | 0x10000 | 0x20000);
    write32(c, rec + FLAGS, flags);
  }
  const damage = read16(c, rec + 240), taken = SETUP + 98 + i * 2;
  write16(c, taken, read16(c, taken) + damage);
  const health = read8(c, rec + HEALTH);
  if (damage > health) {
    write16(c, rec + 240, health);
    write8(c, rec + HEALTH, 0);
  } else write8(c, rec + HEALTH, health - damage);
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

/**
 * 0x08006134: a fighter's attack reaches the others. Its script gave it a point ahead of it (rec+96, 98 and 100), a
 * radius (rec+104 and 102) and how far it goes (rec+107); every other fighter whose own body is inside takes the hit,
 * which marks the attack's flags on the attacker's record for 0x080036dc to settle.
 */
function reachOthers(c, i) {
  const rec = record(i), flags = read32(c, rec + FLAGS);
  if (flags & 0x40000) return;
  const state = read16(c, rec + STATE);
  if (state === 0x145 || state === 54) return;
  if ((read32(c, rec + ATTACKS) & 0x1F00) === 0x900) return;
  write32(c, rec + ATTACKS, 0);
  // an attack the pad aims moves its point 16 the way the pad points
  const aimed = read8(c, rec + 106);
  if (aimed & 2) {
    const way = read8(c, rec + 108);
    if (way === 4) write16(c, rec + 96, read16(c, rec + 96) - 16);
    else if (way === 6) write16(c, rec + 96, read16(c, rec + 96) + 16);
    else if (way === 2) write16(c, rec + 98, read16(c, rec + 98) + 16);
    else if (way === 8) write16(c, rec + 98, read16(c, rec + 98) - 16);
  }
  if (read16(c, rec + 104) === 0) return;
  const view = read8(c, VIEW_FACING);
  const x = reads16(c, rec), y = reads16(c, rec + 2), z = reads16(c, rec + 4);
  const ox = reads16(c, rec + 96), oy = reads16(c, rec + 98);
  const front = read8(c, rec + 16) === 1;
  let hitX, hitY;
  if (view === 0) { hitX = front ? x + ox : x - ox; hitY = y + oy; }
  else if (view === 1) { hitX = front ? x - ox : x + ox; hitY = y + oy; }
  else if (view === 2) { hitX = x + oy; hitY = front ? y - ox : y + ox; }
  else { hitX = x + oy; hitY = front ? y + ox : y - ox; }
  const hitZ = z + read16(c, rec + 100);
  let reach = read8(c, rec + 107);
  if (reach === 63) reach = 62;
  else if (reach > 100) reach = 100;
  let nearest = -1;
  for (let j = 0; j < 4; j++) {
    if (j === i) continue;
    const other = record(j);
    if (read8(c, other + 187) === 0) continue;
    if ((read8(c, rec + 126) >> j) & 1) continue;
    if (read8(c, SETUP + 20 + j) === 255) continue;
    // teammates don't hit each other, when the fight has teams
    if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 9) !== 1
      && read8(c, SETUP + 32 + j) === read8(c, SETUP + 32 + i)) continue;
    const dx = s16(hitX) - reads16(c, other), dy = s16(hitY) - reads16(c, other + 2);
    const radius = read16(c, rec + 104) + read8(c, other + 187);
    const high = (read8(c, rec + 102) + read8(c, other + 186)) >> 1;
    if (Math.abs(s16(hitZ) - reads16(c, other + 4)) >= high) continue;
    if (dx * dx + dy * dy >= radius * radius) continue;
    let attacks = read32(c, rec + ATTACKS);
    if (attacks === 0) {
      attacks = read8(c, rec + 106) << 8;
      let pause;
      if (read8(c, rec + 149) === 3) { attacks |= 63; pause = 10; }
      else { attacks |= reach; pause = read8(c, rec + 113); }
      write8(c, rec + 29, pause);
      attacks |= pause << 17;
    }
    write16(c, SETUP + 90 + i * 2, read16(c, SETUP + 90 + i * 2) + reach);
    attacks |= 0x2000 << j;
    write8(c, rec + 126, read8(c, rec + 126) | (1 << j));
    const distance = dx * dx + dy * dy;
    if (nearest < 0 || nearest > distance) { write8(c, rec + 125, j); nearest = distance; }
    if (read8(c, rec + 106) === 3) write8(c, rec + 112, 24);
    if (read8(c, rec + 106) === 2) {
      write8(c, rec + 110, 24);
      addFlags(c, rec, 0x4000000);
    }
    // the direction the victim is thrown: the way the attack faces, or the way the aim points
    let direction = -1;
    if (read8(c, rec + 106) === 2 || (read8(c, rec + 106) >= 10 && read8(c, rec + 106) <= 15)) {
      const mode = read8(c, rec + 36);
      if (mode === 4) direction = 1;
      else if (mode === 6) direction = 2;
      else if (mode === 8) direction = 3;
    }
    if (direction < 0) {
      const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10;
      const side = read8(c, rec + 16) === 0 ? 4 : 6;
      const way = read8(c, camera + side);
      if (way === 4) direction = 1;
      else if (way === 6) direction = 2;
      else if (way === 8) direction = 3;
    }
    if (direction > 0) attacks |= direction * (0x1000000 << (j * 2));
    write32(c, rec + 120, attacks);
    write32(c, rec + ATTACKS, attacks);
    write16(c, rec + 176, 0);
    const hits = SETUP + 66 + i * 2;
    write16(c, hits, read16(c, hits) + 1);
    if (read8(c, SETUP + 137 + i) === 1) {
      const count = SETUP + 74 + i * 2;
      write16(c, count, read16(c, count) + 1);
      write8(c, SETUP + 137 + i, 2);
    }
  }
}

/**
 * 0x08005310: the moves a fighter's keys ask for, and its short timers. B asks for the next of its combo, or with the pad
 * close behind for a dash attack, and R for the special its slot picks; the pad's way is kept for a dash attack to face.
 * A guard (L) heals while it holds: its state counts frames, and its two rates say how often health and power go up.
 */
function readFighterKeys(c, i) {
  const rec = record(i), stateNow = read16(c, rec + STATE);
  let asks = read8(c, rec + 138);
  if (!(asks & 0xF8) && stateNow !== 4) {
    const keys = pressed(c, i), side = read8(c, rec + 16);
    // a press of the pad against the way it's facing turns it, or starts a dash
    if (((keys & 0x20) && side === 1) || ((keys & 0x10) && side === 0)) write8(c, rec + 109, 4);
    const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10;
    if (keys & 0x20) write8(c, rec + 108, read8(c, camera + 4));
    else if (keys & 0x10) write8(c, rec + 108, read8(c, camera + 6));
    else if (keys & 0x40) write8(c, rec + 108, read8(c, camera + 8));
    else if (keys & 0x80) write8(c, rec + 108, read8(c, camera + 2));
    if (keys & 2) {
      // B: with a direction pressed close behind, the dash attack that way, or else the combo's next
      if (pressedBefore(c, i, 4, 6, 0xF0)) {
        if (pressedBefore(c, i, 4, 6, 0x10) && side === 0) asks |= 0x10;
        else if (pressedBefore(c, i, 4, 6, 0x20) && side === 1) asks |= 0x10;
        else asks |= 8;
      } else if (asks & 4) asks |= 8;
      else if (asks & 2) asks |= 4;
      else if (asks & 1) asks |= 2;
      else {
        asks |= 1;
        write8(c, rec + 108, 0);
      }
      write8(c, rec + 138, asks);
    } else if (keys & 0x100) {
      // R: the special the fighter's slot picks, one of three
      const slot = read8(c, rec + 141) & 3;
      if (slot === 1) write8(c, rec + 138, asks | 0x40);
      else if (slot === 2) write8(c, rec + 138, asks | 0x20);
      else if (slot === 3) write8(c, rec + 138, asks | 0x80);
    }
  }
  const state = read16(c, rec + STATE), character = read8(c, rec + CHARACTER_NOW);
  // an attack the pad aims: while the pad still points the way it was aimed, it goes on turning that way
  if (state === 13 || (state === 15 && (character === 2 || character === 5))
    || (state === 21 && (character === 2 || character === 4))) {
    const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10, way = read8(c, rec + 108);
    const heldKeys = held(c, i);
    const pointing = (at, key) => way === read8(c, camera + at) && (heldKeys & key) !== 0;
    if (pointing(4, 0x20) || pointing(6, 0x10) || pointing(8, 0x40) || pointing(2, 0x80)) {
      addFlags(c, rec, 0x40000000);
    } else {
      clearFlags(c, rec, 0x800000 | 0x4000000 | 0x2000000);
    }
  } else {
    clearFlags(c, rec, 0x800000 | 0x4000000 | 0x2000000);
  }
  // state 66 keeps whether the pad points the way it last faced, for the guard's turn
  if (state === 66) {
    const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10, facing = read8(c, rec + 37);
    const heldKeys = held(c, i);
    const pointing = (at, key) => facing === read8(c, camera + at) && (heldKeys & key) !== 0;
    write8(c, rec + 185, pointing(4, 0x20) || pointing(6, 0x10) || pointing(8, 0x40) || pointing(2, 0x80) ? 1 : 0);
  }
  for (const timer of [109, 110, 112]) {
    const left = read8(c, rec + timer);
    if (left !== 0) write8(c, rec + timer, left - 1);
  }
  if (state === 55) {
    // the guard heals: its frame count over each rate is the frame that rate takes
    const clock = (read8(c, rec + 190) + 1) & 0xFF;
    write8(c, rec + 190, clock);
    if (clock % read8(c, rec + 188) === 0 && read8(c, rec + HEALTH) < read16(c, 0x03001B28)) {
      write8(c, rec + HEALTH, read8(c, rec + HEALTH) + 1);
    }
    if (clock % read8(c, rec + 189) === 0 && read8(c, rec + 147) <= 71) {
      write8(c, rec + 147, read8(c, rec + 147) + 1);
    }
  }
  for (const timer of [145, 146]) {
    const left = read8(c, rec + timer);
    if (left === 0) continue;
    if (left === 1) {
      setState(c, i, timer === 145 ? 0x215 : 0x216);
      write8(c, rec + timer, 0);
      continue;
    }
    const rate = left > 149 ? 30 : left > 59 ? 15 : 0;
    if (rate !== 0 && left % rate === 0 && i === read32(c, PLAYER)) c.sound?.play(timer === 145 ? 0x338 : 0x338);
    write8(c, rec + timer, left - 1);
  }
}

// what 0x0800486c leaves alone in the air, instead of letting a fighter fall
const KEEPS_ITS_STATE_IN_THE_AIR = new Set([
  4, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 52, 54, 66, 67, 68, 69, 70, 71, 80, 81, 82, 83, 84,
  85, 96, 252, 253, 254, 255, 0x111, 0x113, 0x114, 0x115, 0x116, 0x117, 0x118, 0x135, 0x143, 0x145, 0x147, 0x150,
  0x213, 0x214, 0x215, 0x216, 0x217, 0x218,
]);
const STANDS = new Set([0, 1, 2, 3, 5, 10, 11, 12, 13, 14, 52, 0x105, 0x135]);
const PAD = 0xF0;
// the states a second press of the pad doesn't start a dash from
const NO_DASH = new Set([
  4, 19, 20, 21, 22, 23, 24, 0x113, 0x114, 0x115, 0x116, 0x117, 0x118, 0x213, 0x214, 0x215, 0x216, 0x217, 0x218,
]);

/** 0x0800486c: a fighter's next state, by where it stands and its keys. Partly: with nothing pressed, and no hits. */
function fighterAct(c, i) {
  const rec = record(i);
  // a hit this fighter landed: its victim says so for one frame, and the fighter's own count keeps the combo
  for (let j = 0; j < 4; j++) {
    if (j === i) continue;
    const victim = record(j);
    if ((read8(c, victim + 127) & 15) !== i || !isActive(c, j)) continue;
    if (read8(c, SETUP + 20 + j) === 255) continue;
    if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 32 + j) === read8(c, SETUP + 32 + i)) continue;
    write8(c, SETUP + 47 + j, Math.min(read8(c, SETUP + 47 + j) + 1, 3));
    if (read8(c, victim + 127) & 0xF0) write8(c, SETUP + 11 + i, read8(c, SETUP + 11 + i) + 1);
    write8(c, victim + 127, 15);
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
    if ((keys & PAD) && pressedBefore(c, i, 5, 5, keys) && !(flags & 0x40000) && !NO_DASH.has(read16(c, rec + STATE))) {
      setState(c, i, 4);
    }
    let state = read16(c, rec + STATE);
    if (!STANDS.has(state)) return;
    if (keys & 1) {
      if (!(flags & 0x40000)) setState(c, i, 7);
    } else if (keys & 0x200) {
      // L guards, unless the fighter is busy with something else and not yet able to leave it
      if (!(flags & FLAG_LOCKED)) setState(c, i, 53);
      else if (state !== 52 || reads16(c, rec + SCRIPT_FRAME) > 12) setState(c, i, 53);
    } else if (read8(c, rec + 17) !== read8(c, rec + 18)) {
      if (state === 2 || state === 3 || state === 5) setState(c, i, 5);
      else if (state === 0 || state === 0x105 || state === 1) setState(c, i, 0x105);
    } else if (state === 0 && (held(c, i) & PAD)) {
      setState(c, i, 1);
    } else if (!(held(c, i) & PAD)) {
      state = read16(c, rec + STATE);
      if (state === 2 || (state === 1 && reads16(c, rec + SCRIPT_AT) > 11)) setState(c, i, 3);
      else if (state === 1) setState(c, i, 0);
    }
    attackAsked(c, i);
    return;
  }
  if (!(flags & FLAG_IN_AIR)) return;
  const state = read16(c, rec + STATE);
  if (state === 6 || state === 7 || state === 9) {
    if (flags & FLAG_LOCKED) return;
    if (keys & 1) {
      // A in the air: a second jump (9), where the fighter has one: after a hit threw it (184 at 2), or for the one
      // character that always has it, or Emerl with its moves, once in a jump
      const character = read8(c, SETUP + 20 + i), now = read16(c, rec + STATE);
      const copied = character === 9 && read8(c, 0x030013B0 + i * 156 + 10) === 4;
      if (read8(c, rec + 184) === 2 || ((character === 4 || copied) && now !== 9)) {
        write8(c, rec + 36, read8(c, rec + 37));
        setState(c, i, 9);
        return;
      }
    }
    if (keys & 2) {
      // B in the air: the jump attack
      setState(c, i, 18);
      return;
    }
    if (keys & 0x100 && read8(c, rec + 184) !== 0) {
      const slot = read8(c, rec + 141) & 12;
      if (slot === 4) setState(c, i, 20);
      else if (slot === 8) setState(c, i, 22);
      else if (slot === 12) setState(c, i, 24);
    }
    return;
  }
  if (!KEEPS_ITS_STATE_IN_THE_AIR.has(state)) setState(c, i, 6);
}

/** 0x0800486c's end: the attack the fighter's keys asked for, chaining its combo while one is still going. */
function attackAsked(c, i) {
  const rec = record(i), flags = read32(c, rec + FLAGS);
  if (!(flags & FLAG_CHAIN)) {
    if (flags & FLAG_LOCKED) return;
    const asks = read8(c, rec + 138);
    if (asks & 0x10) { turnForAttack(c, rec); setState(c, i, 14); return; }
    if (asks & 0x8) { setState(c, i, 13); return; }
    if (asks & 0x20) { setState(c, i, 21); return; }
    if (asks & 0x40) { setState(c, i, 19); return; }
    if (asks & 0x80) { setState(c, i, 23); return; }
    if (asks & 1) { setState(c, i, 10); return; }
    return;
  }
  // a chain: the combo goes on, and bits 1 and 2 are its next two hits
  let asks = read8(c, rec + 138);
  const state = read16(c, rec + STATE);
  if (state === 10) asks &= 0xFE;
  else if (state === 11) asks &= 0xFD;
  else if (state === 12) asks &= 0xFB;
  write8(c, rec + 138, asks);
  if (asks & 2) { setState(c, i, 11); return; }
  if (asks & 4) { setState(c, i, 12); return; }
  if (asks & 0x10) { turnForAttack(c, rec); setState(c, i, 14); return; }
  if (asks & 0x8) {
    // a dash attack: the way it faces decides whether it goes on or back
    const camera = DIRECTIONS + read8(c, rec + CAMERA) * 10, way = read8(c, rec + 108);
    const front = read8(c, rec + 16) === 1;
    const forward = (way === read8(c, camera + 4) && front) || (way === read8(c, camera + 6) && !front);
    setState(c, i, forward ? 14 : 13);
    return;
  }
  if (asks & 0x20) { setState(c, i, 21); return; }
  if (asks & 0x40) { setState(c, i, 19); return; }
  if (asks & 0x80) { setState(c, i, 23); return; }
  if (asks & 1) { setState(c, i, 10); }
}

/** The turn an aimed attack takes before it starts: its facing mode becomes the way the pad points. */
function turnForAttack(c, rec) {
  const mode = read8(c, rec + 36);
  if (mode === 4) write8(c, rec + 36, 6);
  else if (mode === 6) write8(c, rec + 36, 4);
  else if (mode === 8) write8(c, rec + 36, 2);
  else if (mode === 2) write8(c, rec + 36, 8);
}

/** 0x0800444c: a fighter touching the ground or leaving it. Partly: not a bounce off a wall, nor falling out of a fight. */
function landOrFall(c, i) {
  const rec = record(i);
  if (read8(c, rec + PAUSE) !== 0) return;
  const state = read16(c, rec + STATE);
  // 0x0800444c: a fighter thrown into a wall it was flying at bounces, unless the guard's last hit takes it instead
  const bumped = read8(c, rec + BUMPED);
  if (bumped !== 0 && (state === 66 || state === 81)) {
    const facing = read8(c, rec + LAST_FACING);
    const intoWall = [[1, 4], [2, 6], [4, 8], [8, 2], [16, 4], [32, 6], [64, 8], [128, 2]]
      .some(([bit, way]) => (bumped & bit) !== 0 && facing === way);
    if (intoWall) {
      if (read8(c, rec + 185) === 1) {
        write8(c, rec + 125, read8(c, rec + 124));
        setState(c, i, 96);
      } else addFlags(c, rec, 0x80);
    }
  }
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

/** The script of each kind of thing, as the cartridge's per-kind cases of 0x0800c728 give it. */
const THING_SCRIPTS = new Map([
  [3, 0x0806B514], [4, 0x0806B54C], [5, 0x0806B594], [8, 0x0806B630], [10, 0x0806B6B4], [11, 0x0806B7B0],
  [12, 0x0806B8CC], [13, 0x0806B940], [14, 0x0806B804], [15, 0x0806B9D4], [16, 0x0806BB08], [31, 0x0806BB08],
  [32, 0x0806BBA0], [34, 0x0806BBF4], [35, 0x0806BC54], [40, 0x0806C6EC], [37, 0x0806C07C], [38, 0x0806C1AC], [39, 0x0806C448],
  [43, 0x0806C60C], [44, 0x0806C67C], [45, 0x0806C8F4], [41, 0x0806C790], [46, 0x0806C944], [73, 0x0806CE18],
  [75, 0x0806CE98], [77, 0x0806CFBC], [79, 0x0806D29C], [80, 0x0806D2EC], [81, 0x0806D378],
  [54, 0x0806C984], [57, 0x0806CA14], [60, 0x0806CD14], [61, 0x0806CD68],
  [117, 0x0806DC00], [118, 0x0806DC60], [114, 0x0806DB48], [120, 0x0806DCBC], [121, 0x0806DD04], [122, 0x0806DDA4],
  [158, 0x0806E520], [160, 0x0806E5F0],
]);
const THING_MARK = 0xFFF00000;
// the fields a script's words set, by the word's first half
const THING_FIELDS = new Map([
  [0x3500, 34], [0x3700, 36], [0x3900, 38], [0x3B00, 40], [0x3600, 42], [0x3800, 44], [0x3A00, 46], [0x3C00, 48],
]);
const THING_PICTURE_WORDS = new Map([[0x3100, 0], [0x3200, 1], [0x3300, 2], [0x3400, 3]]);
const THINGS_WITH_SHAPES = new Set([35, 37, 38, 39, 43, 44, 158, 160]);

/**
 * 0x0800bb88's pictures of a thing with a shape: the way it faces picks which of a picture's sides shows, and two
 * tables in the cartridge say how far each part sits across and down.
 */
function shapeThingPicture(c, thing, kind, part) {
  const field = thing + 26 + part * 2;
  const camera = 0x0806FF90 + read8(c, VIEW_FACING) * 10, facing = read8(c, thing + 64);
  const front = facing === read8(c, camera + 2), back = facing === read8(c, camera + 8);
  let picture = read16(c, field);
  if (kind === 35) {
    // one part's picture moves on a step while it is low enough
    if (reads16(c, thing + 62) <= read8(c, thing + 17)) write16(c, field, picture + 16);
    return;
  }
  let away, across, down, below;
  if (kind === 37) {
    if (front) picture += 0x100;
    else if (back) picture += 0x200;
    away = 0xF00; across = 0x0806C0EC; down = 0x0806C14C; below = 8;
  } else if (kind === 38 || kind === 43) {
    if (front) picture += 0x2A0;
    else if (back) picture += 0x540;
    away = 0x1200; across = 0x0806C250; down = 0x0806C34C; below = 36;
  } else if (kind === 39 || kind === 44) {
    if (front) picture += 0x1E0;
    else if (back) picture += 0x3C0;
    away = 0x1A00; across = 0x0806C4A4; down = 0x0806C558; below = 36;
  } else if (kind === 158 || kind === 160) {
    if (front) picture += 0x90;
    else if (back) picture += 0x120;
    write16(c, field, picture);
    return;
  } else {
    notPorted('0800BB88', `a picture of a thing of kind ${kind}`);
  }
  write16(c, field, picture);
  const frame = ((picture - away) >> 4) * 2;
  write16(c, thing + 34 + part * 2, read16(c, across + frame));
  write16(c, thing + 42 + part * 2, read16(c, down + frame) - below);
}

/** 0x0800bb88: a thing's script for a frame, the words that come at the frame it is on. */
function runThingScript(c, k, script) {
  const thing = 0x030017D0 + k * 68, kind = read16(c, thing + 56);
  const word = () => read32(c, script + read16(c, thing + 22) * 4);
  const marked = () => (word() & 0xFFFF0000) >>> 0 === THING_MARK;
  while (!marked()) write16(c, thing + 22, read16(c, thing + 22) + 1);
  if ((word() & 0xFFFF) === read8(c, thing + 24)) {
    write16(c, thing + 22, read16(c, thing + 22) + 1);
    if (!marked()) {
      for (;;) {
        const w = word() >>> 0, op = w >>> 16;
        if (THING_FIELDS.has(op)) write16(c, thing + THING_FIELDS.get(op), w);
        else if (THING_PICTURE_WORDS.has(op)) {
          const part = THING_PICTURE_WORDS.get(op);
          write16(c, thing + 26 + part * 2, w);
          if (THINGS_WITH_SHAPES.has(kind)) shapeThingPicture(c, thing, kind, part);
        } else if (op === 0xFFFF) {
          clearEffect(c, k);
          write16(c, thing + 22, 0xFFFF);
          write8(c, thing + 24, 255);
          write16(c, thing + 56, 0);
        } else if (op === 0x1300) write8(c, thing + 4, w);
        else if (op === 0x1400) write8(c, thing + 4, 255);
        else if (op === 0x1500) write8(c, thing + 4, 254);
        else if (op === 0x1600) write8(c, thing + 52, w);
        else if (op === 0x3F00) write8(c, thing + 6, 1);
        else if (op === 0x3000) write8(c, 0x030016CC, w);
        else if (op === 0x0001) {
          // a speed the way the thing faces: the diagonals are shorter by 11/16
          const speed = s16(w), diagonal = (Math.imul(speed, 11) << 12) >>> 16;
          switch (read8(c, thing + 64)) {
            case 1: write16(c, thing + 8, -diagonal); write16(c, thing + 10, diagonal); break;
            case 2: write16(c, thing + 10, s16(w)); break;
            case 3: write16(c, thing + 8, diagonal); write16(c, thing + 10, diagonal); break;
            case 4: write16(c, thing + 8, -s16(w)); break;
            case 6: write16(c, thing + 8, s16(w)); break;
            case 7: write16(c, thing + 8, -diagonal); write16(c, thing + 10, -diagonal); break;
            case 8: write16(c, thing + 10, -s16(w)); break;
            case 9: write16(c, thing + 8, diagonal); write16(c, thing + 10, -diagonal); break;
            default:
          }
        } else if (op === 0x0002) write16(c, thing + 12, w);
        else if (op === 0x0012) write16(c, thing + 14, w);
        else if (op === 0x2800) {
          // a sound, panned by where the thing is across the screen
          const place = Math.max(-127, Math.min(127, ((read16(c, thing + 18) - 88) << 17) >> 16));
          queueEffect(c, s16(w), place);
        } else if (op === 0x2300) {
          // another effect of its own kind, at its place, with the same speeds and owner
          fn0800c1c8(c, s16(w), read8(c, thing + 64), read16(c, thing + 58), read16(c, thing + 60),
            read16(c, thing + 62), reads16(c, thing + 8), reads16(c, thing + 10), reads16(c, thing + 12),
            read8(c, thing + 51), read8(c, thing + 53), read8(c, thing + 65));
        }
        else if (op === 0xFFFE) {
          write16(c, thing + 22, 0xFFFF);
          write8(c, thing + 24, 255);
        } else notPorted('0800BB88', `a word of a thing's script, ${w.toString(16)}`);
        write16(c, thing + 22, read16(c, thing + 22) + 1);
        if (marked()) break;
      }
    }
  }
  write8(c, thing + 24, read8(c, thing + 24) + 1);
}

// 0x0800eaec's kinds of things that hit, each with what it hands 0x0800f0ac: its reach, its height, its damage, the
// frames the hit holds, its kind of hit (bits 6 to 10 of the record), whether it may hit the same fighter again, and
// the first and last frames of its own it hits in
const THING_HITS = new Map([
  [38, [0x160, 6, 20, 2, 0x380, 0, 1, 255]], [41, [0x280, 4, 20, 2, 0x3C0, 0, 0, 22]], [43, [0x160, 6, 20, 2, 0x380, 0, 0, 255]],
  [39, [0x160, 6, 20, 2, 0x380, 0, 1, 255]], [44, [0x160, 6, 20, 2, 0x380, 0, 0, 255]],
  [79, [0x180, 12, 30, 3, 0x380, 0, 0, 255]],
  [54, [0x100, 16, 30, 2, 0x280, 0, 11, 16]], [57, [0x120, 4, 5, 2, 0x340, 1, 0, 255]],
  [117, [0x140, 6, 15, 2, 0x380, 0, 0, 255]], [122, [0x240, 20, 15, 2, 0x3C0, 0, 0, 22]],
]);
// the kinds 0x0800eaec has hits for that aren't ported yet
const THING_HITS_LATER = new Set([62, 63, 78, 82, 94, 97, 102, 137, 138, 142, 154, 158, 160,
  165, 166, 174, 175, 177, 178, 179, 185, 191, 194, 197, 201, 241, 245]);

// the kinds of things 0x0800cec8 has steps for after they move that aren't ported yet
const THING_STEPS_LATER = new Set([39, 101, 141]);

/**
 * 0x0800d818: a kind 40 mine feels the first fighter that comes near it, other than its owner, and tells its owner,
 * at the owner's +236.
 */
function mineFeelsFighters(c, thing) {
  const owner = read8(c, thing + 53);
  for (let i = 0; i < 4; i++) {
    if (i === owner) continue;
    const rec = record(i);
    if (read8(c, rec + 187) === 0 || read8(c, SETUP + 20 + i) === 255) continue;
    if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 9) !== 1
      && read8(c, SETUP + 32 + owner) === read8(c, SETUP + 32 + i)) continue;
    const dx = reads16(c, thing + 58) - reads16(c, rec), dy = reads16(c, thing + 60) - reads16(c, rec + 2);
    const dz = reads16(c, thing + 62) - reads16(c, rec + 4);
    if (Math.abs(dx) > 0x23F || Math.abs(dy) > 0x23F || Math.abs(dz) > 9) continue;
    if (read8(c, 0x0300138C) !== 0) {
      const player = read32(c, PLAYER);
      if (owner !== player && (owner !== player + 2 || read8(c, SETUP + 28 + owner) === 0)) continue;
    }
    write8(c, record(owner) + 236, 1);
    break;
  }
}

// the ways a thing faces that fly at each side: right, left, down and up the arena
const FACES_RIGHT = [3, 6, 9], FACES_LEFT = [1, 4, 7], FACES_DOWN = [1, 2, 3], FACES_UP = [7, 8, 9];

/**
 * 0x0800d3be: whether a kind 38 shot bursts, as it meets an edge of the arena it is flying at, or the side of a wall
 * it is flying at below the wall's top.
 */
function shotMeetsWall(c, thing) {
  const bits = read8(c, thing + 16), facing = read8(c, thing + 64);
  const low = reads16(c, thing + 62) < reads16(c, FLOOR);
  if ((bits & 16) && FACES_RIGHT.includes(facing)) return true;
  if ((bits & 32) && FACES_LEFT.includes(facing)) return true;
  if ((bits & 64) && FACES_DOWN.includes(facing)) return true;
  if ((bits & 128) && FACES_UP.includes(facing)) return true;
  if ((bits & 1) && FACES_RIGHT.includes(facing) && low) return true;
  if ((bits & 2) && FACES_LEFT.includes(facing) && low) return true;
  if ((bits & 4) && FACES_DOWN.includes(facing) && low) return true;
  return (bits & 8) !== 0 && FACES_UP.includes(facing) && low;
}

/** 0x0800eaec: a thing's hit, for the kinds that have one. */
function thingHit(c, k, kind) {
  if (THING_HITS.has(kind)) thingHitsFighters(c, k, ...THING_HITS.get(kind));
  else if (THING_HITS_LATER.has(kind)) notPorted('0800EAEC', `the hit of a thing of kind ${kind}`);
}

/**
 * 0x0800f0ac: a thing reaches the first fighter inside its reach that isn't its owner, and the hit is kept on its
 * owner's record (+174) for 0x080036dc to settle. A full Ichikoro gauge turns the hit into a knockout.
 */
function thingHitsFighters(c, k, reach, height, damage, hold, hitKind, again, first, last) {
  const thing = 0x030017D0 + k * 68, owner = read8(c, thing + 53), ownerRecord = record(owner);
  if (read8(c, 0x0300138C) !== 0) {
    const player = read32(c, PLAYER);
    if (owner !== player && (owner !== player + 2 || read8(c, SETUP + 28 + owner) === 0)) return;
  }
  const lift = read16(c, thing + 56) === 194 ? -64 : 0;
  const frame = read8(c, thing + 24);
  if (frame < first || frame > last) return;
  damage = Math.min(damage, 62);
  const x = reads16(c, thing + 58), y = reads16(c, thing + 60), z = reads16(c, thing + 62);
  for (let i = 0; i < 4; i++) {
    if (i === owner) continue;
    const rec = record(i);
    if (read8(c, rec + 187) === 0 || read8(c, rec + 28) !== 0) continue;
    if (read8(c, SETUP + 20 + i) === 255) continue;
    if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 9) !== 1
      && read8(c, SETUP + 32 + owner) === read8(c, SETUP + 32 + i)) continue;
    const dx = x - reads16(c, rec), dy = y - reads16(c, rec + 2), far = s16(reach) + read8(c, rec + 187);
    if (Math.abs(z + lift - reads16(c, rec + 4)) >= s16(height) + read8(c, rec + 186)) continue;
    if (Math.imul(dx, dx) + Math.imul(dy, dy) >= Math.imul(far, far)) continue;
    if ((read8(c, thing + 55) >> i) & 1) continue;
    if (read16(c, ownerRecord + 174) === 0) {
      if ((read8(c, thing + 65) & 1) && hitKind > 0x27F) write16(c, ownerRecord + 174, ((i & 3) << 11) | 0xE000 | hitKind | 63);
      else write16(c, ownerRecord + 174, ((hold & 15) << 13) | ((i & 3) << 11) | hitKind | damage);
    }
    const total = SETUP + 90 + owner * 2;
    write16(c, total, read16(c, total) + damage);
    const kept = read16(c, ownerRecord + 174);
    if (kept !== 0) {
      write16(c, ownerRecord + 176, kept);
      write32(c, ownerRecord + 120, 0);
    }
    if (again === 0) write8(c, thing + 55, read8(c, thing + 55) | (1 << i));
    write8(c, thing + 54, hold);
    if ([94, 174, 191, 194].includes(read16(c, thing + 56))) write8(c, ownerRecord + 28, hold);
    write16(c, SETUP + 66 + owner * 2, read16(c, SETUP + 66 + owner * 2) + 1);
    if (read8(c, thing + 66) === 0) {
      write8(c, thing + 66, 1);
      write16(c, SETUP + 74 + owner * 2, read16(c, SETUP + 74 + owner * 2) + 1);
    }
    break;
  }
}

/**
 * 0x0800cec8's steps for a kind 121 thing, Amy's Set: it turns toward the nearest fighter and moves that way, and a
 * fighter close enough sets its owner's +236, which starts the Set. Its own hit call has nothing for the kind, so the
 * reach is only through its owner's move.
 */
function stepAmySet(c, thing, k) {
  const owner = read8(c, thing + 53);
  let nearest = 255, nearestDistance = 0xFFFF;
  for (let i = 0; i < 4; i++) {
    if (i === owner) continue;
    const rec = record(i);
    if (read8(c, rec + 187) === 0 || read8(c, SETUP + 20 + i) === 255) continue;
    if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 9) !== 1
      && read8(c, SETUP + 32 + owner) === read8(c, SETUP + 32 + i)) continue;
    const dx = s16(read16(c, thing + 58) - read16(c, rec));
    const dy = s16(read16(c, thing + 60) - read16(c, rec + 2));
    const dz = s16(read16(c, thing + 62) - read16(c, rec + 4));
    const state = read16(c, rec + STATE), distance = Math.abs(dx) + Math.abs(dy);
    if (nearestDistance > distance && !(state >= 252 && state <= 255)) {
      nearestDistance = distance;
      nearest = i;
    }
    if (Math.abs(dx) > 0x21F || Math.abs(dy) > 0x21F || Math.abs(dz) > 19) continue;
    if (read8(c, 0x0300138C) !== 0) {
      const player = read32(c, PLAYER);
      if (owner !== player && (owner !== player + 2 || read8(c, SETUP + 28 + owner) === 0)) continue;
    }
    if (Math.abs(s16(read16(c, thing + 62) - read16(c, rec + 4))) > 23) continue;
    write8(c, record(owner) + 236, 1);
    nearestDistance = 0;
    break;
  }
  // the two calls the case makes to 0x0800eaec's hit: nothing for kind 121, so they leave the fighters alone
  if (nearestDistance === 0 || nearest !== 255) thingHit(c, k, 121);
  if (nearest === 255) return;
  const rec = record(nearest);
  let vx = read16(c, thing + 8), vy = read16(c, thing + 10);
  if (s16(read16(c, thing + 58)) < s16(read16(c, rec))) vx = u16(vx + 4); else vx = u16(vx - 4);
  if (s16(read16(c, thing + 60)) < s16(read16(c, rec + 2))) vy = u16(vy + 4); else vy = u16(vy - 4);
  write16(c, thing + 8, Math.max(-64, Math.min(64, s16(vx))));
  write16(c, thing + 10, Math.max(-64, Math.min(64, s16(vy))));
  const z = s16(read16(c, thing + 62)), target = s16(read16(c, rec + 4)) + 52;
  if (z < target) write16(c, thing + 62, u16(z + 1));
  else if (z > target) write16(c, thing + 62, u16(z - 1));
  write16(c, thing + 12, 0);
  write8(c, thing + 64, s16(read16(c, thing + 8)) < 0 ? 4 : 6);
}

/**
 * 0x0800c728: the things of a fight for a frame, and the screen's shake. A thing waiting to appear counts down; one that
 * has appeared runs its script (0x0800bb88) and moves (0x0800cec8). Partly: only the kinds in THING_SCRIPTS, and none
 * of the kinds whose own steps come after the move.
 */
function updateThings(c) {
  for (let i = 0; i < 4; i++) write16(c, record(i) + 174, 0);
  for (let k = 0; k < 12; k++) {
    const thing = 0x030017D0 + k * 68, kind = read16(c, thing + 56);
    if (kind === 0) continue;
    const wait = read8(c, thing + 54);
    if (wait !== 0) {
      write8(c, thing + 54, wait - 1);
      continue;
    }
    if (!THING_SCRIPTS.has(kind)) notPorted('0800C728', `a thing of kind ${kind}`);
    runThingScript(c, k, THING_SCRIPTS.get(kind));
    // 0x0800cec8: it follows its owner, or moves on its own
    if (read8(c, thing + 51) === 1) {
      const owner = record(read8(c, thing + 53));
      write16(c, thing + 58, read16(c, owner));
      write16(c, thing + 60, read16(c, owner + 2));
      write16(c, thing + 62, read16(c, owner + 4));
    } else {
      write16(c, thing + 58, read16(c, thing + 58) + read16(c, thing + 8));
      write16(c, thing + 60, read16(c, thing + 60) + read16(c, thing + 10));
      write16(c, thing + 62, read16(c, thing + 62) + read16(c, thing + 12));
    }
    // 0x0800cec8's per-kind steps: walls and the arena's edges push a thing back, and it falls until its floor
    // (0x0800d260, the same for kinds 35, 38, 39, 40, 57, 60, 61, 79, 80 and 81): a wall it is inside pushes it out
    // unless it is above the wall's top, where it stands on it instead, and the arena's edges push it back in
    if (kind === 54) {
      // 0x0800d33a: the arena's edges push it back and it sits on the floor, or at nothing when it meets no edge
      let met = meetThingWalls(c, reads16(c, thing + 58), reads16(c, thing + 60));
      write8(c, thing + 16, met.bits);
      if (met.bits & 0xF0) {
        write16(c, thing + 58, read16(c, thing + 58) - u16(met.edgeX));
        write16(c, thing + 60, read16(c, thing + 60) - u16(met.edgeY));
        met = meetThingWalls(c, reads16(c, thing + 58), reads16(c, thing + 60));
        write8(c, thing + 16, met.bits);
      }
      write16(c, thing + 62, read8(c, thing + 16) !== 0 ? reads16(c, FLOOR) : 0);
    } else if (kind === 35 || kind === 38 || kind === 39 || kind === 40 || kind === 57 || kind === 60 || kind === 61
      || kind === 79 || kind === 80 || kind === 81) {
      const met = meetThingWalls(c, reads16(c, thing + 58), reads16(c, thing + 60));
      write8(c, thing + 16, met.bits);
      if (met.bits & 0xF) {
        const top = reads16(c, FLOOR);
        if (reads16(c, thing + 62) >= top + reads16(c, thing + 12)) {
          write8(c, thing + 16, met.bits & 0xF0);
          write8(c, thing + 17, top);
          if (reads16(c, thing + 62) < top) write16(c, thing + 62, top);
        } else {
          write16(c, thing + 58, read16(c, thing + 58) - u16(met.wallX));
          write16(c, thing + 60, read16(c, thing + 60) - u16(met.wallY));
          write8(c, thing + 17, 0);
        }
      } else write8(c, thing + 17, 0);
      if (read8(c, thing + 16) & 0xF0) {
        write16(c, thing + 58, read16(c, thing + 58) - u16(met.edgeX));
        write16(c, thing + 60, read16(c, thing + 60) - u16(met.edgeY));
      }
      const height = reads16(c, thing + 62), floor = read8(c, thing + 17);
      if (height <= floor) {
        write16(c, thing + 12, 0);
        write16(c, thing + 62, floor);
      } else write16(c, thing + 12, read16(c, thing + 12) - read16(c, thing + 14));
    }
    if (kind === 38 && shotMeetsWall(c, thing)) {
      // (0x0800d516) a shot that meets a wall or an edge it's flying at bursts: kind 43 at its place
      const facing = read8(c, thing + 64), x = read16(c, thing + 58), y = read16(c, thing + 60), z = read16(c, thing + 62);
      const follows = read8(c, thing + 51), owner = read8(c, thing + 53), full = read8(c, thing + 65);
      clearEffect(c, k);
      fn0800c1c8(c, 43, facing, x, y, z, 0, 0, 0, follows, owner, full);
    }
    // (0x0800d954) the ring goes once its owner is knocked out or has none of its health left
    if (kind === 35) {
      const owner = record(read8(c, thing + 53));
      if (read16(c, owner + STATE) === 0x115 || read8(c, owner + HEALTH) === 0) clearEffect(c, k);
    }
    if (kind === 40) mineFeelsFighters(c, thing);
    if (kind === 61) {
      // 0x0800d9a4: it feels for the nearest fighter, tells its owner when one is close, and turns toward it
      const owner = read8(c, thing + 53);
      let nearest = 255, shortest = 0xFFFF;
      for (let f = 0; f <= 3; f++) {
        if (f === owner) continue;
        const rec = record(f);
        if (read8(c, rec + 187) === 0) continue;
        if (read8(c, SETUP + 20 + f) === 255) continue;
        if (read8(c, SETUP + 8) !== 0 && read8(c, SETUP + 9) !== 1
          && read8(c, SETUP + 32 + owner) === read8(c, SETUP + 32 + f)) continue;
        const dx = reads16(c, thing + 58) - reads16(c, rec);
        const dy = reads16(c, thing + 60) - reads16(c, rec + 2);
        const dz = reads16(c, thing + 62) - reads16(c, rec + 4);
        const apart = Math.abs(dx) + Math.abs(dy);
        if (apart < shortest && u16(read16(c, rec + 20) - 252) > 3) { shortest = apart; nearest = f; }
        if (Math.abs(dx) > 255 || Math.abs(dy) > 255 || Math.abs(dz) > 7) continue;
        if (read8(c, 0x0300138C) !== 0) {
          const player = read32(c, PLAYER);
          if (owner !== player && (owner !== player + 2 || read8(c, SETUP + 28 + owner) === 0)) continue;
        }
        if (Math.abs(dz) > 23) continue;
        write8(c, record(owner) + 236, 1);
        shortest = 0;
        break;
      }
      if (nearest !== 255) {
        const rec = record(nearest);
        write16(c, thing + 8, reads16(c, thing + 58) < reads16(c, rec)
          ? read16(c, thing + 8) + 4 : read16(c, thing + 8) - 4);
        write16(c, thing + 10, reads16(c, thing + 60) < reads16(c, rec + 2)
          ? read16(c, thing + 10) + 4 : read16(c, thing + 10) - 4);
        write16(c, thing + 8, reads16(c, thing + 8) > 64 ? 64 : (reads16(c, thing + 8) < -64 ? -64 : read16(c, thing + 8)));
        write16(c, thing + 10, reads16(c, thing + 10) > 64 ? 64 : (reads16(c, thing + 10) < -64 ? -64 : read16(c, thing + 10)));
      }
    }
    if (kind === 121) stepAmySet(c, thing, k);
    if (THING_STEPS_LATER.has(kind)) notPorted('0800CEC8', `the steps of a thing of kind ${kind} after it moves`);
    thingHit(c, k, read16(c, thing + 56));
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
  c.afterWait = trainingAfterWait;   // 0x080006d0
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

export {
  trainingFrame, forgetKeys, readAllKeys, readNextKeys, dummyKeys, padFacing, fighterThink,
  runScript, setState, meetWalls, moveFighter, takeHits, holdHits, reachOthers, readFighterKeys, fighterAct, landOrFall,
  updateThings, followFighter, queueEffect, stepFade, endFade, nextRandom,
};
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
export { queueEffect as fn0801fcd8, playQueuedEffects as fn0801fc60 };
export { stepFade as fn080205d0 };
export { endFade as fn08020944 };
export { nextRandom as fn08020144 };
