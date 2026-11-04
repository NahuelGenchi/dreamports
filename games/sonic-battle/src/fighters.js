// A fight's fighters as they load and draw, rewritten from the original's instructions, with the decompilation's
// src/unknown_080007fc.c as a guide: their records and colours, the frames of their animations copied to VRAM, the
// four sprites and the shadow each one queues, and the effects they start.
//
// Everything is in work RAM at the original's addresses (bus.js). The cartridge's tables stay there, read by address.

import { queueCopy } from './core.js';
import { read8, read16, reads8, reads16, read32, write8, write16, write32, copy16, s16, u16 } from './bus.js';
import { fn08017f00, fn0801816c, fn08018204, fn08018390 } from './sprites.js';

// the fight's setup: each fighter's character and whether it wears its other colours
const SETUP = 0x03001620, CHARACTER = SETUP + 20, OTHER_COLOURS = SETUP + 24;
const THE_PLAYER = 0x03001380, LINKED = 0x0300138C, VBLANKS = 0x03001378, FACING = 0x03001370;

// the fighters' records, each 252 bytes, with a copy of its 16 colours inside
const FIGHTERS = 0x03001C40, FIGHTER_SIZE = 252, COLOURS = 0x03001D0C;
const fighter = i => FIGHTERS + i * FIGHTER_SIZE;
const coloursOf = i => COLOURS + i * FIGHTER_SIZE;
const SPRITE_PALETTES = 0x05000200, TILES = 0x06010000;

// what each player has chosen, 156 bytes each, with the two sets of colours it can wear
const CHOICES = 0x030013B0, CHOICE_SIZE = 156, COLOUR_SET = 150, COLOUR_SET_SIZE = 27;
const SPARE_COLOURS = 0x0847AA18;

// each character's frames: its own sheet, and the sheet it uses in its other colours
const SHEETS = [
  [0x0847AFD8, 0x08787D18], [0x08528418, 0x08835158], [0x084CADF8, 0x087D7B38],
  [0x0858D838, 0x0889A578], [0x085F3E58, 0x08900B98], [0x08636478, 0x089431B8],
  [0x086F6AB8, 0x08A037F8], [0x08681A98, 0x0898E7D8], [0x087336D8, 0x08A40418],
];
const SHEET_9 = 0x08787D18;
const FRAME_BYTES = 1152;

// the animations a player is running (0x08015924), each by player
const ANIM_ID = 0x030030F8, ANIM_SET = 0x03003120, ANIM_COUNT = 0x03003108, ANIM_CURSOR = 0x03003110;
const ANIM_OFFSET_X = 0x03003100, ANIM_OFFSET_Y = 0x03003118, ANIM_SCRIPTS = 0x08ED68A8;

// the effects: 12 records, 68 bytes each, and the 27 sprite slots they take
const EFFECTS = 0x030017D0, EFFECT_SIZE = 68, EFFECT_COUNT = 12, SLOTS = 0x030028C0, SLOT_COUNT = 27;
const LAST_EFFECT = 0x03002684, EFFECT_SIZES = 0x0806B414;

// the records at 0x03003db0, 24 bytes each, which seem to be the computer players'
const BRAINS = 0x03003DB0, BRAIN_SIZE = 24, LEVEL = 0x03003E10, SEED = 0x0300019C;
const brain = i => BRAINS + i * BRAIN_SIZE;

/** 0x080016c4: a player's chosen colours over the fighter's colours 3 to 13. */
export function chosenColours(c, i) {
  const choice = CHOICES + i * CHOICE_SIZE;
  const set = read8(c, choice + COLOUR_SET) * COLOUR_SET_SIZE + choice;
  // colours 3 to 6 are picked by the set's byte 93, 7 to 10 by byte 94, and 11 to 13 by byte 95
  const from = n => (n <= 6 ? 93 : n <= 10 ? 94 : 95);
  for (let n = 3; n <= 13; n++) {
    const row = read8(c, set + from(n));
    write16(c, coloursOf(i) + n * 2, read16(c, SPARE_COLOURS + (row * 16 + n) * 2));
  }
}

const CHARACTER_COLOURS = [
  0x0847AFB8, 0x085283F8, 0x084CADD8, 0x0858D818, 0x085F3E38, 0x08636458, 0x086F6A98, 0x08681A78, 0x087336B8,
];
const COLOURS_19 = 0x087822D8, COLOURS_9_10 = 0x08787CF8, COLOURS_12_TO_16 = 0x0847AB78, COLOURS_17_18 = 0x0847AB58;

