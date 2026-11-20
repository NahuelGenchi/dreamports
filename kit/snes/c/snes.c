// The Super Nintendo's registers and the cartridge, as kit/snes/c/snes.h says. Built for the function check
// (tools/snes/twin.mjs), with DP_TWIN_CHECK, it also notes each read and write in order, as the original's side notes
// those of the original (tools/snes/call.cpp), for the check to compare, and keeps the picture's registers and DMA's as
// memory, as that side does: what they draw and move is proven by `prove` instead.

#include "snes-kit.h"

#ifdef DP_TWIN_CHECK
// how many it notes at most, and the list: a count, then each register, value and 0 for a read or 1 for a write
enum { MOST_NOTED = 4096 };
static uint32_t noted[1 + MOST_NOTED * 3];
/** The list of what was read and written, for the check, which empties it before each call. */
uint32_t *snes_check_list(void) { return noted; }
static void note(uint16_t address, uint8_t value, int write) {
  if (noted[0] >= MOST_NOTED) return;
  uint32_t *at = noted + 1 + noted[0]++ * 3;
  at[0] = address;
  at[1] = value;
  at[2] = (uint32_t)write;
}
#else
#define note(address, value, write) ((void)0)
#endif

// a register's place, with the sound processor's ports folded to their first four, or null for a place with none
static uint8_t *place(uint16_t *address) {
  if (*address >= 0x2140 && *address < 0x2180) *address = 0x2140 | (*address & 3);
  if (*address >= 0x2100 && *address < 0x2200) return SNES_B_REGISTERS + (*address - 0x2100);
  if (*address >= 0x4000 && *address < 0x4400) return SNES_CPU_REGISTERS + (*address - 0x4000);
  return 0;
}

// the work memory's port: the address in $2181 to $2183, 17 bits of it, and on to the next byte after each
static uint32_t port(void) {
  return (SNES_B_REGISTERS[0x81] | SNES_B_REGISTERS[0x82] << 8 | (SNES_B_REGISTERS[0x83] & 1) << 16) & (SNES_RAM_SIZE - 1);
}
static void port_next(uint32_t at) {
  at = (at + 1) & (SNES_RAM_SIZE - 1);
  SNES_B_REGISTERS[0x81] = (uint8_t)at;
  SNES_B_REGISTERS[0x82] = (uint8_t)(at >> 8);
  SNES_B_REGISTERS[0x83] = (uint8_t)((SNES_B_REGISTERS[0x83] & 0xFE) | (at >> 16));
}

void snes_write(uint16_t address, uint8_t value) {
  uint8_t *at = place(&address);
  if (!at) return;
  note(address, value, 1);
#ifndef DP_TWIN_CHECK
  if (address >= 0x2140 && address < 0x2144) {
    apu_port_write(address & 3, value);
    return;
  }
#endif
  if (address == 0x2180) {
    uint32_t to = port();
    SNES_RAM[to] = value;
    port_next(to);
    return;
  }
  *at = value;
#ifndef DP_TWIN_CHECK
  if (address < 0x2134) ppu_write(address, value);
  if (address == 0x420B && value) dma_start(value);
#endif
  uint8_t *cpu = SNES_CPU_REGISTERS;
  if (address == 0x4203) {
    uint32_t product = (uint32_t)cpu[0x202] * value;
    cpu[0x216] = (uint8_t)product;
    cpu[0x217] = (uint8_t)(product >> 8);
  } else if (address == 0x4206) {
    uint32_t dividend = cpu[0x204] | cpu[0x205] << 8;
    uint32_t quotient = value ? dividend / value : 0xFFFF, rest = value ? dividend % value : dividend;
    cpu[0x214] = (uint8_t)quotient;
    cpu[0x215] = (uint8_t)(quotient >> 8);
    cpu[0x216] = (uint8_t)rest;
    cpu[0x217] = (uint8_t)(rest >> 8);
  }
}

uint8_t snes_read(uint16_t address) {
  uint8_t *at = place(&address);
  if (!at) return 0;
  uint8_t value;
  if (address == 0x2180) {
    uint32_t from = port();
    value = SNES_RAM[from];
    port_next(from);
#ifndef DP_TWIN_CHECK
  } else if (address >= 0x2140 && address < 0x2144) {
    value = apu_port_read(address & 3);
#endif
  } else {
    value = *at;
    if (address == 0x4210 || address == 0x4211) *at = value & 0x7F;
  }
  note(address, value, 0);
  return value;
}

// The cartridge: its ROM from the player's copy, without a copier's header, made up to 8 KB with zeros as the reference
// emulator makes it, and seen through LoROM's or HiROM's map; and its save memory.
const uint8_t *snes_rom;
uint32_t snes_rom_size;
int snes_hirom;
static uint32_t rom_room;
static uint8_t sram[0x20000];
static uint32_t sram_size, lorom_save_high;

