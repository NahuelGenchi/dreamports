// The original's side of the function check (../twin.mjs): one function of the cartridge, run in Gambatte's own
// processor. The build compiles that emulator's cpu.cpp as its makers wrote it, from the source the proof tools fetch
// for the reference emulator, beside one small header that stands in for the rest of the emulator
// (core/gambatte-memory.h). So the reference is the processor the proof's own emulator runs every game on.
//
// The processor sees the program, with its first bank at $0000 and one of the others at $4000, the 8 KB of work
// memory at $C000, with its echo above it, and the high memory at $FF80. A write to the cartridge's chip is noted, and
// switches the bank when it's that register. The rest of the hardware isn't there: a store to it is noted, and a read
// is noted and given a value the twin's read is given too.
//
// It also runs a function of the original for a twin, when the twin's C calls one that is still a stop: then every byte
// the processor reads and writes goes through the kit, as the twin's own C reaches the memory (orig_call_through).

#include <cstdlib>
#include <cstring>
#include "cpu.h"
#include "savestate.h"
#include "check.h"

enum { MOST_STEPS = 2000000 };

bool dp_colour = false;
uint8_t orig_memory[TWIN_MEMORY];
twin_events orig_events;
int orig_bank, orig_astray, orig_bank_reads, orig_ime;
uint8_t orig_read[TWIN_MEMORY], orig_stored[TWIN_MEMORY];
uint16_t orig_lowest;
uint32_t *orig_ran_at;
uint8_t *orig_ran_ways;
uint32_t orig_ran_count;

static const uint8_t *rom;
static uint32_t rom_size;
static int banks, chip, bank_said;
// whether the processor is fetching an instruction's own bytes, which isn't the function reading its memory, and
// whether what it writes is a push, to the stack
static int fetching, pushing;
static gambatte::CPU *cpu;
static gambatte::SaveState state;
// for a stop the twin calls: how the processor reads and writes the twin's memory and hardware, or null, and what its
// pushes covered, which it puts back once it has returned, as a function in C leaves nothing on the stack: each place
// of the memory a push wrote first, what was there before, and whether it was stored to other than by pushing too
static uint8_t (*through_read)(uint16_t);
static void (*through_write)(uint16_t, uint8_t);
static uint8_t through_pushed[TWIN_MEMORY], through_before[TWIN_MEMORY], through_stored[TWIN_MEMORY];
static int through_places[TWIN_MEMORY], through_count;

static uint32_t place_of(unsigned address) {
  if (address < 0x4000) return address < rom_size ? address : rom_size;
  if (address < 0x8000 && orig_bank >= 0) return ((uint32_t)orig_bank * 0x4000 + (address - 0x4000)) % rom_size;
  return rom_size;
}

unsigned dp_read(unsigned address) {
  if (through_read) return through_read((uint16_t)address);
  if (address < 0x4000) return rom[address % rom_size];
  if (address < 0x8000) {
    if (!bank_said) orig_bank_reads++;
    return rom[((uint32_t)(orig_bank < 0 ? 1 : orig_bank) * 0x4000 + (address - 0x4000)) % rom_size];
  }
  int place = twin_place((uint16_t)address);
  if (place >= 0) {
    if (!fetching) orig_read[place] = 1;
    return orig_memory[place];
  }
  if (address >= 0xFEA0 && address < 0xFF00) {
    orig_astray++;
    return 0xFF;
  }
  return twin_note(&orig_events, TWIN_HW_READ, (uint16_t)address, 0);
}

void dp_write(unsigned address, unsigned value) {
  int place = twin_place((uint16_t)address);
  if (through_write) {
    if (place >= 0 && !pushing) through_stored[place] = 1;
    else if (place >= 0 && !through_pushed[place]) {
      through_pushed[place] = 1;
      through_before[place] = through_read((uint16_t)address);
      through_places[through_count++] = place;
    }
    return through_write((uint16_t)address, (uint8_t)value);
  }
  if (place >= 0) {
    orig_memory[place] = (uint8_t)value;
    if (!pushing) orig_stored[place] = 1;
    return;
  }
  if (address >= 0xFEA0 && address < 0xFF00) {
    orig_astray++;
    return;
  }
  twin_note(&orig_events, TWIN_HW_WRITE, (uint16_t)address, (uint8_t)value);
  if (address < 0x8000) {
    int to = twin_switched(chip, banks, (uint16_t)address, (uint8_t)value, orig_bank);
    if (to >= 0) {
      orig_bank = to;
      bank_said = 1;
    }
  }
}

void orig_init(const uint8_t *bytes, uint32_t size, int colour, int kind) {
  rom = bytes;
  rom_size = size;
  banks = (int)(size / 0x4000);
  chip = kind;
  dp_colour = colour != 0;
  orig_ran_at = (uint32_t *)calloc(size, sizeof *orig_ran_at);
  orig_ran_ways = (uint8_t *)calloc(size, 1);
  cpu = new gambatte::CPU();
  cpu->setStatePtrs(state);
}

// the instructions that write to the stack: PUSH, CALL and RST
static int pushes(uint8_t op) {
  return (op & 0xCF) == 0xC5 || op == 0xCD || (op & 0xE7) == 0xC4 || (op & 0xC7) == 0xC7;
}
// a jump, call or return that goes one way or the other: JR cc, JP cc, CALL cc and RET cc, with its length
static int two_ways(uint8_t op) {
  if ((op & 0xE7) == 0x20) return 2;
  if ((op & 0xE7) == 0xC2 || (op & 0xE7) == 0xC4) return 3;
  return (op & 0xE7) == 0xC0 ? 1 : 0;
}

