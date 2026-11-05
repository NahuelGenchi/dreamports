// The main menu (CreateMainMenu, 0x08086EB4), which the title screen opens when Start is pressed. The screen fades in from
// black over two layers, a drifting pattern behind and a spinning one in front whose picture changes with the button
// chosen. Four buttons slide in from the right, shaking from side to side in bands of eight lines, with the Chao
// floating in from the left to sit beside the button chosen. Up and Down choose a button, which pulses, and A opens it: the
// buttons slide out and, for the first three, the two choices under it slide in, or the screen fades to black and the next
// one comes. B on the choices goes back to the buttons.
// The same screen opens on other pages (the `initArg1` of CreateMainMenu): the two choices alone, with the Chao's message,
// for the story's or the time attack's, and the time attack's own four buttons. What a recording plays so far is the page
// the title opens, with the three buttons' choices. The rest is written from the original's code and not played yet, nor
// are the secret button, which needs all the emeralds, and the one a record opens.
// Not ported yet: every screen the menu leads to (the character select, the name entry, the options and the title
// screen), so for now the game goes straight to Route 99's overworld.

import { KEY, FLAGS } from './core.js';
import { createSprite, updateSprite, displaySprite, transformSprite } from './sprite.js';
import { drawBackground } from './background.js';
import { sin8, cos8, SINE } from './stage/trig.js';
import { startStage } from './stage/stage.js';
import { REG } from '../../../kit/gba/video.js';

const OBJ_VRAM = 0x10000;
const MUS_MAIN_MENU = 2, MUS_TIME_ATTACK_2 = 0x48, SE_105 = 0x69, SE_SELECT = 0x6A, SE_ABORT = 0x6B, SE_DPAD_SELECT = 0x6C;
const JAPANESE = 0;
const TILE_4BPP = 32, BUTTON_TILES = 0x800;
// where the buttons start and stop, in 1/256ths of a pixel: off the screen to the right, and in their row
const OFF_SCREEN_X = 0x12C00, IN_X = 0xAA00;
// the buttons fly at this many pixels a frame, so 12 (unk7)
const BUTTON_SPEED = 0xC;
// the secret button (the one under the four, which needs every emerald) and the one a record opens
const SECRET_BUTTON = 10;

// the tables of this screen in the ROM (0x0808738C and the functions after it load them): for each button the animation,
// variant and tile count of its two halves by language, the Chao's and its message's, the layers' tilemaps, the keys of
// the secret code and where the Chao's tail sits for each button
const BUTTON_ROWS = 0xD5D88;   // the rows are 0x60 bytes apart: each button's two halves by language
const CHOICES = [0xD5F08, 0xD5F68], CHOICES_STORY = [0xD6208, 0xD6268], CHOICES_SPECIAL = [0xD62C8, 0xD62E8];
const SECRET = 0xD5FC8, CHAO = 0xD6328, FACES = 0xD6308, TILEMAPS = 0xD6338, CODE = 0xD6340, COLOURS = 0xD634C;
const TAILS = 0xD63E4, MESSAGE_FRAME = 0xD63F4;
const MESSAGE_TEXT = [0xD646C, 0xD640C], MESSAGE_TEXT_AFTER = [0xD649C, 0xD643C];
const row = (base, k) => base + k * 0x60;
const entry = (base, i) => base + i * 8;

const s16 = v => (v << 16) >> 16;
const u16 = v => v & 0xFFFF;
const u8 = v => v & 0xFF;
// the page that is the time attack's
const isTimeAttack = page => u8(page - 2) <= 1;

/** 0x08086EB4, CreateMainMenu: the screen's task, its state, and the first frame's settings. */
export function createMainMenu(c, highlitButton = 0, initArg1 = 1) {
  c.dispCnt = 0x1741;
  const m = initialState(c, highlitButton, initArg1);
  c.createTask(init, m, 0x100);
  // layer 2's first 0x40 bytes of tiles cleared, and the maps of layers 0 to 2 to be
  const at = ((c.bgCnt[2] >> 2) & 3) << 14;
  c.video.vram.fill(0, at, at + 0x40);
  for (let bg = 0; bg < 3; bg++) {
    c.mapFill[bg].value = 0;
    c.mapFill[bg].rect.set([0, 0, 0xFF, 0x40]);
  }
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.bldCnt = 0x3FFF;
  c.bldY = 0x10;
  // the sprites' first 64 colours
  for (let i = 0; i < 0x40; i++) c.objPalette[i] = c.rom.u16(COLOURS + i * 2);
  c.flags |= FLAGS.UPDATE_OBJ_PALETTES;
  return m;
}

/** The way in from a start point, and from the title screen: the menu as its Start makes it, the first button chosen. */
export function leaveForTheMainMenu(c) {
  return createMainMenu(c, 0, 1);
}

