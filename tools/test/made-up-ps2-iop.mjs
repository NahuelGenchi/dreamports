// Small PlayStation 2 programs that start the console's second processor, the IOP, with nothing from any game in them,
// written here, for the console's real emulator to run in the tools' checks of the kit's IOP side (ps2-sound.mjs).
//
// madeUpPs2Sound is a program for the EE, as made-up-ps2.mjs's are, that carries a module of its own for the IOP. As it
// starts, it does what a game's own SIF library does through the console's system calls: it tells the IOP where its
// replies go, copies the module into the IOP's memory, binds to the IOP's loader (RPC server 0x80000006) and calls it
// to load and start the module from there, waiting for each reply in its memory. Then it draws the flat program's
// picture each V-blank.
//
// The module plays sound on the SPU2, as a game's sound driver does. As it starts, it puts a looping tone in the sound
// chip's memory a halfword at a time through core 0's data port, and a short click through core 1 by DMA, and sets up
// both cores, the voices and the reverb. Its thread then waits for each V-blank, and only then does what depends on
// when it's done: on its first frame it turns the reverb on and keys the voices on, and on each one after it moves the
// first voice's pitch, lets go of the tone and keys it on again, keys the click on, turns the second voice's volume into
// a sweep, and writes back what it reads of the chip (the voices that reached their end, and whether the interrupt
// address was played), so what the chip says is in the sound list too.

import { LOAD_AT, lw as eeLw, sw as eeSw, addiu as eeAddiu, li as eeLi, here, bne as eeBne, j as eeJ, SYSCALL, NOP, setUp, waitForVBlank, send, elfOf, PACKET } from './made-up-ps2.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// The sound

/** The SPU2's registers, as the IOP writes them: core 0 from 0x1F900000, core 1 0x400 on, and in the block from 0x760
 *  40 on. */
export const SPU2 = 0x1F900000, CORE1 = 0x400, CORE1_LOW = 40;
export const R = {
  VOLL: 0x0, VOLR: 0x2, PITCH: 0x4, ADSR1: 0x6, ADSR2: 0x8, PMON_HI: 0x180, NON_HI: 0x184,
  MVOLL: 0x760, MVOLR: 0x762, EVOLL: 0x764, EVOLR: 0x766,
  VMIXER_HI: 0x194, MMIX: 0x198, NOTE: 0x1B2, ATTR: 0x19A, IRQA_HI: 0x19C, IRQA_LO: 0x19E, KON_HI: 0x1A0, KOFF_HI: 0x1A4, TSA_HI: 0x1A8, TSA_LO: 0x1AA, STD: 0x1AC,
  SSA_HI: 0x1C0, SSA_LO: 0x1C2, ESA_HI: 0x2E0, ESA_LO: 0x2E2, REVERB: 0x2E4, EEA_HI: 0x33C, ENDX_HI: 0x340, ENDX_LO: 0x342,
  AVOLL: 0x768, AVOLR: 0x76A, COEF: 0x774, IRQINFO: 0x7C2,
};
/** A voice's own registers, 16 bytes each, and its addresses, 12 bytes each from SSA_HI. */
export const voice = (n, register) => n * 0x10 + register;
export const voiceAddress = (n, register) => register + n * 12;

/** The module's own RPC server's number, and the call the EE makes to it every frame. */
export const SERVER = 0x01234567, SERVER_CALL = 7;
/** Where the tone and the click go in the sound chip's memory, in bytes. */
export const TONE_AT = 0x5800, CLICK_AT = 0x6800;
/** A second copy of the tone, right after the first, for the voices that are keyed on once and loop: a voice keyed on
 *  again comes to a block with other samples behind it than one that looped there, and the second emulator the chip is
 *  checked against keeps one decoded copy of a block for every voice on it (kit/ps2/c/README.md). */
export const TONE_BYTES = 16 * 16, TONE_AGAIN_AT = TONE_AT + TONE_BYTES;
/** The reverb's work area: from here to the end of the chip's memory. */
export const REVERB_START = 0x1E0000;
/** The pitch the first voice starts at, how far it moves a frame and where it starts again. */
export const PITCH_START = 0x1000, PITCH_STEP = 0x10, PITCH_END = 0x1800;
/** Frames between the click's key-ons, and between the tone's: let go of at TONE_OFF in each TONE_EVERY, keyed on at 0. */
export const CLICK_EVERY = 45, TONE_EVERY = 60, TONE_OFF = 40;
/** The frame the second voice's left volume becomes an exponential sweep down. */
export const SWEEP_AT = 100;
/** The noise generator's rate, set with the reverb on the first frame, as it steps with every sample from then, and
 *  the frames core 0's right master volume becomes a sweep down and a plain volume again. */
export const NOISE_CLOCK = 0x1A, MASTER_SWEEP_AT = 120, MASTER_BACK_AT = 180, MASTER_SWEEP = 0xE020, MASTER_RIGHT = 0x3000;
/** Core 0's ATTR as it's set up, and on its first frame with the reverb and the interrupt on. */
export const ATTR_SET_UP = 0x8000, ATTR_PLAYING = 0x8000 | 0x80 | 0x40 | NOISE_CLOCK << 8;
/** The voices' registers as the module sets them, each [register, value]: core 0's 0 and 1 on the tone, 0 through the
 *  reverb, and core 1's 0 on the click. */
