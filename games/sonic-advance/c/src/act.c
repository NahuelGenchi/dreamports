// X Zone's act in C: its stage and collision from the player's copy, the camera, Sonic on the ground, the HUD, and
// the title card's state without its pictures. Translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js, a
// function at a time; every comment names the original's function where one is rewritten.

#include "objects.h"
#include "results.h"

// the kit's sound output, as the page asks for a frame's samples (kit/gba/c/sound.c): the act renders the frames
// before its first one here, to put the stage's music where the original has it
float *dp_sound_render(int count);
// and the frames the start point leaves out, which the music player skips without playing them
void dp_sound_skip_frames(int frames);

enum { OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC, OFFSET_LOOP_POINTS = 0x4A6E74, OFFSET_LOOP_SHIFTS = 0x4A6EBC, SCREEN_W_ = 240, SCREEN_H_ = 160 };
// the HUD's tiles sit at fixed places below the sprites' heap (VRAM_RESERVED_UI_DIGITS_A to _D): the face, the ring, then the
// white and the red digits
enum { HUD_GLYPHS = 11, HUD_FACE = 0x800 / 32, HUD_RING = 0x880 / 32, HUD_WHITE = 0xA80 / 32, HUD_RED = 0xD40 / 32 };
enum { OBJ_8x8 = 0, OBJ_16x16 = 1, OBJ_32x32 = 2, OBJ_8x16 = 8 };
enum { ORDER_DIGITS = 2, ORDER_ICONS = 3 };

Act act;
int actHudFlash = -1;

// the HUD's zero-ring flash the act starts with: the character select hands over 1, a course select or a start
// point the stage's own value (levels.js hudFlash)
static int hud_flash(void) { return actHudFlash >= 0 ? actHudFlash : act.stage.hudFlash; }
static int musicSync;
static uint16_t holdColour; static int restoreColour;   // the menu's black for the act's first picture

static int is_casino_level(int level) { return level == ACT_LEVEL_CASINO_PARADISE_1 || level == ACT_LEVEL_CASINO_PARADISE_2; }

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

// --- the stage (rom/extract.js extractStage, engine/stage.js) -----------------------------------------------------
// The copies stay in memory until the V-blank takes them: the queue keeps the pointers, not copies (engine.c). Each
// V-blank empties the queue, so a ring of them, larger than one frame ever asks for, is enough.
enum { COPIES = 64 };
static Graphics copies[COPIES];
static unsigned copyCount;
static void copy_rom(uint32_t src, uint32_t dest, uint32_t size) {
  Graphics *g = &copies[copyCount++ % COPIES];
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
  // each act's stage init (levels.js): Secret Base act 1 is level 2, act 2 is level 3, Casino Paradise act 1 level 4, X Zone level 12
  s->zone = 6; s->act = 0; s->music = 24; s->hudFlash = 90; s->backgroundScroll = BG_SCROLL_X_ZONE;
  s->paletteCount = 0; s->paletteAnimations = NULL;
  static const int SECRET_BASE_PALETTES[] = { 819, 845, 849 };   // StageInit_Zone2Act1 and StageInit_Zone2Act2
  if (level == ACT_LEVEL_SECRET_BASE_1) {
    s->zone = 1; s->act = 0; s->music = 14; s->hudFlash = 56; s->backgroundScroll = BG_SCROLL_SECRET_BASE_OUTSIDE;
    s->paletteCount = (int)(sizeof SECRET_BASE_PALETTES / sizeof SECRET_BASE_PALETTES[0]);
    s->paletteAnimations = SECRET_BASE_PALETTES;
  }
  if (level == ACT_LEVEL_SECRET_BASE_2) {
    s->zone = 1; s->act = 1; s->music = 15; s->hudFlash = 64; s->backgroundScroll = BG_SCROLL_SECRET_BASE;
    s->paletteCount = (int)(sizeof SECRET_BASE_PALETTES / sizeof SECRET_BASE_PALETTES[0]);
    s->paletteAnimations = SECRET_BASE_PALETTES;
  }
  if (level == ACT_LEVEL_CASINO_PARADISE_1 || level == ACT_LEVEL_CASINO_PARADISE_2) {
    static const int CASINO_PALETTES[] = { 816, 817, 818, 824, 825, 827, 827, 828, 843, 844, 826 };
    s->zone = 2; s->act = level == ACT_LEVEL_CASINO_PARADISE_2 ? 1 : 0;
    s->music = level == ACT_LEVEL_CASINO_PARADISE_2 ? 17 : 16;
    s->hudFlash = level == ACT_LEVEL_CASINO_PARADISE_2 ? 52 : 20;
    s->backgroundScroll = BG_SCROLL_CASINO_PARADISE;
    s->paletteCount = (int)(sizeof CASINO_PALETTES / sizeof CASINO_PALETTES[0]);
    s->paletteAnimations = CASINO_PALETTES;
  }
  if (ACT_IS_ICE_MOUNTAIN(level)) {
    // StageInit_Zone4Act1 and StageInit_Zone4Act2: each act's song, the HUD's zero-ring counter and the palette
    // animations palette_loader.c makes for Ice Mountain; the water comes with the camera (act_start)
    static const int ICE_MOUNTAIN_PALETTES[] = { 822, 821 };
    enum { MUS_ICE_MOUNTAIN__ACT_1 = 18, MUS_ICE_MOUNTAIN__ACT_2 = 19 };
    s->zone = 3; s->act = level - ACT_LEVEL_ICE_MOUNTAIN_1; s->hudFlash = 90; s->backgroundScroll = BG_SCROLL_ICE_MOUNTAIN;
    s->music = level == ACT_LEVEL_ICE_MOUNTAIN_1 ? MUS_ICE_MOUNTAIN__ACT_1 : MUS_ICE_MOUNTAIN__ACT_2;
    s->paletteCount = (int)(sizeof ICE_MOUNTAIN_PALETTES / sizeof ICE_MOUNTAIN_PALETTES[0]);
    s->paletteAnimations = ICE_MOUNTAIN_PALETTES;
  }
  if (level == ACT_LEVEL_NEO_GREEN_1 || level == ACT_LEVEL_NEO_GREEN_2) {
    // Neo Green Hill act 1 and act 2: act 2 adds 820's two variants, its camera stop and its own BG3 block size
    static const int NEO_PALETTES_1[] = { 814, 815 };
    static const int NEO_PALETTES_2[] = { 814, 815, 820, 820 };
    static const int NEO_VARIANTS_2[] = { 0, 0, 1, 0 };
    s->zone = 0; s->act = level == ACT_LEVEL_NEO_GREEN_2 ? 1 : 0;
    s->music = level == ACT_LEVEL_NEO_GREEN_2 ? 13 : 12; s->hudFlash = 90;
    s->backgroundScroll = BG_SCROLL_NEO_GREEN;
    s->paletteCount = level == ACT_LEVEL_NEO_GREEN_2 ? 4 : 2;
    s->paletteAnimations = level == ACT_LEVEL_NEO_GREEN_2 ? NEO_PALETTES_2 : NEO_PALETTES_1;
    s->paletteVariants = level == ACT_LEVEL_NEO_GREEN_2 ? NEO_VARIANTS_2 : NULL;
    s->cameraStop = level == ACT_LEVEL_NEO_GREEN_2 ? 768 : 0;
  }
  // the front layer's tiles, in the first character block, and the stage's 256 colours (extractStage's palette)
  copy_rom(s->front.tiles, 0, s->front.tilesSize);
  for (int i = 0; i < 256; i++) e.bgPalette[i] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the background's tiles at the second character block, and its map (DrawBackground, copy_backgrounds)
  copy_rom(s->background.tiles, 0x8000, s->background.tilesSize);
  for (int row = 0; row < s->background.yTiles; row++) {
    for (int col = 0; col < s->background.xTiles; col++) {
      uint16_t entry = (uint16_t)rom_u16(s->background.map + (row * s->background.xTiles + col) * 2);
      // X Zone's 37 × 23 background is a 512-wide text layer: two 32-tile blocks, columns 32–36 at 0xE800.
      // Casino Paradise's is 32 × 32 at 0xE800, a 256 × 256 layer, and Secret Base act 2's the first 32 × 32 of its
      // map at 0xE000 (sStageBgDimensions, 256 × 256 in this copy). Secret Base act 1's is 32 × 64 at 0xE000, a 256 × 512
      // layer, and so is Ice Mountain's (STGBG_SCRN_DIM(256, 512, 2, BACK_A)).
      if (level == ACT_LEVEL_SECRET_BASE_2 && (row >= 32 || col >= 32)) continue;
      if (ACT_IS_ICE_MOUNTAIN(level) && (row >= 64 || col >= 32)) continue;
      uint32_t at = (is_casino_level(level) || level == ACT_LEVEL_NEO_GREEN_1 || level == ACT_LEVEL_NEO_GREEN_2)
        ? 0xE800 + (uint32_t)(row * 32 + col) * 2u
        : level == ACT_LEVEL_SECRET_BASE_1 || level == ACT_LEVEL_SECRET_BASE_2 || ACT_IS_ICE_MOUNTAIN(level) ? 0xE000 + (uint32_t)(row * 32 + col) * 2u
        : (col < 32 ? 0xE000 + (uint32_t)col * 2u : 0xE800 + (uint32_t)(col - 32) * 2u) + (uint32_t)row * 64u;
      gba_vram[at] = (uint8_t)entry; gba_vram[at + 1] = (uint8_t)(entry >> 8);
    }
  }
  // InitCamera's registers: BG1 the front layer, BG2 the back one, BG3 the background, all 16 colours
  e.dispCnt = 0x304E;           // OBJ on, window 0 on, BG1, BG2 and BG3 on, 1D OAM
  e.bgCnt[1] = 0x1E01;          // 256 × 256, priority 1, map 30 (0xF000), character base 0
  e.bgCnt[2] = 0x1F02;          // 256 × 256, priority 2, map 31 (0xF800), character base 0
  // and their maps cleared to entry 0 (gBgSprites_Unknown2[1] and [2], whole 32-row maps), so the column and rows the
  // layers never fill hold nothing of the screen before; done here at once, as the act writes its maps straight to VRAM
  memset(gba_vram + 0xF000, 0, 0x1000);
  e.bgCnt[3] = (is_casino_level(level) || level == ACT_LEVEL_NEO_GREEN_1 || level == ACT_LEVEL_NEO_GREEN_2)
              ? 0x1D0B                                            // 256 × 256, priority 3, map 29 (0xE800), character base 2
              : level == ACT_LEVEL_SECRET_BASE_1 || ACT_IS_ICE_MOUNTAIN(level) ? 0x9C0B       // 256 × 512, priority 3, map 28 (0xE000), character base 2
              : level == ACT_LEVEL_SECRET_BASE_2 ? 0x1C0B       // 256 × 256, priority 3, map 28 (0xE000), character base 2
              : 0x5C0B;                                          // 512 × 256, priority 3, map 28 (0xE000), character base 2
}

