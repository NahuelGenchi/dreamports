// The skating stones (interactable kind 84): a block of stone Sonic rides down the ice. Translated from the original's
// skating_stone.c a function at a time, with the JavaScript version's engine/skatingstones.js as the guide; every comment names
// the function it rewrites.
//
// It waits where it is placed, solid only from above and below. Once Sonic lands on it, it slides along the floor, sped up by
// its slope the way d1 says (0 right, else left), with Sonic carried on it. Off the end of the floor it flies on and falls; each
// landing after that uses up one of d0's hops, and the landing after the last one, or a wall ahead, breaks it into pieces that
// throw Sonic up curled at its speed. It comes back once its place is out of range. The original's Knuckles climbing onto it
// (sub_80549FC) waits for him.

#include "bosses.h"

enum {
  ANIM_STONE_ICE = 529, ANIM_STONE = 547,                     // SA1_ANIM_SKATING_STONE_4 and SA1_ANIM_SKATING_STONE
  ANIM_DEBRIS_ICE_LARGE = 553, ANIM_DEBRIS_ICE_SMALL = 554,   // SA1_ANIM_SKATING_STONE_DEBRIS_4_L and _4_S
  ANIM_DEBRIS_LARGE = 548, ANIM_DEBRIS_SMALL = 549,           // SA1_ANIM_SKATING_STONE_DEBRIS_L and _S
  STONE_TILES = 48 / 8 * (32 / 8),                            // ALLOC_TILES: 48 x 32 px, in either zone
  ORDER_STONE = 18, PRIORITY_STONE = 2,
  SE_SKATING = 198, SE_BOSS_HIT = 143,
  LAND_ABOVE = 44,                // landing on it while it waits puts him this far above it
  RIDE_HEIGHT = 46, RIDE_HEIGHT_CURLED = 42,   // and riding it, his centre is this far above its own
  TOUCH_ABOVE = 12,               // the box he has to touch to stay on is this much higher
  NEAR_FLOOR = 5,                 // it leaves the floor once the floor is further below than this
  FALL = 32,                      // 32/256 px a frame per frame
  LIFT = 3,                       // it is lifted this far above the floor found
  SLOPE_RIDER = 6070, SLOPE_STONE = 1440,   // the floor's cosine over these moves him and speeds it up
  WALL_AHEAD = 18, WALL_ABOVE = -30,        // where it looks for a wall
  THROW_SPEED = -3,                // the break throws him up this fast
  DEBRIS_ABOVE = -20,              // and the pieces start this far above it
};

typedef struct {
  Object o;
  int hops, left;                  // d0's hops left, and d1: it goes left
  int sliding, falling, riding;
  int vx, vy, ox, oy;              // its speed and how far it has gone, in 1/256 px (qUnkA0, qUnkA4, qUnkA8, qUnkAC)
  int16_t sx, sy;                  // its place on screen (s->x, s->y)
} Stone;

// CreateSkatingStoneDebris: the pieces start at 3/4 size, grow 8/256 a frame and go after 60 frames
static const DebrisLook DEBRIS_ICE = {
  ANIM_DEBRIS_ICE_SMALL, 8 / 8 * (8 / 8), ANIM_DEBRIS_ICE_LARGE, 64 / 8 * (64 / 8), 0xC0, 8, 60,
};
static const DebrisLook DEBRIS = {
  ANIM_DEBRIS_SMALL, 8 / 8 * (8 / 8), ANIM_DEBRIS_LARGE, 32 / 8 * (32 / 8), 0xC0, 8, 60,
};

static int floor_of(double v) { return (int)__builtin_floor(v); }

/** Player_TransitionCancelFlyingAndBoost */
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

/** Off it and in the air, curled up as a spin attack (CHARSTATE_SPINATTACK), or Amy as she rises from a jump (85) */
static void knock_off(Stone *n, Player *p) {
  cancel(p);
  p->onObject = NULL; p->air = 1;
  p->state = player_thrown_state(p);
  n->riding = 0;
}

