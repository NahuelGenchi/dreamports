// A Nintendo DS game's original, a function at a time: the program that runs one function of a game's code in melonDS's
// own processors (call.cpp), built on the contributor's computer once, from the emulator's source the tools fetch at
// the commit tools/consoles.mjs fixes, with the emulator's own build, and kept running while a check asks it for calls.
// The emulator is GPL-3.0 and never in the repository: only call.cpp, which drives it, is.
//
// A call starts from the image, the console's main memory as the check gives it, with a few values changed, and from
// the registers it's given, on the processor the function's program runs on: the ARM946E-S for the ARM9's own program
// and its overlays, the ARM7TDMI for the ARM7's. It ends when the function comes back to where r14 pointed, and answers
// what the function left in the registers and in the image, what it read, which of its instructions ran and whether
// each one's condition held, or why it didn't come back: it ran out of instructions, ran where the check can't follow,
// such as the BIOS, read or wrote where the check has no memory, or used a coprocessor.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { buildProgram, builtWithOf } from '../libretro/build.mjs';

const CALL = fileURLToPath(new URL('./call.cpp', import.meta.url));

/** The image a call starts from and leaves: the console's main memory, 4 MB at 0x02000000. */
export const RAM = 0x400000, IMAGE = RAM, MEMORY = 0x02000000;
const CHUNK = 256;

/** The registers a call is given, r0 to r14, and after them the flags; and as it answers them, r0 to r15 and then the
 *  status register. */
export const REGISTERS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc', 'cpsr'];

/** How a call ended, in words. */
export const ENDS = ['came back', 'ran out of instructions', 'ran where the check can\'t follow', 'read or wrote where the check has no memory', 'used a coprocessor'];
export const CAME_BACK = 0, OUT_OF_STEPS = 1, ELSEWHERE = 2, MEMORY_END = 3, COPROCESSOR = 4;

export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Whether an address is in the console's main memory, as either processor sees it: its 4 MB, seen again up to 0x02FFFFFF. */
export const inMemory = address => (address >>> 24) === 0x02;

/** Where an address is in the image, or -1. */
export const inImage = address => (inMemory(address) ? (address >>> 0) & (RAM - 1) : -1);

/** The address of a place in the image, as code sees it, and which memory it's in. */
export const addressAt = at => ({ address: (MEMORY + at) >>> 0, name: 'the console\'s main memory' });

// the processors' exceptions, by how far into the BIOS's first words each one goes
const VECTORS = { 0x04: 'an instruction the processor doesn\'t have', 0x08: 'a call of the BIOS', 0x0C: 'an instruction it couldn\'t fetch', 0x10: 'memory it couldn\'t reach', 0x18: 'an interrupt' };

/** Whether an address is in a processor's BIOS: the ARM9's at 0xFFFF0000, the ARM7's at the bottom of its memory. */
export const inBios = (address, arm7) => (arm7 ? (address >>> 0) < 0x4000 : (address >>> 0) >= 0xFFFF0000);

/** Each other memory of the console the check doesn't cover yet, by its place: what a call that stops there is told. */
export function memoryAt(address, arm7) {
  const top = address >>> 24;
  if (inBios(address, arm7)) return 'the BIOS';
  if (!arm7 && top < 0x02) return 'where the ARM9\'s fast memory for code is once a game turns it on';
  if (top === 0x03) return arm7 ? 'the memory the two processors share, or the ARM7\'s own' : 'the memory the two processors share';
  if (top === 0x04) return 'the hardware\'s registers';
  if (top === 0x05) return 'the palettes';
  if (top === 0x06) return 'the video memory';
  if (top === 0x07) return 'the sprites\' memory';
  if (top >= 0x08 && top <= 0x0A) return 'the Game Boy Advance cartridge\'s place';
  return 'no memory the check knows, which on the ARM9 can be its fast memory for data';
}

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }, arm7 = false) {
  if (end === ELSEWHERE) {
    const vector = inBios(detail, arm7) ? VECTORS[detail & 0xFFFF] : null;
    return `ran where the check can't follow, at 0x${hex(detail)}, ${vector ? `the BIOS, for ${vector}` : memoryAt(detail, arm7)}`;
  }
  if (end === MEMORY_END) return `read or wrote 0x${hex(detail)}, ${memoryAt(detail, arm7)}, at 0x${hex(pc)}, where the check has no memory yet`;
  if (end === COPROCESSOR) return `used a coprocessor, at 0x${hex(pc)}, as code that sets the processor up does`;
  return `${ENDS[end] ?? `ended in a way the tools don't know (${end})`}${end === OUT_OF_STEPS ? `, at 0x${hex(pc)}` : ''}`;
}