// the stage's palette animations (palette_loader.c, palettes.js): each loads colours into the background palette
// on its frames, with a wait of its own rather than the sprite engine's 16-bit one
static PaletteAnim paletteAnims[16];
static void parse_palette_animation(PaletteAnim *p, int anim, int variant) {
  memset(p, 0, sizeof *p);
  uint32_t script = rom_ptr(rom_ptr(sprites.anims + (uint32_t)anim * 4) + (uint32_t)variant * 4);
  int loads = 0;
  for (int cur = 0, guard = 0; guard < 600; guard++) {
    uint32_t at = script + (uint32_t)cur * 4;
    int id = rom_s32(at);
    if (id >= 0) {
      p->delays[p->count] = id;
      p->at[p->count] = cur;
      p->loadCount[p->count] = loads;
      p->count++;
      loads = 0;
      cur += 2;
      continue;
    }
    switch (id) {
      case -1: cur += 3; break;
      case -2:
        if (loads < 8) { p->loads[p->count][loads].entry = (int)rom_s32(at + 4); p->loads[p->count][loads].count = (int)rom_u16(at + 8); p->loads[p->count][loads].insert = (int)rom_u16(at + 10); loads++; }
        cur += 3; break;
      case -3: {
        int to = cur - (int)rom_s32(at + 4);
        p->loop = 0;
        for (int i = 0; i < p->count; i++) if (p->at[i] >= to) { p->loop = i; break; }
        p->frame = 0; return;
      }
      case -4: p->loop = -1; return;
      case -9: p->loop = -1; return;
      default: {
        static const int WORDS[13] = { 0, 3, 3, 2, 1, 2, 3, 2, 3, 2, 4, 2, 2 };
        int w = id <= -1 && id >= -12 ? WORDS[-id] : 1;
        cur += w;
      }
    }
  }
}
// one step of a palette animation into a palette, the screen's or a copy of it
static void palette_animation_into(PaletteAnim *p, uint16_t *pal) {
  if (p->wait > 0) { p->wait -= 256; return; }
  if (p->frame < 0) return;
  p->shown = p->frame;
  for (int l = 0; l < p->loadCount[p->frame]; l++) {
    int entry = p->loads[p->frame][l].entry, count = p->loads[p->frame][l].count, insert = p->loads[p->frame][l].insert;
    for (int i = 0; i < count; i++) pal[(insert + i) & 0xFF] = (uint16_t)rom_u16(sprites.palettes + (uint32_t)entry * 32 + (uint32_t)i * 2);
    if (pal == e.bgPalette) e.flags |= FLAGS_UPDATE_BG_PALETTES;
  }
  p->wait += (p->delays[p->frame] - 1) * 256;
  p->frame = p->frame + 1 < p->count ? p->frame + 1 : p->loop;
}
static void palette_animation_step(PaletteAnim *p) { palette_animation_into(p, e.bgPalette); }
// the background colours the palette animations make on the next frame, which the water's colours below it can show
// a frame early (notes/the-colours-under-water-can-be-the-next-frames.md)
void act_next_bg_palette(uint16_t *pal) {
  for (int i = 0; i < 256; i++) pal[i] = e.bgPalette[i];
  for (int i = 0; i < act.palCount && i < 16; i++) { PaletteAnim copy = paletteAnims[i]; palette_animation_into(&copy, pal); }
}
static void palette_animation_task(Task *t) { palette_animation_step((PaletteAnim *)t->data); }
static void start_palette_animations(void) {
  if (act.palStarted) return;
  act.palStarted = 1;
  act.palCount = act.stage.paletteCount;
  act.pal = paletteAnims;
  for (int i = 0; i < act.palCount && i < 16; i++) {
    parse_palette_animation(&paletteAnims[i], act.stage.paletteAnimations[i], act.stage.paletteVariants ? act.stage.paletteVariants[i] : 0);
    if (act.stage.level != ACT_LEVEL_NEO_GREEN_2) create_task(palette_animation_task, &paletteAnims[i], 0x2000, 0, NULL);
  }
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

// --- the camera (engine/camera.js createCamera and updateCamera) -----------------------------------------------
// how far and how fast holding up or down pans the view, and the wait before it does
enum { LOOK_STEP = 2, LOOK_UP = 72, LOOK_DOWN = 60, LOOK_DELAY = 120 };
static void create_camera(Camera *c, const Player *p) {
  memset(c, 0, sizeof *c);
  c->x = (int)__builtin_floor(p->x) - SCREEN_W_ / 2;
  c->y = (int)__builtin_floor(p->y) - (SCREEN_H_ / 2 + 4);
  c->targetX = c->x; c->targetY = c->y;
  c->offsetY = p->offsetY - 4;
  c->minX = 0; c->minY = 0;
  c->maxX = act.stage.width - (act.stage.cameraStop ? act.stage.cameraStop : SCREEN_W_); c->maxY = act.stage.height - SCREEN_H_;
  c->speedX = 16; c->speedY = 12;
  c->width = act.stage.width; c->height = act.stage.height;
  c->lookDelay = LOOK_DELAY;
}
// updateLook: holding up or down with his feet still pans the view after a delay, 2 px a frame, and it eases back
// otherwise
static void ease_look_back(Camera *c) {
  int step = c->look < 0 ? -c->look : c->look;
  if (step > LOOK_STEP) step = LOOK_STEP;
  c->look -= c->look > 0 ? step : c->look < 0 ? -step : 0;
}
static void update_look(Camera *c, const Player *p) {
  int looking = (p->state == PS_LOOK_UP ? -LOOK_UP : p->state == PS_CROUCH && p->gsp == 0 ? LOOK_DOWN : 0) * (p->inverted ? -1 : 1);
  if (!looking) { c->lookDelay = LOOK_DELAY; ease_look_back(c); }
  else if (c->lookDelay == 0 || --c->lookDelay == 0) {
    if (looking < 0 && c->look + c->shiftY > looking) c->look -= LOOK_STEP;
    if (looking > 0 && c->look + c->shiftY < looking) c->look += LOOK_STEP;
  } else ease_look_back(c);
}
static int camera_update(Camera *c, const Player *p) {
  c->wrappedThisFrame = 0;
  if (!c->started) { c->started = 1; return 0; }
  c->x = clamp((int)c->x, c->minX, c->maxX - 1);
  c->y = clamp((int)c->y, c->minY, c->maxY - 1);
  update_look(c, p);
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
  return 1;
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
  int tile = g < HUD_GLYPHS ? HUD_WHITE + g * 2 : HUD_RED + (g - HUD_GLYPHS) * 2;
  put_oam(ORDER_DIGITS, x, y, OBJ_8x16, tile, 6, 0);
}
static void hud_update(int draw) {
  Hud *h = &act.hud;
  if (!h->active) return;
  if (draw) {
    // the icons: the ring over the ring count and the character's face by the lives, at OAM order 3
    put_oam(ORDER_ICONS, -2, -1, OBJ_32x32, HUD_RING, 6, 0);
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, HUD_FACE, 0, 0);
    if (act.ringCount == 0) {
      // white, red, red, white, then the white zero the bytes after the string make; past those, on the first frame of a
      // counter that starts at 40 or more, a character code of 0, the tiles 64 before the font's (sub_8053BAC, hud_load)
      if (act.stage.level == ACT_LEVEL_NEO_GREEN_2) {
        // the ring counter's zero flashes red for sixteen frames and white for sixteen (Task_StageUIMain)
        hud_glyph(h->flash & 0x10 ? 11 : 0, 9, 5);
      } else {
        static const int FLASH[5] = { 0, 11, 11, 0, 0 };
        int f = h->flash >> 3;
        if (f < 5) hud_glyph(FLASH[f], 9, 5);
        else put_oam(ORDER_DIGITS, 9, 5, OBJ_8x16, HUD_WHITE - 64, 6, 0);
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
  if (act.ringCount == 0) h->flash = (h->flash + 1) & 31;   // it only counts while it shows
}

// --- the title card (titlecard.c) ------------------------------------------------------------------------------------
static void card_update(int pressed) {
  if (act.cardDone) return;
  if (!titlecard_run(pressed)) act.clockStopped = 0;
}

// --- the frame (engine/game.js) ----------------------------------------------------------------------------------
static int js_mod(int a, int n) { int r = a % n; return r < 0 ? r + n : r; }

/** StageBgUpdate_Zone2_Interior for one screen line: the x its first pixel comes from, and the y offset that shows the
 *  map row it takes: the wall's row, or a bar's when one crosses the line. */
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

// Neo Green Hill's background (engine/backgrounds.js): three cloud bands drift with the stage clock, the big clouds
// and islands stay still, and the sea scrolls faster toward the bottom of the screen. Each line's scroll goes in
// through the H-blank, as the original's StageBgUpdate_Zone1Acts12 does.
static void draw_neo_background(int camX) {
  int bgHeight = act.stage.background.yTiles * 8;
  int level = act.stage.level;
  int time = level == ACT_LEVEL_NEO_GREEN_2 ? (act.tick > 16 ? act.tick - 16 : 0) : (act.tick ? act.tick - 1 : 0);
  e.bgScroll[6] = (uint16_t)(level == ACT_LEVEL_NEO_GREEN_2 ? ((time >> 4) & 0xFF) : 0); e.bgScroll[7] = 0;
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

static void neo_stage_animation_copy(int frame);
static void neo_stage_animation_step(void);
static void neo_stage_animation_draw(void);

static void draw_frame(void) {
  if (restoreColour) { restoreColour = 0; e.bgPalette[0] = holdColour; e.flags |= FLAGS_UPDATE_BG_PALETTES; }
  // the first picture the screen shows keeps the layers where the act started, before the camera's first move
  int hold = act.frames <= 2 && !act.afterLevel;
  int camX = hold ? act.startCamX : (int)act.cam.x;
  int camY = hold ? act.startCamY : (int)act.cam.y;
  // the act has no blend, and its first frames keep the course select's display, as the original does
  // (Ice Mountain's background update sets its blend in the camera's task, which the title card's end clears)
  if (act.stage.backgroundScroll != BG_SCROLL_ICE_MOUNTAIN) { e.bldCnt = 0; e.bldAlpha = 0x0010; }
  e.bldY = 0;
  e.dispCnt = 0x1E40;
  e.winRegs[0] = e.winRegs[1] = 0x00F0;
  // Secret Base act 1's beams leave WIN0V and WIN1V as they last set them on the frames they don't draw (actspot.c)
  if (act.stage.level != ACT_LEVEL_SECRET_BASE_1) e.winRegs[2] = e.winRegs[3] = 0x00A0;
  // a boss's task clears the blending, while Sonic is alive (sub_80308A4)
  if (act.blendOff) { e.winRegs[5] = 0; e.bldCnt = 0; e.bldY = 0; act.blendOff = 0; }
  // a hit boss's flash: the OBJ window on, everything in it brightened all the way (sub_802D870)
  if (act.bossFlash) { e.dispCnt |= 0x8000; e.winRegs[5] = 0x3F1F; e.bldCnt = 0xBF; e.bldY = 0x10; }
  act.drawn++;
  // RenderMetatileLayers: BG1 and BG2 scroll by the camera's sub-tile part, their maps filled from the metatiles
  e.bgScroll[2] = (uint16_t)(camX & 7); e.bgScroll[3] = (uint16_t)(camY & 7);
  e.bgScroll[4] = (uint16_t)(camX & 7); e.bgScroll[5] = (uint16_t)(camY & 7);
  if (act.stage.level == ACT_LEVEL_NEO_GREEN_2) neo_stage_animation_draw();
  // the camera's task draws the layers before the player's task wraps the loop, so the frame of a wrap keeps the map of
  // where the camera was before it; the scroll, a multiple of 8 px back, is the same as after it
  int layerX = camX - act.cam.wrappedThisFrame;
  fill_layer(0xF000, LAYER_FRONT, layerX, camY);
  fill_layer(0xF800, LAYER_BACK, layerX, camY);
  int bgX, bgY;
  if (act.stage.backgroundScroll == BG_SCROLL_SECRET_BASE) {
    // StageBgUpdate_Zone2Act2 (StageBgUpdate_Zone2_Interior): a wall that repeats every 64 lines, with three bars and a
    // bigger one laid over it, each line's place set through HBlank
    e.bgScroll[6] = (uint16_t)((camX >> 2) & 0xFF); e.bgScroll[7] = (uint16_t)((camY >> 2) & 0xFF);
    set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
    for (int line = 0; line < SCREEN_H_; line++) {
      int x, y;
      secret_base_scroll(line, camX, camY, &x, &y);
      put16(e.primary + (uint32_t)line * 4, (uint32_t)x);
      put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)y);
    }
  } else if (act.stage.backgroundScroll == BG_SCROLL_NEO_GREEN) {
    // StageBgUpdate_Zone1Acts12 leaves out the loop wrap (x -= cam->sa2__unk20)
    draw_neo_background(camX - act.cam.wrapped);
  } else if (act.stage.backgroundScroll == BG_SCROLL_SECRET_BASE_OUTSIDE) {
    // StageBgUpdate_Zone2Act1, outside the base (before x 1488): the map's bottom 160 rows, moving across a 78th of
    // the camera's way
    e.bgScroll[6] = (uint16_t)((camX * 16) / (78 * 16)); e.bgScroll[7] = (uint16_t)(512 - SCREEN_H_);
  } else if (act.stage.backgroundScroll == BG_SCROLL_CASINO_PARADISE) {
    // StageBgUpdate_Zone3Acts12: the 256 × 256 map moves 16 px across the act and 96 px down it, and its bands
    // of hedges and railing scroll faster through HBlank (BACKGROUND_SCROLL.casinoParadise)
    static const int BANDS[6] = { 134, 140, 152, 168, 192, 256 };
    static const int SHIFT[5] = { 5, 4, 3, 2, 1 };
    bgX = act.cam.bgX; bgY = act.cam.bgY;
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
    set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
    for (int line = 0; line < SCREEN_H_; line++) {
      int row = bgY + line, x = bgX;
      for (int b = 4; b >= 0; b--) if (row >= BANDS[b] && row < BANDS[b + 1]) { x = (bgX + ((camX - act.cam.wrapped) >> SHIFT[b])) & 0xFF; break; }
      put16(e.primary + (uint32_t)line * 4, (uint32_t)(x & 0x1FF));
      put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)(bgY & 0x1FF));
    }
  } else if (act.stage.backgroundScroll == BG_SCROLL_ICE_MOUNTAIN) {
    // StageBgUpdate_Zone4Acts12's scroll and blend, from the camera's update
    ice_mountain_draw();
  } else {
    // StageBgUpdate_Zone7Act1: the 37 × 23 background scrolls as a whole. Its first frame keeps the course
    // select's scroll, which the original shows before the act's own update lands.
    bgX = (int)(((double)camX * 56.0) / (act.stage.width - SCREEN_W_));
    bgY = (int)(((double)camY * 24.0) / (act.stage.height - SCREEN_H_));
    e.bgScroll[6] = (uint16_t)bgX; e.bgScroll[7] = (uint16_t)bgY;
  }

  player_draw(&act.player, camX, camY);
}

