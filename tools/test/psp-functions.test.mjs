// The functions in a PlayStation Portable program (tools/psp/functions.mjs), with made-up programs written here: one
// loaded where it says and one relocatable, a PRX, from a file of its own, from a disc and from a PBP, with functions
// reached by a call, through a pointer in a table, and by neither, and with the pairs of instructions the system writes
// its calls into kept out of the map. And the Allegrex's own instructions as the tools read them (tools/lib/allegrex.mjs).

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LOCAL } from '../lib/paths.mjs';
import { decode, isInstruction } from '../lib/mips.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { PLACED_AT, findFunctions, inCode, programOf, pspProgram, startsInData } from '../psp/functions.mjs';
import { A0, LOAD_AT, NOP, RA, SP, V0, ZERO, addiu, addu, call, here, jal, jr, la, lw, pspProgram as build, sw } from './made-up-psp.mjs';
import { madeUpPspDisc } from './made-up-psp-disc.mjs';

// A program of five functions. `start` calls `called` and asks the system for a V-blank. `through a pointer` is named
// only by a word of a table. `by neither` comes right after the end of the one before, opening as a function does.
// `leaf` opens no stack and is reached by a call.
const code = [
  here('start'),
  addiu(SP, SP, -16), sw(RA, 0, SP),
  jal('called'), NOP,
  jal('leaf'), NOP,
  ...call('sceDisplayWaitVblankStart'),
  ...la(A0, 'table'), lw(V0, 0, A0),
  lw(RA, 0, SP), jr(RA), addiu(SP, SP, 16),
  here('called'),
  addiu(SP, SP, -8), addu(V0, A0, A0), jr(RA), addiu(SP, SP, 8),
  here('through a pointer'),
  addiu(SP, SP, -8), addu(V0, A0, ZERO), jr(RA), addiu(SP, SP, 8),
  here('by neither'),
  addiu(SP, SP, -24), sw(RA, 0, SP), lw(RA, 0, SP), jr(RA), addiu(SP, SP, 24),
  here('leaf'),
  addu(V0, A0, A0), jr(RA), NOP,
];
// with its sections named, as a compiler writes a program
const made = options => build({ code, data: { table: [{ address: 'through a pointer' }, 7] }, imports: ['sceDisplayWaitVblankStart', 'sceKernelGetSystemTimeLow'], name: 'functions', sections: true, ...options });
const NAMES = ['start', 'called', 'through a pointer', 'by neither', 'leaf'];
const SIZES = [56, 16, 16, 20, 12];

for (const relocatable of [false, true]) {
  const kind = relocatable ? 'a relocatable program' : 'a program loaded where it says';
  test(`${kind}: each function is found where it runs, and the system's calls are kept out`, () => {
    const { elf, at } = made({ relocatable }), program = programOf(elf), functions = findFunctions(elf);
    assert.equal(program.load, relocatable ? PLACED_AT : LOAD_AT);
    assert.equal(program.entry, at.start);
    assert.equal(program.name, 'functions');
    assert.deepEqual(functions, NAMES.map((name, index) => ({ address: at[name], size: SIZES[index] })));
    assert.deepEqual(program.imports, [
      { address: at['call sceDisplayWaitVblankStart'], module: 'sceDisplay', number: 0x984C27E7 },
      { address: at['call sceKernelGetSystemTimeLow'], module: 'ThreadManForUser', number: 0x369ED59D },
    ]);
    // the call of the system's function is a call, and its target isn't in the map
    assert.ok(!functions.some(f => f.address === at['call sceDisplayWaitVblankStart']));
    assert.ok(inCode(elf)(at.leaf) && !inCode(elf)(at.table), 'the program\'s values after its code aren\'t code');
    assert.deepEqual(startsInData(elf, [{ address: at.leaf, size: 12 }, { address: at.table, size: 8 }]), [{ address: at.table, size: 8 }]);
  });
}

test('a program that names no sections has its code end where what it keeps for the system starts', () => {
  // the table right after the code, an address and a 7, reads as two instructions that end as a function does, and
  // with no section to say it's a value it's taken for one: the tools map a little too much rather than too little
  const { elf, at } = made({ sections: false }), functions = findFunctions(elf);
  assert.deepEqual(functions.slice(0, 5).map(f => f.address), NAMES.map(name => at[name]));
  assert.deepEqual(functions.slice(5), [{ address: at.table, size: 8 }]);
  assert.ok(!functions.some(f => f.address >= at.module || f.address === at['call sceDisplayWaitVblankStart']), 'nothing of what the program keeps for the system is mapped');
});

