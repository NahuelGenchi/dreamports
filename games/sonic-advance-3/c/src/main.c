// Sonic Advance 3 Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h). src/main.js
// runs it on the page, built to WebAssembly as src/game.wasm (kit/gba/c/README.md).
//
// The game so far: the language screen, which a game with nothing saved starts with.

#include "core.h"

// 0x080BA1F4, m4aSongNumStart, reads gMPlayTable here, with four players before gSongTable
#define MPLAY_TABLE 0xEB3F0u
#define PLAYERS 4

// once, with the player's copy in gba_rom: the sound engine with the game's DEFAULT_SOUND_MODE (six DirectSound
// channels, master volume 10, 10,512 Hz, no reverb), then the console's power-on, which opens on the language screen
void game_start(void) {
  gba_sound_start_layout(MPLAY_TABLE, PLAYERS, 6, 10, 10512, 0, 0, 0);
  core_init();
  c.main = language_screen;
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { core_step(keys); }
