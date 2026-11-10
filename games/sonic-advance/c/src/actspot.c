// Secret Base act 1's spotlights, translated from the JavaScript version's engine/spotlights.js (SAT-R's
// spot_lights_manager.c and spot_light_beam_task.c, with the beams' triangles from src/bg_triangles.c): two windows
// whose edges sweep across the screen, and a brightness decrease that darkens everything outside them but the
// backdrop. The windows' edges are this frame's half of the engine's H-blank table, which lines.c writes.

#include "sa.h"
#include "act.h"

#define FADE_X 1368
#define GONE_X 1488
#define MIN_BLEND (8 * 256)

typedef struct { int swing, accel, speed, x, y, half, spread; } LightBeam;

static struct {
  int active, fading, qBlend;
  LightBeam beams[2];
} spot;

static int tan8(int a) { return s16(bios_div((SINE[a] >> 6) << 8, SINE[a + 0x100] >> 6)); }
static int mul8(int a, int b) { return (int)(((int32_t)s16(a) * b) >> 8); }

// where one side of a beam meets the screen: the top, or the left or the right edge and the line it crosses there
static void side(const LightBeam *b, int x, int angle, int *sx, int *sy) {
  if (x > 0 && x <= 239) { *sx = x; *sy = 0; return; }
  int t = (angle > 0xFF ? angle - 0x300 : 0x100 - angle) & 0x3FF;
  *sx = x <= 0 ? 0 : 240;
  *sy = s16(b->y - mul8(tan8(t), x <= 0 ? b->x : 240 - b->x));
}

// Task_SpotlightBeam: the beam's two sides this frame, the window they make and its WIN0V or WIN1V
static void beam_frame(LightBeam *b) {
  b->speed = s16(b->swing <= 0x1FF ? b->speed - b->accel : b->accel + b->speed);
  b->swing = ((b->speed >> 8) + b->swing) & 0x3FF;
  int a = (b->swing + b->spread) & 0x3FF;
  if (SINE[a + 0x100] == 0) return;
  uint8_t p[8];
  int x0, y0, x1, y1;
  side(b, s16(b->x - mul8(tan8(a), b->y)), a, &x0, &y0);
  p[0] = (uint8_t)x0; p[1] = (uint8_t)y0;
  p[2] = (uint8_t)((b->x & 0xFF) - mul8(tan8(a), b->y - 160));
  p[3] = 160;
  int c = (0x400 - (b->swing - b->spread)) & 0x3FF;
  side(b, s16(mul8(tan8(c), b->y) + b->x), c, &x1, &y1);
  p[4] = (uint8_t)x1; p[5] = (uint8_t)y1;
  p[6] = (uint8_t)(mul8(tan8(c), b->y - 160) + (b->x & 0xFF));
  p[7] = 160;
  if (b->swing <= 0x1FF) {
    if (y1 > 159) return;
    e.winRegs[b->half ? 3 : 2] = (uint16_t)(((y1 & 0xFF) << 8) | 160);
    if (y0 > 159) window_right(b->half + 2, p[4], p[5], p[6], p[7], 0);
    else window_between(b->half + 2, p);
  } else {
    if (y0 > 159) return;
    e.winRegs[b->half ? 3 : 2] = (uint16_t)(((y0 & 0xFF) << 8) | 160);
    if (y1 > 159) window_left(b->half + 2, p[0], p[1], p[2], p[3], 0);
    else window_between(b->half + 2, p);
  }
}

// TaskDestructor_SpotlightsManager: the windows and the blend go
static void gone(void) {
  spot.active = 0;
  e.bldCnt = 0; e.bldY = 0;
  e.winRegs[4] = e.winRegs[5] = 0;
  e.dispCnt &= ~0x6000;
}

/** CreateSpotlights: the manager and the two beams as the act starts, with the windows on and the screen dark. */
void spotlights_start(void) {
  spot.active = 1; spot.fading = 0; spot.qBlend = 2 * MIN_BLEND;
  spot.beams[0] = (LightBeam){ 0, 0x40, 0x800, 60, 200, 0, 0x20 };
  spot.beams[1] = (LightBeam){ 0, 8, 0x400, 200, 240, 1, 0x10 };
  e.winRegs[0] = e.winRegs[1] = 0x00F0;
  e.winRegs[2] = e.winRegs[3] = 0x00A0;
  e.winRegs[4] = 0x1F1F;   // inside a window: every layer show, no brightness change
  e.winRegs[5] = 0x003F;   // outside both: every layer show, and the change
  e.bldCnt = 0x3FDF;       // a decrease of every layer and the sprites, not the backdrop
  e.bldY = 16;
  e.dispCnt |= 0x6000;     // windows 0 and 1 on
  // The act starts on the window table the course select left: its first line is what the last screen's
  // windows held there. The beams overwrite the lines they cover; the rest keeps this, as the original does
  // between the tables it shows every other frame.
  uint8_t left[4] = { 0xE0, 0x1A, 0xD6, 0x5A };   // WIN0H 0x1AE0, WIN1H 0x5AD6
  for (int i = 0; i < 4; i++) { e.hblank[i] = left[i]; e.hblank[HBLANK_BUFFER + i] = left[i]; }
}

/** The spotlights' frame: the manager's fade, then each beam's window. */
void spotlights_frame(void) {
  if (!spot.active) return;
  e.dispCnt |= 0x6000;
  e.winRegs[4] = 0x1F1F; e.winRegs[5] = 0x003F;
  e.bldCnt = 0x3FDF;
  int x = (int)__builtin_floor(act.player.x);
  if (spot.fading) {
    // Task_801796C
    spot.qBlend = s16(spot.qBlend - 64);
    if (spot.qBlend < 0 || x > GONE_X || act.player.dead) { gone(); return; }
    e.bldY = (uint16_t)(spot.qBlend >> 8);
  } else {
    spot.qBlend = s16(spot.qBlend - 64) > MIN_BLEND ? s16(spot.qBlend - 64) : MIN_BLEND;
    e.bldY = (uint16_t)(spot.qBlend >> 8);
    if (x > FADE_X) spot.fading = 1;
    else if (act.player.dead) { gone(); return; }
  }
  // the beams write this frame's half of the table, which the V-blank shows
  beam_frame(&spot.beams[0]);
  beam_frame(&spot.beams[1]);
}
