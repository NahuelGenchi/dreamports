// The Dreamport in C of the small program in tools/test/made-up-psp-ge.mjs (madeUpPspGe), for npm run test:psp-kit:
// what the program does, written again on the PlayStation Portable's kit in C. The test puts the program's own numbers
// and its lists' words in the names between at signs. It hands the graphics chip the program's three lists each frame,
// as the program does, with the square moved and the bars as wide as what the system answered, and after each stretch
// of its own code it says how many of the processor's cycles the program's instructions took there.

#include "psp.h"

#define MAIN_AT @MAIN_AT@u
#define MAIN_END @MAIN_END@u
#define BARS_AT @BARS_AT@u
#define TINY_AT @TINY_AT@u
// what the program's file holds as it's loaded: its lists, with their vertices
static const uint32_t MAIN_LIST[] = { @MAIN_WORDS@ };
static const uint32_t BARS_LIST[] = { @BARS_WORDS@ };
static const uint32_t TINY_LIST[] = { @TINY_WORDS@ };
// where the square's corners and the bars' right edges are in them
enum { SQUARE_LEFT = @SQUARE_LEFT@, SQUARE_RIGHT = @SQUARE_RIGHT@, BAR0 = @BAR0@, BAR1 = @BAR1@, BAR2 = @BAR2@, BAR3 = @BAR3@ };
enum { LINE = @LINE@, SQUARE_SIZE = @SQUARE_SIZE@, STEP = @STEP@, TURN = @TURN@ };

static void put(uint32_t at, const uint32_t *words, unsigned count) {
  for (unsigned i = 0; i < count; i++) psp_write32(at + i * 4, words[i]);
}
// a bar as wide as the low eight bits of what the system answered, and one more
static void bar(uint32_t edge, uint32_t value) { psp_write16(BARS_AT + edge, (uint16_t)((value & 0xFF) + 1)); }

void game_start(void) {
  put(MAIN_AT, MAIN_LIST, sizeof MAIN_LIST / 4);
  put(BARS_AT, BARS_LIST, sizeof BARS_LIST / 4);
  put(TINY_AT, TINY_LIST, sizeof TINY_LIST / 4);

  psp_time_pass(@C_MODE@);
  sceDisplaySetMode(0, SCREEN_W, SCREEN_H);
  psp_time_pass(@C_FRAMEBUFFER@);
  sceDisplaySetFrameBuf(PSP_VRAM | 0x40000000, LINE, PSP_FORMAT_8888, PSP_SETBUF_NEXTFRAME);
  psp_time_pass(@C_LOOP@);
  for (int x = 0;;) {
    psp_time_pass(@C_WAIT@);
    sceDisplayWaitVblankStart();
    psp_time_pass(@C_TIME@);
    uint32_t time = sceKernelGetSystemTimeLow();
    bar(BAR0, time);
    psp_write16(MAIN_AT + SQUARE_LEFT, (uint16_t)x);
    psp_write16(MAIN_AT + SQUARE_RIGHT, (uint16_t)(x + SQUARE_SIZE));
    psp_time_pass(@C_FIRST@);
    sceGeListEnQueue(TINY_AT, 0, -1, 0);
    // the main list, stalled at its first command, then let go to its end
    psp_time_pass(@C_MAIN@);
    int list = sceGeListEnQueue(MAIN_AT, MAIN_AT, -1, 0);
    bar(BAR1, (uint32_t)list);
    psp_time_pass(@C_STALL@);
    sceGeListUpdateStallAddr(list, MAIN_END);
    psp_time_pass(@C_DRAW@);
    sceGeDrawSync(0);
    psp_time_pass(@C_TIME@);
    time = sceKernelGetSystemTimeLow();
    bar(BAR2, time);
    psp_time_pass(@C_BARS@);
    int bars = sceGeListEnQueue(BARS_AT, 0, -1, 0);
    psp_time_pass(@C_SYNC@);
    sceGeListSync(bars, 0);
    psp_time_pass(@C_TIME@);
    time = sceKernelGetSystemTimeLow();
    bar(BAR3, time);
    x += STEP;
    psp_time_pass(@C_LAST@);
    if (x == TURN) {
      x = 0;
      psp_time_pass(@C_TURNED@);
    }
  }
}

void game_step(uint32_t buttons) { (void)buttons; }
void game_draw(void) { psp_show(); }
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
