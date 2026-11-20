// npm run dp -- libraries [<version>] [--find | --hash | --frames] [--shared <game> <game>] [--check]: the shared libraries in the kit (lib/libraries.mjs), code a console's
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
// Each console with tools for it finds a library in a new game itself (gba/libraries.mjs, nes/libraries.mjs):
//
//   --find    with a version, finds each library of its console in its copy and writes where in its
//             proof/libraries.json: a function the library's compiler rebuilds by building it and comparing every byte
//             but where an address goes, and one no compiler rebuilds by its short hash, as the library.json keeps it.
//             Then `match` and `twin` prove them on the copy, as any twin
//   --hash    with a version, writes into each library's library.json the short hash of every function the version
//             proves by the same memory and no version proves by the same bytes, as no compiler rebuilds it: the first
//             16 digits of a SHA-1 of the original's bytes with every address masked, which --find finds it by
//   --frames  with a version, assembles each routine of its libraries' tables of routines in assembly (library.json's
//             "frames") with the tools' own assembler, fills in each address as the version gives it, and compares the
//             routine with its copy's bytes: the same, or where it differs, which says the table is wrong for it, as
//             the original's instructions are what the console runs. ARM code the assembler leaves out isn't compared
//   --shared  lists the functions two games on this computer share, with every address masked, by each one's address
//             and size, as a code map has them, which is how a new library is found
//
//   --check   changes nothing and fails when a library or a version's libraries.json breaks a rule, which `npm run
//             check` uses: a library has its NOTICE.md, every function its files define is in its library.json and
//             the other way round, it names no address of any game, its files' names are its own on each of its
//             consoles, and each function a version takes starts where its code map has one of the library's size.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { REPO } from './lib/paths.mjs';
import { cartridgeOf, hex, inBootProgram, keptVersions, prepareCopy, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { librariesFile, LIBRARY, libraryIds, namesOnly, readLibrary, versionLibraries } from './lib/libraries.mjs';
import { asksForProofs, stateOf, stateText } from './lib/proofs.mjs';
import { cKit } from './lib/c.mjs';
import { twinsIn } from './gba/match.mjs';
import { nesNames } from './nes/functions.mjs';
import { namesOf } from './portmap.mjs';
import { CONSOLES } from './consoles.mjs';
import { versionOf, writtenIn } from '../src/lib/languages.mjs';
import { sharedText } from '../src/lib/shared-map.mjs';

const USAGE = 'Usage: npm run dp -- libraries [<version>] [--find | --hash | --frames] [--shared <game> <game>] [--check]';
// each console's way of finding a library in a game, for the consoles that have one
const FINDERS = { gba: './gba/libraries.mjs', nes: './nes/libraries.mjs', ps1: './ps1/libraries.mjs' };
const count = n => n.toLocaleString('en');
const plural = (n, word, words = `${word}s`) => `${count(n)} ${n === 1 ? word : words}`;
const inRepo = path => relative(REPO, path).split(sep).join('/');

export async function run(args) {
  const check = args.includes('--check'), finding = args.includes('--find'), hashing = args.includes('--hash'), sharing = args.includes('--shared'), framing = args.includes('--frames');
  const rest = args.filter(arg => !['--check', '--find', '--hash', '--shared', '--frames'].includes(arg));
  for (const arg of rest) if (arg.startsWith('--')) throw new Error(`libraries has no ${arg}.\n${USAGE}`);
  if (sharing) {
    if (rest.length !== 2) throw new Error(`--shared needs two games.\n${USAGE}`);
    return shared(rest[0], rest[1]);
  }
  if ((finding || hashing) && rest.length !== 1) throw new Error(`${finding ? '--find' : '--hash'} needs a version, such as sonic-advance/c.\n${USAGE}`);
  if (framing) {
    if (rest.length !== 1) throw new Error(`--frames needs a version, such as sonic-advance/c.\n${USAGE}`);
    return framesIn(rest[0]);
  }
  if (finding) return findIn(rest[0]);
  if (hashing) return hashIn(rest[0]);
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
    console.log(`${sharedText(each)}.`);
    for (const library of each.libraries) console.log(`  ${library.id}  ${count(library.proven)} of ${plural(library.functions, 'function')} proven, ${library.versions.length ? `taken by ${library.versions.join(', ')}` : 'taken by no version yet'}`);
  }
  return 0;
}