// 0x0808738C
function initialState(c, highlitButton, initArg1) {
  const down = 0x2000;
  const m = {
    c, highlitButton, initArg1, language: c.save.language,
    fadeStart: initArg1 === 0 || initArg1 === 4 || initArg1 === 5 ? 0 : 1,
    fade: 0, wobble: -240, face: 2, choice: 0, message: 0, pulse: 0, float: 0, chaoMode: 0, spinFast: 1, unk2: 0,
    angle: 0, scale: 0x400, cheat: -1,
    buttons: [
      { x: 0x12C00, y: down }, { x: 0x15C00, y: down * 2 }, { x: 0x18C00, y: down * 3 }, { x: 0x1BC00, y: down * 4 },
    ],
    choices: [{ x: 0x18C00, y: 0x1A00 + down }, { x: 0x18C00, y: 0x4600 + down }],
    secret: { x: 0x3C00, y: down },
    chaoX: -0x2800, chaoY: 0x5600, tailX: -0x2800, tailY: 0x5600,
    scrollX: 0, scrollY: 0, scaleX: 0x100, scaleY: 0x100,
    tiles: OBJ_VRAM, lines: new Uint16Array(160),
  };
  m.buttonSprites = [0, 1, 2, 3].map(() => [createSprite({}), createSprite({})]);
  m.secretSprites = [createSprite({}), createSprite({})];
  m.firstChoice = [createSprite({}), createSprite({})];
  m.secondChoice = [createSprite({}), createSprite({})];
  m.chao = createSprite({});
  m.tail = createSprite({});
  m.faceSprite = createSprite({});
  c.bgAffine ??= { pa: 0x100, pb: 0, pc: 0, pd: 0x100, x: 0, y: 0 };
  return m;
}

// a sprite set up from a table entry, as each of the functions below does it before UpdateSpriteAnimation
function setUp(c, s, at, fields) {
  Object.assign(s, {
    anim: c.rom.u16(at), variant: c.rom.u8(at + 2), prevVariant: 0xFF, animCursor: 0, qAnimDelay: 0, animSpeed: 0x10, palId: 0,
    frameFlags: 0, ...fields,
  });
  updateSprite(c, s);
}
// the tiles a sprite takes, then the next free ones
const take = (m, bytes) => {
  const at = m.tiles;
  m.tiles += bytes;
  return at;
};

// 0x08087498: the Chao, its tail and its face
function createChao(c, m) {
  const { rom } = c;
  let at = take(m, rom.u32(entry(CHAO, 0) + 4) * TILE_4BPP);
  setUp(c, m.chao, entry(CHAO, 0), { tiles: at, x: s16(m.chaoX >> 8), y: s16(m.chaoY >> 8), oamFlags: 0x140 });
  at = take(m, rom.u32(entry(CHAO, 1) + 4) * TILE_4BPP);
  setUp(c, m.tail, entry(CHAO, 1), { tiles: at, x: m.tailX >> 8, y: m.tailY >> 8, oamFlags: 0x140 });
  at = take(m, rom.u32(entry(FACES, 0) + 4) * TILE_4BPP);
  setUp(c, m.faceSprite, entry(FACES, 0), { tiles: at, x: s16(m.chaoX >> 8), y: s16(m.chaoY >> 8), oamFlags: 0x100 });
}

// 0x08087590: the buttons' two halves one after the other, 0x800 bytes of tiles each, and the secret button's
function createButtons(c, m) {
  const group = (sprites, base, k, pos, oamFlags, frameFlags = 0) => {
    sprites.forEach((s, i) => setUp(c, s, entry(row(base, k), i + m.language * 2), { tiles: take(m, BUTTON_TILES), x: pos.x >> 8, y: pos.y >> 8, oamFlags, frameFlags }));
  };
  group(m.buttonSprites[0], BUTTON_ROWS, 0, m.buttons[0], 0, 0x20);
  group(m.buttonSprites[1], BUTTON_ROWS, 1, m.buttons[1], 0x40);
  group(m.buttonSprites[2], BUTTON_ROWS, 2, m.buttons[2], 0x80);
  group(m.buttonSprites[3], BUTTON_ROWS, 3, m.buttons[3], 0xC0);
  m.secretSprites.forEach((s, i) => setUp(c, s, entry(SECRET, i + m.language * 2), { tiles: take(m, BUTTON_TILES), x: m.secret.x >> 8, y: m.secret.y >> 8, oamFlags: 0xC0 }));
}

// 0x080877F4: the time attack's four buttons
function createTimeAttackButtons(c, m) {
  const group = (sprites, at, pos, oamFlags, frameFlags = 0) => {
    sprites.forEach((s, i) => setUp(c, s, entry(at, i + m.language * 2), { tiles: take(m, BUTTON_TILES), x: pos.x >> 8, y: pos.y >> 8, oamFlags, frameFlags }));
  };
  group(m.buttonSprites[0], 0xD6028, m.buttons[0], 0, 0x20);
  group(m.buttonSprites[1], 0xD6088, m.buttons[1], 0x40);
  group(m.buttonSprites[2], m.initArg1 === 2 ? 0xD60E8 : 0xD6148, m.buttons[2], 0x80);
  group(m.buttonSprites[3], 0xD61A8, m.buttons[3], 0xC0);
}

