// The made-up console's test game (any-console.mjs) in C, on the base every console's kit in C shares (kit/c/), doing
// what the JavaScript one in any-console.mjs does, line for line: what the made-up console's cartridge says
// (made-up-core.c), as a Dreamport does what its original does. It shades the cartridge's colour for the button held,
// draws a bar that moves a pixel a frame, from the frame the start point's `later` gives, and plays a square wave while a
// button is held.

#include "console.h"

static uint16_t colours[8];
static int32_t frame;
static int pressed = -1;
static int64_t phase;

void game_start(void) {
  for (int i = 0; i < 8; i++) colours[i] = (uint16_t)(kit_copy[6 + i * 2] | kit_copy[7 + i * 2] << 8);
  frame = kit_start_number("later", 0);
}

void game_step(uint32_t buttons) {
  pressed = buttons & BUTTON_A ? 1 : buttons & BUTTON_B ? 2 : buttons & BUTTON_START ? 3 : -1;
}

static uint32_t paint(uint32_t colour) {
  return 0xFF000000u | (colour & 31) << 19 | (colour >> 6 & 31) << 11 | (colour >> 11 & 31) << 3;
}

void game_draw(void) {
  int width = SCREEN_W, height = SCREEN_H;
  uint32_t *pixels = kit_screen(width, height), bar = paint(colours[4]);
  uint32_t shown = colours[pressed < 0 ? 0 : pressed];
  for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) pixels[y * width + x] = paint(shown ^ (uint32_t)(y % 12));
  for (int y = 0; y < height; y++) pixels[y * width + frame % width] = bar;
  frame++;
}

void game_sound(float *left, float *right, int count) {
  for (int i = 0; i < count; i++, phase++) left[i] = right[i] = pressed < 0 ? 0 : (phase * 880 / CONSOLE_SOUND_RATE) % 2 ? 0.5f : -0.5f;
}
