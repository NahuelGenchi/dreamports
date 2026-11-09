// An act's water, which Ice Mountain has, translated from the JavaScript version's engine/water.js (SAT-R's
// src/game/water_effects.c): its line, which moves a pixel toward its target on odd frames, the waves along it, and the
// screen below it, drawn in colours mixed with the water's, with the background wavering and without the snow.
//
// The water's task runs after the stage's clock. It works out where the line is on the screen (`line`, gWater.unk2):
// 0 when it is above the screen's top, 255 when it is below the bottom. Each V-blank after the next, `seen` (unk1)
// takes that value (sub_8011A4C). With the line on the screen, the VCount interrupt on the line before it loads the
// colours under water and turns the snow off, and starts the waves from the line itself (VCountIntr_8011ACC); with it
// at the top, the V-blank does both for the whole screen.
//
// Sonic's side of it (Player_HandleWater, player.c) makes the splash where he goes in or out, the drowning countdown's
// numbers and the bubbles he lets out, here (underwater_effects.c): each a task of its own at 0x4001
// (CreateMultiplayerSpriteTask), after Sonic's.

#include "bosses.h"

enum { WATER_SURFACE_ANIM = 563, PALETTE_423_ANIM = 852 };   // SA1_ANIM_WATER_SURFACE, SA1_ANIM_LOAD_PALETTE_423
enum { SURFACE_DEST = OBJ_VRAM + 0x2660 };      // VRAM_RESERVED_WATER_SURFACE
enum { SURFACE_PIECES = (240 + 16) / 16 };      // WATER_SURFACE_SPRITE_COUNT, drawn once more than this
enum { UNDER_BG_COLOURS = 29 * 16 / 2 };        // the background colours the water's colours replace
enum {
  SPLASH_ANIM = 581, SPLASH_TILES = 12, SPLASH_ORDER = 7,       // SA1_ANIM_WATER_FALL_HIT_SURFACE, VramMalloc(12)
  COUNTDOWN_ANIM = 781, COUNTDOWN_ORDER = 9, COUNTDOWN_RISE = 0x120,   // SA1_ANIM_DROWN_COUNTDOWN
  BUBBLES_SMALL_ANIM = 753, BUBBLES_GROUP_ANIM = 754, BUBBLE_ORDER = 9,
  BUBBLES_SMALL_DEST = OBJ_VRAM + 0x2A20, BUBBLES_GROUP_DEST = OBJ_VRAM + 0x2AA0,   // VRAM_RESERVED_BUBBLES_*
  MAX_SMALL_BUBBLES = 11, BUBBLE_RISE = -0x80, BUBBLE_LIFE = 0x1E0,
  PRIORITY_EFFECTS = 0x4001,
  MUS_DROWNING = 27, SE_DROWNED = 192,
};

Water water;

// sPaletteBuffer: the sprites' 256 colours, then the background's, mixed with the water's (sub_804C40C)
static uint16_t underColours[512];

#define WATER_MASK_A 0x7BDE7BDEu
#define WATER_MASK_B 0x739C739Cu
/** WATER_MASK_PALETTE_CHUNK on two colours at once: each halfway to the water's colour, a bit or two lost. */
static uint32_t mask_chunk(uint32_t in, uint32_t mask) {
  return ((in & WATER_MASK_A) + (((in & WATER_MASK_B) + (WATER_MASK_B & mask)) >> 1)) >> 1;
}
static void mask_palette(uint16_t *dst, const uint16_t *src, uint32_t mask) {
  for (int i = 0; i < 256; i += 2) {
    uint32_t c = mask_chunk(src[i] | (uint32_t)src[i + 1] << 16, mask);
    dst[i] = (uint16_t)c; dst[i + 1] = (uint16_t)(c >> 16);
  }
}

/** sub_804C40C: the colours under water, from the sprites' and the background's as they are now. */
void water_mask_palettes(void) {
  if (!water.active) return;
  mask_palette(underColours, e.objPalette, water.mask);
  mask_palette(underColours + 256, e.bgPalette, water.mask);
}

/** LoadPalette423Anim: the colours of animation 423 into the sprites' palette. Its sprite has no place for tiles
 *  (graphics.dest NULL), so it loads none. */
void water_load_palette_423(void) {
  Sprite s;
  sprite_init(&s);
  s.graphics.anim = PALETTE_423_ANIM;
  s.frameFlags = SPRITE_KEEP_TILES;
  update_sprite(&s, 0);
}

