// The title card (SAT-R decompilation, src/game/sa1/stage/stage_ui_z.c: LoadStageIntroGraphics, sub_80550F8,
// Task_8055458 and the six tasks it makes), translated from the JavaScript version's rom/titlecard.js and
// engine/titlecard.js. Six pieces slide in over the act while the screen fades in from black, hold, and slide out.

#include "objects.h"

#define CARD_ENTRY 28
#define CARD_TILE 32
#define CARD_SKIP_FROM 35
#define CARD_SKIP_TO 215
#define CARD_FRAMES 225
#define CARD_FADE_FULL 0x2000
#define CARD_FADE_SPEED 96
#define CARD_LAST_ACT_LEVEL 11
#define CARD_LAST_SECOND_ACT 12   // sub_80550F8's LEVEL_INDEX(ZONE_7, ACT_1), which no second act is
#define CARD_BAND_Y 42          // where the results' band is across the screen
#define CARD_ZONE_PADDING 5

enum { PIECE_ZIGZAG, PIECE_NAME, PIECE_ACT, PIECE_BAR, PIECE_ZONE_JP, PIECE_ZONE, PIECES };
enum { TEXT_NAME = 0x1C, TEXT_ZIGZAG = 0x34, TEXT_ACT = 0x38, TEXT_BAR = 0x40, TEXT_ZONE_JP = 0x4C, TEXT_ZONE = 0x54 };
static const int TEXT_AT[PIECES] = { TEXT_ZIGZAG, TEXT_NAME, TEXT_ACT, TEXT_BAR, TEXT_ZONE_JP, TEXT_ZONE };
static const int TEXT_COUNT[PIECES] = { 3, 4, 6, 8, 4, 22 };
static const int PIECE_ORDER[PIECES] = { 3, 2, 0, 1, 0, 0 };

typedef struct {
  int shape, size, wide, high, perGlyph, count, tileBase, pal;
  int x, y, countNow, order, rows, grid, mark, drops;
  int text[32];
} CardPiece;

typedef struct {
  int frame, done, blank, fading, display, level, speed, bldY, levelIndex;
  int comesOn;   // a zone's second act that follows its first: the bar starts where the results left theirs
  CardPiece p[PIECES];
} Card;

static Card card;
static Graphics cardCopies[8];
static int cardCopyCount;
static uint8_t actTiles[12 * CARD_TILE];
static uint8_t jpTiles[16 * CARD_TILE];

static void card_copy(uint32_t src, uint32_t dest, uint32_t size) {
  if (cardCopyCount >= 8) return;
  Graphics *g = &cardCopies[cardCopyCount++];
  g->src = src; g->dest = dest; g->size = size & 0xFFFF; g->anim = 0; g->ram = NULL;
  queue_graphics(g);
}
static void card_copy_ram(const uint8_t *ram, uint32_t dest, uint32_t size) {
  if (cardCopyCount >= 8) return;
  Graphics *g = &cardCopies[cardCopyCount++];
  g->src = 0; g->dest = dest; g->size = size & 0xFFFF; g->anim = 0; g->ram = ram;
  queue_graphics(g);
}

// an entry of the UI graphics table: its tiles, palette, and how its glyphs are laid out
typedef struct { uint32_t tiles, palette; uint32_t perGlyph, size, shape, wide, high; } CardGfx;
static CardGfx card_gfx(int id) {
  uint32_t at = OFFSET_UI_GRAPHICS + (uint32_t)id * CARD_ENTRY;
  CardGfx g;
  g.tiles = rom_ptr(at); g.palette = rom_ptr(at + 4);
  g.perGlyph = rom_u32(at + 8); g.size = rom_u32(at + 12); g.shape = rom_u32(at + 16);
  g.wide = rom_u32(at + 20); g.high = rom_u32(at + 24);
  return g;
}

/** LoadStageIntroGraphics and the card's tables: the pieces' tiles in video memory, their colours, and their texts. */
// the card's tiles, 400 to 531 of the sprites' graphics, kept from the heap while it shows
enum { CARD_HEAP_TILES = 132 };
static uint32_t cardHeap;

