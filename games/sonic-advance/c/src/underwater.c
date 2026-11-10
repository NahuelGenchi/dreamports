// What happens under the water: the splash where Sonic crosses its line, the bubbles he breathes out, the drowning
// countdown and its music, and the air bubbles that rise from the ground (interactable kind 94). Translated from the
// original's water_effects.c (CreateWaterfallSurfaceHitEffect), underwater_effects.c, music_manager.c and air_bubbles.c a
// function at a time, with the JavaScript version's engine/water.js and engine/airbubbles.js as the guide; every comment
// names the function it rewrites.
//
// The rising bubbles sway, grow to full size over their first 16 frames and burst 3 px below the water line, off the screen
// or after 481 frames; while 12 rise no more are made. The countdown's numbers stay where they appeared on the screen, grow
// over 32 frames and rise over 64. An air bubbles spot fizzes, lets small bubbles out and, now and then, a big one Sonic
// breathes from once it has risen for 80 frames.

#include "bosses.h"

enum {
  ANIM_SURFACE_HIT = 581,             // SA1_ANIM_WATER_FALL_HIT_SURFACE
  ANIM_BUBBLES_SMALL = 753, ANIM_BUBBLES_GROUP = 754,   // SA1_ANIM_BUBBLES_SMALL and _GROUP
  ANIM_DROWN_COUNTDOWN = 781,         // SA1_ANIM_DROWN_COUNTDOWN: variant 5 - n shows n
  ANIM_AIR_BUBBLE = 532, ANIM_MINIBUBBLES = 533,       // SA1_ANIM_AIR_BUBBLES and SA1_ANIM_MINIBUBBLES
  VRAM_BUBBLES_SMALL = 0x2A20, VRAM_BUBBLES_GROUP = 0x2AA0,   // VRAM_RESERVED_BUBBLES_SMALL and _GROUP
  SURFACE_HIT_TILES = 12,             // VramMalloc(12)
  COUNTDOWN_TILES = 16 / 8 * (16 / 8), AIR_BUBBLE_TILES = 24 / 8 * (24 / 8), MINIBUBBLES_TILES = 16 / 8 * (16 / 8),
  ORDER_SURFACE_HIT = 7, ORDER_EFFECT = 9, ORDER_BIG_BUBBLE = 15, ORDER_SPOT = 18, PRIORITY_EFFECT = 2,
  PRIORITY_EFFECTS = 0x4001,          // CreateMultiplayerSpriteTask's
  MAX_BUBBLES = 11,                   // MAX_SMALL_BUBBLE_COUNT: no more are made while more than this rise
  BUBBLE_RISE = 0x80,                 // 1/2 px a frame, in 1/256 px
  BUBBLE_LIFE = 0x1E0, BUBBLE_BURST_BELOW = 3,
  COUNTDOWN_LIFE = 0x80, COUNTDOWN_RISING = 0x40, COUNTDOWN_RISE = 0x120,
  OFF_SCREEN = 32,                    // how far off the screen a bubble or a number goes
  MUS_DROWNING = 27, SE_AIR_BUBBLE = 191,
  BIG = 4,                            // the big bubble's unk3C, which keeps it animating and lets him breathe from it
  BREATHE_FROM = 80, BREATHED_FOR = 16,
  BUBBLE_DELAYS = 8,
};

// --- the water line ---------------------------------------------------------------------------------------------------------
static int off_screen(int x, int y) { return x < -OFF_SCREEN || x > SCREEN_W + OFF_SCREEN || y < -OFF_SCREEN || y > SCREEN_H + OFF_SCREEN; }

/** The splash at the line (CreateWaterfallSurfaceHitEffect and Task_UpdateMpSpriteTaskSprite): it stays on the line, and goes
 *  the frame after its animation ends */
typedef struct { Object o; int x; } Splash;

static int splash_run(ActTask *t) {
  Splash *d = (Splash *)t->data;
  int ended = sprite_step(&d->o.sprite);
  object_draw(&d->o.sprite, d->x, water_level());
  return !ended;
}

