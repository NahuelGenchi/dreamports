// The tools' own assembler for the PlayStation's processor, the MIPS R3000A, for `match` (#1558): it turns the
// assembly GCC 2.x writes into bytes, as GNU's assembler does for a MIPS I processor with -O1, so no assembler has to
// be built or installed, and it's the same on every computer, as the Game Boy Advance's is (../gba/thumb.mjs). It
// encodes with the same table `read` decodes with (mips.mjs), so what one writes the other reads back.
//
// What GCC leaves to its assembler, and this does as GNU's does:
//   - in `.set reorder`, the default, a nop where the processor needs one: in a branch's or a jump's delay slot, after a
//     load whose register the next instruction reads, and between mfhi or mflo and a multiply, a divide, mthi or mtlo
//     two instructions on. In `.set noreorder` every instruction is as it's written.
//   - the short forms: li, la, move, b, beqz, bnez, neg, negu, not, j and jal through a register, an arithmetic
//     instruction given a number, which becomes its immediate form, or li into $at, and div, divu, rem and remu with
//     three registers, which divide and check for a division by zero and, signed, for the one that overflows.
//   - a load or a store from a name, with or without a register added, through the two halves of its address: the
//     load's own register holds the upper half when it can, and $at does otherwise.
//
// It doesn't move an instruction into a delay slot, which GNU's assembler does only past -O1, and it doesn't know the
// ways Sony's assembler, ASPSX, did things differently: maspsx.mjs turns GCC's assembly into theirs first. It reads
// what maspsx writes too: a small value reached through $gp, %gp_rel(name), the halves of a number, %hi(40000), a trap
// such as tge, and addi, addiu, slti and sltiu given 0x8000 to 0xFFFF, which GNU's assembler takes as the 16 bits
// they're written as. What it gives is each section's bytes, the places a linker fills in, and the names it defines,
// with how many bytes of values follow each name outside the code.

import { COP0, GTE, PRIMARY, REGIMM, REGISTERS, SPECIAL } from './mips.mjs';

const byName = table => Object.fromEntries(Object.entries(table).map(([code, entry]) => [Array.isArray(entry) ? entry[0] : entry, Number(code)]));
const OP = byName(PRIMARY), FUNCT = byName(SPECIAL), RT = byName(REGIMM), COMMAND = byName(GTE), COP0_REGISTER = byName(COP0);
const LOADS = new Set(['lb', 'lbu', 'lh', 'lhu', 'lw', 'lwl', 'lwr']), STORES = new Set(['sb', 'sh', 'sw', 'swl', 'swr']);
const IMMEDIATE_OF = { add: 'addi', addu: 'addiu', slt: 'slti', sltu: 'sltiu', and: 'andi', or: 'ori', xor: 'xori' };
const UNSIGNED_IMMEDIATE = new Set(['andi', 'ori', 'xori']);
// signed immediates GNU's assembler also takes as 0x8000 to 0xFFFF, written as their 16 bits, as these instructions
// have no other form to give a larger number to
const SIGNED_AS_WRITTEN = new Set(['addi', 'addiu', 'slti', 'sltiu']);
// the traps, a register compared with another and a code of ten bits
const TRAPS = { tge: 0x30, tgeu: 0x31, tlt: 0x32, tltu: 0x33, teq: 0x34, tne: 0x36 };
const AT = 1;

/** A register by its number or its name, as $4, $a0, $sp or $31, or null. */
export function registerOf(text) {
  const found = /^\$(\w+)$/.exec(text.trim());
  if (!found) return null;
  if (/^\d+$/.test(found[1]) && Number(found[1]) < 32) return Number(found[1]);
  const named = { s8: 30, ...Object.fromEntries(REGISTERS.map((name, n) => [name, n])) }[found[1]];
  return named ?? null;
}

const number = text => {
  const t = text.trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  return t.startsWith('-') ? -Number(t.slice(1)) : Number(t);
};

