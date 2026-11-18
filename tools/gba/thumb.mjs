// The tools' own assembler for the Game Boy Advance's Thumb instructions, for exactly what the console's compiler
// writes (gba/agbcc.mjs): match turns a twin's assembly into bytes with it, to compare them with the original's. It's
// here because nothing `npm ci` brings can do it, as its clang has no ARM target, and a computer's own assembler isn't
// the same on Linux, a Mac and Windows. It reads the older way of writing Thumb, as GNU's assembler of the time did,
// and makes the choices that assembler made where one line could be two instructions: a low register moved to a low
// register is an add of zero, and a number added to a register kept in the same register takes the 8-bit form.
//
// It links nothing. A name it can't place, such as a call or an address kept beside a function, comes back as a
// relocation, and match fills each in with the name's address in the original.

const REGISTERS = { r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7, r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15, sl: 10, fp: 11, ip: 12, sp: 13, lr: 14, pc: 15 };
const SP = 13, LR = 14, PC = 15;
const CONDITIONS = { eq: 0, ne: 1, cs: 2, hs: 2, cc: 3, lo: 3, mi: 4, pl: 5, vs: 6, vc: 7, hi: 8, ls: 9, ge: 10, lt: 11, gt: 12, le: 13 };
// the instructions of two low registers, by their number in the instruction
const TWO = { and: 0, eor: 1, lsl: 2, lsr: 3, asr: 4, adc: 5, sbc: 6, ror: 7, tst: 8, neg: 9, cmp: 10, cmn: 11, orr: 12, mul: 13, bic: 14, mvn: 15 };
// those the compiler also writes with the register it keeps the answer in first, as in `and r0, r0, r1`
const KEEPS = new Set(['and', 'eor', 'adc', 'sbc', 'ror', 'orr', 'mul', 'bic', 'lsl', 'lsr', 'asr']);
const SHIFTS = { lsl: 0, lsr: 1, asr: 2 };
// loads and stores: with a number after the register, the instruction, the size the number counts in and whether it
// loads; with a second register, the instruction
const BY_NUMBER = { str: [0x6000, 4], ldr: [0x6800, 4], strb: [0x7000, 1], ldrb: [0x7800, 1], strh: [0x8000, 2], ldrh: [0x8800, 2] };
const BY_REGISTER = { str: 0x5000, strh: 0x5200, strb: 0x5400, ldrsb: 0x5600, ldsb: 0x5600, ldr: 0x5800, ldrh: 0x5A00, ldrb: 0x5C00, ldrsh: 0x5E00, ldsh: 0x5E00 };

/** What `text`, assembly as the compiler writes it, comes to:
 *  { sections: { name: { bytes, lines } }, symbols: Map of name to { section, at, function }, relocations: [{ section,
 *  at, kind: 'word' or 'call', name, addend }], sizes: Map of a function's name to its length }. `lines` says which
 *  line of the text each byte came from. An error names the line it couldn't read. */
