// X Zone's act in C: its stage and collision from the player's copy, the camera, Sonic on the ground, the HUD, and
// the title card's state without its pictures. Translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js, a
// function at a time; every comment names the original's function where one is rewritten.

#include "act.h"
#include "titlecard.h"

// the kit's sound output, as the page asks for a frame's samples (kit/gba/c/sound.c): the act renders the frames
// before its first one here, to put the stage's music where the original has it
float *dp_sound_render(int count);

enum {
  OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC, OFFSET_RINGS = 0x0B7F4C, OFFSET_INTERACTABLES = 0x0B7F94, OFFSET_ITEMBOXES = 0x0B7FDC, OFFSET_ENEMIES = 0x0B8024,
  LAYER_FRONT = 0, LAYER_BACK = 1, IGNORE_PLATFORMS = 0x80,
  SCREEN_W_ = 240, SCREEN_H_ = 160,
};

// what each act's StageInit sets besides its music (rom/levels.js): its zone and act, the song, the zero-ring
// flash the HUD starts with, how far short of its right edge the camera stops, and its palette animations
typedef struct { int zone, act, music, hudFlash, cameraStop; int palette[PALETTE_ANIMATIONS_MAX][2]; int paletteCount; } LevelInfo;
static const LevelInfo LEVELS[] = {
  { 0, 0, 12, 90, 0,   { { 814, 0 }, { 815, 0 } }, 2 },                                    // Neo Green Hill act 1
  { 0, 1, 13, 90, 768, { { 814, 0 }, { 815, 0 }, { 820, 1 }, { 820, 0 } }, 4 },              // Neo Green Hill act 2
};
// X Zone's stage init, which the act engine's first piece was written for
static const LevelInfo X_ZONE_INFO = { 6, 0, 24, 90, 0, { { 0, 0 } }, 0 };
enum { PS_IDLE, PS_WALK, PS_TURN, PS_BRAKE, PS_CROUCH, PS_LOOKUP, PS_SPIN, PS_HURT, PS_DEAD,
  PS_SPIN_ATTACK, PS_SOMERSAULT, PS_SLIDE, PS_SLIDE_END, PS_SPRING, PS_SPRING_RISE, PS_SPRING_PEAK, PS_SPRING_FALL,
  PS_ACT_CLEAR_RUN, PS_BALANCE_FORWARD, PS_BALANCE_BACK, PS_PUSH };
enum { SONIC_IDLE = 0, SONIC_WALK = 4, SONIC_RUN = 5, SONIC_TURN = 6, SONIC_BRAKE_TURN = 7, SONIC_SPIN = 8,
  SONIC_BRAKE = 9, SONIC_SPRING = 11, SONIC_SPRING_RISE = 10, SONIC_SPRING_PEAK = 10, SONIC_SPRING_FALL = 10,
  SONIC_SPIN_ATTACK = 51, SONIC_SOMERSAULT = 52, SONIC_SLIDE = 53, SONIC_SLIDE_END = 53, SONIC_PUSH = 12,
  SONIC_HURT = 19, SONIC_DEAD = 21, SONIC_ACT_CLEAR_RUN = 22, SONIC_BALANCE_FORWARD = 13, SONIC_BALANCE_BACK = 14 };
// the HUD's graphics sit at the reserved addresses sub_80538BC copies them to (vram_hardcoded.h): the white
// digits at 0xD40, the red at 0xA80, the ring at 0x880 and the character's face at 0x800
enum { HUD_GLYPHS = 11, HUD_WHITE_TILE = 84, HUD_RED_TILE = 106, HUD_RING_TILE = 68, HUD_FACE_TILE = 64,
  HUD_WHITE = 0, HUD_RED = 22, HUD_RING = 44, HUD_FACE = 60 };
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
#define BALL_OFFSET_Y 9
#define JUMP_SPEED 4.875
#define GRAVITY (42.0 / 256)
#define AIR_ACCELERATION (16.0 / 256)
#define JUMP_RELEASE_CAP 3.0
#define RISE_CAP 11.8125
#define ROLL_FRICTION (4.0 / 256)
#define ROLL_DECELERATION (24.0 / 256)
#define SPIN_ATTACK_SPEED 2.0
#define SOMERSAULT_SPEED 3.0
#define SLIDE_SPEED 4.0
#define ATTACK_FRICTION (8.0 / 256)
#define SLIDE_FRICTION (32.0 / 256)
#define WALL_MIN_SPEED 1.875
#define SLIP_LOCK 30
#define HURT_SPEED_X 2.0
#define HURT_SPEED_Y 4.0
#define INVULNERABLE_FRAMES 120
#define DEAD_RESTART 61
#define SONG_JUMP 116
#define SONG_SPIN 109
#define SONG_RING 117
#define SONG_SPRING 170
#define SONG_SPIKES 171

Act act;
/** Whether this is Neo Green Hill act 2, whose frame timing this engine worked out first; the acts before it keep
 *  the timing their recordings matched with. */
static int act2(void) { return act.stage.level == 1; }
static Sprite sonic;
static uint32_t sonicVram, hudVram, hudTile;
static PaletteAnimation paletteAnims[PALETTE_ANIMATIONS_MAX];
static int paletteCount;
static int firstPictureHidden, restoreBackdrop;   // the hand-over's black frame, and the stage's colour 0 after it
static uint16_t firstPictureBackdrop;

