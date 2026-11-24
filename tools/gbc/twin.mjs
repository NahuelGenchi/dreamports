// The function check on the Game Boy and the Game Boy Color: one function of the original and its twin, a function of
// the game's C, run from the same memory and the same registers, thousands of times, and must leave the same. Their
// games were written by hand in the processor's own language, as the NES's were, so no compiler gives their bytes
// back, and this is the only proof a twin has there (docs/STANDARD.md).
//
//   npm run dp -- twin <version> [<function>...] [--calls <n>] [--seed <n>] [--seconds <n>]
//
// It's the Game Boy's side of the one tool (../twin.mjs), which gives it the command as it was typed, and it runs by
// itself too, as node tools/gbc/twin.mjs with the same words.
//
// The original's side is Gambatte's own processor, the one the proof's emulator runs every game on: its cpu.cpp, built
// as its makers wrote it from the source the tools fetch for the reference emulator, on a stand-in for the rest of the
// emulator (twin/core/, twin/original.cpp). The twin's side is the game's C built for this computer as it is, on a
// stand-in for the kit that draws and plays nothing (twin/kit.c). twin/check.c gives both the same memory, the 8 KB of
// work memory at $C000 and the high memory at $FF80, and the same registers, and compares what each leaves: every byte
// of that memory, what the contract says the twin gives back, each store to the hardware and each read of it in
// order, and the time, if the twin counts it.
//
// The contract. A function of the original takes and gives values in the processor's registers, A, B, C, D, E, H and
// L, alone or in the pairs BC, DE and HL, and in its flags, and nothing in C says which. So each twin has one line
// beside it, in a comment:
//
//   // dp:twin sub_0419 copy_bytes(HL, DE, BC)
//   // dp:twin sub_02_4123 next_object(&HL) -> A if B < 40
//   // dp:twin sub_0284 +16 at_vblank()
//
// After `dp:twin` comes the original's function, named as the game's code names it for portmap, and then the call of
// the twin, in C, with the registers and flags it's given written as themselves: the flags are ZF, NF, HF and CF, as
// C and H are registers. A register or a pair given with `&` is one the twin changes, and it's compared with the
// original's afterwards. After `->` comes what the twin's result has to equal, in C, of the original's registers and
// flags once it has returned: `-> A`, `-> HL`, `-> CF ? A : 0`. After `if` comes what the game gives it, in C, of the
// registers and the memory, as gb_wram and gb_hram: the check calls it with nothing else. A number before the call,
// such as `+16`, is how many cycles the twin counts beyond the function's own, from its first instruction to the end
// of its return. The line is C, so the compiler reads it against the twin as it's declared, and the check tries every
// word of it: a register it doesn't name gets any value, so a function that takes one the contract leaves out differs.
//
// SP is the stack pointer as the function starts, after the CALL that called it, which left the address it comes back
// to there. A contract that names SP has each call start with a stack anywhere in the work memory, and one that
// doesn't has them all start at $DFF0. What the original pushes under it isn't compared, as it's free once it returns.
// A function that an interrupt runs returns with RETI, which the check takes as a return.
//
// A game that keeps the number of the bank switched in at $4000 in its memory says where, once, as
// `// dp:bank $C0A0`: the original then starts with that bank, and has to leave the one the twin's memory says. With
// no such line a function in the first bank starts with no bank said, and a call that reads $4000-$7FFF before it
// switches one in is left out; the bank it leaves has to be the one the twin's own writes to the chip left.
//
// The game's C is built with DP_TWIN_CHECK defined. What it spends and what it reads and writes reach the check
// through the kit, gb_spend, gb_read and gb_write.
//
// Each call starts from random bytes, or is "changed": the original runs once to say which bytes it reads, a few of
// those get other values, and it runs again.
//
// The same memory is a proof of the paths the calls took, and of no other. So the check also says which of the
// program's instructions the calls that came out the same ran, and which way each jump, call and return with a
// condition went, and a twin counts as proven only when every instruction of the original's function ran and each of
// those went both ways. In a version that keeps its proofs (../lib/proofs.mjs), each twin proven is kept there as
// proven by the same memory, and one that differs loses that line. Only this tool and `match` write them.
//
// What it can't check yet: a call can't start from a memory of play, so `if` has to say what the game gives, and a
// function that runs code the game copied into its memory can't be checked; the Game Boy Color's banks of work
// memory; a function that waits, with HALT or STOP; and the registers a call starts with are drawn, not taken from
// play.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameFolder, LOCAL, REPO } from '../lib/paths.mjs';
import { functionKey, readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { gbInstructionsOf, readUnreachable, waysLeft } from '../lib/played.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { cKit } from '../lib/c.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { versionOf } from '../../src/lib/languages.mjs';
import { gbName, gbNames, gbProgram } from './functions.mjs';

const USAGE = 'Usage: npm run dp -- twin <version> [<function>...] [--calls <n>] [--seed <n>] [--seconds <n>]';
const HERE = fileURLToPath(new URL('./twin/', import.meta.url));
// the files of Gambatte's processor, in its source's libgambatte/, and the one of the tools' own that stands in for the rest of it
const PROCESSOR = ['src/cpu.cpp', 'src/cpu.h', 'src/savestate.h', 'include/gambatte.h', 'include/gbint.h', 'include/inputgetter.h'];
const STAND_INS = ['gambatte-memory.h'];
// the registers and flags a twin can be given by address, in the order of the contract's bits, the pairs, and every
// name a contract has for the processor
const REGISTERS = ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'ZF', 'NF', 'HF', 'CF'], PAIRS = { BC: ['B', 'C'], DE: ['D', 'E'], HL: ['H', 'L'] };
const NAMES = [...REGISTERS, ...Object.keys(PAIRS), 'SP'];
// how many calls of each kind, how long one may take, and the fewest calls of a twin a proof by the same memory is made of
const CALLS = 5000, LIMIT = 200, KEPT_FROM = 1000;
const FLAGS = ['-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-unused-function', '-fwrapv', '-DDP_TWIN_CHECK'];
const count = n => n.toLocaleString('en-US');
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const inRepo = path => (relative(REPO, path).startsWith('..') ? path : relative(REPO, path).split(sep).join('/'));
const cString = text => JSON.stringify(text).replace(/\?/g, '\\?');
const exe = name => (process.platform === 'win32' ? `${name}.exe` : name);

