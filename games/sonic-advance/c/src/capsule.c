// The capsule a beaten boss leaves, as it ends a zone's second act. Translated from the JavaScript version's engine/capsule.js
// (the original's bosses_misc.c: CreateBossCapsule and the tasks it runs).
//
// It rises from the boss small and spinning, growing to full size, then drops into the middle of the screen, shaking it;
// landing on Sonic, it knocks him aside. It is solid, and Sonic landing on its switch opens it: the clock and the rings stop,
// he loses his controls and walks off to whichever side of the screen he is on, the shell flies off in two halves and the
// zone's animals jump out, two kinds hopping about and two birds circling. Once he stands in his act-clear pose, a second after
// it plays through (or four seconds after he stops), the act's results start. Positions are whole pixels in the act and speeds
// 1/256 px a frame, as the original keeps them. Amy's hammer on the switch and the CPU partner are left out with the
// characters.

#include "bosses.h"

enum {
  ANIM_SMALL = 578, ANIM_CAPSULE = 575, CAPSULE_SHUT = 0, CAPSULE_OPENING = 1, CAPSULE_OPEN = 2,
  ANIM_SWITCH = 576, ANIM_SHELL = 577,
  CAPSULE_TILES = 81, SWITCH_TILES = 6, SHELL_TILES = 0x40, ANIMAL_TILES = 4,
  CAPSULE_ORDER = 19, SWITCH_ORDER = 20,
  GROW_MATRIX = 0x10,                          // the grow's own rotation matrix
  CENTRE = DISPLAY_WIDTH / 2,
  RISE_SPEED = 0x800, RISE_SLOW = 0x10, RISEN = 0xE0, GROW_FROM = 0x40, GROW_STEP = 8, FULL = 0x100, SPIN = 0x10,
  DROP_TEST = 96, FLOOR_BELOW = 8,
  KNOCK_X = 2, KNOCK_Y = 0x4E0,
  SONIC_HALF_WIDTH = 6,                        // his spriteOffsetX
  SWITCH_SINK = 4,
  SHELL_VX = 0x100, SHELL_VY = -0x200, SHELL_SPIN = 4, SHELL_FRAMES = 0x3C,
  WALK_RIGHT_END = 200, WALK_LEFT_END = 40, POSE_AFTER = 60, POSE_WAIT = 240,
  ANIMALS_ABOVE = 32, ANIMAL_LOTS = 12, LAST_LOT = 5,
  ANIM_ROBIN = 0x1C0, ANIM_PARROT = 0x1BA,
  HOPPER_ORDER = 15, BIRD_FAR_ORDER = 17, BIRD_FLAGS = 0x70, BIRD_OAM = 0x500,
  HOP_UP = -0x400, HOP_ACROSS = 0x100, HOP_GRAVITY = 40, HOP_TURN = 32,
  BOB = 0x10, BIRD_ABOVE = 32,
  SE_CAPSULE_LANDS = 136, SE_CAPSULE_OPENS = 137,
};

// gUnknown_080BB43C, by zone: its first two columns are the hopping animals; the third is never read
static const uint16_t ZONE_ANIMALS[][2] = {
  {438, 449},   // Neo Green Hill: gorilla, kangaroo
  {438, 447},   // Secret Base: gorilla, skunk
  {439, 446},   // Casino Paradise: peacock, deer
  {443, 444},   // Ice Mountain: penguin, rabbit
  {447, 449},   // Angel Island: skunk, kangaroo
};

typedef struct Capsule Capsule;
typedef int (*Phase)(Capsule *);
struct Capsule {
  Object o;            // the capsule
  Object sw;           // its switch
  Transform tf;        // the grow's turn and scale
  Phase phase;
  int x, y;            // in the act (worldX, worldY)
  int speed, rise;     // the rise's speed (unk74) and how far it has risen (offsetY)
};

static int drop(Capsule *c);
static int closed(Capsule *c);
static int opening(Capsule *c);
static int open(Capsule *c);

static const Hitbox *box(const Sprite *s) { return object_box(s, 0); }
static int sonic_x(void) { return enemy_sonic_x(); }
static int sonic_y(void) { return enemy_sonic_y(); }

