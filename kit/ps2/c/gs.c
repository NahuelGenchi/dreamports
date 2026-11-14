// The GS: the PlayStation 2's graphics chip, as a game writes it (ps2.h). It keeps each frame's draw list, a hash of
// everything written that decides the picture, in the order written, exactly as the proof tools keep the original's
// (tools/libretro/play.patch), and it draws the list into its own memory, in software, for the page to show.
//
// What it draws: sprites and triangles, in lists, strips and fans, in one colour or shaded between their corners, with
// or without a texture, into a framebuffer of 32, 24 or 16 bits, inside the scissor, with the depth test, the alpha
// test, the test of the framebuffer's alpha, and blending. Textures are 32, 24 or 16-bit, or 8 or 4-bit with a palette,
// sampled by whole texels or by floats over Q, nearest or linear, and pictures move into its memory and within it as a
// game moves them. Not yet: fog, dithering, smaller copies of a texture (mipmaps), points and lines, and pictures read
// back. Its memory keeps each buffer a line after another, where the chip's is in blocks, which only a game that reads
// a buffer in another format than it was written in would show (kit/ps2/c/README.md).

#include "ps2-kit.h"

#define GS_MEMORY_WORDS (1024 * 1024)   // 4 MB, in 32-bit words
#define PAGE_WORDS 2048                 // what a framebuffer's or a depth buffer's place is counted in
#define BLOCK_WORDS 64                  // what a texture's, a palette's or a picture's place is counted in

// the pixel formats, as a register gives them
enum { PSMCT32 = 0x00, PSMCT24 = 0x01, PSMCT16 = 0x02, PSMCT16S = 0x0A, PSMT8 = 0x13, PSMT4 = 0x14, PSMT8H = 0x1B, PSMT4HL = 0x24, PSMT4HH = 0x2C, PSMZ32 = 0x30, PSMZ24 = 0x31, PSMZ16 = 0x32, PSMZ16S = 0x3A };

static uint32_t *memory;
static uint64_t registers[0x63];
static uint64_t shown[7];   // PMODE, SMODE2, DISPFB1, DISPLAY1, DISPFB2, DISPLAY2, BGCOLOR
static uint32_t list_hash = 0x811C9DC5, list_count;

// A corner as it was written: where it is in sixteenths of a pixel, its depth, its colour with its alpha in the top byte,
// and where it is in its texture, as floats over Q (s, t, q) and as sixteenths of a texel (u, v)
struct corner { int32_t x, y; uint32_t z, colour; float s, t, q; int32_t u, v; };
static struct corner corners[3];
static int corner_count;

static void add_to_list(const void *data, size_t length) {
  const uint8_t *bytes = data;
  for (size_t i = 0; i < length; i++) list_hash = (list_hash ^ bytes[i]) * 0x01000193u;
  list_count++;
}

void gs_power(void) {
  memory = kit_alloc(GS_MEMORY_WORDS * 4);
  gs_list_start();
}

void gs_list_start(void) {
  list_hash = 0x811C9DC5;
  list_count = 0;
}
uint32_t gs_list_hash(void) { return list_hash; }
uint32_t gs_list_count(void) { return list_count; }

