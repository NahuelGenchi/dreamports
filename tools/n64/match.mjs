// What match does for a Nintendo 64 game (../match.mjs): builds one file of C with IDO, Silicon Graphics' compiler, as
// the original was built (ido.mjs), fills in every address a linker would, with each name's address in the original,
// and compares each function with the code the cartridge starts, a word at a time, as the console keeps it, highest
// byte first. Nothing between the C and the bytes is the tools' own: IDO's driver runs its compiler, its optimizer, its
// code generator and its assembler, and what comes out is the object file a game's makers got.
//
// An object keeps a file's values in sections of their own, a switch's table and a text in quotes in .rodata, a
// variable in .data or .bss, and its code reaches each as its section and a distance into it. The linker put each
// section of the file somewhere in the program, whole, so every reference into a section has to agree on where: the
// PlayStation 2's way of reading and comparing an object does that (../ps2/match.mjs, objectOf and matchObject), here
// with the console's byte order and the VR4300's instructions. The game-level part, which files to build, what to say
// and which proofs to keep, is the PlayStation's (../ps1/match.mjs, matchGameOn): only the console's own is here.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, sep } from 'node:path';
import { twinsIn, preprocess } from '../gba/match.mjs';
import { matchGameOn } from '../ps1/match.mjs';
import { matchObject, objectOf } from '../ps2/match.mjs';
import { ps1Resolve } from '../ps1/read.mjs';
import { decode } from '../lib/mips.mjs';
import { buildIdo, IDO_VERSIONS } from './ido.mjs';
import { n64Cartridge, programOf } from './functions.mjs';
import { gpOf } from './twin.mjs';

// a flag that says how the code is made, which is all a game's proof/original.json may give the compiler: none that
// names a file or a folder, nor asks for something other than an object
const FLAG = /^-(?!o$|[IDULlBYEScP]|M)[A-Za-z][\w=.,+:-]*$/;
// a name that is a label and nothing else, as func_80246000 or D_80331234
const LABEL = /^[A-Za-z][A-Za-z0-9]*_80[0-7][0-9A-Fa-f]{5}$/;
const ADDRESS = /^[0-9A-F]{8}$/;

function compilerOf(given, where, what) {
  if (given.name !== 'ido') throw new Error(`${where} names the compiler "${given.name}"${what}, and on the Nintendo 64 the tools have ido, Silicon Graphics' IDO.`);
  if (!IDO_VERSIONS.includes(given.version)) throw new Error(`${where} names IDO ${given.version ?? 'with no "version"'}${what}, and the tools build ${IDO_VERSIONS.join(' and ')}.`);
  if (!Array.isArray(given.flags) || !given.flags.every(flag => typeof flag === 'string' && (FLAG.test(flag) || /^\d+$/.test(flag)))) {
    throw new Error(`${where} needs the compiler's "flags"${what} as a list of those that say how the code is made, such as "-O2", "-mips2" and "-G", "0", and none that names a file.`);
  }
  return { name: 'ido', version: given.version, flags: given.flags };
}

/**
 * A Nintendo 64 game's compiler as its proof/original.json gives it, checked: { name: "ido", version: "5.3", flags:
 * [...], stretches }, `stretches` the parts of the code built another way, as libultra in a game often is, each
 * { from, to, ...the same }, with its first and last address as eight capital hexadecimal digits.
 */
export function readCompiler(original, where) {
  const { compiler } = original;
  if (!compiler) throw new Error(`${where} doesn't say how the original was built: it needs "compiler": { "name": "ido", "version": "5.3", "flags": [...] } (tools/README.md, Matching the original's bytes).`);
  if (!Array.isArray(compiler.stretches ?? [])) throw new Error(`${where} needs the compiler's "stretches" as a list.`);
  const stretches = (compiler.stretches ?? []).map(stretch => {
    if (!ADDRESS.test(stretch?.from) || !ADDRESS.test(stretch?.to) || parseInt(stretch.from, 16) > parseInt(stretch.to, 16)) {
      throw new Error(`${where} needs each of the compiler's "stretches" with its first and last address, "from" and "to", as eight capital hexadecimal digits.`);
    }
    return { from: parseInt(stretch.from, 16), to: parseInt(stretch.to, 16), ...compilerOf({ name: compiler.name, version: compiler.version, ...stretch }, where, ` for ${stretch.from} to ${stretch.to}`) };
  }).sort((a, b) => a.from - b.from);
  for (let i = 1; i < stretches.length; i++) if (stretches[i].from <= stretches[i - 1].to) throw new Error(`${where} has two of the compiler's "stretches" that overlap.`);
  return { ...compilerOf(compiler, where, ''), stretches };
}

