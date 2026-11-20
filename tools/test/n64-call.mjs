// npm run test:n64-call: tries the program that runs one function of a Nintendo 64 game's program in Parallel N64's
// own processor, on its cached interpreter (../n64/call.c, ../n64/original.mjs), with a program of the project's own
// (made-up-n64.mjs), so it needs nobody's copy of any game. The program is built from the emulator's source, fetched as
// the reference emulator's is. Each function of the made-up program is run once or more: what it gives back, 64 bits
// at a time, what it leaves in the memory, the RSP's memory and the hardware's registers, in the console's byte order,
// what it reads, which of its instructions ran and which way each branch went, and why one doesn't come back, as it
// reads the cartridge, never ends, reads where no word starts, or meets an exception.

import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { REPO } from '../lib/paths.mjs';
import { addressAt, buildCaller, CAME_BACK, ELSEWHERE, endText, EXCEPTION, IMAGE, imageAfter, inImage, Original, OUT_OF_STEPS, RAM, REGISTERS } from '../n64/original.mjs';
import { LOAD, madeUpProgram, STACK, VALUES } from './made-up-n64.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

const { words, labels, functions } = madeUpProgram();
const of = Object.fromEntries(functions.map(f => [f.name, f]));
// where a call comes back to: an address in the console's memory where the program has nothing
const BACK = 0x80300000;
const image = new Uint8Array(IMAGE);
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
words.forEach((word, n) => view(image).setUint32(inImage(LOAD) + n * 4, word));

// the registers a call starts with, 64 bits each, as the processor keeps a 32-bit number: its sign carried up
const wide = value => BigInt.asUintN(64, BigInt.asIntN(32, BigInt(value)));
const registers = (given = {}) => REGISTERS.map(name => (name === 'sp' ? wide(STACK) : name === 'ra' ? wide(BACK) : wide(given[name] ?? 0)));
const reg = (answer, name) => answer.registers[REGISTERS.indexOf(name)];
const low = (answer, name) => Number(BigInt.asUintN(32, reg(answer, name)));
const word = (bytes, address) => view(bytes).getUint32(inImage(address));

