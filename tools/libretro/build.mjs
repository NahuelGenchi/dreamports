// Builds what runs the original of a console other than the Game Boy Advance, on this computer, once: the program that
// drives any libretro core (host.c) and the console's core, from its makers' source at a fixed commit. On Windows it gets a
// compiler for itself and builds in a folder with a plain name, keeping only the programs (../gba/windows.mjs).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { buildJobs } from '../lib/jobs.mjs';
import { WINDOWS_BUILD, windowsTools } from '../gba/windows.mjs';

const FOLDER = join(LOCAL, 'libretro');
const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCE = join(HERE, 'host.c');
// the route finder's search, which the host includes (lib/explore.h)
const EXPLORE = join(HERE, '..', 'lib', 'explore.h');
// what ran of the original, which the host includes too (ran.h, and ran-ps2.h for the PlayStation 2)
const RAN = join(HERE, 'ran.h'), RAN_PS2 = join(HERE, 'ran-ps2.h');
// and what the console holds, its memory and its memory cards (held.h)
const HELD = join(HERE, 'held.h');
// and a function of the console's program run by itself, for the function check (calls.h)
const CALLS = join(HERE, 'calls.h');
const EXTENSION = { win32: '.dll', darwin: '.dylib' }[process.platform] ?? '.so';
const WINDOWS = process.platform === 'win32';
// On a Mac the host and the emulator are built for the processor Node.js runs as, arm64 on Apple's chip, named to the
// compiler and to CMake, as Homebrew's CMake runs as arm64 even when Node.js runs as an Intel program through Rosetta,
// and a host can't load an emulator built for the other
const MAC_ARCH = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'arm64' : 'x86_64') : null;
export const HOST = join(FOLDER, WINDOWS ? 'host.exe' : 'host');
// What CMake builds a core with. Every product and sum the emulator's own C++ works out is rounded on its own, as
// -ffp-contract=off asks: a compiler for arm64, such as Apple's on a Mac, would otherwise fuse a product and a sum into
// one rounding where x86's can't, and the console's sums would come out differently from Linux's (#1592)
const cmakeSettings = core => ['-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-ffp-contract=off', '-DCMAKE_CXX_FLAGS=-ffp-contract=off',
  ...(MAC_ARCH ? [`-DCMAKE_OSX_ARCHITECTURES=${MAC_ARCH}`] : []), ...core.cmake, ...(core.cmakeOn?.[process.platform] ?? [])];
// a core with a patch of the project's own has the patch's hash in its name too, with the hash of each of the project's
// files that's built into it (`copies`, as the PlayStation 2's sound chip is the kit's), one CMake builds the hash of
// what it's built with, and one `make` builds with settings of the tools' own beyond what it builds the hash of those,
// so a build without any of them is never used. A core built by `make` alone with no such settings keeps the name it
// always had.
const OWN_SETTING = /^(CPUOPTS|CFLAGS|CPUFLAGS)=/;
const copiesOf = core => Object.entries(core.copies ?? {});
const builtWith = core => {
  const ownMake = core.make?.some(arg => OWN_SETTING.test(arg));
  if (!core.patch && !core.cmake && !ownMake) return '';
  const hash = createHash('sha1').update(core.patch ? readFileSync(join(REPO, core.patch)) : '').update(core.cmake ? JSON.stringify(cmakeSettings(core)) : '').update(ownMake ? JSON.stringify(core.make) : '');
  for (const [from] of copiesOf(core)) hash.update(readFileSync(join(REPO, from)));
  return `-${hash.digest('hex').slice(0, 8)}`;
};
/** Where an emulator's own files are kept, those it reads as it runs and its makers publish with its source (`data`), such
 *  as Dolphin's stand-ins for the sound processor's ROMs: a folder beside the built emulator, named for the same commit. */
export const coreSystem = core => core.data ? join(FOLDER, `${core.built}-${core.commit.slice(0, 12)}-system`) : null;
export const coreFile = core => join(FOLDER, `${core.built}-${core.commit.slice(0, 12)}${builtWith(core)}${EXTENSION}`);

