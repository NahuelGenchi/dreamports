// A GameCube game's original, a function at a time, for the function check (twin.mjs): Dolphin's own interpreter, the
// processor `prove` runs a game on, running one function of the program by itself through the entry the tools' change
// to it adds (tools/libretro/dolphin.patch, dreamports_gamecube_call), driven by the tools' program that runs every core, in its
// call mode (tools/libretro/host.c, calls.h). The program boots the player's copy, plays two frames so the console is
// running, and is kept running while a check asks it for calls.
//
// A call starts from the image, the console's memory and its hardware's registers as the check gives them, each number
// highest byte first, with a few values changed, and from the registers it's given. It ends when the function comes
// back to where the link register pointed, and answers what the function left in the registers and in the image, what
// it read, which of its instructions ran and which way each branch went, or why it didn't come back: it ran out of
// instructions, met an exception, or reached what the check can't follow, the graphics chip's FIFO, its embedded
// framebuffer, or an address past the console's 24 MB, where Dolphin sees the memory again. Every call starts from the
// processor as the program left it after its frames. No time passes for the rest of the console in a call, so the hardware's registers are memory of their
// own then, kept as written, and a function that waits for one to change waits for ever.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { HOST, buildReference, coreFile, coreSystem } from '../libretro/build.mjs';

/** The image a call starts from and leaves: the console's 24 MB of memory, then its hardware's registers, 64 KB from
 *  0xCC000000. */
export const RAM = 0x01800000, HARDWARE = 0x10000, IMAGE = RAM + HARDWARE;
/** Each part of the image, where it is in the image, where the processor sees it, how many bytes, and what it is. */
export const REGIONS = [
  { at: 0, address: 0x80000000, bytes: RAM, name: 'the console\'s memory' },
  { at: RAM, address: 0xCC000000, bytes: HARDWARE, name: 'the hardware\'s registers', hardware: true },
];
/** The words of a call's registers, as dolphin.patch lays them out: the 32 general registers, the 32 floating-point
 *  registers' first halves and then their second halves, two words each with the high one first, then these. */
export const STATE = 173, CR = 160, XER = 161, LR = 162, CTR = 163, FPSCR = 164, GQR = 165;
/** How a call ended, in words. */
export const ENDS = ['came back', 'ran out of instructions', 'met an exception', 'reached what the check can\'t follow'];
export const CAME_BACK = 0, OUT_OF_STEPS = 1, EXCEPTION = 2, ELSEWHERE = 3;
// the processor's exceptions, as Dolphin keeps their bits
const EXCEPTIONS = { 0x01: 'a decrementer interrupt', 0x02: 'a system call', 0x04: 'an instruction storage exception, running where nothing is', 0x08: 'a data storage exception, reading or writing where nothing is',
  0x10: 'an alignment exception', 0x20: 'a floating-point unit that isn\'t on', 0x40: 'a program exception', 0x80: 'an external interrupt', 0x100: 'a performance monitor\'s', 0x200: 'a fake memory check' };

export const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Where in the image an address of the processor's is, through the cache or round it, or -1 when the image hasn't it. */
export function inImage(address) {
  const at = address >>> 0;
  if (at >= 0xCC000000 && at < 0xCC000000 + HARDWARE) return RAM + at - 0xCC000000;
  if ((at >= 0x80000000 && at < 0x80000000 + RAM) || (at >= 0xC0000000 && at < 0xC0000000 + RAM)) return at & 0x01FFFFFF;
  return -1;
}

/** An address of the image, { address, name }: where the processor sees it and in which part. */
export function addressAt(at) {
  const region = REGIONS.findLast(r => at >= r.at);
  return { address: (region.address + at - region.at) >>> 0, name: region.name };
}

/** What a call that didn't come back met, in words. */
export function endText({ end, detail, pc }) {
  const at = `0x${hex(pc)}`;
  if (end === EXCEPTION) {
    const met = Object.entries(EXCEPTIONS).filter(([bit]) => detail & Number(bit)).map(([, text]) => text);
    return `met ${met.join(' and ') || `exception 0x${hex(detail)}`} at ${at}`;
  }
  if (end === ELSEWHERE) {
    const what = (detail & 0xFFFFF000) === 0x0C008000 ? 'the graphics chip\'s FIFO' : detail >= 0x08000000 && detail < 0x0C000000 ? 'the embedded framebuffer'
      : detail >>> 0 < 0x08000000 ? 'past the console\'s 24 MB, which Dolphin sees as its memory again' : 'what isn\'t memory or a register the check keeps';
    return `reached ${what}, at 0x${hex(detail)}, from ${at}`;
  }
  if (end === OUT_OF_STEPS) return `didn't come back, at ${at}`;
  return ENDS[end] ?? `ended as ${end}`;
}

