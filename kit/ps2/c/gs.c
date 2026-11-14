// The GS: the PlayStation 2's graphics chip, as a game writes it (ps2.h). It keeps each frame's draw list, a hash of
// everything written that decides the picture, in the order written, exactly as the proof tools keep the original's
// (tools/libretro/play.patch), and it draws the list into its own memory, in software, for the page to show.
//
// What it draws so far: sprites and triangles, in lists, strips and fans, in one colour or shaded between their corners,
// into a 32-bit framebuffer, inside the scissor, with the depth test and a 32-bit depth buffer. Not yet: textures, so a
// textured shape is drawn in its corners' colours, blending, fog, the other pixel formats, points and lines. Its memory
// is laid out a line after another, where the chip's is in blocks, which only a picture read back would show.

#include "ps2-kit.h"

#define GS_MEMORY_WORDS (1024 * 1024)   // 4 MB, in 32-bit words
#define PAGE_WORDS 2048                 // what a buffer's place is counted in

static uint32_t *memory;
static uint64_t registers[0x63];
static uint64_t shown[7];   // PMODE, SMODE2, DISPFB1, DISPLAY1, DISPFB2, DISPLAY2, BGCOLOR
static uint32_t list_hash = 0x811C9DC5, list_count;

// a corner as it was written: where it is in sixteenths of a pixel, its depth and its colour
struct corner { int32_t x, y; uint32_t z, colour; };
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

// the registers of the drawing environment a shape uses, the first unless PRIM says the second
static int context(void) { return (int)(((registers[GS_PRMODECONT] & 1 ? registers[GS_PRIM] : registers[GS_PRMODE]) >> 9) & 1); }
static uint64_t prim(void) { return registers[GS_PRMODECONT] & 1 ? registers[GS_PRIM] : (registers[GS_PRIM] & 7) | (registers[GS_PRMODE] & ~7ull); }

struct target { uint32_t *colour, *depth; int width; int left, right, top, bottom; int test, write_depth; };

// where a shape lands: the framebuffer, the depth buffer, the scissor and the depth test
static int target_of(struct target *t) {
  int c = context();
  uint64_t frame = registers[GS_FRAME_1 + c], zbuf = registers[GS_ZBUF_1 + c], scissor = registers[GS_SCISSOR_1 + c], test = registers[GS_TEST_1 + c];
  t->width = (int)((frame >> 16) & 0x3F) * 64;
  uint32_t colour_at = (uint32_t)(frame & 0x1FF) * PAGE_WORDS, depth_at = (uint32_t)(zbuf & 0x1FF) * PAGE_WORDS;
  t->left = (int)(scissor & 0x7FF);
  t->right = (int)((scissor >> 16) & 0x7FF);
  t->top = (int)((scissor >> 32) & 0x7FF);
  t->bottom = (int)((scissor >> 48) & 0x7FF);
  if (t->right >= t->width) t->right = t->width - 1;
  // only 32-bit colour, and nothing past the end of the chip's memory
  if (!t->width || ((frame >> 24) & 0x3F) != 0) return 0;
  uint32_t lines = (GS_MEMORY_WORDS - (colour_at > depth_at ? colour_at : depth_at)) / (uint32_t)t->width;
  if (colour_at >= GS_MEMORY_WORDS || depth_at >= GS_MEMORY_WORDS || !lines) return 0;
  if (t->bottom >= (int)lines) t->bottom = (int)lines - 1;
  t->colour = memory + colour_at;
  t->depth = memory + depth_at;
  // the depth test: off or always, never, as near or nearer, nearer
  t->test = test >> 16 & 1 ? (int)((test >> 17) & 3) : 1;
  t->write_depth = !((zbuf >> 32) & 1);
  return 1;
}

static inline void plot(const struct target *t, int x, int y, uint32_t z, uint32_t colour) {
  uint32_t *depth = t->depth + y * t->width + x;
  if (t->test == 0 || (t->test == 2 && z < *depth) || (t->test == 3 && z <= *depth)) return;
  t->colour[y * t->width + x] = colour;
  if (t->write_depth) *depth = z;
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
  // a sprite has its second corner's colour and depth all over
  for (int y = top; y <= bottom; y++) for (int x = left; x <= right; x++) plot(&t, x, y, b->z, b->colour);
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
      uint32_t colour = c->colour;
      if (shaded) {
        colour = 0;
        for (int shift = 0; shift < 32; shift += 8) {
          int64_t part = ((int64_t)(a->colour >> shift & 255) * wa + (int64_t)(b->colour >> shift & 255) * wb + (int64_t)(c->colour >> shift & 255) * wc) / area;
          colour |= (uint32_t)part << shift;
        }
      }
      plot(&t, x, y, z, colour);
    }
  }
}

// a corner that draws: the shape PRIM names, once it has enough corners
static void corner_written(uint64_t value, int with_fog, int draws) {
  uint64_t offset = registers[GS_XYOFFSET_1 + context()];
  struct corner now = {
    .x = (int32_t)(value & 0xFFFF) - (int32_t)(offset & 0xFFFF), .y = (int32_t)((value >> 16) & 0xFFFF) - (int32_t)((offset >> 32) & 0xFFFF),
    .z = with_fog ? (uint32_t)((value >> 32) & 0xFFFFFF) : (uint32_t)(value >> 32), .colour = (uint32_t)registers[GS_RGBAQ],
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
}

void gs_image(const void *data, uint32_t length) {
  // part of the list, and not drawn with yet, as textures aren't
  add_to_list(data, length);
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
  int width = (int)((buffer >> 9) & 0x3F) * 64, from_x = (int)((buffer >> 32) & 0x7FF), from_y = (int)((buffer >> 43) & 0x7FF);
  uint32_t at = (uint32_t)(buffer & 0x1FF) * PAGE_WORDS;
  int on = (shown[0] & 3) != 0 && width > 0 && ((buffer >> 15) & 0x1F) == 0;
  for (int y = 0; y < SCREEN_H; y++) {
    for (int x = 0; x < SCREEN_W; x++) {
      uint64_t place = (uint64_t)at + (uint64_t)(y + from_y) * (uint64_t)width + (uint64_t)(x + from_x);
      uint32_t colour = on && x + from_x < width && place < GS_MEMORY_WORDS ? memory[place] : 0;
      out[y * SCREEN_W + x] = 0xFF000000u | (colour & 0xFFFFFF);
    }
  }
}
