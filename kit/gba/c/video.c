// The GBA's video hardware in C, line for line the JavaScript kit's (kit/gba/video.js), which draws the way mGBA's
// software renderer does (mGBA 0.10, src/gba/renderers/), the emulator the original games are recorded in. Each
// function here is the one of the same name there, so a change to one is made to the other, and the kit's test
// (tools/test/c-kit.mjs) draws made-up scenes with both and fails on any pixel that differs.
//
// It draws the original screen. The widescreen view and the mosaic aren't drawn yet, as in video.js the mosaic
// and the OBJ window aren't: a game that needs one adds it to both.

#include "gba.h"

uint8_t gba_vram[0x18000];
uint16_t gba_pal[512];
uint16_t gba_oam[512];
uint16_t gba_io[GBA_IO_HALFWORDS];
const uint32_t *gba_underlay;

// what each register keeps of a write
static uint16_t mask_of(unsigned reg) {
  switch (reg) {
    case 0x00: return 0xFFF7;
    case 0x08: case 0x0A: return 0xDFFF;
    case 0x50: return 0x3FFF;
    case 0x52: return 0x1F1F;
    case 0x54: return 0x1F;
    case 0x48: case 0x4A: return 0x3F3F;
  }
  if (reg >= 0x10 && reg < 0x20 && !(reg & 1)) return 0x1FF;
  return 0xFFFF;
}

// a pixel on its way through a line: its colour in the low 24 bits (red in the lowest byte), and above it, in an
// order that makes the front-most of two pixels the smaller number, its priority, which background it comes
// from, whether it is a background, and its part in the colour effects
#define PRIORITY_SHIFT 30
#define INDEX_SHIFT 28
#define IS_BACKGROUND 0x08000000u
#define UNWRITTEN 0xFC000000u
#define REBLEND 0x04000000u
#define TARGET_1 0x02000000u
#define TARGET_2 0x01000000u
#define ORDER 0xF8000000u
#define KEEP (0x00FFFFFFu | REBLEND | TARGET_2)   // what a pixel keeps once another has been put behind it
#define WRITABLE 0xFE000000u
enum { NONE = 0, ALPHA = 1, BRIGHTEN = 2, DARKEN = 3 };
// a sprite's draw time in cycles per line, out of 1210 (954 with H-blank free for OAM)
#define OBJ_CYCLES 1210
#define OBJ_CYCLES_HBLANK_FREE 954
#define MAX_W 512

// GBA object sizes by shape * 4 + size
static const uint8_t OBJ_SIZES[16][2] = {
  {8, 8}, {16, 16}, {32, 32}, {64, 64}, {16, 8}, {32, 8}, {32, 16}, {64, 32},
  {8, 16}, {8, 32}, {16, 32}, {32, 64}, {8, 8}, {8, 8}, {8, 8}, {8, 8},
};

// a halfword sign-extended, and the low `bits` of a value
static int32_t s16(uint32_t v) { return (int32_t)(int16_t)(uint16_t)v; }
static int32_t sbits(uint32_t v, int bits) { return (int32_t)(v << (32 - bits)) >> (32 - bits); }
// VRAM by halfword, which reads 0 past its end as a typed array's missing element does in video.js
static uint16_t vram16(uint32_t i) {
  return i < 0xC000 ? (uint16_t)(gba_vram[i * 2] | gba_vram[i * 2 + 1] << 8) : 0;
}

uint32_t gba_color555(uint16_t c) {
  uint32_t v = ((c & 0x1Fu) << 3) | (((c >> 5) & 0x1Fu) << 11) | (((c >> 10) & 0x1Fu) << 19);
  return v | ((v >> 5) & 0x070707u);
}

static uint32_t brighten(uint32_t c, uint32_t y) {
  uint32_t a = c & 0xFF, out = (a + (((0xFF - a) * y) >> 4)) & 0xFF;
  a = c & 0xFF00; out |= (a + ((0xFF00 - a) * y) / 16) & 0xFF00;
  a = c & 0xFF0000; out |= (a + ((0xFF0000 - a) * y) / 16) & 0xFF0000;
  return out;
}