export const VOICES = [
  [voice(0, R.VOLL), 0x3000], [voice(0, R.PITCH), PITCH_START], [voice(0, R.ADSR1), 0x308A], [voice(0, R.ADSR2), 0xD030],
  [voiceAddress(0, R.SSA_HI), TONE_AT >>> 17], [voiceAddress(0, R.SSA_LO), TONE_AT >>> 1 & 0xFFFF],
  [voice(1, R.VOLL), 0x1800], [voice(1, R.VOLR), 0x2000], [voice(1, R.PITCH), 0x0C00], [voice(1, R.ADSR1), 0x0F8F], [voice(1, R.ADSR2), 0x1FC0],
  [voiceAddress(1, R.SSA_HI), TONE_AGAIN_AT >>> 17], [voiceAddress(1, R.SSA_LO), TONE_AGAIN_AT >>> 1 & 0xFFFF],
  [R.VMIXER_HI, 1],
  // core 0's 2 plays noise, and its 1 is bent by its 0
  [voice(2, R.VOLL), 0x0600], [voice(2, R.VOLR), 0x0500], [voice(2, R.PITCH), 0x1000], [voice(2, R.ADSR1), 0x208F], [voice(2, R.ADSR2), 0x1FC8],
  [voiceAddress(2, R.SSA_HI), TONE_AGAIN_AT >>> 17], [voiceAddress(2, R.SSA_LO), TONE_AGAIN_AT >>> 1 & 0xFFFF],
  [R.NON_HI, 4], [R.PMON_HI, 2],
  // the master volume of each core and core 0's effect volume
  [R.MVOLL, 0x3FFF], [R.MVOLR, MASTER_RIGHT], [CORE1_LOW + R.MVOLL, 0x3800], [CORE1_LOW + R.MVOLR, 0x3FFF], [R.EVOLL, 0x6000], [R.EVOLR, 0x5000],
  [CORE1 + voice(0, R.VOLL), 0x2000], [CORE1 + voice(0, R.VOLR), 0x1800], [CORE1 + voice(0, R.PITCH), 0x0800],
  [CORE1 + voice(0, R.ADSR1), 0x007F], [CORE1 + voice(0, R.ADSR2), 0x1FC0],
  [CORE1 + voiceAddress(0, R.SSA_HI), CLICK_AT >>> 17], [CORE1 + voiceAddress(0, R.SSA_LO), CLICK_AT >>> 1 & 0xFFFF],
  [CORE1_LOW + R.AVOLL, 0x5000], [CORE1_LOW + R.AVOLR, 0x6000],
  // each core's twelve mixing switches, as the console's sound library sets them: everything but core 0's external input
  [R.MMIX, 0xFF0], [CORE1 + R.MMIX, 0xFFC],
];
/** The first voice's right volume, a linear sweep up, and the second's left, an exponential sweep down, both set on
 *  the frame they start, as a sweep moves with every sample from when it's written. */
export const SWEEP_UP = 0x8050, SWEEP_DOWN = 0xE010;
/** The reverb's 22 addresses, in halfwords from its current place, and its 10 coefficients, as signed 16 bits. */
export const REVERB_ADDRESSES = [0x0340, 0x0270, 0x1000, 0x0F80, 0x0E00, 0x0D00, 0x0C00, 0x0B00, 0x0A80, 0x0A00, 0x0980, 0x0900,
  0x0880, 0x0800, 0x0780, 0x0700, 0x0680, 0x0600, 0x1800, 0x1780, 0x1700, 0x1680];
export const REVERB_COEFFICIENTS = [0x7000, 0x5000, 0xC000, 0x3800, 0xD000, 0x6000, 0x5800, 0x4000, 0x7000, 0x6800];
/** The reverb's registers as the module sets them up, each [register, value]: its work area, its addresses and its
 *  coefficients. */
export const REVERB = [
  [R.ESA_HI, REVERB_START >>> 17], [R.ESA_LO, REVERB_START >>> 1 & 0xFFFF], [R.EEA_HI, 0x0F],
  ...REVERB_ADDRESSES.flatMap((value, i) => [[R.REVERB + i * 4, value >>> 16], [R.REVERB + i * 4 + 2, value & 0xFFFF]]),
  ...REVERB_COEFFICIENTS.map((value, i) => [R.COEF + i * 2, value]),
];

// the samples: a tone, a sine of TONE_PERIOD samples that loops, and a click, noise that dies away, played once
const TONE_BLOCKS = 16, TONE_PERIOD = 56, CLICK_BLOCKS = 8;
const toneSample = i => Math.round(Math.sin(2 * Math.PI * i / TONE_PERIOD) * 12000);
function clickSamples() {
  let seed = 0x1234;
  return Array.from({ length: CLICK_BLOCKS * 28 }, (_, i) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return Math.round(((seed >>> 16) / 32768 - 1) * 16000 * Math.exp(-i / 60));
  });
}

