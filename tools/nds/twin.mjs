// The function check for a Nintendo DS game (../twin.mjs): one function of the original, run in melonDS's own
// processor (call.cpp, original.mjs), the ARM946E-S for a function of the ARM9's program or of one of its overlays and
// the ARM7TDMI for one of the ARM7's, in ARM or in Thumb code as the code map says, and its twin, built as a Dreamport
// to WebAssembly, are called from the same memory, thousands of times, with the same arguments, and what each leaves in
// the console's main memory, and what each gave back, are compared byte for byte. It's the proof a twin has where no
// compiler gives the original's bytes back (docs/STANDARD.md).
//
// The twins are built as the Game Boy Advance's are (../gba/twin.mjs, openBuild), from the same C the build builds,
// on the console's kit in C, with the console's addresses given after linking, and then with every address the module
// reads or writes folded by its top byte (../lib/wasm-fold.mjs): so the C says 0x02104A30, keeps 0x027FFC00 in memory
// as a pointer and follows it, and each lands in the console's main memory, 4 MB at 0x02000000 and seen again every
// 4 MB up to 0x02FFFFFF, at the module's 0. A twin names the function of the original it's the twin of in the comment
// just above it, as /** 0x02001234: */ or func_02001234, and one of another program than the ARM9's own by its key in
// the code map, as /** 0x02380120@ARM7: */ or /** 0x021D0E40@OVERLAY9_0003: */. A value the C names and doesn't
// define is the game's, at the address its proof/addresses.json gives, or the one in its label, as gUnknown_02104A30.
//
// What the check covers of the console's memory is its main memory and nothing else yet. The ARM9's two fast
// memories, the memory the two processors share at 0x03000000 and the ARM7's own beside it, the hardware's registers,
// the palettes, the video memory and the sprites' are not there: an original that reads or writes one, or runs in
// one, as an ARM7 program loaded in its own memory does, stops, its call is left out and the function says why, and
// a twin that writes one is found, as the original left it alone. So is an original that goes into the BIOS, as a
// call of the BIOS does, that uses the system control coprocessor, or that leaves the processor's mode or its
// interrupt bits other than it found them, as what turns interrupts off does: no twin is given those yet.
//
// A call is made as the console's compilers make one: the first four arguments in r0 to r3, the rest on the stack,
// each spread to 32 bits as its type says, as a caller does; sp in the main memory, where the check keeps its stack,
// as the console's own is in a memory the check doesn't have; lr where it comes back to; and any value in every other
// register and in the flags, so a function that reads one it wasn't given differs. A function gives back what its C
// says in r0, and has to leave r4 to r11 and sp as it found them. The original's own saves on the stack, below where
// the call starts it, aren't compared, as a twin keeps those in its own stack.
//
// What a function is given decides which of its paths run, so the check learns as it goes, as the PlayStation's does:
// the original says what each call read, and later calls change a few of those values, mostly to numbers at the edges
// of what a value holds, and give pointers it read as arguments, but never a value an instruction read from beside
// itself, which is the compiler's own, kept after a function's code. The same memory is a proof of the paths the calls
// took, and of no other, so the original also says which of its instructions ran, which way each Thumb branch went and,
// in ARM code, where any instruction can have a condition, whether each one's held, and a function counts as proven
// only when every instruction ran and each condition both held and didn't (../lib/played.mjs).