void water_splash(int x) {
  Splash *d = OBJECT_NEW(Splash);
  if (!d) return;
  d->x = x;
  object_sprite_at(&d->o.sprite, vram_malloc(SURFACE_HIT_TILES), ANIM_SURFACE_HIT, 0, ORDER_SURFACE_HIT, PRIORITY_EFFECT, 0, 0);
  object_task(&d->o, splash_run, PRIORITY_EFFECTS);
}

// --- the bubbles ------------------------------------------------------------------------------------------------------------
static int8_t bubbles;   // gSmallAirBubbleCount

typedef struct { Object o; int x, y, dx, t, flips; } Bubble;

static void transformed(Sprite *s, int x, int y, int scaleX, int scaleY) {
  Transform tf = { 0, (int16_t)scaleX, (int16_t)scaleY, (int16_t)x, (int16_t)y };
  s->frameFlags = (uint32_t)PRIORITY_EFFECT << 12 | SPRITE_ROT_SCALE_ENABLE | (uint32_t)boss_matrix();   // gUnknown_030054B8++ | 0x20
  sprite_step(s);
  transform_sprite(s, &tf);
  if (objects_drawing()) display_sprite(s);
}

/** Task_SpawnAirBubbles */
static int bubble_run(ActTask *t) {
  Bubble *b = (Bubble *)t->data;
  int sx = ((b->x + (SINE[(b->t & 0xFF) * 4] >> 4)) >> 8) - cam_x(), sy = (b->y >> 8) - cam_y();
  int scale = (b->t + 1) << 4;
  if (scale > FULL_SCALE) scale = FULL_SCALE;
  int level = water_level();
  if (off_screen(sx, sy) || level < 0 || (b->y >> 8) - BUBBLE_BURST_BELOW < level || b->t > BUBBLE_LIFE) return 0;
  b->x += b->dx;
  b->y -= BUBBLE_RISE;
  b->dx -= b->dx >> 3;
  b->t++;
  transformed(&b->o.sprite, sx, sy, b->flips & 1 ? -scale : scale, b->flips & 2 ? -scale : scale);
  return 1;
}

/** TaskDestructor_SpawnAirBubbles */
static void bubble_end(ActTask *t) {
  bubbles--;
  object_end(t);
}

/** SpawnAirBubbles: from (x, y) in 1/256 px, drifting `dx` across, small or a group turned by the game's random numbers */
void water_bubble(int x, int y, int dx, int group) {
  if (bubbles > MAX_BUBBLES) return;
  Bubble *b = OBJECT_NEW(Bubble);
  if (!b) return;
  bubbles++;
  b->x = x; b->y = y; b->dx = dx;
  if (group) {
    object_sprite_at(&b->o.sprite, OBJ_VRAM + VRAM_BUBBLES_GROUP, ANIM_BUBBLES_GROUP, 0, ORDER_EFFECT, 0, 0, 0);
    b->flips = (int)((act_random() & 0x30000) >> 16);
  } else object_sprite_at(&b->o.sprite, OBJ_VRAM + VRAM_BUBBLES_SMALL, ANIM_BUBBLES_SMALL, 0, ORDER_EFFECT, 0, 0, 0);
  ActTask *t = object_task(&b->o, bubble_run, PRIORITY_EFFECTS);
  if (t) t->end = bubble_end;
  else bubbles--;
}

/** Task_SpawnBubblesAfterDrowning: on every 4th frame of the clock, one time in four, one or two bubbles near his centre */
static int drowned_run(ActTask *t) {
  (void)t;
  const Player *p = &act.player;
  if (!p->dead) return 0;
  if (!(act.tick & 3) && !(act_random() & 0x300)) {
    int n = (int)((act_random() & 0x100) >> 8);
    do {
      int dx = (int)((act_random() & 0x7FF00) >> 8) - 0x400;
      int dy = (int)((act_random() & 0x7FF00) >> 8) - 0x400;
      int group = (int)((act_random() & 0x100) >> 8);
      water_bubble((int)__builtin_floor(p->x * 256) + dx, (int)__builtin_floor(p->y * 256) + dy - 0xC00, 0, group);
    } while (n-- != 0);
  }
  return 1;
}

