// The functions in a PlayStation game's program, for its code map (codemap.mjs): the program its disc boots, as
// SYSTEM.CNF names it, or a program given as a PS-X EXE, read from the player's copy on their computer. Addresses are
// where the program runs, from where its header says it's loaded, as a disassembler such as Ghidra shows them, so a
// list from one fits.
//
// A PS-X EXE keeps its code and its values together, with nothing to say which is which, so the functions are found by
// reading it, as every MIPS console's program is (../lib/mips-functions.mjs): where it starts, every call's target,
// every function's opening right after the end of the one before, and every word that holds the address of one. Code a
// game loads from its disc as it runs isn't in the program, and isn't mapped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { readDiscFile } from '../lib/read-copy.mjs';
import { findMipsFunctions } from '../lib/mips-functions.mjs';
import { isInstruction } from './mips.mjs';

export { isInstruction };

const HEADER = 0x800;

// each disc's program, once a tool has read it in this run, by the copy's path: a disc is read a few sectors at a time,
// and a tool that reads the original's bytes as it goes, as a proof's mark does (../lib/proofs.mjs), can't wait for it
const READ = new Map();
// and kept on this computer by the copy's SHA-1, as the PlayStation 2's is (../ps2/original-program.mjs), so a proof's
// mark is read without the disc in a later run too, as `proofs --check` reads one for every function: never in the
// repository
const KEPT = join(LOCAL, 'ps1', 'programs');
const keptFile = sha1 => join(KEPT, `${sha1}.exe`);

/** The program in a player's copy: a PS-X EXE as it is, or the one a disc boots, which is PSX.EXE when its SYSTEM.CNF
 *  names none. With `sha1`, the copy's, a disc's program is kept on this computer too, for keptProgram. */
export async function ps1Program(path, sha1 = null) {
  if (extname(path).toLowerCase() === '.exe') return readFileSync(path);
  if (READ.has(path)) {
    if (sha1) keepProgram(sha1, READ.get(path));
    return READ.get(path);
  }
  const boot = (await readDiscFile(path, 'SYSTEM.CNF'))?.toString('latin1');
  const name = boot === undefined ? 'PSX.EXE' : /^\s*BOOT\s*=\s*[^\\:]*:\\?([^;\s]+)/im.exec(boot)?.[1] ?? null;
  const program = name && await readDiscFile(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  READ.set(path, program);
  if (sha1) keepProgram(sha1, program);
  return program;
}

// keeps the program of the copy whose SHA-1 is `sha1`, unless it's kept already
function keepProgram(sha1, program) {
  if (existsSync(keptFile(sha1)) && readFileSync(keptFile(sha1)).equals(program)) return;
  mkdirSync(KEPT, { recursive: true });
  writeFileSync(keptFile(sha1), program);
}

/** The program of the copy whose SHA-1 is `sha1` as a tool that read it off the disc kept it, or null when none has on
 *  this computer yet. */
export const keptProgram = sha1 => (existsSync(keptFile(sha1)) ? readFileSync(keptFile(sha1)) : null);

/** The program in a player's copy as ps1Program gives it, without waiting: a PS-X EXE's at once, and a disc's once a
 *  tool has read it in this run, or null before. */
export const readProgram = path => (extname(path).toLowerCase() === '.exe' ? readFileSync(path) : READ.get(path) ?? null);

/** What reads a PS-X EXE as it's loaded: `read(address, count)`, its bytes from `address`, as many of `count` as the
 *  file has there, and none outside it. */
export function exeReader(program) {
  const { load, text } = exeOf(program);
  return (address, count) => (address >= load && address < load + text.length ? text.subarray(address - load, Math.min(text.length, address - load + count)) : Buffer.alloc(0));
}

/** A PS-X EXE's parts: where it starts, where its code and values are loaded, and those bytes. */
export function exeOf(program) {
  if (program.length < HEADER || program.toString('latin1', 0, 8) !== 'PS-X EXE') throw new Error('This isn\'t a program for the PlayStation\'s processor: it has no PS-X EXE header.');
  const load = program.readUInt32LE(0x18), size = Math.min(program.readUInt32LE(0x1C), program.length - HEADER);
  return { entry: program.readUInt32LE(0x10), gp: program.readUInt32LE(0x14), load, text: program.subarray(HEADER, HEADER + size) };
}

/** Whether an address is in the program as it's loaded. */
export function inCode(program) {
  const { load, text } = exeOf(program);
  return address => address >= load && address < load + text.length;
}

/** The functions in the program, each { address, size }, in order, those in `listed` kept as they are. */
export function findFunctions(program, listed = []) {
  return findFunctionsIn(exeOf(program), listed);
}

/** The functions in `text`, code for the PlayStation's processor loaded at `load` that starts at `entry`, as
 *  findFunctions finds them in a PS-X EXE: for any such code, as a PlayStation 2 game's modules for its second
 *  processor are (../ps2/functions.mjs). */
export function findFunctionsIn({ entry, load, text }, listed = []) {
  return findMipsFunctions({ entry, load, text, processor: 'r3000a' }, listed);
}

/** Of the functions in a list, those that start outside the program's code. */
export function startsInData(program, listed) {
  const inside = inCode(program);
  return listed.filter(({ address }) => !inside(address));
}
