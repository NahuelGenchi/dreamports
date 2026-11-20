// A small module for the PlayStation 2's IOP and a second program for its EE, with nothing from any game in them,
// written here, for the function check's test of the programs a disc has beside the one it boots
// (../ps2-twin-programs.mjs). The module is an IRX file as the console's loader takes one: its code and values from 0,
// and the list of every place that holds an address, for the loader to move wherever it puts the module. Its
// instructions are written as their words, with the few lines below that make them.
//
// The module's functions, in order:
//   add3     a0 + a1 + a2
//   store    writes a0 to the module's counter and gives back what was there, through an address the loader moves
//   five     the sum of five arguments, the fifth on the stack, 16 bytes above sp
//   wide     a0:a1 + a2:a3 as 64-bit numbers, given back in v0 and v1
//   twice    add3(a0, a0, 0), through a call the loader moves
//   one, two a0 + 1 and a0 + 2, reached only through the module's table of functions
//   pick     calls the function its table has for a0's lowest bit
//   voice    writes a0 to the SPU2's first register
//   ask      calls another module, through the module's own stub
// then the table of stubs to another module, and after the code the counter and the table of functions.

const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, sp: 29, ra: 31 };
const i = (op, rs, rt, imm) => ((op << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xFFFF)) >>> 0;
const r = (rs, rt, rd, sa, fn) => ((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (sa << 6) | fn) >>> 0;
const nop = 0;
const addu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x21);
const sltu = (rd, rs, rt) => r(rs, rt, rd, 0, 0x2B);
const addiu = (rt, rs, imm) => i(9, rs, rt, imm);
const andi = (rt, rs, imm) => i(12, rs, rt, imm);
const lui = (rt, imm) => i(15, 'zero', rt, imm);
const sll = (rd, rt, sa) => r('zero', rt, rd, sa, 0);
const jr = rs => r(rs, 'zero', 'zero', 0, 8);
const jalr = rs => r(rs, 'zero', 'ra', 0, 9);
const lw = (rt, offset, base) => i(0x23, base, rt, offset);
const sw = (rt, offset, base) => i(0x2B, base, rt, offset);
const sh = (rt, offset, base) => i(0x29, base, rt, offset);
const jal = () => (3 << 26) >>> 0;

/** The library the module's stub calls, and the number of the function it asks for. */
export const LIBRARY = 'sysclib', ASKED = 12;
/** What the module's counter starts as. */
export const COUNTER = 0x00C0FFEE;
const NAME = Buffer.from(LIBRARY.padEnd(8, '\0'), 'latin1');
const R_MIPS_32 = 2, R_MIPS_26 = 4, R_MIPS_HI16 = 5, R_MIPS_LO16 = 6;