/** The emulator with the tools' change, built if it isn't yet, and what runs it: the core's file and the host. */
export function buildCaller(log = console.log) {
  const machine = consoleOf('gamecube');
  buildReference(machine, log);
  return { machine, host: HOST, core: coreFile(machine.core), system: coreSystem(machine.core) };
}

/**
 * The original's side of the check: the host in its call mode, booting `copy`, the player's own disc or program.
 * `image(bytes)` gives it the image every call starts from, `call({...})` makes one call, and `close()` ends it.
 */
export class Original {
  constructor({ machine, host, core, system }, copy) {
    this.work = join(LOCAL, 'twin', 'gamecube', `run-${process.pid}-${Date.now()}`);
    mkdirSync(join(this.work, 'saves'), { recursive: true });
    const options = Object.entries(machine.core.options ?? {}).map(([key, value]) => `${key}=${value}`);
    this.child = spawn(host, [core, resolve(copy), 'call', ...options], {
      cwd: this.work, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DP_SYSTEM: system ?? join(LOCAL, 'libretro', 'system', 'gamecube'), DP_SAVE_FOLDER: join(this.work, 'saves'), XDG_CONFIG_HOME: join(this.work, 'saves'), XDG_DATA_HOME: join(this.work, 'saves'), DP_LEAVE: '1' },
    });
    this.buffer = Buffer.alloc(0);
    this.said = '';
    this.waiting = null;
    this.child.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.waiting?.();
    });
    this.child.stderr.on('data', chunk => { this.said += chunk; });
    this.child.on('exit', () => {
      this.ended = true;
      this.waiting?.();
    });
  }

  async take(bytes) {
    while (this.buffer.length < bytes) {
      if (this.ended) throw new Error(`Dolphin's call mode stopped: ${this.said.trim().split('\n').at(-1) || 'it said nothing'}`);
      await new Promise(done => { this.waiting = done; });
    }
    const taken = this.buffer.subarray(0, bytes);
    this.buffer = this.buffer.subarray(bytes);
    return taken;
  }

  async words(count) {
    const bytes = await this.take(count * 4);
    return Array.from({ length: count }, (_, i) => bytes.readUInt32LE(i * 4));
  }

  /** Gives it the image every call starts from, IMAGE bytes. */
  async image(image) {
    if (image.length !== IMAGE) throw new Error(`An image of the GameCube's is ${IMAGE} bytes, and this one is ${image.length}.`);
    this.child.stdin.write(Buffer.from('I'));
    this.child.stdin.write(image);
    const [ok, ram] = await this.words(2);
    if (ok !== 0x6B || ram !== RAM) throw new Error(`Dolphin's call mode answered the image with ${ok} and ${ram} bytes of memory.`);
  }

  /**
   * One call: the function at `address`, `span` bytes long, that may run `limit` instructions, from `state`, STATE
   * words, with `changes`, each [address, bytes, value]. Answers { end, detail, pc, steps, hardware, state, ran,
   * reads, chunks }: `ran` a byte for each instruction, `reads` each { address, bytes, value } the first time, and
   * `chunks` each { at, bytes }, 256 bytes of the image the call left that the image hasn't.
   */
  async call({ address, span, limit, state, changes = [] }) {
    const head = Buffer.alloc(13 + STATE * 4 + 4 + changes.length * 12);
    head.write('C', 0, 'latin1');
    head.writeUInt32LE(address >>> 0, 1);
    head.writeUInt32LE(span, 5);
    head.writeUInt32LE(limit, 9);
    state.forEach((word, i) => head.writeUInt32LE(word >>> 0, 13 + i * 4));
    let at = 13 + STATE * 4;
    head.writeUInt32LE(changes.length, at);
    for (const [where, bytes, value] of changes) {
      head.writeUInt32LE(where >>> 0, at + 4);
      head.writeUInt32LE(bytes, at + 8);
      head.writeUInt32LE(value >>> 0, at + 12);
      at += 12;
    }
    this.child.stdin.write(head);
    const [end, detail, pc, steps, hardware] = await this.words(5);
    const left = await this.words(STATE);
    const ran = Uint8Array.from(await this.take(span / 4));
    const [readCount] = await this.words(1);
    const read = await this.words(readCount * 4);
    const reads = Array.from({ length: readCount }, (_, i) => ({ address: read[i * 4], bytes: read[i * 4 + 1], value: read[i * 4 + 2], high: read[i * 4 + 3] }));
    const [chunkCount] = await this.words(1);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const [n] = await this.words(1);
      chunks.push({ at: n * 256, bytes: Uint8Array.from(await this.take(256)) });
    }
    return { end, detail, pc, steps, hardware: hardware === 1, state: left, ran, reads, chunks };
  }

  close() {
    if (this.ended) return;
    this.child.stdin.end('Q');
    this.child.once('exit', () => rmSync(this.work, { recursive: true, force: true }));
  }
}

/** The reference for a GameCube copy, to make sure its emulator is built. */
export const referenceOf = () => libretroReference(consoleOf('gamecube'));
