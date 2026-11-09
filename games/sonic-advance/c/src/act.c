// The acts in C: their stages and collision from the player's copy, the camera, Sonic on the ground, the HUD and the
// title card. Translated from the JavaScript version's engine/game.js, engine/player.js, engine/camera.js,
// engine/terrain.js, engine/stage.js, engine/hud.js, engine/titlecard.js and rom/extract.js, a function at a time;
// every comment names the original's function where one is rewritten.

#include "act.h"

void dp_sound_skip_frames(int frames);
#include "titlecard.h"

enum {
  OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC,
  OFFSET_RINGS = 0x0B7F4C, OFFSET_INTERACTABLES = 0x0B7F94,
  LAYER_FRONT = 0, LAYER_BACK = 1, IGNORE_PLATFORMS = 0x80,
  SCREEN_W_ = 240, SCREEN_H_ = 160,
};
// Casino Paradise act 2's palette animations, in StageInit_Zone3Act2's order (stage.c)
static const uint16_t CASINO_PALETTE_ANIMATIONS[11] = { 816, 817, 818, 824, 825, 827, 827, 828, 843, 844, 826 };
// Casino Paradise's background update (backgrounds.js BACKGROUND_UPDATE): the fireworks' task priority
enum { FIREWORK_PRIORITY = 0x4001 };
static int is_casino_level(int level) { return level == ACT_LEVEL_CASINO_2; }
static int is_casino(void) { return is_casino_level(act.stage.level); }
enum { SCROLL_NONE, SCROLL_SECRET_BASE_2, SCROLL_X_ZONE, SCROLL_CASINO };

// Each act's stage init settings (rom/levels.js StageInit_ZoneNActM): its zone and act, the song it starts, what its
// HUD's zero-ring counter finds in memory, how its background scrolls, the size of its BG3 map in tiles
// (sStageBgDimensions in the original, which the USA copy has 256 × 256 for Secret Base act 2), and the palette
// animations StageInit makes (palette_loader.c).
typedef struct { int zone, act, music, hudFlash, scroll, bgTilesW, bgTilesH, palA, palB, palC; } LevelMeta;
static const LevelMeta LEVEL_META[16] = {
  [0] = { 0, 0, 12, 90, SCROLL_NONE, 0, 0, 814, 815, -1 },
  [1] = { 0, 1, 13, 90, SCROLL_NONE, 0, 0, 814, 815, -1 },
  [2] = { 1, 0, 14, 56, SCROLL_NONE, 0, 0, 819, 845, 849 },
  [3] = { 1, 1, 15, 64, SCROLL_SECRET_BASE_2, 32, 32, 819, 845, 849 },
  [4] = { 2, 0, 16, 20, SCROLL_NONE, 0, 0, -1, -1, -1 },
  [5] = { 2, 1, 17, 52, SCROLL_CASINO, 32, 32, -1, -1, -1 },
  [6] = { 3, 0, 18, 90, SCROLL_NONE, 0, 0, 822, 821, -1 },
  [7] = { 3, 1, 19, 90, SCROLL_NONE, 0, 0, 822, 821, -1 },
  [8] = { 4, 0, 20, 90, SCROLL_NONE, 0, 0, 823, -1, -1 },
  [9] = { 4, 1, 21, 20, SCROLL_NONE, 0, 0, 823, -1, -1 },
  [10] = { 5, 0, 22, 4, SCROLL_NONE, 0, 0, 839, 840, 841 },
  [11] = { 5, 1, 23, 90, SCROLL_NONE, 0, 0, 829, 830, 831 },
  [12] = { 6, 0, 24, 90, SCROLL_X_ZONE, 37, 23, -1, -1, -1 },
  [13] = { 6, 1, 26, 1, SCROLL_NONE, 0, 0, -1, -1, -1 },
};

// --- the act's palette animations (engine/palettes.js, sprites.js paletteAnimation) ---------------------------------
typedef struct { int32_t palId; uint16_t insert, count; } PalLoad;
typedef struct { uint16_t delay; PalLoad loads[4]; int loadCount, at; } PalFrame;
typedef struct { int anim, variant, frameCount, loop, next, wait, shown; PalFrame frames[32]; } PaletteAnim;
static PaletteAnim palAnims[3];
static int palAnimCount;

