// Mutexes, lightweight mutexes and callbacks, as the console's emulator in the proof tools answers them (PPSSPP's
// sceKernelMutex and the callbacks of sceKernelThread): what each call takes of the processor's time, which waiting
// thread each wakes and when, and how a wait's timeout runs out.
//
// A mutex is the system's; a lightweight mutex keeps its state in a work area of 32 bytes in the game's own memory,
// which the game gives each call, so the console's memory has what the original's has. A mutex wakes the first thread
// waiting for it, or the one with the best priority for one made with PSP_MUTEX_PRIORITY. A thread whose wait timed out
// stays in the list until an unlock passes over it, as in the emulator.
//
// A callback is made, registered as the exit callback, looked at and deleted. A game that notifies one itself, which the
// console would then run on its thread, isn't followed yet (kit/psp/c/README.md): with no callback notified, a wait that
// takes callbacks is the wait without them, as it is in the emulator.

#include "psp-kit.h"

#define ROOM 64
#define WAITERS 64
#define CYCLES_A_MICROSECOND (PSP_CYCLES_A_SECOND / 1000000)

enum {
  ERROR_ILLEGAL_ADDR = (int)0x800200D3, ERROR_ACCESS_ERROR = (int)0x80020096, ERROR_ILLEGAL_COUNT = (int)0x800201BD, ERROR_UNKNOWN_CBID = (int)0x800201A1,
  ERROR_WAIT_TIMEOUT = (int)0x800201A8, ERROR_WAIT_CANCEL = (int)0x800201A9, ERROR_WAIT_DELETE = (int)0x800201B5,
  ERROR_NO_SUCH_MUTEX = (int)0x800201C3, ERROR_MUTEX_TRYLOCK_FAILED = (int)0x800201C4, ERROR_MUTEX_NOT_LOCKED = (int)0x800201C5,
  ERROR_MUTEX_LOCK_OVERFLOW = (int)0x800201C6, ERROR_MUTEX_UNLOCK_UNDERFLOW = (int)0x800201C7, ERROR_MUTEX_ALREADY_LOCKED = (int)0x800201C8,
  ERROR_NO_SUCH_LWMUTEX = (int)0x800201CA, ERROR_LWMUTEX_TRYLOCK_FAILED = (int)0x800201CB, ERROR_LWMUTEX_NOT_LOCKED = (int)0x800201CC,
  ERROR_LWMUTEX_LOCK_OVERFLOW = (int)0x800201CD, ERROR_LWMUTEX_UNLOCK_UNDERFLOW = (int)0x800201CE, ERROR_LWMUTEX_ALREADY_LOCKED = (int)0x800201CF,
};
enum { MUTEX_PRIORITY = 0x100, MUTEX_RECURSIVE = 0x200 };

static void copy_name(char *to, const char *name) {
  int i = 0;
  for (; name[i] && i < 31; i++) to[i] = name[i];
  for (; i < 32; i++) to[i] = 0;
}
static void write_name(uint32_t at, const char *name) {
  for (int i = 0; i < 32; i++) psp_write8(at + (uint32_t)i, (uint8_t)name[i]);
}

