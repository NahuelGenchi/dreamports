// The fall into a special stage and the Chaos Emerald's scene, translated from special/intro.js (SAT-R's
// src/game/sa1/ui/special_stage_intro.c).
//
// The fall: 90 frames of the character dropping down the sky, past streaks of light, fading in from black and out
// again, then 150 frames of them over the clouds on their board, with a word blinking under them, before the stage.
// The emerald's scene: the clouds again, the Tornado and a cloud of its smoke flying in from the right, the character
// dropping in, then rising with the emerald from frame 162 on, with its music, and a fade to white into the results.

#include "special.h"

// the special stages' UI task is made in the same memory each time, and the acts between leave it alone, so its slots
// start as the last stage left them; the title card's band reads its slot on its first frame, before loading it
UiSlot spUiSlots[30];
int spStreaksLeft;

#define UIGFX_OPTIONS 0x80
enum { ANIM_STREAK = 776, ANIM_WORD = 0x32B, ANIM_SMOKE = 0x2E0, ANIM_SPARKLE = 0x2FD };
static const int ANIM_CLOUDS[4] = { 790, 791, 792, 793 };
#define FALL_FRAMES 90
#define BOARD_FRAMES 150
#define FADE_STEP 0x150
#define EMERALD_FADE_STEP 0x128
// the special stage's tables (gUnknown_0868B584 on), as offsets from the first: each character's animation and variant
// falling, on the board, in the emerald's scene before and after it takes the emerald, the Tornado, and the emeralds, a
// row of characters per stage
enum { TABLE_FALL = 0x0, TABLE_BOARD = 0x10, TABLE_WAITING = 0x20, TABLE_TORNADO = 0x30, TABLE_EMERALDS = 0x40, TABLE_HOLDING = 0xB0 };
// the clouds picture: its colours, then its tiles and map (gUnknown_086BBC34, gUnknown_086BBE34, gUnknown_086BE7B4)
enum { CLOUDS_PALETTE = 0x0, CLOUDS_TILES = 0x200, CLOUDS_TILES_SIZE = 0x2980, CLOUDS_MAP = 0x2B80, CLOUDS_MAP_SIZE = 0x1000 };
// the clouds that drift across the emerald's scene: y, x, x speed (Q8)
static const int DRIFT[4][3] = { { 50, 80, 0x80 }, { 100, 40, 0x40 }, { 120, 120, 0x100 }, { 20, 160, 0x120 } };
static const uint32_t CLOUD_TILES[4] = { 0x6040, 0x6180, 0x6420, 0x7080 };
#define Q(v) ((int32_t)((v) * 256))

/** PSEUDO_RANDOM_32: the game's random numbers, one sequence the act's code shares. */
int32_t sp_random(void) {
  spGame.seed = spGame.seed * 0x196225u + 0x3C6EF35Fu;
  return (int32_t)spGame.seed;
}

// a character's animation and variant from one of the tables
static void anim_of(int table, int index, int *anim, int *variant) {
  uint32_t at = OFFSET_SPECIAL_INTRO + table + index * 4;
  *anim = (int)rom_u16(at); *variant = (int)rom_u16(at + 2);
}

static void sprite(Sprite *s, uint32_t dest, int anim, int variant, int x, int y, int oamFlags, int palId) {
  sprite_init(s);
  s->graphics.src = 0; s->graphics.dest = OBJ_VRAM + dest; s->graphics.size = 0; s->graphics.anim = (uint16_t)anim;
  s->variant = (uint8_t)variant; s->x = (int16_t)x; s->y = (int16_t)y; s->oamFlags = (uint16_t)oamFlags;
  s->palId = (uint8_t)palId; s->frameFlags = 0x1000;
}
static void show(Sprite *s) { update_sprite(s, 0); display_sprite(s); }

// a sprite moving by its 8.8 speeds (strc44): the fall, the board, the emerald's scene's pieces
typedef struct { int unk30; int32_t qUnk34, qUnk38, qUnk3C, qUnk40; Sprite s; } Mover;

