// maspsx's rules in JavaScript (tools/ps1/maspsx.mjs), on made-up assembly only, one or more cases for each rule. Each
// case's lines out are what maspsx itself (https://github.com/mkst/maspsx at 4ffa8b5106f9780d5d4aa7609f184949433ddbbc)
// wrote for its lines in, without the comments, as maspsx's own tests compare them. When the port was written, every
// case of maspsx's own tests and 12,000 random made-up functions with random options gave the same lines, comments and
// all, through both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Passthrough, Processor, expandLoadImmediate, isLabel, lcommLayout, lineLoadsFromReg, linesOf, maspsx, optionsFor,
  stripComments, usesAt,
} from '../ps1/maspsx.mjs';

/** What a case is compared on: its instructions and directives, as maspsx's tests strip comments. */
const clean = lines => lines.filter(line => !line.startsWith('#')).map(line => line.split('#')[0].trim());

/** [what, options, lines in, lines out] */
const CASES = [
  ['li writes ori for 0 to 32767 before 2.50', { expandLi: true },
    ['li\t$2,0', 'li\t$3,32767'],
    ['ori\t$2,$zero,0', 'ori\t$3,$zero,32767']],
  ['li writes addiu for 0 to 32767 from 2.50', { expandLi: true, liSmallUsesAddiu: true },
    ['li\t$2,0', 'li\t$3,32767'],
    ['addiu\t$2,$zero,0', 'addiu\t$3,$zero,32767']],
  ['li writes ori up to 65535, lui and ori above, addiu for small negatives', { expandLi: true },
    ['li\t$2,40000', 'li\t$3,0x12345', 'li\t$4,0x30000', 'li\t$5,-5', 'li\t$6,-32768', 'li\t$7,-70000', 'li\t$8,-65536'],
    [
      'ori\t$2,$zero,40000', 'lui\t$3,(74565 >> 16) & 0xFFFF', 'ori\t$3,$3,74565 & 0xFFFF',
      'lui\t$4,(196608 >> 16) & 0xFFFF', 'addiu\t$5,$zero,-5', 'addiu\t$6,$zero,-32768 & 0xFFFF',
      'lui\t$7,(-70000 >> 16) & 0xFFFF', 'ori\t$7,$7,-70000 & 0xFFFF', 'lui\t$8,(-65536 >> 16) & 0xFFFF'
    ]],
  ['li is left to the assembler when not expanded', {},
    ['li\t$2,0x12345'],
    ['li\t$2,0x12345']],
  ['move is addu with $zero', {},
    ['move\t$2,$4'],
    ['addu\t$2,$4,$zero']],
  ['a load whose register is read next waits a slot', {},
    ['lw\t$2,4($4)', 'addu\t$3,$2,$5'],
    ['lw\t$2,4($4)', 'nop', 'addu\t$3,$2,$5']],
  ['a load whose register is not read next does not', {},
    ['lw\t$2,4($4)', 'addu\t$3,$6,$5'],
    ['lw\t$2,4($4)', 'addu\t$3,$6,$5']],
  ['the slot comes after a label between the two', {},
    ['lw\t$2,0($4)', '$L5:', 'addu\t$3,$2,$2'],
    ['lw\t$2,0($4)', '$L5:', 'nop', 'addu\t$3,$2,$2']],
  ['a store of the loaded register needs the slot too', {},
    ['lb\t$2,1($4)', 'sb\t$2,0($5)'],
    ['lb\t$2,1($4)', 'nop', 'sb\t$2,0($5)']],
  ['an aligned load into the same register waits only before 2.30', { nopLwLw: true },
    ['lw\t$2,0($4)', 'lw\t$2,4($6)'],
    ['lw\t$2,0($4)', 'nop', 'lw\t$2,4($6)']],
  ['and not from 2.30', {},
    ['lw\t$2,0($4)', 'lw\t$2,4($6)'],
    ['lw\t$2,0($4)', 'lw\t$2,4($6)']],
  ['the last load of a line of two decides the slot', {},
    ['lw\t$2,0($4);lw\t$3,4($4)', 'addu\t$6,$3,$3'],
    ['lw\t$2,0($4);lw\t$3,4($4)', 'nop', 'addu\t$6,$3,$3']],
  ['a symbol with a register goes through $at', {},
    ['lw\t$2,table($4)', 'addu\t$3,$2,$2'],
    [
      '.set\tnoat', 'lui\t$at,%hi(table)', 'addu\t$at,$at,$4', 'lw\t$2,%lo(table)($at)', '.set\tat', 'nop',
      'addu\t$3,$2,$2'
    ]],
  ['before 2.30 with addiu, and a slot before the expansion', { addiuAt: true, nopAtExpansion: true },
    ['lw\t$2,0($5)', 'lw\t$3,table($2)'],
    [
      'lw\t$2,0($5)', 'nop', '.set\tnoat', 'lui\t$at,%hi(table)', 'addiu\t$at,$at,%lo(table)', 'addu\t$at,$at,$2',
      'lw\t$3,0x0($at)', '.set\tat'
    ]],
  ['a store through $at waits for a load only before 2.30', {},
    ['lw\t$2,0($4)', 'sw\t$2,table'],
    ['lw\t$2,0($4)', 'sw\t$2,table']],
  ['the same before 2.30', { nopAtExpansion: true },
    ['lw\t$2,0($4)', 'sw\t$2,table'],
    ['lw\t$2,0($4)', 'nop', 'sw\t$2,table']],
  ['an offset past 16 bits goes through $at', {},
    ['lhu\t$2,40000($4)', 'sw\t$5,-40000($6)', 'sw\t$5,32767($6)'],
    [
      '.set\tnoat', 'lui\t$at,%hi(40000)', 'addu\t$at,$4,$at', 'lhu\t$2,%lo(40000)($at)', '.set\tat', '.set\tnoat',
      'lui\t$at,%hi(-40000)', 'addu\t$at,$6,$at', 'sw\t$5,%lo(-40000)($at)', '.set\tat', 'sw\t$5,32767($6)'
    ]],
  ['a store of a symbol with a register is the assembler\'s from 2.30', {},
    ['sw\t$2,table($4)'],
    ['sw\t$2,table($4)']],
  ['and expanded with addiu before', { addiuAt: true },
    ['sw\t$2,table($4)'],
    [
      '.set\tnoat', 'lui\t$at,%hi(table)', 'addiu\t$at,$at,%lo(table)', 'addu\t$at,$at,$4', 'sw\t$2,0x0($at)',
      '.set\tat'
    ]],
  ['a %lo load is left to the assembler', {},
    ['lw\t$2,%lo(table)($4)', 'addu\t$3,$2,$2'],
    ['lw\t$2,%lo(table)($4)', 'nop', 'addu\t$3,$2,$2']],
  ['a branch or jump gets its slot while reordering', {},
    ['.set\treorder', 'beq\t$2,$3,$L2', 'jal\tfunction', '.set\tnoreorder', 'j\t$31', 'nop'],
    ['beq\t$2,$3,$L2', 'nop', 'jal\tfunction', 'nop', 'j\t$31', 'nop']],
  ['two instructions between mflo and a mult', {},
    ['mflo\t$2', 'mult\t$3,$4'],
    ['mflo\t$2', 'nop', 'nop', 'mult\t$3,$4']],
  ['none before 2.30', { nopMfloMfhi: false },
    ['mflo\t$2', 'mult\t$3,$4'],
    ['mflo\t$2', 'mult\t$3,$4']],
  ['one instruction between, then a nop', {},
    ['mflo\t$2', 'addu\t$5,$6,$7', 'mult\t$3,$4'],
    ['mflo\t$2', 'addu\t$5,$6,$7', 'nop', 'mult\t$3,$4']],
  ['one between that is a move', {},
    ['mfhi\t$2', 'move\t$5,$6', 'divu\t$zero,$3,$4'],
    ['mfhi\t$2', 'addu\t$5,$6,$zero', 'nop', 'divu\t$zero,$3,$4']],
  ['one between followed by a label', {},
    ['mflo\t$2', 'addu\t$5,$6,$7', '$L3:', 'mult\t$3,$4'],
    ['mflo\t$2', 'addu\t$5,$6,$7', '$L3:', 'nop', 'mult\t$3,$4']],
  ['one between that is a branch', {},
    ['mflo\t$2', 'bne\t$5,$6,$L4', 'mult\t$3,$4'],
    ['mflo\t$2', 'bne\t$5,$6,$L4', 'nop', 'mult\t$3,$4']],
  ['one between while not reordering', {},
    ['mflo\t$2', '.set\tnoreorder', 'addu\t$5,$6,$7', 'mult\t$3,$4'],
    ['mflo\t$2', 'nop', '.set\tnoreorder', 'addu\t$5,$6,$7', 'mult\t$3,$4']],
  ['one between that goes through $at', {},
    ['mflo\t$2', 'sw\t$5,table', 'mult\t$3,$4'],
    ['mflo\t$2', 'sw\t$5,table', 'mult\t$3,$4']],
  ['an li of one instruction between', { expandLi: true },
    ['mflo\t$2', 'li\t$5,1', 'mult\t$3,$4'],
    ['mflo\t$2', 'ori\t$5,$zero,1', 'nop', 'mult\t$3,$4']],
  ['an li of two between', { expandLi: true },
    ['mflo\t$2', 'li\t$5,0x12345', 'mult\t$3,$4'],
    ['mflo\t$2', 'lui\t$5,(74565 >> 16) & 0xFFFF', 'ori\t$5,$5,74565 & 0xFFFF', 'mult\t$3,$4']],
  ['div is div with $zero and mflo, with a slot for the result', {},
    ['div\t$2,$3,$4', 'addu\t$5,$2,$2'],
    ['div\t$zero,$3,$4', 'mflo\t$2', 'nop', 'addu\t$5,$2,$2']],
  ['rem takes mfhi, and remu and divu their own', {},
    ['rem\t$2,$3,$4', 'divu\t$5,$6,$7', 'remu\t$8,$9,$10', 'nop'],
    [
      'div\t$zero,$3,$4', 'mfhi\t$2', 'nop', 'nop', 'divu\t$zero,$6,$7', 'mflo\t$5', 'nop', 'nop', 'divu\t$zero,$9,$10',
      'mfhi\t$8', 'nop'
    ]],
  ['a div into $zero is left as it is', {},
    ['div\t$zero,$3,$4'],
    ['div\t$zero,$3,$4']],
  ['div with its checks', { expandDiv: true },
    ['div\t$2,$3,$4', 'nop'],
    [
      '.set\tnoat', 'div\t$zero,$3,$4', 'bnez\t$4,.L_NOT_DIV_BY_ZERO_0', 'nop', 'break\t0x7', '.L_NOT_DIV_BY_ZERO_0:',
      'addiu\t$at,$zero,-1', 'bne\t$4,$at,.L_DIV_BY_POSITIVE_SIGN_0', 'lui\t$at,0x8000',
      'bne\t$3,$at,.L_DIV_BY_POSITIVE_SIGN_0', 'nop', 'break\t0x6', '.L_DIV_BY_POSITIVE_SIGN_0:', 'mflo\t$2', '.set\tat',
      'nop'
    ]],
  ['div with its checks and tge, as 2.05 and 2.08', { expandDiv: true, divUsesTge: true },
    ['div\t$2,$3,$4', 'nop'],
    [
      '.set\tnoat', 'div\t$zero,$3,$4', 'bnez\t$4,.L_NOT_DIV_BY_ZERO_0', 'nop', 'break\t0x7', '.L_NOT_DIV_BY_ZERO_0:',
      'addiu\t$at,$zero,-1', 'bne\t$4,$at,.L_DIV_BY_POSITIVE_SIGN_0', 'lui\t$at,0x8000',
      'bne\t$3,$at,.L_DIV_BY_POSITIVE_SIGN_0', 'nop', 'tge\t$zero,$zero,93', '.L_DIV_BY_POSITIVE_SIGN_0:', 'mflo\t$2',
      '.set\tat', 'nop'
    ]],
  ['divu with its check', { expandDiv: true },
    ['divu\t$2,$3,$4', 'nop'],
    [
      '.set\tnoat', 'divu\t$zero,$3,$4', 'bnez\t$4,.L_NOT_DIV_BY_ZERO_0', 'nop', 'break\t0x7', '.L_NOT_DIV_BY_ZERO_0:',
      'mflo\t$2', '.set\tat', 'nop'
    ]],
  ['a div then a mult', {},
    ['div\t$2,$3,$4', 'mult\t$5,$6'],
    ['div\t$zero,$3,$4', 'mflo\t$2', 'nop', 'nop', 'mult\t$5,$6']],
  ['two divs in a row', {},
    ['div\t$2,$3,$4', 'div\t$5,$6,$7', 'nop'],
    ['div\t$zero,$3,$4', 'mflo\t$2', 'nop', 'nop', 'div\t$zero,$6,$7', 'mflo\t$5', 'nop']],
  ['sltu with a negative constant goes through $at before 2.60', { sltuAt: true },
    ['sltu\t$2,$3,-1', 'sltu\t$2,$3,5', 'sltu\t$2,$3,$4'],
    ['li\t$at,-1', 'sltu\t$2,$3,$at', 'sltu\t$2,$3,5', 'sltu\t$2,$3,$4']],
  ['and not from 2.60', {},
    ['sltu\t$2,$3,-1'],
    ['sltu\t$2,$3,-1']],
  ['break with a code is its two fields', {},
    ['break\t7', 'break\t1031', 'break\t0x6'],
    ['break\t0x0,0x7', 'break\t0x1,0x7', 'break\t0x0,0x6']],
  ['li.s is lui and, when needed, ori', {},
    ['li.s\t$f0,1.5', 'li.s\t$f2,0.1'],
    ['lui\t$f0,0x3FC0', 'lui\t$f2,0x3DCC', 'ori\t$f2,0xCCCD']],
  ['li.d fills two registers', {},
    ['li.d\t$f2,1.5', 'li.d\t$f12,0.1', 'li.d\t$4,-2.0'],
    [
      'li\t$f2,0x0', 'lui\t$f3,0x3FF8', 'lui\t$f12,0x9999', 'ori\t$f12,0x999A', 'lui\t$f13,0x3FB9', 'ori\t$f13,0x9999',
      'li\t$4,0x0', 'lui\t$5,0xC000'
    ]],
  ['small data is read through $gp with -G', { sdataLimit: 8 },
    [
      '.sdata', 'flag:', '.word\t1', '.text', '.comm\tcounter,4', '.comm\tbuffer,64', 'lw\t$2,counter', 'sw\t$3,flag',
      'lw\t$4,buffer', 'nop'
    ],
    [
      '.section .sdata', 'flag:', '.word\t1', '.text', 'lw\t$2,%gp_rel(counter)($gp)', 'sw\t$3,%gp_rel(flag)($gp)',
      'lw\t$4,buffer', 'nop', '.section .sbss', '.align 2', 'counter:', '.space 4', '.section .bss', '.align 2',
      '.globl buffer', 'buffer:', '.space 64'
    ]],
  ['a symbol and offset through $gp only from 2.70, for .comm', { sdataLimit: 8 },
    ['.comm\tcounter,8', '.lcomm\tlocal,8', 'lw\t$2,counter+4', 'lw\t$3,local+4', 'nop'],
    [
      'lw\t$2,counter+4', 'lw\t$3,%gp_rel(local+4)($gp)', 'nop', '.section .sbss', '.align 2', 'counter:', '.space 8',
      '.align 2', 'local:', '.space 8'
    ]],
  ['the same from 2.70', { sdataLimit: 8, gpAllowOffset: true },
    ['.comm\tcounter,8', 'lw\t$2,counter+4', 'nop'],
    ['lw\t$2,%gp_rel(counter+4)($gp)', 'nop', '.section .sbss', '.align 2', 'counter:', '.space 8']],
  ['la through $gp only from 2.80', { sdataLimit: 8 },
    ['.comm\tcounter,4', 'la\t$2,counter'],
    ['la\t$2,counter', '.section .sbss', '.align 2', 'counter:', '.space 4']],
  ['the same from 2.80', { sdataLimit: 8, gpAllowLa: true },
    ['.comm\tcounter,4', 'la\t$2,counter'],
    ['la\t$2,%gp_rel(counter)($gp)', '.section .sbss', '.align 2', 'counter:', '.space 4']],
  ['no $gp before 2.10', { sdataLimit: 8, gpAllow: false },
    ['.comm\tcounter,4', 'lw\t$2,counter', 'nop'],
    ['lw\t$2,counter', 'nop', '.section .sbss', '.align 2', 'counter:', '.space 4']],
  ['a .comm larger than -G before 2.10 goes in .bss', { sdataLimit: 8, commUsesSdataLimit: false },
    ['.comm\tcounter,4', '.lcomm\tlocal,4'],
    [
      '.section .sbss', '.align 2', 'local:', '.space 4', '.section .bss', '.align 2', '.globl counter', 'counter:',
      '.space 4'
    ]],
  ['.lcomm takes words', {},
    ['.lcomm\tone,1', '.lcomm\tthree,3', '.comm\tshared,6'],
    [
      '.section .bss', '.align 2', '.globl one', 'one:', '.space 4', '.align 2', '.globl three', 'three:', '.space 4',
      '.align 2', '.globl shared', 'shared:', '.space 8'
    ]],
  ['.lcomm packed before 2.08', { lcommAlignment: 'none' },
    ['.lcomm\tone,1', '.lcomm\tthree,3'],
    ['.section .bss', '.globl one', 'one:', '.space 1', '.globl three', 'three:', '.space 3']],
  ['.lcomm aligned to its size from 2.60', { lcommAlignment: 'power_of_two' },
    ['.lcomm\tone,1', '.lcomm\tthree,3', '.lcomm\tbig,40'],
    [
      '.section .bss', '.globl one', 'one:', '.space 1', '.align 2', '.globl three', 'three:', '.space 3', '.align 4',
      '.globl big', 'big:', '.space 40'
    ]],
  ['.comm kept as .comm, aligned as GNU as aligns it', { useCommSection: true },
    ['.comm\tbyte,1', '.comm\tpair,8', '.comm\tlarge,40', '.lcomm\tlocal,4'],
    [
      '.section .bss', '.comm byte,1,1', '.comm pair,8,8', '.comm large,40,16', '.align 2', '.globl local', 'local:',
      '.space 4'
    ]],
  ['the same with .lcomm, under a cap', { useCommSection: true, useCommForLcomm: true, maxCommAlignment: 4 },
    ['.comm\tlarge,40', '.lcomm\tlocal,6'],
    ['.section .bss', '.comm large,40,4', '.comm local,6,4']],
  ['sections take their full names, files are numbered anew, COFF and .set lines go', {},
    [
      '.file\t1 "first.c"', '.data', '.word\t1', '.rdata', '.ascii\t"text\\000"', '.sdata', 'flag:', '.word\t2',
      '.file\t1 "second.c"', '.text', '.def\tfunction;\t.val\tfunction;\t.scl\t2', '.begin\t3', '.bend\t3', '.set\tnoat',
      '.ent\tfunction', 'function:', 'j\t$31', '.end\tfunction'
    ],
    [
      '.file\t1 "first.c"', '.section .data', '.word\t1', '.section .rodata', '.ascii\t"text\\000"', '.section .sdata',
      'flag:', '.word\t2', '.file\t2 "second.c"', '.text', '.ent\tfunction', '.set\tnoreorder', 'function:', 'j\t$31',
      'nop', '.end\tfunction'
    ]],
  ['a function named for the include asm hack keeps only its kept lines', {},
    [
      '.ent\t__maspsx_include_asm_hack_thing', '__maspsx_include_asm_hack_thing:', '.include "thing.s" # maspsx-keep',
      'j\t$31', '.end\t__maspsx_include_asm_hack_thing', 'move\t$2,$3'
    ],
    ['.include "thing.s"', 'addu\t$2,$3,$zero']],
];

