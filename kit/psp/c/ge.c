// The graphics chip, the GE: the display lists a game hands it, each run a command at a time as the console's emulator
// in the proof tools runs them (PPSSPP's GPUCommon and its software renderer, SoftGPU), with the time the chip takes,
// the interrupt at each list's end, and the waits for a list and for all of them; each frame's draw list; and what
// the chip draws, pixel for pixel as PPSSPP's software renderer draws it.
//
// A list runs as soon as the system has it, or as far as its stall address, as PPSSPP runs it: the chip's time isn't
// the processor's, so a list that runs takes none of the calling thread's own, and the time it takes, two cycles a
// command, sixty more as it starts and ends and twenty a vertex, is when the list is done, its end's interrupt comes,
// and a thread waiting for it is woken. An interrupt that comes while a thread runs takes 2,400 of its cycles, the
// system's change to its idle thread and back, as no handler of the game's is called yet.
//
// Each command the chip runs in a frame, and the vertices and indices each draw reads, are hashed in the order run,
// the same way the tools' patch to PPSSPP hashes the original's (tools/libretro/ppsspp.patch): a game can be proven by
// its draw lists, as well as by its pictures.
//
// The chip draws rectangles in the screen's own coordinates (through mode), cleared or of one colour, with each pixel
// tested, blended, masked and dithered as PPSSPP does it, and copies blocks of memory. Triangles, textures and the
// chip's own transform of 3D vertices come later (kit/psp/c/README.md).

#include "psp-kit.h"

#define LISTS 64
#define LIST_ID_MAGIC 0x35000000
#define CALL_DEPTH 32
#define ERROR_OUT_OF_MEMORY ((int)0x80000022)
#define ERROR_INVALID_ID ((int)0x80000100)
#define ERROR_BUSY ((int)0x80000021)
#define ERROR_ALREADY ((int)0x80000020)
#define ERROR_ILLEGAL_CONTEXT ((int)0x80020064)

// a list's state, and what the system says of it
enum { DL_NONE, DL_QUEUED, DL_RUNNING, DL_COMPLETED, DL_PAUSED };
enum { LIST_COMPLETED, LIST_QUEUED, LIST_DRAWING, LIST_STALLING, LIST_PAUSED };
enum { SIGNAL_NONE = 0x00, SIGNAL_SUSPEND = 0x01, SIGNAL_CONTINUE = 0x02, SIGNAL_PAUSE = 0x03, SIGNAL_SYNC = 0x08, SIGNAL_JUMP = 0x10, SIGNAL_CALL = 0x11,
       SIGNAL_RET = 0x12, SIGNAL_RJUMP = 0x13, SIGNAL_RCALL = 0x14, SIGNAL_OJUMP = 0x15, SIGNAL_OCALL = 0x16 };
// the chip's own state as it runs
enum { RUN_RUNNING, RUN_DONE, RUN_STALL, RUN_INTERRUPT, RUN_ERROR };

// the commands, by number
enum {
  CMD_NOP = 0x00, CMD_VADDR = 0x01, CMD_IADDR = 0x02, CMD_PRIM = 0x04, CMD_BEZIER = 0x05, CMD_SPLINE = 0x06, CMD_BOUNDINGBOX = 0x07, CMD_JUMP = 0x08,
  CMD_BJUMP = 0x09, CMD_CALL = 0x0A, CMD_RET = 0x0B, CMD_END = 0x0C, CMD_SIGNAL = 0x0E, CMD_FINISH = 0x0F, CMD_BASE = 0x10, CMD_VERTEXTYPE = 0x12,
  CMD_OFFSETADDR = 0x13, CMD_ORIGIN = 0x14, CMD_REGION2 = 0x16, CMD_LIGHTINGENABLE = 0x17, CMD_LIGHTENABLE0 = 0x18, CMD_CULLFACEENABLE = 0x1D,
  CMD_TEXTUREMAPENABLE = 0x1E, CMD_DITHERENABLE = 0x20, CMD_ALPHABLENDENABLE = 0x21, CMD_ALPHATESTENABLE = 0x22, CMD_ZTESTENABLE = 0x23,
  CMD_STENCILTESTENABLE = 0x24, CMD_COLORTESTENABLE = 0x27, CMD_LOGICOPENABLE = 0x28, CMD_MATERIALAMBIENT = 0x55, CMD_MATERIALALPHA = 0x58,
  CMD_FRAMEBUFPTR = 0x9C, CMD_FRAMEBUFWIDTH = 0x9D, CMD_ZBUFPTR = 0x9E, CMD_ZBUFWIDTH = 0x9F, CMD_TRANSFERSRC = 0xB2, CMD_TRANSFERSRCW = 0xB3,
  CMD_TRANSFERDST = 0xB4, CMD_TRANSFERDSTW = 0xB5, CMD_TEXMAPMODE = 0xC0, CMD_FRAMEBUFPIXFORMAT = 0xD2, CMD_CLEARMODE = 0xD3, CMD_SCISSOR1 = 0xD4,
  CMD_SCISSOR2 = 0xD5, CMD_COLORTEST = 0xD8, CMD_COLORREF = 0xD9, CMD_COLORTESTMASK = 0xDA, CMD_ALPHATEST = 0xDB, CMD_STENCILTEST = 0xDC,
  CMD_STENCILOP = 0xDD, CMD_ZTEST = 0xDE, CMD_BLENDMODE = 0xDF, CMD_BLENDFIXEDA = 0xE0, CMD_BLENDFIXEDB = 0xE1, CMD_DITH0 = 0xE2, CMD_LOGICOP = 0xE6,
  CMD_ZWRITEDISABLE = 0xE7, CMD_MASKRGB = 0xE8, CMD_MASKALPHA = 0xE9, CMD_TRANSFERSTART = 0xEA, CMD_TRANSFERSRCPOS = 0xEB, CMD_TRANSFERDSTPOS = 0xEC,
  CMD_TRANSFERSIZE = 0xEE,
};
// a vertex's format
#define VTYPE_THROUGH 0x00800000u
enum { PRIM_POINTS, PRIM_LINES, PRIM_LINE_STRIP, PRIM_TRIANGLES, PRIM_TRIANGLE_STRIP, PRIM_TRIANGLE_FAN, PRIM_RECTANGLES, PRIM_KEEP_PREVIOUS };
enum { COMP_NEVER, COMP_ALWAYS, COMP_EQUAL, COMP_NOTEQUAL, COMP_LESS, COMP_LEQUAL, COMP_GREATER, COMP_GEQUAL };

struct call { uint32_t pc, offset, base; };
struct list {
  int state, signal, stack_depth, started, interrupted, pending_interrupt, box_result;
  uint32_t start, pc, stall, offset, token;
  uint64_t wait_until;
  struct call stack[CALL_DEPTH];
};

static uint32_t cmd[256];
static struct list lists[LISTS];
static int queue[LISTS], queued;
static struct list *current;
static int next_list;
static uint64_t starting, cycles, draw_complete;
static uint32_t cycle_last_pc, offset_addr, vertex_addr, index_addr;
static int run_state, downcount;
// the threads waiting for all lists, and for each list, in the order they began
static SceUID draw_waiting[64], list_waiting[LISTS][16];
static int draw_waiters, list_waiters[LISTS];
// the frame's draw list
static uint32_t list_hash, list_count;

// ---- the draw list -----------------------------------------------------------------------------------------------------

static void hash_bytes(uint32_t address, uint32_t length) {
  for (uint32_t i = 0; i < length; i++) list_hash = (list_hash ^ psp_read8(address + i)) * 0x01000193u;
}
static void hash_word(uint32_t word) {
  for (int i = 0; i < 4; i++) list_hash = (list_hash ^ ((word >> (8 * i)) & 0xFF)) * 0x01000193u;
  list_count++;
}
void ge_frame_starts(void) {
  list_hash = 0x811C9DC5;
  list_count = 0;
}
uint32_t ge_list_hash(void) { return list_hash; }
uint32_t ge_list_count(void) { return list_count; }

// ---- the queue ----------------------------------------------------------------------------------------------------------