/** 0x0800186c: every fighter's 16 colours into its record, from its character. */
export function loadColours(c) {
  for (let i = 0; i < 4; i++) {
    const who = read8(c, CHARACTER + i), other = read8(c, OTHER_COLOURS + i), to = coloursOf(i);
    if (who <= 10 || who === 19) {
      if (other === 0) {
        if (who <= 8) copy16(c, CHARACTER_COLOURS[who], to, 16);
        else if (who === 19) copy16(c, COLOURS_19, to, 16);
        if (who === 9 || who === 10) {
          copy16(c, COLOURS_9_10, to, 16);
          const choice = CHOICES + i * CHOICE_SIZE;
          const row = read8(c, choice + read8(c, choice + COLOUR_SET) * COLOUR_SET_SIZE + 89);
          write16(c, fighter(i) + 232, read16(c, SPARE_COLOURS + (row * 16 + 14) * 2));
          write16(c, fighter(i) + 234, read16(c, SPARE_COLOURS + (row * 16 + 15) * 2));
          chosenColours(c, i);
        }
      } else if (other === 1) {
        copy16(c, COLOURS_9_10, to, 16);
        write16(c, to + 28, read16(c, SPARE_COLOURS + 28 + i * 32));
        write16(c, to + 30, read16(c, SPARE_COLOURS + 30 + i * 32));
      } else {
        copy16(c, COLOURS_12_TO_16, to, 16);
      }
    } else if (who >= 12 && who <= 16) {
      copy16(c, COLOURS_12_TO_16, to, 16);
    } else if (who === 17 || who === 18) {
      copy16(c, COLOURS_17_18, to, 16);
    }
  }
}

/**
 * 0x08000cf4: a fighter's character kept, and its colours to the display: on V-blanks with bit 2 set, when `flash` asks
 * and it's in play, brighter (red and green twice, blue three times, up to 31), or else as they are. The first colour
 * of the brighter set, which the sprites never show, is whatever the stack held, here 0.
 */
export function showColours(c, i, character, flash) {
  const f = fighter(i), to = SPRITE_PALETTES + i * 32;
  write8(c, f + 196, character);
  const state = read16(c, f + 20);
  if ((flash & 0xFF) !== 0 && (read16(c, VBLANKS) & 4) !== 0 && state !== 254 && state !== 255) {
    write16(c, to, 0);
    for (let n = 1; n <= 15; n++) {
      const v = read16(c, coloursOf(i) + n * 2);
      const a = Math.min(((v >> 10) & 31) * 2, 31), b = Math.min(((v >> 5) & 31) * 2, 31), d = Math.min((v & 31) * 3, 31);
      write16(c, to + n * 2, (a << 10) | (b << 5) | d);
    }
    write8(c, f + 150, 1);
  } else {
    copy16(c, coloursOf(i), to, 16);
  }
}

/** 0x080007fc: a fighter's record as a round starts. */
export function resetFighter(c, i) {
  const f = fighter(i);
  const bytes0 = [
    36, 16, 17, 18, 50, 143, 142, 145, 146, 159, 102, 107, 106, 108, 112, 109, 110, 113, 126, 185, 186, 187, 192, 28, 29,
    30, 199, 156, 157, 158, 138, 188, 190, 172, 198, 151, 244,
  ];
  const halves0 = [
    32, 34, 38, 40, 42, 44, 46, 48, 52, 160, 162, 96, 98, 100, 104, 194, 24, 26, 54, 62, 56, 64, 58, 66, 60, 68, 166, 168,
    170, 174, 176, 240, 242,
  ];
  for (const at of bytes0) write8(c, f + at, 0);
  for (const at of halves0) write16(c, f + at, 0);
  for (const at of [180, 72, 76, 80, 84, 116, 120]) write32(c, f + at, 0);
  for (let n = 0; n <= 9; n++) write8(c, f + 128 + n, 0);
  write16(c, f + 20, 6);
  write8(c, f + 37, 4);
  write16(c, f + 4, 80);
  write16(c, f + 10, 80);
  write8(c, f + 184, 2);
  write16(c, f + 164, 0xFFF);
  write8(c, f + 124, 255);
  write8(c, f + 125, 255);
  write8(c, f + 191, read16(c, 0x03001B28));
  write8(c, f + 23, read8(c, f + 196));
  write8(c, f + 127, 15);
  write32(c, f + 180, read32(c, f + 180) & 0xFFBFFFFF);
  const player = read32(c, THE_PLAYER);
  if (read8(c, LINKED) === 0 || i === player || (i === player + 2 && read8(c, 0x0300163C + i) !== 0)) {
    write8(c, f + 199, 12);
  }
}

