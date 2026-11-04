// The stage's numbers: the lives, the icons of both characters, and in an overworld the special keys and the zone's
// name, sliding in from the screen's edges as a stage starts. Rewritten from 0x080215D0 and 0x08021A94.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';

const OBJ_VRAM = 0x10000, TILE = 32;
const ANIM_ASCII = 1122, ANIM_UI_CHARACTER_TYPE = 1420, ANIM_UI_SPECIAL_KEY = 1422, ANIM_LIFE_ICONS = 1423, ANIM_ZONE_NAME = 1424;
const ANIM_TIME = 0x58D;
const LIFE_ICON = [0, 4, 2, 1, 3];   // by character: Sonic, Cream, Tails, Knuckles, Amy
const ORDER_6 = 6 << 6, ORDER_5 = 5 << 6, ORDER_6_ALT = 0x180;
const ZONE_TEXT_X = 112, ZONE_TEXT_Y = 144, PLAYER_ICON_X = 5, ICON_Y = 141, PARTNER_ICON_X = 15, LIVES_X = 36, LIVES_Y = 156;
const KEYS_X = 36, KEYS_Y = 40;

/** 0x080215D0: every sprite the numbers use, one after the other in sprite memory. */
export function createStageUi(stage, playerCharacter, partnerCharacter) {
  const { c } = stage, ui = { stage, slide: 0x10 };
  let tiles = OBJ_VRAM + 0x3800;
  ui.digits = [];
  for (let i = 0; i < 10; i++) ui.digits.push(createSprite({ tiles: tiles + i * 2 * TILE, anim: ANIM_ASCII, variant: '0'.charCodeAt(0) + i - '!'.charCodeAt(0) + 1, oamFlags: ORDER_6 }));
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
  ui.zone = createSprite({ tiles: stage.allocTiles(16 * 2), anim: ANIM_ZONE_NAME, variant: stage.zone, oamFlags: ORDER_6_ALT });
  updateSprite(c, ui.zone);
  c.createTask(slideIn, ui, 0x2100);
  return ui;
}

const show = (c, s, x, y) => {
  s.x = x;
  s.y = y;
  updateSprite(c, s);
  displaySprite(c, s);
};

// 0x08022854 and 0x080227D4: each frame's numbers, and how far off the screen they still are
function slideIn(t) {
  const ui = t.data;
  if (--ui.slide === 0) t.main = showUi;
  showUi(t);
}

// 0x08021A94, in an overworld
function showUi(t) {
  const ui = t.data, { stage } = ui, { c } = stage;
  const baseY = ui.slide;
  show(c, ui.digits[stage.keys], KEYS_X - baseY * 2, KEYS_Y);
  show(c, ui.zone, ZONE_TEXT_X, baseY + ZONE_TEXT_Y);
  show(c, ui.digits[Math.min(stage.lives, 9)], LIVES_X, baseY + LIVES_Y);
  show(c, ui.player, PLAYER_ICON_X, baseY + ICON_Y);
  show(c, ui.partner, PARTNER_ICON_X, baseY + ICON_Y);
  show(c, ui.type, 8 - baseY * 2, 0);
  show(c, ui.key, 11 - baseY * 2, 24);
}