// a value: a number, a name with or without a number added, the upper or lower half of either, %hi(name) or %lo(name),
// or a name's distance from where $gp points, %gp_rel(name). A number's halves are the numbers a linker would make:
// the upper one carried when the lower is negative, and the lower one signed.
function valueOf(text) {
  const t = text.trim();
  const half = /^%(hi|lo|gp_rel)\((.*)\)$/.exec(t);
  if (half) {
    const inner = valueOf(half[2]);
    if (inner.number === undefined) return { ...inner, half: half[1] };
    if (half[1] === 'gp_rel') throw new Error(`%gp_rel takes a name, and ${half[2]} is a number.`);
    return { number: half[1] === 'hi' ? ((inner.number + 0x8000) >>> 16) & 0xFFFF : ((inner.number & 0xFFFF) ^ 0x8000) - 0x8000, sixteen: true };
  }
  const n = number(t);
  if (n !== null) return { number: n };
  const named = /^([A-Za-z_.$][\w.$]*)\s*(?:([+-])\s*(0x[0-9a-f]+|\d+))?$/i.exec(t);
  if (named) return { symbol: named[1], addend: named[2] ? (named[2] === '-' ? -1 : 1) * Number(named[3]) : 0 };
  // a sum GCC or a table writes with brackets, as (x >> 16) & 0xFFFF
  if (/^[\d\sx()+\-*<>&|~a-f]+$/i.test(t)) return { number: Function(`"use strict"; return (${t});`)() };
  throw new Error(`"${t}" isn't a number or a name the assembler knows.`);
}

// an operand that's a place in memory: offset(register), where the offset is a value
function placeOf(text) {
  const found = /^(.*)\((\$\w+)\)$/.exec(text.trim());
  if (found) return { ...(found[1].trim() ? valueOf(found[1]) : { number: 0 }), base: registerOf(found[2]) };
  return { ...valueOf(text), base: null };
}

// the operands of an instruction, split at the commas outside brackets
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

const fits16 = n => n >= -0x8000 && n < 0x8000, fitsU16 = n => n >= 0 && n < 0x10000;
const rType = (rs, rt, rd, sa, funct) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | funct) >>> 0;
const iType = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;

/**
 * Assembles `text`, assembly as GCC writes it: { sections, symbols, functions }. `sections` is a Map of each
 * section's name to { bytes, relocations }, each relocation { at, kind, symbol, addend }, `kind` being 'hi16', 'lo16',
 * 'gprel16', 'jump26' or 'word32', for the linker to fill; `symbols` a Map of each name defined to { section, at,
 * global }, and outside the code `size`, how many bytes of values follow the name before the next, without the zeros
 * that only line the next one up;
 * `functions` each .ent and .end pair, { name, section, at, size }.
 */
