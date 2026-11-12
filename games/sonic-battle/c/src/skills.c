// skills.js in C: Emerl's screen, which the story map opens with R, by way of the initializer 0x08021b0c. It shows
// Emerl and a menu of five: Edit skills, Change memory, Skill list, Exchange skills and Return to game. Nothing leads
// here yet, so `skills` in the address is a recording's start point.
//
// It's built from the same list of nodes as the main menu (menu.c).

#include "game.h"
#include "menu.h"
#include "text.h"

// the cartridge's table of the display registers the initializer writes, and how many
#define REGISTERS 0x0810C074u
#define REGISTER_COUNT 16
#define DISPCNT 0x00
#define BG0HOFS 0x10
#define BG1HOFS 0x14

// the colours the screen fades in to
#define BACKGROUND_COLOURS 0x0810C0B4u
#define SPRITE_COLOURS 0x0810C2B4u
#define SPRITE_PALETTE 0x05000200u

// the five choices' pictures, one after another in the USA copy, each taken to a slot of sprite tiles as it's needed
#define CHOICES 5
#define LAST (CHOICES - 1)
#define CHOICE_BYTES 1152
#define CHOICE_PICTURES 0x080B3D98u
#define CHOICE_TILES 0x06015300u
#define CHOICE_FIRST_TILE 664
#define CHOICE_SLOT_TILES 36
// the parts of a choice's sprite and of the cursor's eight frames, and which of them each of its eight steps shows
#define PARTS_CHOICE 0x08EDB498u
#define PARTS_CURSOR 0x08EDB740u
#define CURSOR_STEPS 0x08EDB84Cu
#define CURSOR_TILE 336
// where the choices rest, and how far apart
#define REST_X 120
#define FIRST_Y 16
#define ROW 24
#define ENTER_X 256

#define SKILLS_SONG 31
#define SOUND_MOVE 417
#define SOUND_MADE 405
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
#define SONG_TABLE 0x08BF7244u
// how many frames of the song's fade make a step: 0x0801f718(31, 60) keeps 60 >> 4
#define SONG_FADE_STEP (60 >> 4)

// Edit skills, the first of the four choices (0x080221e0): each category's first picture and how many rows it has, in
// gUnknown_08edb828, and the row pictures themselves
#define EDIT_ROWS 0x08EDB828u
#define EDIT_PICTURES 0x080AAD98u
#define EDIT_TILES 0x06015300u
#define EDIT_PICTURE_BYTES 1152
// the four category tabs' pictures and parts, in the English copy, and the two layers' map
static const uint32_t TAB_PICTURES[4] = {0x0807C29C, 0x0807C370, 0x0807C458, 0x0807C540};
static const uint32_t TAB_PARTS[4] = {0x08EDB638, 0x08EDB648, 0x08EDB658, 0x08EDB668};
#define TAB_MAP 0x0807BF98u
// the header's place and the rows' places, and the cursor's parts and frames
#define HEADER_X 104
#define HEADER_Y 8
#define ROW_X 120
#define FIRST_ROW_Y 36
#define ROW_STEP 24
#define ROW_PARTS 0x08EDB498u
#define FIRST_ROW_TILE 664
#define ROW_TILE_STEP 36
#define EDIT_CURSOR_PARTS 0x08EDB740u
#define EDIT_CURSOR_STEPS 0x08EDB84Cu
#define EDIT_CURSOR_TILE 336
// how many rows of the category fit at once, and how many sprites the screen may have at once
#define VISIBLE 5
#define TILE_SLOTS 10
#define SOUND_ENTER 416

// The skills themselves: the table of 309 (eight bytes each: cost, then the row it belongs to at the fourth and its
// colour at the fifth), the ids each row starts with, the bit each id sets in the equipped skills, and the icons
#define SKILL_COUNT 309
#define SKILL_TABLE 0x0810B32Cu
#define SKILL_STARTERS 0x0810B2F4u
#define SKILL_BITS 0x0807163Cu
#define ICON_TABLE 0x0808FDB8u
#define ICON_BYTES 256
#define ICON_TILES 0x06015200u
// a row of the list that holds every skill, for the rows that list a starter's replacements
#define ALL_SKILLS 255
#define LIST_LIMIT 0x1FF
// what the save keeps: whether each skill is owned (0xFF when it isn't), the points the skills may cost, which of
// its records is equipped, and that record's 27 ids, 56 bytes apiece
#define SAVE_OWNED (SAVE + 0x120u)
#define SAVE_POINTS (SAVE + 124u)
#define SAVE_RECORD (SAVE + 0x320u)
#define SAVE_IDS (SAVE + 0x322u)
#define RECORD_BYTES 56
#define EQUIPPED 27
#define NOT_OWNED 0xFF
#define STARTER_OWNED 1
#define NEW_SAVE_POINTS 30
// each point is five of the cost's units
#define POINT_UNITS 5
// the grid of twelve boxes, four across and three down: the columns' x and then the rows' y, each a halfword
#define GRID_PLACES 0x08EDB91Cu
#define GRID_ACROSS 4
#define GRID_DOWN 3
#define GRID_BOXES (GRID_ACROSS * GRID_DOWN)
#define GRID_ROWS_AT 4
// the grid's pieces: a box without and with its skill equipped, the panel with the skill's details, the points
// spent and the points there are, their digits, the scroll thumb, the cursor, and the R tab for more
#define PARTS_BOX 0x08EDB570u
#define PARTS_BOX_EQUIPPED 0x08EDB568u
#define PARTS_INFO 0x08EDB4C8u
#define PARTS_POINTS 0x08EDB5C0u
#define PARTS_DIGIT 0x08EDB5B8u
#define PARTS_THUMB 0x08EDB820u
#define PARTS_TAB 0x08EDB4F0u
#define GRID_CURSOR_PARTS 0x08EDB750u
#define GRID_CURSOR_STEPS 0x08EDB84Cu
#define GRID_CURSOR_TILE 336
#define DIGITS 7
#define SLASH 10
#define SOUND_DENIED 419
#define SOUND_EQUIP 418
// the picture and map the grid's frame is drawn with, the stretch of text it clears, and the map entries it numbers
#define GRID_PICTURE 0x0807C620u
#define GRID_MAP 0x0807C060u
#define GRID_TEXT 0x0600B000u
#define GRID_TEXT_BYTES 0x1C00
#define GRID_FRAME_AT 0x0600F11Au
#define GRID_FRAME_FIRST 0x1180
#define GRID_FRAME_ACROSS 15
#define GRID_FRAME_DOWN 14
#define GRID_FRAME_STRIDE 64
// the sprites' colour for a skill nobody owns, and how the others' colour comes from the skill's code
#define COLOUR_UNOWNED 0xFC
#define COLOUR_LAST_OWN_CODE 19
#define COLOUR_LAST_FIRST_TABLE 8
#define COLOUR_ELSE 156
#define COLOUR_SECOND_TABLE 20

