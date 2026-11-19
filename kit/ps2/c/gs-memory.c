// The GS's memory, laid out as the chip lays it out, so a buffer written in one format and read in another, as a game
// does to make a texture of its own picture, holds what the console's would (kit/ps2/c/README.md). 4 MB in 8 KB pages,
// each page 32 blocks of 256 bytes, each block 4 columns of 64 bytes, with the pixels of each format in their own order
// in each. The orders are the GS's, as its manual gives them, and the same as the console's emulator, Play!, keeps.
//
// Also here: pictures moved into memory, out of it and within it (BITBLTBUF, TRXPOS, TRXREG, TRXDIR), and the palette
// buffer, which TEX0's CLD loads from memory.

#include "gs-kit.h"

#define MEMORY_WORDS (1024 * 1024)   // 4 MB, in 32-bit words
#define BLOCK_WORDS 64
#define BLOCK_MASK 0x3FFF            // the blocks there are: a place past the last one wraps to the first

static uint32_t *memory;

void gs_memory_power(void) { memory = kit_alloc(MEMORY_WORDS * 4); }

static uint32_t field(uint64_t value, int from, int bits) { return (uint32_t)(value >> from) & ((1u << bits) - 1); }

// ---- Where a pixel is kept

// which block of a page each block-sized piece of it is, by its row and column in the page, for each layout
static const uint8_t blocks32[4][8] = {
  { 0, 1, 4, 5, 16, 17, 20, 21 }, { 2, 3, 6, 7, 18, 19, 22, 23 }, { 8, 9, 12, 13, 24, 25, 28, 29 }, { 10, 11, 14, 15, 26, 27, 30, 31 },
};
static const uint8_t blocksZ32[4][8] = {
  { 24, 25, 28, 29, 8, 9, 12, 13 }, { 26, 27, 30, 31, 10, 11, 14, 15 }, { 16, 17, 20, 21, 0, 1, 4, 5 }, { 18, 19, 22, 23, 2, 3, 6, 7 },
};
static const uint8_t blocks16[8][4] = {
  { 0, 2, 8, 10 }, { 1, 3, 9, 11 }, { 4, 6, 12, 14 }, { 5, 7, 13, 15 }, { 16, 18, 24, 26 }, { 17, 19, 25, 27 }, { 20, 22, 28, 30 }, { 21, 23, 29, 31 },
};
static const uint8_t blocks16S[8][4] = {
  { 0, 2, 16, 18 }, { 1, 3, 17, 19 }, { 8, 10, 24, 26 }, { 9, 11, 25, 27 }, { 4, 6, 20, 22 }, { 5, 7, 21, 23 }, { 12, 14, 28, 30 }, { 13, 15, 29, 31 },
};
static const uint8_t blocksZ16[8][4] = {
  { 24, 26, 16, 18 }, { 25, 27, 17, 19 }, { 28, 30, 20, 22 }, { 29, 31, 21, 23 }, { 8, 10, 0, 2 }, { 9, 11, 1, 3 }, { 12, 14, 4, 6 }, { 13, 15, 5, 7 },
};
static const uint8_t blocksZ16S[8][4] = {
  { 24, 26, 8, 10 }, { 25, 27, 9, 11 }, { 16, 18, 0, 2 }, { 17, 19, 1, 3 }, { 28, 30, 12, 14 }, { 29, 31, 13, 15 }, { 20, 22, 4, 6 }, { 21, 23, 5, 7 },
};
// which of a column's 16 words each pixel of a 32-bit format's column is in, two lines of 8
static const uint8_t columns32[2][8] = { { 0, 1, 4, 5, 8, 9, 12, 13 }, { 2, 3, 6, 7, 10, 11, 14, 15 } };
// which of a column's 32 halves each pixel of a 16-bit format's column is, two lines of 16
static const uint8_t columns16[2][16] = {
  { 0, 2, 8, 10, 16, 18, 24, 26, 1, 3, 9, 11, 17, 19, 25, 27 }, { 4, 6, 12, 14, 20, 22, 28, 30, 5, 7, 13, 15, 21, 23, 29, 31 },
};
// which word an 8 or 4-bit pixel is in: the 32-bit order, or the same with its halves changed round, every other pair of
// lines and the other way in every other column
static const uint8_t columnsPacked[2][2][8] = {
  { { 0, 1, 4, 5, 8, 9, 12, 13 }, { 2, 3, 6, 7, 10, 11, 14, 15 } }, { { 8, 9, 12, 13, 0, 1, 4, 5 }, { 10, 11, 14, 15, 2, 3, 6, 7 } },
};

