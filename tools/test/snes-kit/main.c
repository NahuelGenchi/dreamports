// The picture program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpPictureCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, with its tiles, maps and colours moved by DMA from the player's copy, as the original's are. The test fills in
// where the data is, each name between two at signs.

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
  snes_write(0x2105, 0x09);
  snes_write(0x2107, 0x04);
  snes_write(0x2109, 0x0C);
  snes_write(0x210B, 0x00);
  snes_write(0x210C, 0x01);
  snes_write(0x212C, 0x05);
  snes_write(0x4200, 0x80);
}

// the V-blank: the scroll from the frame's count, the brightness, and the count moved on
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  snes_write(0x210D, low);
  snes_write(0x210D, (uint8_t)(frame >> 8));
  snes_write(0x210E, (uint8_t)(low >> 1));
  snes_write(0x210E, 0x00);
  snes_write(0x2111, (uint8_t)(low ^ 0xFF));
  snes_write(0x2111, 0x03);
  snes_write(0x2112, (uint8_t)(low << 1));
  snes_write(0x2112, 0x00);
  snes_write(0x2100, (uint8_t)((low >> 3 & 0x0F) ^ 0x0F));
  frame++;
  SNES_RAM[0] = (uint8_t)frame;
  SNES_RAM[1] = (uint8_t)(frame >> 8);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) { (void)left; (void)right; (void)count; }
