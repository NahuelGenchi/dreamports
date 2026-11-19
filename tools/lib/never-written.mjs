// Branch ways a game never takes because nothing in it ever writes the value they go by (#1536). A conditional branch
// that reads a value of the work memory stays open in a proof until a call takes both its ways. Where no store of the
// game's code can write that value, or every store that can writes a number the code holds, the value can only ever be
// what the console starts it as, 0, or one of those numbers, and a branch every one of them sends the same way never
// goes the other. That's worked out from the cartridge's bytes, with nothing played, and only where every write can be
// followed: a store through a pointer the check can't follow may write anything, so then it can't decide, and says so.
//
// What can write the work memory:
//   - each store of the code map's functions, Thumb and ARM, read instruction by instruction over each function's
//     bytes, with what's known of the registers as `--decided` reads a run (lib/decided.mjs): a store to an address
//     the run knows writes there, with the number it knows or with a value it doesn't; a store relative to the stack
//     pointer writes the stack, in the fast work memory; and any other writes where the check can't follow
//   - the BIOS, through a swi: its copies and fills, where the run knows their place and length, its resets, which
//     clear what they're told to, and its other work, which the check doesn't follow
//   - DMA, which a store to a channel's control starts, where the run knows the channel's destination and length
//   - code the game runs from the work memory: as the copy of a function of the cartridge it is, as the code map's
//     copies say, or else code the check can't read
// Every function of the code map is read, so a store in code the code map doesn't have isn't seen: the code map is the
// game's code here, as it is for every number of the proof.

import { holds, step, arrivals } from './decided.mjs';
import { ANYWHERE, moved, numbers } from './points-to.mjs';

const CARTRIDGE = 0x08000000;
const IWRAM = 0x03000000, IWRAM_END = 0x03008000;
const u32 = n => n >>> 0;
const hex = n => `0x${u32(n).toString(16).toUpperCase().padStart(8, '0')}`;
const sized = bytes => (bytes === 1 ? 'byte' : bytes === 2 ? 'halfword' : 'word');

// a function in ARM instructions, by its first words
function isArm(bytes) {
  if (bytes.length < 16 || bytes.length % 4) return false;
  const word = at => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
  return [0, 4, 8, 12].map(word).filter(w => w >>> 28 === 0xE).length >= 3;
}

// whether a Thumb instruction never goes on to the next: a branch, a return, or a jump through a register
const endsThumb = op => (op & 0xF800) === 0xE000 || (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700 || (op & 0xFF87) === 0x4687;
const fresh = () => ({ r: new Array(16).fill(null), n: null, z: null, c: null, v: null });

// the BIOS's calls that write no memory: Halt, Stop, the waits for an interrupt, the divisions, Sqrt, ArcTan,
// ArcTan2, GetBiosChecksum and MidiKey2Freq
const QUIET = new Set([0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0D, 0x1F]);
// those that write from r1 on, a length of their own: the affine sets, BitUnPack and the decompressions
const FROM_R1 = new Set([0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18]);

/**
 * Every write the game's code can make, each { at, kind, from, to, bytes, why }: `at` the instruction that makes it,
 * and `kind` 'known', of the bytes `from` up to `to`, `bytes` the value each one gets when the check knows it (as many
 * as the store is wide, over and over) or null, 'stack', or 'unknown', with `why`. `rom` is the cartridge's bytes,
 * `functions` the code map's and `copies` its copies, each { ram, cartridge, size }.
 */
export function writesOf(rom, functions, copies = [], followed = null) {
  const writes = [];
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length);
  const word = address => (address >= CARTRIDGE && address + 4 <= CARTRIDGE + rom.length ? view.getUint32(address - CARTRIDGE, true) : null);
  const inRom = functions.filter(f => !f.bytes && f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length);
  const targets = arrivals(rom, inRom);
  for (const f of functions) {
    if (inRom.includes(f)) continue;
    // code the game runs from the work memory: a copy of the cartridge's, which is read there, or code it can't read
    if (!copies.some(c => f.address >= c.ram && f.address + f.size <= c.ram + c.size)) {
      writes.push({ at: f.address, kind: 'unknown', why: `the code at ${hex(f.address)} runs from the work memory and isn't a copy of the cartridge's the code map knows, so its writes can't be read` });
    }
  }
  for (const f of inRom) {
    const bytes = rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
    if (isArm(bytes)) armWrites(bytes, f.address, writes);
    else thumbWrites(bytes, f.address, word, targets, writes, followed?.complete ? followed : null);
  }
  return writes;
}

