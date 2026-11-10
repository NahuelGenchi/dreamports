// Casino Paradise's panel gates, kinds 63 and 64. Translated from the JavaScript version's engine/panelgates.js (the original's
// panel_gate.c): panels that spin open for Sonic going through them one way and are solid the other way, until they shut 125
// frames later. Kind 63 stands upright and opens to him running right (left when d0 is set, mirrored) within 32 px before it;
// kind 64 lies flat and opens to him falling (rising when d0 is set, upside down) within 28 px of it. While one spins, only the
// side he would come back through is solid.

#include "objects.h"
#include "terrain.h"

enum { PANEL_GATE = 63, PANEL_GATE_FLOOR = 64 };
enum {
  ANIM_GATE = 496, ANIM_GATE_FLOOR = 497,   // upright, and lying flat
  ORDER_GATE = 18, PRIORITY_FRONT = 2,
  SE_PANEL_GATE = 185,
  OPEN_FRAMES = 0x7D,       // how long it spins
  STAND_OFFSET_Y = 14,      // PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14): his feet's distance from his centre, upright
  HALF_WIDTH = 6, FLANK_EXTRA = 5,
  UPRIGHT_REACH_Y = 40,     // how far above and below an upright gate's point it works
  UPRIGHT_BEHIND = 32, UPRIGHT_AHEAD = 16,   // from where he runs in, and how far past the point it holds
  FLAT_REACH_X = 32, FLAT_REACH_Y = 28,
  OPEN_SHIFT_X = 6, OPEN_SHIFT_Y = 5,   // how far its box moves for the side he'd come back through
};

typedef struct { Object o; int flat, flip, open, shut, spin; } PanelGate;

static const Hitbox *box_of(const PanelGate *g) { return object_box(&g->o.sprite, 0); }

// Coll_Player_Entity_Intersection with its box moved
static int touches(const PanelGate *g, const Player *p, int x, int y) {
  const Hitbox *hb = box_of(g);
  Hitbox body = collide_body(p);
  return hb && collide_overlap(x, y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body);
}

// Coll_Player_Gate without its attack test (collide.c keeps the sideways push to itself): out to the nearer side of the box, or
// to the other one when the terrain is in the way; walking into it on the ground stops him and stands him up
static void gate_push(const PanelGate *g, Player *p) {
  const Entity *e = &g->o.slot->e;
  const Hitbox *hb = box_of(g);
  if (!hb || p->dead) return;
  if (((p->rotation + 0x20) >> 6) & 1) return;   // not while on a wall
  Hitbox rect = collide_flank(p);
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!collide_overlap(e->x, e->y, hb, px, py, &rect)) return;
  int leftX = e->x + hb->left - rect.right, rightX = e->x + hb->right - rect.left + 1;
  int fromLeft = px <= e->x + ((hb->left + hb->right) >> 1);
  if (fromLeft) {
    p->x = terrain_scan(PROBE_WALL, leftX, py, p->layer, -8).d >= 0 ? leftX : rightX;
    if (p->xsp < 0) return;
  } else {
    p->x = terrain_scan(PROBE_WALL, rightX, py, p->layer, 8).d >= 0 ? rightX : leftX;
    if (p->xsp > 0) return;
  }
  if (p->air || p->attack != 0) { p->xsp = 0; return; }
  if (p->xsp == 0) return;
  p->pushing = 1;
  p->facing = fromLeft ? 1 : -1;
  player_stand_up(p);
  p->gsp = 0; p->xsp = 0;
}

static void opens(PanelGate *g, Player *p) {
  g->open = OPEN_FRAMES;
  sprite_start(&g->o.sprite, g->spin);
  sensors_set_offset_y(p, STAND_OFFSET_Y);
  play_song(SE_PANEL_GATE);
}

// sub_8081C04: run through from the open side, or pushed out of it
static void upright(PanelGate *g, Player *p) {
  const Entity *e = &g->o.slot->e;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  double y = p->y;
  if (py >= e->y - UPRIGHT_REACH_Y && py <= e->y + UPRIGHT_REACH_Y) {
    int from = g->flip ? e->x : e->x - UPRIGHT_BEHIND, to = g->flip ? e->x + UPRIGHT_BEHIND : e->x + UPRIGHT_AHEAD;
    if (px >= from && px <= to) {
      if (g->flip || px <= e->x) {
        if (g->flip ? p->xsp < 0 : p->xsp > 0) opens(g, p);
        else gate_push(g, p);
      } else if (p->xsp < 0) {
        gate_push(g, p);
        p->gsp = 0; p->xsp = 0;
      }
    }
  }
  p->y = y;   // where he was, even after the offset change
}

// sub_8081F50: fallen through from the open side, or solid
static void lying(PanelGate *g, Player *p) {
  const Entity *e = &g->o.slot->e;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  int from = g->flip ? e->y : e->y - FLAT_REACH_Y, to = g->flip ? e->y + FLAT_REACH_Y : e->y;
  if (px >= e->x && px <= e->x + FLAT_REACH_X && py >= from && py <= to && (g->flip ? p->ysp < 0 : p->ysp > 0)) opens(g, p);
  else collide_platform(&g->o, e->x, e->y, box_of(g), p);
}

static int gate_run(ActTask *t) {
  PanelGate *g = (PanelGate *)t->data;
  Sprite *s = &g->o.sprite;
  const Entity *e = &g->o.slot->e;
  Player *p = &act.player;
  if (!g->open) {
    // opening it switches to Task_PanelGate_*2 from the next frame. The original's task goes through every player, dead or not,
    // once for each player alive; with Sonic alone he is tested once
    if (!p->dead) {
      if (g->flat) lying(g, p);
      else upright(g, p);
    }
    if (off_cam(e->x, e->y)) return 0;
    object_draw(s, e->x, e->y);
    return 1;
  }

  if (off_cam(e->x, e->y)) return 0;
  if (!p->dead) {
    // only coming back is stopped
    if (g->flat) {
      if (touches(g, p, e->x, e->y + (g->flip ? OPEN_SHIFT_Y : -OPEN_SHIFT_Y)) && (g->flip ? p->ysp > 0 : p->ysp < 0)) {
        collide_platform(&g->o, e->x, e->y, box_of(g), p);
      }
    } else if (touches(g, p, e->x + (g->flip ? -OPEN_SHIFT_X : OPEN_SHIFT_X), e->y) && (g->flip ? p->xsp > 0 : p->xsp < 0)) {
      gate_push(g, p);
    }
  }
  if (--g->open == 0) sprite_start(s, g->shut);
  sprite_step(s);
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *panel_gate_spawn(Slot *slot) {
  PanelGate *g = OBJECT_NEW(PanelGate);
  if (!g) return NULL;
  const Entity *en = &slot->e;
  g->o.slot = slot;
  g->o.x = en->x;
  g->flat = en->kind == PANEL_GATE_FLOOR;
  g->flip = en->d[0] != 0;
  // the upright gate's variants are shut, then spinning; the flat one's, spinning, then shut
  g->shut = g->flat ? 1 : 0;
  g->spin = g->flat ? 0 : 1;
  object_sprite(&g->o.sprite, g->flat ? ANIM_GATE_FLOOR : ANIM_GATE, 0, 1, ORDER_GATE, PRIORITY_FRONT, !g->flat && g->flip, g->flat && g->flip);
  g->o.sprite.variant = (uint8_t)g->shut;
  sprite_step(&g->o.sprite);   // shut; it is only stepped while open
  return object_task(&g->o, gate_run, PRIORITY_OBJECTS);
}