// the clouds picture in layer 0 (sub_80528AC)
static void load_clouds(void) {
  UiGfx g = { 0 };
  g.uiGfxID = UIGFX_OPTIONS; g.tiles = OFFSET_SPECIAL_CLOUDS + CLOUDS_TILES; g.tilesSize = CLOUDS_TILES_SIZE;
  g.layout_ = OFFSET_SPECIAL_CLOUDS + CLOUDS_MAP; g.layoutSize = CLOUDS_MAP_SIZE;
  g.palette = OFFSET_SPECIAL_CLOUDS + CLOUDS_PALETTE; g.paletteSize = 0x200;
  g.unk28 = 0; g.unk29 = 0; g.unk2A = 0x15; g.unk2B = -1;
  load_ui_gfx(&g);
}

// the screens' layer 0: the clouds picture, 296 lines down
static void set_up_layers(void) {
  create_ui_task_keeping(spUiSlots);
  ui_gfx_stack_init();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x9D86;
  e.bgScroll[0] = 0; e.bgScroll[1] = 0x128;
}

// --- the fall ------------------------------------------------------------------------------------------------------
static Mover fall;
static struct { int unk30; int32_t xs[16], ys[16]; Sprite s; } streaks;
static struct { int unk30; Sprite s; } word;
static struct { int unk18; Task *fallTask, *streaksTask, *wordTask; Fade fade; } intro;

static void fall_step(Task *t);
static void streaks_step(Task *t);
static void intro_fall(Task *t);

/** CreateSpecialStageIntro: the fall, from the special spring. */
void sp_intro_create(void) {
  int character = spGame.character, anim, variant;
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  set_up_layers();

  memset(&fall, 0, sizeof fall);
  fall.qUnk34 = -Q(3.8125); fall.qUnk38 = Q(180); fall.qUnk3C = -Q(1); fall.qUnk40 = Q(120);
  anim_of(TABLE_FALL, character, &anim, &variant);
  sprite(&fall.s, 0x20, anim, variant, 120, 180, 6 << 6, 1);
  intro.fallTask = create_task(fall_step, &fall, 0x2120, 0, NULL);
  update_sprite(&fall.s, 0);

  // the streaks: one sprite shown at 16 places, each moving down 16 lines a frame and placed anew every 16 frames
  streaks.unk30 = 0;
  for (int i = 0; i < 16; i++) {
    streaks.ys[i] = sp_random() % 40 - 20;
    streaks.xs[i] = sp_random() % 220 + 20;
  }
  sprite(&streaks.s, 0x820, ANIM_STREAK, 0, 120, 80, 0, 0);
  intro.streaksTask = create_task(streaks_step, &streaks, 0x2120, 0, NULL);
  update_sprite(&streaks.s, 0);

  intro.unk18 = 0; intro.wordTask = NULL;
  intro.fade = create_fade(0, 1, 2, 0, FADE_STEP, 1);
  create_task(intro_fall, &intro, 0x2100, 0, NULL);
  fade_show(&intro.fade);
  play_song(SONG_SPECIAL_STAGE_INTRO);
}

static void word_step(Task *t);
static void board_step(Task *t);
static void intro_board(Task *t);