/** SpawnBubblesAfterDrowning */
void water_drowned_bubbles(void) { act_task_add(drowned_run, NULL, NULL, PRIORITY_EFFECTS); }

// --- the drowning countdown --------------------------------------------------------------------------------------------------
typedef struct { Object o; int x, y, t; } Countdown;

/** Task_DrowningCountdown */
static int countdown_run(ActTask *t) {
  Countdown *c = (Countdown *)t->data;
  int sx = c->x >> 8, sy = c->y >> 8, scale = (c->t + 1) << 3;
  if (scale > FULL_SCALE) scale = FULL_SCALE;
  if (off_screen(sx, sy) || c->t > COUNTDOWN_LIFE) return 0;
  if (c->t <= COUNTDOWN_RISING) c->y += (-(SINE[(c->t * 4 + 256) & 1023] >> 6) * COUNTDOWN_RISE) >> 8;   // COS_24_8
  c->t++;
  transformed(&c->o.sprite, sx, sy, scale, scale);
  return 1;
}

/** SpawnDrowningCountdownNum: `n`, 5 to 0, over Sonic */
void water_countdown(int n) {
  Countdown *c = OBJECT_NEW(Countdown);
  if (!c) return;
  const Player *p = &act.player;
  c->x = (int)__builtin_floor(p->x * 256) - cam_x() * 256;
  c->y = (int)__builtin_floor(p->y * 256) - cam_y() * 256;
  object_sprite_at(&c->o.sprite, vram_malloc(COUNTDOWN_TILES), ANIM_DROWN_COUNTDOWN, 5 - n, ORDER_EFFECT, PRIORITY_EFFECT, 0, 0);
  object_task(&c->o, countdown_run, PRIORITY_EFFECTS);
}

// --- the drowning music -------------------------------------------------------------------------------------------------------
// gMusicManagerState.unk4: the music manager starts it after this frame's calls (music.c)
void water_drowning_music(void) { music_call(MUSIC_DROWNING, 0); }

/** m4aSongNumStop(MUS_DROWNING), which Sonic's code calls on every frame he is out of the water; the music manager then
 *  finds no music playing and starts the stage's song again */
void water_drowning_music_stop(void) { stop_song(MUS_DROWNING); }

void water_effects_start(void) { bubbles = 0; }

// --- the air bubbles (air_bubbles.c) --------------------------------------------------------------------------------------------
// the frames between two big bubbles, in turn (gUnknown_086CEE60); a stream of small ones starts every half of one of them,
// picked by the stage clock
static const uint16_t DELAYS[BUBBLE_DELAYS] = { 0x012D, 0x00F1, 0x0079, 0x0105, 0x012D, 0x0079, 0x00C9, 0x0079 };

typedef struct { Object o; int big, next, small; } Spot;
typedef struct { Object o; int kind, breathed, t, x, y; } Rising;   // unk3C, unk3D, unk3E, worldX and worldY

static int sway(int t) { return SINE[(t * 3) & 1023] >> 11; }

/** Task_809141C: once he has breathed from it, the bubble stays where it is for 16 more frames */
static int breathed_run(ActTask *t) {
  Rising *r = (Rising *)t->data;
  int x = r->x + sway(r->t), y = r->y - (r->t >> 1), level = water_level();
  if (off_cam(x, y) || --r->breathed < 0 || level < 0 || y < level) return 0;
  sprite_step(&r->o.sprite);
  object_draw(&r->o.sprite, x, y);
  return 1;
}

