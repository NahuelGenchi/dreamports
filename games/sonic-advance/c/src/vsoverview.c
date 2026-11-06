// The players' overview, translated from front/vsoverview.js (SAT-R's src/game/sa1/stage/mp_unk_1.c: sub_801C9D8 and its
// tasks), after the VS character select: a strip for each GBA slides in from alternate sides with the character it picked
// and the player's name, holds for 60 frames, and the screen fades to white. A Chao Hunt of two goes on to the stage
// choice (vschao.c), and three or four players choose first whether to play in teams (vsteams.c).

#include "sa.h"

enum { TILEMAP = 88, UIGFX_FONT = 0, UIGFX_FONT_COLOURS = 60, STRIP = 40, HOLD = 60 };
enum { NAME_X = 10, NAME_Y = 20, NAME_STEP = 8, NAME_CHARS = 6 };
// the characters' idle animations (gPlayerCharacterIdleAnims)
static const uint16_t IDLE_ANIMS[4] = { 0, 99, 199, 298 };

static struct {
  int count, top, slide;   // unk432, qUnk430
  Sprite sprites[4];
  UiText overBs[PLAYERS_MAX];
  uint32_t vramC;
  Background bg;
} screen;

static void slide_in(Task *t);

/** sub_801C9D8. */
void create_vs_overview(void) {
  int connections = ctx.vsLink.connections;
  for (int i = 0; i < 6; i++) e.winRegs[i] = 0;
  e.dispCnt = 0x40;
  e.bgCnt[3] = 0x5E0B;
  e.bldCnt = 0;
  e.bldY = 0;
  vs_reset_missing();
  e.mapFill[3].value = 0xFF;
  e.mapFill[3].rect[0] = 0; e.mapFill[3].rect[1] = 0; e.mapFill[3].rect[2] = 0xFF; e.mapFill[3].rect[3] = 0x40;
  memset(gba_vram + 0xA000 - 0x20, 0, 0x40);
  int count = 0;
  while (count < PLAYERS_MAX && connections >> count & 1) count++;
  memset(&screen, 0, sizeof screen);
  screen.count = count;
  screen.top = count == 3 ? 0x14 : count == 2 ? 0x28 : 0;
  for (int i = 0; i < 4; i++) vs_sprite(&screen.sprites[i], IDLE_ANIMS[i], OBJ_VRAM + ((uint32_t)i << 11), 120, 20 + i * 0x28, 0x400, 0, 0x1000);
  create_task(slide_in, &screen, 0x2000, 0, NULL);
  background_init(&screen.bg);
  screen.bg.graphics.dest = 0x8000;
  screen.bg.layoutVram = 0xF000; screen.bg.tilemapId = TILEMAP; screen.bg.targetTilesX = 30; screen.bg.targetTilesY = 20; screen.bg.flags = 3;
  draw_background(&screen.bg);
  for (int i = 0; i < 4; i++) update_sprite(&screen.sprites[i], 0);
  create_ui_task();
}

// the picture seen through each strip: strip i slides along its line by slide(i)
static void strips(int moving) {
  int top = screen.top;
  if (top != 0) fill_lines(3, 0, top, 240, 0);
  for (int i = 0; i < screen.count; i++) {
    int h = moving ? (i & 1 ? 240 - (screen.slide >> 8) : (screen.slide >> 8) - 240) : 0;
    fill_lines(3, top + i * STRIP, top + (i + 1) * STRIP, h, -top & 0xFF);
  }
  if (top != 0) fill_lines(3, (top + screen.count * STRIP) & 0xFF, 160, 240, 0);
}

static void make_names(void);
static void hold(Task *t);

// Task_801CB80: each strip slides in, the first from the left and the next from the right, four pixels a frame
static void slide_in(Task *t) {
  e.dispCnt |= 0x1800;
  if (vs_link_lost()) return;
  screen.slide += 0x400;
  if (screen.slide > 240 << 8) {
    screen.slide = 0;
    make_names();
    t->main = hold;
    hold(t);
    return;
  }
  strips(1);
}

