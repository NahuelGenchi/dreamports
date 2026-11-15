// The players of a round against each other, as each GBA's task for another player runs it on this GBA's Sonic, translated
// from the JavaScript version's engine/mpplayer.js and engine/mpsolid.js (SAT-R: mp_player.c's sub_8016D20, sub_8017F34 and
// sub_8018300, collision_1.c's SA1 sub_800D0A0 by its assembly, collision_2.c's sub_800DA4C, sub_800DD54 and sub_800DE44).
// In Chao Hunt every character takes the same path: Sonic standing on another player moves with them, another player is
// solid to him, his attack box on their body knocks them back on their GBA, theirs on his body knocks him here, and a knock
// takes the Chao the one knocked carries over to the other. Each sees the other as their packets show them, and himself as
// his own packets show him, two frames ago.
//
// Not in C yet: team play's teammates (sub_80181E0), and Tails and Knuckles carrying another player (room event 8).

#include "objects.h"
#include "terrain.h"
#include "chaohunt.h"

enum {
  STALE = 30, SOX = 6, FAST = 0x480, BOUNCE_X = 0x180, BOUNCE_Y = -0x300, KNOCK_X = 0x180, KNOCK_Y = 0x300,
  SE_LIFE_LOST = 119, SE_KNOCK_TEAMMATE = 161, SE_KNOCK_OPPONENT = 162, EVENT_CHAO = 9,
  // the solidity test's result bits
  LANDED = 8, PUSHING = 0x20, FACING_LEFT = 1, FROM_BELOW = 0x10000, ON_RIGHT = 0x20000, ON_LEFT = 0x40000, RUSHED = 0x200000,
};

// Math.round, as the JavaScript version takes a speed to 1/256 px
static int q8(double v) { return (int)__builtin_floor(v * 256 + 0.5); }
static int floor_of(double v) { return (int)__builtin_floor(v); }
static int active(const Hitbox *b) { return b->index != -1; }

// Sonic on the ground again out of a ball, when the terrain stops what the test would do
static void stopped(Player *p) { p->curled = 0; p->air = 0; player_stand_up(p); }

// sub_800DD54 (hurt, thrown backwards) and sub_800DE44 (`both`: knocked the way he faces): up and away, unless invincible
// or still blinking
static int knock(Player *p, int both) {
  if (p->invincible > 0 || p->invulnerable > 0) return 0;
  int away = both ? (p->facing < 0 ? -KNOCK_X : KNOCK_X) : (p->facing < 0 ? KNOCK_X : -KNOCK_X);
  player_knock_aside(p, away / 256.0, -KNOCK_Y / 256.0);
  // thrown is the hurt state (charState 15, no steering, his blinking held); knocked while both attack (charState 41) he
  // steers as in a fall, and blinks on
  if (both) p->state = PS_MP_KNOCKED;
  p->spinDashing = 0; p->jumped = 0; p->midAir = 0; p->attack = 0;
  play_song(SE_LIFE_LOST);
  return 1;
}

