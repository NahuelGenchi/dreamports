// The act's title card (SAT-R decompilation, src/game/sa1/stage/stage_ui_z.c: sub_80550F8, Task_8055458 and the six
// tasks it makes), translated from the JavaScript version's engine/titlecard.js and rom/titlecard.js a function at a
// time. Six pieces slide in over the act while the screen fades in from black, hold, and slide out: the zigzag band
// down the left, the character's name on it, the white bar along the bottom, the zone's name scrolling across the
// bar, its Japanese name above and the act number below. Each piece is a row of sprites, all at background priority 0
// in front of everything; while the screen is still fading they are semi-transparent.

#include "act.h"

enum {
  CARD_SKIP_FROM = 35, CARD_SKIP_TO = 215, CARD_FRAMES = 225, FADE_FULL = 0x2000, FADE_SPEED = 96,
  LAST_ACT_LEVEL = 11, TILE = 32,
};
enum { FONT = 0, ZIGZAG = 6, CHAR_NAMES = 10, ACT = 15, BAR = 16, ZONE_JP = 17, ZONE_NAME = 19 };
enum { PIECE_ZIGZAG, PIECE_NAME, PIECE_ACT, PIECE_BAR, PIECE_JP, PIECE_ZONE };

static uint8_t jpTiles[16 * TILE];
static uint8_t actTiles[12 * TILE];
static Graphics copies[8];
static int copyCount;

static int jsdiv(int a, int b) { return a / b; }
static int s16v(int v) { return (int)(int16_t)v; }
static int minimum(int a, int b) { return a < b ? a : b; }

static void copy_vram(uint32_t src, uint32_t dest, uint32_t size) {
  if (copyCount >= 8) return;
  Graphics *g = &copies[copyCount++];
  g->src = src; g->dest = dest; g->size = size; g->anim = 0; g->ram = NULL;
  queue_graphics(g);
}

static void copy_ram_vram(const uint8_t *ram, uint32_t src, uint32_t dest, uint32_t size) {
  if (copyCount >= 8) return;
  Graphics *g = &copies[copyCount++];
  g->src = src; g->dest = dest; g->size = size; g->anim = 0; g->ram = ram;
  queue_graphics(g);
}

static void ui_entry(int id, uint32_t *tiles, uint32_t *palette, UiSlot *layout) {
  ui_graphics(id, tiles, palette, layout);
}

static void slot_from(const UiSlot *l, int *perGlyph, int *size, int *shape, int *wide, int *high) {
  *perGlyph = l->unk4; *size = l->unk8; *shape = l->unk9; *wide = l->unkA; *high = l->unkB;
}

static void set_slot(int i, uint32_t vram, int shape, int size, int wide, int high, int perGlyph, int glyphs, int palette) {
  act.card.slots[i].vram = vram;
  act.card.slots[i].shape = shape; act.card.slots[i].size = size;
  act.card.slots[i].w = wide * 8; act.card.slots[i].h = high * 8;
  act.card.slots[i].perGlyph = perGlyph; act.card.slots[i].glyphs = glyphs;
  act.card.slots[i].palette = palette;
}

