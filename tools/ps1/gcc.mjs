// GCC 2.x, the compiler PlayStation games were built with, for `match` on the PlayStation (#1558): GNU's own source
// (GPL-2.0-or-later), fetched at a fixed version and checked against its hash, built on the contributor's computer and
// never in the repository, as agbcc is on the Game Boy Advance.
//
// GCC 2.x is a program for a 32-bit computer, and decompilations build it with 32-bit system libraries, which many
// computers don't have. The compiler `npm ci` brings builds C to 32-bit
// WebAssembly with a C library of its own (WASI), so the tools build GCC's generators and its compiler proper, cc1,
// into WebAssembly and run them in Node.js: the same program on every computer, and nothing to install.
//
// The target is GCC's own little-endian R3000 for ECOFF, `mipsel-ecoff` (config/mips/ecoffl.h), the PlayStation's
// processor. What GCC 2.7.2 needs to build this way is the tools' own, written here, and changes nothing of GCC's
// compiling:
//   - a header for the computer it runs on, 32-bit and little-endian, as configure would write for one;
//   - a declaration of each of its functions that returns nothing or a double, and a prototype of each of its error and
//     warning functions, which take a varying number of arguments: C of 1995 calls them undeclared, and WebAssembly,
//     unlike a PC, holds a call to the function's own signature;
//   - obstack.h without its casts used as lvalues, which today's compilers refuse;
//   - main with the two arguments WASI's start passes, a gen_call_value that takes the fifth argument calls.c gives it,
//     and system and mktemp, which WASI hasn't;
//   - and, last, Binaryen's pass that lets a call through a pointer reach a function of another signature, as GCC's own
//     code makes such calls (fpcast-emu).

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { LOCAL } from '../lib/paths.mjs';
import { binaryen, filesIn } from '../lib/binaryen.mjs';

/** The versions the tools build, each from GNU's own archive, with its hash. */
export const GCC = {
  '2.7.2': { url: 'https://ftp.gnu.org/old-gnu/gcc/gcc-2.7.2.tar.gz', sha256: '7cd8bce5c3aeec59a72ecc2d3d5123864a817b14cdbd0680b1a969c3bccc5da5' },
};
const FOLDER = join(LOCAL, 'ps1', 'gcc');
// what this file is, so a build made by another version of it is made again
const RECIPE = createHash('sha1').update(readFileSync(new URL(import.meta.url))).digest('hex').slice(0, 12);

// the computer GCC runs on: 32-bit and little-endian, as WebAssembly is
const HOST = `#define FALSE 0
#define TRUE 1
#define HOST_BITS_PER_CHAR 8
#define HOST_BITS_PER_SHORT 16
#define HOST_BITS_PER_INT 32
#define HOST_BITS_PER_LONG 32
#define HOST_BITS_PER_LONGLONG 64
#define SUCCESS_EXIT_CODE 0
#define FATAL_EXIT_CODE 33
#define POSIX
#define NO_STAB_H
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#undef alloca
#define alloca(n) __builtin_alloca(n)
#include "tm.h"
#include "wasm-protos.h"
`;

// the start WASI calls, GCC's own main with the environment, the fifth argument calls.c gives the MIPS pattern's
// gen_call_value, which it doesn't take, and what WASI's C library hasn't: GCC runs no other program here, and a
// temporary name is made by count
const MAIN = `int gcc_main(int, char **, char **);
extern char **environ;
int main(int argc, char **argv) { return gcc_main(argc, argv, environ); }
typedef struct rtx_def *rtx;
rtx gen_call_value(rtx, rtx, rtx, rtx);
rtx dp_gen_call_value5(rtx a, rtx b, rtx c, rtx d, rtx e) { return gen_call_value(a, b, c, d); }
int system(const char *command) { return -1; }
char *mktemp(char *name) {
  static int made;
  char *x = name;
  while (*x) x++;
  for (int i = 0; i < 6 && x > name && x[-1] == 'X'; i++) *--x = '0' + (made + i) % 10;
  made++;
  return name;
}
`;

