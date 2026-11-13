// Secret Base Zone's two acts: their rows (levels.h) and the wall behind them. Translated from the JavaScript version's
// levels.js and engine/backgrounds.js (the original's stage inits for Zone 2, StageBgUpdate_Zone2Act1 and
// StageBgUpdate_Zone2_Interior). Act 1's spotlights are in actspot.c.

#include "objects.h"

static int js_mod(int a, int n) { int r = a % n; return r < 0 ? r + n : r; }

/** StageBgUpdate_Zone2_Interior for one screen line: the x its first pixel comes from, and the y offset that shows the
 *  map row it takes: the wall's row, or a bar's when one crosses the line. */
static void interior_scroll(int line, int cx, int cy, int *outX, int *outY) {
  int x = (cx >> 2) & 0xFF, row = (line + ((cy >> 2) & 63)) & 63;
  for (int i = 0; i < 3; i++) {
    int k = js_mod(line + ((cy >> 1) + (i << 6)) + 16, 256);
    if (k < 16) { x = ((cx >> 1) + (i << 5)) & 0xFF; row = 64 + k; }
  }
  int k = js_mod(line + (cy * 2) / 3 + 288 + 24, 256);
  if (k < 24) { x = ((cx * 2) / 3 + 96) & 0xFF; row = 80 + k; }
  *outX = x;
  *outY = row - line;
}

// StageBgUpdate_Zone2Act2 (StageBgUpdate_Zone2_Interior): a wall that repeats every 64 lines, with three bars and a
// bigger one laid over it, each line's place set through HBlank
static void draw_inside(int camX, int camY) {
  e.bgScroll[6] = (uint16_t)((camX >> 2) & 0xFF); e.bgScroll[7] = (uint16_t)((camY >> 2) & 0xFF);
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
  for (int line = 0; line < SCREEN_H; line++) {
    int x, y;
    interior_scroll(line, camX, camY, &x, &y);
    put16(e.primary + (uint32_t)line * 4, (uint32_t)x);
    put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)y);
  }
}

// StageBgUpdate_Zone2Act1: outside the base, the map's bottom 160 rows, moving across a 78th of the camera's way. It
// hands over to StageBgUpdate_Zone2_Interior once the camera's x, less its loop wrap, reaches 1488
static void draw_first_act(int camX, int camY) {
  if (camX - act.cam.wrapped >= 1488) { draw_inside(camX, camY); return; }
  e.bgScroll[6] = (uint16_t)((camX * 16) / (78 * 16)); e.bgScroll[7] = (uint16_t)(512 - SCREEN_H);
}

// Act 1's beams write the frame's window table after its own, and in a frame that is shown their fade goes back into
// the registers the frame reset
static void first_act_after_frame(int shown) {
  spotlights_beams();
  if (shown) spotlights_apply();
}

static const int PALETTES[] = { 819, 845, 849 };

const Level ACT_SECRET_BASE_1 = {
  .song = 14, .hudFlash = 56, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x9C0B,   // 256 × 512, priority 3, map 28 (0xE000), character base 2
  // the spotlights' manager (0x2000) was made before the entities manager, so it reads Sonic before the objects move
  // him, and its beams leave WIN0V and WIN1V as they last set them on the frames they don't draw
  .start = spotlights_start, .beforeObjects = spotlights_frame, .afterFrame = first_act_after_frame,
  .drawBackground = draw_first_act,
  .ownsWindows = 1, .layersOnFirstLoad = 1,
};

const Level ACT_SECRET_BASE_2 = {
  .song = 15, .hudFlash = 64, LEVEL_PALETTES(PALETTES),
  // 256 × 256, priority 3, map 28 (0xE000), character base 2: the first 32 × 32 of its map (sStageBgDimensions)
  .bgCnt = 0x1C0B, .bgCols = 32, .bgRows = 32,
  .drawBackground = draw_inside,   // act 2 is inside from its first frame
};