// each waiting thread's timeout, where it gave one, which a wake writes what's left to
static struct { SceUID thread; uint32_t at; } timeouts[ROOM];
static uint32_t timeout_of(SceUID thread) {
  for (int i = 0; i < ROOM; i++) if (timeouts[i].thread == thread) return timeouts[i].at;
  return 0;
}
static void set_timeout(SceUID thread, uint32_t at) {
  int free = -1;
  for (int i = 0; i < ROOM; i++) {
    if (timeouts[i].thread == thread) {
      timeouts[i].at = at;
      return;
    }
    if (free < 0 && !timeouts[i].thread) free = i;
  }
  if (free < 0) __builtin_trap();
  timeouts[free].thread = thread;
  timeouts[free].at = at;
}
// a wait's timeout as the console times it: three microseconds or less is 25, and up to 249 is 250
static void schedule_timeout(uint32_t at, clock_event event, SceUID thread) {
  if (!at) return;
  int micro = (int)psp_read32(at);
  if (micro <= 3) micro = 25;
  else if (micro <= 249) micro = 250;
  clock_schedule((int64_t)micro * CYCLES_A_MICROSECOND, event, (uint64_t)thread);
}
// what's left of a timeout written back as a wait ends
static void write_left(clock_event event, SceUID thread) {
  uint32_t at = timeout_of(thread);
  if (!at) return;
  int64_t left = clock_left(event, (uint64_t)thread);
  clock_unschedule(event, (uint64_t)thread);
  psp_write32(at, (uint32_t)(left / CYCLES_A_MICROSECOND));
}
// the thread of `list` with the best priority, the first of them among equals
static int best_of(const SceUID *list, int count) {
  int best = 0;
  uint32_t priority = 0xFFFFFFFFu;
  for (int i = 0; i < count; i++) {
    uint32_t each = (uint32_t)thread_priority(list[i]);
    if (each < priority) {
      best = i;
      priority = each;
    }
  }
  return best;
}
static void list_remove(SceUID *list, int *count, int i) {
  for (int j = i; j < *count - 1; j++) list[j] = list[j + 1];
  (*count)--;
}

// ---- mutexes -------------------------------------------------------------------------------------------------------------

struct mutex { SceUID uid; uint32_t attr; int initial, level, waiters; SceUID owner; char name[32]; SceUID waiting[WAITERS]; };
static struct mutex mutexes[ROOM];
// the mutexes each thread holds, in the order it took them
static struct { SceUID thread, mutex; } held[ROOM];
static int helds;

static struct mutex *mutex_of(SceUID uid) {
  for (int i = 0; i < ROOM; i++) if (mutexes[i].uid && mutexes[i].uid == uid) return &mutexes[i];
  return 0;
}
static void mutex_timeout(uint64_t data, int late);

static void acquire(struct mutex *m, int count, SceUID thread) {
  if (helds == ROOM) __builtin_trap();
  held[helds].thread = thread;
  held[helds].mutex = m->uid;
  helds++;
  m->level = count;
  m->owner = thread;
}
static void erase_lock(struct mutex *m) {
  if (m->owner != -1) {
    for (int i = 0; i < helds; i++) {
      if (held[i].thread != m->owner || held[i].mutex != m->uid) continue;
      for (int j = i; j < helds - 1; j++) held[j] = held[j + 1];
      helds--;
      break;
    }
  }
  m->owner = -1;
}
// a waiting thread let go, taking the mutex, or with `result`: whether it was still waiting for it
static int mutex_unlock_for(struct mutex *m, SceUID thread, int result) {
  if (thread_waits(thread, WAIT_MUTEX) != m->uid) return 0;
  if (result == 0) acquire(m, (int)thread_wait_value(thread), thread);
  write_left(mutex_timeout, thread);
  thread_wake(thread, result);
  return 1;
}
// the mutex given up: the next waiting thread takes it
static int mutex_hand_on(struct mutex *m) {
  erase_lock(m);
  int woke = 0;
  while (!woke && m->waiters) {
    int i = (m->attr & MUTEX_PRIORITY) ? best_of(m->waiting, m->waiters) : 0;
    woke |= mutex_unlock_for(m, m->waiting[i], 0);
    list_remove(m->waiting, &m->waiters, i);
  }
  if (!woke) m->owner = -1;
  return woke;
}
static void mutex_timeout(uint64_t data, int late) {
  (void)late;
  SceUID thread = (SceUID)data;
  if (!mutex_of(thread_waits(thread, WAIT_MUTEX))) return;
  uint32_t at = timeout_of(thread);
  if (at) psp_write32(at, 0);
  thread_wake(thread, ERROR_WAIT_TIMEOUT);
  thread_reschedule();
}
// whether the calling thread can take the mutex now, and if not, the error, or 0 to wait
static int mutex_check(struct mutex *m, int count, int *error) {
  int recursive = (m->attr & MUTEX_RECURSIVE) != 0;
  if (count <= 0) *error = ERROR_ILLEGAL_COUNT;
  else if (count > 1 && !recursive) *error = ERROR_ILLEGAL_COUNT;
  else if (count + m->level < 0) *error = ERROR_MUTEX_LOCK_OVERFLOW;
  else if (m->owner == thread_current()) {
    if (recursive) return 1;
    *error = ERROR_MUTEX_ALREADY_LOCKED;
  } else if (m->level == 0) return 1;
  return 0;
}
static int mutex_take(struct mutex *m, int count, int *error) {
  if (!mutex_check(m, count, error)) return 0;
  if (m->level == 0) {
    acquire(m, count, thread_current());
    return 1;
  }
  m->level += count;
  return 1;
}

