// The title card an act starts with: a white band closing in with the act's name, the characters' names and the act's
// emblem, which then opens on the stage. Rewritten from CreateStageIntro, at 0x08056B74, and its tasks.
//
// A medal shows only once it's been earned, which nothing can do yet.

import { createSprite, updateSprite, displaySprite, transformSprite, SPRITE } from '../sprite.js';
import { SINE } from './trig.js';

const ANIM_ACT_EMBLEM = 860, ANIM_CHARACTER_NAMES = 861;
const ACT_X_LIMIT = 0xD19D0, NAME_WIDTHS = 0xD19F4, ACT_NAMES = 0xD1A00, NAME_OF = 0xD1A90;
const ENGLISH_NAMES = 9;
const FIRST_ACT = 3, PX = 256;
// gNextFreeAffineIndex as 0x08002BBC leaves it each frame, as nothing else asks for one yet
const FIRST_FREE_AFFINE = 6;

export function createTitleCard(stage) {
  const { c } = stage, { rom } = c;
  const nameOf = character => rom.u8(NAME_OF + character);
  const first = nameOf(stage.players[0].character), second = nameOf(stage.players[1].character);
  const card = {
    stage, timer: 0, bandY: 80, bandHalf: 80, fade: 0x100, partnerX: 0x15400, namesY: 0x6400, speedX: -3 * PX, speedY: -2 * PX, first, second,
    turn: { rotation: 0, scaleX: PX, scaleY: PX, x: 200, y: 150 },
  };
  stage.cardCover = true;
  stage.cardHides = true;
  c.dispCnt |= 0x6000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[1] = 240;
  c.winRegs[3] = 160;
  c.bgPalette[0] = 0x7FFF;
  c.flags |= 1;
  c.winRegs[4] = 0x3F10;
  c.winRegs[5] = 0x3F;
  c.bldCnt = 0x3FEF;
  c.bldY = 0x10;
  let tiles = stage.allocTiles(156);
  card.tiles = tiles;
  const at = ACT_NAMES + (stage.zone + ENGLISH_NAMES) * 8;
  const sprite = (anim, variant, frameFlags = 0) => {
    const s = createSprite({ tiles, anim, variant, frameFlags });
    updateSprite(c, s);
    return s;
  };
  card.name = sprite(rom.u16(at), rom.u8(at + 2), 0x3000);
  tiles += 0x380 + 0x200 * 3 + 0x200;
  card.firstName = sprite(ANIM_CHARACTER_NAMES, first);
  tiles += 0xE0;
  card.secondName = sprite(ANIM_CHARACTER_NAMES, second);
  tiles += 0xE0;
  card.and = sprite(ANIM_CHARACTER_NAMES, 5);
  tiles += 0x40;
  card.emblem = sprite(ANIM_ACT_EMBLEM, stage.act - FIRST_ACT, FIRST_FREE_AFFINE | 0x60);
  card.emblem.x = 200;
  card.emblem.y = 150;
  c.createTask(closing, card, 0x2100);
  return card;
}

// 0x08057844: the band's windows, the colour effect and the colour behind everything, every frame
function bandAndFade(card) {
  const { stage: { c }, bandY, bandHalf, fade } = card;
  c.dispCnt |= 0x6000;
  const top = bandY - bandHalf, bottom = bandY + bandHalf;
  c.winRegs[0] = 240;
  c.winRegs[2] = (Math.max(top, 0) << 8) | Math.min(bottom, 160);
  c.winRegs[1] = 240;
  c.winRegs[3] = 160;
  c.winRegs[4] = 0x3F10;
  c.winRegs[5] = 0x3F;
  c.bgPalette[0] = 0x7FFF;
  c.flags |= 1;
  c.bldCnt = 0x3FEF;
  c.bldY = fade >> 4;
  c.bldAlpha = 0x10 - (fade >> 4);
}

