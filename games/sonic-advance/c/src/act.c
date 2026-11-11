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

enum { OFFSET_COLLISION = 0x4A6DA4, OFFSET_SPAWNS = 0x4A6DEC, OFFSET_LOOP_POINTS = 0x4A6E74, OFFSET_LOOP_SHIFTS = 0x4A6EBC };
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
void act_render_music_at_first_frame(void) { musicSync = 1; }
static uint16_t holdColour; static int restoreColour;   // the menu's black for the act's first picture

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
  const Level *row = level_row(level);
  memset(s, 0, sizeof *s);
  s->level = level; s->row = row;
  s->front = read_tilemap(level * 3 + 0);
  s->back = read_tilemap(level * 3 + 1);
  s->background = read_tilemap(level * 3 + 2);
  s->collision = read_collision(level);
  s->spawnX = rom_s16(OFFSET_SPAWNS + level * 4);
  s->spawnY = rom_s16(OFFSET_SPAWNS + level * 4 + 2);
  s->loopX = rom_s16(OFFSET_LOOP_POINTS + level * 4);
  s->loopShift = rom_s16(OFFSET_LOOP_SHIFTS + level * 4);
  s->width = s->collision.width; s->height = s->collision.height;
  // the stage init: the level's zone and act (LEVEL_TO_ZONE and LEVEL_TO_ACT), and what its row has for it
  s->zone = level >> 1; s->act = level & 1; s->music = row->song; s->hudFlash = row->hudFlash;
  s->paletteCount = row->paletteCount; s->paletteAnimations = row->palettes; s->paletteVariants = row->paletteVariants;
  s->cameraStop = row->cameraStop;
  // the front layer's tiles, in the first character block, and the stage's 256 colours (extractStage's palette)
  copy_rom(s->front.tiles, 0, s->front.tilesSize);
  for (int i = 0; i < 256; i++) e.bgPalette[i] = (uint16_t)rom_u16(s->front.palette + i * 2);
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  // the background's tiles at the second character block, and its map (DrawBackground, copy_backgrounds)
  copy_rom(s->background.tiles, 0x8000, s->background.tilesSize);
  // The map goes into the screen BG3CNT names, a row of 32 tiles after another. A screen 512 px wide is two 32-tile
  // blocks side by side, as X Zone's 37 × 23 map needs; Secret Base act 2 takes the first 32 × 32 of its map, and Ice
  // Mountain the first 32 × 64 (sStageBgDimensions)
  uint32_t screen = (uint32_t)((row->bgCnt >> 8) & 31) * 0x800u;
  int wide = (row->bgCnt >> 14) & 1;
  for (int y = 0; y < s->background.yTiles; y++) {
    for (int x = 0; x < s->background.xTiles; x++) {
      if ((row->bgRows && y >= row->bgRows) || (row->bgCols && x >= row->bgCols)) continue;
      uint16_t entry = (uint16_t)rom_u16(s->background.map + (y * s->background.xTiles + x) * 2);
      uint32_t at = wide ? (x < 32 ? screen + (uint32_t)x * 2u : screen + 0x800 + (uint32_t)(x - 32) * 2u) + (uint32_t)y * 64u
                         : screen + (uint32_t)(y * 32 + x) * 2u;
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
  e.bgCnt[3] = row->bgCnt;
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
void act_palette_step(PaletteAnim *p) { palette_animation_step(p); }
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
    if (!act.stage.row->palettesAfterSonic) create_task(palette_animation_task, &paletteAnims[i], 0x2000, 0, NULL);
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
  c->x = (int)__builtin_floor(p->x) - SCREEN_W / 2;
  c->y = (int)__builtin_floor(p->y) - (SCREEN_H / 2 + 4);
  c->targetX = c->x; c->targetY = c->y;
  c->offsetY = p->offsetY - 4;
  c->minX = 0; c->minY = 0;
  c->maxX = act.stage.width - (act.stage.cameraStop ? act.stage.cameraStop : SCREEN_W); c->maxY = act.stage.height - SCREEN_H;
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
    c->targetX = (int)__builtin_floor(p->x) + c->shiftX - SCREEN_W / 2;
    int want = (p->offsetY - 4) * (p->inverted ? -1 : 1);
    if (c->offsetY < want) c->offsetY = c->offsetY + 5 < want ? c->offsetY + 5 : want;
    else if (c->offsetY > want) c->offsetY = c->offsetY - 5 > want ? c->offsetY - 5 : want;
    c->targetY = (int)__builtin_floor(p->y) + c->shiftY - SCREEN_H / 2 + c->look + c->offsetY;
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
      if (act.stage.row->zeroFlashesInSixteens) {
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
static void late_tiles_copy(int frame);
static void late_tiles_step(void);
static void late_tiles_draw(void);

static void draw_frame(void) {
  const Level *row = act.stage.row;
  if (restoreColour) { restoreColour = 0; e.bgPalette[0] = holdColour; e.flags |= FLAGS_UPDATE_BG_PALETTES; }
  // the first picture the screen shows keeps the layers where the act started, before the camera's first move
  int hold = act.frames <= 2 && !act.afterLevel;
  int camX = hold ? act.startCamX : (int)act.cam.x;
  int camY = hold ? act.startCamY : (int)act.cam.y;
  // the act has no blend, and its first frames keep the course select's display, as the original does
  // (Ice Mountain's background update sets its blend in the camera's task, which the title card's end clears)
  if (!row->ownsBlend) { e.bldCnt = 0; e.bldAlpha = 0x0010; }
  e.bldY = 0;
  e.dispCnt = 0x1E40;
  e.winRegs[0] = e.winRegs[1] = 0x00F0;
  if (!row->ownsWindows) e.winRegs[2] = e.winRegs[3] = 0x00A0;
  // a boss's task clears the blending, while Sonic is alive (sub_80308A4)
  if (act.blendOff) { e.winRegs[5] = 0; e.bldCnt = 0; e.bldY = 0; act.blendOff = 0; }
  // a hit boss's flash: the OBJ window on, everything in it brightened all the way (sub_802D870)
  if (act.bossFlash) { e.dispCnt |= 0x8000; e.winRegs[5] = 0x3F1F; e.bldCnt = 0xBF; e.bldY = 0x10; }
  act.drawn++;
  // RenderMetatileLayers: BG1 and BG2 scroll by the camera's sub-tile part, their maps filled from the metatiles
  e.bgScroll[2] = (uint16_t)(camX & 7); e.bgScroll[3] = (uint16_t)(camY & 7);
  e.bgScroll[4] = (uint16_t)(camX & 7); e.bgScroll[5] = (uint16_t)(camY & 7);
  if (row->tilesShownLate) late_tiles_draw();
  // the camera's task draws the layers before the player's task wraps the loop, so the frame of a wrap keeps the map of
  // where the camera was before it; the scroll, a multiple of 8 px back, is the same as after it
  int layerX = camX - act.cam.wrappedThisFrame;
  fill_layer(0xF000, LAYER_FRONT, layerX, camY);
  fill_layer(0xF800, LAYER_BACK, layerX, camY);
  // the zone's StageBgUpdate
  if (row->drawBackground) row->drawBackground(camX, camY);

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

// The front layer's animation for an act whose row shows its tiles late (background.c UpdateBgAnimationTiles): frame 0
// is the tileset itself; frame k is the k-th block after its static part. The screen shows the frame from before this
// one's step, as its copy lands at the next V-blank.
static void late_tiles_copy(int frame) {
  const Tilemap *t = &act.stage.front;
  if (!t->animTileSize || !t->animFrameCount) return;
  uint32_t src = frame == 0 ? t->tiles : t->tiles + t->tilesSize + (uint32_t)(frame - 1) * t->animTileSize;
  if (src + t->animTileSize <= gba_rom_size) memcpy(gba_vram, gba_rom + src, t->animTileSize);
}
static void late_tiles_step(void) {
  const Tilemap *t = &act.stage.front;
  if (!t->animTileSize || !t->animFrameCount) return;
  act.bgAnimShown = act.bgAnimFrame;
  if (++act.bgAnimDelay < (t->animDelay ? t->animDelay : 1)) return;
  act.bgAnimDelay = 0;
  if (++act.bgAnimFrame >= t->animFrameCount) act.bgAnimFrame = 0;
}
static void late_tiles_draw(void) {
  late_tiles_copy(act.bgAnimShown);
}
void act_copy_tiles(int frame) { late_tiles_copy(frame); }

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
  // Dreamport's recordings that skip the character select still find them there, but in an act whose row has them blank
  if (act.stage.row->blankZeroTiles) memset(gba_vram + OBJ_VRAM + (HUD_WHITE - 64) * 32, 0, 2 * 32);
  else {
    uint32_t leftTiles, leftPalette;
    ui_graphics(39, &leftTiles, &leftPalette, &layout);
    copy_rom(leftTiles + 19 * 32, OBJ_VRAM + (HUD_WHITE - 64) * 32, 2 * 32);
  }
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[i] = (uint16_t)rom_u16(facePalette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

int act_stage_time(void) { return act.tick - act.stage.row->stageClockAhead; }

uint32_t act_random(void) {
  if (act.stage.row->sharedRandom) return front_random();
  return act.seed = act.seed * 0x196225u + 0x3C6EF35Fu;
}

void act_random_seed(uint32_t seed) {
  if (act.stage.row->sharedRandom) front_random_seed(seed);
  else act.seed = seed;
}

// where the act's random numbers are, in whichever sequence it draws from
static uint32_t act_random_state(void) { return act.stage.row->sharedRandom ? ctx.seed : act.seed; }

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
  if (level != LEVEL_X_ZONE && save_unlocked_level(0) < level + 1) save_set_unlocked_level(0, (uint16_t)(level + 1));
  results_start(level, act.ringCount, act.courseTime, level == LEVEL_X_ZONE, 0);
}

// GoToNextLevel, once the save is written: the next act, made inside the task as the course select makes one, with the
// score, the lives and the game's random numbers carried over (GameStageStart leaves them). Its first frame runs at
// once, then it loads for NEXT_LEVEL_LOAD frames (act_task). A next act that isn't in C yet stops the game there, with
// the screen as it was, as the front end does (front.c), rather than load with another act's music and background
enum { NEXT_LEVEL_LOAD = 2 };
static int nextLevel;
static void next_act(void) {
  if (!level_in_c(nextLevel)) { act_active = 0; ctx.done = 1; return; }
  int lives = act.lives, score = act.score;
  // gPseudoRandom goes on from the act before, whichever of the C's two sequences that act drew from
  uint32_t seed = act_random_state();
  act_start(nextLevel, -1, 0);
  act.lives = lives; act.score = score;
  act_random_seed(seed);
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

// the HUD starts: its zero-ring flash from the act's own value, or where a counter that flashes in sixteens begins
static void hud_begin(void) {
  act.hud.active = 1;
  act.hud.flash = act.stage.row->zeroFlashesInSixteens ? (act.stage.hudFlash + 7) & 31 : hud_flash();
}

static void act_frame(void) {
  const Level *row = act.stage.row;
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
    hud_begin();
    actHudFlash = -1;
  }
  // the camera's task first runs on the frame after the one that makes the act, where it only sets itself going
  // (Task_CallUpdateCamera), and counts the animated tiles from the frame after that, in UpdateCamera
  int camRuns = act.cam.started && act.frames > 1;
  if (act.frames > 0) objects_run_before_camera();
  if (camera_update(&act.cam, &act.player)) act.cam.bgUpdates++;
  // UpdateCamera's fnBgUpdate
  if (row->cameraMoved) row->cameraMoved(camRuns);
  if (camRuns || (row->runsFromFirstFrame && act.frames > 0)) { if (row->tilesShownLate) late_tiles_step(); else animate_stage_tiles(); }
  // the objects' tasks first run on the frame after the one that makes the act, which is where the rings' spin starts;
  // those from the HUD's priority on run after it, below
  int objectsRun = act.frames > 0 || row->runsFromFirstFrame;
  if (row->beforeObjects) row->beforeObjects();
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
  // a start point's first act frame is the held A's jump, one frame after it began, when it has the word for it
  if (act.drawn == 0 && act.fromStartPoint && gba_start_number("jump", 0)) player_start_jump(&act.player);
  player_animate(&act.player, &in);
  if (row->palettesAfterSonic)
    for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
  if (act.frames > 0 || row->runsFromFirstFrame) objects_run_late();
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
  if (row->afterFrame) row->afterFrame(1);
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
  act.stallLoad = !act.fromStartPoint;
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
  const Level *row = act.stage.row;
  // the course select's frames before the card, which a start point at the A leaves out: the stage clock, the
  // background and the fireworks' random numbers run through them, as the original's do; the card and its palette
  // animations start after them
  for (int i = 0; i < prelude; i++) {
    int camRuns = act.cam.started && act.tick > 1;
    if (camera_update(&act.cam, &act.player)) act.cam.bgUpdates++;
    if (camRuns) animate_stage_tiles();
    if (row->cardFrame) row->cardFrame();
    act.tick++;
    engine_copy_graphics();
  }
  int after = 0;
  objects_set_drawing(0);
  // the palette animations are made with the act, so they run through the card's frames
  start_palette_animations();
  while (!act.cardDone || after < preFrames) {
    if (act.cardDone && !row->cardStepsOn) {
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
    if (row->cardFrame) row->cardFrame();
    if (camRuns || (row->runsFromFirstFrame && act.tick > 0)) {
      // tiles shown late count from the card's 17th frame
      if (row->tilesShownLate) { if (act.tick >= 17) late_tiles_step(); }
      else animate_stage_tiles();
    }
    if (act.tick > 0) objects_run_early();
    int cardWasDone = act.cardDone;
    card_update(cardSkip == act.tick);
    int cardJustEnded = !cardWasDone && act.cardDone;
    if (act.cardDone && !act.hud.active) {
      // the card's last frame makes the HUD (CreateStageUI), which loads its tiles and colours at once, before the tasks
      // after the card's run: a task of the act's own that writes past its table then finds the colours it loaded. An
      // act that steps on after its card keeps the flash the menu handed over for the act after it
      hud_begin();
      if (!row->cardStepsOn) actHudFlash = -1;
      hud_load();
    }
    // the card holds Sonic with jump and attack held, as act_frame does; a task made before the objects reads him first
    if (row->beforeObjects && !loading) row->beforeObjects();
    PlayerInput in = { .jump = 1, .attack = 1 };
    player_step(&act.player, &in);
    // a card with its own timing starts Sonic's animation on its 15th frame and the palette animations on its 16th
    if (!row->cardStepsOn || act.tick >= 15) player_animate(&act.player, &in);
    if (act.tick > 0) objects_run_late();
    if (!row->cardStepsOn || act.tick >= 16)
      for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
    water_card_flush();   // the card's part in the water, after the palette animations as in the task list
    if (row->afterFrame && !loading) row->afterFrame(0);
    if (!act.clockStopped && !(row->cardStepsOn && cardJustEnded)) act.courseTime++;
    if (wasDone && row->cardStepsOn) {
      // the act keeps stepping through the frames after its card, as its first recording starts there: the HUD's
      // zero-ring flash starts with the card's end, and the frames count towards the act's clock
      hud_update(0);
      after++;
    }
    act.tick++;
    // these frames have no V-blank, so what each one queued for video memory goes in now, and the V-blank's
    // ClearOamBufferDma swaps the two H-blank tables, but for the stage's load, whose V-blank the original spends still
    // loading. Which table is shown matters to Secret Base act 1's spotlights, whose lines past the second one run into
    // Sonic's colours.
    engine_copy_graphics();
    spriteRow.loaded = 0;
    if (!loading && !(e.flags & FLAGS_KEEP_HBLANK_BUFFER)) e.primary ^= HBLANK_BUFFER;
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

static int startPointSpent;   // a start point has opened its act, so the acts after it start as the game starts them

void act_start(int level, int cardSkip, int preFrames) {
  gba_sound_psg_at(ACT_SOUND_MAIN_AT);
  memset(&act, 0, sizeof act);
  act.fromStartPoint = gba_start_point("level") != NULL && !startPointSpent;
  startPointSpent |= act.fromStartPoint;
  // gPseudoRandom is one sequence for the whole game: the act goes on with what the front left
  act.seed = 0;
  copyCount = 0;
  load_stage(level);
  const Level *row = act.stage.row;
  act.bgAnimFrame = 0; act.bgAnimShown = 0; act.bgAnimDelay = 0;
  player_init(&act.player, act.stage.spawnX, act.stage.spawnY);
  create_camera(&act.cam, &act.player);
  act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
  act.lives = 3; act.score = 0; act.ringCount = 0;
  act.clockStopped = 1; act.firstCard = 1; act.cardFrame = 0; act.bossFlash = 0;
  act.hud.active = 0; act.hud.flash = hud_flash();
  act.started = 0; act.drawn = 0;
  act.firstFrame = act.fromStartPoint ? (int)gba_start_number("first", 0) : 0;
  e.bldCnt = 0; e.bldAlpha = 0; e.bldY = 0;
  e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
  e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;

  // the title card's graphics. An act a start point opens runs the card to its end and its few frames after it with
  // no picture, as its recording starts there; one the course select opens shows the card from its first frame
  // InitCamera's stage background (sStageBgInitProcedures) and the stage init's own tasks, after the water is gone: an
  // act with water makes it there (CreateStageWaterTask)
  water_create(-1, 0);
  if (row->start) row->start();
  titlecard_start(level, ctx.character);
  objects_start(level, act.stage.paletteCount > 0);
  if (row->runsFromFirstFrame) start_palette_animations();
  if (act.fromStartPoint) {
    // a start point opens the act past its card: the card's frames run with no picture, with what the act's row does
    // before and in them
    if (row->cardStarts) row->cardStarts();
    // gFrameCount counts every frame the original runs, those a start point leaves out too (the menus' and the card's,
    // the recording's onlyInOriginal stretches): `only` names how many, so the act goes on from the original's count
    e.frameCount += (uint32_t)gba_start_number("only", 0);
    pre_run(cardSkip, preFrames, (int)gba_start_number("prelude", 0));
    // the act has run its first frames with the card: its objects run from the first frame shown, where the card left
    // the camera
    act.startCamX = (int)act.cam.x; act.startCamY = (int)act.cam.y;
    act.frames = act.tick;
    if (row->cardEnded) row->cardEnded();
    else {
      // the act's music starts with the act, fading in as the course select leaves it (MusManager_UpdateBgmParams,
      // music.js stageMusicIn): the card's frames of it play at once, unheard, so it goes on from where the original's is
      music_call(MUSIC_STAGE_IN, act.stage.music);
      gba_sound_played_for(act.tick + 1);
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
