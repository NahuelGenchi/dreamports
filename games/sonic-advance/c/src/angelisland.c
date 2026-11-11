// Angel Island Zone's stage: the still background under Egg Rocket's clouds, which drift left over it, blended half in.
// Translated from the original a function at a time (zone_5_init.c CreateStageBg_Zone5, zone_5.c
// StageBgUpdate_Zone5Acts12 and background.c UpdateBgAnimationTiles); every comment names the function it rewrites.

#include "act.h"

enum {
  TM_EGG_ROCKET_CLOUDS = 72,   // constants/tilemaps.h
  BG_DISABLE_PALETTE_UPDATE = 0x10,
  BG_CHAR_3 = 0xC000, BG_SCREEN_28 = 0xE000,
  DISPCNT_BG0_ON = 0x100,
  MUS_ANGEL_ISLAND__ACT_1 = 20,
};

// the clouds' layer (gStageBackgroundsRam.unk0) and its animation's counters (animFrameCounter, animDelayCounter)
static Background clouds;
static int cloudsFrame, cloudsDelay;
// what the background update leaves in the display registers for the frame
static struct { int updated; uint16_t cloudsX; } view;

/** CreateStageBg_Zone5 */
static void create_background(void) {
  // the original writes BLDCNT's targets into BG0CNT: map 28, character base 3, priority 3, which the clouds then use
  e.bgCnt[0] = 0x1C0F;
  // gStageCameraBgTemplates[CAMBG_BACK_B_LAYER], on BG0, as it is: its map goes to screen 28, which BG0CNT names
  background_init(&clouds);
  clouds.graphics.dest = BG_CHAR_3;
  clouds.layoutVram = BG_SCREEN_28;
  clouds.targetTilesX = 32; clouds.targetTilesY = 32;
  clouds.flags = BG_DISABLE_PALETTE_UPDATE;
  clouds.tilemapId = TM_EGG_ROCKET_CLOUDS;
  cloudsFrame = cloudsDelay = 0;
  view.updated = 0;
  draw_background(&clouds);
}

/** StageBgUpdate_Zone5Acts12: the clouds move left a pixel every four frames of the stage clock, blended 12 to 16
 *  over everything; the background behind them stands still */
static void background_update(void) {
  e.bldCnt = 0x3F41;     // BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG0 | BLDCNT_TGT2_ALL
  e.bldAlpha = 0x100C;   // BLDALPHA_BLEND(12, 16)
  view.cloudsX = (uint16_t)((0x100 - (act.tick >> 2)) & 0xFF);
  draw_background(&clouds);
  animate_background(&clouds, &cloudsFrame, &cloudsDelay);
  view.updated = 1;
}

// UpdateCamera's fnBgUpdate, which runs with its RenderMetatileLayers
static void camera_moved(int runs) {
  if (runs) background_update();
}

/** The scroll the update set, as draw_frame writes the frame's registers, with BG0 on */
static void draw(int camX, int camY) {
  (void)camX; (void)camY;
  if (!view.updated) return;
  e.bgScroll[0] = view.cloudsX; e.bgScroll[1] = 0;
  e.dispCnt |= DISPCNT_BG0_ON;
}

// StageInit_Zone5Act1's palette animation: the waterfalls' colours
static const int PALETTES[] = { 823 };

const Level ACT_ANGEL_ISLAND_1 = {
  .song = MUS_ANGEL_ISLAND__ACT_1, .hudFlash = 90, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x1D0B, .bgCols = 32, .bgRows = 32,   // 256 × 256, priority 3, map 29 (0xE800), character base 2
  .start = create_background, .cameraMoved = camera_moved, .drawBackground = draw,
  .ownsBlend = 1,    // its background update sets the blend in the camera's task, which the title card's end clears
};