/** 0x08017964: a fighter's ten counters of each of three kinds, and two more, cleared. */
export function clearFighterCounters(c, i) {
  const at = 0x03001B30 + i * 64;
  write8(c, at + 60, 0);
  for (let n = 0; n <= 9; n++) {
    write16(c, at + n * 2, 0);
    write16(c, at + 20 + n * 2, 0);
    write16(c, at + 40 + n * 2, 0);
  }
  for (let n = 0; n < 4; n++) write16(c, fighter(n) + 200, 0);
}

/** 0x08000a2c: all four fighters at the round's start, in the arena's starting places (the table at 0x0806b2fc). */
export function resetFighters(c) {
  for (let i = 0; i < 4; i++) clearFighterCounters(c, i);
  write16(c, 0x03001B28, 100);
  for (let i = 0; i < 4; i++) resetFighter(c, i);
  const places = 0x0806B2FC + read8(c, 0x03002CB0) * 16;
  for (let i = 0; i < 4; i++) {
    const f = fighter(i);
    for (const at of [147, 149, 150, 144, 154, 155, 141, 236]) write8(c, f + at, 0);
    for (const at of [152, 238]) write16(c, f + at, 0);
    const x = read16(c, places + i * 4), y = read16(c, places + i * 4 + 2);
    write16(c, f, x);
    write16(c, f + 6, x);
    write16(c, f + 2, y);
    write16(c, f + 8, y);
    // the first and third fighters start facing one way, the others the other
    const even = (i & 1) === 0;
    write8(c, f + 36, even ? 6 : 4);
    write8(c, f + 37, even ? 6 : 4);
    write8(c, f + 16, even ? 1 : 0);
    write8(c, f + 18, even ? 1 : 0);
  }
}

/** 0x080069ac: the sheet of frames each fighter draws from, its colours shown, and the frames each asked for queued. */
export function loadFighterFrames(c) {
  for (let i = 0; i < 4; i++) {
    if (read8(c, CHARACTER + i) === 255) continue;
    const f = fighter(i), character = read8(c, f + 196), sheet = f + 248;
    if (read8(c, OTHER_COLOURS + i) === 0) {
      if (character <= 8) write32(c, sheet, SHEETS[character][0]);
      else if (character === 19) write32(c, sheet, 0x087822F8);
      else if (character === 10 || (character >= 12 && character <= 16)) write32(c, sheet, SHEET_9);
      else if (character === 17 || character === 18) write32(c, sheet, SHEETS[7][0]);
      else {
        // any other character: the sheet of the one its record's byte 22 picks from the player's choices
        const copied = read8(c, CHOICES + i * CHOICE_SIZE + reads8(c, f + 22));
        if (copied <= 8) write32(c, sheet, SHEETS[copied][1]);
        else if (copied <= 11) write32(c, sheet, SHEET_9);
        else if (copied >= 20 && copied <= 28) write32(c, sheet, SHEETS[copied - 20][1]);
      }
    } else if (character <= 8) {
      write32(c, sheet, SHEETS[character][1]);
    }
    if (read8(c, f + 149) & 1) {
      showColours(c, i, read8(c, f + 196), 1);
    } else if (read8(c, f + 150) !== 0) {
      showColours(c, i, read8(c, f + 196), 0);
      write8(c, f + 150, 0);
    }
    if (read8(c, SETUP + 135) !== 0) {
      write8(c, f + 147, 0);
      write8(c, f + 149, 0);
      showColours(c, i, read8(c, f + 196), 0);
      write8(c, f + 150, 0);
    }
  }
  for (let i = 0; i < 4; i++) {
    const asked = read16(c, fighter(i) + 164);
    if (asked !== 0xFFF) queueFighterFrame(c, read32(c, fighter(i) + 248), i, asked);
  }
  for (let i = 0; i < 4; i++) write16(c, fighter(i) + 164, 0xFFF);
}