// how well the header at `at` looks like a cartridge's of the layout `hirom` says, as tools/snes/cartridge.mjs reads it
static int score(uint32_t at, int hirom) {
  if (at + 0x40 > snes_rom_size) return -1;
  const uint8_t *h = snes_rom + at;
  int points = 0;
  if (((h[0x1C] | h[0x1D] << 8) + (h[0x1E] | h[0x1F] << 8)) == 0xFFFF) points += 4;
  if ((h[0x15] & 0xEF) == (hirom ? 0x21 : 0x20)) points += 3;
  if ((h[0x3C] | h[0x3D] << 8) >= 0x8000) points += 2;
  if (h[0x17] >= 7 && h[0x17] <= 13) points += 1;
  if (h[0x18] <= 7) points += 1;
  int title = 1;
  for (int i = 0; i < 21; i++) if (h[i] < 0x20 || h[i] >= 0x7F) title = 0;
  return points + title;
}

void cartridge_load(void) {
  snes_rom = kit_copy;
  snes_rom_size = kit_copy_size;
  if (snes_rom_size % 1024 == 512) {
    snes_rom += 512;
    snes_rom_size -= 512;
  }
  rom_room = (snes_rom_size + 0x1FFF) & ~0x1FFFu;
  snes_hirom = score(0xFFC0, 1) > score(0x7FC0, 0);
  uint8_t said = snes_rom_size > (snes_hirom ? 0xFFD8u : 0x7FD8u) ? snes_rom[snes_hirom ? 0xFFD8 : 0x7FD8] : 0;
  sram_size = said > 0 && said <= 7 ? 1024u << said : 0;
  // a LoROM's save memory takes the whole bank but for a large ROM or save memory, as the reference emulator maps it
  uint8_t rom_said = snes_rom_size > 0x7FD7u ? snes_rom[0x7FD7] : 0;
  lorom_save_high = rom_said > 11 || said > 5 ? 0x8000 : 0x10000;
}

// where a place of the ROM, as the map shows it, is in the ROM, seen again past its end (Snes9x's map_mirror)
static uint32_t mirror(uint32_t size, uint32_t pos) {
  if (!size) return 0;
  if (pos < size) return pos;
  uint32_t mask = 1u << 31;
  while (!(pos & mask)) mask >>= 1;
  return size <= (pos & mask) ? mirror(size, pos - mask) : mask + mirror(size - mask, pos - mask);
}

static uint8_t rom_byte(uint32_t bank_start, uint32_t offset) {
  uint32_t at = mirror(rom_room, bank_start) + offset;
  return at < snes_rom_size ? snes_rom[at] : 0;
}

// the save memory's place for an address, or -1
static int64_t save_place(uint32_t bank, uint32_t low) {
  if (!sram_size) return -1;
  if (snes_hirom) {
    if ((bank & 0x60) == 0x20 && (bank & 0x40) == 0 && low >= 0x6000 && low < 0x8000) return (int64_t)((low - 0x6000 + ((bank & 0x1F) << 13)) & (sram_size - 1));
    return -1;
  }
  if (((bank >= 0x70 && bank < 0x7E) || bank >= 0xF0) && low < lorom_save_high) return (int64_t)(((bank << 15) | (low & 0x7FFF)) & (sram_size - 1));
  return -1;
}

uint8_t snes_bus(uint32_t address) {
  uint32_t bank = address >> 16 & 0xFF, low = address & 0xFFFF;
  if (bank == 0x7E || bank == 0x7F) return SNES_RAM[(bank & 1) << 16 | low];
  if (!(bank & 0x40) && low < 0x2000) return SNES_RAM[low];
  int64_t save = save_place(bank, low);
  if (save >= 0) return sram[save];
  if (snes_hirom) return (bank & 0x40) || low >= 0x8000 ? rom_byte((bank & 0x3F) << 16, low) : 0;
  return (bank & 0x40) || low >= 0x8000 ? rom_byte((bank & 0x7F) * 0x8000, low & 0x7FFF) : 0;
}

void snes_bus_write(uint32_t address, uint8_t value) {
  uint32_t bank = address >> 16 & 0xFF, low = address & 0xFFFF;
  if (bank == 0x7E || bank == 0x7F) SNES_RAM[(bank & 1) << 16 | low] = value;
  else if (!(bank & 0x40) && low < 0x2000) SNES_RAM[low] = value;
  else {
    int64_t save = save_place(bank, low);
    if (save >= 0) sram[save] = value;
  }
}
