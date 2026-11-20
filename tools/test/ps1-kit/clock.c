// The Dreamport in C of the clock program of the PlayStation's kit test (../made-up-ps1.mjs, madeUpClockExe), written
// as a game's C on the kit is: it starts the root counters and lets in their interrupts and the V-blank's as the
// program does, counts each in its handler, the twin of the program's, and each frame draws the counts as bars.
// ps1-kit.mjs fills in its numbers where the @ signs are.

#include "ps1.h"

static uint32_t counts[3];
static const uint32_t colours[3] = { @BAR_0@, @BAR_1@, @BAR_2@ };

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
  timer_write(0x1F801108, @TARGET_0@);
  timer_write(0x1F801104, 0x58);
  timer_write(0x1F801128, @TARGET_2@);
  timer_write(0x1F801124, 0x258);
  irq_write(0x1F801070, 0);
  irq_write(0x1F801074, 0x51);
  ps1_interrupts(1);
}

void game_interrupt(void) {
  uint32_t pending = irq_read(0x1F801070) & irq_read(0x1F801074);
  irq_write(0x1F801070, ~pending);
  if (pending & 0x01) counts[0]++;
  if (pending & 0x10) counts[1]++;
  if (pending & 0x40) counts[2]++;
}

void game_step(uint32_t buttons) {
  gpu_gp0(0x02000000 | @BACKGROUND@);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  for (int i = 0; i < 3; i++) {
    gpu_gp0(0x60000000 | colours[i]);
    gpu_gp0((uint32_t)(60 + i * 40) << 16 | 20);
    gpu_gp0(16 << 16 | ((counts[i] & 0xFF) + 1));
  }
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count) { spu_sound(left, right, count); }
