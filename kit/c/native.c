// A game in C on a console with no kit in C of its own, on a computer, with no browser: it reads the player's copy and a
// list of the buttons held at each frame, runs the game a frame at a time, and writes every frame it draws, the same
// words the page would show. The kit's test (tools/test/c-kit.mjs) checks them.
//
//   game <copy> <buttons> <frames.out> [<start point> [<sound.out>]]
//
// <buttons> holds one line a frame, the frame's buttons as a number, a bit each as console.h has them, and <frames.out>
// gets each frame's width and height as two 32-bit numbers, then its width × height words, red in the lowest byte. The
// save memory is kept beside it, in <frames.out>.sav. <start point> is the words the page's address would give the game,
// such as later=500, which kit_start_point reads, or "" for none. With <sound.out>, it also gets each frame's sound as
// the proof tools hear it (proof.js `heard`): the samples a frame's time holds at the console's rate, left and right,
// as 16-bit numbers, 512 for each 1.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "console.h"

uint8_t *dp_rom(uint32_t size);
char *dp_start_point(uint32_t size);
void dp_start(void);
void dp_step(uint32_t buttons);
uint32_t *dp_draw(void);
int dp_width(void);
int dp_height(void);
float *dp_sound_render(int count);
int dp_sound_render_max(void);

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

// little-endian, whatever this computer's order
static void put32(FILE *out, uint32_t v) {
  uint8_t b[4] = { (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24) };
  fwrite(b, 1, 4, out);
}
// JavaScript's Math.floor and Math.round, as proof.js counts and keeps the samples
static long long floor_of(double v) {
  long long n = (long long)v;
  return (double)n > v ? n - 1 : n;
}

int main(int argc, char **argv) {
  if (argc < 4 || argc > 6) {
    fprintf(stderr, "Usage: %s <copy> <buttons> <frames.out> [<start point> [<sound.out>]]\n", argv[0]);
    return 2;
  }
  snprintf(save_path, sizeof save_path, "%s.sav", argv[3]);
  FILE *rom = fopen(argv[1], "rb");
  if (!rom) fail("Can't read the copy", argv[1]);
  fseek(rom, 0, SEEK_END);
  long size = ftell(rom);
  fseek(rom, 0, SEEK_SET);
  uint8_t *bytes = dp_rom((uint32_t)size);
  if (size && fread(bytes, 1, (size_t)size, rom) != (size_t)size) fail("Can't read the copy", argv[1]);
  fclose(rom);

  FILE *buttons = fopen(argv[2], "r"), *out = fopen(argv[3], "wb");
  if (!buttons) fail("Can't read the buttons", argv[2]);
  if (!out) fail("Can't write the frames", argv[3]);
  const char *words = argc >= 5 ? argv[4] : "";
  memcpy(dp_start_point((uint32_t)strlen(words)), words, strlen(words));
  FILE *heard = argc == 6 ? fopen(argv[5], "wb") : NULL;
  if (argc == 6 && !heard) fail("Can't write the sound", argv[5]);
  dp_start();
  // the samples a frame holds, as proof.js counts them
  const double step = CONSOLE_SOUND_RATE * ((double)CONSOLE_FRAME_TICKS / CONSOLE_CLOCK);
  long long played = 0;
  unsigned long held;
  while (fscanf(buttons, "%lu", &held) == 1) {
    dp_step((uint32_t)held);
    if (heard) {
      int count = (int)(floor_of((double)(played + 1) * step) - floor_of((double)played * step)), max = dp_sound_render_max();
      played++;
      for (int done = 0; done < count;) {
        int now = count - done < max ? count - done : max;
        const float *s = dp_sound_render(now);
        for (int i = 0; i < now; i++) {
          for (int side = 0; side < 2; side++) {
            int n = (int)floor_of((double)s[side * max + i] * 512 + 0.5);
            uint8_t b[2] = { (uint8_t)(n & 0xFF), (uint8_t)((n >> 8) & 0xFF) };
            fwrite(b, 1, 2, heard);
          }
        }
        done += now;
      }
    }
    const uint32_t *frame = dp_draw();
    int width = dp_width(), height = dp_height();
    put32(out, (uint32_t)width);
    put32(out, (uint32_t)height);
    for (long i = 0; i < (long)width * height; i++) put32(out, frame[i]);
  }
  fclose(buttons);
  fclose(out);
  if (heard) fclose(heard);
  return 0;
}
