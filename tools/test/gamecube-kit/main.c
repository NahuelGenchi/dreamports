// The made-up GameCube program's Dreamport in C (tools/test/made-up-gamecube.mjs), on the GameCube's kit in C
// (kit/gamecube/c/), for npm run test:gamecube-kit. It does what the program does, writing the console where the program
// writes it: the video interface's registers, the framebuffer round the processor's cache, the controller's two words
// as blocks, the square on its two colours of lines, and the tone handed to the audio DMA. Its numbers, each a name
// between two at signs, are the program's own, which the test writes in from it.

#include "gamecube.h"

#define FRAMEBUFFER @FRAMEBUFFER@
#define UNCACHED @UNCACHED@
#define WIDTH @WIDTH@
#define HEIGHT @HEIGHT@
#define STEP @STEP@
#define SQUARE_Y @SQUARE_Y@
#define SQUARE_SIZE @SQUARE_SIZE@
#define TRAVEL @TRAVEL@
#define BACKGROUND @BACKGROUND@
#define SQUARE @SQUARE@
#define SQUARE_ODD @SQUARE_ODD@
#define ON @ON@
#define OFF @OFF@
#define BIT_WIDTH @BIT_WIDTH@
#define BIT_LINES @BIT_LINES@
#define BITS_X @BITS_X@
#define BITS_Y @BITS_Y@
#define BITS_GAP @BITS_GAP@
#define PAD_COMMAND @PAD_COMMAND@
#define PAD_POLL @PAD_POLL@
#define TONE @TONE@
#define TONE_BLOCKS @TONE_BLOCKS@

// the program's table of the video interface's registers, each where it is and its value, in the order it writes them
static const uint16_t video[][2] = { @VIDEO@ };
// its tone, as its values keep it in memory
static const uint8_t tone[] = { @TONE_BYTES@ };

static uint32_t x;

static void fill(uint32_t at, uint32_t value, uint32_t words) {
  for (uint32_t i = 0; i < words; i++) gc_write32(at + i * 4, value);
}

// the square, its even lines in one colour and its odd lines in the other
static void square(uint32_t left, uint32_t even, uint32_t odd) {
  uint32_t at = (FRAMEBUFFER | UNCACHED) + SQUARE_Y * WIDTH * 2 + (left >> 1) * 4;
  for (int line = 0; line < SQUARE_SIZE; line++, at += WIDTH * 2) {
    for (int pair = 0; pair < SQUARE_SIZE / 2; pair++) gc_write32(at + (uint32_t)pair * 4, even);
    uint32_t other = even;
    even = odd;
    odd = other;
  }
}

// a word's 32 bits as blocks, the highest first
static void bits(uint32_t word, uint32_t at) {
  for (int bit = 0; bit < 32; bit++, at += BIT_WIDTH * 2, word <<= 1) {
    uint32_t colour = word & 0x80000000u ? ON : OFF;
    for (int line = 0; line < BIT_LINES; line++) fill(at + (uint32_t)line * WIDTH * 2, colour, BIT_WIDTH / 2);
  }
}

void game_start(void) {
  for (unsigned i = 0; i < sizeof video / sizeof video[0]; i++) gc_write16(0xCC002000 + video[i][0], video[i][1]);
  for (unsigned i = 0; i < sizeof tone; i++) gc_write8(TONE + i, tone[i]);
  fill(FRAMEBUFFER | UNCACHED, BACKGROUND, WIDTH * HEIGHT / 2);
  square(0, SQUARE, SQUARE_ODD);
  gc_write32(SI_C0_OUT, PAD_COMMAND);
  gc_write32(SI_POLL, PAD_POLL);
  gc_write32(AI_CONTROL, 0);
  gc_write16(DSP_AUDIO_DMA_START_HI, (uint16_t)(TONE >> 16));
  gc_write16(DSP_AUDIO_DMA_START_LO, (uint16_t)TONE);
  gc_write16(DSP_AUDIO_DMA_CONTROL_LEN, (uint16_t)(0x8000 | TONE_BLOCKS));
}

void game_step(uint32_t buttons) {
  uint32_t at = (FRAMEBUFFER | UNCACHED) + BITS_Y * WIDTH * 2 + BITS_X * 2;
  bits(gc_read32(SI_C0_IN_HI), at);
  bits(gc_read32(SI_C0_IN_LO), at + BITS_GAP * WIDTH * 2);
  square(x, BACKGROUND, BACKGROUND);
  x += STEP;
  if (x >= TRAVEL) x = 0;
  square(x, SQUARE, SQUARE_ODD);
}

void game_draw(void) { gc_show(); }

void game_sound(float *left, float *right, int count) { gc_sound(left, right, count); }
