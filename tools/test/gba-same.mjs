// npm run test:gba-same -- --write <file>, or --compare <file>...: the Game Boy Advance's compiler gives the same bytes
// on every computer the tools run on. Each computer builds agbcc itself, from the same source, with its own C compiler
// (../gba/agbcc.mjs), and a compiler of the 1990s can lean on the computer that built it: how wide a `long` is, which is
// 32 bits on Windows and 64 on Linux and a Mac, whether a `char` has a sign, which it hasn't on Linux on an ARM chip,
// how a number is rounded. match's proof is only as good as the bytes it builds, and the function check's and the
// console's stack's are only as good as agbcc's stack map, so a proof made on one computer has to be one on another.
//
// --write builds, with agbcc and old_agbcc, every C file of the project's own Game Boy Advance programs that the tests
// build as cartridges; every file of the shared libraries in the kit, with the compiler their library.json names; and
// every file of each game's version in C whose original.json names a compiler, with the one match builds it with. It
// writes a hash of each: of the assembly agbcc wrote, and of the stack map read from it with its debugging lines, for
// the project's programs and for a version that compares the work memory, as the build reads one (../gba/stack.mjs).
// --compare reads such files, one from each computer of the Game Boy Advance's workflow
// (.github/workflows/gba.yml), and fails on any file that came out differently on one, or built on one and not
// another. Nothing from any game's copy is needed: a game's C is in the repository.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { keptVersions, readOriginal } from '../lib/proof-files.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { libraryIds, readLibrary } from '../lib/libraries.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { compileFile, compilerAt, readCompiler } from '../gba/match.mjs';
import { stackOfFile } from '../gba/stack.mjs';

// the project's own programs, each folder's C built as the tests build it into a cartridge
const PROGRAMS = ['match', 'twin', 'same-memory', 'rebuild', 'stack'].map(folder => join(REPO, 'tools', 'test', folder));
// files of those folders a test builds only as a Dreamport, on the kit, never with agbcc
const DREAMPORT_ONLY = new Set(['same-memory/main.c', 'same-memory/rom.c']);
// each compiler with the flags games of the time were built with: those the tests build with, and those the kit's sound
// library was built with, as old_agbcc has no -fprologue-bugfix
const WAYS = [{ name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] }, { name: 'old_agbcc', flags: ['-mthumb-interwork', '-O2'] }];
const WORK = join(LOCAL, 'tmp', 'gba-same');
const USAGE = 'Usage: node tools/test/gba-same.mjs --write <file> | --compare <file> <file>...';

const inRepo = path => relative(REPO, path).split(sep).join('/');
const hashOf = text => createHash('sha1').update(text).digest('hex').slice(0, 16);
// what went wrong, as it reads on any computer: no folder of this one in it, and Windows' line ends and slashes as
// Linux's
const said = text => text.replaceAll(REPO, '').replace(/\r\n/g, '\n').replaceAll('\\', '/');

// the builds of a --write's file in three groups: the project's own programs, the kit's libraries and the games' C
const GROUPS = [['The project\'s own programs', 'tools/'], ['The kit\'s libraries', 'kit/'], ['The games\' C', 'games/']];
const groups = found => GROUPS.map(([what, start]) => [what, Object.keys(found.built).filter(key => key.startsWith(start))]);
const builtWell = entry => !entry.assembly.startsWith("didn't") && !entry.stack?.startsWith('no stack');

// Every file to build, once each: { file, compiler, root, includes, stack }, where `stack` says whether its stack map
// is read too.
function filesToBuild() {
  const builds = new Map();
  const add = (file, compiler, root, includes, stack) => {
    const key = `${inRepo(file)} ${compiler.name} ${compiler.flags.join(' ')}`;
    if (!builds.has(key)) builds.set(key, { key, file, compiler, root, includes, stack });
  };
  for (const folder of PROGRAMS) {
    for (const name of readdirSync(folder).filter(name => name.endsWith('.c')).sort()) {
      if (DREAMPORT_ONLY.has(`${relative(join(REPO, 'tools', 'test'), folder).split(sep).join('/')}/${name}`)) continue;
      for (const compiler of WAYS) add(join(folder, name), compiler, folder, [folder], true);
    }
  }
  // the kit's shared libraries, built from their own folder alone, as in every game that takes one
  for (const id of libraryIds()) {
    const library = readLibrary(id);
    const given = library.compilers?.gba;
    if (!given) continue;
    const compiler = readCompiler({ compiler: given }, `${inRepo(library.folder)}/library.json`);
    for (const file of library.files) add(file, compiler, library.folder, [library.folder], true);
  }
  // each game's version in C, its files each with the compiler match builds it with
  for (const version of keptVersions()) {
    if (writtenIn(versionOf(version).language) !== 'c') continue;
    const original = readOriginal(version);
    if (original.console !== 'gba' || !original.compiler) continue;
    const compiler = readCompiler(original, `games/${versionOf(version).game}/proof/original.json`);
    const { folder, files, twinsOf, libraries } = versionTwins(version);
    const ofLibrary = new Set(libraries.flatMap(library => library.files));
    const src = existsSync(join(folder, 'src')) ? [join(folder, 'src')] : [];
    for (const file of files) {
      if (ofLibrary.has(file)) continue;
      const ways = new Map(twinsOf.get(file).filter(twin => twin.address !== null).map(twin => compilerAt(compiler, twin.address))
        .map(way => [`${way.name} ${way.flags.join(' ')}`, way]));
      add(file, ways.size === 1 ? [...ways.values()][0] : compilerAt(compiler, -1), folder, [dirname(file), ...src], Boolean(original.workMemory));
    }
  }
  return [...builds.values()];
}

