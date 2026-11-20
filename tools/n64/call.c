// The original's side of the Nintendo 64's function check: one function of a game's program, run in Parallel N64's own
// processor, mupen64plus-core's VR4300, on its cached interpreter, as the reference emulator runs every game
// (tools/consoles.mjs). The build compiles that emulator's r4300 files, its cached interpreter, its decoder, its
// coprocessors, its TLB and its core, as their makers wrote them, from the source the proof tools fetch at the commit
// tools/consoles.mjs fixes, beside this file, which stands in for the rest of the console (original.mjs).
//
// What the processor sees, through the emulator's own table of what answers each 64 KB of the bus: the console's 8 MB
// of memory at 0x00000000, which code sees at 0x80000000 and 0xA0000000; the RSP's 4 KB of data and 4 KB of
// instructions at 0x04000000; and the hardware's registers, the RSP's, the RDP's, and the MI's, VI's, AI's, PI's,
// RI's and SI's, with the PIF's 64 bytes of RAM, kept as memory, so a store to one is kept and a read gives what was
// kept there. Nothing else is there, the cartridge included: a function that reads, writes or runs anywhere else stops
// there. Every number is kept as the console keeps it, its highest byte first, and the emulator works on words as its
// own memory does. Its exceptions are its own, from its own coprocessor 0: one ends the call. Nothing is cached between
// calls, as each starts afresh, and no interrupt comes during one.
//
// It's kept running and told what to do on its standard input, in little-endian words, a 64-bit number as two of them,
// the low one first, and answers on its standard output:
//
//   'I' image      the memory every call starts from: IMAGE bytes in the console's order, the console's 8 MB, then
//                  the RSP's 8 KB, then 0x300 bytes of the hardware's registers, 0x40 for each block of them, in the
//                  order of HARDWARE below. Answers 'k'.
//   'C' call       runs a function from that memory with some of it changed: the function's address, how many bytes
//                  long it is, how many instructions it may run, coprocessor 0's Status, the floating-point unit's
//                  control and status register FCR31, the 32 registers with hi and lo, 64 bits each, the floating-point
//                  unit's 32, 64 bits each as the processor keeps them, and the changes, a count and then each one's
//                  address, bytes (1, 2 or 4) and value. A call ends when the processor comes back to where ra pointed
//                  as it started. Answers how it ended, the words below, and then the memory every call starts from is
//                  as it was: what the call and its changes wrote is put back before the next.
//   'Q'            ends the program.
//
// What a call answers, in words but for the bytes of what ran and of the memory:
//   end        0 came back, 1 ran out of instructions, 2 an exception, 3 went where the check can't follow
//   detail     the exception's Cause, or the physical address it went to
//   pc         where it was when it ended, or where the exception was taken, EPC
//   steps      how many instructions it ran
//   fpu        how many of them were the floating-point unit's
//   hardware   how many reads and writes went to the hardware's registers
//   FCR31      as it left it
//   34 × 2     the registers as it left them, r0 to r31, hi and lo
//   32 × 2     the floating-point unit's registers as it left them
//   span / 4   one byte for each instruction of the function: 1 when it ran, 2 when a branch there went to its
//   bytes      target, 4 when it went on past its delay slot
//   reads      a count, then each word it read, the first time: its physical address, 4, and the value it read
//   chunks     a count, then each 256 bytes of the image it wrote: where they are, in 256s, and the bytes as it left
//              them, in the console's order

#include <setjmp.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "api/callbacks.h"
#include "device/device.h"
#include "device/r4300/cached_interp.h"
#include "device/r4300/cp0.h"
#include "device/r4300/cp1.h"
#include "device/r4300/interrupt.h"
#include "device/r4300/r4300_core.h"
#include "device/memory/m64p_memory.h"
#include "osal/preproc.h"
#ifdef OSAL_SSE
#include <xmmintrin.h>
#include <pmmintrin.h>
#endif

