// The console's time and its threads, kept as the emulator in the proof tools keeps them (PPSSPP's CoreTiming and
// sceKernelThread), so a Dreamport's code waits where its original waits and is woken when its original is.
//
// The time is counted in the processor's cycles, 222 million a second, one for each instruction the original runs and
// two for one of the vector unit's. What is due at a time, a V-blank, a block of sound to mix, a delay's end, is kept
// in a list and happens once the running thread has used the cycles up to it, which it does by asking the system for
// something, whose answer takes the cycles the emulator takes for it, or by saying how long its own code took
// (psp_time_pass). With no thread ready the console idles to the next thing due, which then comes one cycle late, as
// it does in the emulator.
//
// A thread is the game's own C, run on a stack of its own and stopped wherever it waits, by the same pass that lets a
// game wait for the screen from inside a function (kit/c/pause.c, Binaryen's Asyncify): each thread has a place for
// its waiting functions' values, and the kit goes back into the one whose turn it is. The threads are kept in order
// as the system keeps them: the one with the best priority, the lowest number, that is ready runs; among equals the
// one ready first; and a thread that is running keeps running until a better one is ready or it waits. So this file
// runs as WebAssembly only.

#include "psp-kit.h"

// ---- what's due --------------------------------------------------------------------------------------------------

#define DUE_ROOM 256
static struct due { uint64_t at, data, order; clock_event event; } due[DUE_ROOM];
static int due_count;
static uint64_t now, orders;

uint64_t clock_now(void) { return now; }
uint64_t clock_microseconds(void) { return now / (PSP_CYCLES_A_SECOND / 1000000); }
uint64_t psp_time(void) { return now; }
void clock_spend(int cycles) { now += (uint64_t)cycles; }

void clock_schedule(int64_t cycles, clock_event event, uint64_t data) {
  if (due_count == DUE_ROOM) __builtin_trap();
  due[due_count++] = (struct due){ now + (uint64_t)cycles, data, orders++, event };
}
void clock_unschedule(clock_event event, uint64_t data) {
  for (int i = 0; i < due_count; i++) {
    if (due[i].event == event && due[i].data == data) due[i--] = due[--due_count];
  }
}
int64_t clock_left(clock_event event, uint64_t data) {
  for (int i = 0; i < due_count; i++) {
    if (due[i].event == event && due[i].data == data) return (int64_t)(due[i].at - now);
  }
  return 0;
}
// the first thing due, or -1 with nothing
static int first_due(void) {
  int first = -1;
  for (int i = 0; i < due_count; i++) {
    if (first < 0 || due[i].at < due[first].at || (due[i].at == due[first].at && due[i].order < due[first].order)) first = i;
  }
  return first;
}
// everything due by now, in order, each told how late it is
static void happen(void) {
  for (;;) {
    int first = first_due();
    if (first < 0 || due[first].at > now) return;
    struct due it = due[first];
    due[first] = due[--due_count];
    it.event(it.data, (int)(now - it.at));
  }
}

// ---- threads --------------------------------------------------------------------------------------------------------

enum { DORMANT, READY, RUNNING, WAITING, GONE };
#define THREADS 64
// the system's numbers for what it makes start here in the emulator, after what it makes for itself as it starts a
// program: the program's module, its first thread and the system's own two idle threads among them
#define FIRST_UID 276
#define ROOT_UID 275
#define KEPT_BYTES 65536
#define STACK_LEAST 262144

struct thread {
  SceUID uid;
  int state, priority, first_priority, wait_kind, wait_what, wakeups, result, exit_status;
  uint32_t wait_value, size, arguments;
  psp_thread_entry entry;
  uint64_t ready_order;
  // the pass's own: where the waiting functions' values are kept, the C stack, and where each was left
  struct { uint8_t *at, *end; } kept;
  uint8_t *kept_bytes, *stack;
  uint32_t stack_bytes;
  uintptr_t stack_at;
  int started, resuming;
};
static struct thread threads[THREADS];
static int thread_count;
static SceUID next_uid;
// the thread the system has running, the one whose C is on the processor now, and whether the frame has ended
static struct thread *running, *executing;
static int frame_ended;
// the order threads became ready in: a thread put back while it runs goes before the others of its priority
static uint64_t ready_orders = 1ull << 32, front_orders = 1ull << 32;

static struct thread *thread_of(SceUID uid) {
  for (int i = 0; i < thread_count; i++) if (threads[i].uid == uid && threads[i].state != GONE) return &threads[i];
  return 0;
}
SceUID thread_current(void) { return running ? running->uid : 0; }
/** The priority of `uid`, now, or past the lowest for a thread there isn't. */
int thread_priority(SceUID uid) {
  struct thread *thread = thread_of(uid);
  return thread ? thread->priority : 0x7FFFFFFF;
}
/** The next number the system gives a thing it makes, a thread, a semaphore or an event flag, from one count. */
SceUID kernel_new_uid(void) { return next_uid++; }

