// Ghosts'n Goblins Dreamport: how the game's picture reaches the PPU. Only V-blank writes to it. The tasks leave what
// they want written in work memory: rows of tiles or colours in a list at $0720, a column of the stage at $07D8, and
// the colour attributes of both name tables at $0400, which V-blank writes a quarter at a time when it has nothing
// else to write. The tiles themselves come from the player's copy, through the same list.

#include "game.h"

static void ppu_address(uint8_t high, uint8_t low) {
  hardware_ppu_latch();
  hardware_write(0x2006, high);
  hardware_write(0x2006, low);
}

// A run of `count` bytes from work memory to $2007.
static void write_run(uint16_t from, uint8_t count, cost each) {
  for (uint8_t i = 0; i < count; i++) {
    took(each);
    hardware_write(0x2007, RAM[(from + i) & 0x7FF]);
    took(i + 1 < count ? GOES_ROUND : GOES_ON);
  }
}

// $C11F and $C15A: a list of runs of bytes for the PPU, each its address, high byte first, a count and the bytes, up to
// a 0 where the next address would be.
static void write_list(uint16_t list) {
  uint8_t x = 0;
  while (RAM[list + x]) {
    took(VBLANK_RUN_BEGINS);
    uint8_t high = RAM[list + x++], low = RAM[list + x++], count = RAM[list + x++];
    took(VBLANK_RUN_ADDRESS);
    ppu_address(high, low);
    write_run((uint16_t)(list + x), count, VBLANK_RUN_BYTE);
    x += count;
    took(VBLANK_RUN_ENDS);
  }
}

// $C18E: the rows' list, which ends at $FF, and leaves the PPU's address at the start of the same table after each row,
// clear of the tiles.
static void write_rows(void) {
  uint8_t x = 0;
  took(VBLANK_ROWS_BEGIN);
  while (RAM[(ROWS + x) & 0x7FF] != 0xFF) {
    took(VBLANK_ROW_BEGINS);
    uint8_t high = RAM[(ROWS + x++) & 0x7FF], low = RAM[(ROWS + x++) & 0x7FF], count = RAM[(ROWS + x++) & 0x7FF];
    took(VBLANK_ROW_ADDRESS);
    ppu_address(high, low);
    write_run((uint16_t)(ROWS + x), count, VBLANK_RUN_BYTE);
    x += count;
    RAM[0x34] = high;
    RAM[0x5A]++;
    took(VBLANK_ROW_ENDS);
    hardware_write(0x2006, high);
    hardware_write(0x2006, 0);
    hardware_write(0x2006, 0);
    hardware_write(0x2006, 0);
  }
  took(VBLANK_ROWS_END);
  RAM[ROWS] = 0xFF;
  ROWS_END = 0;
}

// $C0F0 to $C21D: the sprites, then the lists the tasks left, or else the next 32 attributes, and last the scroll and
// the picture's mask. The original turns the picture off while it writes.
void vblank_draws(void) {
  took(VBLANK_TO_SPRITES_PLACE);
  hardware_write(0x2003, 0);
  RAM[0xB1] = (uint8_t)(((RAM[0xB1] + 1) & 1) | 2);  // the sprites' two lists, $0200 and $0300, a frame each
  took(VBLANK_TO_SPRITES);
  hardware_send_sprites(RAM[0xB1]);
  took(VBLANK_SPRITES_SENT);
  RAM[0x5A] = 0;                                     // counts what's written this frame
  took(VBLANK_TO_MASK);
  hardware_write(0x2001, 0);
  if (WIDE_ROWS_READY) {
    took(VBLANK_LIST_IS_READY);
    took(VBLANK_WIDE_ROWS_BEGIN);
    RAM[0x5A]++;
    write_list(WIDE_ROWS);
    took(VBLANK_WIDE_ROWS_END);
    WIDE_ROWS_READY = 0;
  } else {
    took(VBLANK_LIST_NOT_READY);
    if (COLUMN_READY) {
      took(VBLANK_LIST_IS_READY);
      took(VBLANK_COLUMN_BEGIN);
      hardware_write(0x2000, PPU_CONTROL | 0x04);      // down the screen
      RAM[0x5A]++;
      write_list(COLUMN);
      took(VBLANK_COLUMN_END);
      COLUMN_READY = 0;
      hardware_write(0x2000, PPU_CONTROL);
    } else took(VBLANK_LIST_NOT_READY);
  }
  if (ROWS_BUSY) took(VBLANK_ROWS_BUSY);
  else write_rows();
  if (RAM[0x5A]) took(VBLANK_WROTE_SOMETHING);
  else {
    // $C1D3: 32 attributes from $58 to the PPU at $56, and on to the next 32, around both name tables' 64
    took(VBLANK_ATTRIBUTES_BEGIN);
    ppu_address(RAM[0x57], RAM[0x56]);
    write_run(ram16(0x58), 32, VBLANK_ATTRIBUTE);
    RAM[0x58] = (uint8_t)((RAM[0x58] + 0x20) & 0x7F);
    uint8_t carry = RAM[0x56] > 0xDF;
    RAM[0x56] = (uint8_t)((RAM[0x56] + 0x20) | 0xC0);
    RAM[0x57] = (uint8_t)(((RAM[0x57] + carry) & 0x24) | 0x03);
    took(VBLANK_ATTRIBUTES_END);
  }
  took(VBLANK_SCROLL_AND_MASK);
  hardware_ppu_latch();
  hardware_write(0x2005, SCROLL_X);
  hardware_write(0x2005, SCROLL_Y);
  hardware_write(0x2000, PPU_CONTROL);
  hardware_write(0x2001, PPU_MASK);
}