static uint32_t darken(uint32_t c, uint32_t y) {
  uint32_t a = c & 0xFF, out = (a - ((a * y) >> 4)) & 0xFF;
  a = c & 0xFF00; out |= (a - (a * y) / 16) & 0xFF00;
  a = c & 0xFF0000; out |= (a - (a * y) / 16) & 0xFF0000;
  return out;
}

// alpha blending: each channel weighted by its sixteenths and capped at full
static uint32_t mix(uint32_t wa, uint32_t a, uint32_t wb, uint32_t b) {
  uint32_t r = ((a & 0xFF) * wa + (b & 0xFF) * wb) >> 4;
  if (r > 0xFF) r = 0xFF;
  uint32_t g = (((a >> 8) & 0xFF) * wa + ((b >> 8) & 0xFF) * wb) >> 4;
  if (g > 0xFF) g = 0xFF;
  uint32_t bl = (((a >> 16) & 0xFF) * wa + ((b >> 16) & 0xFF) * wb) >> 4;
  if (bl > 0xFF) bl = 0xFF;
  return r | (g << 8) | (bl << 16);
}

// what the renderer keeps besides the registers: the rotating layers' reference points, which advance down the
// frame, and the colours as it draws them
static int32_t ref[2][2], cur[2][2];
static uint32_t normal[512], variant[512];
static int variant_for = -1;   // the effect and level the variant colours were made for

static uint32_t row[MAX_W], sprite_layer[MAX_W];
typedef struct { int end_x; int ctl; } Window;
static Window windows[64];
static int n_windows = 1;

static void (*hblank_fn)(int y);
void gba_on_hblank(void (*hblank)(int y)) { hblank_fn = hblank; }

void gba_write(unsigned reg, uint16_t value) {
  value &= mask_of(reg);
  gba_io[reg >> 1] = value;
  if (reg >= 0x28 && reg < 0x40 && (reg & 0xF) >= 8) {
    // BGxX and BGxY: a write sets the reference point and restarts it from there
    int bg = reg >= 0x38 ? 1 : 0, axis = (reg & 4) >> 2, hi = reg & 2;
    uint32_t v = (uint32_t)ref[bg][axis];
    v = hi ? ((v & 0xFFFF) | ((uint32_t)value << 16)) : ((v & ~0xFFFFu) | value);
    ref[bg][axis] = cur[bg][axis] = sbits(v, 28);
  }
}

void gba_update_colors(void) {
  for (int i = 0; i < 512; i++) normal[i] = gba_color555(gba_pal[i]);
  variant_for = -1;
}

static void update_variant(int effect, uint32_t y) {
  int key = effect * 32 + (int)y;
  if (key == variant_for) return;
  variant_for = key;
  if (effect == BRIGHTEN) for (int i = 0; i < 512; i++) variant[i] = brighten(normal[i], y);
  else if (effect == DARKEN) for (int i = 0; i < 512; i++) variant[i] = darken(normal[i], y);
  else for (int i = 0; i < 512; i++) variant[i] = normal[i];
}

// the windows across line y: runs of pixels, each ending at end_x, with the control bits of the window that
// covers them (bits 0-3 the backgrounds, 4 the sprites, 5 the colour effects)
static void window_span(unsigned reg_h, int *start, int *end) {
  uint16_t v = gba_io[reg_h >> 1];
  int e = v & 0xFF, s = v >> 8;
  if (s > SCREEN_W && s > e) s = 0;
  if (e > SCREEN_W) { e = SCREEN_W; if (s > SCREEN_W) s = SCREEN_W; }
  *start = s; *end = e;
}
static void window_rows(unsigned reg_v, int *start, int *end) {
  uint16_t v = gba_io[reg_v >> 1];
  int e = v & 0xFF, s = v >> 8;
  if (s > SCREEN_H && s > e) s = 0;
  if (e > SCREEN_H) { e = SCREEN_H; if (s > SCREEN_H) s = SCREEN_H; }
  *start = s; *end = e;
}
static void break_window_inner(int start, int end, int ctl) {
  int start_x = 0;
  if (end <= 0) return;
  for (int i = 0; i < n_windows; i++) {
    if (start < windows[i].end_x) {
      Window old = windows[i];
      if (start > start_x) {
        for (int n = n_windows++; n > i; n--) windows[n] = windows[n - 1];
        windows[i].end_x = start;
        i++;
      }
      windows[i].ctl = ctl;
      windows[i].end_x = end;
      if (end >= old.end_x) {
        for (i++; n_windows > i + 1 && end >= windows[i].end_x; i++) {
          windows[i] = windows[i + 1];
          n_windows--;
        }
      } else {
        i++;
        for (int n = n_windows++; n > i; n--) windows[n] = windows[n - 1];
        windows[i] = old;
      }
      return;
    }
    start_x = windows[i].end_x;
  }
}
static void break_window(int n, int y) {
  int vs, ve, hs, he;
  window_rows(REG_WIN0V + n * 2, &vs, &ve);
  if (ve >= vs) { if (y >= ve || y < vs) return; }
  else if (y >= ve && y < vs) return;
  window_span(REG_WIN0H + n * 2, &hs, &he);
  int ctl = (gba_io[REG_WININ >> 1] >> (n * 8)) & 0x3F;
  if (he < hs) { break_window_inner(0, he, ctl); break_window_inner(hs, SCREEN_W, ctl); }
  else break_window_inner(hs, he, ctl);
}

