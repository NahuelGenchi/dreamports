// The parts program of the Super Nintendo's test of a game made a part at a time, each part a function at a time
// (../made-up-snes.mjs, madeUpPartsCartridge, and ../snes-parts.mjs) in C, on the console's kit (kit/snes/c/): a twin
// of each function its V-blank runs, with its contract beside it (../../snes/contracts.mjs), and the game's start and
// step, which call them as the original does. The test fills in each function's label, between two at signs.

#include "snes.h"

// a byte and a word at one of the console's 24-bit addresses
#define BYTE(address) (*(volatile uint8_t *)(uintptr_t)(address))
#define WORD(address) (*(volatile uint16_t *)(uintptr_t)(address))
// where the direct page's byte `at` is, in the work memory, as the console has it below $2000 of every low bank
#define DIRECT(d, at) (0x7E0000 | (uint16_t)((d) + (at)))

// dp:twin @COUNT@ a8i16 count(D) if D < 0x1E00
void count(uint16_t d) {
  WORD(DIRECT(d, 0)) = (uint16_t)(WORD(DIRECT(d, 0)) + 1);
}

// dp:twin @RED@ a8i16 red(&A, D) if D < 0x1E00 && (DB & 0x40) == 0
void red(uint16_t *a, uint16_t d) {
  uint8_t level = (uint8_t)(BYTE(DIRECT(d, 0)) & 0x1F);
  snes_write(0x2121, 0x00);
  snes_write(0x2122, level);
  snes_write(0x2122, 0x00);
  *a = (uint16_t)((*a & 0xFF00) | level);
}

// dp:twin @BLUE@ a8i16 blue(&A, D) if D < 0x1E00 && (DB & 0x40) == 0
void blue(uint16_t *a, uint16_t d) {
  uint8_t level = (uint8_t)((BYTE(DIRECT(d, 0)) & 0x1F) << 2);
  snes_write(0x2121, 0x00);
  snes_write(0x2122, 0x00);
  snes_write(0x2122, level);
  *a = (uint16_t)((*a & 0xFF00) | level);
}

// dp:twin @NMI@ a8i16 nmi(&A, D) if D < 0x1E00 && (DB & 0x40) == 0
void nmi(uint16_t *a, uint16_t d) {
  snes_read(0x4210);
  count(d);
  if (BYTE(DIRECT(d, 0)) >= 60) blue(a, d);
  else red(a, d);
}

void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = 0;
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x80);
}

// the V-blank, with the direct page at 0, where the original's start leaves it
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t a = 0;
  nmi(&a, 0);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int samples) { (void)left; (void)right; (void)samples; }
