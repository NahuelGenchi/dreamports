// A game in C on the PlayStation Portable's kit: what the page calls, by name, to start it, run its frames, draw them
// and hear them, as kit/c/console.c does for a console with no kit of its own.
//
// game_start is the program's first thread: it runs as the original's does from its start, waits where the original
// waits, and needn't come back. A frame of the page is a frame of the console, from one V-blank's start to the next,
// in which whichever of the game's threads has its turn runs. The console's first frame, from power-on to its first
// V-blank, runs as the game starts, as the proof tools compare a Dreamport's frame with the original's next one.
// game_step isn't called on this console.

#include "psp-kit.h"
#include "page.h"

#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];
static uint32_t sound_hash, sound_count;

static int first_thread(uint32_t size, uint32_t arguments) {
  (void)size;
  (void)arguments;
  game_start();
  return 0;
}

// the buttons the page holds, as the console's own bits, and the stick all the way over or in its middle
static void hold(uint32_t buttons) {
  static const struct { uint32_t page, console; } MAP[] = {
    { BUTTON_CROSS, PSP_CTRL_CROSS }, { BUTTON_CIRCLE, PSP_CTRL_CIRCLE }, { BUTTON_SQUARE, PSP_CTRL_SQUARE }, { BUTTON_TRIANGLE, PSP_CTRL_TRIANGLE },
    { BUTTON_L, PSP_CTRL_LTRIGGER }, { BUTTON_R, PSP_CTRL_RTRIGGER }, { BUTTON_SELECT, PSP_CTRL_SELECT }, { BUTTON_START, PSP_CTRL_START },
    { BUTTON_UP, PSP_CTRL_UP }, { BUTTON_DOWN, PSP_CTRL_DOWN }, { BUTTON_LEFT, PSP_CTRL_LEFT }, { BUTTON_RIGHT, PSP_CTRL_RIGHT },
  };
  uint32_t held = 0;
  for (unsigned i = 0; i < sizeof MAP / sizeof *MAP; i++) if (buttons & MAP[i].page) held |= MAP[i].console;
  int left = !!(buttons & BUTTON_STICK_LEFT), right = !!(buttons & BUTTON_STICK_RIGHT), up = !!(buttons & BUTTON_STICK_UP), down = !!(buttons & BUTTON_STICK_DOWN);
  ctrl_hold(held, left == right ? 128 : left ? 0 : 255, up == down ? 128 : up ? 0 : 255);
}

static uint32_t draw_hash, draw_count;

static void frame(void) {
  audio_frame_starts();
  ge_frame_starts();
  kernel_run_frame();
  sound_hash = audio_list_hash();
  sound_count = audio_list_count();
  draw_hash = ge_list_hash();
  draw_count = ge_list_count();
}

/** Starts the game, and runs the console's first frame. */
EXPORT("dp_start") void dp_start(void) {
  memory_power();
  kernel_power();
  display_power();
  ctrl_power();
  audio_power();
  ge_power();
  kernel_start(first_thread);
  frame();
}
/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  hold(buttons);
  frame();
}
/** Draws the frame, and gives where its words are, dp_width() × dp_height() of them. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  game_draw();
  return dp_width() > 0 && dp_height() > 0 ? kit_screen(dp_width(), dp_height()) : kit_screen(SCREEN_W, SCREEN_H);
}
/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1: what the console mixed and hasn't been played yet. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  for (int i = 0; i < SOUND_MAX * 2; i++) sound[i] = 0;
  if (count > 0) audio_take(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }

/** The draw list of the last frame run: its hash, and how many commands the graphics chip ran (ge.c). Its whole list
 *  isn't kept, so the proof tools can't yet say which command of a list that differs isn't the original's. */
EXPORT("dp_draw_list") uint32_t dp_draw_list(void) { return draw_hash; }
EXPORT("dp_draw_list_count") uint32_t dp_draw_list_count(void) { return draw_count; }
EXPORT("dp_draw_list_bytes") const uint8_t *dp_draw_list_bytes(void) { return 0; }
EXPORT("dp_draw_list_size") uint32_t dp_draw_list_size(void) { return 0xFFFFFFFFu; }
/** The sound list of the last frame run: its hash and how many things it holds (audio.c). */
EXPORT("dp_sound_list") uint32_t dp_sound_list(void) { return sound_hash; }
EXPORT("dp_sound_list_count") uint32_t dp_sound_list_count(void) { return sound_count; }
/** The samples the console mixed in the last frame, left and right, 16 bits each, and how many pairs: what the proof
 *  tools compare with the original's, sample for sample. */
EXPORT("dp_sound_heard") const int16_t *dp_sound_heard(void) {
  uint32_t pairs;
  return audio_heard(&pairs);
}
EXPORT("dp_sound_heard_count") uint32_t dp_sound_heard_count(void) {
  uint32_t pairs;
  audio_heard(&pairs);
  return pairs;
}