// an ELF file of these sections, each { name, type, flags, address, bytes }, with one segment of those the console
// loads, flags & 2
function elfOf({ type, entry, flags, sections }) {
  const names = ['', ...sections.map(s => s.name), '.shstrtab'];
  const strings = Buffer.from(`${names.join('\0')}\0`, 'latin1');
  const nameAt = n => names.slice(0, n).reduce((sum, name) => sum + name.length + 1, 0);
  let offset = 0x80;
  const placed = sections.map(s => {
    const at = offset;
    offset = (offset + s.bytes.length + 15) & ~15;
    return { ...s, offset: at };
  });
  const stringsAt = offset, tableAt = (stringsAt + strings.length + 15) & ~15;
  const file = Buffer.alloc(tableAt + names.length * 40);
  file.set([0x7F, 0x45, 0x4C, 0x46, 1, 1, 1], 0);
  file.writeUInt16LE(type, 16);
  file.writeUInt16LE(8, 18);
  file.writeUInt32LE(1, 20);
  file.writeUInt32LE(entry, 24);
  file.writeUInt32LE(52, 28);
  file.writeUInt32LE(tableAt, 32);
  file.writeUInt32LE(flags, 36);
  file.writeUInt16LE(52, 40);
  file.writeUInt16LE(32, 42);
  file.writeUInt16LE(1, 44);
  file.writeUInt16LE(40, 46);
  file.writeUInt16LE(names.length, 48);
  file.writeUInt16LE(names.length - 1, 50);
  const loaded = placed.filter(s => s.flags & 2), first = loaded[0], last = loaded.at(-1);
  file.writeUInt32LE(1, 52);
  file.writeUInt32LE(first.offset, 56);
  file.writeUInt32LE(first.address, 60);
  file.writeUInt32LE(first.address, 64);
  file.writeUInt32LE(last.offset + last.bytes.length - first.offset, 68);
  file.writeUInt32LE(last.address + last.bytes.length - first.address, 72);
  file.writeUInt32LE(7, 76);
  for (const s of placed) s.bytes.copy(file, s.offset);
  strings.copy(file, stringsAt);
  [...placed, { name: '.shstrtab', type: 3, flags: 0, address: 0, offset: stringsAt, bytes: strings }].forEach((s, n) => {
    const o = tableAt + (n + 1) * 40;
    file.writeUInt32LE(nameAt(n + 1), o);
    file.writeUInt32LE(s.type, o + 4);
    file.writeUInt32LE(s.flags, o + 8);
    file.writeUInt32LE(s.address, o + 12);
    file.writeUInt32LE(s.offset, o + 16);
    file.writeUInt32LE(s.bytes.length, o + 20);
  });
  return file;
}

const wordsOf = words => { const bytes = Buffer.alloc(words.length * 4); words.forEach((word, n) => bytes.writeUInt32LE(word >>> 0, n * 4)); return bytes; };

/** The module: { irx, labels, functions }, its file, where each of its parts is from its start, and each function's
 *  { name, address, size }. */