/** CreateStageWaterTask: the water at `level` (none below 0), mixed toward `mask`'s colour. */
void water_start(int level, uint32_t mask) {
  memset(&water, 0, sizeof water);
  water.level = water.target = level;
  water.line = 0xFF; water.seen = 0xFF;
  water.mask = mask;
  if (level < 0) return;
  water.active = 1;
  Sprite *s = &water.surface;
  sprite_init(s);
  s->graphics.dest = SURFACE_DEST;
  s->graphics.anim = WATER_SURFACE_ANIM;
  s->oamFlags = 0;   // SPRITE_OAM_ORDER(0)
  s->frameFlags = 0; // SPRITE_FLAG(PRIORITY, 0)
  update_sprite(s, 0);
}

/** sub_8011A4C, the V-blank's callback: `seen` takes the line, and with it at the top the whole screen is under water. */
static void water_vblank(void) {
  if (!water.active) return;
  water.seen = water.line;
  if (water.line != 0) return;
  memcpy(gba_pal, underColours + 256, UNDER_BG_COLOURS * 2);
  memcpy(gba_pal + 256, underColours, 512);
  gba_write(REG_DISPCNT, gba_io[REG_DISPCNT >> 1] & ~0x100);
  e.flags |= FLAGS_UPDATE_BG_PALETTES | FLAGS_UPDATE_OBJ_PALETTES;
}

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

/** VCountIntr_8011ACC: from its line down the colours under water and no snow, and the background's waves through
 *  the H-blank DMA from the buffer the water's task wrote. */
static void water_vcount(void) {
  if (water.early) {
    uint16_t next[256];
    act_next_bg_palette(next);
    mask_palette(next, next, water.mask);
    memcpy(gba_pal, next, UNDER_BG_COLOURS * 2);
  } else memcpy(gba_pal, underColours + 256, UNDER_BG_COLOURS * 2);
  memcpy(gba_pal + 256, underColours, 512);
  gba_update_colors();
  gba_write(REG_DISPCNT, gba_io[REG_DISPCNT >> 1] & ~0x100);
  e.flags |= FLAGS_UPDATE_BG_PALETTES | FLAGS_UPDATE_OBJ_PALETTES;
  hblank_dma_start(hblank_secondary(), REG_BG0HOFS + 3 * 4, 4, water.late);
}

/** sub_8007738: layer `bg`'s scroll on lines minY to maxY - 1, each moved by a sine wave across and another down. */
static void wave_lines(int bg, int minY, int maxY, uint16_t p3, uint8_t p4, uint8_t p5, uint16_t p6, uint8_t p7, uint8_t p8, int16_t h, int16_t v) {
  set_hblank_copy(REG_BG0HOFS + bg * 4, 4);
  for (uint32_t at = e.primary + (uint32_t)minY * 4; minY < maxY; minY++, at += 4) {
    put16(at, (uint32_t)(((SINE[p3 & 1023] * p4) >> 14) + h) & 0x1FF);
    put16(at + 2, (uint32_t)(((SINE[p6 & 1023] * p7) >> 14) + v) & 0x1FF);
    p3 = (uint16_t)(p3 + p5);
    p6 = (uint16_t)(p6 + p8);
  }
}

