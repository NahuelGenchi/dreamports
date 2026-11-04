// The stage's numbers: rings, score, time and lives. Rewritten from 0x0802C9E4 and 0x0802CCE0.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';

const ANIM_ASCII = 1119, ANIM_LIFE_COUNTER = 1125, ANIM_RING_CONTAINER = 1126, ANIM_RING = 1127;
const RED_NUMBERS = 0x7000, ICON_COLOURS = 0xD6ACE;
const TALL = 2 << 14, WIDE = 1 << 14;   // the shapes of a sprite's first attribute
const NUMBER_SIZE = 0, ICON_SIZE = 1 << 14, CONTAINER_SIZE = 3 << 14;   // and the sizes of its second
const tileOf = at => ((at - 0x10000) >> 5) & 0x3FF;
const HUNDREDTHS = 0xD6B80, TIME_LIMIT = 10 * 60 * 60;   // MAX_COURSE_TIME, in frames
const POWERS = [100000, 10000, 1000, 100, 10, 1];

export function createStageUi(stage) {
  const { c } = stage, { rom } = c, ui = { stage, ringFrame: 0 };
  const firstDigit = stage.allocTiles(24);
  ui.digits = [];
  for (let i = 0; i < 10; i++) {
    const s = createSprite({ tiles: firstDigit + i * 64, anim: ANIM_ASCII, variant: '0'.charCodeAt(0) - 32 + i });
    updateSprite(c, s);
    ui.digits.push(s);
  }
  const colon = createSprite({ tiles: firstDigit + 10 * 64, anim: ANIM_ASCII, variant: ':'.charCodeAt(0) - 32 });
  updateSprite(c, colon);
  ui.digitTiles = i => tileOf(firstDigit + i * 64) | 0x6000;
  const icon = createSprite({ tiles: stage.allocTiles(4), anim: ANIM_LIFE_COUNTER, variant: 0, oamFlags: 4 << 6 });
  updateSprite(c, icon);
  ui.iconTiles = tileOf(icon.tiles);
  const container = createSprite({ tiles: stage.allocTiles(32), anim: ANIM_RING_CONTAINER, variant: 0, oamFlags: 3 << 6, x: 0, y: 1 });
  updateSprite(c, container);
  ui.containerTiles = tileOf(container.tiles) | 0x6000;
  ui.ring = createSprite({ tiles: stage.allocTiles(4), anim: ANIM_RING, variant: 0, oamFlags: 0, x: 7, y: 9 });
  ui.ringTiles = tileOf(ui.ring.tiles) | 0x6000;
  for (let i = 0; i < 16; i++) c.objPalette[7 * 16 + i] = rom.u16(ICON_COLOURS + i * 2);
  c.flags |= 0x2;
  c.createTask(uiFrame, ui, 0x2102);
  return ui;
}

function put(c, order, attr0, attr1, attr2) {
  const k = c.allocOam(order);
  if (k < 0) return;
  c.oamMalloc[k * 4] = attr0;
  c.oamMalloc[k * 4 + 1] = attr1;
  c.oamMalloc[k * 4 + 2] = attr2;
}

function uiFrame(t) {
  const ui = t.data, { stage } = ui, { c } = stage, digit = ui.digitTiles;
  let score = Math.min(stage.score, 999999);
  POWERS.forEach((power, i) => {
    const d = Math.trunc(score / power);
    put(c, 3, TALL | 14, NUMBER_SIZE | (i * 8 + 28), digit(d));
    score -= d * power;
  });
  put(c, 3, 142, ICON_SIZE | 6, ui.iconTiles);
  put(c, 3, TALL | 140, NUMBER_SIZE | 30, digit(Math.min(Math.max(stage.lives - 1, 0), 9)));
  put(c, 4, WIDE, CONTAINER_SIZE | 0x1FD, ui.containerTiles);
  ui.ringFrame = (ui.ringFrame + (stage.player.velX >> 3) + 0x40) & 0x7FF;
  ui.ring.variant = ui.ringFrame >> 8;
  ui.ring.prevVariant = 0xFF;
  updateSprite(c, ui.ring);
  put(c, 3, 8, ICON_SIZE | 7, ui.ringTiles);
  const red = stage.rings === 0 && stage.frames & 0x10 ? RED_NUMBERS : 0;
  const hundreds = Math.trunc(stage.rings / 100), tens = Math.trunc((stage.rings - hundreds * 100) / 10);
  [hundreds, tens, stage.rings - hundreds * 100 - tens * 10].forEach((d, i) => put(c, 3, TALL, NUMBER_SIZE | (28 + i * 8), digit(d) | red));
  // the time, which shows no further than the frame before the limit: minutes, seconds and hundredths, with each frame's two
  // digits from gMillisRenderLUT
  put(c, 3, TALL, NUMBER_SIZE | 99, digit(10));
  put(c, 3, TALL, NUMBER_SIZE | 123, digit(10));
  const time = Math.min(stage.time, TIME_LIMIT - 1);
  const seconds = Math.trunc(time / 60), minutes = Math.trunc(seconds / 60), inSecond = seconds % 60, frames = time % 60;
  const show = (d, x) => {
    const s = ui.digits[d];
    s.x = x;
    s.y = 16;
    displaySprite(c, s);
  };
  show(c.rom.u8(HUNDREDTHS + frames * 2), 136);
  show(c.rom.u8(HUNDREDTHS + frames * 2 + 1), 144);
  show(Math.trunc(inSecond / 10), 112);
  show(inSecond % 10, 120);
  show(minutes, 96);
}