static void palette_anim_init(PaletteAnim *p, int anim, int variant) {
  memset(p, 0, sizeof *p);
  p->anim = anim; p->variant = variant; p->shown = -1;
  if (anim < 0) return;
  uint32_t variants = rom_ptr(sprites.anims + (uint32_t)anim * 4u);
  uint32_t script = rom_ptr(variants + (uint32_t)variant * 4u);
  PalLoad pending[4];
  int pendingCount = 0;
  int jumpTo = -1;
  for (int cur = 0, guard = 0; guard < 600; guard++) {
    int32_t id = rom_s32(script + (uint32_t)cur * 4u);
    if (id >= 0) {
      if (p->frameCount >= 32) break;
      PalFrame *frame = &p->frames[p->frameCount++];
      frame->delay = (uint16_t)id; frame->at = cur; frame->loadCount = pendingCount;
      for (int i = 0; i < pendingCount; i++) frame->loads[i] = pending[i];
      pendingCount = 0;
      cur += 2;
      continue;
    }
    if (id == -2) {
      if (pendingCount < 4) {
        PalLoad *l = &pending[pendingCount++];
        l->palId = rom_s32(script + (uint32_t)cur * 4u + 4u);
        l->count = (uint16_t)rom_u16(script + (uint32_t)cur * 4u + 8u);
        l->insert = (uint16_t)rom_u16(script + (uint32_t)cur * 4u + 10u);
      }
      cur += 3;
      continue;
    }
    if (id == -3) { jumpTo = cur - rom_s32(script + (uint32_t)cur * 4u + 4u); break; }
    if (id == -4) break;
    // the other commands (tiles, sounds, hitboxes, priorities) change nothing this act's palette needs
    int words = id == -1 ? 3 : id == -5 ? 2 : id == -6 ? 3 : id == -7 ? 2 : id == -8 ? 3 : id == -9 ? 2 : id == -10 ? 4 : id == -11 || id == -12 ? 2 : 0;
    if (!words) break;
    cur += words;
  }
  p->loop = 0;
  if (jumpTo >= 0) for (int i = 0; i < p->frameCount; i++) if (p->frames[i].at >= jumpTo) { p->loop = i; break; }
}
static void palette_anim_step(PaletteAnim *p) {
  if (p->anim < 0) return;
  if (p->wait > 0) { p->wait -= 256; return; }
  if (p->next < 0 || p->next >= p->frameCount) return;
  p->shown = p->next;
  const PalFrame *frame = &p->frames[p->next];
  for (int i = 0; i < frame->loadCount; i++) {
    const PalLoad *l = &frame->loads[i];
    uint32_t src = sprites.palettes + (uint32_t)l->palId * 32u;
    for (int k = 0; k < l->count; k++) e.bgPalette[(l->insert + k) & 0xFF] = (uint16_t)rom_u16(src + (uint32_t)k * 2u);
  }
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  p->wait += (frame->delay - 1) * 256;
  p->next = p->next + 1 < p->frameCount ? p->next + 1 : p->loop;
}
static void palette_animations_step(void) { for (int i = 0; i < palAnimCount; i++) palette_anim_step(&palAnims[i]); }

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
#define BALL_SPRITE_OFFSET_Y 9   // curled up, his centre sits 5 px lower so his feet stay put (constants.js)
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
static uint32_t sonicVram, hudVram;
static int hudTile, hudRingTile, hudFaceTile;
// keeps the WebAssembly heap off a page boundary, so the copy and the start point both fit in the pages the copy grows
static volatile uint8_t heapPad[80] __attribute__((used));
static int firstPictureHidden;   // the level pick's loading frame: the act steps, but the screen keeps the black before it
static int restoreBackdrop;      // the stage's colour 0 comes back with the first picture after it
static uint16_t firstPictureBackdrop;

// --- the copy's data (rom/tilemaps.js, rom/collision.js, rom/entities.js, rom/levels.js) -------------------------
static Tilemap read_tilemap(int index) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + index * 4);
  Tilemap t;
  memset(&t, 0, sizeof t);
  t.at = at;
  t.xTiles = (uint16_t)rom_u16(at); t.yTiles = (uint16_t)rom_u16(at + 2);
  t.animTileSize = (uint16_t)rom_u16(at + 4); t.animFrameCount = (uint8_t)rom_u8(at + 6); t.animDelay = (uint8_t)rom_u8(at + 7);
  // the two stage layers share one tileset, as DrawBackground reads each layer's own header: both layers' tile
  // numbers read the same tiles, past 511 into the second character block
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
  const LevelMeta *meta = &LEVEL_META[level < 16 ? level : 0];
  s->zone = meta->zone; s->act = meta->act; s->music = meta->music; s->hudFlash = meta->hudFlash;
  s->scroll = meta->scroll;
  // the stage's tileset in both character blocks, which tile numbers past 511 read, and its 256 colours
  // (extractStage's palette). They go in at once, as the original's load does, so the act's first frame has them.
  for (uint32_t i = 0; i < s->front.tilesSize && i < 0x8000; i++) gba_vram[i] = (uint8_t)rom_u8(s->front.tiles + i);
  // past the tileset the original's VRAM is what the card left, a blank run with a few tiles in it (the ROM's
  // 0x3D7074, one of the four copies of this tileset's tail)
  if (is_casino_level(level)) copy_rom(0x3D7074, 0x7D00, 0x300);
  for (int i = 0; i < 256; i++) e.bgPalette[i] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the maps the course select left are cleared, as the original's stage init leaves the parts its own maps don't
  // fill zero; the front and back layers' maps come in each frame
  for (uint32_t at = 0xE000; at < 0x10000; at += 2) { gba_vram[at] = 0; gba_vram[at + 1] = 0; }
  // the background's tiles at the second character block, and its map at 0xE000. Casino Paradise's 32 × 32 map is
  // one 256 × 256 text layer at 0xE800 (InitCamera's STGBG_SCRN_DIM(256, 256, 2, 29)); the others' maps are at
  // 0xE000, a 512-wide one as two 32-tile blocks, columns 32 on at 0xE800.
  for (uint32_t i = 0; i < s->background.tilesSize && 0x8000u + i < 0x10000u; i++) gba_vram[0x8000u + i] = (uint8_t)rom_u8(s->background.tiles + i);
  int bgTilesW = meta->bgTilesW ? meta->bgTilesW : s->background.xTiles;
  int bgTilesH = meta->bgTilesH ? meta->bgTilesH : s->background.yTiles;
  int bgWide = !is_casino_level(level) && bgTilesW > 32, bgTall = !is_casino_level(level) && bgTilesH > 32;
  if (is_casino_level(level)) {
    for (int row = 0; row < s->background.yTiles; row++)
      for (int col = 0; col < s->background.xTiles; col++) {
        uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
        uint32_t at = 0xE800 + (uint32_t)(row * 32 + col) * 2u;
        gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
      }
  } else {
    for (int row = 0; row < bgTilesH; row++) {
      for (int col = 0; col < bgTilesW; col++) {
        uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
        uint32_t at;
        if (bgWide) at = (col < 32 ? 0xE000 + (uint32_t)col * 2u : 0xE800 + (uint32_t)(col - 32) * 2u) + (uint32_t)row * 64u;
        else at = 0xE000 + ((uint32_t)row * 32u + (uint32_t)col) * 2u;
        gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
      }
    }
  }
  // InitCamera's registers: BG1 the front layer, BG2 the back one, BG3 the background, all 16 colours
  e.dispCnt = 0x304E;           // OBJ on, window 0 on, BG1, BG2 and BG3 on, 1D OAM
  e.bgCnt[1] = 0x1E01;          // 256 × 256, priority 1, map 30 (0xF000), character base 0
  e.bgCnt[2] = 0x1F02;          // 256 × 256, priority 2, map 31 (0xF800), character base 0
  if (is_casino_level(level)) e.bgCnt[3] = 0x1D0B;   // 256 × 256, priority 3, map 29 (0xE800)
  else {
    int bgSize = bgWide ? (bgTall ? 3 : 1) : (bgTall ? 2 : 0);
    e.bgCnt[3] = (uint16_t)((bgSize << 14) | 0x1C00 | 0x0B);   // priority 3, map 28 (0xE000), character base 2 (0x8000)
  }
}


