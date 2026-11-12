// Casino Paradise's bowls (kind 62). Translated from the JavaScript version's engine/bowls.js (the original's bowl.c): a funnel
// that catches Sonic when his body touches its box (moved 10 px toward him and 5 down), whirls him round its middle, 32 px out,
// starting from where he came in and as fast as he came, faster each frame, while it sinks with him 108 px into the ground. At
// the bottom it spins him 64 times more on a narrowing circle, then drops him out curled up, straight down. It stays sunk until
// it is out of range and back.
//
// The original keeps a catch for each of two players; this act has one, so the second player's part (falling in later, 13 px
// lower down, and then going on at the faster one's speed and depth) never runs and is not here.

#include "objects.h"

enum {
  BOWL = 62,
  ANIM_BOWL = 486, ANIM_BOWL_ANGEL_ISLAND = 546,   // sBowlAnimations by level
  ORDER_BOWL = 5, PRIORITY_FRONT = 2,
  SE_BOWL = 206, SE_BOWL_2 = 207, SE_BOWL_3 = 208,
  HALF_WIDTH = 6,                  // Sonic's spriteOffsetX
  WIDTH = 96,                      // SA1_ANIM_BOWL_3_WIDTH
  REACH = 10, CATCH_DOWN = 5,      // how far its box is moved toward him, and down
  SUNK_DEPTH = 108,                // how deep it sinks, px
  BOTTOM = 885000,                 // the same in 1/8192 px
  SPEED_MASK = 0xFFFF, SPEED_STEP = 64, SPEED_MAX = 0x8000, ANIM_SPEED_MAX = 16,
  RELEASE_SPEED = 0x7D0,           // what the speed is taken from when he is dropped out
  SOUND_2_AT = 56, SOUND_3_AT = 112, SOUND_MAX = 240,   // frames after the catch
  RING_RADIUS = 25, RING_RADIUS_BASE = 50,              // the circle narrows from 32 px as the turns count
  RELEASE_TURNS = 64,
  SINK_TURNS = 16, SINK_PER_TURN = 180,   // he sinks 180/256 px a frame for each turn so far, for 16 turns, then 11.25 px a frame
  QUARTER_BACK = 0x300,            // a quarter turn back, in 1/1024 of a turn
};
static const double SINK_MAX = 11.25;
enum { BOWL_WAITING, BOWL_SPINNING, BOWL_SUNK };

typedef struct {
  Object o;
  int phase;           // waiting (Task_Bowl), spinning with Sonic (Task_BowlRotating) or sunk (Task_Bowl3)
  int turns, t;        // unk50 and unk44
  int caught;          // it has him (unk51)
  int speed, angle;    // unk40 and unk3C
  uint32_t depth;      // unk48, in 1/8192 px
} Bowl;

// Math.round: halves go up
static int js_round(double v) { return (int)__builtin_floor(v + 0.5); }

// Coll_Player_Entity_Intersection with its box moved 10 px toward him
static int touches(const Bowl *b, const Player *p, int y) {
  const Hitbox *hb = object_box(&b->o.sprite, 0);
  if (!hb) return 0;
  Hitbox body = collide_body(p);
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  return collide_overlap(b->o.slot->e.x - (px > b->o.slot->e.x ? REACH : -REACH), y, hb, px, py, &body);
}

// where round it he starts: a quarter turn back, plus how far across it he is, `on` further round
static int start_angle(const Bowl *b, const Player *p, int on) {
  int across = ((int)__builtin_floor(p->x) - b->o.slot->e.x + WIDTH / 2) * 512 / WIDTH;
  return (on + (across < 0 ? QUARTER_BACK - across : QUARTER_BACK + across)) & 0x3FF;
}

// each sound plays once for every player alive
static void sounds(Bowl *b) {
  if (++b->t > SOUND_MAX) b->t = SOUND_MAX;
  if ((b->t == SOUND_2_AT || b->t == SOUND_3_AT) && !act.player.dead) play_song(b->t == SOUND_2_AT ? SE_BOWL_2 : SE_BOWL_3);
}

