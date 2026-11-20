// The high-resolution program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpHiresCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same writes to the same registers, in the same
// order, each frame's setting read from the player's copy, and its IRQ handler as game_irq, which the kit runs at line
// 100 between the lines it draws. The kit draws its picture 512 across in modes 5 and 6 and in pseudo high resolution,
// and 448 down when interlaced, as Snes9x does. The test fills in where the data is, each name between two at signs.

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

// where the original keeps what its IRQ at line 100 writes: the mode, none when 0, and $2133
#define IRQ_MODE SNES_RAM[0x12]
#define IRQ_SETINI SNES_RAM[0x13]

void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = 0;
  IRQ_MODE = IRQ_SETINI = 0;
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
  // BG1's map at $0400 and its tiles at $0000, BG2's and BG3's map at $0C00 and their tiles at $1000, small sprites,
  // window 1 from 48 to 176, and the fixed colour
  snes_write(0x2107, 0x04);
  snes_write(0x2108, 0x0C);
  snes_write(0x2109, 0x0C);
  snes_write(0x210B, 0x10);
  snes_write(0x210C, 0x01);
  snes_write(0x2101, 0x00);
  snes_write(0x2126, 0x30);
  snes_write(0x2127, 0xB0);
  snes_write(0x2132, 0x2A);
  snes_write(0x2132, 0x4C);
  snes_write(0x2132, 0x91);
  // IRQs let in, and the NMI on
  snes_interrupts(1);
  snes_write(0x4200, 0x81);
}

// the V-blank: the setting for the frame's count over 16, 13 bytes each, its 11 registers, what its IRQ writes, the V
// timer's IRQ at line 100 when it has a mode to write, BG1 across and BG2 down, and the count on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  uint16_t setting = (uint16_t)(frame >> 4 & 0x0F), four = (uint16_t)(setting << 2), x = (uint16_t)(four * 3 + setting);
  SNES_RAM[6] = (uint8_t)setting;
  SNES_RAM[7] = (uint8_t)(setting >> 8);
  SNES_RAM[4] = (uint8_t)four;
  SNES_RAM[5] = (uint8_t)(four >> 8);
  snes_write(0x2105, snes_bus(@SETTINGS@ + x));
  snes_write(0x2133, snes_bus(@SETTINGS@ + 1 + x));
  snes_write(0x2106, snes_bus(@SETTINGS@ + 2 + x));
  snes_write(0x212C, snes_bus(@SETTINGS@ + 3 + x));
  snes_write(0x212D, snes_bus(@SETTINGS@ + 4 + x));
  snes_write(0x2130, snes_bus(@SETTINGS@ + 5 + x));
  snes_write(0x2131, snes_bus(@SETTINGS@ + 6 + x));
  snes_write(0x2123, snes_bus(@SETTINGS@ + 7 + x));
  snes_write(0x2125, snes_bus(@SETTINGS@ + 8 + x));
  snes_write(0x212E, snes_bus(@SETTINGS@ + 9 + x));
  snes_write(0x2100, snes_bus(@SETTINGS@ + 10 + x));
  IRQ_SETINI = snes_bus(@SETTINGS@ + 12 + x);
  IRQ_MODE = snes_bus(@SETTINGS@ + 11 + x);
  if (IRQ_MODE) {
    snes_write(0x4209, 100);
    snes_write(0x420A, 0x00);
    snes_write(0x4200, 0xA1);
  } else {
    snes_write(0x4200, 0x81);
  }
  snes_write(0x210D, low);
  snes_write(0x210D, 0x00);
  snes_write(0x2110, (uint8_t)(low >> 1));
  snes_write(0x2110, 0x00);
  frame++;
  SNES_RAM[0] = (uint8_t)frame;
  SNES_RAM[1] = (uint8_t)(frame >> 8);
}

// the IRQ at line 100: the setting's mode and $2133
void game_irq(void) {
  snes_read(0x4211);
  snes_write(0x2105, IRQ_MODE);
  snes_write(0x2133, IRQ_SETINI);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
