// What the EE's code reaches at an address (ps2.h): its main memory, the scratchpad, the vector units' memories, and
// the registers of the DMA controller (dmac.c), the VIFs (vif.c), the GIF (gif.c) and the GS's screen (gs.c). A twin of
// one of the original's functions writes a register where the original did, and the part of the console behind it does
// what the console's does then and there.
//
// An address is taken as the console's kernel maps it: 0x80000000 and 0xA0000000 on are the physical addresses below
// 0x20000000, 0x20000000 and 0x30000000 on are main memory without its cache, and 0x70000000 on is the scratchpad.
// Main memory is 32 MB and wraps, as a retail console's does.

#include "ps2-kit.h"

static uint8_t *ram;
static uint8_t scratchpad[PS2_SCRATCHPAD_SIZE];

uint8_t *ps2_memory(void) {
  if (!ram) ram = kit_alloc(PS2_RAM_SIZE);
  return ram;
}
uint8_t *ps2_scratchpad(void) { return scratchpad; }

uint8_t *ps2_dma_memory(uint32_t address) {
  return address & 0x80000000 ? scratchpad + (address & (PS2_SCRATCHPAD_SIZE - 1)) : ps2_memory() + (address & (PS2_RAM_SIZE - 1));
}

// where an address's bytes are, when they're memory, and 0 when it's a register
static uint8_t *memory_at(uint32_t address) {
  if ((address >> 28) == 7) return scratchpad + (address & (PS2_SCRATCHPAD_SIZE - 1));
  if (address >= 0x80000000) address &= 0x1FFFFFFF;
  else if (address >= 0x20000000 && address < 0x40000000) address &= 0x0FFFFFFF;
  if (address < 0x10000000) return ps2_memory() + (address & (PS2_RAM_SIZE - 1));
  if (address >= VU0_CODE && address < 0x11010000) {
    int unit = address >= VU1_CODE, data = (address & 0x4000) != 0;
    uint32_t size = data ? vu_data_size(unit) : vu_code_size(unit);
    return (data ? vu_data(unit) : vu_code(unit)) + (address & (size - 1));
  }
  return 0;
}

// the registers' physical address, or 0 for one that isn't a register
static uint32_t register_at(uint32_t address) {
  if (address >= 0x80000000) address &= 0x1FFFFFFF;
  return address >= 0x10000000 && address < 0x14000000 ? address : 0;
}

uint32_t ps2_read32(uint32_t address) {
  uint8_t *at = memory_at(address);
  if (at) {
    uint32_t value;
    __builtin_memcpy(&value, at, 4);
    return value;
  }
  address = register_at(address);
  if (address >= 0x10003000 && address < 0x10003800) return gif_read(address);
  if (address >= 0x10003800 && address < 0x10004000) return vif_read(address);
  if (address >= 0x10008000 && address < 0x1000F000) return dmac_read(address);
  if (address == D_ENABLER) return dmac_read(address);
  return 0;
}

void ps2_write32(uint32_t address, uint32_t value) {
  uint8_t *at = memory_at(address);
  if (at) {
    __builtin_memcpy(at, &value, 4);
    return;
  }
  address = register_at(address);
  if ((address >= 0x10003000 && address < 0x10003800) || (address >= GIF_FIFO && address < GIF_FIFO + 0x1000)) gif_write(address, value);
  else if (address >= 0x10003800 && address < GIF_FIFO) vif_write(address, value);
  else if (address >= 0x10008000 && address < 0x1000F000) dmac_write(address, value);
  else if (address == D_ENABLEW) dmac_write(address, value);
  else if (address >= 0x12000000 && address < 0x12002000) gs_screen(address, value);
  else return;
  dmac_resume();
}

uint64_t ps2_read64(uint32_t address) {
  uint8_t *at = memory_at(address);
  if (at) {
    uint64_t value;
    __builtin_memcpy(&value, at, 8);
    return value;
  }
  // a register is 32 bits, and its other half reads 0, except the GS's, which are 64
  if (register_at(address) >= 0x12000000) return ps2_read32(address) | (uint64_t)ps2_read32(address + 4) << 32;
  return ps2_read32(address);
}

void ps2_write64(uint32_t address, uint64_t value) {
  uint8_t *at = memory_at(address);
  if (at) {
    __builtin_memcpy(at, &value, 8);
    return;
  }
  ps2_write32(address, (uint32_t)value);
  if (register_at(address) >= 0x12000000) ps2_write32(address + 4, (uint32_t)(value >> 32));
}

void ps2_read128(uint32_t address, void *value) {
  uint8_t *at = memory_at(address & ~15u);
  if (at) {
    __builtin_memcpy(value, at, 16);
    return;
  }
  uint64_t halves[2] = { ps2_read64(address & ~15u), 0 };
  __builtin_memcpy(value, halves, 16);
}

void ps2_write128(uint32_t address, const void *value) {
  uint8_t *at = memory_at(address & ~15u);
  if (at) {
    __builtin_memcpy(at, value, 16);
    return;
  }
  uint32_t words[4];
  __builtin_memcpy(words, value, 16);
  uint32_t place = register_at(address & ~15u);
  // a quadword into a FIFO goes in a word at a time, the last of the four sending it on
  if (place >= VIF0_FIFO && place < GIF_FIFO + 0x1000) for (int i = 0; i < 4; i++) ps2_write32(place + i * 4, words[i]);
  else ps2_write64(address & ~15u, words[0] | (uint64_t)words[1] << 32);
}
