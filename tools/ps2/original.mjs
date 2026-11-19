// A PlayStation 2 game's original, a function at a time: the program that runs one function of a game's program in
// Play!'s own processor code (call.cpp), built on the contributor's computer once, from the emulator's source the tools
// fetch at the commit tools/consoles.mjs fixes, and kept running while a check asks it for calls. Play!, its code
// generator and its framework are BSD-2-Clause and never in the repository: only call.cpp, the tools' own stand-in for
// the rest of the emulator, is.
//
// It runs one of three processors: the EE, the IOP, or vector unit 1 (call.cpp says what each sees). A call starts from
// the image, the processor's memories as the check gives them, with a few values changed, and from the registers it's
// given. It ends when the function comes back to where ra pointed, or at a microprogram's E bit, and answers what the
// function left in the registers and in the image, what it read, which of its instructions ran and which way each
// branch went, the packets a microprogram sent the GS, or why it didn't come back.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL } from '../lib/paths.mjs';
import { buildJobs } from '../lib/jobs.mjs';
import { consoleOf } from '../consoles.mjs';
import { fetchSource } from '../libretro/build.mjs';

const CALL = fileURLToPath(new URL('./call.cpp', import.meta.url));
const CHUNK = 256;

/** Each processor's memories as call.cpp lays them out in its image: their place there, their address as the processor
 *  sees it, their size and their name. The EE's are where a twin's module keeps them too, once folded
 *  (../lib/wasm-fold.mjs), so the image is laid over the module's memory as it is. */
export const KINDS = {
  ee: {
    image: 0x02232000, step: 4,
    regions: [
      { at: 0x00000000, address: 0x00000000, bytes: 0x02000000, name: 'the console\'s memory' },
      { at: 0x02000000, address: 0x1C000000, bytes: 0x00200000, name: 'the IOP\'s memory' },
      { at: 0x02200000, address: 0x70000000, bytes: 0x00004000, name: 'the scratchpad' },
      { at: 0x02210000, address: 0x10000000, bytes: 0x00010000, name: 'the hardware\'s registers' },
      { at: 0x02220000, address: 0x11000000, bytes: 0x00001000, name: 'vector unit 0\'s micro memory' },
      { at: 0x02224000, address: 0x11004000, bytes: 0x00001000, name: 'vector unit 0\'s data memory' },
      { at: 0x02228000, address: 0x11008000, bytes: 0x00004000, name: 'vector unit 1\'s micro memory' },
      { at: 0x0222C000, address: 0x1100C000, bytes: 0x00004000, name: 'vector unit 1\'s data memory' },
      { at: 0x02230000, address: 0x12000000, bytes: 0x00002000, name: 'the GS\'s registers' },
    ],
  },
  iop: {
    image: 0x00210800, step: 4,
    regions: [
      { at: 0x00000000, address: 0x00000000, bytes: 0x00200000, name: 'the IOP\'s memory' },
      { at: 0x00200000, address: 0x1F800000, bytes: 0x00000400, name: 'its scratchpad' },
      { at: 0x00201000, address: 0x1F801000, bytes: 0x0000F000, name: 'the hardware\'s registers' },
      { at: 0x00210000, address: 0x1F900000, bytes: 0x00000800, name: 'the SPU2\'s registers' },
    ],
  },
  vu1: {
    image: 0x00008000, step: 8,
    regions: [
      { at: 0x0000, address: 0x0000, bytes: 0x4000, name: 'vector unit 1\'s data memory' },
      { at: 0x4000, address: 0x0000, bytes: 0x4000, name: 'vector unit 1\'s micro memory' },
    ],
  },
};

/** Where each register is in the words a call is given and leaves (call.cpp's structs), and how many words there are. */
export const EE_REGISTERS = { gpr: 0, hi: 128, lo: 130, hi1: 132, lo1: 134, sa: 136, fpr: 137, fpuAccumulator: 169, fcsr: 170, vf: 171, acc: 299, vi: 303, q: 319, i: 320, p: 321, r: 322, status: 323, mac: 324, clip: 325, divide: 326, words: 327 };
export const IOP_REGISTERS = { gpr: 0, hi: 32, lo: 33, words: 34 };
export const VU_REGISTERS = { vf: 0, acc: 128, vi: 132, q: 148, i: 149, p: 150, r: 151, status: 152, mac: 153, clip: 154, divide: 155, top: 156, itop: 157, words: 158 };
const WORDS = { ee: EE_REGISTERS.words, iop: IOP_REGISTERS.words, vu1: VU_REGISTERS.words };