// the stores of an ARM function: to the stack, or through a register the check doesn't follow in ARM code
function armWrites(bytes, address, writes) {
  for (let at = 0; at + 4 <= bytes.length; at += 4) {
    const op = (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0, pc = address + at;
    if (op >>> 28 === 0xF) continue;
    if ((op & 0x0F000000) === 0x0F000000) {
      writes.push({ at: pc, kind: 'unknown', why: `the ARM code at ${hex(pc)} calls the BIOS, which the check doesn't follow in ARM code` });
      continue;
    }
    // a single store (STR, STRB), a halfword store (STRH), a block store (STM) and a swap (SWP)
    const single = (op & 0x0C100000) === 0x04000000, half = (op & 0x0E1000F0) === 0x000000B0;
    const block = (op & 0x0E100000) === 0x08000000, swap = (op & 0x0FB00FF0) === 0x01000090;
    if (!single && !half && !block && !swap) continue;
    const base = op >> 16 & 15;
    if (base === 13) writes.push({ at: pc, kind: 'stack' });
    else writes.push({ at: pc, kind: 'unknown', why: `the ARM store at ${hex(pc)} writes through r${base}, which the check doesn't follow in ARM code` });
  }
}

// the stores of a Thumb function, each read with what the run before it knows of the registers
function thumbWrites(bytes, address, word, targets, writes, followed) {
  const u16 = at => bytes[at] | bytes[at + 1] << 8;
  let state = fresh(), dma = [{}, {}, {}, {}];
  const known = (at, from, size, value) => writes.push({ at, kind: 'known', from: u32(from), to: u32(from + size), bytes: value === null ? null : Array.from({ length: Math.min(size, 4) }, (_, i) => value >>> (8 * i) & 0xFF) });
  const unknown = (at, why) => writes.push({ at, kind: 'unknown', why });
  // a store whose base the run doesn't know, where the pass that follows pointers bounds it (points-to.mjs): to each
  // place it can be, an allocator's arena for one of its objects, or the stack; or else where the check can't follow
  const pointed = (at, size, extra = 0) => {
    const found = followed?.stores.get(at);
    const where = found ? moved(found.base, found.offset + extra) : ANYWHERE;
    if (where === ANYWHERE) return unknown(at, `the store at ${hex(at)} writes through a pointer the check can't follow`);
    const values = numbers(found.value);
    for (const e of where) {
      if (e[0] === 's') { writes.push({ at, kind: 'stack' }); continue; }
      if (e[0] === 'h') {
        const arena = followed.sites.get(Number(e.slice(1, e.lastIndexOf(':'))));
        if (!arena) return unknown(at, `the store at ${hex(at)} writes into an object the check can't place`);
        known(at, arena.from, arena.to - arena.from, null);
        continue;
      }
      const a = Number(e.slice(1));
      if (a >= 0x04000000 && a < 0x04000400) { if (a >= 0x040000B0 && a < 0x040000E0) unknown(at, `the store at ${hex(at)} starts a DMA through a pointer`); continue; }
      if (values && values.length <= 16) for (const v of values) known(at, a, size, v & (size === 4 ? 0xFFFFFFFF : size === 2 ? 0xFFFF : 0xFF));
      else known(at, a, size, null);
    }
  };
  // a store to a DMA channel's registers: its destination and length are kept, and a start writes where they say
  const dmaStore = (at, where, size, value) => {
    if (where < 0x040000B0 || where >= 0x040000E0) return;
    const channel = (where - 0x040000B0) / 12 | 0, place = (where - 0x040000B0) % 12, kept = dma[channel];
    for (let i = 0; i < size; i++) kept[place + i] = value === null ? null : value >>> (8 * i) & 0xFF;
    if (place + size <= 10) return;
    const have = (...places) => places.every(i => kept[i] !== undefined && kept[i] !== null);
    if (!have(10, 11)) return unknown(at, `the DMA channel ${channel} the store at ${hex(at)} may start writes where the check can't follow`);
    const control = kept[10] | kept[11] << 8;
    if (!(control & 0x8000)) return;
    if (!have(4, 5, 6, 7, 8, 9)) return unknown(at, `the DMA channel ${channel} the store at ${hex(at)} starts writes where the check can't follow`);
    const dest = (kept[4] | kept[5] << 8 | kept[6] << 16 | kept[7] << 24) >>> 0;
    const count = (kept[8] | kept[9] << 8) || (channel === 3 ? 0x10000 : 0x4000);
    // into the hardware's registers, as a sound FIFO, it writes no memory
    if (dest >= 0x04000000 && dest < 0x04000400) return;
    const width = control & 0x0400 ? 4 : 2, mode = control >> 5 & 3, length = mode === 2 ? width : count * width;
    known(at, mode === 1 ? dest - length + width : dest, length, null);
  };
  // a store of `size` bytes at a base and an offset: where the run knows both, to that place; to the stack; or anywhere
  const store = (at, base, offset, size, value) => {
    const b = state.r[base];
    if (b === null || offset === null) return followed ? pointed(at, size) : unknown(at, `the store at ${hex(at)} writes through r${base}, a pointer the check can't follow`);
    const where = u32(b + offset);
    if (where >= 0x04000000 && where < 0x04000400) return dmaStore(at, where, size, value);
    known(at, where, size, value === null ? null : value & (size === 4 ? 0xFFFFFFFF : size === 2 ? 0xFFFF : 0xFF));
  };
  // the numbers beside the code, which an LDR through the program counter reads: data, not instructions
  const pool = new Set();
  for (let at = 0; at + 2 <= bytes.length; at += 2) {
    if (pool.has(at)) continue;
    if (at === 0 || targets.has(address + at)) { state = fresh(); dma = [{}, {}, {}, {}]; }
    const op = u16(at), pc = address + at, r = state.r;
    if ((op & 0xF800) === 0x4800) {
      const place = ((at + 4) & ~3) + (op & 0xFF) * 4;
      for (let i = 0; i < 4; i++) pool.add(place + i);
    }
    if ((op & 0xF800) === 0xF000 && at + 4 <= bytes.length && (u16(at + 2) & 0xF800) === 0xF800) {
      // a call: what it writes is the callee's, which is read as a function of its own
      state = fresh();
      at += 2;
      continue;
    }
    if (((op & 0xE000) === 0x6000 || (op & 0xF000) === 0x8000) && !(op & 0x0800)) {
      // STR, STRB, STRH with a number
      const size = (op & 0xF000) === 0x8000 ? 2 : op & 0x1000 ? 1 : 4;
      store(pc, op >> 3 & 7, (op >> 6 & 31) * size, size, r[op & 7]);
    } else if ((op & 0xF000) === 0x5000 && (op >> 9 & 7) <= 2) {
      // STR, STRH, STRB with a register
      const size = [4, 2, 1][op >> 9 & 7];
      store(pc, op >> 3 & 7, r[op >> 6 & 7], size, r[op & 7]);
    } else if ((op & 0xF800) === 0x9000 || (op & 0xFE00) === 0xB400) {
      // to the stack: STR relative to sp, and PUSH
      writes.push({ at: pc, kind: 'stack' });
    } else if ((op & 0xF800) === 0xC000) {
      // STMIA: each register, from where the base is
      const base = r[op >> 8 & 7], list = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => op >> i & 1);
      if (base === null) {
        if (followed) list.forEach((_, n) => pointed(pc, 4, 4 * n - 4 * (list.length - 1)));
        else unknown(pc, `the store at ${hex(pc)} writes through r${op >> 8 & 7}, a pointer the check can't follow`);
      }
      else list.forEach((i, n) => known(pc, base + 4 * n, 4, r[i]));
    } else if ((op & 0xFF00) === 0xDF00) {
      // what the run doesn't know of the registers the BIOS is given, the pass may
      const given = followed?.swis.get(pc), one = v => { const n = numbers(v ?? ANYWHERE); return n && n.length === 1 ? n[0] : null; };
      biosWrites(op & 0xFF, given ? r.map((v, i) => (v !== null ? v : i <= 2 ? one(given[`r${i}`]) : null)) : r, pc, known, unknown);
    }
    step(state, op, pc, word);
    if (endsThumb(op)) { state = fresh(); dma = [{}, {}, {}, {}]; }
  }
}