test('a relocatable program is placed as the emulator places it: every address in it is put right', () => {
  const fixed = made({}), placed = made({ relocatable: true });
  const a = programOf(fixed.elf), b = programOf(placed.elf);
  assert.equal(a.text.length, b.text.length);
  const moved = (PLACED_AT - LOAD_AT) >>> 0;
  const word = (program, name, offset = 0) => program.text.readUInt32LE((program === a ? fixed : placed).at[name] + offset - program.load);
  // a word that holds an address, a call's 26 bits, and the two halves an address is made of
  assert.equal((word(b, 'table') - word(a, 'table')) >>> 0, moved);
  assert.equal(decode(word(b, 'start', 8), placed.at.start + 8, 'allegrex').target, placed.at.called);
  assert.equal(decode(word(a, 'start', 8), fixed.at.start + 8, 'allegrex').target, fixed.at.called);
  const address = (program, built) => {
    const at = built.at.start + 32, upper = program.text.readUInt32LE(at - program.load), lower = program.text.readUInt32LE(at + 4 - program.load);
    return (((upper & 0xFFFF) << 16) + ((lower << 16) >> 16)) >>> 0;
  };
  assert.equal(address(a, fixed), fixed.at.table);
  assert.equal(address(b, placed), placed.at.table);
  // a word that holds no address is as it was
  assert.equal(word(b, 'table', 4), 7);
  // and a list of its functions made for the fixed one fits once moved
  assert.deepEqual(findFunctions(placed.elf).map(f => f.address - PLACED_AT), findFunctions(fixed.elf).map(f => f.address - LOAD_AT));
});

test('the program is read from a file of its own, from a disc and from a PBP, and an encrypted one says so', async () => {
  const work = join(LOCAL, 'tmp', 'psp-functions-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { elf } = made({ relocatable: true });
    writeFileSync(join(work, 'program.prx'), elf);
    assert.deepEqual(await pspProgram(join(work, 'program.prx')), elf);
    assert.equal((await readAnyCopy(join(work, 'program.prx'))).console, 'psp');
    // a disc: its program is PSP_GAME/SYSDIR/EBOOT.BIN
    writeFileSync(join(work, 'disc.iso'), madeUpPspDisc({ 'PSP_GAME/PARAM.SFO': Buffer.alloc(16), 'PSP_GAME/SYSDIR/EBOOT.BIN': elf }));
    assert.deepEqual(await pspProgram(join(work, 'disc.iso')), elf);
    const known = await readAnyCopy(join(work, 'disc.iso'));
    assert.equal(known.console, 'psp');
    assert.equal(known.code, 'TEST-00001');
    // a disc whose EBOOT.BIN is encrypted and whose BOOT.BIN beside it is plain
    writeFileSync(join(work, 'plain.iso'), madeUpPspDisc({ 'PSP_GAME/SYSDIR/EBOOT.BIN': Buffer.concat([Buffer.from('~PSP'), Buffer.alloc(64)]), 'PSP_GAME/SYSDIR/BOOT.BIN': elf }));
    assert.deepEqual(await pspProgram(join(work, 'plain.iso')), elf);
    // and one with no plain program
    writeFileSync(join(work, 'encrypted.iso'), madeUpPspDisc({ 'PSP_GAME/SYSDIR/EBOOT.BIN': Buffer.concat([Buffer.from('~PSP'), Buffer.alloc(64)]), 'PSP_GAME/SYSDIR/BOOT.BIN': Buffer.alloc(64) }));
    await assert.rejects(pspProgram(join(work, 'encrypted.iso')), /encrypted/);
    // a PBP: eight parts, the seventh the program
    const header = Buffer.alloc(40);
    header.write('\0PBP', 0, 'latin1');
    header.writeUInt32LE(0x10000, 4);
    for (let part = 0; part < 8; part++) header.writeUInt32LE(40 + (part > 6 ? elf.length : 0), 8 + part * 4);
    writeFileSync(join(work, 'EBOOT.PBP'), Buffer.concat([header, elf]));
    assert.deepEqual(await pspProgram(join(work, 'EBOOT.PBP')), elf);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('the Allegrex\'s own instructions are read, and what it hasn\'t is none', () => {
  const text = word => decode(word, 0x08900000, 'allegrex')?.text ?? null;
  assert.equal(text(0x7C042C20), 'seb     $a1, $a0');
  assert.equal(text(0x7C0428A0), 'wsbh    $a1, $a0');
  assert.equal(text(0x7C853900), 'ext     $a1, $a0, 4, 8');
  assert.equal(text(0x0085102C), 'max     $v0, $a0, $a1');
  assert.equal(text(0x00801016), 'clz     $v0, $a0');
  assert.equal(text(0x00241102), 'rotr    $v0, $a0, 4');
  assert.equal(text(0x0085100A), 'movz    $v0, $a0, $a1');
  assert.equal(text(0x46020840), 'add.s   $f1, $f1, $f2');
  assert.equal(decode(0xD8850000, 0, 'allegrex').name, 'lv.q');
  assert.deepEqual([decode(0xD8850000, 0, 'allegrex').kind, decode(0xD8850000, 0, 'allegrex').bytes], ['load', 16]);
  assert.deepEqual([decode(0xE8850008, 0, 'allegrex').name, decode(0xE8850008, 0, 'allegrex').kind, decode(0xE8850008, 0, 'allegrex').bytes], ['sv.s', 'store', 4]);
  assert.equal(decode(0x49000003, 0x08900000, 'allegrex').target, 0x08900010);
  assert.equal(decode(0x51000003, 0x08900000, 'allegrex').likely, true);
  assert.equal(decode(0x6C420003, 0, 'allegrex').kind, 'vfpu');
  // a double float's sum and a 64-bit load are the Nintendo 64's, not this processor's
  assert.equal(isInstruction(0x46220840, 'allegrex'), false);
  assert.equal(isInstruction(0xDC850000, 'vr4300'), true);
  assert.equal(decode(0xDC850000, 0, 'allegrex').kind, 'vfpu');
  assert.equal(isInstruction(0x0085102D, 'r3000a'), false);
});
