// The function check on the NES: one function of the original and its twin, a function of the game's C, run from the
// same memory and the same registers, thousands of times, and must leave the same. The NES has no compiler that gives
// a game's bytes back, as its games were written by hand in the processor's own language, so this is the only proof a
// twin has there (docs/STANDARD.md).
//
//   npm run dp -- twin <version> [<function>...] [--calls <n>] [--seed <n>] [--seconds <n>] [--memories [<recording>...]]
//                                [--from <folder>] [--without <bytes>] [--limit <milliseconds>]
//
// It's the NES's side of the one tool (../twin.mjs), which gives it the command as it was typed, and it runs by itself
// too, as node tools/nes/twin.mjs with the same words.
//
// The original's side is FCEUmm's own processor, the one the proof's emulator runs every game on: its x6502.c, built
// as its makers wrote it from the source the tools fetch for the reference emulator (twin/original.c). The twin's
// side is the game's C built for this computer as it is, on a stand-in for the kit that draws and plays nothing
// (twin/kit.c). twin/check.c gives both the same 2 KB of work memory and the same registers and compares what each
// leaves: every byte of the work memory, what the contract says the twin gives back, each store to the hardware and
// each read of it in order, and the time, if the twin counts it.
//
// The contract. A function of the original takes and gives values in the processor's three registers, A, X and Y, and
// in its flags, N, V, Z and C, and nothing in C says which. So each twin has one line beside it, in a comment:
//
//   // dp:twin sub_F321 show_object(X)
//   // dp:twin sub_F68E arthur_touches(X) -> C if X < 25
//   // dp:twin sub_02_8416 zombies_come(&X)
//   // dp:twin sub_C2BC +6 start_task(A) if A >= 2 && A <= 16
//
// After `dp:twin` comes the original's function, named as the game's code names it for portmap, and then the call of
// the twin, in C, with the registers and flags it's given written as themselves. A register given with `&` is one the
// twin changes, and it's compared with the original's afterwards. After `->` comes what the twin's result has to
// equal, in C, of the original's registers and flags once it has returned: `-> C` for a result that is the carry,
// `-> C ? Y : 0`, `-> !Z`. After `if` comes what the game gives it, in C, of the registers and the work memory, RAM:
// the check calls it with nothing else. A number before the call, such as `+6`, is how many cycles the twin counts
// beyond the function's own, from its first instruction to the end of its RTS: 6 for one that counts the JSR that
// calls it. The line is C, so the compiler reads it against the twin as it's declared, and the check tries every word
// of it: a register it doesn't name gets any value, so a function that takes one the contract leaves out differs.
//
// S is the stack pointer as the function starts, after the JSR that called it, which left the address it comes back
// to at $0101 + S and $0102 + S. Both sides start with that address in their memory, as the console has it. A
// function that reads, through a pointer, a byte of the stack's page it may have pushed itself, its own calls' return
// addresses, takes S, and its twin writes what those calls push, where they push it:
//
//   // dp:twin sub_E9AB find_block_tiles(S)
//
// A contract that names S has each call start with any stack pointer, and one that doesn't has them all start at $DE.
//
// A game that keeps the number of the bank switched in at $8000 in its work memory says where, once, as
// `// dp:bank $C7`: the original then starts with that bank, and has to leave the one the twin's memory says.
//
// The game's C is built with DP_TWIN_CHECK defined. What it spends and what it writes reach the check through the
// kit, nes_spend and nes_write, so a game that keeps its own time, to run its interrupt partway through a function,
// passes both straight on under DP_TWIN_CHECK.
//
// The memories. With none, each call starts from random bytes. `--memories` plays the game's recordings, or those
// named, in the original and keeps its work memory every so many frames in .dreamports/twin/, on this computer only,
// as they come from the contributor's copy. With memories, half the calls start from one as it was. The other half,
// and every call without them, are "changed": the original runs once to say which bytes it reads, a few of those get
// other values, and it runs again.
//
// The same memory is a proof of the paths the calls took, and of no other. So the check also says which of the
// program's instructions the calls that came out the same ran, and which way each branch went, and a twin counts as
// proven only when every instruction of the original's function ran and each of its branches went both ways. In a
// version that keeps its proofs (../lib/proofs.mjs), each twin proven is kept there as proven by the same memory,
// and one that differs loses that line. Only this tool and `match` write them.
//
// What it can't check yet: the registers a call starts with are drawn, not taken from play, so `if` has to say what
// the game gives; a cartridge that switches its program any other way than UNROM; and a function that waits for the
// picture.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameFolder, LOCAL, REPO } from '../lib/paths.mjs';
import { functionKey, readCodeMap, readOriginal, readRecordings } from '../lib/proof-files.mjs';
import { nesInstructionsOf, readUnreachable, waysLeft } from '../lib/played.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { versionLibraries } from '../lib/libraries.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { originalPlay } from '../lib/recording.mjs';
import { referenceOf } from '../lib/reference.mjs';
import { cKit } from '../lib/c.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';
import { versionOf } from '../../src/lib/languages.mjs';
import { INSTRUCTIONS } from './6502.mjs';
import { nesName, nesNames, nesProgram } from './functions.mjs';