static void card_load_tiles(void) {
  uint32_t tiles, palette;
  UiSlot layout;
  int perGlyph, size, shape, wide, high;
  // LoadStageIntroGraphics puts the card's tiles right after the player's sprites, at tile 400: the zigzag's two
  // glyphs, then the act number, the bar, the Japanese name, the character's name and the zone's name. The six
  // pieces take 132 tiles (32 + 12 + 16 + 16 + 56), and the card frees them all when it ends (TaskDestructor_8055C38).
  uint32_t base = vram_malloc(132);

  // zigzag: the zone's band, two 32 × 32 glyphs
  ui_entry(ZIGZAG + act.card.character, &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  set_slot(PIECE_ZIGZAG, base, shape, size, wide, high, perGlyph, 2, 15);
  copy_vram(tiles, base, 32 * TILE);

  // the act number: "ACT" and the act's own digit
  ui_entry(ACT, &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  set_slot(PIECE_ACT, base + 32 * TILE, shape, size, wide, high, perGlyph, 6, 6);
  for (int i = 0; i < 8 * TILE; i++) actTiles[i] = (uint8_t)rom_u8(tiles + i);
  for (int i = 0; i < 4 * TILE; i++) actTiles[8 * TILE + i] = (uint8_t)rom_u8(tiles + 8 * TILE + (act.card.level & 1) * 4 * TILE + i);
  copy_ram_vram(actTiles, 0, base + 32 * TILE, 12 * TILE);

  // the white bar
  ui_entry(BAR, &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  set_slot(PIECE_BAR, base + 44 * TILE, shape, size, wide, high, perGlyph, 1, 6);
  copy_vram(tiles, base + 44 * TILE, 16 * TILE);

  // the Japanese name: its tiles right-aligned in 12, blank tiles (73) before them, then four more (8 to 11), and
  // tile 8 again over the first; its sprites are 32 × 8, as the card's own table says
  int jpCount = (int)rom_u8(OFFSET_TITLE_CARD + 0x00 + act.card.level);
  int jpFirst = (int)rom_u8(OFFSET_TITLE_CARD + 0x0E + act.card.level);
  ui_entry(ZONE_JP, &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  for (int t = 0; t < 12 - jpCount; t++) for (int i = 0; i < TILE; i++) jpTiles[t * TILE + i] = (uint8_t)rom_u8(tiles + 73 * TILE + i);
  for (int t = 0; t < 4; t++) for (int i = 0; i < TILE; i++) jpTiles[(12 + t) * TILE + i] = (uint8_t)rom_u8(tiles + (8 + t) * TILE + i);
  for (int t = 0; t < jpCount; t++) for (int i = 0; i < TILE; i++) jpTiles[(12 - jpCount + t) * TILE + i] = (uint8_t)rom_u8(tiles + (jpFirst + t) * TILE + i);
  for (int i = 0; i < TILE; i++) jpTiles[i] = (uint8_t)rom_u8(tiles + 8 * TILE + i);
  set_slot(PIECE_JP, base + 60 * TILE, 1, 1, 4, 1, 4, 4, 6);
  copy_ram_vram(jpTiles, 0, base + 60 * TILE, 16 * TILE);

  // the character's name: four 32 × 32 glyphs, from the character's own 64 tiles, at tile 64 (LoadStageIntroGraphics
  // overwrites the player's first tiles with them, as the original does)
  ui_entry(CHAR_NAMES, &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  set_slot(PIECE_NAME, OBJ_VRAM + 64 * TILE, shape, size, wide, high, perGlyph, 4, 15);
  copy_vram(tiles + act.card.character * 64 * TILE, OBJ_VRAM + 64 * TILE, 64 * TILE);

  // the zone's name, its seven glyphs repeating along the bar
  ui_entry(ZONE_NAME + (int)rom_u8(OFFSET_TITLE_CARD + 0x20 + act.card.level), &tiles, &palette, &layout); slot_from(&layout, &perGlyph, &size, &shape, &wide, &high);
  set_slot(PIECE_ZONE, base + 76 * TILE, 1, 2, 4, 2, 8, 7, 6);
  copy_vram(tiles, base + 76 * TILE, 56 * TILE);

  // the colours: the zigzag and the name in palette 15, where the name's colours load last; the rest in palette 6,
  // which holds the HUD font's colours by the time the card shows
  ui_entry(CHAR_NAMES, &tiles, &palette, &layout);
  for (int i = 0; i < 16; i++) e.objPalette[15 * 16 + i] = (uint16_t)rom_u16(palette + i * 2);
  ui_entry(FONT, &tiles, &palette, &layout);
  for (int i = 0; i < 16; i++) e.objPalette[6 * 16 + i] = (uint16_t)rom_u16(palette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;
}

static void card_fade_step(int advance) {
  act.card.fadeBldY = minimum(32, 32 - (act.card.fadeLevel >> 8)) >> 1;
  if (!advance) return;
  act.card.fadeLevel = s16v(act.card.fadeLevel + act.card.fadeSpeed);
  if (act.card.fadeLevel < FADE_FULL) return;
  act.card.fadeLevel = FADE_FULL;
  act.card.done = 1;
}

static void read_text(CardPiece *p, int at, int n) {
  for (int i = 0; i < n; i++) p->text[i] = (int)rom_u8(OFFSET_TITLE_CARD + at + i) - 32;
}

void card_create(int level, int character, int fromResults, int blank) {
  TitleCard *c = &act.card;
  memset(c, 0, sizeof *c);
  copyCount = 0;
  c->level = level; c->character = character; c->blank = blank;
  c->done = 1; c->fadeSpeed = FADE_SPEED; c->fadeBldY = 0;
  c->pieces[PIECE_ZIGZAG] = (CardPiece){ .slot = PIECE_ZIGZAG, .x = -80, .y = 0, .count = 3, .order = 3, .rows = 5, .grid = 1 };
  c->pieces[PIECE_NAME] = (CardPiece){ .slot = PIECE_NAME, .x = 20, .y = 0, .count = 1, .order = 2, .rows = 1 };
  c->pieces[PIECE_ACT] = (CardPiece){ .slot = PIECE_ACT, .x = 180, .y = 160, .count = 6, .order = 0, .rows = 1 };
  c->pieces[PIECE_BAR] = (CardPiece){ .slot = PIECE_BAR, .x = fromResults ? -16 : 240, .y = fromResults ? 42 : 126, .count = 8, .order = 1, .rows = 1, .drops = fromResults };
  c->pieces[PIECE_JP] = (CardPiece){ .slot = PIECE_JP, .x = 360, .y = 114, .count = 4, .order = 0, .rows = 1 };
  c->pieces[PIECE_ZONE] = (CardPiece){ .slot = PIECE_ZONE, .x = 256, .y = 128, .count = 9, .order = 0, .rows = 1 };
  read_text(&c->pieces[PIECE_ZIGZAG], 0x34, 3);
  read_text(&c->pieces[PIECE_NAME], 0x1C, 4);
  read_text(&c->pieces[PIECE_ACT], 0x38, 6);
  read_text(&c->pieces[PIECE_BAR], 0x40, 8);
  read_text(&c->pieces[PIECE_JP], 0x4C, 4);
  read_text(&c->pieces[PIECE_ZONE], 0x54, 22);
  card_fade_step(1);   // once as it is made, its result unused
  card_load_tiles();
}

// sub_8052F78 (semi-transparent) and sub_80530CC (normal): `count` sprites from `text` in a row from (x, y), or the
// zigzag's grid of `rows` rows, each starting at the column that's on screen, as OAM attributes
static int card_semi;
static void put(CardPiece *p, const int *text, int y) {
  int slot = p->slot;
  int shape = act.card.slots[slot].shape, size = act.card.slots[slot].size;
  int w = act.card.slots[slot].w, h = act.card.slots[slot].h;
  int a0 = (shape << 14) + (y & 0xFF) + (card_semi ? 0x400 : 0);
  if (!p->grid) {
    int a1 = (size << 14) + (p->x & 0x1FF);
    for (int i = 0; i < p->count && act.card.spriteCount < CARD_SPRITES; i++, a1 += w)
      act.card.sprites[act.card.spriteCount++] = (CardSprite){ slot, text[i], a0, a1, p->order };
    return;
  }
  for (int r = 0; r < p->rows; r++, a0 += h) {
    int a1 = (size << 14) + (p->x & 0x1FF), x = p->x;
    for (int i = ((-p->x & 0x1FF) >> 7); i < p->count && act.card.spriteCount < CARD_SPRITES; i++, a1 += w, x += w)
      act.card.sprites[act.card.spriteCount++] = (CardSprite){ slot, text[i], a0, a1, p->order };
  }
}

static void tasks(CardPiece *p, int k) {
  switch (p->slot) {
    case PIECE_ZIGZAG:
      if (k > 215) p->x = s16v(p->x - 8);
      else if (k > 10) p->x = 0;
      else if (k > 0) p->x = s16v(p->x + 8);
      put(p, p->text, p->y);
      break;
    case PIECE_NAME: {
      if (k > 215) {
        for (int i = 0; i < 4; i++) {
          int q = s16v(jsdiv((k - 215) << 7, 10));
          p->y = s16v(-q + 32 * i);
          if (p->y >= -32) { CardPiece one = *p; int text[1] = { p->text[i] }; one.count = 1; put(&one, text, p->y); }
        }
      } else if (k > 31) {
        for (int i = 0; i < 4; i++) { p->y = 32 * i; CardPiece one = *p; int text[1] = { p->text[i] }; one.count = 1; put(&one, text, p->y); }
      } else if (k > 25) {
        int y = (jsdiv((k - 215) << 7, 6) - 176) & 0x1FF;
        if (y > 421) for (int i = 0; i < 4; i++) { p->y = s16v(y + 32 * i); CardPiece one = *p; int text[1] = { p->text[i] }; one.count = 1; put(&one, text, p->y); }
      }
      break;
    }
    case PIECE_ACT:
      if (k > 215) { if (p->y < 160) p->y = s16v(p->y + 2); }
      else if (k > 35) { p->x = 180; p->y = 144; p->count = 6; }
      else if (k > 30) { if (p->y > 144) p->y = s16v(p->y - 3); }
      put(p, p->text, p->y);
      break;
    case PIECE_BAR:
      if (k > 215) {
        if (p->x < -32) { p->x = s16v(p->x + 32); if (p->count != 0) p->count = s16v(p->count - 1); }
        p->x = s16v(p->x - 26);
      } else if (k > 25) p->x = -16;
      else if (k > 15 && p->drops) { p->x = -16; p->y = minimum(126, s16v(p->y + 9)); }
      else if (k > 15) { p->y = 126; p->x = s16v(p->x - 26); if (p->x < -16) p->x = -16; }
      put(p, p->text, p->y);
      break;
    case PIECE_JP:
      if (k > 215) p->x = s16v(p->x - 26);
      else if (k > 25) p->x = 112;
      else if (k > 15) { p->x = s16v(p->x - 26); if (p->x < 112) p->x = 112; }
      put(p, p->text, p->y);
      break;
    case PIECE_ZONE: {
      if (k > 215) {
        int old = p->x;
        p->x = s16v(p->x - 28);
        if (p->x < -31) { p->count = s16v(p->count - 1); p->x = s16v(old + 4); p->mark = (p->mark + 1) % 7; }
        put(p, p->text + p->mark, p->y);
      } else if (k > 25) {
        int old = p->x;
        p->x = s16v(old - 2); p->count = 9;
        if (p->x < -31) { p->x = s16v(old + 30); p->mark = (p->mark + 1) % 7; }
        put(p, p->text + p->mark, p->y);
      } else if (k > 15) {
        p->y = 128;
        int old = p->x;
        p->x = s16v(p->x - 28);
        if (p->x < 240) {
          p->count = 9 - (p->x >> 5);
          if (p->x < -31) { p->x = s16v(old + 4); p->mark = (p->mark + 1) % 7; }
          put(p, p->text + p->mark, p->y);
        }
      }
      break;
    }
  }
}

/** Runs the card's main task and then its pieces' for one frame. Returns 0 on the frame it ends, with nothing drawn. */
int card_run(int pressed) {
  TitleCard *c = &act.card;
  c->fading = 0;
  if (pressed && c->frame > CARD_SKIP_FROM && c->frame < CARD_SKIP_TO) {
    c->frame = CARD_SKIP_TO;
    c->fadeSpeed = jsdiv(FADE_FULL - c->fadeLevel, 10);
    if (!c->blank) { card_fade_step(1); c->fading = 1; }
  }
  int k = c->frame, done = c->done;
  if (!c->blank && (k <= 105 || !c->done)) {
    if (k > 20) card_fade_step(1); else card_fade_step(0);
    c->fading = 1;
  } else c->fadeBldY = 0;
  c->spriteCount = 0;
  if (++c->frame > CARD_FRAMES) return 0;
  card_semi = k <= 105 || !done || c->blank;
  for (int i = 0; i < CARD_PIECES; i++) {
    if (i == PIECE_ACT && c->level > LAST_ACT_LEVEL) continue;
    tasks(&c->pieces[i], k);
  }
  return 1;
}

void card_draw(void) {
  TitleCard *c = &act.card;
  if (c->fadeBldY) { e.bldCnt = 0x3FFF; e.bldY = (uint16_t)c->fadeBldY; }
  else { e.bldCnt = 0; e.bldY = 0; }
  for (int i = 0; i < c->spriteCount; i++) {
    CardSprite *s = &c->sprites[i];
    int slot = s->slot;
    if (s->glyph < 0 || s->glyph >= act.card.slots[slot].glyphs) continue;
    int k = alloc_oam((uint32_t)s->order);
    if (k < 0) continue;
    int tile = (int)((act.card.slots[slot].vram - OBJ_VRAM) >> 5) + s->glyph * act.card.slots[slot].perGlyph;
    e.oamMalloc[k * 4] = (uint16_t)s->a0;
    e.oamMalloc[k * 4 + 1] = (uint16_t)s->a1;
    e.oamMalloc[k * 4 + 2] = (uint16_t)((act.card.slots[slot].palette << 12) | (tile & 0x3FF));
  }
}
