// The functions in a PlayStation Portable game's program, for its code map (codemap.mjs): the program a disc or a
// download boots, read from the player's copy on their computer. Addresses are where the program runs, as a
// disassembler such as Ghidra shows them once it has placed the program, so a list from one fits.
//
// The program is an ELF file. One built to run at fixed addresses is loaded where it says. Most games' are relocatable,
// a PRX, built as if from address 0 with a list of every place that holds an address: the console puts it where it has
// room, and the tools put it where their emulator, PPSSPP, puts a game's first program, 0x08804000, and add that to
// each of those places as the emulator does. It's found in a program's own file (.elf, .prx), in a disc as
// PSP_GAME/SYSDIR/EBOOT.BIN, or BOOT.BIN beside it, and in a PBP, the file a download comes as, as its DATA.PSP.
//
// The functions are found by reading it, as every MIPS console's program is (../lib/mips-functions.mjs), with the
// Allegrex's instructions (../lib/allegrex.mjs): where it starts, what it exports, every call's target, every
// function's opening right after the end of the one before, and every word that holds the address of one.
//
// What a program asks of the console it asks of the system's modules, each function by a number (its NID): the file
// lists them, and leaves two instructions for each, which the system writes its call into as it loads the program.
// Those pairs aren't the game's code, so they're kept out of the map, and `imports` names each by where it is: that is
// how a call of the system is told from a call of the game's own.
//
// A program a publisher encrypted starts with ~PSP, not with an ELF's mark. Its plain form is the one the emulator makes
// as it loads it, which the tools can't take from it yet.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { readDiscFile } from '../lib/read-copy.mjs';
import { findMipsFunctions } from '../lib/mips-functions.mjs';
import { isInstruction as isMipsInstruction } from '../lib/mips.mjs';

/** Where the tools' emulator places a game's first program when it's relocatable. */
export const PLACED_AT = 0x08804000;
/** Whether a word is one of the Allegrex's instructions. */
export const isInstruction = word => isMipsInstruction(word, 'allegrex');

const ELF = 0x7F454C46, PRX = 0xFFA0, FIXED = 2;
const LOADED = 1, PLACES = 0x700000A0, PLACES_PACKED = 0x700000A1;
// the kinds of place a relocatable program lists: a whole address, a jump's or a call's 26 bits, and the two halves
// of an address a pair of instructions makes
const R_NONE = 0, R_16 = 1, R_32 = 2, R_26 = 4, R_HI16 = 5, R_LO16 = 6, R_GPREL16 = 7;

const READ = new Map();
// kept on this computer by the copy's SHA-1, as the PlayStation's is (../ps1/functions.mjs), so a proof's mark is read
// without the disc in a later run too: never in the repository
const KEPT = join(LOCAL, 'psp', 'programs');
const keptFile = sha1 => join(KEPT, `${sha1}.elf`);

const isElf = bytes => bytes && bytes.length >= 52 && bytes.readUInt32BE(0) === ELF;
const isEncrypted = bytes => bytes && bytes.length >= 4 && bytes.toString('latin1', 0, 4) === '~PSP';
const ENCRYPTED = 'This program is encrypted, as a publisher\'s is: the tools can\'t take its plain form from their emulator yet, so they can\'t map it. --from takes a list of its functions from a decompilation or a disassembler.';

// the program inside a PBP, the file a download comes as: its seventh part, DATA.PSP
function inPbp(bytes) {
  if (bytes.length < 40 || bytes.toString('latin1', 0, 4) !== '\0PBP') return null;
  const from = bytes.readUInt32LE(8 + 6 * 4), to = bytes.readUInt32LE(8 + 7 * 4);
  return from < to && to <= bytes.length ? bytes.subarray(from, to) : null;
}

/** The program in a player's copy, as its ELF file: a program's own file as it is, a PBP's DATA.PSP, or the one a
 *  disc boots. With `sha1`, the copy's, a disc's program is kept on this computer too, for keptProgram. */
