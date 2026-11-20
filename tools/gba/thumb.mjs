// The tools' own assembler for the Game Boy Advance's Thumb instructions, for exactly what the console's compiler
// writes (gba/agbcc.mjs): match turns a twin's assembly into bytes with it, to compare them with the original's. It's
// here because nothing `npm ci` brings can do it, as its clang has no ARM target, and a computer's own assembler isn't
// the same on Linux, a Mac and Windows. It reads the older way of writing Thumb, as GNU's assembler of the time did,
// and makes the choices that assembler made where one line could be two instructions: a low register moved to a low
// register is an add of zero, and a number added to a register kept in the same register takes the 8-bit form.
//
// It links nothing. A name it can't place, such as a call or an address kept beside a function, comes back as a
// relocation, and match fills each in with the name's address in the original.
//
// It also reads Thumb as a decompilation writes a routine its game has in assembly, which the kit keeps for the
// console's stack (stack-map.mjs): the newer way after `.syntax unified`, where an instruction that sets the flags ends
// in s (adds, movs, lsls) and moving one low register to another is `movs`, a shift of nothing; numbers with no #,
// and names given a number with .equ, .set or .equiv, with sums of them; `ldr rd, =value`, which keeps the value at the
// next .pool, each once, in the order they're first named; `adr rd, label`; and stm and ldm with ! after the register.
// ARM code, after .arm, is assembled as the older way writes it, as a twin's assembly passed through the console's
// compiler has it, a cartridge's start and its interrupt code: branches, bx, the data-processing instructions with a
// number or a register shifted by a number, msr and mrs, and loads and stores of a word, a byte or a halfword with a
// number added (#1721). ARM the assembler doesn't know, and a decompilation's ARM after `.syntax unified`, takes its
// four bytes left as zeros, so what follows is in its place, and `unassembled` says where they are.

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

// the instructions the newer way writes with an s, as the older way writes them
const FLAGGED = new Set(['add', 'sub', 'mov', 'lsl', 'lsr', 'asr', 'ror', 'and', 'orr', 'eor', 'bic', 'mvn', 'neg', 'mul', 'adc', 'sbc']);

/** The number `text` comes to, a sum of numbers and names `constants` gives one, with + - * / << >> & | ^ ~ and
 *  brackets, or null for anything else. */
