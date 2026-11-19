// The function check for a Game Boy Advance game (../twin.mjs): one function of the original, in the reference
// emulator (call.c), and its twin, built as a Dreamport to WebAssembly, are called from the same memory, thousands of
// times, with the same arguments, and what each leaves in the console's memory and gives back is compared byte for
// byte. It's the proof a twin has when no compiler gives the original's bytes back (docs/STANDARD.md).
//
// The twins are built from the same C the console's compiler builds, with the compiler `npm ci` brings, and then
// given the console's addresses (../lib/wasm-addresses.mjs): each value they name sits where the console has it, a
// function's address is the original's, and a call through a pointer finds the twin. They're built on the console's
// kit, the folders and sources the game's own build takes (../lib/c.mjs), so a twin's hardware work is the kit's and
// what it leaves in the kit's video memory, colours and sprites is what's compared. Each file is built once, and a
// file's check links it with the files that define what it names, found by what each one built says it defines.
//
// What a function is given decides which of its paths run, so the check learns as it goes. The program that calls
// the original says which values each call read from memory and which numbers it compared with or loaded, and the
// calls after it change those values, mostly to those numbers and the ones beside them, so a `>` written as `>=`
// meets the one value that tells them apart.
//
// Every call starts from the memory the original has a few hundred frames after power-on, unless the check is given
// memories of play (twin-memories.mjs, --memories): the console's memory as it was each time a function started in
// one of the game's recordings, with what it was given. A function's calls then start from its own, as they were and
// with what it reads changed, and go on from what each leaves, so one that reads what only play sets up is checked.
//
// The same memory is a proof of the paths the calls took, and of no other. So the program also says which of the
// function's own instructions each call ran and which way each went on, and a function counts as proven only when,
// over the calls compared, every instruction of the original's ran and each of its branches went both ways
// (pathsLeft). One whose calls left a path out is said to be the same as far as they went, with the first of what
// never ran. In a version that keeps its proofs (../lib/proofs.mjs), each function proven is kept there as proven by
// the same memory, and one that differs loses that line. Only this tool and `match` write them.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { hex, readCodeMap, readOriginal, readRecordings } from '../lib/proof-files.mjs';
import { originalPlay } from '../lib/recording.mjs';
import { copyWith } from '../lib/copies.mjs';
import { cKit, SAME_FLAGS, twinsFolder, WASM_FLAGS } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { NOT_TAKEN, TAKEN, WENT_ELSEWHERE, WENT_ON, instructionsOf, readUnreachable, waysLeft } from '../lib/played.mjs';
import { namesOf, placeAddresses } from '../lib/wasm-addresses.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { resolve } from '../read.mjs';
import { build, CALLER, isBuilt, isCallerBuilt } from './build.mjs';
import { looksLikeArm, withLongJumps } from './functions.mjs';
import { readCopy } from './header.mjs';
import { KEY } from './original.mjs';
import { addressFinder, twinsIn } from './match.mjs';
import { addressAt, CARTRIDGE, IMAGE, inImage, REGIONS } from './twin-memory.mjs';
import { hasMemories, memoriesKey, openMemories, takeMemories } from './twin-memories.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// the names the check adds to a module: what calls a twin, what finds the twin of an address, and what's called for an
// address with no twin
const CALL = '__twin_call_', CODE = '__twin_code', NO_CODE = '__twin_no_code';
// the module's own values and stack go above everything the console has, so they're never in its way
const OWN_BASE = 0x0A000000;
// How a twin is built: as the game's own build builds C, with what its console's compiler takes for granted, which
// the kit names (cKit's twinFlags). What's the check's own: GNU C, which C written for the console's compiler is, and
// no warnings, which are the game's build's to give.
const flagsFor = kit => [...WASM_FLAGS, '-std=gnu11', ...SAME_FLAGS, ...kit.twinFlags, '-w', '-Wno-int-conversion'];
// where the compiler finds the kit's folders and any other folder outside the C's own, beside the C: the compiler
// `npm ci` brings doesn't find a file through a folder above
const KIT = '__kit', ELSEWHERE = '__from';
// what of the kit the thread that runs the twins reaches by name: its video memory, colours and sprites, and the copy
// and where the module's own values are, which the kit's and the version's hardware are among (twin-worker.mjs)
const KIT_NAMES = [...REGIONS.filter(region => region.kit).map(region => region.kit), 'kit_copy', 'kit_copy_size', '__global_base', '__data_end', 'console_io'];
// how many bytes of the hardware's registers call.c gives, which a version that keeps the console's registers itself,
// in its own console_io, is given before each call (#1527)
const REGISTERS = 0x400;
// the display's status, and its bit that says the display is in the V-blank
const DISPSTAT = 0x04000004, DISPSTAT_VBLANK = 1;
// whether some code keeps a word beside it, where words start
const holdsWord = (bytes, word) => {
  for (let at = 0; at + 4 <= bytes.length; at += 4) if (bytes.readUInt32LE(at) === word) return true;
  return false;
};

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up arguments and values come from, so a run can be had again
  frames: 600,       // how long the original plays from power-on before the first call
  seconds: 2,        // how long a twin may take over one call
  limit: 500000,     // how many instructions the original may run in one call
  changes: true,     // whether what a function reads is changed between calls
  aim: true,         // whether calls are aimed at the branch ways no call took yet, when changes are made
};
// how many calls may be made for each one that has to be compared, and how many with nothing compared before a
// function is given up on
const TRIES = 4, HOPELESS = 400;
// how call.c sends a comparison: four words, then each value's origin, three words and six steps of two
const ORIGIN_BYTES = 4 * (2 + 2 * 6), AIM_BYTES = 16 + 2 * ORIGIN_BYTES;
// after how many calls compared, and every how many, a function's branch ways no call took are worked out to aim
// calls at; how many calls to keep as witnesses to each; and how many aimed calls each gets before it's left
const AIM_AFTER = 10, AIM_EVERY = 50, WITNESSES = 8, AIM_TRIES = 48;
// the fewest calls of a function a proof by the same memory is made of
export const KEPT_FROM = 1000;
// how often the memory goes back to how the original left it: after this many calls, or this many in a row that
// couldn't be compared, so made-up values don't pile up until nothing runs any more
const FRESH_EVERY = 256, FRESH_AFTER = 12;
// how many calls in a row that couldn't be compared, each after a value was changed, before that value is left alone
const BLAMED = 6;

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(address >>> 0)}`;

/** Builds the program that calls the original's functions if it isn't built yet. */
export function ensureCaller(log) {
  if (!isBuilt() || !isCallerBuilt()) build(log);
}

// ---------------------------------------------------------------------------------------------------------------
// The original: the program that calls its functions, kept running, asked and answered in turn (call.c).

class Original {
  constructor(copy) {
    this.child = spawn(CALLER, [copy], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.held = [];
    this.bytes = 0;
    this.said = '';
    this.wake = null;
    this.over = null;
    this.child.stdout.on('data', chunk => {
      this.held.push(chunk);
      this.bytes += chunk.length;
      this.wake?.();
    });
    this.child.stderr.on('data', chunk => { this.said += chunk; });
    this.child.stdin.on('error', () => {});
    const end = error => {
      this.over ??= error;
      this.wake?.();
    };
    this.child.on('error', error => end(new Error(`The program that calls the original's functions didn't run: ${error.message}`)));
    this.child.on('close', () => end(new Error(`The program that calls the original's functions stopped${this.said.trim() ? `: ${this.said.trim()}` : '.'}`)));
  }

  // the next `n` bytes it says
  async take(n) {
    while (this.bytes < n) {
      if (this.over) throw this.over;
      await new Promise(done => { this.wake = done; });
      this.wake = null;
    }
    const all = this.held.length === 1 ? this.held[0] : Buffer.concat(this.held);
    this.held = all.length > n ? [all.subarray(n)] : [];
    this.bytes = all.length - n;
    return all.subarray(0, n);
  }

  ask(letter, numbers = [], more = null) {
    const message = Buffer.alloc(1 + 4 * numbers.length);
    message.write(letter, 0, 'latin1');
    numbers.forEach((number, i) => message.writeUInt32LE(number >>> 0, 1 + 4 * i));
    this.child.stdin.write(more ? Buffer.concat([message, more]) : message);
  }

  async play(frames) {
    this.ask('f', [frames]);
    await this.take(4);
  }

  /** Where a call's stack starts and how long the cartridge is. */
  async about() {
    this.ask('i');
    const said = await this.take(8);
    return { stack: said.readUInt32LE(0), cartridge: said.readUInt32LE(4) };
  }

  /** The hardware's registers as the console has them now, which each call starts from: 1 KB, each halfword at its
   *  distance from 0x04000000. */
  async registers() {
    this.ask('r');
    return Buffer.from(await this.take(REGISTERS));
  }

  /** The console's memory, as an image. */
  async image() {
    this.ask('m');
    return Buffer.from(await this.take(IMAGE));
  }

  async set(image) {
    this.ask('s', [], image);
    await this.take(4);
  }

  /** The stack the calls after this start on: an address, or 0 for the game's own. */
  async top(address) {
    this.ask('t', [address]);
    await this.take(4);
  }

  /** The functions to see start in play, by their addresses. */
  async watch(addresses) {
    this.ask('w', [addresses.length, ...addresses]);
    await this.take(4);
  }

  /** Plays from power-on, `buttons` the bits held at each frame and `sets` the values written to the work memory as a
   *  frame starts, and gives `each` every memory of play call.c answers: { which, frame, time, registers, stack, image },
   *  the image only until `each` comes back. */
  async playFor({ buttons, sets = [] }, each) {
    this.ask('p', [buttons.length, ...buttons, sets.length, ...sets.flatMap(({ frame, address, bytes, value }) => [frame, address, bytes, value])]);
    for (;;) {
      const which = (await this.take(4)).readUInt32LE(0);
      if (which === 0xFFFFFFFF) {
        await this.take(4);
        return;
      }
      const head = await this.take(28);
      const [frame, time, r0, r1, r2, r3, stack] = Array.from({ length: 7 }, (_, i) => head.readUInt32LE(i * 4));
      each({ which, frame, time, registers: [r0, r1, r2, r3], stack, image: await this.take(IMAGE) });
    }
  }

  /** Takes the last call back, with what was changed for it. */
  async undo() {
    this.ask('u');
    await this.take(4);
  }

  /** One call, as call.c answers it: how it `ended`, what it `gave`, the `hardware` it used, where it `leftFor`, the
   *  values it read, the numbers it loaded, the `pairs` of values it compared, each stretch of the image it changed,
   *  and, of the `span` bytes the function is long, each instruction that `ran`, with the ways it went on. `spare` is
   *  what the registers no argument fills hold, 0 unless given. */
  async call({ address, span = 0, args, changes, limit, spare = [], unaligned = false }) {
    // a twin that says it follows reads and writes where no halfword or word starts has those calls compared
    if (Boolean(unaligned) !== Boolean(this.unaligned)) {
      this.ask('a', [unaligned ? 1 : 0]);
      await this.take(4);
      this.unaligned = Boolean(unaligned);
    }
    const registers = [0, 1, 2, 3].map(i => args[i] ?? spare[i] ?? 0), onStack = args.slice(4);
    this.ask('c', [address, span, ...registers, limit, onStack.length, ...onStack, changes.length, ...changes.flat()]);
    const head = await this.take(36);
    const [ended, gave, steps, hardware, leftFor, readCount, numberCount, pairCount, runCount] = Array.from({ length: 9 }, (_, i) => head.readUInt32LE(i * 4));
    const lists = await this.take(readCount * 8 + numberCount * 4 + pairCount * 8);
    const reads = Array.from({ length: readCount }, (_, i) => [lists.readUInt32LE(i * 8), lists.readUInt32LE(i * 8 + 4)]);
    const numbers = Array.from({ length: numberCount }, (_, i) => lists.readUInt32LE(readCount * 8 + i * 4));
    const pairs = Array.from({ length: pairCount }, (_, i) => [lists.readUInt32LE(readCount * 8 + numberCount * 4 + i * 8), lists.readUInt32LE(readCount * 8 + numberCount * 4 + i * 8 + 4)]);
    const runs = [];
    for (let i = 0; i < runCount; i++) {
      const run = await this.take(8);
      const where = run.readUInt32LE(0), length = run.readUInt32LE(4);
      runs.push({ at: where, bytes: Buffer.from(await this.take(length)) });
    }
    // each of the function's own instructions that ran, with the ways it went on (call.c)
    const ranCount = (await this.take(4)).readUInt32LE(0), list = await this.take(ranCount * 8);
    const ran = Array.from({ length: ranCount }, (_, i) => [list.readUInt32LE(i * 8), list.readUInt32LE(i * 8 + 4)]);
    // each comparison of the function's own, with where its two values came from (call.c), to aim later calls with
    const aimCount = (await this.take(4)).readUInt32LE(0), kept = await this.take(aimCount * AIM_BYTES);
    const origin = at => {
      const head = kept.readUInt32LE(at);
      return {
        kind: head & 0xFF, bytes: head >>> 8 & 0xFF, where: kept.readUInt32LE(at + 4),
        steps: Array.from({ length: head >>> 16 }, (_, i) => [kept.readUInt32LE(at + 8 + i * 8), kept.readUInt32LE(at + 12 + i * 8)]),
      };
    };
    const compares = Array.from({ length: aimCount }, (_, i) => ({
      pc: kept.readUInt32LE(i * AIM_BYTES), test: kept.readUInt32LE(i * AIM_BYTES + 4) === 1,
      a: kept.readUInt32LE(i * AIM_BYTES + 8), b: kept.readUInt32LE(i * AIM_BYTES + 12),
      from: [origin(i * AIM_BYTES + 16), origin(i * AIM_BYTES + 16 + ORIGIN_BYTES)],
    }));
    return { ended, gave, steps, hardware, leftFor, reads, numbers, pairs, runs, ran, compares };
  }

  close() {
    this.over ??= new Error('The program that calls the original\'s functions was closed.');
    this.child.stdin.end();
    this.child.kill();
  }
}

