// Where the game's pointers can point (#1538), for the never-written check (never-written.mjs): a whole-program pass over
// the cartridge's Thumb code that works out, for each store and load through a register, the set of places its base can
// hold. It's sound and conservative: what it can't bound is "anywhere", and in doubt it widens, never narrows.
//
// A value is "anywhere" (null) or a small set of what it can be, each one of:
//   'c<n>'          a number, which is also how an address the code names is kept
//   'h<site>:<off>' the object the allocator's call at <site> gave, <off> bytes in, or 'h<site>:*' anywhere in it
//   's<fn>:<off>'   function <fn>'s own stack, <off> from where the stack pointer was as it started, or 's<fn>:*'
// A set that grows past SIZE_CAP is "anywhere".
//
// Memory is cells, each the join of every value stored there: a word of the work memory at a known address, a word of
// an allocator's object, a word of a function's stack. The cartridge is read-only, so a load from it is the number its
// copy holds; the work memory starts as 0. What a store the pass can't bound stores may land in any cell, so it's joined
// into every load from the work memory: one that stores a pointer, or anything narrower than a word, which may change
// part of a pointer, makes every such load "anywhere". So does code the pass doesn't read: ARM code, and code in the
// work memory that isn't a copy of the cartridge's. That's the price of never guessing.
//
// A function's own stack is followed within it: a slot it surely stored before, on every way there, is read back as
// what it stored, and any other, or one of its caller's above it, is "anywhere".
//
// Across calls: a function called directly, whose address the cartridge never keeps as a value, starts with each
// register the join of what every call gives it; any other starts with "anywhere" in each, as code the pass doesn't
// see may call it. What it gives back is the join of r0 at its returns. An allocator's call gives an object of its own,
// kept apart by the call that made it, inside the arena it hands out from. After a call, r4 to r7 are as they were only
// where the called function provably keeps them (it pushes them, or neither it nor what it calls writes them), and
// every register but r0 and the stack pointer is "anywhere".

const CARTRIDGE = 0x08000000;
const EWRAM = 0x02000000, EWRAM_END = 0x02040000, IWRAM = 0x03000000, IWRAM_END = 0x03008000;
const SIZE_CAP = 24;
const ANYWHERE = null;
const u32 = n => n >>> 0;
const hex = n => `0x${u32(n).toString(16).toUpperCase().padStart(8, '0')}`;
const inWork = a => (a >= EWRAM && a < EWRAM_END) || (a >= IWRAM && a < IWRAM_END);

const number = n => new Set([`c${u32(n)}`]);
const NOTHING = new Set();