// The sound chip's ADPCM: blocks of 16 bytes, a shift and a filter, flags, then 28 samples of 4 bits. Each block is
// encoded by trying every filter and shift with the decoder the console's emulator uses and keeping the closest.
const FILTERS = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
function encode(samples, flagsOf) {
  const blocks = [];
  let s1 = 0, s2 = 0;
  for (let block = 0; block * 28 < samples.length; block++) {
    const want = samples.slice(block * 28, block * 28 + 28);
    let best = null;
    for (let filter = 0; filter < 5; filter++) {
      for (let shift = 0; shift <= 12; shift++) {
        let a = s1, c = s2, error = 0;
        const nibbles = [];
        for (const sample of want) {
          const predicted = Math.trunc(a * FILTERS[filter][0] / 64) + Math.trunc(c * FILTERS[filter][1] / 64);
          const nibble = Math.max(-8, Math.min(7, Math.round((sample * 64 - predicted) / 64 / (4096 >> shift))));
          const value = ((nibble << 28) >> 16 >> shift) * 64 + predicted;
          c = a;
          a = value;
          error += (Math.max(-32768, Math.min(32767, Math.trunc((value + 32) / 64))) - sample) ** 2;
          nibbles.push(nibble & 15);
        }
        if (!best || error < best.error) best = { error, filter, shift, nibbles, s1: a, s2: c };
      }
    }
    blocks.push(best.shift | best.filter << 4, flagsOf(block));
    for (let i = 0; i < 28; i += 2) blocks.push(best.nibbles[i] | best.nibbles[i + 1] << 4);
    ({ s1, s2 } = best);
  }
  return blocks;
}
/** The tone's and the click's bytes, as they go in the sound chip's memory: the tone's first block marks where it loops
 *  back to and its last loops, and the click's last ends it. */
export const TONE = encode(Array.from({ length: TONE_BLOCKS * 28 }, (_, i) => toneSample(i)), b => b === 0 ? 0x04 : b === TONE_BLOCKS - 1 ? 0x03 : 0);
export const CLICK = encode(clickSamples(), b => b === CLICK_BLOCKS - 1 ? 0x01 : 0);
/** The interrupt address: a block of the tone, played each time round. */
export const IRQ_AT = TONE_AT + 3 * 16;

// ---------------------------------------------------------------------------------------------------------------------
// The module for the IOP, a MIPS R3000. Its code runs wherever the loader puts it: it finds its own place with BAL and
// reaches its data from there, so it needs no relocations. It calls the IOP's kernel through import tables, as every
// module does, which the emulator's stand-in for the kernel answers.

const ZERO = 0, V0 = 2, A0 = 4, A1 = 5, A2 = 6, A3 = 7, T0 = 8, T1 = 9, T2 = 10, T3 = 11, S0 = 16, S1 = 17, S2 = 18, S3 = 19, SP = 29, RA = 31;
const op = (code, rs, rt, value) => (code << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
const lui = (rt, value) => op(0x0F, 0, rt, value), ori = (rt, rs, value) => op(0x0D, rs, rt, value), addiu = (rt, rs, value) => op(0x09, rs, rt, value);
const slti = (rt, rs, value) => op(0x0A, rs, rt, value);
const lw = (rt, offset, base) => op(0x23, base, rt, offset), sw = (rt, offset, base) => op(0x2B, base, rt, offset);
const lhu = (rt, offset, base) => op(0x25, base, rt, offset), sh = (rt, offset, base) => op(0x29, base, rt, offset);
const lbu = (rt, offset, base) => op(0x24, base, rt, offset), sb = (rt, offset, base) => op(0x28, base, rt, offset);
const or = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x25) >>> 0;
const addu = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x21) >>> 0, sll = (rd, rt, shift) => (rt << 16 | rd << 11 | shift << 6) >>> 0;
const JR_RA = 0x03E00008;
const li = (rt, value) => (value >>> 16) ? [lui(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)] : [ori(rt, ZERO, value)];
// places by name, and what's filled in once every place is known: branches (BAL calls), a register set to a place in
// the module (from its start, which S0 holds), S0 set from where a BAL left RA, and a word of data
const at = name => ({ at: name });
const bal = name => ({ branch: 0x01, rs: 0, rt: 0x11, name });
const beq = (rs, rt, name) => ({ branch: 0x04, rs, rt, name }), bne = (rs, rt, name) => ({ branch: 0x05, rs, rt, name });
const placeOf = (rt, name) => ({ place: name, rt }), startFrom = name => ({ start: name });
const word = value => ({ word: value }), align = bytes => ({ align: bytes });
// an SPU2 register written with a value, or from one of the processor's registers, S3 holding the chip's address
const spu = (register, value) => [...li(T0, value), sh(T0, register, S3)];
const spuFrom = (register, rt) => sh(rt, register, S3);
const spuAll = list => list.flatMap(([register, value]) => spu(register, value));
const name8 = text => { const bytes = Buffer.alloc(8); bytes.write(text); return [word(bytes.readUInt32LE(0)), word(bytes.readUInt32LE(4))]; };
const bytesAt = (name, list) => {
  const padded = [...list, ...Array((4 - list.length % 4) % 4).fill(0)];
  return [at(name), ...Array.from({ length: padded.length / 4 }, (_, i) => word(padded[i * 4] | padded[i * 4 + 1] << 8 | padded[i * 4 + 2] << 16 | padded[i * 4 + 3] << 24))];
};

