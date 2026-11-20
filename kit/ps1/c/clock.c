// The PlayStation's clock, as a game's interrupts see it: the frame's time, from one V-blank to the next, the three
// root counters, the interrupt controller's status and mask, and every event the kit's chips set for a later cycle, on
// one queue (kit/ps1/c/README.md). Each number is PCSX ReARMed's, at the commit tools/consoles.mjs fixes, from the file
// named beside it, as `prove` compares a Dreamport with that emulator.
//
// A frame starts just after a V-blank, where a game's main loop wakes, and runs its step there, all at once, as the
// kit has no way to count its instructions; then the clock goes through the frame's events to the next V-blank, running
// the game's interrupt handler, game_interrupt, at each one that sets an interrupt the game lets in. A step that waits
// for something within the frame, as a game waits for the CD, calls ps1_wait, which goes on to the next event.

#include "ps1-kit.h"

// libpcsxcore/psxcommon.h: the processor's clock; psxcounters.c: a frame of 60 a second, its lines, the first
// V-blank's line, and the steps of the hsync clock, 2146.31 cycles a line in 12 bits of fraction
enum { CLOCK = 33868800, FRAME = CLOCK / 60, LINE = CLOCK / 60 / 263, VBLANK_LINE = 240, LINE_STEP = 8791293 };
// where the first V-blank comes after power, and every later one, a frame apart (psxcounters.c, scheduleRcntBase)
#define FIRST_VBLANK ((uint32_t)((uint64_t)VBLANK_LINE * LINE_STEP >> 12))

// a root counter's mode bits (psxcounters.c)
enum {
  SYNC = 0x0001, RESET_AT_TARGET = 0x0008, IRQ_ON_TARGET = 0x0010, IRQ_ON_OVERFLOW = 0x0020, IRQ_REPEAT = 0x0040,
  CLOCK_SOURCE = 0x0100, DIVIDE_8 = 0x0200, IRQ_DONE = 0x0400, REACHED_TARGET = 0x0800, OVERFLOWED = 0x1000,
};

static struct {
  uint16_t mode, target;
  uint32_t start, rate, until;
  int to_target, irq_given;
} counters[3];

static struct {
  uint32_t now, frame_end;
  uint32_t status, mask;
  int interrupts_on;
  struct { int set; uint32_t at; void (*run)(void); } events[CLOCK_EVENTS];
} clock;

__attribute__((weak)) void game_interrupt(void) {}

uint32_t clock_now(void) { return clock.now; }

void clock_event(int which, uint32_t after, void (*run)(void)) {
  clock.events[which].set = 1;
  clock.events[which].at = clock.now + after;
  clock.events[which].run = run;
}

void clock_cancel(int which) { clock.events[which].set = 0; }

// the handler runs while an interrupt is set that the game lets in, and it has interrupts on
static void deliver(void) {
  for (int times = 0; times < 16 && clock.interrupts_on && clock.status & clock.mask; times++) game_interrupt();
}

void clock_interrupt(uint32_t bits) {
  clock.status |= bits;
  deliver();
}

void ps1_interrupts(int on) {
  clock.interrupts_on = on;
  deliver();
}

// The root counters, as psxcounters.c counts them: each counts from `start` at `rate` cycles a step, to its target or
// to 0x10000, whichever it's counting to, `until` cycles from its start.
static uint32_t counter_value(int i) {
  uint32_t count = clock.now - counters[i].start;
  if (counters[i].rate > 1) count /= counters[i].rate;
  return count & 0xFFFF;
}

static void counter_count(int i, uint32_t value) {
  value &= 0xFFFF;
  counters[i].start = clock.now - value * counters[i].rate;
  if (value < counters[i].target) {
    counters[i].until = counters[i].target * counters[i].rate;
    counters[i].to_target = 1;
  } else {
    counters[i].until = 0x10000 * counters[i].rate;
    counters[i].to_target = 0;
  }
}

static void counter_irq(int i) {
  if (counters[i].mode & IRQ_REPEAT || !counters[i].irq_given) {
    counters[i].irq_given = 1;
    clock.status |= 0x10u << i;
  }
}

// a counter reaching its target or 0x10000 (psxcounters.c, psxRcntReset)
static void counter_reached(int i) {
  counters[i].mode |= IRQ_DONE;
  if (counters[i].to_target) {
    uint32_t passed = clock.now - counters[i].start;
    if (counters[i].mode & RESET_AT_TARGET) {
      passed -= counters[i].target * counters[i].rate;
      counters[i].start = clock.now - passed;
    } else {
      counters[i].until = 0x10000 * counters[i].rate;
      counters[i].to_target = 0;
    }
    if (counters[i].mode & IRQ_ON_TARGET) counter_irq(i);
    counters[i].mode |= REACHED_TARGET;
    if (passed < 0x10000 * counters[i].rate) return;
  }
  uint32_t passed = clock.now - counters[i].start - 0x10000 * counters[i].rate;
  counters[i].start = clock.now - passed;
  if (passed < counters[i].target * counters[i].rate) {
    counters[i].until = counters[i].target * counters[i].rate;
    counters[i].to_target = 1;
  }
  if (counters[i].mode & IRQ_ON_OVERFLOW) counter_irq(i);
  counters[i].mode |= OVERFLOWED;
}

static void counters_set(void);

