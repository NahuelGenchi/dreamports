// The made-up Nintendo DS program (made-up-nds.mjs) as a Dreamport in C, on what every console's kit in C shares
// (kit/c/), for npm run test:real-nds: what its two programs do each frame, written again, with nothing of the console's
// hardware under it yet. @MOVED@ and @PITCH@ are filled in by the test, which also makes a wrong one of it.

#include "console.h"

// the console's ten buttons as its own register has them, from the kit's bits
static uint32_t registerOf(uint32_t buttons) {
  uint32_t bits = 0;
  if (buttons & BUTTON_A) bits |= 1;
  if (buttons & BUTTON_B) bits |= 2;
  if (buttons & BUTTON_SELECT) bits |= 4;
  if (buttons & BUTTON_START) bits |= 8;
  if (buttons & BUTTON_RIGHT) bits |= 16;
  if (buttons & BUTTON_LEFT) bits |= 32;
  if (buttons & BUTTON_UP) bits |= 64;
  if (buttons & BUTTON_DOWN) bits |= 128;
  if (buttons & BUTTON_R) bits |= 256;
  if (buttons & BUTTON_L) bits |= 512;
  return bits;
}

// what the ARM7 leaves the ARM9 in the memory they share: X and Y, whether the pen is down, and where
static struct { uint32_t xy; int pen, x, y; } shared;
// each screen's colour, 15 bits, as the V-blank leaves it: the console shows it in its next frame, which is the frame
// prove compares this one with
static uint32_t upper, lower;
static uint32_t frames;
// the square wave: whether it plays, and how far along it is
static int note;
static double along;

void game_start(void) {}

void game_step(uint32_t buttons) {
  // the V-blank: the ARM9 counts it and reads its buttons, and the ARM7 reads X, Y and the pen
  frames++;
  upper = (frames & 31) | registerOf(buttons) << 5;
  int x, y, pen = kit_touch(&x, &y);
  uint32_t xy = (buttons & BUTTON_X ? 1 : 0) | (buttons & BUTTON_Y ? 2 : 0);
  // with the pen up the ARM7 has written before the ARM9 reads; with it down it's still asking the touch screen's
  // chip, so the ARM9 reads what the frame before left
  if (!pen) { shared.xy = xy; shared.pen = 0; }
  lower = shared.pen ? 0x4000 | ((shared.x * 16) >> 7) | ((shared.y * 16) >> 7) << 5 : shared.xy << 10;
  if (pen) { shared.xy = xy; shared.pen = 1; shared.x = x + @MOVED@; shared.y = y; }
  note = (buttons & BUTTON_A) != 0;
}

static uint32_t paint(uint32_t colour) {
  return 0xFF000000u | (colour >> 10 & 31) << 19 | (colour >> 5 & 31) << 11 | (colour & 31) << 3;
}

void game_draw(void) {
  uint32_t *pixels = kit_screen(SCREEN_W, SCREEN_H);
  for (int i = 0; i < SCREEN_0_W * SCREEN_0_H; i++) pixels[SCREEN_0_Y * SCREEN_W + i] = paint(upper);
  for (int i = 0; i < SCREEN_1_W * SCREEN_1_H; i++) pixels[SCREEN_1_Y * SCREEN_W + i] = paint(lower);
}

// the ninth channel's square wave, as loud as the mixer goes, while the ARM7 has it on
void game_sound(float *left, float *right, int count) {
  for (int i = 0; i < count; i++) {
    if (!note) { along = 0; continue; }
    left[i] = right[i] = along < 0.5 ? -256 / 512.0f : 255 / 512.0f;
    along += @PITCH@ / CONSOLE_SOUND_RATE;
    if (along >= 1) along -= 1;
  }
}