function assembleIop(code) {
  const places = {}, items = [];
  for (const item of code.flat(Infinity)) {
    if (item.at) places[item.at] = items.length * 4;
    else if (item.align) while (items.length * 4 % item.align) items.push(0);
    else items.push(item);
  }
  const placed = name => {
    if (places[name] === undefined) throw new Error(`No place called ${name} in the module.`);
    return places[name];
  };
  const words = items.map((item, index) => {
    if (typeof item === 'number') return item >>> 0;
    if (item.word !== undefined) return item.word >>> 0;
    if (item.place) return addiu(item.rt, S0, placed(item.place));
    if (item.start) return addiu(S0, RA, -placed(item.start));
    return op(item.branch, item.rs, item.rt, (placed(item.name) - index * 4 - 4) >> 2);
  });
  return { words, places };
}

// The pad, through the SIO2 at 0xBF808200, which T3 reaches from 0xBF810000: a command sent a byte at a time and its
// answer read back, with the command in A0, its length in A1, the answer's length in A2 and where it goes in A3
const SIO2 = { REG0: 0x8200, DATA_OUT: 0x8260, DATA_IN: 0x8264, CTRL: 0x8268 };
const sio2 = (command, sent, answered) => [placeOf(A0, command), ...li(A1, sent), ...li(A2, answered), placeOf(A3, 'padAnswer'), bal('sio2'), NOP];
/** What the module sends the pad as it starts, each [bytes, how many come back]: into its configuration, to analog,
 *  with the pressure on every button, and out again. And what it sends each frame, which reads all of it. */
export const PAD_SET_UP = [[[0x01, 0x43, 0x00, 0x01, 0x00], 5], [[0x01, 0x44, 0x00, 0x01, 0x03, 0, 0, 0, 0], 9], [[0x01, 0x4F, 0x00, 0xFF, 0xFF, 0x03, 0, 0, 0], 9], [[0x01, 0x43, 0x00, 0x00, 0x00], 5]];
export const PAD_READ = [0x01, 0x42, 0x00, ...Array(18).fill(0)], PAD_ANSWER = 21;

// frames % n into T2, from S1, by taking n away while it's at least n
const remainder = (n, name) => [addiu(T2, S1, 0), at(`${name}Again`), slti(T1, T2, n), bne(T1, ZERO, `${name}Done`), NOP, addiu(T2, T2, -n), beq(ZERO, ZERO, `${name}Again`), NOP, at(`${name}Done`)];

