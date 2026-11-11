// Ice Mountain Zone's stage: the snow that falls over the act, the mountains behind it, and the water at its foot.
// Translated from the original a function at a time (zone_4_init.c CreateStageBg_Zone4, zone_4.c
// StageBgUpdate_Zone4Acts12, background.c UpdateBgAnimationTiles and water_effects.c); every comment names the
// function it rewrites.

#include "act.h"

enum {
  TM_ICE_PARADISE_SNOW = 71,      // constants/tilemaps.h
  ANIM_LOAD_PALETTE_423 = 852,    // SA1_ANIM_LOAD_PALETTE_423
  BG_DISABLE_PALETTE_UPDATE = 0x10,
  BG_CHAR_3 = 0xC000, BG_SCREEN_27 = 0xD800,
  DISPCNT_BG0_ON = 0x100,
  WATER_MASK_COLOR_A = 0x7BDE, WATER_MASK_COLOR_B = 0x739C,
  WATER_TASK_PRIORITY = 0xFFFE, TITLE_CARD_PRIORITY = 0x2100,
  ANIM_WATER_SURFACE = 563, VRAM_WATER_SURFACE = 0x2660,   // SA1_ANIM_WATER_SURFACE and VRAM_RESERVED_WATER_SURFACE
  SURFACE_SPRITES = (SCREEN_W + 16) / 16,                  // WATER_SURFACE_SPRITE_COUNT, drawn one more time than this
  UNDER_BG_COLOURS = 29 * 16 / 2,                          // the backgrounds' colours the line changes: the last 24 stay
  WAVE_LINES = 32,                                         // the waves under it repeat every 32 lines
};

// the snow layer (gStageBackgroundsRam.unk0) and its animation's counters (animFrameCounter, animDelayCounter)
static Background snow;
static int snowFrame, snowDelay;
// what the background update leaves in the display registers for the frame
static struct { int updated, snowOn; uint16_t snowX, snowY, bgX, bgY; } view;

// gWater: the level, where the screen meets it (unk2) and what the last V-blank saw of that (unk1), and the colours
// under it (sPaletteBuffer, the sprites' 256 then the backgrounds')
static struct {
  int on, current, target;
  uint8_t unk1, unk2;
  uint32_t mask;
  uint16_t under[512];
  Sprite surface;
  Task *t;
  Task *card;                     // the title card's part in it, and what it does next: 1 a frame, 2 the card's end
  int cardStep;
  int late, early;                // this frame the waves start a line late, the colours under it are next frame's
} water;

