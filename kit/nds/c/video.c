// The Nintendo DS's two 2D engines, A and B, and the video memory's nine banks, as melonDS, the reference emulator,
// has them (its GPU.cpp and GPU2D_Soft.cpp, which this follows): each bank is given to a use by its control register,
// the processors reading and writing it at its own place (LCDC) or at the place its use has, and each 16 KB page of an
// engine's backgrounds reads what every bank given to it there holds, ORed, as the console's wiring does.
//
// An engine draws in mode 0: its backdrop, then its four text backgrounds by their priority, each its tiles of 16 or 256
// colours from its tile and map bases, at its scroll, 256 or 512 dots across and down, a tile flipped either way as its
// map says, and among them its sprites, each in front of the backgrounds of its priority, as melonDS's DrawSprites,
// DrawSprite_Normal and InterleaveSprites draw them. A Dreamport draws as its original writes: the kit draws each line
// from the registers and memory as the V-blank's writes left them. Not yet: the other modes, sprites that turn, blend,
// make a window, are bitmaps or use mosaic, windows, blending and brightness, extended palettes, 3D, a display of the
// video memory, and the banks' uses for textures, extended palettes and the ARM7, which stop the game (nds_not_yet).

#include "nds.h"
#include "nds-kit.h"

// the banks: A to I, their sizes, and where each sits when it's at its own place (LCDC)
static const uint32_t SIZE[9] = { 0x20000, 0x20000, 0x20000, 0x20000, 0x10000, 0x4000, 0x4000, 0x8000, 0x4000 };
static const uint32_t LCDC[9] = { 0x000000, 0x020000, 0x040000, 0x060000, 0x080000, 0x090000, 0x094000, 0x098000, 0x0A0000 };
static const uint8_t KEEP[9] = { 0x9B, 0x9B, 0x9F, 0x9F, 0x87, 0x9F, 0x9F, 0x83, 0x83 };
static uint8_t bank_a[0x20000], bank_b[0x20000], bank_c[0x20000], bank_d[0x20000], bank_e[0x10000], bank_f[0x4000], bank_g[0x4000], bank_h[0x8000], bank_i[0x4000];
static uint8_t *const BANK[9] = { bank_a, bank_b, bank_c, bank_d, bank_e, bank_f, bank_g, bank_h, bank_i };
static uint8_t vramcnt[9];

// for each 16 KB page of each engine's backgrounds, the banks given to it there, a bit each
static uint16_t abg[32], bbg[8];
// and of each engine's sprites: 256 KB of A's, 128 KB of B's
static uint16_t aobj[16], bobj[8];
// the sprites' list, 1 KB for each engine: 128 sprites, each three halfwords and one that's no sprite's
static uint8_t oam[0x800];

static uint32_t dispcnt[2];
static uint16_t bgcnt[2][4], scroll_x[2][4], scroll_y[2][4];

uint8_t nds_palette[0x800];

static void unmap(int bank) {
  for (int p = 0; p < 32; p++) abg[p] &= ~(1u << bank);
  for (int p = 0; p < 8; p++) bbg[p] &= ~(1u << bank);
  for (int p = 0; p < 16; p++) aobj[p] &= ~(1u << bank);
  for (int p = 0; p < 8; p++) bobj[p] &= ~(1u << bank);
}