// UpdateBgAnimationTiles: the front layer's first tiles change every animDelay camera runs; frame 0 is the tileset,
// frame k is the k-th block stored after it (rom/tilemaps.js)
static void animate_stage_tiles(void) {
  const Tilemap *t = &act.stage.front;
  if (!t->animTileSize || !t->animFrameCount) return;
  act.bgAnimShown = act.bgAnimFrame;
  if (++act.bgAnimDelay < t->animDelay) return;
  act.bgAnimDelay = 0;
  if (++act.bgAnimFrame >= t->animFrameCount) act.bgAnimFrame = 0;
  uint32_t src = act.bgAnimFrame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(act.bgAnimFrame - 1) * t->animTileSize;
  copy_rom(src, 0, t->animTileSize);
}

// Neo Green Hill act 2's own front-layer animation timing (background.c UpdateBgAnimationTiles): frame 0 is the
// tileset itself; frame k is the k-th block after its static part. The screen shows the frame from before this one's
// step, as its copy lands at the next V-blank.
static void neo_stage_animation_copy(int frame) {
  const Tilemap *t = &act.stage.front;
  if (!t->animTileSize || !t->animFrameCount) return;
  uint32_t src = frame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(frame - 1) * t->animTileSize;
  if (src + t->animTileSize <= gba_rom_size) memcpy(gba_vram, gba_rom + src, t->animTileSize);
}
static void neo_stage_animation_step(void) {
  const Tilemap *t = &act.stage.front;
  if (!t->animTileSize || !t->animFrameCount) return;
  act.bgAnimShown = act.bgAnimFrame;
  if (++act.bgAnimDelay < (t->animDelay ? t->animDelay : 1)) return;
  act.bgAnimDelay = 0;
  if (++act.bgAnimFrame >= t->animFrameCount) act.bgAnimFrame = 0;
}
static void neo_stage_animation_draw(void) {
  neo_stage_animation_copy(act.bgAnimShown);
}

