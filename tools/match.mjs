// npm run dp -- match <version> [<file or function>] [--addresses <file>]: builds a Game Boy Advance game's C with the
// compiler the original was built with and compares each function with the original's bytes, saying for each "the
// same" or where it first differs, and a total. It's the strongest proof a twin has (docs/STANDARD.md): the same
// bytes are the same function. <version> is a game's version in C, such as sonic-advance/c. With a file, it builds
// that one, and with a function, an address or a name, the file that has its twin, and it keeps each of the original's
// instructions beside the twin's in .dreamports/match/, which the ignore rules keep out of commits.
//
// A function says which function of the original it's the twin of the way portmap reads it: the comment just above it
// names the address, as in `/** TaskCreate, 0x08001588: … */`, or its own name is a label, such as sub_8001588. The
// values and the functions it uses and doesn't define have addresses too: a twin in another file has its own, a name
// that is a label, such as gUnknown_03004C54, says it, and the rest are in the game's proof/addresses.json:
//
// {
//   "about": where the names come from,
//   "addresses": { "gTasks": "030006B0", ... }: each name's address in the copy, as the code keeps it, so a Thumb
//     function's is odd where its address is kept as a value
// }
//
// --addresses <file> adds another file of the same shape, for trying a file out before the game has its names. Which
// compiler built the original, and how it was asked, is the game's too, in proof/original.json:
// "compiler": { "name": "agbcc" or "old_agbcc", "flags": ["-mthumb-interwork", "-O2", ...] }.
//
// The original is reached only through the reader `read` uses (gba/read.c), and nothing of it is printed: what match
// prints is each function's name, address, length and how much of it differs.
//
// In a version that keeps its proofs (lib/proofs.mjs), each function found the same is kept there as proven by the
// same bytes, and one that differs loses that line. Only this tool and `twin` write them.
//
// A shared library the version takes (lib/libraries.mjs) is compared as the version's own files, at the addresses its
// proof/libraries.json gives, each file built from the library's folder alone with the compiler its library.json
// names, whichever game it's in.
//
// npm run dp -- match <version> --whole [--all] rebuilds the whole cartridge instead (lib/rebuild.mjs): every file
// built as above, each twin's bytes laid over the copy at its address, in memory only, and every byte of the code
// map's code compared, which finds what a function's own proof can't, as a function the code map missed. It prints
// totals and stretches, by address, and keeps no proof: it changes nothing.
//
// A PlayStation game's file is built and compared by ps1/match.mjs, with GCC 2.x and what Sony's assembler made of its
// assembly, and the same names and proofs. A PlayStation 2 game's is by ps2/match.mjs, with Sony's own compiler and
// assembler for the EE, built from Sony's source, and a Nintendo 64 game's by n64/match.mjs, with IDO, translated into
// C from its own programs and built on this computer (n64/ido.mjs).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { LOCAL, REPO } from './lib/paths.mjs';
import { cartridgeOf, hex, inBootProgram, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { versionOf, writtenIn } from '../src/lib/languages.mjs';
import { percentText, playedPercent } from '../src/lib/entries.mjs';
import { readCopy } from './gba/header.mjs';
import { READER, withBuildTools } from './gba/build.mjs';
import { ensureOriginal } from './gba/original.mjs';
import { buildCompilers, isCompilerBuilt } from './gba/agbcc.mjs';
import { addressFinder, compilerAt, matchFile, readCompiler, runIn, throughOf } from './gba/match.mjs';
import { readAddresses, versionTwins } from './lib/twins.mjs';
import { asksForProofs, keepProofs, keptText, originalMarks, stateOf } from './lib/proofs.mjs';
import { rebuildOf } from './lib/rebuild.mjs';
import { resolve } from './read.mjs';
import { CONSOLES } from './consoles.mjs';

const USAGE = 'Usage: npm run dp -- match <version> [<file or function>] [--addresses <file>]\n       npm run dp -- match <version> --whole [--all]';
const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');

export { readAddresses };

// what reads the original: the program `read` runs, asked for Thumb code with no list of functions, so every halfword
// comes back as it is. Each line is an address, one or two halfwords, or a word, and what mGBA's decoder makes of them.
function reader(copy) {
  return (address, bytes) => {
    const result = spawnSync(READER, [copy, '0', 'thumb', hex(address), String(bytes)], { input: '', encoding: 'utf8', maxBuffer: 64 << 20 });
    if (result.error || result.status !== 0) throw new Error(`mGBA's decoder didn't run: ${result.error?.message ?? result.stderr.trim()}`);
    const halfwords = [], lines = [];
    for (const line of result.stdout.split('\n')) {
      const m = /^[0-9A-F]{8}:\s+((?:[0-9A-F]{4,8} ?)+)\s*\t?(.*)$/.exec(line);
      if (!m) continue;
      for (const [i, token] of m[1].trim().split(' ').entries()) {
        const value = parseInt(token, 16);
        if (token.length === 8) halfwords.push(value & 0xFFFF, value >>> 16);
        else halfwords.push(value);
        lines.push(i ? '' : m[2].trim(), ...(token.length === 8 ? [''] : []));
      }
    }
    const buffer = Buffer.alloc(Math.min(bytes, halfwords.length * 2));
    for (let i = 0; i * 2 + 1 < buffer.length; i++) buffer.writeUInt16LE(halfwords[i], i * 2);
    return { bytes: buffer, lines };
  };
}

export async function run(args) {
  const rest = [];
  let more = null;
  const whole = args.includes('--whole'), every = args.includes('--all');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--addresses') {
      more = args[++i];
      if (!more) throw new Error(`--addresses needs a file. ${USAGE}`);
    } else if (['--whole', '--all'].includes(args[i])) continue;
    else if (args[i].startsWith('--')) throw new Error(`match has no ${args[i]}. ${USAGE}`);
    else rest.push(args[i]);
  }
  const [game, what] = rest;
  if (!game || rest.length > 2) throw new Error(USAGE);
  if (whole && (what || more)) throw new Error(`--whole rebuilds the whole cartridge from the version's own files and names, so it takes no file, function or --addresses. ${USAGE}`);
  if (every && !whole) throw new Error(`--all is for --whole, to list every stretch. ${USAGE}`);
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (original.console === 'ps1') return (await import('./ps1/match.mjs')).matchGame({ game, what, more, whole, original });
  if (original.console === 'ps2') return (await import('./ps2/match.mjs')).matchGame({ game, what, more, whole, original });
  if (original.console === 'n64') return (await import('./n64/match.mjs')).matchGame({ game, what, more, whole, original });
  if (original.console !== 'gba') throw new Error(`match knows the Game Boy Advance's and the PlayStation's compilers and no other console's yet (docs/CONSOLES.md).`);
  if (writtenIn(language) !== 'c') throw new Error(`match builds C: name a game's version in C, such as ${base}/c.`);
  const compiler = readCompiler(original, `games/${base}/proof/original.json`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`match compares with ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readCopy(copy.path))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);

  const sizes = new Map(codeMap.functions.filter(inBootProgram).map(f => [f.address, f.size]));
  // every twin of the version, by name, as a file calls the others' by theirs, and every name with an address
  const { folder, shifts, files, twinsOf, twins, named, libraries, givenOf } = versionTwins(game, more ? resolvePath(more) : null);
  // the shared library each of the version's files from the kit is of (lib/libraries.mjs)
  const libraryOf = new Map(libraries.flatMap(library => library.files.map(file => [file, library])));
  const addressOf = addressFinder({ named, twins, shifts, startsFunction: address => sizes.has(address) });

  // what to build: every file, the one named, or the one with the twin of the function named
  let chosen = files, only = null;
  if (what) {
    const file = [resolvePath(what), join(folder, what)].find(path => path.endsWith('.c') && existsSync(path));
    if (file) chosen = [file];
    else {
      const address = twins.get(what)?.size === 1 ? [...twins.get(what)][0] : resolve(game, codeMap, what).address;
      chosen = files.filter(path => twinsOf.get(path).some(twin => twin.address === address));
      if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${what}: the comment above it names the address, as in /** 0x${hex(address)}: what it does */.`);
      only = address;
    }
  }
  if (!chosen.length) {
    console.log(`games/${game}/ has no C yet.`);
    return 0;
  }
  // each file is built with the compiler that built the original's code its twins are the twins of: the game's, or a
  // stretch's (gba/match.mjs, compilerAt). A file whose twins were built two ways can't be built one way
  const builtWith = new Map(), mixed = new Map(), unbuilt = new Map();
  for (const file of chosen) {
    // a shared library is built as library.json says it was, whichever game it's in
    if (libraryOf.has(file)) {
      const { library } = libraryOf.get(file), given = library.compilers[original.console];
      if (given) builtWith.set(file, readCompiler({ compiler: given }, inRepo(join(library.folder, 'library.json'))));
      else unbuilt.set(file, library.id);
      continue;
    }
    const ways = new Map(twinsOf.get(file).filter(twin => twin.address !== null).map(twin => compilerAt(compiler, twin.address)).map(way => [`${way.name} ${way.flags.join(' ')}`, way]));
    if (ways.size > 1) mixed.set(file, [...ways.keys()]);
    builtWith.set(file, ways.size === 1 ? [...ways.values()][0] : compilerAt(compiler, -1));
  }
  const needed = [...new Set([...builtWith.values()].filter(Boolean).map(way => way.name))].filter(name => !isCompilerBuilt(name));
  if (needed.length) withBuildTools(console.log, tools => buildCompilers(needed, console.log, tools));
  ensureOriginal(console.log);

  const read = reader(copy.path);
  let same = 0, all = 0, sameBytes = 0, bytes = 0, kept = null;
  const failed = [];
  const unknown = new Set();
  // what goes in the version's proofs, when it keeps them (lib/proofs.mjs): each function of the code map tried
  const proven = [], differing = [];
  // with --whole, each twin built, for the cartridge rebuilt
  const laid = [];
  for (const file of chosen) {
    const library = libraryOf.get(file)?.library ?? null;
    const inside = library !== null || (!relative(folder, file).startsWith('..') && !isAbsolute(relative(folder, file)));
    const where = inside ? inRepo(file) : file;
    if (unbuilt.has(file)) {
      console.log(`${where}\n  Not compared: ${unbuilt.get(file)}'s library.json names no compiler for the ${CONSOLES[original.console].name}, which match needs to build it.`);
      continue;
    }
    if (mixed.has(file)) {
      console.log(`${where}\n  Not compared: its twins are of code the original built two ways, ${mixed.get(file).join(' and ')}, as original.json's compiler says, and a file is built one way. Put each way's twins in a file of its own.`);
      failed.push(`${where}: its twins are of code built two ways`);
      continue;
    }
    const compiler = builtWith.get(file);
    // a library's file is built from its own folder alone, as it's the same in every game that has it
    const result = await matchFile({
      file, compiler, shifts, addressOf, original: read, given: givenOf(file),
      root: library ? library.folder : inside ? folder : dirname(file),
      includes: library ? [library.folder] : [dirname(file), ...(inside && existsSync(join(folder, 'src')) ? [join(folder, 'src')] : [])],
      work: join(LOCAL, 'match', game, library ? join('lib', ...library.id.split('/'), basename(file, '.c')) : inside ? relative(folder, file).replace(/\.c$/, '') : join('elsewhere', relative(dirname(file), file).replace(/\.c$/, ''))),
      sizeOf: address => sizes.get(address) ?? null,
      runOf: (address, through) => runIn(codeMap.functions, address, through),
      // a shared library's twin names its run by its length, dp:run, as it names no address (#1727)
      runEnd: (address, bytes) => throughOf({ address, runBytes: bytes }, codeMap.functions),
    });
    if (result.error) {
      // all of what the compiler said for the file asked for, and for one of many the line that says what's wrong
      const said = result.error.split('\n');
      if (chosen.length === 1) console.log(`${where}\n  Didn't build with ${compiler.name}: ${said.join('\n  ')}`);
      failed.push(`${where}: ${said.find(line => /error/.test(line)) ?? said[0]}`);
      continue;
    }
    if (whole) {
      for (const f of result.functions) {
        if (f.address === null || f.elsewhere || (f.through !== null && !f.run)) continue;
        laid.push({ name: f.name, address: f.address, bytes: f.made, file: where, library: library?.id ?? null, run: f.run, calls: f.calls });
      }
      continue;
    }
    const shown = result.functions.filter(f => only === null || f.address === only);
    if (!shown.length) continue;
    console.log(where);
    for (const f of shown) {
      const at = f.address === null ? null : `0x${hex(f.address)}`;
      if (at === null) {
        if (library) console.log(`  No address  ${f.name}${f.line ? `, line ${f.line}` : ''}: games/${game}/proof/libraries.json gives ${library.id} none for it`);
        else console.log(`  No address  ${f.name}${f.line ? `, line ${f.line}` : ''}: the comment above it names the function of the original it's the twin of`);
        continue;
      }
      if (f.elsewhere) {
        console.log(`  Not compared  ${at} ${f.name}: match compares what's in the cartridge, and this is in the console's memory`);
        continue;
      }
      if (f.through !== null && !f.run) {
        console.log(`  Not compared  ${at} ${f.name}: its comment names a run to 0x${hex(f.through)}, and the code map's functions from ${at} to 0x${hex(f.through)} aren't one run, each starting where the one before ends`);
        continue;
      }
      all++;
      bytes += f.bytes;
      const unmapped = f.mapped ? '' : ', where the code map has no function starting';
      // a twin of a run proves, or fails, each function of it
      if (inside && f.mapped) for (const address of f.run ? f.run.map(each => each.address) : [f.address]) (f.same ? proven : differing).push({ key: hex(address), start: !f.same && !f.run && !f.missing.length ? f.first : 0 });
      const run = f.run ? `, the ${count(f.run.length)} functions to 0x${hex(f.through)} together` : '';
      if (f.same) {
        same++;
        sameBytes += f.bytes;
        // a twin longer than its function, whose bytes after it are the same as the functions after it, is one routine the
        // code map holds as several: only the first is proven until its comment names the run
        const more = !f.run && f.mapped && f.longer > 0 ? `, and its ${count(f.longer)} bytes after are the same as the code map's next functions: name them in its comment, as in 0x${hex(f.address)} to <the last one's address>, to prove them too` : '';
        console.log(`  The same  ${at} ${f.name}, ${count(f.bytes)} bytes${run}${unmapped}${more}`);
      } else {
        const length = f.longer > 0 ? `${f.longer} bytes longer` : f.longer < 0 ? `${-f.longer} bytes shorter` : 'the same length';
        const first = f.first < 0 ? '' : `, first at 0x${hex(f.address + f.first)}`;
        const missing = f.missing.length ? `, with no address for ${f.missing.join(', ')}` : '';
        console.log(`  Differs   ${at} ${f.name}${run}: ${count(f.differing)} of ${count(f.halfwords)} halfwords, ${length}${first}${missing}${unmapped}`);
      }
      for (const name of f.missing) unknown.add(name);
      if (only !== null) kept = listing(game, f, original.name);
    }
  }
  if (unknown.size) console.log(`No address for ${[...unknown].join(', ')}: give each in games/${base}/proof/addresses.json (tools/README.md, Matching the original's bytes).`);
  // a version written on the kit isn't written for the console's compiler, so one line says how many files weren't
  if (failed.length && chosen.length > 1) {
    console.log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build with the original's compiler, which builds only C written for it. The first is ${failed[0]}. Name a file to see all the compiler said of it.`);
  }
  if (whole) return wholeReport(game, { codeMap, copy, laid, all: every });
  console.log(`${count(same)} of ${count(all)} function${all === 1 ? '' : 's'} the same, ${count(sameBytes)} of ${count(bytes)} bytes.`);
  // a proof found with names from another file than the game's own isn't one the game can show again
  if (!asksForProofs(game)) {
    // a version made a part at a time keeps no proofs, and nothing is said of them
  } else if (more) console.log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else for (const line of keptText(game, keepProofs(game, { kind: 'bytes', proven, failed: differing.map(f => f.key), starts: differing.filter(f => f.start > 0).map(f => ({ key: f.key, bytes: f.start })) }), 'bytes')) console.log(line);
  if (kept) console.log(`Each of the original's instructions is beside the twin's in ${kept}. It comes from your copy of the game: never put it in a commit, an issue or a pull request. A coding agent that reads it sends it to the company that runs the agent's model.`);
  return 0;
}

