// The original's side of the PlayStation's function check: one function of a game's program, run in PCSX ReARMed's
// own interpreter. The build compiles that emulator's psxinterpreter.c, gte.c and gte_divider.c as its makers wrote
// them, from the source the proof tools fetch for the reference emulator at the commit tools/consoles.mjs fixes,
// beside this file, which stands in for the rest of the emulator (original.mjs). So the reference is the processor,
// and the geometry processor, that the proof's own emulator runs every game on.
//
// What the processor sees: the console's 2 MB of memory, with its mirrors up to 8 MB, at 0x00000000, 0x80000000 and
// 0xA0000000; the scratchpad's 1 KB at 0x1F800000; and the hardware's registers, 0x1F801000 to 0x1F802FFF, kept as
// memory, so a store to one is kept and a read gives what was kept there. Nothing of the BIOS is there: a function
// that goes into the BIOS's calls, at the bottom of the memory, or reads or writes or runs anywhere else, stops there.
// The interpreter runs as the reference emulator has it, but for two settings: an access where no halfword or word
// starts raises the console's exception, as the setting for exceptions does, so it stops the call, and nothing is
// cached between calls, as each starts afresh.
//
// It's kept running and told what to do on its standard input, in little-endian words, and answers on its standard
// output:
//
//   'I' image      the memory every call starts from: IMAGE bytes, the console's 2 MB, then 0x3000 bytes of which the
//                  first 1 KB is the scratchpad and the last 8 KB the hardware's registers. Answers 'k'.
//   'C' call       runs a function from that memory with some of it changed: the function's address, how many bytes
//                  long it is, how many instructions it may run, the 32 registers with hi and lo, and the changes, a
//                  count and then each one's address, bytes (1, 2 or 4) and value. A call ends when the processor
//                  comes back to where ra pointed as it started. Answers how it ended, the words below, and then the
//                  memory every call starts from is as it was.
//   'Q'            ends the program.
//
// What a call answers, in words but for the bytes of what ran and of the memory:
//   end        0 came back, 1 ran out of instructions, 2 an exception, 3 went where the check can't follow,
//              4 isolated the cache, as the BIOS does to clear it
//   detail     the exception's cause, or the address it went to
//   pc         where it was when it ended
//   steps      how many instructions it ran
//   gte        how many of them were the geometry processor's
//   hardware   how many reads and writes went to the hardware's registers
//   34 words   the registers as it left them, r0 to r31, hi and lo
//   span / 4   one byte for each instruction of the function: 1 when it ran, 2 when a branch there went to its
//   bytes      target, 4 when it went on past its delay slot
//   reads      a count, then each place it read, the first time: address, bytes and the value it read
//   chunks     a count, then each 256 bytes of the image it wrote: where they are, in 256s, and the bytes as it left
//              them

#include <setjmp.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "psxcommon.h"
#include "r3000a.h"
#include "psxmem.h"
#include "psxhle.h"
#include "psxinterpreter.h"

enum { RAM = 0x200000, HIGH = 0x3000, IMAGE = RAM + HIGH, CHUNK = 256, CHUNKS = IMAGE / CHUNK, MOST_READS = 1024 };
enum { END_BACK, END_STEPS, END_EXCEPTION, END_ELSEWHERE, END_CACHE };

// the rest of the emulator, as the three files of it see it
psxRegisters psxRegs;
PcsxConfig Config;
R3000Acpu *psxCpu = &psxInt;
void (* const psxHLEt[hleop_count_])() = { 0 };
void SysPrintf(const char *fmt, ...) { (void)fmt; }
void psxBranchTest(psxRegisters *regs) { (void)regs; }
void psxBiosJumpTest(psxRegisters *regs) { (void)regs; }

static u8 base[IMAGE], image[IMAGE];
static u8 dirty[CHUNKS];
static uintptr_t lut[1 << 13];
static jmp_buf out;
static u32 ended, detail, steps, gte, hardware;
static u32 reads[MOST_READS][3], read_count;

static void stop(u32 how, u32 what) {
  ended = how;
  detail = what;
  longjmp(out, 1);
}

void psxException(u32 code, enum R3000Abdt bdt, psxCP0Regs *cp0) {
  (void)bdt;
  (void)cp0;
  stop(END_EXCEPTION, code);
}

void psxMemOnIsolate(int enable) {
  if (enable) stop(END_CACHE, 0);
}

// where an address is in the image, as the console's wiring takes it, or the end of the call
static u32 place(u32 mem) {
  if (mem >= 0x20000000u && mem < 0x80000000u) stop(END_ELSEWHERE, mem);
  if (mem >= 0xC0000000u) stop(END_ELSEWHERE, mem);
  u32 physical = mem & 0x1FFFFFFFu;
  if (physical < 0x800000u) return physical & (RAM - 1);
  if ((physical & 0xFFFF0000u) == 0x1F800000u) {
    u32 low = physical & 0xFFFF;
    if (low < 0x400) return RAM + low;
    if (low >= 0x1000 && low < 0x3000) {
      hardware++;
      return RAM + low;
    }
  }
  stop(END_ELSEWHERE, mem);
  return 0;
}