// sub_800D0A0: Sonic against another player's body, a box as wide as his side probe and as tall as they are, moved out of it:
// onto their head, or out of their side. A player rushing at him faster than 4.5 px a frame takes him along (`rush`), bounces
// him off or knocks him back. Only the normal gravity half: Forest Chao Garden has no gravity switch
static uint32_t solid_player(MpPlayer *m, Player *p, int rush) {
  if (!active(&m->o.sprite.hitboxes[0]) || p->dead) return 0;
  int wx = m->x, wy = m->y, vx = m->qvx, vy = m->qvy, layer = (m->flags >> 7) & 1;
  int qx = q8(p->x), qy = q8(p->y), px = qx >> 8, py = qy >> 8;
  if (wx == px && wy == py) return 0;
  if (layer != p->layer) return 0;
  Hitbox flank = { 0, (int8_t)-(SOX + 5), (int8_t)(1 - p->offsetY), SOX + 5, (int8_t)(p->offsetY - 1) };
  Hitbox body = { 0, -SOX, (int8_t)-p->offsetY, SOX, (int8_t)p->offsetY };
  Hitbox them = { 0, (int8_t)-(SOX + 5), (int8_t)(1 - m->offsetY), SOX + 5, (int8_t)(m->offsetY - 1) };
  // above and below them a box as wide as his body and as tall as they are (the assembly's sp10; the decompilation's C
  // gives it their side box's numbers, and so did the JavaScript version)
  Hitbox tall = { 0, -SOX, (int8_t)-m->offsetY, SOX, (int8_t)m->offsetY };
  uint32_t res = 0;
  int stoodHere = 0;
  if (p->onObject == &m->o) { p->onObject = NULL; stoodHere = 1; }
  int ysp = q8(p->ysp);
#define DONE() do { if (stoodHere && !p->onObject) { p->pushing = 0; p->air = 1; } return res; } while (0)
  if (wy != py && collide_overlap(wx, wy, &tall, px, py, &body)) {
    if (py <= wy && ysp - vy >= 0) {
      // onto their head, unless the ceiling there is too low
      int ny = qy + ((wy + tall.top - body.bottom) << 8) - (qy & ~0xFF);
      int edge = terrain_tile_scan(PROBE_FLOOR, (ny >> 8) - p->offsetY, px, layer, -8);
      if (edge < 0) { stopped(p); p->ysp = 0; p->y -= edge; DONE(); }
      res |= LANDED;
      p->air = 0; p->onObject = &m->o; p->ysp = 0; p->y = ny / 256.0;
      if (stoodHere) DONE();
      player_land(p); p->gsp = p->xsp; p->rotation = 0;
      DONE();
    }
    if (py > wy && ysp - vy < 0) {
      // from below: only the floor under him can move him
      int edge = terrain_tile_scan(PROBE_FLOOR, py + p->offsetY, px, layer, 8);
      if (edge < 0) { stopped(p); p->ysp = 0; p->y += edge; }
      if (q8(p->ysp) - vy <= 0) { res |= FROM_BELOW; DONE(); }
    }
  }
  // their sides, unless he runs on a wall
  if ((((p->rotation + 0x20) & 0xC0) >> 6) & 1) DONE();
  if (!collide_overlap(wx, wy, &them, px, py, &flank)) DONE();
  int xsp = q8(p->xsp);
  int fast = xsp > FAST || xsp < -FAST, rushing = vx > FAST || vx < -FAST;
  if (px <= wx) {
    res |= ON_LEFT;
    if (p->facing > 0) {
      // facing them from their left
      if (p->attack != 0) { p->xsp = 0; DONE(); }
      int nx = (wx + them.left - flank.right) << 8;
      if (fast) {
        res |= RUSHED;
        if (vx > 0) {
          if (rush) {
            p->gsp = p->xsp = vx / 256.0; player_stand_up(p); p->state = PS_WALK; p->midAir = 0; p->attack = 0;
            play_song(SE_KNOCK_TEAMMATE); DONE();
          }
          p->gsp = p->xsp = vx / 256.0; p->x += 1; play_song(SE_KNOCK_OPPONENT);
        } else { p->air = 1; p->xsp = -BOUNCE_X / 256.0; p->ysp = BOUNCE_Y / 256.0; }
      } else if (xsp != 0) {
        int edge = terrain_tile_scan(PROBE_WALL, nx >> 8, py - SOX, layer, -8);
        if (edge < 0) { stopped(p); p->xsp = 0; p->x -= edge; DONE(); }
        if (!p->air) { p->pushing = 1; p->curled = 0; res = (res | PUSHING) & ~4u; player_stand_up(p); p->state = PS_PUSH; }
        p->facing = 1; res &= ~(uint32_t)FACING_LEFT;
        p->gsp = 0; p->xsp = 0;
        p->x = nx / 256.0; p->y = qy / 256.0;
      }
    } else {
      // his back to them, from their left
      if (p->attack != 0) { p->xsp = 0; DONE(); }
      if (rushing) {
        res |= RUSHED;
        if (vx < 0) {
          if (rush) { p->gsp = p->xsp = vx / 256.0; player_stand_up(p); p->state = PS_WALK; p->midAir = 0; p->attack = 0; play_song(SE_KNOCK_TEAMMATE); }
          else { knock(p, 1); play_song(SE_KNOCK_OPPONENT); }
        } else { p->gsp = 0; p->xsp = 0; }
      }
    }
  } else if (p->facing < 0) {
    // facing them from their right
    res |= ON_RIGHT;
    if (p->attack != 0) { p->xsp = 0; DONE(); }
    int nx = (wx + them.right - flank.left) << 8;
    if (fast) {
      res |= RUSHED;
      if (vx < 0) {
        if (rush) {
          p->gsp = p->xsp = vx / 256.0; player_stand_up(p); p->state = PS_WALK; p->midAir = 0; p->attack = 0;
          play_song(SE_KNOCK_TEAMMATE); DONE();
        }
        p->gsp = p->xsp = vx / 256.0; p->x -= 1; play_song(SE_KNOCK_OPPONENT);
      } else { p->air = 1; p->xsp = BOUNCE_X / 256.0; p->ysp = BOUNCE_Y / 256.0; }
    } else if (xsp != 0) {
      int edge = terrain_tile_scan(PROBE_WALL, nx >> 8, py + SOX, layer, 8);
      if (edge < 0) { stopped(p); p->xsp = 0; p->x += edge; DONE(); }
      if (!p->air) { p->pushing = 1; p->curled = 0; res = (res | PUSHING) & ~4u; p->state = PS_PUSH; player_stand_up(p); }
      p->facing = -1; res |= FACING_LEFT;
      p->gsp = 0; p->xsp = 0;
      p->x = (nx + 0x100) / 256.0; p->y = qy / 256.0;
    }
  } else {
    // his back to them, from their right
    if (p->attack != 0) { p->xsp = 0; DONE(); }
    if (rushing) {
      res |= RUSHED;
      if (vx > 0) {
        if (rush) { p->gsp = p->xsp = vx / 256.0; player_stand_up(p); p->state = PS_WALK; p->midAir = 0; p->attack = 0; play_song(SE_KNOCK_TEAMMATE); }
        else { knock(p, 1); play_song(SE_KNOCK_OPPONENT); }
      } else { p->gsp = 0; p->xsp = 0; }
    }
  }
  DONE();
#undef DONE
}

