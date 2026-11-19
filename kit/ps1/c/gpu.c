// The PlayStation's graphics chip, the GPU, as a game writes it: a word at a time to GP0, which gathers each drawing
// command and its words, or a picture moved into video memory, and to GP1, which says what the screen shows. What it
// draws so far is what a 2D screen is made of first: rectangles filled in video memory, flat rectangles of any size,
// with the console's four ways of mixing a colour with what's there, the drawing area they stay inside and the offset
// they're moved by, the mask bit, pictures moved into video memory and within it, and the screen at the sizes the GPU
// has. Its polygons, lines and textures are the next steps: a command for one is taken, its words gathered, and nothing
// is drawn, so `prove` finds the frame that has one (kit/ps1/c/README.md).

#include "ps1-kit.h"

uint16_t gpu_vram[512][1024];

static struct {
  int left, top, right, bottom;      // the drawing area, inclusive
  int offset_x, offset_y;            // added to every vertex
  int shown_x, shown_y, width, height, on, mode;
  int range_top, range_bottom;
  uint32_t draw_mode;                // GP0 E1: the mixing of colours among it
  int set_mask, check_mask;          // GP0 E6
} gpu;

// a command being gathered: its words so far and how many it has
static uint32_t words[16];
static int have, needs;
// a picture being moved into video memory, a pixel at a time, two to a word
static int copy_x, copy_y, copy_w, copy_h, copy_done, copying;

// a colour of 8 bits a channel as the GPU takes them, as its 15 bits, red lowest
static uint16_t to_15(uint32_t colour) {
  return (uint16_t)((colour >> 3 & 31) | (colour >> 11 & 31) << 5 | (colour >> 19 & 31) << 10);
}

// a number of 11 bits with its sign, as a vertex's x and y are
static int signed11(uint32_t value) { return (int)(value << 21) >> 21; }

void gpu_power(void) {
  for (int y = 0; y < 512; y++) for (int x = 0; x < 1024; x++) gpu_vram[y][x] = 0;
  gpu_gp1(0);
}

// a pixel drawn with the GPU's mixing and mask bit, as a rectangle draws it
static void plot(int x, int y, uint16_t colour, int mixed) {
  uint16_t *at = &gpu_vram[y & 511][x & 1023];
  if (gpu.check_mask && (*at & 0x8000)) return;
  if (mixed) {
    int back[3] = { *at & 31, *at >> 5 & 31, *at >> 10 & 31 }, front[3] = { colour & 31, colour >> 5 & 31, colour >> 10 & 31 };
    int how = gpu.draw_mode >> 5 & 3, out = 0;
    for (int c = 0; c < 3; c++) {
      int v = how == 0 ? (back[c] + front[c]) >> 1 : how == 1 ? back[c] + front[c] : how == 2 ? back[c] - front[c] : back[c] + (front[c] >> 2);
      v = v < 0 ? 0 : v > 31 ? 31 : v;
      out |= v << (5 * c);
    }
    colour = (uint16_t)out;
  }
  *at = colour | (gpu.set_mask ? 0x8000 : 0);
}

// a flat rectangle at x, y of w by h, its corner moved by the offset and what's drawn kept inside the drawing area
static void rectangle(uint32_t colour, int x, int y, int w, int h, int mixed) {
  x += gpu.offset_x;
  y += gpu.offset_y;
  uint16_t c = to_15(colour);
  for (int row = y; row < y + h; row++) {
    if (row < gpu.top || row > gpu.bottom) continue;
    for (int col = x; col < x + w; col++) {
      if (col < gpu.left || col > gpu.right) continue;
      plot(col, row, c, mixed);
    }
  }
}

// GP0 02: a rectangle of video memory filled, its x and width in sixteens, with no area, offset or mask
static void fill(void) {
  uint16_t c = to_15(words[0]);
  int x = words[1] & 0x3F0, y = words[1] >> 16 & 0x1FF, w = ((words[2] & 0x3FF) + 15) & ~15, h = words[2] >> 16 & 0x1FF;
  for (int row = 0; row < h; row++) for (int col = 0; col < w; col++) gpu_vram[(y + row) & 511][(x + col) & 1023] = c;
}

