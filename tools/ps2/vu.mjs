// The PlayStation 2's vector units as the tools read and write their programs: each instruction is a pair of words, the
// upper one, a sum on the four fields of a vector (the FMAC), with the flags that end a program or stop it, and the lower
// one, which loads, stores, branches, works the integer registers and the units that divide and take roots (FDIV, EFU),
// or, when the upper's I bit is set, a float the I register takes. The upper's operations are the EE's macro mode's
// (ee.mjs, VU_OPERATIONS), so the two tables can't part; the lower's are here, laid out as Sony's VU manual and Play!'s
// tables have them. `read` prints a program with it, the
// finder tells a program from data with it (functions.mjs), and the tools' assembler encodes with it, pair for pair.
//
// A pair is written upper then lower, as Sony's assembler for the vector units takes it: `mulax.xyzw ACC, vf04, vf03x
// iaddiu vi02, vi00, 0x10`, registers as vf01 and vi01, the accumulator and the units' own registers as ACC, I, Q, P and R,
// a field after a register where the instruction takes one field of it, a load's place as `1(vi02)`, counted in 16-byte
// quadwords, a branch's target as the address in the unit's memory it goes to, in bytes, and the upper's flags after its
// name and before its fields, as `nop[e]` for a program's end or `addx[e].xyz`. A lower word that is a float shows as
// `loi 0x3F800000`. Sony's own assembler for the units, built from its GPL source, encoded every form the same when
// this was written (tools/test/ps2-read.test.mjs).

import { VU_OPERATIONS, fieldsOf, vuBits } from './ee.mjs';

const hexOf = n => `0x${(n >>> 0).toString(16).toUpperCase()}`;
const field = (word, at, bits) => (word >>> at) & ((1 << bits) - 1);
const two = n => String(n).padStart(2, '0');
const dest = word => fieldsOf(field(word, 21, 4));
/** Each vector unit's program memory, in bytes: a branch's target wraps inside it. */
export const MEMORY = { 0: 0x1000, 1: 0x4000 };

function numberOf(text) {
  const t = text.trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  return t.startsWith('-') ? -Number(t.slice(1)) : Number(t);
}
const registerOf = (kind, text) => {
  const found = new RegExp(`^\\$?${kind}(\\d+)([xyzw]*)$`, 'i').exec(text.trim());
  return found && Number(found[1]) < (kind === 'vi' ? 16 : 32) ? { n: Number(found[1]), fields: found[2].toLowerCase() } : null;
};

