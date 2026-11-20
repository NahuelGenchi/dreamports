// The MIPS processors of the consoles the tools know, as the tools read them, from tables of the tools' own, as each set
// is fixed and small and nothing has to be built: the PlayStation's MIPS R3000A, with the geometry processor's commands
// and its coprocessor 0's, and the Nintendo 64's NEC VR4300, MIPS III, with its 64-bit instructions, its likely
// branches, its traps, its coprocessor 0 with the TLB's instructions, and its floating-point unit. `processor` says
// which, 'r3000a' unless named, and an instruction the processor doesn't have is none. `read` prints a game's function
// with it (../ps1/read.mjs), the function finder tells code from values with it (mips-functions.mjs), and the function
// check knows which instructions branch (../ps1/twin.mjs). The PlayStation's tools take it through ../ps1/mips.mjs.
//
// Each instruction is written as GNU's assembler and objdump write MIPS: registers by their names, as `$sp`, the
// floating-point unit's as `$f4`, a load's or a store's place as an offset from a register, as `16($sp)`, a branch's or
// a jump's target as the address it goes to, and the usual short forms: `nop`, `move`, `li`, `b`, `beqz` and `bnez`, and
// on the VR4300 `beqzl` and `bnezl`. The PlayStation's assembler encodes with the same tables (../ps1/assemble.mjs), so
// what one writes the other reads back.

