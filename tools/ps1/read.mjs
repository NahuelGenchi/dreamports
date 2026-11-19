// What `npm run dp -- read` prints for a PlayStation game (../read.mjs): one of the original's functions as MIPS
// instructions, read from the program the contributor's own copy boots by the tools' own decoder (mips.mjs), laid out
// as the other consoles' are. Each line is an address, the word there and the instruction it makes. A branch's delay
// slot is the line after it, which runs before the branch goes, and a load's register holds what it loaded only from
// the instruction after the next. After a semicolon comes the code map's name of what a call, a jump or a branch goes
// to, and the address a `lui` makes with the instruction that adds to it, as the console's compiler builds every
// address in two halves: that's the address the C of a twin names.

import { hex } from '../lib/proof-files.mjs';
import { readShifts } from '../portmap.mjs';
import { decode } from './mips.mjs';
import { exeOf, findFunctions, ps1Program } from './functions.mjs';

// how much is read when neither the code map nor the finder has the function, unless --bytes says
const SOME_BYTES = 256;

/** The address a function is given by: an address, such as 0x800C1234, a name in the code map, or a label with an
 *  address in it, such as func_800C1234 or FUN_800c1234, moved by the game's proof/names.json as portmap moves it. */
export function ps1Resolve(game, codeMap, what) {
  const number = what.match(/^(?:0x)?([0-9a-f]{8})$/i);
  if (number) return { address: parseInt(number[1], 16) };
  const named = codeMap.functions.find(f => f.name === what) ?? codeMap.functions.find(f => f.name?.toLowerCase() === what.toLowerCase());
  if (named) return { address: named.address };
  const label = what.match(/^[A-Za-z][A-Za-z0-9]*_([0-9a-f]{8})$/i);
  if (label) {
    const address = parseInt(label[1], 16);
    const by = readShifts(game).find(s => address >= s.from && address <= s.to)?.by ?? 0;
    return { address: address - by, label: by ? `${what} is 0x${hex(address - by)} in this copy, ${by} bytes before its label, as games/${game}/proof/names.json says.` : null };
  }
  throw new Error(`"${what}" isn't an address, such as 0x800C1234, a name in games/${game}/proof/code-map.json, or a label, such as func_800C1234.`);
}

/**
 * The lines of `length` bytes of the program from `start`: { address, word, text, note }. `nameOf(address)` is the
 * code map's name of a function that starts there, or null.
 */
export function listing(exe, start, length, nameOf) {
  const { load, text } = exeOf(exe);
  // what each register is known to hold, from a lui and what adds to it, until anything else writes it, a branch's
  // target is reached, or a call is made
  const known = new Map(), targets = new Set();
  const lines = [];
  for (let at = start; at < start + length && at + 4 <= load + text.length; at += 4) {
    const word = text.readUInt32LE(at - load), found = decode(word, at);
    if (found?.target !== undefined) targets.add(found.target);
    lines.push({ address: at, word, found });
  }
  return lines.map(line => {
    const { address, word, found } = line;
    if (targets.has(address)) known.clear();
    if (!found) return { address, word, text: `.word   0x${hex(word)}`, note: 'not an instruction' };
    const notes = [];
    if (found.target !== undefined) notes.push(nameOf(found.target) ?? (found.kind === 'call' ? 'no function of the code map starts there' : null));
    let made = null;
    if (found.name === 'lui') made = { register: found.rt, value: (found.imm << 16) >>> 0 };
    else if ((found.name === 'addiu' || found.name === 'ori') && known.has(found.rs)) made = { register: found.rt, value: found.name === 'ori' ? (known.get(found.rs) | found.imm) >>> 0 : (known.get(found.rs) + found.imm) >>> 0 };
    else if ((found.kind === 'load' || found.kind === 'store') && known.has(found.rs)) {
      const place = (known.get(found.rs) + found.imm) >>> 0;
      notes.push(`0x${hex(place)}${nameOf(place) ? ` ${nameOf(place)}` : ''}`);
    }
    if (made && found.name !== 'lui') notes.push(`0x${hex(made.value)}${nameOf(made.value) ? ` ${nameOf(made.value)}` : ''}`);
    // what this instruction writes no longer holds what was known
    if (found.writes !== null) known.delete(found.writes);
    if (made) known.set(made.register, made.value);
    if (found.kind === 'call') {
      // what a call leaves isn't known after it, but in what it keeps
      for (const register of [...known.keys()]) if (register < 16 || register > 23) known.delete(register);
    }
    return { address, word, text: found.text, note: notes.filter(Boolean).join('; ') };
  });
}

/**
 * What read prints for a PlayStation game: { key, text, has }, with `key` the address it starts at, as the code map
 * writes it, and `has` whether something a note is about is in what it read.
 */
export async function readPs1({ game, what, original, codeMap, copy, flags }) {
  for (const flag of ['arm', 'thumb', 'frame']) {
    if (flags[flag] !== undefined) throw new Error(`--${flag} is for a Game Boy Advance game: on the PlayStation, read takes --bytes <n>.`);
  }
  const exe = await ps1Program(copy.path);
  const { load, text } = exeOf(exe);
  const { address, label } = ps1Resolve(game, codeMap, what);
  if (address < load || address >= load + text.length) throw new Error(`0x${hex(address)} isn't in the program ${original.name} boots, which is loaded from 0x${hex(load)} to 0x${hex(load + text.length)}.`);
  const functions = codeMap.functions.filter(f => !f.bytes);
  const mapped = functions.find(f => address >= f.address && address < f.address + f.size);
  const traced = mapped ? null : findFunctions(exe).find(f => address >= f.address && address < f.address + f.size);
  let start = address, length, extent;
  if (flags.bytes) {
    length = flags.bytes;
    extent = `${length} bytes from there, as --bytes asks`;
  } else if (mapped) {
    [start, length] = [mapped.address, mapped.size];
    extent = `the whole function, ${length} bytes, as the code map has it`;
  } else if (traced) {
    [start, length] = [traced.address, traced.size];
    extent = `${length} bytes, as far as the tools can follow its code, since the code map doesn't list it`;
  } else {
    length = SOME_BYTES;
    extent = `its first ${length} bytes, since the code map doesn't list it: --bytes <n> reads more`;
  }
  const starts = new Map(functions.map(f => [f.address, f]));
  const nameOf = at => (starts.has(at) ? starts.get(at).name ?? `func_${hex(at)}` : null);
  const lines = listing(exe, start, length, nameOf);
  const name = !mapped ? `0x${hex(start)}` : mapped.address === start ? `${nameOf(start)}, at 0x${hex(start)},` : `0x${hex(start)}, inside ${nameOf(mapped.address)},`;
  const head = [
    `${name} in ${original.name}: ${extent}.`,
    ...(label ? [label] : []),
    ...(address !== start ? [`0x${hex(address)} is inside it.`] : []),
    `Each line is an address, the word there and the MIPS instruction it makes, as the tools' own decoder reads it (tools/ps1/mips.mjs). A branch's delay slot is the line after it, and runs before the branch goes. After a semicolon comes the code map's name of where a call or a branch goes, and the address a lui and what's added to it make. tools/README.md, Reading the original's instructions, explains them.`,
  ];
  const has = about => {
    try {
      const at = ps1Resolve(game, codeMap, about).address;
      return at >= start && at < start + length;
    } catch {
      return false;
    }
  };
  const written = lines.map(line => `${hex(line.address)}:  ${hex(line.word)}  ${line.text}${line.note ? `  ; ${line.note}` : ''}`);
  return { key: hex(start), text: [...head, '', ...written, ''].join('\n'), has };
}
