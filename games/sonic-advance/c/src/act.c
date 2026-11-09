// X Zone's act in C: its stage and collision from the player's copy, the camera, Sonic on the ground, the HUD, and
// the title card's state without its pictures. Translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js, a
// function at a time; every comment names the original's function where one is rewritten.

#include "act.h"
#include "actobjects.h"
#include "actenemies.h"
#include "results.h"

enum {
  OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC, OFFSET_LOOP_POINTS = 0x4A6E74, OFFSET_LOOP_SHIFTS = 0x4A6EBC,
  LAYER_FRONT = 0, LAYER_BACK = 1, IGNORE_PLATFORMS = 0x80,
  SCREEN_W_ = 240, SCREEN_H_ = 160,
};
enum { PS_IDLE, PS_WALK, PS_TURN, PS_BRAKE, PS_CROUCH, PS_LOOKUP, PS_SPIN, PS_HURT, PS_DEAD, PS_PUSH, PS_CROUCH_END, PS_LOOKUP_END, PS_BOUNCE, PS_INSTA,
  PS_SPRING, PS_SPRING_RISE, PS_SPRING_PEAK, PS_SPRING_FALL, PS_POLE, PS_SPIN_DASH, PS_SPIN_DASH_REV, PS_ACT_CLEAR_RUN,
  PS_HALF_PIPE_LOW, PS_HALF_PIPE_MID, PS_HALF_PIPE_HIGH };
enum { SONIC_IDLE = 0, SONIC_WALK = 4, SONIC_RUN = 5, SONIC_TURN = 6, SONIC_BRAKE_TURN = 7, SONIC_BRAKE = 9, SONIC_PUSH = 12 };
#define BRAKE_TURN_SPEED 1.5
// the HUD's tiles at the addresses the original reserves (vram_hardcoded.h): the face at tile 64, the ring at 68,
// the white digits at 84 and the red ones at 106
enum { HUD_GLYPHS = 11, HUD_WHITE = 0, HUD_RED = 22, HUD_RING = -16, HUD_FACE = -20, HUD_TILE = 84 };
enum { OBJ_8x8 = 0, OBJ_16x16 = 1, OBJ_32x32 = 2, OBJ_8x16 = 8 };
enum { ORDER_DIGITS = 2, ORDER_ICONS = 3, ORDER_SONIC = 16 };

// physics and animation (engine/constants.js)
#define Q8 256.0
#define SPRITE_OFFSET_Y 14
#define FRICTION (8.0 / 256)
#define ACCELERATION (8.0 / 256)
#define DECELERATION (96.0 / 256)
#define MAX_RUN_SPEED 4.5
#define RUN_ANIM_SPEED 4.5
#define REVERSE_KICK (96.0 / 256)
#define BRAKE_MIN_SPEED 3.0
#define WALL_MIN_SPEED 1.875
#define SLIP_LOCK 30
#define ROLL_DECELERATION (24.0 / 256)
#define FORCED_ROLL_SPEED 3.0
#define BORED_DELAY 360
#define ANIM_NORMAL 0x10
#define ANIM_MIN_WALK 0x08

Act act;
int actHudFlash = -1;
static Sprite sonic;
static Sprite palAnim[2];
static uint32_t sonicVram;
static int hudTile = HUD_TILE;
// the insta-shield's flash (game.js spawnInstaShield): animation 50 variant 1, OAM order 8, following Sonic
static Sprite instaFlash;
static int instaFlashActive, instaFlashSlot;

static void insta_flash_spawn(void) {
  if (instaFlashActive) { vram_free((uint32_t)instaFlashSlot); instaFlashActive = 0; }
  instaFlashSlot = (int)vram_malloc(16);
  if ((uint32_t)instaFlashSlot == HEAP_END) { instaFlashSlot = -1; return; }
  sprite_init(&instaFlash);
  instaFlash.graphics.dest = (uint32_t)instaFlashSlot;
  instaFlash.graphics.anim = 50;
  instaFlash.variant = 1;
  instaFlash.animSpeed = 0x10;
  instaFlash.oamFlags = 8 << 6;
  instaFlash.frameFlags = (uint32_t)(2 << 12) | (act.player.facing > 0 ? SPRITE_X_FLIP : 0);
  instaFlashActive = 1;   // its first update, later this frame, shows the first frame as the original's task does
}
static void insta_flash_update(void) {
  if (!instaFlashActive) return;
  // 2: its last frame was shown last frame, as the original's task draws the frame its animation ends on
  if (instaFlashActive == 2) {
    vram_free((uint32_t)instaFlashSlot);
    instaFlashSlot = -1;
    instaFlashActive = 0;
    return;
  }
  int more = update_sprite(&instaFlash, 0);
  instaFlash.x = (int16_t)((int)__builtin_floor(act.player.x) - (int)act.cam.x);
  instaFlash.y = (int16_t)((int)__builtin_floor(act.player.y) - (int)act.cam.y);
  if (!more) instaFlashActive = 2;
}
static void insta_flash_draw(void) { if (instaFlashActive) display_sprite(&instaFlash); }

// the spin dash's and the brake's dust (game.js spawnDashDust and spawnBrakeDust, effects 746 to 748): the dash's
// follows Sonic's feet while he charges, the brake's stays where it appeared, flipped by the game's random numbers
#define DASH_DUST_ANIM 746
#define DASH_DUST_BIG_ANIM 747
#define BRAKE_DUST_ANIM 748
#define BRAKE_DUST_MAX 20
// every cloud shares the reserved tiles the original keeps for them, past the ring effect's and before the heap
#define BRAKE_DUST_VRAM (OBJ_VRAM + 0x2100)
static struct { int active, done, x, y; Sprite s; } brakeDust[BRAKE_DUST_MAX];
static int brakeDustCount;
static struct { int active, slot; Sprite s; } dashDust;
static int dustTiles(int anim) { int n = en_animation_tiles((uint16_t)anim, 0); return n < 1 ? 8 : n; }
static int feet_y(const Player *p) { return (int)__builtin_floor(p->y) + (p->inverted ? -p->offsetY : p->offsetY); }
static void brake_dust_spawn(void) {
  if (brakeDustCount >= BRAKE_DUST_MAX) return;
  int k = -1;
  for (int i = 0; i < BRAKE_DUST_MAX; i++) if (!brakeDust[i].active) { k = i; break; }
  if (k < 0) return;
  uint32_t r = front_random();
  brakeDust[k].active = 1; brakeDust[k].done = 0;
  brakeDust[k].x = (int)__builtin_floor(act.player.x); brakeDust[k].y = feet_y(&act.player);
  sprite_init(&brakeDust[k].s);
  brakeDust[k].s.graphics.dest = BRAKE_DUST_VRAM;
  brakeDust[k].s.graphics.anim = BRAKE_DUST_ANIM;
  brakeDust[k].s.variant = 0;
  brakeDust[k].s.animSpeed = 0x10;
  brakeDust[k].s.oamFlags = 8 << 6;
  brakeDust[k].s.frameFlags = (uint32_t)(2 << 12) | (r & 0x400 ? SPRITE_X_FLIP : 0) | (r & 0x800 ? SPRITE_Y_FLIP : 0);
  brakeDustCount++;
}
static void dash_dust_spawn(void) {
  if (dashDust.active) { vram_free((uint32_t)dashDust.slot); dashDust.active = 0; }
  uint32_t slot = vram_malloc((uint32_t)(dustTiles(DASH_DUST_ANIM) > dustTiles(DASH_DUST_BIG_ANIM) ? dustTiles(DASH_DUST_ANIM) : dustTiles(DASH_DUST_BIG_ANIM)));
  if (slot == HEAP_END) return;
  dashDust.active = 1; dashDust.slot = (int)slot;
  sprite_init(&dashDust.s);
  dashDust.s.graphics.dest = slot;
  dashDust.s.graphics.anim = DASH_DUST_ANIM;
  dashDust.s.variant = 0;
  dashDust.s.animSpeed = 0x10;
  dashDust.s.oamFlags = 8 << 6;
  dashDust.s.frameFlags = (uint32_t)(2 << 12) | (act.player.facing > 0 ? SPRITE_X_FLIP : 0) | (act.player.inverted ? SPRITE_Y_FLIP : 0);
}
static void dust_update(void) {
  for (int i = 0; i < BRAKE_DUST_MAX; i++) {
    if (!brakeDust[i].active) continue;
    // the original's task draws the frame its animation ends on, then ends on the next frame before drawing
    if (brakeDust[i].done) {
      brakeDust[i].active = 0; brakeDustCount--;
      continue;
    }
    if (!update_sprite(&brakeDust[i].s, 0)) brakeDust[i].done = 1;
  }
  if (!dashDust.active) return;
  Player *p = &act.player;
  if (!p->spinDashing) {
    // the effect's task ends on the frame the charge does, before it is drawn again
    vram_free((uint32_t)dashDust.slot);
    dashDust.active = 0;
    return;
  }
  int anim = p->dashAccel > 0x200 ? DASH_DUST_BIG_ANIM : DASH_DUST_ANIM;   // dashDustBigAbove
  if (dashDust.s.graphics.anim != anim) {
    dashDust.s.graphics.anim = (uint16_t)anim;
    dashDust.s.prevAnim = 0xFFFF;
    dashDust.s.frameFlags = (uint32_t)(2 << 12) | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
  }
  dashDust.s.x = (int16_t)((int)__builtin_floor(p->x) - (int)act.cam.x);
  dashDust.s.y = (int16_t)(feet_y(p) - (int)act.cam.y);
  update_sprite(&dashDust.s, 0);
}
static void dust_draw(void) {
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  for (int i = 0; i < BRAKE_DUST_MAX; i++) {
    if (!brakeDust[i].active) continue;
    brakeDust[i].s.x = (int16_t)(brakeDust[i].x - camX);
    brakeDust[i].s.y = (int16_t)(brakeDust[i].y - camY);
    display_sprite(&brakeDust[i].s);
  }
  if (dashDust.active) display_sprite(&dashDust.s);
}
static void dust_reset(void) {
  for (int i = 0; i < BRAKE_DUST_MAX; i++) brakeDust[i].active = 0;
  if (dashDust.active) { vram_free((uint32_t)dashDust.slot); dashDust.active = 0; }
  brakeDustCount = 0;
}

