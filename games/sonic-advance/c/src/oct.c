// Egg Rocket's Oct (enemy kind 14). Translated from engine/oct.js (the original's oct.c: CreateEntity_Oct,
// Task_OctInit, sub_807033C, sub_807051C, sub_80706F0, CreateOctProjectile, Task_OctProjectile). An octopus robot
// that waits until Sonic is within 120 px sideways, patrols left and right at 0.75 px a frame between d0 and
// d0 + d2 tiles from its point, overshooting each end on a half sine wave over 30 frames, and drops a shot straight
// down every 60 frames of patrol. Its art is half of it, drawn twice, the second time mirrored.

#include "enemies.h"

enum {
  ANIM_OCT = 433, VARIANT_PATROL = 0, VARIANT_SHOOT = 1,
  ANIM_OCT_SHOT = 436,
  VRAM_OCT_SHOT = 0x2600,
  SPEED = 192,               // 0.75 px in 1/256 px
  TURN_FRAMES = 30,
  SHOOT_EVERY = 60,
  ORDER_OCT_SHOT = 9,
};
enum { STATE_WAITING, STATE_PATROL, STATE_TURN, STATE_SHOOT };

typedef struct {
  Object o;
  int q, v, n, wait, latched, state;
} Oct;

typedef struct {
  Object o;
  int x, qy;
} OctShot;

static int shot_run(ActTask *t) {
  OctShot *sh = (OctShot *)t->data;
  Sprite *s = &sh->o.sprite;
  sh->qy += 512;
  int y = enemy_i(sh->qy);
  enemy_projectile(s, sh->x, y);
  int sx = sh->x - cam_x(), sy = y - cam_y();
  if (((uint16_t)(sx + 20)) > 240 + 36 || sy + 20 < 0 || sy > 160 + 80) return 0;
  sprite_step(s);
  object_draw(s, sh->x, y);
  return 1;
}

static void shot_new(int x, int y) {
  OctShot *sh = OBJECT_NEW(OctShot);
  if (!sh) return;
  sh->x = x;
  sh->qy = y << 8;
  object_sprite_at(&sh->o.sprite, OBJ_VRAM + VRAM_OCT_SHOT, ANIM_OCT_SHOT, 0, ORDER_OCT_SHOT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&sh->o.sprite);
  object_task(&sh->o, shot_run, ENEMY_SHOT_PRIORITY);
}

static void draw_both(Sprite *s, int x, int y) {
  object_draw(s, x, y);
  s->frameFlags ^= SPRITE_X_FLIP;
  object_draw(s, x, y);
  s->frameFlags ^= SPRITE_X_FLIP;
}

static int oct_run(ActTask *t) {
  Oct *oc = (Oct *)t->data;
  Sprite *s = &oc->o.sprite;
  Slot *slot = oc->o.slot;
  const Entity *e = &slot->e;
  EnemyData d = enemy_data(e);

  if (oc->state == STATE_PATROL) {
    oc->q += oc->v;
  } else if (oc->state == STATE_TURN) {
    int sinVal = SINE[(34 * oc->n) & 0x3FF];
    oc->q += (oc->v < 0 ? 1 : -1) * (sinVal / 55);
  }

  int x = e->x + enemy_i(oc->q), y = e->y;
  if (enemy_gone(e->x, e->y, x, y)) return 0;

  if (oc->state == STATE_WAITING) {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (x - 120 < enemy_sonic_x() && x + 120 > enemy_sonic_x()) {
      s->variant = VARIANT_PATROL;   // as it already was: its animation runs on, not from its start
      oc->state = STATE_PATROL;
    }
  } else if (oc->state == STATE_PATROL) {
    sprite_step(s);
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (enemy_i(oc->q) <= d.d0 * ENEMY_TILE) {
      if (!oc->latched) { oc->latched = 1; oc->v = SPEED; oc->n = 0; oc->state = STATE_TURN; }
    } else if (enemy_i(oc->q) >= (d.d0 + d.d2) * ENEMY_TILE) {
      if (!oc->latched) { oc->latched = 1; oc->v = -SPEED; oc->n = 0; oc->state = STATE_TURN; }
    } else {
      oc->latched = 0;
      if (oc->wait != 0) oc->wait--;
      else {
        oc->wait = SHOOT_EVERY;
        oc->n = 0;
        sprite_start(s, VARIANT_SHOOT);
        oc->state = STATE_SHOOT;
      }
    }
    draw_both(s, x, y);
    return 1;
  } else {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (oc->state == STATE_TURN) {
      if (++oc->n >= TURN_FRAMES) { sprite_start(s, VARIANT_PATROL); oc->state = STATE_PATROL; }
    } else {
      if (++oc->n == 20) shot_new(x, y - 2);
      if (oc->n == 26) { sprite_start(s, VARIANT_PATROL); oc->state = STATE_PATROL; }
    }
  }

  sprite_step(s);
  draw_both(s, x, y);
  return 1;
}

ActTask *oct_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  Oct *oc = OBJECT_NEW(Oct);
  if (!oc) return NULL;
  oc->o.slot = slot;
  oc->o.x = en->x;
  oc->v = -SPEED;
  oc->state = STATE_WAITING;
  enemy_sprite(&oc->o.sprite, ANIM_OCT, VARIANT_PATROL, VARIANT_SHOOT, ENEMY_ORDER);
  return object_task(&oc->o, oct_run, PRIORITY_OBJECTS);
}