void titlecard_start(int level, int character, int after) {
  memset(&card, 0, sizeof card);
  // gFinalBossActive, which holds the level the game last started or showed a card for, isn't this one
  card.comesOn = after && level <= CARD_LAST_SECOND_ACT && (level & 1);
  cardHeap = vram_malloc(CARD_HEAP_TILES);
  card.levelIndex = level;
  cardCopyCount = 0;
  uint32_t cardAt = OFFSET_TITLE_CARD;
  CardGfx zigzag = card_gfx(6 + character), names = card_gfx(10), bar = card_gfx(16), jp = card_gfx(17), actGfx = card_gfx(15);
  CardGfx zone = card_gfx(19 + rom_u8(cardAt + 0x20 + level));
  // the Japanese name: its tiles right-aligned in 12, the tiles from 73 before them, then tiles 8 to 11,
  // and tile 8 again over the first
  int jpCount = (int)rom_u8(cardAt + level), jpFirst = (int)rom_u8(cardAt + 0x0E + level);
  memset(jpTiles, 0, sizeof jpTiles);
  memcpy(jpTiles, &gba_rom[jp.tiles + 73 * CARD_TILE], (size_t)(12 - jpCount) * CARD_TILE);
  memcpy(jpTiles + 12 * CARD_TILE, &gba_rom[jp.tiles + 8 * CARD_TILE], 4 * CARD_TILE);
  memcpy(jpTiles + (12 - jpCount) * CARD_TILE, &gba_rom[jp.tiles + jpFirst * CARD_TILE], (size_t)jpCount * CARD_TILE);
  memcpy(jpTiles, &gba_rom[jp.tiles + 8 * CARD_TILE], CARD_TILE);
  // the act number: "ACT" and the act's digit after it
  memcpy(actTiles, &gba_rom[actGfx.tiles], 8 * CARD_TILE);
  memcpy(actTiles + 8 * CARD_TILE, &gba_rom[actGfx.tiles + 8 * CARD_TILE + (level & 1) * 4 * CARD_TILE], 4 * CARD_TILE);

  // the pieces' graphics: [tiles, tile base, entry, text offset, text count]
  card.p[PIECE_ZIGZAG].tileBase = 400;
  card.p[PIECE_NAME].tileBase = 64;
  card.p[PIECE_ACT].tileBase = 432;
  card.p[PIECE_BAR].tileBase = 444;
  card.p[PIECE_ZONE_JP].tileBase = 460;
  card.p[PIECE_ZONE].tileBase = 476;
  card_copy(zigzag.tiles, OBJ_VRAM + 400 * CARD_TILE, 32 * CARD_TILE);
  card_copy(names.tiles + (uint32_t)character * 64 * CARD_TILE, OBJ_VRAM + 64 * CARD_TILE, 64 * CARD_TILE);
  card_copy_ram(actTiles, OBJ_VRAM + 432 * CARD_TILE, sizeof actTiles);
  card_copy(bar.tiles, OBJ_VRAM + 444 * CARD_TILE, 16 * CARD_TILE);
  card_copy_ram(jpTiles, OBJ_VRAM + 460 * CARD_TILE, sizeof jpTiles);
  card_copy(zone.tiles, OBJ_VRAM + 476 * CARD_TILE, 56 * CARD_TILE);

  // the colours: the zigzag and the name use palette 15, the rest palette 6 (the HUD font's)
  for (int i = 0; i < 16; i++) e.objPalette[15 * 16 + i] = (uint16_t)rom_u16(names.palette + i * 2);
  e.flags |= FLAGS_UPDATE_OBJ_PALETTES;

  // each piece's slot and its text
  const CardGfx slots[PIECES] = { zigzag, names, actGfx, bar, { 0, 0, 4, 1, 1, 4, 1 }, { zone.tiles, zone.palette, 8, 2, 1, 4, 2 } };
  static const int TILE_COUNT[PIECES] = { 32, 64, 12, 16, 16, 56 };
  static const int PALETTE[PIECES] = { 15, 15, 6, 6, 6, 6 };
  for (int i = 0; i < PIECES; i++) {
    card.p[i].shape = (int)slots[i].shape;
    card.p[i].size = (int)slots[i].size;
    card.p[i].wide = (int)slots[i].wide;
    card.p[i].high = (int)slots[i].high;
    card.p[i].perGlyph = (int)slots[i].perGlyph;
    card.p[i].count = TILE_COUNT[i] / (slots[i].perGlyph ? (int)slots[i].perGlyph : 1);
    card.p[i].pal = PALETTE[i];
    card.p[i].order = PIECE_ORDER[i];
    for (int k = 0; k < TEXT_COUNT[i]; k++) card.p[i].text[k] = (int)rom_u8(cardAt + TEXT_AT[i] + k) - 32;
    if (i == PIECE_ZONE) { for (int k = 0; k < CARD_ZONE_PADDING; k++) card.p[i].text[TEXT_COUNT[i] + k] = -32; }
  }

  // the pieces' places (createTitleCard)
  card.p[PIECE_ZIGZAG].x = -80; card.p[PIECE_ZIGZAG].y = 0; card.p[PIECE_ZIGZAG].countNow = 3; card.p[PIECE_ZIGZAG].rows = 5; card.p[PIECE_ZIGZAG].grid = 1;
  card.p[PIECE_NAME].x = 20; card.p[PIECE_NAME].y = 0; card.p[PIECE_NAME].countNow = 1;
  card.p[PIECE_ACT].x = 180; card.p[PIECE_ACT].y = 160; card.p[PIECE_ACT].countNow = 6;
  card.p[PIECE_BAR].x = card.comesOn ? -16 : 240; card.p[PIECE_BAR].y = card.comesOn ? CARD_BAND_Y : 126; card.p[PIECE_BAR].countNow = 8;
  card.p[PIECE_ZONE_JP].x = 360; card.p[PIECE_ZONE_JP].y = 114; card.p[PIECE_ZONE_JP].countNow = 4;
  card.p[PIECE_ZONE].x = 256; card.p[PIECE_ZONE].y = 128; card.p[PIECE_ZONE].countNow = 9;

  card.frame = 0; card.done = 1; card.blank = 0; card.fading = 1;
  card.level = 0; card.speed = CARD_FADE_SPEED; card.bldY = 0;
  // the fade's first step, as the card is made
  card.level = 96;
  card.bldY = (32 - (card.level >> 8)) >> 1;
  act.cardFrame = 0; act.cardDone = 0;
}

