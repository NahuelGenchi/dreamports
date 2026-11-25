// The Dreamport in C of the small program in tools/test/made-up-psp-mutex.mjs (madeUpPspMutex), for npm run
// test:psp-kit: what the program does, written again on the PlayStation Portable's kit in C. The test puts the
// program's own numbers and its list's words in the names between at signs. It starts as the console's SDK has a game
// start, with a thread for the callbacks, and its two threads lock a mutex and a lightweight mutex against each other,
// as the program's do. After each stretch of its own code it says how many of the processor's cycles the program's
// instructions took there.

#include "psp.h"

#define BARS_AT @BARS_AT@u
#define IDS_AT @IDS_AT@u
#define FRAME_AT @FRAME_AT@u
#define TIMEOUTS_AT @TIMEOUTS_AT@u
#define RESULTS_AT @RESULTS_AT@u
#define AREA_AT @AREA_AT@u
static const uint32_t BARS_LIST[] = { @BARS_WORDS@ };
enum { BAR0 = @BAR0@, BAR1 = @BAR1@, BAR2 = @BAR2@, BAR3 = @BAR3@, BAR4 = @BAR4@, BAR5 = @BAR5@, BAR6 = @BAR6@ };
enum {
  LINE = @LINE@, LOCK_TIMEOUT = @LOCK_TIMEOUT@, WORKER_DELAY = @WORKER_DELAY@, HOLD = @HOLD@, CALLBACKS_PRIORITY = @CALLBACKS_PRIORITY@,
  CALLBACKS_STACK = @CALLBACKS_STACK@, WORKER_PRIORITY = @WORKER_PRIORITY@, WORKER_STACK = @WORKER_STACK@, LW_ATTR = @LW_ATTR@,
};

// a bar as wide as the low eight bits of what the system answered, and one more
static void bar(uint32_t edge, uint32_t value) { psp_write16(BARS_AT + edge, (uint16_t)((value & 0xFF) + 1)); }

// the exit callback, which only a player quitting the game would run
static int exit_callback(int count, int argument, uint32_t common) {
  (void)count;
  (void)argument;
  (void)common;
  return 0;
}

// the SDK's thread for the callbacks: its callback, registered as the exit callback, and its sleep
static int callbacks(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  psp_time_pass(@C_CALLBACK@);
  SceUID callback = sceKernelCreateCallback("Exit Callback", exit_callback, 0);
  psp_time_pass(@C_REGISTER@);
  sceKernelRegisterExitCallback(callback);
  for (;;) {
    psp_time_pass(@C_SLEEP@);
    sceKernelSleepThreadCB();
    psp_time_pass(2);
  }
  return 0;
}

static int worker(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  for (;;) {
    psp_write32(TIMEOUTS_AT, LOCK_TIMEOUT);
    psp_time_pass(@C_WORKER_LOCK@);
    int locked = sceKernelLockMutex((SceUID)psp_read32(IDS_AT), 1, TIMEOUTS_AT);
    psp_write32(RESULTS_AT, (uint32_t)locked);
    psp_time_pass(@C_WORKER_LOCKED@);
    if (locked == 0) {
      psp_time_pass(@C_WORKER_UNLOCK@);
      sceKernelUnlockMutex((SceUID)psp_read32(IDS_AT), 1);
    }
    psp_time_pass(@C_WORKER_TRY@);
    int tried = sceKernelTryLockLwMutex(AREA_AT, 1);
    psp_write32(RESULTS_AT + 4, (uint32_t)tried);
    psp_time_pass(@C_WORKER_TRIED@);
    if (tried == 0) {
      psp_time_pass(@C_WORKER_LIGHT_UNLOCK@);
      sceKernelUnlockLwMutex(AREA_AT, 1);
    }
    psp_time_pass(@C_WORKER_DELAY@);
    sceKernelDelayThread(WORKER_DELAY);
    psp_time_pass(@C_WORKER_NEXT@);
  }
  return 0;
}

void game_start(void) {
  for (unsigned i = 0; i < sizeof BARS_LIST / 4; i++) psp_write32(BARS_AT + i * 4, BARS_LIST[i]);

  psp_time_pass(@C_MODE@);
  sceDisplaySetMode(0, SCREEN_W, SCREEN_H);
  psp_time_pass(@C_FRAMEBUFFER@);
  sceDisplaySetFrameBuf(PSP_VRAM | 0x40000000, LINE, PSP_FORMAT_8888, PSP_SETBUF_NEXTFRAME);
  psp_time_pass(@C_CALLBACKS_THREAD@);
  SceUID updates = sceKernelCreateThread("update_thread", callbacks, CALLBACKS_PRIORITY, CALLBACKS_STACK, 0, 0);
  psp_time_pass(@C_CALLBACKS_START@);
  sceKernelStartThread(updates, 0, 0);
  psp_time_pass(@C_MUTEX@);
  SceUID mutex = sceKernelCreateMutex("mutex", 0, 0, 0);
  psp_write32(IDS_AT, (uint32_t)mutex);
  psp_time_pass(@C_LIGHTWEIGHT@);
  sceKernelCreateLwMutex(AREA_AT, "lwmutex", LW_ATTR, 0, 0);
  psp_time_pass(@C_CREATE@);
  SceUID thread = sceKernelCreateThread("worker", worker, WORKER_PRIORITY, WORKER_STACK, 0, 0);
  psp_time_pass(@C_START@);
  sceKernelStartThread(thread, 0, 0);
  psp_time_pass(@C_LOOP@);
  for (uint32_t frame = 0;; frame++) {
    psp_time_pass(@C_WAIT@);
    sceDisplayWaitVblankStart();
    psp_time_pass(@C_TIME@);
    bar(BAR0, sceKernelGetSystemTimeLow());
    psp_write32(FRAME_AT, frame);
    psp_time_pass(@C_LOCK@);
    bar(BAR1, (uint32_t)sceKernelLockMutex(mutex, 1, 0));
    psp_time_pass(@C_LIGHT_LOCK@);
    sceKernelLockLwMutex(AREA_AT, 1, 0);
    psp_time_pass(@C_LIGHT_AGAIN@);
    bar(BAR2, (uint32_t)sceKernelLockLwMutex(AREA_AT, 1, 0));
    psp_time_pass(@C_HELD@);
    if ((frame & 3) == 3) {
      psp_time_pass(@C_HOLD@);
      sceKernelDelayThread(HOLD);
    }
    psp_time_pass(@C_LIGHT_UNLOCK@);
    sceKernelUnlockLwMutex(AREA_AT, 2);
    psp_time_pass(@C_UNLOCK@);
    sceKernelUnlockMutex(mutex, 1);
    psp_time_pass(@C_AFTER@);
    bar(BAR3, sceKernelGetSystemTimeLow());
    bar(BAR4, psp_read32(RESULTS_AT));
    bar(BAR5, psp_read32(TIMEOUTS_AT));
    bar(BAR6, psp_read32(RESULTS_AT + 4));
    psp_time_pass(@C_BARS@);
    sceGeListEnQueue(BARS_AT, 0, -1, 0);
    psp_time_pass(@C_DRAW@);
    sceGeDrawSync(0);
    psp_time_pass(@C_NEXT@);
  }
}

void game_step(uint32_t buttons) { (void)buttons; }
void game_draw(void) { psp_show(); }
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