static u32 load(u32 at, int bytes) {
  u32 value = image[at];
  if (bytes > 1) value |= image[at + 1] << 8;
  if (bytes > 2) value |= (u32)image[at + 2] << 16 | (u32)image[at + 3] << 24;
  return value;
}

static void keep(u32 at, int bytes, u32 value) {
  for (int i = 0; i < bytes; i++) {
    image[at + i] = (u8)(value >> (8 * i));
    dirty[(at + i) / CHUNK] = 1;
  }
}

static u32 read_at(u32 mem, int bytes) {
  u32 value = load(place(mem), bytes);
  for (u32 i = 0; i < read_count; i++) if (reads[i][0] == mem && reads[i][1] == (u32)bytes) return value;
  if (read_count < MOST_READS) {
    reads[read_count][0] = mem;
    reads[read_count][1] = bytes;
    reads[read_count++][2] = value;
  }
  return value;
}

u8 psxMemRead8(psxRegisters *regs, u32 mem) { (void)regs; return (u8)read_at(mem, 1); }
u16 psxMemRead16(psxRegisters *regs, u32 mem) { (void)regs; return (u16)read_at(mem, 2); }
u32 psxMemRead32(psxRegisters *regs, u32 mem) { (void)regs; return read_at(mem, 4); }
void psxMemWrite8(psxRegisters *regs, u32 mem, u32 value) { (void)regs; keep(place(mem), 1, value); }
void psxMemWrite16(psxRegisters *regs, u32 mem, u32 value) { (void)regs; keep(place(mem), 2, value); }
void psxMemWrite32(psxRegisters *regs, u32 mem, u32 value) { (void)regs; keep(place(mem), 4, value); }

// The table the interpreter fetches instructions through: each 512 KB of the address space, as where it is in the
// console's memory less where it starts, for the three ways the console sees its memory. Anything else isn't there.
static void lay_out(void) {
  static const u32 seen_at[] = { 0x00000000u, 0x80000000u, 0xA0000000u };
  for (size_t i = 0; i < sizeof lut / sizeof lut[0]; i++) lut[i] = (uintptr_t)INVALID_PTR_VAL;
  for (int way = 0; way < 3; way++) {
    for (u32 page = 0; page < 16; page++) {
      u32 start = seen_at[way] + (page << 19);
      lut[start >> 19] = (uintptr_t)(image + ((page & 3) << 19)) - start;
    }
  }
  psxRegs.ptrs.psxM = image;
  psxRegs.ptrs.psxH = image + RAM;
  psxRegs.ptrs.memRLUT = lut;
  psxRegs.ptrs.memWLUT = lut;
}

static int conditional(u32 code) {
  u32 op = code >> 26;
  return op == 1 || (op >= 4 && op <= 7);
}

static int is_gte(u32 code) {
  u32 op = code >> 26;
  return op == 0x12 || op == 0x32 || op == 0x3A;
}

// The call being run: where it comes back to, how many instructions it may run, its function and what of it ran, and
// the last conditional branch fetched, until the instruction after its delay slot says which way it went.
static u32 back, limit, start, span;
static u8 *ran;
static u32 branch_at, branch_to, branch_slot;
static u32 (INT_ATTR *their_fetch)(psxRegisters *regs, const uintptr_t *luts, u32 pc);

static void went(u32 pc) {
  u32 offset = branch_at - start;
  if (pc == branch_to) ran[offset / 4] |= 2;
  if (pc == branch_at + 8) ran[offset / 4] |= 4;
  branch_at = 0;
}

// Every instruction the interpreter runs is fetched here first, a delay slot's and those a load's delay runs together
// too, so this is where what ran is noted, and where a call stops that's back, has run too long, or runs where no
// game's code can be: anywhere but the console's memory, or its lowest 64 KB, where the BIOS keeps its own.
static u32 INT_ATTR fetch(psxRegisters *regs, const uintptr_t *luts, u32 pc) {
  if (pc == back) {
    regs->pc = pc;
    stop(END_BACK, 0);
  }
  u32 physical = pc & 0x1FFFFFFFu;
  if ((pc >= 0x20000000u && pc < 0x80000000u) || pc >= 0xC0000000u || physical >= 0x800000u || (physical & (RAM - 1)) < 0x10000u) {
    regs->pc = pc;
    stop(END_ELSEWHERE, pc);
  }
  if (steps >= limit) {
    regs->pc = pc;
    stop(END_STEPS, 0);
  }
  steps++;
  if (branch_at && branch_slot) went(pc);
  else if (branch_at && pc == branch_at + 4) branch_slot = 1;
  u32 code = their_fetch(regs, luts, pc);
  if (is_gte(code)) gte++;
  u32 offset = pc - start;
  if (offset < span) {
    ran[offset / 4] |= 1;
    if (conditional(code)) {
      branch_at = pc;
      branch_to = pc + 4 + ((u32)(s32)(s16)(code & 0xFFFF) << 2);
      branch_slot = 0;
    }
  }
  return code;
}