/** 0x08006e64: the effect each fighter asked for this frame started, ahead of it by its reach along where it's facing. */
export function startFighterEffects(c) {
  for (let i = 0; i < 4; i++) {
    const f = fighter(i), effect = read16(c, f + 170);
    if (effect === 0 || read8(c, CHARACTER + i) === 255) continue;
    const mode = read8(c, f + 36), reach = read16(c, f + 166);
    let dx = 0, dy = 0;
    if (mode === 4) dx = reach;
    else if (mode === 6) dx = -reach;
    else if (mode === 8) dy = reach;
    else if (mode === 2) dy = -reach;
    else if (mode <= 9) {
      const facing = read8(c, f + 16), way = read8(c, f + 159), sign = facing === 0 ? 1 : -1;
      if (way === 0) dx = sign * reach;
      else if (way === 1) dx = -sign * reach;
      else if (way === 2) dy = sign * reach;
      else if (way === 3) dy = -sign * reach;
    }
    startEffect(
      c, effect, mode, s16(s16(dx) + read16(c, f)), s16(s16(dy) + read16(c, f + 2)),
      s16(read16(c, f + 168) + read16(c, f + 4)), 0, 0, 0, read8(c, f + 172), i, read8(c, f + 149),
    );
    write8(c, f + 172, 0);
    write16(c, f + 170, 0);
  }
}

/** 0x08006ff4: the first `count` fighters' sprites and shadows queued, each turned to face as the camera now looks. */
export function drawFighters(c, count) {
  // the entry on the original's stack keeps what it was given from one fighter to the next; its priority and its mode
  // are never set, and neither is read for these kinds or before 0x08017690 writes them
  let height = 0, palette = 0, flip = 0;
  const player = read32(c, THE_PLAYER);
  for (let i = 0; i < (count & 0xFF); i++) {
    const f = fighter(i), state = read16(c, f + 20), other = read8(c, f + 23);
    const hidden = state === 254 || (state === 255 && i !== player) || (other === 2 && state === 278 && i !== player)
      || (other === 3 && state === 0x115 && i !== player) || read8(c, CHARACTER + i) === 255;
    if (!hidden) {
      let [x, y] = fn0801816c(c, 0, 0, reads16(c, f), reads16(c, f + 2));
      [x, y] = fn08018204(c, 0, 0, x, y);
      const depth = u16(y - 6), shadowX = u16(x - 16), shadowY = u16(y - 4);
      const facing = read8(c, f + 16);
      if (facing === 0) {
        x = s16(x - (read16(c, f + 160) + 24));
        y = s16(read16(c, f + 162) - 40 + y);
      } else if (facing === 1) {
        x = s16(x + (read16(c, f + 160) - 24));
        y = s16(read16(c, f + 162) - 40 + y);
      }
      write16(c, f + 12, x);
      write16(c, f + 14, y - read16(c, f + 4));
      const top = read8(c, 0x030016D0) - 64, bottom = read8(c, 0x030017C0);
      const send = (sx, sy, tile, kind) => fn08017f00(
        c, u16(sx) | (u16(sy) << 16), height | (depth << 16), u16(tile), palette | (kind << 8) | (flip << 24),
      );
      const across = u16(x + 64) <= 304, lifted = reads16(c, f + 14);
      if (across && lifted <= bottom && lifted >= top) {
        palette = i;
        flip = read8(c, f + 16);
        height = read16(c, f + 4);
        const tile = i * 36;
        if (flip === 0) {
          send(x, y, tile, 11);
          send(x, y + 32, tile + 16, 12);
          send(x + 32, y, tile + 24, 13);
          send(x + 32, y + 32, tile + 32, 14);
        } else if (flip === 1) {
          send(x, y, tile + 24, 13);
          send(x, y + 32, tile + 32, 14);
          send(x + 16, y, tile, 11);
          send(x + 16, y + 32, tile + 16, 12);
        }
      }
      if (across && y <= bottom && y >= top && read16(c, f + 20) !== 255) {
        const over = reads16(c, f + 4), ground = reads16(c, f + 52);
        const size = over < ground + 20 ? 0 : over < ground + 40 ? 1 : over < ground + 60 ? 2 : 3;
        height = read16(c, f + 52);
        palette = 4;
        send(shadowX, shadowY, size * 8 + 144, 20);
      }
    }
    write8(c, f + 17, read8(c, f + 16));
    write8(c, f + 16, read8(c, f + 18));
    const remote = read16(c, f + 20) === 55 && read8(c, LINKED) !== 0 && i !== player
      && !(i === player + 2 && read8(c, 0x0300163C + i) !== 0);
    if (remote) continue;
    const mode = read8(c, f + 36), view = read8(c, FACING);
    if (view === 0 || view === 1) {
      if (mode === 4 || mode === 7 || mode === 1) write8(c, f + 18, view);
      else if (mode === 6 || mode === 9 || mode === 3) write8(c, f + 18, view ^ 1);
    } else if (view === 2 || view === 3) {
      if (mode >= 1 && mode <= 3) write8(c, f + 18, view - 2);
      else if (mode >= 7 && mode <= 9) write8(c, f + 18, 3 - view);
    }
  }
  loadFighterFrames(c);
}

