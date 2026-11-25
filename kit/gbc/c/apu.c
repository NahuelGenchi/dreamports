// The Game Boy's sound hardware: two square channels, the first with a sweep, a channel that plays the 32 steps of a
// wave the game writes, and a noise channel, each with its length counter, and the squares and the noise with a volume
// envelope, mixed to the left and the right as NR50 and NR51 say. It makes the console's two million samples a second,
// each the sum of the four channels, and then filters them down to the 32,768 the proof tools hear, as the console's
// reference emulator does (blip.h), so a game that writes the registers at the cycles its original does sounds the
// same sample for sample.
//
// Its time is the chip's own: a count of its 2 MHz ticks, which the 256 Hz of the lengths, the 128 Hz of the sweep and
// the 64 Hz of the envelopes are read from, and which switching the sound on starts again. Every unit keeps the tick
// it next does something at, and a sample holds what every unit has done by its tick.

#include "gb-kit.h"
#include "blip.h"

#define NEVER UINT64_MAX

typedef struct { uint64_t next; uint16_t frequency, period; uint8_t position, shape, high; } Duty;
typedef struct { uint64_t next; uint8_t nr2, volume; } Envelope;
typedef struct { uint64_t ends; uint16_t count, most; } Length;
typedef struct { Duty duty; Envelope envelope; Length length; uint8_t nr4, on; } Square;

static Square square[2];
static struct { uint64_t next; uint16_t shadow; uint8_t nr0, subtracted; } sweep;
static struct { Length length; uint64_t next, read_at; uint8_t memory[16], nr0, nr3, nr4, position, shift, held, on; } wave;
// the noise's shift register steps on a clock of its own, which runs on, `clock`, while nothing can be heard of it and
// `next` is NEVER
static struct { Envelope envelope; Length length; uint64_t next, clock; uint16_t bits; uint8_t nr3, nr4, on; } noise;

static uint64_t ticks;        // the chip's time
static uint64_t made_to;      // the processor's cycle the sound is made up to
static uint8_t nr50, nr51, power;
static int colour;

// the filter: each change of level adds its 32 taps to the samples it reaches, and a sample is finished once the time
// has passed it
#define PENDING 64
static int32_t pending[2][PENDING];
static uint64_t native;       // the console's samples made so far
static uint64_t finished;     // the filtered samples finished so far
static int32_t level[2], held_sum[2];

#define RING 8192
static int16_t ring[RING][2];
static int ring_start, ring_count;
static int16_t last[2];

void gb_apu_take(float *left, float *right, int count) {
  for (int i = 0; i < count; i++) {
    if (ring_count) {
      last[0] = ring[ring_start][0];
      last[1] = ring[ring_start][1];
      ring_start = (ring_start + 1) % RING;
      ring_count--;
    }
    left[i] = (float)last[0] / 32768.0f;
    right[i] = (float)last[1] / 32768.0f;
  }
}

int gb_apu_made(void) { return ring_count; }
uint64_t gb_apu_total(void) { return finished; }

// finishes every filtered sample the console's sample `at` is past: a leaky sum of the taps, rounded and kept in 16 bits
static void finish_to(uint64_t at) {
  uint64_t upto = (at + BLIP_PHASES - 1) / BLIP_PHASES;
  for (; finished < upto; finished++) {
    int slot = (int)(finished % PENDING);
    int16_t pair[2];
    for (int side = 0; side < 2; side++) {
      int32_t sum = held_sum[side];
      sum += (pending[side][slot] >> 1) - (sum >> 9);
      int32_t rounded = (sum + 0x4000) >> 15;
      if ((int16_t)rounded != rounded) {
        rounded = (rounded >> 16) ^ 0x7FFF;
        sum = rounded << 15;
      }
      held_sum[side] = sum;
      pending[side][slot] = 0;
      pair[side] = (int16_t)rounded;
    }
    if (ring_count == RING) {
      ring_start = (ring_start + 1) % RING;
      ring_count--;
    }
    int end = (ring_start + ring_count) % RING;
    ring[end][0] = pair[0];
    ring[end][1] = pair[1];
    ring_count++;
  }
}

