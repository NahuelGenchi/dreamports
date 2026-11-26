// The function check for a GameCube game (../twin.mjs): one function of the original, run by itself on Dolphin's own
// interpreter (original.mjs), the processor `prove` runs a game on, and its twin, built as a Dreamport to WebAssembly,
// are called from the same memory, thousands of times, with the same arguments, and what each leaves in the console's
// memory and its hardware's registers, and what each gave back, are compared byte for byte. It's the proof a twin has
// where no compiler gives the original's bytes back (docs/STANDARD.md).
//
// The twins are built as the Nintendo 64's are (../n64/twin.mjs): from the same C the console's compiler builds, with
// the console's addresses given after linking, and then with every address the module reads or writes folded to its
// low 28 bits and every number it moves outside its own values turned round, as the console keeps a number's highest
// byte first (../lib/wasm-fold.mjs). So the C says 0x80361160, through the processor's cache, or 0xC0361160, round it,
// follows the pointer it finds there and adds to a 16-bit field, and what lands in memory is byte for byte what the
// console has; and it says 0xCC002000 for a register of the video interface, which in a call is memory of its own, as
// it is in the original's. A twin names the function of the original it's the twin of in the comment just above it, as
// /** 0x80003100: */ or fn_80003100, and a value the C names and doesn't define is the game's, at the address its
// proof/addresses.json gives, or the one in its label, as lbl_80331234.
//
// A call is made as the console's compilers make one, by the PowerPC's embedded ABI: whole numbers and pointers take
// r3 to r10 in turn, a 64-bit number a pair of them from an odd one, high word first, and floats and doubles f1 to f8,
// each kept as a double, as the floating-point unit keeps a single, a NaN's bits and all. A function gives back what
// its C says in r3, a 64-bit number in r3 and r4, or a float or a double in f1, and keeps r1, r2, r13 to r31 and f14 to
// f31, and the condition register's fields 2 to 4. Each call gets any value in every other register, so a function
// that reads one it wasn't given differs. A function that takes more than fits in those registers isn't checked yet.
//
// What a function is given decides which of its paths run, so the check learns as it goes, as the other consoles' do:
// later calls change a few of the values earlier ones read and give pointers it read as arguments, but never a word that
// points back into the function's own code, which is a switch's table. A function counts as proven only when every
// instruction ran and each branch went both ways.

import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameFolder, REPO } from '../lib/paths.mjs';
import { readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { twinsFolder } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { KEPT_FROM, openBuild } from '../gba/twin.mjs';
import { signatureOf, wrapOf } from '../ps2/twin.mjs';
import { decode } from './ppc.mjs';
import { gamecubeResolve } from './read.mjs';
import { codeOf, findFunctions, gamecubeCode } from './functions.mjs';
import { dolHeader } from '../../kit/copy/gcm.js';
import { addressAt, buildCaller, CAME_BACK, CR, CTR, ELSEWHERE, endText, EXCEPTION, FPSCR, GQR, hex, IMAGE, inImage, Original, OUT_OF_STEPS, RAM, STATE, XER } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// what openBuild names the function a call through a pointer meets when nothing built is the twin of its address
const NO_CODE = '__twin_no_code';
// what wrapOf adds to a call's name for the function that gives its types (../ps2/twin.mjs)
const TYPES = '__types';
// the addresses the module reads and writes, folded, and where its own values are, between the console's memory, which
// ends at 24 MB, and the hardware's registers, from 0x0C000000: the numbers it moves there stay in its own order
const MASK = 0x0FFFFFFF;
export const OWN = [0x02000000, 0x0C000000];
export const LAYOUT = { base: OWN[0], memory: 0x0C010000, code: address => address };

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up arguments and values come from, so a run can be had again
  seconds: 2,        // how long a twin may take over one call
  limit: 1000000,    // how many instructions the original may run in one call
};
// how many calls may be made for each one that has to be compared, and how many with none compared before the check
// gives a function up, as one that waits for the hardware, which never changes in a call, never comes back
const TRIES = 4, GIVE_UP = 100;
// where a call's stack starts, near the top of the console's 24 MB, and how far below it the original's own saves go
const STACK = 0x817FFE00, SAVES = 0x10000;
// the registers a function keeps for its caller: r1, r2 and r13 to r31, and the floating-point unit's f14 to f31
const KEPT = [1, 2, ...Array.from({ length: 19 }, (_, i) => 13 + i)], KEPT_FLOATS = Array.from({ length: 18 }, (_, i) => 14 + i);
// the condition register's fields a function keeps, 2 to 4, as bits
const KEPT_CR = 0x000FFF00;
// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];
// doubles at the edges of what the floating-point unit holds, as their bits: zeros, ones, the smallest and largest
// ordinary ones, infinities, a number that isn't one, quiet and signaling, and singles' edges as doubles
const DOUBLE_EDGES = [0n, 0x8000000000000000n, 0x3FF0000000000000n, 0xBFF0000000000000n, 0x0010000000000000n, 0x7FEFFFFFFFFFFFFFn, 0x7FF0000000000000n, 0x7FF8000000000000n,
  0x7FF4000000000000n, 0xFFF0000000000001n, 0x400921FB54442D18n, 0x3810000000000000n, 0x47EFFFFFE0000000n, 0x3FE0000000000000n];
