// For the C kit's test (c-kit.mjs): a game that counts how many times it has started in its save memory, kept by
// the page in the browser or by native.c in a file, and shows the count as the backdrop's red.

#include "gba.h"

static uint8_t *save;

void game_start(void) {
  save = gba_save(32);
  // a save memory never written holds 0xFF, as a cartridge's does
  save[0] = save[0] == 0xFF ? 1 : save[0] + 1;
  gba_save_write();
}

void game_step(uint16_t keys) { gba_pal[0] = save[0] & 0x1F; }
