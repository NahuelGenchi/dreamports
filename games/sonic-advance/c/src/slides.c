// The forced slides (interactable kind 46): a box d2 by d3 tiles down a water, ice or mud slide. Translated from the original's
// forced_slide.c a function at a time, with the JavaScript version's engine/slides.js as the guide; every comment names the
// function it rewrites.
//
// On every frame Sonic's centre is in the box and he is on the ground, not on an object, it takes his controls and sends him
// down it at 4 px a frame in his knocked-back state, a splash under him; with d0 set it sends him left, otherwise right. It only
// starts on him once the floor is within 3 px below his centre. In the air, or out of the box, it gives his controls back, with
// the buttons he holds then not counting as presses, and leaving the box fades out the second sound effect player. Its priority
// is 0x1000 plus d1. It leaves only out of range with the partner in its box too, so with Sonic alone it stays; in Angel Island
// it plays its own sound and splashes mud, which wait for that zone.

#include "objects.h"
#include "terrain.h"

enum {
  ZONE_ICE_MOUNTAIN = 3,
  ANIM_SPLASH_WATER = 474, ANIM_SPLASH_ICE = 562,   // SA1_ANIM_WATER_SLIDE_SPLASH and SA1_ANIM_ICE_SLIDE_SPLASH
  SPLASH_TILES = 48 / 8 * (24 / 8),                 // ALLOC_TILES(SA1_ANIM_WATER_SLIDE_SPLASH), whichever splash it shows
  ORDER_SPLASH = 3, PRIORITY_SPLASH = 2,
  PRIORITY_SLIDE = 0x1000,
  SPEED = 4,
  NEAR_FLOOR = 3,
  SE2 = 2, FADE = 4,                                // m4aMPlayFadeOut(&gMPlayInfo_SE2, 4)
};

typedef struct { Object o; int dir, held; } Slide;

static int floor_of(double v) { return (int)__builtin_floor(v); }

// his controls back: the jump and attack buttons he holds don't count as presses (heldInput |= jump | attack)
static void release(Player *p) {
  p->ignoreInput = 0;
  e.pressed &= (uint16_t)~(KEY_A | KEY_B);
}

/** Task_ForcedSlide */
static int slide_run(ActTask *t) {
  Slide *d = (Slide *)t->data;
  Sprite *s = &d->o.sprite;
  const Entity *en = &d->o.slot->e;
  Player *p = &act.player;
  if (p->dead) return 1;
  int x = floor_of(p->x), y = floor_of(p->y);
  if (x >= en->x && x <= en->x + en->d[2] * 8 && y >= en->y && y <= en->y + en->d[3] * 8) {
    if ((d->held != 0 || terrain_tile_floor(x, y, p->layer, 8) <= NEAR_FLOOR) && !p->onObject) {
      if (!p->air) {
        d->held = 1;
        player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
        p->jumped = 0;                          // MOVESTATE_100
        p->airLock = 0;                         // MOVESTATE_FLIP_WITH_MOVE_DIR
        p->ignoreInput = 1;
        p->jumpPressed = 0;                     // heldInput and frameInput cleared
        e.pressed &= (uint16_t)~(KEY_A | KEY_B);
        p->facing = d->dir;
        p->gsp = p->xsp = SPEED * d->dir;
        p->ysp = 0;
        p->state = PS_HURT;                     // CHARSTATE_HIT_AIR
        player_stand_up(p);                     // MOVESTATE_4 and PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14)
        sprite_step(s);
        object_draw(s, floor_of(p->x), floor_of(p->y));
      } else if (d->held != 0 && --d->held == 0) release(p);
    }
  } else if (d->held == 1) {
    gba_sound_fade_out(SE2, FADE);
    d->held = 0;
    release(p);
  }
  // the partner's bit stays set, so it never reaches its out-of-range test
  return 1;
}

/** CreateEntity_ForcedSlide: the splash takes room for the water's whatever the zone */
ActTask *forced_slide_spawn(Slot *slot) {
  Slide *d = OBJECT_NEW(Slide);
  if (!d) return NULL;
  d->o.slot = slot;
  d->o.x = slot->e.x;
  d->dir = slot->e.d[0] ? -1 : 1;
  int anim = act.stage.zone == ZONE_ICE_MOUNTAIN ? ANIM_SPLASH_ICE : ANIM_SPLASH_WATER;
  object_sprite_at(&d->o.sprite, vram_malloc(SPLASH_TILES), anim, 0, ORDER_SPLASH, PRIORITY_SPLASH, d->dir < 0, 0);
  return object_task(&d->o, slide_run, PRIORITY_SLIDE + (int8_t)slot->e.d[1]);
}
