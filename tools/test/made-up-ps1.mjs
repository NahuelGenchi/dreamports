// A small PlayStation program with nothing from any game in it, written here, for the tools' tests of the PlayStation:
// a program the console could boot, as a PS-X EXE, whose functions each do one thing the tools have to see. Its
// instructions are written as their words, with the few lines below that make them, so the tests need no assembler,
// and as the console's compiler writes them: a loaded register is used no sooner than the instruction after the next,
// as the processor's load delay asks.
//
// Its functions, in order, from where it loads:
//   start      the entry: sets the stack, calls main, and waits for ever
//   main       calls sum, fill, twice and lookup, and then each function in its table, through a pointer
//   sum        a0 + a1
//   fill       writes a1 bytes of a2 from a0, in a loop
//   lookup     the a0th word of its table of values
//   twice      sum(a0, a0), through a call, with a stack of its own
//   bios       goes to the BIOS's calls, at 0xA0, as a game asks the BIOS for work
//   forever    a loop that never ends
//   misaligned reads a word where none starts
//   hardware   writes the scratchpad and a register of the sound chip
//   gte        puts a0 in the geometry processor and takes it back
//   pick       a switch on a0, through a table of its cases
// and after the program's values:
//   shine      reached only through the table of functions, with a stack of its own

/** Where the program loads and starts, and where its values and its table of functions are. */
export const LOAD = 0x80010000;
export const STACK = 0x801FFF00;

const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, t2: 10, t3: 11, s0: 16, gp: 28, sp: 29, fp: 30, ra: 31 };
const i = (op, rs, rt, imm) => ((op << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xFFFF)) >>> 0;
const r = (rs, rt, rd, sa, fn) => ((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (sa << 6) | fn) >>> 0;
const nop = 0;
const addu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x21);
const addiu = (rt, rs, imm) => i(9, rs, rt, imm);
const ori = (rt, rs, imm) => i(13, rs, rt, imm);
const lui = (rt, imm) => i(15, 'zero', rt, imm);
const sltiu = (rt, rs, imm) => i(11, rs, rt, imm);
const sll = (rd, rt, sa) => r('zero', rt, rd, sa, 0);
const jr = rs => r(rs, 'zero', 'zero', 0, 8);
const jalr = rs => r(rs, 'zero', 'ra', 0, 9);
const lw = (rt, offset, base) => i(0x23, base, rt, offset);
const sw = (rt, offset, base) => i(0x2B, base, rt, offset);
const sh = (rt, offset, base) => i(0x29, base, rt, offset);
const sb = (rt, offset, base) => i(0x28, base, rt, offset);
const mtc2 = (rt, rd) => ((0x12 << 26) | (4 << 21) | (R[rt] << 16) | (rd << 11)) >>> 0;
const mfc2 = (rt, rd) => ((0x12 << 26) | (R[rt] << 16) | (rd << 11)) >>> 0;
// what needs to know where things are: a branch to a label, a call, and the two halves of an address
const beq = (rs, rt, label) => ({ at: (labels, pc) => i(4, rs, rt, (labels[label] - pc - 4) >> 2) });
const b = label => beq('zero', 'zero', label);
const jal = label => ({ at: labels => ((3 << 26) | ((labels[label] >>> 2) & 0x3FFFFFF)) >>> 0 });
const hi = (rt, label) => ({ at: labels => lui(rt, (labels[label] + 0x8000) >>> 16) });
const lo = (rt, rs, label) => ({ at: labels => addiu(rt, rs, labels[label] & 0xFFFF) });
const lwLo = (rt, rs, label) => ({ at: labels => lw(rt, labels[label] & 0xFFFF, rs) });
const here = name => ({ name });
const pointer = label => ({ at: labels => labels[label] >>> 0 });

/** The program's values, read by lookup. */
export const VALUES = [0x11111111, 0x22222222, 0x33333333, 0x44444444];

