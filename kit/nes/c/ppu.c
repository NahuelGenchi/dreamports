// The NES's picture hardware, the PPU, as it is documented to behave: its registers, the name tables, the colours, the
// sprites and its drawing of each line, at the time in the frame each write happens (kit/nes/c/README.md). It draws a
// frame as the proof tools' emulator, FCEUmm, lays one out: the frame starts as V-blank does, and its 240 lines are
// drawn after it, so what a step writes in V-blank shows in the same frame.

#include "nes.h"
#include "nes-kit.h"

// The 64 colours, as the proof tools see FCEUmm show them with its own palette: five bits of each, red in the lowest
// five bits. Measured from the emulator, a colour at a time, by a program of the project's own (kit/nes/c/README.md).
static const uint16_t COLOURS[64] = {
  0x39CE, 0x4464, 0x5400, 0x4C08, 0x3811, 0x0815, 0x0014, 0x002F, 0x00A8, 0x0100, 0x0140, 0x08E0, 0x2CE3, 0x0000, 0x0000, 0x0000,
  0x5EF7, 0x75C0, 0x74E4, 0x7810, 0x5C17, 0x2C1C, 0x00BB, 0x0539, 0x01D1, 0x0240, 0x02A0, 0x1E40, 0x4600, 0x0000, 0x0000, 0x0000,
  0x7FFF, 0x7EE7, 0x7E4B, 0x7E39, 0x7DFE, 0x59DF, 0x31DF, 0x1E7F, 0x1EFE, 0x0B50, 0x2769, 0x4FEB, 0x6FA0, 0x3DEF, 0x0000, 0x0000,
  0x7FFF, 0x7F95, 0x7F58, 0x7F3A, 0x7F1F, 0x6F1F, 0x5AFF, 0x577F, 0x539F, 0x53FC, 0x5FD5, 0x67F6, 0x7BF3, 0x6318, 0x0000, 0x0000,
};

// the frame's times, in the PPU's dots from the start of the frame (FCEUmm's FCEUPPU_Loop): V-blank's flag, the
// interrupt, the end of V-blank, the pre-render line's copy of the scroll, and the first visible line
enum { VBLANK_AT = 341, NMI_AT = 353, CLEARED_AT = 7161, SCROLLED_AT = 7486, LINE0_AT = 7502, LINE = 341 };

// what the PPU holds
static uint8_t ciram[0x800];          // the console's 2 KB of name tables
static uint8_t *tables[4];            // the four name tables the PPU sees, as the cartridge wires them
static uint8_t *patterns[8];          // the pattern tables, a KB at a time
static uint8_t palette[32];
static uint8_t oam[256];
static uint8_t ctrl, mask, status, oam_addr, fine_x, latch_w, buffer;
static uint16_t v, t;

// the frame being drawn
static uint8_t picture[256 * 240];    // each pixel's colour, 0 to 63
static int now;                       // where the frame has got to, in dots
static int done;                      // how far the PPU's own work has got, in dots
static int frame_length;
static int dead;                      // the first frames, while the PPU warms up
static int line_drawn, pixels_drawn;  // the line being drawn and how many of its pixels are
static uint16_t line_v;               // where the line's background comes from, from pixel line_from on
static int line_from;
// the sprites on the line being drawn, found at the end of the one before: each pixel's colour 1 to 3, or 0, with its
// palette in bits 2-3, 0x10 when it's behind the background and 0x20 when it's sprite 0's
static uint8_t sprites[256];
static int sprite_zero_line;          // whether sprite 0 is on the line being drawn
static int hit_at;                    // the dot sprite 0 hit at this frame, or -1

const int nes_frame_dots = 89342;

static int rendering(void) { return (mask & 0x18) != 0; }

void nes_mirroring(int mirroring) {
  for (int i = 0; i < 4; i++) {
    int k = mirroring == NES_MIRROR_HORIZONTAL ? i >> 1 : mirroring == NES_MIRROR_VERTICAL ? i & 1 : mirroring == NES_MIRROR_ONE_HIGH;
    tables[i] = ciram + k * 0x400;
  }
}

void nes_chr_bank(int slot, uint8_t *bytes) {
  if (slot >= 0 && slot < 8) patterns[slot] = bytes;
}

