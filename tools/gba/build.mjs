// Builds the reference emulator on the contributor's computer: mGBA's library, from mGBA's own repository at a fixed
// version, and original.c against it. Everything lands in .dreamports/gba/, which never goes in a commit, and none
// of it is ever part of a Dreamport or of dreamports.net. It needs git, CMake and a C compiler.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';

/** mGBA's version, the same on every computer so the original plays the same everywhere. */
export const MGBA_VERSION = '0.10.5';
const MGBA_REPOSITORY = 'https://github.com/mgba-emu/mgba.git';

const FOLDER = join(LOCAL, 'gba');
// mGBA's source: a copy of its repository already on this computer ($MGBA_SOURCE), or one the setup gets
const SOURCE = process.env.MGBA_SOURCE || join(FOLDER, 'mgba');
const BUILD = join(FOLDER, 'mgba-build');
const HARNESS = fileURLToPath(new URL('./original.c', import.meta.url));
/** The program that runs the original (original.c). */
export const ORIGINAL = join(FOLDER, process.platform === 'win32' ? 'original.exe' : 'original');
const STAMP = join(FOLDER, 'built.json');

const harness = () => createHash('sha1').update(readFileSync(HARNESS)).digest('hex');
const built = () => {
  try { return JSON.parse(readFileSync(STAMP, 'utf8')); } catch { return {}; }
};

/** Whether the reference emulator is built, from this version of mGBA and of original.c. */
export function isBuilt() {
  const { mgba, program } = built();
  return existsSync(ORIGINAL) && mgba === MGBA_VERSION && program === harness();
}

function run(command, args, what) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error(`${what} needs ${command}, which isn't installed.`);
  if (result.status !== 0) throw new Error(`${what} failed:\n${(result.stderr ?? '').trim().split('\n').slice(-20).join('\n')}`);
}

/** Builds what is missing, saying each step. */
export function build(log = console.log) {
  if (process.platform === 'win32') throw new Error('On Windows, run the proof tools in WSL (Windows Subsystem for Linux).');
  mkdirSync(FOLDER, { recursive: true });
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
    run('cmake', ['-S', SOURCE, '-B', BUILD, '-DLIBMGBA_ONLY=ON', '-DM_CORE_GB=OFF', '-DBUILD_LTO=OFF', '-DCMAKE_BUILD_TYPE=Release',
      // mGBA 0.10.5 asks for an old CMake, which CMake 4 no longer accepts without this
      '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'], 'Setting up mGBA\'s build');
    run('cmake', ['--build', BUILD, '--parallel'], 'Building mGBA');
    [mgba, source] = [MGBA_VERSION, SOURCE];
    writeFileSync(STAMP, JSON.stringify({ mgba, source }) + '\n');
  }
  log('Building the program that runs the original…');
  const compiler = process.env.CC || 'cc';
  run(compiler, ['-O2', '-o', ORIGINAL, HARNESS, '-I', join(source, 'include'), '-I', join(BUILD, 'include'),
    join(BUILD, 'libmgba.a'), '-lm', ...(process.platform === 'linux' ? ['-lpthread'] : [])], 'Building the program that runs the original');
  writeFileSync(STAMP, JSON.stringify({ mgba, source, program: harness() }) + '\n');
}
