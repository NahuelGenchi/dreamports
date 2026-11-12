// The normal ending's congratulations, after X Zone's results (SAT-R decompilation, src/game/sa1/ui/
// extra_stage_results.c: CreateCongratulationsAnimation and the tasks it starts), as the JavaScript version's
// engine/congratulations.js has it. The character falls through the sky, the Tornado catches him and pulls him up onto
// its wing, the Flickies fly past, and he leaps off toward the screen as "Congratulations!" comes up over his
// thumbs-up. One main task counts each scene's frames; the sprites' tasks after it read its count, and it changes what
// each of them runs from scene to scene. Then the staff credits (credits.c).

#include "sa.h"

enum {
  SONG_TORNADO_RESCUE = 38,
  ANIM_TORNADO = 736, ANIM_FLICKY = 788, ANIM_STREAK = 776, ANIM_LINES = 785, ANIM_CLOUDS = 790,
  // the sky: its 256 colours, then its tiles and its map (gUnknown_086BBC34, 086BBE34 and 086BE7B4)
  OFFSET_SKY = 0x6B4B10, SKY_COLOURS = 0x200, SKY_TILES = 0x2980, SKY_MAP = 0x1000,
  UIGFX_FROM_BASE = 0x80,   // a picture whose tiles start at the background's first tile (UIGFX_OPTIONS)
  // the tables by character, an animation and a variant each (gUnknown_0868B3D8 on), 16 bytes apart
  OFFSET_TABLES = 0x6842D4,
  T_FALL = 0, T_CLOSE_UP, T_PILOT, T_PILOT_LOOKS, T_CAUGHT, T_CAUGHT_2, T_PULLED, T_RIDE, T_LEAP, T_LEAP_2, T_LEAP_3,
  T_LEAP_SHIFT, T_FLOCK, T_THUMBS_UP,
  // the lines' places, three 16-bit numbers each: where each stops, and the frame each starts up from the bottom
  OFFSET_LINE_STOPS = 0x6843B4, OFFSET_LINE_STARTS = 0x6843BA,
  STREAKS = 15, FLOCK = 8, CLOUDS = 4, LINES = 3, WAVE = 64,
  PRIORITY_MAIN = 0x2100, PRIORITY_PIECES = 0x2120,
};
#define Q(v) ((v) * 256)

/** A sprite's task: its count, which the main task gives it, and what its own task keeps, in 8.8 */
typedef struct {
  Sprite s;
  Transform tf;
  uint32_t count;
  int32_t x, speed, y, fall;
  int16_t xs[STREAKS], wave[WAVE];
  int8_t at;
  int turns, line;
} Piece;
typedef struct { Sprite s; int32_t x, dx, y, dy; } Cloud;

static struct {
  Fade fade;
  int count;
  Piece sonic, tails, tornado, flickies, closeUp, streaks, lines[LINES];
  Cloud clouds[CLOUDS];
  Task *tSonic, *tTails, *tTornado, *tFlickies, *tCloseUp, *tStreaks, *tLines[LINES], *tClouds[CLOUDS];
} scene;

static int table(int which, int k) { return (int)rom_u16(OFFSET_TABLES + which * 16 + ctx.character * 4 + k * 2); }
static void set_anim(Sprite *s, int which) {
  s->graphics.anim = (uint16_t)table(which, 0);
  s->variant = (uint8_t)table(which, 1);
  s->prevVariant = 0xFF;
}
static void show(Sprite *s) { update_sprite(s, 0); display_sprite(s); }
static int sine(uint32_t count) { return SINE[(count & 0xFF) * 4]; }

static void nothing(Task *t) { (void)t; }

// ---- the clouds ----

