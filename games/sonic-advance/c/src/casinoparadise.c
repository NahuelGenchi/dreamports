// Casino Paradise Zone's two acts: their rows (levels.h), the city behind them and its fireworks. Translated from the
// JavaScript version's levels.js and engine/backgrounds.js (the original's stage inits for Zone 3 and
// StageBgUpdate_Zone3Acts12).

#include "objects.h"

// the frames a start point leaves out, which the music player skips without playing them (kit/gba/c/sound.c)
void dp_sound_skip_frames(int frames);

enum { FIREWORK_PRIORITY = 0x4001, FIREWORKS = 12 };
typedef struct { Sprite s; int x, y, done, ended; } Firework;
static Firework fireworks[FIREWORKS];

static int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }

// as an act of the zone is made, no firework is showing
static void start(void) {
  for (int i = 0; i < FIREWORKS; i++) fireworks[i].done = 1;
}

static void firework_task(Task *t) {
  Firework *f = (Firework *)t->data;
  // it goes on the frame after its animation ends, drawing its last picture on the frame it ends
  if (f->ended) { f->done = 1; vram_free(f->s.graphics.dest); destroy_task(t); return; }
  if (!update_sprite(&f->s, 0)) f->ended = 1;
  f->s.x = (int16_t)(f->x - act.cam.bgX);
  f->s.y = (int16_t)(f->y - act.cam.bgY);
  f->s.oamFlags = 31 << 6;
  for (int flip = 0; flip < 4; flip++) {
    f->s.frameFlags = (uint16_t)((f->s.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_PRIORITY)) | (3 << 12)
      | (flip & 1 ? SPRITE_X_FLIP : 0) | (flip & 2 ? SPRITE_Y_FLIP : 0));
    display_sprite(&f->s);
  }
}

// the card's frames, where no picture is drawn: the fireworks' states carry on, but nothing goes to OAM
static void fireworks_pre(void) {
  for (int i = 0; i < FIREWORKS; i++) {
    Firework *f = &fireworks[i];
    if (f->done) continue;
    if (!update_sprite(&f->s, 0)) f->ended = 1;
  }
}

static void create_firework(int x, int y, int small) {
  for (int i = 0; i < FIREWORKS; i++) {
    Firework *f = &fireworks[i];
    if (!f->done) continue;   // already showing
    f->done = 0; f->ended = 0; f->x = x; f->y = y;
    sprite_init(&f->s);
    f->s.graphics.anim = (uint16_t)(small ? 483 : 482);
    f->s.graphics.dest = vram_malloc((uint32_t)sprite_tiles(small ? 483 : 482, 0, 0));   // each its own tiles
    f->s.variant = 0; f->s.animSpeed = 0x10; f->s.palId = 0;
    create_task(firework_task, f, FIREWORK_PRIORITY, 0, NULL);
    return;
  }
}

// BACKGROUND_UPDATE.casinoParadise: on every 4th frame of the stage clock, a draw of the game's random numbers with
// bits 8-10 clear sets a firework off at x - 8 … 247 and y - 32 … 95 in the background map
static void background_update(void) {
  int camX = (int)act.cam.x - act.cam.wrapped;
  act.cam.bgX = fdiv(camX << 4, act.stage.width - SCREEN_W);
  act.cam.bgY = fdiv(((int)act.cam.y << 6) + ((int)act.cam.y << 5), act.stage.height - SCREEN_H);
  if ((act_stage_time() & 3) != 0 || (act_random() & 0x700) != 0) return;
  int x = (int)((act_random() & 0xFF00) >> 8) - 8;
  int y = (int)((act_random() & 0x7F00) >> 8) - 32;
  create_firework(x, y, (act_random() & 0x100) != 0);
}

// the camera's fnBgUpdate, once the camera has moved at all
static void camera_moved(int runs) {
  (void)runs;
  if (act.cam.bgUpdates > 0) background_update();
}

// StageBgUpdate_Zone3Acts12: the 256 × 256 map moves 16 px across the act and 96 px down it, and its bands of hedges
// and railing scroll faster through HBlank (BACKGROUND_SCROLL.casinoParadise)
static void draw_city(int camX, int camY) {
  (void)camY;
  static const int BANDS[6] = { 134, 140, 152, 168, 192, 256 };
  static const int SHIFT[5] = { 5, 4, 3, 2, 1 };
  int bgX = act.cam.bgX, bgY = act.cam.bgY;
  e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
  for (int line = 0; line < SCREEN_H; line++) {
    int row = bgY + line, x = bgX;
    for (int b = 4; b >= 0; b--) if (row >= BANDS[b] && row < BANDS[b + 1]) { x = (bgX + ((camX - act.cam.wrapped) >> SHIFT[b])) & 0xFF; break; }
    put16(e.primary + (uint32_t)line * 4, (uint32_t)(x & 0x1FF));
    put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)(bgY & 0x1FF));
  }
}

// --- act 2 from a start point, past its card ---------------------------------------------------------------------
// the stage init starts the act's song before the card; the start point runs those frames with no sound engine
static void second_act_card_starts(void) { music_call(MUSIC_STAGE, act.stage.music); }

// the stage clock, the background and the fireworks' random numbers run through the card's frames, as the original's do
static void second_act_card_frame(void) {
  if (act.cam.bgUpdates > 0) { background_update(); fireworks_pre(); }
}

static void second_act_card_ended(void) {
  // the card's last frame steps the palette animations once, as the original's does; the ones whose longer delays
  // put them behind the original step again, and the ring starts two frames into the act
  static const int behind[] = { 0, 1, 3, 8, 10 };
  for (unsigned k = 0; k < sizeof behind / sizeof behind[0]; k++) {
    act.pal[behind[k]].wait = 0;
    act_palette_step(&act.pal[behind[k]]);
  }
  // animation 818's palette 1, the striped columns' colours, changes five frames later than the card leaves it
  act.pal[2].wait -= 5 * 256;
  act.pal[0].wait -= 512;
  act.pal[10].wait -= 512;
  static const int next[] = { 4, 5, 6, 7, 9 };
  for (unsigned k = 0; k < sizeof next / sizeof next[0]; k++) act.pal[next[k]].wait = 256;
  rings_start_point();
  // the music skips the card's frames the same way, and the held A's jump sound starts one frame before the first
  // frame compared
  gba_sound_frames_gone_by(227);
  int skip = (int)gba_start_number("skip", 232);
  int advance = (int)gba_start_number("jumpadv", 1);
  if (gba_start_number("jump", 0)) {
    dp_sound_skip_frames(skip - advance);
    play_song(SONG_JUMP);
    dp_sound_skip_frames(advance);
  } else dp_sound_skip_frames(skip);
}

static const int PALETTES[] = { 816, 817, 818, 824, 825, 827, 827, 828, 843, 844, 826 };

const Level ACT_CASINO_PARADISE_1 = {
  .song = 16, .hudFlash = 20, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x1D0B,   // 256 × 256, priority 3, map 29 (0xE800), character base 2
  .start = start, .cameraMoved = camera_moved, .drawBackground = draw_city,
};

const Level ACT_CASINO_PARADISE_2 = {
  .song = 17, .hudFlash = 52, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x1D0B,
  .start = start, .cameraMoved = camera_moved, .drawBackground = draw_city,
  .cardStarts = second_act_card_starts, .cardFrame = second_act_card_frame, .cardEnded = second_act_card_ended,
  .sharedRandom = 1,
};
