// The font, shared by the screens that draw letters (the name entry, nameentry.c, and the options, options.c), as
// mini-games.js's textInto and putGlyph give it to the JavaScript screens.

#ifndef SONIC_BATTLE_TEXT_H
#define SONIC_BATTLE_TEXT_H

#include "game.h"

/** 0x08020ecc: the stretch of VRAM at `to`, `width` by `height` tiles, that the next letters go into. */
void textInto(uint32_t to, int width, int height);
/** 0x08020f64: a letter's width. */
int glyphWidth(int glyph);
/** 0x08020978: a letter into the stretch, at `x` and `y` in pixels, over as many as three columns of tiles. Its width. */
int putGlyph(int x, int y, int glyph, int colour);

/** 0x08020ad0: how wide a text in the cartridge is, in pixels, the width of its last line. */
int textWidth(uint32_t text);
/** 0x08020b74: a text in the cartridge into the stretch from `x` and `y`, each letter over its shadow. */
void putText(int x, int y, uint32_t text);

#endif
