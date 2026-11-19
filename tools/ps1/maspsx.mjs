// maspsx's rules in JavaScript, for `match` on the PlayStation (#1558): what turns GCC's assembly into what Sony's
// assembler, ASPSX, made of it, so that GNU's assembler, or the tools' own (assemble.mjs), writes the same words a game
// was built with. ASPSX fills delay slots and expands macros its own way, which differs a little from one version to the
// next, and maspsx knows each way.
//
// The rules are maspsx's own, by Mark Street, MIT License (maspsx-LICENSE.txt beside this file):
// https://github.com/mkst/maspsx at commit 4ffa8b5106f9780d5d4aa7609f184949433ddbbc, `maspsx/__init__.py` and
// `maspsx.py`, carried into JavaScript line by line, so that contributors need no Python. Every case of maspsx's own
// tests gives the same lines here as there (tools/test/ps1-maspsx.test.mjs keeps made-up cases of each rule); its
// DEBUG comments are kept word for word, so the two can be compared whole.
//
// What isn't carried: running the assembler (`--run-assembler`, `--gnu-as-path`) and its command line, which `maspsx()`
// takes as settings instead. Like GCC's output, the assembly read here is ASCII: whitespace and digits are ASCII ones.

const BRANCHES = new Set(['beq', 'bgez', 'bgtz', 'blez', 'bltz', 'bne']);
const JUMPS = new Set(['j', 'jal']);
const ALIGNED_LOADS = new Set(['lb', 'lbu', 'lh', 'lhu', 'lw']);
const LOADS = new Set([...ALIGNED_LOADS, 'lwl', 'lwr']);
const STORES = new Set(['sb', 'sh', 'sw', 'swl', 'swr', 'swc2']);
const SINGLE_REG_LOADS = new Set(['mult', 'multu', 'div', 'divu', 'rem', 'remu', 'move', 'negu', 'nor']);
const DOUBLE_REG_LOADS = new Set(['and', 'andi', 'or', 'ori', 'xor', 'xori', 'addu', 'subu', 'sll', 'slr', 'srl', 'sra', 'slt', 'slti', 'sltu']);
const MULTIPLIES = ['mult\t', 'multu\t', 'div\t', 'divu\t', 'rem\t', 'remu\t'];
const SETS = new Set(['.set\treorder', '.set\tnoreorder', '.set\tvolatile', '.set\tnovolatile']);
const NEXT_REGISTER = {
  $f0: '$f1', $f2: '$f3', $f4: '$f5', $f6: '$f7', $f8: '$f9', $f10: '$f11', $f12: '$f13', $f14: '$f15',
  $v0: '$v1', $a0: '$a1', $a2: '$a3', $t0: '$t1', $t2: '$t3', $s0: '$s1', $s2: '$s3', $s4: '$s5', $s6: '$s7',
  $2: '$3', $4: '$5', $6: '$7', $8: '$9', $10: '$11', $12: '$13', $14: '$15', $16: '$17', $18: '$19', $20: '$21', $22: '$23',
};

// Python's ways with text, where JavaScript's differ: str.split() with no separator, unpacking a list of the wrong
// length (an error there), int() of base 10 and of base 0 (which reads 0x, 0o and 0b, and refuses 010), float(), and
// int.bit_length().
const words = text => (text.trim() === '' ? [] : text.trim().split(/\s+/));
const fail = text => { throw new Error(text); };
const exactly = (list, count, line) => (list.length === count ? list : fail(`Unable to unpack ${count} from: ${line}`));
const first = (list, line) => (list.length ? list[0] : fail(`Nothing to read in: ${line}`));
const count = (text, part) => text.split(part).length - 1;
const bitLength = n => (n === 0 ? 0 : Math.abs(n).toString(2).length);
const hex = n => n.toString(16).toUpperCase();

function int10(text) {
  const t = text.trim();
  if (!/^[+-]?\d(_?\d)*$/.test(t)) fail(`invalid literal for int() with base 10: '${text}'`);
  return Number(t.replaceAll('_', ''));
}

/** Python's int(text, 0), as a BigInt. */
function int0(text) {
  const t = text.trim();
  const m = /^([+-]?)(0[xX](?:_?[0-9a-fA-F])+|0[oO](?:_?[0-7])+|0[bB](?:_?[01])+|0(?:_?0)*|[1-9](?:_?\d)*)$/.exec(t);
  if (!m) fail(`invalid literal for int() with base 0: '${text}'`);
  const digits = m[2].replaceAll('_', '');
  const value = /^0[oO]/.test(digits) ? BigInt(`0o${digits.slice(2)}`) : BigInt(digits);
  return m[1] === '-' ? -value : value;
}