// the sprites that can show this frame, in OAM order: each one's attributes, top line, bottom line and draw time
typedef struct { uint16_t a, b, c; int y, end_y, cycles; } Sprite;
static Sprite sprites[128];
static int n_sprites;
static void clean_oam(void) {
  n_sprites = 0;
  for (int i = 0; i < 128; i++) {
    uint16_t a = gba_oam[i * 4], b = gba_oam[i * 4 + 1], c = gba_oam[i * 4 + 2];
    int affine = a & 0x100;
    if (!affine && (a & 0x200)) continue;
    int w = OBJ_SIZES[((a >> 14) * 4) + (b >> 14)][0], h = OBJ_SIZES[((a >> 14) * 4) + (b >> 14)][1], cycles = w;
    if (affine) { int d = (a >> 9) & 1; w <<= d; h <<= d; cycles = 10 + w * 2; }
    int y = a & 0xFF, x = b & 0x1FF;
    if (y >= SCREEN_H && y + h < 228) continue;
    if (x >= SCREEN_W && x + w < 512) continue;
    sprites[n_sprites++] = (Sprite){ a, b, c, y, y + h, cycles };
  }
}

// state for one line, set as it is drawn
static uint16_t dispcnt;
static int mode, effect, force_target_1;
static uint32_t blda, bldb, bldy;
static int target_1_obj, target_2_obj, target_1_bd, target_2_bd;
typedef struct { int index, cnt, priority, target1, target2, enabled; } Bg;
static Bg bgs[4] = { { .index = 0 }, { .index = 1 }, { .index = 2 }, { .index = 3 } };

// puts `color` behind or in front of what is already at x, blending it in as the second target if the pixel
// in front is a first target
static void blend_into(int x, uint32_t color) {
  uint32_t current = row[x];
  if (color >= current) {
    row[x] = (current & TARGET_1) && (color & TARGET_2) ? mix(blda, current, bldb, color) : (current & KEEP);
  } else row[x] = color & ~TARGET_2;
}
static void lay_into(int x, uint32_t color) {
  uint32_t current = row[x];
  row[x] = color >= current ? (current & KEEP) : color;
}

// one sprite's pixel into the sprite layer
static uint32_t put_flags;
static const uint32_t *put_colors;
static int put_pal_base;
static void put(int out_x, int pixel) {
  uint32_t current = sprite_layer[out_x];
  if ((current & ORDER) <= put_flags) return;
  if (pixel) sprite_layer[out_x] = put_colors[put_pal_base + pixel] | put_flags;
  else if (current != UNWRITTEN) sprite_layer[out_x] = (current & ~(ORDER | REBLEND | TARGET_1)) | (put_flags & (ORDER | REBLEND | TARGET_1));
}
// one of a sprite's texels
static int fetch_is256, fetch_stride, fetch_char_base, fetch_mask_lo, fetch_mask_hi;
#define OBJ 0x10000
static int fetch(int local_x, int local_y) {
  if (fetch_is256) {
    int x_base = (local_x & ~7) * 8 + (local_x & 6), y_base = (local_y & ~7) * fetch_stride + (local_y & 7) * 8 + fetch_mask_hi;
    uint16_t t = vram16((uint32_t)(OBJ + ((y_base + ((x_base + fetch_char_base) & fetch_mask_lo)) & 0x7FFE)) >> 1);
    return (t >> ((local_x & 1) << 3)) & 0xFF;
  }
  int x_base = (local_x & ~7) * 4 + ((local_x >> 1) & 2), y_base = (local_y & ~7) * fetch_stride + (local_y & 7) * 4 + fetch_mask_hi;
  uint16_t t = vram16((uint32_t)(OBJ + ((y_base + ((x_base + fetch_char_base) & fetch_mask_lo)) & 0x7FFE)) >> 1);
  return (t >> ((local_x & 3) << 2)) & 0xF;
}

