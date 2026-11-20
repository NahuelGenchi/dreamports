// The function check for a PlayStation 2 game's own modules for the IOP, the console's second processor (twin.mjs): a
// function of a module, run by itself in Play!'s IOP (call.cpp, original.mjs), and its twin, built on the console's
// kit with every address folded as the IOP's wiring takes it, are called from the same memory with the same arguments,
// and what each leaves in the IOP's 2 MB, its scratchpad, its hardware's registers and the SPU2's is compared byte for
// byte, with what each gave back.
//
// A twin names its function by the code map's key, the address from the module's start and the module, as
// /** 0x00000120@SOUND.IRX: what it does */, and a value of the module's by a label with that address, as D_00002340.
// The console loads a module wherever its memory has room and moves its addresses there, so the check does too: at
// LOAD, with the module's own list of what to move, as the console's loader reads it. A function at 0x120 is then at
// LOAD + 0x120 in every pointer the module keeps, on both sides.
//
// A call is made as the IOP's compiler makes one, which is the PlayStation's (../ps1/twin.mjs): the first four words
// of arguments in a0 to a3 and the rest on the stack from 16 bytes above sp, 64 bits in two words that start on an
// even one, a float as its bits, as the IOP has no FPU; what comes back in v0, and v1 for the upper half of 64 bits;
// s0 to s7, gp, sp and fp kept for the caller. A module reaches other modules through stubs of its own, a jump back
// and a number after each library's table: a call that reaches one is set aside, as a call into the kernel is on the
// EE, since what the other module does is the kit's to give a twin.

import { IOP_REGISTERS, KINDS, REGISTERS, SYSCALL, endText, inImage } from './original.mjs';

/** Where the check loads a module in the IOP's memory, above the kernel's and below the check's stack. */
export const LOAD = 0x00100000;
const IMAGE = KINDS.iop.image;
// where a call's stack starts, near the top of the IOP's memory, where it comes back to, and what a stub's first
// instruction is made, so a call that reaches another module stops
const STACK = 0x001FFF00, BACK = 0x001FFF80, SYSCALL_WORD = 0x0000000C;
const SHT_REL = 9, R_MIPS_32 = 2, R_MIPS_26 = 4, R_MIPS_HI16 = 5, R_MIPS_LO16 = 6;
// what starts a library's table of stubs in a module, and what each stub is: jr $ra, then li $zero, its number
const IMPORTS = 0x41E00000, JR_RA = 0x03E00008;
const KEPT = [16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30];

/** The table a module's twins' addresses are folded by (twin.mjs, foldTable): the IOP's memory through 0, 0x80000000
 *  and 0xA0000000, and its scratchpad, hardware and SPU2 through 0x1F000000 and its mirrors, each where original.mjs
 *  lays it in the IOP's image; the module's own values, from 0x03000000, where they are; every other address to
 *  `nowhere`. */
export function iopFoldTable(nowhere) {
  const table = new Uint32Array(512);
  const set = (top, mask, start) => { table[top * 2] = mask; table[top * 2 + 1] = start; };
  for (let top = 0; top < 256; top++) set(top, nowhere.bytes - 1, nowhere.at);
  for (let top = 0x03; top <= 0x0F; top++) set(top, 0xFFFFFFFF, 0);
  for (const physical of [0x00, 0x80, 0xA0]) {
    set(physical, 0x001FFFFF, 0);
    set(physical + 0x1F, 0x001FFFFF, 0x00200000);
  }
  return table;
}

/**
 * A module as the check loads it: { image, wordAt, size, stubs }. `image` is the IOP's image with the module at LOAD,
 * its addresses moved there by its own relocations and the first word of each stub to another module made a SYSCALL;
 * `wordAt(address)` a word of its code as the file has it, by its address from the module's start, or null; `size`
 * how much memory it takes; and `stubs` each stub, { at, library, number }, `at` from the module's start.
 */