SceUID sceKernelCreateMutex(const char *name, uint32_t attr, int count, uint32_t options) {
  call_starts();
  (void)options;
  if (!name) return thread_done(PSP_ERROR_ERROR);
  if (attr & ~0xBFFu) return thread_done(PSP_ERROR_ILLEGAL_ATTR);
  if (count < 0) return thread_done(ERROR_ILLEGAL_COUNT);
  if (!(attr & MUTEX_RECURSIVE) && count > 1) return thread_done(ERROR_ILLEGAL_COUNT);
  struct mutex *m = 0;
  for (int i = 0; i < ROOM && !m; i++) if (!mutexes[i].uid) m = &mutexes[i];
  if (!m) __builtin_trap();
  *m = (struct mutex){ .uid = kernel_new_uid(), .attr = attr, .initial = count, .owner = -1 };
  copy_name(m->name, name);
  if (count) acquire(m, count, thread_current());
  return thread_done(m->uid);
}
int sceKernelDeleteMutex(SceUID uid) {
  call_starts();
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  int woke = 0;
  for (int i = 0; i < m->waiters; i++) woke |= mutex_unlock_for(m, m->waiting[i], ERROR_WAIT_DELETE);
  if (m->owner != -1) erase_lock(m);
  m->waiters = 0;
  m->uid = 0;
  return woke ? thread_answer(0) : thread_done(0);
}
static int lock_mutex(SceUID uid, int count, uint32_t timeout) {
  call_starts();
  // a number that's never a mutex's, which a game passes as the console lets it
  if (uid == (SceUID)0x80020001 && timeout == 0) return thread_done(0);
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  int error = 0;
  if (mutex_take(m, count, &error)) return thread_done(0);
  if (error) return thread_done(error);
  SceUID me = thread_current();
  int listed = 0;
  for (int i = 0; i < m->waiters; i++) listed |= m->waiting[i] == me;
  if (!listed) {
    if (m->waiters == WAITERS) __builtin_trap();
    m->waiting[m->waiters++] = me;
  }
  schedule_timeout(timeout, mutex_timeout, me);
  set_timeout(me, timeout);
  thread_wait(WAIT_MUTEX, uid, (uint32_t)count);
  return thread_answer(0);
}
int sceKernelLockMutex(SceUID uid, int count, uint32_t timeout) { return lock_mutex(uid, count, timeout); }
int sceKernelLockMutexCB(SceUID uid, int count, uint32_t timeout) { return lock_mutex(uid, count, timeout); }
int sceKernelTryLockMutex(SceUID uid, int count) {
  call_starts();
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  int error = 0;
  if (mutex_take(m, count, &error)) return thread_done(0);
  return thread_done(error ? error : ERROR_MUTEX_TRYLOCK_FAILED);
}
int sceKernelUnlockMutex(SceUID uid, int count) {
  call_starts();
  if (uid == (SceUID)0x80020001) return thread_done(0);
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  if (count <= 0) return thread_done(ERROR_ILLEGAL_COUNT);
  if (!(m->attr & MUTEX_RECURSIVE) && count > 1) return thread_done(ERROR_ILLEGAL_COUNT);
  if (m->level == 0 || m->owner != thread_current()) return thread_done(ERROR_MUTEX_NOT_LOCKED);
  if (m->level < count) return thread_done(ERROR_MUTEX_UNLOCK_UNDERFLOW);
  m->level -= count;
  if (m->level == 0 && mutex_hand_on(m)) return thread_answer(0);
  return thread_done(0);
}
int sceKernelCancelMutex(SceUID uid, int count, uint32_t waiting) {
  call_starts();
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  int error = 0;
  if (count > 0 && !mutex_check(m, count, &error) && error && error != ERROR_MUTEX_LOCK_OVERFLOW && error != ERROR_MUTEX_ALREADY_LOCKED) return thread_done(error);
  for (int i = 0; i < m->waiters; i++) if (thread_waits(m->waiting[i], WAIT_MUTEX) != m->uid) list_remove(m->waiting, &m->waiters, i--);
  if (psp_memory(waiting)) psp_write32(waiting, (uint32_t)m->waiters);
  int woke = 0;
  for (int i = 0; i < m->waiters; i++) woke |= mutex_unlock_for(m, m->waiting[i], ERROR_WAIT_CANCEL);
  if (m->owner != -1) erase_lock(m);
  m->waiters = 0;
  if (count <= 0) {
    m->level = 0;
    m->owner = -1;
  } else acquire(m, count, thread_current());
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelReferMutexStatus(SceUID uid, uint32_t info) {
  call_starts();
  struct mutex *m = mutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_MUTEX);
  if (!psp_memory(info)) return thread_done(-1);
  if (psp_read32(info) != 0) {
    for (int i = 0; i < m->waiters; i++) if (thread_waits(m->waiting[i], WAIT_MUTEX) != m->uid) list_remove(m->waiting, &m->waiters, i--);
    psp_write32(info, 56);
    write_name(info + 4, m->name);
    psp_write32(info + 36, m->attr);
    psp_write32(info + 40, (uint32_t)m->initial);
    psp_write32(info + 44, (uint32_t)m->level);
    psp_write32(info + 48, (uint32_t)m->owner);
    psp_write32(info + 52, (uint32_t)m->waiters);
  }
  return thread_done(0);
}