// The stage clock's values (first to last) on which the original's VCount interrupt sets the waves' H-blank DMA up after the H-blank
// of the line it comes on, so its first values go to the line after the water's line, which keeps the scroll the
// V-blank wrote. It takes the console's timing, which nothing here counts, so these are measured from the original
// in the act's recording (notes/the-waves-can-start-a-line-late.md), as the title demo's are (demo.js's lateWaves).
static const struct { uint8_t level; uint16_t first, last; } LATE_WAVES[] = {
  { 7, 1334, 1334 }, { 7, 1342, 1342 }, { 7, 8266, 8266 }, { 7, 8285, 8285 }, { 7, 8304, 8304 }, { 7, 9306, 9306 },
  { 7, 9338, 9338 }, { 7, 9674, 9674 }, { 7, 9704, 9704 }, { 7, 9814, 9814 }, { 7, 9835, 9835 }, { 7, 9940, 9940 },
  { 7, 9957, 9957 }, { 7, 10058, 10058 }, { 7, 10069, 10069 }, { 7, 10431, 10431 }, { 7, 10447, 10447 },
  { 7, 10467, 10467 }, { 7, 10529, 10529 }, { 7, 10555, 10555 }, { 7, 10970, 11000 }, { 7, 11319, 11319 },
  { 7, 11336, 11336 }, { 7, 11338, 11338 }, { 7, 11346, 11346 }, { 7, 11365, 11365 }, { 7, 11369, 11369 },
  { 7, 11724, 11724 }, { 7, 11797, 11797 }, { 7, 11822, 11822 }, { 7, 11824, 11824 }, { 7, 11856, 11856 },
  { 7, 11923, 11923 }, { 7, 11929, 11929 }, { 7, 11932, 11932 }, { 7, 11939, 11939 }, { 7, 12025, 12025 },
  { 7, 12200, 12200 }, { 7, 12201, 12201 }, { 7, 12262, 12262 }, { 7, 12294, 12294 }, { 7, 12305, 12305 },
  { 7, 12307, 12307 }, { 7, 12350, 12350 }, { 7, 12553, 12553 }, { 7, 12554, 12554 }, { 7, 12588, 12588 },
  { 7, 12589, 12589 }, { 7, 12893, 12893 }, { 7, 12894, 12894 }, { 7, 12933, 12933 }, { 7, 12960, 12960 },
  { 7, 12961, 12961 }, { 7, 12966, 12966 }, { 7, 13001, 13001 }, { 7, 13002, 13002 }, { 7, 13043, 13043 },
  { 7, 13044, 13044 }, { 7, 13125, 13125 }, { 7, 13126, 13126 }, { 7, 13167, 13167 }, { 7, 13168, 13168 },
};
// And with the water's line near the screen's bottom, the interrupt itself can come so late that none of the lines
// under it gets the colours under water or the waves: measured the same way, it runs after the screen's last line.
static const struct { uint8_t level; uint16_t time; } LATE_INTERRUPTS[] = { { 7, 8310 }, { 7, 8409 }, { 7, 13234 }, };
// And the other way: with the boss beaten, the next frame's tasks can be done before the line comes, so the colours under
// water the interrupt loads are the ones the next frame's palette animations made (notes/the-colours-under-water-can-be-
// the-next-frames.md). These are the stage clock values on which that shows, measured the same way.
static const struct { uint8_t level; uint16_t first, last; } EARLY_COLOURS[] = {
  { 7, 13048, 13048 }, { 7, 13114, 13126 }, { 7, 13189, 13201 }
};


/** CreateStageBg_Zone4 */
static void create_background(void) {
  e.bldAlpha = 0x1010;   // BLDALPHA_BLEND(16, 16)
  // the original writes BLDCNT's targets into BG0CNT: map 27, character base 3, priority 0, which the snow then uses
  e.bgCnt[0] = 0x1B0C;
  // gStageCameraBgTemplates[CAMBG_BACK_B_LAYER], on BG0
  background_init(&snow);
  snow.graphics.dest = BG_CHAR_3;
  snow.layoutVram = BG_SCREEN_27;
  snow.targetTilesX = 32; snow.targetTilesY = 32;
  snow.flags = BG_DISABLE_PALETTE_UPDATE;
  snow.tilemapId = TM_ICE_PARADISE_SNOW;
  snowFrame = snowDelay = 0;
  view.updated = 0;
  draw_background(&snow);
}

/** StageBgUpdate_Zone4Acts12: the snow scrolls with the camera and falls with the stage clock over everything, blended
 *  half over it, and the mountains move 16 px across the act and 352 px down it */
static void background_update(int x, int y) {
  e.bldCnt = 0x3F41;     // BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG0
  e.bldAlpha = 0x1010;
  x -= act.cam.wrapped;
  view.snowX = (uint16_t)(((x + (x >> 2)) + (act_stage_time() >> 2)) & 0xFF);
  view.snowY = (uint16_t)(((uint16_t)(y + 256) - act_stage_time()) & 0xFF);
  draw_background(&snow);
  animate_background(&snow, &snowFrame, &snowDelay);
  view.bgX = (uint16_t)bios_div(x << 4, act.stage.width - SCREEN_W);
  view.bgY = (uint16_t)bios_div((y << 8) + (y << 6) + (y << 5), act.stage.height - SCREEN_H);
  act.cam.bgX = (int16_t)view.bgX; act.cam.bgY = (int16_t)view.bgY;
  view.snowOn = water.unk1 != 0;
  view.updated = 1;
}

/** The scroll the update set, as draw_frame writes the frame's registers, and the snow on BG0 unless the water covers
 *  the whole screen (gWater.unk1 is 0); the blend stays as the update and the title card left it */
static void draw(int camX, int camY) {
  (void)camX; (void)camY;
  if (!view.updated) return;
  e.bgScroll[0] = view.snowX; e.bgScroll[1] = view.snowY;
  e.bgScroll[6] = view.bgX; e.bgScroll[7] = view.bgY;
  if (view.snowOn) e.dispCnt |= DISPCNT_BG0_ON;
  else e.dispCnt &= (uint16_t)~DISPCNT_BG0_ON;
}

