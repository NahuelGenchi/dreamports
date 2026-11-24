// Semaphores and event flags, as the console's emulator in the proof tools answers them (PPSSPP's sceKernelSemaphore
// and sceKernelEventFlag): what each call takes of the processor's time, which waiting thread each wakes and when, and
// how a wait's timeout runs out.
//
// A thread that waits is put at the end of its semaphore's or flag's list, which a semaphore made with its priority
// attribute sorts by the threads' priorities each time it's signalled. A thread whose wait timed out stays in the list
// until a signal or a look at the list passes over it, as it does in the emulator, so it still counts where the
// emulator counts it: in whether a semaphore would overflow, and whether anyone waits. The numbers the system gives
// them are counted with the threads' (kernel_new_uid).

#include "psp-kit.h"

#define ROOM 64
#define WAITERS 64
#define CYCLES_A_MICROSECOND (PSP_CYCLES_A_SECOND / 1000000)

enum {
  ERROR_ILLEGAL_MODE = (int)0x80020195, ERROR_UNKNOWN_SEMID = (int)0x80020199, ERROR_UNKNOWN_EVFID = (int)0x8002019A, ERROR_WAIT_TIMEOUT = (int)0x800201A8,
  ERROR_WAIT_CANCEL = (int)0x800201A9, ERROR_SEMA_ZERO = (int)0x800201AD, ERROR_SEMA_OVF = (int)0x800201AE, ERROR_EVF_COND = (int)0x800201AF,
  ERROR_EVF_MULTI = (int)0x800201B0, ERROR_EVF_ILPAT = (int)0x800201B1, ERROR_WAIT_DELETE = (int)0x800201B5, ERROR_ILLEGAL_COUNT = (int)0x800201BD,
};
enum { SEMA_PRIORITY = 0x100, FLAG_MULTIPLE = 0x200, WAIT_OR = 0x01, WAIT_CLEAR_ALL = 0x10, WAIT_CLEAR = 0x20 };

// each waiting thread's timeout, where it gave one: where the console keeps how long, which a wake writes what's left to
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

static void copy_name(char *to, const char *name) {
  int i = 0;
  for (; name[i] && i < 31; i++) to[i] = name[i];
  for (; i < 32; i++) to[i] = 0;
}
static void write_name(uint32_t at, const char *name) {
  for (int i = 0; i < 32; i++) psp_write8(at + (uint32_t)i, (uint8_t)name[i]);
}

// ---- semaphores ----------------------------------------------------------------------------------------------------------

struct sema { SceUID uid; uint32_t attr; int init, current, max, waiters; char name[32]; SceUID waiting[WAITERS]; };
static struct sema semas[ROOM];

static struct sema *sema_of(SceUID uid) {
  for (int i = 0; i < ROOM; i++) if (semas[i].uid && semas[i].uid == uid) return &semas[i];
  return 0;
}
static void sema_timeout(uint64_t data, int late);

// A thread of the list let go, when what it wants is there or with `result`, or one no longer waiting taken off:
// whether it comes off the list.
static int sema_unlock(struct sema *s, SceUID thread, int result, int *woke) {
  if (thread_waits(thread, WAIT_SEMA) != s->uid) return 1;
  if (result == 0) {
    int wanted = (int)thread_wait_value(thread);
    if (wanted > s->current) return 0;
    s->current -= wanted;
  }
  uint32_t at = timeout_of(thread);
  if (at) {
    int64_t left = clock_left(sema_timeout, (uint64_t)thread);
    clock_unschedule(sema_timeout, (uint64_t)thread);
    if (left < 0) left = 0;
    psp_write32(at, (uint32_t)(left / CYCLES_A_MICROSECOND));
  }
  thread_wake(thread, result);
  *woke = 1;
  return 1;
}
static void sema_remove(struct sema *s, int i) {
  for (int j = i; j < s->waiters - 1; j++) s->waiting[j] = s->waiting[j + 1];
  s->waiters--;
}
static int sema_clear(struct sema *s, int reason) {
  int woke = 0;
  for (int i = 0; i < s->waiters; i++) sema_unlock(s, s->waiting[i], reason, &woke);
  s->waiters = 0;
  return woke;
}

// A wait that ran out: the thread goes on with the error, the threads are put in order, and in a semaphore that wakes
// its threads in the order they came, those after it that can have what they want now have it.
static void sema_timeout(uint64_t data, int late) {
  (void)late;
  SceUID thread = (SceUID)data;
  struct sema *s = sema_of(thread_waits(thread, WAIT_SEMA));
  if (!s) return;
  uint32_t at = timeout_of(thread);
  if (at) psp_write32(at, 0);
  thread_wake(thread, ERROR_WAIT_TIMEOUT);
  thread_reschedule();
  if (!(s->attr & SEMA_PRIORITY)) {
    int woke = 0;
    while (s->waiters && sema_unlock(s, s->waiting[0], 0, &woke)) sema_remove(s, 0);
  }
}