// the screen's own state: its count of frames, the slots of sprite tiles taken, the category shown, and the x the
// whole screen has slid to
static int frames, slots, category, screenX;
// 0x03004dbc's first byte: the choice the menu's cursor comes back to
static int selection;
// 0x03004dbc's bytes 4 and 5 for each category: the row the cursor was on and how far the rows had scrolled
static int savedRow[4], savedPage[4];
// the grid of a row's skills (0x03004dd0 to 0x03004df0): the row, the skill under the cursor, how many skills it
// lists, how far it's scrolled, the cursor's place, and the list itself
static int listRow, listSkill, listCount, listScroll, listCursor;
static uint16_t skillList[LIST_LIMIT + 1];
// the points spent and the points there are (0x03004dc4, 0x03004da8, 0x03004dac), and the skills equipped, a bit each
static int spent, maxPoints, pointsLimit;
static uint32_t equipped[16];
// 0x03004dbc's byte 3 (the grid is leaving) and halfword 18 (the details are open)
static int gridLeaving, gridInfo;

/** A value halfway to `target`, rounded toward the target, as 0x0801f92c and 0x0801f9a8 step a sprite. */
static int halfway(int value, int target) { return target + (value - target) / 2; }

static void nothing(Node *node) { (void)node; }
static void startFrame(Node *node) { (void)node; menuStartFrame(); }
static void choiceStart(Node *node);
static void choiceRest(Node *node);
static void slideIn(Node *node);
static void cursorStart(Node *node);
static void menuChoosing(Node *node);
static void editEntry(Node *node);
static void menuReturn(Node *node);

/** 0x080211f0: the first of the ten slots nobody has, or ten when they're all taken. */
static int takeSlot(void) {
  for (int slot = 0; slot < TILE_SLOTS; slot++) {
    if (!(slots & (1 << slot))) {
      slots |= 1 << slot;
      return slot;
    }
  }
  return TILE_SLOTS;
}

/** 0x08021244: a slot given back. */
static void giveSlot(int slot) { slots &= ~(1 << slot); }

/** 0x0801f92c: a sprite half way to `x` and `y`. True once it's there. */
static int moveTo(Place *position, int x, int y) {
  position->x = halfway(position->x, x);
  position->y = halfway(position->y, y);
  return position->x == x && position->y == y;
}

/** 0x0801f978: a sprite half way to `x`. True once it's there. */
static int moveX(Place *position, int x) {
  position->x = halfway(position->x, x);
  return position->x == x;
}

/** 0x08022f40: both palettes fade in, and then the menu comes. */
static void menuStart(Node *node);
static void fadeIn(Node *node) {
  int background = fadeToward(PALETTE, BACKGROUND_COLOURS, 256);
  int sprites = fadeToward(SPRITE_PALETTE, SPRITE_COLOURS, 256);
  if (background && sprites) node->run = menuStart;
}

/** 0x08021f34: each choice's picture copied to its slot of tiles after the next V-blank, and its sprite added. The
 *  allocator (0x080211d8, 0x080211f0) has ten slots, all free here, so the five take the first five. */
static void menuStart(Node *node) {
  for (int i = 0; i < CHOICES; i++) {
    int slot = takeSlot();
    queueCopy(CHOICE_TILES + (uint32_t)(slot * CHOICE_BYTES), CHOICE_PICTURES + (uint32_t)(i * CHOICE_BYTES),
              CHOICE_BYTES);
    Node *choice = menuAddNode(choiceStart, menuPlace(0, 0, 0, slot * CHOICE_SLOT_TILES + CHOICE_FIRST_TILE, 0), 1);
    choice->row = i;
    choice->slot = slot;
    node->list[i] = choice;
  }
  node->run = slideIn;
}

/** 0x0802446c: a choice takes its place off the right of the screen, and draws from the next frame on. */
static void choiceStart(Node *node) {
  node->place.parts = PARTS_CHOICE;
  node->place.x = ENTER_X;
  node->place.y = node->row * ROW + FIRST_Y;
  node->place.attr2 = 12;
  node->run = choiceRest;
}

/** 0x080244ac: a choice at rest. */
static void choiceRest(Node *node) { menuDraw(node->place); }

/** 0x08022004: the choices slide in, halving the distance each frame, and then the cursor comes. */
static void slideIn(Node *node) {
  int arrived = 0;
  for (int i = 0; i < CHOICES; i++) {
    Place *position = &node->list[i]->place;
    int y = node->list[i]->row * ROW + FIRST_Y;
    position->y = halfway(position->y, y);
    position->x = halfway(position->x, REST_X);
    if (position->x == REST_X && position->y == y) arrived++;
  }
  if (arrived > 3) {
    node->cursor = menuAddNode(cursorStart, menuPlace(0, 0, 0, CURSOR_TILE, 0), 1);
    node->cursor->row = selection;
    node->run = menuChoosing;
  }
}

/** 0x08024994, with 0x0801f9a8: the cursor's frame from the screen's count of frames, and halfway to its row. */
static void cursor(Node *node) {
  int step = read8(CURSOR_STEPS + (uint32_t)((frames & 28) >> 2));
  node->place.parts = read32(PARTS_CURSOR + (uint32_t)(step * 4));
  node->place.y = halfway(node->place.y, node->row * ROW + FIRST_Y);
  menuDraw(node->place);
}

