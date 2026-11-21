// Branch ways ruled out across a whole function (#1760), where lib/decided.mjs reads only the straight run before a
// branch: a function's Thumb code is read from its start, and from every place something else can arrive at, along
// every way the code allows, round its loops until nothing new is learned. Each register, and each slot of the
// function's own stack, holds what can be known of it: a number, a few numbers, a range of them, a place on the stack,
// or nothing. A read from the cartridge at a few places is the few values the copy holds there, read from the copy as
// the tool runs, so a byte of a table at an index of a few bits is one of the bytes the index reaches. Where a value of
// a few comes from a mask of something unknown, the reading goes on once for each, so two values read at the same index
// stay together. A branch every way into which decides it, the same way each time, can only go that way.
//
// What it takes as given: the function's own frame, above the stack pointer, is written only by the function itself,
// by its own stores and the DMAs it starts, as an interrupt runs on a stack of its own below it; and the stack is in
// the 32 KB of work memory at 0x03000000, or one of its copies up to 0x04000000. A store or a DMA that may reach there,
// or a call, forgets the slots; a store anywhere at all, or a stack pointer the code can't follow, forgets them for the
// rest of the way. Only Thumb code is read, as nearly all of a Game Boy Advance game is.

import { instructionsOf } from './played.mjs';
import { arrivals } from './decided.mjs';
import { wordsSetAside } from './words-into.mjs';

const CARTRIDGE = 0x08000000, TWO32 = 4294967296;
// at most how many numbers a value holds as a list of them, before it's a range
const FEW = 32;
// a read from the cartridge at a few places, 2 to 16, as at an index of a few bits into a table, is read once for
// each, the registers the place was worked out from following it, so a second read at the same index is the same
// entry's
const SPLIT = 16;
// how many of the last splits a way keeps apart from the others: the last, as a second read at the same index follows
// it; older ones are joined
const KEPT_SPLITS = 1;
// how often a place is reached with something new before its ranges are widened, and the bounds they widen to, the
// edges of the console's memories
const WIDEN_AFTER = 48;
const BOUNDS = [-2147483648, -0x100000, -0x10000, 0, 0x10000, 0x100000, 0x02000000, 0x03000000, 0x04000000, 0x05000000, 0x06000000, 0x07000000, 0x08000000, 0x0E000000, 0x80000000, TWO32 - 1];
// the work memory a stack can be in, with its copies
const STACKS = { from: 0x03000000, to: 0x04000000 };
// how many states a place keeps apart by the single numbers its registers hold, before the register holding the most
// different ones no longer keeps them apart there
const VARIANTS = 256;
// how many places of a function the reading goes through at most, and how many states it keeps at most, before it
// gives up on the function
const STEPS = 3000000, STATES = 150000;

// ---------------------------------------------------------------------------------------------------------------
// Values: null for nothing known, { set } a few numbers as unsigned 32-bit values, { lo, hi } a range of whole
// numbers, each standing for itself modulo 2^32, and { stack } a place on the stack, the stack pointer as the function
// started plus that many bytes.

