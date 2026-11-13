// The GBA's sound hardware as the sound engine drives it, written from the JavaScript kit's sound/apu.js a function at
// a time, so it sounds the same to the sample: the registers at 0x04000060 to 0x040000AF, the four Game Boy channels
// (two squares, wave, noise) with their sweep, envelopes, length counters and wave RAM banks, and the final mix with
// the two DirectSound FIFOs, the bias and the 10-bit clip (GBATEK "GBA Sound Controller", Pan Docs "Audio"). Time is
// counted in CPU cycles at 2^24 Hz; the mix is sampled every 256 cycles (65536 Hz), the PWM rate the sound library
// sets as it starts.

#include "sound.h"

#define WAVE_START 24       // as mGBA has a wave note's first step, past its period
#define SEQ_PERIOD 32768    // the frame sequencer steps at 512 Hz
#define OFF_PERIOD 32768    // a square's step at pitch 0, where the sound switched off leaves it

static const uint8_t DUTY[4][8] = { { 0, 0, 0, 0, 0, 0, 0, 1 }, { 1, 0, 0, 0, 0, 0, 0, 1 }, { 1, 0, 0, 0, 0, 1, 1, 1 }, { 0, 1, 1, 1, 1, 1, 1, 0 } };

static void start_envelope(ApuEnvelope *e, int nrx2) { e->vol = nrx2 >> 4; e->up = (nrx2 & 8) != 0; e->period = nrx2 & 7; e->timer = e->period ? e->period : 8; }
static void step_envelope(ApuEnvelope *e) {
  if (!e->period) return;
  if (--e->timer > 0) return;
  e->timer = e->period;
  if (e->up && e->vol < 15) e->vol++;
  else if (!e->up && e->vol > 0) e->vol--;
}

#define REG(r) (a->regs[(r) - 0x60])

void apu_init(Apu *a) {
  __builtin_memset(a, 0, sizeof *a);
  a->ch4.lfsr = 0x7FFF;
  a->psgAt = -1;
  a->seqTimer = SEQ_PERIOD;
  a->regs[0x89 - 0x60] = 0x02;   // SOUNDBIAS resets to 0x200, the middle of the 10-bit range
}

static int sq_period(const ApuSquare *c) { return (2048 - c->freq) * 16; }
static int wave_period(const Apu *a) { return (2048 - a->ch3.freq) * 8; }
static int noise_period(const Apu *a) {
  int v = REG(0x7C), r = v & 7, s = v >> 4;
  return s >= 14 ? 0 : ((r ? r * 16 : 8) << s) * 4;
}
static int length_on(const Apu *a, int nrx4) { return (REG(nrx4) & 0x40) != 0; }

// ---- the console's own count of the squares (apu_exact) ----
// mGBA moves a square on lazily: at each write to one of its registers and, while it plays with an envelope that can
// still sound, at every sample (each 256 cycles from power-on) and frame sequencer step. Between those its count and
// the kit's agree, as a square counts its time against the pitch it has. They part only where the pitch changes with no
// catch-up, which switching the sound off does: it zeroes the pitch, and the time since the square's last catch-up is
// then counted at pitch 0. So the exact mode keeps mGBA's count beside the kit's and takes it at the switch-off.

static void catch_up(Apu *a, int i, long long at) {
  long long period = sq_period(&a->sq[i]), since = at - a->sqLast[i];
  if (since >= period) { long long n = since / period; a->sqIndex[i] += n; a->sqLast[i] += n * period; }
}
// mGBA's GBAudioRun moves on a square that plays with an envelope that isn't silent for good (dead != 2)
static int advancing(const Apu *a, int i) {
  const ApuSquare *c = &a->sq[i];
  return c->on && !(c->env.vol == 0 && (!c->env.up || !c->env.period));
}

void apu_exact(Apu *a, int powerOnBefore) {
  a->exact = 1; a->powerOn = powerOnBefore;
  long long sincePowerOn = a->clock + powerOnBefore;
  // since power-on the squares have stood at step 0 with the pitch at 0, the chip's own state until now
  for (int i = 0; i < 2; i++) {
    a->sqLast[i] = -(long long)powerOnBefore; a->sqIndex[i] = 0;
    a->sq[i].pos = 0; a->sq[i].since = (int)sincePowerOn;
  }
  // and the frame sequencer has stepped every SEQ_PERIOD from power-on
  a->seqTimer = SEQ_PERIOD - (int)(sincePowerOn % SEQ_PERIOD);
}

