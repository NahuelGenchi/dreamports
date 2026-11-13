// The sound engine of most Game Boy Advance games: Nintendo's MusicPlayer2000 ("m4a", "Sappy"), the version of
// it SAT-R's decompilation of Sonic Advance has (src/lib/m4a/m4a.c and m4a0.s), set up with the game's own sound
// mode (soundMode). It reads the songs, voices and samples straight from the ROM and runs once per GBA frame: the
// music players step their sequences, the PSG channels get their register writes, and the DirectSound mixer
// writes the signed 8-bit samples per side that play during the next frame (176 at 10512 Hz). Every integer step
// follows the original, so the mixed bytes match the hardware's byte for byte. Another game may have another
// version of the library, which can differ in small ways, such as how a PSG channel pans (cgbModVol): check it
// against that game's decompilation.

import { COST, COSTS, LIBRARY } from './costs.js';

const ROM_BASE = 0x08000000;

/** Each side of the mixed samples' buffer (PCM_DMA_BUF_SIZE). */
export const HALF = 1584;
// the rates a sound mode can pick (SOUND_MODE_FREQ_05734 to _42048), each with the samples mixed per frame
const SAMPLES_AT = {
  5734: 96, 7884: 132, 10512: 176, 13379: 224, 15768: 264, 18157: 304,
  21024: 352, 26758: 448, 31536: 528, 36314: 608, 40137: 672, 42048: 704,
};

/**
 * What a game's sound mode sets (m4aSoundMode, with DEFAULT_SOUND_MODE in its decompilation): `channels`, the
 * DirectSound channels (1 to 12); `volume`, the master volume (1 to 15); `rate`, the samples a second (10512 for
 * SOUND_MODE_FREQ_10512); and `reverb`, 0 to 127 (none by default). Returns them with what the rate sets
 * (SampleFreqSet): the samples mixed per frame, the frames one DMA buffer lasts and the pitch divider.
 */
export function soundMode({ channels, volume, rate, reverb = 0 }) {
  const samples = SAMPLES_AT[rate];
  if (!samples) throw new Error(`The sound engine has no ${rate} Hz rate: it has ${Object.keys(SAMPLES_AT).join(', ')}.`);
  const pcmFreq = Math.floor((597275 * samples + 5000) / 10000);
  return { channels, volume, reverb, samples, framesPerDma: Math.floor(HALF / samples), divFreq: (Math.floor(16777216 / pcmFreq) + 1) >> 1 };
}

// channel status bits
const START = 0x80, STOP = 0x40, LOOP = 0x10, IEC = 0x04, ENV = 0x03, ON = START | STOP | IEC | ENV;
// track flags
const EXIST = 0x80, TRACK_START = 0x40, VOLCHG = 0x03, PITCHG = 0x0C;
const PAUSE = 0x80000000;
// what a PSG channel needs written this frame
const MO_VOL = 1, MO_PIT = 2;

const s8 = v => (v << 24) >> 24;
const u8 = v => v & 0xFF;

// note and wait lengths in ticks: 0–24, then 28 … 96
const CLOCK = [...Array(25).keys(), 28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96];
// 2^31 · 2^(n/12): one octave of DirectSound pitch ratios
const FREQ = Array.from({ length: 12 }, (_, n) => Math.round(2 ** 31 * 2 ** (n / 12)));
// PSG frequency registers for the top octave, as 11-bit values minus 2048
const CGB_FREQ = [-2004, -1891, -1785, -1685, -1591, -1501, -1417, -1337, -1262, -1192, -1125, -1062];
// noise: clock shift and divider from high to low, three dividers per shift, then the fastest four
const NOISE = [...Array.from({ length: 56 }, (_, i) => ((13 - (i >> 2)) << 4) | (7 - (i & 3))), 3, 2, 1, 0];
// wave channel output level (NR32) for each envelope volume
const CGB3_VOL = [0x00, 0x00, 0x60, 0x60, 0x60, 0x60, 0x40, 0x40, 0x40, 0x40, 0x80, 0x80, 0x80, 0x80, 0x20, 0x20];

// the PSG registers each channel uses (offsets from 0x04000000); channels 2 and 4 have no NRx0 of their own
const CGB_REGS = [
  [0x60, 0x62, 0x63, 0x64, 0x65],
  [0x61, 0x68, 0x69, 0x6C, 0x6D],
  [0x70, 0x72, 0x73, 0x74, 0x75],
  [0x71, 0x78, 0x79, 0x7C, 0x7D],
];
export const NR10 = 0x60, NR30 = 0x70, NR32 = 0x73, NR34 = 0x75, NR50 = 0x80, NR51 = 0x81, SOUNDCNT_H = 0x82,
  SOUNDCNT_X = 0x84, SOUNDBIAS_H = 0x89, WAVE_RAM = 0x90;

// high 32 bits of an unsigned 32 × 32 bit product
function umulhi(a, b) {
  const a0 = a & 0xFFFF, a1 = a >>> 16, b0 = b & 0xFFFF, b1 = b >>> 16;
  const m1 = a1 * b0, m2 = a0 * b1;
  const carry = (((a0 * b0) >>> 16) + (m1 & 0xFFFF) + (m2 & 0xFFFF)) >>> 16;
  return (a1 * b1 + (m1 >>> 16) + (m2 >>> 16) + carry) >>> 0;
}

function voiceAt(bytes, at) {
  const w = i => (bytes[at + i] | bytes[at + i + 1] << 8 | bytes[at + i + 2] << 16 | bytes[at + i + 3] << 24) >>> 0;
  return {
    type: bytes[at], key: bytes[at + 1], length: bytes[at + 2], panSweep: bytes[at + 3], wav: w(4),
    attack: bytes[at + 8], decay: bytes[at + 9], sustain: bytes[at + 10], release: bytes[at + 11],
  };
}
const NO_VOICE = { type: 0, key: 0, length: 0, panSweep: 0, wav: 0, attack: 0, decay: 0, sustain: 0, release: 0 };

function newTrack(addr) {
  return {
    addr, flags: 0, wait: 0, patternLevel: 0, repN: 0, gateTime: 0, key: 0, velocity: 0, runningStatus: 0,
    keyShiftCalc: 0, pitchCalc: 0, keyShift: 0, keyShiftPublic: 0, tune: 0, pitchPublic: 0, bend: 0, bendRange: 0,
    volRCalc: 0, volLCalc: 0, vol: 0, volPublic: 0, pan: 0, panPublic: 0, modCalc: 0, modDepth: 0, modType: 0,
    lfoSpeed: 0, lfoSpeedCounter: 0, lfoDelay: 0, lfoDelayCounter: 0, priority: 0, echoVolume: 0, echoLength: 0,
    chan: null, voice: NO_VOICE, cmdPtr: 0, patternStack: [0, 0, 0],
  };
}

// what the first tick after a start clears: everything before the command pointer
function clearTrack(T) {
  Object.assign(T, newTrack(T.addr), { cmdPtr: T.cmdPtr, patternStack: T.patternStack });
  T.flags = EXIST; T.bendRange = 2; T.volPublic = 64; T.lfoSpeed = 22; T.voice = { ...NO_VOICE, type: 1 };
}

function newChannel() {
  return {
    status: 0, type: 0, rightVol: 0, leftVol: 0, attack: 0, decay: 0, sustain: 0, release: 0, key: 0,
    envVol: 0, envR: 0, envL: 0, echoVol: 0, echoLen: 0, gateTime: 0, midiKey: 0, velocity: 0, priority: 0,
    rhythmPan: 0, count: 0, fw: 0, freq: 0, wav: 0, current: 0, track: null, prev: null, next: null,
    // PSG channels only
    envelopeGoal: 0, envelopeCtr: 0, sustainGoal: 0, nrx4: 0, pan: 0, panMask: 0, cgbStatus: 0, length: 0, sweep: 0,
  };
}

/**
 * @param {Uint8Array} rom the whole ROM
 * @param {{songTable: number, playerTable: number, players: number, songs: number, mode: object}} layout file offsets
 *   and counts (tables.js), and the game's sound mode (soundMode)
 * @param {{read(reg: number): number, write(reg: number, value: number): void}} io the sound registers
 */
const FRAME_CYCLES = 280896, CPU_HZ = 16777216;

