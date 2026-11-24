// A Super Nintendo game's original, a function at a time: the program that runs one function of a game's cartridge in
// Snes9x's own 65816 (call.cpp), built on the contributor's computer once, from the emulator's source the tools fetch
// at the commit tools/consoles.mjs fixes, and kept running while a check asks it for calls. Snes9x is under its own
// licence, for free use and never for sale, and is never in the repository: only call.cpp, the tools' own stand-in for
// the rest of the console, is.
//
// A call starts from the image, the console's work memory, its hardware's registers and the cartridge's save memory
// as the check gives them, with a few values changed, and from the registers it's given, with the address it comes
// back to pushed on its stack. It ends when the processor reaches that address, and answers what the function left in
// the registers and in the image, what it read, each read and write of the hardware in order, which of its
// instructions ran with which flags and which way each branch went, or why it didn't come back: it ran out of
// instructions, waited for an interrupt, stopped the processor, or went where the check can't follow.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { WINDOWS_BUILD } from '../gba/windows.mjs';
import { HARDWARE, mapOf, placeIn, SAVE, WORK, WRAM } from './cartridge.mjs';

const CALL = fileURLToPath(new URL('./call.cpp', import.meta.url));
// the emulator's own files the program is built from: the processor's instructions and the state they keep
const PROCESSOR = ['cpuops.cpp', 'globals.cpp'];
// as the reference emulator's own build compiles them (its libretro/Makefile)
const DEFINES = ['-DNDEBUG', '-D__LIBRETRO__', '-DALLOW_CPU_OVERCLOCK', '-DHAVE_STRINGS_H'];

/** The image a call starts from and leaves, as call.cpp lays it out: the work memory, the hardware's registers
 *  $2100 to $21FF and $4000 to $43FF, and then the save memory, as many bytes as the cartridge has. */
export const PPU_AT = WRAM, CPU_AT = WRAM + 0x100, SRAM_AT = WRAM + 0x500;
export const imageSize = sram => SRAM_AT + sram;
const CHUNK = 256;

/** How a call comes back: as from JSR, from JSL, or from an interrupt. */
export const RTS = 0, RTL = 1, RTI = 2;
/** The registers a call is given and leaves, in call.cpp's order; PB only as it leaves, as a call starts in the
 *  function's own bank. */
export const REGISTERS = ['a', 'x', 'y', 's', 'd', 'db', 'p', 'e'];
export const LEFT = ['a', 'x', 'y', 's', 'd', 'db', 'pb', 'p', 'e'];
/** The flags of P, by their bits. */
export const FLAGS = { C: 0x01, Z: 0x02, I: 0x04, D: 0x08, X: 0x10, M: 0x20, V: 0x40, N: 0x80 };
/** What ran, by the bits of a byte of `ran`. */
export const RAN = { STARTED: 1, TAKEN: 2, NOT_TAKEN: 4, A8: 8, A16: 16, XY8: 32, XY16: 64, EMULATION: 128 };

/** How a call ended, in words. */
export const ENDS = ['came back', 'ran out of instructions', 'waits for an interrupt', 'stopped the processor', 'ran code where no code can be', 'reached where nothing is'];
export const CAME_BACK = 0, OUT_OF_STEPS = 1, WAITS = 2, STOPPED = 3, ELSEWHERE = 4, NOWHERE = 5;
const WRITE = 0x1000000;

export const hex = (n, digits = 6) => (n >>> 0).toString(16).toUpperCase().padStart(digits, '0');
/** An address as the console's code writes it, $BB:AAAA. */
export const named = address => `$${hex(address >>> 16, 2)}:${hex(address & 0xFFFF, 4)}`;

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  if (end === ELSEWHERE) return `ran code at ${named(detail)}, where no code can be`;
  if (end === NOWHERE) return detail & WRITE ? `wrote to ${named(detail & 0xFFFFFF)}, where nothing is kept` : `read ${named(detail)}, where nothing is`;
  return `${ENDS[end] ?? `ended in a way the tools don't know (${end})`}${end === OUT_OF_STEPS || end === WAITS || end === STOPPED ? `, at ${named(pc)}` : ''}`;
}

/** Where an address is in the image, or -1: the work memory, with its mirror, the hardware's registers or the save
 *  memory, as `map` lays them out. */
