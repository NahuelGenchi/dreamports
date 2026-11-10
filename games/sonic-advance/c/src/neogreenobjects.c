// Neo Green Hill act 1's own objects: the boulder and its pieces, the incline ramp, the waterfalls, the half-pipe and the
// grind rails (its boosters are in boosters.c, its trampoline and bounce block in platforms.c, its crumbling platform in
// crumbling.c and its forced slide in slides.c). Translated from the JavaScript version's engine/boulders.js, ramps.js,
// waterfalls.js, halfpipes.js and grindrails.js, in the style of the act's other objects.

#include "objects.h"
#include "terrain.h"

enum {
  ANIM_BOULDER = 458, ANIM_DEBRIS_SMALL = 459, ANIM_DEBRIS_BIG = 460,
  ANIM_WATERFALL = 464,
  ORDER_OBJECT = 18, PRIORITY_FRONT = 2,
  SE_BREAK = 167,
  SE_GRIND_START = 114, SE_GRIND_END = 116,
  DEBRIS = 4, DEBRIS_FRAMES = 60,
};

static int d0(const Slot *s) { return s8(s->e.d[0]); }
static int d1(const Slot *s) { return s8(s->e.d[1]); }
static int d2(const Slot *s) { return s->e.d[2]; }
static int d3(const Slot *s) { return s->e.d[3]; }
static int fl(double v) { return (int)__builtin_floor(v); }

static const Hitbox *box(const Object *o, int slot) { return object_box(&o->sprite, slot); }

// --- the boulder and its pieces (boulders.js) ------------------------------------------------------------------------------
static int breaks(Object *o, int ox, int oy) {
  Player *p = &act.player;
  const Hitbox *hb = box(o, 0);
  if (!hb || p->dead) return 0;
  int px = fl(p->x), py = fl(p->y);
  Hitbox probe = { 0, -11, (int8_t)-(p->offsetY + 1), 11, (int8_t)(p->offsetY + 1) };
  if (p->curled && p->ysp > 0 && collide_overlap(ox, oy, hb, px, py, &probe)) { p->ysp = -p->ysp; return 1; }
  const Hitbox *atk = object_box(&p->sprite, 1);
  if (!p->curled && atk && collide_overlap(ox, oy, hb, px, py, atk)) {
    if (p->ysp > 0) p->ysp = -p->ysp;
    return 1;
  }
  return 0;
}

typedef struct {
  Object o;
  int x, y, qy, vy, n, scale, angle, turn, across, size, cx, cy, sx, sy, matrix;
} Debris;

static int debris_run(ActTask *t) {
  Debris *d = (Debris *)t->data;
  if (d->n > DEBRIS_FRAMES) return 0;
  d->vy += 40;
  d->scale += 8;
  if (d->scale > 512) d->scale = 512;
  d->qy += d->vy >> 8;
  d->angle = (d->angle + d->turn) & 0x3FF;
  d->n++;
  int dx = (d->cx - cam_x()) + d->across * d->n;
  int dy = d->qy - cam_y();
  int half = (d->scale * 128) >> 8;
  int x = d->sx + ((dx * half) >> 8);
  int y = d->sy + ((dy * half) >> 8);
  if (x + d->size < 0 || x - d->size > DISPLAY_WIDTH || y + d->size < 0 || y - d->size > DISPLAY_HEIGHT) return 1;
  Transform tf;
  tf.rotation = (uint16_t)(d->angle & 0x3FF);
  tf.qScaleX = (int16_t)d->scale; tf.qScaleY = (int16_t)d->scale;
  tf.x = (int16_t)x; tf.y = (int16_t)y;
  d->o.sprite.frameFlags = (d->o.sprite.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP))
    | (uint32_t)(4 + d->matrix) | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE;
  transform_sprite(&d->o.sprite, &tf);
  if (objects_drawing()) display_sprite(&d->o.sprite);
  return 1;
}

