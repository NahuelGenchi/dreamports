// npm run dp -- libraries [<version>] [--check]: the shared libraries in the kit (lib/libraries.mjs), code a console's
// games share without having written it, written once as twins and taken by every version that has it (#1508).
//
// With nothing named it says, for each console with a library, how much of its known shared code is proven: every
// function in its libraries' library.json, counted by the size of the original's, and proven once its twin has a proof
// that still holds in a version that takes the library, as that version's proofs.json says (lib/proofs.mjs). The
// number can fall when a library is added, as it says how much of what's known is proven. With a version, it lists the
// libraries the version takes and where each of their functions stands.
//
// A proof never carries from one game to another: `match` and `twin` prove a library's function on each version's own
// copy, at the addresses its proof/libraries.json gives. What carries over is the C.
//
//   --check   changes nothing and fails when a library or a version's libraries.json breaks a rule, which `npm run
//             check` uses: a library has its NOTICE.md, every function its files define is in its library.json and
//             the other way round, it names no address of any game, its files' names are its own on each of its
//             consoles, and each function a version takes starts where its code map has one of the library's size.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { REPO } from './lib/paths.mjs';
import { hex, keptVersions, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { librariesFile, libraryIds, readLibrary, versionLibraries } from './lib/libraries.mjs';
import { asksForProofs, stateOf, stateText } from './lib/proofs.mjs';
import { cKit } from './lib/c.mjs';
import { twinsIn } from './gba/match.mjs';
import { nesNames } from './nes/functions.mjs';
import { NAME, BASES } from './portmap.mjs';
import { CONSOLES } from './consoles.mjs';
import { versionOf, writtenIn } from '../src/lib/languages.mjs';

const USAGE = 'Usage: npm run dp -- libraries [<version>] [--check]';
const count = n => n.toLocaleString('en');
const plural = (n, word, words = `${word}s`) => `${count(n)} ${n === 1 ? word : words}`;
const inRepo = path => relative(REPO, path).split(sep).join('/');
// a share, cut and never rounded up, as the two numbers are (docs/STANDARD.md)
const percent = (part, whole) => `${whole ? Math.floor((part / whole) * 10000) / 100 : 0}%`;

export async function run(args) {
  const check = args.includes('--check');
  const rest = args.filter(arg => arg !== '--check');
  for (const arg of rest) if (arg.startsWith('--')) throw new Error(`libraries has no ${arg}.\n${USAGE}`);
  if (rest.length > 1) throw new Error(USAGE);
  if (check) {
    const problems = checkLibraries();
    if (problems.length) throw new Error(problems.join('\n'));
    const ids = libraryIds(), taking = keptVersions().filter(version => existsSync(librariesFile(version)));
    console.log(`${plural(ids.length, 'shared library', 'shared libraries')} and the ${plural(taking.length, 'version')} that take${taking.length === 1 ? 's' : ''} them keep their rules.`);
    return 0;
  }
  if (rest.length) return showVersion(rest[0]);
  const consoles = sharedCode();
  if (!consoles.length) {
    console.log('The kit has no shared library yet (tools/README.md, Shared libraries).');
    return 0;
  }
  for (const each of consoles) {
    console.log(`${each.name}: ${summary(each)}.`);
    for (const library of each.libraries) console.log(`  ${library.id}  ${count(library.proven)} of ${plural(library.functions, 'function')} proven, ${library.versions.length ? `taken by ${library.versions.join(', ')}` : 'taken by no version yet'}`);
  }
  return 0;
}

/** A console's shared code in words, as `libraries` says it. */
export function summary(each) {
  return `${percent(each.provenBytes, each.bytes)} of its known shared code proven, ${count(each.provenBytes)} of ${count(each.bytes)} bytes and ${count(each.proven)} of ${plural(each.functions, 'function')}, in ${plural(each.libraries.length, 'library', 'libraries')}, taken by ${plural(each.versions, 'version')}`;
}

/**
 * Each console's shared code, for every console with a library, in kit/consoles.js's order: { id, name, libraries,
 * functions, bytes, proven, provenBytes, versions }, `libraries` each { id, functions, proven, versions }. A function
 * of a library is each twin library.json lists, once however many variants have its file, and it's proven when it
 * has a proof that holds in at least one version, of `versions`, that takes it. The original's side of a proof is
 * the copy's, which isn't here, so a proof counts by its twin's mark alone, as `proofs --check` counts it without one.
 */
export function sharedCode(versions = keptVersions()) {
  const libraries = libraryIds().map(readLibrary);
  const proven = new Set(), takenBy = new Map();
  const keyOf = (library, f) => `${library.id}\n${inRepo(f.file)}\n${f.name}`;
  for (const version of versions) {
    if (!existsSync(librariesFile(version))) continue;
    const taken = versionLibraries(version, readOriginal(version).console);
    for (const each of taken) takenBy.set(each.id, [...(takenBy.get(each.id) ?? []), version]);
    if (!asksForProofs(version)) continue;
    const states = new Map(stateOf(version, { mark: null }).map(state => [state.address, state]));
    for (const each of taken) {
      for (const [name, address] of each.functions) {
        const f = each.library.functions.find(one => one.name === name && each.files.includes(one.file));
        const state = states.get(address);
        if (f && state?.kind && !state.why) proven.add(keyOf(each.library, f));
      }
    }
  }
  const consoles = [];
  for (const id of Object.keys(CONSOLES)) {
    const own = libraries.filter(library => library.consoles.includes(id));
    if (!own.length) continue;
    const listed = own.map(library => ({
      id: library.id, functions: library.functions.length,
      proven: library.functions.filter(f => proven.has(keyOf(library, f))).length,
      bytes: library.functions.reduce((sum, f) => sum + f.size, 0),
      provenBytes: library.functions.filter(f => proven.has(keyOf(library, f))).reduce((sum, f) => sum + f.size, 0),
      versions: (takenBy.get(library.id) ?? []).filter(version => readOriginal(version).console === id),
    }));
    const sum = key => listed.reduce((total, library) => total + library[key], 0);
    consoles.push({
      id, name: CONSOLES[id].name, libraries: listed, functions: sum('functions'), bytes: sum('bytes'), proven: sum('proven'), provenBytes: sum('provenBytes'),
      versions: new Set(listed.flatMap(library => library.versions)).size,
    });
  }
  return consoles;
}

// one version's libraries, and where each of their functions stands
function showVersion(version) {
  const original = readOriginal(version);
  if (!existsSync(librariesFile(version))) {
    console.log(`${version} takes no shared library: its proof/libraries.json would say which (tools/README.md, Shared libraries).`);
    return 0;
  }
  const taken = versionLibraries(version, original.console);
  const states = asksForProofs(version) ? new Map(stateOf(version, { mark: null }).map(state => [state.address, state])) : null;
  for (const each of taken) {
    console.log(`${each.id}${each.variant ? `, variant ${each.variant}` : ''}: ${plural(each.functions.size, 'function')} in this copy, of the ${count(each.library.functions.filter(f => each.files.includes(f.file)).length)} it has`);
    for (const [name, address] of [...each.functions].sort((a, b) => a[1] - b[1])) {
      const state = states?.get(address);
      console.log(`  0x${hex(address)}  ${name}: ${!states ? 'its proofs aren\'t kept: the version is made a part at a time' : state ? stateText(state) : 'no function of the code map starts here'}`);
    }
  }
  return 0;
}

/** Every rule a library or a version's libraries.json breaks, as sentences, or none. */
export function checkLibraries(versions = keptVersions()) {
  const problems = [], libraries = [];
  for (const id of libraryIds()) {
    try {
      libraries.push(readLibrary(id));
    } catch (error) {
      problems.push(error.message);
    }
  }
  // the names of a library's files, which no other file a game of its console is built with may have, as the kit's
  // folders and every library's are all on its include path: the kit's own files first, then each library's
  const places = new Map(), kits = new Set();
  const place = (id, name, where) => {
    const key = `${id}\n${name}`;
    if (places.has(key) && places.get(key) !== where) problems.push(`${where} has the name of ${places.get(key)}, and both can be built into one game on the ${CONSOLES[id].name}: give the library's file a name of its own.`);
    else places.set(key, where);
  };
  for (const id of new Set(libraries.flatMap(library => library.consoles))) {
    for (const folder of cKit(id).folders) for (const name of existsSync(folder) ? readdirSync(folder) : []) if (/\.[ch]$/.test(name) && !kits.has(`${id}\n${name}`)) {
      kits.add(`${id}\n${name}`);
      places.set(`${id}\n${name}`, inRepo(join(folder, name)));
    }
  }
  for (const library of libraries) {
    const notice = join(library.folder, 'NOTICE.md');
    if (!existsSync(notice) || !readFileSync(notice, 'utf8').trim()) problems.push(`${inRepo(notice)} isn't there: each library has a notice that names each source its twins were written from, by repository and commit, or says it was written from nothing but the console's own code.`);
    const listed = new Map(library.functions.map(f => [`${f.file}\n${f.name}`, f]));
    for (const id of library.consoles) for (const name of readdirSync(library.folder).filter(each => /\.[ch]$/.test(each))) place(id, name, inRepo(join(library.folder, name)));
    for (const file of [...library.files, ...readdirSync(library.folder).filter(name => name.endsWith('.h')).map(name => join(library.folder, name))]) {
      const text = readFileSync(file, 'utf8');
      // a library names no address of any game: where its copy has each thing is the version's to say
      text.split('\n').forEach((line, i) => {
        const named = [...line.matchAll(NAME)].map(([name, , digits]) => [name, parseInt(digits, 16) & ~1]).filter(([, address]) => !BASES.has(address)).map(([name]) => name);
        if (library.consoles.includes('nes')) named.push(...nesNames(line, 32).map(([name]) => name));
        if (named.length) problems.push(`${inRepo(file)}:${i + 1} names ${named.join(', ')}, an address of a game: a library names none, and each version gives its own in its proof/libraries.json.`);
      });
      if (!file.endsWith('.c')) continue;
      for (const twin of twinsIn(text, [], new Map())) {
        if (twin.own) continue;
        if (!listed.has(`${file}\n${twin.name}`)) problems.push(`${inRepo(file)}:${twin.line} defines ${twin.name}, which ${inRepo(join(library.folder, 'library.json'))} doesn't list: every function of a library is a twin, with the size of the original's.`);
        listed.delete(`${file}\n${twin.name}`);
      }
    }
    for (const f of listed.values()) problems.push(`${inRepo(join(library.folder, 'library.json'))} lists ${f.name} in ${basename(f.file)}, which doesn't define it, or defines it static.`);
  }
  for (const version of versions) {
    if (!existsSync(librariesFile(version))) continue;
    const where = inRepo(librariesFile(version));
    if (writtenIn(versionOf(version).language) !== 'c') {
      problems.push(`${where}: a shared library is C, and ${version} isn't a version in C.`);
      continue;
    }
    let taken;
    try {
      taken = versionLibraries(version, readOriginal(version).console);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const codeMap = readCodeMap(version);
    const sizes = new Map((codeMap?.functions ?? []).filter(f => !f.bytes).map(f => [f.address, f.size]));
    for (const each of taken) {
      for (const [name, address] of each.functions) {
        const f = each.library.functions.find(one => one.name === name && each.files.includes(one.file));
        if (!sizes.has(address)) problems.push(`${where} gives ${each.id}'s ${name} 0x${hex(address)}, where the code map has no function starting.`);
        else if (sizes.get(address) !== f.size) problems.push(`${where} gives ${each.id}'s ${name} 0x${hex(address)}, where the code map's function is ${count(sizes.get(address))} bytes, and the library's is ${count(f.size)}: it isn't the library's function, or another variant's.`);
      }
    }
  }
  return problems;
}
