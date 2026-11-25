// The twins of the made-up Game Boy program in two parts (../../made-up-gb.mjs, madeUpParts), for the test of a game
// whose parts are its tasks (../gb.mjs): each is the original's function in C, with its contract beside it, which
// `twin` proves by the same memory. The game (main.c) calls the first, as the console calls the original's at each
// V-blank. @NUMBERS@ is filled in from made-up-gb.mjs.

#include "gb.h"

@NUMBERS@

#define RAM(address) gb_wram[(address) - 0xC000]

/** sub_0220: counts the pictures, and scrolls the background as far. */
// dp:twin sub_0220 tick()
void tick(void) {
  RAM(COUNT)++;
  gb_write(0xFF43, RAM(COUNT));
}

/** sub_0240: the background's shades, from the count turned two bits to the left, or on a Game Boy Color its first
 *  colour, the count in both its bytes. */
// dp:twin sub_0240 paint()
void paint(void) {
  uint8_t count = RAM(COUNT);
#if COLOUR
  gb_write(0xFF68, 0x80);
  gb_write(0xFF69, count);
  gb_write(0xFF69, count);
#else
  gb_write(0xFF47, (uint8_t)(count << 2 | count >> 6));
#endif
}

/** sub_0260: the background's first shades again, or on a Game Boy Color its first colour, once the count has come
 *  round to 0. */
// dp:twin sub_0260 secret()
void secret(void) {
#if COLOUR
  gb_write(0xFF68, 0x80);
  gb_write(0xFF69, DARK & 0xFF);
  gb_write(0xFF69, DARK >> 8);
#else
  gb_write(0xFF47, START_SHADES);
#endif
}

/** sub_0200: the V-blank interrupt's code: the count, from the FROM'th picture on the shades, and the first shades
 *  again once the count is 0. */
// dp:twin sub_0200 vblank()
void vblank(void) {
  tick();
  if (RAM(COUNT) >= FROM) paint();
  if (!RAM(COUNT)) secret();
}

/** sub_0040: where the console sends the processor at each V-blank, which jumps to its code. */
// dp:twin sub_0040 at_vblank()
void at_vblank(void) {
  vblank();
}
