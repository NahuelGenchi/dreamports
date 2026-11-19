// The PlayStation 2's instruction tables (tools/ps2/ee.mjs, tools/ps2/vu.mjs), its function finder over a whole disc
// (tools/ps2/functions.mjs) and `read` on it (tools/ps2/read.mjs), on words written here and on a made-up disc of the
// tools' tests (made-up-ps2-disc.mjs), with nothing from any game in them.
//
// The EE's texts were checked against GNU binutils 2.43's objdump for the R5900 when they were written, on every form
// of the table with random fields and on 400,000 random words. They differ where the table chooses so a text always
// gives back its own word: `or` and `addu` with $zero aren't written `move`, which is `daddu`'s, `ori` with $zero is
// `li` only for a number addiu can't hold, and `bgez $zero` isn't `b`. GNU 2.43 also writes vadda and vmsuba with ft
// before fs, and encodes sqrt.s with fs, where the EE takes ft, as Sony's manual has it; the table keeps the processor's
// way in both. GNU has no reader for vector unit programs, so their table was checked against Play!'s.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { formatCodeMap, parseCodeMap } from '../lib/proof-files.mjs';
import { TABLE, decode, encode, isInstruction } from '../ps2/ee.mjs';
import { LOWER, UPPER, decodePair, encodePair } from '../ps2/vu.mjs';
import { discFunctions, findFunctions, findVuUploads, inCode, ps2Disc } from '../ps2/functions.mjs';
import { ps2Resolve, readPs2 } from '../ps2/read.mjs';
import { BOOT, MAIN, madeUpPs2Disc } from './made-up-ps2-disc.mjs';

// a word made from numbers that look random, the same on every run
function* numbers(seed = 1) {
  for (;;) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const high = seed >>> 16;
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    yield ((high << 16) | (seed >>> 16)) >>> 0;
  }
}