// the HUD's tiles and colours (hudGraphics): the white and red digits, the ring and the face. The original loads
// them as the HUD starts, after the title card's frame, which is why the card's own palette 6 is loaded later too.
static void hud_load(void) {
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1, &faceTiles, &facePalette, &layout);
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  copy_rom(fontTiles + 32 * 32, OBJ_VRAM + HUD_WHITE * 32, 22 * 32);
  copy_rom(fontTiles + 224 * 32, OBJ_VRAM + HUD_RED * 32, 22 * 32);
  copy_rom(ringTiles, OBJ_VRAM + HUD_RING * 32, 16 * 32);
  copy_rom(faceTiles, OBJ_VRAM + HUD_FACE * 32, 4 * 32);
  // UI graphics 39, which the character select loads into sprite VRAM from tile 1 and nothing writes over before the act:
  // its tiles 19 and 20 are the two a zero-ring count reads past its string on its first frame (sub_8053BAC). The
  // Dreamport's recordings that skip the character select still find them there. X Zone's first card leaves them blank
  if (act.stage.level == ACT_LEVEL_X_ZONE) memset(gba_vram + OBJ_VRAM + (HUD_WHITE - 64) * 32, 0, 2 * 32);
  else {
    uint32_t leftTiles, leftPalette;
    ui_graphics(39, &leftTiles, &leftPalette, &layout);
    copy_rom(leftTiles + 19 * 32, OBJ_VRAM + (HUD_WHITE - 64) * 32, 2 * 32);
  }
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