// what the BIOS writes for a swi, from what the run knows of the registers it's given
function biosWrites(call, r, pc, known, unknown) {
  if (QUIET.has(call)) return;
  // SoftReset clears the top of the fast work memory
  if (call === 0x00) return known(pc, 0x03007E00, 0x200, 0);
  if (call === 0x01) {
    // RegisterRamReset clears what r0's bits ask for
    if (r[0] === null) return unknown(pc, `the BIOS's reset at ${hex(pc)} clears what r0 asks, which the check can't follow`);
    if (r[0] & 1) known(pc, 0x02000000, 0x40000, 0);
    if (r[0] & 2) known(pc, 0x03000000, 0x7E00, 0);
    return;
  }
  if ((call === 0x0B || call === 0x0C) && r[1] !== null && r[2] !== null) {
    // CpuSet and CpuFastSet: halfwords or words from r1 on, as many as r2 says, the values the check doesn't follow
    const control = r[2], words = call === 0x0C || (control & 0x04000000) !== 0;
    const count = call === 0x0C ? Math.ceil((control & 0x1FFFFF) / 8) * 8 : control & 0x1FFFFF;
    return known(pc, r[1], count * (words ? 4 : 2), null);
  }
  if (call === 0x0B || call === 0x0C || FROM_R1.has(call)) return unknown(pc, `the BIOS's work at ${hex(pc)} (swi 0x${call.toString(16).toUpperCase()}) writes from r1 on, where or how far the check can't follow`);
  return unknown(pc, `the BIOS's work at ${hex(pc)} (swi 0x${call.toString(16).toUpperCase()}) writes what the check doesn't follow`);
}

