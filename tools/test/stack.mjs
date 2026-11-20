// npm run test:stack: the console's stack in a Dreamport (kit/gba/c/stack.c, ../gba/stack.mjs), measured against the
// reference emulator with a program of the project's own (stack/leftovers.c), so it needs nobody's copy of any game.
// The console's own compiler builds the program into a made-up cartridge, each function at the address its comment
// names, and mGBA runs it. In it, Keep keeps gKept's address in a register across its call of Push, which saves that
// register on the stack with its return address, and Read then hands Copy a struct it set one word of, where those
// were left. The same C, built for a Dreamport with the stack's calls added from the compiler's own assembly, has to
// copy the same words and leave the stack the same, and without them it has to copy others.
//
// The rest of the program has what the arithmetic of a register can't say, each a rule of the stack's own
// (../gba/stack.mjs): a call through a pointer (Through), a pointer into memory the Dreamport keeps elsewhere (Far), a
// register that holds a local worked out from memory (Local), a function proven only at its start (Pass, under
// Wrap), and a routine the cartridge has in assembly, whose twin is C (Hand, from stack/routines.s, as a library's
// table keeps one). With each rule the stack is mGBA's, and without it it isn't.
//
// And the function check (../gba/twin.mjs) builds the same copy for a call of Again, which does what Main's first two
// calls do in one call: the same memory as the original's with the copy, and not without it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { WASM_FLAGS, buildWasm } from '../lib/c.mjs';
import { compileFile } from '../gba/match.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { ensureOriginal, runOriginal } from '../gba/original.mjs';
import { memorySpec } from '../lib/memory.mjs';
import { stackOfFile, syntaxOf, withStack } from '../gba/stack.mjs';
import { routineMap } from '../gba/stack-map.mjs';
import { checkFile, ensureCaller, openBuild, openOriginal } from '../gba/twin.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { CARTRIDGE, VIA, place } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./stack/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'stack-test');
const PROGRAM = join(HERE, 'leftovers.c'), ROUTINES = join(HERE, 'routines.s');
const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
const FUNCTIONS = { Keep: 0x08000200, Push: 0x08000240, Inner: 0x08000280, Read: 0x080002C0, Copy: 0x08000300, Main: 0x08000740, Deep: 0x08000380, Through: 0x080003C0, Far: 0x08000400, Local: 0x08000440, Pass: 0x08000480, Wrap: 0x080004C0, Take: 0x08000600, Look: 0x08000640, Hand: 0x08000700, Again: 0x08000800 };
// those the cartridge has as the console's compiler builds the C, all but the routine in assembly
const COMPILED = new Set(Object.keys(FUNCTIONS).filter(name => name !== 'Hand'));
const NAMED = new Map([['gKept', 0x03000100], ['gOther', 0x03000104], ['gInner', 0x03000108], ['gDone', 0x0300010C], ['gOut', 0x03000110],
  ['gMore', 0x03000120], ['gFirst', 0x03000124], ['gSecond', 0x03000128], ['gThrough', 0x0300012C], ['gSeen', 0x03000130], ['gSeed', 0x03000134], ['gLocal', 0x03000138], ['gPass', 0x0300013C], ['gWrap', 0x03000140], ['gHanded', 0x03000144],
  ['gThroughLeft', 0x03000180], ['gFarLeft', 0x03000198], ['gLocalLeft', 0x030001B0], ['gPassLeft', 0x030001C8], ['gHandLeft', 0x030001E0],
  ['gFar', 0x0E000000]]);
// where the Dreamport keeps what the console has at gFar, and the console's address of a pointer into it
const FAR_HERE = 0x03000400, FAR_BYTES = 0x100;
// the start, in ARM at 0x080000C0: ldr r0, =Main + 1; mov lr, pc; bx r0; and then b . at 0x080000CC, where Main
// comes back to
const START = [0xE59F0008, 0xE1A0E00F, 0xE12FFF10, 0xEAFFFFFE, FUNCTIONS.Main + 1], BACK = 0x080000CC;
// what's compared: the program's values, and the stack under Main's own frame, whose first push is the start's r4,
// which no C gives
const VALUES = { address: 0x03000100, bytes: 0x100 }, STACK = { address: 0x03007E00, bytes: 0xF4 };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failed++;
};
const words = (bytes, from, count) => Array.from({ length: count }, (_, i) => bytes.readUInt32LE(from + 4 * i));
const hex = n => `0x${n.toString(16).toUpperCase()}`;

