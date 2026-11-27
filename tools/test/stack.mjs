// npm run test:stack: the console's stack in a Dreamport (kit/gba/c/stack.c, ../gba/stack.mjs), measured against the
// reference emulator with a program of the project's own (stack/leftovers.c), so it needs nobody's copy of any game.
// The console's own compiler builds the program into a made-up cartridge, each function at the address its comment
// names, and mGBA runs it. In it, Keep keeps gKept's address in a register across its call of Push, which saves that
// register on the stack with its return address, and Read then hands Copy a struct it set one word of, where those
// were left. The same C, built for a Dreamport with the stack's calls added from the compiler's own assembly, has to
// copy the same words and leave the stack the same, and without them it has to copy others.
//
// A call to the BIOS pushes on the game's stack too (kit/gba/c/stack.h, gba_stack_swi): Split divides through it and
// Fill copies through it, each by a stub of the cartridge's, a swi and back, whose twins are the kit's own BIOS
// library's. What the BIOS pushed is on mGBA's stack afterwards, and on the Dreamport's with the stubs saying their
// swi, and not without. And in the function check, Under has a word set in the 8 bytes its division took under its
// frame: the same memory as the original's with the library's stub, and not with one that says nothing.
//
// The rest of the program has what the arithmetic of a register can't say, each a rule of the stack's own
// (../gba/stack.mjs): a call through a pointer (Through), a pointer into memory the Dreamport keeps elsewhere (Far), a
// register that holds a local worked out from memory (Local), a function proven only at its start (Pass, under
// Wrap), and a routine the cartridge has in assembly, whose twin is C (Hand, from stack/routines.s, as a library's
// table keeps one). With each rule the stack is mGBA's, and without it it isn't.
//
// And the function check (../gba/twin.mjs) builds the same copy for a call of Again, which does what Main's first two
// calls do in one call: the same memory as the original's with the copy, and not without it. And for a call of Top,
// which copies what it pushed itself: the register the check's call starts with and where it goes back to, which the
// program that calls the original says (#1896).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { WASM_FLAGS, buildWasm } from '../lib/c.mjs';
import { compileFile } from '../gba/match.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { ensureOriginal, runOriginal } from '../gba/original.mjs';
import { memorySpec } from '../lib/memory.mjs';
import { reachedFrom, stackedCopy, stackOfFile, syntaxOf, withStack } from '../gba/stack.mjs';
import { routineMap } from '../gba/stack-map.mjs';
import { checkFile, ensureCaller, openBuild, openOriginal } from '../gba/twin.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { BIOS, CARTRIDGE, VIA, place } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./stack/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'stack-test');
const PROGRAM = join(HERE, 'leftovers.c'), ROUTINES = join(HERE, 'routines.s');
const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
const FUNCTIONS = { Keep: 0x08000200, Push: 0x08000240, Inner: 0x08000280, Read: 0x080002C0, Copy: 0x08000300, Main: 0x08000740, Deep: 0x08000380, Through: 0x080003C0, Far: 0x08000400, Local: 0x08000440, Pass: 0x08000480, Wrap: 0x080004C0, Take: 0x08000600, Look: 0x08000640, Hand: 0x08000700, Again: 0x08000800, Top: 0x08000880 };
// those the cartridge has as the console's compiler builds the C, all but the routine in assembly
const COMPILED = new Set(Object.keys(FUNCTIONS).filter(name => name !== 'Hand'));
const NAMED = new Map([['gKept', 0x03000100], ['gOther', 0x03000104], ['gInner', 0x03000108], ['gDone', 0x0300010C], ['gOut', 0x03000110],
  ['gMore', 0x03000120], ['gFirst', 0x03000124], ['gSecond', 0x03000128], ['gThrough', 0x0300012C], ['gSeen', 0x03000130], ['gSeed', 0x03000134], ['gLocal', 0x03000138], ['gPass', 0x0300013C], ['gWrap', 0x03000140], ['gHanded', 0x03000144], ['gTop', 0x03000148], ['gTopLeft', 0x03000200],
  ['gThroughLeft', 0x03000180], ['gFarLeft', 0x03000198], ['gLocalLeft', 0x030001B0], ['gPassLeft', 0x030001C8], ['gHandLeft', 0x030001E0],
  ['gFar', 0x0E000000]]);
