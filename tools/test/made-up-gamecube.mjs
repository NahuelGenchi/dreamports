// A small GameCube program with nothing from any game in it, written here, for the tools' tests of the GameCube, and
// the disc it boots from. Its instructions are written as their words, with the few lines below that make them, so the
// tests need no assembler. The console keeps each word with its highest byte first, and so does everything here.
//
// The program sets the video interface up for the picture every American and Japanese console shows, 640 by 480 in two
// fields, and gives it a framebuffer of its own, which it writes straight into, in the YUV pairs the console shows: a
// background, and a square that moves STEP pixels to the right each field and goes back to the left edge past 512,
// its even lines in one colour and its odd lines in another, so each field, which shows every other line, has its own.
// It plays a tone too, a square wave it hands the audio interface by DMA, round and round, with no program on the sound
// processor, as loud as LOUD on the left and half that on the right. Each field it reads the first controller, the two
// words the serial interface last polled it for, and draws their 64 bits as blocks, light for a 1 and dark for a 0. It waits for line LINE of each field before it draws, so a picture is never shown half drawn. It writes
// its picture through the addresses that go round the processor's data cache, at 0xC0000000, as the video interface
// reads the memory itself and never sees what the cache still holds.
//
// Its functions, in order, from where it loads:
//   start    the entry: sets the stack, calls setup, and then for ever waits for a field and moves the square
//   setup    writes the video interface's registers from the table in the program's values, fills the framebuffer
//            with the background, draws the square at the left edge and starts the tone
//   fill     writes r5 words of r4 from r3, in a loop
//   square   draws the square, r3 pixels from the left edge, its even lines in the colour in r4 and its odd in r5
//   bits     draws the 32 bits of r3 as blocks, the highest first, from r4 in the framebuffer
//   wait     comes back once the beam is at line LINE of either field, having left it first
// and after them, for the function check, which nothing of the program calls:
//   sum      r3 + r4
//   compare  -1, 0 or 1, as r3 is less than r4, the same or more, each a number with a sign
//   shift    r3 shifted left by r4, right by it and right by it keeping its sign, the three put together with xor, as
//            the processor shifts, by six bits of r4, so 32 and more shift everything out
//   divide   r3 over r4, each with a sign, as the processor divides, with -1 or 0 for what it can't
//   wide     the 64-bit sum of r3 and r4 and of r5 and r6, high words first, in r3 and r4
//   pick     a switch on r3, through a table of its cases in the program's values
//   mix      (f1 + f2) * f3, in singles, as fadds and fmuls work them out
//   scale    f1 * f2 + f3 rounded once, by fmadds
//   toint    f1 made a whole number toward zero by fctiwz, in r3, through the stack
//   pairs    the two singles at r3 and the two at r4 added and multiplied by those at r3, a pair at a time, by the
//            paired singles' loads, sums and store, to r5
//
// The disc holds the program as a DOL, a small apploader of its own, which tells the console where each of the DOL's
// sections goes, as every disc's does, and a file system with a few files of made-up bytes, one in a folder.

/** Where the program loads and starts, where its values go, its framebuffer and its stack. */
export const LOAD = 0x80003100, VALUES = 0x80004000, FRAMEBUFFER = 0x80100000, STACK = 0x80400000;
/** The same memory with the data cache gone round: what the program writes its picture through. */
export const UNCACHED = 0x40000000;
/** The picture it shows, and what moves on it. */
export const WIDTH = 640, HEIGHT = 480, STEP = 2, SQUARE_Y = 200, SQUARE_SIZE = 32, TRAVEL = 512, LINE = 100;
// the video interface counts the lines of both fields in one go, 525 of them, so the second field's line LINE is this one
const SECOND_LINE = LINE + 263;
/** Its two colours, each as the word two pixels side by side take in the framebuffer: Y, Cb, Y, Cr. */
export const BACKGROUND = 0x40804080, SQUARE = 0xC060C0A0, SQUARE_ODD = 0x60A06040;
/** The controller's bits: the colour of a 1 and of a 0, each block's width and lines, and where the two words' blocks
 *  start in the framebuffer, the first word's lines and then the second's, BITS_GAP lines further down. */