// --- the level's rings and interactables (rom/entities.js, engine/rings.js, engine/objects.js) --------------------
// The BIOS's RLUnComp format, as the level's entity lists keep it: a size word, then runs and literal blocks.
static int rl_decompress(uint32_t at, uint8_t *out, uint32_t room) {
  uint32_t header = rom_u32(at);
  uint32_t size = header >> 8;
  if ((header & 0xFF) != 0x30 || size > room) return 0;
  uint32_t i = at + 4, n = 0;
  while (n < size) {
    uint32_t flag = rom_u8(i++);
    if (flag & 0x80) {
      uint32_t b = rom_u8(i++);
      for (uint32_t k = (flag & 0x7F) + 3; k > 0 && n < size; k--) out[n++] = (uint8_t)b;
    } else {
      for (uint32_t k = (flag & 0x7F) + 1; k > 0 && n < size; k--) out[n++] = (uint8_t)rom_u8(i++);
    }
  }
  return (int)size;
}
static uint32_t grid_u32(const uint8_t *data, int at) {
  return (uint32_t)data[at] | (uint32_t)data[at + 1] << 8 | (uint32_t)data[at + 2] << 16 | (uint32_t)data[at + 3] << 24;
}

typedef struct { int32_t x, y; int taken; } Ring;
static Ring rings[512];
static int ringCount;
static Sprite ringSprite;

// the sparkle a taken ring leaves (CreateCollectRingEffect), at the objects' order, 15
typedef struct { Sprite s; int x, y, active, pending; } RingSparkle;
static RingSparkle sparkles[8];

typedef struct { int32_t x, y; Sprite vent, lid; int blowing; } SteamExhaust;
static SteamExhaust steams[16];
static int steamCount;

