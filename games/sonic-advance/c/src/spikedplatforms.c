// Spiked platforms (kind 61). Translated from the JavaScript version's engine/spikedplatforms.js (the original's
// platform_spiked.c, Task_Platform_Spiked): a solid block with spikes on its top (d0 0) or its bottom (any other d0) that swings
// to and fro with the stage clock as a thin platform does: across when d2 is above d3 and up and down otherwise, by d2 (d3) * 8
// px either side, once every 256 frames; a negative d0 (d1) starts it half a swing on. Landing on its spikes, or hitting them
// from below, hurts Sonic; the other face carries him. Squeezed into a wall or a ceiling by it, he dies on the spot. Casino
// Paradise's (zone 3) look their own and have their spikes up whatever d0 is.

#include "objects.h"
#include "terrain.h"

enum {
  SPIKED_PLATFORM = 61,
  ORDER_PLATFORM = 18, PRIORITY_FRONT = 2,
  ZONE_CASINO_PARADISE = 2, LEVEL_CHAO_HUNT_C = 16,   // the zone and the level whose platforms are Casino's
  ANIM_CASINO = 521, ANIM_SPIKES_UP = 538, ANIM_SPIKES_DOWN = 539,
  SWING_HALF = 0x80,       // the stage clock frames of half a swing
  HALF_WIDTH = 6,          // Sonic's spriteOffsetX
  PUSH_OUT_SLACK = 8,      // how far in from its edges the sides put him out to the nearer one
  CARRIED_WALL_OUT = 4,    // how far right of his centre the wall is looked for when it carries him right
  CEILING_ABOVE = 5,       // how far over his centre the ceiling is looked for
  SIDE_PUSH = 2,           // how far holding toward its moving side moves him into it
  LANDING_RAISE = 8,       // it is tested as if 8 px higher, and he is then put 8 px down onto it
};

/** The terrain's one-tile probe along either axis (sub_801F100): terrain.c's terrain_tile_floor, for walls too. */
int terrain_tile_scan(int probe, int p0, int p1, int layer, int step);

typedef struct {
  Object o;
  int y;               // where its box is this frame (Object has the x)
  int up;              // its spikes are on top (facingUp)
  int across, phase, reach;
  int offset;          // how far it is from its place, in 1/256 px (qUnk3C)
  int riding;          // he stands on its top (unk4E)
  int beside;          // he touched its sides or bottom (unk4F)
} Spiked;

static int floor_of(double v) { return (int)__builtin_floor(v); }

// he dies where he is (MOVESTATE_DEAD, with no hurt first)
static void crush(Player *p) { p->pushing = 0; p->dead = 1; }

// sub_80805C8: with his flank box (the wider, shorter one that finds what is beside him) in the platform's box, it puts him out at
// the side he is within 8 px of, stopping him if he was moving into it, then up out of any ground under and over his centre, and
// he is no longer pushing or standing on anything. Deeper in, it leaves him be.
static void push_out(const Spiked *sp, Player *p) {
  const Hitbox *hb = object_box(&sp->o.sprite, 0);
  Hitbox rect = collide_flank(p);
  int px = floor_of(p->x);
  if (!hb || !collide_overlap(sp->o.x, sp->y, hb, px, floor_of(p->y), &rect)) return;
  if (px <= sp->o.x + hb->left - rect.right + PUSH_OUT_SLACK) {
    p->x = sp->o.x + hb->left - rect.right;
    if (p->xsp > 0) { p->gsp = 0; p->xsp = 0; }
  } else if (px >= sp->o.x + hb->right - rect.left - PUSH_OUT_SLACK) {
    p->x = sp->o.x + hb->right - rect.left;
    if (p->xsp < 0) { p->gsp = 0; p->xsp = 0; }
  } else return;
  int d = terrain_scan(PROBE_FLOOR, floor_of(p->y) + 9, floor_of(p->x), p->layer, 8).d;
  if (d < 0) p->y += d;
  d = terrain_scan(PROBE_FLOOR, floor_of(p->y), floor_of(p->x), p->layer, -8).d;
  if (d < 0) p->y += d;
  p->pushing = 0; p->onObject = NULL;
}

