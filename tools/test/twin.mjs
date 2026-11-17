// npm run test:twin: tries the function check (../twin.mjs) with a program of the project's own (twin/program.c), so
// it needs nobody's copy of any game. The console's own compiler builds the program into a made-up cartridge, each
// function at the address its comment names, and the reference emulator runs that as the original. The same C is the
// twins, built on the console's kit as a game's are. Then the check has to say every twin leaves the same memory, and
// has to find each twin the test spoils: a `>` turned to `>=`, found only because what the function reads is changed;
// a byte written to the kit's video memory as if it were plain memory, where the kit does what the hardware would; a
// function reached only through a pointer; a twin that never comes back, stopped and not hung; and a twin that calls
// something nothing built defines, which is said and not guessed at. A twin that names a function and a value of
// another file is linked with that file, one written with the build's twins.h, as a game that keeps the console's
// memory is, is checked as it is, and one that takes a struct as it is leaves the rest of its file checked.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { twinsHeader } from '../lib/c.mjs';
import { addressFinder, matchFile, twinsIn } from '../gba/match.mjs';
import { checkFile, ensureCaller, openOriginal } from '../gba/twin.mjs';
import { cartridge, compiler, FUNCTIONS, NAMED, VIA } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./twin/', import.meta.url));
const work = join(LOCAL, 'tmp', 'twin-test');
const CALLS = 400;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));
ensureCaller(console.log);