const soundModule = () => assembleIop([
  // its start: its thread made and started, and it stays in memory
  at('start'),
  addiu(SP, SP, -32), sw(RA, 28, SP), sw(S0, 24, SP),
  bal('started'), NOP, at('started'), startFrom('started'),
  placeOf(A0, 'thread'), placeOf(T0, 'run'), sw(T0, 8, A0),
  bal('CreateThread'), NOP,
  addiu(A0, V0, 0), bal('StartThread'), addiu(A1, ZERO, 0),
  // and its server's thread
  placeOf(A0, 'serverThread'), placeOf(T0, 'serve'), sw(T0, 8, A0),
  bal('CreateThread'), NOP,
  addiu(A0, V0, 0), bal('StartThread'), addiu(A1, ZERO, 0),
  lw(S0, 24, SP), lw(RA, 28, SP), addiu(SP, SP, 32),
  JR_RA, addiu(V0, ZERO, 0),

  // its thread: first what doesn't depend on when it's done
  at('run'),
  bal('running'), NOP, at('running'), startFrom('running'),
  lui(S3, 0xBF90),
  // core 0 on, and the tone into its memory through the data port
  spu(R.ATTR, ATTR_SET_UP | 0x10), spu(R.TSA_HI, TONE_AT >>> 17), spu(R.TSA_LO, TONE_AT >>> 1 & 0xFFFF),
  placeOf(T1, 'tone'), ...li(T2, TONE.length / 2),
  at('port'), lhu(T0, 0, T1), NOP, sh(T0, R.STD, S3), addiu(T1, T1, 2), addiu(T2, T2, -1), bne(T2, ZERO, 'port'), NOP,
  // and again, right after it
  placeOf(T1, 'tone'), ...li(T2, TONE.length / 2),
  at('portAgain'), lhu(T0, 0, T1), NOP, sh(T0, R.STD, S3), addiu(T1, T1, 2), addiu(T2, T2, -1), bne(T2, ZERO, 'portAgain'), NOP,
  spu(R.ATTR, ATTR_SET_UP), spuAll(REVERB), spu(R.IRQA_HI, IRQ_AT >>> 17), spu(R.IRQA_LO, IRQ_AT >>> 1 & 0xFFFF),
  // core 1 on, taking the click by DMA on channel 7
  spu(CORE1 + R.ATTR, 0x8000 | 0x20), spu(CORE1 + R.TSA_HI, CLICK_AT >>> 17), spu(CORE1 + R.TSA_LO, CLICK_AT >>> 1 & 0xFFFF),
  lui(T3, 0xBF80), placeOf(T0, 'click'), sw(T0, 0x1500, T3), ...li(T0, 16 | (CLICK.length / 64) << 16), sw(T0, 0x1504, T3), ...li(T0, 0x01000201), sw(T0, 0x1508, T3),
  spu(CORE1 + R.ATTR, 0x8000),
  spuAll(VOICES),
  // the pad set to give the pressure on its buttons
  lui(T3, 0xBF81),
  PAD_SET_UP.map(([bytes, answered], i) => sio2(`padSetUp${i}`, bytes.length, answered)),
  addiu(S1, ZERO, 0), ...li(S2, PITCH_START),

  // then each V-blank, with S1 the frame and S2 the first voice's pitch
  at('frame'),
  bal('WaitVblankStart'), NOP,
  // the pad read, and what it says written back two bytes at a time where the sound chip takes no notice: its mode,
  // its buttons, its sticks and the pressure on each button
  lui(T3, 0xBF81), sio2('padRead', PAD_READ.length, PAD_ANSWER),
  placeOf(T1, 'padAnswer'),
  Array.from({ length: (PAD_ANSWER - 1) / 2 }, (_, i) => [lbu(T0, 1 + i * 2, T1), lbu(T2, 2 + i * 2, T1), NOP, sll(T2, T2, 8), or(T0, T0, T2), sh(T0, R.NOTE, S3)]),
  bne(S1, ZERO, 'playing'), NOP,
  spu(R.ATTR, ATTR_PLAYING), spu(voice(0, R.VOLR), SWEEP_UP), spu(R.KON_HI, 7), spu(CORE1 + R.KON_HI, 1),
  beq(ZERO, ZERO, 'next'), NOP,
  at('playing'),
  addiu(S2, S2, PITCH_STEP), ...li(T1, PITCH_END), bne(S2, T1, 'pitched'), NOP, ...li(S2, PITCH_START), at('pitched'),
  spuFrom(voice(0, R.PITCH), S2),
  remainder(TONE_EVERY, 'tone'),
  ...li(T1, TONE_OFF), bne(T2, T1, 'held'), NOP, spu(R.KOFF_HI, 1), at('held'),
  bne(T2, ZERO, 'notKeyed'), NOP, spu(R.KON_HI, 1), at('notKeyed'),
  remainder(CLICK_EVERY, 'click'),
  bne(T2, ZERO, 'noClick'), NOP, spu(CORE1 + R.KON_HI, 1), at('noClick'),
  ...li(T1, SWEEP_AT), bne(S1, T1, 'noSweep'), NOP, spu(voice(1, R.VOLL), SWEEP_DOWN), at('noSweep'),
  ...li(T1, MASTER_SWEEP_AT), bne(S1, T1, 'noMaster'), NOP, spu(R.MVOLR, MASTER_SWEEP), at('noMaster'),
  ...li(T1, MASTER_BACK_AT), bne(S1, T1, 'noBack'), NOP, spu(R.MVOLR, MASTER_RIGHT), at('noBack'),
  // what the chip says, written back where the emulator takes no notice of it
  lhu(T0, R.ENDX_HI, S3), NOP, sh(T0, R.NOTE, S3),
  lhu(T0, CORE1 + R.ENDX_HI, S3), NOP, sh(T0, CORE1 + R.NOTE, S3),
  lhu(T0, R.IRQINFO, S3), NOP, sh(T0, R.NOTE, S3),
  at('next'),
  beq(ZERO, ZERO, 'frame'), addiu(S1, S1, 1),

  // a command to the SIO2: how long it is each way, the first of the commands, then each byte out and each byte back
  at('sio2'),
  sll(T0, A1, 8), sll(T1, A2, 18), or(T0, T0, T1), sw(T0, SIO2.REG0, T3),
  ...li(T0, 0x0C), sw(T0, SIO2.CTRL, T3),
  at('sio2Out'), lbu(T0, 0, A0), NOP, sw(T0, SIO2.DATA_OUT, T3), addiu(A0, A0, 1), addiu(A1, A1, -1), bne(A1, ZERO, 'sio2Out'), NOP,
  at('sio2In'), lw(T0, SIO2.DATA_IN, T3), NOP, sb(T0, 0, A3), addiu(A3, A3, 1), addiu(A2, A2, -1), bne(A2, ZERO, 'sio2In'), NOP,
  JR_RA, NOP,

  // its server's thread: an RPC server of its own, as a game's sound driver has, which the EE calls every frame
  at('serve'),
  bal('serving'), NOP, at('serving'), startFrom('serving'),
  bal('SifInitRpc'), addiu(A0, ZERO, 0),
  bal('GetThreadId'), NOP,
  placeOf(A0, 'queue'), bal('SifSetRpcQueue'), addiu(A1, V0, 0),
  addiu(SP, SP, -32), placeOf(T0, 'queue'), sw(T0, 0x18, SP), sw(ZERO, 0x10, SP), sw(ZERO, 0x14, SP),
  placeOf(A0, 'server'), ...li(A1, SERVER), placeOf(A2, 'answer'), placeOf(A3, 'rpcBuffer'),
  bal('SifRegisterRpc'), NOP,
  placeOf(A0, 'queue'), bal('SifRpcLoop'), NOP,
  at('stuck'), beq(ZERO, ZERO, 'stuck'), NOP,
  // the server's function, with the call's number in A0 and its arguments in A1: the first word three times over and
  // the number added, written over it, its buffer being its answer
  at('answer'),
  lw(T0, 0, A1), NOP, sll(T1, T0, 1), addu(T1, T1, T0), addu(T1, T1, A0), sw(T1, 0, A1),
  JR_RA, addu(V0, A1, ZERO),

  // what it calls of the IOP's kernel: thbase's CreateThread, StartThread and GetThreadId, vblank's WaitVblankStart,
  // and sifcmd's RPC calls
  word(0x41E00000), word(0), word(0x0101), name8('thbase'),
  at('CreateThread'), JR_RA, addiu(ZERO, ZERO, 4),
  at('StartThread'), JR_RA, addiu(ZERO, ZERO, 6),
  at('GetThreadId'), JR_RA, addiu(ZERO, ZERO, 20),
  word(0), word(0),
  word(0x41E00000), word(0), word(0x0101), name8('sifcmd'),
  at('SifInitRpc'), JR_RA, addiu(ZERO, ZERO, 14),
  at('SifRegisterRpc'), JR_RA, addiu(ZERO, ZERO, 17),
  at('SifSetRpcQueue'), JR_RA, addiu(ZERO, ZERO, 19),
  at('SifRpcLoop'), JR_RA, addiu(ZERO, ZERO, 22),
  word(0), word(0),
  word(0x41E00000), word(0), word(0x0101), name8('vblank'),
  at('WaitVblankStart'), JR_RA, addiu(ZERO, ZERO, 4),
  word(0), word(0),

  // its threads' parameters: ordinary threads, their code filled in as it starts, 2 KB of stack, the sound's at
  // priority 32 and the server's below it at 40, and what the server's registration and its queue keep
  at('thread'), word(0x02000000), word(0), word(0), word(0x800), word(32),
  at('serverThread'), word(0x02000000), word(0), word(0), word(0x800), word(40),
  at('server'), ...Array(32).fill(word(0)),
  at('queue'), ...Array(32).fill(word(0)),
  align(16), at('rpcBuffer'), ...Array(16).fill(word(0)),
  PAD_SET_UP.map(([bytes], i) => bytesAt(`padSetUp${i}`, bytes)), bytesAt('padRead', PAD_READ),
  at('padAnswer'), ...Array(8).fill(word(0)),
  bytesAt('tone', TONE),
  // the click on a 16-byte boundary for the DMA, as a module's own place is on one
  align(16), bytesAt('click', CLICK),
]);

