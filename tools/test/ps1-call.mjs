// npm run test:ps1-call: tries the program that runs one function of a PlayStation game's program in PCSX ReARMed's
// own interpreter (../ps1/call.c, ../ps1/original.mjs), with a program of the project's own (made-up-ps1.mjs), so it
// needs nobody's copy of any game. The program is built from the emulator's source, fetched as the reference
// emulator's is. Each function of the made-up program is run once or more: what it gives back, what it leaves in the
// memory, the scratchpad and the hardware's registers, what it reads, which of its instructions ran and which way each
// branch went, and why one doesn't come back, as it goes into the BIOS, never ends, reads where no word starts.

import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { REPO } from '../lib/paths.mjs';
import { buildCaller, CAME_BACK, ELSEWHERE, endText, EXCEPTION, IMAGE, imageAfter, inImage, Original, OUT_OF_STEPS, RAM, REGISTERS } from '../ps1/original.mjs';
import { LOAD, madeUpProgram, STACK, VALUES } from './made-up-ps1.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

const { words, labels, functions } = madeUpProgram();
const of = Object.fromEntries(functions.map(f => [f.name, f]));
// where a call comes back to: an address in the BIOS's own memory, where no game has code
const BACK = 0x80001000;
const image = new Uint8Array(IMAGE);
words.forEach((word, n) => new DataView(image.buffer).setUint32(inImage(LOAD) + n * 4, word, true));

const registers = (given = {}) => REGISTERS.map(name => (name === 'sp' ? STACK : name === 'ra' ? BACK : given[name] ?? 0));
const reg = (answer, name) => answer.registers[REGISTERS.indexOf(name)] >>> 0;
const word = (bytes, address) => new DataView(bytes.buffer).getUint32(inImage(address), true);

const original = new Original(buildCaller());
try {
  await original.image(image);
  const call = (name, given = {}, more = {}) => original.call({ address: of[name].address, span: of[name].size, registers: registers(given), ...more });

  console.log('A function that comes back:');
  const sum = await call('sum', { a0: 2, a1: 3 });
  check(sum.end === CAME_BACK && reg(sum, 'v0') === 5 && sum.steps === 2, `sum(2, 3) comes back with 5 in v0, in two instructions, its return and the sum in its delay slot (${endText(sum)}, ${reg(sum, 'v0')})`);
  check([...sum.ran].join() === '1,1' && !sum.reads.length && !sum.chunks.length, 'both its instructions ran, and it read and wrote nothing');
  check(isDeepStrictEqual(await call('sum', { a0: 2, a1: 3 }), sum), 'the same call again gives the same answer');

  console.log('A loop that writes the memory:');
  const buffer = labels.buffer;
  const fill = await call('fill', { a0: buffer, a1: 3, a2: 0x5A });
  const filled = imageAfter(image, [], fill.chunks);
  check(fill.end === CAME_BACK && word(filled, buffer) === 0x005A5A5A, `fill writes three bytes and no fourth (0x${word(filled, buffer).toString(16)})`);
  check(fill.ran[0] === (1 | 2 | 4) && fill.ran[2] === 1 && fill.ran[4] === (1 | 2), 'its loop\'s first branch went both ways, and its last always back to the top');
  const none = await call('fill', { a0: buffer, a1: 0, a2: 0x5A });
  check(none.ran[0] === (1 | 2) && none.ran[2] === 0 && !none.chunks.length, 'with nothing to write its branch went one way, past the store, and nothing was written');

  console.log('What a function reads:');
  const lookup = await call('lookup', { a0: 2 });
  const at = labels.values + 8;
  check(reg(lookup, 'v0') === VALUES[2] && lookup.reads.some(read => read.address === at && read.bytes === 4 && read.value === VALUES[2]), `lookup(2) reads the third value, at 0x${at.toString(16)}, and gives it back`);
  const changed = await call('lookup', { a0: 0 }, { changes: [[labels.values, 4, 0xDEADBEEF]] });
  const again = await call('lookup', { a0: 0 });
  check(reg(changed, 'v0') === 0xDEADBEEF && reg(again, 'v0') === VALUES[0], 'a value changed for one call is read by that call, and the next starts from the image as it was');

  console.log('A call and a stack:');
  const twice = await call('twice', { a0: 21 });
  const stacked = imageAfter(image, [], twice.chunks);
  check(twice.end === CAME_BACK && reg(twice, 'v0') === 42 && reg(twice, 'sp') === STACK && word(stacked, STACK - 24 + 16) === BACK, 'twice(21) calls sum and gives back 42, its stack back where it was, and its return address is left on it');
  const main = await call('main');
  check(main.end === CAME_BACK && reg(main, 'v0') === 1 && word(imageAfter(image, [], main.chunks), buffer) === 0x5A5A5A5A, 'main calls the rest, fills its buffer and calls shine through its table, which gives back 1');

  console.log('Where a twin can\'t follow:');
  const bios = await call('bios');
  check(bios.end === ELSEWHERE && bios.detail === 0xA0 && /went into the BIOS, at 0x000000A0/.test(endText(bios)), `a jump to the BIOS's calls stops there: ${endText(bios)}`);
  const forever = await call('forever', {}, { limit: 1000 });
  check(forever.end === OUT_OF_STEPS && forever.steps === 1000, `a loop that never ends runs out of its instructions: ${endText(forever)}`);
  const misaligned = await call('misaligned', { a0: buffer });
  check(misaligned.end === EXCEPTION && ((misaligned.detail >>> 2) & 31) === 4 && misaligned.pc === of.misaligned.address, `a word read where none starts meets the console's exception: ${endText(misaligned)}`);

  console.log('The scratchpad, the hardware and the geometry processor:');
  const hardware = await call('hardware', { a0: 0x1234ABCD });
  const wired = imageAfter(image, [], hardware.chunks);
  check(hardware.end === CAME_BACK && hardware.hardware === 1 && word(wired, 0x1F800010) === 0x1234ABCD && new DataView(wired.buffer).getUint16(inImage(0x1F801C00), true) === 0xABCD,
    'a word in the scratchpad and a halfword in a register of the sound chip are kept where the image has them, and the one hardware write is counted');
  check(inImage(0x1F801C00) === RAM + 0x1C00 && inImage(0x00010000) === inImage(0xA0010000) && inImage(0x80210000) === inImage(0x80010000) && inImage(0x1FC00000) === -1, 'the image has the memory\'s mirrors, and nothing of the BIOS');
  const gte = await call('gte', { a0: 0xCAFE1234 });
  check(gte.end === CAME_BACK && reg(gte, 'v0') === 0xCAFE1234 && gte.gte === 2, 'a value goes into the geometry processor and comes back, in two of its instructions');
} finally {
  original.close();
}

check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe PlayStation\'s original runs one function at a time as it should.');
