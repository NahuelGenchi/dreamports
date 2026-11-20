// `read` on the Nintendo 64 (tools/n64/read.mjs) and the shared decoder under it (tools/lib/mips.mjs), for the VR4300
// and for the RSP, on words written here and on the made-up cartridge of the tools' tests (made-up-n64.mjs), with
// nothing from any game in them. The VR4300's names were checked against LLVM's MIPS III disassembler when they were
// written, and the RSP's against rabbitizer's tables (MIT), as LLVM doesn't know the RSP.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { decode, isInstruction } from '../lib/mips.mjs';
import { findFunctions } from '../n64/functions.mjs';
import { listing, readN64 } from '../n64/read.mjs';
import { LOAD, madeUpCartridge } from './made-up-n64.mjs';

test('reads the VR4300\'s own instructions as GNU\'s tools write them', () => {
  const words = {
    0x0062102D: 'daddu   $v0, $v1, $v0', 0x0062102F: 'dsubu   $v0, $v1, $v0', 0x00021FF8: 'dsll    $v1, $v0, 31', 0x00021FFC: 'dsll32  $v1, $v0, 31',
    0x0085001C: 'dmult   $a0, $a1', 0x0085001F: 'ddivu   $a0, $a1', 0x00850034: 'teq     $a0, $a1', 0x0000000F: 'sync',
    0x648FFFF8: 'daddiu  $t7, $a0, -8', 0xDC820008: 'ld      $v0, 8($a0)', 0xFC820008: 'sd      $v0, 8($a0)', 0x9C820004: 'lwu     $v0, 4($a0)',
    0xC0820000: 'll      $v0, 0($a0)', 0xE0820000: 'sc      $v0, 0($a0)', 0xBC900000: 'cache   0x10, 0($a0)', 0x6BA20000: 'ldl     $v0, 0($sp)',
    0x40896000: 'mtc0    $t1, Status', 0x40286000: 'dmfc0   $t0, Status', 0x42000002: 'tlbwi', 0x42000018: 'eret',
    0xC4800004: 'lwc1    $f0, 4($a0)', 0xD4800008: 'ldc1    $f0, 8($a0)', 0x44822000: 'mtc1    $v0, $f4', 0x4442F800: 'cfc1    $v0, $31',
    0x46020100: 'add.s   $f4, $f0, $f2', 0x46220103: 'div.d   $f4, $f0, $f2', 0x46001004: 'sqrt.s  $f0, $f2', 0x46802020: 'cvt.s.w $f0, $f4',
    0x4600110D: 'trunc.w.s $f4, $f2', 0x4620103C: 'c.lt.d  $f2, $f0',
  };
  for (const [word, text] of Object.entries(words)) assert.equal(decode(Number(word), 0x80000400, 'vr4300')?.text, text, `0x${Number(word).toString(16)}`);
  assert.equal(decode(0x50850003, 0x80000400, 'vr4300').text, 'beql    $a0, $a1, 0x80000410');
  assert.equal(decode(0x54800003, 0x80000400, 'vr4300').text, 'bnezl   $a0, 0x80000410');
  assert.equal(decode(0x45030003, 0x80000400, 'vr4300').text, 'bc1tl   0x80000410');
  assert.deepEqual([decode(0x50850003, 0, 'vr4300').likely, decode(0x10850003, 0, 'vr4300').likely, decode(0x45010003, 0, 'vr4300').kind], [true, undefined, 'branch']);
  assert.deepEqual([decode(0x42000018, 0, 'vr4300').kind, decode(0xDC820008, 0, 'vr4300').bytes, decode(0xE0820000, 0, 'vr4300').writes, decode(0xD4800008, 0, 'vr4300').float], ['eret', 8, 2, true]);
  // what the VR4300 doesn't have: a conversion to its own format, a second coprocessor, a register's selector
  for (const word of [0x46200121, 0xC8800000, 0x40086001]) assert.ok(!isInstruction(word, 'vr4300'), `0x${word.toString(16)}`);
});

test('reads the RSP\'s instructions, its vector unit\'s with their elements', () => {
  const words = {
    0x4B03104F: 'vmadh   $v1, $v2, $v3[0]', 0x4AC3104F: 'vmadh   $v1, $v2, $v3[2h]', 0x4A43104F: 'vmadh   $v1, $v2, $v3[0q]', 0x4A03104F: 'vmadh   $v1, $v2, $v3',
    0x4B020B30: 'vrcp    $v12[1], $v2[0]', 0x4A000037: 'vnop', 0xC8812000: 'lqv     $v1[0], 0($a0)', 0xE8812001: 'sqv     $v1[0], 16($a0)',
    0xC8811804: 'ldv     $v1[0], 32($a0)', 0xC8810C7F: 'lsv     $v1[8], -2($a0)', 0x40046000: 'mfc0    $a0, DPC_CLOCK', 0x40842000: 'mtc0    $a0, SP_STATUS',
    0x48810800: 'mtc2    $at, $v1[0]', 0x48020900: 'mfc2    $v0, $v1[2]', 0x48C30800: 'ctc2    $v1, $vcc', 0x00851021: 'addu    $v0, $a0, $a1',
  };
  for (const [word, text] of Object.entries(words)) assert.equal(decode(Number(word), 0x04001080, 'rsp')?.text, text, `0x${Number(word).toString(16)}`);
  // a jump and a branch go round within its 4 KB of instructions
  assert.equal(decode(0x0D000420, 0x04001FF0, 'rsp').text, 'jal     0x4001080');
  assert.equal(decode(0x10000004, 0x04001FF0, 'rsp').target, 0x04001004);
  // what the RSP doesn't have: multiplies, 64-bit sums, likely branches, the floating-point unit
  for (const word of [0x00850018, 0x0062102D, 0x50850003, 0x46020100, 0xDC820008]) assert.ok(!isInstruction(word, 'rsp'), `0x${word.toString(16)}`);
  // its vector unit is coprocessor 2, which the VR4300 doesn't have, and which on the PlayStation is the geometry processor
  assert.ok(!isInstruction(0x4B03104F, 'vr4300') && decode(0x4B03104F).kind === 'gte');
});

