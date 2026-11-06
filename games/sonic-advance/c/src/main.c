// Sonic Advance Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-advance/src/, part by part. src/main.js runs it on the page, built to
// WebAssembly as src/game.wasm (kit/gba/c/README.md).

#include "sa.h"

// once, with the player's copy in gba_rom: the save the cartridge keeps, then the console's power-on
void game_start(void) {
  save_open();
  front_start();
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { front_step(keys); }
