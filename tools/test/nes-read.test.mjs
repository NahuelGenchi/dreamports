// The 6502 decoder (tools/nes/6502.mjs) and what `read` prints for an NES game (tools/nes/read.mjs), on the two small
// programs written here, with nothing from any game in them (made-up-nes.mjs), each with the code map the function
// finder makes of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, LENGTH, decode } from '../nes/6502.mjs';
import { findFunctions } from '../nes/functions.mjs';
import { listing, nesReader, nesResolve, readNes, written } from '../nes/read.mjs';
import { madeUpNes, madeUpUnrom } from './made-up-nes.mjs';

const BANK = 0x4000, HEADER = 16;
const at = (address, bank = 3) => bank * BANK + (address & 0x3FFF);

// the UNROM program with more put in its last bank, at addresses nothing else uses
function unromWith(extra) {
  const rom = Buffer.from(madeUpUnrom());
  for (const [address, bytes] of extra) Buffer.from(bytes).copy(rom, HEADER + at(address));
  return rom;
}
const readerOf = rom => {
  const functions = findFunctions(rom);
  return { functions, reader: nesReader(rom, functions) };
};
// the lines read prints for the function at an address, or for `length` bytes from it
const linesOf = (reader, offset, length = reader.functionAt(offset).size, entries) => written(reader, listing(reader, offset, length, entries));

test('every opcode is an instruction with a length, and 151 of them are documented', () => {
  assert.equal(INSTRUCTIONS.length, 256);
  assert.ok(INSTRUCTIONS.every(({ name, mode }) => /^[A-Z]{3}$/.test(name) && LENGTH[mode] >= 1));
  assert.equal(INSTRUCTIONS.filter(i => !i.undocumented).length, 151);
  // the documented instructions, each with how many opcodes it has
  const counts = {};
  for (const { name, undocumented } of INSTRUCTIONS) if (!undocumented) counts[name] = (counts[name] ?? 0) + 1;
  assert.equal(Object.keys(counts).length, 56);
  assert.deepEqual([counts.LDA, counts.STA, counts.JMP, counts.JSR, counts.BIT, counts.NOP, counts.LDX, counts.ASL], [8, 7, 2, 1, 2, 1, 5, 5]);
});

test('writes each addressing mode as an assembler does', () => {
  const text = (bytes, address) => decode(Buffer.from(bytes), 0, address).text;
  assert.equal(text([0x60]), 'RTS');
  assert.equal(text([0x0A]), 'ASL A');
  assert.equal(text([0xA9, 0x0F]), 'LDA #$0F');
  assert.equal(text([0xA5, 0x10]), 'LDA $10');
  assert.equal(text([0xB5, 0x10]), 'LDA $10,X');
  assert.equal(text([0xB6, 0x10]), 'LDX $10,Y');
  assert.equal(text([0xA1, 0x10]), 'LDA ($10,X)');
  assert.equal(text([0xB1, 0x10]), 'LDA ($10),Y');
  assert.equal(text([0x8D, 0x06, 0x20]), 'STA $2006');
  assert.equal(text([0xBD, 0x00, 0xC1]), 'LDA $C100,X');
  assert.equal(text([0xB9, 0x00, 0xC1]), 'LDA $C100,Y');
  assert.equal(text([0x6C, 0x04, 0x00]), 'JMP ($0004)');
  assert.equal(text([0x20, 0x9C, 0xC3]), 'JSR $C39C');
});

test('a branch is written as the address it goes to, on or back', () => {
  assert.equal(decode(Buffer.from([0xD0, 0x05]), 0, 0xC100).text, 'BNE $C107');
  assert.equal(decode(Buffer.from([0x10, 0xFB]), 0, 0xC100).text, 'BPL $C0FD');
  assert.equal(decode(Buffer.from([0xF0, 0x7F]), 0, 0xFFF0).operand, 0x0071);
});

test('names an undocumented instruction and says it is one, and stops at bytes that run out', () => {
  assert.deepEqual(decode(Buffer.from([0xA7, 0x10]), 0), { name: 'LAX', mode: 'zp', undocumented: true, length: 2, operand: 0x10, text: 'LAX $10' });
  assert.equal(decode(Buffer.from([0x02]), 0).name, 'JAM');
  assert.equal(decode(Buffer.from([0xEB, 0x01]), 0).undocumented, true);
  assert.equal(decode(Buffer.from([0x20, 0x9C]), 0), null);
  assert.equal(decode(Buffer.from([0x60]), 1), null);
});