test('names what a call goes to, and the address a lui and what adds to it make', () => {
  const { cartridge, functions, labels } = madeUpCartridge();
  const names = new Map(functions.map(f => [f.address, f.name]));
  const of = name => functions.find(f => f.name === name);
  const lines = listing(cartridge, of('main').address, of('main').size, at => names.get(at) ?? null);
  assert.ok(lines.some(line => line.text === `jal     0x${labels.sum.toString(16).toUpperCase()}` && line.note === 'sum'));
  assert.ok(lines.some(line => line.text.startsWith('addiu   $a0, $a0,') && line.note === `0x${labels.buffer.toString(16).toUpperCase()}`));
  assert.ok(lines.some(line => line.text === 'lw      $t0, 0($s0)' && line.note === `0x${labels.functions.toString(16).toUpperCase()}`), 'a load through an address made that way says where it reads');
  const likely = listing(cartridge, of('likely').address, of('likely').size, () => null);
  assert.equal(likely[0].text, `beqzl   $a0, 0x${labels.likely_zero.toString(16).toUpperCase()}`);
  const values = listing(cartridge, labels.values, 16, () => null);
  assert.equal(values[3].text, '.word   0x44444444');
});

test('read on a made-up cartridge, by address, name and label, and a microcode with --rsp', async () => {
  const work = join(LOCAL, 'tmp', 'n64-read-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { cartridge, functions, labels } = madeUpCartridge();
    // a few of the RSP's instructions, where the made-up program keeps its buffer and beyond, as a game keeps its
    // microcode among its values: a vector load, a sum, a store, a jump back to the start and a break
    const microcode = [0xC8812000, 0x4B03104F, 0xE8812001, 0x0D000420, 0x00000000, 0x0000000D];
    microcode.forEach((word, n) => cartridge.writeUInt32BE(word, 0x1000 + labels.buffer - LOAD + n * 4));
    const path = join(work, 'made-up.n64');
    const swapped = Buffer.from(cartridge);
    for (let i = 0; i < swapped.length; i += 4) swapped.writeUInt32LE(cartridge.readUInt32BE(i), i);
    writeFileSync(path, swapped);
    const names = new Map(functions.map(f => [f.address, f.name]));
    const codeMap = { functions: findFunctions(cartridge).map(f => ({ ...f, name: names.get(f.address) })) };
    const original = { name: 'Made-up cartridge', console: 'n64' };
    const lookup = functions.find(f => f.name === 'lookup');
    const read = await readN64({ game: 'made-up-n64', what: `func_${(lookup.address).toString(16)}`, original, codeMap, copy: { path }, flags: {} });
    assert.equal(read.key, lookup.address.toString(16).toUpperCase());
    assert.match(read.text, new RegExp(`^lookup, at 0x${lookup.address.toString(16).toUpperCase()}, in Made-up cartridge: the whole function, 28 bytes, as the code map has it\\.`));
    assert.match(read.text, /8D020000  lw      \$v0, 0\(\$t0\)/);
    assert.ok(read.has('lookup') && !read.has('main'));
    const rsp = await readN64({ game: 'made-up-n64', what: `0x${labels.buffer.toString(16)}`, original, codeMap, copy: { path }, flags: { rsp: '0x1080', bytes: 24 } });
    assert.equal(rsp.key, `${labels.buffer.toString(16).toUpperCase()}-rsp`);
    assert.match(rsp.text, /04001080:  C8812000  lqv     \$v1\[0\], 0\(\$a0\)/);
    assert.match(rsp.text, /0400108C:  0D000420  jal     0x4001080/);
    await assert.rejects(readN64({ game: 'made-up-n64', what: `0x${labels.buffer.toString(16)}`, original, codeMap, copy: { path }, flags: { rsp: '0x2004' } }), /--rsp takes where the first word runs/);
    await assert.rejects(readN64({ game: 'made-up-n64', what: '0x80300000', original, codeMap, copy: { path }, flags: {} }), /isn't in the code Made-up cartridge's cartridge starts/);
    await assert.rejects(readN64({ game: 'made-up-n64', what: 'lookup', original, codeMap, copy: { path }, flags: { arm: true } }), /--arm is for a Game Boy Advance game/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