// sub_8017F34: Sonic standing on this player moves with them, unless they jumped more than 128 px; the terrain stops him
static void carry(MpPlayer *m, Player *p) {
  if (m->dx > 0x80 || m->dx < -0x80 || m->dy > 0x80 || m->dy < -0x80) { p->onObject = NULL; p->air = 1; m->wait = STALE; return; }
  p->x += m->dx;
  p->y += m->dy + 1;
  int layer = p->layer;
  if (m->dy < 0) {
    int edge = terrain_tile_scan(PROBE_FLOOR, floor_of(p->y) - p->offsetY, floor_of(p->x), layer, -8);
    if (edge < 0) { p->y -= edge; p->onObject = NULL; p->air = 1; m->wait = STALE; }
  } else if (m->dy > 0) {
    int edge = terrain_tile_scan(PROBE_FLOOR, floor_of(p->y) + p->offsetY, floor_of(p->x), layer, 8);
    if (edge < 0) { p->y += edge; p->onObject = NULL; p->air = 1; m->wait = STALE; }
  }
  if (m->dx < 0) {
    int edge = terrain_tile_scan(PROBE_WALL, floor_of(p->x) - SOX, floor_of(p->y), layer, -8);
    if (edge < 0) p->x -= edge;
  } else if (m->dx > 0) {
    int edge = terrain_tile_scan(PROBE_WALL, floor_of(p->x) + SOX, floor_of(p->y), layer, 8);
    if (edge < 0) p->x += edge;
  }
}