static void draw_names(Task *t);
static void free_names(Task *t) { (void)t; vram_free(screen.vramC); }

// sub_801D0CC: the names' glyphs, with the UI font's colours, over the strips
static void make_names(void) {
  UiSlot layout, colourLayout;
  uint32_t fontTiles, fontPalette, colourTiles, colours;
  ui_graphics(UIGFX_FONT, &fontTiles, &fontPalette, &layout);
  ui_graphics(UIGFX_FONT_COLOURS, &colourTiles, &colours, &colourLayout);
  screen.vramC = vram_malloc(0xE0);
  UiGfx g = { 0 };
  g.uiGfxID = UIGFX_FONT; g.unk2B = 1; g.layout = &layout; g.tiles = fontTiles; g.tilesSize = 0x1C00;
  g.palette = colours; g.paletteSize = 0x20; g.unk28 = 4; g.vramC = screen.vramC; g.unk2A = 0xD;
  load_ui_gfx(&g);
  for (int i = 0; i < PLAYERS_MAX; i++) {
    UiText *o = &screen.overBs[i];
    memset(o, 0, sizeof *o);
    o->unkA = NAME_X; o->unkC = NAME_Y; o->unkE = 1; o->unk10 = 1; o->unk12 = 4; o->unk16 = 1;
  }
  create_task(draw_names, screen.overBs, 0x2200, 0, free_names);
}

// Task_801D200
static void draw_names(Task *t) {
  UiText *overBs = t->data;
  for (int i = 0; i < screen.count; i++) {
    UiText *o = &overBs[i];
    const uint8_t *name = vs_name(i);
    for (int c = 0; c < NAME_CHARS; c++) {
      char glyph[2] = { (char)name[c], 0 };
      o->unkA = (uint16_t)(c * NAME_STEP + NAME_X);
      o->unkC = (uint16_t)(i * STRIP + NAME_Y + screen.top);
      if (((name[c] - 0x70) & 0xFF) < 26) o->unkC += 8;
      draw_ui_text(glyph, o, 0);
    }
  }
}

// sub_801CF08: the strips in place, each with its character
static void stay(void) {
  int top = screen.top;
  if (vs_link_lost()) return;
  if (top != 0) fill_lines(3, 0, top, 240, 0);
  int i = 0;
  for (; i < PLAYERS_MAX && ctx.vsLink.connections >> i & 1; i++) {
    fill_lines(3, top + i * STRIP, top + (i + 1) * STRIP, 0, -top & 0xFF);
    Sprite *s = &screen.sprites[ctx.vsLink.characters[i] & 3];
    s->x = 120;
    s->y = (int16_t)(i * STRIP + 20 + top);
    update_sprite(s, 0);
    display_sprite(s);
  }
  if (top != 0) fill_lines(3, top + i * STRIP, 0xA0, 240, 0);
}

static void fade_out(Task *t);

// Task_801D34C: they stay for 60 frames, and then the screen fades to white
static void hold(Task *t) {
  if (screen.slide++ > HOLD) {
    screen.slide = 0;
    e.bldCnt = 0xFF;
    // m4aMPlayFadeOut with a speed of 0 on the music and the three effect players starts no fade
    t->main = fade_out;
    fade_out(t);
  } else stay();
}

// Task_801CD80: white at two units a frame, and the screen after
static void fade_out(Task *t) {
  (void)t;
  screen.slide += 0x200;
  if (screen.slide > 0x1000) {
    e.bldY = 0x10;
    e.flags &= ~FLAGS_HBLANK_COPY;
    destroy_tasks(0, 0xFFFF);
    clear_queues();
    // two players go on to the stage choice, three or four choose teams first
    if (screen.count < 3) create_vs_chao_select();
    else create_vs_teams();
  } else {
    stay();
    e.bldY = (uint16_t)(screen.slide >> 8);
  }
}