static uint32_t field(uint64_t value, int from, int bits) { return (uint32_t)(value >> from) & ((1u << bits) - 1); }
static float float_of(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

// ---- Memory: a buffer at `base` words, `width` pixels across, a line after another

// how many bits a pixel takes, and for the formats kept in a 32-bit word's top byte, where in it
static int bits_per_pixel(int psm) {
  switch (psm) {
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: return 16;
  case PSMT8: return 8;
  case PSMT4: return 4;
  default: return 32;
  }
}

static uint32_t read_pixel(uint32_t base, int width, int psm, int x, int y) {
  if (x < 0 || y < 0 || width <= 0) return 0;
  uint64_t n = (uint64_t)y * (uint64_t)width + (uint64_t)x, word = base + n * (uint64_t)bits_per_pixel(psm) / 32;
  if (word >= GS_MEMORY_WORDS) return 0;
  uint32_t held = memory[word];
  switch (psm) {
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: return held >> (n & 1) * 16 & 0xFFFF;
  case PSMT8: return held >> (n & 3) * 8 & 0xFF;
  case PSMT4: return held >> (n & 7) * 4 & 0xF;
  case PSMT8H: return held >> 24;
  case PSMT4HL: return held >> 24 & 0xF;
  case PSMT4HH: return held >> 28;
  case PSMCT24: case PSMZ24: return held & 0xFFFFFF;
  default: return held;
  }
}

// writes a pixel's bits, those of `keep` staying as they were
static void write_pixel(uint32_t base, int width, int psm, int x, int y, uint32_t value, uint32_t keep) {
  if (x < 0 || y < 0 || width <= 0) return;
  uint64_t n = (uint64_t)y * (uint64_t)width + (uint64_t)x, word = base + n * (uint64_t)bits_per_pixel(psm) / 32;
  if (word >= GS_MEMORY_WORDS) return;
  uint32_t shift = 0, bits = 0xFFFFFFFF;
  switch (psm) {
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: shift = (uint32_t)(n & 1) * 16; bits = 0xFFFF; break;
  case PSMT8: shift = (uint32_t)(n & 3) * 8; bits = 0xFF; break;
  case PSMT4: shift = (uint32_t)(n & 7) * 4; bits = 0xF; break;
  case PSMT8H: shift = 24; bits = 0xFF; break;
  case PSMT4HL: shift = 24; bits = 0xF; break;
  case PSMT4HH: shift = 28; bits = 0xF; break;
  case PSMCT24: case PSMZ24: bits = 0xFFFFFF; break;
  default: break;
  }
  uint32_t written = (bits & ~keep) << shift;
  memory[word] = (memory[word] & ~written) | (value << shift & written);
}

// a 16-bit colour as a 32-bit one: five bits a channel, and its top bit as the alpha `one` or `zero` says
static uint32_t from_16(uint32_t colour, uint32_t one, uint32_t zero) {
  uint32_t r = (colour & 31) << 3, g = (colour >> 5 & 31) << 3, b = (colour >> 10 & 31) << 3;
  return r | g << 8 | b << 16 | (colour & 0x8000 ? one : zero) << 24;
}
static uint32_t to_16(uint32_t colour) {
  return (colour >> 3 & 31) | (colour >> 11 & 31) << 5 | (colour >> 19 & 31) << 10 | (colour >> 31) << 15;
}

// ---- Pictures moved into memory, and within it (BITBLTBUF, TRXPOS, TRXREG, TRXDIR, and IMAGE data)

static struct { int active, psm, x, y, left, top, w, h; uint32_t base; int width; uint8_t partial[3]; int partials; } transfer;

static void transfer_start(uint64_t direction) {
  uint64_t buffers = registers[GS_BITBLTBUF], place = registers[GS_TRXPOS], size = registers[GS_TRXREG];
  int dir = (int)(direction & 3);
  transfer.active = 0;
  if (dir == 0) {
    transfer = (__typeof__(transfer)){
      .active = 1, .psm = (int)field(buffers, 56, 6), .base = field(buffers, 32, 14) * BLOCK_WORDS, .width = (int)field(buffers, 48, 6) * 64,
      .left = (int)field(place, 32, 11), .top = (int)field(place, 48, 11), .w = (int)field(size, 0, 12), .h = (int)field(size, 32, 12),
    };
  } else if (dir == 2) {
    // from one place in memory to another, a line at a time from the top left
    int psm = (int)field(buffers, 0 + 24, 6);
    uint32_t from = field(buffers, 0, 14) * BLOCK_WORDS, to = field(buffers, 32, 14) * BLOCK_WORDS;
    int from_width = (int)field(buffers, 16, 6) * 64, to_width = (int)field(buffers, 48, 6) * 64, to_psm = (int)field(buffers, 56, 6);
    int sx = (int)field(place, 0, 11), sy = (int)field(place, 16, 11), dx = (int)field(place, 32, 11), dy = (int)field(place, 48, 11);
    for (int y = 0; y < (int)field(size, 32, 12); y++) {
      for (int x = 0; x < (int)field(size, 0, 12); x++) write_pixel(to, to_width, to_psm, dx + x, dy + y, read_pixel(from, from_width, psm, sx + x, sy + y), 0);
    }
  }
}

// the next pixel of a picture moved into memory
static void transfer_pixel(uint32_t value) {
  if (!transfer.active || transfer.y >= transfer.h) return;
  write_pixel(transfer.base, transfer.width, transfer.psm, transfer.left + transfer.x, transfer.top + transfer.y, value, 0);
  if (++transfer.x >= transfer.w) {
    transfer.x = 0;
    if (++transfer.y >= transfer.h) transfer.active = 0;
  }
}

static void transfer_data(const uint8_t *bytes, uint32_t length) {
  int bits = transfer.psm == PSMCT24 || transfer.psm == PSMZ24 ? 24 : bits_per_pixel(transfer.psm);
  for (uint32_t i = 0; i < length && transfer.active; i++) {
    if (bits == 24) {
      transfer.partial[transfer.partials++] = bytes[i];
      if (transfer.partials == 3) {
        transfer_pixel(transfer.partial[0] | (uint32_t)transfer.partial[1] << 8 | (uint32_t)transfer.partial[2] << 16);
        transfer.partials = 0;
      }
    } else if (bits == 4) {
      transfer_pixel(bytes[i] & 0xF);
      transfer_pixel(bytes[i] >> 4);
    } else if (bits == 8) {
      transfer_pixel(bytes[i]);
    } else if (bits == 16) {
      if (i + 1 < length) transfer_pixel(bytes[i] | (uint32_t)bytes[i + 1] << 8);
      i++;
    } else {
      if (i + 3 < length) transfer_pixel(bytes[i] | (uint32_t)bytes[i + 1] << 8 | (uint32_t)bytes[i + 2] << 16 | (uint32_t)bytes[i + 3] << 24);
      i += 3;
    }
  }
}

// ---- The palette, loaded from memory as TEX0's CLD says, and kept until the next load

static uint32_t palette[256];
static uint32_t palette_base[2];   // CBP0 and CBP1, for the loads that only happen when the palette has moved

static void palette_load(uint64_t tex0) {
  int cld = (int)field(tex0, 61, 3), psm = (int)field(tex0, 20, 6), cpsm = (int)field(tex0, 51, 4), csm = (int)field(tex0, 55, 1);
  uint32_t cbp = field(tex0, 37, 14);
  if (cld == 0 || cld > 5) return;
  if (cld >= 4) {
    if (palette_base[cld - 4] == cbp) return;
    palette_base[cld - 4] = cbp;
  } else if (cld >= 2) {
    palette_base[cld - 2] = cbp;
  }
  int eight = psm == PSMT8 || psm == PSMT8H, count = eight ? 256 : 16, start = eight ? 0 : (int)field(tex0, 56, 5) * 16 & 255;
  uint64_t layout = registers[GS_TEXCLUT];
  for (int i = 0; i < count; i++) {
    int x, y, width = 64;
    if (csm) {
      // in a row, where TEXCLUT says
      x = (int)field(layout, 6, 6) * 16 + i;
      y = (int)field(layout, 12, 10);
      width = (int)field(layout, 0, 6) * 64;
    } else if (eight) {
      // in a block of 16 by 16, with the 8 entries from 8 and those from 16 changing places in every 32
      int j = (i & ~0x18) | (i & 8) << 1 | (i & 16) >> 1;
      x = j & 15;
      y = j >> 4;
    } else {
      x = i & 7;
      y = i >> 3;
    }
    palette[(start + i) & 255] = read_pixel(cbp * BLOCK_WORDS, width, cpsm == 0 ? PSMCT32 : PSMCT16, x, y);
  }
}

// ---- Textures

struct texture { uint32_t base; int width, psm, w, h, tcc, tfx, cpsm, csa; uint64_t clamp, tex1, texa; };

static struct texture texture_of(int context) {
  uint64_t tex0 = registers[GS_TEX0_1 + context];
  return (struct texture){
    .base = field(tex0, 0, 14) * BLOCK_WORDS, .width = (int)field(tex0, 14, 6) * 64, .psm = (int)field(tex0, 20, 6),
    .w = 1 << field(tex0, 26, 4), .h = 1 << field(tex0, 30, 4), .tcc = (int)field(tex0, 34, 1), .tfx = (int)field(tex0, 35, 2),
    .cpsm = (int)field(tex0, 51, 4), .csa = (int)field(tex0, 56, 5), .clamp = registers[GS_CLAMP_1 + context], .tex1 = registers[GS_TEX1_1 + context],
    .texa = registers[GS_TEXA],
  };
}

// a texel's place across or down, as the edge it meets says: repeat, clamp, clamp to a region, repeat a region
static int wrapped(int place, int size, int mode, int min, int max) {
  switch (mode) {
  case 0: return place & (size - 1);
  case 1: return place < 0 ? 0 : place >= size ? size - 1 : place;
  case 2: return place < min ? min : place > max ? max : place;
  default: return (place & min) | max;
  }
}

static uint32_t texel(const struct texture *t, int u, int v) {
  u = wrapped(u, t->w, (int)field(t->clamp, 0, 2), (int)field(t->clamp, 4, 10), (int)field(t->clamp, 14, 10));
  v = wrapped(v, t->h, (int)field(t->clamp, 2, 2), (int)field(t->clamp, 24, 10), (int)field(t->clamp, 34, 10));
  uint32_t raw = read_pixel(t->base, t->width, t->psm, u, v);
  uint32_t ta0 = field(t->texa, 0, 8), ta1 = field(t->texa, 32, 8), aem = field(t->texa, 15, 1);
  switch (t->psm) {
  case PSMCT32: return raw;
  case PSMCT24: return raw | (aem && !raw ? 0 : ta0) << 24;
  case PSMCT16: case PSMCT16S: return from_16(raw, ta1, aem && !(raw & 0x7FFF) ? 0 : ta0);
  default: {
    int eight = t->psm == PSMT8 || t->psm == PSMT8H;
    uint32_t entry = palette[eight ? raw : (t->csa * 16 + raw) & 255];
    return t->cpsm == 0 ? entry : from_16(entry & 0xFFFF, ta1, aem && !(entry & 0x7FFF) ? 0 : ta0);
  }
  }
}

// the texture's colour at a place in texels, nearest or between the four nearest
static uint32_t sample(const struct texture *t, float u, float v, int linear) {
  if (!linear) return texel(t, (int)__builtin_floorf(u), (int)__builtin_floorf(v));
  u -= 0.5f;
  v -= 0.5f;
  int u0 = (int)__builtin_floorf(u), v0 = (int)__builtin_floorf(v);
  uint32_t fu = (uint32_t)((u - (float)u0) * 256), fv = (uint32_t)((v - (float)v0) * 256);
  uint32_t a = texel(t, u0, v0), b = texel(t, u0 + 1, v0), c = texel(t, u0, v0 + 1), d = texel(t, u0 + 1, v0 + 1), out = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    uint32_t top = ((a >> shift & 255) * (256 - fu) + (b >> shift & 255) * fu) >> 8, bottom = ((c >> shift & 255) * (256 - fu) + (d >> shift & 255) * fu) >> 8;
    out |= ((top * (256 - fv) + bottom * fv) >> 8) << shift;
  }
  return out;
}

