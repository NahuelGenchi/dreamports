// A fight's opening, in Training mode: the arena, both fighters, their gauges and the choice of special attacks, until a
// player can move. The fight's functions share their state in work RAM at the original's addresses (bus.js), so what
// one sets the next reads, as in the original.
//
// Nothing before a fight leads here yet, so a recording's start point opens it: the address's fight=training says so,
// and vblanks= gives how many V-blanks the console has counted by then, which the view turns with during the choice.

import { fightVblank, hideSpriteBuffer, newScreen, queueRegister } from './core.js';
import { clock, read8, read16, write8, write16, write32 } from './bus.js';
import { fn08016684, fn080175d4, fn080176e4, fn08017c5c, fn08017d58, fn08017ed0, fn08017f58, fn08017f6c, fn080182ac, fn080182e4, fn08018300, fn08018318 } from './sprites.js';
import { fn08000a2c, fn08000cf4, fn0800186c, fn08006ff4, fn08007e24, fn08007e9c, fn0800fd8c, fn08015f6c, fn08017964, fn0801ce70, fn0801e9ec, fn0801f024 } from './fighters.js';
import { fn08012b98, fn08013214, fn08015498, fn0801584c } from './hud.js';
import { fn0800f9c0, fn0800fdc8, fn0801103c, fn08011c7c } from './arena.js';
import { fn0801c28c, fn0801fc60, fn080177b8, fn080205d0, fn08020944 } from './moves.js';

const SETUP = 0x03001620;     // gUnknown_03001620: what the fight is
const PLAYER = 0x03001380;    // gUnknown_03001380: which fighter the player is
const SAVE = 0x03002110;      // gUnknown_03002110: the save
const CHOSEN = 0x03003D98, SONG = 0x03003D94;
const FADE_LEVEL = 0x03004B00, FADE_KIND = 0x03004B04, FADE_STEP = 0x03004B08;
const VIEW = 0x03002040;
const REGISTERS = 0x0816EBEC, REGISTER_COUNT = 16;
const BLDCNT = 0x50, BLDY = 0x54;
const NO_FIGHTER = 255;

const setup = (c, at) => read8(c, SETUP + at);

/** 0x08020840: the colour effect's fade in from black, over `frames` frames. */
function startFadeIn(c, frames) {
  queueRegister(c, BLDCNT, 0xFF);
  queueRegister(c, BLDY, 0x10);
  write16(c, FADE_KIND, 2);
  write16(c, FADE_LEVEL, 0x8000);
  write16(c, FADE_STEP, Math.trunc(0x7FFF / (frames || 1)) || 1);
}

/** 0x080198b0: the fight's counters cleared, the fighters' colours, the arena and the fighters set up. */
function setUpFight(c) {
  write8(c, CHOSEN, 0);
  write8(c, CHOSEN + 4, 0);
  for (let i = 0; i < 4; i++) {
    if (setup(c, 28 + i) === 0 && setup(c, 20 + i) !== NO_FIGHTER) write8(c, CHOSEN + 4, read8(c, CHOSEN + 4) + 1);
  }
  write8(c, SETUP + 136, 0xFF);
  for (let i = 0; i < 4; i++) {
    for (const at of [39, 43, 47, 51, 137]) write8(c, SETUP + at + i, 0);
    for (const at of [58, 66, 74, 82, 90, 98, 106]) write16(c, SETUP + at + i * 2, 0);
    if (setup(c, 12 + i) > 100) write8(c, SETUP + 12 + i, 100);
    if (setup(c, 16 + i) > 100) write8(c, SETUP + 16 + i, 100);
    write8(c, SETUP + 141 + i, setup(c, 12 + i));
    write8(c, SETUP + 145 + i, setup(c, 16 + i));
  }
  write8(c, SETUP + 55, 0);
  write8(c, SETUP + 56, 0);
  write16(c, SETUP + 114, 0);
  write8(c, SETUP + 116, 0);
  write16(c, SETUP + 130, 0);
  write8(c, SETUP + 117, 0);
  write8(c, SETUP + 133, 0);
  write8(c, SETUP + 134, 0);
  write8(c, SETUP + 135, 0);
  write16(c, SETUP + 126, setup(c, 7) * 3608);
  write16(c, SETUP + 128, setup(c, 10) * 30);
  fn08015f6c(c);
  write16(c, VIEW + 12, 0);
  write16(c, VIEW + 8, 0);
  write16(c, VIEW + 10, 0);
  write16(c, 0x03001374, 0);
  write16(c, 0x03001B24, 0);
  for (let i = 0; i < 4; i++) fn08017964(c, i);
  fn0801ce70(c);
  write8(c, 0x03002034, 1);
  fn0800186c(c);
  for (let i = 0; i < 4; i++) if (setup(c, 20 + i) !== NO_FIGHTER) fn08000cf4(c, i, setup(c, 20 + i), 0);
  const arena = setup(c, 3 + setup(c, 1));
  fn0800fdc8(c, arena);
  fn0801103c(c, arena);
  fn08000a2c(c);
  fn0800fd8c(c);
  // the five palettes the fight's effects use, each copied by DMA
  for (let i = 0; i < 5; i++) {
    for (let n = 0; n < 16; n++) write16(c, 0x050002A0 + i * 32 + n * 2, read16(c, 0x08BF2058 + i * 32 + n * 2));
  }
  fn08017f58(c, 0, 160);
  fn0801f024(c, setup(c, 11));
  for (let i = 0; i < 4; i++) fn0801e9ec(c, i);
  for (let i = 0; i < 4; i++) write8(c, 0x03001C40 + 159 + i * 252, 0);
}