// gives a bank to the use its control register says, as melonDS's MapVRAM_* do for the uses here
static void map(int bank, uint8_t cnt) {
  cnt &= KEEP[bank];
  vramcnt[bank] = cnt;
  unmap(bank);
  if (!(cnt & 0x80)) return;
  int use = cnt & 7, offset = (cnt >> 3) & 3;
  if (bank <= 1) use &= 3;
  switch (bank) {
  case 0: case 1: case 2: case 3:
    if (use == 0) return;
    if (use == 1) { for (int p = 0; p < 8; p++) abg[offset * 8 + p] |= 1u << bank; return; }
    if (use == 2 && bank <= 1) { for (int p = 0; p < 8; p++) aobj[(offset & 1) * 8 + p] |= 1u << bank; return; }
    if (use == 4 && bank == 2) { for (int p = 0; p < 8; p++) bbg[p] |= 1u << bank; return; }
    if (use == 4 && bank == 3) { for (int p = 0; p < 8; p++) bobj[p] |= 1u << bank; return; }
    break;
  case 4:
    if (use == 0) return;
    if (use == 1) { for (int p = 0; p < 4; p++) abg[p] |= 1u << bank; return; }
    if (use == 2) { for (int p = 0; p < 4; p++) aobj[p] |= 1u << bank; return; }
    break;
  case 5: case 6:
    if (use == 0) return;
    // a page, and its mirror two pages on
    if (use == 1) { abg[(offset & 1) + (offset & 2) * 2] |= 1u << bank; abg[(offset & 1) + (offset & 2) * 2 + 2] |= 1u << bank; return; }
    if (use == 2) { aobj[(offset & 1) + (offset & 2) * 2] |= 1u << bank; aobj[(offset & 1) + (offset & 2) * 2 + 2] |= 1u << bank; return; }
    break;
  case 7:
    if ((cnt & 3) == 0) return;
    if ((cnt & 3) == 1) { for (int p = 0; p < 8; p++) if ((p & 2) == 0) bbg[p] |= 1u << bank; return; }
    break;
  default:
    if ((cnt & 3) == 0) return;
    if ((cnt & 3) == 1) { for (int p = 0; p < 8; p++) if (p & 2) bbg[p] |= 1u << bank; return; }
    if ((cnt & 3) == 2) { for (int p = 0; p < 8; p++) bobj[p] |= 1u << bank; return; }
    break;
  }
  nds_not_yet();
}

// a byte of an engine's backgrounds: what every bank given to it at that page holds there, ORed
static uint8_t bg_byte(int engine, uint32_t offset) {
  offset &= engine ? 0x1FFFF : 0x7FFFF;
  uint16_t banks = engine ? bbg[offset >> 14] : abg[offset >> 14];
  uint8_t value = 0;
  for (int b = 0; banks; b++, banks >>= 1) if (banks & 1) value |= BANK[b][offset & (SIZE[b] - 1)];
  return value;
}
static uint16_t bg_half(int engine, uint32_t offset) { return bg_byte(engine, offset) | bg_byte(engine, offset + 1) << 8; }

// a byte of an engine's sprites' tiles, the same way
static uint8_t obj_byte(int engine, uint32_t offset) {
  offset &= engine ? 0x1FFFF : 0x3FFFF;
  uint16_t banks = engine ? bobj[offset >> 14] : aobj[offset >> 14];
  uint8_t value = 0;
  for (int b = 0; banks; b++, banks >>= 1) if (banks & 1) value |= BANK[b][offset & (SIZE[b] - 1)];
  return value;
}

void nds_video_power(void) {
  for (int b = 0; b < 9; b++) { vramcnt[b] = 0; for (uint32_t i = 0; i < SIZE[b]; i++) BANK[b][i] = 0; }
  for (int p = 0; p < 32; p++) abg[p] = 0;
  for (int p = 0; p < 8; p++) bbg[p] = 0;
  for (int p = 0; p < 16; p++) aobj[p] = 0;
  for (int p = 0; p < 8; p++) bobj[p] = 0;
  for (int i = 0; i < 0x800; i++) oam[i] = 0;
  for (int e = 0; e < 2; e++) {
    dispcnt[e] = 0;
    for (int n = 0; n < 4; n++) bgcnt[e][n] = scroll_x[e][n] = scroll_y[e][n] = 0;
  }
  for (int i = 0; i < 0x800; i++) nds_palette[i] = 0;
}

// what the kit draws: an engine in mode 0 with its text backgrounds, and no more
static void check_engine(int engine) {
  uint32_t c = dispcnt[engine];
  if ((c & 7) || (c & 0x0000E008u) || (c & 0xC0000000u) || ((c >> 16) & 3) > 1) nds_not_yet();
  for (int n = 0; n < 4; n++) if (bgcnt[engine][n] & 0x0040) nds_not_yet();
}

