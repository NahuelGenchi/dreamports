// X Zone's act: its row (levels.h) and the background behind it. Translated from the JavaScript version's levels.js and
// engine/backgrounds.js (the original's stage init for Zone 7 act 1 and StageBgUpdate_Zone7Act1).

#include "objects.h"
#include "xbosses.h"

XZoneDisplay xzone_disp;

// StageBgUpdate_Zone7Act1: the 37 × 23 background scrolls as a whole. Its first frame keeps the course select's
// scroll, which the original shows before the act's own update lands.
static void draw_backdrop(int camX, int camY) {
  int bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W));
  int bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H));
  e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
}

static void xzone_start(void) {
  act.bossFlash = 0;
  memset(&xzone_disp, 0, sizeof xzone_disp);
}

void xzone_display_apply(void) {
  if (xzone_disp.active) {
    e.dispCnt |= xzone_disp.dispCnt;
    if (xzone_disp.win0h) e.winRegs[0] = xzone_disp.win0h;
    if (xzone_disp.win0v) e.winRegs[2] = xzone_disp.win0v;
    if (xzone_disp.winIn) e.winRegs[4] = xzone_disp.winIn;
    if (xzone_disp.winOut) e.winRegs[5] = xzone_disp.winOut;
    if (xzone_disp.bldCnt) e.bldCnt = xzone_disp.bldCnt;
    e.bldY = xzone_disp.bldY;
  }
}

static void xzone_after_frame(int shown) {
  if (shown) xzone_display_apply();
}

const Level ACT_X_ZONE = {
  .song = 24, .hudFlash = 90,
  // 512 × 256, priority 3, map 28 (0xE000), character base 2: its 37 × 23 map is two 32-tile blocks side by side
  .bgCnt = 0x5C0B,
  .start = xzone_start,
  .drawBackground = draw_backdrop,
  .blankZeroTiles = 1,   // X Zone's first card leaves them blank, when Sonic plays it
  .soundAtOnce = 1,
  .afterFrame = xzone_after_frame,
};