function join(a, b) {
  if (a === ANYWHERE || b === ANYWHERE) return ANYWHERE;
  if (!a.size) return b;
  if (!b.size) return a;
  const all = new Set(a);
  for (const e of b) all.add(e);
  return all.size > SIZE_CAP ? ANYWHERE : all;
}
const same = (a, b) => (a === ANYWHERE || b === ANYWHERE ? a === b : a.size === b.size && [...a].every(e => b.has(e)));
// the numbers a value can be, or null if it can be anything else
function numbers(v) {
  if (v === ANYWHERE) return null;
  const out = [];
  for (const e of v) {
    if (e[0] !== 'c') return null;
    out.push(Number(e.slice(1)));
  }
  return out;
}
// a place of an object or a stack, as [kind, owner, offset or null]
const place = e => {
  const at = e.lastIndexOf(':'), offset = e.slice(at + 1);
  return [e[0], e.slice(1, at), offset === '*' ? null : Number(offset)];
};
// the value moved on by `k` bytes, or by an amount the pass can't know (k null)
function moved(v, k) {
  if (v === ANYWHERE) return ANYWHERE;
  const out = new Set();
  for (const e of v) {
    if (e[0] === 'c') {
      if (k === null) return ANYWHERE;
      out.add(`c${u32(Number(e.slice(1)) + k)}`);
    } else {
      const [kind, owner, offset] = place(e);
      out.add(`${kind}${owner}:${k === null || offset === null ? '*' : offset + k}`);
    }
  }
  return out.size > SIZE_CAP ? ANYWHERE : out;
}
const placesOnly = v => v !== ANYWHERE && v.size > 0 && [...v].every(e => e[0] !== 'c');
// a + b: a place plus a number moves the place, two numbers add, a place of an object or a stack plus what the pass
// can't know stays in that object or stack, and anything else is anywhere
function plus(a, b) {
  const na = numbers(a), nb = numbers(b);
  if (na && nb) {
    const out = new Set();
    for (const x of na) for (const y of nb) out.add(`c${u32(x + y)}`);
    return out.size > SIZE_CAP ? ANYWHERE : out;
  }
  if (nb && nb.length === 1) return moved(a, nb[0]);
  if (na && na.length === 1) return moved(b, na[0]);
  if (placesOnly(a) && !placesOnly(b)) return moved(a, null);
  if (placesOnly(b) && !placesOnly(a)) return moved(b, null);
  return ANYWHERE;
}
// an operation on numbers only, or anywhere
function arith(a, b, f) {
  const na = numbers(a), nb = b === undefined ? [0] : numbers(b);
  if (!na || !nb) return ANYWHERE;
  const out = new Set();
  for (const x of na) for (const y of nb) out.add(`c${u32(f(x, y))}`);
  return out.size > SIZE_CAP ? ANYWHERE : out;
}

// a function in ARM instructions, by its first words
export function isArm(bytes) {
  if (bytes.length < 16 || bytes.length % 4) return false;
  const word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  return [0, 4, 8, 12].map(word).filter(w => w >>> 28 === 0xE).length >= 3;
}
const isCall = (u16, at, size) => (u16(at) & 0xF800) === 0xF000 && at + 4 <= size && (u16(at + 2) & 0xF800) === 0xF800;
const callTarget = (u16, at, address) => u32(address + at + 4 + ((u16(at) & 0x7FF) << 21 >> 9) + ((u16(at + 2) & 0x7FF) << 1));