function pyFloat(text) {
  const t = text.trim();
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (special) return special[2].toLowerCase() === 'nan' ? NaN : (special[1] === '-' ? -Infinity : Infinity);
  if (!/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(t)) fail(`could not convert string to float: '${text}'`);
  return Number(t.replaceAll('_', ''));
}

const isNumber = value => /^-?\d+$/.test(value) || /^-?0x[A-Fa-f0-9]+$/.test(value);

/** Where a `.lcomm` symbol goes: its alignment and the room it takes, by how the ASPSX version lays them out. */
export function lcommLayout(kind, size) {
  if (kind === 'word') return [4, Math.floor((size + 3) / 4) * 4];
  if (kind === 'power_of_two' && size > 1) return [Math.min(2 ** bitLength(size - 1), 16), size];
  if (kind === 'none' || kind === 'power_of_two') return [1, size];
  return fail(`Unknown .lcomm alignment: ${kind}`);
}

export function stripComments(line) {
  return line.split('#')[0].trim();
}

/** Whether `line` reads register `source` (and with `loadsToRegister`, whether an aligned load writes it). */
export function lineLoadsFromReg(line, source, loadsToRegister = false) {
  const m = /^([A-z][A-z0-9]*)\s+([^\n]*)$/.exec(stripComments(line));
  if (!m) return false;
  const [, op, rest] = m;
  const r = source.replaceAll('$', '\\$');
  const is = pattern => new RegExp(pattern).test(rest);
  const inParentheses = `^[^\\n]*\\(\\s*${r}\\s*\\)$`;
  const firstOf = `^${r},[^\\n]*$`;
  if (LOADS.has(op)) return is(inParentheses) || (loadsToRegister && ALIGNED_LOADS.has(op) && is(firstOf));
  if (STORES.has(op)) return is(inParentheses) || is(firstOf);
  if (op === 'lwc2') return is(inParentheses);
  if (op === 'jal') return is(`^[^\\n]*,\\s*${r}$`);
  if (op === 'j' || op === 'mtlo' || op === 'mthi') return is(`^${r}$`);
  if (op === 'ctc2' || op === 'mtc0' || op === 'mtc2') return is(firstOf);
  if (BRANCHES.has(op)) return is(firstOf) || is(`^[^\\n]*,\\s*${r},[^\\n]*$`);
  if (SINGLE_REG_LOADS.has(op)) {
    if (is(`^[^\\n]*,\\s*${r}$`)) return true;
    if (op.startsWith('mult') && is(firstOf)) return true;
    return (op.startsWith('div') || op.startsWith('rem')) && is(`^[^\\n]*,${r},[^\\n]*$`);
  }
  if (DOUBLE_REG_LOADS.has(op)) return is(`^[^\\n]*,\\s*${r},[^\\n]*$`) || is(`^[^\\n]*,[^\\n]*,\\s*${r}$`);
  return false;
}

/** Whether a load or store needs $at to reach what it names: a symbol, or an offset past 16 bits. */
export function usesAt(line) {
  line = stripComments(line);
  if (/^s(?:[wbh]|w[lr])\s+(\$[a-z0-9]+),\s*%lo\(([^(]+)\)\(([^)]+)\)/.test(line)) return false;
  let m, operand;
  if ((m = /^s(?:[wbh]|w[lr])\s+(\$[a-z0-9]+),\s*(-?[A-z0-9_.+]+)$/.exec(line))) {
    operand = m[2];
    if (!isNumber(operand)) return true;
  } else if ((m = /^s(?:[wbh]|w[lr])\s+(\$[a-z0-9]+),\s*([^(]+)\(([^)]+)\)/.exec(line))) operand = m[2];
  else if ((m = /^l[a-z]+\s+(\$[a-z0-9]+),\s*([^(]+)\(([^)]+)\)/.exec(line))) operand = m[2];
  else return false;
  if (isNumber(operand)) {
    const n = int0(operand);
    if (n > -32769n && n < 32768n) return false;
  }
  return true;
}

