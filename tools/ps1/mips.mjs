// The PlayStation's processor, the MIPS R3000A, as the tools read it: every instruction it has, with the geometry
// processor's commands and its coprocessor 0's, from a table of the tools' own, as the set is fixed and small and
// nothing has to be built. `read` prints a game's function with it (read.mjs), the function finder tells code from
// values with it (functions.mjs), and the function check knows which instructions branch (twin.mjs).
//
// Each instruction is written as GNU's assembler and objdump write MIPS: registers by their names, as `$sp`, a load's
// or a store's place as an offset from a register, as `16($sp)`, a branch's or a jump's target as the address it goes
// to, and the usual short forms: `nop`, `move`, `li`, `b`, `beqz` and `bnez`.

/** The registers by the names MIPS code gives them, in the processor's order. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'];
// coprocessor 0's registers a game's code meets, by number
const COP0 = { 3: 'BPC', 5: 'BDA', 6: 'JUMPDEST', 7: 'DCIC', 8: 'BadVaddr', 9: 'BDAM', 11: 'BPCM', 12: 'SR', 13: 'Cause', 14: 'EPC', 15: 'PRId' };
// the geometry processor's commands, by their lowest six bits
const GTE = { 0x01: 'rtps', 0x06: 'nclip', 0x0C: 'op', 0x10: 'dpcs', 0x11: 'intpl', 0x12: 'mvmva', 0x13: 'ncds', 0x14: 'cdp', 0x16: 'ncdt',
  0x1B: 'nccs', 0x1C: 'cc', 0x1E: 'ncs', 0x20: 'nct', 0x28: 'sqr', 0x29: 'dcpl', 0x2A: 'dpct', 0x2D: 'avsz3', 0x2E: 'avsz4', 0x30: 'rtpt',
  0x3D: 'gpf', 0x3E: 'gpl', 0x3F: 'ncct' };

const SPECIAL = {
  0: ['sll', 'shift'], 2: ['srl', 'shift'], 3: ['sra', 'shift'], 4: ['sllv', 'shiftv'], 6: ['srlv', 'shiftv'], 7: ['srav', 'shiftv'],
  8: ['jr', 'jr'], 9: ['jalr', 'jalr'], 12: ['syscall', 'code'], 13: ['break', 'code'],
  16: ['mfhi', 'rd'], 17: ['mthi', 'rs'], 18: ['mflo', 'rd'], 19: ['mtlo', 'rs'],
  24: ['mult', 'rs,rt'], 25: ['multu', 'rs,rt'], 26: ['div', 'rs,rt'], 27: ['divu', 'rs,rt'],
  32: ['add', 'rd,rs,rt'], 33: ['addu', 'rd,rs,rt'], 34: ['sub', 'rd,rs,rt'], 35: ['subu', 'rd,rs,rt'],
  36: ['and', 'rd,rs,rt'], 37: ['or', 'rd,rs,rt'], 38: ['xor', 'rd,rs,rt'], 39: ['nor', 'rd,rs,rt'], 42: ['slt', 'rd,rs,rt'], 43: ['sltu', 'rd,rs,rt'],
};
const REGIMM = { 0: 'bltz', 1: 'bgez', 16: 'bltzal', 17: 'bgezal' };
const PRIMARY = {
  2: ['j', 'jump'], 3: ['jal', 'jump'], 4: ['beq', 'rs,rt,branch'], 5: ['bne', 'rs,rt,branch'], 6: ['blez', 'rs,branch'], 7: ['bgtz', 'rs,branch'],
  8: ['addi', 'rt,rs,signed'], 9: ['addiu', 'rt,rs,signed'], 10: ['slti', 'rt,rs,signed'], 11: ['sltiu', 'rt,rs,signed'],
  12: ['andi', 'rt,rs,unsigned'], 13: ['ori', 'rt,rs,unsigned'], 14: ['xori', 'rt,rs,unsigned'], 15: ['lui', 'rt,unsigned'],
  32: ['lb', 'load'], 33: ['lh', 'load'], 34: ['lwl', 'load'], 35: ['lw', 'load'], 36: ['lbu', 'load'], 37: ['lhu', 'load'], 38: ['lwr', 'load'],
  40: ['sb', 'store'], 41: ['sh', 'store'], 42: ['swl', 'store'], 43: ['sw', 'store'], 46: ['swr', 'store'],
  50: ['lwc2', 'load2'], 58: ['swc2', 'store2'],
};

const r = n => `$${REGISTERS[n]}`;
const hexOf = n => `0x${(n >>> 0).toString(16).toUpperCase()}`;

/**
 * The instruction a word makes at `address`, or null when it's none of the R3000A's:
 *   { name, text, kind, rs, rt, rd, writes, imm, target, bytes }
 * `kind` is 'branch' for a branch that may or may not go, 'jump' for one that always goes, 'call' for a call,
 * 'return' for `jr $ra`, 'switch' for a `jr` through any other register, 'load' or 'store' with how many `bytes`, 'gte'
 * for the geometry processor's own, 'trap' for syscall and break, and 'other'. `target` is where a branch, a jump or
 * a call goes, `imm` a number it holds, with its sign where the processor gives it one, and `writes` the register it
 * writes, or null for none, as a store, a branch or one that writes only hi and lo.
 */