/** Starts the program that calls the original's functions, with the contributor's copy, at power-on. */
export const openCaller = copy => new Original(copy);

/** Starts the original from the contributor's copy and plays it `frames` frames from power-on. Answers what calls it
 *  and the memory it had then, which every file's check starts from. */
export async function openOriginal(copy, frames) {
  const original = new Original(copy);
  await original.play(frames);
  return { original, start: await original.image(), ...(await original.about()) };
}

// ---------------------------------------------------------------------------------------------------------------
// The twins: a thread that runs the module (twin-worker.mjs), stopped and started again when a twin doesn't come back.

class Twins {
  constructor({ module, copy, seconds, registers = null }) {
    Object.assign(this, { module, copy, seconds, registers, worker: null, waiting: null });
  }

  async start(image) {
    this.stop();
    this.worker = new Worker(WORKER, { workerData: { module: this.module, copy: this.copy, noCode: NO_CODE, registers: this.registers } });
    this.worker.on('message', message => this.waiting?.(message));
    this.worker.on('error', error => this.waiting?.({ broken: String(error.message ?? error) }));
    const ready = await new Promise(done => { this.waiting = done; });
    if (ready.broken) throw new Error(`The twins' module didn't start: ${ready.broken}`);
    await this.set(image);
  }

  async said(message, seconds = 0) {
    let timer;
    const answer = await new Promise(done => {
      this.waiting = done;
      if (seconds) timer = setTimeout(() => done({ never: true }), seconds * 1000);
      this.worker.postMessage(message);
    });
    clearTimeout(timer);
    this.waiting = null;
    if (answer.broken) throw new Error(`The twins' module stopped: ${answer.broken}`);
    return answer;
  }

  set(image) {
    return this.said({ set: image });
  }

  /** One call of a twin: { gave, image }, { stopped, unbuilt } or { never: true }, after which the thread has gone
   *  and `start` makes another. */
  async call(name, args, changes) {
    const answer = await this.said({ call: name, args, changes }, this.seconds);
    if (answer.never) this.stop();
    return answer;
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Building the twins.

// a folder's C, as the folders of names and bytes the compiler is given: every folder under it, or only its own files
function treeOf(folder, deep = true) {
  const files = {};
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (deep && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'proof') files[entry.name] = treeOf(join(folder, entry.name));
    } else if (/\.(c|h|inc)$/.test(entry.name)) files[entry.name] = readFileSync(join(folder, entry.name));
  }
  return files;
}

let clang = null;
// the compiler `npm ci` brings, ready
async function compiler() {
  if (!clang) {
    try {
      clang = await import('@yowasp/clang');
    } catch {
      throw new Error('The compiler for WebAssembly isn\'t here: run npm ci in the repository\'s folder first.');
    }
    await clang.runLLVM(null, {}, { fetchProgress: () => {} });
  }
  return clang;
}

// one run of the compiler: { made }, the file it was asked for, or { error }, what it said
async function compile(args, files, out) {
  const { runClang } = await compiler();
  let said = '', built;
  const stderr = bytes => { if (bytes) said += Buffer.from(bytes).toString('utf8'); };
  try {
    built = await runClang(['clang', ...args, '-o', out], files, { stdout: stderr, stderr });
  } catch (error) {
    return { error: (said.trim() || String(error.message ?? error).trim()).replace(/In file included from __twin_unit\d+\.c:1:\n/g, '') };
  }
  return built?.[out] ? { made: built[out] } : { error: said.trim() || 'the compiler wrote nothing.' };
}

