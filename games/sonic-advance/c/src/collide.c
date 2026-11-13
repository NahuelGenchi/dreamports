// Sonic against an object's hitbox, as Sonic Advance does it. Translated from the JavaScript version's engine/collide.js
// (the original's collision_1.c Coll_Player_Platform, collision_2.c sub_800C934 and sub_800CBBC, and collision_3.c
// Coll_Player_Spring_Sideways and Coll_Player_Itembox, and skating_stone's collision.c Coll_Player_SkatingStone). Hitboxes are around the object's origin, edges included. Sonic is
// tested with plain rectangles around his centre; only an item box also looks at his attack box.

#include "objects.h"
#include "terrain.h"

enum { HALF_WIDTH = 6, FLANK_EXTRA = 5, SPRITE_ATTACK = 1 };

const Hitbox *object_box(const Sprite *s, int slot) { return s->hitboxes[slot].index >= 0 ? &s->hitboxes[slot] : NULL; }

int collide_overlap(int x0, int y0, const Hitbox *a, int x1, int y1, const Hitbox *b) {
  int l0 = x0 + a->left, r0 = x0 + a->right, t0 = y0 + a->top, b0 = y0 + a->bottom;
  int l1 = x1 + b->left, r1 = x1 + b->right, t1 = y1 + b->top, b1 = y1 + b->bottom;
  return ((l0 <= l1 && r0 >= l1) || (l0 >= l1 && r1 >= l0)) && ((t0 <= t1 && b0 >= t1) || (t0 >= t1 && b1 >= t0));
}

Hitbox collide_body(const Player *p) { return (Hitbox){ 0, -HALF_WIDTH, (int8_t)-p->offsetY, HALF_WIDTH, (int8_t)p->offsetY }; }
Hitbox collide_flank(const Player *p) {
  return (Hitbox){ 0, -(HALF_WIDTH + FLANK_EXTRA), (int8_t)(1 - p->offsetY), HALF_WIDTH + FLANK_EXTRA, (int8_t)(p->offsetY - 1) };
}

static int floor_of(double v) { return (int)__builtin_floor(v); }

// onto the top of the box or out below it, keeping the subpixel (sub_800C934). The position moves before the speed is
// checked, so a rising Sonic in the box's top half is put on top and keeps rising. Under flipped gravity he stands on its
// bottom and is put out of its top, and a tie at its middle still stands him on it.
static int vertical(const void *o, int ox, int oy, const Hitbox *hb, Player *p, const Hitbox *rect, int stoodHere, int *flags) {
  int px = floor_of(p->x), py = floor_of(p->y);
  if (!collide_overlap(ox, oy, hb, px, py, rect)) return 0;
  double frac = p->y - py;
  int steep = !p->air && ((p->rotation + 0x20) & 0x40), mid = oy + ((hb->top + hb->bottom) >> 1);
  if (p->inverted ? py < mid : py > mid) {
    p->y = (p->inverted ? oy + hb->top + rect->top : oy + hb->bottom - rect->top) + frac;
    *flags |= COLLIDE_FROM_BELOW;
    if (p->ysp > 0) return 0;
    p->ysp = 0;
    if (steep) p->gsp = 0;
    return 1;
  }
  p->y = (p->inverted ? oy + hb->bottom + rect->bottom : oy + hb->top - rect->bottom) + frac;
  if (p->ysp < 0) return 0;
  p->ysp = 0;
  if (steep) p->gsp = 0;
  p->onObject = o;
  // Knuckles gliding or sliding on after a glide stays in the air, his speeds as they were: his own step stands him up. Amy
  // slamming a dive stays in the air too, though she lands
  if (!player_gliding(p) && !player_slamming(p)) p->air = 0;
  *flags |= COLLIDE_LANDED;
  if (!stoodHere) {
    if (!player_gliding(p)) { player_land(p); p->gsp = p->xsp; }
    p->rotation = 0;
  }
  return 1;
}