export function assemble(text) {
  const sections = new Map(), symbols = new Map(), globals = new Set(), functions = [], opened = new Map();
  // the last name outside the code in each section, which the values written next belong to
  const lastName = new Map();
  const values = (...bytes) => {
    current().bytes.push(...bytes);
    const name = lastName.get(section);
    if (name) name.end = here();
  };
  let section = '.text', reorder = true;
  // what the last instructions in reorder mode were, for the nops the processor needs: the register a load gave,
  // and how many instructions ago hi or lo was read
  let loaded = null, hiloRead = Infinity;
  const fixups = [];
  const current = () => {
    if (!sections.has(section)) sections.set(section, { bytes: [], relocations: [] });
    return sections.get(section);
  };
  const here = () => current().bytes.length;
  const emitWord = word => { const b = current().bytes; b.push(word & 0xFF, (word >>> 8) & 0xFF, (word >>> 16) & 0xFF, (word >>> 24) & 0xFF); };
  const relocate = (kind, value) => current().relocations.push({ at: here(), kind, symbol: value.symbol, addend: value.addend ?? 0 });

  // the registers an instruction word reads and the one it writes, for the nops between a load and its use
  const reads = word => {
    const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31;
    if (op === 0) return [rs, rt];
    if (op === 1 || op === 6 || op === 7) return [rs];
    if (op === 4 || op === 5) return [rs, rt];
    if (op === 2 || op === 3 || op === 15) return [];
    if (op === 16 || op === 18) return ((word >>> 21) & 31) === 4 || ((word >>> 21) & 31) === 6 ? [rt] : [];
    if (op >= 40 && op <= 46) return [rs, rt];
    if (op === 34 || op === 38) return [rs, rt];
    return [rs];
  };
  const writesHiLo = word => (word >>> 26) === 0 && [17, 19, 24, 25, 26, 27].includes(word & 63);
  const readsHiLo = word => (word >>> 26) === 0 && [16, 18].includes(word & 63);
  const loadsInto = word => {
    const op = word >>> 26;
    if ([32, 33, 34, 35, 36, 37, 38].includes(op)) return (word >>> 16) & 31;
    if ((op === 16 || op === 18) && [0, 2].includes((word >>> 21) & 31)) return (word >>> 16) & 31;
    return null;
  };
  const isBranch = word => {
    const op = word >>> 26;
    return (op >= 1 && op <= 7) || (op === 0 && ((word & 63) === 8 || (word & 63) === 9));
  };

  // one instruction, as its word, with the nops reorder mode wants before and after it: where the word went
  const instruction = (word, relocation = null) => {
    if (reorder) {
      const lwlPair = loaded !== null && (word >>> 26 === 34 || word >>> 26 === 38) && ((word >>> 16) & 31) === loaded;
      if (loaded !== null && loaded !== 0 && !lwlPair && reads(word).includes(loaded)) emitWord(0);
      if (writesHiLo(word)) for (let gap = hiloRead; gap < 2; gap++) emitWord(0);
    }
    if (relocation) relocate(relocation.kind, relocation.value);
    const at = here();
    emitWord(word);
    hiloRead = readsHiLo(word) ? 0 : hiloRead + 1;
    loaded = loadsInto(word);
    if (reorder && isBranch(word)) {
      emitWord(0);
      loaded = null;
      hiloRead = Infinity;
    }
    return at;
  };

  // a branch to a label, filled in once every label of its section is known
  const branchTo = (op, rs, rt, target, regimm = null) => {
    const value = valueOf(target);
    if (value.symbol === undefined) throw new Error('a branch goes to a label, and this is a number.');
    fixups.push({ section, at: instruction(regimm === null ? iType(op, rs, rt, 0) : iType(1, rs, regimm, 0)), value });
  };

  // a load or store of a register from a place, through the halves of a name's address when the place is one
  const memory = (name, rt, place) => {
    const op = OP[name];
    if (place.symbol === undefined) {
      if (!fits16(place.number)) {
        instruction(iType(OP.lui, 0, AT, (place.number + 0x8000) >>> 16));
        if (place.base) instruction(rType(AT, place.base, AT, 0, FUNCT.addu));
        return instruction(iType(op, AT, rt, place.number & 0xFFFF));
      }
      return instruction(iType(op, place.base ?? 0, rt, place.number));
    }
    if (place.half === 'lo') return instruction(iType(op, place.base ?? 0, rt, 0), { kind: 'lo16', value: place });
    if (place.half === 'gp_rel') return instruction(iType(op, place.base ?? 28, rt, 0), { kind: 'gprel16', value: place });
    // the load's own register holds the upper half, unless it's the register added or $zero, and a store's is $at
    const temp = LOADS.has(name) && rt !== 0 && rt !== place.base ? rt : AT;
    instruction(iType(OP.lui, 0, temp, 0), { kind: 'hi16', value: place });
    if (place.base) instruction(rType(temp, place.base, temp, 0, FUNCT.addu));
    instruction(iType(op, temp, rt, 0), { kind: 'lo16', value: place });
  };

  const loadImmediate = (rt, n) => {
    n |= 0;
    if (fits16(n)) return instruction(iType(OP.addiu, 0, rt, n));
    if (fitsU16(n >>> 0)) return instruction(iType(OP.ori, 0, rt, n));
    instruction(iType(OP.lui, 0, rt, n >>> 16));
    if (n & 0xFFFF) instruction(iType(OP.ori, rt, rt, n & 0xFFFF));
  };

  // div, divu, rem and remu with a register to give the result to: the division, checked for zero, and for the one
  // signed division that overflows, as GNU's assembler writes it for a MIPS I processor
  const divide = (name, rd, rs, rt) => {
    const unsigned = name.endsWith('u'), funct = unsigned ? FUNCT.divu : FUNCT.div;
    if (reorder && loaded !== null && (loaded === rs || loaded === rt)) emitWord(0);
    const saved = reorder;
    reorder = false;
    instruction(iType(OP.bne, rt, 0, 2));
    instruction(rType(rs, rt, 0, 0, funct));
    instruction(rType(0, 0, 0, 0, FUNCT.break) | (7 << 16));
    if (!unsigned) {
      instruction(iType(OP.addiu, 0, AT, -1));
      instruction(iType(OP.bne, rt, AT, 4));
      instruction(iType(OP.lui, 0, AT, 0x8000));
      instruction(iType(OP.bne, rs, AT, 2));
      instruction(0);
      instruction(rType(0, 0, 0, 0, FUNCT.break) | (6 << 16));
    }
    reorder = saved;
    loaded = null;
    hiloRead = Infinity;
    instruction(rType(0, 0, rd, 0, name.startsWith('rem') ? FUNCT.mfhi : FUNCT.mflo));
  };

  const lines = text.split('\n');
  lines.forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    try {
      let rest = line;
      for (let label; (label = /^([A-Za-z_.$][\w.$]*):\s*/.exec(rest));) {
        if (symbols.has(label[1])) throw new Error(`${label[1]} is defined twice.`);
        const symbol = { section, at: here() };
        symbols.set(label[1], symbol);
        if (section !== '.text') lastName.set(section, symbol);
        rest = rest.slice(label[0].length);
        loaded = null;
        hiloRead = Infinity;
      }
      if (!rest) return;
      const [, name, args = ''] = /^(\S+)\s*(.*)$/.exec(rest);
      if (name.startsWith('.')) return directive(name, args.trim());
      operation(name, operandsOf(args));
    } catch (error) {
      throw new Error(`Line ${index + 1}, "${raw.trim()}": ${error.message}`);
    }
  });

  function directive(name, args) {
    if (['.text', '.data', '.rdata', '.sdata', '.sbss', '.bss'].includes(name)) section = name;
    else if (name === '.section') section = args.split(',')[0].trim();
    else if (name === '.set') {
      if (args === 'reorder') reorder = true;
      else if (args === 'noreorder') reorder = false;
    } else if (name === '.align') {
      const to = 2 ** Number(args.split(',')[0]);
      while (here() % to) current().bytes.push(0);
    } else if (name === '.globl' || name === '.global') globals.add(args.trim());
    else if (name === '.ent') opened.set(args.split(',')[0].trim(), { section, at: here() });
    else if (name === '.end') {
      const fn = args.trim(), start = opened.get(fn);
      if (start) functions.push({ name: fn, section: start.section, at: start.at, size: here() - start.at });
    } else if (name === '.word' || name === '.half' || name === '.hword' || name === '.short' || name === '.byte') {
      const bytes = name === '.word' ? 4 : name === '.byte' ? 1 : 2;
      for (const each of operandsOf(args)) {
        const value = valueOf(each);
        if (value.symbol !== undefined) {
          if (bytes !== 4) throw new Error(`a name in a ${name} isn't something the assembler fills in yet.`);
          relocate('word32', value);
        }
        const n = value.number ?? 0;
        values(...Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xFF));
      }
    } else if (name === '.ascii' || name === '.asciiz') {
      for (const [, quoted] of args.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const unescaped = quoted.replace(/\\([0-7]{1,3}|.)/g, (_, c) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' }[c] ?? c));
        values(...Buffer.from(unescaped, 'latin1'), ...(name === '.asciiz' ? [0] : []));
      }
    } else if (name === '.space' || name === '.skip') values(...new Array(Math.max(0, Number(args.split(',')[0]))).fill(0));
    else if (name === '.comm' || name === '.lcomm') {
      const [symbol, size] = operandsOf(args);
      const saved = section;
      section = '.bss';
      while (here() % 4 && Number(size) >= 4) current().bytes.push(0);
      const defined = { section, at: here() };
      symbols.set(symbol, defined);
      lastName.set(section, defined);
      if (name === '.comm') globals.add(symbol);
      values(...new Array(Math.max(0, Number(size))).fill(0));
      section = saved;
    }
    // .file, .frame, .mask, .fmask, .loc and the rest say nothing of the bytes
  }

  function operation(name, ops) {
    const reg = n => {
      const r = registerOf(ops[n] ?? '');
      if (r === null) throw new Error(`operand ${n + 1} isn't a register.`);
      return r;
    };
    if (name === 'nop') return instruction(0);
    if (name === 'li') return loadImmediate(reg(0), valueOf(ops[1]).number);
    if (name === 'la') {
      const place = placeOf(ops[1]);
      const rt = reg(0);
      if (place.half === 'gp_rel') return instruction(iType(OP.addiu, place.base ?? 28, rt, 0), { kind: 'gprel16', value: place });
      instruction(iType(OP.lui, 0, rt, 0), { kind: 'hi16', value: place });
      instruction(iType(OP.addiu, rt, rt, 0), { kind: 'lo16', value: place });
      if (place.base) instruction(rType(rt, place.base, rt, 0, FUNCT.addu));
      return undefined;
    }
    if (name === 'move') return instruction(rType(reg(1), 0, reg(0), 0, FUNCT.addu));
    if (name === 'neg' || name === 'negu') return instruction(rType(0, reg(1), reg(0), 0, name === 'neg' ? FUNCT.sub : FUNCT.subu));
    if (name === 'not') return instruction(rType(reg(1), 0, reg(0), 0, FUNCT.nor));
    if (name === 'b') return branchTo(OP.beq, 0, 0, ops[0]);
    if (name === 'bal') return branchTo(1, 0, 0, ops[0], RT.bgezal);
    if (name === 'beqz' || name === 'bnez') return branchTo(name === 'beqz' ? OP.beq : OP.bne, reg(0), 0, ops[1]);
    if (name === 'beq' || name === 'bne') return branchTo(OP[name], reg(0), reg(1), ops[2]);
    if (name === 'blez' || name === 'bgtz') return branchTo(OP[name], reg(0), 0, ops[1]);
    if (RT[name] !== undefined) return branchTo(1, reg(0), 0, ops[1], RT[name]);
    if (name === 'j' || name === 'jal') {
      if (registerOf(ops[0]) !== null) {
        if (name === 'j') return instruction(rType(reg(0), 0, 0, 0, FUNCT.jr));
        const [rd, rs] = ops.length === 2 ? [reg(0), reg(1)] : [31, reg(0)];
        return instruction(rType(rs, 0, rd, 0, FUNCT.jalr));
      }
      const value = valueOf(ops[0]);
      if (value.number !== undefined) return instruction(((OP[name] << 26) | ((value.number >>> 2) & 0x3FFFFFF)) >>> 0);
      return instruction((OP[name] << 26) >>> 0, { kind: 'jump26', value });
    }
    if (name === 'jr') return instruction(rType(reg(0), 0, 0, 0, FUNCT.jr));
    if (name === 'jalr') return ops.length === 2 ? instruction(rType(reg(1), 0, reg(0), 0, FUNCT.jalr)) : instruction(rType(reg(0), 0, 31, 0, FUNCT.jalr));
    if ((name === 'div' || name === 'divu') && ops.length === 2) return instruction(rType(reg(0), reg(1), 0, 0, FUNCT[name]));
    if (['div', 'divu', 'rem', 'remu'].includes(name)) {
      if (reg(0) === 0) return instruction(rType(reg(1), reg(2), 0, 0, FUNCT[name.replace('rem', 'div')]));
      return divide(name, reg(0), reg(1), reg(2));
    }
    if (LOADS.has(name) || STORES.has(name)) return memory(name, reg(0), placeOf(ops[1]));
    if (name === 'lwc2' || name === 'swc2') {
      const place = placeOf(ops[1]), rt = Number(ops[0].replace('$', ''));
      return instruction(iType(OP[name], place.base ?? 0, rt, place.number ?? 0));
    }
    if (['sll', 'srl', 'sra'].includes(name)) return instruction(rType(0, reg(1), reg(0), valueOf(ops[2]).number & 31, FUNCT[name]));
    if (['sllv', 'srlv', 'srav'].includes(name)) return instruction(rType(reg(2), reg(1), reg(0), 0, FUNCT[name]));
    if (['mfhi', 'mflo'].includes(name)) return instruction(rType(0, 0, reg(0), 0, FUNCT[name]));
    if (['mthi', 'mtlo'].includes(name)) return instruction(rType(reg(0), 0, 0, 0, FUNCT[name]));
    if (['mult', 'multu'].includes(name)) return instruction(rType(reg(0), reg(1), 0, 0, FUNCT[name]));
    // a break's code is in two fields, the first of ten bits, and a syscall's in one
    if (name === 'break') return instruction((rType(0, 0, 0, 0, FUNCT.break) | ((ops[0] ? valueOf(ops[0]).number : 0) << 16) | ((ops[1] ? valueOf(ops[1]).number : 0) << 6)) >>> 0);
    if (name === 'syscall') return instruction((rType(0, 0, 0, 0, FUNCT.syscall) | ((ops[0] ? valueOf(ops[0]).number : 0) << 6)) >>> 0);
    if (name === 'lui') {
      const value = valueOf(ops[1]);
      if (value.symbol !== undefined) return instruction(iType(OP.lui, 0, reg(0), 0), { kind: 'hi16', value });
      return instruction(iType(OP.lui, 0, reg(0), value.number));
    }
    if (['mfc0', 'mtc0', 'mfc2', 'mtc2', 'cfc2', 'ctc2'].includes(name)) {
      const rs = { mfc0: 0, mtc0: 4, mfc2: 0, cfc2: 2, mtc2: 4, ctc2: 6 }[name], op = name.endsWith('0') ? 16 : 18;
      const rd = op === 16 && COP0_REGISTER[ops[1]] !== undefined ? COP0_REGISTER[ops[1]] : Number(ops[1].replace('$', ''));
      return instruction(((op << 26) | (rs << 21) | (reg(0) << 16) | (rd << 11)) >>> 0);
    }
    if (name === 'rfe') return instruction(0x42000010);
    if (TRAPS[name] !== undefined) return instruction((rType(reg(0), reg(1), 0, 0, TRAPS[name]) | ((ops[2] ? valueOf(ops[2]).number & 0x3FF : 0) << 6)) >>> 0);
    // a command of the geometry processor: its whole number, as read.mjs writes it first and games give it, or else
    // its fields alone, as sf=1 lm=0
    if (COMMAND[name] !== undefined || name === 'cop2') {
      const words = ops.join(' ').split(/\s+/), whole = words.map(number).find(n => n !== null);
      if (whole !== undefined) return instruction((0x4A000000 | (whole & 0x1FFFFFF)) >>> 0);
      const fields = Object.fromEntries([...(ops.join(' ')).matchAll(/(sf|lm|mx|v|cv)=(\d)/g)].map(([, key, value]) => [key, Number(value)]));
      const command = COMMAND[name] | (fields.sf ?? 0) << 19 | (fields.lm ?? 0) << 10 | (fields.mx ?? 0) << 17 | (fields.v ?? 0) << 15 | (fields.cv ?? 0) << 13;
      return instruction((0x4A000000 | command) >>> 0);
    }
    // an arithmetic instruction: three registers, or two and a number, which becomes its immediate form
    const immediateName = OP[name] !== undefined ? name : IMMEDIATE_OF[name] ?? (name === 'sub' || name === 'subu' ? 'addiu' : null);
    const third = ops[2] !== undefined ? registerOf(ops[2]) : null;
    if (FUNCT[name] !== undefined && third !== null) return instruction(rType(reg(1), third, reg(0), 0, FUNCT[name]));
    if (immediateName && ops.length >= 2) {
      const [rt, rs] = ops.length === 2 ? [reg(0), reg(0)] : [reg(0), reg(1)];
      const value = valueOf(ops[ops.length - 1]);
      if (value.symbol !== undefined) return instruction(iType(OP[immediateName], rs, rt, 0), { kind: { hi: 'hi16', gp_rel: 'gprel16' }[value.half] ?? 'lo16', value });
      const n = (name === 'sub' || name === 'subu') ? -value.number : value.number;
      // a half of a number is its sixteen bits, whatever the instruction makes of them
      if (value.sixteen || (UNSIGNED_IMMEDIATE.has(immediateName) ? fitsU16(n) : fits16(n))) return instruction(iType(OP[immediateName], rs, rt, n));
      if (name === immediateName && SIGNED_AS_WRITTEN.has(name) && fitsU16(n)) return instruction(iType(OP[immediateName], rs, rt, n));
      // a number too large for the instruction goes through $at
      loadImmediate(AT, value.number);
      return instruction(rType(rs, AT, rt, 0, FUNCT[name === 'sub' ? 'sub' : name === 'subu' ? 'subu' : name]));
    }
    throw new Error(`"${name}" isn't an instruction the assembler knows.`);
  }

  // branches to names, filled in now that every name in their section is known
  for (const { section: where, at, value } of fixups) {
    const target = symbols.get(value.symbol);
    if (!target || target.section !== where) throw new Error(`A branch goes to ${value.symbol}, which this file doesn't define in ${where}.`);
    const bytes = sections.get(where).bytes, offset = ((target.at + value.addend - at - 4) >> 2) & 0xFFFF;
    bytes[at] = offset & 0xFF;
    bytes[at + 1] = offset >> 8;
  }
  for (const [name, symbol] of symbols) {
    symbol.global = globals.has(name);
    if (symbol.section !== '.text') symbol.size = (symbol.end ?? symbol.at) - symbol.at;
    delete symbol.end;
  }
  return { sections: new Map([...sections].map(([name, { bytes, relocations }]) => [name, { bytes: Uint8Array.from(bytes), relocations }])), symbols, functions };
}