// --- the copy's data (rom/tilemaps.js, rom/collision.js, rom/entities.js, rom/levels.js) -------------------------
static Tilemap read_tilemap(int index) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + index * 4);
  Tilemap t;
  memset(&t, 0, sizeof t);
  t.at = at;
  t.xTiles = (uint16_t)rom_u16(at); t.yTiles = (uint16_t)rom_u16(at + 2);
  t.animTileSize = (uint16_t)rom_u16(at + 4); t.animFrameCount = (uint8_t)rom_u8(at + 6); t.animDelay = (uint8_t)rom_u8(at + 7);
  // the back layer's own tiles are at +0x24, after the front's; its tile numbers past 511 read them from the second
  // character block, as the original's stage init loads them there
  uint32_t tilesAt = at + 8;
  if (index % 3 == 1 && rom_u32(at + 0x24) >= 0x08000000) tilesAt = at + 0x24;
  t.tiles = rom_ptr(tilesAt); t.tilesSize = rom_u32(at + 12);
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
static int ground_mode(int rot) {
  int r = (int8_t)rot;
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
  s->width = s->collision.width; s->height = s->collision.height;
  const LevelInfo *info = level >= 0 && level < (int)(sizeof LEVELS / sizeof LEVELS[0]) ? &LEVELS[level] : &X_ZONE_INFO;
  s->zone = info->zone; s->act = info->act; s->music = info->music; s->hudFlash = info->hudFlash;
  s->cameraStop = info->cameraStop;
  // BG3's map and size: Neo Green Hill's 32 × 32 at 0xE800 in 256 × 256, X Zone's 37 × 23 at 0xE000 in 512 × 256
  s->bgMapBase = s->zone == 0 ? 0xE800 : 0xE000;
  s->bgCnt = s->zone == 0 ? 0x1D0B : 0x5C0B;
  paletteCount = info->paletteCount;
  for (int i = 0; i < paletteCount; i++) { paletteAnims[i].anim = info->palette[i][0]; paletteAnims[i].variant = info->palette[i][1]; }
  // the front layer's tiles, in the first character block, and the stage's 256 colours (extractStage's palette).
  // The whole tileset goes in, its four animation frames after the static part, at the tiles the animation copies
  // its current frame from (UpdateBgAnimationTiles).
  if (act2()) {
    uint32_t frontSize = s->front.tilesSize + (uint32_t)(s->front.animFrameCount > 0 ? s->front.animFrameCount - 1 : 0) * s->front.animTileSize;
    if (s->front.tiles + frontSize <= gba_rom_size) memcpy(gba_vram, gba_rom + s->front.tiles, frontSize);
  } else {
    // the front layer's tiles in the first character block and the back's in the second, which tile numbers past
    // 511 read
    copy_rom(s->front.tiles, 0, s->front.tilesSize);
    copy_rom(s->back.tiles, 0x4000, s->back.tilesSize);
  }
  for (int i = 0; i < 256; i++) e.bgPalette[i] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the background's tiles at the second character block, and its 37 × 23 map at 0xE000: a 512-wide text layer
  // is two 32-tile blocks, so columns 32–36 go to the block at 0xE800 (DrawBackground, copy_backgrounds)
  copy_rom(s->background.tiles, 0x8000, s->background.tilesSize);
  for (int row = 0; row < s->background.yTiles; row++) {
    for (int col = 0; col < s->background.xTiles; col++) {
      uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
      uint32_t at = s->bgMapBase + (col < 32 ? (uint32_t)col * 2u : 0x800u + (uint32_t)(col - 32) * 2u) + (uint32_t)row * 64u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
  }
  // InitCamera's registers: BG1 the front layer, BG2 the back one, BG3 the background, all 16 colours
  e.dispCnt = 0x304E;           // OBJ on, window 0 on, BG1, BG2 and BG3 on, 1D OAM
  e.bgCnt[1] = 0x1E01;          // 256 × 256, priority 1, map 30 (0xF000), character base 0
  e.bgCnt[2] = 0x1F02;          // 256 × 256, priority 2, map 31 (0xF800), character base 0
  e.bgCnt[3] = s->bgCnt;        // the background's size, priority, map and character base (xZone: 512 × 256 at 0xE000)
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
  c->maxX = act.stage.width - (act.stage.cameraStop ? act.stage.cameraStop : SCREEN_W_);
  c->maxY = act.stage.height - SCREEN_H_;
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
    if (!p->pushing && p->state != PS_CROUCH) p->state = PS_IDLE;
  }
}
static void ground_sensors(Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), soy = p->offsetY;
  int mode = ground_mode(act_angle(p));
  Scan a, b; double speed;
  // the walls beside a steep slope are scanned as rows (engine/sensors.js groundSensors, sub_8022B18 and
  // sub_8022C44), the floor and the ceiling as columns
  if (mode == 0) { a = scan(1, y + soy, x - 8, p->layer, 8); b = scan(1, y + soy, x + 8, p->layer, 8); speed = p->xsp; }
  else if (mode == 1) { a = scan(0, x - soy, y - 8, p->layer, -8); b = scan(0, x - soy, y + 8, p->layer, -8); speed = p->ysp; }
  else if (mode == 2) { a = scan(1, y - soy, x + 8, p->layer, -8); b = scan(1, y - soy, x - 8, p->layer, -8); speed = p->xsp; }
  else { a = scan(0, x + soy, y + 8, p->layer, 8); b = scan(0, x + soy, y - 8, p->layer, 8); speed = p->ysp; }
  if (a.hasRot) p->rotA = (uint8_t)a.rot;
  if (b.hasRot) p->rotB = (uint8_t)b.rot;
  int val = a.d < b.d ? a.d : b.d, rot = a.d < b.d ? p->rotA : p->rotB;
  if (val < -11) return;
  if (val > 0) {
    int limit = (int)__builtin_floor(__builtin_fabs(speed)) + 3;
    if (limit > 11) limit = 11;
    if (val > limit) { p->air = 1; p->pushing = 0; return; }
  }
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
// --- Sonic's moves (engine/player.js, player_sonic.c and player.c) ----------------------------------------------
static void curl(Player *p) { p->curled = 1; set_offset_y(p, BALL_OFFSET_Y); }
static void uncurl(Player *p) { p->curled = 0; set_offset_y(p, SPRITE_OFFSET_Y); }
static void upright(Player *p) {
  int r = (int8_t)p->rotation;
  p->rotation = (uint8_t)(r > 0 ? (r > 2 ? r - 2 : 0) : r < -2 ? r + 2 : 0);
}
static void tumble(Player *p) { upright(p); }
static void roll_slope(Player *p) {
  if (((p->rotation + 0x60) & 0xFF) >= 0xC0 || p->gsp == 0) return;
  int acc = (sin8(p->rotation) * 60) >> 8;
  if ((p->gsp > 0 && acc <= 0) || (p->gsp < 0 && acc >= 0)) acc >>= 2;
  p->gsp = (q8(p->gsp) + acc) / Q8;
}
static void air_control(Player *p, int dir) {
  if (p->airLock || !dir) return;
  p->facing = dir;
  double v = p->xsp + AIR_ACCELERATION * dir;
  if (v * dir > MAX_RUN_SPEED) {
    v -= AIR_ACCELERATION * dir;
    if (v * dir < MAX_RUN_SPEED) v = MAX_RUN_SPEED * dir;
  }
  p->xsp = v;
}
static void air_drag(Player *p) {
  double drag = (int)__builtin_floor(p->xsp * 256 / 32) / 256.0;
  p->xsp = p->xsp > 0 ? (p->xsp - drag > 0 ? p->xsp - drag : 0) : p->xsp < 0 ? (p->xsp - drag < 0 ? p->xsp - drag : 0) : 0;
}
static int try_jump(Player *p, int jumpPressed) {
  if (!jumpPressed) return 0;
  p->air = 1; p->jumped = 1; p->pushing = 0; p->state = PS_SPIN;
  int a = (p->rotation - 0x40) & 0xFF, jump = q8(JUMP_SPEED);
  p->xsp = (q8(p->xsp) + ((jump * cos8(a)) >> 8)) / Q8;
  p->ysp = (q8(p->ysp) + ((jump * sin8(a)) >> 8)) / Q8;
  if (p->curled) p->airLock = 1; else curl(p);
  play_song(SONG_JUMP);
  return 1;
}
static void landing_speed(Player *p, int rot) {
  int sign = (int8_t)rot < 0 ? -1 : 1;
  if ((rot + 0x20) & 0x40) {
    p->xsp = 0; p->ysp = p->ysp < 11.8125 ? p->ysp : 11.8125; p->gsp = __builtin_fabs(p->ysp) * sign;
  } else if (!((rot + 0x10) & 0x20)) { p->ysp = 0; p->gsp = p->xsp; }
  else { p->ysp = (int)(p->ysp * 128) / 256.0; p->gsp = __builtin_fabs(p->ysp) * sign; }
}
static void land(Player *p) {
  p->air = 0; p->pushing = 0;
  if (!p->actClear) p->state = PS_WALK;
  if (p->curled) uncurl(p);
  p->offsetY = SPRITE_OFFSET_Y;
  p->airLock = 0;
  p->attack = 0; p->attackNext = 0; p->midAir = 0; p->jumped = 0; p->spinDashing = 0;
}
static void dead_step(Player *p) {
  if (!p->death) {
    p->death = 1; p->state = PS_DEAD; p->xsp = 0; p->invulnerable = 2; p->pushing = 0;
    p->attack = 0; p->attackNext = 0; p->midAir = 0; p->jumped = 0; p->spinDashing = 0;
    act.clockStopped = 1;
    return;
  }
  if (p->death == 1) {
    double gone = act.cam.y + 160 + 80;
    if (p->y >= gone) { p->death = 2; p->countdown = DEAD_RESTART; p->hidden = 1; return; }
    move_player(p); p->ysp += GRAVITY;
    return;
  }
  if (p->countdown) p->countdown--;
}
// ArcTan2, the GBA BIOS call (SWI 0x0A) as engine/trig.js works it out
static int arc_tan(int i) {
  int a = -((i * i) >> 14);
  int b = ((0xA9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91C;
  b = ((b * a) >> 14) + 0xFB6;
  b = ((b * a) >> 14) + 0x16AA;
  b = ((b * a) >> 14) + 0x2081;
  b = ((b * a) >> 14) + 0x3651;
  b = ((b * a) >> 14) + 0xA2F9;
  return (i * b) >> 16;
}
static int arc_tan2(int x, int y) {
  int r;
  if (!y) r = x >= 0 ? 0 : 0x8000;
  else if (!x) r = y >= 0 ? 0x4000 : 0xC000;
  else if (y >= 0) {
    if (x >= 0 && x >= y) r = arc_tan((y << 14) / x);
    else if (x < 0 && -x >= y) r = arc_tan((y << 14) / x) + 0x8000;
    else r = 0x4000 - arc_tan((x << 14) / y);
  } else {
    if (x <= 0 && -x > -y) r = arc_tan((y << 14) / x) + 0x8000;
    else if (x > 0 && x >= -y) r = arc_tan((y << 14) / x) + 0x10000;
    else r = 0xC000 - arc_tan((x << 14) / y);
  }
  return r & 0xFFFF;
}
// the sensor pairs the air code uses (engine/sensors.js floorPair and ceilingPair)
static void floor_pair(const Player *p, int *d, int *rot, int *out) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) + p->offsetY, m = p->layer | (p->ysp < 0 ? IGNORE_PLATFORMS : 0);
  Scan a = scan(1, y, x - 8, m, 8), b = scan(1, y, x + 8, m, 8);
  if (a.d < b.d) { *d = a.d; *rot = a.rot; *out = b.d; } else { *d = b.d; *rot = b.rot; *out = a.d; }
}
static void ceiling_pair(const Player *p, int *d, int *rot, int *out) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y) - p->offsetY, m = p->layer | (p->ysp < 3 ? IGNORE_PLATFORMS : 0);
  Scan a = scan(1, y, x - 8, m, -8), b = scan(1, y, x + 8, m, -8);
  if (a.d < b.d) { *d = a.d; *rot = a.rot; *out = b.d; } else { *d = b.d; *rot = b.rot; *out = a.d; }
}
// a wall 9 px out to one side, which stops him (engine/sensors.js airWall)
static int air_wall(Player *p, int dir, int solid) {
  int m = p->layer | (p->ysp < 3 && !solid ? IGNORE_PLATFORMS : 0);
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  Scan s = scan(0, x + dir * (3 + 6), y, m, 8 * dir);
  if (s.d > 0) return 0;
  p->x += dir * s.d; p->xsp = 0;
  return 1;
}
// a solid surface under him while falling, over him while rising, and the walls beside him (sub_8022190)
static void air_collision(Player *p) {
  int vx = q8(p->xsp), vy = q8(p->ysp), down = p->inverted ? -1 : 1;
  int a = (vx || vy) ? arc_tan2(vx, vy) >> 8 : p->inverted ? 0x80 : 0;
  int d, rot, out;
  switch (((a - 0x20) & 0xC0) >> 6) {
    case 0:   // moving down
      air_wall(p, -1, 0); air_wall(p, 1, 0);
      floor_pair(p, &d, &rot, &out);
      if (d >= 0 || out < -((int)__builtin_floor(p->ysp) + 6)) return;
      p->rotation = (uint8_t)rot; p->y += down * d; land(p); landing_speed(p, rot);
      return;
    case 2:   // moving up
      air_wall(p, -1, 0); air_wall(p, 1, 0);
      ceiling_pair(p, &d, &rot, &out);
      if (d > 0) return;
      p->y -= down * d;
      // only one of the two steep ceiling slopes catches him (0x41–0x5F), as in the original
      if (((rot + 0x20) & 0x40) && (int8_t)rot > 0x40) {
        p->rotation = (uint8_t)rot; land(p); p->gsp = __builtin_fabs(p->ysp);
        return;
      }
      p->ysp = 0;
      return;
    default: {   // moving left (1) or right (3)
      int dir = a >= 0x60 && a < 0xA0 ? -1 : 1;
      if (air_wall(p, dir, p->inverted)) p->gsp = p->ysp;   // a quirk of the original
      ceiling_pair(p, &d, &rot, &out);
      if (d <= 0) {
        p->y -= down * d;
        if (p->ysp < 0) p->ysp = 0;
      } else if (p->ysp >= 0) {
        floor_pair(p, &d, &rot, &out);
        if (d > 0) return;
        p->y += down * d; p->rotation = (uint8_t)rot;
        land(p); p->ysp = 0; p->gsp = p->xsp;
      }
    }
  }
}
static void attack_step(Player *p, int attackPressed) {
  switch (p->attack) {
    case 0:
      if (p->spinDashing || p->pushing || !attackPressed) return;
      p->gsp = SPIN_ATTACK_SPEED * p->facing; p->xsp = 0; p->attack = 1; p->state = PS_SPIN_ATTACK;
      play_song(SONG_SPIN);
      return;
    case 1:
      p->gsp = toward0(q8(p->gsp), q8(ATTACK_FRICTION)) / Q8; along_surface(p);
      if (p->gsp == 0) { p->state = PS_IDLE; p->attack = 0; }
      if (attackPressed) { p->gsp = SOMERSAULT_SPEED * p->facing; p->attack = 2; p->attackNext = 0; p->state = PS_SOMERSAULT; play_song(SONG_SPIN); }
      return;
    case 2:
      p->gsp = toward0(q8(p->gsp), q8(ATTACK_FRICTION)) / Q8; along_surface(p);
      if (p->attackNext == 0 && attackPressed) p->attackNext = 1;
      return;
    case 3:
      p->gsp = toward0(q8(p->gsp), q8(SLIDE_FRICTION)) / Q8; along_surface(p);
      if (p->gsp == 0) { p->state = PS_SLIDE_END; p->attack = 4; }
      return;
  }
}
static void roll_step(Player *p, int dir) {
  if (dir && !p->lock) {
    if (p->gsp * dir >= 0) p->facing = dir;
    else { p->gsp += ROLL_DECELERATION * dir; if (p->gsp * dir > 0) p->gsp = REVERSE_KICK * dir; }
  }
  p->gsp = toward0(q8(p->gsp), q8(ACCELERATION / 2)) / Q8;
  if (p->gsp == 0) { uncurl(p); p->state = dir ? PS_WALK : PS_IDLE; }
  along_surface(p);
}
static void hurt(Player *p) {
  if (p->invulnerable || p->dead) return;
  p->invulnerable = INVULNERABLE_FRAMES;
  p->xsp = p->xsp < 0 || (p->xsp == 0 && p->facing < 0) ? HURT_SPEED_X : -HURT_SPEED_X;
  p->ysp = -HURT_SPEED_Y;
  p->air = 1; p->pushing = 0; p->airLock = 0; p->state = PS_HURT; uncurl(p);
  p->attack = 0; p->attackNext = 0; p->midAir = 0; p->jumped = 0; p->spinDashing = 0;
}
static void step_player(Player *p, int left, int right, int up, int down, int jump, int jumpPressed, int attack, int attackPressed) {
  int sideways = left || right;
  int dir = left && !right ? -1 : right && !left ? 1 : 0;
  (void)up; (void)down; (void)attack;
  p->jumpPressed = jumpPressed; p->attackPressed = attackPressed;
  if (p->dead) { dead_step(p); return; }
  if (p->invulnerable > 1) p->invulnerable--;
  if (!p->air) {
    if (p->curled) {
      if (try_jump(p, jumpPressed)) return;
      roll_slope(p); roll_step(p, dir);
    } else if (p->attack != 0) {
      slope(p); attack_step(p, attackPressed);
    } else {
      if (attackPressed) { attack_step(p, attackPressed); if (p->attack) return; }
      if (try_jump(p, jumpPressed)) return;
      slope(p);
      walk_input(p, dir, sideways);
      if (!sideways) p->gsp = toward0(q8(p->gsp), q8(FRICTION)) / Q8;
      along_surface(p);
    }
    bounds(p); move_player(p); follow_ground(p);
  } else {
    if (p->state == PS_HURT) {
      bounds(p); move_player(p); p->ysp += GRAVITY; tumble(p); air_collision(p); return;
    }
    if (p->jumped) {
      if (p->ysp < -JUMP_RELEASE_CAP) { if (!jump) p->ysp = -JUMP_RELEASE_CAP; }
      else if (p->midAir == 0 && jumpPressed) { p->airLock = 0; p->midAir = 1; }
    } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;
    air_control(p, dir);
    if (p->ysp < 0) air_drag(p);
    bounds(p); move_player(p); p->ysp += GRAVITY; tumble(p); air_collision(p);
  }
}

// chooseAnimation and tickAnim (engine/player.js, engine/animator.js)
static void choose_animation(Player *p) {
  if (p->pushing) p->state = PS_PUSH;
  double speed = __builtin_fabs(p->gsp);
  int speedI = (int)speed; (void)speedI;
  int anim = SONIC_IDLE, variant = 0, speedAnim = ANIM_NORMAL;
  switch (p->state) {
    case PS_WALK:
      if (speed >= RUN_ANIM_SPEED) anim = SONIC_RUN;
      else {
        anim = SONIC_WALK;
        int s = (int)((q8(p->gsp) >> 4) & 0xFFFF);
        speedAnim = s < 8 ? 8 : s > ANIM_NORMAL ? ANIM_NORMAL : s;
      }
      break;
    case PS_TURN: anim = SONIC_TURN; break;
    case PS_BRAKE: anim = speed < 1.5 ? SONIC_BRAKE_TURN : SONIC_BRAKE; break;
    case PS_SPIN: anim = SONIC_SPIN; break;
    case PS_SPIN_ATTACK: anim = SONIC_SPIN_ATTACK; break;
    case PS_SOMERSAULT: anim = SONIC_SOMERSAULT; break;
    case PS_SLIDE: anim = SONIC_SLIDE; break;
    case PS_SLIDE_END: anim = SONIC_SLIDE_END; variant = 1; break;
    case PS_HURT: anim = SONIC_HURT; break;
    case PS_DEAD: anim = SONIC_DEAD; break;
    case PS_PUSH: anim = SONIC_PUSH; break;
    case PS_BALANCE_FORWARD: anim = SONIC_BALANCE_FORWARD; break;
    case PS_BALANCE_BACK: anim = SONIC_BALANCE_BACK; break;
    case PS_ACT_CLEAR_RUN: anim = SONIC_ACT_CLEAR_RUN; break;
    case PS_SPRING: anim = SONIC_SPRING; break;
    case PS_SPRING_RISE: anim = SONIC_SPRING_RISE; break;
    case PS_SPRING_PEAK: anim = SONIC_SPRING_PEAK; variant = 1; break;
    case PS_SPRING_FALL: anim = SONIC_SPRING_FALL; variant = 2; break;
    default:
      if (p->idleT == 0) anim = 1;   // bored
      break;
  }
  if (p->idleT && p->state == PS_IDLE) p->idleT--;
  p->anim = anim; p->variant = variant; p->animSpeed = speedAnim;
}
static void after_animation(Player *p) {
  switch (p->state) {
    case PS_SPIN_ATTACK:
    case PS_SLIDE_END: p->attack = 0; p->state = p->gsp != 0 ? PS_WALK : PS_IDLE; break;
    case PS_SOMERSAULT:
      if (p->attackNext == 1) { p->gsp = SLIDE_SPEED * p->facing; p->attack = 3; p->attackNext = 0; p->state = PS_SLIDE; }
      else { p->attack = 0; p->state = PS_IDLE; p->gsp = 0; }
      break;
    case PS_SPRING:
    case PS_SPRING_PEAK: p->state = PS_SPRING_FALL; break;
    case PS_SPRING_FALL: p->state = PS_WALK; break;
  }
}
static void animate_player(Player *p) {
  choose_animation(p);
  // a new animation clears both his hitboxes until its script sets them (sub_802486C, engine/player.js choose)
  if (sonic.graphics.anim != (uint16_t)p->anim) { sonic.hitboxes[0].index = -1; sonic.hitboxes[1].index = -1; }
  sonic.graphics.anim = (uint16_t)p->anim;
  sonic.variant = (uint8_t)p->variant;
  sonic.animSpeed = (uint8_t)p->animSpeed;
  if (update_sprite(&sonic, 0) == 0) after_animation(p);
}