/** 0x08024b90: the cursor takes its place on its row, and draws from the next frame on. */
static void cursorStart(Node *node) {
  node->place.parts = read32(PARTS_CURSOR);
  node->place.x = REST_X;
  node->place.y = node->row * ROW + FIRST_Y;
  node->place.attr2 = 8;
  node->run = cursor;
}

/** 0x08023038: every colour fades to black, and then the story map comes back, which isn't ported, so it stops. */
static void leaving(Node *node) {
  if (fadeToBlack(PALETTE, 512)) node->run = nothing;
}

/** 0x080244bc: the choice the player picked moves to the top left, behind the screen that comes. */
static void choiceChosen(Node *node) {
  moveTo(&node->place, 4, 4);
  menuDraw(node->place);
}

/** 0x08024540: a choice slides off the right, and gives its slot back. */
static void choiceAway(Node *node) {
  if (moveX(&node->place, 256)) {
    giveSlot(node->slot);
    menuRemoveNode(node);
  } else {
    menuDraw(node->place);
  }
}

// what A on each of the first four choices opens: Edit skills, Change memory, Skill list and Exchange skills
static void (*const entries[CHOICES - 1])(Node *) = {editEntry, 0, 0, 0};

/** 0x080220a4: down and up move the cursor round the five, repeating while held, B goes to Return to game, and A on
 *  that leaves. */
static void menuChoosing(Node *node) {
  uint16_t repeated = g.keys.repeated, pressed = g.keys.pressed;
  Node *moving = node->cursor;
  if (repeated & KEY_DOWN) {
    moving->row = moving->row == LAST ? 0 : moving->row + 1;
    gba_sound_play(SOUND_MOVE);
  } else if (repeated & KEY_UP) {
    moving->row = moving->row == 0 ? LAST : moving->row - 1;
    gba_sound_play(SOUND_MOVE);
  } else if (pressed & KEY_A) {
    int row = moving->row;
    if (row == LAST) {
      node->run = leaving;
      gba_sound_fade_out(read8(SONG_TABLE + SKILLS_SONG * 8 + 4), SONG_FADE_STEP);
      gba_sound_play(SOUND_MADE);
      return;
    }
    // the screens behind Change memory, Skill list and Exchange skills aren't ported yet
    if (!entries[row]) return;
    menuRemoveNode(moving);
    for (int i = 0; i < CHOICES; i++) node->list[i]->run = i == row ? choiceChosen : choiceAway;
    node->chosen = node->list[row];
    node->run = entries[row];
    selection = row;
    gba_sound_play(SOUND_ENTER);
  } else if ((pressed & KEY_B) && moving->row != LAST) {
    moving->row = LAST;
    gba_sound_play(SOUND_MOVE);
  }
}

// Edit skills (0x080221e0 onwards). The screen is the same list of nodes as the main menu: a header for the
// category, five rows, and a cursor. The rows' pictures are copied into ten sprite slots, five at a time, and the
// whole screen slides in from the right.
//
// The category's first row and how many it has are a table of two bytes each (0x08edb828); each row's picture is
// 1,152 bytes, taken from the English copy's table (0x080aad98). The header's picture and parts change with the
// category, and its map (0x0807bf98) is the same for all four.

static void editBuild(Node *node);
static void editSlideIn(Node *node);
static void editChoosing(Node *node);
static void editLeave(Node *node);
static void categoryEntry(Node *node);
static void gridOut(Node *node);
static void cornerAway(Node *node);
static void rowToCorner(Node *node);
static void rowRemove(Node *node);

/** The category's first picture and how many rows it has. */
static int categoryFirst(void) { return read8(EDIT_ROWS + (uint32_t)(category * 2)); }
static int categoryCount(void) { return read8(EDIT_ROWS + (uint32_t)(category * 2 + 1)); }

/** 0x080245ec: the tab at the screen's x, drawn from the next frame on. */
static void editHeader(Node *node) {
  node->place.x = screenX + HEADER_X;
  menuDraw(node->place);
}

/** 0x08024708: the category's tab, off the right of the screen until the screen slides in. */
static void editHeaderStart(Node *node) {
  node->place.tile = 0;
  node->place.x = 360;
  node->place.y = HEADER_Y;
  node->place.attr2 = 12;
  node->run = editHeader;
}

/** 0x080245a0: a row at the screen's x, half way to its place. */
static void editRow(Node *node) {
  node->place.x = screenX + ROW_X;
  node->place.y = halfway(node->place.y, node->row * ROW_STEP + FIRST_ROW_Y);
  menuDraw(node->place);
}

/** 0x0802460c: a row off the right of the screen, its own picture in its own slot of tiles. */
static void editRowStart(Node *node) {
  node->place.parts = ROW_PARTS;
  node->run = editRow;
}

/** 0x080249e4, with 0x0801f9a8: the cursor's frame from the screen's count of frames, and halfway to its row. */
static void editCursor(Node *node) {
  int step = read8(EDIT_CURSOR_STEPS + (uint32_t)((frames & 28) >> 2));
  node->place.parts = read32(EDIT_CURSOR_PARTS + (uint32_t)(step * 4));
  node->place.y = halfway(node->place.y, node->row * ROW_STEP + FIRST_ROW_Y);
  menuDraw(node->place);
}

/** 0x08024bd8: the cursor on its row, drawn from the next frame on. */
static void editCursorStart(Node *node) {
  node->place.parts = read32(EDIT_CURSOR_PARTS);
  node->place.x = ROW_X;
  node->place.y = node->row * ROW_STEP + FIRST_ROW_Y;
  node->place.attr2 = 8;
  node->run = editCursor;
}

/** 0x080221e0: the first frame of the screen, after the menu's A. The category's tab and map, then the rows. */
static void editEntry(Node *node) {
  node->header = menuAddNode(editHeaderStart, menuPlace(TAB_PARTS[category], 360, HEADER_Y, 0, 12), 1);
  decompress(TAB_PICTURES[category], 0x0600F000);
  decompress(TAB_MAP, 0x0600E000);
  screenX = 256;
  node->run = editBuild;
}