// The operands, as in ee.mjs: print(word, address, size) and parse(text, address, size, word), the bits or null.
const vf = (shift, fieldsAt) => ({
  print: word => `vf${two(field(word, shift, 5))}${fieldsAt ? fieldsAt(word) : ''}`,
  parse: (text, address, size, word) => {
    const r = registerOf('vf', text);
    if (!r) return null;
    if (!fieldsAt) return r.fields && r.fields !== dest(word) ? null : (r.n << shift) >>> 0;
    return { bits: (r.n << shift) >>> 0, field: r.fields };
  },
});
// the units have 16 integer registers, so a field of 16 or more isn't an instruction of theirs
const vi = shift => ({
  valid: word => field(word, shift, 5) < 16,
  print: word => `vi${two(field(word, shift, 5))}`,
  parse: text => { const r = registerOf('vi', text); return r && !r.fields ? (r.n << shift) >>> 0 : null; },
});
const number = (shift, bits, { signed = false, hex = false } = {}) => ({
  print: word => {
    let n = field(word, shift, bits);
    if (signed && n & (1 << (bits - 1))) n -= 1 << bits;
    return hex ? hexOf(n) : String(n);
  },
  parse: text => {
    const n = numberOf(text), low = signed ? -(1 << (bits - 1)) : 0, high = signed ? (1 << (bits - 1)) - 1 : (2 ** bits) - 1;
    return n === null || n < low || n > high ? null : ((n & ((2 ** bits) - 1)) * (2 ** shift)) >>> 0;
  },
});
const fixed = text => ({ print: () => text, parse: t => (t.trim().toUpperCase() === text.toUpperCase() ? 0 : null) });
// an 11-bit offset from an integer register, in quadwords, as a load or a store has it
const place = shift => ({
  valid: word => field(word, shift, 5) < 16,
  print: word => `${number(0, 11, { signed: true }).print(word)}(vi${two(field(word, shift, 5))})`,
  parse: text => {
    const found = /^(-?\w*)\((\$?vi\d+)\)$/i.exec(text.trim());
    const r = found && registerOf('vi', found[2]), offset = found && (found[1] ? numberOf(found[1]) : 0);
    if (!r || r.fields || offset === null || offset < -1024 || offset > 1023) return null;
    return ((r.n << shift) | (offset & 0x7FF)) >>> 0;
  },
});
const counted = (shift, before, after) => ({
  valid: word => field(word, shift, 5) < 16,
  print: word => `(${before}vi${two(field(word, shift, 5))}${after})`,
  parse: text => {
    const found = new RegExp(`^\\(${before.replace(/-/g, '\\-')}(\\$?vi\\d+)${after.replace(/\+/g, '\\+')}\\)$`, 'i').exec(text.trim());
    const r = found && registerOf('vi', found[1]);
    return r && !r.fields ? (r.n << shift) >>> 0 : null;
  },
});
// a branch's target, from the pair after it, in bytes of the unit's memory
const branch = {
  print: (word, address, size) => hexOf((address + 8 + ((word << 21) >> 21) * 8) & (size - 1)),
  parse: (text, address, size) => {
    const target = numberOf(text);
    if (target === null || target % 8 || target < 0 || target >= size) return null;
    let offset = (target - (address + 8)) / 8;
    // the unit's memory wraps, so the nearer way is taken
    if (offset > 1023) offset -= size / 8;
    if (offset < -1024) offset += size / 8;
    return offset < -1024 || offset > 1023 ? null : (offset & 0x7FF) >>> 0;
  },
};
// IADDIU's and ISUBIU's 15 bits, the top four in bits 24 to 21; FSAND's and its kind's 12, the top one in bit 21
const imm15 = {
  print: word => hexOf(((word >>> 10) & 0x7800) | (word & 0x7FF)),
  parse: text => { const n = numberOf(text); return n === null || n < 0 || n > 0x7FFF ? null : ((((n & 0x7800) << 10) | (n & 0x7FF)) >>> 0); },
};
const imm12 = {
  print: word => hexOf(((word >>> 10) & 0x800) | (word & 0x7FF)),
  parse: text => { const n = numberOf(text); return n === null || n < 0 || n > 0xFFF ? null : ((((n & 0x800) << 10) | (n & 0x7FF)) >>> 0); },
};
// FSSET sets only the sticky flags, bits 11 to 6 of the 12, and Sony's assembler drops the rest of what it's given
const imm12up6 = { print: imm12.print, parse: text => { const bits = imm12.parse(text); return bits === null ? null : (bits & ~0x3F) >>> 0; } };
const oneOf = (shift, word) => 'xyzw'[field(word, shift, 2)];
// a register's one field, kept in two bits of dest, as fsf and ftf are
const vfField = (shift, at) => ({
  print: word => `vf${two(field(word, shift, 5))}${oneOf(at, word)}`,
  parse: text => {
    const r = registerOf('vf', text);
    return r && /^[xyzw]$/.test(r.fields) ? ((r.n << shift) | ('xyzw'.indexOf(r.fields) << at)) >>> 0 : null;
  },
});

const OPERANDS = {
  vfd: vf(6), vfs: vf(11), vft: vf(16), vftbc: vf(16, word => 'xyzw'[word & 3]), vftw: vf(16, () => 'w'),
  vfsf: vfField(11, 21), vftf: vfField(16, 23),
  vid: vi(6), vis: vi(11), vit: vi(16), vi1: fixed('vi01'),
  ACC: fixed('ACC'), I: fixed('I'), Q: fixed('Q'), P: fixed('P'), R: fixed('R'),
  imm5: number(6, 5, { signed: true }), imm11: number(0, 11, { signed: true }), imm12, imm12up6, imm15, imm24: number(0, 24, { hex: true }),
  ftPlace: place(11), fsPlace: place(16), itPlace: place(11),
  visInc: counted(11, '', '++'), vitInc: counted(16, '', '++'), visDec: counted(11, '--', ''), vitDec: counted(16, '--', ''), visAt: counted(11, '', ''),
  branch,
};
// the bits each operand takes in a lower word
const USES = { vfd: 0x7C0, vid: 0x7C0, imm5: 0x7C0, vfs: 0xF800, vis: 0xF800, visInc: 0xF800, visDec: 0xF800, visAt: 0xF800, vft: 0x1F0000,
  vit: 0x1F0000, vitInc: 0x1F0000, vitDec: 0x1F0000, vfsf: 0x60F800, vftf: 0x19F0000, imm11: 0x7FF, branch: 0x7FF, imm12: 0x2007FF, imm12up6: 0x2007C0,
  imm15: 0x1E007FF, imm24: 0xFFFFFF, ftPlace: 0xFFFF, fsPlace: 0x1F07FF, itPlace: 0xFFFF };