/** The registers by the names MIPS code gives them, in the processor's order. */
export const REGISTERS = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'];

/** How a call ended, in words. */
export const CAME_BACK = 0, OUT_OF_STEPS = 1, EXCEPTION = 2, ELSEWHERE = 3, KERNEL = 4, MISALIGNED = 5, VU = 6, SYSCALL = 7;
const EXCEPTIONS = { 4: 'a return from an exception', 5: 'a breakpoint', 6: 'the TLB' };

export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  const at = `0x${hex(pc)}`;
  if (end === OUT_OF_STEPS) return `ran out of instructions, at ${at}`;
  if (end === EXCEPTION) return `met ${EXCEPTIONS[detail] ?? `exception ${detail}`} at ${at}`;
  if (end === ELSEWHERE) return `went where the check can't follow, to 0x${hex(detail)}`;
  if (end === KERNEL) return `went into the console's kernel, at 0x${hex(detail)}`;
  if (end === SYSCALL) return `called the console's kernel (syscall ${detail | 0})`;
  if (end === MISALIGNED) return `read or wrote 0x${hex(detail)}, where none of its size starts, which the console stops at`;
  if (end === VU) return `started a microprogram of vector unit 0, at 0x${hex(detail)}`;
  return `ended in a way the tools don't know (${end})`;
}

/** Where an address is in a processor's image, or -1, as call.cpp takes it: the EE's mirrors of its memory and the
 *  IOP's, the scratchpads, the hardware and the vector units' memories. */
export function inImage(address, kind = 'ee') {
  let a = address >>> 0;
  if (kind === 'ee') {
    if (a >= 0x70000000 && a < 0x70004000) return 0x02200000 + a - 0x70000000;
    if (a >= 0x80000000 && a < 0xC0000000) a &= 0x1FFFFFFF;
    else if (a >= 0x20100000 && a < 0x22000000) a -= 0x20000000;
    else if (a >= 0x30100000 && a < 0x32000000) a -= 0x30000000;
    else if (a >= 0x20000000) return -1;
  } else if (kind === 'iop') {
    if (a >= 0x80000000 && a < 0xC0000000) a &= 0x1FFFFFFF;
    if (a < 0x00800000) a &= 0x001FFFFF;
    else if (a >= 0x20000000) return -1;
  }
  const region = KINDS[kind].regions.find(r => a >= r.address && a - r.address < r.bytes && !(kind === 'ee' && r.address === 0x70000000));
  return region ? region.at + a - region.address : -1;
}

/** The address of a place in a processor's image, as its code sees it, and which memory it's in. */
export function addressAt(at, kind = 'ee') {
  const region = KINDS[kind].regions.find(r => at >= r.at && at < r.at + r.bytes);
  return region ? { address: region.address + at - region.at, name: region.name } : { address: at, name: 'nowhere the console has' };
}

// What call.cpp is built from, in the emulator's source: Play!'s processors, and what of its code generator and its
// framework they need, for this computer's processor.
function sourcesOf(source) {
  const play = (...names) => names.map(name => join(source, 'Source', name));
  const host = arch() === 'arm64' ? /AArch64/ : /x86(?!_32)|X86/;
  const codeGen = readdirSync(join(source, 'deps', 'CodeGen', 'src'))
    .filter(name => name.endsWith('.cpp') && (!/AArch|x86|X86|Wasm|Coff|Macho/.test(name) || host.test(name)))
    .map(name => join(source, 'deps', 'CodeGen', 'src', name));
  const framework = ['MemStream.cpp', 'Stream.cpp', 'StdStream.cpp', ...readdirSync(join(source, 'deps', 'Framework', 'src', 'xml')).filter(name => name.endsWith('.cpp')).map(name => join('xml', name))]
    .map(name => join(source, 'deps', 'Framework', 'src', name));
  return [
    ...play('MIPS.cpp', 'MIPSArchitecture.cpp', 'MA_MIPSIV.cpp', 'MA_MIPSIV_Templates.cpp', 'MA_MIPSIV_Reflection.cpp', 'MIPSInstructionFactory.cpp',
      'MIPSReflection.cpp', 'MIPSCoprocessor.cpp', 'COP_SCU.cpp', 'COP_SCU_Reflection.cpp', 'COP_FPU.cpp', 'COP_FPU_Reflection.cpp', 'MemoryMap.cpp',
      'MipsJitter.cpp', 'BasicBlock.cpp', 'FpUtils.cpp', 'MIPSAnalysis.cpp', 'MIPSTags.cpp', 'app_shared/Log.cpp'),
    ...play(...['MA_EE.cpp', 'MA_EE_Reflection.cpp', 'COP_VU.cpp', 'COP_VU_Reflection.cpp', 'VUShared.cpp', 'VUShared_Reflection.cpp', 'FpAddTruncate.cpp',
      'FpMulTruncate.cpp', 'EeBasicBlock.cpp', 'MA_VU.cpp', 'MA_VU_Lower.cpp', 'MA_VU_Upper.cpp', 'MA_VU_LowerReflection.cpp', 'MA_VU_UpperReflection.cpp',
      'VuBasicBlock.cpp', 'VuExecutor.cpp', 'VuAnalysis.cpp'].map(name => `ee/${name}`)),
    ...codeGen, ...framework,
  ];
}