// Task_8068948: the fall's 90 frames. The fade in from black steps twice a frame, and the fade out starts 24 frames
// before the end (0x2000 / 0x150). The clouds picture is loaded on the first frame.
static void intro_fall(Task *t) {
  int n = intro.unk18 + 1;
  fade_step(&intro.fade);
  ui_gfx_stack_init();
  if (n == 1) load_clouds();
  if (n > FALL_FRAMES) {
    intro.unk18 = 0;
    fall.unk30 = 0;
    e.bgScroll[1] = 0;
    intro.fade = create_fade(0, 1, 2, 0, FADE_STEP, 1);
    // word.unk30 is left as the heap has it: 0 from a fresh start, or 28 mod 60 after the course select's tasks
    word.unk30 = spStageIndex ? 28 : 0;
    sprite(&word.s, 0xC80, ANIM_WORD, 0, 120, 120, 0, 0);
    intro.wordTask = create_task(word_step, &word, 0x2120, 0, NULL);
    update_sprite(&word.s, 0);
    // the rings counter's task is later made in this memory, and its blink count is the last streak's line (specialhud.c)
    spStreaksLeft = streaks.ys[15];
    destroy_task(intro.streaksTask);
    intro.fallTask->main = board_step;
    t->main = intro_board;
    return;
  }
  if (n == FALL_FRAMES - 0x2000 / FADE_STEP) intro.fade = create_fade(0, 1, 1, 0, FADE_STEP, 1);
  fade_step(&intro.fade);
  intro.unk18 = n;
  fall.unk30 = n;
}

// Task_8068A78: the 150 frames over the clouds, then the stage
static void intro_board(Task *t) {
  (void)t;
  int n = intro.unk18 + 1;
  if (n > BOARD_FRAMES) {
    destroy_tasks(0, 0xFFFF);
    clear_queues();
    sp_stage_create();
    return;
  }
  if (n == BOARD_FRAMES - 0x2000 / FADE_STEP) intro.fade = create_fade(0, 1, 1, 0, FADE_STEP, 1);
  fade_step(&intro.fade);
  intro.unk18 = n;
  fall.unk30 = n;
}

// Task_SpecialStageIntroInit: the character falling 3.8125 lines a frame
static void fall_step(Task *t) {
  Mover *d = t->data;
  d->qUnk38 -= Q(3.8125);
  d->s.x = (int16_t)I8(d->qUnk40); d->s.y = (int16_t)I8(d->qUnk38);
  show(&d->s);
}

// Task_8068B10: on the board, from frame 41 over the clouds rising and falling back
static void board_step(Task *t) {
  Mover *d = t->data;
  int n = d->unk30;
  if (n == 0) {
    int anim, variant;
    anim_of(TABLE_BOARD, spGame.character, &anim, &variant);
    d->s.graphics.anim = (uint16_t)anim; d->s.variant = (uint8_t)variant; d->s.prevVariant = 0xFF;
    d->qUnk34 -= Q(5);
    d->qUnk38 = Q(180);
    d->qUnk40 = Q(150);
  }
  if (n > 40) {
    d->qUnk40 += d->qUnk3C;
    d->qUnk34 += Q(0.25);
    d->qUnk38 += d->qUnk34;
    d->s.x = (int16_t)I8(d->qUnk40); d->s.y = (int16_t)I8(d->qUnk38);
    show(&d->s);
  }
}

// Task_8068BB0
static void streaks_step(Task *t) {
  (void)t;
  int n = ++streaks.unk30;
  streaks.s.prevVariant = 0xFF;
  update_sprite(&streaks.s, 0);
  for (int i = 0; i < 16; i++) {
    if ((n + i) & 0xF) streaks.ys[i] += 0x10;
    else {
      streaks.ys[i] = sp_random() % 40 - 20;
      streaks.xs[i] = sp_random() % 220 + 20;
    }
    streaks.s.x = (int16_t)streaks.xs[i]; streaks.s.y = (int16_t)streaks.ys[i];
    display_sprite(&streaks.s);
  }
}

// Task_8068CD4: shown for 30 frames out of 60
static void word_step(Task *t) {
  (void)t;
  if (((++word.unk30 / 30) & 1) == 0) show(&word.s);
}

// --- the emerald's scene -------------------------------------------------------------------------------------------
static Mover hero, tornado, smoke, emerald, sparkle;
// a cloud drifting across the emerald's scene: its place and speeds in 8.8
typedef struct { int32_t x, dx, y, dy; Sprite s; } Cloud;
static Cloud clouds[4];
static struct { int unk1C, unk24; Task *heroTask, *tornadoTask, *smokeTask, *emeraldTask; Fade fade; } scene;

static void idle(Task *t) { (void)t; }
static void fly_left(Task *t);
static void cloud_step(Task *t);
static void emerald_scene_start(Task *t);

