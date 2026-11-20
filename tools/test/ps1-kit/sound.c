// The Dreamport in C of the sound program of the PlayStation's kit test (../made-up-ps1.mjs, madeUpSoundExe), written
// as a game's C on the kit is: it gives the sound chip the program's sounds and its script's writes, which
// ps1-kit.mjs fills in where the @ signs are, the sounds once, as the program moves them in, and each frame the
// script's writes for the frame, after drawing the program's bar. The program waits for the V-blank where this one's
// frame starts.

#include "ps1.h"

static const uint16_t loops[] = { @LOOPS@ };
static const uint16_t click[] = { @CLICK@ };
static const uint32_t script[] = { @SCRIPT@ };
static uint32_t count;
static unsigned next;

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
  // the chip on, the tone and the square moved in by DMA, and the click written a halfword at a time
  spu_write(SPU_BASE + 0x1AA, 0xC000);
  spu_write(SPU_BASE + 0x1A6, @TONE_AT@ >> 3);
  spu_write(SPU_BASE + 0x1AC, 4);
  spu_write(SPU_BASE + 0x1AA, 0xC020);
  spu_dma_write(loops, sizeof loops / sizeof loops[0]);
  spu_write(SPU_BASE + 0x1AA, 0xC000);
  spu_write(SPU_BASE + 0x1A6, @CLICK_AT@ >> 3);
  spu_write(SPU_BASE + 0x1AA, 0xC010);
  for (unsigned i = 0; i < sizeof click / sizeof click[0]; i++) spu_write(SPU_BASE + 0x1A8, click[i]);
  spu_write(SPU_BASE + 0x1AA, 0xC000);
}

void game_step(uint32_t buttons) {
  gpu_gp0(0x02000000 | @BACKGROUND@);
  gpu_gp0(0);
  gpu_gp0(240 << 16 | 320);
  gpu_gp0(0x60000000 | @BAR@);
  gpu_gp0(100 << 16 | (count & 0xFF));
  gpu_gp0(16 << 16 | 8);
  for (; script[next] >> 16 == count; next += 2) spu_write(0x1F800000 | (script[next] & 0xFFFF), (uint16_t)script[next + 1]);
  count++;
}

void game_draw(void) { gpu_show(); }

void game_sound(float *left, float *right, int count_) { spu_sound(left, right, count_); }