typedef uint8_t u8;
typedef uint32_t u32;
typedef uint64_t u64;

enum { RAM = 0x800000, RSP_MEMORY = 0x2000, SLOT = 0x40, SLOTS = 12, IMAGE = RAM + RSP_MEMORY + SLOT * SLOTS };
enum { CHUNK = 256, CHUNKS = IMAGE / CHUNK, MOST_READS = 1024 };
enum { END_BACK, END_STEPS, END_EXCEPTION, END_ELSEWHERE };
// counted as the emulator counts for a game its own list doesn't name (main.c, ROM_SETTINGS.countperop)
enum { COUNT_PER_OP = 2 };
// so far off that no interrupt's time comes during a call
#define NO_INTERRUPT (-0x40000000)

// the hardware's registers, each block where the console's wiring has it and how many bytes of it there are
static const u32 HARDWARE[][2] = {
  { 0x04040000u, 0x20 }, { 0x04080000u, 0x08 }, { 0x04100000u, 0x20 }, { 0x04200000u, 0x10 }, { 0x04300000u, 0x10 },
  { 0x04400000u, 0x38 }, { 0x04500000u, 0x18 }, { 0x04600000u, 0x34 }, { 0x04700000u, 0x20 }, { 0x04800000u, 0x1C },
  { 0x1FC007C0u, 0x40 },
};

// the rest of the emulator, as its r4300 files see it
struct device g_dev;
unsigned int r4300_emumode = EMUMODE_INTERPRETER;
unsigned int r4300_jit_backend = R4300_JIT_ARI64;
unsigned int IgnoreTLBExceptions = 0;
int g_aleck64_enabled = 0;
int frame_break = 0;
uint32_t *aleck64_fast_mem(uint32_t address) { (void)address; return NULL; }
void run_pure_interpreter(struct r4300_core *r4300) { (void)r4300; }
void DebugMessage(int level, const char *message, ...) { (void)level; (void)message; }
void init_interrupt(struct cp0 *cp0) { *r4300_cp0_cycle_count(cp0) = NO_INTERRUPT; }
void gen_interrupt(struct r4300_core *r4300) { *r4300_cp0_cycle_count(&r4300->cp0) = NO_INTERRUPT; }
void r4300_check_interrupt(struct r4300_core *r4300, uint32_t cause_ip, int set_cause) { (void)r4300; (void)cause_ip; (void)set_cause; }
void translate_event_queue(struct cp0 *cp0, unsigned int base) { (void)cp0; (void)base; }
void remove_event(struct interrupt_queue *q, int type) { (void)q; (void)type; }
void add_interrupt_event_count(struct cp0 *cp0, int type, unsigned int count) { (void)cp0; (void)type; (void)count; }
// what the hash of a page of code the TLB maps asks of the computer it runs on: none of its own instructions, so it
// hashes the plain way, to the same number
uint64_t cpu_features_get(void) { return 0; }

// the memory, a word of the console's at a time, its highest byte first as the console reads it, as the emulator's
// own memory keeps it
static u32 base[IMAGE / 4], image[IMAGE / 4];
static u8 dirty[CHUNKS];
// the chunks the last call wrote, or its changes did, which are put back from `base` before the next call, so a call
// doesn't copy all 8 MB
static u8 stale[CHUNKS];
static u32 stale_list[CHUNKS], stale_count;

static void mark_stale(u32 chunk) {
  if (stale[chunk]) return;
  stale[chunk] = 1;
  stale_list[stale_count++] = chunk;
}

static void put_back(void) {
  for (u32 i = 0; i < stale_count; i++) {
    u32 chunk = stale_list[i];
    memcpy(&image[chunk * CHUNK / 4], &base[chunk * CHUNK / 4], CHUNK);
    stale[chunk] = 0;
  }
  stale_count = 0;
}
static jmp_buf out;
static u32 ended, detail, ended_at, steps, fpu, hardware;
static u32 reads[MOST_READS][2], read_count;

