// The code in a PlayStation 2 game, for its code map (codemap.mjs), read from the player's copy on their computer: every
// piece of code on its disc, so code ported is measured against all of it.
//
//   - The program the disc boots, as SYSTEM.CNF names it, or a program given as an ELF file: its EE functions.
//   - Every other program for the EE on the disc, as a game loads one for a part of itself: its functions, under its name.
//   - Every module for the IOP, the second processor, as an IRX file or inside an IOPRP image, the package of modules a
//     game boots the IOP with: its functions, under the file's name and, in an image, the module's.
//   - Every program for a vector unit: the microcode the EE sends a unit through its VIF, as an MPG command and the
//     instructions after it (vu.mjs), in the boot program's sections that aren't the EE's code, as `.vutext`, and in the
//     disc's other files. Each upload is a function of its own, known by where it is: the EE's address in the boot
//     program, or the offset in its file.
//
// Addresses are where each runs, as a disassembler such as Ghidra shows them, so a list from one fits: an EE program's
// own addresses, and a module's from its start, as the IOP loads it wherever it has room. A program that kept its
// symbol table says where each function starts and how long it is, and those are taken, their addresses and sizes
// only, never their names, which are the game's own words. What's left of its code, or all of it in a program with no
// symbols, is found by reading it: where it starts, every call's target (JAL), and every function's opening (ADDIU sp,
// sp, -n) right after the end of the one before it (JR ra and the instruction after it, then any zeros). A function
// reached only through a pointer and opening another way is left in the one before it. A module's functions are
// found as a PlayStation game's are (../ps1/functions.mjs), as the IOP is the PlayStation's processor.
//
// What a game packs or compresses in its files can't be read without the game's own code, so the code map has what's
// on the disc as it is: an EE program or a module inside another file is found by its ELF header, and a vector unit's
// upload by its MPG command, when at least 8 instructions after it are all the unit's and fit its memory.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { bootFile, discFiles, readDiscFile } from '../lib/read-copy.mjs';
import { fillFunctions } from '../gba/functions.mjs';
import { findFunctionsIn as findIopFunctions } from '../ps1/functions.mjs';
import { isPair } from './vu.mjs';

const JR_RA = 0x03E00008;
const isOpening = word => (word >>> 16) === 0x27BD && (word & 0x8000) !== 0;   // ADDIU sp, sp, a negative number
const ELF = 0x7F454C46, MIPS = 8, EXECUTABLE = 2, IOP_MODULE = 0xFF80;
// a vector unit's memory in instructions, so an upload must fit it: vector unit 1's 16 KB, the larger
const VU_PAIRS = 2048;
// how many instructions an upload needs, outside the boot program's own vector unit sections, to count as code
const LEAST_IN_DATA = 8;
// how much of a file is read at once when looking for code in it
const CHUNK = 1 << 24;

