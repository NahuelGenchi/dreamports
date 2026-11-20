// npm run test:ps2-call: tries the program that runs one function of a PlayStation 2 game by itself in Play!'s own
// processor code (../ps2/call.cpp, ../ps2/original.mjs), on the three processors it runs, with programs of the
// project's own, so it needs nobody's copy of any game: the EE's functions of the made-up program of the function
// check's test (ps2-twin/program.mjs), a function for the IOP and two microprograms for vector unit 1. Each call has to
// leave the registers and the memory the console would, say what it read and which way each branch went, and stop with
// why where the check can't follow.

import { spawnSync } from 'node:child_process';
import { REPO } from '../lib/paths.mjs';
import { buildCaller, CAME_BACK, EE_REGISTERS, ELSEWHERE, endText, IOP_REGISTERS, KINDS, MISALIGNED, Original, OUT_OF_STEPS, SYSCALL, VU_REGISTERS } from '../ps2/original.mjs';
import { imageOf } from '../ps2/twin.mjs';
import { madeUpElf } from './ps2-twin/program.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();
const hex = n => `0x${(n >>> 0).toString(16).toUpperCase()}`;
const bitsOf = value => new Uint32Array(new Float32Array([value]).buffer)[0];
const floatOf = bits => new Float32Array(new Uint32Array([bits]).buffer)[0];

const program = await buildCaller();

