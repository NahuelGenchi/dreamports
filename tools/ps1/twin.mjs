// The function check for a PlayStation game (../twin.mjs): one function of the original, run in PCSX ReARMed's own
// interpreter (call.c, original.mjs), and its twin, built as a Dreamport to WebAssembly, are called from the same
// memory, thousands of times, with the same arguments, and what each leaves in the console's memory, its scratchpad and
// its hardware's registers, and what each gave back, are compared byte for byte. It's the proof a twin has where no
// compiler gives the original's bytes back (docs/STANDARD.md), and #1451 tried it on Mega Man 8.
//
// The twins are built as the Game Boy Advance's are (../gba/twin.mjs, openBuild), from the same C the console's
// compiler builds, on the console's kit in C, with the console's addresses given after linking, and then with every
// address the module reads or writes folded to its low 26 bits (../lib/wasm-fold.mjs), as the console's wiring folds
// them: so the C says 0x800D8408, keeps 0x80170578 in memory as a pointer and follows it, and it all lands in a module
// of 64 MB. A twin names the function of the original it's the twin of in the comment just above it, as
// /** 0x800C1234: */ or func_800C1234, and a value the C names and doesn't define is the game's, at the address its
// proof/addresses.json gives, or the one in its label, as D_800D8408.
//
// A call is made as the console's compiler makes one: the first four arguments in a0 to a3, the rest on the stack from
// 16 bytes above it, each spread to 32 bits as its type says, as a caller does; sp, ra and gp, the register the
// program reaches its small values through, as the program has them; and any value in every other register, so a
// function that reads one it wasn't given differs. A function gives back what its C says in v0. The original's own
// saves on the stack, below where the call starts it, aren't compared, as a twin keeps those in its own stack.
//
// What a function is given decides which of its paths run, so the check learns as it goes, as the Game Boy Advance's
// does: the original says what each call read, and later calls change a few of those values, mostly to numbers at the
// edges of what a value holds, and give pointers it read as arguments, but never a word that points back into the
// function's own code, which is a switch's table, the compiler's own. The same memory is a proof of the paths the
// calls took, and of no other, so the original also says which of its instructions ran and which way each branch went,
// and a function counts as proven only when every instruction ran and each branch went both ways (../lib/played.mjs).

import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameFolder, REPO } from '../lib/paths.mjs';
import { hex, readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { twinsFolder } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { openBuild } from '../gba/twin.mjs';
import { decode } from './mips.mjs';
import { exeOf, findFunctions, ps1Program } from './functions.mjs';
import { ps1Resolve } from './read.mjs';
import { addressAt, buildCaller, CACHE, CAME_BACK, ELSEWHERE, endText, EXCEPTION, IMAGE, inBios, inImage, MIRROR, Original, OUT_OF_STEPS, REGISTERS } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// what openBuild names the function a call through a pointer meets when nothing built is the twin of its address
const NO_CODE = '__twin_no_code';
// the addresses the module reads and writes, folded, and where its own values start, below the scratchpad's 0x03800000
const MASK = 0x03FFFFFF;
const LAYOUT = { base: 0x01000000, memory: 0x04000000, code: address => address };

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up arguments and values come from, so a run can be had again
  seconds: 2,        // how long a twin may take over one call
  limit: 1000000,    // how many instructions the original may run in one call
};
// how many calls may be made for each one that has to be compared
const TRIES = 4;
// where a call's stack starts, near the top of the console's memory, where it comes back to, an address in the BIOS's
// own memory where no game has code, and how far below its stack the original's own saves may go
const STACK = 0x801FFF00, BACK = 0x80001000, SAVES = 0x10000;
// the registers a function keeps for its caller: s0 to s7, gp, sp and fp
const KEPT = [16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30];
// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(address >>> 0)}`;
const inMemory = value => (value >>> 0) >= 0x80000000 && (value >>> 0) < 0x80200000;

