// The GameCube's video interface, as Dolphin, the console's reference in the proof tools, shows it: its registers, and
// each frame a field of the picture, every other line of the framebuffer the game points it at, the top field's lines
// from the top address and the bottom field's from the bottom one. The framebuffer holds two pixels in each word, their
// brightness and the colour differences they share, Y, Cb, Y and Cr, and the console's video encoder makes the
// television's signal from them, so red, green and blue are worked out as the reference works them out: in single
// floats, by the sums of the standard for television pictures, ITU-R BT.601, cut to whole numbers.
//
// The console sends a television a field every sixtieth of a second, and the tools count a frame for each. Which field
// a frame shows follows how the console was started: a disc boots a frame sooner than a program given alone, so its
// game's first frame shows the bottom field and a program's the top one, and they alternate from there, as the
// reference shows them. The kit keeps no time within a field: a read of where the beam is gives the first line.

#pragma STDC FP_CONTRACT OFF

#include "gamecube-kit.h"

static uint16_t regs[0x80];
static unsigned field;

void vi_power(int started_by_disc) {
  for (int i = 0; i < 0x80; i++) regs[i] = 0;
  field = started_by_disc ? 1 : 0;
}

uint16_t vi_read(uint32_t reg) {
  reg &= 0xFE;
  // where the beam is, which the kit doesn't count: the first line, and the first pixel of it
  if (reg == 0x2C || reg == 0x2E) return 1;
  return regs[reg >> 1];
}

void vi_write(uint32_t reg, uint16_t value) {
  reg &= 0xFE;
  if (reg == 0x2C || reg == 0x2E) return;
  regs[reg >> 1] = value;
}

static uint8_t memory(uint32_t at) { return at < GC_RAM_SIZE ? gc_ram[at] : 0; }
// a colour the encoder makes, cut to a byte as the reference does: toward zero, then to 0 to 255
static uint32_t cut(float value) {
  int whole = (int)value;
  return (uint32_t)(whole < 0 ? 0 : whole > 255 ? 255 : whole);
}
static uint32_t pixel(int y, int u, int v) {
  float luma = 1.164f * (float)y;
  uint32_t r = cut(luma + 1.596f * (float)v);
  float green = luma - 0.392f * (float)u;
  uint32_t g = cut(green - 0.813f * (float)v);
  uint32_t b = cut(luma + 2.017f * (float)u);
  return 0xFF000000u | b << 16 | g << 8 | r;
}

void vi_field(void) {
  int top = field % 2 == 0;
  field++;
  // the top framebuffer's address and the bottom one's, each in 32-byte steps when the top register says so
  uint32_t top_hi = regs[0x1C >> 1], bottom_hi = regs[0x24 >> 1];
  uint32_t top_base = (top_hi & 0xFF) << 16 | regs[0x1E >> 1], bottom_base = (bottom_hi & 0xFF) << 16 | regs[0x26 >> 1];
  int pages = (top_hi >> 12) & 1;
  uint32_t address = top ? top_base : bottom_base;
  if (pages) address <<= 5;
  // how wide the picture is and how far one of its lines is from the next, in 16-byte steps, and how many lines a field has
  uint32_t stride = (regs[0x48 >> 1] & 0xFF) * 16 * 2, width = ((regs[0x48 >> 1] >> 8) & 0x7F) * 16;
  uint32_t lines = (regs[0x00 >> 1] >> 4) & 0x3FF;
  // a field with no framebuffer, or none to show, leaves the last picture there, as the reference shows nothing new
  if (!address || !width || !lines) return;
  uint32_t *screen = kit_screen((int)width, (int)lines);
  for (uint32_t line = 0; line < lines; line++) {
    uint32_t at = address + line * stride;
    for (uint32_t x = 0; x < width; x += 2, at += 4) {
      int y1 = (int)memory(at) - 16, u = (int)memory(at + 1) - 128, y2 = (int)memory(at + 2) - 16, v = (int)memory(at + 3) - 128;
      screen[line * width + x] = pixel(y1, u, v);
      screen[line * width + x + 1] = pixel(y2, u, v);
    }
  }
}

void gc_show(void) {}
