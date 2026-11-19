// Finding a shared library (../lib/libraries.mjs) in a Game Boy Advance game, so a version can take it without anyone
// looking for each function by hand (#1510). A library's functions were built once by its maker and linked into each
// game as they were, so in every game they're the same bytes but where an address goes.
//
// A function the library's compiler rebuilds, as `match` proves it, is found by building the library's own C with
// that compiler, as `match` does, and comparing it with each function of the game's code map of the library's size,
// at every byte but the places a linker fills. What sits at those places in the copy then says where the game has
// everything the function calls and reads, so the version's libraries.json comes out whole. Nothing of any game is kept
// for it: what's compared is built here from the library's C.
//
// A function no compiler rebuilds, as a routine written in assembly, or a BIOS stub, has a short hash in its
// library.json instead: the first 16 digits of a SHA-1 of its bytes with every address masked, written from a version
// where it's proven by the same memory (`libraries <version> --hash`), and it's found by the same hash. Either way it
// only says where the function is: `match` or `twin` then proves it on the copy.

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { compileFile, readCompiler } from './match.mjs';

const CARTRIDGE = 0x08000000;
// the console's memories an address can be in, by its top byte: work RAM, I/O, colours, video memory, sprites and the cartridge
const POINTER = top => top >= 0x02 && top <= 0x09;

/** A function's bytes with every place an address can be zeroed: Thumb's calls, each a pair of halfwords, ARM's calls,
 *  and each word lined up on four that holds an address of the console, as a literal pool's do. */
export function masked(bytes) {
  const out = Buffer.from(bytes);
  for (let i = 0; i + 3 < out.length; i += 2) {
    const high = out.readUInt16LE(i), low = out.readUInt16LE(i + 2);
    if ((high & 0xF800) === 0xF000 && ((low & 0xF800) === 0xF800 || (low & 0xF800) === 0xE800)) {
      out.writeUInt32LE(0, i);
      i += 2;
    }
  }
  for (let i = 0; i + 3 < out.length; i += 4) {
    const word = out.readUInt32LE(i);
    if (POINTER(word >>> 24) || (word >>> 24) === 0xEB) out.writeUInt32LE(0, i);
  }
  return out;
}

/** A function's short hash, as a library's library.json keeps it: the first 16 digits of a SHA-1 of its masked bytes. */
export const shortHash = bytes => createHash('sha1').update(masked(bytes)).digest('hex').slice(0, 16);

/**
 * A library's twins as its compiler builds them, each written function by name: { bytes, places }, `places` each
 * { at, kind, name, addend, local } where a linker fills an address, `local` for a label of the file's own code that
 * isn't one of its functions. And
 * `errors`, what kept a file from building. Built in .dreamports/libraries/.
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
    const { made } = built, code = made.sections['.text'].bytes;
    const own = [...made.symbols].filter(([, symbol]) => symbol.section === '.text' && symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
    own.forEach((f, i) => {
      const length = made.sizes.get(f.name) ?? (own[i + 1]?.at ?? code.length) - f.at;
      const places = made.relocations.filter(place => place.section === '.text' && place.at >= f.at && place.at < f.at + length)
        .map(place => {
          // a place in the file's own code is a label of its own, as a switch's table, unless it's one of its functions
          const symbol = made.symbols.get(place.name);
          return { at: place.at - f.at, kind: place.kind, name: place.name, addend: place.addend ?? 0, local: symbol?.section === '.text' && !symbol.function };
        });
      functions.set(`${file}\n${f.name}`, { bytes: Buffer.from(code.subarray(f.at, f.at + length)), places });
    });
  }
  return { functions, errors };
}

// where a Thumb call at `address`, its two halfwords `high` and `low`, goes
const callTarget = (address, high, low) => {
  const offset = (((high & 0x7FF) << 12) | ((low & 0x7FF) << 1)) << 9 >> 9;
  return address + 4 + offset;
};

/**
 * Where the copy `rom` has a library's functions, of those in `files`, a variant's: { functions, values, missing },
 * `functions` and `values` Maps of each name to its address, as a version's libraries.json gives them, and `missing`
 * each function not found, { name, why }. `built` is what builtLibrary made of it, or null without a compiler, and
 * `codeMap` the game's. A function is taken only where one function of the code map has the library's size and its
 * bytes, or its hash, and where every address its places give agrees with the others.
 */
