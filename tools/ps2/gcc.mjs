// Sony's own compiler and assemblers for the PlayStation 2, for `match` on the console (#1588): EE-GCC 2.9-ee-991111-01,
// the GCC Sony's 1999 toolchain shipped for the EE, which built Sony's libraries and the games of studios that used
// Sony's toolchain, with its GNU assembler and linker for the EE and dvp-as, its assembler for the vector units'
// programs. All are built from Sony's own GPL source release (GirianSeed/ee-gcc's copy, GCC GPL-2.0-or-later, binutils
// GPL), fetched at a fixed version and checked against its hash, on the contributor's computer, and never in the
// repository, as the PlayStation's GCC is (../ps1/gcc.mjs).
//
// The 1999 code is built for this computer with clang, Apple's compiler on a Mac and the one `apt install clang` brings
// on Linux, with Sony's own patch from the release and decomp-meadow/ee-gcc-macos's port (GPL-2.0), fetched at a fixed
// commit, which makes it build on a 64-bit computer and mends a few old bugs whose effect depended on the computer it
// ran on, so it gives the original compiler's bytes. The port is for a Mac, and the tools' one change of their own lets
// GCC's configure take a 64-bit Linux the same way. Clang it is, as the port mends what clang does differently from
// the original's compiler, such as the order it works out a call's arguments in; GCC builds a compiler that differs from
// Sony's on some files. The tree's own bison and flex are built first, so nothing else is needed. Then the build
// compiles the port's test files at the four settings the original compiler's objects are known for, and keeps
// nothing unless each object is the original's to the byte.
//
// Not here: the 2.96 compiler of Sony's later toolchains and SN Systems' ProDG builds of GCC, whose sources aren't
// published, and Metrowerks CodeWarrior for the PlayStation 2, which isn't free to use.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { arch, availableParallelism, platform } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { LOCAL } from '../lib/paths.mjs';
import { fetchChecked } from '../lib/download.mjs';

const PORT = 'https://raw.githubusercontent.com/decomp-meadow/ee-gcc-macos/5d7d41618273ee13ea1219c96d724bc5e63cce00';
/** The versions the tools build: Sony's source, the port's patch and host header, and the original compiler's objects
 *  of the port's test files, by their SHA-256, as the port's build.sh has them. */
