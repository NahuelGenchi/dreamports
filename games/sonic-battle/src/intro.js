// The intro, after the logos and before the title screen (the decompilation's src/unknown_0803d748.cpp:
// 0x0803d748, 0x0803d860 and 0x0803dd14). It shows five pictures one after another, each a rotating layer 2
// image moving across the screen with layer 0 over it, then zooms a looping animation out and back in. Both its
// Start and the animation's last frame hand over to the title screen (title.js, 0x0803e1b0).

import { REG } from '../../../kit/gba/video.js';
import { KEY, newScreen, copyToVram, queueRegister, setBlend } from './core.js';
import { toTitle } from './title.js';

const CARTRIDGE = 0x08000000, SINE = 0x0804DF7C;
// BG2PA to BG2PD in the display registers; the kit names only the first
const BG2PA = REG.BG2PA, BG2PB = REG.BG2PA + 2, BG2PC = REG.BG2PA + 4, BG2PD = REG.BG2PA + 6;
const TILES = 0x06000000, MAP = 0x0600B800, LAYER_0_TILES = 0x0600C000, LAYER_0_MAP = 0x0600F800;

// 0x08172a3c: each picture's centre as it comes in (x, y), then the centre it moves to, and 0x08172a64: layer
// 0's scroll as each comes in, then where it moves to
const POSITIONS = 0x08172A3C, SCROLLS = 0x08172A64;

// 0x0803d860's five pictures: layer 2's palette, tiles and map, and layer 0's tiles and map, with how many
// 16-bit words of each there are
const PICTURES = [
  { palette: 0x083F4418, tiles: 0x083F4618, tilesWords: 0x1F80, map: 0x083F8518, mapWords: 0x200,
    layer0Tiles: 0x08409038, layer0TilesWords: 0x1D0, layer0Map: 0x084093D8, layer0MapWords: 0x400 },
  { palette: 0x083F8918, tiles: 0x083F8B18, tilesWords: 0x1FC0, map: 0x083FCA98, mapWords: 0x400,
    layer0Tiles: 0x08409BF8, layer0TilesWords: 0x410, layer0Map: 0x0840A418, layer0MapWords: 0x400 },
  { palette: 0x083FCE98, tiles: 0x083FD098, tilesWords: 0x1EC0, map: 0x08400E18, mapWords: 0x400,
    layer0Tiles: 0x0840AC38, layer0TilesWords: 0x370, layer0Map: 0x0840B318, layer0MapWords: 0x400 },
  { palette: 0x08401218, tiles: 0x08401418, tilesWords: 0x1C60, map: 0x08404CD8, mapWords: 0x400,
    layer0Tiles: 0x0840BB38, layer0TilesWords: 0x200, layer0Map: 0x0840BF38, layer0MapWords: 0x400 },
  { palette: 0x084050D8, tiles: 0x084052D8, tilesWords: 0x1CA0, map: 0x08408C18, mapWords: 0x400,
    layer0Tiles: 0x0840C758, layer0TilesWords: 0x2C0, layer0Map: 0x0840CCD8, layer0MapWords: 0x400 },
];

// 0x0803dd14's looping animation: six pictures, each layer 2's tiles and map. Only the first brings a palette
// too. The ones that move their centre a pixel up say so.
const ANIMATION = new Map([
  [0, { palette: 0x0840D4D8, tiles: 0x0840D6D8, tilesWords: 0xE20, map: 0x0840F318, mapWords: 0x200 }],
  [2, { tiles: 0x0840F918, tilesWords: 0xDA0, map: 0x08411458, mapWords: 0x200 }],
  [4, { tiles: 0x08411A58, tilesWords: 0xE20, map: 0x08413698, mapWords: 0x200, up: true }],
  [6, { tiles: 0x08413C98, tilesWords: 0xE80, map: 0x08415998, mapWords: 0x200 }],
  [8, { tiles: 0x08415F98, tilesWords: 0xE20, map: 0x08417BD8, mapWords: 0x200 }],
  [10, { tiles: 0x084181D8, tilesWords: 0xE20, map: 0x08419E18, mapWords: 0x200, up: true }],
]);

const s16 = value => (value << 16) >> 16;

/** One number of a table in the player's copy, which keeps them as signed 16-bit words. */
const fromTable = (c, table, index) => c.rom.s16(table - CARTRIDGE + index * 2);

/** One of `count` 16-bit words from the cartridge into the palette, as the original's DMA does. */
function copyToPalette(c, from, count) {
  const at = from - CARTRIDGE;
  for (let i = 0; i < count; i++) c.video.pal[i] = c.rom.u16(at + i * 2);
}

/** BG2X and BG2Y, low half first, as the original writes them: the high half keeps only 12 bits. */
function setReference(c, x, y) {
  c.video.write(REG.BG2X, x & 0xFFFF);
  c.video.write(REG.BG2X + 2, (x & 0x0FFF0000) >>> 16);
  c.video.write(REG.BG2Y, y & 0xFFFF);
  c.video.write(REG.BG2Y + 2, (y & 0x0FFF0000) >>> 16);
}

/** Start leaves the intro for the title screen (0x0803e1b0), whose frame 0 is the next one. */
function skip(c) { toTitle(c); }

