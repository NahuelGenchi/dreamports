// mini-games.js's text in C: the font's glyphs written into a stretch of VRAM, one letter at a time, translated from
// the JavaScript version in games/sonic-battle/src/mini-games.js a function at a time. The original's functions are
// named by their address, as the JavaScript names them: 0x08020ecc the stretch, 0x08020978 a letter and 0x08020f64 a
// letter's width.

#include "text.h"

// the font: 32 bytes of pixels for each letter, each one's width, and for each byte of pixels, what it keeps of a
// word of VRAM and which of its nibbles it sets
#define GLYPHS 0x08071B7Cu
#define WIDTHS 0x0807173Cu
#define KEEP 0x0807A37Cu
#define SPREAD 0x0807A77Cu

static int textTo, textEnd, textStride, textRows, textBlock;

/** 0x08020ecc: the stretch of VRAM at `to`, `width` by `height` tiles, that the next letters go into. */
void textInto(uint32_t to, int width, int height) {
  textTo = (int)(to - VRAM);
  textEnd = textTo + width * height * 32;
  textStride = height * 8;
  textRows = height * 8;
  textBlock = height * 16;
}

/** 0x08020f64: a letter's width. */
int glyphWidth(int glyph) { return gba_rom[WIDTHS - CARTRIDGE + (uint32_t)(glyph & 0x7FFF)]; }

/** A byte of a letter's pixels into a word of VRAM, with `colour` where the byte's bits are set. */
static void putPixels(int at, int pixels, int colour) {
  if (!pixels || at >= textEnd) return;
  uint32_t word = (uint32_t)gba_vram[at] | ((uint32_t)gba_vram[at + 1] << 8) |
    ((uint32_t)gba_vram[at + 2] << 16) | ((uint32_t)gba_vram[at + 3] << 24);
  uint32_t keep = read32(KEEP + (uint32_t)pixels * 4);
  uint32_t spread = read32(SPREAD + (uint32_t)pixels * 4);
  uint32_t out = (word & keep) | (spread * (uint32_t)colour);
  gba_vram[at] = (uint8_t)out;
  gba_vram[at + 1] = (uint8_t)(out >> 8);
  gba_vram[at + 2] = (uint8_t)(out >> 16);
  gba_vram[at + 3] = (uint8_t)(out >> 24);
}

/** 0x08020978: a letter into the stretch, at `x` and `y` in pixels, over as many as three columns of tiles. Its width. */
int putGlyph(int x, int y, int glyph, int colour) {
  int shift = x & 7;
  uint32_t source = GLYPHS - CARTRIDGE + ((uint32_t)(glyph & 0x7FFF) << 5);
  int count = textRows <= y ? 0 : (textRows - y < 16 ? textRows - y : 16);
  for (int i = 0; i < count; i++) {
    int at = textTo + (((x >> 3) * textStride) + y + i) * 4;
    uint8_t first = gba_rom[source + (uint32_t)i * 2], second = gba_rom[source + (uint32_t)i * 2 + 1];
    putPixels(at, (first << shift) & 0xFF, colour);
    putPixels(at + textStride * 4, ((first >> (8 - shift)) | (second << shift)) & 0xFF, colour);
    putPixels(at + textBlock * 4, (second >> (8 - shift)) & 0xFF, colour);
  }
  return glyphWidth(glyph);
}