/**
 * What the `bytes` bytes at `address` can hold in the game, from its `writes`: { values }, a set of numbers, starting
 * from the console's 0, or { cannot }, why not.
 */
export function valuesAt(address, bytes, writes) {
  const end = u32(address + bytes);
  const unknown = writes.filter(w => w.kind === 'unknown');
  if (unknown.length) return { cannot: `a write the check can't follow may set it: ${unknown.slice(0, 3).map(w => w.why).join('; ')}${unknown.length > 3 ? `, and ${unknown.length - 3} more such writes` : ''}` };
  if (address >= IWRAM && address < IWRAM_END && writes.some(w => w.kind === 'stack')) {
    return { cannot: 'it is in the fast work memory, which the game\'s stack is in and its code writes through the stack pointer' };
  }
  // each byte's values: the console's 0, and what every write over it puts there
  const each = Array.from({ length: bytes }, () => new Set([0]));
  for (const w of writes) {
    if (w.kind !== 'known' || w.to <= address || w.from >= end) continue;
    if (!w.bytes) return { cannot: `the write at ${hex(w.at)} can put a value the check can't follow there` };
    for (let i = 0; i < bytes; i++) {
      const place = address + i;
      if (place >= w.from && place < w.to) each[i].add(w.bytes[(place - w.from) % w.bytes.length]);
    }
  }
  let values = [0];
  for (let i = 0; i < bytes; i++) {
    values = values.flatMap(v => [...each[i]].map(b => u32(v | b << (8 * i))));
    if (values.length > 256) return { cannot: 'it can hold more values than the check tries' };
  }
  return { values: new Set(values) };
}