// --- the act's rings (engine/rings.js, rings_manager.c) ---------------------------------------------------------
#define RING_MAX 512
typedef struct { int x, y, rx, ry, taken; } Ring;
static Ring rings[RING_MAX];
static int ringTotal;
static uint8_t ringData[32768];
static Sprite ringSprite;

static int rl_decompress(uint32_t at, uint8_t *out, int cap) {
  uint32_t header = rom_u32(at);
  if ((header & 0xFF) != 0x30) return 0;
  int size = (int)(header >> 8), i = (int)at + 4, n = 0;
  while (n < size && n < cap) {
    uint8_t flag = (uint8_t)rom_u8(i++);
    if (flag & 0x80) { uint8_t b = (uint8_t)rom_u8(i++); for (int k = (flag & 0x7F) + 3; k > 0 && n < size && n < cap; k--) out[n++] = b; }
    else for (int k = (flag & 0x7F) + 1; k > 0 && n < size && n < cap; k--) out[n++] = (uint8_t)rom_u8(i++);
  }
  return n;
}
static uint32_t data32(const uint8_t *d, int at) { return d[at] | d[at + 1] << 8 | d[at + 2] << 16 | (uint32_t)d[at + 3] << 24; }
static void load_rings(int level) {
  ringTotal = 0;
  uint32_t raw = rom_u32(OFFSET_RINGS + level * 4);
  if (raw < ROM_BASE || raw >= ROM_BASE + gba_rom_size) return;
  uint32_t table = raw - ROM_BASE;
  int n = rl_decompress(table, ringData, sizeof ringData);
  if (n < 12) return;
  uint32_t rx = data32(ringData, 4), ry = data32(ringData, 8);
  if (rx * ry > 4096) return;
  for (uint32_t r = 0; r < rx * ry; r++) {
    uint32_t off = data32(ringData, 12 + r * 4);
    if (!off) continue;
    for (int at = 4 + (int)off; at + 1 < n && ringData[at] != 0xFF; at += 2) {
      if (ringTotal >= RING_MAX) return;
      Ring *g = &rings[ringTotal++];
      g->x = ringData[at] * 8 + (int)(r % rx) * 256;
      g->y = ringData[at + 1] * 8 + (int)(r / rx) * 256;
      g->rx = (int)(r % rx); g->ry = (int)(r / rx);
      g->taken = 0;
    }
  }
}
// a ring covers 16 × 16 px above its point (engine/rings.js touching)
static int ring_touches(int px, int py, int oy, int rx, int ry) {
  int l = px - 6, r = px + 6, t = py - oy, b = py + oy;
  return ((rx - 8 <= l && rx + 8 >= l) || (rx - 8 >= l && r >= rx - 8))
    && ((ry - 16 <= t && ry >= t) || (ry - 16 >= t && b >= ry - 16));
}
static void rings_init(void) {
  for (int i = 0; i < ringTotal; i++) rings[i].taken = 0;
  sprite_init(&ringSprite);
  // the original keeps the collectible ring's tiles at OBJ VRAM tile 232 (0x1D00), the base its OAM entries name
  // (rings_manager.h, RESERVED_RING_TILES_VRAM for SA1); the OAM entries' tile is that base plus the frame's 4 tiles
  ringSprite.graphics.dest = OBJ_VRAM + 0x1D00;
  ringSprite.graphics.anim = 707; ringSprite.variant = 0; ringSprite.animSpeed = ANIM_NORMAL;
  ringSprite.palId = 0; ringSprite.oamFlags = 20 << 6; ringSprite.frameFlags = 2 << 12;   // its colours in row 7, away from the HUD's row 6
  // the rings manager is made while the stage loads, and its task runs through the frames the load takes before the
  // act's first frame: sixteen of them, as the palette animations' first step at tick 16 shows. Its spin is that far
  // on when the act's first frame is drawn
  for (int i = 0; i < 16; i++) update_sprite(&ringSprite, 0);
}
static void sparkle_make(int x, int y);

// addRing (game.js): the count, and the ring song on the second sound player for odd ones and the first for even
static void ring_take(const Ring *g) {
  act.ringCount++;
  sparkle_make(g->x, g->y);
  int odd = act.ringCount & 1, p = odd ? 2 : 1;
  gba_sound_start_on(p, SONG_RING);
  gba_sound_volume(p, 0xFF, 128);
  gba_sound_pan(p, 0xFF, odd ? -64 : 64);
  (void)g;
}
static void rings_collect(Player *p) {
  if (!p || p->dead) return;
  // the ring manager searches the 256 px regions under his box, its bottom and right edges a ring's height and
  // half its width in, so a ring just in the next region down or right waits a frame (Task_RingsMgrMain)
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y), oy = p->offsetY;
  int ry0 = fdiv(py - oy, 256), ry1 = fdiv(py + oy - 16, 256);
  int rx0 = fdiv(px - 6 - 8, 256), rx1 = fdiv(px + 6 - 8, 256);
  for (int i = 0; i < ringTotal; i++) {
    Ring *g = &rings[i];
    if (g->taken || g->ry < ry0 || g->ry > ry1 || g->rx < rx0 || g->rx > rx1) continue;
    if (ring_touches(px, py, oy, g->x, g->y)) { g->taken = 1; ring_take(g); }
  }
}
static void rings_update(void) { update_sprite(&ringSprite, 0); }
static void rings_draw(int camX, int camY) {
  // region by region from the camera's, as the original draws them, so each ring keeps its place in OAM's order
  int ry0 = camY >> 8, ry1 = (camY + SCREEN_H_ - 1) >> 8, rx0 = camX >> 8, rx1 = (camX + SCREEN_W_ - 1) >> 8;
  for (int i = 0; i < ringTotal; i++) {
    Ring *g = &rings[i];
    if (g->taken || g->ry < ry0 || g->ry > ry1 || g->rx < rx0 || g->rx > rx1) continue;
    int sx = g->x - camX, sy = g->y - camY;
    if (sx < -8 || sx + 8 > SCREEN_W_ + 16 || sy < 0 || sy - 16 > SCREEN_H_) continue;
    ringSprite.x = (int16_t)(sx); ringSprite.y = (int16_t)(sy);
    ringSprite.frameFlags = (ringSprite.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_PRIORITY)) | (2 << 12);
    display_sprite(&ringSprite);
  }
}
// a collected ring leaves its sparkle (CreateCollectRingEffect, engine/game.js sparkle): a task made in the ring
// manager's own frame, so its first step and first picture are the next frame, at OAM order 15 and the ring effect's
// own reserved tiles; it ends on its animation's End, and its last picture shows on the frame it ends
#define SPARKLE_MAX 8
typedef struct { int x, y, fresh, dead; Sprite s; } Sparkle;
static Sparkle sparkles[SPARKLE_MAX];
static int sparkleCount;

static void sparkle_make(int x, int y) {
  if (sparkleCount >= SPARKLE_MAX) return;
  Sparkle *sp = &sparkles[sparkleCount++];
  sp->x = x; sp->y = y; sp->fresh = 1; sp->dead = 0;
  sprite_init(&sp->s);
  sp->s.graphics.dest = OBJ_VRAM + 0x1F00;   // RESERVED_RING_EFFECT_TILES_VRAM (0x1F00 for SA1)
  sp->s.graphics.anim = 708; sp->s.variant = 0; sp->s.animSpeed = ANIM_NORMAL;
  sp->s.palId = 0; sp->s.oamFlags = 15 << 6; sp->s.frameFlags = 2 << 12;
}
static void sparkles_update(void) {
  for (int i = 0; i < sparkleCount; i++) {
    Sparkle *sp = &sparkles[i];
    if (sp->dead) continue;
    // the task is made in the frame's ring manager and runs after it that same frame, as TaskCreate puts it just
    // after every task of its priority
    sp->fresh = 0;
    if (update_sprite(&sp->s, 0) == 0) sp->dead = 1;
  }
}
static void sparkles_draw(int camX, int camY) {
  for (int i = 0; i < sparkleCount; i++) {
    Sparkle *sp = &sparkles[i];
    sp->s.x = (int16_t)(sp->x - camX); sp->s.y = (int16_t)(sp->y - camY);
    display_sprite(&sp->s);
  }
  int kept = 0;
  for (int i = 0; i < sparkleCount; i++) if (!sparkles[i].dead) sparkles[kept++] = sparkles[i];
  sparkleCount = kept;
}
// --- item boxes, springs, spikes and the act's enemies ------------------------------------------------------------
// The entities manager makes each object's task when its point comes into the camera's range, and that task runs
// from that same frame (Task_8008DCC). A sprite's tiles come from VramMalloc when its task is made, so the heap's
// addresses follow the spawn order; a task that leaves frees them. Here the objects keep their data from the act's
// tables, and their sprites are made when they first come in and freed when they leave, in the same order.
#define ENT_MAX 64
typedef struct { int kind, x, y, rx, ry, seq, d[4], active, spawned, gone, live, dy, vy, hopping, phase, n; Sprite box, icon; } Box;
typedef struct { int x, y, dead; Sprite s; } Dust;
static Dust dusts[8]; static int dustCount;
static void dust_make(int x, int y);
typedef struct { int kind, x, y, rx, ry, seq, d[4], active, spawned, animState, visible; int launching; Sprite s; } Obj;
typedef struct { int kind, x, y, rx, ry, seq, d[4], active, spawned, anim, variant; Sprite s; } Prop;
// the layer toggles (interactables 17 and 18): an unseen rectangle that sets which collision layer Sonic touches
typedef struct { int layer, x, y, w, h; } Toggle;
static Toggle toggles[ENT_MAX]; static int toggleCount;
static Box boxes[ENT_MAX]; static int boxCount;
static Obj springs[ENT_MAX], spikes[ENT_MAX]; static int springCount, spikeCount;
static Prop props[ENT_MAX]; static int propCount;
static int entRegionsX = 45, entRegionsY = 6;
enum { EK_KIKI, EK_BUZZER, EK_GAMIGAMI, EK_RHINOTANK, EK_KEROKERO };
#define ENEMY_MAX 32
#define SHOT_MAX 32
typedef struct {
  int kind, x, y, rx, ry, seq, d[4], active, spawned, gone;
  int state, off, yoff, vx, vy, t, n, cd, tops, throwing, shot, tackle, right;
  Sprite s;
} Enemy;
typedef struct { int kind, x, y, x0, y0, vx, vy, acc, qx, qy, x4, dx, resting, rest, bounces, done; Sprite s; } Shot;
static Enemy enemies[ENEMY_MAX]; static int enemyCount;
static Shot shots[SHOT_MAX]; static int shotCount;
enum { SHOT_COCONUT, SHOT_PIECE, SHOT_BUZZER, SHOT_GAMI };

static void enemy_spawn(Enemy *e);