static void load_rings(int level) {
  static uint8_t data[0x4000];
  ringCount = 0;
  int size = rl_decompress(rom_ptr(OFFSET_RINGS + (uint32_t)level * 4u), data, sizeof data);
  if (!size) return;
  int regionsX = (int)grid_u32(data, 4), regionsY = (int)grid_u32(data, 8);
  for (int r = 0; r < regionsX * regionsY; r++) {
    uint32_t offset = grid_u32(data, 12 + r * 4);
    if (!offset) continue;
    int rx = r % regionsX, ry = r / regionsX;
    for (int at = 4 + (int)offset; at < size && data[at] != 0xFF; at += 2) {
      if (ringCount >= (int)(sizeof rings / sizeof rings[0])) return;
      rings[ringCount].x = data[at] * 8 + rx * 256;
      rings[ringCount].y = data[at + 1] * 8 + ry * 256;
      rings[ringCount].taken = 0;
      ringCount++;
    }
  }
}
static void load_steam_exhausts(int level) {
  static uint8_t data[0x4000];
  steamCount = 0;
  int size = rl_decompress(rom_ptr(OFFSET_INTERACTABLES + (uint32_t)level * 4u), data, sizeof data);
  if (!size) return;
  int regionsX = (int)grid_u32(data, 4), regionsY = (int)grid_u32(data, 8);
  for (int r = 0; r < regionsX * regionsY; r++) {
    uint32_t offset = grid_u32(data, 12 + r * 4);
    if (!offset) continue;
    int rx = r % regionsX, ry = r / regionsX;
    for (int at = 4 + (int)offset; at + 6 < size && data[at] != 0xFF; at += 7) {
      if (data[at + 2] != 79 || steamCount >= (int)(sizeof steams / sizeof steams[0])) continue;
      SteamExhaust *s = &steams[steamCount++];
      s->x = data[at] * 8 + rx * 256;
      s->y = data[at + 1] * 8 + ry * 256;
      s->blowing = 0;
      sprite_init(&s->vent);
      s->vent.graphics.dest = OBJ_VRAM + 532u * 32u;
      s->vent.graphics.anim = 501; s->vent.variant = 0;
      s->vent.oamFlags = 18 << 6; s->vent.palId = 0; s->vent.frameFlags = 2 << 12;
      sprite_init(&s->lid);
      s->lid.graphics.dest = OBJ_VRAM + 556u * 32u;
      s->lid.graphics.anim = 501; s->lid.variant = 2;
      s->lid.oamFlags = 17 << 6; s->lid.palId = 0; s->lid.frameFlags = 2 << 12;
    }
  }
}
static int ring_touching(const Player *p, const Ring *r) {
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y), oy = p->offsetY;
  int l = px - 6, right = px + 6, top = py - oy, bottom = py + oy;
  return ((r->x - 8 <= l && r->x + 8 >= l) || (r->x - 8 >= l && right >= r->x - 8))
    && ((r->y - 16 <= top && r->y >= top) || (r->y - 16 >= top && bottom >= r->y - 16));
}
static void spawn_sparkle(int x, int y) {
  for (int i = 0; i < 8; i++) {
    if (sparkles[i].active) continue;
    RingSparkle *sp = &sparkles[i];
    memset(sp, 0, sizeof *sp);
    sp->active = 1; sp->pending = 1; sp->x = x; sp->y = y;
    sprite_init(&sp->s);
    sp->s.graphics.dest = OBJ_VRAM + 600u * 32u;
    sp->s.graphics.anim = 708; sp->s.variant = 0;
    sp->s.oamFlags = 15 << 6; sp->s.frameFlags = 2 << 12;
    return;
  }
}
static void step_rings(void) {
  update_sprite(&ringSprite, 0);
  // a ring Sonic touches is taken, with its sparkle and sound on the next sound effect player by the count's parity
  if (!act.player.dead) {
    for (int i = 0; i < ringCount; i++) {
      Ring *r = &rings[i];
      if (r->taken || !ring_touching(&act.player, r)) continue;
      r->taken = 1;
      act.ringCount++;
      int odd = act.ringCount & 1;
      spawn_sparkle((int)r->x, (int)r->y);
      gba_sound_start_on(odd ? 2 : 1, 117);
      gba_sound_imm_init(odd ? 2 : 1);
      gba_sound_volume(odd ? 2 : 1, 0xFFFF, 128);
      gba_sound_pan(odd ? 2 : 1, 0xFFFF, odd ? -64 : 64);
    }
  }
  for (int i = 0; i < 8; i++) {
    RingSparkle *sp = &sparkles[i];
    if (!sp->active) continue;
    // the sparkle's task starts the ring song again on its first frame, as the original's does
    if (sp->pending) { sp->pending = 0; gba_sound_play(117); }
    if (update_sprite(&sp->s, 0) == 0) sp->active = 0;
  }
}
static void draw_rings(int camX, int camY) {
  for (int i = 0; i < ringCount; i++) {
    Ring *r = &rings[i];
    int sx = (int)r->x - camX, sy = (int)r->y - camY;
    if (r->taken || sx < -8 || sx > SCREEN_W_ + 8 || sy < 0 || sy - 16 > SCREEN_H_) continue;
    ringSprite.x = (int16_t)sx; ringSprite.y = (int16_t)sy;
    display_sprite(&ringSprite);
  }
  for (int i = 0; i < 8; i++) {
    RingSparkle *sp = &sparkles[i];
    if (!sp->active) continue;
    sp->s.x = (int16_t)(sp->x - camX); sp->s.y = (int16_t)(sp->y - camY);
    display_sprite(&sp->s);
  }
}
static void step_steam_exhausts(void) {
  for (int i = 0; i < steamCount; i++) {
    SteamExhaust *s = &steams[i];
    update_sprite(&s->vent, 0);
    update_sprite(&s->lid, 0);
  }
}
static void draw_steam_exhausts(int camX, int camY) {
  for (int i = 0; i < steamCount; i++) {
    SteamExhaust *s = &steams[i];
    s->vent.x = (int16_t)(s->x - camX); s->vent.y = (int16_t)(s->y - camY);
    s->lid.x = s->vent.x; s->lid.y = s->vent.y;
    display_sprite(&s->vent);
    display_sprite(&s->lid);
  }
}

