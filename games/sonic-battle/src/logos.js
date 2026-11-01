// The SEGA and Sonic Team logos, the first thing the game shows (the decompilation's src/core.cpp: 0x08000210,
// 0x080006ec, 0x080003a8 and 0x08000724). The screen fades from white to its first picture, on rotating layer 2.
// Then each logo goes into the other rotating layer, hidden, and the two layers cross-fade a sixteenth every
// other frame: SEGA's logo in, then out again, then Sonic Team's, with SEGA's sound. Last, the screen fades to
// black. Start skips ahead: on SEGA's logo to where it fades out, and on Sonic Team's to where it does.

import { REG } from '../../../kit/gba/video.js';
import {
  KEY, newScreen, copyToVram, clearLayer, layerBits, layerCharBase, layerScreenBase, setBlend, setRotation,
  fadeToward, fadeToBlack, colours,
} from './core.js';

// the colour effect: alpha blending (1) of layer 2 (4) over layer 3 (8)
const ALPHA = 1, LAYER_2 = 4, LAYER_3 = 8;

/** 0x08000210: the logos' screen. `next` is what comes after them. */
export function logos(c, next) {
  c.afterLogos = next;
  newScreen(c, 1);   // 0x08016078
  // the first picture in layer 2 (tiles at 0x06000000, map at 0x06007000), and an empty one in layer 3
  copyToVram(c, 0x08328C74, 0x06000000, 0x10A0);
  copyToVram(c, 0x0832ADB4, 0x06007000, 0x200);
  copyToVram(c, 0x08330134, 0x06008000, 0x20);
  copyToVram(c, 0x08330174, 0x0600F000, 0x200);
  // both rotating layers 512 pixels across, in 256 colours: layer 2 in front, its tiles at character base 0
  // and its map at screen base 14; layer 3 behind it, at character base 2 and screen base 30
  clearLayer(c, 2);
  layerBits(c, 2, 0x4000); layerBits(c, 2, 0); layerBits(c, 2, 0x80); layerBits(c, 2, 0); layerBits(c, 2, 0);
  layerCharBase(c, 2, 0); layerScreenBase(c, 2, 0xE);
  clearLayer(c, 3);
  layerBits(c, 3, 0x4000); layerBits(c, 3, 2); layerBits(c, 3, 0x80); layerBits(c, 3, 0); layerBits(c, 3, 0);
  layerCharBase(c, 3, 2); layerScreenBase(c, 3, 0x1E);
  // neither layer scaled, turned or moved
  for (const base of [REG.BG2PA, REG.BG3PA]) {
    [0x100, 0, 0, 0x100, 0, 0, 0, 0].forEach((v, i) => c.video.write(base + i * 2, v));
  }
  setBlend(c, ALPHA, LAYER_2, LAYER_3, 0, 0x10, 0);
  c.callback = fadeIn;
  // 0x0801f638: every song stopped (m4aMPlayAllStop)
  c.counter = 0;
  c.blend = 0;
  c.blendTarget = 0;
}

// 0x080006ec: the colours from white to the first picture's (gUnknown_083270b4), then the logos
function fadeIn(c) {
  if (fadeToward(c, 0x05000000, 0x083270B4, 0x100)) {
    c.blendTarget = 0x10;
    c.callback = showLogos;
  }
}

// 0x080003a8: a frame count, at which each logo is copied into the hidden layer and the cross-fade turned
// toward it; layer 2's share of the blend moves 2 sixteenths a frame toward its target
function showLogos(c) {
  c.counter = (c.counter + 1) & 0xFFFF;
  switch (c.counter) {
    case 0x8:
      // SEGA's logo into layer 3, and the fade toward it
      copyToVram(c, 0x083272B4, 0x06008000, 0xAE0);
      copyToVram(c, 0x08328874, 0x0600F000, 0x200);
      c.blendTarget = 0;
      break;
    case 0x80:
      c.blendTarget = 0x10;
      break;
    case 0x88:
      // Sonic Team's logo into layer 3, and the fade toward it
      copyToVram(c, 0x0832B1B4, 0x06008000, 0x1600);
      copyToVram(c, 0x0832DDB4, 0x0600F000, 0x200);
      c.blendTarget = 0;
      break;
    case 0x90:
      // SEGA's sound (0x0801f618, m4aSongNumStart), and the next picture into layer 2, hidden for now
      c.sound?.play(400);
      copyToVram(c, 0x0832E1B4, 0x06000000, 0xDC0);
      copyToVram(c, 0x0832FD34, 0x06007000, 0x200);
      c.blendTarget = 0x10;
      break;
    case 0x108:
      c.blendTarget = 0;
      break;
    case 0x110:
      // layer 2 emptied, and the fade toward it
      copyToVram(c, 0x08330134, 0x06000000, 0x20);
      copyToVram(c, 0x08330174, 0x06007000, 0x200);
      c.blendTarget = 0x10;
      break;
    case 0x118:
      c.callback = fadeOut;
      break;
  }
  // Start, held on SEGA's logo or Sonic Team's, skips to where it fades out
  if (c.keys.held & KEY.START) {
    if (((c.counter - 0x19) & 0xFFFF) <= 0x66) c.counter = 0x7F;
    else if (((c.counter - 0xA1) & 0xFFFF) <= 0x66) c.counter = 0x107;
  }
  if (c.blend > c.blendTarget) c.blend -= 2;
  if (c.blend < c.blendTarget) c.blend += 2;
  setBlend(c, ALPHA, LAYER_2, LAYER_3, c.blend & 0xFF, (0x10 - c.blend) & 0xFF, 0);
  setRotation(c, 0, 0, 0x100, 0x100, 1, 1, 0, 2);
  setRotation(c, 0, 0, 0x100, 0x100, 1, 1, 0, 3);
}

// 0x08000724: every colour to black, then no colour effect, the palette cleared, and what comes next
function fadeOut(c) {
  if (fadeToBlack(c, 0x05000000, 0x100)) {
    setBlend(c, 0, 0, 0, 0, 0, 0);
    colours(c).fill(0);
    c.callback = c.afterLogos;
  }
}
