// The act's rings: those lying in the level, taken as Sonic touches them, the sparkle each leaves, the rings a magnetic
// shield pulls in, and the rings Sonic drops when he is hurt. Translated from the JavaScript version's engine/rings.js,
// engine/scatter.js, magneticRing in engine/items.js and addRing in engine/game.js (the original's rings_manager.c,
// collect_ring_effect.c, magnetic_ring.c and rings_scatter.c).

#include "objects.h"
#include "terrain.h"

enum {
  ANIM_RING = 707, ANIM_RING_SPARKLE = 708,
  RING_TILES = OBJ_VRAM + 0x1D00,      // the tiles every ring shares (RESERVED_RING_TILES_VRAM)
  SPARKLE_TILES = OBJ_VRAM + 0x1F00,   // and the sparkles' (RESERVED_RING_EFFECT_TILES_VRAM)
  ORDER_RING = 20, ORDER_EFFECT = 15, PRIORITY_FRONT = 2,
  RING_ENDS = 0xFF, RING_TAKEN = 0xFE,   // MAP_ENTITY_STATE_ARRAY_END and MAP_ENTITY_STATE_INITIALIZED, in a ring's x
  HALF_WIDTH = 6, TILE = 8,
  MAX_RING_SPARKLES = 8,
  SE_RING_PLAYER_LEFT = 2, SE_RING_PLAYER_RIGHT = 1,
  SE_RINGS_LOST = 118,
};

// --- a ring's point against a box (RECT_TOUCHING_RING, HB_TOUCHING_RING) ---------------------------------------------
// a ring covers 16 x 16 px above its point, and the two touch when either one's left (top) edge lies inside the other
static int touching(int l, int r, int t, int b, int rx, int ry) {
  return ((rx - TILE <= l && rx + TILE >= l) || (rx - TILE >= l && r >= rx - TILE))
    && ((ry - 2 * TILE <= t && ry >= t) || (ry - 2 * TILE >= t && b >= ry - 2 * TILE));
}

/** Sonic's body box (his sprite's first hitbox) against a ring; false when his animation has none. */
static int body_touching(const Player *p, int rx, int ry) {
  const Hitbox *hb = &p->sprite.hitboxes[0];
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  return hb->index >= 0 && touching(px + hb->left, px + hb->right, py + hb->top, py + hb->bottom, rx, ry);
}

// --- counting a ring (INCREMENT_RINGS) ----------------------------------------------------------------------------------
/** Passing a hundred gives a life. */
void rings_add(int n) {
  int before = act.ringCount;
  act.ringCount = (before + n) & 0xFFFF;
  if (act.ringCount / 100 != before / 100) world_extra_life();
}

// --- the sparkle a ring leaves, with its sound (CreateCollectRingEffect) --------------------------------------------------------
typedef struct { Object o; } Sparkle;
static int sparkles;   // how many are showing: with 8, a ring is still counted but makes no sparkle or sound

static int sparkle_run(ActTask *t) {
  Sparkle *f = (Sparkle *)t->data;
  Sprite *s = &f->o.sprite;
  int x = s->x, y = s->y;
  s->x = (int16_t)(x - cam_x());
  s->y = (int16_t)(y - cam_y());
  int over = !update_sprite(s, 0);
  if (over) sparkles--;
  if (objects_drawing()) display_sprite(s);
  if (over && objects_drawing()) display_sprite(s);   // the original draws once more after it ends the task
  s->x = (int16_t)x; s->y = (int16_t)y;
  return !over;
}

/** A ring taken at (x, y), alternating sides with the count's parity: an odd count on the second sound effect player to
 *  the left, an even one on the first to the right, at half volume. */
void ring_effect(int x, int y) {
  if (sparkles >= MAX_RING_SPARKLES) return;
  int odd = act.ringCount & 1, player = odd ? SE_RING_PLAYER_LEFT : SE_RING_PLAYER_RIGHT;
  Sparkle *f = OBJECT_NEW(Sparkle);
  if (!f) return;
  Sprite *s = &f->o.sprite;
  sprite_init(s);
  s->x = (int16_t)x; s->y = (int16_t)y;
  s->graphics.dest = SPARKLE_TILES;
  s->graphics.anim = ANIM_RING_SPARKLE;
  s->oamFlags = ORDER_EFFECT << 6;
  s->frameFlags = PRIORITY_FRONT << 12;
  gba_sound_start_on(player, SONG_RING);
  gba_sound_imm_init(player);
  gba_sound_volume(player, 0xFFFF, 128);
  gba_sound_pan(player, 0xFFFF, odd ? -64 : 64);
  sparkles++;
  act_task_add(sparkle_run, object_end, f, PRIORITY_OBJECTS);
}

