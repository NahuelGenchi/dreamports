// The forced slide (kind 46), translated from the JavaScript version's engine/slides.js (the original's forced_slide.c): a box,
// d2 by d3 tiles, down a slide of water, ice or mud. On every frame Sonic's centre is in it and he is on the ground (not on an
// object), it takes his controls and sends him down it at 4 px a frame in his knocked-back state, a splash under him; with d0
// set it sends him left, otherwise right. It only starts on him once the one-tile floor probe from his centre finds the ground
// within 3 px. In the air, or out of the box, it gives his controls back, with the jump and attack buttons he holds then not
// counting as presses, and leaving the box fades out the second sound effect player. In Angel Island the splash is mud and the
// slide's own sound starts as it takes him. Its priority is 0x1000 plus d1.
//
// Kept from the original: it would leave once out of range with both characters in its box, but a partner who isn't there
// keeps his bit set, so with Sonic alone it never leaves.

#include "objects.h"
#include "terrain.h"

enum {
  ANIM_WATER = 474, ANIM_ICE = 562, ANIM_MUD = 568,   // gAnimSlideSplashes by zone
  TILES = 18,                                         // the water's splash, 48 by 24 px, for any of them
  ORDER_SPLASH = 3, PRIORITY_SPLASH = 2,
  ICE_MOUNTAIN = 3, ANGEL_ISLAND = 4,
  SPEED = 4, NEAR = 3, TILE = 8,
  PRIORITY_SLIDE = 0x1000,
  SE_MUD_SLIDE = 201,
  SE2 = 2, FADE = 4,                                  // m4aMPlayFadeOut(&gMPlayInfo_SE2, 4)
};

typedef struct { Object o; int left, w, h, held; } Slide;

static int floor_of(double v) { return (int)__builtin_floor(v); }

// his controls back: the jump and attack buttons he holds aren't presses
static void release(Player *p) {
  p->ignoreInput = 0;
  e.pressed &= (uint16_t)~(KEY_A | KEY_B);
}

// Task_ForcedSlide, with Sonic alone
static int slide_run(ActTask *t) {
  Slide *sl = (Slide *)t->data;
  const Entity *en = &sl->o.slot->e;
  Player *p = &act.player;
  Sprite *s = &sl->o.sprite;
  if (p->dead) return 1;
  int x = floor_of(p->x), y = floor_of(p->y);
  if (x >= en->x && x <= en->x + sl->w && y >= en->y && y <= en->y + sl->h) {
    if ((sl->held != 0 || terrain_tile_floor(x, y, p->layer, 8) <= NEAR) && !p->onObject) {
      if (!p->air) {
        if (sl->held == 0 && act.stage.zone == ANGEL_ISLAND) play_song(SE_MUD_SLIDE);
        sl->held = 1;
        // Player_TransitionCancelFlyingAndBoost
        player_end_attack(p);
        p->pushing = 0; p->airLock = 0;
        p->ignoreInput = 1;
        p->jumpPressed = 0; p->attackPressed = 0;
        e.pressed &= (uint16_t)~(KEY_A | KEY_B);
        p->facing = sl->left ? -1 : 1;
        p->gsp = p->xsp = sl->left ? -SPEED : SPEED;
        p->ysp = 0;
        p->state = PS_HURT;
        player_stand_up(p);
        sprite_step(s);
        object_draw(s, x, y);
      } else if (sl->held != 0 && --sl->held == 0) release(p);
    }
  } else if (sl->held == 1) {
    gba_sound_fade_out(SE2, FADE);
    sl->held = 0;
    release(p);
  } else if (sl->held > 0) sl->held--;
  return 1;
}

ActTask *slide_spawn(Slot *slot) {
  Slide *sl = OBJECT_NEW(Slide);
  if (!sl) return NULL;
  const Entity *en = &slot->e;
  sl->o.slot = slot;
  sl->o.x = en->x;
  sl->left = (int8_t)en->d[0] != 0;
  sl->w = en->d[2] * TILE; sl->h = en->d[3] * TILE;
  int anim = act.stage.zone == ICE_MOUNTAIN ? ANIM_ICE : act.stage.zone == ANGEL_ISLAND ? ANIM_MUD : ANIM_WATER;
  object_sprite_at(&sl->o.sprite, vram_malloc(TILES), anim, 0, ORDER_SPLASH, PRIORITY_SPLASH, sl->left, 0);
  return object_task(&sl->o, slide_run, PRIORITY_SLIDE + (int8_t)en->d[1]);
}