static void queue_remove(int id) {
  for (int i = 0; i < queued; i++) {
    if (queue[i] != id) continue;
    for (int j = i; j < queued - 1; j++) queue[j] = queue[j + 1];
    queued--;
    i--;
  }
}
static void queue_push_front(int id) {
  for (int j = queued; j > 0; j--) queue[j] = queue[j - 1];
  queue[0] = id;
  queued++;
}
static uint32_t relative(uint32_t data) {
  uint32_t base = ((cmd[CMD_BASE] & 0x000F0000) << 8) | data;
  return (offset_addr + base) & 0x0FFFFFFF;
}
static int valid(uint32_t address) { return psp_memory(address) != 0; }

// ---- the waits -------------------------------------------------------------------------------------------------------

static int wake(SceUID *threads, int *count, int kind, int what) {
  int woke = 0;
  for (int i = 0; i < *count; i++) {
    if (thread_waits(threads[i], kind) == what) {
      thread_wake(threads[i], 0);
      woke = 1;
    }
  }
  *count = 0;
  return woke;
}
static int wake_draw(void) { return wake(draw_waiting, &draw_waiters, WAIT_GE_DRAW, 1); }
static int wake_list(int id) { return wake(list_waiting[id], &list_waiters[id], WAIT_GE_LIST, id + 1); }

static void sync_due(uint64_t data, int late);
static void interrupt_due(uint64_t data, int late);
static int process(void);

// A list's end, or all lists' end, at `at`: a draw's is moved, never earlier than it was.
static void trigger_sync(int draw, int id, uint64_t at) {
  int64_t future = (int64_t)(at - clock_now());
  uint64_t data = draw ? 0x100000000ull : (uint64_t)id;
  if (draw) {
    int64_t left = clock_left(sync_due, data);
    clock_unschedule(sync_due, data);
    if (left > future) future = left;
  }
  clock_schedule(future, sync_due, data);
}
static void sync_due(uint64_t data, int late) {
  (void)late;
  if (data == 0x100000000ull) {
    // the threads waiting for all lists are woken, and once one is, the lists that are done are forgotten
    if (wake_draw()) {
      for (int i = 0; i < LISTS; i++) if (lists[i].state == DL_COMPLETED) lists[i].state = DL_NONE;
    }
  } else wake_list((int)data);
}

// The interrupt the chip raises as a list ends: its list is done once it comes, and the next list in the queue runs.
static struct { int list; uint32_t pc, command; } pending[LISTS];
static int pendings;
static void trigger_interrupt(int id, uint32_t pc, uint64_t at) {
  pending[pendings].list = id;
  pending[pendings].pc = pc;
  pending[pendings].command = psp_read32(pc - 4) >> 24;
  pendings++;
  clock_schedule((int64_t)(at - clock_now()), interrupt_due, (uint64_t)id << 32 | pc);
}
static void interrupt_due(uint64_t data, int late) {
  (void)data;
  (void)late;
  if (!pendings) return;
  // the system changes from the running thread to its idle one to take it, and back once it's done
  kernel_interrupt_starts();
  int id = pending[0].list;
  uint32_t command = pending[0].command;
  for (int i = 0; i < pendings - 1; i++) pending[i] = pending[i + 1];
  pendings--;
  struct list *dl = &lists[id];
  if (dl->signal != SIGNAL_PAUSE && command == CMD_FINISH) dl->state = DL_COMPLETED;
  // no handler of the game's is called: the interrupt ends at once, and a list a signal suspended for its handler
  // goes back in the queue, as the system's version a program names is none
  if (dl->signal == SIGNAL_SUSPEND && dl->state != DL_NONE && dl->state != DL_COMPLETED) dl->state = DL_QUEUED;
  dl->pending_interrupt = 0;
  if (dl->state == DL_COMPLETED || dl->state == DL_NONE) {
    dl->wait_until = 0;
    wake_list(id);
    queue_remove(id);
  }
  process();
  kernel_interrupt_ends();
}

// ---- running a list ---------------------------------------------------------------------------------------------------

static void update_pc(uint32_t current_pc, uint32_t new_pc) {
  uint32_t executed = (current_pc - cycle_last_pc) / 4;
  cycles += 2 * (uint64_t)executed;
  cycle_last_pc = new_pc;
  if (current) downcount = current->stall == 0 ? 0x0FFFFFFF : (int)((current->stall - new_pc) / 4);
  else downcount = 0;
}
static void update_state(int state) {
  run_state = state;
  if (state != RUN_RUNNING) downcount = 0;
}

static void draw_prim(uint32_t op);
static void transfer(void);

static void execute_end(uint32_t op) {
  uint32_t prev = psp_read32(current->pc - 4);
  update_pc(current->pc, current->pc);
  cycles += 60;
  switch (prev >> 24) {
  case CMD_SIGNAL: {
    int behaviour = (prev >> 16) & 0xFF, signal = prev & 0xFFFF, end = op & 0xFFFF;
    int trigger = 1;
    current->token = (uint32_t)signal;
    switch (behaviour) {
    case SIGNAL_SUSPEND:
      // the system's version a program names is none, so a list stops here until its handler's done
      current->state = DL_PAUSED;
      current->signal = behaviour;
      break;
    case SIGNAL_CONTINUE:
      current->signal = behaviour;
      break;
    case SIGNAL_PAUSE: case SIGNAL_SYNC:
      trigger = 0;
      current->signal = behaviour;
      break;
    case SIGNAL_JUMP: case SIGNAL_RJUMP: case SIGNAL_OJUMP: {
      trigger = 0;
      current->signal = behaviour;
      uint32_t target = ((((uint32_t)signal << 16) | (uint32_t)end) & 0xFFFFFFFC) - 4;
      if (behaviour == SIGNAL_RJUMP) target += current->pc - 4;
      else if (behaviour == SIGNAL_OJUMP) target = relative(target);
      if (!valid(target)) update_state(RUN_ERROR);
      else {
        update_pc(current->pc, target);
        current->pc = target;
      }
      break;
    }
    case SIGNAL_CALL: case SIGNAL_RCALL: case SIGNAL_OCALL: {
      trigger = 0;
      current->signal = behaviour;
      uint32_t target = ((((uint32_t)signal << 16) | (uint32_t)end) & 0xFFFFFFFC) - 4;
      if (behaviour == SIGNAL_RCALL) target += current->pc - 4;
      else if (behaviour == SIGNAL_OCALL) target = relative(target);
      if (current->stack_depth == CALL_DEPTH) break;
      if (!valid(target)) update_state(RUN_ERROR);
      else {
        struct call *entry = &current->stack[current->stack_depth++];
        entry->pc = current->pc;
        entry->offset = offset_addr;
        entry->base = cmd[CMD_BASE];
        update_pc(current->pc, target);
        current->pc = target;
      }
      break;
    }
    case SIGNAL_RET:
      trigger = 0;
      current->signal = behaviour;
      if (current->stack_depth > 0) {
        struct call *entry = &current->stack[--current->stack_depth];
        offset_addr = entry->offset;
        cmd[CMD_BASE] = entry->base;
        update_pc(current->pc, entry->pc);
        current->pc = entry->pc;
      }
      break;
    default:
      break;
    }
    if (trigger) {
      trigger_interrupt((int)(current - lists), current->pc, starting + cycles);
      current->pending_interrupt = 1;
      update_state(RUN_INTERRUPT);
    }
    break;
  }
  case CMD_FINISH:
    switch (current->signal) {
    case SIGNAL_PAUSE:
      current->state = DL_PAUSED;
      trigger_interrupt((int)(current - lists), current->pc, starting + cycles);
      current->pending_interrupt = 1;
      update_state(RUN_INTERRUPT);
      break;
    case SIGNAL_SYNC:
      current->signal = SIGNAL_NONE;
      break;
    default:
      current->token = prev & 0xFFFF;
      update_state(RUN_DONE);
      current->started = 0;
      // every list raises an interrupt as it ends, and is done when the interrupt comes
      trigger_interrupt((int)(current - lists), current->pc, starting + cycles);
      current->pending_interrupt = 1;
      break;
    }
    break;
  default:
    break;
  }
}

