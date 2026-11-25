// The Game Boy's picture hardware: the background and the window, each a map of 8 by 8 tiles, 40 sprites of 8 by 8 or
// 8 by 16, ten to a line, the Game Boy's three palettes of four shades and the Game Boy Color's sixteen of four
// colours, with its second bank of tiles and each tile's own palette, flips and priority. It draws each line as the
// console does, 456 cycles a line and 154 lines a picture, as far as the time has got, so a write partway down the
// screen shows from where the console had got to. And it asks for the screen's interrupts when the console does: as
// V-blank starts, at the line LYC names, and as each line's mode 2 and mode 0 start.

#include "gb.h"
#include "gb-kit.h"

#define NEVER UINT64_MAX

// when a line's drawing starts, after the 80 cycles the console looks for its sprites in, and how far into it the
// first pixel comes out
#define MODE3_STARTS 83
#define FIRST_PIXEL (MODE3_STARTS + 9)
// when a line with nothing to slow it has drawn its last pixel, and mode 0 starts
#define MODE0_STARTS (MODE3_STARTS + 167)

static uint8_t lcdc, stat, scy, scx, lyc, bgp, obp0, obp1, wy, wx, bcps, ocps;
static uint8_t bg_colours[64], sprite_colours[64];
static int colour;
static uint64_t origin;           // the cycle line 0 of the picture being drawn started at
static uint64_t requested_to;     // the cycle the interrupts are asked for up to
static int line_at, pixel_at;     // how far the picture is drawn: the line, 0 to 144, and the pixel in it
static int window_line, window_reached;
static uint16_t drawn[SCREEN_W * SCREEN_H], shown[SCREEN_W * SCREEN_H];

// the sprites on the line being drawn, at most ten, in the order they win a pixel in
static struct { int16_t x; uint8_t row, tile, attributes; } on_line[10];
static int on_line_count, line_begun;

// the four shades as the proof tools see the emulator show them, lightest first, 15 bits with red lowest
static const uint16_t SHADES[4] = { 0x7FFF, 0x5294, 0x294A, 0x0000 };

int gb_lcd_on(void) { return lcdc >> 7; }
uint64_t gb_lcd_vblank(void) { return origin + 144 * GB_LINE; }

// the sprites that cover `line`, the first ten in the list's order. A Game Boy draws the one furthest left on top, and
// a Game Boy Color the first in the list.
static void find_sprites(int line) {
  int height = (lcdc & 4) ? 16 : 8;
  on_line_count = 0;
  for (int i = 0; i < 40 && on_line_count < 10; i++) {
    int top = gb_oam[i * 4] - 16;
    if (line < top || line >= top + height) continue;
    uint8_t attributes = gb_oam[i * 4 + 3];
    int row = line - top;
    if (attributes & 0x40) row = height - 1 - row;
    uint8_t tile = gb_oam[i * 4 + 2];
    if (height == 16) tile = (uint8_t)((tile & 0xFE) | (row >> 3));
    int at = on_line_count++;
    int16_t x = (int16_t)(gb_oam[i * 4 + 1] - 8);
    if (!colour) for (; at > 0 && on_line[at - 1].x > x; at--) on_line[at] = on_line[at - 1];
    on_line[at].x = x;
    on_line[at].row = (uint8_t)(row & 7);
    on_line[at].tile = tile;
    on_line[at].attributes = attributes;
  }
}

static void begin_line(int line) {
  if (line == 0) {
    window_line = 0;
    window_reached = 0;
  }
  if ((lcdc & 0x20) && wy == line) window_reached = 1;
  find_sprites(line);
  line_begun = 1;
}

// a tile's pixel: its two bits from the row's two bytes
static int tile_pixel(int bank, int tile, int row, int column, int flipped) {
  const uint8_t *bytes = gb_vram + bank * 0x2000 + tile * 16 + row * 2;
  int bit = flipped ? column : 7 - column;
  return ((bytes[0] >> bit) & 1) | (((bytes[1] >> bit) & 1) << 1);
}