// whether a pixel is drawn with the larger texture's filter or the smaller's, as TEX1 and Q say
static int filtered_linear(const struct texture *t, float q) {
  int lcm = (int)field(t->tex1, 0, 1), l = (int)field(t->tex1, 19, 2);
  float k = (float)(int16_t)(field(t->tex1, 32, 12) << 4) / 256;   // signed, with four bits after the point
  // log2 of 1/Q, from Q's own bits: its exponent, and its mantissa as the fraction between
  float log2_q = 0;
  if (q > 0) {
    uint32_t bits;
    __builtin_memcpy(&bits, &q, 4);
    log2_q = (float)((int32_t)(bits >> 23 & 0xFF) - 127) + (float)(bits & 0x7FFFFF) / 8388608.0f;
  }
  float lod = lcm ? k : -log2_q * (float)(1 << l) + k;
  int filter = lod <= 0 ? (int)field(t->tex1, 5, 1) : (int)field(t->tex1, 6, 3);
  return filter == 1 || filter == 4 || filter == 5;
}

// the colour a texture gives a shape's colour, as its function says: modulate, decal, highlight, highlight 2
static uint32_t textured(const struct texture *t, uint32_t shape, uint32_t tex) {
  uint32_t out = 0, af = shape >> 24, at = tex >> 24;
  for (int shift = 0; shift < 24; shift += 8) {
    uint32_t cf = shape >> shift & 255, ct = tex >> shift & 255, c = ct;
    if (t->tfx != 1) c = (cf * ct) >> 7;
    if (t->tfx >= 2) c += af;
    out |= (c > 255 ? 255 : c) << shift;
  }
  uint32_t a = af;
  if (t->tcc) a = t->tfx == 0 ? (af * at) >> 7 : t->tfx == 2 ? af + at : at;
  return out | (a > 255 ? 255 : a) << 24;
}

