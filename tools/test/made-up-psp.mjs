// A small PlayStation Portable program with nothing from any game in it, written here, for the console's real emulator to
// run in the tools' check of it (real-psp.mjs). It asks the console for its screen, 480 by 272 in 32-bit colour, and paints
// it itself, as a program may: the framebuffer is the console's own video memory. A blue background, and a yellow square
// that moves two pixels a frame from the left edge to the right and back after 448. A second thread of its own plays a
// square wave through one of the console's sound channels, a block at a time, and the first reads the buttons each frame
// and paints a bar as wide as the low bits of what it read. It runs straight from its ELF file, as the emulator's own
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
/** The bar that shows the buttons: its line and its height. */
export const BAR_Y = 16, BAR_HEIGHT = 4;
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
  sceKernelCreateThread: ['ThreadManForUser', 0x446D8DE6], sceKernelStartThread: ['ThreadManForUser', 0xF475845D], sceKernelSleepThread: ['ThreadManForUser', 0x9ACE131E], sceKernelDelayThread: ['ThreadManForUser', 0xCEADEB47],
  sceGeEdramGetAddr: ['sceGe_user', 0xE47E40E4], sceGeListEnQueue: ['sceGe_user', 0xAB49E76A], sceGeListUpdateStallAddr: ['sceGe_user', 0xE0D68148], sceGeListSync: ['sceGe_user', 0x03444EB4], sceGeDrawSync: ['sceGe_user', 0xB287BD61],
  sceKernelDcacheWritebackAll: ['UtilsForUser', 0x79D1C3FA],
};

/**
 * A program as the console's loader takes it: an ELF file with one part, loaded at LOAD_AT, which starts at the first
 * of `code`. `code` is a list of instructions, names (here) and the things above that go by a name; `data` gives each
 * name its bytes or its words, kept after the code, four bytes apart at least; `imports` names the system's functions
 * it calls. After the data come the module's own description, the list of the modules it asks for, their functions'
 * numbers and the two instructions the system writes each call into.
 * { elf, at }: the file, and where each name is.
 */
export function pspProgram({ code, data = {}, imports = [], name = 'made-up' }) {
  const at = {}, words = [];
  let address = LOAD_AT;
  for (const item of code) {
    if (item.here) at[item.here] = address;
    else address += 4;
  }
  const parts = [];
  const place = (label, bytes) => {
    address = (address + 3) & ~3;
    at[label] = address;
    parts.push([address, bytes]);
    address += bytes.length;
  };
  const wordsOf = list => Buffer.from(new Uint32Array(list).buffer);
  for (const [label, value] of Object.entries(data)) place(label, value instanceof Uint32Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Array.isArray(value) ? wordsOf(value) : Buffer.from(value));
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
  place('modules', wordsOf(modules.flatMap(({ module, functions }) => [at[`name ${module}`], 0x40010000, (functions.length << 16 | 5) >>> 0, at[`numbers ${module}`], at[`calls ${module}`]])));
  const modulesEnd = address;
  const description = Buffer.alloc(52);
  description.writeUInt16LE(0x0101, 2);
  description.write(name, 4, 27, 'latin1');
  description.writeUInt32LE(at.modules, 44);
  description.writeUInt32LE(modulesEnd, 48);
  place('module', description);
  for (const item of code) {
    if (item.here) continue;
    const from = LOAD_AT + words.length * 4;
    const known = label => { if (at[label] === undefined) throw new Error(`The program names ${label}, which it doesn't have.`); return at[label]; };
    if (typeof item === 'number') words.push(item);
    else if (item.jump) words.push((item.jump << 26 | (known(item.name) >>> 2 & 0x3FFFFFF)) >>> 0);
    else if (item.upper !== undefined) words.push(lui(item.upper, known(item.name) >>> 16));
    else if (item.lower !== undefined) words.push(ori(item.lower, item.lower, known(item.name) & 0xFFFF));
    else words.push(imm(item.op, item.rs, item.rt, (known(item.name) - from - 4) >> 2));
  }
  const size = address - LOAD_AT, HEADERS = 52 + 32;
  const elf = Buffer.alloc(HEADERS + size);
  elf.write('\x7FELF', 0, 'latin1');
  elf.set([1, 1, 1], 4);                         // 32 bits, the low byte first, version 1
  elf.writeUInt16LE(2, 16);                      // a program, loaded where it says
  elf.writeUInt16LE(8, 18);                      // MIPS
  elf.writeUInt32LE(1, 20);
  elf.writeUInt32LE(LOAD_AT, 24);                // where it starts
  elf.writeUInt32LE(52, 28);                     // the one part's header
  elf.writeUInt32LE(0x10A23000, 36);             // as the console's own programs say: MIPS II, EABI, the Allegrex
  elf.writeUInt16LE(52, 40);
  elf.writeUInt16LE(32, 42);
  elf.writeUInt16LE(1, 44);
  elf.writeUInt16LE(40, 46);
  elf.writeUInt32LE(1, 52);                      // loaded
  elf.writeUInt32LE(HEADERS, 56);
  elf.writeUInt32LE(LOAD_AT, 60);
  // where the module's description is in the file, which is how the console's loader finds it with no section names
  elf.writeUInt32LE(HEADERS + at.module - LOAD_AT, 64);
  elf.writeUInt32LE(size, 68);
  elf.writeUInt32LE(size, 72);
  elf.writeUInt32LE(7, 76);
  elf.writeUInt32LE(16, 80);
  Buffer.from(new Uint32Array(words).buffer).copy(elf, HEADERS);
  for (const [where, bytes] of parts) bytes.copy(elf, HEADERS + where - LOAD_AT);
  return { elf, at };
}

