// npm run test:match: tries match (../match.mjs) with the Game Boy Advance's own compiler and a program of the
// project's own (match/program.c), so it needs nobody's copy of any game. It builds the compiler if it isn't built,
// builds the program with it, and makes up a cartridge: each function placed at the address its comment names, in
// another order than the file's, with every call and address filled in by the few lines here, not by match's. Then
// match has to say every function is the same as that cartridge's, that one whose C was changed differs and the rest
// don't, and that a function using a name with no address can't be the same.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { assemble } from '../gba/thumb.mjs';
import { addressFinder, matchFile } from '../gba/match.mjs';

const HERE = fileURLToPath(new URL('./match/', import.meta.url));
const work = join(LOCAL, 'tmp', 'match-test');
// the flags Game Boy Advance games of the time were built with
const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
const CARTRIDGE = 0x08000000;
// where the made-up cartridge has each function, as the program's comments say, and each thing the program doesn't define
const FUNCTIONS = { MoveBalls: 0x08000200, Bounce: 0x08000280, Mover: 0x080002C0, MoveBall: 0x08000300, StepFor: 0x08000400, sub_8000480: 0x08000480 };
const NAMED = new Map([['gBalls', 0x03000100], ['gFrame', 0x03000020], ['DrawBall', 0x08000541]]);
const OTHERS = { ...Object.fromEntries(NAMED), gUnknown_03000040: 0x03000040, sub_8000500: 0x08000500 };

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// The made-up cartridge, from the assembly the compiler wrote: each function's bytes where FUNCTIONS says, and each
// place the assembler left filled in.
function cartridge(assembly) {
  const { sections, symbols, relocations } = assemble(assembly);
  const text = Buffer.from(sections['.text'].bytes), image = Buffer.alloc(0x600);
  const starts = Object.keys(FUNCTIONS).map(name => symbols.get(name).at).sort((a, b) => a - b);
  // every function, the made-up cartridge's or not, runs up to the next one in the file
  const all = [...symbols].filter(([, symbol]) => symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
  all.forEach((f, i) => { f.until = all[i + 1]?.at ?? text.length; });
  const around = at => all.find(f => at >= f.at && at < f.until);
  const moved = at => { const f = around(at); return FUNCTIONS[f.name] + at - f.at; };
  for (const { at, kind, name, addend } of relocations) {
    if (FUNCTIONS[around(at).name] === undefined) continue;
    const symbol = symbols.get(name);
    const target = symbol?.section === '.text' ? moved(symbol.at) + addend + (symbol.function ? 1 : 0) : OTHERS[name] + addend;
    if (kind === 'word') text.writeUInt32LE(target, at);
    else {
      const jump = (target & ~1) - (moved(at) + 4);
      text.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
      text.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
    }
  }
  const sizes = new Map();
  for (const f of all) {
    if (FUNCTIONS[f.name] === undefined) continue;
    text.copy(image, FUNCTIONS[f.name] - CARTRIDGE, f.at, f.until);
    // as a code map has it: without the zeros that line up the next function
    let size = f.until - f.at;
    while (size > 2 && text.readUInt16LE(f.at + size - 2) === 0 && starts.includes(f.until)) size -= 2;
    sizes.set(FUNCTIONS[f.name], size);
  }
  return { image, sizes };
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));

console.log('A program of the project\'s own, against a cartridge made from it:');
const matching = (file, extra = {}) => matchFile({
  file, compiler, work: join(work, 'built', 'program'),
  addressOf: addressFinder({ named: NAMED, startsFunction: address => address === OTHERS.sub_8000500 }),
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }), ...extra,
});
// built once to have the assembly the cartridge is made from, with nothing to compare with yet
const first = await matching(join(HERE, 'program.c'));
check(!first.error, `the program builds with ${compiler.name}${first.error ? `: ${first.error}` : ''}`);
if (first.error) process.exit(1);
const { image, sizes } = cartridge(readFileSync(join(work, 'built', 'program.s'), 'utf8'));
const against = {
  sizeOf: address => sizes.get(address) ?? null,
  original: (address, bytes) => ({ bytes: image.subarray(address - CARTRIDGE, address - CARTRIDGE + bytes) }),
};
const byName = result => Object.fromEntries(result.functions.map(f => [f.name, f]));

const same = await matching(join(HERE, 'program.c'), against);
const functions = byName(same);
for (const name of Object.keys(FUNCTIONS)) {
  check(functions[name]?.same === true && functions[name].address === FUNCTIONS[name], `${name} is the same as the cartridge's, at 0x0${FUNCTIONS[name].toString(16).toUpperCase()}`);
}
check(functions.Nobody?.address === null && functions.Nobody.same === undefined, 'a function with no address above it is compared with nothing');
check(same.unknown.length === 0, 'every name has an address');
check(functions.StepFor.bytes > 60 && readFileSync(join(work, 'built', 'program.s'), 'utf8').includes('mov\tpc, r'), 'one of them is a switch through a table of addresses');
check(image.readUInt32LE(FUNCTIONS.Mover - CARTRIDGE + 4) === (FUNCTIONS.MoveBalls | 1), 'a function\'s address is kept odd, as Thumb code\'s is');

// the same program with one comparison changed, as a twin written slightly wrong
const changed = join(work, 'changed');
mkdirSync(changed, { recursive: true });
const source = readFileSync(join(HERE, 'program.c'), 'utf8');
writeFileSync(join(changed, 'program.c'), source.replace('if (at > edge)', 'if (at >= edge)'));
writeFileSync(join(changed, 'program.h'), readFileSync(join(HERE, 'program.h')));
check(source.includes('if (at > edge)'), 'the program has the line the test changes');
const wrong = byName(await matching(join(changed, 'program.c'), against));
check(wrong.Bounce?.same === false && wrong.Bounce.differing > 0 && wrong.Bounce.first >= 0, `Bounce, with > changed to >=, differs: ${wrong.Bounce?.differing} of ${wrong.Bounce?.halfwords} halfwords, first at +${wrong.Bounce?.first}`);
check(Object.keys(FUNCTIONS).every(name => name === 'Bounce' || wrong[name]?.same === true), 'and every other function is still the same');

// a function longer than the cartridge's
writeFileSync(join(changed, 'program.c'), source.replace('gFrame++;', 'gFrame++;\n  gBalls[0].hits++;'));
const longer = byName(await matching(join(changed, 'program.c'), against));
check(longer.MoveBalls?.same === false && longer.MoveBalls.longer > 0, `MoveBalls, with a line more, is ${longer.MoveBalls?.longer} bytes longer and differs`);

// a name with no address
const missing = await matching(join(HERE, 'program.c'), { ...against, addressOf: addressFinder({ named: new Map([...NAMED].filter(([name]) => name !== 'gFrame')) }) });
const without = byName(missing);
check(without.StepFor?.same === false && without.MoveBalls?.same === false && without.StepFor.missing.includes('gFrame') && missing.unknown.includes('gFrame'), 'a function that uses a name with no address isn\'t the same, and the name is said');
check(without.Bounce?.same === true, 'and one that doesn\'t use it still is');

// C the compiler won't take
writeFileSync(join(changed, 'program.c'), `${source}\nvoid Broken(void) { return 1 +; }\n`);
const broken = await matching(join(changed, 'program.c'), against);
check(/program\.c:\d+:/.test(broken.error ?? ''), `C that doesn't build says where: ${(broken.error ?? '').split('\n')[0]}`);

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nmatch says the same of what is the same, and where it differs of what isn\'t.');
