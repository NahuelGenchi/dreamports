// The video interface: what the screen shows of RDRAM, from where VI_ORIGIN says, at the size and place its registers
// give, in 16-bit or 32-bit colour, each line resampled to the screen's width and gamma-corrected when they ask for it.
//
// The page's picture is the one the proof tools' Nintendo 64 emulator makes, angrylion's: 640 pixels wide and 240
// lines high, 288 on a PAL console, with the picture placed where the console's timing puts it on a television and the
// rest black, its first 8 columns and last 7 black too, and a line the picture no longer covers kept for two frames
// before it goes. It's made once a frame, as the frame ends, from RDRAM as the frame left it, as the console's emulator
// makes it at the end of each field, and a frame the video interface shows nothing in leaves the last one on the
// screen. Followed from
// angrylion-rdp-plus as libretro/parallel-n64 has it at 2d90e20fa140b104d810bc0ea289f6f382e5086a
// (mupen64plus-video-angrylion/n64video/vi.c and vi/), whose authors are angrylion, Ziggy, Gonetz, Iconoclast and
// others.
//
// What it doesn't do yet (kit/n64/c/README.md): the anti-aliasing modes that read the coverage the RDP keeps, the
// divot and dither filters, gamma dithering on 32-bit pixels, and interlaced screens, which it shows as if they weren't.

#include "n64-kit.h"
#include "page.h"

uint32_t n64_vi[14];

enum { STATUS, ORIGIN, WIDTH, V_INTR, V_CURRENT, BURST, V_SYNC, H_SYNC, LEAP, H_START, V_START, V_BURST, X_SCALE, Y_SCALE };

#define PRESCALE_WIDTH 640
#define PRESCALE_HEIGHT 625

struct rgb { uint8_t r, g, b; };
static struct rgb prescale[PRESCALE_WIDTH * PRESCALE_HEIGHT];
static uint32_t fade[PRESCALE_HEIGHT];
static int was_blank, shown_width, shown_height;
static uint8_t gamma_table[256], gamma_dither_table[0x4000];
// the fields the video interface has shown, which seed gamma dithering's noise
static uint32_t fields;

static uint32_t integer_sqrt(uint32_t a) {
  uint32_t op = a, result = 0, one = 1u << 30;
  while (one > op) one >>= 2;
  while (one) {
    if (op >= result + one) op -= result + one, result += one << 1;
    result >>= 1, one >>= 2;
  }
  return result;
}

void vi_power(void) {
  for (int i = 0; i < 14; i++) n64_vi[i] = 0;
  for (int i = 0; i < PRESCALE_WIDTH * PRESCALE_HEIGHT; i++) prescale[i] = (struct rgb){ 0, 0, 0 };
  for (int i = 0; i < PRESCALE_HEIGHT; i++) fade[i] = 0;
  was_blank = 0, shown_width = shown_height = 0, fields = 0;
  for (uint32_t i = 0; i < 256; i++) gamma_table[i] = (uint8_t)(integer_sqrt(i << 6) << 1);
  for (uint32_t i = 0; i < 0x4000; i++) gamma_dither_table[i] = (uint8_t)(integer_sqrt(i) << 1);
}

// a pixel of RDRAM as the video interface reads it, its colour 8 bits a channel
static struct rgb fetch(int type, uint32_t origin, uint32_t index) {
  if (type == 2) {
    uint32_t at = ((origin >> 1) + index) & 0x3FFFFF;
    uint16_t pixel = (uint16_t)(n64_rdram[at * 2] << 8 | n64_rdram[at * 2 + 1]);
    return (struct rgb){ (uint8_t)((pixel >> 8) & 0xF8), (uint8_t)((pixel >> 3) & 0xF8), (uint8_t)((pixel << 2) & 0xF8) };
  }
  uint32_t at = ((origin >> 2) + index) & 0x1FFFFF;
  return (struct rgb){ n64_rdram[at * 4], n64_rdram[at * 4 + 1], n64_rdram[at * 4 + 2] };
}

