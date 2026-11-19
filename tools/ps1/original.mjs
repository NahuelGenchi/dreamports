// A PlayStation game's original, a function at a time: the program that runs one function of a game's program in PCSX
// ReARMed's own interpreter (call.c), built on the contributor's computer once, from the emulator's source the tools
// fetch at the commit tools/consoles.mjs fixes, and kept running while a check asks it for calls. The emulator is
// GPL-2.0 and never in the repository: only call.c, the tools' own stand-in for the rest of it, is.
//
// A call starts from the image, the console's memory as the check gives it, with a few values changed, and from the
// registers it's given. It ends when the function comes back to where ra pointed, and answers what the function left
// in the registers and in the image, what it read, which of its instructions ran and which way each branch went, or
// why it didn't come back: it ran out of instructions, met an exception, or went where the check can't follow, such
// as the BIOS.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';

const CALL = fileURLToPath(new URL('./call.c', import.meta.url));
// the emulator's own files the program is built from, in its source's libpcsxcore/
const PROCESSOR = ['psxinterpreter.c', 'gte.c', 'gte_divider.c'];

/** The image a call starts from and leaves, as call.c lays it out: the console's 2 MB, then the scratchpad and the
 *  hardware's registers, at the distance from 0x1F800000 the console has them. */
export const RAM = 0x200000, IMAGE = RAM + 0x3000;
export const REGIONS = [
  { at: 0, address: 0x80000000, bytes: RAM, name: 'the console\'s memory' },
  { at: RAM, address: 0x1F800000, bytes: 0x400, name: 'the scratchpad' },
  { at: RAM + 0x1000, address: 0x1F801000, bytes: 0x2000, name: 'the hardware\'s registers' },
];
const CHUNK = 256;

/** The registers by the names MIPS code gives them, in the processor's order, then hi and lo. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra', 'hi', 'lo'];

/** How a call ended, in words. */
export const ENDS = ['came back', 'ran out of instructions', 'met an exception', 'went where the check can\'t follow', 'isolated the cache, as the BIOS does to clear it', 'went through a mirror of the console\'s memory'];
export const CAME_BACK = 0, OUT_OF_STEPS = 1, EXCEPTION = 2, ELSEWHERE = 3, CACHE = 4, MIRROR = 5;
// the console's exceptions, by the number in their cause
const CAUSES = { 4: 'an address error, reading where no halfword or word starts', 5: 'an address error, writing where no halfword or word starts', 6: 'a bus error, running where nothing is', 7: 'a bus error, reading or writing where nothing is', 8: 'a syscall', 9: 'a break', 10: 'an instruction the processor doesn\'t have', 11: 'a coprocessor that isn\'t usable', 12: 'an overflow' };

/** Whether an address is the BIOS's: its calls and its own values in the lowest 64 KB of the console's memory, as
 *  each of the three ways of seeing it has them, or its program, at 0x1FC00000. */
export function inBios(address) {
  const physical = (address >>> 0) & 0x1FFFFFFF;
  return ((address >>> 0) < 0x20000000 || (address >>> 0) >= 0x80000000) && (address >>> 0) < 0xC0000000 && (physical < 0x10000 || (physical >= 0x1FC00000 && physical < 0x1FC80000));
}

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  const at = `0x${hex(pc)}`;
  if (end === EXCEPTION) return `met ${CAUSES[(detail >>> 2) & 31] ?? `exception ${(detail >>> 2) & 31}`} at ${at}`;
  if (end === MIRROR) return `went through a mirror of the console's memory, to 0x${hex(detail)}, which a twin's module doesn't have`;
  if (end === ELSEWHERE) return inBios(detail) ? `went into the BIOS, at 0x${hex(detail)}` : `went where the check can't follow, to 0x${hex(detail)}`;
  return `${ENDS[end] ?? `ended in a way the tools don't know (${end})`}${end === OUT_OF_STEPS ? `, at ${at}` : ''}`;
}

export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Where an address is in the image, or -1: the console's memory with its mirrors, the scratchpad, or the hardware's
 *  registers, however the console's wiring sees them. */
export function inImage(address) {
  const physical = (address >>> 0) & 0x1FFFFFFF;
  if ((address >>> 0) >= 0xC0000000 || ((address >>> 0) >= 0x20000000 && (address >>> 0) < 0x80000000)) return -1;
  if (physical < 0x800000) return physical & (RAM - 1);
  const low = physical & 0xFFFF;
  if ((physical & 0xFFFF0000) === 0x1F800000 && (low < 0x400 || (low >= 0x1000 && low < 0x3000))) return RAM + low;
  return -1;
}

/** The address of a place in the image, as code in the console's memory sees it, and which memory it's in. */
export function addressAt(at) {
  const region = REGIONS.findLast(r => at >= r.at);
  return { address: region.address + at - region.at, name: region.name };
}