export function findLibrary({ library, files, built, rom, codeMap }) {
  const starts = codeMap.functions.filter(f => !f.bytes && f.address >= CARTRIDGE && f.address - CARTRIDGE + f.size <= rom.length);
  const bytesAt = (address, size) => rom.subarray(address - CARTRIDGE, address - CARTRIDGE + size);
  const wanted = library.functions.filter(f => f.file && files.includes(f.file));
  const candidates = new Map(), missing = [];
  for (const f of wanted) {
    const twin = built?.functions.get(`${f.file}\n${f.name}`);
    const sized = starts.filter(each => each.size === f.size);
    let found = [];
    // a function with a short hash is one no compiler rebuilds, whatever the library's compiler gives for it (#1521)
    if (f.hash) found = sized.filter(each => shortHash(bytesAt(each.address, each.size)) === f.hash);
    else if (twin) {
      const skip = new Set(twin.places.flatMap(place => [0, 1, 2, 3].map(i => place.at + i)));
      found = sized.filter(each => {
        const theirs = bytesAt(each.address, each.size);
        for (let i = 0; i < each.size; i++) {
          if (skip.has(i)) continue;
          if ((i < twin.bytes.length ? twin.bytes[i] : 0) !== theirs[i]) return false;
        }
        return true;
      });
    } else {
      missing.push({ name: f.name, why: built ? 'it didn\'t build' : 'the library names no compiler for the Game Boy Advance, and it has no short hash' });
      continue;
    }
    if (!found.length) missing.push({ name: f.name, why: sized.length ? `none of the code map's ${sized.length} functions of its size is the same` : 'the code map has no function of its size' });
    else candidates.set(f.name, { f, twin, at: found.map(each => each.address) });
  }

  // first every function with one place it can be, then those another one's calls name
  const functions = new Map(), values = new Map(), problems = [];
  const give = (name, given, from) => {
    // a function's address kept as a value is odd, as Thumb code's is, and the version gives it as the code map does
    const map = candidates.has(name) ? functions : values, address = candidates.has(name) ? given & ~1 : given;
    const had = map.get(name);
    if (had === undefined) map.set(name, address);
    else if (had !== address) problems.push(`${name} is at 0x${had.toString(16).toUpperCase()} by one function and 0x${address.toString(16).toUpperCase()} by ${from}`);
  };
  for (const [name, { at }] of candidates) if (at.length === 1) functions.set(name, at[0]);
  for (let more = true; more;) {
    more = false;
    for (const [name, { twin }] of candidates) {
      if (!functions.has(name) || !twin) continue;
      const address = functions.get(name);
      for (const place of twin.places) {
        if (place.local || !place.name) continue;
        const where = address + place.at, word = rom.readUInt32LE(where - CARTRIDGE);
        if (place.kind === 'word') give(place.name, (word - place.addend) >>> 0, name);
        else {
          const target = callTarget(where, word & 0xFFFF, word >>> 16) - place.addend;
          const named = candidates.get(place.name);
          if (named && !functions.has(place.name) && named.at.includes(target)) {
            functions.set(place.name, target);
            more = true;
          } else give(place.name, named ? target : (target | 1) >>> 0, name);
        }
      }
    }
  }
  for (const [name, { at }] of candidates) {
    if (!functions.has(name)) missing.push({ name, why: `${at.length} functions of the code map are the same, and nothing says which` });
  }
  return { functions, values, missing, problems };
}

/** What builds a library on the Game Boy Advance: its compiler from its library.json, checked, or null for none. */
export function compilerOf(library) {
  const given = library.compilers.gba;
  return given ? readCompiler({ compiler: given }, `${library.id}'s library.json`) : null;
}

/**
 * Where the copy `rom` has `library`, with the game's `codeMap`: findLibrary's answer for the variant the copy has the
 * most functions of, with that `variant`, or null for a library with none, and `errors`, what didn't build.
 */
export async function find({ library, rom, codeMap, log = console.log }) {
  const compiler = compilerOf(library);
  if (compiler) {
    const { buildCompilers, isCompilerBuilt } = await import('./agbcc.mjs');
    const { withBuildTools } = await import('./build.mjs');
    if (!isCompilerBuilt(compiler.name)) withBuildTools(log, tools => buildCompilers([compiler.name], log, tools));
  }
  const built = compiler ? await builtLibrary(library, compiler) : null;
  let best = null;
  for (const [variant, files] of library.variants ?? new Map([[null, library.files]])) {
    const found = findLibrary({ library, files, built, rom, codeMap });
    if (!best || found.functions.size > best.functions.size) best = { ...found, variant };
  }
  return { ...best, errors: built?.errors ?? [] };
}
