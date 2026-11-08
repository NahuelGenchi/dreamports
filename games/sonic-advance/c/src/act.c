// X Zone's act in C: its stage and collision from the player's copy, the camera, Sonic on the ground, the HUD, and
// the title card's state without its pictures. Translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js, a
// function at a time; every comment names the original's function where one is rewritten.

#include "act.h"

enum {
  OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC,
  LAYER_FRONT = 0, LAYER_BACK = 1, IGNORE_PLATFORMS = 0x80,
  SCREEN_W_ = 240, SCREEN_H_ = 160,
};
// Casino Paradise act 2's palette animations, in StageInit_Zone3Act2's order (stage.c)
static const uint16_t CASINO_PALETTE_ANIMATIONS[11] = { 816, 817, 818, 824, 825, 827, 827, 828, 843, 844, 826 };
// Casino Paradise's background update (backgrounds.js BACKGROUND_UPDATE): the fireworks' task priority
enum { FIREWORK_PRIORITY = 0x4001 };
static int is_casino_level(int level) { return level == ACT_LEVEL_CASINO_2; }
static int is_casino(void) { return is_casino_level(act.stage.level); }
enum { PS_IDLE, PS_WALK, PS_TURN, PS_BRAKE, PS_CROUCH, PS_LOOKUP, PS_SPIN, PS_HURT, PS_DEAD };
enum { SONIC_IDLE = 0, SONIC_WALK = 4, SONIC_RUN = 5, SONIC_TURN = 6 };
// the HUD's graphics sit at fixed sprite VRAM addresses, which the original reserves (vram_hardcoded.h):
// the character's face at 0x0800, the ring at 0x0880, the white digits at 0x0A80 and the red ones at 0x0D40.
// Their tile numbers are 64, 68, 84 and 106.
enum { HUD_GLYPHS = 11, HUD_WHITE = 0, HUD_RED = 22, HUD_RING = 44, HUD_FACE = 60,
       HUD_WHITE_TILE = 84, HUD_RED_TILE = 106, HUD_RING_TILE = 68, HUD_FACE_TILE = 64, HUD_PAST_TILE = 20 };
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
#define BORED_DELAY 360
#define ANIM_NORMAL 0x10
#define ANIM_MIN_WALK 0x08

Act act;
static Sprite sonic;
static uint32_t sonicVram, hudVram, hudTile;
static Sprite firstRings[2];
static int firstRingsMade;

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
static Probe probe_wall(int p0, int p1, int layer) { Probe p; p.v = row_width(p1, p0, layer); p.rot = surface_angle(p1, p0, layer); p.hasRot = 1; return p; }

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
static void copy_rom(uint32_t src, uint32_t dest, uint32_t size) {
  // At a screen's start the original's V-blank copy and this direct copy show the same first frame; the stage's
  // tiles are static, and copying them now keeps them out of the queue that the screens before it may still fill.
  uint32_t n = size;
  if (dest >= 0x18000) return;
  if (dest + n > 0x18000) n = 0x18000 - dest;
  if (src >= gba_rom_size) return;
  if (src + n > gba_rom_size) n = gba_rom_size - src;
  memcpy(gba_vram + dest, gba_rom + src, n);
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
  s->width = s->collision.width; s->height = s->collision.height;
  s->zone = is_casino_level(level) ? 2 : 6;
  s->act = is_casino_level(level) ? 1 : 0;
  s->music = is_casino_level(level) ? 17 : 24;
  s->hudFlash = is_casino_level(level) ? 52 : 90;
  // the front layer's tiles, in the first character block, and the stage's 256 colours (extractStage's palette)
  copy_rom(s->front.tiles, 0, s->front.tilesSize);
  // past the tileset the original's VRAM is what the card left, a blank run with a few tiles in it (the ROM's
  // 0x3D7074, one of the four copies of this tileset's tail)
  if (is_casino_level(level)) copy_rom(0x3D7074, 0x7D00, 0x300);
  for (int i = 0; i < 256; i++) e.bgPalette[i] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the background's tiles at the second character block, and its map. Casino Paradise's 32 × 32 map is one
  // 256 × 256 text layer at 0xE800 (InitCamera's STGBG_SCRN_DIM(256, 256, 2, 29)); X Zone's 37 × 23 map is a
  // 512-wide layer at 0xE000, whose columns 32–36 go to the block at 0xE800 (DrawBackground, copy_backgrounds).
  copy_rom(s->background.tiles, 0x8000, s->background.tilesSize);
  if (is_casino_level(level)) {
    for (int row = 0; row < s->background.yTiles; row++)
      for (int col = 0; col < s->background.xTiles; col++) {
        uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
        uint32_t at = 0xE800 + (uint32_t)(row * 32 + col) * 2u;
        gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
      }
  } else {
    for (int row = 0; row < s->background.yTiles; row++) {
      for (int col = 0; col < s->background.xTiles; col++) {
        uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
        uint32_t at = (col < 32 ? 0xE000 + (uint32_t)col * 2u : 0xE800 + (uint32_t)(col - 32) * 2u) + (uint32_t)row * 64u;
        gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
      }
    }
  }
  // InitCamera's registers: BG1 the front layer, BG2 the back one, BG3 the background, all 16 colours
  e.dispCnt = 0x304E;           // OBJ on, window 0 on, BG1, BG2 and BG3 on, 1D OAM
  e.bgCnt[1] = 0x1E01;          // 256 × 256, priority 1, map 30 (0xF000), character base 0
  e.bgCnt[2] = 0x1F02;          // 256 × 256, priority 2, map 31 (0xF800), character base 0
  e.bgCnt[3] = is_casino_level(level) ? 0x1D0B : 0x5C0B;   // 256 × 256, map 29 (0xE800), or X Zone's 512 × 256 at 28
}