const PROGRAM = [
  here('start'), lui('sp', STACK >>> 16), ori('sp', 'sp', STACK & 0xFFFF), jal('main'), nop, here('spin'), b('spin'), nop,
  here('main'), addiu('sp', 'sp', -32), sw('ra', 24, 'sp'), sw('s0', 20, 'sp'),
  addiu('a0', 'zero', 2), jal('sum'), addiu('a1', 'zero', 3),
  hi('a0', 'buffer'), lo('a0', 'a0', 'buffer'), addiu('a1', 'zero', 4), jal('fill'), addiu('a2', 'zero', 0x5A),
  jal('twice'), addiu('a0', 'zero', 21), jal('lookup'), addiu('a0', 'zero', 1),
  hi('s0', 'functions'), lo('s0', 's0', 'functions'), lw('t0', 0, 's0'), nop, jalr('t0'), nop,
  lw('s0', 20, 'sp'), lw('ra', 24, 'sp'), nop, jr('ra'), addiu('sp', 'sp', 32),
  here('sum'), jr('ra'), addu('v0', 'a0', 'a1'),
  here('fill'), here('fill_loop'), beq('a1', 'zero', 'fill_done'), nop, sb('a2', 0, 'a0'), addiu('a0', 'a0', 1), b('fill_loop'), addiu('a1', 'a1', -1),
  here('fill_done'), jr('ra'), nop,
  here('lookup'), hi('t0', 'values'), lo('t0', 't0', 'values'), sll('t1', 'a0', 2), addu('t0', 't0', 't1'), lw('v0', 0, 't0'), jr('ra'), nop,
  here('twice'), addiu('sp', 'sp', -24), sw('ra', 16, 'sp'), jal('sum'), addu('a1', 'a0', 'zero'), lw('ra', 16, 'sp'), nop, jr('ra'), addiu('sp', 'sp', 24),
  here('bios'), addiu('t2', 'zero', 0xA0), jr('t2'), addiu('t1', 'zero', 0x3F),
  here('forever'), b('forever'), nop,
  here('misaligned'), lw('v0', 1, 'a0'), jr('ra'), nop,
  here('hardware'), lui('t0', 0x1F80), sw('a0', 0x10, 't0'), sh('a0', 0x1C00, 't0'), jr('ra'), nop,
  here('gte'), mtc2('a0', 25), nop, mfc2('v0', 25), nop, jr('ra'), nop,
  here('pick'), sltiu('t0', 'a0', 3), beq('t0', 'zero', 'pick_else'), sll('t0', 'a0', 2), hi('at', 'cases'), addu('at', 'at', 't0'), lwLo('t0', 'at', 'cases'), nop, jr('t0'), nop,
  here('pick_0'), jr('ra'), addiu('v0', 'zero', 10),
  here('pick_1'), jr('ra'), addiu('v0', 'zero', 20),
  here('pick_2'), jr('ra'), addiu('v0', 'zero', 30),
  here('pick_else'), jr('ra'), addiu('v0', 'zero', 0),
  here('values'), ...VALUES,
  here('cases'), pointer('pick_0'), pointer('pick_1'), pointer('pick_2'),
  here('shine'), addiu('sp', 'sp', -8), sw('a0', 0, 'sp'), addiu('v0', 'zero', 1), jr('ra'), addiu('sp', 'sp', 8),
  here('functions'), pointer('shine'),
  here('buffer'), 0, 0,
  here('end'),
];

/** The functions, in order, each with the name of the label it starts at. */
export const FUNCTIONS = ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'bios', 'forever', 'misaligned', 'hardware', 'gte', 'pick', 'shine'];
// what isn't code: the values, the switch's table, the table of functions and the buffer
const DATA = ['values', 'cases', 'functions', 'buffer', 'end'];

/** The program as words, from LOAD, and where each label is. */
export function madeUpProgram() {
  const labels = {};
  let pc = LOAD;
  for (const item of PROGRAM) {
    if (item.name) labels[item.name] = pc;
    else pc += 4;
  }
  const words = [];
  pc = LOAD;
  for (const item of PROGRAM) {
    if (item.name) continue;
    words.push(typeof item === 'number' ? item >>> 0 : item.at(labels, pc));
    pc += 4;
  }
  // each function's address and size, to the next function or values after it
  const after = [...FUNCTIONS, ...DATA].map(name => labels[name]).sort((a, b) => a - b);
  const functions = FUNCTIONS.map(name => ({ name, address: labels[name], size: after.find(at => at > labels[name]) - labels[name] }));
  return { words, labels, functions };
}

/** The program as the console boots it: a PS-X EXE, its header of 2 KB and then its code and values. */
export function madeUpExe() {
  const { words, labels, functions } = madeUpProgram();
  const text = Buffer.alloc(Math.ceil(words.length * 4 / 2048) * 2048);
  words.forEach((word, n) => text.writeUInt32LE(word, n * 4));
  const header = Buffer.alloc(2048);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(labels.start, 0x10);
  header.writeUInt32LE(0, 0x14);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(text.length, 0x1C);
  header.writeUInt32LE(STACK, 0x30);
  header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
  return { exe: Buffer.concat([header, text]), labels, functions };
}

// A second program, for the PlayStation's kit (ps1-kit.mjs): it sets up the screen as a game does, 320 by 240 from
// video memory's corner, and every V-blank fills it with the background and draws a square that moves STEP pixels a
// frame, round and round, written in the assembly the tools assemble (../ps1/assemble.mjs), with interrupts off so it
// waits for the V-blank by watching for it. The V-blank the BIOS left marked is cleared first, so it draws its first
// frame after the first V-blank of its own, and the console shows it a frame later, as `prove` expects.

