// A C game on a computer, with no browser: it reads the player's copy and a list of the buttons held at each frame,
// runs the game a frame at a time, and writes every frame it draws, the same words the page would show. The kit's
// test (tools/test/c-kit.mjs) checks that they are the same as WebAssembly's.
//
//   game <copy.gba> <buttons> <frames.out> [<start point> [<sound.out>]]
//
// <buttons> holds one line a frame, the frame's KEYINPUT bits as a number (input.js KEY), each frame's V-blank finding
// the next line's held, and <frames.out> gets 240 × 160 words a frame, red in the lowest byte. The save memory is kept beside it, in <frames.out>.sav. <start
// point> is the words the page's address would give the game, such as unlocked=1, which gba_start_point reads, or ""
// for none. With <sound.out>, it also gets each frame's sound as the proof tools hear it (proof.js `heard`): the
// samples a frame's time holds at the console's mix rate, 1097 or 1098, left and right, as 16-bit numbers in its
// 10-bit steps.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gba.h"

uint8_t *dp_rom(uint32_t size);
char *dp_start_point(uint32_t size);
void dp_start(void);
void dp_step(uint32_t keys);
void dp_vblank_keys(uint32_t keys);
uint32_t *dp_draw(void);
void dp_sound_output(int rate, int raw);
float *dp_sound_render(int count);
int dp_sound_render_max(void);

#define MIX_RATE 65536

static char save_path[4096];

void host_save_read(uint8_t *bytes, uint32_t size) {
  FILE *f = fopen(save_path, "rb");
  if (!f) return;
  size_t got = fread(bytes, 1, size, f);
  (void)got;
  fclose(f);
}
void host_save_write(const uint8_t *bytes, uint32_t size) {
  FILE *f = fopen(save_path, "wb");
  if (!f) return;
  fwrite(bytes, 1, size, f);
  fclose(f);
}

static void fail(const char *what, const char *path) {
  fprintf(stderr, "%s: %s\n", what, path);
  exit(1);
}

int main(int argc, char **argv) {
  if (argc < 4 || argc > 6) {
    fprintf(stderr, "Usage: %s <copy.gba> <buttons> <frames.out> [<start point> [<sound.out>]]\n", argv[0]);
    return 2;
  }
  snprintf(save_path, sizeof save_path, "%s.sav", argv[3]);
  FILE *rom = fopen(argv[1], "rb");
  if (!rom) fail("Can't read the copy", argv[1]);
  fseek(rom, 0, SEEK_END);
  long size = ftell(rom);
  fseek(rom, 0, SEEK_SET);
  uint8_t *bytes = dp_rom((uint32_t)size);
  if (fread(bytes, 1, (size_t)size, rom) != (size_t)size) fail("Can't read the copy", argv[1]);
  fclose(rom);

  FILE *buttons = fopen(argv[2], "r"), *out = fopen(argv[3], "wb");
  if (!buttons) fail("Can't read the buttons", argv[2]);
  if (!out) fail("Can't write the frames", argv[3]);
  const char *words = argc >= 5 ? argv[4] : "";
  memcpy(dp_start_point((uint32_t)strlen(words)), words, strlen(words));
  FILE *heard = argc == 6 ? fopen(argv[5], "wb") : NULL;
  if (argc == 6 && !heard) fail("Can't write the sound", argv[5]);
  dp_sound_output(MIX_RATE, 1);
  dp_start();
  unsigned long keys, next;
  // the samples a frame holds, as proof.js counts them: a frame is 280896 / 256 = 1097.25 of them
  long long played = 0;
  // each frame's V-blank finds the next frame's buttons held, as the proof tools give them (gba_vblank_keys)
  int more = fscanf(buttons, "%lu", &keys) == 1;
  while (more) {
    more = fscanf(buttons, "%lu", &next) == 1;
    if (more) dp_vblank_keys((uint32_t)next);
    dp_step((uint32_t)keys);
    keys = next;
    if (heard) {
      int count = (int)((played + 1) * 109725 / 100 - played * 109725 / 100), max = dp_sound_render_max();
      played++;
      const float *s = dp_sound_render(count);
      for (int i = 0; i < count; i++) {
        float v[2] = { s[i] * 512, s[max + i] * 512 };
        for (int k = 0; k < 2; k++) {
          int n = (int)(v[k] < 0 ? v[k] - 0.5f : v[k] + 0.5f);
          uint8_t b[2] = { (uint8_t)(n & 0xFF), (uint8_t)((n >> 8) & 0xFF) };
          fwrite(b, 1, 2, heard);
        }
      }
    }
    const uint32_t *frame = dp_draw();
    // little-endian words, whatever this computer's order
    static uint8_t words[SCREEN_W * SCREEN_H * 4];
    for (int i = 0; i < SCREEN_W * SCREEN_H; i++) {
      words[i * 4] = frame[i] & 0xFF; words[i * 4 + 1] = frame[i] >> 8 & 0xFF;
      words[i * 4 + 2] = frame[i] >> 16 & 0xFF; words[i * 4 + 3] = frame[i] >> 24;
    }
    fwrite(words, 1, sizeof words, out);
  }
  fclose(buttons);
  fclose(out);
  if (heard) fclose(heard);
  return 0;
}