/** 0x0800673c: what the camera follows for fighter `i`: the fighter, or the point between it and its partner, and which way it faces. */
export function followFighter(c, i) {
  if ((i & 0xFF) > 3) return;
  const f = fighter(i), partner = read8(c, f + 125);
  const known = partner <= 3, p = known ? fighter(partner) : 0;
  if (read8(c, f + 110) !== 0) {
    if (known) {
      write16(c, 0x03001374, (reads16(c, f) + reads16(c, p)) >> 1);
      write16(c, 0x03001B24, (reads16(c, f + 2) + reads16(c, p + 2)) >> 1);
    }
    write16(c, 0x03002100, read16(c, f + 4) << 1);
  } else {
    if (read8(c, f + 112) !== 0) {
      if (known) {
        const higher = reads16(c, f + 4) > reads16(c, p + 4) ? f : p;
        write16(c, 0x03002100, read16(c, higher + 4) << 1);
      }
    } else {
      write16(c, 0x03002100, read16(c, f + 4) << 1);
    }
    write16(c, 0x03001374, read16(c, f));
    write16(c, 0x03001B24, read16(c, f + 2));
  }
  const angle = fn08018390(c);
  if (u16(angle - 0x400) > 0x1800) write8(c, FACING, 0);
  else if (u16(angle - 0x401) <= 0x7FE) write8(c, FACING, 2);
  else if (u16(angle - 0xC01) <= 0x7FE) write8(c, FACING, 1);
  else if (u16(angle - 0x1401) <= 0x7FE) write8(c, FACING, 3);
}

/**
 * 0x08015924: one step of the script of a character's animation: a marker's frame number has come, so its commands run,
 * up to the next marker. Returns 1 while it runs, 0 when it starts over, and 255 when it runs off its end. The script is
 * words: 0xFFF0nnnn marks frame n, 0x1000nnnn copies picture n to `tiles`, 0x1100nnnn and 0x1200nnnn set its offsets,
 * and 0x00F0 and 0xFFFE end it.
 */