static void execute(uint32_t op, uint32_t diff) {
  uint32_t command = op >> 24;
  switch (command) {
  case CMD_VADDR: vertex_addr = relative(op & 0x00FFFFFF); break;
  case CMD_IADDR: index_addr = relative(op & 0x00FFFFFF); break;
  case CMD_OFFSETADDR: offset_addr = op << 8; break;
  case CMD_ORIGIN: offset_addr = current->pc; break;
  case CMD_PRIM: draw_prim(op); break;
  case CMD_BOUNDINGBOX:
    // the chip's test of a box of vertices against the screen comes with its transform of 3D vertices
    if ((op & 0xFFFF) == 0) current->box_result = 0;
    break;
  case CMD_JUMP: case CMD_BJUMP: {
    if (command == CMD_BJUMP && current->box_result) break;
    uint32_t target = relative(op & 0x00FFFFFC);
    if (!valid(target)) {
      update_state(RUN_ERROR);
      break;
    }
    update_pc(current->pc, target - 4);
    current->pc = target - 4;
    break;
  }
  case CMD_CALL: {
    uint32_t target = relative(op & 0x00FFFFFC);
    if (!valid(target)) {
      update_state(RUN_ERROR);
      break;
    }
    if (current->stack_depth == CALL_DEPTH) break;
    struct call *entry = &current->stack[current->stack_depth++];
    entry->pc = current->pc + 4;
    entry->offset = offset_addr;
    update_pc(current->pc, target - 4);
    current->pc = target - 4;
    break;
  }
  case CMD_RET:
    if (current->stack_depth > 0) {
      struct call *entry = &current->stack[--current->stack_depth];
      offset_addr = entry->offset;
      uint32_t target = entry->pc & 0x0FFFFFFF;
      update_pc(current->pc, target - 4);
      current->pc = target - 4;
    }
    break;
  case CMD_END: execute_end(op); break;
  case CMD_TRANSFERSTART: transfer(); break;
  default: break;
  }
  (void)diff;
}
// what the emulator does with a command each time it's run, or only when it changes what was there
static int runs_always(uint32_t command) {
  switch (command) {
  case CMD_OFFSETADDR: case CMD_ORIGIN: case CMD_JUMP: case CMD_CALL: case CMD_RET: case CMD_END: case CMD_VADDR: case CMD_IADDR: case CMD_BJUMP:
  case CMD_BOUNDINGBOX: case CMD_PRIM: case CMD_TRANSFERSTART:
    return 1;
  default:
    return 0;
  }
}

static void run_loop(struct list *dl) {
  int dc = downcount;
  for (; dc > 0; --dc) {
    uint32_t op = psp_read32(dl->pc), command = op >> 24, diff = op ^ cmd[command];
    hash_word(op);
    if (diff != 0) cmd[command] = op;
    if (runs_always(command)) {
      downcount = dc;
      execute(op, diff);
      dc = downcount;
    }
    dl->pc += 4;
  }
  downcount = 0;
}

// Runs the lists in the queue, from the first, until one stalls or all are done, as PPSSPP's ProcessDLQueue does.
static int process(void) {
  starting = clock_now();
  cycles = 0;
  while (queued) {
    int id = queue[0];
    struct list *dl = &lists[id];
    if (dl->state == DL_PAUSED) return 0;
    if (dl->state == DL_NONE) {
      queue_remove(id);
      return 0;
    }
    current = dl;
    dl->started = 1;
    offset_addr = dl->offset;
    if (!valid(dl->pc)) return 0;
    cycle_last_pc = dl->pc;
    cycles += 60;
    downcount = dl->stall == 0 ? 0x0FFFFFFF : (int)((dl->stall - dl->pc) / 4);
    dl->state = DL_RUNNING;
    dl->interrupted = 0;
    run_state = dl->pc == dl->stall ? RUN_STALL : RUN_RUNNING;
    while (run_state == RUN_RUNNING) {
      if (dl->pc == dl->stall) {
        run_state = RUN_STALL;
        downcount = 0;
      }
      run_loop(dl);
      downcount = dl->stall == 0 ? 0x0FFFFFFF : (int)((dl->stall - dl->pc) / 4);
      if (run_state == RUN_STALL && dl->pc != dl->stall) run_state = RUN_RUNNING;
    }
    // the command at the list's pc hasn't run, so it isn't counted
    if (cycle_last_pc != dl->pc) update_pc(dl->pc - 4, dl->pc);
    dl->offset = offset_addr;
    if (run_state == RUN_STALL) return 0;
    if (run_state != RUN_DONE && run_state != RUN_ERROR) return -1;
    if (dl->state != DL_QUEUED) queue_remove(id);
  }
  current = 0;
  draw_complete = starting + cycles;
  trigger_sync(1, 1, draw_complete);
  return 0;
}

// ---- the system's functions --------------------------------------------------------------------------------------------

static int enqueue(uint32_t pc, uint32_t stall, int callback, uint32_t args, int head, int *run) {
  *run = 0;
  if (((pc | stall) & 3) != 0 || !valid(pc)) return PSP_ERROR_INVALID_POINTER;
  int args_valid = args && valid(args);
  if (args_valid && psp_read32(args) >= 16 && psp_read32(args + 8) >= 256) return PSP_ERROR_INVALID_SIZE;
  (void)callback;
  int id = -1;
  uint64_t now = clock_now();
  for (int i = 0; i < LISTS; i++) {
    int possible = (i + next_list) % LISTS;
    if (lists[possible].pending_interrupt) continue;
    if (lists[possible].state == DL_NONE) {
      id = possible;
      break;
    }
    if (lists[possible].state == DL_COMPLETED && lists[possible].wait_until < now) id = possible;
  }
  if (id < 0) return ERROR_OUT_OF_MEMORY;
  next_list = id + 1;
  struct list *dl = &lists[id];
  dl->start = dl->pc = pc & 0x0FFFFFFF;
  dl->stall = stall & 0x0FFFFFFF;
  dl->stack_depth = 0;
  dl->signal = SIGNAL_NONE;
  dl->interrupted = 0;
  dl->wait_until = ~0ull;
  dl->started = 0;
  dl->offset = 0;
  dl->box_result = 0;
  if (head) {
    if (current) {
      if (current->state != DL_PAUSED) return PSP_ERROR_INVALID_VALUE;
      current->state = DL_QUEUED;
      current->signal = SIGNAL_NONE;
    }
    dl->state = DL_PAUSED;
    current = dl;
    queue_push_front(id);
  } else if (current) {
    dl->state = DL_QUEUED;
    queue[queued++] = id;
  } else {
    dl->state = DL_RUNNING;
    current = dl;
    queue_push_front(id);
    draw_complete = ~0ull;
    *run = 1;
  }
  return id;
}