/** What the program draws, in the GPU's colours of 8 bits a channel, blue highest. */
export const GPU = { BACKGROUND: 0x402010, SQUARE: 0x00C0F0, SQUARE_Y: 100, SIZE: 32, STEP: 2 };

/** The program as the console boots it: a PS-X EXE. */
export async function madeUpGpuExe() {
  const { assemble } = await import('../ps1/assemble.mjs');
  const { BACKGROUND, SQUARE, SQUARE_Y, SIZE, STEP } = GPU;
  const made = assemble(`
	.set noreorder
start:
	mtc0	$zero, $12
	lui	$t0, 0x1F80
	sw	$zero, 0x1074($t0)
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	sw	$zero, 0x1814($t0)
	li	$t1, 0x08000001
	sw	$t1, 0x1814($t0)
	li	$t1, 0x06C60260
	sw	$t1, 0x1814($t0)
	li	$t1, 0x07040010
	sw	$t1, 0x1814($t0)
	li	$t1, 0x05000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0x03000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0xE3000000
	sw	$t1, 0x1810($t0)
	li	$t1, 0xE403BD3F
	sw	$t1, 0x1810($t0)
	li	$t1, 0xE5000000
	sw	$t1, 0x1810($t0)
	move	$s0, $zero
wait:
	lw	$t1, 0x1070($t0)
	nop
	andi	$t1, $t1, 1
	beqz	$t1, wait
	nop
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	li	$t1, ${0x02000000 | BACKGROUND}
	sw	$t1, 0x1810($t0)
	sw	$zero, 0x1810($t0)
	li	$t1, ${240 << 16 | 320}
	sw	$t1, 0x1810($t0)
	li	$t1, ${0x60000000 | SQUARE}
	sw	$t1, 0x1810($t0)
	lui	$t2, ${SQUARE_Y}
	or	$t2, $t2, $s0
	sw	$t2, 0x1810($t0)
	li	$t1, ${SIZE << 16 | SIZE}
	sw	$t1, 0x1810($t0)
	addiu	$s0, $s0, ${STEP}
	andi	$s0, $s0, 0xFF
	b	wait
	nop
`);
  const text = Buffer.alloc(2048);
  Buffer.from(made.sections.get('.text').bytes).copy(text);
  const header = Buffer.alloc(2048);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(LOAD, 0x10);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(text.length, 0x1C);
  header.writeUInt32LE(STACK, 0x30);
  header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
  return Buffer.concat([header, text]);
}

/** What the program for memories of play sets as it starts, and where: a level, and a count it makes in memory that
 *  only play has, which each frame adds BY to. */
export const PLAY = { LEVEL: 0x1234, LEVEL_AT: 0x80030000, COUNT_AT: 0x80100000, START: 100, BY: 5, LEVEL_FN: 0x80010100, ADD_FN: 0x80010200 };

/** A program whose functions read what only play sets up, for the function check's memories of play: it sets a level
 *  and makes a count, then each frame calls Level(), which gives the level one up, and Add(count, BY), which adds to
 *  the count. As the console boots it: a PS-X EXE. */
export async function madeUpPlayExe() {
  const { assemble } = await import('../ps1/assemble.mjs');
  const { LEVEL, LEVEL_AT, COUNT_AT, START, BY, LEVEL_FN, ADD_FN } = PLAY;
  const words = source => assemble(`.set noreorder\n${source}`).sections.get('.text').bytes;
  const start = words(`
	mtc0	$zero, $12
	lui	$t0, 0x1F80
	sw	$zero, 0x1074($t0)
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	lui	$s1, ${LEVEL_AT >>> 16}
	li	$t1, ${LEVEL}
	sw	$t1, 0($s1)
	lui	$s2, ${COUNT_AT >>> 16}
	li	$t1, ${START}
	sw	$t1, 0($s2)
wait:
	lw	$t1, 0x1070($t0)
	nop
	andi	$t1, $t1, 1
	beqz	$t1, wait
	nop
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	jal	${LEVEL_FN}
	nop
	move	$a0, $s2
	jal	${ADD_FN}
	li	$a1, ${BY}
	b	wait
	nop
`);
  const level = words(`
	lui	$v0, ${LEVEL_AT >>> 16}
	lw	$v0, 0($v0)
	nop
	jr	$ra
	addiu	$v0, $v0, 1
`);
  const add = words(`
	lw	$v0, 0($a0)
	nop
	addu	$v0, $v0, $a1
	jr	$ra
	sw	$v0, 0($a0)
`);
  const text = Buffer.alloc(2048);
  text.set(start, 0);
  text.set(level, LEVEL_FN - LOAD);
  text.set(add, ADD_FN - LOAD);
  const header = Buffer.alloc(2048);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(LOAD, 0x10);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(text.length, 0x1C);
  header.writeUInt32LE(STACK, 0x30);
  header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
  return Buffer.concat([header, text]);
}

