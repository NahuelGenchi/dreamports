// Item boxes. Translated from the JavaScript version's engine/itembox.js (the original's itembox.c). A box shows its prize's
// icon through its screen. Sonic breaks it with his attack box on it, or by falling onto it while he has one; without it the
// box is solid and he can stand on it. Hit from below, it hops up 1 px a frame, slowing down, until it lands again. A broken box
// leaves a dust cloud, its icon rises 1 px a frame and after 60 frames gives the prize, then stays 30 frames more. A broken box
// never comes back until the act starts over.

#include "objects.h"
#include "terrain.h"

enum {
  ANIM_ITEM_BOX = 705, ANIM_ICON = 706, ORDER_BOX = 18, ORDER_ICON = 19, PRIORITY_FRONT = 2,
  SE_ITEM_BOX_BREAK = 167,
  RISE_FRAMES = 60, HOLD_FRAMES = 30,
  HOP_SPEED = -256, HOP_GRAVITY = 40,   // in 1/256 px
};
// each prize's icon (gUnknown_080BB4D8): Sonic's 1-up, then the others in order, then the mystery boxes' prizes
static const uint8_t ICONS[16] = { 0, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 9, 10, 8, 7, 6 };
enum { PHASE_WHOLE, PHASE_RISING, PHASE_HELD };

typedef struct {
  Object o;      // the box
  Sprite icon;
  int dy, vy, hopping, phase, n;
} ItemBox;

static const Hitbox *box_of(const ItemBox *b) { return object_box(&b->o.sprite, 0); }

static int item_box_run(ActTask *t) {
  ItemBox *b = (ItemBox *)t->data;
  Slot *slot = b->o.slot;
  const Entity *en = &slot->e;
  Player *p = &act.player;
  if (b->phase == PHASE_RISING) {
    b->dy--;
    if (++b->n >= RISE_FRAMES) { world_prize(en->kind); b->phase = PHASE_HELD; b->n = 0; }
    object_draw(&b->icon, en->x, en->y + b->dy);
    return 1;
  }
  if (b->phase == PHASE_HELD) {
    if (++b->n > HOLD_FRAMES) return 0;
    object_draw(&b->icon, en->x, en->y + b->dy);
    return 1;
  }
  if (b->hopping) {
    b->dy += b->vy >> 8; b->vy += HOP_GRAVITY;
    int d = terrain_tile_floor(en->x, en->y + b->dy, 1, 8);
    if (d < 0) { b->dy += d; b->hopping = 0; }
  }
  // the CPU partner only ever stands on it or bumps it, and does so first (his bump doesn't count)
  if (act.hasPartner) collide_platform(&b->o, en->x, en->y + b->dy, box_of(b), &act.partner);
  // standing on it, or without his attack box, it is only solid: he can stand on it or bump it from below, but not break it
  // (the original checks slot 1 here, where the decompiled C reads slot 0)
  int solid = p->onObject == &b->o || !object_box(&p->sprite, 1);
  int res = solid ? collide_platform(&b->o, en->x, en->y + b->dy, box_of(b), p) : collide_item_box(en->x, en->y + b->dy, box_of(b), p);
  if (res & COLLIDE_FROM_BELOW) { b->vy = HOP_SPEED; b->hopping = 1; }
  else if (!solid && (res & (COLLIDE_LANDED | COLLIDE_PUSHING))) {
    FOR_EACH_PLAYER(q) if (q->onObject == &b->o) { q->onObject = NULL; q->pushing = 0; q->air = 1; }
    play_song(SE_ITEM_BOX_BREAK);
    dust_cloud(en->x, en->y + b->dy);
    b->phase = PHASE_RISING; b->n = 0;
    slot->gone = 1;
    return 1;
  }
  // the original adds the offset to the screen position twice here
  if (off_display(en->x, en->y) && off_cam(en->x, en->y + 2 * b->dy)) return 0;
  object_draw(&b->o.sprite, en->x, en->y + b->dy);
  object_draw(&b->icon, en->x, en->y + b->dy);
  return 1;
}

static void item_box_end(ActTask *t) {
  ItemBox *b = (ItemBox *)t->data;
  object_sprite_free(&b->icon);
  object_end(t);
}

ActTask *item_box_spawn(Slot *slot) {
  ItemBox *b = OBJECT_NEW(ItemBox);
  if (!b) return NULL;
  const Entity *en = &slot->e;
  int icon = ICONS[en->kind & 15];   // the 1-up's is Sonic's face, the first of the characters'
  b->o.slot = slot;
  b->o.x = en->x;
  object_sprite(&b->o.sprite, ANIM_ITEM_BOX, 0, 0, ORDER_BOX, PRIORITY_FRONT, 0, 0);
  object_sprite(&b->icon, ANIM_ICON, icon, icon, ORDER_ICON, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  sprite_step(&b->icon);
  ActTask *t = act_task_add(item_box_run, item_box_end, b, PRIORITY_OBJECTS);
  if (!t) item_box_end(&(ActTask){ .data = b });
  return t;
}
