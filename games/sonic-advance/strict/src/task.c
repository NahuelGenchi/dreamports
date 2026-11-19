// The task list of Sonic Advance's engine: every screen and object of the game is a task, run once a frame in the
// order of its priority, with memory of its own from a small heap in the fast work memory.
#include "task.h"
#include "time.h"

/** TasksInit, 0x080014A8: an empty list between its two ends, every slot free, and the tasks' memory one free stretch. */
bool32 TasksInit(void) {
  struct Task *cur;
  s32 i;

  gCurTask = NULL;
  gNextTask = NULL;
  gNumTasks = 0;
  DMA3_FILL32(0, gTasks, 0x200);
  // every slot's task: the console's compiler turns this loop around and fills them from the last down, which the
  // kit's compiler doesn't, so the Dreamport's says so, as a frame of power-on ends in the middle of it
#ifdef MATCHING
  for (i = 0; i < MAX_TASKS; i++) gTaskPtrs[i] = &gTasks[i];
#else
  for (i = MAX_TASKS - 1; i >= 0; i--) {
    gTaskPtrs[i] = &gTasks[i];
    if (i == MAX_TASKS - 1) TIME(0x080014A8, 0x080014E0, 0x080014D9, IW, IW, IW, DMA3, IW);
    else if (i != 0) TIME(0x080014D8, 0x080014E0, 0x080014D9, IW);
    else TIME(0x080014D8, 0x080014E4, 0x08001931, IW);
  }
#endif

  cur = TaskGetNextSlot();
  if (cur == NULL) return FALSE;
  cur->main = CODE(TaskMainDummy1);
  cur->priority = 0;
  cur->flags = 0;
  cur->parent = 0;
  cur->prev = 0;
  TIME(0x080014E6, 0x080014FC, 0x08001931, IW, IW, IW, IW, IW);
  cur->next = (u32)TaskGetNextSlot();
  if (TASK_AT(cur->next) == TASK_AT(0)) return FALSE;
  TASK_AT(cur->next)->prev = (u32)cur;

  cur = TASK_AT(cur->next);
  cur->main = CODE(TaskMainDummy2);
  cur->priority = 0xFFFF;
  cur->flags = 0;
  cur->parent = 0;
  cur->next = 0;

  gEmptyTask.parent = 0;
  gEmptyTask.prev = 0;
  gEmptyTask.next = 0;
  gEmptyTask.data = gUnknown_0300642C;

  gIwramHeap.next = 0;
  gIwramHeap.size = 0x2204;
  TIME(0x080014FE, 0x0800153C, 0x0800157F, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW, IW);
  TIME(0x0800157E, 0x08001584, 0x080006B1);
  return TRUE;
}

/** TaskCreate, 0x08001588: a task after every task of the same or a lower priority, or the empty task when all are taken. */
struct Task *TaskCreate(TaskMain main, u16 dataSize, u16 priority, u16 flags, TaskDestructor dtor) {
  struct Task *slow;
  struct Task *task = NULL;

  if (gNumTasks < MAX_TASKS) {
    struct Task *slot = gTaskPtrs[gNumTasks];
    gNumTasks++;
    task = slot;
  }
  if (task == NULL) return &gEmptyTask;

  task->main = main;
  task->dtor = dtor;
  task->priority = priority;
  task->flags = flags;
  task->data = (u32)IwramMalloc(dataSize);
  task->parent = (u32)gCurTask;

  slow = gTaskPtrs[0];
  while (TASK_AT(slow->next) != TASK_AT(0)) {
    struct Task *fast = TASK_AT(slow->next);
    if (fast->priority > priority) {
      fast->prev = (u32)task;
      task->next = slow->next;
      task->prev = (u32)slow;
      slow->next = (u32)task;
      break;
    }
    slow = fast;
  }
  return task;
}

/** TaskDestroy, 0x08001620: takes a task out of the list, unless it may not be destroyed or is one of the list's ends. */
void TaskDestroy(struct Task *task) {
  if (!(task->flags & TASK_DESTROY_DISABLED)) {
    struct Task *prev = TASK_AT(task->prev);
    struct Task *next = TASK_AT(task->next);
    if (prev != TASK_AT(0) && next != TASK_AT(0)) {
      if (task->dtor != NULL) CALL(task->dtor)(task);
      if (task == gNextTask) gNextTask = TASK_AT(task->next);
      prev = TASK_AT(task->prev);
      next = TASK_AT(task->next);
      prev->next = (u32)next;
      next->prev = (u32)prev;
      if (task->data != 0) IwramFree(NODE_AT(task->data));
      gTaskPtrs[--gNumTasks] = task;
      task->parent = 0;
      task->prev = 0;
      task->main = CODE(TaskMainDummy3);
      task->priority = 0;
      task->flags = 0;
      task->data = 0;
    }
  }
}

