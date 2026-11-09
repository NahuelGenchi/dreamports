// Slot, Casino Paradise's slot machine (enemy kind 9). Translated from the JavaScript version's engine/slot.js (the original's
// slot.c). It floats 0.625 px a frame between d0 x 8 and (d0 + d2) x 8 px right of its spawn point, turning at either end, and bobs
// up to 20 px above that line and back down every 32 frames. Away from the ends, with Sonic's centre within 16 px of its own across,
// it stops for 20 frames and drops a coin, then floats on and doesn't drop another for 100 frames spent between the ends. Its
// sprite is a left half, drawn again mirrored for the right. In Casino Paradise it is made only on Normal.
//
// The coin falls, gaining 40/256 px a frame each frame, and shatters on the floor or on touching Sonic: six pieces fan out by the
// floor's angle at a random share of its speed, bounce, slow down, and go after 45 frames, blinking for the last 30. The pieces
// don't hurt. On the frame it shatters, one piece shows where the coin was.

#include "enemies.h"

enum {
  ZONE_CASINO_PARADISE = 2,
  ANIM_SLOT = 417, ANIM_COIN = 420, ANIM_PIECE = 421,
  VARIANT_WALK = 0, VARIANT_SHOOT = 1,
  ORDER_COIN = 9,
  // the coin and the piece load into tiles of their own, shared by every coin (VRAM_RESERVED_EN_SLOT_PROJ and _PROJ2)
  COIN_TILES = OBJ_VRAM + 0x2600, PIECE_TILES = OBJ_VRAM + 0x2680,
  STEP = 160,         // 0.625 px, in 1/256 px
  BOB_STEP = 16,      // the sine's angle a frame of the bob, 32 frames round
  BOB_FRAMES = 32, BOB_DIVIDE = 800,
  NEAR = 16,          // how far across from it Sonic's centre must be
  REST = 100, DROP = 19,
  COIN_UP = -6,       // where the coin leaves, from the Slot
  FALL = 40,          // the coin's and the pieces' gravity, in 1/256 px
  PIECES = 6, LIFE = 45, BLINK = 30,
  ANGLE_QUARTER = 0x7F, ANGLE_TURN = 1023,   // masks of the sine's angle
  PIECE_SHARE = 20000, PIECE_SPREAD = 30, PIECE_FIRST = -24, PIECE_APART = 8,
  // the coin and its pieces go when this far off the screen: x + 20 as a 16-bit number above 276, y + 20 below 0 or y above 240
  OUT_MARGIN = 20, OUT_WIDTH = 276, OUT_BELOW = 240,
  TILE_BITS = 3, TILE_NUMBER = 0x3FF, TILE_X_FLIP = 0x400, TILE_Y_FLIP = 0x800, METATILE = 12,
};

typedef struct {
  Object o;
  int d0, d2, q, v, phase, rise, t, rest, dropping;
} SlotMachine;

// the original's cull window for the coin and its pieces
static int out(int x, int y) {
  int sx = x - cam_x(), sy = y - cam_y();
  return ((sx + OUT_MARGIN) & 0xFFFF) > OUT_WIDTH || sy + OUT_MARGIN < 0 || sy > OUT_BELOW;
}

// --- the coin, and once it shatters its pieces, one sprite drawn at each ----------------------------------------------------------
typedef struct { int live, x, y, q, vy, vx; } Piece;
typedef struct { Object o; int x, y, vy, life, shattered; Piece pieces[PIECES]; } Coin;

static void shards_run(Coin *c) {
  Sprite *s = &c->o.sprite;
  for (int i = 0; i < PIECES; i++) {
    Piece *pc = &c->pieces[i];
    if (!pc->live) continue;
    pc->vy = s16(bios_div(pc->vy * 1000, 1045 - c->life));
    pc->q += pc->vx;
    pc->x = s16(enemy_i(pc->q));
    pc->vy = s16(pc->vy + FALL);
    pc->y = s16(pc->y + enemy_i(pc->vy));
    int x = pc->x, y = pc->y;
    if (out(x, y)) { pc->live = 0; continue; }
    int d = terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    if (d <= 0) {
      pc->y = s16(pc->y + d);
      pc->vy = s16(bios_div(-(pc->vy * 10), 21));
      pc->vx += SINE[(terrain_angle(x, y, ENEMY_LAYER) * 4) & ANGLE_TURN] / PIECE_SPREAD;
    }
    if (c->life >= BLINK || (c->life & 2)) object_draw(s, x, y);
  }
}