/** The lower instructions: { name, value, mask, operands, dest, kind, bytes }, first match wins. */
export const LOWER = [];
const lower = (name, value, operands = '', more = {}) => {
  let used = more.dest ? 0x1E00000 : 0;
  for (const o of operands ? operands.split(',') : []) used |= USES[o] ?? 0;
  // an instruction whose fields Sony's assembler always sets the same, as the EFU's sums on x, y and z, has them in
  // its value and names none
  const fixed = more.fixed === undefined ? 0 : more.fixed << 21;
  LOWER.push({ name, value: (value | fixed) >>> 0, mask: (0xFFFFFFFF & ~used) >>> 0, operands: operands ? operands.split(',') : [], kind: 'other', ...more });
};
const top = n => (n << 25) >>> 0;
lower('lq', top(0x00), 'vft,ftPlace', { dest: true, kind: 'load', bytes: 16 });
lower('sq', top(0x01), 'vfs,fsPlace', { dest: true, kind: 'store', bytes: 16 });
lower('ilw', top(0x04), 'vit,itPlace', { dest: true, kind: 'load', bytes: 2, oneField: true });
lower('isw', top(0x05), 'vit,itPlace', { dest: true, kind: 'store', bytes: 2, oneField: true });
lower('iaddiu', top(0x08), 'vit,vis,imm15');
lower('isubiu', top(0x09), 'vit,vis,imm15');
lower('fceq', top(0x10), 'vi1,imm24');
lower('fcset', top(0x11), 'imm24');
lower('fcand', top(0x12), 'vi1,imm24');
lower('fcor', top(0x13), 'vi1,imm24');
lower('fseq', top(0x14), 'vit,imm12');
lower('fsset', top(0x15), 'imm12up6');
lower('fsand', top(0x16), 'vit,imm12');
lower('fsor', top(0x17), 'vit,imm12');
lower('fmeq', top(0x18), 'vit,vis');
lower('fmand', top(0x1A), 'vit,vis');
lower('fmor', top(0x1B), 'vit,vis');
lower('fcget', top(0x1C), 'vit');
lower('b', top(0x20), 'branch', { kind: 'jump' });
lower('bal', top(0x21), 'vit,branch', { kind: 'call' });
lower('jr', top(0x24), 'vis', { kind: 'jr' });
lower('jalr', top(0x25), 'vit,vis', { kind: 'call' });
lower('ibeq', top(0x28), 'vit,vis,branch', { kind: 'branch' });
lower('ibne', top(0x29), 'vit,vis,branch', { kind: 'branch' });
lower('ibltz', top(0x2C), 'vis,branch', { kind: 'branch' });
lower('ibgtz', top(0x2D), 'vis,branch', { kind: 'branch' });
lower('iblez', top(0x2E), 'vis,branch', { kind: 'branch' });
lower('ibgez', top(0x2F), 'vis,branch', { kind: 'branch' });
// LowerOP, 0x40: the integer sums by their six bits, and the rest by the index bits 10 to 6 and 1 to 0 make
const OP = top(0x40);
// the lower's nop is MOVE with no fields, of vf00 to vf00
lower('nop', OP | 0x33C, '', { exact: true });
lower('iadd', OP | 0x30, 'vid,vis,vit');
lower('isub', OP | 0x31, 'vid,vis,vit');
lower('iaddi', OP | 0x32, 'vit,vis,imm5');
lower('iand', OP | 0x34, 'vid,vis,vit');
lower('ior', OP | 0x35, 'vid,vis,vit');
const special = (name, index, operands, more = {}) => lower(name, OP | ((index >> 2) << 6) | 0x3C | (index & 3), operands, more);
special('move', 0x30, 'vft,vfs', { dest: true });
special('mr32', 0x31, 'vft,vfs', { dest: true });
special('lqi', 0x34, 'vft,visInc', { dest: true, kind: 'load', bytes: 16 });
special('sqi', 0x35, 'vfs,vitInc', { dest: true, kind: 'store', bytes: 16 });
special('lqd', 0x36, 'vft,visDec', { dest: true, kind: 'load', bytes: 16 });
special('sqd', 0x37, 'vfs,vitDec', { dest: true, kind: 'store', bytes: 16 });
special('div', 0x38, 'Q,vfsf,vftf');
special('sqrt', 0x39, 'Q,vftf');
special('rsqrt', 0x3A, 'Q,vfsf,vftf');
special('waitq', 0x3B, '');
special('mtir', 0x3C, 'vit,vfsf');
special('mfir', 0x3D, 'vft,vis', { dest: true });
special('ilwr', 0x3E, 'vit,visAt', { dest: true, kind: 'load', bytes: 2, oneField: true });
special('iswr', 0x3F, 'vit,visAt', { dest: true, kind: 'store', bytes: 2, oneField: true });
special('rnext', 0x40, 'vft,R', { dest: true });
special('rget', 0x41, 'vft,R', { dest: true });
special('rinit', 0x42, 'R,vfsf');
special('rxor', 0x43, 'R,vfsf');
special('mfp', 0x64, 'vft,P', { dest: true });
special('xtop', 0x68, 'vit');
special('xitop', 0x69, 'vit');
special('xgkick', 0x6C, 'vis');
// the EFU's sums on several fields have them in dest, always the same, as Sony's assembler writes them, and its
// one-field ones take fsf
[['esadd', 0x70, 0xE], ['ersadd', 0x71, 0xE], ['eleng', 0x72, 0xE], ['erleng', 0x73, 0xE], ['eatanxy', 0x74, 0xC], ['eatanxz', 0x75, 0xA], ['esum', 0x76, 0xF]]
  .forEach(([name, index, fields]) => special(name, index, 'P,vfs', { fixed: fields }));