static int routed(int channel, int side) { return ((side ? nr51 : nr51 >> 4) >> channel) & 1; }

// what the four channels add up to on one side now: each gives its volume, 0 to 15, as a level from -15 to 15, times
// the side's volume, and nothing at all while its converter is off
static int32_t level_of(int side) {
  int32_t loud = ((((side ? nr50 : nr50 >> 4) & 7) + 1) * 64), sum = 0;
  for (int c = 0; c < 2; c++) {
    const Square *s = &square[c];
    if ((s->envelope.nr2 & 0xF8) && routed(c, side)) sum += loud * (s->on && s->duty.high ? s->envelope.volume * 2 - 15 : -15);
  }
  if (wave.nr0 && routed(2, side)) {
    int step = -15;
    if (wave.on && wave.shift != 4) step = (((wave.held >> ((~wave.position << 2) & 4)) & 15) >> wave.shift) * 2 - 15;
    sum += loud * step;
  }
  if ((noise.envelope.nr2 & 0xF8) && routed(3, side)) sum += loud * ((~noise.bits & 1) ? noise.envelope.volume * 2 - 15 : -15);
  return sum;
}

// `count` of the console's samples at the level the channels have now
static void emit(uint64_t count) {
  for (int side = 0; side < 2; side++) {
    int32_t now = level_of(side), change = now - level[side];
    if (!change) continue;
    level[side] = now;
    finish_to(native);
    uint64_t phase = native + 1, target = (phase + BLIP_PHASES - 1) / BLIP_PHASES;
    const int16_t *taps = blip_bank + BLIP_TAPS * (int)(target * BLIP_PHASES - phase);
    for (int i = 0; i < BLIP_TAPS; i++) pending[side][(target + (uint64_t)i) % PENDING] += change * taps[i];
  }
  native += count;
  finish_to(native);
}

static int wave_period(void) { return 0x800 - (((wave.nr4 << 8) & 0x700) | wave.nr3); }
static uint64_t noise_period(uint8_t nr3) {
  unsigned shift = (nr3 >> 4) + 3u, ratio = nr3 & 7u;
  if (!ratio) {
    ratio = 1;
    shift--;
  }
  return (uint64_t)ratio << shift;
}
static void noise_step(void) {
  if (noise.nr3 >= 0xE0) return;
  unsigned shifted = noise.bits >> 1, fed = (noise.bits ^ shifted) & 1;
  noise.bits = (uint16_t)(shifted | fed << 14);
  if (noise.nr3 & 8) noise.bits = (uint16_t)((noise.bits & ~0x40u) | fed << 6);
}
// The register after `steps` steps taken at once, at most 15, or 6 of the short register: each bit that comes in is
// worked out from two neighbours of the register as it stood, which is the same as one step at a time but for the last
// bit of a full 15, where a single step would already have a new bit to work from. The console's reference emulator
// catches the register up this way after a silence, so the kit does too, and the two stay the same sample for sample.
static unsigned noise_at_once(unsigned bits, unsigned steps, int is_short) {
  unsigned neighbours = bits ^ bits >> 1;
  if (!is_short) return bits >> steps | ((neighbours << (15 - steps)) & 0x7FFF);
  unsigned in = (neighbours << (7 - steps)) & 0x7F;
  return ((bits >> steps) & ~(0x80u - (0x80u >> steps))) | in | in << 8;
}
// the noise's clock on to the chip's time, with the register's steps only while the channel is on
static void noise_catch_up(void) {
  if (noise.clock > ticks) return;
  uint64_t period = noise_period(noise.nr3), steps = (ticks - noise.clock) / period + 1;
  noise.clock += steps * period;
  if (!noise.on || noise.nr3 >= 0xE0) return;
  int is_short = (noise.nr3 & 8) != 0;
  unsigned most = is_short ? 6 : 15, bits = noise.bits;
  for (; steps > most; steps -= most) bits = noise_at_once(bits, most, is_short);
  noise.bits = (uint16_t)noise_at_once(bits, (unsigned)steps, is_short);
}
static void noise_off(void) {
  noise.on = 0;
  noise.next = NEVER;
  noise.bits = 0x7FFF;
}
// whether anything of the noise can be heard decides whether its register is stepped tick by tick or caught up later
static void noise_heard(void) {
  if ((nr51 & 0x88) && noise.on && noise.envelope.volume) {
    noise_catch_up();
    noise.next = noise.clock;
  } else noise.next = NEVER;
}