/**
 * The contracts in a file of a game's C, `text`, for a program of `banks` banks: { contracts, bank, errors }. Each
 * contract is { name, offset, line, text, call, back, given, allowance, byAddress, stack }, `bank` the address of the
 * byte of memory a `dp:bank` line names, or null, and `errors` what couldn't be read, each with its line.
 */
export function contractsIn(text, banks) {
  const contracts = [], errors = [];
  let bank = null;
  text.split('\n').forEach((whole, i) => {
    const line = i + 1;
    const said = whole.match(/\bdp:bank\s+(\S+)/);
    if (said) {
      const at = said[1].match(/^\$([0-9A-Fa-f]{4})$/), address = at ? parseInt(at[1], 16) : -1;
      if (!((address >= 0xC000 && address < 0xE000) || (address >= 0xFF80 && address < 0xFFFF))) errors.push({ line, error: `dp:bank names a byte of the work memory or the high memory, as $C0A0, and "${said[1]}" isn't one` });
      else bank = address;
    }
    const found = whole.match(/\bdp:twin\s+(\S+)\s*(.*)$/);
    if (!found) return;
    const [label] = gbNames(found[1], banks);
    if (!label || label[0] !== found[1]) return errors.push({ line, error: `"${found[1]}" isn't a function as the game's code names one, such as sub_0150 or sub_02_4123` });
    let rest = found[2].replace(/\*\/\s*$/, '').trim(), allowance = 0, given = null, back = null;
    const extra = rest.match(/^([+-]\d+)\s+/);
    if (extra) {
      allowance = Number(extra[1]);
      rest = rest.slice(extra[0].length);
    }
    const condition = rest.match(/\sif\s(.*)$/);
    if (condition) {
      given = condition[1].trim();
      rest = rest.slice(0, condition.index);
    }
    const gives = rest.match(/\s->\s(.*)$/);
    if (gives) {
      back = gives[1].trim();
      rest = rest.slice(0, gives.index);
    }
    const call = rest.trim();
    if (!/^[A-Za-z_]\w*\s*\(.*\)$/.test(call)) return errors.push({ line, error: `after ${found[1]} comes the call of its twin, as copy_bytes(HL, DE, BC), and "${call}" isn't one` });
    if (back === '' || given === '') return errors.push({ line, error: 'nothing comes after its -> or its if' });
    if (/&\s*SP\b/.test(call)) return errors.push({ line, error: 'SP, the stack pointer, is the same after a function as before it, so a twin is given it as it is, without &' });
    let byAddress = 0;
    for (const [, name] of call.matchAll(/&\s*([A-Z]{1,2})\b/g)) {
      for (const register of PAIRS[name] ?? [name]) if (REGISTERS.includes(register)) byAddress |= 1 << REGISTERS.indexOf(register);
    }
    const stack = /\bSP\b/.test(`${call} ${given ?? ''}`);
    contracts.push({ name: label[0], offset: label[1], line, text: found[2].replace(/\*\/\s*$/, '').trim(), call, back, given, allowance, byAddress, stack });
  });
  return { contracts, bank, errors };
}

