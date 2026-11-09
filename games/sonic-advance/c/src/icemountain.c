// Ice Mountain's background layers, both acts, translated from the JavaScript version's engine/icemountain.js (SAT-R's
// src/game/stage/backgrounds/zone_4_init.c and zone_4.c: CreateStageBg_Zone4 and StageBgUpdate_Zone4Acts12). The
// background (BG3, 256 × 512) moves 16 px across the whole act's width and 352 px down its height. The falling snow
// (BG0, 256 × 256) lies over everything: it drifts right with the camera and the clock and falls a pixel a frame, its
// tiles change every few frames, and it is added to what is under it (the blend at 16/16 on both). It is off while the
// water's line was at the screen's top (water.c).

#include "act.h"

enum { TM_ICE_PARADISE_SNOW = 71 };
#define DISABLE_PALETTE_UPDATE 0x10

static Background snow;   // gStageBackgroundsRam.unk0
static int snowOn;        // gDispCnt's BG0, which the update keeps from one frame to the next

/** CreateStageBg_Zone4: the snow's tiles at the fourth character block and its map at screen block 27. */
void ice_mountain_create_bg(void) {
  e.bldAlpha = 0x1010;   // BLDALPHA_BLEND(16, 16)
  // BG0CNT gets the blend targets' bits instead of a layer's (BLDCNT_TGT2_BG0 | ... | BLDCNT_TGT1_BG3): priority 0,
  // character block 3 and screen block 27, which is where the snow goes
  e.bgCnt[0] = 0x1B0C;
  background_init(&snow);   // gStageCameraBgTemplates[CAMBG_BACK_B_LAYER]
  snow.tilemapId = TM_ICE_PARADISE_SNOW;
  snow.graphics.dest = 0xC000;     // BG_CHAR_ADDR(3)
  snow.layoutVram = 0xD800;        // BG_SCREEN_ADDR(27)
  snow.targetTilesX = 32; snow.targetTilesY = 32;
  snow.flags = DISABLE_PALETTE_UPDATE;   // BACKGROUND_FLAG_DISABLE_PALETTE_UPDATE, on BG 0
  snow.prevScrollX = snow.prevScrollY = 0x7FFF;
  draw_background(&snow);
  snowOn = 0;
}

static int div_trunc(int a, int b) { return a / b; }   // the BIOS's Div rounds toward zero, as C's does

/** StageBgUpdate_Zone4Acts12, from the camera's update with its position (x, y) and the stage clock `time`. */
void ice_mountain_bg_update(int x, int y, int time) {
  x -= act.cam.wrapped;
  e.bgScroll[0] = (uint16_t)(((x + (x >> 2)) + (time >> 2)) & 0xFF);
  e.bgScroll[1] = (uint16_t)((y + 256 - time) & 0xFF);
  draw_background(&snow);
  update_bg_animation_tiles(&snow);
  e.bgScroll[6] = (uint16_t)div_trunc(x << 4, act.stage.width - 240);
  e.bgScroll[7] = (uint16_t)div_trunc((y << 8) + (y << 6) + (y << 5), act.stage.height - 160);
  snowOn = water.seen != 0;
}

/** The display the update leaves for the frame: the snow blended over everything while it shows. */
void ice_mountain_display(void) {
  if (!act.cam.bgUpdates) return;
  e.bldCnt = 0x3F41;   // BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG0
  e.bldAlpha = 0x1010;
  if (snowOn) e.dispCnt |= 0x100;
}
