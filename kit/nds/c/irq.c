// Each Nintendo DS processor's interrupt registers, its display status and its four timers (kit/nds/c/README.md), as
// melonDS, the reference emulator, has them (its NDS.cpp and GPU.cpp): IME, IE and IF, which a write of a 1 clears; the
// display status's bits a game sets, the V-blank's interrupt and the line it matches; and the timers, counting the
// console's clock, a 64th, a 256th or a 1024th of it, or the timer before's overflows, reloading as each overflows and
// asking for its interrupt. Each interrupt a game can ask for that isn't here stops it where it turns its source on,
// as with the H-blank's and the line count's. A processor's interrupts are raised up to its time when it reads or writes (nds.c), each at
// its own time: a timer's as it overflows, where melonDS finds it at the end of the instructions it runs at once, up to
// 64 ticks of the clock later. Each processor's side is told apart by `seven`.

#include "nds.h"
#include "nds-kit.h"

static uint32_t ime[2], ie[2], flags[2];
static uint16_t stat[2];             // the display status's bits a game writes: its interrupts and the line it matches
static uint64_t seen[2];             // the time each processor's display interrupts are raised up to

// the timers, the ARM9's four and then the ARM7's, their counts kept in 1024ths as melonDS keeps them
typedef struct { uint16_t reload, control; uint32_t counter; } nds_timer;
static nds_timer timers[8];
static uint64_t timer_time[2];
// how many 1024ths of a count each tick of the clock adds, by the timer's rate
static const int SHIFT[4] = { 10, 4, 2, 0 };

void nds_irq_power(void) {
  for (int p = 0; p < 2; p++) ime[p] = ie[p] = flags[p] = stat[p] = 0, seen[p] = timer_time[p] = 0;
  for (int i = 0; i < 8; i++) timers[i] = (nds_timer){ 0, 0, 0 };
}

void nds_irq_raise(int seven, int irq) { flags[seven] |= 1u << irq; }
uint32_t nds_irq_pending(int seven) { return ie[seven] & flags[seven]; }
int nds_irq_master(int seven) { return ime[seven] & 1; }
uint32_t nds_irq_enabled(int seven) { return ie[seven]; }

static int counts_up(int id) { return (timers[id].control & 0x84) == 0x84 && (id & 3); }
static int runs_alone(int id) { return (timers[id].control & 0x84) == 0x80; }

// a timer's overflow, with the timers after it that count overflows, as melonDS's HandleTimerOverflow
static void overflow(int id) {
  nds_timer *t = &timers[id];
  t->counter += (uint32_t)t->reload << 10;
  if (t->control & 0x40) nds_irq_raise(id >> 2, 3 + (id & 3));
  while ((id & 3) != 3) {
    t = &timers[++id];
    if ((t->control & 0x84) != 0x84) break;
    t->counter += 1 << 10;
    if (!(t->counter >> 26)) break;
    t->counter = (uint32_t)t->reload << 10;
    if (t->control & 0x40) nds_irq_raise(id >> 2, 3 + (id & 3));
  }
}

static void run_timers(int seven, uint64_t now) {
  if (now <= timer_time[seven]) return;
  uint64_t ticks = now - timer_time[seven];
  timer_time[seven] = now;
  for (int id = seven * 4; id < seven * 4 + 4; id++) {
    if (!runs_alone(id)) continue;
    nds_timer *t = &timers[id];
    uint64_t count = (uint64_t)t->counter + (ticks << SHIFT[t->control & 3]);
    while (count >> 26) {
      count -= 1u << 26;
      t->counter = (uint32_t)count;
      overflow(id);
      count = t->counter;
    }
    t->counter = (uint32_t)count;
  }
}

// when timer `id` next overflows for the `n`th time from timer_time, or never
static uint64_t overflow_at(int id, uint64_t n) {
  nds_timer *t = &timers[id];
  if (runs_alone(id)) {
    int shift = SHIFT[t->control & 3];
    uint64_t first = (((uint64_t)1 << 26) - t->counter + ((uint64_t)1 << shift) - 1) >> shift;
    uint64_t each = (((uint64_t)1 << 26) - ((uint64_t)t->reload << 10)) >> shift;
    return timer_time[id >> 2] + first + (n - 1) * each;
  }
  if (!counts_up(id)) return UINT64_MAX;
  uint64_t first = 0x10000 - (t->counter >> 10), each = 0x10000 - t->reload;
  return overflow_at(id - 1, first + (n - 1) * each);
}

// the V-blank's start, line 192, of the frame at or after `after`
static uint64_t vblank_after(uint64_t after) {
  uint64_t f = after <= NDS_VBLANK ? 0 : (after - NDS_VBLANK + NDS_FRAME - 1) / NDS_FRAME;
  return f * NDS_FRAME + NDS_VBLANK;
}