export function loadModule(module) {
  if (module.readUInt32BE(0) !== 0x7F454C46 || module.readUInt16LE(16) !== 0xFF80) throw new Error('This isn\'t a module for the PlayStation 2\'s IOP: it has no IRX header.');
  const segments = [];
  for (let n = 0; n < module.readUInt16LE(44); n++) {
    const o = module.readUInt32LE(28) + n * 32;
    if (module.readUInt32LE(o) === 1) segments.push({ offset: module.readUInt32LE(o + 4), address: module.readUInt32LE(o + 8), file: module.readUInt32LE(o + 16), memory: module.readUInt32LE(o + 20) });
  }
  if (!segments.length) throw new Error('The module has nothing the IOP loads.');
  const size = Math.max(...segments.map(s => s.address + s.memory));
  if (LOAD + size > STACK - 0x20000) throw new Error(`The module takes ${size.toLocaleString('en-US')} bytes, more than the check has room for below its stack.`);
  const loaded = Buffer.alloc(size);
  for (const s of segments) module.copy(loaded, s.address, s.offset, s.offset + s.file);
  const wordAt = address => {
    const s = segments.find(each => address >= each.address && address + 4 <= each.address + each.file);
    return s ? module.readUInt32LE(s.offset + address - s.address) : null;
  };

  // the stubs, found before anything is moved: after each library's table, 20 bytes that start with its mark and end
  // with its name, a jump back and a number for each function, to two words of zeros
  const stubs = [];
  for (let at = 0; at + 20 <= size; at += 4) {
    if (loaded.readUInt32LE(at) !== IMPORTS || loaded.readUInt32LE(at + 4) !== 0) continue;
    const library = loaded.toString('latin1', at + 12, at + 20).replace(/\0.*$/, '');
    if (!/^[\x20-\x7E]+$/.test(library)) continue;
    for (let stub = at + 20; stub + 8 <= size && loaded.readUInt32LE(stub) === JR_RA && loaded.readUInt32LE(stub + 4) >>> 16 === 0x2400; stub += 8) {
      stubs.push({ at: stub, library, number: loaded.readUInt32LE(stub + 4) & 0xFFFF });
    }
  }

  // the relocations, as the console's loader does them: every one is from where the module is loaded
  const sections = module.readUInt16LE(48), table = module.readUInt32LE(32);
  for (let n = 0; n < sections; n++) {
    const o = table + n * 40;
    if (module.readUInt32LE(o + 4) !== SHT_REL) continue;
    const from = module.readUInt32LE(o + 16), count = module.readUInt32LE(o + 20) / 8;
    // a HI16 waits for the LO16 that follows it, which holds the rest of its number
    let high = [];
    for (let k = 0; k < count; k++) {
      const at = module.readUInt32LE(from + k * 8), kind = module.readUInt32LE(from + k * 8 + 4) & 0xFF;
      if (at + 4 > size) throw new Error(`The module's relocation ${k} is at 0x${at.toString(16)}, past its end.`);
      const word = loaded.readUInt32LE(at);
      if (kind === R_MIPS_32) loaded.writeUInt32LE((word + LOAD) >>> 0, at);
      else if (kind === R_MIPS_26) loaded.writeUInt32LE(((word & 0xFC000000) | (((word & 0x03FFFFFF) + (LOAD >>> 2)) & 0x03FFFFFF)) >>> 0, at);
      else if (kind === R_MIPS_HI16) high.push(at);
      else if (kind === R_MIPS_LO16) {
        const low = (word << 16) >> 16;
        for (const hi of high) {
          const upper = loaded.readUInt32LE(hi), whole = (((upper & 0xFFFF) << 16) + low + LOAD) >>> 0;
          loaded.writeUInt32LE(((upper & 0xFFFF0000) | (((whole + 0x8000) >>> 16) & 0xFFFF)) >>> 0, hi);
        }
        high = [];
        loaded.writeUInt32LE(((word & 0xFFFF0000) | ((low + LOAD) & 0xFFFF)) >>> 0, at);
      } else throw new Error(`The module has a relocation of kind ${kind}, at 0x${at.toString(16)}, which the check doesn't know how to move.`);
    }
  }
  for (const stub of stubs) loaded.writeUInt32LE(SYSCALL_WORD, stub.at);
  const image = new Uint8Array(IMAGE);
  image.set(loaded, LOAD);
  return { image, wordAt, size, stubs };
}

