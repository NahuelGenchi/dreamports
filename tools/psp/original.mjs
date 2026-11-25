// A PlayStation Portable game's original, a function at a time: the console's emulator in the tools, PPSSPP, with the
// tools' patch (../libretro/ppsspp.patch), which runs one function of the program by its own interpreter, driven by the
// tools' program that drives every emulator in its `call` mode (../libretro/host.c). The copy is started and played for
// one frame, so the console is there, and is then kept running while a check asks it for calls. So the reference is
// the processor the proof's emulator runs every game on.
//
// A call starts from the image, the console's memory as the check gives it, with a few values changed, and from the
// registers it's given. It ends when the function comes back to where ra pointed, and answers what the function left
// in the registers and in the image, what it read, which of its instructions ran and which way each branch went, or
// why it didn't come back: it ran out of instructions, met an exception, went where the check can't follow, or
// reached the system's functions, which a twin asks the kit for.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { HOST, buildReference, coreFile, systemFolder } from '../libretro/build.mjs';

/** Where the console's memories are, and the image a call starts from and leaves, as `call` takes it: the main memory
 *  at 0x08000000, as much as the console has, then the scratchpad and the video memory. */
export const RAM = 0x08000000, SCRATCHPAD = 0x00010000, SCRATCHPAD_BYTES = 0x4000, VRAM = 0x04000000, VRAM_BYTES = 0x200000;
/** Every address is cut to this first: the uncached and the kernel's views of a memory are the same memory. */
export const MASK = 0x0FFFFFFF;
const CHUNK = 256;
/** The registers by the names MIPS code gives them, in the processor's order, then hi and lo. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra', 'hi', 'lo'];
/** The floating-point unit's control register as the console starts a program: rounding to the nearest. */
export const FCR31 = 0;
/** The vector unit's 16 control registers as the console starts a program, as PPSSPP has them: no prefixes, every
 *  condition bit set, and its numbers for vrnd's sums. */
export const VFPU_CONTROL = [0xE4, 0xE4, 0, 0x3F, 0, 0, 0, 0x7772CEAB, 0x3F800001, 0x3F800002, 0x3F800004, 0x3F800008, 0x3F800000, 0x3F800000, 0x3F800000, 0x3F800000];
/** How a call ended. */
export const CAME_BACK = 0, OUT_OF_STEPS = 1, EXCEPTION = 2, ELSEWHERE = 3, SYSTEM = 4;
export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** The places of the image for a console with `ram` bytes of main memory: each { at, address, bytes, span, name }. */
export function regionsOf(ram) {
  return [
    { at: 0, address: RAM, bytes: ram, span: ram, name: 'the console\'s memory' },
    { at: ram, address: SCRATCHPAD, bytes: SCRATCHPAD_BYTES, span: SCRATCHPAD_BYTES, name: 'the scratchpad' },
    // the video memory is seen four times over
    { at: ram + SCRATCHPAD_BYTES, address: VRAM, bytes: VRAM_BYTES, span: VRAM_BYTES * 4, name: 'the video memory' },
  ];
}
/** Where an address is in the image, or -1. */
export function inImage(regions, address) {
  const cut = (address & MASK) >>> 0;
  for (const r of regions) if (cut >= r.address && cut - r.address < r.span) return r.at + (cut - r.address) % r.bytes;
  return -1;
}
/** The address of a place in the image, as code sees it, and which memory it's in. */
export function addressAt(regions, at) {
  const region = regions.findLast(r => at >= r.at);
  return { address: region.address + at - region.at, name: region.name };
}
/** The image as it is once the call's `changes` and the original's `chunks` are laid over it. */
export function imageAfter(image, regions, changes, chunks) {
  const after = Uint8Array.from(image);
  const view = new DataView(after.buffer);
  for (const [address, bytes, value] of changes) {
    const at = inImage(regions, address);
    if (at < 0) continue;
    if (bytes === 1) view.setUint8(at, value);
    else if (bytes === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
  }
  for (const { at, bytes } of chunks) after.set(bytes, at);
  return after;
}
/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  if (end === EXCEPTION) return `met an exception, reaching 0x${hex(detail)}, where the console has no memory, at 0x${hex(pc)}`;
  if (end === SYSTEM) return `called the system's functions, at 0x${hex(detail)}`;
  if (end === ELSEWHERE) return `went where the check can't follow, to 0x${hex(detail)}`;
  if (end === OUT_OF_STEPS) return `didn't come back, at 0x${hex(detail)}`;
  return `ended in a way the tools don't know (${end})`;
}