// a stage layer's visible tile entries around the camera (DrawBackground's level-map path)
static uint16_t stage_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = fdiv(tx, 12), my = fdiv(ty, 12), lx = tx - mx * 12, ly = ty - my * 12;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + my * c->levelX + mx);
  return (uint16_t)rom_u16(act.stage.front.map + (id * 144u + (uint32_t)ly * 12u + (uint32_t)lx) * 2u);
}
static void fill_layer(uint32_t dest, int layer, int camX, int camY) {
  int tx0 = camX >> 3, ty0 = camY >> 3;
  for (int row = 0; row < 21; row++) {
    for (int col = 0; col < 31; col++) {
      uint16_t entry = stage_entry(layer, tx0 + col, ty0 + row);
      uint32_t at = dest + (uint32_t)(row * 32 + col) * 2u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
    // the original fills 31 columns; the last one keeps nothing, not the screen's before it
    if (is_casino()) {
      uint32_t end = dest + (uint32_t)(row * 32 + 31) * 2u;
      gba_vram[end] = 0; gba_vram[end + 1] = 0;
    }
  }
}

// --- Casino Paradise act 2's background, palette animations, animated tiles and fireworks ---------------------------
// StageBgUpdate_Zone3Acts12 (src/game/sa1/stage/backgrounds/zone_3.inc.c): BG3's scroll is the camera's share of the
// act, and lines 134–255 scroll further across through HBlank, each band by a further share of the camera's x.
static void casino_background_update(void) {
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  const Collision *c = &act.stage.collision;
  int xSub = (camX << 4) / (c->width - SCREEN_W_);
  int ySub = ((camY << 6) + (camY << 5)) / (c->height - SCREEN_H_);
  act.cam.bgX = xSub; act.cam.bgY = ySub;
  e.bgScroll[6] = (uint16_t)xSub; e.bgScroll[7] = (uint16_t)ySub;
  set_hblank_copy(REG_BG0HOFS + 6, 4);
  for (int line = 0; line < SCREEN_H_; line++) {
    int row = ySub + line, x = xSub;
    if (row >= 134 && row < 140) x = (xSub + (camX >> 5)) & 0xFF;
    else if (row >= 140 && row < 152) x = (xSub + (camX >> 4)) & 0xFF;
    else if (row >= 152 && row < 168) x = (xSub + (camX >> 3)) & 0xFF;
    else if (row >= 168 && row < 192) x = (xSub + (camX >> 2)) & 0xFF;
    else if (row >= 192) x = (xSub + (camX >> 1)) & 0xFF;
    put16(e.primary + (uint32_t)line * 4, (uint32_t)x);
    put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)ySub);
  }
}

