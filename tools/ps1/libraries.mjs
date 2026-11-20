// Finding a shared library (../lib/libraries.mjs) in a PlayStation game, as ../gba/libraries.mjs does on the Game Boy
// Advance: Sony's libraries were built once and linked into each game as they were, so in every game a function of
// theirs is the same instructions but where the linker put an address.
//
// A function the library's compiler rebuilds is found by building the library's own C as `match` does (match.mjs:
// GCC, maspsx and the tools' assembler) and comparing it with each function of the program the disc boots of the
// library's size, at every bit but those a linker fills: the 26 bits of a jump's target, the 16 bits of half an
// address or of a distance from $gp, a whole word an address is. What sits in those bits in the copy then says where
// the game has everything the function calls and reads, so the version's libraries.json comes out whole. Nothing of
// any game is kept for it, as what's compared is built here from the library's C.
//
// A function no compiler rebuilds, as Sony's calls into the BIOS written in assembly, has a short hash in its
// library.json instead, written from a version where it's proven by the same memory, and is found by it: the first 16
// digits of a SHA-1 of its bytes with every place an address can be masked, as below.

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { inBootProgram } from '../lib/proof-files.mjs';
import { compileFile, readCompiler } from './match.mjs';
import { exeOf } from './functions.mjs';
import { gpOf } from './twin.mjs';

const op = word => word >>> 26, rs = word => (word >>> 21) & 31, rt = word => (word >>> 16) & 31;
const GP = 28;
// the instructions whose 16 bits can be half an address or a distance from $gp: addi, addiu, ori, the loads and
// stores, and the geometry processor's
const IMMEDIATE = new Set([0x08, 0x09, 0x0D, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x28, 0x29, 0x2A, 0x2B, 0x2E, 0x32, 0x3A]);
// of those, the ones that write their rt, which then holds a whole value
const WRITES = new Set([0x08, 0x09, 0x0D, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26]);
// the bits of a word a relocation leaves as they were
const KEPT = { hi16: 0xFFFF0000, lo16: 0xFFFF0000, gprel16: 0xFFFF0000, jump26: 0xFC000000, word32: 0 };

/**
 * A function's bytes with every place an address can be zeroed: a jump's target, the half an address LUI loads, the
 * 16 bits of an instruction that reads through a register a LUI set, or through $gp. It's the same in every game that
 * has the function, whatever addresses its linker gave it, which is all a short hash needs.
 */
export function masked(bytes) {
  const out = Buffer.from(bytes), high = new Set();
  for (let i = 0; i + 3 < out.length; i += 4) {
    const word = out.readUInt32LE(i), o = op(word);
    if (o === 2 || o === 3) out.writeUInt32LE((word & KEPT.jump26) >>> 0, i);
    else if (o === 0x0F) {
      out.writeUInt32LE((word & 0xFFFF0000) >>> 0, i);
      high.add(rt(word));
    } else if (IMMEDIATE.has(o)) {
      if (high.has(rs(word)) || rs(word) === GP) out.writeUInt32LE((word & 0xFFFF0000) >>> 0, i);
      if (WRITES.has(o)) high.delete(rt(word));
    }
  }
  return out;
}

/** A function's short hash, as a library's library.json keeps it: the first 16 digits of a SHA-1 of its masked bytes. */
export const shortHash = bytes => createHash('sha1').update(masked(bytes)).digest('hex').slice(0, 16);

/**
 * A library's twins as its compiler builds them, each written function by its file and name: { bytes, places },
 * `places` each { at, kind, name, addend, own } where a linker fills an address, `own` for a name of the file's own,
 * one of its labels or values, which a version gives no address. And `errors`, what kept a file from building. Built
 * in .dreamports/libraries/.
 */
export async function builtLibrary(library, compiler) {
  const functions = new Map(), errors = [];
  for (const file of library.files) {
    const work = join(LOCAL, 'libraries', ...library.id.split('/'), basename(file, '.c'));
    const built = await compileFile({ file, root: library.folder, includes: [library.folder], compiler, work });
    if (built.error) {
      errors.push(`${basename(file)}: ${built.error.split('\n')[0]}`);
      continue;
    }
    const { made } = built, text = made.sections.get('.text'), code = Buffer.from(text?.bytes ?? []);
    const named = new Set(made.functions.filter(f => f.section === '.text').map(f => f.name));
    for (const f of made.functions.filter(each => each.section === '.text')) {
      const places = (text?.relocations ?? []).filter(place => place.at >= f.at && place.at < f.at + f.size).map(place => {
        // a name the file defines is its own, unless it's one of its functions, which the version says where it is
        const symbol = made.symbols.get(place.symbol);
        return { at: place.at - f.at, kind: place.kind, name: place.symbol, addend: place.addend ?? 0, own: Boolean(symbol) && !named.has(place.symbol) };
      });
      functions.set(`${file}\n${f.name}`, { bytes: Buffer.from(code.subarray(f.at, f.at + f.size)), places });
    }
  }
  return { functions, errors };
}

/**
 * Where the program `exe`, a PS-X EXE, has a library's functions, of those in `files`, a variant's: { functions, values,
 * missing, problems }, `functions` and `values` Maps of each name to its address, as a version's libraries.json gives
 * them, `missing` each function not found, { name, why }, and `problems` where two of them say two places for one name.
 * `built` is what builtLibrary made of it, or null without a compiler, and `codeMap` the game's. A function is taken
 * only where one function of the code map has the library's size and its instructions, or its hash, and where every
 * address its places give agrees with the others.
 */