static int sweep_next(Apu *a) {
  int v = REG(0x60), d = a->sweepShadow >> (v & 7);
  int f = v & 8 ? a->sweepShadow - d : a->sweepShadow + d;
  if (f > 2047) a->sq[0].on = 0;
  return f;
}

static void trigger(Apu *a, int ch) {
  if (ch < 2) {
    ApuSquare *c = &a->sq[ch];
    int b = ch ? 0x68 : 0x62;
    c->on = (REG(b + 1) & 0xF8) != 0;   // the duty step keeps its phase
    if (!c->len) c->len = 64;
    start_envelope(&c->env, REG(b + 1));
    if (ch == 0) {
      int v = REG(0x60), period = (v >> 4) & 7;
      a->sweepShadow = c->freq; a->sweepTimer = period ? period : 8; a->sweepOn = period || (v & 7);
      if (v & 7) sweep_next(a);
    }
  } else if (ch == 2) {
    a->ch3.on = (REG(0x70) & 0x80) != 0;
    if (!a->ch3.len) a->ch3.len = 256;
    a->ch3.timer = wave_period(a) + (a->hasAt || a->exact ? WAVE_START : 0);
  } else {
    a->ch4.on = (REG(0x79) & 0xF8) != 0;
    if (!a->ch4.len) a->ch4.len = 64;
    a->ch4.lfsr = REG(0x7C) & 8 ? 0x7F : 0x7FFF; a->ch4.timer = noise_period(a);
    start_envelope(&a->ch4.env, REG(0x79));
  }
}

static void write_now(Apu *a, int r, int v) {
  v &= 0xFF;
  if (r >= 0x90 && r < 0xA0) {
    // the CPU sees the bank that is not playing
    int b = ((REG(0x70) >> 6) & 1) ^ 1, i = (r - 0x90) * 2;
    a->wave[b][(i + a->rot[b]) & 31] = (uint8_t)(v >> 4); a->wave[b][(i + 1 + a->rot[b]) & 31] = (uint8_t)(v & 15);
    return;
  }
  if (r < 0x60 || r >= 0xB0) return;
  if (r < 0x82 && !(REG(0x84) & 0x80)) return;   // the PSG registers ignore writes while the PSG is off
  if (a->exact && (REG(0x84) & 0x80)) {
    // a write to a square's register catches it up first, and one to the master volume or sides catches up those that
    // play; switching the sound off leaves each where its last catch-up left it
    if (r == 0x60 || r == 0x62 || r == 0x63 || r == 0x64 || r == 0x65) catch_up(a, 0, a->clock);
    if (r == 0x68 || r == 0x69 || r == 0x6C || r == 0x6D) catch_up(a, 1, a->clock);
    if (r == 0x80 || r == 0x81) for (int i = 0; i < 2; i++) if (advancing(a, i)) catch_up(a, i, a->clock);
    // counted at pitch 0, which the switch-off leaves, so the span stays small however long the square went uncaught
    if (r == 0x84 && !(v & 0x80))
      for (int i = 0; i < 2; i++) {
        long long since = a->clock - a->sqLast[i];
        a->sq[i].pos = (int)((a->sqIndex[i] + since / OFF_PERIOD) & 7); a->sq[i].since = (int)(since % OFF_PERIOD);
      }
  }
  // switched on, the frame sequencer starts its steps again (mGBA's frame 7, then 0 at the next)
  if (r == 0x84 && a->exact && (v & 0x80) && !(REG(0x84) & 0x80)) a->seqStep = 0;
  a->regs[r - 0x60] = (uint8_t)v;
  switch (r) {
    case 0x62: case 0x68: a->sq[r == 0x62 ? 0 : 1].len = 64 - (v & 63); break;
    case 0x63: case 0x69: if (!(v & 0xF8)) a->sq[r == 0x63 ? 0 : 1].on = 0; break;
    case 0x64: case 0x6C: { ApuSquare *c = &a->sq[r == 0x64 ? 0 : 1]; c->freq = (c->freq & 0x700) | v; break; }
    case 0x65: case 0x6D: {
      int i = r == 0x65 ? 0 : 1;
      ApuSquare *c = &a->sq[i];
      c->freq = (c->freq & 0xFF) | (v & 7) << 8;
      if (v & 0x80) trigger(a, i);
      break;
    }
    case 0x70: if (!(v & 0x80)) a->ch3.on = 0; break;
    case 0x72: a->ch3.len = 256 - v; break;
    // mGBA's NR32 reloads the wave's sample from the front of the first bank, playing or not
    case 0x73: if (a->exact) a->ch3.sample = a->wave[0][a->rot[0]]; break;
    case 0x74: a->ch3.freq = (a->ch3.freq & 0x700) | v; break;
    case 0x75:
      a->ch3.freq = (a->ch3.freq & 0xFF) | (v & 7) << 8;
      if (v & 0x80) trigger(a, 2);
      // mGBA starts the wave's next step over at any write to NR34 while it plays, restart or not
      else if (a->exact && a->ch3.on) a->ch3.timer = wave_period(a) + WAVE_START;
      break;
    case 0x78: a->ch4.len = 64 - (v & 63); break;
    case 0x79: if (!(v & 0xF8)) a->ch4.on = 0; break;
    case 0x7D: if (v & 0x80) trigger(a, 3); break;
    case 0x84:
      if (!(v & 0x80)) {
        __builtin_memset(a->regs, 0, 0x22);
        a->sq[0].on = a->sq[1].on = a->ch3.on = a->ch4.on = 0;
        if (a->exact) a->sq[0].freq = a->sq[1].freq = 0;   // NR13, NR14, NR23 and NR24 written 0, as mGBA does
      }
      break;
  }
}

