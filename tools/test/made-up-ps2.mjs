// A small PlayStation 2 program with nothing from any game in it, written here, for the console's real emulator to run in
// the tools' check of it (real-ps2.mjs). It asks the console for an NTSC screen, 640 by 448, and each V-blank draws it
// through the GS: a blue background and a yellow square that moves two pixels a frame, from the left edge to the right and
// back after 512. It has no sound and reads no buttons, as both go through the console's second processor, which a program
// this small doesn't start. It runs straight from its ELF file, as the emulator's own stand-in for the console's BIOS
// starts one, so no file of the console's is needed.
//
// A second program, madeUpPs2In3d, draws in three dimensions, for the check of how a 3D game is proven (ps2-3d.mjs): two
// shaded triangles that cross each other, with a depth buffer deciding each pixel, one of them turning a little each frame
// by sums and products of floats, as a game's own maths turns its models.
//
// A third, madeUpPs2OnVu1, draws as a real game does: a program on vector unit 1 turns a square's four corners by a
// matrix, divides them by their depth and gives the GS a PACKED packet, each frame, with the matrix the main processor
// has turned (ps2-kit.mjs).

import { createHash } from 'node:crypto';

/** Where the program is loaded and starts, in the console's memory. */
export const LOAD_AT = 0x00100000;
/** Its colours, as the GS takes them: red in the low byte. */
export const BACKGROUND = 0x80602010, SQUARE = 0x8010D0F0;
/** The square: its size, its line, and how far it moves a frame. */
export const SQUARE_SIZE = 32, SQUARE_Y = 200, STEP = 2;

// the registers the program uses, by their numbers
const ZERO = 0, V1 = 3, A0 = 4, A1 = 5, A2 = 6, T0 = 8, T1 = 9, T2 = 10, T3 = 11, S0 = 16, S1 = 17;
// the EE's instructions, as MIPS encodes them
const imm = (op, rs, rt, value) => (op << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
const lui = (rt, value) => imm(0x0F, 0, rt, value);
const ori = (rt, rs, value) => imm(0x0D, rs, rt, value);
const addiu = (rt, rs, value) => imm(0x09, rs, rt, value);
const andi = (rt, rs, value) => imm(0x0C, rs, rt, value);
const lw = (rt, offset, base) => imm(0x23, base, rt, offset);
const sw = (rt, offset, base) => imm(0x2B, base, rt, offset);
const sll = (rd, rt, shift) => (rt << 16 | rd << 11 | shift << 6) >>> 0;
const or = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x25) >>> 0;
const SYSCALL = 0x0C, NOP = 0;
const li = (rt, value) => [lui(rt, value >>> 16), ori(rt, rt, value & 0xFFFF)];
// branches and jumps by name, filled in once every place is known
const here = name => ({ here: name }), beq = (rs, rt, name) => ({ op: 0x04, rs, rt, name }), bne = (rs, rt, name) => ({ op: 0x05, rs, rt, name });
const j = name => ({ jump: name });

// the GS's privileged registers and the DMA controller's, as the EE sees them
const GS = 0x12000000, PMODE = 0x00, SMODE2 = 0x20, DISPFB1 = 0x70, DISPLAY1 = 0x80, BGCOLOR = 0xE0, CSR = 0x1000;
const GIF_DMA = 0x1000A000, VIF1_DMA = 0x10009000, MADR = 0x10, QWC = 0x20, D_CTRL = 0x1000E000;