/** What makes up arguments and values, the same from the same seed. */
export function chooser(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const below = n => next() % n;
  // a number at an edge, a small one, or any
  const number = () => [() => EDGES[below(EDGES.length)], () => below(256), next][below(3)]() >>> 0;
  // a place in the console's memory, above the program and below its stack, or one a call read
  const place = pointers => (pointers.length && below(2) ? pointers[below(pointers.length)] : (0x80100000 + below(0x38000) * 4) >>> 0);
  return {
    next, below,
    /** An argument of a type, { bits, signed, pointer }, spread to 32 bits as a caller spreads it. */
    value(type, pointers) {
      if (type.pointer) return place(pointers);
      const value = number();
      if (type.bits === 32) return value;
      return (type.signed ? (value << (32 - type.bits)) >> (32 - type.bits) : value & (2 ** type.bits - 1)) >>> 0;
    },
    /** A value of so many bytes for a place a call read. */
    sized(bytes, pointers) {
      const value = bytes === 4 && below(4) === 0 ? place(pointers) : number();
      return bytes === 4 ? value >>> 0 : value & (2 ** (bytes * 8) - 1);
    },
  };
}

/** The register the program reaches its small values through, gp: as its header says, or as its start sets it. */
export function gpOf(exe) {
  const { entry, gp, load, text } = exeOf(exe);
  if (gp) return gp;
  let high = null;
  for (let address = entry; address < entry + 64 * 4 && address + 4 <= load + text.length; address += 4) {
    const found = decode(text.readUInt32LE(address - load), address);
    if (found?.name === 'lui' && found.rt === 28) high = found.imm << 16;
    else if (high !== null && found?.writes === 28 && found.rs === 28 && (found.name === 'addiu' || found.name === 'ori')) return (found.name === 'ori' ? high | found.imm : high + found.imm) >>> 0;
  }
  return 0;
}

/** Each instruction of a function and, of those, the conditional branches, as offsets in it, for waysLeft. */
export function instructionsOf(exe, f) {
  const { load, text } = exeOf(exe), instructions = new Set(), branches = new Set();
  for (let offset = 0; offset < f.size && f.address + offset + 4 <= load + text.length; offset += 4) {
    const found = decode(text.readUInt32LE(f.address + offset - load), f.address + offset);
    if (!found) continue;
    instructions.add(offset);
    if (found.kind === 'branch') branches.add(offset);
  }
  return { instructions, branches };
}

/** The image every call starts from: the program where it loads, and nothing else. */
export function imageOf(exe) {
  const { load, text } = exeOf(exe), image = new Uint8Array(IMAGE);
  if (inImage(load) < 0 || inImage(load) + text.length > 0x200000 || (load >>> 0) + text.length > STACK - SAVES) throw new Error(`The program loads at ${at(load)}, ${count(text.length)} bytes, where the check's stack can't be.`);
  image.set(text, inImage(load));
  return image;
}

// The thread that runs the twins of one module, started again when a twin doesn't come back in time.
class Runner {
  constructor(module, seconds) {
    this.module = module;
    this.seconds = seconds;
    this.image = null;
  }

  async start() {
    this.worker = new Worker(WORKER, { workerData: { module: this.module, mask: MASK, noCode: NO_CODE } });
    this.waiting = null;
    this.worker.on('message', message => this.waiting?.(message));
    this.worker.on('error', error => this.waiting?.({ stopped: String(error.message ?? error) }));
    await this.next();
    if (this.image) await this.ask({ set: this.image });
  }

  next() {
    return new Promise(resolve => { this.waiting = resolve; });
  }

  ask(message) {
    const answer = this.next();
    this.worker.postMessage(message);
    return answer;
  }

  async set(image) {
    this.image = image;
    if (!this.worker) await this.start();
    else await this.ask({ set: image });
  }

