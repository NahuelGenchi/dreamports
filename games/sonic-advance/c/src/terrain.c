// The act's terrain and Sonic's sensors, translated from the JavaScript version's engine/terrain.js and
// engine/sensors.js (the SAT-R decompilation's terrain_collision.c and the player's sensor code).
//
// Every 8 x 8 tile has eight height bytes. The high nibble describes each pixel column and the low nibble each pixel
// row, both signed 4-bit. A positive value v is solid from pixel v % 8 to the bottom (or right) edge, so 8 is a full
// column; a negative value is solid for the first -v pixels from the top (or left); 0 is empty, and -8 reads as 8.

#include "act.h"
#include "terrain.h"

enum { TILE_X_FLIP = 0x400, TILE_Y_FLIP = 0x800, TILE_NUMBER = 0x3FF };
enum {
  HALF_WIDTH = 6,                  // spriteOffsetX: half his width
  REACH = 2 + HALF_WIDTH,          // the paired sensors sit 8 px either side of the centre
  MAX_SNAP = 11,                   // grounded sensors never pull Sonic further than this
  AIR_WALL = 3 + HALF_WIDTH,       // the wall checks in the air: one pixel wider than on the ground
  METATILE = 12,                   // tiles across a metatile
};
#define LANDING_SPEED_MAX 11.8125  // the fastest a steep landing turns into ground speed

static int quadrant(int rot) { return (((rot & 0xFF) + 0x20) & 0xC0) >> 6; }
static int floor_div(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
static int clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- the terrain lookups (engine/terrain.js createTerrain) -----------------------------------------------------------
static uint16_t tile_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = floor_div(tx, METATILE), my = floor_div(ty, METATILE);
  int lx = tx - mx * METATILE, ly = ty - my * METATILE;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + my * c->levelX + mx);
  return (uint16_t)rom_u16(c->metatiles + (id * 144u + (uint32_t)ly * METATILE + (uint32_t)lx) * 2u);
}
static int signed4(int v) { return v & 8 ? v - 16 : v; }
// a flip across the measured axis turns "solid from row v down" into "solid for the first 8 - v rows"
static int flip_height(int v) { return v == 0 || v == 8 ? v : v > 0 ? v - 8 : v + 8; }
static int platform_tile(int tile) { return (rom_u16(act.stage.collision.flags + (uint32_t)(tile >> 3) * 2u) >> ((tile & 7) * 2)) & 1; }

// the height value of the pixel column at (px, py), or the width value of the pixel row: -7 ... 8
static int height_value(int px, int py, int layer, int row) {
  const Collision *c = &act.stage.collision;
  px = clamp(px, 0, c->width - 1); py = clamp(py, 0, c->height - 1);
  uint16_t entry = tile_entry(layer, px >> 3, py >> 3);
  int tile = entry & TILE_NUMBER;
  int at = row ? py & 7 : px & 7;
  if (entry & (row ? TILE_Y_FLIP : TILE_X_FLIP)) at = 7 - at;
  int v = signed4(row ? rom_u8(c->heights + (uint32_t)tile * 8u + (uint32_t)at) & 15
                      : rom_u8(c->heights + (uint32_t)tile * 8u + (uint32_t)at) >> 4);
  if (v == -8) v = 8;
  if ((layer & IGNORE_PLATFORMS) && platform_tile(tile)) v = 0;
  return entry & (row ? TILE_X_FLIP : TILE_Y_FLIP) ? flip_height(v) : v;
}

// the surface angle of the tile at (px, py), 0-255 for a full turn, mirrored for flipped tiles
int terrain_angle(int px, int py, int layer) {
  const Collision *c = &act.stage.collision;
  uint16_t entry = tile_entry(layer, clamp(px, 0, c->width - 1) >> 3, clamp(py, 0, c->height - 1) >> 3);
  int a = rom_u8(c->angles + (entry & TILE_NUMBER));
  if (entry & TILE_X_FLIP) a = -a;
  if (entry & TILE_Y_FLIP) a = 0x80 - a;
  return a & 0xFF;
}

// The probes take the coordinate along the scan axis first, like the original's: a floor probe reads the column of
// (x, y) as (y, x) and a wall probe the row as (x, y).
typedef struct { int v, rot; } Probe;
static Probe probe(int kind, int p0, int p1, int layer) {
  Probe r;
  if (kind == PROBE_FLOOR) { r.v = height_value(p1, p0, layer, 0); r.rot = terrain_angle(p1, p0, layer); }
  else { r.v = height_value(p0, p1, layer, 1); r.rot = terrain_angle(p0, p1, layer); }
  return r;
}

