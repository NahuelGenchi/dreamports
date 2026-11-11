// The spikes and the hiding spikes. Translated from the JavaScript version's engine/spikes.js and engine/hidingspikes.js (the
// original's spikes.c). The plain spikes are solid like any platform and hurt only from the side they point to: the up spikes
// when Sonic lands on top, the down spikes when he hits them from below, the sideways ones through the face they point to.

#include "objects.h"

enum { SPIKES_UP = 1, SPIKES_DOWN, SPIKES_LEFT, SPIKES_RIGHT, HIDING_SPIKES_UP = 5, HIDING_SPIKES_DOWN };
enum {
  ANIM_SPIKES = 454, ORDER_SPIKES = 17, PRIORITY_FRONT = 2,
  VARIANT_LOW = 0, VARIANT_MID = 1, VARIANT_UP = 2, VARIANT_SIDE = 3,   // rising or sinking, rising or sinking, up, sideways
  HALF_WIDTH = 6, SIDE_EXTRA = 5,
  SE_SPIKES = 171,
  // the hiding spikes' cycle of the stage clock: hidden, rising over 4 frames, up for 60, sinking over 4
  CYCLE = 128, HIDDEN_UNTIL = 60, RISING_MID = 62, UP_FROM = 64, UP_UNTIL = 124, SINKING_LOW = 126,
};

typedef struct { Object o; int kind, shown, up, last; } Spikes;

static const Hitbox *box_of(const Spikes *sp) { return object_box(&sp->o.sprite, 0); }

// Coll_DamagePlayer, with the spikes' sound when it hurts
static void hurt(Player *p) { if (world_damage(p)) play_song(SE_SPIKES); }

// sub_8020D44: landing on them hurts
static void landing(Spikes *sp, Player *p) {
  const Entity *en = &sp->o.slot->e;
  if (collide_platform(&sp->o, en->x, en->y, box_of(sp), p) & COLLIDE_LANDED) hurt(p);
}

// sub_8020E98: hitting them from below hurts; not while an object carries Sonic
static void bumping(Spikes *sp, Player *p) {
  const Entity *en = &sp->o.slot->e;
  if (p->carried) return;
  if (collide_platform(&sp->o, en->x, en->y, box_of(sp), p) & COLLIDE_FROM_BELOW) hurt(p);
}

// sideways (Task_Spikes_Horizontal): the top and bottom are only solid and the face they point to hurts; touching the back face
// puts Sonic out beyond the other one, as the code reads (in act 1 their backs are against walls)
static void side(Spikes *sp, Player *p) {
  const Entity *en = &sp->o.slot->e;
  const Hitbox *hb = box_of(sp);
  int r = collide_platform(&sp->o, en->x, en->y, hb, p);
  if (r & (COLLIDE_LANDED | COLLIDE_FROM_BELOW)) return;
  if (r & COLLIDE_LEFT_FACE) {
    if (sp->kind == SPIKES_LEFT) hurt(p);
    else p->x = en->x + hb->right + (HALF_WIDTH + SIDE_EXTRA) + 1;
  } else if (r & COLLIDE_RIGHT_FACE) {
    if (sp->kind == SPIKES_RIGHT) hurt(p);
    else p->x = en->x + hb->left - (HALF_WIDTH + SIDE_EXTRA) - 1;
  }
}

static int spikes_run(ActTask *t) {
  Spikes *sp = (Spikes *)t->data;
  const Entity *en = &sp->o.slot->e;
  Player *p = &act.player;
  switch (sp->kind) {
    case SPIKES_UP: if (p->inverted) bumping(sp, p); else landing(sp, p); break;
    case SPIKES_DOWN: if (p->inverted) landing(sp, p); else bumping(sp, p); break;
    default: side(sp, p); break;
  }
  if (off_cam(en->x, en->y)) return 0;
  object_draw(&sp->o.sprite, en->x, en->y);
  return 1;
}

