// What `npm run dp -- read` prints for a Super Nintendo game (../read.mjs): one of the original's functions as 65816
// instructions, read from the contributor's own copy by the tools' own table (65816.mjs), each at the length the
// processor's mode gives it. The mode a function starts in is the code map's (functions.mjs), or --mode's, and the
// code is followed from there as the finder follows it, through REP and SEP, so each instruction is read as the
// processor reads it; a line that starts with `;` says where the mode changes. Each line is the address as the code
// runs at it, the instruction's bytes and the instruction, written as the 65816's own assembler writes it. After a
// semicolon comes the code map's name of what a call, a jump or a branch goes to. Bytes the code doesn't reach, such
// as a table, are written as bytes.
//
// With --spc it reads the program the game gave the sound processor instead, the SPC700's instructions (spc700.mjs),
// from the sound processor's memory as it is --frame frames after power-on, with nothing pressed, which Snes9x tells
// the tools with their change to it (libretro/snes9x.patch, libretro/held.h): a game sends its sound program there as
// it starts, so it's read where it runs.

import { hex } from '../lib/proof-files.mjs';
import { memorySpec } from '../lib/memory.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { decode } from './spc700.mjs';
import { INSTRUCTIONS, MODES } from './65816.mjs';
import { addressOf, follow, snesName, snesProgram } from './functions.mjs';
import { placeIn, ROM } from './cartridge.mjs';

// how much is read when the code map doesn't have the function, unless --bytes says
const SOME_BYTES = 256;

const two = n => hex(n, 2).slice(-2);
const four = n => hex(n, 4).slice(-4);
const six = n => hex(n, 6).slice(-6);

/** An instruction's text, as the 65816's assembler writes it: `op` its first byte, `operand` the number after it,
 *  `address` where it is, bank and all, and `length` how many bytes it takes in the processor's mode (lengthOf). */
export function instructionText(op, operand, address, length) {
  const { name, mode: way } = INSTRUCTIONS[op];
  const value = length === 2 ? `$${two(operand)}` : length === 3 ? `$${four(operand)}` : `$${six(operand)}`;
  const after = (address + length) & 0xFFFF;
  switch (way) {
    case 'imp': return name;
    case 'acc': return `${name} A`;
    case 'imm': case 'immx': case 'imm8': return `${name} #${value}`;
    case 'imm16': return `${name} ${value}`;
    case 'dp': case 'abs': case 'long': return `${name} ${value}`;
    case 'dpx': case 'absx': case 'longx': return `${name} ${value},X`;
    case 'dpy': case 'absy': return `${name} ${value},Y`;
    case 'dpi': case 'absi': return `${name} (${value})`;
    case 'dpxi': case 'absxi': return `${name} (${value},X)`;
    case 'dpiy': return `${name} (${value}),Y`;
    case 'dpl': case 'absl': return `${name} [${value}]`;
    case 'dply': return `${name} [${value}],Y`;
    case 'sr': return `${name} ${value},S`;
    case 'sriy': return `${name} (${value},S),Y`;
    case 'rel': return `${name} $${four(after + (operand << 24 >> 24))}`;
    case 'rell': return `${name} $${four(after + (operand << 16 >> 16))}`;
    // the bytes are the bank it moves to and then the bank it moves from; the assembler writes them the other way
    case 'move': return `${name} $${two(operand >> 8)},$${two(operand)}`;
    default: return name;
  }
}

const MODE_WORDS = { a8i8: 'A, X and Y of 8 bits', a8i16: 'A of 8 bits, X and Y of 16', a16i8: 'A of 16 bits, X and Y of 8', a16i16: 'A, X and Y of 16 bits', e: 'the 6502\'s mode, A, X and Y of 8 bits' };
/** A mode, in words. */
export const modeWords = mode => (mode ? MODE_WORDS[mode] : 'A, X and Y of sizes not known');

/** The ROM offset a function is given by: a ROM offset as the code map keys it, such as 00012345, an address as the
 *  code runs at it, such as $80:8123 or 0x808123, a name in the code map, or a label with an address in it, such as
 *  sub_808123. */
