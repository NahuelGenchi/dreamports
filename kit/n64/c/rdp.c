// The RDP, the console's drawing chip: its command registers, and the commands it reads from RDRAM, or from the RSP's
// data memory when DPC_STATUS says so, from DPC_CURRENT up to DPC_END, two words or more each, a command the list ends
// partway through finished from the next. A full sync raises its interrupt once the list is drawn.
//
// What it draws so far is what a screen is cleared with: rectangles in fill mode, of the fill colour, into a colour
// image of 8, 16 or 32 bits, inside the scissor, on exactly the pixels the console's emulator, angrylion's, gives them:
// its edge walker is followed here for them, sub-line by sub-line. A fill rectangle that reads the image or the depth
// stops the RDP, as on the console. Every other command is taken with its words and draws nothing yet, triangles and
// textured rectangles among them, so `prove` finds the first frame that has one (kit/n64/c/README.md). Followed from
// angrylion-rdp-plus as libretro/parallel-n64 has it at 2d90e20fa140b104d810bc0ea289f6f382e5086a
// (mupen64plus-video-angrylion/n64video/rdp/rasterizer.c and fbuffer.c, and n64video.c's command list).

#include "n64-kit.h"

struct n64_dp n64_dp;

// every command's length in words, by its number
static int length_of(uint32_t id) {
  static const uint8_t triangles[8] = { 8, 12, 24, 28, 24, 28, 40, 44 };
  if (id >= 0x08 && id <= 0x0F) return triangles[id - 0x08];
  if (id == 0x24 || id == 0x25) return 4;
  return 2;
}

static struct rdp_state {
  uint32_t fill_color;
  uint32_t image_size, image_width, image_address;
  int clip_xh, clip_yh, clip_xl, clip_yl, field, keep_odd;
  int cycle_type, image_read, z_compare, z_update, z_source;
  int crashed;
} rdp;

// the command being gathered, and how many of its words it has and needs
static uint32_t command[44];
static int have, needs;

// a line's span, as the edge walker leaves it: its first and last pixel and whether it's drawn
static struct span { int lx, rx, valid; } spans[1025];

void rdp_power(void) {
  n64_dp = (struct n64_dp){ 0 };
  rdp = (struct rdp_state){ 0 };
  rdp.clip_xh = rdp.clip_yh = 0x2000;
  have = needs = 0;
  for (int i = 0; i < 1025; i++) spans[i] = (struct span){ 0, 0, 0 };
}

// A pixel of the colour image filled, at `pixel` from its start, as fill mode writes it: a 16-bit image takes the
// fill colour's halves in turn, an 8-bit one its bytes.
static void fill_pixel(uint32_t pixel) {
  if (rdp.image_size == 2) {
    uint32_t at = ((rdp.image_address >> 1) + pixel) & 0x3FFFFF;
    uint16_t value = (uint16_t)(at & 1 ? rdp.fill_color : rdp.fill_color >> 16);
    n64_rdram[at * 2] = (uint8_t)(value >> 8), n64_rdram[at * 2 + 1] = (uint8_t)value;
  } else if (rdp.image_size == 3) {
    uint32_t at = ((rdp.image_address >> 2) + pixel) & 0x1FFFFF;
    n64_put_be32(&n64_rdram[at * 4], rdp.fill_color);
  } else if (rdp.image_size == 1) {
    uint32_t at = (rdp.image_address + pixel) & 0x7FFFFF;
    n64_rdram[at] = (uint8_t)(rdp.fill_color >> (((at & 3) ^ 3) << 3));
  }
}

// One side of a line at a sub-line, `x` in 16.16, as the edge walker places it against the scissor: its place in 13.3,
// and whether it was past the scissor's left or right.
static int scissored(int32_t x, int *under, int *over) {
  int32_t left = rdp.clip_xh << 1, right = rdp.clip_xl << 1;
  int32_t sticky = ((x >> 1) & 0x1FFF) > 0;
  int32_t place = ((x >> 13) & 0x1FFE) | sticky;
  *under = (x & 0x8000000) || (place < left && !(x & 0x4000000));
  place = *under ? left : (((x >> 13) & 0x3FFE) | sticky);
  *over = (place & 0x2000) || (place & 0x1FFF) >= right;
  return *over ? right : place;
}

