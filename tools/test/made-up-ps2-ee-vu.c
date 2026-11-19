// The program of tools/test/made-up-ps2-ee-vu.mjs as a Dreamport in C, a twin of its EE code: its memory as its ELF
// loads it, then each frame the same steps, the sums done with the kit's ee_ and MMI functions and the registers written
// with ps2_write32, so the kit's DMA controller, VIFs, vector units and GIF do the rest as the console's do. The test
// fills in the numbers, the memory and the steps from the same list the program's own code is made from
// (ps2-ee-vu.mjs).

#include "ps2.h"
#include "mmi.h"

#define FIN @FIN@u
#define IIN @IIN@u
#define QIN @QIN@u
#define CONSTANTS @CONSTANTS@u
#define SPECIAL @SPECIAL@u
#define FIFOS @FIFOS@u
#define RESULTS_AT @RESULTS_AT@u
#define RESULT_CODES @RESULT_CODES@u

// the program's memory as its ELF loads it: each block's place, its length in words and its words
@BLOCKS@

static uint32_t frame;

static uint32_t word(uint32_t at) {
  uint32_t value;
  __builtin_memcpy(&value, ee_memory() + at, 4);
  return value;
}
static void put_word(uint32_t at, uint32_t value) { __builtin_memcpy(ee_memory() + at, &value, 4); }
static float word_float(uint32_t at) {
  float value;
  __builtin_memcpy(&value, ee_memory() + at, 4);
  return value;
}
static void put_float(uint32_t at, float value) { __builtin_memcpy(ee_memory() + at, &value, 4); }
static uint32_t float_word(float value) {
  uint32_t bits;
  __builtin_memcpy(&bits, &value, 4);
  return bits;
}
static ee_quad quad(uint32_t at) {
  ee_quad value;
  __builtin_memcpy(&value, ee_memory() + at, 16);
  return value;
}
static void put_quad(uint32_t at, ee_quad value) { __builtin_memcpy(ee_memory() + at, &value, 16); }
static void put_double(uint32_t at, uint64_t value) { __builtin_memcpy(ee_memory() + at, &value, 8); }
// vector unit 0's registers, as LQC2 loads one from memory and SQC2 stores one
static void load_vector(vu_vector *to, uint32_t at) { __builtin_memcpy(to, ee_memory() + at, 16); }
static void put_vector(uint32_t at, const vu_vector *from) { __builtin_memcpy(ee_memory() + at, from, 16); }
// waiting for a DMA channel to end, as the program does, by reading its CHCR until STR is clear
static void wait_for(uint32_t channel) {
  for (long tries = 0; ps2_read32(channel + DMA_CHCR) & 0x100; tries++) if (tries > 1000) __builtin_trap();
}

void game_start(void) {
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, 10 << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (640 * 4 - 1) | (448 - 1) << 12);
  for (unsigned i = 0; i < sizeof blocks / sizeof blocks[0]; i++) __builtin_memcpy(ee_memory() + blocks[i].at, blocks[i].words, blocks[i].count * 4);
  ps2_write32(D_CTRL, 1);
}

void game_step(uint32_t buttons) {
@STEPS@
  frame++;
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