/** The registers by the names MIPS code gives them, in the processor's order. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'];
// coprocessor 0's registers a PlayStation game's code meets, by number
export const COP0 = { 3: 'BPC', 5: 'BDA', 6: 'JUMPDEST', 7: 'DCIC', 8: 'BadVaddr', 9: 'BDAM', 11: 'BPCM', 12: 'SR', 13: 'Cause', 14: 'EPC', 15: 'PRId' };
// and the VR4300's, by the names its manual gives them
export const COP0_VR4300 = { 0: 'Index', 1: 'Random', 2: 'EntryLo0', 3: 'EntryLo1', 4: 'Context', 5: 'PageMask', 6: 'Wired', 8: 'BadVAddr', 9: 'Count',
  10: 'EntryHi', 11: 'Compare', 12: 'Status', 13: 'Cause', 14: 'EPC', 15: 'PRId', 16: 'Config', 17: 'LLAddr', 18: 'WatchLo', 19: 'WatchHi', 20: 'XContext',
  26: 'PErr', 27: 'CacheErr', 28: 'TagLo', 29: 'TagHi', 30: 'ErrorEPC' };
// the geometry processor's commands, by their lowest six bits
export const GTE = { 0x01: 'rtps', 0x06: 'nclip', 0x0C: 'op', 0x10: 'dpcs', 0x11: 'intpl', 0x12: 'mvmva', 0x13: 'ncds', 0x14: 'cdp', 0x16: 'ncdt',
  0x1B: 'nccs', 0x1C: 'cc', 0x1E: 'ncs', 0x20: 'nct', 0x28: 'sqr', 0x29: 'dcpl', 0x2A: 'dpct', 0x2D: 'avsz3', 0x2E: 'avsz4', 0x30: 'rtpt',
  0x3D: 'gpf', 0x3E: 'gpl', 0x3F: 'ncct' };

// The R3000A's instructions, which the VR4300 has too, but for the geometry processor's loads and stores.
export const SPECIAL = {
  0: ['sll', 'shift'], 2: ['srl', 'shift'], 3: ['sra', 'shift'], 4: ['sllv', 'shiftv'], 6: ['srlv', 'shiftv'], 7: ['srav', 'shiftv'],
  8: ['jr', 'jr'], 9: ['jalr', 'jalr'], 12: ['syscall', 'code'], 13: ['break', 'code'],
  16: ['mfhi', 'rd'], 17: ['mthi', 'rs'], 18: ['mflo', 'rd'], 19: ['mtlo', 'rs'],
  24: ['mult', 'rs,rt'], 25: ['multu', 'rs,rt'], 26: ['div', 'rs,rt'], 27: ['divu', 'rs,rt'],
  32: ['add', 'rd,rs,rt'], 33: ['addu', 'rd,rs,rt'], 34: ['sub', 'rd,rs,rt'], 35: ['subu', 'rd,rs,rt'],
  36: ['and', 'rd,rs,rt'], 37: ['or', 'rd,rs,rt'], 38: ['xor', 'rd,rs,rt'], 39: ['nor', 'rd,rs,rt'], 42: ['slt', 'rd,rs,rt'], 43: ['sltu', 'rd,rs,rt'],
};
export const REGIMM = { 0: 'bltz', 1: 'bgez', 16: 'bltzal', 17: 'bgezal' };
export const PRIMARY = {
  2: ['j', 'jump'], 3: ['jal', 'jump'], 4: ['beq', 'rs,rt,branch'], 5: ['bne', 'rs,rt,branch'], 6: ['blez', 'rs,branch'], 7: ['bgtz', 'rs,branch'],
  8: ['addi', 'rt,rs,signed'], 9: ['addiu', 'rt,rs,signed'], 10: ['slti', 'rt,rs,signed'], 11: ['sltiu', 'rt,rs,signed'],
  12: ['andi', 'rt,rs,unsigned'], 13: ['ori', 'rt,rs,unsigned'], 14: ['xori', 'rt,rs,unsigned'], 15: ['lui', 'rt,unsigned'],
  32: ['lb', 'load'], 33: ['lh', 'load'], 34: ['lwl', 'load'], 35: ['lw', 'load'], 36: ['lbu', 'load'], 37: ['lhu', 'load'], 38: ['lwr', 'load'],
  40: ['sb', 'store'], 41: ['sh', 'store'], 42: ['swl', 'store'], 43: ['sw', 'store'], 46: ['swr', 'store'],
  50: ['lwc2', 'load2'], 58: ['swc2', 'store2'],
};

// What MIPS III adds, which the VR4300 has: 64-bit sums, shifts, multiplies and divides, traps and sync
export const SPECIAL_III = {
  15: ['sync', 'none'], 20: ['dsllv', 'shiftv'], 22: ['dsrlv', 'shiftv'], 23: ['dsrav', 'shiftv'],
  28: ['dmult', 'rs,rt'], 29: ['dmultu', 'rs,rt'], 30: ['ddiv', 'rs,rt'], 31: ['ddivu', 'rs,rt'],
  44: ['dadd', 'rd,rs,rt'], 45: ['daddu', 'rd,rs,rt'], 46: ['dsub', 'rd,rs,rt'], 47: ['dsubu', 'rd,rs,rt'],
  48: ['tge', 'trap'], 49: ['tgeu', 'trap'], 50: ['tlt', 'trap'], 51: ['tltu', 'trap'], 52: ['teq', 'trap'], 54: ['tne', 'trap'],
  56: ['dsll', 'shift'], 58: ['dsrl', 'shift'], 59: ['dsra', 'shift'], 60: ['dsll32', 'shift'], 62: ['dsrl32', 'shift'], 63: ['dsra32', 'shift'],
};
// likely branches, which run their delay slot only when they go, and traps against a number
export const REGIMM_III = { 2: 'bltzl', 3: 'bgezl', 8: 'tgei', 9: 'tgeiu', 10: 'tlti', 11: 'tltiu', 12: 'teqi', 14: 'tnei', 18: 'bltzall', 19: 'bgezall' };
export const PRIMARY_III = {
  20: ['beql', 'rs,rt,branch'], 21: ['bnel', 'rs,rt,branch'], 22: ['blezl', 'rs,branch'], 23: ['bgtzl', 'rs,branch'],
  24: ['daddi', 'rt,rs,signed'], 25: ['daddiu', 'rt,rs,signed'], 26: ['ldl', 'load'], 27: ['ldr', 'load'], 39: ['lwu', 'load'],
  44: ['sdl', 'store'], 45: ['sdr', 'store'], 47: ['cache', 'cache'], 48: ['ll', 'load'], 49: ['lwc1', 'loadf'], 52: ['lld', 'load'],
  53: ['ldc1', 'loadf'], 55: ['ld', 'load'], 56: ['sc', 'load'], 57: ['swc1', 'storef'], 60: ['scd', 'load'], 61: ['sdc1', 'storef'], 63: ['sd', 'store'],
};
// the TLB's instructions and the return from an exception, in coprocessor 0, by their lowest six bits
export const COP0_III = { 1: 'tlbr', 2: 'tlbwi', 6: 'tlbwr', 8: 'tlbp', 24: 'eret' };
// the floating-point unit's sums, by their lowest six bits, for singles and doubles, and the formats it works in
export const FLOAT = {
  0: ['add', 'fd,fs,ft'], 1: ['sub', 'fd,fs,ft'], 2: ['mul', 'fd,fs,ft'], 3: ['div', 'fd,fs,ft'], 4: ['sqrt', 'fd,fs'], 5: ['abs', 'fd,fs'], 6: ['mov', 'fd,fs'], 7: ['neg', 'fd,fs'],
  8: ['round.l', 'fd,fs'], 9: ['trunc.l', 'fd,fs'], 10: ['ceil.l', 'fd,fs'], 11: ['floor.l', 'fd,fs'], 12: ['round.w', 'fd,fs'], 13: ['trunc.w', 'fd,fs'], 14: ['ceil.w', 'fd,fs'], 15: ['floor.w', 'fd,fs'],
  32: ['cvt.s', 'fd,fs'], 33: ['cvt.d', 'fd,fs'], 36: ['cvt.w', 'fd,fs'], 37: ['cvt.l', 'fd,fs'],
};
export const COMPARES = ['f', 'un', 'eq', 'ueq', 'olt', 'ult', 'ole', 'ule', 'sf', 'ngle', 'seq', 'ngl', 'lt', 'nge', 'le', 'ngt'];
export const FORMATS = { 16: 's', 17: 'd', 20: 'w', 21: 'l' };

// The Nintendo 64's RSP, the processor beside the VR4300 that runs the programs a game gives it, its microcode: a 32-bit
// MIPS without multiplies, divides, 64-bit sums or likely branches, which runs from its own 4 KB of instructions, with
// coprocessor 0 for its own registers and the RDP's, and its vector unit, coprocessor 2, with its own loads and stores.
// coprocessor 0's registers, by number, as the RSP's manual names them
export const COP0_RSP = ['SP_MEM_ADDR', 'SP_DRAM_ADDR', 'SP_RD_LEN', 'SP_WR_LEN', 'SP_STATUS', 'SP_DMA_FULL', 'SP_DMA_BUSY', 'SP_SEMAPHORE',
  'DPC_START', 'DPC_END', 'DPC_CURRENT', 'DPC_STATUS', 'DPC_CLOCK', 'DPC_BUFBUSY', 'DPC_PIPEBUSY', 'DPC_TMEM'];
// the vector unit's instructions, by their lowest six bits, and those that work on one element of a register
export const VECTOR = { 0: 'vmulf', 1: 'vmulu', 2: 'vrndp', 3: 'vmulq', 4: 'vmudl', 5: 'vmudm', 6: 'vmudn', 7: 'vmudh', 8: 'vmacf', 9: 'vmacu',
  10: 'vrndn', 11: 'vmacq', 12: 'vmadl', 13: 'vmadm', 14: 'vmadn', 15: 'vmadh', 16: 'vadd', 17: 'vsub', 19: 'vabs', 20: 'vaddc', 21: 'vsubc', 29: 'vsar',
  32: 'vlt', 33: 'veq', 34: 'vne', 35: 'vge', 36: 'vcl', 37: 'vch', 38: 'vcr', 39: 'vmrg', 40: 'vand', 41: 'vnand', 42: 'vor', 43: 'vnor', 44: 'vxor', 45: 'vnxor',
  48: 'vrcp', 49: 'vrcpl', 50: 'vrcph', 51: 'vmov', 52: 'vrsq', 53: 'vrsql', 54: 'vrsqh', 55: 'vnop' };
const ONE_ELEMENT = new Set(['vrcp', 'vrcpl', 'vrcph', 'vmov', 'vrsq', 'vrsql', 'vrsqh']);
// the vector unit's loads and stores, by the field after their register, with how many bytes the offset counts in
export const VECTOR_LOADS = { 0: ['lbv', 1], 1: ['lsv', 2], 2: ['llv', 4], 3: ['ldv', 8], 4: ['lqv', 16], 5: ['lrv', 16], 6: ['lpv', 8], 7: ['luv', 8], 8: ['lhv', 16], 9: ['lfv', 16], 11: ['ltv', 16] };
export const VECTOR_STORES = { 0: ['sbv', 1], 1: ['ssv', 2], 2: ['slv', 4], 3: ['sdv', 8], 4: ['sqv', 16], 5: ['srv', 16], 6: ['spv', 8], 7: ['suv', 8], 8: ['shv', 16], 9: ['sfv', 16], 10: ['swv', 16], 11: ['stv', 16] };
const RSP_SPECIAL = new Set([0, 2, 3, 4, 6, 7, 8, 9, 13, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43]);
const RSP_PRIMARY = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 32, 33, 35, 36, 37, 40, 41, 43]);

/** The processors this reads, by the name `processor` takes. */
export const PROCESSORS = ['r3000a', 'vr4300', 'rsp'];

