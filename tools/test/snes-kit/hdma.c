// The HDMA program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpHdmaCartridge) in C, on the console's
// kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same order, its
// seven HDMA channels set to the same tables in the player's copy and the work memory, which the kit's HDMA then reads
// line by line as the console's does. The test fills in where the data is, each name between two at signs.

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

// an HDMA channel's registers: its control, its register, and its table's address and bank
static void channel(int c, uint8_t control, uint8_t to, uint16_t table, uint8_t bank) {
  uint16_t at = (uint16_t)(0x4300 + c * 16);
  snes_write(at, control);
  snes_write((uint16_t)(at + 1), to);
  snes_write((uint16_t)(at + 2), (uint8_t)table);
  snes_write((uint16_t)(at + 3), (uint8_t)(table >> 8));
  snes_write((uint16_t)(at + 4), bank);
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
  // the window's table into the work memory at $7E2000, through its port
  store16(0x2181, 0x2000);
  snes_write(0x2183, 0x00);
  dma(0x00, 0x80, @WINDOW@, @WINDOW_BYTES@);
  snes_write(0x2105, 0x09);
  snes_write(0x2107, 0x04);
  snes_write(0x2108, 0x04);
  snes_write(0x2109, 0x0C);
  snes_write(0x210B, 0x00);
  snes_write(0x210C, 0x01);
  snes_write(0x212C, 0x07);
  snes_write(0x2124, 0x02);
  snes_write(0x212E, 0x04);
  snes_write(0x2130, 0x00);
  snes_write(0x2131, 0x21);
  // the seven channels, and the brightness's indirect bank
  channel(0, 0x02, 0x0D, @SCROLLS@, 0x00);
  channel(1, 0x40, 0x00, @BRIGHT@, 0x00);
  snes_write(0x4317, 0x00);
  channel(2, 0x01, 0x26, 0x2000, 0x7E);
  channel(3, 0x03, 0x21, @SKY@, 0x00);
  channel(4, 0x00, 0x06, @MOSAIC@, 0x00);
  channel(5, 0x00, 0x32, @FIXED@, 0x00);
  channel(6, 0x00, 0x05, @MODE@, 0x00);
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x80);
}

// the V-blank: the window table's first count from the frame's, channel 3 off in every other 32 frames, BG2 across
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  SNES_RAM[0x2000] = (uint8_t)((low & 0x3F) | 0x80);
  snes_write(0x420C, (uint8_t)(((low & 0x20) >> 2) ^ 0x7F));
  snes_write(0x210F, low);
  snes_write(0x210F, 0x00);
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