// --- the water (water_effects.c) -------------------------------------------------------------------------------------
/** CreateStageWaterTask: the level the water stands at, and the colour it tints what is under it with */
// the water's own task does its work from the act's frame, in its place after the clock (water_task); it is there for its
// end, when the act's tasks go
static void water_task_main(Task *t) { (void)t; }

/** TaskDestructor_WaterSurface: the line's interrupt goes, and the colours under the water are cleared */
static void water_task_end(Task *t) {
  (void)t;
  e.flags &= ~FLAGS_VCOUNT_INTR;
  e.vcountIntr = NULL;
  water.t = NULL;
  memset(water.under, 0, sizeof water.under);
}

void water_create(int level, uint32_t mask) {
  if (water.t) destroy_task(water.t);
  if (water.card) destroy_task(water.card);
  memset(&water, 0, sizeof water);
  water.current = water.target = level;
  water.unk2 = 0xFF;
  water.unk1 = 0xFF;
  water.mask = mask;
  water.on = level >= 0;
  if (!water.on) return;
  Sprite *s = &water.surface;
  sprite_init(s);
  s->graphics.dest = OBJ_VRAM + VRAM_WATER_SURFACE;
  s->graphics.size = 0;
  s->graphics.anim = ANIM_WATER_SURFACE;
  s->variant = 0;
  s->oamFlags = 0;          // SPRITE_OAM_ORDER(0)
  s->qAnimDelay = 0;
  s->palId = 0;
  s->frameFlags = 0;        // SPRITE_FLAG(PRIORITY, 0)
  update_sprite(s, 0);
  water.t = create_task(water_task_main, NULL, WATER_TASK_PRIORITY, 0, water_task_end);
}

/** WATER_MASK_PALETTE_CHUNK on one colour: half of it, and half of its mix with the mask's colour */
static uint16_t under_colour(uint16_t c, uint16_t mask) {
  uint32_t v = (c & WATER_MASK_COLOR_A) + (((uint32_t)(c & WATER_MASK_COLOR_B) + (WATER_MASK_COLOR_B & mask)) >> 1);
  return (uint16_t)(v >> 1);
}
/** sub_804C40C: the colours under the water, from the sprites' and the backgrounds' as they are now */
void water_mask_palettes(void) {
  if (!water.on) return;
  // the mask is two colours in one word, read with the 32-bit colours it is mixed with: the low one for even entries
  uint16_t lo = (uint16_t)water.mask, hi = (uint16_t)(water.mask >> 16);
  for (int i = 0; i < 256; i++) water.under[i] = under_colour(e.objPalette[i], i & 1 ? hi : lo);
  for (int i = 0; i < 256; i++) water.under[256 + i] = under_colour(e.bgPalette[i], i & 1 ? hi : lo);
}

/** The title card's part in the water (Task_UpdateStageTitleCard): every frame it works out the colours under it, and
 *  as it ends it loads palette 423's colours first (LoadPalette423Anim). The card runs after the palette animations
 *  (0x2100 to their 0x2000), so the colours it masks are the ones they loaded this frame. */
void water_card_flush(void) {
  if (!water.cardStep) return;
  int ending = water.cardStep == 2;
  water.cardStep = 0;
  if (ending) {
    Sprite s;
    sprite_init(&s);
    s.graphics.anim = ANIM_LOAD_PALETTE_423;
    s.oamFlags = 0; s.frameFlags = 0; s.palId = 0;
    update_sprite(&s, 0);
  }
  water_mask_palettes();
  if (ending && water.card) { Task *t = water.card; water.card = NULL; destroy_task(t); }
}
static void water_card_task(Task *t) { (void)t; water_card_flush(); }

/** The card asks for its part, which runs in the card's place in the task list */
void water_card(int ending) {
  if (!water.on) return;
  water.cardStep = ending ? 2 : 1;
  if (!water.card) water.card = create_task(water_card_task, NULL, TITLE_CARD_PRIORITY, 0, NULL);
}

/** VCountIntr_8011ACC: from its line down, the colours under the water and no snow, which the next V-blank puts back,
 *  and from the line after it the background's waves, the ones the tasks wrote this frame */
