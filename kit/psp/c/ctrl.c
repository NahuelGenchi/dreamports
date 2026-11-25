// The buttons and the stick, as the system gives them to a game (sceCtrl) and as the emulator in the proof tools
// samples them: once as each V-blank ends, unless a game asks for a pace of its own, into a ring of 64 samples, each
// with the time it was taken. A game peeks at the newest samples or reads the ones it hasn't read, waiting for one.

#include "psp-kit.h"

#define SAMPLES 64
#define CENTER 128
#define MICROSECOND (PSP_CYCLES_A_SECOND / 1000000)
// the buttons a game may see
#define USER_BUTTONS 0x00FFFFFFu

static SceCtrlData samples[SAMPLES], held;
static uint32_t write_at, read_at;
static int analog, pace;
static SceUID readers[64];
static int reader_count;

void ctrl_power(void) {
  held = (SceCtrlData){ 0, 0, CENTER, CENTER, { CENTER, CENTER, 0, 0, 0, 0 } };
  for (int i = 0; i < SAMPLES; i++) samples[i] = held;
  write_at = 1;
  read_at = 0;
  analog = pace = reader_count = 0;
}

void ctrl_hold(uint32_t buttons, uint8_t x, uint8_t y) {
  held.buttons = buttons & USER_BUTTONS;
  held.x = x;
  held.y = y;
}

// the oldest sample not yet read, written at `address`
static int read_one(uint32_t address, int negative) {
  SceCtrlData *to = psp_memory(address);
  if (!to) return 0;
  SceCtrlData sample = samples[read_at];
  read_at = (read_at + 1) % SAMPLES;
  sample.buttons &= USER_BUTTONS;
  if (negative) sample.buttons = ~sample.buttons;
  __builtin_memcpy(to, &sample, sizeof sample);
  return 1;
}

static void sample_now(void) {
  samples[write_at] = held;
  samples[write_at].time = (uint32_t)clock_microseconds();
  if (!analog) {
    samples[write_at].x = samples[write_at].y = CENTER;
    samples[write_at].more[0] = samples[write_at].more[1] = CENTER;
  }
  write_at = (write_at + 1) % SAMPLES;
  // once the ring has gone all the way round, the oldest unread sample is lost
  if (read_at == write_at) read_at = (read_at + 1) % SAMPLES;
  // one thread that waits for a sample gets it
  while (reader_count && write_at != read_at) {
    SceUID thread = readers[0];
    for (int i = 1; i < reader_count; i++) readers[i - 1] = readers[i];
    reader_count--;
    int how = thread_waits(thread, WAIT_CTRL);
    if (!how) continue;
    thread_wake(thread, read_one(thread_wait_value(thread), how == 2));
    thread_reschedule();
    break;
  }
}
static void paced(uint64_t data, int late) {
  (void)data;
  clock_schedule((int64_t)pace * MICROSECOND - late, paced, 0);
  sample_now();
}
void ctrl_vblank(void) {
  if (pace == 0) sample_now();
}

int sceCtrlSetSamplingCycle(int microseconds) {
  call_starts();
  if ((microseconds > 0 && microseconds < 5555) || (uint32_t)microseconds > 20000) return thread_done(PSP_ERROR_INVALID_VALUE);
  int before = pace;
  pace = microseconds;
  if (before > 0) clock_unschedule(paced, 0);
  if (pace > 0) clock_schedule((int64_t)pace * MICROSECOND, paced, 0);
  return thread_done(before);
}
int sceCtrlSetSamplingMode(int mode) {
  call_starts();
  if ((uint32_t)mode > 1) return thread_done(PSP_ERROR_INVALID_MODE);
  int before = analog;
  analog = mode;
  return thread_done(before);
}

static int read_samples(uint32_t address, uint32_t count, int negative, int peek) {
  if (count > SAMPLES) return PSP_ERROR_INVALID_SIZE;
  uint32_t back_to = read_at, there = count;
  if (!peek) {
    there = (write_at - read_at + SAMPLES) % SAMPLES;
    if (there > count) there = count;
  }
  read_at = (write_at - there + SAMPLES) % SAMPLES;
  int done = 0;
  for (uint32_t i = 0; i < there; i++) done += read_one(address + i * 16, negative);
  if (peek) read_at = back_to;
  return done;
}
static int read_waiting(uint32_t address, int count, int negative) {
  call_starts();
  int done = read_samples(address, (uint32_t)count, negative, 0);
  clock_spend(330);
  if (done != 0) return thread_done(done);
  if (reader_count == 64) __builtin_trap();
  readers[reader_count++] = thread_current();
  thread_wait(WAIT_CTRL, negative ? 2 : 1, address);
  return thread_answer(done);
}
static int peek(uint32_t address, int count, int negative) {
  call_starts();
  int done = read_samples(address, (uint32_t)count, negative, 1);
  clock_spend(330);
  return thread_done(done);
}
int sceCtrlPeekBufferPositive(uint32_t address, int count) { return peek(address, count, 0); }
int sceCtrlPeekBufferNegative(uint32_t address, int count) { return peek(address, count, 1); }
int sceCtrlReadBufferPositive(uint32_t address, int count) { return read_waiting(address, count, 0); }
int sceCtrlReadBufferNegative(uint32_t address, int count) { return read_waiting(address, count, 1); }
