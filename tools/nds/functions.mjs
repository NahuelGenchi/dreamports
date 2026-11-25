// Finds the functions in a Nintendo DS game's code, for its code map: where each one starts, how many bytes it takes and
// whether it's ARM or Thumb code, and nothing of the code itself. A function in Thumb code has `mode: 'thumb'`, which
// the code map keeps beside it, and one in ARM code has none.
//
// A cartridge has more programs than one. The ARM9's is most of the game, and a function of it has a plain address for
// its key, as `02000800`. The ARM7's reads the touch screen and plays the sound, and its functions' keys end in `@ARM7`.
// A game loads more code as it plays, its overlays, each a file of the cartridge with a place in memory of its own, and
// two overlays can have the same place, as only one of them is there at a time: an overlay's functions' keys end in
// `@OVERLAY9_0003`, the ARM9's fourth, or `@OVERLAY7_0000`. The console's makers' tools pack the ARM9's program and its
// overlays from the end backwards, which this unpacks, and keep in the ARM9's program the code it copies elsewhere as it
// starts, such as into its fast memory, which this places where it runs.
//
// Like a disassembler, it follows each program's code from where it starts, through every call and branch, in the
// processor's two kinds of code: ARM, four bytes an instruction, and Thumb, two. A call says which kind it calls, and an
// address a function loads says it by its lowest bit. Then it takes what opens as a function does, saving the return
// address, between the functions it has, as nothing says where an overlay's functions start, and what a table of
// functions names is found that way too. It can miss a function nothing calls that opens another way, and can't tell
// which overlay a call into an overlay's place means.

import { closeSync, openSync, readSync } from 'node:fs';
import { isNdsHeader, readNdsHeader } from './header.mjs';

const u32of = (bytes, at) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;

/**
 * Unpacks what the console's makers' tools packed from the end backwards, as the ARM9's program and its overlays are:
 * the last 8 bytes say how much of the end is packed and how much longer it is unpacked. The bytes before that are as
 * they are.
 */
export function unpackBackwards(bytes) {
  const end = bytes.length;
  if (end < 8) return Buffer.from(bytes);
  const packed = u32of(bytes, end - 8) & 0xFFFFFF, header = bytes[end - 5], longer = u32of(bytes, end - 4);
  if (packed > end || header < 8 || header > packed) throw new Error('This code says it\'s packed and isn\'t packed as the console\'s is.');
  const out = Buffer.alloc(end + longer), stop = end - packed;
  Buffer.from(bytes).copy(out, 0, 0, stop);
  let from = end - header, to = out.length;
  while (to > stop) {
    if (from <= stop) throw new Error('This code\'s packing ends before its unpacked length is reached.');
    const flags = bytes[--from];
    for (let bit = 7; bit >= 0 && to > stop; bit--) {
      if (!(flags >> bit & 1)) { out[--to] = bytes[--from]; continue; }
      const word = bytes[--from] << 8 | bytes[--from], length = (word >> 12) + 3, back = (word & 0xFFF) + 3;
      for (let i = 0; i < length && to > stop; i++) { to--; out[to] = out[to + back]; }
    }
  }
  return out;
}

// the two words the console's makers' start-up code keeps after what it needs to know of the program, by which it's found
const MARK = [0x2106C0DE, 0xDEC00621];

