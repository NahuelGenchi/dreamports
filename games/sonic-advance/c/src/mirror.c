// Cosmic Angel's Mirror (enemy kind 12). Translated from engine/mirror.js (the original's mirror.c:
// CreateEntity_Mirror, Task_Mirror, Task_MirrorShoot, CreateMirrorProjectile, Task_MirrorProjectile). A mirror
// on legs that walks back and forth at 0.625 px a frame between d0 and d0 + d2 tiles from its point. Walking,
// touching it hurts Sonic, even while he attacks. Every 90 frames of walking it stops and turns to him for 60
// frames, and only then can it be defeated; on the 20th it fires a shot level at 2 px a frame. On Easy, zone 5's
// mirrors aren't made.

#include "enemies.h"

enum {
  ANIM_MIRROR = 432, VARIANT_WALK = 0, VARIANT_SHOOT = 1,
  ANIM_MIRROR_SHOT = 435,
  VRAM_MIRROR_SHOT = 0x2580,
  MIRROR_TILES = 20,         // ALLOC_TILES: 40 x 32 px
  SPEED = 160,               // 0.625 px in 1/256 px
  REST = 90, SHOOT_AT = 20, SHOOT_FRAMES = 60,
  SHOT_SPEED = 512,          // 2 px in 1/256 px
  ORDER_MIRROR_SHOT = 9,
};

typedef struct {
  Object o;
  int q, v, frames, rest, shooting;
} Mirror;

typedef struct {
  Object o;
  int qx, y, dir;
} MirrorShot;

static int shot_run(ActTask *t) {
  MirrorShot *sh = (MirrorShot *)t->data;
  Sprite *s = &sh->o.sprite;
  sh->qx += sh->dir * SHOT_SPEED;
  int x = enemy_i(sh->qx);
  enemy_projectile(s, x, sh->y);
  int sx = x - cam_x(), sy = sh->y - cam_y();
  if (((uint16_t)(sx + 20)) > 276 || sy + 20 < 0 || sy > 240) return 0;
  sprite_step(s);
  object_draw(s, x, sh->y);
  return 1;
}

static void shot_new(int x, int y, int dir) {
  MirrorShot *sh = OBJECT_NEW(MirrorShot);
  if (!sh) return;
  sh->qx = x << 8;
  sh->y = y;
  sh->dir = dir;
  object_sprite_at(&sh->o.sprite, OBJ_VRAM + VRAM_MIRROR_SHOT, ANIM_MIRROR_SHOT, 0, ORDER_MIRROR_SHOT, 0, 0, 0);
  sprite_step(&sh->o.sprite);
  object_task(&sh->o, shot_run, ENEMY_SHOT_PRIORITY);
}

static int mirror_run(ActTask *t) {
  Mirror *m = (Mirror *)t->data;
  Sprite *s = &m->o.sprite;
  Slot *slot = m->o.slot;
  const Entity *e = &slot->e;
  EnemyData d = enemy_data(e);

  if (!m->shooting) m->q += m->v;
  int x = e->x + enemy_i(m->q), y = e->y;
  if (enemy_gone(e->x, e->y, x, y)) return 0;

  if (!m->shooting) {
    // against his animation's own box (the original's gPlayerBodyPSI hitbox), not the made-up body box
    const Hitbox *hb = object_box(s, 0), *body = object_box(&act.player.sprite, 0);
    if (hb && body && !act.player.dead && collide_overlap(x, y, hb, enemy_sonic_x(), enemy_sonic_y(), body)) {
      world_damage(&act.player);
    }
    if (enemy_i(m->q) <= d.d0 * ENEMY_TILE) m->v = SPEED;
    else if (enemy_i(m->q) >= (d.d0 + d.d2) * ENEMY_TILE) m->v = -SPEED;
    else if (m->rest != 0) m->rest--;
    else {
      if (enemy_sonic_x() > x) s->frameFlags |= SPRITE_X_FLIP;
      else s->frameFlags &= ~SPRITE_X_FLIP;
      m->rest = REST;
      m->frames = 0;
      sprite_start(s, VARIANT_SHOOT);
      m->shooting = 1;
    }
  } else {
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (++m->frames == SHOOT_AT) {
      int dir = (s->frameFlags & SPRITE_X_FLIP) ? 1 : -1;
      shot_new(dir > 0 ? x + 8 : x - 8, y - 16, dir);
    }
    if (m->frames == SHOOT_FRAMES) {
      sprite_start(s, VARIANT_WALK);
      m->shooting = 0;
    }
  }

  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *mirror_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_EGG_ROCKET)) return NULL;
  const Entity *en = &slot->e;
  Mirror *m = OBJECT_NEW(Mirror);
  if (!m) return NULL;
  m->o.slot = slot;
  m->o.x = en->x;
  m->v = -SPEED;
  object_sprite_at(&m->o.sprite, vram_malloc(MIRROR_TILES), ANIM_MIRROR, VARIANT_WALK, ENEMY_ORDER, ENEMY_PRIORITY, 0, 0);
  sprite_step(&m->o.sprite);
  return object_task(&m->o, mirror_run, PRIORITY_OBJECTS);
}