// --- the act's palette animations (engine/palettes.js, UpdateSpriteAnimation_BG) ---------------------------------
// Neo Green Hill's 814 and 815 cycle the waterfalls' colours one place every frame and the background's every
// 16 frames; they are the sprite tables' own animation scripts, run with their colours going to the background
/** Sonic's attack box (sprite hitbox slot 1) from his animation, relative to his centre; 0 when it is off. */
int act_player_attack_box(int *l, int *t, int *r, int *b) {
  if (sonic.hitboxes[1].index < 0) return 0;
  *l = sonic.hitboxes[1].left; *t = sonic.hitboxes[1].top;
  *r = sonic.hitboxes[1].right; *b = sonic.hitboxes[1].bottom;
  return 1;
}
/** Sonic's body box (slot 0), relative to his centre; 0 when it is off. */
int act_player_body_box(int *l, int *t, int *r, int *b) {
  if (sonic.hitboxes[0].index < 0) return 0;
  *l = sonic.hitboxes[0].left; *t = sonic.hitboxes[0].top;
  *r = sonic.hitboxes[0].right; *b = sonic.hitboxes[0].bottom;
  return 1;
}

static void palettes_init(void) {
  for (int i = 0; i < 2; i++) {
    sprite_init(&palAnim[i]);
    palAnim[i].graphics.anim = (uint16_t)(814 + i);
    palAnim[i].variant = 0;
    palAnim[i].animSpeed = 0x10;
  }
}
static void palettes_run(void) {
  for (int i = 0; i < 2; i++) update_sprite(&palAnim[i], 1);
}

// UpdateBgAnimationTiles (src/background.c): the layer's first animTileSize bytes are animated tiles; frame 0 is
// the tileset itself, and frame k is the k-th block of the same size after it. The camera's task steps it.
static Graphics animGfx;
static int animFrame, animDelayCount, animPending;
static void animate_stage_tiles(void) {
  Tilemap *t = &act.stage.front;
  // the original queues a step for the V-blank, which shows it on the next frame (UpdateBgAnimationTiles)
  if (animPending) {
    animPending = 0;
    animGfx.src = animFrame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(animFrame - 1) * t->animTileSize;
    animGfx.dest = 0; animGfx.size = t->animTileSize; animGfx.anim = 0; animGfx.ram = NULL;
    queue_graphics(&animGfx);
  }
  if (t->animFrameCount == 0) return;
  if (++animDelayCount < t->animDelay) return;
  animDelayCount = 0;
  if (++animFrame >= t->animFrameCount) animFrame = 0;
  animPending = 1;
}

// --- the copy's data (rom/tilemaps.js, rom/collision.js, rom/entities.js, rom/levels.js) -------------------------
static Tilemap read_tilemap(int index) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + index * 4);
  Tilemap t;
  memset(&t, 0, sizeof t);
  t.at = at;
  t.xTiles = (uint16_t)rom_u16(at); t.yTiles = (uint16_t)rom_u16(at + 2);
  t.animTileSize = (uint16_t)rom_u16(at + 4); t.animFrameCount = (uint8_t)rom_u8(at + 6); t.animDelay = (uint8_t)rom_u8(at + 7);
  t.tiles = rom_ptr(at + 8); t.tilesSize = rom_u32(at + 12);
  t.palette = rom_ptr(at + 16);
  t.paletteOffset = (uint16_t)rom_u16(at + 20); t.paletteLength = (uint16_t)rom_u16(at + 22);
  t.map = rom_ptr(at + 24); t.mapWidth = (uint16_t)rom_u16(at + 32); t.mapHeight = (uint16_t)rom_u16(at + 34);
  return t;
}

static Collision read_collision(int level) {
  uint32_t at = rom_ptr(OFFSET_COLLISION + level * 4);
  Collision c;
  memset(&c, 0, sizeof c);
  c.heights = rom_ptr(at); c.angles = rom_ptr(at + 4); c.metatiles = rom_ptr(at + 8);
  c.layers[0] = rom_ptr(at + 12); c.layers[1] = rom_ptr(at + 16); c.flags = rom_ptr(at + 20);
  c.levelX = (uint16_t)rom_u16(at + 24); c.levelY = (uint16_t)rom_u16(at + 26);
  c.width = (uint16_t)rom_u16(at + 28); c.height = (uint16_t)rom_u16(at + 30);
  return c;
}

static int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
static int clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static int js_round(double v) { return (int)__builtin_floor(v + 0.5); }
static int q8(double v) { return js_round(v * Q8); }
static int toward0(int v, int step) { return v > 0 ? (v - step > 0 ? v - step : 0) : v < 0 ? (v + step < 0 ? v + step : 0) : 0; }
static int sin8(int angle) { return SINE[(angle & 0xFF) * 4] >> 6; }
static int cos8(int angle) { return SINE[(angle & 0xFF) * 4 + 256] >> 6; }
// groundMode (engine/sensors.js, sub_8022D6C): the original's rounding at the 45° edges, where -32 is a wall
static int ground_mode(int rot) {
  int r = (int)(int8_t)rot;
  return ((r + (r > -0x20 && r <= 0 ? 0x20 : 0x1F)) & 0xFF) >> 6;
}
static int act_angle(const Player *p) { return p->inverted ? (-0x80 - p->rotation) & 0xFF : p->rotation; }

// tileAt, columnHeight, rowWidth and angle (engine/terrain.js)
static uint16_t tile_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = fdiv(tx, 12), my = fdiv(ty, 12), lx = tx - mx * 12, ly = ty - my * 12;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + my * c->levelX + mx);
  return (uint16_t)rom_u16(c->metatiles + (id * 144u + (uint32_t)ly * 12u + (uint32_t)lx) * 2u);
}
static int signed4(int v) { return v & 8 ? v - 16 : v; }
static int flip_height(int v) { return v == 0 || v == 8 ? v : v > 0 ? v - 8 : v + 8; }
static int platform_tile(int tile) { return (rom_u16(act.stage.collision.flags + (uint32_t)(tile >> 3) * 2u) >> ((tile & 7) * 2)) & 1; }
static int column_height(int px, int py, int layer) {
  const Collision *c = &act.stage.collision;
  px = clamp(px, 0, c->width - 1); py = clamp(py, 0, c->height - 1);
  uint16_t entry = tile_entry(layer, px >> 3, py >> 3), tile = entry & 0x3FF;
  int col = px & 7;
  if (entry & 0x400) col = 7 - col;
  int v = signed4(rom_u8(c->heights + (uint32_t)tile * 8u + (uint32_t)col) >> 4);
  if (v == -8) v = 8;
  if ((layer & IGNORE_PLATFORMS) && platform_tile(tile)) v = 0;
  return entry & 0x800 ? flip_height(v) : v;
}
static int row_width(int px, int py, int layer) {
  const Collision *c = &act.stage.collision;
  px = clamp(px, 0, c->width - 1); py = clamp(py, 0, c->height - 1);
  uint16_t entry = tile_entry(layer, px >> 3, py >> 3), tile = entry & 0x3FF;
  int row = py & 7;
  if (entry & 0x800) row = 7 - row;
  int v = signed4(rom_u8(c->heights + (uint32_t)tile * 8u + (uint32_t)row) & 15);
  if (v == -8) v = 8;
  if ((layer & IGNORE_PLATFORMS) && platform_tile(tile)) v = 0;
  return entry & 0x400 ? flip_height(v) : v;
}
static int surface_angle(int px, int py, int layer) {
  const Collision *c = &act.stage.collision;
  uint16_t entry = tile_entry(layer, clamp(px, 0, c->width - 1) >> 3, clamp(py, 0, c->height - 1) >> 3);
  int a = rom_u8(c->angles + (entry & 0x3FF));
  if (entry & 0x400) a = -a;
  if (entry & 0x800) a = 0x80 - a;
  return a & 0xFF;
}

typedef struct { int v, rot, hasRot; } Probe;
static Probe probe_floor(int p0, int p1, int layer) { Probe p; p.v = column_height(p1, p0, layer); p.rot = surface_angle(p1, p0, layer); p.hasRot = 1; return p; }
static Probe probe_wall(int p0, int p1, int layer) { Probe p; p.v = row_width(p0, p1, layer); p.rot = surface_angle(p0, p1, layer); p.hasRot = 1; return p; }

