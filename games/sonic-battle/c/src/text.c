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

// the cycles 0x08020978 takes, as mGBA counts its instructions: a letter's start, each row's turn of the loop, and
// each stretch of pixels a row writes, the first column's and the next two's
#define LETTER_CYCLES 173
#define ROW_CYCLES 122
#define FIRST_CYCLES 62
#define NEXT_CYCLES 68

// a text's tokens: a new line, nothing, a colour that follows, a token skipped with the one after it, letters with no
// width, and the end
#define NEW_LINE 0xFFFD
#define NOTHING 0xFFFC
#define COLOUR 0xFFFB
#define SKIP_ONE 0xFFFA
#define SKIP_TWO 0xFFF9
#define NO_WIDTH 0xFFF8
#define NO_WIDTH_TWO 0xFFF7
#define END 0xFFFE
// 0x08020b74's colours: the letters' and their shadows'
#define TEXT_COLOUR 8
#define TEXT_SHADOW 9

static int textTo, textEnd, textStride, textRows, textBlock;

// the words written while they're kept: a description's longest text writes some 6,000
#define KEPT_WRITES 16384
static TextWrite kept[KEPT_WRITES];
static int keeping, keptCount;

void textKeepWrites(int on) {
  keeping = on;
  if (on) keptCount = 0;
}

const TextWrite *textWrites(int *count) {
  *count = keptCount;
  return kept;
}

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
  if (keeping && keptCount < KEPT_WRITES) kept[keptCount++] = (TextWrite){g.text_cycles, VRAM + (uint32_t)at, out};
}

/** 0x08020978: a letter into the stretch, at `x` and `y` in pixels, over as many as three columns of tiles. Its width. */
int putGlyph(int x, int y, int glyph, int colour) {
  int shift = x & 7;
  uint32_t source = GLYPHS - CARTRIDGE + ((uint32_t)(glyph & 0x7FFF) << 5);
  int count = textRows <= y ? 0 : (textRows - y < 16 ? textRows - y : 16);
  g.text_cycles += LETTER_CYCLES;
  for (int i = 0; i < count; i++) {
    int at = textTo + (((x >> 3) * textStride) + y + i) * 4;
    uint8_t first = gba_rom[source + (uint32_t)i * 2], second = gba_rom[source + (uint32_t)i * 2 + 1];
    // this row's turn of the loop, and each stretch of pixels it writes
    g.text_cycles += ROW_CYCLES + ((first << shift) & 0xFF ? FIRST_CYCLES : 0)
      + (((first >> (8 - shift)) | (second << shift)) & 0xFF ? NEXT_CYCLES : 0)
      + ((second >> (8 - shift)) & 0xFF ? NEXT_CYCLES : 0);
    putPixels(at, (first << shift) & 0xFF, colour);
    putPixels(at + textStride * 4, ((first >> (8 - shift)) | (second << shift)) & 0xFF, colour);
    putPixels(at + textBlock * 4, (second >> (8 - shift)) & 0xFF, colour);
  }
  return glyphWidth(glyph);
}

static int isLetter(uint16_t token) { return token != NOTHING && token != NO_WIDTH && token != NO_WIDTH_TWO; }

/** 0x08020ad0: how wide a text in the cartridge is, in pixels, the width of its last line. */
int textWidth(uint32_t text) {
  int width = 0;
  for (uint32_t at = text; read16(at) != END; at += 2) {
    uint16_t token = read16(at);
    if (token == NEW_LINE) width = 0;
    else if (token == COLOUR || token == SKIP_ONE || token == SKIP_TWO) at += 2;
    else if (isLetter(token)) width += glyphWidth(token);
  }
  return width;
}

/** 0x08020b74: a text in the cartridge into the stretch from `x` and `y`, each letter in `colour` over its shadow. */
void putTextIn(int x, int y, uint32_t text, int colour, int shadow) {
  int left = x, top = y;
  for (uint32_t at = text; read16(at) != END; at += 2) {
    uint16_t token = read16(at);
    if (token == NEW_LINE) { left = 0; top += 16; }
    else if (token == COLOUR) { at += 2; colour = read16(at); }
    else if (token == SKIP_ONE || token == SKIP_TWO) at += 2;
    else if (isLetter(token)) {
      putGlyph(left + 1, top + 1, token, shadow);
      left += putGlyph(left, top, token, colour);
    }
  }
}

void putText(int x, int y, uint32_t text) { putTextIn(x, y, text, TEXT_COLOUR, TEXT_SHADOW); }
