// The eight spring kinds. Translated from the JavaScript version's engine/springs.js and objectTask in engine/objects.js
// (the original's spring.c). A spring waits until Sonic triggers it, then plays its launch animation, still launching him if
// he touches it again, and goes back to waiting when it ends.

#include "objects.h"

enum {
  SPRING_UP = 8, SPRING_DOWN, SPRING_LEFT, SPRING_RIGHT, SPRING_BIG_UPLEFT, SPRING_BIG_UPRIGHT, SPRING_SMALL_UPLEFT,
  SPRING_SMALL_UPRIGHT,
};
enum {
  ANIM_SPRING = 455, ORDER_SPRING = 18, PRIORITY_FRONT = 2,
  PALETTE_YELLOW_SPRING = 36, YELLOW_BANK = 8,   // the weaker up springs draw with this palette, in the bank after the red one's (gObjPalette[8 * 16])
  SE_SPRING = 170,
  TRIGGER_OUT = 20,       // how far out on its side Sonic's centre must be for a diagonal spring to launch him
  TRIGGER_HALF_WIDTH = 12,
  SPEED_KINDS = 4, MAX_SPEED_ENTRY = 3,
};
static const double SPEEDS[SPEED_KINDS] = { 7.5, 9, 10.5, 12 };

// each kind's idle and launch variants, and which way it is turned
static const struct { uint8_t idle, launch, flipX, flipY; } LOOKS[] = {
  [SPRING_UP - SPRING_UP] = { 0, 1, 0, 0 },
  [SPRING_DOWN - SPRING_UP] = { 0, 1, 0, 1 },
  [SPRING_LEFT - SPRING_UP] = { 2, 3, 1, 0 },
  [SPRING_RIGHT - SPRING_UP] = { 2, 3, 0, 0 },
  [SPRING_BIG_UPLEFT - SPRING_UP] = { 4, 5, 1, 0 },
  [SPRING_BIG_UPRIGHT - SPRING_UP] = { 4, 5, 0, 0 },
  [SPRING_SMALL_UPLEFT - SPRING_UP] = { 6, 7, 1, 0 },
  [SPRING_SMALL_UPRIGHT - SPRING_UP] = { 6, 7, 0, 0 },
};

typedef struct {
  Object o;
  int kind, d0, launching;
  double speed;
  int idle, launch;
} Spring;

// d0 picks one of four speeds; above 3 the speed is d1 * 16 in 1/256 px
static double launch_speed(int d0, int d1) { return s8(d0) > MAX_SPEED_ENTRY ? (d1 << 4) / 256.0 : SPEEDS[d0 & 3]; }

// thrown into the air by a spring that points up: no jump moves until he lands, and the spring's d0 bit 0 picks the rise
// and fall animations over the somersault
static void throw_up(const Spring *sp, Player *p) {
  p->onObject = NULL; p->air = 1;
  player_end_attack(p);
  p->state = sp->d0 & 1 ? PS_SPRING_RISE : PS_SPRING;
  p->animRestart = 1;
  player_stand_up(p);
}

static const Hitbox *box_of(const Spring *sp, int slot) { return object_box(&sp->o.sprite, slot); }

// up (sub_8022640): landing on it launches him straight up, keeping his X speed; while an object carries him
// (MOVESTATE_IA_OVERRIDE), as a hook rail does, it is not there for him at all
static int up(Spring *sp, Player *p) {
  const Entity *e = &sp->o.slot->e;
  if (p->carried) return 0;
  if (!(collide_platform(&sp->o, e->x, e->y, box_of(sp, 0), p) & COLLIDE_LANDED)) return 0;
  player_land(p);
  p->ysp = -sp->speed;
  throw_up(sp, p);
  return 1;
}

// down (sub_8022804): bumping it from below throws him down as he is; standing on it counts as ground
static int down(Spring *sp, Player *p) {
  const Entity *e = &sp->o.slot->e;
  int r = collide_platform(&sp->o, e->x, e->y, box_of(sp, 0), p);
  if (r & COLLIDE_FROM_BELOW) {
    p->air = 1; p->jumped = 0; p->midAir = 0;
    p->ysp = sp->speed;
    return 1;
  }
  if (r & (COLLIDE_LANDED | COLLIDE_PUSHING)) player_land(p);
  return 0;
}