console.log('The EE:');
{
  const { elf, labels, functions } = madeUpElf();
  const ee = new Original(program, 'ee');
  try {
    const image = imageOf(elf);
    await ee.image(image);
    const of = name => functions.find(f => f.name === name);
    // the registers of a call: ra and sp as the check gives them, and each argument as a caller spreads it
    const call = async (name, args = [], { floats = [], limit, changes = [] } = {}) => {
      const registers = new Array(EE_REGISTERS.words).fill(0);
      registers[31 * 4] = 0x1000;
      registers[29 * 4] = 0x01FFFF00;
      args.forEach((value, k) => {
        registers[(4 + k) * 4] = Number(BigInt.asUintN(32, BigInt(value)));
        registers[(4 + k) * 4 + 1] = Number(BigInt.asUintN(32, BigInt(value) >> 32n));
      });
      floats.forEach((bits, k) => { registers[EE_REGISTERS.fpr + 12 + k] = bits; });
      return ee.call({ address: of(name).address, span: of(name).size, registers, limit, changes });
    };
    const v0 = answer => (BigInt(answer.registers[9]) << 32n) | BigInt(answer.registers[8]);

    let answer = await call('sum', [2, -5]);
    check(answer.end === CAME_BACK && v0(answer) === BigInt.asUintN(64, -3n) && answer.ran.every(ways => ways === 1), `sum(2, -5) gives back -3, spread to 64 bits, and both its instructions ran: ${endText(answer)} ${v0(answer).toString(16)}`);
    answer = await call('fill', [0x01800001, 4, 0x5A]);
    const chunk = answer.chunks.find(c => c.at === 0x01800000);
    check(chunk && [...chunk.bytes.subarray(1, 5)].every(byte => byte === 0x5A) && chunk.bytes[0] === 0 && chunk.bytes[5] === 0, 'fill writes four bytes, from where it was told, and nothing either side');
    const loop = (0x1000AC - of('fill').address) / 4;
    check(answer.ran[loop] === 7 && answer.ran[0] === 5, `its loop went back and went on, and its first branch went on (${[...answer.ran].join(' ')})`);
    answer = await call('fill', [0x01800000, 0, 0]);
    check(answer.ran[0] === 3 && answer.ran[loop] === 0 && !answer.chunks.length, 'with nothing to fill, its first branch goes to its end and the loop never runs');
    answer = await call('fill', [0x21800000, 2, 1]);
    check(answer.chunks.some(c => c.at === 0x01800000 && c.bytes[0] === 1), 'the console\'s memory written through its uncached mirror at 0x21800000 is the same memory');
    answer = await call('fill', [0x01FFFFFE, 4, 1]);
    check(answer.end === ELSEWHERE && answer.detail === 0x02000000, `past the console's 32 MB it stops: ${endText(answer)}`);
    answer = await call('lookup', [2]);
    check(v0(answer) === 0x33333333n && answer.reads.some(read => read.address === labels.values + 8 && read.bytes === 4 && read.value === 0x33333333), 'lookup(2) gives back the third value, and says it read it');
    answer = await call('twice', [21]);
    check(v0(answer) === 42n && answer.chunks.some(c => c.at === 0x01FFFE00), 'twice(21) calls sum and gives back 42, saving ra on the stack with a 64-bit store');
    answer = await call('wide', [0x1_0000_0001n, 0xFFFF_FFFFn]);
    check(v0(answer) === 0x2_0000_0000n, `wide adds all 64 bits: ${hex(Number(v0(answer) >> 32n))}${hex(Number(v0(answer) & 0xFFFFFFFFn)).slice(2)}`);
    // a product whose float is a step further from zero when rounded to the nearest than when cut towards it
    let a = 1, b = 1;
    for (let k = 1; Math.abs(Math.fround(a * b)) <= Math.abs(a * b); k++) [a, b] = [Math.fround(1 + k / 7), Math.fround(1 + k / 11)];
    const product = a * b, nearest = Math.fround(product);
    const cut = Math.abs(nearest) > Math.abs(product) ? floatOf(bitsOf(nearest) - 1) : nearest;
    answer = await call('scale', [], { floats: [bitsOf(a), bitsOf(b)] });
    check(answer.registers[EE_REGISTERS.fpr] === bitsOf(cut) && bitsOf(cut) !== bitsOf(nearest), `scale cuts the product towards zero, as the EE does: ${floatOf(answer.registers[EE_REGISTERS.fpr])}`);
    answer = await call('scale', [], { floats: [0x7F800000, 0x3F800000] });
    check(answer.registers[EE_REGISTERS.fpr] === 0x7F800000, 'and takes a float whose exponent is all ones as the number it is, as the console does');
    answer = await call('eight', [1, 2, 3, 4, 5, 6, 7, 8]);
    check(v0(answer) === 36n, 'eight adds the arguments in a0 to a3 and t0 to t3');
    answer = await call('copy16', [0x01800004, 0x01800018]);
    check(answer.reads.some(read => read.address === 0x01800010) && answer.chunks.some(c => c.at === 0x01800000), 'LQ and SQ leave out an address\'s low four bits');
    answer = await call('biggest', [-5, 3]);
    check(v0(answer) === 3n, 'PMAXW gives the larger word');
    answer = await call('likely', [0]);
    const slot = (0x100148 - of('likely').address) / 4;
    check(v0(answer) === 7n && answer.ran[slot] === 1 && answer.ran[slot - 1] === 3, 'a branch likely that goes runs its delay slot');
    answer = await call('likely', [1]);
    check(v0(answer) === 3n && answer.ran[slot] === 0 && answer.ran[slot - 1] === 5, 'and one that doesn\'t go doesn\'t, which is said too');
    answer = await call('pick', [2]);
    check(v0(answer) === 30n && answer.ran[(labels.case2 - of('pick').address) / 4] === 1, 'pick goes to its case through its table');
    answer = await call('hardware', [0x12345678]);
    check(answer.hardware === 1 && answer.chunks.some(c => c.at === 0x02200000) && answer.chunks.some(c => c.at === 0x02230000), `the scratchpad and the GS's registers are written where the image keeps them, and one went to the hardware (${answer.hardware})`);
    answer = await call('kernel');
    check(answer.end === SYSCALL && answer.detail === 0x3C, `a syscall stops the call: ${endText(answer)}`);
    answer = await call('forever', [], { limit: 1000 });
    check(answer.end === OUT_OF_STEPS && answer.steps >= 1000 && answer.steps < 1010, `a loop that never ends stops after its instructions: ${endText(answer)}, ${answer.steps}`);
    answer = await call('misaligned', [0x01800000]);
    check(answer.end === MISALIGNED && answer.detail === 0x01800001, `a word where none starts stops it: ${endText(answer)}`);
    answer = await call('vu0', [0x01800000], { changes: [[0x01800000, 4, 0x3F800000]] });
    check(answer.end === CAME_BACK && answer.vu0 && answer.registers[EE_REGISTERS.vf + 2 * 4] === 0x40000000, 'vector unit 0\'s registers left changed in macro mode are said');
    answer = await call('sum', [1, 1]);
    check(!answer.vu0 && !answer.chunks.length && !answer.hardware, 'and nothing is said of a call that changed none of them');
  } finally {
    ee.close();
  }
}

