// What builds the reference emulator on Windows, where most computers have no compiler: w64devkit's GCC and CMake, each
// as its makers publish it, at a fixed version and checked against its hash. Nothing gets installed. They go in a folder
// with a plain name, as the compiler can't read a path with a letter outside the computer's old code page, and many
// people's folders have one. build.mjs builds there, keeps its two programs and deletes the folder. What builds a
// program of its own each time it runs, as the NES's function check does, keeps the compiler alone in a folder of its
// own, WINDOWS_COMPILER, which no build clears (keptCompiler).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// DP_WINDOWS_BUILD names another, for someone who builds two things at once, as each build empties this folder first
export const WINDOWS_BUILD = process.env.DP_WINDOWS_BUILD || join(process.env.ProgramData ?? 'C:\\ProgramData', 'dreamports-build');
export const WINDOWS_COMPILER = join(process.env.ProgramData ?? 'C:\\ProgramData', 'dreamports-compiler');

const COMPILER = {
  name: 'w64devkit 2.10.1',
  url: 'https://github.com/skeeto/w64devkit/releases/download/v2.10.1/w64devkit-x64-2.10.1.7z.exe',
  sha256: 'add1edf984ce4d473cfeb7c52e0ab38db73a855bba6c7f564d5e16648eb2896a',
  bin: join(WINDOWS_BUILD, 'w64devkit', 'bin'),
};
const CMAKE = {
  name: 'CMake 4.4.4',
  url: 'https://github.com/Kitware/CMake/releases/download/v4.4.4/cmake-4.4.4-windows-x86_64.zip',
  sha256: 'bace36e94b31c68ab6fa295f26dfa11219e0701cf7c94b0284a7d1cb13dac536',
  bin: join(WINDOWS_BUILD, 'cmake-4.4.4-windows-x86_64', 'bin'),
};

// these two come with Windows, and Git for Windows' tools can have the same names, so they're named by their place
const fromWindows = program => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', program);

function run(command, args, what, cwd = WINDOWS_BUILD) {
  const result = spawnSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${what} failed: ${(result.stderr || result.error?.message || '').trim().split('\n').slice(-3).join(' ')}`);
}

// the file, checked, or an error that says so: a wrong one is never run or unpacked
function fetched({ name, url, sha256 }, folder = WINDOWS_BUILD) {
  const file = basename(url);
  run(fromWindows('curl.exe'), ['--fail', '--silent', '--show-error', '--location', '--retry', '3', '--output', file, url], `Getting ${name}`, folder);
  if (createHash('sha256').update(readFileSync(join(folder, file))).digest('hex') !== sha256) {
    throw new Error(`What was downloaded for ${name} isn't the file it should be, so it wasn't used. Try again, and if it says this again, ask the Dreamports team.`);
  }
  return file;
}

/** Gets them, saying so, and returns what the build runs. */
export function windowsTools(log) {
  mkdirSync(WINDOWS_BUILD, { recursive: true });
  log(`Getting ${COMPILER.name}, a compiler, and ${CMAKE.name}, about 120 MB, only for this build…`);
  const compiler = fetched(COMPILER), cmake = fetched(CMAKE);
  run(join(WINDOWS_BUILD, compiler), ['-y', `-o${WINDOWS_BUILD}`], `Unpacking ${COMPILER.name}`);
  run(fromWindows('tar.exe'), ['-xf', cmake], `Unpacking ${CMAKE.name}`);
  return {
    gcc: join(COMPILER.bin, 'gcc.exe'),
    cmake: join(CMAKE.bin, 'cmake.exe'),
    make: join(COMPILER.bin, 'make.exe'),
    env: { ...process.env, PATH: `${COMPILER.bin};${CMAKE.bin};${process.env.PATH}` },
  };
}

/** w64devkit's GCC, for what builds a program of its own each time it runs (../nes/twin.mjs): got once, as
 *  windowsTools gets it, unpacked in WINDOWS_COMPILER and kept there, with a note of the file it came from, which says
 *  it unpacked whole. Returns gcc's path. */
export function keptCompiler(log) {
  const gcc = join(WINDOWS_COMPILER, 'w64devkit', 'bin', 'gcc.exe'), note = join(WINDOWS_COMPILER, 'unpacked.txt');
  if (existsSync(gcc) && existsSync(note) && readFileSync(note, 'utf8') === COMPILER.sha256) return gcc;
  rmSync(WINDOWS_COMPILER, { recursive: true, force: true });
  mkdirSync(WINDOWS_COMPILER, { recursive: true });
  log(`Getting ${COMPILER.name}, a compiler, kept in ${WINDOWS_COMPILER} for the next time…`);
  const compiler = fetched(COMPILER, WINDOWS_COMPILER);
  run(join(WINDOWS_COMPILER, compiler), ['-y', `-o${WINDOWS_COMPILER}`], `Unpacking ${COMPILER.name}`, WINDOWS_COMPILER);
  rmSync(join(WINDOWS_COMPILER, compiler), { force: true });
  writeFileSync(note, COMPILER.sha256);
  return gcc;
}
