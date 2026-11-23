// The task list of Sonic Advance's engine: every screen and object of the game is a task run once a frame.
#ifndef TASK_H
#define TASK_H
#include "console.h"
#include "core.h"

#define MAX_TASKS 128
#define TASK_INACTIVE 0x0001
#define TASK_DESTROY_DISABLED 0x0002
#define TASK_RUNS_PAUSED 0x0004

typedef void (*TaskMain)(void);
struct Task;
typedef void (*TaskDestructor)(struct Task *);

/** A task. It names the tasks around it by the low 16 bits of their addresses in the work memory. */
struct Task {
  /* 0x00 */ u16 parent;
  /* 0x02 */ u16 prev;
  /* 0x04 */ u16 next;
  /* 0x06 */ u16 data;          // its own memory, from IwramMalloc
  /* 0x08 */ TaskMain main;
  /* 0x0C */ TaskDestructor dtor;
  /* 0x10 */ u16 priority;
  /* 0x12 */ u16 flags;
};

/** A stretch of the tasks' memory: free when `size` is positive, taken when negative. */
struct IwramNode {
  u16 next;
  s16 size;
  u8 space[0];
};

/** A task's own memory. */
#define TASK_DATA(task) ((void *)(IWRAM_START + (task)->data))
#define TASK_AT(offset) ((struct Task *)(IWRAM_START + (offset)))
#define NODE_AT(offset) ((struct IwramNode *)(IWRAM_START + (offset)))

extern struct Task gTasks[MAX_TASKS];
extern struct Task *gTaskPtrs[MAX_TASKS];
extern struct Task gEmptyTask;
extern struct Task *gCurTask;
extern struct Task *gNextTask;
extern s32 gNumTasks;
extern struct IwramNode gIwramHeap;
extern u32 gUnknown_0300642C;

bool32 TasksInit(void);
struct Task *TaskCreate(TaskMain main, u16 dataSize, u16 priority, u16 flags, TaskDestructor dtor);
void TaskDestroy(struct Task *task);
void TasksExec(void);
void *IwramMalloc(u16 size);
void IwramFree(void *space);
void IwramDefrag(void);
struct Task *TaskGetNextSlot(void);
void TasksDestroyInPriorityRange(u16 lowest, u16 highest);
void TaskMainDummy1(void);
void TaskMainDummy2(void);
void TaskMainDummy3(void);


#endif
