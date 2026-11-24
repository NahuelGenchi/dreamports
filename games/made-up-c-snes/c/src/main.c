// Made Up Game Dreamport: the game's own code, in C, on the Super Nintendo's kit in C (kit/snes/c/snes.h), with the console's screen,
// frame, sound and buttons in console.h, which the build makes from kit/consoles.js. src/main.js runs it on the page,
// built to WebAssembly as src/game.wasm (kit/snes/c/README.md).

#include "snes.h"

// once, with the player's copy in kit_copy: the console as its original starts it, which it writes to the hardware's
// registers as the original does
void game_start(void) {
}

// what the original does each frame, from its V-blank: to begin with, the screen's backdrop, colour 0, blue, and
// green while a button is held, and the screen on at full brightness
void game_step(uint32_t buttons) {
  uint16_t colour = buttons ? 0x03E0 : 0x7C00;
  snes_write(0x2121, 0x00);
  snes_write(0x2122, (uint8_t)colour);
  snes_write(0x2122, (uint8_t)(colour >> 8));
  snes_write(0x2100, 0x0F);
}

// its picture, which the kit draws from the registers
void game_draw(void) {}

// its sound, CONSOLE_SOUND_RATE samples a second, which starts as silence
void game_sound(float *left, float *right, int count) {}