static int is_depth(int psm) { return (psm & 0x30) == 0x30; }

int gs_transfer_bits(int psm) {
  switch (psm) {
  case PSMCT24: case PSMZ24: return 24;
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: return 16;
  case PSMT8: case PSMT8H: return 8;
  case PSMT4: case PSMT4HL: case PSMT4HH: return 4;
  default: return 32;
  }
}

// the word a pixel is in, and the bit its value starts at there. `width` is in 64-pixel columns, and an 8 or 4-bit
// format's pages, 128 pixels across, are half as many across
static uint32_t word_of(uint32_t block, uint32_t width, int psm, uint32_t x, uint32_t y, uint32_t *shift) {
  uint32_t page, piece, word;
  *shift = 0;
  switch (psm) {
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: {
    const uint8_t (*blocks)[4] = psm == PSMCT16 ? blocks16 : psm == PSMCT16S ? blocks16S : psm == PSMZ16 ? blocksZ16 : blocksZ16S;
    uint32_t half = columns16[y & 1][x & 15];
    page = (y >> 6) * width + (x >> 6);
    piece = blocks[(y >> 3) & 7][(x >> 4) & 3];
    word = ((y >> 1) & 3) * 16 + (half >> 1);
    *shift = (half & 1) * 16;
    break;
  }
  case PSMT8: {
    uint32_t column = (y >> 2) & 3;
    page = (y >> 6) * (width >> 1) + (x >> 7);
    piece = blocks32[(y >> 4) & 3][(x >> 4) & 7];
    word = column * 16 + columnsPacked[((y >> 1) & 1) ^ (column & 1)][y & 1][x & 7];
    *shift = (((x >> 3) & 1) * 2 + ((y >> 1) & 1)) * 8;
    break;
  }
  case PSMT4: {
    uint32_t column = (y >> 2) & 3;
    page = (y >> 7) * (width >> 1) + (x >> 7);
    piece = blocks16[(y >> 4) & 7][(x >> 5) & 3];
    word = column * 16 + columnsPacked[((y >> 1) & 1) ^ (column & 1)][y & 1][x & 7];
    *shift = (x & 0x18) + ((y & 2) << 1);
    break;
  }
  default:
    page = (y >> 5) * width + (x >> 6);
    piece = (is_depth(psm) ? blocksZ32 : blocks32)[(y >> 3) & 3][(x >> 3) & 7];
    word = ((y >> 1) & 3) * 16 + columns32[y & 1][x & 7];
    *shift = psm == PSMT4HH ? 28 : psm == PSMT8H || psm == PSMT4HL ? 24 : 0;
    break;
  }
  return ((block + page * GS_PAGE_BLOCKS + piece) & BLOCK_MASK) * BLOCK_WORDS + word;
}

// the bits of its word a pixel of a format has, from the bit it starts at
static uint32_t bits_of(int psm) {
  switch (gs_transfer_bits(psm)) {
  case 24: return 0xFFFFFF;
  case 16: return 0xFFFF;
  case 8: return 0xFF;
  case 4: return 0xF;
  default: return 0xFFFFFFFF;
  }
}

uint32_t gs_pixel(uint32_t block, uint32_t width, int psm, uint32_t x, uint32_t y) {
  uint32_t shift, word = word_of(block, width, psm, x, y, &shift);
  return memory[word] >> shift & bits_of(psm);
}

