// Ghosts'n Goblins Dreamport: the view's task, from the original's code at $E68C. A stage is a row of screens, each 16
// blocks across and 15 down, and a block is two tiles by two, with one of four sets of colours. The copy's stage bank
// says where its lists are: its blocks' places from $800E, each block's four tiles from $8010 and its colours from
// $8012, and the screens the stage is made of, in order, from $95. The other tasks ask for the view to move by leaving
// a speed in work memory, and when the view crosses into a new column of tiles this task leaves that column for V-blank
// to write, just past the edge of the picture, and fills in its colours.

#include "game.h"

// the view's place in the stage, in 256ths of a pixel, pixels and screens, across and down, and where it was last round
enum { VIEW_X = 0x63, VIEW_Y = 0x66, VIEW_X_BEFORE = 0x6B, VIEW_Y_BEFORE = 0x6E, SPEED_X = 0x5C, SPEED_Y = 0x5F };
#define STAGE RAM[0xC2]
#define VIEW_HELD RAM[0xBC]
#define STAGE_SCREENS 0x95      // where the stage's list of screens is
#define BLOCK_AT RAM[0x6A]      // a block's place in its screen: its row in the top four bits, its column in the rest
#define BLOCK RAM[0x69]
#define SCREEN_AT RAM[0x71]     // which of the stage's screens a place is in
// the place the routines below look at: $77 and $73 are its screen and pixel down, $78 and $74 across
#define AT_Y_SCREEN RAM[0x77]
#define AT_Y RAM[0x73]
#define AT_X_SCREEN RAM[0x78]
#define AT_X RAM[0x74]

// sub_E945 and sub_E9A4: the block at a place in the stage. Stages more than one screen high, at $E94B, aren't ported yet.
static uint8_t block_at_place(void) {
  RAM[0x22] = AT_Y_SCREEN;
  SCREEN_AT = AT_X_SCREEN;
  RAM[0x72] = peek((uint16_t)(ram16(STAGE_SCREENS) + SCREEN_AT));
  set_ram16(0x54, (uint16_t)(peek16(0x800E) + RAM[0x72] * 240));   // a screen's 240 blocks
  set_ram16(0x47, (uint16_t)(RAM[0x72] << 4));
  BLOCK_AT = (uint8_t)((AT_X >> 4) + (AT_Y & 0xF0));
  BLOCK = peek((uint16_t)(ram16(0x54) + BLOCK_AT));
  return BLOCK;
}

// $EA55, with sub_EA66: the block at the place in $77, $73, $78 and $74, read with the stage's own bank switched in.
uint8_t block_at_stage_place(void) {
  RAM[0xD4] = BANK_NOW;
  switch_bank(BANK_HOME);
  block_at_place();
  switch_bank(RAM[0xD4]);
  return BLOCK;
}

// sub_E9AB: where the four tiles of the block at BLOCK_AT are.
static void find_block_tiles(void) {
  BLOCK = peek((uint16_t)(ram16(0x54) + BLOCK_AT));
  set_ram16(0x26, (uint16_t)(peek16(0x8010) + BLOCK * 4));
}

// sub_EA73: the PPU's address of the tile at the place, in the first name table or the second.
static void find_tile_address(void) {
  uint16_t address = (uint16_t)(((AT_Y & 0xF8) << 2) + (AT_X >> 3));
  // rows past the name table's 30, at $EA97, aren't ported yet
  address |= 0x2000;
  if (AT_X_SCREEN & 1) address |= 0x0400;
  set_ram16(0x26, address);
}

// sub_EABD: the colours of the block at BLOCK_AT, two bits of its name table's attribute byte.
static void set_block_colours(void) {
  uint16_t attributes = (uint16_t)(ATTRIBUTES + (SCREEN_AT & 1 ? 0x40 : 0));
  set_ram16(0x26, attributes);
  RAM[0x49] = (uint8_t)(((BLOCK_AT & 0x0F) >> 1) | ((BLOCK_AT & 0xE0) >> 2));
  set_ram16(0xAE, peek16(0x8012));
  int shift = (BLOCK_AT & 0x01 ? 2 : 0) + (BLOCK_AT & 0x10 ? 4 : 0);
  RAM[0x4C] = (uint8_t)(peek((uint16_t)(ram16(0xAE) + BLOCK)) << shift);
  RAM[0x4B] = RAM[attributes + RAM[0x49]];
  RAM[attributes + RAM[0x49]] = (uint8_t)((RAM[0x4B] & ~(3 << shift)) | RAM[0x4C]);
}