// a stage layer's visible tile entries around the camera (DrawBackground's level-map path)
static uint16_t stage_entry(int layer, int tx, int ty) {
  const Collision *c = &act.stage.collision;
  int mx = fdiv(tx, 12), my = fdiv(ty, 12), lx = tx - mx * 12, ly = ty - my * 12;
  if (mx < 0 || my < 0 || mx >= c->levelX || my >= c->levelY) return 0;
  uint32_t id = rom_u8(c->layers[layer & 1] + my * c->levelX + mx);
  // Casino Paradise's two layers share the front tilemap's atlas; the others read each layer's own, as #1009's
  // Secret Base act 2 does
  uint32_t map = (is_casino() || !layer) ? act.stage.front.map : act.stage.back.map;
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
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
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
// TaskDestructor_MultiplayerSpriteTask: the task gives its sprite's tiles back to the heap
static void firework_destroy(Task *t) {
  Firework *f = t->data;
  vram_free(f->s.graphics.dest);
}
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
    create_task(firework_task, f, FIREWORK_PRIORITY, 0, firework_destroy);
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
// returns 1 when it puts him on the surface, 0 when it leaves him in the air
static int ground_sensors(Player *p) {
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
  if (val < -11) return 0;
  int limit = (int)__builtin_floor(__builtin_fabs(speed)) + 3;
  if (limit > 11) limit = 11;
  if (val > 0 && val > limit) { p->air = 1; p->pushing = 0; return 0; }
  if (mode == 0) p->y += val; else if (mode == 1) p->x -= val; else if (mode == 2) p->y -= val; else p->x += val;
  if (!(rot & 1)) p->rotation = p->inverted ? (uint8_t)(-0x80 - rot) : (uint8_t)rot;
  return 1;
}
static void follow_ground(Player *p) {
  if (is_casino() && p->air) {
    // Player_AirCollision (sub_8022190), moving down: the floor under his feet, not the ground sensors, which would
    // pull him down onto it while he is still above it
    if (p->ysp < 0) return;
    int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) + p->offsetY;
    int layer = p->layer | (p->ysp < 0 ? IGNORE_PLATFORMS : 0);
    Scan a = scan(1, y, x - 8, layer, 8), b = scan(1, y, x + 8, layer, 8);
    Scan f = a.d < b.d ? a : b;
    int out = a.d < b.d ? b.d : a.d;
    if (f.d >= 0 || out < -((int)__builtin_floor(p->ysp) + 6)) return;
    p->rotation = (uint8_t)f.rot;
    p->y += f.d;
    // Player_Land: he comes down walking, uncurled with his feet where they landed, so his centre moves up
    // the five pixels between the ball's offset and his standing one
    p->state = PS_WALK; p->curled = 0; set_offset_y(p, SPRITE_OFFSET_Y);
    p->air = 0; p->ysp = 0; p->gsp = p->xsp;
    return;
  }
  int snapped = ground_sensors(p);
  if (is_casino() && snapped) { p->air = 0; p->ysp = 0; }
}
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
  }
  bounds(p);
  move_player(p);
  // the original's air step moves him first and only then adds gravity, so the first move uses the jump's own speed
  if (p->air && is_casino()) p->ysp += 42.0 / 256;
  follow_ground(p);
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
    put_oam(ORDER_ICONS, -2, -1, OBJ_32x32, hudRingTile, 6, 0);
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, hudFaceTile, 0, 0);
    if (act.ringCount == 0) {
      static const int FLASH[5] = { 0, 11, 11, 0, 0 };
      // the HUD's task runs seven frames into the act, so its flash starts then
      int f = h->flash >= 7 ? (h->flash - 7) >> 3 : 0;
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

// --- the stage's animated tiles (engine/stage.js animateStageTiles, src/background.c UpdateBgAnimationTiles) ------
static int stageAnimFrame, stageAnimDelay, stageAnimShown;
static void stage_tiles_step(void) {
  const Tilemap *t = &act.stage.front;
  if (t->animFrameCount <= 1 || !t->animTileSize) return;
  stageAnimShown = stageAnimFrame;
  int delay = t->animDelay ? t->animDelay : 1;
  if (++stageAnimDelay < delay) return;
  stageAnimDelay = 0;
  stageAnimFrame = (stageAnimFrame + 1) % t->animFrameCount;
}
static void stage_tiles_draw(void) {
  const Tilemap *t = &act.stage.front;
  if (t->animFrameCount <= 1 || !t->animTileSize || stageAnimShown == 0) return;
  uint32_t src = t->tiles + t->tilesSize + (uint32_t)(stageAnimShown - 1) * t->animTileSize;
  for (uint32_t i = 0; i < t->animTileSize && i < 0x4000; i++) gba_vram[i] = (uint8_t)rom_u8(src + i);
}

// --- the background (engine/backgrounds.js) ----------------------------------------------------------------------
static int js_mod(int a, int n) { int r = a % n; return r < 0 ? r + n : r; }

/**
 * StageBgUpdate_Zone2Act2's scroll for one screen line (StageBgUpdate_Zone2_Interior): [x, y] where the line's
 * first pixel comes from, and the map row shown above it. The wall repeats every 64 lines, and the three bars
 * and the bigger one are laid over it.
 */
static void secret_base_scroll(int line, int cx, int cy, int *outX, int *outY) {
  int x = (cx >> 2) & 0xFF, row = (line + ((cy >> 2) & 63)) & 63;
  for (int i = 0; i < 3; i++) {
    int k = js_mod(line + ((cy >> 1) + (i << 6)) + 16, 256);
    if (k < 16) { x = ((cx >> 1) + (i << 5)) & 0xFF; row = 64 + k; }
  }
  int k = js_mod(line + (cy * 2) / 3 + 288 + 24, 256);
  if (k < 24) { x = ((cx * 2) / 3 + 96) & 0xFF; row = 80 + k; }
  *outX = x;
  *outY = row - line;
}
static void scroll_background(int camX, int camY) {
  if (act.stage.scroll == SCROLL_SECRET_BASE_2) {
    int x, y;
    // the base scroll the original keeps, and the line table over it
    e.bgScroll[6] = (uint16_t)((camX >> 2) & 0xFF); e.bgScroll[7] = (uint16_t)((camY >> 2) & 0xFF);
    set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
    for (int line = 0; line < SCREEN_H_; line++) {
      secret_base_scroll(line, camX, camY, &x, &y);
      put16(e.primary + (uint32_t)line * 4u, (uint32_t)x);
      put16(e.primary + (uint32_t)line * 4u + 2u, (uint32_t)y);
    }
  } else {
    int bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W_));
    int bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H_));
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
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
  if (!is_casino()) stage_tiles_draw();
  fill_layer(0xF000, LAYER_FRONT, camX, camY);
  fill_layer(0xF800, LAYER_BACK, camX, camY);
  // the act's background: StageBgUpdate_Zone2Act2's lines, StageBgUpdate_Zone7Act1's whole map, or Casino Paradise's
  // own update (StageBgUpdate_Zone3Acts12), which act_frame runs and which leaves BG3's scroll and HBlank table there
  if (!is_casino()) scroll_background(camX, camY);

  // the act's rings and Steam Base's steam exhausts, at their OAM orders
  draw_rings(camX, camY);
  draw_steam_exhausts(camX, camY);
  // Sonic's sprite, at OAM order 16, in screen coordinates as the renderer draws him
  int right = act.player.facing > 0;
  int sx = (int)__builtin_floor(act.player.x) - camX, sy = (int)__builtin_floor(act.player.y) - camY;
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
}