/** Where a library's function stands, best first: proven by the same bytes, by the same memory, written and not proven yet, not written yet. */
export const STATES = ['bytes', 'memory', 'written', 'unwritten'];

/**
 * Each console's shared code, for every console with a library, in kit/consoles.js's order: { id, name, libraries,
 * functions, bytes, proven, provenBytes, versions, games }, how many versions and games take its libraries, `libraries` each { id, functions, proven, bytes, provenBytes,
 * versions, cells }, `cells` each of its functions in library.json's order as { name, size, state }, one of STATES.
 * A function of a library is each one library.json lists, written or not, once however many variants have its file.
 * It's proven on a console when it has a proof that holds in at least one version on that console, of `versions`,
 * that takes it, as a library in kit/c/lib/ is built anew for each console. The original's side of a proof is the
 * copy's, which isn't here, so a proof counts by its twin's mark alone, as `proofs --check` counts it without one.
 */
export function sharedCode(versions = keptVersions()) {
  const libraries = libraryIds().map(readLibrary);
  const best = new Map(), takenBy = new Map();
  const keyOf = (id, library, f) => `${id}\n${library.id}\n${f.file ? inRepo(f.file) : ''}\n${f.name}`;
  for (const version of versions) {
    if (!existsSync(librariesFile(version))) continue;
    const id = readOriginal(version).console, taken = versionLibraries(version, id);
    for (const each of taken) takenBy.set(`${id}\n${each.id}`, [...(takenBy.get(`${id}\n${each.id}`) ?? []), version]);
    if (!asksForProofs(version)) continue;
    const states = new Map(stateOf(version, { mark: null }).map(state => [state.address, state]));
    for (const each of taken) {
      for (const [name, address] of each.functions) {
        const f = each.library.functions.find(one => one.name === name && each.files.includes(one.file));
        const state = states.get(address);
        if (!f || !state?.kind || state.why) continue;
        const key = keyOf(id, each.library, f);
        if (!best.has(key) || STATES.indexOf(state.kind) < STATES.indexOf(best.get(key))) best.set(key, state.kind);
      }
    }
  }
  const consoles = [];
  for (const id of Object.keys(CONSOLES)) {
    const own = libraries.filter(library => library.consoles.includes(id));
    if (!own.length) continue;
    const listed = own.map(library => {
      const cells = library.functions.map(f => ({ name: f.name, size: f.size, state: best.get(keyOf(id, library, f)) ?? (f.file ? 'written' : 'unwritten') }));
      const proven = cells.filter(cell => cell.state === 'bytes' || cell.state === 'memory');
      return {
        id: library.id, functions: cells.length, proven: proven.length, bytes: cells.reduce((sum, cell) => sum + cell.size, 0),
        provenBytes: proven.reduce((sum, cell) => sum + cell.size, 0), versions: takenBy.get(`${id}\n${library.id}`) ?? [], cells,
      };
    });
    const sum = key => listed.reduce((total, library) => total + library[key], 0);
    const versions = new Set(listed.flatMap(library => library.versions));
    consoles.push({
      id, name: CONSOLES[id].name, libraries: listed, functions: sum('functions'), bytes: sum('bytes'), proven: sum('proven'), provenBytes: sum('provenBytes'),
      versions: versions.size, games: new Set([...versions].map(version => versionOf(version).game)).size,
    });
  }
  return consoles;
}

// a console's way of finding a library in a game, or an error that says it has none yet
async function finderOf(id) {
  if (!FINDERS[id]) throw new Error(`The tools find a shared library in a game on ${Object.keys(FINDERS).map(each => `the ${CONSOLES[each].name}`).join(' and ')}, and on no other console yet (docs/CONSOLES.md).`);
  return import(FINDERS[id]);
}

