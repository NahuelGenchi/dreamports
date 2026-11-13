// The GBA's sound hardware as the engine drives it: the registers at 0x04000060–0x040000AF, the four Game Boy
// channels (two squares, wave, noise) with their sweep, envelopes, length counters and wave RAM banks, and the
// final mix with the two DirectSound FIFOs, the bias and the 10-bit clip (GBATEK "GBA Sound Controller", Pan
// Docs "Audio"). Time is counted in CPU cycles at 2^24 Hz; the mix is sampled every 256 cycles (65536 Hz),
// the PWM rate the sound library sets as it starts (SoundInit, m4a.js).

export const CPU_HZ = 16777216, TICK = 256;
const WAVE_START = 24;       // as mGBA has a wave note's first step, past its period
const SEQ_PERIOD = 32768;   // the frame sequencer steps at 512 Hz
const OFF_PERIOD = 32768;   // a square's step at pitch 0, where the sound switched off leaves it
const WAITS = 64;           // the writes that can wait for their place in the frame (APU_WAITS in the C kit)
const DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];

const envelope = () => ({ vol: 0, up: false, period: 0, timer: 0 });
function startEnvelope(e, nrx2) { e.vol = nrx2 >> 4; e.up = !!(nrx2 & 8); e.period = nrx2 & 7; e.timer = e.period || 8; }
function stepEnvelope(e) {
  if (!e.period) return;
  if (--e.timer > 0) return;
  e.timer = e.period;
  if (e.up && e.vol < 15) e.vol++;
  else if (!e.up && e.vol > 0) e.vol--;
}