static void stop(u32 how, u32 what) {
  ended = how;
  detail = what;
  longjmp(out, 1);
}

// what answers one part of the bus: where it starts, how many bytes it has, where it is in the image, and whether it's
// the hardware's
struct region { u32 start, bytes, at; int hardware; };
static struct region regions[2 + sizeof HARDWARE / sizeof HARDWARE[0]];

// the places a call read already, kept as a small open table so a loop that reads a lot doesn't look through every
// one each time
enum { SEEN = 4 * MOST_READS };
static u32 seen_key[SEEN];
static u8 seen_used[SEEN];

static int seen_before(u32 address) {
  u32 at = (address * 2654435761u) >> 20 & (SEEN - 1);
  while (seen_used[at]) {
    if (seen_key[at] == address) return 1;
    at = (at + 1) & (SEEN - 1);
  }
  seen_used[at] = 1;
  seen_key[at] = address;
  return 0;
}

static u32 at_in(const struct region *r, u32 address) {
  u32 offset = address - r->start;
  if (offset >= r->bytes) stop(END_ELSEWHERE, address);
  if (r->hardware) hardware++;
  return r->at + offset;
}

static void region_read(void *opaque, uint32_t address, uint32_t *value) {
  u32 at = at_in(opaque, address);
  *value = image[at / 4];
  if (read_count < MOST_READS && !seen_before(address)) {
    reads[read_count][0] = address;
    reads[read_count++][1] = *value;
  }
}

static void region_write(void *opaque, uint32_t address, uint32_t value, uint32_t mask) {
  u32 at = at_in(opaque, address);
  image[at / 4] = (image[at / 4] & ~mask) | (value & mask);
  dirty[at / CHUNK] = 1;
}

static void nowhere_read(void *opaque, uint32_t address, uint32_t *value) {
  (void)opaque;
  (void)value;
  stop(END_ELSEWHERE, address);
}

static void nowhere_write(void *opaque, uint32_t address, uint32_t value, uint32_t mask) {
  (void)opaque;
  (void)value;
  (void)mask;
  stop(END_ELSEWHERE, address);
}

// where a physical address is in the image, or IMAGE when it isn't there
static u32 place(u32 physical) {
  for (size_t i = 0; i < sizeof regions / sizeof regions[0]; i++) {
    if (physical - regions[i].start < regions[i].bytes) return regions[i].at + physical - regions[i].start;
  }
  return IMAGE;
}

// The emulator's own pointer into its memory, which its cached interpreter reads instructions through: the console's
// memory and the RSP's, and nothing else
uint32_t *mem_base_u32(void *mem_base, uint32_t address) {
  (void)mem_base;
  u32 at = place(address & 0x1FFFFFFCu);
  if (at >= RAM + RSP_MEMORY) stop(END_ELSEWHERE, address);
  return &image[at / 4];
}

static void wire(void) {
  struct memory *bus = &g_dev.mem;
  for (u32 i = 0; i < 0x10000; i++) bus->handlers[i] = (struct mem_handler){ NULL, nowhere_read, nowhere_write };
  size_t n = 0;
  regions[n++] = (struct region){ 0, RAM, 0, 0 };
  regions[n++] = (struct region){ 0x04000000u, RSP_MEMORY, RAM, 0 };
  for (size_t i = 0; i < sizeof HARDWARE / sizeof HARDWARE[0]; i++) regions[n++] = (struct region){ HARDWARE[i][0], HARDWARE[i][1], RAM + RSP_MEMORY + SLOT * i, 1 };
  for (size_t i = 0; i < n; i++) {
    for (u32 part = regions[i].start >> 16; part <= (regions[i].start + regions[i].bytes - 1) >> 16; part++) bus->handlers[part] = (struct mem_handler){ &regions[i], region_read, region_write };
  }
  g_dev.rdram.dram = image;
  g_dev.rdram.dram_size = RAM;
}

