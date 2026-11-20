// Folds the addresses a WebAssembly module reads and writes down to where a module can keep them, as a console's own
// wiring does with the top bits, for a console that keeps its memory higher than a browser can give a module. The
// PlayStation keeps its 2 MB at 0x80000000, the same memory again at 0x00000000 and 0xA0000000, and its scratchpad and
// hardware at 0x1F800000: with the low 26 bits kept, a twin's C can say 0x800D8408, keep 0x80170578 in memory as a
// pointer and follow it, as the console does, and it all lands in a module of 64 MB, the scratchpad at 0x03800000. The
// module's own values and stack go below that, where folding leaves an address as it is. #1451's trial found it, and the
// Nintendo 64 and the Dreamcast keep their memory high too.
//
// The PlayStation 2's memories are too far apart for one mask: its 32 MB at 0x00000000, the scratchpad at 0x70000000,
// the hardware at 0x10000000 and 0x12000000, the vector units' memories at 0x11000000 and the IOP's at 0x1C000000, each
// seen again through other addresses. So the other way of folding takes a table in the module's memory, two words for
// each value of an address's top byte: what to keep of the address, and where in the module that memory starts. An
// address is folded to (address & mask) + start, and a byte the console has nothing at points where the check can see
// what was written there (../ps2/twin.mjs). The Super Nintendo's 24-bit addresses see the same memory through many
// banks, its work memory's first 8 KB at the bottom of most of them and its ROM in two halves of the map or more, 4 KB
// at a time, so its table has a pair for each 4 KB instead, by the address's bits from the 12th up, as many pairs as
// its module's memory has 4 KB, and the pairs past the console's 16 MB keep the module's own values where they are
// (../snes/twin.mjs).
//
// The Nintendo 64 keeps its 8 MB at 0x80000000 and 0xA0000000 and its hardware at 0xA4000000 and up, so the low 27 bits
// fold it into a module of 128 MB, its memory at 0 and its hardware at 0x04000000, and the module's own values sit
// between them. And it keeps a number's highest byte first, where a module keeps its lowest first, so with `own` the
// pass also turns round the bytes of every 16-, 32- and 64-bit number a load or a store moves outside the module's own
// stretch [own[0], own[1]), floats too, as their bits, as #1451's trial did: the console's memory keeps the console's
// order, byte for byte, and the C reads and writes it as the console does. A byte, and memory.copy, memory.fill and
// memory.init, move bytes as they are. The module's own values, its stack among them, stay in its own order, as the C
// the compiler made of them expects. With `flush` too, every float and double a sum, a difference, a product, a
// quotient, a square root or a double made a float gives that's too small for an ordinary number becomes zero with its
// sign, as the VR4300 makes it with the FS bit set, which games set, and as the reference emulator does, where a
// browser keeps it as it is.
//
// Every load and store gets its address and its offset added and folded, with an offset of 0 left on it, and
// memory.copy, memory.fill and memory.init have each address folded. It reads only what clang writes for C, as
// wasm-addresses.mjs does, and stops with what it met on anything else, never a guess.

import { leb, reader, sectionsOf } from './wasm-addresses.mjs';

const TYPE = 1, IMPORT = 2, FUNCTION = 3, CODE = 10;
const I32 = 0x7F, I64 = 0x7E, F32 = 0x7D, F64 = 0x7C;
// what each store keeps, by its opcode
const STORED = { 0x36: I32, 0x37: I64, 0x38: F32, 0x39: F64, 0x3A: I32, 0x3B: I32, 0x3C: I64, 0x3D: I64, 0x3E: I64 };
// the locals the pass adds to every function, in this order: two whole words, one of each kind a store keeps, two
// words a fold by a table works in, and the folded address a write marks its page by
const ADDED = [I32, I32, I64, F32, F64, I32, I32, I32];
// and with `own`, the folded address a load or a store turns round by, a word and two doublewords it works in
const TURNED = [I32, I32, I64, I64];
// and with `flush`, a float and a double it works in
const FLUSHED = [F32, F64];
// what makes a float or a double, by its opcode: a sum, a difference, a product, a quotient and a square root, and a
// double made a float
const MADE_F32 = new Set([0x91, 0x92, 0x93, 0x94, 0x95, 0xB6]), MADE_F64 = new Set([0x9F, 0xA0, 0xA1, 0xA2, 0xA3]);
// the least ordinary float and double, as their bits
const LEAST_F32 = [0x00, 0x00, 0x80, 0x00], LEAST_F64 = [0, 0, 0, 0, 0, 0, 0x10, 0x00];
// with a map of pages written, how big a page is, as a power of two, and the byte after the map's that says a copy or
// a fill wrote more than two pages
const PAGE = 12, PAGES = 0x10000;

