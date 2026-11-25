// What of the original's code has been played next to a Dreamport, for gameplay proven
// (docs/STANDARD.md#how-progress-is-measured): every instruction of the code map's functions counts once it has run
// in a frame that matched, and every conditional branch twice, once for each of its two ways, taken and not. The
// program that plays the original says what ran and in which frames (gba/original.c, DP_PLAYED); prove keeps, for each
// recording, what ran in its matching frames, in games/<version>/proof/played.json:
//
// {
//   "original": the copy's SHA-1,
//   "percent", "units": { "total", "played" }: gameplay proven, and what it's made of,
//   "code": which places in the code map's functions hold an instruction, and which of those a conditional branch,
//   "recordings": { name: what ran in the recording's matching frames },
//   "content": { name: the cartridge's data used in the recording's matching frames }
// }
//
// The cartridge's data counts the same way: in cells of 32 bytes, each once the game has used something of it in a
// frame that matched (DP_CONTENT: read it and done anything with it but copy it into the work RAM, where it's followed).
// The cells that count are those with a byte outside every function of the code map, but those whose 32 bytes are
// all the same, which hold nothing.
//
// "code" and each recording's are sets of numbers, deflated and written in base64. A place is two bytes of a function,
// numbered through the code map's functions in order, and takes three numbers: in a recording's, that it ran, that its
// branch was taken, and that it wasn't; in "code", that it's an instruction, and that it's a conditional branch. They say
// where the original's instructions are and nothing of what they are, as the code map does.
//
// On the NES a place is one byte, as its instructions are one to three bytes long, and an address is where the
// instruction is in the cartridge's program, as in its code map (libretro/ran.h, nes/functions.mjs). Where its
// instructions are comes from the function finder, which knows the tables its code jumps with from its code. Its
// data isn't followed yet, so an NES game's file has no "cells" and no "content", and its gameplay proven stays its
// parts' share: prove keeps this file's total out of its progress.json until the data is followed (prove.mjs).
//
// On the PlayStation 2 a place is four bytes, an instruction of the EE or the IOP, or half a pair of a vector unit's.
// Play! says what ran a block at a time (libretro/ran-ps2.h), each record with its processor in the second byte of its
// third word, and the code map lists every piece of code on the disc (ps2/functions.mjs): the program it boots, its
// other EE programs, its modules for the IOP and its vector unit programs. An instruction of the EE counts for the
// function of whichever program holds, at its address, the word that ran, the program the disc boots first, so code
// loaded over other code at the same address counts as itself. A vector unit's pair counts for the program whose
// upload puts it at that place in the unit's memory, as the MPG command before it says, and holds that word. A module of
// the IOP's is loaded wherever the IOP has room, and the emulator says where it put each, and which, as it loads it: an
// instruction of the IOP counts for the function of the module loaded there at that moment, whatever its word, as the
// loader changes the words that hold an address. Its content is the disc: a cell is a sector, 2048 bytes of the disc's data, counted once the game has read
// it in a frame that matched, and a game's unreachable.json names sectors, not addresses, under "content".

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { proofFolder, sharedProofFolder } from './paths.mjs';
import { looksLikeArm } from '../gba/functions.mjs';
import { INSTRUCTIONS } from '../nes/6502.mjs';
import { findFunctions as findNesFunctions, nesProgram } from '../nes/functions.mjs';
import { findFunctions as findGbFunctions } from '../gbc/functions.mjs';
import { decode as decodeSm83 } from '../gbc/sm83.mjs';
import { instructionsIn as snesInstructionsIn } from '../snes/functions.mjs';
import { SECTOR, loadedCopy, mipsInstructionsOf, vuInstructionsOf } from '../ps2/ledger.mjs';
import { playedPercent } from '../../src/lib/entries.mjs';

export const RAN = 0, TAKEN = 1, NOT_TAKEN = 2;
/** How many bytes of the cartridge a cell of its data is (gba/original.c). */
export const CELL = 32;
const INSTRUCTION = 0, BRANCH = 1;
const CARTRIDGE = 0x08000000;

const has = (set, n) => (set[n >> 3] >> (n & 7) & 1) === 1;
const put = (set, n) => { set[n >> 3] |= 1 << (n & 7); };
const pack = set => deflateRawSync(set, { level: 9 }).toString('base64');
const unpack = (text, bytes) => {
  const set = new Uint8Array(bytes);
  if (text) set.set(inflateRawSync(Buffer.from(text, 'base64')).subarray(0, bytes));
  return set;
};

// a code map knows its console (lib/proof-files.mjs), and one made by hand, with none, is a Game Boy Advance's
const isNes = codeMap => codeMap.console === 'nes';
const isSnes = codeMap => codeMap.console === 'snes';
const isPs2 = codeMap => codeMap.console === 'ps2';
const isGb = codeMap => codeMap.console === 'gb' || codeMap.console === 'gbc';
// a console whose places are bytes of its cartridge's program, where a code map's address is: the NES, the Super
// Nintendo, the Game Boy and the Game Boy Color
const byBytes = codeMap => isNes(codeMap) || isSnes(codeMap) || isGb(codeMap);

/** Whether the tools follow the cartridge's data on a code map's console, for the content's share of gameplay proven. */
export const followsContent = codeMap => !byBytes(codeMap);

