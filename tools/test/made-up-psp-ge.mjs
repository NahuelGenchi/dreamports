// A small PlayStation Portable program with nothing from any game in it, written here, that draws through the console's
// graphics chip, for the tools' check of the kit's chip (psp-kit.mjs). Each frame it hands the chip three display lists
// of its own, kept in its file, and changes a few of their vertices first:
//
// A tiny list that only ends, whose end's interrupt comes while the program runs. Then the frame's main list, handed
// over stalled at its first command and let go a call later: the screen cleared, a square that moves two pixels a frame,
// a see-through rectangle blended over it, another blended and dithered, two in 16-bit colour by indices, one through a
// call that writes only some of each pixel's colour, a jump over a command that never runs, and a block of the screen
// copied by the chip, which takes it long enough that the program's wait for every list waits. Then a list of bars, as
// wide as what the system answered: the time as the frame's work started, the number the system gave the main list,
// the time after the wait for every list, and the time after the wait for this list the frame before, which waits too,
// as it copies a block of its own. So the picture shows when each wait ended, to the microsecond.
//
// Its lists start with ORIGIN, so what they name inside themselves is counted from where they are.

import { pspProgram, here, li, la, call, lui, ori, addiu, andi, or, sh, bne, j, NOP, ZERO, V0, A0, A1, A2, A3, T0, T1, S0, S1 } from './made-up-psp.mjs';

export const WIDTH = 480, HEIGHT = 272, LINE = 512;
/** The colours, as the console keeps them: red in the low byte. */
export const BACKGROUND = 0xFF602010, SQUARE = 0xFF10D0F0, GLASS = 0x80FFFFFF, DITHERED = 0x400000FF, GREEN_565 = 0x07E0, RED_565 = 0x001F, MASKED = 0xFF00FF00, BAR = 0xFFFFFFFF;
export const SQUARE_Y = 120, SQUARE_SIZE = 32, STEP = 2, TURN = 446;
/** The bars' lines, and how tall they are. */
export const BARS = [8, 16, 24, 32], BAR_HEIGHT = 4;

const G = (command, value = 0) => ((command << 24) | (value & 0xFFFFFF)) >>> 0;
// a vertex's format: in the screen's own coordinates, 16-bit positions, with a 32-bit colour, or a 16-bit one by an
// 8-bit index
export const VTYPE = 1 << 23 | 7 << 2 | 2 << 7, VTYPE_565 = 1 << 23 | 4 << 2 | 2 << 7 | 1 << 11;
const RECTANGLES = 6;
// a vertex of each format: its colour, then its place, 12 bytes and 8
const vertex = (color, x, y) => {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt32LE(color >>> 0, 0);
  bytes.writeInt16LE(x, 4);
  bytes.writeInt16LE(y, 6);
  return bytes;
};
const vertex565 = (color, x, y) => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt16LE(color, 0);
  bytes.writeInt16LE(x, 2);
  bytes.writeInt16LE(y, 4);
  return bytes;
};

// A list: its commands, each [command, value], with a value given as { at: name } the offset of `name` from the list's
// start, a label as { here: name }; then its blocks of bytes, each named. { words, at }: the list, and each name's offset.
function list(commands, blocks) {
  const at = {};
  let offset = 0;
  for (const item of commands) {
    if (item.here) at[item.here] = offset;
    else offset += 4;
  }
  const parts = [];
  for (const [name, bytes] of blocks) {
    offset = (offset + 3) & ~3;
    at[name] = offset;
    parts.push([offset, bytes]);
    offset += bytes.length;
  }
  const all = Buffer.alloc((offset + 3) & ~3);
  let word = 0;
  for (const item of commands) {
    if (item.here) continue;
    const [command, value] = item;
    all.writeUInt32LE(G(command, typeof value === 'object' ? at[value.at] : value), word * 4);
    word++;
  }
  for (const [where, bytes] of parts) bytes.copy(all, where);
  return { words: new Uint32Array(all.buffer, all.byteOffset, all.length / 4), at };
}

const DITHER = [[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]];
const ditherRow = row => row.reduce((word, value, x) => word | (value & 0xF) << (x * 4), 0);

