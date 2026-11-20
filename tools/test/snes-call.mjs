// npm run test:snes-call: tries the program that runs one function of a Super Nintendo game's cartridge in Snes9x's
// own 65816 (../snes/call.cpp, ../snes/original.mjs), with a cartridge of the project's own (made-up-snes.mjs), so it
// needs nobody's copy of any game. The program is built from the emulator's source, fetched as the reference
// emulator's is. Each function of the made-up cartridge is run once or more: what it gives back, what it leaves in the
// work memory, the hardware's registers and the save memory, what it reads, each read and write of the hardware in
// order, which of its instructions ran with which flags and which way each branch went, and why one doesn't come
// back, as it never ends, waits for an interrupt, stops the processor, reads where nothing is or writes to the ROM.
// The cartridge's map is tried too, for a LoROM and a HiROM, against where the console has each place.

import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { REPO } from '../lib/paths.mjs';
import { HARDWARE, mapOf, NOTHING, placeIn, ROM, SAVE, WORK } from '../snes/cartridge.mjs';
import { readCartridge } from '../snes/cartridge.mjs';
import { buildCaller, CAME_BACK, CPU_AT, ELSEWHERE, endText, imageAfter, imageSize, inImage, NOWHERE, Original, OUT_OF_STEPS, PPU_AT, RAN, RTI, RTL, SRAM_AT, STOPPED, WAITS } from '../snes/original.mjs';
import { madeUpCartridge, SRAM, STACK, VALUES } from './made-up-snes.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

const { rom, labels, functions } = madeUpCartridge();
const of = Object.fromEntries(functions.map(f => [f.name, f]));

console.log('The cartridge and its map:');
const cart = readCartridge(rom);
check(cart.mapping === 'lorom' && cart.sram === SRAM && cart.title === 'DREAMPORTS MADE UP' && cart.reset === labels.start && !cart.chip, `the made-up cartridge reads as LoROM with ${cart.sram} bytes of save memory, called ${cart.title}, started at $${cart.reset.toString(16)}`);
const map = mapOf(cart);
const at = address => placeIn(map, address);
check(isDeepStrictEqual(at(0x008000), { what: ROM, at: 0 }) && isDeepStrictEqual(at(0x808123), { what: ROM, at: 0x123 }) && isDeepStrictEqual(at(0x400123), { what: ROM, at: 0x123 }),
  'its ROM is at $8000 of bank $00, again in bank $80, and in the lower half of bank $40, as Snes9x lays out LoROM');
check(isDeepStrictEqual(at(0x700010), { what: SAVE, at: 0x10 }) && isDeepStrictEqual(at(0x700810), { what: SAVE, at: 0x10 }) && at(0x7E1234).what === WORK && at(0x002100).what === HARDWARE && at(0x006000).what === NOTHING,
  'its save memory is in bank $70, seen again every 2 KB, its work memory in bank $7E, the hardware in the low banks, and nothing at $6000');
check(inImage(map, 0x000010) === 0x10 && inImage(map, 0x800010) === 0x10 && inImage(map, 0x7E0010) === 0x10 && inImage(map, 0x7F0010) === 0x10010 && inImage(map, 0x002144) === inImage(map, 0x002140) && inImage(map, 0x002140) === PPU_AT + 0x40 && inImage(map, 0x004216) === CPU_AT + 0x216 && inImage(map, 0x700010) === SRAM_AT + 0x10 && inImage(map, 0x008000) === -1,
  'the image has the work memory with its mirror, the sound\'s ports seen again every four bytes, the registers and the save memory, and nothing of the ROM');
const hirom = new Uint8Array(0x20000);
hirom.set([...'MADE UP HIROM        '].map(c => c.charCodeAt(0)), 0xFFC0);
hirom[0xFFD5] = 0x21;
hirom[0xFFD7] = 0x07;
hirom[0xFFD8] = 0x03;
hirom.set([0xFF, 0x00, 0x00, 0xFF], 0xFFDC);
hirom.set([0x00, 0x80], 0xFFFC);
const high = readCartridge(hirom), highMap = mapOf(high);
check(high.mapping === 'hirom' && high.sram === 8192 && isDeepStrictEqual(placeIn(highMap, 0xC01234), { what: ROM, at: 0x1234 }) && isDeepStrictEqual(placeIn(highMap, 0x018000), { what: ROM, at: 0x18000 }) && isDeepStrictEqual(placeIn(highMap, 0xC21234), { what: ROM, at: 0x1234 }) && isDeepStrictEqual(placeIn(highMap, 0x207123), { what: SAVE, at: 0x1123 }) && isDeepStrictEqual(placeIn(highMap, 0x216000), { what: SAVE, at: 0 }),
  'a HiROM has its ROM 64 KB to a bank, at $C0 and in the upper half of bank $00 on, seen again past its end, and its save memory at $6000 of banks $20 and on, 8 KB to a bank and seen again past its end');

