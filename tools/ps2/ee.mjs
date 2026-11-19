// The PlayStation 2's main processor, the EE, as the tools read and write it: its R5900 core's instructions, MIPS III and
// the parts of MIPS IV it has (movz, movn, pref), its own 128-bit loads and stores and its multimedia instructions (MMI),
// its second multiply unit, coprocessor 0 with its debug and performance registers, its floating-point unit, which has
// singles only and an accumulator, and vector unit 0 in macro mode (COP2), which the EE drives one instruction at a time.
// `read` prints a game's EE function with it (read.mjs), the function finder tells code from values with it
// (functions.mjs), and the tools' assembler encodes with it, so one table does both and what one writes the other reads
// back, word for word.
//
// Each instruction is written as Sony's own assembler for the EE takes it, the GNU assembler of its 1999 toolchain
// (2.9-ee-991111-01, GPL, built from Sony's source release), which built the games: registers by their names, as $sp,
// a load's or a store's place as an offset from a register, as 16($sp), a branch's or a jump's target as the address it
// goes to, a vector unit's register with the fields it names, as $vf1xyz, its accumulator and its own registers as ACC,
// I, Q and R, and the short forms nop, move, li, b, bal, beqz, bnez, beqzl, bnezl, neg, negu, dneg, dnegu and not,
// each only where the long form would be encoded the same, so a text always gives back its own word. A short form an
// assembler encodes more than one way, as move, which was daddu for Sony's and is or for today's GNU, is written so here
// only for the word Sony's made: here move is daddu's, and or and addu with $zero are written as they are. Sony's
// assembler encoded every form the same when this was written, and today's GNU binutils' objdump read the same, but
// where Sony's tools and the EE differ from it: break's one code is 20 bits, cvt.w.s is the EE's name for its float to
// integer, sqrt.s takes ft, vadda and vmsuba take ft before fs, and vsqrt and vcallmsr are as Sony's table has them
// (tools/test/ps2-read.test.mjs).

/** The registers by the names MIPS code gives them, in the processor's order. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'];
// other names a register is known by: $s8 for $fp, and the names of the EABI, where $8 to $11 hold arguments too
const ALSO = { s8: 30, a4: 8, a5: 9, a6: 10, a7: 11 };
/** The fields of a vector unit's register, by the four bits an instruction names them with, x the highest. */
export const fieldsOf = bits => ['x', 'y', 'z', 'w'].filter((_, i) => bits & (8 >> i)).join('');
const bitsOf = text => [...text].reduce((bits, c) => bits | (8 >> 'xyzw'.indexOf(c)), 0);

const hexOf = n => `0x${(n >>> 0).toString(16).toUpperCase()}`;
const signed16 = word => (word << 16) >> 16;
const field = (word, at, bits) => (word >>> at) & ((1 << bits) - 1);

// what a number in an operand is: decimal or hexadecimal, with or without a minus
function numberOf(text) {
  const t = text.trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  return t.startsWith('-') ? -Number(t.slice(1)) : Number(t);
}

/** A general register by its name or number, as $a0, $4 or a0, or null. */
export function gprOf(text) {
  const found = /^\$?(\w+)$/.exec(text.trim());
  if (!found) return null;
  if (/^\d+$/.test(found[1])) return Number(found[1]) < 32 ? Number(found[1]) : null;
  const n = REGISTERS.indexOf(found[1]);
  return n >= 0 ? n : ALSO[found[1]] ?? null;
}
// a numbered register with a letter before it, as $f3 or $vi12, or null
const numbered = (prefix, limit) => text => {
  const found = new RegExp(`^\\$?${prefix}(\\d+)$`).exec(text.trim());
  return found && Number(found[1]) < limit ? Number(found[1]) : null;
};
const fprOf = numbered('f', 32), viOf = numbered('vi', 32), copOf = numbered('', 32);

// The operands, each how it's written from a word and read back into one: `print(word, address, entry)` and
// `parse(text, address, entry)`, which gives the bits it sets, or null when the text isn't one.
const register = (shift, name, of) => ({
  print: word => name(field(word, shift, 5)),
  parse: text => { const n = of(text); return n === null ? null : (n << shift) >>> 0; },
});
const gpr = shift => register(shift, n => `$${REGISTERS[n]}`, gprOf);
const fpr = shift => register(shift, n => `$f${n}`, fprOf);
const vi = shift => register(shift, n => `$vi${n}`, viOf);
// a vector register with the fields the instruction names after it, as GNU's tools write it, or one field of its own
const vf = (shift, fields) => ({
  print: word => `$vf${field(word, shift, 5)}${fields(word)}`,
  parse: (text, address, entry, word) => {
    const found = /^\$?vf(\d+)([xyzw]*)$/.exec(text.trim());
    if (!found || Number(found[1]) > 31) return null;
    return { bits: (Number(found[1]) << shift) >>> 0, fields: found[2] };
  },
});
const destFields = word => fieldsOf(field(word, 21, 4));
const number = (shift, bits, { signed = false, hex = false, scale = 1 } = {}) => ({
  print: word => {
    let n = field(word, shift, bits);
    if (signed && n & (1 << (bits - 1))) n -= 1 << bits;
    return hex ? hexOf(n * scale) : String(n * scale);
  },
  parse: text => {
    const n = numberOf(text);
    if (n === null || n % scale) return null;
    const value = n / scale, low = signed ? -(1 << (bits - 1)) : 0, high = signed ? (1 << (bits - 1)) - 1 : (2 ** bits) - 1;
    return value < low || value > high ? null : ((value & ((2 ** bits) - 1)) * (2 ** shift)) >>> 0;
  },
});
// a fixed word in the operands, as $ACC or $Q, which no bits hold
const fixed = text => ({ print: () => text, parse: t => (t.trim().replace(/^\$(?=[A-Z])/, '') === text ? 0 : null) });