/** Coll_Player_Entity_Intersection: his body's box against the stone's first hitbox */
static int touches(const Stone *n, int x, int y, const Player *p) {
  const Hitbox *box = object_box(&n->o.sprite, 0);
  Hitbox body = collide_body(p);
  return !p->dead && box && collide_overlap(x, y, box, floor_of(p->x), floor_of(p->y), &body);
}

/** The break, in Task_SkatingStone2: Sonic thrown up at its speed, and its pieces from its place on screen */
static int break_up(Stone *n, int x, int y) {
  Player *p = &act.player;
  if (!p->dead && n->riding) {
    p->ysp = THROW_SPEED;
    p->xsp = p->gsp = n->vx / 256.0;
    knock_off(n, p);
  }
  stop_song(SE_SKATING);
  shards_new(act.stage.zone == ZONE_ICE_MOUNTAIN ? &DEBRIS_ICE : &DEBRIS, x + (n->ox >> 8), y + (n->oy >> 8) + DEBRIS_ABOVE, n->sx, n->sy);
  play_song(SE_BOSS_HIT);
  return 0;
}

/** Task_SkatingStoneInit: waiting, until Sonic lands on it */
static int stone_wait(Stone *n, int x, int y) {
  Player *p = &act.player;
  Sprite *s = &n->o.sprite;
  n->sx = s16(x - cam_x()); n->sy = s16(y - cam_y());
  if (!p->dead && (collide_skating_stone(&n->o, x, y, object_box(s, 0), p) & COLLIDE_LANDED)) {
    p->onObject = NULL; p->air = 1;
    p->jumped = 0;           // MOVESTATE_100
    p->airLock = 0;          // MOVESTATE_FLIP_WITH_MOVE_DIR
    player_stand_up(p);      // MOVESTATE_4 and PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14)
    p->y = y - LAND_ABOVE;
    n->riding = 1;
    n->vx = n->vy = n->ox = n->oy = 0;
    n->sliding = 1;
  }
  if (off_cam(x, y)) return 0;
  object_draw(s, x, y);
  return 1;
}