static void act_frame(void) {
  int hidden = firstPictureHidden;
  firstPictureHidden = 0;
  int cardEnded = 0;
  if (!act.cardDone) {
    int pressed = (e.pressed & (KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN | KEY_A | KEY_B)) != 0;
    if (!titlecard_step(pressed)) {
      cardEnded = 1;
      act.cardDone = 1;
      act.clockStopped = 0;
      act.hud.active = 1;
      act.hud.flash = is_casino() && gba_start_number("power", 0) == 2 ? 0 : act.stage.hudFlash;
    }
  }
  int moves = act.cam.started;
  camera_update(&act.cam, &act.player);
  if (is_casino() && moves) { casino_background_update(); casino_background_tasks(); }
  if (is_casino()) stage_animated_tiles(1); else stage_tiles_step();
  step_rings();
  step_steam_exhausts();
  act.cam.bgUpdates++;
  int left = (e.input & KEY_LEFT) != 0, right = (e.input & KEY_RIGHT) != 0;
  int up = (e.input & KEY_UP) != 0, down = (e.input & KEY_DOWN) != 0;
  int jump = (e.input & KEY_A) != 0, attack = (e.input & KEY_B) != 0;
  int jumpPressed = (e.pressed & KEY_A) != 0, attackPressed = (e.pressed & KEY_B) != 0;
  // the start point's first frame reads the right and A the original has held there, never pressed
  if (act.firstFrame) { left = 0; right = 1; jump = 1; attack = 0; jumpPressed = 0; attackPressed = 0; act.firstFrame = 0; }
  // the card holds Sonic and the clock; the HUD's task it makes first runs on the frame after it ends
  if (!act.cardDone) { left = right = up = down = jump = attack = 0; jumpPressed = attackPressed = 0; }
  else if (!cardEnded) hud_update(1);
  step_player(&act.player, left, right, up, down, jump, jumpPressed, attack, attackPressed);
  if (act.drawn == 0 && jump && is_casino()) {
    // the held A started his jump on the frame before the first one compared: its sound plays at the act's start,
    // and this is the jump's first compared frame
    act.player.state = PS_SPIN; act.player.curled = 1; act.player.air = 1; act.player.ysp = -3.0;
    set_offset_y(&act.player, BALL_SPRITE_OFFSET_Y);
  }
  animate_player(&act.player);
  palette_animations_step();
  if (!act.clockStopped) act.courseTime++;
  act.tick++;
  if (hidden) {
    // the level pick's loading frame: the act's first frame runs, but the screen stays the black the hand-over left
    e.dispCnt = 0; e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
    e.bgPalette[0] = 0; e.flags |= FLAGS_UPDATE_BG_PALETTES;
    e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
    e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;
    restoreBackdrop = 1;
    return;
  }
  if (restoreBackdrop) {
    e.bgPalette[0] = firstPictureBackdrop; e.flags |= FLAGS_UPDATE_BG_PALETTES;
    restoreBackdrop = 0;
  }
  draw_frame();
  titlecard_draw();
}

void act_task(Task *t) {
  (void)t;
  // a start point that handed over inside its own task already drew this frame, and the act's task is after it
  if (act.skipTask) { act.skipTask = 0; return; }
  act_frame();
}