// ---- Where a shape lands, and each of its pixels

static int context(void) { return (int)(((registers[GS_PRMODECONT] & 1 ? registers[GS_PRIM] : registers[GS_PRMODE]) >> 9) & 1); }
static uint64_t prim(void) { return registers[GS_PRMODECONT] & 1 ? registers[GS_PRIM] : (registers[GS_PRIM] & 7) | (registers[GS_PRMODE] & ~7ull); }

struct target {
  uint32_t colour_at, depth_at, mask, depth_most;
  int width, psm, depth_psm, left, right, top, bottom, test, write_depth, blend, pabe, clamp_colour, fba;
  int alpha_test, alpha_ref, alpha_fail, date, datm, textured, linear_hint, uv;
  uint64_t alpha;
  struct texture texture;
};

static int target_of(struct target *t) {
  int c = context();
  uint64_t frame = registers[GS_FRAME_1 + c], zbuf = registers[GS_ZBUF_1 + c], scissor = registers[GS_SCISSOR_1 + c], test = registers[GS_TEST_1 + c], p = prim();
  t->width = (int)field(frame, 16, 6) * 64;
  t->psm = (int)field(frame, 24, 6);
  t->colour_at = field(frame, 0, 9) * PAGE_WORDS;
  t->mask = (uint32_t)(frame >> 32);
  t->depth_at = field(zbuf, 0, 9) * PAGE_WORDS;
  t->depth_psm = 0x30 | (int)field(zbuf, 24, 4);
  t->depth_most = t->depth_psm == PSMZ32 ? 0xFFFFFFFF : t->depth_psm == PSMZ24 ? 0xFFFFFF : 0xFFFF;
  t->left = (int)field(scissor, 0, 11);
  t->right = (int)field(scissor, 16, 11);
  t->top = (int)field(scissor, 32, 11);
  t->bottom = (int)field(scissor, 48, 11);
  if (!t->width || t->colour_at >= GS_MEMORY_WORDS) return 0;
  if (t->right >= t->width) t->right = t->width - 1;
  // the depth test: off or always, never, as near or nearer, nearer
  t->test = field(test, 16, 1) ? (int)field(test, 17, 2) : 1;
  t->write_depth = !field(zbuf, 32, 1);
  t->alpha_test = field(test, 0, 1) ? (int)field(test, 1, 3) : 1;
  t->alpha_ref = (int)field(test, 4, 8);
  t->alpha_fail = (int)field(test, 12, 2);
  t->date = (int)field(test, 14, 1);
  t->datm = (int)field(test, 15, 1);
  t->blend = (int)field(p, 6, 1) || (int)field(p, 7, 1);
  t->alpha = registers[GS_ALPHA_1 + c];
  t->pabe = (int)(registers[GS_PABE] & 1);
  t->clamp_colour = (int)(registers[GS_COLCLAMP] & 1);
  t->fba = (int)(registers[GS_FBA_1 + c] & 1);
  t->textured = (int)field(p, 4, 1);
  t->uv = (int)field(p, 8, 1);
  if (t->textured) t->texture = texture_of(c);
  return 1;
}

