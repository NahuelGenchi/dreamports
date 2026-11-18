// A spotlight's beam: a task that swings it, and draws it as a window of the screen with the line-window functions.
// The opening has two, and Ice Paradise has its own.
#include "core.h"
#include "spotlight.h"
#include "task.h"

void Task_SpotlightBeam(void);
void TaskDestructor_8012284(struct Task *t);

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