static void debris_new(const Slot *en, int i) {
  static const int ACROSS[DEBRIS] = { -2, 1, 2, -1 };
  static const int Y[DEBRIS] = { 0, -16, 0, -16 };
  static const int TURN[DEBRIS] = { -42, 42, 14, -14 };
  static const int SIZE[DEBRIS] = { 8, 8, 16, 16 };
  Debris *d = OBJECT_NEW(Debris);
  if (!d) return;
  d->vy = -512; d->scale = 256;
  d->sx = en->e.x - cam_x(); d->sy = en->e.y - cam_y();
  d->cx = cam_x(); d->cy = cam_y() - 16;
  d->qy = d->cy + Y[i];
  d->across = ACROSS[i]; d->turn = TURN[i]; d->size = SIZE[i]; d->matrix = i;
  object_sprite(&d->o.sprite, i < 2 ? ANIM_DEBRIS_SMALL : ANIM_DEBRIS_BIG, 0, 0, 8, PRIORITY_FRONT, 0, 0);
  d->o.sprite.frameFlags = SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE | (uint32_t)(4 + i);
  sprite_step(&d->o.sprite);
  object_task(&d->o, debris_run, PRIORITY_OBJECTS);
}

typedef struct { Object o; } Boulder;

static int boulder_run(ActTask *t) {
  Boulder *b = (Boulder *)t->data;
  Slot *en = b->o.slot;
  const Hitbox *hb = box(&b->o, 0);
  if (hb && breaks(&b->o, en->e.x, en->e.y)) {
    play_song(SE_BREAK);
    dust_cloud(en->e.x, en->e.y);
    for (int i = 0; i < DEBRIS; i++) debris_new(en, i);
    en->gone = 1;
    return 0;
  }
  if (hb) collide_platform(&b->o, en->e.x, en->e.y, hb, &act.player);
  if (off_cam(en->e.x, en->e.y)) return 0;
  sprite_step(&b->o.sprite);
  object_draw(&b->o.sprite, en->e.x, en->e.y);
  return 1;
}

ActTask *boulder_spawn(Slot *slot) {
  Boulder *b = OBJECT_NEW(Boulder);
  if (!b) return NULL;
  b->o.slot = slot; b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, ANIM_BOULDER, 0, 0, ORDER_OBJECT, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, boulder_run, PRIORITY_OBJECTS);
}

// --- the incline ramp (ramps.js) ------------------------------------------------------------------------------------------------
typedef struct { Object o; } Ramp;

static int ramp_run(ActTask *t) {
  Ramp *r = (Ramp *)t->data;
  const Slot *en = r->o.slot;
  Player *p = &act.player;
  int dir = d0(en) ? 1 : -1;
  int w = d2(en) * 8, h = d3(en) * 8;
  int x = fl(p->x), y = fl(p->y);
  if (!p->dead && x >= en->e.x && x <= en->e.x + w && y >= en->e.y && y <= en->e.y + h && p->xsp * dir > 4.0) {
    p->onObject = NULL;
    p->air = 1; p->jumped = 0;
    player_stand_up(p);
    p->ysp = -8.0;
    double fast = p->xsp * dir + 4.0;
    if (fast > 17.0) fast = 17.0;
    p->xsp = dir * fast;
    player_end_attack(p);
    p->pushing = 0; p->airLock = 0;
    p->state = PS_SPIN;
    play_song(170);
  }
  if (off_cam(en->e.x, en->e.y)) return 0;
  return 1;
}

ActTask *ramp_spawn(Slot *slot) {
  Ramp *r = OBJECT_NEW(Ramp);
  if (!r) return NULL;
  r->o.slot = slot; r->o.x = slot->e.x;
  return object_task(&r->o, ramp_run, PRIORITY_OBJECTS);
}

// --- the waterfalls (waterfalls.js) ---------------------------------------------------------------------------------------------
typedef struct { Object o; int phase; } Waterfall;

