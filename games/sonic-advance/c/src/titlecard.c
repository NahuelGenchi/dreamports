// The title card's pictures and pieces, translated from the JavaScript version's engine/titlecard.js and
// rom/titlecard.js (SAT-R's src/game/stage/ui_z.c: LoadStageIntroGraphics, sub_80550F8, Task_8055458 and the six
// tasks it makes). Each piece is a row of sprites of one size; a glyph is the run of tiles one sprite shows (1D OBJ
// mapping), and the card's text says which glyph each sprite shows.

#include "titlecard.h"

#define TILE 32
#define GLYPH_BASE_ 0x20
#define CARD_SPRITES 64

enum { PIECE_ZIGZAG, PIECE_NAME, PIECE_ACT, PIECE_BAR, PIECE_ZONE_JP, PIECE_ZONE, PIECE_COUNT };
// the UI graphics entries the card loads (rom/titlecard.js)
enum { UI_FONT = 0, UI_ZIGZAG = 6, UI_CHAR_NAMES = 10, UI_ACT = 15, UI_BAR = 16, UI_ZONE_JP = 17, UI_ZONE_NAME = 19 };
// the card's tables (gUnknown_08688378 on): per level the Japanese name's tile count and first tile, the character
// name's text, per level the zone name's graphics, and the pieces' texts
enum { CARD_JP_TILES = 0x00, CARD_JP_FIRST = 0x0E, CARD_ZONE_NAME = 0x20, CARD_TEXT_NAME = 0x1C,
  CARD_TEXT_ZIGZAG = 0x34, CARD_TEXT_ACT = 0x38, CARD_TEXT_BAR = 0x40, CARD_TEXT_ZONE_JP = 0x4C, CARD_TEXT_ZONE = 0x54 };

typedef struct {
  int slot, x, y, count, order, palette, rows, grid, mark, drops;
  int shape, size, w, h, perGlyph, tile;
  const uint8_t *text;
} CardPiece;

typedef struct { uint16_t a0, a1, a2; uint8_t order; } CardSprite;

static struct {
  int frame, done, blank, active, drawn, semi, fading;
  Fade fade;
  CardPiece pieces[PIECE_COUNT];
  uint8_t texts[PIECE_COUNT][32];
  uint32_t vram[PIECE_COUNT];
  int vramCount;
  CardSprite sprites[CARD_SPRITES];
  int spriteCount;
} card;

static void copy_text(uint8_t *to, uint32_t from, int count) {
  for (int i = 0; i < count; i++) to[i] = (uint8_t)rom_u8(from + i);
}

// sub_80528AC: one load of sprite tiles (and, when asked, its colours) into a slot
static void load_piece(int slot, uint32_t tiles, uint32_t tilesSize, uint32_t palette, int paletteRow, uint32_t vram,
  const UiSlot *layout, int withPalette) {
  UiGfx g;
  memset(&g, 0, sizeof g);
  g.tiles = tiles; g.tilesSize = tilesSize;
  g.palette = palette; g.paletteSize = withPalette ? 32 : 0;
  g.unk28 = (uint8_t)paletteRow;
  g.unk2A = (uint8_t)(0x9 | (withPalette ? 0x4 : 0));
  g.unk2B = slot;
  g.vramC = vram;
  g.layout = layout;
  load_ui_gfx(&g);
}

static uint32_t new_vram(int tiles) {
  uint32_t v = vram_malloc((uint32_t)tiles);
  if (card.vramCount < PIECE_COUNT) card.vram[card.vramCount++] = v;
  return v;
}

static void use_slot(CardPiece *p, int slot) {
  const UiSlot *s = &ui_slots()[slot];
  p->slot = slot;
  p->shape = s->unk9;
  p->size = s->unk8;
  p->w = s->unkA * 8;
  p->h = s->unkB * 8;
  p->perGlyph = (int)s->unk4;
  p->tile = (int)s->unk0;
}

static void free_vram(void) {
  for (int i = 0; i < card.vramCount; i++) vram_free(card.vram[i]);
  card.vramCount = 0;
}