export const ON = 0xEB80EB80, OFF = 0x10801080, BIT_WIDTH = 8, BIT_LINES = 8, BITS_X = 64, BITS_Y = 40, BITS_GAP = 16;
/** What the program asks the serial interface for: the standard controller's poll, and polls of every 120 lines, two
 *  a field, on the first channel. */
export const PAD_COMMAND = 0x00400300, PAD_POLL = 0x00780280;
/** Its tone: a square wave of PERIOD samples, this loud, at the faster of the audio interface's two rates, which the
 *  program sets, as the console starts it at the slower. */
export const PERIOD = 96, LOUD = 0x2000;

const VI = 0xCC002000, DSP = 0xCC005000, SI = 0xCC006400, AI = 0xCC006C00;

const d = (op, rt, ra, imm) => ((op << 26) | (rt << 21) | (ra << 16) | (imm & 0xFFFF)) >>> 0;
const addi = (rt, ra, imm) => d(14, rt, ra, imm);
const li = (rt, imm) => addi(rt, 0, imm);
const addis = (rt, ra, imm) => d(15, rt, ra, imm);
const lis = (rt, imm) => addis(rt, 0, imm);
const ori = (ra, rs, imm) => d(24, rs, ra, imm);
const lwz = (rt, offset, ra) => d(32, rt, ra, offset);
const lhz = (rt, offset, ra) => d(40, rt, ra, offset);
const stw = (rs, offset, ra) => d(36, rs, ra, offset);
const sth = (rs, offset, ra) => d(44, rs, ra, offset);
const stwu = (rs, offset, ra) => d(37, rs, ra, offset);
const mulli = (rt, ra, imm) => d(7, rt, ra, imm);
const cmpwi = (ra, imm) => d(11, 0, ra, imm);
const cmplwi = (ra, imm) => d(10, 0, ra, imm);
const x = (rt, ra, rb, xo) => ((31 << 26) | (rt << 21) | (ra << 16) | (rb << 11) | (xo << 1)) >>> 0;
const add = (rt, ra, rb) => x(rt, ra, rb, 266);
const cmpw = (ra, rb) => x(0, ra, rb, 0);
const xor = (ra, rs, rb) => x(rs, ra, rb, 316);
const slw = (ra, rs, rb) => x(rs, ra, rb, 24);
const srw = (ra, rs, rb) => x(rs, ra, rb, 536);
const sraw = (ra, rs, rb) => x(rs, ra, rb, 792);
const divw = (rt, ra, rb) => x(rt, ra, rb, 491);
const addc = (rt, ra, rb) => x(rt, ra, rb, 10);
const adde = (rt, ra, rb) => x(rt, ra, rb, 138);
const lwzx = (rt, ra, rb) => x(rt, ra, rb, 23);
const bctr = 0x4E800420;
// the floating-point unit's: single precision (opcode 59), double (63), its loads and stores, and the paired singles'
// (4, and their quantized loads and stores, 56 and 60, here with GQR0, which holds them as they are)
const fadds = (fd, fa, fb) => ((59 << 26) | (fd << 21) | (fa << 16) | (fb << 11) | (21 << 1)) >>> 0;
const fmuls = (fd, fa, fc) => ((59 << 26) | (fd << 21) | (fa << 16) | (fc << 6) | (25 << 1)) >>> 0;
const fmadds = (fd, fa, fc, fb) => ((59 << 26) | (fd << 21) | (fa << 16) | (fb << 11) | (fc << 6) | (29 << 1)) >>> 0;
const fctiwz = (fd, fb) => ((63 << 26) | (fd << 21) | (fb << 11) | (15 << 1)) >>> 0;
const stfd = (fs, offset, ra) => d(54, fs, ra, offset);
const psq = op => (fd, offset, ra) => ((op << 26) | (fd << 21) | (ra << 16) | (offset & 0xFFF)) >>> 0;
const psq_l = psq(56), psq_st = psq(60);
const ps_add = (fd, fa, fb) => ((4 << 26) | (fd << 21) | (fa << 16) | (fb << 11) | (21 << 1)) >>> 0;
const ps_mul = (fd, fa, fc) => ((4 << 26) | (fd << 21) | (fa << 16) | (fc << 6) | (25 << 1)) >>> 0;
const mr = (ra, rs) => x(rs, ra, rs, 444);
const slwi = (ra, rs, n) => ((21 << 26) | (rs << 21) | (ra << 16) | (n << 11) | (0 << 6) | ((31 - n) << 1)) >>> 0;
const srwi = (ra, rs, n) => ((21 << 26) | (rs << 21) | (ra << 16) | ((32 - n) << 11) | (n << 6) | (31 << 1)) >>> 0;
const mflr = rt => (0x7C0802A6 | (rt << 21)) >>> 0;
const mtlr = rs => (0x7C0803A6 | (rs << 21)) >>> 0;
const mtctr = rs => (0x7C0903A6 | (rs << 21)) >>> 0;
const blr = 0x4E800020;
// what needs to know where things are: a branch to a label, on a condition or not, and a call
const conditional = (bo, bi) => label => ({ at: (labels, pc) => ((16 << 26) | (bo << 21) | (bi << 16) | ((labels[label] - pc) & 0xFFFC)) >>> 0 });
const beq = conditional(12, 2), bne = conditional(4, 2), blt = conditional(12, 0), bge = conditional(4, 0), bgt = conditional(12, 1), bdnz = conditional(16, 0);
const b = label => ({ at: (labels, pc) => ((18 << 26) | ((labels[label] - pc) & 0x3FFFFFC)) >>> 0 });
const bl = label => ({ at: (labels, pc) => ((18 << 26) | ((labels[label] - pc) & 0x3FFFFFC) | 1) >>> 0 });
// a whole address in a register, in two instructions
const address = (rt, value) => [lis(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)];

