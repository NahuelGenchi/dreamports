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
} water;

/** CreateStageBg_Zone4 */
void ice_mountain_create_background(void) {
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

/** UpdateBgAnimationTiles on the snow: its tiles change every animDelay updates; frame 0 is the tileset, frame k the
 *  k-th block stored after it */
static void animate_snow(void) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + TM_ICE_PARADISE_SNOW * 4);
  int frames = rom_u8(at + 6), delay = rom_u8(at + 7);
  uint32_t tileSize = rom_u16(at + 4), tiles = rom_ptr(at + 8), tilesSize = rom_u32(at + 12);
  if (frames <= 0 || ++snowDelay < delay) return;
  snowDelay = 0;
  if (++snowFrame >= frames) snowFrame = 0;
  snow.graphics.src = snowFrame == 0 ? tiles : tiles + tilesSize + (uint32_t)(snowFrame - 1) * tileSize;
  snow.graphics.size = tileSize;
  queue_graphics(&snow.graphics);
}

/** StageBgUpdate_Zone4Acts12: the snow scrolls with the camera and falls with the stage clock over everything, blended
 *  half over it, and the mountains move 16 px across the act and 352 px down it */
void ice_mountain_background_update(int x, int y) {
  e.bldCnt = 0x3F41;     // BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG0
  e.bldAlpha = 0x1010;
  x -= act.cam.wrapped;
  view.snowX = (uint16_t)(((x + (x >> 2)) + (act.tick >> 2)) & 0xFF);
  view.snowY = (uint16_t)(((uint16_t)(y + 256) - act.tick) & 0xFF);
  draw_background(&snow);
  animate_snow();
  view.bgX = (uint16_t)bios_div(x << 4, act.stage.width - SCREEN_W);
  view.bgY = (uint16_t)bios_div((y << 8) + (y << 6) + (y << 5), act.stage.height - SCREEN_H);
  act.cam.bgX = (int16_t)view.bgX; act.cam.bgY = (int16_t)view.bgY;
  view.snowOn = water.unk1 != 0;
  view.updated = 1;
}

/** The scroll the update set, as draw_frame writes the frame's registers, and the snow on BG0 unless the water covers
 *  the whole screen (gWater.unk1 is 0); the blend stays as the update and the title card left it */
void ice_mountain_draw(void) {
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
static void water_mask_palettes(void) {
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
  memcpy(gba_pal, water.under + 256, UNDER_BG_COLOURS * 2);
  memcpy(gba_pal + 256, water.under, 256 * 2);
  gba_update_colors();
  gba_write(REG_DISPCNT, (uint16_t)(gba_io[REG_DISPCNT >> 1] & ~DISPCNT_BG0_ON));
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES | FLAGS_UPDATE_BG_PALETTES;
  hblank_dma_secondary(REG_BG0HOFS + 3 * 4, e.hblankSize);
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
  if (act.tick & 1) {
    if (water.current < water.target) water.current++;
    else if (water.current > water.target) water.current--;
  }
  int camY = (int)act.cam.y;
  if (water.current <= camY) water.unk2 = 0;
  else if (water.current < camY + SCREEN_H) water.unk2 = (uint8_t)(water.current - camY);
  else water.unk2 = 0xFF;
  // the surface, while the line was on the screen at the last V-blank: one sprite 17 times, 16 px apart, every other
  // pair of frames, its waves going left with the camera and a pixel every 4 frames
  if ((uint8_t)(water.unk1 - 1) < SCREEN_H - 1) {
    Sprite *s = &water.surface;
    s->x = (int16_t)-(((int)act.cam.x + (int)((act.tick + 1) >> 2)) & 15);
    s->y = (int16_t)(water.unk2 + 1);
    s->frameFlags |= SPRITE_KEEP_PALETTE | SPRITE_KEEP_TILES;
    update_sprite(s, 0);
    if (act.tick & 2 && (uint16_t)(s->y - 1) < SCREEN_W - 1) {
      int count = SURFACE_SPRITES;
      do { display_sprite(s); s->x += 16; } while (--count >= 0);
    }
  }
  // from the line on, the colours under the water and the waves (VCountIntr_8011ACC), from a line inside the screen
  if ((uint8_t)(water.unk2 - 1) < SCREEN_H - 1) {
    e.vcountIntr = water_line;
    e.vcountLine = (uint8_t)(water.unk2 - 1);
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
    uint32_t h = (act.tick * 4 + ((bgY + water.unk2 % 32u) << 6)) % 1024u;
    uint32_t v = ((act.tick * 2 + (((bgY + water.unk2) % 32u) << 5)) + 0x100) & 0x3FF;
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
int water_line_on_screen(void) { return water.on && (uint8_t)(water.unk1 - 1) < SCREEN_H - 1; }
