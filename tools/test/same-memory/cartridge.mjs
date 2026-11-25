// A made-up Game Boy Advance cartridge from files of C, for the tools' own tests (../same-memory.mjs,
// ../part-tasks/gba.mjs): each file built with the console's own compiler, what it wrote read by the tools' assembler,
// and the few lines of a linker that put each function where the comment above it says the cartridge has it. Nothing
// of any game is in it.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilerPath } from '../../gba/agbcc.mjs';
import { assemble } from '../../gba/thumb.mjs';
import { preprocess, twinsIn } from '../../gba/match.mjs';

/** The flags Game Boy Advance games of the time were built with. */
export const COMPILER = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
/** The cartridge: where it starts, where its first instructions are, after its header, where the compiler's helpers
 *  that call a function through a register go, and where its data does, unless a test says elsewhere. */
export const CARTRIDGE = 0x08000000, START = 0xC0, HELPERS = 0x080006C0, DATA = 0x08000700;

// One file of the program as the console's compiler builds it: what the tools' assembler makes of what it wrote.
export async function compile(name, { here, work }) {
  const file = join(here, name), built = join(work, name.replace(/\.c$/, ''));
  writeFileSync(`${built}.i`, await preprocess(file, here, [here]));
  const cc = spawnSync(compilerPath(COMPILER.name), [...COMPILER.flags, '-fhex-asm', '-o', `${built}.s`, `${built}.i`], { encoding: 'utf8' });
  if (cc.status !== 0) throw new Error(`${name} didn't build with ${COMPILER.name}: ${cc.error?.message ?? cc.stderr}`);
  const twins = new Map(twinsIn(readFileSync(file, 'utf8')).map(twin => [twin.name, twin.address]));
  return { name, twins, ...assemble(readFileSync(`${built}.s`, 'utf8')) };
}

// The cartridge, from the files the compiler built: each function where its comment says the cartridge has it, the
// data after them, and every call and address a linker fills in. It answers { rom, names }: the cartridge's bytes, and
// where each piece of data is.
export function link(units, { title, code, helpers = HELPERS, data: dataAt = DATA }) {
  const image = Buffer.alloc(0x1000), taken = [];
  const place = (what, address, bytes) => {
    const from = address - CARTRIDGE, to = from + bytes.length;
    const other = taken.find(each => from < each.to && each.from < to);
    if (other) throw new Error(`${what} at 0x${address.toString(16)} reaches into ${other.what}.`);
    taken.push({ what, from, to });
    bytes.copy(image, from);
  };
  // where everything is: each function, each file's data, and the compiler's helpers
  const functions = new Map(), data = new Map();
  let end = dataAt;
  for (const unit of units) {
    const text = unit.sections['.text'].bytes;
    unit.functions = [...unit.symbols].filter(([, symbol]) => symbol.section === '.text' && symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
    unit.functions.forEach((f, i) => {
      f.until = unit.functions[i + 1]?.at ?? text.length;
      f.address = unit.twins.get(f.name) ?? null;
      if (f.address === null) throw new Error(`${f.name} in ${unit.name} has no address in the comment above it.`);
      if (functions.has(f.name)) throw new Error(`${f.name} is there twice.`);
      functions.set(f.name, f.address);
    });
    unit.data = end;
    const own = unit.sections['.rodata']?.bytes ?? Buffer.alloc(0);
    for (const [name, symbol] of unit.symbols) if (symbol.section === '.rodata') data.set(name, unit.data + symbol.at);
    end = Math.ceil((end + own.length) / 4) * 4;
  }
  // the compiler's helpers, unless a program that calls nothing through a register says it has none
  for (let r = 0; helpers !== null && r < 8; r++) {
    functions.set(`_call_via_r${r}`, helpers + r * 4);
    const helper = Buffer.alloc(4);
    helper.writeUInt16LE(0x4700 | r << 3, 0);   // bx r
    helper.writeUInt16LE(0x46C0, 2);            // nop
    place(`_call_via_r${r}`, helpers + r * 4, helper);
  }
  for (const unit of units) {
    const text = Buffer.from(unit.sections['.text'].bytes), own = Buffer.from(unit.sections['.rodata']?.bytes ?? []);
    const around = at => unit.functions.find(f => at >= f.at && at < f.until);
    const moved = at => { const f = around(at); return f.address + at - f.at; };
    for (const { section, at, kind, name, addend } of unit.relocations) {
      const symbol = unit.symbols.get(name), where = section === '.text' ? moved(at) : unit.data + at;
      let target;
      // a Thumb function's address is kept odd
      if (symbol?.section === '.text') target = moved(symbol.at) + addend + (symbol.function ? 1 : 0);
      else if (symbol?.section === '.rodata') target = unit.data + symbol.at + addend;
      else if (functions.has(name)) target = functions.get(name) + addend + 1;
      else if (data.has(name)) target = data.get(name) + addend;
      else throw new Error(`Nothing defines ${name}, which ${unit.name} uses.`);
      const into = section === '.text' ? text : own;
      if (kind === 'word') into.writeUInt32LE(target >>> 0, at);
      else {
        const jump = (target & ~1) - (where + 4);
        into.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
        into.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
      }
    }
    for (const f of unit.functions) place(f.name, f.address, text.subarray(f.at, f.until));
    if (own.length) place(`${unit.name}'s data`, unit.data, own);
  }
  // the cartridge's first instructions, in ARM code: system mode, a stack at the top of the fast work memory, and on to
  // the program, which is Thumb code
  const start = Buffer.alloc(28);
  [0xE3A0001F, 0xE129F000, 0xE59FD004, 0xE59F0004, 0xE12FFF10, 0x03007F00, functions.get('AgbMain') | 1].forEach((word, i) => start.writeUInt32LE(word >>> 0, i * 4));
  place('the start', CARTRIDGE + START, start);
  // the header, as made-up-game.mjs writes it: a jump over it, the title, the code and its check
  const rom = image.subarray(0, Math.max(...taken.map(each => each.to)));
  rom.writeUInt32LE((0xEA000000 | ((START - 8) >> 2)) >>> 0, 0);
  rom.write(title, 0xA0, 'latin1');
  rom.write(code, 0xAC, 'latin1');
  rom.write('00', 0xB0, 'latin1');
  rom[0xB2] = 0x96;
  let sum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) sum = (sum - rom[i]) & 0xFF;
  rom[0xBD] = (sum - 0x19) & 0xFF;
  return { rom, names: data };
}