// The game's file and, after it, each of its contracts as the functions the check calls: the twin's call with the
// registers as C's own variables, what its result has to equal, and what the game gives it. They come after the
// file's own code, in the same unit, so a twin no other file sees can be called, and a name of the file's own that is
// a register's is put aside first. A pair the twin changed, given by address, goes back into its two registers.
function unitFor(file, contracts) {
  const locals = constant => `  ${constant}uint8_t A = dp_r->A, B = dp_r->B, C = dp_r->C, D = dp_r->D, E = dp_r->E, H = dp_r->H, L = dp_r->L; ${constant}uint16_t SP = dp_r->SP;
  ${constant}uint16_t BC = (uint16_t)(B << 8 | C), DE = (uint16_t)(D << 8 | E), HL = (uint16_t)(H << 8 | L); ${constant}int ZF = dp_r->ZF, NF = dp_r->NF, HF = dp_r->HF, CF = dp_r->CF;
  (void)A; (void)B; (void)C; (void)D; (void)E; (void)H; (void)L; (void)SP; (void)BC; (void)DE; (void)HL; (void)ZF; (void)NF; (void)HF; (void)CF;\n`;
  const at = contract => `#line ${contract.line} ${JSON.stringify(file)}\n`;
  return `#include ${JSON.stringify(file)}\n${NAMES.map(register => `#undef ${register}\n`).join('')}#include "contract.h"\n${contracts.map(contract => `
static void dp_call_${contract.index}(twin_regs *dp_r, long *dp_gave) {
${locals('')}  const uint16_t dp_bc = BC, dp_de = DE, dp_hl = HL;
${at(contract)}  ${contract.back ? `*dp_gave = (long)(${contract.call});` : `(void)dp_gave; ${contract.call};`}
  if (BC != dp_bc) { B = (uint8_t)(BC >> 8); C = (uint8_t)BC; }
  if (DE != dp_de) { D = (uint8_t)(DE >> 8); E = (uint8_t)DE; }
  if (HL != dp_hl) { H = (uint8_t)(HL >> 8); L = (uint8_t)HL; }
  dp_r->A = A; dp_r->B = B; dp_r->C = C; dp_r->D = D; dp_r->E = E; dp_r->H = H; dp_r->L = L; dp_r->ZF = ZF; dp_r->NF = NF; dp_r->HF = HF; dp_r->CF = CF;
}
static long dp_back_${contract.index}(const twin_regs *dp_r) {
${locals('const ')}${at(contract)}  return (long)(${contract.back ?? '0'});
}
static int dp_given_${contract.index}(const twin_regs *dp_r) {
${locals('const ')}${at(contract)}  return !!(${contract.given ?? '1'});
}
const twin_contract dp_twin_${contract.index} = { ${cString(contract.name)}, ${cString(contract.text)}, ${contract.offset}, ${contract.allowance}, ${contract.back ? 1 : 0}, ${contract.byAddress}, ${contract.stack ? 1 : 0}, dp_call_${contract.index}, dp_back_${contract.index}, dp_given_${contract.index} };
`).join('')}`;
}

