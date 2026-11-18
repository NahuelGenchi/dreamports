// The original's side of the function check (../twin.mjs): one function of the cartridge, run in FCEUmm's own
// processor. The build compiles that emulator's x6502.c as its makers wrote it, from the source the proof tools fetch
// for the reference emulator, beside two small headers that stand in for the rest of the emulator (core/). So the
// reference is the processor the proof's own emulator runs every game on.
//
// The processor sees the console's 2 KB of work memory, mirrored to $1FFF, the program with one bank at $8000 and the
// last at $C000, and a store to the program as the cartridge's register. The picture's and the sound's registers
// aren't there: a store to one is noted, and a read is noted and given a value the twin's read is given too.

#include <stdlib.h>
#include <string.h>
#include "fceu.h"
#include "x6502.h"
#include "sound.h"
#include "check.h"

// where a call comes back to: an address no cartridge has code at
#define RETURN_TO 0x4100
enum { MOST_STEPS = 2000000 };

uint8_t *RAM;
readfunc ARead[0x10000];
writefunc BWrite[0x10000];
uint8_t PAL = 0;
int overclocked = 0;
void FCEU_SoundCPUHook(int cycles) { (void)cycles; }

uint8_t orig_ram[0x800];
twin_events orig_events;
int orig_bank, orig_astray, orig_bank_reads;
uint8_t orig_stored[0x100], orig_read[0x800];
// which of the program's instructions a call ran, by where each is in the program, and how each went on, so the
// check can say which of the function's paths its calls took: for a branch, taken or not
uint32_t *orig_ran_at;
uint8_t *orig_ran_ways;
uint32_t orig_ran_count;
static const uint8_t *prg;
static uint32_t prg_size;
static int banks, switches, bank_said;

static uint8_t read_ram(uint32_t a) { orig_read[a & 0x7FF] = 1; return orig_ram[a & 0x7FF]; }
// a store to the stack's page that isn't a push: the processor's own pushes go straight to the memory
static void write_ram(uint32_t a, uint8_t v) { orig_ram[a & 0x7FF] = v; if ((a & 0x700) == 0x100) orig_stored[a & 0xFF] = 1; }
static uint8_t read_hw(uint32_t a) { return twin_note(&orig_events, TWIN_HW_READ, (uint16_t)a, 0); }
static void write_hw(uint32_t a, uint8_t v) { twin_note(&orig_events, TWIN_HW_WRITE, (uint16_t)a, v); }
static uint8_t read_none(uint32_t a) { (void)a; orig_astray++; return 0; }
static void write_none(uint32_t a, uint8_t v) { (void)a; (void)v; orig_astray++; }
static uint8_t read_low(uint32_t a) {
  if (switches && !bank_said) orig_bank_reads++;
  return prg[((uint32_t)orig_bank * 0x4000 + (a - 0x8000)) % prg_size];
}
static uint8_t read_high(uint32_t a) { return prg[prg_size - 0x4000 + (a - 0xC000)]; }
// the cartridge's own register, on one that switches its program: a store anywhere in the program puts a bank at $8000
static void write_cart(uint32_t a, uint8_t v) { (void)a; if (switches) { orig_bank = v % banks; bank_said = 1; } }

void orig_init(const uint8_t *bytes, uint32_t size, int mapper) {
  prg = bytes;
  prg_size = size;
  banks = (int)(size / 0x4000);
  switches = mapper == 2 && banks > 2;
  RAM = orig_ram;
  orig_ran_at = calloc(size, sizeof *orig_ran_at);
  orig_ran_ways = calloc(size, 1);
  for (uint32_t a = 0; a < 0x10000; a++) {
    ARead[a] = a < 0x2000 ? read_ram : a < 0x4020 ? read_hw : a < 0x8000 ? read_none : a < 0xC000 ? read_low : read_high;
    BWrite[a] = a < 0x2000 ? write_ram : a < 0x4020 ? write_hw : a < 0x8000 ? write_none : write_cart;
  }
  X6502_Init();
  X6502_Power();
}