// a vertex, a colour and a texture's place as GP0 takes them: y and x of 16 bits each, red lowest, and v and u
const xy = (x, y) => ((y & 0xFFFF) << 16 | (x & 0xFFFF)) >>> 0;
const rgb = (r, g, b) => (b << 16 | g << 8 | r) >>> 0;
const uv = (u, v, high = 0) => ((high & 0xFFFF) << 16 | v << 8 | u) >>> 0;
// a texture page, for E1 or a polygon's second corner: its x in 64s, its y in 256s, the mixing and the colours' depth
const page = (x, y, depth, mixing = 0) => ((x / 64) | (y / 256) << 4 | mixing << 5 | depth << 7) >>> 0;
// where a colour table is, for a polygon's first corner: its x in 16s and its y
const clut = (x, y) => (y << 6 | x / 16) >>> 0;
// a picture moved into video memory, its pixels two to a word
const picture = (x, y, w, h, pixel) => {
  const words = [0xA0000000, xy(x, y), (h << 16 | w) >>> 0];
  for (let n = 0; n < w * h; n += 2) words.push((pixel(n % w, Math.floor(n / w)) | pixel((n + 1) % w, Math.floor((n + 1) / w)) << 16) >>> 0);
  return words;
};

/**
 * What the drawing program sends the GPU, of the project's own: `setup`, once, three textures and two colour tables
 * moved into video memory, and `frame`, every frame, after a drawing offset that moves with the frame: a background,
 * flat and shaded triangles, quads and lines, a line through many points, the four ways of mixing, dithering, textures
 * of 16, 8 and 4 bits, a quad that lines up with its texture and one that doesn't, rectangles, a texture window and
 * the mask bit.
 */