static void card_put(int order, int shape, int size, int x, int y, int tile, int pal, int semi) {
  // the card's frames a start point runs with no picture put nothing in the OAM, which no V-blank empties
  if (!objects_drawing()) return;
  int k = alloc_oam((uint32_t)order);
  if (k < 0) return;
  e.oamMalloc[k * 4] = (uint16_t)((shape << 14) | (y & 0xFF) | (semi ? 0x400 : 0));
  e.oamMalloc[k * 4 + 1] = (uint16_t)((size << 14) | (x & 0x1FF));
  e.oamMalloc[k * 4 + 2] = (uint16_t)((pal << 12) | (tile & 0x3FF));
}

/** sub_80550F8's own sprites, on the frame it makes the card of a second act that comes on: the results' band, eight
 *  see-through squares across the screen, until the bar's task draws it from the next frame */
void titlecard_made(int first) {
  // the card's fade, as it is made: black over every layer, which have nowhere to be yet
  for (int i = 0; i < 8; i++) e.bgScroll[i] = 0;
  e.dispCnt = 0x3E40;
  e.winRegs[0] = e.winRegs[1] = 0x00F0; e.winRegs[2] = e.winRegs[3] = 0x00A0;
  e.bldCnt = 0x3FFF; e.bldY = (uint16_t)card.bldY;
  if (!act.stage.row->ownsBlend) e.bldAlpha = 0x0010;
  e.winRegs[4] = 0x3F3F;
  // the frame that makes the act still shows the results' sprites, with their fade, which leaves sprites out, and the
  // new act's colours; from the next the card's own are there
  if (first) { e.bldCnt = 0x3FDF; e.winRegs[5] = 0x1F; engine_keep_oam(); return; }
  if (!card.comesOn) return;
  for (int i = 0; i < 8; i++) card_put(1, 0, 2, i * 32, CARD_BAND_Y, 0x80, 6, 1);
}