export function stepAnimation(c, set, id, loops, tiles, player) {
  const two = player * 2;
  let character = set & 0xFF;
  const copying = character === 9;
  if (copying) character = read8(c, CHOICES + player * CHOICE_SIZE + slotOfAnimation(c, id));
  const script = read32(c, ANIM_SCRIPTS + slotOfAnimation(c, id) * 4 + character * 280);
  if (read16(c, ANIM_ID + two) !== u16(id) || read8(c, ANIM_SET + player) !== character || reads16(c, ANIM_COUNT + two) === 0) {
    write16(c, ANIM_ID + two, id);
    write8(c, ANIM_SET + player, character);
    write16(c, ANIM_COUNT + two, 0);
    write16(c, ANIM_CURSOR + two, 0);
    write16(c, ANIM_OFFSET_X + two, 0);
    write16(c, ANIM_OFFSET_Y + two, 0);
  }
  const counted = () => { write16(c, ANIM_COUNT + two, read16(c, ANIM_COUNT + two) + 1); return 1; };
  if (reads16(c, ANIM_COUNT + two) < 0) return counted();
  const word = () => read32(c, script + read16(c, ANIM_CURSOR + two) * 4);
  const MARKER = 0xFFF0;
  while (word() >>> 16 !== MARKER) {
    write16(c, ANIM_CURSOR + two, read16(c, ANIM_CURSOR + two) + 1);
    if (read16(c, ANIM_CURSOR + two) > 254) return 255;
  }
  if ((word() & 0xFFFF) !== reads16(c, ANIM_COUNT + two)) return counted();
  write16(c, ANIM_CURSOR + two, read16(c, ANIM_CURSOR + two) + 1);
  if (word() >>> 16 === MARKER) return counted();
  for (;;) {
    const command = word(), kind = command >>> 16, value = command & 0xFFFF;
    if (kind === 0x1100) write16(c, ANIM_OFFSET_X + two, value);
    else if (kind === 0x1200) write16(c, ANIM_OFFSET_Y + two, value);
    else if (kind === 0x00F0 || kind === 0xFFFE) {
      const restarted = reads16(c, ANIM_COUNT + two) !== 0;
      write16(c, ANIM_CURSOR + two, 0);
      write16(c, ANIM_COUNT + two, 1 - (loops & 0xFF));
      return restarted ? 0 : 255;
    } else if (kind === 0x1000) {
      const other = read8(c, OTHER_COLOURS + player) !== 0 || copying;
      let sheet = 0;
      const row = character >= 20 ? character - 20 : character;
      if (row <= 8 && character <= 28) sheet = SHEETS[row][other ? 1 : 0];
      else if (character === 9 || character === 10) sheet = SHEET_9;
      const frame = s16(value);
      if (character === 1 && u16(id) === 19) {
        write16(c, ANIM_OFFSET_X + two, read16(c, 0x08055800 + frame * 2 - 0x158) - 8);
        write16(c, ANIM_OFFSET_Y + two, read16(c, 0x0805587E + frame * 2 - 0x158));
      } else if (character === 1 && u16(id) === 20) {
        write16(c, ANIM_OFFSET_X + two, read16(c, 0x08055994 + frame * 2 - 0x1D8) - 8);
        write16(c, ANIM_OFFSET_Y + two, read16(c, 0x080559D8 + frame * 2 - 0x1D8));
      } else if (character === 2 && u16(id) === 21) {
        write16(c, ANIM_OFFSET_X + two, read16(c, 0x080576E8 + frame * 2 - 0x170));
      }
      queueFrameAtTile(c, sheet, tiles, value);
    }
    write16(c, ANIM_CURSOR + two, read16(c, ANIM_CURSOR + two) + 1);
    if (read16(c, ANIM_CURSOR + two) > 254) return 255;
    if (word() >>> 16 === MARKER) return counted();
  }
}

/** 0x0800b098: an animation's slot in each character's table of scripts, which the cartridge's own switch gives. */
export function slotOfAnimation(c, id) {
  const animation = u16(id);
  if (animation > 0x235) return noSlot();
  // each case of its jump table starts with `mov r0, #slot`
  return read16(c, read32(c, 0x0800B0BC + animation * 4)) & 0xFF;
}

/** 0x0800baa4: the switch's own default. */
export const noSlot = () => 0;

/** 0x0800baac: an effect's record cleared, with the sprite slots it held let go. */
export function clearEffect(c, n) {
  const e = EFFECTS + (n & 0xFF) * EFFECT_SIZE;
  for (let slot = 0; slot < 4; slot++) {
    const held = read8(c, e + slot);
    if (held !== 255) write8(c, SLOTS + held, 0);
    write8(c, e + slot, 255);
  }
  write8(c, e + 52, 255);
  for (const at of [4, 64, 5, 6, 16, 17, 24, 51, 65, 66]) write8(c, e + at, 0);
  for (const at of [8, 10, 12, 14, 58, 60, 62, 18, 20, 22, 34, 42, 36, 44, 38, 46, 40, 48, 56]) write16(c, e + at, 0);
  for (const at of [26, 28, 30, 32]) write16(c, e + at, 0xFFFF);
  write8(c, e + 53, 8);
  write8(c, e + 50, 1);
}

/** 0x0800fd8c: every effect cleared, and every sprite slot free. */
export function clearEffects(c) {
  for (let n = 0; n < EFFECT_COUNT; n++) clearEffect(c, n);
  for (let slot = 0; slot < SLOT_COUNT; slot++) write8(c, SLOTS + slot, 0);
  write8(c, LAST_EFFECT, 0);
}

/**
 * 0x0800c1c8: an effect started in the first free record from the last one on, with as many free sprite slots as it needs,
 * and its owner's count of effects raised for those the cartridge's jump table at 0x0800c3c4 sends to the count.
 */