static int is_wave(int r) { return (r >= 0x70 && r <= 0x75) || (r >= 0x90 && r < 0xA0); }
static int is_psg(int r) { return (r >= 0x60 && r <= 0x81 && r != 0x6E && r != 0x6F && r != 0x76 && r != 0x77 && r != 0x7E && r != 0x7F) || (r >= 0x90 && r <= 0x9F); }

// with `at` set (soundMainAt in m4a.c), the wave voice's writes wait for their place in the console's frame, counted
// from the start of this chip's: the wave's phase lasts from note to note, and each note's length in cycles decides
// how far it moves. With `psgAt` set (psgAt in m4a.c), the writes to all four channels, the wave's samples and the
// sides they play on wait for theirs in the same way, as a square's phase lasts from note to note too
void apu_write(Apu *a, int r, int v) {
  int at = a->hasAt && is_wave(r) ? a->at : a->psgAt >= 0 && is_psg(r) ? a->psgAt : -1;
  if (at < 0) { write_now(a, r, v); return; }
  if (a->waits >= APU_WAITS) return;
  int i = a->waits;
  while (i && a->wait[i - 1].in > at) i--;
  for (int j = a->waits; j > i; j--) a->wait[j] = a->wait[j - 1];
  a->wait[i].in = at; a->wait[i].r = r; a->wait[i].v = v;
  a->waits++;
}

int apu_read(const Apu *a, int r) {
  if (r >= 0x90 && r < 0xA0) {
    int b = ((REG(0x70) >> 6) & 1) ^ 1, i = (r - 0x90) * 2;
    return a->wave[b][(i + a->rot[b]) & 31] << 4 | a->wave[b][(i + 1 + a->rot[b]) & 31];
  }
  // SOUNDCNT_X's low bits say which channels are still sounding, so a length counter that ran out shows here; a note
  // still waiting for its place in the frame is already sounding, for the sound library that started it
  if (r == 0x84) {
    int waiting = 0;
    for (int i = 0; i < a->waits; i++) {
      int w = a->wait[i].r;
      if (a->wait[i].v & 0x80) waiting |= w == 0x65 ? 1 : w == 0x6D ? 2 : w == 0x75 ? 4 : w == 0x7D ? 8 : 0;
    }
    return (REG(0x84) & 0x80) | (a->sq[0].on || (waiting & 1) ? 1 : 0) | (a->sq[1].on || (waiting & 2) ? 2 : 0)
      | (a->ch3.on || (waiting & 4) ? 4 : 0) | (a->ch4.on || (waiting & 8) ? 8 : 0);
  }
  // a register read back while a write to it waits gives what was written, as the library reads its own writes
  if (a->psgAt >= 0) for (int i = a->waits - 1; i >= 0; i--) if (a->wait[i].r == r) return a->wait[i].v & 0xFF;
  return a->regs[r - 0x60];
}

