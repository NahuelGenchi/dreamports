// The colour program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpColourCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, with its tiles, maps, colours and sprites moved by DMA from the player's copy, and each frame's setting read
// from the copy, as the original's are. The test fills in where the data is, each name between two at signs.

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

void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = 0;
  snes_write(0x2100, 0x80);
  snes_write(0x4200, 0x00);
  snes_write(0x2115, 0x80);
  store16(0x2116, 0x0000);
  dma(0x01, 0x18, @TILES@, @TILES_BYTES@);
  store16(0x2116, 0x1000);
  dma(0x01, 0x18, @SMALL@, @SMALL_BYTES@);
  store16(0x2116, 0x0400);
  dma(0x01, 0x18, @MAP@, 0x800);
  store16(0x2116, 0x0C00);
  dma(0x01, 0x18, @SMALL_MAP@, 0x800);
  snes_write(0x2121, 0x00);
  dma(0x00, 0x22, @PALETTE@, 0x200);
  // the sprites' table, through its port
  snes_write(0x2102, 0x00);
  snes_write(0x2103, 0x00);
  dma(0x00, 0x04, @OAM@, 544);
  snes_write(0x2105, 0x09);
  snes_write(0x2107, 0x04);
  snes_write(0x2108, 0x04);
  snes_write(0x2109, 0x0C);
  snes_write(0x210B, 0x00);
  snes_write(0x210C, 0x01);
  snes_write(0x2101, 0x00);
  snes_write(0x4200, 0x80);
}

// the V-blank: the setting for the frame's count over 16, the windows, the fixed colour, the scrolls, the count on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  uint16_t four = (uint16_t)((frame >> 4 & 0x0F) << 2), x = (uint16_t)(four * 3);
  SNES_RAM[4] = (uint8_t)four;
  SNES_RAM[5] = (uint8_t)(four >> 8);
  snes_write(0x2123, snes_bus(@SETTINGS@ + x));
  snes_write(0x2124, snes_bus(@SETTINGS@ + 1 + x));
  snes_write(0x2125, snes_bus(@SETTINGS@ + 2 + x));
  snes_write(0x212A, snes_bus(@SETTINGS@ + 3 + x));
  snes_write(0x212B, snes_bus(@SETTINGS@ + 4 + x));
  snes_write(0x212C, snes_bus(@SETTINGS@ + 5 + x));
  snes_write(0x212D, snes_bus(@SETTINGS@ + 6 + x));
  snes_write(0x212E, snes_bus(@SETTINGS@ + 7 + x));
  snes_write(0x212F, snes_bus(@SETTINGS@ + 8 + x));
  snes_write(0x2130, snes_bus(@SETTINGS@ + 9 + x));
  snes_write(0x2131, snes_bus(@SETTINGS@ + 10 + x));
  snes_write(0x2100, snes_bus(@SETTINGS@ + 11 + x));
  // window 1 from three times the count, 70 pixels wide, and window 2 from $C0 less it, 40 and more wide
  SNES_RAM[6] = low;
  uint8_t one = (uint8_t)(low * 3);
  snes_write(0x2126, one);
  snes_write(0x2127, (uint8_t)(one + 70));
  uint8_t two = (uint8_t)(0xC0 - low);
  snes_write(0x2128, two);
  SNES_RAM[6] = two;
  snes_write(0x2129, (uint8_t)((low & 0x1F) + 40 + two));
  // the fixed colour's red, green and blue from the count
  snes_write(0x2132, (uint8_t)((low & 0x1F) | 0x20));
  snes_write(0x2132, (uint8_t)((low >> 1 & 0x1F) | 0x40));
  snes_write(0x2132, (uint8_t)(((low & 0x1F) ^ 0x1F) | 0x80));
  // BG1 across, BG2 down, BG3 across twice as fast
  snes_write(0x210D, low);
  snes_write(0x210D, 0x00);
  snes_write(0x2110, (uint8_t)(low >> 1));
  snes_write(0x2110, 0x00);
  snes_write(0x2111, (uint8_t)(low << 1));
  snes_write(0x2111, 0x00);
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
