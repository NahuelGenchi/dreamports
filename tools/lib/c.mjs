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
import { librariesFile, versionLibraries } from './libraries.mjs';
import { BINARYEN_VERSION, binaryen } from './binaryen.mjs';
import { readOriginal } from './proof-files.mjs';

// a version's original.json as it reads it, or null for one that has none
const readOriginalOf = game => {
  try {
    return readOriginal(game);
  } catch {
    return null;
  }
};

/** The base every console's kit in C shares: kit.h, the copy, the save memory, the start point's words, memory and
 *  the picture, and what a console with no kit of its own runs on (console.c, native.c). */
export const C_BASE = fileURLToPath(new URL('../../kit/c/', import.meta.url));

// the consoles with a kit in C of their own, on top of the base: its folder and its sources. One with `header` also has
// console.h, and runs on a computer with the base's program for one (native.c), as a console with no kit of its own does
const OWN = {
  gba: {
    folder: fileURLToPath(new URL('../../kit/gba/c/', import.meta.url)), sources: ['gba.c', 'video.c', 'apu.c', 'm4a.c', 'sound.c', 'memory.c', 'clock.c', 'stack.c'],
    // what the console's compiler takes for granted, which C written for it leans on: a char with no sign, and code
    // that reads a value through a pointer of another type or through address 0
    twinFlags: ['-funsigned-char', '-fno-strict-aliasing', '-fno-delete-null-pointer-checks'],
  },
  nes: { folder: fileURLToPath(new URL('../../kit/nes/c/', import.meta.url)), sources: ['nes.c', 'ppu.c', 'apu.c'], header: true },
  ps2: { folder: fileURLToPath(new URL('../../kit/ps2/c/', import.meta.url)), sources: ['ps2.c', 'gs.c', 'gs-memory.c', 'gif.c', 'ee.c', 'vu.c', 'iop.c', 'iop-bios.c', 'sif.c', 'spu2.c', 'pad.c', 'cdvd.c', 'mc.c'], header: true },
  ps1: { folder: fileURLToPath(new URL('../../kit/ps1/c/', import.meta.url)), sources: ['ps1.c', 'gpu.c'], header: true },
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
 *  own (`native` also has its program for this computer, and leaves out what only WebAssembly needs), `own`, whether
 *  the console has a kit of its own, and `twinFlags`, what the compiler is also asked for C written as the console's
 *  own compiler reads it, a game's twins: by the build, for a game that includes "twins.h", and by the function check. */
export function cKit(id) {
  if (!CONSOLES[id]) throw new Error(`There's no console called ${id} in kit/consoles.js, so there's no kit in C for it.`);
  const own = OWN[id];
  const base = name => join(C_BASE, name);
  // the player's disc, for a console whose games come on one (disc.h)
  const disc = CONSOLES[id].disc ? [base('disc.c')] : [];
  if (own && !own.header) {
    const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...disc, ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, own.folder], sources, native: [...sources.filter(f => !f.endsWith('libc.c')), join(own.folder, 'native.c')], twinFlags: own.twinFlags ?? [] };
  }
  // console.h, written where the tools keep what they make, once it says something new
  const made = join(LOCAL, 'c', id);
  const header = join(made, 'console.h'), text = consoleHeader(id);
  if (!existsSync(header) || readFileSync(header, 'utf8') !== text) {
    mkdirSync(made, { recursive: true });
    writeFileSync(header, text);
  }
  if (own) {
    const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...disc, ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, made, own.folder], sources, native: [...sources.filter(f => !f.endsWith('libc.c')), base('native.c')], twinFlags: own.twinFlags ?? [] };
  }
  const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...disc, base('console.c')];
  return { id, own: false, folders: [C_BASE, made], sources, native: [base('kit.c'), base('pause.c'), ...disc, base('console.c'), base('native.c')], twinFlags: [] };
}

/** How every build of a game's C works it out, the function check's too (../gba/twin.mjs): made fast the same way, and
 *  with the same arithmetic everywhere. */
