// Folds the addresses a WebAssembly module reads and writes down to its low bits, as a console's own wiring does with
// the top ones, for a console that keeps its memory higher than a browser can give a module. The PlayStation keeps its
// 2 MB at 0x80000000, the same memory again at 0x00000000 and 0xA0000000, and its scratchpad and hardware at
// 0x1F800000: with the low 26 bits kept, a twin's C can say 0x800D8408, keep 0x80170578 in memory as a pointer and
// follow it, as the console does, and it all lands in a module of 64 MB, the scratchpad at 0x03800000. The module's own
// values and stack go below that, where folding leaves an address as it is. #1451's trial found it, and the Nintendo
// 64 and the Dreamcast keep their memory high too.
//
// Every load and store gets its address and its offset added and masked, with an offset of 0 left on it, and
// memory.copy, memory.fill and memory.init have each address masked. It reads only what clang writes for C, as
// wasm-addresses.mjs does, and stops with what it met on anything else, never a guess.

import { leb, reader, sectionsOf } from './wasm-addresses.mjs';

const TYPE = 1, IMPORT = 2, FUNCTION = 3, CODE = 10;
const I32 = 0x7F, I64 = 0x7E, F32 = 0x7D, F64 = 0x7C;
// what each store keeps, by its opcode
const STORED = { 0x36: I32, 0x37: I64, 0x38: F32, 0x39: F64, 0x3A: I32, 0x3B: I32, 0x3C: I64, 0x3D: I64, 0x3E: I64 };
// the locals the pass adds to every function, in this order: two whole words, and one of each kind a store keeps
const ADDED = [I32, I32, I64, F32, F64];

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

/**
 * The module with every address it reads or writes folded to its low bits, `mask` such as 0x03FFFFFF. Its memory has
 * to reach past the mask's last byte, and its own values and stack to sit below it.
 */
export function foldAddresses(module, mask) {
  const bytes = Uint8Array.from(module);
  const sections = sectionsOf(bytes);
  const code = sections.find(s => s.id === CODE);
  if (!code) return bytes;
  const params = parametersOf(bytes, sections);
  const masked = [0x41, ...sleb(mask), 0x71];
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
    const valueOf = { [I32]: first, [I64]: first + 2, [F32]: first + 3, [F64]: first + 4 };
    const set = index => [0x21, ...leb(index)], get = index => [0x20, ...leb(index)];
    const out = [...leb(groups + ADDED.length), ...declared.flatMap(part => [...part]), ...ADDED.flatMap(kind => [1, kind])];
    const fold = offset => [...(offset ? [0x41, ...sleb(offset), 0x6A] : []), ...masked];
    while (r.at < end) {
      const at = r.at, op = r.byte();
      if (op >= 0x28 && op <= 0x3E) {
        const align = r.u32(), offset = r.u32();
        if (op <= 0x35) out.push(...fold(offset), op, ...leb(align), 0);
        else {
          const kept = valueOf[STORED[op]];
          out.push(...set(kept), ...fold(offset), ...get(kept), op, ...leb(align), 0);
        }
        continue;
      }
      if (op === 0xFC) {
        const sub = r.u32();
        if (sub === 10) {
          r.byte();
          r.byte();
          out.push(...set(wordA), ...set(wordB), ...masked, ...get(wordB), ...masked, ...get(wordA), 0xFC, ...leb(10), 0, 0);
          continue;
        }
        if (sub === 11 || sub === 8) {
          const index = sub === 8 ? r.u32() : null;
          r.byte();
          out.push(...set(wordA), ...set(wordB), ...masked, ...get(wordB), ...get(wordA), 0xFC, ...leb(sub), ...(index === null ? [] : leb(index)), 0);
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
