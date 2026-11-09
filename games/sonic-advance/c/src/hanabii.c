// Hanabii, Casino Paradise's firework launcher (enemy kind 8). Translated from the JavaScript version's engine/hanabii.js (the
// original's hanabii.c). It walks 0.625 px a frame between (d0 + 1) x 8 and (d0 + d2) x 8 px right of its spawn point, following
// the floor, and turns at either end. Away from the ends, with Sonic within 100 px, it stops to launch a shot, then walks on and
// doesn't launch again for 100 frames spent walking between the ends.
//
// The distance test squares each axis into 16 bits, as the original does: from 182 px away along either one the square wraps,
// and Sonic far off can set it launching as if he were near.
//
// The shot goes up from its mouth, slowing by 44/256 px a frame per frame, and bursts into a firework when it has nearly stopped.
// The firework hangs there for 20 frames, drawn four times mirrored around the shot's point; only the unmirrored quarter's box
// hurts Sonic.

#include "enemies.h"

enum {
  ANIM_HANABII = 415, ANIM_FIREWORK = 416, ANIM_SHOT = 419,
  VARIANT_WALK = 0, VARIANT_LAUNCH = 1,
  ORDER_SHOT = 9,
  STEP = 160,                  // 0.625 px, in 1/256 px
  NEAR = 100 * 100,            // Sonic is near within 100 px, squared
  REST = 100,                  // frames spent walking between two launches
  LAUNCH = 7, LAUNCHED = 19,   // the frame of the launch the shot leaves on, and the one it ends on
  MOUTH_RIGHT = 4, MOUTH_LEFT = -6, MOUTH_UP = -20,   // where the shot leaves, from the Hanabii
  SHOT_SPEED = -944, SHOT_SLOW = 44, BURST_AT = -16, BURST = 20,   // in 1/256 px, and frames
  // the shot goes when this far off the screen: x + 60 as a 16-bit number above 360, y + 60 below 0 or y above 300
  OUT_MARGIN = 60, OUT_WIDTH = 360, OUT_BELOW = 300,
};

typedef struct {
  Object o;
  int d0, d2, q, v, yoff, t, rest, launching;
} Hanabii;

// --- the shot and the firework it bursts into ------------------------------------------------------------------------------------
typedef struct { Object o; int x, y, vy, burst, t; } Shot;

static int shot_out(const Shot *sh) {
  int sx = sh->x - cam_x(), sy = sh->y - cam_y();
  return ((sx + OUT_MARGIN) & 0xFFFF) > OUT_WIDTH || sy + OUT_MARGIN < 0 || sy > OUT_BELOW;
}

static int shot_run(ActTask *t) {
  Shot *sh = (Shot *)t->data;
  Sprite *s = &sh->o.sprite;
  if (!sh->burst) {
    sh->vy = s16(sh->vy + SHOT_SLOW);
    sh->y += enemy_i(sh->vy);
    enemy_projectile(s, sh->x, sh->y);
    if (shot_out(sh)) return 0;
    sprite_step(s);
    object_draw(s, sh->x, sh->y);
    if (sh->vy > BURST_AT) {
      s->graphics.anim = ANIM_FIREWORK;
      sprite_start(s, 0);
      sh->burst = 1;
    }
    return 1;
  }
  sh->y += enemy_i(sh->vy);
  enemy_projectile(s, sh->x, sh->y);
  if (shot_out(sh) || ++sh->t > BURST) return 0;
  sprite_step(s);
  // the picture four times: as it is, turned over, turned both ways, and turned sideways
  uint32_t flags = s->frameFlags;
  object_draw(s, sh->x, sh->y);
  s->frameFlags = flags | SPRITE_Y_FLIP;
  object_draw(s, sh->x, sh->y);
  s->frameFlags = flags | SPRITE_X_FLIP | SPRITE_Y_FLIP;
  object_draw(s, sh->x, sh->y);
  s->frameFlags = flags | SPRITE_X_FLIP;
  object_draw(s, sh->x, sh->y);
  s->frameFlags = flags;
  return 1;
}

// CreateHanabiiProjectile: its tiles are the firework's, which are the larger
static void shot_new(int x, int y) {
  Shot *sh = OBJECT_NEW(Shot);
  if (!sh) return;
  sh->x = x; sh->y = y; sh->vy = SHOT_SPEED;
  object_sprite(&sh->o.sprite, ANIM_FIREWORK, 0, 0, ORDER_SHOT, ENEMY_PRIORITY, 0, 0);
  sh->o.sprite.graphics.anim = ANIM_SHOT;
  sprite_step(&sh->o.sprite);
  object_task(&sh->o, shot_run, ENEMY_SHOT_PRIORITY);
}

// --- the Hanabii ---------------------------------------------------------------------------------------------------------------------
static int hanabii_run(ActTask *t) {
  Hanabii *h = (Hanabii *)t->data;
  Sprite *s = &h->o.sprite;
  Slot *slot = h->o.slot;
  const Entity *e = &slot->e;
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  if (!h->launching) h->q += h->v;
  int x = e->x + enemy_i(h->q), y = e->y + h->yoff;
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  h->yoff += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
  if (!h->launching) {
    int dx = s16(enemy_sonic_x() - x), dy = s16(enemy_sonic_y() - y);
    if (enemy_i(h->q) <= (h->d0 + 1) * ENEMY_TILE) {
      if (!right) { enemy_flip_x(s, 1); h->v = STEP; }
    } else if (enemy_i(h->q) >= (h->d0 + h->d2) * ENEMY_TILE) {
      if (right) { enemy_flip_x(s, 0); h->v = -STEP; }
    } else if (h->rest != 0) h->rest--;
    else if (s16(dx * dx) + s16(dy * dy) < NEAR) {
      h->t = 0; h->rest = REST;
      sprite_start(s, VARIANT_LAUNCH);
      h->launching = 1;
    }
  } else {
    if (++h->t == LAUNCH) shot_new(right ? x + MOUTH_RIGHT : x + MOUTH_LEFT, y + MOUTH_UP);
    if (h->t == LAUNCHED) { h->t = 0; sprite_start(s, VARIANT_WALK); h->launching = 0; }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *hanabii_spawn(Slot *slot) {
  Hanabii *h = OBJECT_NEW(Hanabii);
  if (!h) return NULL;
  EnemyData d = enemy_data(&slot->e);
  h->o.slot = slot;
  h->o.x = slot->e.x;
  h->d0 = d.d0; h->d2 = d.d2;
  h->v = -STEP;
  enemy_sprite(&h->o.sprite, ANIM_HANABII, VARIANT_WALK, VARIANT_LAUNCH, ENEMY_ORDER);
  return object_task(&h->o, hanabii_run, PRIORITY_OBJECTS);
}