const word = value => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/**
 * The original, kept running on `copy`, the player's copy: `ready()` once, which answers how much main memory the
 * console has, `image(bytes, regions)` sets the memory every call starts from, `call(...)` runs a function, and
 * `close()` ends it. Each answers in turn.
 */
export class Original {
  constructor(copy, log = console.log) {
    const machine = consoleOf('psp');
    buildReference(machine, log);
    const options = Object.entries(machine.core.options ?? {}).map(([key, value]) => `${key}=${value}`);
    const saves = join(LOCAL, 'libretro', 'saves', 'psp', `call-${process.pid}`);
    this.child = spawn(HOST, [coreFile(machine.core), copy, 'call', ...options], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DP_SYSTEM: systemFolder(machine), DP_SAVE_FOLDER: saves } });
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
      this.over = `The program that calls the PlayStation Portable's functions ended (${code})${this.said ? `: ${this.said.trim()}` : ''}.`;
      this.wake?.();
    });
  }

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

  /** How many bytes of main memory the console has. */
  async ready() {
    this.ram ??= (await this.words(1))[0];
    return this.ram;
  }

  /** Sets the image every call starts from, laid out as `regions` says. */
  async image(bytes, regions) {
    await this.ready();
    this.child.stdin.write(Buffer.concat([Buffer.from('I'), word(regions.length), ...regions.flatMap(r => [word(r.address), word(r.bytes), word(r.span)]), word(MASK)]));
    this.child.stdin.write(bytes);
    const answer = await this.take(1);
    if (answer[0] !== 0x6B) throw new Error('The program that calls the PlayStation Portable\'s functions didn\'t take the image.');
  }

  /**
   * Runs the function at `address`, `span` bytes long, from the image with `changes`, each [address, bytes, value],
   * and with `registers`, 34 numbers in the order of REGISTERS, `floats`, the floating-point unit's 32 registers as
   * their bits, and `control`, its control register, `vectors`, the vector unit's 128 registers as their bits, and
   * `vectorControl`, its 16 control registers, `back` the address ra points at, where it comes back to. `limit` is how
   * many instructions it may run, and `stops` the addresses that are the system's. Answers { end, detail, pc, steps,
   * registers, floats, control, vectors, vectorControl, ran, reads, chunks }: `ran` a byte for each instruction of the function, 1 ran, 2
   * went to its target, 4 went on; `reads` each place read, { address, bytes, value }; `chunks` each 256 bytes of the
   * image the function wrote, { at, bytes }.
   */
  async call({ address, span, limit = 1000000, back, registers, floats = new Array(32).fill(0), control = FCR31, vectors = new Array(128).fill(0), vectorControl = VFPU_CONTROL, changes = [], stops = [] }) {
    if (registers.length !== 34 || floats.length !== 32 || vectors.length !== 128 || vectorControl.length !== 16) throw new Error('A call of the original needs every register: 34, 32 floats, 128 of the vector unit and its 16 control registers.');
    const words = [address, span, limit, back, ...registers, ...floats, control, ...vectors, ...vectorControl, changes.length, ...changes.flat(), stops.length, ...stops];
    this.child.stdin.write(Buffer.concat([Buffer.from('C'), ...words.map(word)]));
    const [end, detail, pc, steps, ...left] = await this.words(215);
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
    return { end, detail, pc, steps, registers: left.slice(0, 34), floats: left.slice(34, 66), control: left[66], vectors: left.slice(67, 195), vectorControl: left.slice(195, 211), ran, reads, chunks };
  }

  close() {
    if (!this.child.killed && this.child.exitCode === null) this.child.stdin.end('Q');
  }
}