// what the GIF draws each frame: a tag saying how many register writes follow, then each as its value and its register
const WIDTH = 640, HEIGHT = 448, FBW = WIDTH / 64;
const XYZ = (x, y) => [(x << 4 | y << 20) >>> 0, 0];
const WRITES = [
  [0x4C, [FBW << 16, 0]],                       // FRAME_1: the framebuffer at 0, 640 wide, 32-bit colour
  [0x40, [(WIDTH - 1) << 16, (HEIGHT - 1) << 16]], // SCISSOR_1: the whole screen
  [0x18, [0, 0]],                               // XYOFFSET_1
  [0x47, [0x30000, 0]],                         // TEST_1: depth test, always passing
  [0x4E, [0, 1]],                               // ZBUF_1: no depth written
  [0x1A, [1, 0]],                               // PRMODECONT
  [0x00, [6, 0]],                               // PRIM: a sprite
  [0x01, [BACKGROUND, 0x3F800000]],             // RGBAQ
  [0x05, XYZ(0, 0)],                            // XYZ2: the background's corners
  [0x05, XYZ(WIDTH, HEIGHT)],
  [0x01, [SQUARE, 0x3F800000]],                 // RGBAQ
  [0x05, XYZ(0, SQUARE_Y)],                     // XYZ2: the square's, which the program moves
  [0x05, XYZ(SQUARE_SIZE, SQUARE_Y + SQUARE_SIZE)],
];
const SQUARE_AT = 11;   // the first of the square's corners, in WRITES
const PACKET = [WRITES.length | 0x8000, 0x10000000, 0xE, 0, ...WRITES.flatMap(([register, [low, high]]) => [low, high, register, 0])];

// what both programs start with: the screen, and the packet's place kept in S1
const setUp = packetAt => [
  // SetGsCrt: interlaced, NTSC, in fields, each showing every other line of the 448
  addiu(V1, ZERO, 2), addiu(A0, ZERO, 1), addiu(A1, ZERO, 2), addiu(A2, ZERO, 0), SYSCALL,
  // the screen: circuit 1 alone, showing the framebuffer at 0, 640 by 448 on an NTSC screen, at four clocks a pixel
  lui(T0, GS >>> 16),
  ...li(T1, 0xFF25), sw(T1, PMODE, T0), sw(ZERO, PMODE + 4, T0),
  addiu(T1, ZERO, 1), sw(T1, SMODE2, T0), sw(ZERO, SMODE2 + 4, T0),
  ...li(T1, FBW << 9), sw(T1, DISPFB1, T0), sw(ZERO, DISPFB1 + 4, T0),
  ...li(T1, (656 | 36 << 12 | 3 << 23) >>> 0), sw(T1, DISPLAY1, T0),
  ...li(T1, (WIDTH * 4 - 1 | (HEIGHT - 1) << 12) >>> 0), sw(T1, DISPLAY1 + 4, T0),
  sw(ZERO, BGCOLOR, T0), sw(ZERO, BGCOLOR + 4, T0),
  ...li(T2, D_CTRL), addiu(T1, ZERO, 1), sw(T1, 0, T2),
  ...li(S1, packetAt),
];
// waiting for the V-blank to start
const waitForVBlank = [
  ...li(T0, GS | CSR), addiu(T1, ZERO, 8), sw(T1, 0, T0),
  here('wait'), lw(T1, 0, T0), andi(T1, T1, 8), beq(T1, ZERO, 'wait'), NOP,
];
// the packet to the GIF, or with `to` and `from` to another of the DMA controller's channels, waiting until it's gone
const send = (packet, to = GIF_DMA, from = S1) => [
  ...li(T0, to), sw(from, MADR, T0), addiu(T1, ZERO, packet.length / 4), sw(T1, QWC, T0), addiu(T1, ZERO, 0x101), sw(T1, 0, T0),
  here(`sending${to}`), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, ZERO, `sending${to}`), NOP,
];

function program(packetAt) {
  // where the square's first corner's value is in the packet, after the tag
  const corner = 16 + SQUARE_AT * 16;
  return [
    ...setUp(packetAt), addiu(S0, ZERO, 0),
    here('frame'),
    ...waitForVBlank,
    // the square's corners, where it is this frame
    sll(T1, S0, 4), ...li(T2, SQUARE_Y << 20), or(T1, T1, T2), sw(T1, corner, S1),
    addiu(T1, S0, SQUARE_SIZE), sll(T1, T1, 4), ...li(T2, (SQUARE_Y + SQUARE_SIZE) << 20), or(T1, T1, T2), sw(T1, corner + 16, S1),
    ...send(PACKET),
    // two pixels on, and back to the left edge after 512
    addiu(S0, S0, STEP), andi(S0, S0, 511),
    j('frame'), NOP,
  ];
}