// The fireworks (Task_UpdateFireworkAnimation, camera.c): on every 4th frame of the stage clock, one draw of the
// game's random numbers with bits 8–10 clear sets one off, at x −8 … 247 and y −32 … 95 in the map, big or small.
// It shows its animation once, drawn four times (as it is, across, down and both), and goes on the frame after it ends.
typedef struct { Sprite s; int x, y, live; } Firework;
static Firework fireworks[8];
static void firework_task(Task *t) {
  Firework *f = t->data;
  if (f->s.frameFlags & SPRITE_ANIM_OVER) { f->live = 0; destroy_task(t); return; }
  f->s.x = (int16_t)(f->x - act.cam.bgX);
  f->s.y = (int16_t)(f->y - act.cam.bgY);
  update_sprite(&f->s, 0);
  static const int FLIPS[4][2] = { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 } };
  for (int i = 0; i < 4; i++) {
    f->s.frameFlags = (uint16_t)((f->s.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP))
      | (FLIPS[i][0] ? SPRITE_X_FLIP : 0) | (FLIPS[i][1] ? SPRITE_Y_FLIP : 0));
    display_sprite(&f->s);
  }
  f->s.frameFlags &= ~(SPRITE_X_FLIP | SPRITE_Y_FLIP);
}
static void create_firework(int x, int y, int small) {
  for (int i = 0; i < 8; i++) {
    Firework *f = &fireworks[i];
    if (f->live) continue;
    sprite_init(&f->s);
    f->s.graphics.dest = vram_malloc(16);
    f->s.graphics.anim = (uint16_t)(small ? 483 : 482);
    f->s.variant = 0; f->s.animSpeed = 0x10; f->s.palId = 0;
    f->s.oamFlags = 31 << 6; f->s.frameFlags = 3 << 12;
    f->x = x; f->y = y; f->live = 1;
    f->s.x = (int16_t)(x - act.cam.bgX); f->s.y = (int16_t)(y - act.cam.bgY);
    create_task(firework_task, f, FIREWORK_PRIORITY, 0, NULL);
    return;
  }
}
static void casino_background_tasks(void) {
  if ((act.tick & 3) != 0 || (front_random() & 0x700) != 0) return;
  int x = (int)((front_random() & 0xFF00) >> 8) - 8;
  int y = (int)((front_random() & 0x7F00) >> 8) - 32;
  int small = (front_random() & 0x100) != 0;
  create_firework(x, y, small);
}
// the title card's frames, where no picture is drawn: the fireworks' states carry on, but nothing goes to OAM
static void fireworks_pre(void) {
  for (int i = 0; i < 8; i++) {
    Firework *f = &fireworks[i];
    if (!f->live) continue;
    if (f->s.frameFlags & SPRITE_ANIM_OVER) { f->live = 0; continue; }
    f->s.x = (int16_t)(f->x - act.cam.bgX); f->s.y = (int16_t)(f->y - act.cam.bgY);
    update_sprite(&f->s, 0);
  }
}

// CreatePaletteLoaderTask and UpdateSpriteAnimation_BG (src/game/shared/stage/palette_loader.c): a palette-only
// animation whose frames load colours into the background palette. StageInit_Zone3Act2 makes eleven, in its order.
typedef struct { Sprite s; } PaletteAnimation;
static PaletteAnimation paletteAnims[11];
static void palette_animation_task(Task *t) {
  PaletteAnimation *p = t->data;
  if (!update_sprite(&p->s, 1)) destroy_task(t);
}
static void init_palette_animations(void) {
  for (int i = 0; i < 11; i++) {
    PaletteAnimation *p = &paletteAnims[i];
    sprite_init(&p->s);
    p->s.graphics.dest = 0;
    p->s.graphics.anim = CASINO_PALETTE_ANIMATIONS[i];
    p->s.variant = 0; p->s.animSpeed = 0x10; p->s.palId = 0;
    // a palette loader has no tiles of its own: the original's graphics.dest is NULL, and a GetTiles command
    // would copy to BIOS's address, not VRAM
    p->s.frameFlags = SPRITE_KEEP_TILES;
  }
}
static void create_palette_animation_tasks(void) {
  for (int i = 0; i < 11; i++) create_task(palette_animation_task, &paletteAnims[i], 0x2000, 0, NULL);
}
// the same during the title card, where no frame is drawn: the last frame's colours are what the first frame shows
static void palette_animations_pre(void) {
  for (int i = 0; i < 11; i++) update_sprite(&paletteAnims[i].s, 1);
}

