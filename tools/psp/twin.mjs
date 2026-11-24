// The function check for a PlayStation Portable game (../twin.mjs): one function of the original, run in PPSSPP's own
// interpreter (original.mjs), and its twin, built as a Dreamport to WebAssembly on the console's kit in C, are called
// from the same memory, thousands of times, with the same arguments, and what each leaves in the console's memory,
// its scratchpad and its video memory, and what each gave back, are compared byte for byte. It's the proof a twin has
// where no compiler gives the original's bytes back (docs/STANDARD.md), as on the PlayStation (../ps1/twin.mjs).
//
// The twins are built as the Game Boy Advance's are (../gba/twin.mjs, openBuild), on the console's kit in C, with the
// console's addresses given after linking. The module keeps the console's memory at the console's own addresses, as
// the kit does (kit/psp/c/memory.c), so a twin's C reads and writes an address as its original does: through the
// address itself, not through its uncached or its kernel's mirror, which a twin's module doesn't have. A twin names
// the function of the original it's the twin of in the comment just above it, as /** 0x08804120: */, or in its name,
// as sub_08804120, and a value the C names and doesn't define is the game's, at the address its proof/addresses.json
// gives, or the one in its label.
//
// A call is made as the console's compiler makes one, under the EABI the console's programs are built for: the first
// eight whole numbers and pointers in a0 to a3 and t0 to t3, each spread to 32 bits as its type says, and the first
// eight floats in the floating-point unit's f12 to f19, as their bits; sp, ra and gp as the program has them; the
// floating-point unit's control register as the console starts a program, rounding to the nearest; and any value in
// every other register, so a function that reads one it wasn't given differs. A function gives back what its C says
// in v0, or a float in f0, and keeps s0 to s7, gp, sp, fp and f20 to f31 for its caller. What a twin takes and gives
// is the compiler's word on its C (../ps2/twin.mjs, wrapOf), so a float crosses as its bits. A function that takes
// more than eight of either, or a value of 64 bits, which the console carries in two registers, isn't checked yet. The
// original's own saves below its stack aren't compared, as a twin keeps those in its own stack.
//
// What a function is given decides which of its paths run, so the check learns as it goes: the original says what each
// call read, and later calls change a few of those values. A function counts as proven only when every instruction ran
// and each branch went both ways (../lib/played.mjs). A call that reaches one of the system's functions ends there, as
// a twin asks the kit for those, and isn't compared.

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
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { decode } from '../lib/mips.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { KEPT_FROM, openBuild } from '../gba/twin.mjs';
import { TYPES, signatureOf, typeOf, wrapOf } from '../ps2/twin.mjs';
import { findFunctions, programOf, pspProgram } from './functions.mjs';
import { addressAt, CAME_BACK, ELSEWHERE, endText, EXCEPTION, FCR31, inImage, OUT_OF_STEPS, Original, RAM, regionsOf, REGISTERS, SYSTEM } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
const NO_CODE = '__twin_no_code';
/** Where a twins' module keeps its own values, above the console's memory, and how much memory it has, as a game's
 *  build has them (../lib/c.mjs). */
export const LAYOUT = { base: 0x0C000000, memory: 0x0D000000, code: address => address };
// where the module keeps what the console has nothing at, and the table its addresses are folded by
const NOWHERE = { at: 0x02000000, bytes: 0x00100000 }, TABLE = 0x02100000;

/** The table a module's addresses are folded by (../lib/wasm-fold.mjs), two words for each top byte: what to keep and
 *  where it goes. The console's memory, through each of its views, the uncached at 0x48000000 and the kernel's at
 *  0x88000000 and 0xC8000000, goes where it is, and so do the video memory, seen again every 2 MB, and the
 *  scratchpad; the module's own values and stack, from 0x0C000000, stay where they are; and every other address goes
 *  to `nowhere`, as the console has nothing there and its original met an exception, so no call is compared. */
