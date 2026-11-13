// Sonic Advance Dreamport in C: the game's own code, on the Game Boy Advance kit in C (kit/gba/c/gba.h), translated
// from the JavaScript version in games/sonic-advance/src/, part by part. src/main.js runs it on the page, built to
// WebAssembly as src/game.wasm (kit/gba/c/README.md).

#include "sa.h"
#include "act.h"

// Where the original's sound work falls in the kit's chip frame, whose clock starts 71,058 cycles after the console's
// power-on: SoundMain 82,606 cycles after mGBA's frame counter ticks, give or take 8 as the main loop gets to it, the
// sound FIFO's first refill of each frame 84,969 after the tick, and the first visible line's H-blank DMA 84,778 after
// it. SoundMain's place is where the kit's writes land on average on the cycle the original's take effect, over every
// square write of amy-x-zone (#1240).
#define POWER_ON_BEFORE 71058
#define SOUND_MAIN_AT 52558
#define FIFO_REFILL_AT 54918
#define FIFO_REFILL_CYCLES 58
#define HBLANK_DMA_AT 54727

// once, with the player's copy in gba_rom: the sound engine, the save the cartridge keeps, then the console's power-on.
// Sonic Advance builds the engine with four music players, the music's and three for sound effects, and its sound mode
// (rom/sound.js): 5 DirectSound channels, master volume 15, 10512 Hz and no reverb
void game_start(void) {
  // its SoundMain runs at one place in every frame of every screen, so the sound chip's writes land where its work has
  // reached, and the squares count their time from power-on, as their phase depends on every write since (#1240)
  gba_sound_psg_at(SOUND_MAIN_AT);
  gba_sound_dma_at(FIFO_REFILL_AT, FIFO_REFILL_CYCLES, HBLANK_DMA_AT);
  gba_sound_start_library(LIBRARY_SONIC_ADVANCE, 4, 5, 15, 10512, 0);
  gba_sound_chip_clock(POWER_ON_BEFORE);
  gba_sound_count_cycles();
  save_open();
  front_start();
  if (front_special_start_point()) return;
  int level = (int)gba_start_number("level", -1);
  if (level >= 0 && !gba_start_number("power", 0)) {
    act_active = 1;
    act_start(level, (int)gba_start_number("card", -1), (int)gba_start_number("pre", 0));
  } else sound_vsync_off();   // from power-on the engine waits for GameInit's m4aSoundInit, as the console starts up
}

// what the original does each frame, writing the video hardware's registers, VRAM, colours and sprites as it does
void game_step(uint16_t keys) { front_step(keys); sound_late_step(); }
