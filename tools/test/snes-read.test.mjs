// What `read` prints for a Super Nintendo game (tools/snes/read.mjs): every way the 65816 reaches a value, written as
// its assembler writes it, and the made-up cartridge of the function check's test (made-up-snes.mjs), with nothing
// from any game in it, read with the code map the function finder makes of it, each instruction at the length its
// mode gives it; and the sound processor's SPC700 (tools/snes/spc700.mjs), on the program the second made-up
// cartridge gives it and on each way of reaching a value. test:real-snes reads that program where Snes9x runs it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, lengthOf } from '../snes/65816.mjs';
import { findFunctions, snesProgram } from '../snes/functions.mjs';
import { instructionText, listing, readSnes, snesResolve, spcListing } from '../snes/read.mjs';
import { decode, lengthOf as spcLength, TEMPLATES } from '../snes/spc700.mjs';
import { madeUpCartridge, SOUND_AT, SOUND_PROGRAM } from './made-up-snes.mjs';

const { rom, labels } = madeUpCartridge();
const copy = Buffer.from(rom);
const codeMap = { functions: findFunctions(copy) };
const at = name => labels[name] & 0x7FFF;

test('writes each way of reaching a value as the 65816\'s assembler does', () => {
  // an instruction's bytes, read at $80:8000 in a mode
  const text = (bytes, mode = 'a16i16') => {
    const length = lengthOf(bytes[0], mode);
    assert.equal(length, bytes.length, `${INSTRUCTIONS[bytes[0]].name} is ${bytes.length} bytes in ${mode}`);
    return instructionText(bytes[0], bytes.slice(1).reduce((n, b, i) => n | b << (8 * i), 0), 0x808000, length);
  };
  assert.equal(text([0xEA]), 'NOP');
  assert.equal(text([0x0A]), 'ASL A');
  assert.equal(text([0xA9, 0x34, 0x12]), 'LDA #$1234');
  assert.equal(text([0xA9, 0x34], 'a8i16'), 'LDA #$34');
  assert.equal(text([0xA2, 0x34], 'a16i8'), 'LDX #$34');
  assert.equal(text([0xC2, 0x30]), 'REP #$30');
  assert.equal(text([0xF4, 0x34, 0x12]), 'PEA $1234');
  assert.equal(text([0xA5, 0x10]), 'LDA $10');
  assert.equal(text([0xB5, 0x10]), 'LDA $10,X');
  assert.equal(text([0xB6, 0x10]), 'LDX $10,Y');
  assert.equal(text([0xB2, 0x10]), 'LDA ($10)');
  assert.equal(text([0xA1, 0x10]), 'LDA ($10,X)');
  assert.equal(text([0xB1, 0x10]), 'LDA ($10),Y');
  assert.equal(text([0xA7, 0x10]), 'LDA [$10]');
  assert.equal(text([0xB7, 0x10]), 'LDA [$10],Y');
  assert.equal(text([0xA3, 0x03]), 'LDA $03,S');
  assert.equal(text([0xB3, 0x03]), 'LDA ($03,S),Y');
  assert.equal(text([0xAD, 0x00, 0x21]), 'LDA $2100');
  assert.equal(text([0xBD, 0x00, 0x21]), 'LDA $2100,X');
  assert.equal(text([0xB9, 0x00, 0x21]), 'LDA $2100,Y');
  assert.equal(text([0xAF, 0x56, 0x34, 0x7E]), 'LDA $7E3456');
  assert.equal(text([0xBF, 0x56, 0x34, 0x7E]), 'LDA $7E3456,X');
  assert.equal(text([0x6C, 0x10, 0x00]), 'JMP ($0010)');
  assert.equal(text([0x7C, 0x00, 0x90]), 'JMP ($9000,X)');
  assert.equal(text([0xDC, 0x10, 0x00]), 'JML [$0010]');
  assert.equal(text([0xFC, 0x00, 0x90]), 'JSR ($9000,X)');
  assert.equal(text([0x22, 0x56, 0x34, 0x12]), 'JSL $123456');
  assert.equal(text([0xD0, 0xFE]), 'BNE $8000');
  assert.equal(text([0x80, 0x10]), 'BRA $8012');
  assert.equal(text([0x82, 0xFD, 0xFF]), 'BRL $8000');
  assert.equal(text([0x62, 0x00, 0x01]), 'PER $8103');
  assert.equal(text([0x54, 0x7E, 0x7F]), 'MVN $7F,$7E');
  assert.equal(text([0xD4, 0x10]), 'PEI ($10)');
});

test('reads a function at the lengths its modes give, saying where its mode changes', async () => {
  const { text } = await readSnes({ codeMap, bytes: copy, what: 'sub_008018', flags: {} });
  const lines = text.split('\n');
  assert.match(lines[0], /^sub_008018, 72 bytes at 00000018 in the ROM\.$/);
  assert.ok(lines.includes('; A, X and Y of 16 bits'));
  assert.ok(lines.includes('$00:8018  A9 02 00    LDA #$0002'));
  assert.ok(lines.includes('; A of 8 bits, X and Y of 16'));
  assert.ok(lines.includes('$00:8023  A9 5A       LDA #$5A'));
  assert.ok(lines.some(line => /^\$00:801E {2}20 60 80 {4}JSR \$8060 +; sub_008060$/.test(line)), 'a call says the code map\'s name of what it calls');
  assert.ok(lines.includes('$00:805F  6B          RTL'));
});