// UpdateBgAnimationTiles (src/background.c): the front layer's four animated tile frames, a step every animDelay
// frames, queued for the next V-blank. The first step is the base tiles, so a step to frame 0 puts them back.
static struct { int delay, frame; } tileAnim;
static Graphics tileAnimGfx;
static void stage_animated_tiles(int queue) {
  const Tilemap *t = &act.stage.front;
  if (!t->animFrameCount || !t->animDelay) return;
  if (++tileAnim.delay < t->animDelay) return;
  tileAnim.delay = 0;
  if (++tileAnim.frame >= t->animFrameCount) tileAnim.frame = 0;
  uint32_t src = tileAnim.frame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(tileAnim.frame - 1) * t->animTileSize;
  if (!queue) return;
  tileAnimGfx.src = src; tileAnimGfx.dest = 0; tileAnimGfx.size = t->animTileSize;
  tileAnimGfx.anim = 0; tileAnimGfx.ram = NULL;
  queue_graphics(&tileAnimGfx);
}
// after the title card, what the pre-run's V-blanks would have left in VRAM
static void stage_animated_tiles_pre(void) {
  const Tilemap *t = &act.stage.front;
  if (!t->animFrameCount || !t->animTileSize) return;
  uint32_t src = tileAnim.frame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(tileAnim.frame - 1) * t->animTileSize;
  if (src < gba_rom_size && src + t->animTileSize <= gba_rom_size)
    memcpy(gba_vram, gba_rom + src, t->animTileSize);
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
  if (dx > 8) c->x += dx - 8 > 16 ? 16 : dx - 8;
  else if (dx < -8) c->x += dx + 8 < -16 ? -16 : dx + 8;
  int air = p->air;
  c->deadY = air ? (c->deadY + 4 < 24 ? c->deadY + 4 : 24) : (c->deadY - 4 > 0 ? c->deadY - 4 : 0);
  int dy = (int)c->targetY - (int)c->y;
  if (dy > c->deadY) c->y += dy - c->deadY > 12 ? 12 : dy - c->deadY;
  else if (dy < -c->deadY) c->y += dy + c->deadY < -12 ? -12 : dy + c->deadY;
  c->x = clamp((int)c->x, c->minX, c->maxX);
  c->y = clamp((int)c->y, c->minY, c->maxY);
  c->x += c->shakeX; c->y += c->shakeY;
}