export function snesResolve(codeMap, map, what) {
  const key = what.match(/^([0-9a-f]{8})$/i);
  if (key) return parseInt(key[1], 16);
  const address = what.match(/^(?:\$|0x)?([0-9a-f]{2}):?([0-9a-f]{4})$/i) ?? what.match(/^[A-Za-z][A-Za-z0-9]*_([0-9a-f]{2})([0-9a-f]{4})$/i);
  if (address) {
    const { what: kind, at } = placeIn(map, parseInt(address[1] + address[2], 16));
    if (kind !== ROM) throw new Error(`${what} isn't in the cartridge's ROM.`);
    return at;
  }
  const named = codeMap.functions.find(f => f.name === what) ?? codeMap.functions.find(f => f.name?.toLowerCase() === what.toLowerCase());
  if (named) return named.address;
  throw new Error(`"${what}" isn't a place in the ROM, such as 00012345, an address, such as $80:8123, a name in the code map, or a label, such as sub_808123.`);
}

/**
 * The lines of a function: `start` its ROM offset, `length` how many bytes, `mode` the mode it starts in, or null.
 * Each { address, bytes, text, note, mode }, `mode` set on a line where the mode changes, or the first.
 */
export function listing(copy, start, length, mode, nameOf = () => null) {
  const program = snesProgram(copy);
  const { cart, rom } = program;
  const first = addressOf(start, cart);
  const { code } = follow(program, [{ address: first, mode, call: true }]);
  const lines = [];
  let before;
  for (let at = start; at < start + length && at < rom.length;) {
    const address = (first & 0xFF0000) | ((first + at - start) & 0xFFFF);
    const instruction = code.get(at);
    if (!instruction || at + instruction.length > start + length) {
      // bytes the code doesn't reach, up to the next instruction
      let to = at + 1;
      while (to < start + length && to < rom.length && !code.get(to) && to - at < 8) to++;
      const bytes = [...rom.subarray(at, to)];
      lines.push({ address, bytes, text: `.byte ${bytes.map(b => `$${two(b)}`).join(', ')}`, note: 'not reached by the code' });
      at = to;
      continue;
    }
    const { op, length: size } = instruction;
    const operand = size > 1 ? rom[at + 1] | (size > 2 ? rom[at + 2] << 8 : 0) | (size > 3 ? rom[at + 3] << 16 : 0) : 0;
    const text = instructionText(op, operand, address, size);
    const way = INSTRUCTIONS[op].mode;
    const target = way === 'rel' ? (address & 0xFF0000) | ((address + size + (operand << 24 >> 24)) & 0xFFFF)
      : way === 'rell' ? (address & 0xFF0000) | ((address + size + (operand << 16 >> 16)) & 0xFFFF)
        : way === 'long' && ['JSL', 'JML'].includes(INSTRUCTIONS[op].name) ? operand
          : way === 'abs' && ['JSR', 'JMP'].includes(INSTRUCTIONS[op].name) ? (address & 0xFF0000) | operand : null;
    const there = target === null ? null : placeIn(program.map, target);
    const note = there?.what === ROM ? nameOf(there.at) : null;
    lines.push({ address, bytes: [...rom.subarray(at, at + size)], text, note, ...(instruction.mode !== before ? { mode: instruction.mode } : {}) });
    before = instruction.mode;
    at += size;
  }
  return lines;
}

// how many frames after power-on the sound processor's memory is read, unless --frame says
const FRAMES = 60;

/** The sound processor's 64 KB, `frames` frames after power-on with nothing pressed, from the copy at `path`. */
export async function soundMemory(path, frames, log = () => {}) {
  const reference = libretroReference(consoleOf('snes'));
  reference.ensureOriginal(log);
  const spec = memorySpec([{ memory: 1, address: 0, bytes: 0x10000 }], frames - 1);
  const { memory } = await reference.runOriginal({ copy: path, frames, buttons: new Array(frames).fill(0), memory: { spec } });
  if (!memory?.bytes || memory.bytes.length < 0x10000) throw new Error('Snes9x didn\'t say what its sound processor holds: npm run dp -- setup builds it again, with the tools\' change to it.');
  return memory.bytes.subarray(0, 0x10000);
}