static void lerp(struct rgb *up, struct rgb down, uint32_t fraction) {
  if (!fraction) return;
  up->r = (uint8_t)(((((int)down.r - up->r) * (int)fraction + 16) >> 5) + up->r);
  up->g = (uint8_t)(((((int)down.g - up->g) * (int)fraction + 16) >> 5) + up->g);
  up->b = (uint8_t)(((((int)down.b - up->b) * (int)fraction + 16) >> 5) + up->b);
}

static uint32_t noise(uint32_t *state) {
  *state = *state * 0x343FD + 0x269EC3;
  return (*state >> 16) & 0x7FFF;
}

static void gamma_filters(struct rgb *pixel, int gamma, int dither, uint32_t *state) {
  if (!gamma && !dither) return;
  if (!gamma) {
    uint32_t c = noise(state);
    if (pixel->r < 255) pixel->r += c & 1;
    if (pixel->g < 255) pixel->g += (c >> 1) & 1;
    if (pixel->b < 255) pixel->b += (c >> 2) & 1;
  } else if (!dither) {
    pixel->r = gamma_table[pixel->r], pixel->g = gamma_table[pixel->g], pixel->b = gamma_table[pixel->b];
  } else {
    uint32_t c = noise(state);
    pixel->r = gamma_dither_table[pixel->r << 6 | (c & 0x3F)];
    pixel->g = gamma_dither_table[pixel->g << 6 | ((c >> 6) & 0x3F)];
    pixel->b = gamma_dither_table[pixel->b << 6 | (((c >> 9) & 0x38) | (c & 7))];
  }
}

