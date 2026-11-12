// The effects that objects leave behind. Translated from the JavaScript version's engine/defeat.js (dustCloud).

#include "objects.h"

enum { ANIM_DUST_CLOUD = 407, ORDER_EFFECT = 15, PRIORITY_FRONT = 2 };

typedef struct { Object o; int x, y; } Dust;

static int dust_run(ActTask *t) {
  Dust *d = (Dust *)t->data;
  int ended = sprite_step(&d->o.sprite);
  object_draw(&d->o.sprite, d->x, d->y);
  return !ended;
}

void dust_cloud(int x, int y) {
  Dust *d = OBJECT_NEW(Dust);
  if (!d) return;
  d->x = x; d->y = y;
  object_sprite(&d->o.sprite, ANIM_DUST_CLOUD, 0, 0, ORDER_EFFECT, PRIORITY_FRONT, 0, 0);
  object_task(&d->o, dust_run, PRIORITY_OBJECTS);
}

// --- Sonic's effects (game.js spawn and updateEffect) ------------------------------------------------------------------
// Each is a task of its own at 0x4001, made as it appears, so it runs after Sonic and after the item tasks made before it,
// and first runs in the frame that makes it. They sit on OAM order 8, in front of the front layer.
enum {
  PRIORITY_EFFECTS = 0x4001,
  ORDER_SONIC_EFFECT = 8,
  ANIM_BRAKE_DUST = 748, ANIM_DASH_DUST = 746, ANIM_DASH_DUST_BIG = 747, ANIM_INSTA_SHIELD = 50, VARIANT_INSTA_SHIELD = 1,
  MAX_BRAKE_DUST = 20,          // the original keeps a pool of 20 brake dust clouds (CreateBrakingDustEffect)
  DASH_DUST_BIG_ABOVE = 0x200,  // the spin dash dust is the big one while the charge is above 2.0
};
enum { EFFECT_BRAKE, EFFECT_DASH, EFFECT_SHIELD };

typedef struct { Object o; int kind, x, y; } Effect;
static int brakeDust;   // the brake dust clouds on screen

// his feet, above his centre under flipped gravity
// whole pixels as the original takes them (I(), an arithmetic shift), so rounding down above the level's top too
static int whole(double v) { return (int)__builtin_floor(v); }
static int feet_y(const Player *p) { return whole(p->y + (p->inverted ? -p->offsetY : p->offsetY)); }

static int effect_run(ActTask *t) {
  Effect *e = (Effect *)t->data;
  const Player *p = &act.player;
  Sprite *s = &e->o.sprite;
  if (e->kind == EFFECT_DASH) {
    // the spin dash dust follows his feet while he charges, turned over with him under flipped gravity
    if (!p->spinDashing) return 0;
    int anim = p->dashAccel > DASH_DUST_BIG_ABOVE ? ANIM_DASH_DUST_BIG : ANIM_DASH_DUST;
    if (s->graphics.anim != anim) { s->graphics.anim = (uint16_t)anim; sprite_start(s, 0); }
    e->x = whole(p->x); e->y = feet_y(p);
    s->frameFlags = (s->frameFlags & ~(uint32_t)(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
    sprite_step(s);
    object_draw(s, e->x, e->y);
    return 1;
  }
  // the insta-shield's flash follows his centre; the brake dust stays where it appeared
  if (e->kind == EFFECT_SHIELD) { e->x = whole(p->x); e->y = whole(p->y); }
  int ended = sprite_step(s);
  object_draw(s, e->x, e->y);
  if (ended && e->kind == EFFECT_BRAKE) brakeDust--;
  return !ended;
}

static void effect_make(int kind, int anim, int variant, int x, int y, int flipX, int flipY) {
  Effect *e = OBJECT_NEW(Effect);
  if (!e) return;
  e->kind = kind; e->x = x; e->y = y;
  // the dash dust swaps between its two sizes, so it has the tiles of the bigger
  if (kind == EFFECT_DASH) {
    object_sprite(&e->o.sprite, sprite_tiles(ANIM_DASH_DUST_BIG, 0, 0) > sprite_tiles(ANIM_DASH_DUST, 0, 0) ? ANIM_DASH_DUST_BIG : ANIM_DASH_DUST, 0, 0, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
    e->o.sprite.graphics.anim = (uint16_t)anim;
  } else if (kind == EFFECT_BRAKE) object_sprite_at(&e->o.sprite, OBJ_VRAM + VRAM_DUST_EFFECT_BRAKING, anim, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  else object_sprite(&e->o.sprite, anim, variant, variant, ORDER_SONIC_EFFECT, PRIORITY_FRONT, flipX, flipY);
  if (!object_task(&e->o, effect_run, PRIORITY_EFFECTS)) return;
  if (kind == EFFECT_BRAKE) brakeDust++;
}

void effects_start(void) { brakeDust = 0; }

// brake dust stays where it appeared, flipped by the game's random numbers (CreateBrakingDustEffect), with no more than
// the pool holds
void act_brake_dust(void) {
  if (brakeDust >= MAX_BRAKE_DUST) return;
  uint32_t r = act_random();
  const Player *p = &act.player;
  effect_make(EFFECT_BRAKE, ANIM_BRAKE_DUST, 0, whole(p->x), feet_y(p), (r & 0x400) != 0, (r & 0x800) != 0);
}
void act_dash_dust(void) {
  const Player *p = &act.player;
  effect_make(EFFECT_DASH, ANIM_DASH_DUST, 0, whole(p->x), feet_y(p), p->facing > 0, p->inverted);
}
// the insta-shield's flash, facing the way he faced when it started
void act_insta_shield(void) {
  const Player *p = &act.player;
  effect_make(EFFECT_SHIELD, ANIM_INSTA_SHIELD, VARIANT_INSTA_SHIELD, whole(p->x), whole(p->y), p->facing > 0, 0);
}