static int waterfall_run(ActTask *t) {
  Waterfall *w = (Waterfall *)t->data;
  const Slot *en = w->o.slot;
  Player *p = &act.player;
  int x = fl(p->x), y = fl(p->y);
  int top = en->e.y + d1(en) * 8, bottom = top + d3(en) * 8;
  int inside = x >= en->e.x && x <= en->e.x + d2(en) * 8 && y >= top && y <= bottom;
  if (inside && !p->dead) {
    p->ysp += 16.0 / 256;
    w->o.sprite.x = (int16_t)(x - cam_x());
    w->o.sprite.y = (int16_t)(y + 10 - cam_y());
    if (w->phase == 0) { sprite_start(&w->o.sprite, 0); w->phase = 1; }
    sprite_step(&w->o.sprite);
    if (objects_drawing()) display_sprite(&w->o.sprite);
  }
  if (off_cam(en->e.x, en->e.y)) return 0;
  return 1;
}

ActTask *waterfall_spawn(Slot *slot) {
  Waterfall *w = OBJECT_NEW(Waterfall);
  if (!w) return NULL;
  w->o.slot = slot; w->o.x = slot->e.x;
  object_sprite(&w->o.sprite, ANIM_WATERFALL, 0, 5, 5, PRIORITY_FRONT, 0, 0);   // the splash sits in front, at OAM order 5 (waterfall.c)
  return object_task(&w->o, waterfall_run, PRIORITY_OBJECTS);
}

// --- the half-pipe (halfpipes.js) ------------------------------------------------------------------------------------------------
enum { HALF_PIPE_WIDTH = 0x2A0, HALF_PIPE_MIN_SPEED = 0x240, HALF_PIPE_STEP = 0x600 };
static int halfPipeFeet;
static int halfPipeActive;

static int half_pipe_height(const Player *p, int along) {
  if ((unsigned)along > HALF_PIPE_WIDTH - 1u) return 0;
  int v = (int16_t)(p->xsp * 256);
  if (v < 0) v = -v;
  v = (v - HALF_PIPE_MIN_SPEED) / 4;
  if (v < 0) v = 0;
  if (v > 256) v = 256;
  int fast = SINE[v] >> 6;
  if (fast > 256) fast = 256;
  int k = along < HALF_PIPE_WIDTH / 2 ? along : along - HALF_PIPE_WIDTH;
  int turn = (int)(((uint32_t)(k * 32768 / 0x150) << 16) >> 22) + 256;
  return (((-SINE[turn] * 3) >> 2) + 0x3000) * fast >> 8;
}

static void half_pipe_lift(Player *p, int along, int feet) {
  int h = half_pipe_height(p, along);
  if (!p->curled && p->attack == 0 && (p->state == PS_WALK || p->state == PS_HALF_PIPE_LOW || p->state == PS_HALF_PIPE_MID || p->state == PS_HALF_PIPE_HIGH))
    p->state = h < 0x800 ? PS_WALK : h < 0x1800 ? PS_HALF_PIPE_LOW : h < 0x3000 ? PS_HALF_PIPE_MID : PS_HALF_PIPE_HIGH;
  p->halfPipe = 1;
  p->air = 0;
  p->ysp = 0;
  int y = (int)__builtin_floor(p->y * 256);
  int d = feet - h - (p->offsetY << 8) - y;
  if (d < -HALF_PIPE_STEP) d = -HALF_PIPE_STEP;
  if (d > HALF_PIPE_STEP) d = HALF_PIPE_STEP;
  p->y = (double)(y + d) / 256;
}

typedef struct { Object o; } HalfPipe;