// Task_BossCapsuleInit: rising small and spinning, growing until it is full size
static int grow(Capsule *c) {
  Sprite *s = &c->o.sprite;
  c->tf.x = (int16_t)(c->x - cam_x());
  c->tf.y = (int16_t)(c->y - cam_y() - c->rise);
  if (c->tf.qScaleX < FULL) c->tf.qScaleY = c->tf.qScaleX = (int16_t)(c->tf.qScaleX + GROW_STEP);
  c->tf.rotation = (uint16_t)(c->tf.rotation + SPIN);
  update_sprite(s, 0);
  transform_sprite(s, &c->tf);
  if (objects_drawing()) display_sprite(s);
  c->speed = s16(c->speed - RISE_SLOW);
  c->rise = s16(c->rise + enemy_i(c->speed));
  if (c->rise > RISEN) {
    c->phase = drop;
    s->graphics.anim = ANIM_CAPSULE;
    s->variant = CAPSULE_SHUT;
    s->frameFlags &= ~(uint32_t)SPRITE_ROT_SCALE_ENABLE;
  }
  return 1;
}

// Coll_Player_Entity_Intersection: Sonic's own rectangle on the sprite's box at the capsule
static int touches(Capsule *c, const Sprite *s) {
  Player *p = &act.player;
  const Hitbox *b = box(s);
  if (!b || p->dead) return 0;
  Hitbox him = { 0, -SONIC_HALF_WIDTH, (int8_t)-p->offsetY, SONIC_HALF_WIDTH, (int8_t)p->offsetY };
  return collide_overlap(c->x, c->y, b, sonic_x(), sonic_y(), &him);
}

// Task_801623C: dropping in the middle of the screen until it meets the floor; there it shakes the screen and knocks Sonic
// aside if it lands on him, to the capsule's side nearer where he was
static int drop(Capsule *c) {
  Sprite *s = &c->o.sprite, *s2 = &c->sw.sprite;
  int sy = s16(c->y - cam_y() - c->rise);
  s->x = s2->x = CENTRE;
  s->y = s2->y = (int16_t)sy;
  if (sy >= 0) {
    update_sprite(s, 0);
    update_sprite(s2, 0);
    if (objects_drawing()) { display_sprite(s); display_sprite(s2); }
  }
  c->speed = s16(c->speed - RISE_SLOW);
  c->rise = s16(c->rise + enemy_i(c->speed));
  if (sy < DROP_TEST) return 1;
  int d = terrain_tile_floor(cam_x() + CENTRE, cam_y() + sy + FLOOR_BELOW, 1, 8);
  if (d > 0) return 1;
  c->y = s16(c->y - c->rise + d);
  c->x = cam_x() + CENTRE;
  c->phase = closed;
  boss_shake(0x800, 0x40, 0x100, -1, SHAKE_VERTICAL);
  play_song(SE_CAPSULE_LANDS);
  Player *p = &act.player;
  if (touches(c, s) || touches(c, s2)) {
    int left = sonic_x() < cam_x() + CENTRE;
    player_knock_aside(p, left ? -KNOCK_X : KNOCK_X, -KNOCK_Y / 256.0);
    const Hitbox *b = box(s);
    if (b) {
      int side = left ? c->x + b->left - SONIC_HALF_WIDTH : c->x + b->right + SONIC_HALF_WIDTH;
      if (left ? sonic_x() > side : sonic_x() < side) p->x = side;
    }
  }
  return 1;
}

// --- the walk-off (sub_801766C, Task_8017334, Task_8017400) ------------------------------------------------------------------
// Sonic walks off to the side of the screen he is on, to 200 px or 40 px from its left, and stands in the act-clear pose facing
// left; the results come a second after it plays through, or four seconds after he stops if it never does.
typedef struct { Object o; int posing, after, waited; } WalkOff;