  /** A twin's call: { gave, differs }, { stopped }, or { never: true } when it was still going after its seconds. */
  async call(name, args, changes, chunks, skip) {
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ never: true }), this.seconds * 1000); });
    const answer = await Promise.race([this.ask({ call: name, args, changes, chunks, skip }), late]);
    clearTimeout(timer);
    if (answer.never) {
      await this.worker.terminate();
      await this.start();
    }
    return answer;
  }

  close() {
    return this.worker?.terminate();
  }
}

/**
 * Calls one function of the original and its twin until `options.calls` calls were compared, each from the image with
 * a few values changed. `f` is { name, address, size, params, returns, call }. Answers what the check came to:
 * { compared, aside, ran, result }, `result` null while every call compared was the same, or what wasn't.
 */
async function checkFunction({ f, original, runner, gp, options, choose }) {
  const pool = new Map(), pointers = [], ran = new Map(), aside = {};
  const extra = Math.max(0, f.params.length - 4);
  // the original's own saves below its stack, and what's above it that the call is given and may change: its
  // arguments' place, 16 bytes, and those on the stack
  const skip = [[inImage(STACK - SAVES), inImage(STACK) + 16 + 4 * extra]];
  const read = address => inMemory(address) && !(address >= STACK - SAVES && address < STACK + 16 + 4 * extra) && !(address >= f.code.from && address < f.code.to);
  let compared = 0, number = 0;
  while (compared < options.calls && number < options.calls * TRIES) {
    number++;
    const args = f.params.map(type => choose.value(type, pointers));
    const changes = [];
    if (pool.size && choose.below(2)) {
      const places = [...pool];
      for (let k = 1 + choose.below(3); k; k--) {
        const [address, bytes] = places[choose.below(places.length)];
        changes.push([address, bytes, choose.sized(bytes, pointers)]);
      }
    }
    args.slice(4).forEach((value, i) => changes.push([STACK + 16 + 4 * i, 4, value]));
    const registers = REGISTERS.map((name, i) => (name === 'zero' ? 0 : name === 'sp' ? STACK : name === 'ra' ? BACK : name === 'gp' ? gp : i >= 4 && i < 8 ? args[i - 4] ?? choose.next() : choose.next()));
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, registers, changes });
    for (const { address, bytes, value } of answer.reads) {
      // a word that points back into the function's own code is a switch's table, the compiler's and not the caller's
      if (!read(address) || (bytes === 4 && value >= f.code.from && value < f.code.to)) continue;
      pool.set(address, bytes);
      if (bytes === 4 && inMemory(value) && pointers.length < 256 && !pointers.includes(value >>> 0)) pointers.push(value >>> 0);
    }
    const reason = answer.end === CAME_BACK ? null
      : answer.end === ELSEWHERE ? (inBios(answer.detail) ? 'bios' : 'elsewhere')
        : answer.end === EXCEPTION ? 'exception' : answer.end === OUT_OF_STEPS ? 'steps' : answer.end === CACHE ? 'cache' : answer.end === MIRROR ? 'mirror' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    if (answer.gte) {
      aside.gte = (aside.gte ?? 0) + 1;
      continue;
    }
    const changed = KEPT.find(i => answer.registers[i] >>> 0 !== registers[i] >>> 0);
    if (changed !== undefined) {
      aside.kept = (aside.kept ?? 0) + 1;
      aside.keptText ??= `$${REGISTERS[changed]}`;
      continue;
    }
    const twin = await runner.call(f.call, args, changes, answer.chunks, skip);
    const call = { number, args, changes, hardware: answer.hardware };
    if (twin.never) return { compared, aside, ran, result: { kind: 'never', ...call } };
    if (twin.stopped === 'unbuilt') {
      aside.unbuilt = (aside.unbuilt ?? 0) + 1;
      aside.unbuiltText ??= twin.unbuilt;
      continue;
    }
    if (twin.stopped === 'mismatch') {
      aside.mismatch = (aside.mismatch ?? 0) + 1;
      continue;
    }
    if (twin.stopped) return { compared, aside, ran, result: { kind: 'stopped', why: twin.stopped, ...call } };
    const v0 = answer.registers[2] >>> 0;
    if (f.returns && twin.gave !== v0) return { compared, aside, ran, result: { kind: 'differs', gave: { ours: twin.gave, theirs: v0 }, ...call } };
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: { ...addressAt(twin.differs.at), ours: twin.differs.ours, theirs: twin.differs.theirs }, ...call } };
    compared++;
    answer.ran.forEach((ways, i) => { if (ways) ran.set(f.address + i * 4, (ran.get(f.address + i * 4) ?? 0) | ways); });
  }
  return { compared, aside, ran, result: null };
}