test('reads the one-bank program whole, as the finder walked it', () => {
  const { rom } = madeUpNes();
  const { functions, reader } = readerOf(rom);
  const walked = new Map();
  findFunctions(rom, functions, new Set(), { walked });
  let instructions = 0;
  for (const f of functions) {
    const lines = listing(reader, f.address, f.size);
    assert.equal(lines.reduce((sum, line) => sum + line.size, 0), f.size);
    assert.ok(lines.every(line => line.kind === 'code' && !line.instruction.undocumented));
    instructions += lines.length;
    for (const line of lines) assert.equal(walked.get(line.offset), line.size);
  }
  assert.equal(instructions, walked.size);
  // shown at $C000, where its reset vector says it starts
  assert.deepEqual(linesOf(reader, 0).slice(0, 4), ['C000:  78        SEI', 'C001:  D8        CLD', 'C002:  A2 40     LDX #$40', 'C004:  8E 17 40  STX $4017']);
  assert.ok(linesOf(reader, 0).at(-1).endsWith(`JMP $${reader.where(functions[0].size - 3)}  ; sub_C000 + ${functions[0].size - 3}`));
});

test('a function in a switched bank is read from that bank, with its bank before each address', () => {
  const { reader } = readerOf(madeUpUnrom());
  assert.deepEqual(linesOf(reader, at(0x8000, 1)), ['01:8000:  A9 00     LDA #$00', '01:8002:  60        RTS']);
  assert.deepEqual(linesOf(reader, at(0x8010, 2)), ['02:8010:  A2 01     LDX #$01', '02:8012:  60        RTS']);
});

test('a call from the last bank is named by the bank the finder followed it into', () => {
  const { reader } = readerOf(madeUpUnrom());
  const lines = linesOf(reader, at(0xC000));
  assert.equal(lines[0], 'C000:  78        SEI');
  assert.ok(lines.includes('C007:  20 00 80  JSR $8000  ; sub_01_8000, in bank 01, where the tools followed it'));
  assert.ok(lines.includes('C00C:  20 90 C0  JSR $C090  ; sub_C090'));
  // bank 0 has the same code at $8010, and nothing switches it in
  assert.ok(lines.includes('C00F:  20 10 80  JSR $8010  ; sub_02_8010, in bank 02, where the tools followed it'));
  assert.equal(lines.at(-1), 'C01E:  6C 00 00  JMP ($0000)  ; the tools followed it to sub_C200 or sub_C210');
});

test('a call into a switched bank nothing followed names every bank with a function there', () => {
  const rom = unromWith([[0xC310, [0xA9, 0x00, 0x20, 0x10, 0x80, 0x60]]]);
  const { reader } = readerOf(rom);
  assert.deepEqual(linesOf(reader, at(0xC310)), [
    'C310:  A9 00     LDA #$00',
    'C312:  20 10 80  JSR $8010  ; in whichever bank is switched in, where the code map has sub_02_8010',
    'C315:  60        RTS',
  ]);
  const text = readNes({ game: 'made-up', what: 'sub_C310', original: { name: 'Made-up' }, codeMap: { functions: findFunctions(rom) }, bytes: rom, flags: {} }).text;
  assert.match(text, /names the bank the tools followed it into when they found the functions, or else every bank with a function at that address/);
});

test('the tables the finder follows are data: a list of addresses after a call, and low and high bytes', () => {
  const { reader } = readerOf(madeUpUnrom());
  assert.deepEqual(linesOf(reader, at(0xC060)), [
    'C060:  20 70 C0  JSR $C070  ; sub_C070',
    'C063:  40 C2     .word $C240  ; sub_C240',
    'C065:  50 C2     .word $C250  ; sub_C250',
  ]);
  assert.equal(linesOf(reader, at(0xC040)).at(-1), 'C04A:  60        RTS  ; the tools followed it to sub_C220 or sub_C230');
  assert.deepEqual(linesOf(reader, at(0xC140), 4), ['C140:            .byte $1F, $2F, $C2, $C2']);
  assert.deepEqual(linesOf(reader, at(0xC120), 4), ['C120:  00 C2     .word $C200  ; sub_C200', 'C122:  10 C2     .word $C210  ; sub_C210']);
});

test('bytes no code reaches say so, as instructions when they read as documented ones and as bytes when not', () => {
  const { reader } = readerOf(unromWith([[0xC350, [0xE8, 0x60]]]));
  assert.deepEqual(linesOf(reader, at(0xC350), 2, []), ['C350:  E8        INX  ; no code the tools followed reaches this', 'C351:  60        RTS']);
  assert.deepEqual(linesOf(reader, at(0xC352), 3, []), ['C352:            .byte $FF, $FF, $FF  ; no code the tools followed reaches this']);
});

