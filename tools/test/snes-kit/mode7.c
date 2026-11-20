// The mode 7 program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpMode7Cartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, with its map, tiles and colours moved by DMA from the player's copy, each frame's setting and the matrix's
// cosines read from the copy, and the product read back from the picture unit, as the original's are. The test fills
// in where the data is, each name between two at signs.

#include "snes.h"

// a word to a register and the one after it, as a 16-bit store writes them: low byte first
static void store16(uint16_t address, uint16_t value) {
  snes_write(address, (uint8_t)value);
  snes_write((uint16_t)(address + 1), (uint8_t)(value >> 8));
}

// a DMA of `bytes` from `from`, in bank $00, on channel 0
static void dma(uint8_t mode, uint8_t to, uint16_t from, uint16_t bytes) {
  snes_write(0x4300, mode);
  snes_write(0x4301, to);
  store16(0x4302, from);
  snes_write(0x4304, 0);
  store16(0x4305, bytes);
  snes_write(0x420B, 0x01);
}

// a word to one of mode 7's registers, low byte first, both through the same register, as the console takes them
static void twice(uint16_t address, uint16_t value) {
  snes_write(address, (uint8_t)value);
  snes_write(address, (uint8_t)(value >> 8));
}

// a word of the copy, in bank $00
static uint16_t rom_word(uint16_t at) { return (uint16_t)(snes_bus(at) | snes_bus((uint16_t)(at + 1)) << 8); }

void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = 0;
  snes_write(0x2100, 0x80);
  snes_write(0x4200, 0x00);
  // the map into the even bytes, the tiles into the odd ones, and the colours
  snes_write(0x2115, 0x00);
  store16(0x2116, 0x0000);
  dma(0x00, 0x18, @MAP@, 0x800);
  snes_write(0x2115, 0x80);
  store16(0x2116, 0x0000);
  dma(0x00, 0x19, @TILES@, 0x400);
  snes_write(0x2121, 0x00);
  dma(0x00, 0x22, @PALETTE@, 0x200);
  snes_write(0x2105, 0x07);
  snes_write(0x211F, 0x80);
  snes_write(0x211F, 0x00);
  snes_write(0x2120, 0x70);
  snes_write(0x2120, 0x00);
  snes_write(0x2132, 0x2A);
  snes_write(0x2132, 0x4C);
  snes_write(0x2132, 0x91);
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x80);
}

// the V-blank: the setting for the frame's count over 16, the matrix, the backdrop from its product, window 1 and the
// scroll, and the count on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  uint16_t index = frame >> 4 & 0x0F, x = (uint16_t)(index * 9);
  SNES_RAM[4] = (uint8_t)index;
  SNES_RAM[5] = (uint8_t)(index >> 8);
  snes_write(0x211A, snes_bus(@SETTINGS@ + x));
  snes_write(0x2106, snes_bus(@SETTINGS@ + 1 + x));
  snes_write(0x2133, snes_bus(@SETTINGS@ + 2 + x));
  snes_write(0x212C, snes_bus(@SETTINGS@ + 3 + x));
  snes_write(0x212D, snes_bus(@SETTINGS@ + 4 + x));
  snes_write(0x2130, snes_bus(@SETTINGS@ + 5 + x));
  snes_write(0x2131, snes_bus(@SETTINGS@ + 6 + x));
  snes_write(0x2123, snes_bus(@SETTINGS@ + 7 + x));
  snes_write(0x212E, snes_bus(@SETTINGS@ + 8 + x));
  // the matrix from the count as an angle: A and D its cosine, B its sine, C the sine taken away from nothing
  uint16_t at = (uint16_t)(low << 1);
  uint16_t cosine = rom_word((uint16_t)(@COSINES@ + at));
  at = (uint16_t)((at - 0x80) & 0x1FE);
  uint16_t sine = rom_word((uint16_t)(@COSINES@ + at)), minus = (uint16_t)((sine ^ 0xFFFF) + 1);
  SNES_RAM[4] = (uint8_t)cosine;
  SNES_RAM[5] = (uint8_t)(cosine >> 8);
  SNES_RAM[6] = (uint8_t)sine;
  SNES_RAM[7] = (uint8_t)(sine >> 8);
  SNES_RAM[8] = (uint8_t)minus;
  SNES_RAM[9] = (uint8_t)(minus >> 8);
  twice(0x211B, cosine);
  twice(0x211C, sine);
  twice(0x211D, minus);
  twice(0x211E, cosine);
  // the product back as the backdrop's colour
  snes_write(0x2121, 0x00);
  snes_write(0x2122, snes_read(0x2134));
  snes_write(0x2122, (uint8_t)(snes_read(0x2135) & 0x7F));
  // window 1 from five times the count, 100 pixels wide, and the field scrolled across and down
  uint8_t left = (uint8_t)(low * 5);
  snes_write(0x2126, left);
  snes_write(0x2127, (uint8_t)(left + 100));
  snes_write(0x210D, (uint8_t)(low << 1));
  snes_write(0x210D, 0x00);
  snes_write(0x210E, low);
  snes_write(0x210E, 0x00);
  frame++;
  SNES_RAM[0] = (uint8_t)frame;
  SNES_RAM[1] = (uint8_t)(frame >> 8);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