// the video's registers and memory, as the ARM9 writes them: `bytes` 1, 2 or 4 at `address`
int nds_video_write(uint32_t address, uint32_t value, int bytes) {
  if (bytes == 4) {
    if (address == NDS_DISPCNT_A || address == NDS_DISPCNT_B) {
      dispcnt[address == NDS_DISPCNT_B] = value;
      check_engine(address == NDS_DISPCNT_B);
      return 1;
    }
    return nds_video_write(address, value & 0xFFFF, 2) && nds_video_write(address + 2, value >> 16, 2);
  }
  if (address >= 0x04000240 && address <= 0x04000249 && address != 0x04000247) {
    if (bytes == 2) return nds_video_write(address, value & 0xFF, 1) && (address + 1 == 0x04000247 || nds_video_write(address + 1, value >> 8, 1));
    map(address < 0x04000247 ? address - 0x04000240 : address - 0x04000241, (uint8_t)value);
    return 1;
  }
  if (address >> 24 == 0x05) {
    // the ARM9 writes the colours by halfwords and words: a byte written there is lost, as the console's is
    if (bytes == 1) return 1;
    for (int i = 0; i < bytes; i++) nds_palette[(address + i) & 0x7FF] = (uint8_t)(value >> (8 * i));
    return 1;
  }
  if (address >> 24 == 0x07) {
    // the sprites' list, by halfwords and words: a byte written there is lost, as the console's is
    if (bytes == 1) return 1;
    for (int i = 0; i < bytes; i++) oam[(address + i) & 0x7FF] = (uint8_t)(value >> (8 * i));
    return 1;
  }
  if (address >> 24 == 0x06) {
    // the ARM9 writes the video memory by halfwords and words: a byte written there is lost, as the console's is
    if (bytes == 1) return 1;
    uint32_t place = address & 0x00FFFFFF;
    if (place >= 0x400000 && place < 0x800000) {
      int engine = place >= 0x600000;
      uint32_t offset = place & (engine ? 0x1FFFF : 0x3FFFF);
      uint16_t banks = engine ? bobj[offset >> 14] : aobj[offset >> 14];
      for (int b = 0; banks; b++, banks >>= 1) {
        if (!(banks & 1)) continue;
        for (int i = 0; i < bytes; i++) BANK[b][(offset + i) & (SIZE[b] - 1)] = (uint8_t)(value >> (8 * i));
      }
      return 1;
    }
    if (place >= 0x800000 && place < 0x8A4000) {
      for (int b = 0; b < 9; b++) {
        if ((vramcnt[b] & 0x87) != 0x80 || place - 0x800000 < LCDC[b] || place - 0x800000 >= LCDC[b] + SIZE[b]) continue;
        for (int i = 0; i < bytes; i++) BANK[b][place - 0x800000 - LCDC[b] + i] = (uint8_t)(value >> (8 * i));
      }
      return 1;
    }
    if (place < 0x200000 || (place >= 0x200000 && place < 0x400000)) {
      int engine = place >= 0x200000;
      uint32_t offset = place & (engine ? 0x1FFFF : 0x7FFFF);
      uint16_t banks = engine ? bbg[offset >> 14] : abg[offset >> 14];
      for (int b = 0; banks; b++, banks >>= 1) {
        if (!(banks & 1)) continue;
        for (int i = 0; i < bytes; i++) BANK[b][(offset + i) & (SIZE[b] - 1)] = (uint8_t)(value >> (8 * i));
      }
      return 1;
    }
    nds_not_yet();
    return 1;
  }
  // the engines' own registers, 0x04000000 and 0x04001000 on, and nothing else of the hardware
  if ((address >> 12 != 0x04000 && address >> 12 != 0x04001) || (address & 0xFFF) >= 0x70) return 0;
  int engine = address >= 0x04001000;
  uint32_t r = address & 0xFFF;
  // the display's status and line count, between engine A's registers, are each processor's own (irq.c)
  if (!engine && r >= 4 && r < 8) return 0;
  if (bytes == 1) { nds_not_yet(); return 1; }
  if (r == 0x000) { dispcnt[engine] = (dispcnt[engine] & 0xFFFF0000u) | value; check_engine(engine); return 1; }
  if (r == 0x002) { dispcnt[engine] = (dispcnt[engine] & 0xFFFF) | value << 16; check_engine(engine); return 1; }
  if (r >= 0x008 && r < 0x010) { bgcnt[engine][(r - 8) >> 1] = (uint16_t)value; check_engine(engine); return 1; }
  if (r >= 0x010 && r < 0x020) {
    int n = (r - 0x10) >> 2;
    if (r & 2) scroll_y[engine][n] = value & 0x1FF;
    else scroll_x[engine][n] = value & 0x1FF;
    return 1;
  }
  return 0;
}

