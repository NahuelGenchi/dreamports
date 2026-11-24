// A game in C on the GameCube's kit: the console's memory as its processor reaches it, the registers of the chips the
// kit has, and what the page calls, by name, to start the game, run its frames, draw them and hear them, as
// kit/c/console.c does for a console with no kit of its own.
//
// The chips do their work at once, where the console's take some time. A game in C runs a field of its original's in
// game_step, which starts once its original's wait for the screen has ended, and the field the video interface shows
// is made from memory as the step ends (vi.c).

#include "gamecube-kit.h"
#include "disc.h"
#include "page.h"

uint8_t gc_ram[GC_RAM_SIZE];

// where the processor's address is in the console: the same memory through the cache, 0x80000000, and round it,
// 0xC0000000, and the chips' registers at 0x0C000000 round the cache, as 0xCC000000
static uint32_t physical(uint32_t address) { return address & 0x1FFFFFFF; }
enum { VI_AT = 0x0C002000, DSP_AT = 0x0C005000, SI_AT = 0x0C006400, AI_AT = 0x0C006C00 };
// the chips whose registers are 16 bits and those whose are 32
static int in(uint32_t at, uint32_t base, uint32_t size) { return at >= base && at < base + size; }

uint16_t gc_read16(uint32_t address) {
  uint32_t at = physical(address) & ~1u;
  if (at < GC_RAM_SIZE) return gc_be16(gc_ram + at);
  if (in(at, VI_AT, 0x100)) return vi_read(at - VI_AT);
  if (in(at, DSP_AT, 0x200)) return dsp_read(at - DSP_AT);
  // half of a 32-bit register, as a 16-bit read of one takes it
  if (in(at, SI_AT, 0x100)) return (uint16_t)(si_read((at - SI_AT) & ~3u) >> (at & 2 ? 0 : 16));
  if (in(at, AI_AT, 0x20)) return (uint16_t)(ai_read((at - AI_AT) & ~3u) >> (at & 2 ? 0 : 16));
  return 0;
}

uint32_t gc_read32(uint32_t address) {
  uint32_t at = physical(address) & ~3u;
  if (at < GC_RAM_SIZE) return gc_be32(gc_ram + at);
  if (in(at, SI_AT, 0x100)) return si_read(at - SI_AT);
  if (in(at, AI_AT, 0x20)) return ai_read(at - AI_AT);
  // a chip whose registers are 16 bits gives two of them, the one at the address first
  return (uint32_t)gc_read16(address & ~3u) << 16 | gc_read16((address & ~3u) + 2);
}

uint8_t gc_read8(uint32_t address) {
  uint32_t at = physical(address);
  if (at < GC_RAM_SIZE) return gc_ram[at];
  return (uint8_t)(gc_read16(address & ~1u) >> (address & 1 ? 0 : 8));
}

void gc_write16(uint32_t address, uint16_t value) {
  uint32_t at = physical(address) & ~1u;
  if (at < GC_RAM_SIZE) {
    gc_ram[at] = (uint8_t)(value >> 8);
    gc_ram[at + 1] = (uint8_t)value;
  } else if (in(at, VI_AT, 0x100)) vi_write(at - VI_AT, value);
  else if (in(at, DSP_AT, 0x200)) dsp_write(at - DSP_AT, value);
  // a 16-bit write to the serial or audio interface, whose registers are 32 bits, isn't one the kit takes yet
}

void gc_write32(uint32_t address, uint32_t value) {
  uint32_t at = physical(address) & ~3u;
  if (at < GC_RAM_SIZE) gc_put_be32(gc_ram + at, value);
  else if (in(at, SI_AT, 0x100)) si_write(at - SI_AT, value);
  else if (in(at, AI_AT, 0x20)) ai_write(at - AI_AT, value);
  else {
    // a chip whose registers are 16 bits takes two of them, the one at the address first
    gc_write16(address & ~3u, (uint16_t)(value >> 16));
    gc_write16((address & ~3u) + 2, (uint16_t)value);
  }
}

void gc_write8(uint32_t address, uint8_t value) {
  uint32_t at = physical(address);
  if (at < GC_RAM_SIZE) gc_ram[at] = value;
}

/** Starts the game: the console as it powers on, with the player's disc in its drive or a program given alone. */
EXPORT("dp_start") void dp_start(void) {
  for (uint32_t i = 0; i < GC_RAM_SIZE; i++) gc_ram[i] = 0;
  vi_power(kit_disc_kind() != KIT_DISC_NONE);
  audio_power();
  si_power();
  game_start();
}
/** Runs one frame, a field of the console's, with the buttons in `buttons` held, a bit each in kit/consoles.js's order
 *  (console.h), which the serial interface polls the first controller for. */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  si_buttons(buttons);
  game_step(buttons);
  // the field the video interface shows, once the frame is done rather than paused partway
  if (!kit_frame_paused()) vi_field();
}
/** Draws the frame, and gives where its words are, dp_width() × dp_height() of them. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  game_draw();
  return dp_width() > 0 && dp_height() > 0 ? kit_screen(dp_width(), dp_height()) : kit_screen(SCREEN_W, SCREEN_H);
}

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];
/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  for (int i = 0; i < SOUND_MAX * 2; i++) sound[i] = 0;
  if (count > 0) game_sound(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