uint32_t sceGeEdramGetAddr(void) {
  call_starts();
  clock_spend(150);
  return (uint32_t)thread_done(PSP_VRAM);
}
uint32_t sceGeEdramGetSize(void) {
  call_starts();
  return (uint32_t)thread_done(PSP_VRAM_SIZE);
}
int sceGeListEnQueue(uint32_t list, uint32_t stall, int callback, uint32_t args) {
  call_starts();
  int run, id = enqueue(list, stall, callback * 2, args, 0, &run);
  if (id >= 0) id ^= LIST_ID_MAGIC;
  if (run) process();
  clock_spend(490);
  return thread_done(id);
}
int sceGeListEnQueueHead(uint32_t list, uint32_t stall, int callback, uint32_t args) {
  call_starts();
  int run, id = enqueue(list, stall, callback * 2, args, 1, &run);
  if (id >= 0) id ^= LIST_ID_MAGIC;
  if (run) process();
  clock_spend(480);
  return thread_done(id);
}
int sceGeListDeQueue(int list) {
  call_starts();
  int id = list ^ LIST_ID_MAGIC;
  if (id < 0 || id >= LISTS || lists[id].state == DL_NONE) return thread_answer(ERROR_INVALID_ID);
  struct list *dl = &lists[id];
  if (dl->started) return thread_answer(ERROR_BUSY);
  dl->state = DL_NONE;
  queue_remove(id);
  dl->wait_until = 0;
  wake_list(id);
  if (!queued) for (int i = 0; i < LISTS; i++) lists[i].state = DL_NONE;
  return thread_answer(0);
}
int sceGeListUpdateStallAddr(int list, uint32_t stall) {
  call_starts();
  clock_spend(190);
  int id = list ^ LIST_ID_MAGIC;
  if (id < 0 || id >= LISTS || lists[id].state == DL_NONE) return thread_done(ERROR_INVALID_ID);
  if (lists[id].state == DL_COMPLETED) return thread_done(ERROR_ALREADY);
  lists[id].stall = stall & 0x0FFFFFFF;
  process();
  return thread_done(0);
}
int sceGeListSync(int list, int mode) {
  call_starts();
  clock_spend(220);
  int id = list ^ LIST_ID_MAGIC;
  if (id < 0 || id >= LISTS) return thread_done(ERROR_INVALID_ID);
  if (mode < 0 || mode > 1) return thread_done(PSP_ERROR_INVALID_MODE);
  struct list *dl = &lists[id];
  if (mode == 1) {
    switch (dl->state) {
    case DL_QUEUED: return thread_done(dl->interrupted ? LIST_PAUSED : LIST_QUEUED);
    case DL_RUNNING: return thread_done(dl->pc == dl->stall ? LIST_STALLING : LIST_DRAWING);
    case DL_COMPLETED: return thread_done(LIST_COMPLETED);
    case DL_PAUSED: return thread_done(LIST_PAUSED);
    default: return thread_done(ERROR_INVALID_ID);
    }
  }
  if (dl->wait_until > clock_now()) {
    list_waiting[id][list_waiters[id]++] = thread_current();
    thread_wait(WAIT_GE_LIST, id + 1, 0);
    return thread_answer(LIST_COMPLETED);
  }
  return thread_done(LIST_COMPLETED);
}
int sceGeDrawSync(int mode) {
  call_starts();
  clock_spend(1240);
  if (mode < 0 || mode > 1) return thread_done(PSP_ERROR_INVALID_MODE);
  if (mode == 0) {
    if (draw_complete > clock_now()) {
      draw_waiting[draw_waiters++] = thread_current();
      thread_wait(WAIT_GE_DRAW, 1, 0);
      return thread_answer(0);
    }
    for (int i = 0; i < LISTS; i++) if (lists[i].state == DL_COMPLETED) lists[i].state = DL_NONE;
    return thread_done(0);
  }
  struct list *top = 0;
  for (int i = 0; i < queued; i++) {
    if (lists[queue[i]].state != DL_COMPLETED) {
      top = &lists[queue[i]];
      break;
    }
  }
  if (!top || top->state == DL_COMPLETED) return thread_done(LIST_COMPLETED);
  if (current && current->pc == current->stall) return thread_done(LIST_STALLING);
  return thread_done(LIST_DRAWING);
}

void ge_power(void) {
  for (int i = 0; i < 256; i++) cmd[i] = (uint32_t)i << 24;
  for (int i = 0; i < LISTS; i++) lists[i] = (struct list){ 0 };
  queued = 0;
  current = 0;
  next_list = 0;
  starting = cycles = 0;
  draw_complete = 0;
  offset_addr = vertex_addr = index_addr = 0;
  draw_waiters = 0;
  for (int i = 0; i < LISTS; i++) list_waiters[i] = 0;
  pendings = 0;
  ge_frame_starts();
}

// ---- vertices ------------------------------------------------------------------------------------------------------------

static const uint8_t TC_SIZE[4] = { 0, 2, 4, 8 }, TC_ALIGN[4] = { 0, 1, 2, 4 };
static const uint8_t COL_SIZE[8] = { 0, 0, 0, 0, 2, 2, 2, 4 }, COL_ALIGN[8] = { 0, 0, 0, 0, 2, 2, 2, 4 };
static const uint8_t NRM_SIZE[4] = { 0, 3, 6, 12 }, NRM_ALIGN[4] = { 0, 1, 2, 4 };
static const uint8_t POS_SIZE[4] = { 3, 3, 6, 12 }, POS_ALIGN[4] = { 1, 1, 2, 4 };
static const uint8_t WT_SIZE[4] = { 0, 1, 2, 4 }, WT_ALIGN[4] = { 0, 1, 2, 4 };

struct layout { uint32_t size, col_at, pos_at; int tc, col, nrm, pos; };
static uint32_t align_to(uint32_t n, uint32_t to) { return to ? (n + to - 1) & ~(to - 1) : n; }
// where each part of a vertex is, as the chip reads it: each part at a multiple of its own size, in this order
static struct layout layout_of(uint32_t vtype) {
  struct layout l = { 0 };
  uint32_t size = 0, biggest = 0;
  int weight = (vtype >> 9) & 3, weights = ((vtype >> 14) & 7) + 1, morphs = ((vtype >> 18) & 7) + 1;
  l.tc = vtype & 3;
  l.col = (vtype >> 2) & 7;
  l.nrm = (vtype >> 5) & 3;
  l.pos = (vtype >> 7) & 3;
  if (weight) {
    size += WT_SIZE[weight] * (uint32_t)weights;
    if (WT_ALIGN[weight] > biggest) biggest = WT_ALIGN[weight];
  }
  if (l.tc) {
    size = align_to(size, TC_ALIGN[l.tc]) + TC_SIZE[l.tc];
    if (TC_ALIGN[l.tc] > biggest) biggest = TC_ALIGN[l.tc];
  }
  if (l.col) {
    size = align_to(size, COL_ALIGN[l.col]);
    l.col_at = size;
    size += COL_SIZE[l.col];
    if (COL_ALIGN[l.col] > biggest) biggest = COL_ALIGN[l.col];
  }
  if (l.nrm) {
    size = align_to(size, NRM_ALIGN[l.nrm]) + NRM_SIZE[l.nrm];
    if (NRM_ALIGN[l.nrm] > biggest) biggest = NRM_ALIGN[l.nrm];
  }
  size = align_to(size, POS_ALIGN[l.pos]);
  l.pos_at = size;
  size += POS_SIZE[l.pos];
  if (POS_ALIGN[l.pos] > biggest) biggest = POS_ALIGN[l.pos];
  l.size = align_to(size, biggest) * (uint32_t)morphs;
  return l;
}

static uint32_t from_565(uint16_t c) {
  uint32_t rb = ((c & 0x1F) << 3) | ((uint32_t)(c & 0xF800) << 8);
  rb |= (rb >> 5) & 0x070007;
  uint32_t g = (uint32_t)(c & 0x7E0) << 5;
  g |= (g >> 6) & 0x300;
  return rb | g | 0xFF000000;
}
static uint32_t from_5551(uint16_t c) {
  uint32_t dark = ((c & 0x1F) << 3) | ((uint32_t)(c & 0x3E0) << 6) | ((uint32_t)(c & 0x7C00) << 9);
  uint32_t full = dark | ((dark >> 5) & 0x070707);
  if (c >> 15) full |= 0xFF000000;
  return full;
}
static uint32_t from_4444(uint16_t c) {
  uint32_t v = (c & 0x000F) | ((uint32_t)(c & 0x00F0) << 4) | ((uint32_t)(c & 0x0F00) << 8) | ((uint32_t)(c & 0xF000) << 12);
  return v | (v << 4);
}
static uint16_t to_565(uint32_t v) { return (uint16_t)(((v >> 3) & 0x1F) | ((v >> 5) & (0x3F << 5)) | ((v >> 8) & (0x1F << 11))); }
static uint16_t to_5551(uint32_t v) { return (uint16_t)(((v >> 3) & 0x1F) | ((v >> 6) & (0x1F << 5)) | ((v >> 9) & (0x1F << 10)) | ((v >> 16) & 0x8000)); }
static uint16_t to_4444(uint32_t v) {
  uint32_t c = v >> 4;
  return (uint16_t)((c & 0x000F) | ((c >> 4) & 0x00F0) | ((c >> 8) & 0x0F00) | ((c >> 12) & 0xF000));
}

struct vertex { int x, y, z; uint32_t color; };
static struct vertex read_vertex(uint32_t at, const struct layout *l) {
  struct vertex v = { 0 };
  if (l->pos == 2) {
    int16_t x = (int16_t)psp_read16(at + l->pos_at), y = (int16_t)psp_read16(at + l->pos_at + 2);
    float fx = x, fy = y;
    v.x = (int)(fx * 16);
    v.y = (int)(fy * 16);
    v.z = psp_read16(at + l->pos_at + 4);
  } else if (l->pos == 3) {
    float f[3];
    uint32_t words[3] = { psp_read32(at + l->pos_at), psp_read32(at + l->pos_at + 4), psp_read32(at + l->pos_at + 8) };
    __builtin_memcpy(f, words, 12);
    float z = f[2] > 65535.0f ? 65535.0f : (f[2] < 0.0f ? 0.0f : f[2]);
    v.x = (int)(f[0] * 16);
    v.y = (int)(f[1] * 16);
    v.z = (int)z;
  }
  switch (l->col) {
  case 4: v.color = from_565(psp_read16(at + l->col_at)); break;
  case 5: v.color = from_5551(psp_read16(at + l->col_at)); break;
  case 6: v.color = from_4444(psp_read16(at + l->col_at)); break;
  case 7: v.color = psp_read32(at + l->col_at); break;
  default: v.color = (cmd[CMD_MATERIALAMBIENT] & 0x00FFFFFF) | (cmd[CMD_MATERIALALPHA] << 24); break;
  }
  return v;
}

