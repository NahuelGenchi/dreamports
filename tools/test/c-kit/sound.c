// A game with nothing of its own, for the C kit's sound test (c-kit.mjs): the test reaches the kit's sound through what
// the page calls (sound.c's dp_sound_ functions), as the audio thread's copy does.

#include "gba.h"

void game_start(void) {}
void game_step(uint16_t keys) { (void)keys; }