export function startEffect(c, effect, mode, x, y, height, a, b, d, e, owner, f) {
  const id = u16(effect), who = owner & 0xFF, sizes = EFFECT_SIZES + id;
  for (let n = read8(c, LAST_EFFECT); n <= 11; n++) {
    const r = EFFECTS + n * EFFECT_SIZE;
    if (read16(c, r + 56) !== 0) continue;
    let taken = 0;
    for (let slot = 0; slot <= 27 - read8(c, sizes);) {
      if (read8(c, SLOTS + slot) === 0) {
        write8(c, r + taken, slot);
        write8(c, SLOTS + slot, 1);
        taken = (taken + 1) & 0xFF;
      }
      const need = read8(c, sizes);
      if (taken === need) slot = (28 - need) & 0xFF;
      slot = (slot + 1) & 0xFF;
    }
    write8(c, r + 52, 255);
    write8(c, r + 4, 0);
    write8(c, r + 5, read8(c, fighter(who) + 16));
    write8(c, r + 6, 0);
    write16(c, r + 8, a);
    write16(c, r + 10, b);
    write16(c, r + 12, d);
    write16(c, r + 14, 0);
    write16(c, r + 58, x);
    write16(c, r + 60, y);
    write16(c, r + 62, height);
    for (const at of [16, 17, 24, 54, 55, 66]) write8(c, r + at, 0);
    for (const at of [18, 20, 22, 34, 42, 36, 44, 38, 46, 40, 48]) write16(c, r + at, 0);
    for (const at of [26, 28, 30, 32]) write16(c, r + at, 0xFFFF);
    write8(c, r + 50, read8(c, sizes));
    write8(c, r + 53, who);
    write8(c, r + 51, e);
    write16(c, r + 56, id);
    write8(c, r + 64, mode);
    write8(c, r + 65, f);
    write8(c, LAST_EFFECT, n);
    break;
  }
  const THE_COUNT = 0x0800C704, COUNTS = SETUP + 58;
  if (id >= 38 && id - 38 <= 207 && read32(c, 0x0800C3C4 + (id - 38) * 4) === THE_COUNT) {
    write16(c, COUNTS + who * 2, read16(c, COUNTS + who * 2) + 1);
  }
}

/** 0x08007e24: the colours and the tiles every fight's sprites share, to the display. */
export function loadSharedSprites(c) {
  copy16(c, 0x0847AB98, 0x05000280, 0x10);
  copy16(c, 0x0847ABB8, 0x06011200, 0x80);
  copy16(c, 0x0847ACB8, 0x06011300, 0x80);
  copy16(c, 0x0847ADB8, 0x06011400, 0x80);
  copy16(c, 0x0847AEB8, 0x06011500, 0x80);
}

/** 0x08007e9c: the first 69 bytes of player `i`'s choices all 9. */
export function clearChoices(c, i) {
  const at = CHOICES + (i & 0xFF) * CHOICE_SIZE;
  for (let n = 0; n <= 68; n++) write8(c, at + n, 9);
}

/** 0x08015f6c: all 128 entries of the sprite queue cleared. */
export function zeroQueue(c) {
  for (let at = 0; at < 128 * 16; at += 4) write32(c, 0x030033E0 + at, 0);
}

/** 0x08012b60: the 64 records at 0x03002cd0 cleared, in the fields they use, and the flag at 0x030030f4. */
export function clearHudRecords(c) {
  write8(c, 0x030030D0 + 36, 0);
  for (let n = 0; n <= 63; n++) {
    const at = 0x03002CD0 + n * 16;
    for (const half of [0, 2, 6, 8]) write16(c, at + half, 0);
    write8(c, at + 12, 0);
    write8(c, at + 13, 0);
  }
}

/** 0x0801ce70: the eight bytes at 0x03003d88 cleared. */
export function clearBrainFlags(c) {
  for (let n = 0; n < 8; n++) write8(c, 0x03003D88 + n, 0);
}

/** 0x08020144: the next random number. */
export function random(c) {
  const next = (Math.imul(read32(c, SEED), 0x14FA05) + 0xC0AF) | 0;
  write32(c, SEED, next);
  return next;
}

/** 0x08020160: 1 if a roll of 0 to 99 comes to `chance` or less. */
export function rollChance(c, chance) {
  const roll = ((random(c) & 0xFFFF) * 100) >>> 16;
  return roll > chance >>> 0 ? 0 : 1;
}

/** 0x0801d870: a computer player back to its first thought (the callback 0x0801d8f4), kept as its address. */
export function resetBrain(c, i) {
  const r = brain(i & 0xFF);
  write32(c, r, 0x0801D8F5);
  write16(c, r + 8, 0);
  write8(c, r + 12, 0);
  write8(c, r + 13, 0);
  write8(c, r + 18, rollChance(c, read16(c, 0x0807125A + read8(c, LEVEL) * 2)) !== 0 ? 1 : 0);
  write32(c, r + 4, 0x08ED898C);
  write8(c, r + 14, 0);
  write8(c, r + 16, read8(c, fighter(i & 0xFF) + 16));
}