int nds_video_read(uint32_t address, int bytes, uint32_t *value) {
  if (address >> 24 == 0x05 || address >> 24 == 0x07) {
    const uint8_t *from = address >> 24 == 0x05 ? nds_palette : oam;
    *value = 0;
    for (int i = 0; i < bytes; i++) *value |= (uint32_t)from[(address + i) & 0x7FF] << (8 * i);
    return 1;
  }
  if (address >= 0x04000240 && address <= 0x04000249 && address != 0x04000247 && bytes == 1) {
    *value = vramcnt[address < 0x04000247 ? address - 0x04000240 : address - 0x04000241];
    return 1;
  }
  if (address >> 24 == 0x06) {
    uint32_t place = address & 0x00FFFFFF;
    *value = 0;
    for (int i = 0; i < bytes; i++) {
      uint32_t at = place + i;
      uint8_t byte = 0;
      if (at < 0x400000) byte = bg_byte(at >= 0x200000, at);
      else if (at < 0x800000) byte = obj_byte(at >= 0x600000, at);
      else if (at >= 0x800000 && at < 0x8A4000) {
        for (int b = 0; b < 9; b++) {
          if ((vramcnt[b] & 0x87) == 0x80 && at - 0x800000 >= LCDC[b] && at - 0x800000 < LCDC[b] + SIZE[b]) byte |= BANK[b][at - 0x800000 - LCDC[b]];
        }
      } else nds_not_yet();
      *value |= (uint32_t)byte << (8 * i);
    }
    return 1;
  }
  // the engines' own registers, 0x04000000 and 0x04001000 on, and nothing else of the hardware
  if ((address >> 12 != 0x04000 && address >> 12 != 0x04001) || (address & 0xFFF) >= 0x70) return 0;
  int engine = address >= 0x04001000;
  uint32_t r = address & 0xFFF;
  if (r == 0x000) { *value = bytes == 4 ? dispcnt[engine] : dispcnt[engine] & 0xFFFF; return 1; }
  if (r == 0x002) { *value = dispcnt[engine] >> 16; return 1; }
  if (r >= 0x008 && r < 0x010) { *value = bgcnt[engine][(r - 8) >> 1]; return 1; }
  return 0;
}

uint32_t nds_video_dispcnt(int engine) { return dispcnt[engine]; }

// a text background's line, as melonDS's DrawBG_Text draws it, into `line`, colours of 15 bits, 0x8000 for none
static void text_line(int engine, int n, int y, uint16_t *line) {
  uint16_t cnt = bgcnt[engine][n];
  uint32_t tiles, map_at;
  if (engine) {
    tiles = (cnt & 0x003C) << 12;
    map_at = (cnt & 0x1F00) << 3;
  } else {
    tiles = ((dispcnt[0] & 0x07000000) >> 8) + ((cnt & 0x003C) << 12);
    map_at = ((dispcnt[0] & 0x38000000) >> 11) + ((cnt & 0x1F00) << 3);
  }
  uint16_t xoff = scroll_x[engine][n], yoff = (uint16_t)(scroll_y[engine][n] + y);
  uint32_t wide = cnt & 0x4000 ? 0x100 : 0;
  if (cnt & 0x8000) {
    map_at += (yoff & 0x1F8) << 3;
    if (cnt & 0x4000) map_at += (yoff & 0x100) << 3;
  } else {
    map_at += (yoff & 0xF8) << 3;
  }
  const uint8_t *palette = nds_palette + engine * 0x400;
  for (int x = 0; x < 256; x++, xoff++) {
    uint16_t tile = bg_half(engine, map_at + ((xoff & 0xF8) >> 2) + ((xoff & wide) << 3));
    uint32_t row = tile & 0x0800 ? 7 - (yoff & 7) : yoff & 7, column = tile & 0x0400 ? 7 - (xoff & 7) : xoff & 7;
    uint32_t colour;
    if (cnt & 0x0080) {
      colour = bg_byte(engine, tiles + ((tile & 0x3FF) << 6) + (row << 3) + column);
    } else {
      uint8_t pair = bg_byte(engine, tiles + ((tile & 0x3FF) << 5) + (row << 2) + (column >> 1));
      colour = column & 1 ? pair >> 4 : pair & 15;
      if (colour) colour += (tile >> 12) << 4;
    }
    if (colour) line[x] = (palette[colour * 2] | palette[colour * 2 + 1] << 8) & 0x7FFF;
  }
}

