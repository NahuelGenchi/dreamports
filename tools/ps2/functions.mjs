// The functions in a PlayStation 2 game's program, for its code map (codemap.mjs): the program its disc boots, as
// SYSTEM.CNF names it, or a program given as an ELF file, read from the player's copy on their computer. Addresses are
// where the program runs, as a disassembler such as Ghidra shows them, so a list from one fits.
//
// A program that kept its symbol table says where each function starts and how long it is, and those are taken, their
// addresses and sizes only, never their names, which are the game's own words. What's left of its code, or all of it in
// a program with no symbols, is found by reading it: where it starts, every call's target (JAL), and every function's
// opening (ADDIU sp, sp, -n) right after the end of the one before it (JR ra and the instruction after it, then any
// zeros). A function reached only through a pointer and opening another way is left in the one before it.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { bootFile, readDiscFile } from '../lib/read-copy.mjs';

const JR_RA = 0x03E00008;
const isOpening = word => (word >>> 16) === 0x27BD && (word & 0x8000) !== 0;   // ADDIU sp, sp, a negative number

/** The program in a player's copy: an ELF file as it is, or the one a disc boots. */
export async function ps2Program(path) {
  if (extname(path).toLowerCase() === '.elf') return readFileSync(path);
  const name = await bootFile(path);
  const program = name && await readDiscFile(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  return program;
}

// the program's code as it's loaded: each stretch of it that runs, with where it runs and where it is in the file
function codeOf(program) {
  if (program.readUInt32BE(0) !== 0x7F454C46) throw new Error('This isn\'t a program for the PlayStation 2\'s processor: it has no ELF header.');
  const sections = [], count = program.readUInt16LE(48), at = program.readUInt32LE(32);
  for (let i = 0; i < count; i++) {
    const o = at + i * 40, flags = program.readUInt32LE(o + 8), type = program.readUInt32LE(o + 4);
    // a section of the program's own code, which runs from where it's loaded
    if (type === 1 && flags & 4 && flags & 2) sections.push({ address: program.readUInt32LE(o + 12), offset: program.readUInt32LE(o + 16), size: program.readUInt32LE(o + 20) });
  }
  if (!sections.length) {
    // a program with no sections: its segments that run
    for (let i = 0; i < program.readUInt16LE(44); i++) {
      const o = program.readUInt32LE(28) + i * 32;
      if (program.readUInt32LE(o) === 1 && program.readUInt32LE(o + 24) & 1) sections.push({ address: program.readUInt32LE(o + 8), offset: program.readUInt32LE(o + 4), size: program.readUInt32LE(o + 16) });
    }
  }
  // the vector units' code is in a section of its own that runs where they are, which isn't this processor's
  return { entry: program.readUInt32LE(24), sections: sections.filter(s => s.address >= 0x00080000) };
}

/** Whether an address is in the program's code. */
export function inCode(program) {
  const { sections } = codeOf(program);
  return address => sections.some(s => address >= s.address && address < s.address + s.size);
}

// the functions the symbol table names, with their sizes
function symbols(program, inside) {
  const found = [], count = program.readUInt16LE(48), at = program.readUInt32LE(32);
  for (let i = 0; i < count; i++) {
    const o = at + i * 40;
    if (program.readUInt32LE(o + 4) !== 2) continue;
    const offset = program.readUInt32LE(o + 16), size = program.readUInt32LE(o + 20);
    for (let s = offset; s + 16 <= offset + size; s += 16) {
      const address = program.readUInt32LE(s + 4), length = program.readUInt32LE(s + 8), kind = program[s + 12] & 15;
      if (kind === 2 && length && inside(address)) found.push({ address, size: length });
    }
  }
  return found;
}

/** The functions in the program, each { address, size }, in order, those in `listed` kept as they are. */
export function findFunctions(program, listed = []) {
  const { entry, sections } = codeOf(program), inside = inCode(program);
  const starts = new Map();
  for (const f of [...symbols(program, inside), ...listed]) if (!starts.has(f.address)) starts.set(f.address, f.size);
  const wordAt = (section, address) => program.readUInt32LE(section.offset + address - section.address);
  if (inside(entry) && !starts.has(entry)) starts.set(entry, 0);
  for (const section of sections) {
    for (let address = section.address; address + 4 <= section.address + section.size; address += 4) {
      const word = wordAt(section, address);
      // a call's target, in the same 256 MB as the call
      if (word >>> 26 === 3) {
        const target = ((address + 4) & 0xF0000000 | (word & 0x3FFFFFF) << 2) >>> 0;
        if (inside(target) && !starts.has(target)) starts.set(target, 0);
      }
      // an opening right after a return, its delay slot and any zeros
      if (isOpening(word) && !starts.has(address)) {
        let back = address - 4;
        while (back >= section.address && wordAt(section, back) === 0) back -= 4;
        if (back - 4 >= section.address && (wordAt(section, back - 4) === JR_RA || wordAt(section, back) === JR_RA)) starts.set(address, 0);
      }
    }
  }
  // a function without a size reaches the next one, or its section's end, less the zeros after it
  const ordered = [...starts.keys()].sort((a, b) => a - b), functions = [];
  ordered.forEach((address, i) => {
    const section = sections.find(s => address >= s.address && address < s.address + s.size);
    let size = starts.get(address);
    if (!size) {
      let end = Math.min(ordered[i + 1] ?? Infinity, section.address + section.size);
      while (end - 4 > address && wordAt(section, end - 4) === 0) end -= 4;
      size = end - address;
    }
    functions.push({ address, size: Math.min(size, section.address + section.size - address) });
  });
  // a sized function that runs over the next start is cut there, so none overlap
  return functions.map((f, i) => ({ ...f, size: Math.max(4, Math.min(f.size, (functions[i + 1]?.address ?? Infinity) - f.address)) }));
}

/** Of the functions in a list, those that start outside the program's code. */
export function startsInData(program, listed) {
  const inside = inCode(program);
  return listed.filter(({ address }) => !inside(address));
}
