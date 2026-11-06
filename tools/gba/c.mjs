// Builds C for the Game Boy Advance kit in C (kit/gba/c/): to WebAssembly, which a game's page runs, and for this
// computer, which runs the same C with no browser. WebAssembly is built with Clang and its linker as WebAssembly
// themselves, from npm (@yowasp/clang), so it needs nothing installed beyond `npm ci`, the same on every computer. A
// build for this computer needs its own C compiler, the one the proof tools already need (tools/README.md).

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from '../lib/paths.mjs';

/** The C kit's folder, with gba.h and the kit's own sources. */
export const C_KIT = fileURLToPath(new URL('../../kit/gba/c/', import.meta.url));
/** The kit's sources a game is built with, besides its own: native.c only for this computer. */
export const KIT_SOURCES = ['video.c', 'kit.c', 'libc.c', 'apu.c', 'm4a.c', 'sound.c'].map(file => join(C_KIT, file));
export const NATIVE_MAIN = join(C_KIT, 'native.c');

// what both builds ask of the C: C11, warnings that catch a slip, and the same arithmetic everywhere
const FLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', '-fwrapv'];

// every .c and .h file in the folders the sources are in and in the kit's, in folders as they are in the repository,
// for the compiler's own
function filesFor(sources) {
  const tree = {};
  for (const folder of new Set([C_KIT, ...sources.map(dirname)])) {
    let place = tree;
    for (const part of relative(REPO, folder).split(sep).filter(Boolean)) place = place[part] ??= {};
    for (const name of readdirSync(folder)) if (/\.[ch]$/.test(name)) place[name] = readFileSync(join(folder, name));
  }
  return tree;
}

/** Builds `sources` (paths of .c files) to the WebAssembly module `out`. They include the kit as "gba.h". */
export async function buildWasm(sources, out) {
  let runClang, runLLVM;
  try {
    ({ runClang, runLLVM } = await import('@yowasp/clang'));
  } catch {
    throw new Error('The compiler for WebAssembly isn\'t here: run npm ci in the repository\'s folder first.');
  }
  // the compiler runs in a folder of its own, with the repository's C at the same paths
  const files = filesFor(sources), name = basename(out);
  const args = ['clang', '--target=wasm32', ...FLAGS, '-ffreestanding', '-nostdlib', '-mbulk-memory', '-msign-ext', '-mnontrapping-fptoint',
    '-I', relative(REPO, C_KIT).split(sep).join('/'), '-Wl,--no-entry', '-Wl,-z,stack-size=1048576', '-Wl,--strip-all', '-o', name,
    ...sources.map(file => relative(REPO, file).split(sep).join('/'))];
  // the compiler's files, read once from node_modules, quietly
  await runLLVM(null, {}, { fetchProgress: () => {} });
  let made, said = '';
  const stderr = bytes => { if (bytes) said += Buffer.from(bytes).toString('utf8'); };
  try {
    made = await runClang(args, files, { stdout: stderr, stderr });
  } catch (error) {
    throw new Error(`The C didn't build to WebAssembly:\n${said.trim() || String(error.message ?? error).trim()}`);
  }
  if (said.trim()) console.log(said.trim());
  if (!made?.[name]) throw new Error('The C didn\'t build to WebAssembly, and the compiler didn\'t say why.');
  writeFileSync(out, made[name]);
  return out;
}

/** Builds `sources` (paths of .c files) to the program `out` for this computer, with its C compiler ($CC, or cc). */
export function buildNative(sources, out) {
  const compiler = process.env.CC || (process.platform === 'win32' ? 'gcc' : 'cc');
  const result = spawnSync(compiler, [...FLAGS, '-I', C_KIT, '-o', out, ...sources], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`The C didn't build: ${(result.stderr || '').trim()}`);
  if (result.stderr.trim()) console.log(result.stderr.trim());
  return out;
}

/** A game's own C, every .c file in its folder's src/, such as games/<game>/c/src/, built with the kit to src/game.wasm
 *  there, or to `out`. */
export async function buildGame(folder, out = join(folder, 'src', 'game.wasm')) {
  const src = join(folder, 'src');
  const own = readdirSync(src).filter(name => name.endsWith('.c')).map(name => join(src, name));
  if (!own.length) throw new Error(`${relative(REPO, src)} has no C.`);
  return buildWasm([...own, ...KIT_SOURCES], out);
}