// the functions that call the BIOS, and what they keep; the cartridge's stubs for its division and its copy, swi 6 and
// swi 11 and back; and the kit's library of those stubs, whose twins say each swi to the stack
const SWI = { Split: 0x08000900, Fill: 0x08000940, Poke: 0x08000980, Under: 0x080009C0 };
Object.assign(FUNCTIONS, SWI);
for (const name of Object.keys(SWI)) COMPILED.add(name);
for (const [name, address] of [['gSplit', 0x0300014C], ['gFill', 0x03000150], ['gFilled', 0x03000154], ['gUnder', 0x03000160], ['gSplitLeft', 0x03000220], ['gFillLeft', 0x03000240]]) NAMED.set(name, address);
const STUBS = { Div: BIOS.Div, CpuSet: 0x08000518 }, SWI_OF = { Div: 6, CpuSet: 11 };
const BIOS_FILE = join(REPO, 'kit', 'gba', 'c', 'lib', 'bios', 'bios.c');
const biosCompiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2'] };
// where mGBA's BIOS goes back to from the routine a swi runs, which a copy's routine saves, and the copy Fill asks for
const BIOS_BACK = 0x000000A4, FILL_CONTROL = 0x04000001;
// where the Dreamport keeps what the console has at gFar, and the console's address of a pointer into it
const FAR_HERE = 0x03000400, FAR_BYTES = 0x100;
// the start, in ARM at 0x080000C0: ldr r0, =Main + 1; mov lr, pc; bx r0; and then b . at 0x080000CC, where Main
// comes back to
const START = [0xE59F0008, 0xE1A0E00F, 0xE12FFF10, 0xEAFFFFFE, FUNCTIONS.Main + 1], BACK = 0x080000CC;
// what's compared: the program's values, and the stack under Main's own frame, whose first push is the start's r4,
// which no C gives
const VALUES = { address: 0x03000100, bytes: 0x200 }, STACK = { address: 0x03007E00, bytes: 0xF4 };

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
place(rom, built.assembly, FUNCTIONS, new Map([...NAMED, ...Object.entries(STUBS)]));
// no function runs into the next one's place
{
  const made = [...built.made.symbols].filter(([name, symbol]) => symbol.function && FUNCTIONS[name]).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
  const places = Object.values(FUNCTIONS).sort((a, b) => a - b);
  made.forEach((f, i) => {
    const bytes = (made[i + 1]?.at ?? built.made.sections['.text'].bytes.length) - f.at, next = places.find(address => address > FUNCTIONS[f.name]);
    if (next !== undefined && FUNCTIONS[f.name] + bytes > next) throw new Error(`${f.name} is ${bytes} bytes, more than its place in the made-up cartridge has.`);
  });
}
// the stubs: swi 6 and swi 11, each with bx lr after it
for (const [name, address] of Object.entries(STUBS)) {
  rom.writeUInt16LE(0xDF00 | SWI_OF[name], address - CARTRIDGE);
  rom.writeUInt16LE(0x4770, address - CARTRIDGE + 2);
}
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
// the kit's BIOS library with the stack's calls, as a version's build takes it: each stub's start, from the compiler's
// own assembly of it, and in its C the swi it says
const biosMap = await stackOfFile({ file: BIOS_FILE, root: dirname(BIOS_FILE), includes: [dirname(BIOS_FILE)], compiler: biosCompiler, work: join(WORK, 'bios-g') });
if (biosMap.error) throw new Error(biosMap.error);
const biosText = readFileSync(BIOS_FILE, 'utf8');
// with the kit's headers, as its stack.h takes the C library's
const headers = folder => Object.fromEntries(readdirSync(folder).filter(name => name.endsWith('.h')).map(name => [name, readFileSync(join(folder, name))]));
const biosFiles = { kit: { c: headers(kit[0]), gba: { c: { ...headers(kit[1]), lib: { bios: { 'bios.c': Buffer.from(biosText) } } } } } };
const biosMade = withStack({ file: inRepo(BIOS_FILE), text: biosText, tree: await syntaxOf(BIOS_FILE, REPO, args, biosFiles), map: biosMap, matched: new Set(Object.keys(biosMap.functions)), addressOf: name => (STUBS[name] ? STUBS[name] + 1 : null) });
const biosStacked = join(WORK, 'bios-stacked.c'), biosQuiet = join(WORK, 'bios-quiet.c'), biosWork = join(WORK, 'bios-work.c');
writeFileSync(biosStacked, `${biosMade.header}\n${biosMade.text}`);
// the same with no stub saying its swi
writeFileSync(biosQuiet, `${biosMade.header}\n${biosMade.text.replace(/gba_stack_swi\([^;]*;/g, '')}`);
// the BIOS's work, which a version's own hardware does: a division, and a copy or a fill of words or halfwords
writeFileSync(biosWork, `int console_div(int num, int denom) { return num / denom; }
int console_mod(int num, int denom) { return num % denom; }
void console_cpu_set(const void *src, void *dest, unsigned int control) {
  unsigned int count = control & 0x1FFFFF, fixed = control >> 24 & 1, i;
  if (control >> 26 & 1) for (i = 0; i < count; i++) ((unsigned int *)dest)[i] = ((const unsigned int *)src)[fixed ? 0 : i];
  else for (i = 0; i < count; i++) ((unsigned short *)dest)[i] = ((const unsigned short *)src)[fixed ? 0 : i];
}
void console_cpu_fast_set(const void *src, void *dest, unsigned int control) { console_cpu_set(src, dest, control | 0x04000000); }
void console_vblank_intr_wait(void) {}
`);
check(made.gaps.length === 0, `the program's stack has no gaps${made.gaps.length ? `: ${made.gaps.join('; ')}` : ''}`);
const stacked = join(WORK, 'stacked.c'), plain = join(WORK, 'plain.c'), run = join(WORK, 'run.c');
writeFileSync(stacked, `${made.header}\n${made.text}`);
writeFileSync(plain, text);
// the start as the cartridge's: the stack where mGBA's start leaves it, and Main called from the ARM start
// with the module's memory reaching the fast work memory, where the console keeps both
writeFileSync(run, `#include "stack.h"\nvoid Main(void);\nstatic uint32_t far(uint32_t pointer) { return pointer - ${hex(FAR_HERE)}u < ${hex(FAR_BYTES)}u ? ${hex(NAMED.get('gFar'))}u + (pointer - ${hex(FAR_HERE)}u) : pointer; }\n__attribute__((export_name("run"))) void run(void) {\n  unsigned have = __builtin_wasm_memory_size(0), need = (0x03008000u + 65535) / 65536;\n  if (have < need) __builtin_wasm_memory_grow(0, need - have);\n  gba_stack_addresses(far);\n  gba_stack_start(0x03007F00u);\n  gba_stack_call(${hex(BACK)}u);\n  Main();\n}\n`);
const dreamport = async (program, name, bios = biosStacked) => {
  const out = join(WORK, `${name}.wasm`);
  await buildWasm([program, bios, biosWork, run, join(REPO, 'kit', 'gba', 'c', 'stack.c'), join(REPO, 'kit', 'c', 'libc.c')], out, { folders: kit, flags: ['-funsigned-char', '-Wl,--export-table'], addressOf: n => (n === 'gFar' ? FAR_HERE : NAMED.get(n) ?? null) });
  const imports = { env: new Proxy({}, { get: (_, n) => () => { throw new Error(`called ${String(n)}`); } }) };
  const { instance } = await WebAssembly.instantiate(readFileSync(out), imports);
  instance.exports.run();
  const memory = Buffer.from(instance.exports.memory.buffer);
  return { out: words(memory, NAMED.get('gOut'), 4), left: name_ => words(memory, NAMED.get(name_), 6), stack: memory.subarray(STACK.address, STACK.address + STACK.bytes) };
};
const mine = await dreamport(stacked, 'stacked'), without = await dreamport(plain, 'plain', BIOS_FILE);
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