static int read_grid(uint32_t table, int level, uint8_t *out, int cap) {
  uint32_t raw = rom_u32(table + level * 4);
  if (raw < ROM_BASE || raw >= ROM_BASE + gba_rom_size) return 0;
  return rl_decompress(raw - ROM_BASE, out, cap);
}
static void load_entities(int level) {
  static uint8_t data[32768];
  boxCount = springCount = spikeCount = toggleCount = 0;
  int n = read_grid(OFFSET_ITEMBOXES, level, data, sizeof data);
  if (n >= 12) {
    uint32_t rx = data32(data, 4), ry = data32(data, 8);
    entRegionsX = (int)rx; entRegionsY = (int)ry;
    for (uint32_t r = 0; r < rx * ry && r < 4096; r++) {
      uint32_t off = data32(data, 12 + r * 4); if (!off) continue;
      int seq = 0;
      for (int at = 4 + (int)off; at + 2 < n && data[at] != 0xFF && boxCount < ENT_MAX; at += 3) {
        Box *b = &boxes[boxCount++];
        b->kind = data[at + 2]; b->x = data[at] * 8 + (int)(r % rx) * 256; b->y = data[at + 1] * 8 + (int)(r / rx) * 256;
        b->rx = (int)(r % rx); b->ry = (int)(r / rx); b->seq = seq++;
        b->active = b->spawned = b->gone = 0; b->live = 1; b->dy = b->vy = b->hopping = b->phase = b->n = 0;
      }
    }
  }
  n = read_grid(OFFSET_INTERACTABLES, level, data, sizeof data);
  if (n >= 12) {
    uint32_t rx = data32(data, 4), ry = data32(data, 8);
    entRegionsX = (int)rx; entRegionsY = (int)ry;
    int seq = 0;
    for (uint32_t r = 0; r < rx * ry && r < 4096; r++) {
      uint32_t off = data32(data, 12 + r * 4);
      if (!off) continue;
      for (int at = 4 + (int)off; at + 6 < n && data[at] != 0xFF; at += 7) {
        int kind = data[at + 2], x = data[at] * 8 + (int)(r % rx) * 256, y = data[at + 1] * 8 + (int)(r / rx) * 256;
        Obj *o = NULL;
        if (kind >= 1 && kind <= 6 && spikeCount < ENT_MAX) o = &spikes[spikeCount++];
        else if ((kind >= 8 && kind <= 15) || kind == 108) { if (springCount < ENT_MAX) o = &springs[springCount++]; }
        else if ((kind == 17 || kind == 18) && toggleCount < ENT_MAX) {
          Toggle *t = &toggles[toggleCount++];
          t->layer = kind == 17 ? 0 : 1;
          t->x = x; t->y = y; t->w = (int8_t)data[at + 5] * 8; t->h = (int8_t)data[at + 6] * 8;
        }
        if (o) {
          o->kind = kind; o->x = x; o->y = y; o->rx = (int)(r % rx); o->ry = (int)(r / rx); o->seq = seq;
          o->active = o->spawned = o->launching = 0; o->animState = -1; o->visible = 1;
          for (int i = 0; i < 4; i++) o->d[i] = (int8_t)data[at + 3 + i];
        }
        seq++;
      }
    }
  }
}
static int prop_look(int kind, int d0, int *variant) {
  *variant = 0;
  switch (kind) {
    case 0: return 453; case 7: return 452;
    case 21: case 22: case 55: return 463; case 23: return 461; case 24: return 904; case 25: return 462;
    case 30: return 467;
    case 31: return 471; case 32: *variant = 2; return 471; case 33: *variant = 1; return 471;
    case 44: case 45: return 452;
    case 47: return 472;
    case 100: return 571; case 101: return 570;
    default: return -1;
  }
}
static void load_props(int level) {
  static uint8_t data[32768];
  propCount = 0;
  int n = read_grid(OFFSET_INTERACTABLES, level, data, sizeof data);
  if (n < 12) return;
  uint32_t rx = data32(data, 4), ry = data32(data, 8);
  int seq = 0;
  for (uint32_t r = 0; r < rx * ry && r < 4096; r++) {
    uint32_t off = data32(data, 12 + r * 4);
    if (!off) continue;
    for (int at = 4 + (int)off; at + 6 < n && data[at] != 0xFF; at += 7) {
      int kind = data[at + 2], v;
      int anim = prop_look(kind, data[at + 3], &v);
      if (anim >= 0 && propCount < ENT_MAX) {
        Prop *o = &props[propCount++];
        o->kind = kind; o->x = data[at] * 8 + (int)(r % rx) * 256; o->y = data[at + 1] * 8 + (int)(r / rx) * 256;
        o->rx = (int)(r % rx); o->ry = (int)(r / rx); o->seq = seq;
        o->active = o->spawned = 0; o->anim = anim; o->variant = v;
        for (int i = 0; i < 4; i++) o->d[i] = (int8_t)data[at + 3 + i];
      }
      seq++;
    }
  }
}
static int prop_tiles(int anim, int variant) {
  switch (anim) {
    case 453: return 36; case 452: return 18;
    case 463: return 18; case 461: return 24; case 462: return 12; case 904: return 18; case 467: return 16;
    case 468: return 12;
    case 471: return variant ? 12 : 8;
    case 472: return 8;
    default: return 16;
  }
}
static void entity_sprite(Sprite *sp, int anim, int variant, uint32_t tiles, int order) {
  sprite_init(sp);
  uint32_t dest = vram_malloc(tiles);
  sp->graphics.dest = dest == HEAP_END ? OBJ_VRAM + 0x2000 : dest;
  sp->graphics.anim = (uint16_t)anim; sp->variant = (uint8_t)variant; sp->animSpeed = ANIM_NORMAL;
  sp->palId = 0; sp->oamFlags = (uint16_t)(order << 6); sp->frameFlags = 2 << 12;
}
static void sprite_free(Sprite *sp) { if (sp->graphics.dest >= OBJ_VRAM + 0x13200) vram_free(sp->graphics.dest); }
// a dust cloud (engine/defeat.js dustCloud): animation 407, OAM order 15, which ends after its four frames
static void dust_make(int x, int y) {
  if (dustCount >= 8) return;
  Dust *d = &dusts[dustCount++];
  d->x = x; d->y = y; d->dead = 0;
  entity_sprite(&d->s, 407, 0, 64, 15);
  d->s.graphics.dest = OBJ_VRAM + 0x1000;   // DUST_CLOUD_VRAM_ADDRESS, a fixed place (dust_cloud.c)
  update_sprite(&d->s, 0);
}
static void dusts_update(void) {
  for (int i = 0; i < dustCount; i++) if (!dusts[i].dead && update_sprite(&dusts[i].s, 0) == 0) dusts[i].dead = 1;
}
static void dusts_draw(int camX, int camY) {
  for (int i = 0; i < dustCount; i++) {
    Dust *d = &dusts[i];
    d->s.x = (int16_t)(d->x - camX); d->s.y = (int16_t)(d->y - camY);
    display_sprite(&d->s);
  }
  int kept = 0;
  for (int i = 0; i < dustCount; i++) if (!dusts[i].dead) dusts[kept++] = dusts[i];
  dustCount = kept;
}
static const int SPRING_ANIM[16] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 4, 4, 6, 6 };
static int ent_active(int x, int y) {
  return x >= act.cam.x - 128 && x <= act.cam.x + 368 && y >= act.cam.y - 128 && y <= act.cam.y + 288;
}
static int hits(int x0, int y0, const Hitbox *b, int px, int py, const int *r) {
  if (!b || b->index < 0) return 0;
  int l0 = x0 + b->left, r0 = x0 + b->right, t0 = y0 + b->top, b0 = y0 + b->bottom;
  int l1 = px + r[0], r1 = px + r[2], t1 = py + r[1], b1 = py + r[3];
  return ((l0 <= l1 && r0 >= l1) || (l0 >= l1 && r1 >= l0)) && ((t0 <= t1 && b0 >= t1) || (t0 >= t1 && b1 >= t0));
}
static void body_rect(const Player *p, int *r) { r[0] = -6; r[1] = -p->offsetY; r[2] = 6; r[3] = p->offsetY; }
static void attack_rect(const Player *p, int *r) { r[0] = sonic.hitboxes[1].left; r[1] = sonic.hitboxes[1].top; r[2] = sonic.hitboxes[1].right; r[3] = sonic.hitboxes[1].bottom; }
// sub_801F100's one-tile floor probe (engine/terrain.js tileFloor)
static int tile_floor(int x, int y, int layer) {
  int v = column_height(x, y, layer), r = y & 7;
  if (v == 0) return 8 - r;
  if (v == 8) return -1 - r;
  return v > 0 ? v - 1 - r : v + r;
}