// the program, built once for this commit of the emulator and this call.cpp, in a folder of the tools' own
const FOLDER = join(LOCAL, 'twin', 'ps2-caller');

// runs a compiler, answering what it said when it failed
function compileOne(compiler, args) {
  return new Promise(resolve => {
    const child = spawn(compiler, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let said = '';
    child.stderr.on('data', chunk => { said += chunk; });
    child.on('error', error => resolve(error.code === 'ENOENT' ? `There's no C++ compiler here (${compiler}): tools/README.md says how to get one.` : String(error.message)));
    child.on('exit', code => resolve(code === 0 ? null : said.trim().split('\n').slice(0, 40).join('\n') || `ended with ${code}`));
  });
}

/** Builds the program that calls the original's functions, if this computer hasn't yet: its file. */
export async function buildCaller(log = console.log) {
  const { core } = consoleOf('ps2');
  const folder = join(FOLDER, core.commit.slice(0, 12));
  const program = join(folder, `call${process.platform === 'win32' ? '.exe' : ''}`), stamp = `${program}.source`, text = readFileSync(CALL, 'utf8');
  if (existsSync(program) && existsSync(stamp) && readFileSync(stamp, 'utf8') === text) return program;
  const machine = consoleOf('ps2');
  const objects = join(folder, 'objects');
  const source = join(LOCAL, 'libretro', `${core.built}-source`);
  // the emulator's files are built once for its commit; only call.cpp again when it changes
  const files = existsSync(join(source, 'Source', 'MIPS.cpp')) ? sourcesOf(source) : (log(`Getting the PlayStation 2's processors from its emulator's source, at ${core.source}…`), sourcesOf(fetchSource(machine)));
  mkdirSync(objects, { recursive: true });
  const compiler = process.env.CXX || 'c++';
  const flags = ['-std=c++20', '-O2', '-w', '-DNDEBUG', '-DXXH_INLINE_ALL', ...['Source', 'Source/app_shared', 'deps/Framework/include', 'deps/CodeGen/include', 'deps/Dependencies/xxHash'].flatMap(folder => ['-I', join(source, folder)])];
  const objectOf = file => join(objects, `${basename(file, '.cpp')}.o`);
  const waiting = [...files.filter(file => !existsSync(objectOf(file))).map(file => [file, objectOf(file)]), [CALL, join(folder, 'call.o')]];
  if (waiting.length > 1) log('Building the PlayStation 2\'s processors from Play!\'s source, once…');
  const failed = [];
  await Promise.all(Array.from({ length: buildJobs() }, async () => {
    while (waiting.length && !failed.length) {
      const [file, object] = waiting.shift();
      const said = await compileOne(compiler, [...flags, '-c', file, '-o', `${object}.part`]);
      if (said) failed.push(`${basename(file)}: ${said}`);
      else writeFileSync(object, readFileSync(`${object}.part`)), rmSync(`${object}.part`);
    }
  }));
  if (failed.length) throw new Error(`The program that calls the PlayStation 2's functions didn't build:\n${failed[0]}`);
  rmSync(program, { force: true });
  const linked = await compileOne(compiler, ['-o', program, join(folder, 'call.o'), ...files.map(objectOf), ...(process.platform === 'linux' ? ['-lpthread'] : [])]);
  if (linked) throw new Error(`The program that calls the PlayStation 2's functions didn't link:\n${linked}`);
  writeFileSync(stamp, text);
  return program;
}

const words = values => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeUInt32LE(value >>> 0, i * 4));
  return bytes;
};