const OPERANDS = {
  rd: gpr(11), rs: gpr(21), rt: gpr(16),
  sa: number(6, 5),
  simm: number(0, 16, { signed: true }),
  uimm: number(0, 16, { hex: true }),
  // a place in memory: a signed offset from a register
  mem: {
    print: word => `${signed16(word)}($${REGISTERS[field(word, 21, 5)]})`,
    parse: text => {
      const found = /^(.*)\((\$?\w+)\)$/.exec(text.trim());
      const base = found && gprOf(found[2]), offset = found && (found[1].trim() ? numberOf(found[1]) : 0);
      if (base === null || offset === null || offset < -0x8000 || offset > 0x7FFF) return null;
      return ((base << 21) | (offset & 0xFFFF)) >>> 0;
    },
  },
  // where a branch goes, from the instruction after it
  branch: {
    print: (word, address) => hexOf(address + 4 + signed16(word) * 4),
    parse: (text, address) => {
      const target = numberOf(text);
      if (target === null) return null;
      const offset = (target - (address + 4)) / 4;
      return Number.isInteger(offset) && offset >= -0x8000 && offset <= 0x7FFF ? (offset & 0xFFFF) >>> 0 : null;
    },
  },
  // where a jump goes, in the same 256 MB as the instruction after it
  jump: {
    print: (word, address) => hexOf(((address + 4) & 0xF0000000) | (word & 0x3FFFFFF) << 2),
    parse: (text, address) => {
      const target = numberOf(text);
      if (target === null || target % 4 || ((target ^ (address + 4)) & 0xF0000000)) return null;
      return ((target & 0x0FFFFFFF) >>> 2) >>> 0;
    },
  },
  // a code for syscall, and for break as two, GNU's way
  code20: number(6, 20, { hex: true }),
  breakHigh: number(16, 10, { hex: true }), breakLow: number(6, 10, { hex: true }),
  trapCode: number(6, 10, { hex: true }),
  // a cache operation and a prefetch's hint, in the rt field
  op: number(16, 5, { hex: true }),
  hint: number(16, 5),
  // coprocessor 0's registers, by number, and the floating-point unit's control registers
  cop0: register(11, n => `$${n}`, copOf),
  fcr: register(11, n => `$${n}`, copOf),
  fd: fpr(6), fs: fpr(11), ft: fpr(16),
  // vector unit 0's registers in macro mode, with the fields the instruction names, or a field of their own
  vfd: vf(6, destFields), vfs: vf(11, destFields), vft: vf(16, destFields),
  vfsPlain: vf(11, () => ''), vftPlain: vf(16, () => ''),
  vftbc: vf(16, word => 'xyzw'[word & 3]),
  vftw: vf(16, () => 'w'),
  vfsf: vf(11, word => 'xyzw'[field(word, 21, 2)]),
  vftf: vf(16, word => 'xyzw'[field(word, 23, 2)]),
  vid: vi(6), vis: vi(11), vit: vi(16),
  // a vector unit's integer or control register, as CFC2 and CTC2 name it, in the rd field
  vcr: register(11, n => `$vi${n}`, viOf),
  // the vector unit's integer registers that LQI, SQD and their kind count up or down
  visInc: { print: word => `($vi${field(word, 11, 5)}++)`, parse: text => { const f = /^\(\$?vi(\d+)\+\+\)$/.exec(text.trim()); return f && Number(f[1]) < 32 ? Number(f[1]) << 11 : null; } },
  vitInc: { print: word => `($vi${field(word, 16, 5)}++)`, parse: text => { const f = /^\(\$?vi(\d+)\+\+\)$/.exec(text.trim()); return f && Number(f[1]) < 32 ? Number(f[1]) << 16 : null; } },
  visDec: { print: word => `(--$vi${field(word, 11, 5)})`, parse: text => { const f = /^\(--\$?vi(\d+)\)$/.exec(text.trim()); return f && Number(f[1]) < 32 ? Number(f[1]) << 11 : null; } },
  vitDec: { print: word => `(--$vi${field(word, 16, 5)})`, parse: text => { const f = /^\(--\$?vi(\d+)\)$/.exec(text.trim()); return f && Number(f[1]) < 32 ? Number(f[1]) << 16 : null; } },
  visPlace: { print: word => `($vi${field(word, 11, 5)})`, parse: text => { const f = /^\(\$?vi(\d+)\)$/.exec(text.trim()); return f && Number(f[1]) < 32 ? Number(f[1]) << 11 : null; } },
  imm5: number(6, 5, { signed: true }),
  // where VCALLMS starts vector unit 0's program, in bytes of its memory, a multiple of 8, in 12 bits as Sony's
  // assembler keeps it
  imm12: number(6, 12, { hex: true, scale: 8 }),
  // the accumulator, with the fields the instruction names, as GNU's tools write it
  zero: { print: () => '$zero', parse: text => (gprOf(text) === 0 ? 0 : null) },
  ACC: { print: word => `ACC${destFields(word)}`, parse: (text, address, entry, word) => { const f = /^\$?ACC([xyzw]*)$/i.exec(text.trim()); return f && (!f[1] || f[1] === destFields(word)) ? 0 : null; } },
  I: fixed('I'), Q: fixed('Q'), R: fixed('R'), vi27: fixed('$vi27'),
  // a multiply's unit and pmfhl's kinds are in the name, not here
};
// an operand that names a vector register with fields: the fields must be those the instruction's name gives
const FIELDED = new Set(['vfd', 'vfs', 'vft']);

