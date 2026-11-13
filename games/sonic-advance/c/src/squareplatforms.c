// Square platforms (kind 55). Translated from the JavaScript version's engine/squareplatforms.js (the original's
// platform_square.c, Task_Platform_Square): a solid block that swings with the stage clock, d2 * 8 px either way across when
// d2 is above d3, else d3 * 8 px either way up and down, one swing every 256 frames, half a swing later when the sign of d0
// (across) or d1 (up and down) is set.
//
// It carries Sonic while he stands on it, by what it moved that frame plus 1 px down, which its top then puts him back from,
// and keeps him out of the terrain across. Its sides push him out on their own, 8 px of slack each way, but only once he is
// lower than its top. It crushes him (he dies where he is) when it would push him into the terrain: across, into a wall beside
// him; up and down, into a ceiling over him while he rides it, or onto the floor under him from below. Walking into its side and
// then away from it leaves his push, and once he is clear the platform puts him walking (or curled up, in the air) and stops him.

#include "objects.h"
#include "terrain.h"

enum {
  SQUARE_PLATFORM = 55,
  ORDER_PLATFORM = 18, PRIORITY_FRONT = 2,
  SWING_HALF = 0x80,        // the stage clock frames of half a swing
  HALF_WIDTH = 6,           // Sonic's spriteOffsetX
  WALL_SLACK = 2,           // how far past his half-width the wall under a carried Sonic is looked for
  SIDE_SLACK_LEFT = 8, SIDE_SLACK_RIGHT = 7,   // how far in from its edges the sides put him out to the nearer one
  DEFAULT_ANIMATION = 494,
};

// the square platform's animations by level (rom/levels.js sprites): short, and the longer one a level draws when the other
// byte is set; a level not listed draws the default
static const struct { int level, shortAnim, longAnim; } ANIMATIONS[] = {
  { 6, 524, 0 }, { 7, 524, 0 }, { 8, 536, 537 }, { 9, 536, 537 }, { 10, 518, 519 }, { 11, 599, 600 }, { 17, 599, 600 },
};

typedef struct {
  Object o;
  int y;               // where its box is this frame (Object has the x)
  int across, phase, reach;
  int offset;          // how far it is from its place, in 1/256 px
  int riding;          // he stands on it (unk4E)
  int touched;         // he was against its side or bottom (unk4F)
} Square;

static int floor_of(double v) { return (int)__builtin_floor(v); }
static int min_of(int a, int b) { return a < b ? a : b; }

// crushed: he dies where he is, and no object moves him again (MOVESTATE_DEAD | MOVESTATE_IA_OVERRIDE)
static void crush(Player *p) {
  p->pushing = 0;
  p->dead = 1; p->carried = 1;
}

// how far into a ceiling his head is, at both sides
static int ceiling(const Player *p) {
  int y = floor_of(p->y) - p->offsetY, x = floor_of(p->x);
  return min_of(terrain_scan(PROBE_FLOOR, y, x - HALF_WIDTH, p->layer, -8).d, terrain_scan(PROBE_FLOOR, y, x + HALF_WIDTH, p->layer, -8).d);
}

// sub_807E914: out of its sides to a whole pixel (one past its right edge), within 8 px of the left one and 7 px of the right,
// once he is lower than its top, then out of the floor below and the ceiling above him
static void side(Square *sq, Player *p) {
  const Hitbox *hb = object_box(&sq->o.sprite, 0);
  Hitbox flank = collide_flank(p);
  int px = floor_of(p->x), py = floor_of(p->y);
  if (!hb || !collide_overlap(sq->o.x, sq->y, hb, px, py, &flank) || py <= sq->y + hb->top - flank.bottom + 2) return;
  int left = sq->o.x + hb->left - flank.right, right = sq->o.x + hb->right - flank.left;
  if (px <= left + SIDE_SLACK_LEFT) p->x = left;
  else if (px >= right - SIDE_SLACK_RIGHT) p->x = right + 1;
  else return;
  int d = terrain_scan(PROBE_FLOOR, py + 9, (int)p->x, p->layer, 8).d;
  if (d < 0) p->y += d;
  d = terrain_scan(PROBE_FLOOR, floor_of(p->y), (int)p->x, p->layer, -8).d;
  if (d < 0) p->y += d;
  // off whatever he stood on, not only this
  p->pushing = 0; p->onObject = NULL;
}