// out to the nearer side of the box, or to the other one when the terrain is in the way (sub_800CBBC); walking into it on
// the ground stops him and stands him up
static int sideways(int ox, int oy, const Hitbox *hb, Player *p, int *flags) {
  if (((p->rotation + 0x20) >> 6) & 1) return 0;   // not while on a wall
  Hitbox rect = collide_flank(p);
  int px = floor_of(p->x), py = floor_of(p->y);
  if (!collide_overlap(ox, oy, hb, px, py, &rect)) return 0;
  int leftX = ox + hb->left - rect.right, rightX = ox + hb->right - rect.left + 1;
  int fromLeft = px <= ox + ((hb->left + hb->right) >> 1);
  if (fromLeft) {
    p->x = terrain_scan(PROBE_WALL, leftX, py, p->layer, -8).d >= 0 ? leftX : rightX;
    if (p->xsp < 0) return 0;
    *flags |= COLLIDE_LEFT_FACE;
  } else {
    p->x = terrain_scan(PROBE_WALL, rightX, py, p->layer, 8).d >= 0 ? rightX : leftX;
    if (p->xsp > 0) return 0;
    *flags |= COLLIDE_RIGHT_FACE;
  }
  if (p->air || p->attack != 0) { p->xsp = 0; return 1; }
  if (p->xsp == 0) return 1;
  *flags |= COLLIDE_PUSHING;
  p->pushing = 1;
  p->facing = fromLeft ? 1 : -1;
  player_stand_up(p);
  p->gsp = 0; p->xsp = 0;
  return 1;
}

int collide_gate(int ox, int oy, const Hitbox *hb, Player *p) {
  int flags = 0;
  if (!hb || p->dead) return 0;
  sideways(ox, oy, hb, p, &flags);
  return flags;
}

int collide_platform(const void *o, int ox, int oy, const Hitbox *hb, Player *p) {
  int flags = 0;
  if (!hb || p->dead) return 0;
  int stoodHere = p->onObject == o;
  if (stoodHere) p->onObject = NULL;
  Hitbox body = collide_body(p);
  int done = ((p->air || stoodHere) && vertical(o, ox, oy, hb, p, &body, stoodHere, &flags))
    || sideways(ox, oy, hb, p, &flags) || vertical(o, ox, oy, hb, p, &body, stoodHere, &flags);
  if (!done && stoodHere && !p->onObject) { p->air = 1; p->pushing = 0; }   // walked or jumped off
  return flags;
}

int collide_skating_stone(const void *o, int ox, int oy, const Hitbox *hb, Player *p) {
  int flags = 0;
  if (!hb || p->dead) return 0;
  int stoodHere = p->onObject == o;
  if (stoodHere) p->onObject = NULL;
  Hitbox body = collide_body(p);
  int done = ((p->air || stoodHere) && vertical(o, ox, oy, hb, p, &body, stoodHere, &flags))
    || vertical(o, ox, oy, hb, p, &body, stoodHere, &flags);
  if (!done && stoodHere && !p->onObject) { p->air = 1; p->pushing = 0; }   // walked or jumped off
  return flags;
}

// he is put on top by the height he had before landing stood him up: landing curled, he ends up 5 px into it until the next
// frame; this test keeps his subpixel position against the box's edges
int collide_platform_top(const void *o, int ox, int oy, const Hitbox *hb, Player *p) {
  if (!hb || p->dead) return 0;
  int stoodHere = p->onObject == o;
  if (stoodHere) p->onObject = NULL;
  double l = p->x - HALF_WIDTH, r = p->x + HALF_WIDTH, t = p->y - p->offsetY, b = p->y + p->offsetY;
  int ol = ox + hb->left, orr = ox + hb->right, ot = oy + hb->top, ob = oy + hb->bottom;
  if (((ol <= l && orr >= l) || (ol >= l && r >= ol)) && ((ot <= t && ob >= t) || (ot >= t && b >= ot)) && p->ysp >= 0) {
    int offsetY = p->offsetY;
    p->onObject = o;
    if (!player_gliding(p) && !player_slamming(p)) p->air = 0;
    if (!stoodHere) {
      if (!player_gliding(p)) { player_land(p); p->gsp = p->xsp; }
      p->rotation = 0;
    }
    p->ysp = 0;
    p->y = (p->inverted ? ob + offsetY : ot - offsetY) + (p->y - floor_of(p->y));
    return COLLIDE_LANDED;
  }
  if (stoodHere) p->air = 1;   // walked or jumped off
  return 0;
}