// --- item boxes, springs and spikes -----------------------------------------------------------------------------
static void box_spawn(Box *b) {
  b->spawned = 1;
  entity_sprite(&b->box, 705, 0, 16, 18);
  entity_sprite(&b->icon, 706, b->kind == 0 ? 0 : b->kind == 5 ? 8 : b->kind + 4, 4, 19);
  update_sprite(&b->box, 0); update_sprite(&b->icon, 0);
}
static void box_prize(Box *b) {
  switch (b->kind) {
    case 0: if (act.lives < 9) act.lives++; break;                 // 1-up
    case 5: act.ringCount += 5; play_song(SONG_RING); break;      // rings 5
    case 6: act.ringCount += 10; play_song(SONG_RING); break;     // rings 10
    case 7: act.ringCount += 10; play_song(SONG_RING); break;     // random rings, 10 for now
  }
}
static void break_box(Box *b) {
  b->phase = 1; b->dy = 0; b->n = 0; b->live = 0; play_song(167);
  dust_make(b->x, b->y + b->dy);
}
// Coll_Player_Platform's vertical test (collide.js vertical): onto the top or out below, keeping the subpixel
static int box_vertical(Box *b, Player *p, const int *rect, int stoodHere, int *flags) {
  const Hitbox *hb = &b->box.hitboxes[0];
  int bx = b->x, by = b->y + b->dy, px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!hits(bx, by, hb, px, py, rect)) return 0;
  double frac = p->y - py;
  int steep = !p->air && ((p->rotation + 0x20) & 0x40), mid = by + ((hb->top + hb->bottom) >> 1);
  if (p->inverted ? py < mid : py > mid) {
    p->y = (p->inverted ? by + hb->top + rect[1] : by + hb->bottom - rect[1]) + frac;
    *flags |= 0x10000;
    if (p->ysp > 0) return 0;
    p->ysp = 0; if (steep) p->gsp = 0;
    return 1;
  }
  p->y = (p->inverted ? by + hb->bottom + rect[3] : by + hb->top - rect[3]) + frac;
  if (p->ysp < 0) return 0;
  p->ysp = 0; if (steep) p->gsp = 0;
  p->onObject = b; p->air = 0;
  *flags |= 0x8;
  if (!stoodHere) { land(p); p->gsp = p->xsp; p->rotation = 0; }
  return 1;
}
// Coll_Player_Platform's side test (collide.js sideways): the wider, shorter flank finds the box, and walking
// into it on the ground stops him and stands him up
static int box_sideways(Box *b, Player *p, int *flags) {
  if (((p->rotation + 0x20) >> 6) & 1) return 0;   // not while on a wall
  int rect[4] = { -11, 1 - p->offsetY, 11, p->offsetY - 1 };
  const Hitbox *hb = &b->box.hitboxes[0];
  int bx = b->x, by = b->y + b->dy, px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!hits(bx, by, hb, px, py, rect)) return 0;
  int leftX = bx + hb->left - rect[2], rightX = bx + hb->right - rect[0] + 1;
  int fromLeft = px <= bx + ((hb->left + hb->right) >> 1);
  if (fromLeft) {
    p->x = scan(0, leftX, py, p->layer, -8).d >= 0 ? leftX : rightX;
    if (p->xsp < 0) return 0;
    *flags |= 0x20000;
  } else {
    p->x = scan(0, rightX, py, p->layer, 8).d >= 0 ? rightX : leftX;
    if (p->xsp > 0) return 0;
    *flags |= 0x40000;
  }
  if (p->air || p->attack != 0) { p->xsp = 0; return 1; }
  if (p->xsp == 0) return 1;
  *flags |= 0x20;
  p->pushing = 1; p->facing = fromLeft ? 1 : -1; uncurl(p); p->gsp = 0; p->xsp = 0;
  return 1;
}
static void boxes_step(Player *p) {
  int body[4], attack[4]; body_rect(p, body);
  int hasAttack = sonic.hitboxes[1].index >= 0; if (hasAttack) attack_rect(p, attack);
  for (int i = 0; i < boxCount; i++) {
    Box *b = &boxes[i];
    if (!b->active || !b->spawned) continue;
    if (b->phase == 1) {
      b->dy--;
      if (++b->n >= 60) { box_prize(b); b->phase = 2; b->n = 0; }
      continue;
    } else if (b->phase == 2) {
      if (++b->n > 30) {
        sprite_free(&b->box); sprite_free(&b->icon);
        b->spawned = 0; b->gone = 1; b->active = 0;
      }
      continue;
    }
    // hit from below, it hops up a pixel a frame, slowing down, until it lands again (HOP_SPEED, HOP_GRAVITY)
    if (b->hopping) {
      b->dy += b->vy >> 8; b->vy += 40;
      int d = tile_floor(b->x, b->y + b->dy, 1);
      if (d < 0) { b->dy += d; b->hopping = 0; }
    }
    const Hitbox *hb = &b->box.hitboxes[0];
    if (hb->index < 0) continue;
    int stoodHere = p->onObject == b;
    if (stoodHere) p->onObject = NULL;
    int flags = 0;
    // with an attack box the box is breakable (Coll_Player_Itembox), without one it is solid (Coll_Player_Platform)
    if (stoodHere || !hasAttack) {
      int done = ((p->air || stoodHere) && box_vertical(b, p, body, stoodHere, &flags))
        || box_sideways(b, p, &flags) || box_vertical(b, p, body, stoodHere, &flags);
      if (!done && stoodHere && !p->onObject) { p->air = 1; p->pushing = 0; }
    } else {
      int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
      int flank[4] = { -11, 1 - p->offsetY, 11, p->offsetY - 1 };
      if (hits(b->x, b->y + b->dy, hb, px, py, attack)) {
        flags |= 0x20;
        if (p->air && p->ysp > 0) p->ysp = -p->ysp;
      }
      if (p->air) {
        if (hits(b->x, b->y + b->dy, hb, px, py, body)) {
          int mid = b->y + b->dy + ((hb->top + hb->bottom) >> 1);
          if (p->inverted ? py >= mid : py <= mid) {
            if (p->ysp >= 0) { flags |= 0x8; if (p->ysp > 0) p->ysp = -p->ysp; }
          } else if (p->ysp < 0) {
            p->ysp = 0;
            int under = b->y + b->dy + hb->bottom - body[1];
            p->y = p->inverted ? p->y + py - under : under + (p->y - py);
            flags |= 0x10000;
          }
        } else if (hits(b->x, b->y + b->dy, hb, px, py, flank)) {
          if (px <= b->x + ((hb->left + hb->right) >> 1)) {
            if (p->xsp > 0) { p->xsp = 0; p->x = b->x + hb->left - flank[2]; }
          } else if (p->xsp < 0) { p->xsp = 0; p->x = b->x + hb->right - flank[0] + 1; }
        }
      }
      if (flags & 0x28) { break_box(b); continue; }
    }
    if (flags & 0x10000) { b->vy = -256; b->hopping = 1; }
  }
}
static void spring_spawn(Obj *o) {
  o->spawned = 1;
  int v = o->kind >= 8 && o->kind <= 15 ? SPRING_ANIM[o->kind] : 0;
  entity_sprite(&o->s, 455, v, 16, 18);
  update_sprite(&o->s, 0);
}
static void springs_step(Player *p) {
  int body[4]; body_rect(p, body);
  for (int i = 0; i < springCount; i++) {
    Obj *o = &springs[i];
    if (!o->active || !o->spawned) continue;
    const Hitbox *hb = &o->s.hitboxes[0];
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (!hits(o->x, o->y, hb, px, py, body)) continue;
    int speed = o->d[0] >= 0 && o->d[0] <= 3 ? (int)((double[]){7.5, 9, 10.5, 12}[o->d[0]]) : (o->d[1] << 4) / 256;
    if (o->kind == 8 || o->kind == 12 || o->kind == 13 || o->kind == 14 || o->kind == 15) {
      if (o->kind == 12 || o->kind == 13 || o->kind == 14 || o->kind == 15) {
        int dir = (o->kind == 12 || o->kind == 14) ? -1 : 1;
        p->xsp = speed * dir; p->ysp = -speed; p->air = 1; p->state = PS_SPRING;
      } else { p->ysp = -speed; p->air = 1; p->state = PS_SPRING; }
      play_song(170);
    } else if (o->kind == 10 || o->kind == 11) {
      int dir = o->kind == 10 ? -1 : 1;
      p->xsp = p->gsp = speed * dir; p->facing = dir; p->air = 0; p->state = PS_WALK; play_song(170);
    }
  }
}
static void spike_spawn(Obj *o) {
  o->spawned = 1;
  int v = o->kind == 1 || o->kind == 2 ? 2 : 3;
  if (o->kind == 5 || o->kind == 6) v = 2;
  entity_sprite(&o->s, 454, v, 16, 17);
  if (o->kind == 6) o->s.frameFlags |= SPRITE_Y_FLIP;
  o->animState = v;
  update_sprite(&o->s, 0);
}
static void hiding_spike_step(Obj *o) {
  int t = act.tick & 127, v = -1;
  if (t >= 60 && t < 62) v = 0;
  else if (t >= 62 && t < 64) v = 1;
  else if (t >= 64 && t < 124) v = 2;
  else if (t >= 124 && t < 126) v = 1;
  else if (t >= 126) v = 0;
  o->visible = v >= 0;
  if (v >= 0) {
    if (v != o->animState) { o->s.graphics.anim = 454; o->s.variant = (uint8_t)v; o->s.prevAnim = 0xFFFF; o->animState = v; }
    update_sprite(&o->s, 0);
  }
  if (v != 2) return;
  int body[4]; body_rect(&act.player, body);
  if (!act.player.invulnerable && !act.player.dead
    && hits(o->x, o->y, &o->s.hitboxes[0], (int)__builtin_floor(act.player.x), (int)__builtin_floor(act.player.y), body)) {
    hurt(&act.player); play_song(171);
  }
}
static void spikes_step(Player *p) {
  int body[4]; body_rect(p, body);
  for (int i = 0; i < spikeCount; i++) {
    Obj *o = &spikes[i];
    if (!o->active || !o->spawned || o->kind == 5 || o->kind == 6) continue;
    if (p->invulnerable || p->dead) continue;
    if (hits(o->x, o->y, &o->s.hitboxes[0], (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), body)) {
      hurt(p); play_song(171);
    }
  }
}
static void box_retire(Box *b) {
  if (!b->spawned) return;
  if (!b->live) b->gone = 1;
  sprite_free(&b->box); sprite_free(&b->icon);
  b->spawned = 0; b->phase = 0; b->dy = b->vy = b->hopping = b->n = 0;
}
static void obj_retire(Obj *o) { if (!o->spawned) return; sprite_free(&o->s); o->spawned = 0; o->launching = 0; }
static void entity_spawn_all(int x0, int x1, int y0, int y1) {
  for (int ry = y0 >> 8; ry * 256 < y1 && ry < entRegionsY; ry++) {
    for (int rx = x0 >> 8; rx * 256 < x1 && rx < entRegionsX; rx++) {
      // the region's interactables in the table's order, then its item boxes, then its enemies
      for (;;) {
        int best = -1, bestSeq = 1 << 30, bestType = 0;
        for (int i = 0; i < springCount; i++) if (springs[i].rx == rx && springs[i].ry == ry && !springs[i].spawned && springs[i].seq < bestSeq
          && springs[i].x >= x0 && springs[i].x <= x1 && springs[i].y >= y0 && springs[i].y <= y1) { best = i; bestSeq = springs[i].seq; bestType = 0; }
        for (int i = 0; i < spikeCount; i++) if (spikes[i].rx == rx && spikes[i].ry == ry && !spikes[i].spawned && spikes[i].seq < bestSeq
          && spikes[i].x >= x0 && spikes[i].x <= x1 && spikes[i].y >= y0 && spikes[i].y <= y1) { best = i; bestSeq = spikes[i].seq; bestType = 1; }
        for (int i = 0; i < propCount; i++) if (props[i].rx == rx && props[i].ry == ry && !props[i].spawned && props[i].seq < bestSeq
          && props[i].x >= x0 && props[i].x <= x1 && props[i].y >= y0 && props[i].y <= y1) { best = i; bestSeq = props[i].seq; bestType = 2; }
        if (best < 0) break;
        if (bestType == 0) { springs[best].active = 1; spring_spawn(&springs[best]); }
        else if (bestType == 1) { spikes[best].active = 1; spike_spawn(&spikes[best]); }
        else { Prop *o = &props[best]; o->active = 1; entity_sprite(&o->s, o->anim, o->variant, prop_tiles(o->anim, o->variant), 18); update_sprite(&o->s, 0); o->spawned = 1; }
      }
      for (;;) {
        int best = -1, bestSeq = 1 << 30;
        for (int i = 0; i < boxCount; i++) if (boxes[i].rx == rx && boxes[i].ry == ry && !boxes[i].spawned && !boxes[i].gone && boxes[i].seq < bestSeq
          && boxes[i].x >= x0 && boxes[i].x <= x1 && boxes[i].y >= y0 && boxes[i].y <= y1) { best = i; bestSeq = boxes[i].seq; }
        if (best < 0) break;
        boxes[best].active = 1; box_spawn(&boxes[best]);
      }
      for (;;) {
        int best = -1, bestSeq = 1 << 30;
        for (int i = 0; i < enemyCount; i++) if (enemies[i].rx == rx && enemies[i].ry == ry && !enemies[i].spawned && !enemies[i].gone && enemies[i].seq < bestSeq
          && enemies[i].x >= x0 && enemies[i].x <= x1 && enemies[i].y >= y0 && enemies[i].y <= y1) { best = i; bestSeq = enemies[i].seq; }
        if (best < 0) break;
        enemies[best].active = 1; enemy_spawn(&enemies[best]);
      }
    }
  }
}
static void entity_scan(void) {
  int x0 = (int)act.cam.x - 128, x1 = (int)act.cam.x + 368, y0 = (int)act.cam.y - 128, y1 = (int)act.cam.y + 288;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
  int w = entRegionsX * 256, h = entRegionsY * 256;
  if (x1 >= w) x1 = w - 1; if (y1 >= h) y1 = h - 1;
  entity_spawn_all(x0, x1, y0, y1);
}
static void entities_update(void) {
  entity_scan();
  for (int i = 0; i < springCount; i++) { Obj *o = &springs[i]; o->active = ent_active(o->x, o->y); }
  for (int i = 0; i < spikeCount; i++) { Obj *o = &spikes[i]; o->active = ent_active(o->x, o->y); }
  for (int i = 0; i < propCount; i++) { Prop *o = &props[i]; o->active = ent_active(o->x, o->y); }
  for (int i = 0; i < boxCount; i++) { Box *b = &boxes[i]; b->active = ent_active(b->x, b->y); }
  for (int i = 0; i < springCount; i++) { Obj *o = &springs[i]; if (o->active) { if (o->spawned) update_sprite(&o->s, 0); } else obj_retire(o); }
  for (int i = 0; i < spikeCount; i++) { Obj *o = &spikes[i]; if (o->active) { if (!o->spawned) continue; if (o->kind == 5 || o->kind == 6) hiding_spike_step(o); else update_sprite(&o->s, 0); } else obj_retire(o); }
  for (int i = 0; i < propCount; i++) { Prop *o = &props[i]; if (o->active) { if (o->spawned) update_sprite(&o->s, 0); } else if (o->spawned) { sprite_free(&o->s); o->spawned = 0; } }
  for (int i = 0; i < boxCount; i++) { Box *b = &boxes[i]; if (b->active) { if (b->spawned) { update_sprite(&b->box, 0); update_sprite(&b->icon, 0); } } else box_retire(b); }
}
static void layer_toggles(Player *p) {
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  for (int i = 0; i < toggleCount; i++) {
    Toggle *t = &toggles[i];
    if (px >= t->x && px <= t->x + t->w && py >= t->y && py <= t->y + t->h) p->layer = t->layer;
  }
}
static void entities_step(Player *p) { boxes_step(p); springs_step(p); spikes_step(p); }
static void boxes_draw(int camX, int camY) {
  for (int i = 0; i < boxCount; i++) {
    Box *b = &boxes[i]; if (!b->active || !b->spawned) continue;
    if (b->phase == 0) { b->box.x = (int16_t)(b->x - camX); b->box.y = (int16_t)(b->y + b->dy - camY); display_sprite(&b->box); }
    // the break frame shows the dust only; the icon rises from the next one (engine/itembox.js)
    if (!(b->phase == 1 && b->n == 0)) { b->icon.x = (int16_t)(b->x - camX); b->icon.y = (int16_t)(b->y + b->dy - camY); display_sprite(&b->icon); }
  }
}
static void springs_spikes_draw(int camX, int camY) {
  for (int i = 0; i < springCount; i++) { Obj *o = &springs[i]; if (!o->active || !o->spawned) continue; o->s.x = (int16_t)(o->x - camX); o->s.y = (int16_t)(o->y - camY); display_sprite(&o->s); }
  for (int i = 0; i < spikeCount; i++) { Obj *o = &spikes[i]; if (!o->active || !o->spawned || !o->visible) continue; o->s.x = (int16_t)(o->x - camX); o->s.y = (int16_t)(o->y - camY); display_sprite(&o->s); }
}
static void props_step(Player *p) {
  for (int i = 0; i < propCount; i++) {
    Prop *o = &props[i];
    if (!o->active || !o->spawned) continue;
    const Hitbox *hb = &o->s.hitboxes[0];
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y), body[4]; body_rect(p, body);
    if (hb->index >= 0 && hits(o->x, o->y, hb, px, py, body)) {
      if (o->kind == 21 || o->kind == 22 || o->kind == 24 || o->kind == 25) {
        int top = o->y + hb->top;
        if (p->ysp >= 0 && py <= top + 8) { p->y = top - p->offsetY + (p->y - py); p->ysp = 0; p->gsp = p->xsp; p->air = 0; p->state = PS_WALK; }
      } else if (o->kind == 23) {
        p->ysp = -9; p->air = 1; p->state = PS_SPRING; play_song(170);
      } else if (o->kind >= 31 && o->kind <= 33) {
        p->xsp = p->gsp = 6.0 * (p->facing >= 0 ? 1 : -1); p->state = PS_WALK;
      } else if (o->kind == 0 && o->d[1] && p->x > o->x) {
        act.goalReached = 1; act.clockStopped = 1; act.ringsStopped = 1;
        p->ignoreInput = 1; p->xsp = p->gsp = 4.5; if (act.cam.shiftY > -56) act.cam.shiftY--;
        play_song(135);
      }
    }
    if (o->kind == 7 && !act.goalReached && p->x > o->x) { o->variant = 2; play_song(169); }
  }
}
static void props_draw(int camX, int camY) {
  for (int i = 0; i < propCount; i++) {
    Prop *o = &props[i]; if (!o->active || !o->spawned) continue;
    o->s.x = (int16_t)(o->x - camX); o->s.y = (int16_t)(o->y - camY); display_sprite(&o->s);
  }
}

