// Builds the Game Boy Advance's compiler on the contributor's computer: agbcc, the GCC of the console's own
// development kit, kept buildable by pret (github.com/pret/agbcc, under the GNU General Public License), from its
// repository at a fixed commit. match builds a game's C with it, as the original was built, to compare the bytes that
// come out with the original's. It lands in .dreamports/gba/, which never goes in a commit, and none of it is ever part
// of a Dreamport or of dreamports.net. It needs git and a C compiler, as the reference emulator does.
//
// agbcc's own build is a Makefile for a Unix shell. This does the same steps one at a time, with no make and no shell,
// so it's the same on Linux, a Mac and Windows: the programs that write the compiler's tables from its description of
// Thumb, then those tables, then the compiler. It builds beside the source, never in it. There are two compilers from
// the one source, as games were built with either: `agbcc`, and `old_agbcc`, the earlier one (-DOLD_COMPILER). A game's
// proof/original.json says which built it.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { WINDOWS_BUILD } from './windows.mjs';

/** agbcc's commit, the same on every computer so the same C comes out as the same bytes everywhere. */
export const AGBCC_COMMIT = 'da598c1d918402c42c0c0d7128ba14567f3175e9';
const AGBCC_REPOSITORY = 'https://github.com/pret/agbcc.git';

/** The two compilers, by the name a game's proof/original.json gives one. */
export const COMPILERS = { agbcc: [], old_agbcc: ['-DOLD_COMPILER'] };

const FOLDER = join(LOCAL, 'gba');
const WORK = process.platform === 'win32' ? WINDOWS_BUILD : FOLDER;
// agbcc's source: a copy of its repository already on this computer ($AGBCC_SOURCE), or one the setup gets
const SOURCE = process.env.AGBCC_SOURCE || join(WORK, 'agbcc-source');
const BUILD = join(WORK, 'agbcc-build');
const STAMP = join(FOLDER, 'agbcc.json');
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Where a compiler is once built. */
export const compilerPath = name => join(FOLDER, name + EXE);

// as agbcc's Makefile builds it, with its warnings left unsaid
const FLAGS = ['-std=gnu11', '-w', '-Werror-implicit-function-declaration', '-Wno-error=incompatible-pointer-types'];
// what every program that reads the description of Thumb is made with
const RTL = ['rtl', 'bitmap', 'obstack', 'print-rtl'];
// each table, the program that writes it, and what that program needs beside RTL
const TABLES = [
  ['insn-config.h', 'genconfig'], ['insn-flags.h', 'genflags'], ['insn-codes.h', 'gencodes'], ['insn-attr.h', 'genattr'],
  ['insn-emit.c', 'genemit'], ['insn-recog.c', 'genrecog'], ['insn-opinit.c', 'genopinit'], ['insn-extract.c', 'genextract'],
  ['insn-peep.c', 'genpeep'], ['insn-attrtab.c', 'genattrtab', ['rtlanal']], ['insn-output.c', 'genoutput'],
];
// the compiler's own files, as the Makefile lists them
const SOURCES = ['toplev', 'version', 'tree', 'print-tree', 'stor-layout', 'fold-const', 'function', 'stmt', 'except', 'expr', 'calls',
  'expmed', 'explow', 'optabs', 'varasm', 'emit-rtl', 'genrtl', 'real', 'regmove', 'dwarf2out', 'alias', 'integrate', 'jump', 'cse', 'loop',
  'unroll', 'flow', 'stupid', 'combine', 'varray', 'regclass', 'local-alloc', 'global', 'reload', 'reload1', 'caller-save', 'gcse',
  'insn-peep', 'final', 'recog', 'insn-opinit', 'insn-recog', 'insn-extract', 'insn-output', 'insn-emit', 'lcm', 'insn-attrtab', 'thumb',
  'getpwd', 'convert', 'dyn-string', 'splay-tree', 'graph', 'sbitmap', 'resource', 'c-parse', 'c-lex', 'c-decl', 'c-typeck', 'c-convert',
  'c-aux-info', 'c-common', 'c-iterate'];
// which of them the programs above write, so they're read from where they were built
const WRITTEN = new Set(['genrtl', ...TABLES.map(([file]) => file.replace(/\.[ch]$/, ''))]);

const built = () => {
  try { return JSON.parse(readFileSync(STAMP, 'utf8')); } catch { return {}; }
};