test('reads the EE\'s instructions as GNU\'s tools write them', () => {
  const words = {
    0x00000000: 'nop', 0x000940C0: 'sll     $t0, $t1, 3', 0x0004103F: 'dsra32  $v0, $a0, 0', 0x01494014: 'dsllv   $t0, $t1, $t2',
    0x03E00008: 'jr      $ra', 0x01000008: 'jr      $t0', 0x0120F809: 'jalr    $t1', 0x01202009: 'jalr    $a0, $t1', 0x0085100A: 'movz    $v0, $a0, $a1',
    0x0000000C: 'syscall', 0x0007000D: 'break   0x7', 0x0000000F: 'sync', 0x0000040F: 'sync.p', 0x00001010: 'mfhi    $v0',
    0x00851018: 'mult    $v0, $a0, $a1', 0x0085001A: 'div     $zero, $a0, $a1', 0x00851021: 'addu    $v0, $a0, $a1', 0x0080102D: 'move    $v0, $a0',
    0x00801025: 'or      $v0, $a0, $zero', 0x00041023: 'negu    $v0, $a0', 0x0085102D: 'daddu   $v0, $a0, $a1', 0x00800029: 'mtsa    $a0',
    0x00850034: 'teq     $a0, $a1', 0x0004183C: 'dsll32  $v1, $a0, 0', 0x24020005: 'li      $v0, 5', 0x34028000: 'li      $v0, 0x8000',
    0x27BDFFE0: 'addiu   $sp, $sp, -32', 0x67BDFFF0: 'daddiu  $sp, $sp, -16', 0x308200FF: 'andi    $v0, $a0, 0xFF', 0x3C010010: 'lui     $at, 0x10',
    0x8FBF0010: 'lw      $ra, 16($sp)', 0xDFBF0000: 'ld      $ra, 0($sp)', 0xFFBF0000: 'sd      $ra, 0($sp)', 0x7BB00000: 'lq      $s0, 0($sp)',
    0x7FB00010: 'sq      $s0, 16($sp)', 0x9C820004: 'lwu     $v0, 4($a0)', 0x68820003: 'ldl     $v0, 3($a0)', 0xBC870000: 'cache   0x7, 0($a0)',
    0xCC800010: 'pref    0, 16($a0)', 0x70851008: 'paddw   $v0, $a0, $a1', 0x70851488: 'pextlw  $v0, $a0, $a1', 0x70851128: 'padsbh  $v0, $a0, $a1',
    0x708514A9: 'por     $v0, $a0, $a1', 0x70001030: 'pmfhl.lw $v0', 0x70851018: 'mult1   $v0, $a0, $a1', 0x7085001A: 'div1    $zero, $a0, $a1',
    0x70851000: 'madd    $v0, $a0, $a1', 0x70801004: 'plzcw   $v0, $a0', 0x70051134: 'psllh   $v0, $a1, 4', 0x40026000: 'mfc0    $v0, $12',
    0x42000018: 'eret', 0x42000038: 'ei', 0x4002C000: 'mfbpc   $v0', 0x44026000: 'mfc1    $v0, $f12', 0x44C2F800: 'ctc1    $v0, $31',
    0x46030840: 'add.s   $f1, $f1, $f3', 0x46001064: 'trunc.w.s $f1, $f2', 0x4603105C: 'madd.s  $f1, $f2, $f3', 0x46020818: 'adda.s  $f1, $f2',
    0x46801020: 'cvt.s.w $f0, $f2', 0x46020832: 'c.eq.s  $f1, $f2', 0xC7A10010: 'lwc1    $f1, 16($sp)', 0xD8810010: 'lqc2    $vf1, 16($a0)',
    0x48221800: 'qmfc2   $v0, $vf3', 0x48221801: 'qmfc2.i $v0, $vf3', 0x48A20800: 'qmtc2   $v0, $vf1', 0x48421800: 'cfc2    $v0, $vi3',
    0x4BE31068: 'vadd.xyzw $vf1xyzw, $vf2xyzw, $vf3xyzw', 0x4BC31040: 'vaddx.xyz $vf1xyz, $vf2xyz, $vf3x', 0x4BE009FC: 'vmulaq.xyzw $ACCxyzw, $vf1xyzw, $Q',
    0x4A820BBC: 'vdiv    $Q, $vf1x, $vf2y', 0x4A2003BD: 'vsqrt   $Q, $vf0x', 0x4BE20B7D: 'vsqi.xyzw $vf1xyzw, ($vi2++)', 0x4BC209FF: 'vclipw.xyz $vf1xyz, $vf2w',
    0x4A0002FF: 'vnop', 0x4A011772: 'viaddi  $vi1, $vi2, -3', 0x4A000838: 'vcallms 0x100', 0x4BE1133C: 'vmove.xyzw $vf1xyzw, $vf2xyzw',
    0x4B0113FD: 'vmfir.x $vf1x, $vi2', 0x4A8003FE: 'vilwr.y $vi0, ($vi0)',
  };
  for (const [word, text] of Object.entries(words)) {
    assert.equal(decode(Number(word), 0x100000)?.text, text, `0x${Number(word).toString(16)}`);
    assert.equal(encode(text, 0x100000), Number(word), text);
  }
  const at = 0x100000;
  assert.equal(decode(0x1085000F, at).text, 'beq     $a0, $a1, 0x100040');
  assert.equal(decode(0x5085000F, at).text, 'beql    $a0, $a1, 0x100040');
  assert.equal(decode(0x1000FFFF, at).text, 'b       0x100000');
  assert.equal(decode(0x04110004, at).text, 'bal     0x100014');
  assert.equal(decode(0x0C040009, at).text, 'jal     0x100024');
  // what isn't the EE's: a unit's register field it doesn't have, a field a word must leave clear, and opcodes it lacks
  for (const word of [0x4A0003FE, 0x00000005, 0x74000000, 0xE8000000, 0x46820820]) assert.ok(!isInstruction(word), `0x${word.toString(16)}`);
});