// The program in three dimensions. A point goes round the middle of the screen, turned each frame by an angle whose
// cosine and sine are COS and SIN: x' = x * COS - y * SIN and y' = x * SIN + y * COS, in the EE's floats, which cut every
// result towards zero. The turning triangle's corners are that point, the point a quarter turn on and the point opposite,
// each at its own depth, so it leans through the still triangle, which is at one depth.
/** The turn a frame, the point's start, and the middle of the screen. */
export const COS = Math.fround(Math.cos(0.05)), SIN = Math.fround(Math.sin(0.05)), RADIUS = 150, MIDDLE = [320, 224];
/** The triangles' colours and depths, corner by corner: the still one's, then the turning one's. */
export const STILL = [[170, 104, 0x80E0E0E0, 200], [470, 104, 0x80E0E0E0, 200], [320, 400, 0x80404040, 200]];
export const TURNING = [[0x802020F0, 100], [0x8020F020, 300], [0x80F02020, 200]];
export const BACKGROUND_3D = 0x80301008;

const bitsOf = float => new Uint32Array(new Float32Array([float]).buffer)[0];
// the EE's float instructions
const mtc1 = (rt, fs) => (0x11 << 26 | 4 << 21 | rt << 16 | fs << 11) >>> 0;
const mfc1 = (rt, fs) => (0x11 << 26 | rt << 16 | fs << 11) >>> 0;
const float = funct => (fd, fs, ft) => (0x11 << 26 | 16 << 21 | ft << 16 | fs << 11 | fd << 6 | funct) >>> 0;
const adds = float(0), subs = float(1), muls = float(2), movs = (fd, fs) => float(6)(fd, fs, 0), cvtws = (fd, fs) => float(0x24)(fd, fs, 0);
const lf = (fs, value) => [...li(T1, bitsOf(value)), mtc1(T1, fs)];
const PAGE = 8192, DEPTH_AT = Math.ceil(WIDTH * HEIGHT * 4 / PAGE);
const WRITES_3D = [
  [0x4C, [FBW << 16, 0]],                       // FRAME_1
  [0x40, [(WIDTH - 1) << 16, (HEIGHT - 1) << 16]], // SCISSOR_1
  [0x18, [0, 0]],                               // XYOFFSET_1
  [0x4E, [DEPTH_AT, 0]],                        // ZBUF_1: 32-bit depths, after the framebuffer
  [0x1A, [1, 0]],                               // PRMODECONT
  [0x47, [0x30000, 0]],                         // TEST_1: every pixel passes, to clear the picture and the depths
  [0x00, [6, 0]],                               // PRIM: a sprite
  [0x01, [BACKGROUND_3D, 0x3F800000]],
  [0x05, XYZ(0, 0)],
  [0x05, XYZ(WIDTH, HEIGHT)],
  [0x47, [0x50000, 0]],                         // TEST_1: a pixel passes when it's as near or nearer
  [0x00, [0xB, 0]],                             // PRIM: a triangle, its colour shaded between its corners
  ...STILL.flatMap(([x, y, colour, depth]) => [[0x01, [colour, 0x3F800000]], [0x05, [XYZ(x, y)[0], depth]]]),
  ...TURNING.flatMap(([colour, depth]) => [[0x01, [colour, 0x3F800000]], [0x05, [0, depth]]]),
];
const TURNING_AT = WRITES_3D.length - 5;   // the first of the turning triangle's corners, in WRITES_3D
const PACKET_3D = [WRITES_3D.length | 0x8000, 0x10000000, 0xE, 0, ...WRITES_3D.flatMap(([register, [low, high]]) => [low, high, register, 0])];