export function drawList() {
  const setup = [
    // 16-bit, at 512,0: a pattern of colours, its corners clear (0 isn't drawn) and its middle row half see-through
    ...picture(512, 0, 16, 16, (x, y) => (x === 0 && y === 0) || (x === 15 && y === 15) ? 0 : ((x * 2) | (y * 2) << 5 | ((x + y) & 31) << 10 | (y === 8 ? 0x8000 : 0))),
    // 4-bit, at 576,0, 16 texels wide in 4 pixels, and its colour table at 0,480
    ...picture(576, 0, 4, 16, (x, y) => [0, 1, 2, 3].reduce((word, k) => word | ((x * 4 + k + y) & 15) << (4 * k), 0)),
    ...picture(0, 480, 16, 1, x => (x === 0 ? 0 : (31 - x * 2) | (x * 2) << 5 | 16 << 10)),
    // 8-bit, at 640,0, 16 texels wide in 8 pixels, and its colour table at 0,481
    ...picture(640, 0, 8, 16, (x, y) => [0, 1].reduce((word, k) => word | ((x * 2 + k) * 16 + y * 3 & 255) << (8 * k), 0)),
    ...picture(0, 481, 256, 1, x => (x & 31) | (x >> 3 & 31) << 5 | (31 - (x & 31)) << 10 | (x % 7 === 0 ? 0x8000 : 0)),
  ];
  const frame = [
    0xE1000000, 0xE6000000,
    0x02000000 | rgb(40, 24, 64), xy(0, 0), xy(320, 240),
    // flat: a triangle, and a quad
    0x20000000 | rgb(200, 40, 40), xy(10, 10), xy(70, 20), xy(30, 60),
    0x28000000 | rgb(40, 200, 40), xy(80, 10), xy(130, 14), xy(84, 50), xy(126, 58),
    // shaded, with dithering: a triangle, and a quad
    0xE1000200,
    0x30000000 | rgb(255, 0, 0), xy(140, 10), 0x00FF00, xy(200, 30), rgb(0, 0, 255), xy(150, 70),
    0x38000000 | rgb(250, 250, 0), xy(210, 10), rgb(0, 250, 250), xy(260, 10), rgb(250, 0, 250), xy(210, 60), rgb(20, 20, 20), xy(262, 64),
    // the four ways of mixing, each a see-through flat triangle over the shaded quad's corner
    0xE1000200, 0x22000000 | rgb(120, 120, 120), xy(250, 40), xy(280, 40), xy(250, 70),
    0xE1000220, 0x22000000 | rgb(60, 90, 30), xy(255, 45), xy(285, 45), xy(255, 75),
    0xE1000240, 0x22000000 | rgb(60, 30, 90), xy(260, 50), xy(290, 50), xy(260, 80),
    0xE1000260, 0x22000000 | rgb(200, 120, 40), xy(265, 55), xy(295, 55), xy(265, 85),
    0xE1000000,
    // lines: flat, shaded, see-through, and through many points, flat and shaded
    0x40000000 | rgb(255, 255, 255), xy(10, 80), xy(120, 95),
    0x50000000 | rgb(255, 0, 0), xy(10, 100), rgb(0, 0, 255), xy(120, 130),
    0xE1000220, 0x42000000 | rgb(0, 120, 255), xy(10, 120), xy(60, 70), 0xE1000000,
    0x48000000 | rgb(255, 200, 0), xy(130, 80), xy(170, 90), xy(150, 120), xy(190, 125), 0x55555555,
    0x58000000 | rgb(0, 255, 0), xy(200, 80), rgb(255, 0, 255), xy(240, 100), rgb(0, 255, 255), xy(220, 130), 0x55555555,
    // textures: a 16-bit triangle, an 8-bit quad that lines up with its texture and one that's turned, a shaded 4-bit
    // triangle with dithering, a raw one, and a see-through one
    0x24000000 | rgb(128, 128, 128), xy(10, 140), uv(0, 0, clut(0, 480)), xy(60, 140), uv(15, 0, page(512, 0, 2)), xy(10, 190), uv(0, 15),
    0x2C000000 | rgb(128, 128, 128), xy(70, 140), uv(0, 0, clut(0, 481)), xy(86, 140), uv(16, 0, page(640, 0, 1)), xy(70, 156), uv(0, 16), xy(86, 156), uv(16, 16),
    0x2C000000 | rgb(100, 160, 128), xy(95, 140), uv(0, 0, clut(0, 481)), xy(130, 148), uv(15, 0, page(640, 0, 1)), xy(90, 175), uv(0, 15), xy(126, 184), uv(15, 15),
    0xE1000200,
    0x34000000 | rgb(255, 128, 64), xy(140, 140), uv(0, 0, clut(0, 480)), rgb(64, 128, 255), xy(190, 150), uv(15, 0, page(576, 0, 0)), rgb(128, 255, 128), xy(150, 195), uv(0, 15),
    0xE1000000,
    0x25000000 | rgb(0, 0, 0), xy(195, 140), uv(0, 0, clut(0, 480)), xy(235, 145), uv(15, 0, page(576, 0, 0)), xy(200, 180), uv(0, 15),
    0x26000000 | rgb(128, 128, 128), xy(240, 140), uv(0, 0, clut(0, 480)), xy(285, 140), uv(15, 0, page(512, 0, 2, 1)), xy(260, 190), uv(8, 15),
    // rectangles: textured, of their own size and of 8 and 16, through a texture window, and flat of 1 and 8
    0xE1000000 | page(512, 0, 2),
    0x64000000 | rgb(128, 128, 128), xy(10, 200), uv(0, 0, clut(0, 480)), xy(24, 12),
    0x74000000 | rgb(200, 100, 100), xy(40, 200), uv(4, 4, clut(0, 480)),
    0x7C000000 | rgb(128, 128, 128), xy(55, 200), uv(0, 0, clut(0, 480)),
    0xE2000000 | 0x21 | 0x2 << 10, 0x64000000 | rgb(128, 128, 128), xy(80, 200), uv(0, 0, clut(0, 480)), xy(30, 20), 0xE2000000,
    0x68000000 | rgb(255, 255, 255), xy(120, 205),
    0x70000000 | rgb(255, 255, 0), xy(125, 205),
    // the mask bit: a rectangle drawn with it set, and a triangle over it that leaves what has it
    0xE6000001, 0x60000000 | rgb(0, 80, 160), xy(140, 200), xy(30, 20),
    0xE6000002, 0x20000000 | rgb(255, 255, 255), xy(135, 195), xy(185, 210), xy(150, 225),
    0xE6000000, 0xE1000000,
  ].map(word => word >>> 0);
  return { setup, frame };
}

/** A program that sends drawList() to the GPU, as the console boots it: a PS-X EXE, its words after its code. Each
 *  frame waits for the V-blank, sets the drawing offset to the frame's count, x by one a frame up to 63 and y by one
 *  every two up to 31, and sends the frame's words. */