// left and right (sub_80228D0): its face sends him running (or rolling) away, even from a standstill; its back is a wall, and
// touching it counts as touching the ground, even in mid-air
static int side(Spring *sp, Player *p) {
  const Entity *e = &sp->o.slot->e;
  int r = collide_spring_side(&sp->o, e->x, e->y, box_of(sp, 0), p);
  int face = r & COLLIDE_LEFT_FACE ? -1 : r & COLLIDE_RIGHT_FACE ? 1 : 0;
  if (!face) return 0;
  int dir = sp->kind == SPRING_LEFT ? -1 : 1;
  if (face == dir) {
    p->xsp = p->gsp = sp->speed * dir;
    player_end_attack(p);
    p->state = p->curled ? PS_SPIN : PS_WALK;
    p->rotation = 0; p->facing = dir;
    return 1;
  }
  player_land(p);
  if (r & COLLIDE_PUSHING) { p->pushing = 1; p->xsp = p->gsp = 0; player_stand_up(p); }
  return 0;
}

// diagonal (sub_8022AB4 big, sub_8022E14 small): its second hitbox is the trigger, but only once Sonic's centre is more than 20
// px out on the side it points to; otherwise it is solid
static int diagonal(Spring *sp, Player *p) {
  const Entity *e = &sp->o.slot->e;
  const Hitbox *trigger = box_of(sp, 1);
  Hitbox probe = { 0, -TRIGGER_HALF_WIDTH, (int8_t)-(p->offsetY + 1), TRIGGER_HALF_WIDTH, (int8_t)(p->offsetY + 1) };
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!trigger || !collide_overlap(e->x, e->y, trigger, px, py, &probe)) {
    collide_platform(&sp->o, e->x, e->y, box_of(sp, 0), p);
    return 0;
  }
  p->curled = 0; p->airLock = 0;   // even without a launch, and without standing him up
  int upLeft = sp->kind == SPRING_BIG_UPLEFT || sp->kind == SPRING_SMALL_UPLEFT;
  int dir = upLeft && px < e->x - TRIGGER_OUT ? -1 : px > e->x + TRIGGER_OUT ? 1 : 0;
  if (!dir) {
    collide_platform(&sp->o, e->x, e->y, box_of(sp, 0), p);
    return 0;
  }
  p->ysp = p->inverted ? sp->speed : -sp->speed;   // under flipped gravity, still world up
  p->xsp = sp->speed * dir;
  throw_up(sp, p);
  return 1;
}

// under flipped gravity the up and down springs swap handlers (Task_Spring_Normal_Up and _Down)
static int collide(Spring *sp, Player *p) {
  switch (sp->kind) {
    case SPRING_UP: return p->inverted ? down(sp, p) : up(sp, p);
    case SPRING_DOWN: return p->inverted ? up(sp, p) : down(sp, p);
    case SPRING_LEFT: case SPRING_RIGHT: return side(sp, p);
    default: return diagonal(sp, p);
  }
}

static int spring_run(ActTask *t) {
  Spring *sp = (Spring *)t->data;
  Sprite *s = &sp->o.sprite;
  const Entity *e = &sp->o.slot->e;
  int hit = collide(sp, &act.player);
  if (hit) play_song(SE_SPRING);
  if (off_cam(e->x, e->y)) return 0;
  if (sp->launching) {
    // a hit during the launch restarts it, except on the diagonal springs
    if (hit && sp->kind <= SPRING_RIGHT) sprite_start(s, sp->launch);
    if (sprite_step(s)) { sp->launching = 0; sprite_start(s, sp->idle); sprite_step(s); }
  } else if (hit) {
    sp->launching = 1;
    sprite_start(s, sp->launch);   // its first frame shows on the next one
  }
  object_draw(s, e->x, e->y);
  return 1;
}