export function assemble(text) {
  const sections = {}, symbols = new Map(), relocations = [], sizes = new Map(), functions = new Set();
  // what waits for every label to be known: a branch, a load from beside the function, a length
  const later = [];
  let section, at = 0;
  const into = name => {
    sections[name] ??= { bytes: [], lines: [] };
    section = name;
  };
  into('.text');
  let lineNumber = 0;
  const fail = what => { throw new Error(`Line ${lineNumber} of the assembly: ${what}`); };
  const byte = value => {
    sections[section].bytes.push(value & 255);
    sections[section].lines.push(lineNumber);
  };
  const half = value => { byte(value); byte(value >> 8); };
  const word = value => { half(value); half(value >>> 16); };
  const here = () => sections[section].bytes.length;

  const number = text => {
    const m = /^([-+]?)(0x[0-9a-f]+|\d+)$/i.exec(text.trim());
    if (!m) return null;
    return (m[1] === '-' ? -1 : 1) * Number(m[2]);
  };
  // a name with a number added or taken away, or a number alone: { name, addend }. agbcc writes a name less a
  // number as the name plus a negative one, as in gFoo+-0x8, which GNU's assembler reads as gFoo - 8
  const expression = text => {
    text = text.trim();
    const plain = number(text);
    if (plain !== null) return { name: null, addend: plain };
    const m = /^([A-Za-z_.$][\w.$]*)\s*(?:([-+])\s*([-+]?)\s*(0x[0-9a-f]+|\d+))?$/i.exec(text);
    if (!m) fail(`"${text}" isn't a name, a number or a name and a number.`);
    const sign = (m[2] === '-' ? -1 : 1) * (m[3] === '-' ? -1 : 1);
    return { name: m[1], addend: m[2] ? sign * Number(m[4]) : 0 };
  };
  const register = text => REGISTERS[text.trim().toLowerCase()];
  const low = r => r !== undefined && r < 8;
  const immediate = text => {
    const value = text.trim().startsWith('#') ? number(text.trim().slice(1)) : null;
    if (value === null) fail(`"${text.trim()}" isn't a number written as #n.`);
    return value;
  };
  const isImmediate = text => text.trim().startsWith('#');
  const within = (value, most, what, step = 1) => {
    if (value < 0 || value > most || value % step) fail(`${what} takes a number from 0 to ${most}${step > 1 ? `, in steps of ${step}` : ''}, not ${value}.`);
    return value / step;
  };

  // a line's operands: split at the commas outside [] and {}
  const split = rest => {
    const parts = [];
    let depth = 0, from = 0;
    for (let i = 0; i < rest.length; i++) {
      if ('[{'.includes(rest[i])) depth++;
      else if (']}'.includes(rest[i])) depth--;
      else if (rest[i] === ',' && !depth) { parts.push(rest.slice(from, i).trim()); from = i + 1; }
    }
    if (rest.trim()) parts.push(rest.slice(from).trim());
    return parts;
  };
  const list = text => {
    const m = /^\{(.*)\}$/.exec(text.trim());
    if (!m) fail(`"${text}" isn't a list of registers in { }.`);
    let bits = 0;
    for (const part of m[1].split(',').map(p => p.trim()).filter(Boolean)) {
      const range = part.split('-').map(register);
      if (range.some(r => r === undefined)) fail(`"${part}" isn't a register.`);
      for (let r = range[0]; r <= range.at(-1); r++) bits |= 1 << r;
    }
    return bits;
  };

  const addOrSub = (op, a) => {
    let [rd, rs, last] = a.length === 2 ? [register(a[0]), register(a[0]), a[1]] : [register(a[0]), register(a[1]), a[2]];
    if (rd === undefined || rs === undefined) fail(`${op} needs registers.`);
    if (isImmediate(last)) {
      let value = immediate(last), sub = op === 'sub';
      if (value < 0) { value = -value; sub = !sub; }
      if (rd === SP && rs === SP) return half(0xB000 | (sub ? 0x80 : 0) | within(value, 508, `${op} to sp`, 4));
      if ((rs === SP || rs === PC) && !sub && low(rd)) return half((rs === SP ? 0xA800 : 0xA000) | rd << 8 | within(value, 1020, `${op} from ${a[1]}`, 4));
      if (!low(rd) || !low(rs)) fail(`${op} with a number needs r0 to r7, sp or pc.`);
      // the 8-bit form whenever the answer stays in the same register, as GNU's assembler chose, even for a small number
      if (rd === rs) return half((sub ? 0x3800 : 0x3000) | rd << 8 | within(value, 255, op));
      return half((sub ? 0x1E00 : 0x1C00) | within(value, 7, op) << 6 | rs << 3 | rd);
    }
    const rn = register(last);
    if (rn === undefined) fail(`${op} can't add "${last}".`);
    if (low(rd) && low(rs) && low(rn)) return half((op === 'sub' ? 0x1A00 : 0x1800) | rn << 6 | rs << 3 | rd);
    if (op === 'sub') fail('sub takes r0 to r7 only.');
    // a register above r7: the answer stays in one of the two added
    const other = rd === rs ? rn : rd === rn ? rs : fail('add with a register above r7 keeps its answer in one of the two.');
    return half(0x4400 | (rd & 8) << 4 | other << 3 | (rd & 7));
  };

  const memory = (op, a) => {
    const rd = register(a[0]);
    if (!low(rd)) fail(`${op} needs r0 to r7 first.`);
    const m = /^\[(.*)\]$/.exec(a[1] ?? '');
    if (!m) {
      // a value kept beside the function, named by its label
      if (op !== 'ldr' || a.length !== 2) fail(`${op} needs a place in [ ].`);
      const target = expression(a[1]);
      if (!target.name) fail('ldr from a label needs the label.');
      later.push({ kind: 'load', section, at: here(), line: lineNumber, rd, ...target });
      return half(0);
    }
    const inside = split(m[1]), base = register(inside[0]);
    if (base === undefined) fail(`"${inside[0]}" isn't a register.`);
    const second = inside[1] ?? '#0';
    if (!isImmediate(second)) {
      const offset = register(second);
      if (!low(base) || !low(offset) || BY_REGISTER[op] === undefined) fail(`${op} can't reach [${m[1]}].`);
      return half(BY_REGISTER[op] | offset << 6 | base << 3 | rd);
    }
    const value = immediate(second);
    if ((base === SP || base === PC) && (op === 'ldr' || (op === 'str' && base === SP))) {
      return half((base === PC ? 0x4800 : op === 'ldr' ? 0x9800 : 0x9000) | rd << 8 | within(value, 1020, `${op} from ${inside[0]}`, 4));
    }
    if (!low(base) || !BY_NUMBER[op]) fail(`${op} can't reach [${m[1]}].`);
    const [code, step] = BY_NUMBER[op];
    return half(code | within(value, 31 * step, op, step) << 6 | base << 3 | rd);
  };

  const instruction = (op, a) => {
    const rd = register(a[0] ?? ''), rs = register(a[1] ?? '');
    if (op === 'push' || op === 'pop') {
      const bits = list(a.join(',')), extra = op === 'push' ? 1 << LR : 1 << PC;
      if (bits & ~(0xFF | extra)) fail(`${op} takes r0 to r7 and ${op === 'push' ? 'lr' : 'pc'}.`);
      return half((op === 'push' ? 0xB400 : 0xBC00) | (bits & extra ? 0x100 : 0) | (bits & 0xFF));
    }
    if (op === 'stmia' || op === 'ldmia') {
      const base = register(a[0].replace(/!$/, ''));
      if (!low(base)) fail(`${op} needs r0 to r7.`);
      return half((op === 'stmia' ? 0xC000 : 0xC800) | base << 8 | (list(a.slice(1).join(',')) & 0xFF));
    }
    if (op === 'bx') return rd === undefined ? fail('bx needs a register.') : half(0x4700 | rd << 3);
    if (op === 'swi') return half(0xDF00 | within(number(a[0]) ?? immediate(a[0]), 255, 'swi'));
    if (op === 'bl') {
      // a call is always left for match, which knows where the original keeps what's called
      relocations.push({ section, at: here(), kind: 'call', ...expression(a[0]) });
      half(0xF000);
      return half(0xF800);
    }
    if (op === 'b' || (op[0] === 'b' && CONDITIONS[op.slice(1)] !== undefined)) {
      later.push({ kind: 'branch', section, at: here(), line: lineNumber, condition: op === 'b' ? null : CONDITIONS[op.slice(1)], ...expression(a[0]) });
      return half(0);
    }
    if (op === 'add' || op === 'sub') return addOrSub(op, a);
    if (BY_REGISTER[op] !== undefined) return memory(op, a);
    if (op === 'mov') {
      if (rd === undefined) fail('mov needs a register.');
      if (isImmediate(a[1] ?? '')) return low(rd) ? half(0x2000 | rd << 8 | within(immediate(a[1]), 255, 'mov')) : fail('mov of a number needs r0 to r7.');
      if (rs === undefined) fail(`mov can't move "${a[1]}".`);
      // two low registers: an add of zero, as GNU's assembler wrote it
      if (low(rd) && low(rs)) return half(0x1C00 | rs << 3 | rd);
      return half(0x4600 | (rd & 8) << 4 | rs << 3 | (rd & 7));
    }
    if (op === 'cmp' && isImmediate(a[1] ?? '')) return low(rd) ? half(0x2800 | rd << 8 | within(immediate(a[1]), 255, 'cmp')) : fail('cmp with a number needs r0 to r7.');
    if (op === 'cmp' && rd !== undefined && rs !== undefined && !(low(rd) && low(rs))) return half(0x4500 | (rd & 8) << 4 | rs << 3 | (rd & 7));
    if (SHIFTS[op] !== undefined && isImmediate(a.at(-1))) {
      const from = a.length === 3 ? rs : rd;
      if (!low(rd) || !low(from)) fail(`${op} needs r0 to r7.`);
      return half(SHIFTS[op] << 11 | within(immediate(a.at(-1)), op === 'lsl' ? 31 : 32, op) % 32 << 6 | from << 3 | rd);
    }
    if (TWO[op] !== undefined) {
      let from = rs;
      if (a.length === 3) {
        const third = register(a[2]);
        if (!KEEPS.has(op)) fail(`${op} takes two registers.`);
        // the answer stays in one of the two: for mul either, for the rest the first
        from = rd === rs ? third : op === 'mul' && rd === third ? rs : fail(`${op} keeps its answer in its first register.`);
      } else if (a.length === 1 && op === 'neg') from = rd;
      if (!low(rd) || !low(from)) fail(`${op} needs r0 to r7.`);
      return half(0x4000 | TWO[op] << 6 | from << 3 | rd);
    }
    return fail(`the tools' assembler doesn't know "${op}", which the console's compiler isn't known to write.`);
  };

  const text_ = quoted => {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(quoted.trim());
    if (!m) fail('.ascii needs text in " ".');
    const escapes = { n: 10, t: 9, r: 13, b: 8, f: 12, '"': 34, '\\': 92 };
    for (let i = 0; i < m[1].length; i++) {
      if (m[1][i] !== '\\') { byte(m[1].charCodeAt(i)); continue; }
      const octal = /^[0-7]{1,3}/.exec(m[1].slice(i + 1));
      if (octal) { byte(parseInt(octal[0], 8)); i += octal[0].length; } else byte(escapes[m[1][++i]] ?? m[1].charCodeAt(i));
    }
  };
  const data = (size, a) => {
    for (const part of a) {
      const value = expression(part);
      if (value.name) {
        if (size !== 4) fail('a name kept in the code takes a whole word.');
        relocations.push({ section, at: here(), kind: 'word', ...value });
        word(0);
      } else if (size === 4) word(value.addend);
      else if (size === 2) half(value.addend);
      else byte(value.addend);
    }
  };
  const directive = (name, rest) => {
    const a = split(rest);
    switch (name) {
      case '.text': case '.data': case '.bss': return into(name);
      case '.section': return into(a[0]);
      case '.code': return a[0] === '16' ? null : fail('only Thumb code, .code 16, is read.');
      case '.align': {
        const to = 1 << Number(a[0] ?? 0);
        while (here() % to) byte(Number(a[1] ?? 0));
        return null;
      }
      case '.word': case '.long': case '.4byte': return data(4, a);
      case '.short': case '.hword': case '.2byte': return data(2, a);
      case '.byte': return data(1, a);
      case '.ascii': return text_(rest);
      case '.space': case '.skip': for (let i = Number(a[0]); i > 0; i--) byte(0); return null;
      case '.thumb_func': return null;
      case '.type': return /function/.test(a[1] ?? '') ? functions.add(a[0]) : null;
      case '.size': {
        const m = /^([\w.$]+)\s*-\s*([\w.$]+)$/.exec(a[1] ?? '');
        if (m) later.push({ kind: 'size', of: a[0], end: m[1], start: m[2], line: lineNumber });
        return null;
      }
      // a value of the file's own with no place in it: match finds its address by its name
      case '.comm': case '.lcomm': case '.globl': case '.global': case '.ident': case '.file': return null;
      default: return fail(`the tools' assembler doesn't know "${name}", which the console's compiler isn't known to write.`);
    }
  };

  for (const raw of text.split('\n')) {
    lineNumber++;
    // a comment starts at an @ outside quotes
    let line = raw.replace(/^((?:[^"@]|"(?:[^"\\]|\\.)*")*)@.*$/, '$1').trim();
    for (let m; (m = /^([A-Za-z_.$][\w.$]*):\s*/.exec(line));) {
      if (symbols.has(m[1])) fail(`${m[1]} is there twice.`);
      symbols.set(m[1], { section, at: here() });
      line = line.slice(m[0].length);
    }
    if (!line) continue;
    const m = /^(\S+)\s*(.*)$/.exec(line);
    if (m[1].startsWith('.')) directive(m[1].toLowerCase(), m[2]);
    else {
      if (here() % 2) fail('an instruction at an odd address.');
      instruction(m[1].toLowerCase(), split(m[2]));
    }
  }

  for (const wait of later) {
    lineNumber = wait.line;
    if (wait.kind === 'size') {
      const end = symbols.get(wait.end), start = symbols.get(wait.start);
      if (end && start && end.section === start.section) sizes.set(wait.of, end.at - start.at);
      continue;
    }
    const target = symbols.get(wait.name);
    if (!target || target.section !== wait.section) fail(`${wait.name} isn't a place in this part of the file, and a ${wait.kind === 'load' ? 'load' : 'branch'} only reaches one.`);
    const bytes = sections[wait.section].bytes, to = target.at + wait.addend;
    let code;
    if (wait.kind === 'load') {
      // from the word the instruction after next is in
      const offset = to - ((wait.at + 4) & ~3);
      code = 0x4800 | wait.rd << 8 | within(offset, 1020, `a load from ${wait.name}`, 4);
    } else {
      const offset = to - (wait.at + 4);
      const [most, bits] = wait.condition === null ? [2048, 0x7FF] : [256, 0xFF];
      if (offset % 2 || offset < -most || offset >= most) fail(`a branch to ${wait.name} is ${offset} bytes away, too far for it.`);
      code = (wait.condition === null ? 0xE000 : 0xD000 | wait.condition << 8) | ((offset >> 1) & bits);
    }
    bytes[wait.at] = code & 255;
    bytes[wait.at + 1] = code >> 8;
  }
  for (const [name, symbol] of symbols) symbol.function = functions.has(name);
  for (const name of Object.keys(sections)) sections[name].bytes = Buffer.from(sections[name].bytes);
  return { sections, symbols, relocations, sizes };
}
