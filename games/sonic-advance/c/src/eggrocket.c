// Egg Rocket Zone's stage: the launch tower at sunset, then the sky the rocket climbs through and space. Translated from the
// original a function at a time (stage.c StageInit_Zone6Act1, backgrounds/zone_6.inc.c StageBgUpdate_Zone6Act1, camera.c
// HBlankCallback_803FA1C and bg_triangles.c sub_80078D4) with the JavaScript version's engine/eggrocket.js beside it;
// every comment names the function it rewrites.

#include "act.h"

enum {
  MUS_EGG_ROCKET = 22,
  CAM_SCREENBASE_BACK_C = 26,
  // the camera's unk50 flags the background reads: stopped, space next, the sky scrolling
  BG_STOPPED = 0x2000, BG_SPACE = 0x4000, BG_SCROLLING = 0x8000,
  BGCNT_SIZE_MASK = 0xC000, BGCNT_256X256 = 0x0000, BGCNT_256X512 = 0x8000, BGCNT_SCREENBASE_MASK = 0x1F00,
  BG_LINE_OUTSIDE_START = 256,
  DISPCNT_BG0_ON = 0x100,
  BLDCNT_LIGHTEN_BG0 = 0x81,    // BLDCNT_EFFECT_LIGHTEN | BLDCNT_TGT1_BG0
};

// gCamera.unk50 and the layers' scrolls the update leaves for the frame; gBgCntRegs[3] and [0] are the engine's own
static struct { int flags; int bg3X, bg3Y, bg0X, bg0Y, bg0On; } view;

static int stage_time(void) { return act_stage_time(); }
static uint16_t screenbase(int n) { return (uint16_t)(n << 8); }

/** HBlankCallback_803FA1C: BG0 turns 256 × 512 from line 101 on, 160 down the map, and is lightened less and less over
 *  the lines after it */
static void bg0_split(int line) {
  if (line == 100) {
    gba_write(REG_BG0CNT, (uint16_t)((e.bgCnt[0] & ~BGCNT_SIZE_MASK) | BGCNT_256X512));
    gba_write(REG_BG0HOFS, 0);
    gba_write(REG_BG0HOFS + 2, SCREEN_H);
  } else if (line > 101 && line < 134) {
    gba_write(REG_BLDY, (uint16_t)(16 - ((line - 101) >> 1)));
  }
}

static void bg0_on(int x, int y, int callbacks) {
  view.bg0On = 1;
  e.bgCnt[0] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | BGCNT_256X256);
  e.bgCnt[0] = (uint16_t)((e.bgCnt[0] & ~BGCNT_SCREENBASE_MASK) | screenbase(CAM_SCREENBASE_BACK_C));
  view.bg0X = x; view.bg0Y = y;
  e.bldCnt = BLDCNT_LIGHTEN_BG0;
  e.bldY = 0;
  if (callbacks) {
    e.hblankCallbacks[e.numHblankCallbacks++] = bg0_split;
    e.flags |= FLAGS_HBLANK_CALLBACKS;
  }
}

static void bg3_screen(int size, int base) {
  e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | size);
  e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SCREENBASE_MASK) | screenbase(base));
}