// the distance to the last free pixel before the solid part of a partial tile
static int partial(int v, int r) { return v > 0 ? v - 1 - r : v + r; }

Scan terrain_scan(int kind, int p0, int p1, int layer, int step) {
  int fwd = step > 0, r = p0 & 7;
  Probe t0 = probe(kind, p0, p1, layer);
  Scan out = { 0, 0, 1 };
  if (t0.v != 0 && t0.v != 8) { out.d = partial(t0.v, r); out.rot = t0.rot; return out; }
  if (t0.v == 0) {
    Probe t1 = probe(kind, p0 + step, p1, layer);
    if (t1.v == 8) { out.d = fwd ? 7 - r : r; out.rot = t1.rot; return out; }
    if (t1.v != 0) { out.d = partial(t1.v, r) + 8; out.rot = t1.rot; return out; }
    Probe t2 = probe(kind, p0 + 2 * step, p1, layer);
    if (t2.v == 8) { out.d = fwd ? 15 - r : r + 8; out.rot = t2.rot; return out; }
    if (t2.v != 0) { out.d = partial(t2.v, r) + 16; out.rot = t2.rot; return out; }
    out.d = fwd ? 24 - r : r + 17; out.hasRot = 0; return out;   // nothing found: the caller keeps its old angle
  }
  Probe b1 = probe(kind, p0 - step, p1, layer);
  if (b1.v == 0) { out.d = fwd ? -1 - r : r - 8; out.rot = t0.rot; return out; }
  if (b1.v != 8) { out.d = partial(b1.v, r) - 8; out.rot = b1.rot; return out; }
  Probe b2 = probe(kind, p0 - 2 * step, p1, layer);
  if (b2.v == 0) { out.d = fwd ? -9 - r : r - 16; out.rot = b1.rot; return out; }
  if (b2.v != 8) { out.d = partial(b2.v, r) - 16; out.rot = b2.rot; return out; }
  out.d = fwd ? -17 - r : r - 24; out.rot = b2.rot; return out;
}

int terrain_tile_floor(int x, int y, int layer, int step) { return terrain_tile_scan(PROBE_FLOOR, y, x, layer, step); }

// --- Sonic's sensors (engine/sensors.js) ---------------------------------------------------------------------------------
// With gravity flipped (Cosmic Angel's toggles), his speeds and angles stay as he sees them: his floor is the act's
// ceiling, a Y speed down moves him up the act, and an angle a is the act's -0x80 - a.
static int flip_angle(int rot) { return (-0x80 - rot) & 0xFF; }
int sensors_act_angle(const Player *p) { return p->inverted ? flip_angle(p->rotation) : p->rotation; }

// the ground mode from the angle, with the original's rounding at the 45 degree edges (sub_8022D6C)
static int ground_mode(int rot) {
  int r = s8(rot);
  return ((r + (r > -0x20 && r <= 0 ? 0x20 : 0x1F)) & 0xFF) >> 6;
}

// two scans: the nearer one wins, ties going to the second; `out` is the other one's distance
typedef struct { int d, rot, hasRot, out; } Pair;
static Pair pair(Scan a, Scan b) {
  Pair r;
  if (a.d < b.d) { r.d = a.d; r.rot = a.rot; r.hasRot = a.hasRot; r.out = b.d; }
  else { r.d = b.d; r.rot = b.rot; r.hasRot = b.hasRot; r.out = a.d; }
  return r;
}

// the sensor pairs the air code and the jump check use (sub_8029BB8, sub_8021B08, sub_802195C, sub_8021A34)
static int platform_mask(const Player *p, int limit) { return p->layer | (p->ysp < limit ? IGNORE_PLATFORMS : 0); }
static Pair floor_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) + p->offsetY, m = platform_mask(p, 0);
  return pair(terrain_scan(PROBE_FLOOR, y, x - REACH, m, 8), terrain_scan(PROBE_FLOOR, y, x + REACH, m, 8));
}
static Pair ceiling_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) - p->offsetY, m = platform_mask(p, 3);
  return pair(terrain_scan(PROBE_FLOOR, y, x - REACH, m, -8), terrain_scan(PROBE_FLOOR, y, x + REACH, m, -8));
}
static Pair left_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x) - REACH, y = (int)__builtin_floor(p->y), m = platform_mask(p, 3);
  return pair(terrain_scan(PROBE_WALL, x, y - p->offsetY, m, -8), terrain_scan(PROBE_WALL, x, y + p->offsetY, m, -8));
}
static Pair right_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x) + REACH, y = (int)__builtin_floor(p->y), m = platform_mask(p, 3);
  return pair(terrain_scan(PROBE_WALL, x, y - p->offsetY, m, 8), terrain_scan(PROBE_WALL, x, y + p->offsetY, m, 8));
}