static void set_frequency(Duty *d, unsigned frequency) {
  d->frequency = (uint16_t)frequency;
  d->period = (uint16_t)((2048 - frequency) * 2);
}

static unsigned sweep_next_frequency(void) {
  unsigned frequency = sweep.shadow >> (sweep.nr0 & 7);
  if (sweep.nr0 & 8) {
    frequency = sweep.shadow - frequency;
    sweep.subtracted = 1;
  } else frequency = sweep.shadow + frequency;
  if (frequency & 2048) square[0].on = 0;
  return frequency;
}

static void envelope_step(Envelope *e, int is_noise) {
  unsigned period = e->nr2 & 7;
  if (!period) {
    e->next += (uint64_t)8 << 15;
    return;
  }
  int volume = e->volume + ((e->nr2 & 8) ? 1 : -1);
  if (volume < 0 || volume > 15) {
    e->next = NEVER;
    return;
  }
  e->volume = (uint8_t)volume;
  e->next += (uint64_t)period << 15;
  if (is_noise && volume < 2) noise_heard();
}

// everything each unit does by the chip's time `ticks`
static void settle(void) {
  for (int c = 0; c < 2; c++) {
    Square *s = &square[c];
    while (s->duty.next <= ticks) {
      s->duty.position = (s->duty.position + 1) & 7;
      s->duty.high = (0x7EE18180u >> (s->duty.shape * 8 + s->duty.position)) & 1;
      s->duty.next += s->duty.period;
    }
    if (c == 0 && sweep.next <= ticks) {
      unsigned period = (sweep.nr0 >> 4) & 7;
      if (period) {
        unsigned frequency = sweep_next_frequency();
        if (!(frequency & 2048) && (sweep.nr0 & 7)) {
          sweep.shadow = (uint16_t)frequency;
          set_frequency(&s->duty, frequency);
          sweep_next_frequency();
        }
        sweep.next += (uint64_t)period << 14;
      } else sweep.next += (uint64_t)8 << 14;
    }
    if (s->envelope.next <= ticks) envelope_step(&s->envelope, 0);
    if (s->length.ends <= ticks) {
      s->length.ends = NEVER;
      s->length.count = 0;
      s->on = 0;
    }
  }
  while (wave.next <= ticks) {
    wave.read_at = wave.next;
    wave.next += (uint64_t)wave_period();
    wave.position = (wave.position + 1) & 31;
    wave.held = wave.memory[wave.position >> 1];
  }
  if (wave.length.ends <= ticks) {
    wave.length.ends = NEVER;
    wave.length.count = 0;
    wave.on = 0;
    wave.next = NEVER;
  }
  while (noise.next <= ticks) {
    noise_step();
    noise.next += noise_period(noise.nr3);
    noise.clock = noise.next;
  }
  if (noise.envelope.next <= ticks) envelope_step(&noise.envelope, 1);
  if (noise.length.ends <= ticks) {
    noise.length.ends = NEVER;
    noise.length.count = 0;
    noise_off();
  }
}

