// `read` on the PlayStation (tools/ps1/read.mjs) and the decoder under it (tools/ps1/mips.mjs), on words written here
// and on the made-up program of the tools' tests (made-up-ps1.mjs), with nothing from any game in them. The decoder's
// texts were checked against LLVM's own disassembler for MIPS I when they were written, but for the geometry
// processor's commands and rfe, which it doesn't know.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { decode, isInstruction } from '../ps1/mips.mjs';
import { listing, ps1Resolve, readPs1 } from '../ps1/read.mjs';
import { findFunctions } from '../ps1/functions.mjs';
import { madeUpExe } from './made-up-ps1.mjs';

test('reads each kind of instruction as GNU\'s tools write it', () => {
  const words = {
    0x00000000: 'nop', 0x000940C0: 'sll     $t0, $t1, 3', 0x00041043: 'sra     $v0, $a0, 1', 0x01494004: 'sllv    $t0, $t1, $t2',
    0x03E00008: 'jr      $ra', 0x01000008: 'jr      $t0', 0x0120F809: 'jalr    $t1', 0x01202009: 'jalr    $a0, $t1',
    0x0000000C: 'syscall', 0x00001010: 'mfhi    $v0', 0x00850018: 'mult    $a0, $a1', 0x0085001A: 'div     $a0, $a1',
    0x00851021: 'addu    $v0, $a0, $a1', 0x00801021: 'move    $v0, $a0', 0x0085102B: 'sltu    $v0, $a0, $a1',
    0x24020005: 'li      $v0, 5', 0x27BDFFE8: 'addiu   $sp, $sp, -24', 0x308200FF: 'andi    $v0, $a0, 0xFF', 0x3C018002: 'lui     $at, 0x8002',
    0x8082FFFF: 'lb      $v0, -1($a0)', 0x8FBF0010: 'lw      $ra, 16($sp)', 0xA5041C00: 'sh      $a0, 7168($t0)', 0xAFBF0010: 'sw      $ra, 16($sp)',
    0x40086000: 'mfc0    $t0, SR', 0x42000010: 'rfe', 0x4802C800: 'mfc2    $v0, $25', 0x4884C800: 'mtc2    $a0, $25', 0xC8800000: 'lwc2    $0, 0($a0)',
    0x4A180001: 'rtps    sf=1 lm=0', 0x4A486012: 'mvmva   sf=1 lm=0 mx=0 v=0 cv=3',
  };
  for (const [word, text] of Object.entries(words)) assert.equal(decode(Number(word), 0x80010000)?.text, text, `0x${Number(word).toString(16)}`);
  assert.equal(decode(0x1085000F, 0x80010000).text, 'beq     $a0, $a1, 0x80010040');
  assert.equal(decode(0x1080FFFF, 0x80010000).text, 'beqz    $a0, 0x80010000');
  assert.equal(decode(0x1000FFFF, 0x80010000).kind, 'jump');
  assert.equal(decode(0x0C004020, 0x80010000).text, 'jal     0x80010080');
  assert.deepEqual([decode(0x03E00008).kind, decode(0x01000008).kind, decode(0x0C004020).kind, decode(0x0C004020).writes], ['return', 'switch', 'call', 31]);
  assert.deepEqual([decode(0x8FBF0010).kind, decode(0x8FBF0010).bytes, decode(0xA5041C00).kind, decode(0xA5041C00).bytes], ['load', 4, 'store', 2]);
  assert.ok(!isInstruction(0x44444444) && !isInstruction(0x00000005) && !isInstruction(0x04020000));
});

test('names what a call goes to, and the address a lui and what adds to it make', () => {
  const { exe, functions, labels } = madeUpExe();
  const names = new Map(functions.map(f => [f.address, f.name]));
  const of = name => functions.find(f => f.name === name);
  const lines = listing(exe, of('main').address, of('main').size, at => names.get(at) ?? null);
  assert.ok(lines.some(line => /^jal +0x80010080$/.test(line.text) && line.note === 'sum'));
  assert.ok(lines.some(line => line.text.startsWith('addiu   $a0, $a0,') && line.note === `0x${labels.buffer.toString(16).toUpperCase()}`));
  assert.ok(lines.some(line => line.text === 'lw      $t0, 0($s0)' && line.note === `0x${labels.functions.toString(16).toUpperCase()}`), 'a load through an address made that way says where it reads');
  const pick = listing(exe, of('pick').address, of('pick').size, () => null);
  assert.equal(pick.filter(line => line.text === 'jr      $ra').length, 4);
  assert.ok(pick.some(line => line.text === 'jr      $t0'));
  const values = listing(exe, labels.values, 16, () => null);
  assert.equal(values[3].text, '.word   0x44444444');
});

test('read on a made-up program, by address, name and label', async () => {
  const work = join(LOCAL, 'tmp', 'ps1-read-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { exe, functions } = madeUpExe();
    const path = join(work, 'made-up.exe');
    writeFileSync(path, exe);
    const names = new Map(functions.map(f => [f.address, f.name]));
    const codeMap = { functions: findFunctions(exe).map(f => ({ ...f, name: names.get(f.address) })) };
    const original = { name: 'Made-up program', console: 'ps1' };
    const lookup = functions.find(f => f.name === 'lookup');
    assert.equal(ps1Resolve('made-up-ps1', codeMap, 'lookup').address, lookup.address);
    assert.equal(ps1Resolve('made-up-ps1', codeMap, `func_${lookup.address.toString(16)}`).address, lookup.address);
    assert.equal(ps1Resolve('made-up-ps1', codeMap, `0x${lookup.address.toString(16)}`).address, lookup.address);
    assert.throws(() => ps1Resolve('made-up-ps1', codeMap, 'nowhere'), /isn't an address, such as 0x800C1234/);
    const read = await readPs1({ game: 'made-up-ps1', what: `0x${(lookup.address + 8).toString(16)}`, original, codeMap, copy: { path }, flags: {} });
    assert.equal(read.key, lookup.address.toString(16).toUpperCase());
    assert.match(read.text, /^lookup, at 0x800100A8, in Made-up program: the whole function, 28 bytes, as the code map has it\./);
    assert.match(read.text, /0x800100B0 is inside it\./);
    assert.match(read.text, /800100B8:  8D020000  lw      \$v0, 0\(\$t0\)/);
    assert.ok(read.has('lookup') && !read.has('main'));
    await assert.rejects(readPs1({ game: 'made-up-ps1', what: '0x80300000', original, codeMap, copy: { path }, flags: {} }), /isn't in the program Made-up program boots/);
    await assert.rejects(readPs1({ game: 'made-up-ps1', what: 'lookup', original, codeMap, copy: { path }, flags: { arm: true } }), /--arm is for a Game Boy Advance game/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