export function decode(word, address = 0) {
  word >>>= 0;
  const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, rd = (word >>> 11) & 31, sa = (word >>> 6) & 31, fn = word & 63;
  const imm = (word << 16) >> 16, unsignedImm = word & 0xFFFF;
  const branchTo = (address + 4 + imm * 4) >>> 0;
  const made = (name, text, kind = 'other', more = {}) => ({ name, text: text ? `${name.padEnd(7)} ${text}` : name, kind, rs, rt, rd, ...more, writes: more.writes || null });

  if (op === 0) {
    const found = SPECIAL[fn];
    if (!found) return null;
    const [name, form] = found;
    if (word === 0) return made('nop', '');
    if (form === 'shift') return made(name, `${r(rd)}, ${r(rt)}, ${sa}`, 'other', { writes: rd });
    if (form === 'shiftv') return made(name, `${r(rd)}, ${r(rt)}, ${r(rs)}`, 'other', { writes: rd });
    if (form === 'jr') return made(name, r(rs), rs === 31 ? 'return' : 'switch');
    if (form === 'jalr') return made(name, rd === 31 ? r(rs) : `${r(rd)}, ${r(rs)}`, 'call', { writes: rd });
    if (form === 'code') return made(name, (word >>> 6) & 0xFFFFF ? hexOf((word >>> 6) & 0xFFFFF) : '', 'trap');
    if (form === 'rd') return made(name, r(rd), 'other', { writes: rd });
    if (form === 'rs') return made(name, r(rs));
    if (form === 'rs,rt') return made(name, `${r(rs)}, ${r(rt)}`);
    if ((name === 'addu' || name === 'or') && rt === 0) return made('move', `${r(rd)}, ${r(rs)}`, 'other', { writes: rd });
    return made(name, `${r(rd)}, ${r(rs)}, ${r(rt)}`, 'other', { writes: rd });
  }
  if (op === 1) {
    const name = REGIMM[rt];
    if (!name) return null;
    if (name === 'bgezal' && rs === 0) return made('bal', hexOf(branchTo), 'call', { target: branchTo, writes: 31 });
    return made(name, `${r(rs)}, ${hexOf(branchTo)}`, name.endsWith('al') ? 'call' : 'branch', { target: branchTo, writes: name.endsWith('al') ? 31 : null });
  }
  if (op === 16) {
    if (rs === 0) return made('mfc0', `${r(rt)}, ${COP0[rd] ?? `$${rd}`}`, 'other', { writes: rt });
    if (rs === 4) return made('mtc0', `${r(rt)}, ${COP0[rd] ?? `$${rd}`}`);
    if (rs === 16 && fn === 16) return made('rfe', '');
    return null;
  }
  if (op === 18) {
    if (rs === 0) return made('mfc2', `${r(rt)}, $${rd}`, 'gte', { writes: rt });
    if (rs === 2) return made('cfc2', `${r(rt)}, $${rd}`, 'gte', { writes: rt });
    if (rs === 4) return made('mtc2', `${r(rt)}, $${rd}`, 'gte');
    if (rs === 6) return made('ctc2', `${r(rt)}, $${rd}`, 'gte');
    if (rs >= 16) {
      const command = word & 0x1FFFFFF, name = GTE[fn];
      const fields = `sf=${(command >>> 19) & 1} lm=${(command >>> 10) & 1}`;
      if (!name) return made('cop2', hexOf(command), 'gte');
      return made(name, name === 'mvmva' ? `${fields} mx=${(command >>> 17) & 3} v=${(command >>> 15) & 3} cv=${(command >>> 13) & 3}` : fields, 'gte');
    }
    return null;
  }
  const found = PRIMARY[op];
  if (!found) return null;
  const [name, form] = found;
  if (form === 'jump') {
    const target = ((address + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0;
    return made(name, hexOf(target), name === 'jal' ? 'call' : 'jump', { target, writes: name === 'jal' ? 31 : null });
  }
  if (form === 'rs,rt,branch') {
    if (name === 'beq' && rs === 0 && rt === 0) return made('b', hexOf(branchTo), 'jump', { target: branchTo });
    if (rt === 0) return made(`${name}z`, `${r(rs)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo });
    return made(name, `${r(rs)}, ${r(rt)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo });
  }
  if (form === 'rs,branch') return made(name, `${r(rs)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo });
  if (form === 'rt,rs,signed') {
    if (name === 'addiu' && rs === 0) return made('li', `${r(rt)}, ${imm}`, 'other', { imm, writes: rt });
    return made(name, `${r(rt)}, ${r(rs)}, ${imm}`, 'other', { imm, writes: rt });
  }
  if (form === 'rt,rs,unsigned') {
    if (name === 'ori' && rs === 0) return made('li', `${r(rt)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
    return made(name, `${r(rt)}, ${r(rs)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
  }
  if (form === 'rt,unsigned') return made(name, `${r(rt)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
  const bytes = { lb: 1, lbu: 1, sb: 1, lh: 2, lhu: 2, sh: 2 }[name] ?? 4;
  const place = `${imm}(${r(rs)})`;
  if (form === 'load') return made(name, `${r(rt)}, ${place}`, 'load', { imm, bytes, writes: rt });
  if (form === 'store') return made(name, `${r(rt)}, ${place}`, 'store', { imm, bytes });
  return made(name, `$${rt}, ${place}`, form === 'load2' ? 'load' : 'store', { imm, bytes, gte: true });
}

/** Whether a word is one of the R3000A's instructions. */
export const isInstruction = word => decode(word) !== null;

/** Whether an instruction's kind goes elsewhere for good once its delay slot has run: a return, a jump, a switch. */
export const goesAway = kind => kind === 'return' || kind === 'jump' || kind === 'switch';