// put(card, p, [text, y], semi): a row of sprites from (x, y), or the zigzag's grid
static void card_piece_put(CardPiece *p, int y, int semi, int textOffset) {
  int w = p->wide * 8, h = p->high * 8;
  if (!p->grid) {
    for (int i = 0; i < p->countNow; i++) {
      int g = p->text[i + textOffset] & 31;
      card_put(p->order, p->shape, p->size, (p->x + i * w) & 0x1FF, y, p->tileBase + g * p->perGlyph, p->pal, semi);
    }
    return;
  }
  int top = y;
  for (int r = 0; r < p->rows; r++, top += h) {
    int x = p->x;
    for (int i = (-p->x & 0x1FF) >> 7; i < p->countNow; i++) {
      int g = p->text[i + textOffset] & 31;
      card_put(p->order, p->shape, p->size, (x + i * w) & 0x1FF, top & 0xFF, p->tileBase + g * p->perGlyph, p->pal, semi);
    }
  }
}

// fadeStep: the brightness decrease, 16 sixteenths (black) down to 0
static int card_fade_step(int advance) {
  card.bldY = (32 - (card.level >> 8)) >> 1;
  if (!advance) return 0;
  card.level += card.speed;
  if (card.level < CARD_FADE_FULL) return 0;
  card.level = CARD_FADE_FULL;
  return 1;
}

// Task_8055730, Task_8055798, Task_8055904, Task_8055998, Task_8055AA0, Task_8055B18
static void card_tasks(int k, int semi) {
  CardPiece *zigzag = &card.p[PIECE_ZIGZAG], *name = &card.p[PIECE_NAME], *act = &card.p[PIECE_ACT];
  CardPiece *bar = &card.p[PIECE_BAR], *jp = &card.p[PIECE_ZONE_JP], *zone = &card.p[PIECE_ZONE];
  // zigzag: in from the left 8 px a frame, and out the same way
  if (k > 215) zigzag->x = s16(zigzag->x - 8);
  else if (k > 10) zigzag->x = 0;
  else if (k > 0) zigzag->x = s16(zigzag->x + 8);
  card_piece_put(zigzag, zigzag->y, semi, 0);
  // name: four sprites down the zigzag, dropping in from the top from the 27th frame and showing from the 33rd
  if (k > 215) {
    int q = s16(((k - 215) << 7) / 10);
    for (int i = 0; i < 4; i++) {
      int y = s16(-q + 32 * i);
      if (y >= -32) { name->countNow = 1; card_piece_put(name, y, semi, i); }
    }
  } else if (k > 31) {
    for (int i = 0; i < 4; i++) { name->countNow = 1; card_piece_put(name, 32 * i, semi, i); }
  } else if (k > 25) {
    int y = (((k - 215) << 7) / 6 - 176) & 0x1FF;
    if (y > 421) for (int i = 0; i < 4; i++) { name->countNow = 1; card_piece_put(name, s16(y + 32 * i), semi, i); }
  }
  // act: up from the bottom 3 px a frame to y 144, and back down 2 px a frame
  if (k > 215) { if (act->y < 160) act->y = s16(act->y + 2); }
  else if (k > 35) { act->x = 180; act->y = 144; act->countNow = 6; }
  else if (k > 30) { if (act->y > 144) act->y = s16(act->y - 3); }
  if (card.levelIndex <= CARD_LAST_ACT_LEVEL) card_piece_put(act, act->y, semi, 0);
  // bar: in from the right 26 px a frame to x -16, and out to the left, a sprite fewer every 32 px
  if (k > 215) {
    if (bar->x < -32) { bar->x = s16(bar->x + 32); if (bar->countNow != 0) bar->countNow = s16(bar->countNow - 1); }
    bar->x = s16(bar->x - 26);
  } else if (k > 25) bar->x = -16;
  else if (k > 15 && card.comesOn) { bar->x = -16; bar->y = s16(bar->y + 9); if (bar->y > 126) bar->y = 126; }   // down from the results' band
  else if (k > 15) { bar->y = 126; bar->x = s16(bar->x - 26); if (bar->x < -16) bar->x = -16; }
  card_piece_put(bar, bar->y, semi, 0);
  // zoneJp: in from the right 26 px a frame to x 112, and out to the left
  if (k > 215) jp->x = s16(jp->x - 26);
  else if (k > 25) jp->x = 112;
  else if (k > 15) { jp->x = s16(jp->x - 26); if (jp->x < 112) jp->x = 112; }
  card_piece_put(jp, jp->y, semi, 0);
  // zone: in from the right 28 px a frame, then scrolling left 2 px a frame; out to the left
  if (k > 215) {
    int old = zone->x;
    zone->x = s16(zone->x - 28);
    if (zone->x < -31) { zone->countNow = s16(zone->countNow - 1); zone->x = s16(old + 4); zone->mark = (zone->mark + 1) % 7; }
  } else if (k > 25) {
    int old = zone->x;
    zone->x = s16(old - 2); zone->countNow = 9;
    if (zone->x < -31) { zone->x = s16(old + 30); zone->mark = (zone->mark + 1) % 7; }
  } else if (k > 15) {
    zone->y = 128;
    int old = zone->x;
    zone->x = s16(zone->x - 28);
    if (zone->x < 240) {
      zone->countNow = 9 - (zone->x >> 5);
      if (zone->x < -31) { zone->x = s16(old + 4); zone->mark = (zone->mark + 1) % 7; }
    } else return;
  } else return;
  card_piece_put(zone, zone->y, semi, zone->mark);
}