/** The program in a player's copy: an ELF file as it is, or the one a disc boots. */
export async function ps2Program(path) {
  if (extname(path).toLowerCase() === '.elf') return readFileSync(path);
  const name = await bootFile(path);
  const program = name && await readDiscFile(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  return program;
}

/** An ELF file's sections: { name, type, flags, address, offset, size }. */
export function sectionsOf(program) {
  const sections = [], count = program.readUInt16LE(48), at = program.readUInt32LE(32);
  if (!at || at + count * 40 > program.length) return sections;
  const names = program.readUInt16LE(50) < count ? program.readUInt32LE(at + program.readUInt16LE(50) * 40 + 16) : 0;
  for (let i = 0; i < count; i++) {
    const o = at + i * 40, name = names ? program.toString('latin1', names + program.readUInt32LE(o), program.indexOf(0, names + program.readUInt32LE(o))) : '';
    sections.push({ name, type: program.readUInt32LE(o + 4), flags: program.readUInt32LE(o + 8), address: program.readUInt32LE(o + 12), offset: program.readUInt32LE(o + 16), size: program.readUInt32LE(o + 20) });
  }
  return sections;
}

// a section of a vector unit's code: Sony's linker puts the units' programs in .vutext, and keeps a copy of each in a
// .DVP.overlay section of its own, at the unit's own address
const isVuSection = name => name === '.vutext' || name.startsWith('.DVP.') || name.startsWith('.vu');

// the program's code as it's loaded: each stretch of it that runs, with where it runs and where it is in the file
function codeOf(program) {
  if (program.readUInt32BE(0) !== ELF) throw new Error('This isn\'t a program for the PlayStation 2\'s processor: it has no ELF header.');
  const all = sectionsOf(program);
  // a section of the program's own code, which runs from where it's loaded, and isn't a vector unit's
  let sections = all.filter(s => s.type === 1 && s.flags & 4 && s.flags & 2 && !isVuSection(s.name));
  if (!all.length) {
    // a program with no sections: its segments that run
    for (let i = 0; i < program.readUInt16LE(44); i++) {
      const o = program.readUInt32LE(28) + i * 32;
      if (program.readUInt32LE(o) === 1 && program.readUInt32LE(o + 24) & 1) sections.push({ address: program.readUInt32LE(o + 8), offset: program.readUInt32LE(o + 4), size: program.readUInt32LE(o + 16) });
    }
  }
  // a vector unit's code in a section of its own that runs where the unit is, which isn't this processor's
  sections = sections.filter(s => s.address >= 0x00080000);
  return { entry: program.readUInt32LE(24), sections };
}

/** Whether an address is in the program's code. */
export function inCode(program) {
  const { sections } = codeOf(program);
  return address => sections.some(s => address >= s.address && address < s.address + s.size);
}

// the functions the symbol table names, with their sizes
function symbols(program, inside) {
  const found = [];
  for (const table of sectionsOf(program).filter(s => s.type === 2)) {
    for (let s = table.offset; s + 16 <= table.offset + table.size && s + 16 <= program.length; s += 16) {
      const address = program.readUInt32LE(s + 4), length = program.readUInt32LE(s + 8), kind = program[s + 12] & 15;
      if (kind === 2 && length && inside(address)) found.push({ address, size: length });
    }
  }
  return found;
}

/** The functions in an EE program, each { address, size }, in order, those in `listed` kept as they are. */
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

/** A module for the IOP, an IRX file: its code, which starts at 0 wherever the IOP loads it, and where it starts. */
export function moduleCode(module) {
  if (module.readUInt32BE(0) !== ELF || module.readUInt16LE(16) !== IOP_MODULE) throw new Error('This isn\'t a module for the PlayStation 2\'s IOP: it has no IRX header.');
  const sections = sectionsOf(module), text = sections.find(s => s.name === '.text') ?? sections.find(s => s.type === 1 && s.flags & 4);
  if (!text) return { entry: 0, load: 0, text: Buffer.alloc(0), symbols: [] };
  const code = module.subarray(text.offset, text.offset + text.size);
  const inside = address => address >= text.address && address < text.address + text.size;
  return { entry: module.readUInt32LE(24), load: text.address, text: code, symbols: symbols(module, inside) };
}

/** The functions in a module for the IOP, each { address, size }, those in `listed` kept as they are. */
export function findModuleFunctions(module, listed = []) {
  const code = moduleCode(module);
  const known = new Map([...code.symbols, ...listed].map(f => [f.address, f]));
  return findIopFunctions(code, [...known.values()]);
}

/**
 * The uploads of vector unit programs in `bytes`: each MPG command of a VIF whose instructions, the `size` bytes after
 * it, are all the unit's and fit its memory, as { at, size, vuAddress }: where its first instruction is in `bytes`, and
 * where the unit keeps it, in bytes. `least` is how many instructions one needs to count.
 */
export function findVuUploads(bytes, { least = 1 } = {}) {
  const found = [];
  // the instructions start on an 8-byte boundary, with the command in the 4 bytes before them
  for (let at = 8; at + 8 <= bytes.length; at += 8) {
    // the command's last byte, with the interrupt bit or without, its count of instructions and their address
    if ((bytes[at - 1] & 0x7F) !== 0x4A) continue;
    const count = bytes[at - 2] || 256, address = bytes.readUInt16LE(at - 4);
    if (count < least || address + count > VU_PAIRS || at + count * 8 > bytes.length) continue;
    let all = true;
    for (let i = 0; i < count && all; i++) all = isPair(bytes.readUInt32LE(at + i * 8), bytes.readUInt32LE(at + i * 8 + 4));
    if (!all) continue;
    found.push({ at, size: count * 8, vuAddress: address * 8 });
    at += count * 8 - 8;
  }
  return found;
}

// what an ELF header of the PlayStation 2's starts these bytes with: 'ee' for an EE program, 'iop' for an IOP module,
// or null
function headerKind(bytes) {
  if (bytes.length < 52 || bytes.readUInt32BE(0) !== ELF || bytes[4] !== 1 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== MIPS) return null;
  const type = bytes.readUInt16LE(16);
  return type === EXECUTABLE ? 'ee' : type === IOP_MODULE ? 'iop' : null;
}

// how far into a program its header says its tables go
const tablesEnd = bytes => Math.max(52, bytes.readUInt32LE(32) + bytes.readUInt16LE(48) * 40, bytes.readUInt32LE(28) + bytes.readUInt16LE(44) * 32);

// the same, for a whole program, whose tables are all inside it
const programAt = bytes => (headerKind(bytes) && tablesEnd(bytes) <= bytes.length ? headerKind(bytes) : null);

// a program inside a file of the disc, from `at`: its bytes, as far as its sections and segments go, or null
async function programIn(disc, name, at, size) {
  const head = await disc.read(name, at, 52);
  if (!headerKind(head) || at + tablesEnd(head) > size) return null;
  const tables = await disc.read(name, at, tablesEnd(head));
  const length = programSize(tables);
  if (at + length > size || length > 64 << 20) return null;
  const bytes = await disc.read(name, at, length);
  return programAt(bytes) ? bytes : null;
}

// the modules in an IOPRP image: a ROMDIR, a list of 16 bytes for each file, its name, its extra information's size
// and its own, the files one after the other, each from a 16-byte boundary
function imageModules(image) {
  const at = image.indexOf('ROMDIR'), modules = [];
  if (at < 16 || image.toString('latin1', at - 16, at - 11) !== 'RESET') return modules;
  let offset = 0;
  for (let entry = at - 16; entry + 16 <= image.length && image[entry]; entry += 16) {
    const name = image.toString('latin1', entry, entry + 10).replace(/\0.*$/, ''), size = image.readUInt32LE(entry + 12);
    if (offset + size > image.length) break;
    if (programAt(image.subarray(offset, offset + size)) === 'iop') modules.push({ name, bytes: image.subarray(offset, offset + size) });
    offset += (size + 15) & ~15;
  }
  return modules;
}

/**
 * The code on a player's copy: { boot, bootName, programs: [{ path, kind, bytes }], uploads: [{ path, at, size,
 * vuAddress }] }. `boot` is the program the disc boots, `programs` every other EE program and IOP module, `kind` 'ee' or
 * 'iop', with a module inside an image or a program inside another file named after the file, as `IOPRP254.IMG:CDVDMAN`
 * or `DATA/GAME.ARC:0x1000`, and `uploads` every vector unit program outside the boot program's own vector unit
 * sections, `path` its file, or null for the boot program, and `at` where its first instruction is there: an EE
 * address in the boot program, or an offset in a file. Given an ELF file, it's the boot program alone.
 */
export async function ps2Disc(path, { progress = () => {} } = {}) {
  const boot = await ps2Program(path);
  const bootName = extname(path).toLowerCase() === '.elf' ? basename(path) : await bootFile(path);
  const code = { boot, bootName, programs: [], uploads: [] };
  // the boot program's own uploads, in every section that isn't the EE's code, at their EE addresses
  const eeCode = codeOf(boot).sections;
  for (const s of sectionsOf(boot).filter(s => s.type === 1 && s.flags & 2 && s.address && !eeCode.includes(s))) {
    const least = isVuSection(s.name) ? 1 : LEAST_IN_DATA;
    for (const u of findVuUploads(boot.subarray(s.offset, s.offset + s.size), { least })) code.uploads.push({ path: null, ...u, at: s.address + u.at });
  }
  if (extname(path).toLowerCase() === '.elf') return code;
  const disc = await discFiles(path);
  if (!disc) return code;
  try {
    const total = disc.files.reduce((sum, f) => sum + f.size, 0);
    let done = 0;
    for (const file of disc.files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (file.name === bootName || file.name === 'SYSTEM.CNF') { done += file.size; continue; }
      const kind = headerKind(await disc.read(file.name, 0, 52));
      const whole = kind && file.size <= 64 << 20 ? await disc.read(file.name) : null;
      if (whole && programAt(whole)) {
        code.programs.push({ path: file.name, kind, bytes: whole });
        done += file.size;
        continue;
      }
      // any other file a chunk at a time, overlapping by an upload's length, for programs, modules and uploads in it
      for (let at = 0; at < file.size; at += CHUNK) {
        const bytes = await disc.read(file.name, at, CHUNK + 256 * 8 + 8);
        const image = at === 0 ? imageModules(bytes.subarray(0, Math.min(bytes.length, file.size))) : [];
        for (const m of image) code.programs.push({ path: `${file.name}:${m.name}`, kind: 'iop', bytes: Buffer.from(m.bytes) });
        if (!image.length) {
          for (let o = 0; o + 52 <= Math.min(bytes.length, CHUNK); o += 4) {
            if (bytes.readUInt32BE(o) !== ELF || !headerKind(bytes.subarray(o, o + 52))) continue;
            const inner = await programIn(disc, file.name, at + o, file.size);
            if (inner) code.programs.push({ path: `${file.name}:0x${(at + o).toString(16).toUpperCase()}`, kind: headerKind(inner), bytes: inner });
          }
        }
        for (const u of findVuUploads(bytes, { least: LEAST_IN_DATA })) if (u.at - 4 < CHUNK) code.uploads.push({ path: file.name, ...u, at: at + u.at });
        done += Math.min(CHUNK, file.size - at);
        progress(done, total);
      }
    }
  } finally {
    await disc.close();
  }
  return code;
}

// how many bytes of a file starting with a program are that program: to the end of its last section or segment
function programSize(bytes) {
  let end = 52;
  for (const s of sectionsOf(bytes)) if (s.type !== 8) end = Math.max(end, s.offset + s.size);
  const at = bytes.readUInt32LE(28);
  for (let i = 0; i < bytes.readUInt16LE(44) && at + i * 32 + 32 <= bytes.length; i++) end = Math.max(end, bytes.readUInt32LE(at + i * 32 + 4) + bytes.readUInt32LE(at + i * 32 + 16));
  end = Math.max(end, bytes.readUInt32LE(32) + bytes.readUInt16LE(48) * 40);
  return Math.min(end, bytes.length);
}

// where a function is: the boot program's EE code, its vector unit code, or another program's
const placeOf = f => `${f.program ?? ''}${f.vu ? '~vu' : ''}`;

/**
 * Every function on a disc read by ps2Disc, each { address, size, program, vu }: `program` the path of the program or
 * file it's in when it isn't the boot program, and `vu` for a vector unit's upload. Those in `listed`, a code map's,
 * are kept as they are, with their names, and what's found is added around them, each program on its own.
 */
export function discFunctions(code, listed = []) {
  const byPlace = new Map();
  for (const f of listed) {
    if (!byPlace.has(placeOf(f))) byPlace.set(placeOf(f), []);
    byPlace.get(placeOf(f)).push(f);
  }
  const listedAt = place => byPlace.get(place) ?? [];
  const tag = (functions, program, vu) => functions.map(f => ({ ...f, ...(program ? { program } : {}), ...(vu ? { vu: true } : {}) }));
  const plain = list => list.map(({ program, vu, ...f }) => f);
  const all = [...fillFunctions(plain(listedAt('')), findFunctions(code.boot, plain(listedAt(''))))];
  const uploadsIn = path => code.uploads.filter(u => u.path === path).map(u => ({ address: u.at, size: u.size }));
  all.push(...tag(fillFunctions(plain(listedAt('~vu')), uploadsIn(null)), null, true));
  for (const program of [...code.programs].sort((a, b) => a.path.localeCompare(b.path))) {
    const known = plain(listedAt(program.path));
    const found = program.kind === 'ee' ? findFunctions(program.bytes, known) : findModuleFunctions(program.bytes, known);
    all.push(...tag(fillFunctions(known, found), program.path, false));
  }
  for (const path of [...new Set(code.uploads.map(u => u.path).filter(Boolean))].sort()) {
    all.push(...tag(fillFunctions(plain(listedAt(`${path}~vu`)), uploadsIn(path)), path, true));
  }
  return all;
}

/**
 * The bytes of one program or file of a player's copy, by the name the code map gives it: the program the disc boots
 * when `program` is null, a file, a module inside an image, as `IOPRP254.IMG:CDVDMAN`, or a program inside a file, as
 * `DATA/GAME.ARC:0x1000`. Null when the copy has none of that name.
 */
export async function programOf(path, program) {
  if (!program) return ps2Program(path);
  if (extname(path).toLowerCase() === '.elf') return null;
  const disc = await discFiles(path);
  if (!disc) return null;
  try {
    const [name, inside] = program.split(/:(?=[^:]+$)/);
    const file = disc.files.find(f => f.name === name);
    if (!file) return null;
    if (!inside) return await disc.read(name);
    if (/^0x[0-9a-f]+$/i.test(inside)) return await programIn(disc, name, Number(inside), file.size);
    return imageModules(await disc.read(name)).find(m => m.name === inside)?.bytes ?? null;
  } finally {
    await disc.close();
  }
}

/** The section of a program an EE address is in, as { address, offset, size }, or null when no section has it. */
export function sectionOf(program, address) {
  return sectionsOf(program).find(s => s.type === 1 && s.flags & 2 && address >= s.address && address < s.address + s.size) ?? null;
}
