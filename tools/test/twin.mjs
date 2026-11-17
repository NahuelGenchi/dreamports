// npm run test:twin: tries the function check (../twin.mjs) with a program of the project's own (twin/program.c), so
// it needs nobody's copy of any game. The console's own compiler builds the program into a made-up cartridge, each
// function at the address its comment names, and the reference emulator runs that as the original. The same C is the
// twins. Then the check has to say every twin leaves the same memory, and has to find each twin the test spoils: a
// `>` turned to `>=`, found only because what the function reads is changed; a byte written to video memory as if it
// were plain memory; a function reached only through a pointer; a twin that never comes back, stopped and not hung;
// and a twin that calls something nothing built defines, which is said and not guessed at.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { assemble } from '../gba/thumb.mjs';
import { addressFinder, matchFile } from '../gba/match.mjs';
import { checkFile, ensureCaller, openOriginal } from '../gba/twin.mjs';
import { madeUpGame } from './made-up-game.mjs';

const HERE = fileURLToPath(new URL('./twin/', import.meta.url));
const work = join(LOCAL, 'tmp', 'twin-test');
const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
const CARTRIDGE = 0x08000000;
// where the made-up cartridge has each function, as the program's comments say, and each value the program names
const FUNCTIONS = { Fall: 0x08000200, Scale: 0x08000240, Sum: 0x08000280, Paint: 0x080002C0, Step: 0x08000300, Skip: 0x08000320, Choose: 0x08000340, Run: 0x08000380 };
const NAMED = new Map([['gBall', 0x03000100], ['gFrame', 0x03000020], ['gHandler', 0x03000040], ['gSteps', 0x08000600]]);
// what the compiler calls to call through a pointer: one instruction each, which the test puts in the cartridge itself
const VIA = { _call_via_r0: 0x08000500, _call_via_r1: 0x08000504, _call_via_r2: 0x08000508, _call_via_r3: 0x0800050C };
const STEPS = [1, 2, 5, 9];
const CALLS = 400;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

// The made-up cartridge, from the assembly the compiler wrote: a header and a loop that does nothing, each function's
// bytes where FUNCTIONS says, with each place the assembler left filled in, and the few bytes the program doesn't define.
function cartridge(assembly) {
  const { sections, symbols, relocations } = assemble(assembly);
  const text = Buffer.from(sections['.text'].bytes), { rom } = madeUpGame({ size: 0x1000 });
  const all = [...symbols].filter(([, symbol]) => symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
  all.forEach((f, i) => { f.until = all[i + 1]?.at ?? text.length; });
  const around = at => all.find(f => at >= f.at && at < f.until);
  const moved = at => { const f = around(at); return FUNCTIONS[f.name] + at - f.at; };
  for (const { at, kind, name, addend } of relocations) {
    const symbol = symbols.get(name);
    const target = symbol?.section === '.text' ? moved(symbol.at) + addend + (symbol.function ? 1 : 0) : (NAMED.get(name) ?? VIA[name]) + addend;
    if (kind === 'word') text.writeUInt32LE(target, at);
    else {
      const jump = (target & ~1) - (moved(at) + 4);
      text.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
      text.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
    }
  }
  for (const f of all) text.copy(rom, FUNCTIONS[f.name] - CARTRIDGE, f.at, f.until);
  // bx r0 to bx r3
  Object.values(VIA).forEach((address, register) => rom.writeUInt16LE(0x4700 | register << 3, address - CARTRIDGE));
  Buffer.from(STEPS).copy(rom, NAMED.get('gSteps') - CARTRIDGE);
  return rom;
}

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
const program = (replace = null) => {
  if (!replace) return join(HERE, 'program.c');
  const folder = join(work, `changed-${++variants}`);
  cpSync(HERE, folder, { recursive: true });
  const source = readFileSync(join(HERE, 'program.c'), 'utf8');
  if (!source.includes(replace[0])) throw new Error(`The program has no "${replace[0]}" for the test to change.`);
  writeFileSync(join(folder, 'program.c'), source.replace(replace[0], replace[1]));
  return join(folder, 'program.c');
};
const checking = async (file, options = {}, more = {}) => {
  const result = await checkFile({
    original, start, copy, file, addressOf, options: { calls: CALLS, seconds: 1, ...options },
    definedIn: name => (name === 'video_put8' ? join(file, '..', 'console.c') : null), ...more,
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
  const plain = await checking(program(['VIDEO8(TILES + at, colour);', '*(u8 *)(TILES + at) = colour;']));
  check(plain.by.Paint?.kind === 'differs' && /at 0x060000[0-9A-F]{2}, in the video memory/.test(plain.by.Paint.line), `a twin that writes one byte of a background tile differs, as the console writes two: ${plain.by.Paint?.line}`);
  const sprite = await checking(program(['VIDEO8(SPRITE_TILES + at, colour);', '*(u8 *)(SPRITE_TILES + at) = colour;']));
  check(sprite.by.Paint?.kind === 'differs' && /at 0x060100[0-9A-F]{2}, in the video memory/.test(sprite.by.Paint.line), `and one that writes a sprite's tile differs, as the console drops it: ${sprite.by.Paint?.line}`);
  check(sameBut(plain, ['Paint']) && sameBut(sprite, ['Paint']), 'and every other twin is still the same');

  console.log('A function called through a pointer:');
  const stepped = await checking(program(['gFrame += 3;', 'gFrame += 4;']));
  check(stepped.by.Step?.kind === 'differs' && stepped.by.Run?.kind === 'differs', `a wrong twin reached only through a pointer is found from the function that calls it: ${stepped.by.Run?.line}`);
  const chosen = await checking(program(['which & 1 ? Step : Skip', 'which & 1 ? Skip : Step']));
  check(chosen.by.Choose?.kind === 'differs' && /at 0x0300004[0-3]/.test(chosen.by.Choose.line), `and a twin that keeps the address of the wrong function differs where the address is kept: ${chosen.by.Choose?.line}`);

  console.log('A twin that never comes back:');
  const began = Date.now();
  const stuck = await checking(program(['return value * gSteps[kind & 3] + gFrame;', 'if (kind == 7) for (;;) gFrame++;\n  return value * gSteps[kind & 3] + gFrame;']));
  check(stuck.by.Scale?.kind === 'never' && /still going after 1 second/.test(stuck.by.Scale.line), `is stopped and said: ${stuck.by.Scale?.line}`);
  check(sameBut(stuck, ['Scale']) && Date.now() - began < 60000, 'and the others are still checked, in a thread started again');

  console.log('What can\'t be checked:');
  const alone = await checking(program(), {}, { definedIn: () => null });
  check(alone.by.Paint?.kind === 'unchecked' && /the twin calls video_put8/.test(alone.by.Paint.line), `a twin that calls something nothing built defines isn't checked, and which is said: ${alone.by.Paint?.line}`);
  check(sameBut(alone, ['Paint']), 'and the others are');
  const one = await checking(program(), {}, { only: FUNCTIONS.Sum });
  check(one.functions?.length === 1 && one.by.Sum?.kind === 'same', 'one function can be checked by itself');
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