const original = new Original(buildCaller());
try {
  await original.image(image);
  const call = (name, given = {}, more = {}) => original.call({ address: of[name].address, span: of[name].size, registers: registers(given), ...more });

  console.log('A function that comes back:');
  const sum = await call('sum', { a0: 2, a1: 3 });
  check(sum.end === CAME_BACK && reg(sum, 'v0') === 5n && sum.steps === 2, `sum(2, 3) comes back with 5 in v0, in two instructions, its return and the sum in its delay slot (${endText(sum)}, ${reg(sum, 'v0')})`);
  check([...sum.ran].join() === '1,1' && !sum.reads.length && !sum.chunks.length, 'both its instructions ran, and it read and wrote nothing');
  check(isDeepStrictEqual(await call('sum', { a0: 2, a1: 3 }), sum), 'the same call again gives the same answer');
  const negative = await call('sum', { a0: -7, a1: 2 });
  check(reg(negative, 'v0') === 0xFFFFFFFFFFFFFFFBn, `a 32-bit sum is kept with its sign carried through the register's 64 bits (0x${reg(negative, 'v0').toString(16)})`);

  console.log('A loop that writes the memory:');
  const buffer = labels.buffer;
  const fill = await call('fill', { a0: buffer, a1: 3, a2: 0x5A });
  const filled = imageAfter(image, [], fill.chunks);
  check(fill.end === CAME_BACK && word(filled, buffer) === 0x5A5A5A00, `fill writes three bytes and no fourth, the first highest in the word, as the console keeps it (0x${word(filled, buffer).toString(16)})`);
  check(fill.ran[0] === (1 | 2 | 4) && fill.ran[2] === 1 && fill.ran[4] === (1 | 2), 'its loop\'s first branch went both ways, and its last always back to the top');
  const none = await call('fill', { a0: buffer, a1: 0, a2: 0x5A });
  check(none.ran[0] === (1 | 2) && none.ran[2] === 0 && !none.chunks.length, 'with nothing to write its branch went one way, past the store, and nothing was written');

  console.log('What a function reads:');
  const lookup = await call('lookup', { a0: 2 });
  const at = labels.values + 8;
  check(low(lookup, 'v0') === VALUES[2] && lookup.reads.some(read => read.address === (at & 0x1FFFFFFF) && read.bytes === 4 && read.value === VALUES[2]), `lookup(2) reads the third value, at 0x${at.toString(16)}, and gives it back`);
  const changed = await call('lookup', { a0: 0 }, { changes: [[labels.values, 4, 0xDEADBEEF]] });
  const again = await call('lookup', { a0: 0 });
  check(low(changed, 'v0') === 0xDEADBEEF && reg(changed, 'v0') === wide(0xDEADBEEF) && low(again, 'v0') === VALUES[0], 'a value changed for one call is read by that call, and the next starts from the image as it was');
  const byte = await call('lookup', { a0: 0 }, { changes: [[labels.values + 1, 1, 0xAB]] });
  check(low(byte, 'v0') === 0x11AB1111, 'a byte changed is the word\'s second highest, as the console keeps a word');

  console.log('A call and a stack:');
  const twice = await call('twice', { a0: 21 });
  const stacked = imageAfter(image, [], twice.chunks);
  check(twice.end === CAME_BACK && reg(twice, 'v0') === 42n && low(twice, 'sp') === STACK && word(stacked, STACK - 24 + 16) === BACK, 'twice(21) calls sum and gives back 42, its stack back where it was, and its return address is left on it');
  const main = await call('main');
  check(main.end === CAME_BACK && reg(main, 'v0') === 1n && word(imageAfter(image, [], main.chunks), buffer) === 0x5A5A5A5A, 'main calls the rest, fills its buffer and calls shine through its table, which gives back 1');
  const pick = [];
  for (const a0 of [0, 1, 2, 7]) pick.push(await call('pick', { a0 }));
  check(pick.map(answer => reg(answer, 'v0')).join() === '10,20,30,0', 'pick goes through its table of cases to each of the three, and past it for any other');

  console.log('64 bits and a likely branch:');
  const numbers = labels.numbers;
  const sixtyFour = await call('wide', { a0: 0x12345678, a1: 0x9ABCDEF0 & 0x7FFFFFFF, a2: numbers });
  const kept = imageAfter(image, [], sixtyFour.chunks);
  check(reg(sixtyFour, 't0') === 0x123456781ABCDEF0n && word(kept, numbers) === 0x12345678 && word(kept, numbers + 4) === 0x1ABCDEF0,
    `a 64-bit number is made in one register and kept as a doubleword, its highest word first (0x${reg(sixtyFour, 't0').toString(16)})`);
  check(reg(sixtyFour, 'v0') === 0x12345678n && reg(sixtyFour, 'v1') === 0x1ABCDEF0n, 'and given back as the console\'s compilers give one, its high word in v0 and its low in v1');
  const taken = await call('likely', { a0: 0 }), past = await call('likely', { a0: 5 });
  check(reg(taken, 'v0') === 1n && [...taken.ran].join('') === '31011', `a likely branch that goes runs its delay slot (${[...taken.ran].join('')})`);
  check(reg(past, 'v0') === 2n && [...past.ran].join('') === '50111', `one that doesn't go skips it (${[...past.ran].join('')})`);

  console.log('The floating-point unit:');
  const singles = await call('addf', { a0: numbers }, { changes: [[numbers, 4, 0x3FC00000], [numbers + 4, 4, 0x40100000]] });
  check(singles.end === CAME_BACK && word(imageAfter(image, [], singles.chunks), numbers + 8) === 0x40700000 && singles.fpu === 4,
    `1.5 + 2.25 is 3.75, in four of the floating-point unit's instructions (0x${word(imageAfter(image, [], singles.chunks), numbers + 8).toString(16)})`);
  check(Number(singles.floats[4] & 0xFFFFFFFFn) === 0x40700000, 'and its register keeps the sum, as the processor keeps its registers');
  const doubles = await call('square', { a0: numbers }, { changes: [[numbers, 4, 0x3FF80000], [numbers + 4, 4, 0]] });
  const squared = imageAfter(image, [], doubles.chunks);
  check(word(squared, numbers + 8) === 0x40020000 && word(squared, numbers + 12) === 0, '1.5 squared is 2.25, a double kept highest word first');
  const unusable = await call('addf', { a0: numbers }, { status: 0x14000000 });
  check(unusable.end === EXCEPTION && ((unusable.detail >>> 2) & 31) === 11, `with the floating-point unit not usable, its first instruction meets the console's exception: ${endText(unusable)}`);

  console.log('Where a twin can\'t follow:');
  const cartridge = await call('cartridge');
  check(cartridge.end === ELSEWHERE && cartridge.detail === 0x10000000 && /into the cartridge/.test(endText(cartridge)), `a read of the cartridge stops there: ${endText(cartridge)}`);
  const forever = await call('forever', {}, { limit: 1000 });
  check(forever.end === OUT_OF_STEPS && forever.steps === 1000, `a loop that never ends runs out of its instructions: ${endText(forever)}`);
  const misaligned = await call('misaligned', { a0: buffer });
  check(misaligned.end === EXCEPTION && ((misaligned.detail >>> 2) & 31) === 4 && misaligned.pc === of.misaligned.address, `a word read where none starts meets the console's exception: ${endText(misaligned)}`);
  const trap = await call('trap');
  check(trap.end === EXCEPTION && ((trap.detail >>> 2) & 31) === 8, `a syscall meets its exception: ${endText(trap)}`);
  const unmapped = await call('unmapped');
  check(unmapped.end === EXCEPTION && ((unmapped.detail >>> 2) & 31) === 2 && unmapped.pc === of.unmapped.address + 4, `a read only the TLB could map meets a TLB miss, as no call starts with anything mapped: ${endText(unmapped)}`);
  const nowhere = await original.call({ address: 0xB0001000, span: 4, registers: registers() });
  check(nowhere.end === ELSEWHERE && nowhere.steps === 0, `code can't run from the cartridge: ${endText(nowhere)}`);

  console.log('The hardware and the RSP\'s memory:');
  const hardware = await call('hardware', { a0: 0x1234ABCD });
  const wired = imageAfter(image, [], hardware.chunks);
  check(hardware.end === CAME_BACK && hardware.hardware === 1 && word(wired, 0xA440000C) === 0x1234ABCD && word(wired, 0xA4000010) === 0x1234ABCD,
    'a word in a register of the video interface and one in the RSP\'s data memory are kept where the image has them, and the one hardware write is counted');
  check(inImage(0x80010000) === inImage(0xA0010000) && inImage(0x00010000) === 0x10000 && inImage(0xA4400000) > RAM && inImage(0xB0000000) === -1 && inImage(0x807FFFFF) === RAM - 1 && inImage(0x80800000) === -1,
    'the image has the console\'s 8 MB however code names it, its registers after, and nothing of the cartridge');
  check(addressAt(inImage(0xA4400010)).address === 0xA4400010 && addressAt(0x1234).address === 0x80001234, 'and a place in it is named as code names it');
} finally {
  original.close();
}

check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe Nintendo 64\'s original runs one function at a time as it should.');