export function createApu() {
  const regs = new Uint8Array(0x50);
  const reg = r => regs[r - 0x60];
  // two banks of 32 four-bit samples. The playing bank rotates by one sample per step, so `rot` is where its
  // first byte now starts; a retrigger does not rewind it
  const wave = [new Uint8Array(32), new Uint8Array(32)], rot = [0, 0];
  const sq = [0, 1].map(() => ({ on: false, len: 0, freq: 0, since: 0, pos: 0, env: envelope() }));
  const sweep = { timer: 0, on: false, shadow: 0 };
  const ch3 = { on: false, len: 0, freq: 0, timer: 0, sample: 0 };
  const ch4 = { on: false, len: 0, timer: 0, lfsr: 0x7FFF, out: 0, env: envelope() };
  let seqTimer = SEQ_PERIOD, seqStep = 0;
  regs[0x89 - 0x60] = 0x02;   // SOUNDBIAS resets to 0x200, the middle of the 10-bit range

  const sqBase = i => (i ? 0x68 : 0x62);
  const sqPeriod = c => (2048 - c.freq) * 16;
  const wavePeriod = () => (2048 - ch3.freq) * 8;
  function noisePeriod() {
    const v = reg(0x7C), r = v & 7, s = v >> 4;
    return s >= 14 ? 0 : ((r ? r * 16 : 8) << s) * 4;
  }
  const lengthOn = nrx4 => !!(reg(nrx4) & 0x40);

  // ---- the console's own count of the squares (exact) ----
  // mGBA moves a square on lazily: at each write to one of its registers and, while it plays with an envelope that can
  // still sound, at every sample (each 256 cycles from power-on) and frame sequencer step. Between those its count and
  // the kit's agree, as a square counts its time against the pitch it has. They part only where the pitch changes with
  // no catch-up, which switching the sound off does: it zeroes the pitch, and the time since the square's last
  // catch-up is then counted at pitch 0. So the exact mode keeps mGBA's count beside the kit's and takes it at the
  // switch-off.
  const sqLast = [0, 0], sqIndex = [0, 0], held = [0, 0, 0, 0];
  function catchUp(i, at) {
    const period = sqPeriod(sq[i]), since = at - sqLast[i];
    if (since >= period) { const n = Math.floor(since / period); sqIndex[i] += n; sqLast[i] += n * period; }
  }
  // mGBA's GBAudioRun moves on a square that plays with an envelope that isn't silent for good (dead != 2)
  const advancing = i => sq[i].on && !(sq[i].env.vol === 0 && (!sq[i].env.up || !sq[i].env.period));

  function sweepNext() {
    const v = reg(0x60), d = sweep.shadow >> (v & 7);
    const f = v & 8 ? sweep.shadow - d : sweep.shadow + d;
    if (f > 2047) sq[0].on = false;
    return f;
  }

  function trigger(ch) {
    if (ch < 2) {
      const c = sq[ch], b = sqBase(ch);
      c.on = (reg(b + 1) & 0xF8) !== 0;   // the duty step keeps its phase
      if (!c.len) c.len = 64;
      startEnvelope(c.env, reg(b + 1));
      if (ch === 0) {
        const v = reg(0x60), period = (v >> 4) & 7;
        sweep.shadow = c.freq; sweep.timer = period || 8; sweep.on = !!(period || (v & 7));
        if (v & 7) sweepNext();
      }
    } else if (ch === 2) {
      ch3.on = !!(reg(0x70) & 0x80);
      if (!ch3.len) ch3.len = 256;
      ch3.timer = wavePeriod() + (api.at === null && !api.exact ? 0 : WAVE_START);
    } else {
      ch4.on = (reg(0x79) & 0xF8) !== 0;
      if (!ch4.len) ch4.len = 64;
      ch4.lfsr = reg(0x7C) & 8 ? 0x7F : 0x7FFF; ch4.timer = noisePeriod();
      startEnvelope(ch4.env, reg(0x79));
    }
  }

  // with `at` set (soundMainAt in m4a.js), the wave voice's writes wait for their place in the console's frame, counted
  // from the start of this chip's: the wave's phase lasts from note to note, and each note's length in cycles decides
  // how far it moves. With `psgAt` set (psgAt in m4a.js), the writes to all four channels, the wave's samples and the
  // sides they play on wait for theirs in the same way, as a square's phase lasts from note to note too
  const waits = [];
  const isWave = r => (r >= 0x70 && r <= 0x75) || (r >= 0x90 && r < 0xA0);
  const isPsg = r => (r >= 0x60 && r <= 0x81 && r !== 0x6E && r !== 0x6F && r !== 0x76 && r !== 0x77 && r !== 0x7E && r !== 0x7F) || (r >= 0x90 && r <= 0x9F);
  function write(r, v) {
    const at = api.at !== null && isWave(r) ? api.at : api.psgAt >= 0 && isPsg(r) ? api.psgAt : -1;
    if (at < 0) return writeNow(r, v);
    if (waits.length >= WAITS) return;
    let i = waits.length;
    while (i && waits[i - 1].in > at) i--;
    waits.splice(i, 0, { in: at, r, v });
  }

  function writeNow(r, v) {
    v &= 0xFF;
    if (r >= 0x90 && r < 0xA0) {
      // the CPU sees the bank that is not playing
      const b = ((reg(0x70) >> 6) & 1) ^ 1, i = (r - 0x90) * 2;
      wave[b][(i + rot[b]) & 31] = v >> 4; wave[b][(i + 1 + rot[b]) & 31] = v & 15;
      return;
    }
    if (r < 0x60 || r >= 0xB0) return;
    if (r < 0x82 && !(reg(0x84) & 0x80)) return;   // the PSG registers ignore writes while the PSG is off
    if (api.exact && (reg(0x84) & 0x80)) {
      // a write to a square's register catches it up first, and one to the master volume or sides catches up those
      // that play; switching the sound off leaves each where its last catch-up left it, counted on at pitch 0
      if (r === 0x60 || r === 0x62 || r === 0x63 || r === 0x64 || r === 0x65) catchUp(0, api.clock);
      if (r === 0x68 || r === 0x69 || r === 0x6C || r === 0x6D) catchUp(1, api.clock);
      if (r === 0x80 || r === 0x81) for (const i of [0, 1]) if (advancing(i)) catchUp(i, api.clock);
      if (r === 0x84 && !(v & 0x80)) {
        for (const i of [0, 1]) {
          const since = api.clock - sqLast[i];
          sq[i].pos = (sqIndex[i] + Math.floor(since / OFF_PERIOD)) & 7; sq[i].since = since % OFF_PERIOD;
        }
      }
    }
    // switched on, the frame sequencer starts its steps again (mGBA's frame 7, then 0 at the next)
    if (r === 0x84 && api.exact && (v & 0x80) && !(reg(0x84) & 0x80)) seqStep = 0;
    regs[r - 0x60] = v;
    switch (r) {
      case 0x62: case 0x68: sq[r === 0x62 ? 0 : 1].len = 64 - (v & 63); break;
      case 0x63: case 0x69: if (!(v & 0xF8)) sq[r === 0x63 ? 0 : 1].on = false; break;
      case 0x64: case 0x6C: { const c = sq[r === 0x64 ? 0 : 1]; c.freq = (c.freq & 0x700) | v; break; }
      case 0x65: case 0x6D: {
        const i = r === 0x65 ? 0 : 1, c = sq[i];
        c.freq = (c.freq & 0xFF) | (v & 7) << 8;
        if (v & 0x80) trigger(i);
        break;
      }
      case 0x70: if (!(v & 0x80)) ch3.on = false; break;
      case 0x72: ch3.len = 256 - v; break;
      // mGBA's NR32 reloads the wave's sample from the front of the first bank, playing or not
      case 0x73: if (api.exact) ch3.sample = wave[0][rot[0]]; break;
      case 0x74: ch3.freq = (ch3.freq & 0x700) | v; break;
      case 0x75:
        ch3.freq = (ch3.freq & 0xFF) | (v & 7) << 8;
        if (v & 0x80) trigger(2);
        // mGBA starts the wave's next step over at any write to NR34 while it plays, restart or not
        else if (api.exact && ch3.on) ch3.timer = wavePeriod() + WAVE_START;
        break;
      case 0x78: ch4.len = 64 - (v & 63); break;
      case 0x79: if (!(v & 0xF8)) ch4.on = false; break;
      case 0x7D: if (v & 0x80) trigger(3); break;
      case 0x84:
        if (!(v & 0x80)) {
          regs.fill(0, 0, 0x22);
          for (const c of [...sq, ch3, ch4]) c.on = false;
          if (api.exact) sq[0].freq = sq[1].freq = 0;   // NR13, NR14, NR23 and NR24 written 0, as mGBA does
        }
        break;
    }
  }

  function read(r) {
    if (r >= 0x90 && r < 0xA0) {
      const b = ((reg(0x70) >> 6) & 1) ^ 1, i = (r - 0x90) * 2;
      return wave[b][(i + rot[b]) & 31] << 4 | wave[b][(i + 1 + rot[b]) & 31];
    }
    // SOUNDCNT_X's low bits say which channels are still sounding, so a length counter that ran out shows here; a note
    // still waiting for its place in the frame is already sounding, for the sound library that started it
    if (r === 0x84) {
      let waiting = 0;
      for (const w of waits) if (w.v & 0x80) waiting |= w.r === 0x65 ? 1 : w.r === 0x6D ? 2 : w.r === 0x75 ? 4 : w.r === 0x7D ? 8 : 0;
      return (reg(0x84) & 0x80) | (sq[0].on || (waiting & 1) ? 1 : 0) | (sq[1].on || (waiting & 2) ? 2 : 0)
        | (ch3.on || (waiting & 4) ? 4 : 0) | (ch4.on || (waiting & 8) ? 8 : 0);
    }
    // a register read back while a write to it waits gives what was written, as the library reads its own writes
    if (api.psgAt >= 0) for (let i = waits.length - 1; i >= 0; i--) if (waits[i].r === r) return waits[i].v & 0xFF;
    return regs[r - 0x60];
  }

  function frameSequencer() {
    if (!(seqStep & 1)) {
      // length counters, 256 Hz
      if (lengthOn(0x65) && sq[0].len && !--sq[0].len) sq[0].on = false;
      if (lengthOn(0x6D) && sq[1].len && !--sq[1].len) sq[1].on = false;
      if (lengthOn(0x75) && ch3.len && !--ch3.len) ch3.on = false;
      if (lengthOn(0x7D) && ch4.len && !--ch4.len) ch4.on = false;
    }
    if (seqStep === 2 || seqStep === 6) {
      // frequency sweep, 128 Hz
      const v = reg(0x60), period = (v >> 4) & 7;
      if (--sweep.timer <= 0) {
        sweep.timer = period || 8;
        if (sweep.on && period) {
          const f = sweepNext();
          if (f <= 2047 && (v & 7)) { sweep.shadow = f; sq[0].freq = f; sweepNext(); }
        }
      }
    }
    if (seqStep === 7) { stepEnvelope(sq[0].env); stepEnvelope(sq[1].env); stepEnvelope(ch4.env); }
    seqStep = (seqStep + 1) & 7;
  }

  // the next wave sample: the one at the front of the playing bank (both banks in 64-sample mode)
  function stepWave() {
    const b = (reg(0x70) >> 6) & 1;
    if (!(reg(0x70) & 0x20)) { ch3.sample = wave[b][rot[b]]; rot[b] = (rot[b] + 1) & 31; return; }
    // one 64-sample ring through both banks: the front of the playing bank moves to the end of the other one
    ch3.sample = wave[b][rot[b]];
    const carry = wave[b ^ 1][rot[b ^ 1]];
    wave[b][rot[b]] = carry; wave[b ^ 1][rot[b ^ 1]] = ch3.sample;
    rot[0] = (rot[0] + 1) & 31; rot[1] = (rot[1] + 1) & 31;
  }

  // advances every oscillator by `cycles`; the squares' duty steps run even while they are silent. As in mGBA, a square
  // counts the time since its last step against the pitch it has now, so one that was silent at a slow pitch, as the
  // sound library leaves it when it stops a note, starts its next note on time
  function run(cycles) {
    while (waits.length && waits[0].in <= cycles) {
      const { in: wait, r, v } = waits.shift();
      runChip(wait);
      cycles -= wait;
      for (const w of waits) w.in -= wait;
      writeNow(r, v);
    }
    for (const w of waits) w.in -= cycles;
    runChip(cycles);
  }

  // in exact mode the chip runs up to each frame sequencer step, where a sweep changes the pitch, and mGBA's count
  // catches up the squares that play at the last sample before each stretch's end
  function runChip(cycles) {
    if (!api.exact) { stepChip(cycles); api.clock += cycles; return; }
    while (cycles > 0) {
      const step = Math.min(cycles, seqTimer), end = api.clock + step, sample = end - (end + api.powerOn) % TICK;
      if ((reg(0x84) & 0x80) && sample > api.clock) for (const i of [0, 1]) if (advancing(i)) catchUp(i, sample);
      stepChip(step);
      holdSamples();
      api.clock = end;
      cycles -= step;
    }
  }

  // mGBA mixes each channel's last sample whether it plays or not: a channel that stops leaves its level where it was
  function holdSamples() {
    for (const i of [0, 1]) if (sq[i].on) held[i] = DUTY[reg(i ? 0x68 : 0x62) >> 6][sq[i].pos] * sq[i].env.vol;
    if (ch4.on) held[3] = ch4.out * ch4.env.vol;
  }

  function stepChip(cycles) {
    if (!(reg(0x84) & 0x80)) {
      if (!api.exact) return;
      // the squares count the time while the sound is off and catch it up at the pitch they have once it's on, and
      // the frame sequencer keeps its time, stepping nothing (mGBA)
      for (const c of sq) {
        c.since += cycles;
        if (c.since >= OFF_PERIOD && !c.freq) { c.pos = (c.pos + Math.floor(c.since / OFF_PERIOD)) & 7; c.since %= OFF_PERIOD; }
      }
      seqTimer -= cycles;
      while (seqTimer <= 0) seqTimer += SEQ_PERIOD;
      return;
    }
    for (const c of sq) {
      c.since += cycles;
      const period = sqPeriod(c);
      if (c.since >= period) {
        c.pos = (c.pos + Math.floor(c.since / period)) & 7;
        c.since %= period;
      }
    }
    if (ch3.on) {
      ch3.timer -= cycles;
      while (ch3.timer <= 0) { ch3.timer += wavePeriod(); stepWave(); }
    }
    if (ch4.on) {
      const period = noisePeriod();
      if (period) {
        ch4.timer -= cycles;
        while (ch4.timer <= 0) {
          ch4.timer += period;
          // the LFSR in its shift-and-xor form; the bit shifted out is the output
          ch4.out = ch4.lfsr & 1;
          ch4.lfsr >>= 1;
          if (ch4.out) ch4.lfsr ^= reg(0x7C) & 8 ? 0x60 : 0x6000;
        }
      }
    }
    seqTimer -= cycles;
    while (seqTimer <= 0) { seqTimer += SEQ_PERIOD; frameSequencer(); }
  }

  function waveSample() {
    const v = reg(0x73), s = ch3.sample;
    if (v & 0x80) return (s * 3) >> 2;
    const code = (v >> 5) & 3;
    return code ? s >> (code - 1) : 0;
  }

  /** The output for this instant, given the DirectSound samples now playing on FIFO A and B, as offsets
   *  around the bias in 10-bit units: [left, right], in an array the next call writes over (the mix runs
   *  65536 times a second on the audio thread, which makes nothing new) */
  const out = [0, 0];
  function mix(fifoA, fifoB) {
    const on = !!(reg(0x84) & 0x80), nr51 = reg(0x81) & ~(api.muted * 0x11);
    let s1 = on && sq[0].on ? DUTY[reg(0x62) >> 6][sq[0].pos] * sq[0].env.vol : 0;
    let s2 = on && sq[1].on ? DUTY[reg(0x68) >> 6][sq[1].pos] * sq[1].env.vol : 0;
    let s3 = on && ch3.on ? waveSample() : 0;
    let s4 = on && ch4.on ? ch4.out * ch4.env.vol : 0;
    // in exact mode a stopped channel keeps its last sample, and the wave's follows its volume register as mGBA's does
    if (on && api.exact) {
      if (!sq[0].on) s1 = held[0];
      if (!sq[1].on) s2 = held[1];
      if (!ch3.on) s3 = waveSample();
      if (!ch4.on) s4 = held[3];
    }
    let r = (nr51 & 1 ? s1 : 0) + (nr51 & 2 ? s2 : 0) + (nr51 & 4 ? s3 : 0) + (nr51 & 8 ? s4 : 0);
    let l = (nr51 & 0x10 ? s1 : 0) + (nr51 & 0x20 ? s2 : 0) + (nr51 & 0x40 ? s3 : 0) + (nr51 & 0x80 ? s4 : 0);
    const nr50 = reg(0x80), cnt = reg(0x82) | reg(0x83) << 8, shift = 4 - (cnt & 3);
    r = ((r << 3) * (1 + (nr50 & 7))) >> shift;
    l = ((l << 3) * (1 + ((nr50 >> 4) & 7))) >> shift;
    const a = fifoA << (cnt & 4 ? 2 : 1), b = fifoB << (cnt & 8 ? 2 : 1);
    if (cnt & 0x100) r += a;
    if (cnt & 0x200) l += a;
    if (cnt & 0x1000) r += b;
    if (cnt & 0x2000) l += b;
    const bias = (reg(0x88) | reg(0x89) << 8) & 0x3FE;
    out[0] = Math.min(0x3FF, Math.max(0, l + bias)) - bias;
    out[1] = Math.min(0x3FF, Math.max(0, r + bias)) - bias;
    return out;
  }

  // `muted`: channels 1–4 (bits 0–3) left out of the mix, as m4a.js mutes the music's; `psgAt`: where the next write to a
  // channel lands, or -1 for at once; `late`: how far past the console's frame start the chip's frame began, on a
  // whole sample (synth.js); `clock`: the chip's cycles since it was made
  const api = { read, write, run, mix, regs, muted: 0, at: null, psgAt: -1, late: 0, exact: false, powerOn: 0, clock: 0,
    /** Moves the waiting writes `cycles` later, for a frame found to have taken that much longer. */
    waveLater(cycles) { for (const w of waits) w.in += cycles; },
    /** The squares and the frame sequencer as mGBA counts them from the console's power-on, `powerOnBefore` cycles
     *  before the chip's clock started (apu_exact in the C kit). */
    exactFrom(powerOnBefore) {
      api.exact = true; api.powerOn = powerOnBefore;
      const sincePowerOn = api.clock + powerOnBefore;
      // since power-on the squares have stood at step 0 with the pitch at 0, the chip's own state until now
      for (const i of [0, 1]) { sqLast[i] = -powerOnBefore; sqIndex[i] = 0; sq[i].pos = 0; sq[i].since = sincePowerOn; }
      // and the frame sequencer has stepped every SEQ_PERIOD from power-on
      seqTimer = SEQ_PERIOD - (sincePowerOn % SEQ_PERIOD);
    } };
  return api;
}