/** Whether this compiler is built, from this commit of agbcc. */
export function isCompilerBuilt(name = 'agbcc') {
  const stamp = built();
  return stamp.commit === AGBCC_COMMIT && stamp.compilers?.includes(name) && existsSync(compilerPath(name));
}

function run(command, args, what, { cwd, env, output } = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 << 20 });
  if (result.error?.code === 'ENOENT') throw new Error(`${what} needs ${command}, which isn't installed.`);
  if (result.status !== 0) throw new Error(`${what} failed:\n${(result.stderr || result.error?.message || '').trim().split('\n').slice(-20).join('\n')}`);
  if (output) writeFileSync(output, result.stdout);
}

// agbcc's source at the commit, got if it isn't here
function source(log) {
  if (!existsSync(join(SOURCE, 'gcc', 'thumb.md'))) {
    if (process.env.AGBCC_SOURCE) throw new Error(`AGBCC_SOURCE names ${SOURCE}, which has no copy of agbcc's source.`);
    log(`Getting agbcc, the Game Boy Advance's compiler, from ${AGBCC_REPOSITORY.replace(/^https:\/\/|\.git$/g, '')} at ${AGBCC_COMMIT.slice(0, 7)}, about 13 MB…`);
    rmSync(SOURCE, { recursive: true, force: true });
    mkdirSync(SOURCE, { recursive: true });
    const git = (...args) => run('git', ['-C', SOURCE, ...args], 'Getting agbcc');
    git('init', '--quiet');
    git('fetch', '--quiet', '--depth', '1', AGBCC_REPOSITORY, AGBCC_COMMIT);
    git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD');
  }
  // a copy that has git says which commit it is: another one would give other bytes
  const head = spawnSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status === 0 && existsSync(join(SOURCE, '.git')) && head.stdout.trim() !== AGBCC_COMMIT) {
    throw new Error(`The proof tools use agbcc at ${AGBCC_COMMIT.slice(0, 7)}, and ${SOURCE} holds ${head.stdout.trim().slice(0, 7)}.`);
  }
  return join(SOURCE, 'gcc');
}

/** Builds the compilers named that aren't built yet, saying each step. `windows` is what builds on Windows
 *  (windows.mjs), which build.mjs gets and clears away; anywhere else it's the computer's own compiler ($CC, or cc). */
export function buildCompilers(names, log, windows) {
  mkdirSync(FOLDER, { recursive: true });
  const gcc = source(log);
  const cc = windows?.gcc ?? (process.env.CC || 'cc');
  for (const name of names) {
    if (isCompilerBuilt(name)) continue;
    log(`Building the Game Boy Advance's compiler, ${name} (under a minute)…`);
    const folder = join(BUILD, name);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const what = `Building ${name}`, options = { cwd: folder, env: windows?.env };
    const flags = [...FLAGS, ...COMPILERS[name], '-I', folder, '-I', gcc];
    const compile = file => run(cc, [...flags, '-c', join(WRITTEN.has(file) ? folder : gcc, `${file}.c`), '-o', join(folder, `${file}.o`)], what, options);
    const objects = files => files.map(file => join(folder, `${file}.o`));
    const program = (file, needs) => {
      compile(file);
      run(cc, [...flags, '-o', join(folder, file + EXE), ...objects([file, ...needs])], what, options);
      return join(folder, file + EXE);
    };
    // the two tables that come from the compiler's own lists, then what reads the description of Thumb, then the rest
    run(program('gengenrtl', []), ['genrtl.h', 'genrtl.c'], what, options);
    run(program('gencheck', []), [], what, { ...options, output: join(folder, 'tree-check.h') });
    [...RTL, 'rtlanal'].forEach(compile);
    for (const [table, generator, more = []] of TABLES) {
      run(program(generator, [...RTL, ...more]), [join(gcc, 'thumb.md')], what, { ...options, output: join(folder, table) });
    }
    SOURCES.forEach(compile);
    run(cc, [...flags, '-o', join(folder, name + EXE), ...objects([...SOURCES, ...RTL, 'rtlanal']), ...(windows ? ['-static'] : [])], what, options);
    copyFileSync(join(folder, name + EXE), compilerPath(name));
    rmSync(folder, { recursive: true, force: true });
    const stamp = built();
    writeFileSync(STAMP, JSON.stringify({ commit: AGBCC_COMMIT, compilers: [...new Set([...(stamp.commit === AGBCC_COMMIT ? stamp.compilers ?? [] : []), name])] }) + '\n');
  }
  rmSync(BUILD, { recursive: true, force: true });
}
