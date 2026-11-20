// What the kit's GPU draws with: Exophase's psx_gpu, the GPU PCSX ReARMed draws a game with, carried in psx_gpu/ as
// that emulator has it (psx_gpu/NOTICE.md), so a Dreamport's polygons, lines, rectangles, textures, shading,
// dithering and mixing come out as the emulator's, pixel for pixel. It's built as the emulator builds it, psx_gpu.c and
// psx_gpu_parse.c together with the same settings (plugins/gpu_neon/psx_gpu_if.c), its drawing commands given as the
// emulator gives them, and with the same video memory: twice the console's, its first pixel 4 KB in. gpu.c gathers
// each command and moves pictures into video memory itself, and tells psx_gpu when one does.

#include <stdint.h>
#include "psx_gpu/compiler_features.h"
#include "ps1-kit.h"

#define ARRAY_SIZE(x) (sizeof(x) / sizeof((x)[0]))
#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#endif
#ifndef max
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif

// how many words each drawing command has after its first, as the emulator's gpulib says
extern const unsigned char cmd_lengths[256];
#define command_lengths cmd_lengths

#define PCSX
// as the core's makefile builds psx_gpu_if.c: the textures of 4 and 8 bits kept as psx_gpu caches them
#define TEXTURE_CACHE_4BPP
#define TEXTURE_CACHE_8BPP

// the emulator's copy of video memory at a larger size, which the kit doesn't keep
static void sync_enhancement_buffers(int x, int y, int w, int h) {}

EMULATOR_CODE
#include "psx_gpu/gpu.h"
#include "psx_gpu/psx_gpu.c"
#include "psx_gpu/psx_gpu_parse.c"
END_EMULATOR_CODE

// PCSX ReARMed's plugins/gpulib/gpu.c, at the commit tools/consoles.mjs fixes (GPL-2.0-or-later or LGPL-2.1-or-later)
const unsigned char cmd_lengths[256] = {
  0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 3, 3, 3, 6, 6, 6, 6, 4, 4, 4, 4, 8, 8, 8, 8,
  5, 5, 5, 5, 8, 8, 8, 8, 7, 7, 7, 7, 11, 11, 11, 11,
  2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4,
  2, 2, 2, 2, 3, 3, 3, 3, 1, 1, 1, 1, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
};

// A textured quad that lines up with the screen and its texture, pixel for pixel, the emulator draws as one textured
// rectangle, which samples its texture as the console does, where two of psx_gpu's triangles could land a texel off
// (PCSX ReARMed's plugins/gpulib/prim.c, built with GPU_NEON as the core is): written here from what that file
// decides, for psx_gpu_parse.c, which asks before it draws one. A corner's place and its texture's are 16 bits each.
static int16_t x_of(uint32_t word) { return (int16_t)(word & 0xFFFF); }
static int16_t y_of(uint32_t word) { return (int16_t)(word >> 16); }
static int u_of(uint32_t word) { return word & 0xFF; }
static int v_of(uint32_t word) { return word >> 8 & 0xFF; }

// the rectangle the quad is, into `out` as GP0 64's four words, its colour and kind from `first`: 1, or 0 when it
// isn't one, its corners in the order the console takes them, top left, top right, bottom left, bottom right
static int as_rectangle(uint32_t *out, uint32_t first, const uint32_t *xy[4], const uint32_t *uv[4]) {
  if (y_of(*xy[0]) != y_of(*xy[1]) || x_of(*xy[0]) != x_of(*xy[2]) || y_of(*xy[2]) != y_of(*xy[3]) || x_of(*xy[1]) != x_of(*xy[3])) return 0;
  if (v_of(*uv[0]) != v_of(*uv[1]) || u_of(*uv[0]) != u_of(*uv[2]) || v_of(*uv[2]) != v_of(*uv[3]) || u_of(*uv[1]) != u_of(*uv[3])) return 0;
  int across = x_of(*xy[1]) - x_of(*xy[0]), down = y_of(*xy[2]) - y_of(*xy[0]);
  if (down < 0 || across != u_of(*uv[1]) - u_of(*uv[0]) || down != v_of(*uv[2]) - v_of(*uv[0])) return 0;
  // a quad drawn right to left starts at its second corner
  int from = across < 0;
  out[0] = (first & 0x03FFFFFF) | 0x64000000;
  out[1] = *xy[from];
  out[2] = (*uv[from] & 0xFFFF) | (*uv[0] & 0xFFFF0000);
  out[3] = (uint32_t)down << 16 | (uint32_t)(across < 0 ? -across : across);
  return 1;
}

// GP0 2C to 2F: a flat textured quad
int prim_try_simplify_quad_t(void *simplified, const void *prim) {
  const uint32_t *w = prim;
  const uint32_t *xy[4] = { w + 1, w + 3, w + 5, w + 7 }, *uv[4] = { w + 2, w + 4, w + 6, w + 8 };
  return as_rectangle(simplified, w[0], xy, uv);
}

// GP0 3C to 3F: a shaded textured quad, which is one rectangle only when its texture isn't shaded, or its corners'
// colours are the same to 5 bits each
int prim_try_simplify_quad_gt(void *simplified, const void *prim) {
  const uint32_t *w = prim;
  const uint32_t *xy[4] = { w + 1, w + 4, w + 7, w + 10 }, *uv[4] = { w + 2, w + 5, w + 8, w + 11 };
  if (!(w[0] & 1u << 24) && ((w[0] ^ w[3]) | (w[0] ^ w[6]) | (w[0] ^ w[9])) & 0xF8F8F8) return 0;
  return as_rectangle(simplified, w[0], xy, uv);
}

static psx_gpu_struct egpu __attribute__((aligned(256)));
// video memory as the emulator lays it out: twice the console's 1 MB, and 4 KB before it
static uint16_t vram_area[2048 + 1024 * 512 * 2] __attribute__((aligned(64)));
uint16_t (*const gpu_vram)[1024] = (uint16_t (*)[1024])(vram_area + 2048);
// the drawing settings, E1 to E6, as the emulator keeps them beside psx_gpu
static uint32_t ex_regs[8];

void draw_power(void) {
  for (unsigned i = 0; i < ARRAY_SIZE(vram_area); i++) vram_area[i] = 0;
  for (int i = 0; i < 8; i++) ex_regs[i] = 0xE0000000u | (uint32_t)i << 24;
  initialize_psx_gpu(&egpu, vram_area + 2048);
  // the core's own dithering, "enabled": as a game asks, never forced
  egpu.allow_dithering = 1;
  egpu.force_dithering = 0;
}

void draw_commands(uint32_t *words, int count) {
  s32 cycles_sum = 0, cycles_last = 0;
  u32 last = 0;
  gpu_parse(&egpu, words, (u32)count * 4, ex_regs, &cycles_sum, &cycles_last, &last);
}

void draw_reset(void) {
  // the six drawing settings as a reset leaves them, given to psx_gpu, as the emulator does
  for (int i = 0; i < 8; i++) ex_regs[i] = 0xE0000000u | (uint32_t)i << 24;
  draw_commands(ex_regs + 1, 6);
}

uint32_t draw_mask_bits(void) { return ex_regs[6] & 3; }

void draw_flush(void) { flush_render_block_buffer(&egpu); }

void draw_vram_changed(int x, int y, int w, int h) { update_texture_cache_region(&egpu, x, y, x + w - 1, y + h - 1); }