export async function madeUpDrawExe() {
  const { assemble } = await import('../ps1/assemble.mjs');
  const { setup, frame } = drawList();
  const SETUP_AT = LOAD + 0x400, FRAME_AT = SETUP_AT + setup.length * 4;
  const made = assemble(`
	.set noreorder
start:
	mtc0	$zero, $12
	lui	$t0, 0x1F80
	sw	$zero, 0x1074($t0)
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	sw	$zero, 0x1814($t0)
	li	$t1, 0x08000001
	sw	$t1, 0x1814($t0)
	li	$t1, 0x06C60260
	sw	$t1, 0x1814($t0)
	li	$t1, 0x07040010
	sw	$t1, 0x1814($t0)
	li	$t1, 0x05000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0x03000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0xE3000000
	sw	$t1, 0x1810($t0)
	li	$t1, 0xE403BD3F
	sw	$t1, 0x1810($t0)
	li	$t3, ${SETUP_AT}
	li	$t4, ${setup.length}
setup:
	lw	$t1, 0($t3)
	addiu	$t3, $t3, 4
	addiu	$t4, $t4, -1
	sw	$t1, 0x1810($t0)
	bnez	$t4, setup
	nop
	move	$s0, $zero
wait:
	lw	$t1, 0x1070($t0)
	nop
	andi	$t1, $t1, 1
	beqz	$t1, wait
	nop
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	andi	$t2, $s0, 63
	srl	$t5, $s0, 1
	andi	$t5, $t5, 31
	sll	$t5, $t5, 11
	or	$t2, $t2, $t5
	lui	$t5, 0xE500
	or	$t2, $t2, $t5
	sw	$t2, 0x1810($t0)
	li	$t3, ${FRAME_AT}
	li	$t4, ${frame.length}
draw:
	lw	$t1, 0($t3)
	addiu	$t3, $t3, 4
	addiu	$t4, $t4, -1
	sw	$t1, 0x1810($t0)
	bnez	$t4, draw
	nop
	addiu	$s0, $s0, 1
	b	wait
	nop
`);
  const code = Buffer.from(made.sections.get('.text').bytes);
  if (code.length > 0x400) throw new Error('The drawing program\'s code is longer than the room before its words.');
  const size = Math.ceil((0x400 + (setup.length + frame.length) * 4) / 2048) * 2048, text = Buffer.alloc(size);
  code.copy(text);
  [...setup, ...frame].forEach((word, n) => text.writeUInt32LE(word, 0x400 + n * 4));
  const header = Buffer.alloc(2048);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(LOAD, 0x10);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(text.length, 0x1C);
  header.writeUInt32LE(STACK, 0x30);
  header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
  return Buffer.concat([header, text]);
}

// The sound program's own sounds, in the chip's ADPCM, 16 bytes a block: a shift and a filter, flags, and 28 samples
// of 4 bits each, the low half of a byte first. Filter 0 takes each sample as it is, shifted up 12 bits and down
// `shift`. Flags: 4 where a loop starts, 3 where it ends and goes back, 1 where a sound ends.
function adpcm(samples, shift, flagsOf) {
  const bytes = [];
  for (let block = 0; block < samples.length / 28; block++) {
    bytes.push(shift, flagsOf(block));
    for (let k = 0; k < 28; k += 2) bytes.push((samples[block * 28 + k] & 15) | (samples[block * 28 + k + 1] & 15) << 4);
  }
  const halves = [];
  for (let k = 0; k < bytes.length; k += 2) halves.push(bytes[k] | bytes[k + 1] << 8);
  return halves;
}

/** Where the sound program puts its sounds in the chip's memory: a tone and a square that loop, moved there by DMA,
 *  and a click that doesn't, written a halfword at a time; and the reverb's own memory, from REVERB on. */
export const SOUND = { TONE_AT: 0x5000, SQUARE_AT: 0x5020, CLICK_AT: 0x6000, REVERB: 0x78000, BACKGROUND: 0x102030, BAR: 0x30C0F0 };

/**
 * What the sound program gives the sound chip, of the project's own: `loops`, a tone and a square of two blocks each
 * that loop, moved in by DMA, `click`, four blocks of a sound that fades and ends, written a halfword at a time, and
 * `script`, each write to the chip's registers and the frame it comes on, as two words: the frame and the register's
 * address in the processor's top 64 KB, and the value. Frame 0 sets six voices up, each with its sound, volumes,
 * pitch and envelope, the reverb, noise on one voice and one voice's pitch moved by another's; the frames after key
 * voices on and off, bend a pitch, sweep a volume, turn the master volume down and the reverb off.
 */