static void water_line(void) {
  if (water.early) {
    uint16_t next[256];
    act_next_bg_palette(next);
    uint16_t lo = (uint16_t)water.mask, hi = (uint16_t)(water.mask >> 16);
    for (int i = 0; i < UNDER_BG_COLOURS; i++) gba_pal[i] = under_colour(next[i], i & 1 ? hi : lo);
  } else memcpy(gba_pal, water.under + 256, UNDER_BG_COLOURS * 2);
  memcpy(gba_pal + 256, water.under, 256 * 2);
  gba_update_colors();
  gba_write(REG_DISPCNT, (uint16_t)(gba_io[REG_DISPCNT >> 1] & ~DISPCNT_BG0_ON));
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES | FLAGS_UPDATE_BG_PALETTES;
  hblank_dma_secondary(REG_BG0HOFS + 3 * 4, e.hblankSize, water.late);
}

/** sub_8011A4C, in the V-blank's update after the frame the water task asked for it: the line the frame is drawn with
 *  is the one the next frame's tasks see, and while the water covers the whole screen the colours under it and no snow
 *  are loaded straight in, over what the update put there, for the whole frame */
static void water_vblank(void) {
  water.unk1 = water.unk2;
  if (water.unk2 == 0) {
    memcpy(gba_pal, water.under + 256, UNDER_BG_COLOURS * 2);
    memcpy(gba_pal + 256, water.under, 256 * 2);
    gba_update_colors();
    gba_write(REG_DISPCNT, (uint16_t)(gba_io[REG_DISPCNT >> 1] & ~DISPCNT_BG0_ON));
    e.flags |= FLAGS_UPDATE_OBJ_PALETTES | FLAGS_UPDATE_BG_PALETTES;
  }
}

/** Task_StageWaterTask, after the stage clock: the level moves a step toward its target every other frame, and the
 *  screen's line where it starts is kept for the V-blank (sub_8011A4C), which the background update then reads */
void water_task(void) {
  if (!water.on) return;
  if (act_stage_time() & 1) {
    if (water.current < water.target) water.current++;
    else if (water.current > water.target) water.current--;
  }
  int time = act_stage_time();
  water.late = water.early = 0;
  for (unsigned i = 0; i < sizeof LATE_WAVES / sizeof *LATE_WAVES; i++)
    if (LATE_WAVES[i].level == act.stage.level && time >= LATE_WAVES[i].first && time <= LATE_WAVES[i].last) water.late = 1;
  for (unsigned i = 0; i < sizeof EARLY_COLOURS / sizeof *EARLY_COLOURS; i++)
    if (EARLY_COLOURS[i].level == act.stage.level && time >= EARLY_COLOURS[i].first && time <= EARLY_COLOURS[i].last) water.early = 1;
  int afterScreen = 0;
  for (unsigned i = 0; i < sizeof LATE_INTERRUPTS / sizeof *LATE_INTERRUPTS; i++)
    if (LATE_INTERRUPTS[i].level == act.stage.level && LATE_INTERRUPTS[i].time == time) afterScreen = 1;
  int camY = (int)act.cam.y;
  if (water.current <= camY) water.unk2 = 0;
  else if (water.current < camY + SCREEN_H) water.unk2 = (uint8_t)(water.current - camY);
  else water.unk2 = 0xFF;
  // the surface, while the line was on the screen at the last V-blank: one sprite 17 times, 16 px apart, every other
  // pair of frames, its waves going left with the camera and a pixel every 4 frames
  if ((uint8_t)(water.unk1 - 1) < SCREEN_H - 1) {
    Sprite *s = &water.surface;
    s->x = (int16_t)-(((int)act.cam.x + (int)((act_stage_time() + 1) >> 2)) & 15);
    s->y = (int16_t)(water.unk2 + 1);
    s->frameFlags |= SPRITE_KEEP_PALETTE | SPRITE_KEEP_TILES;
    update_sprite(s, 0);
    if (act_stage_time() & 2 && (uint16_t)(s->y - 1) < SCREEN_W - 1) {
      int count = SURFACE_SPRITES;
      do { display_sprite(s); s->x += 16; } while (--count >= 0);
    }
  }
  // from the line on, the colours under the water and the waves (VCountIntr_8011ACC), from a line inside the screen
  if ((uint8_t)(water.unk2 - 1) < SCREEN_H - 1) {
    e.vcountIntr = water_line;
    e.vcountLine = (uint8_t)(afterScreen ? SCREEN_H : water.unk2 - 1);
    e.flags |= FLAGS_VCOUNT_INTR;
  } else {
    e.vcountIntr = NULL;
    e.flags &= ~FLAGS_VCOUNT_INTR;
  }
  // the waves on the background under the water, for its first 32 lines and again down the screen; the H-blank copies
  // them itself only while the water covers the whole screen, the line's interrupt otherwise
  if (water.unk2 >= SCREEN_H) e.flags &= ~FLAGS_HBLANK_COPY;
  else {
    uint32_t bgX = view.bgX, bgY = view.bgY;   // gBgScrollRegs[3]
    uint32_t h = (act_stage_time() * 4 + ((bgY + water.unk2 % 32u) << 6)) % 1024u;
    uint32_t v = ((act_stage_time() * 2 + (((bgY + water.unk2) % 32u) << 5)) + 0x100) & 0x3FF;
    wave_lines(3, 0, WAVE_LINES, (uint16_t)h, 2, 64, (uint16_t)v, 10, 32, (int16_t)bgX, (int16_t)bgY);
    uint32_t block = e.hblankSize * WAVE_LINES;
    for (uint32_t line = WAVE_LINES, at = e.primary + block; line < SCREEN_H; line += WAVE_LINES, at += block)
      memmove(e.hblank + at, e.hblank + e.primary, block);
    if (water.unk2) e.flags &= ~FLAGS_HBLANK_COPY;
  }
  e.vblankCallback = water_vblank;
}