test('an undocumented instruction the code reaches is named and marked', () => {
  const { reader } = readerOf(unromWith([[0xC340, [0xA7, 0x10, 0x60]]]));
  assert.deepEqual(linesOf(reader, at(0xC340), 3), ['C340:  A7 10     LAX $10  ; undocumented', 'C342:  60        RTS']);
});

test('an instruction a branch lands inside is read both ways, and one that runs past the end says so', () => {
  // BEQ over LDA #$01 and into the BIT, whose last two bytes are LDA #$02
  const { reader } = readerOf(unromWith([[0xC320, [0xF0, 0x03, 0xA9, 0x01, 0x2C, 0xA9, 0x02, 0x60]]]));
  assert.equal(reader.functionAt(at(0xC320)).size, 8);
  assert.deepEqual(linesOf(reader, at(0xC320)), [
    'C320:  F0 03     BEQ $C325',
    'C322:  A9 01     LDA #$01',
    'C324:  2C A9 02  BIT $02A9',
    'C325:  A9 02     LDA #$02  ; inside the instruction above, where the code also lands',
    'C327:  60        RTS',
  ]);
  const cut = listing(reader, at(0xC320), 5);
  assert.equal(cut.at(-1).past, 2);
  assert.match(written(reader, cut).at(-1), /^C324: {2}2C A9 02 {2}BIT \$02A9 {2}; its last 2 bytes are past the end, where the next function starts$/);
});

test('a function is named by its bank and address, a label, an address or an offset', () => {
  const { functions, reader } = readerOf(madeUpUnrom());
  const offset = what => nesResolve(reader, functions, what, 'made-up').offset;
  assert.equal(offset('sub_02_8010'), at(0x8010, 2));
  assert.equal(offset('02:8010'), at(0x8010, 2));
  assert.equal(offset('00:8010'), at(0x8010, 0));
  assert.equal(offset('sub_C090'), at(0xC090));
  assert.equal(offset('$C090'), at(0xC090));
  assert.equal(offset('0xC090'), at(0xC090));
  assert.equal(offset('0000C090'), at(0xC090));
  // an address in a switched bank with no bank: the one bank where the code map has a function there
  assert.equal(offset('8010'), at(0x8010, 2));
  assert.match(nesResolve(reader, functions, '8010', 'made-up').said, /bank 02 is the only one/);
  assert.throws(() => offset('8020'), /say which, as 00:8020/);
  assert.throws(() => offset('03:8010'), /the last bank, 03, is the one at \$C000-\$FFFF/);
  assert.throws(() => offset('nothing'), /isn't a bank and an address/);
});

test('read gives the whole function with what it is, keeps it by its offset, and takes --bytes alone', () => {
  const rom = madeUpUnrom();
  const codeMap = { functions: findFunctions(rom) };
  const read = (what, flags = {}) => readNes({ game: 'made-up', what, original: { name: 'Made-up' }, codeMap, bytes: rom, flags });
  const whole = read('sub_C090');
  assert.equal(whole.key, '0000C090');
  assert.match(whole.text, /^sub_C090, at \$C090, in Made-up: the whole function, 7 bytes, as the code map has it\.\nOffset 0000C090 in the program/);
  assert.match(whole.text, /It's in bank 03, the last, which is always at \$C000-\$FFFF/);
  assert.match(whole.text, /\nC090: {2}85 10 {5}STA \$10\n/);
  assert.ok(whole.has('sub_C090') && whole.has('$C092') && !whole.has('sub_C200') && !whole.has('a word'));
  assert.match(read('01:8000').text, /It's in bank 01, which the cartridge switches in at \$8000-\$BFFF/);
  assert.match(read('$C092').text, /\$C092 is inside it\./);
  assert.match(read('sub_C000', { bytes: 3 }).text, /3 bytes from there, as --bytes asks/);
  assert.match(read('sub_C000', { bytes: 0x5000 }).text, /16384 bytes from there, up to the end of its bank/);
  assert.throws(() => read('sub_C000', { thumb: true }), /--thumb is for a Game Boy Advance game/);
  assert.match(readNes({ game: 'made-up', what: 'C000', original: { name: 'Made-up' }, codeMap: { functions: findFunctions(madeUpNes().rom) }, bytes: madeUpNes().rom, flags: {} }).text, /one bank of 16 KB and never switches/);
});

test('a cartridge whose banks the tools can\'t follow is refused', () => {
  const rom = Buffer.from(madeUpUnrom());
  rom[6] = 0x40;
  assert.throws(() => nesReader(rom, []), /mapper 4/);
});