function programIn3d(packetAt) {
  // the float registers: the point, the turn, 16 for the GS's sixteenths of a pixel, and the middle in sixteenths
  const X = 0, Y = 1, C = 2, S = 3, SIXTEEN = 4, MIDDLE_X = 5, MIDDLE_Y = 6, A = 8, B = 9, XS = 10, YS = 11;
  // a corner at the middle plus or minus two of the point's parts, cut to whole sixteenths as the EE cuts a float
  const corner = (index, across, down) => [
    across(A, MIDDLE_X), cvtws(A, A), mfc1(T1, A), andi(T1, T1, 0xFFFF),
    down(B, MIDDLE_Y), cvtws(B, B), mfc1(T2, B), sll(T2, T2, 16), or(T1, T1, T2),
    sw(T1, 16 + (TURNING_AT + index * 2) * 16, S1),
  ];
  return [
    ...setUp(packetAt),
    ...lf(X, RADIUS), ...lf(Y, 0), ...lf(C, COS), ...lf(S, SIN), ...lf(SIXTEEN, 16), ...lf(MIDDLE_X, MIDDLE[0] * 16), ...lf(MIDDLE_Y, MIDDLE[1] * 16),
    here('frame'),
    ...waitForVBlank,
    muls(XS, X, SIXTEEN), muls(YS, Y, SIXTEEN),
    ...corner(0, (to, middle) => adds(to, middle, XS), (to, middle) => adds(to, middle, YS)),   // the point
    ...corner(1, (to, middle) => subs(to, middle, YS), (to, middle) => adds(to, middle, XS)),   // a quarter turn on
    ...corner(2, (to, middle) => subs(to, middle, XS), (to, middle) => subs(to, middle, YS)),   // opposite
    ...send(PACKET_3D),
    // the turn
    muls(A, X, C), muls(B, Y, S), subs(A, A, B), muls(B, X, S), muls(XS, Y, C), adds(Y, B, XS), movs(X, A),
    j('frame'), NOP,
  ];
}

// The program on vector unit 1. Each instruction is two, a lower and an upper, run together, and here one of each pair
// does nothing. It keeps the matrix's four columns in the unit's memory from 0, the packet's tag at 4 and its corners from
// 5, a colour and a place each, and the square's corners from 100, a place and a colour each.
/** The square's corners, each a place and a colour, the depth they have, and how far a place across changes its depth. */
export const CORNERS = [[-100, -100, 0x40, 0xC0, 0xF0], [100, -100, 0xF0, 0x40, 0x40], [-100, 100, 0x40, 0xF0, 0x40], [100, 100, 0xF0, 0xF0, 0x40]];
export const CORNER_DEPTH = 1000, DEPTH_ACROSS = 0.001;
const TAG_AT = 4, OUT_AT = 5, IN_AT = 100;
const upper = (op, { dest = 15, ft = 0, fs = 0, fd = 0 } = {}) => (dest << 21 | ft << 16 | fs << 11 | fd << 6 | op) >>> 0;
// the upper instructions whose number is spread over two fields
const upperOther = (number, fields) => upper(0x3C | number & 3, { ...fields, fd: number >> 2 });
const UPPER_NOP = 0x000002FF, LOWER_NOP = 0x8000033C, ENDS = 0x40000000;
const lq = (ft, offset, is) => (15 << 21 | ft << 16 | is << 11 | offset) >>> 0;
const sq = (fs, offset, it) => (1 << 25 | 15 << 21 | it << 16 | fs << 11 | offset) >>> 0;
const iaddiu = (it, is, value) => (0x08 << 25 | (value >> 11 & 15) << 21 | it << 16 | is << 11 | value & 0x7FF) >>> 0;
const isubiu = (it, is, value) => (0x09 << 25 | (value >> 11 & 15) << 21 | it << 16 | is << 11 | value & 0x7FF) >>> 0;
const ibne = (it, is, pairs) => (0x29 << 25 | it << 16 | is << 11 | pairs & 0x7FF) >>> 0;
const XYZ_FIELDS = 14, W_FIELD = 3;
function onVu1() {
  const low = lower => [lower, UPPER_NOP], high = upperWord => [LOWER_NOP, upperWord];
  const pairs = [
    low(iaddiu(1, 0, IN_AT)), low(iaddiu(2, 0, OUT_AT)), low(iaddiu(3, 0, CORNERS.length)),
    low(lq(1, 0, 0)), low(lq(2, 1, 0)), low(lq(3, 2, 0)), low(lq(4, 3, 0)),
    high(upper(0x2C, { fd: 8 })),                                        // SUB vf8, vf0, vf0: nothing in what's kept of a place
    // each corner (the loop starts here, pair 8)
    low(lq(5, 0, 1)), low(lq(6, 1, 1)),
    high(upperOther(0x18, { ft: 5, fs: 1 })),                            // MULAx: the accumulator is the first column by x
    high(upperOther(0x09, { ft: 5, fs: 2 })),                            // MADDAy: and the second by y
    high(upperOther(0x0A, { ft: 5, fs: 3 })),                            // MADDAz: and the third by z
    high(upper(0x0B, { ft: 5, fs: 4, fd: 7 })),                          // MADDw: and the fourth by w, into vf7
    low((0x40 << 25 | W_FIELD << 23 | W_FIELD << 21 | 7 << 16 | 0 << 11 | 0x3BC) >>> 0),   // DIV Q, vf0w, vf7w: 1 over the depth
    low((0x40 << 25 | 0x3BF) >>> 0),                                     // WAITQ
    high(upper(0x1C, { dest: XYZ_FIELDS, fs: 7, fd: 7 })),               // MULq: the place by it
    high(upperOther(0x15, { dest: XYZ_FIELDS, ft: 8, fs: 7 })),          // FTOI4: in whole sixteenths
    low(sq(6, 0, 2)), low(sq(8, 1, 2)),
    low(iaddiu(1, 1, 2)), low(iaddiu(2, 2, 2)), low(isubiu(3, 3, 1)),
    low(LOWER_NOP),
    low(ibne(3, 0, 8 - 25)), low(LOWER_NOP),                             // to the next corner, from pair 24, with the pair after it
    low(iaddiu(4, 0, TAG_AT)),
    low((0x40 << 25 | 4 << 11 | 0x6FC) >>> 0),                           // XGKICK: the packet to the GS
    [LOWER_NOP, (UPPER_NOP | ENDS) >>> 0], low(LOWER_NOP),
  ];
  return pairs.flat();
}