// --- the act's enemies (engine/enemies.js; kiki.c, buzzer.c, gamigami.c, rhinotank.c, kerokero.c) -----------------
// Each is a task at the objects' priority, made when its point comes into the range, gone when both that point and
// its own leave it; a defeated one stays gone until the act starts over. Their shots are tasks made by them.
static int off_cam(int sx, int sy) { return (((sx + 128) & 0xFFFF) > 496) || sy + 128 < 0 || sy > 288; }
static int off_display(int wx, int wy) { return wx > act.cam.x + 368 || wx < act.cam.x - 128 || wy > act.cam.y + 288 || wy < act.cam.y - 128; }
static int enemy_gone(int spawnX, int spawnY, int x, int y) { return off_display(spawnX, spawnY) && off_cam(x - (int)act.cam.x, y - (int)act.cam.y); }
static int sonic_x(void) { return (int)__builtin_floor(act.player.x); }
static int sonic_y(void) { return (int)__builtin_floor(act.player.y); }
static int q16s(int v) { return (int16_t)v; }
static int I(int v) { return v >> 8; }
static int Div(int a, int b) { return a / b; }
static int COS10(int a) { return SINE[(a + 256) & 1023]; }
static int SIN10(int a) { return SINE[a & 1023]; }
static int octant_angle(int a, int b) {
  int index = 0;
  if (a <= 0) { a = -a; index = 4; }
  if (b <= 0) { b = -b; index += 2; }
  int frac;
  if (a >= b) frac = Div(b * 128, a);
  else { index++; frac = Div(a * 128, b); }
  static const int arr[8] = { 1, 0, 2, 3, 6, 7, 5, 4 };
  if (arr[index] & 1) frac = 128 - frac;
  return (frac + arr[index] * 128) & 1023;
}
static void enemy_flip(Enemy *e, int flip) { e->s.frameFlags = (uint16_t)((e->s.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (flip ? SPRITE_X_FLIP : 0)); }
static void enemy_sprite_init(Enemy *e, int anim, int variant, int order, uint32_t tiles) { entity_sprite(&e->s, anim, variant, tiles, order); }
static void enemy_anim(Enemy *e, int anim, int variant) { e->s.graphics.anim = (uint16_t)anim; e->s.variant = (uint8_t)variant; e->s.prevAnim = 0xFFFF; }
static void enemy_defeat(Enemy *e) { e->gone = 1; e->active = 0; if (e->spawned) sprite_free(&e->s); e->spawned = 0; play_song(138); }
static int enemy_attack(Enemy *e, int x, int y) {
  if (e->s.hitboxes[0].index < 0) return 0;
  int px = sonic_x(), py = sonic_y(), body[4], attack[4]; body_rect(&act.player, body);
  int hb = hits(x, y, &e->s.hitboxes[0], px, py, body);
  if (sonic.hitboxes[1].index >= 0) {
    attack_rect(&act.player, attack);
    if (hits(x, y, &e->s.hitboxes[0], px, py, attack)) {
      if (act.player.ysp > 0) act.player.ysp = -act.player.ysp;
      enemy_defeat(e);
      return 1;
    }
  }
  if (hb) {
    if (act.player.invulnerable > 0) { enemy_defeat(e); return 1; }
    hurt(&act.player);
  }
  return 0;
}
static void shot_make_anim(Shot *sh, int kind, int anim, int order, uint32_t tiles) {
  sh->kind = kind;
  entity_sprite(&sh->s, anim, 0, tiles, order);
}
static int shot_attack(Shot *sh, int x, int y) {
  if (sh->s.hitboxes[0].index < 0 || act.player.dead) return 0;
  int body[4]; body_rect(&act.player, body);
  if (!hits(x, y, &sh->s.hitboxes[0], sonic_x(), sonic_y(), body)) return 0;
  hurt(&act.player);
  return 1;
}
static void shot_coconut(int x0, int y0) {
  if (shotCount >= SHOT_MAX) return;
  Shot *sh = &shots[shotCount++];
  shot_make_anim(sh, SHOT_COCONUT, 408, 18, 16);
  int px = sonic_x();
  sh->x0 = x0; sh->y0 = y0; sh->x = x0; sh->y = y0;
  sh->vx = px < x0 ? -Div((x0 - px) * 400, 800) : Div((px - x0) * 400, 800);
  if (sh->vx < -60) sh->vx = -60; if (sh->vx > 60) sh->vx = 60;
  sh->vy = -512; sh->acc = 0; sh->bounces = 0; sh->resting = 0; sh->rest = 0;
}
static void shot_piece(int x, int y) {
  if (shotCount >= SHOT_MAX) return;
  Shot *sh = &shots[shotCount++];
  shot_make_anim(sh, SHOT_PIECE, 402, 18, 16);
  sh->x = x; sh->y = y;
}
static void shot_buzzer(int x0, int y0) {
  if (shotCount >= SHOT_MAX) return;
  Shot *sh = &shots[shotCount++];
  shot_make_anim(sh, SHOT_BUZZER, 409, 18, 1);
  int a = octant_angle(sonic_y() - y0, sonic_x() - x0);
  sh->vx = Div(COS10(a), 38); sh->vy = Div(SIN10(a), 38);
  sh->qx = x0 * 256; sh->qy = y0 * 256;
}
static void shot_gami(int x4, int dx, int y0) {
  if (shotCount >= SHOT_MAX) return;
  Shot *sh = &shots[shotCount++];
  shot_make_anim(sh, SHOT_GAMI, 410, 9, 4);
  sh->x4 = x4; sh->dx = dx; sh->y = y0; sh->vy = -512;
}
static void shots_update(void) {
  for (int i = 0; i < shotCount; i++) {
    Shot *sh = &shots[i];
    if (sh->done) continue;
    if (sh->kind == SHOT_COCONUT) {
      if (!sh->resting) {
        sh->vy = q16s(sh->vy + 40); sh->acc = q16s(sh->acc + sh->vx);
        sh->x = sh->x0 + Div(sh->acc, 40); sh->y = q16s(sh->y + I(sh->vy));
        if (sh->vy > 0) {
          int d = tile_floor(sh->x, sh->y, 1);
          if (d < 0) {
            sh->y += d;
            if (!sh->bounces) { sh->vy = -(sh->vy >> 2); sh->bounces++; }
            else { sh->resting = 1; sh->rest = 0; sh->vy = 0; }
          }
        }
      } else if (sh->rest++ >= 0x60) { shot_piece(sh->x, sh->y); sh->done = 1; continue; }
      if (shot_attack(sh, sh->x, sh->y)) { shot_piece(sh->x, sh->y); sh->done = 1; continue; }
      update_sprite(&sh->s, 0);
    } else if (sh->kind == SHOT_PIECE) {
      shot_attack(sh, sh->x, sh->y);
      if (update_sprite(&sh->s, 0) == 0) sh->done = 1;
    } else if (sh->kind == SHOT_BUZZER) {
      sh->qx += sh->vx; sh->qy += sh->vy;
      int x = I(sh->qx), y = I(sh->qy);
      shot_attack(sh, x, y);
      int sx = x - (int)act.cam.x, sy = y - (int)act.cam.y;
      if ((((sx + 40) & 0xFFFF) > 320) || sy + 40 < 0 || sy > 200) { sh->done = 1; continue; }
      update_sprite(&sh->s, 0);
    } else {
      sh->x4 += sh->dx;
      int x = sh->x4 >> 2;
      sh->vy += 40; sh->y += I(sh->vy);
      shot_attack(sh, x, sh->y);
      int sx = x - (int)act.cam.x, sy = sh->y - (int)act.cam.y;
      if ((((sx + 20) & 0xFFFF) > 276) || sy + 20 < 0 || sy > 240) { sh->done = 1; continue; }
      update_sprite(&sh->s, 0);
    }
  }
  int kept = 0;
  for (int i = 0; i < shotCount; i++) if (!shots[i].done) shots[kept++] = shots[i];
  shotCount = kept;
}
static void shots_draw(int camX, int camY) {
  for (int i = 0; i < shotCount; i++) {
    Shot *sh = &shots[i];
    int x = sh->kind == SHOT_BUZZER ? I(sh->qx) : sh->kind == SHOT_GAMI ? (sh->x4 >> 2) : sh->x;
    int y = sh->kind == SHOT_BUZZER ? I(sh->qy) : sh->y;
    sh->s.x = (int16_t)(x - camX); sh->s.y = (int16_t)(y - camY);
    display_sprite(&sh->s);
  }
}
static void enemy_spawn(Enemy *e) {
  e->spawned = 1;
  switch (e->kind) {
    case EK_KIKI:
      enemy_sprite_init(e, 401, 1, 18, 20);
      e->throwing = 0; e->tops = 0; e->yoff = 0; e->t = 0; e->vx = 1;
      break;
    case EK_BUZZER: {
      int right = sonic_x() >= e->x;
      enemy_sprite_init(e, 403, 0, 18, 20);
      e->vx = right ? 256 : -256; e->off = 0; e->shot = 0; e->t = 0; e->state = 0; e->right = right;
      enemy_flip(e, right);
      break;
    }
    case EK_GAMIGAMI: {
      int right = sonic_x() >= e->x;
      enemy_sprite_init(e, 404, 0, 18, 30);
      e->vx = right ? 160 : -160; e->off = 0; e->yoff = 0; e->t = 0; e->right = right; e->state = 0;
      break;
    }
    case EK_RHINOTANK:
      enemy_sprite_init(e, 405, 0, 18, 20);
      e->vx = -160; e->off = 0; e->yoff = 0; e->t = 0; e->tackle = 0; e->state = 0; enemy_flip(e, 1);
      break;
    case EK_KEROKERO:
      enemy_sprite_init(e, 406, 0, 18, 20);
      e->off = 0; e->yoff = 0; e->vy = 0; e->cd = 0; e->t = 0; e->n = 0; e->state = 0;
      break;
  }
  update_sprite(&e->s, 0);
}
static void kiki_step(Enemy *e) {
  int was = e->throwing;
  if (!e->throwing) {
    e->yoff = (int8_t)(e->yoff + e->vx);
    if (e->yoff <= e->d[1] * 8) {
      e->tops = (e->tops + 1) & 0xFF; e->vx = 1;
      if (!(e->tops & 1)) { e->t = 0; enemy_anim(e, 401, 2); e->throwing = 1; }
    } else if (e->yoff >= e->d[1] * 8 + e->d[3] * 8) e->vx = -1;
  }
  int y = e->y + e->yoff;
  if (enemy_attack(e, e->x, y)) return;
  if (off_cam(e->x - (int)act.cam.x, y - (int)act.cam.y)) { e->active = 0; return; }
  enemy_flip(e, !(sonic_x() < e->x));
  if (was && ++e->t > 14) {
    e->throwing = 0; enemy_anim(e, 401, 1);
    shot_coconut(e->x + ((e->s.frameFlags & SPRITE_X_FLIP) ? -18 : 8), y - 8);
  }
  update_sprite(&e->s, 0);
  e->s.x = (int16_t)(e->x + ((e->s.frameFlags & SPRITE_X_FLIP) ? -8 : 0) - (int)act.cam.x);
  e->s.y = (int16_t)(y - (int)act.cam.y);
  display_sprite(&e->s);
}
static void buzzer_step(Enemy *e) {
  if (e->state == 0) e->off += e->vx;
  int x = e->x + I(e->off), y = e->y;
  if (e->state == 1 && ++e->t == 10) shot_buzzer(x, y + 6);
  if (enemy_gone(e->x, e->y, x, y)) { e->active = 0; return; }
  if (enemy_attack(e, x, y)) return;
  if (e->state == 0) {
    update_sprite(&e->s, 0);
    e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
    if (I(e->off) <= e->d[0] * 8) { e->vx = 256; enemy_anim(e, 403, 2); e->state = 2; enemy_flip(e, 1); }
    else if (I(e->off) >= (e->d[0] + e->d[2]) * 8) { e->vx = -256; enemy_anim(e, 403, 2); e->state = 2; enemy_flip(e, 0); }
    else if (!e->shot) {
      int py = sonic_y();
      if (y <= py && y + 96 >= py) {
        int dy = py - y, dx = x - sonic_x();
        int hi = q16s(Div(dx * 17, 10)), lo = q16s(Div(dx * 10, 17));
        e->s.frameFlags = (uint16_t)(e->s.frameFlags & ~(SPRITE_PRIORITY));   // the original's & instead of | here
        if (e->s.frameFlags & SPRITE_X_FLIP) { hi = -hi; lo = -lo; }
        if (hi >= dy && lo <= dy) { enemy_anim(e, 403, 1); e->t = 0; e->state = 1; }
      }
    }
    return;
  }
  if (e->state == 1) {
    if (e->t >= 30) { enemy_anim(e, 403, 0); e->state = 0; e->shot = 1; }
    update_sprite(&e->s, 0);
  } else {
    e->shot = 0;
    if (update_sprite(&e->s, 0) == 0) { enemy_anim(e, 403, 0); e->state = 0; }
  }
  e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
}
static void gamigami_step(Enemy *e) {
  if (e->state == 0) e->off += e->vx;
  int x = e->x + Div(e->off, 256), y = e->y - 6 + e->yoff;
  if (e->state == 1 && ++e->t == 15) {
    shot_gami((x + 14) * 4, 6, y - 20);
    shot_gami((x - 14) * 4, -6, y - 20);
  }
  if (enemy_gone(e->x, e->y, x, y)) { e->active = 0; return; }
  if (enemy_attack(e, x, y)) return;
  e->yoff += tile_floor(x, y, e->d[3] ? 1 : 0);
  if (e->state == 0) {
    if (Div(e->off, 256) <= e->d[0] * 8) {
      if (!e->right) { e->vx = 160; e->t = 0; e->right = 1; enemy_anim(e, 404, 1); e->state = 1; }
    } else if (Div(e->off, 256) >= (e->d[0] + e->d[2]) * 8) {
      if (e->right) { e->vx = -160; e->t = 0; e->right = 0; enemy_anim(e, 404, 1); e->state = 1; }
    }
  } else if (e->t > 18) { enemy_anim(e, 404, 0); e->state = 0; }
  update_sprite(&e->s, 0);
  e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
}
static void rhinotank_step(Enemy *e) {
  if (e->state == 0) e->off += e->vx;
  int x = e->x + (e->state == 0 ? Div(e->off, 256) : I(e->off)), y = e->y + e->yoff;
  if (enemy_gone(e->x, e->y, x, y)) { e->active = 0; return; }
  if (enemy_attack(e, x, y)) return;
  e->yoff += tile_floor(x, y, 1);
  int flip = (e->s.frameFlags & SPRITE_X_FLIP) != 0;
  if (e->state == 0) {
    int px = sonic_x(), py = sonic_y();
    if (I(e->off) <= (e->d[0] + 1) * 8) {
      if (!flip) {
        if (e->tackle) e->off += 768;
        e->t = 0; e->vx = 160; enemy_anim(e, 405, 2); e->state = 1;
      }
    } else if (I(e->off) >= (e->d[0] + e->d[2] - 1) * 8) {
      if (flip) {
        if (e->tackle) e->off -= 768;
        e->t = 0; e->vx = -160; enemy_anim(e, 405, 2); e->state = 1;
      }
    } else if (!e->tackle && y - 32 <= py && y + 8 >= py
      && (flip ? (x <= px && x + 80 >= px) : (x - 80 <= px && x >= px))) {
      e->tackle = 1; e->t = 0; e->vx = flip ? 768 : -768; enemy_anim(e, 405, 1); e->state = 2;
    }
  } else if (e->state == 1) {
    int k = Div(COS10(e->t * 21), e->tackle ? 32 : 64);
    e->off += flip ? k : -k;
    if (++e->t == 24) {
      enemy_anim(e, 405, 0); e->off += e->vx; e->vx = flip ? -160 : 160;
      enemy_flip(e, !flip); e->tackle = 0; e->state = 0;
    }
  } else if (++e->t == 25) { enemy_anim(e, 405, 0); e->state = 0; }
  update_sprite(&e->s, 0);
  e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
}
static const int CROAK_STEPS[8] = { 54, 43, 34, 32, 12, 100, 25, 32 };
static void kerokero_step(Enemy *e) {
  if (e->state == 1) { e->vy += 64; e->yoff += Div(e->vy, 256); e->off += (e->s.frameFlags & SPRITE_X_FLIP) ? 256 : -256; }
  int x = e->x + I(e->off), y = e->y + e->yoff;
  if (enemy_gone(e->x, e->y, x, y)) { e->active = 0; return; }
  if (e->state == 0) e->n = q16s(e->n + 1);
  if (enemy_attack(e, x, y)) return;
  int d = tile_floor(x, y, e->d[3] ? 1 : 0);
  if (e->state == 0) {
    e->yoff += d;
    enemy_flip(e, sonic_x() > e->x + I(e->off));
    int px = sonic_x();
    if (e->n > 250) { e->cd = 0; e->n -= 250; enemy_anim(e, 406, 1); e->state = 2; }
    else if (e->cd != 0) e->cd--;
    else if (((e->s.frameFlags & SPRITE_X_FLIP) && I(e->off) <= (e->d[0] + e->d[2] - 8) * 8 && x <= px && x + 80 >= px)
      || (!(e->s.frameFlags & SPRITE_X_FLIP) && I(e->off) >= (e->d[0] + 8) * 8 && x - 80 <= px && x >= px)) {
      e->vy = -1280; enemy_anim(e, 406, 0);
      e->n = q16s(e->n + CROAK_STEPS[e->t]); e->t = (e->t + 1) & 7; e->state = 1;
    }
    update_sprite(&e->s, 0);
    e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
    return;
  }
  if (e->state == 1) {
    if (d <= 0) {
      e->cd = 5; e->yoff += d; enemy_anim(e, 406, 1); update_sprite(&e->s, 0);
      enemy_anim(e, 406, 0); e->state = 0;
      enemy_flip(e, sonic_x() > e->x + I(e->off));
    }
  } else {
    e->yoff += d;
    if (++e->cd > 60) { e->cd = 0; enemy_anim(e, 406, 0); e->state = 0; }
  }
  update_sprite(&e->s, 0);
  e->s.x = (int16_t)(x - (int)act.cam.x); e->s.y = (int16_t)(y - (int)act.cam.y); display_sprite(&e->s);
}
static void load_enemies(int level) {
  static uint8_t data[32768];
  enemyCount = 0;
  int n = read_grid(OFFSET_ENEMIES, level, data, sizeof data);
  if (n < 12) return;
  uint32_t rx = data32(data, 4), ry = data32(data, 8);
  int seq = 0;
  for (uint32_t r = 0; r < rx * ry && r < 4096; r++) {
    uint32_t off = data32(data, 12 + r * 4);
    if (!off) continue;
    for (int at = 4 + (int)off; at + 6 < n && data[at] != 0xFF && enemyCount < ENEMY_MAX; at += 7) {
      int k = data[at + 2];
      if (k >= 0 && k <= 4) {   // only Neo Green Hill's own enemies here; the boss has its own task
        Enemy *e = &enemies[enemyCount++];
        e->kind = k; e->x = data[at] * 8 + (int)(r % rx) * 256; e->y = data[at + 1] * 8 + (int)(r / rx) * 256;
        e->rx = (int)(r % rx); e->ry = (int)(r / rx); e->seq = seq;
        e->active = e->spawned = e->gone = 0;
        for (int i = 0; i < 4; i++) e->d[i] = (int8_t)data[at + 3 + i];
      }
      seq++;
    }
  }
}
static void enemies_update(void) {
  for (int i = 0; i < enemyCount; i++) {
    Enemy *e = &enemies[i];
    if (e->spawned && !ent_active(e->x, e->y)) { sprite_free(&e->s); e->spawned = 0; e->active = 0; }
    e->active = e->spawned;
    if (!e->active || !e->spawned) continue;
    switch (e->kind) {
      case EK_KIKI: kiki_step(e); break;
      case EK_BUZZER: buzzer_step(e); break;
      case EK_GAMIGAMI: gamigami_step(e); break;
      case EK_RHINOTANK: rhinotank_step(e); break;
      case EK_KEROKERO: kerokero_step(e); break;
    }
    if (!e->active && e->spawned) { sprite_free(&e->s); e->spawned = 0; }
  }
  shots_update();
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
  int white = act2() ? (int)hudTile + 20 : (int)hudTile + HUD_WHITE;
  int red = act2() ? (int)hudTile + 42 : (int)hudTile + HUD_RED;
  int tile = g < HUD_GLYPHS ? white + g * 2 : red + (g - HUD_GLYPHS) * 2;
  put_oam(ORDER_DIGITS, x, y, OBJ_8x16, tile, 6, 0);
}
static void hud_update(int draw) {
  Hud *h = &act.hud;
  if (!h->active) return;
  if (draw) {
    // the icons: the ring over the ring count and the character's face by the lives, at OAM order 3
    put_oam(ORDER_ICONS, -2, -1, OBJ_32x32, act2() ? (int)hudTile + 4 : (int)hudTile + HUD_RING, 6, 0);
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, act2() ? (int)hudTile : (int)hudTile + HUD_FACE, 0, 0);
    if (act.ringCount == 0) {
      if (act2()) {
        // the ring counter's zero flashes red for sixteen frames and white for sixteen (Task_StageUIMain)
        hud_glyph(h->flash & 0x10 ? 11 : 0, 9, 5);
      } else {
        static const int FLASH[5] = { 0, 11, 11, 0, 0 };
        int f = h->flash >> 3, g = f < 5 ? FLASH[f] : -1;
        if (g >= 0) hud_glyph(g, 9, 5);
      }
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

// --- the title card's state for Neo Green Hill act 2 (engine/titlecard.js), without its pictures --------------------
static void card_update(int pressed) {
  if (act.cardDone) return;
  if (pressed && act.cardFrame > 35 && act.cardFrame < 215) act.cardFrame = 215;
  act.cardFrame++;
  if (act.cardFrame > 225) {
    act.cardDone = 1;
    act.clockStopped = 0;
    act.hud.active = 1;
    act.hud.flash = (act.stage.hudFlash + 7) & 31;
  }
}

// --- the palette animations (engine/palettes.js, CreatePaletteLoaderTask) ------------------------------------------
static void step_palettes(void) {
  for (int i = 0; i < paletteCount; i++) update_sprite(&paletteAnims[i].sprite, 1);
}

// --- the front layer's animated tiles (background.c UpdateBgAnimationTiles) --------------------------------------
// frame 0 is the tileset's own first tiles; frame k is the k-th block after its static part, at the tiles it
// copies over those first tiles. The screen shows the frame from before this one's step, as the copy lands at
// the next V-blank.
static void copy_stage_animation_frame(int frame) {
  Tilemap *t = &act.stage.front;
  if (t->animFrameCount == 0) return;
  uint32_t src = frame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(frame - 1) * t->animTileSize;
  if (src + t->animTileSize <= gba_rom_size) memcpy(gba_vram, gba_rom + src, t->animTileSize);
}
static void update_stage_animations(int queue) {
  Tilemap *t = &act.stage.front;
  if (t->animFrameCount == 0) return;
  if (!act2()) {
    if (++act.stage.animCounter < t->animDelay) return;
    act.stage.animCounter = 0;
    if (++act.stage.animFrame >= t->animFrameCount) act.stage.animFrame = 0;
    if (!queue || act.stage.animFrame == 0) return;
    uint32_t src = t->tiles + t->tilesSize + (uint32_t)(act.stage.animFrame - 1) * t->animTileSize;
    if (src + t->animTileSize <= gba_rom_size) memcpy(gba_vram, gba_rom + src, t->animTileSize);
    return;
  }
  act.stage.animShown = act.stage.animFrame;
  if (++act.stage.animCounter < t->animDelay) { if (queue) copy_stage_animation_frame(act.stage.animFrame); return; }
  act.stage.animCounter = 0;
  if (++act.stage.animFrame >= t->animFrameCount) act.stage.animFrame = 0;
  if (queue) copy_stage_animation_frame(act.stage.animFrame);
}
/** Puts the frame the screen shows now in VRAM, for a stage that ran its card without drawing. */
static void queue_stage_animation_frame(void) {
  if (act2()) { copy_stage_animation_frame(act.stage.animFrame); return; }
  Tilemap *t = &act.stage.front;
  if (t->animFrameCount == 0 || act.stage.animFrame == 0) return;
  uint32_t src = t->tiles + t->tilesSize + (uint32_t)(act.stage.animFrame - 1) * t->animTileSize;
  if (src + t->animTileSize <= gba_rom_size) memcpy(gba_vram, gba_rom + src, t->animTileSize);
}

// Neo Green Hill's background (renderer.js's backgroundOffset and STILL): three cloud bands drift with the stage's
// clock, the big clouds and islands stay still, and the sea scrolls faster toward the bottom of the screen. Each
// line's scroll goes in through the H-blank, as the original's StageBgUpdate_Zone1Acts12 does.
static void draw_neo_background(int camX, int camY) {
  (void)camY;
  int bgHeight = act.stage.background.yTiles * 8;
  // gStageTime counts the frames drawn before this one, as the camera's task reads it
  int time = act2() ? (act.tick > 16 ? act.tick - 16 : 0) : (act.tick ? act.tick - 1 : 0);
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
  for (int y = 0; y < SCREEN_H_; y++) {
    int line = y < bgHeight ? y : bgHeight - 1;
    int off;
    if (line < 8) off = (time >> 4) & 0xFF;
    else if (line < 24) off = (time >> 5) & 0xFF;
    else if (line < 40) off = (time >> 6) & 0xFF;
    else if (line < 88) off = 0;
    else off = ((line - 86) * camX) >> 8;
    put16(e.primary + (uint32_t)y * 4, (uint32_t)(off & 0x1FF));
    put16(e.primary + (uint32_t)y * 4 + 2, 0);
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
  // RenderMetatileLayers: BG1 and BG2 scroll by the camera's sub-tile part, their maps filled from the metatiles
  e.bgScroll[2] = (uint16_t)(camX & 7); e.bgScroll[3] = (uint16_t)(camY & 7);
  e.bgScroll[4] = (uint16_t)(camX & 7); e.bgScroll[5] = (uint16_t)(camY & 7);
  fill_layer(0xF000, LAYER_FRONT, camX, camY);
  fill_layer(0xF800, LAYER_BACK, camX, camY);
  if (act.stage.zone == 0) {
    // Neo Green Hill's own line-by-line scroll, which StageBgUpdate_Zone1Acts12 sets through the H-blank
    e.bgScroll[6] = act2() ? (uint16_t)(((act.tick > 16 ? act.tick - 16 : 0) >> 4) & 0xFF) : 0; e.bgScroll[7] = 0;
    draw_neo_background(camX, camY);
  } else {
    // StageBgUpdate_Zone7Act1: the 37 × 23 background scrolls as a whole. Its first frame keeps the course
    // select's scroll, which the original shows before the act's own update lands.
    int bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W_));
    int bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H_));
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
  }

  rings_draw(camX, camY);
  sparkles_draw(camX, camY);
  dusts_draw(camX, camY);
  springs_spikes_draw(camX, camY);
  boxes_draw(camX, camY);
  props_draw(camX, camY);

  // Sonic's sprite, at OAM order 16, in screen coordinates as the renderer draws him
  int right = act.player.facing > 0;
  int sx = (int)__builtin_floor(act.player.x) - camX, sy = (int)__builtin_floor(act.player.y) - camY;
  sonic.oamFlags = ORDER_SONIC << 6;
  sonic.palId = 0;
  sonic.frameFlags = (uint16_t)((sonic.frameFlags & ~(SPRITE_PRIORITY | SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE)) | (2 << 12));
  if (act.player.state == PS_WALK) {
    sonic.frameFlags |= SPRITE_ROT_SCALE_ENABLE;
    Transform tf;
    // walk frames go through the rotation hardware along the slope (drawSonic: rotation = p.rotation << 2)
    tf.rotation = (uint16_t)(act.player.rotation << 2); tf.qScaleX = (int16_t)(right ? -256 : 256); tf.qScaleY = 256;
    tf.x = (int16_t)(sx - (right ? 1 : 0)); tf.y = (int16_t)sy;
    transform_sprite(&sonic, &tf);
  } else {
    if (act.player.facing > 0) sonic.frameFlags |= SPRITE_X_FLIP;
    sonic.x = (int16_t)(sx + (act.player.facing < 0 ? 1 : 0));
    sonic.y = (int16_t)sy;
  }
  display_sprite(&sonic);
  shots_draw(camX, camY);
}

