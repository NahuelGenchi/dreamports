// The GameCube's function finder (tools/gamecube/functions.mjs) and its reader of instructions (tools/gamecube/ppc.mjs)
// on the made-up programs of the tools' tests (made-up-gamecube.mjs, made-up-gamecube-rel.mjs), with nothing from any
// game in them: a program alone, the disc that boots it, and a module on that disc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { codeOf, discFunctions, dolReader, findFunctions, findPpcFunctions, findRelFunctions, gamecubeDisc, gamecubeProgram, inCode, relOf, startsInData } from '../gamecube/functions.mjs';
import { decode, isInstruction } from '../gamecube/ppc.mjs';
import { DISC_FILES, LOAD, VALUES, assemble, madeUpGameCube, madeUpGameCubeDisc } from './made-up-gamecube.mjs';
import { madeUpRel } from './made-up-gamecube-rel.mjs';

const sorted = functions => Object.values(functions).map(({ address, size }) => ({ address, size })).sort((a, b) => a.address - b.address);

test('every function of the made-up program is found, with its size', () => {
  const program = madeUpGameCube();
  assert.deepEqual(findFunctions(program.dol), sorted(program.functions));
  // a list's functions are kept as they are, and the rest found around them
  const listed = [{ address: program.functions.fill.address, size: program.functions.fill.size, name: 'fill' }];
  const found = findFunctions(program.dol, listed);
  assert.deepEqual(found.map(({ address, size }) => ({ address, size })), sorted(program.functions));
  // what's in the program's values isn't code, and a list that says so is told
  assert.equal(inCode(program.dol)(LOAD), true);
  assert.equal(inCode(program.dol)(VALUES), false);
  assert.deepEqual(startsInData(program.dol, [{ address: VALUES, size: 8 }, { address: LOAD, size: 8 }]), [{ address: VALUES, size: 8 }]);
  assert.equal(codeOf(program.dol).entry, LOAD);
  assert.deepEqual(dolReader(program.dol)(VALUES, 4), program.data.bytes.subarray(0, 4));
  assert.equal(dolReader(program.dol)(0x80200000, 4).length, 0);
});

test('a function ends where the processor can go no further, and not at a branch of its own', () => {
  const li = (rt, imm) => ((14 << 26) | (rt << 21) | (imm & 0xFFFF)) >>> 0, blr = 0x4E800020, bctr = 0x4E800420, rfi = 0x4C000064;
  const cmpwi = (ra, imm) => ((11 << 26) | (ra << 16) | (imm & 0xFFFF)) >>> 0;
  const forward = (bo, bi, words) => ((16 << 26) | (bo << 21) | (bi << 16) | (words * 4)) >>> 0, b = words => ((18 << 26) | ((words * 4) & 0x3FFFFFC)) >>> 0;
  const lwzx = 0x7C04002E, mtctr = 0x7C0903A6, lwz = 0x80030000;
  const cases = [
    ['two returns, the first passed by a branch', [cmpwi(3, 0), forward(12, 2, 3), li(3, 1), blr, li(3, 2), blr], 24],
    ['a loop that never ends', [li(3, 0), b(0)], 8],
    ['a return from an interrupt', [li(3, 0), rfi], 8],
    ['a jump through a pointer that never comes back', [lwz, mtctr, bctr], 12],
    ['a switch, whose cases follow its jump', [cmpwi(3, 2), forward(12, 1, 7), lwzx, mtctr, bctr, li(3, 1), b(2), li(3, 2), blr], 36],
    ['a conditional return, which isn\'t the end', [cmpwi(3, 0), 0x4D820020, li(3, 1), blr], 16],
  ];
  for (const [what, words, size] of cases) {
    const bytes = Buffer.alloc((words.length + 2) * 4);
    [...words, li(3, 9), blr].forEach((word, n) => bytes.writeUInt32BE(word, n * 4));
    const found = findPpcFunctions({ sections: [{ address: 0x80010000, bytes }], starts: [0x80010000] });
    assert.deepEqual(found, [{ address: 0x80010000, size }, { address: 0x80010000 + size, size: 8 }], what);
  }
  // zeros between two functions belong to neither, and words that aren't instructions aren't a function
  const padded = Buffer.alloc(40);
  [li(3, 1), blr, 0, 0, li(3, 2), blr, 0xFFFFFFFF >>> 0, 0x00000001, 0, 0].forEach((word, n) => padded.writeUInt32BE(word >>> 0, n * 4));
  assert.equal(isInstruction(0x00000001), false);
  assert.deepEqual(findPpcFunctions({ sections: [{ address: 0x80010000, bytes: padded }], starts: [0x80010000] }).map(f => [f.address & 0xFFFF, f.size]), [[0, 8], [16, 8]]);
});

