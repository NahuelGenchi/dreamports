// What the kit answers of the IOP's kernel, as the console's emulator, Play!, answers it itself rather than running
// Sony's modules (ps2.h): the loader's RPC server, which loads a module and starts it, here a Dreamport's twin of a
// game's own module, found by the name its file gives itself or the path it's loaded from, and the threads a module
// makes that wait for each V-blank, which run when the IOP first runs in each frame, at the end of its first slice,
// after the EE's code, as the emulator runs the EE's slice and then the IOP's, and then the server threads a call woke.
//
// And the IOP's own time, for twins that say how much of it their work takes (iop_time_pass). Play! gives the IOP 600
// of its ticks after each slice of the EE's, runs its code a block at a time, takes each block's instructions, a tick
// each, from what's left as the block ends, and stops once nothing is left, so the next block runs in a later slice,
// with what the last went over taken from it. An IOP with nothing to run lets the rest of its slice go (CPS2VM::UpdateIop,
// CBasicBlock::CompileEpilog). A twin's threads then run beside the EE's code, on a stack of their own (kit_run_beside),
// so one partway through its work waits there for its time and goes on in a later slice, or a later frame.
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"

#define IOP_RAM_SIZE 0x400000
#define LOADFILE 0x80000006u
// what the loader's call 0xFF gives back, as Play! gives it for a game with no replacement modules of its own: '....'
#define LOADER_VERSION 0x2E2E2E2Eu

#define TWINS 32
static struct { const char *name; iop_start *start; } twins[TWINS];
static int twin_count;
#define WAITERS 16
static void (*waiters[WAITERS])(void);
static int waiter_count;
// the ids modules are given as they load, as Play!'s first is 1
static int32_t next_module = 1;

void iop_module_twin(const char *name, iop_start *start) {
  if (twin_count == TWINS) __builtin_trap();
  twins[twin_count].name = name;
  twins[twin_count++].start = start;
}
void iop_each_vblank(void (*thread)(void)) {
  if (waiter_count == WAITERS) __builtin_trap();
  waiters[waiter_count++] = thread;
}
// the V-blank's start wakes them, and they run when the IOP next does, at the end of the EE's slice. A V-blank that
// starts while they're still at work goes by, as one that waits for the next V-blank's start misses it
static int woken;
void iop_vblank(void) { woken = 1; }
static void threads(void) {
  if (woken) for (int i = 0; i < waiter_count; i++) waiters[i]();
  woken = 0;
  sif_iop_run();
}

// The IOP's ticks left in its slice, as Play!'s m_iopExecutionTicks, below 1 once its code went over; whether the
// Dreamport's twins keep the IOP's time; whether the threads are running beside the EE's code, which only they can wait
// in; and whether one is partway through its work, waiting for its time.
static int32_t left;
static int keeping, beside, partway;

void iop_keep_time(void) { keeping = 1; }
void iop_time_pass(uint32_t iop_ticks) {
  if (!keeping || !beside) __builtin_trap();
  left -= (int32_t)iop_ticks;
  while (left <= 0) kit_wait_beside();
}

void iop_threads(uint32_t slice) {
  left += (int32_t)slice;
  if (!keeping) threads();
  // a thread partway through goes on once its time has come, and the rest run when there's something for them
  else if (partway ? left > 0 : woken || sif_iop_waiting()) {
    beside = 1;
    partway = kit_run_beside(threads);
    beside = 0;
  }
  // the IOP idle for the rest of its slice, or its code over the slice's end by what it went over
  if (left > 0 && !partway) left = 0;
}

static int same(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return *a == *b;
}
static iop_start *twin_named(const char *name) {
  for (int i = 0; i < twin_count; i++) if (same(twins[i].name, name)) return twins[i].start;
  return 0;
}

// the name a module's file gives itself, in its .iopmod section, from where its ELF is in the IOP's memory
static const char *module_name(uint32_t at) {
  const uint8_t *file = iop_memory() + (at & (IOP_RAM_SIZE - 1));
  uint32_t sections, count, size;
  __builtin_memcpy(&sections, file + 32, 4);
  __builtin_memcpy(&count, file + 48, 2);
  count &= 0xFFFF;
  __builtin_memcpy(&size, file + 46, 2);
  size &= 0xFFFF;
  for (uint32_t i = 0; i < count; i++) {
    uint32_t type, offset;
    __builtin_memcpy(&type, file + sections + i * size + 4, 4);
    __builtin_memcpy(&offset, file + sections + i * size + 16, 4);
    if (type == 0x70000080) return (const char *)file + offset + 26;
  }
  return "";
}

// a module loaded and started: its id, or -1 when the Dreamport has no twin of it
static int32_t start(iop_start *twin) {
  if (!twin) return -1;
  int32_t id = next_module++;
  char *argv[1] = { 0 };
  twin(0, argv);
  return id;
}

static int loader(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  int32_t result[2] = { 0, 0 };
  uint32_t address, words = 1;
  switch (number) {
  case 0x00:
    // a module by its path, after two words of arguments
    result[0] = start(twin_named((const char *)arguments + 8));
    break;
  case 0x06:
    // a module the EE has put in the IOP's memory, and what its start gave back, which Play! gives as 0
    __builtin_memcpy(&address, arguments, 4);
    result[0] = start(twin_named(module_name(address)));
    words = 2;
    break;
  case 0xFF:
    result[0] = (int32_t)LOADER_VERSION;
    break;
  default:
    return 1;
  }
  if (returned_size < words * 4) words = returned_size / 4;
  __builtin_memcpy(returned, result, words * 4);
  return 1;
}

void iop_bios_power(void) {
  left = 0;
  keeping = beside = partway = 0;
  sif_register_server(LOADFILE, loader);
}
