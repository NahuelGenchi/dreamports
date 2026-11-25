// Builds a game written in C on its console's kit in C (kit/c/README.md): to WebAssembly, which its page runs, and for
// this computer, which runs the same C with no browser. Every console's kit is the base every console shares, kit/c/,
// with the console's own on top where it has one, as the Game Boy Advance has kit/gba/c/, the NES kit/nes/c/, the Game Boy and the Game Boy Color kit/gbc/c/, the
// PlayStation kit/ps1/c/, the PlayStation 2 kit/ps2/c/, the Super Nintendo kit/snes/c/ and the Nintendo 64 kit/n64/c/, and
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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
    // that reads a value through a pointer of another type or through address 0; and, as twins keep every value where
    // the console does, the colours, the video memory and the sprites' list at the console's addresses (gba.h)
    twinFlags: ['-funsigned-char', '-fno-strict-aliasing', '-fno-delete-null-pointer-checks', '-DGBA_CONSOLE_ADDRESSES'],
    // and in the function check, a game's own table of twins leaves an address with no twin to the check (twinsHeader)
    checkFlags: ['-DDP_TWIN_CHECK'],
  },
  nds: { folder: fileURLToPath(new URL('../../kit/nds/c/', import.meta.url)), sources: ['nds.c', 'video.c', 'ipc.c', 'irq.c', 'sound.c'], header: true },
  nes: { folder: fileURLToPath(new URL('../../kit/nes/c/', import.meta.url)), sources: ['nes.c', 'ppu.c', 'apu.c'], header: true },
  gb: { folder: fileURLToPath(new URL('../../kit/gbc/c/', import.meta.url)), sources: ['gb.c', 'lcd.c', 'apu.c'], header: true },
  ps2: { folder: fileURLToPath(new URL('../../kit/ps2/c/', import.meta.url)), sources: ['ps2.c', 'gs.c', 'gs-memory.c', 'gif.c', 'ee.c', 'floats.c', 'vu.c', 'bus.c', 'dmac.c', 'vif.c', 'mmi.c', 'iop.c', 'iop-bios.c', 'sif.c', 'spu2.c', 'pad.c', 'cdvd.c', 'mc.c'], header: true },
  ps1: { folder: fileURLToPath(new URL('../../kit/ps1/c/', import.meta.url)), sources: ['ps1.c', 'gpu.c', 'draw.c', 'sound.c', 'pad.c', 'clock.c', 'cd.c'], header: true,
    // psx_gpu, which draw.c builds as one with itself, dfsound, which sound.c does, and the emulator's CD drive, which
    // cd.c does, each in a folder of its own that isn't on the include path
    trees: ['psx_gpu', 'dfsound', 'cdrom'],
    // what never waits for the disc or the screen, as it never reaches the game's code, the clock or the disc: psx_gpu
    // and dfsound, which the pass that makes waits work leaves as they are, as it takes most of a build's time
    // otherwise and slows drawing and mixing (withWaits)
    neverWait: ['draw.c', 'sound.c'],
    // the few C library headers psx_gpu, dfsound and the CD drive take, which the kit built to WebAssembly has no other of
    includes: ['libc'] },
  // the function check builds it noting each read and write of the hardware, to compare with the original's; and a game
  // keeps its own values above the console's 16 MB, as its C keeps the console's at their own addresses (snes.h)
  snes: { folder: fileURLToPath(new URL('../../kit/snes/c/', import.meta.url)), sources: ['snes.c', 'ppu.c', 'dma.c', 'apu.c', 'dsp.c', 'timing.c', 'frame.c'], header: true, checkFlags: ['-DDP_TWIN_CHECK'], gameFlags: ['-Wl,--global-base=16777216', '-Wl,--initial-memory=33554432'] },
  n64: {
    folder: fileURLToPath(new URL('../../kit/n64/c/', import.meta.url)), sources: ['n64.c', 'rsp.c', 'vu.c', 'rdp.c', 'vi.c'], header: true,
    // the function check builds it with each read and write the processor's own load or store, which its pass over
    // the module sends to the console's memory, so a twin written on the kit is checked as it plays (n64.c)
    checkFlags: ['-DDP_TWIN_CHECK'],
    // a char with no sign, as IDO, which most of its games were built with, has it, code that reads a value through a
    // pointer of another type or through address 0, and no two stores the compiler sees side by side made into one, as
    // the fold pass turns round each number by its own size, which two merged in the module's own order would undo
    // (wasm-fold.mjs)
    twinFlags: ['-funsigned-char', '-fno-strict-aliasing', '-fno-delete-null-pointer-checks', '-mllvm', '-combiner-store-merging=false'],
  },
};

