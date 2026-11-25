// A Nintendo 64 game's original, a function at a time: the program that runs one function of a game's program in
// Parallel N64's own processor, on its cached interpreter (call.c), built on the contributor's computer once, from the
// emulator's source the tools fetch at the commit tools/consoles.mjs fixes, and kept running while a check asks it for
// calls. The emulator is GPL-2.0 and never in the repository: only call.c, the tools' own stand-in for the rest of the
// console, is.
//
// A call starts from the image, the console's memory as the check gives it, in the console's byte order, with a few
// values changed, and from the registers it's given, 64 bits each. It ends when the function comes back to where ra
// pointed, and answers what the function left in the registers and in the image, what it read, which of its
// instructions ran and which way each branch went, or why it didn't come back: it ran out of instructions, met an
// exception, or went where the check can't follow, such as the cartridge.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { WINDOWS_BUILD } from '../gba/windows.mjs';

const CALL = fileURLToPath(new URL('./call.c', import.meta.url));
// the emulator's own files the program is built from: its processor, in mupen64plus-core/src/device/r4300/, and the
// hash it keeps of a page of code the TLB maps, in libretro-common
const PROCESSOR = ['cached_interp.c', 'idec.c', 'cp0.c', 'cp1.c', 'cp2.c', 'tlb.c', 'r4300_core.c'];
const ALSO = [join('libretro-common', 'encodings', 'encoding_xxh3.c')];
// as the reference emulator is built (tools/consoles.mjs), with every sum and product of the floating-point unit
// rounded as IEEE 754 asks, as the console's own is
export const FLOAT_RULES = ['-O2', '-ffp-contract=off', '-fno-fast-math'];

/** The image a call starts from and leaves, as call.c lays it out: the console's 8 MB, then the RSP's 4 KB of data and
 *  4 KB of instructions, then 0x40 bytes for each block of the hardware's registers. */
export const RAM = 0x800000, RSP_MEMORY = 0x2000, SLOT = 0x40;
const HARDWARE = [
  [0x04040000, 0x20, 'the RSP\'s registers'], [0x04080000, 0x08, 'the RSP\'s program counter'], [0x04100000, 0x20, 'the RDP\'s command registers'],
  [0x04200000, 0x10, 'the RDP\'s span registers'], [0x04300000, 0x10, 'the MI\'s registers'], [0x04400000, 0x38, 'the video interface\'s registers'],
  [0x04500000, 0x18, 'the audio interface\'s registers'], [0x04600000, 0x34, 'the cartridge interface\'s registers'], [0x04700000, 0x20, 'the RDRAM interface\'s registers'],
  [0x04800000, 0x1C, 'the serial interface\'s registers'], [0x1FC007C0, 0x40, 'the PIF\'s RAM'],
];
export const IMAGE = RAM + RSP_MEMORY + SLOT * 12;
/** Each part of the image, where it is in the image, its physical address, how many bytes of it there are, and what it is. */
export const REGIONS = [
  { at: 0, address: 0x00000000, bytes: RAM, name: 'the console\'s memory' },
  { at: RAM, address: 0x04000000, bytes: 0x1000, name: 'the RSP\'s data memory' },
  { at: RAM + 0x1000, address: 0x04001000, bytes: 0x1000, name: 'the RSP\'s instruction memory' },
  ...HARDWARE.map(([address, bytes, name], i) => ({ at: RAM + RSP_MEMORY + SLOT * i, address, bytes, name, hardware: true })),
];
const CHUNK = 256;

/** The registers by the names MIPS code gives them, in the processor's order, then hi and lo. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra', 'hi', 'lo'];
/** Coprocessor 0's Status as the emulator powers the console on: both coprocessors usable, and the floating-point unit's
 *  32 registers each 64 bits wide (FR). With FR off, as some games run, its even registers hold a pair each. */
export const POWER_ON_STATUS = 0x34000000;

/** How a call ended, in words. */
export const ENDS = ['came back', 'ran out of instructions', 'met an exception', 'went where the check can\'t follow'];
export const CAME_BACK = 0, OUT_OF_STEPS = 1, EXCEPTION = 2, ELSEWHERE = 3;
// the processor's exceptions, by the code in their Cause
const CAUSES = { 1: 'a TLB modification', 2: 'a TLB miss, reading or running', 3: 'a TLB miss, writing', 4: 'an address error, reading or running where no halfword, word or doubleword starts',
  5: 'an address error, writing where no halfword, word or doubleword starts', 6: 'a bus error, running', 7: 'a bus error, reading or writing', 8: 'a syscall', 9: 'a break',
  10: 'an instruction the processor doesn\'t have', 11: 'a coprocessor that isn\'t usable', 12: 'an overflow', 13: 'a trap', 15: 'a floating-point exception', 23: 'a watch' };

