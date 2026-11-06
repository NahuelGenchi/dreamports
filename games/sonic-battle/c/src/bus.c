// bus.js in C: the console's memory as the original's code sees it, for the fight, whose functions share their state
// through the work RAM at fixed addresses and copy between the cartridge, the work RAM and the video hardware with the
// same calls.

#include "game.h"

Game g;

static inline uint32_t vramAt(uint32_t address) {
  uint32_t at = (address - VRAM) & 0x1FFFF;
  return at >= 0x18000 ? at - 0x8000 : at;
}

uint8_t read8(uint32_t address) {
  switch (address >> 24) {
    case 2: return g.ewram[address & 0x3FFFF];
    case 3: return g.iwram[address & 0x7FFF];
    case 4: return (uint8_t)(gba_io[(address - IO) >> 1] >> ((address & 1) * 8));
    case 5: return (uint8_t)(gba_pal[(address & 0x3FF) >> 1] >> ((address & 1) * 8));
    case 6: return gba_vram[vramAt(address)];
    case 7: return (uint8_t)(gba_oam[(address & 0x3FF) >> 1] >> ((address & 1) * 8));
    default: return gba_rom[address - CARTRIDGE];
  }
}

uint16_t read16(uint32_t address) { return (uint16_t)(read8(address) | (read8(address + 1) << 8)); }
uint32_t read32(uint32_t address) { return (uint32_t)read16(address) | ((uint32_t)read16(address + 2) << 16); }
int8_t reads8(uint32_t address) { return (int8_t)read8(address); }
int16_t reads16(uint32_t address) { return (int16_t)read16(address); }
int32_t reads32(uint32_t address) { return (int32_t)read32(address); }

void write8(uint32_t address, uint8_t value) {
  switch (address >> 24) {
    case 2: g.ewram[address & 0x3FFFF] = value; return;
    case 3: g.iwram[address & 0x7FFF] = value; return;
    default: return;
  }
}

void write16(uint32_t address, uint16_t value) {
  switch (address >> 24) {
    case 2:
    case 3: write8(address, value & 0xFF); write8(address + 1, value >> 8); return;
    case 4: gba_write((unsigned)(address - IO), value); return;
    case 5: gba_pal[(address & 0x3FF) >> 1] = value; return;
    case 6: {
      uint32_t at = vramAt(address);
      gba_vram[at] = value & 0xFF;
      gba_vram[at + 1] = value >> 8;
      return;
    }
    case 7: gba_oam[(address & 0x3FF) >> 1] = value; return;
    default: return;
  }
}

void write32(uint32_t address, uint32_t value) {
  write16(address, value & 0xFFFF);
  write16(address + 2, value >> 16);
}

void copy16(uint32_t from, uint32_t to, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) write16(to + i * 2, read16(from + i * 2));
}

void copy32(uint32_t from, uint32_t to, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) write32(to + i * 4, read32(from + i * 4));
}

void fill16(uint32_t to, uint16_t value, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) write16(to + i * 2, value);
}

void fill32(uint32_t to, uint32_t value, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) write32(to + i * 4, value);
}

int32_t divArm(int32_t denominator, int32_t numerator) {
  return denominator == 0 ? 0 : numerator / denominator;
}
