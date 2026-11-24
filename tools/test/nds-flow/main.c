// The made-up Nintendo DS program's Dreamport in C (../made-up-nds-parts.mjs), on what every console's kit in C shares
// (kit/c/): each frame calls the twins where the original calls its functions, and colours the two screens as the
// original does. The upper screen's colour is filled in by the test (nds-flow.mjs), which also makes a wrong one of it.

#include "console.h"
#include "game.h"

static struct state state;

void game_start(void) {}

void game_step(uint32_t buttons) {
  state.keys = buttons & BUTTON_A ? 1 : 0;
  tick(&state);
  if (state.keys & 1) bump(&state);
}

static uint32_t paint(uint32_t colour) {
  return 0xFF000000u | (colour >> 10 & 31) << 19 | (colour >> 5 & 31) << 11 | (colour & 31) << 3;
}

void game_draw(void) {
  uint32_t *pixels = kit_screen(SCREEN_W, SCREEN_H);
  for (int i = 0; i < SCREEN_0_W * SCREEN_0_H; i++) pixels[SCREEN_0_Y * SCREEN_W + i] = paint(@SHOWN@);
  for (int i = 0; i < SCREEN_1_W * SCREEN_1_H; i++) pixels[SCREEN_1_Y * SCREEN_W + i] = paint(state.lower);
}

void game_sound(float *left, float *right, int count) {}