static void draw(int line, int from, int to) {
  int windowed = (lcdc & 0x20) && window_reached && wx <= 166;
  for (int x = from; x < to; x++) {
    int number = 0, attributes = 0, shows = colour || (lcdc & 1);
    if (shows) {
      int px, py, map;
      if (windowed && x + 7 >= wx) {
        px = x + 7 - wx;
        py = window_line;
        map = (lcdc & 0x40) ? 0x1C00 : 0x1800;
      } else {
        px = (x + scx) & 255;
        py = (line + scy) & 255;
        map = (lcdc & 0x08) ? 0x1C00 : 0x1800;
      }
      int at = map + (py >> 3) * 32 + (px >> 3), tile = gb_vram[at];
      if (colour) attributes = gb_vram[0x2000 + at];
      if (!(lcdc & 0x10)) tile = 256 + (int8_t)tile;
      number = tile_pixel((attributes >> 3) & 1, tile, (attributes & 0x40) ? 7 - (py & 7) : py & 7, px & 7, attributes & 0x20);
    }
    uint16_t pixel = colour ? (uint16_t)(bg_colours[(attributes & 7) * 8 + number * 2] | bg_colours[(attributes & 7) * 8 + number * 2 + 1] << 8) & 0x7FFF
      : SHADES[shows ? (bgp >> (number * 2)) & 3 : 0];
    if (lcdc & 2) {
      for (int i = 0; i < on_line_count; i++) {
        int column = x - on_line[i].x;
        if (column < 0 || column > 7) continue;
        uint8_t a = on_line[i].attributes;
        int dot = tile_pixel(colour ? (a >> 3) & 1 : 0, on_line[i].tile, on_line[i].row, column, a & 0x20);
        if (!dot) continue;
        // behind the background's three colours when the sprite says so, or on a Game Boy Color when the tile does,
        // unless LCDC's lowest bit takes the background's say away
        int behind = colour ? (lcdc & 1) && ((a | attributes) & 0x80) : a & 0x80;
        if (!(behind && number)) {
          pixel = colour ? (uint16_t)(sprite_colours[(a & 7) * 8 + dot * 2] | sprite_colours[(a & 7) * 8 + dot * 2 + 1] << 8) & 0x7FFF
            : SHADES[(((a & 0x10) ? obp1 : obp0) >> (dot * 2)) & 3];
        }
        break;
      }
    }
    drawn[line * SCREEN_W + x] = pixel;
  }
}

// how long a line's drawing lasts beyond the least: the scroll's odd pixels, and each sprite and the window's start
static int slowed_by(int line) {
  int extra = scx & 7;
  if (lcdc & 2) {
    int height = (lcdc & 4) ? 16 : 8, count = 0;
    for (int i = 0; i < 40 && count < 10; i++) {
      int top = gb_oam[i * 4] - 16;
      if (line < top || line >= top + height) continue;
      count++;
      int over = (gb_oam[i * 4 + 1] + scx) & 7;
      extra += 6 + (over < 5 ? 5 - over : 0);
    }
  }
  if ((lcdc & 0x20) && window_reached && wx <= 166) extra += 6;
  return extra;
}

static void finish_line(void) {
  if ((lcdc & 0x20) && window_reached && wx <= 166) window_line++;
  line_at++;
  pixel_at = 0;
  line_begun = 0;
}

void gb_lcd_run_to(uint64_t cycle) {
  if (!(lcdc & 0x80) || cycle < origin) return;
  for (;;) {
    uint64_t into = cycle - origin;
    int line = (int)(into / GB_LINE), at = (int)(into % GB_LINE);
    if (line >= 154) {
      // the rest of this picture, and on to the next
      while (line_at < 144) {
        if (!line_begun) begin_line(line_at);
        draw(line_at, pixel_at, SCREEN_W);
        finish_line();
      }
      origin += GB_FRAME;
      line_at = pixel_at = 0;
      continue;
    }
    while (line_at < 144 && line_at < line) {
      if (!line_begun) begin_line(line_at);
      draw(line_at, pixel_at, SCREEN_W);
      finish_line();
    }
    if (line_at == line && line < 144 && at >= MODE3_STARTS) {
      if (!line_begun) begin_line(line);
      int reached = at - FIRST_PIXEL - (scx & 7);
      if (reached > SCREEN_W) reached = SCREEN_W;
      if (reached > pixel_at) {
        draw(line, pixel_at, reached);
        pixel_at = reached;
      }
    }
    return;
  }
}

