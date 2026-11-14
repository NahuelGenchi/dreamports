// A small PlayStation 2 program with nothing from any game in it, written here, for the console's real emulator to run in
// the tools' check of it (real-ps2.mjs). It asks the console for an NTSC screen, 640 by 448, and each V-blank draws it
// through the GS: a blue background and a yellow square that moves two pixels a frame, from the left edge to the right and
// back after 512. It has no sound and reads no buttons, as both go through the console's second processor, which a program
// this small doesn't start. It runs straight from its ELF file, as the emulator's own stand-in for the console's BIOS
// starts one, so no file of the console's is needed.

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

function program(packetAt) {
  // where the square's first corner's value is in the packet, after the tag
  const corner = 16 + SQUARE_AT * 16;
  return [
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
    addiu(S0, ZERO, 0), ...li(S1, packetAt),
    here('frame'),
    // wait for the V-blank to start
    ...li(T0, GS | CSR), addiu(T1, ZERO, 8), sw(T1, 0, T0),
    here('wait'), lw(T1, 0, T0), andi(T1, T1, 8), beq(T1, ZERO, 'wait'), NOP,
    // the square's corners, where it is this frame
    sll(T1, S0, 4), ...li(T2, SQUARE_Y << 20), or(T1, T1, T2), sw(T1, corner, S1),
    addiu(T1, S0, SQUARE_SIZE), sll(T1, T1, 4), ...li(T2, (SQUARE_Y + SQUARE_SIZE) << 20), or(T1, T1, T2), sw(T1, corner + 16, S1),
    // the packet to the GIF, waiting until it's gone
    ...li(T0, GIF_DMA), sw(S1, MADR, T0), addiu(T1, ZERO, PACKET.length / 4), sw(T1, QWC, T0), addiu(T1, ZERO, 0x101), sw(T1, 0, T0),
    here('sending'), lw(T3, 0, T0), andi(T3, T3, 0x100), bne(T3, ZERO, 'sending'), NOP,
    // two pixels on, and back to the left edge after 512
    addiu(S0, S0, STEP), andi(S0, S0, 511),
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
export function madeUpPs2() {
  // the code, then the packet on a 16-byte boundary, as the DMA controller reads it
  const codeWords = program(0).length - program(0).filter(item => item.here).length;
  const packetAt = LOAD_AT + Math.ceil(codeWords * 4 / 16) * 16;
  const code = assemble(program(packetAt));
  const body = new Uint32Array((packetAt - LOAD_AT) / 4 + PACKET.length);
  body.set(code);
  body.set(PACKET, (packetAt - LOAD_AT) / 4);
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