static int musicSync, musicStart, musicAlready;
static void act_frame(void) {
  int hidden = firstPictureHidden;
  firstPictureHidden = 0;
  int cardEnded = 0;
  if (!act.cardDone) {
    int pressed = (e.pressed & (KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN | KEY_A | KEY_B)) != 0;
    if (act2()) {
      int wasDone = act.cardDone;
      card_update(pressed);
      if (!wasDone && act.cardDone) cardEnded = 1;
    } else if (!titlecard_step(pressed)) {
      cardEnded = 1;
      act.cardDone = 1;
      act.clockStopped = 0;
      act.hud.active = 1;
      act.hud.flash = act.stage.hudFlash;
    }
  }
  if (musicSync) {
    musicSync = 0;
    // the act's music starts on the frame after its first picture, as the stage's load ends: the frames before the
    // recording's first one are the act's first 15 off the count, leaving 96, each the samples a frame holds
    long long played = 0;
    for (int i = 0; i < act.tick - 15; i++) {
      int count = (int)((played + 1) * 109725 / 100 - played * 109725 / 100);
      played++;
      dp_sound_render(count);
    }
  }
  step_palettes();
  camera_update(&act.cam, &act.player);
  update_stage_animations(act.started);
  rings_update();
  rings_collect(&act.player);
  sparkles_update();
  dusts_update();
  entities_update();
  enemies_update();
  layer_toggles(&act.player);
  act.player.pushing = 0;
  entities_step(&act.player);
  props_step(&act.player);
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
  animate_player(&act.player);
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
  if (musicStart) {
    // a menu hands the act over: its song starts with the act's first picture, as the original's does
    musicStart = 0;
    play_song(act.stage.music);
    if (act.stage.level == 1) { gba_sound_imm_init(0); gba_sound_volume(0, 0xFF, 4); gba_sound_fade_in(0, 4); }
  }
  draw_frame();
  if (!act2()) titlecard_draw();
}

