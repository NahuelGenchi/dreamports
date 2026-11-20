// The console's stack, as the original's functions leave it (stack.h).
#include "stack.h"

// the registers a function's caller keeps through its call: r0 to r12, of which a routine in assembly may push any,
// and lr, which a call sets
enum { KEPT = 13, LR = 14, DEPTH = 256, NONE_ANCHOR = 0xFF };

static uint32_t sp;
static uint32_t value[16];
static uint16_t known;   // a bit for each register whose value the game's C gave
static uint32_t return_address;
static int return_known;
static uint32_t gaps;
// whether a game started it: a build that never does, as the function check's, has every call cost nothing
static int started;
// the lowest the stack pointer went since a call of the function check began (gba_stack_begin)
static uint32_t low;
static uint32_t (*console_address)(uint32_t pointer);

// each function running: the stack pointer, the registers and the return address as it was called, and for a routine
// in assembly its table and the last of its anchors its twin reached
// the code each interrupt being taken stopped: its stack pointer and registers
enum { NESTED = 4 };
static struct { uint32_t sp, value[KEPT]; uint16_t known; } stopped[NESTED];
static int interrupts;

static struct {
  uint32_t sp, value[KEPT], lr;
  uint16_t known;
  uint8_t lr_known, last;
  const gba_asm *routine;
} calls[DEPTH];
static int depth;

static void store(uint32_t at, uint32_t v, int bytes) {
  // a routine in assembly stores its pushes before its stack pointer is known to have moved past them
  if (at < low) low = at;
  for (int i = 0; i < bytes; i++) ((volatile uint8_t *)(uintptr_t)at)[i] = (uint8_t)(v >> (8 * i));
}

void gba_stack_start(uint32_t start) {
  started = 1;
  sp = start;
  // the registers as the emulator's BIOS leaves them for the cartridge's first instruction: all of them 0
  for (int r = 0; r < KEPT; r++) value[r] = 0;
  known = (uint16_t)((1u << KEPT) - 1);
  return_known = 0;
  depth = 0;
  interrupts = 0;
  gaps = 0;
}

void gba_stack_begin(uint32_t start) {
  started = 1;
  sp = low = start;
  // what the original's call starts with in its registers is the check's, which the twin's C doesn't give
  known = 0;
  return_known = 0;
  depth = 0;
  interrupts = 0;
  gaps = 0;
}

uint32_t gba_stack_lowest(void) { return low; }

void gba_stack_reset(uint32_t start) {
  // the emulator's BIOS leaves each register as the soft reset found it, and so does the stack's count of them
  sp = start;
  return_known = 0;
  depth = 0;
  interrupts = 0;
}

void gba_stack_addresses(uint32_t (*console)(uint32_t pointer)) { console_address = console; }

uint32_t gba_stack_address(uint32_t pointer) { return console_address ? console_address(pointer) : pointer; }

void gba_stack_reg(int reg, uint32_t v) {
  value[reg] = v;
  known |= (uint16_t)(1u << reg);
}

void gba_stack_unknown(int reg) { known &= (uint16_t) ~(1u << reg); }

void gba_stack_set(int reg, uint64_t v) {
  if (v == GBA_STACK_NONE) gba_stack_unknown(reg);
  else gba_stack_reg(reg, (uint32_t)v);
}

void gba_stack_call(uint32_t to) {
  return_address = to;
  return_known = 1;
  // a call's own arguments and its scratch register are the twin's C's, which says nothing of them
  known &= (uint16_t) ~0x100Fu;
}

void gba_stack_jump(void) {
  return_known = 0;
  known &= (uint16_t) ~0x100Fu;
}

static void enter(const gba_asm *routine) {
  if (depth < DEPTH) {
    calls[depth].sp = sp;
    for (int r = 0; r < KEPT; r++) calls[depth].value[r] = value[r];
    calls[depth].known = known;
    calls[depth].lr = return_address;
    calls[depth].lr_known = (uint8_t)return_known;
    calls[depth].routine = routine;
    calls[depth].last = 0;
  }
  depth++;
}

uint32_t gba_stack_enter(const gba_frame *frame) {
  int lowest = 0;
  if (!started) return 0;
  enter(0);
  for (int i = 0; i < frame->count; i++) {
    const gba_push *push = &frame->pushes[i];
    int has = frame->unproven != GBA_STACK_UNPROVEN && (push->reg == LR ? return_known : (known >> push->reg) & 1);
    if (has) store(sp + (uint32_t)(int32_t)push->slot, push->reg == LR ? return_address : value[push->reg], 4);
    else gaps += 4;
    if (push->slot < lowest) lowest = push->slot;
  }
  return_known = 0;
  // what's known in it of its caller's registers: none in one not proven at all, and in one proven at its start those
  // it doesn't push, which the console's compiler leaves alone
  if (frame->unproven == GBA_STACK_UNPROVEN) known = 0;
  else if (frame->unproven == GBA_STACK_START_PROVEN)
    for (int i = 0; i < frame->count; i++) known &= (uint16_t) ~(1u << frame->pushes[i].reg);
  sp = sp + (uint32_t)lowest - frame->frame;
  if (sp < low) low = sp;
  return (uint32_t)depth;
}

