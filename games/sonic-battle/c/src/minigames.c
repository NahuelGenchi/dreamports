// mini-games.js in C: the Mini-games screen, chosen on the main menu, translated from the JavaScript version in
// games/sonic-battle/src/mini-games.js a function at a time. The original's functions are named by their address: the
// first frame 0x080315bc, its wrapper 0x0803186c, the handlers 0x08032724, 0x0803187c, 0x08031e68, 0x0803256c,
// 0x080325f0 and 0x08032594, and the rows' 0x08032790, 0x080327bc and 0x080327ec, with the arrows' 0x080281c8,
// 0x08028200, 0x08027eb8, 0x08027f38, 0x08028318 and 0x08028350. Four rows of a list of five, a picture and a caption
// for the one chosen, and a frame around it. An entry the save hasn't opened shows as question marks and can't be chosen.
//
// The rows' names and the caption are drawn into VRAM's tiles, a row in each of six slots (0x080211d8), over a copy of
// the blank row the sprites' tiles hold, so a row that scrolls off gives its slot to the next.

#include "game.h"
#include "menu.h"
#include "text.h"

#define DISPCNT 0x00
#define BG3VOFS 0x1E

// the cartridge's table of the display registers the first frame writes, and how many
#define REGISTERS 0x08132394u
#define REGISTER_COUNT 16

// gUnknown_08edc2d4: the sprites' records, 16 bytes each, and which is which
#define RECORDS 0x08EDC2D4u
enum { HEADING = 0, HEADING_END = 1, ROWS = 2, ROW_ABOVE = 6, ROW_BELOW = 7, FRAME = 8, PICTURE = 9, CAPTION = 10 };
// gUnknown_08edc494 and gUnknown_08edb84c: the frame's four pictures, and which shows at each step of its pulse
#define FRAME_PARTS 0x08EDC494u
#define FRAME_STEPS 0x08EDB84Cu
// gUnknown_08edc4a4: where each of the four rows goes on the screen
#define ROW_Y 0x08EDC4A4u
#define ROW_X 104
#define FRAME_Y 12
// where a row leaving goes, above the screen or below it
#define ROW_GONE_ABOVE -16
#define ROW_GONE_BELOW 160
// gUnknown_08edb93c: the arrows' parts, and where they sit, off the screen when there's no more list that way
#define ARROW_PARTS 0x08EDB93Cu
#define ARROW_X 168
#define ARROW_ATTR2 240
#define ARROW_DOWN_TILE 16
#define ARROW_UP_Y 16
#define ARROW_UP_GONE -16
#define ARROW_DOWN_Y 144
#define ARROW_DOWN_GONE 176

// gUnknown_08edc384 and gUnknown_08edc3a0: each entry's picture and palette, and those of an entry that isn't open
#define PICTURES 0x08EDC384u
#define PICTURE_PALETTES 0x08EDC3A0u
#define LOCKED 6
// gUnknown_030052fc, which the first frame points at gUnknown_08edc3e0 for English: the entries' names, the name of an
// entry that isn't open, and the two captions, the third entry's and the others'
static const uint32_t NAMES[6] = {0x08EDC3BC, 0x08EDC3E0, 0x08EDC404, 0x08EDC428, 0x08EDC44C, 0x08EDC470};
#define LOCKED_NAME 6
#define CAPTION_OWN 7
#define CAPTION_MULTI 8
#define OWN_ENTRY 2
// the tiles the first frame unpacks those names' sprites from, by language
static const uint32_t SPRITE_WORDS[6] = {0x08133118, 0x081334D8, 0x081334D8, 0x081334D8, 0x081334D8, 0x081334D8};
// gUnknown_0807163c: the bit of the save's list that opens each entry
#define ENTRY_BITS 0x0807163Cu
#define ENTRIES 5

#define BLANK_ROW 0x06010420u
#define ROW_TILES 0x06015000u
#define ROW_BYTES 0x800
#define CAPTION_TILES 0x06013E00u
#define CAPTION_BYTES 0x200
#define PICTURE_TILES 0x06014000u
#define PICTURE_COLOURS 0x05000200u
#define ROW_TILE 640
#define ROW_TILE_STEP 64

// the line the screen has reached as the first picture's tiles finish unpacking with only the first entry open, which
// shows only in how far down that frame they reach, as mGBA measures it; other letters finish below the picture
#define PICTURE_DONE_LINE 108
#define PICTURE_DONE_LATER 159