function run(what, program, args, cwd, env) {
  try {
    execFileSync(program, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 2 ** 28 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${what} needs ${program}, which isn't installed.`);
    throw new Error(`${what} failed:\n${String(error.stderr ?? '').trim().split('\n').slice(-20).join('\n')}`);
  }
}

// built again whenever its source changes, or anything it includes, which `also` lists
const sourceOf = file => `${file}.source`;
const textOf = (source, also = []) => [source, ...also].map(file => readFileSync(file, 'utf8')).join('\n');
const isCurrent = (source, target, also) => existsSync(target) && existsSync(sourceOf(target)) && readFileSync(sourceOf(target), 'utf8') === textOf(source, also);

function compile(what, source, target, args, tools, also) {
  if (isCurrent(source, target, also)) return;
  run(what, tools?.gcc ?? 'cc', ['-O2', '-std=gnu11', ...(MAC_ARCH ? ['-arch', MAC_ARCH] : []), '-o', target, source, ...args], FOLDER, tools?.env);
  writeFileSync(sourceOf(target), textOf(source, also));
}

/** A console's emulator's source, from its makers at the commit tools/consoles.mjs names, fetched if it isn't here:
 *  the folder it's in. What builds the emulator starts from it, and so does a tool that needs one file of it, as the
 *  NES's function check needs its processor (../nes/twin.mjs). */
export function fetchSource({ core, name }) {
  const source = join(WINDOWS ? WINDOWS_BUILD : FOLDER, `${core.built}-source`), what = `Getting ${name}'s emulator`;
  if (!existsSync(join(source, '.git'))) {
    mkdirSync(source, { recursive: true });
    run(what, 'git', ['init', '-q'], source);
    run(what, 'git', ['remote', 'add', 'origin', core.source], source);
  }
  run(what, 'git', ['fetch', '-q', '--depth', '1', 'origin', core.commit], source);
  run(what, 'git', ['checkout', '-q', '--force', 'FETCH_HEAD'], source);
  // the libraries its source keeps as git's submodules, but for those only a program with a window needs, or its makers'
  // own tests, which can be a gigabyte
  for (const left of core.withoutSubmodules ?? []) run(what, 'git', ['config', `submodule.${left}.update`, 'none'], source);
  if (core.submodules) run(what, 'git', ['submodule', 'update', '-q', '--init', '--recursive', '--depth', '1'], source);
  if (core.patch) {
    // a file the patch adds is still there from the last time it was applied, as the checkout only puts back the
    // emulator's own files, and the patch won't write over it
    for (const [, added] of readFileSync(join(REPO, core.patch), 'utf8').matchAll(/^diff --git a\/(\S+) b\/\S+\nnew file mode/gm)) rmSync(join(source, added), { force: true });
    // many of an emulator's files end their lines as Windows does, and the patch, like every text file here, as Linux does
    run(`Patching ${name}'s emulator`, 'git', ['apply', '--ignore-whitespace', join(REPO, core.patch)], source);
  }
  // the project's own files that are built into the emulator, beside what the patch adds
  for (const [from, to] of copiesOf(core)) {
    mkdirSync(dirname(join(source, to)), { recursive: true });
    copyFileSync(join(REPO, from), join(source, to));
  }
  return source;
}

function buildHere(machine, log, tools) {
  const { core, name } = machine;
  compile('Building the tools\' program that runs an emulator', HOST_SOURCE, HOST, ['-I', dirname(EXPLORE), ...(WINDOWS ? [] : ['-ldl']), ...(process.platform === 'linux' ? ['-lpthread'] : [])], tools, [EXPLORE, RAN, RAN_PS2, HELD, CALLS]);
  const file = coreFile(core);
  if (core.local) return compile(`Building ${name}'s emulator`, join(REPO, core.local), file, ['-shared', '-fPIC', '-lm'], tools);
  if (existsSync(file)) return;
  // headers its source includes that a computer may not have, each with what installs it there
  for (const { header, install } of core.headers?.[process.platform] ?? []) {
    if (!existsSync(header)) throw new Error(`${name}'s emulator needs ${header}, which isn't on this computer. On Debian or Ubuntu, ${install} installs it.`);
  }
  log(`Building ${name}'s emulator from its makers' source, once, which takes a few minutes…`);
  const source = fetchSource(machine);
  const folder = join(source, core.folderOn?.[process.platform] ?? core.folder ?? ''), building = `Building ${name}'s emulator`;
  if (core.cmake) {
    // on Windows, with the compiler and make the tools got for themselves (../gba/windows.mjs)
    const withTools = tools ? ['-G', 'MinGW Makefiles', `-DCMAKE_MAKE_PROGRAM=${tools.make}`, `-DCMAKE_C_COMPILER=${tools.gcc}`, `-DCMAKE_CXX_COMPILER=${tools.gcc.replace(/gcc\.exe$/, 'g++.exe')}`] : [];
    run(building, tools?.cmake ?? 'cmake', ['-S', source, '-B', join(source, 'build'), ...withTools, ...cmakeSettings(core)], source, tools?.env);
    run(building, tools?.cmake ?? 'cmake', ['--build', join(source, 'build'), '--target', core.target, '-j', String(buildJobs())], source, tools?.env);
  } else {
    // what an earlier build left in the source's folder was built with its own settings, which make wouldn't build again
    run(building, tools?.make ?? 'make', [...(core.make ?? []), 'clean'], folder, tools?.env);
    run(building, tools?.make ?? 'make', [`-j${buildJobs()}`, ...(core.make ?? [])], folder, tools?.env);
  }
  // its own files first, whole, so a built emulator always has them
  if (core.data) {
    const system = coreSystem(core);
    rmSync(system, { recursive: true, force: true });
    rmSync(`${system}.new`, { recursive: true, force: true });
    for (const [from, to] of Object.entries(core.data)) cpSync(join(source, from), join(`${system}.new`, to), { recursive: true });
    renameSync(`${system}.new`, system);
  }
  copyFileSync(join(folder, `${core.built}${EXTENSION}`), file);
}

/** Builds the host and this console's core if they aren't built yet. */
export function buildReference(machine, log) {
  const { core, name } = machine;
  if (core.needs) throw new Error(`${name} can't run in the tools yet: ${core.needs} (docs/CONSOLES.md).`);
  // said before a build of several minutes that couldn't run here
  if (core.graphics && process.platform === 'win32') throw new Error(`${name} can't run in the tools on Windows yet: its emulator draws with OpenGL, and the tools give it a context only on Linux and macOS so far (docs/CONSOLES.md).`);
  mkdirSync(FOLDER, { recursive: true });
  const built = existsSync(HOST) && isCurrent(HOST_SOURCE, HOST, [EXPLORE, RAN, RAN_PS2, HELD, CALLS]) && (core.local ? isCurrent(join(REPO, core.local), coreFile(core)) : existsSync(coreFile(core)));
  if (built) return;
  if (!WINDOWS) return buildHere(machine, log, null);
  rmSync(WINDOWS_BUILD, { recursive: true, force: true });
  try {
    buildHere(machine, log, windowsTools(log));
  } finally {
    // it's about a gigabyte, and one that won't go is emptied by the next build
    try { rmSync(WINDOWS_BUILD, { recursive: true, force: true }); } catch {}
  }
}