// a framebuffer pixel as a 32-bit colour, its alpha as the format keeps it
static uint32_t framebuffer_colour(const struct target *t, int x, int y) {
  uint32_t held = read_pixel(t->colour_at, t->width, t->psm, x, y);
  if (t->psm == PSMCT16 || t->psm == PSMCT16S) return from_16(held, 0x80, 0);
  if (t->psm == PSMCT24) return held | 0x80u << 24;
  return held;
}

static int alpha_passes(int test, uint32_t alpha, int ref) {
  switch (test) {
  case 0: return 0;
  case 1: return 1;
  case 2: return (int)alpha < ref;
  case 3: return (int)alpha <= ref;
  case 4: return (int)alpha == ref;
  case 5: return (int)alpha >= ref;
  case 6: return (int)alpha > ref;
  default: return (int)alpha != ref;
  }
}

// one pixel of a shape, with its colour already textured
static void plot(const struct target *t, int x, int y, uint32_t z, uint32_t colour) {
  if (z > t->depth_most) z = t->depth_most;
  uint32_t depth = read_pixel(t->depth_at, t->width, t->depth_psm, x, y);
  if (t->test == 0 || (t->test == 2 && z < depth) || (t->test == 3 && z <= depth)) return;
  uint32_t under = framebuffer_colour(t, x, y);
  if (t->date && (under >> 31) != (uint32_t)t->datm) return;
  int write_colour = 1, write_alpha = 1, write_depth = t->write_depth;
  if (!alpha_passes(t->alpha_test, colour >> 24, t->alpha_ref)) {
    // what's written of a pixel that fails: nothing, its colour, its depth, or its colour without its alpha
    if (t->alpha_fail == 0) return;
    write_colour = t->alpha_fail != 2;
    write_alpha = t->alpha_fail == 1;
    write_depth = write_depth && t->alpha_fail == 2;
  }
  if (t->blend && (!t->pabe || colour >> 31)) {
    // ((A - B) × C >> 7) + D, each of A, B and D the shape's colour, the framebuffer's or none, and C an alpha
    uint32_t pick_c = field(t->alpha, 4, 2), c = pick_c == 0 ? colour >> 24 : pick_c == 1 ? under >> 24 : field(t->alpha, 32, 8), out = colour & 0xFF000000;
    for (int shift = 0; shift < 24; shift += 8) {
      int32_t chosen[3] = { (int32_t)(colour >> shift & 255), (int32_t)(under >> shift & 255), 0 };
      int32_t a = chosen[field(t->alpha, 0, 2) > 2 ? 2 : field(t->alpha, 0, 2)], b = chosen[field(t->alpha, 2, 2) > 2 ? 2 : field(t->alpha, 2, 2)], d = chosen[field(t->alpha, 6, 2) > 2 ? 2 : field(t->alpha, 6, 2)];
      int32_t value = (((a - b) * (int32_t)c) >> 7) + d;
      value = t->clamp_colour ? (value < 0 ? 0 : value > 255 ? 255 : value) : value & 255;
      out |= (uint32_t)value << shift;
    }
    colour = out;
  }
  if (t->fba) colour |= 0x80000000u;
  if (write_colour) {
    uint32_t keep = t->mask | (write_alpha ? 0 : 0xFF000000u);
    if (t->psm == PSMCT16 || t->psm == PSMCT16S) {
      uint32_t merged = (under & keep) | (colour & ~keep);
      write_pixel(t->colour_at, t->width, t->psm, x, y, to_16(merged), 0);
    } else {
      write_pixel(t->colour_at, t->width, t->psm, x, y, colour, keep);
    }
  }
  if (write_depth) write_pixel(t->depth_at, t->width, t->depth_psm, x, y, z, 0);
}