// --- Sonic (engine/player.js, the ground movement this piece needs) ----------------------------------------------
static void set_offset_y(Player *p, int soy) {
  int dlt = soy - p->offsetY;
  if (!dlt) return;
  int mode = (((p->rotation & 0xFF) + 0x20) & 0xC0) >> 6;
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
    if (p->state != PS_TURN && !p->curled) { p->state = PS_WALK; set_offset_y(p, SPRITE_OFFSET_Y); }
  } else {
    double g = p->gsp + DECELERATION * dir;
    if (g * dir > 0) g = REVERSE_KICK * dir;
    p->gsp = g;
    if (g * dir <= -BRAKE_MIN_SPEED) { p->state = PS_BRAKE; set_offset_y(p, SPRITE_OFFSET_Y); }
  }
}
static void walk_input(Player *p, int dir, int sideways) {
  if (dir) walk(p, dir);
  else if (!sideways) {
    if (p->gsp != 0) {
      if (p->state == PS_BRAKE || p->state == PS_IDLE) p->state = PS_WALK;
    } else if (p->state == PS_CROUCH) p->state = PS_WALK;
    else if (p->state == PS_LOOKUP) p->state = PS_WALK;
    else p->state = PS_IDLE;
  }
  if (dir || sideways) p->idleT = BORED_DELAY;
  if (!((p->rotation + 0x20) & 0xC0) && p->gsp == 0) {
    p->pushing = 0;
    if (p->state != PS_CROUCH) p->state = PS_IDLE;
  }
}
static void ground_sensors(Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), soy = p->offsetY;
  int mode = (((p->rotation & 0xFF) + 0x20) & 0xC0) >> 6;
  Scan a, b; double speed;
  if (mode == 0) { a = scan(1, y + soy, x - 8, p->layer, 8); b = scan(1, y + soy, x + 8, p->layer, 8); speed = p->xsp; }
  else if (mode == 1) { a = scan(1, x - soy, y - 8, p->layer, -8); b = scan(1, x - soy, y + 8, p->layer, -8); speed = p->ysp; }
  else if (mode == 2) { a = scan(1, y - soy, x + 8, p->layer, -8); b = scan(1, y - soy, x - 8, p->layer, -8); speed = p->xsp; }
  else { a = scan(1, x + soy, y + 8, p->layer, 8); b = scan(1, x + soy, y - 8, p->layer, 8); speed = p->ysp; }
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
static void move_player(Player *p) {
  p->x += p->xsp;
  if (p->inverted != p->wasInverted) p->ysp = -p->ysp;
  p->y += p->inverted ? -p->ysp : p->ysp;
}
static void bounds(Player *p) {
  double maxX = act.cam.maxX + SCREEN_W_ - 1.0 / Q8, maxY = act.cam.maxY + SCREEN_H_ - 1.0 / Q8;
  if (!p->dead && (p->inverted ? p->y <= act.cam.minY : p->y >= maxY)) { p->dead = 1; p->ysp = -4.875; p->y = p->inverted ? act.cam.minY : maxY; }
  if (p->x < act.cam.minX || p->x > maxX) { p->x = p->x < act.cam.minX ? act.cam.minX : maxX; p->xsp = 0; p->gsp = 0; }
  if (p->y < act.cam.minY) { p->y = act.cam.minY; p->ysp = 0; p->gsp = 0; }
  if (p->inverted && p->y > maxY) { p->y = maxY; p->ysp = 0; p->gsp = 0; }
}
static void step_player(Player *p, int left, int right, int up, int down, int jump, int jumpPressed, int attack, int attackPressed) {
  int sideways = left || right;
  int dir = left && !right ? -1 : right && !left ? 1 : 0;
  (void)up; (void)down; (void)jump; (void)jumpPressed; (void)attack; (void)attackPressed;
  if (p->dead) return;
  if (!p->air) {
    slope(p);
    walk_input(p, dir, sideways);
    if (!sideways) p->gsp = toward0(q8(p->gsp), q8(FRICTION)) / Q8;
    along_surface(p);
  } else if (is_casino()) {
    p->ysp += 42.0 / 256;
  }
  bounds(p);
  move_player(p);
  if (!p->air || !is_casino()) follow_ground(p);
}

