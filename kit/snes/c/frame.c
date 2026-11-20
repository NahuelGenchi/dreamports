// A game in C on the Super Nintendo's kit: what the page calls, by name, to start it, run its frames, draw them and
// hear them. Each frame the kit runs the game's step, what its original does in a V-blank and after it, and then draws
// the lines the console draws next, from the registers as the step left them, as `prove` compares a Dreamport's frame
// with the original's next one.

#include "snes-kit.h"
#include "page.h"

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];
static uint32_t frame[SNES_WIDTH * SNES_HEIGHT];

/** Starts the game, with the console as it powers on. */
EXPORT("dp_start") void dp_start(void) {
  cartridge_load();
  ppu_power();
  // the work memory as the reference emulator powers it on
  for (uint32_t i = 0; i < SNES_RAM_SIZE; i++) SNES_RAM[i] = 0x55;
  for (int i = 0; i < 0x100; i++) SNES_B_REGISTERS[i] = 0;
  for (int i = 0; i < 0x400; i++) SNES_CPU_REGISTERS[i] = 0;
  apu_power();
  game_start();
}
/** Runs the game's step, with the buttons in `buttons` held, the sound side on to the frame's end, and draws the
 *  frame's lines. */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  game_step(buttons);
  apu_frame();
  ppu_frame(frame);
  // V-blank starts: the picture unit's sprite table goes back, and $4210 says so, with the processor's version, 2
  ppu_vblank();
  SNES_CPU_REGISTERS[0x210] = 0x82;
}
/** The frame, SNES_WIDTH by SNES_HEIGHT words, as the page shows them. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  game_draw();
  uint32_t *out = kit_screen(SNES_WIDTH, SNES_HEIGHT);
  for (int i = 0; i < SNES_WIDTH * SNES_HEIGHT; i++) out[i] = frame[i];
  return out;
}
/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1: the sound chip's, with the game's own added. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  for (int i = 0; i < SOUND_MAX * 2; i++) sound[i] = 0;
  if (count > 0) {
    apu_samples(sound, sound + SOUND_MAX, count);
    game_sound(sound, sound + SOUND_MAX, count);
  }
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
