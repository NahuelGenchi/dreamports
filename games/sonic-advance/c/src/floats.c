// Whirlwinds (the player float toggle, kind 90). Translated from the JavaScript version's engine/floats.js (the original's
// toggle_player_float.c: CreateEntity_Toggle_PlayerFloat and Task_PlayerFloatMain): an area with nothing drawn, from its
// spawn point d2 tiles across and d3 down, both edges in. On every frame Sonic's centre is in it and he is alive, it lifts
// him: 104/256 px a frame off his Y speed, no faster up than 2.25 px a frame, before his own frame adds gravity. It puts him
// in the air, cancels his attack and pushing, and gives him its state: with d0 = 0 the whirlwind's spin, any other d0 the
// spring's somersault. More than 4 px above the floor under his centre it also uncurls him, leaving his hitbox as it is, and
// lifts a roll jump's air lock.
//
// A whirlwind plays SE_200 on the frame it first lifts him while he isn't already spinning in one, and fades the second sound
// effect player out on a frame he isn't spinning (landed, say); leaving the camera's range while it plays, it stops it. The
// halving of his falling speed on leaving is behind a flag nothing sets.

#include "objects.h"
#include "terrain.h"

enum {
  SE_WHIRLWIND = 200,
  SE2 = 2, FADE_SPEED = 4,   // m4aMPlayFadeOut(&gMPlayInfo_SE2, 4)
  UNCURL_ABOVE = 4,
};
#define UPDRAFT (104 / 256.0)   // PLAYER_FLOATING_UPDRAFT
#define MAX_RISE 2.25           // PLAYER_MAX_FLOATING_SPEED

typedef struct { Object o; int sounding; } Float;   // sounding: unk3D, SE_200 has started

static int float_run(ActTask *t) {
  Float *f = (Float *)t->data;
  const Entity *en = &f->o.slot->e;
  if (off_cam(en->x, en->y)) {
    if (f->sounding) stop_song(SE_WHIRLWIND);
    return 0;
  }
  Player *p = &act.player;
  if (p->state != PS_FLOAT && f->sounding) { fade_out_sound(SE2, FADE_SPEED); f->sounding = 0; }
  if (p->dead) return 1;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (x >= en->x && x <= en->x + en->d[2] * 8 && y >= en->y && y <= en->y + en->d[3] * 8) {
    int whirlwind = en->d[0] == 0;
    if (!f->sounding && p->state != PS_FLOAT && whirlwind) { f->sounding = 1; play_song(SE_WHIRLWIND); }
    p->ysp -= UPDRAFT;
    if (p->ysp < -MAX_RISE) p->ysp = -MAX_RISE;
    p->air = 1;
    // Player_TransitionCancelFlyingAndBoost, which in this game leaves the roll jump's air lock alone
    player_end_attack(p); p->pushing = 0;
    p->state = whirlwind ? PS_FLOAT : PS_SPRING;
    if (p->character == CHARACTER_AMY) p->hammerJump = 1;
    if (terrain_tile_floor(x, y, p->layer, 8) > UNCURL_ABOVE) { p->curled = 0; p->airLock = 0; }
  }
  return 1;
}

/** CreateEntity_Toggle_PlayerFloat */
ActTask *float_spawn(Slot *slot) {
  Float *f = OBJECT_NEW(Float);
  if (!f) return NULL;
  f->o.slot = slot;
  f->o.x = slot->e.x;
  return object_task(&f->o, float_run, PRIORITY_OBJECTS);
}