export const EE_GCC = {
  '2.9-ee-991111-01': {
    source: { url: 'https://github.com/GirianSeed/ee-gcc/releases/download/src-2.9-ee-991111-01/ee-gcc-2.0.zip', sha256: '99ae6c81801fa0108f436df186daefcc9101b5f402525dae75da8c5e5de728fe' },
    port: {
      'mac-host.patch': { url: `${PORT}/2.9-ee-991111-01/mac-host.patch`, sha256: '580c8b88dd49c4d0b46c38ca2e419a80f3fe652a4a540803fc5b060c5e837964' },
      'xm-darwin.h': { url: `${PORT}/2.9-ee-991111-01/xm-darwin.h`, sha256: '4f2bfee73f72778e7460ca2ce7d09899019e17f9d760fab9b64ed7c713ba38d5' },
      'selftest.c': { url: `${PORT}/tools/selftest.c`, sha256: 'af8b0a43dc88cb131e8532ce45b4f077da1835e20e130c8c9bbb015a460b1c6f' },
      'selftest.cc': { url: `${PORT}/tools/selftest.cc`, sha256: 'dce325eba9789fcb06a3127416736bd2492e728c127eb8100d9c66230994b960' },
    },
    selftest: [
      ['selftest.c', ['-O2', '-G0'], 'c4b930a7ab20671175c18e6a65e42aab8e67d4890eff338b65c9c7ce033bb352'],
      ['selftest.c', ['-O0', '-G8'], '29780e3978abdc0676fbc41370d4c15cbf8970a8baa3981b5d2c26cf46c84f34'],
      ['selftest.cc', ['-O2', '-G0'], '75a3b13da7d393f8ceeccd91e4b52fe7f866ba7b1efbb9538ae7fb7662fbc158'],
      ['selftest.cc', ['-O0', '-G8'], 'df536d65222652cd23d5638d20d5efdbc12542942fb6a489d577fbfd33df3527'],
    ],
  },
};
const FOLDER = join(LOCAL, 'ps2', 'ee-gcc');
// what this file is, so a build made by another version of it is made again
const RECIPE = createHash('sha1').update(readFileSync(new URL(import.meta.url))).digest('hex').slice(0, 12);
// the computers it builds on, by the name GCC's configure knows each by
const HOSTS = { 'linux-x64': 'x86_64-pc-linux-gnu', 'linux-arm64': 'aarch64-unknown-linux-gnu', 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' };
// as the port builds it: C of 1999, which relies on wrapping sums, type punning, common symbols and signed chars, and
// has what today's clang refuses unless told not to, under the names its older and newer versions know each by
const CFLAGS = '-std=gnu89 -O2 -fwrapv -fno-strict-aliasing -fcommon -fsigned-char -w -Wno-unknown-warning-option -Wno-return-mismatch -Wno-return-type -Wno-implicit-function-declaration -Wno-implicit-int -Wno-int-conversion -Wno-incompatible-pointer-types';
// the parts of Sony's tree the three programs don't need, which its configure would otherwise try to set up
const LEFT_OUT = ['gdb', 'tcl', 'tk', 'itcl', 'tix', 'libgui', 'expect', 'dejagnu', 'sim', 'snavigator', 'sn', 'ide', 'bsp', 'examples', 'binutils', 'gprof',
  'winsup', 'utils', 'readline', 'libtermcap', 'make', 'send-pr', 'release-info', 'patch', 'diff', 'dosrel', 'xiberty', 'mmalloc', 'gperf'];

/** The files of a .zip, by name: a stored or deflated file each, found from its central directory. */
export function zipFiles(zip) {
  const files = new Map();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
  if (end < 0) throw new Error('That isn\'t a .zip file.');
  let at = zip.readUInt32LE(end + 16);
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    const method = zip.readUInt16LE(at + 10), packed = zip.readUInt32LE(at + 20), nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('latin1', at + 46, at + 46 + nameLength), local = zip.readUInt32LE(at + 42);
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), bytes = zip.subarray(data, data + packed);
    if (!name.endsWith('/')) files.set(name, method === 8 ? inflateRawSync(bytes) : bytes);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

// runs a step of the build, and says what went wrong with its last lines when it fails
function step(what, program, args, cwd, env = {}) {
  const result = spawnSync(program, args, { cwd, env: { ...process.env, LC_ALL: 'C', ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error || result.status !== 0) {
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
    if (result.error?.code === 'ENOENT') throw new Error(`Building Sony's compiler needs ${program}, which this computer hasn't: ${program === 'clang' ? 'on Debian or Ubuntu, sudo apt install clang; on a Mac, xcode-select --install' : `install ${program}`}.`);
    throw new Error(`Building Sony's compiler for the PlayStation 2 stopped at ${what}:\n${said || result.error?.message}`);
  }
  return result.stdout;
}

/** Where a built version's programs are: { gcc, as, ld, dvpAs, folder }. */
export function eeGccPaths(version = '2.9-ee-991111-01') {
  const folder = join(FOLDER, `${version}-${RECIPE}`);
  return { folder, gcc: join(folder, 'bin', 'ee-gcc'), as: join(folder, 'ee', 'bin', 'as'), ld: join(folder, 'ee', 'bin', 'ld'), dvpAs: join(folder, 'bin', 'dvp-as') };
}

/**
 * Builds Sony's EE-GCC `version`, its assembler for the EE and dvp-as, if this computer hasn't yet, which takes a few
 * minutes once, and checks it gives the original's objects: where each program is.
 */
export async function ensureEeGcc(version = '2.9-ee-991111-01', log = console.log) {
  const known = EE_GCC[version];
  if (!known) throw new Error(`The tools build Sony's EE-GCC ${Object.keys(EE_GCC).join(', ')} for the PlayStation 2, and not ${version}.`);
  const paths = eeGccPaths(version);
  if (existsSync(join(paths.folder, 'checked'))) return paths;
  const host = HOSTS[`${platform()}-${arch()}`];
  if (!host) throw new Error(`Sony's compiler for the PlayStation 2 is built on Linux and on a Mac, and not on ${platform()} ${arch()}: on Windows, the tools run in WSL.`);
  // what the build runs, before a few minutes go on getting the source
  for (const program of ['clang', 'make', 'patch', 'tar']) {
    if (spawnSync(program, ['--version'], { encoding: 'utf8' }).error?.code === 'ENOENT') step(`looking for ${program}`, program, ['--version'], LOCAL);
  }
  log(`Getting Sony's GPL source of EE-GCC ${version}, and the port that builds it on today's computers…`);
  const zip = zipFiles(await fetchChecked(known.source.url, known.source.sha256, `Sony's source of EE-GCC ${version}`));
  const port = {};
  for (const [name, { url, sha256 }] of Object.entries(known.port)) port[name] = await fetchChecked(url, sha256, `the port's ${name}`);
  log(`Building Sony's EE-GCC ${version}, its assembler and dvp-as with clang, once, which takes a few minutes…`);
  const work = join(FOLDER, `making-${process.pid}`), src = join(work, 'src'), tools = join(work, 'tools');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(tools, 'bin'), { recursive: true });
  try {
    writeFileSync(join(work, 'src.tar.gz'), zip.get('src/src.tar.gz'));
    writeFileSync(join(work, 'sce.patch'), zip.get('sce-patch/patch'));
    for (const [name, bytes] of Object.entries(port)) writeFileSync(join(work, name), bytes);
    step('unpacking the source', 'tar', ['xzf', 'src.tar.gz'], work);
    step('Sony\'s own patch', 'patch', ['-p0', '-s', '-i', 'sce.patch'], work);
    if (!readFileSync(join(src, 'gcc', 'version.c'), 'latin1').includes(`"${version}"`)) throw new Error(`The source isn't EE-GCC ${version}.`);
    for (const name of LEFT_OUT) rmSync(join(src, name), { recursive: true, force: true });
    step('the port\'s patch', 'patch', ['-p1', '-s', '-i', join(work, 'mac-host.patch')], src);
    writeFileSync(join(src, 'gcc', 'config', 'xm-darwin.h'), port['xm-darwin.h']);
    // the tools' one change: GCC's configure takes a 64-bit Linux as it takes a 64-bit Mac
    const configure = join(src, 'gcc', 'configure'), text = readFileSync(configure, 'latin1');
    const macs = 'aarch64-apple-darwin* | arm64-apple-darwin* | x86_64-apple-darwin*)';
    if (!text.includes(macs)) throw new Error('The port\'s patch didn\'t make GCC\'s configure take a 64-bit host.');
    writeFileSync(configure, text.replace(macs, `${macs.slice(0, -1)} | x86_64-*-linux* | aarch64-*-linux*)`), 'latin1');

    const env = { CC: 'clang', CFLAGS, PATH: `${join(tools, 'bin')}:${process.env.PATH}`, LEXLIB: join(tools, 'flex', 'libfl.a') };
    const jobs = `-j${Math.max(2, Math.min(16, availableParallelism()))}`;
    // the tree's own bison, and its flex, built with that bison, for the parsers and the lexers of GCC and the assembler
    for (const name of ['bison', 'flex']) mkdirSync(join(tools, name), { recursive: true });
    step('bison\'s configure', 'sh', [join(src, 'bison', 'configure')], join(tools, 'bison'), env);
    step('bison', 'make', ['MAKEINFO=true', `CFLAGS=${CFLAGS}`], join(tools, 'bison'), env);
    writeFileSync(join(tools, 'bin', 'bison'), `#!/bin/sh\nexec "${join(tools, 'bison', 'bison')}" -L "${join(src, 'bison')}/" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(tools, 'bin', 'yacc'), `#!/bin/sh\nexec "${join(tools, 'bison', 'bison')}" -L "${join(src, 'bison')}/" -y "$@"\n`, { mode: 0o755 });
    step('flex\'s configure', 'sh', [join(src, 'flex', 'configure')], join(tools, 'flex'), env);
    step('flex', 'make', [`CFLAGS=${CFLAGS}`, `YACC=${join(tools, 'bin', 'yacc')}`, 'LIBIBERTY='], join(tools, 'flex'), env);
    for (const name of ['flex', 'lex']) writeFileSync(join(tools, 'bin', name), `#!/bin/sh\nexec "${join(tools, 'flex', 'flex')}" "$@"\n`, { mode: 0o755 });
    for (const name of ['flex', 'byacc']) rmSync(join(src, name), { recursive: true, force: true });

    // the compiler and its assembler for the EE, configured as Sony did, and dvp-as for the vector units
    const configured = (target, more) => {
      const obj = join(src, target === 'ee' ? 'obj' : 'obj-dvp');
      mkdirSync(obj, { recursive: true });
      step(`the configure for ${target}`, 'sh', [join(src, 'configure'), '--prefix=/usr/local/sce/ee/gcc', `--host=${host}`, `--build=${host}`, `--target=${target}`, ...more, '--without-sim', '--disable-sim'], obj, env);
      return obj;
    };
    const ee = configured('ee', ['--with-gnu-as', '--with-gnu-ld', '--enable-c-cpplib']);
    if (!readFileSync(join(ee, 'gcc', 'tm.h'), 'latin1').includes('MASK_MIPS5900|20))')) throw new Error('GCC wasn\'t configured as Sony configured it: its tm.h doesn\'t default to the R5900 with split addresses.');
    for (const dir of ['bison', 'libiberty', 'intl', 'bfd', 'opcodes', 'gas', 'ld']) step(`the ${dir} for the EE`, 'make', [jobs, 'MAKEINFO=true', `CFLAGS=${CFLAGS}`], join(ee, dir), env);
    step('GCC', 'make', [jobs, 'MAKEINFO=true', `CFLAGS=${CFLAGS}`, `BISON=${join(ee, 'bison', 'bison')} -L ${join(src, 'bison')}/`, 'cpp', 'cc1', 'cc1plus', 'xgcc'], join(ee, 'gcc'), env);
    const dvp = configured('dvp-elf', []);
    for (const dir of ['libiberty', 'intl', 'bfd', 'opcodes', 'gas']) step(`the ${dir} for the vector units`, 'make', [jobs, 'MAKEINFO=true', `CFLAGS=${CFLAGS}`], join(dvp, dir), env);

    // laid out as Sony's own install, so the driver finds its programs
    const made = join(work, 'made'), lib = join(made, 'lib', 'gcc-lib', 'ee', version);
    for (const folder of [join(made, 'bin'), lib, join(made, 'ee', 'bin')]) mkdirSync(folder, { recursive: true });
    const copy = (from, to) => writeFileSync(to, readFileSync(from), { mode: 0o755 });
    copy(join(ee, 'gcc', 'xgcc'), join(made, 'bin', 'ee-gcc'));
    for (const name of ['cpp', 'cc1', 'cc1plus']) copy(join(ee, 'gcc', name), join(lib, name));
    copy(join(ee, 'gas', 'as-new'), join(made, 'ee', 'bin', 'as'));
    copy(join(ee, 'ld', 'ld-new'), join(made, 'ee', 'bin', 'ld'));
    copy(join(dvp, 'gas', 'as-new'), join(made, 'bin', 'dvp-as'));
    writeFileSync(join(made, 'COPYING'), readFileSync(join(src, 'COPYING')));

    // the original compiler's objects, to the byte, or nothing is kept
    const test = join(work, 'test');
    mkdirSync(test, { recursive: true });
    for (const name of ['selftest.c', 'selftest.cc']) writeFileSync(join(test, name), port[name]);
    for (const [file, flags, sha256] of known.selftest) {
      step(`the test of ${file} ${flags.join(' ')}`, join(made, 'bin', 'ee-gcc'), [...flags, '-c', file, '-o', 'test.o'], test);
      const got = createHash('sha256').update(readFileSync(join(test, 'test.o'))).digest('hex');
      if (got !== sha256) throw new Error(`The EE-GCC built here doesn't make the original's object of ${file} with ${flags.join(' ')}, so it isn't kept: the tools' build of it differs from Sony's on this computer.`);
    }
    writeFileSync(join(made, 'checked'), `${known.selftest.length} objects the same as the original compiler's\n`);
    for (const name of existsSync(FOLDER) ? readdirSync(FOLDER) : []) if (name.startsWith(`${version}-`)) rmSync(join(FOLDER, name), { recursive: true, force: true });
    renameSync(made, paths.folder);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  log(`Sony's EE-GCC ${version} is built, and makes the original compiler's objects.`);
  return paths;
}

// a folder of its own for one run, in .dreamports/tmp
function scratch(name) {
  const folder = join(LOCAL, 'tmp', `ps2-${name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(folder, { recursive: true });
  return folder;
}

// runs one of the built programs on a file of its own: { made } with what it wrote, or { error }, what it said
function runOn(program, args, input, inputName, output) {
  const folder = scratch('run');
  try {
    writeFileSync(join(folder, inputName), input);
    const result = spawnSync(program, [...args, inputName, '-o', output], { cwd: folder, env: { ...process.env, LC_ALL: 'C', TMPDIR: folder }, encoding: 'utf8' });
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.replaceAll(inputName, 'the source').trim();
    if (result.error || result.status !== 0 || !existsSync(join(folder, output))) return { error: said || result.error?.message || `it ended with ${result.status}` };
    return { made: readFileSync(join(folder, output)), said };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Compiles `source` with Sony's EE-GCC and `flags`, such as -O2 and -G0, as `ee-gcc -c` does, through its preprocessor
 * and its assembler: { object }, the ELF object, or with `assembly`, { assembly }, the text cc1 wrote; or { error }.
 * `language` is 'c' or 'c++'.
 */
export async function compileEe(source, { version = '2.9-ee-991111-01', flags = [], language = 'c', assembly = false, log = console.log } = {}) {
  const { gcc } = await ensureEeGcc(version, log);
  const name = language === 'c++' ? 'in.cc' : 'in.c';
  const result = runOn(gcc, [...flags, assembly ? '-S' : '-c'], source, name, assembly ? 'out.s' : 'out.o');
  return result.error ? { error: result.error } : assembly ? { assembly: result.made.toString('latin1') } : { object: result.made };
}

/** Assembles `text` with Sony's assembler for the EE: { object } or { error }. */
export async function assembleEe(text, { version = '2.9-ee-991111-01', flags = [], log = console.log } = {}) {
  const { as } = await ensureEeGcc(version, log);
  const result = runOn(as, flags, text, 'in.s', 'out.o');
  return result.error ? { error: result.error } : { object: result.made };
}

/** Assembles a vector unit's program, `text` as dvp-as takes it, with Sony's dvp-as: { object }, whose .vutext holds
 *  the pairs, or { error }. */
export async function assembleVu(text, { version = '2.9-ee-991111-01', log = console.log } = {}) {
  const { dvpAs } = await ensureEeGcc(version, log);
  const result = runOn(dvpAs, [], text, 'in.vsm', 'out.o');
  return result.error ? { error: result.error } : { object: result.made };
}

/**
 * Links `objects`, each { name, bytes }, into a program with Sony's linker for the EE and `args`, such as -Ttext and an
 * address: { program }, the ELF file, or { error }. For a test's made-up original, linked as a game's was.
 */
export async function linkEe(objects, { version = '2.9-ee-991111-01', args = [], log = console.log } = {}) {
  const { ld } = await ensureEeGcc(version, log);
  const folder = scratch('link');
  try {
    for (const { name, bytes } of objects) writeFileSync(join(folder, name), bytes);
    const result = spawnSync(ld, [...args, '-o', 'out.elf', ...objects.map(o => o.name)], { cwd: folder, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' });
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.error || result.status !== 0 || !existsSync(join(folder, 'out.elf'))) return { error: said || result.error?.message || `the linker ended with ${result.status}` };
    return { program: readFileSync(join(folder, 'out.elf')), said };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
