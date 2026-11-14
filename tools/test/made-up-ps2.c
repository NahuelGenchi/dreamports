// The small PlayStation 2 programs of tools/test/made-up-ps2.mjs as Dreamports in C, on the PlayStation 2's kit in C
// (kit/ps2/c/): the flat one, a square crossing a background, the one in three dimensions, two shaded triangles that
// cross, one turning, and the one whose square a program on vector unit 1 turns and gives the GS as a packet. Each gives
// the GS what its program gives it, in its order, so its draw list is the program's. The test fills in the numbers, which
// are the programs' own, and which program this is (ps2-kit.mjs).

#include "ps2.h"

#define FLAT 0
#define IN_3D 1
#define ON_VU1 2
#define PROGRAM @PROGRAM@
#define FBW (SCREEN_W / 64)
#define ONE 0x3F800000ull
// a corner as the GS takes it: where it is, in sixteenths of a pixel, and its depth
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)

static float of_bits(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

// the flat program's square, and the others' turning point
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
  x = PROGRAM == ON_VU1 ? 1 : @RADIUS@;
  y = 0;
}

#if PROGRAM == IN_3D
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
#elif PROGRAM == ON_VU1
// the square's corners, each a place and a colour, as the program has them in the unit's memory
static const float places[@CORNER_COUNT@][4] = @PLACES@;
static const uint32_t colours[@CORNER_COUNT@][4] = @COLOURS@;

// a register's number and its 64 bits, as a packet's data has them
static uint64_t *put(uint64_t *at, uint8_t reg, uint64_t value) {
  at[0] = value;
  at[1] = reg;
  return at + 2;
}

void game_step(uint32_t buttons) {
  const float cosine = of_bits(@COS_BITS@), sine = of_bits(@SIN_BITS@);
  // what the main processor gives the GS itself, as a packet through the GIF
  uint64_t before[2 + 11 * 2], *at = before + 2;
  before[0] = 11 | 0x8000 | 1ull << 60;
  before[1] = 0xE;
  at = put(at, GS_FRAME_1, (uint64_t)FBW << 16);
  at = put(at, GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
  at = put(at, GS_XYOFFSET_1, 0);
  at = put(at, GS_ZBUF_1, (SCREEN_W * SCREEN_H * 4 + 8191) / 8192);
  at = put(at, GS_PRMODECONT, 1);
  at = put(at, GS_TEST_1, 0x30000);
  at = put(at, GS_PRIM, 6);
  at = put(at, GS_RGBAQ, @BACKGROUND_3D@ | ONE << 32);
  at = put(at, GS_XYZ2, XYZ(0, 0, 0));
  at = put(at, GS_XYZ2, XYZ(SCREEN_W, SCREEN_H, 0));
  at = put(at, GS_TEST_1, 0x50000);
  gif_send(before, sizeof before);

  // the matrix as the main processor leaves it: its first two columns are the turn
  const vu_vector matrix[4] = { { .f = { x, y, 0, @DEPTH_ACROSS@ } }, { .f = { -y, x, 0, 0 } }, { .f = { 0, 0, 1, 0 } }, { .f = { @MIDDLE_X@, @MIDDLE_Y@, 0, 1 } } };
  // the program on vector unit 1, an instruction a line: each corner by the matrix, over its depth, in sixteenths
  struct { uint32_t tag[4]; struct { uint32_t colour[4]; vu_vector place; } corners[@CORNER_COUNT@]; } packet = { .tag = @VU1_TAG@ };
  vu_vector acc, turned, whole = { .u = { 0, 0, 0, 0 } };
  for (int i = 0; i < @CORNER_COUNT@; i++) {
    vu_vector place = { .f = { places[i][0], places[i][1], places[i][2], places[i][3] } };
    vu_mulf(&acc, &matrix[0], place.f[0], VU_XYZW);              // MULAx
    vu_maddf(&acc, &acc, &matrix[1], place.f[1], VU_XYZW);       // MADDAy
    vu_maddf(&acc, &acc, &matrix[2], place.f[2], VU_XYZW);       // MADDAz
    vu_maddf(&turned, &acc, &matrix[3], place.f[3], VU_XYZW);    // MADDw
    float q = ee_div(1, turned.f[3]);                            // DIV Q, vf0w, vf7w
#if @PLAIN_SUMS@
    // a computer's own division, which the test uses to see that the proof finds it
    q = 1 / turned.f[3];
#endif
    vu_mulf(&turned, &turned, q, VU_XYZ);                        // MULq
    vu_ftoi(&whole, &turned, 4, VU_XYZ);                         // FTOI4
    for (int c = 0; c < 4; c++) packet.corners[i].colour[c] = colours[i][c];
    packet.corners[i].place = whole;
  }
  gif_packet(&packet, sizeof packet);                            // XGKICK

  float next = ee_sub(ee_mul(x, cosine), ee_mul(y, sine));
  y = ee_add(ee_mul(x, sine), ee_mul(y, cosine));
  x = next;
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