/** 0x080222c4 and 0x08022adc: five rows of the category from `page` on, each its picture taken to a slot of sprite
 *  tiles. False, with the slots given back, when there aren't five to take. */
static int buildRows(Node *node, int page) {
  int first = categoryFirst(), count = categoryCount();
  int taken[VISIBLE];
  for (int i = 0; i < VISIBLE; i++) {
    taken[i] = takeSlot();
    if (taken[i] >= TILE_SLOTS) {
      for (int j = 0; j < i; j++) giveSlot(taken[j]);
      return 0;
    }
  }
  int index = first + page;
  for (int i = 0; i < VISIBLE; i++) {
    queueCopy(EDIT_TILES + (uint32_t)(taken[i] * EDIT_PICTURE_BYTES), EDIT_PICTURES + (uint32_t)(index * EDIT_PICTURE_BYTES),
              EDIT_PICTURE_BYTES);
    Node *row = menuAddNode(editRowStart, menuPlace(ROW_PARTS, 256, i * ROW_STEP + FIRST_ROW_Y,
                                                    taken[i] * ROW_TILE_STEP + FIRST_ROW_TILE, 12), 1);
    row->row = i;
    row->slot = taken[i];
    row->index = index;
    node->list[i] = row;
    if (++index >= first + count) index = first;
  }
  return 1;
}

/** 0x080222c4: the rows the screen slides in with. */
static void editBuild(Node *node) {
  if (buildRows(node, 0)) node->run = editSlideIn;
}

/** 0x080223d8: the screen slides in from the right, and then the cursor comes. */
static void editSlideIn(Node *node) {
  screenX = halfway(screenX, 0);
  queueRegister(BG0HOFS, (uint16_t)((-screenX) & 0x1FF));
  queueRegister(BG1HOFS, (uint16_t)((-screenX) & 0x1FF));
  if (screenX != 0) return;
  node->cursor = menuAddNode(editCursorStart, menuPlace(0, 0, 0, EDIT_CURSOR_TILE, 0), 1);
  node->cursor->row = 0;
  node->cursor->page = 0;
  node->run = editChoosing;
}

/** A row's picture, `index` of the table, copied to its slot after the next V-blank. */
static void showRow(Node *row, int index) {
  row->index = index;
  queueCopy(EDIT_TILES + (uint32_t)(row->slot * EDIT_PICTURE_BYTES), EDIT_PICTURES + (uint32_t)(index * EDIT_PICTURE_BYTES),
            EDIT_PICTURE_BYTES);
}

/** 0x08025064: the skills a row lists, in the order of the table. */
static void buildList(int row) {
  listCount = 0;
  for (int skill = 0; skill < SKILL_COUNT; skill++) {
    int kind = read8(SKILL_TABLE + (uint32_t)(skill * 8 + 3));
    int listed = row == ALL_SKILLS ? read16(SKILL_STARTERS + (uint32_t)(kind * 2)) != skill : kind == row;
    if (!listed) continue;
    skillList[listCount++] = (uint16_t)skill;
    if (listCount > LIST_LIMIT) listCount = LIST_LIMIT;
  }
}

/** 0x08022464's right and left: the cursor's place is kept, the category changes, and the tab, the cursor and the
 *  rows go, which 0x080229f4 builds again for the new category. */
static void changeCategory(Node *node, int step) {
  savedRow[category] = node->cursor->row;
  savedPage[category] = node->cursor->page;
  category = (category + step + 4) % 4;
  menuRemoveNode(node->header);
  menuRemoveNode(node->cursor);
  for (int i = 0; i < VISIBLE; i++) node->list[i]->run = rowRemove;
  node->run = categoryEntry;
}

/** 0x08022464: down and up move the cursor and scroll the five rows, right and left change the category, A opens
 *  the row's skills, and B goes back to the menu. */
static void editChoosing(Node *node) {
  uint16_t repeated = g.keys.repeated, pressed = g.keys.pressed;
  Node *at = node->cursor;
  int first = categoryFirst(), count = categoryCount();
  if (repeated & KEY_DOWN) {
    if (at->row <= 2) at->row++;
    else if (at->page + 5 >= count) {
      if (at->row <= 3) at->row++;
      else return;
    } else {
      Node *going = node->list[0];
      for (int i = 0; i < 4; i++) {
        node->list[i] = node->list[i + 1];
        node->list[i]->row = i;
      }
      node->list[4] = going;
      going->row = 4;
      going->place.y = 160;
      at->page++;
      if (at->page >= count) at->page = 0;
      int index = at->page + 4;
      if (index >= count) index -= count;
      showRow(going, index + first);
    }
  } else if (repeated & KEY_UP) {
    if (at->row > 1) at->row--;
    else if (at->page == 0) {
      if (at->row == 0) return;
      at->row--;
    } else {
      Node *going = node->list[4];
      for (int i = 4; i > 0; i--) {
        node->list[i] = node->list[i - 1];
        node->list[i]->row = i;
      }
      node->list[0] = going;
      going->row = 0;
      going->place.y = 0;
      at->page = (at->page == 0 ? count : at->page) - 1;
      showRow(going, first + at->page);
    }
  } else if (repeated & KEY_RIGHT) {
    changeCategory(node, 1);
  } else if (repeated & KEY_LEFT) {
    changeCategory(node, -1);
  } else if (pressed & KEY_A) {
    int picked = at->row;
    int row = (uint8_t)(first + picked + at->page);
    savedRow[category] = picked;
    savedPage[category] = at->page;
    menuRemoveNode(at);
    // the menu's picture slides off to the left, and the row picked goes to its place
    node->chosen->run = cornerAway;
    node->list[picked]->run = rowToCorner;
    node->chosen = node->list[picked];
    buildList(row);
    listScroll = listCursor = 0;
    listRow = row;
    node->run = gridOut;
    gba_sound_play(SOUND_ENTER);
    return;
  } else if (pressed & KEY_B) {
    menuRemoveNode(at);
    node->run = editLeave;
    gba_sound_play(SOUND_ENTER);
    return;
  } else {
    return;
  }
  gba_sound_play(SOUND_MOVE);
}