// ---- pixels ----------------------------------------------------------------------------------------------------------------

// what PPSSPP's software renderer works each pixel out with, from the chip's state (its ComputePixelFuncID)
struct pixel_state {
  int clear, color_clear, stencil_clear, depth_clear, format, stride, depth_stride, dither, write_mask_on;
  int color_test, stencil_test, depth_write, depth_func, alpha_func, alpha_ref, alpha_mask, stencil_func, stencil_ref, stencil_mask, has_stencil_mask;
  int sfail, zfail, zpass, blend, blend_eq, blend_src, blend_dst, logic_op, early_z;
  uint32_t write_mask, fix_a, fix_b, color_func, color_ref, color_mask, fb, zb;
  int8_t dither_matrix[16];
};

static int optimize_compare(int func, int ref) {
  if (ref == 255) {
    if (func == COMP_GREATER) return COMP_NEVER;
    if (func == COMP_LEQUAL) return COMP_ALWAYS;
  } else if (ref == 0) {
    if (func == COMP_LESS) return COMP_NEVER;
    if (func == COMP_GEQUAL) return COMP_ALWAYS;
  }
  return func;
}

static struct pixel_state pixel_state_now(void) {
  struct pixel_state s = { 0 };
  int format = cmd[CMD_FRAMEBUFPIXFORMAT] & 3;
  s.format = format;
  s.fb = 0x44000000 | (cmd[CMD_FRAMEBUFPTR] & 0x1FFFF0);
  s.zb = 0x44600000 | (cmd[CMD_ZBUFPTR] & 0x1FFFF0);
  s.stride = cmd[CMD_FRAMEBUFWIDTH] & 0x7FC;
  s.depth_stride = cmd[CMD_ZBUFWIDTH] & 0x7FC;
  s.dither = cmd[CMD_DITHERENABLE] & 1;
  uint32_t color_mask = (cmd[CMD_MASKRGB] & 0xFFFFFF) | ((cmd[CMD_MASKALPHA] & 0xFF) << 24);
  s.write_mask_on = color_mask != 0;
  s.clear = cmd[CMD_CLEARMODE] & 1;
  int depth_on = cmd[CMD_ZTESTENABLE] & 1;
  if (s.clear) {
    s.color_clear = (cmd[CMD_CLEARMODE] & 0x100) != 0;
    s.stencil_clear = (cmd[CMD_CLEARMODE] & 0x200) != 0;
    s.depth_clear = (cmd[CMD_CLEARMODE] & 0x400) != 0;
    s.stencil_test = s.stencil_clear && format != PSP_FORMAT_565;
    s.depth_func = COMP_ALWAYS;
    s.alpha_func = COMP_ALWAYS;
  } else {
    int stencil_on = cmd[CMD_STENCILTESTENABLE] & 1, stencil_func = cmd[CMD_STENCILTEST] & 7;
    int sfail = cmd[CMD_STENCILOP] & 7, zfail = (cmd[CMD_STENCILOP] >> 8) & 7, zpass = (cmd[CMD_STENCILOP] >> 16) & 7;
    int depth_func = cmd[CMD_ZTEST] & 7;
    s.color_test = (cmd[CMD_COLORTESTENABLE] & 1) && (cmd[CMD_COLORTEST] & 3) != COMP_ALWAYS;
    if (stencil_on && stencil_func == COMP_ALWAYS) {
      int stencil_write = (cmd[CMD_MASKALPHA] & 0xFF) != 0xFF && format != PSP_FORMAT_565;
      if (depth_on && depth_func != COMP_ALWAYS) s.stencil_test = stencil_write && (zpass != 0 || zfail != 0);
      else s.stencil_test = stencil_write && zpass != 0;
    } else s.stencil_test = stencil_on;
    s.depth_write = depth_on && !(cmd[CMD_ZWRITEDISABLE] & 1);
    s.depth_func = depth_on ? depth_func : COMP_ALWAYS;
    if (s.stencil_test) {
      int ref = (cmd[CMD_STENCILTEST] >> 8) & 0xFF, mask = (cmd[CMD_STENCILTEST] >> 16) & 0xFF;
      s.stencil_ref = ref & mask;
      s.stencil_func = optimize_compare(stencil_func, s.stencil_ref);
      s.has_stencil_mask = mask != 0xFF && format != PSP_FORMAT_565;
      s.stencil_mask = mask;
      // stencil can't be written on 565, and an op past DECR keeps what's there
      if (format != PSP_FORMAT_565 && sfail <= 5) s.sfail = sfail;
      if (format != PSP_FORMAT_565 && zfail <= 5) s.zfail = depth_on ? zfail : 0;
      if (format != PSP_FORMAT_565 && zpass <= 5) s.zpass = zpass;
      if (ref == 0) {
        if (s.sfail == 2) s.sfail = 1;
        if (s.zfail == 2) s.zfail = 1;
        if (s.zpass == 2) s.zpass = 1;
      }
      if (format == PSP_FORMAT_5551) {
        if (s.sfail == 5) s.sfail = 1;
        if (s.zfail == 5) s.zfail = 1;
        if (s.zpass == 5) s.zpass = 1;
      }
      if (s.stencil_func == COMP_ALWAYS) {
        if (s.depth_func == COMP_ALWAYS) s.zfail = 0;
        s.sfail = 0;
        s.stencil_ref = ref;
        s.has_stencil_mask = 0;
        if (!s.sfail && !s.zfail && !s.zpass) {
          s.stencil_test = 0;
          s.stencil_func = 0;
          s.stencil_ref = 0;
        }
      } else if (s.depth_func == COMP_ALWAYS) s.zfail = s.zpass;
    }
    s.alpha_func = (cmd[CMD_ALPHATESTENABLE] & 1) ? (int)(cmd[CMD_ALPHATEST] & 7) : COMP_ALWAYS;
    if (s.alpha_func != COMP_ALWAYS) {
      int ref = (cmd[CMD_ALPHATEST] >> 8) & 0xFF, mask = (cmd[CMD_ALPHATEST] >> 16) & 0xFF;
      s.alpha_ref = ref & mask;
      s.alpha_mask = mask;
      s.alpha_func = optimize_compare(s.alpha_func, s.alpha_ref);
      if (s.alpha_func == COMP_ALWAYS) {
        s.alpha_ref = 0;
        s.alpha_mask = 0xFF;
      }
    }
    int eq = (cmd[CMD_BLENDMODE] >> 8) & 7;
    s.blend = (cmd[CMD_ALPHABLENDENABLE] & 1) && eq <= 5;
    s.blend_eq = eq;
    s.blend_src = cmd[CMD_BLENDMODE] & 0xF;
    s.blend_dst = (cmd[CMD_BLENDMODE] >> 4) & 0xF;
    s.fix_a = cmd[CMD_BLENDFIXEDA] & 0xFFFFFF;
    s.fix_b = cmd[CMD_BLENDFIXEDB] & 0xFFFFFF;
    s.logic_op = (cmd[CMD_LOGICOPENABLE] & 1) && (cmd[CMD_LOGICOP] & 0xF) != 3 ? (int)(cmd[CMD_LOGICOP] & 0xF) : -1;
    s.early_z = s.depth_func != COMP_ALWAYS;
    if (s.stencil_test && s.early_z && (s.sfail || s.zfail)) s.early_z = 0;
    if (s.color_test) {
      s.color_func = cmd[CMD_COLORTEST] & 3;
      s.color_mask = cmd[CMD_COLORTESTMASK] & 0xFFFFFF;
      s.color_ref = cmd[CMD_COLORREF] & 0xFFFFFF & s.color_mask;
    }
  }
  if (s.dither) {
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        uint8_t raw = (cmd[CMD_DITH0 + y] >> (x * 4)) & 0xF;
        s.dither_matrix[y * 4 + x] = (int8_t)((int8_t)(raw << 4) >> 4);
      }
    }
  }
  if (s.write_mask_on) {
    uint32_t mask = color_mask;
    if (!s.stencil_test) mask |= 0xFF000000;
    switch (format) {
    case PSP_FORMAT_565: s.write_mask = to_565(mask); break;
    case PSP_FORMAT_5551: s.write_mask = to_5551(mask); break;
    case PSP_FORMAT_4444: s.write_mask = to_4444(mask); break;
    default: s.write_mask = mask; break;
    }
  }
  return s;
}