/** A call as a line says it: its number, the function with what it was given, and what was changed for it. */
export function callText(name, { number, args, changes }) {
  const set = changes.length ? `, after ${changes.map(([address, bytes, value]) => `${at(address)} was set to 0x${(value >>> 0).toString(16).toUpperCase().padStart(bytes * 2, '0')}`).join(' and ')}` : '';
  return `call ${count(number)}, ${name}(${args.map(at).join(', ')})${set}`;
}

/** What a function's check came to, as { kind, line }: `kind` is 'same', 'differs', 'never', 'stopped', 'few' or
 *  'unchecked', and `line` what to say after its address and name. */
export function outcome(f, { compared, aside, result }, { calls, seconds }) {
  const byte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const hardware = result?.hardware ? ' The original used the hardware\'s registers in this call, which are compared as memory.' : '';
  if (result?.kind === 'differs') {
    const gave = result.gave ? `the twin gave back ${at(result.gave.ours)} and the original ${at(result.gave.theirs)}` : null;
    const memory = result.memory ? `at ${at(result.memory.address)}, in ${result.memory.name}, the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}` : null;
    return { kind: 'differs', line: `${callText(f.name, result)}: ${[memory, gave].filter(Boolean).join(', and ')}.${hardware}` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, result)}: the original came back and the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  // what kept the rest from being compared, the most common first
  const why = Object.entries({
    bios: `the original went into the BIOS, which a twin asks the kit for (${aside.biosText})`,
    elsewhere: `the original ${aside.elsewhereText}`,
    exception: `the original ${aside.exceptionText}, where the console stops`,
    steps: `the original didn't come back within ${count(DEFAULTS.limit)} instructions`,
    cache: 'the original isolated the cache, as the BIOS does to clear it',
    mirror: `the original ${aside.mirrorText}`,
    gte: 'the original used the geometry processor, which no twin is given yet',
    kept: `the original changed ${aside.keptText}, which a function keeps for its caller`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/**
 * Checks the twins of one file of C against a PlayStation program, `exe`, its bytes, with `build`, as openBuild gives
 * one, `only` the address of the one function to check or null, `addressOf(name)` where the console keeps a value,
 * and `sizeOf(address)` how long the original's function there is. Answers { error }, { missing }, or { functions },
 * each { name, address, kind, line, compared, whole, left }.
 */
export async function checkFile({ exe, build, file, only = null, addressOf, sizeOf, original, options = {}, ruledOut = new Map(), log = () => {} }) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const linked = await build.link({ file, only, addressOf });
  if (linked.error) return { error: linked.error };
  if (linked.missing.length) return { missing: linked.missing };
  const functions = [];
  for (const twin of linked.unit.twins) {
    if (twin.address === null || (only !== null && twin.address !== only)) {
      if (twin.address === null && only === null) functions.push({ name: twin.name, address: null, line: twin.line });
      continue;
    }
    if (linked.unit.unknown.includes(twin.name)) functions.push({ name: twin.name, address: twin.address, kind: 'unchecked', line: 'it takes or gives something whole words can\'t carry, as a struct as it is' });
  }
  const runner = new Runner(foldAddresses(linked.module, MASK), all.seconds);
  try {
    const image = imageOf(exe);
    await original.image(image);
    await runner.set(image);
    const choose = chooser(all.seed), gp = gpOf(exe);
    for (const call of linked.calls) {
      const size = sizeOf(call.address);
      if (!size) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'no function of the code map starts there' });
        continue;
      }
      const f = { ...call, size, code: { from: call.address, to: call.address + size } };
      const checked = await checkFunction({ f, original, runner, gp, options: all, choose });
      const { kind, line } = outcome(f, checked, all);
      const { total, left } = waysLeft(instructionsOf(exe, f), f.address, checked.ran, ruledOut);
      functions.push({ name: f.name, address: f.address, kind, line, compared: checked.compared, whole: kind === 'same' && !left.length, left, total });
      log(f.name);
    }
  } finally {
    await runner.close();
  }
  return { functions };
}