// the cells of the cartridge's or disc's data, and those that hold anything: { count, holds }
function cellsHeld(codeMap, cartridge) {
  if (isPs2(codeMap)) {
    const disc = cartridge.disc ? loadedCopy(cartridge.disc).cells : null;
    return disc ? { count: disc.sectors, holds: disc.holds } : { count: 0, holds: new Uint8Array(0) };
  }
  const rom = cartridge(CARTRIDGE, 0x02000000);
  return { count: Math.ceil(rom.length / CELL), holds: contentCells(codeMap, rom) };
}

/** How many cells of data a code map's cartridge has, or none on a console whose data isn't followed. On the
 *  PlayStation 2, how many sectors its disc has, or none for a copy that's a program alone. */
export const cellsOf = (codeMap, cartridge) => (!followsContent(codeMap) ? 0 : isPs2(codeMap) ? cellsHeld(codeMap, cartridge).count : Math.ceil(cartridge(CARTRIDGE, 0x02000000).length / CELL));

/** Where a cell is, as a game's unreachable.json names it: a cartridge's address, or on the PlayStation 2 the sector. */
export const cellAddress = (codeMap, cell) => (isPs2(codeMap) ? cell : CARTRIDGE + cell * CELL);

/** Where each of the code map's functions has its places: { first, places, bytes, unit }, `first[i]` the place of
 *  function i's first two bytes, `bytes` how long a set of all of them is, and `unit` how many bytes a place is: two,
 *  or one on the NES, the Super Nintendo and the Game Boy. */
export function layoutOf(codeMap) {
  const unit = byBytes(codeMap) ? 1 : isPs2(codeMap) ? 4 : 2;
  const first = new Uint32Array(codeMap.functions.length + 1);
  codeMap.functions.forEach((f, i) => { first[i + 1] = first[i] + Math.ceil(f.size / unit); });
  const places = first[codeMap.functions.length];
  return { first, places, bytes: Math.ceil(places * 3 / 8), unit };
}

// Thumb instructions the console's processor doesn't have, a return, and a write to pc: where a function's code ends
const invalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800 || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200
  || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800 || (op & 0xFE00) === 0xBE00;
const leaves = op => (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700 || (op & 0xFF87) === 0x4687 || (op & 0xFF87) === 0x4487;

/**
 * The instructions of a function, from its bytes: follows its code from its start and from every place of it known to
 * have run (`seeds`, offsets), through each branch's two ways, to where it returns or leaves, and gives the offsets
 * that hold an instruction and, of those, the conditional branches: { instructions, branches }. A switch's cases are
 * found only from where they ran, as its table isn't read. `never` maps a branch's offset to the way it can't go, TAKEN
 * or NOT_TAKEN, as a game's unreachable.json says, and that way isn't followed (#1536). With `longJumps`, a BL to
 * the function's own code past its start is a long jump, as agbcc writes a branch too far for B, with no code after it
 * (#1567). `arm` says whether the code is ARM or Thumb, for code whose bytes alone don't say: without it, ARM is code
 * of 16 bytes or more whose first words look like it.
 */
export function instructionsOf(bytes, seeds = [], never = new Map(), { longJumps = false, arm: isArm = null } = {}) {
  const size = bytes.length, u16 = at => bytes[at] | bytes[at + 1] << 8, u32 = at => (u16(at) | u16(at + 2) << 16) >>> 0;
  const arm = isArm ?? (size >= 16 && size % 4 === 0 && looksLikeArm([0, 4, 8, 12].map(u32)));
  const instructions = new Set(), branches = new Set(), work = [0, ...seeds];
  while (work.length) {
    let pc = work.pop();
    while (pc >= 0 && pc + (arm ? 4 : 2) <= size && !instructions.has(pc)) {
      if (arm) {
        const op = u32(pc), always = op >>> 28 === 0xE;
        instructions.add(pc);
        if ((op & 0x0E000000) === 0x0A000000) {
          const target = pc + 8 + ((op & 0xFFFFFF) << 8 >> 6);
          if (op >>> 28 < 0xE) {
            branches.add(pc);
            if (never.get(pc) !== TAKEN) work.push(target);
            if (never.get(pc) === NOT_TAKEN) break;
          } else if (!(op & 0x01000000)) {
            pc = target;
            continue;
          }
        } else if (always && ((op & 0x0FFFFFF0) === 0x012FFF10 || (op & 0x0E108000) === 0x08108000 || (op & 0x0C10F000) === 0x0410F000
          || ((op & 0x0C00F000) === 0x0000F000 && (op & 0x01900000) !== 0x01000000))) break;
        pc += 4;
        continue;
      }
      const op = u16(pc);
      if ((op & 0xF800) === 0xF000 && pc + 4 <= size && (u16(pc + 2) & 0xF800) === 0xF800) {
        // BL, in two halves, each a step of the processor's
        instructions.add(pc).add(pc + 2);
        const target = pc + 4 + ((op & 0x7FF) << 21 >> 9 | (u16(pc + 2) & 0x7FF) << 1);
        // but a BL to a `bx` through another register than lr is a call through it, as m4a's call_r3, which the
        // function it goes to comes back from to after the BL (#1708)
        const through = longJumps && target > 0 && target + 2 <= size && (u16(target) & 0xFF87) === 0x4700 && (u16(target) >> 3 & 15) !== 14;
        if (through) work.push(target);
        pc = longJumps && !through && target > 0 && target < size ? target : pc + 4;
        continue;
      }
      if (invalid(op) || (op & 0xF800) === 0xF800) break;
      instructions.add(pc);
      if ((op & 0xF000) === 0xD000 && (op >> 8 & 0xF) < 0xE) {
        branches.add(pc);
        if (never.get(pc) !== TAKEN) work.push(pc + 4 + ((op & 0xFF) << 24 >> 23));
        if (never.get(pc) === NOT_TAKEN) break;
      } else if ((op & 0xF800) === 0xE000) {
        pc = pc + 4 + ((op & 0x7FF) << 21 >> 20);
        continue;
      } else if (leaves(op)) break;
      pc += 2;
    }
  }
  return { instructions, branches };
}

/** How the function check's programs say an instruction went on (gba/call.c, nes/twin/check.h): somewhere else, as a
 *  branch taken does, or to the instruction after it. */
export const WENT_ELSEWHERE = 2, WENT_ON = 4;

/**
 * What a function's calls left out of it, for the function check: `found` is its { instructions, branches }, as
 * instructionsOf gives them, `address` where it starts, `ran` a Map of each address of it that ran to the ways it
 * went on, and `ruledOut` the branch ways the game's unreachable.json says can't happen. Answers { total, left }:
 * how many instructions and branch ways it has, and each that no call took, as [address, 'never ran',
 * 'never taken' or 'always taken'].
 */
export function waysLeft(found, address, ran, ruledOut = new Map()) {
  const left = [];
  for (const offset of [...found.instructions].sort((a, b) => a - b)) {
    const where = address + offset, ways = ran.get(where) ?? 0;
    if (!ways) left.push([where, 'never ran']);
    else if (found.branches.has(offset)) {
      if (!(ways & WENT_ELSEWHERE) && ruledOut.get(where) !== TAKEN) left.push([where, 'never taken']);
      if (!(ways & WENT_ON) && ruledOut.get(where) !== NOT_TAKEN) left.push([where, 'always taken']);
    }
  }
  return { total: found.instructions.size + found.branches.size * 2, left };
}

/**
 * Where an NES game's instructions are, for its code map: `of(f)` gives { instructions, branches } as instructionsOf
 * does, the offsets in the function `f` that hold an instruction and, of those, the conditional branches. It's what
 * the function finder walked from every function of the map, through the tables the code jumps with, so the
 * addresses of a table and the list after a call aren't taken for code. `copy` is the whole copy.
 */
export function nesInstructionsOf(codeMap, copy) {
  const walked = new Map(), { prg } = nesProgram(copy);
  findNesFunctions(copy, codeMap.functions.map(({ address, size }) => ({ address, size })), new Set(), { walked });
  const at = [...walked.keys()].sort((a, b) => a - b);
  return f => {
    const instructions = new Set(), branches = new Set();
    let low = 0, high = at.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (at[middle] < f.address) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < at.length && at[i] < f.address + f.size; i++) {
      instructions.add(at[i] - f.address);
      if (INSTRUCTIONS[prg[at[i]]].mode === 'rel') branches.add(at[i] - f.address);
    }
    return { instructions, branches };
  };
}