/**
 * The table, an entry per instruction or short form: { name, value, mask, operands, kind, writes, bytes, dest }. A word is
 * the entry's when its bits under `mask` are `value`, and the first such entry is how it's written, short forms first.
 * `dest` adds the fields bits 24 to 21 name to the name, as `vadd.xyzw`.
 */
export const TABLE = [];
const add = (name, value, mask, operands = '', more = {}) => TABLE.push({ name, value: value >>> 0, mask: mask >>> 0, operands: operands ? operands.split(',') : [], kind: 'other', ...more });
const op = n => (n << 26) >>> 0;
const SPECIAL = 0, REGIMM = op(1), MMI = op(28), COP0 = op(16), COP1 = op(17), COP2 = op(18);

// ----- the short forms GNU's tools write, each before the instruction it's a form of
add('nop', 0x00000000, 0xFFFFFFFF);
add('move', 0x0000002D, 0xFC1F07FF, 'rd,rs', { writes: 'rd' });
add('neg', 0x00000022, 0xFFE007FF, 'rd,rt', { writes: 'rd' });
add('negu', 0x00000023, 0xFFE007FF, 'rd,rt', { writes: 'rd' });
add('dneg', 0x0000002E, 0xFFE007FF, 'rd,rt', { writes: 'rd' });
add('dnegu', 0x0000002F, 0xFFE007FF, 'rd,rt', { writes: 'rd' });
add('not', 0x00000027, 0xFC1F07FF, 'rd,rs', { writes: 'rd' });
add('b', op(4), 0xFFFF0000, 'branch', { kind: 'jump' });
add('beqz', op(4), 0xFC1F0000, 'rs,branch', { kind: 'branch' });
add('bnez', op(5), 0xFC1F0000, 'rs,branch', { kind: 'branch' });
add('beqzl', op(20), 0xFC1F0000, 'rs,branch', { kind: 'branch', likely: true });
add('bnezl', op(21), 0xFC1F0000, 'rs,branch', { kind: 'branch', likely: true });
add('bal', REGIMM | (17 << 16), 0xFFFF0000, 'branch', { kind: 'call', writes: 31 });
add('li', op(9), 0xFFE00000, 'rt,simm', { writes: 'rt' });
// li with ori only where the number doesn't fit addiu, as an assembler would choose
add('li', op(13) | 0x8000, 0xFFE08000, 'rt,uimm', { writes: 'rt' });

// ----- SPECIAL
const shift = (name, funct) => add(name, SPECIAL | funct, 0xFFE0003F, 'rd,rt,sa', { writes: 'rd' });
const shiftv = (name, funct) => add(name, SPECIAL | funct, 0xFC0007FF, 'rd,rt,rs', { writes: 'rd' });
const three = (name, base, funct) => add(name, base | funct, 0xFC0007FF, 'rd,rs,rt', { writes: 'rd' });
shift('sll', 0); shift('srl', 2); shift('sra', 3);
shiftv('sllv', 4); shiftv('srlv', 6); shiftv('srav', 7);
add('jr', SPECIAL | 8, 0xFC1FFFFF, 'rs', { kind: 'jr' });
add('jalr', SPECIAL | (31 << 11) | 9, 0xFC1FFFFF, 'rs', { kind: 'call', writes: 31 });
add('jalr', SPECIAL | 9, 0xFC1F07FF, 'rd,rs', { kind: 'call', writes: 'rd' });
three('movz', SPECIAL, 10); three('movn', SPECIAL, 11);
add('syscall', SPECIAL | 12, 0xFFFFFFFF, '', { kind: 'trap' });
add('syscall', SPECIAL | 12, 0xFC00003F, 'code20', { kind: 'trap' });
add('break', SPECIAL | 13, 0xFFFFFFFF, '', { kind: 'trap' });
// one code is 20 bits on the R5900, as Sony's assembler takes it, and two are the high and low 10
add('break', SPECIAL | 13, 0xFC00003F, 'code20', { kind: 'trap' });
add('break', SPECIAL | 13, 0xFC00003F, 'breakHigh,breakLow', { kind: 'trap' });
add('sync', SPECIAL | 15, 0xFFFFFFFF);
add('sync.l', SPECIAL | 15, 0xFFFFFFFF);
add('sync.p', SPECIAL | 0x40F, 0xFFFFFFFF);
add('mfhi', SPECIAL | 16, 0xFFFF07FF, 'rd', { writes: 'rd' });
add('mthi', SPECIAL | 17, 0xFC1FFFFF, 'rs');
add('mflo', SPECIAL | 18, 0xFFFF07FF, 'rd', { writes: 'rd' });
add('mtlo', SPECIAL | 19, 0xFC1FFFFF, 'rs');
shiftv('dsllv', 20); shiftv('dsrlv', 22); shiftv('dsrav', 23);
// the EE's multiplies also give lo to rd
const multiply = (name, base, funct) => {
  add(name, base | funct, 0xFC00FFFF, 'rs,rt');
  add(name, base | funct, 0xFC0007FF, 'rd,rs,rt', { writes: 'rd' });
};
multiply('mult', SPECIAL, 24); multiply('multu', SPECIAL, 25);
// a divide is written with $zero first, as GCC writes it so the assembler adds no check of its own
add('div', SPECIAL | 26, 0xFC00FFFF, 'zero,rs,rt'); add('divu', SPECIAL | 27, 0xFC00FFFF, 'zero,rs,rt');
[['add', 32], ['addu', 33], ['sub', 34], ['subu', 35], ['and', 36], ['or', 37], ['xor', 38], ['nor', 39], ['slt', 42], ['sltu', 43],
  ['dadd', 44], ['daddu', 45], ['dsub', 46], ['dsubu', 47]].forEach(([name, funct]) => three(name, SPECIAL, funct));