// A call to the BIOS: what it pushes on the game's stack is there afterwards, as mGBA's BIOS leaves it. After Split's
// division, where the stub goes back to, above r2, which no C gives and is a gap; after Fill's copy, all of what Look
// reads: one of Main's registers and where the copy's routine goes back to in the BIOS, which that routine saved, the
// copy's third value, which was in r2, where the stub goes back to, and Main's register Fill saved
const divides = map.functions.Split?.calls.find(c => c.callee === 'Div'), copies = map.functions.Fill?.calls.find(c => c.callee === 'CpuSet');
const splitBack = FUNCTIONS.Split + (divides?.returnOffset ?? 0) + 1, fillBack = FUNCTIONS.Fill + (copies?.returnOffset ?? 0) + 1;
check(divides && theirLeft('gSplitLeft')[4] === splitBack, `mGBA's stack has where Split's division goes back to, which the BIOS pushed: ${show(theirLeft('gSplitLeft'))}`);
check(mine.left('gSplitLeft')[4] === splitBack, `and so has the Dreamport's: ${show(mine.left('gSplitLeft'))}`);
const filled = theirLeft('gFillLeft');
check(copies && filled[1] === NAMED.get('gMore') && filled[2] === BIOS_BACK && filled[3] === FILL_CONTROL && filled[4] === fillBack && filled[5] === NAMED.get('gDone'),
  `mGBA's stack has what the BIOS pushed for Fill's copy, a register of Main's, where its routine goes back to, r2 and where the stub goes back to: ${show(filled)}`);