/** 0x0803d748: the intro's start. */
export function intro(c) {
  newScreen(c, 1);             // 0x08016078
  c.video.vram.fill(0);        // 0x08017cb0
  c.video.pal.fill(c.video.pal[0], 1);   // 0x08017cd8
  queueRegister(c, REG.DISPCNT, 0x541);
  c.video.pal.fill(0);
  c.video.write(REG.BG0CNT, 0);
  c.video.write(REG.BG1CNT, 0);
  c.video.write(REG.BG2CNT, 0);
  c.video.write(REG.BG3CNT, 0);
  c.video.write(REG.BG2CNT, 0x5782);
  c.video.write(REG.BG0CNT, 0x1F0D);
  for (let reg = REG.BG0HOFS; reg < 0x20; reg += 2) c.video.write(reg, 0);
  setBlend(c, 0, 0, 0, 0, 0, 0);
  c.introTimer = 255;
  c.introScene = -1;
  c.introX = fromTable(c, POSITIONS, 0);
  c.introY = fromTable(c, POSITIONS, 1);
  c.introScroll = fromTable(c, SCROLLS, 0);
  c.introScale = 0;
  c.introScaleTarget = 0;
  c.introTargetX = 0;
  c.introTargetY = 0;
  c.sound?.stopAll();          // 0x0801f638
  c.sound?.play(0);            // 0x0801f618
  c.callback = pictures;
}

/** 0x0803d860: the five pictures, each panned toward its target, then the animation. */
function pictures(c) {
  if (c.introTimer > 12) {
    c.introScene++;
    const picture = PICTURES[c.introScene];
    copyToPalette(c, picture.palette, 0x100);
    copyToVram(c, picture.tiles, TILES, picture.tilesWords);
    copyToVram(c, picture.map, MAP, picture.mapWords);
    copyToVram(c, picture.layer0Tiles, LAYER_0_TILES, picture.layer0TilesWords);
    copyToVram(c, picture.layer0Map, LAYER_0_MAP, picture.layer0MapWords);
    c.introTimer = 0;
    c.introX = fromTable(c, POSITIONS, c.introScene * 2);
    c.introY = fromTable(c, POSITIONS, c.introScene * 2 + 1);
    c.introScroll = fromTable(c, SCROLLS, c.introScene);
  } else {
    c.introTimer++;
    if (c.introScene > 3 && c.introTimer > 7) {
      c.introTimer = -1;
      c.introScene = -1;
      c.introScale = 1;
      c.introScaleTarget = 256;
      c.callback = animation;
    }
  }
  c.introX = s16(c.introX - ((c.introX - fromTable(c, POSITIONS, 10 + c.introScene * 2)) >> 2));
  c.introY = s16(c.introY - ((c.introY - fromTable(c, POSITIONS, 11 + c.introScene * 2)) >> 2));
  c.introScroll = s16(c.introScroll - ((c.introScroll - fromTable(c, SCROLLS, 5 + c.introScene)) >> 2));
  c.video.write(REG.BG2PA, 0x100);
  c.video.write(BG2PB, 0);
  c.video.write(BG2PC, 0);
  c.video.write(BG2PD, 0x100);
  setReference(c, ((120 - c.introX) << 8) - 0x7800, ((120 - c.introY) << 8) - 0x5000);
  c.video.write(REG.BG0HOFS + 2, c.introScroll & 0xFFFF);   // BG0VOFS
  if (c.keys.held & KEY.START) skip(c);
}

/** 0x0803dd14: a looping animation, scaled out to 320 and back in to 176, moved to (54, -24) on the way. */
function animation(c) {
  c.introTimer++;
  c.introScene++;
  if (c.introTimer === 0) {
    queueRegister(c, REG.DISPCNT, 0x441);
    c.video.write(REG.BG2CNT, 0x5782);
    c.introX = -8;
    c.introY = 30;
    c.introTargetX = -8;
    c.introTargetY = 30;
  }
  if (c.introScene > 11) c.introScene = 0;
  const frame = ANIMATION.get(c.introScene);
  if (frame) {
    if (frame.palette) copyToPalette(c, frame.palette, 0x100);
    copyToVram(c, frame.tiles, TILES, frame.tilesWords);
    copyToVram(c, frame.map, MAP, frame.mapWords);
    if (frame.up) c.introTargetY = s16(c.introTargetY - 1);
  }
  c.introX = s16(c.introX - ((c.introX - c.introTargetX) >> 2));
  c.introY = s16(c.introY - ((c.introY - c.introTargetY) >> 2));
  c.introScale = s16(c.introScale - ((c.introScale - c.introScaleTarget) >> 2));
  if (c.introTimer === 60) c.introScaleTarget = 320;
  else if (c.introTimer === 75) {
    c.introScaleTarget = 176;
    c.introTargetX = 54;
    c.introTargetY = -24;
  } else if (c.introTimer === 90) {
    c.introTimer = -1;
    c.introScene = -1;
    c.introScroll = 0;
    c.introX = 0;
    c.introY = 0;
    c.introTargetX = 0;
    c.introTargetY = 0;
    toTitle(c);
  }
  // BG2's matrix at angle 0: pa and pd the cosine, pb the sine, pc its negation, each over the scale
  const cosine = c.rom.s16(SINE - CARTRIDGE + 0x800 * 2) << 3;
  const sine = c.rom.s16(SINE - CARTRIDGE) << 3;
  const divide = (denominator, numerator) => Math.trunc(numerator / denominator);
  const pa = divide(c.introScale, cosine) & 0xFFFF;
  const pb = divide(c.introScale, sine) & 0xFFFF;
  const pc = -divide(c.introScale, sine) & 0xFFFF;
  const pd = divide(c.introScale, cosine) & 0xFFFF;
  c.video.write(REG.BG2PA, pa);
  c.video.write(BG2PB, pb);
  c.video.write(BG2PC, pc);
  c.video.write(BG2PD, pd);
  setReference(c, ((120 - c.introX) << 8) - s16(pa) * 120 - s16(pb) * 80,
    ((120 - c.introY) << 8) - s16(pc) * 120 - s16(pd) * 80);
  if (c.keys.held & KEY.START) skip(c);
}