// chooseAnimation and tickAnim (engine/player.js, engine/animator.js)
static void choose_animation(Player *p) {
  int speed = (int)__builtin_fabs(p->gsp);
  int anim = SONIC_IDLE, variant = 0, speedAnim = ANIM_NORMAL;
  if (p->state == PS_SPIN) { anim = 8; variant = 0; }
  else if (p->state == PS_WALK) {
    if (speed >= RUN_ANIM_SPEED) { anim = SONIC_RUN; variant = 0; }
    else {
      anim = SONIC_WALK; variant = 0;
      int s = (int)((q8(p->gsp) >> 4) & 0xFFFF);
      speedAnim = s < 9 ? 9 : s > ANIM_NORMAL ? ANIM_NORMAL : s;
    }
  } else if (p->state == PS_TURN || p->state == PS_BRAKE) { anim = SONIC_TURN; variant = 0; }
  if (p->idleT && p->state == PS_IDLE) p->idleT--;
  p->anim = anim; p->variant = variant; p->animSpeed = speedAnim;
}
static void animate_player(Player *p) {
  choose_animation(p);
  sonic.graphics.anim = (uint16_t)p->anim;
  sonic.variant = (uint8_t)p->variant;
  sonic.animSpeed = (uint8_t)p->animSpeed;
  update_sprite(&sonic, 0);
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
  int tile = is_casino()
    ? (g < HUD_GLYPHS ? HUD_WHITE_TILE + g * 2 : HUD_RED_TILE + (g - HUD_GLYPHS) * 2)
    : (g < HUD_GLYPHS ? (int)hudTile + g * 2 : (int)hudTile + HUD_RED + (g - HUD_GLYPHS) * 2);
  put_oam(ORDER_DIGITS, x, y, OBJ_8x16, tile, 6, 0);
}
// the zero-ring count's frames past its five (hud.js pastTheFont): the two tiles the character select left at 20
static void hud_past(int x, int y) { put_oam(ORDER_DIGITS, x, y, OBJ_8x16, HUD_PAST_TILE, 6, 0); }
static void hud_update(int draw) {
  Hud *h = &act.hud;
  if (!h->active) return;
  if (draw) {
    // the icons: the ring over the ring count and the character's face by the lives, at OAM order 3
    put_oam(ORDER_ICONS, -2, -1, OBJ_32x32, is_casino() ? HUD_RING_TILE : (int)hudTile + HUD_RING, 6, 0);
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, is_casino() ? HUD_FACE_TILE : (int)hudTile + HUD_FACE, 0, 0);
    if (act.ringCount == 0) {
      static const int FLASH[5] = { 0, 11, 11, 0, 0 };
      int f = h->flash >> 3;
      if (f < 5) hud_glyph(FLASH[f], 9, 5);
      else if (is_casino()) hud_past(9, 5);
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

// --- the title card's state (engine/titlecard.js), without its pictures --------------------------------------------
static void card_update(int pressed) {
  if (act.cardDone) return;
  if (pressed && act.cardFrame > 35 && act.cardFrame < 215) act.cardFrame = 215;
  act.cardFrame++;
  if (act.cardFrame > 225) {
    act.cardDone = 1;
    act.clockStopped = 0;
    act.hud.active = 1;
    act.hud.flash = is_casino() && gba_start_number("power", 0) == 2 ? 0 : act.stage.hudFlash;
  }
}

// --- the frame (engine/game.js) ----------------------------------------------------------------------------------
static void draw_frame(void) {
  int camX = (int)act.cam.x, camY = (int)act.cam.y;
  // the act has no blend, and its first frames keep the course select's display, as the original does
  e.bldCnt = 0; e.bldAlpha = 0x0010; e.bldY = 0;
  e.dispCnt = 0x1E40;
  e.winRegs[0] = e.winRegs[1] = 0x00F0; e.winRegs[2] = e.winRegs[3] = 0x00A0;
  act.drawn++;
  // RenderMetatileLayers: BG1 and BG2 scroll by the camera's sub-tile part, their maps filled from the metatiles.
  // Casino Paradise's first act picture keeps the scroll the course select and its card left instead.
  if (!(is_casino() && act.drawn == 1)) {
    e.bgScroll[2] = (uint16_t)(camX & 7); e.bgScroll[3] = (uint16_t)(camY & 7);
    e.bgScroll[4] = (uint16_t)(camX & 7); e.bgScroll[5] = (uint16_t)(camY & 7);
  }
  fill_layer(0xF000, LAYER_FRONT, camX, camY);
  fill_layer(0xF800, LAYER_BACK, camX, camY);
  // StageBgUpdate_Zone7Act1: the 37 × 23 background scrolls as a whole. Its first frame keeps the course
  // select's scroll, which the original shows before the act's own update lands. Casino Paradise's own update
  // (StageBgUpdate_Zone3Acts12) runs from act_frame and leaves BG3's scroll and its HBlank table there.
  if (!is_casino()) {
    int bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W_));
    int bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H_));
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
    act.cam.bgX = bgX; act.cam.bgY = bgY;
  }

  // Sonic's sprite, at OAM order 16, in screen coordinates as the renderer draws him
  int right = act.player.facing > 0;
  int sx = (int)__builtin_floor(act.player.x) - camX, sy = (int)__builtin_floor(act.player.y) - camY + (is_casino() ? 5 : 0);
  sonic.oamFlags = ORDER_SONIC << 6;
  sonic.palId = 0;
  sonic.frameFlags = (uint16_t)((sonic.frameFlags & ~(SPRITE_PRIORITY | SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE)) | (2 << 12));
  if (act.player.state == PS_WALK) {
    sonic.frameFlags |= SPRITE_ROT_SCALE_ENABLE;
    Transform tf;
    tf.rotation = 0; tf.qScaleX = (int16_t)(right ? -256 : 256); tf.qScaleY = 256;
    tf.x = (int16_t)(sx - (right ? 1 : 0)); tf.y = (int16_t)sy;
    transform_sprite(&sonic, &tf);
  } else {
    if (act.player.facing > 0) sonic.frameFlags |= SPRITE_X_FLIP;
    sonic.x = (int16_t)(sx + (act.player.facing < 0 ? 1 : 0));
    sonic.y = (int16_t)sy;
  }
  display_sprite(&sonic);
  if (firstRingsMade) {
    update_sprite(&firstRings[0], 0); display_sprite(&firstRings[0]);
    update_sprite(&firstRings[1], 0); display_sprite(&firstRings[1]);
  }
}