export function soundList() {
  const tone = Array.from({ length: 56 }, (_, k) => Math.round(7 * Math.sin(2 * Math.PI * k / 56)));
  const square = Array.from({ length: 56 }, (_, k) => (k < 28 ? 5 : -5));
  let seed = 0x5EED;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return ((seed >>> 16) & 0x7FFF) / 0x4000 - 1;
  };
  const click = Array.from({ length: 112 }, (_, k) => Math.round(7 * random() * Math.exp(-k / 30)));
  const looping = block => (block === 0 ? 4 : 3);
  const loops = [...adpcm(tone, 2, looping), ...adpcm(square, 2, looping)];
  const clickHalves = adpcm(click, 1, block => (block === 3 ? 1 : 0));

  const writes = [];
  const at = (frame, register, value) => writes.push([frame, 0x1C00 + register, value & 0xFFFF]);
  const voice = (v, register, value, frame = 0) => at(frame, v * 0x10 + register, value);
  const { TONE_AT, SQUARE_AT, CLICK_AT, REVERB } = SOUND;
  // master volume, the reverb's memory and its settings, then the chip on, with the reverb and noise's clock
  at(0, 0x180, 0x3FFF); at(0, 0x182, 0x3FFF);
  at(0, 0x1A2, REVERB >> 3);
  const reverb = [0x0040, 0x0020, 0x5800, 0x4400, 0xC800, 0x3400, 0xD400, 0x2800, 0x5000, 0xB000, 0x0700, 0x0680, 0x0600, 0x0580, 0x0500, 0x0480,
    0x0400, 0x0380, 0x0340, 0x0300, 0x02C0, 0x0280, 0x0240, 0x0200, 0x01C0, 0x0180, 0x0140, 0x0100, 0x00C0, 0x0080, 0x6000, 0x6000];
  reverb.forEach((value, k) => at(0, 0x1C0 + k * 2, value));
  at(0, 0x184, 0x3000); at(0, 0x186, 0x3000);
  at(0, 0x1AA, 0xE680);
  // each voice: its volumes, pitch, sound and envelope
  const voices = [
    [0x3000, 0x3000, 0x1000, TONE_AT, 0x108A, 0xD82C],
    [0x2800, 0x1400, 0x0800, TONE_AT, 0x50F4, 0x1FC4],
    [0x3FFF, 0x3FFF, 0x1000, CLICK_AT, 0x000F, 0x1FC0],
    [0x3800, 0x3800, 0x1000, TONE_AT, 0x000F, 0x1FC8],
    [0x2000, 0x2000, 0x0200, SQUARE_AT, 0x000F, 0x1FC4],
    [0x2800, 0x2000, 0x1000, TONE_AT, 0x000F, 0x1FC4],
  ];
  voices.forEach(([left, right, pitch, sound, low, high], v) => {
    voice(v, 0x0, left); voice(v, 0x2, right); voice(v, 0x4, pitch); voice(v, 0x6, sound >> 3); voice(v, 0x8, low); voice(v, 0xA, high);
  });
  // the reverb on voices 0 and 2, noise on 3, and 5's pitch moved by 4's
  at(0, 0x198, 0x0005); at(0, 0x194, 0x0008); at(0, 0x190, 0x0020);
  // what happens later: keys on (0x188) and off (0x18C), never both on one frame for one voice
  at(10, 0x188, 0x0001);
  for (let frame = 20, k = 0; frame < 200; frame += 6, k++) voice(0, 0x4, [0x1000, 0x10C0, 0x1000, 0x0F40][k % 4], frame);
  at(30, 0x188, 0x0002);
  for (const frame of [50, 90, 130, 170, 210, 250]) at(frame, 0x188, 0x0004);
  at(60, 0x188, 0x0030);
  at(100, 0x188, 0x0008);
  at(140, 0x18C, 0x0008);
  at(150, 0x18C, 0x0002);
  at(180, 0x188, 0x0002);
  at(200, 0x18C, 0x0001);
  at(220, 0x180, 0x2000); at(220, 0x182, 0x2000);
  voice(1, 0x0, 0xA040, 230); voice(1, 0x8, 0x20F8, 230);
  at(240, 0x18C, 0x0030);
  at(260, 0x1AA, 0xE600);
  at(270, 0x18C, 0xFFFF); at(270, 0x18E, 0x00FF);
  writes.sort((a, b) => a[0] - b[0]);
  const script = writes.flatMap(([frame, register, value]) => [(frame << 16 | register) >>> 0, value]);
  script.push(0xFFFF0000, 0);
  return { loops, click: clickHalves, script };
}

/** A program that plays soundList() on the sound chip, as the console boots it: a PS-X EXE, its words after its code.
 *  It sets up the screen, turns the chip on, moves the tone and the square into its memory by DMA, waiting for the
 *  move to end, and writes the click a halfword at a time; then each frame waits for the V-blank, draws a bar that
 *  moves a pixel a frame, and makes the script's writes for the frame. */
