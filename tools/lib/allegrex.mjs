// The PlayStation Portable's processor, the Allegrex, as the tools read it (mips.mjs, processor 'allegrex'): a 32-bit
// MIPS with the likely branches and the traps of MIPS II, a floating-point unit of single floats alone, instructions
// of its own for bits and bytes (ext, ins, seb, seh, bitrev, wsbh, wsbw, clz, clo, rotr, max, min, madd, msub, movz,
// movn), and a vector unit, the VFPU, in coprocessor 2 and in opcodes of its own. What it shares with the Nintendo 64's
// VR4300 is read by that processor's tables, less the 64-bit instructions and the double floats, which it hasn't.
//
// A vector unit's instruction is told from what isn't one by its opcode, and its loads, stores and branches are read in
// full, as the tools follow those; its sums are named `vfpu` with their word, until `read` needs their names.

import { decode as decodeMips, REGISTERS } from './mips.mjs';

const r = n => `$${REGISTERS[n]}`;
const hexOf = value => `0x${(value >>> 0).toString(16).toUpperCase()}`;
// the VR4300's instructions the Allegrex hasn't: every 64-bit one, and the loads and stores of doubles
const WIDE = new Set(['ld', 'sd', 'ldl', 'ldr', 'sdl', 'sdr', 'lwu', 'lld', 'scd', 'ldc1', 'sdc1', 'daddi', 'daddiu', 'dadd', 'daddu', 'dsub', 'dsubu', 'dmult', 'dmultu', 'ddiv', 'ddivu', 'dsll', 'dsrl', 'dsra', 'dsllv', 'dsrlv', 'dsrav', 'dsll32', 'dsrl32', 'dsra32', 'dmfc0', 'dmtc0', 'dmfc1', 'dmtc1']);

const SPECIAL_OWN = { 0x0A: 'movz', 0x0B: 'movn', 0x16: 'clz', 0x17: 'clo', 0x1C: 'madd', 0x1D: 'maddu', 0x2C: 'max', 0x2D: 'min', 0x2E: 'msub', 0x2F: 'msubu' };
const BYTES_OWN = { 0x02: 'wsbh', 0x03: 'wsbw', 0x10: 'seb', 0x14: 'bitrev', 0x18: 'seh' };
// the vector unit's opcodes that are its sums, and its loads and stores with how many bytes each moves
const VFPU_SUMS = new Set([0x18, 0x19, 0x1B, 0x34, 0x37, 0x3C]);
const VFPU_MOVES = { 0x32: ['lv.s', 'load', 4], 0x36: ['lv.q', 'load', 16], 0x3A: ['sv.s', 'store', 4], 0x3E: ['sv.q', 'store', 16] };