/** Whether the water's line is on the screen, which this part of the act doesn't take Sonic to yet */
int water_level(void) { return water.current; }
void water_lower(int dy) { water.target += dy; }
int water_line_on_screen(void) { return water.on && (uint8_t)(water.unk1 - 1) < SCREEN_H - 1; }

// --- the acts' rows (levels.h) -------------------------------------------------------------------------------------
// The stage inits for Zone 4: each act's song and where its water starts (CreateStageWaterTask), after its background
// (sStageBgInitProcedures), and the palette animations palette_loader.c makes for Ice Mountain
enum {
  MUS_ICE_MOUNTAIN__ACT_1 = 18, MUS_ICE_MOUNTAIN__ACT_2 = 19,
  INITIAL_WATERLEVEL_ZONE_4_ACT_1 = 1546, INITIAL_WATERLEVEL_ZONE_4_ACT_2 = 1664,
  WATER_MASK = 0x7F207F20,
};
static const int PALETTES[] = { 822, 821 };

static void start_first_act(void) { create_background(); water_create(INITIAL_WATERLEVEL_ZONE_4_ACT_1, WATER_MASK); }
static void start_second_act(void) { create_background(); water_create(INITIAL_WATERLEVEL_ZONE_4_ACT_2, WATER_MASK); }
// UpdateCamera's fnBgUpdate, which runs with its RenderMetatileLayers
static void camera_moved(int runs) {
  if (runs) background_update((int)act.cam.x, (int)act.cam.y);
}

const Level ACT_ICE_MOUNTAIN_1 = {
  .song = MUS_ICE_MOUNTAIN__ACT_1, .hudFlash = 90, LEVEL_PALETTES(PALETTES),
  // 256 × 512, priority 3, map 28 (0xE000), character base 2 (STGBG_SCRN_DIM(256, 512, 2, BACK_A))
  .bgCnt = 0x9C0B, .bgCols = 32, .bgRows = 64,
  .start = start_first_act, .cameraMoved = camera_moved, .drawBackground = draw,
  .ownsBlend = 1,   // its background update sets the blend in the camera's task, which the title card's end clears
};

const Level ACT_ICE_MOUNTAIN_2 = {
  .song = MUS_ICE_MOUNTAIN__ACT_2, .hudFlash = 90, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x9C0B, .bgCols = 32, .bgRows = 64,
  .start = start_second_act, .cameraMoved = camera_moved, .drawBackground = draw,
  .ownsBlend = 1,
};