/** sub_8068D0C: the Chaos Emerald's scene, after the stage is won; then the results. */
void sp_emerald_scene_create(void) {
  int character = spGame.character, anim, variant;
  set_up_layers();

  hero = (Mover){ .qUnk34 = 0x4A0, .qUnk38 = -Q(32), .qUnk40 = Q(170) };
  anim_of(TABLE_WAITING, character, &anim, &variant);
  sprite(&hero.s, 0x20, anim, variant, 120, 180, 0x180, 0);
  scene.heroTask = create_task(idle, &hero, 0x2120, 0, NULL);
  update_sprite(&hero.s, 0);

  tornado = (Mover){ .qUnk38 = Q(100), .qUnk3C = -Q(1), .qUnk40 = Q(350) };
  anim_of(TABLE_TORNADO, character, &anim, &variant);
  sprite(&tornado.s, 0x820, anim, variant, 300, 100, 0x240, 0);
  scene.tornadoTask = create_task(fly_left, &tornado, 0x2120, 0, NULL);
  update_sprite(&tornado.s, 0);

  smoke = (Mover){ .qUnk38 = Q(100), .qUnk3C = -Q(1), .qUnk40 = Q(350) };
  sprite(&smoke.s, 0x12A0, ANIM_SMOKE, 0, 350, 100, 0x300, 0);
  scene.smokeTask = create_task(fly_left, &smoke, 0x2120, 0, NULL);
  update_sprite(&smoke.s, 0);

  for (int i = 0; i < 4; i++) {
    clouds[i].y = Q(DRIFT[i][0]); clouds[i].x = Q(DRIFT[i][1]); clouds[i].dx = DRIFT[i][2]; clouds[i].dy = 0;
    sprite(&clouds[i].s, CLOUD_TILES[i], ANIM_CLOUDS[i], 0, 180, 80, 27 << 6, 0);
    create_task(cloud_step, &clouds[i], 0x2120, 0, NULL);
  }

  scene.unk1C = 0; scene.unk24 = 0; scene.emeraldTask = NULL;
  scene.fade = create_fade(0, 1, 8, 0, EMERALD_FADE_STEP, 1);
  create_task(emerald_scene_start, &scene, 0x2100, 0, NULL);
  fade_step(&scene.fade);
  load_clouds();
}

static void drop_in(Task *t);
static void hold_emerald(Task *t);
static void emerald_scene_rest(Task *t);
static void sparkle_step(Task *t);

// Task_80694E8: the fade in from white; the character drops in from frame 140, and from frame 162 on Task_8069100 runs
// the rest with the emerald's music
static void emerald_scene_start(Task *t) {
  int n = scene.unk1C + 1;
  fade_step(&scene.fade);
  if (n == 0x8C) scene.heroTask->main = drop_in;
  if (n > 0xA1) {
    play_song(SONG_CHAOS_EMERALD);
    scene.unk1C = 0;
    hero.unk30 = 0;
    scene.heroTask->main = hold_emerald;
    t->main = emerald_scene_rest;
    return;
  }
  scene.unk1C = n;
  hero.unk30 = n;
}