static void act_frame(void) {
  int moves = act.cam.started;
  camera_update(&act.cam, &act.player);
  if (is_casino() && moves) { casino_background_update(); casino_background_tasks(); }
  stage_animated_tiles(1);
  act.cam.bgUpdates++;
  int left = (e.input & KEY_LEFT) != 0, right = (e.input & KEY_RIGHT) != 0;
  int up = (e.input & KEY_UP) != 0, down = (e.input & KEY_DOWN) != 0;
  int jump = (e.input & KEY_A) != 0, attack = (e.input & KEY_B) != 0;
  int jumpPressed = (e.pressed & KEY_A) != 0, attackPressed = (e.pressed & KEY_B) != 0;
  // the start point's first frame reads the right and A the original has held there, never pressed
  if (act.firstFrame) { left = 0; right = 1; jump = 1; attack = 0; jumpPressed = 0; attackPressed = 0; act.firstFrame = 0; }
  // the HUD's task runs before Sonic's and before the clock, as the original makes it (0x2180)
  if (act.cardDone) hud_update(1);
  step_player(&act.player, left, right, up, down, jump, jumpPressed, attack, attackPressed);
  if (act.drawn == 0 && jump && is_casino()) { act.player.state = PS_SPIN; act.player.curled = 1; act.player.air = 1; act.player.ysp = -4.875; }
  animate_player(&act.player);
  if (!act.clockStopped) act.courseTime++;
  act.tick++;
  draw_frame();
}

void act_task(Task *t) {
  (void)t;
  // a start point that handed over inside its own task already drew this frame, and the act's task is after it
  if (act.skipTask) { act.skipTask = 0; return; }
  act_frame();
}

/** Draws the act's first frame now, for a screen that hands over inside its own task. */
void act_frame_now(void) { act_frame(); act.skipTask = is_casino() ? 1 : 0; }

static int pendingLevel, pendingCard, pendingPre;
static void act_begin_task(Task *t) {
  destroy_task(t);
  act_start(pendingLevel, pendingCard, pendingPre);
  act_frame();
}

/** Starts the act on the next frame, so the frame the menu hands over still draws the menu. */
void act_queue(int level, int cardSkip, int preFrames) {
  pendingLevel = level; pendingCard = cardSkip; pendingPre = preFrames;
  create_task(act_begin_task, NULL, 0x0F00, 0, NULL);
}

/** The title card's frames before the first one the recording compares, run with no picture. */
static void pre_run(int cardSkip, int preFrames) {
  int after = 0;
  while (!act.cardDone || after < preFrames) {
    int wasDone = act.cardDone;
    int moves = act.cam.started;
    camera_update(&act.cam, &act.player);
    if (is_casino()) {
      if (moves) casino_background_update();
      palette_animations_pre();
      fireworks_pre();
    }
    stage_animated_tiles(0);
    if (!act.cardDone) card_update(cardSkip == act.tick);
    step_player(&act.player, 0, is_casino() ? 0 : act.cardDone, 0, 0, !act.cardDone, 0, !act.cardDone, 0);
    animate_player(&act.player);
    if (wasDone) { hud_update(0); after++; }
    if (!act.clockStopped) act.courseTime++;
    act.tick++;
  }
  if (is_casino()) stage_animated_tiles_pre();
}

