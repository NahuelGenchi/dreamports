// The GS: the PlayStation 2's graphics chip, as a game writes it (ps2.h). It keeps each frame's draw list, a hash of
// everything written that decides the picture, in the order written, exactly as the proof tools keep the original's
// (tools/libretro/play.patch), and it draws the list into its own memory, in software, for the page to show.
//
// What it draws: points, lines, sprites and triangles, in lists, strips and fans, in one colour or shaded between their
// corners, antialiased or not, with or without a texture, in the fog, into a framebuffer of 32, 24 or 16 bits, dithered
// into 16, inside the scissor, with the depth test, the alpha test, the test of the framebuffer's alpha, and blending.
// Textures are 32, 24 or 16-bit, or 8 or 4-bit with a palette, placed by whole texels or by floats over Q, sampled
// nearest or between four texels, from the texture or its smaller copies. Its memory, pictures moved in and out of it
// and the palette buffer are in gs-memory.c, laid out as the chip's are, and what the screen shows, both read circuits
// merged, and its status are at the end of this file (kit/ps2/c/README.md).

#include "gs-kit.h"

uint64_t gs_registers[0x63];
static uint32_t list_hash = 0x811C9DC5, list_count;
// the frame's whole list, as the proof tools write the original's (tools/lib/draw-lists.mjs), for them to say which
// write differs: each thing its letter and what was written, a picture's length and hash in place of its bytes
#define LIST_ROOM (16 * 1024 * 1024)
static uint8_t *list_bytes;
static uint32_t list_size, list_full;

// A corner as it was written: where it is in sixteenths of a pixel, its depth, its colour with its alpha in the top byte,
// and where it is in its texture, as floats over Q (s, t, q) and as sixteenths of a texel (u, v)
struct corner { int32_t x, y; uint32_t z, colour, fog; float s, t, q; int32_t u, v; };
static struct corner corners[3];
static int corner_count;
// the fog the next corner has, 0 to 255: FOG's, or the last XYZF's
static uint32_t fog_now;

static void keep_in_list(const void *data, size_t length) {
  if (list_size + length > LIST_ROOM) { list_full = 1; return; }
  __builtin_memcpy(list_bytes + list_size, data, length);
  list_size += (uint32_t)length;
}

void gs_list_add(char kind, const void *data, size_t length) {
  const uint8_t *bytes = data;
  uint32_t own = 0x811C9DC5;
  for (size_t i = 0; i < length; i++) {
    list_hash = (list_hash ^ bytes[i]) * 0x01000193u;
    own = (own ^ bytes[i]) * 0x01000193u;
  }
  list_count++;
  keep_in_list(&kind, 1);
  if (kind == 'I') {
    uint32_t about[2] = { (uint32_t)length, own };
    keep_in_list(about, sizeof about);
  } else {
    keep_in_list(data, length);
  }
}

static void list_reset(void) {
  list_hash = 0x811C9DC5;
  list_count = 0;
  list_size = 0;
  list_full = 0;
}
void gs_power(void) {
  gs_memory_power();
  list_bytes = kit_alloc(LIST_ROOM);
  list_reset();
}

static void vblank(void);
void gs_list_start(void) {
  list_reset();
  vblank();
}
const uint8_t *gs_list_bytes(uint32_t *size) {
  *size = list_full ? 0xFFFFFFFF : list_size;
  return list_bytes;
}
uint32_t gs_list_hash(void) { return list_hash; }
uint32_t gs_list_count(void) { return list_count; }