/** These lines as their words, from `base`: a number is a word, a string a label, and { at } a word that needs the labels. */
export function assemble(lines, base) {
  const labels = {}, flat = lines.flat(Infinity);
  let pc = base;
  for (const line of flat) {
    if (typeof line === 'string') labels[line] = pc;
    else pc += 4;
  }
  const words = [];
  for (const line of flat) {
    if (typeof line === 'string') continue;
    words.push(typeof line === 'number' ? line >>> 0 : line.at(labels, base + words.length * 4));
  }
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((word, n) => bytes.writeUInt32BE(word, n * 4));
  return { bytes, labels };
}

// the video interface's registers for 640 by 480 in two fields at the American and Japanese rate, each 16 bits, as the
// console's own programs set them: where each is, and its value
const fieldBase = at => 0x10000000 | ((at & 0x00FFFFFF) >>> 5);
/** The video interface's registers the program writes, each where it is and its value, in order. */
export const VIDEO = [
  [0x00, 0x0F06], [0x04, 0x4769], [0x06, 0x01AD], [0x08, 0x02EA], [0x0A, 0x5140], [0x0C, 0x0003], [0x0E, 0x0018],
  [0x10, 0x0002], [0x12, 0x0019], [0x14, 0x410C], [0x16, 0x410C], [0x18, 0x40ED], [0x1A, 0x40ED],
  [0x1C, fieldBase(FRAMEBUFFER) >>> 16], [0x1E, fieldBase(FRAMEBUFFER) & 0xFFFF],
  [0x24, fieldBase(FRAMEBUFFER + WIDTH * 2) >>> 16], [0x26, fieldBase(FRAMEBUFFER + WIDTH * 2) & 0xFFFF],
  [0x48, 0x2850], [0x4A, 0x0100], [0x6C, 0x0000], [0x02, 0x0001],
];

