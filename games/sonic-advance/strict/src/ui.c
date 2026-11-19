// The screens of menus' graphics.
#include "ui.h"

/** 0x080535C8, sub_80535FC: once, a free list of ten entries and the stack's task, with its stack emptied. */
void sub_80535FC(void) {
  s32 i;

  if (gTask_03006240 == NULL) {
    for (i = 0; i < 9; i++) gUnknown_03006250[i].next = &gUnknown_03006250[i + 1];
    gUnknown_03006250[9].next = NULL;
    gUnknown_030063F0 = gUnknown_03006250;
    gUnknown_030063C0 = NULL;
    gTask_03006240 = TaskCreate(CODE(Task_80536D4), sizeof(struct Task_3006240), 0x1800, 0, CODE(TaskDestructor_80536D8));
    UiGfxStackInit();
  }
}

/** UiGfxStackInit, 0x08053640: every entry of the stack free, each naming the next. */
u16 UiGfxStackInit(void) {
  struct Task_3006240 *strc = TASK_DATA(gTask_03006240);
  struct GfxSubstruct *curr = &strc->gfxList[0];
  struct GfxSubstruct *next = &strc->gfxList[1];
  u16 offset;
  s32 i;

  for (i = 0; i < 14; curr++, next++, i++) curr->next = next;
  curr->next = next;

  offset = gTask_03006240->data;
  strc = TASK_DATA(gTask_03006240);
  strc->first = &strc->gfxList[0];
  return offset;
}

/** 0x0805367C, UiGfxStackPop: the stack's next free entry's tiles, or NULL when none is left. */
struct GraphicsData *UiGfxStackPop(void) {
  struct Task_3006240 *strc = TASK_DATA(gTask_03006240);
  struct GfxSubstruct *curr;

  curr = strc->first;
  if (curr != NULL) strc->first = curr->next;
  else return NULL;
  return &curr->graphics;
}

/** 0x080536A0, Task_80536D4: the stack's task does nothing each frame. */
void Task_80536D4(void) {}

/** 0x080536A4, TaskDestructor_80536D8: the stack is gone with its task. */
void TaskDestructor_80536D8(struct Task *t) { gTask_03006240 = NULL; }
