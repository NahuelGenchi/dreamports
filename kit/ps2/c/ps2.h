// The PlayStation 2's kit in C, on what every console's kit in C shares (kit/c/README.md). A game writes the console's
// graphics chip, the GS, as its original does, and does its float sums as the console's processor, the EE, does them.
// What it writes each frame is its draw list, which is what a 3D game is proven by (docs/STANDARD.md), and the kit draws
// that list for the page (kit/ps2/c/README.md).

#ifndef DREAMPORTS_PS2_H
#define DREAMPORTS_PS2_H

#include "console.h"

// the GS's registers a game writes, by their numbers
enum {
  GS_PRIM = 0x00, GS_RGBAQ = 0x01, GS_ST = 0x02, GS_UV = 0x03, GS_XYZF2 = 0x04, GS_XYZ2 = 0x05, GS_TEX0_1 = 0x06,
  GS_TEX0_2 = 0x07, GS_CLAMP_1 = 0x08, GS_CLAMP_2 = 0x09, GS_FOG = 0x0A, GS_XYZF3 = 0x0C, GS_XYZ3 = 0x0D,
  GS_TEX1_1 = 0x14, GS_TEX1_2 = 0x15, GS_TEX2_1 = 0x16, GS_TEX2_2 = 0x17, GS_XYOFFSET_1 = 0x18, GS_XYOFFSET_2 = 0x19,
  GS_PRMODECONT = 0x1A, GS_PRMODE = 0x1B, GS_TEXCLUT = 0x1C, GS_SCANMSK = 0x22, GS_MIPTBP1_1 = 0x34, GS_MIPTBP1_2 = 0x35,
  GS_MIPTBP2_1 = 0x36, GS_MIPTBP2_2 = 0x37, GS_TEXA = 0x3B, GS_FOGCOL = 0x3D, GS_TEXFLUSH = 0x3F, GS_SCISSOR_1 = 0x40,
  GS_SCISSOR_2 = 0x41, GS_ALPHA_1 = 0x42, GS_ALPHA_2 = 0x43, GS_DIMX = 0x44, GS_DTHE = 0x45, GS_COLCLAMP = 0x46,
  GS_TEST_1 = 0x47, GS_TEST_2 = 0x48, GS_PABE = 0x49, GS_FBA_1 = 0x4A, GS_FBA_2 = 0x4B, GS_FRAME_1 = 0x4C,
  GS_FRAME_2 = 0x4D, GS_ZBUF_1 = 0x4E, GS_ZBUF_2 = 0x4F, GS_BITBLTBUF = 0x50, GS_TRXPOS = 0x51, GS_TRXREG = 0x52,
  GS_TRXDIR = 0x53, GS_HWREG = 0x54, GS_SIGNAL = 0x60, GS_FINISH = 0x61, GS_LABEL = 0x62,
};
// where the EE sees the GS's privileged registers, which say what the screen shows: each is 64 bits, written as two halves
enum { GS_PMODE = 0x12000000, GS_SMODE2 = 0x12000020, GS_DISPFB1 = 0x12000070, GS_DISPLAY1 = 0x12000080, GS_DISPFB2 = 0x12000090, GS_DISPLAY2 = 0x120000A0, GS_BGCOLOR = 0x120000E0 };

/** Writes one of the GS's registers, as a GIF packet's address and data does. */
void gs_write(uint8_t reg, uint64_t value);
/** Sends the GS a picture's data, `length` bytes, as a GIF packet in IMAGE mode does. */
void gs_image(const void *data, uint32_t length);
/** Writes half of a privileged register: the 32 bits at `address`, the low half at the register's own or the high 4 on. */
void gs_screen(uint32_t address, uint32_t value);
/** Paints the page's picture with what the screen shows of the framebuffer, at the console's size. For game_draw. */
void gs_show(void);

// The EE's float sums: each result is cut towards zero, where a computer rounds to the nearest, so a sum done with a
// plain + lands a last bit away, and a turning model's corner is a sixteenth of a pixel out within a hundred frames.
float ee_add(float a, float b);
float ee_sub(float a, float b);
float ee_mul(float a, float b);
/** A float as a whole number, what's after its point dropped, as the EE's CVT.W.S makes it. */
int32_t ee_to_int(float value);

#endif