static uint8_t pattern_byte(uint16_t address) { return patterns[(address >> 10) & 7][address & 0x3FF]; }

// a palette entry's place: the sprites' colour 0s are the background's
static int palette_index(uint16_t address) {
  int i = address & 0x1F;
  return (i & 0x13) == 0x10 ? i & 0x0F : i;
}

static uint8_t vram_read(uint16_t address) {
  address &= 0x3FFF;
  if (address < 0x2000) return pattern_byte(address);
  if (address < 0x3F00) return tables[(address >> 10) & 3][address & 0x3FF];
  return palette[palette_index(address)];
}

static void vram_write(uint16_t address, uint8_t value) {
  address &= 0x3FFF;
  if (address < 0x2000) {
    if (nes_chr_writable) patterns[(address >> 10) & 7][address & 0x3FF] = value;
  } else if (address < 0x3F00) tables[(address >> 10) & 3][address & 0x3FF] = value;
  else palette[palette_index(address)] = value & 0x3F;
}

// the background's colour at pixel x of the line, 0 to 3 with its palette in bits 2-3, or 0 where it shows nothing
static int background_at(int x) {
  if (!(mask & 0x08) || (x < 8 && !(mask & 0x02))) return 0;
  // from line_v's tile on, counted from where the line took it
  int along = x + fine_x;
  int tile = (along >> 3) - ((line_from + fine_x) >> 3), bit = 7 - (along & 7);
  int coarse = (line_v & 0x1F) + tile, table = (line_v >> 10) & 3;
  if (coarse >= 32) { coarse -= 32; table ^= 1; }
  int row = (line_v >> 5) & 0x1F, fine_y = (line_v >> 12) & 7;
  const uint8_t *names = tables[table];
  uint16_t at = (uint16_t)(((ctrl & 0x10) << 8) + names[row * 32 + coarse] * 16 + fine_y);
  int colour = (pattern_byte(at) >> bit & 1) | (pattern_byte(at + 8) >> bit & 1) << 1;
  if (!colour) return 0;
  int attribute = names[0x3C0 + (row >> 2) * 8 + (coarse >> 2)], shift = ((row & 2) << 1) | (coarse & 2);
  return colour | ((attribute >> shift) & 3) << 2;
}

// draws the line's pixels up to `upto`
static void draw_pixels(int upto) {
  uint8_t *out = picture + line_drawn * 256;
  for (int x = pixels_drawn; x < upto; x++) {
    int colour;
    if (!rendering()) colour = palette[0];
    else {
      int back = background_at(x), sprite = (mask & 0x10) && (x >= 8 || (mask & 0x04)) ? sprites[x] : 0;
      if ((sprite & 0x20) && (sprite & 3) && (back & 3) && x < 255 && hit_at < 0 && !(status & 0x40))
        hit_at = LINE0_AT + line_drawn * LINE + x + 1;
      if ((sprite & 3) && (!(sprite & 0x10) || !(back & 3))) colour = palette[0x10 | (sprite & 0x0F)];
      else colour = (back & 3) ? palette[back & 0x0F] : palette[0];
    }
    out[x] = (mask & 0x01) ? colour & 0x30 : colour;
  }
  pixels_drawn = upto;
}

// the sprites on the line after `line`, as the PPU finds them while it draws `line`
static void find_sprites(int line) {
  for (int x = 0; x < 256; x++) sprites[x] = 0;
  sprite_zero_line = 0;
  int height = (ctrl & 0x20) ? 16 : 8, found = 0;
  for (int i = 0; i < 64; i++) {
    int y = oam[i * 4], row = line - y;
    if (row < 0 || row >= height) continue;
    if (found == 8) { status |= 0x20; break; }
    found++;
    int tile = oam[i * 4 + 1], attributes = oam[i * 4 + 2], left = oam[i * 4 + 3];
    if (attributes & 0x80) row = height - 1 - row;
    uint16_t at;
    if (height == 16) at = (uint16_t)((tile & 1) * 0x1000 + ((tile & 0xFE) + (row >> 3)) * 16 + (row & 7));
    else at = (uint16_t)(((ctrl & 0x08) << 9) + tile * 16 + row);
    uint8_t low = pattern_byte(at), high = pattern_byte(at + 8);
    for (int column = 0; column < 8; column++) {
      int x = left + column;
      if (x > 255) break;
      int bit = (attributes & 0x40) ? column : 7 - column;
      int colour = (low >> bit & 1) | (high >> bit & 1) << 1;
      if (!colour || (sprites[x] & 3)) continue;
      sprites[x] = (uint8_t)(colour | (attributes & 3) << 2 | ((attributes & 0x20) ? 0x10 : 0) | (i == 0 ? 0x20 : 0));
      if (i == 0) sprite_zero_line = 1;
    }
  }
}

