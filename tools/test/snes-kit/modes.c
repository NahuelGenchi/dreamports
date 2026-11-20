// The modes program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpModesCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, with its tiles, map, table of offsets and colours moved by DMA from the player's copy, and each frame's setting
// read from the copy, as the original's are. The test fills in where the data is, each name between two at signs.

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
  store16(0x2116, 0x2000);
  dma(0x01, 0x18, @BIG@, @BIG_BYTES@);
  store16(0x2116, 0x0400);
  dma(0x01, 0x18, @MAP@, 0x800);
  store16(0x2116, 0x0C00);
  dma(0x01, 0x18, @OFFSETS@, 0x800);
  snes_write(0x2121, 0x00);
  dma(0x00, 0x22, @PALETTE@, 0x200);
  snes_write(0x2107, 0x04);
  snes_write(0x2108, 0x04);
  snes_write(0x2109, 0x0C);
  snes_write(0x210A, 0x04);
  snes_write(0x210C, 0x11);
  snes_write(0x2132, 0x2A);
  snes_write(0x2132, 0x4C);
  snes_write(0x2132, 0x91);
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x80);
}

// the V-blank: the setting for the frame's count over 16, window 1, the scrolls, the count on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  uint16_t two = (uint16_t)((frame >> 4 & 0x0F) << 1), x = (uint16_t)(two * 5);
  SNES_RAM[4] = (uint8_t)two;
  SNES_RAM[5] = (uint8_t)(two >> 8);
  snes_write(0x2105, snes_bus(@SETTINGS@ + x));
  snes_write(0x2106, snes_bus(@SETTINGS@ + 1 + x));
  snes_write(0x210B, snes_bus(@SETTINGS@ + 2 + x));
  snes_write(0x2123, snes_bus(@SETTINGS@ + 3 + x));
  snes_write(0x2125, snes_bus(@SETTINGS@ + 4 + x));
  snes_write(0x212C, snes_bus(@SETTINGS@ + 5 + x));
  snes_write(0x212D, snes_bus(@SETTINGS@ + 6 + x));
  snes_write(0x212E, snes_bus(@SETTINGS@ + 7 + x));
  snes_write(0x2130, snes_bus(@SETTINGS@ + 8 + x));
  snes_write(0x2131, snes_bus(@SETTINGS@ + 9 + x));
  // window 1 from five times the count, 100 pixels wide
  uint8_t left = (uint8_t)(low * 5);
  snes_write(0x2126, left);
  snes_write(0x2127, (uint8_t)(left + 100));
  // BG1 across and down, BG2 back across and down, BG3 across three times as fast and down slowly
  snes_write(0x210D, low);
  snes_write(0x210D, 0x00);
  snes_write(0x210E, (uint8_t)(low >> 1));
  snes_write(0x210E, 0x00);
  snes_write(0x210F, (uint8_t)(low ^ 0xFF));
  snes_write(0x210F, 0x00);
  snes_write(0x2110, (uint8_t)(low >> 2));
  snes_write(0x2110, 0x00);
  snes_write(0x2111, (uint8_t)(low * 3));
  snes_write(0x2111, 0x00);
  snes_write(0x2112, (uint8_t)(low >> 3));
  snes_write(0x2112, 0x00);
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