SceUID sceKernelCreateSema(const char *name, uint32_t attr, int init, int max, uint32_t options) {
  call_starts();
  if (!name) return thread_done(PSP_ERROR_ERROR);
  if (attr >= 0x200) return thread_done(PSP_ERROR_ILLEGAL_ATTR);
  struct sema *s = 0;
  for (int i = 0; i < ROOM && !s; i++) if (!semas[i].uid) s = &semas[i];
  if (!s) __builtin_trap();
  *s = (struct sema){ .uid = kernel_new_uid(), .attr = attr, .init = init, .current = init, .max = max };
  copy_name(s->name, name);
  (void)options;
  return thread_done(s->uid);
}
int sceKernelDeleteSema(SceUID uid) {
  call_starts();
  struct sema *s = sema_of(uid);
  if (!s) return thread_done(ERROR_UNKNOWN_SEMID);
  int woke = sema_clear(s, ERROR_WAIT_DELETE);
  s->uid = 0;
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelSignalSema(SceUID uid, int signal) {
  call_starts();
  struct sema *s = sema_of(uid);
  if (!s) return thread_done(ERROR_UNKNOWN_SEMID);
  if (s->current + signal - s->waiters > s->max) return thread_done(ERROR_SEMA_OVF);
  s->current += signal;
  if (s->attr & SEMA_PRIORITY) {
    // by priority, the threads of one priority in the order they came
    for (int i = 1; i < s->waiters; i++) {
      SceUID moving = s->waiting[i];
      int j = i;
      while (j > 0 && thread_priority(s->waiting[j - 1]) > thread_priority(moving)) {
        s->waiting[j] = s->waiting[j - 1];
        j--;
      }
      s->waiting[j] = moving;
    }
  }
  int woke = 0;
  for (int i = 0; i < s->waiters; i++) {
    if (sema_unlock(s, s->waiting[i], 0, &woke)) {
      sema_remove(s, i);
      i = -1;
    }
  }
  clock_spend(900);
  return woke ? thread_answer(0) : thread_done(0);
}
static int wait_sema(SceUID uid, int wanted, uint32_t timeout) {
  call_starts();
  clock_spend(900);
  if (wanted <= 0) return thread_done(ERROR_ILLEGAL_COUNT);
  clock_spend(500);
  struct sema *s = sema_of(uid);
  if (!s) return thread_done(ERROR_UNKNOWN_SEMID);
  if (wanted > s->max) return thread_done(ERROR_ILLEGAL_COUNT);
  if (s->current >= wanted && s->waiters == 0) {
    s->current -= wanted;
    return thread_done(0);
  }
  SceUID me = thread_current();
  int listed = 0;
  for (int i = 0; i < s->waiters; i++) listed |= s->waiting[i] == me;
  if (!listed) {
    if (s->waiters == WAITERS) __builtin_trap();
    s->waiting[s->waiters++] = me;
  }
  if (timeout) {
    // as the console times them: three microseconds or less is 24, and up to 249 is 245
    int micro = (int)psp_read32(timeout);
    if (micro <= 3) micro = 24;
    else if (micro <= 249) micro = 245;
    clock_schedule((int64_t)micro * CYCLES_A_MICROSECOND, sema_timeout, (uint64_t)me);
  }
  set_timeout(me, timeout);
  thread_wait(WAIT_SEMA, uid, (uint32_t)wanted);
  return thread_answer(0);
}
int sceKernelWaitSema(SceUID uid, int wanted, uint32_t timeout) { return wait_sema(uid, wanted, timeout); }
int sceKernelPollSema(SceUID uid, int wanted) {
  call_starts();
  if (wanted <= 0) return thread_done(ERROR_ILLEGAL_COUNT);
  struct sema *s = sema_of(uid);
  if (!s) return thread_done(ERROR_UNKNOWN_SEMID);
  if (s->current >= wanted && s->waiters == 0) {
    s->current -= wanted;
    return thread_done(0);
  }
  return thread_done(ERROR_SEMA_ZERO);
}
int sceKernelReferSemaStatus(SceUID uid, uint32_t info) {
  call_starts();
  struct sema *s = sema_of(uid);
  if (!s) return thread_done(ERROR_UNKNOWN_SEMID);
  if (!psp_memory(info)) return thread_done(-1);
  // those whose wait ended come off the list first
  for (int i = 0; i < s->waiters; i++) if (thread_waits(s->waiting[i], WAIT_SEMA) != s->uid) sema_remove(s, i--);
  if (psp_read32(info) != 0) {
    psp_write32(info, 56);
    write_name(info + 4, s->name);
    psp_write32(info + 36, s->attr);
    psp_write32(info + 40, (uint32_t)s->init);
    psp_write32(info + 44, (uint32_t)s->current);
    psp_write32(info + 48, (uint32_t)s->max);
    psp_write32(info + 52, (uint32_t)s->waiters);
  }
  return thread_done(0);
}

// ---- event flags ---------------------------------------------------------------------------------------------------------

struct flag_waiter { SceUID thread; uint32_t bits, wait, out; };
struct flag { SceUID uid; uint32_t attr, init, current; int waiters; char name[32]; struct flag_waiter waiting[WAITERS]; };
static struct flag flags[ROOM];

static struct flag *flag_of(SceUID uid) {
  for (int i = 0; i < ROOM; i++) if (flags[i].uid && flags[i].uid == uid) return &flags[i];
  return 0;
}
static void flag_timeout(uint64_t data, int late);

// whether `bits` match the pattern in the way asked, and if they do, the pattern as it was written to `out` and cleared
// as asked
static int flag_match(uint32_t *pattern, uint32_t bits, uint32_t wait, uint32_t out) {
  int matches = (wait & WAIT_OR) ? (bits & *pattern) != 0 : (bits & *pattern) == bits;
  if (!matches) return 0;
  if (psp_memory(out)) psp_write32(out, *pattern);
  if (wait & WAIT_CLEAR) *pattern &= ~bits;
  if (wait & WAIT_CLEAR_ALL) *pattern = 0;
  return 1;
}
static int flag_unlock(struct flag *f, struct flag_waiter *w, int result, int *woke) {
  if (thread_waits(w->thread, WAIT_EVENT_FLAG) != f->uid) return 1;
  if (result == 0) {
    if (!flag_match(&f->current, w->bits, w->wait, w->out)) return 0;
  } else if (psp_memory(w->out)) psp_write32(w->out, f->current);
  uint32_t at = timeout_of(w->thread);
  if (at) {
    int64_t left = clock_left(flag_timeout, (uint64_t)w->thread);
    clock_unschedule(flag_timeout, (uint64_t)w->thread);
    psp_write32(at, (uint32_t)(left / CYCLES_A_MICROSECOND));
  }
  thread_wake(w->thread, result);
  *woke = 1;
  return 1;
}
static void flag_remove(struct flag *f, int i) {
  for (int j = i; j < f->waiters - 1; j++) f->waiting[j] = f->waiting[j + 1];
  f->waiters--;
}
static int flag_clear(struct flag *f, int reason) {
  int woke = 0;
  for (int i = 0; i < f->waiters; i++) flag_unlock(f, &f->waiting[i], reason, &woke);
  f->waiters = 0;
  return woke;
}
// A wait that ran out: the thread goes on with the error and the pattern, and stays in the list until it's passed
// over. The threads aren't put in order till the system next does it.
static void flag_timeout(uint64_t data, int late) {
  (void)late;
  SceUID thread = (SceUID)data;
  struct flag *f = flag_of(thread_waits(thread, WAIT_EVENT_FLAG));
  if (!f) return;
  uint32_t at = timeout_of(thread);
  if (at) psp_write32(at, 0);
  for (int i = 0; i < f->waiters; i++) {
    if (f->waiting[i].thread != thread) continue;
    int woke = 0;
    flag_unlock(f, &f->waiting[i], ERROR_WAIT_TIMEOUT, &woke);
    break;
  }
}

SceUID sceKernelCreateEventFlag(const char *name, uint32_t attr, uint32_t pattern, uint32_t options) {
  call_starts();
  if (!name) return thread_done(PSP_ERROR_ERROR);
  if ((attr & 0x100) || attr >= 0x300) return thread_done(PSP_ERROR_ILLEGAL_ATTR);
  struct flag *f = 0;
  for (int i = 0; i < ROOM && !f; i++) if (!flags[i].uid) f = &flags[i];
  if (!f) __builtin_trap();
  *f = (struct flag){ .uid = kernel_new_uid(), .attr = attr, .init = pattern, .current = pattern };
  copy_name(f->name, name);
  (void)options;
  return thread_done(f->uid);
}
int sceKernelDeleteEventFlag(SceUID uid) {
  call_starts();
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  int woke = flag_clear(f, ERROR_WAIT_DELETE);
  f->uid = 0;
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelSetEventFlag(SceUID uid, uint32_t bits) {
  call_starts();
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  f->current |= bits;
  int woke = 0;
  for (int i = 0; i < f->waiters; i++) if (flag_unlock(f, &f->waiting[i], 0, &woke)) flag_remove(f, i--);
  clock_spend(430);
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelClearEventFlag(SceUID uid, uint32_t bits) {
  call_starts();
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  f->current &= bits;
  clock_spend(430);
  return thread_done(0);
}
int sceKernelCancelEventFlag(SceUID uid, uint32_t pattern, uint32_t waiting) {
  call_starts();
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  if (psp_memory(waiting)) psp_write32(waiting, (uint32_t)f->waiters);
  f->current = pattern;
  int woke = flag_clear(f, ERROR_WAIT_CANCEL);
  clock_spend(580);
  return woke ? thread_answer(0) : thread_done(0);
}
int sceKernelWaitEventFlag(SceUID uid, uint32_t bits, uint32_t wait, uint32_t out, uint32_t timeout) {
  call_starts();
  if (wait & ~(uint32_t)(WAIT_OR | WAIT_CLEAR | WAIT_CLEAR_ALL)) return thread_done(ERROR_ILLEGAL_MODE);
  if (bits == 0) return thread_done(ERROR_EVF_ILPAT);
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  if (flag_match(&f->current, bits, wait, out)) {
    clock_spend(500);
    return thread_done(0);
  }
  // one left in the list by a wait that ran out is taken off first
  SceUID me = thread_current();
  for (int i = 0; i < f->waiters; i++) if (f->waiting[i].thread == me) flag_remove(f, i--);
  uint32_t given = psp_memory(timeout) ? psp_read32(timeout) : 0xFFFFFFFFu;
  if (f->waiters > 0 && !(f->attr & FLAG_MULTIPLE)) return thread_done(ERROR_EVF_MULTI);
  if (f->waiters == WAITERS) __builtin_trap();
  // with no time to wait, the console sometimes doesn't write the pattern, and the emulator never does
  f->waiting[f->waiters++] = (struct flag_waiter){ me, bits, wait, given == 0 ? 0 : out };
  if (timeout) {
    // as the console times them: one microsecond or less is 25, and up to 209 is 240
    int micro = (int)psp_read32(timeout);
    if (micro <= 1) micro = 25;
    else if (micro <= 209) micro = 240;
    clock_schedule((int64_t)micro * CYCLES_A_MICROSECOND, flag_timeout, (uint64_t)me);
  }
  set_timeout(me, timeout);
  thread_wait(WAIT_EVENT_FLAG, uid, 0);
  clock_spend(500);
  return thread_answer(0);
}
int sceKernelPollEventFlag(SceUID uid, uint32_t bits, uint32_t wait, uint32_t out) {
  call_starts();
  if (wait & ~(uint32_t)(WAIT_OR | WAIT_CLEAR | WAIT_CLEAR_ALL)) return thread_done(ERROR_ILLEGAL_MODE);
  if ((wait & WAIT_CLEAR) && (wait & WAIT_CLEAR_ALL)) return thread_done(ERROR_ILLEGAL_MODE);
  if (bits == 0) return thread_done(ERROR_EVF_ILPAT);
  clock_spend(360);
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  if (flag_match(&f->current, bits, wait, out)) return thread_done(0);
  if (psp_memory(out)) psp_write32(out, f->current);
  if (f->waiters > 0 && !(f->attr & FLAG_MULTIPLE)) return thread_done(ERROR_EVF_MULTI);
  return thread_done(ERROR_EVF_COND);
}
int sceKernelReferEventFlagStatus(SceUID uid, uint32_t info) {
  call_starts();
  struct flag *f = flag_of(uid);
  if (!f) return thread_done(ERROR_UNKNOWN_EVFID);
  if (!psp_memory(info)) return thread_done(-1);
  for (int i = 0; i < f->waiters; i++) if (thread_waits(f->waiting[i].thread, WAIT_EVENT_FLAG) != f->uid) flag_remove(f, i--);
  if (psp_read32(info) != 0) {
    psp_write32(info, 52);
    write_name(info + 4, f->name);
    psp_write32(info + 36, f->attr);
    psp_write32(info + 40, f->init);
    psp_write32(info + 44, f->current);
    psp_write32(info + 48, (uint32_t)f->waiters);
  }
  return thread_done(0);
}

void sync_power(void) {
  for (int i = 0; i < ROOM; i++) {
    semas[i].uid = 0;
    flags[i].uid = 0;
    timeouts[i].thread = 0;
  }
}
