// Ghosts'n Goblins Dreamport: the game's own code, in C, on the NES kit in C (kit/nes/c/nes.h), with the console's screen,
// frame, sound and buttons in console.h, which the build makes from kit/consoles.js. src/main.js runs it on the page, built
// to WebAssembly as src/game.wasm (kit/nes/c/README.md).
//
// So far it has the title screen, written from the original's code: the palette at $C80C, the attributes at $C82C, the
// tiles at bank 0 $8000, and the title screen's own words and logo from the copy's bank 0, every one read from the
// player's copy as it runs. The original loads them through its V-blank queue over the first 98 frames with the picture
// off, and turns the picture on at frame 99, so this does the same. Nothing of the game is in this file.

#include "nes.h"

// The frame the original's title screen first shows in, measured with the proof tools from power-on.
#define TITLE_SCREEN_FRAME 99

// The original's last bank of program, always at $C000, and its first, at $8000 while bank 0 is switched in.
static const uint8_t *last_bank(void) { return nes_prg + nes_prg_size - 0x4000; }

// One of the original's title screen addresses as the copy holds it: while the title screen is drawn, bank 3 is switched
// in at $8000, and the last bank stays at $C000.
static uint8_t title_byte(uint16_t address) {
  if (address >= 0xC000) return last_bank()[address - 0xC000];
  return nes_prg[0xC000 + (address - 0x8000)];
}

// A word at one of the original's title screen addresses, little endian, as the original reads it.
static uint16_t title_word(uint16_t address) {
  return (uint16_t)(title_byte(address) | title_byte((uint16_t)(address + 1)) << 8);
}

// The PPU's address register, then the bytes written after it, as the original's stores to $2006 and $2007 do.
static void ppu_address(uint16_t address) {
  nes_write(0x2006, (uint8_t)(address >> 8));
  nes_write(0x2006, (uint8_t)address);
}

static void ppu_byte(uint8_t value) { nes_write(0x2007, value); }

// sub_C691, sub_C71D, sub_C72A and sub_C737: a run of bytes from the copy to the PPU, `rows` rows of `columns` bytes,
// each row 32 bytes after the one before.
static void copy_rows(uint16_t from, uint16_t to, int rows, int columns) {
  for (int row = 0; row < rows; row++) {
    ppu_address((uint16_t)(to + row * 0x20));
    for (int column = 0; column < columns; column++) ppu_byte(title_byte((uint16_t)(from + row * columns + column)));
  }
}

// sub_C691, with the copy's own address at $xx: one row of `columns` bytes from an address of the game's.
static void copy_row(uint16_t from, uint16_t to, int columns) {
  ppu_address(to);
  for (int column = 0; column < columns; column++) ppu_byte(title_byte((uint16_t)(from + column)));
}

// sub_C668: the title screen's logo, seven rows of twenty tiles, from the list the copy's bank 0 points at from $8054.
static void draw_title_logo(void) {
  uint16_t from = title_word(0x8054);
  copy_rows(from, 0x2128, 8, 20);
}

// sub_C69C: the top of the title screen, the score's six digits and the words beside them, from the copy's own lists.
static void draw_title_top(void) {
  // $C744 reads the score from $04E0, which the original clears, so its six digits are the tiles' zero.
  ppu_address(0x2062);
  for (int i = 0; i < 7; i++) ppu_byte(0);
  ppu_address(0x206C);
  for (int i = 0; i < 7; i++) ppu_byte(0);
  // $A2 is on for the title screen, so the second player's score and its words are drawn too.
  ppu_address(0x2076);
  for (int i = 0; i < 7; i++) ppu_byte(0);
  copy_row(0xC86C, 0x2044, 3);
  copy_row(0xC872, 0x204E, 3);
  copy_row(0xC86F, 0x2058, 3);
}

// sub_C753: the words in the middle of the title screen, from the last bank's lists.
static void draw_title_words(void) {
  copy_row(0xC875, 0x224D, 9);
  copy_row(0xC87E, 0x228D, 9);
}

// sub_C7CD: three rows of the copyright, from the list the copy's bank 0 points at from $8056.
static void draw_title_copyright(void) {
  uint16_t from = title_word(0x8056);
  copy_rows(from, 0x2342, 3, 29);
}

// sub_C7ED: the title screen's colours, the 32 the PPU's palette takes from $3F00, from the last bank at $C80C.
static void draw_title_palette(void) {
  ppu_address(0x3F00);
  for (int i = 0; i < 32; i++) ppu_byte(last_bank()[0x80C + i]);
}