// --- Casino Paradise's background and fireworks (backgrounds.js) ----------------------------------------------------
enum { FIREWORK_PRIORITY = 0x4001, FIREWORKS = 12 };
typedef struct { Sprite s; int x, y, done, ended; } Firework;
static Firework fireworks[FIREWORKS];

uint32_t act_random(void) {
  if (act.stage.level == ACT_LEVEL_CASINO_PARADISE_2) return front_random();
  return act.seed = act.seed * 0x196225u + 0x3C6EF35Fu;
}

// --- what Sonic's moves ask of the act (the world's hooks in engine/game.js) --------------------------------------------
enum { SE_LIFE_LOST = 119, SE_DROWNED = 192, SPIN_DASH_FREEZE = 10 };

// brake dust stays where it appeared, flipped by the game's random numbers (CreateBrakingDustEffect): the effect itself
// isn't here yet, but its draw moves the sequence the fireworks' positions come from on
// the camera's target stays put after a spin dash is released
void act_freeze_camera(void) { act.cam.freeze = SPIN_DASH_FREEZE; }
// the frame Sonic dies the camera's target and the clock stop
void act_player_died(void) {
  act.cam.locked = 1;
  act.clockStopped = 1;
  play_song(act.player.drownSeconds < 0 ? SE_DROWNED : SE_LIFE_LOST);
}
// the act starting over with a life less is not here yet
void act_life_lost(void) {}
// CreateStageResults, as the goal hands over: the act's rings into the save's ring bank and the next level unlocked
// (X Zone's way to the Moon Zone decides that itself, and isn't here yet), then the results' tasks, which first run
// this frame, after the goal's
void act_stage_results(void) {
  int level = act.stage.level;
  save_add_ring_bank(act.ringCount);
  if (level != ACT_LEVEL_X_ZONE && save_unlocked_level(0) < level + 1) save_set_unlocked_level(0, (uint16_t)(level + 1));
  results_start(level, act.ringCount, act.courseTime, level == ACT_LEVEL_X_ZONE, 0);
}

int act_level_ported(int level) {
  return level == ACT_LEVEL_NEO_GREEN_1 || level == ACT_LEVEL_NEO_GREEN_2
    || level == ACT_LEVEL_SECRET_BASE_1 || level == ACT_LEVEL_SECRET_BASE_2 || is_casino_level(level)
    || ACT_IS_ICE_MOUNTAIN(level) || level == ACT_LEVEL_X_ZONE;
}

// GoToNextLevel, once the save is written: the next act, made inside the task as the course select makes one, with the
// score, the lives and the game's random numbers carried over (GameStageStart leaves them). Its first frame runs at
// once, then it loads for NEXT_LEVEL_LOAD frames (act_task). A next act that isn't in C yet stops the game there, with
// the screen as it was, as the front end does (front.c), rather than load with another act's music and background
enum { NEXT_LEVEL_LOAD = 2 };
static int nextLevel;
static void next_act(void) {
  if (!act_level_ported(nextLevel)) { act_active = 0; ctx.done = 1; return; }
  int lives = act.lives, score = act.score;
  uint32_t seed = act.seed;
  act_start(nextLevel, -1, 0);
  act.lives = lives; act.score = score; act.seed = seed;
  act.afterLevel = 1;
  act.musicStarts = 1;
  act_frame_now();
  act.stallLoad = 0; act.loadFrames = NEXT_LEVEL_LOAD;
}
// GoToNextLevel: every task goes, the act's objects with their sprites' VRAM, the queues stop, the music stops, and
// the save is written (the screen keeping its frame while the flash takes it), before the next act starts. Against the
// original, the write and the next stage's start take a frame more than WRITE_FRAMES here
static void go_to_next_level(void) {
  nextLevel = act.stage.level + 1;
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  stop_all_songs();
  if (save_write()) engine_stall(WRITE_FRAMES + 1, next_act);
  else next_act();
}

int act_goal_passed(void) { return act.goalReached; }
// past the goal post the clock stops and the rings manager neither takes nor draws rings
void act_goal_reached(void) { act.goalReached = 1; act.clockStopped = 1; act.ringsStopped = 1; }
int act_checkpoint_index(void) { return act.checkpointIndex; }
// Sonic passed checkpoint `index`: the act would start over with his centre at (x, y) and the clock at this time
void act_checkpoint_pass(int index, int x, int y) {
  act.checkpointIndex = index; act.checkpointX = x; act.checkpointY = y; act.checkpointTime = act.courseTime;
}
// the C version has no special stages yet, so a special spring is a plain spring, as the JavaScript version's is without
// one; act_special_stage is then never reached
int act_special_stages(void) { return 0; }
void act_special_stage(int x, int y) { (void)x; (void)y; }
// the special spring holds the camera where it was, so what is drawn after it this frame is placed from there
void act_hold_camera(int x, int y) { act.cam.x = x; act.cam.y = y; }

static void firework_task(Task *t) {
  Firework *f = (Firework *)t->data;
  // it goes on the frame after its animation ends, drawing its last picture on the frame it ends
  if (f->ended) { f->done = 1; vram_free(f->s.graphics.dest); destroy_task(t); return; }
  if (!update_sprite(&f->s, 0)) f->ended = 1;
  f->s.x = (int16_t)(f->x - act.cam.bgX);
  f->s.y = (int16_t)(f->y - act.cam.bgY);
  f->s.oamFlags = 31 << 6;
  for (int flip = 0; flip < 4; flip++) {
    f->s.frameFlags = (uint16_t)((f->s.frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_PRIORITY)) | (3 << 12)
      | (flip & 1 ? SPRITE_X_FLIP : 0) | (flip & 2 ? SPRITE_Y_FLIP : 0));
    display_sprite(&f->s);
  }
}