/** runTitleCard: the card's tasks for one frame. Returns 0 on the frame it ends, with nothing drawn. */
int titlecard_run(int pressed) {
  card.fading = 0;
  if (pressed && card.frame > CARD_SKIP_FROM && card.frame < CARD_SKIP_TO) {
    card.frame = CARD_SKIP_TO;
    card.speed = (CARD_FADE_FULL - card.level) / 10;
    if (!card.blank) { card.done = card_fade_step(1); card.fading = 1; }
  }
  int k = card.frame, done = card.done;
  if (!card.blank && (k <= 105 || !card.done)) {
    if (k > 20) card.done = card_fade_step(1);
    else card_fade_step(0);
    card.fading = 1;
  } else card.bldY = 0;
  act.cardFrame = card.frame;
  act.cardDone = 0;
  // the frame it ends draws nothing
  card.display = 0;
  if (++card.frame > CARD_FRAMES) {
    // Task_UpdateStageTitleCard's end: the blend off, over what the camera's task set this frame
    e.bldCnt = 0; e.bldY = 0;
    act.cardFrame = card.frame; act.cardDone = 1; water_card(1); vram_free(cardHeap); return 0;
  }
  water_card(0);
  int semi = k <= 105 || !done || card.blank;
  card_tasks(k, semi);
  card.display = card.fading || card.bldY;
  return 1;
}

/** The card's fade, set over the act's display once the frame is drawn: window 0 over the whole screen and the
 * brightness decrease on every layer. */
void titlecard_display(void) {
  if (!card.display) return;
  // OBJ and window 0 on, BG1, BG2 and BG3 on, 1D OAM, and BG0 as the stage's background update left it
  e.dispCnt = (uint16_t)(0x3E40 | (e.dispCnt & 0x100));
  e.winRegs[0] = 0x00F0; e.winRegs[2] = 0x00A0;
  e.bldCnt = 0x3FFF; e.bldAlpha = 0x0010; e.bldY = (uint16_t)card.bldY;
}