// what the main processor gives the GS itself each frame, through the GIF: where to draw, and a clear picture and depths
const WRITES_BEFORE = [
  [0x4C, [FBW << 16, 0]], [0x40, [(WIDTH - 1) << 16, (HEIGHT - 1) << 16]], [0x18, [0, 0]], [0x4E, [DEPTH_AT, 0]], [0x1A, [1, 0]],
  [0x47, [0x30000, 0]], [0x00, [6, 0]], [0x01, [BACKGROUND_3D, 0x3F800000]], [0x05, XYZ(0, 0)], [0x05, XYZ(WIDTH, HEIGHT)],
  [0x47, [0x50000, 0]],
];
const PACKET_BEFORE = [WRITES_BEFORE.length | 0x8000, 0x10000000, 0xE, 0, ...WRITES_BEFORE.flatMap(([register, [low, high]]) => [low, high, register, 0])];
/** The tag of the packet the vector unit's program fills: a strip of shaded triangles, each corner a colour and a place. */
export const VU1_TAG = [CORNERS.length | 0x8000, (1 << 14 | 0xC << 15 | 2 << 28) >>> 0, 0x51, 0];
// what goes to vector unit 1 each frame, through its interface: the program, the matrix, the tag, the corners, and the word to run
const VIF_NOP = 0, unpack = (at, count) => (0x6C << 24 | count << 16 | at) >>> 0;
const microcode = onVu1();
const MATRIX = [[1, 0, 0, DEPTH_ACROSS], [0, 1, 0, 0], [0, 0, 1, 0], [MIDDLE[0], MIDDLE[1], 0, 1]];
const beforeMatrix = [VIF_NOP, (0x4A << 24 | microcode.length / 2 << 16) >>> 0, ...microcode, 0x01000404, unpack(0, 4)];
const VIF_PACKET = (() => {
  const words = [
    ...beforeMatrix, ...MATRIX.flat().map(bitsOf),
    unpack(TAG_AT, 1), ...VU1_TAG,
    unpack(IN_AT, CORNERS.length * 2), ...CORNERS.flatMap(([x, y, ...colour]) => [bitsOf(x), bitsOf(y), bitsOf(CORNER_DEPTH), bitsOf(1), ...colour, 0x80]),
    0x14000000, 0x11000000,   // MSCAL 0, FLUSH
  ];
  while (words.length % 4) words.push(VIF_NOP);
  return words;
})();
const MATRIX_AT = beforeMatrix.length * 4;   // where the matrix is in the packet, in bytes