/** StageBgUpdate_Zone6Act1 */
static void background_update(void) {
  int x = (int)act.cam.x - act.cam.wrapped, bossIndex = act_checkpoint_index(), t = stage_time();
  view.bg0On = 0;
  if (view.flags & BG_STOPPED) return;
  if (bossIndex == 0) {
    // BG3 is the full 256 × 512 map, on the launch tower in the sunset
    bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 2);
    view.bg3X = x * 16 / 816;
    view.bg3Y = BG_LINE_OUTSIDE_START;
  } else if (bossIndex < 3) {
    if (!(view.flags & BG_SCROLLING)) {
      bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 2);
      view.bg3X = x * 16 / 816;
      if (((-(t * 2)) & 0x1FF) == view.bg3Y) view.flags |= BG_SCROLLING;
    } else {
      if (((-(t * 2)) & 0x1FF) == 0) e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | BGCNT_256X256);
      e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SCREENBASE_MASK) | screenbase(CAM_SCREENBASE_BACK_C + 2));
      view.bg3X = 0;
      view.bg3Y = (e.bgCnt[3] & BGCNT_SIZE_MASK) == BGCNT_256X256 ? (-(t * 2)) & 0xFF : (-(t * 2)) & 0x1FF;
    }
  } else if (bossIndex == 3) {
    int base = (e.bgCnt[3] & BGCNT_SCREENBASE_MASK) >> 8;
    if (base == CAM_SCREENBASE_BACK_C + 2) {
      view.bg3X = 0; view.bg3Y = (-(t * 2)) & 0xFF;
      if (((-(t * 2)) & 0x1FF) == 256 && (view.flags & BG_SPACE)) {
        view.bg3Y = BG_LINE_OUTSIDE_START;
        bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 1);
      }
    } else if (base == CAM_SCREENBASE_BACK_C + 1) {
      view.bg3X = 0; view.bg3Y = (-(t * 2)) & 0x1FF;
      if (((-(t * 2)) & 0x1FF) == 0) {
        view.bg3Y = (-((t * 2 + 256))) & 0x1FF;
        bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C);
      }
    } else if ((e.bgCnt[3] & BGCNT_SIZE_MASK) == BGCNT_256X512) {
      view.bg3X = 0; view.bg3Y = (-((t * 2) + 256)) & 0x1FF;
      if (view.bg3Y < SCREEN_H) bg0_on(0, (t >> 3) & 0xFF, 1);
      if (view.bg3Y == 0) {
        view.bg3Y = (-(t * 2)) & 0xFF;
        bg3_screen(BGCNT_256X256, CAM_SCREENBASE_BACK_C);
        bg0_on(0, (t >> 1) & 0xFF, 1);
      }
    } else {
      bg3_screen(BGCNT_256X256, CAM_SCREENBASE_BACK_C);
      view.bg3X = 0; view.bg3Y = (t >> 6) & 0xFF;
      bg0_on(0x74, (t >> 3) & 0xFF, 1);
      if (!(view.flags & BG_SCROLLING)) {
        fill_lines(0, 0, 100, (uint16_t)view.bg0X, (uint16_t)view.bg0Y);
        fill_lines(0, 100, 104, 0, SCREEN_H);
        if ((128 - ((t >> 5) & 0x7F)) > 56) {
          fill_lines(0, 104, 160, 0, (uint16_t)(((t >> 5) & 0x7F) + 160));
        } else {
          int v = 232 - ((t >> 5) & 0x7F);
          fill_lines(0, 104, v, 0, (uint16_t)(((t >> 5) & 0x7F) + 160));
          fill_lines(0, v, 160, 0, (uint16_t)(((t >> 5) & 0x7F) + 32));
        }
      }
    }
  }
}

// UpdateCamera's fnBgUpdate, which runs with its RenderMetatileLayers
static void camera_moved(int runs) {
  if (runs) background_update();
}

/** The scrolls the update set, as draw_frame writes the frame's registers */
static void draw(int camX, int camY) {
  (void)camX; (void)camY;
  e.bgScroll[6] = (uint16_t)view.bg3X; e.bgScroll[7] = (uint16_t)view.bg3Y;
  if (view.bg0On) {
    e.dispCnt |= DISPCNT_BG0_ON;
    e.bgScroll[0] = (uint16_t)view.bg0X; e.bgScroll[1] = (uint16_t)view.bg0Y;
  }
}

/** StageInit_Zone6Act1: the stage's background starts 256 × 512, and its palette animations are in the row */
static void start(void) {
  memset(&view, 0, sizeof view);
  e.bgCnt[3] = 0x9C0B;
}

// StageInit_Zone6Act1's palette animations: 839 and 842 both step one row of the stage palette, 840 and 841 each their own
static const int PALETTES[] = { 839, 840, 841, 842 };

const Level ACT_EGG_ROCKET = {
  .song = MUS_EGG_ROCKET, .hudFlash = 4, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x9A0B,   // 256 × 512, priority 3, character base 2, and the background's map from screen 26 (0xD000) on: its four screens
  .start = start, .cameraMoved = camera_moved, .drawBackground = draw,
  .ownsBlend = 1,
};