// the Game Boy Color's kit is the Game Boy's: one kit for both, as they share nearly all their hardware
OWN.gbc = OWN.gb;

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
// and the most a second can hold, a whole number, where the rate isn't one, as the Nintendo DS's
#define CONSOLE_SOUND_MOST ${Math.ceil(machine.sound)}
${machine.screens ? `
// its screens in the picture, one above the other, and the one that's touched (kit_touch, kit.h)
#define SCREEN_COUNT ${machine.screens.length}
${machine.screens.map(([left, top, across, down], n) => `#define SCREEN_${n}_X ${left}\n#define SCREEN_${n}_Y ${top}\n#define SCREEN_${n}_W ${across}\n#define SCREEN_${n}_H ${down}`).join('\n')}
#define TOUCHED_SCREEN ${machine.touch}
` : ''}
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
    return { id, own: true, folders: [C_BASE, own.folder, ...(own.includes ?? []).map(name => join(own.folder, name))], trees: (own.trees ?? []).map(name => join(own.folder, name)), sources, native: [...sources.filter(f => !f.endsWith('libc.c')), join(own.folder, 'native.c')], twinFlags: own.twinFlags ?? [], checkFlags: own.checkFlags ?? [], neverWait: (own.neverWait ?? []).map(name => join(own.folder, name)) };
  }
  // console.h, written where the tools keep what they make, once it says something new
  const made = join(LOCAL, 'c', id);
  const header = join(made, 'console.h'), text = consoleHeader(id);
  if (!existsSync(header) || readFileSync(header, 'utf8') !== text) {
    mkdirSync(made, { recursive: true });
    writeFileSync(header, text);
  }
  if (own) {
    const sources = [base('kit.c'), base('pause.c'), base('libc.c'), ...disc, ...(own.generalPage ? [base('console.c')] : []), ...own.sources.map(name => join(own.folder, name))];
    return { id, own: true, folders: [C_BASE, made, own.folder, ...(own.includes ?? []).map(name => join(own.folder, name))], trees: (own.trees ?? []).map(name => join(own.folder, name)), sources, native: [...sources.filter(f => !f.endsWith('libc.c')), base('native.c')], twinFlags: own.twinFlags ?? [], checkFlags: own.checkFlags ?? [], gameFlags: own.gameFlags ?? [], neverWait: (own.neverWait ?? []).map(name => join(own.folder, name)) };
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

// a kit's folders that its own files include from by their path, without them being on the include path
const TREES = Object.values(OWN).flatMap(own => (own.trees ?? []).map(name => ({ kit: resolve(own.folder), folder: join(own.folder, name) })));

// every .c and .h file in the folders the sources are in and in the kit's, and in the folders a kit's own files include
// from by their path, in folders as they are in the repository, for the compiler's own
function filesFor(sources, folders) {
  const tree = {}, all = [...folders, ...sources.map(dirname)];
  const trees = TREES.filter(each => all.some(folder => resolve(folder) === each.kit)).map(each => each.folder);
  for (const folder of new Set([...all, ...trees])) {
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

// Each kit source built to an object once, and kept by everything it's built from, so every game's build, and every
// run of the function check, links it as it is: the PlayStation's draw.c, which builds psx_gpu, takes a minute and a
// half to build to WebAssembly, the same in every game. A kept object no build has asked for in two weeks goes.
const OBJECTS = join(LOCAL, 'c', 'objects');
const KEPT_DAYS = 14;

/** The object `make()` builds, `{ made }`, or what went wrong, `{ error }`, from the compiler's file tree `files` and
 *  what it's asked, `args`: kept in .dreamports/c/objects/ by all three and the compiler's version, so it's made once,
 *  and again only when one of those changes. The compiler runs with no file but those in `files`, every file of each
 *  folder on its include path and of the kit's own folders it includes from by their path, so every header a source
 *  can include is in the key, as is every flag and define in `args`. With no compiler installed, nothing is kept. */
export async function keptObject(files, args, make) {
  const compiler = compilerVersion(), file = compiler ? join(OBJECTS, `${buildFingerprint(files, args, compiler)}.o`) : null;
  if (file && existsSync(file)) {
    // a kept object's time is when a build last took it
    const now = new Date();
    utimesSync(file, now, now);
    return { made: readFileSync(file) };
  }
  const built = await make();
  if (file && built.made) {
    mkdirSync(OBJECTS, { recursive: true });
    const part = `${file}.${process.pid}.part`;
    writeFileSync(part, built.made);
    renameSync(part, file);
    const old = Date.now() - KEPT_DAYS * 24 * 3600 * 1000;
    for (const name of readdirSync(OBJECTS)) {
      try {
        if (statSync(join(OBJECTS, name)).mtimeMs < old) rmSync(join(OBJECTS, name), { force: true });
      } catch {}
    }
  }
  return built;
}

// whether a source is the kit's own, the base's or a console's, which keptObject keeps the object of
const KIT_FOLDERS = [C_BASE, ...Object.values(OWN).map(own => own.folder)].map(folder => resolve(folder));
const ofKit = source => KIT_FOLDERS.some(folder => !relative(folder, resolve(source)).startsWith('..'));

/** Builds `sources` (paths of .c files) to the WebAssembly module `out`, with the kit's `folders` to include it from,
 *  as cKit gives them, `flags`, anything more the compiler is asked, and `addressOf(name)`, where the console keeps a
 *  value the C names and doesn't define, or null. The kit's own sources come from their kept objects (keptObject). A
 *  module inside the repository that was built from the same files, asked the same way of the same compiler, is left
 *  as it is, with nothing printed. */
export function buildWasm(sources, out, kit) {
  if (!building.has(out)) building.set(out, build(sources, out, kit).finally(() => building.delete(out)));
  return building.get(out);
}

async function build(sources, out, { folders, flags = [], addressOf = null, codeOf = null, neverWait = [] }) {
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
  // the kit's own sources each from its kept object, built as the whole build would build it
  const compileArgs = [...WASM_FLAGS.filter(flag => flag !== '-nostdlib'), ...FLAGS, ...flags.filter(flag => !flag.startsWith('-Wl,')), ...folders.flatMap(folder => ['-I', inRepo(folder)])];
  const objects = {}, own = [];
  // the functions the kit's sources that never wait define, as many times as each name is defined there
  const never = new Map(), neverFrom = new Map(), waitless = neverWait.map(source => resolve(source));
  for (const source of sources) {
    if (!ofKit(source)) {
      own.push(inRepo(source));
      continue;
    }
    const tree = filesFor([source], folders), ask = ['clang', ...compileArgs, '-c', inRepo(source), '-o', 'object.o'];
    const built = await keptObject(tree, ask, async () => {
      let object;
      try {
        object = await runClang(ask, tree, { stdout: stderr, stderr });
      } catch (error) {
        return { error: said.trim() || String(error.message ?? error).trim() };
      }
      return object?.['object.o'] ? { made: object['object.o'] } : { error: said.trim() || 'the compiler wrote nothing.' };
    });
    if (built.error) throw new Error(`The C didn't build to WebAssembly:\n${built.error}`);
    objects[`${Object.keys(objects).length}.o`] = built.made;
    if (waitless.includes(resolve(source))) {
      for (const name of definedFunctions(built.made)) {
        never.set(name, (never.get(name) ?? 0) + 1);
        neverFrom.set(name, inRepo(source));
      }
    }
  }
  const link = [...args.slice(0, args.length - sources.length), ...own, ...Object.keys(objects).map(object => `__kit_objects/${object}`)];
  try {
    made = await runClang(link, { ...files, __kit_objects: objects }, { stdout: stderr, stderr });
  } catch (error) {
    throw new Error(`The C didn't build to WebAssembly:\n${said.trim() || String(error.message ?? error).trim()}`);
  }
  if (said.trim()) console.log(said.trim());
  if (!made?.[name]) throw new Error('The C didn\'t build to WebAssembly, and the compiler didn\'t say why.');
  const linked = addressOf ? await atAddresses(made[name], addressOf, codeOf) : made[name];
  const waits = waitsInside(linked);
  let module = linked;
  if (waits && never.size) {
    // the pass finds the functions by their names, which the linker drops, so the module is linked again with them
    const named = addressOf ? linked : (await runClang(link.filter(arg => arg !== '-Wl,--strip-all'), { ...files, __kit_objects: objects }, { stdout: stderr, stderr }))[name];
    // a name defined anywhere else too, in the game's own C, isn't left out, as that function may wait
    const graph = callGraph(named), counts = functionNames(graph);
    const leftOut = [...never].filter(([each, times]) => counts.get(each) === times).map(([each]) => each);
    // and what the kit says never waits mustn't reach a wait, through anything it calls: if it did, the pass would leave
    // it as it is, and a wait under it would break the game's stack
    const waiting = waitingAfterAll(graph, leftOut);
    if (waiting) {
      throw new Error(`The C didn't build to WebAssembly: ${neverFrom.get(waiting.name)} is among the kit's sources that never wait (neverWait in tools/lib/c.mjs), but its ${waiting.name} can wait: ${waiting.way.join(' → ')}.`);
    }
    module = await withWaits(named, leftOut);
  } else if (waits) {
    module = await withWaits(linked);
  }
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

