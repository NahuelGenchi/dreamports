// Builds a game written in C on its console's kit in C (kit/c/README.md): to WebAssembly, which its page runs, and for
// this computer, which runs the same C with no browser. Every console's kit is the base every console shares, kit/c/,
// with the console's own on top where it has one, as the Game Boy Advance has kit/gba/c/, the NES kit/nes/c/ and the PlayStation 2 kit/ps2/c/, and
// with console.h, made here from kit/consoles.js, on every console but the Game Boy Advance. WebAssembly is built with Clang and its linker as WebAssembly themselves,
// from npm (@yowasp/clang), so it needs nothing installed beyond `npm ci`, the same on every computer. A build for this
// computer needs its own C compiler, the one the proof tools already need (tools/README.md).
//
// Two things are done only for a game that asks for them, by what its C uses, and change nothing for one that doesn't
// (tools/README.md, The same-memory build). A game that includes "twins.h" gets it written from the addresses its
// functions' comments name: each twin's address in the original, and the table from an address to its twin. And a game
// that waits for the screen from inside a function, with the kit's kit_wait_frame, gets Binaryen's Asyncify pass over
// its WebAssembly, which is what lets C leave a function halfway and come back (kit/c/pause.c, lib/binaryen.mjs).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSOLES } from '../../kit/consoles.js';
import { LOCAL, REPO } from './paths.mjs';
import { BINARYEN_VERSION, binaryen } from './binaryen.mjs';

/** The base every console's kit in C shares: kit.h, the copy, the save memory, the start point's words, memory and
 *  the picture, and what a console with no kit of its own runs on (console.c, native.c). */
export const C_BASE = fileURLToPath(new URL('../../kit/c/', import.meta.url));

// the consoles with a kit in C of their own, on top of the base: its folder and its sources. One with `header` also has
// console.h, and runs on a computer with the base's program for one (native.c), as a console with no kit of its own does
const OWN = {
  gba: { folder: fileURLToPath(new URL('../../kit/gba/c/', import.meta.url)), sources: ['gba.c', 'video.c', 'apu.c', 'm4a.c', 'sound.c', 'memory.c'] },
  nes: { folder: fileURLToPath(new URL('../../kit/nes/c/', import.meta.url)), sources: ['nes.c', 'ppu.c', 'apu.c'], header: true },
  ps2: { folder: fileURLToPath(new URL('../../kit/ps2/c/', import.meta.url)), sources: ['ps2.c', 'gs.c', 'gif.c', 'ee.c', 'vu.c'], header: true },
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
    const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...own.sources.map(name => join(own.folder, name))];
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
    const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, made, own.folder], sources, native: [...sources.filter(f => !f.endsWith('libc.c')), base('native.c')] };
  }
  const sources = [base('kit.c'), base('pause.c'), base('libc.c'), base('console.c')];
  return { id, own: false, folders: [C_BASE, made], sources, native: [base('kit.c'), base('pause.c'), base('console.c'), base('native.c')] };
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
    if (was?.from === from && was.module === sha1(readFileSync(out)) && (was.pass ?? BINARYEN_VERSION) === BINARYEN_VERSION) return out;
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
  const waits = waitsInside(made[name]);
  const module = waits ? await withWaits(made[name]) : made[name];
  writeFileSync(out, module);
  if (from) remember(key, { from, module: sha1(module), ...(waits ? { pass: BINARYEN_VERSION } : {}) });
  return out;
}

// whether a module's C waits from inside a function: the kit's pause.c is in it, with the four calls it makes to the pass
const waitsInside = module => WebAssembly.Module.imports(new WebAssembly.Module(module)).some(each => each.module === 'asyncify');

/** A module whose C calls kit_wait_frame, after the pass that makes the wait work: Binaryen's Asyncify, which gives
 *  every function on the way to a wait a way to put its values away and come back to them, and takes the four calls
 *  the kit makes to it (kit/c/pause.c) as its own, so the module that comes out imports nothing new. */
export async function withWaits(module) {
  const tools = await binaryen();
  const parsed = tools.readBinary(module);
  try {
    // what the compiler was asked for above, and the part of bulk memory the pass's own code uses
    parsed.setFeatures(tools.Features.MutableGlobals | tools.Features.BulkMemory | tools.Features.BulkMemoryOpt | tools.Features.SignExt | tools.Features.NontrappingFPToInt);
    tools.setOptimizeLevel(2);
    tools.setShrinkLevel(0);
    // only the kit's wait ends a frame: nothing the page gives the game, such as its save memory, does
    tools.setPassArgument('asyncify-ignore-imports', '');
    parsed.runPasses(['asyncify']);
    // the pass leaves a lot to tidy, which is most of what it would cost a game otherwise
    parsed.optimize();
    return Buffer.from(parsed.emitBinary());
  } finally {
    parsed.dispose();
  }
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
  const kit = cKit(consoleOfFolder(folder)), own = ownSources(folder);
  const twins = await twinsFolder(folder);
  return buildWasm([...own, ...kit.sources], out, twins ? { ...kit, folders: [...kit.folders, twins] } : kit);
}