/** sub_8052F78 and sub_80530CC: `count` sprites of `text` from (x, y), or the zigzag's rows of them. */
static void put(CardPiece *p, const uint8_t *text, int y, int semi) {
  int a0 = (p->shape << 14) + (y & 0xFF) + (semi ? 0x400 : 0);
  int a1 = (p->size << 14) + (p->x & 0x1FF);
  if (!p->grid) {
    for (int i = 0; i < p->count; i++, a1 += p->w) {
      if (card.spriteCount >= CARD_SPRITES) return;
      CardSprite *s = &card.sprites[card.spriteCount++];
      s->order = (uint8_t)p->order; s->a0 = (uint16_t)a0; s->a1 = (uint16_t)a1;
      s->a2 = (uint16_t)((p->palette << 12) | ((p->tile + (text[i] - GLYPH_BASE_) * p->perGlyph) & 0x3FF));
    }
    return;
  }
  for (int r = 0; r < p->rows; r++, a0 += p->h) {
    int a1r = (p->size << 14) + (p->x & 0x1FF);
    for (int i = ((-p->x & 0x1FF) >> 7); i < p->count; i++, a1r += p->w) {
      if (card.spriteCount >= CARD_SPRITES) return;
      CardSprite *s = &card.sprites[card.spriteCount++];
      s->order = (uint8_t)p->order; s->a0 = (uint16_t)a0; s->a1 = (uint16_t)a1r;
      s->a2 = (uint16_t)((p->palette << 12) | ((p->tile + (text[i] - GLYPH_BASE_) * p->perGlyph) & 0x3FF));
    }
  }
}

// Task_8055730: in from the left 8 px a frame, and out the same way
static void task_zigzag(CardPiece *p, int k) {
  if (k > 215) p->x = s16(p->x - 8);
  else if (k > 10) p->x = 0;
  else if (k > 0) p->x = s16(p->x + 8);
  put(p, p->text, p->y, card.semi);
}

// Task_8055798: four sprites down the zigzag, dropping in from the top from the 27th frame and showing from the 33rd
static void task_name(CardPiece *p, int k) {
  if (k > 215) {
    int q = s16(bios_div((k - 215) << 7, 10));
    for (int i = 0; i < 4; i++) {
      p->y = s16(-q + 32 * i);
      if (p->y >= -32) put(p, p->text + i, p->y, card.semi);
    }
  } else if (k > 31) {
    for (int i = 0; i < 4; i++) { p->y = 32 * i; put(p, p->text + i, p->y, card.semi); }
  } else if (k > 25) {
    int y = (bios_div((k - 215) << 7, 6) - 176) & 0x1FF;
    if (y > 421) for (int i = 0; i < 4; i++) { p->y = s16(y + 32 * i); put(p, p->text + i, p->y, card.semi); }
  }
}

// Task_8055904: up from the bottom 3 px a frame to y 144, and back down 2 px a frame
static void task_act(CardPiece *p, int k) {
  if (k > 215) { if (p->y < 160) p->y = s16(p->y + 2); }
  else if (k > 35) { p->x = 180; p->y = 144; p->count = 6; }
  else if (k > 30) { if (p->y > 144) p->y = s16(p->y - 3); }
  put(p, p->text, p->y, card.semi);
}

// Task_8055998: in from the right 26 px a frame to x -16 (or down from the top 9 px a frame), out to the left
static void task_bar(CardPiece *p, int k) {
  if (k > 215) {
    if (p->x < -32) { p->x = s16(p->x + 32); if (p->count != 0) p->count = s16(p->count - 1); }
    p->x = s16(p->x - 26);
  } else if (k > 25) p->x = -16;
  else if (k > 15 && p->drops) { p->x = -16; p->y = p->y + 9 < 126 ? p->y + 9 : 126; }
  else if (k > 15) { p->y = 126; p->x = s16(p->x - 26); if (p->x < -16) p->x = -16; }
  put(p, p->text, p->y, card.semi);
}

// Task_8055AA0: in from the right 26 px a frame to x 112, and out to the left
static void task_zone_jp(CardPiece *p, int k) {
  if (k > 215) p->x = s16(p->x - 26);
  else if (k > 25) p->x = 112;
  else if (k > 15) { p->x = s16(p->x - 26); if (p->x < 112) p->x = 112; }
  put(p, p->text, p->y, card.semi);
}