for (const [what, options, lines, expected] of CASES) {
  test(what, () => assert.deepEqual(clean(new Processor(lines, options).processLines()), expected));
}

test('reads which registers an instruction reads', () => {
  assert.equal(stripComments('li\t$2,5 # five'), 'li\t$2,5');
  assert.ok(lineLoadsFromReg('jal\t$31,$4', '$4') && !lineLoadsFromReg('jal\t$31,$4', '$31'));
  assert.ok(lineLoadsFromReg('j\t$31', '$31') && !lineLoadsFromReg('j\t$31', '$2'));
  assert.ok(lineLoadsFromReg('bne   $a0, $a1, $L7', '$a0') && lineLoadsFromReg('bne   $a0, $a1, $L7', '$a1'));
  assert.ok(lineLoadsFromReg('mult  $t0, $t1', '$t0') && lineLoadsFromReg('mult  $t0, $t1', '$t1'));
  assert.ok(lineLoadsFromReg('addu  $s0, $a2, $zero', '$a2') && !lineLoadsFromReg('addu  $s0, $a2, $zero', '$s0'));
  assert.ok(lineLoadsFromReg('lw\t$2,0($2)', '$2') && !lineLoadsFromReg('lw\t$2,0($3)', '$2') && lineLoadsFromReg('lw\t$2,0($3)', '$2', true));
  assert.ok(['$L12:', '$Lb3:', '$Le4:'].every(isLabel) && !isLabel('L12:') && !isLabel('LM5:'));
});

