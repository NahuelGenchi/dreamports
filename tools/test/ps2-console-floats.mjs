// The PlayStation 2 kit's float sums against a real console's. The files in ps2-console-floats/ are what a console
// printed for the ps2autotests project's programs (https://github.com/unknownbrackets/ps2autotests, ISC licence, in
// ps2-console-floats/LICENSE): each line a sum, the floats it was given by their bits, and the bits it gave back. The
// kit's FPU (kit/ps2/c/ee.c) and its float rules (kit/ps2/c/floats.c), which the console's emulator in the proof tools
// shares, are built for this computer and given the same sums, and have to give the same bits.
//
// - ee-*.expected: the EE's FPU, every sum of tests/cpu/ee_fpu's arithmetic, muldiv, sqrt, convert and compare.
// - ee-fcr.expected: the FPU's control registers, tests/cpu/ee_fpu/fcr: what CFC1 reads, what CTC1 keeps, and the flags
//   seven sums raise.
// - vu-efu.expected: the vector units' EFU, tests/vu/lower/efu.
// - vu-triace.expected: the products and sums of tests/vu/games/triace, which a game's copy protection rests on.
//
// What the kit is known not to give yet is named in KNOWN, each with the console's bits, so a change that puts one
// right, or breaks another, is seen. Run before `npm run test:ps2-ee-vu`'s own comparison, and needs only a C compiler.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { cKit, SAME_FLAGS } from '../lib/c.mjs';

const HERE = fileURLToPath(new URL('./ps2-console-floats/', import.meta.url));
const WORK = join(LOCAL, 'test-ps2-console-floats');
const read = name => readFileSync(join(HERE, name), 'utf8');
const hex = value => (value >>> 0).toString(16).padStart(8, '0');
// a float as the console's printf("%f") shows it
const shown = bits => {
  const value = new Float32Array(new Uint32Array([bits]).buffer)[0];
  return Number.isNaN(value) ? 'NaN' : value.toFixed(6);
};

// the floats the tests name, as tests/cpu/ee_fpu/shared.h and tests/vu/lower/efu.cpp set them
const NAMED = {
  ZERO: 0x00000000, NEGZERO: 0x80000000, MAX: 0x7FFFFFFF, MIN: 0xFFFFFFFF, MAX_MANTISSA: 0x3FFFFFFF, MAX_EXP: 0x7F800001,
  MIN_EXP: 0x00000001, ONE: 0x3F800000, NEGONE: 0xBF800000, GARBAGE1: 0x00001337, GARBAGE2: 0xDEADBEEF,
  PI_OVER2: 0x3FC90FDB, PI: 0x40490FDB, '3PI_OVER2': 0x4096CBE4,
};
const VECTORS = { INCREASING: [0x3F800000, 0x40000000, 0x40400000, 0x40800000], DECREASING: [0x40800000, 0x40400000, 0x40000000, 0x3F800000] };
// "3f800000/+1.00" or a name
const float = text => {
  const word = text.trim();
  return /^CF_/.test(word) ? NAMED[word.slice(3)] : parseInt(word.split('/')[0], 16);
};

// EATAN of a zero: the unit's own way of working it out isn't known, and no order of the manual's formula gives this
const KNOWN = new Map(['ZERO', 'NEGZERO', 'MIN_EXP', 'GARBAGE1'].map(name => [`EATAN CVF_${name}`, 0x33E60000]));