/** 0x08024698: a row slides off the right, and gives its slot back. */
static void rowAway(Node *node) {
  if (moveX(&node->place, 256)) {
    giveSlot(node->slot);
    menuRemoveNode(node);
  } else {
    menuDraw(node->place);
  }
}

/** 0x080227ec, 0x0802296c and 0x08023ea8: the screen slides off to the right, halving the distance. True once it's off. */
static int slideOut(void) {
  screenX = 256 - (256 - screenX) / 2;
  queueRegister(BG0HOFS, (uint16_t)((-screenX) & 0x1FF));
  queueRegister(BG1HOFS, (uint16_t)((-screenX) & 0x1FF));
  return screenX > 255;
}

/** 0x080227ec: the screen slides off to the right, and then its tab goes, its rows slide away, and the menu comes
 *  back. */
static void editLeave(Node *node) {
  if (!slideOut()) return;
  menuRemoveNode(node->header);
  for (int i = 0; i < VISIBLE; i++) node->list[i]->run = rowAway;
  node->run = menuReturn;
}

/** 0x08022864: the menu again, the choice that was picked coming back from the top left and the other four taking a
 *  slot of tiles each and sliding in from the right, once there are slots enough for them. */
static void menuReturn(Node *node) {
  int taken[CHOICES];
  for (int i = 0; i < CHOICES; i++) {
    if (i == selection) continue;
    taken[i] = takeSlot();
    if (taken[i] >= TILE_SLOTS) {
      for (int j = 0; j < i; j++) if (j != selection) giveSlot(taken[j]);
      return;
    }
  }
  for (int i = 0; i < CHOICES; i++) {
    if (i == selection) {
      node->list[i] = node->chosen;
      node->chosen->run = choiceRest;
      continue;
    }
    queueCopy(CHOICE_TILES + (uint32_t)(taken[i] * CHOICE_BYTES), CHOICE_PICTURES + (uint32_t)(i * CHOICE_BYTES),
              CHOICE_BYTES);
    Node *choice = menuAddNode(choiceStart, menuPlace(0, 0, 0, taken[i] * CHOICE_SLOT_TILES + CHOICE_FIRST_TILE, 0), 1);
    choice->row = i;
    choice->slot = taken[i];
    node->list[i] = choice;
  }
  node->run = slideIn;
}

/** 0x080244d8: the menu's picture off the left of the screen, where it waits. */
static void cornerStart(Node *node) { node->run = choiceRest; }

// The grid of a row's skills (0x0802296c onwards): the rows slide away but the one picked, which goes to the top left,
// and twelve boxes, four across, show the skills of the row, with the points spent and the details of the skill the
// cursor is on.

static void rowSettle(Node *node);
static void gridIn(Node *node);
static void gridChoosing(Node *node);
static void gridBack(Node *node);
static void gridSlideIn(Node *node);
static void gridSettle(Node *node);

/** Whether the skill is owned: the save has a number for it that isn't 0xFF. */
static int owned(int skill) { return read8(SAVE_OWNED + (uint32_t)skill) != NOT_OWNED; }
static int skillCost(int skill) { return read8(SKILL_TABLE + (uint32_t)(skill * 8)); }
static int skillColourCode(int skill) { return read8(SKILL_TABLE + (uint32_t)(skill * 8 + 4)); }
static uint32_t skillBit(int skill) { return read32(SKILL_BITS + (uint32_t)((skill & 31) * 4)); }
static int isEquipped(int skill) { return (equipped[skill >> 5] & skillBit(skill)) != 0; }
/** 0x08021e70: a skill marked equipped. */
static void equip(int skill) { equipped[skill >> 5] |= skillBit(skill); }
static void unequip(int skill) { equipped[skill >> 5] &= ~skillBit(skill); }
/** Where the save keeps the equipped skill of each of the 27 places. */
static uint32_t equippedIds(void) { return SAVE_IDS + (uint32_t)(read8(SAVE_RECORD) * RECORD_BYTES); }

/** A new save, as the game leaves it: 30 points, the starters equipped and owned, and no other skill owned. The
 *  first starter is the place of no skill, which nobody owns. */
static void newSave(void) {
  for (int skill = 0; skill < SKILL_COUNT; skill++) write8(SAVE_OWNED + (uint32_t)skill, NOT_OWNED);
  for (int i = 1; i <= EQUIPPED; i++) write8(SAVE_OWNED + read16(SKILL_STARTERS + (uint32_t)(i * 2)), STARTER_OWNED);
  write32(SAVE_POINTS, NEW_SAVE_POINTS);
  write8(SAVE_RECORD, 0);
  for (int i = 0; i < EQUIPPED; i++) write16(equippedIds() + (uint32_t)(i * 2), read16(SKILL_STARTERS + (uint32_t)(i * 2)));
}

/** 0x08021b0c's end and 0x08021a84: the points, what's spent, and which skills are equipped. A place whose skill
 *  isn't owned gets its starter. */
static void readSave(void) {
  maxPoints = (int)read32(SAVE_POINTS);
  pointsLimit = maxPoints / POINT_UNITS;
  spent = 0;
  for (int i = 0; i < EQUIPPED; i++) spent += skillCost(read16(equippedIds() + (uint32_t)(i * 2)));
  for (int i = 0; i < 16; i++) equipped[i] = 0;
  for (int i = 0; i < EQUIPPED; i++) {
    uint32_t at = equippedIds() + (uint32_t)(i * 2);
    int skill = read16(at);
    int kept = read8(SAVE_OWNED + (uint32_t)skill);
    if (kept == NOT_OWNED || kept == 0) {
      skill = read16(SKILL_STARTERS + (uint32_t)(i * 2));
      write16(at, (uint16_t)skill);
    }
    equip(skill);
  }
}

/** The sprites' colour for a skill: grey when it isn't owned, and otherwise by the skill's colour code. */
static int skillColour(int skill) {
  if (!owned(skill)) return COLOUR_UNOWNED;
  int code = skillColourCode(skill);
  if (code > COLOUR_LAST_OWN_CODE) return ((code - COLOUR_SECOND_TABLE) << 4) | 12;
  if (code > COLOUR_LAST_FIRST_TABLE) return COLOUR_ELSE;
  return (code << 4) | 12;
}

