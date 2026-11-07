// Sonic Advance 2 Dreamport: the game's own code, in C, on the Game Boy Advance kit in C (kit/gba/c/gba.h).
// src/main.js runs it on the page, built to WebAssembly as src/game.wasm (kit/gba/c/README.md).

#include "gba.h"

// once, with the player's copy in gba_rom
void game_start(void) {}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does.
// To begin with, the screen's backdrop: blue, and green while a button is held.
void game_step(uint16_t keys) { gba_pal[0] = keys ? 0x03E0 : 0x7C00; }
