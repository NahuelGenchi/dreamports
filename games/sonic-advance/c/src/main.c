// Sonic Advance Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-advance/src/, part by part. src/main.js runs it on the page, built to
// WebAssembly as src/game.wasm (kit/gba/c/README.md).

#include "sa.h"
#include "act.h"

// once, with the player's copy in gba_rom: the sound engine, the save the cartridge keeps, then the console's power-on.
// Sonic Advance builds the engine with four music players, the music's and three for sound effects, and its sound mode
// (rom/sound.js): 5 DirectSound channels, master volume 15, 10512 Hz and no reverb
void game_start(void) {
  gba_sound_start(4, 5, 15, 10512, 0);
  gba_sound_count_cycles();
  save_open();
  front_start();
  int level = (int)gba_start_number("level", -1);
  if (level >= 0 && !gba_start_number("power", 0)) {
    act_active = 1;
    act_start(level, (int)gba_start_number("card", -1), (int)gba_start_number("pre", 0));
  }
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { front_step(keys); }
