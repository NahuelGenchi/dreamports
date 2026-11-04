// The stage's numbers: the lives, the icons of both characters, in an overworld the special keys and the zone's name,
// and in an act the time and the rings, sliding in from the screen's edges as a stage starts. Rewritten from 0x080215D0
// and 0x08021A94.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';

const OBJ_VRAM = 0x10000, TILE = 32;
const ANIM_ASCII = 1122, ANIM_UI_CHARACTER_TYPE = 1420, ANIM_UI_SPECIAL_KEY = 1422, ANIM_LIFE_ICONS = 1423, ANIM_ZONE_NAME = 1424;
const ANIM_TIME = 0x58D;
const LIFE_ICON = [0, 4, 2, 1, 3];   // by character: Sonic, Cream, Tails, Knuckles, Amy
const ORDER_6 = 6 << 6, ORDER_5 = 5 << 6, ORDER_6_ALT = 0x180;
const ZONE_TEXT_X = 112, ZONE_TEXT_Y = 144, PLAYER_ICON_X = 5, ICON_Y = 141, PARTNER_ICON_X = 15, LIVES_X = 36, LIVES_Y = 156;
const KEYS_X = 36, KEYS_Y = 40;
const RINGS_X = 48, RINGS_Y = 18;
const TIME_TEXT_X = 88, TIME_TEXT_Y = 7, MINUTES_X = 110, APOSTROPHE_X = 117, SECONDS_X = 122, QUOTES_X = 137, FRAMES_X = 144, TIMER_Y = 18, MARKS_Y = 17;
// which digits show a number of seconds and of frames, as two bytes each
const SECOND_DIGITS = 0xCF534, FRAME_DIGITS = 0xCF5AE;
const APOSTROPHE = 10, QUOTES = 11, FIRST_ACT = 3;

/** 0x080215D0: every sprite the numbers use, one after the other in sprite memory. */
export function createStageUi(stage, playerCharacter, partnerCharacter) {
  const { c } = stage, ui = { stage, slide: 0x10 };
  let tiles = OBJ_VRAM + 0x3800;
  ui.digits = [];
  const chars = [...'0123456789', "'", '"'];
  chars.forEach((char, i) => ui.digits.push(createSprite({ tiles: tiles + i * 2 * TILE, anim: ANIM_ASCII, variant: char.charCodeAt(0) - '!'.charCodeAt(0) + 1, oamFlags: ORDER_6 })));
  tiles += 24 * TILE;
  const icon = (anim, variant, oamFlags, count) => {
    const s = createSprite({ tiles, anim, variant, oamFlags });
    updateSprite(c, s);
    tiles += count * TILE;
    return s;
  };
  ui.player = icon(ANIM_LIFE_ICONS, LIFE_ICON[playerCharacter], ORDER_5, 6);
  ui.partner = icon(ANIM_LIFE_ICONS, LIFE_ICON[partnerCharacter], ORDER_6_ALT, 6);
  ui.key = icon(ANIM_UI_SPECIAL_KEY, 0, ORDER_6_ALT, 4);
  ui.type = icon(ANIM_UI_CHARACTER_TYPE, 0, ORDER_6_ALT, 9);
  ui.time = createSprite({ tiles, anim: ANIM_TIME, variant: 0, oamFlags: ORDER_6_ALT });
  updateSprite(c, ui.time);
  if (stage.act < FIRST_ACT) {
    ui.zone = createSprite({ tiles: stage.allocTiles(16 * 2), anim: ANIM_ZONE_NAME, variant: stage.zone, oamFlags: ORDER_6_ALT });
    updateSprite(c, ui.zone);
  }
  c.createTask(slideIn, ui, 0x2100);
  return ui;
}

const show = (c, s, x, y) => {
  s.x = x;
  s.y = y;
  updateSprite(c, s);
  displaySprite(c, s);
};

// 0x08022898 and 0x08022828: each frame's numbers, and how far off the screen they still are
function slideIn(t) {
  const ui = t.data;
  if (--ui.slide === 0) t.main = showUi;
  showUi(t);
}

// 0x08021A94, in an act: the time as M'SS"FF, then the rings, red every other 16 frames while there are none
function showTimeAndRings(ui, baseY) {
  const { stage } = ui, { c } = stage, { rom } = c;
  const seconds = Math.trunc(stage.levelTimer / 60), minutes = Math.trunc(seconds / 60), inMinute = seconds - minutes * 60;
  const frames = stage.levelTimer - seconds * 60;
  const digit = i => ui.digits[i];
  show(c, digit(rom.u8(FRAME_DIGITS + frames * 2) - 10), FRAMES_X, TIMER_Y - baseY);
  show(c, digit(rom.u8(FRAME_DIGITS + frames * 2 + 1) - 10), FRAMES_X + 8, TIMER_Y - baseY);
  show(c, digit(QUOTES), QUOTES_X, MARKS_Y - baseY);
  show(c, digit(rom.u8(SECOND_DIGITS + inMinute * 2)), SECONDS_X, TIMER_Y - baseY);
  show(c, digit(rom.u8(SECOND_DIGITS + inMinute * 2 + 1)), SECONDS_X + 8, TIMER_Y - baseY);
  show(c, digit(APOSTROPHE), APOSTROPHE_X, MARKS_Y - baseY);
  show(c, digit(minutes), MINUTES_X, TIMER_Y - baseY);
  show(c, ui.time, TIME_TEXT_X, TIME_TEXT_Y - baseY);
  const hundreds = Math.trunc(stage.rings / 100), rest = stage.rings - hundreds * 100, tens = Math.trunc(rest / 10);
  const red = stage.rings === 0 && stage.timer & 0x10 ? 1 : 0;
  [hundreds, tens, rest - tens * 10].forEach((d, i) => {
    const s = digit(d);
    s.x = RINGS_X + (i - 1) * 8;
    s.y = RINGS_Y - baseY;
    updateSprite(c, s);
    s.palId = red;
    displaySprite(c, s);
    s.palId = 0;
  });
}

// 0x08021A94
function showUi(t) {
  const ui = t.data, { stage } = ui, { c } = stage;
  const baseY = ui.slide, inAct = stage.act >= FIRST_ACT;
  if (inAct) showTimeAndRings(ui, baseY);
  else {
    show(c, ui.digits[stage.keys], KEYS_X - baseY * 2, KEYS_Y);
    show(c, ui.zone, ZONE_TEXT_X, baseY + ZONE_TEXT_Y);
  }
  show(c, ui.digits[Math.min(stage.lives, 9)], LIVES_X, baseY + LIVES_Y);
  show(c, ui.player, PLAYER_ICON_X, baseY + ICON_Y);
  show(c, ui.partner, PARTNER_ICON_X, baseY + ICON_Y);
  show(c, ui.type, 8 - baseY * 2, 0);
  if (!inAct) show(c, ui.key, 11 - baseY * 2, 24);
}
