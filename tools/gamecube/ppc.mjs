// The GameCube's processor as the tools read it: IBM's PowerPC 750CXe as Nintendo had it made, Gekko, a 32-bit PowerPC
// with a floating-point unit and the paired singles only it and its successor have, from a table of the tools' own, as
// the set is fixed and nothing has to be built. `read` prints a game's function with it (read.mjs), the function finder
// tells code from values and finds where a function ends with it (functions.mjs), and the function check knows which
// instructions branch.
//
// Each instruction is written as the decompilations of GameCube games write PowerPC: registers as `r3` and `f1`, a
// load's or a store's place as an offset from a register, as `0x10(r1)`, a branch's target as the address it goes to,
// and the usual short forms: `li`, `lis`, `mr`, `nop`, `blr`, `bctr`, `beq` and its kin with the condition register's
// field when it isn't the first, `bdnz`, `mflr`, `mtlr`, `mtctr`, `slwi`, `srwi` and `clrlwi`.

const hex = value => (value < 0 ? `-0x${(-value).toString(16).toUpperCase()}` : `0x${value.toString(16).toUpperCase()}`);
const address = value => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const signed16 = word => (word << 16) >> 16;

// each as [name, operands]: the fields its operands are, in the order they're written
const PRIMARY = {
  3: ['twi', 'to,a,simm'], 7: ['mulli', 'd,a,simm'], 8: ['subfic', 'd,a,simm'], 10: ['cmplwi', 'crf,a,uimm'], 11: ['cmpwi', 'crf,a,simm'],
  12: ['addic', 'd,a,simm'], 13: ['addic.', 'd,a,simm'], 14: ['addi', 'd,a,simm'], 15: ['addis', 'd,a,simm'],
  20: ['rlwimi', 'rot'], 21: ['rlwinm', 'rot'], 23: ['rlwnm', 'rotb'],
  24: ['ori', 'a,s,uimm'], 25: ['oris', 'a,s,uimm'], 26: ['xori', 'a,s,uimm'], 27: ['xoris', 'a,s,uimm'], 28: ['andi.', 'a,s,uimm'], 29: ['andis.', 'a,s,uimm'],
  32: ['lwz', 'd,mem'], 33: ['lwzu', 'd,mem'], 34: ['lbz', 'd,mem'], 35: ['lbzu', 'd,mem'], 36: ['stw', 'd,mem'], 37: ['stwu', 'd,mem'],
  38: ['stb', 'd,mem'], 39: ['stbu', 'd,mem'], 40: ['lhz', 'd,mem'], 41: ['lhzu', 'd,mem'], 42: ['lha', 'd,mem'], 43: ['lhau', 'd,mem'],
  44: ['sth', 'd,mem'], 45: ['sthu', 'd,mem'], 46: ['lmw', 'd,mem'], 47: ['stmw', 'd,mem'],
  48: ['lfs', 'fd,mem'], 49: ['lfsu', 'fd,mem'], 50: ['lfd', 'fd,mem'], 51: ['lfdu', 'fd,mem'],
  52: ['stfs', 'fd,mem'], 53: ['stfsu', 'fd,mem'], 54: ['stfd', 'fd,mem'], 55: ['stfdu', 'fd,mem'],
  56: ['psq_l', 'fd,psq'], 57: ['psq_lu', 'fd,psq'], 60: ['psq_st', 'fd,psq'], 61: ['psq_stu', 'fd,psq'],
};
const CR = {
  0: ['mcrf', 'crfd,crfs'], 33: ['crnor', 'crb'], 50: ['rfi', ''], 129: ['crandc', 'crb'], 150: ['isync', ''], 193: ['crxor', 'crb'],
  225: ['crnand', 'crb'], 257: ['crand', 'crb'], 289: ['creqv', 'crb'], 417: ['crorc', 'crb'], 449: ['cror', 'crb'],
};
// those of opcode 31 whose low bit is Rc, the record bit, written as a dot, and with `o` an OE bit above them too
const X31 = {
  0: ['cmpw', 'crf,a,b'], 4: ['tw', 'to,a,b'], 8: ['subfc', 'd,a,b', 'o.'], 10: ['addc', 'd,a,b', 'o.'], 11: ['mulhwu', 'd,a,b', '.'], 19: ['mfcr', 'd'],
  20: ['lwarx', 'd,a0,b'], 23: ['lwzx', 'd,a0,b'], 24: ['slw', 'a,s,b', '.'], 26: ['cntlzw', 'a,s', '.'], 28: ['and', 'a,s,b', '.'], 32: ['cmplw', 'crf,a,b'],
  40: ['subf', 'd,a,b', 'o.'], 54: ['dcbst', 'a0,b'], 55: ['lwzux', 'd,a,b'], 60: ['andc', 'a,s,b', '.'], 75: ['mulhw', 'd,a,b', '.'], 83: ['mfmsr', 'd'],
  86: ['dcbf', 'a0,b'], 87: ['lbzx', 'd,a0,b'], 104: ['neg', 'd,a', 'o.'], 119: ['lbzux', 'd,a,b'], 124: ['nor', 'a,s,b', '.'], 136: ['subfe', 'd,a,b', 'o.'],
  138: ['adde', 'd,a,b', 'o.'], 144: ['mtcrf', 'crm,d'], 146: ['mtmsr', 'd'], 150: ['stwcx.', 'd,a0,b'], 151: ['stwx', 'd,a0,b'], 183: ['stwux', 'd,a,b'],
  200: ['subfze', 'd,a', 'o.'], 202: ['addze', 'd,a', 'o.'], 210: ['mtsr', 'sr,d'], 215: ['stbx', 'd,a0,b'], 232: ['subfme', 'd,a', 'o.'], 234: ['addme', 'd,a', 'o.'],
  235: ['mullw', 'd,a,b', 'o.'], 242: ['mtsrin', 'd,b'], 246: ['dcbtst', 'a0,b'], 247: ['stbux', 'd,a,b'], 266: ['add', 'd,a,b', 'o.'], 278: ['dcbt', 'a0,b'],
  279: ['lhzx', 'd,a0,b'], 284: ['eqv', 'a,s,b', '.'], 306: ['tlbie', 'b'], 310: ['eciwx', 'd,a0,b'], 311: ['lhzux', 'd,a,b'], 316: ['xor', 'a,s,b', '.'],
  339: ['mfspr', 'd,spr'], 343: ['lhax', 'd,a0,b'], 371: ['mftb', 'd,spr'], 375: ['lhaux', 'd,a,b'], 407: ['sthx', 'd,a0,b'], 412: ['orc', 'a,s,b', '.'],
  438: ['ecowx', 'd,a0,b'], 439: ['sthux', 'd,a,b'], 444: ['or', 'a,s,b', '.'], 459: ['divwu', 'd,a,b', 'o.'], 467: ['mtspr', 'spr,d'], 470: ['dcbi', 'a0,b'],
  476: ['nand', 'a,s,b', '.'], 491: ['divw', 'd,a,b', 'o.'], 512: ['mcrxr', 'crfd'], 533: ['lswx', 'd,a0,b'], 534: ['lwbrx', 'd,a0,b'], 535: ['lfsx', 'fd,a0,b'],
  536: ['srw', 'a,s,b', '.'], 566: ['tlbsync', ''], 567: ['lfsux', 'fd,a,b'], 595: ['mfsr', 'd,sr'], 597: ['lswi', 'd,a0,nb'], 598: ['sync', ''],
  599: ['lfdx', 'fd,a0,b'], 631: ['lfdux', 'fd,a,b'], 659: ['mfsrin', 'd,b'], 661: ['stswx', 'd,a0,b'], 662: ['stwbrx', 'd,a0,b'], 663: ['stfsx', 'fd,a0,b'],
  695: ['stfsux', 'fd,a,b'], 725: ['stswi', 'd,a0,nb'], 727: ['stfdx', 'fd,a0,b'], 759: ['stfdux', 'fd,a,b'], 790: ['lhbrx', 'd,a0,b'], 792: ['sraw', 'a,s,b', '.'],
  824: ['srawi', 'a,s,sh', '.'], 854: ['eieio', ''], 918: ['sthbrx', 'd,a0,b'], 922: ['extsh', 'a,s', '.'], 954: ['extsb', 'a,s', '.'], 982: ['icbi', 'a0,b'],
  983: ['stfiwx', 'fd,a0,b'], 1014: ['dcbz', 'a0,b'],
};
// the floating-point unit's, single (opcode 59) and double (63): those told by five bits, with a third operand in C
const FIVE = { 18: ['fdiv', 'fd,fa,fb'], 20: ['fsub', 'fd,fa,fb'], 21: ['fadd', 'fd,fa,fb'], 25: ['fmul', 'fd,fa,fc'], 28: ['fmsub', 'fd,fa,fc,fb'], 29: ['fmadd', 'fd,fa,fc,fb'], 30: ['fnmsub', 'fd,fa,fc,fb'], 31: ['fnmadd', 'fd,fa,fc,fb'] };
const SINGLE = { ...FIVE, 24: ['fres', 'fd,fb'] };
const DOUBLE = { ...FIVE, 23: ['fsel', 'fd,fa,fc,fb'], 26: ['frsqrte', 'fd,fb'] };
const X63 = {
  0: ['fcmpu', 'crf,fa,fb'], 12: ['frsp', 'fd,fb', '.'], 14: ['fctiw', 'fd,fb', '.'], 15: ['fctiwz', 'fd,fb', '.'], 32: ['fcmpo', 'crf,fa,fb'], 38: ['mtfsb1', 'crbd', '.'],
  40: ['fneg', 'fd,fb', '.'], 64: ['mcrfs', 'crfd,crfs'], 70: ['mtfsb0', 'crbd', '.'], 72: ['fmr', 'fd,fb', '.'], 134: ['mtfsfi', 'crfd,imm4', '.'], 136: ['fnabs', 'fd,fb', '.'],
  264: ['fabs', 'fd,fb', '.'], 583: ['mffs', 'fd', '.'], 711: ['mtfsf', 'fm,fb', '.'],
};
// the paired singles, opcode 4
const PS5 = {
  10: ['ps_sum0', 'fd,fa,fc,fb'], 11: ['ps_sum1', 'fd,fa,fc,fb'], 12: ['ps_muls0', 'fd,fa,fc'], 13: ['ps_muls1', 'fd,fa,fc'], 14: ['ps_madds0', 'fd,fa,fc,fb'],
  15: ['ps_madds1', 'fd,fa,fc,fb'], 18: ['ps_div', 'fd,fa,fb'], 20: ['ps_sub', 'fd,fa,fb'], 21: ['ps_add', 'fd,fa,fb'], 23: ['ps_sel', 'fd,fa,fc,fb'],
  24: ['ps_res', 'fd,fb'], 25: ['ps_mul', 'fd,fa,fc'], 26: ['ps_rsqrte', 'fd,fb'], 28: ['ps_msub', 'fd,fa,fc,fb'], 29: ['ps_madd', 'fd,fa,fc,fb'],
  30: ['ps_nmsub', 'fd,fa,fc,fb'], 31: ['ps_nmadd', 'fd,fa,fc,fb'],
};
const PS10 = {
  0: ['ps_cmpu0', 'crf,fa,fb'], 32: ['ps_cmpo0', 'crf,fa,fb'], 40: ['ps_neg', 'fd,fb', '.'], 64: ['ps_cmpu1', 'crf,fa,fb'], 72: ['ps_mr', 'fd,fb', '.'],
  96: ['ps_cmpo1', 'crf,fa,fb'], 136: ['ps_nabs', 'fd,fb', '.'], 264: ['ps_abs', 'fd,fb', '.'], 528: ['ps_merge00', 'fd,fa,fb', '.'], 560: ['ps_merge01', 'fd,fa,fb', '.'],
  592: ['ps_merge10', 'fd,fa,fb', '.'], 624: ['ps_merge11', 'fd,fa,fb', '.'], 1014: ['dcbz_l', 'a0,b'],
};
const PS6 = { 6: ['psq_lx', 'fd,psqx'], 7: ['psq_stx', 'fd,psqx'], 38: ['psq_lux', 'fd,psqx'], 39: ['psq_stux', 'fd,psqx'] };
// the special registers a game's code names, by number
const SPR = { 1: 'xer', 8: 'lr', 9: 'ctr', 18: 'dsisr', 19: 'dar', 22: 'dec', 25: 'sdr1', 26: 'srr0', 27: 'srr1', 268: 'tbl', 269: 'tbu', 272: 'sprg0', 273: 'sprg1', 274: 'sprg2', 275: 'sprg3',
  282: 'ear', 287: 'pvr', 912: 'gqr0', 913: 'gqr1', 914: 'gqr2', 915: 'gqr3', 916: 'gqr4', 917: 'gqr5', 918: 'gqr6', 919: 'gqr7', 920: 'hid2', 921: 'wpar', 922: 'dmau', 923: 'dmal',
  936: 'ummcr0', 952: 'mmcr0', 1008: 'hid0', 1009: 'hid1', 1010: 'iabr', 1013: 'dabr', 1017: 'l2cr', 1019: 'ictc', 1020: 'thrm1', 1021: 'thrm2', 1022: 'thrm3' };