// a file of the game's own that includes twins.h
const ASKS_FOR_TWINS = /^[ \t]*#[ \t]*include[ \t]*"twins\.h"/m;

/**
 * twins.h for a game, from `twins`, each function's { name, address, own } as its comment names it, and `named`, a Map of
 * the names the game gives addresses (its proof/addresses.json): each one's address in the original as memory keeps
 * it, ADDRESS_<name>, and what turns an address kept in memory into the twin to call, for every twin but a file's own
 * static ones, which no table in another file can name. A function of the cartridge is Thumb code, whose address is
 * kept odd, unless the game's own names say otherwise.
 */
export function twinsHeader(twins, named = new Map()) {
  const addresses = new Map(named);
  const listed = [];
  for (const { name, address, own } of twins) {
    if (address === null) continue;
    if (!addresses.has(name)) addresses.set(name, address >= 0x08000000 ? address | 1 : address);
    if (!own && !listed.includes(name)) listed.push(name);
  }
  const hex = value => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}u`;
  return `// The game's twins, by their addresses in the original. The build writes this from the comment above each function of
// the game's C, which names the function of the original it's the twin of, as the port map reads them
// (tools/README.md, The same-memory build), so nothing of it is kept in the repository.

#ifndef DREAMPORTS_TWINS_H
#define DREAMPORTS_TWINS_H

#include <stdint.h>

// each name's address in the original, as its memory keeps it
${[...addresses].map(([name, address]) => `#define ADDRESS_${name} ${hex(address)}`).join('\n')}

// every twin the table has
#define TWINS(TWIN_OF) ${listed.map(name => `TWIN_OF(${name})`).join(' ')}

/** The twin of the function the original has at \`address\`, as memory keeps it. It stops the game if there's none. */
void *kit_twin(uint32_t address);
/** The address the original has \`function\` at, as a pointer of the function's own kind, for a value kept in memory. */
#define TWIN_ADDRESS(function) ((__typeof__(&function))(uintptr_t)ADDRESS_##function)
/** The twin that a pointer kept in memory names, to call. */
#define TWIN(pointer) ((__typeof__(pointer))kit_twin((uint32_t)(uintptr_t)(pointer)))
/** Defines kit_twin: write it once, in a file that declares every twin. */
#define TWIN_TABLE \\
  void *kit_twin(uint32_t address) { \\
    switch (address) { TWINS(TWIN_CASE) } \\
    __builtin_trap(); \\
  }
#define TWIN_CASE(name) case ADDRESS_##name: return (void *)name;

#endif
`;
}

// The folder with a game's twins.h, written if what it would say is new, or null for a game that doesn't include it.
async function twinsFolder(folder) {
  const src = join(folder, 'src');
  const own = readdirSync(src).filter(name => /\.[ch]$/.test(name)).map(name => join(src, name));
  if (!own.some(file => ASKS_FOR_TWINS.test(readFileSync(file, 'utf8')))) return null;
  // what reads a function's comment is match's, and the labels' shifts and the names' addresses are the game's proof's
  const [{ twinsIn }, { readShifts }, { readAddresses }, { sharedProofFolder }] = await Promise.all([import('../gba/match.mjs'), import('../portmap.mjs'), import('../match.mjs'), import('./paths.mjs')]);
  const game = relative(join(REPO, 'games'), folder).split(sep).join('/');
  const shifts = readShifts(game);
  const twins = own.filter(file => file.endsWith('.c')).flatMap(file => twinsIn(readFileSync(file, 'utf8'), shifts));
  const names = join(sharedProofFolder(game), 'addresses.json');
  const text = twinsHeader(twins, existsSync(names) ? readAddresses(names) : new Map());
  const made = join(LOCAL, 'c', 'twins', ...game.split('/'));
  const header = join(made, 'twins.h');
  if (!existsSync(header) || readFileSync(header, 'utf8') !== text) {
    mkdirSync(made, { recursive: true });
    writeFileSync(header, text);
  }
  return made;
}

/** The folders under kit/ a game's build reads on `console`, as the repository has them, such as kit/c/ and kit/gba/c/. */
export const kitPaths = id => [C_BASE, ...(OWN[id] ? [OWN[id].folder] : [])].map(folder => `${inRepo(folder).replace(/\/$/, '')}/`);