int collide_item_box(int ox, int oy, const Hitbox *hb, Player *p) {
  int flags = 0;
  if (!hb || p->dead) return 0;
  int px = floor_of(p->x), py = floor_of(p->y);
  const Hitbox *attack = object_box(&p->sprite, SPRITE_ATTACK);
  if (attack && collide_overlap(ox, oy, hb, px, py, attack)) {
    flags |= COLLIDE_PUSHING;
    if (p->air && p->ysp > 0) p->ysp = -p->ysp;
  }
  if (!p->air) return flags;
  Hitbox body = collide_body(p), flank = collide_flank(p);
  if (collide_overlap(ox, oy, hb, px, py, &body)) {
    int mid = oy + ((hb->top + hb->bottom) >> 1);
    if (p->inverted ? py >= mid : py <= mid) {
      if (p->ysp >= 0) { flags |= COLLIDE_LANDED; if (p->ysp > 0) p->ysp = -p->ysp; }
    } else if (p->ysp < 0) {
      p->ysp = 0;
      int under = oy + hb->bottom - body.top;
      p->y = p->inverted ? p->y + py - under : under + (p->y - py);
      flags |= COLLIDE_FROM_BELOW;
    }
  } else if (collide_overlap(ox, oy, hb, px, py, &flank)) {
    if (px <= ox + ((hb->left + hb->right) >> 1)) {
      if (p->xsp > 0) { p->xsp = 0; p->x = ox + hb->left - flank.right; }
    } else if (p->xsp < 0) { p->xsp = 0; p->x = ox + hb->right - flank.left + 1; }
  }
  return flags;
}

int collide_spring_side(const void *o, int ox, int oy, const Hitbox *hb, Player *p) {
  int flags = 0;
  if (!hb || p->dead) return 0;
  int inAir = p->air, stoodHere = 0;
  if (p->onObject == o) { p->onObject = NULL; inAir = 1; stoodHere = 1; }
  Hitbox flank = collide_flank(p), body = collide_body(p);
  int px = floor_of(p->x), py = floor_of(p->y);
  if (inAir) {
    if (collide_overlap(ox, oy, hb, px, py, &body)) {
      if (vertical(o, ox, oy, hb, p, &body, stoodHere, &flags)) return flags;
    } else if (collide_overlap(ox, oy, hb, px, py, &flank)) {
      if (px <= ox) {
        if (p->xsp >= 0) { p->xsp = 0; p->x = ox + hb->left - flank.right; flags |= COLLIDE_LEFT_FACE; }
      } else if (p->xsp <= 0) { p->xsp = 0; p->x = ox + hb->right - flank.left + 1; flags |= COLLIDE_RIGHT_FACE; }
    }
  }
  px = floor_of(p->x); py = floor_of(p->y);
  if (collide_overlap(ox, oy, hb, px, py, &flank)) {
    if (px <= ox) {
      if (p->xsp >= 0) {
        flags |= COLLIDE_LEFT_FACE;
        if (p->xsp > 0) { flags |= COLLIDE_PUSHING; p->x = ox + hb->left - flank.right; }
      }
    } else if (p->xsp <= 0) {
      flags |= COLLIDE_RIGHT_FACE;
      if (p->xsp < 0) { flags |= COLLIDE_PUSHING; p->x = ox + hb->right - flank.left + 1; }
    }
  }
  return flags;
}