const USAGE = 'Usage: npm run dp -- twin <version> [<function>...] [--calls <n>] [--seed <n>] [--seconds <n>] [--memories [<recording>...]] [--from <folder>] [--without <bytes>] [--limit <milliseconds>]';
const HERE = fileURLToPath(new URL('./twin/', import.meta.url));
// the files of FCEUmm's processor, in its source's src/, and the two of the tools' own that stand in for the rest of it
const PROCESSOR = ['x6502.c', 'x6502.h', 'x6502struct.h', 'ops.h', 'fceu-types.h'];
const STAND_INS = ['fceu.h', 'sound.h'];
// the mappers whose program the check lays out: one that switches nothing, and UNROM, whose register is any store to the program
const MAPPERS = new Set([0, 2, 3]);
// the registers and flags a twin can be given by address, in the order of the contract's bits, and every name a contract has for the processor
const REGISTERS = 'AXYNVZC', NAMES = 'AXYSNVZC';
const RAM = 0x800, WORDS = RAM / 4;
// how many calls of each kind, how long one may take, how many memories a game's recordings give, and the first frame one is taken at
const CALLS = 5000, LIMIT = 200, MEMORIES = 2000, FIRST_FRAME = 200;
// the fewest calls of a twin a proof by the same memory is made of
const KEPT_FROM = 1000;
const FLAGS = ['-std=gnu11', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-unused-function', '-fwrapv', '-DDP_TWIN_CHECK'];
const count = n => n.toLocaleString('en-US');
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const inRepo = path => (relative(REPO, path).startsWith('..') ? path : relative(REPO, path).split(sep).join('/'));
const cString = text => JSON.stringify(text).replace(/\?/g, '\\?');

/**
 * The contracts in a file of a game's C, `text`, for a program of `banks` banks: { contracts, bank, errors }. Each
 * contract is { name, offset, line, text, call, back, given, allowance, byAddress, stack }, `bank` the byte of work memory a
 * `dp:bank` line names, or null, and `errors` what couldn't be read, each with its line. In a file of a shared
 * library (../lib/libraries.mjs) a contract names the library's own function, and `placed`, a Map of its functions'
 * names to their offsets in the version's program, says where it is: a function the version gives no offset to isn't
 * in its copy, and its contract is left out.
 */
export function contractsIn(text, banks, placed = null) {
  const contracts = [], errors = [];
  let bank = null;
  text.split('\n').forEach((whole, i) => {
    const line = i + 1;
    const said = whole.match(/\bdp:bank\s+(\S+)/);
    if (said) {
      const at = said[1].match(/^\$([0-9A-Fa-f]{1,3})$/);
      if (!at || parseInt(at[1], 16) >= RAM) errors.push({ line, error: `dp:bank names a byte of the work memory, as $C7, and "${said[1]}" isn't one` });
      else bank = parseInt(at[1], 16);
    }
    const found = whole.match(/\bdp:twin\s+(\S+)\s*(.*)$/);
    if (!found) return;
    if (placed && !placed.has(found[1])) return;
    const [label] = placed ? [[found[1], placed.get(found[1])]] : nesNames(found[1], banks);
    if (!label || label[0] !== found[1]) return errors.push({ line, error: `"${found[1]}" isn't a function as the game's code names one, such as sub_F321 or sub_04_923F` });
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
    if (!/^[A-Za-z_]\w*\s*\(.*\)$/.test(call)) return errors.push({ line, error: `after ${found[1]} comes the call of its twin, as show_object(X), and "${call}" isn't one` });
    if (back === '' || given === '') return errors.push({ line, error: 'nothing comes after its -> or its if' });
    const byAddress = [...call.matchAll(/&\s*([AXYNVZC])\b/g)].reduce((bits, [, register]) => bits | 1 << REGISTERS.indexOf(register), 0);
    if (/&\s*S\b/.test(call)) return errors.push({ line, error: 'S, the stack pointer, is the same after a function as before it, so a twin is given it as it is, without &' });
    const stack = /\bS\b/.test(`${call} ${given ?? ''}`);
    contracts.push({ name: label[0], offset: label[1], line, text: found[2].replace(/\*\/\s*$/, '').trim(), call, back, given, allowance, byAddress, stack });
  });
  return { contracts, bank, errors };
}

// The game's file and, after it, each of its contracts as the functions the check calls: the twin's call with the
// registers as C's own variables, what its result has to equal, and what the game gives it. They come after the
// file's own code, in the same unit, so a twin no other file sees can be called, and a name of the file's own that
// is a register's letter is put aside first.
function unitFor(file, contracts) {
  const locals = constant => `  ${constant}uint8_t A = dp_r->A, X = dp_r->X, Y = dp_r->Y, S = dp_r->S; ${constant}int N = dp_r->N, V = dp_r->V, Z = dp_r->Z, C = dp_r->C;\n  (void)A; (void)X; (void)Y; (void)S; (void)N; (void)V; (void)Z; (void)C;\n`;
  const at = contract => `#line ${contract.line} ${JSON.stringify(file)}\n`;
  return `#include ${JSON.stringify(file)}\n${[...NAMES].map(register => `#undef ${register}\n`).join('')}#include "contract.h"\n${contracts.map(contract => `
static void dp_call_${contract.index}(twin_regs *dp_r, long *dp_gave) {
${locals('')}${at(contract)}  ${contract.back ? `*dp_gave = (long)(${contract.call});` : `(void)dp_gave; ${contract.call};`}
  dp_r->A = A; dp_r->X = X; dp_r->Y = Y; dp_r->N = N; dp_r->V = V; dp_r->Z = Z; dp_r->C = C;
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

// the list of every contract, the game's bank byte, and how each opcode reads the first page, from the tools' own table
function tableFor(contracts, bank) {
  const modes = { zp: 'TWIN_M_ZP', zpx: 'TWIN_M_ZPX', zpy: 'TWIN_M_ZPY', izx: 'TWIN_M_IZX', izy: 'TWIN_M_IZY' };
  return `#include "check.h"\n${contracts.map(c => `extern const twin_contract dp_twin_${c.index};\n`).join('')}
const twin_contract *const twin_contracts[] = { ${contracts.map(c => `&dp_twin_${c.index}`).join(', ')} };
const int twin_contract_count = ${contracts.length};
const int twin_bank_at = ${bank ?? -1};
const uint8_t twin_modes[256] = { ${INSTRUCTIONS.map(({ mode }) => modes[mode] ?? 'TWIN_M_OTHER').join(', ')} };
`;
}

function compile(what, args, cwd) {
  const compiler = process.env.CC || (process.platform === 'win32' ? 'gcc' : 'cc');
  const result = spawnSync(compiler, args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`${what} didn't build:\n${(result.stderr || '').trim().split('\n').slice(0, 40).join('\n')}`);
}

// FCEUmm's processor, built by itself, once: its own files, copied from its makers' source beside the two stand-ins,
// in a folder of the tools' own, on this computer only
function buildProcessor(log) {
  const machine = consoleOf('nes'), core = join(LOCAL, 'twin', 'nes-processor'), object = join(core, `x6502-${machine.core.commit.slice(0, 12)}.o`);
  if (existsSync(object) && STAND_INS.every(name => existsSync(join(core, name)) && readFileSync(join(core, name), 'utf8') === readFileSync(join(HERE, 'core', name), 'utf8'))) return { core, object };
  log(`Getting the NES's processor from its emulator's source, at ${machine.core.source}…`);
  const source = join(fetchSource(machine), 'src');
  rmSync(core, { recursive: true, force: true });
  mkdirSync(core, { recursive: true });
  for (const name of PROCESSOR) copyFileSync(join(source, name), join(core, name));
  for (const name of STAND_INS) copyFileSync(join(HERE, 'core', name), join(core, name));
  compile('The NES\'s processor', ['-std=gnu11', '-O2', '-w', '-c', 'x6502.c', '-o', object], core);
  return { core, object };
}

/**
 * Builds the check for the C in `sources` (a folder), with the files of the shared libraries the version takes,
 * `libraries`, each { file, given, values }, `given` as contractsIn takes `placed` and `values` a Map of each value
 * the library names to where the copy keeps it, which its C reads as ADDRESS_<name>, against the copy `rom` (its bytes), in the folder `work`, and
 * gives { program, contracts, notes }: the program, each contract with `file`, `line` and its place among them,
 * `index`, and what to say of them. `functions`, a code map's, says where the original's functions start, when there's one.
 */
export function buildCheck({ rom, sources: folder, work, functions = null, libraries = [], log = console.log }) {
  const sources = resolve(folder);
  const program = nesProgram(rom);
  if (!program) throw new Error("That copy isn't an NES game's.");
  if (!MAPPERS.has(program.mapper)) throw new Error(`The function check can't lay out the program of an NES cartridge of mapper ${program.mapper} yet: it knows the ones that switch nothing and UNROM (docs/CONSOLES.md).`);
  const files = readdirSync(sources).filter(name => name.endsWith('.c')).sort().map(name => join(sources, name));
  if (!files.length) throw new Error(`${inRepo(sources)} has no C.`);
  const given = new Map(libraries.map(({ file, given: at }) => [file, at]));
  const defines = [...new Map(libraries.flatMap(({ values = new Map() }) => [...values])).entries()].map(([name, value]) => `-DADDRESS_${name}=0x${value.toString(16).toUpperCase()}`);
  files.push(...given.keys());
  const contracts = [], errors = [], notes = [];
  let bank = null;
  const units = files.map(file => {
    const found = contractsIn(readFileSync(file, 'utf8'), program.banks, given.get(file) ?? null);
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
    if (functions && !functions.some(f => f.address === contract.offset)) notes.push(`${inRepo(contract.file)}:${contract.line}: the code map has no function that starts at ${contract.name}, so this twin is a piece of another function, or the code map lacks one.`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (!contracts.length) throw new Error(`${inRepo(sources)} has no contract yet: a line such as "// dp:twin ${nesName((program.banks - 1) * 0x4000, program.banks)} name_of_its_twin(X)" beside a twin says what it's given and gives back (tools/README.md).`);

  const { core, object } = buildProcessor(log);
  const made = join(work, 'made');
  rmSync(made, { recursive: true, force: true });
  mkdirSync(made, { recursive: true });
  const built = units.map(({ file, own }, i) => {
    if (!own.length) return file;
    // a library's file, named apart from the game's, as two can share a name
    const unit = join(made, given.has(file) ? `lib${i}-${basename(file)}` : basename(file));
    writeFileSync(unit, unitFor(file, own));
    return unit;
  });
  writeFileSync(join(made, 'dp-contracts.c'), tableFor(contracts, bank));
  const out = join(work, process.platform === 'win32' ? 'check.exe' : 'check');
  const folders = [HERE, core, sources, ...cKit('nes').folders];
  compile('The check', [...FLAGS, ...defines, ...folders.flatMap(folder => ['-I', folder]), '-o', out, ...built, join(made, 'dp-contracts.c'), ...['check.c', 'original.c', 'kit.c'].map(name => join(HERE, name)), object], work);
  return { program: out, contracts, bank, notes };
}

// one twin's calls, as the check's program counts them
function runCheck({ program, copy, memories, calls, seed, index, limit, without }) {
  const args = [copy, memories ?? '-', String(calls), String(seed), String(index), String(limit), without.length ? without.map(byte => byte.toString(16)).join(',') : '-'];
  // far longer than every call takes: for a computer where nothing stops one call that never returns
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120000 + calls * 20, maxBuffer: 2 ** 24 });
  if (result.error?.code === 'ETIMEDOUT' || result.signal) return { stopped: `The check was stopped: ${result.signal ? `it ended on ${result.signal}` : 'it took too long'}, so its twin doesn't return, or took the check down with it.` };
  if (result.status !== 0) throw new Error(`The check's program didn't run: ${(result.stderr || result.error?.message || `it ended with ${result.status}`).trim()}`);
  return JSON.parse(result.stdout);
}

/** What one twin's counts say: { same, why }, `why` each thing that differs, in words. */
export function verdict(result) {
  if (result.stopped) return { same: false, why: [result.stopped] };
  const why = [];
  for (const [name, said] of [['asItWas', 'from a memory as it was'], ['changed', 'from a memory changed']]) {
    const kind = result[name];
    if (!kind) continue;
    if (kind.calls < 0) return { same: false, why: ['Its contract\'s `if` took none of the registers the check tried, so nothing was called.'] };
    const all = count(kind.calls), parts = [];
    if (kind.ranOn) parts.push(`the twin didn't come back in time on ${count(kind.ranOn)}, and the check stopped there`);
    if (kind.fell) parts.push(`the twin fell over on ${count(kind.fell)}`);
    if (kind.notBack) parts.push(`the original didn't come back as a function does on ${count(kind.notBack)}`);
    if (kind.memory < kind.calls) parts.push(`the memory is the same on ${count(kind.memory)}`);
    if (kind.gives < kind.calls) parts.push(`what it gives back on ${count(kind.gives)}`);
    if (kind.hardware < kind.calls) parts.push(`what reaches the hardware on ${count(kind.hardware)}`);
    if (result.counts && kind.time < kind.calls) parts.push(`the time on ${count(kind.time)}${kind.same ? `, ${kind.least === kind.most ? `${Math.abs(kind.least)} cycles ${kind.least > 0 ? 'short' : 'over'}` : `from ${kind.least} to ${kind.most} cycles apart`} where the rest is the same` : ''}`);
    if (parts.length) why.push(`Of ${all} calls ${said}: ${parts.join('; ')}.${kind.bytes.length ? ` Bytes that differ most: ${kind.bytes.map(([at, times]) => `$${hex4(at)} ${count(times)}`).join(', ')}.` : ''}${kind.first ? ` First: ${kind.first}.` : ''}`);
    if (!kind.calls) why.push(`No call ${said} could be counted: all ${count(kind.astray)} read where nothing answers${kind.bankUnknown ? ', or a bank nothing says is at $8000 (dp:bank)' : ''}.`);
  }
  return { same: !why.length, why };
}

/**
 * Checks the twins a build has (buildCheck), all of them or `only` those named by the original's function or by the
 * twin's own name: { results, same }, each result a contract with what the check counted and its verdict.
 */
export function checkTwins({ built, copy, memories = null, calls = CALLS, seed = 1, limit = LIMIT, without = [], only = [], log = console.log }) {
  const wanted = built.contracts.filter(contract => !only.length || only.some(name => name.toLowerCase() === contract.name.toLowerCase() || new RegExp(`^${name.replace(/[^\w]/g, '')}\\s*\\(`).test(contract.call)));
  if (!wanted.length) throw new Error(`No contract is for ${only.join(' or ')}: there are contracts for ${built.contracts.map(c => c.name).join(', ')}.`);
  const results = wanted.map(contract => {
    const result = { ...contract, ...runCheck({ program: built.program, copy, memories, calls, seed, index: contract.index, limit, without }) };
    Object.assign(result, verdict(result));
    const calls_ = (result.asItWas?.calls ?? 0) + (result.changed?.calls ?? 0), astray = (result.asItWas?.astray ?? 0) + (result.changed?.astray ?? 0);
    const time = result.stopped ? '' : result.counts ? '' : ', time not counted';
    log(`${contract.name.padEnd(12)} ${contract.call}: ${result.same ? `the same on all ${count(calls_)} calls${time}` : 'differs'}${astray ? ` (${count(astray)} calls left out, which read where nothing answers)` : ''}`);
    for (const line of result.why) log(`    ${line}`);
    return result;
  });
  return { results, same: results.filter(result => result.same).length };
}

/**
 * Plays a game's recordings, or those named, in the original, and keeps its 2 KB of work memory every so many frames,
 * about `wanted` in all: the file they're in, on this computer only.
 */
export async function takeMemories({ game, original, copy, names = [], wanted = MEMORIES, file, log = console.log }) {
  const reference = await referenceOf(original);
  reference.ensureOriginal(log);
  const recordings = readRecordings(game, names), keysLate = original.keysAfterVBlank === true;
  const frames = recordings.reduce((sum, recording) => sum + Math.max(0, recording.frames - FIRST_FRAME), 0);
  const every = Math.max(1, Math.floor(frames / wanted));
  const parts = [];
  for (const recording of recordings) {
    const way = originalPlay(recording, { keysLate });
    const masks = way.originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
    if (keysLate) masks.unshift(0);
    const at = [];
    for (let frame = FIRST_FRAME; frame < recording.frames; frame += every) at.push(way.originalOf[frame] + (keysLate ? 1 : 0));
    if (!at.length) continue;
    const reads = at.flatMap(frame => Array.from({ length: WORDS }, (_, word) => ({ frame, address: word * 4, bytes: 4 })));
    const played = await reference.runOriginal({ copy, frames: masks.length + 1, buttons: masks, sets: way.sets, reads });
    const read = played.outside.reads ?? [];
    if (read.length !== reads.length) throw new Error('The program that runs the original read nothing of its memory: npm run dp -- setup builds it again.');
    parts.push(Buffer.from(Uint32Array.from(read).buffer));
    log(`  ${recording.name}: ${count(at.length)} memories`);
  }
  const all = Buffer.concat(parts);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, all);
  return all.length / RAM;
}

/**
 * The function check for an NES game's version in C, such as ghosts-n-goblins/c. `options`: `functions`, the ones to
 * check, by the original's name or the twin's; `calls` of each kind, `seed`, `limit`, the milliseconds a call may take;
 * `memories`, true or a list of recordings, to take them from play first; `from`, another folder of the game's C than
 * its own src/; `without`, bytes of the work memory left out of what's compared, to see what else differs; `log`.
 * Resolves to { results, same, tried }.
 */
export async function twin(game, options = {}) {
  const { functions = [], calls = CALLS, seed = 1, limit = LIMIT, memories = false, from = null, without = [], log = console.log } = options;
  const version = versionOf(game), original = readOriginal(game);
  if (original.console !== 'nes') throw new Error(`${game} isn't an NES game.`);
  const sources = from ? resolve(from) : join(gameFolder(version.language === 'c' ? game : `${version.game}/c`), 'src');
  if (!existsSync(sources)) throw new Error(`${inRepo(sources)} isn't there: the function check is for a game's version in C.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The function check runs ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const work = join(LOCAL, 'twin', version.game);
  const kept = join(work, 'memories.bin');
  if (memories) {
    log(`Playing ${Array.isArray(memories) && memories.length ? memories.join(', ') : 'every recording'} in the original for its memories…`);
    const taken = await takeMemories({ game, original, copy: copy.path, names: Array.isArray(memories) ? memories : [], file: kept, log });
    log(`${count(taken)} memories kept in ${inRepo(kept)}. They come from your copy of the game: never put them in a commit, an issue or a pull request.`);
  }
  // the shared libraries the version takes, whose twins are checked as its own, unless another folder is tried
  const libraries = from ? [] : versionLibraries(version.language === 'c' ? game : `${version.game}/c`, 'nes').flatMap(library => library.files.map(file => ({ file, given: library.functions, values: library.values })));
  const built = buildCheck({ rom: readFileSync(copy.path), sources, work, functions: readCodeMap(game)?.functions ?? null, libraries, log });
  const has = existsSync(kept);
  for (const note of built.notes) log(note);
  log(`${count(built.contracts.length)} twin${built.contracts.length === 1 ? ' has a contract' : 's have a contract'} in ${inRepo(sources)}. ${has ? `Each gets ${count(calls)} calls from a memory of play as it was and ${count(calls)} from one changed` : `Each gets ${count(calls)} calls from random memories: --memories takes real ones from the game's recordings`}.`);
  const { results, same } = checkTwins({ built, copy: copy.path, memories: has ? kept : null, calls, seed, limit, without, only: functions, log });
  log(`${count(same)} of ${count(results.length)} twins the same as the original on every call.${without.length ? ` Left out of what was compared: ${without.map(byte => `$${hex4(byte)}`).join(', ')}.` : ''}`);
  // which of those took every path of the original's function, which is what makes the same memory a proof
  const codeMap = readCodeMap(game), proven = [], differing = [];
  if (codeMap) {
    const of = nesInstructionsOf(codeMap, readFileSync(copy.path)), { ways: ruledOut } = readUnreachable(game);
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
      if (result.whole) proven.push({ key: functionKey(f), calls: (result.asItWas?.calls ?? 0) + (result.changed?.calls ?? 0) });
      else {
        const first = left.slice(0, 3).map(([where, how]) => `${nesName(where, banks)} ${how}`).join(', ');
        log(`${result.name} ${result.call}: the same, but its calls left out ${count(left.length)} of the original's ${count(total)} instructions and branch ways, such as ${first}: it isn't proven until calls take those too.`);
      }
    }
    if (same) log(`${count(proven.length)} of those ${count(same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  }
  const keptIn = version.language === 'c' ? game : `${version.game}/c`;
  if (!asksForProofs(keptIn)) return { results, same, tried: results.length };
  if (from || without.length) log('Nothing was kept as proven: a proof is of the game\'s own C, with every byte compared.');
  else if (calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
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
    if (arg === '--calls' || arg === '--seed' || arg === '--limit') flags[arg.slice(2)] = number(arg.slice(2), args[++i]);
    // how long one call may take as the tool says it on every console, in seconds
    else if (arg === '--seconds') flags.limit = number('seconds', args[++i]) * 1000;
    else if (arg === '--from') flags.from = args[++i];
    else if (arg === '--without') flags.without = String(args[++i] ?? '').split(',').map(byte => parseInt(byte.replace(/^\$/, ''), 16));
    else if (arg === '--memories') {
      flags.memories = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) flags.memories.push(args[++i]);
    } else if (arg.startsWith('--')) throw new Error(`${arg} isn't one of its options.\n${USAGE}`);
    else rest.push(arg);
  }
  if (flags.without?.some(byte => !(byte >= 0 && byte < RAM))) throw new Error(`--without takes bytes of the work memory, as 23,9F.\n${USAGE}`);
  if (flags.from !== undefined && (!flags.from || !existsSync(flags.from))) throw new Error(`--from takes a folder of the game's C.\n${USAGE}`);
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