// sub_EECF. The original keeps its place in $22 to $27, and its callers read where it stopped from there. The list is
// marked busy while it's added to, and V-blank leaves it alone until it's freed.
void queue_rows(uint16_t from, uint16_t to, uint8_t rows, uint8_t count) {
  set_ram16(0x26, from);
  set_ram16(0x24, to);
  RAM[0x22] = rows;
  RAM[0x23] = count;
  took(ROWS_MARK_BEGINS);
  ROWS_BUSY = 0xFF;
  took(ROWS_BEGIN);
  uint8_t at = ROWS_END;
  do {
    at = ROWS_END;
    took(ROWS_ROW_BEGINS);
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x25];
    took(ROWS_ROW_NEXT_BYTE);
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x24];
    took(ROWS_ROW_NEXT_BYTE);
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x23];
    RAM[0x4A] = RAM[0x23];
    took(ROWS_ROW_KEPT);
    do {
      uint16_t source = ram16(0x26);
      took(ROWS_BYTE_READ);
      RAM[(ROWS + at++) & 0x7FF] = peek(source);
      set_ram16(0x26, (uint16_t)(source + 1));
      took(ROWS_BYTE_STORED);
      if (!RAM[0x26]) took(ROWS_BYTE_NEXT_PAGE);
      took(--RAM[0x4A] ? GOES_ROUND : GOES_ON);
    } while (RAM[0x4A]);
    ROWS_END = at;
    set_ram16(0x24, (uint16_t)(ram16(0x24) + 0x20));
    took(ROWS_ROW_ENDS);
    took(--RAM[0x22] ? ROWS_ROW_AGAIN : GOES_ON);
  } while (RAM[0x22]);
  took(ROWS_END_MARK);
  RAM[(ROWS + at) & 0x7FF] = 0xFF;
  took(ROWS_FREED);
  ROWS_BUSY = 0;
  took(ROWS_BACK);
}

// sub_EEBF and sub_EEBA: colours for the PPU's palette at $3F00.
void queue_palette(uint16_t from) {
  took(PALETTE_SET_UP);
  queue_rows(from, 0x3F00, 1, 0x20);
}
void queue_background_palette(uint16_t from) {
  took(HALF_PALETTE_SET_UP);
  queue_rows(from, 0x3F00, 1, 0x10);
}

// sub_F171: the picture goes off at the next V-blank, which the task waits a turn for.
wait picture_off(void) {
  PPU_MASK &= 0xE7;
  took(PICTURE_GOES_OFF);
  return YIELDS;
}

// sub_F17A
void picture_on(void) {
  PPU_MASK |= 0x18;
  took(PICTURE_COMES_ON);
}

// sub_CA2E, for the name table at $2000, and $CA37, for the one at $2400: 30 rows of the empty tile, from $CA76.
void clear_rows_begin(uint8_t second_table) {
  set_ram16(0x24, second_table ? 0x2400 : 0x2000);
  RAM[0x53] = 15;
  took(second_table ? SECOND_TABLE_ROWS : FIRST_TABLE_ROWS);
}
// $CA43
void clear_rows_queue(void) {
  for (int row = 0; row < 2; row++) {
    took(FRESH_ROW_CALLED);
    queue_rows(0xCA76, ram16(0x24), 1, 0x20);
  }
  FRAMES_SINCE_ROUND = 0;
  took(FRESH_ROWS_TO_CONTROL);
  write_ppu_control(PPU_CONTROL | 0x80);
  PPU_MASK &= 0xE7;
  took(FRESH_ROWS_TO_WAIT);
}
// $CA5E
int clear_rows_done(void) {
  took(FRESH_ROWS_COUNTED);
  if (--RAM[0x53]) { took(GOES_ROUND); return 0; }
  took(GOES_ON);
  took(RETURNS);
  return 1;
}