// one sprite across the run [start, end) of line y, into the sprite layer; returns whether it drew there
static int draw_sprite(const Sprite *s, int y, int start, int end, int ctl) {
  uint16_t a = s->a, b = s->b, c = s->c;
  int width = OBJ_SIZES[((a >> 14) * 4) + (b >> 14)][0], height = OBJ_SIZES[((a >> 14) * 4) + (b >> 14)][1];
  int obj_mode = (a >> 10) & 3, blend_on = (ctl & 0x20) != 0;
  uint32_t flags = (uint32_t)((c >> 10) & 3) << PRIORITY_SHIFT;
  if ((blend_on && target_1_obj && effect == ALPHA) || obj_mode == 1) flags |= TARGET_1;
  if (obj_mode == 2) return 0;   // the OBJ window: not drawn yet
  int x = sbits(b, 9);
  int map1d = (dispcnt & 0x40) != 0, is256 = (a & 0x2000) != 0;
  int char_base = ((c & 0x3FF) & ~(is256 && !map1d ? 1 : 0)) * 0x20;
  int mask_lo = map1d ? 0x7FFE : 0x3FE, mask_hi = map1d ? 0 : char_base & 0x7C00;
  if (mode >= 3 && (c & 0x3FF) < 512) return 0;
  int use_variant = target_1_obj && blend_on && (effect == BRIGHTEN || effect == DARKEN);
  if (obj_mode == 1 || (target_1_obj && effect == ALPHA)) {
    int target2 = target_2_bd;
    for (int i = 0; i < 4; i++) if (bgs[i].target2 && bgs[i].enabled) target2 = 1;
    if (target2) { force_target_1 = 1; flags |= REBLEND; use_variant = 0; }
    else flags &= ~TARGET_1;
  }
  put_flags = flags;
  put_colors = use_variant ? variant : normal;
  put_pal_base = 256 + (is256 ? 0 : (c >> 12) << 4);
  int in_y = y - (a & 0xFF);
  fetch_is256 = is256;
  fetch_stride = map1d ? (width >> (is256 ? 0 : 1)) : 0x80;
  fetch_char_base = char_base; fetch_mask_lo = mask_lo; fetch_mask_hi = mask_hi;

  if (a & 0x100) {
    int dbl = (a >> 9) & 1, total_width = width << dbl, total_height = height << dbl;
    int m = ((b >> 9) & 0x1F) * 16;
    int32_t pa = s16(gba_oam[m + 3]), pb = s16(gba_oam[m + 7]), pc = s16(gba_oam[m + 11]), pd = s16(gba_oam[m + 15]);
    if (in_y < 0) in_y += 256;
    int out_x = x >= start ? x : start, condition = x + total_width, in_x = out_x - x;
    if (end < condition) condition = end;
    int32_t x_accum = pa * (in_x - 1 - (total_width >> 1)) + pb * (in_y - (total_height >> 1)) + (width << 7);
    int32_t y_accum = pc * (in_x - 1 - (total_width >> 1)) + pd * (in_y - (total_height >> 1)) + (height << 7);
    // skips ahead to the first texel inside the sprite; its end isn't worked out, the run stops there
#define SKIP(n) do { int32_t k_ = (n); x_accum += pa * k_; y_accum += pc * k_; out_x += k_; in_x += k_; } while (0)
    if (pa) {
      if ((x_accum >> 8) < 0) SKIP((-x_accum - 1) / pa);
      else if ((x_accum >> 8) >= width) SKIP(((width << 8) - x_accum) / pa);
    }
    if (pc) {
      if ((y_accum >> 8) < 0) SKIP((-y_accum - 1) / pc);
      else if ((y_accum >> 8) >= height) SKIP(((height << 8) - y_accum) / pc);
    }
#undef SKIP
    if (out_x < start || out_x >= condition) return 0;
    for (; out_x < condition; out_x++, in_x++) {
      x_accum += pa; y_accum += pc;
      int local_x = x_accum >> 8, local_y = y_accum >> 8;
      if ((local_x & ~(width - 1)) || (local_y & ~(height - 1))) break;
      put(out_x, fetch(local_x, local_y));
    }
    return 1;
  }

  int out_x = x >= start ? x : start, condition = x + width;
  if ((a & 0xFF) + height - 256 >= 0) in_y += 256;
  if (b & 0x2000) in_y = height - in_y - 1;
  if (end < condition) condition = end;
  int in_x = out_x - x, step = 1;
  if (b & 0x1000) { in_x = width - in_x - 1; step = -1; }
  for (; out_x < condition; out_x++, in_x += step) put(out_x, fetch(in_x, in_y));
  return 1;
}