typedef struct { int d, rot, hasRot; } Scan;
// sub_801E4E4: the original's terrain scan
static Scan scan(int floor, int p0, int p1, int layer, int step) {
  int fwd = step > 0, r = p0 & 7;
  Probe t0 = floor ? probe_floor(p0, p1, layer) : probe_wall(p0, p1, layer);
  Scan out;
  out.hasRot = 1;
  if (t0.v != 0 && t0.v != 8) {
    out.d = t0.v > 0 ? t0.v - 1 - r : t0.v + r; out.rot = t0.rot; return out;
  }
  if (t0.v == 0) {
    Probe t1 = floor ? probe_floor(p0 + step, p1, layer) : probe_wall(p0 + step, p1, layer);
    if (t1.v == 8) { out.d = fwd ? 7 - r : r; out.rot = t1.rot; return out; }
    if (t1.v != 0) { out.d = (t1.v > 0 ? t1.v - 1 - r : t1.v + r) + 8; out.rot = t1.rot; return out; }
    Probe t2 = floor ? probe_floor(p0 + 2 * step, p1, layer) : probe_wall(p0 + 2 * step, p1, layer);
    if (t2.v == 8) { out.d = fwd ? 15 - r : r + 8; out.rot = t2.rot; return out; }
    if (t2.v != 0) { out.d = (t2.v > 0 ? t2.v - 1 - r : t2.v + r) + 16; out.rot = t2.rot; return out; }
    out.d = fwd ? 24 - r : r + 17; out.hasRot = 0; out.rot = 0; return out;
  }
  Probe b1 = floor ? probe_floor(p0 - step, p1, layer) : probe_wall(p0 - step, p1, layer);
  if (b1.v == 0) { out.d = fwd ? -1 - r : r - 8; out.rot = t0.rot; return out; }
  if (b1.v != 8) { out.d = (b1.v > 0 ? b1.v - 1 - r : b1.v + r) - 8; out.rot = b1.rot; return out; }
  Probe b2 = floor ? probe_floor(p0 - 2 * step, p1, layer) : probe_wall(p0 - 2 * step, p1, layer);
  if (b2.v == 0) { out.d = fwd ? -9 - r : r - 16; out.rot = b1.rot; return out; }
  if (b2.v != 8) { out.d = (b2.v > 0 ? b2.v - 1 - r : b2.v + r) - 16; out.rot = b2.rot; return out; }
  out.d = fwd ? -17 - r : r - 24; out.rot = b2.rot; return out;
}