// 0x08057FE4: the band closes in on the middle of the screen
function closing(t) {
  const card = t.data;
  card.timer++;
  card.bandHalf = 80 - card.timer * 9;
  if (card.timer === 8) {
    card.bandHalf = 12;
    card.timer = 16;
    t.main = nameIn;
  }
  bandAndFade(card);
}
// 0x08058034: the act's name slides in
function nameIn(t) {
  const card = t.data, { stage: { c } } = card, s = card.name;
  if (--card.timer === 0) t.main = nameHolds;
  bandAndFade(card);
  s.x = 120 - card.timer * 10;
  s.y = card.bandY;
  updateSprite(c, s);
  displaySprite(c, s);
}
// 0x08058090: and stays
function nameHolds(t) {
  const card = t.data, { stage: { c } } = card, s = card.name;
  if (++card.timer === 64) {
    card.timer = 0;
    t.main = bandFalls;
  }
  bandAndFade(card);
  s.x = 120;
  s.y = card.bandY;
  updateSprite(c, s);
  displaySprite(c, s);
}
// 0x08057328: the band goes down the screen, and from its eighth frame the stage shows through
function bandFalls(t) {
  const card = t.data, { stage } = card, { c } = stage, s = card.name;
  card.timer++;
  card.bandY = ((card.timer * 7) >> 1) + 80;
  if (card.timer > 8) {
    if (card.fade !== 0) card.fade -= 0x10;
    stage.cardHides = false;
  }
  if (card.timer === 0x10) {
    card.timer = 0;
    t.main = namesIn;
  }
  bandAndFade(card);
  s.y = card.bandY;
  updateSprite(c, s);
  displaySprite(c, s);
}
// 0x080573A8: the act's name goes to its place, the emblem shrinks and shakes, and the characters' names rise in
function namesIn(t) {
  const card = t.data, { stage } = card, { c, } = stage, { rom } = c;
  if (card.fade !== 0) card.fade -= 0x10;
  const s = card.name;
  card.timer++;
  if (card.timer === 105) {
    card.timer = 0;
    t.main = goingAway;
    goingAway(t);
    return;
  }
  s.x = Math.min(card.timer * 10 + 120, rom.s16(ACT_X_LIMIT + stage.zone * 2));
  updateSprite(c, s);
  displaySprite(c, s);
  let shake = 0, grow = 0;
  if (card.timer > 0x10) shake = card.timer > 0x24 ? 0 : 2 & card.timer;
  else grow = 0x10 - card.timer;
  const emblem = card.emblem, turn = card.turn;
  emblem.x = shake + 0xC7;
  emblem.frameFlags = (emblem.frameFlags & ~SPRITE.ROT_SCALE) | FIRST_FREE_AFFINE;
  turn.scaleX = grow * 16 + PX;
  turn.scaleY = grow * 16 + PX;
  turn.x = emblem.x;
  updateSprite(c, emblem);
  transformSprite(c, emblem, turn, SINE);
  displaySprite(c, emblem);
  card.speedY += 0x20;
  card.partnerX += card.speedX;
  card.namesY += card.speedY;
  let x = Math.max(card.partnerX >> 8, 240 - 20), y = Math.min(card.namesY >> 8, 160 - 40);
  const widths = (i, side) => (rom.u8(NAME_WIDTHS + i * 2 + side) << 24) >> 24;
  x -= widths(card.second, 1);
  placeAndShow(c, card.secondName, x, y);
  x -= widths(card.second, 0) + 5;
  placeAndShow(c, card.and, x, y);
  x -= 5 + widths(card.first, 1);
  placeAndShow(c, card.firstName, x, y);
  bandAndFade(card);
}
const placeAndShow = (c, s, x, y) => {
  s.x = x;
  s.y = y;
  updateSprite(c, s);
  displaySprite(c, s);
};
// 0x080575EC: the emblem and the names go off to the left, the band closes, and a player can move
function goingAway(t) {
  const card = t.data, { stage } = card, { c } = stage, { rom } = c;
  card.timer++;
  const away = card.timer * 20;
  if (card.timer === 12) {
    stage.state = 3;
    stage.freeTiles(card.tiles);
    stage.cardCover = false;
    stage.cardHides = false;
    c.destroyTask(t);
    return;
  }
  updateSprite(c, card.name);
  displaySprite(c, card.name);
  const emblem = card.emblem;
  emblem.x = 200 - away;
  emblem.y = 150;
  emblem.frameFlags = 0;
  updateSprite(c, emblem);
  displaySprite(c, emblem);
  const widths = (i, side) => (rom.u8(NAME_WIDTHS + i * 2 + side) << 24) >> 24;
  let x = 0xDC - away - widths(card.second, 1);
  card.secondName.x = x;
  updateSprite(c, card.secondName);
  displaySprite(c, card.secondName);
  x -= widths(card.second, 0) + 5;
  card.and.x = x;
  updateSprite(c, card.and);
  displaySprite(c, card.and);
  x -= 5 + widths(card.first, 1);
  card.firstName.x = x;
  updateSprite(c, card.firstName);
  displaySprite(c, card.firstName);
  card.bandHalf = 0xB - card.timer;
  bandAndFade(card);
}
