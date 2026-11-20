// The tools' assembler for the PlayStation (tools/ps1/assemble.mjs), on assembly written here as GCC 2.7.2 writes it,
// with nothing from any game in it. The words were checked against LLVM's assembler for MIPS I, which copies GNU's
// short forms, when they were written: but for the nops GNU's assembler adds after a load, which LLVM's doesn't, and
// move, which the tools write as addu, as Sony's assembler did. Every instruction read.mjs writes reads back to its
// own word.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, registerOf } from '../ps1/assemble.mjs';
import { decode } from '../ps1/mips.mjs';

const wordsOf = bytes => Array.from({ length: bytes.length / 4 }, (_, i) => (bytes[i * 4] | bytes[i * 4 + 1] << 8 | bytes[i * 4 + 2] << 16 | bytes[i * 4 + 3] << 24) >>> 0);
const text = source => wordsOf(assemble(source).sections.get('.text').bytes);
const hex = words => words.map(w => w.toString(16).padStart(8, '0'));

test('every instruction read writes assembles back to its own word', () => {
  const words = [0x000940C0, 0x00041043, 0x01494004, 0x03E00008, 0x01000008, 0x0120F809, 0x01202009, 0x0000000C, 0x0007000D, 0x00070009 | 0x4, 0x00001010,
    0x00850018, 0x0085001A, 0x00851021, 0x0085102B, 0x24020005, 0x34028000, 0x27BDFFE8, 0x308200FF, 0x3C018002, 0x8082FFFF, 0x8FBF0010, 0xA5041C00,
    0xAFBF0010, 0x40086000, 0x40886000, 0x42000010, 0x4802C800, 0x4884C800, 0x4842F800, 0x48C40000, 0xC8800000, 0xE8990004, 0x4A180001, 0x4A486012,
    0x88820003, 0x98820000, 0x00852023, 0x00042027, 0x0005202B];
  for (const word of words) {
    const found = decode(word);
    if (!found || found.kind === 'branch' || found.kind === 'jump' || found.name === 'move') continue;
    assert.equal(hex(text(`.set noreorder\n${found.text}`))[0], word.toString(16).padStart(8, '0'), found.text);
  }
});

test('GCC\'s short forms, as GNU\'s assembler writes them', () => {
  assert.deepEqual(hex(text('.set noreorder\nli $2,-1\nli $2,0x8000\nli $2,0x12340000\nli $2,0x12345678\nmove $4,$16\nneg $2,$3\nnot $2,$3')),
    ['2402ffff', '34028000', '3c021234', '3c021234', '34425678', '02002021', '00031022', '00601027']);
  // an arithmetic instruction given a number becomes its immediate form, and one too large goes through $at
  assert.deepEqual(hex(text('.set noreorder\nsubu $sp,$sp,24\naddu $2,$2,1\nsltu $2,$4,6\nand $2,$2,0x12345')),
    ['27bdffe8', '24420001', '2c820006', '3c010001', '34212345', '00411024']);
  assert.deepEqual(hex(text('.set noreorder\nj $31\njal $31,$2\njal $2')), ['03e00008', '0040f809', '0040f809']);
  // a shift by a register, written as a shift by a number, is the variable shift, as GCC writes 1 << n
  assert.deepEqual(hex(text('.set noreorder\nsll $2,$2,$3\nsrl $2,$4,$5\nsra $2,$4,$5\nsll $2,$4,3')), ['00621004', '00a41006', '00a41007', '000410c0']);
});

test('a division with a register to give the result to is checked, as GNU\'s assembler checks it for a MIPS I', () => {
  assert.deepEqual(hex(text('div $2,$4,$5')), ['14a00002', '0085001a', '0007000d', '2401ffff', '14a10004', '3c018000', '14810002', '00000000', '0006000d', '00001012']);
  assert.deepEqual(hex(text('remu $2,$4,$5')), ['14a00002', '0085001b', '0007000d', '00001010']);
  assert.deepEqual(hex(text('div $0,$4,$5')), ['0085001a']);
});

test('reorder mode adds the nops the processor needs, and noreorder none', () => {
  // a branch's delay slot, a load whose register is read next, and mflo before a multiply
  assert.deepEqual(hex(text('lw $2,0($4)\naddu $2,$2,1\nj $31')), ['8c820000', '00000000', '24420001', '03e00008', '00000000']);
  assert.deepEqual(hex(text('lw $2,0($4)\naddu $3,$3,1\nj $31')), ['8c820000', '24630001', '03e00008', '00000000']);
  assert.deepEqual(hex(text('mflo $2\nmult $4,$5')), ['00001012', '00000000', '00000000', '00850018']);
  assert.deepEqual(hex(text('.set noreorder\nlw $2,0($4)\naddu $2,$2,1\nj $31\nmflo $2\nmult $4,$5')), ['8c820000', '24420001', '03e00008', '00001012', '00850018']);
  // lwl and lwr into one register need nothing between them
  assert.deepEqual(hex(text('lwl $2,3($4)\nlwr $2,0($4)')), ['88820003', '98820000']);
});