// Whether code can run at an address: in the console's memory, through either of the two ways code sees it without the
// TLB. The emulator keeps the instructions it has decoded for each way apart, so the real ones are kept here by both.
static int runnable(u32 pc) {
  return (pc & 0xC0000000u) == 0x80000000u && (pc & 0x1FFFFFFFu) < RAM && (pc & 3) == 0;
}
static void (*real[2 * RAM / 4])(void);
static u32 slot_of(u32 pc) { return ((pc >> 29) & 1) * (RAM / 4) + ((pc & (RAM - 1)) >> 2); }

static int conditional(u32 code) {
  u32 op = code >> 26;
  if (op == 1) return ((code >> 16) & 0x1F) < 4 || (((code >> 16) & 0x1F) >= 16 && ((code >> 16) & 0x1F) < 20);
  if (op >= 4 && op <= 7) return 1;
  if (op >= 20 && op <= 23) return 1;
  return op == 17 && ((code >> 21) & 0x1F) == 8;
}

static int floating(u32 code) {
  u32 op = code >> 26;
  return op == 17 || op == 49 || op == 53 || op == 57 || op == 61;
}

// The call being run: where it comes back to, how many instructions it may run, its function and what of it ran.
static u32 back, limit, start, span;
static u8 *ran;

// Every instruction the interpreter has decoded runs through here first, a delay slot's too, which the instruction
// before it runs, so this is where what ran is noted, and where a call stops that has run too long. A branch's way is
// where it left the processor once it and its delay slot have run.
static void noted(void) {
  struct r4300_core *r4300 = &g_dev.r4300;
  u32 pc = (*r4300_pc_struct(r4300))->addr;
  if (steps >= limit) {
    ended_at = pc;
    stop(END_STEPS, 0);
  }
  steps++;
  u32 code = image[(pc & (RAM - 1)) / 4], offset = pc - start;
  if (floating(code)) fpu++;
  int branch = 0;
  u32 target = 0;
  if (offset < span) {
    ran[offset / 4] |= 1;
    if (conditional(code) && !r4300->delay_slot) {
      branch = 1;
      target = pc + 4 + ((u32)(int32_t)(int16_t)(code & 0xFFFF) << 2);
    }
  }
  real[slot_of(pc)]();
  if (branch) {
    u32 now = *r4300_pc(r4300);
    if (now == target) ran[offset / 4] |= 2;
    if (now == pc + 8) ran[offset / 4] |= 4;
  }
}

// The interpreter's own decoding of a page of code, after which each instruction it decoded in the console's memory
// is noted when it runs.
static void recompile(struct r4300_core *r4300, const uint32_t *iw, struct precomp_block *block, uint32_t func) {
  cached_interp_recompile_block(r4300, iw, block, func);
  int length = get_block_length(block);
  for (int i = 0; i < length; i++) {
    struct precomp_instr *inst = block->block + i;
    void (*ops)(void) = inst->ops;
    if (!ops || ops == noted || ops == cached_interp_NOTCOMPILED || ops == cached_interp_NOTCOMPILED2 || ops == cached_interp_FIN_BLOCK || !runnable(inst->addr)) continue;
    real[slot_of(inst->addr)] = ops;
    inst->ops = noted;
  }
}