static uint64_t soonest(void) {
  uint64_t soon = NEVER;
#define SOON(time) do { if ((time) < soon) soon = (time); } while (0)
  for (int c = 0; c < 2; c++) {
    SOON(square[c].duty.next);
    SOON(square[c].envelope.next);
    SOON(square[c].length.ends);
  }
  SOON(sweep.next);
  SOON(wave.next);
  SOON(wave.length.ends);
  SOON(noise.next);
  SOON(noise.envelope.next);
  SOON(noise.length.ends);
#undef SOON
  return soon;
}

void gb_apu_run_to(uint64_t cycle) {
  if (cycle <= made_to) return;
  uint64_t count = (cycle - made_to) >> 1, end = ticks + count;
  made_to += count << 1;
  for (;;) {
    settle();
    uint64_t soon = soonest();
    if (soon > end) soon = end;
    if (soon == ticks) break;
    emit(soon - ticks);
    ticks = soon;
  }
}

// a length counter's register: how many of the 256 Hz steps the channel has left
static void length_load(Length *l, uint8_t nr4, unsigned value) {
  l->count = (uint16_t)(l->most - (value & (l->most - 1u)));
  l->ends = (nr4 & 0x40) ? ((ticks >> 13) + l->count) << 13 : NEVER;
}

// NRx4's two top bits for a length counter. Switching it on in the first half of a step counts one at once, and a
// counter that has run out starts again, whole, when the channel is started. Returns whether it ran out here.
static int length_control(Length *l, uint8_t before, uint8_t now) {
  int ran_out = 0;
  if (l->ends != NEVER) l->count = (uint16_t)((l->ends >> 13) - (ticks >> 13));
  unsigned early = 0;
  if (now & 0x40) {
    early = (unsigned)(~ticks >> 12) & 1;
    if (!(before & 0x40) && l->count) {
      l->count = (uint16_t)(l->count - early);
      if (!l->count) ran_out = 1;
    }
  }
  if ((now & 0x80) && !l->count) l->count = (uint16_t)(l->most - early);
  l->ends = ((now & 0x40) && l->count) ? ((ticks >> 13) + l->count) << 13 : NEVER;
  return ran_out;
}

// a write to an envelope's register while it runs changes the volume by the hardware's own odd rules. Returns whether
// the channel's converter is still on.
static int envelope_write(Envelope *e, uint8_t value) {
  unsigned volume = e->volume;
  if (!(e->nr2 & 7) && e->next != NEVER) volume++;
  else if (!(e->nr2 & 8)) volume += 2;
  if ((e->nr2 ^ value) & 8) volume = 16 - volume;
  e->volume = volume & 15;
  e->nr2 = value;
  return (value & 0xF8) != 0;
}

// a channel's start: its volume, and its first step on the 64 Hz, one later when the step is about to come
static int envelope_start(Envelope *e) {
  uint64_t period = (e->nr2 & 7) ? (e->nr2 & 7) : 8;
  if (((ticks + 2) & 0x7000) == 0) period++;
  e->next = ticks - ((ticks - 0x1000) & 0x7FFF) + period * 0x8000;
  e->volume = e->nr2 >> 4;
  return (e->nr2 & 0xF8) != 0;
}

static void square_write(int c, int which, uint8_t value) {
  Square *s = &square[c];
  switch (which) {
    case 1:
      length_load(&s->length, s->nr4, value);
      s->duty.shape = value >> 6;
      break;
    case 2:
      if (!envelope_write(&s->envelope, value)) s->on = 0;
      break;
    case 3:
      set_frequency(&s->duty, (s->duty.frequency & 0x700u) | value);
      break;
    case 4:
      if (length_control(&s->length, s->nr4, value)) s->on = 0;
      s->nr4 = value;
      set_frequency(&s->duty, ((unsigned)(value & 7) << 8) | (s->duty.frequency & 0xFFu));
      if (value & 0x80) {
        s->nr4 &= 0x7F;
        s->duty.next = (ticks & ~(uint64_t)1) + s->duty.period + 4;
        s->on = (uint8_t)envelope_start(&s->envelope);
        if (c == 0) {
          unsigned period = (sweep.nr0 >> 4) & 7, shift = sweep.nr0 & 7;
          sweep.subtracted = 0;
          sweep.shadow = s->duty.frequency;
          sweep.next = (period | shift) ? ((((ticks + 2 + (uint64_t)colour * 2) >> 14) + (period ? period : 8)) << 14) + 2 : NEVER;
          if (shift) sweep_next_frequency();
        }
      }
      break;
  }
}