static void cloud_show(Cloud *c) {
  c->s.x = (int16_t)(c->x >> 8); c->s.y = (int16_t)(c->y >> 8);
  show(&c->s);
}
// sub_806844C: up from below, round to the bottom again further right
static void cloud_rise(Task *t) {
  Cloud *c = t->data;
  c->y += c->dy;
  if (c->y < -Q(16)) {
    c->y = Q(172);
    c->x += c->dx * 200;
    if (c->x > Q(272)) c->x -= Q(300);
  }
  cloud_show(c);
}
// Task_80684B4: off the top, and gone
static void cloud_leave(Task *t) {
  Cloud *c = t->data;
  if (c->y < -Q(16)) return;
  c->y += c->dy;
  cloud_show(c);
}
// sub_80683D8: down and to the right
static void cloud_fall(Task *t) {
  Cloud *c = t->data;
  c->x += Q(8); c->y += Q(8);
  c->x += c->dx;
  if (c->x > Q(272)) c->x -= Q(300);
  c->y += c->dy;
  if (c->y > Q(172)) c->y -= Q(300);
  cloud_show(c);
}
// Task_8068360: drifting
static void cloud_drift(Task *t) {
  Cloud *c = t->data;
  c->x += c->dx;
  if (c->x > Q(272)) c->x = -Q(120);
  if (c->x < -Q(120)) c->x = Q(272);
  c->y += c->dy;
  if (c->y > Q(172)) c->y = -Q(16);
  if (c->y < -Q(16)) c->y = Q(172);
  cloud_show(c);
}

// ---- the sprites' tasks ----

// Task_8066DD0: where it is
static void stay(Task *t) { show(&((Piece *)t->data)->s); }
// Task_8066F14: the Tornado's animation runs, off screen
static void unseen(Task *t) { update_sprite(&((Piece *)t->data)->s, 0); }

// Task_8066628: caught, then pulled up and off to the left
static void caught(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count & 0xFFFF;
  if (k == 15) set_anim(&p->s, T_CAUGHT);
  else if (k == 20) set_anim(&p->s, T_CAUGHT_2);
  else if (k == 30) set_anim(&p->s, T_PULLED);
  if (k > 20) {
    p->y -= Q(8);
    if (p->y < -Q(64)) p->y = -Q(64);
    p->s.y = (int16_t)(p->y >> 8);
    p->x -= p->speed;
    if (p->x < 0) p->x = 0;
    p->s.x = (int16_t)(p->x >> 8);
  }
  show(&p->s);
}
// Task_8066E5C and Task_8066F30: Tails and the Tornado fly in from the right and up after him
static void fly_in(Task *t) {
  Piece *p = t->data;
  p->x -= p->speed;
  if (p->x < 0) p->x = 0;
  p->s.x = (int16_t)(p->x >> 8);
  if ((p->count & 0xFFFF) > 20) {
    p->y -= Q(8);
    if (p->y < -Q(30)) p->y = -Q(30);
    p->s.y = (int16_t)(p->y >> 8);
  }
  show(&p->s);
}
// Task_8066DF4: down from the top left, onto the wing
static void landing(Task *t) {
  Piece *p = t->data;
  p->x += p->speed;
  p->s.x = (int16_t)((p->x >> 8) - 20);
  p->y += Q(8);
  p->s.y = (int16_t)(p->y >> 8);
  show(&p->s);
}
// Task_8066EBC and Task_8066F90: Tails and the Tornado come down into the middle under him
static void come_down(Task *t) {
  Piece *p = t->data;
  p->x += p->speed;
  if (p->x < 0) p->x = 0;
  p->s.x = (int16_t)(p->x >> 8);
  p->y += Q(8);
  if (p == &scene.tails && p->y < -Q(30)) p->y = -Q(30);
  p->s.y = (int16_t)(p->y >> 8);
  show(&p->s);
}
// Task_80666E0: on the wing, bobbing with the Tornado, standing up on the 300th frame
static void ride(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count & 0xFFFF;
  if (k == 300) set_anim(&p->s, T_RIDE);
  p->y += sine(k) >> 8;
  p->s.y = (int16_t)(p->y >> 8);
  show(&p->s);
}
// Task_80669A0: Tails in the cockpit, bobbing, looking round on the 300th frame of the scene that asks him to and back
// on the first frame of the next
static void pilot(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count & 0xFFFF;
  if (k == 300 && p->turns) { set_anim(&p->s, T_PILOT_LOOKS); p->turns = 0; }
  else if (k == 1 && p->turns) { set_anim(&p->s, T_PILOT); p->turns = 0; }
  p->y += sine(k) >> 8;
  p->s.y = (int16_t)(p->y >> 8);
  show(&p->s);
}
// Task_8066FDC: the Tornado bobbing
static void bob(Task *t) {
  Piece *p = t->data;
  p->y += sine(p->count) >> 8;
  p->s.y = (int16_t)(p->y >> 8);
  show(&p->s);
}

