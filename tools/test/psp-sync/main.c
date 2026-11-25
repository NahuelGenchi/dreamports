// The Dreamport in C of the small program in tools/test/made-up-psp-sync.mjs (madeUpPspSync), for npm run
// test:psp-kit: what the program does, written again on the PlayStation Portable's kit in C. The test puts the
// program's own numbers and its list's words in the names between at signs. Its two threads wait for each other on a
// semaphore and an event flag, as the program's do, and after each stretch of its own code it says how many of the
// processor's cycles the program's instructions took there.

#include "psp.h"

#define BARS_AT @BARS_AT@u
#define IDS_AT @IDS_AT@u
#define FRAME_AT @FRAME_AT@u
#define TIMEOUTS_AT @TIMEOUTS_AT@u
#define OUT_AT @OUT_AT@u
#define RESULT_AT @RESULT_AT@u
static const uint32_t BARS_LIST[] = { @BARS_WORDS@ };
enum { BAR0 = @BAR0@, BAR1 = @BAR1@, BAR2 = @BAR2@, BAR3 = @BAR3@, BAR4 = @BAR4@, BAR5 = @BAR5@, BAR6 = @BAR6@ };
enum { LINE = @LINE@, SEMA_TIMEOUT = @SEMA_TIMEOUT@, FLAG_TIMEOUT = @FLAG_TIMEOUT@, WORKER_PRIORITY = @WORKER_PRIORITY@, WORKER_STACK = @WORKER_STACK@, HOW = @HOW@ };

// a bar as wide as the low eight bits of what the system answered, and one more
static void bar(uint32_t edge, uint32_t value) { psp_write16(BARS_AT + edge, (uint16_t)((value & 0xFF) + 1)); }

static int worker(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  for (;;) {
    psp_write32(TIMEOUTS_AT + 4, SEMA_TIMEOUT);
    psp_time_pass(@C_WORKER_WAIT@);
    int result = sceKernelWaitSema((SceUID)psp_read32(IDS_AT), 1, TIMEOUTS_AT + 4);
    psp_write32(RESULT_AT, (uint32_t)result);
    psp_time_pass(@C_WORKER_WOKEN@);
    if ((psp_read32(FRAME_AT) & 3) == 3) continue;
    psp_time_pass(@C_WORKER_SET@);
    sceKernelSetEventFlag((SceUID)psp_read32(IDS_AT + 4), 1);
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
  psp_time_pass(@C_SEMA@);
  SceUID sema = sceKernelCreateSema("sema", 0, 0, 4, 0);
  psp_write32(IDS_AT, (uint32_t)sema);
  psp_time_pass(@C_FLAG@);
  SceUID flag = sceKernelCreateEventFlag("flag", 0, 0, 0);
  psp_write32(IDS_AT + 4, (uint32_t)flag);
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
    psp_time_pass(@C_FIRST@);
    if ((frame & 7) != 7) {
      psp_time_pass(@C_SIGNAL@);
      sceKernelSignalSema(sema, 1);
    }
    psp_write32(TIMEOUTS_AT, FLAG_TIMEOUT);
    psp_time_pass(@C_FLAG_WAIT@);
    int result = sceKernelWaitEventFlag(flag, 1, HOW, OUT_AT, TIMEOUTS_AT);
    bar(BAR1, (uint32_t)result);
    bar(BAR2, psp_read32(TIMEOUTS_AT));
    psp_time_pass(@C_WAITED@);
    bar(BAR3, sceKernelGetSystemTimeLow());
    bar(BAR4, psp_read32(RESULT_AT));
    bar(BAR5, psp_read32(TIMEOUTS_AT + 4));
    bar(BAR6, psp_read32(OUT_AT));
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
