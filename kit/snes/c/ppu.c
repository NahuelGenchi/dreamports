// The Super Nintendo's picture unit, as kit/snes/c/snes.h says: its registers, its memories, and a frame drawn from
// them, a line at a time, as the console draws it. So far: the screen on and off and its brightness ($2100), the
// sprites, with their table through its port ($2101 to $2104), the backgrounds of modes 0 to 4, of 8 or 16 pixels a
// tile and 2, 4 or 8 bits, with their maps, tiles, scrolling, mosaic, offsets for each column and direct colours
// ($2105 to $2114), mode 7 with its matrix, flips, ways outside its field and second background ($211A to $2120,
// $2133) and its product read back ($2134 to $2136), video memory through its port ($2115 to $2119), the
// colours through theirs ($2121, $2122), a frame drawn a line at a time with HDMA between them (dma.c), the two windows ($2123 to $212B), which layers the main and sub screens show
// and hide in their windows ($212C to $212F), and colour maths with the sub screen or the fixed colour ($2130 to
// $2132). The brightness is each colour's 5 bits times the brightness over 15, rounded, as Snes9x, the reference the
// proof tools run the original on, has it, its maths is Snes9x's on its 16-bit pixels, and a line's sprites are its
// first 32 and, of their tiles, the last 34, as Snes9x has them too.

#include "snes-kit.h"

uint8_t snes_vram[0x10000];
uint16_t snes_cgram[256];
uint8_t snes_oam[544];

struct ppu_state {
  uint8_t screen;                     // $2100: the screen off in bit 7, its brightness below
  uint8_t mode;                       // $2105: the mode, BG3's priority in mode 1, and each background's tile size
  uint8_t mosaic;                     // $2106: the mosaic's size less one in the top four bits, the backgrounds it's on
  uint16_t map[4], tiles[4];          // where each background's map and tiles are, in words of video memory
  uint8_t map_size[4];                // 32 or 64 tiles across and down: bit 0 across, bit 1 down
  uint16_t hofs[4], vofs[4];          // each background's scroll
  uint8_t scroll_latch;               // the byte the scroll registers share, the last written
  uint8_t m7_latch;                   // the byte mode 7's registers share, the last written to one of them or to BG1's scroll
  int16_t m7_hofs, m7_vofs;           // mode 7's scroll, $210D and $210E with mode 7's latch
  int16_t m7[4], m7_x, m7_y;          // $211B to $2120: the matrix A, B, C and D, and the centre
  uint8_t m7_repeat, m7_hflip, m7_vflip; // $211A: outside the 1024 by 1024 field, wrapped (0), nothing (2) or tile 0 (3)
  uint8_t setini;                     // $2133: mode 7's second background in bit 6
  uint8_t vmain;                      // $2115: how the video memory's address moves on, and after which byte
  uint16_t vaddr;                     // the video memory's address, in words
  uint8_t cgaddr, cg_low;             // the colours' address, and the first byte of a colour written
  int cg_second;                      // whether the next byte written to $2122 is a colour's second
  uint8_t main, sub;                  // $212C, $212D: the layers the main screen and the sub screen show
  uint8_t main_masked, sub_masked;    // $212E, $212F: the layers each screen hides where their windows say
  uint8_t window_select[6];           // $2123 to $2125: for BG1 to BG4, the sprites and the colours, each window on (bits
                                      // 1 and 3) and turned inside out (bits 0 and 2)
  uint8_t window_logic[6];            // $212A, $212B: how each one's two windows combine: or, and, xor or xnor
  uint8_t window[4];                  // $2126 to $2129: window 1's left and right, then window 2's
  uint8_t colour_select, colour_maths; // $2130 and $2131: where colours are black and maths is off, and what maths
  uint8_t fixed[3];                   // $2132: the fixed colour, red, green and blue
  uint32_t obj_base, obj_gap;         // $2101: where the sprites' tiles are, and their second table's distance, in bytes
  uint8_t obj_sizes;                  // which two sizes the sprites are
  uint16_t oam_addr, oam_saved;       // the sprites' table's address, in words, and as last written, which V-blank goes back to
  uint8_t oam_second, oam_low;        // whether the next byte written is a word's second, and its first
  uint8_t rotation, first_sprite;     // $2103's top bit, and the sprite that comes first
};
static struct ppu_state ppu;
// the fixed colour at the screen's brightness, as Snes9x last made it
static uint16_t fixed_pixel;
// whether the sprites or the windows have changed since a line was last drawn; where mosaic's blocks start down the
// screen, the line it was last written on, as Snes9x has it; and how many of the frame's rows are drawn, and whether
// the frame's rows are being drawn, from line 1 to V-blank
static int sprites_changed, windows_changed, mosaic_start, rows_drawn, drawing;
// Snes9x draws a frame's lines in stretches, each up to a write that changes how they're drawn, and mosaic depends on
// where the stretch began: the line it starts at, and the registers as last written, $2100 to $2133, to know which
// writes change something. Each line's scrolls and mode 7's values, as Snes9x keeps them for each line it draws.
static int stretch_start;
static uint8_t written[0x34];
static struct line_state {
  uint16_t hofs[4], vofs[4];
  int16_t m7[4], m7_x, m7_y, m7_hofs, m7_vofs;
} lines[SNES_HEIGHT];
// a write that ends Snes9x's stretch of lines before it, during the frame's lines
static void ends_stretch(void) {
  if (drawing) stretch_start = rows_drawn;
}

void ppu_power(void) {
  ppu = (struct ppu_state){ 0 };
  fixed_pixel = 0;
  mosaic_start = stretch_start = rows_drawn = drawing = 0;
  for (int i = 0; i < 0x34; i++) written[i] = 0;
  ppu.screen = 0x80;
  for (int i = 0; i < 0x10000; i++) snes_vram[i] = 0;
  for (int i = 0; i < 544; i++) snes_oam[i] = 0;
}

// the video memory's address as its port reaches it, with $2115's bits 2 and 3 turning it round, in words
static uint16_t vram_address(void) {
  uint16_t a = ppu.vaddr;
  switch (ppu.vmain >> 2 & 3) {
  case 1: a = (uint16_t)((a & 0xFF00) | (a & 0x00E0) >> 5 | (a & 0x001F) << 3); break;
  case 2: a = (uint16_t)((a & 0xFE00) | (a & 0x01C0) >> 6 | (a & 0x003F) << 3); break;
  case 3: a = (uint16_t)((a & 0xFC00) | (a & 0x0380) >> 7 | (a & 0x007F) << 3); break;
  }
  return a & 0x7FFF;
}

static void vram_next(void) {
  static const uint16_t steps[4] = { 1, 32, 128, 128 };
  ppu.vaddr = (uint16_t)(ppu.vaddr + steps[ppu.vmain & 3]);
}