[['esqrt', 0x78], ['ersqrt', 0x79], ['ercpr', 0x7A], ['esin', 0x7C], ['eatan', 0x7D], ['eexp', 0x7E]].forEach(([name, index]) => special(name, index, 'P,vfsf'));
special('waitp', 0x7B, '');

/** The upper instructions, from the EE's macro mode's table: { name, value, mask, operands, dest }. */
export const UPPER = VU_OPERATIONS.filter(o => o.upper).map(o => ({ ...vuBits(o), name: o.name, operands: o.operands ? o.operands.split(',') : [], dest: o.dest }))
  // bits 26 and 25 are never set
  .map(u => ({ ...u, mask: (u.mask | 0x06000000) >>> 0 }));
const UPPER_OPERANDS = { ...OPERANDS, vfd: vf(6), vfs: vf(11), vft: vf(16) };
const FLAGS = [['i', 31], ['e', 30], ['m', 29], ['d', 28], ['t', 27]];

// one word against a list, as `name operands`, or null
function decodeWith(list, operands, word, address, size) {
  for (const entry of list) {
    if (((word & entry.mask) >>> 0) !== entry.value) continue;
    if (entry.oneField && ![1, 2, 4, 8].includes(field(word, 21, 4))) continue;
    if (entry.operands.some(o => operands[o].valid && !operands[o].valid(word))) continue;
    const name = entry.dest ? `${entry.name}.${dest(word)}` : entry.name;
    const text = entry.operands.map(o => operands[o].print(word, address, size)).join(', ');
    return { entry, name, text: text ? `${name} ${text}` : name };
  }
  return null;
}

/**
 * The instruction a pair makes at `address` in a unit's memory of `size` bytes, or null when either word isn't one:
 *   { upper, lower, text, flags, kind, target, ends, bytes, immediate }
 * `upper` and `lower` are each word's text, `flags` the upper's of I, E, M, D and T that are set, `kind` the lower's,
 * as ee.mjs has them ('branch', 'jump', 'call', 'return' for `jr vi15`, 'switch' for another `jr`, 'load', 'store',
 * 'other'), `ends` whether the E bit ends the program after the next pair, and `immediate` the float a `loi` holds.
 */
export function decodePair(lowerWord, upperWord, address = 0, size = MEMORY[1]) {
  lowerWord >>>= 0;
  upperWord >>>= 0;
  const upper = decodeWith(UPPER, UPPER_OPERANDS, upperWord & 0x07FFFFFF, address, size);
  if (!upper) return null;
  const flags = FLAGS.filter(([, bit]) => upperWord & (1 << bit)).map(([name]) => name);
  // the flags go after the name and before the fields, as `addx[e].xyz`
  const shown = flags.filter(f => f !== 'i');
  const upperText = shown.length ? upper.text.replace(/^([a-z0-9]+)/, `$1[${shown.join('')}]`) : upper.text;
  let lower, kind = 'other', made = {};
  if (flags.includes('i')) {
    lower = `loi ${hexOf(lowerWord)}`;
    made.immediate = new Float32Array(new Uint32Array([lowerWord]).buffer)[0];
  } else {
    const found = decodeWith(LOWER, OPERANDS, lowerWord, address, size);
    if (!found) return null;
    lower = found.text;
    kind = found.entry.kind;
    if (kind === 'jr') kind = field(lowerWord, 11, 5) === 15 ? 'return' : 'switch';
    if (found.entry.operands.includes('branch')) made.target = (address + 8 + ((lowerWord << 21) >> 21) * 8) & (size - 1);
    if (found.entry.bytes) made.bytes = found.entry.bytes;
  }
  return { upper: upperText, lower, text: `${upperText.padEnd(28)} ${lower}`, flags, kind, ends: flags.includes('e'), ...made };
}