// --- the stage (rom/extract.js extractStage, engine/stage.js) -----------------------------------------------------
// The copies stay in memory until the V-blank takes them: the queue keeps the pointers, not copies (engine.c).
static Graphics copies[8];
static int copyCount;
static void copy_rom(uint32_t src, uint32_t dest, uint32_t size) {
  if (copyCount >= 8) return;
  Graphics *g = &copies[copyCount++];
  g->src = src; g->dest = dest; g->size = size & 0xFFFF; g->anim = 0; g->ram = NULL;
  queue_graphics(g);
}
static void load_stage(int level) {
  Stage *s = &act.stage;
  memset(s, 0, sizeof *s);
  s->level = level;
  s->front = read_tilemap(level * 3 + 0);
  s->back = read_tilemap(level * 3 + 1);
  s->background = read_tilemap(level * 3 + 2);
  s->collision = read_collision(level);
  s->spawnX = rom_s16(OFFSET_SPAWNS + level * 4);
  s->spawnY = rom_s16(OFFSET_SPAWNS + level * 4 + 2);
  s->loopX = rom_s16(OFFSET_LOOP_POINTS + level * 4);
  s->loopShift = rom_s16(OFFSET_LOOP_SHIFTS + level * 4);
  s->width = s->collision.width; s->height = s->collision.height;
  // StageInit_ZoneNActM (rom/levels.js): the song and what the HUD's zero-ring counter finds as the level starts
  if (level == 0) { s->zone = 0; s->act = 0; s->music = 12; s->hudFlash = 90; }
  else { s->zone = 6; s->act = 0; s->music = 24; s->hudFlash = 90; }
  // the front layer's tiles, in the first character block, and the stage's own colours: the front tilemap's
  // paletteOffset and paletteLength, the rest of the palette RAM keeping what it had (extractStage's palette)
  copy_rom(s->front.tiles, 0, s->front.tilesSize);
  for (int i = 0; i < s->front.paletteLength; i++)
    e.bgPalette[(s->front.paletteOffset + i) & 0xFF] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the background's tiles at the second character block, and its map: Neo Green Hill's 32 × 32 one at 0xE800
  // (BG3's map base, InitCamera), X Zone's 37 × 23 one at 0xE000, whose columns 32–36 go to the block at 0xE800
  copy_rom(s->background.tiles, 0x8000, s->background.tilesSize);
  uint32_t backgroundMap = s->zone == 6 ? 0xE000 : 0xE800;
  for (int row = 0; row < s->background.yTiles; row++) {
    for (int col = 0; col < s->background.xTiles; col++) {
      uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
      uint32_t at = s->zone == 6
        ? (col < 32 ? 0xE000 + (uint32_t)col * 2u : 0xE800 + (uint32_t)(col - 32) * 2u) + (uint32_t)row * 64u
        : backgroundMap + (uint32_t)col * 2u + (uint32_t)row * 64u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
  }
  // the layers' maps start clear: InitCamera's first RenderMetatileLayers fills only the window around the camera
  if (s->zone != 6) memset(gba_vram + 0xF000, 0, 0x1000);
  // InitCamera's registers: BG1 the front layer, BG2 the back one, BG3 the background, all 16 colours
  e.dispCnt = 0x304E;           // OBJ on, window 0 on, BG1, BG2 and BG3 on, 1D OAM
  e.bgCnt[1] = 0x1E01;          // 256 × 256, priority 1, map 30 (0xF000), character base 0
  e.bgCnt[2] = 0x1F02;          // 256 × 256, priority 2, map 31 (0xF800), character base 0
  // Neo Green Hill's background is a 256 × 256 plain map, X Zone's 512 × 256 (InitCamera, by zone)
  e.bgCnt[3] = s->zone == 6 ? 0x5C0B : 0x1D0B;
}

// a stage layer's visible tile entries around the camera (DrawBackground's level-map path)
static uint16_t stage_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = fdiv(tx, 12), my = fdiv(ty, 12), lx = tx - mx * 12, ly = ty - my * 12;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + my * c->levelX + mx);
  uint32_t map = (layer & 1) ? act.stage.back.map : act.stage.front.map;
  return (uint16_t)rom_u16(map + (id * 144u + (uint32_t)ly * 12u + (uint32_t)lx) * 2u);
}
static void fill_layer(uint32_t dest, int layer, int camX, int camY) {
  int tx0 = camX >> 3, ty0 = camY >> 3;
  for (int row = 0; row < 21; row++) {
    for (int col = 0; col < 31; col++) {
      uint16_t entry = stage_entry(layer, tx0 + col, ty0 + row);
      uint32_t at = dest + (uint32_t)(row * 32 + col) * 2u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
  }
}

// --- the camera (engine/camera.js createCamera and updateCamera) ---------------------------------------------------
static void create_camera(Camera *c, const Player *p) {
  memset(c, 0, sizeof *c);
  c->x = (int)__builtin_floor(p->x) - SCREEN_W_ / 2;
  c->y = (int)__builtin_floor(p->y) - (SCREEN_H_ / 2 + 4);
  c->targetX = c->x; c->targetY = c->y;
  c->offsetY = p->offsetY - 4;
  c->minX = 0; c->minY = 0;
  c->maxX = act.stage.width - SCREEN_W_; c->maxY = act.stage.height - SCREEN_H_;
  c->speedX = 16; c->speedY = 12;
  c->width = act.stage.width; c->height = act.stage.height;
  c->lookDelay = 120;
}
static void camera_update(Camera *c, const Player *p) {
  if (!c->started) { c->started = 1; return; }
  c->x = clamp((int)c->x, c->minX, c->maxX - 1);
  c->y = clamp((int)c->y, c->minY, c->maxY - 1);
  if (c->look > 0) c->look = c->look > 2 ? c->look - 2 : 0;
  else if (c->look < 0) c->look = c->look < -2 ? c->look + 2 : 0;
  if (c->freeze > 0) c->freeze--;
  else if (!c->locked) {
    c->targetX = (int)__builtin_floor(p->x) + c->shiftX - SCREEN_W_ / 2;
    int want = (p->offsetY - 4) * (p->inverted ? -1 : 1);
    if (c->offsetY < want) c->offsetY = c->offsetY + 5 < want ? c->offsetY + 5 : want;
    else if (c->offsetY > want) c->offsetY = c->offsetY - 5 > want ? c->offsetY - 5 : want;
    c->targetY = (int)__builtin_floor(p->y) + c->shiftY - SCREEN_H_ / 2 + c->look + c->offsetY;
  }
  int dx = (int)c->targetX - (int)c->x;
  // at most its speed a frame, which the results set to 0 to hold it
  if (dx > 8) c->x += dx - 8 > c->speedX ? c->speedX : dx - 8;
  else if (dx < -8) c->x += dx + 8 < -c->speedX ? -c->speedX : dx + 8;
  int air = p->air;
  c->deadY = air ? (c->deadY + 4 < 24 ? c->deadY + 4 : 24) : (c->deadY - 4 > 0 ? c->deadY - 4 : 0);
  int dy = (int)c->targetY - (int)c->y;
  if (dy > c->deadY) c->y += dy - c->deadY > c->speedY ? c->speedY : dy - c->deadY;
  else if (dy < -c->deadY) c->y += dy + c->deadY < -c->speedY ? -c->speedY : dy + c->deadY;
  c->x = clamp((int)c->x, c->minX, c->maxX);
  c->y = clamp((int)c->y, c->minY, c->maxY);
  c->x += c->shakeX; c->y += c->shakeY;
}

// --- Sonic (engine/player.js, the ground movement this piece needs) ----------------------------------------------
static void set_offset_y(Player *p, int soy) {
  int dlt = soy - p->offsetY;
  if (!dlt) return;
  int mode = ground_mode(act_angle(p));
  if (mode == 0) p->y -= dlt; else if (mode == 1) p->x += dlt; else if (mode == 2) p->y += dlt; else p->x -= dlt;
  p->offsetY = soy;
}
static void create_player(Player *p, int x, int y) {
  memset(p, 0, sizeof *p);
  p->x = x; p->y = y; p->facing = 1; p->state = PS_IDLE;
  p->layer = LAYER_BACK; p->offsetY = SPRITE_OFFSET_Y; p->idleT = BORED_DELAY;
  p->anim = SONIC_IDLE; p->variant = 0; p->animSpeed = ANIM_NORMAL;
}
static void along_surface(Player *p) {
  int g = q8(p->gsp);
  p->xsp = ((g * cos8(p->rotation)) >> 8) / Q8;
  p->ysp = ((g * sin8(p->rotation)) >> 8) / Q8;
}
static void slope(Player *p) {
  if (((p->rotation + 0x60) & 0xFF) >= 0xC0 || p->gsp == 0) return;
  p->gsp = (q8(p->gsp) + ((sin8(p->rotation) * 3) >> 5)) / Q8;
}
// rolling downhill only gets a quarter of the pull while it fights his way up
static void roll_slope(Player *p) {
  if (((p->rotation + 0x60) & 0xFF) >= 0xC0 || p->gsp == 0) return;
  int acc = (sin8(p->rotation) * 60) >> 8;
  if ((p->gsp > 0 && acc <= 0) || (p->gsp < 0 && acc >= 0)) acc >>= 2;
  p->gsp = (q8(p->gsp) + acc) / Q8;
}
static void walk(Player *p, int dir) {
  if (p->gsp * dir >= 0) {
    if (p->facing != dir) { p->state = PS_TURN; p->pushing = 0; set_offset_y(p, SPRITE_OFFSET_Y); }
    p->facing = dir;
    double g = p->gsp + ACCELERATION * dir;
    if (g * dir > MAX_RUN_SPEED) {
      g -= ACCELERATION * dir;
      if (g * dir < MAX_RUN_SPEED) g = MAX_RUN_SPEED * dir;
    }
    p->gsp = g;
    if (p->state != PS_TURN && !p->curled && !p->actClear && !p->halfPipe) { p->state = PS_WALK; set_offset_y(p, SPRITE_OFFSET_Y); }
  } else {
    double g = p->gsp + DECELERATION * dir;
    if (g * dir > 0) g = REVERSE_KICK * dir;
    p->gsp = g;
    // the skid sound restarts on every frame Sonic is still this fast
    if (g * dir <= -BRAKE_MIN_SPEED) { play_song(115); p->state = PS_BRAKE; set_offset_y(p, SPRITE_OFFSET_Y); }
  }
}
static int wall_push(Player *p, int rolling);
// rolling (Player_8043DDC): a roll that stops stands him up, half the walking acceleration slowing it
static void roll_step(Player *p, int dir, int sideways, int down) {
  if (dir && !p->lock) {
    if (p->gsp * dir >= 0) p->facing = dir;
    else {
      p->gsp += ROLL_DECELERATION * dir;
      if (p->gsp * dir > 0) p->gsp = REVERSE_KICK * dir;
    }
  }
  p->gsp = toward0(q8(p->gsp), q8(ACCELERATION / 2)) / Q8;
  if (p->gsp == 0 && p->forcedRoll) { p->gsp = FORCED_ROLL_SPEED * p->facing; play_song(109); }
  else if (p->gsp == 0) { p->curled = 0; set_offset_y(p, SPRITE_OFFSET_Y); p->state = down ? PS_CROUCH : PS_WALK; }
  (void)sideways;
  along_surface(p);
  if (wall_push(p, 1) && p->curled) { p->curled = 0; set_offset_y(p, SPRITE_OFFSET_Y); p->state = PS_WALK; }
}
static void walk_input(Player *p, int dir, int sideways) {
  if (dir) walk(p, dir);
  else if (!sideways) {
    if (p->gsp != 0) {
      if (p->state == PS_BRAKE || p->state == PS_IDLE) p->state = PS_WALK;
    } else {
      if (p->state == PS_CROUCH) p->state = PS_CROUCH_END;
      else if (p->state == PS_LOOKUP) p->state = PS_LOOKUP_END;
      else if (p->state != PS_CROUCH_END && p->state != PS_LOOKUP_END) p->state = PS_IDLE;
    }
  }
  if (dir || sideways) p->idleT = BORED_DELAY;
  if (!((p->rotation + 0x20) & 0xC0) && p->gsp == 0) {
    p->pushing = 0;
    if (p->state != PS_CROUCH_END && p->state != PS_LOOKUP_END) p->state = PS_IDLE;
  }
}

// Player_HandleInputs' look: up looks up, and down crouches, or curls him into a roll while he moves
static void look_input(Player *p, int up, int down) {
  if (p->state == PS_CROUCH || p->state == PS_CROUCH_END) {
    if (!down) p->state = PS_CROUCH_END;
  }
  if (up && !down) { if (p->gsp == 0) p->state = PS_LOOKUP; }
  else if (down && !up) {
    p->state = PS_CROUCH;
    if (p->gsp != 0) { p->curled = 1; set_offset_y(p, 9); p->state = PS_SPIN; play_song(109); }
  } else if (!up && !down) {
    if (p->state == PS_CROUCH) p->state = PS_CROUCH_END;
    else if (p->state == PS_LOOKUP) p->state = PS_LOOKUP_END;
  }
}

#define REACH 8
// wallPush (engine/sensors.js): the scan against the wall he moves into, putting him back out of it, and the push
// state when it stops him
static int wall_push(Player *p, int rolling) {
  if (p->gsp == 0) return 0;
  int a = (p->rotation + (p->gsp >= 0 ? -0x40 : 0x40)) & 0xFF;
  p->rotA = p->rotB = (uint8_t)a;
  int sa = s8(a), up = ((a + 0x20) & 0xFF) >= 0x01 && ((a + 0x20) & 0xFF) <= 0x7F;
  int q = ((a + (up == (sa <= 0) ? 0x20 : 0x1F)) & 0xFF) >> 6;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  int d = q == 0 ? scan(1, y + REACH, x, p->layer, 8).d
        : q == 1 ? scan(0, x - REACH, y, p->layer, -8).d
        : q == 2 ? scan(1, y - REACH, x, p->layer, -8).d
        : scan(0, x + REACH, y, p->layer, 8).d;
  if (d > 0) return 0;
  switch (((a + 0x20) & 0xC0) >> 6) {
    case 0: p->y += d; p->ysp = 0; return 0;
    case 1: p->x -= d; p->xsp = 0; p->gsp = 0; p->pushing |= !rolling; return 1;
    case 2: p->y -= d; p->ysp = 0; p->air = 1; return 0;
    default: p->x += d; p->xsp = 0; p->gsp = 0; p->pushing |= !rolling; return 1;
  }
}
static void ground_sensors(Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), soy = p->offsetY;
  int mode = ground_mode(act_angle(p));
  Scan a, b; double speed;
  if (mode == 0) { a = scan(1, y + soy, x - 8, p->layer, 8); b = scan(1, y + soy, x + 8, p->layer, 8); speed = p->xsp; }
  else if (mode == 1) { a = scan(0, x - soy, y - 8, p->layer, -8); b = scan(0, x - soy, y + 8, p->layer, -8); speed = p->ysp; }
  else if (mode == 2) { a = scan(1, y - soy, x + 8, p->layer, -8); b = scan(1, y - soy, x - 8, p->layer, -8); speed = p->xsp; }
  else { a = scan(0, x + soy, y + 8, p->layer, 8); b = scan(0, x + soy, y - 8, p->layer, 8); speed = p->ysp; }
  if (a.hasRot) p->rotA = (uint8_t)a.rot;
  if (b.hasRot) p->rotB = (uint8_t)b.rot;
  int val = a.d < b.d ? a.d : b.d, rot = a.d < b.d ? p->rotA : p->rotB;
  if (val < -11) return;
  int limit = (int)__builtin_floor(__builtin_fabs(speed)) + 3;
  if (limit > 11) limit = 11;
  if (val > 0 && val > limit) { p->air = 1; p->pushing = 0; return; }
  if (mode == 0) p->y += val; else if (mode == 1) p->x -= val; else if (mode == 2) p->y -= val; else p->x += val;
  if (!(rot & 1)) p->rotation = p->inverted ? (uint8_t)(-0x80 - rot) : (uint8_t)rot;
}
static void follow_ground(Player *p) { ground_sensors(p); }
// walls, ceilings and steep slopes drop him when he is too slow for them, and lock his controls for 30 frames
static void fall_off(Player *p) {
  if (p->lock) { p->lock--; return; }
  if (((p->rotation + 0x20) & 0xC0) && __builtin_fabs(p->gsp) < WALL_MIN_SPEED) {
    p->gsp = 0; p->air = 1; p->lock = SLIP_LOCK;
  }
}
static void move_player(Player *p) {
  p->x += p->xsp;
  if (p->inverted != p->wasInverted) p->ysp = -p->ysp;
  p->y += p->inverted ? -p->ysp : p->ysp;
}