// Each routine of the tables of routines in assembly a version's libraries keep (library.json's "frames"), assembled and
// compared with the version's copy, where the version says each is.
async function framesIn(version) {
  const { original, rom } = await copyOf(version);
  if (original.console !== 'gba') throw new Error('A library\'s table of routines in assembly is read on the Game Boy Advance only.');
  const { assemble } = await import('./gba/thumb.mjs');
  const { versionTwins } = await import('./lib/twins.mjs');
  const { named, twins, libraries } = versionTwins(version);
  const CARTRIDGE = 0x08000000;
  let tables = 0, differ = 0;
  for (const { library, functions } of libraries) {
    if (!library.frames) continue;
    tables++;
    const made = assemble(readFileSync(library.frames, 'utf8'));
    const code = Buffer.from(made.sections['.text'].bytes);
    const routines = [...made.symbols].filter(([, symbol]) => symbol.function && symbol.section === '.text').sort((a, b) => a[1].at - b[1].at);
    const addressOf = name => functions.get(name) ?? named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null);
    // where the copy has a place of the table: in the routine it's in, as far on from the routine's start
    const placeOf = at => {
      const owner = routines.filter(([, symbol]) => symbol.at <= at).at(-1);
      const start = owner ? addressOf(owner[0]) : null;
      return start === null ? null : (start & ~1) + at - owner[1].at;
    };
    for (const { at, kind, name, addend } of made.relocations) {
      const symbol = made.symbols.get(name);
      let target = symbol?.section === '.text' ? placeOf(symbol.at) : addressOf(name);
      if (target === null) continue;
      if (symbol?.function) target |= 1;
      target += addend;
      if (kind === 'word') code.writeUInt32LE(target >>> 0, at);
      else {
        const from = placeOf(at);
        if (from === null) continue;
        const jump = (target & ~1) - (from + 4);
        code.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
        code.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
      }
    }
    const left = new Set(made.unassembled.flatMap(each => Array.from({ length: each.bytes }, (_, k) => each.at + k)));
    console.log(`${library.id}, ${inRepo(library.frames)}:`);
    for (const [name, symbol] of routines) {
      const address = addressOf(name), size = made.sizes.get(name);
      if (address === null || size === undefined) {
        console.log(`  ${name}: ${address === null ? `${version} gives it no address` : 'its table gives it no .size'}, so it isn't compared`);
        continue;
      }
      const from = (address & ~1) - CARTRIDGE;
      let first = -1, skipped = 0;
      for (let k = 0; k < size; k++) {
        if (left.has(symbol.at + k)) skipped++;
        else if (first < 0 && code[symbol.at + k] !== rom[from + k]) first = k;
      }
      const arm = skipped ? `, and ${plural(skipped, 'byte')} of ARM code the assembler leaves out` : '';
      if (first < 0) console.log(`  0x${hex(address & ~1)}  ${name}: the same, ${plural(size - skipped, 'byte')}${arm}`);
      else {
        differ++;
        const at = first & ~1;
        console.log(`  0x${hex(address & ~1)}  ${name}: differs from +0x${at.toString(16)}, the table's ${code.readUInt16LE(symbol.at + at).toString(16).padStart(4, '0')} and the copy's ${rom.readUInt16LE(from + at).toString(16).padStart(4, '0')}${arm}`);
      }
    }
  }
  if (!tables) console.log(`None of the libraries ${version} takes has a table of routines in assembly.`);
  else if (differ) console.log(`${plural(differ, 'routine')} of the tables differ${differ === 1 ? 's' : ''} from the copy: the copy's instructions are the original's, so the table is wrong there.`);
  return differ ? 1 : 0;
}

