// Cosmic Angel's Mirror (enemy kind 12) and Egg Rocket's Oct (enemy kind 14). Translated from the JavaScript version's
// engine/mirror.js and engine/oct.js (the original's mirror.c and oct.c).

#include "enemies.h"

enum {
  ANIM_MIRROR = 432, MIRROR_WALK = 0, MIRROR_SHOOT = 1,
  ANIM_MIRROR_SHOT = 435, VRAM_MIRROR_SHOT = OBJ_VRAM + 0x2580,
  MIRROR_SPEED = 160,            // Q(0.625)
  MIRROR_REST = 90, MIRROR_SHOOT_AT = 20, MIRROR_SHOOT_FRAMES = 60,
  MIRROR_SHOT_SPEED = 512,       // Q(2)
  ORDER_SHOT = 9, PRIORITY_SHOT = 0,

  ANIM_OCT = 433, OCT_PATROL = 0, OCT_SHOOT = 1,
  ANIM_OCT_SHOT = 436, VRAM_OCT_SHOT = OBJ_VRAM + 0x2600,
  OCT_SPEED = 192,               // Q(0.75)
  OCT_TURN_FRAMES = 30, OCT_TURN_STEP = 0x400 / 30,
  OCT_SHOOT_EVERY = 60, OCT_SHOOT_AT = 20, OCT_SHOOT_DONE = 26,
  OCT_SHOT_SPEED = 512,          // Q(2)
  ZONE_EGG_ROCKET = 5,
};

typedef struct {
  Object o;
  int qx, y, vx;
} MirrorShot;

static int shot_off(int x, int y) {
  int sx = s16(x - cam_x()), sy = s16(y - cam_y());
  return ((sx + 20) & 0xFFFF) > 276 || sy + 20 < 0 || sy > 240;
}

static int mirror_shot_run(ActTask *t) {
  MirrorShot *sh = (MirrorShot *)t->data;
  Sprite *s = &sh->o.sprite;
  sh->qx += sh->vx;
  int x = enemy_i(sh->qx), y = sh->y;
  enemy_projectile(s, x, y);
  if (shot_off(x, y)) return 0;
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

static void mirror_shot_new(int x0, int y, int dir) {
  MirrorShot *sh = OBJECT_NEW(MirrorShot);
  if (!sh) return;
  sh->qx = x0 * 256;
  sh->y = y;
  sh->vx = dir * MIRROR_SHOT_SPEED;
  object_sprite_at(&sh->o.sprite, VRAM_MIRROR_SHOT, ANIM_MIRROR_SHOT, 0, ORDER_SHOT, PRIORITY_SHOT, 0, 0);
  sprite_step(&sh->o.sprite);
  object_task(&sh->o, mirror_shot_run, ENEMY_SHOT_PRIORITY);
}

typedef struct {
  Object o;
  int off, vx, frames, rest, shooting;
} Mirror;

static int mirror_run(ActTask *t) {
  Mirror *m = (Mirror *)t->data;
  Sprite *s = &m->o.sprite;
  Slot *slot = m->o.slot;
  const Entity *en = &slot->e;
  EnemyData d = enemy_data(en);
  if (!m->shooting) m->off += m->vx;
  int x = s16(en->x + enemy_i(m->off)), y = en->y;
  if (enemy_gone(en->x, en->y, x, y)) return 0;
  if (!m->shooting) {
    Player *p = &act.player;
    const Hitbox *b0 = object_box(s, 0), *body = object_box(&p->sprite, 0);
    if (b0 && body && collide_overlap(x, y, b0, enemy_sonic_x(), enemy_sonic_y(), body)) world_damage(p);
    if (enemy_i(m->off) <= d.d0 * ENEMY_TILE) m->vx = MIRROR_SPEED;
    else if (enemy_i(m->off) >= (d.d0 + d.d2) * ENEMY_TILE) m->vx = -MIRROR_SPEED;
    else if (m->rest != 0) m->rest--;
    else {
      enemy_flip_x(s, enemy_sonic_x() > x);
      m->rest = MIRROR_REST;
      m->frames = 0;
      s->variant = MIRROR_SHOOT;
      m->shooting = 1;
    }
  } else {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (++m->frames == MIRROR_SHOOT_AT) {
      int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
      mirror_shot_new(right ? x + 8 : x - 8, y - 16, right ? 1 : -1);
    }
    if (m->frames == MIRROR_SHOOT_FRAMES) {
      s->variant = MIRROR_WALK;
      m->shooting = 0;
    }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *mirror_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_EGG_ROCKET)) return NULL;
  Mirror *m = OBJECT_NEW(Mirror);
  if (!m) return NULL;
  m->o.slot = slot;
  m->o.x = slot->e.x;
  m->vx = -MIRROR_SPEED;
  enemy_sprite(&m->o.sprite, ANIM_MIRROR, MIRROR_WALK, MIRROR_SHOOT, ENEMY_ORDER);
  return object_task(&m->o, mirror_run, PRIORITY_OBJECTS);
}

