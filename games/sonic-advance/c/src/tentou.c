// Tentou, Secret Base's ladybird (enemy kind 6). Translated from the JavaScript version's engine/tentou.js (the original's
// tentou.c; Task_TentouMain and sub_8074928 from their asm). It flies a loop round its spawn point for 64 frames, d2 tiles
// across and d3 up, then hovers for up to 60 frames; if Sonic comes within 80 px of it while it hovers, it fires two shots, one
// each way, on its 15th frame of firing, and flies on after 33. Its sprite is a left half, drawn again mirrored for the right.
//
// The original keeps the loop's offsets in 1/256 px, but places the sprite by how far they moved in the frame (a 32nd of it
// across and a 16th up) rather than by where they are, and while hovering by minus the last offset across. Up, it takes the
// frame's move modulo 64 to draw it and leaves it unmoved on a remainder of 63 (where it tests its box at the spawn point's
// height), but tests its box with the whole move.

#include "enemies.h"

enum {
  ANIM_TENTOU = 412, VARIANT_HOVER = 0, VARIANT_FLY = 1, VARIANT_FIRE = 2,
  ANIM_SHOT = 410, ORDER_SHOT = 9,   // GamiGami's shot
  NEAR = 80 * 80,                    // TENTOU_ATTACK_INIT_DISTANCE squared
  STEP_X = 8, STEP_Y = 8,            // unk58 and unk5A
  HOVER = 60, FIRE_AT = 15, FIRED = 32,
  SHOT_SPEED = 6, SHOT_SIDE = 6, SHOT_UP = 5, SHOT_GRAVITY = 40,
};
enum { FLY, HOVERING, FIRING };

typedef struct { Object o; int d2, d3, phase, n, t, ox, oy; } Tentou;
typedef struct { Object o; int x4, dx, y, vy; } Shot;

static int off_x(const Tentou *te, int k) { return (int)((int32_t)(te->d2 << 11) * SINE[(STEP_X * (k & 0x7F)) & 0x3FF]) >> 14; }
static int off_y(const Tentou *te, int k) { return (int)((int32_t)(te->d3 << 11) * SINE[((STEP_Y * (k & 0x3F)) & 0x3FF) + 256]) >> 14; }

// the left half, then the same mirrored for the right
static void show(Sprite *s, int x, int y) {
  sprite_step(s);
  object_draw(s, x, y);
  uint32_t flags = s->frameFlags;
  s->frameFlags |= SPRITE_X_FLIP;
  object_draw(s, x, y);
  s->frameFlags = flags;
}

// a shot (CreateTentouProjectiles, sub_8074C50): starting 6 px to its side at 1.5 px a frame and falling from rest through
// everything; it goes on through Sonic
static int shot_run(ActTask *t) {
  Shot *sh = (Shot *)t->data;
  Sprite *s = &sh->o.sprite;
  sh->x4 += sh->dx;
  int x = sh->x4 >> 2;
  sh->vy += SHOT_GRAVITY;
  sh->y += enemy_i(sh->vy);
  enemy_projectile(s, x, sh->y);
  int sx = x - cam_x(), sy = sh->y - cam_y();
  if (((sx + 20) & 0xFFFF) > 276 || sy + 20 < 0 || sy > 240) return 0;
  sprite_step(s);
  object_draw(s, x, sh->y);
  return 1;
}

static void shot_new(int x, int y, int dx) {
  Shot *sh = OBJECT_NEW(Shot);
  if (!sh) return;
  sh->x4 = (x + (dx > 0 ? SHOT_SIDE : -SHOT_SIDE)) * 4;
  sh->dx = dx; sh->y = y;
  object_sprite(&sh->o.sprite, ANIM_SHOT, 0, 0, ORDER_SHOT, ENEMY_PRIORITY, 0, 0);
  sprite_step(&sh->o.sprite);   // its animation steps once as it is made
  object_task(&sh->o, shot_run, ENEMY_SHOT_PRIORITY);
}

// the original sets the variant alone, so the animation starts over only when it changes
static void start(Tentou *te, int variant, int phase) {
  te->o.sprite.variant = (uint8_t)variant;
  te->phase = phase;
}

static int tentou_run(ActTask *t) {
  Tentou *te = (Tentou *)t->data;
  Slot *slot = te->o.slot;
  Sprite *s = &te->o.sprite;
  int wx = slot->e.x, wy = slot->e.y, x, y;
  if (te->phase == FLY) {
    // Task_TentouMain
    int dx = (off_x(te, te->n) - te->ox) >> 5, dy = (off_y(te, te->n) - te->oy) >> 4;
    te->ox = off_x(te, te->n); te->oy = off_y(te, te->n);
    te->n = (te->n + 1) & 0xFFFF;
    if (te->n == 0x40 || te->n == 0x80) { te->t = 0; start(te, VARIANT_HOVER, HOVERING); }
    te->n &= 0x7F;
    x = wx + dx;
    if (dy % 64 != 63) {
      y = wy - dy % 64;
      if (enemy_attack(s, x, wy - dy)) { slot->gone = 1; return 0; }
    } else {
      if (enemy_attack(s, x, wy)) { slot->gone = 1; return 0; }
      y = wy;
    }
    if (enemy_gone(wx, wy, x, y)) return 0;
    show(s, x, y);
    return 1;
  }
  // sub_8074928 while it hovers, Task_807473C while it fires
  int dx = -te->ox >> 5;
  te->ox = off_x(te, te->n - 1);
  int was = te->oy;
  te->oy = off_y(te, te->n - 1);
  int dy = (te->oy - was) >> 4;
  x = wx + dx; y = wy - dy;
  te->t++;
  if (te->phase == FIRING && te->t == FIRE_AT) {
    shot_new(x, y - SHOT_UP, SHOT_SPEED);
    shot_new(x, y - SHOT_UP, -SHOT_SPEED);
  }
  if (enemy_gone(wx, wy, x, y)) return 0;
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  if (te->phase == HOVERING) {
    int px = enemy_sonic_x() - x, py = enemy_sonic_y() - y;
    if (px * px + py * py < NEAR) { te->t = 0; start(te, VARIANT_FIRE, FIRING); }
    else if (te->t >= HOVER) { te->t = 0; start(te, VARIANT_FLY, FLY); }
  } else if (te->t > FIRED) start(te, VARIANT_FLY, FLY);
  show(s, x, y);
  return 1;
}

ActTask *tentou_spawn(Slot *slot) {
  Tentou *te = OBJECT_NEW(Tentou);
  if (!te) return NULL;
  EnemyData d = enemy_data(&slot->e);
  te->o.slot = slot;
  te->o.x = slot->e.x;
  te->d2 = d.d2; te->d3 = d.d3;
  enemy_sprite(&te->o.sprite, ANIM_TENTOU, VARIANT_HOVER, VARIANT_FIRE, ENEMY_ORDER);
  return object_task(&te->o, tentou_run, PRIORITY_OBJECTS);
}
