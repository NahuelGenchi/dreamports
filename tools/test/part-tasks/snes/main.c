// The Dreamport's own side of the parts program: what the kit calls, which does what the program's start and its main
// loop do, and nothing of the program's functions, which are the twins in game.c. The test writes a function that has
// no twin yet as one that does nothing, after the declarations, so the game builds on every day of it.

#include "snes.h"

void nmi(uint16_t d);
void count(uint16_t d);
void red(uint16_t *a, uint16_t d);
void blue(uint16_t *a, uint16_t d);
void bonus(uint16_t *a, uint16_t d);

@MISSING@

// as the program's start does before its loop: the count, the flag and bonus's byte at zero, the screen at its full
// brightness with no layer on it, and the V-blank's interrupt let in
void game_start(void) {
  SNES_RAM[0] = SNES_RAM[1] = SNES_RAM[2] = SNES_RAM[4] = 0;
  snes_write(0x2100, 0x0F);
  snes_write(0x4200, 0x80);
}

// a V-blank: the interrupt's handler, and a turn of the main loop, with the direct page at 0 as the start leaves it
void game_step(uint32_t buttons) {
  (void)buttons;
  uint16_t a = 0;
  nmi(0);
  count(0);
  if ((uint16_t)(SNES_RAM[0] | SNES_RAM[1] << 8) >= 1000) bonus(&a, 0);
  if (SNES_RAM[0] < 60) red(&a, 0);
  else blue(&a, 0);
}

void game_draw(void) {}
void game_sound(float *left, float *right, int samples) { (void)left; (void)right; (void)samples; }