void ppu_write(uint16_t address, uint8_t value) {
  if (address >= 0x2101 && address <= 0x2104) sprites_changed = 1;
  if (address >= 0x2123 && address <= 0x2130) windows_changed = 1;
  // the writes after which Snes9x draws the lines so far before it goes on: a new value in most of the registers that
  // aren't scrolls, mode 7's matrix or ports, and in $2133 its hi-res and interlace bits
  uint8_t before = written[address - 0x2100];
  written[address - 0x2100] = value;
  if (value != before && (address <= 0x2101 || (address >= 0x2105 && address <= 0x210C) || address == 0x211A || (address >= 0x2123 && address <= 0x2132))) ends_stretch();
  if (address == 0x2133 && ((before ^ value) & 0x0B)) ends_stretch();
  switch (address) {
  case 0x2100: ppu.screen = value; break;
  case 0x2101:
    ppu.obj_base = (uint32_t)(value & 3) << 14;
    ppu.obj_gap = (uint32_t)(value >> 3 & 3) << 13;
    ppu.obj_sizes = value >> 5 & 7;
    break;
  case 0x2102: case 0x2103: {
    if (address == 0x2103) ppu.rotation = value >> 7;
    ppu.oam_addr = (uint16_t)((SNES_B_REGISTERS[0x03] & 1) << 8 | SNES_B_REGISTERS[0x02]);
    ppu.oam_second = 0;
    ppu.oam_saved = ppu.oam_addr;
    if (ppu.rotation) ppu.first_sprite = (uint8_t)((ppu.oam_addr & 0xFE) >> 1);
    else if (address == 0x2103) ppu.first_sprite = 0;
    break;
  }
  case 0x2104:
    // the low table is written a word at a time, its first byte held until the second comes; the high table a byte
    if (!ppu.oam_second) ppu.oam_low = value;
    if (ppu.oam_addr & 0x100) {
      uint8_t *at = &snes_oam[0x200 + ((ppu.oam_addr & 0x0F) << 1) + ppu.oam_second];
      if (*at != value) ends_stretch();
      *at = value;
    } else if (ppu.oam_second) {
      uint8_t *at = &snes_oam[ppu.oam_addr << 1];
      if (at[0] != ppu.oam_low || at[1] != value) ends_stretch();
      at[0] = ppu.oam_low;
      at[1] = value;
    }
    ppu.oam_second ^= 1;
    if (!ppu.oam_second) {
      ppu.oam_addr = (ppu.oam_addr + 1) & 0x1FF;
      if (ppu.rotation) ppu.first_sprite = (uint8_t)((ppu.oam_addr & 0xFE) >> 1);
    }
    break;
  case 0x2105: ppu.mode = value; break;
  case 0x2106:
    ppu.mosaic = value;
    // a new mosaic's blocks start down from the line it's written on, as Snes9x has it
    if (value != before) mosaic_start = timing_line() <= SNES_HEIGHT ? timing_line() : 0;
    break;
  case 0x2107: case 0x2108: case 0x2109: case 0x210A:
    ppu.map[address - 0x2107] = (uint16_t)((value & 0xFC) << 8);
    ppu.map_size[address - 0x2107] = value & 3;
    break;
  case 0x210B:
    ppu.tiles[0] = (uint16_t)((value & 0x0F) << 12);
    ppu.tiles[1] = (uint16_t)((value & 0xF0) << 8);
    break;
  case 0x210C:
    ppu.tiles[2] = (uint16_t)((value & 0x0F) << 12);
    ppu.tiles[3] = (uint16_t)((value & 0xF0) << 8);
    break;
  case 0x211A:
    // a repeat of 1 wraps, as 0 does, as Snes9x has it
    ppu.m7_repeat = value >> 6 == 1 ? 0 : value >> 6;
    ppu.m7_vflip = value >> 1 & 1;
    ppu.m7_hflip = value & 1;
    break;
  case 0x211B: case 0x211C: case 0x211D: case 0x211E:
    ppu.m7[address - 0x211B] = (int16_t)(ppu.m7_latch | value << 8);
    ppu.m7_latch = value;
    break;
  case 0x211F: case 0x2120: {
    int16_t centre = (int16_t)(ppu.m7_latch | value << 8);
    if (address == 0x211F) ppu.m7_x = centre;
    else ppu.m7_y = centre;
    ppu.m7_latch = value;
    break;
  }
  case 0x2133: ppu.setini = value; break;
  case 0x210D: case 0x210F: case 0x2111: case 0x2113: {
    // across: the byte, the shared one's top five bits and the low three of this one's high byte, as the console has it
    int n = (address - 0x210D) >> 1;
    ppu.hofs[n] = (uint16_t)(value << 8 | (ppu.scroll_latch & ~7) | (ppu.hofs[n] >> 8 & 7));
    ppu.scroll_latch = value;
    if (!n) {
      ppu.m7_hofs = (int16_t)(value << 8 | ppu.m7_latch);
      ppu.m7_latch = value;
    }
    break;
  }
  case 0x210E: case 0x2110: case 0x2112: case 0x2114: {
    int n = (address - 0x210E) >> 1;
    ppu.vofs[n] = (uint16_t)(value << 8 | ppu.scroll_latch);
    ppu.scroll_latch = value;
    if (!n) {
      ppu.m7_vofs = (int16_t)(value << 8 | ppu.m7_latch);
      ppu.m7_latch = value;
    }
    break;
  }
  case 0x2115: ppu.vmain = value; break;
  case 0x2116: ppu.vaddr = (uint16_t)((ppu.vaddr & 0xFF00) | value); break;
  case 0x2117: ppu.vaddr = (uint16_t)((ppu.vaddr & 0x00FF) | value << 8); break;
  case 0x2118:
    snes_vram[vram_address() * 2] = value;
    if (!(ppu.vmain & 0x80)) vram_next();
    break;
  case 0x2119:
    snes_vram[vram_address() * 2 + 1] = value;
    if (ppu.vmain & 0x80) vram_next();
    break;
  case 0x2121:
    ppu.cgaddr = value;
    ppu.cg_second = 0;
    break;
  case 0x2122:
    if (!ppu.cg_second) ppu.cg_low = value;
    else {
      uint16_t colour = (uint16_t)((value & 0x7F) << 8 | ppu.cg_low);
      if (snes_cgram[ppu.cgaddr] != colour) ends_stretch();
      snes_cgram[ppu.cgaddr++] = colour;
    }
    ppu.cg_second = !ppu.cg_second;
    break;
  case 0x2123: case 0x2124: case 0x2125: {
    int n = (address - 0x2123) * 2;
    ppu.window_select[n] = value & 15;
    ppu.window_select[n + 1] = value >> 4;
    break;
  }
  case 0x2126: case 0x2127: case 0x2128: case 0x2129: ppu.window[address - 0x2126] = value; break;
  case 0x212A:
    for (int n = 0; n < 4; n++) ppu.window_logic[n] = value >> (n * 2) & 3;
    break;
  case 0x212B:
    ppu.window_logic[4] = value & 3;
    ppu.window_logic[5] = value >> 2 & 3;
    break;
  case 0x212C: ppu.main = value; break;
  case 0x212D: ppu.sub = value; break;
  case 0x212E: ppu.main_masked = value; break;
  case 0x212F: ppu.sub_masked = value; break;
  case 0x2130: ppu.colour_select = value; break;
  case 0x2131: ppu.colour_maths = value; break;
  case 0x2132:
    if (value & 0x20) ppu.fixed[0] = value & 31;
    if (value & 0x40) ppu.fixed[1] = value & 31;
    if (value & 0x80) ppu.fixed[2] = value & 31;
    break;
  }
}

