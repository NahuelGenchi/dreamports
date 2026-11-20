// Ending a frame from anywhere in a game's C, and going on from there in the next (kit.h: kit_wait_frame, kit_run), or
// pausing partway through one until the page has what the game waits for (kit_pause), and running a second program
// beside the game's, in turns, as a console's second processor runs one (kit_run_beside). A console's game waits for
// the screen from inside its own functions, as a fade written as a loop does, and its main loop never returns. WebAssembly has no way to leave a function halfway, so the build runs one pass over a game that
// calls these (Binaryen's Asyncify, tools/lib/c.mjs), which makes every function on the way to a wait able to put its
// values away and come back to them. The pass's four calls are made from here, so the page needs nothing new.
//
// A game with no wait calls none of this, the linker leaves it out, and its build gets no pass.

#include "kit.h"

#ifdef __wasm__
#define ASYNCIFY(name) __attribute__((import_module("asyncify"), import_name(name)))
ASYNCIFY("start_unwind") void asyncify_start_unwind(void *);
ASYNCIFY("stop_unwind") void asyncify_stop_unwind(void);
ASYNCIFY("start_rewind") void asyncify_start_rewind(void *);
ASYNCIFY("stop_rewind") void asyncify_stop_rewind(void);

// C keeps some of a function's values in a stack in memory, which the pass doesn't put away. The game gets a stack of
// its own, so what the page's other calls do between two frames can't write over a function that is waiting.
__asm__(".globaltype __stack_pointer, i32\n"
        ".section .text.kit_stack_get,\"\",@\n"
        ".type kit_stack_get,@function\nkit_stack_get:\n.functype kit_stack_get () -> (i32)\nglobal.get __stack_pointer\nend_function\n"
        ".section .text.kit_stack_set,\"\",@\n"
        ".type kit_stack_set,@function\nkit_stack_set:\n.functype kit_stack_set (i32) -> ()\nlocal.get 0\nglobal.set __stack_pointer\nend_function\n");
uintptr_t kit_stack_get(void);
void kit_stack_set(uintptr_t to);

// where the pass keeps the waiting functions' other values, as it asks for them: where it is now and where it ends
#define KEPT_BYTES 65536
#define STACK_BYTES 262144
static struct { uint8_t *at, *end; } paused;
static uint8_t *kept, *stack;
static uintptr_t game_stack;
// whether the game has started, whether it's on its way back to where it waited, and whether it waits partway through
// its frame: kept here, as the pass's own word for it can't be asked from C
static int started, resuming, partway;

// outside the game's code and never inlined, so the pass sees a call to it in every function that waits
__attribute__((noinline)) void kit_wait_frame(void) {
  if (resuming) {
    resuming = 0;
    asyncify_stop_rewind();
    return;
  }
  paused.at = kept;
  paused.end = kept + KEPT_BYTES;
  asyncify_start_unwind(&paused);
}

// the same, for a wait partway through the frame
__attribute__((noinline)) void kit_pause(void) {
  if (resuming) {
    resuming = 0;
    partway = 0;
    asyncify_stop_rewind();
    return;
  }
  partway = 1;
  paused.at = kept;
  paused.end = kept + KEPT_BYTES;
  asyncify_start_unwind(&paused);
}

__attribute__((noinline)) int kit_run(void (*game)(void)) {
  // called through a pointer the compiler can't see through, as a game's main loop never ends by itself, and a call
  // that never returns would have nothing after it to come back to
  void (*volatile run)(void) = game;
  if (!kept) {
    kept = kit_alloc(KEPT_BYTES);
    stack = kit_alloc(STACK_BYTES);
  }
  uintptr_t ours = kit_stack_get();
  if (started) {
    resuming = 1;
    kit_stack_set(game_stack);
    asyncify_start_rewind(&paused);
  } else {
    started = 1;
    kit_stack_set((uintptr_t)stack + STACK_BYTES);
  }
  run();
  game_stack = kit_stack_get();
  kit_stack_set(ours);
  asyncify_stop_unwind();
  return !partway;
}

// A second program beside the game's, as a console's second processor runs one (kit_run_beside): the same pass, with
// a place of its own for its waiting functions' values and a stack of its own, so the kit can run it from inside the
// game's code, which is itself waiting or not, and each comes back to where it was.
static struct { uint8_t *at, *end; } beside;
static uint8_t *beside_kept, *beside_stack;
static uintptr_t beside_stack_at;
static int beside_started, beside_resuming, beside_waited;

__attribute__((noinline)) void kit_wait_beside(void) {
  if (beside_resuming) {
    beside_resuming = 0;
    asyncify_stop_rewind();
    return;
  }
  beside_waited = 1;
  beside.at = beside_kept;
  beside.end = beside_kept + KEPT_BYTES;
  asyncify_start_unwind(&beside);
}

__attribute__((noinline)) int kit_run_beside(void (*program)(void)) {
  void (*volatile run)(void) = program;
  if (!beside_kept) {
    beside_kept = kit_alloc(KEPT_BYTES);
    beside_stack = kit_alloc(STACK_BYTES);
  }
  uintptr_t ours = kit_stack_get();
  beside_waited = 0;
  if (beside_started) {
    beside_resuming = 1;
    kit_stack_set(beside_stack_at);
    asyncify_start_rewind(&beside);
  } else {
    beside_started = 1;
    kit_stack_set((uintptr_t)beside_stack + STACK_BYTES);
  }
  run();
  beside_stack_at = kit_stack_get();
  kit_stack_set(ours);
  asyncify_stop_unwind();
  // a program that came back starts again the next time
  if (!beside_waited) beside_started = 0;
  return beside_waited;
}
#else
#include <stdio.h>
#include <stdlib.h>
// a computer's program has no such pass
void kit_wait_frame(void) {
  fputs("A game that waits for the screen from inside a function runs as WebAssembly only.\n", stderr);
  abort();
}
void kit_pause(void) { kit_wait_frame(); }
int kit_run(void (*game)(void)) {
  (void)game;
  kit_wait_frame();
  return 1;
}
void kit_wait_beside(void) { kit_wait_frame(); }
int kit_run_beside(void (*program)(void)) {
  (void)program;
  kit_wait_frame();
  return 1;
}
#endif

int kit_frame_paused(void) {
#ifdef __wasm__
  return partway;
#else
  return 0;
#endif
}
