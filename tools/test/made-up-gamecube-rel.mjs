// A small GameCube module with nothing from any game in it, written here, for the tools' tests: a REL, the kind of
// program a game loads from its disc as it runs, anywhere the console has room, so every address in it is written by
// the console as it loads, from the module's own list of what to write where. Its instructions are written as their
// words, as made-up-gamecube.mjs's are.
//
// Its functions, in order, in its one section of code:
//   prolog   what the console calls as it loads the module: calls twice and gives back what it gave
//   twice    r3 + r3
//   epilog   what the console calls as it lets the module go: gives back 0
//   hidden   reached only through the pointer in the module's values: r3 + 1
// and its values: a pointer to hidden, which the console writes too, and a number.

const blr = 0x4E800020, bl0 = 0x48000001;
const d = (op, rt, ra, imm) => ((op << 26) | (rt << 21) | (ra << 16) | (imm & 0xFFFF)) >>> 0;
const addi = (rt, ra, imm) => d(14, rt, ra, imm), li = (rt, imm) => addi(rt, 0, imm);
const stwu = (rs, offset, ra) => d(37, rs, ra, offset), stw = (rs, offset, ra) => d(36, rs, ra, offset), lwz = (rt, offset, ra) => d(32, rt, ra, offset);
const add = (rt, ra, rb) => ((31 << 26) | (rt << 21) | (ra << 16) | (rb << 11) | (266 << 1)) >>> 0;
const mflr0 = 0x7C0802A6, mtlr0 = 0x7C0803A6;

// the kinds of thing the console writes as it loads a module: a whole address, a call's target, and the three that
// only move along the list
const ADDR32 = 1, REL24 = 10, SECTION = 202, END = 203;

/** The module: { bytes, id, functions }, `functions` each function's name, where it is in the file and its size. */
export function madeUpRel({ id = 7 } = {}) {
  const code = [
    // prolog, at 0: a call whose target the console writes
    mflr0, stwu(1, -16, 1), stw(0, 20, 1), li(3, 21), bl0, lwz(0, 20, 1), addi(1, 1, 16), mtlr0, blr,
    // twice, at 0x24
    add(3, 3, 3), blr,
    // epilog, at 0x2C
    li(3, 0), blr,
    // hidden, at 0x34
    addi(3, 3, 1), blr,
  ];
  const sizes = { prolog: 0x24, twice: 8, epilog: 8, hidden: 8 }, offsets = { prolog: 0, twice: 0x24, epilog: 0x2C, hidden: 0x34 };
  const text = Buffer.alloc(code.length * 4), values = Buffer.alloc(8);
  code.forEach((word, n) => text.writeUInt32BE(word, n * 4));
  values.writeUInt32BE(1234, 4);
  // the header, the table of sections, the sections, the list of modules it's written from and the list for this one
  const HEADER = 0x40, sections = 3, table = HEADER, textAt = table + sections * 8, valuesAt = textAt + text.length;
  const importsAt = valuesAt + values.length, listAt = importsAt + 8;
  const list = [
    [0, SECTION, 1, 0], [0x10, REL24, 1, offsets.twice],
    [0, SECTION, 2, 0], [0, ADDR32, 1, offsets.hidden],
    [0, END, 0, 0],
  ];
  const bytes = Buffer.alloc(listAt + list.length * 8);
  bytes.writeUInt32BE(id, 0);
  bytes.writeUInt32BE(sections, 0x0C);
  bytes.writeUInt32BE(table, 0x10);
  bytes.writeUInt32BE(1, 0x1C);
  bytes.writeUInt32BE(listAt, 0x24);
  bytes.writeUInt32BE(importsAt, 0x28);
  bytes.writeUInt32BE(8, 0x2C);
  bytes[0x30] = 1;
  bytes[0x31] = 1;
  bytes.writeUInt32BE(offsets.prolog, 0x34);
  bytes.writeUInt32BE(offsets.epilog, 0x38);
  // section 0 is none, 1 the code, with the bit that says so, and 2 the values
  bytes.writeUInt32BE(textAt | 1, table + 8);
  bytes.writeUInt32BE(text.length, table + 12);
  bytes.writeUInt32BE(valuesAt, table + 16);
  bytes.writeUInt32BE(values.length, table + 20);
  text.copy(bytes, textAt);
  values.copy(bytes, valuesAt);
  bytes.writeUInt32BE(id, importsAt);
  bytes.writeUInt32BE(listAt, importsAt + 4);
  list.forEach(([offset, type, section, addend], n) => {
    bytes.writeUInt16BE(offset, listAt + n * 8);
    bytes[listAt + n * 8 + 2] = type;
    bytes[listAt + n * 8 + 3] = section;
    bytes.writeUInt32BE(addend, listAt + n * 8 + 4);
  });
  return { bytes, id, functions: Object.fromEntries(Object.keys(offsets).map(name => [name, { address: textAt + offsets[name], size: sizes[name] }])) };
}
