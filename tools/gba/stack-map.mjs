// The stack map: what each function in agbcc's assembly of our own C puts on the console's stack (gba/stack.mjs uses
// it). It reads the assembly the console's compiler writes with -g: the code, which the tools' own assembler
// (thumb.mjs) places byte by byte, and the DWARF 2 records beside it, written as .byte and .ascii lines, which say
// where each parameter and local lives and which line of the source each instruction comes from.
//
// A value is only what the C gives as compiled: a number, a name's address, a parameter as it arrived, an address in
// the function's own frame, or simple arithmetic of those. Anything else, such as a load from memory or two paths that
// bring different values, is unknown, with the reason, and never guessed.

import { assemble } from './thumb.mjs';

const REGISTERS = { r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7, r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15, sl: 10, fp: 11, ip: 12, sp: 13, lr: 14, pc: 15 };
const SP = 13, LR = 14, PC = 15;
const nameOf = n => (n === SP ? 'sp' : n === LR ? 'lr' : n === PC ? 'pc' : `r${n}`);
const CONDITIONAL = /^b(eq|ne|cs|hs|cc|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le)$/;
// A load's size and whether it extends the sign, and a store's size.
const LOADS = { ldr: [4, false], ldrh: [2, false], ldrb: [1, false], ldrsh: [2, true], ldsh: [2, true], ldrsb: [1, true], ldsb: [1, true] };
const STORES = { str: 4, strh: 2, strb: 1 };
// DWARF 2's numbers for the records and fields read here.
const TAG = { array: 0x01, formal: 0x05, block: 0x0b, pointer: 0x0f, structure: 0x13, typedef: 0x16, union: 0x17, subrange: 0x21, base: 0x24, constType: 0x26, subprogram: 0x2e, variable: 0x34, volatileType: 0x35 };
const AT = { location: 0x02, name: 0x03, byteSize: 0x0b, lowPc: 0x11, lowerBound: 0x22, upperBound: 0x2f, encoding: 0x3e, frameBase: 0x40, type: 0x49 };

/**
 * The stack map of `assemblyText`, agbcc's assembly of a C file built with -g:
 * { functions: { [name]: { pushes, frame, frameBase, params, locals, calls, stores, notes? } }, lines }.
 * - pushes: [{ reg, slot }], what the prologue saves, in the order it stores them, with each slot's offset from the sp
 *   at entry (lr at -4). A high register saved through a low one (mov r7, r8 then push {r7}) is named as itself.
 * - frame: the bytes the prologue takes from sp after the pushes. frameBase: where DWARF's frame base is, from the sp
 *   at entry (normally the sp after the prologue).
 * - params: [{ name, location, entry, bytes }], location as DWARF gives it ({ reg } or { fbreg }), entry where it
 *   arrives ('r0' to 'r3', or { stack: offset from the sp at entry }).
 * - locals: [{ name, fbreg, bytes }], the locals DWARF keeps in the frame, bytes null where the type's size is unknown.
 * - registers: [{ name, reg, bytes }], the locals DWARF keeps in a register. agbcc gives none for a local of one or
 *   two bytes, which it holds widened to a word, as its debugging records take it for one optimized out.
 * - start: { bytes, loads }, how many bytes the prologue is, from the function's first, and whether it loads a word
 *   kept beside the function, as one with a frame too big for an instruction's own number does.
 * - calls: [{ offset, returnOffset, line, file, callee, regs, args, sp }], each bl that calls, offset from the
 *   function's start. callee is null for a call through a register (bl _call_via_rN), with `through` and `target`
 *   saying which register and what it holds. regs are r4 to r11 at the call, only those the function changed on some
 *   path to it, and writers, for each of those, the lines of the instructions that can have written it last ([{ line,
 *   file }], with { entry: true } for a path on which nothing has); args are r0 to r3; sp is the sp at the call from
 *   the frame base.
 * - stores: [{ offset, line, file, bytes, fbreg, slot, value }], every store to the stack after the prologue, fbreg
 *   from the frame base and slot from the sp at entry (both null where the address in the frame isn't known).
 * - lines: [{ section, at, line, file }], the rows of .debug_line, by their place in the code.
 * A value is { const }, { symbol, add }, { param } (as it arrived), { sp } (an address in the frame, from the frame
 * base) or { unknown: why }; an unknown that is a register the function's caller left gives `caller` too.
 */
export function stackMap(assemblyText) {
  // The code goes to the tools' assembler with the debugging sections left out, line for line, and those sections are
  // read here as bytes, as they would be assembled.
  const code = [], codeLines = [], debugLines = new Map();
  let section = '.text';
  assemblyText.split('\n').forEach((raw, k) => {
    const { labels, rest } = labelsOf(uncomment(raw));
    const directive = /^(\.\w+)\s*(.*)$/.exec(rest);
    const name = directive?.[1].toLowerCase();
    if (name === '.text' || name === '.data' || name === '.bss') section = name;
    else if (name === '.section') section = operands(directive[2])[0];
    if (section.startsWith('.debug')) {
      code.push('');
      if (!debugLines.has(section)) debugLines.set(section, []);
      debugLines.get(section).push({ labels, rest });
    } else {
      code.push(raw);
      codeLines.push({ n: k + 1, labels, rest });
    }
  });
  const made = assemble(code.join('\n'));
  // Where each line of the code went: its section and the offset of its first byte.
  const where = new Map();
  for (const [name, { lines }] of Object.entries(made.sections)) lines.forEach((n, at) => { if (!where.has(n)) where.set(n, { section: name, at }); });
  const debug = new Map([...debugLines].map(([name, lines]) => [name, sectionBytes(lines)]));
  const place = named => {
    if (!named) return null;
    if (made.sections[named.name] && !made.symbols.has(named.name)) return { section: named.name, at: named.addend };
    const symbol = made.symbols.get(named.name);
    return symbol ? { section: symbol.section, at: symbol.at + named.addend } : null;
  };
  const rows = readLines(debug.get('.debug_line'), place);
  const bySection = new Map();
  for (const row of rows) {
    if (!bySection.has(row.section)) bySection.set(row.section, []);
    bySection.get(row.section).push(row);
  }
  for (const list of bySection.values()) list.sort((a, b) => a.at - b.at);
  // The row a place in the code is under: the last at or before it.
  const rowAt = (name, at) => {
    let found = null;
    for (const row of bySection.get(name) ?? []) {
      if (row.at > at) break;
      found = row;
    }
    return found;
  };
  const described = readInfo(debug);
  const words = new Map(made.relocations.filter(r => r.kind === 'word').map(r => [`${r.section}:${r.at}`, r]));
  const functions = {};
  for (const fn of readFunctions(codeLines, made, where)) functions[fn.name] = mapFunction(fn, made, words, described.get(fn.name), rowAt);
  return { functions, lines: rows };
}