/** 0x0801e9ec: a computer player's wait until it next acts, at random up to twice its level's, and it starts again. */
export function restartBrain(c, i) {
  const number = random(c), base = read16(c, 0x08071250 + read8(c, LEVEL) * 2);
  write16(c, brain(i & 0xFF) + 10, base + (((number & 0xFFF) * base) >>> 12));
  resetBrain(c, i);
}

// the BIOS's ArcTan and ArcTan2 (swi 10, called through 0x0804a590), as a 16-bit angle
function arcTan(i) {
  const a = -(Math.imul(i, i) >> 14);
  let b = (Math.imul(0xA9, a) >> 14) + 0x390;
  for (const next of [0x91C, 0xFB6, 0x16AA, 0x2081, 0x3651, 0xA2F9]) b = (Math.imul(b, a) >> 14) + next;
  return Math.imul(i, b) >> 16;
}
function arcTan2(x, y) {
  if (y === 0) return x >= 0 ? 0 : 0x8000;
  if (x === 0) return y >= 0 ? 0x4000 : 0xC000;
  const over = (n, d) => Math.trunc((n << 14) / d);
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return arcTan(over(y, x)) & 0xFFFF; }
    else if (-x >= y) return (arcTan(over(y, x)) + 0x8000) & 0xFFFF;
    return (0x4000 - arcTan(over(x, y))) & 0xFFFF;
  }
  if (x <= 0) { if (-x > -y) return (arcTan(over(y, x)) + 0x8000) & 0xFFFF; }
  else if (x >= -y) return arcTan(over(y, x)) & 0xFFFF;
  return (0xC000 - arcTan(over(x, y))) & 0xFFFF;
}

/** 0x0801e99c: which way a computer player's target lies, one of the 16 in the cartridge's table at 0x08ed8ad4. */
export function wayToTarget(c, i) {
  const who = i & 0xFF, offset = read8(c, brain(who) + 15) * 2 + who * FIGHTER_SIZE;
  const angle = arcTan2(reads16(c, FIGHTERS + 54 + offset), reads16(c, FIGHTERS + 62 + offset));
  return read8(c, 0x08ED8AD4 + (angle >> 12));
}

/** 0x0801f024: the level of the computer players. */
export function setBrainLevel(c, level) {
  write8(c, LEVEL, level);
}

/** 0x08020440: frame `frame` of a sheet copied just after the next V-blank, to tile `tile` on. */
export function queueFrameAtTile(c, sheet, tile, frame) {
  queueCopy(c, TILES + u16(tile) * 32, sheet + u16(frame) * FRAME_BYTES, FRAME_BYTES);
}

/** 0x0802047c: frame `frame` of a sheet copied just after the next V-blank, to fighter `slot`'s tiles. */
export function queueFighterFrame(c, sheet, slot, frame) {
  queueCopy(c, TILES + (slot & 0xFF) * FRAME_BYTES, sheet + u16(frame) * FRAME_BYTES, FRAME_BYTES);
}

export { resetFighter as fn080007fc, resetFighters as fn08000a2c, showColours as fn08000cf4, chosenColours as fn080016c4 };
export { loadColours as fn0800186c, followFighter as fn0800673c, loadFighterFrames as fn080069ac };
export { startFighterEffects as fn08006e64, drawFighters as fn08006ff4, loadSharedSprites as fn08007e24 };
export { clearChoices as fn08007e9c, slotOfAnimation as fn0800b098, noSlot as fn0800baa4, clearEffect as fn0800baac };
export { startEffect as fn0800c1c8, clearEffects as fn0800fd8c, clearHudRecords as fn08012b60 };
export { stepAnimation as fn08015924, zeroQueue as fn08015f6c, clearFighterCounters as fn08017964 };
export { clearBrainFlags as fn0801ce70, resetBrain as fn0801d870, wayToTarget as fn0801e99c, restartBrain as fn0801e9ec };
export { setBrainLevel as fn0801f024, random as fn08020144, rollChance as fn08020160 };
export { queueFrameAtTile as fn08020440, queueFighterFrame as fn0802047c };