// The title screen's attributes, the 64 bytes at $23C0 from $C82C.
static void draw_title_attributes(void) {
  ppu_address(0x23C0);
  for (int i = 0; i < 64; i++) ppu_byte(last_bank()[0x82C + i]);
}

// sub_CA2E: the screen's 960 tiles, filled with $FF, the blank tile, before the title screen's own are written over them.
static void clear_screen(void) {
  ppu_address(0x2000);
  for (int i = 0; i < 960; i++) ppu_byte(0xFF);
}

// sub_F171: clears the background and sprites from the picture's mask, $39, which the original then hands to its scheduler.
// The Dreamport has one task, so the handoff is the end of the step.
static void sub_F171(void) { nes_ram[0x39] &= 0xE7; }

// sub_F17A: sets the background and sprites again in the mask, $39, as the original does once its tiles are in.
static void sub_F17A(void) { nes_ram[0x39] |= 0x18; }

// sub_C0C9: the tiles, 8 KB from the copy's bank 0 at $8000, to the PPU's pattern tables at $0000. The original waits for
// each 32 bytes to go in V-blank, with the picture off, over 64 frames.
static void load_tiles(void) {
  ppu_address(0x0000);
  for (uint32_t i = 0; i < 0x2000; i++) ppu_byte(nes_prg[i]);
}

// sub_D478-ish, the title screen's sprites: the sword beside "1 PLAYER", and every other sprite kept below the screen.
// The sword's place and tiles are the original's own object at $04F0: $0509's Y, $0522's tile, $053B's colour and
// $0554's X, which the title screen sets after its picture is on.
static void draw_title_sprites(void) {
  nes_write(0x2003, 0);
  for (int sprite = 0; sprite < 64; sprite++) {
    nes_write(0x2004, 0xFF);
    nes_write(0x2004, 0xFF);
    nes_write(0x2004, 0xFF);
    nes_write(0x2004, 0xFF);
  }
  nes_write(0x2003, 0);
  nes_write(0x2004, 0x8A);
  nes_write(0x2004, 0xCE);
  nes_write(0x2004, 0x01);
  nes_write(0x2004, 0x58);
  nes_write(0x2004, 0x92);
  nes_write(0x2004, 0xCF);
  nes_write(0x2004, 0x01);
  nes_write(0x2004, 0x58);
}

// once, with the player's copy in kit_copy and the cartridge in nes_prg and nes_chr
void game_start(void) {
  nes_write(0x2000, 0x90);  // the original's $FF, with the V-blank interrupt on and the sprites' tiles at $1000
  nes_write(0x2001, 0x00);  // the picture off while the title screen goes in
  nes_write(0x2005, 0);
  nes_write(0x2005, 0);
  nes_ram[0x39] = 0x1E;     // the original's mask shadow at reset
  sub_F171();
  load_tiles();
  sub_F17A();
  clear_screen();
  draw_title_attributes();
  draw_title_logo();
  draw_title_top();
  draw_title_words();
  draw_title_copyright();
  draw_title_sprites();
}

// The frame Start was pressed on the title screen, or -1 before then. The original turns its picture off three frames
// after Start, while its player select runs, and the first of those black frames is 103.
static int start_frame = -1;

// what the original does each frame, from its V-blank on, writing the PPU's and the APU's registers as it does
void game_step(uint32_t buttons) {
  uint32_t frame = nes_frame();
  if (start_frame < 0 && frame >= TITLE_SCREEN_FRAME && (buttons & BUTTON_START)) start_frame = (int)frame;
  if (start_frame >= 0 && frame == (uint32_t)(start_frame + 3)) nes_write(0x2001, 0);
  // $ED97, the original's clear of the APU's registers: once as it starts, and once when the title screen is drawn.
  if (frame == 1) {
    nes_write(0x4015, 0x0F);
    for (int i = 0x0F; i >= 0; i--) nes_write((uint16_t)(0x4000 + i), 0);
  }
  if (frame == 4) {
    // sub_ED97, as the original writes it: $400F down to $4000, one register at a time.
    for (int i = 0x0F; i >= 0; i--) nes_write((uint16_t)(0x4000 + i), 0);
  }
  if (frame == 6) draw_title_palette();
  if (frame == 22) {
    for (int i = 0; i < 0x10; i++) nes_write((uint16_t)(0x4000 + i), 0);
  }
  if (frame == TITLE_SCREEN_FRAME) {
    nes_write(0x2000, 0x90);
    nes_write(0x2005, 0);
    nes_write(0x2005, 0);
    nes_write(0x2001, nes_ram[0x39]);
  }
}
