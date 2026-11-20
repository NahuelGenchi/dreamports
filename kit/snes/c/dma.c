// The Super Nintendo's DMA, as a write to $420B starts it: each channel's bytes moved, one channel after another, from
// the lowest, between a 24-bit address of the console's own memories and a register of the picture's and the sound's,
// $2100 to $21FF, as the channel's registers, $43x0 to $43x6, say. A channel's address and count are left as the move
// leaves them, as the console leaves them.

#include "snes-kit.h"

// which of the channel's registers each byte goes to, in turn, by the transfer's mode, $43x0's low three bits
static const uint8_t PATTERNS[8][4] = {
  { 0, 0, 0, 0 }, { 0, 1, 0, 1 }, { 0, 0, 0, 0 }, { 0, 0, 1, 1 },
  { 0, 1, 2, 3 }, { 0, 1, 0, 1 }, { 0, 0, 0, 0 }, { 0, 0, 1, 1 },
};

void dma_start(uint8_t channels) {
  uint8_t *cpu = SNES_CPU_REGISTERS;
  for (int c = 0; c < 8; c++) {
    if (!(channels >> c & 1)) continue;
    uint8_t *r = cpu + 0x300 + c * 0x10;
    uint8_t control = r[0], target = r[1];
    uint16_t address = (uint16_t)(r[2] | r[3] << 8);
    uint32_t bank = (uint32_t)r[4] << 16;
    uint32_t count = (uint32_t)(r[5] | r[6] << 8);
    if (!count) count = 0x10000;
    // the A bus's address moves on by one, back by one, or stays, as bits 3 and 4 say
    int step = control & 0x08 ? 0 : control & 0x10 ? -1 : 1;
    for (uint32_t i = 0; i < count; i++) {
      uint16_t to = (uint16_t)(0x2100 | (uint8_t)(target + PATTERNS[control & 7][i & 3]));
      if (control & 0x80) snes_bus_write(bank | address, snes_read(to));
      else snes_write(to, snes_bus(bank | address));
      address = (uint16_t)(address + step);
    }
    r[2] = (uint8_t)address;
    r[3] = (uint8_t)(address >> 8);
    r[5] = r[6] = 0;
  }
}
