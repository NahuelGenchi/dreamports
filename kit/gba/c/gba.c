// The Game Boy Advance's part of what the page calls, by name, to run a game in C (game.js as WebAssembly, native.c on
// a computer): starting it, its frames, drawing them with the video hardware, and showing the proof tools what that
// hardware holds. The copy, the save memory, the start point's words and memory are what every console's kit in C
// shares (kit/c/kit.c).

#include "gba.h"
#include "page.h"
#include "sound.h"

/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  kit_screen(SCREEN_W, SCREEN_H);
  game_start();
}
// the buttons the frame's V-blank finds held, when the page has said, and the frame's own
static uint16_t vblankKeys, stepKeys;
static int vblankKeysGiven;
uint16_t gba_vblank_keys(void) { return vblankKeysGiven ? vblankKeys : stepKeys; }
/** The buttons the next frame's step will find held at its V-blank, said before it runs. */
EXPORT("dp_vblank_keys") void dp_vblank_keys(uint32_t keys) {
  vblankKeys = (uint16_t)keys;
  vblankKeysGiven = 1;
}
/** Runs one frame with the buttons in `keys` held. */
EXPORT("dp_step") void dp_step(uint32_t keys) {
  stepKeys = (uint16_t)keys;
  game_step((uint16_t)keys);
  vblankKeysGiven = 0;
  gba_sound_frame_done();
}
/** Draws the frame, and gives where its 240 × 160 words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  gba_draw_frame(screen);
  return screen;
}
/** Where the video hardware is, for the page to show the proof tools what it holds (proof.js `video`). */
EXPORT("dp_vram") uint8_t *dp_vram(void) { return gba_vram; }
EXPORT("dp_pal") uint16_t *dp_pal(void) { return gba_pal; }
EXPORT("dp_oam") uint16_t *dp_oam(void) { return gba_oam; }
EXPORT("dp_io") uint16_t *dp_io(void) { return gba_io; }