/** The frame's main list, its vertices after it. */
export function mainList() {
  return list([
    [0x14, 0], [0x10, 0],                                         // ORIGIN, BASE
    [0x9C, 0], [0x9D, LINE], [0xD2, 3],                           // the framebuffer: video memory's start, 512 a line, 32 bits
    [0xD4, 0], [0xD5, (WIDTH - 1) | (HEIGHT - 1) << 10], [0x16, (WIDTH - 1) | (HEIGHT - 1) << 10],
    [0x12, VTYPE],
    [0xD3, 1 | 0x100 | 0x200], [0x01, { at: 'clear' }], [0x04, RECTANGLES << 16 | 2], [0xD3, 0],
    [0x01, { at: 'square' }], [0x04, RECTANGLES << 16 | 2],
    [0x21, 1], [0xDF, 2 | 3 << 4],                                // blended by the source's alpha
    [0x01, { at: 'glass' }], [0x04, RECTANGLES << 16 | 2],
    [0x20, 1], ...DITHER.map((row, y) => [0xE2 + y, ditherRow(row)]),
    [0x01, { at: 'dithered' }], [0x04, RECTANGLES << 16 | 2],
    [0x20, 0], [0x21, 0],
    [0x12, VTYPE_565], [0x02, { at: 'indices' }], [0x01, { at: 'sixteen' }], [0x04, RECTANGLES << 16 | 4],
    [0x12, VTYPE],
    [0x0A, { at: 'masked call' }], [0x08, { at: 'after' }],
    [0x04, RECTANGLES << 16 | 2],                                 // never run: jumped over
    { here: 'masked call' }, [0xE8, 0x0000FF], [0x01, { at: 'masked' }], [0x04, RECTANGLES << 16 | 2], [0xE8, 0], [0x0B, 0],
    { here: 'after' },
    // a block of the screen, 64 by 32, from the square's band to the bottom right
    [0xB2, 0], [0xB3, LINE | 0x040000], [0xEB, 8 | SQUARE_Y << 10], [0xB4, 0], [0xB5, LINE | 0x040000], [0xEC, 400 | 220 << 10], [0xEE, 63 | 31 << 10], [0xEA, 1],
    [0x0F, 0], [0x0C, 0],
    { here: 'end' },
  ], [
    ['clear', Buffer.concat([vertex(BACKGROUND, 0, 0), vertex(BACKGROUND, WIDTH, HEIGHT)])],
    ['square', Buffer.concat([vertex(SQUARE, 0, SQUARE_Y), vertex(SQUARE, SQUARE_SIZE, SQUARE_Y + SQUARE_SIZE)])],
    ['glass', Buffer.concat([vertex(GLASS, 100, 100), vertex(GLASS, 300, 170)])],
    ['dithered', Buffer.concat([vertex(DITHERED, 300, 60), vertex(DITHERED, 460, 110)])],
    ['sixteen', Buffer.concat([vertex565(GREEN_565, 80, 200), vertex565(GREEN_565, 120, 240), vertex565(RED_565, 20, 200), vertex565(RED_565, 60, 240)])],
    ['indices', Buffer.from([2, 3, 0, 1])],
    ['masked', Buffer.concat([vertex(MASKED, 200, 190), vertex(MASKED, 260, 250)])],
  ]);
}
/** The list of bars, as wide as what the program writes in them. */
export function barsList() {
  return list([
    [0x14, 0], [0x12, VTYPE], [0x01, { at: 'bars' }], [0x04, RECTANGLES << 16 | 8],
    // a block of the bars, 128 by 32, copied below the screen's middle
    [0xB2, 0], [0xB3, LINE | 0x040000], [0xEB, 0], [0xB4, 0], [0xB5, LINE | 0x040000], [0xEC, 300 | 150 << 10], [0xEE, 127 | 31 << 10], [0xEA, 1],
    [0x0F, 0], [0x0C, 0],
  ], [
    ['bars', Buffer.concat(BARS.flatMap(y => [vertex(BAR, 0, y), vertex(BAR, 1, y + BAR_HEIGHT)]))],
  ]);
}
/** The tiny list. */
export const tinyList = () => list([[0x0F, 0], [0x0C, 0]], []);

/** Where, in the bars' list, each bar's right edge is: the second vertex's place across. */
export const barEdge = index => barsList().at.bars + (index * 2 + 1) * 12 + 4;
/** Where the square's two corners' places across are, in the main list. */
export const squareEdges = () => [mainList().at.square + 4, mainList().at.square + 12 + 4];

