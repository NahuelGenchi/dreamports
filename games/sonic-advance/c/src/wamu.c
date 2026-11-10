// Wamu, Angel Island's flying snake (enemy kind 13). Translated from the JavaScript version's engine/enemies.js (the
// original's wamu.c: CreateEntity_Wamu and Task_Wamu). Its head swings to and fro on an arc, its angle stepping by 5 or 8
// (1024 a turn) between two limits, and turns round at a swing's end beyond its range. It keeps its last 64 places: two tail
// segments and two body segments follow it, each where the head was some frames before, 24, 19, 14 and 7 frames back across
// and 40, 30, 20 and 10 up and down, each leaning out by half its distance from the head. Only the head can be destroyed;
// every segment's box hurts Sonic at the segment's own place (the decompilation tests them at the head's, the ROM doesn't).

#include "enemies.h"

enum {
  ANIM_WAMU = 431, VARIANT_HEAD = 0, VARIANT_BODY = 1, VARIANT_TAIL = 2,
  PLACES = 64,
  START_ANGLE = 100,
};

// each segment: which sprite, how many frames back across and up and down
static const struct { int tail, back, up; } SEGMENTS[] = { { 1, 24, 40 }, { 1, 19, 30 }, { 0, 14, 20 }, { 0, 7, 10 } };

typedef struct {
  Object o;            // the head
  Sprite body, tail;
  int qx, qy, angle, out, n;
  int16_t xs[PLACES], ys[PLACES];
} Wamu;

/** A segment's box on Sonic's body at its own place */
static void hurts(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  const Hitbox *box = object_box(s, 0), *body = object_box(&p->sprite, 0);
  if (box && body && collide_overlap(x, y, box, enemy_sonic_x(), enemy_sonic_y(), body)) world_damage(p);
}

/** Task_Wamu */
static int wamu_run(ActTask *t) {
  Wamu *w = (Wamu *)t->data;
  Sprite *head = &w->o.sprite;
  Slot *slot = w->o.slot;
  const Entity *e = &slot->e;
  EnemyData d = enemy_data(e);
  int ended = 0;
  w->qx += SINE[(w->angle & 1023) + 256] / (80 - d.d3 * 4);
  w->qy += SINE[w->angle & 1023] / 80;
  int x = s16(e->x + (w->qx >> 8)), y = s16(e->y + (w->qy >> 8));
  // facing right it swings between 100 and 924 the short way round, over 0; facing left between 412 and 612
  if (head->frameFlags & SPRITE_X_FLIP) {
    w->angle = (w->angle + (w->out ? 5 : -5)) & 0xFFFF;
    if ((((w->angle & 1023) - 101) & 0xFFFF) < 823) { w->angle = w->out ? 100 : 924; w->out = !w->out; ended = 1; }
  } else if (w->out) {
    w->angle = (w->angle + 5) & 0xFFFF;
    if ((w->angle & 1023) > 612) { w->angle = 612; w->out = 0; ended = 1; }
  } else {
    w->angle = (w->angle - 8) & 0xFFFF;
    if ((w->angle & 1023) < 412) { w->angle = 412; w->out = 1; ended = 1; }
  }
  w->n = (w->n + 1) & 0xFF;
  w->xs[w->n & 63] = (int16_t)x; w->ys[w->n & 63] = (int16_t)y;
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (enemy_attack(head, x, y)) { slot->gone = 1; return 0; }
  int right = (head->frameFlags & SPRITE_X_FLIP) != 0, turn = -1;
  if (enemy_i(w->qx) <= d.d0 * ENEMY_TILE) { if (!right && ended) turn = 1; }
  else if (enemy_i(w->qx) >= (d.d0 + d.d2) * ENEMY_TILE) { if (right && ended) turn = 0; }
  if (turn >= 0) {
    enemy_flip_x(head, turn); enemy_flip_x(&w->body, turn); enemy_flip_x(&w->tail, turn);
    w->angle ^= 0x100;
  }
  sprite_step(head);
  object_draw(head, x, y);
  for (unsigned i = 0; i < sizeof SEGMENTS / sizeof SEGMENTS[0]; i++) {
    Sprite *s = SEGMENTS[i].tail ? &w->tail : &w->body;
    int px = w->xs[(w->n - SEGMENTS[i].back) & 63];
    int sx = s16(px - (s16(x - px) >> 1)), sy = w->ys[(w->n - SEGMENTS[i].up) & 63];
    // each sprite's animation steps once, as its first segment is drawn
    if (SEGMENTS[i].back == 24 || SEGMENTS[i].back == 14) sprite_step(s);
    object_draw(s, sx, sy);
    hurts(s, sx, sy);
  }
  return 1;
}

/** TaskDestructor_Wamu */
static void wamu_end(ActTask *t) {
  Wamu *w = (Wamu *)t->data;
  object_sprite_free(&w->body);
  object_sprite_free(&w->tail);
  object_end(t);
}

static void segment_sprite(Sprite *s, int variant) {
  object_sprite_at(s, vram_malloc((uint32_t)sprite_tiles(ANIM_WAMU, VARIANT_HEAD, VARIANT_TAIL)), ANIM_WAMU, variant, ENEMY_ORDER,
                   ENEMY_PRIORITY, 0, 0);
  sprite_step(s);
}

/** CreateEntity_Wamu */
ActTask *wamu_spawn(Slot *slot) {
  Wamu *w = OBJECT_NEW(Wamu);
  if (!w) return NULL;
  w->o.slot = slot;
  w->o.x = slot->e.x;
  w->angle = START_ANGLE; w->out = 1;
  for (int i = 0; i < PLACES; i++) { w->xs[i] = (int16_t)slot->e.x; w->ys[i] = (int16_t)slot->e.y; }
  segment_sprite(&w->o.sprite, VARIANT_HEAD);
  segment_sprite(&w->body, VARIANT_BODY);
  segment_sprite(&w->tail, VARIANT_TAIL);
  ActTask *t = object_task(&w->o, wamu_run, PRIORITY_OBJECTS);
  if (!t) { object_sprite_free(&w->body); object_sprite_free(&w->tail); return NULL; }
  t->end = wamu_end;
  return t;
}