ActTask *spikes_spawn(Slot *slot) {
  Spikes *sp = OBJECT_NEW(Spikes);
  if (!sp) return NULL;
  const Entity *en = &slot->e;
  int sideways = en->kind == SPIKES_LEFT || en->kind == SPIKES_RIGHT, variant = sideways ? VARIANT_SIDE : VARIANT_UP;
  sp->o.slot = slot;
  sp->o.x = en->x;
  sp->kind = en->kind;
  // the spikes up and down share the tiles at VRAM_RESERVED_SPIKES, the sideways ones take their own from the heap
  if (sideways) object_sprite(&sp->o.sprite, ANIM_SPIKES, variant, variant, ORDER_SPIKES, PRIORITY_FRONT, en->kind == SPIKES_LEFT, 0);
  else object_sprite_at(&sp->o.sprite, OBJ_VRAM + VRAM_SPIKES, ANIM_SPIKES, variant, ORDER_SPIKES, PRIORITY_FRONT, 0, en->kind == SPIKES_DOWN);
  sprite_step(&sp->o.sprite);
  return object_task(&sp->o, spikes_run, PRIORITY_OBJECTS);
}

// --- the hiding spikes (Task_Spikes_HidingUp and Task_Spikes_HidingDown) ----------------------------------------------------
// They come and go with the stage clock, 128 frames a turn: hidden and not drawn for 60, rising over 4 (variants 0 and 1, 2 frames
// each), up for 60 (variant 2), sinking over 4 (1, then 0). Only while they are up are they solid. On the first frame up, Sonic's
// body inside their box is put on top of them (on whole pixels; below them for the down ones) and hurt; otherwise the up ones
// hurt him as he lands on them, as the plain spikes do, and the down ones when he bumps them from below. On the frames they
// aren't up they drop him if he stands on them and stop him pushing them. The data bytes aren't read.

// shows variant `v`, which carries on where it was when it is the one already showing
static void show(Spikes *sp, int v) {
  Sprite *s = &sp->o.sprite;
  sp->up = v;
  if (v != sp->shown) { sp->shown = v; sprite_start(s, v); }
  sprite_step(s);
}

static int hiding_run(ActTask *t) {
  Spikes *sp = (Spikes *)t->data;
  const Entity *en = &sp->o.slot->e;
  Player *p = &act.player;
  int downward = sp->kind == HIDING_SPIKES_DOWN;
  if (off_cam(en->x, en->y)) return 0;
  int clock = act_stage_time() % CYCLE;
  if (clock >= UP_FROM && clock < UP_UNTIL) {
    if (sp->up != VARIANT_UP) {
      show(sp, VARIANT_UP);
      const Hitbox *hb = box_of(sp);
      Hitbox body = { 0, -HALF_WIDTH, (int8_t)-p->offsetY, HALF_WIDTH, (int8_t)p->offsetY };
      int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
      if (hb && !p->dead && collide_overlap(en->x, en->y, hb, px, py, &body)) {
        p->y = downward ? en->y + hb->bottom + p->offsetY - 1 : en->y + hb->top - (p->offsetY - 1);
        hurt(p);
      } else if (!downward && (collide_platform(&sp->o, en->x, en->y, hb, p) & COLLIDE_LANDED)) hurt(p);
    } else {
      sp->last = collide_platform(&sp->o, en->x, en->y, box_of(sp), p);
      if (sp->last & (downward ? COLLIDE_FROM_BELOW : COLLIDE_LANDED)) hurt(p);
    }
  } else {
    if (p->onObject == &sp->o) { p->onObject = NULL; p->air = 1; }
    if (sp->last & COLLIDE_PUSHING) { p->pushing = 0; sp->last = 0; }
    if (clock >= HIDDEN_UNTIL) show(sp, clock < RISING_MID || clock >= SINKING_LOW ? VARIANT_LOW : VARIANT_MID);
  }
  if (clock < HIDDEN_UNTIL) return 1;
  object_draw(&sp->o.sprite, en->x, en->y);
  return 1;
}

ActTask *hiding_spikes_spawn(Slot *slot) {
  Spikes *sp = OBJECT_NEW(Spikes);
  if (!sp) return NULL;
  const Entity *en = &slot->e;
  sp->o.slot = slot;
  sp->o.x = en->x;
  sp->kind = en->kind;
  sp->up = -1;   // none yet: the sprite starts with no animation shown
  sp->shown = VARIANT_UP;
  object_sprite(&sp->o.sprite, ANIM_SPIKES, VARIANT_LOW, VARIANT_UP, ORDER_SPIKES, PRIORITY_FRONT, 0, en->kind == HIDING_SPIKES_DOWN);
  sp->o.sprite.variant = VARIANT_UP;
  return object_task(&sp->o, hiding_run, PRIORITY_OBJECTS);
}