export function foldTable() {
  const table = new Uint32Array(512);
  const set = (top, mask, start) => { table[top * 2] = mask; table[top * 2 + 1] = start; };
  for (let top = 0; top < 256; top++) set(top, NOWHERE.bytes - 1, NOWHERE.at);
  for (let top = 0x0C; top <= 0x0F; top++) set(top, 0x00FFFFFF, top << 24);
  for (const view of [0x00, 0x40, 0x80, 0xC0]) {
    set(view, 0x00FFFFFF, 0);
    set(view + 0x04, 0x001FFFFF, 0x04000000);
    for (let top = 0x08; top <= 0x0B; top++) set(view + top, 0x03FFFFFF, 0x08000000);
  }
  return table;
}

/** A version's C ready to be built for the check, as openBuild (../gba/twin.mjs) has it, on the console's kit and laid out as
 *  a game's build is, each twin called with what the compiler says it takes and gives (../ps2/twin.mjs, wrapOf). */
export const openPspBuild = options => openBuild({ ...options, console: 'psp', layout: LAYOUT, signature: signatureOf, wrap: wrapOf });

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,
  seed: 1,
  seconds: 2,
  limit: 1000000,
};
const TRIES = 4;
// where a call comes back to, in the kernel's memory, where no game has code; how far below its stack the original's
// own saves may go; and where the game's memory starts
const BACK = 0x08000100, SAVES = 0x10000, GAME = 0x08800000;
// the registers a function keeps for its caller: s0 to s7, gp, sp and fp, and the floats f20 to f31
const KEPT = [16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30], KEPT_FLOATS = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
// the registers the first eight whole numbers go in, and the first of the eight the floats go in
const ARGUMENTS = [4, 5, 6, 7, 8, 9, 10, 11], FLOAT_ARGUMENTS = 12;
// floats at the edges, as their bits: zeros, ones, halves, a half and a whole and a half more, the float just under a
// half, two, the smallest and largest ordinary ones, the tiniest of all, the largest whole number of 32 bits a float
// holds and the first it doesn't, both ways, infinities and not a number
const FLOAT_EDGES = [0, 0x80000000, 0x3F800000, 0xBF800000, 0x3F000000, 0xBF000000, 0x3FC00000, 0x40200000, 0xC0200000, 0x3EFFFFFF, 0x40000000,
  0x00800000, 0x80800000, 0x7F7FFFFF, 0xFF7FFFFF, 0x00000001, 0x4EFFFFFF, 0x4F000000, 0xCF000000, 0xCF000001, 0x7F800000, 0xFF800000, 0x7FC00000];
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(address >>> 0)}`;

/** What makes up arguments and values, the same from the same seed. `top` is where the console's memory ends. */
export function chooser(seed, top) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const below = n => next() % n;
  const number = () => [() => EDGES[below(EDGES.length)], () => below(256), next][below(3)]() >>> 0;
  // a place in the game's memory, past the first megabyte of it, where a small program's code isn't, and below the
  // check's stack, or one a call read
  const room = Math.max(0x1000, (top - GAME - 0x200000 - SAVES) >>> 2);
  const place = pointers => (pointers.length && below(2) ? pointers[below(pointers.length)] : (GAME + 0x100000 + below(room) * 4) >>> 0);
  return {
    next, below,
    value(type, pointers) {
      if (type.pointer) return place(pointers);
      if (type.boolean) return below(2);
      // a float as its bits: one at an edge, any bits at all, or an ordinary one between a 64th and 64
      if (type.float) return [() => FLOAT_EDGES[below(FLOAT_EDGES.length)], next, () => (0x3C800000 + below(0x6000000)) >>> 0][below(3)]() >>> 0;
      const value = number();
      if (type.bits === 32) return value;
      return (type.signed ? (value << (32 - type.bits)) >> (32 - type.bits) : value & (2 ** type.bits - 1)) >>> 0;
    },
    sized(bytes, pointers) {
      const value = bytes === 4 && below(4) === 0 ? place(pointers) : number();
      return bytes === 4 ? value >>> 0 : value & (2 ** (bytes * 8) - 1);
    },
  };
}

/** Each instruction of a function and, of those, the conditional branches, as offsets in it, for waysLeft. */
export function instructionsOf(program, f) {
  const { load, text } = program, instructions = new Set(), branches = new Set();
  for (let offset = 0; offset < f.size && f.address + offset + 4 <= load + text.length; offset += 4) {
    const found = decode(text.readUInt32LE(f.address + offset - load), f.address + offset, 'allegrex');
    if (!found) continue;
    instructions.add(offset);
    if (found.kind === 'branch') branches.add(offset);
  }
  return { instructions, branches };
}

/** The image every call starts from: the program where it loads, and nothing else. */
export function imageOf(program, regions) {
  const size = regions.reduce((sum, r) => sum + r.bytes, 0), image = new Uint8Array(size);
  const where = inImage(regions, program.load);
  if (where < 0 || where + program.text.length > regions[0].bytes) throw new Error(`The program loads at ${at(program.load)}, ${count(program.text.length)} bytes, outside the console's memory.`);
  image.set(program.text, where);
  return image;
}

