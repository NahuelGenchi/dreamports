// Ghosts'n Goblins Dreamport: how the game's picture reaches the PPU. Only V-blank writes to it. The tasks leave what
// they want written in work memory: rows of tiles or colours in a list at $0720, a column of the stage at $07D8, and
// the colour attributes of both name tables at $0400, which V-blank writes a quarter at a time when it has nothing
// else to write. The tiles themselves come from the player's copy, through the same list.

#include "game.h"

// ---- V-blank's time. Its writes to the PPU take the processor's time, and what it writes last, the scroll and the
// picture's mask, takes effect when it's written, so each loop here moves the frame on by what the original's takes.
enum { CYCLES_SPRITES = 513, CYCLES_A_LISTED_BYTE = 15, CYCLES_AN_ATTRIBUTE = 16, CYCLES_A_LIST_ENTRY = 60, CYCLES_BEFORE = 50 };
static void took(int cycles) { nes_spend(cycles); }

static void ppu_address(uint8_t high, uint8_t low) {
  nes_read(0x2002);
  nes_write(0x2006, high);
  nes_write(0x2006, low);
}

// $C11F, $C15A and $C18E: a list of runs of bytes for the PPU, each its address, high byte first, a count and the
// bytes, up to the byte `end`.
static void write_list(uint16_t list, uint8_t end, int rows_list) {
  uint8_t x = 0;
  while (RAM[list + x] != end) {
    uint8_t high = RAM[list + x++], low = RAM[list + x++], count = RAM[list + x++];
    ppu_address(high, low);
    do { nes_write(0x2007, RAM[(list + x++) & 0x7FF]); took(CYCLES_A_LISTED_BYTE); } while (--count);
    took(CYCLES_A_LIST_ENTRY);
    if (rows_list) {
      // the rows' list leaves the PPU's address at the start of the same table, clear of the tiles
      RAM[0x34] = high;
      RAM[0x5A]++;
      nes_write(0x2006, high);
      nes_write(0x2006, 0);
      nes_write(0x2006, 0);
      nes_write(0x2006, 0);
    }
  }
}

// $C0F0 to $C21D: the sprites, then the lists the tasks left, or else the next 32 attributes, and last the scroll and
// the picture's mask. The original turns the picture off while it writes.
void vblank_draws(void) {
  nes_write(0x2003, 0);
  RAM[0xB1] = (uint8_t)(((RAM[0xB1] + 1) & 1) | 2);  // the sprites' two lists, $0200 and $0300, a frame each
  took(CYCLES_BEFORE);
  nes_write(0x4014, RAM[0xB1]);
  took(CYCLES_SPRITES);
  RAM[0x5A] = 0;                                     // counts what's written this frame
  nes_write(0x2001, 0);
  if (WIDE_ROWS_READY) {
    RAM[0x5A]++;
    write_list(WIDE_ROWS, 0, 0);
    WIDE_ROWS_READY = 0;
  } else if (COLUMN_READY) {
    nes_write(0x2000, PPU_CONTROL | 0x04);           // down the screen
    RAM[0x5A]++;
    write_list(COLUMN, 0, 0);
    COLUMN_READY = 0;
    nes_write(0x2000, PPU_CONTROL);
  }
  if (!ROWS_BUSY) {
    write_list(ROWS, 0xFF, 1);
    RAM[ROWS] = 0xFF;
    ROWS_END = 0;
  }
  if (RAM[0x5A] == 0) {
    // $C1D3: 32 attributes from $58 to the PPU at $56, and on to the next 32, around both name tables' 64
    uint16_t from = ram16(0x58);
    ppu_address(RAM[0x57], RAM[0x56]);
    for (int i = 0; i < 32; i++) { nes_write(0x2007, RAM[from + i]); took(CYCLES_AN_ATTRIBUTE); }
    RAM[0x58] = (uint8_t)((RAM[0x58] + 0x20) & 0x7F);
    uint8_t carry = RAM[0x56] > 0xDF;
    RAM[0x56] = (uint8_t)((RAM[0x56] + 0x20) | 0xC0);
    RAM[0x57] = (uint8_t)(((RAM[0x57] + carry) & 0x24) | 0x03);
  }
  nes_read(0x2002);
  nes_write(0x2005, SCROLL_X);
  nes_write(0x2005, SCROLL_Y);
  nes_write(0x2000, PPU_CONTROL);
  nes_write(0x2001, PPU_MASK);
}

// sub_EECF. The original keeps its place in $22 to $27, and its callers read where it stopped from there.
void queue_rows(uint16_t from, uint16_t to, uint8_t rows, uint8_t count) {
  set_ram16(0x26, from);
  set_ram16(0x24, to);
  RAM[0x22] = rows;
  RAM[0x23] = count;
  ROWS_BUSY = 0xFF;
  uint8_t at = ROWS_END;
  do {
    at = ROWS_END;
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x25];
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x24];
    RAM[(ROWS + at++) & 0x7FF] = RAM[0x23];
    RAM[0x4A] = RAM[0x23];
    do {
      uint16_t source = ram16(0x26);
      RAM[(ROWS + at++) & 0x7FF] = peek(source);
      set_ram16(0x26, (uint16_t)(source + 1));
    } while (--RAM[0x4A]);
    ROWS_END = at;
    set_ram16(0x24, (uint16_t)(ram16(0x24) + 0x20));
  } while (--RAM[0x22]);
  RAM[(ROWS + at) & 0x7FF] = 0xFF;
  ROWS_BUSY = 0;
}