static void make_ready(struct thread *thread) {
  if (thread->state == READY) return;
  thread->ready_order = thread->state == RUNNING ? --front_orders : ++ready_orders;
  thread->state = READY;
}
// the ready thread that would run next: the best priority, then the one ready first. With `better_than`, only one
// with a better priority than that
static struct thread *best_ready(int better_than) {
  struct thread *best = 0;
  for (int i = 0; i < thread_count; i++) {
    struct thread *each = &threads[i];
    if (each->state != READY || (better_than >= 0 && each->priority >= better_than)) continue;
    if (!best || each->priority < best->priority || (each->priority == best->priority && each->ready_order < best->ready_order)) best = each;
  }
  return best;
}
// With no thread ready the system's own idle thread runs, which `running` being nothing stands for. Changing the
// thread that runs takes time of its own in the emulator, 1,200 cycles to or from the idle thread and 2,700 between
// two others, even from a thread that waited to itself once it's woken, and what's due within that time happens in the
// same pass (happen).
void thread_reschedule(void) {
  struct thread *next;
  int from_idle = !running;
  if (!running) {
    next = best_ready(-1);
    if (!next) return;
  } else if (running->state == RUNNING) {
    next = best_ready(running->priority);
    if (!next) return;
    make_ready(running);
  } else next = best_ready(-1);
  now += from_idle || !next ? 1200 : 2700;
  running = next;
  if (running) running->state = RUNNING;
}

void thread_wait(int kind, int what, uint32_t value) {
  running->wait_kind = kind;
  running->wait_what = what;
  running->wait_value = value;
  running->state = WAITING;
}
int thread_waits(SceUID uid, int kind) {
  struct thread *thread = thread_of(uid);
  return thread && thread->state == WAITING && thread->wait_kind == kind ? thread->wait_what : 0;
}
uint32_t thread_wait_value(SceUID uid) {
  struct thread *thread = thread_of(uid);
  return thread ? thread->wait_value : 0;
}
void thread_wake(SceUID uid, int result) {
  struct thread *thread = thread_of(uid);
  if (!thread || thread->state != WAITING) return;
  thread->wait_kind = WAIT_NONE;
  thread->result = result;
  make_ready(thread);
}

static void stop_thread(struct thread *thread, int status) {
  thread->exit_status = status;
  thread->state = DORMANT;
  thread->wait_kind = WAIT_NONE;
}

#ifdef __wasm__
#define ASYNCIFY(name) __attribute__((import_module("asyncify"), import_name(name)))
ASYNCIFY("start_unwind") void asyncify_start_unwind(void *);
ASYNCIFY("stop_unwind") void asyncify_stop_unwind(void);
ASYNCIFY("start_rewind") void asyncify_start_rewind(void *);
ASYNCIFY("stop_rewind") void asyncify_stop_rewind(void);
// C keeps some of a function's values in a stack in memory, which the pass doesn't put away, so each thread has a
// stack of its own, and going into a thread points the stack there (as kit/c/pause.c does for a game's one wait)
__asm__(".globaltype __stack_pointer, i32\n"
        ".section .text.psp_stack_get,\"\",@\n"
        ".type psp_stack_get,@function\npsp_stack_get:\n.functype psp_stack_get () -> (i32)\nglobal.get __stack_pointer\nend_function\n"
        ".section .text.psp_stack_set,\"\",@\n"
        ".type psp_stack_set,@function\npsp_stack_set:\n.functype psp_stack_set (i32) -> ()\nlocal.get 0\nglobal.set __stack_pointer\nend_function\n");
uintptr_t psp_stack_get(void);
void psp_stack_set(uintptr_t to);
#define kit_stack_get psp_stack_get
#define kit_stack_set psp_stack_set

// stops the thread whose C is running here, until the kit goes back into it: outside the game's code and never
// inlined, so the pass sees a call to it in every function that can wait
__attribute__((noinline)) static void leave(void) {
  struct thread *thread = executing;
  if (thread->resuming) {
    thread->resuming = 0;
    asyncify_stop_rewind();
    return;
  }
  thread->kept.at = thread->kept_bytes;
  thread->kept.end = thread->kept_bytes + KEPT_BYTES;
  asyncify_start_unwind(&thread->kept);
}