/** Draws the act's first frame now, for a screen that hands over inside its own task. */
void act_frame_now(void) { act_frame(); act.skipTask = 0; }

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
static void pre_run(int cardSkip, int preFrames, int prelude) {
  // the course select's frames before the card, which a start point at the A leaves out: the stage's own clock,
  // its background, its fireworks and its random numbers still run through them, as the original's do. The card
  // and the palette animations start after them, as the original's card does.
  for (int i = 0; i < prelude; i++) {
    int moves = act.cam.started;
    camera_update(&act.cam, &act.player);
    if (is_casino()) {
      if (moves) { casino_background_update(); casino_background_tasks(); }
      fireworks_pre();
    }
    if (is_casino()) stage_animated_tiles(0); else stage_tiles_step();
    act.tick++;
    engine_copy_graphics();
  }
  int after = 0;
  while (!act.cardDone || after < preFrames) {
    if (act.cardDone) {
      // the frames after the card only settle the HUD's task, which runs a frame after the card ends: the stage keeps
      // the frame it ended on, as the original's does, and only the clock and the HUD move on
      if (!act.clockStopped) act.courseTime++;
      hud_update(0);
      after++;
      continue;
    }
    int wasDone = act.cardDone;
    int moves = act.cam.started;
    camera_update(&act.cam, &act.player);
    if (is_casino()) {
      if (moves) { casino_background_update(); casino_background_tasks(); }
      palette_animations_pre();
      fireworks_pre();
    }
    if (is_casino()) stage_animated_tiles(0); else stage_tiles_step();
    step_rings();
    step_steam_exhausts();
    if (!act.cardDone) {
      titlecard_step(cardSkip == act.tick);
      if (!titlecard_active()) {
        act.cardDone = 1;
        act.clockStopped = 0;
        act.hud.active = 1;
        act.hud.flash = is_casino() && gba_start_number("power", 0) == 2 ? 0 : act.stage.hudFlash;
      }
    }
    // the card holds Sonic still, as the original's does
    step_player(&act.player, 0, 0, 0, 0, 0, 0, 0, 0);
    animate_player(&act.player);
    palette_animations_step();
    if (wasDone) { hud_update(0); after++; }
    if (!act.clockStopped) act.courseTime++;
    act.tick++;
    // these frames run with no V-blank, so what each one queued for video memory goes in now, as the original's did
    engine_copy_graphics();
  }
  if (is_casino()) stage_animated_tiles_pre();
  // the card's last frame steps the stage's animations once, as the original's does; the ring then steps on the
  // original's next frame, two display frames into the act
  ringSprite.qAnimDelay = 512;
  for (int i = 0; i < palAnimCount; i++) palAnims[i].wait += 256;
}