/** TasksExec, 0x080016AC: runs every task once, in order, and only those that run while paused when the game is paused. */
void TasksExec(void) {
  gCurTask = gTaskPtrs[0];
  if (!(gFlags & FLAGS_PAUSED)) {
    while (gCurTask != TASK_AT(0)) {
      gNextTask = TASK_AT(gCurTask->next);
      if (!(gCurTask->flags & TASK_INACTIVE)) CALL(gCurTask->main)();
      gCurTask = gNextTask;
      if (gExecSoundMain != 0) {
        m4aSoundMain();
        gExecSoundMain = 0;
      }
    }
  } else {
    while (gCurTask != TASK_AT(0)) {
      gNextTask = TASK_AT(gCurTask->next);
      if ((gCurTask->flags & (TASK_INACTIVE | TASK_RUNS_PAUSED)) == TASK_RUNS_PAUSED) CALL(gCurTask->main)();
      gCurTask = gNextTask;
      if (gExecSoundMain != 0) {
        m4aSoundMain();
        gExecSoundMain = 0;
      }
    }
  }
  gCurTask = NULL;
  gNextTask = NULL;
}

/** IwramMalloc, 0x08001780: the first free stretch of the tasks' memory that holds `size` bytes, or NULL. */
void *IwramMalloc(u16 size) {
  struct IwramNode *cur, *rest, *following;
  u16 words = size;

  words = (words + 3) >> 2;
  if (words == 0) return NULL;
  words = words * 4 + 4;
  cur = &gIwramHeap;
  while (1) {
    if ((s16)words <= cur->size) {
      if ((s16)words == cur->size) {
        cur->size = -words;
        return cur->space;
      }
      if ((s16)(words + 4) <= cur->size) {
        rest = (struct IwramNode *)((u8 *)cur + words);
        rest->next = cur->next;
        rest->size = cur->size - words;
        cur->next = (u32)rest;
        cur->size = -words;
        return cur->space;
      }
    }
    following = NODE_AT(cur->next);
    if (following == NODE_AT(0)) return NULL;
    cur = following;
  }
}

/** IwramFree, 0x080017E8: frees a stretch of the tasks' memory and joins it to the free stretches beside it. */
void IwramFree(void *space) {
  struct IwramNode *node = space, *slow, *fast;

  node--;
  slow = &gIwramHeap;
  fast = slow;
  if (node != slow) {
    do {
      slow = fast;
      fast = NODE_AT(slow->next);
    } while (node != fast);
  }
  if (node->size < 0) node->size = -node->size;

  if ((struct IwramNode *)((u8 *)slow + slow->size) == node) {
    if (slow->size > 0) {
      slow->next = fast->next;
      slow->size += node->size;
      node = slow;
    }
  }
  fast = (struct IwramNode *)((u8 *)node + node->size);
  if (fast == NODE_AT(node->next)) {
    if (fast->size > 0) {
      node->size += fast->size;
      node->next = fast->next;
    }
  }
}

/** 0x08001864: moves each taken stretch of the tasks' memory down over the free one before it, and points its task at
 *  where it now is. As the original has it: the stretch it leaves free names itself as the next. */
void IwramDefrag(void) {
  struct IwramNode *cur = &gIwramHeap;

  while (NODE_AT(cur->next) != NODE_AT(0)) {
    if (cur->size >= 0) {
      struct IwramNode *next = NODE_AT(cur->next);
      if (next->size >= 0) {
        cur->size += next->size;
        cur->next = NODE_AT(cur->next)->next;
      } else {
        u8 *from = next->space;
        u8 *to = cur->space;
        s16 freed = cur->size;
        struct IwramNode *rest;
        s32 i;

        cur->size = next->size;
        cur->next = next->next;
        for (i = 0; i < MAX_TASKS; i++) {
          if (gTasks[i].data == (u16)(u32)from) {
            gTasks[i].data = (u32)to;
            break;
          }
        }
        DMA3_COPY32(from, to, cur->size + 4);
        rest = (struct IwramNode *)((u8 *)cur + cur->size);
        rest->next = cur->next;
        rest->size = freed;
        cur = rest;
        cur->next = (u32)cur;
      }
    } else {
      cur = NODE_AT(cur->next);
    }
  }
}

/** TaskGetNextSlot, 0x08001930: a free task, or NULL when all 128 are taken. */
struct Task *TaskGetNextSlot(void) {
  struct Task *slot;
  if (gNumTasks >= MAX_TASKS) return NULL;
  slot = gTaskPtrs[gNumTasks++];
  TIME(0x08001930, 0x08001944, 0x08001953, IW, IW, IW);
  TIME(0x08001952, 0x08001952, BACK);
  return slot;
}

/** TasksDestroyInPriorityRange, 0x08001954: destroys the tasks from the first of priority `lowest` or more, up to one of `highest` or more. */
void TasksDestroyInPriorityRange(u16 lowest, u16 highest) {
  struct Task *task, *cur = gTaskPtrs[0];
  u16 offset = (u32)gTaskPtrs[0];
  u16 priority;

  while (offset != 0) {
    priority = cur->priority;
    if (priority >= lowest) {
      do {
        if (priority >= highest) return;
        task = cur;
        cur = TASK_AT(task->next);
        if (task != gTaskPtrs[0] && task != gTaskPtrs[1]) TaskDestroy(task);
        if (cur == TASK_AT(0)) return;
        priority = cur->priority;
      } while (1);
    }
    offset = cur->next;
    cur = TASK_AT(offset);
  }
}

/** 0x080019B4: what the list's first end runs. */
void TaskMainDummy1(void) {}

/** 0x080019B8: what the list's last end runs. */
void TaskMainDummy2(void) {}

/** 0x080019BC: what a destroyed task is left with. */
void TaskMainDummy3(void) {}