void gb_lcd_present(int blank) {
  uint16_t empty = colour ? 0x7FFF : SHADES[0];
  for (int i = 0; i < SCREEN_W * SCREEN_H; i++) shown[i] = blank ? empty : drawn[i];
  if (blank) for (int i = 0; i < SCREEN_W * SCREEN_H; i++) drawn[i] = empty;
}

void gb_lcd_draw(uint32_t *out) {
  for (int i = 0; i < SCREEN_W * SCREEN_H; i++) {
    uint32_t c = shown[i], r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    out[i] = 0xFF000000u | (b << 3 | b >> 2) << 16 | (g << 3 | g >> 2) << 8 | (r << 3 | r >> 2);
  }
}

// where the screen is at `cycle`: the line, 0 to 153, and the cycle in it
static void place(uint64_t cycle, int *line, int *at) {
  uint64_t into = (cycle - origin) % GB_FRAME;
  *line = (int)(into / GB_LINE);
  *at = (int)(into % GB_LINE);
}

// the line LYC is compared with: line 153 turns into line 0 eight cycles in
static int compared_line(int line, int at) { return line == 153 && at >= 8 ? 0 : line; }

static int mode0_starts(int line) { return MODE0_STARTS + colour + slowed_by(line); }

// The times in a picture the screen may ask for an interrupt at, counted from its line 0: V-blank's start, the line
// LYC names, each line's mode 2, four cycles before the line but for the first, and each line's mode 0.
static uint64_t next_in_picture(uint64_t into) {
  uint64_t soon = NEVER;
#define SOON(time) do { uint64_t t = (time); if (t > into && t < soon) soon = t; } while (0)
  SOON(144 * GB_LINE);
  SOON(GB_FRAME + 144 * GB_LINE);
  if ((stat & 0x40) && lyc < 154) {
    uint64_t at = lyc ? (uint64_t)lyc * GB_LINE : 153 * GB_LINE + 8;
    SOON(at);
    SOON(at + GB_FRAME);
  }
  if (stat & 0x20) {
    uint64_t line = (into + 4) / GB_LINE + 1;
    SOON(line <= 143 ? line * GB_LINE - 4 : GB_FRAME);
  }
  if (stat & 0x08) {
    int line = (int)(into / GB_LINE);
    for (int l = line; l <= line + 1; l++) {
      if (l < 144) SOON((uint64_t)l * GB_LINE + (uint64_t)mode0_starts(l));
      else SOON(GB_FRAME + (uint64_t)mode0_starts(0));
    }
  }
#undef SOON
  return soon;
}

uint64_t gb_lcd_next_request(uint64_t cycle) {
  if (!(lcdc & 0x80)) return NEVER;
  if (cycle < origin) return origin;
  uint64_t picture = (cycle - origin) / GB_FRAME, soon = next_in_picture((cycle - origin) % GB_FRAME);
  return soon == NEVER ? NEVER : origin + picture * GB_FRAME + soon;
}