test('a name is reached through the halves of its address, which a linker fills in', () => {
  const made = assemble('lw $2,counter\nsw $2,counter\nlh $3,shorts($4)\nlw $2,table($2)\nla $5,table+8\njal sum\n.rdata\njump: .word $L3\n.text\n$L3:\nb $L3');
  const text_ = made.sections.get('.text');
  assert.deepEqual(hex(wordsOf(text_.bytes)), [
    '3c020000', '8c420000', '3c010000', 'ac220000', '3c030000', '00641821', '84630000', '3c010000', '00220821', '8c220000',
    '3c050000', '24a50000', '0c000000', '00000000', '1000ffff', '00000000']);
  assert.deepEqual(text_.relocations.map(r => `${r.at} ${r.kind} ${r.symbol}${r.addend ? `+${r.addend}` : ''}`), [
    '0 hi16 counter', '4 lo16 counter', '8 hi16 counter', '12 lo16 counter', '16 hi16 shorts', '24 lo16 shorts', '28 hi16 table', '36 lo16 table',
    '40 hi16 table+8', '44 lo16 table+8', '48 jump26 sum']);
  assert.deepEqual(made.sections.get('.rdata').relocations, [{ at: 0, kind: 'word32', symbol: '$L3', addend: 0 }]);
  assert.deepEqual(made.symbols.get('$L3'), { section: '.text', at: 56, global: false });
});

test('what maspsx writes: $gp, the halves of a number, traps and 16 bits as written', () => {
  const made = assemble('.set noreorder\nlui $at,%hi(40000)\nlhu $2,%lo(40000)($at)\nlui $at,%hi(-40000)\nsw $5,%lo(-40000)($at)\n'
    + 'tge $zero,$zero,93\nteq $4,$5\naddiu $6,$zero,-32768 & 0xFFFF\naddiu $2,$3,0xFFFF\nori $2,$2,%lo(0x18000)\n'
    + 'lw $2,%gp_rel(counter)($gp)\nsw $3,%gp_rel(flag+4)($gp)\nla $4,%gp_rel(counter)($gp)\naddu $2,$3,0x8000');
  const text_ = made.sections.get('.text');
  assert.deepEqual(hex(wordsOf(text_.bytes)), ['3c010001', '94229c40', '3c01ffff', 'ac2563c0', '00001770', '00850034', '24068000', '2462ffff',
    '34428000', '8f820000', 'af830000', '27840000', '34018000', '00611021']);
  assert.deepEqual(text_.relocations.map(r => `${r.at} ${r.kind} ${r.symbol}${r.addend ? `+${r.addend}` : ''}`), ['36 gprel16 counter', '40 gprel16 flag+4', '44 gprel16 counter']);
  assert.throws(() => assemble('lw $2,%gp_rel(16)($gp)'), /%gp_rel takes a name/);
});

test('a name outside the code has the size of its values, without the zeros that line up the next', () => {
  const made = assemble('.rdata\n$LC0:\n.ascii "ab\\000"\n.align 2\n$LC1:\n.ascii "cdef"\n.word 1\nempty:\n.section .bss\nkept:\n.space 12');
  assert.deepEqual(['$LC0', '$LC1', 'empty', 'kept'].map(name => made.symbols.get(name).size), [3, 8, 0, 12]);
});

test('functions, values and what can\'t be assembled', () => {
  const made = assemble('.globl sum\n.ent sum\nsum:\naddu $2,$4,$5\nj $31\n.end sum\n.data\nname: .asciiz "a\\n"\n.align 2\nhalf: .half 0x1234\n.comm big,8');
  assert.deepEqual(made.functions, [{ name: 'sum', section: '.text', at: 0, size: 12 }]);
  assert.equal(made.symbols.get('sum').global, true);
  assert.deepEqual([...made.sections.get('.data').bytes], [0x61, 0x0A, 0, 0, 0x34, 0x12]);
  assert.deepEqual(made.symbols.get('big'), { section: '.bss', at: 0, global: true, size: 8 });
  assert.throws(() => assemble('frobnicate $2'), /Line 1, "frobnicate \$2": "frobnicate" isn't an instruction the assembler knows/);
  assert.throws(() => assemble('b nowhere'), /goes to nowhere, which this file doesn't define/);
  assert.equal(registerOf('$sp'), 29);
  assert.equal(registerOf('$s8'), 30);
  assert.equal(registerOf('$32'), null);
});