// Task_8066A5C: the Flickies' wave moves on
static void wave(Piece *p) {
  if (++p->at > WAVE - 1) p->at = 0;
  p->wave[p->at] = (int16_t)(SINE[((p->count & 0xFFFF) % WAVE) * 8] >> 10);
}
static void wave_unseen(Task *t) { wave(t->data); }
// Task_8066ACC and Task_8066BA4: the eight of them flying in from the right in a wave, then staying
static void flock(Piece *p, int stays) {
  wave(p);
  update_sprite(&p->s, 0);
  for (int i = 0; i < FLOCK; i++) {
    int dx = (int8_t)rom_u8(OFFSET_TABLES + T_FLOCK * 16 + i * 2), dy = (int8_t)rom_u8(OFFSET_TABLES + T_FLOCK * 16 + i * 2 + 1);
    p->s.x = (int16_t)(stays ? dx + 0xBC : dx + 0xF8 - (int)(p->count & 0xFFFF));
    p->s.y = (int16_t)(dy + 80 + p->wave[((uint8_t)p->at + i * 8) & (WAVE - 1)]);
    display_sprite(&p->s);
  }
}
static void flock_in(Task *t) { flock(t->data, 0); }
static void flock_stays(Task *t) { flock(t->data, 1); }

// Task_8067020: the sky scrolls up a line every other frame
static void sky(Task *t) {
  Piece *p = t->data;
  if ((p->count & 0xFFFF) % 2 == 0) e.bgScroll[1]++;
}
// Task_8067054: the close-up, held on its first frame
static void close_up(Task *t) {
  Piece *p = t->data;
  p->s.prevVariant = 0xFF;
  show(&p->s);
}
// Task_8067084: the thumbs-up, from the 360th frame
static void thumbs_up(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count & 0xFFFF;
  if (k < 360) return;
  if (k == 360) set_anim(&p->s, T_THUMBS_UP);
  show(&p->s);
}
// Task_8066C78: fifteen streaks rising 16 px a frame, each starting again from a random place every 16
static void streaks(Task *t) {
  Piece *p = t->data;
  uint32_t k = ++p->count;
  p->s.prevVariant = 0xFF;
  update_sprite(&p->s, 0);
  for (uint32_t i = 0; i < STREAKS; i++) {
    if ((k + i) & 0xF) p->wave[i] = (int16_t)(p->wave[i] - 0x10);
    else {
      p->wave[i] = (int16_t)((int32_t)front_random() % 40 + 0x8C);
      p->xs[i] = (int16_t)((int32_t)front_random() % 0xDC + 0x14);
    }
    p->s.x = p->xs[i]; p->s.y = p->wave[i];
    display_sprite(&p->s);
  }
}
// Task_8066D64: a line of the congratulations, up from the bottom to its place
static void line_up(Task *t) {
  Piece *p = t->data;
  uint32_t k = p->count & 0xFFFF, from = (uint32_t)rom_s16(OFFSET_LINE_STARTS + p->line * 2);
  if (k <= from) return;
  int stop = rom_s16(OFFSET_LINE_STOPS + p->line * 2);
  p->s.x = 120;
  p->s.y = (int16_t)(180 - (int)(k - from) * 3);
  if (p->s.y < stop) p->s.y = (int16_t)stop;
  show(&p->s);
}

