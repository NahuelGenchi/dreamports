// The Dreamport's own side of the small program: what the kit calls, and the one function that isn't the cartridge's
// C. The program itself, cart.c, is the cartridge's C unchanged, its start and its waits included.
#include "cart.h"

u16 cart_keys;

/** WaitFrame, 0x08000680: where the cartridge watches the line the console is drawing, the Dreamport ends its frame. */
void WaitFrame(void) { kit_wait_frame(); }

// Once: the console's memory at the console's addresses, the cartridge's with it, the screen as the console has it at
// power-on, and the console's first frame, in which the program only waits, and which the proof tools don't count.
void game_start(void) {
  gba_console_memory(1);
  gba_write(REG_DISPCNT, 0x80);
  kit_run(AgbMain);
}

// every frame: the program goes on from where it last waited, with the buttons the V-blank finds held
void game_step(uint16_t keys) {
  (void)keys;
  cart_keys = gba_vblank_keys();
  kit_run(AgbMain);
}

// from an address kept in memory to the twin to call
TWIN_TABLE
