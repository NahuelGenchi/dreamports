// The GS: the PlayStation 2's graphics chip, as a game writes it (ps2.h). It keeps each frame's draw list, a hash of
// everything written that decides the picture, in the order written, exactly as the proof tools keep the original's
// (tools/libretro/play.patch), and it draws the list into its own memory, in software, for the page to show.
//
// What it draws: points, sprites and triangles, in lists, strips and fans, in one colour or shaded between their
// corners, with or without a texture, in the fog, into a framebuffer of 32, 24 or 16 bits, dithered into 16, inside the
// scissor, with the depth test, the alpha test, the test of the framebuffer's alpha, and blending. Textures are 32, 24
// or 16-bit, or 8 or 4-bit with a palette, sampled by whole texels or by floats over Q, nearest or linear. Its memory,
// pictures moved in and out of it and the palette buffer are in gs-memory.c, laid out as the chip's are, and what the
// screen shows and its status are at the end of this file. Not yet: smaller copies of a texture (mipmaps), lines and antialiased
// edges (kit/ps2/c/README.md).

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

struct texture { uint32_t block, width; int psm, w, h, tcc, tfx; uint64_t tex0, clamp, tex1, texa; };

static struct texture texture_of(int context) {
  uint64_t tex0 = gs_registers[GS_TEX0_1 + context];
  return (struct texture){
    .block = field(tex0, 0, 14), .width = field(tex0, 14, 6), .psm = (int)field(tex0, 20, 6),
    .w = 1 << field(tex0, 26, 4), .h = 1 << field(tex0, 30, 4), .tcc = (int)field(tex0, 34, 1), .tfx = (int)field(tex0, 35, 2),
    .tex0 = tex0, .clamp = gs_registers[GS_CLAMP_1 + context], .tex1 = gs_registers[GS_TEX1_1 + context], .texa = gs_registers[GS_TEXA],
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
  uint32_t raw = gs_pixel(t->block, t->width, t->psm, (uint32_t)u, (uint32_t)v);
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

static int context(void) { return (int)(((gs_registers[GS_PRMODECONT] & 1 ? gs_registers[GS_PRIM] : gs_registers[GS_PRMODE]) >> 9) & 1); }
static uint64_t prim(void) { return gs_registers[GS_PRMODECONT] & 1 ? gs_registers[GS_PRIM] : (gs_registers[GS_PRIM] & 7) | (gs_registers[GS_PRMODE] & ~7ull); }

struct target {
  uint32_t colour_at, depth_at, width, mask, depth_most;
  int psm, depth_psm, left, right, top, bottom, test, write_depth, blend, pabe, clamp_colour, fba;
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
  t->blend = (int)field(p, 6, 1) || (int)field(p, 7, 1);
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

// one pixel of a shape, with its colour already textured
static void plot(const struct target *t, int x, int y, uint32_t z, uint32_t colour) {
  if ((y & 1) == t->skipped_lines) return;
  if (z > t->depth_most) z = t->depth_most;
  uint32_t depth = gs_pixel(t->depth_at, t->width, t->depth_psm, (uint32_t)x, (uint32_t)y);
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

// a colour in the fog: FOGCOL where the fog is 0, the colour itself by 255, its alpha as it was
static uint32_t in_fog(const struct target *t, uint32_t colour, uint32_t fog) {
  if (!t->fogged) return colour;
  uint32_t out = colour & 0xFF000000;
  for (int shift = 0; shift < 24; shift += 8) {
    int32_t far = (int32_t)(t->fog_colour >> shift & 255), near = (int32_t)(colour >> shift & 255);
    out |= (uint32_t)(far + (((near - far) * (int32_t)fog) >> 8)) << shift;
  }
  return out;
}

// a point: the one pixel its place is nearest
static void point(const struct corner *a) {
  struct target t;
  if (!target_of(&t)) return;
  int x = (a->x + 8) >> 4, y = (a->y + 8) >> 4;
  if (x < t.left || x > t.right || y < t.top || y > t.bottom) return;
  plot(&t, x, y, a->z, in_fog(&t, coloured(&t, a->colour, a->s, a->t, a->q, (float)a->u / 16, (float)a->v / 16), a->fog));
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
      plot(&t, x, y, b->z, in_fog(&t, coloured(&t, b->colour, s, tt, 1, u, v), b->fog));
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
      // the fog between the corners' as the colours are
      uint32_t fog = (uint32_t)(((int64_t)a->fog * wa + (int64_t)b->fog * wb + (int64_t)c->fog * wc) / area);
      plot(&t, x, y, z, in_fog(&t, colour, fog));
    }
  }
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
  int needs = kind == 6 ? 2 : kind >= 3 && kind <= 5 ? 3 : kind == 0 ? 1 : 0;
  if (!needs) return;
  corners[corner_count++] = now;
  if (corner_count < needs) return;
  if (draws) {
    if (kind == 0) point(&corners[0]);
    else if (kind == 6) sprite(&corners[0], &corners[1]);
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

void gs_show(void) {
  uint32_t *out = kit_screen(SCREEN_W, SCREEN_H);
  // the second circuit's buffer when only that one is on
  uint64_t buffer = (shown[PMODE] & 3) == 2 ? shown[DISPFB2] : shown[DISPFB1];
  uint32_t width = field(buffer, 9, 6), at = field(buffer, 0, 9) * GS_PAGE_BLOCKS, from_x = field(buffer, 32, 11), from_y = field(buffer, 43, 11);
  int psm = (int)field(buffer, 15, 5), on = (shown[PMODE] & 3) != 0 && width > 0;
  for (uint32_t y = 0; y < SCREEN_H; y++) {
    for (uint32_t x = 0; x < SCREEN_W; x++) {
      uint32_t colour = 0;
      if (on && x + from_x < width * 64) {
        uint32_t held = gs_pixel(at, width, psm, x + from_x, y + from_y);
        colour = gs_is_16(psm) ? gs_from_16(held, 0, 0) : held;
      }
      out[y * SCREEN_W + x] = 0xFF000000u | (colour & 0xFFFFFF);
    }
  }
}