// splits operands at the commas outside brackets
const operandsOf = text => {
  const parts = [];
  let depth = 0, current = '';
  for (const c of text) {
    if (c === ',' && !depth) { parts.push(current.trim()); current = ''; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

// one instruction's text against a list: its word, or null
function encodeWith(list, operands, text, address, size) {
  const found = /^\s*([a-z][\w]*)(?:\.([xyzw]*))?\s*(.*?)\s*$/i.exec(text);
  if (!found) return null;
  const name = found[1].toLowerCase(), fields = found[2]?.toLowerCase(), given = operandsOf(found[3]);
  for (const entry of list) {
    if (entry.name !== name || entry.operands.length !== given.length || (fields !== undefined && !entry.dest)) continue;
    let word = entry.value | (entry.dest && fields ? [...fields].reduce((b, c) => b | (8 >> 'xyzw'.indexOf(c)), 0) << 21 : 0), fits = true;
    for (const [i, o] of entry.operands.entries()) {
      const bits = operands[o].parse(given[i], address, size, word);
      if (bits === null) { fits = false; break; }
      if (typeof bits === 'object') {
        word |= bits.bits;
        if (bits.field && bits.field !== 'xyzw'[word & 3] && !(o === 'vftw' && bits.field === 'w')) {
          if (o === 'vftbc' || !/^[xyzw]$/.test(bits.field)) { fits = false; break; }
        }
      } else word |= bits;
    }
    word >>>= 0;
    if (fits && ((word & entry.mask) >>> 0) === entry.value && (!entry.oneField || [1, 2, 4, 8].includes(field(word, 21, 4)))) return word;
  }
  return null;
}

/**
 * The pair a line makes at `address`: [lower, upper] words, from `upper  lower`, as decodePair writes it. The upper
 * and the lower are told apart where the upper's operands end; flags go after the upper's name, as `nop[e]`.
 */
export function encodePair(text, address = 0, size = MEMORY[1]) {
  // the upper's name and operands, then the lower's: the lower starts at the first name after the upper's operands
  const found = /^\s*([a-z][a-z0-9]*)(?:\[([eimdt]+)\])?(\.[xyzw]*)?(?:\[([eimdt]+)\])?\s+(.*)$/i.exec(text);
  if (!found) throw new Error(`"${text}" isn't a pair of a vector unit's instructions.`);
  const [, base, before = '', fields = '', after = '', rest] = found;
  const upperName = `${base}${fields}`, flagText = `${before}${after}`;
  const words = rest.split(/\s+/);
  for (let cut = 0; cut < words.length; cut++) {
    const upperText = `${upperName} ${words.slice(0, cut).join(' ')}`, lowerText = words.slice(cut).join(' ');
    if (cut && words[cut - 1].endsWith(',')) continue;
    let upperWord = encodeWith(UPPER, UPPER_OPERANDS, upperText, address, size);
    if (upperWord === null) continue;
    for (const flag of flagText.toLowerCase()) upperWord |= 1 << FLAGS.find(([name]) => name === flag)[1];
    const immediate = /^loi\s+(.+)$/i.exec(lowerText);
    if (immediate) {
      const value = /^0x[0-9a-f]+$/i.test(immediate[1].trim()) ? Number(immediate[1]) : new Uint32Array(new Float32Array([Number(immediate[1])]).buffer)[0];
      return [value >>> 0, (upperWord | (1 << 31)) >>> 0];
    }
    const lowerWord = encodeWith(LOWER, OPERANDS, lowerText, address, size);
    if (lowerWord !== null) return [lowerWord, upperWord >>> 0];
  }
  throw new Error(`"${text.trim()}" isn't a pair the vector units have: an upper instruction, then a lower one.`);
}

/** Whether two words, lower then upper, are a pair of a vector unit's instructions. */
export const isPair = (lowerWord, upperWord) => decodePair(lowerWord, upperWord) !== null;
