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

#endif