// singles at the edges, as their bits: zeros, ones, the smallest and largest ordinary ones, an infinity, and numbers
// that aren't one, quiet and signaling. The processor keeps a signaling one as it was loaded, and gives back the first
// operand that is a NaN, made quiet; a computer's own sums don't all do that, an ARM processor's giving a signaling
// one before a quiet one, and an x86's a NaN of its own sign, so a twin with them is caught on either
const SINGLE_EDGES = [0, 0x80000000, 0x3F800000, 0xBF800000, 0x00800000, 0x7F7FFFFF, 0x7F800000, 0x7FC00000, 0x7FA00000, 0xFF800001];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(Number(BigInt.asUintN(32, BigInt(address))))}`;
const inMemory = value => (value >>> 0) >= 0x80000000 && (value >>> 0) < 0x80000000 + RAM;
// a double's bits from a single's, as the floating-point unit keeps a single: a NaN with its bits where a double has
// them, as lfs loads it, signaling still, where JavaScript's own conversion makes every NaN quiet
const doubleOf = bits => {
  if ((bits & 0x7F800000) === 0x7F800000 && bits & 0x007FFFFF) return (BigInt(bits >>> 31) << 63n) | 0x7FF0000000000000n | (BigInt(bits & 0x007FFFFF) << 29n);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat32(0, new DataView(Uint32Array.of(bits).buffer).getFloat32(0, true));
  view.setFloat64(0, view.getFloat32(0));
  return view.getBigUint64(0);
};
// a single's bits from a double's, as a single that a double register holds: a NaN with the high bits of what it
// carries, as stfs stores it, signaling or not
const singleOf = bits => {
  if ((bits & 0x7FF0000000000000n) === 0x7FF0000000000000n && bits & 0x000FFFFFFFFFFFFFn) return ((Number(bits >> 63n) << 31) | 0x7F800000 | Number((bits >> 29n) & 0x7FFFFFn)) >>> 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  view.setFloat32(0, view.getFloat64(0));
  return view.getUint32(0);
};

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
  // a number at an edge, a small one, any, or one shaped as an ordinary float near 1
  const number = () => [() => EDGES[below(EDGES.length)], () => below(256), next, () => (0x3E000000 + below(0x2000000)) >>> 0, () => (0x3FC00000 + below(0x800000)) >>> 0][below(5)]() >>> 0;
  // a place in the console's memory, above where programs load and below the stack, or one a call read, on a
  // doubleword now and then, as a 64-bit number or a double needs
  const place = pointers => (pointers.length && below(2) ? pointers[below(pointers.length)] : (0x81000000 + below(0x80000) * (below(2) ? 8 : 4)) >>> 0);
  return {
    next, below,
    /** An argument of a type, { bits, signed, pointer, float }: a number, or a BigInt for 64 bits and for a float, its
     *  double's bits. */
    value(type, pointers) {
      if (type.pointer) return place(pointers);
      if (type.float && type.bits === 32) return doubleOf([() => SINGLE_EDGES[below(SINGLE_EDGES.length)], next, () => (0x3E000000 + below(0x2000000)) >>> 0][below(3)]() >>> 0);
      if (type.float) return [() => DOUBLE_EDGES[below(DOUBLE_EDGES.length)], () => (BigInt(next()) << 32n) | BigInt(next()), () => (BigInt(0x3FC00000 + below(0x800000)) << 32n) | BigInt(next())][below(3)]();
      if (type.bits === 64) return BigInt.asUintN(64, (BigInt(number()) << 32n) | BigInt(number()));
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

/** A type as the PowerPC's calls carry it, { bits, signed, pointer, float }, from the compiler's word on it (wrapOf):
 *  a whole number, an enum or a pointer, a float and a double. null for what no register carries: a struct or a union
 *  as it is, and anything longer than 64 bits. */
export function typeOf(code) {
  const bytes = code & 0xFF, kind = (code >>> 8) & 0xFF, signed = Boolean(code >>> 16 & 1);
  if (kind === 5) return { bits: 32, signed: false, pointer: true };
  if (kind === 8) return bytes === 4 || bytes === 8 ? { bits: bytes * 8, float: true } : null;
  if (kind === 4) return { bits: 8, signed: false, boolean: true };
  if ((kind === 1 || kind === 2 || kind === 3) && [1, 2, 4, 8].includes(bytes)) return { bits: bytes * 8, signed };
  return null;
}

/** Where the embedded ABI puts each argument of `params`: { gpr, gprs, fpr }, the first general register it takes and
 *  how many, or the floating-point register; null for one that would go on the stack. */
export function placesOf(params) {
  let gpr = 3, fpr = 1;
  return params.map(type => {
    if (type.float) return fpr <= 8 ? { gpr: null, gprs: 0, fpr: fpr++ } : null;
    if (type.bits === 64) {
      if (gpr % 2 === 0) gpr++;
      if (gpr + 1 > 10) return null;
      gpr += 2;
      return { gpr: gpr - 2, gprs: 2, fpr: null };
    }
    return gpr <= 10 ? { gpr: gpr++, gprs: 1, fpr: null } : null;
  });
}

/** The two registers the program reaches its small values through, r2 and r13, as its start sets them, with lis and
 *  addi or ori, or null for one it never sets. */
export function anchorsOf(dol) {
  const { entry, sections } = codeOf(dol), set = {};
  const section = sections.find(s => entry >= s.address && entry < s.address + s.bytes.length);
  if (!section) return { r2: null, r13: null };
  const high = {};
  for (let address = entry; address < entry + 256 * 4 && address + 4 <= section.address + section.bytes.length; address += 4) {
    const found = decode(section.bytes.readUInt32BE(address - section.address), address);
    if (!found) continue;
    if (found.name === 'lis' && (found.rd === 2 || found.rd === 13)) high[found.rd] = (found.uimm << 16) >>> 0;
    else if (found.op === 14 && (found.rd === 2 || found.rd === 13) && found.ra === found.rd && high[found.rd] !== undefined) set[found.rd] ??= (high[found.rd] + found.simm) >>> 0;
    else if (found.op === 24 && (found.ra === 2 || found.ra === 13) && found.rd === found.ra && high[found.ra] !== undefined) set[found.ra] ??= (high[found.ra] | found.uimm) >>> 0;
  }
  return { r2: set[2] ?? null, r13: set[13] ?? null };
}

/** Each instruction of a function and, of those, the conditional branches, as offsets in it, for waysLeft. */
export function instructionsOf(dol, f) {
  const { sections } = codeOf(dol), instructions = new Set(), branches = new Set();
  const section = sections.find(s => f.address >= s.address && f.address < s.address + s.bytes.length);
  if (!section) return { instructions, branches };
  for (let offset = 0; offset < f.size && f.address + offset + 4 <= section.address + section.bytes.length; offset += 4) {
    const word = section.bytes.readUInt32BE(f.address + offset - section.address), found = decode(word, f.address + offset);
    if (!found) continue;
    instructions.add(offset);
    const op = word >>> 26, xo = (word >>> 1) & 0x3FF;
    if ((op === 16 || (op === 19 && (xo === 16 || xo === 528))) && ((word >>> 21) & 0x14) !== 0x14) branches.add(offset);
  }
  return { instructions, branches };
}

/** The image every call starts from: the program's sections where the DOL puts them, and nothing else. */
export function imageOf(dol) {
  const header = dolHeader(dol), image = new Uint8Array(IMAGE);
  for (const { at, address, size } of header.sections) {
    if (inImage(address) < 0 || inImage(address) + size > RAM || address + size > STACK - SAVES) throw new Error(`The program loads at ${at(address)}, ${count(size)} bytes, where the check's stack can't be.`);
    image.set(dol.subarray(at, at + size), inImage(address));
  }
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

  /** The compiler's word on each of a twin's types, its arguments' and then what it gives back (wrapOf). */
  async types(name, count) {
    if (!this.worker) await this.start();
    return (await this.ask({ types: `${name}${TYPES}`, count })).types;
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

// a double register's two words, for a call's state
const putDouble = (state, n, bits) => {
  state[32 + n * 2] = Number(bits >> 32n);
  state[33 + n * 2] = Number(bits & 0xFFFFFFFFn);
};
const doubleAt = (state, n) => (BigInt(state[32 + n * 2]) << 32n) | BigInt(state[33 + n * 2]);

/**
 * Calls one function of the original and its twin until `options.calls` calls were compared, each from the image with
 * a few values changed. `f` is { name, address, size, params, returns, call, code }, its types as typeOf gives them.
 * Answers what the check came to: { compared, aside, ran, result }, `result` null while every call compared was the
 * same, or what wasn't.
 */
async function checkFunction({ f, original, runner, anchors, options, choose }) {
  const pool = new Map(), pointers = [], ran = new Map(), aside = {};
  const places = placesOf(f.params);
  // the original's own saves below its stack, which a twin keeps in its own stack, and the word above it where a
  // function keeps the link register for its caller, as the embedded ABI has every function do
  const skip = [[inImage(STACK - SAVES), inImage(STACK) + 8]];
  // a place the original read, which later calls may change: in the console's memory or the hardware's registers, but
  // the stack and the function's own code
  const read = address => inImage(address) >= 0 && !(inImage(address) >= inImage(STACK - SAVES) && inImage(address) < inImage(STACK) + 0x100) && !(address >= f.code.from && address < f.code.to);
  let compared = 0, number = 0;
  while (compared < options.calls && number < options.calls * TRIES && (compared || number < GIVE_UP)) {
    number++;
    const args = f.params.map(type => choose.value(type, pointers));
    // now and then an argument the same as an earlier one of its type, as whether two are the same is what many a
    // branch asks
    if (args.length > 1 && !choose.below(8)) {
      const k = 1 + choose.below(args.length - 1), j = choose.below(k);
      if (JSON.stringify(f.params[j]) === JSON.stringify(f.params[k])) args[k] = args[j];
    }
    const changes = [];
    if (pool.size && choose.below(2)) {
      // half the time the places a pointer it's given points near, as what a function reads through a pointer is
      // where its paths and its sums are decided
      const near = [...pool].filter(([address]) => f.params.some((type, k) => type.pointer && address >= args[k] && address < args[k] + 0x40));
      const from = near.length && choose.below(2) ? near : [...pool];
      for (let k = 1 + choose.below(3); k; k--) {
        const [address, bytes] = from[choose.below(from.length)];
        changes.push([address, bytes, choose.sized(bytes, pointers)]);
      }
    }
    // every register any value, but what a call gives: the stack, the anchors, and the arguments
    const state = Array.from({ length: STATE }, () => choose.next());
    for (let n = 0; n < 32; n++) putDouble(state, n, (BigInt(choose.next()) << 32n) | BigInt(choose.next()));
    state[1] = STACK;
    if (anchors.r2 !== null) state[2] = anchors.r2;
    if (anchors.r13 !== null) state[13] = anchors.r13;
    state[XER] &= 0xE000007F;
    state[FPSCR] = 0;
    for (let n = 0; n < 8; n++) state[GQR + n] = 0;
    f.params.forEach((type, k) => {
      const place = places[k], value = BigInt.asUintN(64, BigInt(args[k]));
      if (place.fpr !== null) putDouble(state, place.fpr, value);
      else if (place.gprs === 2) {
        state[place.gpr] = Number(value >> 32n);
        state[place.gpr + 1] = Number(value & 0xFFFFFFFFn);
      } else state[place.gpr] = Number(value & 0xFFFFFFFFn);
    });
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, state, changes });
    for (const { address, bytes, value } of answer.reads) {
      // a word that points back into the function's own code is a switch's table, the compiler's and not the caller's
      if (!read(address) || bytes > 4 || (value >= f.code.from && value < f.code.to)) continue;
      pool.set(address >>> 0, bytes);
      // a pointer it read, and the place it read, which a later call may be given as a pointer
      for (const place of [value >>> 0, address >>> 0]) if (inMemory(place) && pointers.length < 256 && !pointers.includes(place)) pointers.push(place);
    }
    const reason = answer.end === CAME_BACK ? null
      : answer.end === ELSEWHERE ? 'elsewhere' : answer.end === EXCEPTION ? 'exception' : answer.end === OUT_OF_STEPS ? 'steps' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    const left = answer.state;
    const changed = KEPT.find(i => left[i] !== (state[i] >>> 0)) ?? (KEPT_FLOATS.find(n => doubleAt(left, n) !== doubleAt(state, n)) ?? NaN) + 100;
    const crChanged = ((left[CR] ^ state[CR]) & KEPT_CR) !== 0;
    if (!Number.isNaN(changed) || crChanged) {
      aside.kept = (aside.kept ?? 0) + 1;
      aside.keptText ??= crChanged ? 'the condition register\'s fields 2 to 4' : changed >= 100 ? `f${changed - 100}` : `r${changed}`;
      continue;
    }
    // a float crosses to the twin as its own bits, where the original's register keeps it as a double
    const given = args.map((value, k) => (f.params[k].float && f.params[k].bits === 32 ? BigInt(singleOf(BigInt(value))) : value));
    const twin = await runner.call(f.call, given, changes, answer.chunks, skip);
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
    if (f.returns) {
      const { bits, float, signed } = f.returns;
      const theirs = float ? (bits === 64 ? doubleAt(left, 1) : BigInt(singleOf(doubleAt(left, 1))))
        : bits === 64 ? (BigInt(left[3]) << 32n) | BigInt(left[4]) : BigInt(left[3] >>> 0);
      const gave = BigInt.asUintN(64, BigInt(twin.gave));
      const ours = float ? (bits === 64 ? gave : gave & 0xFFFFFFFFn)
        : bits === 64 ? gave : BigInt.asUintN(32, bits === 32 ? gave : signed ? BigInt.asIntN(bits, gave) : BigInt.asUintN(bits, gave));
      if (ours !== theirs) return { compared, aside, ran, result: { kind: 'differs', gave: { ours, theirs, bits: float || bits === 64 ? bits : 32, float: Boolean(float) }, ...call } };
    }
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: { ...addressAt(twin.differs.at), ours: twin.differs.ours, theirs: twin.differs.theirs }, ...call } };
    compared++;
    answer.ran.forEach((ways, i) => { if (ways) ran.set(f.address + i * 4, (ran.get(f.address + i * 4) ?? 0) | ways); });
  }
  return { compared, aside, ran, result: null };
}

const valueText = value => (typeof value === 'bigint' ? `0x${value.toString(16).toUpperCase().padStart(16, '0')}` : at(value));

/** A call as a line says it: its number, the function with what it was given, and what was changed for it. */
export function callText(name, { number, args, changes }) {
  const set = changes.length ? `, after ${changes.map(([address, bytes, value]) => `${at(address)} was set to 0x${(value >>> 0).toString(16).toUpperCase().padStart(bytes * 2, '0')}`).join(' and ')}` : '';
  return `call ${count(number)}, ${name}(${args.map(valueText).join(', ')})${set}`;
}

/** What a function's check came to, as { kind, line }: `kind` is 'same', 'differs', 'never', 'stopped', 'few' or
 *  'unchecked', and `line` what to say after its address and name. */
export function outcome(f, { compared, aside, result }, { calls, seconds }) {
  const byte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const hardware = result?.hardware ? ' The original used the hardware\'s registers in this call, which are compared as memory.' : '';
  if (result?.kind === 'differs') {
    const word = value => `0x${value.toString(16).toUpperCase().padStart(result.gave.bits / 4, '0')}`;
    const gave = result.gave ? `the twin gave back ${word(result.gave.ours)} and the original ${word(result.gave.theirs)}${result.gave.float ? `, as ${result.gave.bits === 64 ? 'doubles\'' : 'floats\''} bits` : ''}` : null;
    const memory = result.memory ? `at ${at(result.memory.address)}, in ${result.memory.name}, the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}` : null;
    return { kind: 'differs', line: `${callText(f.name, result)}: ${[memory, gave].filter(Boolean).join(', and ')}.${hardware}` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, result)}: the original came back and the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  // what kept the rest from being compared, the most common first
  const why = Object.entries({
    elsewhere: `the original ${aside.elsewhereText}`,
    exception: `the original ${aside.exceptionText}, where the console stops`,
    steps: `the original ${aside.stepsText ?? 'didn\'t come back'} within ${count(DEFAULTS.limit)} instructions`,
    kept: `the original changed ${aside.keptText}, which a function keeps for its caller`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/** How the twins of a GameCube version are built: as a Dreamport is, on its console's kit in C, with each call's types
 *  said by the compiler (wrapOf) and the console's layout. */
export const buildFor = ({ root, files = [root], shifts = [], givenOf, includes }) => openBuild({ root, files, shifts, givenOf, console: 'gamecube', layout: LAYOUT, signature: signatureOf, wrap: wrapOf, ...(includes ? { includes } : {}) });

/**
 * Checks the twins of one file of C against a GameCube program, `dol`, with `build`, as buildFor gives one, `only` the
 * address of the one function to check or null, `addressOf(name)` where the console keeps a value, and
 * `sizeOf(address)` how long the original's function there is. Answers { error }, { missing }, or { functions }, each
 * { name, address, kind, line, compared, whole, left }.
 */
export async function checkFile({ dol, build, file, only = null, addressOf, sizeOf, original, options = {}, ruledOut = new Map(), log = () => {} }) {
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
    if (linked.unit.unknown.includes(twin.name)) functions.push({ name: twin.name, address: twin.address, kind: 'unchecked', line: 'it takes or gives something no register carries, as a struct as it is' });
  }
  const runner = new Runner(foldAddresses(linked.module, MASK, { own: OWN }), all.seconds);
  try {
    const image = imageOf(dol);
    await original.image(image);
    await runner.set(image);
    const choose = chooser(all.seed), anchors = anchorsOf(dol);
    for (const call of linked.calls) {
      const size = sizeOf(call.address);
      if (!size) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'no function of the code map starts there' });
        continue;
      }
      const codes = await runner.types(call.call, call.params.length + (call.returns ? 1 : 0));
      const types = codes.map(typeOf);
      if (types.some(type => type === null)) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'it takes or gives something no register carries, as a struct as it is' });
        continue;
      }
      const params = types.slice(0, call.params.length);
      if (placesOf(params).some(place => place === null)) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'it takes more than fits in the registers a call is given, which the check doesn\'t put on the stack yet' });
        continue;
      }
      const f = { ...call, params, returns: call.returns ? types.at(-1) : null, size, code: { from: call.address, to: call.address + size } };
      const checked = await checkFunction({ f, original, runner, anchors, options: all, choose });
      const { kind, line } = outcome(f, checked, all);
      const { total, left } = waysLeft(instructionsOf(dol, f), f.address, checked.ran, ruledOut);
      functions.push({ name: f.name, address: f.address, kind, line, compared: checked.compared, whole: kind === 'same' && !left.length, left, total });
      log(f.name);
    }
  } finally {
    await runner.close();
  }
  return { functions };
}

/** The function check of a GameCube game's version in C, as the tool runs it: 0, or 3 when a twin isn't the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  // a game's name alone means its version in C
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.memories) throw new Error('--memories isn\'t there yet on the GameCube: every call starts from the program as the DOL loads it.');
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the GameCube every call starts from the program as the DOL loads it.');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  // the program, and every module of the disc, kept on this computer too for a proof's mark (../lib/proofs.mjs)
  const dol = (await gamecubeCode(copy.path, original.sha1)).boot;

  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  // a value is the game's, at the address its proof/addresses.json gives, a twin's, or the one in its label
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null) ?? (/^[A-Za-z][A-Za-z0-9]*_(8[01][0-9A-Fa-f]{6})$/.exec(name) ? parseInt(name.slice(-8), 16) : null);
  let chosen = files.filter(file => twinsOf.get(file).some(t => t.address !== null)), only = null;
  if (all.function) {
    only = twins.get(all.function)?.size === 1 ? [...twins.get(all.function)][0] : gamecubeResolve(game, codeMap, all.function).address;
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${hex(only)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  const sizes = new Map(codeMap.functions.filter(f => !f.bytes && !f.program).map(f => [f.address, f.size]));
  const found = new Map(findFunctions(dol).map(f => [f.address, f.size]));
  const header = await twinsFolder(folder);
  const build = buildFor({ root: folder, files, shifts, givenOf, includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])] });
  const { ways: ruledOut } = readUnreachable(game);
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  const proven = [], differing = [];
  const caller = new Original(buildCaller(log), copy.path);
  try {
    for (const file of chosen) {
      const result = await checkFile({ dol, build, file, only, addressOf, sizeOf: address => sizes.get(address) ?? found.get(address) ?? null, original: caller, options: all, ruledOut });
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
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as lbl_80331234.`);
  if (failed.length && chosen.length > 1) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, from the program as the DOL loads it (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven.length)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  // a proof is found with the game's own names, and over enough calls to be worth the name, as on the Game Boy Advance
  if (!asksForProofs(game)) return totals.differs || totals.never || totals.stopped ? 3 : 0;
  if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}