// a word of video memory, at a word's address
static uint16_t vram_word(uint32_t at) {
  at = (at & 0x7FFF) * 2;
  return (uint16_t)(snes_vram[at] | snes_vram[at + 1] << 8);
}

/** A background's tile's colour at (hpos, row) of its map, as tiles of `bpp` bits: its number in the tile, 0 where it
 *  shows nothing, with the map's entry for the tile in `entry`. Its tiles are 16 pixels a side where $2105 says. */
static int bg_colour(int n, int bpp, uint32_t hpos, uint32_t row, uint16_t *entry) {
  int big = ppu.mode >> (4 + n) & 1, size = big ? 16 : 8;
  int sx = (int)(hpos & 0x3FF), sy = (int)(row & 0x3FF);
  int tx = sx / size, ty = sy / size;
  uint32_t at = ppu.map[n] + ((ty & 31) << 5) + (tx & 31);
  if ((tx & 32) && (ppu.map_size[n] & 1)) at += 0x400;
  if ((ty & 32) && (ppu.map_size[n] & 2)) at += ppu.map_size[n] == 3 ? 0x800 : 0x400;
  *entry = vram_word(at);
  int px = sx % size, py = sy % size;
  if (*entry & 0x4000) px = size - 1 - px;
  if (*entry & 0x8000) py = size - 1 - py;
  int tile = *entry & 0x3FF;
  if (big) tile += (px >> 3) + ((py >> 3) << 4);
  px &= 7;
  py &= 7;
  uint32_t line = ppu.tiles[n] + (uint32_t)(tile & 0x3FF) * (uint32_t)(bpp * 4) + (uint32_t)py;
  int colour = 0;
  for (int plane = 0; plane < bpp; plane += 2) {
    uint16_t bits = vram_word(line + (uint32_t)(plane * 4));
    colour |= (bits >> (7 - px) & 1) << plane | (bits >> (15 - px) & 1) << (plane + 1);
  }
  return colour;
}

// The sprites' sizes, small and large, for each of $2101's eight choices: width and height
static const uint8_t OBJ_SIZES[8][4] = {
  { 8, 8, 16, 16 }, { 8, 8, 32, 32 }, { 8, 8, 64, 64 }, { 16, 16, 32, 32 },
  { 16, 16, 64, 64 }, { 32, 32, 64, 64 }, { 16, 32, 32, 64 }, { 16, 32, 32, 32 },
};
enum { OBJ_LINES = 239, OBJ_RANGE = 32, OBJ_TILES = 34 };
// each line's sprites, in the order they're drawn: which, and its line within itself, and the tiles left over
static struct { uint8_t count; int16_t tiles; uint8_t sprite[OBJ_RANGE], line[OBJ_RANGE]; } obj_lines[OBJ_LINES];
static uint8_t obj_width[128], obj_visible[128];

static int obj_x(int s) {
  int x = snes_oam[s * 4] | (snes_oam[0x200 + (s >> 2)] >> ((s & 3) * 2) & 1) << 8;
  return x >= 256 ? x - 512 : x;
}
static int obj_large(int s) { return snes_oam[0x200 + (s >> 2)] >> ((s & 3) * 2 + 1) & 1; }

// The sprites each line has, as the console finds them before the frame: from the first sprite on, the first 32 on
// a line; and how many of their 8-pixel tiles across the screen are left over the 34 a line draws. With $2103's top
// bit and the table's address odd, the first sprite moves on by one for each line, as the console has it.
static void obj_setup(void) {
  const uint8_t *size = OBJ_SIZES[ppu.obj_sizes];
  int per_line = ppu.rotation && (ppu.oam_second & ppu.oam_addr & 1);
  static uint8_t on_line[OBJ_LINES][128];
  for (int y = 0; y < OBJ_LINES; y++) {
    obj_lines[y].count = 0;
    obj_lines[y].tiles = OBJ_TILES;
    if (per_line) for (int s = 0; s < 128; s++) on_line[y][s] = 0;
  }
  for (int n = 0; n < 128; n++) {
    int s = per_line ? n : (ppu.first_sprite + n) & 0x7F;
    int large = obj_large(s), width = size[large * 2], height = size[large * 2 + 1];
    obj_width[s] = (uint8_t)width;
    int x = obj_x(s);
    if (x == -256) x = per_line ? 256 : 0;
    if (!(x > -width && x <= 256)) continue;
    if (x < 0) obj_visible[s] = (uint8_t)((width + x + 7) >> 3);
    else if (per_line ? x + width >= 257 : x + width > 255) obj_visible[s] = (uint8_t)(((per_line ? 257 : 256) - x + 7) >> 3);
    else obj_visible[s] = (uint8_t)(width >> 3);
    int vflip = snes_oam[s * 4 + 3] >> 7;
    uint8_t y = snes_oam[s * 4 + 1];
    for (int line = 0; line < height; line++, y++) {
      if (y >= OBJ_LINES) continue;
      int within = vflip ? line ^ (width - 1) : line;
      if (per_line) {
        on_line[y][s] = (uint8_t)(within | 0x80);
        continue;
      }
      if (obj_lines[y].count >= OBJ_RANGE) continue;
      obj_lines[y].tiles = (int16_t)(obj_lines[y].tiles - obj_visible[s]);
      obj_lines[y].sprite[obj_lines[y].count] = (uint8_t)s;
      obj_lines[y].line[obj_lines[y].count++] = (uint8_t)within;
    }
  }
  if (!per_line) return;
  for (int y = 0; y < OBJ_LINES; y++) {
    int first = (ppu.first_sprite + y) & 0x7F;
    for (int n = 0; n < 128; n++) {
      int s = (first + n) & 0x7F;
      if (!on_line[y][s]) continue;
      if (obj_lines[y].count >= OBJ_RANGE) break;
      obj_lines[y].tiles = (int16_t)(obj_lines[y].tiles - obj_visible[s]);
      obj_lines[y].sprite[obj_lines[y].count] = (uint8_t)s;
      obj_lines[y].line[obj_lines[y].count++] = (uint8_t)(on_line[y][s] & 0x7F);
    }
  }
}

