// Finding a shared library (../lib/libraries.mjs) in an NES game (#1511). NES games were written by hand in the
// processor's own language, so no compiler rebuilds a library's bytes: a function is found by its short hash in its
// library.json, the first 16 digits of a SHA-1 of its bytes with every address in them masked, which `libraries
// <version> --hash` writes from a version where it's proven by the same memory. A developer's routine copied into
// another of its games is the same instructions, with its work memory and its calls somewhere else.
//
// What sits at the masked places in the new game then says where it keeps each value the library names, when another
// version that takes the library, and whose copy is on this computer, has the same function: the same instruction
// there names the same value. `twin` then proves each function on the new copy, as any twin.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { INSTRUCTIONS, LENGTH } from './6502.mjs';
import { nesProgram } from './functions.mjs';
import { copyWith } from '../lib/copies.mjs';
import { keptVersions, readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { librariesFile, versionLibraries } from '../lib/libraries.mjs';

// the addressing modes whose operand is an address: of the work memory's first page, one byte, or anywhere, two
const ZERO_PAGE = new Set(['zp', 'zpx', 'zpy', 'izx', 'izy']), WHOLE = new Set(['abs', 'abx', 'aby', 'ind']);

/** Each place in a function's bytes where an address goes, in the order its instructions have them: { at, bytes }. */
export function placesOf(bytes) {
  const places = [];
  for (let i = 0; i < bytes.length;) {
    const { mode } = INSTRUCTIONS[bytes[i]];
    if (ZERO_PAGE.has(mode) && i + 1 < bytes.length) places.push({ at: i + 1, bytes: 1 });
    else if (WHOLE.has(mode) && i + 2 < bytes.length) places.push({ at: i + 1, bytes: 2 });
    i += LENGTH[mode];
  }
  return places;
}

/** A function's bytes with every address in them zeroed. */
export function masked(bytes) {
  const out = Buffer.from(bytes);
  for (const { at, bytes: size } of placesOf(out)) out.fill(0, at, at + size);
  return out;
}

/** A function's short hash, as a library's library.json keeps it: the first 16 digits of a SHA-1 of its masked bytes. */
export const shortHash = bytes => createHash('sha1').update(masked(bytes)).digest('hex').slice(0, 16);

// the address at a place of a function's bytes
const valueAt = (bytes, { at, bytes: size }) => (size === 1 ? bytes[at] : bytes.readUInt16LE(at));

/**
 * Where an NES copy's program `prg` has a library's functions, of those in `files`: { functions, values, missing,
 * problems }, as the Game Boy Advance's findLibrary gives them. A function is taken where one function of `codeMap` has
 * its size and its hash. `references` are other versions that take the library, each { prg, functions, values }, whose
 * function of the same hash names its values at the same places, so each value it names is found here too.
 */
export function findLibrary({ library, files, prg, codeMap, references = [] }) {
  const starts = codeMap.functions.filter(f => !f.bytes && f.address + f.size <= prg.length);
  const functions = new Map(), values = new Map(), missing = [], problems = [];
  for (const f of library.functions.filter(each => each.file && files.includes(each.file))) {
    if (!f.hash) {
      missing.push({ name: f.name, why: 'it has no short hash yet: prove it by the same memory in a version that takes the library, then npm run dp -- libraries <that version> --hash' });
      continue;
    }
    const sized = starts.filter(each => each.size === f.size);
    const found = sized.filter(each => shortHash(prg.subarray(each.address, each.address + each.size)) === f.hash);
    if (found.length !== 1) {
      missing.push({ name: f.name, why: found.length ? `${found.length} functions of the code map have its hash, and nothing says which` : sized.length ? `none of the code map's ${sized.length} functions of its size has its hash` : 'the code map has no function of its size' });
      continue;
    }
    const address = found[0].address, ours = prg.subarray(address, address + f.size);
    functions.set(f.name, address);
    // each value a reference names at a place of the same function, at the same place here
    for (const reference of references) {
      const at = reference.functions.get(f.name);
      if (at === undefined) continue;
      const theirs = reference.prg.subarray(at, at + f.size);
      for (const place of placesOf(theirs)) {
        const was = valueAt(theirs, place);
        for (const [name, value] of reference.values) {
          if (value !== was) continue;
          const now = valueAt(ours, place), had = values.get(name);
          if (had === undefined) values.set(name, now);
          else if (had !== now) problems.push(`${name} is at $${had.toString(16).toUpperCase()} by one place and $${now.toString(16).toUpperCase()} by ${f.name}`);
        }
      }
    }
  }
  return { functions, values, missing, problems };
}

// the other versions on this computer that take a library and have their copy here, as references
function referencesFor(library, version) {
  const references = [];
  for (const other of keptVersions()) {
    if (other === version || !existsSync(librariesFile(other))) continue;
    let original;
    try {
      original = readOriginal(other);
    } catch {
      continue;
    }
    if (original.console !== 'nes') continue;
    const taken = versionLibraries(other, 'nes').find(each => each.id === library.id), copy = copyWith(original.sha1);
    if (!taken || !copy) continue;
    references.push({ prg: nesProgram(readFileSync(copy.path)).prg, functions: taken.functions, values: taken.values });
  }
  return references;
}

/** Where the NES copy `rom` has `library`, as the Game Boy Advance's find gives it, with `version` the version looked in. */
export async function find({ library, rom, codeMap, version }) {
  const prg = nesProgram(rom)?.prg;
  if (!prg) throw new Error('That copy isn\'t an NES game\'s.');
  const references = referencesFor(library, version);
  let best = null;
  for (const [variant, files] of library.variants ?? new Map([[null, library.files]])) {
    const found = findLibrary({ library, files, prg, codeMap, references });
    if (!best || found.functions.size > best.functions.size) best = { ...found, variant };
  }
  return { ...best, errors: [] };
}