/** The tone's samples, one period, as the audio interface takes them: each pair the right side's and then the left's,
 *  the right half as loud. */
export function tone() {
  const bytes = Buffer.alloc(PERIOD * 4);
  for (let n = 0; n < PERIOD; n++) {
    const sample = n < PERIOD / 2 ? LOUD : -LOUD;
    bytes.writeInt16BE(sample / 2, n * 4);
    bytes.writeInt16BE(sample, n * 4 + 2);
  }
  return bytes;
}

function values() {
  const table = Buffer.alloc(VIDEO.length * 4 + 4);
  VIDEO.forEach(([at, value], n) => {
    table.writeUInt16BE(at, n * 4);
    table.writeUInt16BE(value, n * 4 + 2);
  });
  table.writeUInt16BE(0xFFFF, VIDEO.length * 4);
  // the tone starts where 32 bytes do, as the audio interface's DMA counts in blocks of 32
  const before = Buffer.alloc(Math.ceil(table.length / 32) * 32);
  table.copy(before);
  // after the tone, the table of pick's four cases, which the program fills in once it knows where they are
  const cases = Buffer.alloc(16), sound = tone();
  return { bytes: Buffer.concat([before, sound, cases]), tone: VALUES + before.length, cases: VALUES + before.length + sound.length, casesAt: before.length + sound.length };
}

/**
 * The program: { dol, entry, text, data, functions }, `dol` the file a disc boots or a person runs alone, `text` and
 * `data` its two sections as { address, bytes }, and `functions` where each of its functions starts and how long it is.
 */
