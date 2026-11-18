// Shared libraries (#1508): code a console's games share without having written it, as its maker's libraries, its
// sound drivers and its compiler's runtime, written once as twins in the kit and taken by every version that has it.
//
// A library is a folder in the kit: kit/<console>/c/lib/<name>/ for one console's games, such as kit/gba/c/lib/m4a/,
// or kit/c/lib/<name>/ for C several consoles' games share, as the C library every MIPS console has. Its id is
// <console>/<name> or c/<name>. Beside its C, its NOTICE.md names each source its twins were written from, by
// repository and commit, and library.json says what it holds:
//
// {
//   "about": what it is,
//   "consoles": ["n64", "ps1"]: the consoles whose games have it, for a library in kit/c/lib/ only,
//   "compilers": { "gba": { "name": "old_agbcc", "flags": ["-O2", ...] } }: what built it on each console, where
//     `match` can build it, as a game's proof/original.json gives its compiler,
//   "variants": { "a": ["engine.c", "mixer-a.c"], "b": [...] }: the files of each version of it there is, when
//     games have more than one; without it every .c file of the folder is the library,
//   "functions": [["SoundMain", 1172, "engine.c"], ...]: each of its twins, by its name, the size in bytes of the
//     original's function, as a code map has it, and its file, or null for a function of the library nobody has
//     written yet, its name from a public source, so what's known of the library is all counted
// }
//
// A twin in a library names no address and nothing of any game: it's named as the library's own function, and a
// version of it that differs is a file of its own. A version takes a library in its proof/libraries.json:
//
// {
//   "about": where the addresses come from,
//   "libraries": {
//     "gba/m4a": { "variant": "a", "at": { "SoundMain": "080976BC", "gMPlayTable": "0809B000" } }
//   }
// }
//
// `at` is where its copy has each of the library's functions, and each value its C names, as eight capital
// hexadecimal digits, the code map's keys: an address on the Game Boy Advance, an offset in the program on the NES.
// Every tool takes the library's twins as the version's own with those addresses: the build, the port map, `match`,
// `twin` and the proofs, so a library's function is proven on each version's own copy and never taken on trust.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPO, proofFolder } from './paths.mjs';
import { CONSOLES } from '../../kit/consoles.js';

export const LIBRARY = 'library.json';
export const LIBRARIES = 'libraries.json';
const KIT = join(REPO, 'kit');
// a library's name, as a folder's under kit/: lowercase letters and numbers, with single dashes between them
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VARIANT = /^[A-Za-z0-9][\w.-]*$/;
const C_NAME = /^[A-Za-z_]\w*$/;
const ADDRESS = /^[0-9A-F]{8}$/;
const inRepo = path => relative(REPO, path).split(sep).join('/');

/** A library's folder by its id: kit/<console>/c/lib/<name>/ for <console>/<name>, kit/c/lib/<name>/ for c/<name>. */
export function libraryFolder(id) {
  const [where, name, ...more] = String(id).split('/');
  if (more.length || !NAME.test(name ?? '') || (where !== 'c' && !Object.hasOwn(CONSOLES, where))) {
    throw new Error(`"${id}" isn't a library: a library is named <console>/<name>, as gba/m4a, or c/<name> for one in kit/c/lib/, with the name in lowercase letters, numbers and dashes.`);
  }
  return where === 'c' ? join(KIT, 'c', 'lib', name) : join(KIT, where, 'c', 'lib', name);
}

/** Every library in the kit, by id, in order. */
export function libraryIds(kit = KIT) {
  const under = (folder, prefix) => (existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : [])
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => `${prefix}/${entry.name}`);
  return [...under(join(kit, 'c', 'lib'), 'c'), ...Object.keys(CONSOLES).flatMap(id => under(join(kit, id, 'c', 'lib'), id))].sort();
}

/**
 * A library, read from its library.json and checked: { id, folder, about, consoles, compilers, files,
 * variants, functions }, `files` every .c file of its folder, `variants` a Map of each variant to its files or null,
 * and `functions` each { name, size, file }, files as full paths, and null for one nobody has written yet. Throws, saying what's wrong, when it isn't one.
 */