// sub_EEBF and sub_EEBA: colours for the PPU's palette at $3F00.
void queue_palette(uint16_t from) { queue_rows(from, 0x3F00, 1, 0x20); }
void queue_background_palette(uint16_t from) { queue_rows(from, 0x3F00, 1, 0x10); }

// sub_F171: the picture goes off at the next V-blank, which the task waits a turn for.
wait picture_off(void) {
  PPU_MASK &= 0xE7;
  return YIELDS;
}

// sub_F17A
void picture_on(void) { PPU_MASK |= 0x18; }

// sub_C62C, with sub_C63E, sub_C7ED, sub_CA2E, sub_CA63 and sub_CA96.
wait fresh_screen(uint8_t *step) {
  enum { PICTURE_OFF, COLOURS, ATTRIBUTES_AND_ROWS, TWO_ROWS, ROWS_WRITTEN };
  for (;;) switch (*step) {
    case PICTURE_OFF:
      *step = COLOURS;
      return picture_off();
    case COLOURS:
      // sub_C63E: the view back at the stage's start, and sub_C7ED: the title screen's colours, from $C80C
      SCROLL_X = SCROLL_Y = 0;
      RAM[0x65] = RAM[0x64] = RAM[0x68] = RAM[0x67] = 0;
      queue_palette(0xC80C);
      *step = ATTRIBUTES_AND_ROWS;
      return YIELDS;
    case ATTRIBUTES_AND_ROWS:
      // its attributes, from $C82C, for both name tables
      for (int i = 0; i < 0x40; i++) RAM[ATTRIBUTES + i] = RAM[ATTRIBUTES + 0x40 + i] = cart(7, (uint16_t)(0xC82C + i));
      PPU_CONTROL &= 0xFC;
      // sub_CA2E: 30 rows of the empty tile, from $CA76, two a frame
      set_ram16(0x24, 0x2000);
      RAM[0x53] = 15;
      *step = TWO_ROWS;
      break;
    case TWO_ROWS:
      queue_rows(0xCA76, ram16(0x24), 1, 0x20);
      queue_rows(0xCA76, ram16(0x24), 1, 0x20);
      FRAMES_SINCE_ROUND = 0;
      write_ppu_control(PPU_CONTROL | 0x80);
      PPU_MASK &= 0xE7;
      *step = ROWS_WRITTEN;
      return SPINS;   // $CA5A: until V-blank has written them
    case ROWS_WRITTEN:
      if (--RAM[0x53]) { *step = TWO_ROWS; break; }
      // sub_CA96: no objects. The original's loop leaves the one byte at $05F0 as it was.
      for (int i = 0x04F0; i < 0x0680; i++) if (i != 0x05F0) RAM[i] = 0;
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
      *step = A_GROUP;
      break;
    case A_GROUP:
      queue_rows(ram16(0x26), ram16(0x24), 4, 0x20);
      *step = WRITTEN;
      return SPINS;   // $C0E8: until V-blank counts a frame
    case WRITTEN:
      if (--left) { *step = A_GROUP; break; }
      *step = 0;
      return DONE;
  }
}

// $E569, the tiles' task: tiles the game needs while it plays go to the PPU 32 bytes a round, from bank 0. There are two
// lists of them, and the second waits while the first has any: for each, $E668 or $E670 says where a set of tiles is
// and where it goes, and $E680 or $E684 where it ends.
wait tiles_task(void) {
  enum { START, EACH_ROUND };
  if (task_step[TASK_TILES] == START) {
    for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
    task_step[TASK_TILES] = EACH_ROUND;
    return YIELDS;
  }
  switch_bank(0);
  // each list's place in work memory: the set it's sending, where it has got to, and where that goes
  for (int list = 0; list < 2; list++) {
    uint16_t state = list ? 0xDA : 0xD5, sets = list ? 0xE670 : 0xE668, ends = list ? 0xE684 : 0xE680;
    uint8_t set = RAM[state];
    if (set == 0xFF) continue;
    if (RAM[state + 2] == 0xFF) for (int i = 0; i < 4; i++) RAM[state + 1 + i] = cart(7, (uint16_t)(sets + set * 4 + i));
    queue_rows(ram16((uint16_t)(state + 1)), ram16((uint16_t)(state + 3)), 1, 0x20);
    set_ram16((uint16_t)(state + 1), ram16(0x26));
    set_ram16((uint16_t)(state + 3), ram16(0x24));
    if (ram16((uint16_t)(state + 1)) >= (uint16_t)(cart(7, (uint16_t)(ends + set * 2)) | cart(7, (uint16_t)(ends + set * 2 + 1)) << 8)) RAM[state] = RAM[state + 2] = 0xFF;
    break;
  }
  switch_bank(BANK_HOME);
  return YIELDS;
}
