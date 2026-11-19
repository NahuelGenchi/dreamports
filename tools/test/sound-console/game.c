// A program of the project's own for npm run test:sound-console: a game that is its own sound engine, and gives the
// kit's sound hardware the registers it writes and each frame's samples for the two FIFOs. Each frame does one thing.
#include "gba.h"

static int frame;
static int8_t loud[224], quiet[224];

void game_start(void) {
  for (int i = 0; i < 224; i++) loud[i] = 64;
  gba_sound_console();
  // the sound on, FIFO A at full volume to both sides, the bias at its middle
  gba_sound_console_write(0x84, 0x80);
  gba_sound_console_write(0x82, 0x04);
  gba_sound_console_write(0x83, 0x03);
  gba_sound_console_write(0x88, 0x00);
  gba_sound_console_write(0x89, 0x02);
}

void game_step(uint16_t keys) {
  (void)keys;
  // frame 0: FIFO A holds 64. Frame 1: no samples given. Frame 2: the first square wave, loud, to both sides.
  // Frame 3: the sound switched off.
  if (frame == 0) gba_sound_console_samples(loud, quiet, 224);
  if (frame == 2) {
    gba_sound_console_write(0x80, 0x77);
    gba_sound_console_write(0x81, 0x11);
    gba_sound_console_write(0x62, 0x80);
    gba_sound_console_write(0x63, 0xF0);
    gba_sound_console_write(0x64, 0x00);
    gba_sound_console_write(0x65, 0x87);
  }
  if (frame == 3) gba_sound_console_write(0x84, 0x00);
  frame++;
}
