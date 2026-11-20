// The Dreamport in C of the drawing program of the PlayStation's kit test (../made-up-ps1.mjs, madeUpDrawExe), written
// as a game's C on the kit is: it sends the GPU the program's words, which ps1-kit.mjs fills in where the @ signs are,
// textures once and a frame's every frame, after the drawing offset the frame's count gives. The program waits for
// the V-blank where this one's frame starts.

#include "ps1.h"

static const uint32_t setup[] = { @SETUP@ };
static const uint32_t frame[] = { @FRAME@ };
static uint32_t count;

void game_start(void) {
  gpu_gp1(0x00000000);
  gpu_gp1(0x08000001);
  gpu_gp1(0x06C60260);
  gpu_gp1(0x07040010);
  gpu_gp1(0x05000000);
  gpu_gp1(0x03000000);
  gpu_gp0(0xE3000000);
  gpu_gp0(0xE403BD3F);
  for (unsigned i = 0; i < sizeof setup / sizeof setup[0]; i++) gpu_gp0(setup[i]);
}

void game_step(uint32_t buttons) {
  gpu_gp0(0xE5000000 | (count >> 1 & 31) << 11 | (count & 63));
  for (unsigned i = 0; i < sizeof frame / sizeof frame[0]; i++) gpu_gp0(frame[i]);
  count++;
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count_) {}