// The processor reads the first page of memory without asking, so what an instruction reads there is worked out from
// the instruction itself, before it runs.
static uint8_t program_at(uint16_t a) {
  if (a < 0x2000) return orig_ram[a & 0x7FF];
  if (a < 0x8000) return 0;
  return a < 0xC000 ? prg[((uint32_t)orig_bank * 0x4000 + (a - 0x8000)) % prg_size] : prg[prg_size - 0x4000 + (a - 0xC000)];
}
static void note_first_page(void) {
  uint8_t op = program_at(X.PC), at = program_at((uint16_t)(X.PC + 1));
  switch (twin_modes[op]) {
    case TWIN_M_ZP: orig_read[at] = 1; break;
    case TWIN_M_ZPX: orig_read[(uint8_t)(at + X.X)] = 1; break;
    case TWIN_M_ZPY: orig_read[(uint8_t)(at + X.Y)] = 1; break;
    case TWIN_M_IZX: orig_read[(uint8_t)(at + X.X)] = orig_read[(uint8_t)(at + X.X + 1)] = 1; break;
    case TWIN_M_IZY: orig_read[at] = orig_read[(uint8_t)(at + 1)] = 1; break;
    default: break;
  }
}

int orig_call(uint16_t pc, int bank, twin_regs *r, long *cycles) {
  enum { S = 0xE0 };
  orig_bank = bank < 0 ? 0 : bank;
  bank_said = bank >= 0;
  orig_events.count = 0;
  orig_astray = orig_bank_reads = 0;
  for (uint32_t i = 0; i < orig_ran_count; i++) orig_ran_ways[orig_ran_at[i]] = 0;
  orig_ran_count = 0;
  memset(orig_stored, 0, sizeof orig_stored);
  memset(orig_read, 0, sizeof orig_read);
  X.IRQlow = 0;
  X.jammed = 0;
  X.tcount = 0;
  X.A = r->A; X.X = r->X; X.Y = r->Y;
  X.P = (uint8_t)(U_FLAG | I_FLAG | (r->N ? N_FLAG : 0) | (r->V ? V_FLAG : 0) | (r->Z ? Z_FLAG : 0) | (r->C ? C_FLAG : 0));
  X.mooPI = X.P;
  // as a JSR leaves the stack: the address before the one to come back to, high byte first
  orig_ram[0x100 + S] = (RETURN_TO - 1) >> 8;
  orig_ram[0x100 + S - 1] = (RETURN_TO - 1) & 0xFF;
  X.S = S - 2;
  X.PC = pc;
  uint32_t began = timestamp;
  long steps = 0;
  for (; X.PC != RETURN_TO && steps < MOST_STEPS && !X.jammed; steps++) {
    note_first_page();
    uint16_t pc = X.PC;
    uint32_t place = pc < 0x8000 ? prg_size : pc < 0xC000 ? ((uint32_t)orig_bank * 0x4000 + (pc - 0x8000)) % prg_size : prg_size - 0x4000 + (pc - 0xC000);
    X.count = 0;      // one instruction a time
    X6502_Run(1);
    if (orig_ran_ways && place < prg_size) {
      if (!orig_ran_ways[place]) orig_ran_at[orig_ran_count++] = place;
      // a branch is two bytes long, so it wasn't taken when the next instruction is the one after it
      orig_ran_ways[place] |= X.PC == (uint16_t)(pc + 2) ? TWIN_WENT_ON : TWIN_WENT_ELSEWHERE;
    }
  }
  *cycles = (long)(timestamp - began);
  r->A = X.A; r->X = X.X; r->Y = X.Y;
  r->N = !!(X.P & N_FLAG); r->V = !!(X.P & V_FLAG); r->Z = !!(X.P & Z_FLAG); r->C = !!(X.P & C_FLAG);
  return X.jammed ? 2 : X.PC != RETURN_TO ? 1 : X.S != S ? 3 : 0;
}