/**
 * The same for a Game Boy or Game Boy Color game: what its function finder walked, with each jump, call and return
 * that has a condition as a branch, which goes one way or the other. `copy` is the whole copy, which is its program.
 */
export function gbInstructionsOf(codeMap, copy) {
  const walked = new Map();
  findGbFunctions(copy, codeMap.functions.map(({ address, size }) => ({ address, size })), new Set(), { walked });
  const at = [...walked.keys()].sort((a, b) => a - b);
  return f => {
    const instructions = new Set(), branches = new Set();
    let low = 0, high = at.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (at[middle] < f.address) low = middle + 1;
      else high = middle;
    }
    for (let i = low; i < at.length && at[i] < f.address + f.size; i++) {
      instructions.add(at[i] - f.address);
      if (decodeSm83(copy, at[i])?.when !== undefined) branches.add(at[i] - f.address);
    }
    return { instructions, branches };
  };
}

/**
 * Finds the function an instruction that ran is in, for a code map: `find(address, code, thumb)` gives
 * [the function's place in the code map, the offset in it] or null. An address in the work RAM is a copy of the
 * cartridge's code, when the cartridge has those bytes there (`cartridge(address, count)` reads them), or else in a
 * function the game makes there, when the bytes `made` has for it (place in the code map → bytes) are those. On the
 * PlayStation 2, `find(address, code, processor, frame)`, with `loads` each module the IOP loaded in the run, as the
 * program that plays the original says them ({ frame, base, end, hash }).
 */
