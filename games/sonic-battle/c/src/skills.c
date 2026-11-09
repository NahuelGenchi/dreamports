// skills.js in C: Emerl's screen, which the story map opens with R, by way of the initializer 0x08021b0c. It shows
// Emerl and a menu of five: Edit skills, Change memory, Skill list, Exchange skills and Return to game. Nothing leads
// here yet, so `skills` in the address is a recording's start point.
//
// It's built from the same list of nodes as the main menu (menu.c).

#include "game.h"
#include "menu.h"

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

// the screen's own state: its count of frames, the slots of sprite tiles taken, the category shown, and the x the
// whole screen has slid to
static int frames, slots, category, screenX;
// 0x03004dbc's first byte: the choice the menu's cursor comes back to
static int selection;

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

/** 0x080222c4: five rows of the category, each its picture taken to a slot of sprite tiles, which the screen slides
 *  in with. */
static void editBuild(Node *node) {
  int first = categoryFirst(), count = categoryCount();
  int page = 0, made = 0;
  for (int i = 0; i < VISIBLE; i++) {
    int slot = takeSlot();
    if (slot >= TILE_SLOTS) {
      for (int j = 0; j < made; j++) giveSlot(node->list[j]->slot);
      return;
    }
    int index = first + page + i;
    if (index >= first + count) index = first;
    queueCopy(EDIT_TILES + (uint32_t)(slot * EDIT_PICTURE_BYTES), EDIT_PICTURES + (uint32_t)(index * EDIT_PICTURE_BYTES),
              EDIT_PICTURE_BYTES);
    Node *row = menuAddNode(editRowStart, menuPlace(ROW_PARTS, 256, i * ROW_STEP + FIRST_ROW_Y,
                                                    slot * ROW_TILE_STEP + FIRST_ROW_TILE, 12), 1);
    row->row = i;
    row->slot = slot;
    row->index = index;
    node->list[made++] = row;
  }
  node->run = editSlideIn;
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

/** 0x08022464: down and up move the cursor and scroll the five rows, and B goes back to the menu. */
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

/** 0x080227ec: the screen slides off to the right, and then its tab goes, its rows slide away, and the menu comes
 *  back. */
static void editLeave(Node *node) {
  screenX = 256 - (256 - screenX) / 2;
  queueRegister(BG0HOFS, (uint16_t)((-screenX) & 0x1FF));
  queueRegister(BG1HOFS, (uint16_t)((-screenX) & 0x1FF));
  if (screenX <= 255) return;
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
