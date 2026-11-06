// A C game on a computer, with no browser: it reads the player's copy and a list of the buttons held at each frame,
// runs the game a frame at a time, and writes every frame it draws, the same words the page would show. The kit's
// test (tools/test/c-kit.mjs) checks that they are the same as WebAssembly's.
//
//   game <copy.gba> <buttons> <frames.out> [<start point>]
//
// <buttons> holds one line a frame, the frame's KEYINPUT bits as a number (input.js KEY), and <frames.out> gets
// 240 × 160 words a frame, red in the lowest byte. The save memory is kept beside it, in <frames.out>.sav. <start
// point> is the words the page's address would give the game, such as unlocked=1, which gba_start_point reads.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gba.h"

uint8_t *dp_rom(uint32_t size);
char *dp_start_point(uint32_t size);
void dp_start(void);
void dp_step(uint32_t keys);
uint32_t *dp_draw(void);

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
  if (argc != 4 && argc != 5) {
    fprintf(stderr, "Usage: %s <copy.gba> <buttons> <frames.out> [<start point>]\n", argv[0]);
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
  const char *words = argc == 5 ? argv[4] : "";
  memcpy(dp_start_point((uint32_t)strlen(words)), words, strlen(words));
  dp_start();
  unsigned long keys;
  while (fscanf(buttons, "%lu", &keys) == 1) {
    dp_step((uint32_t)keys);
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
  return 0;
}