// Task_8055B18: in from the right 28 px a frame, then scrolling left 2 px a frame, out to the left 28 px a frame
static void task_zone(CardPiece *p, int k) {
  if (k > 215) {
    int old = p->x;
    p->x = s16(p->x - 28);
    if (p->x < -31) { p->count = s16(p->count - 1); p->x = s16(old + 4); p->mark = (p->mark + 1) % 7; }
    put(p, p->text + p->mark, p->y, card.semi);
  } else if (k > 25) {
    int old = p->x;
    p->x = s16(old - 2); p->count = 9;
    if (p->x < -31) { p->x = s16(old + 30); p->mark = (p->mark + 1) % 7; }
    put(p, p->text + p->mark, p->y, card.semi);
  } else if (k > 15) {
    p->y = 128;
    int old = p->x;
    p->x = s16(old - 28);
    if (p->x < 240) {
      p->count = 9 - (p->x >> 5);
      if (p->x < -31) { p->x = s16(old + 4); p->mark = (p->mark + 1) % 7; }
      put(p, p->text + p->mark, p->y, card.semi);
    }
  }
}

void titlecard_start(int level, int character) {
  uint32_t tiles, palette;
  UiSlot layout, custom;
  uint32_t zoneGfx;

  memset(&card, 0, sizeof card);
  card.active = 1;
  card.done = 1;
  card.fade = create_fade(0, 0, 2, 0, 96, 1);
  fade_step(&card.fade);
  create_ui_task();
  ui_gfx_stack_init();

  const uint32_t at = OFFSET_TITLE_CARD;

  // the zigzag band and the character's name, then the name's colours last in palette row 15
  ui_graphics(UI_ZIGZAG + character, &tiles, &palette, &layout);
  load_piece(6, tiles, 0x400, palette, 15, new_vram(32), &layout, 1);
  ui_graphics(UI_CHAR_NAMES, &tiles, &palette, &layout);
  load_piece(7, tiles + (uint32_t)character * 64 * TILE, 0x800, palette, 15, new_vram(64), &layout, 1);

  // the white bar
  ui_graphics(UI_BAR, &tiles, &palette, &layout);
  load_piece(8, tiles, 0x200, palette, 6, new_vram(16), &layout, 1);

  // the Japanese name: its tiles right-aligned in 12, blank tiles (49) before them, then four more (8 to 11),
  // and tile 8 again over the first
  ui_graphics(UI_ZONE_JP, &tiles, &palette, &layout);
  const int jpCount = (int)rom_u8(at + CARD_JP_TILES + (uint32_t)level);
  const int jpFirst = (int)rom_u8(at + CARD_JP_FIRST + (uint32_t)level);
  const uint32_t jpVram = new_vram(16);
  load_piece(9, tiles + 49 * TILE, (uint32_t)(12 - jpCount) * TILE, palette, 6, jpVram, NULL, 0);
  load_piece(9, tiles + 8 * TILE, 4 * TILE, palette, 6, jpVram + 12 * TILE, NULL, 0);
  load_piece(9, tiles + (uint32_t)jpFirst * TILE, (uint32_t)jpCount * TILE, palette, 6,
    jpVram + (uint32_t)(12 - jpCount) * TILE, NULL, 0);
  memset(&custom, 0, sizeof custom);
  custom.unk4 = 4; custom.unk8 = 1; custom.unk9 = 1; custom.unkA = 4; custom.unkB = 1;
  load_piece(9, tiles + 8 * TILE, TILE, palette, 6, jpVram, &custom, 1);

  // the act number: "ACT" and the act's digit after it
  ui_graphics(UI_ACT, &tiles, &palette, &layout);
  const uint32_t actVram = new_vram(12);
  load_piece(10, tiles + 8 * TILE + (uint32_t)(level & 1) * 4 * TILE, 4 * TILE, palette, 6, actVram + 8 * TILE, NULL, 0);
  load_piece(10, tiles, 0x100, palette, 6, actVram, &layout, 1);

  // the zone's name, in the palette entry 19 has
  uint32_t zonePalette;
  ui_graphics(19, &tiles, &zonePalette, &layout);
  zoneGfx = rom_u8(at + CARD_ZONE_NAME + (uint32_t)level);
  ui_graphics((int)(19 + zoneGfx), &tiles, &palette, &layout);
  memset(&custom, 0, sizeof custom);
  custom.unk4 = 8; custom.unk8 = 2; custom.unk9 = 1; custom.unkA = 4; custom.unkB = 2;
  load_piece(2, tiles, 0x700, zonePalette, 6, new_vram(56), &custom, 1);

  // the card's texts, as glyph numbers on the pieces' sheets
  copy_text(card.texts[PIECE_ZIGZAG], at + CARD_TEXT_ZIGZAG, 3);
  copy_text(card.texts[PIECE_NAME], at + CARD_TEXT_NAME, 4);
  copy_text(card.texts[PIECE_ACT], at + CARD_TEXT_ACT, 6);
  copy_text(card.texts[PIECE_BAR], at + CARD_TEXT_BAR, 8);
  copy_text(card.texts[PIECE_ZONE_JP], at + CARD_TEXT_ZONE_JP, 4);
  copy_text(card.texts[PIECE_ZONE], at + CARD_TEXT_ZONE, 22);
  for (int i = 22; i < 27; i++) card.texts[PIECE_ZONE][i] = GLYPH_BASE_;

  CardPiece *p = card.pieces;
  memset(p, 0, sizeof card.pieces);
  p[PIECE_ZIGZAG] = (CardPiece){ .x = -80, .y = 0, .count = 3, .order = 3, .palette = 15, .rows = 5, .grid = 1, .text = card.texts[PIECE_ZIGZAG] };
  p[PIECE_NAME] = (CardPiece){ .x = 20, .y = 0, .count = 1, .order = 2, .palette = 15, .text = card.texts[PIECE_NAME] };
  p[PIECE_ACT] = (CardPiece){ .x = 180, .y = 160, .count = 6, .order = 0, .palette = 6, .text = card.texts[PIECE_ACT] };
  p[PIECE_BAR] = (CardPiece){ .x = 240, .y = 126, .count = 8, .order = 1, .palette = 6, .text = card.texts[PIECE_BAR] };
  p[PIECE_ZONE_JP] = (CardPiece){ .x = 360, .y = 114, .count = 4, .order = 0, .palette = 6, .text = card.texts[PIECE_ZONE_JP] };
  p[PIECE_ZONE] = (CardPiece){ .x = 256, .y = 128, .count = 9, .order = 0, .palette = 6, .text = card.texts[PIECE_ZONE] };
  use_slot(&p[PIECE_ZIGZAG], 6);
  use_slot(&p[PIECE_NAME], 7);
  use_slot(&p[PIECE_ACT], 10);
  use_slot(&p[PIECE_BAR], 8);
  use_slot(&p[PIECE_ZONE_JP], 9);
  use_slot(&p[PIECE_ZONE], 2);
}