void act_start(int level, int cardSkip, int preFrames) {
  memset(&act, 0, sizeof act);
  // what the course select still had queued is dropped, as its screen's maps are: the act's own come next
  clear_queues();
  clear_bg_sprites();
  for (int i = 0; i < 4; i++) { e.mapFill[i].value = 0; memset(e.mapFill[i].rect, 0, sizeof e.mapFill[i].rect); }
  // a firework still going from the last act ends here and gives its tiles back before the array is cleared
  for (int i = 0; i < 8; i++) {
    if (!fireworks[i].live) continue;
    destroy_tasks(FIREWORK_PRIORITY, FIREWORK_PRIORITY + 1);
    break;
  }
  memset(fireworks, 0, sizeof fireworks);
  memset(&tileAnim, 0, sizeof tileAnim);
  load_stage(level);
  const LevelMeta *meta = &LEVEL_META[level < 16 ? level : 0];
  palAnimCount = 0;
  if (meta->palA >= 0) palette_anim_init(&palAnims[palAnimCount++], meta->palA, 0);
  if (meta->palB >= 0) palette_anim_init(&palAnims[palAnimCount++], meta->palB, 0);
  if (meta->palC >= 0) palette_anim_init(&palAnims[palAnimCount++], meta->palC, 0);
  load_rings(level);
  load_steam_exhausts(level);
  sprite_init(&ringSprite);
  ringSprite.graphics.dest = OBJ_VRAM + (level == 3 || is_casino_level(level) ? 232u : 240u) * 32u;
  ringSprite.graphics.anim = 707; ringSprite.variant = 0;
  memset(sparkles, 0, sizeof sparkles);
  ringSprite.oamFlags = 20 << 6; ringSprite.palId = 0; ringSprite.frameFlags = 2 << 12;
  create_player(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  if (is_casino()) init_palette_animations();
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1;
  act.hud.active = 0; act.hud.flash = is_casino() && gba_start_number("power", 0) == 2 ? 0 : act.stage.hudFlash;
  act.started = 0; act.drawn = 0;
  stageAnimFrame = 0; stageAnimDelay = 0; stageAnimShown = 0;
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

  // the HUD's tiles and colours (hudGraphics): the white and red digits, the ring and the face. Its place in
  // sprite memory is where the original's act puts it after its player and its objects: in Secret Base act 2 and
  // Casino Paradise act 2 the face at 64, the ring at 68 and the digits at 84, and 400 for the whole sheet in X Zone,
  // whose recording fixed it.
  if (level == 3 || is_casino_level(level)) {
    hudVram = OBJ_VRAM + 84u * 32u;
    hudTile = 84; hudRingTile = 68; hudFaceTile = 64;
  } else {
    hudVram = vram_malloc(64);
    hudTile = (int)((hudVram - OBJ_VRAM) >> 5); hudRingTile = hudTile + HUD_RING; hudFaceTile = hudTile + HUD_FACE;
  }
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1, &faceTiles, &facePalette, &layout);
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  // the HUD's graphics go in now, before the act's first frame, as its tiles are there on it
  for (uint32_t i = 0; i < 22 * 32; i++) gba_vram[hudVram + HUD_WHITE * 32 + i] = (uint8_t)rom_u8(fontTiles + 32 * 32 + i);
  for (uint32_t i = 0; i < 22 * 32; i++) gba_vram[hudVram + HUD_RED * 32 + i] = (uint8_t)rom_u8(fontTiles + 224 * 32 + i);
  for (uint32_t i = 0; i < 16 * 32; i++) gba_vram[OBJ_VRAM + (uint32_t)hudRingTile * 32u + i] = (uint8_t)rom_u8(ringTiles + i);
  for (uint32_t i = 0; i < 4 * 32; i++) gba_vram[OBJ_VRAM + (uint32_t)hudFaceTile * 32u + i] = (uint8_t)rom_u8(faceTiles + i);
  // the two tiles a zero-ring count reads past its string, which the character select left at 20
  if (is_casino_level(level)) {
    uint32_t pastTiles, pastPalette;
    UiSlot pastLayout;
    ui_graphics(39, &pastTiles, &pastPalette, &pastLayout);
    copy_rom(pastTiles + 19 * 32, OBJ_VRAM + HUD_PAST_TILE * 32, 2 * 32);
  }
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;

  // the title card's pictures and its pieces, from the act's first frame
  titlecard_start(level, ctx.character);
  // the card's pieces in palette 6 use the HUD font's colours, which the stage's init loads last, as the original does
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
  // a start point that opens past the card runs its frames with no picture
  if (gba_start_point("level") != NULL || cardSkip >= 0 || preFrames > 0) pre_run(cardSkip, preFrames, (int)gba_start_number("prelude", 0));
  // the HUD's task first runs on the act's first frame, so its zero-ring flash starts then
  if (is_casino()) act.hud.flash = 0;
  // the original's palette tasks have loaded one more frame by the act's first frame for the rows that change in it;
  // animations 818, 825 and 828 are already on the right frame, as their longer delays show
  if (is_casino()) {
    static const int behind[] = { 0, 1, 3, 8, 10 };
    for (unsigned k = 0; k < sizeof behind / sizeof behind[0]; k++) {
      paletteAnims[behind[k]].s.qAnimDelay = 0;
      update_sprite(&paletteAnims[behind[k]].s, 1);
    }
    // animation 818 steps one display frame earlier than the card left it
    paletteAnims[2].s.qAnimDelay = (int16_t)(paletteAnims[2].s.qAnimDelay - 256);
    // the delay-6 animations step two display frames earlier than the card left them
    paletteAnims[0].s.qAnimDelay = (int16_t)(paletteAnims[0].s.qAnimDelay - 512);
    paletteAnims[10].s.qAnimDelay = (int16_t)(paletteAnims[10].s.qAnimDelay - 512);
    // the delay-8 animations step at the original's next frame, four frames on
    static const int next[] = { 4, 5, 6, 7, 9 };
    for (unsigned k = 0; k < sizeof next / sizeof next[0]; k++) paletteAnims[next[k]].s.qAnimDelay = 256;
    create_palette_animation_tasks();
  }
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
  // the act's music starts with the act, as the stage's init does; a start point that opens past the card gets the
  // frames the card played first, as the original's init does before its first picture
  if (gba_start_point("level") != NULL) {
    // Casino Paradise's act music has played the card's frames by its first picture; the other start points keep
    // the frame count their own recordings were proven with
    if (is_casino_level(level)) {
      // the original's music manager starts the act's song with its volume and fade-in as the song starts, before
      // the card; a start point that skips those frames does the same before the skip, so the fade is over by its
      // first frame
      gba_sound_imm_init(0); gba_sound_volume(0, 0xFF, 4); gba_sound_fade_in(0, 4);
      gba_sound_frames_gone_by(227);
      int skip = (int)gba_start_number("skip", 232);
      // a start point whose first act frame is a jump the course select's A began: its sound starts on the card's
      // last frames, before the first compared one, as the original's does; the music still skips the same frames
      if (gba_start_number("jump", 0)) {
        int advance = (int)gba_start_number("jumpadv", 1);
        dp_sound_skip_frames(skip - advance);
        play_song(SONG_JUMP);
        dp_sound_skip_frames(advance);
      } else dp_sound_skip_frames(skip);
    } else gba_sound_frames_gone_by(118);
  } else { gba_sound_imm_init(0); gba_sound_volume(0, 0xFF, 4); gba_sound_fade_in(0, 4); }
  act.hud.active = 1;
  act.started = 1;
  create_task(act_task, NULL, 0x0F00, 0, NULL);
  // the level pick's first frame runs with the picture still the black the hand-over left; the card's first picture
  // comes on the frame after it
  firstPictureHidden = gba_start_point("level") == NULL && cardSkip < 0 && preFrames == 0;
  if (firstPictureHidden) {
    firstPictureBackdrop = e.bgPalette[0];
    e.dispCnt = 0; e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
    e.bgPalette[0] = 0; e.flags |= FLAGS_UPDATE_BG_PALETTES;
    e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
    e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;
  }
}
