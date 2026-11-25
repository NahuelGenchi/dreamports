// The made-up Game Boy program in two parts as a game in C (../../made-up-gb.mjs, madeUpParts), on the Game Boy kit in
// C: what its power-on does, at the cycles it does it, and then its wait for the V-blank interrupt, whose code is the
// twins' (twins.c). The T_ numbers are the cycles from one of the program's marks to the next, filled in from
// made-up-gb.mjs with the rest of @NUMBERS@.

#include "gb.h"

@NUMBERS@

#define RAM(address) gb_wram[(address) - 0xC000]

void at_vblank(void);

// a store: the time up to it, and the write
static void w(int cycles, uint16_t address, uint8_t value) {
  gb_spend(cycles);
  gb_write(address, value);
}

// the screen off, the background filled with the first tile, striped, its shades or colours, the count at zero, and
// the screen on
static void power_on(void) {
  // the two instructions at $0100, which jump to it
  gb_spend(20);
  w(T_screenOff, 0xFF40, 0x00);
  for (int i = 0; i < 0x400; i++) gb_write((uint16_t)(0x9800 + i), 0);
  for (int row = 0; row < 8; row++) {
    gb_write((uint16_t)(0x8000 + row * 2), STRIPE);
    gb_write((uint16_t)(0x8001 + row * 2), 0);
  }
#if COLOUR
  // a Game Boy Color's background's first two colours, as its shades are colours
  w(T_bcps, 0xFF68, 0x80);
  w(T_low, 0xFF69, DARK & 0xFF);
  w(T_high, 0xFF69, DARK >> 8);
  w(T_low1, 0xFF69, LIGHT & 0xFF);
  w(T_high1, 0xFF69, LIGHT >> 8);
#else
  w(T_bgp, 0xFF47, START_SHADES);
#endif
  RAM(COUNT) = 0;
  gb_write(0xFF0F, 0);
  w(T_ie, 0xFFFF, 0x01);
  w(T_screenOn, 0xFF40, 0x91);
  gb_spend(T_waits);
}

// Where the program is as a frame ends, which the next frame goes on from: waiting in its HALT, just back from the
// interrupt's code to the jump after the HALT, or past that jump and about to HALT again.
enum { HALTED, RETURNED, JUMPED };
static int at;

// the interrupt's code, about as long as the original's: what it does is all in V-blank, where its time shows nowhere
static void handle(void) {
  gb_spend(16);
  at_vblank();
  gb_spend(180);
}

static void run(void) {
  for (;;) {
    int which;
    if (at == HALTED) {
      which = gb_halt();
      if (!which) return;
      handle();
      at = RETURNED;
    }
    while ((which = gb_interrupt()) > 0) handle();
    if (which < 0) return;
    if (at == RETURNED) {
      gb_spend(12);
      at = JUMPED;
    } else at = HALTED;
  }
}

void game_start(void) {
  at = HALTED;
  power_on();
  run();
}

void game_step(uint32_t buttons) {
  (void)buttons;
  run();
}