/** A thread that ends stops waiting for its mutex, and lets go of every mutex it holds, in the order it took them. */
void mutex_thread_ends(SceUID thread) {
  struct mutex *waited = mutex_of(thread_waits(thread, WAIT_MUTEX));
  if (waited) for (int i = 0; i < waited->waiters; i++) if (waited->waiting[i] == thread) list_remove(waited->waiting, &waited->waiters, i--);
  for (int i = 0; i < helds; i++) {
    if (held[i].thread != thread) continue;
    struct mutex *m = mutex_of(held[i].mutex);
    if (!m) continue;
    m->level = 0;
    mutex_hand_on(m);
    i = -1;
  }
}

// ---- lightweight mutexes -------------------------------------------------------------------------------------------------

// the work area in the game's memory: the lock's level, the thread that has it, the attributes, the waiting threads'
// count, which only the system's look writes, and its number
enum { AREA_LEVEL = 0, AREA_THREAD = 4, AREA_ATTR = 8, AREA_WAITERS = 12, AREA_UID = 16, AREA_BYTES = 32 };
struct lwmutex { SceUID uid; uint32_t attr, area; int initial, waiters; char name[32]; SceUID waiting[WAITERS]; };
static struct lwmutex lwmutexes[ROOM];

static struct lwmutex *lwmutex_of(SceUID uid) {
  for (int i = 0; i < ROOM; i++) if (lwmutexes[i].uid && lwmutexes[i].uid == uid) return &lwmutexes[i];
  return 0;
}
static int32_t area_get(uint32_t area, int field) { return (int32_t)psp_read32(area + (uint32_t)field); }
static void area_set(uint32_t area, int field, int32_t value) { psp_write32(area + (uint32_t)field, (uint32_t)value); }
static void lwmutex_timeout(uint64_t data, int late);

