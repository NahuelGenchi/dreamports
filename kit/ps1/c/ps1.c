// A game in C on the PlayStation's kit: what the page calls, by name, to start it, run its frames, draw them and hear
// them, as kit/c/console.c does for a console with no kit of its own.

#include "ps1-kit.h"
#include "page.h"

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];

// The game's time, run under kit_run (kit/c/pause.c), as a PlayStation game reads its disc partway through a frame,
// wherever its drive is, and waits there while the page fetches what the drive reads: the game's start, once the
// drive is as the emulator leaves it, then each frame's step, each run to the frame's V-blank. So a game's step
// doesn't call kit_run itself.
static uint32_t held;
static void run(void) {
  clock_spend(cd_power());
  game_start();
  // the console's first V-blank, which a game's first step comes after
  clock_frame_end();
  for (;;) {
    kit_wait_frame();
    game_step(held);
    clock_frame_end();
  }
}
// whether the game's start paused for its disc, to go on in the page's next call
static int starting;

/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  gpu_power();
  spu_power();
  pad_power();
  clock_power();
  starting = !kit_run(run);
}
/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). A frame the
 *  game paused partway through for its disc goes on from there, with the same buttons. */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  if (starting) {
    if (!kit_run(run)) return;
    starting = 0;
  }
  if (!kit_frame_paused()) {
    held = buttons;
    pad_hold(buttons);
  }
  kit_run(run);
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
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