static void write_powered(uint8_t reg, uint8_t value) {
  switch (reg) {
    case 0x10:
      if (sweep.subtracted && !(value & 8)) square[0].on = 0;
      sweep.nr0 = value;
      break;
    case 0x11: case 0x12: case 0x13: case 0x14: square_write(0, reg - 0x10, value); break;
    case 0x16: case 0x17: case 0x18: case 0x19: square_write(1, reg - 0x15, value); break;
    case 0x1A:
      wave.nr0 = value & 0x80;
      if (!wave.nr0) {
        wave.on = 0;
        wave.next = NEVER;
      }
      break;
    case 0x1B: length_load(&wave.length, wave.nr4, value); break;
    case 0x1C:
      wave.shift = (uint8_t)(((value >> 5) & 3) ? ((value >> 5) & 3) - 1 : 4);
      break;
    case 0x1D: wave.nr3 = value; break;
    case 0x1E:
      if (length_control(&wave.length, wave.nr4, value)) {
        wave.on = 0;
        wave.next = NEVER;
      }
      wave.nr4 = value & 0x7F;
      if (value & wave.nr0) {
        // on a Game Boy, starting it again just as it reads its memory spoils the memory's first bytes
        if (!colour && wave.next == ticks + 1) {
          unsigned at = ((wave.position + 1u) & 31) >> 1;
          if (at < 4) wave.memory[0] = wave.memory[at];
          else for (int i = 0; i < 4; i++) wave.memory[i] = wave.memory[(at & ~3u) + (unsigned)i];
        }
        wave.on = 1;
        wave.position = 0;
        wave.read_at = wave.next = ticks + (uint64_t)wave_period() + 3;
      }
      break;
    case 0x20: length_load(&noise.length, noise.nr4, value); break;
    case 0x21:
      if (!envelope_write(&noise.envelope, value)) noise_off();
      else noise_heard();
      break;
    case 0x22:
      // its clock's rate: the register steps once at the write, and on from there
      noise_catch_up();
      noise.nr3 = value;
      noise.next = ticks;
      break;
    case 0x23:
      if (length_control(&noise.length, noise.nr4, value)) noise_off();
      noise.nr4 = value;
      if (value & 0x80) {
        noise.nr4 &= 0x7F;
        if (envelope_start(&noise.envelope)) {
          noise_off();
          noise_catch_up();
          noise.on = 1;
          noise.clock += 4;
          noise.next = noise.clock;
        } else noise.on = 0;
        noise_heard();
      }
      break;
    case 0x24: nr50 = value; break;
    case 0x25:
      nr51 = value;
      noise_heard();
      break;
  }
}

void gb_apu_write(uint8_t reg, uint8_t value) {
  if (reg >= 0x30 && reg < 0x40) {
    // the wave's memory: while the channel plays, only the byte it's reading, and on a Game Boy only as it reads it
    unsigned at = reg & 15u;
    if (wave.on) {
      if (!colour && ticks != wave.read_at) return;
      at = wave.position >> 1;
    }
    wave.memory[at] = value;
    return;
  }
  if (reg == 0x26) {
    if (!((power ^ value) & 0x80)) return;
    if (!(value & 0x80)) {
      for (uint8_t r = 0x10; r < 0x26; r++) write_powered(r, 0);
      power = 0;
    } else {
      // the chip's time starts again, at the step of its 512 Hz it would be in
      ticks &= 0xFFF;
      ticks += (~(ticks + 2) << 1) & 0x1000;
      for (int c = 0; c < 2; c++) {
        square[c].duty.position = 0;
        square[c].duty.high = 0;
        square[c].duty.next = NEVER;
        square[c].envelope.next = NEVER;
      }
      sweep.next = NEVER;
      wave.held = 0;
      noise.nr3 = 0;
      noise_off();
      noise.clock = ticks + noise_period(0);
      noise.envelope.next = NEVER;
      power = 0x80;
    }
    return;
  }
  if (!power) {
    // with the sound off, a Game Boy still takes the lengths
    if (colour) return;
    if (reg == 0x11 || reg == 0x16) value &= 0x3F;
    else if (reg != 0x1B && reg != 0x20) return;
  }
  write_powered(reg, value);
}