// what each generator writes, from the machine description, in the order cc1 needs them, and what it's built with
const GENERATORS = [
  ['genconfig', 'insn-config.h'], ['genflags', 'insn-flags.h'], ['gencodes', 'insn-codes.h'], ['genattr', 'insn-attr.h'],
  ['genemit', 'insn-emit.c'], ['genopinit', 'insn-opinit.c'], ['genrecog', 'insn-recog.c'], ['genextract', 'insn-extract.c'],
  ['genpeep', 'insn-peep.c'], ['genoutput', 'insn-output.c'], ['genattrtab', 'insn-attrtab.c', ['print-rtl.c', 'rtlanal.c']],
];
// the bytecode's headers, from bytecode.def
const BYTECODE = [['bi-arity', 'bc-arity.h'], ['bi-opcode', 'bc-opcode.h'], ['bi-opname', 'bc-opname.h']];
// cc1: the C front end, then the rest, as GCC 2.7.2's Makefile.in lists them
const CC1 = `c-parse c-lang c-lex c-pragma c-decl c-typeck c-convert c-aux-info c-common c-iterate
 toplev version tree print-tree stor-layout fold-const function stmt expr calls expmed explow optabs varasm
 rtl print-rtl rtlanal emit-rtl real dbxout sdbout dwarfout xcoffout integrate jump cse loop unroll flow stupid combine
 regclass local-alloc global reload reload1 caller-save insn-peep reorg sched final recog reg-stack
 insn-opinit insn-recog insn-extract insn-output insn-emit insn-attrtab getpwd convert bc-emit bc-optab obstack aux-output wasm-main`.split(/\s+/);

const FLAGS = ['--target=wasm32-wasip1', '-std=gnu89', '-O1', '-w', '-fno-strict-aliasing', '-D_GNU_SOURCE', '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS',
  '-DIN_GCC', '-DHAVE_CONFIG_H', '-Wno-error=implicit-function-declaration', '-Wno-error=int-conversion', '-Wno-error=incompatible-pointer-types', '-Wno-error=implicit-int',
  '-Wno-error=return-type', '-mllvm', '-wasm-enable-sjlj', '-I.', '-Iconfig'];
// each file's own: toplev.c defines main and the varying error functions, and calls.c calls gen_call_value with five
const OWN_FLAGS = { 'toplev.c': ['-Dmain=gcc_main', '-DDP_DEFINES_VARIADIC'], 'calls.c': ['-Dgen_call_value=dp_gen_call_value5'] };

let clang = null;
async function compiler() {
  if (!clang) {
    clang = await import('@yowasp/clang');
    await clang.runLLVM(null, {}, { fetchProgress: () => {} });
  }
  return clang;
}

async function runClang(args, files, out) {
  const { runClang: run } = await compiler();
  let said = '';
  const stderr = bytes => { if (bytes) said += Buffer.from(bytes).toString(); };
  try {
    const made = await run(['clang', ...args], files, { stdout: stderr, stderr });
    return made?.[out] ? { made: made[out] } : { error: said.trim() || 'the compiler wrote nothing' };
  } catch (error) {
    return { error: said.trim() || String(error.message ?? error) };
  }
}

/** The declarations of what GCC's files define to return nothing or a double, and the prototypes of the error and
 *  warning functions, from `source`, a Map of file name to text, and `generated`, those the generators wrote. A name
 *  in `left` is left out: GCC's own files declare it another way than it's defined, and nothing calls it in C. */