console.log('A program of the project\'s own, as a cartridge and as twins:');
const addressOf = addressFinder({ named: NAMED });
const first = await matchFile({
  file: join(HERE, 'program.c'), compiler, work: join(work, 'built', 'program'), addressOf: name => addressOf(name) ?? VIA[name] ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!first.error, `the program builds with ${compiler.name}${first.error ? `: ${first.error}` : ''}`);
if (first.error) process.exit(1);
const assembly = readFileSync(join(work, 'built', 'program.s'), 'utf8');
check(Object.keys(FUNCTIONS).every((name, i, names) => i === names.length - 1 || first.functions.find(f => f.name === name).length <= FUNCTIONS[names[i + 1]] - FUNCTIONS[name]), 'each function fits where the cartridge has it');
check(/strb/.test(assembly) && /_call_via_r/.test(assembly), 'it writes single bytes and calls through a pointer');
const copy = join(work, 'cartridge.gba');
writeFileSync(copy, cartridge(assembly));

const { original, start, stack } = await openOriginal(copy, 2);
check(stack >= 0x03007000 && stack < 0x03008000, `the original's functions are called on the game's own stack, at 0x0${stack.toString(16).toUpperCase()}`);
// the program as it is, or with one thing replaced, in a folder of its own
let variants = 0;
const program = (...replaced) => {
  if (!replaced.length) return join(HERE, 'program.c');
  const folder = join(work, `changed-${++variants}`);
  cpSync(HERE, folder, { recursive: true });
  let source = readFileSync(join(HERE, 'program.c'), 'utf8');
  for (const [from, to] of replaced) {
    if (!source.includes(from)) throw new Error(`The program has no "${from}" for the test to change.`);
    source = source.replace(from, to);
  }
  writeFileSync(join(folder, 'program.c'), source);
  return join(folder, 'program.c');
};
// how long the cartridge's functions are, as a game's code map says it
const lengths = new Map(first.functions.map(f => [FUNCTIONS[f.name], f.length]));
const sizeOf = address => lengths.get(address) ?? null;
const checking = async (file, options = {}, more = {}) => {
  const result = await checkFile({
    original, start, copy, file, addressOf, sizeOf, options: { calls: CALLS, seconds: 1, ...options }, ...more,
  });
  return { ...result, by: Object.fromEntries((result.functions ?? []).map(f => [f.name, f])) };
};
const sameBut = (result, names) => Object.keys(FUNCTIONS).every(name => names.includes(name) || result.by[name]?.kind === 'same');

try {
  const right = await checking(program());
  check(!right.error && !right.missing, `the twins build${right.error ? `: ${right.error}` : ''}`);
  for (const name of Object.keys(FUNCTIONS)) {
    check(right.by[name]?.kind === 'same' && right.by[name].compared === CALLS, `${name} leaves the same memory over ${CALLS} calls${right.by[name]?.kind === 'same' ? '' : `: ${right.by[name]?.line}`}`);
  }

  check(Object.keys(FUNCTIONS).every(name => right.by[name]?.whole === true), `and their calls took every path of the original's, which makes each a proof${Object.keys(FUNCTIONS).filter(name => right.by[name]?.whole !== true).map(name => `: ${name}, ${right.by[name]?.line}`).join('')}`);
  const still = await checking(program(), { changes: false });
  check(still.by.Fall?.kind === 'same' && still.by.Fall.whole === false && /left out/.test(still.by.Fall.line) && /never taken|always taken/.test(still.by.Fall.line),
    `calls that never take a branch of the original's leave the same memory and are no proof: ${still.by.Fall?.line}`);
  const unmapped = await checking(program(), {}, { sizeOf: () => null });
  check(unmapped.by.Step?.kind === 'same' && unmapped.by.Step.whole === false, 'and neither is a function the code map doesn\'t have');

  console.log('A twin with > turned to >=:');
  const spoiled = program(['if (y > FLOOR)', 'if (y >= FLOOR)']);
  const untouched = await checking(spoiled, { changes: false });
  check(untouched.by.Fall?.kind === 'same', 'isn\'t found while nothing the function reads is changed');
  const found = await checking(spoiled);
  check(found.by.Fall?.kind === 'differs' && /was set to/.test(found.by.Fall.line) && /at 0x0300010[0-7], in the work memory/.test(found.by.Fall.line), `is found once it is: ${found.by.Fall?.line}`);
  check(sameBut(found, ['Fall']), 'and every other twin is still the same');
  const again = await checking(spoiled);
  check(again.by.Fall?.line === found.by.Fall?.line, 'the same seed finds it at the same call');
  const other = await checking(spoiled, { seed: 7 });
  check(other.by.Fall?.kind === 'differs', 'and another seed finds it too');

  console.log('A byte written to video memory:');
  const plain = await checking(program(['VIDEO8(TILES + at, colour);', 'gba_vram[at] = colour;']));
  check(plain.by.Paint?.kind === 'differs' && /at 0x060000[0-9A-F]{2}, in the video memory/.test(plain.by.Paint.line), `a twin that writes one byte of a background tile differs, as the console writes two: ${plain.by.Paint?.line}`);
  const sprite = await checking(program(['VIDEO8(SPRITE_TILES + at, colour);', 'gba_vram[SPRITE_TILES - TILES + at] = colour;']));
  check(sprite.by.Paint?.kind === 'differs' && /at 0x060100[0-9A-F]{2}, in the video memory/.test(sprite.by.Paint.line), `and one that writes a sprite's tile differs, as the console drops it: ${sprite.by.Paint?.line}`);
  check(sameBut(plain, ['Paint']) && sameBut(sprite, ['Paint']), 'and every other twin is still the same');

  console.log('A function called through a pointer:');
  const stepped = await checking(program(['gFrame += 3;', 'gFrame += 4;']));
  check(stepped.by.Step?.kind === 'differs' && stepped.by.Run?.kind === 'differs', `a wrong twin reached only through a pointer is found from the function that calls it: ${stepped.by.Run?.line}`);
  const chosen = await checking(program(['which & 1 ? Step : Skip', 'which & 1 ? Skip : Step']));
  check(chosen.by.Choose?.kind === 'differs' && /at 0x0300004[0-3]/.test(chosen.by.Choose.line), `and a twin that keeps the address of the wrong function differs where the address is kept: ${chosen.by.Choose?.line}`);

  console.log('A twin over two files, and one written with the build\'s twins.h:');
  const split = program(['gFrame += 3;', 'gFrame += step_size() + kNothing;'], ['#include "program.h"', '#include "program.h"\nu32 step_size(void);\nextern const u32 kNothing;']);
  const beside = join(split, '..', 'more.c');
  writeFileSync(beside, '#include "program.h"\nconst u32 kNothing = 0;\n/** what Step moves the frame on by */\nu32 step_size(void) { return 3; }\n');
  const joined = await checking(split, {}, { files: [split, beside] });
  check(sameBut(joined, []), `a function and a value another file of the version defines are found by what that file built defines${joined.error ? `: ${joined.error}` : joined.missing ? `: no address for ${joined.missing}` : ''}`);
  const apart = await checking(split);
  check(apart.missing?.includes('kNothing'), 'and without that file the value has no address, which is said');
  const headers = join(work, 'twins');
  mkdirSync(headers, { recursive: true });
  writeFileSync(join(headers, 'twins.h'), twinsHeader(twinsIn(readFileSync(join(HERE, 'program.c'), 'utf8')), NAMED));
  const named = program(['#include "program.h"', '#include "program.h"\n#include "twins.h"'], ['which & 1 ? Step : Skip', 'which & 1 ? TWIN_ADDRESS(Step) : TWIN_ADDRESS(Skip)'], ['if (gHandler) gHandler();', 'if (gHandler) TWIN(gHandler)();']);
  const written = await checking(named, {}, { includes: [join(named, '..'), headers] });
  check(sameBut(written, []), `a twin that names functions by their addresses with twins.h, and calls through its table, leaves the same memory${written.error ? `: ${written.error}` : ''}`);

  console.log('A twin that never comes back:');
  const began = Date.now();
  const stuck = await checking(program(['return value * gSteps[kind & 3] + gFrame;', 'if (kind == 7) for (;;) gFrame++;\n  return value * gSteps[kind & 3] + gFrame;']));
  check(stuck.by.Scale?.kind === 'never' && /still going after 1 second/.test(stuck.by.Scale.line), `is stopped and said: ${stuck.by.Scale?.line}`);
  check(sameBut(stuck, ['Scale']) && Date.now() - began < 60000, 'and the others are still checked, in a thread started again');

  console.log('What can\'t be checked:');
  const alone = await checking(program(['VIDEO8(TILES + at, colour);', '{ void nothing_built(void); nothing_built(); }']));
  check(alone.by.Paint?.kind === 'unchecked' && /the twin calls nothing_built/.test(alone.by.Paint.line), `a twin that calls something nothing built defines isn't checked, and which is said: ${alone.by.Paint?.line}`);
  check(sameBut(alone, ['Paint']), 'and the others are');
  const one = await checking(program(), {}, { only: FUNCTIONS.Sum });
  check(one.functions?.length === 1 && one.by.Sum?.kind === 'same', 'one function can be checked by itself');
  const whole = await checking(program(['/** Run, 0x08000380', 'struct Pair { s32 a, b; };\n/** Take, 0x080003C0: one of a pair, given whole */\ns32 Take(struct Pair pair) { return pair.a; }\n\n/** Run, 0x08000380']));
  check(whole.by.Take?.kind === 'unchecked' && /can't read what it takes/.test(whole.by.Take.line) && sameBut(whole, []), `a twin that takes a struct as it is isn't called, and the rest of its file is checked${whole.error ? `: ${whole.error}` : ''}`);
  const nameless = await checking(program(), {}, { addressOf: name => (name === 'gFrame' ? null : addressOf(name)) });
  check(nameless.missing?.includes('gFrame'), 'a value with no address stops the file, and its name is said');
  const broken = await checking(program(['gFrame += 3;', 'gFrame += ;']));
  check(/program\.c:\d+/.test(broken.error ?? ''), `C that doesn't build says where: ${(broken.error ?? '').split('\n')[0]}`);
} finally {
  original.close();
}

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe function check says the same of what is the same, and finds what isn\'t.');
