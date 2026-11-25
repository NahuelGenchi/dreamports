// SN Systems' builds of GCC for the PlayStation 2, for `match` on a game its studio built with ProDG (#1624): GCC 2.95.2
// and 2.95.3 as SN ported them, which save a function's registers with `sq` where Sony's own EE-GCC (gcc.mjs) uses `sd`.
// They are programs for Windows, fetched to the contributor's computer from decompme/compilers' release, each checked
// against its hash, and never in the repository.
//
// What they are: GCC, so under the GPL. That release publishes no source and names no licence for them; SN's own files
// in its ProDG packages, COPYING, GnuSrc.txt and GnuSrcPS2.txt, say its product contains software under the GNU General
// Public License, ported or modified, with source on request from SN Systems, and list the programs the GPL covers.
// Only programs on that list are kept here: the driver, cpp, cc1, cc1plus and as, the GNU assembler. ps2eeas, SN's own
// assembler, which each package also holds, isn't on it, and is left out as the package is unpacked; the driver runs
// the GNU one.
//
// They run through wibo (decompals/wibo, MIT), which runs 32-bit Windows command-line programs, fetched the same way:
// on Linux as it is, and on a Mac its build for Intel's chip, which a Mac with Apple's chip runs through Rosetta 2,
// Apple's own translator, when the person has installed it (`softwareupdate --install-rosetta`, which setup asks
// before running). Windows runs them as they are, with no wibo. A build is kept only once it compiles a file of the
// tools' own to the object it's known to make, so a wibo or a computer that runs it differently is found out at once.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { LOCAL } from '../lib/paths.mjs';
import { fetchChecked } from '../lib/download.mjs';
import { filesIn } from '../lib/binaryen.mjs';

const RELEASE = 'https://github.com/decompme/compilers/releases/download/compilers';
// the programs SN's own list puts under the GPL, and the driver's settings, which is all that's kept of a package
const KEPT = /(^|\/)(ee-gcc\.exe|cpp\.exe|cc1\.exe|cc1plus\.exe|as\.exe|specs)$/;
// a file of the tools' own, compiled as a build is checked: a switch, a float, a 64-bit sum and registers to save
const SELFTEST = `extern int ext(int);
struct pair { int a, b; };
int pick(int x) { switch (x) { case 0: return ext(1); case 1: return 7; case 2: return ext(3) + 2; case 3: return 9; case 4: return ext(x); default: return -1; } }
float scale(float x) { return x * 2.5f + 1.0f; }
long wide(long a, long b) { return a + b + ext((int)a); }
int three(int a, int b, int c) { int x = ext(a), y = ext(b); return x + y + ext(c); }
void copy(struct pair *to, const struct pair *from) { *to = *from; }
`;
/** The builds the tools fetch: where, its hash, and the object each makes of the tools' own file at -O2 -G0. */
export const SN_GCC = {
  '2.95.2-273a': { url: `${RELEASE}/ee-gcc2.95.2-273a.tar.gz`, sha256: 'ee9d9a7fccb59aebfa78a5587f6f8059660b91f705acddbc292ad2243c8e562e', selftest: '45866a9b2d12254ad33800218fae01280837d939e24db38141eacc38d47678c4' },
  '2.95.3-114': { url: `${RELEASE}/ee-gcc2.95.3-114.tar.gz`, sha256: 'dbc2c8c764631788d4cbb4c848c3cb0002fded0f4a95bae39e6d8b794391a6cb', selftest: '45866a9b2d12254ad33800218fae01280837d939e24db38141eacc38d47678c4' },
  '2.95.3-136': { url: `${RELEASE}/ee-gcc2.95.3-136.tar.gz`, sha256: '3b6ae6897229ad005aaf1b0afaa1f3cb46e74b4c21a42e01130c07c0c598067f', selftest: '5fdc036785a9cce3b3722b2aded6a78f21d3d57eefa1a816efd7d5b60cc2176f' },
};
const WIBO_RELEASE = 'https://github.com/decompals/wibo/releases/download/1.2.0';
/** wibo 1.2.0, by the computer it runs on. */
export const WIBO = {
  'linux-x64': { url: `${WIBO_RELEASE}/wibo-x86_64`, sha256: '13f86a2d618f0dbe67179d349625345eabf9b46450295cb4c904e49f6aff85af' },
  'darwin-x64': { url: `${WIBO_RELEASE}/wibo-macos`, sha256: '2b3000ef6a7a490c24ccd71967735ae0005e218922e51806cca1b8d77fd3cf7c' },
  'darwin-arm64': { url: `${WIBO_RELEASE}/wibo-macos`, sha256: '2b3000ef6a7a490c24ccd71967735ae0005e218922e51806cca1b8d77fd3cf7c', rosetta: true },
};
const FOLDER = join(LOCAL, 'ps2', 'sn-gcc');