static void counters_due(void) {
  for (int i = 0; i < 3; i++) {
    for (int guard = 0; guard < 4 && counters[i].rate != 0xFFFFFFFF && clock.now - counters[i].start >= counters[i].until; guard++) counter_reached(i);
  }
  counters_set();
  deliver();
}

// the next cycle a counter reaches its target or 0x10000, as the counters' one event (psxcounters.c, psxRcntSet)
static void counters_set(void) {
  uint32_t next = 0x7FFFFFFF;
  for (int i = 0; i < 3; i++) {
    if (counters[i].rate == 0xFFFFFFFF) continue;
    int32_t left = (int32_t)(counters[i].until - (clock.now - counters[i].start));
    if (left < 0) left = 0;
    if ((uint32_t)left < next) next = (uint32_t)left;
  }
  if (next != 0x7FFFFFFF) clock_event(CLOCK_COUNTERS, next, counters_due);
  else clock_cancel(CLOCK_COUNTERS);
}

static void counter_mode(int i, uint32_t value) {
  counters[i].mode = (uint16_t)value;
  // psxcounters.c, _psxRcntWmode: counter 0's dot clock counted as 5 cycles, counter 1's hsync as a line's, counter
  // 2's eighth as 8, and counter 2 stopped by its sync mode
  if (i == 0) counters[i].rate = value & CLOCK_SOURCE ? 5 : 1;
  else if (i == 1) counters[i].rate = value & CLOCK_SOURCE ? LINE : 1;
  else {
    counters[i].rate = value & DIVIDE_8 ? 8 : 1;
    if ((value & 7) == (SYNC | 0) || (value & 7) == (SYNC | 6)) counters[i].rate = 0xFFFFFFFF;
  }
}

// each frame's line 0, where counter 1 counting lines drops what's left of a line, as the frame is a few cycles longer
// than its lines (psxcounters.c, psxRcntUpdate)
static void frame_line0(void) {
  if (counters[1].mode & CLOCK_SOURCE && (counters[1].mode & 7) != (SYNC | 2) && (counters[1].mode & 7) != (SYNC | 4)) {
    counter_count(1, (clock.now - counters[1].start) / counters[1].rate);
    counters_set();
  }
  clock_event(CLOCK_LINE0, FRAME, frame_line0);
}

void clock_power(void) {
  clock.now = 0;
  clock.frame_end = FIRST_VBLANK;
  // libpcsxcore/psxbios.c, psxBiosSetupBootState: the BIOS leaves the CD's and DMA's interrupts let in, and the
  // V-blank's set
  clock.status = 0x1;
  clock.mask = 0xC;
  clock.interrupts_on = 0;
  for (int i = 0; i < CLOCK_EVENTS; i++) clock.events[i].set = 0;
  for (int i = 0; i < 3; i++) {
    counters[i].target = 0;
    counters[i].irq_given = 0;
    counter_mode(i, 0);
    counter_count(i, 0);
  }
  counters_set();
  clock_event(CLOCK_LINE0, FRAME, frame_line0);
}

int ps1_wait(void) {
  int next = -1;
  for (int i = 0; i < CLOCK_EVENTS; i++) {
    if (!clock.events[i].set || (int32_t)(clock.events[i].at - clock.frame_end) > 0) continue;
    if (next < 0 || (int32_t)(clock.events[i].at - clock.events[next].at) < 0) next = i;
  }
  if (next < 0) return 0;
  if ((int32_t)(clock.events[next].at - clock.now) > 0) clock.now = clock.events[next].at;
  clock.events[next].set = 0;
  clock.events[next].run();
  return 1;
}

void clock_frame_end(void) {
  while (ps1_wait()) {}
  clock.now = clock.frame_end;
  clock.frame_end += FRAME;
  clock_interrupt(0x1);
}

uint32_t irq_read(uint32_t address) { return clock_read(address); }
void irq_write(uint32_t address, uint32_t value) { clock_write(address, value); }
uint32_t timer_read(uint32_t address) { return clock_read(address); }
void timer_write(uint32_t address, uint32_t value) { clock_write(address, value); }

uint32_t clock_read(uint32_t address) {
  if (address == 0x1F801070) return clock.status;
  if (address == 0x1F801074) return clock.mask;
  if (address >= 0x1F801100 && address < 0x1F801130) {
    int i = (address >> 4) & 3;
    switch (address & 0xF) {
      case 0x0: return counter_value(i);
      case 0x4: {
        // psxcounters.c, psxRcntRmode: reading the mode clears its reached-target and overflowed bits
        uint32_t mode = counters[i].mode;
        counters[i].mode &= 0xE7FF;
        return mode;
      }
      case 0x8: return counters[i].target;
    }
  }
  return 0;
}

void clock_write(uint32_t address, uint32_t value) {
  if (address == 0x1F801070) {
    clock.status &= value;
    return;
  }
  if (address == 0x1F801074) {
    clock.mask = value & 0x7FF;
    deliver();
    return;
  }
  if (address >= 0x1F801100 && address < 0x1F801130) {
    int i = (address >> 4) & 3;
    switch (address & 0xF) {
      case 0x0: counter_count(i, value); break;
      case 0x4:
        counter_mode(i, value);
        counter_count(i, 0);
        counters[i].irq_given = 0;
        break;
      case 0x8:
        counters[i].target = (uint16_t)value;
        counter_count(i, counter_value(i));
        break;
    }
    counters_set();
  }
}