// the card's frames, where no picture is drawn: the fireworks' states carry on, but nothing goes to OAM
static void fireworks_pre(void) {
  for (int i = 0; i < FIREWORKS; i++) {
    Firework *f = &fireworks[i];
    if (f->done) continue;
    if (!update_sprite(&f->s, 0)) f->ended = 1;
  }
}

static void create_firework(int x, int y, int small) {
  for (int i = 0; i < FIREWORKS; i++) {
    Firework *f = &fireworks[i];
    if (!f->done) continue;   // already showing
    f->done = 0; f->ended = 0; f->x = x; f->y = y;
    sprite_init(&f->s);
    f->s.graphics.anim = (uint16_t)(small ? 483 : 482);
    f->s.graphics.dest = vram_malloc((uint32_t)sprite_tiles(small ? 483 : 482, 0, 0));   // each its own tiles
    f->s.variant = 0; f->s.animSpeed = 0x10; f->s.palId = 0;
    create_task(firework_task, f, FIREWORK_PRIORITY, 0, NULL);
    return;
  }
}

// BACKGROUND_UPDATE.casinoParadise: on every 4th frame of the stage clock, a draw of the game's random numbers with
// bits 8-10 clear sets a firework off at x - 8 … 247 and y - 32 … 95 in the background map
static void casino_background_update(void) {
  int camX = (int)act.cam.x - act.cam.wrapped;
  act.cam.bgX = fdiv(camX << 4, act.stage.width - SCREEN_W_);
  act.cam.bgY = fdiv(((int)act.cam.y << 6) + ((int)act.cam.y << 5), act.stage.height - SCREEN_H_);
  if ((act.tick & 3) != 0 || (act_random() & 0x700) != 0) return;
  int x = (int)((act_random() & 0xFF00) >> 8) - 8;
  int y = (int)((act_random() & 0x7F00) >> 8) - 32;
  create_firework(x, y, (act_random() & 0x100) != 0);
}

static void act_frame(void) {
  if (musicSync) {
    musicSync = 0;
    // the act's music starts on the frame after its first picture: the frames before the recording's first one are the
    // act's first 15 off the count, leaving 96, each the samples a frame holds
    long long played = 0;
    for (int i = 0; i < act.tick - 15; i++) {
      int count = (int)((played + 1) * 109725 / 100 - played * 109725 / 100);
      played++;
      dp_sound_render(count);
    }
  }
  if (act.tick == 0) {
    // the first frame takes the screen from the course select or the act before, whose sprites go with it, those drawn
    // earlier this frame too
    clear_oam();
  }
  if (act.cardDone && !act.hud.active && act.started) {
    hud_load();
    act.hud.active = 1;
    act.hud.flash = act.stage.level == ACT_LEVEL_NEO_GREEN_2 ? (act.stage.hudFlash + 7) & 31 : hud_flash();
    actHudFlash = -1;
  }
  // the camera's task first runs on the frame after the one that makes the act, where it only sets itself going
  // (Task_CallUpdateCamera), and counts the animated tiles from the frame after that, in UpdateCamera
  int camRuns = act.cam.started && act.frames > 1;
  if (act.frames > 0) objects_run_before_camera();
  if (camera_update(&act.cam, &act.player)) act.cam.bgUpdates++;
  if (act.stage.backgroundScroll == BG_SCROLL_CASINO_PARADISE && act.cam.bgUpdates > 0) casino_background_update();
  // UpdateCamera's fnBgUpdate, which runs with its RenderMetatileLayers
  if (act.stage.backgroundScroll == BG_SCROLL_ICE_MOUNTAIN && camRuns) ice_mountain_background_update((int)act.cam.x, (int)act.cam.y);
  if (camRuns || (act.stage.level == ACT_LEVEL_NEO_GREEN_1 && act.frames > 0)) { if (act.stage.level == ACT_LEVEL_NEO_GREEN_2) neo_stage_animation_step(); else animate_stage_tiles(); }
  // the objects' tasks first run on the frame after the one that makes the act, which is where the rings' spin starts;
  // those from the HUD's priority on run after it, below
  int objectsRun = act.frames > 0 || act.stage.level == ACT_LEVEL_NEO_GREEN_1;
  if (objectsRun) objects_run_before_hud();
  // the title card's task (0x2100) runs before Sonic's and the clock's, so the frame it ends frees the pad and starts
  // the clock; its pieces and fade go over the act, and it sets the display while it shows, after draw_frame
  int cardShows = !act.cardDone;
  if (cardShows) card_update((e.pressed & (KEY_A | KEY_B | KEY_UP | KEY_DOWN | KEY_LEFT | KEY_RIGHT)) != 0);
  // the results' task (0x2100) and its pieces' (0x2120); the frame they end, the next act takes over
  if (results_active() && !results_run()) { go_to_next_level(); return; }
  // the HUD's task runs before Sonic's and before the clock, as the original makes it (0x2180), and the objects' tasks from
  // its priority after it, so an icicle (0x2200) that hurts Sonic takes his rings after the HUD has shown them
  if (act.cardDone) hud_update(1);
  if (objectsRun) objects_run_after_hud();
  PlayerInput in = {
    .left = (e.input & KEY_LEFT) != 0, .right = (e.input & KEY_RIGHT) != 0,
    .up = (e.input & KEY_UP) != 0, .down = (e.input & KEY_DOWN) != 0,
    .jump = (e.input & KEY_A) != 0, .attack = (e.input & KEY_B) != 0,
    .jumpPressed = (e.pressed & KEY_A) != 0, .attackPressed = (e.pressed & KEY_B) != 0,
  };
  // the title card holds Sonic with jump and attack held, never pressed, and ignores the pad
  if (!act.cardDone) { in.left = in.right = in.up = in.down = 0; in.jump = in.attack = 1; }
  // the buttons held on the card's last frame, when Sonic takes the controls, aren't presses
  if (cardShows) in.jumpPressed = in.attackPressed = 0;
  // the start point's first frame reads the right and A the original has held there, never pressed
  if (act.firstFrame) {
    in.left = 0; in.right = 1; in.jump = 1; in.attack = 0; in.jumpPressed = 0; in.attackPressed = 0;
    act.firstFrame = 0;
  }
  // an object holding him takes the pad from him: he reads nothing held or pressed, or only right held as the goal post
  // gives him to run off (HOLD_RIGHT)
  if (act.player.ignoreInput)
    in = act.player.heldRight ? (PlayerInput){ .right = 1 } : act.player.heldLeft ? (PlayerInput){ .left = 1 } : (PlayerInput){0};
  player_step(&act.player, &in);
  // the start point's first act frame is the held A's jump, one frame after it began
  if (act.drawn == 0 && act.stage.level == ACT_LEVEL_CASINO_PARADISE_2 && gba_start_number("jump", 0)) player_start_jump(&act.player);
  player_animate(&act.player, &in);
  if (act.stage.level == ACT_LEVEL_NEO_GREEN_2)
    for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
  if (act.frames > 0 || act.stage.level == ACT_LEVEL_NEO_GREEN_1) objects_run_late();
  // what the music manager reads of Sonic (0x4000)
  const Player *sonic = &act.player;
  music_call(MUSIC_PLAYER, (sonic->invincible > 0) | (sonic->speedUp > 0) << 1 | !sonic->dead << 2);
  // the stage clock's task (0xFF00): the course time counts once the card has ended, the stage's tick every frame
  if (!act.clockStopped) act.courseTime++;
  act.tick++;
  // the water's task (0xFFFE), after the clock's
  if (act.frames > 0) water_task();
  act.frames++;
  draw_frame();
  // Secret Base act 1's spotlights' tasks run after the objects and before the screen is drawn, and write the windows
  // and the brightness decrease into this frame's registers and H-blank table
  if (act.stage.level == ACT_LEVEL_SECRET_BASE_1) spotlights_frame();
  if (cardShows) titlecard_display();
  results_display();
}