// 0x080876C0: the three layers' pictures
function createLayers(c, m) {
  c.bgCnt[0] = 0x4E07;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  drawBackground(c, { id: 343, dest: 0x4000, layoutVram: 0x7000, targetTilesX: 0x40, targetTilesY: 0x14, flags: 0 });
  c.bgCnt[1] = 0x0601;
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0;
  drawBackground(c, { id: 344, dest: 0, layoutVram: 0x3000, targetTilesX: 0x20, targetTilesY: 0x20, flags: 1 });
  c.bgCnt[2] = 0x188A;
  c.bgScroll[4] = 0;
  c.bgScroll[5] = 0;
  drawBackground(c, { id: c.rom.u16(TILEMAPS + (isTimeAttack(m.initArg1) ? 2 : m.highlitButton) * 2), dest: 0x8000, layoutVram: 0xC000, targetTilesX: 0x10, targetTilesY: 0x10, flags: 6 });
}
// the rotating layer's picture for a button
function drawButtonLayer(c, button) {
  drawBackground(c, { id: c.rom.u16(TILEMAPS + button * 2), dest: 0x8000, layoutVram: 0xC000, targetTilesX: 0x10, targetTilesY: 0x10, flags: 6 });
}

// 0x08089BCC, Task_3F0_MainMenuInit: the layers, the sprites and the song, then the page's own task
function init(t) {
  const m = t.data, { c } = m;
  createLayers(c, m);
  if (isTimeAttack(m.initArg1)) createTimeAttackButtons(c, m);
  else createButtons(c, m);
  createChao(c, m);
  c.stopAllSongs();
  c.playSong(isTimeAttack(m.initArg1) ? MUS_TIME_ATTACK_2 : MUS_MAIN_MENU);
  t.main = PAGES[m.initArg1];
}

// 0x080BE844 (sa2__sub_8003EE4): a rotating layer's registers for an angle, the map drawn at scaleX / 256 and scaleY / 256
// times its size, so that its point (x, y) shows at (cx, cy) on the screen
function transformBackground(c, angle, scaleX, scaleY, x, y, cx, cy) {
  const cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  const kx = s16(Math.trunc(0x10000 / scaleX)), ky = s16(Math.trunc(0x10000 / scaleY));
  const a = c.bgAffine;
  a.pa = s16((cos * kx) >> 8);
  a.pb = s16((sin * kx) >> 8);
  a.pc = s16(((-SINE[angle] >> 6) * ky) >> 8);
  a.pd = s16((cos * ky) >> 8);
  a.x = (a.pa * s16(-cx) + a.pb * s16(-cy) + x * 256) | 0;
  a.y = (a.pc * s16(-cx) + a.pd * s16(-cy) + y * 256) | 0;
}

// 0x08088C4C: the rotating layer turns, a little faster until the buttons are in, and settles to its size
function spin(m) {
  m.angle = u16(m.angle - (m.spinFast === 0 ? 0x400 : 0x100));
  if (m.scale > 0x180) {
    m.scale = u16(m.scale - 0x20);
    if (m.scale <= 0x180) m.spinFast = 1;
  } else m.scale = 0x180;
}

// 0x08089028: the buttons' shaking, which the H-blank gives each line as its layer's horizontal scroll, in bands of eight
// lines that go opposite ways. 1 once it is done.
function shake(m) {
  const { c } = m;
  const flying = m.chaoMode > 2;
  const step = flying ? -10 : 10;
  const done = flying ? s16(m.wobble) <= -260 : s16(m.wobble) >= 0;
  for (let i = 0; i < 160; i++) m.lines[i] = u16((i >> 3) & 1 ? -m.wobble : m.wobble);
  c.lineScroll = m.lines;
  c.lineScrollNext = null;
  c.lineRegister = REG.BG0HOFS;
  c.lineSize = 1;
  if (done) return 1;
  m.wobble += step;
  return 0;
}

// 0x08088D70: how much the chosen button is stretched, beating
function beat(m) {
  m.pulse = u8(m.pulse + 2);
  m.scaleX = s16(sin8(m.pulse * 4) + (sin8(m.pulse * 4) >> 1));
  if (m.scaleX === 0 || m.scaleX === 0xFF) m.scaleX = s16(sin8(u8(m.pulse + 3) * 4) + (sin8(u8(m.pulse + 3) * 4) >> 1));
  m.scaleY = 0x180;
}

// 0x08089150: the Chao floats in from the left, or out to the right
function floatChao(m) {
  m.float = u8(m.float + 3);
  if (m.chaoX <= 0x5000 && m.chaoMode === 0) {
    m.chaoX += 0x400;
    if (m.chaoX > 0x4FFF) m.chaoMode = 2;
  } else if (m.chaoX > 0x4FFF && m.chaoMode === 1) {
    m.chaoX -= 0x300;
    if (m.chaoX <= 0x5000) {
      m.chaoX = 0x5000;
      m.chaoMode = 2;
    }
  } else if (m.chaoMode === 3) m.chaoX -= 0x400;
  m.chaoY = cos8(m.float * 4) * 4 + 0x5600;
}