import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameFolder, REPO } from '../lib/paths.mjs';
import { functionKey, hex, readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { twinsFolder } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { KEPT_FROM, openBuild } from '../gba/twin.mjs';
import { bytesAt, findFunctions, ndsCartridge } from './functions.mjs';
import { buildCaller, CAME_BACK, COPROCESSOR, ELSEWHERE, endText, IMAGE, inBios, inImage, inMemory, MEMORY, MEMORY_END, Original, OUT_OF_STEPS, RAM } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// what openBuild names the function a call through a pointer meets when nothing built is the twin of its address
const NO_CODE = '__twin_no_code';
// Where the module keeps what isn't the console's main memory, right after its 4 MB: where every address the check
// has no memory for goes, the table it folds by, and the map of pages a call wrote. Its own values and stack start at
// 0x0B000000, a place no address of the console's has.
const NOWHERE = { at: RAM, bytes: 0x00100000 }, TABLE = 0x00500000, WRITTEN = 0x00510000, OWN = 0x0B000000;

/** The table a module's addresses are folded by, two words for each top byte: what to keep and where it goes. The
 *  main memory and each place it's seen again go to the module's 0; the module's own values and stack, from
 *  0x0B000000 to 0x0FFFFFFF, stay where they are; and every other address goes to `nowhere`. */
export function foldTable() {
  const table = new Uint32Array(512);
  const set = (top, mask, start) => { table[top * 2] = mask; table[top * 2 + 1] = start; };
  for (let top = 0; top < 256; top++) set(top, NOWHERE.bytes - 1, NOWHERE.at);
  for (let top = OWN >>> 24; top <= 0x0F; top++) set(top, 0xFFFFFFFF, 0);
  set(MEMORY >>> 24, RAM - 1, 0);
  return table;
}

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up arguments and values come from, so a run can be had again
  seconds: 2,        // how long a twin may take over one call
  limit: 1000000,    // how many instructions the original may run in one call
};
// how many calls may be made for each one that has to be compared
const TRIES = 4;
// where a call's stack starts, in the main memory below what the console keeps at its top, how far below it the
// original's own saves may go, and where a call comes back to, a place no game has code, as nothing is there until a
// game turns the ARM9's fast memory on
const STACK = 0x023F0000, SAVES = 0x10000, BACK = 0x01FF8000;
// how much of the main memory the pointers the check makes up point into, and where that is unless a program is there
const PLACES = 0x40000, PLACES_AT = 0x02300000;
// the registers a function keeps for its caller: r4 to r11 and sp
const KEPT = [4, 5, 6, 7, 8, 9, 10, 11, 13];
// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(address >>> 0)}`;
// an address of the main memory as its first 4 MB have it
const first = address => (MEMORY | ((address >>> 0) & (RAM - 1))) >>> 0;

