// For the C kit's test (c-kit.mjs): draws made-up scenes with the C kit's video (kit/gba/c/video.c), for the test
// to compare with what the JavaScript kit's draws of the same scenes. A scene is what the video hardware holds, the
// writes its H-blanks make, and whether a picture is put behind it:
//   44 halfwords of registers, written in order with gba_write, 512 colours, 512 halfwords of OAM, 0x18000 bytes of
//   VRAM, a count of writes, and each write as { line, what (0 a register, 1 a colour), where, value } in 6 bytes
// then, from the next multiple of 4 bytes, a word that says whether 240 × 160 words of a picture behind it follow.

#include "gba.h"

#define IO_BYTES 0x58

static const uint8_t *writes;
static uint32_t n_writes;
static uint16_t le16(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }

static void hblank(int y) {
  int colours = 0;
  for (uint32_t i = 0; i < n_writes; i++) {
    const uint8_t *w = writes + i * 6;
    if (w[0] != y) continue;
    if (w[1] == 0) gba_write(le16(w + 2), le16(w + 4));
    else { gba_pal[le16(w + 2) & 511] = le16(w + 4); colours = 1; }
  }
  if (colours) gba_update_colors();
}

/** Draws the scene at `scene` into `out`, and returns how many bytes it took. */
uint32_t draw_scene(const uint8_t *scene, uint32_t *out) {
  const uint8_t *p = scene;
  for (int i = 0; i < IO_BYTES; i += 2) gba_write((unsigned)i, le16(p + i));
  p += IO_BYTES;
  for (int i = 0; i < 512; i++) gba_pal[i] = le16(p + i * 2);
  p += 1024;
  for (int i = 0; i < 512; i++) gba_oam[i] = le16(p + i * 2);
  p += 1024;
  for (int i = 0; i < 0x18000; i++) gba_vram[i] = p[i];
  p += 0x18000;
  n_writes = (uint32_t)(p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24);
  writes = p + 4;
  p += 4 + n_writes * 6;
  p = scene + ((p - scene + 3) & ~3);
  int has_underlay = p[0];
  p += 4;
  gba_underlay = has_underlay ? (const uint32_t *)p : 0;
  if (has_underlay) p += SCREEN_W * SCREEN_H * 4;
  gba_on_hblank(hblank);
  gba_draw_frame(out);
  return (uint32_t)(p - scene);
}

#ifdef __wasm__
static uint8_t input[8 << 20];
static uint32_t output[SCREEN_W * SCREEN_H];
__attribute__((export_name("input"))) uint8_t *scene_input(void) { return input; }
__attribute__((export_name("draw"))) uint32_t *scene_draw(void) { draw_scene(input, output); return output; }
// the kit's video needs none of these, but its header names them
void game_start(void) {}
void game_step(uint16_t keys) { (void)keys; }
#else
#include <stdio.h>
#include <stdlib.h>
// scene <scenes> <frames.out>: every scene in <scenes>, one after another, each frame after the last
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  FILE *f = fopen(argv[1], "rb"), *out = fopen(argv[2], "wb");
  if (!f || !out) return 1;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *all = malloc((size_t)size);
  if (!all || fread(all, 1, (size_t)size, f) != (size_t)size) return 1;
  static uint32_t frame[SCREEN_W * SCREEN_H];
  static uint8_t words[SCREEN_W * SCREEN_H * 4];
  for (long at = 0; at < size;) {
    at += draw_scene(all + at, frame);
    for (int i = 0; i < SCREEN_W * SCREEN_H; i++) {
      words[i * 4] = frame[i] & 0xFF; words[i * 4 + 1] = frame[i] >> 8 & 0xFF;
      words[i * 4 + 2] = frame[i] >> 16 & 0xFF; words[i * 4 + 3] = frame[i] >> 24;
    }
    fwrite(words, 1, sizeof words, out);
  }
  fclose(out);
  return 0;
}
#endif