// the list of every contract, and the game's bank byte
function tableFor(contracts, bank) {
  return `#include "check.h"\n${contracts.map(c => `extern const twin_contract dp_twin_${c.index};\n`).join('')}
const twin_contract *const twin_contracts[] = { ${contracts.map(c => `&dp_twin_${c.index}`).join(', ')} };
const int twin_contract_count = ${contracts.length};
const int twin_bank_at = ${bank ?? -1};
`;
}

// what compiles C and C++ here: the computer's own, or on Windows the compiler the tools get for a build
function compilersOf(tools) {
  if (tools) return { cc: tools.gcc, cxx: tools.gcc.replace(/gcc(\.exe)?$/i, 'g++$1'), env: tools.env, more: ['-static'] };
  if (process.platform === 'win32') return { cc: process.env.CC || 'gcc', cxx: process.env.CXX || 'g++', env: process.env, more: ['-static'] };
  return { cc: process.env.CC || 'cc', cxx: process.env.CXX || 'c++', env: process.env, more: [] };
}
// On Windows most computers have no compiler, and the tools get one for each build (../gba/windows.mjs). A computer
// that has GCC already, as GitHub's has, builds with its own.
const hasOwn = () => process.platform !== 'win32' || [process.env.CC || 'gcc', process.env.CXX || 'g++'].every(name => spawnSync(name, ['--version'], { encoding: 'utf8' }).status === 0);
const withCompilers = (log, work) => (hasOwn() ? work(compilersOf(null)) : withBuildTools(log, tools => work(compilersOf(tools))));
function compile(what, compiler, args, cwd, env) {
  const result = spawnSync(compiler, args, { cwd, env, encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`${what} didn't build:\n${(result.stderr || result.error?.message || '').trim().split('\n').slice(0, 40).join('\n')}`);
}

// Gambatte's processor and the check's own side of it, built by themselves, once: the emulator's files, copied from its
// makers' source beside the stand-in, in a folder of the tools' own, on this computer only
function buildProcessor(log, compilers) {
  const machine = consoleOf('gb'), core = join(LOCAL, 'twin', 'gb-processor');
  const objects = [join(core, `cpu-${machine.core.commit.slice(0, 12)}.o`), join(core, 'original.o')];
  const own = [...STAND_INS.map(name => [join(HERE, 'core', name), join(core, name)]), ...['original.cpp', 'check.h', 'contract.h'].map(name => [join(HERE, name), join(core, name)])];
  if (objects.every(object => existsSync(object)) && own.every(([from, to]) => existsSync(to) && readFileSync(to, 'utf8') === readFileSync(from, 'utf8'))) return { core, objects };
  log(`Getting the Game Boy's processor from its emulator's source, at ${machine.core.source}…`);
  const source = join(fetchSource(machine), 'libgambatte');
  rmSync(core, { recursive: true, force: true });
  mkdirSync(core, { recursive: true });
  for (const name of PROCESSOR) copyFileSync(join(source, name), join(core, basename(name)));
  for (const [from, to] of own) copyFileSync(from, to);
  // the emulator's own header takes the whole-number types for granted
  compile('The Game Boy\'s processor', compilers.cxx, ['-O2', '-w', '-include', 'stdint.h', '-c', 'cpu.cpp', '-o', objects[0]], core, compilers.env);
  compile('The check\'s side of the processor', compilers.cxx, ['-O2', '-Wall', '-include', 'stdint.h', '-c', 'original.cpp', '-o', objects[1]], core, compilers.env);
  return { core, objects };
}

/**
 * Builds the check for the C in `sources` (a folder), against the copy `rom` (its bytes), in the folder `work`, and
 * gives { program, contracts, bank, notes }: the program, each contract with `file`, `line` and its place among them,
 * `index`, and what to say of them. `functions`, a code map's, says where the original's functions start, when
 * there's one.
 */
export function buildCheck({ rom, sources: folder, work: where, functions = null, log = console.log }) {
  const sources = resolve(folder), work = resolve(where);
  const program = gbProgram(rom);
  if (!program) throw new Error("That copy isn't a Game Boy game's.");
  const files = readdirSync(sources).filter(name => name.endsWith('.c')).sort().map(name => join(sources, name));
  if (!files.length) throw new Error(`${inRepo(sources)} has no C.`);
  const contracts = [], errors = [], notes = [];
  let bank = null;
  const units = files.map(file => {
    const found = contractsIn(readFileSync(file, 'utf8'), program.banks);
    for (const { line, error } of found.errors) errors.push(`${inRepo(file)}:${line}: ${error}.`);
    if (found.bank !== null) bank = found.bank;
    const own = found.contracts.map(contract => ({ ...contract, file, index: contracts.length + found.contracts.indexOf(contract) }));
    contracts.push(...own);
    return { file, own };
  });
  const seen = new Map();
  for (const contract of contracts) {
    if (seen.has(contract.offset)) errors.push(`${inRepo(contract.file)}:${contract.line}: ${contract.name} has a contract already, at ${inRepo(seen.get(contract.offset).file)}:${seen.get(contract.offset).line}.`);
    seen.set(contract.offset, contract);
    // checked all the same, as the processor can be started anywhere, and said, as a twin is a whole function of the original
    if (functions && !functions.some(f => f.address === contract.offset)) notes.push(`${inRepo(contract.file)}:${contract.line}: the code map has no function that starts at ${contract.name}, so this twin is a piece of another function, or the code map is missing one.`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (!contracts.length) throw new Error(`${inRepo(sources)} has no contract yet: a line such as "// dp:twin ${gbName(0x150, program.banks)} name_of_its_twin(HL)" beside a twin says what it's given and gives back (npm run dp -- help the function check on the Game Boy).`);

  const made = join(work, 'made');
  rmSync(made, { recursive: true, force: true });
  mkdirSync(made, { recursive: true });
  const built = units.map(({ file, own }) => {
    if (!own.length) return file;
    const unit = join(made, basename(file));
    writeFileSync(unit, unitFor(file, own));
    return unit;
  });
  writeFileSync(join(made, 'dp-contracts.c'), tableFor(contracts, bank));
  const out = join(work, exe('check'));
  const folders = [HERE, sources, ...cKit('gb').folders];
  withCompilers(log, compilers => {
    const { objects } = buildProcessor(log, compilers);
    const cFiles = [...built, join(made, 'dp-contracts.c'), join(HERE, 'check.c'), join(HERE, 'kit.c')];
    const compiled = cFiles.map((file, i) => {
      const object = join(made, `unit-${i}.o`);
      compile('The check', compilers.cc, ['-std=gnu11', ...FLAGS, ...folders.flatMap(each => ['-I', each]), '-c', file, '-o', object], work, compilers.env);
      return object;
    });
    // the processor is C++, so its compiler links the whole
    compile('The check', compilers.cxx, [...compilers.more, '-o', out, ...compiled, ...objects], work, compilers.env);
  });
  return { program: out, contracts, bank, notes };
}

// one twin's calls, as the check's program counts them
function runCheck({ program, copy, calls, seed, index, limit, patience }) {
  const args = [copy, '-', String(calls), String(seed), String(index), String(limit)];
  // far longer than every call takes: for a computer where nothing stops one call that never returns
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: patience ?? 120000 + calls * 20, maxBuffer: 2 ** 24 });
  if (result.error?.code === 'ETIMEDOUT' || result.signal) return { stopped: `The check was stopped: ${result.signal ? `it ended on ${result.signal}` : 'it took too long'}, so its twin doesn't return, or took the check down with it.` };
  // a twin that reads where the computer has nothing ends the whole program on Windows, where nothing catches it
  if (result.status > 2) return { stopped: `The check ended by itself, with ${result.status}, so its twin fell over and took the check down with it.` };
  if (result.status !== 0) throw new Error(`The check's program didn't run: ${(result.stderr || result.error?.message || `it ended with ${result.status}`).trim()}`);
  return JSON.parse(result.stdout);
}

/** What one twin's counts say: { same, why }, `why` each thing that differs, in words. */
export function verdict(result) {
  if (result.stopped) return { same: false, why: [result.stopped] };
  const why = [], kind = result.changed;
  if (kind.calls < 0) return { same: false, why: ['Its contract\'s `if` took none of the registers the check tried, so nothing was called.'] };
  const all = count(kind.calls), parts = [];
  if (kind.ranOn) parts.push(`the twin didn't come back in time on ${count(kind.ranOn)}, and the check stopped there`);
  if (kind.fell) parts.push(`the twin fell over on ${count(kind.fell)}`);
  if (kind.notBack) parts.push(`the original didn't come back as a function does on ${count(kind.notBack)}`);
  if (kind.memory < kind.calls) parts.push(`the memory is the same on ${count(kind.memory)}`);
  if (kind.gives < kind.calls) parts.push(`what it gives back on ${count(kind.gives)}`);
  if (kind.hardware < kind.calls) parts.push(`what reaches the hardware on ${count(kind.hardware)}`);
  if (result.counts && kind.time < kind.calls) parts.push(`the time on ${count(kind.time)}${kind.same ? `, ${kind.least === kind.most ? `${Math.abs(kind.least)} cycles ${kind.least > 0 ? 'short' : 'over'}` : `from ${kind.least} to ${kind.most} cycles apart`}` : ''}`);
  if (parts.length) why.push(`Of ${all} calls: ${parts.join('; ')}.${kind.differs.length ? ` Bytes that differ most: ${kind.differs.map(([at, times]) => `$${hex4(at)} ${count(times)}`).join(', ')}.` : ''}${kind.first ? ` First: ${kind.first}.` : ''}`);
  if (!kind.calls) why.push(`No call could be counted: all ${count(kind.astray)} read where the console has nothing${kind.bankUnknown ? ', or a bank nothing says is at $4000 (dp:bank)' : ''}.`);
  return { same: !why.length, why };
}

/**
 * Checks the twins a build has (buildCheck), all of them or `only` those named by the original's function or by the
 * twin's own name: { results, same }, each result a contract with what the check counted and its verdict.
 */
export function checkTwins({ built, copy, calls = CALLS, seed = 1, limit = LIMIT, patience, only = [], log = console.log }) {
  const wanted = built.contracts.filter(contract => !only.length || only.some(name => name.toLowerCase() === contract.name.toLowerCase() || new RegExp(`^${name.replace(/[^\w]/g, '')}\\s*\\(`).test(contract.call)));
  if (!wanted.length) throw new Error(`No contract is for ${only.join(' or ')}: there are contracts for ${built.contracts.map(c => c.name).join(', ')}.`);
  const results = wanted.map(contract => {
    const result = { ...contract, ...runCheck({ program: built.program, copy, calls, seed, index: contract.index, limit, patience }) };
    Object.assign(result, verdict(result));
    const made = result.changed?.calls ?? 0, astray = result.changed?.astray ?? 0;
    const time = result.stopped ? '' : result.counts ? '' : ', time not counted';
    log(`${contract.name.padEnd(12)} ${contract.call}: ${result.same ? `the same on all ${count(made)} calls${time}` : 'differs'}${astray ? ` (${count(astray)} calls left out, which read where the console has nothing or a bank nothing says is there)` : ''}`);
    for (const line of result.why) log(`    ${line}`);
    return result;
  });
  return { results, same: results.filter(result => result.same).length };
}

/** The check on a version of a game: the twins its C has contracts for, all or those named. { results, same, tried }. */
export async function twin(game, { functions = [], calls = CALLS, seed = 1, limit = LIMIT, log = console.log } = {}) {
  const version = versionOf(game), original = readOriginal(game);
  if (original.console !== 'gb' && original.console !== 'gbc') throw new Error(`${game} isn't a Game Boy or Game Boy Color game.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The check is against ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const read = await readAnyCopy(copy.path, original.console);
  if (read?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  // a game named alone means its version in C
  const keptIn = version.language === 'c' ? game : `${version.game}/c`;
  const sources = join(gameFolder(keptIn), 'src'), codeMap = readCodeMap(game);
  const work = join(LOCAL, 'twin', keptIn.replace(/[^\w-]/g, '-'));
  mkdirSync(work, { recursive: true });
  const built = buildCheck({ rom: readFileSync(copy.path), sources, work, functions: codeMap?.functions ?? null, log });
  for (const note of built.notes) log(note);
  log(`${count(built.contracts.length)} twin${built.contracts.length === 1 ? ' has a contract' : 's have a contract'} in ${inRepo(sources)}. Each gets ${count(calls)} calls from a memory of random bytes, with a few of the bytes it reads changed.`);
  const { results, same } = checkTwins({ built, copy: copy.path, calls, seed, limit, only: functions, log });
  log(`${count(same)} of ${count(results.length)} twins the same as the original on every call.`);
  // which of those took every path of the original's function, which is what makes the same memory a proof
  const proven = [], differing = [];
  if (codeMap) {
    const of = gbInstructionsOf(codeMap, readFileSync(copy.path)), { ways: ruledOut } = readUnreachable(game);
    const banks = Math.floor(Math.max(...codeMap.functions.map(each => each.address)) / 0x4000) + 1;
    for (const result of results) {
      const f = codeMap.functions.find(each => each.address === result.offset);
      if (!f) continue;
      if (!result.same) {
        differing.push(functionKey(f));
        continue;
      }
      const ran = new Map();
      for (let i = 0; i + 1 < (result.ran ?? []).length; i += 2) ran.set(result.ran[i], result.ran[i + 1]);
      const { total, left } = waysLeft(of(f), f.address, ran, ruledOut);
      result.whole = !left.length;
      if (result.whole) proven.push({ key: functionKey(f), calls: result.changed?.calls ?? 0 });
      else {
        const first = left.slice(0, 3).map(([where, how]) => `${gbName(where, banks)} ${how}`).join(', ');
        log(`${result.name} ${result.call}: the same, but its calls left out ${count(left.length)} of the original's ${count(total)} instructions and branch ways, such as ${first}: it isn't proven until calls take those too.`);
      }
    }
    if (same) log(`${count(proven.length)} of those ${count(same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  }
  if (!asksForProofs(keptIn)) return { results, same, tried: results.length };
  if (calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(keptIn, keepProofs(keptIn, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return { results, same, tried: results.length };
}

function options(args) {
  const rest = [], flags = {};
  const number = (name, value) => {
    if (!/^\d+$/.test(value ?? '')) throw new Error(`--${name} takes a whole number.\n${USAGE}`);
    return Number(value);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--calls' || arg === '--seed') flags[arg.slice(2)] = number(arg.slice(2), args[++i]);
    // how long one call may take as the tool says it on every console, in seconds
    else if (arg === '--seconds') flags.limit = number('seconds', args[++i]) * 1000;
    else if (arg === '--memories') throw new Error(`The function check can't start a call from a memory of play on the Game Boy yet (docs/CONSOLES.md): each starts from random bytes.\n${USAGE}`);
    else if (arg.startsWith('--')) throw new Error(`${arg} isn't one of its options.\n${USAGE}`);
    else rest.push(arg);
  }
  return { rest, flags };
}

/** The tool, given the command's words: 0 when every twin checked is the same as the original, and 3 when one
 *  differs, never returns or falls over, as on every console. */
export async function run(args) {
  const { rest: [game, ...functions], flags } = options(args);
  if (!game) throw new Error(USAGE);
  const { same, tried } = await twin(game, { ...flags, functions });
  return same === tried ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
