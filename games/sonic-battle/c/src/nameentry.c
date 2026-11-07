// Sonic Battle's name entry, at the first start, after the title screen and before the main menu (the decompilation's
// src/unknown_08036350.cpp, 0x08036560 and the functions after it). A grid of letters scrolls behind a cursor over six
// rows of a list of 35, drawn into VRAM a pixel row at a time. A adds the letter under the cursor to a name of up to
// five, B takes the last one off, and Start keeps the name and goes on to the main menu, which is where the next start
// goes straight to. The same screen takes codes when another screen sets gUnknown_03005380; nothing reaches that yet,
// so it isn't here.
//
// This is written from games/sonic-battle/src/name-entry.js and the menu.js and core.js functions it uses, a function
// at a time, so every frame it writes is the JavaScript's. The original's functions are named in the comments by their
// address in the USA copy, as the decompilation labels them.

#include "game.h"
#include "nameentry.h"
#include "text.h"

#define ROM(addr) (gba_rom + ((addr) - CARTRIDGE))

// the cartridge's table of the display registers the first frame writes, and how many (0x0801fbfc)
#define REGISTERS 0x08156C70u
#define REGISTER_COUNT 16

#define TEXT_COLOUR 2
#define LETTER_ROOM 16

// gUnknown_08edcc3c: the list of 35 rows of ten letters, as addresses, and how many letters that makes
#define ROWS 0x08EDCC3Cu
#define ROW_COUNT 35
#define LETTER_COUNT 350
#define END 0xFFFE
#define NAME_ROOM 5

// where the letters go: the grid, the name and the slots of the letters under the cursor, and gUnknown_0807163c,
// the bit each slot has in a one-byte list, so the slots past the eighth are never marked as taken
#define GRID_TILES 0x06000800u
#define NAME_TILES 0x06002600u
#define SLOT_TILES 0x06017800u
#define SLOT_BITS 0x0807163Cu
#define NAME_SLOTS 16

// the sprites' records: the cursor's light, the letter over it, the heading and the mark beside the name
#define CURSOR_LIGHT 0x08EDCBECu
#define CURSOR_LETTER 0x08EDCBFCu
#define HEADING 0x08EDCC0Cu
#define NAME_MARK 0x08EDCC1Cu
#define SQUARE 0x081581F4u

#define NAME_SONG 4
// 0x08036560's unpacking runs past a V-blank and starts the screen's song 163,059 cycles into the next frame, as mGBA measures it
#define NAME_SONG_START_CYCLE 163059
#define SOUND_MOVE 401
#define SOUND_LETTER 402
#define SOUND_BACK 403
#define SOUND_MADE 404
#define SOUND_REFUSED 419
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
#define SONG_TABLE 0x08BF7244u
// how many frames of the song's fade make a step: 0x0801f718(4, 120) keeps 120 >> 4
#define SONG_FADE_STEP (120 >> 4)

// What the original takes to write the save to its flash (0x080217d0), once the screen is black, and which shows only
// in how long it takes, as mGBA measures it.
#define SAVING_FRAMES 20

// the display registers the kit's REG doesn't name
#define REG_BG3VOFS_ 0x1E
#define DISPCNT_ON 0x1F40

/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
static void writeRegisters(uint32_t from, int count) {
  const uint8_t *at = ROM(from);
  for (int i = 0; i < count; i++) {
    uint16_t reg = (uint16_t)(at[i * 4] | (at[i * 4 + 1] << 8));
    uint16_t value = (uint16_t)(at[i * 4 + 2] | (at[i * 4 + 3] << 8));
    gba_write(reg, value);
  }
}

// ---- the menu's list of nodes, from menu.js ----

typedef struct Position {
  uint32_t parts;
  int16_t x, y;
  uint16_t tile;
  uint8_t attr0, attr1, attr2, player, state;
} Position;

typedef struct Node Node;
struct Node {
  void (*run)(Node *);
  Position *position;
  int active, previous, next; // the list is linked, so a removed node's room is used again in order
  int count;                  // 0x08030d20's scroll counter
  Node *light, *letter;       // the cursor's two sprites
  int scrolled;               // the list's row the light's letter was drawn for
  int lateDraw, lateSlot;     // 0x08036428's second half, after the display has passed
  uint16_t lateGlyph;
};