// --- Sonic in the air (engine/player.js airStep, engine/sensors.js) ------------------------------------------------
static void bounds(Player *p);
static void move_player(Player *p);
static void follow_ground(Player *p);
#define AIR_ACCEL (16.0 / 256)
#define GRAVITY (42.0 / 256)
#define JUMP_SPEED 4.875
#define JUMP_RELEASE_CAP 3.0
#define RISE_CAP 11.8125
#define AIR_DRAG_SHIFT 5

static int s8v(int a) { return (int)(int8_t)a; }
static int arc_tan(int i) {
  int a = -((i * i) >> 14), b = ((0xA9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91C; b = ((b * a) >> 14) + 0xFB6; b = ((b * a) >> 14) + 0x16AA;
  b = ((b * a) >> 14) + 0x2081; b = ((b * a) >> 14) + 0x3651; b = ((b * a) >> 14) + 0xA2F9;
  return (i * b) >> 16;
}
// the GBA BIOS's ArcTan2, as mGBA reimplements it: x and y are s16, 65536 steps a turn
static int arc_tan2(int x, int y) {
  int r;
  if (!y) r = x >= 0 ? 0 : 0x8000;
  else if (!x) r = y >= 0 ? 0x4000 : 0xC000;
  else if (y >= 0) {
    if (x >= 0 && x >= y) r = arc_tan(y * 16384 / x);
    else if (x < 0 && -x >= y) r = arc_tan(y * 16384 / x) + 0x8000;
    else r = 0x4000 - arc_tan(x * 16384 / y);
  } else {
    if (x <= 0 && -x > -y) r = arc_tan(y * 16384 / x) + 0x8000;
    else if (x > 0 && x >= -y) r = arc_tan(y * 16384 / x) + 0x10000;
    else r = 0xC000 - arc_tan(x * 16384 / y);
  }
  return r & 0xFFFF;
}

typedef struct { int d, rot, out, hasRot; } Pair;
static Pair pair_of(Scan a, Scan b) {
  Pair r;
  if (a.d < b.d) { r.d = a.d; r.rot = a.rot; r.hasRot = a.hasRot; r.out = b.d; }
  else { r.d = b.d; r.rot = b.rot; r.hasRot = b.hasRot; r.out = a.d; }
  return r;
}
static Pair floor_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) + p->offsetY;
  int m = p->layer | (p->ysp < 0 ? IGNORE_PLATFORMS : 0);
  return pair_of(scan(1, y, x - REACH, m, 8), scan(1, y, x + REACH, m, 8));
}
static Pair ceiling_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) - p->offsetY;
  int m = p->layer | (p->ysp < 3 ? IGNORE_PLATFORMS : 0);
  return pair_of(scan(1, y, x - REACH, m, -8), scan(1, y, x + REACH, m, -8));
}
static Pair left_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x) - REACH, y = (int)__builtin_floor(p->y);
  int m = p->layer | (p->ysp < 3 ? IGNORE_PLATFORMS : 0);
  return pair_of(scan(0, x, y - p->offsetY, m, -8), scan(0, x, y + p->offsetY, m, -8));
}
static Pair right_pair(const Player *p) {
  int x = (int)__builtin_floor(p->x) + REACH, y = (int)__builtin_floor(p->y);
  int m = p->layer | (p->ysp < 3 ? IGNORE_PLATFORMS : 0);
  return pair_of(scan(0, x, y - p->offsetY, m, 8), scan(0, x, y + p->offsetY, m, 8));
}
static int sensed_rot(Pair p) { return p.hasRot && (p.rot & 1) ? 0 : p.rot; }
static int clearance(const Player *p, int angle) {
  int q = ((angle + 0x20) & 0xC0) >> 6;
  Pair r = q == 0 ? floor_pair(p) : q == 1 ? left_pair(p) : q == 2 ? ceiling_pair(p) : right_pair(p);
  return r.d;
}
static int air_wall(Player *p, int dir) {
  int m = p->layer | (p->ysp < 3 ? IGNORE_PLATFORMS : 0);
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  Scan s = scan(0, x + dir * (3 + 6), y, m, 8 * dir);
  if (s.d > 0) return 0;
  p->x += dir * s.d; p->xsp = 0;
  return 1;
}
static void landing_speed(Player *p, int rot) {
  int sign = s8v(rot) < 0 ? -1 : 1;
  if ((rot + 0x20) & 0x40) { p->xsp = 0; if (p->ysp > 11.8125) p->ysp = 11.8125; p->gsp = __builtin_fabs(p->ysp) * sign; }
  else if (!((rot + 0x10) & 0x20)) { p->ysp = 0; p->gsp = p->xsp; }
  else { p->ysp = __builtin_floor(p->ysp * 128) / 256; p->gsp = __builtin_fabs(p->ysp) * sign; }
}
static void land(Player *p) {
  p->air = 0; p->jumped = 0; p->midAir = 0; p->pushing = 0; p->halfPipe = 0; if (!p->actClear) p->state = PS_WALK;
  if (p->curled) { p->curled = 0; set_offset_y(p, SPRITE_OFFSET_Y); }
  p->offsetY = SPRITE_OFFSET_Y; p->airLock = 0; p->chain = 0;
}
static void upright(Player *p) {
  int r = s8v(p->rotation);
  p->rotation = (uint8_t)((r > 0 ? (r > 2 ? r - 2 : 0) : (r < -2 ? r + 2 : 0)) & 0xFF);
}
// off a bounce block he tumbles the way he faces rather than easing upright (Player_8047224)
static void tumble(Player *p) {
  if (p->state == PS_BOUNCE) p->rotation = (uint8_t)((p->rotation + 4 * p->facing) & 0xFF);
  else upright(p);
}
static void air_collision(Player *p) {
  int vx = (int)js_round(p->xsp * 256), vy = (int)js_round(p->ysp * 256);
  int a = (vx || vy) ? arc_tan2(s16(vx), s16(vy)) >> 8 : 0;
  switch (((a - 0x20) & 0xC0) >> 6) {
    case 0: {
      air_wall(p, -1); air_wall(p, 1);
      Pair f = floor_pair(p);
      if (f.d >= 0 || f.out < -((int)__builtin_floor(p->ysp) + 6)) return;
      p->rotation = (uint8_t)sensed_rot(f); p->y += f.d;
      land(p); landing_speed(p, sensed_rot(f));
      return;
    }
    case 2: {
      air_wall(p, -1); air_wall(p, 1);
      Pair c = ceiling_pair(p);
      if (c.d > 0) return;
      p->y -= c.d;
      int rot = sensed_rot(c);
      if (((rot + 0x20) & 0x40) && s8v(rot) > 0x40) { p->rotation = (uint8_t)rot; land(p); p->gsp = __builtin_fabs(p->ysp); return; }
      p->ysp = 0;
      return;
    }
    default: {
      int dir = a >= 0x60 && a < 0xA0 ? -1 : 1;
      if (air_wall(p, dir)) p->gsp = p->ysp;
      Pair c = ceiling_pair(p);
      if (c.d <= 0) {
        p->y -= c.d;
        if (p->ysp < 0) p->ysp = 0;
      } else if (p->ysp >= 0) {
        Pair f = floor_pair(p);
        if (f.d > 0) return;
        p->y += f.d; p->rotation = (uint8_t)sensed_rot(f);
        land(p); p->ysp = 0; p->gsp = p->xsp;
      }
    }
  }
}
static void air_control(Player *p, int dir, int turn) {
  if (p->airLock || !dir) return;
  if (turn) p->facing = dir;
  double v = p->xsp + AIR_ACCEL * dir;
  if (v * dir > MAX_RUN_SPEED) {
    v -= AIR_ACCEL * dir;
    if (v * dir < MAX_RUN_SPEED) v = MAX_RUN_SPEED * dir;
  }
  p->xsp = v;
}
static void air_drag(Player *p) {
  double drag = __builtin_floor(p->xsp * 256 / 32) / 256;
  p->xsp = p->xsp > 0 ? (p->xsp - drag > 0 ? p->xsp - drag : 0) : p->xsp < 0 ? (p->xsp - drag < 0 ? p->xsp - drag : 0) : 0;
}
#define SPIN_DASH_REV 0x200
#define SPIN_DASH_REV_MIN 0x800
// spin dash: starts from a crouch with jump, revs with jump, releases when down is let go
static int try_spin_dash(Player *p, int down, int jumpPressed) {
  if (!p->spinDashing) {
    if (p->state != PS_CROUCH || !jumpPressed) return 0;
    p->state = PS_SPIN_DASH; p->spinDashing = 1; p->dashAccel = 0;
    set_offset_y(p, 9);
    play_song(109);
    dash_dust_spawn();
    return 1;
  }
  if (!down) {
    p->spinDashing = 0;
    int i = p->dashAccel >> 8;
    if (i > 17) i = 17;
    p->gsp = (double)rom_s16(0x4A7084 + (uint32_t)i * 2) / 256 * p->facing;
    p->curled = 1; p->state = PS_SPIN;
    play_song(110);
    act.cam.freeze = 10;   // the camera target stays put for ten frames (CAMERA.spinDashFreeze)
    return 1;
  }
  int a = p->dashAccel;
  if (a != 0) { a -= (a << 3) >> 8; if (a <= 0) a = 0; }
  if (p->state != PS_SPIN_DASH_REV) p->state = PS_SPIN_DASH;
  if (jumpPressed) {
    p->state = PS_SPIN_DASH_REV;
    a = a + SPIN_DASH_REV < SPIN_DASH_REV_MIN ? SPIN_DASH_REV_MIN : a + SPIN_DASH_REV;
    play_song(109);
  }
  p->dashAccel = a;
  return 1;
}
static int try_jump(Player *p, int jumpPressed) {
  if (!jumpPressed || clearance(p, (p->rotation + 0x80) & 0xFF) < 4) return 0;
  p->air = 1; p->jumped = 1; p->pushing = 0; p->halfPipe = 0; p->state = PS_SPIN;
  int a = (p->rotation - 0x40) & 0xFF, jump = q8(JUMP_SPEED);
  p->xsp = (q8(p->xsp) + ((jump * cos8(a)) >> 8)) / Q8;
  p->ysp = (q8(p->ysp) + ((jump * sin8(a)) >> 8)) / Q8;
  if (p->curled) p->airLock = 1;
  else { p->curled = 1; set_offset_y(p, 9); }
  play_song(116);
  return 1;
}
static void air_step(Player *p, int dir, int jump, int jumpPressed) {
  if (p->jumped) {
    if (p->ysp < -JUMP_RELEASE_CAP) { if (!jump) p->ysp = -JUMP_RELEASE_CAP; }
    else if (p->midAir == 0 && jumpPressed) {
      // Player_8044670: the insta-shield, its flash starting this frame and following him
      p->airLock = 0; p->midAir = 1; p->state = PS_INSTA;
      play_song(113);
      insta_flash_spawn();
    }
  } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;
  air_control(p, dir, p->state != PS_BOUNCE);
  if (p->ysp < 0) air_drag(p);
  bounds(p);
  move_player(p);
  p->ysp += GRAVITY;
  tumble(p);
  air_collision(p);
}