export function madeUpModule() {
  // each part as its words, and each word that holds an address as [word, kind, what it's the address of]
  const parts = [
    ['add3', [addu('v0', 'a0', 'a1'), jr('ra'), addu('v0', 'v0', 'a2')]],
    ['store', [[lui('v1', 0), R_MIPS_HI16, 'counter'], [lw('v0', 0, 'v1'), R_MIPS_LO16, 'counter'], jr('ra'), [sw('a0', 0, 'v1'), R_MIPS_LO16, 'counter']]],
    ['five', [lw('t0', 16, 'sp'), addu('v0', 'a0', 'a1'), addu('v0', 'v0', 'a2'), addu('v0', 'v0', 'a3'), jr('ra'), addu('v0', 'v0', 't0')]],
    ['wide', [addu('v0', 'a0', 'a2'), sltu('t0', 'v0', 'a0'), addu('v1', 'a1', 'a3'), jr('ra'), addu('v1', 'v1', 't0')]],
    ['twice', [addiu('sp', 'sp', -24), sw('ra', 16, 'sp'), addu('a1', 'a0', 'zero'), [jal(), R_MIPS_26, 'add3'], addu('a2', 'zero', 'zero'), lw('ra', 16, 'sp'), jr('ra'), addiu('sp', 'sp', 24)]],
    ['one', [jr('ra'), addiu('v0', 'a0', 1)]],
    ['two', [jr('ra'), addiu('v0', 'a0', 2)]],
    ['pick', [addiu('sp', 'sp', -24), sw('ra', 16, 'sp'), andi('t0', 'a0', 1), sll('t0', 't0', 2), [lui('t1', 0), R_MIPS_HI16, 'table'], addu('t1', 't1', 't0'), [lw('t1', 0, 't1'), R_MIPS_LO16, 'table'],
      jalr('t1'), nop, lw('ra', 16, 'sp'), jr('ra'), addiu('sp', 'sp', 24)]],
    ['voice', [lui('t0', 0xBF90), jr('ra'), sh('a0', 0, 't0')]],
    ['ask', [addiu('sp', 'sp', -24), sw('ra', 16, 'sp'), [jal(), R_MIPS_26, 'stub'], nop, lw('ra', 16, 'sp'), jr('ra'), addiu('sp', 'sp', 24)]],
    // the table of stubs to one library: its mark, a word of zeros, its version, its name, then a stub for each function
    ['imports', [0x41E00000, 0, 0x00000101, NAME.readUInt32LE(0), NAME.readUInt32LE(4)]],
    ['stub', [jr('ra'), addiu('zero', 'zero', ASKED), 0, 0]],
  ];
  // to where a line of 16 bytes ends, as the file keeps each part from one
  while (parts.reduce((sum, [, words]) => sum + words.length, 0) % 4) parts.at(-1)[1].push(0);
  const values = [
    ['counter', [COUNTER]],
    ['table', [[0, R_MIPS_32, 'one'], [0, R_MIPS_32, 'two']]],
  ];
  const labels = {};
  let at = 0;
  for (const [name, words] of parts) { labels[name] = at; at += words.length * 4; }
  const textSize = at;
  for (const [name, words] of values) { labels[name] = at; at += words.length * 4; }
  // each word with its addend in it, as an IRX file keeps one, and its place in the list for the loader
  const lay = (list, from) => {
    const words = [], relocations = [];
    let place = from;
    for (const [, each] of list) {
      for (const word of each) {
        if (Array.isArray(word)) {
          const [plain, kind, target] = word, to = labels[target];
          relocations.push([place, kind]);
          words.push(kind === R_MIPS_32 ? to : kind === R_MIPS_26 ? plain | (to >>> 2) : kind === R_MIPS_HI16 ? plain | (((to + 0x8000) >>> 16) & 0xFFFF) : plain | (to & 0xFFFF));
        } else words.push(word);
        place += 4;
      }
    }
    return { bytes: wordsOf(words), relocations: wordsOf(relocations.flat()) };
  };
  const text = lay(parts, 0), data = lay(values, textSize);
  const iopmod = Buffer.alloc(32);
  iopmod.writeUInt32LE(0xFFFFFFFF, 0);
  iopmod.writeUInt32LE(textSize, 12);
  iopmod.writeUInt32LE(data.bytes.length, 16);
  const irx = elfOf({ type: 0xFF80, entry: 0, flags: 1, sections: [
    { name: '.iopmod', type: 0x70000080, flags: 0, address: 0, bytes: iopmod },
    { name: '.text', type: 1, flags: 6, address: 0, bytes: text.bytes },
    { name: '.data', type: 1, flags: 3, address: textSize, bytes: data.bytes },
    { name: '.rel.text', type: 9, flags: 0, address: 0, bytes: text.relocations },
    { name: '.rel.data', type: 9, flags: 0, address: 0, bytes: data.relocations },
  ] });
  const functions = parts.filter(([name]) => name !== 'imports' && name !== 'stub').map(([name, words]) => ({ name, address: labels[name], size: words.length * 4 }));
  return { irx, labels, functions };
}

/** Where the second program for the EE loads. */
export const OTHER = 0x00300000;

/** The second program: { elf, labels }. Its one function, other_sum, gives back a0 + a1 + its own word of values. */
export function madeUpOther() {
  const values = OTHER + 0x40;
  const words = [lui('v1', values >>> 16), lw('v1', values & 0xFFFF, 'v1'), addu('v0', 'a0', 'a1'), jr('ra'), addu('v0', 'v0', 'v1')];
  const text = Buffer.alloc(0x40), data = Buffer.alloc(16);
  wordsOf(words).copy(text);
  data.writeUInt32LE(1000, 0);
  const sections = [{ name: '.text', type: 1, flags: 6, address: OTHER, bytes: text }, { name: '.data', type: 1, flags: 3, address: values, bytes: data }];
  return { elf: elfOf({ type: 2, entry: OTHER, flags: 0x20924001, sections }), labels: { other_sum: OTHER, values }, size: words.length * 4 };
}
