// What builds the reference emulator on Windows, where most computers have no compiler: w64devkit's GCC and CMake,
// each as its makers publish it, at a fixed version and checked against its hash. They stay in .dreamports/gba/windows/
// while it builds, and build.mjs deletes them afterwards, so nothing is installed. The two programs that fetch and unpack
// them come with Windows; the ones with Git for Windows' tools can have the same names, so they're named by their place.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';

export const WINDOWS_TOOLS = join(LOCAL, 'gba', 'windows');

const COMPILER = {
  name: 'w64devkit 2.10.1',
  url: 'https://github.com/skeeto/w64devkit/releases/download/v2.10.1/w64devkit-x64-2.10.1.7z.exe',
  sha256: 'add1edf984ce4d473cfeb7c52e0ab38db73a855bba6c7f564d5e16648eb2896a',
  bin: join(WINDOWS_TOOLS, 'w64devkit', 'bin'),
};
const CMAKE = {
  name: 'CMake 4.4.4',
  url: 'https://github.com/Kitware/CMake/releases/download/v4.4.4/cmake-4.4.4-windows-x86_64.zip',
  sha256: 'bace36e94b31c68ab6fa295f26dfa11219e0701cf7c94b0284a7d1cb13dac536',
  bin: join(WINDOWS_TOOLS, 'cmake-4.4.4-windows-x86_64', 'bin'),
};

const fromWindows = program => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', program);

function run(command, args, what) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${what} failed: ${(result.stderr || result.error?.message || '').trim().split('\n').slice(-3).join(' ')}`);
}

// the file, checked, or an error that says so: a wrong one is never run or unpacked
function fetched({ name, url, sha256 }) {
  const file = join(WINDOWS_TOOLS, url.split('/').pop());
  run(fromWindows('curl.exe'), ['--fail', '--silent', '--show-error', '--location', '--retry', '3', '--output', file, url], `Getting ${name}`);
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256) {
    rmSync(file, { force: true });
    throw new Error(`What was downloaded for ${name} isn't the file it should be, so it wasn't used. Try again, and if it says this again, ask the Dreamports team.`);
  }
  return file;
}

/** Gets what's missing, saying so, and returns what the build runs. */
export function windowsTools(log) {
  mkdirSync(WINDOWS_TOOLS, { recursive: true });
  if (!existsSync(join(COMPILER.bin, 'gcc.exe')) || !existsSync(join(CMAKE.bin, 'cmake.exe'))) {
    log(`Getting ${COMPILER.name}, a compiler, and ${CMAKE.name}, about 120 MB, only for this build…`);
    const compiler = fetched(COMPILER), cmake = fetched(CMAKE);
    run(compiler, ['-y', `-o${WINDOWS_TOOLS}`], `Unpacking ${COMPILER.name}`);
    run(fromWindows('tar.exe'), ['-xf', cmake, '-C', WINDOWS_TOOLS], `Unpacking ${CMAKE.name}`);
    rmSync(compiler, { force: true });
    rmSync(cmake, { force: true });
  }
  return {
    gcc: join(COMPILER.bin, 'gcc.exe'),
    cmake: join(CMAKE.bin, 'cmake.exe'),
    make: join(COMPILER.bin, 'make.exe'),
    env: { ...process.env, PATH: `${COMPILER.bin};${CMAKE.bin};${process.env.PATH}` },
  };
}
