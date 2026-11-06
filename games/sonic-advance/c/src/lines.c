// Line-by-line effects, translated from gba/lines.js (SAT-R's src/bg_triangles.c): each fills this frame's half of
// the engine's H-blank buffer with a register's value for every line, which the H-blank DMA then copies in as the
// screen is drawn. Some scroll a layer differently on each line; the others draw a window's left and right edges along
// the sides of a shape, a line at a time.

#include "sa.h"

#define IWRAM_BYTES (2 * HBLANK_BUFFER + 0x200)
static void hb(uint32_t at, uint32_t v) { if (at < IWRAM_BYTES) e.hblank[at] = (uint8_t)v; }

void put16(uint32_t at, uint32_t v) { hb(at, v & 0xFF); hb(at + 1, (v >> 8) & 0xFF); }

/** sub_8007858: layer `bg` scrolled to `h` on lines minY to maxY - 1, and `v` there going one line up each line. */
void scroll_lines(int bg, int minY, int maxY, int h, int v) {
  set_hblank_copy(REG_BG0HOFS + bg * 4, 4);
  minY &= 0xFF; maxY &= 0xFF;
  uint32_t at = e.primary + minY * 4;
  v = (v - minY) & 0x1FF; h &= 0x1FF;
  for (; minY < maxY; minY++, at += 4) { put16(at, h); put16(at + 2, v); v = (v - 1) & 0xFFFF; }
}

// JavaScript's %, whose result takes the dividend's sign
static int jmod(int a, int b) { return a % b; }

/** sub_80078D4: layer `bg` scrolled to (h, v) on lines minY to maxY - 1. */
void fill_lines(int bg, int minY, int maxY, int h, int v) {
  set_hblank_copy(REG_BG0HOFS + bg * 4, 4);
  minY &= 0xFF; maxY &= 0xFF;
  for (uint32_t at = e.primary + minY * 4; minY < maxY; minY++, at += 4) { put16(at, (uint32_t)jmod(h, 512)); put16(at + 2, (uint32_t)jmod(v, 512)); }
}

/** sub_8007958: layer `bg` shifted by `shift` one way and the next line the other, `step` further each line. */
void shear_lines(int bg, int minY, int maxY, int shift, int step, int h, int v) {
  set_hblank_copy(REG_BG0HOFS + bg * 4, 4);
  minY &= 0xFF; maxY &= 0xFF;
  shift = s16(shift); step = s8(step);
  for (uint32_t at = e.primary + minY * 4; minY < maxY; minY++, at += 4) {
    put16(at, (shift + h) & 0x1FF); put16(at + 2, (uint32_t)v);
    shift = s16(-(shift + step)); step = s8(-step);
  }
}

// where a window's edges go: windows 0 and 1 for layers 0 and 1 (2 bytes a line), or both at once, the first for layer
// 2 and the second for layer 3 (4 bytes a line). A line's first byte is its right edge, its second its left.
static uint32_t window_lines(int bg, uint32_t *size) {
  *size = bg >= 2 ? 4 : 2;
  set_hblank_copy(bg < 2 && bg & 1 ? REG_WIN1H : REG_WIN0H, *size);
  return e.primary + (bg >= 2 && bg & 1 ? 2 : 0);
}

static int iabs(int v) { return v < 0 ? -v : v; }