add('mfsa', SPECIAL | 40, 0xFFFF07FF, 'rd', { writes: 'rd' });
add('mtsa', SPECIAL | 41, 0xFC1FFFFF, 'rs');
[['tge', 48], ['tgeu', 49], ['tlt', 50], ['tltu', 51], ['teq', 52], ['tne', 54]].forEach(([name, funct]) => {
  add(name, SPECIAL | funct, 0xFC00FFFF, 'rs,rt', { kind: 'trap' });
  add(name, SPECIAL | funct, 0xFC00003F, 'rs,rt,trapCode', { kind: 'trap' });
});
shift('dsll', 56); shift('dsrl', 58); shift('dsra', 59); shift('dsll32', 60); shift('dsrl32', 62); shift('dsra32', 63);

// ----- REGIMM
[['bltz', 0], ['bgez', 1], ['bltzl', 2, true], ['bgezl', 3, true]].forEach(([name, rt, likely]) => add(name, REGIMM | (rt << 16), 0xFC1F0000, 'rs,branch', { kind: 'branch', ...(likely ? { likely } : {}) }));
[['tgei', 8], ['tgeiu', 9], ['tlti', 10], ['tltiu', 11], ['teqi', 12], ['tnei', 14]].forEach(([name, rt]) => add(name, REGIMM | (rt << 16), 0xFC1F0000, 'rs,simm', { kind: 'trap' }));
[['bltzal', 16], ['bgezal', 17], ['bltzall', 18, true], ['bgezall', 19, true]].forEach(([name, rt, likely]) => add(name, REGIMM | (rt << 16), 0xFC1F0000, 'rs,branch', { kind: 'call', writes: 31, ...(likely ? { likely } : {}) }));
add('mtsab', REGIMM | (24 << 16), 0xFC1F0000, 'rs,simm');
add('mtsah', REGIMM | (25 << 16), 0xFC1F0000, 'rs,simm');

// ----- the other primary opcodes
add('j', op(2), 0xFC000000, 'jump', { kind: 'jump' });
add('jal', op(3), 0xFC000000, 'jump', { kind: 'call', writes: 31 });
[['beq', 4], ['bne', 5], ['beql', 20, true], ['bnel', 21, true]].forEach(([name, n, likely]) => add(name, op(n), 0xFC000000, 'rs,rt,branch', { kind: 'branch', ...(likely ? { likely } : {}) }));
[['blez', 6], ['bgtz', 7], ['blezl', 22, true], ['bgtzl', 23, true]].forEach(([name, n, likely]) => add(name, op(n), 0xFC1F0000, 'rs,branch', { kind: 'branch', ...(likely ? { likely } : {}) }));
[['addi', 8], ['addiu', 9], ['slti', 10], ['sltiu', 11], ['daddi', 24], ['daddiu', 25]].forEach(([name, n]) => add(name, op(n), 0xFC000000, 'rt,rs,simm', { writes: 'rt' }));
[['andi', 12], ['ori', 13], ['xori', 14]].forEach(([name, n]) => add(name, op(n), 0xFC000000, 'rt,rs,uimm', { writes: 'rt' }));
add('lui', op(15), 0xFFE00000, 'rt,uimm', { writes: 'rt' });
// loads and stores, with how many bytes each moves
[['ldl', 26, 8], ['ldr', 27, 8], ['lq', 30, 16], ['lb', 32, 1], ['lh', 33, 2], ['lwl', 34, 4], ['lw', 35, 4], ['lbu', 36, 1], ['lhu', 37, 2],
  ['lwr', 38, 4], ['lwu', 39, 4], ['ld', 55, 8]].forEach(([name, n, bytes]) => add(name, op(n), 0xFC000000, 'rt,mem', { kind: 'load', bytes, writes: 'rt' }));
[['sq', 31, 16], ['sb', 40, 1], ['sh', 41, 2], ['swl', 42, 4], ['sw', 43, 4], ['sdl', 44, 8], ['sdr', 45, 8], ['swr', 46, 4], ['sd', 63, 8]]
  .forEach(([name, n, bytes]) => add(name, op(n), 0xFC000000, 'rt,mem', { kind: 'store', bytes }));
add('cache', op(47), 0xFC000000, 'op,mem');
add('pref', op(51), 0xFC000000, 'hint,mem');
add('lwc1', op(49), 0xFC000000, 'ft,mem', { kind: 'load', bytes: 4 });
add('swc1', op(57), 0xFC000000, 'ft,mem', { kind: 'store', bytes: 4 });
add('lqc2', op(54), 0xFC000000, 'vftPlain,mem', { kind: 'load', bytes: 16 });
add('sqc2', op(62), 0xFC000000, 'vftPlain,mem', { kind: 'store', bytes: 16 });