/** The lines of `length` bytes of SPC700 code in `memory` from `start`: { address, bytes, text, target }. */
export function spcListing(memory, start, length) {
  const lines = [];
  for (let at = start; at < start + length && at <= 0xFFFF;) {
    const { length: size, text, target } = decode(memory, at);
    lines.push({ address: at, bytes: [...memory.subarray(at, Math.min(at + size, 0x10000))], text, target });
    at += size;
  }
  return lines;
}

/** What read --spc prints: the sound processor's program from an address in its memory, such as 0400 or $0400. */
async function readSpc({ copy, what, flags }) {
  const number = /^(?:\$|0x)?([0-9a-f]{1,4})$/i.exec(what);
  if (!number) throw new Error(`With --spc, "${what}" is an address in the sound processor's memory, such as 0400.`);
  const start = parseInt(number[1], 16), frames = flags.frame ?? FRAMES, length = flags.bytes ?? SOME_BYTES;
  if (frames < 1) throw new Error('--frame is 1 or more with --spc: the sound processor holds nothing of the game before its first frame.');
  const memory = await soundMemory(copy.path, frames, console.log);
  const out = spcListing(memory, start, length).map(line => `$${four(line.address)}  ${line.bytes.map(two).join(' ').padEnd(10)}${line.text}`);
  const head = `The sound processor's program, ${length} bytes from $${four(start)} of its memory, as it is ${frames} frame${frames === 1 ? '' : 's'} after power-on with nothing pressed.`;
  return { key: `spc-${four(start)}-${frames}`, text: [head, '', ...out, ''].join('\n'), has: () => false };
}

/** What read prints for a Super Nintendo game: { key, text, has }. */
export async function readSnes({ codeMap, bytes, what, flags, copy }) {
  if (flags.spc) return readSpc({ copy, what, flags });
  if (flags.frame !== undefined) throw new Error('--frame goes with --spc on the Super Nintendo: the cartridge\'s code is read as the copy holds it.');
  const program = snesProgram(bytes);
  if (!program) throw new Error('The tools don\'t lay out this cartridge, so they can\'t read it yet: only a plain LoROM, HiROM or ExHiROM.');
  const asked = snesResolve(codeMap, program.map, what);
  const owner = codeMap.functions.find(f => asked >= f.address && asked < f.address + f.size);
  const start = flags.bytes ? asked : owner?.address ?? asked;
  const length = flags.bytes ? Number(flags.bytes) : owner ? owner.size : SOME_BYTES;
  const mode = flags.mode ?? (owner?.address === start ? owner.mode : null) ?? null;
  if (mode && !MODES.includes(mode)) throw new Error(`--mode is one of ${MODES.join(', ')}.`);
  const names = new Map(codeMap.functions.map(f => [f.address, f.name ?? snesName(f.address, program.cart)]));
  const lines = listing(bytes, start, length, mode, at => names.get(at) ?? null);
  const out = [];
  for (const line of lines) {
    if ('mode' in line) out.push(`; ${modeWords(line.mode)}`);
    const text = `$${two(line.address >> 16)}:${four(line.address)}  ${line.bytes.map(two).join(' ').padEnd(12)}${line.text}`;
    out.push(line.note ? `${text.padEnd(44)}; ${line.note}` : text);
  }
  const head = [
    `${snesName(start, program.cart)}, ${length} bytes at ${hex(start)} in the ROM${owner && owner.address === start ? '' : ', not a function of the code map'}${owner?.name ? `, ${owner.name}` : ''}.`,
    mode ? `It starts with ${modeWords(mode)}${flags.mode ? ', as --mode says' : ', as the code map says'}.` : 'The code map doesn\'t know the mode it starts in, so the instructions whose length depends on it are read only after a REP or SEP says; --mode gives one.',
  ];
  return { key: hex(start), text: [...head, '', ...out, ''].join('\n'), has: () => false };
}