// Task_8066768: bobbing, crouching on the 240th frame and leaping on the 300th: up, then down toward the screen through
// the rotation hardware, growing, until the 360th
static void leap(Task *t) {
  Piece *p = t->data;
  Sprite *s = &p->s;
  Transform *tf = &p->tf;
  uint32_t k = p->count & 0xFFFF;
  if (k == 1) set_anim(s, T_LEAP);
  else if (k == 240) { set_anim(s, T_LEAP_2); p->fall = -0x400; }
  if (k >= 300) {
    if (k == 300) {
      set_anim(s, T_LEAP_3);
      tf->rotation = 0;
      tf->qScaleX = tf->qScaleY = (int16_t)bios_div(Q(7), 10);
      tf->x = s->x; tf->y = s->y;
    }
    p->fall += 0x1E;
    p->y += p->fall;
  } else p->y += (sine(k) >> 6) >> 2;
  s->y = (int16_t)(p->y >> 8);
  if (k >= 300) {
    // how far the turned frame moves on its first two frames, by character (gUnknown_0868B488)
    int shift = (int8_t)rom_u8(OFFSET_TABLES + T_LEAP_SHIFT * 16 + (k == 300 ? 0 : 8) + ctx.character * 2);
    if (k == 300) { tf->x = (int16_t)(tf->x - shift); tf->y = (int16_t)(s->y - shift); }
    else if (k == 301) { tf->x = (int16_t)(shift + ((SINE[44] >> 6) >> 6) + tf->x); tf->y = (int16_t)(shift + s->y); }
    else if (k <= 360) { tf->x = (int16_t)((SINE[(k - 300) * 12 + 0x20] >> 12) + (uint16_t)tf->x); tf->y = s->y; }
    // past the 360th frame nothing of him is shown, and the original's sine runs off its table
    if (tf->qScaleX + 4 > Q(3) / 2) tf->qScaleX = Q(3) / 2; else tf->qScaleX = (int16_t)(tf->qScaleX + 4);
    if (tf->qScaleY + 4 > Q(3) / 2) tf->qScaleY = Q(3) / 2; else tf->qScaleY = (int16_t)(tf->qScaleY + 4);
    s->frameFlags = 0x1061;
    transform_sprite(s, tf);
  } else s->frameFlags = 0x1000;
  update_sprite(s, 0);
  if (k <= 360) display_sprite(s);
}

// ---- the main task's scenes ----

static void to_credits(Task *t);

static void counts(int n, Piece *a, Piece *b, Piece *c, Piece *d) {
  scene.count = n;
  if (a) a->count = (uint32_t)n;
  if (b) b->count = (uint32_t)n;
  if (c) c->count = (uint32_t)n;
  if (d) d->count = (uint32_t)n;
}

