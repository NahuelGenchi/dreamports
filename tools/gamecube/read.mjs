// What `npm run dp -- read` prints for a GameCube game (../read.mjs): one of the original's functions as the
// processor's instructions, read from the program the contributor's own copy boots, or from a module on its disc
// (functions.mjs), by the tools' own decoder (ppc.mjs). Each line is an address, the word there and the instruction it
// makes. This processor has no delay slots: a branch goes at once. After a semicolon comes the code map's name of what
// a call or a branch goes to, and the address a `lis` makes with the instruction that adds to it, as the console's
// compilers build an address in two halves: that's the address the C of a twin names. An address reached from r2 or
// r13, the two registers a program keeps pointed at its small values, is left as its offset, as where they point is
// the program's own choice.
//
// A module can be loaded anywhere, so its lines are numbered by where each word is in the module's file, as its
// functions are in the code map, and a call in it names no target: the console writes each as it loads the module.

import { hex } from '../lib/proof-files.mjs';
import { readShifts } from '../portmap.mjs';
import { decode } from './ppc.mjs';
import { codeOf, findFunctions, findRelFunctions, gamecubeDisc, relOf } from './functions.mjs';

// how much is read when neither the code map nor the finder has the function, unless --bytes says
const SOME_BYTES = 256;
const KEY = /^(?:0x)?([0-9a-f]{1,8})(?:@(.+))?$/i;
// the instructions that add a number to a register's, and those that or one in
const ADDS = new Set([14, 12, 13]), ORS = new Set([24]);
// loads and stores of a register plus a number
const REACHES = op => (op >= 32 && op <= 55);

/**
 * Where a function is, given by an address, such as 0x80003100, an address with its module, as 0xF4@stage/first.rel,
 * a code map key, a name in the code map, or a label with an address in it, such as fn_80003100, moved by the game's
 * proof/names.json as portmap moves it: { address, program, label }.
 */
export function gamecubeResolve(game, codeMap, what) {
  const key = KEY.exec(what);
  if (key && (key[2] || key[1].length === 8)) return { address: parseInt(key[1], 16), program: key[2] ?? null };
  const named = codeMap.functions.find(f => f.name === what) ?? codeMap.functions.find(f => f.name?.toLowerCase() === what.toLowerCase());
  if (named) return { address: named.address, program: named.program ?? null };
  const label = what.match(/^[A-Za-z][A-Za-z0-9]*_(8[01][0-9a-f]{6})$/i);
  if (label) {
    const address = parseInt(label[1], 16);
    const by = readShifts(game).find(s => address >= s.from && address <= s.to)?.by ?? 0;
    return { address: address - by, program: null, label: by ? `${what} is 0x${hex(address - by)} in this copy, ${by} bytes before its label, as games/${game}/proof/names.json says.` : null };
  }
  throw new Error(`"${what}" isn't an address, such as 0x80003100, one with its module, such as 0xF4@stage/first.rel, a name in games/${game}/proof/code-map.json, or a label, such as fn_80003100.`);
}

/**
 * The lines of the code from `start` to `end`: { address, word, text, note }. `wordAt(address)` reads a word,
 * `nameOf(address)` is the code map's name of a function that starts there, or null, and `targets` says the code's
 * branches and calls name where they go, which a module's calls don't.
 */
export function listingOf({ wordAt, start, end, nameOf, targets = true }) {
  // what each register is known to hold, from a lis and what adds to it, until anything else writes it, a branch's
  // target is reached, or a call is made
  const known = new Map(), landed = new Set(), lines = [];
  for (let at = start; at + 4 <= end; at += 4) {
    const word = wordAt(at), found = decode(word, at);
    if (found?.to !== undefined && !found.call) landed.add(found.to);
    lines.push({ address: at, word, found });
  }
  return lines.map(({ address, word, found }) => {
    if (landed.has(address)) known.clear();
    if (!found) return { address, word, text: `.4byte  0x${hex(word)}`, note: word ? 'not an instruction' : '' };
    const notes = [];
    if (found.to !== undefined && (targets || !found.call)) notes.push(nameOf(found.to) ?? (found.call ? 'no function of the code map starts there' : null));
    else if (found.call && found.to !== undefined) notes.push('a call the console writes the target of as it loads the module');
    let made = null;
    if (found.name === 'lis') made = { register: found.rd, value: (found.uimm << 16) >>> 0 };
    else if (ADDS.has(found.op) && found.ra && known.has(found.ra)) made = { register: found.rd, value: (known.get(found.ra) + found.simm) >>> 0 };
    else if (ORS.has(found.op) && known.has(found.rd)) made = { register: found.ra, value: (known.get(found.rd) | found.uimm) >>> 0 };
    else if (REACHES(found.op) && found.ra && known.has(found.ra)) {
      const place = (known.get(found.ra) + found.simm) >>> 0;
      notes.push(`0x${hex(place)}${nameOf(place) ? ` ${nameOf(place)}` : ''}`);
    }
    if (made && found.name !== 'lis') notes.push(`0x${hex(made.value)}${nameOf(made.value) ? ` ${nameOf(made.value)}` : ''}`);
    // what this instruction writes no longer holds what was known: its first register, or for the logic instructions
    // with a number, its second
    const writes = found.op >= 24 && found.op <= 29 ? found.ra : found.op === 31 || found.op === 14 || found.op === 15 || found.op === 7 || found.op === 8 || found.op === 12 || found.op === 13 || (found.op >= 32 && found.op <= 43) ? found.rd : null;
    if (writes !== null) known.delete(writes);
    if (found.op === 31) known.delete(found.ra);
    if (made) known.set(made.register, made.value);
    // what a call leaves isn't known after it, but in the registers a function keeps, r14 up
    if (found.call) for (const register of [...known.keys()]) if (register < 14) known.delete(register);
    return { address, word, text: found.text, note: notes.filter(Boolean).join('; ') };
  });
}

