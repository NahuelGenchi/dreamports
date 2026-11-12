// Neo Green Hill Zone's two acts: their rows (levels.h) and the sky and sea behind them. Translated from the JavaScript
// version's levels.js and engine/backgrounds.js (the original's stage inits for Zone 1 and StageBgUpdate_Zone1Acts12).
// The zone's objects and enemies are in neogreenobjects.c and neogreenenemies.c.

#include "objects.h"

// Neo Green Hill's background: three cloud bands drift with the stage clock, the big clouds and islands stay still,
// and the sea scrolls faster toward the bottom of the screen. Each line's scroll goes in through the H-blank, as the
// original's StageBgUpdate_Zone1Acts12 does, which leaves out the loop wrap (x -= cam->sa2__unk20).
static void draw_sky_and_sea(int camX, int camY) {
  (void)camY;
  camX -= act.cam.wrapped;
  int bgHeight = act.stage.background.yTiles * 8;
  int second = act.stage.level == LEVEL_NEO_GREEN_HILL_2;
  // the stage clock as the background's update last saw it; act 2 from a start point counts its card's frames
  int late = act.stage.row->stageClockAhead + 1;
  int time = act.tick > late ? act.tick - late : 0;
  e.bgScroll[6] = (uint16_t)(second ? ((time >> 4) & 0xFF) : 0); e.bgScroll[7] = 0;
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
  for (int y = 0; y < SCREEN_H; y++) {
    int line = y < bgHeight ? y : bgHeight - 1;
    int off;
    if (line < 8) off = (time >> 4) & 0xFF;
    else if (line < 24) off = (time >> 5) & 0xFF;
    else if (line < 40) off = (time >> 6) & 0xFF;
    else if (line < 88) off = 0;
    else off = ((line - 86) * camX) >> 8;
    put16(e.primary + (uint32_t)y * 4, (uint32_t)(off & 0x1FF));
    put16(e.primary + (uint32_t)y * 4 + 2, 0);
  }
}

// Act 2 past its card, for a start point: the stage's music manager from its beginning at a sixty-fourth, fading in,
// with the frames before the recording rendered at the first shown frame, as its own engine did; the animated tiles'
// count and picture and the rings where the card's frames left them
static void second_act_card_ended(void) {
  music_call(MUSIC_STAGE_IN, act.stage.music);
  act_render_music_at_first_frame();
  act.bgAnimDelay = 5;
  rings_act2_prepare();
  act_copy_tiles(act.bgAnimFrame);
}

// act 2 adds 820's two variants and its camera stop
static const int PALETTES_1[] = { 814, 815 };
static const int PALETTES_2[] = { 814, 815, 820, 820 };
static const int VARIANTS_2[] = { 0, 0, 1, 0 };

const Level ACT_NEO_GREEN_HILL_1 = {
  .song = 12, .hudFlash = 90, LEVEL_PALETTES(PALETTES_1),
  .bgCnt = 0x1D0B,   // 256 × 256, priority 3, map 29 (0xE800), character base 2
  .drawBackground = draw_sky_and_sea,
  // its recording runs from the character select, before the load stall
  .runsFromFirstFrame = 1, .blackAtGameStart = 1,
};

// Act 2 as it comes on from act 1, with nothing a start point past its card asks of it
static const Level SECOND_ACT_COMING_ON = {
  .song = 13, .hudFlash = 90, LEVEL_PALETTES(PALETTES_2), .paletteVariants = VARIANTS_2,
  .cameraStop = 768,
  .bgCnt = 0x1D0B,
  .drawBackground = draw_sky_and_sea,
};

const Level ACT_NEO_GREEN_HILL_2 = {
  .song = 13, .hudFlash = 90, LEVEL_PALETTES(PALETTES_2), .paletteVariants = VARIANTS_2,
  .cameraStop = 768,
  .bgCnt = 0x1D0B,
  .drawBackground = draw_sky_and_sea,
  .cardEnded = second_act_card_ended, .stageClockAhead = 15,
  // its first recording starts in the frames after its card, so the act steps through them
  .zeroFlashesInSixteens = 1, .palettesAfterSonic = 1, .tilesShownLate = 1, .cardStepsOn = 1,
  .comingOn = &SECOND_ACT_COMING_ON,
};