// the act's music, as the course select leaves it: the stage music manager (Task_StageMusicManager, priority 0x4000)
// starts it on the frame the act is made, as no song plays, and fades it in (MusManager_UpdateBgmParams). After the act
// before (GoToNextLevel) it starts at full volume, as the JavaScript's startNextAct has it
static void start_music(void) {
  if (!act.musicStarts) return;
  act.musicStarts = 0;
  music_call(act.afterLevel ? MUSIC_STAGE : MUSIC_STAGE_IN, act.stage.music);
}

static void act_loaded(void) {
  // the palette animations first run on the frame after the load, as the original makes them
  start_palette_animations();
  act_frame();
}

void act_task(Task *t) {
  (void)t;
  if (act.loadFrames) {
    // the next act after GoToNextLevel loads: on these frames the act's own tasks wait, but those at the objects'
    // priority already run, its palette animations from the first, and the screen keeps the act's first frame
    if (act.loadFrames-- == NEXT_LEVEL_LOAD) start_palette_animations();
    objects_run_early();
    return;
  }
  if (act.stallLoad) {
    // the frame the act takes to load: it skips its V-blank, so the screen and the palette keep the frame before
    int frames = act.stallLoad;
    act.stallLoad = 0;
    start_music();
    engine_stall(frames, act_loaded);
    return;
  }
  act_frame();
}

/** Keeps the screen black for this frame, as a menu's last frame is, while the act's first picture waits for the
 *  next one. */
void act_hold_black(void) {
  holdColour = e.bgPalette[0];
  e.dispCnt = 0;
  e.bgPalette[0] = 0;
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  restoreColour = 1;
}

/** Draws the act's first frame now, for a screen that hands over inside its own task: it does its work but the
 *  frame has no V-blank, so the screen keeps the course select's black while the act loads. */
void act_frame_now(void) {
  act_frame();
  start_music();
  if (act.task) destroy_task(act.task);
  act.task = create_task(act_task, NULL, 0x0F00, 0, NULL);
  // an act a start point opens has loaded in the card's frames it ran with no picture, so it goes straight on
  act.stallLoad = gba_start_point("level") == NULL;
}

static int pendingLevel, pendingCard, pendingPre;
static void act_begin_task(Task *t) {
  destroy_task(t);
  act_start(pendingLevel, pendingCard, pendingPre);
  act_frame();
  // the stage init starts the act's song as the menu leaves, as act_frame_now does for a menu that hands over inside
  // its own task
  start_music();
}

/** Starts the act on the next frame, so the frame the menu hands over still draws the menu. */
void act_queue(int level, int cardSkip, int preFrames) {
  pendingLevel = level; pendingCard = cardSkip; pendingPre = preFrames;
  create_task(act_begin_task, NULL, 0x0F00, 0, NULL);
}

/** The title card's frames before the first one the recording compares, run with no picture. */
static void pre_run(int cardSkip, int preFrames, int prelude) {
  // the course select's frames before the card, which a start point at the A leaves out: the stage clock, the
  // background and the fireworks' random numbers run through them, as the original's do; the card and its palette
  // animations start after them
  for (int i = 0; i < prelude; i++) {
    int camRuns = act.cam.started && act.tick > 1;
    if (camera_update(&act.cam, &act.player)) act.cam.bgUpdates++;
    if (camRuns) animate_stage_tiles();
    if (act.stage.level == ACT_LEVEL_CASINO_PARADISE_2 && act.cam.bgUpdates > 0) { casino_background_update(); fireworks_pre(); }
    act.tick++;
    engine_copy_graphics();
  }
  int after = 0;
  objects_set_drawing(0);
  // the palette animations are made with the act, so they run through the card's frames
  start_palette_animations();
  while (!act.cardDone || after < preFrames) {
    if (act.cardDone && act.stage.level != ACT_LEVEL_NEO_GREEN_2) {
      // the frames after the card only settle the HUD's task, which starts as the card ends: the stage keeps the frame it
      // ended on, and only the clock and the HUD move on
      if (!act.clockStopped) act.courseTime++;
      hud_update(0);
      after++;
      continue;
    }
    int wasDone = act.cardDone;
    int loading = act.tick == 0;
    // as in act_frame: the camera counts the animated tiles, and the objects run, from the frames after the act is made
    int camRuns = act.cam.started && act.tick > 1;
    if (camera_update(&act.cam, &act.player)) act.cam.bgUpdates++;
    if (act.stage.level == ACT_LEVEL_CASINO_PARADISE_2 && act.cam.bgUpdates > 0) { casino_background_update(); fireworks_pre(); }
    if (camRuns || (act.stage.level == ACT_LEVEL_NEO_GREEN_1 && act.tick > 0)) {
      if (act.stage.level == ACT_LEVEL_NEO_GREEN_2) { if (act.tick >= 17) neo_stage_animation_step(); }
      else animate_stage_tiles();
    }
    if (act.tick > 0) objects_run_early();
    int cardWasDone = act.cardDone;
    card_update(cardSkip == act.tick);
    int cardJustEnded = !cardWasDone && act.cardDone;
    if (act.stage.level == ACT_LEVEL_NEO_GREEN_2) {
      if (cardJustEnded) {
        act.hud.active = 1;
        act.hud.flash = (act.stage.hudFlash + 7) & 31;
        hud_load();
      }
    } else if (act.cardDone && !act.hud.active) {
      // the card's last frame makes the HUD (CreateStageUI), which loads its tiles and colours at once, before the tasks
      // after the card's run: Secret Base act 1's beams then write past their table into the colours it loaded
      act.hud.active = 1;
      act.hud.flash = hud_flash();
      actHudFlash = -1;
      hud_load();
    }
    // the card holds Sonic with jump and attack held, as act_frame does
    PlayerInput in = { .jump = 1, .attack = 1 };
    player_step(&act.player, &in);
    if (act.stage.level != ACT_LEVEL_NEO_GREEN_2 || act.tick >= 15) player_animate(&act.player, &in);
    if (act.tick > 0) objects_run_late();
    if (act.stage.level != ACT_LEVEL_NEO_GREEN_2 || act.tick >= 16)
      for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
    water_card_flush();   // the card's part in the water, after the palette animations as in the task list
    // Secret Base act 1's spotlights are made on the frame after the stage's load
    if (act.stage.level == ACT_LEVEL_SECRET_BASE_1 && !loading) spotlights_frame();
    if (!act.clockStopped && !(act.stage.level == ACT_LEVEL_NEO_GREEN_2 && cardJustEnded)) act.courseTime++;
    if (wasDone && act.stage.level == ACT_LEVEL_NEO_GREEN_2) {
      // Neo Green Hill act 2 keeps stepping the act through the frames after its card, as its first recording starts
      // there: the HUD's zero-ring flash starts with the card's end, and the frames count towards the act's clock
      hud_update(0);
      after++;
    }
    act.tick++;
    // these frames have no V-blank, so what each one queued for video memory goes in now, and the V-blank's
    // ClearOamBufferDma swaps the two H-blank tables, but for the stage's load, whose V-blank the original spends still
    // loading. Which table is shown matters to Secret Base act 1's spotlights, whose lines past the second one run into
    // Sonic's colours.
    engine_copy_graphics();
    if (!loading && !(e.flags & FLAGS_KEEP_HBLANK_BUFFER)) e.primary ^= HBLANK_BUFFER;
  }
  // the card's last frame steps the palette animations once, as the original's does; the ones whose longer delays
  // put them behind the original step again, and the ring starts two frames into the act
  if (act.stage.level == ACT_LEVEL_CASINO_PARADISE_2) {
    static const int behind[] = { 0, 1, 3, 8, 10 };
    for (unsigned k = 0; k < sizeof behind / sizeof behind[0]; k++) {
      paletteAnims[behind[k]].wait = 0;
      palette_animation_step(&paletteAnims[behind[k]]);
    }
    // animation 818's palette 1, the striped columns' colours, changes five frames later than the card leaves it
    paletteAnims[2].wait -= 5 * 256;
    paletteAnims[0].wait -= 512;
    paletteAnims[10].wait -= 512;
    static const int next[] = { 4, 5, 6, 7, 9 };
    for (unsigned k = 0; k < sizeof next / sizeof next[0]; k++) paletteAnims[next[k]].wait = 256;
    rings_start_point();
  }
  objects_set_drawing(1);
}