void act_start(int level, int cardSkip, int preFrames) {
  memset(&act, 0, sizeof act);
  memset(fireworks, 0, sizeof fireworks);
  memset(&tileAnim, 0, sizeof tileAnim);
  load_stage(level);
  create_player(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  if (is_casino()) init_palette_animations();
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1; act.cardFrame = 0;
  act.hud.active = 0; act.hud.flash = is_casino() && gba_start_number("power", 0) == 2 ? 0 : act.stage.hudFlash;
  act.started = 0; act.drawn = 0;
  firstRingsMade = 0;
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

  // the HUD's tiles and colours (hudGraphics): the white and red digits, the ring and the face, at the
  // original's fixed sprite VRAM addresses
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1, &faceTiles, &facePalette, &layout);
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  if (is_casino()) {
    copy_rom(fontTiles + 32 * 32, OBJ_VRAM + HUD_WHITE_TILE * 32, 22 * 32);
    copy_rom(fontTiles + 224 * 32, OBJ_VRAM + HUD_RED_TILE * 32, 22 * 32);
    copy_rom(ringTiles, OBJ_VRAM + HUD_RING_TILE * 32, 16 * 32);
    copy_rom(faceTiles, OBJ_VRAM + HUD_FACE_TILE * 32, 4 * 32);
    uint32_t pastTiles, pastPalette;
    UiSlot pastLayout;
    ui_graphics(39, &pastTiles, &pastPalette, &pastLayout);
    copy_rom(pastTiles + 19 * 32, OBJ_VRAM + HUD_PAST_TILE * 32, 2 * 32);
    firstRingsMade = 0;
    copy_rom(0x3C06D4, OBJ_VRAM + 232 * 32, 4 * 32);
    // the two rings the act's first screen shows, animation 707, at the tiles the original gives them
    for (int i = 0; i < 2; i++) {
      sprite_init(&firstRings[i]);
      firstRings[i].graphics.dest = OBJ_VRAM + 232 * 32;
      firstRings[i].graphics.anim = 707; firstRings[i].variant = 0; firstRings[i].animSpeed = 0x10;
      firstRings[i].palId = 0; firstRings[i].oamFlags = 17 << 6; firstRings[i].frameFlags = 2 << 12;
      firstRings[i].x = (int16_t)(208 + i * 24); firstRings[i].y = 69;
    }
    firstRingsMade = 1;
  } else {
    hudVram = vram_malloc(64);
    hudTile = (hudVram - OBJ_VRAM) >> 5;
    copy_rom(fontTiles + 32 * 32, hudVram + HUD_WHITE * 32, 22 * 32);
    copy_rom(fontTiles + 224 * 32, hudVram + HUD_RED * 32, 22 * 32);
    copy_rom(ringTiles, hudVram + HUD_RING * 32, 16 * 32);
    copy_rom(faceTiles, hudVram + HUD_FACE * 32, 4 * 32);
  }
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  // the title card's name and zigzag use sprite palette 15, which its name graphics load last (LoadStageIntroGraphics)
  if (is_casino()) {
    uint32_t cardTiles, cardPalette;
    UiSlot cardLayout;
    ui_graphics(10, &cardTiles, &cardPalette, &cardLayout);
    for (int i = 0; i < 16; i++) e.objPalette[15 * 16 + i] = (uint16_t)rom_u16(cardPalette + i * 2);
  }
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;

  // the frames before the recording starts: the title card to its end, then its few frames after it
  pre_run(cardSkip, preFrames);
  if (is_casino()) create_palette_animation_tasks();
  // the first act frame keeps the scroll the course select and its title card left, as the original's does: the
  // camera task's first act frame only sets it going, so the act's own background update comes on the next one
  // the first act frame keeps the scroll the course select and its title card left, as the original's does: the
  // camera task's first act frame only sets it going, so the act's own background update comes on the next one
  if (is_casino()) {
    e.flags &= ~FLAGS_HBLANK_COPY;
    e.bgScroll[3] = (uint16_t)gba_start_number("bgs1", 3);
    e.bgScroll[4] = (uint16_t)gba_start_number("bgs2h", 0);
    e.bgScroll[5] = (uint16_t)gba_start_number("bgs2v", 3);
    act.cam.started = 0;
  }
  play_song(act.stage.music);
  gba_sound_frames_gone_by(118);
  act.hud.active = 1;
  act.started = 1;
  create_task(act_task, NULL, 0x0F00, 0, NULL);
}