// the functions a WebAssembly object of the compiler's defines, by name, from its symbol table (the linking section's,
// as WebAssembly's tool conventions write it)
function definedFunctions(object) {
  const sections = WebAssembly.Module.customSections(new WebAssembly.Module(object), 'linking');
  const names = [];
  if (!sections.length) return names;
  const bytes = new Uint8Array(sections[0]);
  let at = 0;
  const number = () => {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7F) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  const text = () => {
    const length = number();
    at += length;
    return Buffer.from(bytes.subarray(at - length, at)).toString('utf8');
  };
  number();
  while (at < bytes.length) {
    const kind = bytes[at++], end = number() + at;
    // the symbol table: a function's, a global's, an event's or a table's index, and its name when it's defined or
    // named; a value's name and, when defined, where; a section's index
    if (kind === 8) {
      for (let count = number(); count > 0; count--) {
        const type = bytes[at++], flags = number(), defined = !(flags & 0x10);
        if (type === 1) {
          text();
          if (defined) number(), number(), number();
        } else if (type === 3) {
          number();
        } else {
          number();
          if (defined || flags & 0x40) {
            const name = text();
            if (type === 0 && defined) names.push(name);
          }
        }
      }
    }
    at = end;
  }
  return names;
}

// A module's functions as their calls join them: each function's name, from its name section, the functions it calls,
// and the types it calls through a pointer, which can be any function of the table of that type; the table's
// functions by type; and which functions are the imports a wait ends a frame with (kit/c/pause.c's
// asyncify.start_unwind). Every instruction is read, so a call can't be missed: one this doesn't know stops the build.
function callGraph(module) {
  const bytes = new Uint8Array(module), types = [], imports = [], kinds = [], calls = [], through = [], table = new Map();
  const names = new Map();
  let at = 8;
  const number = () => {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7F) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  const text = () => {
    const length = number();
    at += length;
    return Buffer.from(bytes.subarray(at - length, at)).toString('utf8');
  };
  const limits = () => { if (bytes[at++] & 1) number(); number(); };
  // a constant expression, to its end, giving the function a ref.func names
  const constant = () => {
    let refers = null;
    for (;;) {
      const op = bytes[at++];
      if (op === 0x0B) return refers;
      if (op === 0xD2) refers = number();
      else if (op === 0x44) at += 8;
      else if (op === 0x43) at += 4;
      else if (op === 0xD0) at++;
      else number();
    }
  };
  // a function's code: what it calls, and the types it calls through a pointer
  const code = (end, called, typed) => {
    const count = number();
    for (let i = 0; i < count; i++) number(), at++;
    while (at < end) {
      const op = bytes[at++];
      if (op === 0x02 || op === 0x03 || op === 0x04) {
        if (bytes[at] === 0x40 || (bytes[at] >= 0x6F && bytes[at] <= 0x7F)) at++;
        else number();
      } else if (op === 0x0C || op === 0x0D || (op >= 0x20 && op <= 0x26) || op === 0xD2) {
        number();
      } else if (op === 0x0E) {
        for (let n = number() + 1; n > 0; n--) number();
      } else if (op === 0x10 || op === 0x12) {
        called.add(number());
      } else if (op === 0x11 || op === 0x13) {
        typed.add(types[number()]);
        number();
      } else if (op === 0x1C) {
        at += number();
      } else if (op >= 0x28 && op <= 0x3E) {
        number(), number();
      } else if (op === 0x3F || op === 0x40 || op === 0xD0) {
        at++;
      } else if (op === 0x41 || op === 0x42) {
        number();
      } else if (op === 0x43) {
        at += 4;
      } else if (op === 0x44) {
        at += 8;
      } else if (op === 0xFC) {
        const sub = number();
        if (sub === 8) number(), at++;
        else if (sub === 9 || sub === 13 || (sub >= 15 && sub <= 17)) number();
        else if (sub === 10 || sub === 12 || sub === 14) number(), number();
        else if (sub === 11) at++;
        else if (sub > 7) throw new Error(`the module has an instruction the wait check can't read (0xFC ${sub})`);
      } else if (!(op <= 0x01 || op === 0x05 || op === 0x0B || op === 0x0F || op === 0x1A || op === 0x1B || op === 0xD1 || (op >= 0x45 && op <= 0xC4))) {
        throw new Error(`the module has an instruction the wait check can't read (0x${op.toString(16)})`);
      }
    }
  };
  while (at < bytes.length) {
    const id = bytes[at++], size = number(), end = at + size;
    if (id === 1) {
      for (let n = number(); n > 0; n--) {
        at++;
        const params = [];
        for (let p = number(); p > 0; p--) params.push(bytes[at++]);
        const results = [];
        for (let r = number(); r > 0; r--) results.push(bytes[at++]);
        types.push(`${params.join(',')}>${results.join(',')}`);
      }
    } else if (id === 2) {
      for (let n = number(); n > 0; n--) {
        const from = text(), field = text(), kind = bytes[at++];
        if (kind === 0) {
          kinds.push(types[number()]);
          imports.push(`${from}.${field}`);
        } else if (kind === 1) {
          at++;
          limits();
        } else if (kind === 2) {
          limits();
        } else {
          at += 2;
        }
      }
    } else if (id === 3) {
      for (let n = number(); n > 0; n--) kinds.push(types[number()]);
    } else if (id === 9) {
      for (let n = number(); n > 0; n--) {
        const flags = number(), functions = [];
        if (flags & 2 && !(flags & 1)) number();
        if (!(flags & 1)) constant();
        if (flags & 3) at++;
        for (let e = number(); e > 0; e--) functions.push(flags & 4 ? constant() : number());
        for (const each of functions) if (each !== null) (table.get(kinds[each]) ?? table.set(kinds[each], new Set()).get(kinds[each])).add(each);
      }
    } else if (id === 10) {
      for (let n = number(), index = imports.length; n > 0; n--, index++) {
        const body = number() + at, called = new Set(), typed = new Set();
        code(body, called, typed);
        calls[index] = called;
        through[index] = typed;
        at = body;
      }
    } else if (id === 0 && text() === 'name') {
      while (at < end) {
        const kind = bytes[at++], part = number() + at;
        if (kind === 1) for (let n = number(); n > 0; n--) names.set(number(), text());
        at = part;
      }
    }
    at = end;
  }
  for (let i = 0; i < imports.length; i++) names.set(i, imports[i]);
  const waits = new Set(imports.flatMap((each, i) => (each === 'asyncify.start_unwind' ? [i] : [])));
  return { names, waits, callees: index => [...(calls[index] ?? []), ...[...(through[index] ?? [])].flatMap(type => [...(table.get(type) ?? [])])] };
}