// Task_8066520: the leap and the thumbs-up, the lines, and from the 670th frame the fade to black
static void leap_scene(Task *t) {
  int n = scene.count + 1;
  if (n > 700) { to_credits(t); return; }
  if (n >= 670) {
    if (n == 670) scene.fade = create_fade(0, 1, 1, 0, 0xC0, 1);
    fade_step(&scene.fade);
  }
  counts(n, &scene.closeUp, &scene.sonic, &scene.flickies, &scene.tornado);
  scene.tails.count = (uint32_t)n;
  for (int i = 0; i < LINES; i++) scene.lines[i].count = (uint32_t)n;
}
// Task_8066478: the close-up of the two of them
static void close_up_scene(Task *t) {
  int n = scene.count + 1;
  if (n > 240) {
    n = 0;
    for (int i = 0; i < LINES; i++) scene.tLines[i]->main = line_up;
    scene.tSonic->main = leap;
    scene.tCloseUp->main = thumbs_up;
    t->main = leap_scene;
  }
  if (n == 1) scene.tails.turns = 1;
  counts(n, &scene.sonic, &scene.flickies, &scene.tornado, &scene.tails);
}
// Task_80663EC: the Flickies fly in, and stay from the 60th frame; the character's bob counts on from 0x3FF
static void flickies_scene(Task *t) {
  int n = scene.count + 1;
  if (n == 60) scene.tFlickies->main = flock_stays;
  if (n > 200) {
    n = 0;
    scene.tCloseUp->main = close_up;
    t->main = close_up_scene;
  }
  counts(n, &scene.flickies, &scene.tornado, &scene.tails, NULL);
  scene.sonic.count = (uint32_t)(n + 0x3FF);
}
// Task_806636C: riding the wing
static void ride_scene(Task *t) {
  int n = scene.count + 1;
  if (n > 400) {
    n = 0;
    scene.tFlickies->main = flock_in;
    t->main = flickies_scene;
  }
  if (n == 300) scene.tails.turns = 1;
  counts(n, &scene.sonic, &scene.tornado, &scene.tails, NULL);
}
// Task_80662D0: landing on it
static void land_scene(Task *t) {
  int n = scene.count + 1;
  if (n > 16) {
    n = 0;
    for (int i = 0; i < CLOUDS; i++) scene.tClouds[i]->main = cloud_drift;
    scene.tTails->main = pilot;
    scene.tTornado->main = bob;
    scene.tSonic->main = ride;
    t->main = ride_scene;
  }
  counts(n, &scene.sonic, &scene.tornado, &scene.tails, NULL);
}
// Task_80661A8: the Tornado catches him; the clouds come back on the 208th frame
static void catch_scene(Task *t) {
  static const int32_t AGAIN[CLOUDS][3] = { { -Q(30), -Q(120), 0x80 }, { -Q(60), -Q(90), 0x140 }, { -Q(90), -Q(60), 0x100 }, { -Q(120), -Q(30), 0xC0 } };
  int n = scene.count + 1;
  if (n == 208) {
    for (int i = 0; i < CLOUDS; i++) {
      Cloud *c = &scene.clouds[i];
      c->x = AGAIN[i][0]; c->y = AGAIN[i][1]; c->dx = AGAIN[i][2]; c->dy = 0;
      scene.tClouds[i]->main = cloud_fall;
    }
  }
  if (n > 280) {
    n = 0;
    scene.tTails->main = come_down;
    scene.tTornado->main = come_down;
    scene.tSonic->main = landing;
    t->main = land_scene;
  }
  counts(n, &scene.sonic, &scene.tornado, &scene.tails, NULL);
}
// Task_8065F5C: the fall; the clouds come up from below on the 180th frame and go off the top from the 360th
static void fall_scene(Task *t) {
  // each cloud's place in the sprites' tiles, its OAM order, where it starts and its speeds
  static const int32_t MADE[CLOUDS][5] = { { 0x2E80, 0x4C0, 0x3C00, 0x80, -0x3C0 }, { 0x2FC0, 0x480, 0, 0x40, -0x400 },
    { 0x3260, 0x440, 0x7800, 0x100, -0x380 }, { 0x3620, 0x400, 0xB400, 0xC0, -0x480 } };
  int n = scene.count + 1;
  fade_step(&scene.fade);
  if (n == 180) {
    for (int i = 0; i < CLOUDS; i++) {
      Cloud *c = &scene.clouds[i];
      vs_sprite(&c->s, (uint16_t)(ANIM_CLOUDS + i), OBJ_VRAM + (uint32_t)MADE[i][0], 180, 80, (uint16_t)MADE[i][1], 0, 0x1000);
      c->x = MADE[i][2]; c->dx = MADE[i][3]; c->y = 0xC800; c->dy = MADE[i][4];
      scene.tClouds[i] = create_task(cloud_rise, c, PRIORITY_PIECES, 0, NULL);
    }
  }
  if (n == 360) for (int i = 0; i < CLOUDS; i++) scene.tClouds[i]->main = cloud_leave;
  if (n > 400) {
    n = 0;
    destroy_task(scene.tStreaks);
    scene.tTails->main = fly_in;
    scene.tTornado->main = fly_in;
    scene.tSonic->main = caught;
    scene.tCloseUp->main = nothing;
    t->main = catch_scene;
  }
  counts(n, &scene.closeUp, &scene.sonic, &scene.tornado, &scene.tails);
}

static void to_credits(Task *t) {
  (void)t;
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  create_staff_credits();
}

