// A small PlayStation Portable program with nothing from any game in it, written here, for the console's real emulator to
// run in the tools' check of it (real-psp.mjs). It asks the console for its screen, 480 by 272 in 32-bit colour, and paints
// it itself, as a program may: the framebuffer is the console's own video memory. A blue background, and a yellow square
// that moves two pixels a frame from the left edge to the right and back after 448. A second thread of its own plays a
// square wave through one of the console's sound channels, a block at a time, and the first reads the buttons and the
// stick each frame and paints a bar as wide as what it read of each. It paints three bars more, so that what the
// system answers shows in the picture: the number the system gave the thread, once, and the system's time in
// microseconds as each frame's work starts and as it ends, which is a different width as soon as the program is 222
// of the processor's cycles early or late. It runs straight from its ELF file, as the emulator's own
// stand-in for the console's system software starts one, so no file of the console's is needed.
//
// What a program needs of the console it asks of the system's modules, by a number for each function (its NID): the file
// lists them, and the system puts the call for each in the two instructions the file leaves for it (pspProgram).

/** Where the program is loaded, in the console's memory, and where the console keeps what the screen shows. */
export const LOAD_AT = 0x08900000, VIDEO_MEMORY = 0x44000000;
/** The screen, and how many pixels a line of the framebuffer holds. */
export const WIDTH = 480, HEIGHT = 272, LINE = 512;
/** Its colours, as the console keeps them: red in the low byte. */
export const BACKGROUND = 0xFF602010, SQUARE = 0xFF10D0F0, BAR = 0xFFFFFFFF;
/** The square: its size, its line, how far it moves a frame, and where it goes back to the left edge. */
export const SQUARE_SIZE = 32, SQUARE_Y = 120, STEP = 2, TURN = 448;
/** The bars, each as wide as a number and one more: the lines of the thread's number's, the time's as each frame starts,
 *  the buttons', the stick's and the time's as each frame's work ends, and their height. */
export const THREAD_Y = 8, TIME_Y = 24, BAR_Y = 16, STICK_Y = 32, TIME_AGAIN_Y = 40, BAR_HEIGHT = 4;
/** The sound: how many samples a block has, how long the wave's half is in samples, and how loud it is. */
export const BLOCK = 1024, HALF_WAVE = 64, LOUD = 0x2000, VOLUME = 0x8000;