// a shape's colour at a pixel, textured where it is, from where it is in its texture
static uint32_t coloured(const struct target *t, uint32_t colour, float s, float tt, float q, float u, float v) {
  if (!t->textured) return colour;
  float across, down;
  if (t->uv) { across = u; down = v; q = 1; }
  else {
    float over = q != 0 ? q : 1;
    across = s / over * (float)t->texture.w;
    down = tt / over * (float)t->texture.h;
  }
  return textured(&t->texture, colour, sample(&t->texture, across, down, filtered_linear(&t->texture, q)));
}

// the first pixel whose middle is at or past a place in sixteenths: a pixel's middle is on the whole number
static int first_pixel(int32_t sixteenths) { return (sixteenths + 15) >> 4; }

static void sprite(const struct corner *a, const struct corner *b) {
  struct target t;
  if (!target_of(&t)) return;
  int32_t x0 = a->x < b->x ? a->x : b->x, x1 = a->x < b->x ? b->x : a->x, y0 = a->y < b->y ? a->y : b->y, y1 = a->y < b->y ? b->y : a->y;
  int left = first_pixel(x0), right = first_pixel(x1) - 1, top = first_pixel(y0), bottom = first_pixel(y1) - 1;
  if (left < t.left) left = t.left;
  if (right > t.right) right = t.right;
  if (top < t.top) top = t.top;
  if (bottom > t.bottom) bottom = t.bottom;
  // its texture places run from the first corner's to the second's, each over the second's Q, read at a pixel's middle
  const struct corner *from = a->x <= b->x ? a : b, *to = from == a ? b : a, *high = a->y <= b->y ? a : b, *low = high == a ? b : a;
  float q = b->q != 0 ? b->q : 1;
  for (int y = top; y <= bottom; y++) {
    float down = y1 > y0 ? (float)(y * 16 + 8 - y0) / (float)(y1 - y0) : 0;
    for (int x = left; x <= right; x++) {
      float across = x1 > x0 ? (float)(x * 16 + 8 - x0) / (float)(x1 - x0) : 0;
      float s = (from->s + (to->s - from->s) * across) / q, tt = (high->t + (low->t - high->t) * down) / q;
      float u = ((float)from->u + (float)(to->u - from->u) * across) / 16, v = ((float)high->v + (float)(low->v - high->v) * down) / 16;
      plot(&t, x, y, b->z, coloured(&t, b->colour, s, tt, 1, u, v));
    }
  }
}