export async function pspProgram(path, sha1 = null) {
  const extension = extname(path).toLowerCase();
  if (READ.has(path)) {
    if (sha1) keepProgram(sha1, READ.get(path));
    return READ.get(path);
  }
  let program;
  if (extension === '.elf' || extension === '.prx') program = readFileSync(path);
  else if (extension === '.pbp') {
    program = inPbp(readFileSync(path));
    if (!program) throw new Error(`${path} isn't a PBP with a program in it.`);
  } else {
    // a disc's program, or the plain copy of it some discs keep beside an encrypted one
    const boots = await readDiscFile(path, 'PSP_GAME/SYSDIR/EBOOT.BIN'), plain = isElf(boots) ? null : await readDiscFile(path, 'PSP_GAME/SYSDIR/BOOT.BIN');
    program = isElf(boots) ? boots : isElf(plain) ? plain : boots;
    if (!program) throw new Error(`The tools couldn't find the program ${path} boots: it has no PSP_GAME/SYSDIR/EBOOT.BIN.`);
  }
  if (isEncrypted(program)) throw new Error(ENCRYPTED);
  if (!isElf(program)) throw new Error('This isn\'t a program for the PlayStation Portable\'s processor: it isn\'t an ELF file.');
  READ.set(path, program);
  if (sha1) keepProgram(sha1, program);
  return program;
}

function keepProgram(sha1, program) {
  if (existsSync(keptFile(sha1)) && readFileSync(keptFile(sha1)).equals(program)) return;
  mkdirSync(KEPT, { recursive: true });
  writeFileSync(keptFile(sha1), program);
}
/** The program of the copy whose SHA-1 is `sha1` as a tool that read it kept it, or null when none has on this
 *  computer yet. */
export const keptProgram = sha1 => (existsSync(keptFile(sha1)) ? readFileSync(keptFile(sha1)) : null);
/** The program in a player's copy as pspProgram gives it, without waiting: a file's at once, and a disc's once a tool
 *  has read it in this run, or null before. */
export const readProgram = path => (['.elf', '.prx'].includes(extname(path).toLowerCase()) ? readFileSync(path) : READ.get(path) ?? null);

const PARSED = new WeakMap();

/**
 * A program as the console loads it: where it starts, `entry`; where its first byte is, `load`; its bytes from there,
 * `text`, code and values, with every address in a relocatable one put right; where its code ends, `code`; `gp`, the register it reaches its small
 * values through; `name`, the module's own; `exports`, the addresses of the functions it gives the system, such as its
 * start; and `imports`, the system's functions it calls, each { address, module, number }, `address` being where its
 * two instructions are.
 */