// a thread's whole run: its function, and its end when the function comes back
static void thread_run(void) {
  struct thread *thread = executing;
  int status = thread->entry(thread->size, thread->arguments);
  // a function that comes back goes to the system's own call that ends its thread, two instructions as any other's
  thread = executing;
  now += 1;
  stop_thread(thread, status);
  thread->started = 0;
  happen();
  thread_reschedule();
  now += 1;
}
// goes into `thread`, from its start or from where it left, until it leaves again or ends
__attribute__((noinline)) static void enter(struct thread *thread) {
  void (*volatile run)(void) = thread_run;
  uintptr_t ours = kit_stack_get();
  executing = thread;
  if (thread->started) {
    thread->resuming = 1;
    kit_stack_set(thread->stack_at);
    asyncify_start_rewind(&thread->kept);
  } else {
    thread->started = 1;
    kit_stack_set((uintptr_t)thread->stack + thread->stack_bytes);
  }
  run();
  thread->stack_at = kit_stack_get();
  kit_stack_set(ours);
  asyncify_stop_unwind();
  executing = 0;
}
#else
#include <stdio.h>
#include <stdlib.h>
// a computer's program has no such pass
static void leave(void) {
  fputs("A PlayStation Portable game runs in the console's threads, as WebAssembly only.\n", stderr);
  abort();
}
static void enter(struct thread *thread) {
  (void)thread;
  leave();
}
#endif

// One of the system's functions is reached through two instructions of the program's own, a return and the call
// itself in its delay slot, which the emulator runs as a pair: the first is counted before the system answers, and the
// second after. Where the system puts the threads in order as it answers, what's due happens then, before the second
// is counted; where it doesn't, what's due happens once the pair has run.
void call_starts(void) { now += 1; }
int thread_answer(int result) {
  struct thread *me = executing;
  me->result = result;
  happen();
  thread_reschedule();
  // the call's own instruction is counted as it's made, before whichever thread runs next
  now += 1;
  if (running != me || frame_ended) leave();
  return executing->result;
}
int thread_done(int result) {
  struct thread *me = executing;
  me->result = result;
  now += 1;
  happen();
  if (running != me || frame_ended) leave();
  return executing->result;
}
// The game's own code ran for `cycles`. What comes due on the way happens as it does in the emulator, after the
// instruction that reaches it, so a cycle late, and a better thread it wakes runs before the rest of the code does.
void psp_time_pass(uint32_t cycles) {
  struct thread *me = executing;
  uint64_t left = cycles;
  for (;;) {
    int first = first_due();
    if (first < 0 || due[first].at >= now + left) break;
    uint64_t at = due[first].at + 1 > now ? due[first].at + 1 : now;
    left -= at - now;
    now = at;
    happen();
    if (running != me || frame_ended) leave();
  }
  now += left;
}
void kernel_frame_ends(void) { frame_ended = 1; }

// An interrupt: the system changes from the thread it has running to its idle thread to take it, 1,200 cycles, and
// back once it's done, 1,200 more. A thread that was waiting isn't changed back to: the idle thread goes on until the
// threads are next put in order. With the idle thread running, nothing changes.
static int interrupted_running;
void kernel_interrupt_starts(void) {
  interrupted_running = 0;
  if (!running) return;
  now += 1200;
  if (running->state == RUNNING) interrupted_running = 1;
  else running = 0;
}
void kernel_interrupt_ends(void) {
  if (interrupted_running) now += 1200;
  interrupted_running = 0;
}

void kernel_run_frame(void) {
  frame_ended = 0;
  while (!frame_ended) {
    if (running) {
      enter(running);
      continue;
    }
    // nothing is ready: the idle thread asks the system to idle, which goes to the next thing due and finds it a cycle
    // late, lets what's due happen, puts the threads in order, and then counts its own call's instruction
    int first = first_due();
    if (first < 0) __builtin_trap();
    if (due[first].at >= now) now = due[first].at + 1;
    happen();
    thread_reschedule();
    now += 1;
  }
}

// ---- what a game asks of its threads ---------------------------------------------------------------------------------

static struct thread *new_thread(SceUID uid, psp_thread_entry entry, int priority, int stack_size) {
  if (thread_count == THREADS) __builtin_trap();
  struct thread *thread = &threads[thread_count++];
  *thread = (struct thread){ .uid = uid, .state = DORMANT, .priority = priority, .first_priority = priority, .entry = entry };
  thread->stack_bytes = (uint32_t)stack_size * 2 < STACK_LEAST ? STACK_LEAST : (uint32_t)stack_size * 2;
  thread->kept_bytes = kit_alloc(KEPT_BYTES);
  thread->stack = kit_alloc(thread->stack_bytes);
  return thread;
}

SceUID sceKernelCreateThread(const char *name, psp_thread_entry entry, int priority, int stack_size, uint32_t attributes, uint32_t options) {
  (void)options;
  call_starts();
  if (!name) return thread_done(PSP_ERROR_ERROR);
  if ((uint32_t)stack_size < 0x200) return thread_done(PSP_ERROR_ILLEGAL_STACK_SIZE);
  if (priority < 0x08 || priority > 0x77) return thread_done(PSP_ERROR_ILLEGAL_PRIORITY);
  // a game's thread may ask for the vector unit, the user's memory and a few ways with its stack, and nothing else
  if (attributes & ~0xF8F060FFu) return thread_done(PSP_ERROR_ILLEGAL_ATTR);
  struct thread *thread = new_thread(kernel_new_uid(), entry, priority, stack_size);
  clock_spend(32000);
  return thread_answer(thread->uid);
}