/**
 * 0x08019b5c, for a fight that isn't a team's: each fighter's choices cleared, the gauges at nothing, a second fighter
 * of the same character marked to wear its other colours, and the colours loaded with that known.
 */
function setUpFighters(c) {
  if (read8(c, 0x03002600 + 7) === 0) {
    for (let i = 0; i < 4; i++) for (const at of [12, 16, 141, 145]) write8(c, SETUP + at + i, 0);
  }
  for (let i = 0; i < 4; i++) fn08007e9c(c, i);
  for (let i = 0; i < 4; i++) write8(c, SETUP + 24 + i, 0);
  for (let i = 0; i < 3; i++) {
    if (setup(c, 20 + i) > 8) continue;
    for (let j = i + 1; j < 4; j++) {
      if (setup(c, 20 + i) === setup(c, 20 + j)) write8(c, SETUP + 24 + (j === read32Player(c) ? i : j), 1);
    }
  }
  fn0800186c(c);
  for (let i = 0; i < 4; i++) if (setup(c, 20 + i) !== NO_FIGHTER) fn08000cf4(c, i, setup(c, 20 + i), 0);
  fn08007e24(c);
}
const read32Player = c => read8(c, PLAYER);

/** The song of the arena a fight is in, from 0x08019ed8. */
const ARENA_SONGS = [10, 11, 12, 14, 15, 13, 17, 16, 18, 21, 22, 20];

/** 0x0801a898: a frame of the choice of special attacks. The view turns round the arena, and three choices start the fight. */
function choosing(c) {
  if (fn080205d0(c)) {
    fn080177b8(c, read8(c, PLAYER));
    fn08020944(c);
  }
  const answer = fn08015498(c) & 0xFF;
  const chosen = read8(c, CHOSEN);
  if (chosen > 8) {
    write8(c, CHOSEN, 0);
    for (let i = 0; i < 4; i++) fn08017964(c, i);
    if (setup(c, 125) !== 4) throw new Error('0x0801a898: only Training mode is ported.');
    c.callback = fn0801c28c;
  } else if (chosen !== 0) {
    write8(c, CHOSEN, chosen + 1);
  } else if (answer !== 0) {
    write8(c, CHOSEN, 1);
  }
  c.afterWait = choosingAfterWait;   // 0x080006d0
}

/** 0x0801a898 past its wait for the V-blank: the view moves, and the picture is built for the next V-blank to show. */
function choosingAfterWait(c) {
  clock.cycles = 0;
  clock.counting = true;
  fn08018318(c, 0, 0);
  fn080176e4(c, ((c.vblanks & 0xFFFF) << 19) >> 16);
  fn080182e4(c, 0x100);
  fn08018300(c, 0x300);
  const mode = fn0801584c(c);
  fn080182ac(c);
  fn08016684(c);
  fn08017ed0(c);
  fn08013214(c, mode);
  fn08017f6c(c);
  if (mode !== 10) {
    fn08006ff4(c, 4);
    fn0800f9c0(c);
  }
  fn08011c7c(c);
  fn080175d4(c);
  fn08017d58(c);
  fn08017c5c(c);
}

/**
 * The fight's first frame: the values Start on Training's screen leaves with its first choices, 0x0801c82c, the new screen and its fade,
 * and 0x0801c8a4, with 0x08019ed8, which load everything and start the song. In the original these take from the
 * Training screen's fade to the fight's first picture, with the screen black all along.
 */
export function startFight(c, vblanks, action = 0, character = 0) {
  c.vblanks = vblanks;
  c.lineOne = fn0801fc60;
  c.video.pal.fill(0);
  write8(c, SAVE + 119, 1);   // the language the save keeps: English in the USA copy (menu.js)
  for (let i = 0; i < REGISTER_COUNT; i++) {
    write16(c, 0x04000000 + read16(c, REGISTERS + i * 4), read16(c, REGISTERS + i * 4 + 2));
  }
  write8(c, SETUP + 4, 0);
  write8(c, SETUP + 5, 10);
  for (const at of [6, 7, 8, 9, 10, 11]) write8(c, SETUP + at, 0);
  write8(c, SETUP + 36, 2);
  write8(c, SETUP + 20, character);   // Training's first choice, Sonic unless the start point says another
  write8(c, SETUP + 21, NO_FIGHTER);
  write8(c, SETUP + 22, NO_FIGHTER);
  write8(c, SETUP + 23, 0);
  write8(c, SETUP + 1, 0);
  write8(c, SETUP + 2, 1);
  write8(c, SETUP + 3, 0);    // Emerald Beach, Training's first map
  write8(c, SETUP + 38, action);   // the Rival's Action, Do Nothing first
  write8(c, SETUP + 125, 4);
  write8(c, SETUP + 0, 0);
  write32(c, PLAYER, 0);
  hideSpriteBuffer(c);   // 0x0801ff30
  newScreen(c, 6);
  startFadeIn(c, 24);
  fn080205d0(c);
  c.vblankCopies = 1;
  setUpFight(c);
  write8(c, SONG, ARENA_SONGS[setup(c, 3 + setup(c, 1))]);
  fn08012b98(c, 10);
  setUpFighters(c);
  // the sound engine has run a frame for each V-blank by now, which sets when its envelopes step and the two the count
  // starts with are among them, though no song plays in them
  c.sound?.framesGoneBy(vblanks - 2);
  c.sound?.play(read8(c, SONG));
  // the loading runs past a V-blank, which applies what the fade queued
  fightVblank(c);
  c.callback = choosing;
}