export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** A physical address, from any of the three ways code names memory without the TLB: 0x80000000 and up, 0xA0000000
 *  and up, or the physical address itself. */
export const physicalOf = address => ((address >>> 0) >= 0x80000000 && (address >>> 0) < 0xC0000000 ? (address >>> 0) & 0x1FFFFFFF : address >>> 0);

/** Whether a physical address is the cartridge's: its ROM, at 0x10000000 to 0x1FBFFFFF. */
export const inCartridge = physical => physical >= 0x10000000 && physical < 0x1FC00000;

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  const at = `0x${hex(pc)}`;
  if (end === EXCEPTION) {
    const code = (detail >>> 2) & 31;
    return `met ${CAUSES[code] ?? `exception ${code}`}${detail & 0x80000000 ? ' in a branch\'s delay slot' : ''} at ${at}`;
  }
  if (end === ELSEWHERE) {
    if (inCartridge(detail)) return `went into the cartridge, at 0x${hex(detail)}, which the check doesn't have`;
    if (detail >= 0x03F00000 && detail < 0x04000000) return `went to the RDRAM's own registers, at 0x${hex(detail)}, which the check doesn't have`;
    return `went where the check can't follow, to 0x${hex(detail)}`;
  }
  return `${ENDS[end] ?? `ended in a way the tools don't know (${end})`}${end === OUT_OF_STEPS ? `, at ${at}` : ''}`;
}

/** Where an address is in the image, or -1: the console's memory, the RSP's, or a hardware register kept there. */
export function inImage(address) {
  const physical = physicalOf(address);
  const region = REGIONS.find(r => physical >= r.address && physical < r.address + r.bytes);
  return region ? region.at + physical - region.address : -1;
}

/** The address of a place in the image, as code sees it, at 0x80000000 and up for the console's memory and at
 *  0xA0000000 and up for the rest, as games reach the hardware, and which part it's in. */
export function addressAt(at) {
  const region = REGIONS.findLast(r => at >= r.at);
  const physical = region.address + at - region.at;
  return { address: ((region.at === 0 ? 0x80000000 : 0xA0000000) | physical) >>> 0, name: region.name };
}

// the program, built once for this commit of the emulator and this call.c, in a folder of the tools' own
const FOLDER = join(LOCAL, 'twin', 'n64-caller');
function programFile() {
  const { core } = consoleOf('n64');
  return join(FOLDER, `call-${core.commit.slice(0, 12)}${process.platform === 'win32' ? '.exe' : ''}`);
}

/** Builds the program that calls the original's functions, if this computer hasn't yet: its file. */
export function buildCaller(log = console.log) {
  // built again when call.c changes, or how it's compiled, or the tools' change to the emulator's source it's built from
  const { core } = consoleOf('n64'), patch = core.patch ? readFileSync(join(REPO, core.patch), 'utf8') : '';
  const program = programFile(), stamp = `${program}.source`, text = `${readFileSync(CALL, 'utf8')}\n${FLOAT_RULES.join(' ')}\n${patch}`;
  if (existsSync(program) && existsSync(stamp) && readFileSync(stamp, 'utf8') === text) return program;
  const machine = consoleOf('n64');
  log(`Getting the Nintendo 64's processor from its emulator's source, at ${machine.core.source}…`);
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
  const source = fetchSource(machine), core = join(source, 'mupen64plus-core');
  const compiler = process.env.CC || tools?.gcc || 'cc';
  const [from, to] = tools ? [join(WINDOWS_BUILD, 'n64-call.c'), join(WINDOWS_BUILD, 'n64-call.exe')] : [CALL, program];
  if (tools) copyFileSync(CALL, from);
  const includes = [join(core, 'src'), join(core, 'src', 'api'), join(core, 'custom'), join(source, 'include'), join(source, 'libretro-common', 'include'), join(source, 'libretro')];
  const result = spawnSync(compiler, ['-std=gnu11', ...FLOAT_RULES, '-w', '-DNDEBUG', '-D__LIBRETRO__', '-DM64P_PLUGIN_API', '-DM64P_CORE_PROTOTYPES', ...includes.flatMap(folder => ['-I', folder]),
    ...(tools ? ['-static'] : []), '-o', to, from, ...PROCESSOR.map(name => join(core, 'src', 'device', 'r4300', name)), ...ALSO.map(name => join(source, name)), '-lm'], { encoding: 'utf8', maxBuffer: 2 ** 26, env: tools?.env });
  if (result.error?.code === 'ENOENT') throw new Error(`There's no C compiler here (${compiler}): tools/README.md says how to get one.`);
  if (result.status !== 0) throw new Error(`The program that calls the Nintendo 64's functions didn't build:\n${(result.stderr || '').trim().split('\n').slice(0, 40).join('\n')}`);
  if (tools) copyFileSync(to, program);
}