const r = n => `$${REGISTERS[n]}`;
const f = n => `$f${n}`;
const hexOf = n => `0x${(n >>> 0).toString(16).toUpperCase()}`;
const BYTES = { lb: 1, lbu: 1, sb: 1, lh: 2, lhu: 2, sh: 2, ld: 8, ldl: 8, ldr: 8, lld: 8, scd: 8, sd: 8, sdl: 8, sdr: 8, ldc1: 8, sdc1: 8 };

/**
 * The instruction a word makes at `address`, or null when it's none of `processor`'s:
 *   { name, text, kind, rs, rt, rd, writes, imm, target, bytes, likely }
 * `kind` is 'branch' for a branch that may or may not go, 'jump' for one that always goes, 'call' for a call,
 * 'return' for `jr $ra`, 'switch' for a `jr` through any other register, 'eret' for a return from an exception, which
 * has no delay slot, 'load' or 'store' with how many `bytes`, 'gte' for the PlayStation's geometry processor's own,
 * 'float' for the floating-point unit's sums and moves, 'trap' for syscall, break and the traps, and 'other'. `target`
 * is where a branch, a jump or a call goes, `likely` says a branch runs its delay slot only when it goes, `imm` a number
 * it holds, with its sign where the processor gives it one, and `writes` the general register it writes, or null for
 * none, as a store, a branch or one that writes only hi and lo or the floating-point unit's registers.
 */