// the program, built once for this commit of the emulator and this call.c, in a folder of the tools' own
const FOLDER = join(LOCAL, 'twin', 'ps1-caller');
function programFile() {
  const { core } = consoleOf('ps1');
  return join(FOLDER, `call-${core.commit.slice(0, 12)}${process.platform === 'win32' ? '.exe' : ''}`);
}

/** Builds the program that calls the original's functions, if this computer hasn't yet: its file. */
export function buildCaller(log = console.log) {
  const program = programFile(), stamp = `${program}.source`, text = readFileSync(CALL, 'utf8');
  if (existsSync(program) && existsSync(stamp) && readFileSync(stamp, 'utf8') === text) return program;
  const machine = consoleOf('ps1');
  log(`Getting the PlayStation's processor from its emulator's source, at ${machine.core.source}…`);
  const source = fetchSource(machine);
  mkdirSync(FOLDER, { recursive: true });
  rmSync(program, { force: true });
  const compiler = process.env.CC || (process.platform === 'win32' ? 'gcc' : 'cc');
  const result = spawnSync(compiler, ['-std=gnu11', '-O2', '-w', '-DNDEBUG', '-I', join(source, 'include'), '-I', join(source, 'libpcsxcore'),
    '-o', program, CALL, ...PROCESSOR.map(name => join(source, 'libpcsxcore', name))], { encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`The program that calls the PlayStation's functions didn't build:\n${(result.stderr || '').trim().split('\n').slice(0, 40).join('\n')}`);
  writeFileSync(stamp, text);
  return program;
}

const word = value => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/**
 * The original, kept running: `image(bytes)` sets the memory every call starts from, `call(...)` runs a function,
 * and `close()` ends it. Each answers in turn.
 */
export class Original {
  constructor(program = buildCaller()) {
    this.child = spawn(program, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.held = [];
    this.bytes = 0;
    this.wake = null;
    this.said = '';
    this.over = null;
    this.child.stdout.on('data', chunk => {
      this.held.push(chunk);
      this.bytes += chunk.length;
      this.wake?.();
    });
    this.child.stderr.on('data', chunk => { this.said += chunk; });
    this.child.on('exit', code => {
      this.over = `The program that calls the PlayStation's functions ended (${code})${this.said ? `: ${this.said.trim()}` : ''}.`;
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

  /** Sets the image every call starts from: IMAGE bytes. */
  async image(bytes) {
    if (bytes.length !== IMAGE) throw new Error(`An image is ${IMAGE} bytes, and this one is ${bytes.length}.`);
    this.child.stdin.write(Buffer.from('I'));
    this.child.stdin.write(bytes);
    const answer = await this.take(1);
    if (answer[0] !== 0x6B) throw new Error('The program that calls the PlayStation\'s functions didn\'t take the image.');
  }

  /**
   * Runs the function at `address`, `span` bytes long, from the image with `changes`, each [address, bytes, value],
   * and with `registers`, an array of 34 numbers in the order of REGISTERS, ra the address it comes back to. `limit`
   * is how many instructions it may run. Answers { end, detail, pc, steps, gte, hardware, registers, ran, reads,
   * chunks }: `ran` a byte for each instruction of the function, 1 ran, 2 went to its target, 4 went on; `reads` each
   * place read, { address, bytes, value }; `chunks` each 256 bytes of the image the function wrote, { at, bytes }.
   */
  async call({ address, span, limit = 1000000, registers, changes = [] }) {
    const words = [address, span, limit, ...registers, changes.length, ...changes.flat()];
    this.child.stdin.write(Buffer.concat([Buffer.from('C'), ...words.map(word)]));
    const [end, detail, pc, steps, gte, hardware] = await this.words(6);
    const left = await this.words(34);
    const ran = new Uint8Array(await this.take(Math.floor(span / 4)));
    const [readCount] = await this.words(1);
    const flat = await this.words(readCount * 3);
    const reads = Array.from({ length: readCount }, (_, i) => ({ address: flat[i * 3], bytes: flat[i * 3 + 1], value: flat[i * 3 + 2] }));
    const [chunkCount] = await this.words(1);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const [index] = await this.words(1);
      chunks.push({ at: index * CHUNK, bytes: Uint8Array.from(await this.take(CHUNK)) });
    }
    return { end, detail, pc, steps, gte, hardware, registers: left, ran, reads, chunks };
  }

  close() {
    if (!this.child.killed && this.child.exitCode === null) this.child.stdin.end('Q');
  }
}

/** The image a call starts from with `changes` made in it, and then with what a call left, `chunks`: a new image. */
export function imageAfter(image, changes = [], chunks = []) {
  const made = Uint8Array.from(image);
  for (const [address, bytes, value] of changes) {
    const at = inImage(address);
    if (at < 0 || at + bytes > IMAGE) continue;
    for (let i = 0; i < bytes; i++) made[at + i] = (value >>> (8 * i)) & 0xFF;
  }
  for (const chunk of chunks) made.set(chunk.bytes, chunk.at);
  return made;
}