export function madeUpGameCube() {
  const data = values();
  const BITS_AT = (FRAMEBUFFER | UNCACHED) + BITS_Y * WIDTH * 2 + BITS_X * 2;
  const lines = [
    'start',
    address(1, STACK),
    bl('setup'),
    li(31, 0),                     // r31: where the square is
    address(29, SI),               // r29: the serial interface
    'next',
    bl('wait'),
    // the first controller's two words, as the serial interface last polled it
    lwz(3, 4, 29), address(4, BITS_AT), bl('bits'),
    lwz(3, 8, 29), address(4, BITS_AT + BITS_GAP * WIDTH * 2), bl('bits'),
    mr(3, 31), address(4, BACKGROUND), mr(5, 4), bl('square'),
    addi(31, 31, STEP),
    cmpwi(31, TRAVEL), blt('show'),
    li(31, 0),
    'show',
    mr(3, 31), address(4, SQUARE), address(5, SQUARE_ODD), bl('square'),
    b('next'),

    'setup',
    mflr(0), stwu(1, -16, 1), stw(0, 20, 1),
    address(6, VI), address(7, VALUES),
    'register',
    lhz(8, 0, 7), cmplwi(8, 0xFFFF), beq('registers-done'),
    lhz(9, 2, 7), add(8, 8, 6), sth(9, 0, 8), addi(7, 7, 4), b('register'),
    'registers-done',
    address(3, FRAMEBUFFER | UNCACHED), address(4, BACKGROUND), address(5, WIDTH * HEIGHT / 2), bl('fill'),
    li(3, 0), address(4, SQUARE), address(5, SQUARE_ODD), bl('square'),
    // the first controller: the command it's polled with, and how often
    address(6, SI), address(7, PAD_COMMAND), stw(7, 0, 6), address(7, PAD_POLL), stw(7, 0x30, 6),
    // the tone: the audio interface's faster rate, a zero in its control register, then where the tone is, how many
    // blocks of 32 bytes, and the bit that starts it
    address(6, AI), li(8, 0), stw(8, 0, 6),
    address(6, DSP), address(7, data.tone),
    srwi(8, 7, 16), sth(8, 0x30, 6), sth(7, 0x32, 6),
    li(8, (0x8000 | PERIOD * 4 / 32) - 0x10000), sth(8, 0x36, 6),
    lwz(0, 20, 1), addi(1, 1, 16), mtlr(0), blr,

    'fill',
    mtctr(5), addi(3, 3, -4),
    'fill-word',
    stwu(4, 4, 3), bdnz('fill-word'),
    blr,

    'square',
    // a row is WIDTH * 2 bytes, and two pixels a word
    address(6, (FRAMEBUFFER | UNCACHED) + SQUARE_Y * WIDTH * 2), srwi(7, 3, 1), mulli(7, 7, 4), add(6, 6, 7),
    li(8, SQUARE_SIZE),
    'row',
    li(9, SQUARE_SIZE / 2), mtctr(9), addi(10, 6, -4),
    'pair',
    stwu(4, 4, 10), bdnz('pair'),
    // the next line in the other colour
    mr(11, 4), mr(4, 5), mr(5, 11),
    addi(6, 6, WIDTH * 2), addi(8, 8, -1), cmpwi(8, 0), bne('row'),
    blr,

    'bits',
    li(9, 32),
    'bit',
    address(5, OFF), cmpwi(3, 0), bge('bit-off'), address(5, ON),
    'bit-off',
    li(8, BIT_LINES), mr(10, 4),
    'bit-line',
    stw(5, 0, 10), stw(5, 4, 10), stw(5, 8, 10), stw(5, 12, 10),
    addi(10, 10, WIDTH * 2), addi(8, 8, -1), cmpwi(8, 0), bne('bit-line'),
    addi(4, 4, BIT_WIDTH * 2), slwi(3, 3, 1), addi(9, 9, -1), cmpwi(9, 0), bne('bit'),
    blr,

    'wait',
    address(6, VI),
    'leave',
    lhz(7, 0x2C, 6), cmpwi(7, LINE), beq('leave'), cmpwi(7, SECOND_LINE), beq('leave'),
    'reach',
    lhz(7, 0x2C, 6), cmpwi(7, LINE), beq('reached'), cmpwi(7, SECOND_LINE), bne('reach'),
    'reached',
    blr,

    'sum',
    add(3, 3, 4), blr,

    'compare',
    cmpw(3, 4), blt('less'), bgt('more'), li(3, 0), blr,
    'less', li(3, -1), blr,
    'more', li(3, 1), blr,

    'shift',
    slw(5, 3, 4), srw(6, 3, 4), sraw(7, 3, 4), xor(3, 5, 6), xor(3, 3, 7), blr,

    'divide',
    divw(3, 3, 4), blr,

    'wide',
    addc(4, 4, 6), adde(3, 3, 5), blr,

    'pick',
    cmplwi(3, 3), bgt('pick-none'),
    address(4, data.cases), slwi(5, 3, 2), lwzx(4, 4, 5), mtctr(4), bctr,
    'pick-0', li(3, 10), blr,
    'pick-1', li(3, 20), blr,
    'pick-2', li(3, 35), blr,
    'pick-3', li(3, 47), blr,
    'pick-none', li(3, -1), blr,

    'mix',
    fadds(1, 1, 2), fmuls(1, 1, 3), blr,

    'scale',
    fmadds(1, 1, 2, 3), blr,

    'toint',
    stwu(1, -16, 1), fctiwz(0, 1), stfd(0, 8, 1), lwz(3, 12, 1), addi(1, 1, 16), blr,

    'pairs',
    psq_l(1, 0, 3), psq_l(2, 0, 4), ps_add(3, 1, 2), ps_mul(3, 3, 1), psq_st(3, 0, 5), blr,
    'end',
  ];
  const { bytes: text, labels } = assemble(lines, LOAD);
  for (let n = 0; n < 4; n++) data.bytes.writeUInt32BE(labels[`pick-${n}`], data.casesAt + n * 4);
  const names = ['start', 'setup', 'fill', 'square', 'bits', 'wait', 'sum', 'compare', 'shift', 'divide', 'wide', 'pick', 'mix', 'scale', 'toint', 'pairs', 'end'];
  const functions = Object.fromEntries(names.slice(0, -1).map((name, n) => [name, { address: labels[name], size: labels[names[n + 1]] - labels[name] }]));
  const sections = { text: { address: LOAD, bytes: text }, data: { address: VALUES, bytes: data.bytes } };
  return { dol: dolOf(sections, LOAD), entry: LOAD, ...sections, functions, tone: data.tone, cases: data.cases };
}

