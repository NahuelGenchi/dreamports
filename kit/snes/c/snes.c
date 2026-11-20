// The Super Nintendo's registers, as kit/snes/c/snes.h says. Built for the function check (tools/snes/twin.mjs), with
// DP_TWIN_CHECK, it also notes each read and write in order, as the original's side notes those of the original
// (tools/snes/call.cpp), for the check to compare.

#include "snes.h"

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
  if (address == 0x2180) {
    uint32_t to = port();
    SNES_RAM[to] = value;
    port_next(to);
    return;
  }
  *at = value;
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
  } else {
    value = *at;
    if (address == 0x4210 || address == 0x4211) *at = value & 0x7F;
  }
  note(address, value, 0);
  return value;
}