export function inImage(map, address) {
  const { what, at } = placeIn(map, address);
  if (what === WORK) return at;
  if (what === SAVE) return SRAM_AT + at;
  if (what !== HARDWARE) return -1;
  let low = address & 0xFFFF;
  if (low >= 0x2140 && low < 0x2180) low = 0x2140 | (low & 3);
  if (low >= 0x2100 && low < 0x2200) return PPU_AT + low - 0x2100;
  if (low >= 0x4000 && low < 0x4400) return CPU_AT + low - 0x4000;
  return -1;
}

/** The address of a place in the image, as the console sees it, and which memory it's in. */
export function addressAt(at) {
  if (at < WRAM) return { address: 0x7E0000 + at, name: 'the work memory' };
  if (at < CPU_AT) return { address: 0x2100 + at - PPU_AT, name: 'the picture\'s and the sound\'s registers' };
  if (at < SRAM_AT) return { address: 0x4000 + at - CPU_AT, name: 'the processor\'s registers' };
  return { address: at - SRAM_AT, name: 'the save memory' };
}

// the program, built once for this commit of the emulator and this call.cpp, in a folder of the tools' own
const FOLDER = join(LOCAL, 'twin', 'snes-caller');
function programFile() {
  const { core } = consoleOf('snes');
  return join(FOLDER, `call-${core.commit.slice(0, 12)}${process.platform === 'win32' ? '.exe' : ''}`);
}

/** Builds the program that calls the original's functions, if this computer hasn't yet: its file. */
export function buildCaller(log = console.log) {
  const program = programFile(), stamp = `${program}.source`, text = readFileSync(CALL, 'utf8');
  if (existsSync(program) && existsSync(stamp) && readFileSync(stamp, 'utf8') === text) return program;
  const machine = consoleOf('snes');
  log(`Getting the Super Nintendo's processor from its emulator's source, at ${machine.core.source}…`);
  mkdirSync(FOLDER, { recursive: true });
  rmSync(program, { force: true });
  // on Windows with the compiler the tools get for a build, in its folder with a plain name, where the emulator's
  // source is fetched too, and with the compiler's own libraries built in, as that folder goes once it's built
  // (../gba/windows.mjs); anywhere else with the computer's own
  withBuildTools(log, tools => buildWith(tools, machine, program));
  writeFileSync(stamp, text);
  return program;
}

function buildWith(tools, machine, program) {
  const source = fetchSource(machine);
  const compiler = process.env.CXX || (tools ? join(dirname(tools.gcc), 'g++.exe') : 'c++');
  const [from, to] = tools ? [join(WINDOWS_BUILD, 'snes-call.cpp'), join(WINDOWS_BUILD, 'snes-call.exe')] : [CALL, program];
  if (tools) copyFileSync(CALL, from);
  const include = ['', 'libretro', join('libretro', 'libretro-common', 'include'), 'apu', join('apu', 'bapu')].flatMap(folder => ['-I', join(source, folder)]);
  const result = spawnSync(compiler, ['-std=gnu++17', '-O2', '-w', ...(tools ? ['-static'] : []), ...DEFINES, ...include, '-o', to, from, ...PROCESSOR.map(name => join(source, name))], { encoding: 'utf8', maxBuffer: 2 ** 26, env: tools?.env });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C++ compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`The program that calls the Super Nintendo's functions didn't build:\n${(result.stderr || '').trim().split('\n').slice(0, 40).join('\n')}`);
  if (tools) copyFileSync(to, program);
}

const word = value => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/**
 * The original, kept running: `cartridge(cart)` lays out a cartridge read by readCartridge, `image(bytes)` sets the
 * memory every call starts from, `call(...)` runs a function, and `close()` ends it. Each answers in turn.
 */