const word = value => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};
const dword = value => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)));
  return bytes;
};

/**
 * The original, kept running: `image(bytes)` sets the memory every call starts from, `call(...)` runs a function,
 * and `close()` ends it. Each answers in turn. The program runs with at most 6 GB of memory, as one with no limits
 * once took a computer down: on Linux, where a shell can set that. A Mac's refuses the limit, so the program starts
 * there without it, and Windows has none a shell sets.
 */
export class Original {
  constructor(program = buildCaller()) {
    this.child = process.platform === 'win32'
      ? spawn(program, [], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('/bin/sh', ['-c', process.platform === 'darwin' ? 'ulimit -v 6000000 2>/dev/null; exec "$0"' : 'ulimit -v 6000000 && exec "$0"', program], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    this.child.on('exit', (code, signal) => {
      this.over = `The program that calls the Nintendo 64's functions ended (${code ?? signal})${this.said ? `: ${this.said.trim()}` : ''}.`;
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

  async dwords(count) {
    const bytes = await this.take(count * 8);
    return Array.from({ length: count }, (_, i) => bytes.readBigUInt64LE(i * 8));
  }

  /** Sets the image every call starts from: IMAGE bytes, in the console's byte order. */
  async image(bytes) {
    if (bytes.length !== IMAGE) throw new Error(`An image is ${IMAGE} bytes, and this one is ${bytes.length}.`);
    this.child.stdin.write(Buffer.from('I'));
    this.child.stdin.write(bytes);
    const answer = await this.take(1);
    if (answer[0] !== 0x6B) throw new Error('The program that calls the Nintendo 64\'s functions didn\'t take the image.');
  }

  /**
   * Runs the function at `address`, `span` bytes long, from the image with `changes`, each [address, bytes, value],
   * written in the console's byte order, and with `registers`, an array of 34 numbers or BigInts in the order of
   * REGISTERS, each 64 bits, ra the address it comes back to, and `floats`, the floating-point unit's 32 registers as
   * BigInts of 64 bits, as the processor keeps them, under `status`, coprocessor 0's Status, and `fcr31`. `limit` is how
   * many instructions it may run. Answers { end, detail, pc, steps, fpu, hardware, fcr31, registers, floats, ran,
   * reads, chunks }: `registers` and `floats` as BigInts of 64 bits; `ran` a byte for each instruction of the
   * function, 1 ran, 2 went to its target, 4 went on; `reads` each word read, { address, bytes, value }, by its
   * physical address; `chunks` each 256 bytes of the image the function wrote, { at, bytes }, in the console's order.
   */
  async call({ address, span, limit = 1000000, registers, floats = [], status = POWER_ON_STATUS, fcr31 = 0, changes = [] }) {
    const parts = [Buffer.from('C'), word(address), word(span), word(limit), word(status), word(fcr31),
      ...Array.from({ length: 34 }, (_, i) => dword(registers[i] ?? 0)), ...Array.from({ length: 32 }, (_, i) => dword(floats[i] ?? 0)),
      word(changes.length), ...changes.flat().map(word)];
    this.child.stdin.write(Buffer.concat(parts));
    const [end, detail, pc, steps, fpu, hardware, leftFcr31] = await this.words(7);
    const left = await this.dwords(34);
    const leftFloats = await this.dwords(32);
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
    return { end, detail, pc, steps, fpu, hardware, fcr31: leftFcr31, registers: left, floats: leftFloats, ran, reads, chunks };
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
    if (at < 0 || at + bytes > IMAGE || inImage(physicalOf(address) + bytes - 1) !== at + bytes - 1) continue;
    for (let i = 0; i < bytes; i++) made[at + i] = (value >>> (8 * (bytes - 1 - i))) & 0xFF;
  }
  for (const chunk of chunks) made.set(chunk.bytes, chunk.at);
  return made;
}