void ring_add(int x, int y) {
  rings_add(1);
  ring_effect(x, y);
}

// --- the rings in the level (rings_manager.c) ------------------------------------------------------------------------------
// The grid is kept as the copy has it, a taken ring marked in its x, as the original marks it.
static uint8_t ringBytes[8192];
static Grid grid;
static Sprite ringSprite;   // every ring shares it, so they all spin together

void rings_load(int level) {
  Grid g;
  memset(&grid, 0, sizeof grid);
  if (!grid_load(TABLE_RINGS, level, &g)) return;
  uint32_t size = le32(g.data, 0) + 4;
  if (size > sizeof ringBytes) size = sizeof ringBytes;
  memcpy(ringBytes, g.data, size);
  grid = g;
  grid.data = ringBytes;
}

static void ring_sprite(Sprite *s, uint32_t dest, int order) {
  sprite_init(s);
  s->graphics.dest = dest;
  s->graphics.anim = ANIM_RING;
  s->oamFlags = (uint16_t)(order << 6);
  s->frameFlags = PRIORITY_FRONT << 12;
}


/** Puts the ring the sprite shows at (x, y) in a later place of the OAM, copying the first one's entry (the rings of one
 *  frame all look alike). `drawn` counts the rings put so far. */
static void put_ring(Sprite *s, int *drawn, int x, int y) {
  if (!objects_drawing()) return;
  if (*drawn == 0 || s->oamBaseIndex == 0xFF) {
    s->oamBaseIndex = 0xFF;
    s->x = (int16_t)x; s->y = (int16_t)y;
    display_sprite(s);
  } else if (s->dimensions != NO_FRAME) {
    int k = alloc_oam((s->oamFlags & 0x7C0) >> 6);
    if (k < 0) return;
    const uint16_t *from = &e.oamMalloc[s->oamBaseIndex * 4];
    uint16_t *to = &e.oamMalloc[k * 4];
    to[0] = (uint16_t)((from[0] & 0xFF00) + ((y - rom_s16(s->dimensions + 10)) & 0xFF));
    to[1] = (uint16_t)((from[1] & 0xFE00) + ((x - rom_s16(s->dimensions + 8)) & 0x1FF));
    to[2] = from[2];
  }
  (*drawn)++;
}

static void collect_rings(const Player *p) {
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y), oy = p->offsetY;
  int l = px - HALF_WIDTH, r = px + HALF_WIDTH, t = py - oy, b = py + oy;
  // the original keeps region indices in u16s: a search that starts left of or above the map wraps to 65535 and finds
  // nothing; its bottom and right edges come in by a ring's height and half its width
  for (int ry = ((py - oy) >> 8) & 0xFFFF; ry <= (py + oy - 2 * TILE) >> 8 && ry < grid.regionsY; ry++) {
    for (int rx = ((px - HALF_WIDTH - TILE) >> 8) & 0xFFFF; rx <= (px + HALF_WIDTH - TILE) >> 8 && rx < grid.regionsX; rx++) {
      int at = grid_records(&grid, rx + ry * grid.regionsX);
      if (at < 0) continue;
      for (; grid.data[at] != RING_ENDS; at += 2) {
        if (grid.data[at] == RING_TAKEN) continue;
        int x = grid.data[at] * 8 + rx * REGION_SIZE, y = grid.data[at + 1] * 8 + ry * REGION_SIZE;
        if (!touching(l, r, t, b, x, y)) continue;
        rings_add(1);
        ring_effect(x, y);
        ((uint8_t *)grid.data)[at] = RING_TAKEN;
      }
    }
  }
}

static ActTask *magnetic_ring_spawn(int x, int y);

static void draw_rings(void) {
  int cx = cam_x(), cy = cam_y(), drawn = 0;
  int magnetic = act.player.shield == SHIELD_MAGNETIC;
  int px = (int)__builtin_floor(act.player.x), py = (int)__builtin_floor(act.player.y);
  for (int ry = (cy >> 8) & 0xFFFF; ry * REGION_SIZE < cy + DISPLAY_HEIGHT && ry < grid.regionsY; ry++) {
    for (int rx = (cx >> 8) & 0xFFFF; rx * REGION_SIZE < cx + DISPLAY_WIDTH && rx < grid.regionsX; rx++) {
      int at = grid_records(&grid, rx + ry * grid.regionsX);
      if (at < 0) continue;
      for (; grid.data[at] != RING_ENDS; at += 2) {
        if (grid.data[at] == RING_TAKEN) continue;
        int x = grid.data[at] * 8 + rx * REGION_SIZE, y = grid.data[at + 1] * 8 + ry * REGION_SIZE;
        if (x - cx < -TILE || x - cx + TILE > DISPLAY_WIDTH + 2 * TILE || y - cy < 0 || y - cy - 2 * TILE > DISPLAY_HEIGHT) continue;
        // the magnetic shield pulls in the rings within 64 px of Sonic's centre across, 72 above it or 56 below
        if (magnetic && x - 64 <= px && x + 64 >= px && y - 72 <= py && y + 56 >= py) {
          magnetic_ring_spawn(x, y);
          ((uint8_t *)grid.data)[at] = RING_TAKEN;
          continue;
        }
        put_ring(&ringSprite, &drawn, x - cx, y - cy);
      }
    }
  }
}

