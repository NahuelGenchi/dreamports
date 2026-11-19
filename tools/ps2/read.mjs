// What `npm run dp -- read` prints for a PlayStation 2 game (../read.mjs): one of the original's functions, read from the
// contributor's own copy by the tools' own decoders, laid out as the other consoles' are. It's any code the code map has
// (functions.mjs): the EE's, in the program the disc boots or another (ee.mjs), the IOP's, in a module (the PlayStation's
// decoder, ../ps1/mips.mjs, as the IOP is its processor), or a vector unit's program (vu.mjs).
//
// An EE or IOP line is an address, the word there and the instruction it makes. A branch's delay slot is the line after
// it, which runs before the branch goes, unless the branch is a likely one that doesn't go. After a semicolon comes the
// code map's name of what a call, a jump or a branch goes to, and the address a `lui` makes with the instruction that
// adds to it, as the compiler builds every address in two halves. A module's addresses are from its start, as the IOP
// loads it wherever it has room. A vector unit line is where the pair is, in the program or its file, then where the
// unit keeps it, the lower and the upper words and the pair as text, upper first; a branch's target is in the unit's
// memory.

import { hex } from '../lib/proof-files.mjs';
import { readShifts } from '../portmap.mjs';
import { listingOf } from '../ps1/read.mjs';
import { decode as decodeIop } from '../ps1/mips.mjs';
import { decode as decodeEe } from './ee.mjs';
import { decodePair } from './vu.mjs';
import { moduleCode, programOf, sectionOf } from './functions.mjs';

// how much is read when the code map doesn't have the function, unless --bytes says
const SOME_BYTES = 256;
const KEY = /^(?:0x)?([0-9a-f]{1,8})(?:@(.+?))?(~vu)?$/i;

/**
 * Where a function is, given by an address, such as 0x00123456, a code map key, as 00000120@MCMAN.IRX or 00340010~vu,
 * an address with a program, as 0x120@MCMAN.IRX, a name in the code map, or a label with an address in it, such as
 * func_00123456, moved by the game's proof/names.json as portmap moves it: { address, program, vu, label }.
 */
export function ps2Resolve(game, codeMap, what) {
  const key = KEY.exec(what);
  if (key && (key[1].length === 8 || key[2] || key[3] || /^0x/i.test(what))) {
    const address = parseInt(key[1], 16), program = key[2] ?? null;
    // a bare address of the boot program is a vector unit's when one of its programs is there
    const vu = !!key[3] || (!program && codeMap.functions.some(f => f.vu && !f.program && address >= f.address && address < f.address + f.size));
    return { address, program, vu };
  }
  const named = codeMap.functions.find(f => f.name === what) ?? codeMap.functions.find(f => f.name?.toLowerCase() === what.toLowerCase());
  if (named) return { address: named.address, program: named.program ?? null, vu: !!named.vu };
  const label = what.match(/^[A-Za-z][A-Za-z0-9]*_([0-9a-f]{8})$/i);
  if (label) {
    const address = parseInt(label[1], 16);
    const by = readShifts(game).find(s => address >= s.from && address <= s.to)?.by ?? 0;
    return { address: address - by, program: null, vu: false, label: by ? `${what} is 0x${hex(address - by)} in this copy, ${by} bytes before its label, as games/${game}/proof/names.json says.` : null };
  }
  throw new Error(`"${what}" isn't an address, such as 0x00123456, one with its program, such as 0x120@MCMAN.IRX, a name in games/${game}/proof/code-map.json, or a label, such as func_00123456.`);
}

/**
 * What read prints for a PlayStation 2 game: { key, text, has }, with `key` the name its file is kept by and `has`
 * whether something a note is about is in what it read.
 */
