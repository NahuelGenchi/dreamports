// npm run test:ps2-gcc: builds Sony's EE-GCC 2.9-ee-991111-01, its assembler for the EE and dvp-as, its assembler for
// the vector units, from Sony's GPL source on this computer (../ps2/gcc.mjs), which keeps them only if they make the
// original compiler's objects to the byte, and then uses them on what's written here, so it needs nobody's copy of any
// game. A C file of the project's own compiles to the EE's code, every word of it an instruction the tools' table reads;
// every form of both of the tools' tables (../ps2/ee.mjs, ../ps2/vu.mjs), with fields that look random, gives the same
// words through Sony's assemblers as through the tables; and C or an assembly that isn't right says why.

import { spawnSync } from 'node:child_process';
import { REPO } from '../lib/paths.mjs';
import { assembleEe, assembleVu, compileEe, ensureEeGcc } from '../ps2/gcc.mjs';
import { REGISTERS, TABLE, decode } from '../ps2/ee.mjs';
import { LOWER, UPPER, decodePair, encodePair } from '../ps2/vu.mjs';
import { sectionsOf } from '../ps2/functions.mjs';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const tracked = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf8' }).stdout;
const before = tracked();

// a section's bytes in an ELF object
const section = (object, name) => {
  const found = sectionsOf(object).find(s => s.name === name);
  return found ? object.subarray(found.offset, found.offset + found.size) : Buffer.alloc(0);
};
const words = bytes => Array.from({ length: bytes.length >> 2 }, (_, i) => bytes.readUInt32LE(i * 4));
// numbers that look random, the same on every run
let seed = 11;
const random = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  const high = seed >>> 16;
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return ((high << 16) | (seed >>> 16)) >>> 0;
};

console.log('Sony\'s EE-GCC 2.9-ee-991111-01, its assembler and dvp-as, built from its GPL source:');
const started = Date.now();
await ensureEeGcc();
console.log(`  (ready in ${Math.round((Date.now() - started) / 1000)} seconds)`);
check(true, 'it makes the original compiler\'s objects of the port\'s four tests, to the byte, or the build would have stopped');

const C = `int sum(int a, int b) { return a + b; }
float scale(float x, float y, float z) { return x * y + z; }
long long wide(long long a, int b) { return a * b; }
typedef int quad __attribute__((mode(TI)));
quad copy(quad *from) { return *from; }
int pick(unsigned n) { switch (n) { case 0: return 10; case 1: return 20; case 2: return 30; case 3: return 40; case 4: return 50; } return 0; }
`;
const built = await compileEe(C, { flags: ['-O2', '-G0'] });
check(!built.error, `it compiles C for the EE${built.error ? `: ${built.error}` : ''}`);
const text = built.object ? words(section(built.object, '.text')) : [];
check(text.length > 20 && text.every(word => decode(word) !== null), `every word of its code is an EE instruction the table reads: ${text.length} words`);
const assembly = await compileEe(C, { flags: ['-O2', '-G0'], assembly: true });
check(/\b(madd|mul)\.s\b/.test(assembly.assembly ?? '') && /\blq\b/.test(assembly.assembly ?? ''), `and writes its assembly too, a float sum and a 128-bit load among it${assembly.error ? `: ${assembly.error}` : ''}`);
const wrong = await compileEe('int f( { return 1; }', { flags: ['-O2'] });
check(/parse error|syntax error/.test(wrong.error ?? ''), `C that isn't C says why: ${wrong.error?.split('\n')[0]}`);

// every form of the EE's table, with random fields, through Sony's assembler, as GCC writes it: registers by number,
// no space after a comma, and the delay slots as they are
const forms = [];
for (const entry of TABLE) {
  for (let i = 0; i < 3; i++) {
    const word = (entry.value | (random() & ~entry.mask)) >>> 0, found = decode(word, 0);
    // branches go by their targets, which need an address, and a vector instruction naming no field is one Sony's refuses
    if (found && found.target === undefined && !/^v\w*\.\s/.test(found.text)) forms.push({ word, text: found.text });
  }
}
const asGcc = text => text.replace(/\$([a-z][a-z0-9]*)\b/g, (whole, name) => (REGISTERS.includes(name) ? `$${REGISTERS.indexOf(name)}` : whole)).replace(/,\s+/g, ',');
const ee = await assembleEe(`.set noreorder\n.set nomacro\n${forms.map(f => asGcc(f.text)).join('\n')}\n`);
const got = ee.object ? words(section(ee.object, '.text')) : [];
const apart = forms.filter((f, i) => got[i] !== f.word);
check(!ee.error && got.length === forms.length && !apart.length, `every form of the EE's table, ${forms.length} with random fields, makes the same word in Sony's assembler${ee.error ? `: ${ee.error.split('\n')[0]}` : ''}${apart.length ? `; ${apart.length} differ, as ${apart[0].text}` : ''}`);

// every lower form with an upper nop and every upper form with a lower nop, with random fields and flags, through dvp-as
const pairs = [];
for (const lower of LOWER) {
  if (lower.operands.includes('branch')) continue;
  for (let i = 0; i < 3; i++) {
    const word = (lower.value | (random() & ~lower.mask)) >>> 0, found = decodePair(word, 0x2FF, 0);
    if (found && !/\.\s/.test(found.lower)) pairs.push({ words: [word, 0x2FF], text: found.text });
  }
}
for (const upper of UPPER) {
  for (let i = 0; i < 3; i++) {
    const word = (upper.value | (random() & ~upper.mask & 0x01FFFFFF) | (random() & 0x58000000)) >>> 0, found = decodePair(0x8000033C, word, 0);
    if (found && !/\.[\s[]|\.$/.test(found.upper.split(' ')[0])) pairs.push({ words: [0x8000033C, word], text: found.text });
  }
}
// and a branch back to the first pair, by its label
pairs.push({ words: encodePair('nop ibne vi02, vi01, 0x0', pairs.length * 8), text: 'nop ibne vi02, vi01, here' });
const vu = await assembleVu(`.vu\nhere:\n${pairs.map(p => p.text).join('\n')}\n`);
const vuWords = vu.object ? words(section(vu.object, '.vutext')) : [];
const differing = pairs.filter((p, i) => vuWords[i * 2] !== p.words[0] || vuWords[i * 2 + 1] !== p.words[1]);
check(!vu.error && vuWords.length === pairs.length * 2 && !differing.length, `every form of the vector units' table, ${pairs.length} pairs with random fields, makes the same words in dvp-as${vu.error ? `: ${vu.error.split('\n')[0]}` : ''}${differing.length ? `; ${differing.length} differ, as ${differing[0].text}` : ''}`);
const bad = await assembleVu('.vu\nnop iaddiu vi01, vi00, 0x10, 3\n');
check(!!bad.error, `a pair dvp-as doesn't take says why: ${bad.error?.split('\n').find(line => /Error/.test(line))?.trim()}`);

check(tracked() === before, 'and it leaves the repository\'s files as they were');
if (failures.length) {
  console.log(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nSony\'s compiler and assemblers are built, make the original\'s objects, and agree with the tools\' tables.');