// The module as an IRX file, the ELF the IOP's loader takes: one segment to load, and an .iopmod section saying its
// name, where it starts and its sizes.
function irxOf(words) {
  const body = Buffer.from(new Uint32Array(words).buffer);
  const name = 'dp_sound', iopmod = Buffer.alloc(26 + name.length + 1);
  iopmod.writeUInt32LE(0xFFFFFFFF, 0);     // no module information
  iopmod.writeUInt32LE(0, 4);              // where it starts, from its beginning
  iopmod.writeUInt32LE(0, 8);              // gp
  iopmod.writeUInt32LE(body.length, 12);   // text
  iopmod.writeUInt32LE(0, 16);             // data
  iopmod.writeUInt32LE(0, 20);             // bss
  iopmod.writeUInt16LE(0x0101, 24);
  iopmod.write(name, 26);
  const names = Buffer.from('\0.iopmod\0.text\0.shstrtab\0');
  const header = 52, bodyAt = 0x80, iopmodAt = bodyAt + body.length, namesAt = iopmodAt + iopmod.length;
  const sectionsAt = Math.ceil((namesAt + names.length) / 4) * 4, sections = Buffer.alloc(40 * 4);
  const section = (i, nameAt, type, flags, offset, size) => {
    sections.writeUInt32LE(nameAt, i * 40);
    sections.writeUInt32LE(type, i * 40 + 4);
    sections.writeUInt32LE(flags, i * 40 + 8);
    sections.writeUInt32LE(offset, i * 40 + 16);
    sections.writeUInt32LE(size, i * 40 + 20);
    sections.writeUInt32LE(4, i * 40 + 32);
  };
  section(1, 1, 0x70000080, 0, iopmodAt, iopmod.length);
  section(2, 9, 1, 6, bodyAt, body.length);
  section(3, 15, 3, 0, namesAt, names.length);
  const head = Buffer.alloc(bodyAt);
  head.set([0x7F, 0x45, 0x4C, 0x46, 1, 1, 1], 0);
  head.writeUInt16LE(0xFF80, 16);   // a module for the IOP
  head.writeUInt16LE(8, 18);        // MIPS
  head.writeUInt32LE(1, 20);
  head.writeUInt32LE(0, 24);        // where it starts
  head.writeUInt32LE(header, 28);
  head.writeUInt32LE(sectionsAt, 32);
  head.writeUInt16LE(header, 40);
  head.writeUInt16LE(32, 42);
  head.writeUInt16LE(1, 44);
  head.writeUInt16LE(40, 46);
  head.writeUInt16LE(4, 48);
  head.writeUInt16LE(3, 50);
  head.writeUInt32LE(1, header);              // loaded
  head.writeUInt32LE(bodyAt, header + 4);
  head.writeUInt32LE(body.length, header + 16);
  head.writeUInt32LE(body.length, header + 20);
  head.writeUInt32LE(7, header + 24);
  head.writeUInt32LE(16, header + 28);
  const file = Buffer.concat([head, body, iopmod, names]);
  return Buffer.concat([file, Buffer.alloc(sectionsAt - file.length), sections]);
}

/** The IOP module that plays the sound, as an IRX file. */
export const soundIrx = () => irxOf(soundModule().words);
/** Where the module's file has its code, and where in that its tone and its click are, in bytes. */
export const IRX_BODY = 0x80;
export const moduleData = () => {
  const { places } = soundModule();
  return { tone: places.tone, click: places.click, rpcBuffer: places.rpcBuffer };
};