// what a Thumb load reads into: { to, bytes, signed }, or null for no load from memory through a register
function loadShape(op) {
  if ((op & 0xE000) === 0x6000 && op & 0x0800) return { to: op & 7, bytes: op & 0x1000 ? 1 : 4, signed: false };
  if ((op & 0xF800) === 0x8800) return { to: op & 7, bytes: 2, signed: false };
  if ((op & 0xF000) === 0x5000 && (op >> 9 & 7) >= 3) {
    const kind = op >> 9 & 7;
    return { to: op & 7, bytes: { 3: 1, 4: 4, 5: 2, 6: 1, 7: 2 }[kind], signed: kind === 3 || kind === 7 };
  }
  return null;
}

// a Thumb load from a place the run knows: { to, address, bytes, signed }, or null
function loadOf(op, r) {
  if ((op & 0xE000) === 0x6000 && op & 0x0800) {
    const size = op & 0x1000 ? 1 : 4, base = r[op >> 3 & 7];
    return base === null ? null : { to: op & 7, address: u32(base + (op >> 6 & 31) * size), bytes: size, signed: false };
  }
  if ((op & 0xF800) === 0x8800) {
    const base = r[op >> 3 & 7];
    return base === null ? null : { to: op & 7, address: u32(base + (op >> 6 & 31) * 2), bytes: 2, signed: false };
  }
  if ((op & 0xF000) === 0x5000 && (op >> 9 & 7) >= 3) {
    const kind = op >> 9 & 7, base = r[op >> 3 & 7], offset = r[op >> 6 & 7];
    if (base === null || offset === null) return null;
    return { to: op & 7, address: u32(base + offset), bytes: { 3: 1, 4: 4, 5: 2, 6: 1, 7: 2 }[kind], signed: kind === 3 || kind === 7 };
  }
  return null;
}

/**
 * Whether the conditional branch at `branch`, in the Thumb function of the code map it's in, never goes one way in
 * this game because of the values it reads: { decided: { address, way, from, fields } }, with each value it goes by as
 * { address, bytes, values }, or { cannot }, why not. `writes` is what writesOf gives for the game.
 */
