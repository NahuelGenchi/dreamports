// The Dreamport in C of the small program in tools/test/made-up-psp.mjs (madeUpPsp), for npm run test:psp-kit: what
// the program does, written again on the PlayStation Portable's kit in C. The test puts the program's own numbers
// in the names between at signs. It paints the framebuffer itself, as the program does, reads the buttons and the
// stick each frame, shows what the system answers as bars, and a second thread plays the wave a block at a time.
// After each stretch of its own code it says how many of the processor's cycles the program's instructions took
// there, so what the console does meanwhile falls where it does under the program.

#include "psp.h"

enum {
  LINE = @LINE@, SQUARE_Y = @SQUARE_Y@, SQUARE_SIZE = @SQUARE_SIZE@, STEP = @STEP@, TURN = @TURN@,
  THREAD_Y = @THREAD_Y@, TIME_Y = @TIME_Y@, BAR_Y = @BAR_Y@, STICK_Y = @STICK_Y@, TIME_AGAIN_Y = @TIME_AGAIN_Y@, BAR_HEIGHT = @BAR_HEIGHT@,
  BLOCK = @BLOCK@, HALF_WAVE = @HALF_WAVE@, LOUD = @LOUD@, VOLUME = @VOLUME@,
};
#define BACKGROUND @BACKGROUND@u
#define SQUARE @SQUARE@u
#define BAR @BAR@u
// where the program keeps its wave and what it reads of the pad, in the console's memory
#define WAVE_AT @WAVE_AT@u
#define PAD_AT @PAD_AT@u

// a rectangle of one colour, a word a pixel, and the cycles the program's loop takes over it: four instructions a
// pixel and five more a line
static void paint(int x, int y, int width, int height, uint32_t colour) {
  for (int row = 0; row < height; row++) {
    uint32_t *line = psp_memory(PSP_VRAM + (uint32_t)((y + row) * LINE + x) * 4);
    for (int at = 0; at < width; at++) line[at] = colour;
  }
  psp_time_pass((uint32_t)(height * (4 * width + 5)));
}
// a bar `width` wide on line `y`, after its whole band is painted off
static void bar(int y, uint32_t width) {
  paint(0, y, SCREEN_W, BAR_HEIGHT, BACKGROUND);
  paint(0, y, (int)width, BAR_HEIGHT, BAR);
}

static int sound(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  psp_time_pass(@C_RESERVE@);
  int channel = sceAudioChReserve(-1, BLOCK, PSP_AUDIO_STEREO);
  psp_time_pass(@C_FIRST_OUTPUT@);
  for (;;) {
    sceAudioOutputBlocking(channel, VOLUME, WAVE_AT);
    psp_time_pass(@C_OUTPUT@);
  }
  return 0;
}

void game_start(void) {
  // what the program's file holds as it's loaded: a block of the wave, left and right the same
  int16_t *wave = psp_memory(WAVE_AT);
  for (int sample = 0; sample < BLOCK; sample++) wave[sample * 2] = wave[sample * 2 + 1] = sample % (HALF_WAVE * 2) < HALF_WAVE ? LOUD : -LOUD;

  psp_time_pass(@C_MODE@);
  sceDisplaySetMode(0, SCREEN_W, SCREEN_H);
  paint(0, 0, SCREEN_W, SCREEN_H, BACKGROUND);
  psp_time_pass(@C_FRAMEBUFFER@);
  sceDisplaySetFrameBuf(PSP_VRAM | 0x40000000, LINE, PSP_FORMAT_8888, PSP_SETBUF_NEXTFRAME);
  psp_time_pass(@C_CYCLE@);
  sceCtrlSetSamplingCycle(0);
  psp_time_pass(@C_ANALOG@);
  sceCtrlSetSamplingMode(1);
  psp_time_pass(@C_CREATE@);
  SceUID thread = sceKernelCreateThread("sound", sound, 0x18, 0x4000, 0, 0);
  bar(THREAD_Y, ((uint32_t)thread & 0xFF) + 1);
  psp_time_pass(@C_START@);
  sceKernelStartThread(thread, 0, 0);
  psp_time_pass(@C_LOOP@);
  for (int x = 0;;) {
    psp_time_pass(@C_WAIT@);
    sceDisplayWaitVblankStart();
    psp_time_pass(@C_TIME@);
    uint32_t time = sceKernelGetSystemTimeLow();
    psp_time_pass(@C_CLOCK@);
    bar(TIME_Y, (time & 0xFF) + 1);
    // the square off where it was, the whole of its band, and on where it is now
    paint(0, SQUARE_Y, SCREEN_W, SQUARE_SIZE, BACKGROUND);
    paint(x, SQUARE_Y, SQUARE_SIZE, SQUARE_SIZE, SQUARE);
    psp_time_pass(@C_SQUARE@ + @C_PAD@);
    sceCtrlPeekBufferPositive(PAD_AT, 1);
    // the buttons' bar: as many pixels as the low eight bits of what's held, with the eight above them, and one more
    uint32_t held = psp_read32(PAD_AT + 4);
    psp_time_pass(@C_HELD@);
    bar(BAR_Y, ((held ^ held >> 8) & 0xFF) + 1);
    // and the stick's: half of how far across it is and a quarter of how far down, and one more
    psp_time_pass(@C_STICK@);
    bar(STICK_Y, (uint32_t)(psp_read8(PAD_AT + 8) >> 1) + (uint32_t)(psp_read8(PAD_AT + 9) >> 2) + 1);
    psp_time_pass(@C_TIME@);
    time = sceKernelGetSystemTimeLow();
    psp_time_pass(@C_CLOCK@);
    bar(TIME_AGAIN_Y, (time & 0xFF) + 1);
    x += STEP;
    psp_time_pass(@C_NEXT@);
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