static int loopDrawX = -1;
static void bounds(Player *p) {
  // past the act's loop point, Sonic and the camera go back by its distance while the camera moves
  if (act.stage.loopX >= 0 && p->x >= act.stage.loopX && act.cam.speedX != 0 && !act.cam.locked) {
    loopDrawX = (int)act.cam.x;
    p->x += act.stage.loopShift; act.cam.x += act.stage.loopShift; act.cam.wrapped += act.stage.loopShift;
  }
  double maxX = act.cam.maxX + SCREEN_W_ - 1.0 / Q8, maxY = act.cam.maxY + SCREEN_H_ - 1.0 / Q8;
  if (!p->dead && (p->inverted ? p->y <= act.cam.minY : p->y >= maxY)) { p->dead = 1; p->ysp = -4.875; p->y = p->inverted ? act.cam.minY : maxY; }
  if (p->x < act.cam.minX || p->x > maxX) { p->x = p->x < act.cam.minX ? act.cam.minX : maxX; p->xsp = 0; p->gsp = 0; }
  if (p->y < act.cam.minY) { p->y = act.cam.minY; p->ysp = 0; p->gsp = 0; }
  if (p->inverted && p->y > maxY) { p->y = maxY; p->ysp = 0; p->gsp = 0; }
}
static void step_player(Player *p, int left, int right, int up, int down, int jump, int jumpPressed, int attack, int attackPressed) {
  int sideways = left || right;
  int dir = left && !right ? -1 : right && !left ? 1 : 0;
  (void)attack; (void)attackPressed;
  if (p->dead) return;
  if (p->air) { air_step(p, dir, jump, jumpPressed); return; }
  if (try_spin_dash(p, down && !sideways, jumpPressed)) {
    bounds(p); follow_ground(p);
    return;
  }
  if (try_jump(p, jumpPressed)) return;
  if (p->curled) {
    roll_slope(p);
    roll_step(p, dir, sideways, down && !sideways);
  } else {
    slope(p);
    if (!p->lock) walk_input(p, dir, sideways);
    look_input(p, up && !sideways, down && !sideways);
    if (!sideways) p->gsp = toward0(q8(p->gsp), q8(FRICTION)) / Q8;
    along_surface(p);
    wall_push(p, 0);
  }
  bounds(p);
  move_player(p);
  follow_ground(p);
  fall_off(p);
}

void act_start_clear(void) {
  Player *p = &act.player;
  land(p);
  p->state = PS_ACT_CLEAR_RUN;
  p->actClear = 1;
}

// chooseAnimation and tickAnim (engine/player.js, engine/animator.js)
static void choose_animation(Player *p) {
  double speed = __builtin_fabs(p->gsp);
  int oldState = p->state;
  int anim = SONIC_IDLE, variant = 0, speedAnim = ANIM_NORMAL;
  if (p->pushing) anim = SONIC_PUSH;
  else if (p->state == PS_CROUCH || p->state == PS_CROUCH_END) anim = 3;
  else if (p->state == PS_LOOKUP || p->state == PS_LOOKUP_END) anim = 2;
  else if (p->state == PS_SPIN) anim = 8;
  else if (p->state == PS_BOUNCE) { anim = SONIC_WALK; variant = 0; }   // the walk animation (charState 23)
  else if (p->state == PS_SPRING) anim = 11;            // the somersault off a spring (charState 17)
  else if (p->state == PS_SPRING_RISE) { anim = 10; variant = 0; }   // rising (21), topping out (18) and falling (19)
  else if (p->state == PS_SPRING_PEAK) { anim = 10; variant = 1; }
  else if (p->state == PS_SPRING_FALL) { anim = 10; variant = 2; }
  else if (p->state == PS_POLE) anim = 38;              // hanging from a wall pole (charState 31)
  else if (p->state == PS_SPIN_DASH) { anim = 18; variant = 0; }
  else if (p->state == PS_SPIN_DASH_REV) { anim = 18; variant = 1; }
  else if (p->state == PS_HALF_PIPE_LOW || p->state == PS_HALF_PIPE_MID || p->state == PS_HALF_PIPE_HIGH) {
    anim = 36;
    variant = p->state == PS_HALF_PIPE_LOW ? 0 : p->state == PS_HALF_PIPE_MID ? 1 : 2;
    int s = (int)__builtin_floor(speed * 256) >> 4;
    speedAnim = s < ANIM_MIN_WALK ? ANIM_MIN_WALK : s > ANIM_NORMAL ? ANIM_NORMAL : s;
  }
  else if (p->state == PS_ACT_CLEAR_RUN) anim = 22;
  else if (p->state == PS_INSTA) anim = 50;   // the insta-shield's own pose, until he lands
  else if (p->state == PS_WALK) {
    if (speed >= RUN_ANIM_SPEED) { anim = SONIC_RUN; variant = 0; }
    else {
      anim = SONIC_WALK; variant = 0;
      // the walk cycle plays at |speed| × 1.0, never slower than 0.5× (pickAnimation)
      int s = (int)__builtin_floor(speed * 256) >> 4;
      speedAnim = s < ANIM_MIN_WALK ? ANIM_MIN_WALK : s > ANIM_NORMAL ? ANIM_NORMAL : s;
    }
  } else if (p->state == PS_TURN) anim = SONIC_TURN;
  else if (p->state == PS_BRAKE) anim = speed < BRAKE_TURN_SPEED ? SONIC_BRAKE_TURN : SONIC_BRAKE;
  if (p->idleT && p->state == PS_IDLE) p->idleT--;
  p->anim = anim; p->variant = variant; p->animSpeed = speedAnim;
  // rising slower than 1.5 px a frame off a spring tops him out, whose animation starts on the next frame
  if (oldState == PS_SPRING_RISE && p->ysp >= -1.5) p->state = PS_SPRING_PEAK;
}
static void animate_player(Player *p) {
  if (p->state == PS_BRAKE && (act.tick & 3) == 0) brake_dust_spawn();
  // the animation's hitboxes are mirrored with the way he faces (stepAnim), so the flip is set before it runs
  sonic.frameFlags = (sonic.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP))
    | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
  choose_animation(p);
  sonic.graphics.anim = (uint16_t)p->anim;
  sonic.variant = (uint8_t)p->variant;
  sonic.animSpeed = (uint8_t)p->animSpeed;
  int more = update_sprite(&sonic, 0);
  // what an animation's end leads to, on the same frame (afterAnimation)
  int next = -1;
  if (!more) {
    if (p->state == PS_SPRING || p->state == PS_SPRING_PEAK) next = PS_SPRING_FALL;
    else if (p->state == PS_TURN) next = PS_WALK;
    else if (p->state == PS_CROUCH_END) next = p->gsp != 0 ? PS_WALK : PS_IDLE;
    else if (p->state == PS_LOOKUP_END) next = PS_IDLE;
    else if (p->state == PS_SPIN_DASH_REV) next = PS_SPIN_DASH;
  }
  if (next >= 0) {
    p->state = next;
    choose_animation(p);
    sonic.graphics.anim = (uint16_t)p->anim;
    sonic.variant = (uint8_t)p->variant;
    sonic.animSpeed = (uint8_t)p->animSpeed;
    update_sprite(&sonic, 0);
  }
}