/** The parts program's numbers: where its frame's count is, how many pixels of the picture's first rows it colours, and
 *  the count from which they're blue. */
export const PARTS = { COUNT: 0x80200000, PIXELS: 1280, TURN: 60 };
// the colour of a pair of pixels whose brightness is in r3, with the two colour differences given, as a word in r5
const pairOf = (u, v) => [slwi(5, 3, 24), slwi(6, 3, 8), x(5, 5, 6, 444), d(25, 5, 5, u), ori(5, 5, v)];

/**
 * The program of the test of a game made a part at a time (gamecube-parts.mjs), as madeUpGameCube gives one, with five
 * functions: `start` sets the video interface up, clears the picture and the count, and then, once a field, waits for
 * the beam and calls `step`, which moves the count on by `count` and colours the picture's first rows by `red` while
 * the count is under PARTS.TURN and by `blue` from then on, each as bright as the count's low five bits say.
 */
export function madeUpGameCubeParts() {
  const data = values(), rows = FRAMEBUFFER | UNCACHED;
  const colour = (name, u, v) => [
    name,
    lis(4, PARTS.COUNT >>> 16), lwz(3, 0, 4), slwi(3, 3, 27), srwi(3, 3, 25), addi(3, 3, 0x40),
    ...pairOf(u, v),
    address(6, rows - 4), li(7, PARTS.PIXELS / 2), mtctr(7),
    `${name}-pair`, stwu(5, 4, 6), bdnz(`${name}-pair`),
    blr,
  ];
  const lines = [
    'start',
    address(1, STACK),
    address(6, VI), address(7, VALUES),
    'register',
    lhz(8, 0, 7), cmplwi(8, 0xFFFF), beq('registers-done'),
    lhz(9, 2, 7), add(8, 8, 6), sth(9, 0, 8), addi(7, 7, 4), b('register'),
    'registers-done',
    address(3, rows - 4), address(4, BACKGROUND), address(5, WIDTH * HEIGHT / 2), mtctr(5),
    'clear', stwu(4, 4, 3), bdnz('clear'),
    lis(4, PARTS.COUNT >>> 16), li(3, 0), stw(3, 0, 4),
    address(6, AI), stw(3, 0, 6),
    'frame',
    address(6, VI),
    'leave', lhz(7, 0x2C, 6), cmpwi(7, LINE), beq('leave'), cmpwi(7, SECOND_LINE), beq('leave'),
    'reach', lhz(7, 0x2C, 6), cmpwi(7, LINE), beq('reached'), cmpwi(7, SECOND_LINE), bne('reach'),
    'reached',
    bl('step'),
    b('frame'),

    'step',
    mflr(0), stwu(1, -16, 1), stw(0, 20, 1),
    bl('count'),
    lis(4, PARTS.COUNT >>> 16), lwz(3, 0, 4), cmplwi(3, PARTS.TURN), bge('later'),
    bl('red'), b('done'),
    'later', bl('blue'),
    'done', lwz(0, 20, 1), addi(1, 1, 16), mtlr(0), blr,

    'count',
    lis(4, PARTS.COUNT >>> 16), lwz(3, 0, 4), addi(3, 3, 1), stw(3, 0, 4), blr,

    // red: a colour difference toward red, and less of blue; blue the other way round
    ...colour('red', 0x5A, 0xF0),
    ...colour('blue', 0xF0, 0x6E),
    'end',
  ];
  const { bytes: text, labels } = assemble(lines, LOAD);
  const names = ['start', 'step', 'count', 'red', 'blue', 'end'];
  const functions = Object.fromEntries(names.slice(0, -1).map((name, n) => [name, { address: labels[name], size: labels[names[n + 1]] - labels[name] }]));
  const sections = { text: { address: LOAD, bytes: text }, data: { address: VALUES, bytes: data.bytes } };
  return { dol: dolOf(sections, LOAD), entry: LOAD, ...sections, functions };
}

