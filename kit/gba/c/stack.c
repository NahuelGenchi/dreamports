// The console's stack, as the original's functions leave it (stack.h).
#include "stack.h"

// the registers a function saves for its caller and gives back: r4 to r11, and lr, which a call sets
enum { SAVED_FIRST = 4, SAVED_LAST = 11, LR = 14, DEPTH = 256 };

static uint32_t sp;
static uint32_t value[16];
static uint16_t known;   // a bit for each register whose value the game's C gave
static uint32_t return_address;
static int return_known;
static uint32_t gaps;
// whether a game started it: a build that never does, as the function check's, has every call cost nothing
static int started;

// each function running: the stack pointer and the saved registers as it was called
static struct { uint32_t sp, value[SAVED_LAST + 1]; uint16_t known; } calls[DEPTH];
static int depth;

static void store(uint32_t at, uint32_t v, int bytes) {
  for (int i = 0; i < bytes; i++) ((volatile uint8_t *)(uintptr_t)at)[i] = (uint8_t)(v >> (8 * i));
}

void gba_stack_start(uint32_t start) {
  started = 1;
  sp = start;
  known = 0;
  return_known = 0;
  depth = 0;
  gaps = 0;
}

void gba_stack_reg(int reg, uint32_t v) {
  value[reg] = v;
  known |= (uint16_t)(1u << reg);
}

void gba_stack_unknown(int reg) { known &= (uint16_t) ~(1u << reg); }

void gba_stack_call(uint32_t to) {
  return_address = to;
  return_known = 1;
}

uint32_t gba_stack_enter(const gba_frame *frame) {
  int lowest = 0;
  if (!started) return 0;
  if (depth < DEPTH) {
    calls[depth].sp = sp;
    for (int r = SAVED_FIRST; r <= SAVED_LAST; r++) calls[depth].value[r] = value[r];
    calls[depth].known = known;
  }
  depth++;
  for (int i = 0; i < frame->count; i++) {
    const gba_push *push = &frame->pushes[i];
    int has = !frame->unproven && (push->reg == LR ? return_known : (known >> push->reg) & 1);
    if (has) store(sp + (uint32_t)(int32_t)push->slot, push->reg == LR ? return_address : value[push->reg], 4);
    else gaps += 4;
    if (push->slot < lowest) lowest = push->slot;
  }
  return_known = 0;
  if (frame->unproven) known = 0;
  sp = sp + (uint32_t)lowest - frame->frame;
  return (uint32_t)depth;
}

void gba_stack_leave(uint32_t *entered) {
  if (!started || !*entered) return;
  depth = (int)*entered - 1;
  if (depth < DEPTH) {
    sp = calls[depth].sp;
    for (int r = SAVED_FIRST; r <= SAVED_LAST; r++) value[r] = calls[depth].value[r];
    known = calls[depth].known;
  }
  return_known = 0;
}

uint32_t gba_stack_sp(void) { return sp; }

void *gba_stack_local(int32_t at) { return (void *)(uintptr_t)(sp + (uint32_t)at); }

void gba_stack_store(int32_t at, uint32_t v, int bytes) {
  if (started) store(sp + (uint32_t)at, v, bytes);
}

uint32_t gba_stack_gaps(void) { return gaps; }
