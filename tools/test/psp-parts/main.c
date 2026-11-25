// The Dreamport in C of the program madeUpPspParts writes (tools/test/made-up-psp-twin.mjs), for npm run test:psp-parts:
// its start, which the kit runs as the program's first thread, and a twin of each function it calls each frame, each
// naming its original's address in the comment above it, which the test puts in the names between at signs.

#include "psp.h"

#define COUNTER @COUNTER@u

/** @COUNT@: one more frame, kept in memory */
uint32_t count(void) {
  uint32_t *frames = (uint32_t *)COUNTER;
  *frames = *frames + 1;
  return *frames;
}

/** @RED@: a red that changes with the frame */
uint32_t red(uint32_t frame) {
  return 0xFF000000u | ((frame << 2) & 0xFF);
}

/** @BLUE@: a blue that changes with the frame */
uint32_t blue(uint32_t frame) {
  return 0xFF000000u | (((frame << 1) & 0xFF) << 16);
}

/** @PAINT@: count words of one colour from to */
void paint(uint32_t *to, int count, uint32_t colour) {
  while (count != 0) {
    *to++ = colour;
    count--;
  }
}

void game_start(void) {
  sceDisplaySetMode(0, SCREEN_W, SCREEN_H);
  sceDisplaySetFrameBuf(PSP_VRAM, 512, PSP_FORMAT_8888, PSP_SETBUF_NEXTFRAME);
  for (;;) {
    sceDisplayWaitVblankStart();
    uint32_t frame = count();
    paint((uint32_t *)PSP_VRAM, 512 * 272, frame < 60 ? red(frame) : blue(frame));
  }
}

void game_step(uint32_t buttons) { (void)buttons; }
void game_draw(void) { psp_show(); }
void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