// the scroll's move down a line at the end of each, and back to the left edge
static void next_row(void) {
  if ((v & 0x7000) != 0x7000) v += 0x1000;
  else {
    v &= ~0x7000;
    int row = (v >> 5) & 0x1F;
    if (row == 29) { row = 0; v ^= 0x0800; }
    else if (row == 31) row = 0;
    else row++;
    v = (uint16_t)((v & ~0x03E0) | row << 5);
  }
}

// the PPU's own work up to dot `upto`: V-blank's flags, the scroll's copies and the lines
static void run_to(int upto) {
  if (upto > frame_length) upto = frame_length;
  if (dead) { done = upto; return; }
  while (done < upto) {
    if (done < VBLANK_AT) {
      if (upto < VBLANK_AT) { done = upto; break; }
      done = VBLANK_AT;
      status |= 0x80;
      continue;
    }
    if (done < CLEARED_AT) {
      if (upto < CLEARED_AT) { done = upto; break; }
      done = CLEARED_AT;
      status &= 0x1F;
      continue;
    }
    if (done < SCROLLED_AT) {
      if (upto < SCROLLED_AT) { done = upto; break; }
      done = SCROLLED_AT;
      if (rendering()) v = t;
      continue;
    }
    if (done < LINE0_AT) {
      if (upto < LINE0_AT) { done = upto; break; }
      done = LINE0_AT;
      line_drawn = 0;
      pixels_drawn = 0;
      line_v = v;
      line_from = 0;
      for (int x = 0; x < 256; x++) sprites[x] = 0;
      sprite_zero_line = 0;
      continue;
    }
    if (line_drawn >= 240) { done = upto; break; }
    int start = LINE0_AT + line_drawn * LINE;
    // the line's pixels, then at its end the scroll moves down, the next line's sprites are found, and the scroll goes
    // back to the left
    if (done < start + 256) {
      int to = upto < start + 256 ? upto : start + 256;
      draw_pixels(to - start);
      done = to;
      continue;
    }
    if (done < start + 262) {
      if (upto < start + 262) { done = upto; break; }
      done = start + 262;
      if (rendering()) {
        next_row();
        find_sprites(line_drawn);
      } else {
        for (int x = 0; x < 256; x++) sprites[x] = 0;
        sprite_zero_line = 0;
      }
      if (rendering()) v = (uint16_t)((v & ~0x041F) | (t & 0x041F));
      continue;
    }
    if (upto < start + LINE) { done = upto; break; }
    done = start + LINE;
    line_drawn++;
    pixels_drawn = 0;
    line_v = v;
    line_from = 0;
  }
}

// where the line being drawn takes its background from, after a write that moves it
static void restart_line(void) {
  if (dead || done < LINE0_AT || line_drawn >= 240) return;
  int start = LINE0_AT + line_drawn * LINE;
  if (done >= start + 256) return;
  line_v = v;
  line_from = pixels_drawn;
}

void nes_ppu_power(void) {
  for (int i = 0; i < 0x800; i++) ciram[i] = 0;
  for (int i = 0; i < 32; i++) palette[i] = 0;
  for (int i = 0; i < 256; i++) oam[i] = 0;
  ctrl = mask = status = oam_addr = fine_x = latch_w = buffer = 0;
  v = t = 0;
  for (int i = 0; i < 256 * 240; i++) picture[i] = 0;
}

void nes_ppu_frame_start(uint32_t frame) {
  // the kit's frame f is the emulator's f + 1, which the proof tools compare it with, as its picture shows what the
  // frame before worked out: the emulator's first two frames, the kit's frame 0 and the one before it, are dead
  dead = frame < 1;
  // and once the PPU is warm, every other frame is a dot short
  frame_length = nes_frame_length((int)frame);
  done = 0;
  hit_at = -1;
  line_drawn = 0;
  pixels_drawn = 0;
  now = dead ? 0 : NMI_AT + 21;
}