for (let n = 0; n < 4; n++) Object.assign(SPR, { [528 + n * 2]: `ibat${n}u`, [529 + n * 2]: `ibat${n}l`, [536 + n * 2]: `dbat${n}u`, [537 + n * 2]: `dbat${n}l` });
const CONDITIONS = ['lt', 'gt', 'eq', 'so'], NOT = ['ge', 'le', 'ne', 'ns'];

const field = (word, name) => {
  const d = (word >>> 21) & 31, a = (word >>> 16) & 31, b = (word >>> 11) & 31, c = (word >>> 6) & 31;
  switch (name) {
    case 'd': case 's': return `r${d}`;
    case 'a': return `r${a}`;
    case 'a0': return a ? `r${a}` : '0';
    case 'b': return `r${b}`;
    case 'fd': return `f${d}`;
    case 'fa': return `f${a}`;
    case 'fb': return `f${b}`;
    case 'fc': return `f${c}`;
    case 'simm': return hex(signed16(word));
    case 'uimm': return hex(word & 0xFFFF);
    case 'mem': return `${hex(signed16(word))}(${a ? `r${a}` : '0'})`;
    case 'psq': return `${hex(((word & 0xFFF) << 20) >> 20)}(${a ? `r${a}` : '0'}), ${(word >>> 15) & 1}, qr${(word >>> 12) & 7}`;
    case 'psqx': return `${a ? `r${a}` : '0'}, r${b}, ${(word >>> 10) & 1}, qr${(word >>> 7) & 7}`;
    case 'crf': case 'crfd': return `cr${d >> 2}`;
    case 'crfs': return `cr${a >> 2}`;
    case 'crb': return `${d}, ${a}, ${b}`;
    case 'crbd': return String(d);
    case 'to': return String(d);
    case 'sh': case 'nb': return String(b);
    case 'spr': return SPR[(b << 5) | a] ?? String((b << 5) | a);
    case 'sr': return String(a & 15);
    case 'crm': return hex((word >>> 12) & 0xFF);
    case 'fm': return hex((word >>> 17) & 0xFF);
    case 'imm4': return String(b >> 1);
    case 'rot': return `r${a}, r${d}, ${b}, ${c}, ${(word >>> 1) & 31}`;
    case 'rotb': return `r${a}, r${d}, r${b}, ${c}, ${(word >>> 1) & 31}`;
    default: throw new Error(`No field called ${name}.`);
  }
};
const written = (word, [name, operands, marks = ''], oe = false) => {
  const dot = marks.includes('.') && (word & 1) ? '.' : '';
  return { name: `${name}${oe ? 'o' : ''}${dot}`, operands: operands ? operands.split(',').map(each => field(word, each)).join(', ') : '' };
};