// 0x080891E4: the tail follows it
function followChao(c, m) {
  const { rom } = c;
  m.float = u8(m.float + 3);
  if (m.chaoMode === 0) {
    m.tailX = m.chaoX - 0x300;
    m.tailY = m.chaoY - 0x3600;
  } else if (m.chaoMode === 1 || m.chaoMode === 3) {
    m.tailX = m.chaoX + 0x300;
    m.tailY = m.chaoY - 0x3600;
  } else if (m.chaoMode === 2) {
    m.tailX = m.chaoX - rom.s16(TAILS + m.face * 4) * 256;
    m.tailY = m.chaoY + rom.s16(TAILS + m.face * 4 + 2) * 256;
  }
  m.tailY += sin8(m.float * 4) * 2;
}

// 0x0808927C: the secret code, which needs every emerald; 1 once it has been entered
function secretCode(m) {
  const { c } = m, { rom } = c;
  if (((c.save.collectedEmeralds ?? 0) & 0x7F) !== 0x7F) return 0;
  if (m.cheat > 9) return 1;
  if (c.pressed & rom.u16(CODE + (m.cheat + 1) * 2)) {
    if (++m.cheat === 5) {
      c.playSong(SE_DPAD_SELECT);
      m.cheat = 10;
      return 1;
    }
  } else if (c.pressed & rom.u16(CODE)) m.cheat = 0;
  else if (c.pressed) m.cheat = -1;
  return 0;
}

// a button's two halves, as one of the functions below shows them: the chosen one beats
function showPair(m, sprites, pos, chosen) {
  const { c } = m;
  for (const s of sprites) {
    s.palId = chosen ? (s16(m.scaleX) <= 0 ? 3 : 1) : 0;
    s.x = s16(pos.x >> 8);
    s.y = s16(pos.y >> 8);
    if (chosen) {
      s.frameFlags |= 0x61;
      transformSprite(c, s, { rotation: 0, scaleX: m.scaleX, scaleY: m.scaleY, x: s.x, y: s.y }, SINE);
    } else s.frameFlags = 0;
    displaySprite(c, s);
  }
}
// 0x08089308, 0x08089398, 0x08089428, 0x080894BC: the four buttons
const showFirst = m => showPair(m, m.buttonSprites[0], m.buttons[0], m.highlitButton === 0);
const showSecond = m => showPair(m, m.buttonSprites[1], m.buttons[1], m.highlitButton === 1);
const showThird = m => showPair(m, m.buttonSprites[2], m.buttons[2], m.highlitButton === 2);
const showFourth = m => showPair(m, m.buttonSprites[3], m.buttons[3], m.highlitButton === 3);
// 0x08089550, 0x080895E0: the two choices under a button
const showFirstChoice = m => showPair(m, m.firstChoice, m.choices[0], m.choice === 0);
const showSecondChoice = m => showPair(m, m.secondChoice, m.choices[1], m.choice === 1);
// 0x08089670: the secret button
const showSecret = m => showPair(m, m.secretSprites, m.secret, m.highlitButton > 9);

// 0x08089704: the Chao, its tail and its face
function showChao(m) {
  const { c } = m, { rom } = c;
  const flipped = m.chaoMode === 1 || m.chaoMode === 3 ? 0x400 : 0;
  let s = m.chao;
  s.x = s16(m.chaoX >> 8);
  s.y = s16(m.chaoY >> 8);
  s.frameFlags = (s.frameFlags & ~0x400) | flipped;
  displaySprite(c, s);
  s = m.tail;
  s.x = s16(m.tailX >> 8);
  s.y = s16(m.tailY >> 8);
  displaySprite(c, s);
  s = m.faceSprite;
  s.anim = rom.u16(entry(FACES, m.face));
  s.variant = rom.u8(entry(FACES, m.face) + 2);
  s.prevVariant = 0xFF;
  s.x = s16(m.chaoX >> 8);
  s.y = s16(m.chaoY >> 8);
  s.frameFlags = (s.frameFlags & ~0x400) | flipped;
  updateSprite(c, s);
  displaySprite(c, s);
}

// 0x08089EF8, 0x08089F08, 0x08089F40: the pattern behind drifts, the spinning layer is set, and the first one's scroll
const drift = m => { m.scrollX = 0; m.scrollY += 0x100; };
const turnLayer = m => transformBackground(m.c, u16(m.angle) >> 6, m.scale, m.scale, 0x40, 0x40, 0x48, 0x50);
function scrollLayer(m) {
  m.c.bgScroll[2] = s16(m.scrollX >> 8);
  m.c.bgScroll[3] = s16(m.scrollY >> 8);
}