uint32_t gba_stack_asm_enter(const gba_asm *routine) {
  if (!started) return 0;
  enter(routine);
  return_known = 0;
  return (uint32_t)depth;
}

void gba_stack_asm_at(int anchor, const uint64_t *values) {
  if (!started || depth < 1 || depth > DEPTH || !calls[depth - 1].routine) return;
  const gba_asm *routine = calls[depth - 1].routine;
  uint32_t entry = calls[depth - 1].sp;
  const gba_asm_step *step = 0;
  for (int i = 0; i < routine->count && !step; i++)
    if (routine->steps[i].from == calls[depth - 1].last && routine->steps[i].to == anchor) step = &routine->steps[i];
  if (step) {
    for (int i = 0; i < step->count; i++) {
      const gba_asm_write *w = &routine->writes[step->first + i];
      uint64_t v = w->value == NONE_ANCHOR ? GBA_STACK_NONE : values[w->value];
      if (v == GBA_STACK_NONE) gaps += w->bytes;
      else store(entry + (uint32_t)(int32_t)w->slot, (uint32_t)v, w->bytes);
    }
  } else {
    // the twin went a way the routine's table has no step for: whatever the routine stored on it is left out
    gaps++;
  }
  calls[depth - 1].last = (uint8_t)anchor;
  if (routine->sp[anchor] != GBA_STACK_NO_SP) sp = entry + (uint32_t)(int32_t)routine->sp[anchor];
  if (sp < low) low = sp;
}

uint64_t gba_stack_asm_caller(int reg) {
  if (!started || depth < 1 || depth > DEPTH) return GBA_STACK_NONE;
  if (reg == LR) return calls[depth - 1].lr_known ? calls[depth - 1].lr : GBA_STACK_NONE;
  return reg < KEPT && (calls[depth - 1].known >> reg) & 1 ? calls[depth - 1].value[reg] : GBA_STACK_NONE;
}

uint64_t gba_stack_asm_sp(int32_t offset) {
  return !started || depth < 1 || depth > DEPTH ? GBA_STACK_NONE : (uint32_t)(calls[depth - 1].sp + (uint32_t)offset);
}

uint64_t gba_stack_peek(uint32_t at, int bytes) {
  // only the work memory, which the Dreamport keeps at the console's addresses
  int ewram = at >= 0x02000000u && at + (uint32_t)bytes <= 0x02040000u, iwram = at >= 0x03000000u && at + (uint32_t)bytes <= 0x03008000u;
  if (!ewram && !iwram) return GBA_STACK_NONE;
  uint32_t v = 0;
  for (int i = 0; i < bytes; i++) v |= (uint32_t)((volatile uint8_t *)(uintptr_t)at)[i] << (8 * i);
  return v;
}

void gba_stack_asm_unpaired(void) {
  // a call the routine's table doesn't pair: what it pushes is left out, as nothing says where it comes back to or what
  // the registers hold
  known = 0;
  return_known = 0;
  gaps++;
}

void gba_stack_leave(uint32_t *entered) {
  if (!started || !*entered) return;
  depth = (int)*entered - 1;
  if (depth < DEPTH) {
    sp = calls[depth].sp;
    for (int r = 0; r < KEPT; r++) value[r] = calls[depth].value[r];
    known = calls[depth].known;
  }
  return_known = 0;
}

void gba_stack_interrupt(uint32_t stack, uint32_t back) {
  if (!started) return;
  if (interrupts < NESTED) {
    stopped[interrupts].sp = sp;
    for (int r = 0; r < KEPT; r++) stopped[interrupts].value[r] = value[r];
    stopped[interrupts].known = known;
  }
  interrupts++;
  // the BIOS saves r0 to r3, r12 and lr on the interrupts' stack, which the stack leaves out, and calls the handler
  // with its own registers in r0 to r3 and r12, and the stopped code's in the rest
  sp = stack - 24;
  gaps += 24;
  known &= (uint16_t) ~0x100Fu;
  return_address = back;
  return_known = 1;
}

void gba_stack_interrupted(void) {
  if (!started || !interrupts) return;
  interrupts--;
  if (interrupts < NESTED) {
    sp = stopped[interrupts].sp;
    for (int r = 0; r < KEPT; r++) value[r] = stopped[interrupts].value[r];
    known = stopped[interrupts].known;
  }
  return_known = 0;
}

uint32_t gba_stack_sp(void) { return sp; }

void *gba_stack_local(int32_t at) { return (void *)(uintptr_t)(sp + (uint32_t)at); }

void gba_stack_store(int32_t at, uint32_t v, int bytes) {
  if (started) store(sp + (uint32_t)at, v, bytes);
}

uint32_t gba_stack_gaps(void) { return gaps; }