// A line's sprites drawn into `colours` and `priorities`, 256 each: the first sprite in order with a pixel at a place
// has it, and its priority; 0 where none has. A sprite's tiles past those the line has room for aren't drawn, the
// first sprites' first.
static void obj_line(int y, uint8_t *colours, uint8_t *priorities) {
  for (int x = 0; x < SNES_WIDTH; x++) colours[x] = 0;
  if (y >= OBJ_LINES) return;
  int tiles = obj_lines[y].tiles;
  for (int i = 0; i < obj_lines[y].count; i++) {
    int s = obj_lines[y].sprite[i], within = obj_lines[y].line[i];
    tiles += obj_visible[s];
    if (tiles <= 0) continue;
    const uint8_t *e = snes_oam + s * 4;
    int name = e[2] | (e[3] & 1) << 8, palette = e[3] >> 1 & 7, priority = e[3] >> 4 & 3, hflip = e[3] >> 6 & 1;
    int row = (((within << 1) + (name & 0xF0)) & 0xF0) | (name & 0x100);
    int column = name & 0x0F, step = 1, width = obj_width[s];
    if (hflip) {
      column = (column + (width >> 3) - 1) & 0x0F;
      step = -1;
    }
    int start = obj_x(s);
    int x = start == -256 ? 256 : start;
    for (int t = tiles; x <= 256 && x < start + width; column = (column + step) & 0x0F, x += 8) {
      if (x < -7 || --t < 0 || x == 256) continue;
      int tile = row | column;
      uint32_t at = (ppu.obj_base + ((uint32_t)(tile & 0x1FF) << 5) + (tile & 0x100 ? ppu.obj_gap : 0) + (uint32_t)((within & 7) << 1)) & 0xFFFF;
      uint8_t p0 = snes_vram[at], p1 = snes_vram[(at + 1) & 0xFFFF], p2 = snes_vram[(at + 16) & 0xFFFF], p3 = snes_vram[(at + 17) & 0xFFFF];
      for (int px = 0; px < 8; px++) {
        int sx = x + px;
        if (sx < 0 || sx >= SNES_WIDTH || colours[sx]) continue;
        int bit = hflip ? px : 7 - px;
        int colour = (p0 >> bit & 1) | (p1 >> bit & 1) << 1 | (p2 >> bit & 1) << 2 | (p3 >> bit & 1) << 3;
        if (!colour) continue;
        colours[sx] = (uint8_t)(128 + palette * 16 + colour);
        priorities[sx] = (uint8_t)priority;
      }
    }
  }
}

//// Colours, as Snes9x makes them: each of the palette's 5-bit channels times the screen's brightness over 15, rounded,
//// in Snes9x's 16-bit pixel, red at bit 11, green at bit 6 with its top bit copied to bit 5, blue at bit 0. Its colour
//// maths works on those, and the proof tools keep each channel's 5 bits of the result, green's from bit 6, so the kit
//// does the same sums on the same pixels.

static uint8_t at_brightness(uint32_t channel, int brightness) { return (uint8_t)((channel * (uint32_t)brightness * 2 + 15) / 30); }
static uint16_t pixel_of(uint32_t r, uint32_t g, uint32_t b) { return (uint16_t)(r << 11 | g << 6 | (g & 0x10) << 1 | b); }
static uint16_t screen_colour(uint16_t colour, int brightness) {
  return pixel_of(at_brightness(colour & 31, brightness), at_brightness(colour >> 5 & 31, brightness), at_brightness(colour >> 10 & 31, brightness));
}
// a pixel as the page shows it
static uint32_t shown(uint16_t p) { return 0xFF000000u | (uint32_t)(p & 31) << 19 | (uint32_t)(p >> 6 & 31) << 11 | (uint32_t)(p >> 11) << 3; }

// adding two pixels, each channel kept to 31
static uint16_t colour_add(uint16_t a, uint16_t b) {
  uint32_t rb = (a & 0xF81Fu) + (b & 0xF81Fu), g = (a & 0x07C0u) + (b & 0x07C0u);
  uint16_t raw = (uint16_t)((rb & 0xF81F) | (g & 0x07C0) | (((g & 0x0800) | (rb & 0x10020)) >> 5) * 0x1F);
  return (uint16_t)(raw | (raw & 0x0400) >> 5);
}
// adding them with each channel kept to the brightest the screen's brightness gives, as Snes9x does below brightness 15
static uint16_t colour_add_capped(uint16_t a, uint16_t b, int brightness) {
  uint32_t most = at_brightness(31, brightness);
#define CAPPED(sum) ((sum) > most ? most : (sum))
  uint32_t r = CAPPED((uint32_t)(a >> 11 & 31) + (b >> 11 & 31)), g = CAPPED((uint32_t)(a >> 6 & 31) + (b >> 6 & 31)), bl = CAPPED((uint32_t)(a & 31) + (b & 31));
#undef CAPPED
  return (uint16_t)(r << 11 | g << 6 | (g & 0x10) << 1 | bl);
}
// half their sum
static uint16_t colour_add_half(uint16_t a, uint16_t b) { return (uint16_t)((((a & 0xF7DEu) + (b & 0xF7DEu)) >> 1) + (a & b & 0x0821u)); }
// the second taken from the first, each channel kept to 0
static uint16_t colour_sub(uint16_t a, uint16_t b) {
  int rb = (int)((a & 0xF81Fu) | 0x10020u) - (int)(b & 0xF81Fu), g = (int)((a & 0x07E0u) | 0x0800u) - (int)(b & 0x07E0u);
  int keep = (((g & 0x0800) | (rb & 0x10020)) >> 5) * 0x1F;
  uint16_t raw = (uint16_t)(((rb & 0xF81F) | (g & 0x07E0)) & keep);
  return (uint16_t)(raw | (raw & 0x0400) >> 5);
}
// half the difference, through Snes9x's table of it, which keeps a channel whose top bit is set and clears the rest
static uint16_t colour_sub_half(uint16_t a, uint16_t b) {
  uint32_t v = (((uint32_t)a | 0x10820u) - (b & 0xF7DEu)) >> 1;
  uint32_t r = v >> 11 & 31, g = v >> 5 & 63, bl = v & 31;
  r = r & 0x10 ? r & 0x0F : 0;
  g = g & 0x20 ? g & 0x1F : 0;
  bl = bl & 0x10 ? bl & 0x0F : 0;
  return (uint16_t)(r << 11 | g << 5 | bl);
}

