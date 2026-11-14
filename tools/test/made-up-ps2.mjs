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
const GIF_DMA = 0x1000A000, MADR = 0x10, QWC = 0x20, D_CTRL = 0x1000E000;

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
// the packet to the GIF, waiting until it's gone
const send = packet => [
  ...li(T0, GIF_DMA), sw(S1, MADR, T0), addiu(T1, ZERO, packet.length / 4), sw(T1, QWC, T0), addiu(T1, ZERO, 0x101), sw(T1, 0, T0),
  here('sending'), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, ZERO, 'sending'), NOP,
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