function parseLoadOrStore(rest) {
  let m, source, destination, operand, needsExpanding;
  if ((m = /^(\$[a-z0-9]+),\s*%lo\(([^(]+)\)\(([^(]+)\)/.exec(rest))) {
    [, destination, operand, source] = m;
    needsExpanding = false;
  } else if ((m = /^(\$[a-z0-9]+),\s*([^(]+)\(([^)]+)\)/.exec(rest))) {
    [, destination, operand, source] = m;
    needsExpanding = true;
  } else if ((m = /^(\$[a-z0-9]+),\s*([^(]+)/.exec(rest))) {
    [, destination, operand] = m;
    source = null;
    needsExpanding = true;
  } else fail(`Unable to parse load/store instruction: ${rest}`);
  return { source, destination, operand, isAddend: !isNumber(operand), needsExpanding };
}

function divNeedsExpanding(line) {
  const [inst, ...rest] = words(line);
  if (inst === undefined) fail(`Nothing to read in: ${line}`);
  if (!(inst.startsWith('div') || inst.startsWith('rem'))) return false;
  const [destination] = first(rest, line).split(',');
  return destination !== '$zero' && destination !== '$0';
}

/** `li`, as ASPSX writes it: one instruction or lui and ori, with addiu for small values from version 2.50. */
export function expandLoadImmediate(line, smallUsesAddiu = false) {
  const m = /^li\s+(\$[0-9A-z]+),\s?(-?[x0-9a-fA-F]+)/.exec(line);
  if (!m) fail('li regex failed');
  const destination = m[1];
  const value = int0(m[2]);
  const high = () => [`lui\t${destination},(${value} >> 16) & 0xFFFF`, ...(value & 0xFFFFn ? [`ori\t${destination},${destination},${value} & 0xFFFF`] : [])];
  if (value >= 0n && value <= 0x7FFFn) return [`${smallUsesAddiu ? 'addiu' : 'ori'}\t${destination},$zero,${value}`];
  if (value > 0n && value < 0x10000n) return [`ori\t${destination},$zero,${value}`];
  if (value >= 0x10000n) return high();
  if (value < 0n && value > -0x8000n) return [`addiu\t${destination},$zero,${value}`];
  if (value === -0x8000n) return [`addiu\t${destination},$zero,${value} & 0xFFFF`];
  return high();
}

function expandMove(line) {
  line = stripComments(line);
  const [op, ...rest] = words(line);
  if (op === undefined) fail(`Nothing to read in: ${line}`);
  if (op !== 'move') return line;
  const [destination, source] = exactly(rest.join(' ').split(','), 2, line);
  return `addu\t${destination},${source},$zero`;
}

export function isLabel(line) {
  return /^\$L(b|e)?\d+:$/.test(line);
}

function isInstruction(line, { ignoreNop = false, ignoreSet = false, ignoreLabel = false } = {}) {
  if (line.length === 0) return false;
  if (ignoreNop && line === '#nop') return false;
  if (ignoreSet && SETS.has(line)) return false;
  if (ignoreLabel && isLabel(line)) return false;
  if (line.startsWith('.stab') || line.startsWith('.def') || line.startsWith('.bend') || line.startsWith('.begin') || line.startsWith('.loc')) return false;
  if (line.startsWith('L')) {
    if (line.length < 2) fail('string index out of range');
    if (!'0123456789'.includes(line[1]) && line.endsWith(':')) return false;
  }
  if (line === '.set\tmacro' || line === '.set\tnomacro' || line === '#.set\tvolatile' || line === '#.set\tnovolatile') return false;
  return line !== '#APP' && line !== '#NO_APP';
}

function nextRegister(register) {
  return NEXT_REGISTER[register] ?? fail(`Unknown mapping for ${register}`);
}

function expandMacro(line) {
  const parts = [];
  for (const part of stripComments(line).split(';')) {
    const [op, ...rest] = words(part);
    if (op !== undefined) parts.push([op, rest.join(' ')]);
  }
  return parts;
}

function loadSingle(line) {
  const [register, value] = exactly(line.slice(5).split(','), 2, line);
  const view = new DataView(new ArrayBuffer(4));
  const number = pyFloat(value);
  if (Number.isFinite(number) && !Number.isFinite(Math.fround(number))) fail('float too large to pack with f format');
  view.setFloat32(0, number);
  const upper = view.getUint16(0), lower = view.getUint16(2);
  return [`lui\t${register},0x${hex(upper)}`, ...(lower ? [`ori\t${register},0x${hex(lower)}`] : [])];
}

function loadDouble(line) {
  const [low, value] = exactly(line.slice(5).split(','), 2, line);
  const high = nextRegister(low);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, pyFloat(value));
  const [highUpper, highLower, lowUpper, lowLower] = [0, 2, 4, 6].map(at => view.getUint16(at));
  const out = lowUpper || lowLower
    ? [`lui\t${low},0x${hex(lowUpper)}`, ...(lowLower ? [`ori\t${low},0x${hex(lowLower)}`] : [])]
    : [`li\t${low},0x0`];
  return [...out, `lui\t${high},0x${hex(highUpper)}`, ...(highLower ? [`ori\t${high},0x${hex(highLower)}`] : [])];
}

const isCoffDirective = line => line.startsWith('.def\t') || line.startsWith('.begin\t') || line.startsWith('.bend\t');

/** Python's str.split(maxsplit=n) on whitespace. */
function splitMax(text, n) {
  const parts = [];
  let rest = text.trimStart();
  while (parts.length < n && rest) {
    const m = /\s+/.exec(rest);
    if (!m) break;
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}

/** maspsx's MaspsxProcessor's options and their defaults, named as in JavaScript. */
const DEFAULTS = {
  sdataLimit: 0, expandDiv: false, expandLi: false, nopAtExpansion: false, nopMfloMfhi: true, nopLwLw: false,
  sltuAt: false, addiuAt: false, divUsesTge: false, gpAllowOffset: false, gpAllowLa: false, useCommSection: false,
  useCommForLcomm: false, maxCommAlignment: 16, lcommAlignment: 'word', commUsesSdataLimit: true, gpAllow: true,
  liSmallUsesAddiu: false,
};

/** maspsx's MaspsxProcessor: GCC's assembly lines in, ASPSX's way of them out. */
export class Processor {
  constructor(lines, options = {}) {
    for (const key of Object.keys(options)) if (!(key in DEFAULTS)) fail(`Unknown maspsx option: ${key}`);
    Object.assign(this, DEFAULTS, options);
    this.lines = lines.map(line => line.trim());
    this.isReorder = true;
    this.skipInstructions = 0;
    this.fileNum = 1;
    this.lineIndex = 0;
    this.bss = new Map();
    this.sbss = new Map();
    this.sdata = new Map();
    this.commSymbols = new Set();
  }

  /** Finds the sizes of the small data and of the symbols without a value, before any line is changed. */
  preprocess() {
    let inSdata = false, usesSize = false, current;
    for (const line of this.lines) {
      if (line === '' || line.startsWith('.align') || line.startsWith('.globl')) continue;
      if (line.startsWith('.text') || line.startsWith('.data') || line.startsWith('.rdata') || (line.startsWith('.section') && line.endsWith('.text'))) {
        inSdata = false;
        continue;
      }
      if (line.startsWith('#')) continue;
      if (line.startsWith('.sdata')) { inSdata = true; continue; }
      if (line.startsWith('.file') || line.startsWith('.extern')) { inSdata = false; continue; }
      if (line.startsWith('.comm') || line.startsWith('.lcomm')) {
        inSdata = false;
        const [, variable] = exactly(words(line), 2, line);
        const [symbol, sizeText] = variable.split(',');
        if (sizeText === undefined) fail(`Unable to unpack 2 from: ${line}`);
        const size = int10(sizeText);
        const isComm = line.startsWith('.comm');
        if ((this.commUsesSdataLimit || !isComm) && size <= this.sdataLimit) this.sbss.set(symbol, size);
        else this.bss.set(symbol, size);
        if (isComm) this.commSymbols.add(symbol);
        continue;
      }
      if (!inSdata) continue;
      const sized = /^\.size\s+([^,]+),([0-9]+)/.exec(line);
      if (sized) {
        current = sized[1];
        this.sdata.set(current, int10(sized[2]));
        usesSize = true;
        continue;
      }
      if (usesSize) continue;
      if (line.endsWith(':')) {
        current = line.replaceAll(':', '');
        this.sdata.set(current, 0);
        continue;
      }
      if (line.startsWith('.type')) continue;
      let size;
      if (line.startsWith('.space')) size = int10(exactly(words(line), 2, line)[1]);
      else if (line.startsWith('.word')) size = 4;
      else if (line.startsWith('.half') || line.startsWith('.short')) size = 2;
      else if (line.startsWith('.byte')) size = 1;
      else if (line.startsWith('.ascii')) size = [...line].length - 9;
      else fail(`Unable to parse .sdata instruction: ${line}`);
      if (current === undefined) fail(`No symbol for: ${line}`);
      this.sdata.set(current, this.sdata.get(current) + size);
    }
  }

  processLines() {
    this.isReorder = true;
    this.skipInstructions = 0;
    this.fileNum = 1;
    this.bss = new Map();
    this.sbss = new Map();
    this.sdata = new Map();
    this.preprocess();

    const out = [];
    let inIncludeAsmHack = false;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      this.lineIndex = i;
      if (line.includes('.ent\t__maspsx_include_asm_hack')) inIncludeAsmHack = true;
      if (inIncludeAsmHack) {
        out.push(line.includes('# maspsx-keep') ? line : `# ${line} # DEBUG: skipped due to include asm hack`);
        if (line.includes('.end\t__maspsx_include_asm_hack')) inIncludeAsmHack = false;
        continue;
      }
      if (this.skipInstructions > 0 && isInstruction(line)) {
        this.skipInstructions -= 1;
        out.push(`# ${line}  # DEBUG: skipped`);
      } else out.push(...this.processLine(line));
    }

    for (const [section, entries] of [['sbss', this.sbss], ['bss', this.bss]]) {
      if (entries.size) out.push(`.section .${section}`);
      for (const [symbol, size] of entries) {
        let [alignment, padded] = lcommLayout(this.lcommAlignment, size);
        const isComm = this.commSymbols.has(symbol) || this.useCommForLcomm;
        if (this.useCommSection && isComm) {
          // A real `comm` symbol takes GNU as's own alignment: its size rounded up to a power of two.
          if (this.commSymbols.has(symbol)) alignment = 2 ** bitLength(size - 1);
          out.push(`\t.comm ${symbol},${size},${Math.min(alignment, this.maxCommAlignment)}`);
          continue;
        }
        if (alignment > 1) out.push(`\t.align ${bitLength(alignment) - 1}`);
        if (section === 'bss') out.push(`\t.globl ${symbol}`);
        out.push(`${symbol}:`, `\t.space ${padded}`);
      }
    }
    return out;
  }

  getNextInstruction(skip = 0, ignore = {}) {
    for (let i = this.lineIndex + 1; i < this.lines.length; i++) {
      if (!isInstruction(this.lines[i], ignore)) continue;
      if (skip === 0) return this.lines[i];
      skip -= 1;
    }
    return '';
  }

  usesGp(line) {
    if (this.sdataLimit === 0 || !this.gpAllow) return false;
    line = stripComments(line);
    if (!usesAt(line)) return false;
    const [op, ...rest] = line.split('\t');
    if (!LOADS.has(op) && !STORES.has(op)) return false;
    const { operand } = parseLoadOrStore(rest.join(' '));
    let symbol = operand, gpAllowed = true;
    if (count(operand, '+') === 1) {
      [symbol] = operand.split('+');
      gpAllowed = this.gpAllowOffset || !this.commSymbols.has(symbol);
    }
    return gpAllowed && (this.sbss.has(symbol) || this.sdata.has(symbol));
  }

  /** A nop after a load when the next instruction reads what was loaded, as ASPSX fills the load's delay. */
  nopBeforeNextInstruction(next, destination) {
    if (!lineLoadsFromReg(next, destination, this.nopLwLw)) return [`#nop # DEBUG: '${next}' does not load from ${destination}`];
    const out = [];
    let reason;
    if (!usesAt(next)) reason = `'${next}' does not use $at`;
    if (this.usesGp(next)) reason = `'${next}' uses $gp`;
    if (usesAt(next) && this.nopAtExpansion) reason = `'${next}' inject nop beween ${destination} and $at expansion`;
    if (reason === undefined) return out;
    for (let skip = 0; ; ) {
      const maybeLabel = this.getNextInstruction(skip, { ignoreNop: true, ignoreSet: true });
      if (!isLabel(maybeLabel)) break;
      out.push(maybeLabel);
      skip += 1;
      this.skipInstructions = skip;
    }
    out.push(`nop # DEBUG: Reuse of '${destination}'. ${reason}`);
    return out;
  }

  /** No mult or div within two instructions of an mflo or mfhi: ASPSX's nops, moving what lies between. */
  mfloMfhi(source = null) {
    const out = [];
    if (!this.nopMfloMfhi) return out;
    const ignore = { ignoreNop: true, ignoreSet: true, ignoreLabel: true };
    const next = this.getNextInstruction(0, ignore);
    const nextNext = this.getNextInstruction(1, ignore);

    if (MULTIPLIES.some(x => next.startsWith(x))) {
      let skip = 0;
      for (;;) {
        const inst = this.getNextInstruction(skip);
        skip += 1;
        if (inst === next) {
          out.push('nop', 'nop');
          if (divNeedsExpanding(inst)) {
            out.push('# DEBUG: div needs expanding');
            skip -= 1;
          } else out.push(expandMove(inst));
          break;
        }
        if (!inst.startsWith('#')) out.push(expandMove(inst));
      }
      this.skipInstructions = skip;
    } else if (MULTIPLIES.some(x => nextNext.startsWith(x))) {
      let skip = 0, noReorder = false;
      for (;;) {
        const inst = this.getNextInstruction(skip);
        if (inst.startsWith('.set') && inst.endsWith('noreorder')) {
          noReorder = true;
          skip += 1;
          continue;
        }
        skip += 1;
        if (inst === next) {
          const [op] = words(inst);
          // A load or another mflo or mfhi is seen to later, when its own line comes.
          if (LOADS.has(op) || op === 'mflo' || op === 'mfhi') {
            skip = 0;
            break;
          }
          if (op === 'li') {
            const expanded = expandLoadImmediate(inst, this.liSmallUsesAddiu);
            out.push(...(this.expandLi ? expanded : [inst]));
            const maybeLabel = this.getNextInstruction(skip);
            if (isLabel(maybeLabel)) {
              out.push(maybeLabel);
              skip += 1;
            }
            out.push(expanded.length === 2
              ? '#nop  # DEBUG: mflo/mfhi with mult/div/rem and li expands to 2 ops'
              : 'nop  # DEBUG: mflo/mfhi with mult/div/rem and li expands to 1 op');
          } else if (noReorder) {
            out.push('nop  # DEBUG: mflo/mfhi with mult/div/rem and 1 instruction (noreorder)', '.set\tnoreorder', expandMove(inst));
          } else if (usesAt(inst)) {
            // A load or store of a symbol expands to lui, addu and itself through $at, which covers the gap.
            out.push(inst, '#nop  # DEBUG: mflo/mfhi with mult/div/rem and instruction expands through $at');
          } else if (source && lineLoadsFromReg(inst, source, this.nopLwLw)) {
            // Only when the div has been expanded (ASPSX's -0).
            out.push(`nop  # DEBUG: mflo/mfhi with mult/div/rem and 1 instruction which loads from ${source}`, expandMove(inst));
          } else if (BRANCHES.has(op) || JUMPS.has(op)) {
            out.push(inst, 'nop # DEBUG: mflo/mfhi with mult/div/rem and 1 instruction (branch)');
          } else {
            const maybeLabel = this.getNextInstruction(skip);
            if (isLabel(maybeLabel)) {
              out.push(expandMove(inst), maybeLabel, 'nop  # DEBUG: mflo/mfhi with mult/div/rem and 1 instruction (label)');
              skip += 1;
            } else out.push(expandMove(inst), 'nop  # DEBUG: mflo/mfhi with mult/div/rem and 1 instruction');
          }
        } else if (inst === nextNext) {
          if (divNeedsExpanding(inst)) {
            out.push('# DEBUG: div needs expanding');
            skip -= 1;
          } else out.push(inst);
          break;
        } else if (!inst.startsWith('#')) out.push(expandMove(inst));
      }
      this.skipInstructions = skip;
    }
    return out;
  }

  /** A load or store of a small-data symbol through $gp, when the version and -G allow it, or the line as it was. */
  gpRelative(op, destination, operand, line) {
    let symbol, gpRel, gpAllowed = false;
    if (!this.gpAllow) gpAllowed = false;
    else if (count(operand, '+') === 1) {
      const [name, offset] = operand.split('+');
      symbol = name;
      gpRel = `%gp_rel(${name}+${offset})($gp)`;
      gpAllowed = this.gpAllowOffset || !this.commSymbols.has(name);
    } else {
      symbol = operand;
      gpRel = `%gp_rel(${operand})($gp)`;
      gpAllowed = true;
    }
    if (op === 'la' && !this.gpAllowLa) gpAllowed = false;
    return gpAllowed && (this.sdata.has(symbol) || this.sbss.has(symbol)) ? `${op}\t${destination},${gpRel}` : line;
  }

  /** `op` through $at, as ASPSX expands a symbol or an offset past 16 bits. */
  throughAt(op, destination, operand, source, { addiu = false, sourceFirst = false } = {}) {
    const steps = addiu
      ? [`lui\t$at,%hi(${operand})`, `addiu\t$at,$at,%lo(${operand})`, `addu\t$at,$at,${source}`, `${op}\t${destination},0x0($at)`]
      : [`lui\t$at,%hi(${operand})`, sourceFirst ? `addu\t$at,${source},$at` : `addu\t$at,$at,${source}`, `${op}\t${destination},%lo(${operand})($at)`];
    return ['# EXPAND_AT START', '.set\tnoat', ...steps, '.set\tat', '# EXPAND_AT END'];
  }

  processLine(line) {
    if (line.length === 0) return [line];
    if (line.startsWith('#')) return [];

    if (line.startsWith('.')) {
      if (isCoffDirective(line)) return [];
      if (line.startsWith('.set\t')) {
        if (line.endsWith('\tnoreorder')) this.isReorder = false;
        else if (line.endsWith('\treorder')) this.isReorder = true;
        return [];
      }
      if (line.startsWith('.file\t')) {
        // Numbers each file anew, as files of the same number would clash.
        const [, , filename] = exactly(splitMax(line, 2), 3, line);
        return [`.file\t${this.fileNum++} ${filename}`];
      }
      if (line.startsWith('.ent\t')) return [line, '.set\tnoreorder'];
      if (line.startsWith('.comm') || line.startsWith('.lcomm')) return [];
      if (line.startsWith('.data')) return ['.section .data'];
      if (line.startsWith('.sdata')) return ['.section .sdata'];
      if (line.startsWith('.rdata')) return ['.section .rodata'];
      return [line];
    }
    if (line.startsWith('$L')) return [line];

    // A line holding more than one instruction (a macro): the last one's destination, if it loads.
    let macroDestination = null;
    if (line.includes(';')) {
      const expanded = expandMacro(line);
      if (expanded.length > 0) {
        const [op, rest] = expanded.at(-1);
        if (LOADS.has(op)) macroDestination = parseLoadOrStore(rest).destination;
      }
    }

    const [op, ...rest] = words(line);
    const out = [];
    if (LOADS.has(op)) {
      let { source, destination, operand, isAddend, needsExpanding } = parseLoadOrStore(rest.join(' '));
      let next = this.getNextInstruction(0, { ignoreNop: true, ignoreSet: true, ignoreLabel: true });
      if (next.includes(';')) next = next.split(';')[0];
      if (!needsExpanding) {
        // Newer GCCs write %hi() and %lo() themselves: the assembler expands those.
        out.push(`${line} # DEBUG: leaving for assembler to expand`);
      } else if (isAddend && source === null) {
        out.push(this.gpRelative(op, destination, operand, line));
      } else if (isAddend && source) {
        out.push(...this.throughAt(op, destination, operand, source, { addiu: this.addiuAt }));
      } else {
        if (source && (int0(operand) > 32767n || int0(operand) < -32768n)) {
          out.push(...this.throughAt(op, destination, operand, source, { sourceFirst: true }));
        } else out.push(line);
        if (macroDestination !== null) destination = macroDestination;
      }
      out.push(...this.nopBeforeNextInstruction(next, destination));
    } else if (STORES.has(op) || (op === 'la' && this.sdataLimit > 0)) {
      const { source, destination, operand, isAddend } = parseLoadOrStore(rest.join(' '));
      if (isAddend && source === null) out.push(this.gpRelative(op, destination, operand, line));
      else if (isAddend && source) {
        if (this.addiuAt && op !== 'la') out.push(...this.throughAt(op, destination, operand, source, { addiu: true }));
        else out.push(line);
      } else if (source && (int0(operand) > 32767n || int0(operand) < -32768n)) {
        out.push(...this.throughAt(op, destination, operand, source, { sourceFirst: true }));
      } else out.push(line);
    } else if (BRANCHES.has(op) || JUMPS.has(op)) {
      out.push(line);
      if (this.isReorder) out.push('nop  # DEBUG: branch/jump');
    } else if (op === 'move') {
      out.push(expandMove(line));
    } else if (['addu', 'subu', 'sra', 'srl', 'srr', 'sll', 'or'].includes(op)) {
      out.push(line);
    } else if (op === 'li') {
      out.push(...(this.expandLi ? expandLoadImmediate(line, this.liSmallUsesAddiu) : [line]));
    } else if (op === 'li.s') {
      out.push(...loadSingle(line));
    } else if (op === 'li.d') {
      out.push(...loadDouble(line));
    } else if (op === 'mflo' || op === 'mfhi') {
      out.push(line, ...this.mfloMfhi());
    } else if (op === 'break') {
      // `break 7` is `break 0x0,0x7`: the code's two fields.
      const code = int0(first(rest, line));
      out.push(`break\t0x${hex(code >> 10n)},0x${hex(code & 0x3FFn)}`);
    } else if (['div', 'rem', 'divu', 'remu'].includes(op)) {
      const [destination, source, operand] = exactly(first(rest, line).split(','), 3, line);
      if (destination === '$zero' || destination === '$0') return [line];
      const unsigned = op.endsWith('u');
      const moveFrom = op.startsWith('rem') ? 'mfhi' : 'mflo';
      const name = unsigned ? 'DIVU' : 'DIV';
      const divide = `${unsigned ? 'divu' : 'div'}\t$zero,${source},${operand}`;
      if (this.expandDiv) {
        const notByZero = `.L_NOT_DIV_BY_ZERO_${this.lineIndex}`;
        const positive = `.L_DIV_BY_POSITIVE_SIGN_${this.lineIndex}`;
        out.push(`# EXPAND_${name} START`, '.set\tnoat', divide, `bnez\t${operand},${notByZero}`, 'nop', 'break\t0x7', `${notByZero}:`);
        if (!unsigned) {
          out.push('addiu\t$at,$zero,-1', `bne\t${operand},$at,${positive}`, 'lui\t$at,0x8000', `bne\t${source},$at,${positive}`, 'nop',
            this.divUsesTge ? 'tge\t$zero,$zero,93' : 'break\t0x6', `${positive}:`);
        }
        out.push(`${moveFrom}\t${destination}`, '.set\tat', `# EXPAND_${name} END`);
      } else {
        out.push(`# EXPAND_ZERO_${name} START`, divide, `${moveFrom}\t${destination}`, `# EXPAND_ZERO_${name} END`);
      }
      const nops = this.mfloMfhi(destination);
      if (nops.length > 0) out.push(...nops);
      else out.push(...this.nopBeforeNextInstruction(this.getNextInstruction(0, { ignoreSet: true, ignoreLabel: true }), destination));
    } else if (op === 'sltu') {
      const [destination, source, operand] = exactly(first(rest, line).split(','), 3, line);
      // Below 2.60, ASPSX compares with a negative constant through $at. (maspsx reads the constant in base 10 first,
      // so a hexadecimal one is an error there, and here.)
      const value = isNumber(operand) ? int10(operand) : 0;
      if (this.sltuAt && value < 0) out.push(`li\t$at,${operand}`, `${op}\t${destination},${source},$at`);
      else out.push(line);
    } else out.push(line);
    return out;
  }
}

/** maspsx's PassthroughProcessor: the lines as they are, but for COFF's directives, which GNU as refuses. */
export class Passthrough {
  constructor(lines) {
    this.lines = lines.map(line => line.trim());
  }

  processLines() {
    return this.lines.filter(line => !(line.startsWith('.') && isCoffDirective(line)));
  }
}

/** What maspsx.py sets for an ASPSX version ('2.56'), or for none: its AspsxVersionConfig. */
export function optionsFor(version) {
  const options = {
    divUsesTge: false, nopAtExpansion: false, nopMfloMfhi: true, nopLwLw: false, sltuAt: true, expandLi: true,
    liSmallUsesAddiu: false, gpAllowOffset: false, gpAllowLa: false, gpAllow: true, addiuAt: false,
    lcommAlignment: 'word', commUsesSdataLimit: true,
  };
  if (version === undefined || version === null) return options;
  const v = String(version).split('.').map(int10);
  const compare = other => {
    for (let i = 0; i < Math.max(v.length, other.length); i++) {
      if (i >= v.length) return -1;
      if (i >= other.length) return 1;
      if (v[i] !== other[i]) return v[i] < other[i] ? -1 : 1;
    }
    return 0;
  };
  if (compare([2, 8]) < 0) options.lcommAlignment = 'none';
  if (compare([1, 10]) > 0 && compare([2, 10]) < 0) options.divUsesTge = true;
  if (compare([2, 10]) < 0) Object.assign(options, { commUsesSdataLimit: false, gpAllow: false });
  if (compare([2, 30]) < 0) Object.assign(options, { nopAtExpansion: true, nopMfloMfhi: false, addiuAt: true, nopLwLw: true });
  if (compare([2, 50]) >= 0) Object.assign(options, { expandLi: false, liSmallUsesAddiu: true });
  if (compare([2, 60]) >= 0) Object.assign(options, { sltuAt: false, lcommAlignment: 'power_of_two' });
  if (compare([2, 70]) >= 0) options.gpAllowOffset = true;
  if (compare([2, 80]) >= 0) options.gpAllowLa = true;
  return options;
}

/** The lines Python's readlines() gives of a text. */
export function linesOf(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * What maspsx.py makes of GCC's assembly, with its command line as settings: `aspsxVersion` ('2.56'), `sdataLimit` (its
 * -G), and `expandDiv`, `dontExpandLi`, `useCommSection`, `useCommForLcomm`, `maxCommAlignment`, `macroInc`,
 * `passthrough`, `dontForceG0`. Returns the assembly for the assembler and the -G to assemble it with: 0 unless
 * `dontForceG0` is given and the version uses $gp, else `sdataLimit` (undefined: the assembler's own).
 */
export function maspsx(assembly, settings = {}) {
  const {
    aspsxVersion, sdataLimit, expandDiv = false, dontExpandLi = false, useCommSection = false,
    useCommForLcomm = false, maxCommAlignment = 16, macroInc = false, passthrough = false, dontForceG0 = false,
    ...unknown
  } = settings;
  for (const key of Object.keys(unknown)) fail(`Unknown maspsx setting: ${key}`);
  const lines = linesOf(assembly);
  let forceG0 = !dontForceG0;
  let processor;
  if (passthrough) processor = new Passthrough(lines);
  else {
    const version = optionsFor(aspsxVersion);
    if (dontExpandLi) version.expandLi = false;
    // GNU as would use $gp itself.
    if (!version.gpAllow) forceG0 = true;
    processor = new Processor(lines, { ...version, sdataLimit: sdataLimit ?? 0, expandDiv, useCommSection, useCommForLcomm, maxCommAlignment });
  }
  const out = [macroInc ? '.include "macro.inc"' : '', ...processor.processLines()];
  return { assembly: `${out.join('\n')}\n`, smallData: forceG0 ? 0 : sdataLimit };
}