// Task_8069100: the emerald appears with a sparkle on the first frame; everything moves 10 lines down then, and from the
// eighth frame on back up a line a frame until the smoke is back at line 100; the fade to white starts on frame 273,
// and 11 frames after it ends come the results
static void emerald_scene_rest(Task *t) {
  (void)t;
  int n = scene.unk1C + 1;
  if (n == 1) {
    sparkle = (Mover){ .qUnk38 = hero.qUnk38 + Q(10), .qUnk3C = -Q(1), .qUnk40 = hero.qUnk40 - Q(8) };
    sprite(&sparkle.s, 0x3820, ANIM_SPARKLE, 0, 120, 180, 0, 0);
    create_task(sparkle_step, &sparkle, 0x2120, 0, NULL);
    update_sprite(&sparkle.s, 0);

    int anim, variant;
    emerald = (Mover){ .qUnk38 = hero.qUnk38, .qUnk3C = -Q(1), .qUnk40 = hero.qUnk40 };
    anim_of(TABLE_EMERALDS, spStageIndex * 4 + spGame.character, &anim, &variant);
    sprite(&emerald.s, 0xAA0, anim, variant, 120, 180, 0x180, 0);
    scene.emeraldTask = create_task(fly_left, &emerald, 0x2120, 0, NULL);
    update_sprite(&emerald.s, 0);
  }
  if (n > 7 && smoke.qUnk38 >= Q(100)) {
    smoke.qUnk38 -= Q(1); tornado.qUnk38 -= Q(1); hero.qUnk38 -= Q(1); emerald.qUnk38 -= Q(1);
  }
  if (n == 1) {
    smoke.qUnk38 += 0xA00; tornado.qUnk38 += 0xA00; hero.qUnk38 += 0xA00; emerald.qUnk38 += 0xA00;
  }
  if (fade_step(&scene.fade) && scene.fade.unk4 == 4) {
    if (scene.unk24 > 10) {
      destroy_tasks(0, 0xFFFF);
      clear_queues();
      sp_results_create(1);
      return;
    }
    scene.unk24++;
  }
  if (n == 0x12C - 0x2000 / EMERALD_FADE_STEP) scene.fade = create_fade(0, 1, 4, 0, EMERALD_FADE_STEP, 1);
  scene.unk1C = n;
  hero.unk30 = n;
}

// Task_80693D0: holding the emerald, drifting left
static void hold_emerald(Task *t) {
  Mover *d = t->data;
  if (d->unk30 == 0) {
    int anim, variant;
    anim_of(TABLE_HOLDING, spGame.character, &anim, &variant);
    d->s.graphics.anim = (uint16_t)anim; d->s.variant = (uint8_t)variant; d->s.prevVariant = 0xFF;
    d->qUnk38 += Q(16);
  }
  fly_left(t);
}

// Task_8069550: dropping in, 0x4A0 a frame down to line 80
static void drop_in(Task *t) {
  Mover *d = t->data;
  d->qUnk38 += 0x4A0;
  if (d->qUnk38 > Q(80)) d->qUnk38 = Q(80);
  d->s.x = (int16_t)I8(d->qUnk40); d->s.y = (int16_t)I8(d->qUnk38);
  show(&d->s);
}

// Task_strc44_806959C: a line a frame to the left, stopping 100 past the screen's left edge
static void fly_left(Task *t) {
  Mover *d = t->data;
  d->qUnk40 -= Q(1);
  if (d->qUnk40 < -Q(100)) d->qUnk40 = -Q(100);
  d->s.x = (int16_t)I8(d->qUnk40); d->s.y = (int16_t)I8(d->qUnk38);
  show(&d->s);
}

// Task_8069634: the sparkle, shown twice, flipped and not, until its animation ends
static void sparkle_step(Task *t) {
  Mover *d = t->data;
  d->s.x = (int16_t)I8(d->qUnk40); d->s.y = (int16_t)I8(d->qUnk38);
  if (update_sprite(&d->s, 0) == 0) { destroy_task(t); return; }
  d->s.frameFlags &= ~SPRITE_X_FLIP;
  display_sprite(&d->s);
  d->s.frameFlags |= SPRITE_X_FLIP;
  display_sprite(&d->s);
}

// Task_8068360: a cloud drifting right, wrapping round from x 272 to -120
static void cloud_step(Task *t) {
  Cloud *d = t->data;
  d->x += d->dx;
  if (d->x > Q(272)) d->x = -Q(120);
  if (d->x < -Q(120)) d->x = Q(272);
  d->y += d->dy;
  if (d->y > Q(172)) d->y = -Q(16);
  if (d->y < -Q(16)) d->y = Q(172);
  d->s.x = (int16_t)I8(d->x); d->s.y = (int16_t)I8(d->y);
  show(&d->s);
}