// The video interface's picture into the prescale buffer, as angrylion makes it: 0 when it shows nothing new.
static int update(void) {
  int v_start = (n64_vi[V_START] >> 16) & 0x3FF, h_start = (n64_vi[H_START] >> 16) & 0x3FF;
  int v_end = n64_vi[V_START] & 0x3FF, h_end = n64_vi[H_START] & 0x3FF;
  int hres = h_end - h_start, vres = (v_end - v_start) >> 1;
  uint32_t x_add = n64_vi[X_SCALE] & 0xFFF, x_start = (n64_vi[X_SCALE] >> 16) & 0xFFF;
  uint32_t y_add = n64_vi[Y_SCALE] & 0xFFF, y_start = (n64_vi[Y_SCALE] >> 16) & 0xFFF;
  int v_sync = n64_vi[V_SYNC] & 0x3FF;
  uint32_t width = n64_vi[WIDTH] & 0xFFF, origin = n64_vi[ORIGIN] & 0xFFFFFF, control = n64_vi[STATUS];
  if (!origin) return 0;
  int type = control & 3, gamma_dither = (control >> 2) & 1, gamma = (control >> 3) & 1, aa_mode = (control >> 8) & 3;
  int pal = v_sync > 525 + 25;
  h_start -= pal ? 128 : 108;
  int clamped_start = 0, clamped_width = 0;
  if (h_start < 0) {
    x_start += x_add * (uint32_t)-h_start;
    hres += h_start;
    h_start = 0, clamped_start = 1;
  }
  int offset = pal ? 44 : 34;
  v_start = (v_start - offset) / 2;
  if (v_start < 0) {
    y_start += y_add * (uint32_t)-v_start;
    v_start = 0;
  }
  if (hres + h_start > PRESCALE_WIDTH) hres = PRESCALE_WIDTH - h_start, clamped_width = 1;
  if (vres + v_start > PRESCALE_HEIGHT) vres = PRESCALE_HEIGHT - v_start;
  int active = v_sync - offset;
  if (active < 0) return 1;
  // a field shown, as the console's emulator counts them, which seeds gamma dithering's noise
  fields++;
  if (active > PRESCALE_HEIGHT) active = PRESCALE_HEIGHT;
  active >>= 1;
  int min_h = clamped_start ? 0 : 8, max_h = clamped_width ? hres : hres - 7;
  int blank = (type & 2) == 0, valid_h = hres > 0 && h_start < PRESCALE_WIDTH, h_stop = hres + h_start;
  if (blank && was_blank) return 0;
  was_blank = blank;
  shown_width = PRESCALE_WIDTH, shown_height = (pal ? 576 : 480) >> 1;
  const struct rgb black = { 0, 0, 0 };
  int i;
  if (blank) {
    for (i = 0; i < PRESCALE_HEIGHT; i++) fade[i] = 0;
    for (i = 0; i < PRESCALE_WIDTH * PRESCALE_HEIGHT; i++) prescale[i] = black;
  } else {
    // the borders: left and right of the picture black, and a line above or below it kept for two frames
    if (h_start > 0 && h_start < PRESCALE_WIDTH)
      for (i = 0; i < active; i++) for (int x = 0; x < h_start; x++) prescale[i * PRESCALE_WIDTH + x] = black;
    if (h_stop >= 0 && h_stop < PRESCALE_WIDTH)
      for (i = 0; i < active; i++) for (int x = h_stop; x < PRESCALE_WIDTH; x++) prescale[i * PRESCALE_WIDTH + x] = black;
    for (i = 0; i < v_start; i++) {
      if (fade[i] && !--fade[i]) {
        int from = valid_h ? h_start : 0, count = valid_h ? hres : PRESCALE_WIDTH;
        for (int x = 0; x < count; x++) prescale[i * PRESCALE_WIDTH + from + x] = black;
      }
    }
    for (int j = 0; j < vres; j++, i++) {
      if (valid_h) fade[i] = 2;
      else if (fade[i] && !--fade[i]) for (int x = 0; x < PRESCALE_WIDTH; x++) prescale[i * PRESCALE_WIDTH + x] = black;
    }
    for (; i < active; i++) {
      if (fade[i]) fade[i]--;
      if (!fade[i]) {
        int from = valid_h ? h_start : 0, count = valid_h ? hres : PRESCALE_WIDTH;
        for (int x = 0; x < count; x++) prescale[i * PRESCALE_WIDTH + from + x] = black;
      }
    }
  }
  if (!valid_h) return 0;
  for (int y = 0; y < vres; y++) {
    uint32_t current = y_start + (uint32_t)y * y_add, y_fraction = (current >> 5) & 0x1F;
    uint32_t line = width * (current >> 10), next_line = line + width;
    uint32_t seed = (fields * 0x9E3779B9u) ^ ((uint32_t)y * 0x85EBCA6Bu) ^ 3u;
    struct rgb *row = &prescale[(v_start + y) * PRESCALE_WIDTH + h_start];
    uint32_t x_offset = x_start;
    for (int x = 0; x < hres; x++, x_offset += x_add) {
      if (x < min_h || x >= max_h) {
        row[x] = black;
        continue;
      }
      uint32_t at = x_offset >> 10, x_fraction = (x_offset >> 5) & 0x1F;
      struct rgb colour = fetch(type, origin, line + at);
      if (aa_mode != 3 && (x_fraction || y_fraction)) {
        struct rgb next = fetch(type, origin, line + at + 1);
        lerp(&colour, fetch(type, origin, next_line + at), y_fraction);
        lerp(&next, fetch(type, origin, next_line + at + 1), y_fraction);
        lerp(&colour, next, x_fraction);
      }
      gamma_filters(&colour, gamma, gamma_dither, &seed);
      row[x] = colour;
    }
  }
  return 1;
}

void vi_update(void) { update(); }

void n64_show(void) {
  // before the video interface shows anything, the screen is black, at its size
  int width = shown_width ? shown_width : SCREEN_W, height = shown_height ? shown_height : SCREEN_H;
  uint32_t *out = kit_screen(width, height);
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      struct rgb c = y < PRESCALE_HEIGHT && x < PRESCALE_WIDTH ? prescale[y * PRESCALE_WIDTH + x] : (struct rgb){ 0, 0, 0 };
      out[y * width + x] = 0xFF000000u | (uint32_t)c.b << 16 | (uint32_t)c.g << 8 | c.r;
    }
  }
}