class Runner {
  constructor(module, seconds) {
    this.module = module;
    this.seconds = seconds;
    this.image = null;
  }

  async start() {
    this.worker = new Worker(WORKER, { workerData: { module: this.module, noCode: NO_CODE, table: foldTable(), tableAt: TABLE } });
    this.waiting = null;
    this.worker.on('message', message => this.waiting?.(message));
    this.worker.on('error', error => this.waiting?.({ stopped: String(error.message ?? error) }));
    await this.next();
    if (this.image) await this.ask({ set: this.image, regions: this.regions });
  }

  next() {
    return new Promise(resolve => { this.waiting = resolve; });
  }

  ask(message) {
    const answer = this.next();
    this.worker.postMessage(message);
    return answer;
  }

  /** The compiler's word on each of a twin's types, its arguments' and then what it gives back (wrapOf). */
  async types(name, count) {
    return (await this.ask({ types: `${name}${TYPES}`, count })).types;
  }

  async set(image, regions) {
    this.image = image;
    this.regions = regions;
    if (!this.worker) await this.start();
    else await this.ask({ set: image, regions });
  }

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

async function checkFunction({ f, original, runner, program, regions, options, choose }) {
  const pool = new Map(), pointers = [], ran = new Map(), aside = {};
  const top = RAM + regions[0].bytes, stack = (top - 0x100) >>> 0;
  const inMemory = address => (address >>> 0) >= GAME && (address >>> 0) < top;
  const stops = program.imports.map(({ address }) => address);
  // the original's own saves below its stack, which a twin keeps in its own
  const skip = [[inImage(regions, stack - SAVES), inImage(regions, stack)]];
  const read = address => inMemory(address) && !(address >= stack - SAVES && address < stack) && !(address >= f.code.from && address < f.code.to);
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
    // whole numbers and pointers in a0 on, floats in f12 on, each in the order it's taken
    const integers = [], floats = [];
    f.params.forEach((type, i) => (type.float ? floats : integers).push(args[i]));
    const registers = REGISTERS.map((name, i) => {
      if (name === 'zero') return 0;
      if (name === 'sp') return stack;
      if (name === 'ra') return BACK;
      if (name === 'gp') return program.gp;
      const argument = ARGUMENTS.indexOf(i);
      return argument >= 0 && argument < integers.length ? integers[argument] : choose.next();
    });
    const fprs = Array.from({ length: 32 }, (_, i) => (i >= FLOAT_ARGUMENTS && i - FLOAT_ARGUMENTS < floats.length ? floats[i - FLOAT_ARGUMENTS] : choose.next()));
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, back: BACK, registers, floats: fprs, control: FCR31, changes, stops });
    for (const { address, bytes, value } of answer.reads) {
      // a word that points back into the function's own code is a switch's table, the compiler's and not the caller's
      if (!read(address) || (bytes === 4 && value >= f.code.from && value < f.code.to)) continue;
      pool.set(address, bytes);
      if (bytes === 4 && inMemory(value) && pointers.length < 256 && !pointers.includes(value >>> 0)) pointers.push(value >>> 0);
    }
    const reason = answer.end === CAME_BACK ? null : answer.end === SYSTEM ? 'system' : answer.end === ELSEWHERE ? 'elsewhere'
      : answer.end === EXCEPTION ? 'exception' : answer.end === OUT_OF_STEPS ? 'steps' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    const changed = KEPT.find(i => answer.registers[i] >>> 0 !== registers[i] >>> 0), changedFloat = KEPT_FLOATS.find(i => answer.floats[i] >>> 0 !== fprs[i] >>> 0);
    if (changed !== undefined || changedFloat !== undefined) {
      aside.kept = (aside.kept ?? 0) + 1;
      aside.keptText ??= changed !== undefined ? `${REGISTERS[changed]}` : `$f${changedFloat}`;
      continue;
    }
    const twin = await runner.call(f.call, args, changes, answer.chunks, skip);
    const call = { number, args, changes };
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
    if (f.returns) {
      // a float in f0, as its bits, or a whole number in v0, spread to 32 bits as its type says
      const theirs = f.returns.float ? answer.floats[0] >>> 0 : answer.registers[2] >>> 0, low = Number(twin.gave & 0xFFFFFFFFn);
      const ours = f.returns.float || f.returns.bits === 32 ? low >>> 0 : f.returns.signed ? ((low << (32 - f.returns.bits)) >> (32 - f.returns.bits)) >>> 0 : (low & (2 ** f.returns.bits - 1)) >>> 0;
      if (ours !== theirs) return { compared, aside, ran, result: { kind: 'differs', gave: { ours, theirs, float: Boolean(f.returns.float) }, ...call } };
    }
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: { ...addressAt(regions, twin.differs.at), ours: twin.differs.ours, theirs: twin.differs.theirs }, ...call } };
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

