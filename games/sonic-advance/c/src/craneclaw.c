// Secret Base's crane claws (kind 80). Translated from the JavaScript version's engine/craneclaws.js (the original's
// crane_claw_and_lift.c): a claw hanging 48 px down on its cable from a trolley. Sonic's body touching its box catches him: it
// closes for 4 frames, lifts him 48 px over 30, carries him right at 2 px a frame until it has gone more than d2 tiles, opens to
// drop him and, 30 frames later, goes back left at the same speed and down again.
//
// It tests the box its last frame set, before stepping its animation, so it can't catch him on the frame it is made. Its cable is
// one sprite drawn twice, stepped before each drawing. It goes once its spawn point is out of the display's range and the claw out
// of the camera's, even while it carries him, and then neither lets go of him nor stops the lift's sound.

#include "objects.h"

enum {
  ANIM_CLAW = 498, VARIANT_OPEN = 0, VARIANT_CLOSE = 1, VARIANT_LET_GO = 2, VARIANT_CABLE = 3,   // SA1_ANIM_CRANE_CLAW_2
  ANIM_TROLLEY = 503, VARIANT_TROLLEY = 0,                                                       // SA1_ANIM_ANCHOR_HANDLES
  CLAW_TILES = 30, CABLE_TILES = 3, TROLLEY_TILES = 1,   // ALLOC_TILES of the whole claw, of its cable variant, of the trolley
  ORDER_CLAW = 15, ORDER_CABLE = 17, PRIORITY_FRONT = 2,
  SE_LIFT = 181,
  DROP = 48,                 // the claw's way down from the trolley
  CABLE_PIECE = 24,          // where the cable's second piece hangs while the claw is down
  HELD_DOWN = 104,           // Sonic's centre below the trolley while it closes on him
  HELD_UP = 56,              // and below the claw once it lifts him
  CLOSE = 4, LIFT = 30, WAIT = 30, SETTLE = 3,   // frames it closes, goes up or down, stays open and settles
  SPEED = 2,                 // px a frame along
};
enum { WAITING, CLOSING, LIFTING, CARRYING, OPEN, RETURNING, LOWERING, SETTLING };

typedef struct {
  Object o;   // the claw
  Sprite cable, trolley;
  int phase, t, moved;   // unk9C counts each phase's frames, and the frames of its trip along
  int caught;            // playerID: whether it has him
} Claw;

// Player_TransitionCancelFlyingAndBoost; his speeds and whether he is in the air stay as they were
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

// held still, hanging (charState 38)
static void hang(Player *p) {
  if (p->dead) return;
  p->xsp = p->gsp = p->ysp = 0;
  cancel(p);
  p->state = PS_HOOK;
}

// Coll_Player_Entity_Intersection: his body's box against the claw's first hitbox
static int touches(const Sprite *s, int x, int y, const Player *p) {
  const Hitbox *box = object_box(s, 0);
  Hitbox body = collide_body(p);
  return !p->dead && box && collide_overlap(x, y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body);
}

// its spawn point out of the display's range and the claw at (cx, cy) out of the camera's
static int gone(int x, int y, int cx, int cy) { return off_display(x, y) && off_cam(cx, cy); }

static void show(Sprite *s, int x, int y) { sprite_step(s); object_draw(s, x, y); }

// the claw `down` px below the trolley, with the cable down to it in two pieces, the second `cableY` down
static void hanging(Claw *c, int x, int y, int down, int cableY) {
  show(&c->o.sprite, x, y + down);
  show(&c->cable, x, y);
  show(&c->cable, x, y + cableY);
  show(&c->trolley, x, y);
}

// the claw pulled up to the trolley, `dx` px along
static void along(Claw *c, int x, int y, int dx) {
  show(&c->o.sprite, x + dx, y);
  show(&c->trolley, x + dx, y);
}

