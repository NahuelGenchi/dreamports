// The Super Nintendo's picture unit, as kit/snes/c/snes.h says: its registers, its memories, and a frame drawn from
// them, a line at a time, as the console draws it. So far: the screen on and off and its brightness ($2100), the
// backgrounds of modes 0 and 1, of 8 or 16 pixels a tile, with their maps, tiles and scrolling ($2105 to $2114), video
// memory through its port ($2115 to $2119), the colours through theirs ($2121, $2122), and which layers the main screen
// shows ($212C). The brightness is each colour's 5 bits times the brightness over 15, rounded, as Snes9x, the
// reference the proof tools run the original on, has it.

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

// a colour of the palette's memory, at the screen's brightness, as the page shows it
static uint32_t shown(uint16_t colour, int brightness) {
  uint32_t r = colour & 31, g = colour >> 5 & 31, b = colour >> 10 & 31;
  r = (r * (uint32_t)brightness * 2 + 15) / 30;
  g = (g * (uint32_t)brightness * 2 + 15) / 30;
  b = (b * (uint32_t)brightness * 2 + 15) / 30;
  return 0xFF000000u | b << 19 | g << 11 | r << 3;
}

// One line of the main screen in modes 0 and 1, front to back: each layer's pixel and the priority it's drawn at.
// Sprites aren't drawn yet, so their places in the order are left out.
static void draw_line(uint32_t *out, int line) {
  int mode = ppu.mode & 7, brightness = ppu.screen & 15;
  for (int x = 0; x < SNES_WIDTH; x++) {
    int colours[4] = { 0, 0, 0, 0 }, priorities[4] = { 0, 0, 0, 0 };
    for (int n = 0; n < 4; n++) {
      if (!(ppu.main >> n & 1)) continue;
      if (mode == 0) colours[n] = bg_pixel(n, 2, n * 32, x, line, &priorities[n]);
      else if (mode == 1 && n < 3) colours[n] = bg_pixel(n, n < 2 ? 4 : 2, 0, x, line, &priorities[n]);
    }
    int colour = 0;
    // each layer at a priority, front to back: [layer, priority], as the mode orders them
    static const int8_t mode0[8][2] = { { 0, 1 }, { 1, 1 }, { 0, 0 }, { 1, 0 }, { 2, 1 }, { 3, 1 }, { 2, 0 }, { 3, 0 } };
    static const int8_t mode1[6][2] = { { 0, 1 }, { 1, 1 }, { 0, 0 }, { 1, 0 }, { 2, 1 }, { 2, 0 } };
    if (mode == 1 && (ppu.mode & 8) && colours[2] && priorities[2]) colour = colours[2];
    const int8_t (*order)[2] = mode == 0 ? mode0 : mode1;
    int count = mode == 0 ? 8 : mode == 1 ? 6 : 0;
    for (int i = 0; i < count && !colour; i++) {
      int n = order[i][0];
      if (colours[n] && priorities[n] == order[i][1]) colour = colours[n];
    }
    out[x] = shown(snes_cgram[colour], brightness);
  }
}

void ppu_frame(uint32_t *out) {
  for (int y = 0; y < SNES_HEIGHT; y++) {
    if (ppu.screen & 0x80) {
      for (int x = 0; x < SNES_WIDTH; x++) out[y * SNES_WIDTH + x] = 0xFF000000u;
      continue;
    }
    draw_line(out + y * SNES_WIDTH, y + SNES_FIRST_LINE);
  }
}