/** Task_BubbleContainingAir, rising */
static int big_run(ActTask *t) {
  Rising *r = (Rising *)t->data;
  Sprite *s = &r->o.sprite;
  int x = r->x + sway(r->t), y = r->y - (r->t >> 1), level = water_level();
  if (off_cam(x, y) || level < 0 || y < level) return 0;
  ++r->t;
  sprite_step(s);   // r->kind * 8 > r->t, or the big one's kind: it always animates
  if (r->kind == BIG && r->t >= BREATHE_FROM) {
    Player *p = &act.player;
    const Hitbox *box = object_box(s, 0);
    Hitbox body = collide_body(p);
    if (!p->dead && box && collide_overlap(x, y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) {
      player_breathe(p);
      water_drowning_music_stop();
      play_song(SE_AIR_BUBBLE);
      r->breathed = BREATHED_FOR;
      t->run = breathed_run;
    }
  }
  object_draw(s, x, y);
  return 1;
}

/** CreateBubbleContainingAir */
static void big_new(int x, int y) {
  Rising *r = OBJECT_NEW(Rising);
  if (!r) return;
  r->kind = BIG; r->x = x; r->y = y;
  object_sprite_at(&r->o.sprite, vram_malloc(AIR_BUBBLE_TILES), ANIM_AIR_BUBBLE, 0, ORDER_BIG_BUBBLE, PRIORITY_EFFECT, 0, 0);
  sprite_step(&r->o.sprite);
  object_task(&r->o, big_run, PRIORITY_OBJECTS);
}

/** Task_80915F0: a stream's bubble, set off by its low four bits */
static int small_run(ActTask *t) {
  Rising *r = (Rising *)t->data;
  int x = r->x + sway(r->t) + r->kind, y = r->y - (r->t >> 1), level = water_level();
  if (off_cam(x, y) || level < 0 || y < level) return 0;
  r->t++;
  sprite_step(&r->o.sprite);
  object_draw(&r->o.sprite, x, y);
  return 1;
}

/** sub_80914F8: small or a group by the low bit of `n` */
static void small_new(int x, int y, int n) {
  Rising *r = OBJECT_NEW(Rising);
  if (!r) return;
  r->kind = n & 0xF; r->x = x - 8; r->y = y;
  if (n & 1) object_sprite_at(&r->o.sprite, OBJ_VRAM + VRAM_BUBBLES_GROUP, ANIM_BUBBLES_GROUP, 0, ORDER_SPOT, PRIORITY_EFFECT, 0, 0);
  else object_sprite_at(&r->o.sprite, OBJ_VRAM + VRAM_BUBBLES_SMALL, ANIM_BUBBLES_SMALL, 0, ORDER_SPOT, PRIORITY_EFFECT, 0, 0);
  object_task(&r->o, small_run, PRIORITY_OBJECTS);
}

/** Task_AirBubbles */
static int spot_run(ActTask *t) {
  Spot *a = (Spot *)t->data;
  const Entity *e = &a->o.slot->e;
  int x = e->x, y = e->y;
  if (--a->big == 0) {
    big_new(x, y - 4);
    a->big = DELAYS[a->next];
    a->next = (a->next + 1) % BUBBLE_DELAYS;
  }
  if (--a->small == 0) {
    small_new(x, y - 4, ((a->big >> 3) + act.tick) & 0xFF);
    a->small = bios_div(DELAYS[act.tick % BUBBLE_DELAYS], 2);
  }
  if (off_cam(x, y)) return 0;
  sprite_step(&a->o.sprite);
  object_draw(&a->o.sprite, x, y);
  return 1;
}

/** CreateEntity_AirBubbles */
ActTask *air_bubbles_spawn(Slot *slot) {
  Spot *a = OBJECT_NEW(Spot);
  if (!a) return NULL;
  a->o.slot = slot;
  a->o.x = slot->e.x;
  a->big = 120; a->small = 60;
  object_sprite_at(&a->o.sprite, vram_malloc(MINIBUBBLES_TILES), ANIM_MINIBUBBLES, 0, ORDER_SPOT, PRIORITY_EFFECT, 0, 0);
  return object_task(&a->o, spot_run, PRIORITY_OBJECTS);
}