// What $2131 and $2130 make of a pixel with maths on: add or take away, by half or not, the sub screen's pixel where it
// has one of its layers, `sub_layer`, or the fixed colour where it shows its backdrop; a pixel the colour window made
// black is never halved, as Snes9x has it. Below brightness 15 adding keeps to the brightest the screen shows, but not
// in the half sum with the fixed colour, as Snes9x's choice of its seven ways has it.
static uint16_t with_maths(uint16_t main, uint16_t sub, int sub_layer, int black, int brightness) {
  int subtract = ppu.colour_maths & 0x80, half = ppu.colour_maths & 0x40, with_sub = ppu.colour_select & 2;
  uint16_t other = sub_layer ? sub : fixed_pixel;
  if (subtract) {
    if (!half) return colour_sub(main, other);
    if (!with_sub) return black ? colour_sub(main, fixed_pixel) : colour_sub_half(main, fixed_pixel);
    return black ? colour_sub(main, other) : sub_layer ? colour_sub_half(main, sub) : colour_sub(main, fixed_pixel);
  }
  int capped = brightness != 15;
#define ADD(x, y) (capped ? colour_add_capped((x), (y), brightness) : colour_add((x), (y)))
  if (!half) return ADD(main, other);
  if (!with_sub) return black ? colour_add(main, fixed_pixel) : colour_add_half(main, fixed_pixel);
  return black ? ADD(main, other) : sub_layer ? colour_add_half(main, sub) : ADD(main, fixed_pixel);
#undef ADD
}

//// Windows: two spans of each line, from a left edge to a right one, which hide a layer on either screen, turn the
//// main screen black or keep maths off, each as its registers say. Snes9x cuts each line into at most five spans
//// where the windows' edges are, and draws each layer span by span, which a background with an offset for each tile
//// shows, as its offsets are read again at each span's start; so the kit cuts them the same way.

// each layer's spans on each screen, BG1 to BG4, the sprites and the backdrop: where it's drawn, and with what of the
// colour window, bit 0 its colours shown rather than black and bit 1 maths on
struct spans {
  int count;
  int16_t left[6], right[6];
  uint8_t mode[6];
};
static struct spans spans[2][6];
enum { MAIN, SUB };

// the spans each window takes in, as bits, by the spans its edges start and end at
static const uint8_t REGION_MAP[6][6] = {
  { 0, 0x01, 0x03, 0x07, 0x0F, 0x1F }, { 0, 0, 0x02, 0x06, 0x0E, 0x1E }, { 0, 0, 0, 0x04, 0x0C, 0x1C },
  { 0, 0, 0, 0, 0x08, 0x18 }, { 0, 0, 0, 0, 0, 0x10 }, { 0 },
};

// the spans the windows of `n`, BG1 to BG4, the sprites (4) or the colours (5), take in, of those each window does
static uint8_t window_mask(int n, uint8_t w1, uint8_t w2) {
  int select = ppu.window_select[n];
  if (select & 1) w1 = (uint8_t)~w1;
  if (select & 4) w2 = (uint8_t)~w2;
  if (!(select & 2)) return select & 8 ? w2 : 0;
  if (!(select & 8)) return w1;
  switch (ppu.window_logic[n]) {
  case 0: return w1 | w2;
  case 1: return w1 & w2;
  case 2: return w1 ^ w2;
  default: return (uint8_t)~(w1 ^ w2);
  }
}

// a layer's spans: those `mask` doesn't take in, with the colour window's modes, the sub screen's never black, and
// spans side by side with the same mode as one; a layer's span with nothing drawn left out, unless `all`
static void store_spans(uint8_t mask, struct spans *c, int regions, const int16_t *edges, const uint8_t *modes, int sub, int all) {
  int count = 0;
  for (int j = 0; j < regions; j++) {
    int mode = modes[j] | (sub ? 1 : 0);
    if (mask & (1 << j)) mode = 0;
    if (!all && !mode) continue;
    if (count > 0 && c->right[count - 1] == edges[j] && c->mode[count - 1] == mode) {
      c->right[count - 1] = edges[j + 1];
    } else {
      c->left[count] = edges[j];
      c->right[count] = edges[j + 1];
      c->mode[count] = (uint8_t)mode;
      count++;
    }
  }
  c->count = count;
}

static void compute_spans(void) {
  int16_t edges[6] = { 0, 256, 256, 256, 256, 256 };
  uint8_t modes[5] = { 0 };
  int regions = 1, i, j;
  int l1 = ppu.window[0], r1 = ppu.window[1], l2 = ppu.window[2], r2 = ppu.window[3];
  if (l1 <= r1) {
    if (l1 > 0) {
      edges[2] = 256;
      edges[1] = (int16_t)l1;
      regions = 2;
    }
    if (r1 < 255) {
      edges[regions + 1] = 256;
      edges[regions] = (int16_t)(r1 + 1);
      regions++;
    }
  }
  if (l2 <= r2) {
    for (i = 0; i <= regions; i++) {
      if (l2 == edges[i]) break;
      if (l2 < edges[i]) {
        for (j = regions; j >= i; j--) edges[j + 1] = edges[j];
        edges[i] = (int16_t)l2;
        regions++;
        break;
      }
    }
    for (; i <= regions; i++) {
      if (r2 + 1 == edges[i]) break;
      if (r2 + 1 < edges[i]) {
        for (j = regions; j >= i; j--) edges[j + 1] = edges[j];
        edges[i] = (int16_t)(r2 + 1);
        regions++;
        break;
      }
    }
  }
  uint8_t w1 = 0, w2 = 0;
  if (l1 <= r1) {
    for (i = 0; edges[i] != l1; i++) {}
    for (j = i; edges[j] != r1 + 1; j++) {}
    w1 = REGION_MAP[i][j];
  }
  if (l2 <= r2) {
    for (i = 0; edges[i] != l2; i++) {}
    for (j = i; edges[j] != r2 + 1; j++) {}
    w2 = REGION_MAP[i][j];
  }
  // $2130's choices for the colour window, never, outside it, inside it or always: where colours are black, and where
  // maths is off
  uint8_t colour = window_mask(5, w1, w2);
  static const int OUTSIDE = 1, INSIDE = 2, ALWAYS = 3;
  int black = ppu.colour_select >> 6, off = ppu.colour_select >> 4 & 3;
  uint8_t blacks = black == ALWAYS ? 0xFF : black == OUTSIDE ? (uint8_t)~colour : black == INSIDE ? colour : 0;
  uint8_t offs = off == ALWAYS ? 0xFF : off == OUTSIDE ? (uint8_t)~colour : off == INSIDE ? colour : 0;
  for (i = 0; i < regions; i++) {
    if (!(blacks & (1 << i))) modes[i] |= 1;
    if (!(offs & (1 << i))) modes[i] |= 2;
  }
  store_spans(0, &spans[MAIN][5], regions, edges, modes, 0, 1);
  store_spans(0, &spans[SUB][5], regions, edges, modes, 1, 1);
  for (j = 0; j < 5; j++) {
    uint8_t mask = window_mask(j, w1, w2);
    store_spans(ppu.main_masked >> j & 1 ? mask : 0, &spans[MAIN][j], regions, edges, modes, 0, 0);
    store_spans(ppu.sub_masked >> j & 1 ? mask : 0, &spans[SUB][j], regions, edges, modes, 1, 0);
  }
}