export const SAME_FLAGS = ['-O2', '-fwrapv'];
/** What every build to WebAssembly asks for: no library but the kit's, and the instructions every browser the site
 *  supports has. */
export const WASM_FLAGS = ['--target=wasm32', '-ffreestanding', '-nostdlib', '-mbulk-memory', '-msign-ext', '-mnontrapping-fptoint'];
// what a game's builds ask of its C besides: C11, and warnings that catch a slip
const FLAGS = ['-std=c11', ...SAME_FLAGS, '-Wall', '-Wextra', '-Wno-unused-parameter'];
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
 *  as cKit gives them, `flags`, anything more the compiler is asked, and `addressOf(name)`, where the console keeps a
 *  value the C names and doesn't define, or null. A module inside the repository that was built from the same files, asked the same way of the
 *  same compiler, is left as it is, with nothing printed. */
export function buildWasm(sources, out, kit) {
  if (!building.has(out)) building.set(out, build(sources, out, kit).finally(() => building.delete(out)));
  return building.get(out);
}

async function build(sources, out, { folders, flags = [], addressOf = null, codeOf = null }) {
  // the compiler runs in a folder of its own, with the repository's C at the same paths
  const files = filesFor(sources, folders), name = basename(out);
  const args = ['clang', ...WASM_FLAGS, ...FLAGS, ...flags,
    // with addresses to place, the linker leaves what says where each one goes, and a name nothing defines for them
    ...folders.flatMap(folder => ['-I', inRepo(folder)]), '-Wl,--no-entry', '-Wl,-z,stack-size=1048576', ...(addressOf ? ['-Wl,--emit-relocs', '-Wl,--allow-undefined'] : ['-Wl,--strip-all']), '-o', name,
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
  const linked = addressOf ? await atAddresses(made[name], addressOf, codeOf) : made[name];
  const waits = waitsInside(linked);
  const module = waits ? await withWaits(linked) : linked;
  writeFileSync(out, module);
  if (from) remember(key, { from, module: sha1(module), ...(waits ? { pass: BINARYEN_VERSION } : {}) });
  return out;
}

// A module whose C names values it doesn't define, each put where the console keeps it, as the function check puts
// them (wasm-addresses.mjs): so a twin names a value of the console's memory as plain C does, with `extern`, in the
// game's build too. A name with no address stops the build, as a linker would.
async function atAddresses(module, addressOf, codeOf = null) {
  const { placeAddresses } = await import('./wasm-addresses.mjs');
  // a game of twins keeps a function's address as the original's and calls through it to the twin, through its table
  // (twins.h's TWIN_TABLE), as the function check does: so the same C keeps the same memory in the game too
  const placed = placeAddresses({ module, addressOf, ...(codeOf ? { codeOf, translate: 'kit_twin', own: name => name === 'kit_twin' } : {}) });
  // a function of the original the C calls and doesn't define yet is left for the page, which stops the game if it's
  // ever called (kit/c/game.js), as a call to an address with no twin does
  const called = WebAssembly.Module.imports(new WebAssembly.Module(placed.module)).filter(each => each.module === 'env' && addressOf(each.name) === null).map(each => each.name);
  if (placed.missing.length || called.length) {
    throw new Error(`The C didn't build to WebAssembly: nothing defines ${[...placed.missing, ...called].join(', ')}${placed.missing.length ? ', and the game\'s proof/addresses.json gives no address for a value of that name' : ''}.`);
  }
  return Buffer.from(placed.module);
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
 *  proof/original.json. A version's own proof/original.json, as a trial has (src/lib/languages.mjs), names no console:
 *  the game's does. */
export function consoleOfFolder(folder) {
  for (const place of [folder, dirname(folder)]) {
    const file = join(place, 'proof', 'original.json');
    const console = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).console : undefined;
    if (console !== undefined) return console;
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

/** The shared libraries the version of a game whose folder is `folder` takes, as versionLibraries gives them
 *  (libraries.mjs), on the console `id`: none for a folder outside games/ or a version that takes none. */
function librariesOfFolder(folder, id) {
  const game = relative(join(REPO, 'games'), folder).split(sep).join('/');
  if (!game || game.startsWith('..') || isAbsolute(game) || !existsSync(librariesFile(game))) return [];
  return versionLibraries(game, id);
}

/** A game's own C, every .c file in its folder's src/, such as games/<game>/c/src/, built with its console's kit to
 *  src/game.wasm there, or to `out`, with the files of the shared libraries it takes, from their folders in the kit. */
export async function buildGame(folder, out = join(folder, 'src', 'game.wasm')) {
  const kit = cKit(consoleOfFolder(folder)), own = ownSources(folder);
  const libraries = librariesOfFolder(folder, kit.id);
  const sources = [...own, ...libraries.flatMap(library => library.files), ...kit.sources], folders = [...kit.folders, ...libraries.map(library => library.library.folder)];
  // where the copy keeps each value a library names, as ADDRESS_<name>, on a console whose game has no twins.h to say it
  const defines = kit.id === 'gba' ? [] : libraries.flatMap(library => [...library.values].map(([name, value]) => `-DADDRESS_${name}=0x${value.toString(16).toUpperCase()}`));
  const twins = await twinsFolder(folder);
  if (!twins) return buildWasm(sources, out, { ...kit, folders, ...(defines.length ? { flags: defines } : {}) });
  // a game of twins is C written as the console's compiler reads it, and is built as the function check builds it:
  // with what that compiler takes for granted, and each value it names where the console keeps it
  const flags = [...kit.twinFlags, ...defines, '-Wl,--export-if-defined=kit_twin'], all = [...folders, twins.folder];
  // one that matches the console's work memory has the console's stack too, as its functions proven by the same bytes
  // leave it (../gba/stack.mjs): its own files are built from copies with the stack's calls in
  const game = relative(join(REPO, 'games'), folder).split(sep).join('/');
  if (kit.id === 'gba' && !game.startsWith('..') && readOriginalOf(game)?.workMemory) {
    const { stackSources } = await import('../gba/stack.mjs');
    const src = join(folder, 'src'), withSrc = [...all, src];
    const args = [...WASM_FLAGS, ...FLAGS, ...flags.filter(f => !f.startsWith('-Wl')), ...withSrc.flatMap(f => ['-I', inRepo(f)])];
    const made = await stackSources({ game, folder, own, args, filesTree: filesFor(sources, withSrc), out: join(LOCAL, 'c', 'stack', ...game.split('/')), repo: REPO });
    const stacked = sources.map(file => made.sources[own.indexOf(file)] ?? file);
    return buildWasm(stacked, out, { ...kit, folders: withSrc, flags, addressOf: twins.addressOf, codeOf: twins.codeOf });
  }
  return buildWasm(sources, out, { ...kit, folders: all, flags, addressOf: twins.addressOf, codeOf: twins.codeOf });
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
export function twinsHeader(twins, named = new Map(), sizeOf = () => null) {
  const addresses = new Map(named);
  const listed = [], code = [];
  for (const { name, address, own } of twins) {
    if (address === null) continue;
    if (!addresses.has(name)) addresses.set(name, address >= 0x08000000 ? address | 1 : address);
    if (!own && !listed.includes(name)) listed.push(name);
    // a twin of the cartridge's code, with how long the original's is, for a copy of it the game runs elsewhere
    const size = sizeOf(address & ~1);
    if (!own && address >= 0x08000000 && size && !code.some(each => each.name === name)) code.push({ name, address: address & ~1, size: Math.min(size, 512) });
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

// every twin of the cartridge's code, where the original has it and how long it is, to know a copy of it the game runs
// from elsewhere, as one that can't run from the cartridge while it reads the flash
#define TWIN_CODE(CODE_OF) ${code.map(({ name, address, size }) => `CODE_OF(${name}, ${hex(address)}, ${size}u)`).join(' ')}

/** The twin of the function the original has at \`address\`, as memory keeps it. It stops the game if there's none. */
void *kit_twin(uint32_t address);
/** The address the original has \`function\` at, as a pointer of the function's own kind, for a value kept in memory. */
#define TWIN_ADDRESS(function) ((__typeof__(&function))(uintptr_t)ADDRESS_##function)
/** The twin that a pointer kept in memory names, to call. */
#define TWIN(pointer) ((__typeof__(pointer))kit_twin((uint32_t)(uintptr_t)(pointer)))
/** Whether the \`size\` bytes at \`at\` are the original's code at \`from\`, a copy of it, and all in the module's memory. */
#define TWIN_SAME_CODE \\
  static int kit_twin_copy_of(uint32_t at, uint32_t from, uint32_t size) { \\
    if (at + size < at || at + size > __builtin_wasm_memory_size(0) * 65536u) return 0; \\
    for (uint32_t i = 0; i < size; i++) \\
      if (((const volatile uint8_t *)(uintptr_t)at)[i] != ((const volatile uint8_t *)(uintptr_t)from)[i]) return 0; \\
    return 1; \\
  }
/** Defines kit_twin: write it once, in a file that declares every twin. A small number is a function of the module's
 *  own, as C keeps its pointers. An address with no twin, where the game copied one of the cartridge's functions, is
 *  that function's twin, as the console runs the copy as it would the original. */
#define TWIN_TABLE \\
  TWIN_SAME_CODE \\
  void *kit_twin(uint32_t address) { \\
    if (address < 0x10000u) return (void *)(uintptr_t)address; \\
    switch (address) { TWINS(TWIN_CASE) } \\
    TWIN_CODE(TWIN_COPY) \\
    if (address < 0x02000000u) return (void *)(uintptr_t)address; \\
    __builtin_trap(); \\
  }
#define TWIN_CASE(name) case ADDRESS_##name: return (void *)name;
#define TWIN_COPY(name, from, size) if (kit_twin_copy_of(address & ~1u, from, size)) return (void *)name;

#endif
`;
}

/** A game's twins.h, written if what it would say is new, as { folder, named, addressOf }, the folder it's in, the
 *  names the game gives addresses, and where the console keeps what a name names, as match and the function check
 *  read it, a label by its own address among them, or null for a game that doesn't include it: `folder` is the
 *  game's, or its version's. */
export async function twinsFolder(folder) {
  const src = join(folder, 'src');
  if (!existsSync(src)) return null;
  const own = readdirSync(src).filter(name => /\.[ch]$/.test(name)).map(name => join(src, name));
  if (!own.some(file => ASKS_FOR_TWINS.test(readFileSync(file, 'utf8')))) return null;
  // the twins and the names' addresses are read as match and the function check read them (twins.mjs)
  const { versionTwins } = await import('./twins.mjs');
  const game = relative(join(REPO, 'games'), folder).split(sep).join('/');
  const { twinsOf, named, twins, shifts, libraries } = versionTwins(game);
  const { addressFinder } = await import('../gba/match.mjs');
  // how long each of the original's functions is, from the game's code map, to know a copy of one
  const { inBootProgram, readCodeMap } = await import('./proof-files.mjs');
  const sizes = new Map((readCodeMap(game)?.functions ?? []).filter(inBootProgram).map(f => [f.address, f.size]));
  const text = twinsHeader([...own.filter(file => file.endsWith('.c')), ...libraries.flatMap(library => library.files)].flatMap(file => twinsOf.get(file) ?? []), named, address => sizes.get(address) ?? null);
  const made = join(LOCAL, 'c', 'twins', ...game.split('/'));
  const header = join(made, 'twins.h');
  if (!existsSync(header) || readFileSync(header, 'utf8') !== text) {
    mkdirSync(made, { recursive: true });
    writeFileSync(header, text);
  }
  return { folder: made, named, addressOf: addressFinder({ named, twins, shifts }), codeOf: name => (twins.get(name)?.size === 1 ? [...twins.get(name)][0] | 1 : null) };
}

/** The folders under kit/ a game's build reads on `console`, as the repository has them, such as kit/c/ and kit/gba/c/. */
export const kitPaths = id => [C_BASE, ...(OWN[id] ? [OWN[id].folder] : [])].map(folder => `${inRepo(folder).replace(/\/$/, '')}/`);
