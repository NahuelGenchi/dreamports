// The Nintendo 64's function finder (tools/n64/functions.mjs), and the MIPS finder it shares with the PlayStation's
// (tools/lib/mips-functions.mjs), on the made-up cartridge of the tools' tests (made-up-n64.mjs), with nothing from any
// game in it, in each of the three byte orders copies come in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { CODE_AT, findFunctions, inConsoleOrder, isInstruction, n64Cartridge, programOf, startsInData } from '../n64/functions.mjs';
import { isInstruction as isMipsInstruction } from '../lib/mips.mjs';
import { LOAD, madeUpCartridge, madeUpProgram } from './made-up-n64.mjs';

test('finds every function of the made-up cartridge, each with its size', () => {
  const { cartridge, functions } = madeUpCartridge();
  assert.deepEqual(findFunctions(cartridge), functions.map(({ address, size }) => ({ address, size })));
  assert.equal(programOf(cartridge).load, LOAD);
});

test('each way a function is found', () => {
  const { cartridge, labels } = madeUpCartridge();
  const found = copy => findFunctions(copy).map(f => f.address);
  const without = (label, word = 0) => {
    const copy = Buffer.from(cartridge);
    copy.writeUInt32BE(word, CODE_AT + labels[label] - LOAD);
    return copy;
  };
  // shine is after the program's values, so only the table's pointer to its opening finds it
  assert.ok(found(cartridge).includes(labels.shine));
  assert.ok(!found(without('functions')).includes(labels.shine), 'with no pointer to it, nothing finds shine');
  // a switch's jump through its table doesn't end the function: its cases are pick's own
  assert.ok(!found(cartridge).includes(labels.pick_0) && !found(cartridge).includes(labels.pick_else));
  // a likely branch's target is the function's own, and its 64-bit and floating-point code reads as code
  assert.ok(!found(cartridge).includes(labels.likely_zero));
  assert.ok(found(cartridge).includes(labels.wide) && found(cartridge).includes(labels.square));
  // the program's values aren't a function, as the fourth isn't an instruction
  assert.ok(!found(cartridge).some(address => address >= labels.values && address < labels.shine));
});

test('the VR4300\'s instructions are MIPS III, with no geometry processor', () => {
  // ld, a 64-bit sum, a likely branch, the floating-point unit's add and eret are the VR4300's, not the PlayStation's
  for (const word of [0xDC820008, 0x0062102D, 0x50800003, 0x46020100, 0x42000018]) {
    assert.ok(isInstruction(word) && !isMipsInstruction(word), `0x${word.toString(16)}`);
  }
  // the geometry processor's command and its loads are the PlayStation's alone
  for (const word of [0x4A180001, 0xC8800000]) assert.ok(!isInstruction(word) && isMipsInstruction(word), `0x${word.toString(16)}`);
  assert.ok(!isInstruction(0x44444444) && isInstruction(0x03E00008) && isInstruction(0));
  // a field the instruction keeps zero, set, as values do: sll with a source register, lui with one
  assert.ok(!isInstruction(0x00A21080) && !isInstruction(0x3C451234) && isMipsInstruction(0x3C451234));
});

test('code a header names a megabyte or two higher than its boot code puts it is found where it runs', () => {
  const { functions } = madeUpCartridge();
  const want = functions.map(({ address, size }) => ({ address, size }));
  for (const named of [LOAD + 0x100000, LOAD + 0x200000]) {
    const { cartridge } = madeUpCartridge({ named });
    assert.equal(programOf(cartridge).load, LOAD);
    assert.deepEqual(findFunctions(cartridge), want);
  }
});

test('a function a list names outside the code is in its data', () => {
  const { cartridge, labels } = madeUpCartridge();
  assert.deepEqual(startsInData(cartridge, [{ address: labels.sum, size: 8 }, { address: 0x80200400, size: 4 }]), [{ address: 0x80200400, size: 4 }]);
});

test('reads a copy in each of the three byte orders as the console does', async () => {
  const work = join(LOCAL, 'tmp', 'n64-functions-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { cartridge, functions } = madeUpCartridge();
    const words = Buffer.from(cartridge), halves = Buffer.from(cartridge);
    for (let i = 0; i < words.length; i += 4) words.writeUInt32LE(cartridge.readUInt32BE(i), i);
    for (let i = 0; i < halves.length; i += 2) halves.writeUInt16LE(cartridge.readUInt16BE(i), i);
    for (const [name, bytes] of [['a.z64', cartridge], ['a.n64', words], ['a.v64', halves]]) {
      const path = join(work, name);
      writeFileSync(path, bytes);
      assert.equal((await readAnyCopy(path))?.title, 'DREAMPORTS MADE UP');
      assert.deepEqual(n64Cartridge(path), cartridge, name);
    }
    assert.deepEqual(findFunctions(n64Cartridge(join(work, 'a.v64'))), functions.map(({ address, size }) => ({ address, size })));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('says when a file isn\'t a Nintendo 64 cartridge', () => {
  assert.throws(() => inConsoleOrder(Buffer.alloc(4096)), /isn't a Nintendo 64 cartridge/);
  const { cartridge } = madeUpCartridge({ named: 0x00001000 });
  assert.throws(() => programOf(cartridge), /outside the console's memory/);
  // code where nearly none of the calls land on an opening, as where a cartridge's own boot code puts it somewhere else
  // again: the made-up program with twenty more calls into the middle of its start
  const elsewhere = Buffer.from(madeUpCartridge().cartridge), { words } = madeUpProgram();
  for (let n = 0; n < 20; n++) elsewhere.writeUInt32BE(((3 << 26) | ((LOAD + 4) >>> 2 & 0x3FFFFFF)) >>> 0, CODE_AT + (words.length + n) * 4);
  assert.throws(() => programOf(elsewhere), /can't tell where this cartridge's code runs: .* \(2 of 26 at best\)/);
});
