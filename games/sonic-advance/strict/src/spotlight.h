// A spotlight's beam, which the opening and Ice Paradise swing across the screen.
#ifndef SPOTLIGHT_H
#define SPOTLIGHT_H
#include "console.h"
#include "task.h"

/** What a beam's task keeps: its angle and swing, where it shines from, and the background it lights. */
struct SpotlightBeam {
  /* 0x00 */ s16 unk0;
  /* 0x02 */ u16 unk2;
  /* 0x04 */ s16 unk4;
  /* 0x06 */ s16 unk6;
  /* 0x08 */ s16 unk8;
  /* 0x0A */ u8 bg;
  /* 0x0B */ u8 unkB;
};

struct Task *CreateSpotlightBeamTask(void);
void Task_SpotlightBeam(void);
void TaskDestructor_8012284(struct Task *t);

#endif