export async function madeUpSoundExe() {
  const { assemble } = await import('../ps1/assemble.mjs');
  const { loops, click, script } = soundList();
  const { TONE_AT, CLICK_AT, BACKGROUND, BAR } = SOUND;
  const SCRIPT_AT = LOAD + 0x400, LOOPS_AT = SCRIPT_AT + script.length * 4, CLICK_RAM = LOOPS_AT + loops.length * 2;
  const made = assemble(`
	.set noreorder
start:
	mtc0	$zero, $12
	lui	$t0, 0x1F80
	sw	$zero, 0x1074($t0)
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	sw	$zero, 0x1814($t0)
	li	$t1, 0x08000001
	sw	$t1, 0x1814($t0)
	li	$t1, 0x06C60260
	sw	$t1, 0x1814($t0)
	li	$t1, 0x07040010
	sw	$t1, 0x1814($t0)
	li	$t1, 0x05000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0x03000000
	sw	$t1, 0x1814($t0)
	li	$t1, 0xE3000000
	sw	$t1, 0x1810($t0)
	li	$t1, 0xE403BD3F
	sw	$t1, 0x1810($t0)
	li	$t1, 0xE5000000
	sw	$t1, 0x1810($t0)
	li	$t1, 0xC000
	sh	$t1, 0x1DAA($t0)
	li	$t1, ${TONE_AT >> 3}
	sh	$t1, 0x1DA6($t0)
	li	$t1, 4
	sh	$t1, 0x1DAC($t0)
	li	$t1, 0xC020
	sh	$t1, 0x1DAA($t0)
	lw	$t1, 0x10F0($t0)
	lui	$t2, 0x0008
	or	$t1, $t1, $t2
	sw	$t1, 0x10F0($t0)
	li	$t1, ${LOOPS_AT}
	sw	$t1, 0x10C0($t0)
	li	$t1, ${1 << 16 | loops.length / 2}
	sw	$t1, 0x10C4($t0)
	li	$t1, 0x01000201
	sw	$t1, 0x10C8($t0)
dma:
	lw	$t1, 0x10C8($t0)
	nop
	srl	$t1, $t1, 24
	andi	$t1, $t1, 1
	bnez	$t1, dma
	nop
	li	$t1, 0xC000
	sh	$t1, 0x1DAA($t0)
	li	$t1, ${CLICK_AT >> 3}
	sh	$t1, 0x1DA6($t0)
	li	$t1, 0xC010
	sh	$t1, 0x1DAA($t0)
	li	$t3, ${CLICK_RAM}
	li	$t4, ${click.length}
fifo:
	lhu	$t1, 0($t3)
	addiu	$t3, $t3, 2
	addiu	$t4, $t4, -1
	sh	$t1, 0x1DA8($t0)
	bnez	$t4, fifo
	nop
	li	$t1, 0xC000
	sh	$t1, 0x1DAA($t0)
	li	$t3, ${SCRIPT_AT}
	move	$s0, $zero
wait:
	lw	$t1, 0x1070($t0)
	nop
	andi	$t1, $t1, 1
	beqz	$t1, wait
	nop
	li	$t1, 0xFFFFFFFE
	sw	$t1, 0x1070($t0)
	li	$t1, ${0x02000000 | BACKGROUND}
	sw	$t1, 0x1810($t0)
	sw	$zero, 0x1810($t0)
	li	$t1, ${240 << 16 | 320}
	sw	$t1, 0x1810($t0)
	li	$t1, ${0x60000000 | BAR}
	sw	$t1, 0x1810($t0)
	andi	$t2, $s0, 0xFF
	lui	$t5, 100
	or	$t2, $t2, $t5
	sw	$t2, 0x1810($t0)
	li	$t1, ${16 << 16 | 8}
	sw	$t1, 0x1810($t0)
next:
	lw	$t1, 0($t3)
	nop
	srl	$t2, $t1, 16
	bne	$t2, $s0, done
	nop
	lw	$t5, 4($t3)
	andi	$t1, $t1, 0xFFFF
	addu	$t1, $t1, $t0
	sh	$t5, 0($t1)
	b	next
	addiu	$t3, $t3, 8
done:
	addiu	$s0, $s0, 1
	b	wait
	nop
`);
  const code = Buffer.from(made.sections.get('.text').bytes);
  if (code.length > 0x400) throw new Error('The sound program\'s code is longer than the room before its words.');
  const size = Math.ceil((0x400 + script.length * 4 + (loops.length + click.length) * 2) / 2048) * 2048, text = Buffer.alloc(size);
  code.copy(text);
  script.forEach((word, n) => text.writeUInt32LE(word >>> 0, 0x400 + n * 4));
  [...loops, ...click].forEach((half, n) => text.writeUInt16LE(half, LOOPS_AT - LOAD + n * 2));
  const header = Buffer.alloc(2048);
  header.write('PS-X EXE', 0, 'latin1');
  header.writeUInt32LE(LOAD, 0x10);
  header.writeUInt32LE(LOAD, 0x18);
  header.writeUInt32LE(text.length, 0x1C);
  header.writeUInt32LE(STACK, 0x30);
  header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
  return Buffer.concat([header, text]);
}
