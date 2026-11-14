// Builds a game written in C on its console's kit in C (kit/c/README.md): to WebAssembly, which its page runs, and for
// this computer, which runs the same C with no browser. Every console's kit is the base every console shares, kit/c/,
// with the console's own on top where it has one, as the Game Boy Advance has kit/gba/c/, the NES kit/nes/c/ and the PlayStation 2 kit/ps2/c/, and
// with console.h, made here from kit/consoles.js, on every console but the Game Boy Advance. WebAssembly is built with Clang and its linker as WebAssembly themselves,
// from npm (@yowasp/clang), so it needs nothing installed beyond `npm ci`, the same on every computer. A build for this
// computer needs its own C compiler, the one the proof tools already need (tools/README.md).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSOLES } from '../../kit/consoles.js';
import { LOCAL, REPO } from './paths.mjs';

/** The base every console's kit in C shares: kit.h, the copy, the save memory, the start point's words, memory and
 *  the picture, and what a console with no kit of its own runs on (console.c, native.c). */
export const C_BASE = fileURLToPath(new URL('../../kit/c/', import.meta.url));

// the consoles with a kit in C of their own, on top of the base: its folder and its sources. One with `header` also has
// console.h, and runs on a computer with the base's program for one (native.c), as a console with no kit of its own does
const OWN = {
  gba: { folder: fileURLToPath(new URL('../../kit/gba/c/', import.meta.url)), sources: ['gba.c', 'video.c', 'apu.c', 'm4a.c', 'sound.c'] },
  nes: { folder: fileURLToPath(new URL('../../kit/nes/c/', import.meta.url)), sources: ['nes.c', 'ppu.c', 'apu.c'], header: true },
  ps2: { folder: fileURLToPath(new URL('../../kit/ps2/c/', import.meta.url)), sources: ['ps2.c', 'gs.c', 'ee.c'], header: true },
};

const ident = name => name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

/** console.h for a console with no kit in C of its own, from what kit/consoles.js says of it. */
export function consoleHeader(id) {
  const machine = CONSOLES[id];
  const [width, height] = machine.screen, [ticks, clock] = machine.frame;
  return `// The ${machine.name} as kit/consoles.js has it, for a game in C on it (kit/c/README.md). The build writes this from
// kit/consoles.js, so the two always agree, and nothing of it is kept in the repository.

#ifndef DREAMPORTS_CONSOLE_H
#define DREAMPORTS_CONSOLE_H

#include "kit.h"

#define CONSOLE "${id}"
// its screen, unless the game's original.json says another
#define SCREEN_W ${width}
#define SCREEN_H ${height}
// a frame lasts CONSOLE_FRAME_TICKS ticks of a clock of CONSOLE_CLOCK a second
#define CONSOLE_FRAME_TICKS ${ticks}
#define CONSOLE_CLOCK ${clock}
// how many sound samples it plays a second
#define CONSOLE_SOUND_RATE ${machine.sound}

// its buttons as game_step gets them, a bit each, held or not
enum {
${machine.buttons.map((name, bit) => `  BUTTON_${ident(name)} = 1 << ${bit},`).join('\n')}
};
#define BUTTON_COUNT ${machine.buttons.length}

// what a game defines, which the kit calls:
/** once, with the player's copy in kit_copy */
void game_start(void);
/** every frame, with the buttons held */
void game_step(uint32_t buttons);
/** after the frames the page runs at once, to show the last of them: into kit_screen(width, height), at the game's size */
void game_draw(void);
/** \`count\` samples of what plays next, left and right, each -1 to 1, which start as silence */
void game_sound(float *left, float *right, int count);

#endif
`;
}

/** A console's kit in C: the folders a game's C includes it from, the kit's sources a game is built with besides its
 *  own (`native` also has its program for this computer, and leaves out what only WebAssembly needs), and `own`, whether
 *  the console has a kit of its own. */
export function cKit(id) {
  if (!CONSOLES[id]) throw new Error(`There's no console called ${id} in kit/consoles.js, so there's no kit in C for it.`);
  const own = OWN[id];
  const base = name => join(C_BASE, name);
  if (own && !own.header) {
    const sources = [base('kit.c'), base('libc.c'), ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, own.folder], sources, native: [...sources.filter(f => !f.endsWith('libc.c')), join(own.folder, 'native.c')] };
  }
  // console.h, written where the tools keep what they make, once it says something new
  const made = join(LOCAL, 'c', id);
  const header = join(made, 'console.h'), text = consoleHeader(id);
  if (!existsSync(header) || readFileSync(header, 'utf8') !== text) {
    mkdirSync(made, { recursive: true });
    writeFileSync(header, text);
  }
  if (own) {
    const sources = [base('kit.c'), base('libc.c'), ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, made, own.folder], sources, native: [...sources.filter(f => !f.endsWith('libc.c')), base('native.c')] };
  }
  const sources = [base('kit.c'), base('libc.c'), base('console.c')];
  return { id, own: false, folders: [C_BASE, made], sources, native: [base('kit.c'), base('console.c'), base('native.c')] };
}

// what both builds ask of the C: C11, warnings that catch a slip, and the same arithmetic everywhere
const FLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', '-fwrapv'];
const inRepo = path => relative(REPO, path).split(sep).join('/');

// every .c and .h file in the folders the sources are in and in the kit's, in folders as they are in the repository,
// for the compiler's own
function filesFor(sources, folders) {
  const tree = {};
  for (const folder of new Set([...folders, ...sources.map(dirname)])) {
    let place = tree;
    for (const part of relative(REPO, folder).split(sep).filter(Boolean)) place = place[part] ??= {};
    for (const name of readdirSync(folder)) if (/\.[ch]$/.test(name)) place[name] = readFileSync(join(folder, name));
  }
  return tree;
}