export function declarationsOf(source, generated, left = new Set()) {
  const found = new Map(), own = new Set();
  const used = new Set([...CC1, ...GENERATORS.flatMap(([gen, , more = []]) => [gen, ...more.map(name => name.replace(/\.c$/, ''))]), 'rtl', ...BYTECODE.map(([bi]) => bi), 'bi-parser', 'bi-lexer', 'bi-reverse'].map(name => `${name}.c`));
  const scan = (text, all) => {
    for (const [, fn] of text.matchAll(/^static\b[^;={}]*?\b([A-Za-z_]\w*) \(/gm)) own.add(fn);
    for (const [, fn] of text.matchAll(/^static\b[^;={}(]*\n([A-Za-z_]\w*) \(/gm)) own.add(fn);
    for (const [, type, fn] of text.matchAll(/^(void|double|float)\n([A-Za-z_]\w*) ?\(/gm)) if (!found.has(fn)) found.set(fn, type);
    if (all) for (const [, type, fn] of text.matchAll(/^(void|double|float) ([A-Za-z_]\w*) \(\)$/gm)) if (!found.has(fn)) found.set(fn, type);
  };
  for (const [name, text] of source) if (used.has(name)) scan(text, true);
  for (const [name, text] of generated) if (/^insn-.*\.c$/.test(name)) scan(text, false);
  const variadic = [...(source.get('toplev.c') ?? '').matchAll(/^void (\w+) PVPROTO\(\((.*)\)\);$/gm)]
    .map(([, fn, params]) => [fn, `void ${fn} (${params.replace(/\b(tree|rtx) /g, 'void *')});`]);
  const declared = [...found].filter(([fn]) => !own.has(fn) && !left.has(fn) && !variadic.some(([name]) => name === fn));
  return `${declared.map(([fn, type]) => `extern ${type} ${fn} ();`).join('\n')}\n#ifndef DP_DEFINES_VARIADIC\n${variadic.map(([, line]) => line).join('\n')}\n#endif\n`;
}

/** GCC 2.7.2's obstack.h with each *((T)P)++ = V written as the same store with P moved on first, as its own version
 *  for other compilers writes it. */
export const withoutLvalueCasts = text => text.replace(/\*\(\((\w+ \*+)\)(\(h\)->next_free|__o->next_free)\)\+\+/g,
  (_, type, place) => `*((${type})((${place} += sizeof (*(${type})0)) - sizeof (*(${type})0)))`);

// runs a WASI program, `args` after its name, with `folders` as the folders it sees, and its input and its output in
// files: how it ended. Node.js says WASI is new each time a program starts, which isn't news here.
async function runWasi(module, args, { name = 'gcc', folders, stdin = null, stdout = null, stderr = null }) {
  const { WASI } = await import('node:wasi');
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => { if (!/WASI/.test(String(warning))) emit.call(process, warning, ...rest); };
  const outFd = stdout ? openSync(stdout, 'w') : 1, inFd = stdin ? openSync(stdin, 'r') : 0, errFd = stderr ? openSync(stderr, 'w') : 2;
  try {
    const wasi = new WASI({ version: 'preview1', args: [name, ...args], preopens: folders, stdin: inFd, stdout: outFd, stderr: errFd, returnOnExit: true });
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
    return wasi.start(instance);
  } finally {
    process.emitWarning = emit;
    if (stdout) closeSync(outFd);
    if (stdin) closeSync(inFd);
    if (stderr) closeSync(errFd);
  }
}

async function fetchSource(version, log) {
  const { url, sha256 } = GCC[version];
  log(`Getting GCC ${version}'s source from GNU, at ${url}…`);
  let packed;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`it answered ${response.status}`);
    packed = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`GCC ${version}'s source couldn't be got from ${url}: ${error.cause?.message ?? error.message}.`);
  }
  if (createHash('sha256').update(packed).digest('hex') !== sha256) throw new Error(`What ${url} gave isn't GCC ${version} as the tools know it, so it isn't used.`);
  const files = new Map();
  for (const [path, bytes] of filesIn(gunzipSync(packed))) {
    const name = path.replace(/^gcc-[^/]+\//, '');
    if (/^(config\/mips\/)?[^/]+\.(c|h|def|md)$/.test(name) || /^config\/[^/]+\.h$/.test(name)) files.set(name, bytes);
  }
  return files;
}

/**
 * Builds GCC `version`'s cc1 to WebAssembly if this computer hasn't yet, which takes a few minutes once: its file.
 */
export async function ensureGcc(version = '2.7.2', log = console.log) {
  if (!GCC[version]) throw new Error(`The tools build GCC ${Object.keys(GCC).join(', ')} for the PlayStation, and not ${version} yet.`);
  const folder = join(FOLDER, version), cc1 = join(folder, `cc1-${RECIPE}.wasm`);
  if (existsSync(cc1)) return cc1;
  const source = await fetchSource(version, log);
  log(`Building GCC ${version} for the PlayStation's processor, as WebAssembly, once, which takes a few minutes…`);
  const text = new Map([...source].map(([name, bytes]) => [name, bytes.toString('latin1')]));
  const generated = new Map(), work = join(folder, `making-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const left = new Set();
  // the folders of files the compiler is given: GCC's, what's written for it here, and what the generators wrote
  const tree = () => {
    const files = { config: { mips: {} } };
    for (const [name, bytes] of source) {
      const parts = name.split('/');
      if (parts.length === 1) files[name] = bytes;
      else if (parts.length === 2) files.config[parts[1]] = bytes;
      else files.config.mips[parts[2]] = bytes;
    }
    Object.assign(files, {
      'config.h': Buffer.from(HOST), 'hconfig.h': Buffer.from(HOST), 'tconfig.h': Buffer.from('#include "mips/xm-mips.h"\n'), 'tm.h': Buffer.from('#include "mips/ecoffl.h"\n'),
      // what configure writes for languages besides C, which cc1 has none of
      'options.h': Buffer.alloc(0), 'specs.h': Buffer.alloc(0),
      'obstack.h': Buffer.from(withoutLvalueCasts(text.get('obstack.h')), 'latin1'),
      'aux-output.c': Buffer.from(text.get('config/mips/mips.c').replace(/^extern void\s+(error|fatal|warning) \(\);$/gm, ''), 'latin1'),
      'wasm-main.c': Buffer.from(MAIN),
      'wasm-protos.h': Buffer.from(declarationsOf(text, generated, left)),
    });
    for (const [name, made] of generated) files[name] = Buffer.from(made, 'latin1');
    return files;
  };
  const objects = new Map();
  // the generators define error functions of their own, so only cc1's files are given the prototypes of toplev.c's
  const compile = async (file, files, forCc1) => {
    if (objects.has(file)) return objects.get(file);
    const args = [...FLAGS, ...(OWN_FLAGS[file] ?? (forCc1 ? [] : ['-DDP_DEFINES_VARIADIC'])), '-c', file, '-o', 'out.o'];
    let built = await runClang(args, files, 'out.o');
    // a name GCC's own files declare another way than it's defined is left to them
    for (let conflict; built.error && (conflict = /conflicting types for '(\w+)'\n[^]*?wasm-protos\.h/.exec(built.error)) && !left.has(conflict[1]);) {
      left.add(conflict[1]);
      files['wasm-protos.h'] = Buffer.from(declarationsOf(text, generated, left));
      objects.clear();
      built = await runClang(args, files, 'out.o');
    }
    if (built.error) throw new Error(`GCC ${version}'s ${file} didn't build for WebAssembly:\n${built.error.split('\n').slice(0, 20).join('\n')}`);
    objects.set(file, built.made);
    return built.made;
  };
  const link = async (name, sources) => {
    const files = tree(), objs = {};
    for (const source_ of sources) objs[source_.replace(/\.c$/, '.o')] = await compile(source_, files, name === 'cc1');
    const linked = await runClang(['--target=wasm32-wasip1', '-mllvm', '-wasm-enable-sjlj', '-lsetjmp', '-lwasi-emulated-signal', '-lwasi-emulated-process-clocks',
      '-Wl,-z,stack-size=8388608', '-o', `${name}.wasm`, ...Object.keys(objs)], objs, `${name}.wasm`);
    if (linked.error) throw new Error(`GCC ${version}'s ${name} didn't link:\n${linked.error.split('\n').slice(-20).join('\n')}`);
    return linked.made;
  };
  try {
    writeFileSync(join(work, 'mips.md'), source.get('config/mips/mips.md'));
    writeFileSync(join(work, 'bytecode.def'), source.get('bytecode.def'));
    for (const [gen, output, more = []] of GENERATORS) {
      const module = new WebAssembly.Module(await link(gen, [`${gen}.c`, 'rtl.c', ...more, 'obstack.c']));
      const code = await runWasi(module, ['/work/mips.md'], { folders: { '/work': work }, stdout: join(work, output) });
      if (code) throw new Error(`GCC ${version}'s ${gen} ended with ${code}.`);
      generated.set(output, readFileSync(join(work, output), 'latin1'));
    }
    for (const [bi, output] of BYTECODE) {
      const module = new WebAssembly.Module(await link(bi, [`${bi}.c`, 'bi-parser.c', 'bi-lexer.c', 'bi-reverse.c']));
      const code = await runWasi(module, [], { folders: { '/work': work }, stdin: join(work, 'bytecode.def'), stdout: join(work, output) });
      if (code) throw new Error(`GCC ${version}'s ${bi} ended with ${code}.`);
      generated.set(output, readFileSync(join(work, output), 'latin1'));
    }
    objects.clear();
    const b = await binaryen(log);
    const module = b.readBinary(await link('cc1', CC1.map(name => `${name}.c`)));
    const F = b.Features;
    module.setFeatures(F.MVP | F.SignExt | F.MutableGlobals | F.BulkMemory | F.NontrappingFPToInt | F.ExceptionHandling | F.Multivalue | F.ReferenceTypes);
    module.runPasses(['fpcast-emu']);
    writeFileSync(join(work, 'cc1.wasm'), module.emitBinary());
    module.dispose();
    // the older builds of this version, made by another version of this file, go
    for (const name of readdirSync(folder)) if (/^cc1-.*\.wasm$/.test(name)) rmSync(join(folder, name), { force: true });
    renameSync(join(work, 'cc1.wasm'), cc1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return cc1;
}

const modules = new Map();
/**
 * Compiles `source`, C already preprocessed, with GCC `version`'s cc1 and `flags`, such as -O2 and -G0: { assembly }, or
 * { error }, what cc1 said.
 */
export async function compileC(source, { version = '2.7.2', flags = [], log = console.log } = {}) {
  const file = await ensureGcc(version, log);
  if (!modules.has(file)) modules.set(file, new WebAssembly.Module(readFileSync(file)));
  const work = join(LOCAL, 'tmp', `ps1-gcc-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(work, { recursive: true });
  try {
    writeFileSync(join(work, 'in.i'), source);
    const said = join(work, 'said.txt');
    // GCC's MIPS code keeps the data it writes with -G in a temporary file, in /tmp, which is the same folder here
    const code = await runWasi(modules.get(file), ['/work/in.i', '-quiet', ...flags, '-o', '/work/out.s'], { name: 'cc1', folders: { '/work': work, '/tmp': work }, stdout: join(work, 'out.txt'), stderr: said });
    const text = readFileSync(said, 'utf8').replaceAll('/work/in.i', 'the C');
    if (code !== 0 || !existsSync(join(work, 'out.s'))) return { error: text.trim() || `cc1 ended with ${code}` };
    return { assembly: readFileSync(join(work, 'out.s'), 'utf8') };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