#define MAX_NODES 512
#define MAX_DRAWN 160
static Node nodes[MAX_NODES];
static int nodeCount, head, tail, freeNode;
static Position positions[MAX_NODES];
static int positionCount, freePositionAt, positionNext[MAX_NODES];
static Position *drawn[4][MAX_DRAWN];
static int drawnCount[4];

static Position *newPosition(void) {
  if (freePositionAt >= 0) {
    int at = freePositionAt;
    freePositionAt = positionNext[at];
    return &positions[at];
  }
  if (positionCount >= MAX_NODES) return &positions[0];
  return &positions[positionCount++];
}

static void freePosition(Position *position) {
  int at = (int)(position - positions);
  if (at < 0 || at >= positionCount) return;
  positionNext[at] = freePositionAt;
  freePositionAt = at;
}

/** A sprite's record in the cartridge, as a place of its own. */
static Position *record(uint32_t at) {
  const uint8_t *b = ROM(at);
  Position *p = newPosition();
  p->parts = (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
  p->x = (int16_t)(b[4] | (b[5] << 8));
  p->y = (int16_t)(b[6] | (b[7] << 8));
  p->tile = (uint16_t)(b[8] | (b[9] << 8));
  p->attr0 = b[10]; p->attr1 = b[11]; p->attr2 = b[12]; p->player = b[13]; p->state = 0;
  return p;
}

/** A sprite's place: the parts it's made of, where, and what they add. */
static Position *place(uint32_t parts, int x, int y, int tile, int attr2) {
  Position *p = newPosition();
  p->parts = parts; p->x = (int16_t)x; p->y = (int16_t)y; p->tile = (uint16_t)tile;
  p->attr0 = 0; p->attr1 = 0; p->attr2 = (uint8_t)attr2; p->player = 0; p->state = 0;
  return p;
}

/** 0x0801f7d0: a node added at the end of the list, in a removed node's room when there is one. */
static Node *addNode(void (*run)(Node *), Position *position) {
  int at;
  if (freeNode >= 0) { at = freeNode; freeNode = nodes[at].next; }
  else {
    if (nodeCount >= MAX_NODES) return &nodes[MAX_NODES - 1];
    at = nodeCount++;
  }
  Node *node = &nodes[at];
  node->run = run; node->position = position; node->active = 1;
  node->previous = tail; node->next = -1;
  if (tail >= 0) nodes[tail].next = at; else head = at;
  tail = at;
  node->count = 0; node->light = node->letter = 0; node->scrolled = 0;
  node->lateDraw = 0; node->lateSlot = 0; node->lateGlyph = 0;
  return node;
}

/** 0x0801f8c0: a node taken off the list, with the walk through the list going on from the next. Its sprite's room
 *  is freed too, so a cursor that moves for ever keeps only the sprites the screen shows. */
static void removeNode(Node *node) {
  int at = (int)(node - nodes);
  if (at < 0 || at >= nodeCount || !node->active) return;
  if (node->previous >= 0) nodes[node->previous].next = node->next; else head = node->next;
  if (node->next >= 0) nodes[node->next].previous = node->previous; else tail = node->previous;
  node->active = 0;
  if (node->position) { freePosition(node->position); node->position = 0; }
  node->next = freeNode;
  freeNode = at;
}

/** 0x0801fed8: a sprite asks to be drawn this frame. */
static void draw(Position *position) {
  int group = (position->attr2 & 0x0C) >> 2;
  if (drawnCount[group] < MAX_DRAWN) drawn[group][drawnCount[group]++] = position;
}

/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
static void startFrame(Node *node) {
  (void)node;
  for (int g = 0; g < 4; g++) drawnCount[g] = 0;
}

/** 0x08030d20: the scrolling layer, a line every other frame. */
static void scroll(Node *node) {
  node->count--;
  queueRegister(REG_BG3VOFS_, (uint16_t)((node->count & 0x1FE) >> 1));
}

/** 0x0801f9d8: a sprite that only asks to be drawn. */
static void drawOnly(Node *node) { draw(node->position); }

/** 0x0801fda0: the sprites that asked, highest priority first and the newest first within one, into the buffer, with
 *  every sprite after them hidden, for the next V-blank to copy. */
static void drawSprites(void) {
  uint16_t *out = g.oam_buffer;
  int count = 0;
  for (int group = 0; group < 4; group++) {
    for (int i = drawnCount[group] - 1; i >= 0; i--) {
      Position *p = drawn[group][i];
      const uint8_t *bytes = ROM(p->parts);
      for (int at = 0; count < 128; at += 8) {
        int y = (int8_t)bytes[at + 6] + p->y;
        int x = (int8_t)bytes[at + 5] + p->x;
        out[count * 4] = (uint16_t)(((bytes[at + 2] + p->attr0) << 8) | (y & 0xFF));
        out[count * 4 + 1] = (uint16_t)(((bytes[at + 3] + p->attr1) << 8) | (x & 0x1FF));
        out[count * 4 + 2] = (uint16_t)(((bytes[at + 4] + p->attr2) << 8) | (p->tile + (bytes[at] | (bytes[at + 1] << 8))));
        count++;
        if (!bytes[at + 7]) break;
      }
    }
  }
  for (; count < 128; count++) out[count * 4] = 0x200;
  g.oam_buffer_full = 1;
}

// ---- the name entry ----

typedef struct {
  uint16_t name[6];
  int length, cursor, scroll, slots;
} Entry;

static Entry entry;
static int savingFrames;

static void fadeIn(Node *node);
static void entering(Node *node);
static void fadeOut(Node *node);
static void squareStart(Node *node);
static void square(Node *node);
static void drawLetter(Node *node);
static void nameSquareStart(Node *node);
static void nameSquare(Node *node);
static void markIfNamed(Node *node);
static void nameFrameScreen(void);
static void nameSavingScreen(void);
static void nameDisplayOnScreen(void);
static void nameSetUpScreen(void);

/** A letter in the middle of the 16 pixels it has. */
static void putCentred(int x, int y, uint16_t glyph) {
  putGlyph(x + 8 - (glyphWidth(glyph) >> 1), y, glyph, TEXT_COLOUR);
}

/** A row of the list's address in the cartridge. */
static uint32_t rowAt(int row) {
  const uint8_t *b = ROM(ROWS + (uint32_t)row * 4);
  return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

/** The letter at `index` in the list, counted from the first row and wrapping past the last. */
static uint16_t letterAt(int index) {
  int at = index > LETTER_COUNT - 1 ? index - LETTER_COUNT : index;
  const uint8_t *b = ROM(rowAt(at / 10) + (uint32_t)(at % 10) * 2);
  return (uint16_t)(b[0] | (b[1] << 8));
}

/** 0x08036350: the six rows of the grid, from the row the list is scrolled to. */
static void drawGrid(void) {
  for (int i = 0; i < 0x1E00; i++) gba_vram[(GRID_TILES - VRAM) + i] = 0;
  textInto(GRID_TILES, 20, 12);
  int row = entry.scroll / 10;
  for (int y = 0; y < 96; y += 16) {
    uint32_t at = rowAt(row);
    for (int x = 0; ; x += LETTER_ROOM, at += 2) {
      const uint8_t *b = ROM(at);
      uint16_t glyph = (uint16_t)(b[0] | (b[1] << 8));
      if (glyph == END) break;
      putCentred(x, y, glyph);
    }
    if (++row > ROW_COUNT - 1) row = 0;
  }
}

/** 0x080364d8: the name as it stands, with the places not chosen yet drawn as what they hold. */
static void drawName(void) {
  for (int i = 0; i < 0x300; i++) gba_vram[(NAME_TILES - VRAM) + i] = 0;
  textInto(NAME_TILES, 12, 2);
  entry.name[5] = END;
  for (int i = 0, x = 0; entry.name[i] != END; i++, x += LETTER_ROOM) putCentred(x, 0, entry.name[i]);
}

static uint32_t slotBit(int slot) {
  const uint8_t *b = ROM(SLOT_BITS + (uint32_t)slot * 4);
  return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

/** 0x08036428's first half: the first free slot, or the first slot when none is free and nothing's to be drawn. */
static int takeSlot(void) {
  int slot = 0;
  while (slot < NAME_SLOTS && (entry.slots & slotBit(slot))) slot++;
  if (slot >= NAME_SLOTS) return -1;
  entry.slots = (entry.slots | (int)slotBit(slot)) & 0xFF;
  return slot;
}

/** 0x08036428's second half: a letter drawn into its slot. */
static void drawSlot(int slot, uint16_t glyph) {
  uint32_t to = SLOT_TILES + (uint32_t)slot * 128;
  for (int i = 0; i < 128; i++) gba_vram[(to - VRAM) + i] = 0;
  textInto(to, 2, 2);
  putCentred(0, 0, glyph);
}

/** 0x080368c0: a slot given back. */
static void freeSlot(int slot) { entry.slots &= ~(int)slotBit(slot) & 0xFF; }

/** The map's entries from `to`, one after another down each of `columns` columns of `rows`, from tile `tile` on. */
static void mapDownColumns(uint32_t to, int columns, int rows, int tile) {
  for (int x = 0; x < columns; x++) {
    for (int y = 0; y < rows; y++, tile++) {
      uint32_t at = to - VRAM + (uint32_t)x * 2 + (uint32_t)y * 64;
      gba_vram[at] = tile & 0xFF;
      gba_vram[at + 1] = tile >> 8;
    }
  }
}

/** 0x08036560's first frame: no saved name, so the screen sets itself up. The title's hand-over calls this. */
void nameEntryScreen(void) { g.callback = nameSetUpScreen; }

/** 0x08036560: everything's reset, the palette black, the pictures, the maps and the grid drawn, and the list's nodes
 *  added. 0x08036560's last step then queues the display and the song for the frame that follows. */
static void nameSetUpScreen(void) {
  for (int i = 0; i < 6; i++) entry.name[i] = 0;
  entry.name[5] = END;
  entry.length = entry.cursor = entry.scroll = entry.slots = 0;
  writeRegisters(REGISTERS, REGISTER_COUNT);
  // 0x0801fb94: the queue is empty; 0x0801ff30: every sprite hidden
  g.queue_count = 0;
  hideSpriteBuffer();
  nodeCount = 0; head = tail = freeNode = -1;
  positionCount = 0; freePositionAt = -1;
  for (int gr = 0; gr < 4; gr++) drawnCount[gr] = 0;
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  decompress(0x08156D10, VRAM);
  decompress(0x08132544, 0x0600C000);
  decompress(0x08156F08, 0x06010000);
  // the language the save keeps picks the heading's picture and the row of the list the grid starts on
  decompress(g.language == 0 ? 0x0815711C : 0x08157934, 0x06010C00);
  if (g.language != 0) entry.scroll = 200;
  for (int i = 0; i < 0x800; i++) gba_vram[0x0600F800 - VRAM + i] = 0;
  decompress(0x08156EA8, 0x0600F800);
  for (int i = 0; i < 0x800; i++) gba_vram[0x0600F000 - VRAM + i] = 0;
  mapDownColumns(0x0600F1CA, 20, 12, 0x1040);
  mapDownColumns(0x0600F114, 10, 2, 0x1130);
  drawGrid();
  for (int i = 0; i < 0x800; i++) gba_vram[0x0600E800 - VRAM + i] = 0;
  decompress(0x08156DF0, 0x0600E8C0);
  uint32_t to = 0x0600E000;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      copyTileBlock(to, 0x081327D4, 8, 8, 0xF200);
      to += 0x10;
    }
    to += 0x1C0;
  }
  addNode(startFrame, 0);
  addNode(scroll, 0);
  addNode(fadeIn, 0);
  for (int row = 0, last = 9; row < 6; row++, last += 10) {
    for (int column = 0; column < 10; column++) {
      Position *p = place(SQUARE, 0, 0, 0, 12);
      p->player = (uint8_t)(last - column);
      addNode(squareStart, p);
    }
  }
  for (int i = 4; i >= 0; i--) {
    Position *p = place(SQUARE, 0, 0, 0, 12);
    p->player = (uint8_t)i;
    addNode(nameSquareStart, p);
  }
  drawName();
  addNode(drawOnly, record(HEADING));
  addNode(markIfNamed, record(NAME_MARK));
  g.callback = nameDisplayOnScreen;
}

/** 0x08036560's last step: it runs past a V-blank, and the display and the song come as it ends. */
static void nameDisplayOnScreen(void) {
  queueRegister(REG_DISPCNT, DISPCNT_ON);
  gba_sound_wave_at(g.restarted ? 136311 : NAME_SONG_START_CYCLE);
  gba_sound_play(NAME_SONG);
  g.callback = nameFrameScreen;
}

/** 0x08036898: the mark beside the name, once it has a letter. */
static void markIfNamed(Node *node) { if (entry.length) draw(node->position); }

/** 0x08036d90: the palettes fade in, and then the player can start. */
static void fadeIn(Node *node) {
  int a = fadeToward(PALETTE, 0x08156CD0, 32);
  int b = fadeToward(0x050001E0, 0x08132754, 16);
  int d = fadeToward(0x05000200, 0x08158194, 48);
  if (a && b && d) node->run = entering;
}

/** 0x080368dc: one key a frame, Start first: Start keeps the name, A and B change it, and the arrows move the cursor. */
static void entering(Node *node) {
  if (g.keys.pressed & KEY_START) {
    if (!entry.length) { gba_sound_play(SOUND_REFUSED); return; }
    for (int i = 0; i < 6; i++) g.name[i] = END;
    for (int i = 0; i < entry.length; i++) g.name[i] = entry.name[i];
    node->run = fadeOut;
    const uint8_t *song = ROM(SONG_TABLE + (uint32_t)NAME_SONG * 8);
    gba_sound_fade_out(song[4], SONG_FADE_STEP);
    gba_sound_play(SOUND_MADE);
  } else if (g.keys.pressed & KEY_A) {
    if (entry.length > NAME_ROOM - 1) entry.length = NAME_ROOM - 1;
    uint16_t letter = letterAt(entry.scroll + entry.cursor);
    if (entry.name[entry.length] != letter) {
      entry.name[entry.length] = letter;
      gba_sound_play(SOUND_LETTER);
    }
    entry.length++;
    drawName();
  } else if (g.keys.pressed & KEY_B) {
    if (entry.length) {
      entry.name[--entry.length] = 0;
      drawName();
      gba_sound_play(SOUND_BACK);
    }
  } else if (g.keys.repeated & KEY_UP) {
    if (entry.cursor > 19) entry.cursor -= 10;
    else {
      entry.scroll = entry.scroll > 9 ? entry.scroll - 10 : entry.scroll + LETTER_COUNT - 10;
      drawGrid();
    }
    gba_sound_play(SOUND_MOVE);
  } else if (g.keys.repeated & KEY_DOWN) {
    if (entry.cursor < 40) entry.cursor += 10;
    else {
      entry.scroll += 10;
      if (entry.scroll > LETTER_COUNT - 1) entry.scroll -= LETTER_COUNT;
      drawGrid();
    }
    gba_sound_play(SOUND_MOVE);
  } else if (g.keys.repeated & KEY_LEFT) {
    int before = entry.cursor / 10;
    entry.cursor = (entry.cursor - 1) & 0xFFFF;
    if (entry.cursor / 10 != before) entry.cursor = (entry.cursor + 10) & 0xFFFF;
    gba_sound_play(SOUND_MOVE);
  } else if (g.keys.repeated & KEY_RIGHT) {
    int before = entry.cursor / 10;
    entry.cursor++;
    if (entry.cursor / 10 != before) entry.cursor -= 10;
    gba_sound_play(SOUND_MOVE);
  }
}

/** 0x08036ce4: every colour fades to black, and then the name is kept and the main menu starts. */
static void fadeOut(Node *node) {
  (void)node;
  if (!fadeToBlack(PALETTE, 512)) return;
  savingFrames = SAVING_FRAMES;
  g.callback = nameSavingScreen;
}

/** The time 0x080217d0 takes, with the screen black. */
static void nameSavingScreen(void) {
  if (--savingFrames <= 0) showMenu(1);
}

static int squareX(const Position *p) { return (p->player % 10) * 16; }
static int squareY(const Position *p) { return (p->player / 10) * 16; }

/** 0x08036e08: a square of the grid takes its place, and draws from the next frame on. */
static void squareStart(Node *node) {
  Position *p = node->position;
  p->x = (int16_t)(squareX(p) + 40);
  p->y = (int16_t)(squareY(p) + 56);
  node->run = square;
}

/**
 * 0x08036e64: a square of the grid. The one under the cursor rises over four frames, and while it's up, the light and
 * the letter sit on it, in sprites of their own, whose letter changes when the list scrolls.
 */
static void square(Node *node) {
  Position *p = node->position;
  if (node->lateDraw) {
    drawSlot(node->lateSlot, node->lateGlyph);
    node->lateDraw = 0;
  }
  if (p->player == entry.cursor) {
    if (++p->state > 3) p->state = 4;
  } else if (p->state) p->state--;
  if (p->state) {
    p->tile = 80;
    p->x = (int16_t)(squareX(p) + p->state + 40);
    p->y = (int16_t)(squareY(p) - (p->state - 56));
    if (!node->light) {
      node->scrolled = entry.scroll;
      node->light = addNode(drawOnly, record(CURSOR_LIGHT));
      node->letter = addNode(drawLetter, record(CURSOR_LETTER));
      uint16_t glyph = letterAt(entry.scroll + entry.cursor);
      int slot = takeSlot();
      node->letter->position->player = (uint8_t)(slot < 0 ? 0 : slot);
      node->letter->position->tile = (uint16_t)((slot < 0 ? 0 : slot) * 4);
      if (slot >= 0) drawSlot(slot, glyph);
    } else if (node->scrolled != entry.scroll) {
      node->scrolled = entry.scroll;
      freeSlot(node->letter->position->player);
      uint16_t glyph = letterAt(entry.scroll + entry.cursor);
      int slot = takeSlot();
      node->letter->position->player = (uint8_t)(slot < 0 ? 0 : slot);
      node->letter->position->tile = (uint16_t)((slot < 0 ? 0 : slot) * 4);
      if (slot >= 0) { node->lateDraw = 1; node->lateSlot = slot; node->lateGlyph = glyph; }
    }
    node->light->position->tile = (uint16_t)(p->state * 16);
    node->light->position->x = p->x;
    node->light->position->y = p->y;
    node->letter->position->x = p->x;
    node->letter->position->y = p->y;
  } else {
    p->tile = 0;
    p->x = (int16_t)(squareX(p) + 40);
    p->y = (int16_t)(squareY(p) + 56);
    if (node->light) {
      removeNode(node->light);
      freeSlot(node->letter->position->player);
      removeNode(node->letter);
      node->light = node->letter = 0;
    }
  }
  draw(p);
}

/** 0x08037100: the letter's sprite. */
static void drawLetter(Node *node) { draw(node->position); }

/** 0x08037110: a square under the name takes its place, and draws from the next frame on. */
static void nameSquareStart(Node *node) {
  Position *p = node->position;
  p->x = (int16_t)(p->player * 16 + 80);
  p->y = 32;
  node->run = nameSquare;
}

/** 0x080370b8: a square under the name, lit where the next letter goes. */
static void nameSquare(Node *node) {
  Position *p = node->position;
  p->tile = (uint16_t)(p->player == (entry.length < 4 ? entry.length : 4) ? 80 : 0);
  p->x = (int16_t)(p->player * 16 + 80);
  p->y = 32;
  draw(p);
}

/** 0x08036888: the frame wrapper, every node in the list's order and then the sprites they asked for. A node added on
 *  the way runs in this frame too; one taken off is gone from the list before it would. */
static void nameFrameScreen(void) {
  for (int at = head; at >= 0; ) {
    Node *node = &nodes[at];
    node->run(node);
    at = node->next;
  }
  drawSprites();
}