// sub_E76F: the column of 30 tiles one screen to the right of the view, for V-blank to write down the screen. The view
// moving left, at $E780, and a column that runs off the bottom of its screen, at $E800, aren't ported yet.
static void draw_column(void) {
  AT_X_SCREEN = (uint8_t)(RAM[VIEW_X + 2] + 1);
  AT_X = RAM[VIEW_X + 1];
  AT_Y = RAM[VIEW_Y + 1];
  AT_Y_SCREEN = RAM[VIEW_Y + 2];
  block_at_place();
  find_tile_address();
  RAM[COLUMN] = RAM[0x27];
  RAM[COLUMN + 1] = RAM[0x26];
  RAM[COLUMN + 2] = 0;
  RAM[0x23] = 2;
  uint8_t at = 3, side = AT_X & 8 ? 1 : 0, lower = AT_Y & 8;
  RAM[0x22] = 0;
  find_block_tiles();
  for (;;) {
    if (!lower) {
      RAM[COLUMN + at++] = peek((uint16_t)(ram16(0x26) + side));
      if (++RAM[0x22] == 30) break;
    }
    lower = 0;
    RAM[COLUMN + at++] = peek((uint16_t)(ram16(0x26) + 2 + side));
    if (++RAM[0x22] == 30) break;
    set_block_colours();
    BLOCK_AT += 0x10;
    find_block_tiles();
  }
  set_block_colours();
  RAM[COLUMN + at] = 0;
  RAM[COLUMN + 2] = (uint8_t)(30 - RAM[COLUMN + 2]);
  COLUMN_READY = 0xFF;
}

// 24 bits at `at` plus the 24 at `by`, with what they were kept at `before`.
static void move_by(uint16_t at, uint16_t by, uint16_t before) {
  uint32_t was = (uint32_t)(RAM[at] | RAM[at + 1] << 8 | RAM[at + 2] << 16), now = was + (uint32_t)(RAM[by] | RAM[by + 1] << 8 | RAM[by + 2] << 16);
  for (int i = 0; i < 3; i++) {
    RAM[before + i] = RAM[at + i];
    RAM[at + i] = (uint8_t)(now >> (i * 8));
  }
}
static void move_back(uint16_t at, uint16_t before) {
  for (int i = 0; i < 3; i++) RAM[at + i] = RAM[before + i];
}

// $E68C, the view's task
wait view_task(void) {
  move_by(VIEW_X, SPEED_X, VIEW_X_BEFORE);
  RAM[0x22] = RAM[VIEW_X + 1] & 8;
  RAM[0x4A] = (RAM[VIEW_X_BEFORE + 1] & 8) != RAM[0x22] ? 0xFF : 0;   // it's in a new column of tiles
  // the view stops at the screens the tables at $EB3D and $EB4B give for the stage's two ends
  if (!VIEW_HELD && (cart(7, (uint16_t)(0xEB3D + STAGE)) == RAM[VIEW_X + 2] || cart(7, (uint16_t)(0xEB4B + STAGE)) == RAM[VIEW_X + 2])) {
    move_back(VIEW_X, VIEW_X_BEFORE);
    RAM[0x4A] = 0;
  }
  // down, where only the pixels and their 256ths move: a new screen down, at $E6F8, and a new row of tiles, at $E73B,
  // aren't ported yet
  uint16_t down = (uint16_t)(ram16(VIEW_Y) + ram16(SPEED_Y));
  RAM[VIEW_Y_BEFORE] = RAM[VIEW_Y];
  RAM[VIEW_Y_BEFORE + 1] = RAM[VIEW_Y + 1];
  RAM[VIEW_Y_BEFORE + 2] = RAM[VIEW_Y + 2];
  set_ram16(VIEW_Y, down);
  if (!VIEW_HELD && (RAM[VIEW_Y + 2] == cart(7, (uint16_t)(0xEB67 + STAGE)) || cart(7, (uint16_t)(0xEB59 + STAGE)) == RAM[VIEW_Y + 2])) move_back(VIEW_Y, VIEW_Y_BEFORE);
  RAM[0x22] = RAM[VIEW_Y + 1] & 8;
  if (RAM[0x4A]) draw_column();
  SCROLL_X = RAM[VIEW_X + 1];
  SCROLL_Y = RAM[VIEW_Y + 1];
  RAM[0x22] = RAM[VIEW_X + 2] & 1;
  PPU_CONTROL = (uint8_t)((PPU_CONTROL & 0xFE) | RAM[0x22]);
  for (int i = 0; i < 6; i++) RAM[SPEED_X + i] = 0;
  return YIELDS;
}