console.log('The IOP:');
{
  const iop = new Original(program, 'iop');
  try {
    const image = new Uint8Array(KINDS.iop.image), view = new DataView(image.buffer);
    // lw t0, 0(a0); addu v0, t0, a1; sw v0, 4(a0); lui t1, 0x1F80; sw v0, 0x1070(t1); jr ra; nop
    [0x8C880000, 0x01051021, 0xAC820004, 0x3C091F80, 0xAD221070, 0x03E00008, 0].forEach((word, n) => view.setUint32(0x10000 + n * 4, word, true));
    view.setUint32(0x20000, 1000, true);
    await iop.image(image);
    const registers = new Array(IOP_REGISTERS.words).fill(0);
    registers[4] = 0x80020000;
    registers[5] = 234;
    registers[29] = 0x001FFF00;
    registers[31] = 0x1000;
    const answer = await iop.call({ address: 0x10000, span: 28, registers });
    check(answer.end === CAME_BACK && answer.registers[2] === 1234 && answer.ran.every(ways => ways === 1), `a function of the IOP runs, through 0x80000000, and gives back 1234: ${answer.registers[2]}`);
    check(answer.reads.length === 1 && answer.reads[0].address === 0x80020000 && answer.reads[0].value === 1000, 'it says what it read');
    check(answer.chunks.some(c => c.at === 0x20000 && new DataView(c.bytes.buffer).getUint32(4, true) === 1234) && answer.chunks.some(c => c.at === 0x201000) && answer.hardware === 1, 'and leaves its sum in its memory and in the interrupt controller\'s register, as hardware');
  } finally {
    iop.close();
  }
}

console.log('Vector unit 1:');
{
  const vu = new Original(program, 'vu1');
  try {
    const image = new Uint8Array(KINDS.vu1.image), view = new DataView(image.buffer);
    const NOP_LOWER = 0x8000033C, NOP_UPPER = 0x000002FF, E = 0x40000000;
    const put = (at, pairs) => pairs.forEach(([lower, upper], n) => { view.setUint32(0x4000 + at + n * 8, lower, true); view.setUint32(0x4000 + at + n * 8 + 4, upper, true); });
    // LQ.xyzw vf1, 0(vi0); ADD.xyzw vf2, vf1, vf1; SQ.xyzw vf2, 1(vi0); IADDIU vi1, vi0, 2; XGKICK vi1 with the E bit
    put(0, [[0x01E10000, NOP_UPPER], [NOP_LOWER, 0x01E108A8], [0x03E01001, NOP_UPPER], [0x10010002, NOP_UPPER], [0x80000EFC, E | NOP_UPPER], [NOP_LOWER, NOP_UPPER]]);
    // IADDIU vi1, vi0, 3; then ISUBIU vi1, vi1, 1 and, a pair on, IBNE vi1, vi0 back to it, until it's 0. Right after
    // the ISUBIU, the branch would read vi1 as it was four pairs before, as the emulator has the unit do
    put(0x100, [[0x10010003, NOP_UPPER], [0x12010801, NOP_UPPER], [NOP_LOWER, NOP_UPPER], [0x52000FFD, NOP_UPPER], [NOP_LOWER, NOP_UPPER], [NOP_LOWER, E | NOP_UPPER], [NOP_LOWER, NOP_UPPER]]);
    [1, 2, 3, 4].forEach((value, k) => view.setFloat32(k * 4, value, true));
    // a GIF tag at the third quadword: one PACKED loop of one A+D write, the end of the packet, and its write
    view.setUint32(0x20, 0x00008001, true);
    view.setUint32(0x24, 0x10000000, true);
    view.setUint32(0x28, 0xE, true);
    view.setUint32(0x30, 0x12345678, true);
    view.setUint32(0x38, 0x4C, true);
    await vu.image(image);
    let answer = await vu.call({ address: 0, span: 48, registers: new Array(VU_REGISTERS.words).fill(0) });
    const vf2 = [0, 1, 2, 3].map(k => floatOf(answer.registers[VU_REGISTERS.vf + 8 + k]));
    check(answer.end === CAME_BACK && vf2.join() === '2,4,6,8' && answer.registers[VU_REGISTERS.vi + 1] === 2, `a microprogram runs to its E bit, leaving vf2 ${vf2.join(', ')} and vi1 ${answer.registers[VU_REGISTERS.vi + 1]}`);
    const stored = answer.chunks.find(c => c.at === 0);
    check(stored && [0, 1, 2, 3].map(k => new DataView(stored.bytes.buffer).getFloat32(16 + k * 4, true)).join() === '2,4,6,8', 'and its store in its data memory');
    check(answer.kicks.length === 1 && answer.kicks[0].at === 0x20 && answer.kicks[0].bytes.length === 32 && new DataView(answer.kicks[0].bytes.buffer).getUint32(16, true) === 0x12345678, 'it sends the GS the packet XGKICK names, from its tag to its end');
    answer = await vu.call({ address: 0x100, span: 56, registers: new Array(VU_REGISTERS.words).fill(0) });
    check(answer.end === CAME_BACK && answer.registers[VU_REGISTERS.vi + 1] === 0 && answer.ran[3] === 7 && answer.steps === 15, `a loop's branch goes back twice and on once (${[...answer.ran].join(' ')}, ${answer.steps} pairs)`);
  } finally {
    vu.close();
  }
}

check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe PlayStation 2\'s processors run a function by itself as the emulator runs them.');
