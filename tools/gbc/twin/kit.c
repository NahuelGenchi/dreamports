// The twin's side of the function check (../twin.mjs): what stands in for the Game Boy kit (kit/gbc/c/gb.h) under a
// game's C while one of its functions is checked. Nothing is drawn or played. The work memory and the high memory are
// the kit's own gb_wram and gb_hram, a read of the program is the copy's, with the bank the twin's own writes to the
// cartridge's chip left, a store to the hardware is noted in order, a read is noted and given the value the
// original's read was given, and the time the game spends is added up, to compare with the original's cycles.

#include <stdlib.h>
#include <string.h>
#include "gb.h"
#include "check.h"

uint8_t gb_wram[0x8000];
uint8_t gb_hram[0x7F];
uint8_t gb_vram[0x4000];
uint8_t gb_oam[0xA0];
const uint8_t *gb_rom;
uint32_t gb_rom_size;
uint8_t *gb_sram;
uint32_t gb_sram_size;
int gb_colour;
const uint8_t *kit_copy;
uint32_t kit_copy_size;

twin_events kit_events;
long kit_cycles;
int kit_spent, kit_bank;
static int chip, banks, bank_said;

int twin_place(uint16_t address) {
  if (address >= 0xC000 && address < 0xE000) return address - 0xC000;
  if (address >= 0xE000 && address < 0xFE00) return address - 0xE000;
  if (address >= 0xFF80 && address < 0xFFFF) return TWIN_WRAM + address - 0xFF80;
  return -1;
}
uint16_t twin_address(int place) { return (uint16_t)(place < TWIN_WRAM ? 0xC000 + place : 0xFF80 + place - TWIN_WRAM); }

static uint32_t reads_seed, reads_count;
void twin_reads_from(uint32_t seed) { reads_seed = seed; reads_count = 0; }
uint8_t twin_note(twin_events *into, uint8_t kind, uint16_t address, uint8_t value) {
  if (kind == TWIN_HW_READ) {
    uint32_t t = reads_seed + ++reads_count * 0x9E3779B9u;
    t = (t ^ t >> 15) * 0x2C1B3C6Du;
    value = (uint8_t)(t >> 24);
  }
  if (into->count < TWIN_HW_MOST) into->list[into->count] = (twin_event){ kind, value, address };
  into->count++;
  return value;
}

// the cartridge's chip: an MBC1 and an MBC3 give bank 1 for 0, and an MBC5 takes the number's ninth bit at $3000
int twin_switched(int kind, int count, uint16_t address, uint8_t value, int now) {
  if (kind == TWIN_CHIP_NONE || address < 0x2000 || address >= 0x4000 || count < 2) return -1;
  if (kind == TWIN_CHIP_MBC5) {
    int low = address < 0x3000 ? value : (now < 0 ? 0 : now & 0xFF), high = address < 0x3000 ? (now < 0 ? 0 : now & 0x100) : (value & 1) << 8;
    return (high | low) % count;
  }
  int bank = value & (kind == TWIN_CHIP_MBC1 ? 0x1F : 0x7F);
  return (bank ? bank : 1) % count;
}

void kit_stand_in(uint8_t *copy, uint32_t size, int kind) {
  kit_copy = gb_rom = copy;
  kit_copy_size = gb_rom_size = size;
  gb_colour = size > 0x143 && (copy[0x143] & 0x80) != 0;
  chip = kind;
  banks = (int)(size / 0x4000);
}

void kit_begin(int bank) {
  kit_events.count = 0;
  kit_cycles = 0;
  kit_bank = bank;
  bank_said = bank >= 0;
}

void kit_memory_in(const uint8_t *from) {
  memcpy(gb_wram, from, TWIN_WRAM);
  memcpy(gb_hram, from + TWIN_WRAM, TWIN_HRAM);
}
void kit_memory_out(uint8_t *into) {
  memcpy(into, gb_wram, TWIN_WRAM);
  memcpy(into + TWIN_WRAM, gb_hram, TWIN_HRAM);
}

void gb_write(uint16_t address, uint8_t value) {
  int place = twin_place(address);
  if (place >= 0) {
    if (place < TWIN_WRAM) gb_wram[place] = value;
    else gb_hram[place - TWIN_WRAM] = value;
    return;
  }
  twin_note(&kit_events, TWIN_HW_WRITE, address, value);
  if (address < 0x8000) {
    int to = twin_switched(chip, banks, address, value, kit_bank);
    if (to >= 0) {
      kit_bank = to;
      bank_said = 1;
    }
  }
}

uint8_t gb_read(uint16_t address) {
  if (address < 0x4000) return gb_rom[address % gb_rom_size];
  if (address < 0x8000) {
    // a bank nothing says is there: noted, so the two sides differ
    if (!bank_said) twin_note(&kit_events, TWIN_HW_OTHER, address, 6);
    return gb_rom[((uint32_t)(kit_bank < 0 ? 1 : kit_bank) * 0x4000 + (address - 0x4000)) % gb_rom_size];
  }
  int place = twin_place(address);
  if (place >= 0) return place < TWIN_WRAM ? gb_wram[place] : gb_hram[place - TWIN_WRAM];
  return twin_note(&kit_events, TWIN_HW_READ, address, 0);
}

void gb_spend(int cycles) { kit_cycles += cycles; kit_spent = 1; }

// A function the twin's C calls that is still a stop, which the original's runs for: its time counts only if the twin
// counts its own, and a call that doesn't come back as a function does is noted, so the two sides differ.
void kit_original(uint32_t offset, int allowance, twin_regs *r) {
  uint16_t pc = (uint16_t)(offset < 0x4000 ? offset : 0x4000 + offset % 0x4000);
  long cycles = 0;
  int how = orig_call_through(pc, r, &cycles, gb_read, gb_write);
  if (how) twin_note(&kit_events, TWIN_HW_OTHER, pc, (uint8_t)(16 + how));
  kit_cycles += cycles + allowance;
}
// what no function can be checked across: each is noted, so the two sides differ
int gb_halt(void) { twin_note(&kit_events, TWIN_HW_OTHER, 0, 1); return 0; }
int gb_interrupt(void) { twin_note(&kit_events, TWIN_HW_OTHER, 0, 2); return 0; }
void gb_play_ahead(int frames) { twin_note(&kit_events, TWIN_HW_OTHER, (uint16_t)frames, 3); }
void gb_sram_write(void) { twin_note(&kit_events, TWIN_HW_OTHER, 0, 4); }
int gb_frame_ended(void) { return 0; }
int gb_frame(void) { return 0; }
uint64_t gb_now(void) { return (uint64_t)kit_cycles; }
uint32_t gb_buttons(void) { return 0; }

uint8_t *kit_save(uint32_t size) { static uint8_t *save; if (!save) { save = malloc(size); memset(save, 0xFF, size); } return save; }
void kit_save_write(void) {}
const char *kit_start_point(const char *name) { (void)name; return NULL; }
int32_t kit_start_number(const char *name, int32_t absent) { (void)name; return absent; }
void *kit_alloc(size_t size) { return calloc(1, size); }
uint32_t *kit_screen(int width, int height) { static uint32_t *screen; if (!screen) screen = calloc((size_t)width * (size_t)height, 4); return screen; }