// The ARM9's program as it runs: unpacked, with each stretch it copies elsewhere as it starts at the place it runs.
// [{ address, bytes }], the program itself first
function arm9Segments(bytes, address) {
  let program = Buffer.from(bytes), mark = -1;
  for (let at = 0; at + 8 <= program.length; at += 4) if (u32of(program, at) === MARK[0] && u32of(program, at + 4) === MARK[1]) { mark = at; break; }
  if (mark < 0x1C) return [{ address, bytes: program }];
  // before the mark: the list of stretches to copy, where it ends, where their bytes start, and where the packing ends
  const [listStart, listEnd, dataStart, , , packedEnd] = [0, 1, 2, 3, 4, 5].map(i => u32of(program, mark - 0x1C + i * 4));
  if (packedEnd > address && packedEnd - address <= program.length) {
    program = Buffer.concat([unpackBackwards(program.subarray(0, packedEnd - address)), program.subarray(packedEnd - address)]);
  }
  const segments = [{ address, bytes: program }], inside = at => at >= address && at <= address + program.length;
  if (inside(listStart) && inside(listEnd) && inside(dataStart) && listEnd >= listStart) {
    let from = dataStart - address;
    for (let at = listStart - address; at + 12 <= listEnd - address; at += 12) {
      const to = u32of(program, at), size = u32of(program, at + 4);
      if (from + size > program.length) break;
      if (size) segments.push({ address: to, bytes: program.subarray(from, from + size), copied: from + address });
      from += size;
    }
    // what's copied elsewhere doesn't run where the cartridge keeps it
    if (segments.length > 1) segments[0] = { address, bytes: program.subarray(0, dataStart - address) };
  }
  return segments;
}

/**
 * A copy's programs, read from the file a piece at a time, as a cartridge can be half a gigabyte: { header, programs },
 * each program { name, processor, segments: [{ address, bytes }], starts: [{ address, thumb }] }, `name` null for the
 * ARM9's own, 'ARM7' for the ARM7's, and an overlay's as its functions' keys have it.
 */
export function ndsCartridge(path) {
  const file = openSync(path, 'r');
  try {
    const read = (offset, size) => {
      const bytes = Buffer.alloc(size);
      bytes.fill(0, readSync(file, bytes, 0, size, offset));
      return bytes;
    };
    const head = read(0, 0x200);
    if (!isNdsHeader(head)) throw new Error(`${path} isn't a Nintendo DS cartridge.`);
    return cartridgeOf(head, read);
  } finally {
    closeSync(file);
  }
}

/** The same from a cartridge's bytes, all of them. */
export const ndsCartridgeOf = rom => cartridgeOf(rom, (offset, size) => { const bytes = Buffer.alloc(size); rom.copy(bytes, 0, offset, Math.min(rom.length, offset + size)); return bytes; });

function cartridgeOf(head, read) {
  const header = readNdsHeader(head);
  const startOf = entry => ({ address: (entry & ~1) >>> 0, thumb: !!(entry & 1) });
  const programs = [
    { name: null, processor: 'arm9', segments: arm9Segments(read(header.arm9.offset, header.arm9.size), header.arm9.address), starts: [startOf(header.arm9.entry)] },
    { name: 'ARM7', processor: 'arm7', segments: [{ address: header.arm7.address, bytes: read(header.arm7.offset, header.arm7.size) }], starts: [startOf(header.arm7.entry)] },
  ];
  // each processor's table of overlays: 32 bytes each, with its number, where it's loaded, how long it is, the list
  // of functions it runs as it's loaded, which file of the cartridge it is, and whether that file is packed
  const places = header.files.places.size ? read(header.files.places.offset, header.files.places.size) : Buffer.alloc(0);
  for (const [processor, table] of [['arm9', header.overlays.arm9], ['arm7', header.overlays.arm7]]) {
    const entries = table.size ? read(table.offset, table.size) : Buffer.alloc(0);
    for (let at = 0; at + 32 <= entries.length; at += 32) {
      const number = u32of(entries, at), address = u32of(entries, at + 4), size = u32of(entries, at + 8);
      const firstStart = u32of(entries, at + 16), lastStart = u32of(entries, at + 20), fileNumber = u32of(entries, at + 24), packed = entries[at + 31] & 1;
      if (fileNumber * 8 + 8 > places.length) continue;
      const from = u32of(places, fileNumber * 8), to = u32of(places, fileNumber * 8 + 4);
      if (to <= from) continue;
      let bytes = read(from, to - from);
      if (packed) bytes = unpackBackwards(bytes);
      bytes = bytes.subarray(0, Math.max(size, 0) || bytes.length);
      // the functions it runs as it's loaded, a list of their addresses in the overlay itself
      const starts = [];
      for (let a = firstStart; a + 4 <= lastStart && a >= address && a - address + 4 <= bytes.length; a += 4) {
        const value = u32of(bytes, a - address);
        if (value) starts.push(startOf(value));
      }
      programs.push({ name: `OVERLAY${processor === 'arm9' ? 9 : 7}_${String(number).padStart(4, '0')}`, processor, segments: [{ address, bytes }], starts });
    }
  }
  return { header, programs };
}