// Each console's kit, built once for every check this program makes: its folders as the compiler is given them, how
// they're named to it, each of its sources built by itself, and every name those define.
const kits = new Map();
function kitBuilt(id) {
  if (!kits.has(id)) {
    kits.set(id, (async () => {
      const kit = cKit(id), flags = flagsFor(kit);
      const tree = Object.fromEntries(kit.folders.map((folder, i) => [String(i), treeOf(folder, false)]));
      const includes = kit.folders.flatMap((_, i) => ['-I', `${KIT}/${i}`]);
      const objects = {}, defines = new Set();
      for (const source of kit.sources) {
        const name = `${KIT}_${Object.keys(objects).length}.o`;
        const built = await compile([...flags, ...includes, '-c', `${KIT}/${kit.folders.findIndex(folder => !relative(folder, dirname(source)))}/${basename(source)}`], { [KIT]: tree }, name);
        if (built.error) throw new Error(`The kit didn't build for the function check:\n${built.error}`);
        objects[name] = built.made;
        for (const defined of namesOf(built.made).defines) defines.add(defined);
      }
      return { flags, tree, includes, objects, defines };
    })());
  }
  return kits.get(id);
}

// how many bits a type written with one of C's own names or the usual short ones holds, and whether it has a sign:
// anything else, a pointer among them, is a whole word
function typeOf(text) {
  const type = text.replace(/\b(const|volatile|register|static|inline|extern)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (type.includes('*') || type.includes('[') || type.includes('(')) return { bits: 32, signed: false, pointer: true };
  if (/^(u8|bool8|uint8_t|unsigned char|char)\b/.test(type)) return { bits: 8, signed: false };
  if (/^(s8|int8_t|signed char)\b/.test(type)) return { bits: 8, signed: true };
  if (/^(u16|uint16_t|unsigned short( int)?)\b/.test(type)) return { bits: 16, signed: false };
  if (/^(s16|int16_t|(signed )?short( int)?)\b/.test(type)) return { bits: 16, signed: true };
  return { bits: 32, signed: false, pointer: !/^(u32|s32|bool32|uint32_t|int32_t|int|long|unsigned|signed|(un)?signed (int|long))\b/.test(type) };
}

/** What a function of a file of C takes and gives back, { params: [{ bits, signed, pointer }], returns: the same or
 *  null for nothing }, or null when the file has no function of that name. */
export function signatureOf(text, name) {
  // with every comment blanked, so nothing in one reads as code
  const code = text.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
  const found = new RegExp(`(?:^|[;}\\n])([^;{}()=#]*)\\b${name}\\s*\\(((?:[^(){};]|\\([^(){};]*\\))*)\\)\\s*\\{`).exec(code);
  if (!found) return null;
  const params = [];
  let depth = 0, each = '';
  for (const c of `${found[2]},`) {
    if (c === ',' && !depth) {
      if (each.trim() && each.trim() !== 'void') params.push(typeOf(each.trim().replace(/\b[A-Za-z_]\w*\s*$/, m => (/^(char|short|int|long|unsigned|signed|void)\s*$/.test(m) ? m : ''))));
      each = '';
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    each += c;
  }
  const gives = found[1].replace(/\b(static|inline|extern)\b/g, ' ').trim();
  return { params, returns: /^void$/.test(gives) ? null : typeOf(gives) };
}

// Where a module's own values and stack go, how much memory it has, and how the original keeps a function's address,
// on the Game Boy Advance: above everything the console has, as much as the linker says, and odd for Thumb code.
const GBA_LAYOUT = { base: OWN_BASE, memory: null, code: address => address | 1 };

/**
 * A version's C, ready to be built for the check a file at a time, each file once however many checks link it.
 *   root: the folder the C is in, and includes: the folders it includes from, besides the kit's
 *   files: every .c file of the version, where what a file names and doesn't define is looked for
 *   console: whose kit it's built on, and whose names its comments use
 *   layout: { base, memory, code, own }, where the module's own values start, how many bytes of memory it has, or null
 *     for as many as the linker says, how the original keeps a function's address: another console's (../ps1/twin.mjs),
 *     and the address below which a function's address is the module's own, 0x02000000 unless said
 *   signature(text, name): what a twin takes and gives, as signatureOf says it, and wrap(call): the line of C that
 *     calls it from the check, for a console whose calls carry more than whole words (../ps2/twin.mjs)
 *   shifts: how far the labels' release is from the copy (portmap.mjs)
 *   givenOf(file): for a file of a shared library the version takes, where the copy has each of its twins, as
 *     twinsIn takes it, or null (../lib/twins.mjs)
 * Answers { unit(file), link({ file, only, addressOf }) }.
 */
export function openBuild({ root, includes = [root], files = [], console: id = 'gba', shifts = [], givenOf = () => null, layout = GBA_LAYOUT, signature: signatureFor = signatureOf, wrap = null }) {
  const inRoot = path => relative(root, path).split(sep).join('/') || '.';
  const inside = folder => !inRoot(folder).startsWith('..') && !isAbsolute(inRoot(folder));
  const source = treeOf(root), elsewhere = {}, placed = new Map();
  // a folder outside the version's, as the compiler sees it: a shared library's, or one it includes from
  const elsewhereOf = folder => {
    if (!placed.has(folder)) {
      const n = Object.keys(elsewhere).length;
      elsewhere[n] = treeOf(folder, false);
      placed.set(folder, `${ELSEWHERE}/${n}`);
    }
    return placed.get(folder);
  };
  const given = includes.map(folder => (inside(folder) ? inRoot(folder) : elsewhereOf(folder)));
  const placeOf = file => (inside(dirname(file)) ? inRoot(file) : `${elsewhereOf(dirname(file))}/${basename(file)}`);
  const units = new Map();
  let everyOther = null;

  // One file, built by itself: the file, then a function for each of its twins the check can call, which takes and
  // gives whole words and leaves the compiler to make of them what the twin takes, and what finds the file's twins by
  // their addresses. Answers { file, n, twins, calls, unknown } with { object, names } or { error }.
  const unit = file => {
    if (!units.has(file)) {
      const n = units.size;
      units.set(file, (async () => {
        const kit = await kitBuilt(id);
        const text = readFileSync(file, 'utf8');
        const twins = twinsIn(text, givenOf(file) ? [] : shifts, givenOf(file), id), calls = [], unknown = [];
        for (const twin of twins) {
          if (twin.address === null) continue;
          const signature = signatureFor(text, twin.name);
          if (signature) calls.push({ ...twin, ...signature, call: `${CALL}${n}_${twin.name}` });
          else unknown.push(twin.name);
        }
        const cases = [];
        for (const { name, address } of twins) if (address !== null && !cases.some(([other]) => other === address)) cases.push([address, name]);
        const name = `__twin_unit${n}.c`;
        const build = () => {
          const lines = [`#include "${placeOf(file)}"`];
          // each named for its file too, as two files can each have a function of their own with one name
          for (const { name: twin, params, returns, call } of calls) {
            if (wrap) {
              lines.push(wrap({ name: twin, params, returns, call }));
              continue;
            }
            const taken = params.map((_, i) => `unsigned a${i}`).join(', ') || 'void', passed = params.map((_, i) => `a${i}`).join(', ');
            lines.push(returns ? `unsigned ${call}(${taken}) { return (unsigned)${twin}(${passed}); }` : `unsigned ${call}(${taken}) { ${twin}(${passed}); return 0; }`);
          }
          // left as it's written: made faster, it becomes a list of the functions kept as data, which would be filled in
          // with the original's addresses like any other
          lines.push(`__attribute__((optnone, noinline)) void *${CODE}_${n}(unsigned address) {`, '  switch (address) {', ...cases.map(([address, twin]) => `  case 0x${hex(address)}u: return (void *)${twin};`), '  }', '  return 0;', '}');
          return compile([...kit.flags, ...given.flatMap(folder => ['-I', folder]), ...kit.includes, '-c', name],
            { ...source, [name]: Buffer.from(`${lines.join('\n')}\n`), [KIT]: kit.tree, [ELSEWHERE]: elsewhere }, `__twin_unit${n}.o`);
        };
        let built = await build();
        // A twin that takes or gives something whole words can't be made into, a struct as it is, can't be called from
        // here: the compiler says so of the line that calls it, and the file is built again without those calls.
        const refused = new Set([...(built.error ?? '').matchAll(new RegExp(`^${name.replace('.', '\\.')}:(\\d+):\\d+: error`, 'gm'))].map(found => calls[found[1] - 2]).filter(Boolean));
        if (refused.size) {
          for (const call of refused) unknown.push(call.name);
          calls.splice(0, calls.length, ...calls.filter(call => !refused.has(call)));
          built = await build();
        }
        return { file, n, twins, calls, unknown, ...(built.error ? { error: built.error } : { object: built.made, names: namesOf(built.made) }) };
      })());
    }
    return units.get(file);
  };

  // which file of the version defines each name, from every file that builds: found once, the first time a file
  // names something that neither it nor the kit defines
  const definers = () => {
    everyOther ??= (async () => {
      const by = new Map();
      for (const file of files) {
        const other = await unit(file);
        for (const name of other.names?.defines ?? []) if (!by.has(name)) by.set(name, other);
      }
      return by;
    })();
    return everyOther;
  };

  /**
   * The module for one file's check: the file, the files that define what it names, and those that define what they
   * name, on the kit, with the console's addresses. `only` is the address of the one function to call, or null for
   * every twin of the file, and addressOf(name) where the console keeps a value, or null.
   * Answers { error }, what the compiler said, or { unit, module, missing, imports }, as placeAddresses gives them.
   */
  const link = async ({ file, only = null, addressOf }) => {
    const first = await unit(file);
    if (first.error) return { error: first.error };
    const kit = await kitBuilt(id);
    const linked = [first], defined = new Set(first.names.defines);
    // a value the console has an address for is the console's; anything else is looked for in the version's files
    const wanted = names => [...names.functions, ...names.values.filter(name => addressOf(name) === null)];
    const queue = wanted(first.names);
    while (queue.length) {
      const name = queue.pop();
      if (defined.has(name) || kit.defines.has(name)) continue;
      const other = (await definers()).get(name);
      if (!other || linked.includes(other)) continue;
      linked.push(other);
      for (const each of other.names.defines) defined.add(each);
      queue.push(...wanted(other.names));
    }
    const addresses = new Map();
    for (const each of linked) for (const { name, address } of each.twins) if (address !== null && !addresses.has(name)) addresses.set(name, address);
    const code = [
      ...linked.map(each => `void *${CODE}_${each.n}(unsigned address);`),
      `void *${NO_CODE}(unsigned address);`,
      `void *${CODE}(unsigned address) {`,
      '  void *twin;',
      // a function of the module's own, with no address in the original, is kept as the module numbers it
      `  if (address < 0x${(layout.own ?? 0x02000000).toString(16).toUpperCase()}u) return (void *)address;`,
      '  address &= ~1u;',
      ...linked.map(each => `  if ((twin = ${CODE}_${each.n}(address))) return twin;`),
      `  return ${NO_CODE}(address);`,
      '}',
      // for C that names a twin by its address itself, with the build's twins.h, when the file with its table isn't here
      `__attribute__((weak)) void *kit_twin(unsigned address) { return ${CODE}(address); }`, '',
    ].join('\n');
    const calls = first.calls.filter(call => only === null || call.address === only);
    const objects = Object.fromEntries(linked.map(each => [`__twin_unit${each.n}.o`, each.object]));
    const built = await compile([...kit.flags, '-Wl,--no-entry', '-Wl,--allow-undefined', '-Wl,--emit-relocs', `-Wl,--global-base=${layout.base}`, '-Wl,-z,stack-size=1048576',
      ...(layout.memory ? [`-Wl,--initial-memory=${layout.memory}`] : []),
      ...[CODE, '__stack_pointer', ...calls.map(({ call }) => call)].map(name => `-Wl,--export=${name}`), ...KIT_NAMES.map(name => `-Wl,--export-if-defined=${name}`),
      '__twin_code.c', ...Object.keys(objects), ...Object.keys(kit.objects)], { '__twin_code.c': Buffer.from(code), ...objects, ...kit.objects }, 'twins.wasm');
    if (built.error) return { error: built.error };
    // a function's address as the original keeps it, odd for Thumb on the Game Boy Advance
    return {
      unit: first, calls,
      ...placeAddresses({
        module: built.made, addressOf, translate: CODE, own: name => name.startsWith(CODE),
        codeOf: name => (addresses.has(name) ? layout.code(addresses.get(name)) : null),
      }),
    };
  };
  return { unit, link };
}

// ---------------------------------------------------------------------------------------------------------------
// The calls.

// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];
const KEPT = 512;

// What makes up arguments and values, the same from the same seed.
function chooser(seed) {
  let state = seed >>> 0;
  const below = n => {
    state = state + 0x6D2B79F5 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) % n;
  };
  const from = list => list[below(list.length)];
  // numbers the original compared with or loaded, and addresses of things in the console's memory
  const met = [], known = new Set(), places = [], given = [];
  const keep = (list, value) => {
    if (list.length < KEPT) list.push(value);
    else list[below(KEPT)] = value;
  };
  const number = () => {
    const kind = below(100);
    let value;
    if (kind < 45 && met.length) value = from(met);
    else if (kind < 70) value = below(17);
    else if (kind < 82) value = from(EDGES);
    else value = (below(0x10000) * 0x10000 + below(0x10000)) >>> below(32);
    // never an address of the hardware's registers, which a twin reaches through the kit and not as memory
    return value >>> 24 === 4 ? value & 0xFFFFFF : value >>> 0;
  };
  return {
    below, from, number,
    /** A number the original met, worth giving back to it, with the ones beside it. */
    meet(value) {
      for (const near of [value, value + 1, value - 1]) {
        const v = near >>> 0;
        if (known.has(v) || known.size > 8 * KEPT) continue;
        known.add(v);
        keep(met, v);
      }
    },
    /** An address in the console's memory that something is at. */
    place(address) {
      if (inImage(address) >= 0 && !places.includes(address)) keep(places, address);
    },
    /** What a function gave back, when it's an address in the console's memory: the thing another function is for. */
    gave(address) {
      if (inImage(address) >= 0 && !given.includes(address)) keep(given, address);
    },
    /** A value for something of that type. */
    value(type, code) {
      let value = number();
      if (type.pointer || type.bits === 32) {
        const kind = below(100);
        if (type.pointer && kind < 35 && given.length) value = from(given);
        else if (type.pointer && kind < 55 && places.length) value = from(places);
        else if (kind < (type.pointer ? 70 : 8) && code.length) value = from(code);
        else if (kind < 12 && places.length) value = from(places);
        else if (kind < 16 && given.length) value = from(given);
      }
      if (type.bits === 32) return value >>> 0;
      value &= type.bits === 8 ? 0xFF : 0xFFFF;
      return (type.signed && value >> (type.bits - 1) ? value - (1 << type.bits) : value) >>> 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Aiming a call at a path no call took yet.

// Whether a Thumb branch's condition holds after `a` was compared with `b`, or tested with it: null for a test whose
// condition reads what a test leaves as it was.
function holds(cond, a, b, test) {
  const r = (test ? a & b : a - b) >>> 0, n = r >>> 31, z = r === 0;
  const c = test ? null : a >>> 0 >= b >>> 0, v = test ? null : ((a ^ b) & (a ^ r)) >>> 31;
  if (test && ![0, 1, 4, 5].includes(cond)) return null;
  return [z, !z, c, !c, n === 1, n === 0, v === 1, v === 0, c && !z, !c || z, n === v, n !== v, !z && n === v, z || n !== v][cond] ?? null;
}

// The conditional branches of a function whose calls so far went one way only, each with the way none took.
function branchesLeft(f, bytesOf) {
  const at = f.address & ~1, bytes = bytesOf(at, f.span);
  const branches = [];
  for (const [where, how] of pathsLeft(bytes, at, f.ran).left) {
    if (how === 'never ran') continue;
    const op = bytes.readUInt16LE(where - at);
    if ((op & 0xF000) !== 0xD000 || (op >> 8 & 15) >= 14) continue;
    branches.push({ where, cond: op >> 8 & 15, taken: how === 'never taken' });
  }
  return branches;
}

// A value through the steps call.c saw it take since it was read: numbers added, shifts and masks.
function throughSteps(value, steps) {
  let v = value >>> 0;
  for (const [kind, by] of steps) {
    if (kind === 1) v = (v + by) >>> 0;
    else if (kind === 2) v = by >= 32 ? 0 : (v << by) >>> 0;
    else if (kind === 3) v = by >= 32 ? 0 : v >>> by;
    else if (kind === 4) v = ((v | 0) >> Math.min(by, 31)) >>> 0;
    else if (kind === 5) v = (v & by) >>> 0;
    else if (kind === 6) v = (0 - v) >>> 0;
  }
  return v;
}

// The value a comparison read, as one it came from that comes out as one the branch wants: for a byte or a halfword,
// the nearest to what it held of all it could hold, and for a word, the one that steps of adding and turning round
// give. Null when none does. `wanted(value)` says whether the comparison then goes the branch's other way, and `other` is the value
// it's compared with, the likeliest to want, or one beside it.
export function sourceFor(held, bytes, now, steps, wanted, other) {
  const bits = bytes * 8, mask = bytes === 4 ? 0xFFFFFFFF : (1 << bits) - 1;
  const signed = value => (bytes < 4 && value >> (bits - 1) & 1 ? value - 2 ** bits : value) >>> 0;
  const read = [value => value >>> 0, signed].find(as => throughSteps(as(held), steps) === now);
  if (!read) return null;
  if (bytes < 4) {
    // through a mask, a flag among others: one bit changed first, as the nearest number can change many (#1570)
    if (steps.some(([kind]) => kind === 5)) {
      for (let bit = 0; bit < bits; bit++) if (wanted(throughSteps(read((held ^ 1 << bit) & mask), steps))) return ((held ^ 1 << bit) & mask) >>> 0;
    }
    for (let d = 1; d <= mask; d++) {
      for (const value of [(held + d) & mask, (held - d) & mask]) if (wanted(throughSteps(read(value), steps))) return value >>> 0;
    }
    return null;
  }
  // a word through numbers added and turnings round: what comes out is the value, turned round or not, and a number
  if (steps.some(([kind]) => kind !== 1 && kind !== 6)) return null;
  let sign = 1, added = 0;
  for (const [kind, by] of steps) {
    if (kind === 6) {
      sign = -sign;
      added = -added;
    } else added += by;
  }
  for (const want of CANDIDATES(now, other)) if (wanted(want)) return (sign * (want - added)) >>> 0;
  return null;
}
const CANDIDATES = (now, other) => [other, other + 1, other - 1, other + 2, other - 2, other ^ 0x80000000, 0, 1, 0xFFFFFFFF, 0x7FFFFFFF, 0x80000000, now + 1, now - 1, ~now].map(value => value >>> 0);

// The call a witness was, with one value a comparison read changed so that the branch goes the way `wanted` says:
// an argument, or what came from the image. Null when it can't be had that way.
function withValue(witness, origin, now, wanted, other) {
  if (origin.kind === 2) {
    if (origin.where >= witness.args.length) return null;
    const value = sourceFor(witness.args[origin.where], 4, now, origin.steps, wanted, other);
    if (value === null) return null;
    const args = [...witness.args];
    args[origin.where] = value;
    return { args, changed: witness.changed };
  }
  if (origin.kind !== 1 || ![1, 2, 4].includes(origin.bytes) || inImage(origin.where) < 0) return null;
  const { where: address, bytes } = origin;
  const set = witness.changed.find(([at, size]) => at === address && size === bytes);
  const value = sourceFor(set ? set[2] : read(witness.start, inImage(address), bytes), bytes, now, origin.steps, wanted, other);
  if (value === null) return null;
  return { args: witness.args, changed: [...witness.changed.filter(([at]) => at !== address), [address, bytes, value]] };
}

// A call aimed at one of a function's branches its calls haven't taken both ways: a call that made the comparison
// before it, again, with one of the two values it compared changed so that the branch goes the other way. Null when
// there's none to aim at, or no value found does it.
function aimed(f, choose) {
  // the calls that made the comparison just before a branch: at most four instructions before it, the nearest first
  const witnessesOf = branch => {
    for (let pc = branch.where - 2; pc >= branch.where - 8; pc -= 2) if (f.aim.witnesses.get(pc)?.length) return f.aim.witnesses.get(pc);
    return [];
  };
  const open = f.aim.branches.filter(branch => witnessesOf(branch).length && (f.aim.tries.get(branch.where) ?? 0) < AIM_TRIES);
  if (!open.length) return null;
  const branch = choose.from(open), witness = choose.from(witnessesOf(branch)), { compare } = witness;
  f.aim.tries.set(branch.where, (f.aim.tries.get(branch.where) ?? 0) + 1);
  for (const side of [0, 1]) {
    const origin = compare.from[side];
    if (!origin.kind) continue;
    const now = side ? compare.b : compare.a;
    const wanted = value => holds(branch.cond, side ? compare.a : value, side ? value : compare.b, compare.test) === branch.taken;
    const call = withValue(witness, origin, now, wanted, side ? compare.a : compare.b);
    if (call) return { ...call, witness };
  }
  return null;
}

const read = (image, where, bytes) => (bytes === 1 ? image[where] : bytes === 2 ? image.readUInt16LE(where) : image.readUInt32LE(where));
const write = (image, where, bytes, value) => {
  if (bytes === 1) image[where] = value & 0xFF;
  else if (bytes === 2) image.writeUInt16LE(value & 0xFFFF, where);
  else image.writeUInt32LE(value >>> 0, where);
};

/**
 * Calls each function of `functions` in the original and its twin until `calls` calls of it were compared, each
 * call from the memory the last one left. A function is { name, address (odd for Thumb), params, returns, call },
 * `call` the name the module gives what calls its twin.
 * Fills each in with `compared`, `tried`, what couldn't be compared and why (`aside`), and `result` when its twin
 * differed, stopped or never came back.
 * With `memories`, of play (twin-memories.mjs), a function's calls start from its own: the console's memory as it was
 * when the function started in a recording, with the arguments and the stack it had, half of them just as it was and
 * half with what it reads changed, and then a few calls on from what each leaves, as a function called every frame
 * is. A function that never started in play starts from power-on memory or from another function's, one or the other.
 */
export async function compareCalls({ original, twins, start, functions, options, choose, memories = null, bytesOf = null, ruledOut = new Map(), status = null }) {
  const { calls, limit, changes: changing } = options;
  let mirror = Buffer.from(start);
  await twins.start(mirror);
  await original.set(mirror);
  // the addresses of the functions the module has twins of, for a value that is a pointer to code
  const code = functions.map(f => f.address);
  for (const f of functions) Object.assign(f, { compared: 0, tried: 0, aside: { never: 0, left: 0, clocked: 0, unbuilt: 0, mismatch: 0, impossible: 0 }, fields: new Map(), good: [], result: null, ran: new Map(), aimedCalls: 0, aim: { branches: [], witnesses: new Map(), tries: new Map() } });
  let since = 0, lost = 0;
  // with memories of play: whose memory the calls are going on from and which it was, the memory this call starts
  // from, if it starts from one, and the stack the original's calls start on, 0 for the game's own
  let owner = null, based = null, from = null, top = 0;
  for (;;) {
    const open = functions.filter(f => !f.result && f.compared < calls && f.tried < calls * TRIES && !(f.tried >= HOPELESS && !f.compared));
    if (!open.length) break;
    let f;
    from = null;
    if (!memories) {
      if (since >= FRESH_EVERY || lost >= FRESH_AFTER) {
        mirror = Buffer.from(start);
        await original.set(mirror);
        await twins.set(mirror);
        since = lost = 0;
      }
      f = choose.from(open);
    } else {
      // a function goes on a few calls from what its last one left, then another has its turn
      f = owner && open.includes(owner) && choose.below(4) ? owner : choose.from(open);
      if (f !== owner || since >= FRESH_EVERY || lost >= FRESH_AFTER || !choose.below(4)) {
        const own = memories.of(f.address & ~1);
        from = own.length ? choose.from(own) : choose.below(2) ? memories.any(choose) : null;
        mirror = Buffer.from(from ? from.image() : start);
        await original.set(mirror);
        await twins.set(mirror);
        if ((from?.top ?? 0) !== top) await original.top(top = from?.top ?? 0);
        owner = f;
        based = from;
        since = lost = 0;
      }
    }
    f.tried++;
    since++;
    // now and then a call aimed at a branch way no call took yet, from the memory a call that reached it started from
    const aim = changing && options.aim !== false && f.aim.branches.length && !choose.below(3) ? aimed(f, choose) : null;
    if (aim) {
      mirror = Buffer.from(aim.witness.start);
      await original.set(mirror);
      await twins.set(mirror);
      if (aim.witness.top !== top) await original.top(top = aim.witness.top);
      owner = null;
      based = aim.witness.based;
      from = null;
      since = FRESH_EVERY;
      f.aimedCalls++;
    }
    const spare = aim ? aim.witness.spare : from?.own ? [0, 1, 2, 3].map(i => from.arg(i) >>> 0) : [];
    // what it's given: made up, or what an earlier call that could be compared was given, as it is or with one changed,
    // since a function that takes one of the game's own things can only be called with those
    let args = aim ? [...aim.args] : f.params.map(type => choose.value(type, code));
    // from its own memory of play, what play gave it, and half the time nothing else: the call play made
    const asPlayed = Boolean(from?.own) && !choose.below(2);
    if (aim) {
      // as the witness was, with the one value changed
    } else if (from?.own) {
      const one = args.length ? choose.below(args.length) : 0, fresh = args[one];
      args = f.params.map((_, i) => from.arg(i) >>> 0);
      if (!asPlayed && args.length && !choose.below(4)) args[one] = fresh;
    } else if (f.good.length && args.length && choose.below(10) < 3) {
      const one = choose.below(args.length), fresh = args[one];
      args = [...choose.from(f.good)];
      if (!choose.below(4)) args[one] = fresh;
    }
    // what the function reads, changed: a few of the values it's been seen to read, mostly to numbers it's been seen
    // to compare with, now and then to one more or less than they hold, or to what another of them holds
    const changed = aim ? aim.changed.map(change => [...change]) : [], used = [];
    // but those whose changes kept ending in calls that couldn't be compared, tried again only now and then
    const fields = [...f.fields.values()].filter(field => field.lost < BLAMED || !choose.below(50));
    if (!aim && changing && !asPlayed && fields.length && choose.below(4)) {
      // half the time one the function was seen to compare with something, set to what it was compared with
      const wanting = fields.filter(field => field.wants.length);
      for (let n = 1 + choose.below(Math.min(4, fields.length)); n; n--) {
        const field = wanting.length && choose.below(2) ? choose.from(wanting) : choose.from(fields);
        const { address, bytes } = field, kind = choose.below(100), now = read(mirror, inImage(address), bytes);
        used.push(field);
        let value;
        if (field.wants.length && choose.below(100) < 55) value = choose.from(field.wants);
        else if (kind < 15) value = now + (choose.below(2) ? 1 : -1);
        else if (kind < 25) {
          const other = choose.from(fields);
          value = read(mirror, inImage(other.address), other.bytes);
        } else value = choose.value({ bits: bytes * 8, signed: false, pointer: false }, code);
        const mask = bytes === 4 ? 0xFFFFFFFF : (1 << bytes * 8) - 1;
        changed.push([address, bytes, (value & mask) >>> 0]);
      }
    }
    // a function that may read whether the display is in the V-blank, as it keeps the status's address beside its
    // code or a call of it used the hardware, now and then started the other way: in a call the display's status stays
    // as it started, the clock a twin doesn't have stopped on both sides (#1569)
    if (!aim && changing && !asPlayed && status !== null && f.status && !choose.below(4)) changed.push([DISPSTAT, 2, status ^ DISPSTAT_VBLANK]);
    // from its own memory of play the original has every register as play had it, the ones the twin says it takes
    // nothing in too: a twin that takes fewer arguments than the original reads then differs, and isn't left unchecked
    const startedFrom = mirror;
    const theirs = await original.call({ address: f.address, span: f.span ?? 0, args, changes: changed, limit, spare, unaligned: f.unaligned });
    if (theirs.hardware) f.status = true;
    // a call that made a comparison is a witness to aim from at the branch after it: a few of each, kept as they come,
    // more for one before a branch way no call took, all of a call's sharing one copy of the memory it started from
    if (theirs.ended === 0 && changing && options.aim !== false && bytesOf && f.span) {
      let call = null;
      for (const compare of theirs.compares) {
        const kept = f.aim.witnesses.get(compare.pc) ?? [];
        const wanted = f.aim.branches.some(branch => branch.where > compare.pc && branch.where - compare.pc <= 8);
        if (kept.length >= (wanted ? WITNESSES : 2)) continue;
        call ??= { start: Buffer.from(startedFrom), changed: changed.map(change => [...change]), args: [...args], top, spare, based };
        kept.push({ ...call, compare });
        f.aim.witnesses.set(compare.pc, kept);
      }
    }
    const expected = Buffer.from(mirror);
    for (const [address, bytes, value] of changed) if (inImage(address) >= 0) write(expected, inImage(address), bytes, value);
    // each value it read, by what it held: one that was compared with something is worth setting to that, and to
    // the numbers beside it
    const holding = new Map();
    for (const [address, bytes] of theirs.reads) {
      if (f.fields.size < 2048 && !f.fields.has(address * 8 + bytes)) f.fields.set(address * 8 + bytes, { address, bytes, lost: 0, wants: [] });
      const field = f.fields.get(address * 8 + bytes);
      if (!field) continue;
      const value = read(expected, inImage(address), bytes);
      if (!holding.has(value)) holding.set(value, []);
      holding.get(value).push(field);
    }
    // each comparison once, however often a loop made it, and for the first few values that held what it compared
    const seen = new Set();
    for (const [one, other] of theirs.pairs) {
      if (seen.has(one * 0x100000000 + other) || seen.size >= 512) continue;
      seen.add(one * 0x100000000 + other);
      for (const [held, wanted] of [[one, other], [other, one]]) {
        for (const field of (holding.get(held) ?? []).slice(0, 8)) {
          const mask = field.bytes === 4 ? 0xFFFFFFFF : (1 << field.bytes * 8) - 1;
          for (const near of [wanted, wanted + 1, wanted - 1]) {
            const value = (near & mask) >>> 0;
            if (field.wants.includes(value)) continue;
            if (field.wants.length < 24) field.wants.push(value);
            else field.wants[choose.below(24)] = value;
          }
        }
      }
      choose.meet(other);
    }
    const aside = () => {
      for (const field of used) field.lost++;
      lost++;
    };
    for (const value of theirs.numbers) {
      choose.meet(value);
      choose.place(value);
    }
    if (theirs.ended !== 0) {
      // the original didn't come back, or left what a twin can follow: nothing to compare, and it's taken back
      if (theirs.ended === 1) f.aside.never++;
      else if (theirs.ended === 3) f.aside.clocked++;
      else {
        f.aside.left++;
        f.leftFor ??= theirs.leftFor;
      }
      aside();
      continue;
    }
    // a call that went a way the game never takes, as its unreachable.json says, started from what the game never has:
    // it's taken back, and isn't compared (#1536)
    if (ruledOut.size && theirs.ran.some(([where, ways]) => (ruledOut.get(where) === TAKEN && ways & WENT_ELSEWHERE) || (ruledOut.get(where) === NOT_TAKEN && ways & WENT_ON))) {
      f.aside.impossible++;
      await original.undo();
      aside();
      continue;
    }
    for (const run of theirs.runs) run.bytes.copy(expected, run.at);
    const ours = await twins.call(f.call, args, changed);
    const call = { number: f.compared + 1, args, changed, hardware: theirs.hardware, ...(based ? { from: { recording: based.recording, frame: based.frame, calls: since - 1 } } : {}) };
    if (ours.never) {
      f.result = { kind: 'never', ...call };
      mirror = expected;
      await twins.start(mirror);
      continue;
    }
    if (ours.stopped === 'unbuilt' || ours.stopped === 'mismatch') {
      // nothing to compare: the twin calls what isn't built, or the check gave it a pointer to a function of another kind
      f.aside[ours.stopped]++;
      if (ours.unbuilt) f.unbuilt ??= ours.unbuilt;
      await original.undo();
      await twins.set(mirror);
      aside();
      continue;
    }
    mirror = expected;
    if (ours.stopped) {
      f.result = { kind: 'stopped', why: ours.stopped, ...call };
      await twins.set(mirror);
      continue;
    }
    const image = Buffer.from(ours.image.buffer, ours.image.byteOffset, ours.image.length);
    const mask = !f.returns ? 0 : f.returns.bits === 32 ? 0xFFFFFFFF : (1 << f.returns.bits) - 1;
    const gaveSame = ((ours.gave ^ theirs.gave) & mask) === 0;
    if (gaveSame && image.equals(expected)) {
      f.compared++;
      lost = 0;
      for (const field of used) field.lost = 0;
      if (f.good.length < 32) f.good.push(args);
      else f.good[choose.below(32)] = args;
      if (f.returns) choose.gave(theirs.gave);
      // the original's own instructions this call ran, and the ways each went on: only a call compared counts
      for (const [where, ways] of theirs.ran) f.ran.set(where, (f.ran.get(where) ?? 0) | ways);
      // now and then, the branch ways no call took yet, to aim calls at
      if (bytesOf && f.span && (aim || f.compared === AIM_AFTER || f.compared % AIM_EVERY === 0)) f.aim.branches = branchesLeft(f, bytesOf);
      continue;
    }
    let where = 0;
    while (where < IMAGE && image[where] === expected[where]) where++;
    f.result = {
      kind: 'differs', ...call,
      ...(gaveSame ? {} : { gave: { ours: (ours.gave & mask) >>> 0, theirs: (theirs.gave & mask) >>> 0 } }),
      ...(where < IMAGE ? { memory: { ...addressAt(where), ours: image[where], theirs: expected[where] } } : {}),
    };
    await twins.set(mirror);
  }
  twins.stop();
  if (top) await original.top(0);
}

/**
 * What the calls compared left out of a function of the original: `bytes` are the function's, `address` where it is,
 * `ran` a Map of each of its instructions that ran to the ways it went on, as call.c says them, and `ruledOut` the
 * branch ways the game's unreachable.json says can't happen (../lib/played.mjs). Answers { total, left }: how many
 * instructions and branch ways it has, and each that never ran, as [address, 'never ran', 'never taken' or
 * 'always taken']. Its instructions are found from its start through both ways of every branch, from where it
 * ran, and from each word of it that isn't an instruction and holds an address inside it, as the table of a switch
 * does, so a case no call reached is seen as left out.
 */
export function pathsLeft(bytes, address, ran, ruledOut = new Map()) {
  const seeds = new Set([...ran.keys()].map(where => where - address).filter(offset => offset >= 0 && offset < bytes.length));
  // a way the game never takes isn't followed, so what only it reaches isn't asked for (#1536)
  const never = new Map([...ruledOut].filter(([where]) => where >= address && where < address + bytes.length).map(([where, way]) => [where - address, way]));
  let found;
  for (;;) {
    found = instructionsOf(bytes, [...seeds], never, { longJumps: true });
    const before = seeds.size;
    for (let word = (4 - address % 4) % 4; word + 4 <= bytes.length; word += 4) {
      if (found.instructions.has(word) || found.instructions.has(word + 2)) continue;
      const target = (((bytes[word] | bytes[word + 1] << 8 | bytes[word + 2] << 16 | bytes[word + 3] << 24) & ~1) >>> 0) - address;
      if (target > 0 && target < bytes.length && !found.instructions.has(target)) seeds.add(target);
    }
    if (seeds.size === before) break;
  }
  return waysLeft(found, address, ran, ruledOut);
}

/** What a call was, in words: its number, what it was given, the memory of play it started from or went on from, if
 *  there was one, and what was changed for it. */
export function callText(name, { number, args, changed, from }) {
  const set = changed.length ? `, after ${changed.map(([address, bytes, value]) => `${at(address)} was set to 0x${value.toString(16).toUpperCase().padStart(bytes * 2, '0')}`).join(' and ')}` : '';
  const played = !from ? '' : `, ${from.calls ? `${count(from.calls)} call${from.calls === 1 ? '' : 's'} on ` : ''}from the memory of ${from.recording} at frame ${count(from.frame)}`;
  return `call ${count(number)}, ${name}(${args.map(at).join(', ')})${played}${set}`;
}

/** What a function's check came to, as { kind, line }: `kind` is 'same', 'differs', 'never', 'stopped', 'few' or
 *  'unchecked', and `line` what to say after its address and name. */
export function outcome(f, { calls, seconds }) {
  const byte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const hardware = f.result?.hardware ? ` The original used the hardware's register at ${at(f.result.hardware)} in this call, which a twin has to do through the kit.` : '';
  if (f.result?.kind === 'differs') {
    const gave = f.result.gave ? `the twin gave back ${at(f.result.gave.ours)} and the original ${at(f.result.gave.theirs)}` : null;
    const memory = f.result.memory ? `at ${at(f.result.memory.address)}, in ${f.result.memory.name}, the twin left ${byte(f.result.memory.ours)} and the original ${byte(f.result.memory.theirs)}` : null;
    return { kind: 'differs', line: `${callText(f.name, f.result)}: ${[memory, gave].filter(Boolean).join(', and ')}.${hardware}` };
  }
  if (f.result?.kind === 'gives') return { kind: 'differs', line: `the twin gives back nothing, while the original gives back what its callers use: the call at ${at(f.result.call)} reads r0 after it.` };
  if (f.result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, f.result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (f.result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, f.result)}: the original came back and the twin stopped (${f.result.why}).${hardware}` };
  if (f.compared >= calls) return { kind: 'same', line: `${count(f.compared)} calls${f.aimedCalls ? `, ${count(f.aimedCalls)} of them aimed at a branch way no call had taken` : ''}` };
  // what kept the rest from being compared, the most common first
  const why = Object.entries({
    unbuilt: `the twin calls ${f.unbuilt}, which nothing built is the twin of`,
    left: `the original left for ${at(f.leftFor ?? 0)}, where a twin can't follow`,
    never: 'the original itself didn\'t come back',
    clocked: 'a DMA the console\'s clock started wrote memory in the middle of the original\'s call, which a twin has no clock for',
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
    impossible: 'the original went a way the game never takes, as its unreachable.json says, from what the game never has',
  }).filter(([key]) => f.aside[key]).sort(([a], [b]) => f.aside[b] - f.aside[a]).map(([key, text]) => `${text} (${count(f.aside[key])} calls)`).join(', and ');
  if (!f.compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(f.compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

// What one Thumb instruction does with r0: reads it, writes it without reading it, ends what can be followed
// (a branch, a call, a return or a swi), or neither. A call to a function its caller reads r0 after, before anything
// writes it, gives back a value: so the console's compiler wrote, which never reads r0 after a function that gives
// back nothing.
function withR0(op) {
  const reg = (n, r) => r === 0 ? n : null;
  const touch = (reads, writes) => (reads.includes(0) ? 'reads' : writes.includes(0) ? 'writes' : null);
  if (op >> 11 === 3) return touch([op >> 3 & 7, ...(op & 0x400 ? [] : [op >> 6 & 7])], [op & 7]);   // add, sub
  if (op >> 13 === 0) return touch([op >> 3 & 7], [op & 7]);                                          // shifts
  if (op >> 13 === 1) {                                                                                 // mov, cmp, add, sub #
    const kind = op >> 11 & 3, rd = op >> 8 & 7;
    return kind === 0 ? touch([], [rd]) : kind === 1 ? touch([rd], []) : touch([rd], [rd]);
  }
  if (op >> 10 === 0x10) {                                                                              // the ALU's
    const kind = op >> 6 & 15, rd = op & 7, rs = op >> 3 & 7;
    return touch([rs, ...(kind === 9 || kind === 15 ? [] : [rd])], [8, 10, 11].includes(kind) ? [] : [rd]);
  }
  if (op >> 10 === 0x11) {                                                                              // high registers, bx
    const kind = op >> 8 & 3, rd = (op & 7) | (op >> 4 & 8), rs = op >> 3 & 15;
    if (kind === 3) return rs === 0 ? 'reads' : 'ends';
    return kind === 0 ? touch([rd, rs], [rd]) : kind === 1 ? touch([rd, rs], []) : touch([rs], [rd]);
  }
  if (op >> 11 === 9) return touch([], [op >> 8 & 7]);                                                 // ldr from the pool
  if (op >> 12 === 5) {                                                                                 // ldr, str by register
    const loads = op & 0x200 ? (op & 0xC00) !== 0 : (op & 0x800) !== 0;
    return touch([op >> 6 & 7, op >> 3 & 7, ...(loads ? [] : [op & 7])], loads ? [op & 7] : []);
  }
  if (op >> 13 === 3 || op >> 12 === 8) {                                                              // ldr, str by a number
    const loads = (op & 0x800) !== 0;
    return touch([op >> 3 & 7, ...(loads ? [] : [op & 7])], loads ? [op & 7] : []);
  }
  if (op >> 12 === 9) return (op & 0x800) ? touch([], [op >> 8 & 7]) : touch([op >> 8 & 7], []);    // ldr, str on the stack
  if (op >> 12 === 10) return touch([], [op >> 8 & 7]);                                                // add pc or sp
  if ((op & 0xFF00) === 0xB000) return null;                                                           // the stack moved
  if ((op & 0xF600) === 0xB400) {                                                                       // push, pop
    if (op & 0x800) return op & 1 ? 'writes' : op & 0x100 ? 'ends' : null;
    return op & 1 ? 'reads' : null;
  }
  if (op >> 12 === 12) return (op & 0x800) ? touch([op >> 8 & 7], op & 1 ? [0] : []) : touch([op >> 8 & 7, ...(op & 1 ? [0] : [])], []);
  return 'ends';
}

/**
 * Whether the original's functions give back what their callers use: `bytes` are the cartridge's and `functions`
 * the code map's Thumb functions, as { address, size }. Answers a function of a function's address: the address of a
 * call to it whose caller reads r0 after it, or null.
 */
export function givesBackUsed(bytes, functions) {
  const u16 = address => bytes[address - CARTRIDGE] | bytes[address - CARTRIDGE + 1] << 8;
  const inside = address => address >= CARTRIDGE && address + 2 <= CARTRIDGE + bytes.length;
  let used = null;
  return target => {
    if (!used) {
      used = new Map();
      for (const { address, size } of functions) {
        const end = address + size;
        for (let pc = address; pc + 4 <= end && inside(pc + 2); pc += 2) {
          const hi = u16(pc), lo = u16(pc + 2);
          if ((hi & 0xF800) !== 0xF000 || (lo & 0xF800) !== 0xF800) continue;
          const offset = ((hi & 0x7FF) << 21 >> 9) | (lo & 0x7FF) << 1;
          const callee = (pc + 4 + offset) >>> 0;
          if (used.has(callee)) continue;
          for (let at = pc + 4, n = 0; n < 16 && at + 2 <= end && inside(at); at += 2, n++) {
            const did = withR0(u16(at));
            if (did === 'reads') used.set(callee, pc);
            if (did) break;
          }
        }
      }
    }
    return used.get(target & ~1) ?? null;
  };
}

/**
 * Checks the twins of one file.
 *   original, start: what calls the original and the memory to start from, as openOriginal gives them
 *   copy: the contributor's copy, whose cartridge the twins read their data from
 *   file: the file, and build: what builds it, as openBuild gives it, or else root, includes, files, console and
 *     shifts, which openBuild takes
 *   only: the address of the one function to check, or null for every twin of the file
 *   addressOf(name): where the console keeps a value, or the original a function, or null
 *   isArm(address): whether the original's function there is ARM code
 *   memories: memories of play for the calls to start from, as openMemories gives them, or none
 *   givesBack(address): the address of a call to the original's function there whose caller uses what it gives back,
 *     as givesBackUsed answers, or null: a twin that gives back nothing differs from such a function
 *   options: as DEFAULTS
 * Answers { error }, when it didn't build, { missing }, the values with no address, or { functions }, each with its
 * `kind` and `line` as outcome gives them, and those with no address as { name, address: null }.
 */
export async function checkFile({ original, start, copy, file, root = dirname(file), includes = [dirname(file)], files = [], console: id = 'gba', shifts = [], build = openBuild({ root, includes, files, console: id, shifts }), only = null, addressOf, isArm = () => false, memories = null, sizeOf = () => null, ruledOut = new Map(), givesBack = () => null, options = {}, seed = options.seed ?? DEFAULTS.seed }) {
  const all = { ...DEFAULTS, ...options };
  const built = await build.link({ file, only, addressOf });
  if (built.error) return { error: built.error };
  if (built.missing.length) return { missing: built.missing };
  const { twins, unknown } = built.unit;
  const functions = built.calls.map(f => ({ ...f, address: f.address | (isArm(f.address) ? 0 : 1), span: (f.address >= CARTRIDGE && sizeOf(f.address)) || 0, unaligned: twins.find(twin => twin.name === f.name)?.unaligned === true }));
  let rom = null;
  const cartridge = (address, size) => (rom ??= readFileSync(copy)).subarray(address - CARTRIDGE, address - CARTRIDGE + size);
  if (functions.length) {
    const registers = await original.registers();
    // a function whose code keeps the display status's address beside it reads whether the display is in the V-blank
    for (const f of functions) f.status = f.span > 0 && holdsWord(cartridge(f.address & ~1, f.span), DISPSTAT);
    const runner = new Twins({ module: built.module, copy, seconds: all.seconds, registers });
    try {
      await compareCalls({ original, twins: runner, start, functions, options: all, choose: chooser(seed), memories, bytesOf: (address, size) => cartridge(address, size), ruledOut, status: registers.readUInt16LE(DISPSTAT - 0x04000000) });
    } finally {
      runner.stop();
    }
  }
  // a twin that gives back nothing, of a function whose callers use what it gives back, differs whatever the memory
  for (const f of functions) {
    const call = f.returns ? null : givesBack(f.address & ~1);
    if (call !== null) f.result = { kind: 'gives', call };
  }
  const asked = name => only === null || twins.find(twin => twin.name === name).address === only;
  return {
    functions: [
      ...functions.map(f => ({ name: f.name, address: f.address & ~1, line: f.line, compared: f.compared, ...whole(f, outcome(f, all), cartridge, ruledOut) })),
      ...twins.filter(twin => twin.address === null && only === null).map(twin => ({ name: twin.name, address: null, line: twin.line })),
      ...unknown.filter(asked).map(name => ({ name, address: twins.find(twin => twin.name === name).address, kind: 'unchecked', line: 'the check can\'t read what it takes and gives back.' })),
    ],
  };
}

// a function found the same, with whether its calls took every path of the original's, which is what makes it a
// proof: `whole`, and after its line what they left out
function whole(f, found, cartridge, ruledOut) {
  if (found.kind !== 'same') return found;
  if (!f.span) return { ...found, whole: false, line: `${found.line}, but the code map has no function there, so which of its paths ran can't be said, and it isn't proven` };
  const { total, left } = pathsLeft(cartridge(f.address & ~1, f.span), f.address & ~1, f.ran, ruledOut);
  if (!left.length) return { ...found, whole: true, line: `${found.line}, which took every path of the original's` };
  const first = left.slice(0, 3).map(([where, how]) => `${at(where)} ${how}`).join(', ');
  return { ...found, whole: false, left, line: `${found.line}, but they left out ${count(left.length)} of the original's ${count(total)} instructions and branch ways, such as ${first}: it's the same as far as they went, and isn't proven until calls take those too` };
}

/**
 * Takes the memories of play for a version's twins, unless the ones kept are from the same copy, functions and
 * recordings: plays the game's recordings, or those of `names`, in the original, and keeps the console's memory as
 * it was when each function at `addresses` started (twin-memories.mjs). Answers them, as openMemories does.
 */
export async function memoriesOfPlay({ game, original, copy, addresses, names = [], folder = join(LOCAL, 'twin', game), log = console.log }) {
  const keysLate = original.keysAfterVBlank === true;
  const recordings = readRecordings(game, names);
  // one console plays them: a recording of several on a link isn't one's play
  const alone = recordings.filter(recording => !recording.players);
  if (!alone.length) throw new Error(`games/${versionOf(game).game}/proof/recordings/ has no recording one console plays${names.length ? ' among those named' : ''}, so there's no play to take memories from.`);
  const plays = alone.map(recording => {
    const way = originalPlay(recording, { keysLate });
    const buttons = way.originalHeld.map(list => list.reduce((mask, button) => mask | (KEY[button] ?? 0), 0));
    if (keysLate) buttons.unshift(0);
    return { name: recording.name, buttons, sets: way.sets.map(({ frame, address, bytes, value }) => ({ frame, address, bytes, value })) };
  });
  const key = memoriesKey({ sha1: original.sha1, addresses, plays });
  const where = inRepo(folder);
  if (hasMemories(folder, key)) log(`The memories of play in ${where}/ are from these recordings and this copy already.`);
  else {
    const frames = plays.reduce((sum, play) => sum + play.buttons.length, 0);
    log(`Playing ${plays.length === 1 ? plays[0].name : `${count(plays.length)} recordings`} in the original, ${count(frames)} frames, for the memory each function starts from…`);
    const began = Date.now();
    const taken = await takeMemories({ open: () => openCaller(copy), addresses, plays, folder, key, log: plays.length > 1 && plays.length <= 12 ? log : () => {} });
    log(`${count(taken.memories)} memories of ${count(taken.functions)} of the ${count(addresses.length)} functions kept in ${where}/, ${(taken.bytes / 1048576).toFixed(1)} MB, in ${count(Math.round((Date.now() - began) / 1000))} seconds. They come from your copy of the game: never put them in a commit, an issue or a pull request.`);
  }
  return openMemories(folder);
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/** The function check of a Game Boy Advance game's version in C: `options.function` names one function, an address
 *  or a name, or every twin is checked; the rest are as DEFAULTS, `addresses` another file of names, and `memories`,
 *  true or a list of recordings, has the calls start from memories of play, taken from those recordings. It prints
 *  what it finds and answers 0, or 3 when a twin differed, stopped or never came back. */
export async function twin(game, options = {}) {
  const log = options.log ?? console.log;
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readCopy(copy.path))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);

  const starts = new Set(codeMap.functions.filter(f => !f.bytes).map(f => f.address));
  // every function the version defines, by name, and every name with an address, as match and the build read them
  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  const addressOf = addressFinder({ named, twins, shifts, startsFunction: address => starts.has(address) });

  let chosen = files.filter(file => twinsOf.get(file).some(t => t.address !== null)), only = null;
  if (all.function) {
    only = twins.get(all.function)?.size === 1 ? [...twins.get(all.function)][0] : resolve(game, codeMap, all.function).address;
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${hex(only)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  ensureCaller(log);
  const rom = readFileSync(copy.path);
  const isArm = address => address >= CARTRIDGE && address % 4 === 0 && address - CARTRIDGE + 16 <= rom.length
    && looksLikeArm([0, 4, 8, 12].map(offset => rom.readUInt32LE(address - CARTRIDGE + offset)));
  // memories of play, for every twin of the version, so one function asked for by itself starts where it does in a
  // check of them all
  const everyAddress = [...new Set(files.flatMap(file => twinsOf.get(file).map(t => t.address)).filter(address => address !== null))].sort((a, b) => a - b);
  const memories = all.memories ? await memoriesOfPlay({ game, original, copy: copy.path, addresses: everyAddress, names: Array.isArray(all.memories) ? all.memories : [], log }) : null;
  const opened = await openOriginal(copy.path, all.frames);
  // the game's own folders, then the build's twins.h for a game that includes it, on the kit of the game's console
  const header = await twinsFolder(folder);
  const build = openBuild({ root: folder, files, shifts, givenOf, console: original.console, includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])] });
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  // what goes in the version's proofs, when it keeps them (../lib/proofs.mjs), each function's paths with the pieces
  // it goes on into by a BL used as a long jump, which the code map keeps as functions of their own
  const sizes = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f.size]));
  for (const [address, size] of withLongJumps(rom, codeMap.functions.filter(f => !f.bytes && f.address >= CARTRIDGE), { isArm })) sizes.set(address, size);
  const givesBack = givesBackUsed(rom, codeMap.functions.filter(f => !f.bytes && f.address >= CARTRIDGE && !isArm(f.address)).map(f => ({ address: f.address, size: f.size })));
  const { ways: ruledOut } = readUnreachable(game);
  const proven = [], differing = [];
  try {
    for (const file of chosen) {
      const result = await checkFile({
        original: opened.original, start: opened.start, copy: copy.path, file, build, only, addressOf, isArm, options: all, memories,
        sizeOf: address => sizes.get(address) ?? null, ruledOut, givesBack,
      });
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
      }
    }
  } finally {
    opened.original.close();
  }
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json (tools/README.md, Matching the original's bytes).`);
  if (failed.length && chosen.length > 1) {
    log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  }
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, ${memories ? `from ${count(memories.count)} memories of play, which ${count(memories.functions)} of the version's functions have their own of` : `${count(all.frames)} frames in`} (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven.length)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  // a proof is found with the game's own names, and over enough calls to be worth the name
  if (!asksForProofs(game)) return totals.differs || totals.never || totals.stopped ? 3 : 0;
  if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}