static int claw_run(ActTask *t) {
  Claw *c = (Claw *)t->data;
  const Entity *en = &c->o.slot->e;
  Player *p = &act.player;
  int x = en->x, y = en->y;
  switch (c->phase) {
  case WAITING:   // Task_CraneClawMain
    if (touches(&c->o.sprite, x, y + DROP, p)) {
      c->t = 0;
      c->o.sprite.variant = VARIANT_CLOSE;   // the variant alone: its animation starts over as it changes
      p->carried = 1;
      c->caught = 1;
      c->phase = CLOSING;
      play_song(SE_LIFT);
    }
    if (gone(x, y, x, y + DROP)) return 0;
    hanging(c, x, y, DROP, CABLE_PIECE);
    return 1;
  case CLOSING:
    if (!p->dead) { p->x = x; p->y = y + HELD_DOWN; }
    if (++c->t >= CLOSE) { c->t = 0; hang(p); c->phase = LIFTING; }
    if (gone(x, y, x, y + DROP)) return 0;
    hanging(c, x, y, DROP, CABLE_PIECE);
    return 1;
  case LIFTING: {
    int down = (int16_t)((LIFT - c->t) * DROP / LIFT);
    if (!p->dead) { p->x = x; p->y = y + down + HELD_UP; }
    if (++c->t > LIFT) { c->t = 0; hang(p); c->phase = CARRYING; }
    if (gone(x, y, x, y + down)) return 0;
    hanging(c, x, y, down, down >> 1);
    return 1;
  }
  case CARRYING: {
    int dx = (int16_t)(c->moved * SPEED);
    if (!p->dead) { p->x = x + dx; p->y = y + HELD_UP; }
    if (dx > en->d[2] * 8) {
      // it lets go of him where he is, his state as it was but for the spring's top-out pose (charState 18)
      if (!p->dead) { p->carried = 0; p->xsp = p->gsp = p->ysp = 0; cancel(p); p->state = PS_SPRING_PEAK; }
      c->t = 0;
      c->o.sprite.variant = VARIANT_LET_GO;
      stop_song(SE_LIFT);
      c->phase = OPEN;
    } else c->moved++;
    if (gone(x, y, x + dx, y)) return 0;
    along(c, x, y, dx);
    return 1;
  }
  case OPEN:
    if (gone(x, y, x + c->moved * SPEED, y)) return 0;
    if (++c->t > WAIT) c->phase = RETURNING;
    along(c, x, y, c->moved * SPEED);
    return 1;
  case RETURNING: {
    int dx = c->moved * SPEED;
    if (c->moved == 0) { c->t = 0; c->phase = LOWERING; } else c->moved--;
    if (gone(x, y, x + dx, y)) return 0;
    along(c, x, y, dx);
    return 1;
  }
  case LOWERING: {
    int down = DROP - (LIFT - c->t) * DROP / LIFT;
    if (++c->t > LIFT) { c->t = 0; c->phase = SETTLING; }
    if (gone(x, y, x, y + down)) return 0;
    hanging(c, x, y, down, down >> 1);
    return 1;
  }
  default:   // SETTLING
    if (++c->t > SETTLE) { c->t = 0; c->caught = 0; c->phase = WAITING; }
    if (gone(x, y, x, y + DROP)) return 0;
    hanging(c, x, y, DROP, CABLE_PIECE);
    return 1;
  }
}

static void claw_end(ActTask *t) {
  Claw *c = (Claw *)t->data;
  object_sprite_free(&c->cable);
  object_sprite_free(&c->trolley);
  object_end(t);
}

// CreateEntity_CraneClaw: its sprites' animations don't step as it is made
ActTask *crane_claw_spawn(Slot *slot) {
  Claw *c = OBJECT_NEW(Claw);
  if (!c) return NULL;
  c->o.slot = slot;
  c->o.x = slot->e.x;
  object_sprite_at(&c->o.sprite, vram_malloc(CLAW_TILES), ANIM_CLAW, VARIANT_OPEN, ORDER_CLAW, PRIORITY_FRONT, 0, 0);
  object_sprite_at(&c->cable, vram_malloc(CABLE_TILES), ANIM_CLAW, VARIANT_CABLE, ORDER_CABLE, PRIORITY_FRONT, 0, 0);
  object_sprite_at(&c->trolley, vram_malloc(TROLLEY_TILES), ANIM_TROLLEY, VARIANT_TROLLEY, ORDER_CABLE, PRIORITY_FRONT, 0, 0);
  ActTask *t = object_task(&c->o, claw_run, PRIORITY_OBJECTS);
  if (!t) { object_sprite_free(&c->cable); object_sprite_free(&c->trolley); }
  else t->end = claw_end;
  return t;
}