// A line's sprites, as melonDS's DrawSprites gathers them: each dot its colour of 15 bits, its priority above it and
// whether a sprite is there, 0 where none is. An earlier sprite in the list stays over a later one at the same place
// unless the later has a lower priority.
#define OBJ_THERE 0x40000u
static void sprites_line(int engine, int y, uint32_t *objects) {
  static const uint8_t WIDTH[16] = { 8, 16, 8, 8, 16, 32, 8, 8, 32, 32, 16, 8, 64, 64, 32, 8 };
  static const uint8_t HEIGHT[16] = { 8, 8, 16, 8, 16, 8, 32, 8, 32, 16, 32, 8, 64, 32, 64, 8 };
  for (int x = 0; x < 256; x++) objects[x] = 0;
  if (!(dispcnt[engine] & 0x1000)) return;
  const uint8_t *list = oam + engine * 0x400, *palette = nds_palette + (engine ? 0x600 : 0x200);
  for (int number = 0; number < 128; number++) {
    const uint8_t *at = list + number * 8;
    uint16_t attr0 = at[0] | at[1] << 8, attr1 = at[2] | at[3] << 8, attr2 = at[4] | at[5] << 8;
    uint32_t type = (attr0 >> 8) & 3;
    if (type == 2) continue;
    // sprites that turn, blend, make a window, are bitmaps or use mosaic aren't drawn yet
    if ((type & 1) || ((attr0 >> 10) & 3) || (attr0 & 0x1000)) nds_not_yet();
    uint32_t size = (attr0 >> 14) | ((attr1 & 0xC000) >> 12);
    int width = WIDTH[size], height = HEIGHT[size];
    int row = (y - (attr0 & 0xFF)) & 0xFF;
    if (row >= height) continue;
    int xpos = (int32_t)((uint32_t)attr1 << 23) >> 23;
    if (xpos <= -width) continue;
    if (attr1 & 0x2000) row = height - 1 - row;
    uint32_t prio = (uint32_t)(attr2 & 0x0C00) << 6, tile = attr2 & 0x3FF, wide_mask = width - 8;
    int colours256 = attr0 & 0x2000;
    uint32_t pixels = tile;
    if (dispcnt[engine] & 0x10) {
      pixels <<= (dispcnt[engine] >> 20) & 3;
      pixels += (uint32_t)((row >> 3) * (width >> 3)) << (colours256 ? 1 : 0);
    } else {
      pixels += (row >> 3) * 0x20;
    }
    pixels <<= 5;
    pixels += colours256 ? (row & 7) << 3 : (row & 7) << 2;
    for (int column = 0; column < width; column++) {
      int x = xpos + column;
      if (x < 0 || x >= 256) continue;
      int across = attr1 & 0x1000 ? width - 1 - column : column;
      uint32_t colour;
      if (colours256) {
        colour = obj_byte(engine, pixels + ((across & wide_mask) << 3) + (across & 7));
      } else {
        uint8_t pair = obj_byte(engine, pixels + ((across & wide_mask) << 2) + ((across & 7) >> 1));
        colour = across & 1 ? pair >> 4 : pair & 15;
        if (colour) colour += (attr2 >> 12) << 4;
      }
      if (!colour) continue;
      uint32_t before = objects[x];
      if (before & OBJ_THERE && prio >= (before & 0x30000u)) continue;
      objects[x] = ((palette[colour * 2] | palette[colour * 2 + 1] << 8) & 0x7FFF) | prio | OBJ_THERE;
    }
  }
}

/** An engine's line `y`, colours of 15 bits, as melonDS draws mode 0: its backdrop, then its backgrounds that are on,
 *  by their priority, from 3 to 0, and at the same priority from the fourth to the first, each priority's sprites over
 *  its backgrounds. */
void nds_video_line(int engine, int y, uint16_t *line) {
  const uint8_t *palette = nds_palette + engine * 0x400;
  uint16_t backdrop = (palette[0] | palette[1] << 8) & 0x7FFF;
  static uint32_t objects[256];
  sprites_line(engine, y, objects);
  for (int x = 0; x < 256; x++) line[x] = backdrop;
  for (int priority = 3; priority >= 0; priority--) {
    for (int n = 3; n >= 0; n--) {
      if ((dispcnt[engine] & (0x100u << n)) && (bgcnt[engine][n] & 3) == priority) text_line(engine, n, y, line);
    }
    for (int x = 0; x < 256; x++) {
      if ((objects[x] & (OBJ_THERE | 0x30000u)) == (OBJ_THERE | (uint32_t)priority << 16)) line[x] = objects[x] & 0x7FFF;
    }
  }
}