static uint32_t fb_at(const struct pixel_state *s, int x, int y) { return s->fb + (uint32_t)(y * s->stride + x) * (s->format == PSP_FORMAT_8888 ? 4 : 2); }
static uint32_t zb_at(const struct pixel_state *s, int x, int y) { return s->zb + (uint32_t)(y * s->depth_stride + x) * 2; }

static uint8_t get_stencil(const struct pixel_state *s, int x, int y) {
  switch (s->format) {
  case PSP_FORMAT_565: return 0;
  case PSP_FORMAT_5551: return (psp_read16(fb_at(s, x, y)) & 0x8000) ? 0xFF : 0;
  case PSP_FORMAT_4444: return (uint8_t)((psp_read16(fb_at(s, x, y)) >> 12) * 17);
  default: return (uint8_t)(psp_read32(fb_at(s, x, y)) >> 24);
  }
}
static void set_stencil(const struct pixel_state *s, uint32_t write_mask, int x, int y, uint8_t value) {
  uint32_t at = fb_at(s, x, y);
  if (s->format == PSP_FORMAT_5551) {
    if ((write_mask & 0x8000) == 0) psp_write16(at, (uint16_t)((psp_read16(at) & ~0x8000) | ((value & 0x80) << 8)));
  } else if (s->format == PSP_FORMAT_4444) {
    uint16_t keep = (uint16_t)(write_mask | 0x0FFF);
    psp_write16(at, (uint16_t)((psp_read16(at) & keep) | (((uint16_t)value << 8) & ~keep)));
  } else if (s->format == PSP_FORMAT_8888) {
    uint32_t keep = write_mask | 0x00FFFFFF;
    psp_write32(at, (psp_read32(at) & keep) | (((uint32_t)value << 24) & ~keep));
  }
}
static uint32_t get_color(const struct pixel_state *s, int x, int y) {
  switch (s->format) {
  case PSP_FORMAT_565: return from_565(psp_read16(fb_at(s, x, y))) & 0x00FFFFFF;
  case PSP_FORMAT_5551: return from_5551(psp_read16(fb_at(s, x, y)));
  case PSP_FORMAT_4444: return from_4444(psp_read16(fb_at(s, x, y)));
  default: return psp_read32(fb_at(s, x, y));
  }
}
static void set_color(const struct pixel_state *s, int x, int y, uint32_t value, uint32_t old, uint32_t write_mask) {
  uint32_t at = fb_at(s, x, y);
  switch (s->format) {
  case PSP_FORMAT_565: {
    uint32_t v = to_565(value);
    if (write_mask) v = (v & ~write_mask) | (to_565(old) & write_mask);
    psp_write16(at, (uint16_t)v);
    break;
  }
  case PSP_FORMAT_5551: {
    uint32_t v = to_5551(value);
    if (write_mask) v = (v & ~write_mask) | (to_5551(old) & write_mask);
    psp_write16(at, (uint16_t)v);
    break;
  }
  case PSP_FORMAT_4444: {
    uint32_t v = to_4444(value);
    if (write_mask) v = (v & ~write_mask) | (to_4444(old) & write_mask);
    psp_write16(at, (uint16_t)v);
    break;
  }
  default:
    psp_write32(at, (value & ~write_mask) | (old & write_mask));
    break;
  }
}

static int compare(int func, int a, int b) {
  switch (func) {
  case COMP_NEVER: return 0;
  case COMP_ALWAYS: return 1;
  case COMP_EQUAL: return a == b;
  case COMP_NOTEQUAL: return a != b;
  case COMP_LESS: return a < b;
  case COMP_LEQUAL: return a <= b;
  case COMP_GREATER: return a > b;
  case COMP_GEQUAL: return a >= b;
  }
  return 1;
}
static uint8_t stencil_op(int format, uint8_t replace, int op, uint8_t old) {
  switch (op) {
  case 0: return old;
  case 1: return 0;
  case 2: return replace;
  case 3: return (uint8_t)~old;
  case 4:
    if (format == PSP_FORMAT_8888) return old != 0xFF ? (uint8_t)(old + 1) : old;
    if (format == PSP_FORMAT_5551) return 0xFF;
    if (format == PSP_FORMAT_4444) return old < 0xF0 ? (uint8_t)(old + 0x10) : old;
    return old;
  case 5:
    if (format == PSP_FORMAT_4444) return old >= 0x10 ? (uint8_t)(old - 0x10) : old;
    if (format == PSP_FORMAT_5551) return 0;
    return old != 0 ? (uint8_t)(old - 1) : old;
  }
  return old;
}
static uint32_t logic(int op, uint32_t old, uint32_t c) {
  switch (op) {
  case 0: return c & 0xFF000000;
  case 1: return c & (old | 0xFF000000);
  case 2: return c & (~old | 0xFF000000);
  case 3: return c;
  case 4: return (~c & (old & 0x00FFFFFF)) | (c & 0xFF000000);
  case 5: return (old & 0x00FFFFFF) | (c & 0xFF000000);
  case 6: return c ^ (old & 0x00FFFFFF);
  case 7: return c | (old & 0x00FFFFFF);
  case 8: return (~(c | old) & 0x00FFFFFF) | (c & 0xFF000000);
  case 9: return (~(c ^ old) & 0x00FFFFFF) | (c & 0xFF000000);
  case 10: return (~old & 0x00FFFFFF) | (c & 0xFF000000);
  case 11: return c | (~old & 0x00FFFFFF);
  case 12: return (~c & 0x00FFFFFF) | (c & 0xFF000000);
  case 13: return ((~c | old) & 0x00FFFFFF) | (c & 0xFF000000);
  case 14: return (~(c & old) & 0x00FFFFFF) | (c & 0xFF000000);
  case 15: return c | 0x00FFFFFF;
  }
  return c;
}