/**
 * The original, kept running for one processor, `kind`: 'ee', 'iop' or 'vu1'. `image(bytes)` sets the memory every
 * call starts from, `call(...)` runs a function, and `close()` ends it. Each answers in turn.
 */
export class Original {
  constructor(program, kind = 'ee') {
    if (!KINDS[kind]) throw new Error(`The original runs the ee, the iop or vu1, not ${kind}.`);
    this.kind = kind;
    this.child = spawn(program, [kind], { stdio: ['pipe', 'pipe', 'pipe'] });
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
      this.over = `The program that calls the PlayStation 2's functions ended (${signal ?? code})${this.said ? `: ${this.said.trim()}` : ''}.`;
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
    const all = this.held.length === 1 ? this.held[0] : Buffer.concat(this.held);
    this.held = [all.subarray(count)];
    this.bytes -= count;
    return all.subarray(0, count);
  }

  async words(count) {
    const bytes = await this.take(count * 4);
    return Array.from({ length: count }, (_, i) => bytes.readUInt32LE(i * 4));
  }

  /** Sets the image every call starts from: as many bytes as the processor's image has. */
  async image(bytes) {
    const size = KINDS[this.kind].image;
    if (bytes.length !== size) throw new Error(`An image is ${size} bytes, and this one is ${bytes.length}.`);
    this.child.stdin.write(Buffer.from('I'));
    this.child.stdin.write(bytes);
    const answer = await this.take(1);
    if (answer[0] !== 0x6B) throw new Error('The program that calls the PlayStation 2\'s functions didn\'t take the image.');
  }

  /**
   * Runs the function at `address`, `span` bytes long, from the image with `changes`, each [address, bytes, value],
   * and with `registers`, the words of its processor's registers (EE_REGISTERS, IOP_REGISTERS, VU_REGISTERS), ra the
   * address it comes back to. `limit` is how many instructions it may run. Answers { end, detail, pc, steps, hardware,
   * vu0, registers, ran, reads, chunks, kicks }: `ran` a byte for each instruction of the function, 1 ran, 2 went to its
   * target, 4 went on; `reads` each place read, { address, bytes, value }; `chunks` each 256 bytes of the image the
   * function wrote, { at, bytes }; `kicks` each packet a microprogram sent the GS, { at, bytes }.
   */
  async call({ address, span, limit = 1000000, registers, changes = [] }) {
    const count = WORDS[this.kind];
    if (registers.length !== count) throw new Error(`A call on the ${this.kind} is given ${count} words of registers, and this one ${registers.length}.`);
    this.child.stdin.write(Buffer.concat([Buffer.from('C'), words([address, span, limit, ...registers, changes.length, ...changes.flat()])]));
    const [end, detail, pc, steps, hardware, flags] = await this.words(6);
    const left = await this.words(count);
    const ran = Uint8Array.from(await this.take(Math.floor(span / KINDS[this.kind].step)));
    const [readCount] = await this.words(1);
    const flat = await this.words(readCount * 3);
    const reads = Array.from({ length: readCount }, (_, i) => ({ address: flat[i * 3], bytes: flat[i * 3 + 1], value: flat[i * 3 + 2] }));
    const [chunkCount] = await this.words(1);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const [index] = await this.words(1);
      chunks.push({ at: index * CHUNK, bytes: Uint8Array.from(await this.take(CHUNK)) });
    }
    const [kickCount] = await this.words(1);
    const kicks = [];
    for (let i = 0; i < kickCount; i++) {
      const [at, size] = await this.words(2);
      kicks.push({ at, bytes: Uint8Array.from(await this.take(size)) });
    }
    return { end, detail, pc, steps, hardware, vu0: Boolean(flags & 1), registers: left, ran, reads, chunks, kicks };
  }

  close() {
    if (!this.child.killed && this.child.exitCode === null) this.child.stdin.end('Q');
  }
}

/** The image a call starts from with `changes` made in it, and then with what a call left, `chunks`: a new image. */
export function imageAfter(image, changes = [], chunks = [], kind = 'ee') {
  const made = Uint8Array.from(image);
  for (const [address, bytes, value] of changes) {
    const at = inImage(address, kind);
    if (at < 0 || at + bytes > made.length) continue;
    for (let i = 0; i < bytes; i++) made[at + i] = (value >>> (8 * i)) & 0xFF;
  }
  for (const chunk of chunks) made.set(chunk.bytes, chunk.at);
  return made;
}