#define SOUND_MOVE 401
#define SOUND_MADE 404
#define SOUND_BACK 405
#define SOUND_REFUSED 419
#define MINI_GAMES_SONG 1
#define SONG_FADE 60
// where the main menu's song starts in its frame when the screen goes back to it, as mGBA measures it after the fade
#define MENU_SONG_START_CYCLE 39422
// the frames the original's fade to black takes past the Dreamport's before the waiting screen starts
#define FRAMES_TO_BLACK 3

// Unpacking a long picture on a move takes past the interrupt at line 1 (0x08018654), so SoundMain takes the console's
// cycles first, and the colours land that much later: the lines drawn by then keep the old ones, which shows when the
// frame's long enough to reach the picture, at line 49. These are the cycles from the V-blank's start, as mGBA measures
// them: to the tiles' unpacking, which going down takes longer to reach, from it to the colours' unpacking, to line 1,
// to line 0's being drawn and each line after it, and when the sound chip's DMA takes its turn, the same in every frame.
#define BEFORE_TILES_UP 2169
#define BEFORE_TILES_DOWN 2189
#define TILES_TO_COLOURS 250
#define DMA_FIRST 775
#define DMA_EVERY 25536
#define DMA_CYCLES 18
// A move can take past the next V-blank too, with the picture's unpacking, SoundMain and the new letters added up. Past
// the first of these cycles a frame of the list is lost, as mGBA measures it, past the second the frame's sprites miss
// that V-blank too, so they take the frame after, and past the third, with less left to do by then, its scroll does.
#define FRAME_PASSES_V_BLANK 245000
#define SPRITES_PASS_V_BLANK 246600
#define SCROLL_PASSES_V_BLANK 267500

static int picture_entry;

static void entryChoosing(Node *node);
static void comeIn(Node *node);
static void comeInRest(Node *node);
static void row(Node *node);
static void rowOutAbove(Node *node);
static void rowOutBelow(Node *node);
static void arrowStart(Node *node);
static void arrowSettled(Node *node);
static void arrowSlideUp(Node *node);
static void arrowSlideDown(Node *node);
static void leaveToMenu(Node *node);
static void leaveToEntry(Node *node);
static void leaveToItsProgram(Node *node);
static void nothing(Node *node);
static void displayOn(void);

/** A sprite's record in the cartridge, as a place of its own. */
static Place record(int number) { return menuRecord(RECORDS + (uint32_t)number * 16); }

/** The text at `number` of the list the language gives. */
static uint32_t nameAt(int number) { return read32(NAMES[g.language] + (uint32_t)number * 4); }

/** Whether the save has opened an entry. */
static int isOpen(int entry) { return (g.mini_games_open & read32(ENTRY_BITS + (uint32_t)entry * 4)) != 0; }

/** An entry's picture or palette, from one of the cartridge's tables, or the locked one's. */
static uint32_t pictureOf(uint32_t table, int entry) { return read32(table + (uint32_t)(isOpen(entry) ? entry : LOCKED) * 4); }

/** 0x08032618, as the first frame and the scrolling each write it: a blank row in a new slot with the entry's name. */
static Node *addRow(int recordNumber, int entry) {
  Node *node = menuAddNode(row, record(recordNumber), 1);
  node->place.state = menuTakeSlot();
  node->place.tile = node->place.state * ROW_TILE_STEP + ROW_TILE;
  uint32_t to = ROW_TILES + ((uint32_t)node->place.state << 11);
  for (int i = 0; i < ROW_BYTES; i++) gba_vram[to - VRAM + (uint32_t)i] = gba_vram[BLANK_ROW - VRAM + (uint32_t)i];
  uint32_t text = nameAt(isOpen(entry) ? entry : LOCKED_NAME);
  textInto(to, 16, 4);
  putText(64 - (textWidth(text) >> 1), 2, text);
  return node;
}

/** The tiles and the palette of the entry chosen's picture, each as the cartridge's table has it. */
static void showPictureTiles(int entry) { decompress(pictureOf(PICTURES, entry), PICTURE_TILES); }
static void showPictureColours(int entry) { decompress(pictureOf(PICTURE_PALETTES, entry), PICTURE_COLOURS); }
static void firstPictureTiles(void) { showPictureTiles(0); }
static void lateColours(void) {
  showPictureColours(picture_entry);
  gba_update_colors();
}

/** The cycles the sound chip's DMA has added by the time this much work is done. */
static int32_t withDma(int32_t work) {
  int32_t at = work, last = -1;
  while (at != last) {
    last = at;
    at = work + DMA_CYCLES * ((last - DMA_FIRST) / DMA_EVERY + 1);
  }
  return at;
}

