// npm run test:twin: tries the function check (../twin.mjs) with a program of the project's own (twin/program.c), so
// it needs nobody's copy of any game. The console's own compiler builds the program into a made-up cartridge, each
// function at the address its comment names, and the reference emulator runs that as the original. The same C is the
// twins, built on the console's kit as a game's are. Then the check has to say every twin leaves the same memory, and
// has to find each twin the test spoils: a `>` turned to `>=`, found only because what the function reads is changed;
// a byte written to the kit's video memory as if it were plain memory, where the kit does what the hardware would; a
// function reached only through a pointer; a function that divides through the BIOS, followed there and back; a twin
// that never comes back, stopped and not hung; and a twin that calls
// something nothing built defines, which is said and not guessed at. A twin that names a function and a value of
// another file is linked with that file, one written with the build's twins.h, as a game that keeps the console's
// memory is, is checked as it is, and one that takes a struct as it is leaves the rest of its file checked.
//
// Then the cartridge is given a game to play (twin/play.c), and the check memories of that play (--memories): a
// function that reads what only play makes isn't checked from the memory of power-on and is from its own memories, a
// wrong twin of it is found, the same recording and seed give the same memories and the same calls, and nothing of
// the memories is in a file the repository tracks.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { twinsHeader } from '../lib/c.mjs';
import { addressFinder, matchFile, twinsIn } from '../gba/match.mjs';
import { checkFile, ensureCaller, givesBackUsed, openCaller, openOriginal } from '../gba/twin.mjs';
import { memoriesKey, openMemories, takeMemories } from '../gba/twin-memories.mjs';
import { AIMED, BIOS, cartridge, compiler, DIVIDES, FUNCTIONS, GIVES, NAMED, PLAYED, REGISTER, TURN, TURN_LENGTH, VIA, VIDEO, withAimed, withDivision, withGives, withPlay, withRegister, withTurn, withVideo } from './twin/cartridge.mjs';

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
// and the function that divides through the BIOS, from a file of its own
const divides = await matchFile({
  file: join(HERE, 'bios.c'), compiler, work: join(work, 'built', 'bios'), addressOf: name => addressOf(name) ?? BIOS[name] ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!divides.error && /bl\tDiv|bl Div/.test(readFileSync(join(work, 'built', 'bios.s'), 'utf8')), `the function that divides builds with ${compiler.name} and calls the cartridge's stub for the BIOS's division${divides.error ? `: ${divides.error}` : ''}`);
// and a function that gives back what its caller keeps, from a file of its own
const gives = await matchFile({
  file: join(HERE, 'gives.c'), compiler, work: join(work, 'built', 'gives'), addressOf: name => addressOf(name) ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!gives.error, `the function that gives back a value and its caller build with ${compiler.name}${gives.error ? `: ${gives.error}` : ''}`);
// and a function that reads video memory, from a file of its own
const looks = await matchFile({
  file: join(HERE, 'video.c'), compiler, work: join(work, 'built', 'video'), addressOf: name => addressOf(name) ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!looks.error, `the function that reads video memory builds with ${compiler.name}${looks.error ? `: ${looks.error}` : ''}`);
// and a function that changes a register of the hardware, from a file of its own
const shifts = await matchFile({
  file: join(HERE, 'register.c'), compiler, work: join(work, 'built', 'register'), addressOf: name => addressOf(name) ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!shifts.error, `the function that changes a register builds with ${compiler.name}${shifts.error ? `: ${shifts.error}` : ''}`);
// and a function with a branch made-up calls almost never take, from a file of its own
const rare = await matchFile({
  file: join(HERE, 'aim.c'), compiler, work: join(work, 'built', 'aim'), addressOf: name => addressOf(name) ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!rare.error, `the function with a rare branch builds with ${compiler.name}${rare.error ? `: ${rare.error}` : ''}`);
const copy = join(work, 'cartridge.gba');
writeFileSync(copy, withTurn(withAimed(withRegister(withVideo(withGives(withDivision(cartridge(assembly), readFileSync(join(work, 'built', 'bios.s'), 'utf8')), readFileSync(join(work, 'built', 'gives.s'), 'utf8')), readFileSync(join(work, 'built', 'video.s'), 'utf8')), readFileSync(join(work, 'built', 'register.s'), 'utf8')), readFileSync(join(work, 'built', 'aim.s'), 'utf8'))));

// what git says has changed in the repository, to see that nothing the check keeps is among it
const changed = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' });
const before = changed();

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
const lengths = new Map([...rare.functions.filter(f => AIMED[f.name]).map(f => [AIMED[f.name], f.length]), ...first.functions.map(f => [FUNCTIONS[f.name], f.length]), ...divides.functions.filter(f => DIVIDES[f.name]).map(f => [DIVIDES[f.name], f.length]), ...gives.functions.filter(f => GIVES[f.name]).map(f => [GIVES[f.name], f.length]), ...looks.functions.filter(f => VIDEO[f.name]).map(f => [VIDEO[f.name], f.length]), ...shifts.functions.filter(f => REGISTER[f.name]).map(f => [REGISTER[f.name], f.length])]);
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
  check(found.by.Fall?.kind === 'differs' && /at 0x0300010[0-7], in the work memory/.test(found.by.Fall.line), `is found once it is: ${found.by.Fall?.line}`);
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

  console.log('A register of the hardware, changed:');
  const shifted = await checking(join(HERE, 'register.c'));
  check(shifted.by.Shift?.kind === 'same' && shifted.by.Shift.compared === CALLS, `each call of the twin starts from the hardware the original's does, as the kit's registers are put back${shifted.by.Shift?.kind === 'same' ? '' : `: ${shifted.by.Shift?.line ?? shifted.error}`}`);
  check(shifted.by.Bias?.kind === 'same' && shifted.by.Bias.compared === CALLS, `a twin that keeps the console's registers itself, in console_io, starts each call from the original's${shifted.by.Bias?.kind === 'same' ? '' : `: ${shifted.by.Bias?.line ?? shifted.error}`}`);
  check(shifted.by.Await?.kind === 'unchecked' && /a DMA the console's clock started wrote memory/.test(shifted.by.Await.line), `and a call in which a DMA the V-blank started writes memory is set aside, as a twin has no clock: ${shifted.by.Await?.line ?? shifted.error}`);

  console.log('A word read where none starts, in ARM code:');
  const arm = { isArm: address => address === TURN.Turn, sizeOf: address => (address === TURN.Turn ? TURN_LENGTH : sizeOf(address)) };
  const turned = await checking(join(HERE, 'turn.c'), {}, arm);
  check(turned.by.Turn?.kind === 'same' && turned.by.Turn.compared === CALLS && turned.by.Turn.whole === true, `a twin that says dp:unaligned, and turns the word as the processor does, has every call compared, and leaves the same memory${turned.by.Turn?.kind === 'same' ? '' : `: ${turned.by.Turn?.line ?? turned.error}`}`);
  const plainRead = join(work, `changed-${++variants}`);
  cpSync(HERE, plainRead, { recursive: true });
  writeFileSync(join(plainRead, 'turn.c'), readFileSync(join(HERE, 'turn.c'), 'utf8').replace('u32 word = *(volatile u32 *)0x03000020;\n  *(volatile u32 *)0x03000024 = word >> 16 | word << 16;', '*(volatile u32 *)0x03000024 = *(volatile u32 *)0x03000022;'));
  const misread = await checking(join(plainRead, 'turn.c'), {}, arm);
  check(misread.by.Turn?.kind === 'differs', `one that reads it as C would differs: ${misread.by.Turn?.line ?? misread.error}`);
  const unmarked = join(work, `changed-${++variants}`);
  cpSync(HERE, unmarked, { recursive: true });
  writeFileSync(join(unmarked, 'turn.c'), readFileSync(join(HERE, 'turn.c'), 'utf8').replace(', dp:unaligned:', ':'));
  const aside = await checking(join(unmarked, 'turn.c'), {}, arm);
  check(aside.by.Turn?.kind !== 'same' && /where a twin can't follow/.test(aside.by.Turn?.line ?? ''), `and without the mark its calls are set aside, as before: ${aside.by.Turn?.line ?? aside.error}`);

  console.log('A byte read from video memory:');
  const looked = await checking(join(HERE, 'video.c'));
  check(looked.by.Look?.kind === 'same' && looked.by.Look.compared === CALLS, `a twin that reads it where the kit keeps it is the same over every call, with the byte changed for some of them${looked.by.Look?.kind === 'same' ? '' : `: ${looked.by.Look?.line ?? looked.error}`}`);

  console.log('A function that divides through the BIOS:');
  const divided = await checking(join(HERE, 'bios.c'));
  check(divided.by.Share?.kind === 'same' && divided.by.Share.compared === CALLS && divided.by.Share.whole === true, `the original is followed into the BIOS and back, and its twin, which divides itself, leaves the same memory over every call${divided.by.Share?.kind === 'same' ? '' : `: ${divided.by.Share?.line ?? divided.error}`}`);
  const shared = join(work, `changed-${++variants}`);
  cpSync(HERE, shared, { recursive: true });
  writeFileSync(join(shared, 'bios.c'), readFileSync(join(HERE, 'bios.c'), 'utf8').replace('gFrame = Div(total, gSteps[kind & 3]);', 'gFrame = Div(total, gSteps[kind & 3]) + 1;'));
  const halved = await checking(join(shared, 'bios.c'));
  check(halved.by.Share?.kind === 'differs' && /at 0x0300002[0-3], in the work memory/.test(halved.by.Share.line), `and a wrong twin of it is found: ${halved.by.Share?.line ?? halved.error}`);

  console.log('A twin that gives back nothing:');
  // which of the cartridge's functions give back what a caller uses, read from the callers' instructions
  const givesBack = givesBackUsed(readFileSync(copy), [...lengths].map(([address, size]) => ({ address, size })));
  check(givesBack(GIVES.Count) !== null && givesBack(FUNCTIONS.Step) === null && givesBack(GIVES.Keep) === null, 'the callers\' instructions say Count gives back what its caller uses, and nothing is said of a function nothing uses the value of');
  const counted = await checking(join(HERE, 'gives.c'), {}, { givesBack });
  check(counted.by.Count?.kind === 'same' && counted.by.Keep?.kind === 'same', `a twin that gives back what the original does is the same${counted.by.Count?.kind === 'same' ? '' : `: ${counted.by.Count?.line ?? counted.error}`}`);
  const silent = join(work, `changed-${++variants}`);
  cpSync(HERE, silent, { recursive: true });
  writeFileSync(join(silent, 'gives.c'), readFileSync(join(HERE, 'gives.c'), 'utf8')
    .replace('u32 Count(void) {\n  return ++gFrame;', 'void Count(void) {\n  ++gFrame;')
    .replace('gBall.hits = Count();', 'Count();\n  gBall.hits = gFrame;'));
  const unchecked = await checking(join(silent, 'gives.c'));
  check(unchecked.by.Count?.kind === 'same', 'a twin that gives back nothing leaves the same memory, which alone would pass it, as it passed 0x08011DBC of the pilot');
  const caught = await checking(join(silent, 'gives.c'), {}, { givesBack });
  check(caught.by.Count?.kind === 'differs' && /gives back nothing/.test(caught.by.Count.line) && new RegExp(`0x0${(GIVES.Keep).toString(16).toUpperCase().slice(0, 5)}`).test(caught.by.Count.line), `and it differs once the check reads what its caller does with r0: ${caught.by.Count?.line ?? caught.error}`);

  console.log('A branch made-up calls almost never take:');
  const unaimed = await checking(join(HERE, 'aim.c'), { aim: false });
  check(unaimed.by.Unlock?.kind === 'same' && unaimed.by.Unlock.whole === false && /left out/.test(unaimed.by.Unlock.line), `without aiming, the calls leave it out and it isn't proven: ${unaimed.by.Unlock?.line ?? unaimed.error}`);
  const aimedAt = await checking(join(HERE, 'aim.c'));
  check(aimedAt.by.Unlock?.kind === 'same' && aimedAt.by.Unlock.whole === true && /aimed at a branch way/.test(aimedAt.by.Unlock.line), `aimed at, its calls take it and every path, and it's proven: ${aimedAt.by.Unlock?.line ?? aimedAt.error}`);
  const nearly = join(work, `changed-${++variants}`);
  cpSync(HERE, nearly, { recursive: true });
  writeFileSync(join(nearly, 'aim.c'), readFileSync(join(HERE, 'aim.c'), 'utf8').replace('gBall.hits = 99;', 'gBall.hits = 98;'));
  const missed = await checking(join(nearly, 'aim.c'), { aim: false });
  check(missed.by.Unlock?.kind === 'same', `a twin wrong on that branch alone isn't found without aiming: ${missed.by.Unlock?.line ?? missed.error}`);
  const hit = await checking(join(nearly, 'aim.c'));
  check(hit.by.Unlock?.kind === 'differs' && /at 0x0300010[67], in the work memory/.test(hit.by.Unlock.line), `and is found by an aimed call: ${hit.by.Unlock?.line ?? hit.error}`);

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

console.log('Memories of play:');
// the same program with a game to play: twin/play.c beside it, built the same way, and a start that runs it
const play = await matchFile({
  file: join(HERE, 'play.c'), compiler, work: join(work, 'built', 'play'), addressOf: name => addressOf(name) ?? null,
  sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
});
check(!play.error, `the part of the program that only play reaches builds with ${compiler.name}${play.error ? `: ${play.error}` : ''}`);
if (play.error) process.exit(1);
const played = join(work, 'played.gba');
writeFileSync(played, withPlay(readFileSync(copy), readFileSync(join(work, 'built', 'play.s'), 'utf8')));
// 150 frames of someone's play, a bit for each button held: nothing, then A, which makes the stage, then B for a while
const held = frame => (frame >= 20 && frame < 30 ? 1 : 0) | (frame >= 60 && frame < 90 ? 2 : 0);
const plays = [{ name: 'made-up-play', buttons: Array.from({ length: 150 }, (_, frame) => held(frame)), sets: [] }];
const addresses = [...Object.values(FUNCTIONS), PLAYED.Shine, PLAYED.Glow];
const taking = async name => {
  const folder = join(work, name);
  const taken = await takeMemories({ open: () => openCaller(played), addresses, plays, folder, key: memoriesKey({ sha1: 'made up', addresses, plays }) });
  return { folder, taken, memories: openMemories(folder) };
};
const kept = await taking('memories');
const own = kept.memories.of(PLAYED.Shine);
check(kept.taken.functions === 2 && own.length >= 2 && own.length <= 4 && kept.memories.of(PLAYED.Glow).length >= 2, `the play gives Shine ${own.length} memories of its own, Glow some too, and the functions it never ran none`);
check(own.every(memory => memory.frame >= 20 && memory.image().readUInt32LE(0x40060) === 0x02000400 && [1, 7].includes(memory.arg(0))), 'each from a frame after the stage was made, with the stage in it and what Shine was given');

// how long Shine is in the cartridge, as a game's code map says it, so the check can say which of its paths ran
const shineLength = play.functions.find(f => f.name === 'Shine').length, glowLength = play.functions.find(f => f.name === 'Glow').length;
const second = await openOriginal(played, 2);
const shining = async (file, options = {}, memories = null) => {
  const result = await checkFile({ original: second.original, start: second.start, copy: played, file, addressOf, memories, sizeOf: address => (address === PLAYED.Shine ? shineLength : address === PLAYED.Glow ? glowLength : null), options: { calls: CALLS, seconds: 1, ...options } });
  return { ...result, by: Object.fromEntries((result.functions ?? []).map(f => [f.name, f])) };
};
// play.c as it is, or with one thing replaced, in a folder of its own
const playFile = (...replaced) => {
  if (!replaced.length) return join(HERE, 'play.c');
  const folder = join(work, `changed-${++variants}`);
  cpSync(HERE, folder, { recursive: true });
  let source = readFileSync(join(HERE, 'play.c'), 'utf8');
  for (const [from, to] of replaced) {
    if (!source.includes(from)) throw new Error(`The program has no "${from}" for the test to change.`);
    source = source.replace(from, to);
  }
  writeFileSync(join(folder, 'play.c'), source);
  return join(folder, 'play.c');
};
try {
  const cold = await shining(playFile());
  check(cold.by.Shine?.kind === 'unchecked' && /the original left for 0x0000000[0-9A-F], where a twin can't follow/.test(cold.by.Shine.line), `from the memory of power-on, a function that reads what only play makes isn't checked: ${cold.by.Shine?.line ?? cold.error}`);
  const warm = await shining(playFile(), {}, kept.memories);
  check(warm.by.Shine?.kind === 'same' && warm.by.Shine.compared === CALLS, `from its memories of play it leaves the same memory over ${CALLS} calls${warm.by.Shine?.kind === 'same' ? '' : `: ${warm.by.Shine?.line ?? warm.error}`}`);
  check(warm.by.Shine?.whole === true && /took every path of the original's/.test(warm.by.Shine.line), `and those calls took every path of the original's, which a proof by the same memory asks from memories of play too: ${warm.by.Shine?.line}`);
  // Glow runs code play put in the fast work memory, which loads a constant from beside itself: that's the code's, and
  // the check never changes it, as it would a value the function read (#1518)
  check(warm.by.Glow?.kind === 'same' && warm.by.Glow.compared === CALLS, `a function that runs code in the work memory leaves the same memory over ${CALLS} calls, the constant that code keeps beside itself left as it is${warm.by.Glow?.kind === 'same' ? '' : `: ${warm.by.Glow?.line ?? warm.error}`}`);
  const one = await shining(playFile(), { calls: 1 }, kept.memories);
  check(one.by.Shine?.kind === 'same' && one.by.Shine.whole === false && /left out/.test(one.by.Shine.line), `and a single call from a memory of play, which can't take a branch both ways, is the same and no proof: ${one.by.Shine?.line}`);
  const others = await checkFile({ original: second.original, start: second.start, copy: played, file: program(), addressOf, memories: kept.memories, options: { calls: CALLS, seconds: 1 } });
  check(Object.keys(FUNCTIONS).every(name => others.functions?.find(f => f.name === name)?.kind === 'same'), 'and the functions play never ran are still the same, from power-on memory and from another function\'s');

  const wrong = playFile(['if (light > FULL)', 'if (light >= FULL)']);
  const missed = await shining(wrong);
  check(missed.by.Shine?.kind === 'unchecked', 'a wrong twin of it isn\'t found from the memory of power-on, where nothing of it runs');
  const caught = await shining(wrong, {}, kept.memories);
  check(caught.by.Shine?.kind === 'differs' && /from the memory of made-up-play at frame \d+/.test(caught.by.Shine.line) && /at 0x0200044[0-3], in the work memory/.test(caught.by.Shine.line), `and is from a memory of play: ${caught.by.Shine?.line ?? caught.error}`);

  const retaken = await taking('memories-again');
  const same = name => readFileSync(join(kept.folder, name)).equals(readFileSync(join(retaken.folder, name)));
  check(same('memories.bin') && same('memories.json'), 'the same recording gives the same memories again');
  const recaught = await shining(wrong, {}, retaken.memories);
  check(recaught.by.Shine?.line === caught.by.Shine?.line, 'and the same seed the same calls, so the difference is found at the same one');
  const elsewhere = await shining(wrong, { seed: 7 }, kept.memories);
  check(elsewhere.by.Shine?.kind === 'differs', 'and another seed finds it too');

  const began = Date.now();
  const stuck = await shining(playFile(['lamp->light = light;', 'if (by == 7) for (;;) lamp->lit++;\n  lamp->light = light;']), {}, kept.memories);
  check(stuck.by.Shine?.kind === 'never' && /still going after 1 second/.test(stuck.by.Shine.line) && Date.now() - began < 60000, `a twin that never comes back from a memory of play is stopped and said: ${stuck.by.Shine?.line ?? stuck.error}`);

  const inside = relative(REPO, kept.folder);
  const ignored = execFileSync('git', ['check-ignore', inside], { cwd: REPO, encoding: 'utf8' }).trim() === inside;
  check(!inside.startsWith('..') && inside.startsWith('.dreamports') && ignored && changed() === before, `the memories are in ${inside.split('\\').join('/')}/, which git leaves out, and nothing the repository tracks has changed`);
} finally {
  second.original.close();
}

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nThe function check says the same of what is the same, and finds what isn\'t.');