// twice the area of the triangle a, b and the place (x, y), in sixteenths: which side of the edge a to b the place is on
static int64_t edge(const struct corner *a, const struct corner *b, int32_t x, int32_t y) {
  return (int64_t)(b->x - a->x) * (y - a->y) - (int64_t)(b->y - a->y) * (x - a->x);
}
// an edge the chip counts as inside when a pixel's middle is on it: a top edge or a left one
static int owns_edge(const struct corner *a, const struct corner *b) {
  int32_t dx = b->x - a->x, dy = b->y - a->y;
  return (dy == 0 && dx > 0) || dy < 0;
}

static void triangle(const struct corner *a, const struct corner *b, const struct corner *c, int shaded) {
  struct target t;
  if (!target_of(&t)) return;
  // a shape in one colour has its last corner's, whichever way round it was written
  const struct corner *last = c;
  int64_t area = edge(a, b, c->x, c->y);
  if (area == 0) return;
  // the same way round either way it was written
  if (area < 0) { const struct corner *kept = b; b = c; c = kept; area = -area; }
  int32_t x0 = a->x, x1 = a->x, y0 = a->y, y1 = a->y;
  const struct corner *all[2] = { b, c };
  for (int i = 0; i < 2; i++) {
    if (all[i]->x < x0) x0 = all[i]->x;
    if (all[i]->x > x1) x1 = all[i]->x;
    if (all[i]->y < y0) y0 = all[i]->y;
    if (all[i]->y > y1) y1 = all[i]->y;
  }
  int left = first_pixel(x0), right = x1 >> 4, top = first_pixel(y0), bottom = y1 >> 4;
  if (left < t.left) left = t.left;
  if (right > t.right) right = t.right;
  if (top < t.top) top = t.top;
  if (bottom > t.bottom) bottom = t.bottom;
  int own_ab = owns_edge(a, b), own_bc = owns_edge(b, c), own_ca = owns_edge(c, a);
  for (int y = top; y <= bottom; y++) {
    for (int x = left; x <= right; x++) {
      // how much of each corner the pixel's middle has, the three adding up to the area
      int64_t wa = edge(b, c, x << 4, y << 4), wb = edge(c, a, x << 4, y << 4), wc = edge(a, b, x << 4, y << 4);
      if (wa < 0 || wb < 0 || wc < 0 || (wa == 0 && !own_bc) || (wb == 0 && !own_ca) || (wc == 0 && !own_ab)) continue;
      uint32_t z = (uint32_t)(((double)a->z * (double)wa + (double)b->z * (double)wb + (double)c->z * (double)wc) / (double)area);
      uint32_t colour = last->colour;
      if (shaded) {
        colour = 0;
        for (int shift = 0; shift < 32; shift += 8) {
          int64_t part = ((int64_t)(a->colour >> shift & 255) * wa + (int64_t)(b->colour >> shift & 255) * wb + (int64_t)(c->colour >> shift & 255) * wc) / area;
          colour |= (uint32_t)part << shift;
        }
      }
      if (t.textured) {
        // S, T and Q run straight across the screen, and S and T over Q make the place in the texture
        float fa = (float)wa / (float)area, fb = (float)wb / (float)area, fc = (float)wc / (float)area;
        float s = a->s * fa + b->s * fb + c->s * fc, tt = a->t * fa + b->t * fb + c->t * fc, q = a->q * fa + b->q * fb + c->q * fc;
        float u = ((float)a->u * fa + (float)b->u * fb + (float)c->u * fc) / 16, v = ((float)a->v * fa + (float)b->v * fb + (float)c->v * fc) / 16;
        colour = coloured(&t, colour, s, tt, q, u, v);
      }
      plot(&t, x, y, z, colour);
    }
  }
}