// a branch on a condition: its short name for the usual ways BO is set, or `bc` with its numbers
function conditional(word, suffix, target) {
  const bo = (word >>> 21) & 31, bi = (word >>> 16) & 31, lk = word & 1 ? 'l' : '', to = target === null ? [] : [address(target)];
  const cr = bi >> 2 ? [`cr${bi >> 2}`] : [];
  if ((bo & 0x14) === 0x14) return { name: `b${suffix}${lk}`, operands: to.join(', ') };
  if ((bo & 0x1C) === 0x0C) return { name: `b${CONDITIONS[bi & 3]}${suffix}${lk}`, operands: [...cr, ...to].join(', ') };
  if ((bo & 0x1C) === 0x04) return { name: `b${NOT[bi & 3]}${suffix}${lk}`, operands: [...cr, ...to].join(', ') };
  if ((bo & 0x16) === 0x10) return { name: `bdnz${suffix}${lk}`, operands: to.join(', ') };
  if ((bo & 0x16) === 0x12) return { name: `bdz${suffix}${lk}`, operands: to.join(', ') };
  return { name: `bc${suffix}${lk}`, operands: [bo, bi, ...to].join(', ') };
}

/**
 * One instruction: { name, operands, text }, as it's written, with `to`, the address a branch or a call goes to when
 * the instruction names it, `call` when it comes back (bl and its kin), `always` when a branch goes whatever the
 * condition register holds, `returns` for a blr that always goes, and `through` for a branch through a register, 'lr' or
 * 'ctr'. With `op`, its first six bits, and the registers and the number its bits can name, whichever of them it has:
 * `rd`, `ra`, `rb`, `simm` and `uimm`. Null for a word the processor has no instruction for.
 */