// his floor and his ceiling (sub_8029B88, sub_8029B58): flipped, the act's ceiling and floor, whose distance counts
// the other way. An odd angle (or none) reads 0, and flipped, an even one is turned over.
static Pair sensed(Pair r, int flip) {
  if (!r.hasRot || (r.rot & 1)) r.rot = 0;
  else if (flip) r.rot = flip_angle(r.rot);
  return r;
}
static Pair floor_under(const Player *p) { return sensed(p->inverted ? ceiling_pair(p) : floor_pair(p), p->inverted); }
static Pair ceiling_over(const Player *p) { return sensed(p->inverted ? floor_pair(p) : ceiling_pair(p), p->inverted); }

int sensors_clearance(const Player *p, int angle) {
  switch (quadrant(angle)) {
    case 0: return floor_pair(p).d;
    case 1: return left_pair(p).d;
    case 2: return ceiling_pair(p).d;
    default: return right_pair(p).d;
  }
}

void sensors_ground(Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), soy = p->offsetY;
  int mode = ground_mode(sensors_act_angle(p));
  Scan a, b;
  double speed;
  if (mode == 0) {
    a = terrain_scan(PROBE_FLOOR, y + soy, x - REACH, p->layer, 8); b = terrain_scan(PROBE_FLOOR, y + soy, x + REACH, p->layer, 8); speed = p->xsp;
  } else if (mode == 1) {
    a = terrain_scan(PROBE_WALL, x - soy, y - REACH, p->layer, -8); b = terrain_scan(PROBE_WALL, x - soy, y + REACH, p->layer, -8); speed = p->ysp;
  } else if (mode == 2) {
    a = terrain_scan(PROBE_FLOOR, y - soy, x + REACH, p->layer, -8); b = terrain_scan(PROBE_FLOOR, y - soy, x - REACH, p->layer, -8); speed = p->xsp;
  } else {
    a = terrain_scan(PROBE_WALL, x + soy, y + REACH, p->layer, 8); b = terrain_scan(PROBE_WALL, x + soy, y - REACH, p->layer, 8); speed = p->ysp;
  }
  // the scans' angles persist in the player and stay stale when a scan finds nothing
  if (a.hasRot) p->rotA = a.rot;
  if (b.hasRot) p->rotB = b.rot;
  int val = a.d < b.d ? a.d : b.d, rot = a.d < b.d ? p->rotA : p->rotB;

  if (val < -MAX_SNAP) return;
  int snap = (int)__builtin_floor(__builtin_fabs(speed)) + 3;
  if (val > 0 && val > (snap < MAX_SNAP ? snap : MAX_SNAP)) { p->air = 1; p->pushing = 0; return; }
  if (mode == 0) p->y += val;
  else if (mode == 1) p->x -= val;
  else if (mode == 2) p->y -= val;
  else p->x += val;
  if (!(rot & 1)) p->rotation = p->inverted ? flip_angle(rot) : rot;   // odd angles mean "keep the previous one"
}

int sensors_wall_push(Player *p, int rolling) {
  if (p->gsp == 0) return 0;
  int a = (p->rotation + (p->gsp >= 0 ? -0x40 : 0x40)) & 0xFF;
  p->rotA = p->rotB = a;
  // the scan's own rounding, which differs from the plain quadrant used below at the 45 degree edges
  int sa = s8(a), up = ((a + 0x20) & 0xFF) >= 0x01 && ((a + 0x20) & 0xFF) <= 0x7F;
  int q = ((a + (up == (sa <= 0) ? 0x20 : 0x1F)) & 0xFF) >> 6;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), d;
  if (q == 0) d = terrain_scan(PROBE_FLOOR, y + REACH, x, p->layer, 8).d;
  else if (q == 1) d = terrain_scan(PROBE_WALL, x - REACH, y, p->layer, -8).d;
  else if (q == 2) d = terrain_scan(PROBE_FLOOR, y - REACH, x, p->layer, -8).d;
  else d = terrain_scan(PROBE_WALL, x + REACH, y, p->layer, 8).d;
  if (d > 0) return 0;
  switch (quadrant(a)) {
    case 0: p->y += d; p->ysp = 0; return 0;
    case 1: p->x -= d; p->xsp = 0; p->gsp = 0; if (!rolling) p->pushing = 1; return 1;
    case 2: p->y -= d; p->ysp = 0; p->air = 1; return 0;
    default: p->x += d; p->xsp = 0; p->gsp = 0; if (!rolling) p->pushing = 1; return 1;
  }
}