// where a call comes back to, unless it's an interrupt's: the bottom of the function's bank, where no code of its is
const image = new Uint8Array(imageSize(SRAM));
const original = new Original(buildCaller());
try {
  await original.cartridge(cart);
  await original.image(image);
  const call = (name, registers = {}, more = {}) => original.call({ address: of[name].address, span: of[name].size, registers: { s: STACK, ...registers }, ...more });
  const after = answer => imageAfter(map, image, [], answer.chunks);

  console.log('A function that comes back:');
  const sum = await call('sum', { a: 2, x: 3, p: 0x00 });
  check(sum.end === CAME_BACK && sum.registers.a === 5 && sum.steps === 4 && sum.cycles > 0 && sum.registers.s === STACK, `sum with 2 and 3 comes back with 5 in A, in four instructions, its stack where it was (${endText(sum)}, ${sum.registers.a})`);
  const sixteen = RAN.STARTED | RAN.A16 | RAN.XY16;
  check([...sum.ran].join() === [sixteen, 0, sixteen, sixteen, 0, sixteen].join(), 'each of its instructions ran where it starts, with A, X and Y of 16 bits, and nothing ran in the middle of one');
  check(sum.reads.length === 2 && sum.reads[0].address === 0 && sum.reads[0].value === 3 && after(sum)[0] === 3 && sum.chunks.length === 1, 'it wrote X to the direct page and read it back, and read nothing else but its own instructions and the address it came back to');
  check(isDeepStrictEqual(await call('sum', { a: 2, x: 3, p: 0x00 }), sum), 'the same call again gives the same answer');

  console.log('A loop that writes the memory:');
  const fill = await call('fill', { a: 0x5A, x: 0x0200, y: 3, p: 0x20 });
  const filled = after(fill);
  check(fill.end === CAME_BACK && [...filled.subarray(0x200, 0x204)].join() === '90,90,90,0', 'fill writes three bytes and no fourth, through the work memory\'s mirror in bank $00');
  check((fill.ran[3] & (RAN.TAKEN | RAN.NOT_TAKEN)) === (RAN.TAKEN | RAN.NOT_TAKEN) && fill.ran[3] & RAN.A8 && fill.ran[3] & RAN.XY16, 'its loop\'s branch went both ways, and ran with A of 8 bits and X of 16');
  const none = await call('fill', { a: 0x5A, x: 0x0200, y: 0, p: 0x20 });
  check((none.ran[3] & (RAN.TAKEN | RAN.NOT_TAKEN)) === RAN.TAKEN && none.ran[5] === 0 && !none.chunks.length, 'with nothing to write its branch went one way, past the store, and nothing was written');

  console.log('What a function reads, and its data bank and direct page:');
  const lookup = await call('lookup', { x: 2, p: 0x00 }, { way: RTL });
  const value = labels.values + 4;
  check(lookup.end === CAME_BACK && lookup.registers.a === VALUES[2] && lookup.reads.some(read => read.address === value && read.value === (VALUES[2] & 0xFF)), `lookup with 2, called with JSL, reads the third value, at $${value.toString(16)}, and comes back with it through RTL`);
  const bank = await call('bank', { db: 0x7F, p: 0x30 }, { changes: [[0x7F1234, 1, 0x99]] });
  const plain = await call('bank', { db: 0x7F, p: 0x30 });
  check(bank.reads[0]?.address === 0x7F1234 && (bank.registers.a & 0xFF) === 0x99 && (plain.registers.a & 0xFF) === 0, 'with the data bank $7F it reads $7F:1234, a value changed for one call is read by that call, and the next starts from the image as it was');
  const direct = await call('direct', { d: 0x0100, p: 0x30 });
  check(direct.reads[0]?.address === 0x000110, 'with the direct page at $0100 it reads $0110');

  console.log('Calls, a stack and the flags:');
  const twice = await call('twice', { a: 21, p: 0x00 });
  check(twice.end === CAME_BACK && twice.registers.a === 42 && twice.registers.s === STACK, 'twice with 21 calls sum and comes back with 42, its stack back where it was');
  const main = await call('main', { p: 0x00 }, { way: RTL });
  const ran = after(main);
  check(main.end === CAME_BACK && [...ran.subarray(0x200, 0x204)].join() === '90,90,90,90' && main.registers.s === STACK, 'main calls the rest, fills its buffer, and calls shine through its table, and comes back');
  const leaves8 = await call('leaves8', { p: 0x00 });
  check(leaves8.end === CAME_BACK && leaves8.registers.p & 0x20, 'leaves8 comes back with A of 8 bits, as it was called with 16');
  const pick = await call('pick', { x: 4, p: 0x00 });
  check(pick.end === CAME_BACK && pick.registers.a === 30, 'pick with X 4 goes through its table to its third case');
  const tick = await call('tick', { p: 0x04 }, { way: RTI, back: labels.spin, changes: [[0x000020, 1, 6]] });
  check(tick.end === CAME_BACK && after(tick)[0x20] === 7 && tick.registers.p === 0x04 && tick.registers.s === STACK, 'an interrupt\'s handler adds one to its byte and comes back through RTI, with the flags it was given');
  const old = await call('direct', { s: 0x01FF, e: 1, p: 0x00 }, { changes: [[0x000010, 1, 0x77]] });
  check(old.end === CAME_BACK && (old.registers.a & 0xFF) === 0x77 && old.registers.e === 1 && old.registers.s === 0x01FF && old.ran[0] & RAN.EMULATION, 'in the 6502\'s mode a function runs with its stack in page 1, and says it ran so');

  console.log('The console\'s hardware:');
  const hardware = await call('hardware', { p: 0x30 });
  const wired = after(hardware);
  check(hardware.end === CAME_BACK && (hardware.registers.a & 0xFF) === 42 && wired[PPU_AT] === 0x0F, 'it multiplies 6 by 7 with the console\'s unit, and the screen\'s register keeps what was written');
  check(isDeepStrictEqual(hardware.hardware, [{ register: 0x2100, value: 0x0F, write: true }, { register: 0x4202, value: 6, write: true }, { register: 0x4203, value: 7, write: true }, { register: 0x4216, value: 42, write: false }]), 'each read and write of the hardware is noted in order');
  const port = await call('port', { p: 0x30 });
  const ported = after(port);
  check(port.end === CAME_BACK && ported[0x100] === 0xAB && ported[0x101] === 0xAB && ported[PPU_AT + 0x81] === 2 && ported[PPU_AT + 0x82] === 1, 'two bytes written through the work memory\'s port go to $0100 and $0101, and it moves on to $0102');
  const move = await call('move', { p: 0x00 }, { changes: [[0x7E2000, 4, 0xDDCCBBAA]] });
  check(move.end === CAME_BACK && [...after(move).subarray(0x3000, 0x3004)].join() === [0xAA, 0xBB, 0xCC, 0xDD].join() && move.registers.db === 0x7E && move.registers.a === 0xFFFF, 'MVN moves four bytes in the work memory and leaves the data bank it moved to');
  const save = await call('save', { p: 0x30 });
  check(save.end === CAME_BACK && after(save)[SRAM_AT + 0x10] === 0x5A, 'a byte written at $70:0010 is kept in the save memory');

  console.log('Where a twin can\'t follow:');
  const forever = await call('forever', {}, { limit: 1000 });
  check(forever.end === OUT_OF_STEPS && forever.steps === 1000, `a loop that never ends runs out of its instructions: ${endText(forever)}`);
  const wait = await call('wait', { p: 0x30 });
  check(wait.end === WAITS && wait.pc === of.wait.address, `WAI stops it: ${endText(wait)}`);
  const halt = await call('halt', { p: 0x30 });
  check(halt.end === STOPPED, `STP stops it: ${endText(halt)}`);
  const nowhere = await call('nowhere', { p: 0x30 });
  check(nowhere.end === NOWHERE && nowhere.detail === 0x002200, `a read where the console has nothing stops it: ${endText(nowhere)}`);
  const romwrite = await call('romwrite', { p: 0x30 });
  check(romwrite.end === NOWHERE && romwrite.detail === 0x1008000 && /wrote to \$00:8000/.test(endText(romwrite)), `a write to the ROM stops it: ${endText(romwrite)}`);
  const lost = await call('jumpout', { p: 0x30 });
  check(lost.end === ELSEWHERE && lost.detail === 0x002100, `a jump to where no code can be stops it: ${endText(lost)}`);
} finally {
  original.close();
}

check(tracked() === before, 'nothing the repository tracks has changed');
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe Super Nintendo\'s original runs one function at a time as it should.');