static int gridColumnX(int index) { return read16(GRID_PLACES + (uint32_t)((index & 3) * 2)); }
static int gridRowY(int index) { return read16(GRID_PLACES + (uint32_t)((GRID_ROWS_AT + index) * 2)); }

/** 0x080229f4: the new category's tab and map, with the screen where it was, and then its rows. */
static void categoryRows(Node *node);
static void categoryEntry(Node *node) {
  node->header = menuAddNode(editHeaderStart, menuPlace(TAB_PARTS[category], 360, HEADER_Y, 0, 12), 1);
  decompress(TAB_PICTURES[category], 0x0600F000);
  decompress(TAB_MAP, 0x0600E000);
  screenX = 0;
  node->run = categoryRows;
  categoryRows(node);
}

/** 0x08022adc: the rows from where the category was scrolled to, with the cursor on the row it was on. */
static void categoryRows(Node *node) {
  if (!buildRows(node, savedPage[category])) return;
  node->cursor = menuAddNode(editCursorStart, menuPlace(0, 0, 0, EDIT_CURSOR_TILE, 0), 1);
  node->cursor->row = savedRow[category];
  node->cursor->page = savedPage[category];
  node->run = editChoosing;
}

/** 0x080246c8: a row gives its slot back and goes. */
static void rowRemove(Node *node) {
  giveSlot(node->slot);
  menuRemoveNode(node);
}

/** 0x08024570: the menu's picture slides off to the left, and gives its slot back. */
static void cornerAway(Node *node) {
  if (moveX(&node->place, -128)) {
    rowRemove(node);
  } else {
    menuDraw(node->place);
  }
}

/** 0x080246e0: the row picked goes to the top left, where it stays. */
static void rowToCorner(Node *node) {
  if (moveTo(&node->place, 4, 4)) node->run = choiceRest;
  menuDraw(node->place);
}

/** 0x0802296c: the screen slides off, and then the tab goes and the rows but the one picked slide away. */
static void gridBuild(Node *node);
static void gridOut(Node *node) {
  if (!slideOut()) return;
  menuRemoveNode(node->header);
  for (int i = 0; i < VISIBLE; i++) {
    if (i != savedRow[category]) node->list[i]->run = rowRemove;
  }
  node->run = gridBuild;
}

/** 0x08025120: a box off the right of the screen. */
static void boxRun(Node *node) {
  int index = node->row;
  node->place.x = screenX + gridColumnX(index);
  node->place.y = halfway(node->place.y, gridInfo ? 160 : gridRowY(index >> 2));
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  int at = listScroll + index;
  if (at >= listCount) return;
  int skill = skillList[at];
  node->place.attr2 = skillColour(skill);
  node->place.parts = isEquipped(skill) ? PARTS_BOX_EQUIPPED : PARTS_BOX;
  menuDraw(node->place);
}

static void boxStart(Node *node) {
  int index = node->row;
  node->place.parts = PARTS_BOX;
  node->place.tile = 0;
  node->place.x = 256 + gridColumnX(index);
  node->place.y = gridRowY(index >> 2);
  node->place.attr2 = 12;
  node->run = boxRun;
}

/** 0x08025440: the panel with the skill's details, at the screen's x. The skill's icon is copied when the cursor
 *  moves to another. Its name and numbers (0x080256fc to 0x08025a58) are drawn for a skill that's owned, and aren't
 *  ported. */
static void infoRun(Node *node) {
  node->place.x = screenX + 12;
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  if (listSkill != node->index) {
    queueCopy(ICON_TILES, ICON_TABLE + (uint32_t)(listSkill * ICON_BYTES), ICON_BYTES);
    node->index = listSkill;
  }
  node->place.attr2 = skillColour(listSkill);
  menuDraw(node->place);
}

static void infoStart(Node *node) {
  node->place.parts = PARTS_INFO;
  node->place.tile = 0;
  node->place.x = 256 + 12;
  node->place.y = 35;
  node->place.attr2 = 12;
  node->index = -1;
  node->run = infoRun;
}

/** 0x08025c4c: a digit of the points, at the screen's x. */
static void digitRun(Node *node) {
  node->place.x = node->row * 8 + 111 + screenX;
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  menuDraw(node->place);
}

static void digitStart(Node *node) {
  node->place.parts = PARTS_DIGIT;
  node->place.x = node->row * 8 + 367;
  node->place.y = 9;
  node->place.attr2 = 12;
  node->run = digitRun;
}

/** 0x08025b78: the points spent, three digits of what the skills cost. */
static void pointsRun(Node *node) {
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  node->place.x = screenX + 106;
  int units = spent * POINT_UNITS;
  node->digits[0]->place.tile = units / 100;
  node->digits[1]->place.tile = (units % 100) / 10;
  node->digits[2]->place.tile = units % 10;
  menuDraw(node->place);
}

/** 0x08025a98: the points, spent and there are, as seven digits with a slash between: 000/030. */
static void pointsStart(Node *node) {
  node->place.parts = PARTS_POINTS;
  node->place.tile = 0;
  node->place.x = 362;
  node->place.y = 4;
  node->place.attr2 = 12;
  for (int i = 0; i < DIGITS; i++) {
    node->digits[i] = menuAddNode(digitStart, menuPlace(0, 0, 0, 0, 0), 1);
    node->digits[i]->row = i;
  }
  node->digits[3]->place.tile = SLASH;
  node->digits[4]->place.tile = maxPoints / 100;
  node->digits[5]->place.tile = (maxPoints % 100) / 10;
  node->digits[6]->place.tile = maxPoints % 10;
  node->run = pointsRun;
}

/** 0x0802440c: the scroll thumb, down the track as far as the list is scrolled, when it's longer than the boxes. */
static void thumbRun(Node *node) {
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  if (listCount > GRID_BOXES) {
    node->place.y = 115 * listScroll / (((listCount + 3) & -4) - GRID_BOXES) + 34;
    node->place.x = screenX + 231;
    menuDraw(node->place);
  }
}