void nes_ppu_frame_end(void) {
  run_to(frame_length);
  // sprite 0's hit stays in $2002 until the next frame's V-blank ends
  if (hit_at >= 0) status |= 0x40;
  if (dead) for (int i = 0; i < 256 * 240; i++) picture[i] = 0;
  now = frame_length;
}

int nes_ppu_frame_length(void) { return frame_length; }

int nes_frame_length(int frame) { return frame < 1 ? nes_frame_dots : nes_frame_dots - ((frame - 1) & 1); }

void nes_ppu_write(uint16_t address, uint8_t value) {
  run_to(now);
  switch (address & 7) {
    case 0:
      ctrl = value;
      t = (uint16_t)((t & 0xF3FF) | (value & 3) << 10);
      break;
    case 1: mask = value; break;
    case 3: oam_addr = value; break;
    case 4: oam[oam_addr++] = value; break;
    case 5:
      if (!latch_w) {
        t = (uint16_t)((t & 0xFFE0) | value >> 3);
        fine_x = value & 7;
      } else t = (uint16_t)((t & 0x8C1F) | (value & 0xF8) << 2 | (value & 7) << 12);
      latch_w ^= 1;
      break;
    case 6:
      if (!latch_w) t = (uint16_t)((t & 0x00FF) | (value & 0x3F) << 8);
      else {
        t = (uint16_t)((t & 0xFF00) | value);
        v = t;
        restart_line();
      }
      latch_w ^= 1;
      break;
    case 7:
      vram_write(v, value);
      v = (uint16_t)((v + ((ctrl & 0x04) ? 32 : 1)) & 0x7FFF);
      break;
  }
}

uint8_t nes_ppu_read(uint16_t address) {
  run_to(now);
  switch (address & 7) {
    case 2: {
      if (hit_at >= 0 && now >= hit_at) status |= 0x40;
      uint8_t value = status;
      status &= 0x7F;
      latch_w = 0;
      return value;
    }
    case 4: return oam[oam_addr];
    case 7: {
      uint16_t at = v & 0x3FFF;
      uint8_t value;
      if (at >= 0x3F00) {
        value = palette[palette_index(at)];
        buffer = vram_read(at - 0x1000);
      } else {
        value = buffer;
        buffer = vram_read(at);
      }
      v = (uint16_t)((v + ((ctrl & 0x04) ? 32 : 1)) & 0x7FFF);
      return value;
    }
  }
  return 0;
}

void nes_oam_dma(const uint8_t *page) {
  run_to(now);
  for (int i = 0; i < 256; i++) oam[(uint8_t)(oam_addr + i)] = page[i];
}

void nes_spend(int cycles) {
  if (cycles > 0) now += cycles * 3;
  if (now > frame_length) now = frame_length;
}

void nes_wait_line(int line) {
  int at = LINE0_AT + line * LINE;
  if (at > now) now = at > frame_length ? frame_length : at;
}

int nes_wait_sprite0(void) {
  if (dead) { now = frame_length; return 0; }
  // the PPU draws on until sprite 0 hits, or the picture ends
  while (hit_at < 0 && done < LINE0_AT + 240 * LINE) run_to(done < LINE0_AT ? LINE0_AT : done + 1);
  if (hit_at < 0) {
    if (now < LINE0_AT + 240 * LINE) now = LINE0_AT + 240 * LINE;
    return 0;
  }
  if (now < hit_at) now = hit_at;
  return 1;
}

int nes_now(void) { return now; }

int nes_ppu_dot(void) { return now; }

void nes_ppu_draw(uint32_t *out) {
  for (int i = 0; i < 256 * 240; i++) {
    uint16_t c = COLOURS[picture[i] & 63];
    uint32_t r = c & 31, g = c >> 5 & 31, b = c >> 10 & 31;
    out[i] = 0xFF000000u | (b << 3 | b >> 2) << 16 | (g << 3 | g >> 2) << 8 | (r << 3 | r >> 2);
  }
}

void nes_ppu_wiring(void) {
  for (int i = 0; i < 8; i++) patterns[i] = nes_chr + (i * 0x400) % (nes_chr_size ? nes_chr_size : 0x2000);
}
