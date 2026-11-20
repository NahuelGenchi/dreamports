// The PlayStation's graphics chip, the GPU, as a game writes it: a word at a time to GP0, which gathers each drawing
// command and its words, or a picture moved into video memory, and to GP1, which says what the screen shows. Every
// drawing command, polygons, lines, rectangles, fills and the drawing settings, is drawn by psx_gpu, as PCSX ReARMed
// draws it (draw.c). Pictures moved into video memory, and within it, are moved here, as the console moves them, and
// psx_gpu is told, as it keeps textures of its own (kit/ps1/c/README.md).

#include "ps1-kit.h"

static struct {
  int shown_x, shown_y, on, mode;
  int range_top, range_bottom;
} gpu;

// a command being gathered: its words so far and how many it has, or for a line through many points, that it ends
// with the word that says so
static uint32_t words[256];
static int have, needs, polyline;
// a picture being moved into video memory, a pixel at a time, two to a word
static int copy_x, copy_y, copy_w, copy_h, copy_done, copying;

void gpu_power(void) {
  draw_power();
  gpu_gp1(0);
}

// how many words a command has, from its first: a picture moved or copied by the kit's own count, and every drawing
// command by the emulator's, which psx_gpu takes them by
static int length_of(uint32_t first) {
  uint32_t op = first >> 24;
  if (op >= 0x80 && op < 0xA0) return 4;
  if (op >= 0xA0 && op < 0xE0) return 3;
  return 1 + cmd_lengths[op];
}

// a line through many points, flat (48 to 4F) or shaded (58 to 5F), whose last point is followed by 0x5xxx5xxx
static int is_polyline(uint32_t first) {
  uint32_t op = first >> 24;
  return (op & 0xE8) == 0x48;
}

// whether the word just gathered ends a line through many points: it's where a point, or a shaded line's colour,
// would be, past the first two points
static int ends_polyline(uint32_t word) {
  int shaded = (words[0] >> 24 & 0x10) != 0;
  if ((word & 0xF000F000) != 0x50005000) return 0;
  return shaded ? have >= 5 && (have - 1) % 2 == 0 : have >= 4;
}

// a picture copied within video memory, as the console copies it, mask bit and all
static void copy_within(void) {
  int sx = words[1] & 0x3FF, sy = words[1] >> 16 & 0x1FF, dx = words[2] & 0x3FF, dy = words[2] >> 16 & 0x1FF;
  int w = ((words[3] - 1) & 0x3FF) + 1, h = ((words[3] >> 16) - 1 & 0x1FF) + 1;
  uint32_t mask = draw_mask_bits();
  draw_flush();
  for (int row = 0; row < h; row++) for (int col = 0; col < w; col++) {
    uint16_t c = gpu_vram[(sy + row) & 511][(sx + col) & 1023];
    uint16_t *to = &gpu_vram[(dy + row) & 511][(dx + col) & 1023];
    if (!((mask & 2) && (*to & 0x8000))) *to = c | (mask & 1 ? 0x8000 : 0);
  }
  draw_vram_changed(dx, dy, w, h);
}

// one whole command
static void command(void) {
  uint32_t op = words[0] >> 24;
  if (op >= 0x80 && op < 0xA0) return copy_within();
  if (op >= 0xA0 && op < 0xC0) {
    // a picture moved into video memory: its words come next
    copy_x = words[1] & 0x3FF;
    copy_y = words[1] >> 16 & 0x1FF;
    copy_w = ((words[2] - 1) & 0x3FF) + 1;
    copy_h = ((words[2] >> 16) - 1 & 0x1FF) + 1;
    copy_done = 0;
    copying = 1;
    draw_flush();
    return;
  }
  // a picture read back out of video memory, which a Dreamport reads from gpu_vram itself
  if (op >= 0xC0 && op < 0xE0) return;
  draw_commands(words, have);
}

void gpu_gp0(uint32_t word) {
  if (copying) {
    uint32_t mask = draw_mask_bits();
    for (int half = 0; half < 2 && copying; half++) {
      int x = copy_done % copy_w, y = copy_done / copy_w;
      uint16_t *to = &gpu_vram[(copy_y + y) & 511][(copy_x + x) & 1023];
      if (!((mask & 2) && (*to & 0x8000))) *to = (uint16_t)(word >> (16 * half)) | (mask & 1 ? 0x8000 : 0);
      if (++copy_done >= copy_w * copy_h) {
        copying = 0;
        draw_vram_changed(copy_x, copy_y, copy_w, copy_h);
      }
    }
    return;
  }
  if (!have) {
    needs = length_of(word);
    polyline = is_polyline(word);
  }
  words[have++] = word;
  if (polyline ? !ends_polyline(word) && have < (int)(sizeof words / sizeof words[0]) : have < needs) return;
  command();
  have = 0;
}

void gpu_gp1(uint32_t word) {
  switch (word >> 24) {
    case 0x00:
      gpu.on = 0;
      gpu.shown_x = gpu.shown_y = 0;
      gpu.mode = 0;
      gpu.range_top = 0x10;
      gpu.range_bottom = 0x100;
      have = copying = 0;
      draw_reset();
      break;
    case 0x01: have = copying = 0; break;
    case 0x03: gpu.on = !(word & 1); break;
    case 0x05: gpu.shown_x = word & 0x3FF; gpu.shown_y = word >> 10 & 0x1FF; break;
    case 0x07: gpu.range_top = word & 0x3FF; gpu.range_bottom = word >> 10 & 0x3FF; break;
    case 0x08: gpu.mode = word & 0xFF; break;
    default: break;
  }
}

uint32_t gpu_status(void) {
  return 0x1C000000u | (uint32_t)(gpu.mode & 0x3F) << 17 | (uint32_t)(gpu.mode >> 6 & 1) << 16 | (uint32_t)!gpu.on << 23;
}

void gpu_show(void) {
  // the width the mode says, 368 when its seventh bit says so, and as many lines as the vertical range, twice them
  // when the mode interlaces 480
  static const int widths[4] = { 256, 320, 512, 640 };
  int width = gpu.mode & 0x40 ? 368 : widths[gpu.mode & 3];
  int height = gpu.range_bottom - gpu.range_top;
  if ((gpu.mode & 0x24) == 0x24) height *= 2;
  if (height <= 0 || height > 512) height = SCREEN_H;
  draw_flush();
  uint32_t *out = kit_screen(width, height);
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      uint32_t colour = 0;
      if (gpu.on) {
        uint16_t c = gpu_vram[(gpu.shown_y + y) & 511][(gpu.shown_x + x) & 1023];
        colour = (uint32_t)(c & 31) << 3 | (uint32_t)(c >> 5 & 31) << 11 | (uint32_t)(c >> 10 & 31) << 19;
      }
      out[y * width + x] = 0xFF000000u | colour;
    }
  }
}