// a corner that draws: the shape PRIM names, once it has enough corners
static void corner_written(uint64_t value, int with_fog, int draws) {
  uint64_t offset = registers[GS_XYOFFSET_1 + context()], rgbaq = registers[GS_RGBAQ], st = registers[GS_ST], uv = registers[GS_UV];
  struct corner now = {
    .x = (int32_t)(value & 0xFFFF) - (int32_t)(offset & 0xFFFF), .y = (int32_t)((value >> 16) & 0xFFFF) - (int32_t)((offset >> 32) & 0xFFFF),
    .z = with_fog ? (uint32_t)((value >> 32) & 0xFFFFFF) : (uint32_t)(value >> 32), .colour = (uint32_t)rgbaq,
    .s = float_of((uint32_t)st), .t = float_of((uint32_t)(st >> 32)), .q = float_of((uint32_t)(rgbaq >> 32)),
    .u = (int32_t)field(uv, 0, 14), .v = (int32_t)field(uv, 16, 14),
  };
  int kind = (int)(prim() & 7), shaded = (int)((prim() >> 3) & 1);
  int needs = kind == 6 ? 2 : kind >= 3 && kind <= 5 ? 3 : 0;
  if (!needs) return;
  corners[corner_count++] = now;
  if (corner_count < needs) return;
  if (draws) {
    if (kind == 6) sprite(&corners[0], &corners[1]);
    else triangle(&corners[0], &corners[1], &corners[2], shaded);
  }
  // what the next shape keeps: none of a list's, the last two of a strip's, the first and the last of a fan's
  if (kind == 4) { corners[0] = corners[1]; corners[1] = corners[2]; corner_count = 2; }
  else if (kind == 5) { corners[1] = corners[2]; corner_count = 2; }
  else corner_count = 0;
}

void gs_write(uint8_t reg, uint64_t value) {
  uint8_t written[9];
  written[0] = reg;
  __builtin_memcpy(written + 1, &value, 8);
  add_to_list(written, sizeof written);
  if (reg >= sizeof registers / sizeof registers[0]) return;
  registers[reg] = value;
  if (reg == GS_PRIM) corner_count = 0;
  else if (reg == GS_XYZ2 || reg == GS_XYZF2) corner_written(value, reg == GS_XYZF2, 1);
  else if (reg == GS_XYZ3 || reg == GS_XYZF3) corner_written(value, reg == GS_XYZF3, 0);
  else if (reg == GS_TEX0_1 || reg == GS_TEX0_2) palette_load(value);
  else if (reg == GS_TEX2_1 || reg == GS_TEX2_2) {
    // TEX2 changes only TEX0's format and palette fields
    uint64_t fields = 0x3Full << 20 | 0x7FFFFFFull << 37, tex0 = (registers[reg - 0x10] & ~fields) | (value & fields);
    registers[reg - 0x10] = tex0;
    palette_load(tex0);
  } else if (reg == GS_TRXDIR) transfer_start(value);
}

void gs_image(const void *data, uint32_t length) {
  add_to_list(data, length);
  transfer_data(data, length);
}

void gs_screen(uint32_t address, uint32_t value) {
  static const uint32_t places[7] = { GS_PMODE, GS_SMODE2, GS_DISPFB1, GS_DISPLAY1, GS_DISPFB2, GS_DISPLAY2, GS_BGCOLOR };
  for (int i = 0; i < 7; i++) {
    if ((address & ~0xFu) != places[i]) continue;
    // what the screen shows of the framebuffer is part of the list, and its border's colour isn't
    if (i < 6) {
      uint32_t pair[2] = { address, value };
      add_to_list(pair, sizeof pair);
    }
    shown[i] = address & 4 ? (shown[i] & 0xFFFFFFFFull) | (uint64_t)value << 32 : (shown[i] & ~0xFFFFFFFFull) | value;
  }
}

void gs_show(void) {
  uint32_t *out = kit_screen(SCREEN_W, SCREEN_H);
  // the second circuit's buffer when only that one is on
  uint64_t buffer = (shown[0] & 3) == 2 ? shown[4] : shown[2];
  int width = (int)field(buffer, 9, 6) * 64, psm = (int)field(buffer, 15, 5), from_x = (int)field(buffer, 32, 11), from_y = (int)field(buffer, 43, 11);
  uint32_t at = field(buffer, 0, 9) * PAGE_WORDS;
  int on = (shown[0] & 3) != 0 && width > 0;
  for (int y = 0; y < SCREEN_H; y++) {
    for (int x = 0; x < SCREEN_W; x++) {
      uint32_t colour = 0;
      if (on && x + from_x < width) {
        uint32_t held = read_pixel(at, width, psm, x + from_x, y + from_y);
        colour = psm == PSMCT16 || psm == PSMCT16S ? from_16(held, 0, 0) : held;
      }
      out[y * SCREEN_W + x] = 0xFF000000u | (colour & 0xFFFFFF);
    }
  }
}
