// IDO, Silicon Graphics' compiler, which Nintendo's own Nintendo 64 games and many others were built with, for match
// on the Nintendo 64 (match.mjs). IDO's programs are MIPS code for SGI's IRIX; decompals/ido-static-recomp translates
// each into C that does what its instructions did, with a small C library standing in for IRIX's, so built on this
// computer `cc`, `cfe`, `uopt`, `ugen` and `as1` run as they ran on IRIX and give the same objects. The tools fetch it
// at the commit below and build it with its own Makefile, once, in .dreamports/ido/, never in the repository: IDO 5.3
// carries SGI's freeware notice, IDO 7.1 none, the translation no licence, and rabbitizer, which it reads MIPS with,
// the MIT License (#1644). It needs a C and a C++ compiler and make, as the reference emulators do, and on a Mac GNU
// make as gmake.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';

/** Where IDO's translation comes from, at the commit the tools fix. */
export const IDO_SOURCE = 'https://github.com/decompals/ido-static-recomp.git';
export const IDO_COMMIT = '84a988462d0636afeabcb035e2741b68e91be1fb';
/** The versions of IDO it builds, which games' original.json name. */
export const IDO_VERSIONS = ['5.3', '7.1'];

const FOLDER = join(LOCAL, 'ido', IDO_COMMIT.slice(0, 12));
const SOURCE = join(FOLDER, 'source');
// the jobs a build runs at once: two, so a build of the translation's large files keeps to the computer's memory
const JOBS = '-j2';

// the programs of IDO a build of one file into an object runs, and the messages they say things with: not its C
// optimizer, its C++ or its linker, which take the longest to build
const PASSES = ['cc', 'cfe', 'uopt', 'ugen', 'as1', 'ujoin', 'uld', 'umerge', 'usplit', 'err.english.cc'];

function run(what, program, args, cwd) {
  // the compiler's own files as it works, which for these programs are large, kept in the tools' folder
  const temporary = join(LOCAL, 'tmp', 'ido');
  mkdirSync(temporary, { recursive: true });
  try {
    execFileSync(program, args, { cwd, env: { ...process.env, TMPDIR: temporary }, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 2 ** 28 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${what} needs ${program}, which isn't installed (tools/README.md, Matching the original's bytes).`);
    throw new Error(`${what} failed:\n${String(error.stderr ?? '').trim().split('\n').slice(-20).join('\n')}`);
  }
}

/** The folder IDO `version`'s programs are in once built: `cc` and the passes it runs, side by side. */
export const idoFolder = version => join(SOURCE, 'build', version, 'out');

/** Whether IDO `version` is built on this computer. */
export const isIdoBuilt = version => existsSync(join(idoFolder(version), '.built')) && readFileSync(join(idoFolder(version), '.built'), 'utf8') === IDO_COMMIT;

/** Builds IDO `version` on this computer if it isn't yet: the path of its `cc`. */
export function buildIdo(version, log = console.log) {
  if (!IDO_VERSIONS.includes(version)) throw new Error(`The tools build IDO ${IDO_VERSIONS.join(' and ')}, and not ${version}.`);
  const cc = join(idoFolder(version), 'cc');
  if (isIdoBuilt(version)) return cc;
  if (process.platform === 'win32') throw new Error('IDO is built on Linux and on a Mac so far: its translation\'s Makefile needs MSYS2 on Windows, which the tools don\'t set up.');
  const what = `Building IDO ${version}`;
  log(`${what} from decompals/ido-static-recomp's source, once, which takes some minutes…`);
  mkdirSync(SOURCE, { recursive: true });
  if (!existsSync(join(SOURCE, '.git'))) {
    run(what, 'git', ['init', '-q'], SOURCE);
    run(what, 'git', ['remote', 'add', 'origin', IDO_SOURCE], SOURCE);
  }
  run(what, 'git', ['fetch', '-q', '--depth', '1', 'origin', IDO_COMMIT], SOURCE);
  run(what, 'git', ['checkout', '-q', '--force', 'FETCH_HEAD'], SOURCE);
  // its own Makefile calls itself as gmake on a Mac, whose own make is too old for it
  const make = process.platform === 'darwin' ? 'gmake' : 'make';
  if (!existsSync(join(SOURCE, 'build', 'recomp.elf'))) run(what, make, [JOBS, 'RELEASE=1', 'setup'], SOURCE);
  run(what, make, [JOBS, 'RELEASE=1', `VERSION=${version}`, ...PASSES.map(pass => `build/${version}/out/${pass}`)], SOURCE);
  if (!existsSync(cc)) throw new Error(`${what} made no cc in ${idoFolder(version)}.`);
  writeFileSync(join(idoFolder(version), '.built'), IDO_COMMIT);
  return cc;
}