uint8_t gb_apu_read(uint8_t reg) {
  if (reg == 0x26) return (uint8_t)(0x70 | power | square[0].on | square[1].on << 1 | wave.on << 2 | noise.on << 3);
  unsigned at = reg & 15u;
  if (wave.on) {
    if (!colour && ticks != wave.read_at) return 0xFF;
    at = wave.position >> 1;
  }
  return wave.memory[at];
}

int gb_apu_powered(void) { return power != 0; }

// the chip as the console leaves it once its own start-up has played its two notes: the first channel still running
// with its volume gone, everything else quiet
void gb_apu_power(int is_colour, uint64_t cycle, const uint8_t *io) {
  colour = is_colour;
  made_to = cycle;
  ticks = (uint64_t)(colour ? 0x1E00 : 0x2400) | ((cycle >> 1) & 0x1FF);
  for (int c = 0; c < 2; c++) {
    Square *s = &square[c];
    *s = (Square){ 0 };
    s->duty.next = NEVER;
    s->envelope.next = NEVER;
    s->envelope.nr2 = io[c ? 0x17 : 0x12];
    s->length.ends = NEVER;
    s->length.most = 64;
    s->length.count = 64;
    s->duty.shape = io[c ? 0x16 : 0x11] >> 6;
    set_frequency(&s->duty, 0);
  }
  square[0].duty.next = (ticks & ~(uint64_t)1) + (colour ? 37 : 69) * 2;
  square[0].duty.position = colour ? 6 : 3;
  square[0].duty.high = colour ? 1 : 0;
  set_frequency(&square[0].duty, 0x7C1);
  square[0].nr4 = 0x07;
  square[0].on = 1;
  sweep.next = NEVER;
  sweep.shadow = 0;
  sweep.nr0 = 0;
  sweep.subtracted = 0;
  wave.length.ends = NEVER;
  wave.length.most = 256;
  wave.length.count = 256;
  wave.next = wave.read_at = NEVER;
  for (int i = 0; i < 16; i++) wave.memory[i] = io[0x30 + i];
  wave.nr0 = io[0x1A] & 0x80;
  wave.nr3 = wave.nr4 = 0;
  wave.position = 0;
  wave.shift = (uint8_t)(((io[0x1C] >> 5) & 3) ? ((io[0x1C] >> 5) & 3) - 1 : 4);
  wave.held = 0;
  wave.on = 0;
  noise.envelope.next = NEVER;
  noise.envelope.nr2 = io[0x21];
  noise.envelope.volume = 0;
  noise.length.ends = NEVER;
  noise.length.most = 64;
  noise.length.count = 64;
  // its clock runs on from four ticks in, with nothing heard of it
  noise.clock = ticks + 4;
  noise.next = NEVER;
  noise.bits = 0xFF;
  noise.nr3 = io[0x22];
  noise.nr4 = 0;
  noise.on = 0;
  nr50 = io[0x24];
  nr51 = io[0x25];
  power = io[0x26] & 0x80;
  for (int side = 0; side < 2; side++) {
    for (int i = 0; i < PENDING; i++) pending[side][i] = 0;
    level[side] = held_sum[side] = 0;
    last[side] = 0;
  }
  native = finished = 0;
  ring_start = ring_count = 0;
}
