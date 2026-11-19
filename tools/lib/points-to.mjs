// Where the game's pointers can point (#1538, #1540), for the never-written check (never-written.mjs): a whole-program
// pass over the game's code, Thumb and ARM, in the cartridge and copied to the work memory, that works out for each
// store and load through a register the set of places its base can hold. It's sound and conservative: what it can't
// bound is "anywhere", and in doubt it widens, never narrows without a reason it can show.
//
// A value is "anywhere" (null) or a small set of what it can be, each one of:
//   'c<n>'          a number, which is also how an address the code names is kept
//   'h<site>:<off>' the object the allocator's call at <site> gave, <off> bytes in, or 'h<site>:*' anywhere in it
//   's<fn>:<off>'   function <fn>'s own stack, <off> from where the stack pointer was as it started, or 's<fn>:*'
//   'r'             the address a function was called from, which it goes back to
// A set that grows past SIZE_CAP is "anywhere".
//
// Memory is cells, each the join of every value stored there: a word of the work memory at a known address, a word of
// an allocator's object, a word of a function's stack. The cartridge is read-only, so a load from it is the number its
// copy holds; the work memory starts as 0. What a store the pass can't bound stores may land in any cell, so it's
// joined into every load from the work memory and the stacks: one that stores a pointer, or anything narrower than a
// word, which may change part of a pointer, makes every such load "anywhere". So does code the pass doesn't read: code
// in the work memory that none of the code map's copies holds. That's the price of never guessing.
//
// The code it reads: each function of the code map in the cartridge, Thumb or ARM, and each the game runs from its
// work memory that one of the code map's copies holds, read as those bytes, at the address it runs at: a copy of the
// cartridge's, or what the BIOS unpacks from it (gba/unpack.mjs), when the copy's bytes there are the function's. Other
// code at an address it already reads is code it doesn't read. A function's own stack is followed within it: a slot it surely stored before, on every way there, is read back
// as what it stored, and any other, or one of its caller's above it, is "anywhere".
//
// Ways in: a function starts where it starts, and a branch of another function may arrive in its middle. A word of the
// cartridge that holds an address in the middle of a function is a way in only if code the pass reads can carry it to
// the program counter: a `bx`, a `mov` or `add` to `pc`, an `ldr` or `ldm` or `pop` into `pc`, or a call through a
// register, a jump table among them. The pass starts with none of those words as ways in, and after each round adds
// each one a carrier can hold, or that a carrier holding anything, or code it can't read, could; when a round adds
// none, every word left is data, and it says why for each.
//
// Across calls: a function called directly, whose address the cartridge never keeps as a value, starts with each
// register the join of what every call gives it; any other starts with "anywhere" in each. What it gives back is the
// join of r0 at its returns. An allocator's call gives an object of its own, kept apart by the call that made it,
// inside the arena it hands out from. After a call, r4 to r12 are as they were only where the called function provably
// keeps them (it pushes them, or neither it nor what it calls writes them), and r1 to r3 and lr are "anywhere".
//
// A comparison of a register with a number, just before an unsigned branch or a conditional instruction, bounds it on
// each way to the numbers that way allows, when they're few enough: that's what makes a switch's table read exactly.

import { UNPACKED_BY, copyBytes, unpack } from '../gba/unpack.mjs';

const CARTRIDGE = 0x08000000;
const EWRAM = 0x02000000, EWRAM_END = 0x02040000, IWRAM = 0x03000000, IWRAM_END = 0x03008000;
const SIZE_CAP = 64;
const ANYWHERE = null;
const u32 = n => n >>> 0;
const hex = n => `0x${u32(n).toString(16).toUpperCase().padStart(8, '0')}`;
const inWork = a => (a >= EWRAM && a < EWRAM_END) || (a >= IWRAM && a < IWRAM_END);

const number = n => new Set([`c${u32(n)}`]);
const NOTHING = new Set();
const RETURN = new Set(['r']);

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
    if (e === 'r') return ANYWHERE;
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
const placesOnly = v => v !== ANYWHERE && v.size > 0 && [...v].every(e => e[0] === 'h' || e[0] === 's');
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
// a register bounded by a comparison with `k`, unsigned, on the way that keeps `keep(value)` true: a set of numbers
// filtered, or "anywhere" made the few numbers the way allows, or left as it is
function bounded(v, k, keep, upTo) {
  const n = numbers(v);
  if (n) return new Set(n.filter(keep).map(x => `c${x}`));
  if (v === ANYWHERE && upTo !== null && upTo < SIZE_CAP) return new Set(Array.from({ length: upTo + 1 }, (_, i) => `c${i}`));
  return v;
}

// a function in ARM instructions, by its first words
export function isArm(bytes) {
  if (bytes.length < 16 || bytes.length % 4) return false;
  const word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  return [0, 4, 8, 12].map(word).filter(w => w >>> 28 === 0xE).length >= 3;
}
const isCall = (u16, at, size) => (u16(at) & 0xF800) === 0xF000 && at + 4 <= size && (u16(at + 2) & 0xF800) === 0xF800;
const callTarget = (u16, at, address) => u32(address + at + 4 + ((u16(at) & 0x7FF) << 21 >> 9) + ((u16(at + 2) & 0x7FF) << 1));

// the registers a Thumb instruction may write, for whether a function keeps r4 to r12
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
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

// the BIOS's calls that write no memory the pass needs to place: the waits, the divisions, the roots and arcs, the
// checksum, MidiKey2Freq, and the resets, which clear to the 0 every value starts as
const QUIET = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0D, 0x1F]);