async function write(file) {
  const builds = filesToBuild();
  const needed = [...new Set(builds.map(build => build.compiler.name))].filter(name => !isCompilerBuilt(name));
  if (needed.length) withBuildTools(console.log, tools => buildCompilers(needed, console.log, tools));
  rmSync(WORK, { recursive: true, force: true });
  const found = { computer: `${process.platform} ${process.arch}`, built: {} };
  let n = 0;
  for (const { key, file, compiler, root, includes, stack } of builds) {
    const work = join(WORK, String(++n));
    const built = await compileFile({ file, root, includes, compiler, work });
    const entry = { assembly: built.error ? `didn't build: ${said(built.error)}` : hashOf(built.assembly.replace(/\r\n/g, '\n')) };
    if (stack) {
      const map = await stackOfFile({ file, root, includes, compiler, work: `${work}-g` });
      entry.stack = map.error ? `no stack map: ${said(map.error)}` : hashOf(JSON.stringify(map));
    }
    found.built[key] = entry;
  }
  rmSync(WORK, { recursive: true, force: true });
  writeFileSync(file, `${JSON.stringify(found, null, 1)}\n`);
  console.log(`agbcc on ${found.computer}:`);
  for (const [what, keys] of groups(found)) {
    const unbuilt = keys.filter(key => !builtWell(found.built[key])).length;
    console.log(`  ${what}: ${keys.length} builds${unbuilt ? `, ${unbuilt} of which don't build, which has to be the same everywhere too` : ''}`);
  }
  console.log(`Written: ${file}`);
}

function compare(files) {
  const [first, ...others] = files.map(file => JSON.parse(readFileSync(file, 'utf8')));
  const keys = Object.keys(first.built);
  console.log(`agbcc built on ${first.computer} and ${others.map(other => other.computer).join(', ')}, ${keys.length} builds`);
  const failures = [];
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
    if (!ok) failures.push(what);
  };
  check(PROGRAMS.every(folder => keys.some(key => key.startsWith(`${inRepo(folder)}/`) && builtWell(first.built[key]))), 'each of the project\'s own programs built, with its stack map');
  const [, kit] = groups(first)[1];
  check(kit.length > 0 && kit.every(key => builtWell(first.built[key])), 'every file of the kit\'s libraries built');
  for (const other of others) {
    const missing = keys.filter(key => !(key in other.built)), extra = Object.keys(other.built).filter(key => !(key in first.built));
    check(!missing.length && !extra.length, `the same files built on ${other.computer}${missing.length ? `; not built there: ${missing.join(', ')}` : ''}${extra.length ? `; built only there: ${extra.join(', ')}` : ''}`);
    const differing = keys.filter(key => key in other.built && JSON.stringify(other.built[key]) !== JSON.stringify(first.built[key]));
    for (const key of differing) {
      const [a, b] = [first.built[key], other.built[key]];
      const what = a.assembly !== b.assembly ? 'its assembly' : 'its stack map';
      console.log(`    ${key}: ${what} differs (${a.assembly !== b.assembly ? `${a.assembly} and ${b.assembly}` : `${a.stack} and ${b.stack}`})`);
    }
    check(!differing.length, `${keys.length - differing.length} of ${keys.length} the same on ${other.computer} as on ${first.computer}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
}

const [mode, ...files] = process.argv.slice(2);
if (mode === '--write' && files.length === 1) await write(files[0]);
else if (mode === '--compare' && files.length >= 2) compare(files);
else {
  console.error(USAGE);
  process.exit(1);
}
