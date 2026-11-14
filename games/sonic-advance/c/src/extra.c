// The Moon Zone: its level row (ACT_THE_MOON), BG1 Earth & stars H-blank scroll, BG2 setup, WARNING sign,
// brake dust and display effects. Translated from the JavaScript version's engine/extra.js and engine/extrarender.js
// (SAT-R decompilation: backgrounds/zone_7_act_2.c, player_super_sonic.c).

#include "extra.h"
#include "bosses.h"

enum {
  MUS_EXTRA_BOSS = 26,
  ANIM_WARNING = 719, ANIM_BRAKE_DUST = 748,
  WARNING_TILES = 16, BRAKE_DUST_TILES = 32,
  MAX_BRAKE_DUST = 20,
  STILL_LINES = 90,
};

MoonDisplay moon_disp;
static uint16_t bg1Offsets[DISPLAY_HEIGHT];
static int brakeDustLeft;

// --- BG1 H-blank scroll (HBlankCallback_803F92C) ---------------------------------------------------------------
static void bg1_hblank(int line) {
  int newLine = line - STILL_LINES;
  if (newLine >= 0 && line != DISPLAY_HEIGHT - 1) gba_write(REG_BG0HOFS + 4, bg1Offsets[newLine]);
  else gba_write(REG_BG0HOFS + 4, 0);
}

// the robot's task has started the save (moon_defeated)
static int saving;
int moon_saving(void) { return saving; }

static void moon_start(void) {
  saving = 0;
  memset(&moon_disp, 0, sizeof moon_disp);
  memset(bg1Offsets, 0, sizeof bg1Offsets);
  brakeDustLeft = MAX_BRAKE_DUST;
}