static uint32_t bg_flags(const Bg *bg, int ctl, const uint32_t **colors) {
  uint32_t flags = ((uint32_t)bg->priority << PRIORITY_SHIFT) | ((uint32_t)bg->index << INDEX_SHIFT) | IS_BACKGROUND;
  if (bg->target2) flags |= TARGET_2;
  if (effect == ALPHA) {
    if (blda == 0x10 && bldb == 0) flags &= ~TARGET_2;
    else if (bg->target1 && (ctl & 0x20)) flags |= TARGET_1;
  }
  int use_variant = bg->target1 && (ctl & 0x20) && (effect == BRIGHTEN || effect == DARKEN);
  *colors = use_variant ? variant : normal;
  return flags;
}

// a picture put behind everything the scene draws, as a background of the lowest priority (BG3)
static void draw_underlay(uint16_t bldcnt, int y, int start, int end, int ctl) {
  if (!(ctl & 8)) return;
  Bg under = { 3, 0, 3, (bldcnt & 8) != 0, (bldcnt & 0x800) != 0, 0 };
  const uint32_t *colors;
  uint32_t flags = bg_flags(&under, ctl, &colors);
  int blend = (flags & TARGET_2) != 0, lit = colors == variant;
  for (int x = start; x < end; x++) {
    uint32_t c = gba_underlay[y * SCREEN_W + x] & 0xFFFFFF;
    if (lit) c = effect == DARKEN ? darken(c, bldy) : brighten(c, bldy);
    if (blend) blend_into(x, c | flags);
    else lay_into(x, c | flags);
  }
}

// the sprites of priority `priority` over the run [start, end)
static void composite_sprites(int priority, int start, int end, int ctl) {
  if (!(ctl & 0x10)) return;
  uint32_t flags = target_2_obj ? TARGET_2 : 0;
  for (int x = start; x < end; x++) {
    uint32_t color = sprite_layer[x];
    if ((color & UNWRITTEN) == UNWRITTEN || (int)(color >> PRIORITY_SHIFT) != priority) continue;
    blend_into(x, color | flags);
  }
}

// mGBA draws a run's first tile on its own when the run starts partway into it (software-mode0.c,
// DRAW_BACKGROUND_MODE_0_TILE_SUFFIX_16 and _256), and not quite as the console does when the run also ends inside
// it: a flipped tile goes from the run's last pixel back, from the tile's first column, and a 256-colour one in two
// halves of 4 pixels, the second from the tile's fifth column. The column of the tile's row that x shows, from the
// run [start, end) inside the tile and the run's start in it, `mod8`, or 8 or more for none.
static int first_tile_column(int x, int start, int end, int mod8, int is256, int hflip) {
  if (hflip) return end - 1 - x;
  if (!is256) return mod8 + x - start;
  if (end - 4 > start) return x < end - 4 ? mod8 + x - start : 4 + x - (end - 4);
  return 4 + (mod8 & 3) + x - start;
}

