// A game in C on the PlayStation 2's kit: what the page calls, by name, to start it, run its frames, draw them and hear
// them, as kit/c/console.c does for a console with no kit of its own, and each frame's draw list and sound list, which
// the proof tools ask for (ps2.h). What the game writes before its first frame, as it sets up its screen and its
// sound, is in no frame's list. Each frame runs the console's time on to the next V-blank, which mixes the sound chip's
// samples due in it (iop.c), and those play, with whatever game_sound adds of its own.

#include "ps2-kit.h"
#include "page.h"

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];
static uint32_t frame_hash, frame_count, sound_hash, sound_count;

// the sound chip's samples mixed and not played yet, left and right, which the page takes as it plays
#define WAITING 16384
static int16_t waiting[WAITING * 2];
static uint32_t waiting_from, waiting_count;
static void heard(void) {
  uint32_t pairs;
  const int16_t *samples = spu2_heard(&pairs);
  for (uint32_t i = 0; i < pairs; i++) {
    // a page that has stopped taking them loses the oldest
    if (waiting_count == WAITING) {
      waiting_from = (waiting_from + 1) % WAITING;
      waiting_count--;
    }
    uint32_t at = (waiting_from + waiting_count++) % WAITING;
    waiting[at * 2] = samples[i * 2];
    waiting[at * 2 + 1] = samples[i * 2 + 1];
  }
}

/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  ps2_clock_power();
  gs_power();
  iop_bios_power();
  pad_power();
  spu2_list_start();
  game_start();
  ps2_clock_to_vblank();
  heard();
}
/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  gs_list_start();
  spu2_list_start();
  iop_vblank();
  pad_hold(buttons);
  game_step(buttons);
  ps2_clock_to_vblank();
  frame_hash = gs_list_hash();
  frame_count = gs_list_count();
  sound_hash = spu2_list_hash();
  sound_count = spu2_list_count();
  heard();
}
/** The sound list of the last frame run: its hash and how many things it holds, as the draw list's, and the whole
 *  list, as its bytes and how many, or 0xFFFFFFFF when it was too long to keep (spu2.c). */
EXPORT("dp_sound_list") uint32_t dp_sound_list(void) { return sound_hash; }
EXPORT("dp_sound_list_count") uint32_t dp_sound_list_count(void) { return sound_count; }
EXPORT("dp_sound_list_bytes") const uint8_t *dp_sound_list_bytes(void) {
  uint32_t size;
  return spu2_list_bytes(&size);
}
EXPORT("dp_sound_list_size") uint32_t dp_sound_list_size(void) {
  uint32_t size;
  spu2_list_bytes(&size);
  return size;
}
/** The samples the sound chip mixed in the last frame, left and right, 16 bits each, and how many pairs: what the
 *  proof tools compare with the original's, sample for sample. */
EXPORT("dp_sound_heard") const int16_t *dp_sound_heard(void) {
  uint32_t pairs;
  return spu2_heard(&pairs);
}
EXPORT("dp_sound_heard_count") uint32_t dp_sound_heard_count(void) {
  uint32_t pairs;
  spu2_heard(&pairs);
  return pairs;
}
/** The draw list of the last frame run: its hash, and how many things were written. */
EXPORT("dp_draw_list") uint32_t dp_draw_list(void) { return frame_hash; }
EXPORT("dp_draw_list_count") uint32_t dp_draw_list_count(void) { return frame_count; }
/** The last frame's whole list, for the proof tools to say which write differs: where it is, and how many bytes, or
 *  0xFFFFFFFF when it was too long to keep (gs.c). */
EXPORT("dp_draw_list_bytes") const uint8_t *dp_draw_list_bytes(void) {
  uint32_t size;
  return gs_list_bytes(&size);
}
EXPORT("dp_draw_list_size") uint32_t dp_draw_list_size(void) {
  uint32_t size;
  gs_list_bytes(&size);
  return size;
}
/** Draws the frame, and gives where its words are, dp_width() × dp_height() of them. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  game_draw();
  // a game that drew nothing shows the console's screen, black
  return dp_width() > 0 && dp_height() > 0 ? kit_screen(dp_width(), dp_height()) : kit_screen(SCREEN_W, SCREEN_H);
}
/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  for (int i = 0; i < SOUND_MAX * 2; i++) sound[i] = 0;
  if (count > 0) game_sound(sound, sound + SOUND_MAX, count);
  for (int i = 0; i < count && waiting_count; i++, waiting_count--) {
    sound[i] += waiting[waiting_from * 2] / 32768.0f;
    sound[SOUND_MAX + i] += waiting[waiting_from * 2 + 1] / 32768.0f;
    waiting_from = (waiting_from + 1) % WAITING;
  }
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
