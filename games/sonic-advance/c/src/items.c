// What the item boxes' prizes put around Sonic: the shields, and invincibility's stars with their sparkles. Translated from the
// JavaScript version's engine/items.js (the original's item_tasks.c). They are tasks after the music manager and follow Sonic.
// They take turns on screen, 2 frames each by the stage clock: a shield on the frames with its bit 1 set, the stars on the
// others.

#include "objects.h"

enum {
  ANIM_SHIELD = 750, ANIM_MAGNETIC_SHIELD = 751, ANIM_STARS = 752, VARIANT_STARS = 0, VARIANT_SPARKLE = 1,
  ORDER_ITEM = 8,
  PRIORITY_FRONT = 2, PRIORITY_DYING = 1,   // Sonic's own sprite priority, which these take: in front of the front layer while he dies
  SPARKLE_MASK = 7,                         // a sparkle when the stage clock's low three bits are 0
  SPARKLE_REACH = 16, SPARKLE_ANGLES = 256,
};

typedef struct { Object o; int shield; } Shield;
typedef struct { Object o; } Stars;
typedef struct { Object o; int x, y; } Sparkle;

static int priority_of(const Player *p) { return p->death ? PRIORITY_DYING : PRIORITY_FRONT; }
static void set_priority(Sprite *s, int prio) { s->frameFlags = (s->frameFlags & ~SPRITE_PRIORITY) | (uint32_t)prio << 12; }

// a shield: it goes when Sonic loses it or takes the other one, and is hidden and still while he is invincible
static int shield_run(ActTask *t) {
  Shield *sh = (Shield *)t->data;
  Player *p = &act.player;
  if (p->shield != sh->shield) return 0;
  if (p->invincible > 0) return 1;
  set_priority(&sh->o.sprite, priority_of(p));
  sprite_step(&sh->o.sprite);
  if (act.tick & 2) object_draw(&sh->o.sprite, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y));
  return 1;
}

void items_shield(int shield) {
  Shield *sh = OBJECT_NEW(Shield);
  if (!sh) return;
  sh->shield = shield;
  object_sprite(&sh->o.sprite, shield == SHIELD_NORMAL ? ANIM_SHIELD : ANIM_MAGNETIC_SHIELD, 0, 0, ORDER_ITEM, PRIORITY_FRONT, 0, 0);
  object_task(&sh->o, shield_run, PRIORITY_ITEMS);
}

// a sparkle stays where it appeared and plays its animation once
static int sparkle_run(ActTask *t) {
  Sparkle *sp = (Sparkle *)t->data;
  int ended = sprite_step(&sp->o.sprite);
  object_draw(&sp->o.sprite, sp->x, sp->y);
  return !ended;
}

static void sparkle_make(int x, int y) {
  Sparkle *sp = OBJECT_NEW(Sparkle);
  if (!sp) return;
  sp->x = x; sp->y = y;
  object_sprite(&sp->o.sprite, ANIM_STARS, VARIANT_SPARKLE, VARIANT_SPARKLE, ORDER_ITEM, PRIORITY_FRONT, 0, 0);
  object_task(&sp->o, sparkle_run, PRIORITY_ITEMS);
}

// invincibility's stars, until it runs out. Every 8th frame of the stage clock they leave a sparkle up to 15 px from Sonic in a
// random direction, from two draws of the game's random numbers.
static int stars_run(ActTask *t) {
  Stars *st = (Stars *)t->data;
  Player *p = &act.player;
  if (p->invincible <= 0) return 0;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if ((act.tick & SPARKLE_MASK) == 0) {
    int r = (int)((act_random() >> 8) % SPARKLE_REACH), a = (int)((act_random() >> 8) % SPARKLE_ANGLES);
    sparkle_make(x + (((SINE[a * 4 + 256] >> 6) * r) >> 8), y + (((SINE[a * 4] >> 6) * r) >> 8));
  }
  set_priority(&st->o.sprite, priority_of(p));
  sprite_step(&st->o.sprite);
  if (!(act.tick & 2)) object_draw(&st->o.sprite, x, y);
  return 1;
}

void items_stars(void) {
  Stars *st = OBJECT_NEW(Stars);
  if (!st) return;
  object_sprite(&st->o.sprite, ANIM_STARS, VARIANT_STARS, VARIANT_STARS, ORDER_ITEM, PRIORITY_FRONT, 0, 0);
  object_task(&st->o, stars_run, PRIORITY_ITEMS);
}