static int bowl_run(ActTask *t) {
  Bowl *b = (Bowl *)t->data;
  const Entity *en = &b->o.slot->e;
  Sprite *s = &b->o.sprite;
  Player *p = &act.player;
  if (b->phase == BOWL_WAITING) {
    if (off_cam(en->x, en->y)) return 0;
    if (!p->dead && touches(b, p, en->y + CATCH_DOWN)) {
      b->caught = 1;
      int xsp = js_round(p->xsp * 256);
      b->speed = ((xsp < 0 ? -xsp : xsp) << 2) & SPEED_MASK;
      b->angle = start_angle(b, p, 0);
      b->depth = 0; b->turns = 0; b->t = 0;
      player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
      p->state = PS_SPIN; p->carried = 1;
      play_song(SE_BOWL);
      b->phase = BOWL_SPINNING;
    }
    object_draw(s, en->x, en->y);
    return 1;
  }

  if (b->phase == BOWL_SUNK) {
    if (off_cam(en->x, en->y) && off_cam(en->x, en->y + SUNK_DEPTH)) return 0;
    sounds(b);
    object_draw(s, en->x, en->y + SUNK_DEPTH);
    return 1;
  }

  // it sits as deep as he has taken it
  int y = en->y + (int)(b->depth >> 13);
  if (b->caught && !p->dead) {
    int theta = (int)(((b->depth >> 8) + (uint32_t)b->angle + (uint32_t)((b->turns & 0xF) << 6)) & 0x3FF);
    p->x = en->x + (int)((double)SINE[theta] * RING_RADIUS / (b->turns * 4 + RING_RADIUS_BASE)) / 256.0;
    p->y = en->y - 17 + (double)(b->depth >> 5) / 256.0;
  }
  if (b->caught) {
    if (b->depth >= BOTTOM) { if (!p->dead) p->ysp = ((b->speed >> 2) - RELEASE_SPEED) * 2 / 256.0; }
    else b->speed = (b->speed + SPEED_STEP) & SPEED_MASK;
    if (b->speed > SPEED_MAX) b->speed = SPEED_MAX;
    int anim = b->speed * 35 / 0xA000;
    s->animSpeed = (uint8_t)(anim < ANIM_SPEED_MAX ? anim : ANIM_SPEED_MAX);
    b->depth += (uint32_t)b->speed;
  }
  if (off_cam(en->x, en->y) && off_cam(en->x, y)) {
    // (the fix for the original's bug that leaves him held when it goes, #88, is off in a proof run and not here)
    return 0;
  }

  if (b->caught && b->depth >= BOTTOM) {
    b->depth = BOTTOM;
    if (!p->dead) p->y += b->turns < SINK_TURNS ? b->turns * SINK_PER_TURN / 256.0 : SINK_MAX;
    b->turns++;   // only Sonic's turns count
    if (b->turns > RELEASE_TURNS) {
      if (!p->dead) {
        // out of the bottom: curled up, falling, and his controls in the air locked
        p->carried = 0; p->curled = 1; p->airLock = 1; p->air = 1;
        p->xsp = 0; p->gsp = 0; p->x = en->x;
        b->caught = 0;
      }
      b->phase = BOWL_SUNK;
    }
  }
  sounds(b);
  sprite_step(s);
  object_draw(s, en->x, y);
  return 1;
}

ActTask *bowl_spawn(Slot *slot) {
  Bowl *b = OBJECT_NEW(Bowl);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, act.stage.level == LEVEL_ANGEL_ISLAND_1 ? ANIM_BOWL_ANGEL_ISLAND : ANIM_BOWL, 0, 0, ORDER_BOWL, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);   // its first frame, kept until it starts spinning
  return object_task(&b->o, bowl_run, PRIORITY_OBJECTS);
}
