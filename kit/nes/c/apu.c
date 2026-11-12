// The NES's sound hardware, the APU, as it is documented to behave: two pulse channels, a triangle, noise and the
// samples channel (DMC), their envelopes, sweeps, length counters and the frame counter that clocks them, mixed as the
// console mixes them, and then filtered as the proof tools' emulator, FCEUmm, filters its output (kit/nes/c/README.md).
// It runs a CPU cycle at a time, and makes CONSOLE_SOUND_RATE samples a second, each the average of its cycles.

#include "nes.h"
#include "nes-kit.h"

#define CPU_CLOCK_DOTS 3                 // the PPU's dots to one of the CPU's cycles
#define RING 8192                        // samples made and not yet taken

static const uint8_t LENGTHS[32] = { 10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
                                     12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30 };
static const uint8_t DUTIES[4][8] = { { 0, 1, 0, 0, 0, 0, 0, 0 }, { 0, 1, 1, 0, 0, 0, 0, 0 },
                                      { 0, 1, 1, 1, 1, 0, 0, 0 }, { 1, 0, 0, 1, 1, 1, 1, 1 } };
static const uint8_t TRIANGLE[32] = { 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
                                      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
static const uint16_t NOISE_PERIODS[16] = { 4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068 };
static const uint16_t DMC_PERIODS[16] = { 428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54 };

typedef struct {
  int start, divider, decay, period, constant, loop;
} Envelope;

typedef struct {
  Envelope envelope;
  int duty, step, timer, period, length, halt, enabled;
  int sweep_on, sweep_period, sweep_negate, sweep_shift, sweep_divider, sweep_reload, ones;
} Pulse;

static Pulse pulses[2];
static struct { int control, reload, counter, reload_flag, timer, period, step, length, enabled; } tri;
enum { TRIANGLE_HELD_BELOW = 3 };  // the longest period at which the triangle's wave doesn't move
#define SOUND_TIME_LOST (1.7634 / 29780.5)  // of each cycle: what FCEUmm's sound drops, measured over 4,401 frames of its own
static double lost;                      // towards the next cycle the waves don't get
static uint32_t waves;                   // the cycles they did get
static struct { Envelope envelope; int mode, timer, period, length, halt, enabled; uint16_t shift; } noise;
static struct {
  int irq, loop, period, timer, level, address, length, current, remaining, buffer, buffered, shift, bits, silent;
} dmc;
static int frame_mode, frame_cycle, frame_reset_in, frame_irq;

// the mix's levels, as the console's resistors weigh the channels, at the loudness FCEUmm plays them
static float pulse_mix[31], tnd_mix[203];
static double slow, slower;              // FCEUmm's filter, which takes away what stays at one level
static double sum;                       // the levels of the cycles the sample being made has so far
static int summed;
static uint64_t cycles;                  // CPU cycles since power-on
static uint64_t made;                    // samples made since power-on
static float ring[RING];
static int ring_start, ring_count;
static float last;

static int pulse_muted(const Pulse *p) {
  int change = p->period >> p->sweep_shift;
  return p->period < 8 || (!p->sweep_negate && p->period + change > 0x7FF);
}

static int pulse_out(const Pulse *p) {
  if (!p->length || pulse_muted(p) || !DUTIES[p->duty][p->step]) return 0;
  return p->envelope.constant ? p->envelope.period : p->envelope.decay;
}

static int noise_out(void) {
  if (!noise.length || (noise.shift & 1)) return 0;
  return noise.envelope.constant ? noise.envelope.period : noise.envelope.decay;
}

static float level(void) {
  return pulse_mix[pulse_out(&pulses[0]) + pulse_out(&pulses[1])] + tnd_mix[3 * TRIANGLE[tri.step] + 2 * noise_out() + dmc.level];
}

static void envelope_clock(Envelope *e) {
  if (e->start) {
    e->start = 0;
    e->decay = 15;
    e->divider = e->period;
  } else if (e->divider) e->divider--;
  else {
    e->divider = e->period;
    if (e->decay) e->decay--;
    else if (e->loop) e->decay = 15;
  }
}

static void sweep_clock(Pulse *p) {
  int change = p->period >> p->sweep_shift;
  int target = p->sweep_negate ? p->period - change - p->ones : p->period + change;
  if (!p->sweep_divider && p->sweep_on && p->sweep_shift && !pulse_muted(p) && target >= 0) p->period = target;
  if (!p->sweep_divider || p->sweep_reload) {
    p->sweep_divider = p->sweep_period;
    p->sweep_reload = 0;
  } else p->sweep_divider--;
}

static void quarter_frame(void) {
  envelope_clock(&pulses[0].envelope);
  envelope_clock(&pulses[1].envelope);
  envelope_clock(&noise.envelope);
  if (tri.reload_flag) tri.counter = tri.reload;
  else if (tri.counter) tri.counter--;
  if (!tri.control) tri.reload_flag = 0;
}

static void half_frame(void) {
  for (int i = 0; i < 2; i++) {
    if (!pulses[i].halt && pulses[i].length) pulses[i].length--;
    sweep_clock(&pulses[i]);
  }
  if (!tri.control && tri.length) tri.length--;
  if (!noise.halt && noise.length) noise.length--;
}

static void dmc_fetch(void) {
  if (dmc.buffered || !dmc.remaining) return;
  dmc.buffer = nes_prg_byte((uint16_t)dmc.current);
  dmc.buffered = 1;
  dmc.current = dmc.current == 0xFFFF ? 0x8000 : dmc.current + 1;
  if (!--dmc.remaining && dmc.loop) {
    dmc.current = dmc.address;
    dmc.remaining = dmc.length;
  }
}

static void cycle(void) {
  // the frame counter, in CPU cycles
  if (frame_reset_in && !--frame_reset_in) frame_cycle = 0;
  frame_cycle++;
  // FCEUmm takes the length counters and sweeps down on the sequencer's first and third steps, where the console does
  // it on the second and fourth, so this does too (kit/nes/notes/emulators-sound-runs-slow.md)
  if (frame_cycle == 7457 || frame_cycle == 22371) { half_frame(); quarter_frame(); }
  else if (frame_cycle == 14913) quarter_frame();
  else if (!frame_mode && frame_cycle == 29829) quarter_frame();
  else if (frame_mode && frame_cycle == 37281) { quarter_frame(); half_frame(); }
  if ((!frame_mode && frame_cycle >= 29830) || (frame_mode && frame_cycle >= 37282)) frame_cycle = 0;

  // the triangle's timer runs every CPU cycle, the others every other one. With a period of 3 or less its wave is too
  // high to hear, which games use for silence, and FCEUmm holds the wave where it is then, so this does too.
  // FCEUmm makes its sound a frame at a time, and at each frame's end drops the part of a sample it hasn't made yet:
  // about 1.76 cycles a frame, so its waves run that much slower than the processor. This drops the same, a cycle at
  // a time. Its triangle also keeps what's left of a step's time while the wave is stopped, by either counter or by
  // a period of 3 or less, so the next note's first step comes when that has run.
  lost += SOUND_TIME_LOST;
  if (lost >= 1) lost -= 1;
  else {
    if (tri.length && tri.counter && tri.period > TRIANGLE_HELD_BELOW) {
      if (tri.timer) tri.timer--;
      else {
        tri.timer = tri.period;
        tri.step = (tri.step + 1) & 31;
      }
    }
    if (!(waves & 1)) {
      for (int i = 0; i < 2; i++) {
        Pulse *p = &pulses[i];
        if (p->timer) p->timer--;
        else {
          p->timer = p->period;
          p->step = (p->step + 1) & 7;
        }
      }
    }
    if (noise.timer) noise.timer--;
    else {
      noise.timer = noise.period - 1;
      int feedback = (noise.shift & 1) ^ ((noise.shift >> (noise.mode ? 6 : 1)) & 1);
      noise.shift = (uint16_t)((noise.shift >> 1) | feedback << 14);
    }
    waves++;
  }
  if (dmc.timer) dmc.timer--;
  else {
    dmc.timer = dmc.period - 1;
    if (!dmc.silent) {
      if (dmc.shift & 1) { if (dmc.level <= 125) dmc.level += 2; }
      else if (dmc.level >= 2) dmc.level -= 2;
    }
    dmc.shift >>= 1;
    if (!--dmc.bits) {
      dmc.bits = 8;
      if (dmc.buffered) {
        dmc.silent = 0;
        dmc.shift = dmc.buffer;
        dmc.buffered = 0;
        dmc_fetch();
      } else dmc.silent = 1;
    }
  }
  cycles++;
}

static void sample_done(void) {
  double value = summed ? sum / summed : last;
  sum = 0;
  summed = 0;
  // FCEUmm's filter (its SexyFilter): a slow average of the level, and a slower one of what's left, taken away
  slow += (value - slow) * 94.0 / CONSOLE_SOUND_RATE;
  slower += (value - slow - slower) * 24.0 / CONSOLE_SOUND_RATE;
  double out = slow - value + slower;
  if (out > 1) out = 1;
  if (out < -1) out = -1;
  if (ring_count == RING) { ring_start = (ring_start + 1) % RING; ring_count--; }
  ring[(ring_start + ring_count++) % RING] = (float)out;
  made++;
}

void nes_apu_run_to(uint64_t dots) {
  uint64_t until = dots / CPU_CLOCK_DOTS;
  while (cycles < until) {
    cycle();
    sum += level();
    summed++;
    // a sample is done once the time reaches its end: sample n ends at (n + 1) / CONSOLE_SOUND_RATE seconds
    uint64_t at = cycles * CPU_CLOCK_DOTS;
    if (at * CONSOLE_SOUND_RATE >= (made + 1) * (uint64_t)CONSOLE_CLOCK) sample_done();
  }
}

void nes_apu_take(float *left, float *right, int count) {
  for (int i = 0; i < count; i++) {
    if (ring_count) {
      last = ring[ring_start];
      ring_start = (ring_start + 1) % RING;
      ring_count--;
    }
    left[i] = right[i] = last;
  }
}

void nes_apu_drop(void) {
  ring_start = ring_count = 0;
}

static void envelope_write(Envelope *e, uint8_t value) {
  e->loop = (value >> 5) & 1;
  e->constant = (value >> 4) & 1;
  e->period = value & 15;
}

void nes_apu_write(uint16_t address, uint8_t value) {
  switch (address) {
    case 0x4000: case 0x4004: {
      Pulse *p = &pulses[(address >> 2) & 1];
      p->duty = value >> 6;
      p->halt = (value >> 5) & 1;
      envelope_write(&p->envelope, value);
      break;
    }
    case 0x4001: case 0x4005: {
      Pulse *p = &pulses[(address >> 2) & 1];
      p->sweep_on = value >> 7;
      p->sweep_period = (value >> 4) & 7;
      p->sweep_negate = (value >> 3) & 1;
      p->sweep_shift = value & 7;
      p->sweep_reload = 1;
      break;
    }
    case 0x4002: case 0x4006: {
      Pulse *p = &pulses[(address >> 2) & 1];
      p->period = (p->period & 0x700) | value;
      break;
    }
    case 0x4003: case 0x4007: {
      Pulse *p = &pulses[(address >> 2) & 1];
      p->period = (p->period & 0xFF) | (value & 7) << 8;
      if (p->enabled) p->length = LENGTHS[value >> 3];
      p->step = 0;
      p->envelope.start = 1;
      break;
    }
    case 0x4008:
      tri.control = value >> 7;
      tri.reload = value & 0x7F;
      break;
    case 0x400A: tri.period = (tri.period & 0x700) | value; break;
    case 0x400B:
      tri.period = (tri.period & 0xFF) | (value & 7) << 8;
      if (tri.enabled) tri.length = LENGTHS[value >> 3];
      tri.reload_flag = 1;
      break;
    case 0x400C:
      noise.halt = (value >> 5) & 1;
      envelope_write(&noise.envelope, value);
      break;
    case 0x400E:
      noise.mode = value >> 7;
      noise.period = NOISE_PERIODS[value & 15];
      break;
    case 0x400F:
      if (noise.enabled) noise.length = LENGTHS[value >> 3];
      noise.envelope.start = 1;
      break;
    case 0x4010:
      dmc.irq = value >> 7;
      dmc.loop = (value >> 6) & 1;
      dmc.period = DMC_PERIODS[value & 15];
      break;
    case 0x4011: dmc.level = value & 0x7F; break;
    case 0x4012: dmc.address = 0xC000 + value * 64; break;
    case 0x4013: dmc.length = value * 16 + 1; break;
    case 0x4015:
      pulses[0].enabled = value & 1;
      pulses[1].enabled = (value >> 1) & 1;
      tri.enabled = (value >> 2) & 1;
      noise.enabled = (value >> 3) & 1;
      if (!pulses[0].enabled) pulses[0].length = 0;
      if (!pulses[1].enabled) pulses[1].length = 0;
      if (!tri.enabled) tri.length = 0;
      if (!noise.enabled) noise.length = 0;
      if (!(value & 0x10)) dmc.remaining = 0;
      else if (!dmc.remaining) {
        dmc.current = dmc.address;
        dmc.remaining = dmc.length;
        dmc_fetch();
      }
      break;
    case 0x4017:
      frame_mode = value >> 7;
      if (value & 0x40) frame_irq = 0;
      // the counter starts again three or four cycles on, and a write that chooses five steps clocks both at once
      frame_reset_in = (cycles & 1) ? 4 : 3;
      if (frame_mode) { quarter_frame(); half_frame(); }
      break;
  }
}

uint8_t nes_apu_status(void) {
  uint8_t value = (pulses[0].length ? 1 : 0) | (pulses[1].length ? 2 : 0) | (tri.length ? 4 : 0) | (noise.length ? 8 : 0)
                | (dmc.remaining ? 0x10 : 0) | (frame_irq ? 0x40 : 0);
  frame_irq = 0;
  return value;
}

void nes_apu_power(void) {
  // the console's mix (the NESdev wiki's), scaled so a pulse at full volume swings as far as FCEUmm plays it
  const double scale = 0.215 / (95.88 / (8128.0 / 15 + 100));
  for (int n = 0; n < 31; n++) pulse_mix[n] = n ? (float)(scale * 95.88 / (8128.0 / n + 100)) : 0;
  // the triangle, noise and samples share one, indexed as 3 × triangle + 2 × noise + samples, as FCEUmm's is: the
  // console's weights of the three, 1/8227, 1/12241 and 1/22638, are near enough 3, 2 and 1 of the same step
  for (int i = 0; i < 203; i++) {
    double sum = i / 22638.0;
    tnd_mix[i] = i ? (float)(scale * 159.79 / (1 / sum + 100)) : 0;
  }
  for (int i = 0; i < 2; i++) {
    Pulse empty = { 0 };
    pulses[i] = empty;
    pulses[i].ones = i == 0;
  }
  tri.control = tri.reload = tri.counter = tri.reload_flag = tri.timer = tri.period = tri.step = tri.length = tri.enabled = 0;
  noise.mode = noise.timer = noise.length = noise.halt = noise.enabled = 0;
  noise.period = NOISE_PERIODS[0];
  noise.shift = 1;
  dmc.irq = dmc.loop = dmc.timer = dmc.level = dmc.length = dmc.current = dmc.remaining = dmc.buffer = dmc.buffered = dmc.shift = 0;
  dmc.address = 0xC000;
  dmc.period = DMC_PERIODS[0];
  dmc.bits = 8;
  dmc.silent = 1;
  frame_mode = frame_cycle = frame_reset_in = frame_irq = 0;
  lost = 0;
  waves = 0;
  cycles = made = 0;
  sum = 0;
  summed = 0;
  ring_start = ring_count = 0;
  // the filter starts where the mix sits at power-on: the triangle at the top of its wave
  slow = level();
  slower = 0;
  last = 0;
}