// ----- MMI: the second multiply unit, and the 128-bit registers' parallel sums
const mmiMultiply = (name, funct) => {
  add(name, MMI | funct, 0xFC00FFFF, 'rs,rt');
  add(name, MMI | funct, 0xFC0007FF, 'rd,rs,rt', { writes: 'rd' });
};
multiply('madd', MMI, 0); multiply('maddu', MMI, 1);
add('plzcw', MMI | 4, 0xFC1F07FF, 'rd,rs', { writes: 'rd' });
add('mfhi1', MMI | 16, 0xFFFF07FF, 'rd', { writes: 'rd' });
add('mthi1', MMI | 17, 0xFC1FFFFF, 'rs');
add('mflo1', MMI | 18, 0xFFFF07FF, 'rd', { writes: 'rd' });
add('mtlo1', MMI | 19, 0xFC1FFFFF, 'rs');
mmiMultiply('mult1', 24); mmiMultiply('multu1', 25);
add('div1', MMI | 26, 0xFC00FFFF, 'zero,rs,rt'); add('divu1', MMI | 27, 0xFC00FFFF, 'zero,rs,rt');
mmiMultiply('madd1', 32); mmiMultiply('maddu1', 33);
['lw', 'uw', 'slw', 'lh', 'sh'].forEach((kind, n) => add(`pmfhl.${kind}`, MMI | (n << 6) | 48, 0xFFFF07FF, 'rd', { writes: 'rd' }));
add('pmthl.lw', MMI | 49, 0xFC1FFFFF, 'rs');
[['psllh', 52], ['psrlh', 54], ['psrah', 55], ['psllw', 60], ['psrlw', 62], ['psraw', 63]].forEach(([name, funct]) => add(name, MMI | funct, 0xFFE0003F, 'rd,rt,sa', { writes: 'rd' }));
// the four groups, each by the sa field
const group = (funct, list) => list.forEach(([name, sub, form = 'rd,rs,rt']) => {
  const value = MMI | (sub << 6) | funct;
  const masks = { 'rd,rs,rt': 0xFC0007FF, 'rd,rt': 0xFFE007FF, 'rd,rt,rs': 0xFC0007FF, 'rs,rt': 0xFC00FFFF, rd: 0xFFFF07FF, rs: 0xFC1FFFFF };
  add(name, value, masks[form], form, form.startsWith('rd') ? { writes: 'rd' } : {});
});
group(8, [['paddw', 0], ['psubw', 1], ['pcgtw', 2], ['pmaxw', 3], ['paddh', 4], ['psubh', 5], ['pcgth', 6], ['pmaxh', 7], ['paddb', 8], ['psubb', 9],
  ['pcgtb', 10], ['paddsw', 16], ['psubsw', 17], ['pextlw', 18], ['ppacw', 19], ['paddsh', 20], ['psubsh', 21], ['pextlh', 22], ['ppach', 23],
  ['paddsb', 24], ['psubsb', 25], ['pextlb', 26], ['ppacb', 27], ['pext5', 30, 'rd,rt'], ['ppac5', 31, 'rd,rt']]);
group(40, [['pabsw', 1, 'rd,rt'], ['pceqw', 2], ['pminw', 3], ['padsbh', 4], ['pabsh', 5, 'rd,rt'], ['pceqh', 6], ['pminh', 7], ['pceqb', 10],
  ['padduw', 16], ['psubuw', 17], ['pextuw', 18], ['padduh', 20], ['psubuh', 21], ['pextuh', 22], ['paddub', 24], ['psubub', 25], ['pextub', 26], ['qfsrv', 27]]);
group(9, [['pmaddw', 0], ['psllvw', 2, 'rd,rt,rs'], ['psrlvw', 3, 'rd,rt,rs'], ['pmsubw', 4], ['pmfhi', 8, 'rd'], ['pmflo', 9, 'rd'], ['pinth', 10],
  ['pmultw', 12], ['pdivw', 13, 'rs,rt'], ['pcpyld', 14], ['pmaddh', 16], ['phmadh', 17], ['pand', 18], ['pxor', 19], ['pmsubh', 20], ['phmsbh', 21],
  ['pexeh', 26, 'rd,rt'], ['prevh', 27, 'rd,rt'], ['pmulth', 28], ['pdivbw', 29, 'rs,rt'], ['pexew', 30, 'rd,rt'], ['prot3w', 31, 'rd,rt']]);
group(41, [['pmadduw', 0], ['psravw', 3, 'rd,rt,rs'], ['pmthi', 8, 'rs'], ['pmtlo', 9, 'rs'], ['pinteh', 10], ['pmultuw', 12], ['pdivuw', 13, 'rs,rt'],
  ['pcpyud', 14], ['por', 18], ['pnor', 19], ['pexch', 26, 'rd,rt'], ['pcpyh', 27, 'rd,rt'], ['pexcw', 30, 'rd,rt']]);

// ----- COP0: its registers, its debug and performance registers, its branches and the TLB's and exceptions' own
[['bpc', 0], ['iab', 2], ['iabm', 3], ['dab', 4], ['dabm', 5], ['dvb', 6], ['dvbm', 7]].forEach(([name, code]) => {
  add(`mf${name}`, COP0 | (24 << 11) | code, 0xFFE0FFFF, 'rt', { writes: 'rt' });
  add(`mt${name}`, COP0 | (4 << 21) | (24 << 11) | code, 0xFFE0FFFF, 'rt');
});
// the EE has two performance counters, chosen by bit 1
add('mfps', COP0 | (25 << 11), 0xFFE0FFFD, 'rt,counter', { writes: 'rt' });
add('mtps', COP0 | (4 << 21) | (25 << 11), 0xFFE0FFFD, 'rt,counter');
add('mfpc', COP0 | (25 << 11) | 1, 0xFFE0FFFD, 'rt,counter', { writes: 'rt' });
add('mtpc', COP0 | (4 << 21) | (25 << 11) | 1, 0xFFE0FFFD, 'rt,counter');
add('mfc0', COP0, 0xFFE007FF, 'rt,cop0', { writes: 'rt' });
add('mtc0', COP0 | (4 << 21), 0xFFE007FF, 'rt,cop0');
[['bc0f', 0], ['bc0t', 1], ['bc0fl', 2, true], ['bc0tl', 3, true]].forEach(([name, rt, likely]) => add(name, COP0 | (8 << 21) | (rt << 16), 0xFFFF0000, 'branch', { kind: 'branch', ...(likely ? { likely } : {}) }));
[['tlbr', 1], ['tlbwi', 2], ['tlbwr', 6], ['tlbp', 8], ['eret', 24, 'return'], ['ei', 56], ['di', 57]].forEach(([name, funct, kind]) => add(name, COP0 | (16 << 21) | funct, 0xFFFFFFFF, '', kind ? { kind } : {}));
OPERANDS.counter = number(1, 1);