/** Whether the next frame draws the rings without stepping their animation, as a menu\'s hand-over does. */
static int skipUpdate;
void rings_skip_first_update(void) { skipUpdate = 1; }

int rings_task(ActTask *t) {
  (void)t;
  if (skipUpdate) skipUpdate = 0;
  else update_sprite(&ringSprite, 0);
  const Player *p = &act.player;
  // the rings can't be taken while Sonic is knocked back and blinking, or dead
  if (!act.ringsStopped && p->dead == 0 && !(p->state == PS_HURT && p->invulnerable)) collect_rings(p);
  draw_rings();
  return 1;
}

// --- a ring the magnetic shield pulled in (magnetic_ring.c) ------------------------------------------------------------------------
typedef struct { Object o; int x, y, speed; } MagneticRing;

static int magnetic_ring_run(ActTask *t) {
  MagneticRing *m = (MagneticRing *)t->data;
  Player *p = &act.player;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  // a ring right on Sonic's centre has angle -1, which reads the table one entry early (0 for the sine's)
  int a = quick_angle(py - (m->y & 0xFFFF), px - (m->x & 0xFFFF));   // sub_8004418
  m->speed = s16(m->speed + 64);
  m->x = s16(m->x + ((m->speed * SINE[a + 256]) >> 22));
  m->y = s16(m->y + ((m->speed * (a >= 0 ? SINE[a] : 0)) >> 22));
  if (body_touching(p, m->x, m->y)) {
    if (!p->dead) ring_add(m->x, m->y);
    return 0;
  }
  Sprite *s = &m->o.sprite;
  s->x = (int16_t)(m->x - cam_x());
  s->y = (int16_t)(m->y - cam_y());
  update_sprite(s, 0);
  if (objects_drawing()) display_sprite(s);
  return 1;
}

static ActTask *magnetic_ring_spawn(int x, int y) {
  MagneticRing *m = OBJECT_NEW(MagneticRing);
  if (!m) return NULL;
  ring_sprite(&m->o.sprite, RING_TILES, ORDER_EFFECT);
  m->o.sprite.frameFlags |= SPRITE_KEEP_TILES | SPRITE_KEEP_PALETTE;
  m->x = x; m->y = y;
  return act_task_add(magnetic_ring_run, object_end, m, PRIORITY_OBJECTS);
}

// --- the rings Sonic drops when he is hurt (rings_scatter.c) -----------------------------------------------------------------
// Their task runs after the objects and before Sonic, so a ring dropped this frame already moves once. Positions and speeds
// are kept in 1/256 px, as the original's Q24.8 and Q8.8 integers.
enum {
  SCATTER_SLOTS = 48, SCATTER_LIFE = 256, SCATTER_PICKUP_AFTER = 224, SCATTER_BLINK_BELOW = 32, SCATTER_GRAVITY = 18,
  SCATTER_SPEED_START = 0x488, SCATTER_ANIM_SPEED = 0x20,   // twice the rings' normal speed
};
static struct { int x, y, vx, vy, life, layer; } scatter[SCATTER_SLOTS];
static Sprite scatterSprite;
static int scatterCeilings;   // set by a boss (unk2B6 bit 0): the rings also bounce off ceilings while rising
#define SCATTER_CARD_STEPS 1

void scatter_ceilings(void) { scatterCeilings = 1; }

/** InitScatteringRings: up to 48 rings from (x, y), in the free slots; the rest are lost. The speeds go round three circles
 *  in mirrored pairs: each even ring gets the next angle on the circle, and the odd ring after it the same with X
 *  reversed. Under flipped gravity they fly the other way up. */
