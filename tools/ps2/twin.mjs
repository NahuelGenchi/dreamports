// The function check for a PlayStation 2 game (../twin.mjs): one function of the original, run in Play!'s own processor
// code (call.cpp, original.mjs), and its twin, built as a Dreamport to WebAssembly, are called from the same memory,
// thousands of times, with the same arguments, and what each leaves in every memory the EE sees (the console's 32 MB,
// the scratchpad, the hardware's and the GS's registers, the vector units' memories and the IOP's), and what each gave
// back, are compared byte for byte. It's the proof a twin has where no compiler gives the original's bytes back
// (docs/STANDARD.md).
//
// The twins are built as the PlayStation's are (../ps1/twin.mjs), on the console's kit in C, with the console's
// addresses given after linking, and then with every address the module reads or writes folded by its top byte through
// a table (../lib/wasm-fold.mjs), as the console's wiring and its kernel's own TLB entries take them: so the C says
// 0x0012A0B0, 0x70000010 or 0x12000070, keeps pointers to them in memory and follows them, and each lands where the
// original's image has that memory. A twin names the function of the original it's the twin of in the comment just above
// it, as /** 0x00123450: */ or func_00123450, and a value the C names and doesn't define is the game's, at the address
// its proof/addresses.json gives, or the one in its label, as D_00123450.
//
// A call is made as Sony's compiler for the EE makes one: integer arguments in a0 to a3 and then t0 to t3, floats in f12
// to f19, any past those on the stack from where sp points, eight bytes apart, a 32-bit value spread to 64 bits by its
// sign, as the processor keeps one, and the upper half of each of the 128-bit registers left as anything; sp, ra and gp, the register the program reaches its small values through, as the
// program has them; and any value in every other register, so a function that reads one it wasn't given differs. A
// function gives back what its C says in v0, all 64 bits of it, or a float in f0, and keeps s0 to s7, gp, sp, fp and
// f20 to f31 for its caller. The original's own saves on the stack, below where the call starts it, aren't compared, as
// a twin keeps those in its own stack.
//
// Every call starts from the program as the console loads it, unless the check is given memories of play
// (twin-memories.mjs, --memories): the console's memory as it was each time a function started in play, with the
// registers it started with, so a function is called with what the game really gave it.
//
// What a function is given decides which of its paths run, so the check learns as it goes: the original says what each
// call read, and later calls change a few of those values, mostly to numbers at the edges of what a value holds, and give
// pointers it read as arguments, but never a word that points back into the function's own code, which is a switch's
// table. The same memory is a proof of the paths the calls took, and of no other, so the original also says which of its
// instructions ran and which way each branch went, and a function counts as proven only when every instruction ran and
// each branch went both ways (../lib/played.mjs).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameFolder, LOCAL, REPO } from '../lib/paths.mjs';
import { hex, readCodeMap, readOriginal, readRecordings } from '../lib/proof-files.mjs';
import { originalPlay } from '../lib/recording.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { twinsFolder } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { openBuild } from '../gba/twin.mjs';
import { findFunctions, ps2Program } from './functions.mjs';
import { keepProgram } from './original-program.mjs';
import { hasMemories, memoriesKey, openMemories, startsIn, takeMemories } from './twin-memories.mjs';
import { addressAt, buildCaller, CAME_BACK, EE_REGISTERS, ELSEWHERE, endText, EXCEPTION, inImage, KERNEL, KINDS, MISALIGNED, Original, OUT_OF_STEPS, REGISTERS, SYSCALL, VU } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// what openBuild names the function a call through a pointer meets when nothing built is the twin of its address
const NO_CODE = '__twin_no_code';
// what the function that says a twin's types is called, after the twin's own call
const TYPES = '__types';
const IMAGE = KINDS.ee.image;
// where the module keeps what the console has nothing at, the table it folds by, the map of pages a call wrote, and its
// own values and stack: from 0x03000000, which no address of the console's folds to, and its memory to 64 MB, past
// which it grows
const NOWHERE = { at: 0x02300000, bytes: 0x00100000 }, TABLE = 0x02400000, WRITTEN = 0x02410000;
const LAYOUT = { base: 0x03000000, memory: 0x04000000, code: address => address, own: 0x00080000 };

/** The table a module's addresses are folded by, two words for each top byte: what to keep and where it goes. The
 *  console's memory and its mirrors, the scratchpad, the hardware's registers, the vector units' memories, the GS's
 *  registers and the IOP's memory each go where original.mjs lays them in the image; the module's own values and stack,
 *  from 0x03000000 to 0x0FFFFFFF, stay where they are; and every other address goes to `nowhere`. */