// the processor's registers, by their numbers
export const ZERO = 0, V0 = 2, V1 = 3, A0 = 4, A1 = 5, A2 = 6, A3 = 7, T0 = 8, T1 = 9, T2 = 10, T3 = 11, T4 = 12, T5 = 13, S0 = 16, S1 = 17, S2 = 18, S3 = 19, SP = 29, RA = 31;
// its instructions, as MIPS encodes them
const imm = (op, rs, rt, value) => (op << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
export const lui = (rt, value) => imm(0x0F, 0, rt, value);
export const ori = (rt, rs, value) => imm(0x0D, rs, rt, value);
export const addiu = (rt, rs, value) => imm(0x09, rs, rt, value);
export const andi = (rt, rs, value) => imm(0x0C, rs, rt, value);
export const lw = (rt, offset, base) => imm(0x23, base, rt, offset);
export const lbu = (rt, offset, base) => imm(0x24, base, rt, offset);
export const sw = (rt, offset, base) => imm(0x2B, base, rt, offset);
export const sh = (rt, offset, base) => imm(0x29, base, rt, offset);
export const sll = (rd, rt, shift) => (rt << 16 | rd << 11 | shift << 6) >>> 0;
export const srl = (rd, rt, shift) => (rt << 16 | rd << 11 | shift << 6 | 2) >>> 0;
const three = funct => (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | funct) >>> 0;
export const addu = three(0x21), subu = three(0x23), and = three(0x24), or = three(0x25), xor = three(0x26), sltu = three(0x2B);
export const jr = rs => (rs << 21 | 8) >>> 0;
export const NOP = 0;
export const li = (rt, value) => [lui(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)];
// branches, jumps and addresses by name, filled in once every place is known
export const here = name => ({ here: name });
export const beq = (rs, rt, name) => ({ op: 0x04, rs, rt, name }), bne = (rs, rt, name) => ({ op: 0x05, rs, rt, name });
export const j = name => ({ jump: 2, name }), jal = name => ({ jump: 3, name });
/** A register given the address a name has, as two instructions. */
export const la = (rt, name) => [{ upper: rt, name }, { lower: rt, name }];
/** A call of one of the system's functions, by its name in `imports`, with the instruction after it. */
export const call = name => [jal(`call ${name}`), NOP];

// The system's functions the programs here ask for, each by its module's name and its number
export const SYSTEM = {
  sceDisplaySetMode: ['sceDisplay', 0x0E20F177], sceDisplaySetFrameBuf: ['sceDisplay', 0x289D82FE], sceDisplayWaitVblankStart: ['sceDisplay', 0x984C27E7],
  sceAudioChReserve: ['sceAudio', 0x5EC81C55], sceAudioOutputBlocking: ['sceAudio', 0x136CAF51], sceAudioOutput: ['sceAudio', 0x8C1009B2],
  sceCtrlSetSamplingCycle: ['sceCtrl', 0x6A2774F3], sceCtrlSetSamplingMode: ['sceCtrl', 0x1F4011E6], sceCtrlPeekBufferPositive: ['sceCtrl', 0x3A622550], sceCtrlReadBufferPositive: ['sceCtrl', 0x1F803938],
  sceKernelGetSystemTimeLow: ['ThreadManForUser', 0x369ED59D], sceKernelGetSystemTimeWide: ['ThreadManForUser', 0x82BC5777], sceKernelGetThreadId: ['ThreadManForUser', 0x293B45B8],
  sceKernelExitThread: ['ThreadManForUser', 0xAA73C935], sceKernelExitDeleteThread: ['ThreadManForUser', 0x809CE29B], sceKernelWakeupThread: ['ThreadManForUser', 0xD59EAD2F],
  sceKernelCreateThread: ['ThreadManForUser', 0x446D8DE6], sceKernelStartThread: ['ThreadManForUser', 0xF475845D], sceKernelSleepThread: ['ThreadManForUser', 0x9ACE131E], sceKernelDelayThread: ['ThreadManForUser', 0xCEADEB47],
  sceGeEdramGetAddr: ['sceGe_user', 0xE47E40E4], sceGeListEnQueue: ['sceGe_user', 0xAB49E76A], sceGeListUpdateStallAddr: ['sceGe_user', 0xE0D68148], sceGeListSync: ['sceGe_user', 0x03444EB4], sceGeDrawSync: ['sceGe_user', 0xB287BD61],
  sceKernelDcacheWritebackAll: ['UtilsForUser', 0x79D1C3FA],
  sceKernelCreateSema: ['ThreadManForUser', 0xD6DA4BA1], sceKernelSignalSema: ['ThreadManForUser', 0x3F53E640], sceKernelWaitSema: ['ThreadManForUser', 0x4E3A1105],
  sceKernelPollSema: ['ThreadManForUser', 0x58B1F937], sceKernelCreateEventFlag: ['ThreadManForUser', 0x55C20A00], sceKernelSetEventFlag: ['ThreadManForUser', 0x1FB15A32],
  sceKernelWaitEventFlag: ['ThreadManForUser', 0x402FCF22], sceKernelClearEventFlag: ['ThreadManForUser', 0x812346E4],
  sceKernelCreateCallback: ['ThreadManForUser', 0xE81CAF8F], sceKernelRegisterExitCallback: ['LoadExecForUser', 0x4AC57943], sceKernelSleepThreadCB: ['ThreadManForUser', 0x82826F70],
  sceKernelCreateMutex: ['ThreadManForUser', 0xB7D098C6], sceKernelLockMutex: ['ThreadManForUser', 0xB011B11F], sceKernelUnlockMutex: ['ThreadManForUser', 0x6B30100F],
  sceKernelCreateLwMutex: ['ThreadManForUser', 0x19CFF145], sceKernelLockLwMutex: ['Kernel_Library', 0xBEA46419], sceKernelTryLockLwMutex: ['Kernel_Library', 0xDC692EE3],
  sceKernelUnlockLwMutex: ['Kernel_Library', 0x15B6446B],
};

/**
 * A program as the console's loader takes it: an ELF file with one part, which starts at the first of `code`. `code`
 * is a list of instructions, names (here) and the things above that go by a name; `data` gives each name its bytes or
 * its words, kept after the code, four bytes apart at least, a word given as { address: name } being the address of
 * that name; `imports` names the system's functions it calls. After the data come the module's own description, the
 * list of the modules it asks for, their functions' numbers and the two instructions the system writes each call into.
 *
 * It's loaded at LOAD_AT, where it says, or with `relocatable` it's a PRX, built as if from address 0, with a second
 * part that lists every place that holds an address, which the console adds to as it puts the program where it has
 * room: `at` is then where each name is once the tools' emulator has placed it, at `placedAt`. With `sections` the file
 * names its sections as a compiler's does, which is how a reader tells its code from its values: without them, values
 * right after the code that read as instructions can't be told from a function.
 * { elf, at }: the file, and where each name is.
 */
export function pspProgram({ code, data = {}, imports = [], name = 'made-up', relocatable = false, sections = false, placedAt = 0x08804000 }) {
  const base = relocatable ? 0 : LOAD_AT;
  const at = {}, words = [], places = [];
  let address = base;
  for (const item of code) {
    if (item.here) at[item.here] = address;
    else address += 4;
  }
  const parts = [];
  // bytes at the next free address, under `label`, with each of `addresses`, offsets of words in them, a place that
  // holds an address
  const place = (label, bytes, addresses = []) => {
    address = (address + 3) & ~3;
    at[label] = address;
    parts.push([address, bytes]);
    for (const offset of addresses) places.push([address + offset, 2]);
    address += bytes.length;
  };
  const wordsOf = list => Buffer.from(new Uint32Array(list).buffer);
  const later = [];
  for (const [label, value] of Object.entries(data)) {
    if (value instanceof Uint32Array) place(label, Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    else if (Array.isArray(value)) {
      const bytes = Buffer.alloc(value.length * 4);
      place(label, bytes, value.flatMap((word, index) => (typeof word === 'object' ? [index * 4] : [])));
      later.push(() => value.forEach((word, index) => bytes.writeUInt32LE(typeof word === 'object' ? known(word.address) : word >>> 0, index * 4)));
    } else place(label, Buffer.from(value));
  }
  // the modules asked for, in the order their first function is named
  const modules = [];
  for (const wanted of imports) {
    const [module, number] = SYSTEM[wanted];
    let entry = modules.find(found => found.module === module);
    if (!entry) modules.push(entry = { module, functions: [] });
    entry.functions.push({ wanted, number });
  }
  for (const entry of modules) {
    place(`name ${entry.module}`, Buffer.from(`${entry.module}\0`));
    place(`numbers ${entry.module}`, wordsOf(entry.functions.map(({ number }) => number)));
    // the calls: a return and nothing, until the system writes its own there
    place(`calls ${entry.module}`, wordsOf(entry.functions.flatMap(() => [jr(RA), NOP])));
    entry.functions.forEach(({ wanted }, index) => { at[`call ${wanted}`] = at[`calls ${entry.module}`] + index * 8; });
  }
  place('modules', wordsOf(modules.flatMap(({ module, functions }) => [at[`name ${module}`], 0x40010000, (functions.length << 16 | 5) >>> 0, at[`numbers ${module}`], at[`calls ${module}`]])), modules.flatMap((_, index) => [index * 20, index * 20 + 12, index * 20 + 16]));
  const modulesEnd = address;
  const description = Buffer.alloc(52);
  description.writeUInt16LE(0x0101, 2);
  description.write(name, 4, 27, 'latin1');
  description.writeUInt32LE(at.modules, 44);
  description.writeUInt32LE(modulesEnd, 48);
  place('module', description, [44, 48]);
  function known(label) {
    if (at[label] === undefined) throw new Error(`The program names ${label}, which it doesn't have.`);
    return at[label];
  }
  for (const write of later) write();
  for (const item of code) {
    if (item.here) continue;
    const from = base + words.length * 4;
    if (typeof item === 'number') words.push(item);
    else if (item.jump) {
      places.push([from, 4]);
      words.push((item.jump << 26 | (known(item.name) >>> 2 & 0x3FFFFFF)) >>> 0);
    } else if (item.upper !== undefined) {
      // the upper half makes up for the sign of the lower, which an addition takes
      places.push([from, 5]);
      words.push(lui(item.upper, (known(item.name) + 0x8000) >>> 16));
    } else if (item.lower !== undefined) {
      places.push([from, 6]);
      words.push(addiu(item.lower, item.lower, known(item.name) & 0xFFFF));
    } else words.push(imm(item.op, item.rs, item.rt, (known(item.name) - from - 4) >> 2));
  }
  const size = address - base, listed = relocatable ? Buffer.alloc(places.length * 8) : Buffer.alloc(0);
  // each place: where it is from the first part's start, and its kind, with the first part as what its address counts from
  if (relocatable) places.sort((a, b) => a[0] - b[0]).forEach(([where, kind], index) => { listed.writeUInt32LE(where, index * 8); listed.writeUInt32LE(kind, index * 8 + 4); });
  // with `sections`, the list of places is a section of its own, as the console's loader then reads it, not a part
  const listedAsPart = relocatable && !sections;
  const HEADERS = 52 + 32 * (listedAsPart ? 2 : 1);
  // the sections a program's file names, as a compiler writes them: its code, its values, its module's description,
  // the list of places, and the sections' names
  const codeBytes = words.length * 4, sectionsAt = (HEADERS + size + listed.length + 3) & ~3;
  const named = [];
  if (sections) {
    named.push(['.text', 1, 6, base, HEADERS, codeBytes, 0]);
    named.push(['.data', 1, 3, base + codeBytes, HEADERS + codeBytes, at.module - base - codeBytes, 0]);
    named.push(['.rodata.sceModuleInfo', 1, 2, at.module, HEADERS + at.module - base, 52, 0]);
    if (relocatable) named.push(['.rel.text', 0x700000A0, 0, 0, HEADERS + size, listed.length, 1]);
  }
  const names = sections ? Buffer.from(`\0${[...named.map(([label]) => label), '.shstrtab'].join('\0')}\0`, 'latin1') : Buffer.alloc(0);
  const sectionCount = sections ? named.length + 2 : 0;
  const elf = Buffer.alloc(sections ? sectionsAt + sectionCount * 40 + names.length : HEADERS + size + listed.length);
  if (sections) {
    let nameAt = 1;
    named.forEach(([label, type, flags, where, offset, bytes, info], index) => {
      const at40 = sectionsAt + (index + 1) * 40;
      elf.writeUInt32LE(nameAt, at40);
      elf.writeUInt32LE(type >>> 0, at40 + 4);
      elf.writeUInt32LE(flags, at40 + 8);
      elf.writeUInt32LE(where, at40 + 12);
      elf.writeUInt32LE(offset, at40 + 16);
      elf.writeUInt32LE(bytes, at40 + 20);
      elf.writeUInt32LE(info, at40 + 28);
      elf.writeUInt32LE(4, at40 + 32);
      nameAt += label.length + 1;
    });
    const last = sectionsAt + (named.length + 1) * 40, namesAt = sectionsAt + sectionCount * 40;
    elf.writeUInt32LE(nameAt, last);
    elf.writeUInt32LE(3, last + 4);
    elf.writeUInt32LE(namesAt, last + 16);
    elf.writeUInt32LE(names.length, last + 20);
    names.copy(elf, namesAt);
    elf.writeUInt32LE(sectionsAt, 32);
    elf.writeUInt16LE(sectionCount, 48);
    elf.writeUInt16LE(sectionCount - 1, 50);
    listed.copy(elf, HEADERS + size);
  }
  elf.write('\x7FELF', 0, 'latin1');
  elf.set([1, 1, 1], 4);                         // 32 bits, the low byte first, version 1
  elf.writeUInt16LE(relocatable ? 0xFFA0 : 2, 16); // a program loaded where it says, or one the console places
  elf.writeUInt16LE(8, 18);                      // MIPS
  elf.writeUInt32LE(1, 20);
  elf.writeUInt32LE(base, 24);                   // where it starts
  elf.writeUInt32LE(52, 28);                     // the parts' headers
  elf.writeUInt32LE(0x10A23000, 36);             // as the console's own programs say: MIPS II, EABI, the Allegrex
  elf.writeUInt16LE(52, 40);
  elf.writeUInt16LE(32, 42);
  elf.writeUInt16LE(listedAsPart ? 2 : 1, 44);
  elf.writeUInt16LE(40, 46);
  elf.writeUInt32LE(1, 52);                      // loaded
  elf.writeUInt32LE(HEADERS, 56);
  elf.writeUInt32LE(base, 60);
  // where the module's description is in the file, which is how the console's loader finds it with no section names
  elf.writeUInt32LE(HEADERS + at.module - base, 64);
  elf.writeUInt32LE(size, 68);
  elf.writeUInt32LE(size, 72);
  elf.writeUInt32LE(7, 76);
  elf.writeUInt32LE(16, 80);
  if (listedAsPart) {
    elf.writeUInt32LE(0x700000A0, 84);           // the list of places that hold an address
    elf.writeUInt32LE(HEADERS + size, 88);
    elf.writeUInt32LE(listed.length, 100);
    listed.copy(elf, HEADERS + size);
  }
  Buffer.from(new Uint32Array(words).buffer).copy(elf, HEADERS);
  for (const [where, bytes] of parts) bytes.copy(elf, HEADERS + where - base);
  return { elf, at: relocatable ? Object.fromEntries(Object.entries(at).map(([label, where]) => [label, where + placedAt])) : at };
}

// a rectangle of one colour, painted a word at a time: T0 its first pixel's address, T1 how many across, T2 how many
// lines, T3 the colour. It leaves T0 a line of the framebuffer further down each time
const paint = name => [
  here(`${name} line`), or(T4, T0, ZERO), addu(T5, ZERO, T1),
  here(`${name} pixel`), sw(T3, 0, T4), addiu(T5, T5, -1), bne(T5, ZERO, `${name} pixel`), addiu(T4, T4, 4),
  addiu(T2, T2, -1), bne(T2, ZERO, `${name} line`), addiu(T0, T0, LINE * 4),
];
/** How many instructions painting a rectangle runs: four a pixel and five more a line. */
export const paintCycles = (width, height) => height * (4 * width + 5);
// the instructions of a list, which is the cycles they take when each runs once
const count = list => list.filter(item => !item.here).length;

// The program in stretches, each the instructions that run between two of the system's functions, with what it paints
// in it: `before` runs first, `painted` are rectangles as [name, x, y, width, height, colour], a width or an x given as
// a register's name being worked out by `before`, and `after` runs last, before the call. A stretch's cycles are its
// instructions', which the program's Dreamport says after it has done the same (psp-kit/main.c): CYCLES has them by
// each stretch's name, without what its rectangles take, which paintCycles gives.
const fixed = (name, x, y, width, height, colour) => [...li(T0, VIDEO_MEMORY + (y * LINE + x) * 4), addiu(T1, ZERO, width), addiu(T2, ZERO, height), ...li(T3, colour), ...paint(name)];
const FIXED = 6;
// a bar as wide as T1 says, on line `y`, after its whole band is painted off: T1 is kept in S3 meanwhile
const bar = (name, y) => [or(S3, T1, ZERO), ...fixed(`${name} off`, 0, y, WIDTH, BAR_HEIGHT, BACKGROUND), ...li(T0, VIDEO_MEMORY + y * LINE * 4), or(T1, S3, ZERO), addiu(T2, ZERO, BAR_HEIGHT), ...li(T3, BAR), ...paint(name)];
const BAR_FIXED = 1 + FIXED + 6;

const STRETCHES = {
  // the screen: 480 by 272
  mode: [addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode')],
  // the background, and the framebuffer at the start of video memory, 512 pixels a line, 32 bits a pixel
  framebuffer: [...li(A0, VIDEO_MEMORY), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf')],
  // the buttons, read as they are each frame, with the stick
  cycle: [addiu(A0, ZERO, 0), ...call('sceCtrlSetSamplingCycle')],
  analog: [addiu(A0, ZERO, 1), ...call('sceCtrlSetSamplingMode')],
  // the thread that plays the wave
  create: [...la(A0, 'sound name'), ...la(A1, 'sound'), addiu(A2, ZERO, 0x18), ...li(A3, 0x4000), addiu(T0, ZERO, 0), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread')],
  // a bar as wide as the low bits of the number the system gave the thread, and the thread started
  start: [or(S1, V0, ZERO), andi(T1, V0, 0xFF), addiu(T1, T1, 1), or(A0, S1, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread')],
  wait: [...call('sceDisplayWaitVblankStart')],
  time: [...call('sceKernelGetSystemTimeLow')],
  pad: [...la(A0, 'pad'), addiu(A1, ZERO, 1), ...call('sceCtrlPeekBufferPositive')],
  // what the buttons' bar is as wide as: the low eight bits of what's held, with the eight above them, and one more
  held: [...la(T0, 'pad'), lw(T1, 4, T0), srl(T2, T1, 8), xor(T1, T1, T2), andi(T1, T1, 0xFF), addiu(T1, T1, 1)],
  // and the stick's: half of how far across it is and a quarter of how far down, and one more
  stick: [...la(T0, 'pad'), lbu(T1, 8, T0), lbu(T2, 9, T0), srl(T1, T1, 1), srl(T2, T2, 2), addu(T1, T1, T2), addiu(T1, T1, 1)],
  // the time's: its low eight bits, in microseconds, and one more
  clock: [andi(T1, V0, 0xFF), addiu(T1, T1, 1)],
  // the sound's thread: a channel of its own for blocks of 1,024 samples in stereo, and the wave again and again
  reserve: [addiu(A0, ZERO, -1), addiu(A1, ZERO, BLOCK), addiu(A2, ZERO, 0), ...call('sceAudioChReserve')],
  output: [or(A0, S1, ZERO), ...li(A1, VOLUME), ...la(A2, 'wave'), ...call('sceAudioOutputBlocking')],
};
/** The cycles each stretch of the program's own instructions takes, by its name, without what it paints. */
export const CYCLES = {
  MODE: count(STRETCHES.mode),
  FRAMEBUFFER: FIXED + count(STRETCHES.framebuffer),
  CYCLE: count(STRETCHES.cycle),
  ANALOG: count(STRETCHES.analog),
  CREATE: count(STRETCHES.create),
  // the thread's number's bar is painted between making the thread and starting it
  START: count(STRETCHES.start) + BAR_FIXED,
  // into the frame's loop, and round it: the wait, the first reading of the time and its bar, the square's band and
  // the square, the pad and its two bars, the second reading of the time and its bar, and on to the next frame
  LOOP: 1,
  WAIT: count(STRETCHES.wait),
  TIME: count(STRETCHES.time),
  CLOCK: count(STRETCHES.clock) + BAR_FIXED,
  SQUARE: FIXED + 8,
  PAD: count(STRETCHES.pad),
  HELD: count(STRETCHES.held) + BAR_FIXED,
  STICK: count(STRETCHES.stick) + BAR_FIXED,
  NEXT: 4,
  TURNED: 2,
  RESERVE: count(STRETCHES.reserve),
  FIRST_OUTPUT: 1 + count(STRETCHES.output),
  OUTPUT: 2 + count(STRETCHES.output),
};

/** The program: { elf, at }. With `relocatable`, as a PRX the console places, and with `sections`, naming its sections. */
export function madeUpPsp({ relocatable = false, sections = false } = {}) {
  // a block of the wave, left and right the same, 16 bits each
  const wave = new Int16Array(BLOCK * 2);
  for (let sample = 0; sample < BLOCK; sample++) wave[sample * 2] = wave[sample * 2 + 1] = sample % (HALF_WAVE * 2) < HALF_WAVE ? LOUD : -LOUD;
  const code = [
    ...STRETCHES.mode,
    ...fixed('background', 0, 0, WIDTH, HEIGHT, BACKGROUND), ...STRETCHES.framebuffer,
    ...STRETCHES.cycle,
    ...STRETCHES.analog,
    ...STRETCHES.create,
    ...STRETCHES.start.slice(0, 3), ...bar('thread', THREAD_Y), ...STRETCHES.start.slice(3),
    addiu(S0, ZERO, 0),
    here('frame'),
    ...STRETCHES.wait,
    ...STRETCHES.time, ...STRETCHES.clock, ...bar('time', TIME_Y),
    // the square off where it was, the whole of its band, and on where it is now
    ...fixed('band', 0, SQUARE_Y, WIDTH, SQUARE_SIZE, BACKGROUND),
    ...li(T0, VIDEO_MEMORY + SQUARE_Y * LINE * 4), sll(T1, S0, 2), addu(T0, T0, T1), addiu(T1, ZERO, SQUARE_SIZE), addiu(T2, ZERO, SQUARE_SIZE), ...li(T3, SQUARE), ...paint('square'),
    ...STRETCHES.pad,
    ...STRETCHES.held, ...bar('held', BAR_Y),
    ...STRETCHES.stick, ...bar('stick', STICK_Y),
    ...STRETCHES.time, ...STRETCHES.clock, ...bar('time again', TIME_AGAIN_Y),
    // two pixels on, and back to the left edge at the turn
    addiu(S0, S0, STEP), addiu(T1, ZERO, TURN), bne(S0, T1, 'frame'), NOP,
    j('frame'), addiu(S0, ZERO, 0),
    here('sound'),
    ...STRETCHES.reserve,
    or(S1, V0, ZERO),
    here('block'),
    ...STRETCHES.output,
    j('block'), NOP,
  ];
  return pspProgram({
    code, data: { 'sound name': 'sound\0', wave: new Uint32Array(wave.buffer), pad: new Uint32Array(4) },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceCtrlSetSamplingCycle', 'sceCtrlSetSamplingMode', 'sceCtrlPeekBufferPositive', 'sceKernelCreateThread', 'sceKernelStartThread', 'sceKernelGetSystemTimeLow', 'sceAudioChReserve', 'sceAudioOutputBlocking'],
    relocatable, sections,
  });
}