const wrap = n => ((n % TWO32) + TWO32) % TWO32;
const of = (...values) => few(values);
function few(values) {
  const list = [...new Set(values.map(wrap))].sort((a, b) => a - b);
  if (list.length <= FEW) return { set: list };
  return span(list[0], list.at(-1));
}
// a range, moved by a whole 2^32 so it starts between -2^31 and 2^31, as the same numbers modulo 2^32
function span(lo, hi) {
  if (hi - lo >= TWO32 - 1 || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const by = -Math.floor((lo + 2147483648) / TWO32) * TWO32;
  return { lo: lo + by, hi: hi + by };
}
const known = v => (v?.set?.length === 1 ? v.set[0] : null);
// the value as a range of whole numbers: a few numbers as the narrower of their unsigned and their signed range
const rangeOf = v => {
  if (!v || v.stack !== undefined) return null;
  if (!v.set) return v;
  const signed = v.set.map(p => (p >= 2147483648 ? p - TWO32 : p));
  const lo = Math.min(...signed), hi = Math.max(...signed);
  return hi - lo < v.set.at(-1) - v.set[0] ? { lo, hi } : { lo: v.set[0], hi: v.set.at(-1) };
};
// the value's numbers when there are few of them
const listOf = v => (v?.set ? v.set : v && v.lo !== undefined && v.hi - v.lo < FEW ? Array.from({ length: v.hi - v.lo + 1 }, (_, i) => wrap(v.lo + i)) : null);
// as unsigned or signed 32-bit numbers, a range that doesn't cross where they turn round, or null
function view(v, signed) {
  const r = rangeOf(v);
  if (!r) return null;
  const shift = signed ? 2147483648 : 0, block = Math.floor((r.lo + shift) / TWO32);
  if (block !== Math.floor((r.hi + shift) / TWO32)) return null;
  return { lo: r.lo - block * TWO32, hi: r.hi - block * TWO32 };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function join(a, b) {
  if (!a || !b) return null;
  if (a.stack !== undefined || b.stack !== undefined) return a.stack !== undefined && a.stack === b.stack ? a : null;
  if (a.set && b.set) return few([...a.set, ...b.set]);
  // the narrowest of the two ranges' joins, the second moved by a whole 2^32 or not
  const x = rangeOf(a), y = rangeOf(b);
  let best = null;
  for (const by of [0, TWO32, -TWO32]) {
    const lo = Math.min(x.lo, y.lo + by), hi = Math.max(x.hi, y.hi + by);
    if (!best || hi - lo < best.hi - best.lo) best = { lo, hi };
  }
  return span(best.lo, best.hi);
}

// a range that went on growing, out to the edges of the memories beyond it
function widen(old, now) {
  if (!old || !now || same(old, now)) return now;
  if (now.stack !== undefined) return now;
  const o = rangeOf(old), n = rangeOf(now);
  if (now.set && old.set) return now;
  const lo = n.lo < o.lo ? BOUNDS.filter(b => b <= n.lo).at(-1) ?? -Infinity : n.lo;
  const hi = n.hi > o.hi ? BOUNDS.find(b => b >= n.hi) ?? Infinity : n.hi;
  return span(lo, hi);
}

// two values through an operation on each pair of their numbers, when both are few, or else through `ranged`
function each(a, b, f, ranged = () => null) {
  if (a?.stack !== undefined || b?.stack !== undefined) return null;
  const x = listOf(a), y = listOf(b);
  if (x && y && x.length * y.length <= FEW * FEW) return few(x.flatMap(p => y.map(q => f(p, q))));
  return a && b ? ranged(rangeOf(a), rangeOf(b)) : null;
}

const add = (a, b) => {
  if (a?.stack !== undefined) return known(b) !== null ? { stack: a.stack + (known(b) | 0) } : null;
  if (b?.stack !== undefined) return add(b, a);
  return each(a, b, (p, q) => p + q, (x, y) => span(x.lo + y.lo, x.hi + y.hi));
};
const negate = a => each(a, of(0), p => -p, x => span(-x.hi, -x.lo));
const sub = (a, b) => (a?.stack !== undefined && known(b) !== null ? { stack: a.stack - (known(b) | 0) } : add(a, negate(b)));
const mul = (a, b) => each(a, b, (p, q) => Number(BigInt.asUintN(32, BigInt(p) * BigInt(q))), (x, y) => {
  const c = [x.lo * y.lo, x.lo * y.hi, x.hi * y.lo, x.hi * y.hi];
  return Math.max(...c.map(Math.abs)) < 2 ** 52 ? span(Math.min(...c), Math.max(...c)) : null;
});
const lsl = (a, n) => (n >= 32 ? of(0) : each(a, of(n), p => p * 2 ** n, x => span(x.lo * 2 ** n, x.hi * 2 ** n)));
const lsr = (a, n) => {
  if (n >= 32) return of(0);
  const u = view(a, false), x = listOf(a);
  if (x) return few(x.map(p => Math.floor(p / 2 ** n)));
  return u ? span(Math.floor(u.lo / 2 ** n), Math.floor(u.hi / 2 ** n)) : span(0, Math.floor((TWO32 - 1) / 2 ** n));
};
const asr = (a, n) => {
  const s = view(a, true), x = listOf(a), signed = p => (p >= 2147483648 ? p - TWO32 : p);
  n = Math.min(n, 31);
  if (x) return few(x.map(p => Math.floor(signed(p) / 2 ** n)));
  return s ? span(Math.floor(s.lo / 2 ** n), Math.floor(s.hi / 2 ** n)) : span(-(2 ** (31 - n)), 2 ** (31 - n) - 1);
};
// a mask: of few numbers, each; of anything with a mask of few bits, each value those bits make; with a mask of high
// bits set and low bits clear, a range lowered by at most the bits cleared; or else at most the mask
function and(a, b) {
  if (a?.stack !== undefined || b?.stack !== undefined) return null;
  const x = listOf(a), y = listOf(b);
  if (x && y) return each(a, b, (p, q) => (p & q) >>> 0);
  const mask = known(b) ?? known(a), other = known(b) !== null ? a : b;
  if (mask === null) {
    const u = view(a, false), v = view(b, false);
    return u && v ? span(0, Math.min(u.hi, v.hi)) : null;
  }
  const bits = [];
  for (let i = 0; i < 32; i++) if (mask >>> i & 1) bits.push(i);
  if (bits.length <= 5) {
    const values = [];
    for (let m = 0; m < 1 << bits.length; m++) values.push(bits.reduce((v, bit, i) => (m >> i & 1 ? v + 2 ** bit : v), 0));
    return few(values);
  }
  const low = (~mask >>> 0) + 1;
  if (low > 0 && (low & (low - 1)) === 0 && other) {
    const r = rangeOf(other);
    return span(r.lo - (low - 1), r.hi);
  }
  return span(0, mask);
}
const orr = (a, b) => each(a, b, (p, q) => (p | q) >>> 0, () => {
  const u = view(a, false), v = view(b, false);
  if (!u || !v || u.lo < 0 || v.lo < 0) return null;
  return span(0, 2 ** Math.ceil(Math.log2(Math.max(u.hi, v.hi) + 1)) - 1);
});
const eor = (a, b) => each(a, b, (p, q) => (p ^ q) >>> 0);
const bic = (a, b) => each(a, b, (p, q) => (p & ~q) >>> 0);
const mvn = a => each(a, of(0), p => (~p) >>> 0);
const ror = (a, b) => each(a, b, (p, q) => { const s = q & 31; return ((p >>> s) | (p << (32 - s))) >>> 0; });
const shiftBy = (a, b, f) => {
  const amounts = listOf(b);
  if (!amounts) return null;
  return amounts.map(n => f(a, n & 0xFF)).reduce((x, y) => (x === undefined ? y : join(x, y)), undefined) ?? null;
};

// ---------------------------------------------------------------------------------------------------------------
// The flags: what set them, as { kind, a, b, ra, rb, pc }: a comparison of a with b (`sub`), an addition (`add`), a
// test of a with b (`and`), or a result alone (`value`, N and Z only), with the registers the values were in.

function flagsOf(kind, a, b) {
  if (kind === 'value') return { n: a >>> 31 === 1, z: a === 0, c: null, v: null };
  if (kind === 'and') { const r = (a & b) >>> 0; return { n: r >>> 31 === 1, z: r === 0, c: null, v: null }; }
  const r = kind === 'sub' ? wrap(a - b) : wrap(a + b);
  const c = kind === 'sub' ? a >= b : a + b >= TWO32;
  const v = kind === 'sub' ? ((a ^ b) & (a ^ r)) >>> 31 === 1 : (~(a ^ b) & (a ^ r)) >>> 31 === 1;
  return { n: r >>> 31 === 1, z: r === 0, c, v };
}
function holdsWith(cond, f) {
  const all = (...x) => x.every(y => y !== null);
  switch (cond) {
    case 0x0: return f.z; case 0x1: return !f.z; case 0x2: return f.c; case 0x3: return f.c === null ? null : !f.c;
    case 0x4: return f.n; case 0x5: return !f.n; case 0x6: return f.v; case 0x7: return f.v === null ? null : !f.v;
    case 0x8: return all(f.c) ? f.c && !f.z : null; case 0x9: return all(f.c) ? !f.c || f.z : null;
    case 0xA: return all(f.v) ? f.n === f.v : null; case 0xB: return all(f.v) ? f.n !== f.v : null;
    case 0xC: return all(f.v) ? !f.z && f.n === f.v : null; case 0xD: return all(f.v) ? f.z || f.n !== f.v : null;
    default: return null;
  }
}
// whether the condition holds with these flags: true, false, or null when it may go either way
function outcome(cond, flags) {
  if (!flags) return null;
  const { kind, a, b } = flags;
  const x = listOf(a), y = kind === 'value' ? [0] : listOf(b);
  if (x && y && x.length * y.length <= FEW * FEW) {
    let seen = null;
    for (const p of x) {
      for (const q of y) {
        const holds = holdsWith(cond, flagsOf(kind, p, q));
        if (holds === null || (seen !== null && seen !== holds)) return null;
        seen = holds;
      }
    }
    return seen;
  }
  if (kind !== 'sub' || !a || !b) return null;
  // ranges compared: equal when they can't differ, unequal when they can't meet, above or below when wholly so
  const u = [view(a, false), view(b, false)], s = [view(a, true), view(b, true)];
  const apart = ([p, q]) => p && q && (p.hi < q.lo || q.hi < p.lo);
  const below = ([p, q]) => (p && q ? (p.hi < q.lo ? true : p.lo >= q.hi ? false : null) : null);
  switch (cond) {
    case 0x0: return apart(u) ? false : null;
    case 0x1: return apart(u) ? true : null;
    case 0x2: { const l = below(u); return l === null ? null : !l; }
    case 0x3: return below(u);
    case 0xB: return below(s);
    case 0xA: { const l = below(s); return l === null ? null : !l; }
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A state of the reading: where its way started (`base`), the registers, each register's relation to another, as
// { reg, add, value }: it holds what `reg` holds plus `add`, while `reg` still holds `value`, the stack pointer as an
// offset from what it was there (null once lost), the stack's slots by their offset ({ size, value }), the flags, whether the frame may
// have been written by anything (`lost`), the DMA channels' registers, the last splits it went through, and with which
// key it last left each place a loop comes round to (`passed`).

const fresh = (base = 0) => ({ base, r: new Array(16).fill(null), rel: new Array(16).fill(null), sp: 0, slots: new Map(), flags: null, lost: false, dma: new Map(), splits: [], passed: new Map() });
const clone = s => ({ base: s.base, r: [...s.r], rel: [...s.rel], sp: s.sp, slots: new Map(s.slots), flags: s.flags, lost: s.lost, dma: new Map(s.dma), splits: [...s.splits], passed: new Map(s.passed) });
// ways from different starts are kept apart, their stack pointers being offsets from different places
const keyOf = s => `${s.base}/${s.splits.map(([pc, v]) => `${pc}:${v}`).join(',')}`;
// the registers that hold one number each, and which, but those `freed` and those not in `live`, a mask of r0 to r12
const signature = (s, freed, live) => s.r.slice(0, 13).map((v, i) => (freed.has(i) || !(live >> i & 1) || known(v) === null ? '' : `${i}=${known(v)}`)).join(',');

function joinStates(a, b, widening) {
  const s = clone(a);
  const merge = (x, y) => (widening ? widen(x, join(x, y)) : join(x, y));
  s.r = a.r.map((v, i) => merge(v, b.r[i]));
  // a relation both ways have holds in the join too
  s.rel = a.rel.map((x, i) => (x && b.rel[i] && x.reg === b.rel[i].reg && x.add === b.rel[i].add && related(a, i) && related(b, i) ? { ...x, value: s.r[x.reg] } : null));
  s.sp = a.sp === b.sp ? a.sp : null;
  s.slots = new Map();
  if (s.sp !== null) for (const [at, slot] of a.slots) { const o = b.slots.get(at); if (o && o.size === slot.size) s.slots.set(at, { size: slot.size, value: merge(slot.value, o.value) }); }
  s.flags = a.flags && b.flags && same(a.flags, b.flags) ? a.flags : null;
  s.lost = a.lost || b.lost;
  s.dma = new Map([...a.dma].filter(([k, v]) => same(v, b.dma.get(k))));
  s.passed = new Map([...a.passed, ...b.passed]);
  return s;
}
const sameState = (a, b) => same(a.r, b.r) && same(a.rel.map(x => x && [x.reg, x.add]), b.rel.map(x => x && [x.reg, x.add])) && a.sp === b.sp && same([...a.slots], [...b.slots]) && same(a.flags, b.flags) && a.lost === b.lost && same([...a.dma], [...b.dma]);

// whether register i's relation still holds: the register it's to holds what it did
const related = (s, i) => Boolean(s.rel[i]) && same(s.r[s.rel[i].reg], s.rel[i].value);
// register `to` as `from` plus `k`, or as what `from` is related to plus that, worked out before `to` is written
const relation = (s, from, k) => (related(s, from) ? { reg: s.rel[from].reg, add: s.rel[from].add + k, value: s.rel[from].value } : { reg: from, add: k, value: s.r[from] });
// a register set to one number, and every register related to the same one with it
function constrain(s, reg, v) {
  const root = related(s, reg) ? s.rel[reg].reg : reg, base = wrap(related(s, reg) ? v - s.rel[reg].add : v);
  const tied = s.r.map((_, y) => y !== root && related(s, y) && s.rel[y].reg === root);
  s.r[root] = of(base);
  tied.forEach((t, y) => {
    if (!t) return;
    s.r[y] = of(base + s.rel[y].add);
    s.rel[y] = { ...s.rel[y], value: s.r[root] };
  });
  if (root !== reg && !tied[reg]) s.r[reg] = of(v);
}

// whether a place a write goes to may be in the work memory the stack is in
function mayHitStack(where) {
  if (!where) return true;
  if (where.stack !== undefined) return true;
  const r = rangeOf(where);
  if (r.hi - r.lo >= TWO32 - 1) return true;
  const lo = wrap(r.lo), hi = lo + (r.hi - r.lo);
  const meets = (from, to) => !(to <= STACKS.from || from >= STACKS.to);
  return hi < TWO32 ? meets(lo, hi + 1) : meets(lo, TWO32) || meets(0, hi - TWO32 + 1);
}
// whether a write to `where` may be a DMA channel's register
const mayBeDma = where => {
  const r = rangeOf(where);
  if (!r) return true;
  const lo = wrap(r.lo), hi = lo + (r.hi - r.lo);
  return !(hi < 0x040000B0 || lo >= 0x040000E0) || hi >= TWO32;
};

// a write of `size` bytes of `value` at `where`
function store(s, where, size, value) {
  if (where?.stack !== undefined) {
    if (s.sp === null) return;
    for (const at of [...s.slots.keys()]) { const slot = s.slots.get(at); if (at < where.stack + size && where.stack < at + slot.size) s.slots.delete(at); }
    const masked = size === 4 ? value : and(value, of(2 ** (size * 8) - 1));
    s.slots.set(where.stack, { size, value: masked });
    return;
  }
  const at = known(where);
  if (at !== null && at >= 0x040000B0 && at < 0x040000E0) return dmaWrite(s, at, size, value);
  if (where === null) { s.slots.clear(); s.lost = true; return; }
  if (mayBeDma(where)) { s.slots.clear(); s.lost = true; return; }
  if (mayHitStack(where)) s.slots.clear();
}

// a write to a DMA channel's register: a channel started at once with a known place on the stack to write and a
// known length writes those slots; one that may write the stack's memory otherwise forgets them, for good, as it may
// write them later. A channel's registers as the function started aren't known.
function dmaWrite(s, at, size, value) {
  const channel = Math.floor((at - 0x040000B0) / 12), offset = (at - 0x040000B0) % 12;
  const regs = { ...(s.dma.get(channel) ?? {}) };
  let control;
  if (size === 4 && offset === 8) {
    const w = known(value);
    regs.count = w === null ? null : of(w & 0xFFFF);
    control = w === null ? null : w >>> 16;
  } else if (size === 4) {
    regs[offset] = value;
  } else if (size === 2 && offset === 8) {
    regs.count = value;
  } else if (size === 2 && offset === 10) {
    control = known(value);
  } else regs[offset & ~3] = null;
  s.dma.set(channel, regs);
  if (control === undefined || (control !== null && !(control & 0x8000))) return;
  const dest = regs[4] ?? null, count = known(regs.count ?? null);
  if (control !== null && dest?.stack !== undefined && s.sp !== null && !s.lost && (control >> 12 & 3) === 0 && (control >> 5 & 3) === 0 && count !== null) {
    const bytes = (count || (channel === 3 ? 0x10000 : 0x4000)) * (control & 0x400 ? 4 : 2);
    for (const k of [...s.slots.keys()]) if (k < dest.stack + bytes && dest.stack < k + s.slots.get(k).size) s.slots.delete(k);
    return;
  }
  if (dest && dest.stack === undefined && !mayHitStack(dest)) return;
  s.slots.clear();
  s.lost = true;
}

// a read of `size` bytes at `where`, `signed` or not, with `rom` the cartridge's bytes and `reads` what of it was read
function load(s, where, size, signed, rom, reads) {
  const typed = size === 4 ? null : signed ? span(-(2 ** (size * 8 - 1)), 2 ** (size * 8 - 1) - 1) : span(0, 2 ** (size * 8) - 1);
  if (where?.stack !== undefined) {
    if (s.sp === null || s.lost) return typed;
    const slot = s.slots.get(where.stack);
    if (!slot || slot.size !== size || where.stack % size) return typed;
    if (!signed || size === 4) return slot.value;
    return null;
  }
  const places = listOf(where);
  if (!places) return typed;
  const values = [];
  for (const at of places) {
    if (at % size || at < CARTRIDGE || at + size > CARTRIDGE + rom.length) return typed;
    const i = at - CARTRIDGE;
    let v = size === 1 ? rom[i] : size === 2 ? rom[i] | rom[i + 1] << 8 : (rom[i] | rom[i + 1] << 8 | rom[i + 2] << 16 | rom[i + 3] << 24) >>> 0;
    if (signed && v >= 2 ** (size * 8 - 1)) v -= 2 ** (size * 8);
    values.push(v);
    reads.add(`${at}:${size}`);
  }
  return few(values);
}

// ---------------------------------------------------------------------------------------------------------------
// One instruction over a state: the states it leads to, as [offset, state], with null for the way out of the function.

function stepAll(s, pc, u16, size, address, rom, reads) {
  const op = u16(pc), r = s.r, next = pc + 2;
  const go = (...states) => states.map(t => [next, t]);
  const setFlags = (kind, a, b, ra = null, rb = null) => { s.flags = { kind, a, b, ra, rb, pc: address + pc }; };
  // shifts by a number
  if ((op & 0xE000) === 0x0000 && (op & 0x1800) !== 0x1800) {
    const kind = op >> 11 & 3, by = op >> 6 & 31, from = r[op >> 3 & 7], to = op & 7;
    const v = kind === 0 ? lsl(from, by) : kind === 1 ? lsr(from, by || 32) : asr(from, by || 32);
    r[to] = v;
    setFlags('value', v);
    return go(s);
  }
  if ((op & 0xF800) === 0x1800) {
    const rn = op >> 3 & 7, rm = op >> 6 & 7, a = r[rn], b = op & 0x0400 ? of(rm) : r[rm], to = op & 7, subtract = (op & 0x0200) !== 0;
    const k = known(b) !== null ? relation(s, rn, subtract ? -(known(b) | 0) : known(b) | 0) : !subtract && !(op & 0x0400) && known(a) !== null ? relation(s, rm, known(a) | 0) : null;
    r[to] = subtract ? sub(a, b) : add(a, b);
    s.rel[to] = k;
    s.kept = to;
    setFlags(subtract ? 'sub' : 'add', a, b, op >> 3 & 7, op & 0x0400 ? null : op >> 6 & 7);
    return go(s);
  }
  if ((op & 0xE000) === 0x2000) {
    const kind = op >> 11 & 3, to = op >> 8 & 7, n = of(op & 0xFF), a = r[to];
    if (kind === 0) { r[to] = n; setFlags('value', n); }
    else if (kind === 1) setFlags('sub', a, n, to);
    else if (kind === 2) { const k = related(s, to) ? relation(s, to, op & 0xFF) : null; r[to] = add(a, n); s.rel[to] = k; s.kept = to; setFlags('add', a, n, to); }
    else { const k = related(s, to) ? relation(s, to, -(op & 0xFF)) : null; r[to] = sub(a, n); s.rel[to] = k; s.kept = to; setFlags('sub', a, n, to); }
    return go(s);
  }
  if ((op & 0xFC00) === 0x4000) {
    const kind = op >> 6 & 15, rs = op >> 3 & 7, rd = op & 7, a = r[rd], b = r[rs];
    switch (kind) {
      case 0x0: r[rd] = and(a, b); setFlags('value', r[rd]); return go(s);
      case 0x1: r[rd] = eor(a, b); setFlags('value', r[rd]); return go(s);
      case 0x2: r[rd] = shiftBy(a, b, lsl); setFlags('value', r[rd]); return go(s);
      case 0x3: r[rd] = shiftBy(a, b, lsr); setFlags('value', r[rd]); return go(s);
      case 0x4: r[rd] = shiftBy(a, b, asr); setFlags('value', r[rd]); return go(s);
      case 0x8: setFlags('and', a, b, rd, rs); return go(s);
      case 0x9: r[rd] = negate(b); setFlags('sub', of(0), b, null, rs); return go(s);
      case 0xA: setFlags('sub', a, b, rd, rs); return go(s);
      case 0xB: setFlags('add', a, b, rd, rs); return go(s);
      case 0xC: r[rd] = orr(a, b); setFlags('value', r[rd]); return go(s);
      case 0xD: r[rd] = mul(a, b); setFlags('value', r[rd]); return go(s);
      case 0xE: r[rd] = bic(a, b); setFlags('value', r[rd]); return go(s);
      case 0xF: r[rd] = mvn(b); setFlags('value', r[rd]); return go(s);
      case 0x7: r[rd] = ror(a, b); setFlags('value', r[rd]); return go(s);
      default: r[rd] = null; s.flags = null; return go(s);   // ADC, SBC: what they leave isn't followed
    }
  }
  if ((op & 0xFC00) === 0x4400) {
    const kind = op >> 8 & 3, from = op >> 3 & 15, to = (op & 7) | (op >> 4 & 8);
    // where the code is isn't a number: a game runs copies of its functions from its work memory
    const value = from === 15 ? null : from === 13 ? (s.sp === null ? null : { stack: s.sp }) : r[from];
    if (kind === 3) return [[null, s]];                                       // BX: out
    if (to === 15) return [[null, s]];                                        // to pc: out, or to where only a table says
    if (kind === 1) { setFlags('sub', to === 13 ? null : r[to], value, to, from); return go(s); }
    if (to === 13) {
      const v = kind === 0 ? add(s.sp === null ? null : { stack: s.sp }, value) : value;
      if (v?.stack !== undefined) s.sp = v.stack; else { s.sp = null; s.slots.clear(); }
      return go(s);
    }
    const k = from === 13 || from === 15 ? null : kind === 2 ? relation(s, from, 0) : known(value) !== null && related(s, to) ? relation(s, to, known(value) | 0) : known(r[to]) !== null ? relation(s, from, known(r[to]) | 0) : null;
    r[to] = kind === 0 ? add(r[to], value) : value;
    s.rel[to] = k;
    s.kept = to;
    return go(s);
  }
  if ((op & 0xF800) === 0x4800) {
    const at = ((address + pc + 4) & ~3) + (op & 0xFF) * 4;
    r[op >> 8 & 7] = load(s, of(at), 4, false, rom, new Set());
    return go(s);
  }
  // loads and stores
  // where it reads or writes, and, for a split, the register the place comes from and the number added to it
  let where = null, bytes = 0, isLoad = false, signed = false, reg = 0, base = null, offset = 0;
  if ((op & 0xF000) === 0x5000) {
    const kind = op >> 9 & 7, rb = op >> 3 & 7, ro = op >> 6 & 7;
    where = add(r[rb], r[ro]); reg = op & 7;
    if (known(r[ro]) !== null) [base, offset] = [rb, known(r[ro])];
    else if (known(r[rb]) !== null) [base, offset] = [ro, known(r[rb])];
    [bytes, isLoad, signed] = [[4, false, false], [2, false, false], [1, false, false], [1, true, true], [4, true, false], [2, true, false], [1, true, false], [2, true, true]][kind];
  } else if ((op & 0xE000) === 0x6000) {
    const byte = (op & 0x1000) !== 0;
    bytes = byte ? 1 : 4; isLoad = (op & 0x0800) !== 0; reg = op & 7;
    where = add(r[op >> 3 & 7], of((op >> 6 & 31) * bytes));
    [base, offset] = [op >> 3 & 7, (op >> 6 & 31) * bytes];
  } else if ((op & 0xF000) === 0x8000) {
    bytes = 2; isLoad = (op & 0x0800) !== 0; reg = op & 7;
    where = add(r[op >> 3 & 7], of((op >> 6 & 31) * 2));
    [base, offset] = [op >> 3 & 7, (op >> 6 & 31) * 2];
  } else if ((op & 0xF000) === 0x9000) {
    bytes = 4; isLoad = (op & 0x0800) !== 0; reg = op >> 8 & 7;
    where = s.sp === null ? null : { stack: s.sp + (op & 0xFF) * 4 };
  }
  if (bytes) {
    if (!isLoad) {
      store(s, where, bytes, r[reg]);
      return go(s);
    }
    // a read at a few places of the cartridge: once for each, the register it was worked out from following
    const places = listOf(where);
    if (base !== null && places && places.length >= 2 && places.length <= SPLIT && places.every(at => at >= CARTRIDGE && at + bytes <= CARTRIDGE + rom.length && at % bytes === 0)) {
      return go(...places.map(at => {
        const t = clone(s);
        constrain(t, base, wrap(at - offset));
        t.r[reg] = load(t, of(at), bytes, signed, rom, reads);
        t.rel[reg] = null;
        t.kept = reg;
        t.splits = [...t.splits, [address + pc, at]].slice(-KEPT_SPLITS);
        return t;
      }));
    }
    r[reg] = load(s, where, bytes, signed, rom, reads);
    return go(s);
  }
  if ((op & 0xF000) === 0xA000) {
    r[op >> 8 & 7] = op & 0x0800 ? (s.sp === null ? null : { stack: s.sp + (op & 0xFF) * 4 }) : null;
    return go(s);
  }
  if ((op & 0xFF00) === 0xB000) {
    if (s.sp !== null) s.sp += (op & 0x80 ? -1 : 1) * (op & 0x7F) * 4;
    return go(s);
  }
  if ((op & 0xF600) === 0xB400) {
    const pop = (op & 0x0800) !== 0, extra = (op & 0x0100) !== 0, list = [];
    for (let i = 0; i < 8; i++) if (op >> i & 1) list.push(i);
    if (extra) list.push(pop ? 15 : 14);
    if (!pop) {
      if (s.sp !== null) {
        s.sp -= 4 * list.length;
        list.forEach((reg_, i) => store(s, { stack: s.sp + 4 * i }, 4, r[reg_]));
      }
      return go(s);
    }
    list.forEach((reg_, i) => { if (reg_ < 15) r[reg_] = s.sp === null ? null : load(s, { stack: s.sp + 4 * i }, 4, false, rom, reads); });
    if (s.sp !== null) s.sp += 4 * list.length;
    return extra ? [[null, s]] : go(s);
  }
  if ((op & 0xF000) === 0xC000) {
    const base = op >> 8 & 7, load_ = (op & 0x0800) !== 0;
    let at = r[base];
    for (let i = 0; i < 8; i++) {
      if (!(op >> i & 1)) continue;
      if (load_) r[i] = load(s, at, 4, false, rom, reads); else store(s, at, 4, r[i]);
      at = add(at, of(4));
    }
    if (!(load_ && op >> base & 1)) r[base] = at;
    return go(s);
  }
  if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
    const cond = op >> 8 & 0xF, target = pc + 4 + ((op & 0xFF) << 24 >> 23), holds = outcome(cond, s.flags);
    const out = [];
    if (holds !== false) out.push([target >= 0 && target < size ? target : null, refined(clone(s), cond, true)]);
    if (holds !== true) out.push([next, refined(s, cond, false)]);
    return out;
  }
  if ((op & 0xF800) === 0xE000) {
    const target = pc + 4 + ((op & 0x7FF) << 21 >> 20);
    return [[target >= 0 && target < size ? target : null, s]];
  }
  if ((op & 0xF800) === 0xF000 && pc + 4 <= size && (u16(pc + 2) & 0xF800) === 0xF800) {
    // a call: it comes back with r0 to r3, r12 and the flags changed and the frame as it may have written it; one
    // into the function itself may be the long jump the compiler writes, so it goes on there too
    const target = pc + 4 + ((op & 0x7FF) << 21 >> 9 | (u16(pc + 2) & 0x7FF) << 1);
    const back = clone(s);
    for (const i of [0, 1, 2, 3, 12, 14]) back.r[i] = null;
    back.flags = null;
    back.slots.clear();
    back.lost = true;
    const out = [[pc + 4, back]];
    if (target >= 0 && target < size) out.push([target, s]);
    return out;
  }
  if ((op & 0xF800) === 0xF000) {
    // the first half of a call alone sets lr
    r[14] = null;
    return go(s);
  }
  if ((op & 0xFF00) === 0xDF00) {
    // a call of the BIOS: as a call
    for (const i of [0, 1, 2, 3, 12]) r[i] = null;
    s.flags = null;
    s.slots.clear();
    return go(s);
  }
  // anything else: an instruction the processor doesn't have, which stops it, or the second half of a call alone,
  // which jumps to where lr says
  return [[null, s]];
}

// what a branch going one way says of the register its comparison read: the numbers of it that go that way
function refined(s, cond, taken) {
  const f = s.flags;
  if (!f || !['sub', 'and', 'add'].includes(f.kind)) return s;
  for (const [side, reg] of [[0, f.ra], [1, f.rb]]) {
    if (reg === null || reg === undefined || reg > 7) continue;
    const mine = side ? f.b : f.a, other = side ? f.a : f.b;
    if (!same(s.r[reg], mine)) continue;
    const x = listOf(mine), y = listOf(other);
    if (!x || !y || x.length * y.length > FEW * FEW) continue;
    const kept = x.filter(p => y.some(q => holdsWith(cond, flagsOf(f.kind, side ? q : p, side ? p : q)) === taken));
    if (kept.length && kept.length < x.length) {
      s.r[reg] = few(kept);
      s.flags = { ...f, [side ? 'b' : 'a']: s.r[reg] };
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Which of r0 to r12 an instruction reads and which it writes, as masks: a register written before it's read again
// holds nothing the rest of the way goes by, so ways that differ only there are one.

const ALL = 0x1FFF, CALL_READS = 0x000F, CALL_WRITES = 0x100F;
const bitsOf = (...regs) => regs.reduce((m, r) => (r < 13 ? m | 1 << r : m), 0);
function readsWrites(op, next) {
  if ((op & 0xE000) === 0x0000 && (op & 0x1800) !== 0x1800) return [bitsOf(op >> 3 & 7), bitsOf(op & 7)];
  if ((op & 0xF800) === 0x1800) return [bitsOf(op >> 3 & 7, ...(op & 0x0400 ? [] : [op >> 6 & 7])), bitsOf(op & 7)];
  if ((op & 0xE000) === 0x2000) { const rd = op >> 8 & 7, kind = op >> 11 & 3; return [kind === 0 ? 0 : bitsOf(rd), kind === 1 ? 0 : bitsOf(rd)]; }
  if ((op & 0xFC00) === 0x4000) {
    const kind = op >> 6 & 15, rd = op & 7, rs = op >> 3 & 7;
    if (kind === 0x8 || kind === 0xA || kind === 0xB) return [bitsOf(rd, rs), 0];
    if (kind === 0x9 || kind === 0xF) return [bitsOf(rs), bitsOf(rd)];
    return [bitsOf(rd, rs), bitsOf(rd)];
  }
  if ((op & 0xFC00) === 0x4400) {
    const kind = op >> 8 & 3, rd = (op & 7) | (op >> 4 & 8), rm = op >> 3 & 15;
    if (kind === 3) return [ALL, 0];
    if (kind === 1) return [bitsOf(rd, rm), 0];
    if (kind === 2) return [bitsOf(rm), bitsOf(rd)];
    return [bitsOf(rd, rm), bitsOf(rd)];
  }
  if ((op & 0xF800) === 0x4800) return [0, bitsOf(op >> 8 & 7)];
  if ((op & 0xF000) === 0x5000) { const load = (op >> 9 & 7) >= 3; return [bitsOf(op >> 3 & 7, op >> 6 & 7, ...(load ? [] : [op & 7])), load ? bitsOf(op & 7) : 0]; }
  if ((op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000) { const load = (op & 0x0800) !== 0; return [bitsOf(op >> 3 & 7, ...(load ? [] : [op & 7])), load ? bitsOf(op & 7) : 0]; }
  if ((op & 0xF000) === 0x9000) { const load = (op & 0x0800) !== 0; return [load ? 0 : bitsOf(op >> 8 & 7), load ? bitsOf(op >> 8 & 7) : 0]; }
  if ((op & 0xF000) === 0xA000) return [0, bitsOf(op >> 8 & 7)];
  if ((op & 0xFF00) === 0xB000) return [0, 0];
  if ((op & 0xF600) === 0xB400) return op & 0x0800 ? [0, op & 0xFF] : [op & 0xFF, 0];
  if ((op & 0xF000) === 0xC000) { const rb = bitsOf(op >> 8 & 7); return op & 0x0800 ? [rb, (op & 0xFF) | rb] : [rb | (op & 0xFF), rb]; }
  if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) return [0, 0];
  if ((op & 0xFF00) === 0xDF00) return [CALL_READS, CALL_WRITES];
  if ((op & 0xF800) === 0xE000) return [0, 0];
  if ((op & 0xF800) === 0xF000 && (next & 0xF800) === 0xF800) return [CALL_READS, CALL_WRITES];
  return [ALL, 0];
}

// For each instruction of a function, at offsets `instructions` (a Set), the registers among r0 to r12 a way from it
// may read before writing, as a mask, and the places a branch goes back to (`heads`), which every loop comes round to:
// a way out of the function reads none.
function loopsAndLiveness(u16, size, instructions) {
  const live = new Map(), next = new Map(), use = new Map(), heads = new Set();
  for (const at of instructions) {
    const op = u16(at), after = at + 2 < size ? u16(at + 2) : 0, to = [];
    use.set(at, readsWrites(op, after));
    let target = null;
    if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) to.push(target = at + 4 + ((op & 0xFF) << 24 >> 23), at + 2);
    else if ((op & 0xF800) === 0xE000) to.push(target = at + 4 + ((op & 0x7FF) << 21 >> 20));
    else if ((op & 0xF800) === 0xF000 && (after & 0xF800) === 0xF800) to.push(at + 4, target = at + 4 + ((op & 0x7FF) << 21 >> 9 | (after & 0x7FF) << 1));
    else if (!((op & 0xFC00) === 0x4400 && ((op >> 8 & 3) === 3 || ((op & 7) | (op >> 4 & 8)) === 15)) && !((op & 0xFF00) === 0xBD00)) to.push(at + 2);
    if (target !== null && target <= at && instructions.has(target)) heads.add(target);
    next.set(at, to.filter(t => instructions.has(t)));
    live.set(at, 0);
  }
  const order = [...instructions].sort((a, b) => b - a);
  for (let changed = true; changed;) {
    changed = false;
    for (const at of order) {
      const [reads, writes] = use.get(at);
      let out = 0;
      for (const t of next.get(at)) out |= live.get(t);
      const now = reads | (out & ~writes);
      if (now !== live.get(at)) { live.set(at, now); changed = true; }
    }
  }
  return { live, heads };
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * The conditional branches of one function the whole function's reading decides: each as { address, way, by, read,
 * aside }, `way` the one that can't happen, `by` the instruction that set the flags each way into it goes by, `read`
 * the stretches of the cartridge it read values from, as [from, to] addresses, and `aside` the words of the cartridge
 * pointing into the function that weren't taken as ways in. `bytes` are the function's, at `address`, `rom` the
 * cartridge's bytes and `targets` what lib/decided.mjs's arrivals gives; `aside`, a Map from an address in the
 * function to the words that point there, which words-into.mjs found may be set aside, each as { at, value }, and only
 * when every word pointing there is among them; `budget` how many places the reading may go through. Nothing, when it
 * doesn't end within them.
 */
export function decidedAcross(bytes, address, rom, targets, { aside = new Map(), budget = STEPS } = {}) {
  const size = bytes.length, u16 = at => bytes[at] | bytes[at + 1] << 8;
  if (size < 2 || isArm(bytes)) return [];
  const { instructions } = instructionsOf(bytes);
  // where the reading starts: the function's start as it's called, and each place something from outside the
  // function's own instructions arrives at, as a word of the cartridge holding its address may have something jump
  // there, with nothing known of the registers or the stack there but where the stack pointer points
  const starts = [[0, fresh()]], setAside = [];
  for (const at of instructions) {
    if (at === 0) continue;
    const from = targets.get(address + at), words = aside.get(address + at);
    if (!from) continue;
    const outside = [...from].filter(source => (typeof source !== 'number' ? !words : source < address || source >= address + size));
    if (outside.length) starts.push([at, fresh(at)]);
    else if (words) setAside.push(...words);
  }
  // the states at each place, by their way's start and last splits: kept apart while the registers the code goes on to
  // read hold different single numbers, as a loop's counter does, up to VARIANTS of them, and then no longer by the
  // register that holds the most, as an outer loop's counter does, so an inner loop that counts a few times is still
  // read a time at a time. A value that goes on growing is widened only where a loop comes round to the place with the
  // same key it left with, a loop with nothing that keeps its turns apart: one whose counter does ends by itself.
  const { live, heads } = loopsAndLiveness(u16, size, new Set(instructions));
  const states = new Map(), groups = new Map(), visits = new Map(), work = [];
  const reads = new Set();
  const arrive = (at, s) => {
    const group = `${at}|${keyOf(s)}`, reading = live.get(at) ?? ALL;
    let kept = groups.get(group);
    if (!kept) groups.set(group, kept = { variants: new Set(), freed: new Set() });
    const key = `${group}#${signature(s, kept.freed, reading)}`;
    const old = states.get(key);
    if (!old) {
      if (kept.variants.size < VARIANTS) {
        kept.variants.add(key);
        states.set(key, { at, state: s });
        work.push(key);
        return;
      }
      while (kept.variants.size >= VARIANTS && kept.freed.size < 13) {
        const all = [...kept.variants].map(variant => states.get(variant).state).concat([s]);
        let most = -1, which = -1;
        for (let i = 0; i < 13; i++) {
          if (kept.freed.has(i)) continue;
          const numbers = new Set(all.map(t => known(t.r[i])).filter(n => n !== null)).size;
          if (numbers > most) [most, which] = [numbers, i];
        }
        kept.freed.add(which);
        const joined = new Map();
        for (const variant of kept.variants) {
          const t = states.get(variant).state, k = `${group}#${signature(t, kept.freed, reading)}`;
          states.delete(variant);
          joined.set(k, joined.has(k) ? joinStates(joined.get(k), t, false) : t);
        }
        kept.variants = new Set(joined.keys());
        for (const [k, t] of joined) {
          states.set(k, { at, state: t });
          work.push(k);
        }
      }
      return arrive(at, s);
    }
    const count = (visits.get(key) ?? 0) + 1;
    visits.set(key, count);
    const merged = joinStates(old.state, s, count > WIDEN_AFTER && heads.has(at) && s.passed.get(at) === key);
    if (sameState(merged, old.state)) return;
    old.state = merged;
    work.push(key);
  };
  for (const [at, s] of starts) arrive(at, s);
  // each branch's ways, from each state that reached it
  const branches = new Map();
  let steps = 0;
  while (work.length) {
    const key = work.pop(), held = states.get(key);
    if (!held) continue;
    if (++steps > budget || states.size > STATES) return [];
    const { at, state } = held;
    if (at < 0 || at + 2 > size) continue;
    const op = u16(at);
    const isBranch = (op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE;
    const out = stepAll(clone(state), at, u16, size, address, rom, reads);
    if (heads.has(at)) for (const [, t] of out) t.passed.set(at, key);
    // a register the instruction wrote without relating it to another loses the relation it had
    for (const [, t] of out) {
      for (let i = 0; i < 16; i++) if (t.r[i] !== state.r[i] && t.kept !== i) t.rel[i] = null;
      delete t.kept;
    }
    if (isBranch) {
      const holds = outcome(op >> 8 & 0xF, state.flags);
      const seen = branches.get(at) ?? { taken: false, notTaken: false, by: new Set() };
      if (holds !== false) seen.taken = true;
      if (holds !== true) seen.notTaken = true;
      seen.by.add(state.flags?.pc ?? null);
      branches.set(at, seen);
    }
    for (const [to, s] of out) if (to !== null) arrive(to, s);
  }
  const read = [];
  for (const [at, n] of [...reads].map(key => key.split(':').map(Number)).sort((a, b) => a[0] - b[0])) {
    if (read.length && at <= read.at(-1)[1] + 1) read.at(-1)[1] = Math.max(read.at(-1)[1], at + n - 1);
    else read.push([at, at + n - 1]);
  }
  const found = [];
  for (const [at, seen] of [...branches].sort((a, b) => a[0] - b[0])) {
    if (seen.taken && seen.notTaken) continue;
    const by = [...seen.by];
    found.push({ address: address + at, way: seen.taken ? 'not taken' : 'taken', by: by.length === 1 ? by[0] : null, read, aside: setAside });
  }
  return found;
}

// a function in ARM instructions, by its first words
function isArm(bytes) {
  if (bytes.length < 16 || bytes.length % 4) return false;
  const word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  return [0, 4, 8, 12].map(word).filter(w => w >>> 28 === 0xE).length >= 3;
}

export { few as valuesOf, span as rangeFrom, outcome as conditionHolds };

/**
 * Every conditional branch of the cartridge's Thumb functions the reading across each decides that `known`, the
 * straight runs' (lib/decided.mjs), doesn't: each as decidedAcross gives it, with `from`, the function's address.
 * Each function is read with every word of the cartridge pointing into it as a way in, and then, where some may be set
 * aside (words-into.mjs), again without those: a branch only that decides has them in `aside`, to be named.
 * `budget` is how many places each function's reading may go through.
 */
export function decidedAcrossBranches(rom, functions, known = [], { budget = STEPS } = {}) {
  const inRom = functions.filter(f => !f.bytes && f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length);
  const targets = arrivals(rom, inRom), aside = wordsSetAside(rom, inRom);
  const already = new Set(known.map(d => d.address)), found = [];
  for (const f of inRom) {
    const bytes = rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
    const strict = decidedAcross(bytes, f.address, rom, targets, { budget });
    for (const d of strict) if (!already.has(d.address)) found.push({ ...d, from: f.address, aside: [] });
    const words = new Map([...aside].filter(([target]) => target > f.address && target < f.address + f.size));
    if (!words.size) continue;
    const ways = new Set(strict.map(d => `${d.address}/${d.way}`));
    for (const d of decidedAcross(bytes, f.address, rom, targets, { aside: words, budget })) {
      if (!already.has(d.address) && !ways.has(`${d.address}/${d.way}`)) found.push({ ...d, from: f.address });
    }
  }
  return found;
}