/** What a function's check came to, as { kind, line }. */
export function outcome(f, { compared, aside, result }, { calls, seconds }) {
  const byte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  if (result?.kind === 'differs') {
    const gave = result.gave ? `the twin gave back ${at(result.gave.ours)} and the original ${at(result.gave.theirs)}${result.gave.float ? ', as floats\' bits' : ''}` : null;
    const memory = result.memory ? `at ${at(result.memory.address)}, in ${result.memory.name}, the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}` : null;
    return { kind: 'differs', line: `${callText(f.name, result)}: ${[memory, gave].filter(Boolean).join(', and ')}.` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, result)}: the original came back and the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  const why = Object.entries({
    system: `the original ${aside.systemText}, which a twin asks the kit for`,
    elsewhere: `the original ${aside.elsewhereText}`,
    exception: `the original ${aside.exceptionText}`,
    steps: `the original didn't come back within ${count(DEFAULTS.limit)} instructions`,
    kept: `the original changed ${aside.keptText}, which a function keeps for its caller`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
    other: 'the original ended in a way the tools don\'t know',
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/**
 * Checks the twins of one file of C against a PlayStation Portable program, `elf`, its bytes, with `build`, as
 * openBuild gives one, `only` the address of the one function to check or null, `addressOf(name)` where the console
 * keeps a value, `sizeOf(address)` how long the original's function there is, and `original`, an Original on the same
 * program. Answers { error }, { missing }, or { functions }, each { name, address, kind, line, compared, whole, left }.
 */
export async function checkFile({ elf, build, file, only = null, addressOf, sizeOf, original, options = {}, ruledOut = new Map(), log = () => {} }) {
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
  const program = programOf(elf), regions = regionsOf(await original.ready());
  const runner = new Runner(foldAddresses(linked.module, { table: TABLE }), all.seconds);
  try {
    const image = imageOf(program, regions);
    await original.image(image, regions);
    await runner.set(image, regions);
    const choose = chooser(all.seed, RAM + regions[0].bytes);
    for (const call of linked.calls) {
      const size = sizeOf(call.address);
      if (!size) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'no function of the code map starts there' });
        continue;
      }
      // what it takes and gives, as the compiler says
      const types = (await runner.types(call.call, call.params.length + (call.returns ? 1 : 0))).map(typeOf);
      const params = types.slice(0, call.params.length), returns = call.returns ? types.at(-1) : null;
      const why = types.some(type => !type) ? 'it takes or gives something no register carries, as a struct as it is'
        : types.some(type => type.bits === 64) ? 'it takes or gives a value of 64 bits, which the console carries in two registers and the check doesn\'t give yet'
          : params.filter(type => !type.float).length > ARGUMENTS.length || params.filter(type => type.float).length > 8 ? 'it takes more than eight whole numbers or eight floats, which the check doesn\'t give yet' : null;
      if (why) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: why });
        continue;
      }
      const f = { ...call, params, returns, size, code: { from: call.address, to: call.address + size } };
      const checked = await checkFunction({ f, original, runner, program, regions, options: all, choose });
      const { kind, line } = outcome(f, checked, all);
      const { total, left } = waysLeft(instructionsOf(program, f), f.address, checked.ran, ruledOut);
      functions.push({ name: f.name, address: f.address, kind, line, compared: checked.compared, whole: kind === 'same' && !left.length, left, total });
      log(f.name);
    }
  } finally {
    await runner.close();
  }
  return { functions };
}