// sub_800DA4C: this GBA's Sonic, as his own packets show him, against this player: his attack box on its body (1, with the
// sides and heights he is on), or its attack box on his body (2), standing still too
static uint32_t contact(const MpPlayer *m, const Player *p) {
  if (p->dead || ((m->flags >> 7) & 1) != p->layer) return 0;
  const MpPlayer *me = &mpPlayers[hunt.id];
  const Hitbox *o0 = &m->o.sprite.hitboxes[0], *o1 = &m->o.sprite.hitboxes[1], *h0 = &me->o.sprite.hitboxes[0], *h1 = &me->o.sprite.hitboxes[1];
  uint32_t r = 0;
  if (p->xsp == 0 && p->ysp == 0 && active(o1) && collide_overlap(m->x, m->y, o1, me->x, me->y, h0)) r |= 2;
  if (active(h1) && active(o0) && collide_overlap(m->x, m->y, o0, me->x, me->y, h1)) {
    r |= me->x > m->x ? 0x40000 : 0x20000;
    r |= me->y > m->y ? 0x10000 : 0x100000;
    r |= 1;
  } else if (active(h0) && active(o1) && collide_overlap(m->x, m->y, o1, me->x, me->y, h0)) r |= 2;
  return r;
}

// the solidity test's result, as sub_8016D20 and sub_8018300 keep it
static void solid(MpPlayer *m, Player *p) {
  uint32_t val = solid_player(m, p, 0);
  if ((m->touch & PUSHING) && !(val & PUSHING)) p->pushing = 0;
  m->touch = val;
  if (val & RUSHED) m->wait = STALE;
}

// sub_8018300: true when a knock happened
static int versus(MpPlayer *m, Player *p) {
  if (m->wait != 0) {
    m->wait--;
    if (p->onObject == &m->o) solid(m, p);
    return 0;
  }
  uint32_t v = contact(m, p);
  if (v & 1) {
    if (p->midAir == 0 && (v & 0x20000)) { if (p->xsp > 0) { p->xsp = -p->xsp; p->gsp = -p->gsp; } }
    else if (p->midAir == 0 && (v & 0x40000)) { if (p->xsp < 0) { p->xsp = -p->xsp; p->gsp = -p->gsp; } }
    if ((v & 0x100000) && p->ysp > 0) p->ysp = -p->ysp;
    m->wait = STALE;
    if (!(v & 2)) return 1;
  }
  if (v & 2) {
    // knocked by its attack box: backwards when it hit him alone, as both attacking when he hit it too
    p->facing = (v & 1) ? (m->x < floor_of(p->x) ? 1 : -1) : (m->x < floor_of(p->x) ? -1 : 1);
    knock(p, (v & 1) != 0);
    m->wait = STALE;
    // the Chao he carries goes to this player
    MpPlayer *me = &mpPlayers[hunt.id];
    if (me->state & 0x70000) {
      int i = 0;
      while (i < 3 && !(me->state & (0x10000u << i))) i++;
      me->state &= ~(0x10000u << i);
      if (i == 0) mp_chao_take(m->id);
      chaohunt_send_event(EVENT_CHAO, i, m->id, 0, 0);
    }
    return 1;
  }
  if (!active(&p->sprite.hitboxes[1]) && !active(&m->o.sprite.hitboxes[1])) solid(m, p);
  else {
    if (p->onObject == &m->o) { p->onObject = NULL; p->air = 1; }
    if (m->touch & PUSHING) p->pushing = 0;
  }
  return 0;
}

/** What touching player `m` does to this GBA's Sonic this frame (Task_CreateMultiplayerPlayer, after its animation). */
void mp_contact(MpPlayer *m) {
  Player *p = &act.player;
  const MpPlayer *me = &mpPlayers[hunt.id];
  int own = m->id == hunt.id;
  int free = !hunt.actStart && !(m->flags & 4) && !(me->items & 0x80);
  int apart = 0;
  if (free && (hunt.itemEffect & 0x80)) apart = 1;
  else if (free && !(m->items & 0x80) && !(me->state & 1) && p->invulnerable == 0 && !p->dead) {
    if (!own) {
      if (p->onObject == &m->o) carry(m, p);
      if (versus(m, p) && (m->touch & PUSHING)) { p->pushing = 0; m->touch = 0; }
    }
  } else if ((hunt.itemEffect & 0x80) || (m->items & 0x80) || p->invulnerable != 0 || p->dead || hunt.ranks[m->id] != -1) apart = 1;
  if (apart && p->onObject == &m->o) { p->onObject = NULL; p->air = 1; m->wait = STALE; }
}