static int coin_run(ActTask *t) {
  Coin *c = (Coin *)t->data;
  Sprite *s = &c->o.sprite;
  if (c->shattered) {
    sprite_step(s);
    if (--c->life == 0) return 0;
    shards_run(c);
    return 1;
  }
  c->vy = s16(c->vy + FALL);
  c->y = s16(c->y + enemy_i(c->vy));
  int hit = enemy_projectile(s, c->x, c->y);
  if (out(c->x, c->y)) return 0;
  int d = terrain_tile_floor(c->x, c->y, ENEMY_LAYER, 8);
  if (d <= 0 || hit) {
    // touching Sonic scatters the pieces as if straight up; the floor's angle is there whenever the floor is
    int angle = hit ? 0 : terrain_angle(c->x, c->y, ENEMY_LAYER);
    for (int i = 0; i < PIECES; i++) {
      Piece *pc = &c->pieces[i];
      int r0 = bios_div(-(c->vy * 10), (int32_t)act_random() % 4 + 16);
      pc->live = 1;
      pc->x = c->x; pc->y = s16(c->y + d); pc->q = c->x * 256;
      pc->vy = s16((int)((int64_t)r0 * SINE[((angle * 4) & ANGLE_QUARTER) + 0x100] / PIECE_SHARE));
      pc->vx = SINE[((angle + PIECE_FIRST + i * PIECE_APART) * 4) & ANGLE_TURN] / PIECE_SPREAD;
    }
    c->shattered = 1;
    c->life = LIFE;
    s->graphics.anim = ANIM_PIECE;
    s->graphics.dest = PIECE_TILES;
    sprite_start(s, 0);
  }
  sprite_step(s);
  object_draw(s, c->x, c->y);
  return 1;
}

static void coin_new(int x, int y) {
  Coin *c = OBJECT_NEW(Coin);
  if (!c) return;
  c->x = x; c->y = y;
  // the sprite on the shared tiles (nothing of the heap's to free)
  Sprite *s = &c->o.sprite;
  sprite_init(s);
  s->hitboxes[1].index = -1;
  s->graphics.dest = COIN_TILES;
  s->graphics.anim = ANIM_COIN;
  s->oamFlags = (uint16_t)(ORDER_COIN << 6);
  s->frameFlags = (uint32_t)ENEMY_PRIORITY << 12;
  sprite_step(s);
  object_task(&c->o, coin_run, ENEMY_SHOT_PRIORITY);
}

// --- the Slot ---------------------------------------------------------------------------------------------------------------------------
static int slot_run(ActTask *t) {
  SlotMachine *m = (SlotMachine *)t->data;
  Sprite *s = &m->o.sprite;
  Slot *slot = m->o.slot;
  const Entity *e = &slot->e;
  if (!m->dropping) {
    m->phase = (m->phase + 1) & (BOB_FRAMES - 1);
    m->rise = SINE[m->phase * BOB_STEP] / BOB_DIVIDE;
    m->q = s16(m->q + m->v);
  }
  int x = e->x + enemy_i(m->q), y = e->y - m->rise;
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  if (!m->dropping) {
    int px = enemy_sonic_x();
    if (enemy_i(m->q) <= m->d0 * ENEMY_TILE) m->v = STEP;
    else if (enemy_i(m->q) >= (m->d0 + m->d2) * ENEMY_TILE) m->v = -STEP;
    else if (m->rest != 0) m->rest--;
    else if (px <= x + NEAR && px >= x - NEAR) {
      m->rest = REST;
      sprite_start(s, VARIANT_SHOOT);
      coin_new(x, y + COIN_UP);
      m->dropping = 1;
    }
  } else if (++m->t > DROP) { m->t = 0; sprite_start(s, VARIANT_WALK); m->dropping = 0; }
  sprite_step(s);
  // the left half, then again mirrored for the right
  uint32_t flags = s->frameFlags;
  object_draw(s, x, y);
  s->frameFlags = flags | SPRITE_X_FLIP;
  object_draw(s, x, y);
  s->frameFlags = flags;
  return 1;
}

ActTask *slot_machine_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_CASINO_PARADISE)) return NULL;
  SlotMachine *m = OBJECT_NEW(SlotMachine);
  if (!m) return NULL;
  EnemyData d = enemy_data(&slot->e);
  m->o.slot = slot;
  m->o.x = slot->e.x;
  m->d0 = d.d0; m->d2 = d.d2;
  m->v = -STEP;
  enemy_sprite(&m->o.sprite, ANIM_SLOT, VARIANT_WALK, VARIANT_SHOOT, ENEMY_ORDER);
  return object_task(&m->o, slot_run, PRIORITY_OBJECTS);
}