test('knows which loads and stores reach through $at', () => {
  const through = ['sb\t$2,name($3)', 'sw\t$2,name', 'sw\t$3,name+8', 'sw\t$2,name.4', 'sb\t$2,32768', 'sw\t$2,-32769($16)', 'lw\t$2,-32769($16)'];
  const not = ['sw\t$2,%lo(name)($3)', 'sb\t$2,32767', 'sw\t$2,-32768($16)', 'lw\t$2,-32768($16)', 'addu\t$2,$3,$4'];
  for (const line of through) assert.ok(usesAt(line), line);
  for (const line of not) assert.ok(!usesAt(line), line);
});

test('lays out .lcomm as each version does, and expands li alone', () => {
  assert.deepEqual([lcommLayout('word', 3), lcommLayout('word', 8), lcommLayout('none', 3)], [[4, 4], [4, 8], [1, 3]]);
  assert.deepEqual([lcommLayout('power_of_two', 1), lcommLayout('power_of_two', 3), lcommLayout('power_of_two', 40)], [[1, 1], [4, 3], [16, 40]]);
  assert.deepEqual(expandLoadImmediate('li\t$2,7', true), ['addiu\t$2,$zero,7']);
});

test('sets each ASPSX version as maspsx.py does', () => {
  const none = optionsFor();
  assert.deepEqual(none, {
    divUsesTge: false, nopAtExpansion: false, nopMfloMfhi: true, nopLwLw: false, sltuAt: true, expandLi: true,
    liSmallUsesAddiu: false, gpAllowOffset: false, gpAllowLa: false, gpAllow: true, addiuAt: false,
    lcommAlignment: 'word', commUsesSdataLimit: true,
  });
  const before230 = { nopAtExpansion: true, nopMfloMfhi: false, nopLwLw: true, addiuAt: true };
  const before210 = { ...before230, commUsesSdataLimit: false, gpAllow: false };
  const from250 = { expandLi: false, liSmallUsesAddiu: true };
  const from260 = { ...from250, sltuAt: false, lcommAlignment: 'power_of_two' };
  const versions = {
    '1.05': { ...before210, lcommAlignment: 'none' }, '2.05': { ...before210, divUsesTge: true, lcommAlignment: 'none' },
    '2.08': { ...before210, divUsesTge: true }, 2.21: before230, '2.30': {}, 2.34: {}, '2.50': from250, 2.56: from250,
    2.67: from260, 2.77: { ...from260, gpAllowOffset: true }, 2.81: { ...from260, gpAllowOffset: true, gpAllowLa: true },
  };
  for (const [version, changes] of Object.entries(versions)) assert.deepEqual(optionsFor(version), { ...none, ...changes }, version);
});