// ---------------------------------------------------------------------------------------------------------------------
// The program for the EE, which loads the module through the SIF

// the EE's registers
const E = { ZERO: 0, V0: 2, V1: 3, A0: 4, A1: 5, T1: 9, T2: 10, S2: 18, S3: 19, S4: 20, S5: 21 };
// the EE's DMA channel to the GIF
const GIF_DMA = 0x1000A000;
/** What the program puts in its LABEL writes, in order: what SifGetReg says of the SIF's registers, the ids SifSetDma
 *  gives, what SifDmaStat says of two of them, the words of the IOP's two replies, and what the loader's call gave back. */
export const LABEL_NAMES = [
  ...[1, 3, 4, 0x80000000, 0x80000002, 2].map(register => `register ${register.toString(16)}`),
  'init id', 'irx id', 'irx status', 'bind id', 'call id', 'call status',
  ...['bind', 'call', 'server bind'].flatMap(name => Array.from({ length: 12 }, (_, i) => `${name} reply ${i}`)),
  'received 0', 'received 1', 'answer',
];
// the LABEL packet as `send` takes it: only its length counts
const LABELS_SIZE = { length: 4 + LABEL_NAMES.length * 4 };
/** Where the module goes in the IOP's memory before the loader puts it in a place of its own. */
export const IRX_IN_IOP = 0x180000;
/** The SIF's commands, and the loader's RPC server and its call that loads a module from the IOP's memory. */
export const SIF_INIT = 0x80000002, SIF_REND = 0x80000008, SIF_BIND = 0x80000009, SIF_CALL = 0x8000000A, LOADFILE = 0x80000006, LOAD_FROM_MEMORY = 6;
// the place the RPC library sends a call's arguments to, which the emulator's SIF knows them by
const RPC_ARGUMENTS = 0xDEADBEF0;