// ----- COP1: the floating-point unit, singles only
add('mfc1', COP1, 0xFFE007FF, 'rt,fs', { writes: 'rt' });
add('cfc1', COP1 | (2 << 21), 0xFFE007FF, 'rt,fcr', { writes: 'rt' });
add('mtc1', COP1 | (4 << 21), 0xFFE007FF, 'rt,fs');
add('ctc1', COP1 | (6 << 21), 0xFFE007FF, 'rt,fcr');
[['bc1f', 0], ['bc1t', 1], ['bc1fl', 2, true], ['bc1tl', 3, true]].forEach(([name, rt, likely]) => add(name, COP1 | (8 << 21) | (rt << 16), 0xFFFF0000, 'branch', { kind: 'branch', ...(likely ? { likely } : {}) }));
const S = COP1 | (16 << 21);
const FORMS = { 'fd,fs,ft': 0xFFE0003F, 'fd,ft': 0xFFE0F83F, 'fd,fs': 0xFFFF003F, 'fs,ft': 0xFFE007FF };
[['add.s', 0], ['sub.s', 1], ['mul.s', 2], ['div.s', 3], ['sqrt.s', 4, 'fd,ft'], ['abs.s', 5, 'fd,fs'], ['mov.s', 6, 'fd,fs'], ['neg.s', 7, 'fd,fs'],
  ['rsqrt.s', 22], ['adda.s', 24, 'fs,ft'], ['suba.s', 25, 'fs,ft'], ['mula.s', 26, 'fs,ft'], ['madd.s', 28], ['msub.s', 29], ['madda.s', 30, 'fs,ft'],
  ['msuba.s', 31, 'fs,ft'], ['cvt.w.s', 36, 'fd,fs'], ['max.s', 40], ['min.s', 41], ['c.f.s', 48, 'fs,ft'], ['c.eq.s', 50, 'fs,ft'], ['c.lt.s', 52, 'fs,ft'],
  ['c.le.s', 54, 'fs,ft']].forEach(([name, funct, form = 'fd,fs,ft']) => add(name, S | funct, FORMS[form], form));
add('cvt.s.w', COP1 | (20 << 21) | 32, 0xFFFF003F, 'fd,fs');

// ----- COP2: vector unit 0 in macro mode
[['qmfc2', 1], ['cfc2', 2], ['qmtc2', 5], ['ctc2', 6]].forEach(([name, rs]) => {
  const operands = name[0] === 'q' ? 'rt,vfsPlain' : 'rt,vcr';
  const writes = name.includes('mf') ? { writes: 'rt' } : {};
  add(name, COP2 | (rs << 21), 0xFFE007FF, operands, writes);
  add(`${name}.i`, COP2 | (rs << 21) | 1, 0xFFE007FF, operands, writes);
  add(`${name}.ni`, COP2 | (rs << 21), 0xFFE007FF, operands, writes);
});
[['bc2f', 0], ['bc2t', 1], ['bc2fl', 2, true], ['bc2tl', 3, true]].forEach(([name, rt, likely]) => add(name, COP2 | (8 << 21) | (rt << 16), 0xFFFF0000, 'branch', { kind: 'branch', ...(likely ? { likely } : {}) }));

/**
 * The vector units' own operations, shared by vector unit 0's macro mode here and a vector unit program's upper
 * instructions (vu.mjs): { name, code, operands, dest }. `code` is the FMAC table's six bits, 0 to 59, or for the
 * second table, from 60 on, 64 + the index bits 10 to 6 and 1 to 0 make; `bc` means four, one for each field of ft, x
 * first; `upper` an operation a program's upper instruction has too, and `macro` one only the EE's macro mode has.
 */
export const VU_OPERATIONS = [];
const vu = (name, code, operands, more = {}) => VU_OPERATIONS.push({ name, code, operands, dest: true, upper: true, macro: true, ...more });
const BC = 'xyzw';
[['add', 0], ['sub', 4], ['madd', 8], ['msub', 12], ['max', 16], ['mini', 20], ['mul', 24]].forEach(([name, code]) => {
  for (let i = 0; i < 4; i++) vu(`${name}${BC[i]}`, code + i, 'vfd,vfs,vftbc');
});
[['mulq', 28, 'Q'], ['maxi', 29, 'I'], ['muli', 30, 'I'], ['minii', 31, 'I'], ['addq', 32, 'Q'], ['maddq', 33, 'Q'], ['addi', 34, 'I'], ['maddi', 35, 'I'],
  ['subq', 36, 'Q'], ['msubq', 37, 'Q'], ['subi', 38, 'I'], ['msubi', 39, 'I']].forEach(([name, code, with_]) => vu(name, code, `vfd,vfs,${with_}`));
