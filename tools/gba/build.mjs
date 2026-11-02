// Builds the reference emulator on the contributor's computer: mGBA's library, from mGBA's own repository at a fixed
// version, and original.c and read.c against it. Everything lands in .dreamports/gba/, which never goes in a commit, and none
// of it is ever part of a Dreamport or of dreamports.net. It needs git, CMake and a C compiler, and on Windows it gets
// the last two for itself (windows.mjs).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { windowsTools, WINDOWS_TOOLS } from './windows.mjs';

/** mGBA's version, the same on every computer so the original plays the same everywhere. */
export const MGBA_VERSION = '0.10.5';
const MGBA_REPOSITORY = 'https://github.com/mgba-emu/mgba.git';

const FOLDER = join(LOCAL, 'gba');
// mGBA's source: a copy of its repository already on this computer ($MGBA_SOURCE), or one the setup gets
const SOURCE = process.env.MGBA_SOURCE || join(FOLDER, 'mgba');
const BUILD = join(FOLDER, 'mgba-build');
const HARNESS = fileURLToPath(new URL('./original.c', import.meta.url));
const READER_SOURCE = fileURLToPath(new URL('./read.c', import.meta.url));
const ON_WINDOWS = fileURLToPath(new URL('./on-windows.h', import.meta.url));
/** The program that runs the original (original.c). */
export const ORIGINAL = join(FOLDER, process.platform === 'win32' ? 'original.exe' : 'original');
/** The program that prints the original's instructions (read.c). */
export const READER = join(FOLDER, process.platform === 'win32' ? 'read.exe' : 'read');
const STAMP = join(FOLDER, 'built.json');

const sha1 = (...files) => files.reduce((hash, file) => hash.update(readFileSync(file)), createHash('sha1')).digest('hex');
const harness = () => sha1(HARNESS, ON_WINDOWS);
const reader = () => sha1(READER_SOURCE, ON_WINDOWS);
const built = () => {
  try { return JSON.parse(readFileSync(STAMP, 'utf8')); } catch { return {}; }
};

/** Whether the reference emulator is built, from this version of mGBA, of original.c and of read.c. */
export function isBuilt() {
  const stamp = built();
  return existsSync(ORIGINAL) && existsSync(READER) && stamp.mgba === MGBA_VERSION && stamp.program === harness() && stamp.reader === reader();
}

function run(command, args, what, env) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', env });
  if (result.error?.code === 'ENOENT') throw new Error(`${what} needs ${command}, which isn't installed.`);
  if (result.status !== 0) throw new Error(`${what} failed:\n${(result.stderr ?? '').trim().split('\n').slice(-20).join('\n')}`);
}

/** Builds what is missing, saying each step. */
export function build(log = console.log) {
  mkdirSync(FOLDER, { recursive: true });
  const windows = process.platform === 'win32' ? windowsTools(log) : null;
  let { mgba, source } = built();
  if (mgba !== MGBA_VERSION || !source || !existsSync(join(BUILD, 'libmgba.a')) || !existsSync(join(source, 'include'))) {
    if (!existsSync(join(SOURCE, 'CMakeLists.txt'))) {
      if (process.env.MGBA_SOURCE) throw new Error(`MGBA_SOURCE names ${SOURCE}, which has no copy of mGBA's source.`);
      log(`Getting mGBA ${MGBA_VERSION} from its repository…`);
      run('git', ['clone', '--quiet', '--depth', '1', '--branch', MGBA_VERSION, MGBA_REPOSITORY, SOURCE], 'Getting mGBA');
    }
    const version = readFileSync(join(SOURCE, 'version.cmake'), 'utf8').match(/LIB_VERSION_MAJOR (\d+)\)[^]*LIB_VERSION_MINOR (\d+)\)[^]*LIB_VERSION_PATCH (\d+)\)/);
    if (version?.slice(1).join('.') !== MGBA_VERSION) {
      throw new Error(`The proof tools use mGBA ${MGBA_VERSION}, and ${SOURCE} holds ${version ? version.slice(1).join('.') : 'another version'}.`);
    }
    log('Building mGBA\'s library (a minute or two)…');
    // the library only, with the Game Boy Advance and nothing else: no BIOS, frontends, sound or video files
    const cmake = windows?.cmake ?? 'cmake';
    run(cmake, ['-S', SOURCE, '-B', BUILD, '-DLIBMGBA_ONLY=ON', '-DM_CORE_GB=OFF', '-DBUILD_LTO=OFF', '-DCMAKE_BUILD_TYPE=Release',
      ...(windows ? ['-G', 'MinGW Makefiles', `-DCMAKE_MAKE_PROGRAM=${windows.make}`, `-DCMAKE_C_COMPILER=${windows.gcc}`] : []),
      // mGBA 0.10.5 asks for an old CMake, which CMake 4 no longer accepts without this
      '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'], 'Setting up mGBA\'s build', windows?.env);
    run(cmake, ['--build', BUILD, '--parallel'], 'Building mGBA', windows?.env);
    [mgba, source] = [MGBA_VERSION, SOURCE];
    writeFileSync(STAMP, JSON.stringify({ mgba, source }) + '\n');
  }
  log('Building the program that runs the original…');
  const compiler = windows?.gcc ?? (process.env.CC || 'cc');
  const headers = ['-I', join(source, 'include'), '-I', join(BUILD, 'include')];
  // on macOS, mGBA's library asks Apple's CoreFoundation where the program is, and on Windows it needs Windows' own
  // libraries, and -static so the programs run once the compiler has gone
  const library = [join(BUILD, 'libmgba.a'), '-lm', ...(process.platform === 'linux' ? ['-lpthread'] : []), ...(process.platform === 'darwin' ? ['-framework', 'CoreFoundation'] : []),
    ...(windows ? ['-static', '-lws2_32', '-lshlwapi', '-lshell32', '-lole32', '-luuid', '-lwinmm', '-liphlpapi'] : [])];
  run(compiler, ['-O2', '-o', ORIGINAL, HARNESS, ...headers, ...library], 'Building the program that runs the original', windows?.env);
  // the decoder's text is in mGBA's debugger part, which the library leaves out: decoder.c is built again with it,
  // on its own, as the rest has to be built as the library was. Its headers declare strlcpy unless told the computer
  // has one, and macOS's is a macro, so there they have to be told
  log('Building the program that prints the original\'s instructions…');
  const decoder = join(FOLDER, 'decoder.o');
  run(compiler, ['-O2', '-c', '-DUSE_DEBUGGERS', ...(process.platform === 'darwin' ? ['-DHAVE_STRLCPY'] : []), '-o', decoder, join(source, 'src', 'arm', 'decoder.c'), ...headers], 'Building mGBA\'s decoder', windows?.env);
  run(compiler, ['-O2', '-o', READER, READER_SOURCE, decoder, ...headers, ...library], 'Building the program that prints the original\'s instructions', windows?.env);
  writeFileSync(STAMP, JSON.stringify({ mgba, source, program: harness(), reader: reader() }) + '\n');
  // the compiler has done its job, and it's by far the biggest thing here; a later build gets it again
  if (windows) rmSync(WINDOWS_TOOLS, { recursive: true, force: true });
}