export function valueOf(text, constants = new Map()) {
  const tokens = text.match(/0x[0-9a-f]+|\d+|[A-Za-z_.$][\w.$]*|<<|>>|[-+*/&|^~()]|\S/gi) ?? [];
  let k = 0;
  const atom = () => {
    const t = tokens[k++];
    if (t === undefined) return null;
    if (t === '(') {
      const v = or();
      return tokens[k++] === ')' ? v : null;
    }
    if (t === '-' || t === '+' || t === '~') {
      const v = atom();
      return v === null ? null : t === '-' ? -v : t === '~' ? ~v : v;
    }
    if (/^(0x[0-9a-f]+|\d+)$/i.test(t)) return Number(t);
    return constants.has(t) ? constants.get(t) : null;
  };
  const level = (next, ops) => () => {
    let v = next();
    while (v !== null && ops[tokens[k]]) {
      const op = ops[tokens[k++]], w = next();
      v = w === null ? null : op(v, w);
    }
    return v;
  };
  const product = level(atom, { '*': (a, b) => a * b, '/': (a, b) => Math.trunc(a / b) });
  const sum = level(product, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const shifted = level(sum, { '<<': (a, b) => a << b, '>>': (a, b) => a >> b });
  const or = level(level(level(shifted, { '&': (a, b) => a & b }), { '^': (a, b) => a ^ b }), { '|': (a, b) => a | b });
  const value = or();
  return value !== null && k === tokens.length ? value : null;
}

/** What `text`, assembly as the compiler writes it, comes to:
 *  { sections: { name: { bytes, lines } }, symbols: Map of name to { section, at, function }, relocations: [{ section,
 *  at, kind: 'word', 'call' or 'arm-branch', name, addend }], sizes: Map of a function's name to its length, unassembled: [{ section,
 *  at, bytes }], the ARM code it left as zeros }. `lines` says which line of the text each byte came from. An error
 *  names the line it couldn't read. */
export function assemble(text) {
  const sections = {}, symbols = new Map(), relocations = [], sizes = new Map(), functions = new Set(), unassembled = [];
  // what waits for every label to be known: a branch, a load from beside the function, a length
  const later = [];
  // the names given a number, the way of writing Thumb, whether the code is ARM, and the values waiting for a .pool
  const constants = new Map();
  let unified = false, arm = false, pool = [], pools = 0;
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
  const evaluate = text => valueOf(text, constants);
  const immediate = text => {
    const written = text.trim(), hashed = written.startsWith('#');
    // the older way always writes the #, and the newer way may leave it out
    const value = hashed ? number(written.slice(1)) ?? (unified ? evaluate(written.slice(1)) : null) : unified ? evaluate(written) : null;
    if (value === null) fail(`"${written}" isn't a number written as #n.`);
    return value;
  };
  const isImmediate = text => text.trim().startsWith('#') || (unified && register(text) === undefined && !/^[[{=]/.test(text.trim()));
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
    if (op === 'ldr' && a.length === 2 && a[1].trim().startsWith('=')) {
      // a value kept at the next .pool, once however many loads name it
      const written = a[1].trim().slice(1).trim(), value = evaluate(written), named = value === null ? expression(written) : { name: null, addend: value };
      const key = named.name === null ? `#${named.addend >>> 0}` : `${named.name}+${named.addend}`;
      let entry = pool.find(each => each.key === key);
      if (!entry) pool.push(entry = { key, ...named, label: `.Lpool${pools}_${pool.length}` });
      later.push({ kind: 'load', section, at: here(), line: lineNumber, rd, name: entry.label, addend: 0 });
      return half(0);
    }
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
    if (op === 'stm' || op === 'ldm') op = `${op}ia`;
    if (unified) {
      // the newer way: an s where the instruction sets the flags, as every Thumb instruction of two low registers does
      const plain = op.endsWith('s') ? op.slice(0, -1) : null;
      if (op === 'adr') {
        const rd = register(a[0] ?? '');
        if (!low(rd) || a.length !== 2) fail('adr needs r0 to r7 and a label.');
        later.push({ kind: 'adr', section, at: here(), line: lineNumber, rd, ...expression(a[1]) });
        return half(0);
      }
      if (plain && FLAGGED.has(plain)) {
        // moving one low register to another is a shift by nothing
        if (plain === 'mov' && a.length === 2 && low(register(a[1]))) return instruction('lsl', [a[0], a[1], '#0']);
        op = plain;
      } else if (op === 'mov' && a.length === 2 && low(register(a[0])) && low(register(a[1]))) {
        fail('a low register moved to another is written movs, or adds of 0, in the newer way.');
      }
    }
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
      // a name given a number is that number
      const known = constants.size || unified ? evaluate(part) : null, value = known === null ? expression(part) : { name: null, addend: known };
      if (value.name) {
        if (size !== 4) fail('a name kept in the code takes a whole word.');
        relocations.push({ section, at: here(), kind: 'word', ...value });
        word(0);
      } else if (size === 4) word(value.addend);
      else if (size === 2) half(value.addend);
      else byte(value.addend);
    }
  };
  // One ARM instruction, written the older way, into its word, or false for one this doesn't know. A branch or a load
  // from a place in the file waits for every label (later), and a branch to a name comes back as a relocation.
  const ARM_CONDITION = '(eq|ne|cs|hs|cc|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al)?';
  const conditionOf = text => (text ? (text === 'al' ? 14 : CONDITIONS[text]) : 14);
  const ARM_DATA = { and: 0, eor: 1, sub: 2, rsb: 3, add: 4, adc: 5, sbc: 6, rsc: 7, tst: 8, teq: 9, cmp: 10, cmn: 11, orr: 12, mov: 13, bic: 14, mvn: 15 };
  // a number as ARM keeps one, 8 bits turned right by twice a 4-bit number, the least turn first, as GNU's assembler
  // chooses
  const rotated = value => {
    value >>>= 0;
    for (let turn = 0; turn < 16; turn++) {
      const bits = turn ? ((value << (2 * turn)) | (value >>> (32 - 2 * turn))) >>> 0 : value;
      if (bits < 256) return turn << 8 | bits;
    }
    return null;
  };
  // a register, or a register shifted by a number: its 12 bits
  const shiftedRegister = parts => {
    const rm = register(parts[0]);
    if (rm === undefined) return null;
    if (parts.length === 1) return rm;
    const m = /^(lsl|lsr|asr|ror)\s+#?(\S+)$/i.exec(parts[1].trim());
    const by = m ? number(m[2]) : null;
    if (!m || by === null || by < 0 || by > 32) return null;
    const type = ['lsl', 'lsr', 'asr', 'ror'].indexOf(m[1].toLowerCase());
    return (by & 31) << 7 | type << 5 | rm;
  };
  // [rn] or [rn, #n], an address with a number added, before: { rn, offset }
  const addressed = text => {
    const m = /^\[\s*([^,\]]+?)\s*(?:,\s*#?([-+]?(?:0x[0-9a-f]+|\d+)))?\s*\]$/i.exec(text.trim());
    if (!m || register(m[1]) === undefined) return null;
    return { rn: register(m[1]), offset: m[2] === undefined ? 0 : number(m[2]) };
  };
  const armInstruction = (op, a) => {
    let m;
    if ((m = new RegExp(`^bx${ARM_CONDITION}$`).exec(op))) {
      const rm = register(a[0] ?? '');
      if (rm === undefined) return false;
      word((conditionOf(m[1]) << 28 | 0x012FFF10 | rm) >>> 0);
      return true;
    }
    if ((m = new RegExp(`^(b|bl)${ARM_CONDITION}$`).exec(op)) && a.length === 1) {
      const code = (conditionOf(m[2]) << 28 | 0x0A000000 | (m[1] === 'bl' ? 0x01000000 : 0)) >>> 0;
      const target = expression(a[0]);
      if (!target.name) return false;
      // to a place in the function, once every label is known, or to a function or a name, which match fills in
      later.push({ kind: 'arm-branch', section, at: here(), code, name: target.name, addend: target.addend, line: lineNumber });
      word(code);
      return true;
    }
    if ((m = new RegExp(`^(${Object.keys(ARM_DATA).join('|')})${ARM_CONDITION}(s?)$`).exec(op))) {
      const opcode = ARM_DATA[m[1]], compares = opcode >= 8 && opcode <= 11, moves = opcode === 13 || opcode === 15;
      const set = compares || m[3] === 's';
      const rd = compares ? 0 : register(a[0] ?? ''), rn = moves ? 0 : register(a[compares ? 0 : 1] ?? '');
      const rest = a.slice(compares || moves ? 1 : 2);
      if (rd === undefined || rn === undefined || !rest.length) return false;
      let operand;
      if (rest.length === 1 && rest[0].trim().startsWith('#')) {
        const value = number(rest[0].trim().slice(1));
        operand = value === null ? null : rotated(value);
        if (operand !== null) operand |= 0x02000000;
      } else operand = shiftedRegister(rest);
      if (operand === null) return false;
      word((conditionOf(m[2]) << 28 | opcode << 21 | (set ? 1 << 20 : 0) | rn << 16 | rd << 12 | operand) >>> 0);
      return true;
    }
    if ((m = new RegExp(`^msr${ARM_CONDITION}$`).exec(op)) && a.length === 2) {
      const f = /^(cpsr|spsr)(?:_([cxsf]+))?$/i.exec(a[0].trim()), rm = register(a[1]);
      if (!f || rm === undefined) return false;
      const mask = f[2] ? [...f[2].toLowerCase()].reduce((bits, c) => bits | { c: 1, x: 2, s: 4, f: 8 }[c], 0) : 9;
      word((conditionOf(m[1]) << 28 | 0x0120F000 | (f[1].toLowerCase() === 'spsr' ? 1 << 22 : 0) | mask << 16 | rm) >>> 0);
      return true;
    }
    if ((m = new RegExp(`^mrs${ARM_CONDITION}$`).exec(op)) && a.length === 2) {
      const rd = register(a[0]), from = a[1].trim().toLowerCase();
      if (rd === undefined || (from !== 'cpsr' && from !== 'spsr')) return false;
      word((conditionOf(m[1]) << 28 | 0x010F0000 | (from === 'spsr' ? 1 << 22 : 0) | rd << 12) >>> 0);
      return true;
    }
    if ((m = new RegExp(`^(ldr|str)${ARM_CONDITION}(b|h)?$`).exec(op)) && a.length === 2) {
      const load = m[1] === 'ldr', rd = register(a[0]), cond = conditionOf(m[2]) << 28;
      if (rd === undefined) return false;
      if (load && !m[3] && a[1].trim().startsWith('=')) {
        const written = a[1].trim().slice(1).trim(), value = evaluate(written), named = value === null ? expression(written) : { name: null, addend: value };
        const key = named.name === null ? `#${named.addend >>> 0}` : `${named.name}+${named.addend}`;
        let entry = pool.find(each => each.key === key);
        if (!entry) pool.push(entry = { key, ...named, label: `.Lpool${pools}_${pool.length}` });
        later.push({ kind: 'arm-load', section, at: here(), code: (cond | 0x059F0000 | rd << 12) >>> 0, name: entry.label, addend: 0, line: lineNumber });
        word(0);
        return true;
      }
      const at = addressed(a[1]);
      if (!at || at.offset === null) return false;
      const up = at.offset >= 0, by = Math.abs(at.offset);
      if (m[3] === 'h') {
        if (by > 255) return false;
        word((cond | 0x014000B0 | (up ? 1 << 23 : 0) | (load ? 1 << 20 : 0) | at.rn << 16 | rd << 12 | (by & 0xF0) << 4 | (by & 0xF)) >>> 0);
        return true;
      }
      if (by > 4095) return false;
      word((cond | 0x05000000 | (up ? 1 << 23 : 0) | (m[3] === 'b' ? 1 << 22 : 0) | (load ? 1 << 20 : 0) | at.rn << 16 | rd << 12 | by) >>> 0);
      return true;
    }
    return false;
  };

  // ARM code from here, which GNU's assembler lines up on a word, with two bytes this leaves out too
  const toArm = () => {
    arm = true;
    if (here() % 4) {
      unassembled.push({ section, at: here(), bytes: 2 });
      half(0);
    }
    return null;
  };
  // the values `ldr rd, =value` named since the last pool, on a word each, where the loads find them
  const putPool = () => {
    if (!pool.length) return null;
    while (here() % 4) byte(0);
    for (const entry of pool) {
      symbols.set(entry.label, { section, at: here() });
      data(4, [entry.name === null ? String(entry.addend >>> 0) : `${entry.name}+${entry.addend}`]);
    }
    pool = [];
    pools++;
    return null;
  };
  const directive = (name, rest) => {
    const a = split(rest);
    switch (name) {
      case '.text': case '.data': case '.bss': return into(name);
      case '.section': return into(a[0]);
      case '.code':
        if (a[0] !== '16' && a[0] !== '32') fail('code is .code 16, Thumb, or .code 32, ARM.');
        return a[0] === '32' ? toArm() : (arm = false, null);
      case '.thumb': arm = false; return null;
      case '.arm': return toArm();
      case '.syntax':
        if (a[0] !== 'unified' && a[0] !== 'divided') fail('.syntax is unified or divided.');
        unified = a[0] === 'unified';
        return null;
      case '.equ': case '.set': case '.equiv': {
        const value = evaluate(a.slice(1).join(','));
        if (a.length < 2 || !/^[A-Za-z_.$][\w.$]*$/.test(a[0]) || value === null) fail(`${name} needs a name and a number, and "${rest}" isn't.`);
        if (name === '.equiv' && constants.has(a[0])) fail(`${a[0]} is given a number twice.`);
        constants.set(a[0], value);
        return null;
      }
      case '.pool': case '.ltorg': return putPool();
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
        // `.` is here, as a decompilation writes a function's length
        if (m?.[1] === '.') {
          const start = symbols.get(m[2]);
          if (start?.section === section) sizes.set(a[0], here() - start.at);
        } else if (m) later.push({ kind: 'size', of: a[0], end: m[1], start: m[2], line: lineNumber });
        return null;
      }
      // a value of the file's own with no place in it: match finds its address by its name
      case '.comm': case '.lcomm': case '.globl': case '.global': case '.ident': case '.file': return null;
      default: return fail(`the tools' assembler doesn't know "${name}", which the console's compiler isn't known to write.`);
    }
  };

  // agbcc built for Windows ends each line with \r\n, as a program there does in a file it writes as text
  for (const raw of text.split(/\r?\n/)) {
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
    else if (arm) {
      // ARM code takes its place, and only the values it keeps at a .pool are read
      if (here() % 4) fail('an ARM instruction at an address that isn\'t a multiple of 4.');
      const a = split(m[2]);
      if (!unified && armInstruction(m[1].toLowerCase(), a)) continue;
      if (/^ldr/i.test(m[1]) && a[1]?.trim().startsWith('=')) {
        const written = a[1].trim().slice(1).trim(), value = evaluate(written), named = value === null ? expression(written) : { name: null, addend: value };
        const key = named.name === null ? `#${named.addend >>> 0}` : `${named.name}+${named.addend}`;
        if (!pool.some(each => each.key === key)) pool.push({ key, ...named, label: `.Lpool${pools}_${pool.length}` });
      }
      unassembled.push({ section, at: here(), bytes: 4 });
      word(0);
    } else {
      if (here() % 2) fail('an instruction at an odd address.');
      instruction(m[1].toLowerCase(), split(m[2]));
    }
  }
  // what no .pool took, at the end, as GNU's assembler keeps it
  putPool();

  for (const wait of later) {
    lineNumber = wait.line;
    if (wait.kind === 'size') {
      const end = symbols.get(wait.end), start = symbols.get(wait.start);
      if (end && start && end.section === start.section) sizes.set(wait.of, end.at - start.at);
      continue;
    }
    const target = symbols.get(wait.name);
    // a branch to a function, which match places where the original has it, or to a name the file doesn't have
    if ((!target || functions.has(wait.name)) && wait.kind === 'arm-branch') {
      relocations.push({ section: wait.section, at: wait.at, kind: 'arm-branch', name: wait.name, addend: wait.addend });
      continue;
    }
    if (!target || target.section !== wait.section) fail(`${wait.name} isn't a place in this part of the file, and a ${wait.kind === 'branch' ? 'branch' : wait.kind} only reaches one.`);
    const bytes = sections[wait.section].bytes, to = target.at + wait.addend;
    if (wait.kind === 'arm-branch' || wait.kind === 'arm-load') {
      // from the instruction two on, as ARM reads the program counter
      const offset = to - (wait.at + 8);
      let code;
      if (wait.kind === 'arm-branch') {
        if (offset % 4 || offset < -0x2000000 || offset >= 0x2000000) fail(`a branch to ${wait.name} is ${offset} bytes away, too far for it.`);
        code = (wait.code | (offset >> 2 & 0xFFFFFF)) >>> 0;
      } else {
        if (offset < 0 || offset > 4095) fail(`a load from ${wait.name} is ${offset} bytes away, too far for it.`);
        code = (wait.code | 1 << 23 | offset) >>> 0;
      }
      for (let i = 0; i < 4; i++) bytes[wait.at + i] = code >>> 8 * i & 255;
      continue;
    }
    let code;
    if (wait.kind === 'load') {
      // from the word the instruction after next is in
      const offset = to - ((wait.at + 4) & ~3);
      code = 0x4800 | wait.rd << 8 | within(offset, 1020, `a load from ${wait.name}`, 4);
    } else if (wait.kind === 'adr') {
      // an address on from the word the instruction after next is in, as an add to pc
      const offset = to - ((wait.at + 4) & ~3);
      code = 0xA000 | wait.rd << 8 | within(offset, 1020, `adr to ${wait.name}`, 4);
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
  return { sections, symbols, relocations, sizes, unassembled, constants };
}
