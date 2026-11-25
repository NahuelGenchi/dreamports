// The Dreamport in C of the small program in tools/test/made-up-psp-vfpu.mjs (madeUpPspVfpu), for npm run
// test:psp-kit: what the program does, written again on the PlayStation Portable's kit in C. The test puts the
// program's own numbers, its list's words and its vector unit's instructions in the names between at signs. Its two
// threads with a vector unit of their own run the same instructions through the kit's (kit/psp/c/vfpu.c), each by its
// word as the program has it, and after each stretch of its own code it says how many of the processor's cycles the
// program's instructions took there, two for each of the vector unit's.

#include "psp.h"

#define BARS_AT @BARS_AT@u
#define INPUTS_AT @INPUTS_AT@u
#define RESULTS_AT @RESULTS_AT@u
static const uint32_t BARS_LIST[] = { @BARS_WORDS@ };
static const uint32_t SUMS[] = { @SUMS_WORDS@ };
static const uint32_t OTHER[] = { @OTHER_WORDS@ };
enum { LINE = @LINE@, WORDS = @WORDS@, FIRST_EDGE = @FIRST_EDGE@, SUMS_PRIORITY = @SUMS_PRIORITY@, OTHER_PRIORITY = @OTHER_PRIORITY@, STACK = @STACK@, ATTR_VFPU = @ATTR_VFPU@ };
// the register the program's loads take their address from: t2 has the inputs, and every other the results
enum { T2 = 10 };

// the vector unit's instructions in `words`, each through the kit as the program runs it
static void run(const uint32_t *words, unsigned count) {
  for (unsigned i = 0; i < count; i++) {
    uint32_t word = words[i], op = word >> 26, base = ((word >> 21) & 31) == T2 ? INPUTS_AT : RESULTS_AT;
    if (op == 0x32 || op == 0x36) psp_vfpu_load(word, base);
    else if (op == 0x3A || op == 0x3E) psp_vfpu_store(word, base);
    else psp_vfpu(word);
  }
}

static int sums(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  psp_vfpu(@VZERO_C700@);
  psp_time_pass(@C_SUMS_START@);
  for (uint32_t frame = 0;; frame++) {
    psp_time_pass(@C_SUMS_WAIT@);
    sceDisplayWaitVblankStart();
    // four whole numbers from the frame's number, then the sums
    psp_write32(INPUTS_AT, frame);
    psp_write32(INPUTS_AT + 4, frame * 5 + 3);
    psp_write32(INPUTS_AT + 8, 300 - frame);
    psp_write32(INPUTS_AT + 12, frame ^ 0xA5);
    run(SUMS, sizeof SUMS / 4);
    psp_time_pass(@C_SUMS@ + @C_SUMS_NEXT@);
  }
  return 0;
}

static int other(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  for (;;) {
    psp_time_pass(@C_OTHER_WAIT@);
    sceDisplayWaitVblankStart();
    run(OTHER, sizeof OTHER / 4);
    psp_time_pass(@C_OTHER@ + @C_OTHER_NEXT@);
  }
  return 0;
}

void game_start(void) {
  for (unsigned i = 0; i < sizeof BARS_LIST / 4; i++) psp_write32(BARS_AT + i * 4, BARS_LIST[i]);

  psp_time_pass(@C_MODE@);
  sceDisplaySetMode(0, SCREEN_W, SCREEN_H);
  psp_time_pass(@C_FRAMEBUFFER@);
  sceDisplaySetFrameBuf(PSP_VRAM | 0x40000000, LINE, PSP_FORMAT_8888, PSP_SETBUF_NEXTFRAME);
  psp_time_pass(@C_CREATE_SUMS@);
  SceUID first = sceKernelCreateThread("sums", sums, SUMS_PRIORITY, STACK, ATTR_VFPU, 0);
  psp_time_pass(@C_START_SUMS@);
  sceKernelStartThread(first, 0, 0);
  psp_time_pass(@C_CREATE_OTHER@);
  SceUID second = sceKernelCreateThread("other", other, OTHER_PRIORITY, STACK, ATTR_VFPU, 0);
  psp_time_pass(@C_START_OTHER@);
  sceKernelStartThread(second, 0, 0);
  for (;;) {
    psp_time_pass(@C_WAIT@);
    sceDisplayWaitVblankStart();
    // each word the threads stored, its four bytes folded into one, as wide a bar and one more
    for (unsigned i = 0; i < WORDS; i++) {
      uint32_t word = psp_read32(RESULTS_AT + i * 4);
      word ^= word >> 16;
      word ^= word >> 8;
      psp_write16(BARS_AT + FIRST_EDGE + i * 24, (uint16_t)((word & 0xFF) + 1));
    }
    psp_time_pass(@C_BARS@ + WORDS * @C_FOLD@ + @C_DRAW@);
    sceGeListEnQueue(BARS_AT, 0, -1, 0);
    psp_time_pass(@C_DRAW_SYNC@);
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
