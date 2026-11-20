// The raster program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpRasterCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, and its IRQ handler as game_irq, which the kit runs where the timers say, between the lines it draws, as the
// console runs the original's. The test fills in where the data is, each name between two at signs.

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

// where the original keeps the frame's count, its IRQ's stage and the lines the third stage has written
#define FRAME_LOW SNES_RAM[0x00]
#define FRAME_HIGH SNES_RAM[0x01]
#define STAGE SNES_RAM[0x10]
#define LINES SNES_RAM[0x11]

void game_start(void) {
  FRAME_LOW = FRAME_HIGH = STAGE = LINES = 0;
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
  snes_write(0x2108, 0x04);
  snes_write(0x2109, 0x0C);
  snes_write(0x210B, 0x00);
  snes_write(0x210C, 0x01);
  snes_write(0x212C, 0x07);
  // the H timer at dot 180, IRQs let in, and the NMI on, whose handler turns the V timer's IRQ on for each frame
  snes_write(0x4207, 0xB4);
  snes_write(0x4208, 0x00);
  snes_interrupts(1);
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x81);
}

// the V-blank: stage 0, mode 1, full brightness, no mosaic, BG1 across, and the V timer's IRQ at line 40 again
void game_step(uint32_t buttons) {
  (void)buttons;
  snes_read(0x4210);
  STAGE = 0;
  snes_write(0x2105, 0x09);
  snes_write(0x2100, 0x0F);
  snes_write(0x2106, 0x00);
  snes_write(0x210D, FRAME_LOW);
  snes_write(0x210D, 0x00);
  // $4212 as V-blank starts, its defined bits, as BG2's scroll across
  snes_write(0x210F, (uint8_t)(snes_read(0x4212) & 0xC1));
  snes_write(0x210F, 0x00);
  snes_write(0x4209, 0x28);
  snes_write(0x420A, 0x00);
  snes_write(0x4200, 0xA1);
  uint16_t frame = (uint16_t)((FRAME_LOW | FRAME_HIGH << 8) + 1);
  FRAME_LOW = (uint8_t)frame;
  FRAME_HIGH = (uint8_t)(frame >> 8);
}

// the timers' IRQ, by its stage
void game_irq(void) {
  snes_read(0x4211);
  if (STAGE == 0) {
    // line 40: mode 0, BG3 down by half the frame's count, and the H and V timers for dot 180 of line 100
    snes_write(0x2105, 0x00);
    snes_write(0x2112, (uint8_t)(FRAME_LOW >> 1));
    snes_write(0x2112, 0x00);
    snes_write(0x4209, 0x64);
    snes_write(0x420A, 0x00);
    snes_write(0x4200, 0xB1);
    STAGE++;
  } else if (STAGE == 1) {
    // line 100: half brightness, mosaic of 4 on BG1, and the H timer alone, on each line after
    snes_write(0x2100, 0x08);
    snes_write(0x2106, 0x31);
    snes_write(0x4200, 0x91);
    LINES = 0;
    STAGE++;
  } else {
    // each line from 101: the backdrop's colour from the line's count and $4212's defined bits, and after 40 lines
    // the timers off
    SNES_RAM[0x12] = (uint8_t)(snes_read(0x4212) & 0xC1);
    snes_write(0x2121, 0x00);
    snes_write(0x2122, (uint8_t)(LINES << 2));
    snes_write(0x2122, (uint8_t)((LINES >> 1) | SNES_RAM[0x12]));
    LINES++;
    if (LINES == 0x28) {
      snes_write(0x4200, 0x81);
      STAGE++;
    }
  }
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