/**
 * What read prints for a GameCube game: { key, text, has }, with `key` what its file is kept by, the address it
 * starts at, with its module's name for one in a module, and `has` whether something a note is about is in what it read.
 */
export async function readGamecube({ game, what, original, codeMap, copy, flags }) {
  for (const flag of ['arm', 'thumb', 'frame', 'rsp', 'mode', 'spc']) {
    if (flags[flag] !== undefined) throw new Error(`--${flag} isn't for a GameCube game: on the GameCube, read takes --bytes <n>.`);
  }
  const { address, program, label } = gamecubeResolve(game, codeMap, what);
  const code = await gamecubeDisc(copy.path);
  const here = f => (f.program ?? null) === program && !f.bytes;
  let sections, found, whereText;
  if (program) {
    const module = code.programs.find(each => each.path === program);
    if (!module) throw new Error(`${original.name} has no module called ${program} on its disc.`);
    sections = relOf(module.bytes).sections.filter(s => s.code && s.at).map(s => ({ address: s.at, bytes: module.bytes.subarray(s.at, s.at + s.size) }));
    found = () => findRelFunctions(module.bytes);
    whereText = ` of ${program}`;
  } else {
    sections = codeOf(code.boot).sections;
    found = () => findFunctions(code.boot);
    whereText = '';
  }
  const section = sections.find(s => address >= s.address && address < s.address + s.bytes.length);
  if (!section) throw new Error(`0x${hex(address)} isn't in the code${whereText || ` of the program ${original.name} boots`}, which is at ${sections.map(s => `0x${hex(s.address)} to 0x${hex(s.address + s.bytes.length)}`).join(', ')}.`);
  const functions = codeMap.functions.filter(here);
  const mapped = functions.find(f => address >= f.address && address < f.address + f.size);
  const traced = mapped ? null : found().find(f => address >= f.address && address < f.address + f.size);
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
  const nameOf = at => (starts.has(at) ? starts.get(at).name ?? (program ? `0x${hex(at)}@${program}` : `fn_${hex(at)}`) : null);
  const end = Math.min(start + length, section.address + section.bytes.length);
  const lines = listingOf({ wordAt: at => section.bytes.readUInt32BE(at - section.address), start, end, nameOf, targets: !program });
  const name = !mapped ? `0x${hex(start)}${whereText}` : mapped.address === start ? `${nameOf(start)}, at 0x${hex(start)}${whereText},` : `0x${hex(start)}${whereText}, inside ${nameOf(mapped.address)},`;
  const head = [
    `${name} in ${original.name}: ${extent}.`,
    ...(label ? [label] : []),
    ...(address !== start ? [`0x${hex(address)} is inside it.`] : []),
    program
      ? 'Each line is where the word is in the module\'s file, the word there and the instruction it makes, as the tools\' own decoder reads the console\'s processor (tools/gamecube/ppc.mjs). A module is loaded wherever the console has room, so a call in it names no target until then. tools/README.md, Reading the original\'s instructions, explains them.'
      : 'Each line is an address, the word there and the instruction it makes, as the tools\' own decoder reads the console\'s processor (tools/gamecube/ppc.mjs). A branch goes at once: this processor has no delay slot. After a semicolon comes the code map\'s name of where a call or a branch goes, and the address a lis and what\'s added to it make. tools/README.md, Reading the original\'s instructions, explains them.',
  ];
  const has = about => {
    try {
      const at = gamecubeResolve(game, codeMap, about);
      return (at.program ?? null) === program && at.address >= start && at.address < start + length;
    } catch {
      return false;
    }
  };
  const written = lines.map(line => `${hex(line.address)}:  ${hex(line.word)}  ${line.text}${line.note ? `  ; ${line.note}` : ''}`);
  const key = program ? `${hex(start)}@${program.replace(/[^A-Za-z0-9_.-]/g, '_')}` : hex(start);
  return { key, text: [...head, '', ...written, ''].join('\n'), has };
}
