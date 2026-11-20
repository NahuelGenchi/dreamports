// The Super Nintendo's sound side, as kit/snes/c/snes.h says: the sound processor's memory and registers, the four
// ports between it and the main processor, its three timers, the console's start-up program, and the time the sound
// chip (dsp.c) plays in.
//
// Time here is the sound processor's cycles, 32 to each of the sound chip's samples and CONSOLE_SOUND_RATE samples a
// second, as Snes9x has them, and each frame lasts its share of them. The sound program's twin runs in turns, at the
// moments something new is there for it: as one of its timers counts, and when the main program, having written a
// port, reads one. A turn takes none of the sound processor's time, as its original's work after a timer's count takes
// a few hundred cycles of the thousands between two; the sound chip runs up to each turn first, so what the program
// writes to it lands where the console's does, to its timer's count. The main program's frame takes none either: what
// it writes to the ports is there at the frame's start, and a main program that waits for an answer, reading a port
// that doesn't change, waits as long as the console's does, to the sound program's next turn.
//
// The console's start-up program, 64 bytes in the sound processor's own ROM, which never leaves the console, is the
// kit's own here, written as what it does: it says $AA and $BB on the first two ports, waits for $CC, takes the bytes
// the main processor sends into the memory where it says, saying back each one's count, and sends the sound processor
// where it's told, to the game's twin of the program it sent, game_spc. Reading the ROM itself, at $FFC0, reads the
// memory there instead.

#include "snes-kit.h"

uint8_t snes_aram[0x10000];

// the sound processor's cycles to each of the sound chip's samples, and to each step of its timers: 8 kHz for the
// first two and 64 kHz for the third
enum { CYCLES_PER_SAMPLE = 32 };
static const uint32_t TIMER_STEP[3] = { 128, 128, 16 };

// how many of the sound processor's cycles the next frame lasts: CONSOLE_FRAME_TICKS of a clock of CONSOLE_CLOCK, with
// what's left over carried to the next
static uint64_t frame_left;
static uint32_t frame_cycles(void) {
  uint64_t total = (uint64_t)CONSOLE_FRAME_TICKS * CONSOLE_SOUND_RATE * CYCLES_PER_SAMPLE + frame_left;
  frame_left = total % CONSOLE_CLOCK;
  return (uint32_t)(total / CONSOLE_CLOCK);
}

// the ports: what the main processor wrote, which the sound processor reads at $F4 to $F7, and what the sound
// processor wrote, which the main one reads at $2140 to $2143, kept with the main processor's other registers
static uint8_t from_main[4];
#define TO_MAIN (SNES_B_REGISTERS + 0x40)
// $F2, the sound chip's register $F3 reaches, and $F8 and $F9, two bytes of the sound processor's own
static uint8_t dsp_address, extra[2];
// each timer: whether it runs, its period in steps, and its three stages, the steps, the steps of its period, and the
// periods counted, which a read takes
static struct timer {
  int enable;
  uint8_t target, stage1, stage2, stage3;
} timers[3];
// the sound side's time, and where the frame so far ends
static uint64_t now, frame_end;
// what the sound processor runs: the start-up program, the game's, or nothing, once that came back
static enum { FIRMWARE, PROGRAM, STOPPED } running;
static uint16_t sent_to;
// whether the main program wrote a port since the sound side last looked; and for each port, what the main program
// last read there and how many reads in a row since found it the same, or -1 before its first read since it wrote one
static int news, unchanged[4];
static uint8_t seen[4];
static void reads_forgotten(void) {
  for (int i = 0; i < 4; i++) unchanged[i] = -1;
}

static void timer_run(struct timer *t, uint32_t step, uint32_t cycles) {
  uint32_t total = t->stage1 + cycles, steps = total / step;
  t->stage1 = (uint8_t)(total % step);
  if (!t->enable) return;
  while (steps--) {
    // a period of 0 is 256 steps
    if (++t->stage2 == t->target) {
      t->stage2 = 0;
      t->stage3 = (t->stage3 + 1) & 15;
    }
  }
}