test('a switch\'s table is bytes, and a function whose mode isn\'t known says so', async () => {
  const { text } = await readSnes({ codeMap, bytes: copy, what: '$00:80DE', flags: {} });
  assert.ok(text.includes('JMP ($8104,X)') && text.includes('LDA #$001E'));
  const handler = (await readSnes({ codeMap, bytes: copy, what: '000000ED', flags: {} })).text;
  assert.ok(handler.includes('doesn\'t know the mode it starts in') && handler.includes('SEP #$20') && handler.includes('RTI'));
  // pick, then what its code doesn't reach: the interrupt's handler and the values after it, all of it as bytes
  const lines = listing(copy, at('pick'), at('shine') - at('pick'), 'a16i16');
  assert.deepEqual(lines.slice(0, 7).map(line => line.text), ['JMP ($8104,X)', 'LDA #$000A', 'RTS', 'LDA #$0014', 'RTS', 'LDA #$001E', 'RTS']);
  assert.ok(lines.slice(7).every(line => line.text.startsWith('.byte') && line.note === 'not reached by the code'));
  assert.deepEqual(lines.slice(7).flatMap(line => line.bytes), [...rom.subarray(at('nmi'), at('shine'))]);
});

test('--mode reads a function the code map doesn\'t have, and --bytes as many bytes', async () => {
  const { text } = await readSnes({ codeMap, bytes: copy, what: 'sub_00810E', flags: { mode: 'a8i8' } });
  assert.ok(text.includes('LDA #$12') && text.includes('as --mode says'));
  assert.equal((await readSnes({ codeMap, bytes: copy, what: '00000060', flags: { bytes: 3 } })).text.split('\n').filter(line => line.startsWith('$')).length, 2);
  await assert.rejects(readSnes({ codeMap, bytes: copy, what: '00000060', flags: { frame: 10 } }), /--frame goes with --spc/);
});

test('a function is named by its place in the ROM, its address in any bank that shows it, or a label', () => {
  const { map } = snesProgram(copy);
  assert.equal(snesResolve(codeMap, map, '00000060'), 0x60);
  assert.equal(snesResolve(codeMap, map, '$80:8060'), 0x60);
  assert.equal(snesResolve(codeMap, map, '0x008060'), 0x60);
  assert.equal(snesResolve(codeMap, map, 'CODE_808060'), 0x60);
  assert.throws(() => snesResolve(codeMap, map, '$7E:1234'), /isn't in the cartridge's ROM/);
});

test('the SPC700\'s instructions, each with its one length, written as its assembler writes them', () => {
  assert.equal(TEMPLATES.length, 256);
  const text = (bytes, address = 0x0400) => {
    assert.equal(spcLength(bytes[0]), bytes.length, TEMPLATES[bytes[0]]);
    return decode(Uint8Array.from(bytes), address, address).text;
  };
  assert.equal(text([0x00]), 'NOP');
  assert.equal(text([0xE8, 0x12]), 'MOV A,#$12');
  assert.equal(text([0xE4, 0x12]), 'MOV A,$12');
  assert.equal(text([0xE5, 0x34, 0x12]), 'MOV A,$1234');
  assert.equal(text([0xF4, 0x12]), 'MOV A,$12+X');
  assert.equal(text([0xF5, 0x34, 0x12]), 'MOV A,$1234+X');
  assert.equal(text([0xF6, 0x34, 0x12]), 'MOV A,$1234+Y');
  assert.equal(text([0xE6]), 'MOV A,(X)');
  assert.equal(text([0xBF]), 'MOV A,(X)+');
  assert.equal(text([0xE7, 0x12]), 'MOV A,[$12+X]');
  assert.equal(text([0xF7, 0x12]), 'MOV A,[$12]+Y');
  assert.equal(text([0xFA, 0x12, 0x34]), 'MOV $34,$12', 'the byte read comes first, the one written second');
  assert.equal(text([0x8F, 0x12, 0x34]), 'MOV $34,#$12', 'the value comes first, the place written second');
  assert.equal(text([0x09, 0x12, 0x34]), 'OR $34,$12');
  assert.equal(text([0x18, 0x12, 0x34]), 'OR $34,#$12');
  assert.equal(text([0x02, 0x12]), 'SET1 $12.0');
  assert.equal(text([0xF2, 0x12]), 'CLR1 $12.7');
  assert.equal(text([0x03, 0x12, 0xFD]), 'BBS $12.0,$0400');
  assert.equal(text([0x2E, 0x12, 0xFD]), 'CBNE $12,$0400');
  assert.equal(text([0xFE, 0xFE]), 'DBNZ Y,$0400');
  assert.equal(text([0x0A, 0x34, 0xB2]), 'OR1 C,$1234.5');
  assert.equal(text([0x2A, 0x34, 0xB2]), 'OR1 C,/$1234.5');
  assert.equal(text([0xBA, 0x12]), 'MOVW YA,$12');
  assert.equal(text([0x1F, 0x34, 0x12]), 'JMP [$1234+X]');
  assert.equal(text([0x4F, 0x20]), 'PCALL $20');
  assert.equal(text([0x01]), 'TCALL 0');
  assert.equal(text([0xF0, 0x10]), 'BEQ $0412');
  assert.equal(decode(Uint8Array.from([0x3F, 0x00, 0x08]), 0, 0).target, 0x0800);
  assert.equal(decode(Uint8Array.from([0x4F, 0x20]), 0, 0).target, 0xFF20);
});

test('the program the made-up cartridge gives the sound processor, read where it runs', () => {
  const memory = new Uint8Array(0x10000);
  memory.set(SOUND_PROGRAM, SOUND_AT);
  assert.deepEqual(spcListing(memory, SOUND_AT, SOUND_PROGRAM.length).map(line => line.text), ['MOV A,#$12', 'MOV $F4,A', 'MOV X,#$34', 'CALL $040B', 'BRA $0409', 'INC A', 'RET']);
});