static void thumbStart(Node *node) {
  node->place.parts = PARTS_THUMB;
  node->place.tile = 0;
  node->place.x = 487;
  node->place.y = 34;
  node->place.attr2 = 8;
  node->run = thumbRun;
}

/** 0x080243a4: the R tab, at the screen's x. */
static void tabRun(Node *node) {
  if (gridLeaving) {
    menuRemoveNode(node);
    return;
  }
  node->place.x = screenX + 205;
  menuDraw(node->place);
}

static void tabStart(Node *node) {
  node->place.parts = PARTS_TAB;
  node->place.tile = 0;
  node->place.x = 461;
  node->place.y = 14;
  node->place.attr2 = 8;
  node->run = tabRun;
}

/** 0x08023978: the grid's frame and map, its boxes and the panels, and the screen slides back in. */
static void gridBuild(Node *node) {
  decompress(GRID_PICTURE, 0x0600F000);
  decompress(GRID_MAP, 0x0600E000);
  textInto(GRID_TEXT, 16, 14);
  for (uint32_t i = 0; i < GRID_TEXT_BYTES; i++) gba_vram[GRID_TEXT - VRAM + i] = 0;
  for (int across = 0; across < GRID_FRAME_ACROSS; across++) {
    for (int down = 0; down < GRID_FRAME_DOWN; down++) {
      uint32_t at = GRID_FRAME_AT - VRAM + (uint32_t)(across * 2 + down * GRID_FRAME_STRIDE);
      uint16_t tile = (uint16_t)(GRID_FRAME_FIRST + across * GRID_FRAME_DOWN + down);
      gba_vram[at] = (uint8_t)tile;
      gba_vram[at + 1] = (uint8_t)(tile >> 8);
    }
  }
  gridInfo = 0;
  gridLeaving = 0;
  for (int i = 0; i < GRID_BOXES; i++) menuAddNode(boxStart, menuPlace(0, 0, 0, 0, 0), 1)->row = i;
  menuAddNode(infoStart, menuPlace(0, 0, 0, 0, 0), 1);
  menuAddNode(pointsStart, menuPlace(0, 0, 0, 0, 0), 1);
  menuAddNode(thumbStart, menuPlace(0, 0, 0, 0, 0), 1);
  menuAddNode(tabStart, menuPlace(0, 0, 0, 0, 0), 1);
  listSkill = skillList[listCursor];
  node->run = gridIn;
}

/** 0x0802482c and 0x08024aac: the cursor over its box, drawn from the next frame on, half way to the box when it
 *  moves, and in the step of its animation the screen's count of frames gives. */
static void gridCursorRun(Node *node) {
  int at = listCursor - listScroll;
  moveTo(&node->place, gridColumnX(at), gridRowY(at >> 2));
  int step = read8(GRID_CURSOR_STEPS + (uint32_t)((frames & 28) >> 2));
  node->place.parts = read32(GRID_CURSOR_PARTS + (uint32_t)(step * 4));
  menuDraw(node->place);
}

static void gridCursorStart(Node *node) {
  int at = listCursor - listScroll;
  node->place.parts = read32(GRID_CURSOR_PARTS);
  node->place.tile = GRID_CURSOR_TILE;
  node->place.x = gridColumnX(at);
  node->place.y = gridRowY(at >> 2);
  node->place.attr2 = 8;
  node->run = gridCursorRun;
}

/** 0x08024204: the screen slides in, and then the cursor comes. */
static void gridIn(Node *node) {
  screenX = halfway(screenX, 0);
  queueRegister(BG0HOFS, (uint16_t)((-screenX) & 0x1FF));
  queueRegister(BG1HOFS, (uint16_t)((-screenX) & 0x1FF));
  if (screenX != 0) return;
  node->cursor = menuAddNode(gridCursorStart, menuPlace(0, 0, 0, 0, 0), 1);
  node->run = gridChoosing;
}

/** 0x08023b54, A: the skill under the cursor takes the row's place, or gives it back to the row's starter, as the
 *  points allow. */
static void gridPress(void) {
  int skill = skillList[listCursor];
  uint32_t place = equippedIds() + (uint32_t)(listRow * 2);
  int current = read16(place);
  if (skill == current) {
    int starter = read16(SKILL_STARTERS + (uint32_t)(listRow * 2));
    if (skill == starter) {
      gba_sound_play(SOUND_DENIED);
      return;
    }
    unequip(skill);
    spent -= skillCost(skill);
    skill = starter;
    equip(skill);
  } else {
    int kept = read8(SAVE_OWNED + (uint32_t)skill);
    if (kept == NOT_OWNED || kept == 0) {
      gba_sound_play(SOUND_DENIED);
      return;
    }
    int after = spent - skillCost(current) + skillCost(skill);
    if (after > pointsLimit) {
      gba_sound_play(SOUND_DENIED);
      return;
    }
    unequip(current);
    equip(skill);
    spent = after;
  }
  write16(place, (uint16_t)skill);
  gba_sound_play(SOUND_EQUIP);
}

/** 0x08023b54: the arrows move the cursor over the boxes, scrolling them by rows of four, A equips the skill, B goes
 *  back to the rows, and R opens the skill's details. */