export function programOf(elf) {
  if (PARSED.has(elf)) return PARSED.get(elf);
  if (isEncrypted(elf)) throw new Error(ENCRYPTED);
  if (!isElf(elf) || elf.readUInt16LE(18) !== 8) throw new Error('This isn\'t a program for the PlayStation Portable\'s processor: it isn\'t an ELF file for MIPS.');
  const kind = elf.readUInt16LE(16);
  if (kind !== FIXED && kind !== PRX) throw new Error(`This ELF file isn't a program the console starts: its kind is 0x${kind.toString(16).toUpperCase()}.`);
  const headersAt = elf.readUInt32LE(28), headerSize = elf.readUInt16LE(42), headers = elf.readUInt16LE(44);
  const segments = [];
  for (let i = 0; i < headers; i++) {
    const at = headersAt + i * headerSize;
    if (at + 32 > elf.length) break;
    segments.push({ type: elf.readUInt32LE(at), offset: elf.readUInt32LE(at + 4), vaddr: elf.readUInt32LE(at + 8), paddr: elf.readUInt32LE(at + 12), filesz: elf.readUInt32LE(at + 16), memsz: elf.readUInt32LE(at + 20) });
  }
  const loaded = segments.filter(s => s.type === LOADED);
  if (!loaded.length) throw new Error('This program has nothing the console loads.');
  const base = kind === PRX ? PLACED_AT : 0;
  const start = Math.min(...loaded.map(s => s.vaddr)), end = Math.max(...loaded.map(s => s.vaddr + s.memsz));
  const load = (base + start) >>> 0, text = Buffer.alloc(end - start);
  for (const s of loaded) elf.copy(text, s.vaddr - start, s.offset, Math.min(elf.length, s.offset + s.filesz));
  // where each of the file's parts is once loaded, by its number, as the list of places names them
  const placed = segments.map(s => (base + s.vaddr) >>> 0);
  const word = address => text.readUInt32LE(address - load);
  const inside = (address, bytes = 4) => address >= load && address + bytes <= load + text.length;

  if (kind === PRX) {
    // the lists of places: in sections of their own kind when the file names its sections, or in parts of that kind
    const lists = [];
    const sectionsAt = elf.readUInt32LE(32), sectionSize = elf.readUInt16LE(46), sections = elf.readUInt16LE(48);
    for (let i = 0; i < sections && sectionsAt; i++) {
      const at = sectionsAt + i * sectionSize;
      if (at + 40 > elf.length) break;
      const type = elf.readUInt32LE(at + 4);
      if (type === PLACES) lists.push(elf.subarray(elf.readUInt32LE(at + 16), elf.readUInt32LE(at + 16) + elf.readUInt32LE(at + 20)));
    }
    if (!sections) for (const s of segments) {
      if (s.type === PLACES) lists.push(elf.subarray(s.offset, s.offset + s.filesz));
      if (s.type === PLACES_PACKED) throw new Error('This program lists the places that hold an address in the packed way the tools don\'t read yet, so they can\'t put it where it runs.');
    }
    for (const list of lists) place(list, text, load, placed);
  }

  // the module's own description: named by a section, or found from the first part's own header
  let about = null;
  const sectionsAt = elf.readUInt32LE(32), sections = elf.readUInt16LE(48), names = elf.readUInt16LE(50);
  if (sectionsAt && sections && names < sections) {
    const sectionSize = elf.readUInt16LE(46), namesAt = elf.readUInt32LE(sectionsAt + names * sectionSize + 16);
    for (let i = 0; i < sections; i++) {
      const at = sectionsAt + i * sectionSize, nameAt = namesAt + elf.readUInt32LE(at);
      const name = elf.toString('latin1', nameAt, elf.indexOf(0, nameAt));
      if (name === '.rodata.sceModuleInfo') about = (base + elf.readUInt32LE(at + 12)) >>> 0;
    }
  }
  if (about === null) about = (placed[0] + (segments[0].paddr & 0x7FFFFFFF) - segments[0].offset) >>> 0;
  const found = { entry: (base + elf.readUInt32LE(24)) >>> 0, load, text, code: load + text.length, gp: 0, name: '', exports: [], imports: [] };
  // where its code ends: after the last section the file says is code, or with no sections, before the first of what it
  // keeps for the system, its description, its lists of modules and their numbers, which come after its code
  const tables = [];
  let codeEnd = 0;
  if (sectionsAt && sections) {
    const sectionSize = elf.readUInt16LE(46);
    for (let i = 0; i < sections; i++) {
      const at = sectionsAt + i * sectionSize;
      if (at + 40 <= elf.length && elf.readUInt32LE(at + 4) === 1 && (elf.readUInt32LE(at + 8) & 4)) codeEnd = Math.max(codeEnd, (base + elf.readUInt32LE(at + 12) + elf.readUInt32LE(at + 20)) >>> 0);
    }
  }
  if (inside(about, 52)) {
    tables.push(about);
    found.name = text.toString('latin1', about - load + 4, about - load + 31).replace(/\0.*$/, '');
    found.gp = word(about + 32);
    const cstring = address => (inside(address, 1) ? text.toString('latin1', address - load, text.indexOf(0, address - load)) : '');
    // what it gives the system: each library's functions' numbers, then their addresses
    for (let at = word(about + 36), stop = word(about + 40); inside(at, 16) && at < stop;) {
      const size = text[at - load + 8] || 4, variables = text[at - load + 9], functions = text.readUInt16LE(at - load + 10), table = word(at + 12);
      for (let i = 0; i < functions && inside(table + (functions + variables + i) * 4); i++) found.exports.push(word(table + (functions + variables + i) * 4));
      tables.push(at, table);
      at += size * 4;
    }
    // what it asks of the system: each module's functions' numbers, and the two instructions left for each
    for (let at = word(about + 44), stop = word(about + 48); inside(at, 20) && at < stop;) {
      const size = text[at - load + 8] || 5, functions = text.readUInt16LE(at - load + 10), numbers = word(at + 12), calls = word(at + 16), module = cstring(word(at));
      for (let i = 0; i < functions && inside(numbers + i * 4) && inside(calls + i * 8, 8); i++) found.imports.push({ address: calls + i * 8, module, number: word(numbers + i * 4) });
      tables.push(at, numbers, word(at));
      at += size * 4;
    }
  }
  const after = tables.filter(address => inside(address, 1) && address > found.entry);
  found.code = codeEnd > load ? Math.min(codeEnd, load + text.length) : after.length ? Math.min(...after) : load + text.length;
  PARSED.set(elf, found);
  return found;
}

