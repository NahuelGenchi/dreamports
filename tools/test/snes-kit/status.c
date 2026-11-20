// The status program of the Super Nintendo kit's test (../made-up-snes.mjs, madeUpStatusCartridge) in C, on the
// console's kit (kit/snes/c/), as a Dreamport of it is written: the same reads and writes of the same registers, in the
// same order, each frame's setting read from the player's copy, and its IRQ handler as game_irq, which the kit runs at
// line 100 between the lines it draws. What it reads back, the kit gives as Snes9x does. The test fills in where the
// data is, each name between two at signs.

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

// the status byte `value` kept, or 0 before frame 2, as before then it holds what the original's start-up frame's
// sprites left, which the kit doesn't draw
static uint8_t from_frame_2(uint8_t value) {
  SNES_RAM[0x29] = value;
  if (!SNES_RAM[1] && SNES_RAM[0] < 2) SNES_RAM[0x29] = 0;
  return SNES_RAM[0x29];
}

void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = SNES_RAM[0x13] = 0;
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
  // BG1's and BG2's map at $0400, BG3's at $0C00 and 64 tiles across, BG1's tiles at $0000 and the others' at $1000,
  // window 1 from 48 to 176, the V timer at line 100, and the screen on
  snes_write(0x2107, 0x04);
  snes_write(0x2108, 0x04);
  snes_write(0x2109, 0x0D);
  snes_write(0x210B, 0x10);
  snes_write(0x210C, 0x01);
  snes_write(0x2126, 0x30);
  snes_write(0x2127, 0xB0);
  snes_write(0x4209, 100);
  snes_write(0x420A, 0x00);
  snes_write(0x2100, 0x0F);
  // IRQs let in, and the NMI on, whose handler turns the V timer's IRQ on for each frame
  snes_interrupts(1);
  snes_write(0x4200, 0x81);
}

// the V-blank: the frame's setting, or when it turns overscan on only that, as the kit then draws on to line 239 and
// steps again, as Snes9x does; what the counters, the status bytes, the sprites' table, video memory and the colours
// read back, as scrolls and colours; BG3 across by the count; the V timer's IRQ on; the count on by one
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t frame = (uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8);
  uint8_t low = (uint8_t)frame;
  snes_read(0x4210);
  uint16_t x = (uint16_t)((frame >> 1) & 0x78);
  uint8_t setini = snes_bus(@SETTINGS@ + 2 + x);
  if ((setini & 0x04) && !(SNES_RAM[0x13] & 0x04)) {
    snes_write(0x2133, setini);
    SNES_RAM[0x13] = setini;
    return;
  }
  snes_write(0x2105, snes_bus(@SETTINGS@ + x));
  snes_write(0x2106, snes_bus(@SETTINGS@ + 1 + x));
  snes_write(0x2133, snes_bus(@SETTINGS@ + 2 + x));
  snes_write(0x212C, snes_bus(@SETTINGS@ + 3 + x));
  snes_write(0x2123, snes_bus(@SETTINGS@ + 4 + x));
  snes_write(0x212E, snes_bus(@SETTINGS@ + 5 + x));
  snes_write(0x2101, snes_bus(@SETTINGS@ + 6 + x));
  snes_write(0x2115, snes_bus(@SETTINGS@ + 7 + x));
  SNES_RAM[0x13] = setini;
  // the counters latched, and the line as BG2's scroll across
  snes_read(0x2137);
  snes_write(0x210F, snes_read(0x213D));
  snes_write(0x210F, snes_read(0x213D));
  // the second status byte as BG2's scroll down, the first as BG3's, from frame 2
  snes_write(0x2110, snes_read(0x213F));
  snes_write(0x2110, 0x00);
  snes_write(0x2112, from_frame_2(snes_read(0x213E)));
  snes_write(0x2112, 0x00);
  // BG3 across by the frame's count, its top bits from the count over 64
  snes_write(0x2111, low);
  snes_write(0x2111, (uint8_t)(frame >> 6 & 0x03));
  // the first word of sprite (count & 63) as BG1's scroll across, the second kept; and a word of the high table
  snes_write(0x2102, (uint8_t)(low & 0x3F));
  snes_write(0x2103, 0x00);
  snes_write(0x210D, snes_read(0x2138));
  snes_write(0x210D, snes_read(0x2138));
  SNES_RAM[0x20] = snes_read(0x2138);
  SNES_RAM[0x21] = snes_read(0x2138);
  snes_write(0x2102, (uint8_t)(low & 0x0F));
  snes_write(0x2103, 0x01);
  SNES_RAM[0x22] = snes_read(0x2138);
  SNES_RAM[0x23] = snes_read(0x2138);
  // video memory at four times the count: a word as BG1's scroll down, the next kept
  store16(0x2116, (uint16_t)(frame << 2));
  snes_write(0x210E, snes_read(0x2139));
  snes_write(0x210E, snes_read(0x213A));
  SNES_RAM[0x24] = snes_read(0x2139);
  SNES_RAM[0x25] = snes_read(0x213A);
  // colour (count & 255), and a byte of the next, kept
  snes_write(0x2121, low);
  SNES_RAM[0x26] = snes_read(0x213B);
  SNES_RAM[0x27] = snes_read(0x213B);
  SNES_RAM[0x28] = snes_read(0x213B);
  // what it read, and what the IRQ read, as colours 0 to 5
  snes_write(0x2121, 0x00);
  static const uint8_t kept[] = { 0x26, 0x27, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x2A, 0x2B, 0x2C };
  for (unsigned i = 0; i < sizeof kept; i++) snes_write(0x2122, SNES_RAM[kept[i]]);
  // the V timer's IRQ on, and the count on by one
  snes_write(0x4200, 0xA1);
  frame++;
  SNES_RAM[0] = (uint8_t)frame;
  SNES_RAM[1] = (uint8_t)(frame >> 8);
}

// the IRQ at line 100: the counters latched again, the line and the first status byte kept for the V-blank to show,
// and a tile written to BG1's map, which the kit drops as Snes9x does
void game_irq(void) {
  snes_read(0x4211);
  snes_read(0x2137);
  SNES_RAM[0x2A] = snes_read(0x213D);
  SNES_RAM[0x2B] = snes_read(0x213D);
  SNES_RAM[0x2C] = from_frame_2(snes_read(0x213E));
  snes_write(0x2116, 0xC2);
  snes_write(0x2117, 0x05);
  snes_write(0x2118, 0x07);
  snes_write(0x2119, 0x1C);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