//// A line of the screen

// Each mode's backgrounds: how many bits their tiles have, and the depths of their two priorities, as Snes9x orders
// layers: a sprite at 4, 8, 12 or 16 by its priority, and a background at the depth of its priority; 0 where a mode
// has no such background.
static const uint8_t BPP[5][4] = { { 2, 2, 2, 2 }, { 4, 4, 2, 0 }, { 4, 4, 0, 0 }, { 8, 4, 0, 0 }, { 8, 2, 0, 0 } };
static const int8_t DEPTHS[5][4][2] = {
  { { 11, 15 }, { 10, 14 }, { 3, 7 }, { 2, 6 } },
  { { 11, 15 }, { 10, 14 }, { 3, 7 }, { 0, 0 } },
  { { 7, 15 }, { 3, 11 }, { 0, 0 }, { 0, 0 } },
  { { 7, 15 }, { 3, 11 }, { 0, 0 }, { 0, 0 } },
  { { 7, 15 }, { 3, 11 }, { 0, 0 }, { 0, 0 } },
};
enum { BACKDROP = 5 };

// a layer's pixels on a line of one screen: each as a 16-bit pixel at the screen's brightness, and its depth, 0 where
// the layer has none
struct layer {
  uint16_t pixel[SNES_WIDTH];
  uint8_t depth[SNES_WIDTH];
};

// a background's colour as a pixel: through the palette, or for a 256-colour background with $2130's bit 0, straight
// from the colour's number and the map's palette bits, as Snes9x's direct colours are
static uint16_t bg_pixel(int bpp, int palettes, uint16_t entry, int colour, int brightness) {
  if (bpp == 8 && (ppu.colour_select & 1)) {
    int p = entry >> 10 & 7;
    return pixel_of(at_brightness((uint32_t)((colour & 7) << 2 | (p & 1) << 1), brightness), at_brightness((uint32_t)((colour & 0x38) >> 1 | (p & 2)), brightness),
                    at_brightness((uint32_t)((colour & 0xC0) >> 3 | (p & 4)), brightness));
  }
  int at = bpp == 8 ? colour : palettes + ((entry >> 10 & 7) << bpp) + colour;
  return screen_colour(snes_cgram[at & 0xFF], brightness);
}

// a background's pixel at screen x, from (hpos, row) of its map, into `into`, by the depth of its priority
static void bg_put(int n, int mode, int x, uint32_t hpos, uint32_t row, int brightness, struct layer *into) {
  uint16_t entry;
  int bpp = BPP[mode][n], colour = bg_colour(n, bpp, hpos, row, &entry);
  if (!colour) return;
  int depth = DEPTHS[mode][n][entry >> 13 & 1];
  if (mode == 1 && n == 2 && (entry & 0x2000) && (ppu.mode & 0x0F) == 0x09) depth = 17;
  into->pixel[x] = bg_pixel(bpp, mode == 0 ? n * 32 : 0, entry, colour, brightness);
  into->depth[x] = (uint8_t)depth;
}

// A background with an offset for each column of tiles, as modes 2, 4 and 6 have, drawn span by span as Snes9x draws
// it: each column's scroll from BG3's map, of the row BG3's scroll down gives, the across offsets in that row and the
// down ones in the next, or in mode 4 one word for either, by its top bit; and none for the leftmost column. `v_row` is
// 8 in mode 2, where the down offsets are a row on.
static void bg_offsets(int n, int mode, int y, const struct spans *c, int v_row, int brightness, struct layer *into) {
  uint32_t base = ppu.map[2], size = ppu.map_size[2];
  uint32_t p0 = base, p1 = size & 1 ? p0 + 1024 : p0, p2 = size & 2 ? p1 + 1024 : p0, p3 = size & 1 ? p2 + 1024 : p2;
  int big = ppu.mode >> 6 & 1, shift = big ? 4 : 3;
  uint32_t mask = big ? 0x3FF : 0x1FF, own_mask = ppu.mode >> (4 + n) & 1 ? 0x3FF : 0x1FF;
  uint32_t voff = ppu.vofs[2], hoff = ppu.hofs[2];
  uint32_t h_row = voff >> shift, v_row_n = (voff + (uint32_t)v_row) >> shift;
  uint32_t s1 = (h_row & 0x20 ? p2 : p0) + ((h_row & 0x1F) << 5), s2 = (h_row & 0x20 ? p3 : p1) + ((h_row & 0x1F) << 5);
  int32_t v_apart = (int32_t)((v_row_n & 0x20 ? p2 : p0) + ((v_row_n & 0x1F) << 5)) - (int32_t)s1;
  uint16_t enable = (uint16_t)(0x2000 << n), hscroll = ppu.hofs[n];
  for (int k = 0; k < c->count; k++) {
    uint32_t left = (uint32_t)c->left[k], right = (uint32_t)c->right[k], width = right - left;
    int left_edge = left < 8u - (hscroll & 7);
    while (left < right) {
      uint32_t voffset, hoffset;
      if (left_edge) {
        voffset = ppu.vofs[n] + 1u;
        hoffset = hscroll;
        left_edge = 0;
      } else {
        int column = (int)(((hoff + left - 1) & mask) >> 3);
        uint32_t at_h = column > (big ? 63 : 31) ? s2 + (uint32_t)((big ? column >> 1 : column) & 31) : s1 + (uint32_t)(big ? column >> 1 : column);
        uint16_t h_cell = vram_word(at_h), v_cell;
        if (v_row) {
          v_cell = vram_word((uint32_t)((int32_t)at_h + v_apart));
        } else if (h_cell & 0x8000) {
          v_cell = h_cell;
          h_cell = 0;
        } else {
          v_cell = 0;
        }
        voffset = v_cell & enable ? v_cell + 1u : ppu.vofs[n] + 1u;
        hoffset = h_cell & enable ? (uint32_t)((h_cell & ~7) | (hscroll & 7)) : hscroll;
      }
      uint32_t hpos = (hoffset + left) & own_mask, w = 8 - (hpos & 7);
      if (w > width) w = width;
      for (uint32_t x = left; x < left + w; x++) bg_put(n, mode, (int)x, hoffset + x, voffset + (uint32_t)y, brightness, into);
      left += w;
      width -= w;
    }
  }
}