// what the screen asks for at one of those times. A source the STAT register has on asks only when no other that is
// on holds the request already, as the console has one line for them all.
static void request_at(uint64_t into) {
  int line = (int)(into / GB_LINE), at = (int)(into % GB_LINE);
  if (line == 144 && at == 0) {
    gb_requested |= 1;
    if ((stat & 0x18) == 0x10) gb_requested |= 2;
  }
  if ((stat & 0x40) && lyc < 154 && into == (lyc ? (uint64_t)lyc * GB_LINE : 153 * GB_LINE + 8)) {
    int held = lyc >= 1 && lyc <= 143 ? stat & 0x20 : stat & 0x10;
    if (!held) gb_requested |= 2;
  }
  if (stat & 0x20) {
    int coming = at == GB_LINE - 4 ? line + 1 : at == 0 && line == 0 ? 0 : -1;
    if (coming == 154) coming = -1;
    if (coming >= 0 && coming <= 143 && (coming != 0 || !(stat & 0x10)) && (!(stat & 0x40) || (lyc ? coming != lyc + 1 : coming > 1))) {
      // with mode 0's on as well, the line is still held from the line before, but for the picture's first
      if (!(stat & 0x08) || coming == 0) gb_requested |= 2;
    }
  }
  if ((stat & 0x08) && line < 144 && at == mode0_starts(line)) {
    if (!((stat & 0x40) && lyc == line)) gb_requested |= 2;
  }
}

void gb_lcd_request_to(uint64_t cycle) {
  if (!(lcdc & 0x80)) {
    requested_to = cycle;
    return;
  }
  if (requested_to < origin) requested_to = origin;
  while (requested_to < cycle) {
    uint64_t next = gb_lcd_next_request(requested_to);
    if (next > cycle) break;
    // mode 0's time is this line's as it's drawn, so the picture is drawn up to there first
    gb_lcd_run_to(next);
    request_at((next - origin) % GB_FRAME);
    requested_to = next;
  }
  if (requested_to < cycle) requested_to = cycle;
}

static int mode_at(uint64_t cycle) {
  if (!(lcdc & 0x80)) return 0;
  int line, at;
  place(cycle, &line, &at);
  if (line >= 144) return line == 153 && at >= GB_LINE - 4 ? 0 : 1;
  if (at < 80) return 2;
  return at + 2 - colour < mode0_starts(line) ? 3 : 0;
}

int gb_lcd_vram_open(uint64_t cycle) { return mode_at(cycle) != 3; }
int gb_lcd_oam_open(uint64_t cycle) { return mode_at(cycle) < 2; }

uint8_t gb_lcd_read(uint8_t reg, uint64_t cycle) {
  switch (reg) {
    case 0x40: return lcdc;
    case 0x41: {
      uint8_t value = (uint8_t)(0x80 | stat);
      if (lcdc & 0x80) {
        int line, at;
        place(cycle, &line, &at);
        value |= (uint8_t)mode_at(cycle);
        if (compared_line(line, at) == lyc && at < GB_LINE - 4) value |= 4;
      }
      return value;
    }
    case 0x42: return scy;
    case 0x43: return scx;
    case 0x44: {
      if (!(lcdc & 0x80)) return 0;
      int line, at;
      place(cycle, &line, &at);
      // the count moves on four cycles before the line does, and reads 0 all through the last line
      if (line == 153) return 0;
      return (uint8_t)(at >= GB_LINE - 4 ? line + 1 : line);
    }
    case 0x45: return lyc;
    case 0x47: return bgp;
    case 0x48: return obp0;
    case 0x49: return obp1;
    case 0x4A: return wy;
    case 0x4B: return wx;
    case 0x68: return colour ? bcps | 0x40 : 0xFF;
    case 0x69: return colour && gb_lcd_vram_open(cycle) ? bg_colours[bcps & 0x3F] : 0xFF;
    case 0x6A: return colour ? ocps | 0x40 : 0xFF;
    case 0x6B: return colour && gb_lcd_vram_open(cycle) ? sprite_colours[ocps & 0x3F] : 0xFF;
  }
  return 0xFF;
}