/** The entry's picture on a move, with its colours landing at once if the tiles are done before line 1. */
static void showPicture(int entry, int32_t beforeTiles) {
  int32_t sound = g.sound_cycles;
  int32_t tiles = unpackCycles(pictureOf(PICTURES, entry));
  int32_t toColours = beforeTiles + tiles + TILES_TO_COLOURS;
  int line = toColours < LINE_ONE ? -1 : (withDma(toColours + sound) - LINE_ZERO_DRAWN) / LINE_CYCLES;
  g.move_cycles = tiles + unpackCycles(pictureOf(PICTURE_PALETTES, entry)) + sound;
  showPictureTiles(entry);
  if (line < 0) showPictureColours(entry);
  else {
    picture_entry = entry;
    g.line_work_line = line;
    g.line_work = lateColours;
  }
}

/** What a move's cycles leave of the frame's sprites and scroll for the next V-blank. */
static void moveDone(void) {
  int32_t cycles = g.move_cycles + g.text_cycles;
  if (cycles >= SPRITES_PASS_V_BLANK) menuRunsLate(1);
  else if (cycles >= FRAME_PASSES_V_BLANK) menuRunsLate(0);
  if (cycles >= SCROLL_PASSES_V_BLANK) g.hold_queue = 1;
}

/** 0x0803268c: the caption under the picture, which an entry that isn't open doesn't have. */
static void showCaption(int entry) {
  for (int i = 0; i < CAPTION_BYTES; i++) gba_vram[CAPTION_TILES - VRAM + (uint32_t)i] = 0;
  if (!isOpen(entry)) return;
  uint32_t text = nameAt(entry == OWN_ENTRY ? CAPTION_OWN : CAPTION_MULTI);
  textInto(CAPTION_TILES, 8, 2);
  putText(32 - (textWidth(text) >> 1), 0, text);
}

/** 0x08032778: the moving layer, a line every frame. */
static void scroll(Node *node) {
  queueRegister(BG3VOFS, (uint16_t)(node->count & 0xFF));
  node->count--;
}

/** 0x08032724: the first palette and the sprites' last fade in, and once they have, the rest of the screen comes. */
static void fadeIn(Node *node) {
  int backgrounds = fadeToward(PALETTE, 0x08132774, 16);
  int sprites = fadeToward(0x050003A0, 0x081329B4, 48);
  if (backgrounds && sprites) node->run = comeIn;
}

/**
 * 0x0803187c: the four rows, the two arrows, and the first entry's picture and caption. Its letters and unpacking run
 * past a V-blank, as mGBA measures it: the picture's tiles finish as the screen is drawn, and its colours and the
 * caption after it, along with the rest of the frame's list.
 */
static void comeIn(Node *node) {
  node->selected = 0;
  node->top = 0;
  for (int entry = 0; entry < 4; entry++) node->rows[entry] = addRow(ROWS + entry, entry);
  node->left = menuAddNode(arrowStart, menuPlace(ARROW_PARTS, 0, 0, 0, ARROW_ATTR2), 1);
  node->left->base_x = ARROW_X;
  node->left->base_y = ARROW_UP_Y;
  node->right = menuAddNode(arrowStart, menuPlace(ARROW_PARTS, 0, 0, ARROW_DOWN_TILE, ARROW_ATTR2), 1);
  node->right->base_x = ARROW_X;
  node->right->base_y = ARROW_DOWN_Y;
  g.line_work_line = g.mini_games_open == 1 ? PICTURE_DONE_LINE : PICTURE_DONE_LATER;
  g.line_work = firstPictureTiles;
  node->run = comeInRest;
  menuPause();
}

static void comeInRest(Node *node) {
  showPictureColours(0);
  showCaption(0);
  node->place = record(FRAME);
  node->run = entryChoosing;
}

/** Up: the choice moves up the list, and the list with it when it reaches the top row. */
static void moveUp(Node *node) {
  g.move_cycles = 0;
  g.text_cycles = 0;
  if (node->selected != 0) {
    node->selected--;
    showPicture(node->selected, BEFORE_TILES_UP);
    showCaption(node->selected);
    gba_sound_play(SOUND_MOVE);
  }
  if (node->selected < node->top + 1 && node->top != 0) {
    node->top--;
    node->rows[3]->run = rowOutBelow;
    for (int i = 2; i >= 0; i--) node->rows[i]->place.player = i + 1;
    Node *above = addRow(ROW_ABOVE, node->top);
    for (int i = 3; i > 0; i--) node->rows[i] = node->rows[i - 1];
    node->rows[0] = above;
  }
  node->left->run = arrowSlideUp;
  node->left->place.state = 0;
  moveDone();
}