// As the emulator's own loop runs its cached interpreter (run_cached_interpreter), one instruction after another, with
// the call's ends looked for between them: back where it started, an exception taken, or somewhere code can't run.
static void run(void) {
  struct r4300_core *r4300 = &g_dev.r4300;
  uint32_t *cp0 = r4300_cp0_regs(&r4300->cp0);
  steps = fpu = hardware = 0;
  ended = END_BACK;
  detail = 0;
  if (!setjmp(out)) {
    if (!runnable(start)) {
      ended_at = start;
      stop(END_ELSEWHERE, start & 0x1FFFFFFFu);
    }
    cached_interpreter_jump_to(r4300, start);
    for (;;) {
      u32 pc = (*r4300_pc_struct(r4300))->addr;
      ended_at = pc;
      if (cp0[CP0_STATUS_REG] & CP0_STATUS_EXL) {
        ended_at = cp0[CP0_EPC_REG];
        stop(END_EXCEPTION, cp0[CP0_CAUSE_REG]);
      }
      if (pc == back) stop(END_BACK, 0);
      if (!runnable(pc)) stop(END_ELSEWHERE, pc & 0x1FFFFFFFu);
      r4300_regs(r4300)[0] = 0;
      (*r4300_pc_struct(r4300))->ops();
    }
  }
  // an exception taken where the loop doesn't look, as in an instruction a branch runs in its delay slot
  if (ended != END_EXCEPTION && (cp0[CP0_STATUS_REG] & CP0_STATUS_EXL)) {
    ended = END_EXCEPTION;
    detail = cp0[CP0_CAUSE_REG];
    ended_at = cp0[CP0_EPC_REG];
  }
}

static int take(void *to, size_t bytes) { return fread(to, 1, bytes, stdin) == bytes; }
static u32 word(void) {
  u8 b[4];
  if (!take(b, 4)) exit(0);
  return b[0] | b[1] << 8 | (u32)b[2] << 16 | (u32)b[3] << 24;
}
static u64 dword(void) {
  u64 low = word();
  return low | (u64)word() << 32;
}
static void say(u32 value) {
  u8 b[4] = { (u8)value, (u8)(value >> 8), (u8)(value >> 16), (u8)(value >> 24) };
  fwrite(b, 1, 4, stdout);
}
static void say64(u64 value) {
  say((u32)value);
  say((u32)(value >> 32));
}

// a byte of the image, as the console has it
static void put_byte(u32 at, u32 value) {
  u32 shift = (3 - (at & 3)) * 8;
  image[at / 4] = (image[at / 4] & ~(0xFFu << shift)) | (value & 0xFF) << shift;
}