void gb_lcd_write(uint8_t reg, uint8_t value, uint64_t cycle) {
  gb_lcd_request_to(cycle);
  gb_lcd_run_to(cycle);
  switch (reg) {
    case 0x40:
      if ((lcdc ^ value) & 0x80) {
        if (value & 0x80) {
          // the screen comes on at the top of a picture
          origin = cycle;
          requested_to = cycle;
          line_at = pixel_at = 0;
          line_begun = 0;
          window_line = 0;
          window_reached = 0;
          lcdc = value;
          if (lyc == 0 && (stat & 0x40)) gb_requested |= 2;
          return;
        }
      }
      lcdc = value;
      break;
    case 0x41: {
      uint8_t before = stat;
      stat = value & 0x78;
      if (!(lcdc & 0x80)) break;
      int line, at, mode = mode_at(cycle);
      place(cycle, &line, &at);
      int same = compared_line(line, at) == lyc;
      if (!colour) {
        // a Game Boy's own fault: any write asks, when what the screen is doing would with every source on
        if (mode >= 2) {
          if (same && !(before & 0x40)) gb_requested |= 2;
        } else if (mode == 0) {
          if (!(before & 0x08) && !(same && (before & 0x40))) gb_requested |= 2;
        } else if (!(before & 0x10) && !(same && (before & 0x40))) gb_requested |= 2;
      } else if (stat & ~before & 0x78) {
        // a source switched on asks at once when it's already true and none held the line
        if (!(same && (before & 0x40))) {
          if (mode >= 2) {
            if (same && (stat & 0x40)) gb_requested |= 2;
          } else if (mode == 0) {
            if (!(before & 0x08) && ((stat & 0x08) || (same && (stat & 0x40)))) gb_requested |= 2;
          } else if (!(before & 0x10) && ((stat & 0x10) || (same && (stat & 0x40)))) gb_requested |= 2;
        }
      }
      break;
    }
    case 0x42: scy = value; break;
    case 0x43: scx = value; break;
    case 0x45:
      if (value == lyc) break;
      lyc = value;
      if ((lcdc & 0x80) && (stat & 0x40)) {
        int line, at, mode = mode_at(cycle);
        place(cycle, &line, &at);
        int held = mode == 0 ? stat & 0x08 : mode == 1 ? stat & 0x10 : 0;
        if (compared_line(line, at) == value && !held) gb_requested |= 2;
      }
      break;
    case 0x47: bgp = value; break;
    case 0x48: obp0 = value; break;
    case 0x49: obp1 = value; break;
    case 0x4A: wy = value; break;
    case 0x4B: wx = value; break;
    case 0x68: if (colour) bcps = value & 0xBF; break;
    case 0x69:
      if (!colour) break;
      if (gb_lcd_vram_open(cycle)) bg_colours[bcps & 0x3F] = value;
      if (bcps & 0x80) bcps = (uint8_t)(0x80 | ((bcps + 1) & 0x3F));
      break;
    case 0x6A: if (colour) ocps = value & 0xBF; break;
    case 0x6B:
      if (!colour) break;
      if (gb_lcd_vram_open(cycle)) sprite_colours[ocps & 0x3F] = value;
      if (ocps & 0x80) ocps = (uint8_t)(0x80 | ((ocps + 1) & 0x3F));
      break;
  }
}

void gb_lcd_power(int is_colour, uint64_t cycle, const uint8_t *io) {
  colour = is_colour;
  lcdc = io[0x40];
  stat = io[0x41] & 0x78;
  scy = io[0x42];
  scx = io[0x43];
  lyc = io[0x45];
  bgp = io[0x47];
  obp0 = io[0x48];
  obp1 = io[0x49];
  wy = io[0x4A];
  wx = io[0x4B];
  bcps = ocps = 0;
  // every background colour white, as the console's start-up leaves them
  for (int i = 0; i < 64; i += 2) {
    bg_colours[i] = 0xFF;
    bg_colours[i + 1] = 0x7F;
    sprite_colours[i] = sprite_colours[i + 1] = 0;
  }
  // the console starts a game in V-blank: a Game Boy near the end of its last line, a Game Boy Color 164 cycles into
  // its first
  uint64_t into = colour ? 144 * GB_LINE + 164 : 153 * GB_LINE + 396;
  origin = cycle - into;
  requested_to = cycle;
  line_at = 144;
  pixel_at = 0;
  line_begun = 0;
  window_line = 0;
  window_reached = 0;
  uint16_t empty = colour ? 0x7FFF : SHADES[0];
  for (int i = 0; i < SCREEN_W * SCREEN_H; i++) drawn[i] = shown[i] = empty;
}
