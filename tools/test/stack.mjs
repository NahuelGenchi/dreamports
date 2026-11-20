// npm run test:stack: the console's stack in a Dreamport (kit/gba/c/stack.c, ../gba/stack.mjs), measured against the
// reference emulator with a program of the project's own (stack/leftovers.c), so it needs nobody's copy of any game.
// The console's own compiler builds the program into a made-up cartridge, each function at the address its comment
// names, and mGBA runs it. In it, Keep keeps gKept's address in a register across its call of Push, which saves that
// register on the stack with its return address, and Read then hands Copy a struct it set one word of, where those
// were left. The same C, built for a Dreamport with the stack's calls added from the compiler's own assembly, has to
// copy the same words and leave the stack the same, and without them it has to copy others.

import { mkdirSync, writeFileSync } from 'node:fs';
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
import { madeUpGame } from './made-up-game.mjs';
import { place } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./stack/', import.meta.url));
const WORK = join(LOCAL, 'tmp', 'stack-test');
const PROGRAM = join(HERE, 'leftovers.c');
const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
const FUNCTIONS = { Keep: 0x08000200, Push: 0x08000240, Inner: 0x08000280, Read: 0x080002C0, Copy: 0x08000300, Main: 0x08000340 };
const NAMED = new Map([['gKept', 0x03000100], ['gOther', 0x03000104], ['gInner', 0x03000108], ['gDone', 0x0300010C], ['gOut', 0x03000110]]);
// the start, in ARM at 0x080000C0: ldr r0, =Main + 1; mov lr, pc; bx r0; and then b . at 0x080000CC, where Main
// comes back to
const START = [0xE59F0008, 0xE1A0E00F, 0xE12FFF10, 0xEAFFFFFE, FUNCTIONS.Main + 1], BACK = 0x080000CC;
// what's compared: the program's values, and the stack under Main's own frame, whose first push is the start's r4,
// which no C gives
const VALUES = { address: 0x03000100, bytes: 0x20 }, STACK = { address: 0x03007E00, bytes: 0xF8 };

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
const { readFileSync } = await import('node:fs');
const text = readFileSync(PROGRAM, 'utf8');
const files = { tools: { test: { stack: { 'leftovers.c': Buffer.from(text) } } }, kit: { c: {}, gba: { c: { 'stack.h': readFileSync(join(REPO, 'kit', 'gba', 'c', 'stack.h')) } } } };
const tree = await syntaxOf(PROGRAM, REPO, args, files);
const addressOf = name => (FUNCTIONS[name] ? FUNCTIONS[name] + 1 : null);
const made = withStack({ file: inRepo(PROGRAM), text, tree, map, matched: new Set(Object.keys(FUNCTIONS)), addressOf });
check(made.gaps.length === 0, `the program's stack has no gaps${made.gaps.length ? `: ${made.gaps.join('; ')}` : ''}`);
const stacked = join(WORK, 'stacked.c'), plain = join(WORK, 'plain.c'), run = join(WORK, 'run.c');
writeFileSync(stacked, `${made.header}\n${made.text}`);
writeFileSync(plain, text);
// the start as the cartridge's: the stack where mGBA's start leaves it, and Main called from the ARM start
// with the module's memory reaching the fast work memory, where the console keeps both
writeFileSync(run, `#include "stack.h"\nvoid Main(void);\n__attribute__((export_name("run"))) void run(void) {\n  unsigned have = __builtin_wasm_memory_size(0), need = (0x03008000u + 65535) / 65536;\n  if (have < need) __builtin_wasm_memory_grow(0, need - have);\n  gba_stack_start(0x03007F00u);\n  gba_stack_call(${hex(BACK)}u);\n  Main();\n}\n`);
const dreamport = async (program, name) => {
  const out = join(WORK, `${name}.wasm`);
  await buildWasm([program, run, join(REPO, 'kit', 'gba', 'c', 'stack.c'), join(REPO, 'kit', 'c', 'libc.c')], out, { folders: kit, flags: ['-funsigned-char'], addressOf: n => NAMED.get(n) ?? null });
  const imports = { env: new Proxy({}, { get: (_, n) => () => { throw new Error(`called ${String(n)}`); } }) };
  const { instance } = await WebAssembly.instantiate(readFileSync(out), imports);
  instance.exports.run();
  const memory = Buffer.from(instance.exports.memory.buffer);
  return { out: words(memory, NAMED.get('gOut'), 4), stack: memory.subarray(STACK.address, STACK.address + STACK.bytes) };
};
const mine = await dreamport(stacked, 'stacked'), without = await dreamport(plain, 'plain');
// with Push not proven by the same bytes: its frame still takes its room, so Keep's saved register is where Copy
// finds it, and Push's own two pushes are left out, and listed
const unproven = withStack({ file: inRepo(PROGRAM), text, tree: await syntaxOf(PROGRAM, REPO, args, files), map, matched: new Set(Object.keys(FUNCTIONS).filter(name => name !== 'Push')), addressOf });
const partly = join(WORK, 'partly.c');
writeFileSync(partly, `${unproven.header}\n${unproven.text}`);
const part = await dreamport(partly, 'partly');
check(mine.out.every((w, i) => w === theirOut[i]), `with the stack, Copy copies the same words: ${mine.out.map(hex).join(', ')}`);
const differing = [...mine.stack].filter((b, i) => b !== theirStack[i]).length;
check(differing === 0, `and the stack under Main's frame is the same, byte for byte: ${STACK.bytes - differing} of ${STACK.bytes}`);
check(!without.out.every((w, i) => w === theirOut[i]), `without it, Copy copies other words: ${without.out.map(hex).join(', ')}`);
check(part.out[0] === theirOut[0] && part.out[1] === 0 && part.out[2] === 0 && part.out[3] === theirOut[3], `with Push not proven by its bytes, its frame keeps its room, so Copy still finds what Keep saved, and Push's own pushes are left out: ${part.out.map(hex).join(', ')}`);
check(unproven.gaps.some(gap => gap.startsWith('Push: not proven by the same bytes')), `and that's listed: ${unproven.gaps.join('; ')}`);

if (failed) {
  console.log(`${failed} failed.`);
  process.exit(1);
}
console.log('The Dreamport leaves the console\'s stack as the original does.');