// how many words a command has, from its first
static int length_of(uint32_t first) {
  uint32_t op = first >> 24;
  if (op == 0x02) return 3;
  if (op >= 0x20 && op < 0x40) {
    int corners = op & 8 ? 4 : 3, textured = (op & 4) != 0, shaded = (op & 0x10) != 0;
    return 1 + corners * (1 + textured) + (shaded ? corners - 1 : 0);
  }
  if (op >= 0x40 && op < 0x60) return op & 0x10 ? 4 : 3;
  if (op >= 0x60 && op < 0x80) return 2 + ((op & 4) != 0) + ((op & 0x18) == 0);
  if (op >= 0x80 && op < 0xA0) return 4;
  if (op >= 0xA0 && op < 0xE0) return 3;
  return 1;
}

// one whole command
static void command(void) {
  uint32_t op = words[0] >> 24;
  if (op == 0x02) return fill();
  if (op >= 0x60 && op < 0x80 && !(op & 4)) {
    // a flat rectangle: its size from its own word, or 1, 8 or 16 square
    int size = op >> 3 & 3, x = signed11(words[1]), y = signed11(words[1] >> 16);
    int w = size == 0 ? (int)(words[2] & 0x3FF) : size == 1 ? 1 : size == 2 ? 8 : 16, h = size == 0 ? (int)(words[2] >> 16 & 0x1FF) : w;
    return rectangle(words[0], x, y, w, h, (op & 2) != 0);
  }
  if (op >= 0x80 && op < 0xA0) {
    // a picture copied within video memory
    int sx = words[1] & 0x3FF, sy = words[1] >> 16 & 0x1FF, dx = words[2] & 0x3FF, dy = words[2] >> 16 & 0x1FF;
    int w = ((words[3] - 1) & 0x3FF) + 1, h = ((words[3] >> 16) - 1 & 0x1FF) + 1;
    for (int row = 0; row < h; row++) for (int col = 0; col < w; col++) {
      uint16_t c = gpu_vram[(sy + row) & 511][(sx + col) & 1023];
      uint16_t *to = &gpu_vram[(dy + row) & 511][(dx + col) & 1023];
      if (!(gpu.check_mask && (*to & 0x8000))) *to = c | (gpu.set_mask ? 0x8000 : 0);
    }
    return;
  }
  if (op >= 0xA0 && op < 0xC0) {
    // a picture moved into video memory: its words come next
    copy_x = words[1] & 0x3FF;
    copy_y = words[1] >> 16 & 0x1FF;
    copy_w = ((words[2] - 1) & 0x3FF) + 1;
    copy_h = ((words[2] >> 16) - 1 & 0x1FF) + 1;
    copy_done = 0;
    copying = 1;
    return;
  }
  switch (op) {
    case 0xE1: gpu.draw_mode = words[0] & 0xFFFFFF; break;
    case 0xE3: gpu.left = words[0] & 0x3FF; gpu.top = words[0] >> 10 & 0x3FF; break;
    case 0xE4: gpu.right = words[0] & 0x3FF; gpu.bottom = words[0] >> 10 & 0x3FF; break;
    case 0xE5: gpu.offset_x = signed11(words[0]); gpu.offset_y = signed11(words[0] >> 11); break;
    case 0xE6: gpu.set_mask = words[0] & 1; gpu.check_mask = words[0] >> 1 & 1; break;
    default: break;
  }
}

void gpu_gp0(uint32_t word) {
  if (copying) {
    for (int half = 0; half < 2 && copying; half++) {
      int x = copy_done % copy_w, y = copy_done / copy_w;
      uint16_t *to = &gpu_vram[(copy_y + y) & 511][(copy_x + x) & 1023];
      if (!(gpu.check_mask && (*to & 0x8000))) *to = (uint16_t)(word >> (16 * half)) | (gpu.set_mask ? 0x8000 : 0);
      if (++copy_done >= copy_w * copy_h) copying = 0;
    }
    return;
  }
  if (!have) needs = length_of(word);
  words[have++] = word;
  if (have < needs) return;
  have = 0;
  command();
}

void gpu_gp1(uint32_t word) {
  switch (word >> 24) {
    case 0x00:
      gpu.on = 0;
      gpu.shown_x = gpu.shown_y = 0;
      gpu.left = gpu.top = gpu.right = gpu.bottom = 0;
      gpu.offset_x = gpu.offset_y = 0;
      gpu.draw_mode = 0;
      gpu.set_mask = gpu.check_mask = 0;
      gpu.mode = 0;
      gpu.range_top = 0x10;
      gpu.range_bottom = 0x100;
      have = copying = 0;
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