if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));
ensureOriginal(console.log);
mkdirSync(WORK, { recursive: true });

console.log('The console\'s stack in a Dreamport, beside the reference emulator, on a made-up program:');

// the cartridge, as the console's compiler builds the program
const built = await compileFile({ file: PROGRAM, compiler, work: join(WORK, 'leftovers') });
if (built.error) throw new Error(built.error);
const { rom } = madeUpGame({ size: 0x80000 });
START.forEach((word, i) => rom.writeUInt32LE(word, 0xC0 + 4 * i));
place(rom, built.assembly, FUNCTIONS, NAMED);
// Hand as the routine in assembly, over what the compiler made of its twin
const routines = readFileSync(ROUTINES, 'utf8');
place(rom, routines, { Hand: FUNCTIONS.Hand }, new Map(Object.entries(FUNCTIONS).map(([name, address]) => [name, address + 1])));
// what the compiler calls to call through a pointer: bx r0 to bx r3
Object.values(VIA).forEach((address, register) => rom.writeUInt16LE(0x4700 | register << 3, address - CARTRIDGE));
const cartridge = join(WORK, 'cartridge.gba');
writeFileSync(cartridge, rom);
const ran = await runOriginal({ copy: cartridge, frames: 3, buttons: [0, 0, 0], memory: { spec: memorySpec([VALUES, STACK], 2) } });
const theirs = Buffer.from(ran.memory.bytes);
const theirOut = words(theirs, 0x10, 4), theirStack = theirs.subarray(VALUES.bytes);
check(theirOut[0] === 5 && theirOut[1] === NAMED.get('gKept'), `in mGBA, Copy finds what Push saved: ${theirOut.map(hex).join(', ')}`);