static void frame_sequencer(Apu *a) {
  if (!(a->seqStep & 1)) {
    // length counters, 256 Hz
    if (length_on(a, 0x65) && a->sq[0].len && !--a->sq[0].len) a->sq[0].on = 0;
    if (length_on(a, 0x6D) && a->sq[1].len && !--a->sq[1].len) a->sq[1].on = 0;
    if (length_on(a, 0x75) && a->ch3.len && !--a->ch3.len) a->ch3.on = 0;
    if (length_on(a, 0x7D) && a->ch4.len && !--a->ch4.len) a->ch4.on = 0;
  }
  if (a->seqStep == 2 || a->seqStep == 6) {
    // frequency sweep, 128 Hz
    int v = REG(0x60), period = (v >> 4) & 7;
    if (--a->sweepTimer <= 0) {
      a->sweepTimer = period ? period : 8;
      if (a->sweepOn && period) {
        int f = sweep_next(a);
        if (f <= 2047 && (v & 7)) { a->sweepShadow = f; a->sq[0].freq = f; sweep_next(a); }
      }
    }
  }
  if (a->seqStep == 7) { step_envelope(&a->sq[0].env); step_envelope(&a->sq[1].env); step_envelope(&a->ch4.env); }
  a->seqStep = (a->seqStep + 1) & 7;
}

// the next wave sample: the one at the front of the playing bank (both banks in 64-sample mode)
static void step_wave(Apu *a) {
  int b = (REG(0x70) >> 6) & 1;
  if (!(REG(0x70) & 0x20)) { a->ch3.sample = a->wave[b][a->rot[b]]; a->rot[b] = (a->rot[b] + 1) & 31; return; }
  // one 64-sample ring through both banks: the front of the playing bank moves to the end of the other one
  a->ch3.sample = a->wave[b][a->rot[b]];
  uint8_t carry = a->wave[b ^ 1][a->rot[b ^ 1]];
  a->wave[b][a->rot[b]] = carry; a->wave[b ^ 1][a->rot[b ^ 1]] = (uint8_t)a->ch3.sample;
  a->rot[0] = (a->rot[0] + 1) & 31; a->rot[1] = (a->rot[1] + 1) & 31;
}

static void step_chip(Apu *a, int cycles) {
  if (!(REG(0x84) & 0x80)) {
    if (!a->exact) return;
    // the squares count the time while the sound is off and catch it up at the pitch they have once it's on, and the
    // frame sequencer keeps its time, stepping nothing (mGBA)
    for (int i = 0; i < 2; i++) {
      ApuSquare *c = &a->sq[i];
      c->since += cycles;
      if (c->since >= OFF_PERIOD && !c->freq) { c->pos = (c->pos + c->since / OFF_PERIOD) & 7; c->since %= OFF_PERIOD; }
    }
    a->seqTimer -= cycles;
    while (a->seqTimer <= 0) a->seqTimer += SEQ_PERIOD;
    return;
  }
  for (int i = 0; i < 2; i++) {
    ApuSquare *c = &a->sq[i];
    c->since += cycles;
    int period = sq_period(c);
    if (c->since >= period) {
      c->pos = (c->pos + c->since / period) & 7;
      c->since %= period;
    }
  }
  if (a->ch3.on) {
    a->ch3.timer -= cycles;
    while (a->ch3.timer <= 0) { a->ch3.timer += wave_period(a); step_wave(a); }
  }
  if (a->ch4.on) {
    int period = noise_period(a);
    if (period) {
      a->ch4.timer -= cycles;
      while (a->ch4.timer <= 0) {
        a->ch4.timer += period;
        // the LFSR in its shift-and-xor form; the bit shifted out is the output
        a->ch4.out = a->ch4.lfsr & 1;
        a->ch4.lfsr >>= 1;
        if (a->ch4.out) a->ch4.lfsr ^= REG(0x7C) & 8 ? 0x60 : 0x6000;
      }
    }
  }
  a->seqTimer -= cycles;
  while (a->seqTimer <= 0) { a->seqTimer += SEQ_PERIOD; frame_sequencer(a); }
}

// mGBA mixes each channel's last sample whether it plays or not: a channel that stops leaves its level where it was
static void hold_samples(Apu *a) {
  for (int i = 0; i < 2; i++) if (a->sq[i].on) a->held[i] = DUTY[REG(i ? 0x68 : 0x62) >> 6][a->sq[i].pos] * a->sq[i].env.vol;
  if (a->ch4.on) a->held[3] = a->ch4.out * a->ch4.env.vol;
}

