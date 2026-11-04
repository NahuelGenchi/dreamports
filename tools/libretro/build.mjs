// Builds what runs the original of a console other than the Game Boy Advance, on this computer, once: the program that
// drives any libretro core (host.c) and the console's core, from its makers' source at a fixed commit. On Windows it gets a
// compiler for itself and builds in a folder with a plain name, keeping only the programs (../gba/windows.mjs).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { buildJobs } from '../lib/jobs.mjs';
import { WINDOWS_BUILD, windowsTools } from '../gba/windows.mjs';

const FOLDER = join(LOCAL, 'libretro');
const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCE = join(HERE, 'host.c');
const EXTENSION = { win32: '.dll', darwin: '.dylib' }[process.platform] ?? '.so';
const WINDOWS = process.platform === 'win32';
export const HOST = join(FOLDER, WINDOWS ? 'host.exe' : 'host');
export const coreFile = core => join(FOLDER, `${core.built}-${core.commit.slice(0, 12)}${EXTENSION}`);

function run(what, program, args, cwd, env) {
  try {
    execFileSync(program, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 2 ** 28 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${what} needs ${program}, which isn't installed.`);
    throw new Error(`${what} failed:\n${String(error.stderr ?? '').trim().split('\n').slice(-20).join('\n')}`);
  }
}

// built again whenever its source changes
const sourceOf = file => `${file}.source`;
const isCurrent = (source, target) => existsSync(target) && existsSync(sourceOf(target)) && readFileSync(sourceOf(target), 'utf8') === readFileSync(source, 'utf8');

function compile(what, source, target, args, tools) {
  if (isCurrent(source, target)) return;
  run(what, tools?.gcc ?? 'cc', ['-O2', '-std=gnu11', '-o', target, source, ...args], FOLDER, tools?.env);
  writeFileSync(sourceOf(target), readFileSync(source, 'utf8'));
}

function buildHere(machine, log, tools) {
  const { core, name } = machine;
  compile('Building the tools\' program that runs an emulator', HOST_SOURCE, HOST, WINDOWS ? [] : ['-ldl'], tools);
  const file = coreFile(core);
  if (core.local) return compile(`Building ${name}'s emulator`, join(REPO, core.local), file, ['-shared', '-fPIC', '-lm'], tools);
  if (existsSync(file)) return;
  log(`Building ${name}'s emulator from its makers' source, once, which takes a few minutes…`);
  const source = join(WINDOWS ? WINDOWS_BUILD : FOLDER, `${core.built}-source`), what = `Getting ${name}'s emulator`;
  if (!existsSync(join(source, '.git'))) {
    mkdirSync(source, { recursive: true });
    run(what, 'git', ['init', '-q'], source);
    run(what, 'git', ['remote', 'add', 'origin', core.source], source);
  }
  run(what, 'git', ['fetch', '-q', '--depth', '1', 'origin', core.commit], source);
  run(what, 'git', ['checkout', '-q', '--force', 'FETCH_HEAD'], source);
  if (core.submodules) run(what, 'git', ['submodule', 'update', '-q', '--init', '--recursive', '--depth', '1'], source);
  const folder = join(source, core.folder ?? '');
  run(`Building ${name}'s emulator`, tools?.make ?? 'make', [`-j${buildJobs()}`, ...(core.make ?? [])], folder, tools?.env);
  copyFileSync(join(folder, `${core.built}${EXTENSION}`), file);
}

/** Builds the host and this console's core if they aren't built yet. */
export function buildReference(machine, log) {
  const { core, name } = machine;
  if (core.needs) throw new Error(`${name} can't run in the tools yet: ${core.needs} (docs/CONSOLES.md).`);
  mkdirSync(FOLDER, { recursive: true });
  const built = existsSync(HOST) && isCurrent(HOST_SOURCE, HOST) && (core.local ? isCurrent(join(REPO, core.local), coreFile(core)) : existsSync(coreFile(core)));
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