export function createM4A(rom, layout, io) {
  const u32 = at => (rom[at] | rom[at + 1] << 8 | rom[at + 2] << 16 | rom[at + 3] << 24) >>> 0;
  const r8 = addr => rom[addr - ROM_BASE];

  if (!layout.mode) throw new Error("The sound engine needs the game's sound mode (layout.mode).");
  const { channels: NUM_CHANS, volume: MASTER_VOL, samples: SAMPLES, framesPerDma: FRAMES_PER_DMA, divFreq: DIV_FREQ, reverb } = soundMode(layout.mode);
  // what each place in SoundMain costs in the game's version of the library (costs.js)
  const library = layout.library ?? LIBRARY.sonicBattle, costs = COSTS[library];
  const cost = site => { cycles += costs[site]; };
  const info = { reverb, dmaCounter: 0, c15: 0, pcm: new Int8Array(2 * HALF), memAcc: new Uint8Array(256) };
  // what is left out of the output: `music` silences the notes of the first music player (the BGM's), as the
  // second and later GBAs of a multiplayer game do on one page, where the first one's music is heard
  const muted = { music: false };
  // the DirectSound channels (gSoundInfo's) and the four PSG ones (gCgbChans)
  const chans = Array.from({ length: NUM_CHANS }, newChannel);
  const cgbChans = Array.from({ length: 4 }, newChannel);
  cgbChans.forEach((C, i) => { C.type = i + 1; C.panMask = 0x11 << i; });

  const players = [];
  for (let i = 0; i < layout.players; i++) {
    const at = layout.playerTable + i * 12, tracks = u32(at + 4), count = rom[at + 8];
    players.push({
      // the player table's own byte (unk_A, MPlayOpen's unk_B): when set, a song doesn't take the player from a higher one
      addr: u32(at), guarded: rom[at + 10] !== 0, songHeader: 0, status: 0, priority: 0, cmd: 0, clock: 0, tempoD: 0, tempoU: 0, tempoI: 0,
      tempoC: 0, fadeInterval: 0, fadeCounter: 0, fadeOV: 0, voicegroup: 0,
      tracks: Array.from({ length: count }, (_, t) => newTrack(tracks + 0x50 * t)),
    });
    // Sonic Advance's MPlayOpen leaves a player paused until a song starts on it, which its MPlayMain then passes by
    if (library === LIBRARY.sonicAdvance) players[i].status = PAUSE;
  }

  // how many of the console's cycles this frame's SoundMain takes, as mGBA counts its instructions (WAITCNT 0x4014)
  let cycles = 0;
  // about what a player takes in a frame it starts nothing
  const IDLE_PLAYER = 400;
  let inFrame = false, callAt = FRAME_CYCLES, earlyCost = 0, earlyPlayer = null;
  const LINE_CYCLES = 1232, VISIBLE_LINES = 160;
  // how far into SoundMain its count of `cycles` reaches once the DMA that halts the CPU on the way is added: the FIFO
  // refills, every 16 samples, and while the game has it on, the H-blank DMA at the end of each visible line
  function withDma(start, count) {
    const refill = fifoCost ? 16 * Math.floor((CPU_HZ + (layout.mode.rate >> 1)) / layout.mode.rate) : 0;
    let reach = count;
    for (let again = 0; again < 8; again++) {
      let halted = 0;
      const end = start + reach;
      if (refill) for (let at = fifoAt; at < end; at += refill) if (at >= start) halted += fifoCost;
      if (hblank) for (let n = 0; n < VISIBLE_LINES; n++) {
        const at = hblankAt + n * LINE_CYCLES;
        if (at >= end) break;
        if (at >= start) halted += hblank;
      }
      if (count + halted === reach) break;
      reach = count + halted;
    }
    return reach;
  }
  // with `psgAt`, the writes to the sound chip's channels land at that place in its frame: SoundMain's, as late as this
  // frame's starts, plus what it has counted so far and the DMA on the way, as the original's land where its work has
  // reached. The chip's frame starts on a whole sample, `late` cycles past the console's. The game's own calls write at once
  function ioWrite(reg, v) {
    const start = psgAt + late;
    io.psgAt = !psgAt || !inFrame ? -1 : start - io.late + withDma(start, cycles);
    io.write(reg, v);
  }
  let hblank = 0, late = 0;   // this frame's H-blank DMA, in cycles a line, and how late its SoundMain starts
  // SoundMain's place in the frame, and where the DMA lands in it (psgAt and dmaAt), held through a restart in the layout
  let psgAt = layout.psgAt ?? 0, fifoAt = layout.fifoAt ?? 0, fifoCost = layout.fifoCost ?? 0, hblankAt = layout.hblankAt ?? 0;

  // the registers MPlayExtender and SoundInit set
  ioWrite(SOUNDCNT_X, 0x8F);
  ioWrite(NR50, 0); ioWrite(NR51, 0);
  for (const [nr2, nr4] of [[0x63, 0x65], [0x69, 0x6D], [0x79, 0x7D]]) { ioWrite(nr2, 0x08); ioWrite(nr4, 0x80); }
  ioWrite(NR30, 0);
  ioWrite(NR50, 0x77);
  ioWrite(SOUNDCNT_H, 0x0E); ioWrite(SOUNDCNT_H + 1, 0xA9);
  ioWrite(SOUNDBIAS_H, (io.read(SOUNDBIAS_H) & 0x3F) | 0x40);

  // ---- pitch ----

  // how many cycles of wait the multiplier adds for an operand, which it reads a byte at a time from the top while the
  // rest are zeros (unsigned, as umull reads it), from 1 to 4
  const mulBytes = x => !(x >>> 8) ? 1 : !(x >>> 16) ? 2 : !(x >>> 24) ? 3 : 4;

  function midiKeyToFreq(wav, key, fine) {
    fine = (fine << 24) >>> 0;
    if (key > 178) { cost(COST.FREQ_TOP); key = 178; fine = (255 << 24) >>> 0; } else cost(COST.FREQ);
    const f1 = FREQ[key % 12] >>> (14 - Math.floor(key / 12));
    const f2 = FREQ[(key + 1) % 12] >>> (14 - Math.floor((key + 1) / 12));
    // umul3232H32 twice, its wait set by the second operand of each
    const x = (f1 + umulhi((f2 - f1) >>> 0, fine)) >>> 0;
    cost(COST.FREQ_MUL1 + mulBytes(fine) - 1);
    cost(COST.FREQ2_MUL1 + mulBytes(x) - 1);
    return umulhi(u32(wav + 4 - ROM_BASE), x);
  }

  function midiKeyToCgbFreq(ch, key, fine) {
    if (ch === 4) {
      cost(key <= 20 ? COST.NOISE_LOW : key - 21 > 59 ? COST.NOISE_HIGH : COST.NOISE);
      return NOISE[key <= 20 ? 0 : Math.min(key - 21, 59)];
    }
    let k;
    if (key <= 35) { cost(COST.TONE_LOW); k = 0; fine = 0; }
    else { k = key - 36; if (k > 130) { cost(COST.TONE_HIGH); k = 130; fine = 255; } else cost(COST.TONE); }
    const v1 = CGB_FREQ[k % 12] >> Math.floor(k / 12), v2 = CGB_FREQ[(k + 1) % 12] >> Math.floor((k + 1) / 12);
    return v1 + ((fine * (v2 - v1)) >> 8) + 2048;
  }

  // ---- tracks ----

  function trkVolPitSet(T) {
    if (T.flags & 0x01) {
      cost(COST.SET_VOLUME);
      let x = (T.vol * T.volPublic) >>> 5;
      if (T.modType === 1) { cost(COST.SET_TREMOLO); x = (x * (T.modCalc + 128)) >> 7; }
      let y = 2 * T.pan + T.panPublic;
      if (T.modType === 2) { cost(COST.SET_PAN_LFO); y += T.modCalc; }
      cost(y < -128 ? COST.SET_PAN_LOW : y > 127 ? COST.SET_PAN_HIGH : COST.SET_PAN);
      y = Math.max(-128, Math.min(127, y));
      T.volRCalc = u8(((y + 128) * x) >> 8);
      T.volLCalc = u8(((127 - y) * x) >> 8);
    } else cost(COST.SET_NO_VOLUME);
    if (T.flags & 0x04) {
      cost(COST.SET_PITCH);
      let p = (T.tune + T.bend * T.bendRange) * 4 + (T.keyShift << 8) + (T.keyShiftPublic << 8) + T.pitchPublic;
      if (T.modType === 0) { cost(COST.SET_VIBRATO); p += 16 * T.modCalc; }
      T.keyShiftCalc = s8(p >> 8);
      T.pitchCalc = u8(p);
    } else cost(COST.SET_NO_PITCH);
    T.flags &= ~0x05;
  }

  function chnVolSet(C, T) {
    const rp = C.rhythmPan, vel = C.velocity;
    const r = (T.volRCalc * ((128 + rp) * vel)) >> 14, l = (T.volLCalc * ((127 - rp) * vel)) >> 14;
    cost(COST.CHANNEL_VOLUME + (r > 255 ? 1 : 0) + (l > 255 ? 2 : 0));
    C.rightVol = Math.min(255, r);
    C.leftVol = Math.min(255, l);
  }

  function clearChain(C) {
    const T = C.track;
    cost(!T ? COST.CHAIN_NONE : !C.prev && !C.next ? COST.CHAIN_ALONE : !C.prev ? COST.CHAIN_FIRST : !C.next ? COST.CHAIN_LAST : COST.CHAIN_MIDDLE);
    if (!T) return;
    if (C.prev) C.prev.next = C.next; else T.chan = C.next;
    if (C.next) C.next.prev = C.prev;
    C.track = null;
  }

  // with `soundMainAt`, when the wave voice's next write lands, counted from the start of the chip's frame: in the console's
  // next one, at SoundMain's place plus what it has counted so far, or for a call the game makes, where its own code has reached
  function waveAt() { if (layout.soundMainAt) io.at = inFrame ? FRAME_CYCLES + layout.soundMainAt + cycles - earlyCost : callAt; }

  function cgbOscOff(ch) {
    if (ch === 3) { waveAt(); ioWrite(NR30, 0); return; }
    const [, , nr2, , nr4] = CGB_REGS[ch - 1];
    ioWrite(nr2, 0x08); ioWrite(nr4, 0x80);
  }

  function trackStop(T) {
    if (!(T.flags & EXIST)) { cost(COST.STOP_ABSENT); return; }
    if (!T.chan) cost(COST.STOP_NO_CHANNELS);
    for (let C = T.chan; C; C = C.next) {
      cost(COST.STOP_CHANNEL);
      if (C.status) {
        cost(COST.STOP_CHANNEL_ON);
        if (C.type & 7) { cost(COST.CALL); cgbOscOff(C.type & 7); }
        C.status = 0;
      }
      C.track = null;
    }
    T.chan = null;
  }

  function clearModM(T) {
    cost(T.modType === 0 ? COST.LFO_CLEAR_PITCH : COST.LFO_CLEAR_VOLUME);
    T.modCalc = 0; T.lfoSpeedCounter = 0;
    T.flags |= T.modType === 0 ? PITCHG : VOLCHG;
  }

  // ---- commands 0xB1 … 0xCE ----

  const arg = T => r8(T.cmdPtr++);
  // a command's argument as the library reads it, through its check that the address is in the cartridge, or not
  const checkedArg = T => { cost(COST.ARG); return arg(T); };
  const uncheckedArg = T => { cost(COST.ARG_UNCHECKED); return arg(T); };
  const ptrArg = T => { cost(COST.POINTER); return u32(T.cmdPtr - ROM_BASE); };

  function fine(P, T) {
    if (!T.chan) cost(COST.FINE_NO_CHANNELS);
    for (let C = T.chan; C; C = C.next) {
      cost(COST.FINE_CHANNEL);
      if (C.status & ON) { cost(COST.FINE_CHANNEL_ON); C.status |= STOP; }
      clearChain(C);
    }
    T.flags = 0;
  }
  function goto(P, T) { T.cmdPtr = ptrArg(T); }
  function patt(P, T) {
    if (T.patternLevel >= 3) { fine(P, T); return; }
    T.patternStack[T.patternLevel++] = T.cmdPtr + 4;
    goto(P, T);
  }
  function pend(P, T) {
    cost(T.patternLevel ? COST.PATTERN_END : COST.PATTERN_END_NONE);
    if (T.patternLevel) T.cmdPtr = T.patternStack[--T.patternLevel];
  }
  function rept(P, T) {
    const n = r8(T.cmdPtr);
    if (n === 0) { T.cmdPtr++; goto(P, T); return; }
    T.repN = u8(T.repN + 1);
    if (T.repN < n) { T.cmdPtr++; goto(P, T); } else { T.repN = 0; T.cmdPtr += 5; }
  }
  // reads and writes the players' shared scratch bytes, or jumps on a comparison with them (untested: none of the
  // songs checked so far uses it)
  function memacc(P, T) {
    const op = checkedArg(T), at = checkedArg(T), data = checkedArg(T), mem = info.memAcc, v = mem[at];
    const ops = [
      () => { mem[at] = data; }, () => { mem[at] += data; }, () => { mem[at] -= data; },
      () => { mem[at] = mem[data]; }, () => { mem[at] += mem[data]; }, () => { mem[at] -= mem[data]; },
    ];
    const tests = [(a, b) => a === b, (a, b) => a !== b, (a, b) => a > b, (a, b) => a >= b, (a, b) => a <= b, (a, b) => a < b];
    if (op < 6) ops[op]();
    else if (op < 18) {
      if (tests[(op - 6) % 6](v, op < 12 ? data : mem[data])) goto(P, T); else T.cmdPtr += 4;
    }
  }
  function xcmd(P, T) {
    const sub = checkedArg(T);
    switch (sub) {
      case 1: T.voice = { ...T.voice, wav: ptrArg(T) }; T.cmdPtr += 4; return;
      case 2: T.voice = { ...T.voice, type: checkedArg(T) }; return;
      case 4: T.voice = { ...T.voice, attack: checkedArg(T) }; return;
      case 5: T.voice = { ...T.voice, decay: checkedArg(T) }; return;
      case 6: T.voice = { ...T.voice, sustain: checkedArg(T) }; return;
      case 7: T.voice = { ...T.voice, release: checkedArg(T) }; return;
      case 8: T.echoVolume = checkedArg(T); return;
      case 9: T.echoLength = checkedArg(T); return;
      case 10: T.voice = { ...T.voice, length: checkedArg(T) }; return;
      case 11: T.voice = { ...T.voice, panSweep: checkedArg(T) }; return;
      default: fine(P, T);
    }
  }
  function eot(P, T) {
    if (r8(T.cmdPtr) < 0x80) { cost(COST.EOT_KEY); T.key = arg(T); } else cost(COST.EOT_NO_KEY);
    if (!T.chan) cost(COST.EOT_NO_CHANNELS);
    for (let C = T.chan; C; C = C.next) {
      if (!(C.status & (START | ENV))) { cost(COST.EOT_SILENT); continue; }
      if (C.status & STOP) { cost(COST.EOT_STOPPING); continue; }
      if (C.midiKey !== T.key) { cost(COST.EOT_OTHER_KEY); continue; }
      cost(COST.EOT_STOPS);
      C.status |= STOP;
      return;
    }
  }

  const COMMANDS = [
    fine, goto, patt, pend, rept, fine, fine, fine, memacc,
    (P, T) => { T.priority = checkedArg(T); },
    (P, T) => { P.tempoD = checkedArg(T) * 2; P.tempoI = (P.tempoD * P.tempoU) >> 8; },
    (P, T) => { T.keyShift = s8(checkedArg(T)); T.flags |= PITCHG; },
    (P, T) => { const i = arg(T); for (let w = 0; w < 3; w++) cost(COST.VOICE_WORD); T.voice = voiceAt(rom, P.voicegroup - ROM_BASE + i * 12); },
    (P, T) => { T.vol = checkedArg(T); T.flags |= VOLCHG; },
    (P, T) => { T.pan = s8(checkedArg(T) - 0x40); T.flags |= VOLCHG; },
    (P, T) => { T.bend = s8(checkedArg(T) - 0x40); T.flags |= PITCHG; },
    (P, T) => { T.bendRange = checkedArg(T); T.flags |= PITCHG; },
    (P, T) => { T.lfoSpeed = uncheckedArg(T); cost(T.lfoSpeed ? COST.LFO_SPEED : COST.LFO_SPEED_OFF); if (!T.lfoSpeed) clearModM(T); },
    (P, T) => { T.lfoDelay = checkedArg(T); },
    (P, T) => { T.modDepth = uncheckedArg(T); cost(T.modDepth ? COST.DEPTH : COST.DEPTH_OFF); if (!T.modDepth) clearModM(T); },
    (P, T) => {
      const t = checkedArg(T);
      if (t === T.modType) { cost(COST.MOD_TYPE_SAME); return; }
      cost(COST.MOD_TYPE_NEW);
      T.modType = t; T.flags |= VOLCHG | PITCHG;
    },
    fine, fine,
    (P, T) => { T.tune = s8(checkedArg(T) - 0x40); T.flags |= PITCHG; },
    fine, fine, fine,
    (P, T) => { const reg = checkedArg(T); ioWrite(0x60 + reg, checkedArg(T)); },
    xcmd, eot,
  ];

  // ---- notes ----

  // the DirectSound channel a new note takes: a free one at once, else the lowest priority among the releasing
  // ones (or, when none is releasing, among the playing ones), ties going to the later track
  function pickChannel(prio, T) {
    let best = null, bestPrio = prio, bestTrack = T.addr, stopping = false;
    for (let i = 0; i < chans.length; i++) {
      const C = chans[i];
      if (i) cost(COST.PICK_NEXT);
      if (!(C.status & ON)) { cost(COST.PICK_FREE); return C; }
      if (C.status & STOP) {
        if (!stopping) { stopping = true; bestPrio = C.priority; bestTrack = C.track ? C.track.addr : 0; best = C; cost(COST.PICK_FIRST_STOPPING); continue; }
        cost(COST.PICK_STOPPING_AGAIN);
      } else if (stopping) { cost(COST.PICK_SKIP); continue; }
      else cost(COST.PICK_COMPARE);
      const tr = C.track ? C.track.addr : 0;
      if (C.priority < bestPrio) { bestPrio = C.priority; bestTrack = tr; best = C; cost(COST.PICK_LOWER); }
      else if (C.priority === bestPrio) {
        if (tr > bestTrack) { bestTrack = tr; best = C; cost(COST.PICK_LATER); }
        else if (tr === bestTrack) { best = C; cost(COST.PICK_SAME); }
        else cost(COST.PICK_EARLIER);
      } else cost(COST.PICK_HIGHER);
    }
    cost(best ? COST.PICK_FOUND : COST.PICK_NONE);
    return best;
  }

  function plynote(idx, P, T) {
    T.gateTime = CLOCK[idx];
    if (r8(T.cmdPtr) < 0x80) {
      T.key = arg(T);
      cost(COST.NOTE_KEY);
      if (r8(T.cmdPtr) < 0x80) {
        T.velocity = arg(T);
        cost(COST.NOTE_VELOCITY);
        if (r8(T.cmdPtr) < 0x80) { T.gateTime = u8(T.gateTime + arg(T)); cost(COST.NOTE_GATE); }
      }
    }
    let rhythmPan = 0, V = T.voice, key = T.key;
    if (V.type & 0xC0) {
      // key split: a table picks the sub-voice; drum kit: the key does, and the drum brings its own key and pan
      const table = V.attack | V.decay << 8 | V.sustain << 16 | V.release << 24;
      const n = V.type & 0x40 ? r8((table >>> 0) + T.key) : T.key;
      const S = voiceAt(rom, V.wav - ROM_BASE + n * 12);
      if (S.type & 0xC0) return;
      if (V.type & 0x80) {
        cost(S.panSweep & 0x80 ? COST.DRUM_PAN : COST.DRUM_NO_PAN);
        if (S.panSweep & 0x80) rhythmPan = s8((S.panSweep - 0xC0) * 2);
        key = S.key;
        cost(COST.DRUM);
      }
      V = S;
    }
    // the voice is the track's own copy in memory, or a key split's or drum kit's from the cartridge, which reads slower
    const fromRom = (T.voice.type & 0xC0) !== 0;
    const prio = Math.min(P.priority + T.priority, 255);
    const cgb = V.type & 7;
    cost(cgb ? COST.VOICE_CGB1 + cgb - 1 : COST.VOICE_DS);
    let C;
    if (cgb) {
      C = cgbChans[cgb - 1];
      cost(cgb === 4 ? COST.CGB_NOISE : COST.CGB_TONE);
      const tr = C.track ? C.track.addr : 0;
      if (!(C.status & ON)) cost(COST.CGB_FREE);
      else if (C.status & STOP) cost(COST.CGB_STOPPING);
      else if (C.priority < prio) cost(COST.CGB_LOWER);
      else if (C.priority > prio) cost(COST.CGB_HIGHER);
      else cost(tr < T.addr ? COST.CGB_SAME_EARLIER : COST.CGB_SAME_LATER);
      if ((C.status & ON) && !(C.status & STOP)) {
        if (C.priority > prio) return;
        if (C.priority === prio && tr < T.addr) return;
      }
    } else {
      C = pickChannel(prio, T);
      if (!C) return;
    }
    if (C.track) cost(C.next ? COST.TAKEN_HAS_NEXT : COST.TAKEN_LAST);
    cost(fromRom ? COST.VOICE_ROM : COST.VOICE_RAM);
    if (T.chan) cost(COST.TRACK_HAD_CHANNELS);
    if (T.flags & 0x01) cost(COST.NOTE_VOLUME);
    if (T.flags & 0x04) cost(COST.NOTE_PITCH);
    cost(COST.CHAIN_CALL);
    clearChain(C);
    // the original looks at the track's chain once the channel has left it
    cost(T.chan ? COST.NOTE_JOINS : COST.NOTE_FIRST);
    if (T.chan) cost(T.chan.type & 7 ? COST.JOINS_CGB : COST.JOINS_DS);
    cost(cgb ? COST.NOTE_CGB : COST.NOTE_DS);
    C.prev = null; C.next = T.chan;
    if (T.chan) T.chan.prev = C;
    T.chan = C; C.track = T; C.music = P === players[0];
    T.lfoDelayCounter = T.lfoDelay;
    if (T.lfoDelay) { cost(COST.NOTE_LFO_DELAY); clearModM(T); }
    trkVolPitSet(T);
    C.gateTime = T.gateTime; C.midiKey = T.key; C.velocity = T.velocity;
    C.priority = prio; C.key = key; C.rhythmPan = rhythmPan;
    C.type = V.type; C.wav = V.wav;
    C.attack = V.attack; C.decay = V.decay; C.sustain = V.sustain; C.release = V.release;
    C.echoVol = T.echoVolume; C.echoLen = T.echoLength;
    chnVolSet(C, T);
    const k = Math.max(0, C.key + T.keyShiftCalc);
    if (cgb) {
      C.length = V.length;
      const ps = V.panSweep;
      cost(ps & 0x80 ? COST.SWEEP_OFF : ps & 0x70 ? COST.SWEEP : COST.SWEEP_NONE);
      C.sweep = (ps & 0x80) || !(ps & 0x70) ? 0x08 : ps;
      cost(COST.CALL);
      C.freq = midiKeyToCgbFreq(cgb, k, T.pitchCalc);
    } else {
      C.freq = midiKeyToFreq(C.wav, k, T.pitchCalc);
    }
    C.status = START;
    T.flags &= 0xF0;
  }

  let locked = false;   // m4aSoundVSyncOff's lock: SoundMain does nothing until m4aSoundVSyncOn
  const mulWait = rs => {
    rs >>>= 0;
    if (!(rs & 0xFFFFFF00) || (rs & 0xFFFFFF00) >>> 0 === 0xFFFFFF00) return 1;
    if (!(rs & 0xFFFF0000) || (rs & 0xFFFF0000) >>> 0 === 0xFFFF0000) return 2;
    if (!(rs & 0xFF000000) || (rs & 0xFF000000) >>> 0 === 0xFF000000) return 3;
    return 4;
  };

  // ---- the sequencer ----

  function tickTrack(P, T) {
    cost(COST.TRACK);
    if (T.chan) cost(COST.TRACK_CHANNELS);
    if (T.flags & TRACK_START) cost(COST.TRACK_STARTS);
    for (let C = T.chan; C; C = C.next) {
      if (C.status & ON) {
        if (C.gateTime) {
          if (--C.gateTime === 0) { C.status |= STOP; cost(COST.GATE_ENDS); } else cost(COST.GATE);
        } else cost(COST.NO_GATE);
      } else { cost(COST.CHAIN_CALL); clearChain(C); cost(COST.CHANNEL_GONE); }
      if (C.next) cost(COST.CHANNEL_NEXT);
    }
    if (T.flags & TRACK_START) clearTrack(T);
    while (T.wait === 0) {
      const b = r8(T.cmdPtr);
      let cmd = b;
      cost(COST.BYTE);
      if (b < 0x80) { cmd = T.runningStatus; cost(COST.RUNNING_STATUS); }
      else { T.cmdPtr++; cost(COST.COMMAND_BYTE); if (b >= 0xBD) { cost(COST.STATUS_KEPT); T.runningStatus = b; } else cost(COST.STATUS_NOT_KEPT); }
      if (cmd >= 0xCF) { cost(COST.NOTE); cost(COST.CALL); plynote(cmd - 0xCF, P, T); }
      else if (cmd >= 0xB1) {
        P.cmd = cmd - 0xB1;
        cost(COST.COMMAND); cost(COST.CMD_B1 + cmd - 0xB1); cost(COST.CALL); cost(COST.DISPATCH);
        COMMANDS[cmd - 0xB1](P, T);
        if (T.flags === 0) return;
        cost(COST.DISPATCH_GOES_ON);
      } else { cost(COST.WAIT); T.wait = CLOCK[cmd - 0x80]; }
      cost(COST.NEXT_BYTE);
    }
    T.wait--;
    cost(COST.WAITS);
    // the vibrato/tremolo LFO: a triangle, stepped on ticks only
    if (!T.lfoSpeed) cost(COST.NO_LFO);
    else if (!T.modDepth) cost(COST.NO_DEPTH);
    if (T.lfoSpeed && T.modDepth) {
      cost(COST.LFO);
      if (T.lfoDelayCounter) { T.lfoDelayCounter--; cost(COST.LFO_DELAY); return; }
      cost(COST.LFO_STEP);
      const sum = T.lfoSpeedCounter + T.lfoSpeed;
      T.lfoSpeedCounter = u8(sum);
      // the falling half uses the sum before it wraps, as the original does
      const falling = u8(sum - 64) & 0x80, v = falling ? s8(sum) : 128 - sum;
      cost(falling ? COST.LFO_FALLING : COST.LFO_RISING);
      // the multiply's wait, by the triangle's value, signed
      cost(COST.LFO_MUL1 + mulWait(v) - 1);
      const m = (T.modDepth * v) >> 6;
      if (u8(m) !== u8(T.modCalc)) {
        cost(T.modType === 0 ? COST.LFO_PITCH : COST.LFO_VOLUME);
        T.modCalc = s8(m);
        T.flags |= T.modType === 0 ? PITCHG : VOLCHG;
      }
    }
  }

  function fadeOutBody(P) {
    if (!P.fadeInterval) { cost(COST.FADE_NONE); return; }
    if (--P.fadeCounter !== 0) { cost(COST.FADE_WAIT); return; }
    P.fadeCounter = P.fadeInterval;
    if (P.fadeOV & 2) {
      cost(COST.FADE_IN);
      P.fadeOV += 16;
      if (P.fadeOV >= 256) { cost(COST.FADE_IN_DONE); P.fadeOV = 256; P.fadeInterval = 0; } else cost(COST.FADE_IN_GOES_ON);
    } else {
      cost(COST.FADE_OUT);
      P.fadeOV -= 16;
      if (P.fadeOV <= 0) {
        cost(COST.FADE_OUT_DONE);
        for (const T of P.tracks) {
          cost(COST.FADE_STOP_TRACK);
          trackStop(T);
          if (!(P.fadeOV & 1)) { cost(COST.FADE_CLEAR_TRACK); T.flags = 0; }
        }
        cost(P.fadeOV & 1 ? COST.FADE_PAUSE_KEEPS : COST.FADE_PAUSE);
        P.status = P.fadeOV & 1 ? (P.status | PAUSE) >>> 0 : PAUSE;
        P.fadeInterval = 0;
        return;
      }
    }
    P.tracks.forEach((T, i) => {
      cost(COST.FADE_TRACK);
      if (i < P.tracks.length - 1) cost(COST.FADE_TRACK_NEXT);
      if (T.flags & EXIST) { cost(COST.FADE_TRACK_VOLUME); T.volPublic = P.fadeOV >> 2; T.flags |= VOLCHG; }
    });
  }

  function playerMain(P) {
    if (P.status & PAUSE) { cost(COST.PLAYER_PAUSED); return; }
    cost(COST.PLAYER);
    fadeOutBody(P);
    if (P.status & PAUSE) { cost(COST.STOPPED_BY_FADE); return; }
    cost(COST.RUNS);
    let t = P.tempoC + P.tempoI;
    for (;;) {
      P.tempoC = t & 0xFFFF;
      cost(COST.TEMPO);
      if (t < 150) break;
      cost(COST.TICK);
      let mask = 0;
      P.tracks.forEach((T, i) => {
        if (T.flags & EXIST) { mask |= 1 << i; tickTrack(P, T); cost(COST.TRACK_TICKED); } else cost(COST.TRACK_ABSENT);
        cost(i < P.tracks.length - 1 ? COST.TRACK_NEXT : COST.TRACK_LAST);
      });
      cost(COST.TICK_DONE);
      P.clock = (P.clock + 1) >>> 0;
      if (!mask) { cost(COST.TICK_ENDS_ALL); P.status = PAUSE; return; }
      cost(COST.TICK_GOES_ON);
      P.status = mask;
      t = P.tempoC - 150;
    }
    cost(COST.VP_TRACKS);
    P.tracks.forEach((T, i) => {
      cost(i < P.tracks.length - 1 ? COST.VP_TRACK_NEXT : COST.VP_TRACK_LAST);
      if (!(T.flags & EXIST)) { cost(COST.VP_ABSENT); return; }
      if (!(T.flags & 0x0F)) { cost(COST.VP_UNCHANGED); return; }
      cost(COST.VP_CHANGED);
      cost(T.chan ? COST.VP_CHANNELS : COST.VP_NO_CHANNELS);
      trkVolPitSet(T);
      for (let C = T.chan; C; C = C.next) {
        cost(C.next ? COST.VP_CHANNEL_HAS_NEXT : COST.VP_CHANNEL_LAST);
        if (!(C.status & ON)) { cost(COST.CHAIN_CALL); clearChain(C); cost(COST.VP_CHANNEL_GONE); continue; }
        const cgb = C.type & 7;
        cost(COST.VP_CHANNEL);
        if (T.flags & VOLCHG) {
          chnVolSet(C, T);
          cost(COST.VP_VOLUME);
          if (cgb) { cost(COST.VP_VOLUME_CGB); C.cgbStatus |= MO_VOL; }
        } else cost(COST.VP_NO_VOLUME);
        if (T.flags & PITCHG) {
          const key = Math.max(0, C.key + T.keyShiftCalc);
          cost(COST.VP_PITCH);   // in Sonic Battle with 0x08048f0c's two calls of umul3232H32, in ARM from the cartridge
          if (cgb) { cost(COST.CALL); C.freq = midiKeyToCgbFreq(cgb, key, T.pitchCalc); C.cgbStatus |= MO_PIT; }
          else C.freq = midiKeyToFreq(C.wav, key, T.pitchCalc);
        }
      }
      T.flags &= 0xF0;
    });
  }

  // ---- PSG channels ----

  // in this version of the library, a channel that is mostly on one side plays on that side only
  function cgbModVol(C) {
    const r = C.rightVol, l = C.leftVol;
    let pan, goal;
    if (r >= l && r >> 1 >= l) { cost(COST.CGB_PAN_RIGHT); pan = 0x0F; goal = Math.min(15, (r + l) >> 4); }
    else if (l > r && l >> 1 >= r) { cost(COST.CGB_PAN_LEFT); pan = 0xF0; goal = Math.min(15, (r + l) >> 4); }
    else { cost(COST.CGB_PAN_BOTH); pan = 0xFF; goal = (r + l) >> 4; }
    C.envelopeGoal = goal;
    C.sustainGoal = (goal * C.sustain + 15) >> 4;
    C.pan = pan & C.panMask;
  }

  // the software envelope follows the hardware one, writing the registers and retriggering at each phase change
  function cgbSound() {
    cost(COST.CGB);
    if (info.c15) cost(COST.CGB_COUNTING);
    if (muted.music) io.muted = cgbChans.reduce((m, C, i) => m | (C.music ? 1 << i : 0), 0);
    info.c15 = info.c15 ? info.c15 - 1 : 14;
    for (let ch = 1; ch <= 4; ch++) {
      const C = cgbChans[ch - 1];
      if (!(C.status & ON)) { cost(COST.CGB_SILENT); continue; }
      const [nr0, nr1, nr2, nr3, nr4] = CGB_REGS[ch - 1];
      let c15 = info.c15, dir = io.read(nr2), at, stored = false;   // stored: the step's counter came in already set
      cost(COST.CGB_ON1 + ch - 1);
      if (C.status & START) {
        if (C.status & STOP) { cost(COST.CGB_START_STOPPED); at = 'off'; }
        else {
          C.status = 3; C.cgbStatus = MO_PIT | MO_VOL;
          cost(ch === 3 ? COST.CGB_START_WAVE : COST.CGB_START);
          cgbModVol(C);
          if (ch === 3) {
            if (C.wav !== C.current) {
              cost(COST.CGB_WAVE_NEW);
              waveAt();
              ioWrite(NR30, 0x40);
              for (let i = 0; i < 16; i++) ioWrite(WAVE_RAM + i, r8(C.wav + i));
              C.current = C.wav;
            } else cost(COST.CGB_WAVE_SAME);
            waveAt(); ioWrite(NR30, 0); ioWrite(nr1, C.length);
            cost(C.length ? COST.CGB_LENGTH_WAVE : COST.CGB_NO_LENGTH_WAVE);
            C.nrx4 = C.length ? 0xC0 : 0x80;
          } else {
            cost(ch === 1 ? COST.CGB_START1 : ch === 2 ? COST.CGB_START2 : COST.CGB_START4);
            if (ch === 1) ioWrite(nr0, C.sweep);
            if (ch === 4) { ioWrite(nr1, C.length); ioWrite(nr3, u8(C.wav << 3)); }
            else ioWrite(nr1, u8((C.wav << 6) + C.length));
            dir = C.attack + 8;
            cost(C.length ? COST.CGB_LENGTH : COST.CGB_NO_LENGTH);
            C.nrx4 = C.length ? 0x40 : 0x00;
          }
          C.envelopeCtr = C.attack;
          if (s8(C.attack)) { cost(COST.CGB_ATTACK); C.envelopeVol = 0; at = 'stepDone'; }
          else { cost(COST.CGB_NO_ATTACK); at = 'decayStart'; }
        }
      } else if ((C.status & IEC) || (layout.voicesEndOnChip && !(io.read(SOUNDCNT_X) >> (ch - 1) & 1))) {
        // an echo counting down, or, in a game whose library checks, a voice the chip's length counter has ended
        cost(COST.CGB_ECHO);
        C.echoLen = u8(C.echoLen - 1);
        at = s8(C.echoLen) <= 0 ? 'off' : 'done';
        cost(at === 'off' ? COST.CGB_ECHO_ENDS : COST.CGB_ECHO_GOES_ON);
      } else if ((C.status & STOP) && (C.status & ENV)) {
        cost(COST.CGB_RELEASE);
        C.status &= ~ENV; C.envelopeCtr = C.release;
        if (s8(C.release)) {
          cost(COST.CGB_RELEASE_STEPS);
          C.cgbStatus |= MO_VOL;
          if (ch !== 3) dir = C.release; else cost(COST.CGB_RELEASE_WAVE);
          at = 'stepDone';
        } else { cost(COST.CGB_RELEASE_NONE); at = 'echo'; }
      } else { cost(C.status & STOP ? COST.CGB_STOPPED_NO_ENVELOPE : COST.CGB_PLAYING); at = 'step'; }

      // the envelope steps; every 15th frame it steps twice to keep up with the hardware's 64 Hz
      while (at !== 'done' && at !== 'off') {
        switch (at) {
          case 'step':
            at = 'stepDone'; stored = false;
            if (C.envelopeCtr !== 0) { cost(COST.ENV_WAIT); break; }
            cost(COST.ENV_STEP);
            if (ch === 3) { cost(COST.ENV_STEP_WAVE); C.cgbStatus |= MO_VOL; }
            cgbModVol(C);
            switch (C.status & ENV) {
              case 0:
                cost(COST.ENV_RELEASE);
                C.envelopeVol = u8(C.envelopeVol - 1);
                if (s8(C.envelopeVol) <= 0) { cost(COST.ENV_RELEASE_ENDS); at = 'echo'; }
                else { cost(COST.ENV_RELEASE_ON); C.envelopeCtr = C.release; stored = true; }
                break;
              case 1: cost(COST.ENV_SUSTAIN); cost(COST.ENV_SUSTAIN_STEP); at = 'sustain'; break;
              case 2:
                cost(COST.ENV_DECAY); cost(COST.ENV_DECAY_STEP);
                C.envelopeVol = u8(C.envelopeVol - 1);
                if (s8(C.envelopeVol) <= s8(C.sustainGoal)) { cost(COST.ENV_DECAY_ENDS); at = 'sustainStart'; }
                else { cost(COST.ENV_DECAY_ON); C.envelopeCtr = C.decay; stored = true; }
                break;
              default:
                cost(COST.ENV_ATTACK); cost(COST.ENV_ATTACK_STEP);
                C.envelopeVol = u8(C.envelopeVol + 1);
                if (C.envelopeVol >= C.envelopeGoal) { cost(COST.ENV_ATTACK_ENDS); at = 'decayStart'; }
                else { cost(COST.ENV_ATTACK_ON); C.envelopeCtr = C.attack; stored = true; }
            }
            break;
          case 'decayStart':
            cost(COST.ENV_DECAY_START);
            C.status--; C.envelopeCtr = C.decay;
            if (C.decay) {
              cost(COST.ENV_DECAY_STARTS);
              C.cgbStatus |= MO_VOL; C.envelopeVol = C.envelopeGoal;
              if (ch !== 3) dir = C.decay; else cost(COST.ENV_DECAY_WAVE);
              at = 'stepDone'; stored = false;
            } else { cost(COST.ENV_DECAY_NONE); at = 'sustainStart'; }
            break;
          case 'sustainStart':
            cost(COST.ENV_SUSTAIN_START);
            if (C.sustain === 0) { cost(COST.ENV_SUSTAIN_NONE); C.status &= ~ENV; at = 'echo'; break; }
            cost(COST.ENV_SUSTAIN_STARTS);
            C.status--; C.cgbStatus |= MO_VOL;
            if (ch !== 3) dir = 0x08; else cost(COST.ENV_SUSTAIN_WAVE);
            at = 'sustain';
            break;
          case 'sustain':
            cost(COST.ENV_SUSTAIN_SET); cost(COST.ENV_SUSTAIN_SET_DONE);
            C.envelopeVol = C.sustainGoal; C.envelopeCtr = 7;
            at = 'stepDone'; stored = true;
            break;
          case 'echo':
            cost(COST.ENV_ECHO);
            C.envelopeVol = (C.envelopeGoal * C.echoVol + 0xFF) >> 8;
            if (!C.envelopeVol) { cost(COST.ENV_ECHO_OFF); at = 'off'; break; }
            cost(COST.ENV_ECHO_ON);
            C.status |= IEC; C.cgbStatus |= MO_VOL;
            if (ch !== 3) dir = 0x08; else cost(COST.ENV_ECHO_WAVE);
            at = 'done';
            break;
          case 'stepDone':
            cost(COST.ENV_STEP_DONE);
            cost(stored ? COST.ENV_COUNTER_SET : COST.ENV_COUNTER_KEPT);
            C.envelopeCtr = u8(C.envelopeCtr - 1);
            if (c15 === 0) { cost(COST.ENV_AGAIN); c15 = -1; at = 'step'; } else { cost(COST.ENV_DONE); at = 'done'; }
            break;
        }
      }
      if (at === 'off') {
        cost(COST.CGB_OFF); cost(COST.CGB_OFF1 + ch - 1);
        cgbOscOff(ch); C.status = 0; C.cgbStatus = 0;
        continue;
      }

      if (C.cgbStatus & MO_PIT) {
        cost(ch === 3 ? COST.CGB_PITCH_WAVE : COST.CGB_PITCH);
        cost(COST.CGB_PITCH1 + ch - 1);
        // "fixed" voices round the frequency to what the PWM rate can play
        if (ch < 4 && (C.type & 0x08)) {
          cost(COST.CGB_FIXED);
          const bias = io.read(SOUNDBIAS_H);
          if (bias < 0x40) { cost(COST.CGB_FIXED_FINE); C.freq = (C.freq + 2) & 0x7FC; }
          else if (bias < 0x80) { cost(COST.CGB_FIXED_HALF); C.freq = (C.freq + 1) & 0x7FE; }
          else cost(COST.CGB_FIXED_NONE);
        }
        if (ch === 3) waveAt();
        ioWrite(nr3, ch === 4 ? (io.read(nr3) & 0x08) | C.freq : u8(C.freq));
        C.nrx4 = u8((C.nrx4 & 0xC0) + (C.freq >> 8));
        // the high byte goes out an instruction block after the low one
        cost(ch === 4 ? COST.CGB_PITCH_HIGH4 : COST.CGB_PITCH_HIGH);
        ioWrite(nr4, C.nrx4);
        cost(COST.CGB_PITCH_DONE1 + ch - 1);
      } else cost(COST.CGB_NO_PITCH);
      if (C.cgbStatus & MO_VOL) {
        cost(COST.CGB_VOLUME1 + ch - 1);
        if (ch === 3) cost(COST.CGB_VOLUME_WAVE);
        ioWrite(NR51, (io.read(NR51) & ~C.panMask) | C.pan);
        if (ch === 3) {
          waveAt();
          ioWrite(NR32, CGB3_VOL[C.envelopeVol]);
          cost(COST.CGB_WAVE_VOLUME);
          if (C.nrx4 & 0x80) { cost(COST.CGB_WAVE_RESTART); ioWrite(NR30, 0x80); ioWrite(NR34, C.nrx4); C.nrx4 &= 0x7F; }
        } else {
          ioWrite(nr2, u8((dir & 0x0F) + (C.envelopeVol << 4)));
          ioWrite(nr4, C.nrx4 | 0x80);
          if (ch === 1) {
            cost(COST.CGB_SWEEP_CHECK);
            if (!(io.read(NR10) & 0x08)) { cost(COST.CGB_SWEEP_RESTART); ioWrite(nr4, C.nrx4 | 0x80); }
          }
        }
      } else cost(COST.CGB_NO_VOLUME);
      cost(COST.CGB_DONE1 + ch - 1);
      C.cgbStatus = 0;
    }
  }

  // ---- DirectSound mixer ----

  // The mixer's cycles are counted as Sonic Battle's, in every version: only a game that reads them, as it does, needs them.

  // one channel's envelope for this frame; false when the channel stops before it is mixed
  function envelope(C) {
    let st = C.status, env;
    const wav = C.wav - ROM_BASE;
    if (st & START) {
      if (st & STOP) { C.status = 0; cycles += 20; return false; }
      st = 3; C.current = C.wav + 16; C.count = u32(wav + 12); env = 0; C.fw = 0;
      cycles += 47;
      if (rom[wav + 3] & 0xC0) { st |= LOOP; cycles += 5; }
      C.status = st;
      env += C.attack;
      if (env >= 255) { env = 255; C.status = --st; cycles += 2; }
    } else {
      env = C.envVol;
      let echo = false;
      if (st & IEC) {
        const old = C.echoLen;
        C.echoLen = u8(old - 1);
        if (old <= 1) { C.status = 0; cycles += 24; return false; }
        cycles += 20;
      } else if (st & STOP) {
        env = (env * C.release) >> 8;
        cycles += 29;
        if (env <= C.echoVol) echo = true;
      } else if ((st & ENV) === 2) {
        env = (env * C.decay) >> 8;
        cycles += 35;
        if (env <= C.sustain) {
          env = C.sustain;
          cycles += 6;
          if (env === 0) { echo = true; cycles -= 2; } else C.status = --st;
        }
      } else if ((st & ENV) === 3) {
        env += C.attack;
        cycles += 34;
        if (env >= 255) { env = 255; C.status = --st; cycles += 2; }
      } else cycles += 28;
      if (echo) {
        env = C.echoVol;
        // the path from 0x0804851E's test down to 0x080484D2 or to the echo's flag
        if (env === 0) { C.status = 0; cycles += 11; return false; }
        C.status = st | IEC;
        cycles += 10;
      }
    }
    C.envVol = env;
    const v = (env * (MASTER_VOL + 1)) >> 4;
    C.envR = (C.rightVol * v) >> 8;
    C.envL = (C.leftVol * v) >> 8;
    return true;
  }

  function mixChannel(C, base) {
    const pcm = info.pcm, wav = C.wav - ROM_BASE, data = wav + 16;
    const size = u32(wav + 12), loopStart = u32(wav + 8);
    const loopLen = C.status & LOOP ? size - loopStart : 0;
    // 0x048528 to the sample loop, with the volumes worked out
    cycles += 65 + (loopLen ? 22 : 0);
    // with the music muted, its notes still play out, unheard
    const quiet = muted.music && C.music, vr = quiet ? 0 : C.envR, vl = quiet ? 0 : C.envL;
    let cur = C.current - C.wav - 16, count = C.count;
    if (C.type & 0x08) {
      // fixed rate: one sample in per sample out
      cycles += 18 + 18 * SAMPLES + 12 * (SAMPLES >> 2);
      for (let i = 0; i < SAMPLES; i++) {
        const s = s8(rom[data + cur++]);
        pcm[base + i] += (s * vr) >> 8;
        pcm[HALF + base + i] += (s * vl) >> 8;
        if (--count === 0) {
          if (!loopLen) { C.status = 0; return; }
          cur = loopStart; count = loopLen;
        }
      }
      C.count = count; C.current = C.wav + 16 + cur;
      return;
    }
    // resampled with linear interpolation; the step is a 23-bit fraction, and the sample after the last one is
    // read from the byte that follows the data
    const step = Math.imul(DIV_FREQ, C.freq) >>> 0;
    cycles += 39 + mulWait(C.freq) + 20 * SAMPLES + 12 * (SAMPLES >> 2);
    let fw = C.fw, s0 = s8(rom[data + cur]), d = s8(rom[data + cur + 1]) - s0;
    for (let i = 0; i < SAMPLES; i++) {
      const s = s0 + (Math.imul(fw, d) >> 23);
      pcm[base + i] += (s * vr) >> 8;
      pcm[HALF + base + i] += (s * vl) >> 8;
      fw = (fw + step) >>> 0;
      const n = fw >>> 23;
      if (n === 0) continue;
      cycles += n === 1 ? 11 : 16;   // with a read or two of the sample from the cartridge
      fw = (fw & ~0x3F800000) >>> 0;
      count -= n;
      if (count <= 0) {
        if (!loopLen) {
          // the samples not reached aren't mixed: 0x08048640 ends the channel from here
          cycles -= 20 * (SAMPLES - 1 - i) + 12 * ((SAMPLES >> 2) - (i >> 2)) + (n === 1 ? 11 : 16) - 57;
          C.status = 0;
          return;
        }
        let over = -count;
        count += loopLen;
        cycles += n === 1 ? 18 : 13;
        while (count <= 0) { over -= loopLen; count += loopLen; cycles += 6; }
        cur = loopStart + over;
      } else cur += n;
      s0 = s8(rom[data + cur]); d = s8(rom[data + cur + 1]) - s0;
    }
    C.fw = fw; C.count = count; C.current = C.wav + 16 + cur;
  }

  function mix() {
    const dc = info.dmaCounter, pcm = info.pcm;
    const seg = dc <= 1 ? 0 : FRAMES_PER_DMA - (dc - 1), base = seg * SAMPLES;
    if (info.reverb) {
      // mono feedback from what played 9 and 8 frames ago
      const nxt = dc === 2 ? 0 : base + SAMPLES;
      for (let i = 0; i < SAMPLES; i++) {
        const a = pcm[base + i] + pcm[HALF + base + i] + pcm[nxt + i] + pcm[HALF + nxt + i];
        let v = (a * info.reverb) >> 9;
        if (v & 0x80) v++;
        pcm[base + i] = pcm[HALF + base + i] = v;
      }
    } else {
      pcm.fill(0, base, base + SAMPLES);
      pcm.fill(0, HALF + base, HALF + base + SAMPLES);
    }
    for (const C of chans) {
      cycles += C.status & ON ? 29 : 30;
      if ((C.status & ON) && envelope(C)) mixChannel(C, base);
    }
    info.frameCycles = cycles;
    return base;
  }

  // ---- song control (m4a.c) ----

  function song(n) {
    const at = layout.songTable + n * 8;
    return { header: u32(at), player: players[rom[at + 4]] };
  }

  function mplayStart(P, header) {
    const h = header - ROM_BASE, trackCount = rom[h];
    // MPlayStart: on a guarded player, a song still playing, or about to start, keeps it from one of lower priority
    if (P.guarded && P.priority > rom[h + 2]) {
      const starting = P.songHeader !== 0 && P.tracks[0] && (P.tracks[0].flags & TRACK_START);
      if (starting || ((P.status & 0xFFFF) !== 0 && !(P.status & PAUSE))) return;
    }
    P.status = 0; P.songHeader = header; P.voicegroup = u32(h + 4); P.priority = rom[h + 2]; P.clock = 0;
    P.tempoD = 150; P.tempoI = 150; P.tempoU = 0x100; P.tempoC = 0; P.fadeInterval = 0;
    P.tracks.forEach((T, i) => {
      trackStop(T);
      if (i < trackCount) { T.flags = EXIST | TRACK_START; T.chan = null; T.cmdPtr = u32(h + 8 + i * 4); }
      else T.flags = 0;
    });
    const reverb = rom[h + 3];
    if (reverb & 0x80) info.reverb = reverb & 0x7F;
  }

  function mplayStop(P) {
    P.status = (P.status | PAUSE) >>> 0;
    for (const T of P.tracks) trackStop(T);
  }

  const eachTrack = (P, bits, f) => P.tracks.forEach((T, i) => { if ((bits & (1 << i)) && (T.flags & EXIST)) f(T); });

  return {
    info, chans, cgbChans, players, muted,
    /** whether m4aSoundVSyncOff holds the mixing */
    get locked() { return locked; },
    /** the samples mixed per side each frame */
    samples: SAMPLES,

    /** How many of the console's cycles the last frame's SoundMain took, which a game's frame can run late by. */
    get frameCycles() { return info.frameCycles; },

    /** One GBA frame: the V-blank's DMA bookkeeping, then SoundMain. Returns the offset of the samples just
     *  mixed into info.pcm (right side; the left side is HALF bytes later). */
    frame() {
      if (locked) return 0;
      const dc = u8(info.dmaCounter - 1);
      info.dmaCounter = s8(dc) > 0 ? dc : FRAMES_PER_DMA;
      // SoundMain's way in, to the first player, and its way from the PSG to the channels and out, and 0x08049744's
      // restarting the DMA in the V-blank before it, on the frames it takes
      cycles = 0;
      cost(COST.FRAME);
      if (s8(dc) <= 0) cost(COST.FRAME_DMA);
      inFrame = true;
      for (const P of players) {
        const before = cycles;
        playerMain(P);
        if (P === earlyPlayer) { earlyCost = cycles - before - IDLE_PLAYER; io.waveLater?.(earlyCost); earlyPlayer = null; }
      }
      cgbSound();
      inFrame = false;
      hblank = late = 0;
      callAt = FRAME_CYCLES; earlyCost = 0;
      return mix();
    },

    /** m4aSoundVSyncOff: what is mixed is cleared and nothing is mixed until vsyncOn. */
    vsyncOff() { if (!locked) { locked = true; info.pcm.fill(0); } },
    /** m4aSoundVSyncOn: mixing starts again from the first part of the buffer. */
    vsyncOn() { if (locked) { locked = false; } },

    songStart(n) { const s = song(n); mplayStart(s.player, s.header); },
    /** song n's header address, to compare with a player's songHeader */
    songHeader(n) { return song(n).header; },
    /** the number of the music player song n plays on */
    songPlayer(n) { return players.indexOf(song(n).player); },
    /** MPlayStart with song n's header on player p instead of the song's own */
    playerStart(p, n) { mplayStart(players[p], song(n).header); },
    songStop(n) { const s = song(n); if (s.player.songHeader === s.header) mplayStop(s.player); },
    /** MPlayStop on player p, whatever it plays */
    playerStop(p) { mplayStop(players[p]); },
    /** m4aSongNumStartOrContinue: restarts a different song or an ended one, and lets a stopped one go on */
    songStartOrContinue(n) {
      const s = song(n), P = s.player;
      if (P.songHeader !== s.header || (P.status & 0xFFFF) === 0) mplayStart(P, s.header);
      else if (P.status & PAUSE) P.status = (P.status & ~PAUSE) >>> 0;
    },
    /** m4aSongNumStartOrChange: restarts only a different song, or the same one once it has ended */
    songStartOrChange(n) {
      const s = song(n), P = s.player;
      if (P.songHeader !== s.header || (P.status & 0xFFFF) === 0 || (P.status & PAUSE)) mplayStart(P, s.header);
    },
    /** With `soundMainAt`, the cycle the game's next calls come at, counted from the start of the chip's frame */
    waveAt(at) { callAt = at; },
    /** The place in the frame SoundMain starts at, from which its writes to the squares land as its work reaches them */
    psgAt(at) { psgAt = at; },
    /** The sound chip keeps its time from power-on, `powerOnBefore` cycles before its first frame (apu.js exactFrom) */
    chipClock(powerOnBefore) { io.exactFrom(powerOnBefore); },
    /** Where the FIFO's refill DMA lands in the frame and what it takes, and where the H-blank DMA's first line does */
    dmaAt(at, cost, hblankLine) { fifoAt = at; fifoCost = cost; hblankAt = hblankLine; },
    /** The next frame's H-blank DMA, in cycles a line, while the game has it on */
    hblankDma(perLine) { hblank = perLine; },
    /** How late the next frame's SoundMain starts, as the game's own work runs past its place */
    late(by) { late = by; },
    /** Song n, started next, comes before SoundMain in the original's frame, which is too late here: this frame's SoundMain
     *  takes what the song's first frame costs off its wave writes, and the last frame's, which it belongs to, adds it. */
    beforeSoundMain(n) { earlyPlayer = song(n).player; },
    allStop() { for (const P of players) mplayStop(P); },
    /** m4aMPlayAllContinue: every player that MPlayStop stopped goes on from where it was */
    allContinue() { for (const P of players) P.status = (P.status & ~PAUSE) >>> 0; },
    /** m4aMPlayContinue: player p goes on from where MPlayStop stopped it */
    playerContinue(p) { const P = players[p]; P.status = (P.status & ~PAUSE) >>> 0; },
    immInit(p) {
      for (const T of players[p].tracks) if ((T.flags & EXIST) && (T.flags & TRACK_START)) clearTrack(T);
    },
    pitchControl(p, bits, pitch) {
      eachTrack(players[p], bits, T => { T.keyShiftPublic = s8(pitch >> 8); T.pitchPublic = u8(pitch); T.flags |= PITCHG; });
    },
    volumeControl(p, bits, volume) {
      eachTrack(players[p], bits, T => { T.volPublic = u8(volume >> 2); T.flags |= VOLCHG; });
    },
    panpotControl(p, bits, pan) {
      eachTrack(players[p], bits, T => { T.panPublic = s8(pan); T.flags |= VOLCHG; });
    },
    fadeIn(p, speed) {
      const P = players[p];
      P.fadeCounter = P.fadeInterval = speed; P.fadeOV = 2;
      P.status = (P.status & ~PAUSE) >>> 0;
    },
    fadeOut(p, speed) { const P = players[p]; P.fadeCounter = P.fadeInterval = speed; P.fadeOV = 256; },
    tempoControl(p, tempo) { const P = players[p]; P.tempoU = tempo; P.tempoI = (P.tempoD * tempo) >> 8; },
  };
}