/**
 * The pass, over the whole game. `rom` is the cartridge's bytes, `functions` the code map's, `copies` its copies,
 * { ram, cartridge, size, packed, from }, and `allocators` a Map from the address of each allocator to the arena it hands out from,
 * { from, to }. `seconds` and `cells` limit how long it runs and how much it keeps. Answers { stores, loads, swis,
 * sites, bounded, unbounded, words, unread, complete, why, passes, rounds, seconds, everywhere }: each store's and
 * load's { base, offset, size, value }, by its address, as the pass ends; each swi's registers, and for an unpack
 * it bounds, `wrote`, the places it writes, [{ from, size }]; each word of the
 * cartridge that holds an address in the middle of a function, { at, to, verdict, why }, `verdict` 'data', 'target' or
 * 'open'; and the code it couldn't read. `complete` is false when it ran past its limit, and then nothing it says may
 * be used.
 */
export function pointsTo(rom, functions, { allocators = new Map(), copies = [], seconds = 120, cells: cellLimit = 2_000_000 } = {}) {
  const began = Date.now();
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length);
  const end = CARTRIDGE + rom.length;
  const inRom = a => a >= CARTRIDGE && a < end;
  const romValue = (a, size, signed) => {
    if (!inRom(a) || !inRom(a + size - 1)) return ANYWHERE;
    let v = size === 4 ? view.getUint32(a - CARTRIDGE, true) : size === 2 ? view.getUint16(a - CARTRIDGE, true) : view.getUint8(a - CARTRIDGE);
    if (signed) v = size === 2 ? (v << 16) >> 16 : (v << 24) >> 24;
    return number(v);
  };

  // the code it reads: the cartridge's functions, and those the game runs from its work memory that a copy holds, with
  // the copy's bytes, to read the numbers the code keeps beside itself
  const units = [], unread = [];
  const keyOf = bytes => Array.from(bytes.subarray(0, 8), b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  const held = copies.map(c => ({ ...c, bytes: copyBytes(rom, c) })).filter(c => c.bytes);
  for (const f of functions) {
    if (!f.bytes && inRom(f.address) && f.address + f.size <= end) { units.push({ address: f.address, size: f.size, source: f.address, bytes: rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size) }); continue; }
    const copy = held.find(c => f.address >= c.ram && f.address + f.size <= c.ram + c.size && (!f.bytes || f.bytes.startsWith(keyOf(c.bytes.subarray(f.address - c.ram)))));
    if (!copy) { unread.push(f.address); continue; }
    const at = f.address - copy.ram;
    units.push({ address: f.address, size: f.size, ...(copy.packed ? {} : { source: copy.cartridge + at }), bytes: copy.bytes.subarray(at, at + f.size), copy, copied: true });
  }
  for (const u of units) u.arm = isArm(u.bytes);
  // one piece of code to an address: other code there at another time is code the pass doesn't read
  const byAddress = new Map();
  for (const u of units.splice(0)) {
    const there = byAddress.get(u.address);
    if (!there) {
      byAddress.set(u.address, u);
      units.push(u);
    } else if (keyOf(there.bytes) !== keyOf(u.bytes)) unread.push(u.address);
  }
  const sorted = [...byAddress.values()].sort((a, b) => a.address - b.address);
  const inside = a => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].address + sorted[mid].size <= a) lo = mid + 1; else hi = mid; }
    const u = sorted[lo];
    return u && a >= u.address && a < u.address + u.size ? u : null;
  };
  // a number the code keeps beside itself: the cartridge's, or a copy's, as the copy holds it
  const codeValue = (a, size, signed) => {
    if (inRom(a)) return romValue(a, size, signed);
    const u = inside(a);
    if (!u?.copied) return ANYWHERE;
    const at = a - u.copy.ram;
    if (at < 0 || at + size > u.copy.bytes.length) return ANYWHERE;
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = v * 256 + u.copy.bytes[at + i];
    if (signed) v = size === 2 ? (v << 16) >> 16 : (v << 24) >> 24;
    return number(v);
  };
  const known = new Set(functions.map(f => f.address));
  const why = [];
  if (unread.length) why.push(`${unread.length} pieces of code in the work memory the code map's copies don't hold, such as ${hex(unread[0])}, which the pass can't read, may store anything anywhere`);

  // what's known before reading: which functions something calls, which escape as values, which branches arrive in
  // another function's middle, and the words of the cartridge that hold an address in a function's middle
  const escaped = new Set(), called = new Set(), into = new Set(), candidates = new Map();
  for (let at = 0; at + 4 <= rom.length; at += 4) {
    const w = view.getUint32(at, true), to = w & ~1;
    if (known.has(to)) escaped.add(to);
    const u = inside(to);
    if (u && to !== u.address && !(u.source !== undefined && u.source <= CARTRIDGE + at && CARTRIDGE + at < u.source + u.size)) candidates.set(CARTRIDGE + at, to);
  }
  const branchTo = (u, target, isCallTo) => {
    const g = inside(target);
    if (target === g?.address || (isCallTo && known.has(target))) called.add(target);
    else if (g && g !== u) into.add(target);
  };
  const keeps = new Map(), callees = new Map(), wrote = new Map(), pushed = new Map();
  const viaRegister = new Map();
  for (const u of units) {
    if (u.arm) {
      for (let at = 0; at + 4 <= u.bytes.length; at += 4) {
        const op = (u.bytes[at] | u.bytes[at + 1] << 8 | u.bytes[at + 2] << 16 | u.bytes[at + 3] << 24) >>> 0;
        if ((op & 0x0E000000) === 0x0A000000 && op >>> 28 !== 0xF) {
          const target = u32(u.address + at + 8 + ((op & 0xFFFFFF) << 8 >> 6));
          if (target < u.address || target >= u.address + u.size) branchTo(u, target, (op & 0x01000000) !== 0);
        }
      }
      keeps.set(u.address, new Set());
      continue;
    }
    const u16 = at => u.bytes[at] | u.bytes[at + 1] << 8;
    if (u.size <= 4 && (u16(0) & 0xFF87) === 0x4700 && (u16(0) >> 3 & 15) < 13) viaRegister.set(u.address, u16(0) >> 3 & 15);
    const writes = new Set(), direct = new Set();
    let opaque = false;
    for (let at = 0; at + 2 <= u.bytes.length; at += 2) {
      const op = u16(at);
      if (isCall(u16, at, u.bytes.length)) {
        const target = callTarget(u16, at, u.address);
        direct.add(target);
        branchTo(u, target, true);
        at += 2;
        continue;
      }
      if (((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) || (op & 0xF800) === 0xE000) {
        const target = (op & 0xF800) === 0xE000 ? u.address + at + 4 + ((op & 0x7FF) << 21 >> 20) : u.address + at + 4 + ((op & 0xFF) << 24 >> 23);
        if (target < u.address || target >= u.address + u.size) branchTo(u, target, false);
      }
      for (const r of destinations(op)) writes.add(r);
      if ((op & 0xFF87) === 0x4700 && (op >> 3 & 15) !== 14) opaque = true;
    }
    const first = [0, 2, 4, 6].map(at => (at + 2 <= u.bytes.length ? u16(at) : 0)).find(op => (op & 0xFE00) === 0xB400);
    pushed.set(u.address, new Set(first === undefined ? [] : [0, 1, 2, 3, 4, 5, 6, 7].filter(r => first >> r & 1)));
    wrote.set(u.address, writes);
    callees.set(u.address, opaque ? null : direct);
    keeps.set(u.address, new Set([4, 5, 6, 7, 8, 9, 10, 11, 12]));
  }
  for (const [address, direct] of callees) if (direct) for (const c of [...direct]) if (viaRegister.has(c)) callees.set(address, null);
  for (let again = true; again;) {
    again = false;
    for (const [address, kept] of keeps) {
      if (byAddress.get(address).arm) continue;
      const direct = callees.get(address);
      for (const r of [...kept]) {
        if ((r <= 7 && pushed.get(address).has(r)) || (!wrote.get(address).has(r) && direct !== null && [...direct].every(c => keeps.get(c)?.has(r)))) continue;
        kept.delete(r);
        again = true;
      }
    }
  }

  const args = new Map(), returns = new Map(), cells = new Map(), sites = new Map();
  const stores = new Map(), loads = new Map(), swis = new Map(), carriers = new Map(), arrivals = new Set(into);
  let anyStore = unread.length ? ANYWHERE : NOTHING, changed = true, complete = true, firstUnbounded = null;
  const widenAll = reason => { if (anyStore !== ANYWHERE) { anyStore = ANYWHERE; changed = true; if (why.length < 8) why.push(reason); } };
  const grow = (key, v) => {
    const before = cells.has(key) ? cells.get(key) : NOTHING, after = join(before, v);
    if (!cells.has(key) || !same(before, after)) { cells.set(key, after); changed = true; }
  };
  const cell = key => (cells.has(key) ? cells.get(key) : NOTHING);

  // one function, from its start and every way in, to a fixed point of its own, with what's known of the others
  const analyse = u => {
    const me = `s${u.address}`, size = u.bytes.length;
    const open = escaped.has(u.address) || !called.has(u.address);
    const given = args.get(u.address);
    const start = new Array(16).fill(ANYWHERE);
    for (let i = 0; i < 13; i++) start[i] = open ? ANYWHERE : given?.[i] ?? NOTHING;
    start[13] = new Set([`${me}:0`]);
    start[14] = RETURN;
    const states = new Map([[0, { r: start, stored: new Set() }]]), queue = [0];
    const widened = () => ({ r: new Array(16).fill(ANYWHERE), stored: new Set() });
    const next = (at, s) => {
      if (at < 0 || at >= size) return;
      if (arrivals.has(u.address + at)) s = widened();
      const had = states.get(at);
      if (!had) { states.set(at, { r: s.r.slice(), stored: new Set(s.stored) }); queue.push(at); return; }
      let grew = false;
      const r = had.r.map((v, i) => { const j = join(v, s.r[i]); if (!same(v, j)) grew = true; return j; });
      const stored = new Set([...had.stored].filter(k => s.stored.has(k)));
      if (stored.size !== had.stored.size) grew = true;
      if (grew) { states.set(at, { r, stored }); queue.push(at); }
    };
    for (const a of arrivals) if (a > u.address && a < u.address + size) next(a - u.address, widened());

    // a load of `size` bytes from each place `base` can be, `offset` on
    const load = (s, base, offset, bytes, signed) => {
      if (base === ANYWHERE) return ANYWHERE;
      const at = moved(base, offset);
      if (at === ANYWHERE) return ANYWHERE;
      let out = NOTHING;
      for (const e of at) {
        let word, low;
        if (e[0] === 'c') {
          const a = Number(e.slice(1));
          if (inRom(a)) { out = join(out, romValue(a, bytes, signed)); continue; }
          if (!inWork(a)) return ANYWHERE;
          word = join(join(cell(`a${a & ~3}`), number(0)), anyStore);
          for (const [site, arena] of sites) if (a >= arena.from && a < arena.to) word = join(word, cell(`h${site}`));
          low = a & 3;
        } else {
          const [kind, who, off] = place(e);
          if (off === null) return ANYWHERE;
          if (kind === 's') {
            // its own slot it surely stored before: what it stored, and what a store the pass can't bound may have left
            if (`s${who}` !== me || off >= 0 || !s.stored.has(off & ~3)) return ANYWHERE;
            word = join(cell(`${me}:${off & ~3}`), anyStore);
          } else word = join(join(join(cell(`h${who}:${off & ~3}`), cell(`h${who}:*`)), anyStore), cell(`r${who}`));
          low = off & 3;
        }
        if (bytes === 4) { out = join(out, low ? ANYWHERE : word); continue; }
        const n = numbers(word);
        if (!n) return ANYWHERE;
        out = join(out, new Set(n.map(v => {
          let part = (v >>> (8 * low)) & (bytes === 2 ? 0xFFFF : 0xFF);
          if (signed) part = bytes === 2 ? (part << 16) >> 16 : (part << 24) >> 24;
          return `c${u32(part)}`;
        })));
      }
      return out;
    };
    // a DMA channel's destination, and a start, which writes where it says, what the pass doesn't follow
    const channels = [{}, {}, {}, {}];
    const dma = (pc, a, bytes, value) => {
      const channel = (a - 0x040000B0) / 12 | 0, at = (a - 0x040000B0) % 12;
      if (at === 4 && bytes === 4) { channels[channel].dest = value; return; }
      if (at + bytes <= 8) return;
      const control = numbers(at === 8 && bytes === 4 ? value : ANYWHERE);
      if (!control) { widenAll(`the DMA started at ${hex(pc)} writes where the pass can't bound`); return; }
      if (!control.some(v => v >>> 31)) return;
      const dests = numbers(channels[channel].dest ?? ANYWHERE);
      if (!dests) { widenAll(`the DMA started at ${hex(pc)} writes where the pass can't bound`); return; }
      for (const d of dests) {
        if (d >= 0x04000000 && d < 0x04000400) continue;
        const length = Math.max(...control.map(c => c & 0xFFFF || 0x10000)) * 4;
        for (let w = d & ~3; w < d + length; w += 4) if (inWork(w)) grow(`a${w}`, ANYWHERE);
      }
    };
    // a store of `size` bytes of `value` to each place `base` can be, `offset` on
    const store = (s, pc, base, offset, bytes, value) => {
      stores.set(pc, { base, offset, size: bytes, value });
      const whole = bytes === 4 ? value : ANYWHERE;
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
          if (a >= 0x040000B0 && a < 0x040000E0) { dma(pc, a, bytes, value); continue; }
          if (!inWork(a)) continue;
          grow(`a${a & ~3}`, a & 3 ? ANYWHERE : whole);
          for (const [site, arena] of sites) if (a >= arena.from && a < arena.to) grow(`r${site}`, ANYWHERE);
        } else {
          const [kind, who, off] = place(e);
          if (off === null) { grow(`${kind}${who}:*`, ANYWHERE); continue; }
          grow(`${kind}${who}:${off & ~3}`, bytes !== 4 || off & 3 ? ANYWHERE : whole);
          if (`${kind}${who}` === me && bytes === 4 && !(off & 3)) s.stored.add(off);
        }
      }
      if (cells.size > cellLimit) complete = false;
    };
    // the BIOS's work, from the registers it's given
    const bios = (s, pc, call) => {
      swis.set(pc, { r0: s.r[0], r1: s.r[1], r2: s.r[2] });
      if ((call === 0x0B || call === 0x0C) && numbers(s.r[1]) && numbers(s.r[2])) {
        for (const d of numbers(s.r[1])) for (const c of numbers(s.r[2])) {
          const length = (c & 0x1FFFFF) * (call === 0x0C || c & 0x04000000 ? 4 : 2);
          for (let w = d & ~3; w < d + length; w += 4) if (inWork(w)) grow(`a${w}`, ANYWHERE);
        }
      } else if (call >= 0x11 && call <= 0x18 && numbers(s.r[0]) && numbers(s.r[1])) {
        // an unpack, as far as the header it reads first says: from one place of the cartridge to one place, exactly
        // what it makes, when the tools follow its kind (gba/unpack.mjs)
        const sources = numbers(s.r[0]), targets = numbers(s.r[1]), wrote = [];
        let bounded = true;
        for (const from of sources) {
          const headers = from & 3 ? null : inRom(from) && inRom(from + 3) ? [view.getUint32(from - CARTRIDGE, true)] : inWork(from) ? numbers(join(join(cell(`a${from}`), number(0)), anyStore)) : null;
          if (!headers || headers.some(h => h >>> 8 > EWRAM_END - EWRAM)) {
            widenAll(`the BIOS's work at ${hex(pc)} (swi 0x${call.toString(16).toUpperCase()}) unpacks data whose size the pass can't bound`);
            bounded = false;
            continue;
          }
          const made = sources.length === 1 && targets.length === 1 && inRom(from) && UNPACKED_BY[call] ? unpack(UNPACKED_BY[call], rom, from - CARTRIDGE)?.bytes : null;
          for (const d of targets) for (const size of headers.map(h => h >>> 8)) {
            wrote.push({ from: d, size });
            for (let w = d & ~3; w < d + size; w += 4) {
              if (!inWork(w)) continue;
              const exact = made && !(d & 3) && w + 4 <= d + size;
              grow(`a${w}`, exact ? number(made[w - d] | made[w - d + 1] << 8 | made[w - d + 2] << 16 | made[w - d + 3] << 24) : ANYWHERE);
            }
          }
        }
        if (bounded) swis.get(pc).wrote = wrote;
      } else if (!QUIET.has(call)) widenAll(`the BIOS's work at ${hex(pc)} (swi 0x${call.toString(16).toUpperCase()}) writes where the pass can't bound`);
      for (const i of [0, 1, 2, 3]) s.r[i] = ANYWHERE;
    };
    const functionsIn = v => {
      const n = numbers(v);
      if (!n) return null;
      const out = n.map(x => x & ~1);
      return out.every(x => known.has(x)) ? out : null;
    };
    const call = (s, targets) => {
      if (targets === null) return;
      for (const c of targets) {
        if (!byAddress.has(c)) continue;
        const had = args.get(c) ?? new Array(13).fill(NOTHING);
        const now = had.map((v, i) => join(v, s.r[i]));
        if (now.some((v, i) => !same(v, had[i]))) { args.set(c, now); changed = true; }
      }
    };
    // what a call leaves: r0 from what it gives back, r4 to r12 where it keeps them, and nothing else known
    const afterCall = (s, targets, site) => {
      const r = s.r.slice();
      for (const i of [1, 2, 3, 14]) r[i] = ANYWHERE;
      if (targets === null) { for (const i of [0, 4, 5, 6, 7, 8, 9, 10, 11, 12]) r[i] = ANYWHERE; return { r, stored: s.stored }; }
      let back = NOTHING;
      for (const c of targets) {
        if (allocators.has(c)) {
          if (!sites.has(site)) { sites.set(site, { ...allocators.get(c), callee: c }); changed = true; }
          back = join(back, new Set([`h${site}:0`]));
        } else back = join(back, byAddress.has(c) ? (returns.get(c) ?? NOTHING) : ANYWHERE);
        for (const i of [4, 5, 6, 7, 8, 9, 10, 11, 12]) if (!keeps.get(c)?.has(i)) r[i] = ANYWHERE;
      }
      r[0] = back;
      return { r, stored: s.stored };
    };
    const giveBack = v => {
      const before = returns.has(u.address) ? returns.get(u.address) : NOTHING, after = join(before, v);
      if (!returns.has(u.address) || !same(before, after)) { returns.set(u.address, after); changed = true; }
    };
    // a value carried to the program counter, at `pc`: back to the caller, a call or jump to the functions it names,
    // on to the places in this function it names, or anywhere, as each word of the cartridge in a function's middle is
    // weighed against it; `local` is a jump within this function that a table it indexes gives
    const carry = (s, pc, value, { continues = false, local = null } = {}) => {
      carriers.set(pc, { value, local });
      if (local) { for (const t of local) next(t - u.address, s); return; }
      if (value === ANYWHERE) { giveBack(s.r[0]); return; }
      const others = new Set([...value].filter(e => e !== 'r'));
      if (value.has('r')) giveBack(s.r[0]);
      if (!others.size) return;
      const targets = functionsIn(others);
      if (targets) {
        call(s, targets);
        const after = afterCall(s, targets, pc);
        if (continues) next(pc - u.address + (u.arm ? 4 : 2), after);
        else giveBack(after.r[0]);
        return;
      }
      // places in this function's middle: on from there, with what's known here
      const n = numbers(others);
      if (n) for (const t of n) if ((t & ~1) > u.address && (t & ~1) < u.address + size) next((t & ~1) - u.address, s);
    };

    const thumbStep = (at, s) => {
      const r = s.r, b = u.bytes, u16 = x => b[x] | b[x + 1] << 8, op = u16(at), pc = u.address + at;
      if (isCall(u16, at, size)) {
        const target = callTarget(u16, at, u.address);
        const targets = viaRegister.has(target) ? functionsIn(r[viaRegister.get(target)]) : [target];
        if (viaRegister.has(target)) carriers.set(pc, { value: r[viaRegister.get(target)] });
        call(s, targets);
        next(at + 4, afterCall(s, targets, pc));
        return;
      }
      const lo = op & 7, mid = op >> 3 & 7;
      if ((op & 0xE000) === 0x0000 && (op & 0x1800) !== 0x1800) {
        const kind = op >> 11 & 3, by = op >> 6 & 31;
        r[lo] = arith(r[mid], undefined, x => (kind === 0 ? x << by : kind === 1 ? (by ? x >>> by : 0) : (by ? x >> by : x >> 31)));
      } else if ((op & 0xF800) === 0x1800) {
        const v = op & 0x0400 ? number(op >> 6 & 7) : r[op >> 6 & 7], nv = numbers(v);
        r[lo] = op & 0x0200 ? (nv && nv.length === 1 ? moved(r[mid], -nv[0]) : arith(r[mid], v, (x, y) => x - y)) : plus(r[mid], v);
      } else if ((op & 0xE000) === 0x2000) {
        const kind = op >> 11 & 3, rd = op >> 8 & 7, n = op & 0xFF;
        if (kind === 0) r[rd] = number(n);
        else if (kind === 2) r[rd] = moved(r[rd], n);
        else if (kind === 3) r[rd] = moved(r[rd], -n);
      } else if ((op & 0xFC00) === 0x4000) {
        const kind = op >> 6 & 15, a = r[lo], v = r[mid];
        const ops = { 0x0: (x, y) => x & y, 0x1: (x, y) => x ^ y, 0x2: (x, y) => ((y & 0xFF) >= 32 ? 0 : x << (y & 0xFF)), 0x3: (x, y) => ((y & 0xFF) >= 32 ? 0 : x >>> (y & 0xFF)), 0x4: (x, y) => x >> Math.min(y & 0xFF, 31), 0xC: (x, y) => x | y, 0xD: (x, y) => Math.imul(x, y), 0xE: (x, y) => x & ~y };
        if (kind === 0x9) r[lo] = arith(v, undefined, x => -x);
        else if (kind === 0xF) r[lo] = arith(v, undefined, x => ~x);
        else if (ops[kind]) r[lo] = arith(a, v, ops[kind]);
        else if (![0x8, 0xA, 0xB].includes(kind)) r[lo] = ANYWHERE;
      } else if ((op & 0xFC00) === 0x4400) {
        const kind = op >> 8 & 3, from = op >> 3 & 15, to = (op & 7) | (op >> 4 & 8);
        const value = from === 15 ? number(pc + 4) : r[from];
        if (kind === 3) return carry(s, pc, value);
        if (to === 15) {
          // a jump through a register: a table's targets, read exactly when its index is bounded, or what it holds
          return carry(s, pc, kind === 2 ? value : plus(number(pc + 4), value));
        }
        if (to === 13) r[13] = kind === 2 ? value : plus(r[13], value);
        else if (kind === 0) r[to] = plus(r[to], value);
        else if (kind === 2) r[to] = value;
      } else if ((op & 0xF800) === 0x4800) {
        r[op >> 8 & 7] = codeValue(((pc + 4) & ~3) + (op & 0xFF) * 4, 4, false);
      } else if ((op & 0xF000) === 0x5000) {
        const kind = op >> 9 & 7, bytes = [4, 2, 1, 1, 4, 2, 1, 2][kind], index = numbers(r[op >> 6 & 7]);
        const off = index && index.length === 1 ? index[0] : 0, via = index && index.length === 1 ? r[mid] : plus(r[mid], r[op >> 6 & 7]);
        if (kind <= 2) store(s, pc, via, off, bytes, r[lo]);
        else { loads.set(pc, { base: via, offset: off, size: bytes }); r[lo] = load(s, via, off, bytes, kind === 3 || kind === 7); }
      } else if ((op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000) {
        const bytes = (op & 0xF000) === 0x8000 ? 2 : op & 0x1000 ? 1 : 4, offset = (op >> 6 & 31) * bytes;
        if (op & 0x0800) { loads.set(pc, { base: r[mid], offset, size: bytes }); r[lo] = load(s, r[mid], offset, bytes, false); } else store(s, pc, r[mid], offset, bytes, r[lo]);
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
          const down = moved(r[13], -4 * (list.length + extra));
          [...list, ...(extra ? [14] : [])].forEach((i, n) => store(s, pc, down, 4 * n, 4, r[i]));
          r[13] = down;
        } else {
          const back = extra ? load(s, r[13], 4 * list.length, 4, false) : null;
          list.forEach((i, n) => { r[i] = load(s, r[13], 4 * n, 4, false); });
          r[13] = moved(r[13], 4 * (list.length + extra));
          if (extra) return carry(s, pc, back);
        }
      } else if ((op & 0xF000) === 0xC000) {
        const base = op >> 8 & 7, list = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1), from = r[base];
        list.forEach((i, n) => {
          if (op & 0x0800) { loads.set(pc, { base: from, offset: 4 * n, size: 4 }); r[i] = load(s, from, 4 * n, 4, false); } else store(s, pc, from, 4 * n, 4, r[i]);
        });
        if (!(op & 0x0800 && list.includes(base))) r[base] = moved(from, 4 * list.length);
      } else if ((op & 0xFF00) === 0xDF00) {
        bios(s, pc, op & 0xFF);
      } else if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
        const target = at + 4 + ((op & 0xFF) << 24 >> 23), cond = op >> 8 & 0xF, prev = at >= 2 && !arrivals.has(pc) ? u16(at - 2) : 0;
        const taken = { r: r.slice(), stored: new Set(s.stored) }, on = { r: r.slice(), stored: new Set(s.stored) };
        if ((prev & 0xF800) === 0x2800) bound(taken.r, on.r, prev >> 8 & 7, prev & 0xFF, cond);
        next(target, taken);
        next(at + 2, on);
        return;
      } else if ((op & 0xF800) === 0xE000) {
        next(at + 4 + ((op & 0x7FF) << 21 >> 20), s);
        return;
      } else if ((op & 0xF800) === 0xF800 || (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800) {
        return;
      } else {
        for (let i = 0; i < 16; i++) if (i !== 13) r[i] = ANYWHERE;
      }
      next(at + 2, s);
    };

    const armStep = (at, s) => {
      const b = u.bytes, op = (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0, pc = u.address + at;
      const cond = op >>> 28;
      if (cond === 0xF) { const w = widened(); w.r[13] = s.r[13]; next(at + 4, w); return; }
      // a conditional instruction: on with what it leaves where it ran, and with nothing changed where it didn't
      const conditional = cond !== 0xE, ran = { r: s.r.slice(), stored: new Set(s.stored) }, skipped = { r: s.r.slice(), stored: new Set(s.stored) };
      const prev = at >= 4 && !arrivals.has(pc) ? (b[at - 4] | b[at - 3] << 8 | b[at - 2] << 16 | b[at - 1] << 24) >>> 0 : 0;
      if (conditional && (prev & 0x0FF00000) === 0x03500000) bound(ran.r, skipped.r, prev >> 16 & 15, armImmediate(prev), cond);
      const r = ran.r, rd = op >> 12 & 15, rn = op >> 16 & 15;
      const reg = i => (i === 15 ? number(pc + 8) : r[i]);
      const go = () => { next(at + 4, ran); if (conditional) next(at + 4, skipped); };
      if ((op & 0x0FFFFFF0) === 0x012FFF10) {
        // BX: back to the caller, or a call or jump through a register, on after it when lr was set just before
        const m = op & 15;
        if (m === 14 && same(r[14], RETURN)) { giveBack(r[0]); if (conditional) next(at + 4, skipped); return; }
        const setLr = (prev & 0x0FFFFFFF) === 0x01A0E00F;
        carry(ran, pc, r[m], { continues: setLr });
        if (conditional) next(at + 4, skipped);
        return;
      }
      if ((op & 0x0E000000) === 0x0A000000) {
        const target = u32(pc + 8 + ((op & 0xFFFFFF) << 8 >> 6));
        if (op & 0x01000000) {
          call(ran, [target]);
          next(at + 4, afterCall(ran, [target], pc));
        } else if (target >= u.address && target < u.address + size) next(target - u.address, ran);
        else { call(ran, [target]); giveBack(afterCall(ran, [target], pc).r[0]); }
        if (conditional) next(at + 4, skipped);
        return;
      }
      if ((op & 0x0F000000) === 0x0F000000) { bios(ran, pc, op >> 16 & 0xFF); go(); return; }
      if ((op & 0x0FC000F0) === 0x00000090) { r[rn] = arith(reg(op & 15), reg(op >> 8 & 15), (x, y) => Math.imul(x, y)); if (op & 0x00200000) r[rn] = ANYWHERE; go(); return; }
      if ((op & 0x0F8000F0) === 0x00800090) { r[rn] = ANYWHERE; r[rd] = ANYWHERE; go(); return; }
      if ((op & 0x0FB00FF0) === 0x01000090) {
        // SWP: a word or byte stored and the old one loaded
        const bytes = op & 0x00400000 ? 1 : 4;
        const old = load(ran, r[rn], 0, bytes, false);
        store(ran, pc, r[rn], 0, bytes, r[op & 15]);
        r[rd] = old;
        go();
        return;
      }
      if ((op & 0x0E000090) === 0x00000090 && op & 0x60) {
        // LDRH, STRH, LDRSB, LDRSH
        const up = op & 0x00800000 ? 1 : -1, pre = (op & 0x01000000) !== 0, write = (op & 0x00200000) !== 0 || !pre, load_ = (op & 0x00100000) !== 0;
        const amount = op & 0x00400000 ? number(((op >> 4) & 0xF0) | (op & 0xF)) : r[op & 15];
        const n = numbers(amount), k = n && n.length === 1 ? up * n[0] : null;
        const base = reg(rn), at_ = pre ? (k === null ? plus(base, ANYWHERE) : base) : base, off = pre && k !== null ? k : 0;
        const sh = op >> 5 & 3, bytes = sh === 2 ? 1 : 2;
        if (load_) { loads.set(pc, { base: at_, offset: off, size: bytes }); r[rd] = load(ran, at_, off, bytes, sh >= 2); } else store(ran, pc, at_, off, 2, reg(rd));
        if (write && rn !== 15 && !(load_ && rd === rn)) r[rn] = k === null ? plus(base, ANYWHERE) : moved(base, k);
        go();
        return;
      }
      if ((op & 0x0FBF0FFF) === 0x010F0000) { r[rd] = ANYWHERE; go(); return; }
      if ((op & 0x0DB0F000) === 0x0120F000) { go(); return; }
      if ((op & 0x0C000000) === 0x00000000) {
        // data processing, with its second operand a number turned or a register shifted
        const code = op >> 21 & 15;
        let two;
        if (op & 0x02000000) two = number(armImmediate(op));
        else {
          const m = op & 15, type = op >> 5 & 3, by = op & 0x10 ? null : op >> 7 & 31;
          const v = m === 15 ? number(pc + (op & 0x10 ? 12 : 8)) : r[m];
          if (by === 0 && type === 0) two = v;
          else if (by === null) two = arith(v, r[op >> 8 & 15], (x, y) => [x << (y & 0xFF), (y & 0xFF) >= 32 ? 0 : x >>> (y & 0xFF), x >> Math.min(y & 0xFF, 31), (x >>> (y & 31)) | (x << (32 - (y & 31)))][type]);
          else two = arith(v, undefined, x => [x << by, by ? x >>> by : 0, by ? x >> by : x >> 31, by ? (x >>> by) | (x << (32 - by)) : x][type]);
        }
        const one = reg(rn), n2 = numbers(two);
        let out;
        switch (code) {
          case 0x0: out = arith(one, two, (x, y) => x & y); break;
          case 0x1: out = arith(one, two, (x, y) => x ^ y); break;
          case 0x2: out = n2 && n2.length === 1 ? moved(one, -n2[0]) : arith(one, two, (x, y) => x - y); break;
          case 0x3: out = arith(two, one, (x, y) => x - y); break;
          case 0x4: out = plus(one, two); break;
          case 0xC: out = arith(one, two, (x, y) => x | y); break;
          case 0xD: out = two; break;
          case 0xE: out = arith(one, two, (x, y) => x & ~y); break;
          case 0xF: out = arith(two, undefined, x => ~x); break;
          case 0x8: case 0x9: case 0xA: case 0xB: go(); return;
          default: out = ANYWHERE;
        }
        if (rd === 15) {
          // to the program counter: back, or a jump: a table this function indexes, or what it holds
          if (code === 0xD && (op & 0x0200000F) === 0x0000000E && !(op & 0xFF0)) { giveBack(r[0]); if (conditional) next(at + 4, skipped); return; }
          const local = code === 0x4 && rn === 15 ? tableTargets(numbers(two), pc + 8, u) : null;
          carry(ran, pc, out, { local });
          if (conditional) next(at + 4, skipped);
          return;
        }
        r[rd] = out;
        go();
        return;
      }
      if ((op & 0x0C000000) === 0x04000000) {
        // LDR, STR, LDRB, STRB
        const up = op & 0x00800000 ? 1 : -1, pre = (op & 0x01000000) !== 0, write = (op & 0x00200000) !== 0 || !pre, load_ = (op & 0x00100000) !== 0;
        const bytes = op & 0x00400000 ? 1 : 4;
        let amount;
        if (!(op & 0x02000000)) amount = number(op & 0xFFF);
        else { const by = op >> 7 & 31, type = op >> 5 & 3; amount = arith(r[op & 15], undefined, x => [x << by, by ? x >>> by : 0, by ? x >> by : x >> 31, by ? (x >>> by) | (x << (32 - by)) : x][type]); }
        const n = numbers(amount), k = n && n.length === 1 ? up * n[0] : null;
        const base = reg(rn), via = pre && k === null ? plus(base, ANYWHERE) : base, off = pre && k !== null ? k : 0;
        if (load_) {
          loads.set(pc, { base: via, offset: off, size: bytes });
          const value = rn === 15 && pre && k !== null && bytes === 4 ? codeValue(pc + 8 + k, 4, false) : load(ran, via, off, bytes, false);
          if (rd === 15) { carry(ran, pc, value); if (conditional) next(at + 4, skipped); return; }
          r[rd] = value;
        } else store(ran, pc, via, off, bytes, reg(rd));
        if (write && rn !== 15 && !(load_ && rd === rn)) r[rn] = k === null ? plus(base, ANYWHERE) : moved(base, k);
        go();
        return;
      }
      if ((op & 0x0E000000) === 0x08000000) {
        // LDM, STM: the registers listed, from the base up or down, before or after
        const list = Array.from({ length: 16 }, (_, i) => i).filter(i => op >> i & 1), up = (op & 0x00800000) !== 0, pre = (op & 0x01000000) !== 0;
        const load_ = (op & 0x00100000) !== 0, write = (op & 0x00200000) !== 0, base = r[rn], count = list.length;
        const first = up ? (pre ? 4 : 0) : (pre ? -4 * count : -4 * count + 4);
        let back = null;
        list.forEach((i, n) => {
          if (load_) { loads.set(pc, { base, offset: first + 4 * n, size: 4 }); const v = load(ran, base, first + 4 * n, 4, false); if (i === 15) back = v; else r[i] = v; } else store(ran, pc, base, first + 4 * n, 4, reg(i));
        });
        if (write && !(load_ && list.includes(rn))) r[rn] = moved(base, (up ? 4 : -4) * count);
        if (load_ && list.includes(15)) { carry(ran, pc, back); if (conditional) next(at + 4, skipped); return; }
        go();
        return;
      }
      // a coprocessor's instruction, or one the pass doesn't know: nothing known after it but the stack
      const w = widened();
      w.r[13] = s.r[13];
      next(at + 4, w);
      if (conditional) next(at + 4, skipped);
    };

    while (queue.length) {
      if (Date.now() - began > seconds * 1000) { complete = false; return; }
      const at = queue.pop(), s = { r: states.get(at).r.slice(), stored: new Set(states.get(at).stored) };
      if (u.arm) { if (at % 4 === 0 && at + 4 <= size) armStep(at, s); } else if (at + 2 <= size) thumbStep(at, s);
    }
  };

  // each word in a function's middle, weighed against what the carriers can hold
  const weigh = () => {
    const words = [];
    const anyCarrier = [...carriers].find(([, c]) => c.value === ANYWHERE && !c.local);
    for (const [at, to] of candidates) {
      let verdict = 'data', because;
      const by = [...carriers].find(([, c]) => (c.local ? c.local.has(to) : c.value !== ANYWHERE && (c.value.has(`c${to}`) || c.value.has(`c${to | 1}`))));
      if (unread.length) { verdict = 'open'; because = `code the pass can't read, such as ${hex(unread[0])}, may load it and jump to it`; } else if (by) { verdict = 'target'; because = `the jump at ${hex(by[0])} can carry it to the program counter`; } else if (anyCarrier) { verdict = 'open'; because = `the jump at ${hex(anyCarrier[0])} can carry anything to the program counter`; } else because = 'no code the pass reads can carry it to the program counter';
      words.push({ at, to, verdict, why: because });
    }
    return words;
  };

  let passes = 0, rounds = 0, words = [];
  for (;;) {
    rounds++;
    while (changed && complete) {
      changed = false;
      passes++;
      for (const u of units) {
        analyse(u);
        if (!complete) break;
      }
    }
    if (!complete) break;
    words = weigh();
    // a word a carrier can hold, or may, is a way in, and the pass goes round again with it
    const more = words.filter(w => w.verdict !== 'data' && !arrivals.has(w.to));
    if (!more.length) break;
    for (const w of more) arrivals.add(w.to);
    changed = true;
  }
  if (!complete) why.unshift(`it ran past its limit of ${seconds} seconds or ${cellLimit.toLocaleString('en')} cells`);
  let boundedCount = 0, unbounded = 0;
  for (const st of stores.values()) {
    if (st.base !== ANYWHERE && moved(st.base, st.offset) !== ANYWHERE) boundedCount++;
    else unbounded++;
  }
  return { stores, loads, swis, sites, words, unread, bounded: boundedCount, unbounded, complete, why, passes, rounds, seconds: (Date.now() - began) / 1000, everywhere: anyStore === ANYWHERE };
}