export function decode(word, address = 0, processor = 'r3000a') {
  word >>>= 0;
  if (processor === 'rsp') return decodeRsp(word, address);
  const iii = processor === 'vr4300';
  const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, rd = (word >>> 11) & 31, sa = (word >>> 6) & 31, fn = word & 63;
  const imm = (word << 16) >> 16, unsignedImm = word & 0xFFFF;
  const branchTo = (address + 4 + imm * 4) >>> 0;
  const made = (name, text, kind = 'other', more = {}) => ({ name, text: text ? `${name.padEnd(7)} ${text}` : name, kind, rs, rt, rd, ...more, writes: more.writes || null });

  if (op === 0) {
    const found = SPECIAL[fn] ?? (iii ? SPECIAL_III[fn] : undefined);
    if (!found) return null;
    const [name, form] = found;
    if (iii && !keepsZero(form, word, rs, rt, rd, sa)) return null;
    if (word === 0) return made('nop', '');
    if (form === 'shift') return made(name, `${r(rd)}, ${r(rt)}, ${sa}`, 'other', { writes: rd });
    if (form === 'shiftv') return made(name, `${r(rd)}, ${r(rt)}, ${r(rs)}`, 'other', { writes: rd });
    if (form === 'jr') return made(name, r(rs), rs === 31 ? 'return' : 'switch');
    if (form === 'jalr') return made(name, rd === 31 ? r(rs) : `${r(rd)}, ${r(rs)}`, 'call', { writes: rd });
    // a break's code is in two fields, as GNU's tools write it, and a syscall's in one
    if (form === 'code' && name === 'break') {
      const [high, low] = [(word >>> 16) & 0x3FF, (word >>> 6) & 0x3FF];
      return made(name, high || low ? `${hexOf(high)}${low ? `, ${hexOf(low)}` : ''}` : '', 'trap');
    }
    if (form === 'code') return made(name, (word >>> 6) & 0xFFFFF ? hexOf((word >>> 6) & 0xFFFFF) : '', 'trap');
    // a trap's code, which only an exception's handler reads, after its two registers
    if (form === 'trap') return made(name, `${r(rs)}, ${r(rt)}${(word >>> 6) & 0x3FF ? `, ${hexOf((word >>> 6) & 0x3FF)}` : ''}`, 'trap');
    if (form === 'none') return made(name, sa ? `${sa}` : '');
    if (form === 'rd') return made(name, r(rd), 'other', { writes: rd });
    if (form === 'rs') return made(name, r(rs));
    if (form === 'rs,rt') return made(name, `${r(rs)}, ${r(rt)}`);
    if ((name === 'addu' || name === 'or') && rt === 0) return made('move', `${r(rd)}, ${r(rs)}`, 'other', { writes: rd });
    return made(name, `${r(rd)}, ${r(rs)}, ${r(rt)}`, 'other', { writes: rd });
  }
  if (op === 1) {
    const name = REGIMM[rt] ?? (iii ? REGIMM_III[rt] : undefined);
    if (!name) return null;
    if (name.startsWith('t')) return made(name, `${r(rs)}, ${imm}`, 'trap', { imm });
    const likely = rt === 2 || rt === 3 || rt === 18 || rt === 19;
    if (name === 'bgezal' && rs === 0) return made('bal', hexOf(branchTo), 'call', { target: branchTo, writes: 31 });
    const calls = name.includes('al');
    return made(name, `${r(rs)}, ${hexOf(branchTo)}`, calls ? 'call' : 'branch', { target: branchTo, writes: calls ? 31 : null, ...(likely && { likely }) });
  }
  if (op === 16) {
    const names = iii ? COP0_VR4300 : COP0;
    if (iii && rs !== 16 && (word & 0x7FF)) return null;
    if (rs === 0) return made('mfc0', `${r(rt)}, ${names[rd] ?? `$${rd}`}`, 'other', { writes: rt });
    if (rs === 4) return made('mtc0', `${r(rt)}, ${names[rd] ?? `$${rd}`}`);
    if (iii && rs === 1) return made('dmfc0', `${r(rt)}, ${names[rd] ?? `$${rd}`}`, 'other', { writes: rt });
    if (iii && rs === 5) return made('dmtc0', `${r(rt)}, ${names[rd] ?? `$${rd}`}`);
    if (!iii && rs === 16 && fn === 16) return made('rfe', '');
    if (iii && rs === 16 && COP0_III[fn] && !(word & 0x1FFFFC0)) return made(COP0_III[fn], '', fn === 24 ? 'eret' : 'other');
    return null;
  }
  if (op === 17 && iii) return decodeFloat(word, address, made, { rs, rt, rd, sa, fn, branchTo });
  if (op === 18 && !iii) {
    if (rs === 0) return made('mfc2', `${r(rt)}, $${rd}`, 'gte', { writes: rt });
    if (rs === 2) return made('cfc2', `${r(rt)}, $${rd}`, 'gte', { writes: rt });
    if (rs === 4) return made('mtc2', `${r(rt)}, $${rd}`, 'gte');
    if (rs === 6) return made('ctc2', `${r(rt)}, $${rd}`, 'gte');
    if (rs >= 16) {
      // the whole command first, as games give it with bits the processor ignores, and then what its fields say
      const command = word & 0x1FFFFFF, name = GTE[fn];
      const fields = `sf=${(command >>> 19) & 1} lm=${(command >>> 10) & 1}`;
      if (!name) return made('cop2', hexOf(command), 'gte');
      return made(name, `${hexOf(command)} ${name === 'mvmva' ? `${fields} mx=${(command >>> 17) & 3} v=${(command >>> 15) & 3} cv=${(command >>> 13) & 3}` : fields}`, 'gte');
    }
    return null;
  }
  const found = (iii && (op === 50 || op === 58)) ? undefined : PRIMARY[op] ?? (iii ? PRIMARY_III[op] : undefined);
  if (!found) return null;
  const [name, form] = found;
  if (iii && ((form === 'rs,branch' && rt) || (form === 'rt,unsigned' && rs))) return null;
  if (form === 'jump') {
    const target = ((address + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0;
    return made(name, hexOf(target), name === 'jal' ? 'call' : 'jump', { target, writes: name === 'jal' ? 31 : null });
  }
  const likely = op >= 20 && op <= 23;
  if (form === 'rs,rt,branch') {
    if (name === 'beq' && rs === 0 && rt === 0) return made('b', hexOf(branchTo), 'jump', { target: branchTo });
    if (rt === 0) return made(likely ? `${name.slice(0, 3)}zl` : `${name}z`, `${r(rs)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo, ...(likely && { likely }) });
    return made(name, `${r(rs)}, ${r(rt)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo, ...(likely && { likely }) });
  }
  if (form === 'rs,branch') return made(name, `${r(rs)}, ${hexOf(branchTo)}`, 'branch', { target: branchTo, ...(likely && { likely }) });
  if (form === 'rt,rs,signed') {
    if (name === 'addiu' && rs === 0) return made('li', `${r(rt)}, ${imm}`, 'other', { imm, writes: rt });
    return made(name, `${r(rt)}, ${r(rs)}, ${imm}`, 'other', { imm, writes: rt });
  }
  if (form === 'rt,rs,unsigned') {
    if (name === 'ori' && rs === 0) return made('li', `${r(rt)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
    return made(name, `${r(rt)}, ${r(rs)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
  }
  if (form === 'rt,unsigned') return made(name, `${r(rt)}, ${hexOf(unsignedImm)}`, 'other', { imm: unsignedImm, writes: rt });
  const bytes = BYTES[name] ?? 4;
  const place = `${imm}(${r(rs)})`;
  if (form === 'cache') return made(name, `${hexOf(rt)}, ${place}`, 'other', { imm });
  // a store conditional writes whether it stored, so it's read as a store that writes its register
  if (name === 'sc' || name === 'scd') return made(name, `${r(rt)}, ${place}`, 'store', { imm, bytes, writes: rt });
  if (form === 'load') return made(name, `${r(rt)}, ${place}`, 'load', { imm, bytes, writes: rt });
  if (form === 'store') return made(name, `${r(rt)}, ${place}`, 'store', { imm, bytes });
  if (form === 'loadf' || form === 'storef') return made(name, `${f(rt)}, ${place}`, form === 'loadf' ? 'load' : 'store', { imm, bytes, float: true });
  return made(name, `$${rt}, ${place}`, form === 'load2' ? 'load' : 'store', { imm, bytes, gte: true });
}

// Whether a word keeps zero the fields its instruction doesn't use, which GNU's and LLVM's tools read a VR4300's word by:
// one that sets them is none. The R3000A's reading takes such a word as it always has.
function keepsZero(form, word, rs, rt, rd, sa) {
  if (form === 'shift') return rs === 0;
  if (form === 'shiftv' || form === 'rd,rs,rt') return sa === 0;
  if (form === 'jr') return rt === 0 && rd === 0 && sa === 0;
  if (form === 'jalr') return rt === 0 && sa === 0;
  if (form === 'rd') return rs === 0 && rt === 0 && sa === 0;
  if (form === 'rs') return rt === 0 && rd === 0 && sa === 0;
  if (form === 'rs,rt') return rd === 0 && sa === 0;
  if (form === 'none') return word === 0x0000000F;
  return true;
}

// the VR4300's floating-point unit, coprocessor 1: moves to and from it, its branches on its condition, and its sums
function decodeFloat(word, address, made, { rs, rt, rd, sa, fn, branchTo }) {
  const ft = rt, fs = rd, fd = sa;
  if ((word & 0x7FF) === 0 && rs <= 6 && rs !== 3) {
    const name = ['mfc1', 'dmfc1', 'cfc1', null, 'mtc1', 'dmtc1', 'ctc1'][rs];
    // the control registers by number, as GNU's tools write them, and the data registers by name
    const other = rs === 2 || rs === 6 ? `$${fs}` : `$f${fs}`;
    return made(name, `$${REGISTERS[rt]}, ${other}`, 'float', { writes: rs <= 2 ? rt : null });
  }
  if (rs === 8 && rt < 4) {
    const name = ['bc1f', 'bc1t', 'bc1fl', 'bc1tl'][rt];
    return made(name, hexOf(branchTo), 'branch', { target: branchTo, ...(rt >= 2 && { likely: true }) });
  }
  const format = FORMATS[rs];
  if (!format) return null;
  // a comparison sets the unit's condition, and its fd field is zero
  if (fn >= 48 && (format === 's' || format === 'd')) return fd ? null : made(`c.${COMPARES[fn - 48]}.${format}`, `${f(fs)}, ${f(ft)}`, 'float');
  const found = FLOAT[fn];
  if (!found) return null;
  const [name, form] = found;
  // a conversion goes from any format to another, and a sum works on singles and doubles alone
  if (name.startsWith('cvt.')) {
    if (name.endsWith(format) || ((format === 'w' || format === 'l') && (name === 'cvt.w' || name === 'cvt.l'))) return null;
  } else if (format !== 's' && format !== 'd') return null;
  if (form === 'fd,fs' && ft) return null;
  return made(`${name}.${format}`, form === 'fd,fs' ? `${f(fd)}, ${f(fs)}` : `${f(fd)}, ${f(fs)}, ${f(ft)}`, 'float');
}

// A vector register's elements, as an instruction names them after the register: all of them, one of the two quarters,
// one of the four halves or one of the eight elements, each repeated across the others
const elements = e => (e < 2 ? '' : e < 4 ? `[${e - 2}q]` : e < 8 ? `[${e - 4}h]` : `[${e - 8}]`);

// The RSP's instructions at `address` in its instruction memory, 0x04001000 to 0x04001FFF, where a branch or a jump goes
// round within those 4 KB. Its scalar instructions are the R3000A's it has, read as the VR4300's are, and its own are
// written as the N64's assemblers for it write them, as `vmudh $v1, $v2, $v3[0h]` and `lqv $v4[0], 16($a0)`.
function decodeRsp(word, address) {
  const op = word >>> 26, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, rd = (word >>> 11) & 31, sa = (word >>> 6) & 31, fn = word & 63;
  const base = (address & ~0xFFF) >>> 0;
  if (op === 0 && !RSP_SPECIAL.has(fn)) return null;
  if (op === 1 && rt !== 0 && rt !== 1 && rt !== 16 && rt !== 17) return null;
  if (op === 16) {
    if ((rs !== 0 && rs !== 4) || (word & 0x7FF) || rd > 15) return null;
    return { name: rs ? 'mtc0' : 'mfc0', text: `${(rs ? 'mtc0' : 'mfc0').padEnd(7)} ${r(rt)}, ${COP0_RSP[rd]}`, kind: 'other', rs, rt, rd, writes: rs ? null : rt || null };
  }
  if (op === 18) return decodeVector(word, { rs, rt, rd, sa, fn });
  if (op === 50 || op === 58) {
    const [name, scale] = (op === 50 ? VECTOR_LOADS : VECTOR_STORES)[rd] ?? [];
    if (!name) return null;
    const offset = ((word << 25) >> 25) * scale, e = (word >>> 7) & 15;
    return { name, text: `${name.padEnd(7)} $v${rt}[${e}], ${offset}(${r(rs)})`, kind: op === 50 ? 'load' : 'store', rs, rt, rd, imm: offset, bytes: scale, vector: true, writes: null };
  }
  if (op > 1 && op !== 16 && op !== 18 && !RSP_PRIMARY.has(op)) return null;
  // a branch's target, and a jump's, within the 4 KB the RSP runs from
  const found = decode(word, address, 'vr4300');
  if (!found) return null;
  if (found.target === undefined) return found;
  const target = (base | (found.name === 'j' || found.name === 'jal' ? (word << 2) & 0xFFF : (address + 4 + ((word << 16) >> 14)) & 0xFFF)) >>> 0;
  return { ...found, text: found.text.replace(/0x[0-9A-F]+$/, `0x${target.toString(16).toUpperCase()}`), target };
}

// the RSP's vector unit, coprocessor 2: moves to and from its registers and its control registers, and its sums
function decodeVector(word, { rs, rt, rd, sa, fn }) {
  if (rs < 16) {
    const name = ['mfc2', null, 'cfc2', null, 'mtc2', null, 'ctc2'][rs];
    if (!name) return null;
    if (rs === 2 || rs === 6) {
      if ((word & 0x7FF) || rd > 2) return null;
      return { name, text: `${name.padEnd(7)} ${r(rt)}, ${['$vco', '$vcc', '$vce'][rd]}`, kind: 'vector', rs, rt, rd, writes: rs === 2 ? rt || null : null };
    }
    if (word & 0x7F) return null;
    return { name, text: `${name.padEnd(7)} ${r(rt)}, $v${rd}[${(word >>> 7) & 15}]`, kind: 'vector', rs, rt, rd, writes: rs === 0 ? rt || null : null };
  }
  const name = VECTOR[fn], e = rs & 15;
  if (!name) return null;
  if (name === 'vnop') return { name, text: name, kind: 'vector', rs, rt, rd, writes: null };
  const text = ONE_ELEMENT.has(name) ? `$v${sa}[${rd & 7}], $v${rt}${elements(e)}` : `$v${sa}, $v${rd}, $v${rt}${elements(e)}`;
  return { name, text: `${name.padEnd(7)} ${text}`, kind: 'vector', rs, rt, rd, writes: null };
}

/** Whether a word is one of `processor`'s instructions. */
export const isInstruction = (word, processor = 'r3000a') => decode(word, 0, processor) !== null;

/** Whether an instruction's kind goes elsewhere for good once its delay slot has run: a return, a jump, a switch. */
export const goesAway = kind => kind === 'return' || kind === 'jump' || kind === 'switch';