// one function, the original's instructions beside the twin's, kept where commits never reach
function listing(game, f, name) {
  const cell = value => (value === null ? '    ' : value.toString(16).toUpperCase().padStart(4, '0'));
  const rows = f.ours.map((ours, i) => {
    const theirs = f.theirs[i];
    return `${ours.value === theirs.value ? ' ' : '!'} ${hex(f.address + i * 2)}  ${cell(theirs.value)} ${cell(ours.value)}  ${theirs.text.padEnd(34)} | ${ours.text}`;
  });
  const text = [
    `${f.name}, the twin of 0x${hex(f.address)} in ${name}: ${f.same ? 'the same bytes' : `${f.differing} of ${f.halfwords} halfwords differ`}.`,
    'Each line is an address, the original\'s halfword there and the twin\'s, the original\'s instruction as mGBA\'s decoder shows it, and the line the compiler wrote for the twin\'s. A line that differs starts with !.',
    '', ...rows, '',
  ].join('\n');
  const file = join(LOCAL, 'match', game, `${hex(f.address)}.txt`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return inRepo(file);
}

// --whole: the cartridge rebuilt from every twin built, compared with the copy, in memory only, and said as totals and
// stretches by address
function wholeReport(game, { codeMap, copy, laid, all }) {
  const states = new Map(stateOf(game, { codeMap, mark: originalMarks(game, codeMap) }).map(state => [state.key, state]));
  const result = rebuildOf({ functions: codeMap.functions, read: cartridgeOf(copy.path, 'gba'), laid, states });
  const bytes = n => `${count(n)} byte${n === 1 ? '' : 's'}`;
  const share = n => `, ${percentText(playedPercent(n, result.code))}`;
  const most = list => (all ? list : list.slice(0, 20));
  const more = list => (!all && list.length > 20 ? [`    and ${count(list.length - 20)} more: --all lists them.`] : []);
  const at = address => `0x${hex(address)}`;
  const span = s => (s.from === s.to ? at(s.from) : `${at(s.from)} to ${at(s.to)}`);
  console.log(`\nThe whole cartridge rebuilt: ${count(laid.length)} twins laid over your copy, in memory only, and ${bytes(result.code)} of the code map's code compared.`);
  console.log(`  The same:              ${bytes(result.same)}${share(result.same)}${result.libraries ? `, ${bytes(result.libraries)} of them from shared libraries` : ''}`);
  console.log(`  Proven another way:    ${bytes(result.another)}${share(result.another)}, by the same memory`);
  console.log(`  Padding:               ${bytes(result.padding)}, zeros after a twin that line up the next function on four bytes`);
  console.log(`  Differs:               ${bytes(result.differs)}${share(result.differs)}`);
  console.log(`  No twin:               ${bytes(result.none)}${share(result.none)}${result.unbuilt ? `, ${bytes(result.unbuilt)} of them of twins no build laid` : ''}${result.start ? `, ${bytes(result.start)} the cartridge's start, which the kit does in a Dreamport` : ''}`);
  if (result.made.functions) console.log(`  Made in work memory:   ${count(result.made.functions)} functions the game makes in its work memory, which aren't the cartridge's bytes, ${count(result.made.proven)} of them proven by the same memory`);
  if (result.differing.length) {
    console.log(`\nTwins that differ, each with the stretch from its first differing byte to its last:`);
    for (const s of most(result.differing)) console.log(`  ${span(s)}  ${s.name}, ${s.file}: ${bytes(s.bytes)} differ`);
    for (const line of more(result.differing)) console.log(line);
  }
  if (result.missing.length) {
    console.log(`\nCode no twin covers, the biggest first:`);
    for (const s of most(result.missing)) {
      const functions = s.functions.length === 1 ? `function ${at(s.functions[0])}` : `${count(s.functions.length)} functions from ${at(s.functions[0])}`;
      const why = s.start ? ', the cartridge\'s start' : s.unbuilt ? ', whose twin no build laid' : '';
      console.log(`  ${span(s)}  ${bytes(s.to - s.from + 1)}, ${functions}${why}`);
    }
    for (const line of more(result.missing)) console.log(line);
  }
  if (result.outside.length) {
    console.log(`\nOutside the code map: the code map missed a function or holds two as one, a comment names the wrong address, or two twins claim one function.`);
    const why = s => (s.why === 'no function' ? 'laid where no function of the code map starts' : s.why === 'past its end' ? 'laid past its function\'s end' : `laid over ${s.other}`);
    for (const s of most(result.outside)) console.log(`  ${span(s)}  ${s.name}, ${s.file}: ${bytes(s.bytes)} ${why(s)}`);
    for (const line of more(result.outside)) console.log(line);
  }
  if (result.calls.length) {
    console.log(`\nCalls to where no function of the code map starts: a function it missed, or a wrong address in addresses.json.`);
    for (const c of most(result.calls)) console.log(`  ${at(c.target)}  from ${c.name}, ${c.file}${c.inside !== undefined ? `, ${count(c.target - c.inside)} bytes into function ${at(c.inside)}` : ''}`);
    for (const line of more(result.calls)) console.log(line);
  }
  console.log(result.complete
    ? '\nEvery byte of the code map\'s code is rebuilt the same, proven another way or padding, with nothing outside it.'
    : '\nNot every byte of the code map\'s code is rebuilt yet: the lists above say where.');
  return 0;
}