static int clamp255(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
static int channel(uint32_t c, int i) { return (int)((c >> (8 * i)) & 0xFF); }

// a blend factor for each of red, green and blue: the source's is `source`, the other's `other`
static void factor(int which, int is_src, const int src[4], const int dst[4], uint32_t fix, int out[3]) {
  for (int i = 0; i < 3; i++) {
    const int *other = is_src ? dst : src;
    int v;
    switch (which) {
    case 0: v = other[i]; break;
    case 1: v = 255 - other[i]; break;
    case 2: v = src[3]; break;
    case 3: v = 255 - src[3]; break;
    case 4: v = dst[3]; break;
    case 5: v = 255 - dst[3]; break;
    case 6: v = 2 * src[3]; break;
    case 7: v = 255 - (2 * src[3] < 255 ? 2 * src[3] : 255); break;
    case 8: v = 2 * dst[3]; break;
    case 9: v = 255 - (2 * dst[3] < 255 ? 2 * dst[3] : 255); break;
    default: v = channel(fix, i); break;
    }
    out[i] = v;
  }
}
static void blend(const struct pixel_state *s, const int src[4], const int dst[4], int out[3]) {
  int sf[3], df[3];
  factor(s->blend_src, 1, src, dst, s->fix_a, sf);
  factor(s->blend_dst, 0, src, dst, s->fix_b, df);
  for (int i = 0; i < 3; i++) {
    int lhs = ((src[i] * 2 + 1) * (sf[i] * 2 + 1)) / 1024, rhs = ((dst[i] * 2 + 1) * (df[i] * 2 + 1)) / 1024;
    switch (s->blend_eq) {
    case 0: out[i] = lhs + rhs; break;
    case 1: out[i] = lhs - rhs; break;
    case 2: out[i] = rhs - lhs; break;
    case 3: out[i] = src[i] < dst[i] ? src[i] : dst[i]; break;
    case 4: out[i] = src[i] > dst[i] ? src[i] : dst[i]; break;
    case 5: out[i] = src[i] > dst[i] ? src[i] - dst[i] : dst[i] - src[i]; break;
    default: out[i] = src[i]; break;
    }
  }
}

// one pixel, as PPSSPP's DrawSinglePixel works it out, with the depth test first where PPSSPP's rasterizer does it
// before the pixel's other tests
static void draw_pixel(const struct pixel_state *s, int x, int y, int z, uint32_t color) {
  if (s->early_z && !compare(s->depth_func, z, psp_read16(zb_at(s, x, y)))) return;
  int c[4] = { channel(color, 0), channel(color, 1), channel(color, 2), channel(color, 3) };
  if (!s->clear && s->alpha_func != COMP_ALWAYS) {
    int alpha = c[3] & s->alpha_mask;
    if (!compare(s->alpha_func, alpha, s->alpha_ref)) return;
  }
  if (!s->clear && s->color_test) {
    uint32_t rgb = ((uint32_t)c[0] | ((uint32_t)c[1] << 8) | ((uint32_t)c[2] << 16)) & s->color_mask;
    if (s->color_func == COMP_NEVER) return;
    if (s->color_func == COMP_EQUAL && rgb != s->color_ref) return;
    if (s->color_func == COMP_NOTEQUAL && rgb == s->color_ref) return;
  }
  uint32_t write_mask = s->write_mask_on ? s->write_mask : 0;
  uint8_t stencil = s->clear ? (uint8_t)c[3] : get_stencil(s, x, y);
  if (s->clear) {
    if (s->depth_clear) psp_write16(zb_at(s, x, y), (uint16_t)z);
  } else if (s->stencil_test) {
    uint8_t replace = s->has_stencil_mask ? (uint8_t)((cmd[CMD_STENCILTEST] >> 8) & 0xFF) : (uint8_t)s->stencil_ref;
    uint8_t tested = s->has_stencil_mask ? (uint8_t)(stencil & s->stencil_mask) : stencil;
    if (!compare(s->stencil_func, s->stencil_ref, tested)) {
      set_stencil(s, write_mask, x, y, stencil_op(s->format, replace, s->sfail, stencil));
      return;
    }
    if (!s->early_z && s->depth_func != COMP_ALWAYS && !compare(s->depth_func, z, psp_read16(zb_at(s, x, y)))) {
      set_stencil(s, write_mask, x, y, stencil_op(s->format, replace, s->zfail, stencil));
      return;
    }
    stencil = stencil_op(s->format, replace, s->zpass, stencil);
  } else if (!s->early_z) {
    if (s->depth_func != COMP_ALWAYS && !compare(s->depth_func, z, psp_read16(zb_at(s, x, y)))) return;
  }
  if (s->depth_write && !s->clear) psp_write16(zb_at(s, x, y), (uint16_t)z);
  uint32_t old = get_color(s, x, y), next;
  if (s->blend && !s->clear) {
    int dst[4] = { channel(old, 0), channel(old, 1), channel(old, 2), channel(old, 3) }, out[3];
    blend(s, c, dst, out);
    if (s->dither) for (int i = 0; i < 3; i++) out[i] += s->dither_matrix[(y & 3) * 4 + (x & 3)];
    next = (uint32_t)clamp255(out[0]) | ((uint32_t)clamp255(out[1]) << 8) | ((uint32_t)clamp255(out[2]) << 16) | ((uint32_t)stencil << 24);
  } else {
    if (s->dither) for (int i = 0; i < 3; i++) c[i] += s->dither_matrix[(y & 3) * 4 + (x & 3)];
    next = (uint32_t)clamp255(c[0]) | ((uint32_t)clamp255(c[1]) << 8) | ((uint32_t)clamp255(c[2]) << 16) | ((uint32_t)stencil << 24);
  }
  if (!s->clear && s->logic_op >= 0) next = logic(s->logic_op, old, next);
  if (s->clear) {
    if (!s->color_clear) next = (next & 0xFF000000) | (old & 0x00FFFFFF);
    if (!s->stencil_clear) next = (next & 0x00FFFFFF) | (old & 0xFF000000);
  }
  set_color(s, x, y, next, old, write_mask);
}

// a pixel of a sprite drawn the quick way (PPSSPP's DrawSinglePixel for sprites): its colour as it is, or blended by
// its alpha, with the alpha or stencil that was there kept
static void single_pixel(const struct pixel_state *s, int x, int y, uint32_t color) {
  uint32_t at = fb_at(s, x, y), old = s->format == PSP_FORMAT_8888 ? psp_read32(at) : psp_read16(at), next;
  int alpha = channel(color, 3);
  if (!s->blend || alpha == 255) next = color & 0xFFFFFF;
  else {
    uint32_t dst = s->format == PSP_FORMAT_565 ? from_565((uint16_t)old) : s->format == PSP_FORMAT_5551 ? from_5551((uint16_t)old) :
      s->format == PSP_FORMAT_4444 ? from_4444((uint16_t)old) : old;
    next = 0;
    for (int i = 0; i < 3; i++) {
      int v = ((channel(color, i) * 2 + 1) * (alpha * 2 + 1)) / 1024 + ((channel(dst, i) * 2 + 1) * ((255 - alpha) * 2 + 1)) / 1024;
      next |= (uint32_t)clamp255(v) << (8 * i);
    }
  }
  switch (s->format) {
  case PSP_FORMAT_565: psp_write16(at, to_565(next)); break;
  case PSP_FORMAT_5551: psp_write16(at, (uint16_t)((to_5551(next) & 0x7FFF) | (old & 0x8000))); break;
  case PSP_FORMAT_4444: psp_write16(at, (uint16_t)((to_4444(next) & 0x0FFF) | (old & 0xF000))); break;
  default: psp_write32(at, next | (old & 0xFF000000)); break;
  }
}

// ---- rectangles ---------------------------------------------------------------------------------------------------------

// the scissor, in the 16ths of a pixel the chip places things in
struct range { int x1, y1, x2, y2; };
static struct range scissor_range(void) {
  int sx1 = cmd[CMD_SCISSOR1] & 0x3FF, sy1 = (cmd[CMD_SCISSOR1] >> 10) & 0x3FF;
  int sx2 = cmd[CMD_SCISSOR2] & 0x3FF, sy2 = (cmd[CMD_SCISSOR2] >> 10) & 0x3FF;
  int rx2 = cmd[CMD_REGION2] & 0x3FF, ry2 = (cmd[CMD_REGION2] >> 10) & 0x3FF;
  if (rx2 < sx2) sx2 = rx2;
  if (ry2 < sy2) sy2 = ry2;
  return (struct range){ sx1 * 16, sy1 * 16, sx2 * 16 + 15, sy2 * 16 + 15 };
}
static int min_int(int a, int b) { return a < b ? a : b; }
static int max_int(int a, int b) { return a > b ? a : b; }

// a rectangle from v0 to v1, which the chip draws in one colour, v1's
static void draw_rect(const struct vertex *v0, const struct vertex *v1) {
  struct range scissor = scissor_range();
  struct range r = { min_int(v0->x, v1->x) & ~15, min_int(v0->y, v1->y) & ~15, max_int(v0->x, v1->x) | 15, max_int(v0->y, v1->y) | 15 };
  r.x1 = max_int(r.x1, scissor.x1);
  r.y1 = max_int(r.y1, scissor.y1);
  r.x2 = min_int(r.x2, scissor.x2);
  r.y2 = min_int(r.y2, scissor.y2);
  if (r.x2 < r.x1 || r.y2 < r.y1) return;
  struct pixel_state s = pixel_state_now();
  int z = v1->z & 0xFFFF, alpha = channel(v1->color, 3);
  int standard_blend = s.blend && s.blend_eq == 0 && s.blend_src == 2 && s.blend_dst == 3;
  // PPSSPP's renderer turns the alpha test on for a rectangle blended by its alpha that's wholly see-through, and
  // so draws none of it, which only shows where it would be dithered or have a logic op
  int see_through = !s.clear && standard_blend && s.alpha_func == COMP_ALWAYS && !s.depth_write && !s.stencil_test && alpha == 0;
  int subpixel = ((v0->x | v0->y | v1->x | v1->y) & 0xF) != 0;
  int fast = !s.clear && v1->x >= v0->x && v1->y >= v0->y && !subpixel && !(cmd[CMD_TEXTUREMAPENABLE] & 1);
  if (fast) {
    // a sprite: from the first corner's pixel up to the second's, less any outside the scissor
    int x0 = v0->x / 16, y0 = v0->y / 16, x1 = (v1->x + 7) / 16, y1 = (v1->y + 7) / 16;
    int tlx = r.x1 / 16, tly = r.y1 / 16, brx = r.x2 / 16, bry = r.y2 / 16;
    if (x1 > brx) x1 = brx + 1;
    if (y1 > bry) y1 = bry + 1;
    if (x0 < tlx) x0 = tlx;
    if (y0 < tly) y0 = tly;
    // with nothing but blending by alpha, or nothing at all, each pixel is written straight, keeping what alpha or
    // stencil was there, and the alpha test is skipped where it could only fail for a pixel blending leaves as it was
    int needless_alpha_test = s.alpha_func == COMP_ALWAYS ||
      ((s.alpha_func == COMP_NOTEQUAL || s.alpha_func == COMP_GREATER || s.alpha_func == COMP_GEQUAL) && s.alpha_ref == 0 && s.alpha_mask == 0xFF);
    int single = !s.color_test && !s.stencil_test && needless_alpha_test && s.depth_func == COMP_ALWAYS && (!s.blend || standard_blend) && !s.depth_write &&
      !s.dither && s.logic_op < 0 && !s.write_mask_on;
    if (single) {
      if (s.blend && alpha == 0) return;
      for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) single_pixel(&s, x, y, v1->color);
      return;
    }
    if (see_through) return;
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) draw_pixel(&s, x, y, z, v1->color);
    return;
  }
  if (see_through) return;
  int entire_x1 = min_int(v0->x, v1->x), entire_y1 = min_int(v0->y, v1->y);
  int entire_x2 = max_int(v0->x, v1->x) - 1, entire_y2 = max_int(v0->y, v1->y) - 1;
  int min_x = max_int(entire_x1 & ~15, r.x1) | 7, min_y = max_int(entire_y1 & ~15, r.y1) | 7;
  int max_x = min_int(entire_x2, r.x2), max_y = min_int(entire_y2, r.y2);
  if (min_x < entire_x1 - 1) min_x += 16;
  if (min_y < entire_y1 - 1) min_y += 16;
  if (s.clear && !s.dither) {
    // a clear, every pixel from the first to the last whose middle is inside
    int px = min_x / 16, py = min_y / 16, ex = (max_x - 8) / 16, ey = (max_y - 8) / 16;
    if (ex - px + 1 <= 0) return;
    for (int y = py; y <= ey; y++) for (int x = px; x <= ex; x++) draw_pixel(&s, x, y, z, v1->color);
    return;
  }
  for (int cy = min_y; cy < max_y; cy += 32) {
    int y = cy / 16;
    int second_row = cy + 16 <= max_y;
    int px = min_x / 16;
    for (int cx = min_x; cx < max_x; cx += 32, px = (px + 2) & 0x3FF) {
      int second_column = max_x - cx - 16 >= 0;
      draw_pixel(&s, px, y, z, v1->color);
      if (second_column) draw_pixel(&s, px + 1, y, z, v1->color);
      if (second_row) draw_pixel(&s, px, y + 1, z, v1->color);
      if (second_row && second_column) draw_pixel(&s, px + 1, y + 1, z, v1->color);
    }
  }
}