// --- reading the assembly's text

const uncomment = raw => raw.replace(/^((?:[^"@]|"(?:[^"\\]|\\.)*")*)@.*$/, '$1').trim();

function labelsOf(line) {
  const labels = [];
  for (let m; (m = /^([A-Za-z_.$][\w.$]*):\s*/.exec(line));) {
    labels.push(m[1]);
    line = line.slice(m[0].length);
  }
  return { labels, rest: line };
}

// A line's operands, split at the commas outside [] and {}.
function operands(rest) {
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < rest.length; i++) {
    if ('[{'.includes(rest[i])) depth++;
    else if (']}'.includes(rest[i])) depth--;
    else if (rest[i] === ',' && !depth) {
      parts.push(rest.slice(from, i).trim());
      from = i + 1;
    }
  }
  if (rest.trim()) parts.push(rest.slice(from).trim());
  return parts;
}

const number = text => {
  const m = /^([-+]?)(0x[0-9a-f]+|\d+)$/i.exec(text.trim());
  return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) : null;
};
const isImmediate = text => text.trim().startsWith('#');
const immediate = text => number(text.trim().slice(1));

// A number, or a name with a number added ({ name, addend }), or one name less another ({ name, addend, less }).
function expression(text) {
  text = text.trim();
  const plain = number(text);
  if (plain !== null) return plain;
  let m = /^([A-Za-z_.$][\w.$]*)\s*-\s*([A-Za-z_.$][\w.$]*)$/.exec(text);
  if (m) return { name: m[1], addend: 0, less: m[2] };
  m = /^([A-Za-z_.$][\w.$]*)\s*(?:([-+])\s*([-+]?)\s*(0x[0-9a-f]+|\d+))?$/i.exec(text);
  if (!m) return null;
  const sign = (m[2] === '-' ? -1 : 1) * (m[3] === '-' ? -1 : 1);
  return { name: m[1], addend: m[2] ? sign * Number(m[4]) : 0 };
}

// The bytes of a quoted string, with its escapes.
function quoted(text) {
  const bytes = [];
  for (const [, inside] of text.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const escapes = { n: 10, t: 9, r: 13, b: 8, f: 12, '"': 34, '\\': 92 };
    for (let i = 0; i < inside.length; i++) {
      if (inside[i] !== '\\') {
        bytes.push(inside.charCodeAt(i) & 255);
        continue;
      }
      const octal = /^[0-7]{1,3}/.exec(inside.slice(i + 1));
      if (octal) {
        bytes.push(parseInt(octal[0], 8) & 255);
        i += octal[0].length;
      } else bytes.push(escapes[inside[++i]] ?? inside.charCodeAt(i));
    }
  }
  return bytes;
}

// A debugging section's bytes, as its lines write them, with each name a .4byte holds, by its offset (`names`), and
// each label in the section (`labels`).
function sectionBytes(lines) {
  const bytes = [], names = new Map(), labels = new Map();
  const put = (value, size) => { for (let k = 0; k < size; k++) bytes.push((value >> (8 * k)) & 255); };
  const data = (args, size) => {
    for (const part of operands(args)) {
      const value = expression(part);
      if (value !== null && typeof value === 'object') names.set(bytes.length, value);
      put(typeof value === 'number' ? value : 0, size);
    }
  };
  const leb = (value, signed) => {
    for (;;) {
      const low = value & 127;
      value = signed ? value >> 7 : value >>> 7;
      const done = signed ? (value === 0 && !(low & 64)) || (value === -1 && low & 64) : value === 0;
      bytes.push(done ? low : low | 128);
      if (done) return;
    }
  };
  for (const { labels: here, rest } of lines) {
    for (const label of here) labels.set(label, bytes.length);
    const m = /^(\.\w+)\s*(.*)$/.exec(rest);
    if (!m) continue;
    const args = m[2];
    switch (m[1].toLowerCase()) {
      case '.byte': data(args, 1); break;
      case '.2byte': case '.short': case '.hword': data(args, 2); break;
      case '.4byte': case '.word': case '.long': data(args, 4); break;
      case '.uleb128': for (const part of operands(args)) leb(number(part) ?? 0, false); break;
      case '.sleb128': for (const part of operands(args)) leb(number(part) ?? 0, true); break;
      case '.ascii': bytes.push(...quoted(args)); break;
      case '.asciz': case '.string': bytes.push(...quoted(args), 0); break;
      case '.align': for (const to = 1 << Number(operands(args)[0] ?? 0); bytes.length % to;) bytes.push(0); break;
      case '.space': case '.skip': for (let k = number(operands(args)[0]) ?? 0; k > 0; k--) bytes.push(0); break;
      default: break;
    }
  }
  return { bytes, names, labels };
}

function reader(section, at = 0) {
  const { bytes, names } = section;
  const r = {
    at,
    u8: () => bytes[r.at++] ?? 0,
    u16: () => r.u8() | r.u8() << 8,
    u32: () => (r.u16() | r.u16() << 16) >>> 0,
    // The name a .4byte here holds, if it holds one.
    name: () => names.get(r.at) ?? null,
    uleb: () => {
      let value = 0, shift = 0, b;
      do {
        b = r.u8();
        value += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128 && r.at < bytes.length);
      return value;
    },
    sleb: () => {
      let value = 0, shift = 0, b;
      do {
        b = r.u8();
        value += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128 && r.at < bytes.length);
      return b & 64 ? value - 2 ** shift : value;
    },
    text: () => {
      let s = '';
      while (r.at < bytes.length && bytes[r.at]) s += String.fromCharCode(bytes[r.at++]);
      r.at++;
      return s;
    },
  };
  return r;
}

// --- DWARF 2

// The rows of .debug_line's line programs, each with its place in the code ({ section, at }), as `place` finds the
// names its addresses are written as.
function readLines(section, place) {
  const rows = [];
  if (!section) return rows;
  const r = reader(section);
  while (r.at + 4 <= section.bytes.length) {
    const length = r.u32();
    if (!length) break;
    const end = r.at + length;
    r.u16();
    const headerLength = r.u32(), program = r.at + headerLength;
    const step = r.u8();
    r.u8();
    const lineBase = (r.u8() << 24) >> 24, lineRange = r.u8(), opcodeBase = r.u8();
    const operandCounts = [0];
    for (let k = 1; k < opcodeBase; k++) operandCounts.push(r.u8());
    while (r.at < program && r.text());
    const files = [null];
    for (let name; r.at < program && (name = r.text());) {
      r.uleb();
      r.uleb();
      r.uleb();
      files.push(name);
    }
    r.at = program;
    let address = null, line = 1, file = 1;
    const row = () => { if (address) rows.push({ section: address.section, at: address.at, line, file: files[file] ?? null }); };
    const advance = by => { if (address) address = { ...address, at: address.at + by }; };
    while (r.at < end) {
      const op = r.u8();
      if (op >= opcodeBase) {
        const adjusted = op - opcodeBase;
        advance(Math.floor(adjusted / lineRange) * step);
        line += lineBase + (adjusted % lineRange);
        row();
        continue;
      }
      switch (op) {
        case 0: {
          const size = r.uleb(), after = r.at + size, sub = r.u8();
          if (sub === 1) {
            address = null;
            line = 1;
            file = 1;
          } else if (sub === 2) address = place(r.name());
          r.at = after;
          break;
        }
        case 1: row(); break;
        case 2: advance(r.uleb() * step); break;
        case 3: line += r.sleb(); break;
        case 4: file = r.uleb(); break;
        case 8: advance(Math.floor((255 - opcodeBase) / lineRange) * step); break;
        case 9: advance(r.u16()); break;
        default: for (let k = 0; k < (operandCounts[op] ?? 0); k++) r.uleb();
      }
    }
    r.at = end;
  }
  return rows;
}

function readAbbrevs(section, at) {
  const kinds = new Map(), r = reader(section, at);
  for (let code; r.at < section.bytes.length && (code = r.uleb());) {
    const tag = r.uleb(), children = r.u8() === 1, attrs = [];
    for (;;) {
      const name = r.uleb(), form = r.uleb();
      if (!name && !form) break;
      attrs.push([name, form]);
    }
    kinds.set(code, { tag, children, attrs });
  }
  return kinds;
}

// One field's value: a number, a string, a name ({ name, addend }), a reference ({ ref }, from the section's start)
// or a block ({ block, size }, where its bytes start).
function readForm(r, form, unit) {
  const block = size => {
    const start = r.at;
    r.at += size;
    return { block: start, size };
  };
  switch (form) {
    case 0x01: case 0x06: {
      const name = r.name(), value = r.u32();
      return name ?? value;
    }
    case 0x03: return block(r.u16());
    case 0x04: return block(r.u32());
    case 0x05: return r.u16();
    case 0x07: {
      const low = r.u32();
      return low + r.u32() * 2 ** 32;
    }
    case 0x08: return r.text();
    case 0x09: return block(r.uleb());
    case 0x0a: return block(r.u8());
    case 0x0b: case 0x0c: return r.u8();
    case 0x0d: return r.sleb();
    case 0x0e: return r.u32();
    case 0x0f: return r.uleb();
    case 0x10: return { ref: r.u32() };
    case 0x11: return { ref: unit + r.u8() };
    case 0x12: return { ref: unit + r.u16() };
    case 0x13: return { ref: unit + r.u32() };
    case 0x14: {
      const low = r.u32();
      r.u32();
      return { ref: unit + low };
    }
    case 0x15: return { ref: unit + r.uleb() };
    case 0x16: return readForm(r, r.uleb(), unit);
    default: throw new Error(`The stack map doesn't read DWARF form 0x${form.toString(16)}.`);
  }
}

// A location's first operation: { reg }, { fbreg }, { breg, offset }, { addr }, or { expression } for anything else.
function locationOf(section, value) {
  if (!value || value.block === undefined || !value.size) return null;
  const r = reader(section, value.block), op = r.u8();
  if (op >= 0x50 && op <= 0x6f) return { reg: nameOf(op - 0x50) };
  if (op === 0x91) return { fbreg: r.sleb() };
  if (op >= 0x70 && op <= 0x8f) return { breg: nameOf(op - 0x70), offset: r.sleb() };
  if (op === 0x03) {
    const name = r.name(), at = r.u32();
    return { addr: name ? name.name : at };
  }
  return { expression: section.bytes.slice(value.block, value.block + value.size) };
}

// Each function DWARF describes, by name: its parameters, its locals in the frame, its frame base and whether it
// returns a struct through memory.
function readInfo(debug) {
  const functions = new Map();
  const info = debug.get('.debug_info'), abbrevs = debug.get('.debug_abbrev');
  if (!info || !abbrevs) return functions;
  const r = reader(info);
  while (r.at + 11 <= info.bytes.length) {
    const unit = r.at, length = r.u32();
    if (!length) break;
    const end = r.at + length;
    r.u16();
    const abbrevName = r.name();
    let abbrevAt = r.u32();
    if (abbrevName) abbrevAt = (abbrevs.labels.get(abbrevName.name) ?? 0) + abbrevName.addend;
    r.u8();
    const kinds = readAbbrevs(abbrevs, abbrevAt);
    const dies = new Map(), root = { children: [] }, open = [root];
    while (r.at < end) {
      const at = r.at, code = r.uleb();
      if (!code) {
        if (open.length > 1) open.pop();
        continue;
      }
      const kind = kinds.get(code);
      if (!kind) break;
      const die = { at, tag: kind.tag, attrs: new Map(), children: [] };
      for (const [name, form] of kind.attrs) die.attrs.set(name, readForm(r, form, unit));
      open.at(-1).children.push(die);
      dies.set(at, die);
      if (kind.children) open.push(die);
    }
    r.at = end;

    const typeOf = die => {
      const ref = die?.attrs.get(AT.type)?.ref;
      return ref === undefined ? null : dies.get(ref) ?? null;
    };
    const bare = die => {
      while (die && (die.tag === TAG.typedef || die.tag === TAG.constType || die.tag === TAG.volatileType)) die = typeOf(die);
      return die;
    };
    const sizeOf = die => {
      die = bare(die);
      if (!die) return null;
      if (typeof die.attrs.get(AT.byteSize) === 'number') return die.attrs.get(AT.byteSize);
      if (die.tag === TAG.pointer) return 4;
      if (die.tag !== TAG.array) return null;
      let count = 1;
      for (const sub of die.children.filter(c => c.tag === TAG.subrange)) {
        const upper = sub.attrs.get(AT.upperBound), lower = sub.attrs.get(AT.lowerBound) ?? 0;
        if (typeof upper !== 'number') return null;
        count *= upper - lower + 1;
      }
      const each = sizeOf(typeOf(die));
      return each === null ? null : each * count;
    };
    // true for a signed base type, false for an unsigned one or a pointer, null for anything else
    const signedOf = die => {
      die = bare(die);
      if (die?.tag === TAG.pointer) return false;
      if (die?.tag !== TAG.base) return null;
      const encoding = die.attrs.get(AT.encoding);
      return encoding === 5 || encoding === 6 ? true : encoding === 2 || encoding === 7 || encoding === 8 ? false : null;
    };
    const visit = die => {
      const low = die.attrs?.get(AT.lowPc);
      if (die.tag === TAG.subprogram && low?.name && typeof die.attrs.get(AT.name) === 'string') {
        const params = die.children.filter(c => c.tag === TAG.formal).map(p => ({
          name: p.attrs.get(AT.name) ?? null,
          location: locationOf(info, p.attrs.get(AT.location)),
          bytes: sizeOf(typeOf(p)),
          signed: signedOf(typeOf(p)),
        }));
        const frameBase = locationOf(info, die.attrs.get(AT.frameBase));
        const locals = [], registers = [];
        const walk = scope => {
          for (const child of scope.children) {
            if (child.tag === TAG.block) walk(child);
            if (child.tag !== TAG.variable) continue;
            const where = locationOf(info, child.attrs.get(AT.location));
            const fbreg = where?.fbreg ?? (where?.breg && where.breg === frameBase?.reg ? where.offset : undefined);
            if (fbreg !== undefined) locals.push({ name: child.attrs.get(AT.name) ?? null, fbreg, bytes: sizeOf(typeOf(child)) });
            else if (where?.reg) registers.push({ name: child.attrs.get(AT.name) ?? null, reg: where.reg, bytes: sizeOf(typeOf(child)) });
          }
        };
        walk(die);
        // A struct or union that doesn't fit a register as a whole is returned through memory, at an address the
        // caller passes in r0.
        const returned = bare(typeOf(die)), size = returned ? sizeOf(returned) : null;
        const returnsInMemory = !!returned && [TAG.structure, TAG.union, TAG.array].includes(returned.tag) && ![1, 2, 4].includes(size);
        functions.set(die.attrs.get(AT.name), { params, locals, registers, frameBase, returnsInMemory });
      }
      for (const child of die.children) visit(child);
    };
    visit(root);
  }
  return functions;
}

// --- the code

// Each function's instructions, in order, from its label to its .size line, with each one's offset in its section.
function readFunctions(lines, made, where) {
  const functions = [];
  let fn = null;
  for (const { n, labels, rest } of lines) {
    for (const label of labels) {
      const symbol = made.symbols.get(label);
      if (symbol?.function) {
        fn = { name: label, section: symbol.section, start: symbol.at, instrs: [] };
        functions.push(fn);
      }
    }
    if (!fn || !rest) continue;
    if (rest.startsWith('.')) {
      const m = /^\.size\s+([\w.$]+)/i.exec(rest);
      if (m?.[1] === fn.name) fn = null;
      continue;
    }
    const m = /^(\S+)\s*(.*)$/.exec(rest);
    fn.instrs.push({ n, op: m[1].toLowerCase(), args: operands(m[2]), at: where.get(n).at });
  }
  return functions;
}

// --- values

const unknown = why => ({ unknown: why });
const constant = n => ({ const: n >>> 0 });
const symbol = (name, add = 0) => ({ symbol: name, add: add | 0 });
// A parameter as it arrived with `add` added, kept to its low `bits` bits and extended with zeros or its sign, then
// shifted left by `shl`: the compiler narrows a u8 or an s16 that arrives in a register this way.
const param = (name, add = 0, shl = 0, bits = 32, signed = false) => ({ param: name, add: add | 0, shl, bits, signed: bits < 32 && signed });
const isWhole = v => 'param' in v && !v.shl && v.bits === 32;
// An address in the frame, as an offset from the sp at entry. It's given from the frame base only in the map.
const frame = at => ({ sp: at | 0 });
// A register as the caller left it, such as r4 before the function changes it.
const caller = reg => ({ caller: reg });
const isKnown = v => !('unknown' in v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = n => `${n < 0 ? '-' : ''}0x${Math.abs(n).toString(16)}`;

function describe(v) {
  if ('const' in v) return hex(v.const);
  if ('symbol' in v) return `the address of ${v.symbol}${v.add ? ` with ${hex(v.add)} added` : ''}`;
  if ('param' in v) {
    const sum = `the parameter ${v.param}${v.add ? ` with ${hex(v.add)} added` : ''}`;
    const low = v.bits < 32 ? `the low ${v.bits} bits of ${sum}, ${v.signed ? 'sign' : 'zero'} extended` : sum;
    return v.shl ? `${low}, shifted left by ${v.shl}` : low;
  }
  if ('sp' in v) return 'an address in the frame';
  if ('caller' in v) return `the caller's ${v.caller}`;
  return v.unknown;
}

// Two paths' values meet: the value stays only when both agree.
function join(a, b) {
  if (same(a, b)) return a;
  if (!isKnown(a)) return a;
  if (!isKnown(b)) return b;
  return unknown('the paths to here disagree');
}

function offset(v, by) {
  // Adding 0 is how the compiler moves one low register to another.
  if (!(by | 0)) return v;
  if ('const' in v) return constant(v.const + by);
  if ('symbol' in v) return symbol(v.symbol, v.add + by);
  if (isWhole(v)) return param(v.param, v.add + by);
  if ('sp' in v) return frame(v.sp + by);
  return isKnown(v) ? unknown(`${describe(v)} with a number added`) : v;
}

// The low `bits` bits of `v`, extended with zeros or the sign, where the stack map can still say what that is.
function narrow(v, bits, signed) {
  if (!isKnown(v) || bits >= 32) return v;
  if ('const' in v) {
    const low = v.const & (2 ** bits - 1);
    return constant(signed && low >= 2 ** (bits - 1) ? low - 2 ** bits : low);
  }
  if ('param' in v && !v.shl) {
    if (bits <= v.bits) return param(v.param, v.add, 0, bits, signed);
    // Bits above a narrower value are already its extension: zeros stay zeros, and a sign extended again is the same.
    if (!v.signed || signed) return v;
  }
  return unknown(`the low ${bits} bits of ${describe(v)}`);
}

function sum(a, b) {
  if (!isKnown(a)) return a;
  if (!isKnown(b)) return b;
  if ('const' in b) return offset(a, b.const | 0);
  if ('const' in a) return offset(b, a.const | 0);
  return unknown(`${describe(a)} added to ${describe(b)}`);
}

function difference(a, b) {
  if (!isKnown(a)) return a;
  if (!isKnown(b)) return b;
  if ('const' in b) return offset(a, -(b.const | 0));
  if ('symbol' in a && 'symbol' in b && a.symbol === b.symbol) return constant(a.add - b.add);
  if ('sp' in a && 'sp' in b) return constant(a.sp - b.sp);
  if (isWhole(a) && isWhole(b) && a.param === b.param) return constant(a.add - b.add);
  return unknown(`${describe(b)} taken from ${describe(a)}`);
}

function shift(op, v, by, byRegister) {
  if (!isKnown(by)) return by;
  if (!('const' in by)) return unknown(`a shift by ${describe(by)}`);
  let k = byRegister ? by.const & 255 : by.const;
  // In the instruction, a shift right by 0 means by 32.
  if (!byRegister && k === 0 && (op === 'lsr' || op === 'asr')) k = 32;
  if (!isKnown(v)) return v;
  if (k === 0 || (op === 'ror' && k % 32 === 0)) return v;
  if ('const' in v) {
    const x = v.const;
    if (op === 'lsl') return constant(k >= 32 ? 0 : x << k);
    if (op === 'lsr') return constant(k >= 32 ? 0 : x >>> k);
    if (op === 'asr') return constant((x | 0) >> Math.min(k, 31));
    k %= 32;
    return constant((x >>> k) | (x << (32 - k)));
  }
  // A parameter shifted up and back down by the same bits is its low bits, extended with zeros (lsr) or its sign (asr).
  if ('param' in v) {
    if (op === 'lsl' && v.shl + k < 32) return param(v.param, v.add, v.shl + k, v.bits, v.signed);
    if ((op === 'lsr' || op === 'asr') && v.shl === k) return narrow({ ...v, shl: 0 }, 32 - k, op === 'asr');
  }
  return unknown(`${op} of ${describe(v)}`);
}

function logic(op, a, b) {
  if (op === 'adc' || op === 'sbc') return unknown(`${op}, which depends on the carry flag`);
  if (!isKnown(a)) return a;
  if (!isKnown(b)) return b;
  if ('const' in a && 'const' in b) {
    const x = a.const, y = b.const;
    return constant(op === 'and' ? x & y : op === 'orr' ? x | y : op === 'eor' ? x ^ y : op === 'bic' ? x & ~y : Math.imul(x, y));
  }
  // A parameter masked by a run of low bits is its low bits.
  if (op === 'and') {
    for (const [p, mask] of [[a, b], [b, a]]) {
      const bits = 'const' in mask ? Math.log2(mask.const + 1) : NaN;
      if ('param' in p && !p.shl && Number.isInteger(bits) && bits > 0) return narrow(p, bits, false);
    }
  }
  return unknown(`${op} of ${describe(a)} and ${describe(b)}`);
}

// Whether a parameter's low bits are the parameter's own value in C, for one of `info`'s type, or in the low `bytes`
// a store writes. A parameter arrives as a whole word, the value extended to it by its caller.
function isOwnValue(v, info, bytes = 4) {
  if (v.add || v.shl) return false;
  if (v.bits === 32 || v.bits >= 8 * bytes) return true;
  const size = 8 * (info?.bytes ?? 4);
  if (v.bits > size) return info.signed === false || v.signed;
  return v.bits === size && v.signed === info.signed;
}

// A value as the map gives it, with an address in the frame counted from the frame base `base` (from the sp at entry).
// `bytes` is the size of the store it goes to, if it's stored.
function exported(v, base, params, bytes = 4) {
  if ('const' in v) return { const: v.const };
  if ('symbol' in v) return { symbol: v.symbol, add: v.add };
  if ('param' in v) return isOwnValue(v, params.get(v.param), bytes) ? { param: v.param } : unknown(describe(v));
  if ('sp' in v) return base === null ? unknown('an address in the frame, whose base is unknown') : { sp: v.sp - base };
  if ('caller' in v) return { unknown: `the caller's ${v.caller}, as it was on entry`, caller: v.caller };
  return { unknown: v.unknown };
}

const registerList = text => {
  const list = [];
  for (const part of text.replace(/[{}]/g, '').split(',').map(p => p.trim()).filter(Boolean)) {
    const range = part.split('-').map(name => REGISTERS[name.trim().toLowerCase()]);
    for (let n = range[0]; n <= range.at(-1); n++) list.push(n);
  }
  return list;
};

// --- following the values through a function

// What instruction `i` does to `state` ({ r: the sixteen registers, d: for each, the instructions that can have written
// it last, -1 for none since entry, slots: the words of the arguments the caller left on the stack, by their offset
// from the sp at entry }): { state, next }, the instructions that can come after it.
// `record`, when given, hears of each store to the stack and each call.
function transfer(ctx, i, state, record) {
  const { op, args } = ctx.instrs[i];
  const r = state.r.slice();
  let slots = state.slots;
  const next = [];
  const done = () => ({ state: { r, d: state.d.map((list, n) => (r[n] !== state.r[n] ? [i] : list)), slots }, next });
  const fall = () => { if (i + 1 < ctx.instrs.length) next.push(i + 1); };
  const reg = text => REGISTERS[text.trim().replace(/!$/, '').toLowerCase()];
  const read = text => (isImmediate(text) ? constant(immediate(text)) : r[reg(text)] ?? unknown(`"${text}", which isn't a register`));
  const set = (text, value) => {
    const n = reg(text);
    if (n !== undefined) r[n] = value;
    return n;
  };
  const jumpTo = name => {
    const target = ctx.target(name);
    if (target === undefined) ctx.note(`${op} ${name} goes outside the function, so the map doesn't follow it`);
    else next.push(target);
  };
  const indirect = () => {
    const table = ctx.table();
    if (!table.length) ctx.note(`a jump through a register at offset ${ctx.instrs[i].at - ctx.start}, with no table of labels to follow`);
    next.push(...table);
    return done();
  };
  // The base register's value and the address of a place in [ ].
  const placeOf = text => {
    const inside = operands(/^\[(.*)\]$/.exec(text.trim())?.[1] ?? '');
    const base = read(inside[0] ?? '');
    return { base, address: sum(base, inside[1] ? read(inside[1]) : constant(0)) };
  };
  const store = (bytes, address, base, value, from, push = false) => {
    if (record && ('sp' in address || 'sp' in base)) record({ kind: push ? 'push' : 'store', i, bytes, slot: 'sp' in address ? address.sp : null, value, from });
    if (!('sp' in address)) {
      slots = {};
      return;
    }
    // A store into the arguments the caller left changes the words it touches; a whole word is known again.
    slots = Object.fromEntries(Object.entries(slots).filter(([at]) => +at >= address.sp + bytes || +at + 4 <= address.sp));
    if (bytes === 4 && address.sp >= 0) slots[address.sp] = value;
  };
  const load = (address, bytes, signed) => {
    // Only the words of the arguments the caller left are followed: anything else in memory is unknown.
    const v = 'sp' in address ? slots[address.sp] : undefined;
    return v ? narrow(v, 8 * bytes, signed) : unknown('a load from memory');
  };

  switch (op) {
    case 'mov':
      if (set(args[0], read(args[1])) === PC) return indirect();
      break;
    case 'add': case 'sub': {
      const [d, x, y] = args.length === 2 ? [args[0], args[0], args[1]] : args;
      const a = reg(x) === PC ? unknown('an address in the code') : read(x);
      if (set(d, op === 'add' ? sum(a, read(y)) : difference(a, read(y))) === PC) return indirect();
      break;
    }
    case 'neg': case 'mvn': {
      const v = read(args.at(-1));
      set(args[0], 'const' in v ? constant(op === 'neg' ? -v.const : ~v.const) : isKnown(v) ? unknown(`${op} of ${describe(v)}`) : v);
      break;
    }
    case 'lsl': case 'lsr': case 'asr': case 'ror': {
      const [d, from, by] = args.length === 3 ? args : [args[0], args[0], args[1]];
      set(d, shift(op, read(from), read(by), !isImmediate(by)));
      break;
    }
    case 'and': case 'orr': case 'eor': case 'bic': case 'mul': case 'adc': case 'sbc': {
      const [d, x, y] = args.length === 3 ? args : [args[0], args[0], args[1]];
      set(d, logic(op, read(x), read(y)));
      break;
    }
    case 'cmp': case 'cmn': case 'tst':
      break;
    case 'ldr': case 'ldrh': case 'ldrb': case 'ldrsh': case 'ldsh': case 'ldrsb': case 'ldsb': {
      if (!args[1].startsWith('[')) {
        // a word kept beside the function
        const e = expression(args[1]);
        set(args[0], e && typeof e === 'object' && !e.less ? ctx.word(e) : unknown(`a load from ${args[1]}`));
        break;
      }
      const [bytes, signed] = LOADS[op];
      set(args[0], load(placeOf(args[1]).address, bytes, signed));
      break;
    }
    case 'str': case 'strh': case 'strb': {
      const bytes = STORES[op], { base, address } = placeOf(args[1]);
      let value = read(args[0]);
      if ('const' in value && bytes < 4) value = constant(value.const & (2 ** (8 * bytes) - 1));
      store(bytes, address, base, value, reg(args[0]));
      break;
    }
    case 'stmia': case 'ldmia': {
      const b = reg(args[0]), base = r[b], list = registerList(args.slice(1).join(','));
      list.forEach((n, k) => {
        if (op === 'stmia') store(4, offset(base, 4 * k), base, r[n], n);
        else r[n] = unknown('a load from memory');
      });
      if (op === 'stmia' || !list.includes(b)) r[b] = offset(base, 4 * list.length);
      break;
    }
    case 'push': {
      const list = registerList(args.join(',')), top = offset(r[SP], -4 * list.length);
      list.forEach((n, k) => store(4, offset(top, 4 * k), r[SP], r[n], n, true));
      r[SP] = top;
      break;
    }
    case 'pop': {
      const list = registerList(args.join(','));
      for (const n of list) if (n !== PC) r[n] = unknown('a load from memory');
      r[SP] = offset(r[SP], 4 * list.length);
      if (list.includes(PC)) return done();
      break;
    }
    case 'bl': {
      const e = expression(args[0]), name = e && typeof e === 'object' ? e.name : args[0];
      // A bl to a label of this function is a far jump, not a call.
      if (!ctx.isFunction(name) && ctx.target(name) !== undefined) {
        r[LR] = unknown('changed by a far jump');
        jumpTo(name);
        return done();
      }
      const via = /^_call_via_(\w+)$/.exec(name), through = via && REGISTERS[via[1]] !== undefined ? via[1] : null;
      if (record) record({ kind: 'call', i, callee: through ? null : name, through, target: through ? r[REGISTERS[through]] : undefined, r: r.slice(), d: state.d });
      const what = through ? `the function in ${through}` : name;
      r[0] = unknown(`what ${what} returns`);
      for (const n of [1, 2, 3, 12, LR]) r[n] = unknown(`changed by the call to ${what}`);
      slots = {};
      break;
    }
    case 'b':
      jumpTo(args[0]);
      return done();
    case 'bx':
      return done();
    case 'swi':
      for (const n of [0, 1, 2, 3, 12]) r[n] = unknown('changed by the BIOS');
      break;
    default:
      if (CONDITIONAL.test(op)) {
        jumpTo(args[0]);
        break;
      }
      ctx.note(`${op}, which the map doesn't read`);
      if (args[0]) set(args[0], unknown(`${op}, which the map doesn't read`));
  }
  fall();
  return done();
}

function joinStates(a, b) {
  const slots = {};
  for (const [at, v] of Object.entries(a.slots)) if (b.slots[at] && same(v, b.slots[at])) slots[at] = v;
  return { r: a.r.map((v, n) => join(v, b.r[n])), d: a.d.map((list, n) => [...new Set([...list, ...b.d[n]])].sort((x, y) => x - y)), slots };
}

function mapFunction(fn, made, words, info, rowAt) {
  const notes = [];
  const index = new Map(fn.instrs.map((ins, i) => [ins.at, i]));
  const size = made.sizes.get(fn.name), end = size === undefined ? Infinity : fn.start + size;
  const params = new Map((info?.params ?? []).map(p => [p.name, p]));
  const ctx = {
    instrs: fn.instrs,
    start: fn.start,
    note: text => { if (!notes.includes(text)) notes.push(text); },
    isFunction: name => !!made.symbols.get(name)?.function,
    target: name => {
      const symbol = made.symbols.get(name);
      return symbol && symbol.section === fn.section ? index.get(symbol.at) : undefined;
    },
    // The labels of this function a table of words in it names, as a jump through a register may go to any of them.
    table: () => [...new Set(made.relocations.filter(x => x.kind === 'word' && x.section === fn.section && x.at >= fn.start && x.at < end).map(x => ctx.target(x.name)).filter(t => t !== undefined))],
    word: e => {
      const at = made.symbols.get(e.name);
      if (!at) return unknown(`a load from ${e.name}, which isn't in the file`);
      const named = words.get(`${at.section}:${at.at + e.addend}`);
      if (named) return named.name ? symbol(named.name, named.addend) : constant(named.addend);
      const bytes = made.sections[at.section].bytes;
      return at.at + e.addend + 4 <= bytes.length ? constant(bytes.readUInt32LE(at.at + e.addend)) : unknown(`a load from past the end of ${at.section}`);
    },
  };

  // On entry: the parameters in r0 to r3 and then on the stack, a word each, and the registers the function must keep
  // as its caller left them.
  const r = Array.from({ length: 16 }, (_, n) => (n >= 4 && n <= 11 ? caller(nameOf(n)) : unknown(`${nameOf(n)} on entry, which carries no parameter`)));
  r[SP] = frame(0);
  r[LR] = caller('lr');
  r[PC] = unknown('an address in the code');
  r[12] = unknown('ip on entry, which carries nothing from the C');
  if (!info) for (let n = 0; n < 4; n++) r[n] = unknown(`${nameOf(n)} on entry, a parameter the debugging records don't name`);
  const slots = {};
  let word = 0;
  if (info?.returnsInMemory) r[word++] = unknown('the address the returned struct goes to');
  const paramList = (info?.params ?? []).map(p => {
    const count = Math.max(1, Math.ceil((p.bytes ?? 4) / 4)), entry = word < 4 ? nameOf(word) : { stack: (word - 4) * 4 };
    for (let k = 0; k < count; k++, word++) {
      const v = count === 1 ? param(p.name) : unknown(`word ${k + 1} of the parameter ${p.name}`);
      if (word < 4) r[word] = v;
      else slots[(word - 4) * 4] = v;
    }
    return { name: p.name, location: p.location, entry, bytes: p.bytes };
  });

  // Forward through the code until nothing changes, in the order of the code.
  const states = new Array(fn.instrs.length);
  if (fn.instrs.length) states[0] = { r, d: r.map(() => [-1]), slots };
  const waiting = new Set(fn.instrs.length ? [0] : []);
  while (waiting.size) {
    const i = Math.min(...waiting);
    waiting.delete(i);
    const { state, next } = transfer(ctx, i, states[i], null);
    for (const to of next) {
      const merged = states[to] ? joinStates(states[to], state) : state;
      if (!states[to] || !same(merged, states[to])) {
        states[to] = merged;
        waiting.add(to);
      }
    }
  }

  // The prologue: the pushes, the high registers saved through low ones, and what's taken from sp for the frame.
  let last = -1;
  for (let i = 0; i < fn.instrs.length; i++) {
    const { op, args } = fn.instrs[i], regs = args.map(a => REGISTERS[a.trim().toLowerCase()]);
    const after = fn.instrs[i + 1];
    if (op === 'push' || ((op === 'add' || op === 'sub') && regs[0] === SP)) last = i;
    else if (op === 'mov' && regs[0] < 8 && regs[1] >= 8 && regs[1] <= 11) continue;
    else if (op === 'ldr' && !args[1].startsWith('[') && after?.op === 'add' && REGISTERS[after.args[0].toLowerCase()] === SP && after.args.at(-1) === args[0]) continue;
    else break;
  }
  const spAfter = last < 0 ? frame(0) : transfer(ctx, last, states[last], null).state.r[SP];
  let pushed = 0;
  for (let i = 0; i <= last; i++) if (fn.instrs[i].op === 'push') pushed += 4 * registerList(fn.instrs[i].args.join(',')).length;
  const frameBytes = 'sp' in spAfter ? -spAfter.sp - pushed : null;
  let base = 'sp' in spAfter ? spAfter.sp : null;
  if (info?.frameBase?.reg && info.frameBase.reg !== 'sp') {
    const held = last < 0 ? null : transfer(ctx, last, states[last], null).state.r[REGISTERS[info.frameBase.reg]];
    base = held && 'sp' in held ? held.sp : null;
  }

  const pushes = [], stores = [], calls = [];
  const placeOf = i => {
    const row = rowAt(fn.section, fn.instrs[i].at);
    return { offset: fn.instrs[i].at - fn.start, line: row?.line ?? null, file: row?.file ?? null };
  };
  const record = event => {
    if (event.kind === 'push' && event.i <= last) {
      const push = { reg: 'caller' in event.value ? event.value.caller : nameOf(event.from), slot: event.slot };
      if (!('caller' in event.value)) push.value = exported(event.value, base, params);
      pushes.push(push);
    } else if (event.kind === 'call') {
      const at = placeOf(event.i), regs = {}, args = {}, writers = {};
      for (let n = 4; n <= 11; n++) {
        if (same(event.r[n], caller(nameOf(n)))) continue;
        regs[nameOf(n)] = exported(event.r[n], base, params);
        writers[nameOf(n)] = event.d[n].map(k => (k < 0 ? { entry: true } : (({ line, file }) => ({ line, file }))(placeOf(k))));
      }
      for (let n = 0; n < 4; n++) args[nameOf(n)] = exported(event.r[n], base, params);
      const call = { offset: at.offset, returnOffset: at.offset + 4, line: at.line, file: at.file, callee: event.callee };
      if (event.through) Object.assign(call, { through: event.through, target: exported(event.target, base, params) });
      calls.push(Object.assign(call, { regs, writers, args, sp: 'sp' in event.r[SP] && base !== null ? event.r[SP].sp - base : null }));
    } else if (event.kind === 'store' || event.kind === 'push') {
      const at = placeOf(event.i);
      stores.push({ offset: at.offset, line: at.line, file: at.file, bytes: event.bytes, fbreg: event.slot !== null && base !== null ? event.slot - base : null, slot: event.slot, value: exported(event.value, base, params, event.bytes) });
    }
  };
  states.forEach((state, i) => { if (state) transfer(ctx, i, state, record); });

  const start = { bytes: last < 0 ? 0 : fn.instrs[last].at + 2 - fn.start, loads: fn.instrs.slice(0, last + 1).some(ins => ins.op === 'ldr') };
  const map = { pushes, frame: frameBytes, frameBase: base, params: paramList, locals: info?.locals ?? [], registers: info?.registers ?? [], start, calls, stores };
  if (notes.length) map.notes = notes;
  return map;
}
