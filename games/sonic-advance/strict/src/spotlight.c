// A spotlight's beam: a task that swings it, and draws it as a window of the screen with the line-window functions.
// The opening has two, and Ice Paradise has its own.
#include "core.h"
#include "bg_triangles.h"
#include "spotlight.h"
#include "task.h"

#define DISPLAY_WIDTH 240

extern const s16 gSineTable[1280];
s32 Div(s32 num, s32 denom);

/** The tangent of an angle of the sine table's 1,024, with 8 bits of fraction, as the BIOS divides it. */
#define TAN(angle) Div((gSineTable[(angle)] >> 6) << 8, gSineTable[(angle) + 0x100] >> 6)

/** 0x08011DBC, CreateSpotlightBeamTask: the task, with its beam set to where it starts. */
struct Task *CreateSpotlightBeamTask(void) {
  struct Task *t = TaskCreate(CODE(Task_SpotlightBeam), sizeof(struct SpotlightBeam), 0x2000, 0, CODE(TaskDestructor_8012284));
  struct SpotlightBeam *beam = TASK_DATA(t);

  beam->unk6 = 120;
  beam->unk8 = 200;
  beam->unk0 = 0;
  beam->unk2 = 64;
  beam->unk4 = 0x800;
  beam->bg = 0;
  beam->unkB = 32;

  return t;
}

/** 0x08011E08, Task_SpotlightBeam: the beam swung by its speed, back and forth across the screen, and its two edges
 *  drawn as the edges of its window, line by line, from where the light shines to the screen's bottom. */
void Task_SpotlightBeam(void) {
  // the triangle the window's edges follow, its corners as the line-window functions take them, and where each
  // edge leaves the screen, x then y
  u8 tri[8];
  s16 left[2];
  s16 right[2];
  struct SpotlightBeam *beam = TASK_DATA(gCurTask);
  u32 angle;
  u32 other;

  if ((u16)beam->unk0 <= 0x1FF)
    beam->unk4 -= beam->unk2;
  else
    beam->unk4 += beam->unk2;

  beam->unk0 += beam->unk4 >> 8;
  angle = ((beam->unk0 &= 0x3FF) + beam->unkB) & 0x3FF;

  if (gSineTable[angle + 0x100] == 0)
    return;

  // the left edge: where it leaves the screen, at its bottom or at a side
  left[0] = beam->unk6 - ((beam->unk8 * (s16)TAN(angle)) >> 8);
  if (left[0] <= 0) {
    left[0] = 0;
    if (angle > 0xFF) {
      other = (angle - 0x300) & 0x3FF;
      left[1] = beam->unk8 - ((beam->unk6 * (s16)TAN(other)) >> 8);
    } else {
      other = (0x100 - angle) & 0x3FF;
      left[1] = beam->unk8 - ((beam->unk6 * (s16)TAN(other)) >> 8);
    }
  } else if (left[0] > DISPLAY_WIDTH - 1) {
    left[0] = DISPLAY_WIDTH;
    if (angle > 0xFF) {
      other = (angle - 0x300) & 0x3FF;
      left[1] = beam->unk8 - (((DISPLAY_WIDTH - beam->unk6) * (s16)TAN(other)) >> 8);
    } else {
      other = (0x100 - angle) & 0x3FF;
      left[1] = beam->unk8 - (((DISPLAY_WIDTH - beam->unk6) * (s16)TAN(other)) >> 8);
    }
  } else {
    left[1] = 0;
  }
  tri[0] = left[0];
  tri[1] = left[1];
  tri[2] = beam->unk6 - (((beam->unk8 - DISPLAY_HEIGHT) * (s16)TAN(angle)) >> 8);
  tri[3] = DISPLAY_HEIGHT;

  // the right edge, the same way
  angle = (u16)(0x400 - (beam->unk0 - beam->unkB)) & 0x3FF;
  right[0] = ((beam->unk8 * (s16)TAN(angle)) >> 8) + beam->unk6;
  if (right[0] <= 0) {
    right[0] = 0;
    if (angle > 0xFF) {
      other = (angle - 0x300) & 0x3FF;
      right[1] = beam->unk8 - ((beam->unk6 * (s16)TAN(other)) >> 8);
    } else {
      other = (0x100 - angle) & 0x3FF;
      right[1] = beam->unk8 - ((beam->unk6 * (s16)TAN(other)) >> 8);
    }
  } else if (right[0] > DISPLAY_WIDTH - 1) {
    right[0] = DISPLAY_WIDTH;
    if (angle > 0xFF) {
      other = (angle - 0x300) & 0x3FF;
      right[1] = beam->unk8 - (((DISPLAY_WIDTH - beam->unk6) * (s16)TAN(other)) >> 8);
    } else {
      other = (0x100 - angle) & 0x3FF;
      right[1] = beam->unk8 - (((DISPLAY_WIDTH - beam->unk6) * (s16)TAN(other)) >> 8);
    }
  } else {
    right[1] = 0;
  }
  tri[4] = right[0];
  tri[5] = right[1];
  tri[6] = (((beam->unk8 - DISPLAY_HEIGHT) * (s16)TAN(angle)) >> 8) + beam->unk6;
  tri[7] = DISPLAY_HEIGHT;

  // the window's edges: both of them along the triangle's sides, or one beside the side the beam leaves by
  if ((u16)beam->unk0 <= 0x1FF) {
    if (right[1] > DISPLAY_HEIGHT - 1)
      return;
    if (left[1] > DISPLAY_HEIGHT - 1) {
      if (beam->bg & 1)
        gWinRegs[3] = (tri[5] << 8) | DISPLAY_HEIGHT;
      else
        gWinRegs[2] = (tri[5] << 8) | DISPLAY_HEIGHT;
      sub_8006228(beam->bg, tri[4], tri[5], tri[6], tri[7], 0);
      return;
    }
    if (beam->bg & 1)
      gWinRegs[3] = (tri[5] << 8) | DISPLAY_HEIGHT;
    else
      gWinRegs[2] = (tri[5] << 8) | DISPLAY_HEIGHT;
    sub_800724C(beam->bg, (TriParam1 *)tri);
    return;
  }

  if (left[1] > DISPLAY_HEIGHT - 1)
    return;
  if (right[1] > DISPLAY_HEIGHT - 1) {
    if (beam->bg & 1)
      gWinRegs[3] = (tri[1] << 8) | DISPLAY_HEIGHT;
    else
      gWinRegs[2] = (tri[1] << 8) | DISPLAY_HEIGHT;
    sub_80064A8(beam->bg, tri[0], tri[1], tri[2], tri[3], 0);
    return;
  }
  if (beam->bg & 1)
    gWinRegs[3] = (tri[1] << 8) | DISPLAY_HEIGHT;
  else
    gWinRegs[2] = (tri[1] << 8) | DISPLAY_HEIGHT;
  sub_800724C(beam->bg, (TriParam1 *)tri);
}

/** 0x08012284, TaskDestructor_8012284: the beam's task gone, so no lines are copied at each H-blank any more. */
void TaskDestructor_8012284(struct Task *t) {
  gFlags &= ~FLAGS_EXECUTE_HBLANK_COPY;
}