// --- Oct (enemy kind 14, Task_OctInit) -------------------------------------------------------------------------------------
enum { OCT_STATE_WAIT, OCT_STATE_PATROL, OCT_STATE_TURN, OCT_STATE_SHOOTING };

typedef struct {
  Object o;
  int x, qy;
} OctShot;

static int oct_shot_run(ActTask *t) {
  OctShot *sh = (OctShot *)t->data;
  Sprite *s = &sh->o.sprite;
  sh->qy += OCT_SHOT_SPEED;
  int x = sh->x, y = enemy_i(sh->qy);
  enemy_projectile(s, x, y);
  if (shot_off(x, y)) return 0;
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

static void oct_shot_new(int x, int y0) {
  OctShot *sh = OBJECT_NEW(OctShot);
  if (!sh) return;
  sh->x = x;
  sh->qy = y0 << 8;
  object_sprite_at(&sh->o.sprite, VRAM_OCT_SHOT, ANIM_OCT_SHOT, 0, ORDER_SHOT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&sh->o.sprite);
  object_task(&sh->o, oct_shot_run, ENEMY_SHOT_PRIORITY);
}

typedef struct {
  Object o;
  int off, vx, n, wait, latched, state;
} Oct;

static void oct_draw_both(Sprite *s, int x, int y) {
  object_draw(s, x, y);
  s->frameFlags |= SPRITE_X_FLIP;
  object_draw(s, x, y);
  s->frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
}

static void oct_start_patrol(Oct *o) {
  sprite_start(&o->o.sprite, OCT_PATROL);
  o->state = OCT_STATE_PATROL;
}

static int oct_run(ActTask *t) {
  Oct *o = (Oct *)t->data;
  Sprite *s = &o->o.sprite;
  Slot *slot = o->o.slot;
  const Entity *en = &slot->e;
  EnemyData d = enemy_data(en);
  if (o->state == OCT_STATE_PATROL) o->off += o->vx;
  else if (o->state == OCT_STATE_TURN) o->off += (o->vx < 0 ? 1 : -1) * bios_div(SINE[(OCT_TURN_STEP * o->n) & 0x3FF], 55);
  int x = s16(en->x + enemy_i(o->off)), y = en->y;
  if (enemy_gone(en->x, en->y, x, y)) return 0;
  if (o->state == OCT_STATE_WAIT) {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    int px = enemy_sonic_x();
    if (x - 120 < px && x + 120 > px) {
      s->variant = OCT_PATROL;
      o->state = OCT_STATE_PATROL;
    }
  } else if (o->state == OCT_STATE_PATROL) {
    sprite_step(s);
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (enemy_i(o->off) <= d.d0 * ENEMY_TILE || enemy_i(o->off) >= (d.d0 + d.d2) * ENEMY_TILE) {
      if (!o->latched) {
        o->latched = 1;
        o->vx = enemy_i(o->off) <= d.d0 * ENEMY_TILE ? OCT_SPEED : -OCT_SPEED;
        o->n = 0;
        o->state = OCT_STATE_TURN;
      }
    } else {
      o->latched = 0;
      if (o->wait != 0) o->wait--;
      else {
        o->wait = OCT_SHOOT_EVERY;
        o->n = 0;
        s->variant = OCT_SHOOT;
        o->state = OCT_STATE_SHOOTING;
      }
    }
    oct_draw_both(s, x, y);
    return 1;
  } else {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (o->state == OCT_STATE_TURN) {
      if (++o->n >= OCT_TURN_FRAMES) oct_start_patrol(o);
    } else {
      if (++o->n == OCT_SHOOT_AT) oct_shot_new(x, y - 2);
      if (o->n == OCT_SHOOT_DONE) oct_start_patrol(o);
    }
  }
  sprite_step(s);
  oct_draw_both(s, x, y);
  return 1;
}

ActTask *oct_spawn(Slot *slot) {
  Oct *o = OBJECT_NEW(Oct);
  if (!o) return NULL;
  o->o.slot = slot;
  o->o.x = slot->e.x;
  o->vx = -OCT_SPEED;
  enemy_sprite(&o->o.sprite, ANIM_OCT, OCT_PATROL, OCT_SHOOT, ENEMY_ORDER);
  return object_task(&o->o, oct_run, PRIORITY_OBJECTS);
}
