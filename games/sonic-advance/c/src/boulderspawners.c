// Angel Island's rolling boulders (interactable kind 92). Translated from the JavaScript version's engine/boulderspawners.js
// (the original's boulder_spawner.c: CreateEntity_BoulderSpawner, Task_BoulderSpawnerMain, Task_BoulderMain and
// CreateBoulderDebris). A spawner draws nothing: on every frame the stage clock is a multiple of 120, it lets a boulder go at
// its spawn point, and it leaves once that point is more than 128 px off the screen.
//
// A boulder rolls right along the back layer's floor, starting at 1/4 px a frame. Each frame it reads the floor in the tile at
// its bottom: within 5 px it settles 2 px into it and speeds up by the cosine of the floor's angle over 1250; further down, it
// falls, from 2/5 of its speed across, gaining 1/8 px a frame each frame. Landing stops the fall; it lands d0 times and breaks
// on the next landing, into the pieces of a broken boulder, with an explosion when it is on the screen. It hurts Sonic where
// its box meets his, and it is drawn where it was at the start of the frame.
//
// Original quirks kept: where the tile at its bottom is empty the floor probe leaves the angle alone, and the boulder reads
// whatever its stack held there instead, which adds 3/256 px a frame in every recording of the original; it leaves as soon as
// it is off the screen, since the test meant to keep it while its spawn point is near looks at that point's world position as
// if it were a place on the screen; and its pieces' sprites take the room of each other's animation.

#include "objects.h"
#include "terrain.h"

enum {
  EVERY = 120,                  // BOULDER_SPAWN_RATE
  ANIM_BOULDER = 457, ANIM_DEBRIS_SMALL = 459, ANIM_DEBRIS_LARGE = 460,
  BOULDER_TILES = 32 / 8 * (32 / 8),
  ORDER_BOULDER = 18, PRIORITY_FRONT = 2,
  START_SPEED = 64,             // Q(0.25)
  FALL = 32,                    // 1/8 px a frame per frame
  ROLL_WITHIN = 5, SETTLE = 2,
  STACK_SPEED_UP = 3,           // what the angle left on the stack adds where the tile at its bottom is empty
  SE_EXPLOSION = 144,
};

// CreateBoulderDebris: the pieces start full size, grow 8/256 a frame and go after 60 frames; the small one has the large
// one's room (16 x 16) and the large one the small one's (8 x 8)
static const DebrisLook PIECES = { ANIM_DEBRIS_SMALL, 16 / 8 * (16 / 8), ANIM_DEBRIS_LARGE, 8 / 8 * (8 / 8), 0x100, 8, 60 };

typedef struct {
  Object o;
  int x0, y0;                   // its spawn point (unkB2, unkB4)
  int vx, vy, dx, dy;           // its speeds and how far it has gone, in 1/256 px (qUnkA0, qUnkA4, qUnkA8, qUnkAC)
  int falling, landings;        // unkB0, unkB1
} Boulder;

// IS_OUT_OF_CAM_RANGE on a place on the screen
static int screen_off(int sx, int sy) { return ((sx + 128) & 0xFFFF) > 496 || sy + 128 < 0 || sy > 288; }

/** Task_BoulderMain */
static int boulder_run(ActTask *t) {
  Boulder *b = (Boulder *)t->data;
  Sprite *s = &b->o.sprite;
  int x = b->x0 + (b->dx >> 8), y = b->y0 + (b->dy >> 8);
  int sx = x - cam_x(), sy = y - cam_y();
  if (screen_off(b->x0, b->y0) && screen_off(sx, sy)) return 0;
  Player *p = &act.player;
  const Hitbox *box = object_box(s, 0);
  Hitbox body = collide_body(p);
  if (!p->dead && box && collide_overlap(x, y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) world_damage(p);
  Scan floor = terrain_tile_probe(PROBE_FLOOR, y, x, LAYER_BACK, 8);
  if (b->falling) {
    if (floor.d >= 0) b->vy += FALL;
    else {
      b->vy = 0; b->falling = 0;
      if (b->landings != 0) b->landings--;
      else {
        shards_new(&PIECES, x, y, sx, sy);
        if (!screen_off(sx, sy)) play_song(SE_EXPLOSION);
        return 0;
      }
    }
  } else if (floor.d > ROLL_WITHIN) {
    int v = b->vx * 2 / 5;
    b->vy += v < 0 ? -v : v;
    b->falling = 1;
  } else {
    b->vx += floor.hasRot ? SINE[(floor.rot & 0xFF) * 4 + 256] / 1250 : STACK_SPEED_UP;
    b->dy += (floor.d + SETTLE) * 256;
  }
  b->dx += b->vx; b->dy += b->vy;
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

static void boulder_new(int x, int y, int landings) {
  Boulder *b = OBJECT_NEW(Boulder);
  if (!b) return;
  b->x0 = x; b->y0 = y;
  b->vx = START_SPEED;
  b->landings = landings;
  object_sprite_at(&b->o.sprite, vram_malloc(BOULDER_TILES), ANIM_BOULDER, 0, ORDER_BOULDER, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  object_task(&b->o, boulder_run, PRIORITY_OBJECTS);
}

/** Task_BoulderSpawnerMain */
static int spawner_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  if (act_stage_time() % EVERY == 0) boulder_new(en->x, en->y, en->d[0] & 0xFF);
  return !off_display(en->x, en->y);
}

/** CreateEntity_BoulderSpawner */
ActTask *boulder_spawner_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  return object_task(o, spawner_run, PRIORITY_OBJECTS);
}