// the registers a Thumb instruction may write, for whether a function keeps r4 to r7
function destinations(op) {
  if ((op & 0xE000) === 0x2000) return (op >> 11 & 3) === 1 ? [] : [op >> 8 & 7];
  if ((op & 0xFC00) === 0x4000) return [0x8, 0xA, 0xB].includes(op >> 6 & 15) ? [] : [op & 7];
  if ((op & 0xE000) === 0x0000) return [op & 7];
  if ((op & 0xFC00) === 0x4400) return (op >> 8 & 3) === 0 || (op >> 8 & 3) === 2 ? [(op & 7) | (op >> 4 & 8)] : [];
  if ((op & 0xF800) === 0x4800) return [op >> 8 & 7];
  if ((op & 0xF000) === 0x5000) return (op >> 9 & 7) >= 3 ? [op & 7] : [];
  if ((op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000) return op & 0x0800 ? [op & 7] : [];
  if ((op & 0xF000) === 0x9000) return op & 0x0800 ? [op >> 8 & 7] : [];
  if ((op & 0xF000) === 0xA000) return [op >> 8 & 7];
  if ((op & 0xF600) === 0xB400) return op & 0x0800 ? [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1) : [];
  if ((op & 0xF000) === 0xC000) return [op >> 8 & 7, ...(op & 0x0800 ? [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1) : [])];
  if ((op & 0xFF00) === 0xB000 || (op & 0xF000) === 0xD000 || (op & 0xF800) === 0xE000) return [];
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

// the BIOS's calls that write no memory, and those whose writes from r1 on the pass can't bound
const QUIET = new Set([0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0D, 0x1F, 0x00, 0x01]);

/**
 * The pass, over the whole cartridge. `rom` is its bytes, `functions` the code map's, and `allocators` a Map from the
 * address of each allocator function to the arena it hands out from, { from, to }. `copies` are the code map's copies,
 * { ram, cartridge, size }, for code the game runs from its work memory. `seconds` and `cells` limit how long it runs
 * and how much it keeps. Answers { stores, loads, swis, bounded, unbounded, complete, why, passes, seconds }: for each
 * store's and load's address, { base, offset, size, value } as the pass ends, and for each swi the registers it's given.
 * `complete` is false when it ran past its limit, and then nothing it says may be used.
 */
export function pointsTo(rom, functions, { allocators = new Map(), copies = [], seconds = 120, cells: cellLimit = 2_000_000 } = {}) {
  const began = Date.now();
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length);
  const inRom = a => a >= CARTRIDGE && a < CARTRIDGE + rom.length;
  const romValue = (a, size, signed) => {
    if (!inRom(a) || !inRom(a + size - 1)) return ANYWHERE;
    let v = size === 4 ? view.getUint32(a - CARTRIDGE, true) : size === 2 ? view.getUint16(a - CARTRIDGE, true) : view.getUint8(a - CARTRIDGE);
    if (signed) v = size === 2 ? (v << 16) >> 16 : (v << 24) >> 24;
    return number(v);
  };
  const bytesOf = f => rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
  const inCartridge = functions.filter(f => !f.bytes && inRom(f.address) && f.address + f.size <= CARTRIDGE + rom.length);
  const thumb = inCartridge.filter(f => !isArm(bytesOf(f)));
  const byAddress = new Map(thumb.map(f => [f.address, f]));
  const known = new Set(functions.map(f => f.address));
  const why = [];
  // code the pass doesn't read may store anything anywhere
  const unread = [...inCartridge.filter(f => !byAddress.has(f.address)).map(f => `the ARM code at ${hex(f.address)}`),
    ...functions.filter(f => !inCartridge.includes(f) && !copies.some(c => f.address >= c.ram && f.address + f.size <= c.ram + c.size)).map(f => `the code at ${hex(f.address)} in the work memory`)];
  // where code the pass doesn't see may arrive: a word of the cartridge outside a function's own bytes, and a branch
  // from another function, pointing into the middle of a function
  const owner = a => thumb.find(f => a > f.address && a < f.address + f.size);
  const foreign = new Set(), escaped = new Set(), called = new Set();
  const sorted = [...thumb].sort((a, b) => a.address - b.address);
  const inside = a => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].address + sorted[mid].size <= a) lo = mid + 1; else hi = mid; }
    const f = sorted[lo];
    return f && a >= f.address && a < f.address + f.size ? f : null;
  };
  for (let at = 0; at + 4 <= rom.length; at += 4) {
    const w = view.getUint32(at, true), to = w & ~1;
    if (known.has(to)) escaped.add(to);
    const f = inside(to);
    if (f && to !== f.address && !(CARTRIDGE + at >= f.address && CARTRIDGE + at < f.address + f.size)) foreign.add(to);
  }
  // the compiler's helpers that call a function through a register: two bytes, bx rN
  const viaRegister = new Map();
  for (const f of thumb) {
    const op = view.getUint16(f.address - CARTRIDGE, true);
    if (f.size <= 4 && (op & 0xFF87) === 0x4700 && (op >> 3 & 15) < 13) viaRegister.set(f.address, op >> 3 & 15);
  }
  const keeps = new Map(), callees = new Map(), wrote = new Map(), pushed = new Map();
  for (const f of thumb) {
    const bytes = bytesOf(f), u16 = at => bytes[at] | bytes[at + 1] << 8, writes = new Set(), direct = new Set();
    let opaque = false;
    for (let at = 0; at + 2 <= bytes.length; at += 2) {
      const op = u16(at);
      if (isCall(u16, at, bytes.length)) {
        const target = callTarget(u16, at, f.address);
        if (viaRegister.has(target) || !byAddress.has(target)) opaque = true;
        else direct.add(target);
        called.add(target);
        const g = inside(target);
        if (g && target !== g.address) foreign.add(target);
        at += 2;
        continue;
      }
      if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE || (op & 0xF800) === 0xE000) {
        const target = (op & 0xF800) === 0xE000 ? f.address + at + 4 + ((op & 0x7FF) << 21 >> 20) : f.address + at + 4 + ((op & 0xFF) << 24 >> 23);
        if (target < f.address || target >= f.address + f.size) { const g = inside(target); if (g) { if (target === g.address) called.add(target); else foreign.add(target); } }
      }
      for (const r of destinations(op)) writes.add(r);
      if ((op & 0xFF87) === 0x4700 && (op >> 3 & 15) !== 14) opaque = true;
    }
    const first = [0, 2, 4, 6].map(at => (at + 2 <= bytes.length ? u16(at) : 0)).find(op => (op & 0xFE00) === 0xB400);
    pushed.set(f.address, new Set(first === undefined ? [] : [0, 1, 2, 3, 4, 5, 6, 7].filter(r => first >> r & 1)));
    wrote.set(f.address, writes);
    callees.set(f.address, opaque ? null : direct);
    keeps.set(f.address, new Set([4, 5, 6, 7]));
  }
  void owner;
  for (let again = true; again;) {
    again = false;
    for (const f of thumb) {
      const kept = keeps.get(f.address), direct = callees.get(f.address);
      for (const r of [...kept]) {
        if (pushed.get(f.address).has(r) || (!wrote.get(f.address).has(r) && direct !== null && [...direct].every(c => keeps.get(c)?.has(r)))) continue;
        kept.delete(r);
        again = true;
      }
    }
  }

  const args = new Map(), returns = new Map(), cells = new Map(), sites = new Map();
  let anyStore = unread.length ? ANYWHERE : NOTHING, changed = true, complete = true, firstUnbounded = null;
  if (unread.length) why.push(`${unread.length} pieces of code the pass doesn't read, such as ${unread[0]}, may store anything anywhere`);
  const widenAll = reason => { if (anyStore !== ANYWHERE) { anyStore = ANYWHERE; changed = true; if (why.length < 8) why.push(reason); } };
  const grow = (key, v) => {
    const before = cells.has(key) ? cells.get(key) : NOTHING, after = join(before, v);
    if (!cells.has(key) || !same(before, after)) { cells.set(key, after); changed = true; }
  };
  const cell = key => (cells.has(key) ? cells.get(key) : NOTHING);
  const stores = new Map(), loads = new Map(), swis = new Map();

  const analyse = f => {
    const bytes = bytesOf(f), u16 = at => bytes[at] | bytes[at + 1] << 8, me = `s${f.address}`;
    const open = escaped.has(f.address) || !called.has(f.address);
    const given = args.get(f.address);
    const r0 = new Array(16).fill(ANYWHERE);
    for (let i = 0; i < 13; i++) r0[i] = open ? ANYWHERE : given?.[i] ?? NOTHING;
    r0[13] = new Set([`${me}:0`]);
    const states = new Map([[0, { r: r0, stored: new Set() }]]), queue = [0];
    const widened = () => ({ r: new Array(16).fill(ANYWHERE), stored: new Set() });
    const into = (at, s) => {
      if (at < 0 || at + 2 > bytes.length) return;
      if (foreign.has(f.address + at)) s = widened();
      const had = states.get(at);
      if (!had) { states.set(at, { r: s.r.slice(), stored: new Set(s.stored) }); queue.push(at); return; }
      let grew = false;
      const r = had.r.map((v, i) => { const j = join(v, s.r[i]); if (!same(v, j)) grew = true; return j; });
      const stored = new Set([...had.stored].filter(k => s.stored.has(k)));
      if (stored.size !== had.stored.size) grew = true;
      if (grew) { states.set(at, { r, stored }); queue.push(at); }
    };
    // a load of `size` bytes from each place `base` can be, `offset` on
    const load = (s, base, offset, size, signed) => {
      if (base === ANYWHERE) return ANYWHERE;
      const at = moved(base, offset);
      if (at === ANYWHERE) return ANYWHERE;
      let out = NOTHING;
      for (const e of at) {
        let word, low;
        if (e[0] === 'c') {
          const a = Number(e.slice(1));
          if (inRom(a)) { out = join(out, romValue(a, size, signed)); continue; }
          if (!inWork(a)) return ANYWHERE;
          word = join(join(cell(`a${a & ~3}`), number(0)), anyStore);
          for (const [site, arena] of sites) if (a >= arena.from && a < arena.to) word = join(word, cell(`h${site}`));
          low = a & 3;
        } else {
          const [kind, who, off] = place(e);
          if (off === null) return ANYWHERE;
          if (kind === 's') {
            // its own slot it surely stored before: what it stored; any other slot of a stack: anything
            if (`${kind}${who}` !== me || off >= 0 || !s.stored.has(off & ~3)) return ANYWHERE;
            word = cell(`${me}:${off & ~3}`);
          } else {
            word = join(join(join(cell(`h${who}:${off & ~3}`), cell(`h${who}:*`)), anyStore), cell(`r${who}`));
          }
          low = off & 3;
        }
        if (size === 4) { out = join(out, low ? ANYWHERE : word); continue; }
        // a byte or a halfword of numbers: their part; of a place, anything
        const n = numbers(word);
        if (!n) return ANYWHERE;
        out = join(out, new Set(n.map(v => {
          let part = (v >>> (8 * low)) & (size === 2 ? 0xFFFF : 0xFF);
          if (signed) part = size === 2 ? (part << 16) >> 16 : (part << 24) >> 24;
          return `c${u32(part)}`;
        })));
      }
      return out;
    };
    // a store of `size` bytes of `value` to each place `base` can be, `offset` on
    const store = (s, pc, base, offset, size, value) => {
      stores.set(pc, { base, offset, size, value });
      const whole = size === 4 ? value : ANYWHERE;
      const at = base === ANYWHERE ? ANYWHERE : moved(base, offset);
      if (at === ANYWHERE) {
        if (firstUnbounded === null) { firstUnbounded = pc; why.push(`the store at ${hex(pc)} writes through a base the pass can't bound`); }
        const before = anyStore;
        anyStore = join(anyStore, whole);
        if (!same(before, anyStore)) changed = true;
        return;
      }
      for (const e of at) {
        if (e[0] === 'c') {
          const a = Number(e.slice(1));
          if (a >= 0x040000B0 && a < 0x040000E0) { dma(s, pc, a, size, value); continue; }
          if (!inWork(a)) continue;
          grow(`a${a & ~3}`, a & 3 ? ANYWHERE : whole);
          for (const [site, arena] of sites) if (a >= arena.from && a < arena.to) grow(`r${site}`, ANYWHERE);
        } else {
          const [kind, who, off] = place(e);
          if (off === null) { grow(`${kind}${who}:*`, ANYWHERE); continue; }
          grow(`${kind}${who}:${off & ~3}`, size !== 4 || off & 3 ? ANYWHERE : whole);
          if (`${kind}${who}` === me && size === 4 && !(off & 3)) s.stored.add(off);
        }
      }
      if (cells.size > cellLimit) complete = false;
    };
    // a store to a DMA channel's registers: the destination it's given, then a start writes where it says, what the
    // pass doesn't follow
    const channels = [{}, {}, {}, {}];
    const dma = (s, pc, a, size, value) => {
      const channel = (a - 0x040000B0) / 12 | 0, at = (a - 0x040000B0) % 12;
      if (at === 4 && size === 4) { channels[channel].dest = value; return; }
      if (at + size <= 8) return;
      const control = numbers(at === 8 && size === 4 ? value : ANYWHERE);
      const counts = control ? control.map(v => v & 0xFFFF) : null, starts = control ? control.some(v => v >>> 31) : true;
      if (at === 10 || (at === 8 && size === 2)) { widenAll(`the DMA started at ${hex(pc)} writes where the pass can't bound`); return; }
      if (!starts) return;
      const dests = numbers(channels[channel].dest ?? ANYWHERE);
      if (!dests || !counts) { widenAll(`the DMA started at ${hex(pc)} writes where the pass can't bound`); return; }
      for (const d of dests) {
        if (d >= 0x04000000 && d < 0x04000400) continue;
        const length = Math.max(...counts.map(c => c || 0x10000)) * 4;
        for (let w = d & ~3; w < d + length; w += 4) if (inWork(w)) grow(`a${w}`, ANYWHERE);
      }
    };
    // what a call leaves: r0 from what it gives back, r4 to r7 where it keeps them, and nothing else known
    const afterCall = (s, called, site) => {
      const r = s.r.slice();
      for (const i of [1, 2, 3, 8, 9, 10, 11, 12, 14]) r[i] = ANYWHERE;
      if (called === null) { for (const i of [0, 4, 5, 6, 7]) r[i] = ANYWHERE; return { r, stored: s.stored }; }
      let back = NOTHING;
      for (const c of called) {
        if (allocators.has(c)) {
          if (!sites.has(site)) { sites.set(site, { ...allocators.get(c), callee: c }); changed = true; }
          back = join(back, new Set([`h${site}:0`]));
        } else back = join(back, byAddress.has(c) ? (returns.get(c) ?? NOTHING) : ANYWHERE);
        for (const i of [4, 5, 6, 7]) if (!keeps.get(c)?.has(i)) r[i] = ANYWHERE;
      }
      r[0] = back;
      return { r, stored: s.stored };
    };
    const call = (s, called) => {
      if (called === null) return;
      for (const c of called) {
        if (!byAddress.has(c)) continue;
        const had = args.get(c) ?? new Array(13).fill(NOTHING);
        const now = had.map((v, i) => join(v, s.r[i]));
        if (now.some((v, i) => !same(v, had[i]))) { args.set(c, now); changed = true; }
      }
    };
    const functionsIn = v => {
      const n = numbers(v);
      if (!n) return null;
      const out = n.map(x => x & ~1);
      return out.every(x => known.has(x)) ? out : null;
    };
    const giveBack = v => {
      const before = returns.has(f.address) ? returns.get(f.address) : NOTHING, after = join(before, v);
      if (!returns.has(f.address) || !same(before, after)) { returns.set(f.address, after); changed = true; }
    };
    while (queue.length) {
      if (Date.now() - began > seconds * 1000) { complete = false; return; }
      const at = queue.pop(), s = { r: states.get(at).r.slice(), stored: new Set(states.get(at).stored) }, r = s.r, op = u16(at), pc = f.address + at;
      if (isCall(u16, at, bytes.length)) {
        const target = callTarget(u16, at, f.address);
        const called = viaRegister.has(target) ? functionsIn(r[viaRegister.get(target)]) : [target];
        call(s, called);
        into(at + 4, afterCall(s, called, pc));
        continue;
      }
      const lo = op & 7, mid = op >> 3 & 7;
      if ((op & 0xE000) === 0x0000 && (op & 0x1800) !== 0x1800) {
        const kind = op >> 11 & 3, by = op >> 6 & 31;
        r[lo] = arith(r[mid], undefined, x => (kind === 0 ? x << by : kind === 1 ? (by ? x >>> by : 0) : (by ? x >> by : x >> 31)));
      } else if ((op & 0xF800) === 0x1800) {
        const b = op & 0x0400 ? number(op >> 6 & 7) : r[op >> 6 & 7], nb = numbers(b);
        r[lo] = op & 0x0200 ? (nb && nb.length === 1 ? moved(r[mid], -nb[0]) : arith(r[mid], b, (x, y) => x - y)) : plus(r[mid], b);
      } else if ((op & 0xE000) === 0x2000) {
        const kind = op >> 11 & 3, rd = op >> 8 & 7, n = op & 0xFF;
        if (kind === 0) r[rd] = number(n);
        else if (kind === 2) r[rd] = moved(r[rd], n);
        else if (kind === 3) r[rd] = moved(r[rd], -n);
      } else if ((op & 0xFC00) === 0x4000) {
        const kind = op >> 6 & 15, a = r[lo], b = r[mid];
        const ops = { 0x0: (x, y) => x & y, 0x1: (x, y) => x ^ y, 0x2: (x, y) => ((y & 0xFF) >= 32 ? 0 : x << (y & 0xFF)), 0x3: (x, y) => ((y & 0xFF) >= 32 ? 0 : x >>> (y & 0xFF)), 0x4: (x, y) => x >> Math.min(y & 0xFF, 31), 0xC: (x, y) => x | y, 0xD: (x, y) => Math.imul(x, y), 0xE: (x, y) => x & ~y };
        if (kind === 0x9) r[lo] = arith(b, undefined, x => -x);
        else if (kind === 0xF) r[lo] = arith(b, undefined, x => ~x);
        else if (ops[kind]) r[lo] = arith(a, b, ops[kind]);
        else if (![0x8, 0xA, 0xB].includes(kind)) r[lo] = ANYWHERE;
      } else if ((op & 0xFC00) === 0x4400) {
        const kind = op >> 8 & 3, from = op >> 3 & 15, to = (op & 7) | (op >> 4 & 8);
        const value = from === 15 ? number(pc + 4) : r[from];
        if (kind === 3) {
          // BX: a return, or a jump to a function that returns for this one
          if (from === 14) { giveBack(r[0]); continue; }
          const called = functionsIn(value);
          call(s, called);
          giveBack(afterCall(s, called, pc).r[0]);
          continue;
        }
        if (to === 15) {
          if (kind === 2 && from === 14) { giveBack(r[0]); continue; }
          // a jump through a register, as a switch: to each place the cartridge's words point into this function
          for (let w = 0; w + 4 <= bytes.length; w += 2) {
            const t = ((bytes[w] | bytes[w + 1] << 8 | bytes[w + 2] << 16 | bytes[w + 3] << 24) >>> 0) & ~1;
            if (t > f.address && t < f.address + f.size) into(t - f.address, s);
          }
          for (const t of foreign) if (t > f.address && t < f.address + f.size) into(t - f.address, s);
          continue;
        }
        if (to === 13) r[13] = kind === 2 ? value : plus(r[13], value);
        else if (kind === 0) r[to] = plus(r[to], value);
        else if (kind === 2) r[to] = value;
      } else if ((op & 0xF800) === 0x4800) {
        r[op >> 8 & 7] = romValue(((pc + 4) & ~3) + (op & 0xFF) * 4, 4, false);
      } else if ((op & 0xF000) === 0x5000) {
        const kind = op >> 9 & 7, size = [4, 2, 1, 1, 4, 2, 1, 2][kind], index = numbers(r[op >> 6 & 7]);
        const off = index && index.length === 1 ? index[0] : 0, via = index && index.length === 1 ? r[mid] : plus(r[mid], r[op >> 6 & 7]);
        if (kind <= 2) store(s, pc, via, off, size, r[lo]);
        else { loads.set(pc, { base: via, offset: off, size }); r[lo] = load(s, via, off, size, kind === 3 || kind === 7); }
      } else if ((op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000) {
        const size = (op & 0xF000) === 0x8000 ? 2 : op & 0x1000 ? 1 : 4, offset = (op >> 6 & 31) * size;
        if (op & 0x0800) { loads.set(pc, { base: r[mid], offset, size }); r[lo] = load(s, r[mid], offset, size, false); } else store(s, pc, r[mid], offset, size, r[lo]);
      } else if ((op & 0xF000) === 0x9000) {
        const rd = op >> 8 & 7, offset = (op & 0xFF) * 4;
        if (op & 0x0800) r[rd] = load(s, r[13], offset, 4, false);
        else store(s, pc, r[13], offset, 4, r[rd]);
      } else if ((op & 0xF000) === 0xA000) {
        r[op >> 8 & 7] = op & 0x0800 ? moved(r[13], (op & 0xFF) * 4) : number(((pc + 4) & ~3) + (op & 0xFF) * 4);
      } else if ((op & 0xFF00) === 0xB000) {
        r[13] = moved(r[13], (op & 0x80 ? -1 : 1) * (op & 0x7F) * 4);
      } else if ((op & 0xF600) === 0xB400) {
        const list = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1), extra = op & 0x0100 ? 1 : 0;
        if (!(op & 0x0800)) {
          // PUSH: down the stack, the lowest register lowest
          const down = moved(r[13], -4 * (list.length + extra));
          [...list, ...(extra ? [14] : [])].forEach((i, n) => store(s, pc, down, 4 * n, 4, r[i]));
          r[13] = down;
        } else {
          list.forEach((i, n) => { r[i] = load(s, r[13], 4 * n, 4, false); });
          r[13] = moved(r[13], 4 * (list.length + extra));
          if (extra) { giveBack(r[0]); continue; }
        }
      } else if ((op & 0xF000) === 0xC000) {
        const base = op >> 8 & 7, list = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1), from = r[base];
        list.forEach((i, n) => {
          if (op & 0x0800) { loads.set(pc, { base: from, offset: 4 * n, size: 4 }); r[i] = load(s, from, 4 * n, 4, false); } else store(s, pc, from, 4 * n, 4, r[i]);
        });
        if (!(op & 0x0800 && list.includes(base))) r[base] = moved(from, 4 * list.length);
      } else if ((op & 0xFF00) === 0xDF00) {
        const call = op & 0xFF;
        swis.set(pc, { r0: r[0], r1: r[1], r2: r[2] });
        if ((call === 0x0B || call === 0x0C) && numbers(r[1]) && numbers(r[2])) {
          // CpuSet and CpuFastSet: words from r1 on, as many as r2 says, what the pass doesn't follow
          for (const d of numbers(r[1])) for (const c of numbers(r[2])) {
            const length = (c & 0x1FFFFF) * (call === 0x0C || c & 0x04000000 ? 4 : 2);
            for (let w = d & ~3; w < d + length; w += 4) if (inWork(w)) grow(`a${w}`, ANYWHERE);
          }
        } else if (!QUIET.has(call)) widenAll(`the BIOS's work at ${hex(pc)} (swi 0x${call.toString(16).toUpperCase()}) writes where the pass can't bound`);
        for (const i of [0, 1, 2, 3]) r[i] = ANYWHERE;
      } else if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
        into(at + 4 + ((op & 0xFF) << 24 >> 23), s);
      } else if ((op & 0xF800) === 0xE000) {
        into(at + 4 + ((op & 0x7FF) << 21 >> 20), s);
        continue;
      } else if ((op & 0xF800) === 0xF800 || (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800) {
        continue;
      } else {
        for (let i = 0; i < 16; i++) r[i] = ANYWHERE;
      }
      into(at + 2, s);
    }
  };

  let passes = 0;
  while (changed && complete) {
    changed = false;
    passes++;
    for (const f of thumb) {
      analyse(f);
      if (!complete) break;
    }
  }
  if (!complete) why.unshift(`it ran past its limit of ${seconds} seconds or ${cellLimit.toLocaleString('en')} cells`);
  let bounded = 0, unbounded = 0;
  for (const s of stores.values()) {
    if (s.base !== ANYWHERE && moved(s.base, s.offset) !== ANYWHERE) bounded++;
    else unbounded++;
  }
  return { stores, loads, swis, sites, bounded, unbounded, complete, why, passes, seconds: (Date.now() - began) / 1000, everywhere: anyStore === ANYWHERE };
}

export { ANYWHERE, numbers, moved };