// the same C for a Dreamport: with the stack's calls, from the compiler's own assembly, and without them
const map = await stackOfFile({ file: PROGRAM, root: HERE, includes: [HERE], compiler, work: join(WORK, 'leftovers-g') });
if (map.error) throw new Error(map.error);
const keep = map.functions.Keep?.calls.find(c => c.callee === 'Push'), read = map.functions.Read;
check(keep?.regs?.r4?.symbol === 'gKept', `the compiler's assembly says Keep holds gKept's address in r4 at its call of Push: ${JSON.stringify(keep?.regs)}`);
check(JSON.stringify(map.functions.Push?.pushes) === JSON.stringify([{ reg: 'r4', slot: -8 }, { reg: 'lr', slot: -4 }]), 'and Push saves r4 and its return address');
check(read?.locals.some(l => l.name === 'box' && l.fbreg === 0 && l.bytes === 16) && read.frame === 16, 'and Read keeps its box at its frame\'s start, 16 bytes');
const kit = [join(REPO, 'kit', 'c'), join(REPO, 'kit', 'gba', 'c')];
const inRepo = path => relative(REPO, path).split('\\').join('/');
const args = [...WASM_FLAGS, '-std=c11', '-O2', '-funsigned-char', ...kit.flatMap(folder => ['-I', inRepo(folder)])];
const text = readFileSync(PROGRAM, 'utf8');
const files = { tools: { test: { stack: { 'leftovers.c': Buffer.from(text) } } }, kit: { c: {}, gba: { c: { 'stack.h': readFileSync(join(REPO, 'kit', 'gba', 'c', 'stack.h')) } } } };
const tree = await syntaxOf(PROGRAM, REPO, args, files);
const addressOf = name => (FUNCTIONS[name] ? FUNCTIONS[name] + 1 : null);
const table = routineMap(routines).routines;
const stacked_ = async (options = {}) => withStack({ file: inRepo(PROGRAM), text, tree: await syntaxOf(PROGRAM, REPO, args, files), map, matched: COMPILED, addressOf, routines: table, ...options });
const made = await stacked_();
check(made.gaps.length === 0, `the program's stack has no gaps${made.gaps.length ? `: ${made.gaps.join('; ')}` : ''}`);
const stacked = join(WORK, 'stacked.c'), plain = join(WORK, 'plain.c'), run = join(WORK, 'run.c');
writeFileSync(stacked, `${made.header}\n${made.text}`);
writeFileSync(plain, text);
// the start as the cartridge's: the stack where mGBA's start leaves it, and Main called from the ARM start
// with the module's memory reaching the fast work memory, where the console keeps both
writeFileSync(run, `#include "stack.h"\nvoid Main(void);\nstatic uint32_t far(uint32_t pointer) { return pointer - ${hex(FAR_HERE)}u < ${hex(FAR_BYTES)}u ? ${hex(NAMED.get('gFar'))}u + (pointer - ${hex(FAR_HERE)}u) : pointer; }\n__attribute__((export_name("run"))) void run(void) {\n  unsigned have = __builtin_wasm_memory_size(0), need = (0x03008000u + 65535) / 65536;\n  if (have < need) __builtin_wasm_memory_grow(0, need - have);\n  gba_stack_addresses(far);\n  gba_stack_start(0x03007F00u);\n  gba_stack_call(${hex(BACK)}u);\n  Main();\n}\n`);
const dreamport = async (program, name) => {
  const out = join(WORK, `${name}.wasm`);
  await buildWasm([program, run, join(REPO, 'kit', 'gba', 'c', 'stack.c'), join(REPO, 'kit', 'c', 'libc.c')], out, { folders: kit, flags: ['-funsigned-char', '-Wl,--export-table'], addressOf: n => (n === 'gFar' ? FAR_HERE : NAMED.get(n) ?? null) });
  const imports = { env: new Proxy({}, { get: (_, n) => () => { throw new Error(`called ${String(n)}`); } }) };
  const { instance } = await WebAssembly.instantiate(readFileSync(out), imports);
  instance.exports.run();
  const memory = Buffer.from(instance.exports.memory.buffer);
  return { out: words(memory, NAMED.get('gOut'), 4), left: name_ => words(memory, NAMED.get(name_), 6), stack: memory.subarray(STACK.address, STACK.address + STACK.bytes) };
};
const mine = await dreamport(stacked, 'stacked'), without = await dreamport(plain, 'plain');
// with Push not proven by the same bytes: its frame still takes its room, so Keep's saved register is where Copy
// finds it, and Push's own two pushes are left out, and listed
const unproven = withStack({ file: inRepo(PROGRAM), text, tree: await syntaxOf(PROGRAM, REPO, args, files), map, matched: new Set([...COMPILED].filter(name => name !== 'Push')), addressOf, routines: table });
const partly = join(WORK, 'partly.c');
writeFileSync(partly, `${unproven.header}\n${unproven.text}`);
const part = await dreamport(partly, 'partly');
check(mine.out.every((w, i) => w === theirOut[i]), `with the stack, Copy copies the same words: ${mine.out.map(hex).join(', ')}`);
const differs = stack => [...stack].map((b, i) => (b !== theirStack[i] ? i : -1)).filter(i => i >= 0);
const differing = differs(mine.stack).length;
check(differing === 0, `and the stack under Main's frame is the same, byte for byte: ${STACK.bytes - differing} of ${STACK.bytes}`);
check(!without.out.every((w, i) => w === theirOut[i]), `without it, Copy copies other words: ${without.out.map(hex).join(', ')}`);
check(part.out[0] === theirOut[0] && part.out[1] === 0 && part.out[2] === 0 && part.out[3] === theirOut[3], `with Push not proven by its bytes, its frame keeps its room, so Copy still finds what Keep saved, and Push's own pushes are left out: ${part.out.map(hex).join(', ')}`);
check(unproven.gaps.some(gap => gap.startsWith('Push: not proven by the same bytes')), `and that's listed: ${unproven.gaps.join('; ')}`);