/** The way the original's code at `address` was built: a stretch's, or the game's own. */
export function wayAt(compiler, address) {
  const { name, version, flags } = compiler.stretches?.find(each => address >= each.from && address <= each.to) ?? compiler;
  return { name, version, flags };
}

/** What a compiler's way is called, to tell two apart. */
export const wayText = way => `IDO ${way.version} ${way.flags.join(' ')}`;

/**
 * Builds `file` as match does, with IDO's own driver: the C as the tools' preprocessor reads it, as every build of a
 * game's C does, into <work>.i, and IDO's object, <work>.o. Gives { object }, its bytes, or { error }, what IDO said.
 */
export async function compileFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, log = () => {} }) {
  mkdirSync(dirname(work), { recursive: true });
  let preprocessed;
  try {
    preprocessed = await preprocess(file, root, includes);
  } catch (error) {
    return { error: error.message };
  }
  writeFileSync(`${work}.i`, preprocessed);
  let cc;
  try {
    cc = buildIdo(compiler.version, log);
  } catch (error) {
    return { error: error.message };
  }
  rmSync(`${work}.o`, { force: true });
  const run = spawnSync(cc, ['-c', ...compiler.flags, '-o', `${basename(work)}.o`, `${basename(work)}.i`], { cwd: dirname(work), encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (run.error) return { error: `IDO didn't run: ${run.error.message}` };
  if (run.status !== 0 || !existsSync(`${work}.o`)) return { error: `${(run.stderr || run.stdout || '').trim() || `IDO ended with ${run.status}`}`.replaceAll(`${basename(work)}.i`, basename(file)) };
  return { object: readFileSync(`${work}.o`) };
}

/**
 * Builds `file` and compares each function it defines with the original's, as the PlayStation's matchFile does, with
 * the same arguments and the same answer, or { error } when the file didn't build. `program` is the code the
 * cartridge starts, { load, text }, in the console's byte order.
 */
export async function matchFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, addressOf, sizeOf, runOf = () => null, program, gp = 0, shifts = [], given = null, log = () => {} }) {
  const built = await compileFile({ file, root, includes, compiler, work, log });
  if (built.error) return { error: built.error.replaceAll(`${relative(root, file).split(sep).join('/')}:`, `${basename(file)}:`) };
  let made;
  try {
    made = objectOf(built.object);
  } catch (error) {
    return { error: error.message };
  }
  const twins = new Map(twinsIn(readFileSync(file, 'utf8'), shifts, given, 'n64').map(twin => [twin.name, twin]));
  return matchObject(made, { twins, addressOf, sizeOf, runOf, program: { ...program, bigEndian: true }, gp, decode: (word, address) => decode(word, address, 'vr4300') });
}

// what match needs to know of the Nintendo 64: how its games say they were built, how a file is built and compared,
// where the code the cartridge starts is and where it points $gp, and how its code names an address
const NINTENDO_64 = {
  console: 'n64', place: 'the Nintendo 64', compiler: 'IDO', label: LABEL, labelExample: 'D_80331234', readCompiler, wayAt, wayText, matchFile,
  programOf: async path => {
    const cartridge = n64Cartridge(path);
    const { load, text } = programOf(cartridge);
    return { program: { load, text }, gp: gpOf(cartridge) ?? 0 };
  },
  resolve: (game, codeMap, what) => ps1Resolve(game, codeMap, what).address,
};

/** match on a Nintendo 64 game: as ../match.mjs does on the Game Boy Advance, with `log` for what it says. */
export const matchGame = options => matchGameOn(NINTENDO_64, options);