test('every form of every instruction reads back to its own word', () => {
  const random = numbers(7);
  let checked = 0;
  for (const entry of TABLE) {
    for (let i = 0; i < 24; i++) {
      const word = (entry.value | (random.next().value & ~entry.mask)) >>> 0, found = decode(word, 0x00200000);
      if (!found) continue;
      assert.equal(encode(found.text, 0x00200000), word, `${found.text} (0x${word.toString(16)})`);
      checked++;
    }
  }
  assert.ok(checked > 8000, `${checked} words`);
  // the long form of a short one gives the same word, and a number that doesn't fit is refused
  assert.equal(encode('beq $zero, $zero, 0x100000', 0x100000), encode('b 0x100000', 0x100000));
  assert.equal(encode('daddu $v0, $a0, $zero'), encode('move $v0, $a0'));
  assert.equal(encode('cvt.w.s $f1, $f2'), encode('trunc.w.s $f1, $f2'));
  assert.equal(encode('sync.l'), 0x0000000F);
  assert.throws(() => encode('addiu $v0, $v0, 40000'), /doesn't fit/);
  assert.throws(() => encode('paddq $v0, $v0, $v0'), /isn't one of the EE's/);
});

test('what the table says each instruction does', () => {
  const at = 0x100000;
  assert.deepEqual([decode(0x03E00008).kind, decode(0x01000008).kind, decode(0x0C040009, at).kind, decode(0x0C040009, at).writes], ['return', 'switch', 'call', 31]);
  assert.deepEqual([decode(0x5085000F, at).kind, decode(0x5085000F, at).likely, decode(0x1085000F, at).likely], ['branch', true, undefined]);
  assert.deepEqual([decode(0x7BB00000).kind, decode(0x7BB00000).bytes, decode(0x7BB00000).writes, decode(0xFFBF0000).kind, decode(0xFFBF0000).bytes], ['load', 16, 16, 'store', 8]);
  assert.deepEqual([decode(0x70851008).writes, decode(0x00851018).writes, decode(0x00850018).writes], [2, 2, null]);
  assert.deepEqual([decode(0x42000018).kind, decode(0x0000000C).kind, decode(0x00850034).kind], ['return', 'trap', 'trap']);
  assert.equal(decode(0x0C040009, at).target, 0x100024);
  assert.equal(decode(0x27BDFFE0).imm, -32);
});

test('reads a vector unit\'s pairs, upper first, and writes them back', () => {
  const pair = (text, at = 0) => decodePair(...encodePair(text, at), at);
  assert.equal(decodePair(0x8000033C, 0x400002FF).text, 'nop[e]                       nop');
  assert.ok(decodePair(0x8000033C, 0x400002FF).ends);
  assert.equal(pair('mulax.xyzw ACC, vf04, vf03x lqi.xyzw vf05, (vi01++)').text, 'mulax.xyzw ACC, vf04, vf03x  lqi.xyzw vf05, (vi01++)');
  assert.equal(pair('addi.xyzw vf01, vf00, I loi 1.5').immediate, 1.5);
  assert.equal(pair('addi.xyzw vf01, vf00, I loi 1.5').lower, 'loi 0x3FC00000');
  const branch = pair('nop ibne vi01, vi02, 0x8', 0x18);
  assert.deepEqual([branch.kind, branch.target, branch.lower], ['branch', 0x8, 'ibne vi01, vi02, 0x8']);
  assert.deepEqual([pair('nop jr vi15').kind, pair('nop jr vi01').kind, pair('nop bal vi15, 0x40').kind], ['return', 'switch', 'call']);
  assert.equal(pair('clipw.xyz vf01, vf02w div Q, vf03x, vf04y').upper, 'clipw.xyz vf01, vf02w');
  assert.equal(pair('nop iaddiu vi01, vi02, 0x7FFF').lower, 'iaddiu vi01, vi02, 0x7FFF');
  assert.equal(pair('ftoi4.xyzw vf01, vf02 sq.xyzw vf03, -2(vi04)').text, `${'ftoi4.xyzw vf01, vf02'.padEnd(28)} sq.xyzw vf03, -2(vi04)`);
  // the units have 16 integer registers, and an upper word never has bits 26 and 25
  assert.equal(decodePair(0x0B1E0000 | 0x00100000, 0x000002FF), null);
  assert.equal(decodePair(0x8000033C, 0x020002FF), null);
  // every lower with every upper, with random fields and flags, reads back to its own words
  const random = numbers(3);
  let checked = 0;
  for (const lower of LOWER) {
    for (const upper of UPPER) {
      const l = (lower.value | (random.next().value & ~lower.mask)) >>> 0;
      const u = (upper.value | (random.next().value & ~upper.mask & 0x01FFFFFF) | (random.next().value & 0x78000000)) >>> 0;
      const found = decodePair(l, u, 0x100);
      if (!found) continue;
      assert.deepEqual(encodePair(found.text, 0x100), [l, u], found.text);
      checked++;
    }
  }
  assert.ok(checked > 3000, `${checked} pairs`);
});

test('finds a vector unit\'s uploads by their MPG commands', () => {
  const { boot } = madeUpPs2Disc();
  const { elf, uploads } = boot;
  const vutext = elf.subarray(elf.indexOf(Buffer.from([0, 0, 0, 0, 0, 0, 4, 0x4A])));
  assert.deepEqual(findVuUploads(vutext).map(u => ({ size: u.size, vuAddress: u.vuAddress })), uploads.map(u => ({ size: u.size, vuAddress: u.vuAddress })));
  // fewer instructions than asked for, a command whose instructions aren't all the unit's, and one past the memory
  assert.deepEqual(findVuUploads(vutext, { least: 8 }), []);
  const broken = Buffer.from(vutext);
  broken.writeUInt32LE(0xFFFFFFFF, 8);
  assert.equal(findVuUploads(broken).length, 1);
  const far = Buffer.from(vutext);
  far.writeUInt16LE(0x7FF, 4);
  assert.equal(findVuUploads(far).length, 1);
});

test('maps every program on a made-up disc, and keeps its .vutext out of the EE\'s code', async () => {
  const work = join(LOCAL, 'tmp', 'ps2-read-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { disc, boot, module, second, data } = madeUpPs2Disc();
    const path = join(work, 'made-up.iso');
    writeFileSync(path, disc);
    const code = await ps2Disc(path);
    assert.equal(code.bootName, 'MADE_UP.ELF');
    assert.deepEqual(code.programs.map(p => [p.path, p.kind]), [
      ['DATA/MODELS.BIN:0x' + data.programAt.toString(16).toUpperCase(), 'ee'], ['IOPRP.IMG:SECOND', 'iop'], ['MADE_UP.IRX', 'iop'], ['OTHER.ELF', 'ee'],
    ]);
    const functions = discFunctions(code);
    const where = place => functions.filter(f => `${f.program ?? ''}${f.vu ? '~vu' : ''}` === place).map(f => [f.address, f.size]);
    assert.deepEqual(where(''), [[boot.labels.main, boot.labels.sum - boot.labels.main], [boot.labels.sum, BOOT.text + (MAIN.length - 3) * 4 - boot.labels.sum]]);
    assert.deepEqual(where('~vu'), boot.uploads.map(u => [u.at, u.size]));
    assert.deepEqual(where('MADE_UP.IRX'), [[0, module.labels.helper], [module.labels.helper, module.size - module.labels.helper]]);
    assert.deepEqual(where('IOPRP.IMG:SECOND'), [[0, second.size]]);
    assert.deepEqual(where('OTHER.ELF'), [[0x00300000, 12]]);
    assert.deepEqual(where(`DATA/MODELS.BIN~vu`), [[data.uploadAt, data.uploadSize]]);
    assert.ok(!inCode(code.boot)(BOOT.vutext + 8), 'the vector unit\'s code is no EE function');
    assert.deepEqual(findFunctions(code.boot).map(f => f.address), [boot.labels.main, boot.labels.sum]);
    // a code map keeps each where it is, and reads back the same
    const map = parseCodeMap(JSON.parse(formatCodeMap({ original: 'x', from: 'y', functions })));
    assert.deepEqual(map.functions.filter(f => f.program === 'MADE_UP.IRX').map(f => f.key), ['00000000@MADE_UP.IRX', `${module.labels.helper.toString(16).toUpperCase().padStart(8, '0')}@MADE_UP.IRX`]);
    assert.ok(map.functions.some(f => f.key === `${(BOOT.vutext + 8).toString(16).toUpperCase().padStart(8, '0')}~vu` && f.vu && !f.program));
    // a list's names are kept, each in its own program, and the rest found again around them
    const named = functions.map(f => (f.program === 'MADE_UP.IRX' && f.address === 0 ? { ...f, name: 'module_start' } : f));
    assert.deepEqual(discFunctions(code, named), named);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('read on the made-up disc: the EE\'s code, a vector unit\'s and an IOP module\'s', async () => {
  const work = join(LOCAL, 'tmp', 'ps2-read-test-2');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { disc, boot, module, data } = madeUpPs2Disc();
    const path = join(work, 'made-up.iso');
    writeFileSync(path, disc);
    const functions = discFunctions(await ps2Disc(path)).map(f => (f.address === boot.labels.sum && !f.program ? { ...f, name: 'sum' } : f));
    const codeMap = parseCodeMap(JSON.parse(formatCodeMap({ original: 'x', from: 'y', functions })));
    const read = what => readPs2({ game: 'made-up', what, original: { name: 'Made Up' }, codeMap, copy: { path }, flags: {} });
    const main = await read(`0x${boot.labels.main.toString(16)}`);
    assert.match(main.text, /jal +0x100024 {2}; sum/);
    assert.match(main.text, /addiu +\$a0, \$a0, 768 {2}; 0x00100300/);
    const sum = await read('sum');
    assert.match(sum.text, /^sum, at 0x00100024, in Made Up: the whole function, 52 bytes/);
    assert.match(sum.text, /paddw +\$v0, \$a0, \$a1/);
    assert.match(sum.text, /vadd\.xyzw \$vf2xyzw, \$vf1xyzw, \$vf1xyzw/);
    assert.equal((await read(`func_${boot.labels.sum.toString(16).padStart(8, '0')}`)).key, sum.key);
    const vu = await read(`0x${(BOOT.vutext + 8).toString(16)}`);
    assert.match(vu.text, /^The vector unit program at 0x00100208 in Made Up/);
    assert.match(vu.text, /00100210 {2}0008: {2}\S+ \S+ {2}mulax\.xyzw ACC, vf04, vf03x {2}lqi\.xyzw vf05, \(vi01\+\+\)/);
    assert.match(vu.text, /nop\[e\] +nop {2}; the program ends after the next pair/);
    const second = await read(`${(boot.uploads[1].at).toString(16).toUpperCase().padStart(8, '0')}~vu`);
    assert.match(second.text, /0080: {2}3FC00000 \S+ {2}addi\.xyzw vf01, vf00, I +loi 0x3FC00000 {2}; I = 1\.5/);
    const iop = await read('0x0@MADE_UP.IRX');
    assert.match(iop.text, /^func_00000000 of MADE_UP\.IRX, at 0x00000000, in Made Up: the whole function, 28 bytes/);
    assert.match(iop.text, /jal +0x1C {2}; func_0000001C/);
    assert.match(iop.text, /the IOP makes of it/);
    assert.equal(iop.key, '00000000@MADE_UP.IRX');
    const inData = await read(`${data.uploadAt.toString(16)}@DATA/MODELS.BIN~vu`);
    assert.match(inData.text, /0100: .* mul\.xyzw vf01, vf01, vf02 +iaddi vi01, vi01, 1/);
    assert.equal(inData.key, '00000048@DATA_MODELS.BIN~vu');
    assert.deepEqual(ps2Resolve('made-up', codeMap, '120@MADE_UP.IRX'), { address: 0x120, program: 'MADE_UP.IRX', vu: false });
    await assert.rejects(read('0x00400000'), /isn't in the program Made Up boots/);
    await assert.rejects(read('0x0@NOWHERE.IRX'), /has no NOWHERE\.IRX/);
    assert.equal(module.labels.helper, 0x1C);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