export function finderOf(codeMap, cartridge, made, loads = []) {
  const own = [], inMemory = [];
  codeMap.functions.forEach((f, index) => (f.bytes ? inMemory : own).push({ ...f, index }));
  const within = (list, address) => list.filter(f => address >= f.address && address < f.address + f.size);
  const inCartridge = address => {
    let low = 0, high = own.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, f = own[middle];
      if (address < f.address) high = middle - 1;
      else if (address >= f.address + f.size) low = middle + 1;
      else return [f.index, address - f.address];
    }
    return null;
  };
  // an NES or Super Nintendo address is a place in the program, and its code runs from nowhere else that counts
  if (byBytes(codeMap)) return address => inCartridge(address);
  // a PlayStation 2 address is in its processor's own memory: the EE's code counts where a program of the disc holds
  // what ran, and a vector unit's where the program an upload put there does (ps2/ledger.mjs)
  if (isPs2(codeMap)) {
    const programs = new Map(), units = [], inModules = new Map();
    codeMap.functions.forEach((f, index) => {
      const { kind, bytes, vuAddress } = cartridge.code(f);
      if (kind === 'vu' && vuAddress !== null) units.push({ index, address: vuAddress, size: f.size, bytes });
      const into = kind === 'ee' ? programs : kind === 'iop' ? inModules : null;
      if (!into) return;
      if (!into.has(f.program ?? '')) into.set(f.program ?? '', []);
      into.get(f.program ?? '').push({ index, address: f.address, size: f.size, bytes });
    });
    for (const list of inModules.values()) list.sort((a, b) => a.address - b.address);
    // each module the IOP loaded, the last first: where its bytes are, from which frame, and how far its functions'
    // addresses are from where they run
    const known = cartridge.modules?.() ?? new Map();
    // one the code map doesn't have is still there, over whatever was loaded at its place before
    const placed = loads.map(load => {
      const { program, textAt = 0, load: from = 0 } = known.get(load.hash) ?? {};
      return { frame: load.frame, base: load.base, end: load.end, shift: load.base + textAt - from, list: inModules.get(program) ?? [] };
    }).reverse();
    // the program the disc boots first, then the others
    const lists = [...programs].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([, list]) => list.sort((a, b) => a.address - b.address));
    const word = (bytes, at) => (at + 4 <= bytes.length ? (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0 : null);
    const holding = (list, address) => {
      let low = 0, high = list.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1, f = list[middle];
        if (address < f.address) high = middle - 1;
        else if (address >= f.address + f.size) low = middle + 1;
        else return f;
      }
      return null;
    };
    return (address, code, processor, frame = Infinity) => {
      if (processor === 0) {
        for (const list of lists) {
          const f = holding(list, address);
          if (f && word(f.bytes, address - f.address) === code) return [f.index, address - f.address];
        }
      } else if (processor === 1) {
        const module = placed.find(each => address >= each.base && address < each.end && each.frame <= frame);
        const f = module && holding(module.list, address - module.shift);
        if (f) return [f.index, address - module.shift - f.address];
      } else if (processor >= 2) {
        for (const f of units) if (address >= f.address && address < f.address + f.size && word(f.bytes, address - f.address) === code) return [f.index, address - f.address];
      }
      return null;
    };
  }
  const same = (bytes, at, code, thumb) => bytes && at + (thumb ? 2 : 4) <= bytes.length
    && (bytes[at] | bytes[at + 1] << 8) === (code & 0xFFFF) && (thumb || (bytes[at + 2] | bytes[at + 3] << 8) === code >>> 16);
  return (address, code, thumb) => {
    if (address >= CARTRIDGE) return inCartridge(address);
    for (const copy of codeMap.copies ?? []) {
      if (copy.packed || address < copy.ram || address >= copy.ram + copy.size) continue;
      const from = copy.cartridge + address - copy.ram;
      if (same(cartridge(from, 4), 0, code, thumb)) return inCartridge(from);
    }
    for (const f of within(inMemory, address)) {
      if (same(made.get(f.index), address - f.address, code, thumb)) return [f.index, address - f.address];
    }
    return null;
  };
}

/**
 * What ran in a recording's matching frames, as a set: `records` as the original's program writes them (five words
 * each: address, +1 for Thumb, the bytes, what happened, the first and last frame of a stretch), `matched[frame]`
 * whether that frame of the original matched, and `find` from finderOf.
 */
export function playedIn(records, matched, layout, find) {
  const before = new Uint32Array(matched.length + 1);
  for (let frame = 0; frame < matched.length; frame++) before[frame + 1] = before[frame] + (matched[frame] ? 1 : 0);
  const set = new Uint8Array(layout.bytes);
  for (let i = 0; i + 5 <= records.length; i += 5) {
    const from = records[i + 3], to = Math.min(records[i + 4], matched.length - 1);
    if (from > to || before[to + 1] === before[from]) continue;
    // a Game Boy Advance address has its lowest bit set for Thumb code, and a PlayStation 2 record says its processor
    const found = layout.unit === 1 ? find(records[i]) : layout.unit === 4 ? find(records[i], records[i + 1], records[i + 2] >>> 8, from) : find(records[i] & ~1, records[i + 1], (records[i] & 1) === 1);
    if (found) put(set, (layout.first[found[0]] + Math.floor(found[1] / layout.unit)) * 3 + (records[i + 2] & 0xFF));
  }
  return set;
}

/**
 * How many places ran, in any frame, that are in no function of the code map, on a console whose records say what ran
 * wherever it ran, as the PlayStation 2's do: each instruction once, whatever frames it ran in. `find` is finderOf's.
 * It's what the code map is missing, with the system's own code, which is no part of the game.
 */
export function outsideIn(records, find) {
  const seen = new Set();
  for (let i = 0; i + 5 <= records.length; i += 5) {
    if ((records[i + 2] & 0xFF) !== RAN || find(records[i], records[i + 1], records[i + 2] >>> 8, records[i + 3])) continue;
    seen.add(`${records[i + 2] >>> 8} ${records[i]} ${records[i + 1]}`);
  }
  return seen.size;
}

/** The cartridge's data used in a recording's matching frames, as a set of cells: `records` as the original's program
 *  writes them for DP_CONTENT (three words each: the cell, and the first and last frame of a stretch). */