/** Down: the choice moves down the list, and the list with it, the once it can, when it passes the second row. */
static void moveDown(Node *node) {
  g.move_cycles = 0;
  g.text_cycles = 0;
  if (node->selected + 1 > ENTRIES - 1) node->selected = ENTRIES - 1;
  else {
    node->selected++;
    showPicture(node->selected, BEFORE_TILES_DOWN);
    showCaption(node->selected);
    gba_sound_play(SOUND_MOVE);
  }
  if (node->selected > node->top + 1 && node->top == 0) {
    node->top = 1;
    node->rows[0]->run = rowOutAbove;
    for (int i = 1; i < 4; i++) node->rows[i]->place.player = i - 1;
    for (int i = 0; i < 3; i++) node->rows[i] = node->rows[i + 1];
    node->rows[3] = addRow(ROW_BELOW, node->top + 3);
  }
  node->right->run = arrowSlideDown;
  node->right->place.state = 0;
  moveDone();
}

/** 0x0801f914: half way from where it is to where it's going, rounded toward where it's going. */
static int halfway(int target, int now) { return target + (now - target) / 2; }

/** 0x0801f9a8: a sprite half way down to `y`. True once it's there. */
static int moveToward(Place *position, int y) {
  position->y = halfway(y, position->y);
  return position->y == y;
}

/** 0x08031e68: A chooses an entry that's open, B goes back and up and down move the choice, with the frame pulsing. */
static void entryChoosing(Node *node) {
  uint16_t pressed = g.keys.pressed;
  if (pressed & KEY_A) {
    if (isOpen(node->selected)) {
      node->run = node->selected == OWN_ENTRY ? leaveToItsProgram : leaveToEntry;
      gba_sound_play(SOUND_MADE);
      menuFadeSongOut(MINI_GAMES_SONG, SONG_FADE);
    } else gba_sound_play(SOUND_REFUSED);
  } else if (pressed & KEY_B) {
    node->run = leaveToMenu;
    gba_sound_play(SOUND_BACK);
  } else if (pressed & KEY_UP) moveUp(node);
  else if (pressed & KEY_DOWN) moveDown(node);
  Place *position = &node->place;
  moveToward(position, reads16(ROW_Y + (uint32_t)(node->selected - node->top) * 2) + FRAME_Y);
  position->parts = read32(FRAME_PARTS + (uint32_t)read8(FRAME_STEPS + (uint32_t)((position->state & 28) >> 2)) * 4);
  menuDraw(*position);
  position->state = (position->state + 1) & 0xFF;
  node->left->base_y = halfway(node->selected != 0 ? ARROW_UP_Y : ARROW_UP_GONE, node->left->base_y);
  node->right->base_y = halfway(node->selected <= 3 ? ARROW_DOWN_Y : ARROW_DOWN_GONE, node->right->base_y);
}

/** The main menu again (0x08039e20), with its song coming with its display, not a frame before, as mGBA measures it. */
static void menuSongAndDisplay(void) {
  gba_sound_wave_at(MENU_SONG_START_CYCLE);
  gba_sound_play(MINI_GAMES_SONG);
  menuDisplayOn();
}

static void menuAgain(void) {
  showMenu(0);
  g.callback = menuSongAndDisplay;
}

/** Two frames on from the fade, as what the main menu unpacks takes as long here as the name entry's frame and its own
 *  do from the title. */
static void menuAfterFadeWait(void) { g.callback = menuAgain; }
static void menuAfterFade(void) { g.callback = menuAfterFadeWait; }

/** 0x0803256c: every colour fades to black, and the main menu starts again, on the choice it made. */
static void leaveToMenu(Node *node) {
  (void)node;
  if (fadeToBlack(PALETTE, 512)) g.callback = menuAfterFade;
}

/** 0x080325f0: every colour fades to black, and then 0x080284b4 starts the entry's waiting screen. The original's
 *  fade reaches black three frames after the Dreamport's, and its screen stays black until the first frame there. */
static void leaveToEntry(Node *node) {
  if (!fadeToBlack(PALETTE, 512)) return;
  node->wait++;
  if (node->wait > FRAMES_TO_BLACK) g.callback = startLobby;
}

/**
 * 0x08032594, for the third entry: every colour fades to white, and then the original unpacks a program from the
 * cartridge into work RAM and restarts into it, which isn't ported, so it stops.
 */