/** What makes up arguments and values, the same from the same seed: `places` is where its pointers point. */
export function chooser(seed, places = PLACES_AT) {
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
  // a place in the console's memory, away from its programs and the stack, or one a call read
  const place = pointers => (pointers.length && below(2) ? pointers[below(pointers.length)] : (places + below(PLACES / 4) * 4) >>> 0);
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

// Thumb instructions neither processor has
const thumbInvalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200 || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800;
// Thumb's ways out of a function: pop with pc, bx, and pc moved or added to
const thumbLeaves = op => (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700 || (op & 0xFF87) === 0x4687 || (op & 0xFF87) === 0x4487;
// ARM's, when nothing makes them wait on a condition: bx, ldm with pc, a load into pc, and pc worked out
const armLeaves = op => (op & 0x0FFFFFF0) === 0x012FFF10 || (op & 0x0E108000) === 0x08108000 || (op & 0x0C10F000) === 0x0410F000
  || ((op & 0x0C00F000) === 0x0000F000 && (op & 0x01900000) !== 0x01000000 && (op & 0x0E000090) !== 0x00000090);

/**
 * The instructions of a function, from its bytes, in ARM code or in Thumb: follows its code from its start and from
 * every place of it known to have run (`seeds`, offsets), through each branch's two ways, to where it returns or
 * leaves, and gives the offsets that hold an instruction and, of those, the ones with a condition, which go one of
 * two ways: { instructions, branches }. In Thumb code those are the conditional branches, and in ARM code every
 * instruction whose condition isn't `always`. `never` maps one's offset to the way it can't go, as a game's
 * unreachable.json says, 1 for its condition holding and 2 for not. What a word of the function that isn't an
 * instruction points to inside it is followed too, as the table of a switch does.
 */
export function instructionsOf(bytes, thumb, seeds = [], never = new Map()) {
  const size = bytes.length, u16 = at => bytes[at] | bytes[at + 1] << 8, u32 = at => (u16(at) | u16(at + 2) << 16) >>> 0;
  const instructions = new Set(), branches = new Set(), work = [0, ...seeds];
  const walk = () => {
    while (work.length) {
      let pc = work.pop();
      while (pc >= 0 && pc + (thumb ? 2 : 4) <= size && !instructions.has(pc)) {
        if (!thumb) {
          const op = u32(pc), condition = op >>> 28;
          instructions.add(pc);
          const branch = (op & 0x0E000000) === 0x0A000000 && condition !== 0xF, target = pc + 8 + ((op & 0xFFFFFF) << 8 >> 6);
          if (condition < 0xE) {
            branches.add(pc);
            if (branch && never.get(pc) !== 1) work.push(target);
            if (never.get(pc) === 2) break;
          } else if (branch && !(op & 0x01000000)) {
            pc = target;
            continue;
          } else if (condition === 0xE && armLeaves(op)) break;
          pc += 4;
          continue;
        }
        const op = u16(pc);
        if ((op & 0xF800) === 0xF000 && pc + 4 <= size && ((u16(pc + 2) & 0xF800) === 0xF800 || (u16(pc + 2) & 0xF801) === 0xE800)) {
          // bl and blx, in two halves, each a step of the processor's
          instructions.add(pc).add(pc + 2);
          pc += 4;
          continue;
        }
        if (thumbInvalid(op) || (op & 0xF800) === 0xF800 || (op & 0xF800) === 0xE800) break;
        instructions.add(pc);
        if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
          branches.add(pc);
          if (never.get(pc) !== 1) work.push(pc + 4 + ((op & 0xFF) << 24 >> 23));
          if (never.get(pc) === 2) break;
        } else if ((op & 0xF800) === 0xE000) {
          pc = pc + 4 + ((op & 0x7FF) << 21 >> 20);
          continue;
        } else if (thumbLeaves(op)) break;
        pc += 2;
      }
    }
  };
  for (;;) {
    walk();
    const before = instructions.size;
    for (let word = 0; word + 4 <= size; word += 4) {
      if (instructions.has(word) || instructions.has(word + 2)) continue;
      const target = u32(word) & ~1;
      if (target >= bytes.address && target - bytes.address < size && !instructions.has(target - bytes.address)) work.push(target - bytes.address);
    }
    walk();
    if (instructions.size === before) break;
  }
  return { instructions, branches };
}

/** The image every call of a program's functions starts from: the ARM9's program and the ARM7's where each runs in the
 *  main memory, with `program`, an overlay, over them where it's loaded. Answers { image, taken }, `taken` each
 *  stretch of the memory a program is in, [from, to). */
export function imageOf(code, program = null) {
  const image = new Uint8Array(IMAGE), taken = [];
  for (const each of code.programs) {
    if (each.name !== null && each.name !== 'ARM7' && each.name !== program) continue;
    for (const segment of each.segments) {
      if (!inMemory(segment.address) || !inMemory(segment.address + Math.max(segment.bytes.length, 1) - 1)) continue;
      const from = inImage(segment.address), bytes = segment.bytes.subarray(0, Math.max(0, RAM - from));
      image.set(bytes, from);
      taken.push([from, from + bytes.length]);
    }
  }
  return { image, taken };
}

// where the check's made-up pointers point: PLACES bytes of the main memory no program is loaded in, below the stack
function placesFor(taken) {
  const free = from => !taken.some(([start, end]) => start < from + PLACES && end > from);
  for (let from = inImage(PLACES_AT); from >= 0x100000; from -= 0x10000) if (free(from)) return (MEMORY + from) >>> 0;
  return PLACES_AT;
}

// The thread that runs the twins of one module, started again when a twin doesn't come back in time.
class Runner {
  constructor(module, seconds) {
    this.module = module;
    this.seconds = seconds;
    this.image = null;
  }

  async start() {
    this.worker = new Worker(WORKER, { workerData: { module: this.module, table: foldTable(), tableAt: TABLE, written: WRITTEN, nowhere: NOWHERE, image: IMAGE, noCode: NO_CODE } });
    this.waiting = null;
    this.worker.on('message', message => this.waiting?.(message));
    this.worker.on('error', error => this.waiting?.({ stopped: String(error.message ?? error) }));
    const ready = await this.next();
    if (ready.stopped) throw new Error(ready.stopped);
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
 * a few values changed. `f` is { name, address, size, thumb, arm7, params, returns, call }. Answers what the check
 * came to: { compared, aside, ran, result }, `result` null while every call compared was the same, or what wasn't.
 */
async function checkFunction({ f, original, runner, options, choose }) {
  const pool = new Map(), pointers = [], ran = new Map(), aside = {};
  const extra = Math.max(0, f.params.length - 4);
  // the original's own saves below its stack, and what's above it that the call is given and may change, its
  // arguments past the fourth, as places in the image
  const top = inImage(STACK), skip = [[top - SAVES, top + 4 * extra]];
  const inCode = address => first(address) >= f.address && first(address) < f.address + f.size;
  const read = address => inMemory(address) && !(inImage(address) >= skip[0][0] && inImage(address) < skip[0][1]) && !inCode(address);
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
    args.slice(4).forEach((value, i) => changes.push([STACK + 4 * i, 4, value]));
    // r0 to r3 the arguments, or anything; r4 to r12 anything; sp, lr, and the flags, anything
    const registers = Array.from({ length: 16 }, (_, i) => (i < 4 ? args[i] ?? choose.next() : i === 13 ? STACK : i === 14 ? (BACK | (f.thumb ? 1 : 0)) >>> 0 : i === 15 ? (choose.next() & 0xF0000000) >>> 0 : choose.next()));
    const answer = await original.call({ address: f.address, span: f.size, thumb: f.thumb, arm7: f.arm7, limit: options.limit, registers, changes });
    for (const { address, bytes, value, beside } of answer.reads) {
      // a value an instruction read from beside itself is the compiler's, and so is a word that points back into the
      // function's own code, a switch's table
      if (beside || !read(address) || (bytes === 4 && inMemory(value) && inCode(value))) continue;
      pool.set(address, bytes);
      if (bytes === 4 && inMemory(value) && pointers.length < 256 && !pointers.includes(value >>> 0)) pointers.push(value >>> 0);
    }
    const reason = answer.end === CAME_BACK ? null
      : answer.end === ELSEWHERE ? (inBios(answer.detail, f.arm7) ? 'bios' : 'elsewhere')
        : answer.end === MEMORY_END ? 'memory' : answer.end === OUT_OF_STEPS ? 'steps' : answer.end === COPROCESSOR ? 'coprocessor' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer, f.arm7);
      continue;
    }
    if (answer.status) {
      aside.status = (aside.status ?? 0) + 1;
      continue;
    }
    const changed = KEPT.find(i => answer.registers[i] >>> 0 !== registers[i] >>> 0);
    if (changed !== undefined) {
      aside.kept = (aside.kept ?? 0) + 1;
      aside.keptText ??= changed === 13 ? 'sp' : `r${changed}`;
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
    const r0 = answer.registers[0] >>> 0;
    if (f.returns && twin.gave !== r0) return { compared, aside, ran, result: { kind: 'differs', gave: { ours: twin.gave, theirs: r0 }, ...call } };
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: { at: twin.differs.at, ours: twin.differs.ours, theirs: twin.differs.theirs }, ...call } };
    compared++;
    answer.ran.forEach((ways, i) => { if (ways) ran.set(f.address + i * 2, (ran.get(f.address + i * 2) ?? 0) | ways); });
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
  if (result?.kind === 'differs') {
    const gave = result.gave ? `the twin gave back ${at(result.gave.ours)} and the original ${at(result.gave.theirs)}` : null;
    // a place past the image is one the console has no main memory at, which only says how far into its 16 MB it is
    const memory = !result.memory ? null : result.memory.at < IMAGE
      ? `at ${at(MEMORY + result.memory.at)}, in the console's main memory, the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}`
      : `the twin wrote outside the console's main memory, at an address that ends in ${(result.memory.at - NOWHERE.at).toString(16).toUpperCase().padStart(5, '0')}, such as a register of the hardware's, where the original wrote nothing`;
    return { kind: 'differs', line: `${callText(f.name, result)}: ${[memory, gave].filter(Boolean).join(', and ')}.` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, result)}: the original came back and the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  // what kept the rest from being compared, the most common first
  const why = Object.entries({
    bios: `the original ${aside.biosText}, which a twin asks the kit for`,
    elsewhere: `the original ${aside.elsewhereText}`,
    memory: `the original ${aside.memoryText}`,
    steps: `the original didn't come back within ${count(DEFAULTS.limit)} instructions`,
    coprocessor: `the original ${aside.coprocessorText}`,
    status: 'the original left the processor\'s mode or its interrupt bits other than it found them, which no twin is given yet',
    kept: `the original changed ${aside.keptText}, which a function keeps for its caller`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };
// what a function's calls left out, as waysLeft says it, in the words of a processor whose every instruction can wait
// on a condition
const LEFT = { 'never ran': 'never ran', 'never taken': 'its condition never held', 'always taken': 'its condition always held' };

/** The twins a build of one program has: those of the ARM9's own program, each at the address its comment names, with
 *  `program` null, and with an overlay's name those too, as they're in memory with it, and the overlay's own, each
 *  named by its key; or with 'ARM7', the ARM7's only. For openBuild's `placed`. */
export const placedIn = program => twin => (twin.keyed ? (twin.keyed.program === program && !twin.keyed.vu ? twin.keyed.address : null) : program === 'ARM7' ? null : twin.address);

/**
 * Checks the twins of one file of C against one program of a Nintendo DS cartridge: `code`, as ndsCartridge reads it,
 * `program`, the program's name as a code map's keys have it, or null for the ARM9's own, `build`, as openBuild gives
 * one with `placed: placedIn(program)`, `only` the address of the one function to check or null, `addressOf(name)`
 * where the console keeps a value, and `functionOf(address)` the function of that program the code map has there,
 * { size, mode }, or null. Answers { error }, { missing }, or { functions }, each { name, address, kind, line,
 * compared, whole, left }.
 */
export async function checkFile({ code, program = null, build, file, only = null, addressOf, functionOf, original, options = {}, ruledOut = new Map(), log = () => {} }) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const linked = await build.link({ file, only, addressOf });
  if (linked.error) return { error: linked.error };
  if (linked.missing.length) return { missing: linked.missing };
  const functions = [];
  for (const twin of linked.unit.twins) {
    if (twin.address === null || (only !== null && twin.address !== only)) {
      // a twin of another program's function has its address in a build of that program, and one that names no
      // function is said once, with the ARM9's own
      if (twin.address === null && only === null && !twin.keyed && program === null) functions.push({ name: twin.name, address: null, line: twin.line });
      continue;
    }
    if (linked.unit.unknown.includes(twin.name)) functions.push({ name: twin.name, address: twin.address, kind: 'unchecked', line: 'it takes or gives something whole words can\'t carry, as a struct as it is' });
  }
  const runner = new Runner(foldAddresses(linked.module, { table: TABLE, written: WRITTEN }), all.seconds);
  try {
    const { image, taken } = imageOf(code, program);
    if (taken.some(([from, to]) => from < inImage(STACK) + 0x100 && to > inImage(STACK) - SAVES)) throw new Error(`A program of the cartridge is loaded where the check keeps its stack, below ${at(STACK)}.`);
    await original.image(image);
    await runner.set(image);
    const choose = chooser(all.seed, placesFor(taken));
    for (const call of linked.calls) {
      const found = functionOf(call.address);
      if (!found?.size) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'no function of the code map starts there' });
        continue;
      }
      const bytes = bytesAt(code, program, call.address, found.size);
      if (!bytes || !inMemory(call.address)) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: `it runs at ${at(call.address)}, outside the console's main memory, where the check has no memory yet` });
        continue;
      }
      const f = { ...call, size: found.size, thumb: found.mode === 'thumb', arm7: program === 'ARM7' || /^OVERLAY7_/.test(program ?? '') };
      const checked = await checkFunction({ f, original, runner, options: all, choose });
      const { kind, line } = outcome(f, checked, all);
      const within = Object.assign(Buffer.from(bytes), { address: f.address });
      const seeds = [...checked.ran.keys()].map(where => where - f.address);
      const never = new Map([...ruledOut].filter(([where]) => where >= f.address && where < f.address + f.size).map(([where, way]) => [where - f.address, way]));
      const { total, left } = waysLeft(instructionsOf(within, f.thumb, seeds, never), f.address, checked.ran, ruledOut);
      functions.push({ name: f.name, address: f.address, kind, line, compared: checked.compared, whole: kind === 'same' && !left.length, left: left.map(([where, how]) => [where, LEFT[how]]), total });
      log(f.name);
    }
  } finally {
    await runner.close();
  }
  return { functions };
}