export function readLibrary(id) {
  const folder = libraryFolder(id), file = join(folder, LIBRARY), where = inRepo(file);
  if (!existsSync(file)) throw new Error(`${where} isn't there: each library in the kit says what it holds in its library.json (tools/README.md, Shared libraries).`);
  let found;
  try {
    found = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${where} can't be read: ${error.message}`);
  }
  const wrong = what => new Error(`${where} needs ${what} (tools/README.md, Shared libraries).`);
  if (typeof found?.about !== 'string' || !found.about.trim()) throw wrong('"about", what the library is');
  const [at] = id.split('/');
  let consoles = [at];
  if (at === 'c') {
    consoles = found.consoles;
    if (!Array.isArray(consoles) || !consoles.length || !consoles.every(each => Object.hasOwn(CONSOLES, each))) throw wrong(`"consoles", the consoles whose games have it, of those kit/consoles.js knows`);
  } else if (found.consoles !== undefined && JSON.stringify(found.consoles) !== JSON.stringify([at])) throw wrong(`no "consoles" but its own, ${at}, as its folder is that console's`);
  const compilers = found.compilers ?? {};
  if (typeof compilers !== 'object' || Array.isArray(compilers) || !Object.entries(compilers).every(([each, compiler]) => consoles.includes(each) && typeof compiler?.name === 'string' && Array.isArray(compiler.flags) && compiler.flags.every(flag => typeof flag === 'string'))) {
    throw wrong('"compilers" as { "<console>": { "name", "flags" } }, for consoles whose games have it');
  }
  const files = readdirSync(folder).filter(name => name.endsWith('.c')).sort();
  let variants = null;
  if (found.variants !== undefined) {
    if (typeof found.variants !== 'object' || Array.isArray(found.variants) || !Object.keys(found.variants).length) throw wrong('"variants" as { "<variant>": ["<file>.c", ...] }');
    variants = new Map();
    for (const [name, list] of Object.entries(found.variants)) {
      if (!VARIANT.test(name) || !Array.isArray(list) || !list.length || !list.every(each => files.includes(each))) throw wrong(`each variant with the .c files of its folder it's made of, and "${name}" isn't`);
      variants.set(name, [...new Set(list)].sort().map(each => join(folder, each)));
    }
  }
  if (!Array.isArray(found.functions)) throw wrong('"functions": [["<name>", <size>, "<file>.c"], ...], each of its twins');
  const functions = [], seen = new Set();
  for (const entry of found.functions) {
    const parts = Array.isArray(entry) ? entry : [], [name, size, own] = parts;
    if (parts.length !== 3 || !C_NAME.test(name ?? '') || !Number.isInteger(size) || size <= 0 || (own !== null && !files.includes(own))) {
      throw wrong(`each function as ["<name>", <size>, "<file>.c"], its name in C, the size in bytes of the original's, and a .c file of its folder, or null while nobody has written it, and ${JSON.stringify(entry)} isn't`);
    }
    if (seen.has(`${own}:${name}`)) throw wrong(`each function once, and ${name} in ${own} is there twice`);
    if (own === null ? functions.some(f => f.name === name) : seen.has(`null:${name}`)) throw wrong(`${name} once, written or not`);
    seen.add(`${own}:${name}`);
    functions.push({ name, size, file: own === null ? null : join(folder, own) });
  }
  return { id, folder, about: found.about, consoles, compilers, files: files.map(name => join(folder, name)), variants, functions };
}

/** Where a version keeps the libraries it takes. */
export const librariesFile = version => join(proofFolder(version), LIBRARIES);

/**
 * The libraries a version takes, from its proof/libraries.json, each { id, library, variant, files, functions,
 * values }: `library` as readLibrary gives it, `files` the .c files of the variant taken, `functions` a Map of each of
 * its twins in those files the version gives an address to that address, and `values` a Map of every other name
 * given one. None for a version without the file. `console` is the version's, which each library has to be for.
 */
export function versionLibraries(version, console) {
  const file = librariesFile(version), where = inRepo(file);
  if (!existsSync(file)) return [];
  let found;
  try {
    found = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${where} can't be read: ${error.message}`);
  }
  const wrong = what => new Error(`${where} needs ${what} (tools/README.md, Shared libraries).`);
  if (typeof found?.about !== 'string' || !found.about.trim()) throw wrong('"about", where its addresses come from');
  if (typeof found.libraries !== 'object' || found.libraries === null || Array.isArray(found.libraries)) throw wrong('"libraries": { "<console>/<library>": { "variant", "at": { "<name>": "<address>" } } }');
  const taken = [], named = new Map();
  for (const [id, entry] of Object.entries(found.libraries)) {
    const library = readLibrary(id);
    if (!library.consoles.includes(console)) throw new Error(`${where} takes ${id}, which is for ${library.consoles.map(each => CONSOLES[each].name).join(' and ')}, and this game is on the ${CONSOLES[console]?.name ?? console}.`);
    let files = library.files;
    if (library.variants) {
      if (!library.variants.has(entry?.variant)) throw wrong(`the "variant" of ${id} it takes, one of ${[...library.variants.keys()].join(', ')}`);
      files = library.variants.get(entry.variant);
    } else if (entry?.variant !== undefined) throw wrong(`no "variant" of ${id}, which has none`);
    const at = entry?.at;
    if (typeof at !== 'object' || at === null || Array.isArray(at) || !Object.entries(at).every(([name, address]) => C_NAME.test(name) && typeof address === 'string' && ADDRESS.test(address))) {
      throw wrong(`"at" for ${id}: { "<name>": "<address>" }, each address as eight capital hexadecimal digits, as the code map's keys`);
    }
    const twins = new Set(library.functions.filter(f => files.includes(f.file)).map(f => f.name));
    const functions = new Map(), values = new Map();
    for (const [name, address] of Object.entries(at)) {
      if (named.has(name)) throw wrong(`each name once, and ${name} is given by ${named.get(name)} and ${id}`);
      named.set(name, id);
      (twins.has(name) ? functions : values).set(name, parseInt(address, 16));
    }
    taken.push({ id, library, variant: entry.variant ?? null, files, functions, values });
  }
  return taken;
}