/** The instruction a word makes at `address` on the Allegrex, as mips.mjs's decode gives one, or null when it's none. */
export function decodeAllegrex(word, address = 0) {
  word >>>= 0;
  const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, rd = (word >>> 11) & 31, sa = (word >>> 6) & 31, fn = word & 63;
  const imm = (word << 16) >> 16, branchTo = (address + 4 + imm * 4) >>> 0;
  const made = (name, text, kind = 'other', more = {}) => ({ name, text: text ? `${name.padEnd(7)} ${text}` : name, kind, rs, rt, rd, ...more, writes: more.writes || null });

  if (op === 0) {
    if (SPECIAL_OWN[fn] && sa === 0) {
      const name = SPECIAL_OWN[fn];
      if (name === 'clz' || name === 'clo') return rt === 0 ? made(name, `${r(rd)}, ${r(rs)}`, 'other', { writes: rd }) : null;
      if (name.startsWith('m') && (name.startsWith('madd') || name.startsWith('msub'))) return rd === 0 ? made(name, `${r(rs)}, ${r(rt)}`) : null;
      return made(name, `${r(rd)}, ${r(rs)}, ${r(rt)}`, 'other', { writes: rd });
    }
    // a shift right with a 1 where the shift's other register would be turns the bits round
    if (fn === 2 && rs === 1) return made('rotr', `${r(rd)}, ${r(rt)}, ${sa}`, 'other', { writes: rd });
    if (fn === 6 && sa === 1) return made('rotrv', `${r(rd)}, ${r(rt)}, ${r(rs)}`, 'other', { writes: rd });
  }
  if (op === 0x1C) {
    if (fn === 0 && !(word & 0x03FFFFC0)) return made('halt', '');
    if (fn === 0x24) return made('mfic', `${r(rt)}, $${rd}`, 'other', { writes: rt });
    if (fn === 0x26) return made('mtic', `${r(rt)}, $${rd}`);
    return null;
  }
  if (op === 0x1F) {
    if (fn === 0) return made('ext', `${r(rt)}, ${r(rs)}, ${sa}, ${rd + 1}`, 'other', { writes: rt });
    if (fn === 4) return rd >= sa ? made('ins', `${r(rt)}, ${r(rs)}, ${sa}, ${rd - sa + 1}`, 'other', { writes: rt }) : null;
    if (fn === 0x20 && BYTES_OWN[sa] && rs === 0) return made(BYTES_OWN[sa], `${r(rd)}, ${r(rt)}`, 'other', { writes: rd });
    return null;
  }
  if (op === 0x12) {
    // the vector unit as coprocessor 2: a register moved to or from the processor's, and the branches on its conditions
    if (rs === 3) return made(word & 0x80 ? 'mfvc' : 'mfv', `${r(rt)}, ${word & 0xFF}`, 'other', { writes: rt });
    if (rs === 7) return made(word & 0x80 ? 'mtvc' : 'mtv', `${r(rt)}, ${word & 0xFF}`);
    if (rs === 8 && (rt & 3) === (rt & 0x1F)) {
      const likely = (rt & 2) !== 0;
      return made(`bv${rt & 1 ? 't' : 'f'}${likely ? 'l' : ''}`, `${(word >>> 18) & 7}, ${hexOf(branchTo)}`, 'branch', { target: branchTo, ...(likely && { likely }) });
    }
    return null;
  }
  if (VFPU_SUMS.has(op)) return made('vfpu', hexOf(word), 'vfpu');
  if (VFPU_MOVES[op]) {
    const [name, kind, bytes] = VFPU_MOVES[op], offset = (imm >> 2) << 2;
    return made(name, `${rt | (word & 3) << 5}, ${offset}(${r(rs)})`, kind, { bytes, base: rs, offset, imm: offset });
  }
  // a quad moved in part, from wherever in memory, to or from the left or the right of a register
  if (op === 0x35 || op === 0x3D) {
    const offset = (imm >> 2) << 2, name = `${op === 0x35 ? 'l' : 's'}v${word & 2 ? 'r' : 'l'}.q`;
    return made(name, `${rt}, ${offset}(${r(rs)})`, op === 0x35 ? 'load' : 'store', { bytes: 16, base: rs, offset, imm: offset });
  }
  if (op === 0x3F) return word === 0xFFFF040D ? made('vflush', '') : word === 0xFFFF0000 ? made('vnop', '') : word === 0xFFFF0320 ? made('vsync', '') : null;
  if (op === 0x2F) return made('cache', `${hexOf(rt)}, ${imm}(${r(rs)})`);
  // the rest is the VR4300's, less what the Allegrex hasn't: 64 bits, and doubles in its floating-point unit
  const found = decodeMips(word, address, 'vr4300');
  if (!found || WIDE.has(found.name)) return null;
  if (op === 0x11 && /\.(d|l)\b|cvt\.d|cvt\.l|\bround\.l|\btrunc\.l|\bceil\.l|\bfloor\.l/.test(found.text)) return null;
  if (op === 0x10 && found.name.startsWith('tlb')) return null;
  return found;
}