// one frame of the platform against Sonic, with what it moved across (dx) and up and down (dy) in 1/256 px
static void square_collide(Square *sq, Player *p, int dx, int dy) {
  const Hitbox *hb = object_box(&sq->o.sprite, 0);
  double prevX = p->x;
  int r = 0;
  if (sq->riding) {
    p->x += dx / 256.0; p->y += dy / 256.0 + 1;
    // out of a wall the way it carries him (standing still counts as to the left)
    int offset = dx > 0 ? HALF_WIDTH + WALL_SLACK : -(HALF_WIDTH + WALL_SLACK), step = dx > 0 ? 8 : -8;
    int d = min_of(terrain_scan(PROBE_WALL, floor_of(p->x) + offset, floor_of(p->y), p->layer, step).d,
                   terrain_scan(PROBE_WALL, floor_of(p->x) + offset, floor_of(p->y) - p->offsetY, p->layer, step).d);
    if (d < 0) p->x += dx > 0 ? d : -d;
    Hitbox body = collide_body(p);
    if (ceiling(p) < 0) {
      if (!sq->across) { p->x = prevX; crush(p); }
    } else if (!hb || !collide_overlap(sq->o.x, sq->y, hb, floor_of(p->x), floor_of(p->y), &body)) sq->riding = 0;
  } else {
    double prevY = p->y;
    if (ceiling(p) < 0) side(sq, p);
    else r = collide_platform(&sq->o, sq->o.x, sq->y, hb, p);
    if (r & (COLLIDE_FROM_BELOW | COLLIDE_LEFT_FACE | COLLIDE_RIGHT_FACE)) {
      sq->touched = 1;
      int x = floor_of(p->x), y = floor_of(p->y);
      if (r & COLLIDE_RIGHT_FACE) {
        if (sq->across) {
          if (terrain_scan(PROBE_WALL, x + HALF_WIDTH, y, p->layer, 8).d <= 0) crush(p);
          else if ((p->held[0] & DPAD_LEFT) && !p->air) { p->x -= 1; p->pushing = 1; }
        }
      } else if (r & COLLIDE_LEFT_FACE) {
        if (sq->across) {
          if (terrain_scan(PROBE_WALL, x - HALF_WIDTH, y, p->layer, -8).d < 0) crush(p);
          else if ((p->held[0] & DPAD_RIGHT) && !p->air) { p->x += 1; p->pushing = 1; }
        }
      } else {
        p->x = prevX;
        if (!sq->across) {
          x = floor_of(p->x);
          int feet = y + p->offsetY;
          int d = min_of(terrain_scan(PROBE_FLOOR, feet, x - HALF_WIDTH, p->layer, 8).d, terrain_scan(PROBE_FLOOR, feet, x + HALF_WIDTH, p->layer, 8).d);
          if (d <= 0 && sq->y + hb->bottom < y) { p->x = prevX; p->y = prevY; crush(p); }
        }
      }
      // (a fourth case, for a flag only the multiplayer test sets, never runs here)
    } else if (sq->touched && p->state == PS_PUSH) {
      // off its side, he stops pushing and walks, or rolls in the air
      sq->touched = 0;
      p->gsp = 0;
      player_end_attack(p); p->pushing = 0;
      p->state = p->air ? player_thrown_state(p) : PS_WALK;
    }
  }
  // a second test while he is above its middle and not rising, which lands him on it
  if (!p->dead && p->ysp >= 0 && sq->y > floor_of(p->y)) {
    side(sq, p);
    prevX = p->x;
    r = collide_platform(&sq->o, sq->o.x, sq->y, hb, p);
    if (r & COLLIDE_LANDED) { sq->riding = 1; p->y += 1; }
    else if (r & COLLIDE_FROM_BELOW) p->x = prevX;
  }
}

static int square_run(ActTask *t) {
  Square *sq = (Square *)t->data;
  const Entity *en = &sq->o.slot->e;
  Player *p = &act.player;
  int32_t next = (int32_t)((uint32_t)sq->reach * (uint32_t)(int32_t)SINE[(4 * ((act_stage_time() + sq->phase) & 0xFF)) & 0x3FF]) >> 14;
  int moved = next - sq->offset;
  sq->offset = next;
  sq->o.x = en->x + (sq->across ? sq->offset >> 8 : 0);
  sq->y = en->y + (sq->across ? 0 : sq->offset >> 8);
  if (!p->dead && !p->carried) square_collide(sq, p, sq->across ? moved : 0, sq->across ? 0 : moved);
  if (off_display(en->x, en->y) && off_cam(sq->o.x, sq->y)) return 0;
  sprite_step(&sq->o.sprite);
  object_draw(&sq->o.sprite, sq->o.x, sq->y);
  return 1;
}

ActTask *square_platform_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  Square *sq = OBJECT_NEW(Square);
  if (!sq) return NULL;
  sq->across = en->d[2] > en->d[3];
  sq->phase = s8(sq->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  sq->reach = (sq->across ? en->d[2] : en->d[3]) << 11;
  // the longer look, when the level has one, for the other byte being set (zones 5 and 6)
  int anim = DEFAULT_ANIMATION;
  for (unsigned i = 0; i < sizeof ANIMATIONS / sizeof ANIMATIONS[0]; i++) {
    if (ANIMATIONS[i].level != act.stage.level) continue;
    anim = (sq->across ? en->d[1] : en->d[0]) != 0 && ANIMATIONS[i].longAnim ? ANIMATIONS[i].longAnim : ANIMATIONS[i].shortAnim;
  }
  sq->o.slot = slot;
  sq->o.x = en->x;
  sq->y = en->y;
  object_sprite(&sq->o.sprite, anim, 0, 0, ORDER_PLATFORM, PRIORITY_FRONT, 0, 0);
  sprite_step(&sq->o.sprite);
  return object_task(&sq->o, square_run, PRIORITY_OBJECTS);
}