static int walk_off_run(ActTask *t) {
  WalkOff *w = (WalkOff *)t->data;
  Player *p = &act.player;
  if (w->posing) {
    if (!p->air) p->state = PS_ACT_CLEAR_POSE;
    if ((p->sprite.frameFlags & SPRITE_ANIM_OVER) && w->after++ > POSE_AFTER) { act_stage_results(0); return 0; }
    if (w->after == 0 && w->waited++ > POSE_WAIT) { act_stage_results(0); return 0; }
    return 1;
  }
  int sx = s16(sonic_x() - cam_x()), right = sx > CENTRE;
  p->ignoreInput = 1;
  p->heldRight = right; p->heldLeft = !right;
  if (right ? sx > WALK_RIGHT_END : sx < WALK_LEFT_END) {
    p->gsp = 0; p->xsp = 0;
    p->heldRight = p->heldLeft = 0;
    p->facing = -1;
    p->state = PS_ACT_CLEAR_POSE; p->actClear = 1;
    w->posing = 1;
  }
  return 1;
}

static void walk_off(void) {
  WalkOff *w = OBJECT_NEW(WalkOff);
  if (!w) return;
  w->o.sprite.graphics.dest = HEAP_END;
  object_task(&w->o, walk_off_run, PRIORITY_OBJECTS);
}

// --- the animals (sub_801749C, Task_8016B6C) ---------------------------------------------------------------------------------
// sub_8016D80 and sub_8016E54: it jumps 4 px a frame up and 1 px a frame across plus a random part, falls 40/256 px a frame
// faster each frame and jumps again from the floor, turning back once it is 32 px out either way
typedef struct { Object o; int x, y, vx, vy, jump, dx, dy; } Hopper;

static int hopper_run(ActTask *t) {
  Hopper *h = (Hopper *)t->data;
  Sprite *s = &h->o.sprite;
  h->vy = s16(h->vy + HOP_GRAVITY);
  h->dy += h->vy;
  h->dx += h->vx;
  if (h->vy > 0 && terrain_tile_floor(h->x + enemy_i(h->dx), h->y + enemy_i(h->dy), 1, 8) < 0) {
    h->vy = h->jump;
    if (enemy_i(h->dx) < -HOP_TURN && h->vx < 0) h->vx = -h->vx;
    else if (enemy_i(h->dx) > HOP_TURN && h->vx > 0) h->vx = -h->vx;
  }
  if (h->vx < 0) s->frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  else s->frameFlags |= SPRITE_X_FLIP;
  s->x = (int16_t)(enemy_i(h->dx) + h->x - cam_x());
  s->y = (int16_t)(enemy_i(h->dy) + h->y - cam_y());
  update_sprite(s, 0);
  if (objects_drawing()) display_sprite(s);
  return 1;
}

// the random number is drawn after the animal is made, and returned for the next one to use
static uint32_t hopper(int x, int y, int anim, int flipped) {
  Hopper *h = OBJECT_NEW(Hopper);
  if (h) {
    object_sprite_at(&h->o.sprite, vram_malloc(ANIMAL_TILES), anim, 0, HOPPER_ORDER, ENEMY_PRIORITY, 0, 0);
    h->x = x; h->y = y;
    if (!object_task(&h->o, hopper_run, PRIORITY_OBJECTS)) h = NULL;
  }
  uint32_t r = act_random();
  if (h) {
    h->vx = HOP_ACROSS + (int)(r & 0xFF);
    if (flipped) h->vx = -h->vx;
    h->vy = h->jump = HOP_UP + (int)((r & 0x1F00) >> 4);
  }
  return r;
}

// sub_8016F44 and sub_8017054: it circles 64 px either side of the capsule, bobbing 16 px up and down, its size going with how
// near it is, in front of Sonic on the near half and behind him on the far one, while it sinks or rises 1 px a frame to 32 px
// above where he was when it came out
typedef struct { Object o; Transform tf; int x, y, toY, bob, turn, step; } Bird;