static void run(void) {
  steps = gte = hardware = 0;
  ended = END_BACK;
  detail = 0;
  branch_at = 0;
  if (!setjmp(out)) {
    while (psxRegs.pc != back) execI(&psxRegs);
  }
  if (branch_at && branch_slot) went(psxRegs.pc);
  // a load in the last delay slot is in its register once the function is back
  if (ended == END_BACK) {
    for (int i = 0; i < 2; i++) {
      if (psxRegs.dloadReg[i]) psxRegs.GPR.r[psxRegs.dloadReg[i]] = psxRegs.dloadVal[i];
      psxRegs.dloadReg[i] = 0;
      psxRegs.dloadVal[i] = 0;
    }
  }
}

static int take(void *to, size_t bytes) { return fread(to, 1, bytes, stdin) == bytes; }
static u32 word(void) {
  u8 b[4];
  if (!take(b, 4)) exit(0);
  return b[0] | b[1] << 8 | (u32)b[2] << 16 | (u32)b[3] << 24;
}
static void say(u32 value) {
  u8 b[4] = { (u8)value, (u8)(value >> 8), (u8)(value >> 16), (u8)(value >> 24) };
  fwrite(b, 1, 4, stdout);
}

static void call(void) {
  start = word();
  span = word();
  limit = word();
  u32 registers[34];
  for (int i = 0; i < 34; i++) registers[i] = word();
  memcpy(image, base, IMAGE);
  memset(dirty, 0, sizeof dirty);
  u32 changes = word();
  for (u32 i = 0; i < changes; i++) {
    u32 address = word(), bytes = word(), value = word();
    u32 physical = address & 0x1FFFFFFFu;
    u32 at = physical < 0x800000u ? physical & (RAM - 1) : (physical & 0xFFFF0000u) == 0x1F800000u && (physical & 0xFFFF) < 0x3000 ? RAM + (physical & 0xFFFF) : IMAGE;
    if (at + bytes <= IMAGE) keep(at, bytes, value);
  }
  // what the changes wrote is part of what the call starts from, not of what it left
  memset(dirty, 0, sizeof dirty);

  memset(&psxRegs.GPR, 0, sizeof psxRegs.GPR);
  for (int i = 1; i < 32; i++) psxRegs.GPR.r[i] = registers[i];
  psxRegs.GPR.n.hi = registers[32];
  psxRegs.GPR.n.lo = registers[33];
  memset(&psxRegs.CP0, 0, sizeof psxRegs.CP0);
  memset(&psxRegs.CP2, 0, sizeof psxRegs.CP2);
  // the geometry processor usable and interrupts off, as a game's code runs
  psxRegs.CP0.n.SR = 0x40000000u;
  psxRegs.pc = start;
  psxRegs.branching = 0;
  psxRegs.dloadSel = 0;
  memset(psxRegs.dloadReg, 0, sizeof psxRegs.dloadReg);
  memset(psxRegs.dloadVal, 0, sizeof psxRegs.dloadVal);
  read_count = 0;
  intApplyConfig();
  their_fetch = psxRegs.ptrs.intFetch;
  psxRegs.ptrs.intFetch = fetch;

  back = registers[31];
  ran = calloc(span / 4 + 1, 1);
  run();

  say(ended);
  say(detail);
  say(psxRegs.pc);
  say(steps);
  say(gte);
  say(hardware);
  for (int i = 0; i < 32; i++) say(psxRegs.GPR.r[i]);
  say(psxRegs.GPR.n.hi);
  say(psxRegs.GPR.n.lo);
  fwrite(ran, 1, span / 4, stdout);
  free(ran);
  say(read_count);
  for (u32 i = 0; i < read_count; i++) for (int j = 0; j < 3; j++) say(reads[i][j]);
  u32 written = 0;
  for (u32 i = 0; i < CHUNKS; i++) written += dirty[i];
  say(written);
  for (u32 i = 0; i < CHUNKS; i++) {
    if (!dirty[i]) continue;
    say(i);
    fwrite(image + i * CHUNK, 1, CHUNK, stdout);
  }
  fflush(stdout);
}

int main(void) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  // as the reference emulator runs its interpreter (tools/consoles.mjs), but for the two settings above and the
  // BIOS's stand-in, which has nothing to stand in for here
  Config.HLE = 0;
  Config.icache_emulation = 0;
  Config.DisableStalls = 0;
  Config.PreciseExceptions = 1;
  Config.cycle_multiplier = CYCLE_MULT_DEFAULT;
  psxRegs.CP0.n.SR = 0x40000000u;
  lay_out();
  intApplyConfig();
  for (;;) {
    int command = getchar();
    if (command == EOF || command == 'Q') return 0;
    if (command == 'I') {
      if (!take(base, IMAGE)) return 1;
      putchar('k');
      fflush(stdout);
    } else if (command == 'C') {
      call();
    } else {
      fprintf(stderr, "unknown command %d\n", command);
      return 1;
    }
  }
}