// Mode 7: one background of 1024 by 1024 pixels, turned, stretched and moved by the matrix, as Snes9x works it out
// for each line and each span of it: from the span's left edge, or with the screen flipped across, from its right, so
// Snes9x flips each span by itself. Its map is the video memory's even bytes, 128 tiles across, and its tiles of 8 bits
// the odd ones. Mode 7's second background, with $2133's bit 6, is the same picture's 7 bits, the eighth its priority.
// With mosaic each block shows the pixel at its top left, its line the block's first, as Snes9x has it, BG2's height
// from BG1's mosaic bit and its width from its own.

// a 13-bit value as a signed one, and a 14-bit difference as Snes9x keeps it to 10 bits and a sign
static int32_t signed13(int16_t v) { return (int32_t)((uint32_t)(uint16_t)v << 19) >> 19; }
static int32_t clip10(int32_t a) { return a & 0x2000 ? (int32_t)((uint32_t)a | ~0x3FFu) : a & 0x3FF; }

static void mode7_span(int n, int y, int left, int right, int brightness, struct layer *into) {
  int sized = (ppu.mosaic >> 4) + 1 > 1 && (ppu.mosaic >> n & 1);
  int across = sized ? (ppu.mosaic >> 4) + 1 : 1, down = sized && (ppu.mosaic & 1) ? (ppu.mosaic >> 4) + 1 : 1;
  // the block's first line, and mode 7's values as they were on it
  int first = stretch_start - (int)((uint32_t)(stretch_start - mosaic_start) % (uint32_t)down);
  int from_y = first + (y - first) / down * down;
  const struct line_state *at = &lines[from_y < 0 ? 0 : from_y];
  int m_left = left - left % across, m_right = (right + across - 1) / across * across;
  int32_t hofs = signed13(at->m7_hofs), vofs = signed13(at->m7_vofs), cx = signed13(at->m7_x), cy = signed13(at->m7_y);
  int32_t a = at->m7[0], b = at->m7[1], c = at->m7[2], d = at->m7[3];
  uint8_t start_y = (uint8_t)(from_y + 1);
  if (ppu.m7_vflip) start_y ^= 0xFF;
  int32_t yy = clip10(vofs - cy), xx = clip10(hofs - cx);
  int32_t bb = ((b * start_y) & ~63) + ((b * yy) & ~63) + (int32_t)((uint32_t)cx << 8);
  int32_t dd = ((d * start_y) & ~63) + ((d * yy) & ~63) + (int32_t)((uint32_t)cy << 8);
  int32_t start_x = ppu.m7_hflip ? (sized ? m_right : right) - 1 : (sized ? m_left : left);
  int32_t step_a = ppu.m7_hflip ? -a : a, step_c = ppu.m7_hflip ? -c : c;
  int32_t aa = a * start_x + ((a * xx) & ~63), cc = c * start_x + ((c * xx) & ~63);
  for (int x = sized ? m_left : left; x < (sized ? m_right : right); x++, aa += step_a, cc += step_c) {
    // with mosaic, only each block's first pixel is worked out
    if (sized && (x - m_left) % across) continue;
    int32_t px = (aa + bb) >> 8, py = (cc + dd) >> 8;
    uint8_t pixel;
    if (!ppu.m7_repeat) {
      px &= 0x3FF;
      py &= 0x3FF;
    }
    if (!((px | py) & ~0x3FF)) {
      uint8_t tile = snes_vram[(((py & ~7) << 4) + (px >> 3)) << 1];
      pixel = snes_vram[((tile << 6) + ((py & 7) << 3) + (px & 7)) << 1 | 1];
    } else if (ppu.m7_repeat == 3) {
      pixel = snes_vram[(((py & 7) << 3) + (px & 7)) << 1 | 1];
    } else {
      continue;
    }
    int colour = n ? pixel & 0x7F : pixel;
    if (!colour) continue;
    uint16_t shade = n ? screen_colour(snes_cgram[colour], brightness) : bg_pixel(8, 0, 0, colour, brightness);
    int depth = n ? (pixel & 0x80 ? 11 : 3) : 7;
    for (int w = x; w < x + across; w++) {
      if (w < left || w >= right) continue;
      into->pixel[w] = shade;
      into->depth[w] = (uint8_t)depth;
    }
  }
}

// A line's layers on one screen: the sprites, then each background the mode has, where its spans on that screen let
// it be drawn
static void draw_layers(int screen, int line, const uint8_t *obj_colours, const uint8_t *obj_priorities, int brightness, struct layer *layers) {
  int mode = ppu.mode & 7, shown = screen == MAIN ? ppu.main : ppu.sub, y = line - SNES_FIRST_LINE;
  int mosaic = (ppu.mosaic >> 4) + 1;
  for (int n = 0; n < 5; n++) for (int x = 0; x < SNES_WIDTH; x++) layers[n].depth[x] = 0;
  if (shown & 0x10) {
    const struct spans *c = &spans[screen][4];
    for (int k = 0; k < c->count; k++) {
      for (int x = c->left[k]; x < c->right[k]; x++) {
        if (!obj_colours[x]) continue;
        layers[4].pixel[x] = screen_colour(snes_cgram[obj_colours[x]], brightness);
        layers[4].depth[x] = (uint8_t)(4 + obj_priorities[x] * 4);
      }
    }
  }
  if (mode == 7) {
    for (int n = 0; n < 2; n++) {
      if (!(shown >> n & 1) || (n && !(ppu.setini & 0x40))) continue;
      const struct spans *c = &spans[screen][n];
      for (int k = 0; k < c->count; k++) mode7_span(n, y, c->left[k], c->right[k], brightness, &layers[n]);
    }
    return;
  }
  if (mode > 4) return;
  for (int n = 0; n < 4; n++) {
    if (!(shown >> n & 1) || !BPP[mode][n]) continue;
    const struct spans *c = &spans[screen][n];
    if (mode == 2 || mode == 4) {
      bg_offsets(n, mode, y, c, mode == 2 ? 8 : 0, brightness, &layers[n]);
      continue;
    }
    // With mosaic, each block of pixels as its top left one. As Snes9x draws it, in the background's first span the
    // blocks start down from the line mosaic was written on, each with the scroll of its first line or of the
    // stretch's first, whichever is later; in its other spans they start down from the stretch's first line, as Snes9x
    // starts them again there.
    int blocky = (ppu.mosaic >> n & 1) && mosaic > 1;
    for (int k = 0; k < c->count; k++) {
      int from_y = y, scrolled_y = y;
      if (blocky) {
        // the blocks of the stretch's first span start where Snes9x works it out, unsigned, from the stretch's first line
        int first = k ? stretch_start : stretch_start - (int)((uint32_t)(stretch_start - mosaic_start) % (uint32_t)mosaic);
        from_y = first + (y - first) / mosaic * mosaic;
        scrolled_y = from_y > stretch_start || k ? from_y : stretch_start;
      }
      const struct line_state *at = &lines[scrolled_y];
      for (int x = c->left[k]; x < c->right[k]; x++) {
        int from_x = blocky ? x - x % mosaic : x;
        bg_put(n, mode, x, (uint32_t)(from_x + at->hofs[n]), (uint32_t)(from_y + SNES_FIRST_LINE + at->vofs[n]), brightness, &layers[n]);
      }
    }
  }
}

