// The Dreamport's own side of the small program: what the kit calls, and nothing of the cartridge's. The program
// itself, cart.c, is the cartridge's C unchanged, its start and its waits included.
#include "cart.h"

// nothing here is the cartridge's, so the console's compiler, which builds the cartridge's C alone, is given none of it
#ifndef MATCHING

u16 cart_keys;

// Once: the console's memory at the console's addresses, the cartridge's with it, the screen as the console has it at
// power-on, and the console's first frame, in which the program only waits, and which the proof tools don't count.
void game_start(void) {
  gba_console_memory(1);
  gba_write(REG_DISPCNT, 0x80);
}

// every frame: the program goes on from where it last waited, with the buttons the V-blank finds held
void game_step(uint16_t keys) {
  (void)keys;
  cart_keys = gba_vblank_keys();
}

// from an address kept in memory to the twin to call
TWIN_TABLE

#endif