// each rule alone: without it the stack isn't mGBA's
const built_ = async (name, options) => {
  const one = await stacked_(options), path = join(WORK, `${name}.c`);
  writeFileSync(path, `${one.header}\n${one.text}`);
  return { ...(await dreamport(path, name)), gaps: one.gaps };
};
const theirLeft = name => words(theirs, NAMED.get(name) - VALUES.address, 6);
const sameLeft = (run, name) => run.left(name).every((w, i) => w === theirLeft(name)[i]);
const show = list => list.map(hex).join(', ');
check(['gThroughLeft', 'gFarLeft', 'gLocalLeft', 'gPassLeft', 'gHandLeft'].every(name => sameLeft(mine, name)), `what each of the later functions left is what mGBA's left: ${show(theirLeft('gThroughLeft'))}; ${show(theirLeft('gFarLeft'))}; ${show(theirLeft('gLocalLeft'))}; ${show(theirLeft('gPassLeft'))}; ${show(theirLeft('gHandLeft'))}`);
const via = map.functions.Through?.calls.find(c => c.callee === null);
check(via?.through && via.returnOffset === via.offset + 4, `the compiler's assembly has Through's call through a pointer, in ${via?.through}`);
check(theirLeft('gThroughLeft').includes(FUNCTIONS.Through + via.returnOffset + 1), 'and mGBA\'s stack has where it goes back to');
const noThrough = await built_('no-through', { without: new Set(['through']) });
check(!sameLeft(noThrough, 'gThroughLeft') && sameLeft(noThrough, 'gFarLeft'), `without the call through a pointer, where Deep goes back to is missing: ${show(noThrough.left('gThroughLeft'))}`);
check(theirLeft('gFarLeft').includes(NAMED.get('gFar')), 'mGBA\'s stack has the pointer Far keeps, at the console\'s address');
const noPointers = await built_('no-pointers', { without: new Set(['pointers']) });
check(!sameLeft(noPointers, 'gFarLeft') && noPointers.left('gFarLeft').includes(FAR_HERE) && sameLeft(noPointers, 'gThroughLeft'), `without the console's address of a pointer, the one Far keeps is the Dreamport's own: ${show(noPointers.left('gFarLeft'))}`);
const home = map.functions.Local?.registers.find(l => l.name === 'local'), call = map.functions.Local?.calls.find(c => c.callee === 'Deep');
check(home && call?.regs?.[home.reg]?.unknown !== undefined && call.writers[home.reg].every(w => !w.entry), `the compiler keeps Local's local in ${home?.reg}, which its arithmetic can't follow: ${call?.regs?.[home?.reg]?.unknown}`);
const noLocals = await built_('no-locals', { without: new Set(['locals']) });
check(!sameLeft(noLocals, 'gLocalLeft') && noLocals.gaps.length === 1 && sameLeft(noLocals, 'gFarLeft'), `without the local a register holds, it's missing, and listed: ${show(noLocals.left('gLocalLeft'))}; ${noLocals.gaps.join('; ')}`);
// Pass proven only at its start: what it pushes is kept, and Main's other register reaches Deep through it, while its
// own register and where Deep goes back to stay out; not proven at all, those are out too
const start = map.functions.Pass?.start, passAt = FUNCTIONS.Pass - CARTRIDGE, twinAt = built.made.symbols.get('Pass').at;
const sameStart = start && !start.loads && Buffer.compare(rom.subarray(passAt, passAt + start.bytes), Buffer.from(built.made.sections['.text'].bytes).subarray(twinAt, twinAt + start.bytes)) === 0;
check(sameStart && start.bytes >= 2, `Pass's start is ${start?.bytes} bytes, the cartridge's own`);
const others = new Set([...COMPILED].filter(name => name !== 'Pass'));
const startOnly = await built_('start-only', { matched: others, starts: new Set(['Pass']) }), notAtAll = await built_('not-at-all', { matched: others });
const wrong = run => run.left('gPassLeft').filter((w, i) => w !== theirLeft('gPassLeft')[i]).length;
const passed = theirLeft('gPassLeft').indexOf(NAMED.get('gMore'));
check(passed >= 0 && startOnly.left('gPassLeft')[passed] === NAMED.get('gMore') && notAtAll.left('gPassLeft')[passed] !== NAMED.get('gMore'),
  'with Pass proven only at its start, the register of Main\'s it doesn\'t save reaches Deep, which saves it as mGBA\'s does, and with Pass not proven at all it doesn\'t');
