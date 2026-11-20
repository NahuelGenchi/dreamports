// What `npm run dp -- read` prints for a Nintendo 64 game (../read.mjs): one of the original's functions as the
// VR4300's instructions, read from the code the contributor's own cartridge starts (functions.mjs) by the tools' own
// decoder (../lib/mips.mjs), laid out as the PlayStation's are (../ps1/read.mjs). Each line is an address, the word there
// and the instruction it makes. A branch's delay slot is the line after it, and a likely branch runs it only when it
// goes. After a semicolon comes the code map's name of what a call, a jump or a branch goes to, and the address a `lui`
// makes with the instruction that adds to it, as the console's compilers build every address in two halves: that's the
// address the C of a twin names.
//
// With --rsp <address>, it reads the words there as the RSP's instructions instead, a microcode a game gives the RSP,
// which the game keeps among its own values, laid out from <address> in the RSP's 4 KB of instructions, 0x1080 for a
// game's microcode, which runs after the RSP's boot program, so where its branches and jumps go is where the RSP sends
// them.

import { hex } from '../lib/proof-files.mjs';
import { decode } from '../lib/mips.mjs';
import { listingOf, ps1Resolve } from '../ps1/read.mjs';
import { findFunctions, n64Cartridge, programOf } from './functions.mjs';

// how much is read when neither the code map nor the finder has the function, unless --bytes says
const SOME_BYTES = 256;
const RSP_CODE = 0x04001000;

/** The lines of `length` bytes of the code `cartridge` starts from `start`, as the VR4300's instructions, or with
 *  `rsp`, the RSP's, laid out from that address in its instruction memory: { address, word, text, note }. */
export function listing(cartridge, start, length, nameOf, rsp = null) {
  const { load, text } = programOf(cartridge);
  const end = Math.min(start + length, load + text.length);
  if (rsp === null) {
    return listingOf({ wordAt: at => text.readUInt32BE(at - load), start, end, decode: (word, at) => decode(word, at, 'vr4300'), nameOf, adds: ['addiu', 'ori', 'daddiu'] });
  }
  const shift = start - rsp;
  return listingOf({ wordAt: at => text.readUInt32BE(at + shift - load), start: rsp, end: rsp + (end - start), decode: (word, at) => decode(word, at, 'rsp'), nameOf: () => null });
}

/** Where --rsp says the first word runs in the RSP's instruction memory: 0x1080 or 0x04001080, on a word. */
function rspAddressOf(value) {
  const number = /^(?:0x)?([0-9a-f]+)$/i.exec(String(value))?.[1];
  const address = number === undefined ? NaN : parseInt(number, 16);
  const inside = address >= RSP_CODE && address < RSP_CODE + 0x1000 ? address : address >= 0x1000 && address < 0x2000 ? RSP_CODE + (address & 0xFFF) : NaN;
  if (Number.isNaN(inside) || inside % 4) throw new Error(`--rsp takes where the first word runs in the RSP's instructions, 0x1000 to 0x1FFC, on a word, such as 0x1080 for a game's microcode: ${value} isn't.`);
  return inside;
}

/**
 * What read prints for a Nintendo 64 game: { key, text, has }, with `key` the address it starts at, as the code map
 * writes it, and `has` whether something a note is about is in what it read.
 */
export async function readN64({ game, what, original, codeMap, copy, flags }) {
  for (const flag of ['arm', 'thumb', 'frame']) {
    if (flags[flag] !== undefined) throw new Error(`--${flag} is for a Game Boy Advance game: on the Nintendo 64, read takes --bytes <n> and --rsp <address>.`);
  }
  const cartridge = n64Cartridge(copy.path);
  const { load, text } = programOf(cartridge);
  const { address, label } = ps1Resolve(game, codeMap, what);
  if (address < load || address >= load + text.length) throw new Error(`0x${hex(address)} isn't in the code ${original.name}'s cartridge starts, which runs from 0x${hex(load)} to 0x${hex(load + text.length)}.`);
  const rsp = flags.rsp === undefined ? null : rspAddressOf(flags.rsp);
  const functions = codeMap.functions.filter(f => !f.bytes);
  const mapped = rsp === null ? functions.find(f => address >= f.address && address < f.address + f.size) : null;
  const traced = rsp === null && !mapped ? findFunctions(cartridge).find(f => address >= f.address && address < f.address + f.size) : null;
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
    extent = rsp === null ? `its first ${length} bytes, since the code map doesn't list it: --bytes <n> reads more` : `its first ${length} bytes: --bytes <n> reads more`;
  }
  const starts = new Map(functions.map(f => [f.address, f]));
  const nameOf = at => (starts.has(at) ? starts.get(at).name ?? `func_${hex(at)}` : null);
  const lines = listing(cartridge, start, length, nameOf, rsp);
  const name = !mapped ? `0x${hex(start)}` : mapped.address === start ? `${nameOf(start)}, at 0x${hex(start)},` : `0x${hex(start)}, inside ${nameOf(mapped.address)},`;
  const head = [
    `${name} in ${original.name}: ${extent}.`,
    ...(label ? [label] : []),
    ...(address !== start ? [`0x${hex(address)} is inside it.`] : []),
    rsp === null
      ? 'Each line is an address, the word there and the VR4300 instruction it makes, as the tools\' own decoder reads it (tools/lib/mips.mjs). A branch\'s delay slot is the line after it, and runs before the branch goes, or with a likely branch only when it goes. After a semicolon comes the code map\'s name of where a call or a branch goes, and the address a lui and what\'s added to it make. tools/README.md, Reading the original\'s instructions, explains them.'
      : `Each line is where the word runs in the RSP's instructions, from 0x${hex(rsp)} as --rsp says, the word, and the RSP instruction it makes, as the tools' own decoder reads it (tools/lib/mips.mjs). A branch's delay slot is the line after it. tools/README.md, Reading the original's instructions, explains them.`,
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
  return { key: rsp === null ? hex(start) : `${hex(start)}-rsp`, text: [...head, '', ...written, ''].join('\n'), has };
}
