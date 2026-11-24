// What the PlayStation Portable kit's own files share (memory.c, kernel.c, display.c, ctrl.c, audio.c, psp.c), which a
// game doesn't need.

#ifndef DREAMPORTS_PSP_KIT_H
#define DREAMPORTS_PSP_KIT_H

#include "psp.h"
#include "kit.h"

// the system's own errors, as the console's numbers them
enum {
  PSP_ERROR_INVALID_POINTER = (int)0x80000103, PSP_ERROR_INVALID_SIZE = (int)0x80000104, PSP_ERROR_INVALID_MODE = (int)0x80000107, PSP_ERROR_INVALID_FORMAT = (int)0x80000108,
  PSP_ERROR_INVALID_VALUE = (int)0x800001FE, PSP_ERROR_ILLEGAL_ARGUMENT = (int)0x800200D2, PSP_ERROR_ERROR = (int)0x80020001, PSP_ERROR_ILLEGAL_ADDR = (int)0x800200D3,
  PSP_ERROR_ILLEGAL_PRIORITY = (int)0x80020193, PSP_ERROR_ILLEGAL_STACK_SIZE = (int)0x80020194, PSP_ERROR_ILLEGAL_ATTR = (int)0x80020191, PSP_ERROR_ILLEGAL_THID = (int)0x80020197,
  PSP_ERROR_UNKNOWN_THID = (int)0x80020198, PSP_ERROR_NOT_DORMANT = (int)0x800201A4, PSP_ERROR_DORMANT = (int)0x800201A2, PSP_ERROR_CAN_NOT_WAIT = (int)0x800201A7,
  PSP_ERROR_AUDIO_CHANNEL_NOT_INIT = (int)0x80260001, PSP_ERROR_AUDIO_CHANNEL_BUSY = (int)0x80260002, PSP_ERROR_AUDIO_INVALID_CHANNEL = (int)0x80260003,
  PSP_ERROR_AUDIO_NO_CHANNELS = (int)0x80260005, PSP_ERROR_AUDIO_NOT_ALIGNED = (int)0x80260006, PSP_ERROR_AUDIO_INVALID_FORMAT = (int)0x80260007,
  PSP_ERROR_AUDIO_NOT_RESERVED = (int)0x80260008, PSP_ERROR_AUDIO_INVALID_VOLUME = (int)0x8026000B,
};

// ---- memory.c ----
/** Puts the console's memory as it starts: every byte of it zero. */
void memory_power(void);

// ---- kernel.c: the console's time, what's due at a time, and its threads ----
/** What happens at a time: `data` is what it was scheduled with, and `late` how many cycles after its time it comes. */
typedef void (*clock_event)(uint64_t data, int late);
void kernel_power(void);
/** `event` in `cycles` from now, with `data`. Among those due at one time, the first scheduled comes first. */
void clock_schedule(int64_t cycles, clock_event event, uint64_t data);
/** Takes back what was scheduled as `event` with `data`. */
void clock_unschedule(clock_event event, uint64_t data);
/** The time now, in cycles and in the microseconds the system gives a game. */
uint64_t clock_now(void);
uint64_t clock_microseconds(void);
/** The running thread used `cycles`, as the emulator takes them for one of the system's answers. */
void clock_spend(int cycles);

// what a thread waits for
enum { WAIT_NONE, WAIT_SLEEP, WAIT_DELAY, WAIT_VBLANK, WAIT_AUDIO, WAIT_CTRL };
/** The running thread's number, or 0 when none runs. */
SceUID thread_current(void);
/** Puts the running thread to wait for `kind`, `what` of it, keeping `value` for whoever wakes it. */
void thread_wait(int kind, int what, uint32_t value);
/** What `thread` waits for, the `what` it was put to wait with, or 0 when it isn't waiting for `kind`. */
int thread_waits(SceUID thread, int kind);
uint32_t thread_wait_value(SceUID thread);
/** Wakes `thread` from its wait, its call answering `result`. The threads are put in order again by thread_reschedule. */
void thread_wake(SceUID thread, int result);
/** Picks the thread that runs now, as the system does when something has changed: a better one that's ready takes
 *  over from the one running. */
void thread_reschedule(void);
/** Starts one of the system's answers: the instruction that reaches it is counted. */
void call_starts(void);
/** Ends one of the system's answers that puts the threads in order: what's due happens, the best thread that's ready
 *  runs, and the calling thread stops here until it's its turn again. The answer is what the call gives back, which a
 *  waker may have changed. */
int thread_answer(int result);
/** Ends one that doesn't put them in order: what's due happens once the call's own instruction has run. */
int thread_done(int result);
/** Says the frame ends here, at the V-blank: whatever runs stops until the page's next frame. */
void kernel_frame_ends(void);
/** Runs the console until its frame ends. */
void kernel_run_frame(void);
/** Starts the program's first thread, at `entry`. */
void kernel_start(psp_thread_entry entry);

// ---- display.c ----
void display_power(void);
// ---- ctrl.c ----
void ctrl_power(void);
/** The buttons and the stick as the player holds them now: the console's own bits, and each way of the stick 0 to 255. */
void ctrl_hold(uint32_t buttons, uint8_t x, uint8_t y);
/** The pad's sample, taken as each V-blank ends unless a game asked for another pace. */
void ctrl_vblank(void);
// ---- audio.c ----
void audio_power(void);
/** The samples mixed since the page last took them, left and right, 16 bits each, and how many pairs. */
const int16_t *audio_heard(uint32_t *pairs);
void audio_frame_starts(void);
uint32_t audio_list_hash(void);
uint32_t audio_list_count(void);
/** Takes up to `count` of the samples mixed and not yet played, for a player's ears. */
int audio_take(float *left, float *right, int count);

#endif