static Task *piece(Piece *p, TaskMain main, int anim, int variant, uint32_t dest, int x, int y, uint16_t oamFlags, int speed) {
  vs_sprite(&p->s, (uint16_t)anim, OBJ_VRAM + dest, x, y, oamFlags, variant, 0x1000);
  p->x = Q(x); p->y = Q(y); p->speed = speed;
  return create_task(main, p, PRIORITY_PIECES, 0, NULL);
}

/** CreateCongratulationsAnimation, once the save is written: the sky, the sprites and their tasks, and the song. */
void create_congratulations(void) {
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x9D86; e.bgCnt[1] = 0x1B8B; e.bgCnt[2] = 0x9880;
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;

  memset(&scene, 0, sizeof scene);
  scene.tSonic = piece(&scene.sonic, stay, table(T_FALL, 0), table(T_FALL, 1), 0x20, 120, 80, 0x180, 0x780);
  update_sprite(&scene.sonic.s, 0);
  scene.tTails = piece(&scene.tails, nothing, table(T_PILOT, 0), table(T_PILOT, 1), 0x7D00, 300, 108, 0x240, 0x780);
  update_sprite(&scene.tails.s, 0);
  scene.tTornado = piece(&scene.tornado, unseen, ANIM_TORNADO, 0, 0xBA0, 300, 108, 0x300, 0x780);
  update_sprite(&scene.tornado.s, 0);
  scene.tFlickies = piece(&scene.flickies, wave_unseen, ANIM_FLICKY, 0, 0x940, 248, 80, 0x3C0, 0x100);
  update_sprite(&scene.flickies.s, 0);
  scene.tCloseUp = piece(&scene.closeUp, sky, table(T_CLOSE_UP, 0), table(T_CLOSE_UP, 1), 0x4020, 120, 80, 0xC0, 0);
  scene.closeUp.x = scene.closeUp.y = 0;
  update_sprite(&scene.closeUp.s, 0);
  scene.tStreaks = piece(&scene.streaks, streaks, ANIM_STREAK, 0, 0x9C0, 120, 80, 0, 0);
  // the original doesn't clear a task's memory, so until each streak first starts again it is where the numbers the
  // results left in that memory put it, the same after every X Zone
  static const int16_t LEFT_X[STREAKS] = { 225, 6, 1792, 14, -21760, 1, 0, 0, 0, 0, 0, 8192, 11908, 32, 1912 };
  static const int16_t LEFT_Y[STREAKS] = { 1, -11520, 10, -27465, 1, 150, 436, 0, 1, -27904, 8, -25243, 1, -426, -230 };
  for (int i = 0; i < STREAKS; i++) { scene.streaks.xs[i] = LEFT_X[i]; scene.streaks.wave[i] = LEFT_Y[i]; }
  update_sprite(&scene.streaks.s, 0);
  static const uint32_t LINE_TILES[LINES] = { 0x1AA0, 0x2340, 0x2820 };
  for (int i = 0; i < LINES; i++) {
    scene.tLines[i] = piece(&scene.lines[i], nothing, ANIM_LINES, i, LINE_TILES[i], 180, 80, 0, 0);
    scene.lines[i].line = i;
  }
  create_task(fall_scene, NULL, PRIORITY_MAIN, 0, NULL);
  // from white, over the whole screen
  scene.fade = create_fade(0, 1, 8, 0, 0x80, 1);
  fade_show(&scene.fade);

  UiGfx sky_ = { .uiGfxID = UIGFX_FROM_BASE, .unk2B = 0, .tiles = OFFSET_SKY + SKY_COLOURS, .tilesSize = SKY_TILES,
    .palette = OFFSET_SKY, .paletteSize = SKY_COLOURS, .layout_ = OFFSET_SKY + SKY_COLOURS + SKY_TILES, .layoutSize = SKY_MAP,
    .unk28 = 0, .unk29 = 0, .unk2A = 0x15 };
  load_ui_gfx(&sky_);
  play_song(SONG_TORNADO_RESCUE);
}