// a 32-bit value a narrower type holds, spread as its type says
const narrow = (value, { bits, signed }) => (bits >= 32 ? value >>> 0 : (signed ? (value << (32 - bits)) >> (32 - bits) : value & (2 ** bits - 1)) >>> 0);

/** The IOP as the check calls its functions (twin.mjs, EE), for a module loaded as `loaded` (loadModule), with `nowhere`
 *  where its fold sends what the IOP has nothing at. */
export function iopMachine(loaded, nowhere) {
  const stubAt = new Map(loaded.stubs.map(stub => [LOAD + stub.at, stub]));
  return {
    kind: 'iop', words: IOP_REGISTERS.words, stack: STACK, back: BACK,
    // a word each, 64 bits two that start on an even one: the first four in a0 to a3, the rest on the stack, where
    // the caller also leaves room for those four
    places(params) {
      let words = 0;
      const places = params.map(type => {
        if (type.bits === 64) words += words & 1;
        const place = { word: words };
        words += type.bits === 64 ? 2 : 1;
        return place;
      });
      return { places, room: 4 * Math.max(4, words) };
    },
    start(registers) {
      registers[0] = 0;
      registers[29] = STACK;
      registers[31] = BACK;
    },
    give(registers, changes, sp, place, type, value) {
      const halves = [Number(BigInt(value) & 0xFFFFFFFFn), Number(BigInt(value) >> 32n)].slice(0, type.bits === 64 ? 2 : 1);
      halves.forEach((half, n) => {
        const word = place.word + n;
        if (word < 4) registers[4 + word] = half >>> 0;
        else changes.push([sp + 4 * word, 4, half >>> 0]);
      });
    },
    kept(left, registers) {
      const register = KEPT.find(n => left[n] >>> 0 !== registers[n] >>> 0);
      return register === undefined ? undefined : `$${REGISTERS[register]}`;
    },
    theirs: (left, { bits }) => (bits === 64 ? (BigInt(left[3] >>> 0) << 32n) | BigInt(left[2] >>> 0) : BigInt(left[2] >>> 0)),
    ours: (gave, type) => (type.bits === 64 ? gave : BigInt(narrow(Number(gave & 0xFFFFFFFFn), type))),
    inMemory: value => { const place = inImage(value >>> 0, 'iop'); return place >= 0 && place < 0x00200000; },
    // a float crosses as its bits in a whole register, and a double as 64
    typeOf(code) {
      const bytes = code & 0xFF, kind = (code >>> 8) & 0xFF, signed = Boolean(code >>> 16 & 1);
      if (kind === 5) return { bits: 32, signed: false, pointer: true };
      if (kind === 8) return bytes === 4 ? { bits: 32, float: true } : bytes === 8 ? { bits: 64, signed: false } : null;
      if (kind === 4) return { bits: 8, signed: false, boolean: true };
      if ((kind === 1 || kind === 2 || kind === 3) && [1, 2, 4, 8].includes(bytes)) return { bits: bytes * 8, signed };
      return null;
    },
    table: () => iopFoldTable(nowhere),
    // a place in the IOP's memory nothing is at: below where the module is loaded, where a word starts
    free: below => (0x00040000 + below(0x2C000) * 4) >>> 0,
    // a call that reached a stub went to another module
    endText(answer) {
      const stub = answer.end === SYSCALL ? stubAt.get(answer.pc >>> 0) ?? stubAt.get((answer.pc - 4) >>> 0) : null;
      return stub ? `called function ${stub.number} of ${stub.library}, another module` : endText(answer);
    },
  };
}