// a rectangle of one colour, painted a word at a time: T0 its first pixel's address, T1 how many across, T2 how many
// lines, T3 the colour. It leaves T0 a line of the framebuffer further down each time
const paint = name => [
  here(`${name} line`), or(T4, T0, ZERO), addu(T5, ZERO, T1),
  here(`${name} pixel`), sw(T3, 0, T4), addiu(T5, T5, -1), bne(T5, ZERO, `${name} pixel`), addiu(T4, T4, 4),
  addiu(T2, T2, -1), bne(T2, ZERO, `${name} line`), addiu(T0, T0, LINE * 4),
];
const rectangle = (name, x, y, width, height, colour) => [...li(T0, VIDEO_MEMORY + (y * LINE + x) * 4), addiu(T1, ZERO, width), addiu(T2, ZERO, height), ...li(T3, colour), ...paint(name)];

/** The program: { elf, at }. */
export function madeUpPsp() {
  // a block of the wave, left and right the same, 16 bits each
  const wave = new Int16Array(BLOCK * 2);
  for (let sample = 0; sample < BLOCK; sample++) wave[sample * 2] = wave[sample * 2 + 1] = sample % (HALF_WAVE * 2) < HALF_WAVE ? LOUD : -LOUD;
  const code = [
    // the screen: 480 by 272, the framebuffer at the start of video memory, 512 pixels a line, 32 bits a pixel
    addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode'),
    ...rectangle('background', 0, 0, WIDTH, HEIGHT, BACKGROUND),
    ...li(A0, VIDEO_MEMORY), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf'),
    // the buttons, read as they are each frame
    addiu(A0, ZERO, 0), ...call('sceCtrlSetSamplingCycle'), addiu(A0, ZERO, 1), ...call('sceCtrlSetSamplingMode'),
    // the thread that plays the wave
    ...la(A0, 'sound name'), ...la(A1, 'sound'), addiu(A2, ZERO, 0x18), ...li(A3, 0x4000), addiu(T0, ZERO, 0), addiu(T1, ZERO, 0), ...call('sceKernelCreateThread'),
    or(A0, V0, ZERO), addiu(A1, ZERO, 0), addiu(A2, ZERO, 0), ...call('sceKernelStartThread'),
    addiu(S0, ZERO, 0),
    here('frame'),
    ...call('sceDisplayWaitVblankStart'),
    // the square off where it was, the whole of its band, and on where it is now
    ...rectangle('band', 0, SQUARE_Y, WIDTH, SQUARE_SIZE, BACKGROUND),
    ...li(T0, VIDEO_MEMORY + SQUARE_Y * LINE * 4), sll(T1, S0, 2), addu(T0, T0, T1), addiu(T1, ZERO, SQUARE_SIZE), addiu(T2, ZERO, SQUARE_SIZE), ...li(T3, SQUARE), ...paint('square'),
    // the buttons: the bar's band off, then as many pixels of it as the low eight bits of what's held, and one more
    ...rectangle('bar off', 0, BAR_Y, WIDTH, BAR_HEIGHT, BACKGROUND),
    ...la(A0, 'pad'), addiu(A1, ZERO, 1), ...call('sceCtrlPeekBufferPositive'),
    ...la(T0, 'pad'), lw(T1, 4, T0), srl(T2, T1, 8), xor(T1, T1, T2), andi(T1, T1, 0xFF), addiu(T1, T1, 1),
    ...li(T0, VIDEO_MEMORY + BAR_Y * LINE * 4), addiu(T2, ZERO, BAR_HEIGHT), ...li(T3, BAR), ...paint('bar'),
    // two pixels on, and back to the left edge at the turn
    addiu(S0, S0, STEP), addiu(T1, ZERO, TURN), bne(S0, T1, 'frame'), NOP,
    j('frame'), addiu(S0, ZERO, 0),
    // the sound's thread: a channel of its own for blocks of 1,024 samples in stereo, and the wave again and again
    here('sound'),
    addiu(A0, ZERO, -1), addiu(A1, ZERO, BLOCK), addiu(A2, ZERO, 0), ...call('sceAudioChReserve'),
    or(S1, V0, ZERO),
    here('block'),
    or(A0, S1, ZERO), ...li(A1, VOLUME), ...la(A2, 'wave'), ...call('sceAudioOutputBlocking'),
    j('block'), NOP,
  ];
  return pspProgram({
    code, data: { 'sound name': 'sound\0', wave: new Uint32Array(wave.buffer), pad: new Uint32Array(4) },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceCtrlSetSamplingCycle', 'sceCtrlSetSamplingMode', 'sceCtrlPeekBufferPositive', 'sceKernelCreateThread', 'sceKernelStartThread', 'sceAudioChReserve', 'sceAudioOutputBlocking'],
  });
}