// --- the HUD (engine/hud.js) -------------------------------------------------------------------------------------
static void put_oam(int order, int x, int y, int index, int tile, int pal, int prio) {
  int k = alloc_oam((uint32_t)order);
  if (k < 0) return;
  int shape = index >> 2, size = index & 3;
  e.oamMalloc[k * 4] = (uint16_t)((y & 0xFF) | (shape << 14));
  e.oamMalloc[k * 4 + 1] = (uint16_t)((size << 14) | (x & 0x1FF));
  e.oamMalloc[k * 4 + 2] = (uint16_t)((pal << 12) | (tile & 0x3FF) | (prio << 10));
}
static int digits_of(int n, int *out) {
  if (n == 0) { out[0] = 0; return 1; }
  int t[12], k = 0;
  while (n > 0 && k < 12) { t[k++] = n % 10; n /= 10; }
  for (int i = 0; i < k; i++) out[i] = t[k - 1 - i];
  return k;
}
static void hud_glyph(int g, int x, int y) {
  int tile = g < HUD_GLYPHS ? (int)hudTile + g * 2 : (int)hudTile + HUD_RED + (g - HUD_GLYPHS) * 2;
  put_oam(ORDER_DIGITS, x, y, OBJ_8x16, tile, 6, 0);
}
/** sub_80538BC: the HUD's tiles and colours, at the addresses it reserves (CreateStageUI). */
static void hud_load_graphics(void) {
  copyCount = 0;   // the card's copies are done
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1, &faceTiles, &facePalette, &layout);
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  copy_rom(fontTiles + 32 * 32, OBJ_VRAM + (uint32_t)(hudTile + HUD_WHITE) * 32, 22 * 32);
  copy_rom(fontTiles + 224 * 32, OBJ_VRAM + (uint32_t)(hudTile + HUD_RED) * 32, 22 * 32);
  copy_rom(ringTiles, OBJ_VRAM + (uint32_t)(hudTile + HUD_RING) * 32, 16 * 32);
  copy_rom(faceTiles, OBJ_VRAM + (uint32_t)(hudTile + HUD_FACE) * 32, 4 * 32);
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

static void hud_update(int draw) {
  Hud *h = &act.hud;
  if (!h->active) return;
  if (draw) {
    // the icons: the ring over the ring count and the character's face by the lives, at OAM order 3
    put_oam(ORDER_ICONS, -2, -1, OBJ_32x32, (int)hudTile + HUD_RING, 6, 0);
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, (int)hudTile + HUD_FACE, 0, 0);
    if (act.ringCount == 0) {
      static const int FLASH[5] = { 0, 11, 11, 0, 0 };
      int f = h->flash >> 3, g = f < 5 ? FLASH[f] : -1;
      if (g >= 0) hud_glyph(g, 9, 5);
    } else {
      int d[12], n = digits_of(act.ringCount > 999 ? 999 : act.ringCount, d);
      int x = n == 1 ? 9 : n == 2 ? 5 : 1;
      for (int i = 0; i < n; i++) hud_glyph(d[i], x + i * 8, 5);
    }
    int d[12], n = digits_of(act.score % 1000000000, d);
    for (int i = 0; i < n; i++) hud_glyph(d[i], 81 - 8 * n + i * 8, -2);
    int red = act.courseTime > 9 * 3600 && (act.tick & 0x10) ? 11 : 0;
    int sec = (act.courseTime / 60) % 60;
    int hundredths = (int)__builtin_floor((act.courseTime % 60) * 100.0 / 60.0 + 0.5);
    int t[7];
    if (act.courseTime >= 10 * 3600) { int q[7] = { 9, 10, 5, 9, 10, 9, 9 }; memcpy(t, q, sizeof t); }
    else { t[0] = act.courseTime / 3600; t[1] = 10; t[2] = sec / 10; t[3] = sec % 10; t[4] = 10; t[5] = hundredths / 10; t[6] = hundredths % 10; }
    for (int i = 0; i < 7; i++) hud_glyph(t[i] + red, 25 + i * 8, 12);
    int lives = act.lives > 9 ? 9 : act.lives == 0 ? 0 : act.lives - 1;
    hud_glyph(lives, 22, 143);
  }
  h->flash = (h->flash + 1) & 31;
}

// --- the title card (engine/titlecard.js, actcard.c) ------------------------------------------------------------
static void card_update(int pressed) {
  if (act.cardDone) return;
  if (!card_run(pressed)) {
    act.cardDone = 1;
    act.clockStopped = 0;
    // TaskDestructor_8055C38 gives the card's tiles back at once, so the act's objects take the heap from tile 400
    vram_free(act.card.slots[0].vram);   // the zigzag's slot, where the card's heap tiles start
    objects_alloc_vram();                // the objects take the heap from tile 400 now that the card has given it back
    // CreateStageUI on the card's last frame: its tiles load in this frame's V-blank and its task first runs on
    // the next frame, so this frame shows no HUD
    hud_load_graphics();
    act.hud.active = 3;
    act.hud.flash = actHudFlash >= 0 ? actHudFlash : act.stage.hudFlash;
    actHudFlash = -1;
  }
}

// --- the frame (engine/game.js) ----------------------------------------------------------------------------------
static void draw_frame(void) {
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  // the act has no blend, and its first frames keep the course select's display, as the original does
  e.bldCnt = 0; e.bldAlpha = 0x0010; e.bldY = 0;
  e.dispCnt = act.stage.zone == 6 || act.cardDone ? 0x1E40 : 0x3E40;
  e.winRegs[0] = e.winRegs[1] = 0x00F0; e.winRegs[2] = e.winRegs[3] = 0x00A0;
  act.drawn++;
  // RenderMetatileLayers: BG1 and BG2 scroll by the camera's sub-tile part, their maps filled from the metatiles
  e.bgScroll[2] = (uint16_t)(camX & 7); e.bgScroll[3] = (uint16_t)(camY & 7);
  e.bgScroll[4] = (uint16_t)(camX & 7); e.bgScroll[5] = (uint16_t)(camY & 7);
  fill_layer(0xF000, LAYER_FRONT, camX, camY);
  fill_layer(0xF800, LAYER_BACK, loopDrawX >= 0 ? loopDrawX : camX, camY);
  loopDrawX = -1;
  // StageBgUpdate_Zone7Act1: the 37 × 23 background scrolls as a whole. Its first frame keeps the course
  // select's scroll, which the original shows before the act's own update lands.
  if (act.stage.zone == 6) {
    int bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W_));
    int bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H_));
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
  } else {
    // Neo Green Hill's background (renderer.js backgroundOffset): its map starts at 224 across and 214 down, and
    // each line scrolls on its own. The cloud bands drift with the stage clock, the big clouds and islands stay
    // still, and the sea scrolls faster toward the bottom of the screen. The H-blank DMA changes BG3HOFS a line
    // at a time; the register holds the last line's value as the frame ends.
    set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
    int stageTime = act.tick - 1;   // the cloud bands scroll from before this frame's tick, as the original's do
    for (int line = 0; line < SCREEN_H_; line++) {
      int off;
      if (line < 8) off = (stageTime >> 4) & 0xFF;
      else if (line < 24) off = (stageTime >> 5) & 0xFF;
      else if (line < 40) off = (stageTime >> 6) & 0xFF;
      else if (line < 88) off = 0;
      else off = ((line - 86) * (camX - act.cam.wrapped)) >> 8;
      put16(e.primary + (uint32_t)line * 4, (uint32_t)(off & 0x1FF));
      put16(e.primary + (uint32_t)line * 4 + 2, 0);
    }
    e.bgScroll[6] = 0; e.bgScroll[7] = 0;
    // the rings, behind the objects and Sonic
    rings_draw(camX, camY);
    objects_draw(camX, camY);
    enemies_draw(camX, camY);
  }

  // the dust and the insta-shield's flash, at OAM order 8, before Sonic
  dust_draw();
  insta_flash_draw();
  // Sonic's sprite, at OAM order 16, in screen coordinates as the renderer draws him
  int right = act.player.facing > 0;
  int sx = (int)__builtin_floor(act.player.x) - camX, sy = (int)__builtin_floor(act.player.y) - camY;
  sonic.oamFlags = ORDER_SONIC << 6;
  sonic.palId = 0;
  sonic.frameFlags = (uint16_t)((sonic.frameFlags & ~(SPRITE_PRIORITY | SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE)) | (2 << 12));
  // the walk and a bounce off a block, which keep the rotation he was launched with (renderer.js drawSonic)
  if (act.player.state == PS_WALK || act.player.state == PS_BOUNCE) {
    sonic.frameFlags |= SPRITE_ROT_SCALE_ENABLE;
    Transform tf;
    // his ground angle, through the rotation hardware (drawSonic: drawRotation = rotation << 2)
    tf.rotation = (uint16_t)((act.player.rotation << 2) & 1023);
    tf.qScaleX = (int16_t)(right ? -256 : 256); tf.qScaleY = 256;
    tf.x = (int16_t)(sx - (right ? 1 : 0)); tf.y = (int16_t)sy;
    transform_sprite(&sonic, &tf);
  } else {
    if (act.player.facing > 0) sonic.frameFlags |= SPRITE_X_FLIP;
    sonic.x = (int16_t)(sx + (act.player.facing < 0 ? 1 : 0));
    sonic.y = (int16_t)sy;
  }
  display_sprite(&sonic);
  // the title card's sprites, in front of everything, and its fade
  if (!act.cardDone) card_draw();
  results_display();
}