// a text background over [start, end) of line y
static void draw_text(const Bg *bg, int y, int start, int end, int ctl) {
  if (!(ctl & (1 << bg->index))) return;
  const uint32_t *colors;
  uint32_t flags = bg_flags(bg, ctl, &colors);
  int blend = (flags & TARGET_2) != 0;
  int cnt = bg->cnt, size = cnt >> 14, is256 = (cnt & 0x80) != 0;
  int char_base = ((cnt >> 2) & 3) << 14, screen_base = ((cnt >> 8) & 0x1F) << 11;
  int hofs = gba_io[(REG_BG0HOFS >> 1) + bg->index * 2], vofs = gba_io[(REG_BG0HOFS >> 1) + bg->index * 2 + 1];
  int in_y = y + vofs;
  int y_base = in_y & 0xF8;
  if (size == 2) y_base += in_y & 0x100;
  else if (size == 3) y_base += (in_y & 0x100) << 1;
  y_base = (screen_base >> 1) + (y_base << 2);
  // the run's first tile, when it starts partway into one, ends at first_end
  int mod8 = (start + hofs) & 7, first_end = mod8 ? start + 8 - mod8 : start;
  if (first_end > end) first_end = end;
  for (int x = start; x < end; x++) {
    int local_x = (x + hofs) & 0x1FF;
    int x_base = local_x & 0xF8;
    if (size & 1) x_base += (local_x & 0x100) << 5;
    uint16_t map = vram16((uint32_t)(y_base + (x_base >> 3)) & 0xFFFF);
    int ty = in_y & 7, tx = local_x & 7;
    if (map & 0x800) ty = 7 - ty;
    if (x < first_end) tx = first_tile_column(x, start, first_end, mod8, is256, map & 0x400);
    else if (map & 0x400) tx = 7 - tx;
    if (tx > 7) continue;
    int pixel;
    uint32_t color;
    if (is256) {
      pixel = gba_vram[(uint32_t)(char_base + ((map & 0x3FF) << 6) + (ty << 3) + tx) % 0x18000];
      if (!pixel) continue;
      color = colors[pixel];
    } else {
      int byte = gba_vram[(uint32_t)(char_base + ((map & 0x3FF) << 5) + (ty << 2) + (tx >> 1)) % 0x18000];
      pixel = tx & 1 ? byte >> 4 : byte & 0xF;
      if (!pixel) continue;
      color = colors[((map >> 12) << 4) | pixel];
    }
    if (!(row[x] & WRITABLE)) continue;
    if (blend) blend_into(x, color | flags);
    else lay_into(x, color | flags);
  }
}

// a rotating background over [start, end) of line y
static void draw_affine(const Bg *bg, int start, int end, int ctl) {
  if (!(ctl & (1 << bg->index))) return;
  const uint32_t *colors;
  uint32_t flags = bg_flags(bg, ctl, &colors);
  int blend = (flags & TARGET_2) != 0;
  int cnt = bg->cnt, size = cnt >> 14, wrap = (cnt & 0x2000) != 0;
  int32_t span = 0x8000 << size;
  int char_base = ((cnt >> 2) & 3) << 14, screen_base = ((cnt >> 8) & 0x1F) << 11;
  int r = (REG_BG2PA >> 1) + (bg->index - 2) * 8;
  int32_t pa = s16(gba_io[r]), pc = s16(gba_io[r + 2]);
  int32_t x = cur[bg->index - 2][0] + (start - 1) * pa, y = cur[bg->index - 2][1] + (start - 1) * pc;
  for (int out_x = start; out_x < end; out_x++) {
    x += pa; y += pc;
    int32_t lx = x, ly = y;
    if (wrap) { lx &= span - 1; ly &= span - 1; }
    else if ((x | y) & ~(span - 1)) continue;
    int map = gba_vram[screen_base + (lx >> 11) + (((ly >> 7) & 0x7F0) << size)];
    int pixel = gba_vram[char_base + (map << 6) + ((ly & 0x700) >> 5) + ((lx & 0x700) >> 8)];
    if (!pixel || !(row[out_x] & WRITABLE)) continue;
    if (blend) blend_into(out_x, colors[pixel] | flags);
    else lay_into(out_x, colors[pixel] | flags);
  }
}