test('takes the command line\'s settings and gives the text for the assembler', () => {
  assert.equal(maspsx('\tmove\t$2,$4\r\n\tli\t$3,1\r\n').assembly, '\naddu\t$2,$4,$zero\nori\t$3,$zero,1\n');
  assert.equal(maspsx('\tli\t$3,1\n', { aspsxVersion: '2.56' }).assembly, '\nli\t$3,1\n');
  assert.equal(maspsx('\tli\t$3,1\n', { aspsxVersion: '2.34', dontExpandLi: true }).assembly, '\nli\t$3,1\n');
  assert.equal(maspsx('nop\n', { macroInc: true }).assembly, '.include "macro.inc"\nnop\n');
  assert.equal(maspsx('\t.def\tf;\t.scl\t2\n\tmove\t$2,$4\n', { passthrough: true }).assembly, '\nmove\t$2,$4\n');
  assert.deepEqual(linesOf('a\rb\r\nc\n'), ['a', 'b', 'c']);
  // The assembler runs with -G0 unless told otherwise, and always for versions that don't use $gp.
  assert.equal(maspsx('nop\n', { sdataLimit: 8 }).smallData, 0);
  assert.equal(maspsx('nop\n', { sdataLimit: 8, dontForceG0: true, aspsxVersion: '2.56' }).smallData, 8);
  assert.equal(maspsx('nop\n', { sdataLimit: 8, dontForceG0: true, aspsxVersion: '2.08' }).smallData, 0);
  assert.throws(() => maspsx('nop\n', { runAssembler: true }), /Unknown maspsx setting/);
});

test('fails where maspsx fails', () => {
  assert.throws(() => new Processor(['lw\t$2']).processLines(), /Unable to parse load\/store instruction/);
  assert.throws(() => new Processor(['.sdata', 'name:', '.quad\t1']).processLines(), /Unable to parse .sdata instruction/);
  assert.throws(() => new Processor(['li.d\t$f1,1.0']).processLines(), /Unknown mapping for \$f1/);
  assert.throws(() => new Processor(['li\t$2,010'], { expandLi: true }).processLines(), /int\(\)/);
  assert.throws(() => new Processor([], { expandDivision: true }), /Unknown maspsx option/);
  assert.deepEqual(new Passthrough(['.bend\t2', '.text']).processLines(), ['.text']);
});