// 0x08089DA0, 0x08089DF4: the four buttons fly in to their row, or out again; how many have arrived
function slideIn(m) {
  let done = 0;
  for (const b of m.buttons) {
    if (b.x <= IN_X) {
      b.x = IN_X;
      done++;
    } else b.x -= BUTTON_SPEED << 8;
  }
  return done;
}
function slideOut(m) {
  let done = 0;
  for (const b of m.buttons) {
    if (b.x >= OFF_SCREEN_X) {
      b.x = OFF_SCREEN_X;
      done++;
    } else b.x += BUTTON_SPEED << 9;
  }
  return done;
}
// 0x08089E50, 0x08089EA0: the same for the two choices
function slideChoicesIn(m) {
  let done = 0;
  for (const b of m.choices) {
    if (b.x <= IN_X) {
      b.x = IN_X;
      done++;
    } else b.x -= BUTTON_SPEED << 8;
  }
  return done;
}
function slideChoicesOut(m) {
  let done = 0;
  for (const b of m.choices) {
    if (b.x >= OFF_SCREEN_X) {
      b.x = OFF_SCREEN_X;
      done++;
    } else b.x += BUTTON_SPEED << 9;
  }
  return done;
}

// the windows and fade a page starts with, when the screen is to come out of black
function startFade(m, from) {
  const { c } = m;
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x3F;
  c.winRegs[5] |= 0x1F;
  c.bldCnt = 0x3FFF;
  m.fade = from;
  m.fadeStart = 0;
}