function programOnVu1(packetAt) {
  const X = 0, Y = 1, C = 2, S = 3, A = 8, B = 9, S2 = 18;
  const swc1 = (ft, offset, base) => imm(0x39, base, ft, offset), negs = (fd, fs) => float(7)(fd, fs, 0);
  return [
    ...setUp(packetAt), ...li(S2, packetAt + PACKET_BEFORE.length * 4),
    ...lf(X, 1), ...lf(Y, 0), ...lf(C, COS), ...lf(S, SIN),
    here('frame'),
    ...waitForVBlank,
    ...send(PACKET_BEFORE),
    // the matrix's first two columns: the turn, (x, y) and (-y, x)
    swc1(X, MATRIX_AT, S2), swc1(Y, MATRIX_AT + 4, S2), negs(A, Y), swc1(A, MATRIX_AT + 16, S2), swc1(X, MATRIX_AT + 20, S2),
    ...send(VIF_PACKET, VIF1_DMA, S2),
    muls(A, X, C), muls(B, Y, S), subs(A, A, B), muls(B, X, S), muls(10, Y, C), adds(Y, B, 10), movs(X, A),
    j('frame'), NOP,
  ];
}

function assemble(code) {
  const places = {}, words = [];
  for (const item of code) {
    if (item.here) places[item.here] = words.length;
    else words.push(item);
  }
  return words.map((item, at) => {
    if (typeof item === 'number') return item;
    if (item.jump) return (2 << 26 | ((LOAD_AT + places[item.jump] * 4) >>> 2 & 0x3FFFFFF)) >>> 0;
    return imm(item.op, item.rs, item.rt, places[item.name] - at - 1);
  });
}

/** The program as an ELF file, and its SHA-1, as `rom` knows a copy by. */
export const madeUpPs2 = () => elfOf(program, PACKET);
/** The program in three dimensions, the same way. */
export const madeUpPs2In3d = () => elfOf(programIn3d, PACKET_3D);
/** The program whose shapes a program on vector unit 1 makes, the same way. */
export const madeUpPs2OnVu1 = () => elfOf(programOnVu1, [...PACKET_BEFORE, ...VIF_PACKET]);

function elfOf(written, packet) {
  // the code, then the packet on a 16-byte boundary, as the DMA controller reads it
  const codeWords = written(0).filter(item => !item.here).length;
  const packetAt = LOAD_AT + Math.ceil(codeWords * 4 / 16) * 16;
  const code = assemble(written(packetAt));
  const body = new Uint32Array((packetAt - LOAD_AT) / 4 + packet.length);
  body.set(code);
  body.set(packet, (packetAt - LOAD_AT) / 4);
  const segment = Buffer.from(body.buffer);

  const at = 0x80, header = Buffer.alloc(at);
  header.set([0x7F, 0x45, 0x4C, 0x46, 1, 1, 1], 0);   // ELF, 32-bit, little-endian
  header.writeUInt16LE(2, 16);              // a program
  header.writeUInt16LE(8, 18);              // for MIPS
  header.writeUInt32LE(1, 20);
  header.writeUInt32LE(LOAD_AT, 24);        // where it starts
  header.writeUInt32LE(52, 28);             // its one segment's header, after this one
  header.writeUInt32LE(0x20924001, 36);     // the R5900's flags, as the console's own tools write them
  header.writeUInt16LE(52, 40);
  header.writeUInt16LE(32, 42);
  header.writeUInt16LE(1, 44);
  header.writeUInt16LE(40, 46);
  header.writeUInt32LE(1, 52);              // loaded
  header.writeUInt32LE(at, 56);
  header.writeUInt32LE(LOAD_AT, 60);
  header.writeUInt32LE(LOAD_AT, 64);
  header.writeUInt32LE(segment.length, 68);
  header.writeUInt32LE(segment.length, 72);
  header.writeUInt32LE(7, 76);
  header.writeUInt32LE(16, 80);
  const elf = Buffer.concat([header, segment]);
  return { elf, sha1: createHash('sha1').update(elf).digest('hex') };
}