export function madeUpPs2Sound() {
  const irx = soundIrx();
  // the data after the GS's packet, each on a 16-byte boundary, in words from the start of it
  const layout = {}, data = [...PACKET];
  const put = (name, words) => {
    while (data.length % 4) data.push(0);
    layout[name] = data.length * 4;
    data.push(...words);
  };
  const header = (size, command, optional = 0) => [size, 0, command, optional];
  put('reply', Array(16).fill(0));
  put('received', Array(4).fill(0));
  put('client', Array(16).fill(0));
  put('serverClient', Array(16).fill(0));
  put('serverArguments', Array(4).fill(0));
  put('answered', Array(4).fill(0));
  put('arguments', [IRX_IN_IOP, 0, ...Array(126).fill(0)]);
  const irxWords = Array.from({ length: Math.ceil(irx.length / 4) }, (_, i) => irx.length >= i * 4 + 4 ? irx.readUInt32LE(i * 4) : Buffer.concat([irx.subarray(i * 4), Buffer.alloc(4)]).readUInt32LE(0));
  put('irx', irxWords);
  // a GIF packet of GS LABEL writes, which change nothing drawn, each carrying one thing the SIF gave the program, so
  // they're in its draw list (LABEL_NAMES)
  put('labels', [LABEL_NAMES.length | 0x8000, 0x10000000, 0xE, 0, ...LABEL_NAMES.flatMap(() => [0, 0, 0x62, 0])]);
  const addressOf = (packetAt, name) => packetAt + layout[name];
  // the packets need the program's own place, so they're filled in for wherever the data lands
  const packets = packetAt => {
    const at = name => addressOf(packetAt, name);
    return {
      init: [...header(20, SIF_INIT), at('reply')],
      bind: [...header(36, SIF_BIND), 0, at('client'), 0, at('client'), LOADFILE],
      call: [...header(56, SIF_CALL), 1, at('client'), 1, at('client'), LOAD_FROM_MEMORY, 512, at('received'), 8, 0, (LOADFILE ^ 0xACACACAC) >>> 0],
      serverBind: [...header(36, SIF_BIND), 2, at('serverClient'), 2, at('serverClient'), SERVER],
      serverCall: [...header(56, SIF_CALL), 3, at('serverClient'), 3, at('serverClient'), SERVER_CALL, 16, at('answered'), 16, 0, (SERVER ^ 0xACACACAC) >>> 0],
    };
  };
  // the transfers each SifSetDma sends: from, to, how many bytes, and 0. The command buffer's place is filled in as the
  // program runs, from SifGetReg
  const transfers = (packetAt, sent) => ({
    init: [[sent.init, 0, 32, 0]],
    irx: [[addressOf(packetAt, 'irx'), IRX_IN_IOP, irxWords.length * 4, 0]],
    bind: [[sent.bind, 0, 48, 0]],
    call: [[addressOf(packetAt, 'arguments'), RPC_ARGUMENTS, 512, 0], [sent.call, 0, 64, 0]],
    serverBind: [[sent.serverBind, 0, 48, 0]],
    serverCall: [[addressOf(packetAt, 'serverArguments'), RPC_ARGUMENTS, 16, 0], [sent.serverCall, 0, 64, 0]],
  });
  // the packets and transfers go after the rest of the data, which is where the program's code finds them
  const finish = packetAt => {
    const all = [...data], placed = {};
    const putAll = (name, words) => {
      while (all.length % 4) all.push(0);
      placed[name] = packetAt + all.length * 4;
      all.push(...words);
    };
    const made = packets(packetAt);
    for (const [name, words] of Object.entries(made)) putAll(name, words);
    const sent = Object.fromEntries(Object.keys(made).map(name => [name, placed[name]]));
    for (const [name, list] of Object.entries(transfers(packetAt, sent))) putAll(`${name}Transfers`, list.flat());
    return { all, placed };
  };
  // the code's size doesn't depend on where the data is, so the data's place is known from a first pass
  const program = packetAt => {
    const { placed } = finish(packetAt);
    const reply = addressOf(packetAt, 'reply');
    // a system call: its number in V1, its arguments in A0 and A1
    const call = (number, a0, a1 = null) => [eeAddiu(E.V1, E.ZERO, number), ...eeLi(E.A0, a0), ...(a1 === null ? [] : [eeAddiu(E.A1, E.ZERO, a1)]), SYSCALL, NOP];
    // SifSetDma(transfers, count), each transfer to the command buffer given its place first
    const sendTo = (name, count, toCommands = []) => [
      ...toCommands.flatMap(i => [...eeLi(E.T1, placed[`${name}Transfers`] + i * 16 + 4), eeSw(E.S2, 0, E.T1)]),
      ...call(0x77, placed[`${name}Transfers`], count),
    ];
    // a thing the SIF gave, from V0 or from a word of memory, into its LABEL write
    const label = name => addressOf(packetAt, 'labels') + 16 + LABEL_NAMES.indexOf(name) * 16;
    const keep = name => [...eeLi(E.T1, label(name)), eeSw(E.V0, 0, E.T1)];
    const keepWord = (name, address) => [...eeLi(E.T1, address), eeLw(E.V0, 0, E.T1), ...keep(name)];
    // waiting for the IOP's reply, keeping its words, then saying it's been taken, as the SIF's interrupt handler does
    // with iSifSetDChain
    const waitForReply = (name, kept = name) => [
      ...eeLi(E.T1, reply), ...eeLi(E.T2, SIF_REND),
      here(`waiting${name}`), eeLw(E.V0, 8, E.T1), eeBne(E.V0, E.T2, `waiting${name}`), NOP,
      ...(kept ? Array.from({ length: 12 }, (_, i) => keepWord(`${kept} reply ${i}`, reply + i * 4)).flat() : []),
      ...eeLi(E.T1, reply), eeSw(E.ZERO, 8, E.T1),
      eeAddiu(E.V1, E.ZERO, -0x78), SYSCALL, NOP,
    ];
    // SifDmaStat(the id in S4)
    const dmaStat = name => [eeAddiu(E.V1, E.ZERO, 0x76), eeAddiu(E.A0, E.S4, 0), SYSCALL, NOP, ...keep(name)];
    return [
      ...setUp(packetAt),
      // what SifGetReg says of each of the SIF's registers, the IOP's command buffer, the second, kept in S2
      ...[1, 3, 4, 0x80000000, 0x80000002].flatMap(register => [...call(0x7A, register), ...keep(`register ${register.toString(16)}`)]),
      ...call(0x7A, 2), ...keep('register 2'), eeAddiu(E.S2, E.V0, 0),
      ...sendTo('init', 1, [0]), ...keep('init id'),
      ...sendTo('irx', 1), ...keep('irx id'), eeAddiu(E.S4, E.V0, 0), ...dmaStat('irx status'),
      ...sendTo('bind', 1, [0]), ...keep('bind id'), ...waitForReply('Bind', 'bind'),
      ...sendTo('call', 2, [1]), ...keep('call id'), eeAddiu(E.S4, E.V0, 0), ...waitForReply('Call', 'call'), ...dmaStat('call status'),
      ...keepWord('received 0', addressOf(packetAt, 'received')), ...keepWord('received 1', addressOf(packetAt, 'received') + 4),
      // the module's own server, bound once
      ...sendTo('serverBind', 1, [0]), ...waitForReply('ServerBind', 'server bind'),
      ...eeLi(E.S3, addressOf(packetAt, 'labels')), eeAddiu(E.S5, E.ZERO, 0),
      here('frame'),
      ...waitForVBlank,
      // and called each frame with the frame's number, its answer kept
      ...eeLi(E.T1, addressOf(packetAt, 'serverArguments')), eeSw(E.S5, 0, E.T1),
      ...sendTo('serverCall', 2, [1]), ...waitForReply('ServerCall', null),
      ...keepWord('answer', addressOf(packetAt, 'answered')), eeAddiu(E.S5, E.S5, 1),
      ...send(PACKET),
      ...send(LABELS_SIZE, GIF_DMA, E.S3, 'labels'),
      eeJ('frame'), NOP,
    ];
  };
  // the code's size doesn't depend on where its data is, so the data is made for the place elfOf puts it at
  const codeWords = program(0).filter(item => !item.here).length, packetAt = LOAD_AT + Math.ceil(codeWords * 4 / 16) * 16;
  const { placed } = finish(packetAt);
  // where the program keeps what its Dreamport needs to find in its own copy of it
  const places = { reply: addressOf(packetAt, 'reply'), received: addressOf(packetAt, 'received'), serverArguments: addressOf(packetAt, 'serverArguments'), answered: addressOf(packetAt, 'answered'), ...Object.fromEntries(Object.entries(placed).filter(([name]) => name.endsWith('Transfers'))) };
  return { ...elfOf(program, finish(packetAt).all), places };
}