static void call(void) {
  struct r4300_core *r4300 = &g_dev.r4300;
  start = word();
  span = word();
  limit = word();
  u32 status = word(), fcr31 = word();
  u64 registers[34], floats[32];
  for (int i = 0; i < 34; i++) registers[i] = dword();
  for (int i = 0; i < 32; i++) floats[i] = dword();
  put_back();
  u32 changes = word();
  for (u32 i = 0; i < changes; i++) {
    u32 address = word(), bytes = word(), value = word();
    u32 physical = (address & 0xC0000000u) == 0x80000000u ? address & 0x1FFFFFFFu : address;
    u32 at = place(physical);
    if (bytes > 4 || at >= IMAGE || place(physical + bytes - 1) != at + bytes - 1) continue;
    for (u32 b = 0; b < bytes; b++) {
      put_byte(at + b, value >> (8 * (bytes - 1 - b)));
      mark_stale((at + b) / CHUNK);
    }
  }
  memset(dirty, 0, sizeof dirty);

  // the processor as the emulator powers it on, a fresh TLB with it, but for what the call gives it
  poweron_r4300(r4300);
  uint32_t *cp0 = r4300_cp0_regs(&r4300->cp0);
  cp0[CP0_STATUS_REG] = status & ~CP0_STATUS_EXL;
  cp0[CP0_CAUSE_REG] = 0;
  *r4300_cp0_cycle_count(&r4300->cp0) = NO_INTERRUPT;
  r4300->cp0.last_addr = start;
  for (int i = 1; i < 32; i++) r4300_regs(r4300)[i] = (int64_t)registers[i];
  *r4300_mult_hi(r4300) = (int64_t)registers[32];
  *r4300_mult_lo(r4300) = (int64_t)registers[33];
  cp1_reg *fpr = r4300_cp1_regs(&r4300->cp1);
  for (int i = 0; i < 32; i++) memcpy(&fpr[i], &floats[i], 8);
  *r4300_cp1_fcr31(&r4300->cp1) = fcr31;
  set_fpr_pointers(&r4300->cp1, cp0[CP0_STATUS_REG]);
  update_x86_rounding_mode(&r4300->cp1);
  read_count = 0;
  memset(seen_used, 0, sizeof seen_used);
  invalidate_r4300_cached_code(r4300, 0, 0);

  back = (u32)registers[31];
  ran = calloc(span / 4 + 1, 1);
  run();

  say(ended);
  say(detail);
  say(ended == END_BACK ? back : ended_at);
  say(steps);
  say(fpu);
  say(hardware);
  say(*r4300_cp1_fcr31(&r4300->cp1));
  for (int i = 0; i < 32; i++) say64((u64)r4300_regs(r4300)[i]);
  say64((u64)*r4300_mult_hi(r4300));
  say64((u64)*r4300_mult_lo(r4300));
  for (int i = 0; i < 32; i++) {
    u64 value;
    memcpy(&value, &fpr[i], 8);
    say64(value);
  }
  fwrite(ran, 1, span / 4, stdout);
  free(ran);
  say(read_count);
  for (u32 i = 0; i < read_count; i++) {
    say(reads[i][0]);
    say(4);
    say(reads[i][1]);
  }
  u32 written = 0;
  for (u32 i = 0; i < CHUNKS; i++) written += dirty[i];
  say(written);
  for (u32 i = 0; i < CHUNKS; i++) {
    if (!dirty[i]) continue;
    mark_stale(i);
    say(i);
    u8 bytes[CHUNK];
    for (u32 b = 0; b < CHUNK; b++) bytes[b] = (u8)(image[(i * CHUNK + b) / 4] >> ((3 - (b & 3)) * 8));
    fwrite(bytes, 1, CHUNK, stdout);
  }
  fflush(stdout);
}

int main(void) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
#ifdef OSAL_SSE
  // as the emulator's run_r4300 sets them before the processor runs
  _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_OFF);
#endif
  struct r4300_core *r4300 = &g_dev.r4300;
  // what would answer each of the processor's interrupts, which never come during a call
  static struct interrupt_handler handlers[CP0_INTERRUPT_HANDLERS_COUNT];
  wire();
  init_r4300(r4300, &g_dev.mem, &g_dev.mi, &g_dev.rdram, handlers, EMUMODE_INTERPRETER, COUNT_PER_OP, 0, 0, 0, 0xA4000040u);
  // as run_r4300 sets the cached interpreter up, but for the instructions it decodes, which are noted when they run
  r4300->cached_interp.fin_block = cached_interp_FIN_BLOCK;
  r4300->cached_interp.not_compiled = cached_interp_NOTCOMPILED;
  r4300->cached_interp.not_compiled2 = cached_interp_NOTCOMPILED2;
  r4300->cached_interp.init_block = cached_interp_init_block;
  r4300->cached_interp.free_block = cached_interp_free_block;
  r4300->cached_interp.recompile_block = recompile;
  init_blocks(&r4300->cached_interp);
  poweron_r4300(r4300);
  for (;;) {
    int command = getchar();
    if (command == EOF || command == 'Q') return 0;
    if (command == 'I') {
      u8 *bytes = malloc(IMAGE);
      if (!bytes || !take(bytes, IMAGE)) return 1;
      for (u32 i = 0; i < IMAGE / 4; i++) base[i] = (u32)bytes[4 * i] << 24 | (u32)bytes[4 * i + 1] << 16 | (u32)bytes[4 * i + 2] << 8 | bytes[4 * i + 3];
      free(bytes);
      memcpy(image, base, sizeof image);
      memset(stale, 0, sizeof stale);
      stale_count = 0;
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
