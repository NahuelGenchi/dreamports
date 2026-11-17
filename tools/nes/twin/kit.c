// The twin's side of the function check (../twin.mjs): what stands in for the NES kit (kit/nes/c/nes.h) under a
// game's C while one of its functions is checked. Nothing is drawn or played. The work memory is the kit's own
// nes_ram, a store to the hardware is noted in order, a read is noted and given the value the original's read was
// given, and the time the game spends is added up, to compare with the original's cycles.

#include <stdlib.h>
#include <string.h>
#include "nes.h"
#include "check.h"

uint8_t nes_ram[0x800];
const uint8_t *nes_prg;
uint32_t nes_prg_size;
uint8_t *nes_chr;
uint32_t nes_chr_size;
int nes_mapper;
uint8_t nes_wram[0x2000];
const uint8_t *kit_copy;
uint32_t kit_copy_size;

twin_events kit_events;
long kit_cycles;
int kit_spent;

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

void kit_stand_in(uint8_t *copy, uint32_t size) {
  static uint8_t tiles[0x2000];
  uint32_t at = 16 + (copy[6] & 4 ? 512 : 0);
  kit_copy = copy;
  kit_copy_size = size;
  nes_prg = copy + at;
  nes_prg_size = (uint32_t)copy[4] * 0x4000;
  nes_chr_size = (uint32_t)copy[5] * 0x2000;
  nes_chr = nes_chr_size ? copy + at + nes_prg_size : tiles;
  if (!nes_chr_size) nes_chr_size = sizeof tiles;
  nes_mapper = copy[6] >> 4 | (copy[7] & 0xF0);
}

void kit_begin(void) {
  kit_events.count = 0;
  kit_cycles = 0;
}

void nes_write(uint16_t address, uint8_t value) { twin_note(&kit_events, TWIN_HW_WRITE, address, value); }
uint8_t nes_read(uint16_t address) { return twin_note(&kit_events, TWIN_HW_READ, address, 0); }
void nes_spend(int cycles) { kit_cycles += cycles; kit_spent = 1; }
// what no function can be checked across: each is noted, so the two sides differ
void nes_wait_line(int line) { twin_note(&kit_events, TWIN_HW_OTHER, (uint16_t)line, 1); }
int nes_wait_sprite0(void) { twin_note(&kit_events, TWIN_HW_OTHER, 0, 2); return 0; }
void nes_mirroring(int mirroring) { twin_note(&kit_events, TWIN_HW_OTHER, (uint16_t)mirroring, 3); }
void nes_chr_bank(int slot, uint8_t *bytes) { (void)bytes; twin_note(&kit_events, TWIN_HW_OTHER, (uint16_t)slot, 4); }
void nes_wram_write(void) { twin_note(&kit_events, TWIN_HW_OTHER, 0, 5); }
void nes_start_at(uint32_t frame) { (void)frame; }
int nes_now(void) { return (int)(kit_cycles * 3 % 89342); }
int nes_frame_length(int frame) { (void)frame; return 89342; }
uint32_t nes_frame(void) { return 0; }
uint32_t nes_buttons(void) { return 0; }
uint8_t nes_prg_byte(uint16_t address) { return nes_prg[(uint32_t)(address - 0x8000) % nes_prg_size]; }

uint8_t *kit_save(uint32_t size) { static uint8_t *save; if (!save) { save = malloc(size); memset(save, 0xFF, size); } return save; }
void kit_save_write(void) {}
const char *kit_start_point(const char *name) { (void)name; return NULL; }
int32_t kit_start_number(const char *name, int32_t absent) { (void)name; return absent; }
void *kit_alloc(size_t size) { return calloc(1, size); }
uint32_t *kit_screen(int width, int height) { static uint32_t *screen; if (!screen) screen = calloc((size_t)width * (size_t)height, 4); return screen; }
