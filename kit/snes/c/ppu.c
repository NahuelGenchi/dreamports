// The Super Nintendo's picture unit, as kit/snes/c/snes.h says: its registers, its memories, and a frame drawn from
// them, a line at a time, as the console draws it. So far: the screen on and off and its brightness ($2100), the
// sprites, with their table through its port ($2101 to $2104), the backgrounds of modes 0 and 1, of 8 or 16 pixels a
// tile, with their maps, tiles and scrolling ($2105 to $2114), video memory through its port ($2115 to $2119), the
// colours through theirs ($2121, $2122), and which layers the main screen shows ($212C). The brightness is each
// colour's 5 bits times the brightness over 15, rounded, as Snes9x, the reference the proof tools run the original on,
// has it, and a line's sprites are its first 32 and, of their tiles, the last 34, as Snes9x has them too.

#include "snes-kit.h"

uint8_t snes_vram[0x10000];
uint16_t snes_cgram[256];
uint8_t snes_oam[544];

struct ppu_state {
  uint8_t screen;                     // $2100: the screen off in bit 7, its brightness below
  uint8_t mode;                       // $2105: the mode, BG3's priority in mode 1, and each background's tile size
  uint16_t map[4], tiles[4];          // where each background's map and tiles are, in words of video memory
  uint8_t map_size[4];                // 32 or 64 tiles across and down: bit 0 across, bit 1 down
  uint16_t hofs[4], vofs[4];          // each background's scroll
  uint8_t scroll_latch;               // the byte the scroll registers share, the last written
  uint8_t vmain;                      // $2115: how the video memory's address moves on, and after which byte
  uint16_t vaddr;                     // the video memory's address, in words
  uint8_t cgaddr, cg_low;             // the colours' address, and the first byte of a colour written
  int cg_second;                      // whether the next byte written to $2122 is a colour's second
  uint8_t main;                       // $212C: the layers the main screen shows
  uint32_t obj_base, obj_gap;         // $2101: where the sprites' tiles are, and their second table's distance, in bytes
  uint8_t obj_sizes;                  // which two sizes the sprites are
  uint16_t oam_addr, oam_saved;       // the sprites' table's address, in words, and as last written, which V-blank goes back to
  uint8_t oam_second, oam_low;        // whether the next byte written is a word's second, and its first
  uint8_t rotation, first_sprite;     // $2103's top bit, and the sprite that comes first
};
static struct ppu_state ppu;

void ppu_power(void) {
  ppu = (struct ppu_state){ 0 };
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
    if (ppu.oam_addr & 0x100) snes_oam[0x200 + ((ppu.oam_addr & 0x0F) << 1) + ppu.oam_second] = value;
    else if (ppu.oam_second) {
      snes_oam[ppu.oam_addr << 1] = ppu.oam_low;
      snes_oam[(ppu.oam_addr << 1) + 1] = value;
    }
    ppu.oam_second ^= 1;
    if (!ppu.oam_second) {
      ppu.oam_addr = (ppu.oam_addr + 1) & 0x1FF;
      if (ppu.rotation) ppu.first_sprite = (uint8_t)((ppu.oam_addr & 0xFE) >> 1);
    }
    break;
  case 0x2105: ppu.mode = value; break;
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
  case 0x210D: case 0x210F: case 0x2111: case 0x2113: {
    // across: the byte, the shared one's top five bits and the low three of this one's high byte, as the console has it
    int n = (address - 0x210D) >> 1;
    ppu.hofs[n] = (uint16_t)(value << 8 | (ppu.scroll_latch & ~7) | (ppu.hofs[n] >> 8 & 7));
    ppu.scroll_latch = value;
    break;
  }
  case 0x210E: case 0x2110: case 0x2112: case 0x2114: {
    int n = (address - 0x210E) >> 1;
    ppu.vofs[n] = (uint16_t)(value << 8 | ppu.scroll_latch);
    ppu.scroll_latch = value;
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
    else snes_cgram[ppu.cgaddr++] = (uint16_t)((value & 0x7F) << 8 | ppu.cg_low);
    ppu.cg_second = !ppu.cg_second;
    break;
  case 0x212C: ppu.main = value; break;
  }
}

// a word of video memory, at a word's address
static uint16_t vram_word(uint32_t at) {
  at = (at & 0x7FFF) * 2;
  return (uint16_t)(snes_vram[at] | snes_vram[at + 1] << 8);
}

/** A background's pixel at (x, line): the colour's number in the palette's memory, 0 where it shows nothing, and its
 *  map's priority bit in `priority`. `bpp` is how many bits its tiles have, and `palettes` where its colours start. */