// --- Angel Island's hidden springs (spring_hiding.c, kind 108) -------------------------------------------------------------
// A spring that shows itself only while it launches. Whenever Sonic's body touches its box it throws him up as an up spring
// does, at d1 * 64 / 256 px a frame, and plays its launch animation where it stood.
typedef struct { Object o; int d0, launching; } HiddenSpring;

static void hidden_throw(HiddenSpring *h, Player *p) {
  p->onObject = NULL; p->air = 1;
  player_end_attack(p);
  p->pushing = 0; p->halfPipe = 0; p->airLock = 0;   // Player_TransitionCancelFlyingAndBoost
  p->state = h->d0 & 1 ? PS_SPRING_RISE : PS_SPRING;
  p->animRestart = 1;
  player_stand_up(p);
}

// sub_8095224: every frame, while his body is in its box, it throws him up again and starts its launch over
static int hidden_hit(HiddenSpring *h, Player *p) {
  Sprite *s = &h->o.sprite;
  const Entity *e = &h->o.slot->e;
  const Hitbox *hb = object_box(s, 0);
  Hitbox body = collide_body(p);
  if (p->dead || p->carried || !hb ||
      !collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) return 0;
  player_land(p);
  p->ysp = -((s8(e->d[1]) << 6) / 256.0);
  hidden_throw(h, p);
  sprite_start(s, 1);
  play_song(SE_SPRING);
  return 1;
}

static int hidden_spring_run(ActTask *t) {
  HiddenSpring *h = (HiddenSpring *)t->data;
  Sprite *s = &h->o.sprite;
  const Entity *e = &h->o.slot->e;
  if (!h->launching) {
    // its launch's first frame shows on the next one
    h->launching = hidden_hit(h, &act.player);
    if (off_cam(e->x, e->y)) return 0;
    return 1;
  }
  hidden_hit(h, &act.player);
  if (sprite_step(s)) {
    h->launching = 0;
    sprite_start(s, 0);
    sprite_step(s);
  }
  if (off_cam(e->x, e->y)) return 0;
  object_draw(s, e->x, e->y);
  return 1;
}

/** CreateEntity_Spring_Hiding: it waits out of sight with its first frame's box, and shows its launch */
ActTask *hidden_spring_spawn(Slot *slot) {
  HiddenSpring *h = OBJECT_NEW(HiddenSpring);
  if (!h) return NULL;
  const Entity *en = &slot->e;
  h->o.slot = slot;
  h->o.x = en->x;
  h->d0 = en->d[0] & 0xFF;
  Sprite *s = &h->o.sprite;
  object_sprite(s, ANIM_SPRING, 0, 1, ORDER_SPRING, PRIORITY_FRONT, 0, 0);
  sprite_step(s);
  return object_task(&h->o, hidden_spring_run, PRIORITY_OBJECTS);
}

ActTask *spring_spawn(Slot *slot) {
  Spring *sp = OBJECT_NEW(Spring);
  if (!sp) return NULL;
  const Entity *en = &slot->e;
  const int look = en->kind - SPRING_UP;
  sp->o.slot = slot;
  sp->o.x = en->x;
  sp->kind = en->kind;
  sp->d0 = en->d[0] & 0xFF;
  sp->speed = launch_speed(sp->d0, en->d[1] & 0xFF);
  sp->idle = LOOKS[look].idle;
  sp->launch = LOOKS[look].launch;
  Sprite *s = &sp->o.sprite;
  object_sprite(s, ANIM_SPRING, sp->idle, sp->launch, ORDER_SPRING, PRIORITY_FRONT, LOOKS[look].flipX, LOOKS[look].flipY);
  if (sp->kind == SPRING_UP && !(sp->d0 & 2)) {
    // the weaker up springs are yellow: they skip the animation's red palette and draw with another, in the next bank
    s->frameFlags |= SPRITE_KEEP_PALETTE;
    s->palId = 1;
    for (int i = 0; i < 16; i++) e.objPalette[YELLOW_BANK * 16 + i] = (uint16_t)rom_u16(sprites.palettes + PALETTE_YELLOW_SPRING * 32 + i * 2);
    e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
  }
  sprite_step(s);
  return object_task(&sp->o, spring_run, PRIORITY_OBJECTS);
}