static void leaveToItsProgram(Node *node) {
  if (fadeToWhite(PALETTE, 512)) node->run = nothing;
}

static void nothing(Node *node) { (void)node; }

/** 0x08032790: a row half way to its place, drawn. */
static void row(Node *node) {
  Place *position = &node->place;
  position->x = halfway(ROW_X, position->x);
  moveToward(position, reads16(ROW_Y + (uint32_t)position->player * 2));
  menuDraw(*position);
}

/** 0x080327bc and 0x080327ec: a row leaving the top or the bottom of the screen, which gives up its slot when it's gone. */
static void rowOut(Node *node, int y) {
  if (moveToward(&node->place, y)) {
    menuGiveSlot(node->place.state);
    menuRemoveNode(node);
  } else menuDraw(node->place);
}
static void rowOutAbove(Node *node) { rowOut(node, ROW_GONE_ABOVE); }
static void rowOutBelow(Node *node) { rowOut(node, ROW_GONE_BELOW); }

/** 0x080281c8 and 0x08028200: an arrow takes its place, and draws from the next frame on. */
static void arrowSettle(Node *node) {
  node->place.x = node->base_x - 16;
  node->place.y = node->base_y - 16;
  node->place.attr0 = 0;
  node->place.attr1 = 0;
}

static void arrowStart(Node *node) {
  arrowSettle(node);
  node->run = arrowSettled;
}

/** 0x08028318 and 0x08028350: an arrow at rest. */
static void arrowSettled(Node *node) {
  arrowSettle(node);
  menuDraw(node->place);
  node->place.state = (node->place.state + 4) & 0xFF;
}

/** 0x08027eb8 and 0x08027f38's shared steps: the arrow grows for four frames and shrinks back in steps of three. */
static void arrowSlide(Node *node, int up) {
  int value;
  if (node->place.state > 15) {
    node->run = arrowSettled;
    value = 0;
  } else if (node->place.state > 3) value = 4 - (node->place.state - 4) / 3;
  else value = node->place.state;
  node->place.x = node->base_x - 32;
  node->place.y = up ? node->base_y - (value + 32) : node->base_y + (value - 32);
  node->place.attr0 = 3;
  node->place.attr1 = menuTakeMatrix(value * 16 + 256) * 2;
  menuDraw(node->place);
  node->place.state = (node->place.state + 1) & 0xFF;
}
static void arrowSlideUp(Node *node) { arrowSlide(node, 1); }
static void arrowSlideDown(Node *node) { arrowSlide(node, 0); }

/**
 * 0x080315bc: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures, the list's
 * nodes, and the display queued on for the next V-blank.
 */
void startMiniGames(void) {
  menuWriteRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;               // 0x0801fb94
  hideSpriteBuffer();              // 0x0801ff30
  menuReset();                     // 0x0801f780, 0x080210d8, 0x0802110c
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  for (int i = 0; i < 0x20; i++) gba_vram[i] = 0;
  for (int i = 0; i < CAPTION_BYTES; i++) gba_vram[CAPTION_TILES - VRAM + (uint32_t)i] = 0;
  for (int i = 0; i < 0x1000; i++) gba_vram[PICTURE_TILES - VRAM + (uint32_t)i] = 0;
  decompress(0x08132544, 0x06000020);
  decompress(0x08132A14, 0x06010000);
  decompress(SPRITE_WORDS[g.language], 0x06012420);
  for (uint32_t map = 0x0600E800; map <= 0x0600F800; map += 0x800)
    for (int i = 0; i < 0x800; i++) gba_vram[map - VRAM + (uint32_t)i] = 0;
  uint32_t to = 0x0600E000;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      copyTileBlock(to, 0x081327D4, 8, 8, 1);
      to += 0x10;
    }
    to += 0x1C0;
  }
  menuAddNode(menuStartFrameNode, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(fadeIn, menuPlace(0, 0, 0, 0, 0), 1);
  menuAddNode(scroll, menuPlace(0, 0, 0, 0, 0), 0);
  static const int SHOWN[4] = {HEADING, HEADING_END, PICTURE, CAPTION};
  for (int i = 0; i < 4; i++) menuAddNode(menuDrawOnly, record(SHOWN[i]), 1);
  gba_sound_play(MINI_GAMES_SONG);
  g.callback = displayOn;
}

/** 0x080315bc's last step, a frame behind its song: it runs past a V-blank, and the display is queued for the next. */
static void displayOn(void) {
  queueRegister(DISPCNT, 0x1F40);
  g.callback = menuFrame;          // 0x0803186c
}