[['add', 40], ['madd', 41], ['mul', 42], ['max', 43], ['sub', 44], ['msub', 45], ['opmsub', 46], ['mini', 47]].forEach(([name, code]) => vu(name, code, 'vfd,vfs,vft', name === 'opmsub' ? { xyz: true } : {}));
vu('iadd', 48, 'vid,vis,vit', { dest: false, upper: false });
vu('isub', 49, 'vid,vis,vit', { dest: false, upper: false });
vu('iaddi', 50, 'vit,vis,imm5', { dest: false, upper: false });
vu('iand', 52, 'vid,vis,vit', { dest: false, upper: false });
vu('ior', 53, 'vid,vis,vit', { dest: false, upper: false });
vu('callms', 56, 'imm12', { dest: false, upper: false, kind: 'call' });
// VCALLMSR starts the program at the address in vi27, which its fs field names
vu('callmsr', 57, 'vi27', { dest: false, upper: false, kind: 'call', macroBits: 27 << 11 });
// the second table: 64 + index
const two = (name, index, operands, more) => vu(name, 64 + index, operands, more);
[['adda', 0], ['suba', 4], ['madda', 8], ['msuba', 12], ['mula', 24]].forEach(([name, index]) => {
  for (let i = 0; i < 4; i++) two(`${name}${BC[i]}`, index + i, 'ACC,vfs,vftbc');
});
[0, 4, 12, 15].forEach((bits, i) => {
  two(`itof${bits}`, 16 + i, 'vft,vfs');
  two(`ftoi${bits}`, 20 + i, 'vft,vfs');
});
[['mulaq', 28, 'Q'], ['mulai', 30, 'I'], ['addaq', 32, 'Q'], ['maddaq', 33, 'Q'], ['addai', 34, 'I'], ['maddai', 35, 'I'], ['subaq', 36, 'Q'],
  ['msubaq', 37, 'Q'], ['subai', 38, 'I'], ['msubai', 39, 'I']].forEach(([name, index, with_]) => two(name, index, `ACC,vfs,${with_}`));
two('abs', 29, 'vft,vfs');
two('clipw', 31, 'vfs,vftw', { xyz: true });
// Sony's assembler for the EE takes ft before fs in vadda and vmsuba, as its own table has them
[['adda', 40], ['madda', 41], ['mula', 42], ['suba', 44], ['msuba', 45], ['opmula', 46]].forEach(([name, index]) => two(name, index, 'ACC,vfs,vft',
  { ...(name === 'opmula' ? { xyz: true } : {}), ...(name === 'adda' || name === 'msuba' ? { macroOperands: 'ACC,vft,vfs' } : {}) }));
two('nop', 47, '', { dest: false });
// vector unit 0's lower operations, which macro mode has as well
two('move', 48, 'vft,vfs', { upper: false });
two('mr32', 49, 'vft,vfs', { upper: false });
two('lqi', 52, 'vft,visInc', { upper: false, kind: 'load', bytes: 16 });
two('sqi', 53, 'vfs,vitInc', { upper: false, kind: 'store', bytes: 16 });
two('lqd', 54, 'vft,visDec', { upper: false, kind: 'load', bytes: 16 });
two('sqd', 55, 'vfs,vitDec', { upper: false, kind: 'store', bytes: 16 });
two('div', 56, 'Q,vfsf,vftf', { dest: false, upper: false });
two('sqrt', 57, 'Q,vftf', { dest: false, upper: false });
two('rsqrt', 58, 'Q,vfsf,vftf', { dest: false, upper: false });
two('waitq', 59, '', { dest: false, upper: false });
two('mtir', 60, 'vit,vfsf', { dest: false, upper: false });
two('mfir', 61, 'vft,vis', { upper: false });
two('ilwr', 62, 'vit,visPlace', { upper: false, kind: 'load', bytes: 2, oneField: true });
two('iswr', 63, 'vit,visPlace', { upper: false, kind: 'store', bytes: 2, oneField: true });
two('rnext', 64, 'vft,R', { upper: false });
two('rget', 65, 'vft,R', { upper: false });
two('rinit', 66, 'R,vfsf', { dest: false, upper: false });
two('rxor', 67, 'R,vfsf', { dest: false, upper: false });

// the bits each operand takes in an operation's word, so those it doesn't use are held at zero
const USES = { vfd: 0x7C0, vid: 0x7C0, imm5: 0x7C0, vfs: 0xF800, vfsPlain: 0xF800, vis: 0xF800, visInc: 0xF800, visDec: 0xF800, visPlace: 0xF800,
  vft: 0x1F0000, vftPlain: 0x1F0000, vit: 0x1F0000, vitInc: 0x1F0000, vitDec: 0x1F0000, vftbc: 0x1F0000, vftw: 0x1F0000,
  vfsf: 0x60F800, vftf: 0x19F0000, imm12: 0x3FFC0 };
/** An operation's bits in its 25 low bits, and the mask that holds at zero what it doesn't use: the FMAC table's code
 *  in bits 5 to 0, or the second table's index in bits 10 to 6 and 1 to 0, with 1111 between. */
export function vuBits(operation) {
  const second = operation.code >= 64, index = operation.code - 64;
  const value = second ? ((index >> 2) << 6) | 0x3C | (index & 3) : operation.code;
  // one that works on x, y and z only has them in dest, always
  let used = operation.dest && !operation.xyz ? 0x1E00000 : 0;
  for (const name of operation.operands ? operation.operands.split(',') : []) used |= USES[name] ?? 0;
  const mask = ((0x1FFFFFF & ~used) | (second ? 0x7FF : 0x3F)) >>> 0;
  return { value: (value | (operation.xyz ? 0xE << 21 : 0)) >>> 0, mask };
}
for (const operation of VU_OPERATIONS) {
  if (!operation.macro) continue;
  const { value, mask } = vuBits(operation), more = operation.macroBits ?? 0;
  add(`v${operation.name}`, COP2 | (1 << 25) | value | more, 0xFE000000 | mask | more, operation.macroOperands ?? operation.operands,
    { dest: operation.dest, oneField: operation.oneField, kind: operation.kind ?? 'other', ...(operation.bytes ? { bytes: operation.bytes } : {}) });
}

// the table's entries by their primary opcode, in order, for a fast look
const BY_OPCODE = Array.from({ length: 64 }, () => []);
for (const entry of TABLE) BY_OPCODE[entry.value >>> 26].push(entry);
const BY_NAME = new Map();
for (const entry of TABLE) {
  if (!BY_NAME.has(entry.name)) BY_NAME.set(entry.name, []);
  BY_NAME.get(entry.name).push(entry);
}