// the program in stretches, each the instructions between two of the system's functions, whose cycles its Dreamport
// says after doing the same (psp-ge/main.c)
const STRETCHES = {
  mode: [addiu(A0, ZERO, 0), addiu(A1, ZERO, WIDTH), addiu(A2, ZERO, HEIGHT), ...call('sceDisplaySetMode')],
  framebuffer: [lui(A0, 0x4400), addiu(A1, ZERO, LINE), addiu(A2, ZERO, 3), addiu(A3, ZERO, 1), ...call('sceDisplaySetFrameBuf')],
  wait: [...call('sceDisplayWaitVblankStart')],
  time: [...call('sceKernelGetSystemTimeLow')],
  // the first bar, the square where it is now, and the tiny list handed over
  first: [
    andi(T1, V0, 0xFF), addiu(T1, T1, 1), ...la(T0, 'bars list'), sh(T1, barEdge(0), T0),
    ...la(T0, 'main list'), sh(S0, squareEdges()[0], T0), addiu(T1, S0, SQUARE_SIZE), sh(T1, squareEdges()[1], T0),
    ...la(A0, 'tiny list'), addiu(A1, ZERO, 0), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue'),
  ],
  // the main list, stalled at its first command
  main: [...la(A0, 'main list'), or(A1, A0, ZERO), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue')],
  // its number's bar, and the list let go to its end
  stall: [or(S1, V0, ZERO), andi(T1, V0, 0xFF), addiu(T1, T1, 1), ...la(T0, 'bars list'), sh(T1, barEdge(1), T0), or(A0, S1, ZERO), ...la(A1, 'main end'), ...call('sceGeListUpdateStallAddr')],
  draw: [addiu(A0, ZERO, 0), ...call('sceGeDrawSync')],
  // the third bar, and the bars' list handed over whole
  bars: [andi(T1, V0, 0xFF), addiu(T1, T1, 1), ...la(T0, 'bars list'), sh(T1, barEdge(2), T0), ...la(A0, 'bars list'), addiu(A1, ZERO, 0), addiu(A2, ZERO, -1), addiu(A3, ZERO, 0), ...call('sceGeListEnQueue')],
  sync: [or(A0, V0, ZERO), addiu(A1, ZERO, 0), ...call('sceGeListSync')],
  // the last bar, for the next frame
  last: [andi(T1, V0, 0xFF), addiu(T1, T1, 1), ...la(T0, 'bars list'), sh(T1, barEdge(3), T0)],
};
const count = items => items.filter(item => !item.here).length;
/** The cycles each stretch of the program's own instructions takes. */
export const CYCLES = {
  MODE: count(STRETCHES.mode), FRAMEBUFFER: count(STRETCHES.framebuffer), LOOP: 1,
  WAIT: count(STRETCHES.wait), TIME: count(STRETCHES.time), FIRST: count(STRETCHES.first), MAIN: count(STRETCHES.main), STALL: count(STRETCHES.stall),
  DRAW: count(STRETCHES.draw), BARS: count(STRETCHES.bars), SYNC: count(STRETCHES.sync),
  // the last bar, two pixels on, and back to the frame's start, with the turn's two more
  LAST: count(STRETCHES.last) + 4, TURNED: 2,
};

/** The program: { elf, at }. */
export function madeUpPspGe() {
  const main = mainList(), bars = barsList(), tiny = tinyList();
  const code = [
    ...STRETCHES.mode,
    ...STRETCHES.framebuffer,
    addiu(S0, ZERO, 0),
    here('frame'),
    ...STRETCHES.wait,
    ...STRETCHES.time,
    ...STRETCHES.first,
    ...STRETCHES.main,
    ...STRETCHES.stall,
    ...STRETCHES.draw,
    ...STRETCHES.time,
    ...STRETCHES.bars,
    ...STRETCHES.sync,
    ...STRETCHES.time,
    ...STRETCHES.last,
    addiu(S0, S0, STEP), addiu(T1, ZERO, TURN), bne(S0, T1, 'frame'), NOP,
    j('frame'), addiu(S0, ZERO, 0),
  ];
  // the main list's commands, and its vertices right after them, where the list's end is: the address it's let go to
  const ends = main.at.end / 4;
  const program = pspProgram({
    code,
    data: { 'main list': main.words.slice(0, ends), 'main end': main.words.slice(ends), 'bars list': bars.words, 'tiny list': tiny.words },
    imports: ['sceDisplaySetMode', 'sceDisplaySetFrameBuf', 'sceDisplayWaitVblankStart', 'sceKernelGetSystemTimeLow', 'sceGeListEnQueue', 'sceGeListUpdateStallAddr', 'sceGeDrawSync', 'sceGeListSync'],
  });
  if (program.at['main end'] !== program.at['main list'] + main.at.end) throw new Error('The main list\'s vertices aren\'t right after its commands.');
  return program;
}