export async function readPs2({ game, what, original, codeMap, copy, flags }) {
  for (const flag of ['arm', 'thumb', 'frame']) {
    if (flags[flag] !== undefined) throw new Error(`--${flag} is for a Game Boy Advance game: on the PlayStation 2, read takes --bytes <n>.`);
  }
  const { address, program, vu, label } = ps2Resolve(game, codeMap, what);
  const here = f => (f.program ?? null) === program && !!f.vu === vu;
  const functions = codeMap.functions.filter(f => !f.bytes && here(f));
  const mapped = functions.find(f => address >= f.address && address < f.address + f.size);
  const bytes = await programOf(copy.path, program);
  if (!bytes) throw new Error(`${original.name} has no ${program ?? 'program it boots'} on its disc.`);
  const whereText = program ? ` of ${program}` : '';
  const kind = vu ? 'vu' : program && bytes.readUInt32BE(0) === 0x7F454C46 && bytes.readUInt16LE(16) === 0xFF80 ? 'iop' : 'ee';

  // the code's words: from the program's sections by EE address, from a module's code by its own, or a file's bytes
  let wordAt, end;
  if (kind === 'iop') {
    const code = moduleCode(bytes);
    wordAt = at => code.text.readUInt32LE(at - code.load);
    end = code.load + code.text.length;
    if (address < code.load || address >= end) throw new Error(`0x${hex(address)} isn't in ${program}'s code, which runs from 0x${hex(code.load)} to 0x${hex(end)}.`);
  } else if (bytes.readUInt32BE(0) === 0x7F454C46 && (!program || kind === 'ee')) {
    const section = sectionOf(bytes, address);
    if (!section) throw new Error(`0x${hex(address)} isn't in ${program ?? `the program ${original.name} boots`}.`);
    wordAt = at => bytes.readUInt32LE(section.offset + at - section.address);
    end = section.address + Math.min(section.size, bytes.length - section.offset);
  } else {
    wordAt = at => bytes.readUInt32LE(at);
    end = bytes.length & ~3;
    if (address >= end) throw new Error(`0x${hex(address)} is past the end of ${program}.`);
  }

  let start = address, length, extent;
  if (flags.bytes) {
    length = flags.bytes;
    extent = `${length} bytes from there, as --bytes asks`;
  } else if (mapped) {
    [start, length] = [mapped.address, mapped.size];
    extent = `the whole ${vu ? 'program' : 'function'}, ${length} bytes, as the code map has it`;
  } else {
    length = SOME_BYTES;
    extent = `its first ${length} bytes, since the code map doesn't list it: --bytes <n> reads more`;
  }
  const stop = Math.min(start + length, end);
  const starts = new Map(functions.map(f => [f.address, f]));
  const nameOf = at => (starts.has(at) ? starts.get(at).name ?? `func_${hex(at)}` : null);
  let lines, how;
  if (vu) {
    // where the unit keeps the program: as the MPG command before its first instruction says
    const first = mapped?.address ?? start;
    const command = first >= 4 ? wordAt(first - 4) : 0;
    const vuStart = ((command >>> 24) & 0x7F) === 0x4A ? (command & 0xFFFF) * 8 : 0;
    lines = [];
    for (let at = start; at + 8 <= stop; at += 8) {
      const lower = wordAt(at), upper = wordAt(at + 4), vuAt = vuStart + at - first;
      const pair = decodePair(lower, upper, vuAt);
      const note = !pair ? 'not an instruction pair' : pair.immediate !== undefined ? `I = ${pair.immediate}` : pair.ends ? 'the program ends after the next pair' : '';
      lines.push(`${hex(at)}  ${vuAt.toString(16).toUpperCase().padStart(4, '0')}:  ${hex(lower)} ${hex(upper)}  ${pair ? pair.text.trimEnd() : '.word'}${note ? `  ; ${note}` : ''}`);
    }
    how = `Each line is where the pair is${program ? ` in ${program}` : ''}, where the vector unit keeps it, its lower and upper words and the pair, upper first, as the tools' own decoder reads it (tools/ps2/vu.mjs). A branch's target is in the unit's memory, and the pair after a branch runs before it goes.`;
  } else {
    const decode = kind === 'iop' ? decodeIop : decodeEe;
    lines = listingOf({ wordAt, start, end: stop, decode, nameOf, adds: ['addiu', 'daddiu', 'ori'] })
      .map(line => `${hex(line.address)}:  ${hex(line.word)}  ${line.text}${line.note ? `  ; ${line.note}` : ''}`);
    how = kind === 'iop'
      ? `Each line is an address from the module's start, the word there and the instruction the IOP makes of it, as the tools' own decoder reads it (tools/ps1/mips.mjs). A branch's delay slot is the line after it. After a semicolon comes the code map's name of where a call or a branch goes, and the address a lui and what's added to it make.`
      : `Each line is an address, the word there and the EE's instruction it makes, as the tools' own decoder reads it (tools/ps2/ee.mjs). A branch's delay slot is the line after it, and runs before the branch goes, but after a likely branch that doesn't go. After a semicolon comes the code map's name of where a call or a branch goes, and the address a lui and what's added to it make.`;
  }
  let name;
  if (!mapped) name = `0x${hex(start)}${whereText}`;
  else if (mapped.address !== start) name = `0x${hex(start)}${whereText}, inside ${nameOf(mapped.address)},`;
  else if (vu && !mapped.name) name = `The vector unit program at 0x${hex(start)}${whereText}`;
  else name = `${nameOf(start)}${whereText}, at 0x${hex(start)},`;
  const head = [
    `${name} in ${original.name}: ${extent}.`,
    ...(label ? [label] : []),
    ...(address !== start ? [`0x${hex(address)} is inside it.`] : []),
    `${how} tools/README.md, Reading the original's instructions, explains them.`,
  ];
  const has = about => {
    try {
      const at = ps2Resolve(game, codeMap, about);
      return (at.program ?? null) === program && at.vu === vu && at.address >= start && at.address < start + length;
    } catch {
      return false;
    }
  };
  const key = `${hex(start)}${program ? `@${program}` : ''}${vu ? '~vu' : ''}`.replace(/[/:\\]/g, '_');
  return { key, text: [...head, '', ...lines, ''].join('\n'), has };
}