const sign = (value, bits) => (value << (32 - bits)) >> (32 - bits);
// ARM: a function that saves its return address opens with stmdb sp!, {…, lr}
const armOpens = word => (word & 0xFFFF4000) >>> 0 === 0xE92D4000;
// Thumb: with push {…, lr}
const thumbOpens = op => (op & 0xFF00) === 0xB500;
// Thumb instructions neither processor has, which data read as code soon meets
const thumbInvalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200 || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800;

/**
 * The functions of one program, each { address, size }, with mode: 'thumb' for one in Thumb code, in order. `listed` are functions a
 * list already knows, as { address, size, mode }: their code is followed too.
 */
export function findProgramFunctions({ segments, starts }, listed = []) {
  const segmentOf = address => segments.find(s => address >= s.address && address < s.address + s.bytes.length);
  const inside = address => !!segmentOf(address);
  const u16 = address => { const s = segmentOf(address), at = address - s.address; return at + 2 <= s.bytes.length ? s.bytes[at] | s.bytes[at + 1] << 8 : 0; };
  const u32 = address => { const s = segmentOf(address), at = address - s.address; return at + 4 <= s.bytes.length ? u32of(s.bytes, at) : 0; };
  const found = new Map(), queue = [], data = new Set();
  const add = (address, thumb) => {
    address >>>= 0;
    if (!inside(address) || address % (thumb ? 2 : 4) || found.has(address)) return;
    found.set(address, { thumb, end: address });
    queue.push(address);
  };
  // a word a function loads, which is never code: an address in it that opens as a function does is one
  const loads = at => {
    if (!inside(at)) return;
    data.add(at);
    const value = u32(at);
    if (value & 1) { if (inside(value - 1) && thumbOpens(u16(value - 1))) add(value - 1, true); }
    else if (value % 4 === 0 && inside(value) && armOpens(u32(value))) add(value, false);
  };
  // an address loaded into a register the code then jumps or calls through is a function's, whatever it opens with:
  // its lowest bit says whether it's Thumb code
  let loaded = null;
  const through = register => {
    if (loaded?.register === register && inside(loaded.value & ~1)) add(loaded.value & ~1, !!(loaded.value & 1));
  };
  // where a branch that always goes leaves a function for another: a function already known, or code that opens as one
  const leaves = (target, start, thumb) => target < start || (target !== start && found.has(target)) || (thumb ? thumbOpens(u16(target)) : armOpens(u32(target)));

  function traceArm(start) {
    const mine = segmentOf(start), limit = mine.address + mine.bytes.length;
    let pc = start, reach = start;
    for (; pc + 4 <= limit && !data.has(pc) && !(pc !== start && found.has(pc) && pc >= reach); pc += 4) {
      const word = u32(pc), always = word >>> 28 === 0xE;
      let ends = false;
      if (word >>> 28 === 0xF) {
        // blx to Thumb code
        if ((word & 0xFE000000) >>> 0 === 0xFA000000) add(pc + 8 + (sign(word & 0xFFFFFF, 24) << 2) + ((word >>> 24 & 1) << 1), true);
      } else if ((word & 0x0F000000) === 0x0B000000) {
        add(pc + 8 + (sign(word & 0xFFFFFF, 24) << 2), false);
      } else if ((word & 0x0F000000) === 0x0A000000) {
        const target = (pc + 8 + (sign(word & 0xFFFFFF, 24) << 2)) >>> 0;
        if (!inside(target) || leaves(target, start, false)) add(target, false);
        else reach = Math.max(reach, target);
        ends = always;
      } else if ((word & 0x0FFFFFD0) === 0x012FFF10) {
        through(word & 15);                                        // bx, and blx through a register
        ends = always && !(word & 0x20);
      } else if ((word & 0x0E108000) === 0x08108000) {
        ends = always;                                             // ldm with pc
      } else if ((word & 0x0F7F0000) === 0x051F0000) {
        const beside = pc + 8 + (word & 0x00800000 ? 1 : -1) * (word & 0xFFF);   // ldr from beside the function
        loads(beside);
        if (inside(beside)) loaded = { register: word >>> 12 & 15, value: u32(beside) };
        if ((word >>> 12 & 15) === 15) ends = always;
      } else if ((word & 0x0E50F000) === 0x0410F000) {
        // ldr pc: a jump through a pointer, and with pc and a register, through the table of addresses after it
        if ((word & 0x0E0F0000) === 0x060F0000) {
          for (let at = pc + 8; inside(at) && !found.has(at); at += 4) {
            const target = u32(at);
            if (target % 4 || target < start || target >= start + 0x10000 || !inside(target)) break;
            data.add(at);
            reach = Math.max(reach, target);
          }
        }
        ends = always;
      } else if ((word & 0x0C000000) === 0 && (word >>> 12 & 15) === 15 && (word >>> 21 & 0xC) !== 8) {
        // something worked out into pc: a return, or with pc and a register added, a jump into the branches after it
        if ((word & 0x0FEF0010) === 0x008F0000) {
          reach = Math.max(reach, pc + 8);
          for (let at = pc + 8; inside(at) && (u32(at) & 0xFF000000) >>> 0 === 0xEA000000; at += 4) {
            const target = (at + 8 + (sign(u32(at) & 0xFFFFFF, 24) << 2)) >>> 0;
            if (target >= start && inside(target)) reach = Math.max(reach, target);
            reach = Math.max(reach, at + 4);
          }
        } else {
          ends = always;
        }
      }
      if (ends && pc + 4 > reach) { pc += 4; break; }
    }
    return pc;
  }

  function traceThumb(start) {
    const mine = segmentOf(start), limit = mine.address + mine.bytes.length;
    let pc = start, reach = start;
    for (; pc + 2 <= limit && !data.has(pc & ~3) && !(pc !== start && found.has(pc) && pc >= reach); pc += 2) {
      const op = u16(pc);
      let ends = false;
      if (thumbInvalid(op)) break;
      if ((op & 0xF800) === 0xF000 && pc + 4 <= limit) {
        const next = u16(pc + 2), target = pc + 4 + (sign(op & 0x7FF, 11) << 12) + ((next & 0x7FF) << 1);
        if ((next & 0xF800) === 0xF800) add(target, true);
        else if ((next & 0xF801) === 0xE800) add(target & ~3, false);
        else break;
        pc += 2;
      } else if ((op & 0xFF07) === 0x4700) {
        through(op >> 3 & 15);                                     // bx, and blx through a register
        ends = !(op & 0x80);
      } else if ((op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4687) {
        ends = true;                                               // pop {…, pc}, mov pc
      } else if ((op & 0xF800) === 0xE000) {
        const target = (pc + 4 + (sign(op & 0x7FF, 11) << 1)) >>> 0;
        if (!inside(target) || leaves(target, start, true)) add(target, true);
        else reach = Math.max(reach, target);
        ends = true;
      } else if ((op & 0xF000) === 0xD000 && (op >> 8 & 15) < 14) {
        const target = (pc + 4 + (sign(op & 0xFF, 8) << 1)) >>> 0;
        if (target >= start && inside(target)) reach = Math.max(reach, target);
      } else if ((op & 0xF800) === 0x4800) {
        const beside = ((pc + 4) & ~3) + (op & 0xFF) * 4;
        loads(beside);
        if (inside(beside)) loaded = { register: op >> 8 & 7, value: u32(beside) };
      }
      if (ends && pc + 2 > reach) { pc += 2; break; }
    }
    return pc;
  }

  const drain = () => {
    while (queue.length) {
      const start = queue.pop(), f = found.get(start);
      loaded = null;
      f.end = f.thumb ? traceThumb(start) : traceArm(start);
    }
  };
  for (const { address, thumb } of starts) add(address, thumb);
  for (const f of listed) add(f.address, f.mode === 'thumb');
  drain();
  // between the functions: what opens as a function does, right after the one before it, its values and its padding
  for (let again = true; again;) {
    again = false;
    for (const segment of segments) {
      const end = segment.address + segment.bytes.length;
      const taken = [...found].filter(([address]) => address >= segment.address && address < end).map(([address, f]) => [address, Math.max(f.end, address + 2)]).sort((a, b) => a[0] - b[0]);
      let at = segment.address;
      for (const [from, to] of [...taken, [end, end]]) {
        while (at < from) {
          // one found on the way, by a function just followed
          if (found.has(at)) { at = Math.max(found.get(at).end, at + 2); continue; }
          const arm = at % 4 === 0 && at + 4 <= from && armOpens(u32(at));
          if (data.has(at & ~3) || !(arm || (at + 2 <= from && thumbOpens(u16(at)) && !thumbInvalid(u16(at + 2))))) { at += 2; continue; }
          add(at, !arm);
          drain();
          again = true;
          at = Math.max(found.get(at).end, at + 2);
        }
        at = Math.max(at, to);
      }
    }
  }
  const list = [...found].map(([address, f]) => ({ address, end: f.end, thumb: f.thumb })).sort((a, b) => a.address - b.address);
  const sized = list.map((f, i) => {
    const segment = segmentOf(f.address), most = Math.min(list[i + 1]?.address ?? Infinity, segment.address + segment.bytes.length);
    return { address: f.address, size: Math.max(f.thumb ? 2 : 4, Math.min(f.end, most) - f.address), ...(f.thumb ? { mode: 'thumb' } : {}) };
  });
  // those a list knows keep the size and the name it gave them
  const known = new Map(listed.map(f => [f.address, f]));
  return sized.map(f => { const { mode, ...listedAs } = known.get(f.address) ?? {}; return { ...f, ...listedAs }; });
}

/**
 * Every function of a cartridge read by ndsCartridge, each { address, size, mode, program }, `program` being the
 * program it's in when that isn't the ARM9's own. Those in `listed`, a code map's, are kept as they are, with their
 * names, and what's found is added around them, each program on its own.
 */
export function findFunctions(code, listed = []) {
  const all = [];
  for (const program of code.programs) {
    const known = listed.filter(f => (f.program ?? null) === program.name).map(({ program: _, ...f }) => f);
    for (const f of findProgramFunctions(program, known)) all.push({ ...f, ...(program.name ? { program: program.name } : {}) });
  }
  return all;
}

/** Whether an address is in the ARM9's own program, where a list's functions are. */
export const inCode = code => address => code.programs[0].segments.some(s => address >= s.address && address < s.address + s.bytes.length);

/** A list's functions that start outside every program's code: none are told apart yet beyond that. */
export const startsInData = (code, listed) => listed.filter(f => !code.programs.some(p => (f.program ?? null) === p.name && p.segments.some(s => f.address >= s.address && f.address < s.address + s.bytes.length)));

/** The bytes of one program of a cartridge at an address, or null: for the tools that read a function's code. */
export function bytesAt(code, program, address, size) {
  const segment = code.programs.find(p => p.name === (program ?? null))?.segments.find(s => address >= s.address && address + size <= s.address + s.bytes.length);
  return segment ? segment.bytes.subarray(address - segment.address, address - segment.address + size) : null;
}