int sceKernelStartThread(SceUID uid, uint32_t size, uint32_t arguments) {
  call_starts();
  if (uid == 0) return thread_done(PSP_ERROR_ILLEGAL_THID);
  if ((int32_t)size < 0 || (arguments & 0x80000000)) return thread_done(PSP_ERROR_ILLEGAL_ADDR);
  struct thread *thread = thread_of(uid);
  if (!thread) return thread_done(PSP_ERROR_UNKNOWN_THID);
  if (thread->state != DORMANT) return thread_done(PSP_ERROR_NOT_DORMANT);
  clock_spend(3400);
  thread->priority = thread->first_priority;
  thread->size = arguments && size ? size : 0;
  thread->arguments = arguments && size ? arguments : 0;
  thread->wakeups = 0;
  thread->started = 0;
  // a better thread than the one that starts it runs at once, and the starter is ready again ahead of its equals
  int better = running && running->priority > thread->priority;
  if (better) make_ready(running);
  make_ready(thread);
  return better ? thread_answer(0) : thread_done(0);
}

int sceKernelExitThread(int status) {
  call_starts();
  stop_thread(running, status < 0 ? PSP_ERROR_ILLEGAL_ARGUMENT : status);
  return thread_answer(0);
}
int sceKernelExitDeleteThread(int status) {
  call_starts();
  stop_thread(running, status);
  running->state = GONE;
  return thread_answer(0);
}
int sceKernelDeleteThread(SceUID uid) {
  call_starts();
  struct thread *thread = thread_of(uid);
  if (uid == 0 || (running && uid == running->uid)) return thread_done(PSP_ERROR_ILLEGAL_THID);
  if (!thread) return thread_done(PSP_ERROR_UNKNOWN_THID);
  if (thread->state != DORMANT) return thread_done(PSP_ERROR_NOT_DORMANT);
  thread->state = GONE;
  return thread_done(0);
}

int sceKernelSleepThread(void) {
  call_starts();
  if (running->wakeups > 0) {
    running->wakeups--;
    return thread_done(0);
  }
  thread_wait(WAIT_SLEEP, 0, 0);
  return thread_answer(0);
}
int sceKernelWakeupThread(SceUID uid) {
  call_starts();
  if (running && uid == running->uid) return thread_done(PSP_ERROR_ILLEGAL_THID);
  struct thread *thread = thread_of(uid);
  if (!thread) return thread_done(PSP_ERROR_UNKNOWN_THID);
  if (thread->state == WAITING && thread->wait_kind == WAIT_SLEEP) {
    thread_wake(uid, 0);
    return thread_answer(0);
  }
  thread->wakeups++;
  return thread_done(0);
}

static void delay_ends(uint64_t data, int late) {
  (void)late;
  SceUID uid = (SceUID)data;
  if (thread_waits(uid, WAIT_DELAY) == uid) {
    thread_wake(uid, 0);
    thread_reschedule();
  }
}
int sceKernelDelayThread(uint32_t microseconds) {
  call_starts();
  clock_spend(2000);
  // it never wakes at once: the shortest delay is 210 microseconds, and any other 10 more than asked
  int64_t wait = microseconds < 200 ? 210 : (int64_t)microseconds + 10;
  clock_schedule(wait * (PSP_CYCLES_A_SECOND / 1000000), delay_ends, (uint64_t)running->uid);
  thread_wait(WAIT_DELAY, running->uid, 0);
  return thread_answer(0);
}

SceUID sceKernelGetThreadId(void) {
  call_starts();
  clock_spend(180);
  return thread_done(running->uid);
}
uint32_t sceKernelGetSystemTimeLow(void) {
  call_starts();
  uint32_t time = (uint32_t)clock_microseconds();
  clock_spend(165);
  return (uint32_t)thread_answer((int)time);
}
uint64_t sceKernelGetSystemTimeWide(void) {
  call_starts();
  uint64_t time = clock_microseconds();
  clock_spend(250);
  thread_answer(0);
  return time;
}

void kernel_power(void) {
  now = 0;
  orders = 0;
  due_count = 0;
  thread_count = 0;
  next_uid = FIRST_UID;
  running = executing = 0;
  frame_ended = 0;
}
void kernel_start(psp_thread_entry entry) {
  // the program's first thread, as the system starts one that asks for nothing else: priority 32 and 256 KB of stack
  struct thread *root = new_thread(ROOT_UID, entry, 0x20, 0x40000);
  root->state = RUNNING;
  running = root;
}