export function neverWrittenBranch(rom, functions, branch, writes, followed = null) {
  if (!followed?.complete) followed = null;
  const f = functions.find(each => !each.bytes && branch >= each.address && branch < each.address + each.size);
  if (!f) return { cannot: `${hex(branch)} isn't in a function of the code map` };
  const bytes = rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
  if (isArm(bytes)) return { cannot: `${hex(branch)} is in ARM code, whose branches the check doesn't read` };
  const u16 = at => bytes[at] | bytes[at + 1] << 8, at = branch - f.address, op = u16(at);
  if ((op & 0xF000) !== 0xD000 || (op >> 8 & 0xF) >= 0xE) return { cannot: `${hex(branch)} isn't a conditional branch` };
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length);
  const word = address => (address >= CARTRIDGE && address + 4 <= CARTRIDGE + rom.length ? view.getUint32(address - CARTRIDGE, true) : null);
  const targets = arrivals(rom, functions.filter(each => !each.bytes && each.address >= CARTRIDGE && each.address + each.size <= CARTRIDGE + rom.length));
  // back to the last place anything else can arrive at, as --decided reads a run, and never across a call
  let start = at;
  while (start >= 2 && !targets.has(f.address + start) && !endsThumb(u16(start - 2)) && (u16(start - 2) & 0xF800) !== 0xF800) start -= 2;
  if (start === at) return { cannot: `something else arrives right at ${hex(branch)}` };
  const run = (given = new Map()) => {
    const state = fresh(), loads = [];
    for (let pc = start; pc < at; pc += 2) {
      let load = loadOf(u16(pc), state.r);
      if (load) load = { ...load, addresses: [load.address] };
      else if (followed && loadShape(u16(pc))) {
        // a load through a pointer the run doesn't know, where the pass that follows pointers bounds it to addresses
        const found = followed.loads.get(f.address + pc), where = found ? numbers(moved(found.base, found.offset)) : null;
        if (where) load = { ...loadShape(u16(pc)), addresses: where, address: where[0] };
      }
      step(state, u16(pc), f.address + pc, word);
      if (!load) continue;
      loads.push({ pc: f.address + pc, ...load });
      if (given.has(f.address + pc)) {
        const raw = given.get(f.address + pc), shift = 32 - 8 * load.bytes;
        state.r[load.to] = load.signed ? u32((raw << shift) >> shift) : raw;
      }
    }
    return { taken: holds(op >> 8 & 0xF, state), loads };
  };
  const plain = run();
  if (plain.taken !== null) return { cannot: `the code alone decides ${hex(branch)}, as untouched --decided says` };
  if (!plain.loads.length) return { cannot: `the run from ${hex(f.address + start)} to ${hex(branch)} reads nothing from a place it knows${followed ? ' or the pass that follows pointers bounds' : ''}: what the branch goes by comes from before the run, or through a pointer` };
  const fields = [];
  for (const load of plain.loads) {
    // the cartridge holds what it holds; the work memory is what the game writes; anything else isn't followed here
    let values = new Set(), cartridge = true;
    for (const address of load.addresses) {
      if (address >= CARTRIDGE && address + load.bytes <= CARTRIDGE + rom.length) {
        let value = 0;
        for (let i = 0; i < load.bytes; i++) value |= rom[address - CARTRIDGE + i] << (8 * i);
        values.add(u32(value));
        continue;
      }
      cartridge = false;
      const inWork = (address >= 0x02000000 && address + load.bytes <= 0x02040000) || (address >= IWRAM && address + load.bytes <= IWRAM_END);
      if (!inWork) return { cannot: `${hex(branch)} goes by the ${sized(load.bytes)} at ${hex(address)}, which isn't in the work memory or the cartridge` };
      const found = valuesAt(address, load.bytes, writes);
      if (found.cannot) return { cannot: `${hex(branch)} goes by the ${sized(load.bytes)} at ${hex(address)}, and ${found.cannot}` };
      for (const v of found.values) values.add(v);
    }
    fields.push({ ...load, values: [...values].sort((a, b) => a - b), ...(cartridge ? { cartridge: true } : {}) });
  }
  let combos = [new Map()];
  for (const field of fields) {
    combos = combos.flatMap(given => field.values.map(v => new Map([...given, [field.pc, v]])));
    if (combos.length > 4096) return { cannot: `${hex(branch)} goes by values that together can be more than the check tries` };
  }
  const ways = new Set(combos.map(given => run(given).taken));
  if (ways.has(null)) return { cannot: `${hex(branch)} goes by more than the values its run reads from places it knows` };
  if (ways.size > 1) return { cannot: `the values the game can put where ${hex(branch)} reads send it both ways: ${fields.filter(field => !field.cartridge).map(field => `${hex(field.address)} can hold ${field.values.map(v => `0x${v.toString(16).toUpperCase()}`).join(', ')}`).join('; ')}` };
  const [taken] = ways;
  return { decided: { address: branch, way: taken ? 'not taken' : 'taken', from: f.address + start, fields: fields.filter(field => !field.cartridge).map(field => ({ address: field.address, bytes: field.bytes, values: field.values })) } };
}

/** Why a never-written branch can't go its other way, for the game's unreachable.json. */
export function neverWrittenWhy({ address, way, from, fields }) {
  const held = fields.map(field => `the ${sized(field.bytes)} at ${hex(field.address)}, which no store, BIOS call or DMA of the game's code can set to anything but ${field.values.map(v => `0x${v.toString(16).toUpperCase()}`).join(' or ')}`).join(', and ');
  return `The branch at ${hex(address)} goes by ${held}, read in the run from ${hex(from)}, so it's never ${way} in this game: never written.`;
}