static void draw_line(uint32_t *out, int line) {
  int brightness = ppu.screen & 15;
  uint8_t obj_colours[SNES_WIDTH], obj_priorities[SNES_WIDTH];
  if ((ppu.main | ppu.sub) & 0x10) obj_line(line - SNES_FIRST_LINE, obj_colours, obj_priorities);
  // the sub screen is drawn only when maths can use it, as Snes9x has it: elsewhere maths uses the fixed colour
  int sub_drawn = (ppu.colour_select & 0x30) != 0x30 && (ppu.colour_select & 2) && (ppu.colour_maths & 0x3F) && (ppu.sub & 0x1F);
  static struct layer main[5], sub[5];
  draw_layers(MAIN, line, obj_colours, obj_priorities, brightness, main);
  if (sub_drawn) draw_layers(SUB, line, obj_colours, obj_priorities, brightness, sub);
  // the colour window's mode at each pixel, from the backdrop's spans, which take in the whole line
  uint8_t modes[SNES_WIDTH];
  const struct spans *backdrop = &spans[MAIN][5];
  for (int k = 0; k < backdrop->count; k++) for (int x = backdrop->left[k]; x < backdrop->right[k]; x++) modes[x] = backdrop->mode[k];
  uint16_t backdrop_pixel = screen_colour(snes_cgram[0], brightness);
  for (int x = 0; x < SNES_WIDTH; x++) {
    // the layer in front on each screen
    int front = BACKDROP, sub_front = BACKDROP, depth = 0, sub_depth = 0;
    for (int n = 0; n < 5; n++) {
      if (main[n].depth[x] > depth) {
        front = n;
        depth = main[n].depth[x];
      }
      if (sub_drawn && sub[n].depth[x] > sub_depth) {
        sub_front = n;
        sub_depth = sub[n].depth[x];
      }
    }
    int black = !(modes[x] & 1);
    uint16_t pixel = black ? 0 : front == BACKDROP ? backdrop_pixel : main[front].pixel[x];
    // maths for the layer's bit of $2131, the backdrop's bit 5, and of the sprites only those of palettes 4 to 7
    int maths = (modes[x] & 2) && (ppu.colour_maths >> front & 1) && (front != 4 || obj_colours[x] >= 128 + 64);
    if (maths) {
      int sub_layer = sub_front != BACKDROP;
      pixel = with_maths(pixel, sub_layer ? sub[sub_front].pixel[x] : backdrop_pixel, sub_layer, black, brightness);
    }
    out[x] = shown(pixel);
  }
}

uint8_t ppu_read(uint16_t address) {
  // $2134 to $2136: mode 7's A times the top byte of its B, signed, as the console gives it at once
  int32_t product = (int32_t)ppu.m7[0] * (int32_t)(ppu.m7[1] >> 8);
  return (uint8_t)(product >> ((address - 0x2134) * 8));
}

/** What the console does to the picture unit as V-blank starts, after the frame's last line: unless the screen is off,
 *  the sprites' table's address goes back to where it was last written, and the first sprite with it. */
void ppu_vblank(void) {
  if (ppu.screen & 0x80) return;
  ppu.oam_addr = ppu.oam_saved;
  ppu.first_sprite = ppu.rotation ? (uint8_t)((ppu.oam_addr & 0xFE) >> 1) : 0;
  ppu.oam_second = 0;
}

// the fixed colour at the screen's brightness, made again only when maths can use it, as Snes9x makes it
static void fixed_colour(void) {
  if ((ppu.colour_select & 0x30) != 0x30 && (ppu.colour_maths & 0x3F)) {
    int brightness = ppu.screen & 15;
    fixed_pixel = pixel_of(at_brightness(ppu.fixed[0], brightness), at_brightness(ppu.fixed[1], brightness), at_brightness(ppu.fixed[2], brightness));
  }
}

// The frame's lines, one at a time, with the registers as each finds them, each at its time on the line (timing.c):
// HDMA starts at line 0 and writes in each line's H-blank, from line 0 to 224, and what it writes shows from the next
// line down, as does what the game's IRQ handler writes after the point where Snes9x draws the line before; the
// sprites' lines are found again, and the windows' spans cut again, when their registers have changed.
static uint32_t *frame_out;
static void draw_row(int y) {
  if (!y || sprites_changed) obj_setup();
  if (!y || windows_changed) compute_spans();
  sprites_changed = windows_changed = 0;
  struct line_state *now = &lines[y];
  for (int n = 0; n < 4; n++) {
    now->hofs[n] = ppu.hofs[n];
    now->vofs[n] = ppu.vofs[n];
  }
  for (int i = 0; i < 4; i++) now->m7[i] = ppu.m7[i];
  now->m7_x = ppu.m7_x;
  now->m7_y = ppu.m7_y;
  now->m7_hofs = ppu.m7_hofs;
  now->m7_vofs = ppu.m7_vofs;
  fixed_colour();
  if (ppu.screen & 0x80) {
    for (int x = 0; x < SNES_WIDTH; x++) frame_out[y * SNES_WIDTH + x] = 0xFF000000u;
  } else {
    draw_line(frame_out + y * SNES_WIDTH, y + SNES_FIRST_LINE);
  }
  rows_drawn = y + 1;
}

void ppu_frame(uint32_t *out) {
  frame_out = out;
  for (int line = 0; line <= SNES_HEIGHT; line++) {
    // the frame's rows start at line 1, with mosaic's blocks from the top, as Snes9x starts them
    if (line == SNES_FIRST_LINE) {
      mosaic_start = stretch_start = rows_drawn = 0;
      drawing = 1;
    }
    timing_line_run(line, draw_row, hdma_start, hdma_line);
  }
  drawing = 0;
  timing_at(SNES_HEIGHT + SNES_FIRST_LINE, 0);
}