/** Whether a Mac with Apple's chip has Rosetta 2, which runs wibo's build for Intel's chip. */
export const hasRosetta = () => spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0;

/** wibo, fetched if this computer hasn't it yet: where it is, or null on Windows, which runs its own programs. */
export async function ensureWibo(log = console.log) {
  if (platform() === 'win32') return null;
  const known = WIBO[`${platform()}-${arch()}`];
  if (!known) throw new Error(`SN Systems' compilers are programs for Windows, which wibo runs on Linux on Intel's or AMD's chip and on a Mac, and not on ${platform()} ${arch()}: on Windows, the tools run in WSL.`);
  if (known.rosetta && !hasRosetta()) throw new Error('SN Systems\' compilers run through wibo, which a Mac with Apple\'s chip runs through Rosetta 2, Apple\'s own translator, and this Mac hasn\'t it yet: softwareupdate --install-rosetta installs it, from Apple.');
  const file = join(FOLDER, `wibo-${known.sha256.slice(0, 12)}`);
  if (existsSync(file)) return file;
  log('Getting wibo 1.2.0, which runs the compiler\'s programs for Windows (decompals/wibo, MIT)…');
  mkdirSync(FOLDER, { recursive: true });
  writeFileSync(`${file}.part`, await fetchChecked(known.url, known.sha256, 'wibo 1.2.0'), { mode: 0o755 });
  renameSync(`${file}.part`, file);
  return file;
}

// runs the driver of a build in `cwd`, its temporary files in `temporary`: through wibo, or by itself on Windows
function drive(wibo, folder, args, cwd, temporary) {
  const driver = join(folder, 'bin', 'ee-gcc.exe');
  const result = spawnSync(wibo ?? driver, [...(wibo ? [driver] : []), ...args], { cwd, env: { ...process.env, LC_ALL: 'C', TMP: temporary, TEMP: temporary, TMPDIR: temporary }, encoding: 'utf8', timeout: 120000 });
  return { ok: !result.error && result.status === 0, said: `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\r/g, '').trim() || result.error?.message || '' };
}

/** The object a build makes of the tools' own file, by its SHA-256: what a kept build is checked against. */
export function selftestOf(wibo, folder) {
  const work = join(FOLDER, `test-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    writeFileSync(join(work, 'selftest.c'), SELFTEST);
    const built = drive(wibo, folder, ['-O2', '-G0', '-c', 'selftest.c', '-o', 'selftest.o'], work, work);
    if (!built.ok || !existsSync(join(work, 'selftest.o'))) throw new Error(`SN Systems' compiler didn't run ${wibo ? 'through wibo ' : ''}on this computer: ${built.said.split('\n')[0] || 'it made nothing'}`);
    return createHash('sha256').update(readFileSync(join(work, 'selftest.o'))).digest('hex');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * SN Systems' GCC `version` and wibo, fetched if this computer hasn't them yet and checked: { wibo, folder }.
 */
export async function ensureSnGcc(version, log = console.log) {
  const known = SN_GCC[version];
  if (!known) throw new Error(`The tools fetch SN Systems' GCC ${Object.keys(SN_GCC).join(', ')}, and not ${version}.`);
  const wibo = await ensureWibo(log), folder = join(FOLDER, `${version}-${known.sha256.slice(0, 12)}`);
  if (existsSync(join(folder, 'checked'))) return { wibo, folder };
  log(`Getting SN Systems' GCC ${version} for the PlayStation 2, from decompme/compilers' release…`);
  const files = filesIn(gunzipSync(await fetchChecked(known.url, known.sha256, `SN Systems' GCC ${version}`)));
  const making = `${folder}.making-${process.pid}`;
  rmSync(making, { recursive: true, force: true });
  try {
    for (const [name, bytes] of files) {
      const path = name.replace(/^\.\//, '');
      if (!KEPT.test(path)) continue;
      mkdirSync(dirname(join(making, path)), { recursive: true });
      writeFileSync(join(making, path), bytes);
    }
    const made = selftestOf(wibo, making);
    if (known.selftest && made !== known.selftest) throw new Error(`SN Systems' GCC ${version} doesn't make the object it's known to make of the tools' own file on this computer, so it isn't kept.`);
    writeFileSync(join(making, 'checked'), `${made}\n`);
    rmSync(folder, { recursive: true, force: true });
    renameSync(making, folder);
  } finally {
    rmSync(making, { recursive: true, force: true });
  }
  return { wibo, folder };
}

/**
 * Compiles a file with SN Systems' GCC `version`, as its driver does, `args` its flags and the file, in `cwd`:
 * { ok, said }, what it said. Temporary files go in `temporary`.
 */
export async function runSnGcc(version, args, { cwd, temporary, log = console.log }) {
  const { wibo, folder } = await ensureSnGcc(version, log);
  return drive(wibo, folder, args, cwd, temporary);
}