static void spiked_collide(Spiked *sp, Player *p, int moved) {
  const Hitbox *hb = object_box(&sp->o.sprite, 0);
  int x = sp->o.x, y = sp->y;
  double prevX = p->x;
  if (sp->riding) {
    // it carries him by what it moved, plus 1 px down, which its top then puts him back from; the terrain at his centre puts him
    // out on the side it moves him to, and the ceiling over it crushes him while it moves up and down
    if (sp->across) p->x += moved / 256.0;
    p->y += 1 + (sp->across ? 0 : moved / 256.0);
    int dx = sp->across ? moved : 0;
    if (dx > 0) {
      int d = terrain_tile_scan(PROBE_WALL, floor_of(p->x) + CARRIED_WALL_OUT, floor_of(p->y), p->layer, 8);
      if (d < 0) p->x += d;
    } else {
      int d = terrain_tile_scan(PROBE_WALL, floor_of(p->x), floor_of(p->y), p->layer, -8);
      if (d < 0) p->x -= d;
    }
    Hitbox body = collide_body(p);
    if (terrain_tile_floor(floor_of(p->x), floor_of(p->y) - CEILING_ABOVE, p->layer, -8) < 0) {
      if (!sp->across) { p->x = prevX; crush(p); }
    } else if (!hb || !collide_overlap(x, y, hb, floor_of(p->x), floor_of(p->y), &body)) sp->riding = 0;
  } else {
    push_out(sp, p);
    double px = p->x, py = p->y;
    int flags = collide_platform(&sp->o, x, y, hb, p);
    if (flags & (COLLIDE_FROM_BELOW | COLLIDE_LEFT_FACE | COLLIDE_RIGHT_FACE)) {
      sp->beside = 1;
      if (flags & COLLIDE_RIGHT_FACE) {
        // at a side of one that moves across, holding toward it on the ground moves him 2 px into it, and with his centre in a
        // wall he is crushed; what's held is the pad (gInput)
        if (sp->across) {
          if ((e.input & KEY_LEFT) && !p->air) { p->x -= SIDE_PUSH; p->pushing = 1; }
          if (terrain_tile_scan(PROBE_WALL, floor_of(p->x), floor_of(p->y), p->layer, -8) < 0) crush(p);
        }
      } else if (flags & COLLIDE_LEFT_FACE) {
        if (sp->across) {
          if ((e.input & KEY_RIGHT) && !p->air) { p->x += SIDE_PUSH; p->pushing = 1; }
          if (terrain_tile_scan(PROBE_WALL, floor_of(p->x), floor_of(p->y), p->layer, 8) < 0) crush(p);
        }
      } else if (!sp->across) {
        // under one that moves up and down, on the ground he is crushed, and in the air its spikes hurt
        p->x = px;
        if (!p->air) { p->y = py; crush(p); }
        else if (!sp->up) world_damage(p);
      } else if (!sp->up) world_damage(p);
    } else if (sp->beside && p->state == PS_PUSH) {
      // off its side, he stops pushing (character state 14) and walks, or rolls in the air
      sp->beside = 0;
      p->gsp = 0;
      player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
      p->state = p->air ? PS_SPIN : PS_WALK;
    }
  }
  // above its origin and not rising, he lands on its top as if it were 8 px higher, then is put 8 px down onto it: onto its
  // spikes, he is hurt, and otherwise it carries him
  if (!p->dead && p->ysp >= 0 && y > floor_of(p->y)) {
    push_out(sp, p);
    int flags = collide_platform(&sp->o, x, y - LANDING_RAISE, hb, p);
    if (flags & COLLIDE_LANDED) {
      if (sp->up) world_damage(p);
      else { sp->riding = 1; p->y += LANDING_RAISE; }
    }
  }
}

static int spiked_run(ActTask *t) {
  Spiked *sp = (Spiked *)t->data;
  const Entity *en = &sp->o.slot->e;
  Player *p = &act.player;
  int32_t next = (int32_t)((uint32_t)sp->reach * (uint32_t)(int32_t)SINE[(4 * ((act.tick + sp->phase) & 0xFF)) & 0x3FF]) >> 14;
  int moved = next - sp->offset;
  sp->offset = next;
  sp->o.x = en->x + (sp->across ? sp->offset >> 8 : 0);
  sp->y = en->y + (sp->across ? 0 : sp->offset >> 8);
  if (!p->dead && !p->carried) spiked_collide(sp, p, moved);
  if (off_display(en->x, en->y) && off_cam(sp->o.x, sp->y)) return 0;
  object_draw(&sp->o.sprite, sp->o.x, sp->y);
  return 1;
}

ActTask *spiked_platform_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  Spiked *sp = OBJECT_NEW(Spiked);
  if (!sp) return NULL;
  // Casino Paradise's (and Chao Hunt C's) look their own, with the spikes up whatever d0 is
  int casino = act.stage.zone == ZONE_CASINO_PARADISE || act.stage.level == LEVEL_CHAO_HUNT_C;
  sp->up = casino || en->d[0] == 0;
  sp->across = en->d[2] > en->d[3];
  sp->phase = s8(sp->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  sp->reach = (sp->across ? en->d[2] : en->d[3]) << 11;
  sp->o.slot = slot;
  sp->o.x = en->x;
  sp->y = en->y;
  object_sprite(&sp->o.sprite, casino ? ANIM_CASINO : sp->up ? ANIM_SPIKES_UP : ANIM_SPIKES_DOWN, 0, 0, ORDER_PLATFORM, PRIORITY_FRONT, 0, 0);
  sprite_step(&sp->o.sprite);   // its one frame, and with it its box, comes when it is made
  return object_task(&sp->o, spiked_run, PRIORITY_OBJECTS);
}