// the stage music manager starts the act's song only while the music player plays none: the character select's leave
// starts it itself, as the stage init does, and the manager leaves it be
static int songPlaying;
void act_song_playing(void) { songPlaying = 1; }

// where an act's SoundMain starts in the chip's frame, after the act's V-blank work, measured on
// sonic-ice-mountain-act-2; the menus' V-blanks do less, and their sound writes as it did before (#741)
#define ACT_SOUND_MAIN_AT 52550

void act_start(int level, int cardSkip, int preFrames) {
  gba_sound_psg_at(ACT_SOUND_MAIN_AT);
  memset(&act, 0, sizeof act);
  // gPseudoRandom is one sequence for the whole game: the act goes on with what the front left
  act.seed = 0;
  for (int i = 0; i < FIREWORKS; i++) fireworks[i].done = 1;
  copyCount = 0;
  load_stage(level);
  act.bgAnimFrame = 0; act.bgAnimShown = 0; act.bgAnimDelay = 0;
  player_init(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1; act.cardFrame = 0; act.bossFlash = 0;
  act.hud.active = 0; act.hud.flash = hud_flash();
  act.started = 0; act.drawn = 0;
  act.firstFrame = (int)gba_start_number("first", 0);
  e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
  e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
  e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;
  if (level == ACT_LEVEL_SECRET_BASE_1) spotlights_start();

  // the title card's graphics. An act a start point opens runs the card to its end and its few frames after it with
  // no picture, as its recording starts there; one the course select opens shows the card from its first frame
  // InitCamera's stage background (sStageBgInitProcedures) and the stage init's water (CreateStageWaterTask)
  water_create(-1, 0);
  if (ACT_IS_ICE_MOUNTAIN(level)) {
    enum { INITIAL_WATERLEVEL_ZONE_4_ACT_1 = 1546, INITIAL_WATERLEVEL_ZONE_4_ACT_2 = 1664 };
    ice_mountain_create_background();
    water_create(level == ACT_LEVEL_ICE_MOUNTAIN_1 ? INITIAL_WATERLEVEL_ZONE_4_ACT_1 : INITIAL_WATERLEVEL_ZONE_4_ACT_2, 0x7F207F20);
  }
  titlecard_start(level, ctx.character);
  objects_start(level, act.stage.paletteCount > 0);
  // Neo Green Hill act 1's palette animations start with the act, as its recording runs before the load stall
  if (level == ACT_LEVEL_NEO_GREEN_1) start_palette_animations();
  if (gba_start_point("level")) {
    if (level == ACT_LEVEL_NEO_GREEN_2) {
      pre_run(cardSkip, preFrames, (int)gba_start_number("prelude", 0));
      // the act has run its first frames with the card: its objects run from the first frame shown, where the card left
      // the camera
      act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
      act.frames = act.tick;
      // the stage's music manager, from its beginning at a sixty-fourth, fading in; the frames before the recording
      // are rendered at the first shown frame, as its own engine did
      music_call(MUSIC_STAGE_IN, act.stage.music);
      musicSync = 1;
      act.bgAnimDelay = 5;
      rings_act2_prepare();
      neo_stage_animation_copy(act.bgAnimFrame);
    } else if (level == ACT_LEVEL_CASINO_PARADISE_2) {
      // the stage init starts the act's song before the card; the start point runs those frames with no sound engine,
      // then skips the music the same way, and starts the held A's jump sound one frame before the first compared
      music_call(MUSIC_STAGE, act.stage.music);
      pre_run(cardSkip, preFrames, (int)gba_start_number("prelude", 0));
      act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
      act.frames = act.tick;
      gba_sound_frames_gone_by(227);
      int skip = (int)gba_start_number("skip", 232);
      int advance = (int)gba_start_number("jumpadv", 1);
      if (gba_start_number("jump", 0)) {
        dp_sound_skip_frames(skip - advance);
        play_song(SONG_JUMP);
        dp_sound_skip_frames(advance);
      } else dp_sound_skip_frames(skip);
    } else {
      pre_run(cardSkip, preFrames, (int)gba_start_number("prelude", 0));
      // the act has run its first frames with the card: its objects run from the first frame shown, where the card left
      // the camera
      act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
      act.frames = act.tick;
      // the act's music starts with the act, fading in as the course select leaves it (MusManager_UpdateBgmParams,
      // music.js stageMusicIn): the card's frames of it play at once, unheard, so it goes on from where the original's is
      music_call(MUSIC_STAGE_IN, act.stage.music);
      gba_sound_played_for(act.tick);
      gba_sound_frames_gone_by(118);
    }
  } else act.musicStarts = !songPlaying;
  songPlaying = 0;
  // the HUD the card's last frame made has its graphics already
  if (act.cardDone && !act.hud.active) hud_load();
  act.hud.active = act.cardDone ? 1 : 0;
  act.started = 1;
  act.task = create_task(act_task, NULL, 0x0F00, 0, NULL);
}