export function decode(word, at = 0) {
  const found = decodeOf(word >>> 0, at >>> 0);
  return found && {
    ...found, text: found.operands ? `${found.name} ${found.operands}` : found.name,
    op: word >>> 26, rd: (word >>> 21) & 31, ra: (word >>> 16) & 31, rb: (word >>> 11) & 31, simm: signed16(word), uimm: word & 0xFFFF,
  };
}

function decodeOf(word, at) {
  const op = word >>> 26, xo = (word >>> 1) & 0x3FF, d = (word >>> 21) & 31, a = (word >>> 16) & 31, b = (word >>> 11) & 31;
  if (op === 18) {
    const to = ((word & 2 ? 0 : at) + ((word << 6) >> 6 & ~3)) >>> 0;
    return { name: `b${word & 1 ? 'l' : ''}${word & 2 ? 'a' : ''}`, operands: address(to), to, call: (word & 1) === 1, always: true };
  }
  if (op === 16) {
    const to = ((word & 2 ? 0 : at) + (signed16(word) & ~3)) >>> 0;
    const text = conditional(word, word & 2 ? 'a' : '', to);
    return { ...text, to, call: (word & 1) === 1, always: (d & 0x14) === 0x14 };
  }
  if (op === 17) return (word & 0x03FFFFFD) === 0 && (word & 2) ? { name: 'sc', operands: '' } : null;
  if (op === 19) {
    if (xo === 16 || xo === 528) {
      if (xo === 528 && !(d & 4)) return null;   // a branch through CTR can't count with it
      const text = conditional(word, xo === 16 ? 'lr' : 'ctr', null), always = (d & 0x14) === 0x14;
      return { ...text, call: (word & 1) === 1, always, through: xo === 16 ? 'lr' : 'ctr', ...(xo === 16 && always && !(word & 1) ? { returns: true } : {}) };
    }
    return CR[xo] && !(word & 1) ? written(word, CR[xo]) : null;
  }
  if (op === 31) {
    const plain = X31[xo];
    if (plain) {
      if (!plain[2]?.includes('.') && (word & 1) && plain[0] !== 'stwcx.') return null;
      if (plain[0] === 'stwcx.' && !(word & 1)) return null;
      if (plain[0] === 'or' && d === b && !(word & 1)) return { name: 'mr', operands: `r${a}, r${d}` };
      if (plain[0] === 'mfspr' || plain[0] === 'mtspr') {
        const spr = (b << 5) | a, short = { 8: 'lr', 9: 'ctr', 1: 'xer' }[spr];
        if (short) return { name: `${plain[0].slice(0, 2)}${short}`, operands: `r${d}` };
      }
      return written(word, plain);
    }
    const withOe = X31[xo & 0x1FF];
    return withOe?.[2]?.includes('o') && xo >= 512 ? written(word, withOe, true) : null;
  }
  // the single forms are named with an s, but for fres, which has no double form
  if (op === 59) return SINGLE[xo & 31] ? written(word, [(xo & 31) === 24 ? 'fres' : `${SINGLE[xo & 31][0]}s`, SINGLE[xo & 31][1], '.']) : null;
  if (op === 63) {
    if (X63[xo]) return X63[xo][2] || !(word & 1) ? written(word, X63[xo]) : null;
    return DOUBLE[xo & 31] ? written(word, [...DOUBLE[xo & 31], '.']) : null;
  }
  if (op === 4) {
    if (PS10[xo]) return PS10[xo][2] || !(word & 1) ? written(word, PS10[xo]) : null;
    if (PS6[xo & 63]) return word & 1 ? null : written(word, PS6[xo & 63]);
    return PS5[xo & 31] ? written(word, [...PS5[xo & 31], '.']) : null;
  }
  const plain = PRIMARY[op];
  if (!plain) return null;
  if (op === 24 && word === 0x60000000) return { name: 'nop', operands: '' };
  if (op === 14 && a === 0) return { name: 'li', operands: `r${d}, ${hex(signed16(word))}` };
  if (op === 15 && a === 0) return { name: 'lis', operands: `r${d}, ${hex(word & 0xFFFF)}` };
  if (op === 21) {
    const sh = b, mb = (word >>> 6) & 31, me = (word >>> 1) & 31, dot = word & 1 ? '.' : '';
    if (mb === 0 && me === 31 - sh && sh) return { name: `slwi${dot}`, operands: `r${a}, r${d}, ${sh}` };
    if (me === 31 && sh === (32 - mb) % 32 && mb) return { name: `srwi${dot}`, operands: `r${a}, r${d}, ${mb}` };
    if (sh === 0 && me === 31) return { name: `clrlwi${dot}`, operands: `r${a}, r${d}, ${mb}` };
  }
  if (op === 20 || op === 21 || op === 23) return { name: `${plain[0]}${word & 1 ? '.' : ''}`, operands: field(word, plain[1]) };
  if ((op === 10 || op === 11) && (d & 3)) return null;   // a compare of 64 bits, which this processor hasn't
  return written(word, plain);
}

/** Whether a word is an instruction of the processor's. A word of zeros isn't one, though it's what sits between functions. */
export const isInstruction = word => decodeOf(word >>> 0, 0) !== null;