static int half_pipe_run(ActTask *t) {
  HalfPipe *hp = (HalfPipe *)t->data;
  const Slot *en = hp->o.slot;
  Player *p = &act.player;
  int start = en->e.kind == 28;
  int left = en->e.x + d0(en) * 8;
  int top = en->e.y + d1(en) * 8;
  int right = left + d2(en) * 8, bottom = top + d3(en) * 8;
  int x = fl(p->x), y = fl(p->y);
  if (x >= left && x < right && y >= top && y < bottom) {
    int faster = (int)(p->xsp * 256) * (start ? 1 : -1) > HALF_PIPE_MIN_SPEED;
    halfPipeActive = faster && !p->air;
    p->halfPipe = halfPipeActive;
    if (halfPipeActive) halfPipeFeet = (int)__builtin_floor(p->y * 256) + (p->offsetY << 8);
  } else if (halfPipeActive && (start ? x >= right : x < left)) {
    if (!p->dead) {
      int v = (int)(p->xsp * 256) + HALF_PIPE_MIN_SPEED - 1;
      if ((v >= 0 && v < 2 * HALF_PIPE_MIN_SPEED - 1) || (e.pressed & KEY_A)) {
        halfPipeActive = 0; p->halfPipe = 0;
        if (p->state == PS_HALF_PIPE_LOW || p->state == PS_HALF_PIPE_MID || p->state == PS_HALF_PIPE_HIGH) p->state = PS_WALK;
      } else if ((int)(p->xsp * 256) * (start ? 1 : -1) >= HALF_PIPE_MIN_SPEED) {
        int along = start ? x - right : x - left + HALF_PIPE_WIDTH;
        half_pipe_lift(p, along, halfPipeFeet);
      }
    }
  }
  // Task_HalfPipeStart looks 800 px back and 368 ahead; Task_HalfPipeEnd 128 back and 1,040 ahead
  int cx = cam_x(), cy = cam_y();
  int out = start ? en->e.x > cx + 368 || en->e.x < cx - 800 : en->e.x > cx + 1040 || en->e.x < cx - 128;
  if (out || en->e.y > cy + 288 || en->e.y < cy - 128) { p->halfPipe = 0; halfPipeActive = 0; return 0; }
  return 1;
}

ActTask *half_pipe_spawn(Slot *slot) {
  HalfPipe *hp = OBJECT_NEW(HalfPipe);
  if (!hp) return NULL;
  hp->o.slot = slot; hp->o.x = slot->e.x;
  return object_task(&hp->o, half_pipe_run, PRIORITY_OBJECTS);
}

// --- the grind rails (grindrails.js) --------------------------------------------------------------------------------------------
typedef struct { Object o; } GrindRail;
static int grinding;

static int grind_run(ActTask *t) {
  GrindRail *g = (GrindRail *)t->data;
  const Slot *en = g->o.slot;
  Player *p = &act.player;
  int w = d2(en) * 8, h = d3(en) * 8;
  int x = fl(p->x), y = fl(p->y);
  int inside = x >= en->e.x && x <= en->e.x + w && y >= en->e.y && y <= en->e.y + h;
  if (en->e.kind == 19) {
    if (!p->dead && inside && !grinding && p->ysp >= 0 && p->xsp > 0) {
      if (p->xsp < 0.5) p->xsp = 0.5;
      grinding = 1;
      p->layer ^= 1;
      play_song(SE_GRIND_START);
    }
  } else if (!p->dead && inside && grinding) {
    int far = x > en->e.x + (w >> 1);
    if (far || (e.input & KEY_A)) {
      p->ysp = far ? -4.875 : -7.0;
      stop_song(SE_GRIND_START);
      play_song(SE_GRIND_END);
      player_end_attack(p);
      p->state = far ? PS_SPIN : PS_HURT;
      p->air = 1;
      p->onObject = NULL;
      grinding = 0;
      p->layer ^= 1;
    }
  }
  if (off_cam(en->e.x, en->e.y)) { if (grinding) { grinding = 0; p->layer ^= 1; } return 0; }
  return 1;
}

ActTask *grind_rail_spawn(Slot *slot) {
  GrindRail *g = OBJECT_NEW(GrindRail);
  if (!g) return NULL;
  g->o.slot = slot; g->o.x = slot->e.x;
  return object_task(&g->o, grind_run, PRIORITY_OBJECTS);
}