// the program, built once for this commit of the emulator, this patch and these settings, and this call.cpp, in a
// folder of the tools' own
const FOLDER = join(LOCAL, 'twin', 'nds-caller');
function programFile() {
  const { core } = consoleOf('nds');
  const own = createHash('sha1').update(readFileSync(CALL)).digest('hex').slice(0, 8);
  return join(FOLDER, `call-${core.commit.slice(0, 12)}${builtWithOf(core)}-${own}${process.platform === 'win32' ? '.exe' : ''}`);
}

/** Builds the program that calls the original's functions, if this computer hasn't yet: its file. */
export function buildCaller(log = console.log) {
  const program = programFile();
  if (existsSync(program)) return program;
  const machine = consoleOf('nds');
  log(`Building the Nintendo DS's two processors from its emulator's source, at ${machine.core.source}, once, which takes a few minutes…`);
  buildProgram(machine, { what: 'Building the program that calls the Nintendo DS\'s functions', files: { [CALL]: 'dreamports/call.cpp' }, target: 'dreamports_nds_call', out: program, log });
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
    this.child.on('error', error => {
      this.over = `The program that calls the Nintendo DS's functions didn't start: ${error.message}.`;
      this.wake?.();
    });
    this.child.on('exit', code => {
      this.over ??= `The program that calls the Nintendo DS's functions ended (${code})${this.said ? `: ${this.said.trim()}` : ''}.`;
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
    if (answer[0] !== 0x6B) throw new Error('The program that calls the Nintendo DS\'s functions didn\'t take the image.');
  }

  /**
   * Runs the function at `address`, `span` bytes long, in Thumb code with `thumb` and on the ARM7 with `arm7`, from the
   * image with `changes`, each [address, bytes, value], and with `registers`, r0 to r14 and then the flags, r14 the
   * address it comes back to. `limit` is how many instructions it may run. Answers { end, detail, pc, steps, status,
   * registers, ran, reads, chunks }: `status` whether it left the processor's mode or interrupt bits changed;
   * `registers` r0 to r15 and the status register; `ran` a byte for each two bytes of the function, 1 an instruction
   * there ran, 2 its condition held, 4 it didn't; `reads` each place read, { address, bytes, value, beside }, `beside`
   * for a value the instruction read from beside itself; `chunks` each 256 bytes of the image the function wrote,
   * { at, bytes }.
   */
  async call({ address, span, thumb = false, arm7 = false, limit = 1000000, registers, changes = [] }) {
    if (registers.length !== 16) throw new Error('A call is given r0 to r14 and the flags.');
    const words = [address, span, limit, (thumb ? 1 : 0) | (arm7 ? 2 : 0), ...registers, changes.length, ...changes.flat()];
    this.child.stdin.write(Buffer.concat([Buffer.from('C'), ...words.map(word)]));
    const [end, detail, pc, steps, status] = await this.words(5);
    const left = await this.words(17);
    const ran = new Uint8Array(await this.take(Math.floor(span / 2)));
    const [readCount] = await this.words(1);
    const flat = await this.words(readCount * 3);
    const reads = Array.from({ length: readCount }, (_, i) => ({ address: flat[i * 3], bytes: flat[i * 3 + 1] & 0xFF, value: flat[i * 3 + 2], beside: !!(flat[i * 3 + 1] & 0x100) }));
    const [chunkCount] = await this.words(1);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const [index] = await this.words(1);
      chunks.push({ at: index * CHUNK, bytes: Uint8Array.from(await this.take(CHUNK)) });
    }
    return { end, detail, pc, steps, status: !!status, registers: left, ran, reads, chunks };
  }

  close() {
    if (!this.child.killed && this.child.exitCode === null) this.child.stdin.end('Q');
  }
}

/** The image a call starts from with `changes` made in it, and then with what a call left, `chunks`: a new image. */
export function imageAfter(image, changes = [], chunks = []) {
  const made = Uint8Array.from(image);
  for (const [address, bytes, value] of changes) {
    if (!inMemory(address)) continue;
    for (let i = 0; i < bytes; i++) made[inImage(address + i)] = (value >>> (8 * i)) & 0xFF;
  }
  for (const chunk of chunks) made.set(chunk.bytes, chunk.at);
  return made;
}