static int bird_run(ActTask *t) {
  Bird *b = (Bird *)t->data;
  Sprite *s = &b->o.sprite;
  b->bob = (b->bob + BOB) & 0x3FF;
  b->turn = (b->turn + b->step) & 0x3FF;
  int dy = SINE[b->bob] >> 2, dx = SINE[b->turn];
  int scale = s16((SINE[b->turn + 256] >> 8) + 0x100);
  b->tf.qScaleY = (int16_t)scale;
  s->oamFlags = (scale > 0x100 ? HOPPER_ORDER : BIRD_FAR_ORDER) << 6;
  int back = ((b->turn - 0x100) & 0x200) != 0;
  b->tf.qScaleX = (int16_t)((b->step > 0) == back ? -scale : scale);
  int to = s16(b->y - b->toY);
  if (to > 0) b->y--;
  else if (to < 0) b->y++;
  b->tf.x = (int16_t)(b->x + enemy_i(dx) - cam_x());
  b->tf.y = (int16_t)(b->y + enemy_i(dy) - cam_y());
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix();
  update_sprite(s, 0);
  transform_sprite(s, &b->tf);
  if (objects_drawing()) display_sprite(s);
  return 1;
}

static Bird *bird(int x, int y, int anim) {
  Bird *b = OBJECT_NEW(Bird);
  if (!b) return NULL;
  object_sprite_at(&b->o.sprite, vram_malloc(ANIMAL_TILES), anim, 0, 0, ENEMY_PRIORITY, 0, 0);
  b->o.sprite.oamFlags = BIRD_OAM;
  b->o.sprite.frameFlags |= BIRD_FLAGS;
  b->tf = (Transform){ 0, 0x100, 0x100, 0, 0 };
  b->x = x; b->y = y;
  return object_task(&b->o, bird_run, PRIORITY_OBJECTS) ? b : NULL;
}

// its speed round, 1 to 8 steps a frame, the other way round from the far side for every other lot
static void bird_set(Bird *b, int speed, int flipped) {
  if (!b) return;
  b->step = 1 + speed;
  if (flipped) { b->step = -b->step; b->turn = 0x200; }
  b->toY = sonic_y() - BIRD_ABOVE;
}

// four at a time every four frames, four times, the last time without the first kind or a robin; each draws on the game's
// random numbers (the parrot on the robin's, or the second hopper's), and every other lot goes the other way
typedef struct { Object o; int x, y, n, lot; } Animals;

static int animals_run(ActTask *t) {
  Animals *a = (Animals *)t->data;
  if ((a->n++ & 3) == 0) {
    uint32_t zone = (uint32_t)(act.stage.level >> 1);
    int odd = a->lot & 1, x = a->x, y = a->y - ANIMALS_ABOVE;
    uint32_t r = 0;
    if (a->n != LAST_LOT) r = hopper(x, y, ZONE_ANIMALS[zone][0], odd);
    r = hopper(x, y, ZONE_ANIMALS[zone][1], !odd);
    if (a->n != LAST_LOT) {
      Bird *robin = bird(x, y, ANIM_ROBIN);
      r = act_random();
      bird_set(robin, (int)(r & 7), odd);
    }
    Bird *parrot = bird(x, y, ANIM_PARROT);
    bird_set(parrot, (int)((r >> 8) & 7), odd);
    a->lot++;
  }
  return a->n <= ANIMAL_LOTS;
}

static void animals(int x, int y) {
  Animals *a = OBJECT_NEW(Animals);
  if (!a) return;
  a->o.sprite.graphics.dest = HEAP_END;
  a->x = x; a->y = y;
  object_task(&a->o, animals_run, PRIORITY_OBJECTS);
}

// --- the capsule's phases ----------------------------------------------------------------------------------------------------
// the capsule or its switch (at the switch's height + dy for the switch) as a solid object for Sonic, unless he is hurt; it
// stands where the capsule is, which is where Sonic balancing on it finds its sides (Player_8044D74 reads its sprite's place)
static int solid(Capsule *c, Object *o, int dy) {
  o->x = c->x;
  return collide_platform(o, c->x, c->y + dy, box(&o->sprite), &act.player);
}

