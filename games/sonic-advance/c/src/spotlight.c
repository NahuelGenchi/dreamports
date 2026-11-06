// A spotlight's beam, translated from front/spotlight.js (SAT-R's CreateSpotlightBeamTask and Task_SpotlightBeam, as
// Sonic Advance's own code has them, asm/non_matching/game/shared/stage/sa1_Task_SpotlightBeam.inc). A beam is a
// window shaped like a wedge from a point below the screen, swinging back and forth: its angle swings one way while it
// is under half a turn and the other way past it, and its two edges are drawn into the window's sides a line at a time.

#include "sa.h"

#define BEAM_PRIORITY 0x2000

// tan of a 1024-step angle in 8.8, from the sine table's 8.8 values
static int tan8(int a) { return s16(bios_div((SINE[a] >> 6) << 8, SINE[a + 0x100] >> 6)); }
// the angle an edge that leaves the screen's side is measured at
static int side_angle(int a) { return (a > 0xFF ? a - 0x300 : 0x100 - a) & 0x3FF; }

static void beam_destroyed(Task *t) { (void)t; e.flags &= ~FLAGS_HBLANK_COPY; }
static void spotlight_beam(Task *t);

/**
 * CreateSpotlightBeamTask: `unk0` is the beam's angle (1024 a turn), `unk2` how fast its swing changes and `unk4` the
 * swing (8.8), (`unk6`, `unk8`) the point it comes from, `bg` which window it is (as the H-blank effects number them: 2
 * is window 0's, 3 window 1's) and `unkB` how wide it is.
 */
Task *create_spotlight_beam(Beam *beam) {
  beam->unk0 = 0; beam->unk2 = 64; beam->unk4 = 0x800; beam->unk6 = 120; beam->unk8 = 200; beam->bg = 0; beam->unkB = 32;
  return create_task(spotlight_beam, beam, BEAM_PRIORITY, 0, beam_destroyed);
}

// where one edge of the beam, at angle `a`, meets the screen: (x, y) on its top or one of its sides
static void edge_end(const Beam *b, int a, int x, int *ex, int *ey) {
  if (x <= 0) { *ex = 0; *ey = s16(b->unk8 - ((b->unk6 * tan8(side_angle(a))) >> 8)); }
  else if (x > 0xEF) { *ex = 0xF0; *ey = s16(b->unk8 - (((0xF0 - b->unk6) * tan8(side_angle(a))) >> 8)); }
  else { *ex = x; *ey = 0; }
}

// Task_SpotlightBeam
static void spotlight_beam(Task *t) {
  Beam *b = t->data;
  b->unk4 = s16((b->unk0 & 0xFFFF) > 0x1FF ? b->unk2 + b->unk4 : b->unk4 - b->unk2);
  b->unk0 = ((b->unk4 >> 8) + (b->unk0 & 0xFFFF)) & 0x3FF;
  int a0 = (b->unk0 + b->unkB) & 0x3FF;
  if (SINE[a0 + 0x100] == 0) return;
  // the edges as [x0, y0, x1, y1] where they meet the screen's top or side, then its bottom, as bytes
  uint8_t p[8];
  int x0, y0, x1, y1;
  edge_end(b, a0, s16(b->unk6 - ((b->unk8 * tan8(a0)) >> 8)), &x0, &y0);
  p[0] = (uint8_t)x0; p[1] = (uint8_t)y0;
  p[2] = (uint8_t)((b->unk6 & 0xFF) - (((b->unk8 - 0xA0) * tan8(a0)) >> 8));
  p[3] = 0xA0;
  int a1 = (0x400 - ((b->unk0 & 0xFFFF) - b->unkB)) & 0x3FF;
  edge_end(b, a1, s16(((b->unk8 * tan8(a1)) >> 8) + (b->unk6 & 0xFFFF)), &x1, &y1);
  p[4] = (uint8_t)x1; p[5] = (uint8_t)y1;
  p[6] = (uint8_t)((((b->unk8 - 0xA0) * tan8(a1)) >> 8) + (b->unk6 & 0xFF));
  p[7] = 0xA0;
#define TOP(y) (e.winRegs[b->bg & 1 ? 3 : 2] = (uint16_t)(((y) << 8) | 0xA0))
  if ((b->unk0 & 0xFFFF) <= 0x1FF) {
    if (y1 > 0x9F) return;
    TOP(p[5]);
    if (y0 > 0x9F) window_right(b->bg, p[4], p[5], p[6], p[7], 0);
    else window_between(b->bg, p);
  } else {
    if (y0 > 0x9F) return;
    TOP(p[1]);
    if (y1 > 0x9F) window_left(b->bg, p[0], p[1], p[2], p[3], 0);
    else window_between(b->bg, p);
  }
#undef TOP
}