// mode 4's background over [start, end) of line y: a picture of one byte a pixel, in the page DISPCNT picks
static void draw_bitmap(const Bg *bg, int start, int end, int ctl) {
  if (!(ctl & 4)) return;
  const uint32_t *colors;
  uint32_t flags = bg_flags(bg, ctl, &colors);
  int blend = (flags & TARGET_2) != 0, page = dispcnt & 0x10 ? 0xA000 : 0;
  int r = REG_BG2PA >> 1;
  int32_t pa = s16(gba_io[r]), pc = s16(gba_io[r + 2]);
  int32_t x = cur[0][0] + (start - 1) * pa, y = cur[0][1] + (start - 1) * pc;
  for (int out_x = start; out_x < end; out_x++) {
    x += pa; y += pc;
    int32_t lx = x >> 8, ly = y >> 8;
    if (lx < 0 || ly < 0 || lx >= SCREEN_W || ly >= SCREEN_H) continue;
    int pixel = gba_vram[page + ly * SCREEN_W + lx];
    if (!pixel || !(row[out_x] & WRITABLE)) continue;
    if (blend) blend_into(out_x, colors[pixel] | flags);
    else lay_into(out_x, colors[pixel] | flags);
  }
}

static void draw_line(int y, uint32_t *out) {
  dispcnt = gba_io[0];
  if (dispcnt & 0x80) { for (int i = 0; i < SCREEN_W; i++) out[i] = 0xFFFFFFFF; return; }
  mode = dispcnt & 7;
  uint16_t bldcnt = gba_io[REG_BLDCNT >> 1], alpha = gba_io[REG_BLDALPHA >> 1];
  effect = (bldcnt >> 6) & 3;
  blda = alpha & 0x1F; if (blda > 16) blda = 16;
  bldb = (alpha >> 8) & 0x1F; if (bldb > 16) bldb = 16;
  bldy = gba_io[REG_BLDY >> 1] & 0x1F; if (bldy > 16) bldy = 16;
  target_1_obj = (bldcnt & 0x10) != 0; target_1_bd = (bldcnt & 0x20) != 0;
  target_2_obj = (bldcnt & 0x1000) != 0; target_2_bd = (bldcnt & 0x2000) != 0;
  int any_target_1 = 0;
  for (int i = 0; i < 4; i++) {
    Bg *bg = &bgs[i];
    bg->cnt = gba_io[(REG_BG0CNT >> 1) + i];
    bg->priority = bg->cnt & 3;
    bg->target1 = (bldcnt & (1 << i)) != 0;
    bg->target2 = (bldcnt & (0x100 << i)) != 0;
    bg->enabled = (dispcnt & (0x100 << i)) != 0;
    any_target_1 |= bg->target1;
  }
  update_variant(effect, bldy);

  for (int i = 0; i < MAX_W; i++) sprite_layer[i] = UNWRITTEN;
  windows[0].end_x = SCREEN_W;
  n_windows = 1;
  if (dispcnt & 0xE000) {
    windows[0].ctl = gba_io[REG_WINOUT >> 1] & 0x3F;
    if (dispcnt & 0x4000) break_window(1, y);
    if (dispcnt & 0x2000) break_window(0, y);
  } else windows[0].ctl = 0xFF;
  force_target_1 = 0;

  // the backdrop
  int x = 0;
  for (int w = 0; w < n_windows; w++) {
    int lit = target_1_bd && (effect == BRIGHTEN || effect == DARKEN) && (windows[w].ctl & 0x20);
    uint32_t backdrop = (lit ? variant[0] : normal[0]) | UNWRITTEN | (3u << PRIORITY_SHIFT) | IS_BACKGROUND;
    for (; x < windows[w].end_x; x++) row[x] = backdrop;
  }

  // the sprites into their own layer, each drawing for as long as the line's time lasts
  int sprite_layers = 0;
  if (dispcnt & 0x1000) {
    int cycles = dispcnt & 0x20 ? OBJ_CYCLES_HBLANK_FREE : OBJ_CYCLES;
    for (int i = 0; i < n_sprites; i++) {
      const Sprite *s = &sprites[i];
      if ((y < s->y && (s->end_y - 256 < 0 || y >= s->end_y - 256)) || y >= s->end_y) continue;
      int end = 0;
      for (int w = 0; w < n_windows; w++) {
        int start = end;
        end = windows[w].end_x;
        if (!(windows[w].ctl & 0x10)) continue;
        sprite_layers |= draw_sprite(s, y, start, end, windows[w].ctl) << ((s->c >> 10) & 3);
      }
      cycles -= s->cycles;
      if (cycles <= 0) break;
    }
  }

  int end = 0;
  for (int w = 0; w < n_windows; w++) {
    int start = end, ctl = windows[w].ctl;
    end = windows[w].end_x;
    for (int p = 0; p < 4; p++) {
      if (sprite_layers & (1 << p)) composite_sprites(p, start, end, ctl);
      for (int i = 0; i < 4; i++) {
        const Bg *bg = &bgs[i];
        if (!bg->enabled || bg->priority != p) continue;
        int text = i < 2 ? mode < 2 : mode == 0;
        int affine = i == 2 ? mode == 1 || mode == 2 : i == 3 && mode == 2;
        if (text) draw_text(bg, y, start, end, ctl);
        else if (affine) draw_affine(bg, start, end, ctl);
        else if (i == 2 && mode == 4) draw_bitmap(bg, start, end, ctl);
      }
      if (p == 3 && gba_underlay) draw_underlay(bldcnt, y, start, end, ctl);
    }
  }

  // a first target with nothing behind it but the backdrop, as the second target
  if ((force_target_1 || any_target_1) && target_2_bd) {
    x = 0;
    for (int w = 0; w < n_windows; w++) {
      int lit = target_1_bd && (effect == BRIGHTEN || effect == DARKEN) && (windows[w].ctl & 0x20);
      uint32_t backdrop = lit ? variant[0] : normal[0];
      for (; x < windows[w].end_x; x++) if (row[x] & TARGET_1) row[x] = mix(bldb, backdrop, blda, row[x]);
    }
  }
  // semi-transparent sprites with nothing to blend with take the brightness effect
  if (force_target_1 && (effect == DARKEN || effect == BRIGHTEN)) {
    x = 0;
    for (int w = 0; w < n_windows; w++) {
      int end_x = windows[w].end_x;
      if (!(windows[w].ctl & 0x20)) { x = end_x; continue; }
      for (; x < end_x; x++) {
        if ((row[x] & (REBLEND | IS_BACKGROUND)) == REBLEND) row[x] = effect == DARKEN ? darken(row[x], bldy) : brighten(row[x], bldy);
      }
    }
  }

  if (mode != 0) {
    for (int k = 0; k < 2; k++) {
      if (!bgs[k + 2].enabled) continue;
      int r = (REG_BG2PA >> 1) + k * 8;
      cur[k][0] += s16(gba_io[r + 1]);
      cur[k][1] += s16(gba_io[r + 3]);
    }
  }
  for (int i = 0; i < SCREEN_W; i++) out[i] = (row[i] & 0xFFFFFF) | 0xFF000000u;
}

void gba_draw_frame(uint32_t *out) {
  uint16_t before[GBA_IO_HALFWORDS];
  int32_t before_ref[2][2];
  for (int i = 0; i < GBA_IO_HALFWORDS; i++) before[i] = gba_io[i];
  for (int k = 0; k < 2; k++) { before_ref[k][0] = ref[k][0]; before_ref[k][1] = ref[k][1]; }
  gba_update_colors();
  clean_oam();
  for (int y = 0; y < SCREEN_H; y++) {
    draw_line(y, out + y * SCREEN_W);
    if (hblank_fn) hblank_fn(y);
  }
  for (int i = 0; i < GBA_IO_HALFWORDS; i++) gba_io[i] = before[i];
  for (int k = 0; k < 2; k++) { ref[k][0] = before_ref[k][0]; ref[k][1] = before_ref[k][1]; }
  // the V-blank starts the rotating layers from their reference points again
  for (int k = 0; k < 2; k++) { cur[k][0] = ref[k][0]; cur[k][1] = ref[k][1]; }
}