// A rectangle, its corners in 10.2, walked as angrylion walks one: each line's four sub-lines placed against the
// scissor, and the line drawn from its rightmost left edge to its leftmost right one. A rectangle's major edge is on
// its left, so its x's are the same on every line.
static void walk_rectangle(int xl, int yl, int xh, int yh) {
  int32_t xright = (int32_t)((uint32_t)((xh >> 2) & 0x3FF) << 16 | (uint32_t)(xh & 3) << 14) & ~1;
  int32_t xleft = (int32_t)((uint32_t)((xl >> 2) & 0x3FF) << 16 | (uint32_t)(xl & 3) << 14) & ~1;
  int ycur = yh & ~3;
  int yllimit = (yl & 0x2000) ? 1 : (yl & 0x1000) ? 0 : (yl & 0xFFF) < rdp.clip_yl;
  yllimit = yllimit ? yl : rdp.clip_yl;
  int ylfar = yllimit | 3;
  if ((yl >> 2) > (ylfar >> 2)) ylfar += 4;
  else if ((yllimit >> 2) >= 0 && (yllimit >> 2) < 1023) spans[(yllimit >> 2) + 1].valid = 0;
  int yhlimit = (yh & 0x2000) ? 0 : (yh & 0x1000) ? 1 : yh >= rdp.clip_yh;
  yhlimit = yhlimit ? yh : rdp.clip_yh;
  int yhclose = yhlimit & ~3;
  for (int j = ycur >> 2; j <= ylfar >> 2 && j <= 1024; j++) {
    int max_left = 0, min_right = 0xFFF, all_over = 1, all_under = 1, all_invalid = 1;
    for (int k = j << 2, sub = 0; sub < 4; sub++, k++) {
      if (k < yhclose) continue;
      int invalid = k < yhlimit || k >= yllimit, under, over;
      int right = scissored(xright, &under, &over);
      all_over &= over, all_under &= under;
      int left = scissored(xleft, &under, &over);
      all_over &= over, all_under &= under;
      invalid |= ((xleft ^ 0x8000000) & (0x3FFF << 14)) < ((xright ^ 0x8000000) & (0x3FFF << 14));
      all_invalid &= invalid;
      if (!invalid) {
        if (((left >> 3) & 0xFFF) > max_left) max_left = (left >> 3) & 0xFFF;
        if (((right >> 3) & 0xFFF) < min_right) min_right = (right >> 3) & 0xFFF;
      }
      if (sub == 3) {
        spans[j].lx = max_left, spans[j].rx = min_right;
        spans[j].valid = !all_invalid && !all_over && !all_under && (!rdp.field || !(rdp.keep_odd ^ (j & 1)));
      }
    }
  }
  // the lines, in fill mode
  for (int line = yhlimit >> 2; line <= yllimit >> 2 && line <= 1024; line++) {
    if (!spans[line].valid) continue;
    int length = spans[line].lx - spans[line].rx;
    if (length >= 0 && (rdp.image_read || rdp.z_compare)) {
      rdp.crashed = 1;
      return;
    }
    for (int x = spans[line].rx, i = 0; i <= length; i++, x++) fill_pixel(rdp.image_width * (uint32_t)line + (uint32_t)x);
    if (length >= 0 && rdp.z_update && !rdp.z_source && !(rdp.image_read || rdp.z_compare)) {
      rdp.crashed = 1;
      return;
    }
  }
}

static int synced;

static void run_command(const uint32_t *w) {
  switch ((w[0] >> 24) & 0x3F) {
  case 0x29: synced = 1; break; // a full sync
  case 0x2D: // the scissor
    rdp.clip_xh = (w[0] >> 12) & 0xFFF, rdp.clip_yh = w[0] & 0xFFF, rdp.clip_xl = (w[1] >> 12) & 0xFFF, rdp.clip_yl = w[1] & 0xFFF;
    rdp.field = (w[1] >> 25) & 1, rdp.keep_odd = (w[1] >> 24) & 1;
    break;
  case 0x2F: // other modes
    rdp.cycle_type = (w[0] >> 20) & 3;
    rdp.z_source = (w[1] >> 2) & 1, rdp.z_compare = (w[1] >> 4) & 1, rdp.z_update = (w[1] >> 5) & 1, rdp.image_read = (w[1] >> 6) & 1;
    break;
  case 0x36: { // a rectangle filled
    if (rdp.cycle_type != 3) break;
    if (rdp.image_size == 0) {
      rdp.crashed = 1;
      break;
    }
    walk_rectangle((w[0] >> 12) & 0xFFF, (w[0] & 0xFFF) | 3, (w[1] >> 12) & 0xFFF, w[1] & 0xFFF);
    break;
  }
  case 0x37: rdp.fill_color = w[1]; break;
  case 0x3F: // the colour image
    rdp.image_size = (w[0] >> 19) & 3, rdp.image_width = (w[0] & 0x3FF) + 1, rdp.image_address = w[1] & 0xFFFFFF;
    break;
  }
}

// the commands from DPC_CURRENT to DPC_END
static void run_list(void) {
  uint32_t at = (n64_dp.current & 0xFFFFF8) >> 2, end = (n64_dp.end & 0xFFFFF8) >> 2;
  if (rdp.crashed || end <= at) return;
  synced = 0;
  while (at < end && !rdp.crashed) {
    uint32_t word;
    if (n64_dp.status & DPC_XBUS) word = n64_be32(&n64_sp_mem[(at & 0x3FF) * 4]);
    else word = at * 4 < N64_RDRAM_SIZE ? n64_be32(&n64_rdram[at * 4]) : 0;
    at++;
    if (have == 0) needs = length_of((word >> 24) & 0x3F);
    command[have++] = word;
    if (have == needs) {
      run_command(command);
      have = 0;
    }
  }
  n64_dp.current = at << 2;
  if (synced) n64_interrupt(MI_INTR_DP);
}

void rdp_write(uint32_t reg, uint32_t value) {
  switch (reg & 0x1F) {
  case 0x00: n64_dp.start = n64_dp.current = value & 0xFFFFF8; break;
  case 0x04: n64_dp.end = value & 0xFFFFF8; run_list(); break;
  case 0x0C:
    if (value & 0x001) n64_dp.status &= ~(uint32_t)DPC_XBUS;
    if (value & 0x002) n64_dp.status |= DPC_XBUS;
    if (value & 0x004) n64_dp.status &= ~(uint32_t)DPC_FREEZE;
    if (value & 0x008) n64_dp.status |= DPC_FREEZE;
    if (value & 0x010) n64_dp.status &= ~(uint32_t)DPC_FLUSH;
    if (value & 0x020) n64_dp.status |= DPC_FLUSH;
    if (value & 0x200) n64_dp.clock = 0;
    break;
  }
}

uint32_t rdp_read(uint32_t reg) {
  switch (reg & 0x1F) {
  case 0x00: return n64_dp.start;
  case 0x04: return n64_dp.end;
  case 0x08: return n64_dp.current;
  case 0x0C: return n64_dp.status;
  case 0x10: return n64_dp.clock;
  case 0x14: return n64_dp.bufbusy;
  case 0x18: return n64_dp.pipebusy;
  case 0x1C: return n64_dp.tmem;
  }
  return 0;
}