/** A signed LEB128 number, as i32.const takes it. */
function sleb(value) {
  const out = [];
  let v = value | 0;
  for (;;) {
    const byte = v & 0x7F;
    v >>= 7;
    if ((v === 0 && !(byte & 0x40)) || (v === -1 && byte & 0x40)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

// how many parameters each function the module defines takes, in the order the code section has their bodies
function parametersOf(bytes, sections) {
  const types = [];
  const typeSection = sections.find(s => s.id === TYPE);
  if (typeSection) {
    const r = reader(bytes, typeSection.from);
    for (let n = r.u32(); n; n--) {
      if (r.byte() !== 0x60) throw new Error('The module has a type this can\'t read.');
      const params = r.u32();
      r.at += params;
      const results = r.u32();
      r.at += results;
      types.push(params);
    }
  }
  const functions = sections.find(s => s.id === FUNCTION);
  if (!functions) return [];
  const r = reader(bytes, functions.from);
  const params = [];
  for (let n = r.u32(); n; n--) params.push(types[r.u32()]);
  return params;
}

// A 64-bit number as clang writes one, for i64.const
function sleb64(value) {
  const out = [];
  let v = BigInt.asIntN(64, value);
  for (;;) {
    const byte = Number(v & 0x7Fn);
    v >>= 7n;
    if ((v === 0n && !(byte & 0x40)) || (v === -1n && byte & 0x40)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

// The bytes of the value in a local turned round, left on the stack: a 16-bit number in an i32 or an i64, a 32-bit
// one in an i32, and a 64-bit one in an i64, which works through `wider`
const swap16 = (local, wide) => (wide
  ? [0x20, ...leb(local), 0x42, 8, 0x88, 0x42, ...sleb64(0xFFn), 0x83, 0x20, ...leb(local), 0x42, ...sleb64(0xFFn), 0x83, 0x42, 8, 0x86, 0x84]
  : [0x20, ...leb(local), 0x41, 8, 0x76, 0x41, ...sleb(0xFF), 0x71, 0x20, ...leb(local), 0x41, ...sleb(0xFF), 0x71, 0x41, 8, 0x74, 0x72]);
const swap32 = local => [0x20, ...leb(local), 0x41, ...sleb(0xFF00FF00), 0x71, 0x41, 8, 0x78, 0x20, ...leb(local), 0x41, ...sleb(0x00FF00FF), 0x71, 0x41, 8, 0x77, 0x72, 0x41, 16, 0x77];
const swap64 = (local, wider) => [
  0x20, ...leb(local), 0x42, ...sleb64(0xFF00FF00FF00FF00n), 0x83, 0x42, 8, 0x88, 0x20, ...leb(local), 0x42, ...sleb64(0x00FF00FF00FF00FFn), 0x83, 0x42, 8, 0x86, 0x84, 0x21, ...leb(wider),
  0x20, ...leb(wider), 0x42, ...sleb64(0xFFFF0000FFFF0000n), 0x83, 0x42, 16, 0x88, 0x20, ...leb(wider), 0x42, ...sleb64(0x0000FFFF0000FFFFn), 0x83, 0x42, 16, 0x86, 0x84, 0x42, 32, 0x89,
];

// One load or store with its address folded and, outside the module's own stretch, its number's bytes turned round:
// each access takes the turned value or the plain one by where its folded address is, so the module's own values move
// as they always did
function turned(op, align, offset, { fold, set, get, where, word, wide, wider, valueOf, own: [from, to] }) {
  const console = [0x20, ...leb(where), 0x41, ...sleb(from), 0x6B, 0x41, ...sleb(to - from), 0x4F];
  const address = [...fold(offset), 0x22, ...leb(where)];
  const access = (code, a = align) => [code, ...leb(a), 0];
  // the value just loaded, kept in `local`, turned or not by where it was
  const choose = (local, swapped) => [0x21, ...leb(local), ...swapped, 0x20, ...leb(local), ...console, 0x1B];
  switch (op) {
    case 0x2C: case 0x2D: case 0x30: case 0x31: return [...address, ...access(op)];
    case 0x28: return [...address, ...access(0x28), ...choose(word, swap32(word))];
    case 0x2A: return [...address, ...access(0x28), ...choose(word, swap32(word)), 0xBE];
    case 0x2E: case 0x2F: return [...address, ...access(0x2F), ...choose(word, swap16(word)), ...(op === 0x2E ? [0xC1] : [])];
    case 0x29: return [...address, ...access(0x29), ...choose(wide, swap64(wide, wider))];
    case 0x2B: return [...address, ...access(0x29), ...choose(wide, swap64(wide, wider)), 0xBF];
    case 0x32: case 0x33: return [...address, ...access(0x33), ...choose(wide, swap16(wide, true)), ...(op === 0x32 ? [0xC3] : [])];
    case 0x34: case 0x35: return [...address, ...access(0x28, Math.min(align, 2)), ...choose(word, swap32(word)), op === 0x34 ? 0xAC : 0xAD];
    default: break;
  }
  // a store: its value kept while the address is folded, then turned or not
  const kept = valueOf[STORED[op]];
  const store = (value, code, a = align) => [...set(kept), ...address, ...value, code, ...leb(a), 0];
  const either = (local, swapped) => [...swapped, 0x20, ...leb(local), ...console, 0x1B];
  switch (op) {
    case 0x3A: case 0x3C: return store(get(kept), op);
    case 0x36: return store([...get(kept), 0x21, ...leb(word), ...either(word, swap32(word))], 0x36);
    case 0x38: return store([...get(kept), 0xBC, 0x21, ...leb(word), ...either(word, swap32(word))], 0x36);
    case 0x3B: return store([...get(kept), 0x21, ...leb(word), ...either(word, swap16(word))], 0x3B);
    case 0x37: return store([...get(kept), 0x21, ...leb(wide), ...either(wide, swap64(wide, wider))], 0x37);
    case 0x39: return store([...get(kept), 0xBD, 0x21, ...leb(wide), ...either(wide, swap64(wide, wider))], 0x37);
    case 0x3D: return store([...get(kept), 0x21, ...leb(wide), ...either(wide, swap16(wide, true))], 0x3D);
    case 0x3E: return store([...get(kept), 0xA7, 0x21, ...leb(word), ...either(word, swap32(word))], 0x36, Math.min(align, 2));
    default: throw new Error(`The module has an instruction this can't read (0x${op.toString(16)}).`);
  }
}

/**
 * The module with every address it reads or writes folded: to its low bits when `fold` is a mask, such as 0x03FFFFFF,
 * or by a table when it's { table }, the address of 256 pairs of words in the module's memory, a mask and a start for
 * each top byte, which whoever runs the module writes there, or with { table, shift, entries } a pair for each value
 * of the address's bits from `shift` up, `entries` of them, a power of two. With a mask the module's memory has to reach past the
 * mask's last byte, and its own values and stack to sit below it; with a table, the table says where they are. With
 * { table, written } too, every write also sets a byte of a map at `written`, one for each 4 KB of the module's memory
 * as folded, and the byte after its 65,536 when a copy or a fill reached more than two of them, so whoever runs the
 * module compares only what a call wrote. With `own`, [from, to), a fold by a mask also turns round the bytes of every
 * number of 16 bits and more a load or a store moves outside that stretch of the folded memory, the module's own.
 */
export function foldAddresses(module, fold, { own = null, flush = false } = {}) {
  const table = typeof fold === 'object' ? fold.table : null, mask = table === null ? fold : null;
  // which bits of an address choose its pair: the top byte, or with `shift` 12 its 4 KB, as many pairs as `entries`
  const shift = typeof fold === 'object' ? fold.shift ?? 24 : 24, entries = typeof fold === 'object' ? fold.entries ?? 2 ** (32 - shift) : 0;
  const written = typeof fold === 'object' ? fold.written ?? null : null;
  if (own && table !== null) throw new Error('Numbers are turned round only with a fold by a mask.');
  const bytes = Uint8Array.from(module);
  const sections = sectionsOf(bytes);
  const code = sections.find(s => s.id === CODE);
  if (!code) return bytes;
  const params = parametersOf(bytes, sections);
  const r = reader(bytes, code.from);
  const bodies = [];
  for (let n = r.u32(), i = 0; n; n--, i++) {
    const size = r.u32(), end = r.at + size;
    // the locals as they are, then the pass's own after them
    const groups = r.u32();
    let locals = 0;
    const declared = [];
    for (let g = 0; g < groups; g++) {
      const from = r.at, count = r.u32();
      r.byte();
      locals += count;
      declared.push(bytes.subarray(from, r.at));
    }
    // the pass's locals: two whole words, for the addresses and counts of memory.copy and memory.fill, and where a
    // store's value waits while its address is folded
    const first = params[i] + locals, [wordA, wordB] = [first, first + 1];
    const valueOf = { [I32]: first, [I64]: first + 2, [F32]: first + 3, [F64]: first + 4 }, [foldA, foldB, folded] = [first + 5, first + 6, first + 7];
    const set = index => [0x21, ...leb(index)], get = index => [0x20, ...leb(index)];
    const added = [...ADDED, ...(own ? TURNED : []), ...(flush ? FLUSHED : [])];
    const out = [...leb(groups + added.length), ...declared.flatMap(part => [...part]), ...added.flatMap(kind => [1, kind])];
    const [where, word, wide, wider] = [first + 8, first + 9, first + 10, first + 11];
    const [single, double] = own ? [first + 12, first + 13] : [first + 8, first + 9];
    // the float or double on the stack, made zero with its sign when it's too small for an ordinary number
    const flushed = (local, f64) => [0x21, ...leb(local), ...(f64 ? [0x44, 0, 0, 0, 0, 0, 0, 0, 0] : [0x43, 0, 0, 0, 0]), 0x20, ...leb(local), f64 ? 0xA6 : 0x98,
      0x20, ...leb(local), 0x20, ...leb(local), f64 ? 0x99 : 0x8B, ...(f64 ? [0x44, ...LEAST_F64] : [0x43, ...LEAST_F32]), f64 ? 0x63 : 0x5D, 0x1B];
    // the address on the stack, folded: masked, or masked by its top byte's pair in the table and moved to its start,
    // the table's own words read as they are
    const masked = table === null ? [0x41, ...sleb(mask), 0x71]
      : [0x22, ...leb(foldA), 0x41, ...sleb(shift), 0x76, ...(entries < 2 ** (32 - shift) ? [0x41, ...sleb(entries - 1), 0x71] : []), 0x41, 3, 0x74, 0x22, ...leb(foldB), 0x28, 2, ...leb(table), ...get(foldA), 0x71, ...get(foldB), 0x28, 2, ...leb(table + 4), 0x6A];
    const fold = offset => [...(offset ? [0x41, ...sleb(offset), 0x6A] : []), ...masked];
    // with a map, the folded address on the stack kept, and its page marked written
    const marked = written === null ? [] : [0x22, ...leb(folded), 0x20, ...leb(folded), 0x41, PAGE, 0x76, 0x41, 1, 0x3A, 0, ...leb(written)];
    // and after a copy or a fill of wordA bytes from there, its last page too, or every page when it reached more
    const markedTo = written === null ? [] : [
      ...get(folded), ...get(wordA), 0x6A, 0x41, 1, 0x6B, 0x41, PAGE, 0x76, 0x41, 1, 0x3A, 0, ...leb(written),
      ...get(wordA), 0x41, ...sleb(1 << PAGE), 0x4B, 0x04, 0x40, 0x41, ...sleb(PAGES), 0x41, 1, 0x3A, 0, ...leb(written), 0x0B,
    ];
    while (r.at < end) {
      const at = r.at, op = r.byte();
      if (op >= 0x28 && op <= 0x3E) {
        const align = r.u32(), offset = r.u32();
        if (own) out.push(...turned(op, align, offset, { fold, set, get, where, word, wide, wider, valueOf, own }));
        else if (op <= 0x35) out.push(...fold(offset), op, ...leb(align), 0);
        else {
          const kept = valueOf[STORED[op]];
          out.push(...set(kept), ...fold(offset), ...marked, ...get(kept), op, ...leb(align), 0);
        }
        continue;
      }
      if (op === 0xFC) {
        const sub = r.u32();
        if (sub === 10) {
          r.byte();
          r.byte();
          out.push(...set(wordA), ...set(wordB), ...masked, ...marked, ...get(wordB), ...masked, ...get(wordA), 0xFC, ...leb(10), 0, 0, ...markedTo);
          continue;
        }
        if (sub === 11 || sub === 8) {
          const index = sub === 8 ? r.u32() : null;
          r.byte();
          out.push(...set(wordA), ...set(wordB), ...masked, ...marked, ...get(wordB), ...get(wordA), 0xFC, ...leb(sub), ...(index === null ? [] : leb(index)), 0, ...markedTo);
          continue;
        }
        if (sub <= 7) {
          out.push(...bytes.subarray(at, r.at));
          continue;
        }
        if (sub === 9 || sub === 13) r.skip();
        else if (sub === 12 || sub === 14) {
          r.skip();
          r.skip();
        } else if (sub >= 15 && sub <= 17) r.skip();
        else throw new Error(`The module has an instruction this can't read (0xFC ${sub}).`);
        out.push(...bytes.subarray(at, r.at));
        continue;
      }
      if (flush && (MADE_F32.has(op) || MADE_F64.has(op))) {
        out.push(op, ...flushed(MADE_F64.has(op) ? double : single, MADE_F64.has(op)));
        continue;
      }
      if (op === 0x02 || op === 0x03 || op === 0x04 || op === 0x0C || op === 0x0D || op === 0x10 || (op >= 0x20 && op <= 0x26) || op === 0x41 || op === 0x42 || op === 0x3F || op === 0x40 || op === 0xD2) r.skip();
      else if (op === 0x11) {
        r.skip();
        r.skip();
      } else if (op === 0x0E) for (let targets = r.u32() + 1; targets; targets--) r.skip();
      else if (op === 0x43) r.at += 4;
      else if (op === 0x44) r.at += 8;
      else if (op === 0x1C) r.at += r.u32();
      else if (op === 0xD0) r.byte();
      else if (!(op <= 0x01 || op === 0x05 || op === 0x0B || op === 0x0F || op === 0x1A || op === 0x1B || (op >= 0x45 && op <= 0xC4) || op === 0xD1)) {
        throw new Error(`The module has an instruction this can't read (0x${op.toString(16)}).`);
      }
      out.push(...bytes.subarray(at, r.at));
    }
    if (r.at !== end) throw new Error('A function of the module doesn\'t end where it says.');
    bodies.push(Uint8Array.from([...leb(out.length), ...out]));
  }
  const content = [...leb(bodies.length), ...bodies.flatMap(body => [...body])];
  const made = [bytes.subarray(0, code.start), Uint8Array.from([CODE, ...leb(content.length), ...content]), bytes.subarray(code.to)];
  const whole = new Uint8Array(made.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of made) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}
