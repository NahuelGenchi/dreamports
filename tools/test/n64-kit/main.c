// The Dreamport in C of the made-up program of the Nintendo 64's kit test (../made-up-n64.mjs, madeUpKitCartridge),
// written as a game's C on the kit is: it writes the console where the program does, the same words with the same
// numbers, which n64-kit.mjs fills in where the @ signs are, and the RSP runs the program's own microcodes, the square's
// and the vector check's, copied from the player's copy as the program copies them. The program's first turn of its loop comes before the console shows its
// first frame, so game_start takes it, and each frame after is one more. It waits for the video interface's interrupt
// where each turn starts, and for the RSP and the RDP, which the kit finishes at once, so its waits are reads that find
// them done.

#include "n64.h"

static const uint32_t commands[] = { @COMMANDS@ };
static uint32_t x, frame;

// one turn of the program's loop
static void draw(void) {
  // the video interface's interrupt, and then it's told it was seen
  if (n64_read32(MI_INTR) & MI_INTR_VI) n64_write32(VI_V_CURRENT, 0);
  // where the square is, and this frame's shade, which the microcode adds to its colour
  n64_write32(SP_DMEM + 0x000, x);
  n64_write16(SP_DMEM + 0x020, (uint16_t)((frame & 15) * @SHADE@));
  // the RSP started from its first instruction, to interrupt at its break, and its interrupt seen once it halts
  n64_write32(SP_PC, 0);
  n64_write32(SP_STATUS, 0x105);
  if (n64_read32(SP_STATUS) & 1) n64_write32(SP_STATUS, 0x8);
  // the RDP's full sync, and then it's told it was seen
  if (n64_read32(MI_INTR) & MI_INTR_DP) n64_write32(MI_MODE, 0x800);
  // the vector check, the RSP's second task, and its interrupt seen once it halts
  n64_write32(SP_PC, @VECTOR_AT@);
  n64_write32(SP_STATUS, 0x105);
  if (n64_read32(SP_STATUS) & 1) n64_write32(SP_STATUS, 0x8);
  // the square moves on, round and round
  x += @STEP@;
  if (x > @LAST_X@) x = 0;
  frame++;
}

void game_start(void) {
  // as the cartridge's boot does, the program copied into RDRAM from the cartridge
  n64_write32(PI_DRAM_ADDR, @LOAD@ & 0x1FFFFFFF);
  n64_write32(PI_CART_ADDR, 0x10001000);
  n64_write32(PI_WR_LEN, 0x2000 - 1);
  // the video interface: 16-bit colour, no filtering, every pixel shown twice across, 240 lines
  n64_write32(VI_ORIGIN, @FRAMEBUFFER@);
  n64_write32(VI_WIDTH, 320);
  n64_write32(VI_V_INTR, 2);
  n64_write32(VI_BURST, 0x03E52239);
  n64_write32(VI_V_SYNC, 0x20D);
  n64_write32(VI_H_SYNC, 0xC15);
  n64_write32(VI_LEAP, 0x0C150C15);
  n64_write32(VI_H_START, 0x006C02EC);
  n64_write32(VI_V_START, 0x002501FF);
  n64_write32(VI_V_BURST, 0x000E0204);
  n64_write32(VI_X_SCALE, 0x200);
  n64_write32(VI_Y_SCALE, 0x400);
  n64_write32(VI_STATUS, 0x3302);
  // the RDP's commands in the RSP's data memory, and the colours the vector unit adds, the square's in the first
  for (uint32_t n = 0; n < sizeof commands / sizeof commands[0]; n++) n64_write32(SP_DMEM + 0x100 + n * 4, commands[n]);
  n64_write32(SP_DMEM + 0x10, (uint32_t)@SQUARE@ << 16);
  for (uint32_t at = 0x14; at < 0x30; at += 4) n64_write32(SP_DMEM + at, 0);
  // the microcode copied into the RSP's instructions
  n64_write32(SP_MEM_ADDR, 0x1000);
  n64_write32(SP_DRAM_ADDR, @MICROCODE@ & 0x1FFFFFFF);
  n64_write32(SP_RD_LEN, @MICROCODE_BYTES@ - 1);
  draw();
}

void game_step(uint32_t buttons) { draw(); }

void game_draw(void) { n64_show(); }

void game_sound(float *left, float *right, int count) {}
