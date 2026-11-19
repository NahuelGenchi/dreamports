// The Dreamport in C of the made-up program of the PlayStation's kit test (../made-up-ps1.mjs, madeUpGpuExe), written as
// a game's C on the kit is: it writes the GPU as the program does, the same words, with the same numbers, which
// ps1-kit.mjs fills in where the @ signs are. The program waits for the V-blank where this one's frame starts.

#include "ps1.h"

static uint32_t x;

void game_start(void) {
  gpu_gp1(0x00000000);
  gpu_gp1(0x08000001);
  gpu_gp1(0x06C60260);
  gpu_gp1(0x07040010);
  gpu_gp1(0x05000000);
  gpu_gp1(0x03000000);
  gpu_gp0(0xE3000000);
  gpu_gp0(0xE403BD3F);
  gpu_gp0(0xE5000000);
}

void game_step(uint32_t buttons) {
  gpu_gp0(0x02000000 | @BACKGROUND@);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  gpu_gp0(0x60000000 | @SQUARE@);
  gpu_gp0((uint32_t)@SQUARE_Y@ << 16 | x);
  gpu_gp0(@SIZE@ << 16 | @SIZE@);
  x = (x + @STEP@) & 0xFF;
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count) {}
