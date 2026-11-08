// Casino Paradise's teleport orbs (kind 72). Translated from the JavaScript version's engine/teleportorbs.js (the original's
// teleport_orb.c): an orb drawn in the level's tiles that, when Sonic's centre comes within 12 px of it, puts him at
// (d0 * 256 + d2, d1 * 256 + d3), curled up, still and held there, with the spring's sound. It lets him go, in the air and still,
// once the camera has caught up with him: on the first frame it hasn't moved since the last one, with him inside the screen. A
// death meanwhile lets him go too, puts him in the middle of the screen and stops the camera.
//
// The orb has no sprite to draw; it goes when its spawn point leaves the camera's range, but not while it holds him.

#include "objects.h"
#include "terrain.h"

enum {
  TELEPORT_ORB = 72, REACH = 12, SE_SPRING = 170,
  STANDING_OFFSET_Y = 14,   // his standing height, curled up or not
  TILE_SPAN = 256,          // d0 and d1 count 256 px
};

typedef struct {
  Object o;
  int held;
  double camX, camY;   // where the camera was the last time the orb looked at him
} Orb;

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

// held: curled up, carried, still, at his standing height
static void hold(Player *p) {
  cancel(p);
  p->carried = 1;
  p->xsp = 0; p->ysp = 0; p->gsp = 0;
  p->state = PS_SPIN;
  sensors_set_offset_y(p, STANDING_OFFSET_Y);
}

static int orb_run(ActTask *t) {
  Orb *orb = (Orb *)t->data;
  const Entity *e = &orb->o.slot->e;
  Player *p = &act.player;
  const Camera *cam = &act.cam;
  if (orb->held) {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (cam->x == orb->camX && cam->y == orb->camY && cam->x <= px && cam->x + DISPLAY_WIDTH >= px && cam->y <= py && cam->y + DISPLAY_HEIGHT >= py) {
      p->carried = 0; p->air = 1;
      orb->held = 0;
      p->xsp = 0; p->ysp = 0; p->gsp = 0;
    } else hold(p);
    if (p->dead) {
      orb->held = 0;
      p->carried = 0;
      p->x = cam->x + DISPLAY_WIDTH / 2; p->y = cam->y + DISPLAY_HEIGHT / 2;
      act.cam.speedX = 0; act.cam.speedY = 0;   // only Sonic's death moves him and stops the camera
    }
    orb->camX = cam->x; orb->camY = cam->y;
  } else if (!p->dead) {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (px >= e->x - REACH && px <= e->x + REACH && py >= e->y - REACH && py <= e->y + REACH) {
      cancel(p);
      p->curled = 1; p->carried = 1;
      p->x = s8(e->d[0]) * TILE_SPAN + e->d[2]; p->y = s8(e->d[1]) * TILE_SPAN + e->d[3];
      p->xsp = 0; p->ysp = 0; p->gsp = 0;
      p->state = PS_SPIN;
      sensors_set_offset_y(p, STANDING_OFFSET_Y);
      play_song(SE_SPRING);
      orb->held = 1;
      orb->camX = cam->x; orb->camY = cam->y;
    }
  }
  if (!orb->held && off_cam(e->x, e->y)) return 0;
  return 1;
}

ActTask *teleport_orb_spawn(Slot *slot) {
  Orb *orb = OBJECT_NEW(Orb);
  if (!orb) return NULL;
  orb->o.slot = slot;
  orb->o.x = slot->e.x;
  orb->o.sprite.graphics.dest = HEAP_END;   // no sprite: the orb is drawn in the level's tiles
  return object_task(&orb->o, orb_run, PRIORITY_OBJECTS);
}