void act_task(Task *t) {
  (void)t;
  act_frame();
}

/** Draws the act's first frame now, for a screen that hands over inside its own task. */
void act_frame_now(void) { act_frame(); }

static int pendingLevel, pendingCard, pendingPre;
static void act_begin_task(Task *t) {
  destroy_task(t);
  // the act's own task draws its first frame in this frame; the black hand-over frame hides it
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
    // the stage's palette animations are made as the stage loads, and their first frame's colours are already the
    // stage's: the card's first frames run before their first step (CreatePaletteLoaderTask)
    if (!act2() || act.tick >= 16) step_palettes();
    camera_update(&act.cam, &act.player);
    rings_update();
    if (!act2() || act.tick >= 17) update_stage_animations(0);
    if (!act.cardDone) {
      if (act2()) card_update(cardSkip == act.tick);
      else {
        titlecard_step(cardSkip == act.tick);
        if (!titlecard_active()) {
          act.cardDone = 1;
          act.clockStopped = 0;
          act.hud.active = 1;
          act.hud.flash = act.stage.hudFlash;
        }
      }
    }
    if (act2()) {
      // the card holds the player, so his animation runs while nothing moves him; the recording's first frame
      // starts the play. He is made a moment into the card, as the stage's loading ends (InitializePlayer), so his
      // animation is not stepped on its first frames.
      step_player(&act.player, 0, act.preRight && act.cardDone ? 1 : 0, 0, 0, 0, 0, 0, 0);
      if (act.tick >= 15) animate_player(&act.player);
    } else {
      int r = act.cardDone;
      step_player(&act.player, 0, r, 0, 0, !act.cardDone, 0, !act.cardDone, 0);
      animate_player(&act.player);
    }
    if (wasDone) { hud_update(0); after++; }
    // the course clock starts on the frame after the card ends, not on the one it ends
    if (wasDone && !act.clockStopped) act.courseTime++;
    act.tick++;
  }
}

/** The menu that hands the act over already started its song, a frame ahead of the act's first picture. */
void act_music_already(void) { musicAlready = 1; }

void act_start(int level, int cardSkip, int preFrames) {
  memset(&act, 0, sizeof act);
  copyCount = 0;
  // what the course select still had queued is dropped, as its screen's maps are: the act's own come next
  clear_queues();
  clear_bg_sprites();
  for (int i = 0; i < 4; i++) { e.mapFill[i].value = 0; memset(e.mapFill[i].rect, 0, sizeof e.mapFill[i].rect); }
  load_stage(level);
  load_rings(level);
  load_entities(level);
  load_enemies(level);
  load_props(level);
  for (int i = 0; i < paletteCount; i++) {
    Sprite *s = &paletteAnims[i].sprite;
    sprite_init(s);
    s->graphics.anim = (uint16_t)paletteAnims[i].anim;
    s->variant = (uint8_t)paletteAnims[i].variant;
    s->animSpeed = ANIM_NORMAL;
    s->palId = 0;
    if (act2()) s->frameFlags |= SPRITE_KEEP_TILES;   // 820's tiles command would write over Sonic's in OBJ VRAM
  }
  rings_init();
  create_player(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1; act.cardFrame = 0;
  act.hud.active = 0; act.hud.flash = act2() ? (act.stage.hudFlash + 7) & 31 : act.stage.hudFlash;
  act.started = 0; act.drawn = 0;
  act.firstFrame = (int)gba_start_number("first", 0);
  act.preRight = (int)gba_start_number("run", 0);
  e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
  e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
  e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;

  // Sonic's sprite: the player's tiles, colours and animation, at its own OAM order
  sprite_init(&sonic);
  sonicVram = OBJ_VRAM;   // the player sprite's tiles are the first ones, as the original keeps them
  sonic.graphics.dest = sonicVram;
  sonic.graphics.anim = SONIC_IDLE; sonic.variant = 0; sonic.animSpeed = ANIM_NORMAL;
  sonic.palId = 0; sonic.oamFlags = ORDER_SONIC << 6; sonic.frameFlags = 2 << 12;

  // the HUD's tiles and colours (hudGraphics): the white and red digits, the ring and the face. Neo Green Hill keeps
  // the original's reserved places (tiles 64 to 127); the other acts take a block from the heap so the title card's
  // own tiles go after it.
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1, &faceTiles, &facePalette, &layout);
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  if (act2()) {
    hudVram = OBJ_VRAM + 0x800; hudTile = 64;
    copy_rom(fontTiles + 32 * 32, hudVram + 0x280, 22 * 32);    // the white digits at tile 84
    copy_rom(fontTiles + 224 * 32, hudVram + 0x540, 22 * 32);   // the red ones at tile 106
    copy_rom(ringTiles, hudVram + 0x80, 16 * 32);               // the ring at tile 68
    copy_rom(faceTiles, hudVram, 4 * 32);                       // the face at tile 64
  } else {
    hudVram = vram_malloc(64); hudTile = (hudVram - OBJ_VRAM) >> 5;
    copy_rom(fontTiles + 32 * 32, hudVram + HUD_WHITE * 32, 22 * 32);
    copy_rom(fontTiles + 224 * 32, hudVram + HUD_RED * 32, 22 * 32);
    copy_rom(ringTiles, hudVram + HUD_RING * 32, 16 * 32);
    copy_rom(faceTiles, hudVram + HUD_FACE * 32, 4 * 32);
  }
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;

  // the title card's pictures and its pieces, from the act's first frame
  if (!act2()) {
    titlecard_start(level, ctx.character);
    // the card's pieces in palette 6 use the HUD font's colours, which the stage's init loads last, as the original does
    for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
    e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
  }
  // the frames before the recording starts: the title card, or the frames a start point skips
  if (gba_start_point("level") != NULL || cardSkip >= 0 || preFrames > 0) pre_run(cardSkip, preFrames);
  queue_stage_animation_frame();
  if (act.stage.level == 1) {
    // Neo Green Hill act 2's stage music manager (Task_StageMusicManager, MusManager_UpdateBgmParams): the song from
    // its beginning at a sixty-fourth of the volume, fading in, on the music player
    if (gba_start_point("level") != NULL || cardSkip >= 0 || preFrames > 0) {
      play_song(act.stage.music);
      gba_sound_imm_init(0); gba_sound_volume(0, 0xFF, 4); gba_sound_fade_in(0, 4);
      musicSync = 1;
    } else if (!musicAlready) musicStart = 1;
  } else if (gba_start_point("level") != NULL || cardSkip >= 0 || preFrames > 0) {
    // a start point skips the act's card with the sound already gone by
    play_song(act.stage.music);
    gba_sound_frames_gone_by(118);
  } else if (!musicAlready) musicStart = 1;
  musicAlready = 0;
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