export function findLibrary({ library, files, built, exe, codeMap }) {
  const { load, text } = exeOf(exe), gp = gpOf(exe);
  const inside = (address, size) => address >= load && address + size <= load + text.length;
  const starts = codeMap.functions.filter(f => inBootProgram(f) && !f.bytes && inside(f.address, f.size));
  const wordAt = address => text.readUInt32LE(address - load);
  const wanted = library.functions.filter(f => f.file && files.includes(f.file));
  const candidates = new Map(), missing = [];
  for (const f of wanted) {
    const twin = built?.functions.get(`${f.file}\n${f.name}`);
    const sized = starts.filter(each => each.size === f.size);
    let found = [];
    // a function with a short hash is one no compiler rebuilds, whatever the library's compiler gives for it
    if (f.hash) found = sized.filter(each => shortHash(text.subarray(each.address - load, each.address - load + each.size)) === f.hash);
    else if (twin) {
      const kept = new Map(twin.places.map(place => [place.at, KEPT[place.kind] ?? 0]));
      found = sized.filter(each => {
        for (let i = 0; i < each.size; i += 4) {
          const ours = i + 4 <= twin.bytes.length ? twin.bytes.readUInt32LE(i) : 0, mask = kept.get(i) ?? 0xFFFFFFFF;
          if (((ours & mask) >>> 0) !== ((wordAt(each.address + i) & mask) >>> 0)) return false;
        }
        return true;
      });
    } else {
      missing.push({ name: f.name, why: built ? 'it didn\'t build' : 'the library names no compiler for the PlayStation, and it has no short hash' });
      continue;
    }
    if (!found.length) missing.push({ name: f.name, why: sized.length ? `none of the code map's ${sized.length} functions of its size is the same` : 'the code map has no function of its size' });
    // what a function found by its hash calls and reads isn't known from it, as what its compiler built isn't the copy's
    else candidates.set(f.name, { twin: f.hash ? null : twin, at: found.map(each => each.address) });
  }

  // first every function with one place it can be, then those another one's calls name
  const functions = new Map(), values = new Map(), problems = [];
  const give = (name, address, from) => {
    const map = candidates.has(name) ? functions : values, had = map.get(name);
    if (had === undefined) map.set(name, address >>> 0);
    else if (had !== address >>> 0) problems.push(`${name} is at 0x${had.toString(16).toUpperCase()} by one function and 0x${(address >>> 0).toString(16).toUpperCase()} by ${from}`);
  };
  for (const [name, { at }] of candidates) if (at.length === 1) functions.set(name, at[0]);
  for (let more = true; more;) {
    more = false;
    for (const [name, { twin }] of candidates) {
      if (!functions.has(name) || !twin) continue;
      const address = functions.get(name), halves = new Map();
      for (const place of twin.places) {
        if (place.own) continue;
        const where = address + place.at, word = wordAt(where), low = ((word & 0xFFFF) ^ 0x8000) - 0x8000, key = `${place.name}+${place.addend}`;
        if (place.kind === 'jump26') {
          const target = ((((where + 4) & 0xF0000000) | ((word & 0x3FFFFFF) << 2)) - place.addend) >>> 0;
          const named = candidates.get(place.name);
          if (named && !functions.has(place.name) && named.at.includes(target)) {
            functions.set(place.name, target);
            more = true;
          } else give(place.name, target, name);
        } else if (place.kind === 'hi16') halves.set(key, (word & 0xFFFF) << 16);
        else if (place.kind === 'lo16' && halves.has(key)) give(place.name, halves.get(key) + low - place.addend, name);
        else if (place.kind === 'gprel16' && gp) give(place.name, gp + low - place.addend, name);
        else if (place.kind === 'word32') give(place.name, word - place.addend, name);
      }
    }
  }
  for (const [name, { at }] of candidates) {
    if (!functions.has(name)) missing.push({ name, why: `${at.length} functions of the code map are the same, and nothing says which` });
  }
  return { functions, values, missing, problems };
}

/** What builds a library on the PlayStation: its compiler from its library.json, checked, or null for none. */
export function compilerOf(library) {
  const given = library.compilers.ps1;
  return given ? readCompiler({ compiler: given }, `${library.id}'s library.json`) : null;
}

/**
 * Where the copy, whose program the disc boots is `rom` (a PS-X EXE, as cartridgeOf's copy() gives it), has `library`,
 * with the game's `codeMap`: findLibrary's answer for the variant the copy has the most functions of, with that
 * `variant`, or null for a library with none, and `errors`, what didn't build.
 */
export async function find({ library, rom, codeMap }) {
  const compiler = compilerOf(library);
  const built = compiler ? await builtLibrary(library, compiler) : null;
  let best = null;
  for (const [variant, files] of library.variants ?? new Map([[null, library.files]])) {
    const found = findLibrary({ library, files, built, exe: rom, codeMap });
    if (!best || found.functions.size > best.functions.size) best = { ...found, variant };
  }
  return { ...best, errors: built?.errors ?? [] };
}