/** The function check of a PlayStation game's version in C, as the tool runs it: 0, or 3 when a twin isn't the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  // a game's name alone means its version in C
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.memories) throw new Error('--memories isn\'t there yet on the PlayStation: every call starts from the program as the console loads it.');
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the PlayStation every call starts from the program as the console loads it.');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const exe = await ps1Program(copy.path);

  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  // a value is the game's, at the address its proof/addresses.json gives, a twin's, or the one in its label
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null) ?? (/^[A-Za-z][A-Za-z0-9]*_(80[0-7][0-9A-Fa-f]{5})$/.exec(name) ? parseInt(name.slice(-8), 16) : null);
  let chosen = files.filter(file => twinsOf.get(file).some(t => t.address !== null)), only = null;
  if (all.function) {
    only = twins.get(all.function)?.size === 1 ? [...twins.get(all.function)][0] : ps1Resolve(game, codeMap, all.function).address;
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${hex(only)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  const sizes = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f.size]));
  const found = new Map(findFunctions(exe).map(f => [f.address, f.size]));
  const header = await twinsFolder(folder);
  const build = openBuild({ root: folder, files, shifts, givenOf, console: 'ps1', layout: LAYOUT, includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])] });
  const { ways: ruledOut } = readUnreachable(game);
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  let proven = 0;
  const caller = new Original(buildCaller(log));
  try {
    for (const file of chosen) {
      const result = await checkFile({ exe, build, file, only, addressOf, sizeOf: address => sizes.get(address) ?? found.get(address) ?? null, original: caller, options: all, ruledOut });
      const where = inRepo(file);
      if (result.error) {
        const said = result.error.split('\n');
        if (chosen.length === 1) log(`${where}\n  Didn't build: ${said.join('\n  ')}`);
        failed.push(`${where}: ${said.find(line => /error/.test(line)) ?? said[0]}`);
        continue;
      }
      if (result.missing) {
        log(`${where}\n  Not checked: no address for ${result.missing.join(', ')}`);
        for (const name of result.missing) unnamed.add(name);
        continue;
      }
      if (!result.functions.length) continue;
      log(where);
      for (const f of result.functions) {
        if (f.address === null) {
          log(`  No address  ${f.name}${f.line ? `, line ${f.line}` : ''}: the comment above it names the function of the original it's the twin of`);
          continue;
        }
        totals[f.kind]++;
        if (f.whole) proven++;
        log(`  ${LABELS[f.kind]}  ${at(f.address)} ${f.name}${f.kind === 'same' ? ', ' : ': '}${f.line}`);
        if (f.kind === 'same' && f.left.length) log(`    Its calls left out ${count(f.left.length)} of its ${count(f.total)} instructions and branch ways, such as ${f.left.slice(0, 3).map(([address, how]) => `${at(address)} ${how}`).join(', ')}: it isn't proven until calls take those too.`);
      }
    }
  } finally {
    caller.close();
  }
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as D_800D8408.`);
  if (failed.length && chosen.length > 1) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, from the program as the console loads it (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  if (asksForProofs(game)) log('Nothing was kept as proven: a PlayStation version\'s proofs aren\'t kept in its proofs.json yet (#1558).');
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}

