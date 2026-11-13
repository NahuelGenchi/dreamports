// Neo Green Hill's water bridge (SAT-R decompilation, src/game/sa1/stage/interactables/water_bridge.c, ported from its
// assembly, asm/non_matching/game/sa1/stage/interactables/water_bridge__Task_WaterBridge.inc), kind 40, and the splashes
// along it, kind 43 (water_bridge_splash.c), translated from the JavaScript version's engine/waterbridges.js. The bridge is
// an arc of water across a box, d0 and d1 tiles (signed) from its spawn point to its top left and d2 by d3 tiles in size:
// half a sine, from the bottom corners up to the top in the middle. On every frame Sonic's feet are in the box and within
// 32 px below the arc, it carries him along it: his speed goes up by 0.25 px a frame to at most 8 either way, and his rise
// follows the arc's slope, less 42/256 px a frame. It holds his controls and puts him in his knocked-back state, uncurled
// but as short as a ball, with a splash at his feet; the first frame it does, it plays the splash's sound and sets his
// MOVESTATE_8000, the half-pipe's flag. On every other frame it gives his controls back, with the buttons he holds then not
// counting as presses, and clears that flag. The splash is drawn 6 px above his feet: the original takes away his
// spriteOffsetX where it means his spriteOffsetY (9), so it shows 3 px lower than where it was meant to.

#include "objects.h"
#include "terrain.h"

enum {
  WATER_BRIDGE = 40, WATER_BRIDGE_SPLASH = 43,
  ANIM_SLIDE_SPLASH = 474, ANIM_BRIDGE_SPLASH = 473,
  ARC = 32,                    // WATER_BRIDGE_DIAMETER: how far below the arc it still holds him
  SOX = 6,                     // his spriteOffsetX
  MAX_SPEED = 0x800, PUSH = 0x40, FALL = 42,   // in 1/256 px a frame
  SPLASH_ORDER = 15, PRIORITY_BACK = 1,
  SE_WATER_BRIDGE_SPLASH = 177,
  BALL_SPRITE_OFFSET_Y = 9,
};

// its one sprite is the splash Sonic makes on it, whose tiles go back with it (TaskDestructor_WaterBridge)
typedef struct { Object o; } WaterBridge;
typedef struct { Object o; } BridgeSplash;

static void no_presses(Player *p) { p->jumpPressed = 0; p->attackPressed = 0; }
static int clamp(int v) { return v < -MAX_SPEED ? -MAX_SPEED : v > MAX_SPEED ? MAX_SPEED : v; }

static int water_bridge_run(ActTask *t) {
  WaterBridge *b = (WaterBridge *)t->data;
  const Entity *e = &b->o.slot->e;
  Player *p = &act.player;
  int w = e->d[2] * 8, h = e->d[3] * 8;
  int left = e->x + s8(e->d[0]) * 8, top = e->y + s8(e->d[1]) * 8, right = left + w, bottom = top + h;
  // the range is looked at before Sonic's turn, so only he gets his flag cleared as it leaves
  if (off_display(e->x, e->y)) { p->halfPipe = 0; b->o.slot->live = NULL; return 0; }
  int x = (int)__builtin_floor(p->x), feet = (int)__builtin_floor(p->y) + p->offsetY;
  if (x >= left && x < right && feet >= top && feet <= bottom) {
    if (p->dead) return 1;
    // where the arc is above his centre's column: half a turn of the sine table across the box
    int theta = ((x - left) << 9) / w;
    if (theta > 0x1FF) theta = 0x1FF;
    int y = ((bottom << 8) - (SINE[theta] >> 6) * h) >> 8;
    if (feet >= y && feet <= y + ARC) {
      int cos = SINE[theta + 256] >> 6;
      if (!p->halfPipe) { play_song_or_change(SE_WATER_BRIDGE_SPLASH); p->halfPipe = 1; }
      double speed = (p->air ? p->xsp : p->gsp) * 256;
      int v = clamp((int)__builtin_floor(speed + 0.5) + PUSH);
      p->gsp = p->xsp = v / 256.0;
      p->ysp = clamp((((-h * cos * v) >> 16) - FALL)) / 256.0;
      // Player_TransitionCancelFlyingAndBoost
      player_end_attack(p); p->pushing = 0; p->airLock = 0;
      p->state = PS_HURT;
      p->curled = 0; sensors_set_offset_y(p, BALL_SPRITE_OFFSET_Y);
      p->ignoreInput = 1; no_presses(p);
      sprite_step(&b->o.sprite);
      object_draw(&b->o.sprite, x, feet - SOX);
      return 1;
    }
  }
  if (p->ignoreInput) { p->ignoreInput = 0; no_presses(p); }
  p->halfPipe = 0;
  return 1;
}

ActTask *water_bridge_spawn(Slot *slot) {
  WaterBridge *b = OBJECT_NEW(WaterBridge);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, ANIM_SLIDE_SPLASH, 0, 0, SPLASH_ORDER, PRIORITY_BACK, 0, 0);
  return object_task(&b->o, water_bridge_run, PRIORITY_OBJECTS);
}

static int bridge_splash_run(ActTask *t) {
  BridgeSplash *b = (BridgeSplash *)t->data;
  const Entity *e = &b->o.slot->e;
  if (off_display(e->x, e->y)) { b->o.slot->live = NULL; return 0; }
  sprite_step(&b->o.sprite);
  object_draw(&b->o.sprite, e->x, e->y);
  return 1;
}

ActTask *water_bridge_splash_spawn(Slot *slot) {
  BridgeSplash *b = OBJECT_NEW(BridgeSplash);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, ANIM_BRIDGE_SPLASH, 0, 0, SPLASH_ORDER, PRIORITY_BACK, 0, 0);
  return object_task(&b->o, bridge_splash_run, PRIORITY_OBJECTS);
}