static int bg_pixel(int n, int bpp, int palettes, int x, int line, int *priority) {
  int big = ppu.mode >> (4 + n) & 1, size = big ? 16 : 8;
  int sx = (x + ppu.hofs[n]) & 0x3FF, sy = (line + ppu.vofs[n]) & 0x3FF;
  int tx = sx / size, ty = sy / size;
  uint32_t at = ppu.map[n] + ((ty & 31) << 5) + (tx & 31);
  if ((tx & 32) && (ppu.map_size[n] & 1)) at += 0x400;
  if ((ty & 32) && (ppu.map_size[n] & 2)) at += ppu.map_size[n] == 3 ? 0x800 : 0x400;
  uint16_t entry = vram_word(at);
  int px = sx % size, py = sy % size;
  if (entry & 0x4000) px = size - 1 - px;
  if (entry & 0x8000) py = size - 1 - py;
  int tile = entry & 0x3FF;
  if (big) tile += (px >> 3) + ((py >> 3) << 4);
  px &= 7;
  py &= 7;
  uint32_t row = ppu.tiles[n] + (uint32_t)(tile & 0x3FF) * (uint32_t)(bpp * 4) + (uint32_t)py;
  int colour = 0;
  for (int plane = 0; plane < bpp; plane += 2) {
    uint16_t bits = vram_word(row + (uint32_t)(plane * 4));
    colour |= (bits >> (7 - px) & 1) << plane | (bits >> (15 - px) & 1) << (plane + 1);
  }
  if (!colour) return 0;
  *priority = entry >> 13 & 1;
  return palettes + ((entry >> 10 & 7) << bpp) + colour;
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

// a colour of the palette's memory, at the screen's brightness, as the page shows it
static uint32_t shown(uint16_t colour, int brightness) {
  uint32_t r = colour & 31, g = colour >> 5 & 31, b = colour >> 10 & 31;
  r = (r * (uint32_t)brightness * 2 + 15) / 30;
  g = (g * (uint32_t)brightness * 2 + 15) / 30;
  b = (b * (uint32_t)brightness * 2 + 15) / 30;
  return 0xFF000000u | b << 19 | g << 11 | r << 3;
}

// One line of the main screen in modes 0 and 1: at each pixel, of the layers the main screen shows, the one with a
// pixel there that's furthest in front, by the depth its mode and its priority give it, as Snes9x orders them: a
// sprite at 4, 8, 12 or 16 by its priority, and each background at the depths of its two priorities below.
static const int8_t DEPTHS[2][4][2] = {
  { { 11, 15 }, { 10, 14 }, { 3, 7 }, { 2, 6 } },
  { { 11, 15 }, { 10, 14 }, { 3, 7 }, { 0, 0 } },
};

static void draw_line(uint32_t *out, int line) {
  int mode = ppu.mode & 7, brightness = ppu.screen & 15;
  uint8_t obj_colours[SNES_WIDTH], obj_priorities[SNES_WIDTH];
  if (ppu.main & 0x10) obj_line(line - SNES_FIRST_LINE, obj_colours, obj_priorities);
  // mode 1's third background in front at its high priority when $2105 is mode 1 with bit 3 alone
  int bg3_front = (ppu.mode & 0x0F) == 0x09;
  for (int x = 0; x < SNES_WIDTH; x++) {
    int colour = 0, depth = 0;
    if ((ppu.main & 0x10) && obj_colours[x]) {
      colour = obj_colours[x];
      depth = 4 + obj_priorities[x] * 4;
    }
    for (int n = 0; n < 4 && mode <= 1; n++) {
      if (!(ppu.main >> n & 1) || (mode == 1 && n == 3)) continue;
      int priority = 0;
      int found = mode == 0 ? bg_pixel(n, 2, n * 32, x, line, &priority) : bg_pixel(n, n < 2 ? 4 : 2, 0, x, line, &priority);
      if (!found) continue;
      int z = mode == 1 && n == 2 && priority && bg3_front ? 17 : DEPTHS[mode][n][priority];
      if (z > depth) {
        colour = found;
        depth = z;
      }
    }
    out[x] = shown(snes_cgram[colour], brightness);
  }
}

/** What the console does to the picture unit as V-blank starts, after the frame's last line: unless the screen is off,
 *  the sprites' table's address goes back to where it was last written, and the first sprite with it. */
void ppu_vblank(void) {
  if (ppu.screen & 0x80) return;
  ppu.oam_addr = ppu.oam_saved;
  ppu.first_sprite = ppu.rotation ? (uint8_t)((ppu.oam_addr & 0xFE) >> 1) : 0;
  ppu.oam_second = 0;
}

void ppu_frame(uint32_t *out) {
  obj_setup();
  for (int y = 0; y < SNES_HEIGHT; y++) {
    if (ppu.screen & 0x80) {
      for (int x = 0; x < SNES_WIDTH; x++) out[y * SNES_WIDTH + x] = 0xFF000000u;
      continue;
    }
    draw_line(out + y * SNES_WIDTH, y + SNES_FIRST_LINE);
  }
}