/** A DOL of one section of code and one of values, each from where 32 bytes start, as the console's own tools write them. */
export function dolOf({ text, data }, entry) {
  const pad = bytes => Buffer.concat([bytes, Buffer.alloc((32 - bytes.length % 32) % 32)]);
  const code = pad(text.bytes), kept = pad(data.bytes), header = Buffer.alloc(0x100);
  header.writeUInt32BE(0x100, 0);
  header.writeUInt32BE(text.address, 0x48);
  header.writeUInt32BE(code.length, 0x90);
  header.writeUInt32BE(0x100 + code.length, 0x1C);
  header.writeUInt32BE(data.address, 0x64);
  header.writeUInt32BE(kept.length, 0xAC);
  header.writeUInt32BE(entry, 0xE0);
  return Buffer.concat([header, code, kept]);
}

// Where the console puts a disc's apploader, and the three words it's given to write to: the address to load to, how
// many bytes, and where on the disc
const APPLOADER = 0x81200000;

// A disc's apploader: the console calls its entry for its three functions, then `main` again and again, which each time
// names one more piece of the disc and where it goes, and 0 when there are no more, and then `close` for where the
// program starts. This one reads its pieces from a table after its code, with how many it has given so far.
function apploader(pieces, entry) {
  const table = 'table';
  const lines = [
    'entry',
    address(6, 0), 'init-at', stw(6, 0, 3),
    address(6, 0), 'main-at', stw(6, 0, 4),
    address(6, 0), 'close-at', stw(6, 0, 5),
    blr,
    'init', blr,
    'main',
    address(6, 0), 'table-at',
    lwz(7, 0, 6), lwz(8, 4, 6), cmpw(7, 8), bge('no-more'),
    addi(9, 7, 1), stw(9, 0, 6), mulli(7, 7, 12), add(6, 6, 7),
    lwz(0, 8, 6), stw(0, 0, 3), lwz(0, 12, 6), stw(0, 0, 4), lwz(0, 16, 6), stw(0, 0, 5),
    li(3, 1), blr,
    'no-more', li(3, 0), blr,
    'close', address(3, entry), blr,
    table,
    0, pieces.length, pieces.flatMap(({ address: to, size, at }) => [to, size, at]),
  ];
  // the addresses its own instructions name are known only once it's put together, so it's put together twice
  const { labels } = assemble(lines, APPLOADER), flat = lines.flat(Infinity);
  for (const [mark, label] of [['init-at', 'init'], ['main-at', 'main'], ['close-at', 'close'], ['table-at', table]]) {
    const at = flat.indexOf(mark), [high, low] = address(6, labels[label]);
    flat[at - 2] = high;
    flat[at - 1] = low;
  }
  return assemble(flat, APPLOADER).bytes;
}

/** The files the made-up disc holds beside its program, each with bytes of its own making. */
export const DISC_FILES = [
  { name: 'opening.bin', bytes: Buffer.from(Array.from({ length: 3000 }, (_, n) => n * 7 & 0xFF)) },
  { name: 'stage/first.map', bytes: Buffer.from(Array.from({ length: 5000 }, (_, n) => n * 13 + 5 & 0xFF)) },
  { name: 'stage/second.map', bytes: Buffer.from(Array.from({ length: 64 }, (_, n) => 255 - n)) },
  { name: 'words.txt', bytes: Buffer.from('A disc of the tools\' own.\n') },
];