check(wrong(startOnly) > 0 && wrong(startOnly) < wrong(notAtAll), `its own register and where Deep goes back to stay out: ${wrong(startOnly)} of the six words differ, and ${wrong(notAtAll)} with Pass not proven at all (${show(startOnly.left('gPassLeft'))}; ${show(notAtAll.left('gPassLeft'))})`);
check(startOnly.gaps.some(gap => gap.startsWith('Pass: proven only at its start')), `and that's listed: ${startOnly.gaps.join('; ')}`);

// Hand from the table: the routine's pushes, its high register saved through a low one, the number and the parameter it
// keeps, and where Inner goes back to, as mGBA's; without the table, its twin only takes the room the compiler gives
// its C, and they're missing
const hand = table.Hand;
check(hand?.instrs.filter(ins => ins.writes.length).length === 4 && hand.instrs.find(ins => ins.anchor?.kind === 'call')?.sp === -28, `the table gives Hand's four stores to the stack and its call 28 bytes down: ${JSON.stringify(hand?.instrs.flatMap(ins => ins.writes.map(w => w.slot)))}`);
check(theirLeft('gHandLeft')[1] === NAMED.get('gHanded') && theirLeft('gHandLeft')[3] === NAMED.get('gDone'), `mGBA's stack has the parameter Hand kept on its frame, the start's r8 it saved through r4, and Main's registers: ${show(theirLeft('gHandLeft'))}`);
const noRoutines = await built_('no-routines', { without: new Set(['routines']) });
check(!sameLeft(noRoutines, 'gHandLeft') && sameLeft(noRoutines, 'gPassLeft'), `without the table, what Hand left is missing: ${show(noRoutines.left('gHandLeft'))}`);
check(made.text.includes('gba_stack_asm_enter(&gba_asm_Hand)') && noRoutines.gaps.some(gap => gap.startsWith('Hand:')), `its twin starts from the table's frame, and without the table that's listed: ${noRoutines.gaps.filter(gap => gap.startsWith('Hand:')).join('; ')}`);

// The function check builds a version's twins as its build does, from the copies with the stack's calls in, and starts
// each call's stack where the original's call starts (../gba/twin.mjs): Again's call of Read then finds what Keep's
// calls left, as the original's does, and built from the file as it is, what the module's own stack holds
console.log('The function check, with the console\'s stack:');
ensureCaller(console.log);
const opened = await openOriginal(cartridge, 3);
const checked = async copies => {
  const result = await checkFile({
    original: opened.original, start: opened.start, copy: cartridge, file: PROGRAM, build: openBuild({ root: HERE, files: [PROGRAM], stacked: copies }),
    only: FUNCTIONS.Again, addressOf: name => NAMED.get(name) ?? null, options: { calls: 50, seconds: 2 },
  });
  return result.functions?.find(f => f.name === 'Again') ?? { line: result.error ?? `no address for ${result.missing}` };
};
try {
  const onStack = await checked(new Map([[PROGRAM, stacked]]));
  check(onStack.kind === 'same', `built as the version's build builds it, Again leaves the same memory as the original's: ${onStack.line}`);
  const plainly = await checked(null);
  check(plainly.kind === 'differs' && /at 0x0300011[0-9A-F]/.test(plainly.line), `built from its file as it is, it differs at gOut, where Copy puts Read's box: ${plainly.line}`);
} finally {
  opened.original.close();
}

if (failed) {
  console.log(`${failed} failed.`);
  process.exit(1);
}
console.log('The Dreamport leaves the console\'s stack as the original does.');
