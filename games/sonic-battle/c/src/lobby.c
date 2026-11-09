// lobby.js in C: the Mini-games mode's waiting screen, translated from the JavaScript version in
// games/sonic-battle/src/lobby.js a function at a time. The link screen that an entry on the Mini-games screen leads to
// before its game, with the four player places, the pulsing "WAIT!" and the B back to the Mini-games screen. The
// original's functions are named by their address: the initializer 0x080284b4, its frame wrapper 0x08028760, the
// screen at 0x08028770, the fade at 0x08028814, the input at 0x080288b4, the leave at 0x08028ed8, the player marks at
// 0x08028f98 and 0x08029014, the wait sprite at 0x080290b4 and 0x08029060, and the scrolling layer at 0x08030d3c.
//
// The original starts its multiboot link here. With no link its player count is one, so only the first place is ready
// and the others wait, which is what this port shows. The link's own screens are not ported.

#include "game.h"
#include "menu.h"
#include "text.h"

#define SINE 0x0804DF7Cu
#define DISPCNT 0x00
#define BG3HOFS 0x1C

// the cartridge's table of the display registers the first frame writes, and how many
#define REGISTERS 0x0810C5B4u
#define REGISTER_COUNT 16

// the pictures the screen unpacks: the backgrounds' tiles, the maps, the sprites' tiles and the waiting word
#define BACKGROUND_TILES 0x0815C4B4u
#define SECOND_TILES 0x081323D4u
#define THIRD_TILES 0x0810CD78u
#define FIRST_MAP 0x0810D13Cu
#define SECOND_MAP 0x0810D20Cu
#define SPRITE_TILES 0x0810D250u
#define WAIT_WORD 0x0810D784u
#define WAIT_WORD_OTHER 0x0810D928u
#define BLOCK_TILE 0x081327D4u

// the stretch the screen's words go into, the blank row it's cleared with, and the map's rows that show it
#define BLANK_ROW 0x0600DFC0u
#define TEXT_TILES 0x0600DA80u
#define TEXT_COLUMNS 21
#define TEXT_ROWS 2
#define MAP 0x0600FC42u
#define MAP_ROW 32
#define MAP_TILES 0x52D4

// the four player places and the waiting sprite: their parts and where they sit, waiting and ready
#define MARKER_WAITING 0x08EDB97Cu
#define MARKER_READY 0x08EDB984u
#define WAIT_MULTI 0x08EDB94Cu
#define WAIT_ONE 0x08EDB974u
#define PLACES 0x08EDB98Cu
#define CHILD_X 214
#define CHILD_Y 145

// the colours the screen fades in to: backgrounds 4, then the sprites' three sets
static const uint32_t FADES[4][3] = {
  {0x05000080, 0x0810C5F4, 32}, {0x050001C0, 0x0815E67C, 16},
  {0x050001E0, 0x081326F4, 16}, {0x05000200, 0x0810C634, 64},
};

#define LOBBY_SONG 2
#define SOUND_MADE 404
#define SOUND_BACK 405
#define SONG_MADE 60
#define SONG_BACK 120
// the animated picture's place in the map and its tiles' first number
#define ANIMATION_TO 0x0600F092u
#define ANIMATION_TILE 0xE002
// 0x08021484 with no link: the player alone
#define PLAYERS_WITH_NO_LINK 1

static int players;

static void fadeIn(Node *node);
static void input(Node *node);
static void leave(Node *node);
static void nothing(Node *node);
static void markerStart(Node *node);
static void placeDraw(Node *node);
static void childStart(Node *node);
static void childDraw(Node *node);

/** 0x080283f8 with no words: every row of the stretch keeps the blank row's tiles. The copy is sixteen words, the
 *  row's two tiles, and each row starts sixty-four bytes after the one before. */
static void clearWords(void) {
  for (int row = 0; row < TEXT_COLUMNS; row++)
    for (int i = 0; i < 64; i++) gba_vram[TEXT_TILES - VRAM + (uint32_t)(row * 64 + i)] = gba_vram[BLANK_ROW - VRAM + (uint32_t)i];
}

/** 0x08028770: the four player places and the waiting sprite, which draw from this frame on. */
static void comeIn(Node *node) {
  for (int index = 0; index < 4; index++) {
    Node *marker = menuAddNode(markerStart, menuPlace(MARKER_WAITING, 0, 0, 0, 0), 1);
    marker->index = index;
  }
  node->child = menuAddNode(childStart, menuPlace(WAIT_MULTI, CHILD_X, CHILD_Y, 0, 0), 1);
  clearWords();
  node->run = fadeIn;
}

/** 0x08028814: the screen's colours step toward theirs, and once they're there the input starts. */
static void fadeIn(Node *node) {
  int arrived = 1;
  for (int i = 0; i < 4; i++) if (!fadeToward(FADES[i][0], FADES[i][1], (int)FADES[i][2])) arrived = 0;
  if (arrived) node->run = input;
}

/** 0x080288b4: no link means one player, so A does nothing and B goes back to the Mini-games screen. */
static void input(Node *node) {
  if (players != PLAYERS_WITH_NO_LINK) {
    players = PLAYERS_WITH_NO_LINK;
    clearWords();
  }
  uint16_t repeated = g.keys.repeated;
  if (repeated & KEY_A) {
    if (players > 1) {
      node->run = nothing;         // the link's transfer screens aren't ported
      gba_sound_play(SOUND_MADE);
      menuFadeSongOut(LOBBY_SONG, SONG_MADE);
    }
  } else if (repeated & KEY_B) {
    node->run = leave;
    gba_sound_play(SOUND_BACK);
    menuFadeSongOut(LOBBY_SONG, SONG_BACK);
  }
  // the waiting sprite says "wait" while one player is here, and something else when more have joined
  if (node->child) node->child->place.parts = players <= 1 ? WAIT_ONE : WAIT_MULTI;
}

