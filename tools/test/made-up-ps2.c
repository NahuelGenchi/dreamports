// The small PlayStation 2 programs of tools/test/made-up-ps2.mjs as Dreamports in C, on the PlayStation 2's kit in C
// (kit/ps2/c/): the flat one, a square crossing a background, and with IN_3D the one in three dimensions, two shaded
// triangles that cross, one turning. Each writes the GS what its program writes, in its order, so its draw list is the
// program's. The test fills in the numbers, which are the programs' own (ps2-kit.mjs).

#include "ps2.h"

#define IN_3D @IN_3D@
#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
// a corner as the GS takes it: where it is, in sixteenths of a pixel, and its depth
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

static float of_bits(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

static int32_t square_x;
static float x, y;

void game_start(void) {
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, FBW << 9);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);
  x = @RADIUS@;
  y = 0;
}

#if IN_3D
static const uint32_t still[3][4] = @STILL@;
static const uint32_t turning[3][2] = @TURNING@;

// a corner at the middle plus or minus two of the point's parts, cut to whole sixteenths as the EE cuts a float
static uint64_t corner(float across, float down, uint32_t depth) {
  return (uint64_t)((uint32_t)(ee_to_int(across) & 0xFFFF) | (uint32_t)ee_to_int(down) << 16) | (uint64_t)depth << 32;
}

void game_step(uint32_t buttons) {
  const float cosine = of_bits(@COS_BITS@), sine = of_bits(@SIN_BITS@), middle_x = @MIDDLE_X@ * 16, middle_y = @MIDDLE_Y@ * 16;
  float xs = ee_mul(x, 16), ys = ee_mul(y, 16);
  uint64_t corners[3] = {
    corner(ee_add(middle_x, xs), ee_add(middle_y, ys), turning[0][1]),
    corner(ee_sub(middle_x, ys), ee_add(middle_y, xs), turning[1][1]),
    corner(ee_sub(middle_x, xs), ee_sub(middle_y, ys), turning[2][1]),
  };
  gs_write(GS_FRAME_1, (uint64_t)FBW << 16);
  gs_write(GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
  gs_write(GS_XYOFFSET_1, 0);
  gs_write(GS_ZBUF_1, (SCREEN_W * SCREEN_H * 4 + 8191) / 8192);
  gs_write(GS_PRMODECONT, 1);
  // every pixel passes, to clear the picture and the depths
  gs_write(GS_TEST_1, 0x30000);
  gs_write(GS_PRIM, 6);
  gs_write(GS_RGBAQ, @BACKGROUND_3D@ | ONE << 32);
  gs_write(GS_XYZ2, XYZ(0, 0, 0));
  gs_write(GS_XYZ2, XYZ(SCREEN_W, SCREEN_H, 0));
  // a pixel passes when it's as near or nearer, and the triangles are shaded between their corners
  gs_write(GS_TEST_1, 0x50000);
  gs_write(GS_PRIM, 0xB);
  for (int i = 0; i < 3; i++) {
    gs_write(GS_RGBAQ, still[i][2] | ONE << 32);
    gs_write(GS_XYZ2, XYZ(still[i][0], still[i][1], still[i][3]));
  }
  for (int i = 0; i < 3; i++) {
    gs_write(GS_RGBAQ, turning[i][0] | ONE << 32);
    gs_write(GS_XYZ2, corners[i]);
  }
  // the turn
  float turned = ee_sub(ee_mul(x, cosine), ee_mul(y, sine));
#if @PLAIN_SUMS@
  // a computer's own rounding, which the test uses to see that the proof finds it
  turned = x * cosine - y * sine;
#endif
  y = ee_add(ee_mul(x, sine), ee_mul(y, cosine));
  x = turned;
}
#else
void game_step(uint32_t buttons) {
  gs_write(GS_FRAME_1, (uint64_t)FBW << 16);
  gs_write(GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
  gs_write(GS_XYOFFSET_1, 0);
  gs_write(GS_TEST_1, 0x30000);
  gs_write(GS_ZBUF_1, 1ull << 32);
  gs_write(GS_PRMODECONT, 1);
  gs_write(GS_PRIM, 6);
  gs_write(GS_RGBAQ, @BACKGROUND@ | ONE << 32);
  gs_write(GS_XYZ2, XYZ(0, 0, 0));
  gs_write(GS_XYZ2, XYZ(SCREEN_W, SCREEN_H, 0));
  gs_write(GS_RGBAQ, @SQUARE@ | ONE << 32);
  gs_write(GS_XYZ2, XYZ(square_x, @SQUARE_Y@, 0));
  gs_write(GS_XYZ2, XYZ(square_x + @SQUARE_SIZE@, @SQUARE_Y@ + @SQUARE_SIZE@, 0));
  square_x = (square_x + @STEP@) & 511;
}
#endif

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