check(sameLeft(mine, 'gFillLeft'), `and so has the Dreamport's, word for word: ${show(mine.left('gFillLeft'))}`);
const noSwi = await dreamport(stacked, 'no-swi', biosQuiet);
check(noSwi.left('gSplitLeft')[4] !== splitBack && !sameLeft(noSwi, 'gFillLeft') && sameLeft(noSwi, 'gHandLeft'), `with no stub saying its swi, they're missing: ${show(noSwi.left('gSplitLeft'))}; ${show(noSwi.left('gFillLeft'))}`);

// A file's copy is kept from one run to the next, and made again only when something it's made from changes (#2070):
// the program in a folder of its own, with a header it includes and one it doesn't
console.log('A copy kept from one run to the next:');
{
  const src = join(WORK, 'kept-src'), keptIn = join(WORK, 'kept-copies'), own = join(src, 'leftovers.c');
  for (const folder of [src, keptIn]) rmSync(folder, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const put = (name, content) => writeFileSync(join(src, name), content);
  put('leftovers.c', `#include "taken.h"\n${text}`);
  put('taken.h', '#define TAKEN 1\n');
  put('left.h', '#define LEFT 1\n');
  // the files clang's tree is read from, as they are on the disk now
  const treeNow = () => {
    const tree = { kit: { c: {}, gba: { c: { 'stack.h': readFileSync(join(REPO, 'kit', 'gba', 'c', 'stack.h')) } } } };
    let at = tree;
    for (const part of inRepo(src).split('/')) at = at[part] ??= {};
    for (const name of readdirSync(src)) at[name] = readFileSync(join(src, name));
    return tree;
  };
  const ownArgs = [...args, '-I', inRepo(src)], defined = Object.entries(FUNCTIONS).map(([name, address]) => ({ name, address }));
  const copying = (more = {}) => stackedCopy({
    file: own, repo: REPO, out: keptIn, root: src, includes: [src], compiler, args: ownArgs, filesTree: treeNow(), clang: 'made up', defined, matched: COMPILED,
    routines: table, routinesFrom: routines, addressOf, valueOf: name => NAMED.get(name) ?? null, ...more,
  });
  const onDisk = () => readFileSync(join(keptIn, 'leftovers.c'), 'utf8');
  const first = await copying();
  // the same copy as the three steps make by hand
  const byHand = withStack({
    file: inRepo(own), text: readFileSync(own, 'utf8'), tree: await syntaxOf(own, REPO, ownArgs, treeNow()), map: await stackOfFile({ file: own, root: src, includes: [src], compiler, work: join(WORK, 'kept-by-hand') }),
    matched: COMPILED, addressOf, routines: table, valueOf: name => NAMED.get(name) ?? null,
  });
  const firstText = onDisk();
  check(first.made === true && firstText === `${byHand.header}\n#line 1 "leftovers.c"\n${byHand.text}` && JSON.stringify(first.gaps) === JSON.stringify(byHand.gaps), 'the first run makes the copy, the one the three steps make by hand');
  const second = await copying();
  check(second.made === false && second.copy === first.copy && onDisk() === firstText && JSON.stringify(second.gaps) === JSON.stringify(first.gaps), 'the next run takes it as it is, with its gaps, and makes nothing');
  put('left.h', '#define LEFT 2\n');
  check((await copying()).made === false, 'and so does one after a change to a header the file doesn\'t include');
  put('taken.h', '#define TAKEN 2\n');
  check((await copying()).made === true && (await copying()).made === false, 'a change to a header it includes makes it again, once');
  put('leftovers.c', `#include "taken.h"\n${text}\n// a line more\n`);
  const longer = await copying();
  check(longer.made === true && onDisk().endsWith('// a line more\n') && (await copying()).made === false, 'and so does a change to the file itself');
  // a function of another file that the copy asked the address of, and one it never asked of
  const moved = name => (name === 'Keep' ? FUNCTIONS.Keep + 0x11 : name === 'Nobody' ? 0x08000001 : addressOf(name));
  const unmoved = onDisk(), elsewhere = await copying({ addressOf: moved });
  check(elsewhere.made === true && onDisk() !== unmoved, 'a twin it names that moves makes it again, and the copy is another');
  check((await copying({ addressOf: moved })).made === false && (await copying()).made === true, 'and one it never names changes nothing, while the old address back makes it again');
  check((await copying({ valueOf: name => (name === 'gNothing' ? 0x03000FF0 : NAMED.get(name) ?? null) })).made === false, 'a value it never asks after changes nothing');
  check((await copying({ matched: new Set([...COMPILED].filter(name => name !== 'Push')) })).made === true && (await copying()).made === true, 'a function that loses its proof by the same bytes makes it again, and so does getting it back');
  check((await copying({ same: new Map([['Hand', 4]]) })).made === true && (await copying()).made === true, 'and so does what match says of a function\'s start');
  check((await copying({ compiler: { ...compiler, flags: [...compiler.flags, '-fno-inline'] } })).made === true && (await copying()).made === true, 'another flag for the console\'s compiler makes it again');
  check((await copying({ clang: 'another' })).made === true && (await copying()).made === true, 'and so does another version of the compiler that writes the tree');
  check((await copying({ routinesFrom: `${routines}\n` })).made === true && (await copying()).made === true, 'and another table of routines');
  writeFileSync(join(keptIn, 'leftovers.c'), `${onDisk()}\n`);
  check((await copying()).made === true && (await copying()).made === false, 'a copy that isn\'t the one written is made again');
  check((await copying({ clang: null })).made === true && (await copying({ clang: null })).made === true, 'and with no compiler\'s version to go by, nothing is kept');
  // which files a file can take in, read from its text: by name, wherever they are, and all of them when it can't be read
  const map = entries => new Map(Object.entries(entries).map(([path, content]) => [path, Buffer.from(content)]));
  const some = map({ 'src/a.c': '#include "x/b.h"\n# include <c.h>\n// #include NAME\n', 'kit/b.h': '%:include "d.h"\n', 'lib/b.h': '#embed "t.dat"\n', 'src/c.h': '', 'kit/d.h': '', 'lib/t.dat': '', 'src/e.h': '', 'src/other.c': '' });
  check(reachedFrom('src/a.c', some).join() === 'kit/b.h,kit/d.h,lib/b.h,lib/t.dat,src/a.c,src/c.h', `a file takes in every file its includes name, by name, in every folder, and those they name: ${reachedFrom('src/a.c', some).join(', ')}`);
  check(reachedFrom('src/a.c', map({ 'src/a.c': '#define NAME "b.h"\n/* one */ #include NAME\n', 'src/b.h': '', 'src/e.h': '' })).length === 3, 'with an include a macro names, every file there is');
  check(reachedFrom('src/a.c', map({ 'src/a.c': '#if defined(__has_include)\n#if __has_include("e.h") && __has_include(<g.h>)\n#endif\n#endif\n', 'src/e.h': '', 'src/f.h': '' })).join() === 'src/a.c,src/e.h', 'a file asked after with __has_include is taken like one included, and one that isn\'t there yet is none');
  check(reachedFrom('src/a.c', map({ 'src/a.c': '#if __has_include(NAME)\n#endif\n', 'src/e.h': '', 'src/f.h': '' })).length === 3 && reachedFrom('src/a.c', map({ 'src/a.c': '#define HAS __has_include\n', 'src/e.h': '', 'src/f.h': '' })).length === 3, 'and with one a macro asks after, or the question under another name, every file there is');
  check(reachedFrom('src/a.c', map({ 'src/a.c': '#inc\\\nlude "e.h"\n', 'src/e.h': '', 'src/f.h': '' })).join() === 'src/a.c,src/e.h', 'a directive split over two lines is read as the compiler joins it');
}

// The function check builds a version's twins as its build does, from the copies with the stack's calls in, and starts
// each call's stack where the original's call starts (../gba/twin.mjs): Again's call of Read then finds what Keep's
// calls left, as the original's does, and built from the file as it is, what the module's own stack holds
console.log('The function check, with the console\'s stack:');
ensureCaller(console.log);
const opened = await openOriginal(cartridge, 3);
const checked = async (copies, name = 'Again') => {
  const result = await checkFile({
    original: opened.original, start: opened.start, copy: cartridge, file: PROGRAM, build: openBuild({ root: HERE, files: [PROGRAM], stacked: copies }),
    only: FUNCTIONS[name], addressOf: name => NAMED.get(name) ?? null, options: { calls: 50, seconds: 2 },
  });
  return result.functions?.find(f => f.name === name) ?? { line: result.error ?? `no address for ${result.missing}` };
};
try {
  const onStack = await checked(new Map([[PROGRAM, stacked]]));
  check(onStack.kind === 'same', `built as the version's build builds it, Again leaves the same memory as the original's: ${onStack.line}`);
  const plainly = await checked(null);
  check(plainly.kind === 'differs' && /at 0x0300011[0-9A-F]/.test(plainly.line), `built from its file as it is, it differs at gOut, where Copy puts Read's box: ${plainly.line}`);
  const top = await checked(new Map([[PROGRAM, stacked]]), 'Top');
  check(top.kind === 'same', `Top copies the register and the return address it pushed, the ones the original's call starts with: ${top.line}`);
  const topPlainly = await checked(null, 'Top');
  check(topPlainly.kind === 'differs' && /at 0x0300021[0-7]/.test(topPlainly.line), `and built from its file as it is, it differs there: ${topPlainly.line}`);
  // Under's division takes the stack 8 bytes under its box, and Poke then sets a word in them: the stack's own, put
  // back after the call on both sides, once the twin's stub says its swi
  const under = async (copy, replay = null) => {
    const result = await checkFile({
      original: opened.original, start: opened.start, copy: cartridge, file: PROGRAM,
      build: openBuild({ root: HERE, files: [PROGRAM, BIOS_FILE, biosWork], stacked: new Map([[PROGRAM, stacked], [BIOS_FILE, copy]]) }),
      only: FUNCTIONS.Under, addressOf: name => NAMED.get(name) ?? null, options: { calls: 50, seconds: 2 }, replay,
    });
    return result.functions?.find(f => f.name === 'Under') ?? { line: result.error ?? `no address for ${result.missing}` };
  };
  const said = await under(biosStacked);
  check(said.kind === 'same', `with the library's stub, which says its swi, Under leaves the same memory as the original's: ${said.line}`);
  const quiet = await under(biosQuiet);
  check(quiet.kind === 'differs' && /at 0x03007[0-9A-F]{3}/.test(quiet.line), `with a stub that says nothing, it differs on the stack, in the 8 bytes the BIOS took: ${quiet.line}`);
  // that call made again by itself (#2069), on the stack and with the registers it started with, which the run kept
  check(quiet.began?.sp === opened.stack && quiet.began.begins?.kept.length === 8, `the run keeps where that call's stack started and what r4 to r11 held: 0x0${quiet.began?.sp?.toString(16).toUpperCase()}`);
  const quietAgain = await under(biosQuiet, quiet.began);
  check(quietAgain.kind === 'differs' && quietAgain.line === quiet.line, `made again by itself, it differs on the stack as the run said: ${quietAgain.line}`);
  const saidAgain = await under(biosStacked, quiet.began);
  check(saidAgain.kind === 'same', `and with the library's stub the same call leaves the same memory: ${saidAgain.line}`);
} finally {
  opened.original.close();
}

if (failed) {
  console.log(`${failed} failed.`);
  process.exit(1);
}
console.log('The Dreamport leaves the console\'s stack as the original does.');
