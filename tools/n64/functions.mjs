// The functions in a Nintendo 64 game's code, for its code map (../codemap.mjs): the code its cartridge starts, read
// from the player's copy on their computer, in any of the three byte orders copies come in. Addresses are where the
// code runs, as a disassembler such as Ghidra shows them, so a list from one fits.
//
// The console starts a cartridge with the boot code in its first 4 KB, which copies the megabyte after it into the
// console's memory and jumps there. Where it puts it is the address the cartridge's header names, but for two kinds of
// cartridge whose boot code puts it 1 MB or 2 MB lower. So the tools take, of those three, the one where most of the
// code's calls land on a function's opening, as a call names its target's address: with the code at the wrong place,
// nearly none do. Where it's right, a third or more of the calls that stay inside the code land on one, or a fifth in a
// game whose first code is a small program that unpacks the rest; where fewer than a tenth do at all three, as a few
// cartridges' own boot code puts their code somewhere else again, the tools say they can't tell where it runs rather
// than map it in the wrong place. Then the functions are found by reading it, as every MIPS console's program is
// (../lib/mips-functions.mjs), with the VR4300's instructions (../lib/mips.mjs): its start, every call's target
// anywhere in it, as #1451's trial found that the start jumps on through a register, every opening right after a
// return, and every word that holds the address of one. Code the game copies from the rest of the cartridge as it runs,
// some of it packed, isn't in that megabyte, and isn't mapped yet.

import { readFileSync } from 'node:fs';
import { callsThatLand, findMipsFunctions } from '../lib/mips-functions.mjs';
import { isInstruction as isMipsInstruction } from '../lib/mips.mjs';

/** Where the code the boot code copies starts in the cartridge, and how much of it it copies. */
export const CODE_AT = 0x1000, CODE_BYTES = 0x100000;

/** Whether a word is one of the VR4300's instructions. */
export const isInstruction = word => isMipsInstruction(word, 'vr4300');

/** A cartridge's bytes in the console's own order, its highest byte first, from a copy in any of the three orders they
 *  come in: as the console reads it (.z64), each word turned round (.n64), or each halfword (.v64). */
export function inConsoleOrder(bytes) {
  const copy = Buffer.from(bytes);
  if (copy.length < 0x40) throw new Error('This isn\'t a Nintendo 64 cartridge: it\'s smaller than its header.');
  const magic = copy.readUInt32BE(0);
  if (magic === 0x80371240) return copy;
  if (magic === 0x40123780) {
    for (let i = 0; i + 4 <= copy.length; i += 4) copy.writeUInt32BE(copy.readUInt32LE(i), i);
    return copy;
  }
  if (magic === 0x37804012) {
    for (let i = 0; i + 2 <= copy.length; i += 2) copy.writeUInt16BE(copy.readUInt16LE(i), i);
    return copy;
  }
  throw new Error('This isn\'t a Nintendo 64 cartridge: its first word is none of the three a cartridge starts with.');
}

/** The cartridge in a player's copy, in the console's byte order. */
export const n64Cartridge = path => inConsoleOrder(readFileSync(path));

/** The code the cartridge starts: where it runs, `load`, which is where it starts, `entry`, and its bytes, `text`,
 *  with the address the header names, `named`. */
export function programOf(cartridge) {
  const named = cartridge.readUInt32BE(8);
  const text = cartridge.subarray(CODE_AT, CODE_AT + CODE_BYTES);
  if (!text.length) throw new Error('This cartridge has no code after its boot code.');
  // where the code lands in the console's memory, seen at 0x80000000, of the three the boot code can put it at
  const places = [named, named - 0x100000, named - 0x200000].filter(at => at >= 0x80000000 && at + text.length <= 0x80800000);
  if (!places.length) throw new Error(`This cartridge's header says its code runs at 0x${named.toString(16).toUpperCase()}, outside the console's memory.`);
  const calls = places.map(load => callsThatLand({ load, text, processor: 'vr4300', bigEndian: true }));
  const best = calls.reduce((most, found, i) => (found.landed > calls[most].landed ? i : most), 0);
  const { landed, inside } = calls[best];
  if (inside && landed < inside / 10) {
    throw new Error(`The tools can't tell where this cartridge's code runs: at none of the three places its boot code can put it, 0x${places.map(at => at.toString(16).toUpperCase()).join(', 0x')}, do a tenth of its calls land on a function's opening (${landed} of ${inside} at best). --from takes a list of its functions from a decompilation or a disassembler.`);
  }
  const load = places[best];
  return { entry: load, load, text, named };
}

/** Whether an address is in the code the cartridge starts, as it runs. */
export function inCode(cartridge) {
  const { load, text } = programOf(cartridge);
  return address => address >= load && address < load + text.length;
}

/** The functions in the code the cartridge starts, each { address, size }, in order, those in `listed` kept as they are. */
export function findFunctions(cartridge, listed = []) {
  return findMipsFunctions({ ...programOf(cartridge), processor: 'vr4300', bigEndian: true }, listed);
}

/** Of the functions in a list, those that start outside the code the cartridge starts. */
export function startsInData(cartridge, listed) {
  const inside = inCode(cartridge);
  return listed.filter(({ address }) => !inside(address));
}