/** Task_StageWaterTask, with `time` the stage clock after this frame's tick and (camX, camY) the camera. */
void water_task(int time, int camX, int camY) {
  if (!water.active) return;
  if ((time & 1) && water.level != water.target) water.level += water.level < water.target ? 1 : -1;
  water.line = water.level <= camY ? 0 : water.level < camY + 160 ? (uint8_t)(water.level - camY) : 0xFF;
  add_vblank_callback(water_vblank);
  water.late = 0;
  for (unsigned i = 0; i < sizeof LATE_WAVES / sizeof *LATE_WAVES; i++)
    if (LATE_WAVES[i].level == act.stage.level && time >= LATE_WAVES[i].first && time <= LATE_WAVES[i].last) water.late = 1;
  water.early = 0;
  for (unsigned i = 0; i < sizeof EARLY_COLOURS / sizeof *EARLY_COLOURS; i++)
    if (EARLY_COLOURS[i].level == act.stage.level && time >= EARLY_COLOURS[i].first && time <= EARLY_COLOURS[i].last) water.early = 1;

  if ((uint8_t)(water.seen - 1) < 160 - 1) {
    Sprite *s = &water.surface;
    s->x = (int16_t)-((camX + ((time + 1) >> 2)) & 15);
    s->y = (int16_t)(water.line + 1);
    s->frameFlags |= SPRITE_KEEP_TILES | SPRITE_KEEP_PALETTE;
    update_sprite(s, 0);
    if ((time & 2) && (uint16_t)(s->y - 1) < 240 - 1) {
      int count = SURFACE_PIECES;
      do { display_sprite(s); s->x = (int16_t)(s->x + 16); } while (--count >= 0);
    }
  }

  int afterScreen = 0;
  for (unsigned i = 0; i < sizeof LATE_INTERRUPTS / sizeof *LATE_INTERRUPTS; i++)
    if (LATE_INTERRUPTS[i].level == act.stage.level && LATE_INTERRUPTS[i].time == time) afterScreen = 1;
  if ((uint8_t)(water.line - 1) < 160 - 1) set_vcount_intr(water_vcount, afterScreen ? 160 : water.line - 1);
  else set_vcount_intr(NULL, 0);

  if (water.line >= 160) { e.flags &= ~FLAGS_HBLANK_COPY; return; }
  uint16_t vofs = e.bgScroll[7];
  uint32_t r3 = ((uint32_t)time * 4 + ((uint32_t)(vofs + water.line % 32u) << 6)) % 1024u;
  wave_lines(3, 0, 32, (uint16_t)r3, 2, 64, (uint16_t)(((uint32_t)time * 2 + (((vofs + water.line) % 32u) << 5) + 0x100) & 1023), 10, 32,
             (int16_t)e.bgScroll[6], (int16_t)vofs);
  // the 32 lines' waves again down the rest of the screen
  for (uint32_t line = 32; line < 160; line += 32) memmove(e.hblank + e.primary + line * 4, e.hblank + e.primary, 32 * 4);
  if (water.line) e.flags &= ~FLAGS_HBLANK_COPY;
}

int water_level(void) { return water.active ? water.level : -1; }

// --- Sonic in the water --------------------------------------------------------------------------------------------------
// the frame's next rotation matrix (gOamMatrixIndex), through the rotation hardware at its normal size
static void transformed(Sprite *s, int x, int y, int scaleX, int scaleY) {
  s->frameFlags = 2 << 12;   // SPRITE_FLAG(PRIORITY, 2)
  s->frameFlags |= (uint32_t)(boss_matrix() | SPRITE_ROT_SCALE_ENABLE);
  sprite_step(s);
  Transform tf = { 0, (int16_t)scaleX, (int16_t)scaleY, (int16_t)x, (int16_t)y };
  transform_sprite(s, &tf);
  if (objects_drawing()) display_sprite(s);
}

/** Task_UpdateMpSpriteTaskSprite: the splash stays where it was made across, on the water's line, and goes the frame after its
 *  animation ends. */
typedef struct { Object o; int x, y, over; } Splash;
static int splash_run(ActTask *t) {
  Splash *sp = (Splash *)t->data;
  if (sp->over) return 0;
  sp->over = sprite_step(&sp->o.sprite);
  sp->y = water.level;   // it follows the water's line as it moves
  object_draw(&sp->o.sprite, sp->x, sp->y);
  return 1;
}

/** CreateWaterfallSurfaceHitEffect, at x on the water's line. */
void water_splash(int x) {
  Splash *sp = OBJECT_NEW(Splash);
  if (!sp) return;
  sp->x = x; sp->y = water.level;
  object_sprite_at(&sp->o.sprite, vram_malloc(SPLASH_TILES), SPLASH_ANIM, 0, SPLASH_ORDER, 2, 0, 0);
  object_task(&sp->o, splash_run, PRIORITY_EFFECTS);
}

/** SpawnDrowningCountdownNum: the number stays where it appeared on the screen, grows to full size over its first 32
 *  frames and rises, slower and slower, over its first 64, and goes after its 129th or when it is off the screen. */
typedef struct { Object o; int x, y, t; } Countdown;
static int countdown_run(ActTask *t) {
  Countdown *c = (Countdown *)t->data;
  int x = c->x >> 8, y = c->y >> 8, scale = (c->t + 1) << 3;
  if (scale > 0x100) scale = 0x100;
  if (x < -32 || x > 240 + 32 || y < -32 || y > 160 + 32 || c->t > 0x80) return 0;
  if (c->t <= 0x40) c->y += (-(SINE[((c->t * 4) & 1023) + 256] >> 6) * COUNTDOWN_RISE) >> 8;
  c->t++;
  transformed(&c->o.sprite, x, y, scale, scale);
  return 1;
}