// ---- drawing -----------------------------------------------------------------------------------------------------------

static struct vertex kept[4];
static int kept_count, kept_prim;

static int vertex_cost(void) {
  int cost = 20;
  if (cmd[CMD_LIGHTINGENABLE] & 1) {
    cost += 10;
    for (int i = 0; i < 4; i++) if (cmd[CMD_LIGHTENABLE0 + i] & 1) cost += 7;
  }
  if ((cmd[CMD_TEXMAPMODE] & 3) != 0) cost += 20;
  int morphs = (int)((cmd[CMD_VERTEXTYPE] >> 18) & 7) + 1;
  if (morphs > 1) cost += 5 * morphs;
  return cost;
}

static void draw_prim(uint32_t op) {
  int count = op & 0xFFFF, prim = (op >> 16) & 7;
  if (count == 0) return;
  if (!valid(vertex_addr)) return;
  uint32_t vtype = cmd[CMD_VERTEXTYPE];
  int index_kind = (vtype >> 11) & 3;
  if (index_kind && !valid(index_addr)) return;
  cycles += (uint64_t)vertex_cost() * (uint32_t)count;
  struct layout l = layout_of(vtype);
  uint32_t bytes = (uint32_t)count * l.size;
  hash_bytes(vertex_addr, bytes);
  if (index_kind) hash_bytes(index_addr, (uint32_t)count << (index_kind - 1));
  // vertices with no position are never drawn
  if ((vtype >> 7) & 3) {
    if (prim != PRIM_KEEP_PREVIOUS) {
      kept_count = 0;
      kept_prim = prim;
    } else prim = kept_prim;
    if ((vtype & VTYPE_THROUGH) && prim == PRIM_RECTANGLES) {
      for (int i = 0; i < count; i++) {
        uint32_t n = (uint32_t)i;
        if (index_kind == 1) n = psp_read8(index_addr + (uint32_t)i);
        else if (index_kind == 2) n = psp_read16(index_addr + (uint32_t)i * 2);
        else if (index_kind == 3) n = psp_read32(index_addr + (uint32_t)i * 4);
        kept[kept_count++] = read_vertex(vertex_addr + n * l.size, &l);
        if (kept_count == 4) {
          draw_rect(&kept[0], &kept[1]);
          draw_rect(&kept[2], &kept[3]);
          kept_count = 0;
        }
      }
      if (kept_count >= 2) {
        draw_rect(&kept[0], &kept[1]);
        kept_count -= 2;
      }
    }
  }
  // the vertex or index address goes on past what was drawn
  if (index_kind) index_addr += (uint32_t)count << (index_kind - 1);
  else vertex_addr += bytes;
}

// a block of memory copied by the chip, a line at a time
static void transfer(void) {
  uint32_t src_base = (cmd[CMD_TRANSFERSRC] & 0xFFFFF0) | ((cmd[CMD_TRANSFERSRCW] & 0xFF0000) << 8);
  uint32_t dst_base = (cmd[CMD_TRANSFERDST] & 0xFFFFF0) | ((cmd[CMD_TRANSFERDSTW] & 0xFF0000) << 8);
  uint32_t src_stride = cmd[CMD_TRANSFERSRCW] & 0x7F8, dst_stride = cmd[CMD_TRANSFERDSTW] & 0x7F8;
  if (src_stride > 0x400) src_stride = 0;
  if (dst_stride > 0x400) dst_stride = 0;
  int src_x = cmd[CMD_TRANSFERSRCPOS] & 0x3FF, src_y = (cmd[CMD_TRANSFERSRCPOS] >> 10) & 0x3FF;
  int dst_x = cmd[CMD_TRANSFERDSTPOS] & 0x3FF, dst_y = (cmd[CMD_TRANSFERDSTPOS] >> 10) & 0x3FF;
  int width = (int)(cmd[CMD_TRANSFERSIZE] & 0x3FF) + 1, height = (int)((cmd[CMD_TRANSFERSIZE] >> 10) & 0x3FF) + 1;
  int bpp = (cmd[CMD_TRANSFERSTART] & 1) ? 4 : 2;
  if ((src_base & 0x04800000) == 0x04800000) src_base &= ~0x00800000u;
  if ((dst_base & 0x04800000) == 0x04800000) dst_base &= ~0x00800000u;
  for (int y = 0; y < height; y++) {
    uint32_t from = src_base + ((uint32_t)(y + src_y) * src_stride + (uint32_t)src_x) * (uint32_t)bpp;
    uint32_t to = dst_base + ((uint32_t)(y + dst_y) * dst_stride + (uint32_t)dst_x) * (uint32_t)bpp;
    uint32_t length = (uint32_t)(width * bpp);
    // copied front to back, or back to front where the line's two places overlap so
    if (to > from && to < from + length) for (uint32_t i = length; i-- > 0;) psp_write8(to + i, psp_read8(from + i));
    else for (uint32_t i = 0; i < length; i++) psp_write8(to + i, psp_read8(from + i));
  }
  cycles += (uint64_t)(height * width * bpp) * 16 / 10;
}