// 0x080877F8, Task_3F0_8087B80: the first page's opening, the screen coming out of black with the buttons flying in
function opening(t) {
  const m = t.data, { c } = m;
  if (m.fadeStart) {
    startFade(m, 0x1000);
    c.bldY = 0x10;
  }
  shake(m);
  floatChao(m);
  followChao(c, m);
  spin(m);
  drift(m);
  showSecond(m);
  showFourth(m);
  showFirst(m);
  showThird(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  secretCode(m);
  if (c.bldY !== 0) {
    c.bldY = u16(m.fade) >> 8;
    m.fade = u16(m.fade - 0x100);
  } else t.main = flying;
}

// 0x08089C44, Task_3F0_8089FCC: the buttons still flying in
function flying(t) {
  const m = t.data;
  shake(m);
  beat(m);
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  showSecond(m);
  showFourth(m);
  showFirst(m);
  showThird(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  secretCode(m);
  if (slideIn(m) === 4 && shake(m) !== 0) {
    m.unk2 = 1;
    t.main = choose;
  }
}

// 0x08089CD8, Task_3F0_808A060: the buttons back in their row after the choices have gone
function settling(t) {
  const m = t.data;
  beat(m);
  spin(m);
  drift(m);
  showSecond(m);
  showFourth(m);
  showFirst(m);
  showThird(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  secretCode(m);
  if (slideIn(m) === 4) {
    m.unk2 = 1;
    t.main = choose;
  }
}

// 0x08087E14, Task_3F0_808819C: a button chosen, with Up and Down moving it, A opening it and B going back
function choose(t) {
  const m = t.data, { c } = m;
  spin(m);
  drift(m);
  floatChao(m);
  followChao(c, m);
  showSecond(m);
  showFourth(m);
  showFirst(m);
  showThird(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  const timeAttack = isTimeAttack(m.initArg1);
  if (m.cheat !== 4 && (c.pressed & KEY.LEFT) && ((c.save.unlockFlags ?? 0) & 4) && m.highlitButton === 3) {
    const options = entry(row(BUTTON_ROWS, 3), m.language * 2);
    if (m.buttonSprites[3][0].anim === c.rom.u16(options) && m.buttonSprites[3][0].variant === c.rom.u8(options + 2)) {
      c.playSong(SE_DPAD_SELECT);
      m.highlitButton = 0xB;
      m.fadeStart = 1;
      t.main = fadeOut;
      return;
    }
  }
  if (!timeAttack) {
    if (secretCode(m) === 1) {
      showSecret(m);
      if (m.cheat === SECRET_BUTTON) {
        m.pulse = 0;
        m.scaleX = 1;
        m.highlitButton = SECRET_BUTTON;
        m.cheat++;
      } else {
        if ((c.pressed & KEY.LEFT) && m.highlitButton === 0) {
          c.playSong(SE_DPAD_SELECT);
          m.highlitButton = 0xA;
          m.pulse = 0;
          m.scaleX = m.scaleY = 0x100;
        }
        if ((c.pressed & KEY.RIGHT) && m.highlitButton === 0xA) {
          c.playSong(SE_DPAD_SELECT);
          m.highlitButton = 0;
          m.pulse = 0;
          m.scaleX = m.scaleY = 0x100;
        }
      }
    }
    if (c.pressed & KEY.B) {
      c.playSong(SE_ABORT);
      m.wobble = 0;
      m.fadeStart = 1;
      m.highlitButton = 4;
      m.chaoMode = 3;
      m.face = 2;
      t.main = leaving;
      return;
    }
  }
  if (c.pressed & KEY.A) {
    c.playSong(SE_SELECT);
    m.fadeStart = 1;
    t.main = leaving;
    return;
  }
  if (m.highlitButton <= 9 && (c.repeated & (KEY.UP | KEY.DOWN))) {
    c.playSong(SE_DPAD_SELECT);
    if (c.repeated & KEY.UP) m.highlitButton = m.highlitButton <= 0 ? 3 : m.highlitButton - 1;
    else m.highlitButton = m.highlitButton > 2 ? 0 : m.highlitButton + 1;
    m.scaleX = m.scaleY = 0x100;
    m.unk2 = 0;
    m.pulse = 0x40;
    if (!timeAttack) drawButtonLayer(c, m.highlitButton);
  }
  beat(m);
  m.face = m.highlitButton <= 9 ? m.highlitButton : 0;
}

// 0x08087D00, Task_3F0_8088088: a button opened, the others flying out to the right
function leaving(t) {
  const m = t.data;
  shake(m);
  beat(m);
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  showSecond(m);
  showFourth(m);
  showFirst(m);
  showThird(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (slideOut(m) !== 4) return;
  if (isTimeAttack(m.initArg1)) t.main = leaveTimeAttack;
  else if (m.highlitButton <= 2) {
    m.pulse = 0;
    m.scaleX = m.scaleY = 0x100;
    t.main = [openFirst, openSecond, openThird][m.highlitButton];
  } else t.main = fadeOut;
}

// 0x080878EC, Task_3F0_8087C74: the screen fades to black, and what the button opened comes
function fadeOut(t) {
  const m = t.data, { c } = m;
  if (m.fadeStart) {
    startFade(m, 0);
  }
  if (m.highlitButton === 4) shake(m);
  beat(m);
  floatChao(m);
  followChao(c, m);
  spin(m);
  drift(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (c.bldY <= 0xF) {
    c.bldY = u16(m.fade) >> 8;
    m.fade = u16(m.fade + 0x100);
    return;
  }
  c.bldY = 0x10;
  m.message = 0xB;
  t.main = goToSelectedScreen;
}

// 0x08087B90, Task_3F0_8087F18: the same for the time attack's page
function leaveTimeAttack(t) {
  const m = t.data, { c } = m;
  if (m.fadeStart) {
    startFade(m, 0);
  }
  shake(m);
  beat(m);
  floatChao(m);
  followChao(c, m);
  spin(m);
  drift(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (c.bldY <= 0xF) {
    c.bldY = u16(m.fade) >> 8;
    m.fade = u16(m.fade + 0x100);
    return;
  }
  c.bldY = 0x10;
  leaveForTheNext(c, t);
}

// 0x080879CC, Task_TransitionToSelectedMode: the screen the button leads to, none of which is ported yet
function goToSelectedScreen(t) {
  leaveForTheNext(t.data.c, t);
}

// What comes next (the character select, the name entry, the options and the title screen) isn't ported yet, so the game
// goes straight to Route 99's overworld.
function leaveForTheNext(c, t) {
  c.destroyTask(t);
  for (const other of [...c.tasks]) c.destroyTask(other);
  c.bgAffine = null;
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
  c.lineRegister = REG.BG0HOFS + 12;
  c.dispCnt = 0x80;
  c.bgCnt.fill(0);
  c.bgScroll.fill(0);
  c.winRegs.fill(0);
  c.bldCnt = 0;
  c.bldY = 0;
  startStage(c, 2);
}

// the two choices under a button, set up from the tables of `choices` and the message beside them
function createChoices(m, tables, perLanguage, tileBytes, message) {
  const { c } = m;
  let tiles = m.buttonSprites[0][0].tiles;
  const place = (sprites, base, pos) => sprites.forEach((s, i) => {
    setUp(c, s, entry(base, i + perLanguage * 2), { tiles, x: s16(pos.x >> 8), y: s16(pos.y >> 8), oamFlags: 0xC0 });
    tiles += tileBytes;
  });
  place(m.firstChoice, tables[0], m.choices[0]);
  place(m.secondChoice, tables[1], m.choices[1]);
  if (message) createChaoMessage(c, m, message.kind, tiles, message.x, message.y);
}
// the choices sit in their row at once and the Chao is to their left
function settleChoices(m) {
  m.choices[0].x = m.choices[1].x = IN_X;
  m.chaoX = 0x5000;
  m.chaoMode = 1;
  m.scale = 0x180;
  m.spinFast = 1;
}

// 0x080880B8, Task_3F0_8088440: the page after a story, with the choices under the second button and the Chao's message
function pageTwoChoices(t) {
  const m = t.data, { c } = m;
  settleChoices(m);
  m.choice = m.highlitButton;
  m.highlitButton = 1;
  m.message = m.choice;
  m.choices[0].y = 0x6400;
  m.choices[1].y = 0x8200;
  createChoices(m, CHOICES_STORY, m.language, BUTTON_TILES, { kind: 0, x: 0x64, y: 0x26 });
  m.face = 2;
  drawButtonLayer(c, 1);
  t.main = choosing;
}

// 0x08088244, Task_3F0_80885CC: the page for the third button, with its own message
function pageSpecialChoices(t) {
  const m = t.data, { c } = m;
  settleChoices(m);
  m.choice = m.highlitButton;
  m.highlitButton = 2;
  m.choices[0].y = 0x6400;
  m.choices[1].y = 0x8200;
  createChoices(m, CHOICES_SPECIAL, m.language !== JAPANESE ? 1 : 0, BUTTON_TILES, null);
  m.message = 0;
  createChaoMessage(c, m, 1, m.buttonSprites[0][0].tiles + 4 * BUTTON_TILES, 0x58, 0x22);
  m.face = 2;
  drawButtonLayer(c, 2);
  t.main = choosing;
}

// 0x080883E8, Task_3F0_8088770: the page for the first button, with its two choices
function pageFirstChoices(t) {
  const m = t.data, { c } = m;
  settleChoices(m);
  m.choice = m.highlitButton;
  m.face = m.highlitButton + 1;
  m.highlitButton = 0;
  m.choices[0].y = m.buttons[0].y + 0x1A00;
  m.choices[1].y = m.buttons[2].y + 0x600;
  createChoices(m, CHOICES, m.language, BUTTON_TILES, null);
  drawButtonLayer(c, 0);
  t.main = choosing;
}

// 0x08088AEC, Task_3F0_8088E74: the first button opened: its two choices fly in
function openFirst(t) {
  const m = t.data;
  m.choices[0].y = m.buttons[0].y + 0x1A00;
  m.choices[1].y = m.buttons[2].y + 0x600;
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  createChoices(m, CHOICES, m.language, BUTTON_TILES, null);
  m.face = 1;
  t.main = choicesComing;
}

// 0x08089434, Task_3F0_80897BC: the second button opened
function openSecond(t) {
  const m = t.data;
  m.choices[0].y = 0x6400;
  m.choices[1].y = 0x8200;
  m.message = 0;
  spin(m);
  m.scrollX = 0;
  m.scrollY += 0x100;
  floatChao(m);
  followChao(m.c, m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  createChoices(m, CHOICES_STORY, m.language, BUTTON_TILES, { kind: 0, x: 0x64, y: 0x26 });
  m.face = 2;
  t.main = choicesComing;
}

// 0x080895E8, Task_3F0_8089970: the third button opened
function openThird(t) {
  const m = t.data;
  m.choices[0].y = 0x6400;
  m.choices[1].y = 0x8200;
  m.message = 0;
  spin(m);
  m.scrollX = 0;
  m.scrollY += 0x100;
  floatChao(m);
  followChao(m.c, m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  createChoices(m, CHOICES_SPECIAL, m.language !== JAPANESE ? 1 : 0, 0x200, { kind: 1, x: 0x58, y: 0x22 });
  m.face = 2;
  t.main = choicesComing;
}

// 0x08089D50, Task_3F0_808A0D8: the two choices fly in
function choicesComing(t) {
  const m = t.data;
  beat(m);
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  showSecondChoice(m);
  showFirstChoice(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (slideChoicesIn(m) === 2) t.main = choosing;
}

// 0x08088560, Task_3F0_80888E8: the page's opening, coming out of black
function choosingOpening(t) {
  const m = t.data, { c } = m;
  if (m.fadeStart) {
    startFade(m, 0x1000);
    c.bldY = 0x10;
  }
  floatChao(m);
  followChao(c, m);
  beat(m);
  spin(m);
  drift(m);
  showSecondChoice(m);
  showFirstChoice(m);
  turnLayer(m);
  scrollLayer(m);
  showChao(m);
  if (c.bldY !== 0) {
    c.bldY = u16(m.fade) >> 8;
    m.fade = u16(m.fade - 0x100);
    return;
  }
  t.main = choosing;
}

// 0x08088644, Task_3F0_80889CC: one of the two choices chosen, with Up and Down changing it, A taking it and B going back
function choosing(t) {
  const m = t.data, { c } = m;
  spin(m);
  drift(m);
  floatChao(m);
  followChao(c, m);
  showSecondChoice(m);
  showFirstChoice(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (c.pressed & KEY.B) {
    c.playSong(SE_ABORT);
    m.wobble = 0;
    m.fadeStart = 1;
    m.chaoMode = 2;
    m.choice = 0;
    m.message = 0xB;
    t.main = choicesLeaving;
    return;
  }
  if (c.repeated & (KEY.UP | KEY.DOWN)) {
    c.playSong(SE_DPAD_SELECT);
    m.choice = m.choice === 1 ? 0 : 1;
    if (m.highlitButton === 0) m.face = m.choice + 1;
    else if (m.highlitButton === 1) {
      m.face = m.choice + 2;
      m.message = m.choice;
    } else if (m.highlitButton === 2) {
      m.face = m.choice + 2;
      if (!((c.save.unlockFlags ?? 0) & 2)) m.message = m.choice;
    }
    m.scaleX = m.scaleY = 0x100;
    m.unk2 = 0;
    m.pulse = 0x40;
  }
  beat(m);
  if (c.pressed & KEY.A) {
    if (m.highlitButton === 2 && !((c.save.unlockFlags ?? 0) & 2) && m.choice === 1) {
      c.playSong(SE_105);
      return;
    }
    c.playSong(SE_SELECT);
    m.fadeStart = 1;
    t.main = choiceTaken;
  }
}

// 0x080887C0, Task_3F0_8088B48: B pressed, the two choices fly out
function choicesLeaving(t) {
  const m = t.data;
  beat(m);
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  showSecondChoice(m);
  showFirstChoice(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (slideChoicesOut(m) === 2) {
    m.pulse = 0;
    m.scaleX = m.scaleY = 0x100;
    t.main = buttonsBack;
  }
}

// 0x08089DBC, Task_3F0_808A144: a choice taken, the two fly out and the screen fades
function choiceTaken(t) {
  const m = t.data;
  spin(m);
  drift(m);
  floatChao(m);
  followChao(m.c, m);
  showSecondChoice(m);
  showFirstChoice(m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  if (slideChoicesOut(m) === 2) t.main = fadeOut;
}

// 0x08088848, Task_3F0_8088BD0: the buttons made again, to fly back in
function buttonsBack(t) {
  const m = t.data, { c } = m;
  spin(m);
  drift(m);
  floatChao(m);
  followChao(c, m);
  scrollLayer(m);
  turnLayer(m);
  showChao(m);
  m.tiles = m.buttonSprites[0][0].tiles;
  createButtons(c, m);
  t.main = settling;
}

const PAGES = [pageFirstChoices, opening, opening, opening, pageTwoChoices, pageSpecialChoices];

// 0x08089E28, sub_808A1B0: the Chao's message, a task of its own that ends when the choice it is about is made
function createChaoMessage(c, m, kind, tiles, x, y) {
  const message = { c, menu: m, language: c.save.language, kind, x: x << 8, y: y << 8, frame: createSprite({}), text: createSprite({}), tail: createSprite({}) };
  c.createTask(showMessage, message, 0x100);
  // 0x080897B0: the frame, the tail and the text, one after the other in the tiles
  const { rom } = c;
  const frameAt = entry(MESSAGE_FRAME, kind === 0 ? 0 : kind === 1 ? 1 : 0);
  setUp(c, message.frame, frameAt, { tiles, x: x, y: y, oamFlags: 0x40 });
  tiles += rom.u32(frameAt + 4) * TILE_4BPP;
  setUp(c, message.tail, entry(MESSAGE_FRAME, 2), { tiles, x: 0, y: 0, oamFlags: 0 });
  tiles += rom.u32(entry(MESSAGE_FRAME, 2) + 4) * TILE_4BPP;
  const text = kind === 0 ? MESSAGE_TEXT[0] : MESSAGE_TEXT[1];
  setUp(c, message.text, entry(text, message.language), { tiles, x: x, y: y, oamFlags: 0x40 });
}

// 0x08089EA4, Task_94_808A22C, with 0x080898C0: the frame four times, flipped each way, the tail and the text
function showMessage(t) {
  const message = t.data, { c } = message, { rom } = c;
  const x = message.x >> 8, y = message.y >> 8;
  const s = message.frame;
  for (let k = 0; k < 4; k++) {
    const at = entry(MESSAGE_FRAME, message.kind === 0 ? 0 : 1);
    s.anim = rom.u16(at);
    s.variant = rom.u8(at + 2);
    s.prevVariant = 0xFF;
    s.x = x;
    s.y = y;
    s.frameFlags = (s.frameFlags & ~0xC00) | (k & 1 ? 0x400 : 0) | (k & 2 ? 0x800 : 0);
    updateSprite(c, s);
    displaySprite(c, s);
  }
  const tail = message.tail;
  tail.x = message.kind === 0 ? x - 0x41 : x - 0x2D;
  tail.y = message.kind === 0 ? y + 0xC : y + 8;
  updateSprite(c, tail);
  displaySprite(c, tail);
  const text = message.text, taken = message.menu.message !== 0;
  const table = message.kind === 0 ? (taken ? MESSAGE_TEXT_AFTER[0] : MESSAGE_TEXT[0]) : (taken ? MESSAGE_TEXT_AFTER[1] : MESSAGE_TEXT[1]);
  text.anim = rom.u16(entry(table, message.language));
  text.variant = rom.u8(entry(table, message.language) + 2);
  text.prevVariant = 0xFF;
  text.x = x;
  text.y = y;
  updateSprite(c, text);
  displaySprite(c, text);
  if (message.menu.message === 0xB) c.destroyTask(t);
}