void nds_irq_run(int seven, uint64_t now) {
  run_timers(seven, now);
  if (now <= seen[seven]) return;
  // the V-blank's interrupt, which the display status asks for as each V-blank starts
  if ((stat[seven] & 0x08) && vblank_after(seen[seven] + 1) <= now) nds_irq_raise(seven, 0);
  seen[seven] = now;
}

uint64_t nds_irq_next(int seven) {
  uint64_t next = UINT64_MAX;
  if ((stat[seven] & 0x08) && (ie[seven] & 1)) next = vblank_after(seen[seven] + 1);
  for (int k = 0; k < 4; k++) {
    int id = seven * 4 + k;
    if (!(timers[id].control & 0x40) || !(ie[seven] & (8u << k))) continue;
    uint64_t at = overflow_at(id, 1);
    if (at < next) next = at;
  }
  return next;
}

// the display's status as a processor reads it at `now`: the V-blank's flag from line 192 to 261, the H-blank's for the
// end of each line, the line count's when it's the line the game set, and the bits the game wrote
uint32_t nds_irq_dispstat(int seven, uint64_t now) {
  uint64_t in_frame = now % NDS_FRAME;
  uint32_t line = (uint32_t)(in_frame / NDS_LINE), dot = (uint32_t)(in_frame % NDS_LINE);
  uint32_t match = (uint32_t)(stat[seven] >> 8) | (uint32_t)(stat[seven] & 0x80) << 1;
  return stat[seven] | (line >= 192 && line < 262 ? 1 : 0) | (dot >= 1584 ? 2 : 0) | (line == match ? 4 : 0);
}

int nds_irq_read(int seven, uint64_t now, uint32_t address, int bytes, uint32_t *value) {
  if (address >= 0x04000100 && address < 0x04000110) {
    nds_timer *t = &timers[seven * 4 + ((address - 0x04000100) >> 2)];
    if (bytes == 1) nds_not_yet();
    run_timers(seven, now);
    uint32_t counter = t->counter >> 10;
    if (address & 2) *value = t->control;
    else *value = bytes == 4 ? counter | (uint32_t)t->control << 16 : counter;
    return 1;
  }
  switch (address) {
  case 0x04000208: *value = ime[seven]; return 1;
  case 0x04000210: if (bytes == 1) nds_not_yet(); *value = bytes == 2 ? ie[seven] & 0xFFFF : ie[seven]; return 1;
  case 0x04000212: *value = ie[seven] >> 16; return 1;
  case 0x04000214: if (bytes == 1) nds_not_yet(); *value = bytes == 2 ? flags[seven] & 0xFFFF : flags[seven]; return 1;
  case 0x04000216: *value = flags[seven] >> 16; return 1;
  }
  return 0;
}

// a timer's control written, as melonDS's TimerStart: started, it counts from its reload
static void start(int id, uint16_t control, uint64_t now) {
  nds_timer *t = &timers[id];
  run_timers(id >> 2, now);
  if (!(t->control & 0x80) && (control & 0x80)) t->counter = (uint32_t)t->reload << 10;
  t->control = control;
}

int nds_irq_write(int seven, uint64_t now, uint32_t address, uint32_t value, int bytes) {
  if (address >= 0x04000100 && address < 0x04000110) {
    int id = seven * 4 + (int)((address - 0x04000100) >> 2);
    if (bytes == 1) nds_not_yet();
    if (bytes == 4) {
      timers[id].reload = (uint16_t)value;
      start(id, (uint16_t)(value >> 16), now);
    } else if (address & 2) start(id, (uint16_t)value, now);
    else timers[id].reload = (uint16_t)value;
    return 1;
  }
  if (address == NDS_DISPSTAT || address == NDS_DISPSTAT + 1) {
    // a word written there writes the line count too, which isn't here yet
    if (bytes == 4) nds_not_yet();
    uint32_t mask = bytes == 1 ? (address & 1 ? 0xFF00 : 0x00FF) : 0xFFFF;
    if (address & 1) value <<= 8;
    // the H-blank's and the line count's interrupts aren't here yet
    if (value & mask & 0x30) nds_not_yet();
    stat[seven] = (uint16_t)((stat[seven] & ~mask) | (value & mask & 0xFFB8));
    return 1;
  }
  switch (address) {
  case 0x04000208: ime[seven] = value & 1; return 1;
  case 0x04000210:
    if (bytes == 1) nds_not_yet();
    ie[seven] = bytes == 2 ? (ie[seven] & 0xFFFF0000) | value : value;
    return 1;
  case 0x04000212:
    if (bytes != 2) nds_not_yet();
    ie[seven] = (ie[seven] & 0xFFFF) | value << 16;
    return 1;
  case 0x04000214:
    // melonDS's ARM7 takes no halfword written to IF, where the console's would: it stops a game, so it never shows
    // what either wouldn't
    if (bytes == 1 || (seven && bytes == 2)) nds_not_yet();
    flags[seven] &= ~value;
    return 1;
  case 0x04000216:
    if (bytes != 2 || seven) nds_not_yet();
    flags[seven] &= ~(value << 16);
    return 1;
  }
  return 0;
}