void moon_load_stage(void) {
  const Tilemap *bg = &act.stage.background;
  memset(gba_vram + 0x4000, 0, 0x4000);
  memset(gba_vram + 0xE000, 0, 0x800);
  uint32_t screen = 29u * 0x800u;
  for (int y = 0; y < bg->yTiles; y++) {
    for (int x = 0; x < bg->xTiles; x++) {
      uint16_t entry = (uint16_t)rom_u16(bg->map + (y * bg->xTiles + x) * 2);
      uint32_t at = screen + (uint32_t)(y * 32 + x) * 2u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
  }
  e.dispCnt = 0x3F41;
  e.bgCnt[0] = 0x1F02;
  e.bgCnt[1] = 0x1D0B;
  e.bgCnt[2] = 0x5C85;
  e.bgCnt[3] = 0x1D0B;
  memset(gba_vram + 0xF800, 0, 0x800);
}

static void moon_draw_bg(int camX, int camY) {
  (void)camX; (void)camY;
  e.bgScroll[2] = 0;
  e.bgScroll[3] = 0;
  int t = act_stage_time() - 1;
  if (t < 0) t = 0;
  int off = 0;
  for (int i = 0; i < 10; i++) bg1Offsets[off++] = (uint16_t)((t >> 6) & 0xFF);
  for (int i = 0; i < 5; i++) bg1Offsets[off++] = (uint16_t)((t >> 5) & 0xFF);
  for (int i = 0; i < 8; i++) bg1Offsets[off++] = (uint16_t)((t >> 4) & 0xFF);
  for (int i = 0; i < 16; i++) bg1Offsets[off++] = (uint16_t)((t >> 3) & 0xFF);
  for (int i = 1; i < 32; i++) bg1Offsets[off++] = (uint16_t)(((t >> 3) + ((t * i) >> 5)) & 0xFF);
  e.hblankCallbacks[e.numHblankCallbacks++] = bg1_hblank;
  e.flags |= FLAGS_HBLANK_CALLBACKS;
}

static void moon_after_frame(int shown) {
  if (!shown || !act.cardDone) return;
  e.dispCnt = (uint16_t)((e.dispCnt & ~0xA000u) | (moon_disp.dispCnt & 0xA000u));
  if (moon_disp.winOut) e.winRegs[5] = moon_disp.winOut;
  if (moon_disp.winIn) e.winRegs[4] = moon_disp.winIn;
  if (moon_disp.bldCnt) e.bldCnt = moon_disp.bldCnt;
  e.bldY = moon_disp.bldY;
  if (moon_disp.win0On) {
    e.winRegs[2] = (uint16_t)((moon_disp.win0Top << 8) | moon_disp.win0Bottom);
    set_hblank_copy(REG_WIN0H, 2);
    for (int line = 0; line < DISPLAY_HEIGHT; line++) {
      uint16_t v = (uint16_t)(moon_disp.win0Lines[line * 2] | (moon_disp.win0Lines[line * 2 + 1] << 8));
      put16(e.primary + (uint32_t)line * 2u, v);
    }
  }
}

// --- WARNING sign (sub_804A5D8 & Task_804A71C) ---------------------------------------------------------------
typedef struct { Object o; Transform tf; int piece, count; } Warning;

static int warning_run(ActTask *t) {
  Warning *w = (Warning *)t->data;
  if (w->count >= 0xC0) return 0;
  if (w->count == 0x80 && w->piece == 0) moon_warning_ready();
  int v = (w->count & 0x1F) << 11;
  int sx = 256, sy = 256;
  if (v != 0 && v < 0x4000) sy = SINE[(v >> 6) & 0x3FF] >> 6;
  else if (v >= 0xE000) {
    int k = SINE[(((v - 0xE000) << 1) >> 6) & 0x3FF] >> 6;
    sx = k + 256; sy = 256 - k;
  }
  update_sprite(&w->o.sprite, 0);
  w->tf.x = 120; w->tf.y = 80; w->tf.rotation = 0;
  w->tf.qScaleX = (int16_t)(sx ? sx : 2);
  w->tf.qScaleY = (int16_t)(sy ? sy : 2);
  w->o.sprite.frameFlags = (w->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE)
                         | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE;
  transform_sprite(&w->o.sprite, &w->tf);
  display_sprite(&w->o.sprite);
  w->count++;
  return 1;
}

void moon_warning_start(void) {
  for (int i = 0; i < 4; i++) {
    Warning *w = OBJECT_NEW(Warning);
    if (!w) continue;
    w->piece = i; w->count = 0;
    object_sprite_at(&w->o.sprite, vram_malloc(WARNING_TILES), ANIM_WARNING, i, 0, 0, 0, 0);
    object_task(&w->o, warning_run, 0x2101);
  }
}

// --- brake dust (CreateBrakingDustEffect) ---------------------------------------------------------------------
typedef struct { Object o; int x, y, dx; } BrakeDust;

static int brake_dust_run(ActTask *t) {
  BrakeDust *bd = (BrakeDust *)t->data;
  if (bd->o.sprite.frameFlags & SPRITE_ANIM_OVER) { brakeDustLeft++; return 0; }
  update_sprite(&bd->o.sprite, 0);
  boss_display(&bd->o.sprite, bd->x - cam_x(), bd->y - cam_y());
  bd->x += bd->dx;
  return 1;
}

void moon_boss_brake_dust(int x, int y, int dx) {
  if (brakeDustLeft <= 0) return;
  brakeDustLeft--;
  BrakeDust *bd = OBJECT_NEW(BrakeDust);
  if (!bd) { brakeDustLeft++; return; }
  uint32_t r = act_random();
  bd->x = x; bd->y = y; bd->dx = dx;
  object_sprite_at(&bd->o.sprite, vram_malloc(BRAKE_DUST_TILES), ANIM_BRAKE_DUST, 0, 8, 2, (r & 0x400) != 0, 0);
  if (r & 0x800) bd->o.sprite.frameFlags |= SPRITE_Y_FLIP;
  object_task(&bd->o, brake_dust_run, 0x4001);
}

// --- defeat -> true ending (stops safely on white until true ending is in C) -----------------------------------
static void stop_on_white(Task *t) { destroy_task(t); ctx.done = 1; }
static void after_moon_save(void) {
  sound_vsync_on();
  act_tasks_stop();
  e.dispCnt = 0x1F41; e.bldCnt = 0xBF; e.bldY = 16;
  act_active = 0;
  create_task(stop_on_white, NULL, 0x0F00, 0, NULL);
}

// CreateExtraStageResults' start: the save marks the Moon beaten, every song stops and the sound engine is off while the
// save is written with the interrupts off, so the screen keeps its last picture without BG1's line scrolls
void moon_defeated(void) {
  saving = 1;
  save_moon_beaten();
  stop_all_songs();
  sound_vsync_off();
  if (save_write()) engine_stall(WRITE_FRAMES, after_moon_save);
  else after_moon_save();
}

const Level ACT_THE_MOON = {
  .song = MUS_EXTRA_BOSS, .hudFlash = 90,
  .bgCnt = 0x1D0B,
  .start = moon_start,
  .drawBackground = moon_draw_bg,
  .afterFrame = moon_after_frame,
  .ownsBlend = 1,
};
