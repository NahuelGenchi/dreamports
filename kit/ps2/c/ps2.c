// A game in C on the PlayStation 2's kit: what the page calls, by name, to start it, run its frames, draw them and hear
// them, as kit/c/console.c does for a console with no kit of its own, and each frame's draw list, which the proof tools
// ask for (ps2.h). What the game writes before its first frame, as it sets up its screen, is in no frame's list.

#include "ps2-kit.h"
#include "page.h"

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];
static uint32_t frame_hash, frame_count;

/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  gs_power();
  game_start();
}
/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  gs_list_start();
  game_step(buttons);
  frame_hash = gs_list_hash();
  frame_count = gs_list_count();
}
/** The draw list of the last frame run: its hash, and how many things were written. */
EXPORT("dp_draw_list") uint32_t dp_draw_list(void) { return frame_hash; }
EXPORT("dp_draw_list_count") uint32_t dp_draw_list_count(void) { return frame_count; }
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
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
