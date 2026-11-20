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