// where the module's own values and stack go, how the original keeps a function's address, odd for one in Thumb code,
// and below where a function's address is the module's own
const layoutFor = thumbAt => ({ base: OWN, memory: null, code: address => (thumbAt(address) ? (address | 1) >>> 0 : address), own: MEMORY });

/** A build of a version's twins for one program of the cartridge, as openBuild gives one: `thumbAt(address)` says
 *  whether the function of that program at an address is in Thumb code. */
export function openNdsBuild({ root, files, shifts = [], givenOf = () => null, includes = [root], program = null, thumbAt = () => false }) {
  return openBuild({ root, files, shifts, givenOf, includes, console: 'nds', layout: layoutFor(thumbAt), placed: placedIn(program) });
}

/** The function check of a Nintendo DS game's version in C, as the tool runs it: 0, or 3 when a twin isn't the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  // a game's name alone means its version in C
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the Nintendo DS every call starts from the programs as the console loads them.');
  if (all.memories !== undefined) throw new Error('--memories isn\'t there for a Nintendo DS game yet: every call starts from the programs as the console loads them (docs/CONSOLES.md#the-nintendo-ds).');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const code = ndsCartridge(copy.path);

  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  // each function by its program and address: the code map's, and where it has none, what the finder finds in the copy
  const places = new Map();
  for (const f of findFunctions(code)) places.set(`${f.program ?? ''}:${f.address}`, f);
  for (const f of codeMap.functions.filter(f => !f.bytes)) places.set(`${f.program ?? ''}:${f.address}`, f);
  const functionOf = program => address => places.get(`${program ?? ''}:${address}`) ?? null;
  const thumbAt = program => address => functionOf(program)(address & ~1)?.mode === 'thumb';
  // a value is the game's, at the address its proof/addresses.json gives, a twin's, kept odd for Thumb code, or the one in its label
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? layoutFor(thumbAt(null)).code([...twins.get(name)][0]) : null) ?? (/^[A-Za-z][A-Za-z0-9]*_(02[0-9A-Fa-f]{6})$/.exec(name) ? parseInt(name.slice(-8), 16) : null);
  // every twin with the program it's of and its address there
  const every = files.flatMap(file => twinsOf.get(file).filter(t => t.address !== null || (t.keyed && !t.keyed.vu)).map(t => ({ file, name: t.name, program: t.keyed?.program ?? null, address: t.keyed?.address ?? t.address })));
  let chosen = every, only = null;
  if (all.function) {
    // by the twin's own name, or by the function's key, its address or its label, as 02380120@ARM7, 0x02001234 or func_02001234
    const typed = /^(?:0x|[A-Za-z][A-Za-z0-9]*_)?([0-9A-Fa-f]{1,8})(?:@(\S+))?$/.exec(all.function), byName = every.filter(t => t.name === all.function);
    only = byName.length === 1 ? byName[0] : typed ? { program: typed[2] ?? null, address: parseInt(typed[1], 16) & ~1 } : codeMap.functions.find(f => f.name === all.function && !f.bytes) ?? null;
    if (!only) throw new Error(`${all.function} isn't a function of games/${game}/ nor of its code map: name a twin, or a function by its address, as 0x02001234, or by its key, as 02380120@ARM7.`);
    only = { program: only.program ?? null, address: only.address };
    chosen = every.filter(t => t.program === only.program && t.address === only.address);
    if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${functionKey(only)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  const header = await twinsFolder(folder);
  const includes = [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])];
  const { ways: ruledOut } = readUnreachable(game);
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  const proven = [], differing = [];
  const caller = new Original(buildCaller(log));
  try {
    // a program at a time, the ARM9's own first, each with a build of its own, as each has its own addresses
    const programs = [...new Set(chosen.map(t => t.program))].sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : 1));
    for (const program of programs) {
      if (program !== null && !code.programs.some(each => each.name === program)) {
        const own = chosen.filter(t => t.program === program);
        log(`Your copy has no ${program}, which ${count(own.length)} twin${own.length === 1 ? '' : 's'} name${own.length === 1 ? 's' : ''}: npm run dp -- codemap ${base} lists the cartridge's programs.`);
        totals.unchecked += own.length;
        continue;
      }
      const build = openNdsBuild({ root: folder, files, shifts, givenOf, includes, program, thumbAt: thumbAt(program) });
      for (const file of [...new Set(chosen.filter(t => t.program === program).map(t => t.file))]) {
        const result = await checkFile({ code, program, build, file, only: only?.address ?? null, addressOf, functionOf: functionOf(program), original: caller, options: all, ruledOut });
        const where = `${inRepo(file)}${program ? `, ${program}` : ''}`;
        if (result.error) {
          const said = result.error.split('\n');
          if (chosen.length === 1 || only) log(`${where}\n  Didn't build: ${said.join('\n  ')}`);
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
          const key = functionKey({ address: f.address, ...(program ? { program } : {}) });
          totals[f.kind]++;
          if (f.whole) proven.push({ key, calls: f.compared });
          else if (['differs', 'never', 'stopped'].includes(f.kind)) differing.push(key);
          log(`  ${LABELS[f.kind]}  0x${key} ${f.name}${f.kind === 'same' ? ', ' : ': '}${f.line}`);
          if (f.kind === 'same' && f.left.length) log(`    Its calls left out ${count(f.left.length)} of its ${count(f.total)} instructions and the ways they go, such as ${f.left.slice(0, 3).map(([address, how]) => `${at(address)} ${how}`).join(', ')}: it isn't proven until calls take those too.`);
        }
      }
    }
  } finally {
    caller.close();
  }
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as gUnknown_02104A30.`);
  if (failed.length && chosen.length > 1 && !only) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, from the programs as the console loads them (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven.length)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  // a proof is found with the game's own names, and over enough calls to be worth the name, as on the Game Boy Advance
  if (!asksForProofs(game)) return totals.differs || totals.never || totals.stopped ? 3 : 0;
  if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}