// how many functions of a module have each name
function functionNames(graph) {
  const counts = new Map();
  for (const name of graph.names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

// Of the functions named `never`, the first that can reach a wait after all, through what it calls directly or through
// a pointer to any function of the table of that pointer's type, and the way it gets there, by name; or null.
function waitingAfterAll(graph, never) {
  const asked = new Set(never);
  for (const [index, name] of graph.names) {
    if (!asked.has(name)) continue;
    const from = new Map([[index, null]]), queue = [index];
    while (queue.length) {
      const at = queue.shift();
      if (graph.waits.has(at)) {
        const way = [];
        for (let step = at; step !== null; step = from.get(step)) way.unshift(graph.names.get(step) ?? `function ${step}`);
        return { name, way };
      }
      for (const next of graph.callees(at)) {
        if (!from.has(next)) {
          from.set(next, at);
          queue.push(next);
        }
      }
    }
  }
  return null;
}

/** A module whose C calls kit_wait_frame, after the pass that makes the wait work: Binaryen's Asyncify, which gives
 *  every function on the way to a wait a way to put its values away and come back to them, and takes the four calls
 *  the kit makes to it (kit/c/pause.c) as its own, so the module that comes out imports nothing new. The functions
 *  named in `neverWait`, which can't reach a wait, are left as they are; the module that comes out keeps no names. */
export async function withWaits(module, neverWait = []) {
  const tools = await binaryen();
  const parsed = tools.readBinary(module);
  try {
    // what the compiler was asked for above, and the part of bulk memory the pass's own code uses
    parsed.setFeatures(tools.Features.MutableGlobals | tools.Features.BulkMemory | tools.Features.BulkMemoryOpt | tools.Features.SignExt | tools.Features.NontrappingFPToInt);
    tools.setOptimizeLevel(2);
    tools.setShrinkLevel(0);
    // only the kit's wait ends a frame: nothing the page gives the game, such as its save memory, does
    tools.setPassArgument('asyncify-ignore-imports', '');
    tools.setPassArgument('asyncify-removelist', neverWait.length ? neverWait.join(',') : null);
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

// What a game's build is made of: its kit, its own C, the shared libraries it takes, every source and folder, the
// defines a library's values need, and, for a game of twins, its twins.h's folder and what the compiler is asked for it
async function partsOf(folder) {
  const kit = cKit(consoleOfFolder(folder)), own = ownSources(folder);
  const libraries = librariesOfFolder(folder, kit.id);
  const sources = [...own, ...libraries.flatMap(library => library.files), ...kit.sources], folders = [...kit.folders, ...libraries.map(library => library.library.folder)];
  // where the copy keeps each value a library names, as ADDRESS_<name>, on a console whose game has no twins.h to say it
  const defines = kit.id === 'gba' ? [] : libraries.flatMap(library => [...library.values].map(([name, value]) => `-DADDRESS_${name}=0x${value.toString(16).toUpperCase()}`));
  const twins = await twinsFolder(folder);
  const gameFlags = kit.gameFlags ?? [];
  // a game of twins is C written as the console's compiler reads it, and is built as the function check builds it:
  // with what that compiler takes for granted, and each value it names where the console keeps it
  const flags = twins ? [...kit.twinFlags, ...gameFlags, ...defines, '-Wl,--export-if-defined=kit_twin'] : [...gameFlags, ...defines];
  return { kit, own, libraries, sources, folders, twins, flags, all: twins ? [...folders, twins.folder] : folders };
}

// A game of twins on the Game Boy Advance that matches the console's work memory has the console's stack too, as its
// functions proven by the same bytes leave it (../gba/stack.mjs): its own files, and its shared libraries', are built
// from copies with the stack's calls in. Each such file's copy, and the folders they're built with, or null.
async function stackedOf(folder, { kit, own, libraries, sources, flags, all }) {
  const game = relative(join(REPO, 'games'), folder).split(sep).join('/');
  if (kit.id !== 'gba' || game.startsWith('..') || isAbsolute(game) || !readOriginalOf(game)?.workMemory) return null;
  const { stackSources } = await import('../gba/stack.mjs');
  const withSrc = [...all, join(folder, 'src')];
  const args = [...WASM_FLAGS, ...FLAGS, ...flags.filter(f => !f.startsWith('-Wl')), ...withSrc.flatMap(f => ['-I', inRepo(f)])];
  const stackable = [...own, ...libraries.flatMap(library => library.files)];
  const made = await stackSources({ game, folder, own: stackable, args, filesTree: filesFor(sources, withSrc), out: join(LOCAL, 'c', 'stack', ...game.split('/')), repo: REPO });
  return { copies: new Map(stackable.map((file, i) => [file, made.sources[i]])), folders: withSrc };
}

/** For the function check (../gba/twin.mjs): the copy of each of a version's files, its own and its shared libraries',
 *  that its build takes, with the console's stack's calls in, as a Map, or null for a version built from its files as
 *  they are. */
export async function stackedCopies(folder) {
  const parts = await partsOf(folder);
  return parts.twins ? (await stackedOf(folder, parts))?.copies ?? null : null;
}

/** A game's own C, every .c file in its folder's src/, such as games/<game>/c/src/, built with its console's kit to
 *  src/game.wasm there, or to `out`, with the files of the shared libraries it takes, from their folders in the kit. */
export async function buildGame(folder, out = join(folder, 'src', 'game.wasm')) {
  const parts = await partsOf(folder), { kit, sources, folders, twins, flags, all } = parts;
  if (!twins) return buildWasm(sources, out, { ...kit, folders, ...(flags.length ? { flags } : {}) });
  const stacked = await stackedOf(folder, parts);
  if (stacked) return buildWasm(sources.map(file => stacked.copies.get(file) ?? file), out, { ...kit, folders: stacked.folders, flags, addressOf: twins.addressOf, codeOf: twins.codeOf });
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
#ifdef DP_TWIN_CHECK
/** In the function check, an address with no twin is the check's to name, as one a twin can't follow (gba/twin.mjs). */
void *__twin_no_code(uint32_t address);
#define TWIN_NONE(address) return __twin_no_code(address);
#else
#define TWIN_NONE(address) __builtin_trap();
#endif
/** How kit_twin is built: with nothing of clang's optimizer, which turns a switch whose cases sit evenly apart, as
 *  twins at addresses 0x40 apart do, into a table of the functions in the module's data, where the build gives each
 *  function's address in the original as any value in data, and the twin's number is lost (#1952). */
#if defined(__clang__)
#define TWIN_KEEPS_NUMBERS __attribute__((optnone, noinline))
#else
#define TWIN_KEEPS_NUMBERS
#endif
/** Defines kit_twin: write it once, in a file that declares every twin. A small number is a function of the module's
 *  own, as C keeps its pointers. An address with no twin, where the game copied one of the cartridge's functions, is
 *  that function's twin, as the console runs the copy as it would the original. */
#define TWIN_TABLE \\
  TWIN_SAME_CODE \\
  TWIN_KEEPS_NUMBERS void *kit_twin(uint32_t address) { \\
    if (address < 0x10000u) return (void *)(uintptr_t)address; \\
    switch (address) { TWINS(TWIN_CASE) } \\
    TWIN_CODE(TWIN_COPY) \\
    if (address < 0x02000000u) return (void *)(uintptr_t)address; \\
    TWIN_NONE(address) \\
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