test('the instructions are read as they are written', () => {
  const written = [
    [0x9421FFF0, 'stwu r1, -0x10(r1)'], [0x7C0802A6, 'mflr r0'], [0x4E800020, 'blr'], [0x4E800421, 'bctrl'], [0x38600001, 'li r3, 0x1'],
    [0x3C608000, 'lis r3, 0x8000'], [0x7C7F1B78, 'mr r31, r3'], [0x60000000, 'nop'], [0x5463103A, 'slwi r3, r3, 2'], [0x5463F0BE, 'srwi r3, r3, 2'],
    [0x2C030000, 'cmpwi cr0, r3, 0x0'], [0x7C632214, 'add r3, r3, r4'], [0x7C632215, 'add. r3, r3, r4'], [0x7C632614, 'addo r3, r3, r4'],
    [0xEC2100B2, 'fmuls f1, f1, f2'], [0xFC20082A, 'fadd f1, f0, f1'], [0xFC201034, 'frsqrte f1, f2'], [0xEC201030, 'fres f1, f2'],
    [0x10220014, 'ps_sum0 f1, f2, f0, f0'], [0x102110AA, 'ps_add f1, f1, f2'], [0xE0230008, 'psq_l f1, 0x8(r3), 0, qr0'], [0x1023200C, 'psq_lx f1, r3, r4, 0, qr0'],
    [0x7C6000A6, 'mfmsr r3'], [0x7C76E3A6, 'mtspr gqr6, r3'], [0x7C0004AC, 'sync'], [0x4C00012C, 'isync'], [0x7C0007EC, 'dcbz 0, r0'], [0x44000002, 'sc'],
  ];
  for (const [word, text] of written) assert.equal(decode(word, 0x80003100)?.text, text, word.toString(16));
  assert.deepEqual([decode(0x48000011, 0x80003100).to, decode(0x48000011, 0x80003100).call, decode(0x4BFFFFF0, 0x80003100).text], [0x80003110, true, 'b 0x800030F0']);
  assert.equal(decode(0x4182000C, 0x80003100).text, 'beq 0x8000310C');
  assert.equal(decode(0x4086FFF8, 0x80003100).text, 'bne cr1, 0x800030F8');
  assert.equal(decode(0x4200FFFC, 0x80003100).text, 'bdnz 0x800030FC');
  for (const none of [0, 0x00000001, 0x04000000, 0x7C0007FE, 0xE8000000]) assert.equal(decode(none), null, none.toString(16));
  // the made-up program is all instructions, and what assembles it is read back
  const program = madeUpGameCube();
  for (let at = 0; at < program.text.bytes.length; at += 4) assert.ok(isInstruction(program.text.bytes.readUInt32BE(at)), at.toString(16));
  assert.equal(assemble([0x4E800020], 0).bytes.readUInt32BE(0), 0x4E800020);
});

test('a module\'s functions are found from its own list of calls, by where they are in its file', () => {
  const rel = madeUpRel();
  assert.deepEqual(findRelFunctions(rel.bytes), sorted(rel.functions));
  const read = relOf(rel.bytes);
  assert.deepEqual([read.id, read.version, read.sections.map(s => s.code)], [7, 1, [false, true, false]]);
  assert.ok(read.starts.includes(rel.functions.twice.address), 'the call\'s target, which the console writes as it loads the module');
  assert.equal(relOf(madeUpGameCube().dol), null);
  assert.equal(relOf(Buffer.alloc(0x100)), null);
});

test('a disc\'s code map has the program it boots and every module beside it', async () => {
  const work = join(LOCAL, 'tmp', 'gamecube-functions-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const program = madeUpGameCube(), rel = madeUpRel();
    const disc = join(work, 'disc.iso'), alone = join(work, 'program.dol');
    writeFileSync(disc, madeUpGameCubeDisc({ program, files: [...DISC_FILES, { name: 'stage/first.rel', bytes: rel.bytes }] }).image);
    writeFileSync(alone, program.dol);
    assert.deepEqual(await gamecubeProgram(disc), program.dol);
    assert.deepEqual(await gamecubeProgram(alone), program.dol);
    const code = await gamecubeDisc(disc);
    assert.deepEqual(code.programs.map(({ path, kind }) => [path, kind]), [['stage/first.rel', 'rel']]);
    const all = discFunctions(code);
    assert.deepEqual(all.filter(f => !f.program), sorted(program.functions));
    assert.deepEqual(all.filter(f => f.program === 'stage/first.rel').map(({ address, size }) => ({ address, size })), sorted(rel.functions));
    assert.deepEqual((await gamecubeDisc(alone)).programs, []);
    // a list's names stay, each program's on its own
    const named = discFunctions(code, [{ address: rel.functions.twice.address, size: 8, name: 'twice', program: 'stage/first.rel' }]);
    assert.equal(named.find(f => f.program && f.address === rel.functions.twice.address).name, 'twice');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