void scatter_launch(int x, int y, int n, int layer, int inverted) {
  if (n == 0) return;
  if (n > SCATTER_SLOTS) n = SCATTER_SLOTS;
  play_song(SE_RINGS_LOST);
  int r3 = SCATTER_SPEED_START, vx = 0, vy = 0, launched = 0;
  for (int i = 0; i < SCATTER_SLOTS; i++) {
    if (scatter[i].life) continue;
    scatter[i].life = SCATTER_LIFE;
    scatter[i].layer = layer;
    scatter[i].x = x * 256; scatter[i].y = y * 256;
    if (r3 >= 0) {
      int shift = r3 >> 8, a = (r3 & 0xFF) * 4;
      if (shift > 5) shift = 9 - shift;
      vx = SINE[a] >> shift; vy = SINE[a + 256] >> shift;
      vx -= vx >> 2; vy -= vy >> 2;
      r3 = (r3 + 0x10) | 0x80;
    }
    scatter[i].vx = vx;
    scatter[i].vy = inverted ? -vy : vy;
    r3 = -r3; vx = -vx;
    if (++launched >= n) return;
  }
}

int scatter_task(ActTask *t) {
  (void)t;
  Sprite *s = &scatterSprite;
  Player *p = &act.player;
  int cx = cam_x(), cy = cam_y(), drawn = 0, up = p->inverted;
  update_sprite(s, 0);
  int canTake = p->dead == 0 && !(p->state == PS_HURT && p->invulnerable);
  for (int i = 0; i < SCATTER_SLOTS; i++) {
    if (!scatter[i].life) continue;
    scatter[i].x += scatter[i].vx;
    scatter[i].y += scatter[i].vy;
    int rx = scatter[i].x >> 8, ry = scatter[i].y >> 8, sx = rx - cx, sy = ry - cy;
    if (scatter[i].life <= SCATTER_PICKUP_AFTER && canTake && body_touching(p, rx, ry)) {
      ring_effect(rx, ry);
      rings_add(1);
      scatter[i].life = 0;
      continue;
    }
    if (up ? scatter[i].vy < 0 : scatter[i].vy > 0) {
      int d = up ? terrain_tile_floor(rx, ry - 2 * TILE, scatter[i].layer, -8) : terrain_tile_floor(rx, ry, scatter[i].layer, 8);
      if (d <= 0) {
        scatter[i].y += (up ? -d : d) * 256;
        scatter[i].vy = (scatter[i].vy >> 2) - scatter[i].vy;
      }
    }
    if (scatterCeilings && !up && scatter[i].vy < 0) {
      int d = terrain_tile_probe(PROBE_FLOOR, ry - 16, rx, scatter[i].layer, -8).d;
      if (d <= 0) {
        scatter[i].y -= d * 256;
        scatter[i].vy = (scatter[i].vy >> 2) - scatter[i].vy;
      }
    }
    scatter[i].vy += up ? -SCATTER_GRAVITY : SCATTER_GRAVITY;
    // drawn where it was before the bounce, blinking in its last 32 frames with Sonic's blink
    if (sx + TILE > 0 && sx + TILE < DISPLAY_WIDTH + 2 * TILE && sy > -TILE && sy < DISPLAY_HEIGHT + TILE
        && (scatter[i].life >= SCATTER_BLINK_BELOW || (act_stage_time() & 2) == 0)) put_ring(s, &drawn, sx, sy);
    scatter[i].life--;
  }
  return 1;
}

/** Puts every ring back and clears the slots, as the act's start does. */
void rings_act2_prepare(void) {
  // the rings manager is made while the stage loads and runs through the card's frames: sixteen of them before the
  // act's first picture, and one more step of delay, as Neo Green Hill act 2's recording has them
  for (int i = 0; i < 18; i++) update_sprite(&ringSprite, 0);
  ringSprite.qAnimDelay = (int16_t)(ringSprite.qAnimDelay + 256);
  for (int i = 0; i < SCATTER_CARD_STEPS; i++) update_sprite(&scatterSprite, 0);
}

void rings_start(void) {
  ring_sprite(&ringSprite, RING_TILES, ORDER_RING);
  ring_sprite(&scatterSprite, RING_TILES, ORDER_RING);
  scatterSprite.animSpeed = SCATTER_ANIM_SPEED;
  memset(scatter, 0, sizeof scatter);
  scatterCeilings = 0;
  sparkles = 0;
}

/** The ring animation Casino Paradise act 2's first compared frame shows, two frames into the act. */
void rings_start_point(void) {
  ringSprite.qAnimDelay = 512;
  // the dropped rings' sprite (InitPlayerHitRingsScatter's, made with the stage) animates through the frames after the
  // card where pre_run runs no objects: four steps, as the Egg Ball's first hit shows them
  for (int i = 0; i < 4; i++) update_sprite(&scatterSprite, 0);
}
