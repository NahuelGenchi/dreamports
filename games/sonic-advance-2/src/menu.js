// What the screens of the options share: their sprites, whose tiles come one after another in video memory, and the tables they read them from.

import { createSprite, updateSprite } from './sprite.js';

const OBJ_VRAM = 0x10000;

/** An entry of a table of sprites: its animation, its variant and how many tiles it takes. */
export const entry = (rom, table, i) => ({ anim: rom.u16(table + i * 8), variant: rom.u8(table + i * 8 + 2), tiles: rom.u16(table + i * 8 + 4) });

/** 0x0806A568, sub_806A568: a sprite whose tiles come next in video memory, and its animation started. */
export function place(c, screen, tiles, anim, x, y, order, variant, frameFlags) {
  screen.nextTiles ??= OBJ_VRAM;
  const s = createSprite({ tiles: screen.nextTiles, anim, variant, x, y, oamFlags: order << 6, frameFlags });
  screen.nextTiles += tiles * 32;
  updateSprite(c, s);
  return s;
}