// a wall check every air direction starts with, moving sideways under flipped gravity not passing through the platforms
static int air_wall(Player *p, int dir, int solid) {
  int m = p->layer | (p->ysp < 3 && !solid ? IGNORE_PLATFORMS : 0);
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  int d = terrain_scan(PROBE_WALL, x + dir * AIR_WALL, y, m, 8 * dir).d;
  if (d > 0) return 0;
  p->x += dir * d; p->xsp = 0;
  return 1;
}

// the ground speed after landing on a surface of angle `rot` while falling (sub_8021C4C)
static void landing_speed(Player *p, int rot) {
  int sign = s8(rot) < 0 ? -1 : 1;
  if ((rot + 0x20) & 0x40) {
    p->xsp = 0; if (p->ysp > LANDING_SPEED_MAX) p->ysp = LANDING_SPEED_MAX;
    p->gsp = __builtin_fabs(p->ysp) * sign;
  } else if (!((rot + 0x10) & 0x20)) {
    p->ysp = 0; p->gsp = p->xsp;
  } else {
    p->ysp = __builtin_floor(p->ysp * 128) / 256;   // an arithmetic shift of the 8.8 value
    p->gsp = __builtin_fabs(p->ysp) * sign;
  }
}

void sensors_air(Player *p) {
  int vx = (int)__builtin_floor(p->xsp * 256 + 0.5), vy = (int)__builtin_floor(p->ysp * 256 + 0.5), down = p->inverted ? -1 : 1;
  // standing still in the air he counts as moving right, or left under flipped gravity
  int a = vx || vy ? arc_tan2(vx, vy) >> 8 : p->inverted ? 0x80 : 0;
  switch (((a - 0x20) & 0xC0) >> 6) {
    case 0: {   // moving down
      air_wall(p, -1, 0); air_wall(p, 1, 0);
      Pair f = floor_under(p);
      if (f.d >= 0 || f.out < -((int)__builtin_floor(p->ysp) + 6)) return;
      p->rotation = f.rot; p->y += down * f.d;
      player_land(p);
      landing_speed(p, f.rot);
      return;
    }
    case 2: {   // moving up
      air_wall(p, -1, 0); air_wall(p, 1, 0);
      Pair c = ceiling_over(p);
      if (c.d > 0) return;
      p->y -= down * c.d;
      // only one of the two steep ceiling slopes catches him (0x41-0x5F), as in the original
      if (((c.rot + 0x20) & 0x40) && s8(c.rot) > 0x40) {
        p->rotation = c.rot; player_land(p); p->gsp = __builtin_fabs(p->ysp);
        return;
      }
      p->ysp = 0;
      return;
    }
    default: {  // moving left (1) or right (3)
      int dir = a >= 0x60 && a < 0xA0 ? -1 : 1;
      if (air_wall(p, dir, p->inverted)) p->gsp = p->ysp;   // a quirk of the original
      Pair c = ceiling_over(p);
      if (c.d <= 0) {
        p->y -= down * c.d;
        if (p->ysp < 0) p->ysp = 0;
      } else if (p->ysp >= 0) {
        Pair f = floor_under(p);
        if (f.d > 0) return;
        p->y += down * f.d; p->rotation = f.rot;
        player_land(p);
        p->ysp = 0; p->gsp = p->xsp;
      }
    }
  }
}

void sensors_set_offset_y(Player *p, int offsetY) {
  int delta = offsetY - p->offsetY;
  if (!delta) return;
  switch (ground_mode(sensors_act_angle(p))) {
    case 0: p->y -= delta; break;
    case 1: p->x += delta; break;
    case 2: p->y += delta; break;
    default: p->x -= delta;
  }
  p->offsetY = offsetY;
}

int terrain_tile_scan(int kind, int p0, int p1, int layer, int step) {
  int v = probe(kind, p0, p1, layer).v, r = p0 & 7;
  if (v == 0) return step > 0 ? 8 - r : r + 1;
  if (v == 8) return step > 0 ? -1 - r : r - 8;
  return partial(v, r);
}

Scan terrain_tile_probe(int kind, int p0, int p1, int layer, int step) {
  Probe t = probe(kind, p0, p1, layer);
  Scan out = { terrain_tile_scan(kind, p0, p1, layer, step), t.rot, t.v != 0 };
  return out;
}