static int lwmutex_unlock_for(struct lwmutex *m, uint32_t area, SceUID thread, int result) {
  if (thread_waits(thread, WAIT_LWMUTEX) != m->uid) return 0;
  if (result == 0) {
    area_set(area, AREA_LEVEL, (int32_t)thread_wait_value(thread));
    area_set(area, AREA_THREAD, thread);
  }
  write_left(lwmutex_timeout, thread);
  thread_wake(thread, result);
  return 1;
}
static void lwmutex_timeout(uint64_t data, int late) {
  (void)late;
  SceUID thread = (SceUID)data;
  if (!lwmutex_of(thread_waits(thread, WAIT_LWMUTEX))) return;
  uint32_t at = timeout_of(thread);
  if (at) psp_write32(at, 0);
  thread_wake(thread, ERROR_WAIT_TIMEOUT);
  thread_reschedule();
}
static int lwmutex_take(uint32_t area, int count, int *error) {
  int32_t level = area_get(area, AREA_LEVEL), uid = area_get(area, AREA_UID);
  uint32_t attr = (uint32_t)area_get(area, AREA_ATTR);
  if (count <= 0) *error = ERROR_ILLEGAL_COUNT;
  else if (count > 1 && !(attr & MUTEX_RECURSIVE)) *error = ERROR_ILLEGAL_COUNT;
  else if (count + level < 0) *error = ERROR_LWMUTEX_LOCK_OVERFLOW;
  else if (uid == -1) *error = ERROR_NO_SUCH_LWMUTEX;
  if (*error) return 0;
  if (level == 0) {
    if (area_get(area, AREA_THREAD) != 0 && !lwmutex_of(uid)) {
      *error = ERROR_NO_SUCH_LWMUTEX;
      return 0;
    }
    area_set(area, AREA_LEVEL, count);
    area_set(area, AREA_THREAD, thread_current());
    return 1;
  }
  if (area_get(area, AREA_THREAD) == thread_current()) {
    if (attr & MUTEX_RECURSIVE) {
      area_set(area, AREA_LEVEL, level + count);
      return 1;
    }
    *error = ERROR_LWMUTEX_ALREADY_LOCKED;
  }
  return 0;
}