const sums = [];
// The control registers come first, as the first reads FCSR as the kit starts it. CTC1 writes each value in turn, as
// fcr.cpp does, and then each of the seven sums runs with FCSR written 0 first. A result is the 32 registers CFC1 reads,
// or fcr0 and fcr31 where the console printed only those, and the sum's float.
const WRITES = [
  ['Initial'], ['Update fcr0', 0, 0xDEADBEEF], ['Update rounding mode (RM)', 31, 0x3], ['Update flags', 31, 0x7C], ['All regs'],
  ['Update enables', 31, 0xF80], ['Update cause', 31, 0x1F000], ['Update unimplemented (E)', 31, 0x20000],
  ['Update flushing (FS)', 31, 0x01000000], ['Update flushing (FO)', 31, 0x00400000], ['Update flushing (FN)', 31, 0x00200000],
  ['Update FCC', 31, 0x00800000], ['Update FCC1-7', 31, 0xFE000000], ['Update unknown', 31, 0x001C0000],
];
const FLAG_SUMS = [
  ['sqrt(-1)', 'sqrt bf800000 0'], ['Divide zero by zero', 'div 0 0'], ['Divide one by zero', 'div 3f800000 0'],
  ['NAN math', 'add 7f800001 7f800001'], ['Overflow', 'mul 7f7fffff 7f7fffff'], ['Underflow', 'div 00800000 40400000'],
  ['Inexact', 'div 3f800000 4040ffff'],
];
{
  const printed = new Map();
  let title;
  for (const line of read('ee-fcr.expected').split('\n')) {
    if (/^\S.*:$/.test(line)) printed.set(title = line.slice(0, -1), {});
    else if (/^ {2}fcr/.test(line)) printed.get(title).words = [...line.matchAll(/fcr(\d+): ([0-9a-f]{8})/g)].map(([, n, word]) => [Number(n), parseInt(word, 16)]);
    else if (/^ {2}result = /.test(line)) printed.get(title).result = line.slice('  result = '.length);
  }
  const check = (title, ask) => {
    const { words, result } = printed.get(title);
    const differ = answer => words.filter(([n, word]) => answer[1 + n] !== word);
    sums.push({
      line: title, group: 'the FPU\'s control registers', ask,
      right: (got, acc, answer) => !differ(answer).length && (result === undefined || shown(got) === result),
      told: answer => [...differ(answer).map(([n, word]) => `fcr${n} ${hex(answer[1 + n])} where the console read ${hex(word)}`), ...(result !== undefined && shown(answer[0]) !== result ? [`a result of ${shown(answer[0])} where the console's was ${result}`] : [])].join(', '),
    });
  };
  for (const [title, reg = -1, value = 0] of WRITES) check(title, `fcr ${reg} ${hex(value)} - 0 0`);
  for (const [title, sum] of FLAG_SUMS) check(title, `fcr 31 0 ${sum}`);
}
for (const file of ['ee-arithmetic', 'ee-muldiv', 'ee-sqrt', 'ee-convert', 'ee-compare']) {
  for (const line of read(`${file}.expected`).split('\n')) {
    const match = /^ {2}([a-z.]+) (?:\((.*?)\) )?(.*?): (\S+)(?: \((.*?)\))?$/.exec(line);
    // mov gives back what it's given, with no sum
    if (!match || match[1] === 'mov') continue;
    const [, name, acc, given, result, accAfter] = match, [a, b = 0] = given.split(',').map(float);
    const toAcc = ['adda', 'suba', 'mula', 'madda', 'msuba'].includes(name), condition = result === 'true' || result === 'false';
    sums.push({
      line: line.trim(), group: `the FPU's ${name}`, ask: `${name} ${hex(a)} ${hex(b)} ${hex(acc ? float(acc) : 0)}`,
      right: (got, gotAcc) => condition ? (got !== 0) === (result === 'true') : toAcc ? gotAcc === float(result) : got === float(result) && (accAfter === undefined || gotAcc === float(accAfter)),
    });
  }
}
for (const line of read('vu-efu.expected').split('\n')) {
  const match = /^ {2}(\w+) CVF_(\w+): (\w+)\//.exec(line);
  if (!match) continue;
  const [, name, given, result] = match, vector = VECTORS[given] ?? Array(4).fill(NAMED[given]);
  sums.push({ line: `${name} CVF_${given}`, group: `the EFU's ${name}`, ask: `efu ${name} ${vector.map(hex).join(' ')}`, right: got => got === parseInt(result, 16), console: parseInt(result, 16) });
}
// Tri-Ace's: VF02 is VF01 by I a field at a time, VF03 is VF02 plus the next I
{
  const rows = read('vu-triace.expected').split('\n').filter(line => /^[0-9a-f]{8}\//.test(line)).map(line => line.split(' ').map(float));
  const products = [0x42FECCCD, 0x43D80D3E, 0x43A0DA10, 0x43546E14], added = [0x42546666, 0xC7F079B3, 0x43A02666, 0x42F23333];
  for (let f = 0; f < 4; f++) {
    sums.push({ line: `Tri-Ace's product, field ${f}`, group: 'Tri-Ace\'s sums', ask: `mul ${hex(rows[0][f])} ${hex(products[f])} 0`, right: got => got === rows[1][f] });
    sums.push({ line: `Tri-Ace's sum, field ${f}`, group: 'Tri-Ace\'s sums', ask: `add ${hex(rows[1][f])} ${hex(added[f])} 0`, right: got => got === rows[2][f] });
  }
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
let failed = 0;
try {
  const kit = cKit('ps2'), program = join(WORK, 'sums');
  const sources = ['floats.c', 'ee.c'].map(file => join(REPO, 'kit', 'ps2', 'c', file));
  execFileSync(process.env.CC ?? 'cc', ['-std=c11', ...SAME_FLAGS, '-o', program, ...kit.folders.map(folder => `-I${folder}`), ...sources, join(REPO, 'tools', 'test', 'ps2-console-floats.c')], { stdio: ['ignore', 'inherit', 'inherit'] });
  const answers = execFileSync(program, { input: `${sums.map(sum => sum.ask).join('\n')}\n`, encoding: 'utf8' }).trim().split('\n').map(line => line.split(' ').map(word => parseInt(word, 16)));
  if (answers.length !== sums.length) throw new Error(`The kit answered ${answers.length} of ${sums.length} sums.`);

  const groups = new Map();
  sums.forEach((sum, i) => {
    const answer = answers[i], [got, acc] = answer, group = groups.get(sum.group) ?? groups.set(sum.group, { same: 0, known: 0, wrong: [] }).get(sum.group);
    const known = KNOWN.get(sum.line);
    if (known !== undefined && known === sum.console && !sum.right(got, acc)) group.known++;
    else if (known !== undefined) group.wrong.push(`${sum.line}: the kit now gives the console's ${hex(got)}, so it comes off the list of what's known to differ`);
    else if (sum.right(got, acc, answer)) group.same++;
    else group.wrong.push(`${sum.line}: ${sum.told ? sum.told(answer) : `the kit gave ${hex(got)}${sum.ask.startsWith('efu') ? '' : `, ACC ${hex(acc)}`}`}`);
  });
  for (const [name, { same, known, wrong }] of groups) {
    console.log(`  ${wrong.length ? 'FAILED' : 'ok'}: ${name}: ${same} of ${same + known + wrong.length} as the console's${known ? `, ${known} known to differ` : ''}`);
    for (const line of wrong) console.log(`      ${line}`);
    failed += wrong.length;
  }
  console.log(`\n${sums.length} results a console printed, ${sums.length - failed - [...groups.values()].reduce((n, g) => n + g.known, 0)} the same on the kit.`);
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
if (failed) {
  console.log(`\n${failed} of the kit's results aren't the console's.`);
  process.exit(1);
}
console.log('\nAll passed.');