export function foldTable() {
  const table = new Uint32Array(512);
  const set = (top, mask, start) => { table[top * 2] = mask; table[top * 2 + 1] = start; };
  for (let top = 0; top < 256; top++) set(top, NOWHERE.bytes - 1, NOWHERE.at);
  for (let top = 0x03; top <= 0x0F; top++) set(top, 0xFFFFFFFF, 0);
  // physical addresses: below 0x20000000 as they are, through 0x80000000 and 0xA0000000 as the kernel sees them
  for (const physical of [0x00, 0x80, 0xA0]) {
    set(physical, 0x01FFFFFF, 0);
    set(physical + 0x01, 0x01FFFFFF, 0);
    set(physical + 0x10, 0x0000FFFF, 0x02210000);
    set(physical + 0x11, 0x0000FFFF, 0x02220000);
    set(physical + 0x12, 0x00001FFF, 0x02230000);
    set(physical + 0x1C, 0x001FFFFF, 0x02000000);
  }
  // the console's memory again, as the kernel's TLB entries give it uncached, and the scratchpad
  for (const top of [0x20, 0x21, 0x30, 0x31]) set(top, 0x01FFFFFF, 0);
  set(0x70, 0x00003FFF, 0x02200000);
  return table;
}

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up arguments and values come from, so a run can be had again
  seconds: 2,        // how long a twin may take over one call
  limit: 1000000,    // how many instructions the original may run in one call
};
// how many calls a proof by the same memory is over, at the least
const KEPT_FROM = 1000;
// how many calls may be made for each one that has to be compared
const TRIES = 4;
// where a call's stack starts, near the top of the console's memory, where it comes back to, an address in the
// kernel's own memory where no game has code, and how far below its stack the original's own saves may go
const STACK = 0x01FFFF00, BACK = 0x00001000, SAVES = 0x10000;
// the registers a function keeps for its caller: s0 to s7, gp, sp and fp, and the floats f20 to f31
const KEPT = [16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30], KEPT_FLOATS = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF, 0x10000, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF];
// floats at the edges of what the EE's FPU holds, as their bits: zeros, ones, the smallest and largest ordinary ones,
// one tinier than those, and ones whose exponent is all ones, which the FPU takes as its largest
const FLOAT_EDGES = [0, 0x80000000, 0x3F800000, 0xBF800000, 0x3F000000, 0x40000000, 0x00800000, 0x80800000, 0x7F7FFFFF, 0xFF7FFFFF, 0x00000001, 0x7F800000, 0xFF800000, 0x7FC00000];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');
const at = address => `0x${hex(address >>> 0)}`;
// a place in the console's memory, its 32 MB or its scratchpad, that a pointer can point at
const inMemory = value => { const place = inImage(value >>> 0); return place >= 0 && (place < 0x02000000 || (place >= 0x02200000 && place < 0x02204000)); };

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
  // a place in the console's memory, above where a program loads and below its stack, or one a call read: mostly where
  // a quadword starts, as the EE's compiler lines up what it makes, and now and then only a doubleword or a word, as a
  // place inside something is
  const place = pointers => (pointers.length && below(2) ? pointers[below(pointers.length)] : (0x01000000 + below(0xF0000) * 16 + [0, 0, 0, 0, 8, 4][below(6)]) >>> 0);
  return {
    next, below,
    /** An argument of a type, { bits, signed, pointer, float }: a number, or a BigInt for 64 bits. */
    value(type, pointers) {
      if (type.pointer) return place(pointers);
      if (type.boolean) return below(2);
      if (type.float) return [() => FLOAT_EDGES[below(FLOAT_EDGES.length)], next, () => (0x3E000000 + below(0x2000000)) >>> 0][below(3)]() >>> 0;
      if (type.bits === 64) return BigInt.asUintN(64, (BigInt(type.signed && below(2) ? -1 : 0) << 32n) | BigInt(number())) ^ (below(3) ? 0n : BigInt(next()) << 32n);
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

/** What a function of a file of C takes and gives back, as its C writes it: { params, returns }, each { pointer: true }
 *  for what's written as a pointer, an array or a function, and { written } for any other type, by its name, which
 *  only the compiler can say the size and kind of (wrapOf, typeOf); `returns` is null for nothing. null when the file
 *  has no function of that name. */
export function signatureOf(text, name) {
  const code = text.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
  const found = new RegExp(`(?:^|[;}\\n])([^;{}()=#]*)\\b${name}\\s*\\(((?:[^(){};]|\\([^(){};]*\\))*)\\)\\s*\\{`).exec(code);
  if (!found) return null;
  const written = type => {
    const plain = type.replace(/\b(const|volatile|register|static|inline|extern)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return /[*[(]/.test(plain) ? { pointer: true } : { written: plain };
  };
  const params = [];
  let depth = 0, each = '';
  for (const c of `${found[2]},`) {
    if (c === ',' && !depth) {
      const param = each.trim();
      // without its name, the last word, unless that word is the type's own
      if (param && param !== 'void') params.push(written(/[*[(]/.test(param) ? param : param.replace(/\b[A-Za-z_]\w*\s*$/, word => (/^(char|short|int|long|unsigned|signed|float|double)\s*$/.test(word) ? word : ''))));
      each = '';
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    each += c;
  }
  const gives = found[1].replace(/\b(static|inline|extern)\b/g, ' ').trim();
  return { params, returns: /^void$/.test(gives) ? null : written(gives) };
}

// what the compiler says of a type by its name, as a number: its size, its class as __builtin_classify_type gives
// it, shifted 8, and whether it's a signed number narrower than a word, shifted 16
const codeOf = type => (type.pointer ? '0x504u' : `((unsigned)sizeof(${type.written}) | (unsigned)__builtin_classify_type(*(${type.written} *)0) << 8 | (unsigned)(__builtin_types_compatible_p(${type.written}, signed char) || __builtin_types_compatible_p(${type.written}, char) || __builtin_types_compatible_p(${type.written}, short)) << 16)`);

/** The line of C the check calls a twin by, and learns its types from. Each argument and what comes back cross as 64
 *  bits, and the bytes of each are laid into a value of its own type, so a float crosses as its bits and a number as
 *  itself, whatever the C calls the type. Beside it a function gives the compiler's word on each type, the arguments'
 *  and then what comes back, which typeOf reads. A type the C never completes gets a line the compiler refuses, which
 *  openBuild takes as a twin it can't call. */
export function wrapOf({ name, params, returns, call }) {
  const taken = params.map((_, i) => `unsigned long long a${i}`).join(', ') || 'void';
  const passed = params.map((type, i) => (type.pointer ? `(void *)(unsigned)a${i}` : `({ ${type.written} v; __builtin_memcpy(&v, &a${i}, sizeof v < 8 ? sizeof v : 8); v; })`)).join(', ');
  const body = !returns ? `${name}(${passed}); return 0;`
    : returns.pointer ? `return (unsigned)${name}(${passed});`
      : `${returns.written} v = ${name}(${passed}); unsigned long long out = 0; __builtin_memcpy(&out, &v, sizeof v < 8 ? sizeof v : 8); return out;`;
  const types = [...params, ...(returns ? [returns] : [])];
  return `unsigned long long ${call}(${taken}) { ${body} } __attribute__((export_name("${call}${TYPES}"))) unsigned ${call}${TYPES}(unsigned k) { static const unsigned types[] = { ${[...types.map(codeOf), '0'].join(', ')} }; return k < ${types.length} ? types[k] : 0; }`;
}

/** A type as the EE's calls carry it, { bits, signed, pointer, float, boolean }, from the compiler's word on it
 *  (wrapOf): a whole number, an enum or a pointer in a register, a float in the FPU's, and a double as its 64 bits in
 *  a whole register, as the EE has no doubles of its own. null for what no register carries: a struct or a union as it
 *  is, and anything longer than 64 bits. */
export function typeOf(code) {
  const bytes = code & 0xFF, kind = (code >>> 8) & 0xFF, signed = Boolean(code >>> 16 & 1);
  if (kind === 5) return { bits: 32, signed: false, pointer: true };
  if (kind === 8) return bytes === 4 ? { bits: 32, float: true } : bytes === 8 ? { bits: 64, signed: false } : null;
  if (kind === 4) return { bits: 8, signed: false, boolean: true };
  if ((kind === 1 || kind === 2 || kind === 3) && [1, 2, 4, 8].includes(bytes)) return { bits: bytes * 8, signed };
  return null;
}

/** The register the program reaches its small values through, gp: as its start sets it, with LUI and ADDIU or ORI. */
export function gpOf(elf) {
  const { entry, wordAt } = programOf(elf);
  let high = null;
  for (let address = entry; address < entry + 64 * 4; address += 4) {
    const word = wordAt(address);
    if (word === null) break;
    const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, imm = word & 0xFFFF;
    if (op === 0x0F && rt === 28) high = imm << 16;
    else if (high !== null && rt === 28 && rs === 28 && (op === 0x09 || op === 0x0D)) return (op === 0x0D ? high | imm : high + ((imm << 16) >> 16)) >>> 0;
  }
  return 0;
}

// the program's segments as they load, and the word at an address of them, or null
function programOf(elf) {
  if (elf.readUInt32BE(0) !== 0x7F454C46) throw new Error('This isn\'t a program for the PlayStation 2\'s processor: it has no ELF header.');
  const segments = [];
  for (let n = 0; n < elf.readUInt16LE(44); n++) {
    const o = elf.readUInt32LE(28) + n * 32;
    if (elf.readUInt32LE(o) !== 1) continue;
    segments.push({ offset: elf.readUInt32LE(o + 4), address: elf.readUInt32LE(o + 8), file: elf.readUInt32LE(o + 16), memory: elf.readUInt32LE(o + 20) });
  }
  const wordAt = address => {
    const s = segments.find(each => address >= each.address && address + 4 <= each.address + each.file);
    return s ? elf.readUInt32LE(s.offset + address - s.address) : null;
  };
  return { entry: elf.readUInt32LE(24), segments, wordAt };
}

/** Whether an EE instruction is a branch that may or may not go: the conditional branches, likely or not, on registers
 *  and on the coprocessors' conditions, but those that compare a register with itself or test r0. */
export function isConditional(word) {
  const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31;
  if (op === 0x01) return rs !== 0 && [0x00, 0x01, 0x02, 0x03, 0x10, 0x11, 0x12, 0x13].includes(rt);
  if ([0x04, 0x05, 0x14, 0x15].includes(op)) return rs !== rt;
  if ([0x06, 0x07, 0x16, 0x17].includes(op)) return rs !== 0;
  if (op >= 0x10 && op <= 0x12) return rs === 8 && rt <= 3;
  return false;
}

/** Each instruction of a function and, of those, the conditional branches, as offsets in it, for waysLeft. */
export function instructionsOf(elf, f) {
  const { wordAt } = programOf(elf), instructions = new Set(), branches = new Set();
  for (let offset = 0; offset < f.size; offset += 4) {
    const word = wordAt(f.address + offset);
    if (word === null) continue;
    instructions.add(offset);
    if (isConditional(word)) branches.add(offset);
  }
  return { instructions, branches };
}

/** The image every call starts from: the program where it loads, its zeros past its file, and nothing else. */
export function imageOf(elf) {
  const { segments } = programOf(elf), image = new Uint8Array(IMAGE);
  for (const s of segments) {
    const place = inImage(s.address);
    if (place < 0 || place + s.memory > 0x02000000 || ((s.address & 0x1FFFFFFF) + s.memory > STACK - SAVES && (s.address & 0x1FFFFFFF) < STACK + 0x100)) {
      throw new Error(`The program loads at ${at(s.address)}, ${count(s.memory)} bytes, where the check's stack or its memory can't be.`);
    }
    image.set(elf.subarray(s.offset, s.offset + s.file), place);
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

  /** The compiler's word on each of a twin's types, its arguments' and then what it gives back (wrapOf). */
  async types(name, count) {
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

// the 64 bits a register's lowest two words hold
const doubleOf = (words, at) => (BigInt(words[at + 1] >>> 0) << 32n) | BigInt(words[at] >>> 0);
// a 32-bit value as the EE keeps it in a register: spread to 64 bits by its sign
const spread = value => [value >>> 0, value & 0x80000000 ? 0xFFFFFFFF : 0];

/**
 * Calls one function of the original and its twin until `options.calls` calls were compared, each from the image with
 * a few values changed. `f` is { name, address, size, params, returns, call }. Answers what the check came to:
 * { compared, aside, ran, result }, `result` null while every call compared was the same, or what wasn't.
 */
async function checkFunction({ f, original, runner, gp, options, choose, image, memories = [] }) {
  const pool = new Map(), pointers = [], ran = new Map(), aside = {};
  // where each argument goes: the first eight whole numbers and the first eight floats in registers, and the rest on
  // the stack from where sp points, a slot of eight bytes each, in the order they're written
  let integers = 0, floats = 0, slots = 0;
  const places = f.params.map(type => (type.float ? (floats < 8 ? { float: floats++ } : { slot: slots++ }) : integers < 8 ? { register: integers++ } : { slot: slots++ }));
  // Where the calls start from: the function's own memories of play, a share of the calls from each, one after
  // another, or the program as the console loads it for a function with none. A memory's first call is the one play
  // made, with every register and the stack as they were, and the rest change what it was given.
  const sources = memories.length ? memories : [null];
  let compared = 0, number = 0, source = -1, made = 0, from = null;
  while (compared < options.calls && number < options.calls * TRIES) {
    number++;
    const turn = Math.floor((number - 1) * sources.length / options.calls) % sources.length;
    if (turn !== source) {
      from?.drop();
      source = turn;
      from = sources[source];
      made = 0;
      // the image only when it's another than the last call started from
      if (runner.image !== (from?.image ?? image)) {
        await original.image(from?.image ?? image);
        await runner.set(from?.image ?? image);
      }
    }
    const asPlayed = from !== null && made++ === 0;
    // the stack as the call has it: the program's, or play's as the function started
    const sp = from ? from.registers[29 * 4] >>> 0 : STACK;
    // the original's own saves below its stack, which a twin keeps in its own, and the arguments above it, which the
    // call is given and may change
    const skip = [[inImage(sp - SAVES), inImage(sp) + 8 * slots]];
    const read = address => inImage(address) >= 0 && !(address >= sp - SAVES && address < sp + 8 * slots) && !(address >= f.code.from && address < f.code.to);
    const registers = from ? [...from.registers] : Array.from({ length: EE_REGISTERS.words }, () => choose.next());
    // what play gave the function, read back from where a caller puts it
    const played = () => f.params.map((type, k) => {
      const place = places[k], at = place.float !== undefined ? EE_REGISTERS.fpr + 12 + place.float : place.register !== undefined ? (4 + place.register) * 4 : null;
      const words = at !== null ? [registers[at], registers[at + 1]] : [0, 4].map(n => new DataView(from.image.buffer).getUint32(inImage(sp + 8 * place.slot) + n, true));
      if (type.bits === 64) return (BigInt(words[1] >>> 0) << 32n) | BigInt(words[0] >>> 0);
      return type.bits === 32 ? words[0] >>> 0 : (type.signed ? (words[0] << (32 - type.bits)) >> (32 - type.bits) : words[0] & (2 ** type.bits - 1)) >>> 0;
    });
    const args = asPlayed ? played() : f.params.map(type => choose.value(type, pointers));
    const changes = [];
    if (!asPlayed && pool.size && choose.below(2)) {
      const places = [...pool];
      for (let k = 1 + choose.below(3); k; k--) {
        const [address, bytes] = places[choose.below(places.length)];
        changes.push([address, bytes, choose.sized(bytes, pointers)]);
      }
    }
    const gpr = (n, low, high = 0) => {
      registers[n * 4] = low >>> 0;
      registers[n * 4 + 1] = high >>> 0;
    };
    if (!from) {
      gpr(0, 0);
      registers[2] = registers[3] = 0;
      gpr(29, STACK);
      registers[29 * 4 + 2] = registers[29 * 4 + 3] = 0;
      gpr(31, BACK);
      registers[31 * 4 + 2] = registers[31 * 4 + 3] = 0;
      gpr(28, ...spread(gp));
      registers[28 * 4 + 2] = registers[28 * 4 + 3] = 0;
      registers[EE_REGISTERS.fcsr] = 0x01000001;
      for (let n = EE_REGISTERS.status; n <= EE_REGISTERS.divide; n++) registers[n] = 0;
    }
    // the arguments, as the caller puts them: whole numbers in a0 to a3 and t0 to t3, floats in f12 on
    if (!asPlayed) f.params.forEach((type, k) => {
      const place = places[k], low = Number(BigInt(args[k]) & 0xFFFFFFFFn), high = Number(BigInt(args[k]) >> 32n);
      if (place.float !== undefined) registers[EE_REGISTERS.fpr + 12 + place.float] = low;
      else if (place.register !== undefined) gpr(4 + place.register, ...(type.bits === 64 ? [low, high] : spread(low)));
      else {
        // on the stack a caller stores a word, and the other half of the slot too for 64 bits
        changes.push([sp + 8 * place.slot, 4, low]);
        if (type.bits === 64) changes.push([sp + 8 * place.slot + 4, 4, high]);
      }
    });
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, registers, changes });
    for (const { address, bytes, value } of answer.reads) {
      // a word that points back into the function's own code is a switch's table, the compiler's and not the caller's
      if (!read(address) || (bytes === 4 && value >= f.code.from && value < f.code.to)) continue;
      pool.set(address, bytes);
      if (bytes === 4 && inMemory(value) && pointers.length < 256 && !pointers.includes(value >>> 0)) pointers.push(value >>> 0);
    }
    const reason = answer.end === CAME_BACK ? null
      : answer.end === KERNEL || answer.end === SYSCALL ? 'kernel' : answer.end === ELSEWHERE ? 'elsewhere' : answer.end === EXCEPTION ? 'exception'
        : answer.end === OUT_OF_STEPS ? 'steps' : answer.end === MISALIGNED ? 'misaligned' : answer.end === VU ? 'vu' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    if (answer.vu0) {
      aside.vu0 = (aside.vu0 ?? 0) + 1;
      continue;
    }
    const left = answer.registers;
    const keptRegister = KEPT.find(n => [0, 1, 2, 3].some(w => left[n * 4 + w] >>> 0 !== registers[n * 4 + w] >>> 0));
    const keptFloat = KEPT_FLOATS.find(n => left[EE_REGISTERS.fpr + n] >>> 0 !== registers[EE_REGISTERS.fpr + n] >>> 0);
    if (keptRegister !== undefined || keptFloat !== undefined) {
      aside.kept = (aside.kept ?? 0) + 1;
      aside.keptText ??= keptRegister !== undefined ? `$${REGISTERS[keptRegister]}` : `$f${keptFloat}`;
      continue;
    }
    const twin = await runner.call(f.call, args, changes, answer.chunks, skip);
    const call = { number, args, changes, hardware: answer.hardware, ...(from ? { from: { play: from.play, number: from.number, asPlayed } } : {}) };
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
    // what the original gave back: a float in f0, or v0, all 64 bits of it, which hold a narrower value spread by its
    // sign, as the processor keeps a 32-bit one, or by its type's
    if (f.returns) {
      const gave = BigInt.asUintN(64, BigInt(twin.gave)), { bits, float, signed } = f.returns;
      const theirs = float ? BigInt(left[EE_REGISTERS.fpr] >>> 0) : doubleOf(left, 8);
      const ours = float ? gave & 0xFFFFFFFFn : BigInt.asUintN(64, bits === 32 || signed ? BigInt.asIntN(bits, gave) : BigInt.asUintN(bits, gave));
      if (ours !== theirs) return { compared, aside, ran, result: { kind: 'differs', gave: { ours, theirs, float: Boolean(float) }, ...call } };
    }
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: { ...addressAt(twin.differs.at), ours: twin.differs.ours, theirs: twin.differs.theirs }, ...call } };
    compared++;
    answer.ran.forEach((ways, i) => { if (ways) ran.set(f.address + i * 4, (ran.get(f.address + i * 4) ?? 0) | ways); });
  }
  from?.drop();
  return { compared, aside, ran, result: null };
}

const argText = value => (typeof value === 'bigint' ? `0x${value.toString(16).toUpperCase().padStart(16, '0')}` : at(value));

/** A call as a line says it: its number, the function with what it was given, and what was changed for it. */
export function callText(name, { number, args, changes, from }) {
  const set = changes.length ? `, after ${changes.map(([address, bytes, value]) => `${at(address)} was set to 0x${(value >>> 0).toString(16).toUpperCase().padStart(bytes * 2, '0')}`).join(' and ')}` : '';
  const played = from ? `, ${from.asPlayed ? 'as play made it, ' : ''}from the memory of ${from.play} at its start ${count(from.number)}` : '';
  return `call ${count(number)}, ${name}(${args.map(argText).join(', ')})${set}${played}`;
}

/** What a function's check came to, as { kind, line }: `kind` is 'same', 'differs', 'never', 'stopped', 'few' or
 *  'unchecked', and `line` what to say after its address and name. */
export function outcome(f, { compared, aside, result }, { calls, seconds }) {
  const byte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const hardware = result?.hardware ? ' The original used the hardware\'s registers in this call, which are compared as memory.' : '';
  if (result?.kind === 'differs') {
    const word = value => `0x${value.toString(16).toUpperCase().padStart(result.gave.float ? 8 : 16, '0')}`;
    const gave = result.gave ? `the twin gave back ${word(result.gave.ours)} and the original ${word(result.gave.theirs)}${result.gave.float ? ', as floats\' bits' : ''}` : null;
    const memory = result.memory ? `at ${at(result.memory.address)}, in ${result.memory.name}, the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}` : null;
    return { kind: 'differs', line: `${callText(f.name, result)}: ${[memory, gave].filter(Boolean).join(', and ')}.${hardware}` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.name, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.name, result)}: the original came back and the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  // what kept the rest from being compared, the most common first
  const why = Object.entries({
    kernel: `the original ${aside.kernelText}, which a twin asks the kit for`,
    elsewhere: `the original ${aside.elsewhereText}`,
    exception: `the original ${aside.exceptionText}`,
    steps: `the original didn't come back within ${count(DEFAULTS.limit)} instructions`,
    misaligned: `the original ${aside.misalignedText}`,
    vu: `the original ${aside.vuText}`,
    vu0: 'the original left vector unit 0\'s registers changed, which no twin is given yet',
    kept: `the original changed ${aside.keptText}, which a function keeps for its caller`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
    mismatch: 'a call through a pointer met a function that takes or gives something else, which WebAssembly stops',
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const NO_REGISTER = 'it takes or gives something no register carries, a struct or a union as it is, or more than 64 bits';
const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/** The twins of a version, ready to be built for the check a file at a time (../gba/twin.mjs). */
export function openPs2Build({ root, files, shifts, givenOf, includes }) {
  return openBuild({ root, files, shifts, givenOf, console: 'ps2', layout: LAYOUT, includes, signature: signatureOf, wrap: wrapOf });
}

/**
 * Checks the twins of one file of C against a PlayStation 2 program, `elf`, its bytes, with `build`, as openPs2Build
 * gives one, `only` the address of the one function to check or null, `addressOf(name)` where the console keeps a
 * value, `sizeOf(address)` how long the original's function there is, and `memories`, of play, for the calls to start
 * from, as twin-memories.mjs's openMemories gives them, or none. Answers { error }, { missing }, or { functions }, each
 * { name, address, kind, line, compared, whole, left }.
 */
export async function checkFile({ elf, build, file, only = null, addressOf, sizeOf, original, options = {}, memories = null, ruledOut = new Map(), log = () => {} }) {
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
    if (linked.unit.unknown.includes(twin.name)) functions.push({ name: twin.name, address: twin.address, kind: 'unchecked', line: 'it takes or gives a type its file never completes, so the check can\'t call it' });
  }
  const runner = new Runner(foldAddresses(linked.module, { table: TABLE, written: WRITTEN }), all.seconds);
  try {
    const image = imageOf(elf);
    await original.image(image);
    await runner.set(image);
    const choose = chooser(all.seed), gp = gpOf(elf);
    for (const call of linked.calls) {
      const size = sizeOf(call.address);
      if (!size) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: 'no function of the code map starts there' });
        continue;
      }
      // what each argument and what comes back is, as the compiler has it
      const types = (await runner.types(call.call, call.params.length + (call.returns ? 1 : 0))).map(typeOf);
      if (types.includes(null)) {
        functions.push({ name: call.name, address: call.address, kind: 'unchecked', line: NO_REGISTER });
        continue;
      }
      const f = { ...call, params: types.slice(0, call.params.length), returns: call.returns ? types.at(-1) : null, size, code: { from: call.address, to: call.address + size } };
      const checked = await checkFunction({ f, original, runner, gp, options: all, choose, image, memories: memories?.of(f.address) ?? [] });
      const { kind, line } = outcome(f, checked, all);
      const { total, left } = waysLeft(instructionsOf(elf, f), f.address, checked.ran, ruledOut);
      functions.push({ name: f.name, address: f.address, kind, line, compared: checked.compared, whole: kind === 'same' && !left.length, left, total });
      log(f.name);
    }
  } finally {
    await runner.close();
  }
  return { functions };
}

/**
 * Takes the memories of play for a version's twins, unless the ones kept are from the same copy, functions and
 * recordings: plays the game's recordings, or those of `names`, in the console's emulator, which tells of each time
 * the EE reaches one of `addresses`, with its registers and the memory then (../libretro/starts.h), and keeps a few
 * for each function (twin-memories.mjs). Answers them, as openMemories does.
 */
export async function memoriesOfPlay({ game, original, copy, addresses, names = [], folder = join(LOCAL, 'twin', game, 'ps2'), log = console.log }) {
  const reference = libretroReference(consoleOf('ps2')), keysLate = original.keysAfterVBlank === true;
  // one console plays them: a recording of several on a link isn't one's play
  const alone = readRecordings(game, names).filter(recording => !recording.players);
  if (!alone.length) throw new Error(`games/${versionOf(game).game}/proof/recordings/ has no recording one console plays${names.length ? ' among those named' : ''}, so there's no play to take memories from.`);
  const plays = alone.map(recording => {
    const way = originalPlay(recording, { keysLate });
    const buttons = way.originalHeld.map(list => list.reduce((mask, button) => mask | (reference.KEY[button] ?? 0), 0));
    if (keysLate) buttons.unshift(0);
    return { name: recording.name, buttons, sets: way.sets.map(({ frame, address, bytes, value }) => ({ frame, address, bytes, value })) };
  });
  const key = memoriesKey({ sha1: original.sha1, addresses, plays: plays.map(({ name, buttons, sets }) => [name, createHash('sha1').update(Buffer.from(Uint32Array.from(buttons).buffer)).digest('hex'), sets]) });
  const where = inRepo(folder);
  if (hasMemories(folder, key)) log(`The memories of play in ${where}/ are from these recordings and this copy already.`);
  else {
    reference.ensureOriginal(log);
    const frames = plays.reduce((sum, play) => sum + play.buttons.length, 0);
    log(`Playing ${plays.length === 1 ? plays[0].name : `${count(plays.length)} recordings`} in the original, ${count(frames)} frames, for the memory each function starts from…`);
    const began = Date.now(), work = join(LOCAL, 'tmp', `ps2-starts-${process.pid}`);
    mkdirSync(work, { recursive: true });
    try {
      const taken = await takeMemories({
        addresses, folder, key,
        plays: plays.map((play, n) => ({
          name: play.name,
          // played when its starts are wanted, and its file read a start at a time, as one can hold the console's memory many times over
          starts: async () => {
            const watched = join(work, `starts-${n}.bin`);
            writeFileSync(watched, new Uint8Array(Uint32Array.from(addresses).buffer));
            await reference.runOriginal({ copy, frames: play.buttons.length, buttons: play.buttons, sets: play.sets, env: { DP_STARTS: watched } });
            return startsIn(`${watched}.out`);
          },
        })),
      });
      log(`${count(taken.memories)} memories of ${count(taken.functions)} of the ${count(addresses.length)} functions kept in ${where}/, ${(taken.bytes / 1048576).toFixed(1)} MB, in ${count(Math.round((Date.now() - began) / 1000))} seconds. They come from your copy of the game: never put them in a commit, an issue or a pull request.`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return openMemories(folder);
}

/** The function check of a PlayStation 2 game's version in C, as the tool runs it: 0, or 3 when a twin isn't the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  // a game's name alone means its version in C
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the PlayStation 2 every call starts from the program as the console loads it.');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const elf = await ps2Program(copy.path);
  // kept for the proofs, which read the original's functions as they go
  keepProgram(original.sha1, elf);

  const { folder, shifts, files, twinsOf, twins, named, givenOf } = versionTwins(game, all.addresses ?? null);
  // a value is the game's, at the address its proof/addresses.json gives, a twin's, or the one in its label
  const label = /^[A-Za-z][A-Za-z0-9]*_(0[01][0-9A-Fa-f]{6})$/;
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null) ?? (label.test(name) ? parseInt(name.slice(-8), 16) : null);
  let chosen = files.filter(file => twinsOf.get(file).some(t => t.address !== null)), only = null;
  if (all.function) {
    only = twins.get(all.function)?.size === 1 ? [...twins.get(all.function)][0]
      : /^(0x)?[0-9A-Fa-f]{1,8}$/.test(all.function) ? parseInt(all.function.replace(/^0x/, ''), 16)
        : label.test(all.function) ? parseInt(all.function.slice(-8), 16) : null;
    if (only === null) throw new Error(`No twin in games/${game}/ is called ${all.function}: name a function by its address, as 0x00123450, its label, or its twin's name.`);
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${all.function}: the comment above it names the address, as in /** 0x${hex(only)}: what it does */.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return 0;
  }
  const sizes = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f.size]));
  const found = new Map(findFunctions(elf).map(f => [f.address, f.size]));
  const header = await twinsFolder(folder);
  const build = openPs2Build({ root: folder, files, shifts, givenOf, includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])] });
  const { ways: ruledOut } = readUnreachable(game);
  // memories of play, for every twin of the version, so one function asked for by itself starts where it does in a
  // check of them all
  const everyAddress = [...new Set(files.flatMap(file => twinsOf.get(file).map(t => t.address).filter(address => address !== null)))].sort((a, b) => a - b);
  const memories = all.memories ? await memoriesOfPlay({ game, original, copy: copy.path, addresses: everyAddress, names: Array.isArray(all.memories) ? all.memories : [], log }) : null;
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [], unnamed = new Set();
  const proven = [], differing = [];
  const caller = new Original(await buildCaller(log), 'ee');
  try {
    for (const file of chosen) {
      const result = await checkFile({ elf, build, file, only, addressOf, sizeOf: address => sizes.get(address) ?? found.get(address) ?? null, original: caller, options: all, memories, ruledOut });
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
  if (unnamed.size) log(`No address for ${[...unnamed].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as D_00123450.`);
  if (failed.length && chosen.length > 1) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory as the original's and gave back the same, over ${count(all.calls)} calls each, ${memories ? `from ${count(memories.count)} memories of play, which ${count(memories.functions)} of the version's functions have their own of, and the program as the console loads it for the rest` : 'from the program as the console loads it'} (seed ${all.seed}).`);
  if (totals.same) log(`${count(proven.length)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  // a proof is found with the game's own names, and over enough calls to be worth the name
  if (asksForProofs(game)) {
    if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
    else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
    else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  }
  return totals.differs || totals.never || totals.stopped ? 3 : 0;
}