int sceKernelCreateLwMutex(uint32_t area, const char *name, uint32_t attr, int count, uint32_t options) {
  call_starts();
  (void)options;
  if (!name) return thread_done(PSP_ERROR_ERROR);
  if (attr >= 0x400) return thread_done(PSP_ERROR_ILLEGAL_ATTR);
  if (count < 0) return thread_done(ERROR_ILLEGAL_COUNT);
  if (!(attr & MUTEX_RECURSIVE) && count > 1) return thread_done(ERROR_ILLEGAL_COUNT);
  struct lwmutex *m = 0;
  for (int i = 0; i < ROOM && !m; i++) if (!lwmutexes[i].uid) m = &lwmutexes[i];
  if (!m) __builtin_trap();
  *m = (struct lwmutex){ .uid = kernel_new_uid(), .attr = attr, .area = area, .initial = count };
  copy_name(m->name, name);
  for (int i = 0; i < AREA_BYTES; i += 4) psp_write32(area + (uint32_t)i, 0);
  area_set(area, AREA_LEVEL, count);
  area_set(area, AREA_THREAD, count ? thread_current() : 0);
  area_set(area, AREA_ATTR, (int32_t)attr);
  area_set(area, AREA_UID, m->uid);
  return thread_done(0);
}
int sceKernelDeleteLwMutex(uint32_t area) {
  call_starts();
  if (!area || !psp_memory(area)) return thread_done(ERROR_ILLEGAL_ADDR);
  struct lwmutex *m = lwmutex_of(area_get(area, AREA_UID));
  if (!m) return thread_done(ERROR_NO_SUCH_LWMUTEX);
  int woke = 0;
  for (int i = 0; i < m->waiters; i++) woke |= lwmutex_unlock_for(m, area, m->waiting[i], ERROR_WAIT_DELETE);
  m->waiters = 0;
  area_set(area, AREA_LEVEL, 0);
  area_set(area, AREA_THREAD, -1);
  area_set(area, AREA_UID, -1);
  m->uid = 0;
  return woke ? thread_answer(0) : thread_done(0);
}
static int lock_lwmutex(uint32_t area, int count, uint32_t timeout) {
  call_starts();
  if (!psp_memory(area)) return thread_done(ERROR_ACCESS_ERROR);
  clock_spend(48);
  int error = 0;
  if (lwmutex_take(area, count, &error)) return thread_done(0);
  if (error) return thread_done(error);
  struct lwmutex *m = lwmutex_of(area_get(area, AREA_UID));
  if (!m) return thread_done(ERROR_NO_SUCH_LWMUTEX);
  SceUID me = thread_current();
  int listed = 0;
  for (int i = 0; i < m->waiters; i++) listed |= m->waiting[i] == me;
  if (!listed) {
    if (m->waiters == WAITERS) __builtin_trap();
    m->waiting[m->waiters++] = me;
  }
  schedule_timeout(timeout, lwmutex_timeout, me);
  set_timeout(me, timeout);
  thread_wait(WAIT_LWMUTEX, m->uid, (uint32_t)count);
  return thread_answer(0);
}
int sceKernelLockLwMutex(uint32_t area, int count, uint32_t timeout) { return lock_lwmutex(area, count, timeout); }
int sceKernelLockLwMutexCB(uint32_t area, int count, uint32_t timeout) { return lock_lwmutex(area, count, timeout); }
int sceKernelTryLockLwMutex(uint32_t area, int count) {
  call_starts();
  if (!psp_memory(area)) return thread_done(ERROR_ACCESS_ERROR);
  clock_spend(24);
  int error = 0;
  // whatever stops it, the answer is the mutex's own that it couldn't be had
  return thread_done(lwmutex_take(area, count, &error) ? 0 : ERROR_MUTEX_TRYLOCK_FAILED);
}
int sceKernelUnlockLwMutex(uint32_t area, int count) {
  call_starts();
  if (!psp_memory(area)) return thread_done(ERROR_ACCESS_ERROR);
  clock_spend(28);
  int32_t level = area_get(area, AREA_LEVEL);
  uint32_t attr = (uint32_t)area_get(area, AREA_ATTR);
  if (area_get(area, AREA_UID) == -1) return thread_done(ERROR_NO_SUCH_LWMUTEX);
  if (count <= 0) return thread_done(ERROR_ILLEGAL_COUNT);
  if (!(attr & MUTEX_RECURSIVE) && count > 1) return thread_done(ERROR_ILLEGAL_COUNT);
  if (level == 0 || area_get(area, AREA_THREAD) != thread_current()) return thread_done(ERROR_LWMUTEX_NOT_LOCKED);
  if (level < count) return thread_done(ERROR_LWMUTEX_UNLOCK_UNDERFLOW);
  area_set(area, AREA_LEVEL, level - count);
  if (level - count != 0) return thread_done(0);
  struct lwmutex *m = lwmutex_of(area_get(area, AREA_UID));
  if (!m) {
    area_set(area, AREA_THREAD, 0);
    return thread_done(0);
  }
  int woke = 0;
  while (!woke && m->waiters) {
    int i = (m->attr & MUTEX_PRIORITY) ? best_of(m->waiting, m->waiters) : 0;
    woke |= lwmutex_unlock_for(m, area, m->waiting[i], 0);
    list_remove(m->waiting, &m->waiters, i);
  }
  if (!woke) area_set(area, AREA_THREAD, 0);
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelReferLwMutexStatusByID(SceUID uid, uint32_t info) {
  call_starts();
  struct lwmutex *m = lwmutex_of(uid);
  if (!m) return thread_done(ERROR_NO_SUCH_LWMUTEX);
  if (!psp_memory(info)) return thread_done(-1);
  if (psp_read32(info) != 0) {
    for (int i = 0; i < m->waiters; i++) if (thread_waits(m->waiting[i], WAIT_LWMUTEX) != m->uid) list_remove(m->waiting, &m->waiters, i--);
    int32_t owner = area_get(m->area, AREA_THREAD);
    psp_write32(info, 64);
    write_name(info + 4, m->name);
    psp_write32(info + 36, m->attr);
    psp_write32(info + 40, (uint32_t)m->uid);
    psp_write32(info + 44, m->area);
    psp_write32(info + 48, (uint32_t)m->initial);
    psp_write32(info + 52, (uint32_t)area_get(m->area, AREA_LEVEL));
    psp_write32(info + 56, (uint32_t)(owner == 0 ? -1 : owner));
    psp_write32(info + 60, (uint32_t)m->waiters);
  }
  return thread_done(0);
}
int sceKernelReferLwMutexStatus(uint32_t area, uint32_t info) {
  if (!psp_memory(area)) {
    call_starts();
    return thread_done(ERROR_ACCESS_ERROR);
  }
  return sceKernelReferLwMutexStatusByID(area_get(area, AREA_UID), info);
}

// ---- callbacks -----------------------------------------------------------------------------------------------------------

struct callback { SceUID uid, thread; psp_callback entry; uint32_t argument; int notify_count, notify_argument; char name[32]; };
static struct callback callbacks[ROOM];
static SceUID exit_callback;

static struct callback *callback_of(SceUID uid) {
  for (int i = 0; i < ROOM; i++) if (callbacks[i].uid && callbacks[i].uid == uid) return &callbacks[i];
  return 0;
}

SceUID sceKernelCreateCallback(const char *name, psp_callback entry, uint32_t argument) {
  call_starts();
  if (!name) return thread_done(PSP_ERROR_ERROR);
  struct callback *c = 0;
  for (int i = 0; i < ROOM && !c; i++) if (!callbacks[i].uid) c = &callbacks[i];
  if (!c) __builtin_trap();
  *c = (struct callback){ .uid = kernel_new_uid(), .thread = thread_current(), .entry = entry, .argument = argument };
  copy_name(c->name, name);
  return thread_done(c->uid);
}
int sceKernelDeleteCallback(SceUID uid) {
  call_starts();
  struct callback *c = callback_of(uid);
  if (!c) return thread_done(ERROR_UNKNOWN_CBID);
  c->uid = 0;
  return thread_done(0);
}
int sceKernelRegisterExitCallback(SceUID uid) {
  call_starts();
  // one that isn't a callback is let be, as for a program that names no version of the system
  if (callback_of(uid)) exit_callback = uid;
  return thread_done(0);
}
int sceKernelCheckCallback(void) {
  call_starts();
  clock_spend(230);
  return thread_done(0);
}
int sceKernelGetCallbackCount(SceUID uid) {
  call_starts();
  struct callback *c = callback_of(uid);
  return thread_done(c ? c->notify_count : ERROR_UNKNOWN_CBID);
}
int sceKernelReferCallbackStatus(SceUID uid, uint32_t info) {
  call_starts();
  struct callback *c = callback_of(uid);
  if (!c) return thread_done(ERROR_UNKNOWN_CBID);
  if (psp_memory(info) && psp_read32(info) != 0) {
    psp_write32(info, 56);
    write_name(info + 4, c->name);
    psp_write32(info + 36, (uint32_t)c->thread);
    psp_write32(info + 40, (uint32_t)(uintptr_t)c->entry);
    psp_write32(info + 44, c->argument);
    psp_write32(info + 48, (uint32_t)c->notify_count);
    psp_write32(info + 52, (uint32_t)c->notify_argument);
  }
  return thread_done(0);
}

void mutex_power(void) {
  for (int i = 0; i < ROOM; i++) {
    mutexes[i].uid = 0;
    lwmutexes[i].uid = 0;
    callbacks[i].uid = 0;
    timeouts[i].thread = 0;
  }
  helds = 0;
  exit_callback = 0;
}
