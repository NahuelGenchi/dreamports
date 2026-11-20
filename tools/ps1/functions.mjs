// The functions in a PlayStation game's program, for its code map (codemap.mjs): the program its disc boots, as
// SYSTEM.CNF names it, or a program given as a PS-X EXE, read from the player's copy on their computer. Addresses are
// where the program runs, from where its header says it's loaded, as a disassembler such as Ghidra shows them, so a
// list from one fits.
//
// A PS-X EXE keeps its code and its values together, with nothing to say which is which, so the functions are found by
// reading it, as every MIPS console's program is (../lib/mips-functions.mjs): where it starts, every call's target,
// every function's opening right after the end of the one before, and every word that holds the address of one. Code a
// game loads from its disc as it runs isn't in the program, and isn't mapped.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { readDiscFile } from '../lib/read-copy.mjs';
import { findMipsFunctions } from '../lib/mips-functions.mjs';
import { isInstruction } from './mips.mjs';

export { isInstruction };

const HEADER = 0x800;

/** The program in a player's copy: a PS-X EXE as it is, or the one a disc boots, which is PSX.EXE when its SYSTEM.CNF
 *  names none. */
export async function ps1Program(path) {
  if (extname(path).toLowerCase() === '.exe') return readFileSync(path);
  const boot = (await readDiscFile(path, 'SYSTEM.CNF'))?.toString('latin1');
  const name = boot === undefined ? 'PSX.EXE' : /^\s*BOOT\s*=\s*[^\\:]*:\\?([^;\s]+)/im.exec(boot)?.[1] ?? null;
  const program = name && await readDiscFile(path, name);
  if (!program) throw new Error(`The tools couldn't find the program ${path} boots: its SYSTEM.CNF names ${name ?? 'none'}.`);
  return program;
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