void gs_pixel_set(uint32_t block, uint32_t width, int psm, uint32_t x, uint32_t y, uint32_t value, uint32_t keep) {
  uint32_t shift, word = word_of(block, width, psm, x, y, &shift), written = (bits_of(psm) & ~keep) << shift;
  memory[word] = (memory[word] & ~written) | (value << shift & written);
}

// ---- Pictures moved into memory, out of it and within it

// the transfer going on: its buffer, its rectangle, the next pixel's place in it, and the bits of a pixel not yet whole
static struct {
  int direction, psm;
  uint32_t block, width, left, top, w, h, x, y, held;
  uint64_t bits;
} transfer = { .direction = -1 };

// the place a transfer's coordinates wrap at: they are 11 bits
#define WRAP 2047

void gs_transfer_start(uint64_t direction) {
  uint64_t buffers = gs_registers[GS_BITBLTBUF], place = gs_registers[GS_TRXPOS], size = gs_registers[GS_TRXREG];
  uint32_t w = field(size, 0, 12), h = field(size, 32, 12);
  transfer.direction = -1;
  transfer.bits = 0;
  transfer.held = 0;
  switch (direction & 3) {
  case 0: case 1: {
    // into memory, to the destination, or out of it, from the source
    int out = (direction & 3) == 1;
    transfer = (__typeof__(transfer)){
      .direction = out, .psm = (int)field(buffers, out ? 24 : 56, 6), .block = field(buffers, out ? 0 : 32, 14),
      .width = field(buffers, out ? 16 : 48, 6), .left = field(place, out ? 0 : 32, 11), .top = field(place, out ? 16 : 48, 11), .w = w, .h = h,
    };
    if (!w || !h) transfer.direction = -1;
    break;
  }
  case 2: {
    // from one place to another, a pixel at a time, from the corner TRXPOS's DIR names, so a copy onto itself moved
    // along comes out as the console's does
    int from_psm = (int)field(buffers, 24, 6), to_psm = (int)field(buffers, 56, 6), order = (int)field(place, 59, 2);
    uint32_t from = field(buffers, 0, 14), from_width = field(buffers, 16, 6), to = field(buffers, 32, 14), to_width = field(buffers, 48, 6);
    uint32_t sx = field(place, 0, 11), sy = field(place, 16, 11), dx = field(place, 32, 11), dy = field(place, 48, 11);
    for (uint32_t row = 0; row < h; row++) {
      uint32_t y = order & 1 ? h - 1 - row : row;
      for (uint32_t column = 0; column < w; column++) {
        uint32_t x = order & 2 ? w - 1 - column : column;
        uint32_t value = gs_pixel(from, from_width, from_psm, (sx + x) & WRAP, (sy + y) & WRAP);
        gs_pixel_set(to, to_width, to_psm, (dx + x) & WRAP, (dy + y) & WRAP, value, 0);
      }
    }
    break;
  }
  default: break;
  }
}

// the transfer's next place, and its end after the last
static void transfer_next(void) {
  if (++transfer.x < transfer.w) return;
  transfer.x = 0;
  if (++transfer.y >= transfer.h) transfer.direction = -1;
}

void gs_transfer_in(const uint8_t *bytes, uint32_t length) {
  uint32_t bits = (uint32_t)gs_transfer_bits(transfer.psm), mask = bits_of(transfer.psm);
  // each pixel's bits follow the last's, from the lowest bit of the first byte: two 4-bit pixels to a byte, the first in
  // its low half, and a 24-bit one in three bytes
  for (uint32_t i = 0; i < length && transfer.direction == 0; i++) {
    transfer.bits |= (uint64_t)bytes[i] << transfer.held;
    transfer.held += 8;
    while (transfer.held >= bits && transfer.direction == 0) {
      gs_pixel_set(transfer.block, transfer.width, transfer.psm, (transfer.left + transfer.x) & WRAP, (transfer.top + transfer.y) & WRAP, (uint32_t)transfer.bits & mask, 0);
      transfer.bits >>= bits;
      transfer.held -= bits;
      transfer_next();
    }
  }
}