// the disc's file system: an entry of 12 bytes each for the top folder, every folder and every file, a folder's files
// right after it, and then every name
function fileSystem(files, place) {
  const entries = [{ folder: true, name: '', parent: 0 }];
  const folders = new Map([['', 0]]);
  for (const file of files) {
    const parts = file.name.split('/'), name = parts.pop(), inside = parts.join('/');
    if (inside && !folders.has(inside)) {
      folders.set(inside, entries.length);
      entries.push({ folder: true, name: inside, parent: 0 });
    }
    entries.push({ name, inside, at: place(file), size: file.bytes.length });
  }
  // a folder's entries are in a row, so its files have to follow it: the made-up disc's files are listed that way
  const names = [];
  let namesSize = 0;
  const bytes = Buffer.alloc(entries.length * 12);
  entries.forEach((entry, n) => {
    const nameAt = n ? namesSize : 0;
    if (n) { names.push(Buffer.from(`${entry.name.split('/').pop()}\0`, 'latin1')); namesSize += names.at(-1).length; }
    bytes.writeUInt32BE(((entry.folder ? 1 : 0) << 24 | nameAt) >>> 0, n * 12);
    if (entry.folder) {
      let end = n + 1;
      while (end < entries.length && (n === 0 || (!entries[end].folder && entries[end].inside === entry.name))) end++;
      bytes.writeUInt32BE(entry.parent, n * 12 + 4);
      bytes.writeUInt32BE(end, n * 12 + 8);
    } else {
      bytes.writeUInt32BE(entry.at, n * 12 + 4);
      bytes.writeUInt32BE(entry.size, n * 12 + 8);
    }
  });
  return Buffer.concat([bytes, ...names]);
}

/**
 * A disc that boots the program: { image, code, title, dolAt, files }. `image` is the whole disc as an ISO or a GCM
 * keeps it, far smaller than a real one, as only what it holds is there.
 */
export function madeUpGameCubeDisc({ code = 'GMUE00', title = 'Made-up program', program = madeUpGameCube(), files = DISC_FILES } = {}) {
  const dolAt = 0x4000, dol = program.dol;
  const header = Buffer.alloc(0x2440);
  header.write(code, 0, 'latin1');
  header.writeUInt32BE(0xC2339F3D, 0x1C);
  header.write(title, 0x20, 'latin1');
  // every file from where a sector starts, after the program
  const places = new Map();
  let next = Math.ceil((dolAt + dol.length) / 2048) * 2048;
  const place = file => {
    places.set(file.name, next);
    next += Math.ceil(file.bytes.length / 2048) * 2048;
    return places.get(file.name);
  };
  // folders' files in a row, each folder after the top one's own files
  const ordered = [...files.filter(({ name }) => !name.includes('/')), ...files.filter(({ name }) => name.includes('/'))];
  const fst = fileSystem(ordered, place), fstAt = next;
  header.writeUInt32BE(dolAt, 0x420);
  header.writeUInt32BE(fstAt, 0x424);
  header.writeUInt32BE(fst.length, 0x428);
  header.writeUInt32BE(fst.length, 0x42C);
  const sections = [[0x100, program.text], [0x100 + Math.ceil(program.text.bytes.length / 32) * 32, program.data]];
  const loader = apploader(sections.map(([at, section]) => ({ address: section.address, size: Math.ceil(section.bytes.length / 32) * 32, at: dolAt + at })), program.entry);
  const loaderHeader = Buffer.alloc(0x20);
  loaderHeader.write('2026/11/24', 0, 'latin1');
  loaderHeader.writeUInt32BE(APPLOADER, 0x10);
  loaderHeader.writeUInt32BE(loader.length, 0x14);
  const image = Buffer.alloc(Math.ceil((fstAt + fst.length) / 2048) * 2048);
  header.copy(image);
  loaderHeader.copy(image, 0x2440);
  loader.copy(image, 0x2460);
  dol.copy(image, dolAt);
  for (const file of files) file.bytes.copy(image, places.get(file.name));
  fst.copy(image, fstAt);
  return { image, code, title, dolAt, files: files.map(({ name, bytes }) => ({ name, at: places.get(name), size: bytes.length })) };
}