export class Original {
  constructor(program = buildCaller()) {
    this.child = spawn(program, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.held = [];
    this.bytes = 0;
    this.wake = null;
    this.said = '';
    this.over = null;
    this.map = null;
    this.child.stdout.on('data', chunk => {
      this.held.push(chunk);
      this.bytes += chunk.length;
      this.wake?.();
    });
    this.child.stderr.on('data', chunk => { this.said += chunk; });
    this.child.on('exit', code => {
      this.over = `The program that calls the Super Nintendo's functions ended (${code})${this.said ? `: ${this.said.trim()}` : ''}.`;
      this.wake?.();
    });
  }

  // the next `count` bytes it answers
  async take(count) {
    while (this.bytes < count) {
      if (this.over) throw new Error(this.over);
      await new Promise(wake => { this.wake = wake; });
      this.wake = null;
    }
    const all = Buffer.concat(this.held);
    this.held = [all.subarray(count)];
    this.bytes -= count;
    return all.subarray(0, count);
  }

  async words(count) {
    const bytes = await this.take(count * 4);
    return Array.from({ length: count }, (_, i) => bytes.readUInt32LE(i * 4));
  }

  async ok(what) {
    const answer = await this.take(1);
    if (answer[0] !== 0x6B) throw new Error(`The program that calls the Super Nintendo's functions didn't take the ${what}.`);
  }

  /** Lays out a cartridge, as readCartridge gives it: its ROM, its save memory and its map. Answers the map. */
  async cartridge(cart, map = mapOf(cart)) {
    const { rom, sram } = cart;
    this.map = map;
    this.sram = sram;
    this.child.stdin.write(Buffer.concat([Buffer.from('R'), word(rom.length), Buffer.from(rom.buffer, rom.byteOffset, rom.length), word(sram), Buffer.from(map.buffer, map.byteOffset, map.byteLength)]));
    await this.ok('cartridge');
    return map;
  }

  /** Sets the image every call starts from: imageSize(sram) bytes. */
  async image(bytes) {
    if (bytes.length !== imageSize(this.sram)) throw new Error(`An image is ${imageSize(this.sram)} bytes for this cartridge, and this one is ${bytes.length}.`);
    this.child.stdin.write(Buffer.from('I'));
    this.child.stdin.write(bytes);
    await this.ok('image');
  }

  /**
   * Runs the function at `address`, `span` bytes long, from the image with `changes`, each [address, bytes, value],
   * and with `registers`, { a, x, y, s, d, db, p, e }, coming back `way` (RTS, RTL or RTI) to `back`. `limit` is how
   * many instructions it may run. Answers { end, detail, pc, steps, cycles, registers, ran, reads, hardware, chunks }:
   * `registers` as LEFT names them, `ran` a byte for each byte of the function, with the bits of RAN, `reads` each
   * byte read, { address, value }, `hardware` each read and write of a register in order, { register, value, write },
   * `chunks` each 256 bytes of the image the function wrote, { at, bytes }.
   */
  async call({ address, span, limit = 1000000, way = RTS, back, registers = {}, changes = [] }) {
    const given = REGISTERS.map(name => registers[name] ?? (name === 's' ? 0x1FFF : name === 'p' ? 0x30 : 0));
    const words = [address, span, limit, way, back ?? (address & 0xFF0000), ...given, changes.length, ...changes.flat()];
    this.child.stdin.write(Buffer.concat([Buffer.from('C'), ...words.map(word)]));
    const [end, detail, pc, steps, cycles] = await this.words(5);
    const values = await this.words(LEFT.length);
    const left = Object.fromEntries(LEFT.map((name, i) => [name, values[i]]));
    const ran = new Uint8Array(await this.take(span));
    const [readCount] = await this.words(1);
    const flat = await this.words(readCount * 2);
    const reads = Array.from({ length: readCount }, (_, i) => ({ address: flat[i * 2], value: flat[i * 2 + 1] }));
    const [hardwareCount] = await this.words(1);
    const noted = await this.words(hardwareCount * 3);
    const hardware = Array.from({ length: hardwareCount }, (_, i) => ({ register: noted[i * 3], value: noted[i * 3 + 1], write: noted[i * 3 + 2] === 1 }));
    const [chunkCount] = await this.words(1);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const [index] = await this.words(1);
      chunks.push({ at: index * CHUNK, bytes: Uint8Array.from(await this.take(CHUNK)) });
    }
    return { end, detail, pc, steps, cycles, registers: left, ran, reads, hardware, chunks };
  }

  close() {
    if (!this.child.killed && this.child.exitCode === null) this.child.stdin.end('Q');
  }
}

/** The image a call starts from with `changes` made in it, and then with what a call left, `chunks`: a new image. */
export function imageAfter(map, image, changes = [], chunks = []) {
  const made = Uint8Array.from(image);
  for (const [address, bytes, value] of changes) {
    for (let i = 0; i < bytes; i++) {
      const at = inImage(map, address + i);
      if (at >= 0 && at < made.length) made[at] = (value >>> (8 * i)) & 0xFF;
    }
  }
  for (const chunk of chunks) made.set(chunk.bytes, chunk.at);
  return made;
}