void gs_read_image(void *data, uint32_t length) {
  uint8_t *out = data;
  uint32_t bits = (uint32_t)gs_transfer_bits(transfer.psm);
  for (uint32_t i = 0; i < length; i++) {
    while (transfer.held < 8 && transfer.direction == 1) {
      transfer.bits |= (uint64_t)gs_pixel(transfer.block, transfer.width, transfer.psm, (transfer.left + transfer.x) & WRAP, (transfer.top + transfer.y) & WRAP) << transfer.held;
      transfer.held += bits;
      transfer_next();
    }
    // what's past the picture's last pixel is nothing
    out[i] = (uint8_t)transfer.bits;
    transfer.bits >>= 8;
    transfer.held = transfer.held > 8 ? transfer.held - 8 : 0;
  }
}

// ---- The palette buffer: 512 entries of 16 bits. A 32-bit palette keeps each entry's low half in the first 256 and its
// high half in the second, so a 4-bit texture's CSA picks one of 16 such palettes, or one of 32 of 16 bits

static uint16_t palette[512];
static uint32_t palette_base[2];   // CBP0 and CBP1, for the loads that only happen when the palette has moved

static int is_eight(int psm) { return psm == PSMT8 || psm == PSMT8H; }
static int is_four(int psm) { return psm == PSMT4 || psm == PSMT4HL || psm == PSMT4HH; }
static int palette_format(int cpsm) { return cpsm == 0 ? PSMCT32 : cpsm == 0xA ? PSMCT16S : PSMCT16; }

void gs_palette_load(uint64_t tex0) {
  int psm = (int)field(tex0, 20, 6), cpsm = (int)field(tex0, 51, 4), csm = (int)field(tex0, 55, 1), cld = (int)field(tex0, 61, 3);
  uint32_t cbp = field(tex0, 37, 14), csa = field(tex0, 56, 5);
  // only a texture with a palette loads one
  if (!is_eight(psm) && !is_four(psm)) return;
  switch (cld) {
  case 1: break;
  case 2: case 3: palette_base[cld - 2] = cbp; break;
  case 4: case 5:
    if (palette_base[cld - 4] == cbp) return;
    palette_base[cld - 4] = cbp;
    break;
  default: return;
  }
  uint64_t layout = gs_registers[GS_TEXCLUT];
  int eight = is_eight(psm), count = eight ? 256 : 16, format = palette_format(cpsm);
  uint32_t first = eight ? 0 : csa * 16;
  for (int i = 0; i < count; i++) {
    uint32_t x, y, width = 1;
    if (csm) {
      // in a row, where TEXCLUT says
      x = field(layout, 6, 6) * 16 + (uint32_t)i;
      y = field(layout, 12, 10);
      width = field(layout, 0, 6);
    } else if (eight) {
      // in a 16 by 16 square, the 8 entries from 8 and those from 16 changing places in every 32
      uint32_t j = ((uint32_t)i & ~0x18u) | ((uint32_t)i & 8) << 1 | ((uint32_t)i & 16) >> 1;
      x = j & 15;
      y = j >> 4;
    } else {
      x = (uint32_t)i & 7;
      y = (uint32_t)i >> 3;
    }
    uint32_t entry = gs_pixel(cbp, width, format, x, y), at = first + (uint32_t)i;
    if (format == PSMCT32) {
      palette[at & 255] = (uint16_t)entry;
      palette[256 + (at & 255)] = (uint16_t)(entry >> 16);
    } else {
      palette[at & 511] = (uint16_t)entry;
    }
  }
}

uint32_t gs_palette_entry(uint64_t tex0, uint32_t index) {
  int psm = (int)field(tex0, 20, 6), cpsm = (int)field(tex0, 51, 4);
  uint32_t at = is_eight(psm) ? index : field(tex0, 56, 5) * 16 + index;
  if (palette_format(cpsm) == PSMCT32) return palette[at & 255] | (uint32_t)palette[256 + (at & 255)] << 16;
  return palette[at & 511];
}