export function contentIn(records, matched, cells) {
  const before = new Uint32Array(matched.length + 1);
  for (let frame = 0; frame < matched.length; frame++) before[frame + 1] = before[frame] + (matched[frame] ? 1 : 0);
  const set = new Uint8Array(Math.ceil(cells / 8));
  for (let i = 0; i + 3 <= records.length; i += 3) {
    const from = records[i + 1], to = Math.min(records[i + 2], matched.length - 1);
    if (records[i] < cells && from <= to && before[to + 1] !== before[from]) put(set, records[i]);
  }
  return set;
}

/** The cells of a cartridge that hold data, as a set: those with a byte outside every function of the code map, but
 *  those whose bytes are all the same. `rom` is the whole copy. */
export function contentCells(codeMap, rom) {
  const cells = Math.ceil(rom.length / CELL), code = new Uint8Array(rom.length), set = new Uint8Array(Math.ceil(cells / 8));
  for (const f of codeMap.functions) if (!f.bytes && f.address >= CARTRIDGE) code.fill(1, f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
  for (let cell = 0; cell < cells; cell++) {
    const from = cell * CELL, to = Math.min(from + CELL, rom.length);
    let data = false, same = true;
    for (let at = from; at < to; at++) {
      data ||= !code[at];
      same &&= rom[at] === rom[from];
    }
    if (data && !same) put(set, cell);
  }
  return set;
}

/**
 * What a game says nothing can reach, from games/<game>/proof/unreachable.json, which every version shares:
 * { "about", "code": [[from, to, why]], "content": [[from, to, why]], "ways": [[address, way, why]] }. `code` and
 * `content` are stretches of the cartridge, each its first and last address in hexadecimal, with why nothing reaches
 * it, such as code left from the game's making that nothing calls. `ways` are branches one way of which can't happen,
 * "taken" or "not taken", as the code itself decides them (lib/decided.mjs). A person reads each before it goes in, as
 * it takes something out of what gameplay proven counts, while it stays unplayed. Returns { code, content }, each a
 * list of [from, to] as numbers, and `ways`, a Map from a branch's address to TAKEN or NOT_TAKEN.
 */
export function readUnreachable(game) {
  const file = join(sharedProofFolder(game), 'unreachable.json');
  if (!existsSync(file)) return { code: [], content: [], ways: new Map() };
  const listed = JSON.parse(readFileSync(file, 'utf8'));
  const stretches = (list, word) => (list ?? []).map(([from, to, why]) => {
    const stretch = [parseInt(from, 16), parseInt(to, 16)];
    if (!/^[0-9A-F]{8}$/.test(from) || !/^[0-9A-F]{8}$/.test(to) || stretch[0] > stretch[1] || typeof why !== 'string' || !why.trim()) {
      throw new Error(`${file}: "${word}" lists stretches as [first address, last address, why], the addresses as eight capital hexadecimal digits.`);
    }
    return stretch;
  });
  const ways = new Map((listed.ways ?? []).map(([address, way, why]) => {
    if (!/^[0-9A-F]{8}$/.test(address) || !['taken', 'not taken'].includes(way) || typeof why !== 'string' || !why.trim()) {
      throw new Error(`${file}: "ways" lists branches as [address, "taken" or "not taken", why], the address as eight capital hexadecimal digits.`);
    }
    return [parseInt(address, 16), way === 'taken' ? TAKEN : NOT_TAKEN];
  }));
  return { code: stretches(listed.code, 'code'), content: stretches(listed.content, 'content'), ways };
}
const within = (stretches, address) => stretches.some(([from, to]) => address >= from && address <= to);

/**
 * What's been played of the cartridge's own code in a version's matching frames, for a search for what hasn't
 * (gba/original.c, DP_PROVEN): for each thing, its place in the cartridge in halfwords, times four, plus what it is.
 */
export function provenUnits(game, codeMap) {
  const layout = layoutOf(codeMap), played = readPlayed(game), ran = new Uint8Array(layout.bytes), units = [];
  for (const text of Object.values(played.places === layout.places ? played.recordings ?? {} : {})) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  codeMap.functions.forEach((f, index) => {
    if (f.bytes || f.address < CARTRIDGE) return;
    for (let place = layout.first[index]; place < layout.first[index + 1]; place++) {
      const slot = (f.address - CARTRIDGE) / 2 + place - layout.first[index];
      for (const what of [RAN, TAKEN, NOT_TAKEN]) if (has(ran, place * 3 + what)) units.push(slot * 4 + what);
    }
  });
  return Uint32Array.from(units);
}

/**
 * What's left to play of a PlayStation 2 version's EE code, in the program its disc boots, for a search for it
 * (libretro/ran-ps2.h, DP_UNPLAYED): for
 * each thing, the instruction's address plus what it is, 0 an instruction that never ran in a matching frame, 1 a
 * branch never taken and 2 one never not taken, a way the game's unreachable.json rules out left out. Where the
 * Game Boy Advance's search is given what's been played and counts the rest of the cartridge, a PlayStation 2's
 * memory holds other code than the program's, so its search is given what to look for.
 */
export function unplayedUnits(game, codeMap) {
  const layout = layoutOf(codeMap), played = readPlayed(game), same = played.places === layout.places;
  const ran = new Uint8Array(layout.bytes), code = unpack(same ? played.code : null, layout.bytes), units = [];
  const { ways: ruledOut } = readUnreachable(game);
  for (const text of Object.values(same ? played.recordings ?? {} : {})) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  codeMap.functions.forEach((f, index) => {
    if (f.program || f.vu || f.bytes) return;
    for (let place = layout.first[index]; place < layout.first[index + 1]; place++) {
      const at = f.address + (place - layout.first[index]) * layout.unit;
      if (has(code, place * 3 + INSTRUCTION) && !has(ran, place * 3 + RAN)) units.push((at | RAN) >>> 0);
      if (!has(code, place * 3 + BRANCH)) continue;
      for (const way of [TAKEN, NOT_TAKEN]) if (!has(ran, place * 3 + way) && ruledOut.get(at) !== way) units.push((at | way) >>> 0);
    }
  });
  return Uint32Array.from(units);
}

/**
 * What a version's played.json leaves untouched, for people and for tasks: { functions, content }. `functions` has, for
 * each function of the code map with something unplayed, { key, address, size, total, played, never, ways }: its
 * instructions and branch ways, how many were played, whether it never ran at all, and `ways`, the addresses of the
 * branches played only one way, with the way never gone ('taken' or 'not taken'). `content` is the stretches of the
 * cartridge's data never used, as [first address, last address], the longest first, or none without `cartridge`.
 */
export function untouchedOf(game, codeMap, cartridge = null) {
  const layout = layoutOf(codeMap), played = readPlayed(game), same = played.places === layout.places;
  const ran = new Uint8Array(layout.bytes), code = unpack(same ? played.code : null, layout.bytes);
  const { ways: ruledOut } = readUnreachable(game);
  for (const text of Object.values(same ? played.recordings ?? {} : {})) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  const functions = [];
  codeMap.functions.forEach((f, index) => {
    let total = 0, done = 0;
    const ways = [];
    for (let place = layout.first[index]; place < layout.first[index + 1]; place++) {
      const at = f.address + (place - layout.first[index]) * layout.unit;
      const went = [has(ran, place * 3 + RAN), has(ran, place * 3 + TAKEN), has(ran, place * 3 + NOT_TAKEN)];
      if (has(code, place * 3 + INSTRUCTION)) total++;
      if (has(code, place * 3 + BRANCH)) {
        // a way the game's list says can't happen isn't one to play
        const out = f.bytes ? undefined : ruledOut.get(at);
        total += [TAKEN, NOT_TAKEN].filter(way => went[way] || way !== out).length;
        if (went[RAN] && went[TAKEN] !== went[NOT_TAKEN] && (went[TAKEN] ? NOT_TAKEN : TAKEN) !== out) ways.push([at, went[TAKEN] ? 'not taken' : 'taken']);
      }
      done += went.filter(Boolean).length;
    }
    if (done < total) functions.push({ key: f.key, address: f.address, size: f.size, total, played: done, never: done === 0, ways });
  });
  if (!cartridge || !followsContent(codeMap)) return { functions, content: [] };
  // the cartridge's data never used, cell by cell, joined into stretches: on the PlayStation 2 the disc's sectors never
  // read, with those that hold one value throughout, which don't count, as `plain`, so every sector is accounted for
  const { count, holds } = cellsHeld(codeMap, cartridge), read = new Uint8Array(Math.ceil(count / 8)), content = [], plain = [];
  for (const text of Object.values(same ? played.content ?? {} : {})) {
    const set = unpack(text, read.length);
    for (let i = 0; i < set.length; i++) read[i] |= set[i];
  }
  const ps2 = isPs2(codeMap), span = ps2 ? 1 : CELL;
  for (let cell = 0; cell < count; cell++) {
    if (has(read, cell) || (!ps2 && !has(holds, cell))) continue;
    const into = has(holds, cell) ? content : plain, from = cellAddress(codeMap, cell), last = into.at(-1);
    if (last && last[1] + 1 === from) last[1] = from + span - 1;
    else into.push([from, from + span - 1]);
  }
  const longest = (a, b) => (b[1] - b[0]) - (a[1] - a[0]) || a[0] - b[0];
  content.sort(longest);
  plain.sort(longest);
  return { functions, content, ...(ps2 ? { plain, sectors: count, sectorBytes: SECTOR } : {}) };
}

/**
 * Whether a version used something of each cell of its cartridge's data in a frame that matched, as its played.json
 * says, for the bytes accounted for (lib/rebuild.mjs): `used(cell)`, a cell numbered from the copy's start, of `bytes`,
 * the copy's length. Nothing is used of a version with no played.json, or one of another code map.
 */
export function usedCells(game, codeMap, bytes) {
  const played = readPlayed(game), size = Math.ceil(Math.ceil(Math.min(bytes, 0x02000000) / CELL) / 8);
  const read = new Uint8Array(size);
  if (followsContent(codeMap) && played.places === layoutOf(codeMap).places) {
    for (const text of Object.values(played.content ?? {})) {
      const set = unpack(text, size);
      for (let i = 0; i < size; i++) read[i] |= set[i];
    }
  }
  return cell => cell >> 3 < size && has(read, cell);
}

/**
 * What's left of a version as pieces someone can take, once its parts are all played through (tools/tasks.mjs):
 * `functions` from untouchedOf, `parts` the game's, in a player's order, each { name, recording }, and `ran` each
 * recording's functions that ran in matching frames, by its name (progress.json). A function played in part goes with
 * the first part whose recording ran it, as "What's left of <part>"; one no part's recording ran, and those never
 * played, go by where they are in the original, as "Code never played around <address>", a stretch of 0x10000 each,
 * and one that most parts' recordings ran, as "What's left of the code the parts share around <address>".
 * Returns [{ name, recording, functions }], the parts' pieces first, each piece's functions those with most left first.
 */
export function leftoverPieces(functions, parts, ran) {
  // the first part whose recording ran each function, and how many parts' recordings did: one most of them ran is
  // the game's own machinery, no part's in particular
  const partOf = new Map(), shared = new Map();
  for (const part of parts) {
    for (const key of new Set(ran[part.recording] ?? [])) {
      if (!partOf.has(key)) partOf.set(key, part);
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const proven = parts.filter(part => ran[part.recording]).length;
  const pieces = new Map();
  const into = (name, recording, order, f) => {
    if (!pieces.has(name)) pieces.set(name, { name, recording, order, functions: [] });
    pieces.get(name).functions.push(f);
  };
  for (const f of functions) {
    const part = f.never ? null : partOf.get(f.key), block = hex8(f.address & ~0xFFFF);
    if (part && shared.get(f.key) * 2 > proven && proven > 2) into(`What's left of the code the parts share around ${block}`, part.recording, parts.length + (f.address >>> 16), f);
    else if (part) into(`What's left of ${part.name}`, part.recording, parts.indexOf(part), f);
    else into(`Code never played around ${block}`, null, parts.length + 0x10000 + (f.address >>> 16), f);
  }
  return [...pieces.values()].sort((a, b) => a.order - b.order).map(({ name, recording, functions: list }) => ({
    name, recording, functions: list.sort((a, b) => (b.total - b.played) - (a.total - a.played) || a.address - b.address),
  }));
}
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');

/** A version's played.json, or a new one. */
/**
 * The recordings in whose matching frames the instruction at `address` ran, with what it did there: each as
 * { name, taken, notTaken }, or none when the address is in no function of the code map or nothing has run it.
 */
export function ranIn(game, codeMap, address) {
  const layout = layoutOf(codeMap), played = readPlayed(game);
  const index = codeMap.functions.findIndex(f => address >= f.address && address < f.address + f.size);
  if (index < 0 || played.places !== layout.places) return [];
  const place = layout.first[index] + Math.floor((address - codeMap.functions[index].address) / layout.unit);
  return Object.entries(played.recordings ?? {}).map(([name, text]) => {
    const set = unpack(text, layout.bytes);
    return has(set, place * 3 + RAN) ? { name, taken: has(set, place * 3 + TAKEN), notTaken: has(set, place * 3 + NOT_TAKEN) } : null;
  }).filter(Boolean);
}

/**
 * The functions of the code map that started in a recording's matching frames, from what ran there (`set`, as playedIn
 * gives it): those whose first instruction ran, by their keys, in the code map's order. It's what a recording's row
 * lists as found running, for a recording whose program says what ran and not which functions started.
 */
export function startedIn(set, codeMap) {
  const layout = layoutOf(codeMap);
  return codeMap.functions.filter((f, index) => has(set, layout.first[index] * 3 + RAN)).map(f => f.key);
}

/**
 * For each recording, which of `addresses` ran in its matching frames: a Map from the recording's name to those
 * addresses, the recordings that ran none left out.
 */
export function ranBy(game, codeMap, addresses) {
  const layout = layoutOf(codeMap), played = readPlayed(game), by = new Map();
  if (played.places !== layout.places) return by;
  const starts = codeMap.functions.map((f, index) => ({ f, index })).sort((x, y) => x.f.address - y.f.address);
  const places = addresses.map(address => {
    // the last function that starts at or before it
    let low = 0, high = starts.length - 1, found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (starts[middle].f.address <= address) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    const at = found < 0 ? null : starts[found];
    return at && address < at.f.address + at.f.size ? layout.first[at.index] + Math.floor((address - at.f.address) / layout.unit) : -1;
  });
  for (const [name, text] of Object.entries(played.recordings ?? {})) {
    const set = unpack(text, layout.bytes);
    const ran = addresses.filter((_, i) => places[i] >= 0 && has(set, places[i] * 3 + RAN));
    if (ran.length) by.set(name, ran);
  }
  return by;
}

export function readPlayed(game) {
  const file = join(proofFolder(game), 'played.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { recordings: {} };
}

/**
 * Works out a version's played.json again and writes it: `sets` holds what ran in the matching frames of the
 * recordings just proven (name → set), the others stay as the file has them, and those not in `all` go. `made` holds the
 * bytes of the functions the game made in memory in those runs (place in the code map → bytes), and `cartridge` reads
 * the copy. Where each function's instructions and branches are comes from its bytes, followed from its start and from
 * what ran; a function made in memory that didn't run now keeps what the file knew of it. `used` holds the cartridge's
 * data those recordings used (name → set of cells). Returns { percent, total, played, content: { total, read, percent } },
 * `content` being null on a console whose data the tools don't follow, where `cartridge.copy()` gives the whole copy.
 */
export function writePlayed(game, { original, codeMap, cartridge, sets, used, made, all }) {
  const layout = layoutOf(codeMap), before = readPlayed(game), unreachable = readUnreachable(game);
  const sameMap = before.original === original && before.places === layout.places;
  const recordings = {};
  for (const name of [...all].sort()) {
    if (sets.has(name)) recordings[name] = pack(sets.get(name));
    else if (sameMap && before.recordings?.[name]) recordings[name] = before.recordings[name];
  }
  // everything that ran in some recording's matching frames
  const ran = new Uint8Array(layout.bytes);
  for (const text of Object.values(recordings)) {
    const set = unpack(text, layout.bytes);
    for (let i = 0; i < set.length; i++) ran[i] |= set[i];
  }
  const known = unpack(sameMap ? before.code : null, layout.bytes), code = new Uint8Array(layout.bytes);
  let total = 0, played = 0;
  const unit = layout.unit, nesCode = isNes(codeMap) ? nesInstructionsOf(codeMap, cartridge.copy()) : isGb(codeMap) ? gbInstructionsOf(codeMap, cartridge.copy()) : isSnes(codeMap) ? snesInstructionsIn(codeMap.functions, cartridge.copy()) : null, ps2 = isPs2(codeMap);
  codeMap.functions.forEach((f, index) => {
    const first = layout.first[index], places = layout.first[index + 1] - first;
    // a PlayStation 2 function's bytes are its own program's, a module's or a vector unit's among them (ps2/ledger.mjs)
    const own = ps2 ? cartridge.code(f) : null;
    const bytes = own ? own.bytes : f.bytes ? made.get(index) : cartridge(f.address, f.size);
    if (bytes) {
      const seeds = [];
      for (let place = 0; place < places; place++) if (has(ran, (first + place) * 3 + RAN)) seeds.push(place * unit);
      const { instructions, branches } = nesCode ? nesCode(f) : own?.kind === 'vu' ? vuInstructionsOf(bytes, seeds) : own ? mipsInstructionsOf(bytes, seeds, new Map(), f.address) : instructionsOf(bytes, seeds);
      for (const at of instructions) put(code, (first + Math.floor(at / unit)) * 3 + INSTRUCTION);
      for (const at of branches) put(code, (first + Math.floor(at / unit)) * 3 + BRANCH);
    } else {
      for (let place = 0; place < places; place++) {
        for (const what of [INSTRUCTION, BRANCH]) if (has(known, (first + place) * 3 + what)) put(code, (first + place) * 3 + what);
      }
    }
    for (let place = first; place < first + places; place++) {
      const went = [has(ran, place * 3 + RAN), has(ran, place * 3 + TAKEN), has(ran, place * 3 + NOT_TAKEN)];
      // what ran is an instruction, and what went a way a branch, whatever following the code found
      if (went[RAN]) put(code, place * 3 + INSTRUCTION);
      if (went[TAKEN] || went[NOT_TAKEN]) put(code, place * 3 + BRANCH);
      // what the game's list says nothing can reach doesn't count while it stays unplayed
      const out = !f.bytes && within(unreachable.code, f.address + (place - first) * unit);
      if (has(code, place * 3 + INSTRUCTION) && (went[RAN] || !out)) total++;
      // a branch's two ways count, but one the game's list says can't happen, while nothing has gone that way
      const ruledOut = f.bytes ? undefined : unreachable.ways.get(f.address + (place - first) * unit);
      if (has(code, place * 3 + BRANCH)) total += out ? went.slice(1).filter(Boolean).length : [TAKEN, NOT_TAKEN].filter(way => went[way] || way !== ruledOut).length;
      played += went.filter(Boolean).length;
    }
  });
  const percent = playedPercent(played, total);
  const start = `{\n  "original": ${JSON.stringify(original)},\n  "percent": ${percent},\n  "units": ${JSON.stringify({ total, played })},\n  "places": ${layout.places},\n`
    + `  "code": ${JSON.stringify(pack(code))},\n  "recordings": {\n${Object.entries(recordings).map(([name, set]) => `    ${JSON.stringify(name)}: ${JSON.stringify(set)}`).join(',\n')}\n  }`;
  // a version whose proof has nothing yet has no folder for it
  mkdirSync(proofFolder(game), { recursive: true });
  if (!followsContent(codeMap)) {
    writeFileSync(join(proofFolder(game), 'played.json'), `${start}\n}\n`);
    return { percent, total, played, content: null };
  }
  // the cartridge's data: the cells that count, and those some recording used in its matching frames
  const { holds } = cellsHeld(codeMap, cartridge), cellBytes = holds.length;
  const content = {};
  for (const name of [...all].sort()) {
    if (used.has(name)) content[name] = pack(used.get(name));
    else if (sameMap && before.content?.[name]) content[name] = before.content[name];
  }
  let cellsTotal = 0, cellsRead = 0;
  const read = new Uint8Array(cellBytes);
  for (const text of Object.values(content)) {
    const set = unpack(text, cellBytes);
    for (let i = 0; i < cellBytes; i++) read[i] |= set[i];
  }
  for (let cell = 0; cell < cellBytes * 8; cell++) {
    if (!has(holds, cell)) continue;
    if (!has(read, cell) && within(unreachable.content, cellAddress(codeMap, cell))) continue;
    cellsTotal++;
    if (has(read, cell)) cellsRead++;
  }
  const ofContent = { total: cellsTotal, read: cellsRead, percent: playedPercent(cellsRead, cellsTotal) };
  const text = `${start},\n`
    + `  "cells": ${JSON.stringify(ofContent)},\n  "content": {\n${Object.entries(content).map(([name, set]) => `    ${JSON.stringify(name)}: ${JSON.stringify(set)}`).join(',\n')}\n  }\n}\n`;
  writeFileSync(join(proofFolder(game), 'played.json'), text);
  return { percent, total, played, content: ofContent };
}