/** Task_SkatingStone2: sliding, flying and falling */
static int stone_slide(Stone *n, int x, int y) {
  Player *p = &act.player;
  Sprite *s = &n->o.sprite;
  n->oy += n->vy;
  n->sy = s16((n->oy >> 8) + y - cam_y());
  if (off_display(x, y) && off_cam(n->sx + cam_x(), n->sy + cam_y())) {
    stop_song(SE_SKATING);
    return 0;
  }
  int layer = LAYER_FRONT;
  if (!p->dead) {
    layer = p->layer;
    if (n->riding) p->y = (y * 256 + n->oy - (p->spinDashing || p->curled ? RIDE_HEIGHT_CURLED : RIDE_HEIGHT) * 256) / 256.0;
  }
  int at = x + (n->ox >> 8), floorY = y + (n->oy >> 8);
  if (n->falling) {
    if (terrain_tile_floor(at, floorY, layer, 8) >= 0) n->vy += FALL;
    else {
      n->vy = 0;
      n->falling = 0;
      if (n->hops == 0) return break_up(n, x, y);
      play_song(SE_SKATING);
      n->hops--;
    }
  } else {
    Scan f = terrain_scan(PROBE_FLOOR, floorY, at, layer, 8);
    if (f.d > NEAR_FLOOR) {
      stop_song(SE_SKATING);
      // it flies off upward in Ice Mountain and downward elsewhere, by part of its speed
      int ice = act.stage.zone == ZONE_ICE_MOUNTAIN, lift = ice ? bios_div(n->vx * 2, 5) : bios_div(n->vx * 3, 5);
      if (lift < 0) lift = -lift;
      n->vy += ice ? lift : -lift;
      n->falling = 1;
    } else {
      int c = SINE[(f.rot & 0xFF) * 4 + 256];   // COS
      if (!p->dead && n->riding) p->x += (n->left ? bios_div(c, SLOPE_RIDER) : -bios_div(c, SLOPE_RIDER)) / 256.0;
      n->vx += n->left ? -bios_div(c, SLOPE_STONE) : bios_div(c, SLOPE_STONE);
      n->oy += (f.d + LIFT) * 256;
    }
  }
  if (terrain_tile_scan(PROBE_WALL, x + (n->ox >> 8) + WALL_AHEAD, y + (n->oy >> 8) + WALL_ABOVE, layer, 8) < 0) return break_up(n, x, y);
  if (!p->dead) {
    if (n->riding) {
      if (p->air) n->riding = 0;
      else {
        p->air = 0; p->jumped = 0; p->airLock = 0;
        int r = terrain_tile_scan(PROBE_WALL, floor_of(p->x), floor_of(p->y), p->layer, 8);
        if (r < 0) { p->onObject = NULL; p->air = 1; n->riding = 0; p->x += r; }
        r = terrain_tile_scan(PROBE_WALL, floor_of(p->x), floor_of(p->y), p->layer, -8);
        if (r < 0) { p->onObject = NULL; p->air = 1; n->riding = 0; p->x -= r; }
        if (touches(n, x + (n->ox >> 8), y + (n->oy >> 8) - TOUCH_ABOVE, p)) {
          p->x += n->vx * 2 / 256.0;
          int ahead = floor_of(p->x + n->vx * 2 / 256.0);
          r = terrain_scan(PROBE_WALL, ahead, floor_of(p->y), p->layer, 8).d;
          if (r < 0) { knock_off(n, p); p->x += r; p->xsp = 0; }
          else {
            r = terrain_scan(PROBE_WALL, ahead, floor_of(p->y), p->layer, -8).d;
            if (r < 0) { knock_off(n, p); p->x -= r; p->xsp = 0; }
          }
          n->sy = s16(floor_of(p->y) - cam_y() + (p->spinDashing || p->curled ? RIDE_HEIGHT_CURLED : RIDE_HEIGHT));
        } else {
          cancel(p);
          p->onObject = NULL; p->air = 1;
          n->riding = 0;
        }
      }
    } else if (collide_platform_top(&n->o, x + (n->ox >> 8), y + (n->oy >> 8), object_box(s, 0), p) & COLLIDE_LANDED) {
      p->y += 1;
      n->riding = 1;
      cancel(p);
      p->onObject = &n->o; p->air = 0;
      p->jumped = 0; p->airLock = 0;
      p->state = PS_WALK;
      player_stand_up(p);    // MOVESTATE_4 and PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14)
    }
  }
  n->ox += n->vx * 2;
  n->sx = s16(x + (n->ox >> 8) - cam_x());
  sprite_step(s);
  object_draw(s, n->sx + cam_x(), n->sy + cam_y());
  return 1;
}

static int stone_run(ActTask *t) {
  Stone *n = (Stone *)t->data;
  const Entity *e = &n->o.slot->e;
  return n->sliding ? stone_slide(n, e->x, e->y) : stone_wait(n, e->x, e->y);
}

/** TaskDestructor_SkatingStone: its tiles, and its sound */
static void stone_end(ActTask *t) {
  stop_song(SE_SKATING);
  object_end(t);
}

/** CreateEntity_SkatingStone */
ActTask *skating_stone_spawn(Slot *slot) {
  Stone *n = OBJECT_NEW(Stone);
  if (!n) return NULL;
  n->o.slot = slot;
  n->o.x = slot->e.x;
  n->hops = slot->e.d[0];
  n->left = slot->e.d[1];
  int anim = act.stage.zone == ZONE_ICE_MOUNTAIN ? ANIM_STONE_ICE : ANIM_STONE;
  object_sprite_at(&n->o.sprite, vram_malloc(STONE_TILES), anim, 0, ORDER_STONE, PRIORITY_STONE, 0, 0);
  sprite_step(&n->o.sprite);
  ActTask *t = object_task(&n->o, stone_run, PRIORITY_OBJECTS);
  if (t) t->end = stone_end;
  return t;
}