/** The function check of a PlayStation Portable game's version in C, as the tool runs it: 0, or 3 when a twin isn't
 *  the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the PlayStation Portable every call starts from the program as the console loads it.');
  if (all.memories !== undefined) throw new Error('--memories isn\'t there yet on the PlayStation Portable: every call starts from the program as the console loads it.');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const elf = await pspProgram(copy.path, original.sha1);

  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null) ?? (/^[A-Za-z][A-Za-z0-9]*_(0[89AB][0-9A-Fa-f]{6})$/.exec(name) ? parseInt(name.slice(-8), 16) : null);
  let chosen = files.filter(file => twinsOf.get(file).some(t => t.address !== null)), only = null;
  if (all.function) {
    const named16 = /^(?:0x)?([0-9A-Fa-f]{8})$/.exec(all.function);
    only = twins.get(all.function)?.size === 1 ? [...twins.get(all.function)][0] : named16 ? parseInt(named16[1], 16) : addressOf(all.function);
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (only === null || !chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${hex(only ?? 0x08804000)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  const sizes = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f.size]));
  const found = new Map(findFunctions(elf).map(f => [f.address, f.size]));
  const header = await twinsFolder(folder);
  const build = openPspBuild({ root: folder, files, shifts, givenOf, includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])] });
  const { ways: ruledOut } = readUnreachable(game);
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  const proven = [], differing = [];
  const caller = new Original(copy.path, log);
  try {
    for (const file of chosen) {
      const result = await checkFile({ elf, build, file, only, addressOf, sizeOf: address => sizes.get(address) ?? found.get(address) ?? null, original: caller, options: all, ruledOut });
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
        if (f.whole) proven.push({ key: hex(f.address), calls: f.compared });
        else if (['differs', 'never', 'stopped'].includes(f.kind)) differing.push(hex(f.address));
        log(`  ${LABELS[f.kind]}  ${at(f.address)} ${f.name}${f.kind === 'same' ? ', ' : ': '}${f.line}`);
        if (f.kind === 'same' && f.left.length) log(`    Its calls left out ${count(f.left.length)} of its ${count(f.total)} instructions and branch ways, such as ${f.left.slice(0, 3).map(([address, how]) => `${at(address)} ${how}`).join(', ')}: it isn't proven until calls take those too.`);
      }
    }
  } finally {
    caller.close();
  }
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as D_08804120.`);
  if (failed.length && chosen.length > 1) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, from the program as the console loads it (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven.length)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  if (!asksForProofs(game)) return totals.differs || totals.never || totals.stopped ? 3 : 0;
  if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}