// a game's copy on this computer, checked, as the tools read it: its bytes, or a PlayStation's program, and what reads
// `size` of them at an address
async function copyOf(version) {
  const original = readOriginal(version), copy = copyWith(original.sha1);
  if (!copy) throw new Error(`This reads ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  await prepareCopy(copy.path, original.console);
  const read = cartridgeOf(copy.path, original.console);
  return { original, rom: read.copy(), read };
}

/** A library.json's text, as the tools write it: each function on a line of its own, as proofs.json's are. */
export function formatLibrary(found) {
  const { functions = [], ...rest } = found;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  return `${head}${Object.keys(rest).length ? ',' : ''}\n  "functions": [\n${functions.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]\n}\n`;
}

// --find: each library of the version's console in its copy, written into its libraries.json
async function findIn(version) {
  const { original, rom } = await copyOf(version);
  if (writtenIn(versionOf(version).language) !== 'c') throw new Error(`A shared library is C: name a game's version in C, such as ${versionOf(version).game}/c.`);
  const finder = await finderOf(original.console), codeMap = readCodeMap(version);
  if (!codeMap) throw new Error(`games/${versionOf(version).game}/proof/ has no code map yet: npm run dp -- codemap ${versionOf(version).game} makes one.`);
  const file = librariesFile(version);
  const kept = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { about: '', libraries: {} };
  let any = false;
  // a library of names alone, with no twin written yet, has nothing to find by
  for (const library of libraryIds().map(readLibrary).filter(each => each.consoles.includes(original.console) && !namesOnly(each))) {
    const found = await finder.find({ library, rom, codeMap, version });
    const written = library.functions.filter(f => f.file && (found.variant === null || library.variants.get(found.variant).includes(f.file))).length;
    console.log(`${library.id}${found.variant ? `, variant ${found.variant}` : ''}: ${count(found.functions.size)} of ${plural(written, 'function')} found`);
    for (const [name, address] of [...found.functions].sort((a, b) => a[1] - b[1])) console.log(`  0x${hex(address)}  ${name}${found.unmatched?.has(name) ? ', placed by a call or its file\'s order: its instructions aren\'t the library\'s as built, and match says what differs' : ''}`);
    for (const { name, why } of found.missing) console.log(`  Not found   ${name}: ${why}`);
    for (const error of found.errors) console.log(`  Didn't build  ${error}`);
    for (const problem of found.problems) console.log(`  Doesn't agree  ${problem}`);
    if (!found.functions.size) continue;
    any = true;
    const at = [...found.functions, ...found.values].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([name, address]) => [name, hex(address)]);
    kept.libraries[library.id] = { ...(found.variant === null ? {} : { variant: found.variant }), at: Object.fromEntries(at) };
  }
  if (!any) {
    console.log(`No shared library of the ${CONSOLES[original.console].name}'s was found in ${original.name}, so ${inRepo(file)} is as it was.`);
    return 0;
  }
  kept.about = `Where ${original.name} has each shared library's functions and the values they name, as npm run dp -- libraries --find found them`;
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(`Written: ${inRepo(file)}. Next: npm run dp -- match ${version} proves each function on your copy, and npm run dp -- twin ${version} those match can't.`);
  return 0;
}

// --hash: the short hash of each function the version proves by the same memory alone, into its library's library.json
async function hashIn(version) {
  const { original, read } = await copyOf(version);
  const finder = await finderOf(original.console);
  if (!asksForProofs(version)) throw new Error(`${version} keeps no proofs, and a short hash is written only of a function proven by the same memory.`);
  const states = new Map(stateOf(version, { mark: null }).map(state => [state.address, state]));
  const best = new Map(sharedCode().filter(each => each.id === original.console).flatMap(each => each.libraries.flatMap(library => library.cells.map(cell => [`${library.id}\n${cell.name}`, cell.state]))));
  let written = 0;
  for (const each of versionLibraries(version, original.console)) {
    const file = join(each.library.folder, LIBRARY), found = JSON.parse(readFileSync(file, 'utf8'));
    let changed = false;
    for (const [name, address] of each.functions) {
      const state = states.get(address), entry = found.functions.find(([own, , path]) => own === name && path && each.files.includes(join(each.library.folder, path)));
      if (!entry || state?.kind !== 'memory' || state.why || best.get(`${each.id}\n${name}`) === 'bytes') continue;
      const hash = finder.shortHash(read(address, entry[1]));
      if (entry[3] === hash) continue;
      entry[3] = hash;
      changed = true;
      written++;
      console.log(`  ${each.id}  ${name}: ${hash}`);
    }
    if (changed) writeFileSync(file, formatLibrary(found));
  }
  console.log(written ? `${plural(written, 'short hash', 'short hashes')} written, of functions ${version} proves by the same memory and no version by the same bytes.` : `No function ${version} takes from a library is proven by the same memory alone without a short hash already.`);
  return 0;
}