static uint32_t field(uint64_t value, int from, int bits) { return (uint32_t)(value >> from) & ((1u << bits) - 1); }
static float float_of(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

static int is_24(int psm) { return psm == PSMCT24 || psm == PSMZ24; }

static uint32_t to_16(uint32_t colour) {
  return (colour >> 3 & 31) | (colour >> 11 & 31) << 5 | (colour >> 19 & 31) << 10 | (colour >> 31) << 15;
}

// ---- Textures

struct texture { uint32_t block, width; int psm, w, h, tcc, tfx; uint64_t tex0, clamp, tex1, texa, smaller[2]; };

static struct texture texture_of(int context) {
  uint64_t tex0 = gs_registers[GS_TEX0_1 + context];
  return (struct texture){
    .block = field(tex0, 0, 14), .width = field(tex0, 14, 6), .psm = (int)field(tex0, 20, 6),
    .w = 1 << field(tex0, 26, 4), .h = 1 << field(tex0, 30, 4), .tcc = (int)field(tex0, 34, 1), .tfx = (int)field(tex0, 35, 2),
    .tex0 = tex0, .clamp = gs_registers[GS_CLAMP_1 + context], .tex1 = gs_registers[GS_TEX1_1 + context], .texa = gs_registers[GS_TEXA],
    .smaller = { gs_registers[GS_MIPTBP1_1 + context], gs_registers[GS_MIPTBP2_1 + context] },
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

// a texel of the texture, or of one of its smaller copies, 1 to 6, each half the one before across and down, whose
// places MIPTBP1 and MIPTBP2 give
static uint32_t texel(const struct texture *t, int level, int u, int v) {
  uint32_t block = t->block, width = t->width;
  if (level > 0) {
    uint64_t places = t->smaller[(level - 1) / 3];
    block = field(places, (level - 1) % 3 * 20, 14);
    width = field(places, (level - 1) % 3 * 20 + 14, 6);
  }
  int w = t->w >> level ? t->w >> level : 1, h = t->h >> level ? t->h >> level : 1;
  u = wrapped(u, w, (int)field(t->clamp, 0, 2), (int)field(t->clamp, 4, 10) >> level, (int)field(t->clamp, 14, 10) >> level);
  v = wrapped(v, h, (int)field(t->clamp, 2, 2), (int)field(t->clamp, 24, 10) >> level, (int)field(t->clamp, 34, 10) >> level);
  uint32_t raw = gs_pixel(block, width, t->psm, (uint32_t)u, (uint32_t)v);
  uint32_t ta0 = field(t->texa, 0, 8), ta1 = field(t->texa, 32, 8), aem = field(t->texa, 15, 1);
  switch (t->psm) {
  case PSMCT24: case PSMZ24: return raw | (aem && !raw ? 0 : ta0) << 24;
  case PSMCT16: case PSMCT16S: case PSMZ16: case PSMZ16S: return gs_from_16(raw, ta1, aem && !(raw & 0x7FFF) ? 0 : ta0);
  case PSMT8: case PSMT8H: case PSMT4: case PSMT4HL: case PSMT4HH: {
    uint32_t entry = gs_palette_entry(t->tex0, raw);
    return field(t->tex0, 51, 4) == 0 ? entry : gs_from_16(entry, ta1, aem && !(entry & 0x7FFF) ? 0 : ta0);
  }
  default: return raw;
  }
}

// a colour part of the way from one to another, in `steps` steps, each channel by itself
static uint32_t mixed(uint32_t from, uint32_t to, int32_t part, int steps) {
  uint32_t out = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    int32_t a = (int32_t)(from >> shift & 255), b = (int32_t)(to >> shift & 255);
    out |= (uint32_t)((a + (((b - a) * part) >> steps)) & 255) << shift;
  }
  return out;
}

// the colour of one size of the texture at a place in 65536ths of a texel of the largest: the texel it's in, or the four
// nearest mixed by how far it is between them, in sixteenths, across and then down
static uint32_t sample(const struct texture *t, int level, int32_t u, int32_t v, int linear) {
  u >>= level;
  v >>= level;
  if (!linear) return texel(t, level, u >> 16, v >> 16);
  u -= 0x8000;
  v -= 0x8000;
  int u0 = u >> 16, v0 = v >> 16, across = u >> 12 & 15, down = v >> 12 & 15;
  uint32_t top = mixed(texel(t, level, u0, v0), texel(t, level, u0 + 1, v0), across, 4);
  uint32_t bottom = mixed(texel(t, level, u0, v0 + 1), texel(t, level, u0 + 1, v0 + 1), across, 4);
  return mixed(top, bottom, down, 4);
}

// the texture's colour at a place in texels, from the size and with the filter TEX1 chooses by how small the texture is
// drawn: the level of detail is K where LCM says so, or the logarithm of 1/Q, shifted by L, plus K. At 0 or less the
// texture is drawn larger and MMAG filters it. Above, MMIN picks: the largest alone, or the size the level rounds to, or
// the two sizes it's between, mixed by how far, each by its nearest texel or between four
static uint32_t filtered(const struct texture *t, float across, float down, float q) {
  int lcm = (int)field(t->tex1, 0, 1), most = (int)field(t->tex1, 2, 3), larger = (int)field(t->tex1, 5, 1), smaller = (int)field(t->tex1, 6, 3);
  float k = (float)(int16_t)(field(t->tex1, 32, 12) << 4) / 256;   // signed, with four bits after the point
  // log2 of Q, from Q's own bits: its exponent, and its mantissa as the fraction between
  float log2_q = 0;
  if (q > 0) {
    uint32_t bits;
    __builtin_memcpy(&bits, &q, 4);
    log2_q = (float)((int32_t)(bits >> 23 & 0xFF) - 127) + (float)(bits & 0x7FFFFF) / 8388608.0f;
  }
  float lod = lcm ? k : -log2_q * (float)(1 << field(t->tex1, 19, 2)) + k;
  int32_t u = (int32_t)(across * 65536), v = (int32_t)(down * 65536);
  if (lod <= 0) return sample(t, 0, u, v, larger);
  if (smaller < 2 || most == 0) return sample(t, 0, u, v, smaller == 1 || smaller >= 4);
  if (lod > (float)most) lod = (float)most;
  int linear = smaller >= 4;
  if (smaller == 2 || smaller == 4) {
    int level = (int)(lod + 0.5f);
    return sample(t, level > most ? most : level, u, v, linear);
  }
  int level = (int)lod, next = level + 1 > most ? most : level + 1;
  return mixed(sample(t, level, u, v, linear), sample(t, next, u, v, linear), (int32_t)((lod - (float)level) * 32768), 15);
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

static int context(void) { return (int)(((gs_registers[GS_PRMODECONT] & 1 ? gs_registers[GS_PRIM] : gs_registers[GS_PRMODE]) >> 9) & 1); }
static uint64_t prim(void) { return gs_registers[GS_PRMODECONT] & 1 ? gs_registers[GS_PRIM] : (gs_registers[GS_PRIM] & 7) | (gs_registers[GS_PRMODE] & ~7ull); }

struct target {
  uint32_t colour_at, depth_at, width, mask, depth_most;
  int psm, depth_psm, left, right, top, bottom, test, write_depth, blend, pabe, clamp_colour, fba, covered, blends;
  int alpha_test, alpha_ref, alpha_fail, date, datm, textured, uv, skipped_lines, fogged, dithered;
  uint32_t fog_colour;
  int8_t dither[4][4];
  uint64_t alpha;
  struct texture texture;
};

static int target_of(struct target *t) {
  int c = context();
  uint64_t frame = gs_registers[GS_FRAME_1 + c], zbuf = gs_registers[GS_ZBUF_1 + c], scissor = gs_registers[GS_SCISSOR_1 + c], test = gs_registers[GS_TEST_1 + c], p = prim();
  t->width = field(frame, 16, 6);
  t->psm = (int)field(frame, 24, 6);
  t->colour_at = field(frame, 0, 9) * GS_PAGE_BLOCKS;
  t->mask = (uint32_t)(frame >> 32);
  t->depth_at = field(zbuf, 0, 9) * GS_PAGE_BLOCKS;
  t->depth_psm = 0x30 | (int)field(zbuf, 24, 4);
  t->depth_most = t->depth_psm == PSMZ32 ? 0xFFFFFFFF : t->depth_psm == PSMZ24 ? 0xFFFFFF : 0xFFFF;
  t->left = (int)field(scissor, 0, 11);
  t->right = (int)field(scissor, 16, 11);
  t->top = (int)field(scissor, 32, 11);
  t->bottom = (int)field(scissor, 48, 11);
  if (!t->width) return 0;
  // the depth test: off or always, never, as near or nearer, nearer
  t->test = field(test, 16, 1) ? (int)field(test, 17, 2) : 1;
  t->write_depth = !field(zbuf, 32, 1);
  t->alpha_test = field(test, 0, 1) ? (int)field(test, 1, 3) : 1;
  t->alpha_ref = (int)field(test, 4, 8);
  t->alpha_fail = (int)field(test, 12, 2);
  t->date = (int)field(test, 14, 1);
  t->datm = (int)field(test, 15, 1);
  // AA1: a line's or a triangle's alpha is how much of the pixel it covers, and it's blended whether ABE says so or not
  t->covered = (int)field(p, 7, 1) && (p & 7) >= 1 && (p & 7) <= 5;
  t->blends = (int)field(p, 6, 1);
  t->blend = t->blends || t->covered;
  t->alpha = gs_registers[GS_ALPHA_1 + c];
  t->pabe = (int)(gs_registers[GS_PABE] & 1);
  t->clamp_colour = (int)(gs_registers[GS_COLCLAMP] & 1);
  t->fba = (int)(gs_registers[GS_FBA_1 + c] & 1);
  t->textured = (int)field(p, 4, 1);
  t->uv = (int)field(p, 8, 1);
  // SCANMSK: no line drawn whose number is even (2) or odd (3)
  t->skipped_lines = gs_registers[GS_SCANMSK] & 2 ? (int)(gs_registers[GS_SCANMSK] & 1) : -1;
  t->fogged = (int)field(p, 5, 1);
  t->fog_colour = (uint32_t)gs_registers[GS_FOGCOL] & 0xFFFFFF;
  // dithering: only into 16 bits, with DIMX's sixteen numbers from -4 to 3, one for each place in a 4 by 4 square
  t->dithered = (gs_registers[GS_DTHE] & 1) && gs_is_16(t->psm);
  for (int i = 0; i < 16; i++) t->dither[i >> 2][i & 3] = (int8_t)((int)field(gs_registers[GS_DIMX], i * 4, 3) ^ 4) - 4;
  if (t->textured) t->texture = texture_of(c);
  return 1;
}

// a framebuffer pixel as a 32-bit colour, its alpha as the format keeps it
static uint32_t framebuffer_colour(const struct target *t, int x, int y) {
  uint32_t held = gs_pixel(t->colour_at, t->width, t->psm, (uint32_t)x, (uint32_t)y);
  if (gs_is_16(t->psm)) return gs_from_16(held, 0x80, 0);
  if (is_24(t->psm)) return held | 0x80u << 24;
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

// one pixel of a shape, with its colour already textured. `cover` is how much of the pixel an antialiased edge covers,
// 0 to 127, or less than 0 for a pixel that isn't on one: a pixel on one writes no depth
static void plot_covered(const struct target *t, int x, int y, uint32_t z, uint32_t colour, int cover) {
  if ((y & 1) == t->skipped_lines) return;
  // the coverage is the alpha, unless the shape blends and its own alpha isn't 0x80
  if (t->covered && (!t->blends || colour >> 24 == 0x80)) colour = (colour & 0xFFFFFF) | (uint32_t)(cover >= 0 ? cover : 0x80) << 24;
  if (z > t->depth_most) z = t->depth_most;
  uint32_t depth = gs_pixel(t->depth_at, t->width, t->depth_psm, (uint32_t)x, (uint32_t)y);
  if (t->test == 0 || (t->test == 2 && z < depth) || (t->test == 3 && z <= depth)) return;
  uint32_t under = framebuffer_colour(t, x, y);
  if (t->date && (under >> 31) != (uint32_t)t->datm) return;
  int write_colour = 1, write_alpha = 1, write_depth = t->write_depth && cover < 0;
  if (!alpha_passes(t->alpha_test, colour >> 24, t->alpha_ref)) {
    // what's written of a pixel that fails: nothing, its colour, its depth, or its colour without its alpha
    if (t->alpha_fail == 0) return;
    write_colour = t->alpha_fail != 2;
    write_alpha = t->alpha_fail == 1;
    write_depth = write_depth && t->alpha_fail == 2;
  }
  // the colour's three channels, which blending can take out of a byte's range, and dithering further
  int32_t channels[3] = { (int32_t)(colour & 255), (int32_t)(colour >> 8 & 255), (int32_t)(colour >> 16 & 255) };
  if (t->blend && (!t->pabe || colour >> 31)) {
    // ((A - B) × C >> 7) + D, each of A, B and D the shape's colour, the framebuffer's or none, and C an alpha
    uint32_t pick_c = field(t->alpha, 4, 2), pick[3] = { field(t->alpha, 0, 2), field(t->alpha, 2, 2), field(t->alpha, 6, 2) };
    int32_t c = (int32_t)(pick_c == 0 ? colour >> 24 : pick_c == 1 ? under >> 24 : field(t->alpha, 32, 8));
    for (int i = 0; i < 3; i++) {
      int32_t chosen[3] = { channels[i], (int32_t)(under >> i * 8 & 255), 0 };
      channels[i] = (((chosen[pick[0] > 2 ? 2 : pick[0]] - chosen[pick[1] > 2 ? 2 : pick[1]]) * c) >> 7) + chosen[pick[2] > 2 ? 2 : pick[2]];
    }
  }
  colour &= 0xFF000000;
  for (int i = 0; i < 3; i++) {
    int32_t value = channels[i] + (t->dithered ? t->dither[y & 3][x & 3] : 0);
    // COLCLAMP: kept within a byte, or only its low byte kept
    value = t->clamp_colour ? (value < 0 ? 0 : value > 255 ? 255 : value) : value & 255;
    colour |= (uint32_t)value << i * 8;
  }
  if (t->fba) colour |= 0x80000000u;
  if (write_colour) {
    uint32_t keep = t->mask | (write_alpha ? 0 : 0xFF000000u);
    if (gs_is_16(t->psm)) {
      uint32_t merged = (under & keep) | (colour & ~keep);
      gs_pixel_set(t->colour_at, t->width, t->psm, (uint32_t)x, (uint32_t)y, to_16(merged), 0);
    } else {
      gs_pixel_set(t->colour_at, t->width, t->psm, (uint32_t)x, (uint32_t)y, colour, keep);
    }
  }
  if (write_depth) gs_pixel_set(t->depth_at, t->width, t->depth_psm, (uint32_t)x, (uint32_t)y, z, 0);
}

static void plot(const struct target *t, int x, int y, uint32_t z, uint32_t colour) { plot_covered(t, x, y, z, colour, -1); }

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
  return textured(&t->texture, colour, filtered(&t->texture, across, down, q));
}

// a colour in the fog: FOGCOL where the fog is 0, the colour itself by 255, its alpha as it was. The fog is in 128ths,
// as it runs between a shape's corners finer than its 256 steps
static uint32_t in_fog(const struct target *t, uint32_t colour, uint32_t fog) {
  if (!t->fogged) return colour;
  uint32_t out = colour & 0xFF000000;
  for (int shift = 0; shift < 24; shift += 8) {
    int32_t far = (int32_t)(t->fog_colour >> shift & 255), near = (int32_t)(colour >> shift & 255);
    out |= (uint32_t)(far + (((near - far) * (int32_t)fog) >> 15)) << shift;
  }
  return out;
}

// a point: the one pixel its place is nearest
static void point(const struct corner *a) {
  struct target t;
  if (!target_of(&t)) return;
  int x = (a->x + 8) >> 4, y = (a->y + 8) >> 4;
  if (x < t.left || x > t.right || y < t.top || y > t.bottom) return;
  plot(&t, x, y, a->z, in_fog(&t, coloured(&t, a->colour, a->s, a->t, a->q, (float)a->u / 16, (float)a->v / 16), a->fog << 7));
}

// ---- Lines and antialiased edges. Which pixels a line has, and which an antialiased edge has and how much of each it
// covers, follow PCSX2's software renderer (GSRasterizer::DrawEdgeLine and DrawEdgeTriangle, Copyright (C) 2002-2026
// PCSX2 Dev Team, GPL-3.0-or-later, https://github.com/PCSX2/pcsx2), written again here, as that's what the kit's
// pictures are checked against (kit/ps2/c/README.md).

// what a shape has at a place between two corners, 0 at the first and 1 at the second, kept within what each can be
static struct corner between(const struct target *t, const struct corner *a, const struct corner *b, float along, int shaded) {
  struct corner at = *b;
  double z = (double)a->z + ((double)b->z - (double)a->z) * (double)along;
  at.z = z < 0 ? 0 : z > (double)t->depth_most ? t->depth_most : (uint32_t)z;
  if (shaded) {
    at.colour = 0;
    for (int shift = 0; shift < 32; shift += 8) {
      float part = (float)(a->colour >> shift & 255) + ((float)(b->colour >> shift & 255) - (float)(a->colour >> shift & 255)) * along;
      at.colour |= (uint32_t)(part < 0 ? 0 : part > 255 ? 255 : part) << shift;
    }
  }
  // an edge's fog in 128ths
  float fog = ((float)a->fog + ((float)b->fog - (float)a->fog) * along) * 128;
  at.fog = (uint32_t)(fog < 0 ? 0 : fog > 255 * 128 ? 255 * 128 : fog);
  at.s = a->s + (b->s - a->s) * along;
  at.t = a->t + (b->t - a->t) * along;
  at.q = a->q + (b->q - a->q) * along;
  at.u = (int32_t)((float)a->u + (float)(b->u - a->u) * along);
  at.v = (int32_t)((float)a->v + (float)(b->v - a->v) * along);
  return at;
}

static void edge_pixel(const struct target *t, int x, int y, const struct corner *at, int cover) {
  if (x < t->left || x > t->right || y < t->top || y > t->bottom) return;
  uint32_t colour = in_fog(t, coloured(t, at->colour, at->s, at->t, at->q, (float)at->u / 16, (float)at->v / 16), at->fog);
  plot_covered(t, x, y, at->z, colour, cover < 0 ? -1 : cover >> 9);
}

// whether a line's end, this far from the middle of the pixel it's in, has left that pixel's diamond the line's way
static int past_diamond(float dx, float dy, int across, int forward_x, int forward_y) {
  float far = __builtin_fabsf(dx) + __builtin_fabsf(dy);
  if (far < 0.5f) return 0;
  if (across) return (forward_x ? dx > 0 : dx < 0) && (far > 0.5f || dy >= 0);
  return (forward_y ? dy > 0 : dy < 0) && (far > 0.5f || dx >= 0);
}

// a line, a pixel for each step along the way it runs furthest, with the pixel beside it too when it's antialiased, the
// two sharing the step by how near the line is to each
static void line(const struct corner *a, const struct corner *b, int shaded) {
  struct target t;
  if (!target_of(&t)) return;
  float x0 = (float)a->x / 16, y0 = (float)a->y / 16, x1 = (float)b->x / 16, y1 = (float)b->y / 16, dx = x1 - x0, dy = y1 - y0;
  int across = __builtin_fabsf(dx) >= __builtin_fabsf(dy), forward_x = dx >= 0, forward_y = dy >= 0, step_x = forward_x ? 1 : -1, step_y = forward_y ? 1 : -1;
  float rx0 = __builtin_floorf(x0 + 0.5f), ry0 = __builtin_floorf(y0 + 0.5f), rx1 = __builtin_floorf(x1 + 0.5f), ry1 = __builtin_floorf(y1 + 0.5f);
  // its first pixel is drawn unless the line starts past its diamond, and its last only if it ends past its own
  if (past_diamond(x0 - rx0, y0 - ry0, across, forward_x, forward_y)) { if (across) rx0 += (float)step_x; else ry0 += (float)step_y; }
  if (!past_diamond(x1 - rx1, y1 - ry1, across, forward_x, forward_y)) { if (across) rx1 -= (float)step_x; else ry1 -= (float)step_y; }
  if ((across ? (float)step_x * (rx1 - rx0) : (float)step_y * (ry1 - ry0)) < 0) return;
  float length = __builtin_fabsf(across ? dx : dy);
  // how far the line is from the pixel's middle the other way, in 512ths of its length
  int scale = (int)(512 * length), each = (int)(512 * (across ? dy : dx)), off = (int)((float)scale * (across ? y0 - ry0 : x0 - rx0));
  int x = (int)rx0, y = (int)ry0, last = across ? (int)rx1 : (int)ry1;
  float before = across ? (float)step_x * (rx0 - x0) : (float)step_y * (ry0 - y0);
  off += (int)((float)each * before);
  while (off >= scale / 2) { off -= scale; if (across) y++; else x++; }
  while (off < -scale / 2) { off += scale; if (across) y--; else x--; }
  for (int n = 0;; n++) {
    struct corner at = between(&t, a, b, (before + (float)n) / length, shaded);
    if (t.covered) {
      int cover = (int)(65535 * __builtin_fabsf((float)off / (float)scale)), beside = off >= 0 ? 1 : -1;
      cover = cover < 0 ? 0 : cover > 65535 ? 65535 : cover;
      edge_pixel(&t, x, y, &at, 65535 - cover);
      edge_pixel(&t, x + (across ? 0 : beside), y + (across ? beside : 0), &at, cover);
    } else {
      edge_pixel(&t, x, y, &at, -1);
    }
    if ((across ? x : y) == last) break;
    off += each;
    if (across) x += step_x; else y += step_y;
    if ((across ? forward_y : forward_x) ? off >= scale / 2 : 0) { off -= scale; if (across) y++; else x++; }
    else if (!(across ? forward_y : forward_x) && off < -scale / 2) { off += scale; if (across) y--; else x--; }
  }
}

// one edge of an antialiased triangle, from `a` to `b`: the pixels just outside it, each with how much the triangle
// covers of it. `e1` and `e2` are the other two edges' sides, which a pixel has to be inside of, `owned` whether the
// edge is a top or left one, and the box is where the triangle's pixels can be
static void triangle_edge(const struct target *t, const struct corner *a, const struct corner *b, const int64_t e1[3], const int64_t e2[3], int owned, int shaded) {
  float x0 = (float)a->x / 16, y0 = (float)a->y / 16, x1 = (float)b->x / 16, y1 = (float)b->y / 16, dx = x1 - x0, dy = y1 - y0;
  if (dx == 0 && dy == 0) return;
  int across = __builtin_fabsf(dx) >= __builtin_fabsf(dy), forward_x = dx >= 0, forward_y = dy >= 0, step_x = forward_x ? 1 : -1, step_y = forward_y ? 1 : -1;
  // which side of the edge the outside is: towards the top or left, or the bottom or right
  int side = owned ^ (across && dy != 0 && forward_x == forward_y);
  float rx0 = forward_x ? __builtin_ceilf(x0 - 1) : __builtin_floorf(x0 + 1), ry0 = forward_y ? __builtin_ceilf(y0 - 1) : __builtin_floorf(y0 + 1);
  float rx1 = forward_x ? __builtin_floorf(x1 + 1) : __builtin_ceilf(x1 - 1), ry1 = forward_y ? __builtin_floorf(y1 + 1) : __builtin_ceilf(y1 - 1);
  int left = (int)__builtin_floorf(x0 < x1 ? x0 : x1), top = (int)__builtin_ceilf((y0 < y1 ? y0 : y1) - 1);
  int right = (int)__builtin_ceilf(x0 > x1 ? x0 : x1), bottom = (int)__builtin_floorf((y0 > y1 ? y0 : y1) + 1);
  if (left < t->left) left = t->left;
  if (top < t->top) top = t->top;
  if (right > t->right) right = t->right;
  if (bottom > t->bottom) bottom = t->bottom;
  float length = __builtin_fabsf(across ? dx : dy);
  int scale = (int)(512 * length), each = (int)(512 * (across ? dy : dx)), off = (int)((float)scale * (across ? y0 - ry0 : x0 - rx0));
  int x = (int)rx0, y = (int)ry0, last = across ? (int)rx1 : (int)ry1;
  float before = across ? (float)step_x * (rx0 - x0) : (float)step_y * (ry0 - y0);
  off += (int)((float)each * before);
  while (off >= scale / 2) { off -= scale; if (across) y++; else x++; }
  while (off < -scale / 2) { off += scale; if (across) y--; else x--; }
  for (int n = 0;; n++) {
    float d = (float)off / (float)scale;
    // the pixel beside the edge's own, on its outside, and how much of it is covered
    int cover, beside;
    if (d > 0) { cover = (int)(65535 * (side ? 1.0 - (double)d : (double)d)); beside = side ? 0 : 1; }
    else if (d < 0) { cover = (int)(65535 * (side ? -(double)d : 1.0 + (double)d)); beside = side ? -1 : 0; }
    else { cover = owned ? 0 : 65535; beside = owned ? (side ? -1 : 1) : 0; }
    int px = x + (across ? 0 : beside), py = y + (across ? beside : 0);
    if (e1[0] * px + e1[1] * py + e1[2] > 0 && e2[0] * px + e2[1] * py + e2[2] > 0 && px >= left && px <= right && py >= top && py <= bottom) {
      struct corner at = between(t, a, b, (before + (float)n) / length, shaded);
      edge_pixel(t, px, py, &at, cover < 0 ? 0 : cover > 65535 ? 65535 : cover);
    }
    if ((across ? x : y) == last) break;
    off += each;
    if (across) x += step_x; else y += step_y;
    if ((across ? forward_y : forward_x) ? off >= scale / 2 : 0) { off -= scale; if (across) y++; else x++; }
    else if (!(across ? forward_y : forward_x) && off < -scale / 2) { off += scale; if (across) y--; else x--; }
  }
}

// an antialiased triangle's three edges, after its inside is drawn
static void triangle_edges(const struct target *t, const struct corner *a, const struct corner *b, const struct corner *c, int shaded) {
  // from the top down, a corner written earlier first of two as high
  static const uint8_t orders[8][3] = { { 0, 1, 2 }, { 1, 0, 2 }, { 0, 0, 0 }, { 1, 2, 0 }, { 0, 2, 1 }, { 0, 0, 0 }, { 2, 0, 1 }, { 2, 1, 0 } };
  const struct corner *written[3] = { a, b, c };
  const uint8_t *order = orders[(a->y > b->y) | (a->y > c->y) << 1 | (b->y > c->y) << 2];
  const struct corner *v0 = written[order[0]], *v1 = written[order[1]], *v2 = written[order[2]];
  int64_t cross = (int64_t)(v1->y - v0->y) * (v2->x - v0->x) - (int64_t)(v1->x - v0->x) * (v2->y - v0->y);
  if (cross == 0) return;
  int clockwise = cross < 0, sign = clockwise ? -1 : 1;
  int owned0 = v0->y == v1->y || !clockwise, owned1 = clockwise, owned2 = v1->y != v2->y && !clockwise;
  // each edge's side of a pixel's middle: more than 0 inside, with a top or left edge's own pixels inside too
  int64_t f0[3] = { sign * (int64_t)(v1->y - v0->y) * 16, sign * (int64_t)(v0->x - v1->x) * 16, sign * ((int64_t)v1->x * v0->y - (int64_t)v0->x * v1->y) + owned0 };
  int64_t f1[3] = { sign * (int64_t)(v0->y - v2->y) * 16, sign * (int64_t)(v2->x - v0->x) * 16, sign * ((int64_t)v0->x * v2->y - (int64_t)v2->x * v0->y) + owned1 };
  int64_t f2[3] = { sign * (int64_t)(v2->y - v1->y) * 16, sign * (int64_t)(v1->x - v2->x) * 16, sign * ((int64_t)v2->x * v1->y - (int64_t)v1->x * v2->y) + owned2 };
  // a shape in one colour has its last written corner's on every edge
  struct corner flat[3] = { *v0, *v1, *v2 };
  if (!shaded) for (int i = 0; i < 3; i++) flat[i].colour = c->colour;
  triangle_edge(t, &flat[0], &flat[1], f1, f2, owned0, shaded);
  triangle_edge(t, &flat[0], &flat[2], f2, f0, owned1, shaded);
  triangle_edge(t, &flat[1], &flat[2], f0, f1, owned2, shaded);
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
  // its texture places run from the first corner's to the second's, each over the second's Q, read at a pixel's own place
  const struct corner *from = a->x <= b->x ? a : b, *to = from == a ? b : a, *high = a->y <= b->y ? a : b, *low = high == a ? b : a;
  float q = b->q != 0 ? b->q : 1;
  // how far each moves from one sixteenth of a pixel to the next, worked out first, so a texture drawn texel for texel
  // steps by whole texels exactly
  float wide = x1 > x0 ? (float)(x1 - x0) : 1, tall = y1 > y0 ? (float)(y1 - y0) : 1;
  float s_step = (to->s - from->s) / wide, t_step = (low->t - high->t) / tall, u_step = (float)(to->u - from->u) / wide, v_step = (float)(low->v - high->v) / tall;
  for (int y = top; y <= bottom; y++) {
    float down = (float)(y * 16 - y0);
    for (int x = left; x <= right; x++) {
      float across = (float)(x * 16 - x0);
      float s = (from->s + s_step * across) / q, tt = (high->t + t_step * down) / q;
      float u = ((float)from->u + u_step * across) / 16, v = ((float)high->v + v_step * down) / 16;
      plot(&t, x, y, b->z, in_fog(&t, coloured(&t, b->colour, s, tt, 1, u, v), b->fog << 7));
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
  // an antialiased one's edges come after its inside, in the order it was written
  const struct corner *second = b;
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
      // the fog between the corners' as the colours are
      uint32_t fog = (uint32_t)((((int64_t)a->fog * wa + (int64_t)b->fog * wb + (int64_t)c->fog * wc) << 7) / area);
      plot(&t, x, y, z, in_fog(&t, colour, fog));
    }
  }
  if (t.covered) triangle_edges(&t, a, second, last, shaded);
}

// a corner that draws: the shape PRIM names, once it has enough corners
static void corner_written(uint64_t value, int with_fog, int draws) {
  uint64_t offset = gs_registers[GS_XYOFFSET_1 + context()], rgbaq = gs_registers[GS_RGBAQ], st = gs_registers[GS_ST], uv = gs_registers[GS_UV];
  struct corner now = {
    .x = (int32_t)(value & 0xFFFF) - (int32_t)(offset & 0xFFFF), .y = (int32_t)((value >> 16) & 0xFFFF) - (int32_t)((offset >> 32) & 0xFFFF),
    .z = with_fog ? (uint32_t)((value >> 32) & 0xFFFFFF) : (uint32_t)(value >> 32), .colour = (uint32_t)rgbaq,
    .s = float_of((uint32_t)st), .t = float_of((uint32_t)(st >> 32)), .q = float_of((uint32_t)(rgbaq >> 32)),
    .u = (int32_t)field(uv, 0, 14), .v = (int32_t)field(uv, 16, 14),
  };
  // an XYZF's fog is the fog from then on, as FOG's is
  if (with_fog) fog_now = (uint32_t)(value >> 56);
  now.fog = fog_now;
  int kind = (int)(prim() & 7), shaded = (int)((prim() >> 3) & 1);
  int needs = kind == 6 || kind == 1 || kind == 2 ? 2 : kind >= 3 && kind <= 5 ? 3 : kind == 0 ? 1 : 0;
  if (!needs) return;
  corners[corner_count++] = now;
  if (corner_count < needs) return;
  if (draws) {
    if (kind == 0) point(&corners[0]);
    else if (kind == 1 || kind == 2) line(&corners[0], &corners[1], shaded);
    else if (kind == 6) sprite(&corners[0], &corners[1]);
    else triangle(&corners[0], &corners[1], &corners[2], shaded);
  }
  // what the next shape keeps: none of a list's, the last two of a strip's, the first and the last of a fan's
  if (kind == 2) { corners[0] = corners[1]; corner_count = 1; }
  else if (kind == 4) { corners[0] = corners[1]; corners[1] = corners[2]; corner_count = 2; }
  else if (kind == 5) { corners[1] = corners[2]; corner_count = 2; }
  else corner_count = 0;
}

void gs_write(uint8_t reg, uint64_t value) {
  uint8_t written[9];
  written[0] = reg;
  __builtin_memcpy(written + 1, &value, 8);
  gs_list_add('R', written, sizeof written);
  if (reg >= sizeof gs_registers / sizeof gs_registers[0]) return;
  gs_registers[reg] = value;
  if (reg == GS_PRIM) corner_count = 0;
  else if (reg == GS_XYZ2 || reg == GS_XYZF2) corner_written(value, reg == GS_XYZF2, 1);
  else if (reg == GS_XYZ3 || reg == GS_XYZF3) corner_written(value, reg == GS_XYZF3, 0);
  else if (reg == GS_TEX0_1 || reg == GS_TEX0_2) gs_palette_load(value);
  else if (reg == GS_TEX2_1 || reg == GS_TEX2_2) {
    // TEX2 changes only TEX0's format and palette fields
    uint64_t fields = 0x3Full << 20 | 0x7FFFFFFull << 37, tex0 = (gs_registers[reg - 0x10] & ~fields) | (value & fields);
    gs_registers[reg - 0x10] = tex0;
    gs_palette_load(tex0);
  } else if (reg == GS_TRXDIR) gs_transfer_start(value);
  else if (reg == GS_HWREG) gs_transfer_in((const uint8_t *)&value, 8);
  else if (reg == GS_FOG) fog_now = (uint32_t)(value >> 56);
  else if (reg == GS_SIGNAL || reg == GS_FINISH || reg == GS_LABEL) gs_event(reg, value);
}

void gs_image(const void *data, uint32_t length) {
  gs_list_add('I', data, length);
  gs_transfer_in(data, length);
}

// ---- The GS's privileged registers, which the EE sees at addresses of their own (ps2.h): what the screen shows, from which
// the page's picture is painted, and the GS's status, CSR, with what SIGNAL, FINISH and LABEL leave in it and in
// SIGLBLID, IMR's masks, and the interrupt they raise.
//
// Where the console's own is unknown, they do what the console's emulator, Play!, does, as a game is proven against it:
// CSR gives the GS's revision as 7 and no chip ID, IMR starts with everything masked, a register the console can't read
// reads 0xCCCCCCCC, and unmasking an event already in CSR raises its interrupt then (kit/ps2/c/README.md).

// CSR's bits
enum {
  SIGNAL = 1 << 0, FINISH = 1 << 1, HSINT = 1 << 2, VSINT = 1 << 3, EDWINT = 1 << 4, EVENTS = 0x1F, RESET = 1 << 9, FIELD = 1 << 13,
  FIFO_EMPTY = 1 << 14, REVISION = 7 << 16,
};

// the registers that say what the screen shows, a 64-bit one every 16 bytes from PMODE's address: PMODE, SMODE1, SMODE2,
// SRFSH, SYNCH1, SYNCH2, SYNCV, DISPFB1, DISPLAY1, DISPFB2, DISPLAY2, EXTBUF, EXTDATA, EXTWRITE and BGCOLOR
enum { PMODE, SMODE1, SMODE2, SRFSH, SYNCH1, SYNCH2, SYNCV, DISPFB1, DISPLAY1, DISPFB2, DISPLAY2, EXTBUF, EXTDATA, EXTWRITE, BGCOLOR, SHOWN };
static uint64_t shown[SHOWN];
static uint64_t csr = FIFO_EMPTY | REVISION, imr = ~0ull, busdir, siglblid;
static int started;
static void (*interrupt)(void);

static void set_half(uint64_t *reg, uint32_t address, uint32_t value) {
  *reg = address & 4 ? (*reg & 0xFFFFFFFFull) | (uint64_t)value << 32 : (*reg & ~0xFFFFFFFFull) | value;
}

// the GS's interrupt, for the events in `events` that IMR lets through
static void raise(uint32_t events) {
  if (interrupt && events & ~(uint32_t)(imr >> 8) & EVENTS) interrupt();
}

void gs_on_interrupt(void (*handler)(void)) { interrupt = handler; }

void gs_screen(uint32_t address, uint32_t value) {
  if (address >= GS_PMODE && address < GS_PMODE + SHOWN * 16) {
    int which = (int)(address - GS_PMODE) >> 4;
    // what the screen shows of the framebuffer is part of the list, as the proof tools keep the original's: PMODE,
    // SMODE2 and each circuit's DISPFB and DISPLAY
    if (which == PMODE || which == SMODE2 || (which >= DISPFB1 && which <= DISPLAY2)) {
      uint32_t pair[2] = { address, value };
      gs_list_add('S', pair, sizeof pair);
    }
    set_half(&shown[which], address, value);
    return;
  }
  switch (address & ~0xFu) {
  case GS_CSR:
    if (address & 4) break;
    // a 1 clears an event, and RESET starts the screen again
    csr &= ~(uint64_t)(value & EVENTS);
    if (value & RESET) shown[PMODE] = shown[DISPFB1] = shown[DISPFB2] = 0;
    break;
  case GS_IMR:
    set_half(&imr, address, value);
    if (!(address & 4)) raise((uint32_t)csr);
    break;
  case GS_BUSDIR: set_half(&busdir, address, value); break;
  case GS_SIGLBLID: set_half(&siglblid, address, value); break;
  default: break;
  }
}

uint32_t gs_screen_read(uint32_t address) {
  uint64_t value;
  switch (address & ~0xFu) {
  case GS_CSR: value = csr; break;
  case GS_IMR: value = imr; break;
  case GS_SIGLBLID: value = siglblid; break;
  default: return 0xCCCCCCCC;
  }
  return (uint32_t)(address & 4 ? value >> 32 : value);
}

void gs_event(uint8_t reg, uint64_t value) {
  // SIGNAL's and LABEL's IDs replace SIGLBLID's where their masks say
  uint32_t id = (uint32_t)value, mask = (uint32_t)(value >> 32);
  if (reg == GS_LABEL) {
    siglblid = (siglblid & 0xFFFFFFFFull) | (uint64_t)(((uint32_t)(siglblid >> 32) & ~mask) | (id & mask)) << 32;
    return;
  }
  if (reg == GS_SIGNAL) siglblid = (siglblid & ~0xFFFFFFFFull) | (((uint32_t)siglblid & ~mask) | (id & mask));
  // the kit draws as it's written, so FINISH comes when it's written
  uint32_t event = reg == GS_SIGNAL ? SIGNAL : FINISH;
  csr |= event;
  raise(event);
}

static void vblank(void) {
  // FIELD is the field this V-blank starts, which the console turns over once the V-blank ends, and the kit, which has
  // no time within a frame, as the next starts. HSINT comes at every line's end on the console, and here once a frame
  if (started) csr ^= FIELD;
  started = 1;
  csr |= VSINT | HSINT;
  raise(VSINT | HSINT);
}

// What one read circuit shows at a place on the screen: whether it shows anything there, and the colour, with its alpha.
// DISPLAY says where on the screen its rectangle is and how big, in the screen's own clock, MAGH and MAGV how many of
// those a pixel lasts, and DISPFB which buffer and from where in it. `left` and `top` are where the screen's picture
// starts, the leftmost and topmost of the circuits that are on. With the screen interlaced in frame mode (SMODE2's INT
// and FFMD) the buffer has half the screen's lines, each shown on two
static int circuit_pixel(int which, uint32_t x, uint32_t y, uint32_t left, uint32_t top, uint32_t *colour) {
  uint64_t buffer = shown[which ? DISPFB2 : DISPFB1], display = shown[which ? DISPLAY2 : DISPLAY1];
  uint32_t across = field(display, 23, 4) + 1, down = field(display, 27, 2) + 1;
  uint32_t dx = field(display, 0, 12) / across, dy = field(display, 12, 11) / down, w = (field(display, 32, 12) + 1) / across, h = (field(display, 44, 11) + 1) / down;
  uint32_t width = field(buffer, 9, 6);
  int psm = (int)field(buffer, 15, 5), halved = (shown[SMODE2] & 3) == 3;
  x += left;
  y += top;
  if (!width || x < dx || x >= dx + w || y < dy || y >= dy + h) return 0;
  uint32_t row = y - dy, held = gs_pixel(field(buffer, 0, 9) * GS_PAGE_BLOCKS, width, psm, field(buffer, 32, 11) + x - dx, field(buffer, 43, 11) + (halved ? row / 2 : row));
  // a 16-bit pixel's alpha is 0x80 where its top bit is set, and a 24-bit one's is 0x80
  *colour = gs_is_16(psm) ? gs_from_16(held, 0x80, 0) : psm == PSMCT24 ? held | 0x80000000u : held;
  return 1;
}

void gs_show(void) {
  uint32_t *out = kit_screen(SCREEN_W, SCREEN_H);
  uint64_t pmode = shown[PMODE];
  int on[2] = { (int)field(pmode, 0, 1), (int)field(pmode, 1, 1) };
  // the screen's picture starts where the first of the circuits that are on starts, across and down
  uint32_t left = 0xFFFFFFFF, top = 0xFFFFFFFF;
  for (int which = 0; which < 2; which++) {
    uint64_t display = shown[which ? DISPLAY2 : DISPLAY1];
    uint32_t dx = field(display, 0, 12) / (field(display, 23, 4) + 1), dy = field(display, 12, 11) / (field(display, 27, 2) + 1);
    if (on[which] && dx < left) left = dx;
    if (on[which] && dy < top) top = dy;
  }
  uint32_t border = (uint32_t)shown[BGCOLOR] & 0xFFFFFF;
  for (uint32_t y = 0; y < SCREEN_H; y++) {
    for (uint32_t x = 0; x < SCREEN_W; x++) {
      // circuit 2's picture, or the border's colour where it has none or SLBG asks for the border, is what's behind
      uint32_t first = 0, second = 0, behind = border;
      int has_first = on[0] && circuit_pixel(0, x, y, left, top, &first), has_second = on[1] && circuit_pixel(1, x, y, left, top, &second);
      if (has_second && !field(pmode, 7, 1)) behind = second & 0xFFFFFF;
      uint32_t colour = behind;
      if (has_first) {
        // circuit 1's over it, by ALP or by its own alpha, in which 0x80 is all of it (MMOD)
        uint32_t alpha = field(pmode, 5, 1) ? field(pmode, 8, 8) : (first >> 24) * 2 > 255 ? 255 : (first >> 24) * 2;
        colour = 0;
        for (int shift = 0; shift < 24; shift += 8) colour |= (((first >> shift & 255) * alpha + (behind >> shift & 255) * (255 - alpha)) / 255) << shift;
      }
      out[y * SCREEN_W + x] = 0xFF000000u | colour;
    }
  }
}