static int nextLevelWait = -1, actFromResults;
static int actMusicWait, actMusicAhead;
/** The character select starts the act's song a frame before its first picture; the act then keeps it, as the
 *  original's StageInit does, instead of starting it again. */
void act_music_ahead(void) { actMusicAhead = 1; }
static uint16_t holdColour; static int restoreColour;   // the menu's black for the act's first picture
static void act_frame(void) {
  if (actMusicWait) { if (--actMusicWait == 0) play_song(act.stage.music); }
  if (restoreColour) { restoreColour = 0; e.bgPalette[0] = holdColour; e.flags |= FLAGS_UPDATE_BG_PALETTES; }
  if (nextLevelWait >= 0) {
    if (nextLevelWait > 0) { nextLevelWait--; return; }
    nextLevelWait = -1;
    int level = act.stage.level;
    destroy_tasks(0, 0xFFFF);
    clear_queues();
    stop_all_songs();
    // the next act, when this version has it; another act stops where the results left the screen, as the menus do
    int next = level + 1;
    if (next == 0 || next == 3 || next == 12) {
      actFromResults = 1;
      if (next == 0) act_start(next, -1, 0);
      else { opening_start(next, -1, 0); opening_frame_now(); }
    } else {
      act_active = 0;
    }
    return;
  }
  camera_update(&act.cam, &act.player);
  animate_stage_tiles();
  act.cam.bgUpdates++;
  palettes_run();
  // the ring manager runs after the camera and before the objects and Sonic
  rings_update((int)__builtin_floor(act.player.x), (int)__builtin_floor(act.player.y), act.player.offsetY);
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  objects_update(camX, camY);
  enemies_update(camX, camY);
  // the objects and spikes hurt him themselves as they touch him; an enemy or shot only says it did, so the
  // same Coll_DamagePlayer handles its shield, invincibility, rings and death
  if (!act.player.dead && enemies_player_hit()) objects_hurt_player();
  int left = (e.input & KEY_LEFT) != 0, right = (e.input & KEY_RIGHT) != 0;
  int up = (e.input & KEY_UP) != 0, down = (e.input & KEY_DOWN) != 0;
  int jump = (e.input & KEY_A) != 0, attack = (e.input & KEY_B) != 0;
  int jumpPressed = (e.pressed & KEY_A) != 0, attackPressed = (e.pressed & KEY_B) != 0;
  // past the goal he is held to the right, and the buttons held then count as no press
  if (act.player.ignoreInput) { left = 0; right = 1; up = down = 0; jump = attack = 0; jumpPressed = attackPressed = 0; }
  // the start point's first frame reads the right and A the original has held there, never pressed
  if (act.firstFrame) { left = 0; right = 1; jump = 1; attack = 0; jumpPressed = 0; attackPressed = 0; act.firstFrame = 0; }
  int padPressed = (e.pressed & (KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN)) != 0;
  // the results' task (0x2100) and its pieces' (0x2120) run after the objects and before the HUD. Once they end,
  // the save is written (the screen keeping its last frame), then the next act starts.
  if (results_active()) {
    if (!results_run()) {
      save_write();
      nextLevelWait = 0;
      return;
    }
  }
  // the title card's task (0x2100) runs before Sonic's, and its last frame starts the clock and makes the HUD
  card_update(jumpPressed || attackPressed || padPressed);
  // the HUD's task runs before Sonic's and before the clock, as the original makes it (0x2180); it starts on the
  // frame after the card ends
  if (act.hud.active == 3) act.hud.active = 2;
  else if (act.hud.active == 2) { act.hud.active = 1; hud_update(1); }
  else if (act.hud.active) hud_update(1);
  if (!act.player.carried) step_player(&act.player, left, right, up, down, jump, jumpPressed, attack, attackPressed);
  insta_flash_update();
  animate_player(&act.player);
  dust_update();
  if (!act.clockStopped) act.courseTime++;
  act.tick++;
  draw_frame();
}

void act_stage_results(void) {
  int level = act.stage.level;
  save_add_ring_bank(act.ringCount);
  if (save_unlocked_level(0) < level + 1) save_set_unlocked_level(0, (uint16_t)(level + 1));
  results_start(level, act.ringCount, act.courseTime, 0, 0);
}

void act_task(Task *t) {
  (void)t;
  act_frame();
}



/** Draws the act's first frame now, for a screen that hands over inside its own task. */
void act_frame_now(void) { act_frame(); }

static int pendingLevel, pendingCard, pendingPre, actQueued;
static void act_begin_task(Task *t) {
  destroy_task(t);
  act_start(pendingLevel, pendingCard, pendingPre);
  act_frame();
}

/** Starts the act on the next frame, so the frame the menu hands over still draws the menu. */
void act_queue(int level, int cardSkip, int preFrames) {
  pendingLevel = level; pendingCard = cardSkip; pendingPre = preFrames;
  actQueued = 1;
  create_task(act_begin_task, NULL, 0x0F00, 0, NULL);
}

/** Keeps the screen black for this frame, as the menu's last frame is, until the act first draws. */
void act_hold_black(void) {
  holdColour = e.bgPalette[0];
  e.dispCnt = 0;
  e.bgPalette[0] = 0;
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  restoreColour = 1;
}

/** The title card's frames before the first one the recording compares, run with no picture. */
static void pre_run(int cardSkip, int preFrames) {
  int after = 0;
  while (!act.cardDone || after < preFrames) {
    int wasDone = act.cardDone;
    camera_update(&act.cam, &act.player);
    animate_stage_tiles();
    palettes_run();
    if (!act.cardDone) card_update(cardSkip == act.tick);
    int r = act.cardDone;
    step_player(&act.player, 0, r, 0, 0, !act.cardDone, 0, !act.cardDone, 0);
    animate_player(&act.player);
    if (wasDone) { act.hud.active = 1; hud_update(0); after++; }
    if (!act.clockStopped) act.courseTime++;
    act.tick++;
  }
}

void act_start(int level, int cardSkip, int preFrames) {
  int fromResults = actFromResults;
  actFromResults = 0;
  memset(&act, 0, sizeof act);
  vram_reset();
  copyCount = 0;
  load_stage(level);
  dust_reset();
  animFrame = 0; animDelayCount = 0; animPending = 0;
  instaFlashActive = 0; instaFlashSlot = -1;
  rings_init(level);
  // the title card's pictures and colours (LoadStageIntroGraphics), right after the player's sprites, before the
  // objects' graphics take the rest of the sprite heap
  card_create(level, 0, fromResults, 0);
  objects_init(level);
  enemies_init(level);
  palettes_init();
  create_player(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1; act.cardDone = 0; act.cardFrame = 0;
  act.hud.active = 0; act.hud.flash = act.stage.hudFlash;
  act.started = 0; act.drawn = 0;
  act.firstFrame = (int)gba_start_number("first", 0);
  e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
  e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
  e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;

  // Sonic's sprite: the player's tiles, colours and animation, at its own OAM order
  sprite_init(&sonic);
  sonicVram = OBJ_VRAM;   // the player sprite's tiles are the first ones, as the original keeps them
  sonic.graphics.dest = sonicVram;
  sonic.graphics.anim = SONIC_IDLE; sonic.variant = 0; sonic.animSpeed = ANIM_NORMAL;
  sonic.palId = 0; sonic.oamFlags = ORDER_SONIC << 6; sonic.frameFlags = 2 << 12;

  // the frames before a recording that opens after the title card: the card to its end, then its few frames after
  // it; a start point that opens at the act's first frame, and the course select, run the card as part of the act
  if (cardSkip >= 0 || preFrames > 0) pre_run(cardSkip, preFrames);
  if (act.cardDone) objects_alloc_vram();
  if (actQueued && cardSkip < 0 && preFrames == 0) actMusicWait = 2;
  else {
    if (!actMusicAhead) play_song(act.stage.music);
    gba_sound_frames_gone_by(118);
  }
  actMusicAhead = 0;
  actQueued = 0;
  act.hud.active = 0;
  act.started = 1;
  create_task(act_task, NULL, 0x0F00, 0, NULL);
}