// sub_8006228 (the right edge follows the line) and sub_80064A8 (the left edge does): a line from (x1, y1) to (x2, y2)
// as one edge of the window on each line it crosses, the other edge at `other`
static void window_edge(int bg, int x1, int y1, int x2, int y2, int other, int right) {
  uint32_t size, at = window_lines(bg, &size);
#define RIGHT0 (right ? x1 : other)
#define LEFT1 (right ? other : x1)
  int r1 = s16(x2 - x1), r5 = s16(y2 - y1);
  int r4 = r5, r2 = r1;
  int r8 = s16(iabs(r2) * 2), r7 = s16(iabs(r4) * 2);
  uint32_t cur = at + y1 * size;
  if (iabs(r2) > iabs(r4)) {
    // flatter than 45°: along x, a line down each time the error passes 0
    r4 = s16(-r2);
    if (r2 > 0) {
      hb(cur + 1, LEFT1);
      for (r2 = 0; r2 < iabs(r1); r2++) {
        x1 = (x1 + 1) & 0xFF; r4 = s16(r4 + r7);
        if (r4 >= 0) { r4 = s16(r4 - r8); hb(cur, RIGHT0); cur += size; hb(cur + 1, LEFT1); }
      }
      hb(cur, RIGHT0);
    } else {
      hb(cur, RIGHT0); cur++;
      for (r2 = 0; r2 < iabs(r1); r2++) {
        x1 = (x1 - 1) & 0xFF; r4 = s16(r4 + r7);
        if (r4 >= 0) { r4 = s16(r4 - r8); hb(cur, LEFT1); cur += size - 1; hb(cur, RIGHT0); cur++; }
      }
      hb(cur, LEFT1);
    }
  } else {
    // steeper: a line at a time, x a step over each time the error passes 0
    r4 = s16(-r4);
    int dir = r2 > 0 ? 1 : -1;
    for (r2 = 0; r2 < iabs(r5); r2++) {
      hb(cur, right ? (x1 + 1) & 0xFF : other); cur++;
      hb(cur, LEFT1); cur += size - 1;
      r4 = s16(r4 + r8);
      if (r4 >= 0) { x1 = (x1 + dir) & 0xFF; r4 = s16(r4 - r7); }
    }
  }
#undef RIGHT0
#undef LEFT1
}
void window_right(int bg, int x1, int y1, int x2, int y2, int left) { window_edge(bg, x1 & 0xFF, y1 & 0xFF, x2 & 0xFF, y2 & 0xFF, left & 0xFF, 1); }
void window_left(int bg, int x1, int y1, int x2, int y2, int right) { window_edge(bg, x1 & 0xFF, y1 & 0xFF, x2 & 0xFF, y2 & 0xFF, right & 0xFF, 0); }

/**
 * sub_800724C: the window between two lines, p = [x0, y0, x1, y1, x2, y2, x3, y3] (bytes): the left edge along
 * (x0, y0)–(x1, y1), the right edge along (x2, y2)–(x3, y3). Above where both have started, the one that starts higher
 * has the screen's other side for its partner.
 */
void window_between(int bg, const uint8_t p[8]) {
  uint32_t size, cur = window_lines(bg, &size);
  int minVal = p[1] < p[5] ? p[1] : p[5], maxVal = p[1] > p[5] ? p[1] : p[5];
  cur += minVal * size;
  int dx[2] = { s16(p[2] - p[0]), s16(p[6] - p[4]) }, dy[2] = { s16(p[3] - p[1]), s16(p[7] - p[5]) };
  int ax[2] = { s16(iabs(dx[0]) * 2), s16(iabs(dx[1]) * 2) }, ay[2] = { s16(iabs(dy[0]) * 2), s16(iabs(dy[1]) * 2) };
  int x[2] = { p[0], p[4] }, err[2] = { s16(-dy[0]), s16(-dy[1]) };
  // steps edge `k` down a line; the left edge (0) takes the last x it reaches going left, the right edge (1) the one
  // past the last it reaches going right
#define STEP(k) \
  while (err[k] >= 0) { \
    if (dx[k] > 0) { \
      x[k] = u8(x[k] + 1); err[k] = s16(err[k] - ay[k]); \
      if ((k) == 1 && err[k] >= 0) hb(cur, u8(x[1] + 1)); \
    } else { \
      x[k] = u8(x[k] - 1); err[k] = s16(err[k] - ay[k]); \
      if ((k) == 0 && err[k] >= 0) hb(cur + 1, x[0]); \
    } \
  }
  if (minVal != maxVal && p[1] < p[5]) {
    for (; minVal < maxVal; minVal++, cur += size) {
      hb(cur, 240); hb(cur + 1, x[0]);
      err[0] = s16(err[0] + ax[0]);
      STEP(0);
    }
  } else {
    for (; minVal < maxVal; minVal++, cur += size) {
      hb(cur, x[1]); hb(cur + 1, 0);
      err[1] = s16(err[1] + ax[1]);
      STEP(1);
    }
  }
  for (maxVal = p[3] < p[7] ? p[3] : p[7]; minVal < maxVal; minVal++, cur += size) {
    hb(cur, x[1]); hb(cur + 1, x[0]);
    err[0] = s16(err[0] + ax[0]); err[1] = s16(err[1] + ax[1]);
    STEP(0); STEP(1);
  }
#undef STEP
}