// --shared: the functions two games share, with every address masked
async function shared(first, second) {
  const games = [];
  for (const game of [first, second]) games.push({ game, ...await copyOf(game), codeMap: readCodeMap(game) });
  if (games[0].original.console !== games[1].original.console) throw new Error(`${first} and ${second} are on two consoles, and a library is one console's.`);
  for (const { game, codeMap } of games) if (!codeMap) throw new Error(`games/${versionOf(game).game}/proof/ has no code map yet.`);
  const finder = await finderOf(games[0].original.console);
  const hashes = ({ codeMap, read }) => {
    const out = new Map();
    for (const f of codeMap.functions.filter(each => !each.bytes)) {
      const bytes = read(f.address, f.size);
      if (bytes.length !== f.size) continue;
      const key = `${f.size}\n${finder.shortHash(bytes)}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(f);
    }
    return out;
  };
  const [a, b] = games.map(hashes);
  const pairs = [];
  for (const [key, ours] of a) if (b.has(key)) pairs.push([ours, b.get(key)]);
  pairs.sort((x, y) => x[0][0].address - y[0][0].address);
  for (const [ours, theirs] of pairs) console.log(`  ${ours.map(f => `0x${hex(f.address)}`).join(' ')}  ${theirs.map(f => `0x${hex(f.address)}`).join(' ')}  ${count(ours[0].size)} bytes`);
  const bytes = pairs.reduce((sum, [ours]) => sum + ours[0].size, 0);
  console.log(`${plural(pairs.length, 'function')} of ${first} ${pairs.length === 1 ? 'is' : 'are'} in ${second} too, with every address masked, ${count(bytes)} bytes: each line is where ${first} has it, then where ${second} does, and its size.`);
  return 0;
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
    const listed = new Map(library.functions.filter(f => f.file).map(f => [`${f.file}\n${f.name}`, f]));
    for (const id of library.consoles) for (const name of readdirSync(library.folder).filter(each => /\.[ch]$/.test(each))) place(id, name, inRepo(join(library.folder, name)));
    for (const file of [...library.files, ...readdirSync(library.folder).filter(name => name.endsWith('.h')).map(name => join(library.folder, name)), ...(library.frames ? [library.frames] : [])]) {
      const text = readFileSync(file, 'utf8');
      // a library names no address of any game: where its copy has each thing is the version's to say
      text.split('\n').forEach((line, i) => {
        // each of its consoles' ways of naming an address, once each: the Game Boy Advance's for a console with none of its own
        const ways = [...new Map(library.consoles.map(id => namesOf(id)).map(way => [way.pattern, way])).values()];
        const named = [...new Set(ways.flatMap(({ pattern, bases, address }) => [...line.matchAll(pattern)].filter(([, , digits]) => !bases.has(address(digits))).map(([name]) => name)))];
        if (library.consoles.includes('nes')) named.push(...nesNames(line, 32).map(([name]) => name));
        if (named.length) problems.push(`${inRepo(file)}:${i + 1} names ${named.join(', ')}, an address of a game: a library names none, and each version gives its own in its proof/libraries.json.`);
      });
      if (!file.endsWith('.c')) continue;
      for (const twin of twinsIn(text, [], new Map())) {
        if (!listed.has(`${file}\n${twin.name}`)) problems.push(`${inRepo(file)}:${twin.line} defines ${twin.name}, which ${inRepo(join(library.folder, 'library.json'))} doesn't list: every function of a library is a twin, with the size of the original's.`);
        listed.delete(`${file}\n${twin.name}`);
      }
    }
    for (const f of listed.values()) problems.push(`${inRepo(join(library.folder, 'library.json'))} lists ${f.name} in ${basename(f.file)}, which doesn't define it, or defines it static.`);
  }
  // a short hash is kept only of a function no compiler rebuilds, which no version proves by the same bytes
  for (const each of problems.length ? [] : sharedCode(versions)) {
    for (const library of each.libraries) {
      const hashed = new Set(libraries.find(one => one.id === library.id).functions.filter(f => f.hash).map(f => f.name));
      for (const cell of library.cells) if (hashed.has(cell.name) && cell.state === 'bytes') problems.push(`${library.id}'s ${cell.name} has a short hash in its library.json, and a version proves it by the same bytes: a hash is kept only of a function no compiler rebuilds, so take it out.`);
    }
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
    const sizes = new Map((codeMap?.functions ?? []).filter(inBootProgram).map(f => [f.address, f.size]));
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
