// The sprite program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpSpriteCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, with its tiles, its map, its colours and its sprites' table moved by DMA from the player's copy. The test fills
// in where the data is, each name between two at signs.

#include "snes.h"

static void store16(uint16_t address, uint16_t value) {
  snes_write(address, (uint8_t)value);
  snes_write((uint16_t)(address + 1), (uint8_t)(value >> 8));
}

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
  for (int i = 0; i < 12; i++) {
    store16(0x2116, (uint16_t)(i * 0x400));
    dma(0x01, 0x18, @TILES@, @TILES_BYTES@);
  }
  store16(0x2116, 0x4000);
  dma(0x01, 0x18, @BG_TILES@, 0x200);
  store16(0x2116, 0x3C00);
  dma(0x01, 0x18, @MAP@, 0x800);
  snes_write(0x2121, 0x00);
  dma(0x00, 0x22, @PALETTE@, 0x200);
  snes_write(0x2102, 0x00);
  snes_write(0x2103, 0x00);
  dma(0x00, 0x04, @OAM@, 544);
  snes_write(0x2105, 0x01);
  snes_write(0x2107, 0x3C);
  snes_write(0x210B, 0x04);
  snes_write(0x212C, 0x11);
  snes_write(0x4200, 0x80);
}

void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  // $2101: the sizes from bits 4 to 6 of the count, the second table's gap from bit 7
  SNES_RAM[2] = (uint8_t)((low & 0x70) << 1);
  snes_write(0x2101, (uint8_t)(SNES_RAM[2] | (low & 0x80) >> 4));
  // the first 8 sprites
  snes_write(0x2102, 0x00);
  snes_write(0x2103, 0x00);
  for (uint8_t x = 0; x < 8; x++) {
    snes_write(0x2104, (uint8_t)((x << 4) + low));
    snes_write(0x2104, (uint8_t)((uint8_t)((x << 3) + low) >> 1));
    snes_write(0x2104, (uint8_t)(x + low));
    snes_write(0x2104, (uint8_t)(x ^ low));
  }
  snes_write(0x2102, 0x00);
  snes_write(0x2103, 0x01);
  snes_write(0x2104, low);
  snes_write(0x2104, (uint8_t)(low ^ 0xFF));
  // the first sprite by $2103's priority bit, every 64 frames, half of those from an odd address with a byte written
  if (low & 0x40) {
    snes_write(0x2102, (uint8_t)(low << 1));
    snes_write(0x2103, 0x80);
    if (low & 0x20) {
      snes_write(0x2102, (uint8_t)(low << 1 | 1));
      snes_write(0x2103, 0x80);
      snes_write(0x2104, 0x00);
    }
  } else {
    snes_write(0x2102, 0x00);
    snes_write(0x2103, 0x00);
  }
  snes_write(0x210D, low);
  snes_write(0x210D, (uint8_t)(frame >> 8));
  snes_write(0x210E, low);
  snes_write(0x210E, 0x00);
  snes_write(0x2100, 0x0F);
  frame++;
  SNES_RAM[0] = (uint8_t)frame;
  SNES_RAM[1] = (uint8_t)(frame >> 8);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) { (void)left; (void)right; (void)count; }