// an ARM data-processing number: eight bits turned right by twice four
function armImmediate(op) {
  const value = op & 0xFF, turn = (op >> 8 & 15) * 2;
  return u32((value >>> turn) | (value << (32 - turn)));
}

// the targets a jump through `pc` plus an index can have within a function: each way on from `from` the index allows,
// which a comparison bounded, or every instruction after it in the function when it can't be bounded
function tableTargets(offsets, from, u) {
  if (offsets) return new Set(offsets.map(k => u32(from + k)).filter(t => t >= u.address && t < u.address + u.size));
  const out = new Set();
  for (let t = from; t < u.address + u.size; t += 4) out.add(t);
  return out;
}

// on the two ways out of an unsigned comparison of register `reg` with `k`, the numbers each way allows
function bound(taken, on, reg, k, cond) {
  const le = v => bounded(v, k, x => x <= k, k), gt = v => bounded(v, k, x => x > k, null);
  const lt = v => bounded(v, k, x => x < k, k - 1), ge = v => bounded(v, k, x => x >= k, null);
  if (cond === 0x8) { taken[reg] = gt(taken[reg]); on[reg] = le(on[reg]); }
  else if (cond === 0x9) { taken[reg] = le(taken[reg]); on[reg] = gt(on[reg]); }
  else if (cond === 0x2) { taken[reg] = ge(taken[reg]); on[reg] = lt(on[reg]); }
  else if (cond === 0x3) { taken[reg] = lt(taken[reg]); on[reg] = ge(on[reg]); }
  else if (cond === 0x0) { const n = numbers(taken[reg]); taken[reg] = n ? new Set(n.filter(x => x === k).map(x => `c${x}`)) : number(k); }
}

export { ANYWHERE, numbers, moved };
