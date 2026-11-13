// X Zone's act in C: its stage and collision from the player's copy, the camera, Sonic on the ground, the HUD, and
// the title card's state without its pictures. Translated from the JavaScript version's engine/game.js,
// engine/player.js, engine/camera.js, engine/terrain.js, engine/stage.js, engine/hud.js and rom/extract.js, a
// function at a time; every comment names the original's function where one is rewritten.

#include "objects.h"
#include "results.h"
#include "bosses.h"

int moon_opens(void);

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
// and after the act before it, where the original's counter stands as the HUD starts
enum { HUD_FLASH_AFTER = 1 };
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
// the act being started follows the one before it (GoToNextLevel), which its title card shows
static int comingOn;
static void load_stage(int level) {
  Stage *s = &act.stage;
  const Level *row = level_row(level);
  if (!act.fromStartPoint && row->played) row = row->played;
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
  uint32_t mapSize = ((row->bgCnt >> 14) == 3) ? 0x2000 : ((row->bgCnt >> 14) != 0) ? 0x1000 : 0x800;
  memset(gba_vram + screen, 0, mapSize);
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
// Knuckles floating on the water with up held looks up too (Player_8044750, Player_80447D8); his frames from a glide to
// its end ease the look once more (sub_8048980), 2 down or 4 up, and climbing up or down once more again (Player_8047280);
// his jump off the water leaves it as it is
static void update_look(Camera *c, const Player *p) {
  if (p->lookEase == LOOK_EASE_STILL) return;
  int up = p->state == PS_LOOK_UP || p->state == PS_WATER_FLOAT_UP;
  int looking = (up ? -LOOK_UP : p->state == PS_CROUCH && p->gsp == 0 ? LOOK_DOWN : 0) * (p->inverted ? -1 : 1);
  if (!looking) { c->lookDelay = LOOK_DELAY; ease_look_back(c); }
  else if (c->lookDelay == 0 || --c->lookDelay == 0) {
    if (looking < 0 && c->look + c->shiftY > looking) c->look -= LOOK_STEP;
    if (looking > 0 && c->look + c->shiftY < looking) c->look += LOOK_STEP;
  } else ease_look_back(c);
  if (p->lookEase == LOOK_EASE_GLIDE || p->lookEase == LOOK_EASE_CLIMB) c->look += c->look > 0 ? -2 : c->look < 0 ? 4 : 0;
  if (p->lookEase == LOOK_EASE_CLIMB) ease_look_back(c);
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
  // Knuckles floating on the water counts as on the ground
  int air = p->air && !(p->character == CHARACTER_KNUCKLES && p->midAir == KN_FLOAT);
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
    put_oam(ORDER_ICONS, 2, 144, OBJ_16x16, HUD_FACE, ctx.character, 0);
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
    int red = (act.timerReversed ? act.courseTime < 3600 : act.courseTime > 9 * 3600) && (act.tick & 0x10) ? 11 : 0;
    int sec = (act.courseTime / 60) % 60;
    int hundredths = (int)__builtin_floor((act.courseTime % 60) * 100.0 / 60.0 + 0.5);
    int t[7];
    if (act.courseTime >= 10 * 3600) { int q[7] = { 9, 10, 5, 9, 10, 9, 9 }; memcpy(t, q, sizeof t); }
    else { t[0] = act.courseTime / 3600; t[1] = 10; t[2] = sec / 10; t[3] = sec % 10; t[4] = 10; t[5] = hundredths / 10; t[6] = hundredths % 10; }
    for (int i = 0; i < 7; i++) hud_glyph(t[i] + red, 25 + i * 8, 12);
    int lives = act.lives > 9 ? 9 : act.lives == 0 ? 0 : act.lives - 1;
    hud_glyph(lives, 22, 143);
    if (act.timerReversed) {
      if (act.courseTime < 20 * 60 && act.courseTime % 60 == 0 && act.courseTime != 0) play_song(139);
    } else {
      if (act.courseTime > 9 * 3600 + 40 * 60 && act.courseTime < 10 * 3600 && act.courseTime % 60 == 0) play_song(139);
    }
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

// Sonic as his task (0x3000) left him: his sprite is drawn from this, so a task after his that moves or turns him, as a
// shot that hurts him or a hang bar, shows on the next frame's picture (drawSonic in engine/game.js)
static Player shown, partnerShown;
static int shownSet;
static void sonic_shown(void) { shown = act.player; shownSet = 1; }

static void draw_frame(void) {
  const Level *row = act.stage.row;
  if (restoreColour) { restoreColour = 0; e.bgPalette[0] = holdColour; e.flags |= FLAGS_UPDATE_BG_PALETTES; }
  // the first picture the screen shows keeps the layers where the act started, before the camera's first move
  int hold = act.frames <= 2 && !act.afterLevel;
  int camX = hold ? act.startCamX : (int)act.cam.x;
  int camY = hold ? act.startCamY : (int)act.cam.y;
  // the first frame after the act before draws the stage's layers from its corner, where its making left them; the
  // sprites are already where the camera has them
  int spriteX = camX, spriteY = camY;
  if (act.afterLevel && act.frames == 1) camX = camY = 0;
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
  if (act.bossFlash == BOSS_FLASH_WINDOW) { e.dispCnt |= 0x8000; e.winRegs[5] = 0x3F3F; }
  else if (act.bossFlash) { e.dispCnt |= 0x8000; e.winRegs[5] = 0x3F1F; e.bldCnt = 0xBF; e.bldY = 0x10; }
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

  player_draw(shownSet ? &shown : &act.player, spriteX, spriteY);
  // and the CPU partner as his task (0x3001) left him, just after Sonic
  if (act.hasPartner) player_draw(shownSet ? &partnerShown : &act.partner, spriteX, spriteY);
  shownSet = 0;
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

// UI graphics 39, which the character select loads into sprite VRAM from tile 1: its tiles 19 and 20 are the two a
// zero-ring count reads past its string on its first frame (sub_8053BAC). They stay there until the player's own frames
// write over them, as Tails' larger ones do on the card and Sonic's only later. The Dreamport's recordings that skip the
// character select still find them there, but in an act whose row has them blank. After the act before, the player's
// own frames have long been over them, and they stay his.
static void menu_leftovers(void) {
  // X Zone's first card leaves them blank only for Sonic
  if (act.stage.row->blankZeroTiles && ctx.character == CHARACTER_SONIC) { memset(gba_vram + OBJ_VRAM + (HUD_WHITE - 64) * 32, 0, 2 * 32); return; }
  uint32_t leftTiles, leftPalette;
  UiSlot layout;
  ui_graphics(39, &leftTiles, &leftPalette, &layout);
  copy_rom(leftTiles + 19 * 32, OBJ_VRAM + (HUD_WHITE - 64) * 32, 2 * 32);
}

// the HUD's tiles and colours (hudGraphics): the white and red digits, the ring and the face. The original loads
// them as the HUD starts, after the title card's frame, which is why the card's own palette 6 is loaded later too.
static void hud_load(void) {
  uint32_t fontTiles, fontPalette, faceTiles, facePalette, ringTiles, ringPalette;
  UiSlot layout;
  ui_graphics(0, &fontTiles, &fontPalette, &layout);
  ui_graphics(1 + ctx.character, &faceTiles, &facePalette, &layout);   // UIGFX_UI_ICON_SONIC + gSelectedCharacter
  ui_graphics(5, &ringTiles, &ringPalette, &layout);
  copy_rom(fontTiles + 32 * 32, OBJ_VRAM + HUD_WHITE * 32, 22 * 32);
  copy_rom(fontTiles + 224 * 32, OBJ_VRAM + HUD_RED * 32, 22 * 32);
  copy_rom(ringTiles, OBJ_VRAM + HUD_RING * 32, 16 * 32);
  copy_rom(faceTiles, OBJ_VRAM + HUD_FACE * 32, 4 * 32);
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(fontPalette + i * 2);
  for (int i = 0; i < 16; i++) e.objPalette[ctx.character * 16 + i] = (uint16_t)rom_u16(facePalette + i * 2);
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
// Task_PlayerHandleDeath's HandleLifeLost: his task ends, his rings and a life go, and with lives left every task goes and
// the act starts over at the end of it (restart_act), so nothing after it runs this frame. The last life brings the game
// over, with the act running on behind it; with no continue left, as the C has no special stages to earn one in
// (CreateGameOverScreen(OVER_CAUSE_TIME_UP))
static int lifeLost;
void act_life_lost(void) {
  if (lifeLost || act.playerGone) return;
  act.ringCount = 0;
  act.lives = (act.lives - 1) & 0xFF;
  if (act.lives != 0) { lifeLost = 1; return; }
  act.playerGone = 1;
  gameover_start();
}
// a frame of the course clock, where the act's task doesn't run it: gCheckpointTime counts up whichever way the clock goes
static void clock_step(void) {
  act.clockTime++;
  if (act.timerReversed) {
    if (--act.courseTime <= 0) act.courseTime = 0;
  } else act.courseTime++;
}

#define EGG_ROCKET_COUNTDOWN (3 * 3600)
// CreateStageResults, as the goal hands over: the act's rings into the save's ring bank and the next level unlocked
// (X Zone's way to the Moon Zone decides that itself, and isn't here yet), then the results' tasks, which first run
// this frame, after the goal's, or with `nextFrame` on the next one
void act_stage_results(int nextFrame) {
  int level = act.stage.level;
  save_add_ring_bank(act.ringCount);
  if (level != LEVEL_X_ZONE && save_unlocked_level(ctx.character) < level + 1)
    save_set_unlocked_level(ctx.character, (uint16_t)(level + 1));
  int courseTime = act.courseTime;
  if (level == LEVEL_EGG_ROCKET) {
    // the rocket's clock counts down, so the time bonus goes by the time the act took (gCheckpointTime), less the
    // countdown's 3:00; and the sky behind stops where it is
    egg_rocket_results();
    courseTime = act.clockTime <= EGG_ROCKET_COUNTDOWN ? 1 : act.clockTime - EGG_ROCKET_COUNTDOWN;
  }
  results_start(level, act.ringCount, courseTime, level == LEVEL_X_ZONE, nextFrame);
}

// GoToNextLevel, once the save is written: the next act, made inside the task as the course select makes one, with the
// score, the lives and the game's random numbers carried over (GameStageStart leaves them). Its first frame comes
// once it has loaded (act_task). A next act that isn't in C yet stops the game there, on
// the black the original's screen is while its stage loads, as the front end does (front.c), rather than load with
// another act's music and background
static void start_music(void);
void act_task(Task *t);
static int nextLevel;
static uint16_t lastObjects[128 * 4];
// the layers' maps (screens 28 to 31): a new zone's first loading frame shows the act before's, drawn with the new
// zone's tiles, as the original's does, and the new zone's are back from the next frame
#define LAYER_MAPS 0xE000
#define LAYER_MAPS_SIZE 0x1000
static uint8_t oldMaps[LAYER_MAPS_SIZE], newMaps[LAYER_MAPS_SIZE];
static int mapsShownOld;
// the frame after, once the screen has taken the black, the game stops
static void stop_on_black(Task *t) { destroy_task(t); ctx.done = 1; }
static void next_act(void) {
  if (!level_in_c(nextLevel)) {
    // and no fade over it, such as X Zone's white; its stage's song starts as it loads, as an act in C's does
    act_hold_black();
    e.bldCnt = 0; e.bldY = 0;
    music_call(MUSIC_STAGE, level_row(nextLevel)->song);
    act_active = 0;
    create_task(stop_on_black, NULL, 0x0F00, 0, NULL);
    return;
  }
  int lives = act.lives, score = act.score;
  // gPseudoRandom goes on from the act before, whichever of the C's two sequences that act drew from
  uint32_t seed = act_random_state();
  memcpy(oldMaps, gba_vram + LAYER_MAPS, LAYER_MAPS_SIZE);
  comingOn = 1;
  act_start(nextLevel, -1, 0);
  comingOn = 0;
  act.lives = lives; act.score = score;
  act_random_seed(seed);
  act.afterLevel = 1;
  act.musicStarts = 1;
  // the frame the stage is made on still shows the results' last sprites, in the new act's colours; none of its own
  // tasks has run
  start_music();
  if (act.task) destroy_task(act.task);
  act.task = create_task(act_task, NULL, 0x0F00, 0, NULL);
  // how long the stage takes the original to load: a frame for a zone's second act and for X Zone, two for a new zone
  act.stallLoad = 0; act.loadFrames = nextLevel & 1 || nextLevel == LEVEL_X_ZONE ? 2 : 3;
  titlecard_made(1);
  // the objects' tasks are after the results' in the list, so they run at once, unseen: the rings' spin and the
  // first objects' animations are a step on when the act's own first frame comes
  objects_set_drawing(0);
  objects_run_before_hud();
  objects_run_after_hud();
  objects_set_drawing(1);
  // this frame's V-blank is spent making the stage and doesn't swap the two H-blank tables, which Secret Base's
  // spotlights show
  e.primary ^= HBLANK_BUFFER;
}
// m4aSoundVSyncOn once the save is written, then the next act
static void next_act_after_write(void) {
  sound_vsync_on();
  next_act();
}

// HandleLifeLost with lives left (restartAct in the JavaScript's game.js): every task goes, and the act starts over
// (CreateGameStage) with its title card from black, the player at the last checkpoint he passed or the act's start
// without one, and the CPU partner at the act's start, flying back from there. The score, the lives, the stage clock, the
// checkpoint and the game's random numbers carry on; the course time goes back to the checkpoint's (to 0 if it had run
// past 10:00). The act's music starts again at once, and the original spends the whole next frame loading the act.
#define MAX_COURSE_TIME (10 * 3600)
static int restarting, respawnIndex, respawnX, respawnY;
static void restart_act(void) {
  Act was = act;
  uint32_t seed = act_random_state();
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  restarting = 1;
  respawnIndex = was.checkpointIndex; respawnX = was.checkpointX; respawnY = was.checkpointY;
  act_start(was.stage.level, -1, 0);
  restarting = 0;
  act.restarted = 1;
  act.lives = was.lives; act.score = was.score; act.tick = was.tick;
  act_random_seed(seed);
  act.checkpointIndex = was.checkpointIndex; act.checkpointX = was.checkpointX; act.checkpointY = was.checkpointY;
  act.checkpointTime = was.checkpointIndex && was.courseTime < MAX_COURSE_TIME ? was.checkpointTime : 0;
  act.courseTime = act.clockTime = act.checkpointTime;
  act.musicStarts = 0;
  music_call(MUSIC_STAGE, act.stage.music);
  act.stallLoad = 0; act.loadFrames = 2;
  titlecard_made(0);
  // the new act's tasks after the ones that went run at once, unseen, as after the act before
  objects_set_drawing(0);
  objects_run_before_hud();
  objects_run_after_hud();
  objects_set_drawing(1);
}

// GoToNextLevel: every task goes, the act's objects with their sprites' VRAM, the queues stop, the music stops, and
// the save is written (the screen keeping its frame while the flash takes it), before the next act starts on the
// frame the write ends; the black of an act that isn't in C shows on that frame too, as the original's stage start's
static void go_to_next_level(void) {
  nextLevel = act.stage.level + 1;
  // what the objects' tasks drew this frame, before the results' task ended it, is on the screen for a frame as the
  // next act loads: the animals of a capsule, flying on
  engine_take_oam(lastObjects);
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  // the sound engine is off while the save is written (m4aSoundVSyncOff), so its frames stop with the screen's
  stop_all_songs();
  sound_vsync_off();
  if (save_write()) engine_stall(WRITE_FRAMES, next_act_after_write);
  else next_act_after_write();
}

// CreateCongratulationsAnimation's start, after the last stage's results: every task goes and the save is written, as
// before the next act, and then the normal ending takes the screen (congratulations.c)
static uint32_t endingSeed;
static void congratulations_after_write(void) {
  sound_vsync_on();
  act_active = 0;
  front_random_seed(endingSeed);
  create_congratulations();
}
static void go_to_congratulations(void) {
  endingSeed = act_random_state();
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  stop_all_songs();
  sound_vsync_off();
  if (save_write()) engine_stall(WRITE_FRAMES, congratulations_after_write);
  else congratulations_after_write();
}

// Task_8056AC8, once the game over's song has ended: the music stops and the save is written, then every task goes and
// the game goes back to the SEGA logo
static void sega_logo_after_write(void) {
  sound_vsync_on();
  act_active = 0;
  create_sega_logo();
}
static void go_to_sega_logo(void) {
  destroy_tasks(0, 0xFFFF);
  act_tasks_destroy_all();
  act.task = NULL;
  clear_queues();
  stop_all_songs();
  sound_vsync_off();
  if (save_write()) engine_stall(WRITE_FRAMES, sega_logo_after_write);
  else sega_logo_after_write();
}

void act_go_to_next_level(void) {
  go_to_next_level();
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
  const Level *row = act.stage.row;
  act.hud.flash = row->zeroFlashesInSixteens ? (act.stage.hudFlash + 7) & 31
    : act.afterLevel || act.restarted ? HUD_FLASH_AFTER : hud_flash();
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
  if (act.frames == 0) {
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
  // after the act before, the stage's background update and its animated tiles run from the act's second frame, a
  // frame before the camera
  int bgRuns = camRuns || (act.afterLevel && act.frames > 0);
  if (row->cameraMoved) row->cameraMoved(bgRuns);
  if (bgRuns || (row->runsFromFirstFrame && act.frames > 0)) { if (row->tilesShownLate) late_tiles_step(); else animate_stage_tiles(); }
  // the objects' tasks first run on the frame after the one that makes the act, which is where the rings' spin starts;
  // those from the HUD's priority on run after it, below
  int objectsRun = act.frames > 0 || row->runsFromFirstFrame;
  if (row->beforeObjects) row->beforeObjects();
  if (objectsRun) objects_run_before_hud();
  // the game over's tasks, made after the objects' at their priority
  if (gameover_step()) { go_to_sega_logo(); return; }
  // the title card's task (0x2100) runs before Sonic's and the clock's, so the frame it ends frees the pad and starts
  // the clock; its pieces and fade go over the act, and it sets the display while it shows, after draw_frame
  int cardShows = !act.cardDone;
  if (cardShows) card_update((e.pressed & (KEY_A | KEY_B | KEY_UP | KEY_DOWN | KEY_LEFT | KEY_RIGHT)) != 0);
  // the results' task (0x2100) and its pieces' (0x2120); the frame they end, the next act takes over
  if (results_active() && !results_run()) {
    if (act.stage.level != LEVEL_X_ZONE) { go_to_next_level(); return; }
    if (!moon_opens()) { go_to_congratulations(); return; }
  }
  // the HUD's task runs before Sonic's and before the clock, as the original makes it (0x2180), and the objects' tasks from
  // its priority after it, so an icicle (0x2200) that hurts Sonic takes his rings after the HUD has shown them
  if (act.cardDone && !act.hud.gone) hud_update(1);
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
  if (act.player.wasIgnoreInput && !act.player.ignoreInput) {
    if (e.input & KEY_A) in.jumpPressed = 1;
    if (e.input & KEY_B) in.attackPressed = 1;
    act.player.heldDirs = 0;
  }
  act.player.wasIgnoreInput = act.player.ignoreInput;
  // the CPU partner hears Sonic's buttons, or nothing while the card or an object holds them (sub_804D13C)
  if (act.hasPartner) partner_hear(!act.cardDone || act.player.ignoreInput ? NULL : &in);
  // an object holding him takes the pad from him: he reads nothing held or pressed, or only right held as the goal post
  // gives him to run off (HOLD_RIGHT)
  if (act.player.ignoreInput)
    in = act.player.heldRight ? (PlayerInput){ .right = 1 } : act.player.heldLeft ? (PlayerInput){ .left = 1 } : (PlayerInput){0};
  // after the last life, the player's task has gone
  if (!act.playerGone) {
    player_step(&act.player, &in);
    if (lifeLost) { lifeLost = 0; restart_act(); return; }
    // a start point's first act frame is the held A's jump, one frame after it began, when it has the word for it
    if (act.drawn == 0 && act.fromStartPoint && gba_start_number("jump", 0)) player_start_jump(&act.player);
    if (!act.playerGone) {
      player_animate(&act.player, &in);
      player_tails_step(&act.player);
    }
  }
  sonic_shown();
  // the CPU partner's task, just after Sonic's (0x3001)
  if (act.hasPartner) { partner_task(!act.cardDone); partnerShown = act.partner; }
  if (row->palettesAfterSonic)
    for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
  if (act.frames > 0 || row->runsFromFirstFrame) objects_run_late();
  // what the music manager reads of Sonic (0x4000)
  const Player *sonic = &act.player;
  music_call(MUSIC_PLAYER, (sonic->invincible > 0) | (sonic->speedUp > 0) << 1 | !sonic->dead << 2);
  // the stage clock's task (0xFF00): the course time counts once the card has ended, the stage's tick every frame; it
  // keeps this frame's gravity as the last (gPrevStageFlags), so a flip turns his Y speed around once
  act.player.wasInverted = act.player.inverted;
  act.partner.wasInverted = act.partner.inverted;
  if (!act.clockStopped) {
    act.clockTime++;
    if (act.timerReversed) {
      if (--act.courseTime <= 0) {
        // time up stops the clock (STAGE_FLAG__ACT_START), so this happens once
        act.courseTime = 0;
        act.clockStopped = 1;
        if (act.stage.level == LEVEL_EGG_ROCKET) boss_shake(0x800, 8, 16, -1, SHAKE_VERTICAL | SHAKE_HORIZONTAL | SHAKE_RANDOM);
        act.player.dead = 1;
      }
    } else {
      act.courseTime++;
    }
  }
  act.tick++;
  // the water's task (0xFFFE), after the clock's
  if (act.frames > 0) water_task();
  act.frames++;
  draw_frame();
  // the first frame after the act before still has the layers where the stage's making left them, at 0
  if (act.afterLevel && act.frames == 1) for (int i = 2; i < 8; i++) e.bgScroll[i] = 0;
  // the card's fade first: a stage's own tasks, such as Secret Base's spotlights, run after the card's and have the
  // last word on the display
  if (cardShows) titlecard_display();
  // (after the act before, its tasks first run on the act's second frame, as its objects do)
  if (row->afterFrame) row->afterFrame(1);
  results_display();
  gameover_display();
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
  // the load runs past the frame's V-blank, which keeps the screen, but the frame it took still ends with
  // ClearOamBufferDma's swap of the two H-blank tables, as the original's does (Secret Base's spotlights show which)
  if (!(e.flags & FLAGS_KEEP_HBLANK_BUFFER)) e.primary ^= HBLANK_BUFFER;
  // the palette animations first run on the frame after the load, as the original makes them
  start_palette_animations();
  act_frame();
}

void act_task(Task *t) {
  (void)t;
  if (act.loadFrames) {
    // the next act after GoToNextLevel loads: black, with the results' band where a zone's second act comes on
    // (sub_80550F8). Then its first frame, whose palette animations are a step on already
    if (mapsShownOld) { memcpy(gba_vram + LAYER_MAPS, newMaps, LAYER_MAPS_SIZE); mapsShownOld = 0; }
    if (--act.loadFrames) {
      titlecard_made(0);
      // a new zone's first loading frame shows the act before's objects a last time, and its layers' maps
      if (!(act.stage.level & 1) && act.loadFrames == 2) {
        engine_show_oam(lastObjects);
        memcpy(newMaps, gba_vram + LAYER_MAPS, LAYER_MAPS_SIZE);
        memcpy(gba_vram + LAYER_MAPS, oldMaps, LAYER_MAPS_SIZE);
        mapsShownOld = 1;
        if (act.stage.row->layersOnFirstLoad) {
          fill_layer(0xF000, LAYER_FRONT, 0, 0);
          fill_layer(0xF800, LAYER_BACK, 0, 0);
        }
      }
      return;
    }
    // an act whose palette animations run from the frame that makes it has made them already
    if (!act.stage.row->runsFromFirstFrame) {
      start_palette_animations();
      for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
    }
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
      if (!act.clockStopped) {
        clock_step();
      }
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
    player_tails_step(&act.player);
    sonic_shown();
    if (act.tick > 0) objects_run_late();
    if (!row->cardStepsOn || act.tick >= 16)
      for (int i = 0; i < act.palCount; i++) palette_animation_step(&act.pal[i]);
    water_card_flush();   // the card's part in the water, after the palette animations as in the task list
    if (row->afterFrame && !loading) row->afterFrame(0);
    if (!act.clockStopped && !(row->cardStepsOn && cardJustEnded)) {
      clock_step();
    }
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
  gba_sound_psg_at(level_row(level)->soundAtOnce ? 0 : ACT_SOUND_MAIN_AT);
  memset(&act, 0, sizeof act);
  act.fromStartPoint = gba_start_point("level") != NULL && !startPointSpent;
  startPointSpent |= act.fromStartPoint;
  // gPseudoRandom is one sequence for the whole game: the act goes on with what the front left
  act.seed = 0;
  copyCount = 0;
  load_stage(level);
  const Level *row = act.stage.row;
  act.bgAnimFrame = 0; act.bgAnimShown = 0; act.bgAnimDelay = 0;
  // after a life lost, the player starts again at the last checkpoint passed (SetStageSpawnPos)
  int again = restarting && respawnIndex;
  player_init(&act.player, again ? respawnX : act.stage.spawnX, again ? respawnY : act.stage.spawnY);
  if (!comingOn && !restarting) menu_leftovers();
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
  // every task of the screen or the act before is gone, and with them their sprites' tiles: the card takes the
  // heap's first
  vram_reset();
  titlecard_start(level, ctx.character, comingOn);
  // the players come after the card's task (CreateGameStage): Sonic's sprite has its fixed place, and the CPU partner,
  // which the character select's code brings along with Sonic in the single-player game, takes his two from the heap. The
  // Moon Zone, the extra stage, has none (GameStageStart).
  // Tails played by the pad has his body at Sonic's fixed place, and his tails from the heap as the partner's are
  if (ctx.character == CHARACTER_TAILS) player_become_tails(&act.player);
  // Knuckles needs no sprite but his body
  if (ctx.character == CHARACTER_KNUCKLES) act.player.character = CHARACTER_KNUCKLES;
  if (ctx.partner && ctx.character == 0 && level != LEVEL_THE_MOON) partner_start();
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