// puts every place of a list right, as the emulator does (PPSSPP's ElfReader::LoadRelocations): each names where it is,
// from which part's start, what kind of place it is, and which part's start the address in it counts from
function place(list, text, load, placed) {
  const count = Math.floor(list.length / 8), before = new Array(count);
  const at = i => {
    const info = list.readUInt32LE(i * 8 + 4), from = (info >>> 8) & 0xFF;
    return from < placed.length ? (list.readUInt32LE(i * 8) + placed[from]) >>> 0 : null;
  };
  const ok = (address, type) => address !== null && (!(address & 3) || type === R_32) && address >= load && address + 4 <= load + text.length;
  for (let i = 0; i < count; i++) {
    const address = at(i);
    if (ok(address, list.readUInt32LE(i * 8 + 4) & 0xF)) before[i] = text.readUInt32LE(address - load);
  }
  for (let i = 0; i < count; i++) {
    const info = list.readUInt32LE(i * 8 + 4), type = info & 0xF, counts = (info >>> 16) & 0xFF, address = at(i);
    if (!ok(address, type)) continue;
    const to = counts < placed.length ? placed[counts] : 0;
    let op = before[i];
    if (type === R_32) op = (op + to) >>> 0;
    else if (type === R_26) op = ((op & 0xFC000000) | (((op & 0x03FFFFFF) + (to >>> 2)) & 0x03FFFFFF)) >>> 0;
    else if (type === R_HI16) {
      // the upper half goes with the lower half of the next place that isn't an upper half, whose sign it makes up for
      let high = op & 0xFFFF;
      for (let t = i + 1; t < count; t++) {
        const other = list.readUInt32LE(t * 8 + 4) & 0xF;
        if (other === R_HI16) continue;
        if (other !== R_LO16 && other !== R_16) continue;
        if (before[t] === undefined) continue;
        const whole = (((op & 0xFFFF) << 16) + ((before[t] << 16) >> 16) + to) >>> 0, low = (whole << 16) >> 16;
        high = ((whole - low) >>> 16) & 0xFFFF;
        break;
      }
      op = ((op & 0xFFFF0000) | high) >>> 0;
    } else if (type === R_LO16 || type === R_16) op = ((op & 0xFFFF0000) | ((op + to) & 0xFFFF)) >>> 0;
    else if (type !== R_GPREL16 && type !== R_NONE) continue;
    text.writeUInt32LE(op, address - load);
  }
}

/** What reads a program as it's loaded: `read(address, count)`, its bytes from `address`, as many of `count` as it has
 *  there, and none outside it. */
export function programReader(elf) {
  const { load, text } = programOf(elf);
  return (address, count) => (address >= load && address < load + text.length ? text.subarray(address - load, Math.min(text.length, address - load + count)) : Buffer.alloc(0));
}

/** Whether an address is in the program as it's loaded. */
export function inCode(elf) {
  const { load, code } = programOf(elf);
  return address => address >= load && address < code;
}

/** The functions in the program, each { address, size }, in order, those in `listed` kept as they are: the game's own,
 *  without the pairs of instructions the system writes its calls into. */
export function findFunctions(elf, listed = []) {
  const program = programOf(elf);
  const calls = new Set(program.imports.map(({ address }) => address));
  const known = [...listed, ...program.exports.filter(address => !listed.some(f => f.address === address) && address >= program.load && address < program.code).map(address => ({ address, size: 0 }))];
  return findMipsFunctions({ entry: program.entry, load: program.load, text: program.text.subarray(0, program.code - program.load), processor: 'allegrex' }, known).filter(f => !calls.has(f.address) && !calls.has(f.address - 4));
}

/** Of the functions in a list, those that start outside the program. */
export function startsInData(elf, listed) {
  const inside = inCode(elf);
  return listed.filter(({ address }) => !inside(address));
}