// the timers and the sound chip on to `to`
static void advance(uint64_t to) {
  if (to <= now) return;
  uint32_t cycles = (uint32_t)(to - now);
  for (int i = 0; i < 3; i++) timer_run(&timers[i], TIMER_STEP[i], cycles);
  dsp_run(cycles);
  now = to;
}

// when a running timer next counts a period, or 0 when none runs
static uint64_t next_count(void) {
  uint64_t soonest = 0;
  for (int i = 0; i < 3; i++) {
    const struct timer *t = &timers[i];
    if (!t->enable) continue;
    uint32_t steps = (uint8_t)(t->target - t->stage2 - 1) + 1u;
    uint64_t at = now + (TIMER_STEP[i] - t->stage1) + (uint64_t)(steps - 1) * TIMER_STEP[i];
    if (!soonest || at < soonest) soonest = at;
  }
  return soonest;
}

/** A game with no program for the sound processor has one that does nothing. */
__attribute__((weak)) void game_spc(uint16_t address) { (void)address; }
static void program(void) { game_spc(sent_to); }

static void ipl(void);
// the sound processor's turn, with what's there now
static void turn(void) {
  if (running == FIRMWARE) ipl();
  else if (running == PROGRAM && !kit_run_beside(program)) running = STOPPED;
}

//// The start-up program

// where it waits: for $CC, for a block's first count, or for each byte's
static enum { WAIT_CC, WAIT_ZERO, COMPARE } ipl_at;
static uint8_t ipl_count;

// a port the main processor reads, written as the sound processor's every write is, to its memory too
static void say(int port, uint8_t value) {
  TO_MAIN[port] = value;
  snes_aram[0xF4 + port] = value;
}

static void ipl(void) {
  for (;;) {
    uint8_t count = from_main[0];
    if (ipl_at == WAIT_CC) {
      if (count != 0xCC) return;
    } else if (ipl_at == WAIT_ZERO) {
      if (count != 0) return;
      ipl_count = 0;
      ipl_at = COMPARE;
      continue;
    } else if (count == ipl_count) {
      // the byte with the count it waits for, into the memory where the block goes, kept at $00 and $01, and the
      // count said back
      uint16_t to = (uint16_t)(snes_aram[0] | snes_aram[1] << 8);
      say(0, ipl_count);
      snes_aram[(uint16_t)(to + ipl_count)] = from_main[1];
      if (!++ipl_count) snes_aram[1]++;
      continue;
    } else if (!((uint8_t)(ipl_count - count) & 0x80)) {
      // still the count of a byte it has: it waits for the next
      return;
    }
    // a block's start, where $CC or a count further on takes it: where the block goes, from the last two ports, the
    // count said back, and then the block's bytes, or with 0 in the second port, a jump there
    snes_aram[0] = from_main[2];
    snes_aram[1] = from_main[3];
    say(0, count);
    if (from_main[1]) {
      ipl_at = WAIT_ZERO;
      continue;
    }
    sent_to = (uint16_t)(snes_aram[0] | snes_aram[1] << 8);
    running = PROGRAM;
    turn();
    return;
  }
}

//// The sound processor's registers

uint8_t snes_spc_read(uint16_t address) {
  switch (address) {
  case 0xF2: return dsp_address;
  case 0xF3: return dsp_read(dsp_address & 0x7F);
  case 0xF4: case 0xF5: case 0xF6: case 0xF7: return from_main[address - 0xF4];
  case 0xF8: case 0xF9: return extra[address - 0xF8];
  case 0xFD: case 0xFE: case 0xFF: {
    struct timer *t = &timers[address - 0xFD];
    uint8_t periods = t->stage3 & 15;
    t->stage3 = 0;
    return periods;
  }
  default: return address >= 0xF0 && address <= 0xFF ? 0 : snes_aram[address];
  }
}