// The processor from `r` at `pc` until it comes back to TWIN_RETURN_TO, which the caller has put at r->SP: how it
// ended, as orig_call says. With `noting`, as the original's side's own call, it notes how low the stack went and
// where each instruction of the program went on.
static int run(uint16_t pc, twin_regs *r, long *cycles, int noting) {
  uint16_t sp = r->SP;
  cpu->saveState(state);
  state.cpu.cycleCounter = 0;
  state.cpu.pc = pc;
  state.cpu.sp = sp;
  state.cpu.a = r->A; state.cpu.b = r->B; state.cpu.c = r->C; state.cpu.d = r->D; state.cpu.e = r->E; state.cpu.h = r->H; state.cpu.l = r->L;
  state.cpu.f = (unsigned char)((r->ZF ? 0x80 : 0) | (r->NF ? 0x40 : 0) | (r->HF ? 0x20 : 0) | (r->CF ? 0x10 : 0));
  state.cpu.skip = false;
  cpu->loadState(state);
  cpu->mem_.calm();
  long steps = 0;
  int how = 0;
  for (;; steps++) {
    cpu->saveState(state);
    unsigned at = state.cpu.pc;
    if (at == TWIN_RETURN_TO) break;
    if (steps >= MOST_STEPS) { how = 1; break; }
    if (cpu->mem_.halted() || cpu->mem_.stopped()) { how = 4; break; }
    // the instruction's own bytes, read without counting as the function's reads
    fetching = 1;
    uint8_t op = (uint8_t)dp_read(at);
    fetching = 0;
    int twin_at = twin_place((uint16_t)at);
    if (twin_at < 0 && at >= 0x8000) { how = 2; break; }
    if (op == 0xD3 || op == 0xDB || op == 0xDD || op == 0xE3 || op == 0xE4 || op == 0xEB || op == 0xEC || op == 0xED || op == 0xF4 || op == 0xFC || op == 0xFD) { how = 2; break; }
    uint32_t place = place_of(at);
    pushing = pushes(op);
    cpu->runFor(1);
    pushing = 0;
    cpu->saveState(state);
    if (!noting) continue;
    if (state.cpu.sp < orig_lowest && (uint16_t)(orig_lowest - state.cpu.sp) < 0x1000) orig_lowest = state.cpu.sp;
    if (place < rom_size) {
      if (!orig_ran_ways[place]) orig_ran_at[orig_ran_count++] = place;
      int length = two_ways(op);
      orig_ran_ways[place] |= length && state.cpu.pc == ((at + (unsigned)length) & 0xFFFF) ? TWIN_WENT_ON : TWIN_WENT_ELSEWHERE;
    }
  }
  *cycles = (long)state.cpu.cycleCounter;
  r->A = state.cpu.a; r->B = state.cpu.b; r->C = state.cpu.c; r->D = state.cpu.d; r->E = state.cpu.e; r->H = state.cpu.h; r->L = state.cpu.l;
  r->ZF = !!(state.cpu.f & 0x80); r->NF = !!(state.cpu.f & 0x40); r->HF = !!(state.cpu.f & 0x20); r->CF = !!(state.cpu.f & 0x10);
  if (!how && state.cpu.sp != (uint16_t)(sp + 2)) how = 3;
  return how;
}

int orig_call(uint16_t pc, int bank, twin_regs *r, long *cycles) {
  uint16_t sp = r->SP;
  orig_bank = bank;
  bank_said = bank >= 0;
  orig_events.count = 0;
  orig_astray = orig_bank_reads = 0;
  for (uint32_t i = 0; i < orig_ran_count; i++) orig_ran_ways[orig_ran_at[i]] = 0;
  orig_ran_count = 0;
  memset(orig_stored, 0, sizeof orig_stored);
  memset(orig_read, 0, sizeof orig_read);
  // as the CALL that called it leaves the stack: the address to come back to, low byte first
  int low = twin_place(sp), high = twin_place((uint16_t)(sp + 1));
  if (low >= 0) orig_memory[low] = TWIN_RETURN_TO & 0xFF;
  if (high >= 0) orig_memory[high] = TWIN_RETURN_TO >> 8;
  orig_lowest = sp;
  int how = run(pc, r, cycles, 1);
  orig_ime = cpu->mem_.ime();
  return how;
}

int orig_call_through(uint16_t pc, twin_regs *r, long *cycles, uint8_t (*read)(uint16_t), void (*write)(uint16_t, uint8_t)) {
  through_read = read;
  through_write = write;
  through_count = 0;
  // as the CALL that called it leaves the stack, in the twin's memory
  pushing = 1;
  dp_write(r->SP, TWIN_RETURN_TO & 0xFF);
  dp_write((uint16_t)(r->SP + 1), TWIN_RETURN_TO >> 8);
  pushing = 0;
  int how = run(pc, r, cycles, 0);
  through_read = NULL;
  through_write = NULL;
  for (int i = 0; i < through_count; i++) {
    int place = through_places[i];
    if (!through_stored[place]) write(twin_address(place), through_before[place]);
    through_pushed[place] = 0;
  }
  memset(through_stored, 0, sizeof through_stored);
  return how;
}