// in exact mode the chip runs up to each frame sequencer step, where a sweep changes the pitch, and mGBA's count catches
// up the squares that play at the last sample before each stretch's end
static void run_chip(Apu *a, int cycles) {
  if (!a->exact) { step_chip(a, cycles); a->clock += cycles; return; }
  while (cycles > 0) {
    int step = cycles < a->seqTimer ? cycles : a->seqTimer;
    long long end = a->clock + step, sample = end - (end + a->powerOn) % APU_TICK;
    if ((REG(0x84) & 0x80) && sample > a->clock)
      for (int i = 0; i < 2; i++) if (advancing(a, i)) catch_up(a, i, sample);
    step_chip(a, step);
    hold_samples(a);
    a->clock = end;
    cycles -= step;
  }
}

// advances every oscillator by `cycles`; the squares' duty steps run even while they are silent. As in mGBA, a square
// counts the time since its last step against the pitch it has now, so one that was silent at a slow pitch, as the
// sound library leaves it when it stops a note, starts its next note on time
void apu_run(Apu *a, int cycles) {
  while (a->waits && a->wait[0].in <= cycles) {
    ApuWait w = a->wait[0];
    for (int i = 1; i < a->waits; i++) a->wait[i - 1] = a->wait[i];
    a->waits--;
    run_chip(a, w.in);
    cycles -= w.in;
    for (int i = 0; i < a->waits; i++) a->wait[i].in -= w.in;
    write_now(a, w.r, w.v);
  }
  for (int i = 0; i < a->waits; i++) a->wait[i].in -= cycles;
  run_chip(a, cycles);
}

void apu_wave_later(Apu *a, int cycles) { for (int i = 0; i < a->waits; i++) a->wait[i].in += cycles; }

static int wave_sample(const Apu *a) {
  int v = REG(0x73), s = a->ch3.sample;
  if (v & 0x80) return (s * 3) >> 2;
  int code = (v >> 5) & 3;
  return code ? s >> (code - 1) : 0;
}

static int clip(int v) { return v < 0 ? 0 : v > 0x3FF ? 0x3FF : v; }

/** The output for this instant, given the DirectSound samples now playing on FIFO A and B, as offsets around the
 *  bias in 10-bit units, into out[0] (left) and out[1] (right). */
void apu_mix(const Apu *a, int fifoA, int fifoB, int out[2]) {
  int on = (REG(0x84) & 0x80) != 0, nr51 = REG(0x81) & ~(a->muted * 0x11);
  int s1 = on && a->sq[0].on ? DUTY[REG(0x62) >> 6][a->sq[0].pos] * a->sq[0].env.vol : 0;
  int s2 = on && a->sq[1].on ? DUTY[REG(0x68) >> 6][a->sq[1].pos] * a->sq[1].env.vol : 0;
  int s3 = on && a->ch3.on ? wave_sample(a) : 0;
  int s4 = on && a->ch4.on ? a->ch4.out * a->ch4.env.vol : 0;
  // in exact mode a stopped channel keeps its last sample, and the wave's follows its volume register as mGBA's does
  if (on && a->exact) {
    if (!a->sq[0].on) s1 = a->held[0];
    if (!a->sq[1].on) s2 = a->held[1];
    if (!a->ch3.on) s3 = wave_sample(a);
    if (!a->ch4.on) s4 = a->held[3];
  }
  int r = (nr51 & 1 ? s1 : 0) + (nr51 & 2 ? s2 : 0) + (nr51 & 4 ? s3 : 0) + (nr51 & 8 ? s4 : 0);
  int l = (nr51 & 0x10 ? s1 : 0) + (nr51 & 0x20 ? s2 : 0) + (nr51 & 0x40 ? s3 : 0) + (nr51 & 0x80 ? s4 : 0);
  int nr50 = REG(0x80), cnt = REG(0x82) | REG(0x83) << 8, shift = 4 - (cnt & 3);
  r = ((r << 3) * (1 + (nr50 & 7))) >> shift;
  l = ((l << 3) * (1 + ((nr50 >> 4) & 7))) >> shift;
  int fa = fifoA * (cnt & 4 ? 4 : 2), fb = fifoB * (cnt & 8 ? 4 : 2);
  if (cnt & 0x100) r += fa;
  if (cnt & 0x200) l += fa;
  if (cnt & 0x1000) r += fb;
  if (cnt & 0x2000) l += fb;
  int bias = (REG(0x88) | REG(0x89) << 8) & 0x3FE;
  out[0] = clip(l + bias) - bias;
  out[1] = clip(r + bias) - bias;
}
