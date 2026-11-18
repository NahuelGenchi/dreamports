// A task of the game's that the decompilation of the other release still keeps as assembly: what it does each frame,
// 0x08011E08, isn't written yet.
#include "core.h"
#include "task.h"

/** What the task keeps: six halfwords and two bytes, set once. */
struct Task8011DBC {
  /* 0x00 */ u16 unk0;
  /* 0x02 */ u16 unk2;
  /* 0x04 */ u16 unk4;
  /* 0x06 */ u16 unk6;
  /* 0x08 */ u16 unk8;
  /* 0x0A */ u8 unkA;
  /* 0x0B */ u8 unkB;
};

void Task_8011E08(void);
void TaskDestructor_8012284(struct Task *t);
void CreateTask_8011DBC(void);

/** 0x08011DBC, CreateTask_8011DBC: the task, with what it keeps set to where it starts. (No wording found gives the
 *  original's registers: it keeps its two zeros in r3 and r4, this in r2 and r3, so its proof is the same memory.) */
void CreateTask_8011DBC(void) {
  struct Task8011DBC *data;

  data = TASK_DATA(TaskCreate(CODE(Task_8011E08), sizeof(struct Task8011DBC), 0x2000, 0, CODE(TaskDestructor_8012284)));

  data->unk6 = 120;
  data->unk8 = 200;
  data->unk0 = 0;
  data->unk2 = 64;
  data->unk4 = 0x800;
  data->unkA = 0;
  data->unkB = 32;
}