/**
 * The instruction a word makes at `address`, or null when it's none of the EE's:
 *   { name, text, kind, likely, rs, rt, rd, writes, imm, target, bytes }
 * `kind` is 'branch' for a branch that may or may not go, `likely` when its delay slot runs only if it goes, 'jump' for
 * one that always goes, 'call' for a call, 'return' for `jr $ra` and `eret`, 'switch' for a `jr` through any other
 * register, 'load' or 'store' with how many `bytes`, 'trap' for syscall, break and the traps, and 'other'. `target` is
 * where a branch, a jump or a call goes, `imm` the 16 bits it holds, with its sign where the processor gives one, and
 * `writes` the general register it writes, or null for none.
 */
export function decode(word, address = 0) {
  word >>>= 0;
  for (const entry of BY_OPCODE[word >>> 26]) {
    if (((word & entry.mask) >>> 0) !== entry.value) continue;
    if (entry.oneField && ![1, 2, 4, 8].includes(field(word, 21, 4))) continue;
    // an instruction of the vector unit's with no fields named shows a dot alone, as GNU's tools show it
    const name = entry.dest ? `${entry.name}.${destFields(word)}` : entry.name;
    const operands = entry.operands.map(o => OPERANDS[o].print(word, address, entry)).join(', ');
    const rs = field(word, 21, 5), rt = field(word, 16, 5), rd = field(word, 11, 5);
    let kind = entry.kind;
    if (kind === 'jr') kind = rs === 31 ? 'return' : 'switch';
    const writes = entry.writes === 'rd' ? rd : entry.writes === 'rt' ? rt : entry.writes ?? null;
    const made = { name, text: operands ? `${name.padEnd(7)} ${operands}` : name, kind, rs, rt, rd, writes: writes || null };
    if (entry.likely) made.likely = true;
    if (entry.bytes) made.bytes = entry.bytes;
    if (entry.operands.includes('simm') || entry.operands.includes('mem')) made.imm = signed16(word);
    else if (entry.operands.includes('uimm')) made.imm = word & 0xFFFF;
    if (entry.operands.includes('branch')) made.target = (address + 4 + signed16(word) * 4) >>> 0;
    if (entry.operands.includes('jump')) made.target = (((address + 4) & 0xF0000000) | (word & 0x3FFFFFF) << 2) >>> 0;
    return made;
  }
  return null;
}

// splits operands at the commas outside brackets
function operandsOf(text) {
  const parts = [];
  let depth = 0, current = '';
  for (const c of text) {
    if (c === ',' && !depth) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * The word an instruction's text makes at `address`, as GNU's assembler would encode that one instruction, or an error
 * that says why it can't. Short forms that become more than one instruction, as `li` of a 32-bit number, are the
 * assembler's (assemble.mjs), not this.
 */
export function encode(text, address = 0) {
  const found = /^\s*([a-z][\w.]*)\s*(.*?)\s*$/i.exec(text);
  if (!found) throw new Error(`"${text}" isn't an instruction.`);
  const mnemonic = found[1].toLowerCase(), given = operandsOf(found[2]);
  // a vector unit's instruction names the fields it works on after a dot
  const candidates = [...(BY_NAME.get(mnemonic) ?? []).map(entry => ({ entry, dest: 0 }))];
  const dotted = /^(.+)\.([xyzw]*)$/.exec(mnemonic);
  if (dotted && /^x?y?z?w?$/.test(dotted[2])) for (const entry of BY_NAME.get(dotted[1]) ?? []) if (entry.dest) candidates.push({ entry, dest: bitsOf(dotted[2]) });
  if (!candidates.length) throw new Error(`"${mnemonic}" isn't one of the EE's instructions.`);
  for (const { entry, dest } of candidates) {
    if (entry.operands.length !== given.length) continue;
    let word = entry.value | (dest << 21);
    let fits = true;
    for (const [i, name] of entry.operands.entries()) {
      const bits = OPERANDS[name].parse(given[i], address, entry, word);
      if (bits === null) { fits = false; break; }
      if (typeof bits === 'object') {
        // a vector register's fields: none, or those the name gives, or the one field the operand is about
        word |= bits.bits;
        const want = FIELDED.has(name) ? destFields(word) : OPERANDS[name].print(word, address, entry).replace(/^\$vf\d+/, '');
        if (bits.fields && bits.fields !== want) {
          if (name === 'vftbc' && /^[xyzw]$/.test(bits.fields)) word = (word & ~3) | 'xyzw'.indexOf(bits.fields);
          else if (name === 'vfsf' && /^[xyzw]$/.test(bits.fields)) word = (word & ~0x600000) | ('xyzw'.indexOf(bits.fields) << 21);
          else if (name === 'vftf' && /^[xyzw]$/.test(bits.fields)) word = (word & ~0x1800000) | ('xyzw'.indexOf(bits.fields) << 23);
          else { fits = false; break; }
        }
      } else word |= bits;
    }
    word >>>= 0;
    // it fits only if the word is still this entry's, so a short form's limits hold
    if (fits && ((word & entry.mask) >>> 0) === entry.value && (!entry.oneField || [1, 2, 4, 8].includes(field(word, 21, 4)))) return word;
  }
  throw new Error(`"${text.trim()}" doesn't fit any form of ${mnemonic}.`);
}

/** Whether a word is one of the EE's instructions. */
export const isInstruction = word => decode(word) !== null;

/** Whether an instruction's kind goes elsewhere for good once its delay slot has run: a return, a jump, a switch. */
export const goesAway = kind => kind === 'return' || kind === 'jump' || kind === 'switch';