void snes_spc_write(uint16_t address, uint8_t value) {
  switch (address) {
  case 0xF1:
    // clearing what the main processor wrote to the ports, two at a time, and starting or stopping each timer
    if (value & 0x20) from_main[2] = from_main[3] = 0;
    if (value & 0x10) from_main[0] = from_main[1] = 0;
    for (int i = 0; i < 3; i++) {
      int on = value >> i & 1;
      if (!timers[i].enable && on) timers[i].stage2 = timers[i].stage3 = 0;
      timers[i].enable = on;
    }
    break;
  case 0xF2: dsp_address = value; break;
  case 0xF3:
    if (!(dsp_address & 0x80)) dsp_write(dsp_address, value);
    break;
  case 0xF4: case 0xF5: case 0xF6: case 0xF7: TO_MAIN[address - 0xF4] = value; break;
  case 0xF8: case 0xF9: extra[address - 0xF8] = value; break;
  case 0xFA: case 0xFB: case 0xFC: timers[address - 0xFA].target = value; break;
  }
  snes_aram[address] = value;
}

void snes_spc_wait(void) { kit_wait_beside(); }

//// The main processor's side

void apu_port_write(int port, uint8_t value) {
  from_main[port] = value;
  news = 1;
  reads_forgotten();
}

uint8_t apu_port_read(int port) {
  if (news) {
    // what it wrote, seen now that it looks for an answer
    news = 0;
    turn();
  } else if (unchanged[port] >= 1 && TO_MAIN[port] == seen[port] && running == PROGRAM) {
    // a port read a third time unchanged, as a main program waits for an answer, and not just once more to be sure
    // of it, as games do, a byte or a word at a time: the sound program goes on to its next turn
    uint64_t at = next_count();
    if (at) {
      advance(at);
      turn();
    }
  }
  unchanged[port] = unchanged[port] >= 0 && TO_MAIN[port] == seen[port] ? unchanged[port] + 1 : 0;
  seen[port] = TO_MAIN[port];
  return TO_MAIN[port];
}

void apu_frame(void) {
  frame_end += frame_cycles();
  if (news) {
    news = 0;
    turn();
  }
  for (uint64_t at; running == PROGRAM && (at = next_count()) && at <= frame_end;) {
    advance(at);
    turn();
  }
  advance(frame_end);
  reads_forgotten();
}

//// The samples, as the sound chip makes them, until the page takes them

enum { HELD = 8192 };
static int16_t held[HELD][2];
static uint32_t made, taken;

void apu_sample(int16_t left, int16_t right) {
  // the oldest go when nothing takes them
  if (made - taken == HELD) taken++;
  held[made % HELD][0] = left;
  held[made % HELD][1] = right;
  made++;
}

void apu_samples(float *left, float *right, int count) {
  for (int i = 0; i < count; i++) {
    // one not made yet, as a frame's count can be one ahead of the chip's, is the last one again
    uint32_t at = taken != made ? taken++ : taken - 1;
    left[i] = (float)held[at % HELD][0] / 32768.0f;
    right[i] = (float)held[at % HELD][1] / 32768.0f;
  }
}

void apu_power(void) {
  for (uint32_t i = 0; i < sizeof snes_aram; i++) snes_aram[i] = 0;
  for (int i = 0; i < 4; i++) from_main[i] = TO_MAIN[i] = 0;
  for (int i = 0; i < 3; i++) timers[i] = (struct timer){ 0 };
  dsp_address = extra[0] = extra[1] = 0;
  now = frame_end = frame_left = 0;
  news = 0;
  reads_forgotten();
  made = taken = 0;
  held[HELD - 1][0] = held[HELD - 1][1] = 0;
  dsp_power(snes_aram);
  running = FIRMWARE;
  ipl_at = WAIT_CC;
  say(0, 0xAA);
  say(1, 0xBB);
}