// Task_BossCapsuleUpdate: shut, until Sonic lands on the switch. Pushed down by the capsule or below its bottom, he is put at its
// bottom left corner.
static int closed(Capsule *c) {
  Sprite *s = &c->o.sprite, *s2 = &c->sw.sprite;
  Player *p = &act.player;
  update_sprite(s, 0);
  update_sprite(s2, 0);
  boss_display(s, c->x - cam_x(), c->y - cam_y());
  boss_display(s2, c->x - cam_x(), c->y - cam_y());
  int pressed = 0;
  if (p->state != PS_HURT) {
    int before = sonic_y();
    solid(c, &c->o, 0);
    if (!p->dead && (before < sonic_y() || c->y < sonic_y())) {
      const Hitbox *b = box(s);
      if (b) p->x = c->x + b->left - SONIC_HALF_WIDTH;
      p->y = c->y - p->offsetY;
    }
    if (solid(c, &c->sw, 0) & COLLIDE_LANDED) pressed = 1;
  }
  if (pressed) {
    c->phase = opening;
    act.clockStopped = 1;
    act.ringsStopped = 1;
    s->variant = CAPSULE_OPENING;
    play_song(SE_CAPSULE_OPENS);
    p->gsp = 0;
    p->ignoreInput = 1;
    p->heldRight = p->heldLeft = 0;
    walk_off();
  }
  return 1;
}

// Task_8016650: the switch sinks 4 px and the capsule opens; then the shell's halves fly off and the animals come out
static int opening(Capsule *c) {
  Sprite *s = &c->o.sprite, *s2 = &c->sw.sprite;
  Player *p = &act.player;
  int ended = !update_sprite(s, 0);
  update_sprite(s2, 0);
  if (p->state != PS_HURT) { solid(c, &c->o, 0); solid(c, &c->sw, SWITCH_SINK); }
  boss_display(s, c->x - cam_x(), c->y - cam_y());
  boss_display(s2, c->x - cam_x(), c->y + SWITCH_SINK - cam_y());
  if (!ended) return 1;
  if (p->onObject == &c->sw) { p->onObject = NULL; p->air = 1; }
  c->phase = open;
  s->variant = CAPSULE_OPEN;
  for (int i = 0; i < 2; i++) {
    BossPart *b = boss_part(c->x, c->y, SHELL_TILES, ANIM_SHELL, 0);
    if (!b) continue;
    b->vx = i ? SHELL_VX : -SHELL_VX;
    b->vy = SHELL_VY; b->grow = 0; b->spin = SHELL_SPIN; b->frames = SHELL_FRAMES;
    if (i) b->tf.qScaleX = -0x100;
  }
  animals(c->x, c->y);
  return 1;
}

// Task_801685C: open, a ledge Sonic can stand on
static int open(Capsule *c) {
  Sprite *s = &c->o.sprite;
  update_sprite(s, 0);
  if (act.player.state != PS_HURT) solid(c, &c->o, 0);
  boss_display(s, c->x - cam_x(), c->y - cam_y());
  return 1;
}

static int capsule_run(ActTask *t) {
  Capsule *c = (Capsule *)t->data;
  return c->phase(c);
}

static void capsule_end(ActTask *t) {
  Capsule *c = (Capsule *)t->data;
  object_sprite_free(&c->sw.sprite);
  object_end(t);
}

void boss_capsule(int x, int y) {
  Capsule *c = OBJECT_NEW(Capsule);
  if (!c) return;
  c->x = x; c->y = y;
  c->speed = RISE_SPEED;
  c->phase = grow;
  c->sw.sprite.graphics.dest = HEAP_END;
  object_sprite_at(&c->o.sprite, vram_malloc(CAPSULE_TILES), ANIM_SMALL, 0, CAPSULE_ORDER, ENEMY_PRIORITY, 0, 0);
  c->o.sprite.frameFlags |= SPRITE_ROT_SCALE_ENABLE | GROW_MATRIX;
  c->tf = (Transform){ 0, GROW_FROM, GROW_FROM, 0, 0 };
  if (!boss_task(&c->o, capsule_run, capsule_end, PRIORITY_OBJECTS)) return;
  object_sprite_at(&c->sw.sprite, vram_malloc(SWITCH_TILES), ANIM_SWITCH, 0, SWITCH_ORDER, ENEMY_PRIORITY, 0, 0);
}