void water_countdown(const Player *p, int n) {
  Countdown *c = OBJECT_NEW(Countdown);
  if (!c) return;
  c->x = (int)__builtin_floor((p->x - cam_x()) * 256 + 0.5);
  c->y = (int)__builtin_floor((p->y - cam_y()) * 256 + 0.5);
  object_sprite(&c->o.sprite, COUNTDOWN_ANIM, 0, 5, COUNTDOWN_ORDER, 2, 0, 0);
  c->o.sprite.variant = (uint8_t)(5 - n);
  object_task(&c->o, countdown_run, PRIORITY_EFFECTS);
}

/** SpawnAirBubbles: a small bubble, or a group of them turned by the game's random numbers. It sways sideways, rises
 *  half a pixel a frame and grows to full size over its first 16 frames; its X speed falls off by an eighth each frame.
 *  It bursts at the water's line (3 px below it), after 481 frames or off the screen. While 12 are rising no more come. */
typedef struct { Object o; int x, y, dx, t, flips; } Bubble;
static int bubble_run(ActTask *t) {
  Bubble *b = (Bubble *)t->data;
  int sx = ((b->x + (SINE[((b->t & 0xFF) * 4) & 1023] >> 4)) >> 8) - cam_x(), sy = (b->y >> 8) - cam_y();
  int scale = (b->t + 1) << 4;
  if (scale > 0x100) scale = 0x100;
  if (sx < -32 || sx > 240 + 32 || sy < -32 || sy > 160 + 32 || water.level < 0 || (b->y >> 8) - 3 < water.level || b->t > BUBBLE_LIFE)
    return 0;
  b->x += b->dx; b->y += BUBBLE_RISE;
  b->dx -= b->dx >> 3;
  b->t++;
  transformed(&b->o.sprite, sx, sy, b->flips & 1 ? -scale : scale, b->flips & 2 ? -scale : scale);
  return 1;
}
static void bubble_end(ActTask *t) { water.bubbles--; object_end(t); }

void water_bubble(int x, int y, int dx, int group) {
  if ((int8_t)water.bubbles > MAX_SMALL_BUBBLES) return;
  Bubble *b = OBJECT_NEW(Bubble);
  if (!b) return;
  water.bubbles++;
  b->x = x; b->y = y; b->dx = dx;
  object_sprite_at(&b->o.sprite, group ? BUBBLES_GROUP_DEST : BUBBLES_SMALL_DEST, group ? BUBBLES_GROUP_ANIM : BUBBLES_SMALL_ANIM, 0, BUBBLE_ORDER, 0, 0, 0);
  if (group) b->flips = (int)((act_random() & 0x30000) >> 16);
  ActTask *t = object_task(&b->o, bubble_run, PRIORITY_EFFECTS);
  if (t) t->end = bubble_end;
  else water.bubbles--;
}

/** Task_SpawnBubblesAfterDrowning: on every 4th frame of the clock, one time in four, one or two groups or small bubbles
 *  up to 4 px from his centre, 12 px up, until he is alive again. */
static int after_drowning_run(ActTask *t) {
  const Player *p = (const Player *)t->data;
  if (!p->dead) return 0;
  if ((act.tick & 3) == 0 && (act_random() & 0x300) == 0) {
    int n = (int)((act_random() & 0x100) >> 8);
    do {
      int dx = (int)((act_random() & 0x7FF00) >> 8) - 0x400, dy = (int)((act_random() & 0x7FF00) >> 8) - 0x400;
      int group = (int)((act_random() & 0x100) >> 8);
      water_bubble((int)__builtin_floor(p->x * 256 + 0.5) + dx, (int)__builtin_floor(p->y * 256 + 0.5) + dy - 0xC00, 0, group);
    } while (n-- != 0);
  }
  return 1;
}

void water_drowned(const Player *p) {
  water_bubble((int)__builtin_floor(p->x * 256 + 0.5), (int)__builtin_floor((p->y - 12) * 256 + 0.5), 0, 1);
  act_task_add(after_drowning_run, NULL, (void *)p, PRIORITY_EFFECTS);
}

// the stage music manager's drowning music (gMusicManagerState.unk4), which the act here starts and stops itself
void water_drowning_music(void) { music_call(MUSIC_DROWNING, 0); }
void water_stop_drowning_music(void) { stop_song(MUS_DROWNING); }