const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');

// What each module built inside the repository came from, and what came out, so the same C is never built twice:
// .dreamports/c/built.json, on this computer only. A whole game's proof opens the game once per recording, and a
// large game takes seconds to build each time.
const BUILT = join(LOCAL, 'c', 'built.json');
function readBuilt() {
  try {
    return JSON.parse(readFileSync(BUILT, 'utf8'));
  } catch {
    return {};
  }
}
function remember(key, row) {
  const built = readBuilt();
  built[key] = row;
  for (const other of Object.keys(built)) if (!existsSync(join(REPO, other))) delete built[other];
  mkdirSync(dirname(BUILT), { recursive: true });
  writeFileSync(BUILT, `${JSON.stringify(built, null, 2)}\n`);
}

// the compiler's own version, or null when it isn't installed
function compilerVersion() {
  try {
    return JSON.parse(readFileSync(join(REPO, 'node_modules', '@yowasp', 'clang', 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

/** Everything a build to WebAssembly comes from, as one hash: every file the compiler is given (`files`, folders of
 *  names and bytes, as filesFor makes them), how it's asked (`args`) and which compiler it is. */
export function buildFingerprint(files, args, compiler) {
  const hash = createHash('sha1').update(JSON.stringify([compiler, args]));
  const walk = (folder, path) => {
    for (const name of Object.keys(folder).sort()) {
      const at = `${path}/${name}`;
      if (Buffer.isBuffer(folder[name])) hash.update(`\0${at}\0${folder[name].length}\0`).update(folder[name]);
      else walk(folder[name], at);
    }
  };
  walk(files, '');
  return hash.digest('hex');
}

// the builds going on now, by what they write, so two that ask for the same one at once share it
const building = new Map();

/** Builds `sources` (paths of .c files) to the WebAssembly module `out`, with the kit's `folders` to include it from,
 *  as cKit gives them. A module inside the repository that was built from the same files, asked the same way of the
 *  same compiler, is left as it is, with nothing printed. */
export function buildWasm(sources, out, kit) {
  if (!building.has(out)) building.set(out, build(sources, out, kit).finally(() => building.delete(out)));
  return building.get(out);
}

async function build(sources, out, { folders }) {
  // the compiler runs in a folder of its own, with the repository's C at the same paths
  const files = filesFor(sources, folders), name = basename(out);
  const args = ['clang', '--target=wasm32', ...FLAGS, '-ffreestanding', '-nostdlib', '-mbulk-memory', '-msign-ext', '-mnontrapping-fptoint',
    ...folders.flatMap(folder => ['-I', inRepo(folder)]), '-Wl,--no-entry', '-Wl,-z,stack-size=1048576', '-Wl,--strip-all', '-o', name,
    ...sources.map(inRepo)];
  // only what's built inside the repository is remembered: anywhere else, such as a test's own folder, it's built each time
  const key = relative(REPO, out).split(sep).join('/'), compiler = compilerVersion();
  const from = compiler && !key.startsWith('../') && !isAbsolute(key) ? buildFingerprint(files, args, compiler) : null;
  if (from && existsSync(out)) {
    const was = readBuilt()[key];
    if (was?.from === from && was.module === sha1(readFileSync(out))) return out;
  }
  let runClang, runLLVM;
  try {
    ({ runClang, runLLVM } = await import('@yowasp/clang'));
  } catch {
    throw new Error('The compiler for WebAssembly isn\'t here: run npm ci in the repository\'s folder first.');
  }
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
  if (from) remember(key, { from, module: sha1(made[name]) });
  return out;
}

/** Builds `sources` (paths of .c files) to the program `out` for this computer, with its C compiler ($CC, or cc), with
 *  the kit's `folders` to include it from. */
export function buildNative(sources, out, { folders }) {
  const compiler = process.env.CC || (process.platform === 'win32' ? 'gcc' : 'cc');
  const result = spawnSync(compiler, [...FLAGS, ...folders.flatMap(folder => ['-I', folder]), '-o', out, ...sources], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`The C didn't build: ${(result.stderr || '').trim()}`);
  if (result.stderr.trim()) console.log(result.stderr.trim());
  return out;
}

/** The console of the game whose folder, or whose version's, such as games/<game>/c/, is `folder`, from the game's
 *  proof/original.json. */
export function consoleOfFolder(folder) {
  for (const place of [folder, dirname(folder)]) {
    const file = join(place, 'proof', 'original.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).console;
  }
  throw new Error(`${relative(REPO, folder)} has no proof/original.json, nor has the game it's a version of, so its console, and its kit in C, aren't known.`);
}

/** The game's own C files, every .c file in its folder's src/. */
export function ownSources(folder) {
  const src = join(folder, 'src');
  const own = existsSync(src) ? readdirSync(src).filter(name => name.endsWith('.c')).map(name => join(src, name)) : [];
  if (!own.length) throw new Error(`${relative(REPO, src)} has no C.`);
  return own;
}

/** A game's own C, every .c file in its folder's src/, such as games/<game>/c/src/, built with its console's kit to
 *  src/game.wasm there, or to `out`. */
export async function buildGame(folder, out = join(folder, 'src', 'game.wasm')) {
  const kit = cKit(consoleOfFolder(folder));
  return buildWasm([...ownSources(folder), ...kit.sources], out, kit);
}

/** The folders under kit/ a game's build reads on `console`, as the repository has them, such as kit/c/ and kit/gba/c/. */
export const kitPaths = id => [C_BASE, ...(OWN[id] ? [OWN[id].folder] : [])].map(folder => `${inRepo(folder).replace(/\/$/, '')}/`);