static void nothing(Node *node) { (void)node; }

/** 0x08028ed8: every colour fades to black, and the Mini-games screen starts again. */
static void leave(Node *node) {
  (void)node;
  if (fadeToBlack(PALETTE, 512)) g.callback = startMiniGames;
}

/** 0x08030d3c: the moving layer, a line every other frame. */
static void scroll(Node *node) {
  node->count--;
  queueRegister(BG3HOFS, (uint16_t)((node->count & 0x1FE) >> 1));
}

/** 0x08029014: a player's place, waiting where it starts, drawn from the next frame on. */
static void markerStart(Node *node) {
  Place *position = &node->place;
  position->parts = MARKER_WAITING;
  position->tile = 0;
  position->x = read16(PLACES + (uint32_t)node->index * 8);
  position->y = read16(PLACES + (uint32_t)node->index * 8 + 2);
  position->attr0 = position->attr1 = position->attr2 = 0;
  node->run = placeDraw;
}

/** 0x0801f92c: half way to a place, rounded toward it. True once it's there. */
static int moveTo(Place *position, int x, int y) {
  position->x = x + (position->x - x) / 2;
  position->y = y + (position->y - y) / 2;
  return position->x == x && position->y == y;
}

/** 0x08028f98: a place moves to the ready spot when its player is here, and to the waiting one when not. */
static void placeDraw(Node *node) {
  Place *position = &node->place;
  int ready = players >= node->index + 1;
  uint32_t at = PLACES + (uint32_t)(node->index * 8 + (ready ? 4 : 0));
  position->parts = MARKER_WAITING;
  if (moveTo(position, read16(at), read16(at + 2)) && ready) position->parts = MARKER_READY;
  menuDraw(*position);
}

/** 0x080290b4: the waiting sprite's place and its pulse. */
static void childStart(Node *node) {
  Place *position = &node->place;
  position->parts = WAIT_MULTI;
  position->tile = 0;
  position->x = CHILD_X;
  position->y = CHILD_Y;
  position->attr0 = position->attr1 = position->attr2 = 0;
  node->timer = 0;
  node->run = childDraw;
}

/** 0x08029060: the waiting sprite breathes, a quarter turn of the table every frame. */
static void childDraw(Node *node) {
  Place *position = &node->place;
  int value = (int8_t)(read16(SINE + (uint32_t)node->timer * 64) >> 8);
  position->attr0 = 1;
  position->attr1 = (position->attr1 & 0xC1) | (menuTakeMatrix(value + 256) * 2);
  menuDraw(*position);
  node->timer = (node->timer + 4) & 0xFF;
}

/** 0x080284b4: the screen's first frame. The registers, the palette black, the pictures, the map, the list's nodes,
 *  the display on, and the song. */
void startLobby(void) {
  menuWriteRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;               // 0x0801fb94
  hideSpriteBuffer();              // 0x0801ff30
  menuReset();                     // 0x0801f780, 0x080210d8, 0x0802110c
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  for (int i = 0; i < 0x40; i++) gba_vram[i] = 0;
  decompress(BACKGROUND_TILES, 0x06000040);
  decompress(SECOND_TILES, 0x06005280);
  decompress(THIRD_TILES, 0x06008000);
  for (int i = 0; i < 0x800; i++) gba_vram[0x0600F800 - VRAM + (uint32_t)i] = 0;
  decompress(FIRST_MAP, 0x0600F800);
  decompress(SECOND_MAP, 0x0600FC00);
  uint32_t blank = ((uint32_t)(read16(MAP) & 0x3FF) + 0x400) * 32;
  textInto(TEXT_TILES, TEXT_COLUMNS, TEXT_ROWS);
  for (int i = 0; i < 32; i++) {
    gba_vram[BLANK_ROW - VRAM + (uint32_t)i] = gba_vram[blank + (uint32_t)i];
    gba_vram[BLANK_ROW - VRAM + 32 + (uint32_t)i] = gba_vram[blank + (uint32_t)i];
  }
  clearWords();
  int next = MAP_TILES;
  for (int i = 0; i <= 20; i++) {
    write16(MAP + (uint32_t)i * 2, (uint16_t)next++);
    write16(MAP + MAP_ROW * 2 + (uint32_t)i * 2, (uint16_t)next++);
  }
  for (uint32_t map = 0x0600E800; map <= 0x0600F000; map += 0x800)
    for (int i = 0; i < 0x800; i++) gba_vram[map - VRAM + (uint32_t)i] = 0;
  uint32_t to = 0x0600E000;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      copyTileBlock(to, BLOCK_TILE, 8, 8, 0xF294);
      to += 0x10;
    }
    to += 0x1C0;
  }
  decompress(SPRITE_TILES, 0x06010000);
  decompress(g.language == 0 ? WAIT_WORD : WAIT_WORD_OTHER, 0x06010E00);
  menuAddNode(menuStartFrameNode, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(comeIn, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(scroll, menuPlace(0, 0, 0, 0, 0), 0);
  Node *animation = menuAddNode(menuAnimate, menuPlace(0, 0, 0, 0, 0), 0);
  animation->to = (int)ANIMATION_TO;
  animation->tile = ANIMATION_TILE;
  queueRegister(DISPCNT, 0x1F40);  // 0x0801fba0(0, 8000), the display on
  players = 0;
  gba_sound_play(LOBBY_SONG);      // 0x0801f618(2)
  g.callback = menuFrame;          // 0x08028760
}
