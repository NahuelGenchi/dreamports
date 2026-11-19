// What gameplay proven knows of a PlayStation 2 game without playing it (ps2/ledger.mjs, ps2/decided.mjs, lib/played.mjs):
// which instructions are conditional branches, by the same rules as the tools' change to Play!, where a function's
// instructions are, the program's bytes where it runs, the disc's sectors that hold anything, the branches the code
// decides, and what a run's records count, all on programs and a disc written here. The same on the real emulator is
// npm run test:ps2-ledger.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { NOT_TAKEN, RAN, TAKEN, cellsOf, finderOf, layoutOf, playedIn } from '../lib/played.mjs';
import { branchKind, discCells, mipsInstructionsOf, programReader, vuBranches, vuInstructionsOf } from '../ps2/ledger.mjs';
import { decidedMipsBranches } from '../ps2/decided.mjs';
import { testedValues } from '../untouched.mjs';
import { LOAD_AT, VU1_PROGRAM, madeUpPs2 } from './made-up-ps2.mjs';
import { SECTOR, madeUpPs2Disc, systemCnf } from './made-up-ps2-disc.mjs';

// the EE's instructions, as MIPS encodes them
const I = (op, rs, rt, value) => (op << 26 | rs << 21 | rt << 16 | (value & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, funct) => (rs << 21 | rt << 16 | rd << 11 | funct) >>> 0;
const NOP = 0, T0 = 8, T1 = 9, V0 = 2, RA = 31;
const beq = (rs, rt, offset) => I(0x04, rs, rt, offset), bne = (rs, rt, offset) => I(0x05, rs, rt, offset);
const addiu = (rt, rs, value) => I(0x09, rs, rt, value), lw = (rt, offset, base) => I(0x23, base, rt, offset);
const jr = rs => R(rs, 0, 0, 0x08), jal = target => (0x03 << 26 | target >>> 2 & 0x3FFFFFF) >>> 0;
const bytesOf = words => new Uint8Array(Uint32Array.from(words).buffer);

test('a conditional branch is one only when its way can change, as the tools\' change to Play! says', () => {
  assert.equal(branchKind(beq(0, 0, 4)), 0, '`b` is beq $zero, $zero');
  assert.equal(branchKind(beq(T0, T0, 4)), 0);
  assert.equal(branchKind(beq(T0, 0, 4)), 1);
  assert.equal(branchKind(bne(T0, T0, 4)), 1, 'a branch that never goes is still one, for --decided to rule out');
  assert.equal(branchKind(I(0x14, T0, 0, 4)), 2, 'BEQL is likely');
  assert.equal(branchKind(I(0x01, 0, 0x01, 4)), 0, 'BGEZ $zero always goes');
  assert.equal(branchKind(I(0x01, 0, 0x11, 4)), 0, 'BAL is BGEZAL $zero');
  assert.equal(branchKind(I(0x01, T0, 0x11, 4)), 1);
  assert.equal(branchKind(I(0x01, T0, 0x12, 4)), 2, 'BLTZALL');
  assert.equal(branchKind(I(0x01, T0, 0x08, 4)), 0, 'a trap is no branch');
  assert.equal(branchKind(I(0x06, 0, 0, 4)), 0, 'BLEZ $zero always goes');
  assert.equal(branchKind(I(0x11, 0x08, 0x01, 4)), 1, 'BC1T');
  assert.equal(branchKind(I(0x11, 0x08, 0x03, 4)), 2, 'BC1TL');
  assert.equal(branchKind(jal(LOAD_AT)), 0);
  assert.equal(vuBranches((0x29 << 25 | 3 << 16) >>> 0), true, 'IBNE');
  assert.equal(vuBranches((0x28 << 25 | 3 << 16 | 3 << 11) >>> 0), false, 'IBEQ of a register with itself always goes');
  assert.equal(vuBranches((0x20 << 25) >>> 0), false, 'B');
});

test('a function\'s instructions are followed through each branch, its delay slot, a call and a jump within it', () => {
  // 0: beq t0, zero, +3 (to 16); 4: nop (delay); 8: jal; 12: nop; 16: addiu; 20: jr ra; 24: nop; 28: data nothing reaches
  const code = bytesOf([beq(T0, 0, 3), NOP, jal(LOAD_AT + 0x100), NOP, addiu(V0, 0, 1), jr(RA), NOP, 0xDEADBEEF]);
  const { instructions, branches } = mipsInstructionsOf(code, [], new Map(), LOAD_AT);
  assert.deepEqual([...instructions].sort((a, b) => a - b), [0, 4, 8, 12, 16, 20, 24]);
  assert.deepEqual([...branches], [0]);
  // a way the game's list rules out isn't followed: never taken leaves the fall-through alone
  const ruled = mipsInstructionsOf(bytesOf([beq(T0, 0, 2), NOP, jr(RA), NOP, addiu(V0, 0, 1), jr(RA), NOP]), [], new Map([[0, TAKEN]]));
  assert.deepEqual([...ruled.instructions].sort((a, b) => a - b), [0, 4, 8, 12]);
  // a place known to have run that's a jump's delay slot doesn't go on into what's after it
  const jumped = bytesOf([jr(RA), NOP, 0x0000800B, 0x10000000]);
  assert.deepEqual([...mipsInstructionsOf(jumped, [4], new Map()).instructions].sort((x, y) => x - y), [0, 4]);
  const vu = vuInstructionsOf(new Uint8Array(Uint32Array.from(VU1_PROGRAM).buffer));
  assert.equal(vu.instructions.size, VU1_PROGRAM.length / 2, 'every pair of the made-up vector unit program, to the one after its E bit');
  assert.deepEqual([...vu.branches], [24 * 8], 'its one branch, the loop over the corners');
});

test('the program\'s bytes are where it runs, and a disc\'s sectors that hold anything are its content', () => {
  const { elf } = madeUpPs2();
  const read = programReader(elf);
  assert.equal(Buffer.from(read(LOAD_AT, 4)).readUInt32LE(), elf.readUInt32LE(elf.readUInt32LE(elf.readUInt32LE(28) + 4)), 'the first word of the program where it\'s loaded');
  assert.equal(read(0x01000000, 4).length, 0, 'nothing outside its segments');
  const work = join(LOCAL, 'test-ps2-ledger-unit');
  mkdirSync(work, { recursive: true });
  try {
    const { disc, sectors } = madeUpPs2Disc({ 'SYSTEM.CNF': systemCnf('MADE_UP.ELF'), 'MADE_UP.ELF': elf, 'ZEROS.BIN': Buffer.alloc(2 * SECTOR), 'DATA.BIN': Buffer.alloc(SECTOR, 1).fill(2, 10) });
    const path = join(work, 'made-up.iso');
    writeFileSync(path, disc);
    const { sectors: count, holds } = discCells(path);
    const has = sector => (holds[sector >> 3] >> (sector & 7) & 1) === 1;
    assert.equal(count, disc.length / SECTOR);
    assert.ok(has(16) && has(sectors['SYSTEM.CNF'].at) && has(sectors['DATA.BIN'].at));
    assert.ok(!has(0) && !has(sectors['ZEROS.BIN'].at) && !has(sectors['ZEROS.BIN'].at + 1), 'a sector of one value throughout holds nothing');
    assert.equal(cellsOf({ console: 'ps2', functions: [] }, Object.assign(() => new Uint8Array(0), { disc: path })), count);
    assert.equal(discCells(join(work, 'made-up.iso')), discCells(path), 'worked out once for a disc');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('what a run says counts for its processor\'s functions, and the EE\'s only where the program holds what ran', () => {
  const program = [addiu(V0, 0, 1), beq(V0, 0, 2), NOP, jr(RA), NOP];
  const held = bytesOf(program), cartridge = (address, count) => (address >= LOAD_AT && address < LOAD_AT + held.length ? held.subarray(address - LOAD_AT, address - LOAD_AT + count) : new Uint8Array(0));
  const vu = Buffer.from(Uint32Array.from([0x8000033C, 0x000002FF]).buffer).toString('hex').toUpperCase();
  const codeMap = { console: 'ps2', functions: [{ key: 'ee', address: LOAD_AT, size: held.length }, { key: 'vu', address: 0, size: 16, cpu: 'vu1', bytes: vu }] };
  const layout = layoutOf(codeMap), find = finderOf(codeMap, cartridge, new Map());
  // records as ran-ps2.h writes them: address, word, what with the processor in its second byte, first and last frame
  const records = Uint32Array.from([
    LOAD_AT, program[0], RAN, 0, 1,
    LOAD_AT + 4, program[1], TAKEN, 1, 1,
    LOAD_AT + 4, program[1], NOT_TAKEN, 0, 0,
    LOAD_AT + 8, 0x12345678, RAN, 0, 1,        // another word at the same place: code loaded over the program's
    0, 0x8000033C, RAN | 3 << 8, 0, 1,
    8, 0x8000033C, RAN | 1 << 8, 0, 1,          // the IOP's, where no function of the IOP is
  ]);
  const set = playedIn(records, Uint8Array.of(0, 1), layout, find);
  const has = (index, offset, what) => (set[((layout.first[index] + offset / 4) * 3 + what) >> 3] >> (((layout.first[index] + offset / 4) * 3 + what) & 7) & 1) === 1;
  assert.ok(has(0, 0, RAN) && has(0, 4, TAKEN), 'what ran in the frame that matched');
  assert.ok(!has(0, 4, NOT_TAKEN), 'a way gone only in a frame that didn\'t match doesn\'t count');
  assert.ok(!has(0, 8, RAN), 'another word than the program holds there doesn\'t count');
  assert.ok(has(1, 0, RAN), 'the vector unit\'s function, with its first word there');
  assert.equal(set.reduce((sum, byte) => sum + [...byte.toString(2)].filter(bit => bit === '1').length, 0), 3);
});

test('the branches the code decides are found from the program alone, and nothing anything can reach into', () => {
  const functions = words => [{ key: 'f', address: LOAD_AT, size: words.length * 4 }];
  const run = (words, pointers = []) => {
    const bytes = bytesOf(words);
    return decidedMipsBranches(functions(words), (address, count) => bytes.subarray(address - LOAD_AT, address - LOAD_AT + count), [...new Uint32Array(bytes.buffer), ...pointers]);
  };
  // li t0, 5; beq t0, zero: never taken, as 5 is never zero
  assert.deepEqual(run([addiu(T0, 0, 5), beq(T0, 0, 2), NOP, jr(RA), NOP]), [{ address: LOAD_AT + 4, way: 'taken', from: LOAD_AT, by: LOAD_AT + 4 }]);
  assert.deepEqual(run([bne(0, 0, 2), NOP, jr(RA), NOP]).map(d => d.way), ['taken'], 'bne $zero, $zero is never taken');
  assert.deepEqual(run([lw(T0, 0, 4), beq(T0, 0, 2), NOP, jr(RA), NOP]), [], 'a value read from memory decides nothing');
  // another way into the run: a branch back to the beq, after t0 has changed, or a word that points at it
  assert.deepEqual(run([addiu(T0, 0, 5), beq(T0, 0, 3), NOP, addiu(T0, 0, 0), beq(0, 0, -4), NOP, jr(RA), NOP]), []);
  assert.deepEqual(run([addiu(T0, 0, 5), beq(T0, 0, 2), NOP, jr(RA), NOP], [LOAD_AT + 4]), []);
});

test('a side of a branch read from the PlayStation 2\'s main memory is one a search can spread over, however the EE names it', () => {
  const record = (fromA, kindA) => ({ pc: 0, a: 7, b: 0, fromA, kindA, fromB: 0, kindB: 2, went: TAKEN, times: 1, frame: 0, more: false });
  assert.deepEqual(testedValues([record(0x20100040, 1 | 4 << 8)], 'ps2'), [{ address: 0x00100040, bytes: 4, held: 7, against: 0 }], 'the uncached mirror is main memory');
  assert.deepEqual(testedValues([record(0x12001000, 1 | 4 << 8)], 'ps2'), [], 'the GS\'s registers aren\'t memory a search spreads over');
  assert.deepEqual(testedValues([record(0x02000010, 1 | 2 << 8)]), [{ address: 0x02000010, bytes: 2, held: 7, against: 0 }], 'and the Game Boy Advance\'s work RAM still is');
});