int titlecard_step(int pressed) {
  if (!card.active) return 0;
  // a press of A, B or the pad from its 36th frame to its 214th skips to its 215th
  if (pressed && card.frame > 35 && card.frame < 215) {
    card.frame = 215;
    card.fade.unk8 = (uint16_t)bios_div(0x2000 - card.fade.unk6, 10);
    if (!card.blank) { card.done = (uint8_t)fade_step(&card.fade); card.fading = 1; }
  }
  const int k = card.frame, done = card.done;
  if (!card.blank && (k <= 105 || !card.done)) {
    if (k > 20) card.done = (uint8_t)fade_step(&card.fade);
    else fade_show(&card.fade);
    card.fading = 1;
  } else { e.bldY = 0; card.fading = 0; }

  card.frame++;
  if (card.frame > 225) {
    card.active = 0; card.drawn = 0;
    e.bldCnt = 0; e.bldY = 0;
    e.dispCnt &= (uint16_t)~0x2000;
    free_vram();
    return 0;
  }

  card.semi = k <= 105 || !done || card.blank;
  card.spriteCount = 0;
  task_zigzag(&card.pieces[PIECE_ZIGZAG], k);
  task_name(&card.pieces[PIECE_NAME], k);
  task_act(&card.pieces[PIECE_ACT], k);
  task_bar(&card.pieces[PIECE_BAR], k);
  task_zone_jp(&card.pieces[PIECE_ZONE_JP], k);
  task_zone(&card.pieces[PIECE_ZONE], k);
  card.drawn = 1;
  return 1;
}

void titlecard_draw(void) {
  if (!card.active || !card.drawn) return;
  if (card.fading) fade_show(&card.fade);
  for (int i = 0; i < card.spriteCount; i++) {
    const CardSprite *s = &card.sprites[i];
    int k = alloc_oam(s->order);
    if (k < 0) return;
    e.oamMalloc[k * 4] = s->a0;
    e.oamMalloc[k * 4 + 1] = s->a1;
    e.oamMalloc[k * 4 + 2] = s->a2;
  }
}

int titlecard_active(void) { return card.active; }