static void gridChoosing(Node *node) {
  uint16_t repeated = g.keys.repeated, pressed = g.keys.pressed;
  if (repeated & (KEY_RIGHT | KEY_LEFT | KEY_UP | KEY_DOWN)) {
    uint16_t at = (uint16_t)listCursor;
    if (repeated & KEY_DOWN) {
      at = (uint16_t)(at + 4);
      if (at >= listCount) {
        at &= 3;
        listScroll = 0;
      } else if (at >= listScroll + GRID_BOXES) {
        listScroll = (at & 0xFFFC) - 8;
      }
    }
    listCursor = at;
    if (repeated & KEY_UP) {
      at = (uint16_t)(listCursor - 4);
      listCursor = at;
      if (at >= listCount) {
        at = (uint16_t)(at + (listCount & 0xFFFC) + 4);
        listCursor = at;
        if (at >= listCount) listCursor = (uint16_t)(at - 4);
        listScroll = listCount > GRID_BOXES ? (listCount - 9) & -4 : 0;
      } else if (at < listScroll) {
        listScroll = at & 0xFFFC;
      }
    }
    if (repeated & KEY_RIGHT) {
      int to = (listCursor & 0xFFFC) | ((listCursor + 1) & 3);
      listCursor = to >= listCount ? listCount & 0xFFFC : to;
    }
    if (repeated & KEY_LEFT) {
      int to = (listCursor & 0xFFFC) | ((listCursor - 1) & 3);
      listCursor = to >= listCount ? listCount - 1 : to;
    }
    listSkill = skillList[listCursor];
    gba_sound_play(SOUND_MOVE);
  } else if (pressed & KEY_A) {
    gridPress();
  } else if (pressed & KEY_B) {
    menuRemoveNode(node->cursor);
    node->run = gridBack;
    gba_sound_play(SOUND_ENTER);
  } else if (pressed & KEY_R) {
    // the details of an owned skill (0x080242bc) aren't ported
    if (!owned(listSkill)) gba_sound_play(SOUND_DENIED);
  }
}

/** 0x0802464c: the row that was picked goes back to its place, and then it's a row like the others. */
static void rowSettle(Node *node) {
  int arrived = moveTo(&node->place, ROW_X, node->row * ROW_STEP + FIRST_ROW_Y);
  if (arrived && screenX == 0) node->run = editRow;
  menuDraw(node->place);
}

/** 0x08023ea8: the screen slides off, and then the grid goes, the rows come back, with the menu's picture off the
 *  left of the screen, and the tab. */
static void gridBack(Node *node) {
  if (!slideOut()) return;
  gridLeaving = 1;
  int taken[VISIBLE];
  for (int i = 0; i < VISIBLE; i++) {
    taken[i] = takeSlot();
    if (taken[i] >= TILE_SLOTS) {
      for (int j = 0; j < i; j++) giveSlot(taken[j]);
      return;
    }
  }
  int first = categoryFirst(), count = categoryCount();
  int index = first + savedPage[category];
  int next = 0;
  for (int i = 0; i < VISIBLE; i++) {
    if (i == node->chosen->row) {
      node->list[i] = node->chosen;
      node->chosen->run = rowSettle;
    } else {
      int slot = taken[next++];
      queueCopy(EDIT_TILES + (uint32_t)(slot * EDIT_PICTURE_BYTES), EDIT_PICTURES + (uint32_t)(index * EDIT_PICTURE_BYTES),
                EDIT_PICTURE_BYTES);
      Node *row = menuAddNode(editRowStart, menuPlace(ROW_PARTS, 256, i * ROW_STEP + FIRST_ROW_Y,
                                                      slot * ROW_TILE_STEP + FIRST_ROW_TILE, 12), 1);
      row->row = i;
      row->slot = slot;
      node->list[i] = row;
    }
    if (++index >= first + count) index = first;
  }
  int slot = taken[VISIBLE - 1];
  queueCopy(CHOICE_TILES + (uint32_t)(slot * CHOICE_BYTES), CHOICE_PICTURES + (uint32_t)(selection * CHOICE_BYTES),
            CHOICE_BYTES);
  node->chosen = menuAddNode(cornerStart, menuPlace(PARTS_CHOICE, -128, 4, slot * CHOICE_SLOT_TILES + CHOICE_FIRST_TILE, 12), 1);
  node->chosen->row = selection;
  node->chosen->slot = slot;
  node->header = menuAddNode(editHeaderStart, menuPlace(TAB_PARTS[category], 360, HEADER_Y, 0, 12), 1);
  decompress(TAB_PICTURES[category], 0x0600F000);
  decompress(TAB_MAP, 0x0600E000);
  node->run = gridSlideIn;
}

/** 0x0802426c: the screen slides in again. */
static void gridSlideIn(Node *node) {
  screenX = halfway(screenX, 0);
  queueRegister(BG0HOFS, (uint16_t)((-screenX) & 0x1FF));
  queueRegister(BG1HOFS, (uint16_t)((-screenX) & 0x1FF));
  if (screenX == 0) node->run = gridSettle;
}

/** 0x08024170: the rows and the menu's picture settle in their places, and then the cursor comes back. */
static void gridSettle(Node *node) {
  int arrived = 1;
  for (int i = 0; i < VISIBLE; i++) arrived &= moveTo(&node->list[i]->place, ROW_X, i * ROW_STEP + FIRST_ROW_Y);
  arrived &= moveTo(&node->chosen->place, 4, 4);
  if (!arrived) return;
  node->cursor = menuAddNode(editCursorStart, menuPlace(0, 0, 0, EDIT_CURSOR_TILE, 0), 1);
  node->cursor->row = savedRow[category];
  node->cursor->page = savedPage[category];
  node->run = editChoosing;
}

/** 0x08021f04: the frame wrapper, the screen's own count of frames and then the list. */
static void skillsFrame(void) {
  frames++;
  menuFrame();
}

/** 0x08021b0c: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures and maps,
 *  the list's first node, and the display queued on for the next V-blank. */
void startSkills(void) {
  menuReset();
  frames = slots = category = screenX = selection = 0;
  for (int i = 0; i < 4; i++) savedRow[i] = savedPage[i] = 0;
  newSave();
  readSave();
  menuWriteRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;              // 0x0801fb94
  hideSpriteBuffer();             // 0x0801ff30
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  decompress(0x0810A3BC, VRAM);
  decompress(0x08109EA8, 0x06004000);
  decompress(0x0807BC80, 0x06008000);
  decompress(0x0810A27C, 0x0600D000);
  decompress(0x0810B114, 0x0600D800);
  for (uint32_t i = 0x0600E000 - VRAM; i < 0x06010000 - VRAM; i++) gba_vram[i] = 0;
  decompress(0x080BAE18, 0x06010000);
  decompress(0x080BBD68, 0x06012C20);
  menuAddNode(startFrame, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(fadeIn, menuPlace(0, 0, 0, 0, 0), 0);
  gba_sound_play(SKILLS_SONG);
  queueRegister(DISPCNT, 0x1F40);
  g.callback = skillsFrame;
}