// sub_C62C, with sub_C63E, sub_C7ED, sub_CA2E, sub_CA63 and sub_CA96.
wait fresh_screen(uint8_t *step) {
  enum { PICTURE_OFF, COLOURS, ATTRIBUTES_AND_ROWS, TWO_ROWS, ROWS_WRITTEN };
  for (;;) switch (*step) {
    case PICTURE_OFF:
      *step = COLOURS;
      took(CALLS);
      return picture_off();
    case COLOURS:
      // sub_C63E: the view back at the stage's start, and sub_C7ED: the title screen's colours, from $C80C
      SCROLL_X = SCROLL_Y = 0;
      RAM[0x65] = RAM[0x64] = RAM[0x68] = RAM[0x67] = 0;
      took(FRESH_VIEW_BACK);
      queue_palette(0xC80C);
      *step = ATTRIBUTES_AND_ROWS;
      took(CALLS);
      return YIELDS;
    case ATTRIBUTES_AND_ROWS:
      // its attributes, from $C82C, for both name tables
      took(FRESH_ATTRIBUTES_BEGIN);
      for (int i = 0; i < 0x40; i++) {
        RAM[ATTRIBUTES + i] = RAM[ATTRIBUTES + 0x40 + i] = cart(7, (uint16_t)(0xC82C + i));
        took(FRESH_ATTRIBUTE);
        took(i < 0x3F ? GOES_ROUND_FAR : GOES_ON);
      }
      PPU_CONTROL &= 0xFC;
      took(FRESH_ROWS_BEGIN);
      clear_rows_begin(0);
      *step = TWO_ROWS;
      break;
    case TWO_ROWS:
      clear_rows_queue();
      *step = ROWS_WRITTEN;
      return SPINS;   // $CA5A: until V-blank has written them
    case ROWS_WRITTEN:
      if (!clear_rows_done()) { *step = TWO_ROWS; break; }
      // sub_CA96: no objects. The original's loop leaves the one byte at $05F0 as it was.
      for (int i = 0x04F0; i < 0x0680; i++) if (i != 0x05F0) RAM[i] = 0;
      took(FRESH_NO_OBJECTS);
      set_ram16(0x26, 0x05F0);
      RAM[0x23] = 0;
      picture_on();
      *step = 0;
      return DONE;
  }
}

// sub_C0D9: four rows of 32 bytes a frame, which is 128 bytes of tiles, as many times as asked.
wait load_tiles(uint8_t *step, uint16_t from, uint16_t to, uint8_t groups) {
  static uint8_t left;
  enum { FIRST, A_GROUP, WRITTEN };
  for (;;) switch (*step) {
    case FIRST:
      set_ram16(0x26, from);
      set_ram16(0x24, to);
      left = groups;
      took(LOAD_TILES_BEGINS);
      *step = A_GROUP;
      break;
    case A_GROUP:
      took(LOAD_TILES_GROUP);
      queue_rows(ram16(0x26), ram16(0x24), 4, 0x20);
      took(LOAD_TILES_WAITS);
      *step = WRITTEN;
      return SPINS;   // $C0E8: until V-blank counts a frame
    case WRITTEN:
      took(LOAD_TILES_COUNTED);
      if (--left) { took(GOES_ROUND); *step = A_GROUP; break; }
      took(GOES_ON);
      took(RETURNS);
      *step = 0;
      return DONE;
  }
}

// $E569, the tiles' task: tiles the game needs while it plays go to the PPU 32 bytes a round, from bank 0. There are two
// lists of them, and the second waits while the first has any: for each, $E668 or $E670 says where a set of tiles is
// and where it goes, and $E680 or $E684 where it ends.
wait tiles_task(void) {
  enum { START, FIRST_ROUND, EACH_ROUND };
  uint8_t *step = &task_step[TASK_TILES];
  if (*step == START) {
    for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
    *step = FIRST_ROUND;
    took(TILES_START);
    return YIELDS;
  }
  if (*step == EACH_ROUND) took(TILES_AGAIN);
  *step = EACH_ROUND;
  switch_bank(0);
  took(TILES_BEGIN);
  // each list's place in work memory: the set it's sending, where it has got to, and where that goes
  for (int list = 0; list < 2; list++) {
    uint16_t state = list ? 0xDA : 0xD5, sets = list ? 0xE670 : 0xE668, ends = list ? 0xE684 : 0xE680;
    uint8_t set = RAM[state];
    if (set == 0xFF) {
      took(list ? TILES_SECOND_IDLE : TILES_FIRST_IDLE);
      continue;
    }
    took(list ? TILES_SECOND_ACTIVE : TILES_FIRST_ACTIVE);
    if (RAM[state + 2] != 0xFF) {
      took(TILES_SET_GOES_ON);
      if (list) took(TILES_SECOND_SET_PAGE);
    }
    else {
      took(TILES_SET_BEGINS);
      for (int i = 0; i < 4; i++) RAM[state + 1 + i] = cart(7, (uint16_t)(sets + set * 4 + i));
    }
    took(TILES_ROW);
    queue_rows(ram16((uint16_t)(state + 1)), ram16((uint16_t)(state + 3)), 1, 0x20);
    set_ram16((uint16_t)(state + 1), ram16(0x26));
    set_ram16((uint16_t)(state + 3), ram16(0x24));
    took(TILES_ROW_KEPT);
    uint8_t done = ram16((uint16_t)(state + 1)) >= (uint16_t)(cart(7, (uint16_t)(ends + set * 2)) | cart(7, (uint16_t)(ends + set * 2 + 1)) << 8);
    if (done) RAM[state] = RAM[state + 2] = 0xFF;
    took(list ? (done ? TILES_SECOND_DONE : TILES_SECOND_NOT_DONE) : (done ? TILES_FIRST_DONE : TILES_FIRST_NOT_DONE));
    break;
  }
  switch_bank(BANK_HOME);
  took(TILES_END);
  return YIELDS;
}
