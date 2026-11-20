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
void gba_draw_line_now(int y) { gba_draw_lines_to(y, kit_screen(SCREEN_W, SCREEN_H)); }
/** Where the video hardware is, for the page to show the proof tools what it holds (proof.js `video`). */
EXPORT("dp_vram") uint8_t *dp_vram(void) { return gba_vram; }
EXPORT("dp_pal") uint16_t *dp_pal(void) { return gba_pal; }
EXPORT("dp_oam") uint16_t *dp_oam(void) { return gba_oam; }
EXPORT("dp_io") uint16_t *dp_io(void) { return gba_io; }

// LZ77UnCompWram and LZ77UnCompVram: a header of the kind, 0x10, and the unpacked size, then groups of a flag byte and eight pieces,
// each a byte as it is, or, with its flag set, a copy of 3 to 18 bytes from 1 to 4096 bytes back: the first byte holds
// the length less 3 and the distance's top bits, the second the rest of the distance less 1. `put` writes a byte and
// `got` reads one back, from wherever the unpacked bytes go.
static uint32_t lz77(const uint8_t *src, uint32_t srcSize, uint32_t max, void (*put)(void *, uint32_t, uint8_t),
                     uint8_t (*got)(void *, uint32_t), void *to) {
  // the BIOS never looks at the header's first byte, the kind, and some games' data has another there
  if (srcSize < 4) return 0;
  uint32_t size = src[1] | src[2] << 8 | (uint32_t)src[3] << 16, at = 4, out = 0;
  if (size > max) size = max;
  while (out < size && at < srcSize) {
    uint8_t flags = src[at++];
    for (int bit = 0x80; bit && out < size; bit >>= 1) {
      if (!(flags & bit)) {
        if (at >= srcSize) return out;
        put(to, out++, src[at++]);
        continue;
      }
      if (at + 1 >= srcSize) return out;
      uint32_t length = (src[at] >> 4) + 3, back = ((src[at] & 0xF) << 8 | src[at + 1]) + 1;
      at += 2;
      if (back > out) return out;
      for (; length && out < size; length--, out++) put(to, out, got(to, out - back));
    }
  }
  return out;
}

static void put_ram(void *to, uint32_t at, uint8_t b) { ((uint8_t *)to)[at] = b; }
static uint8_t got_ram(void *to, uint32_t at) { return ((uint8_t *)to)[at]; }
uint32_t gba_lz77(const uint8_t *src, uint32_t srcSize, uint8_t *dst, uint32_t max) {
  return lz77(src, srcSize, max, put_ram, got_ram, dst);
}

// into VRAM: each even byte waits until the odd one after it makes a halfword
typedef struct { uint32_t base; uint8_t even; } VramOut;
static void put_vram(void *to, uint32_t at, uint8_t b) {
  VramOut *v = to;
  uint32_t a = v->base + at;
  if (!(a & 1)) { v->even = b; return; }
  if (a < sizeof gba_vram) { gba_vram[a - 1] = v->even; gba_vram[a] = b; }
}
static uint8_t got_vram(void *to, uint32_t at) {
  uint32_t a = ((VramOut *)to)->base + at;
  return a < sizeof gba_vram ? gba_vram[a] : 0;
}
uint32_t gba_lz77_vram(const uint8_t *src, uint32_t srcSize, uint32_t at) {
  VramOut v = { at, 0 };
  return at < sizeof gba_vram ? lz77(src, srcSize, sizeof gba_vram - at, put_vram, got_vram, &v) : 0;
}

// The BIOS's Sqrt and ArcTan2 (gba.h)
int gba_sqrt(uint32_t n) {
  uint32_t r = 0, bit = 1u << 30;
  while (bit > n) bit >>= 2;
  while (bit) {
    if (n >= r + bit) { n -= r + bit; r = (r >> 1) + bit; } else r >>= 1;
    bit >>= 2;
  }
  return (int)r;
}

// the BIOS's ArcTan, which ArcTan2 calls
static int arctan(int i) {
  int a = -(i * i >> 14), b = (0xA9 * a >> 14) + 0x390;
  b = (b * a >> 14) + 0x91C;
  b = (b * a >> 14) + 0xFB6;
  b = (b * a >> 14) + 0x16AA;
  b = (b * a >> 14) + 0x2081;
  b = (b * a >> 14) + 0x3651;
  b = (b * a >> 14) + 0xA2F9;
  return i * b >> 16;
}
int gba_arctan2(int x, int y) {
  if (!y) return x >= 0 ? 0 : 0x8000;
  if (!x) return y >= 0 ? 0x4000 : 0xC000;
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return arctan((y << 14) / x); }
    else if (-x >= y) return arctan((y << 14) / x) + 0x8000;
    return 0x4000 - arctan((x << 14) / y);
  }
  if (x <= 0) { if (-x > -y) return arctan((y << 14) / x) + 0x8000; }
  else if (x >= -y) return arctan((y << 14) / x) + 0x10000;
  return 0xC000 - arctan((x << 14) / y);
}
