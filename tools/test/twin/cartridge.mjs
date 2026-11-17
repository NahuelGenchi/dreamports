// The made-up cartridge the function check's tests call (../twin.mjs, ../function-tasks.mjs): program.c built by
// the console's own compiler, each function at the address its comment names, with nothing from any game in it.

import { assemble } from '../../gba/thumb.mjs';
import { madeUpGame } from '../made-up-game.mjs';

export const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
export const CARTRIDGE = 0x08000000;
// where the made-up cartridge has each function, as the program's comments say, and each value the program names
export const FUNCTIONS = { Fall: 0x08000200, Scale: 0x08000240, Sum: 0x08000280, Paint: 0x080002C0, Step: 0x08000300, Skip: 0x08000320, Choose: 0x08000340, Run: 0x08000380 };
export const NAMED = new Map([['gBall', 0x03000100], ['gFrame', 0x03000020], ['gHandler', 0x03000040], ['gSteps', 0x08000600]]);
// what the compiler calls to call through a pointer: one instruction each, which the test puts in the cartridge itself
export const VIA = { _call_via_r0: 0x08000500, _call_via_r1: 0x08000504, _call_via_r2: 0x08000508, _call_via_r3: 0x0800050C };
export const STEPS = [1, 2, 5, 9];

// The made-up cartridge, from the assembly the compiler wrote: a header and a loop that does nothing, each function's
// bytes where FUNCTIONS says, with each place the assembler left filled in, and the few bytes the program doesn't define.
export function cartridge(assembly) {
  const { sections, symbols, relocations } = assemble(assembly);
  const text = Buffer.from(sections['.text'].bytes), { rom } = madeUpGame({ size: 0x1000 });
  const all = [...symbols].filter(([, symbol]) => symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
  all.forEach((f, i) => { f.until = all[i + 1]?.at ?? text.length; });
  const around = at => all.find(f => at >= f.at && at < f.until);
  const moved = at => { const f = around(at); return FUNCTIONS[f.name] + at - f.at; };
  for (const { at, kind, name, addend } of relocations) {
    const symbol = symbols.get(name);
    const target = symbol?.section === '.text' ? moved(symbol.at) + addend + (symbol.function ? 1 : 0) : (NAMED.get(name) ?? VIA[name]) + addend;
    if (kind === 'word') text.writeUInt32LE(target, at);
    else {
      const jump = (target & ~1) - (moved(at) + 4);
      text.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
      text.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
    }
  }
  for (const f of all) text.copy(rom, FUNCTIONS[f.name] - CARTRIDGE, f.at, f.until);
  // bx r0 to bx r3
  Object.values(VIA).forEach((address, register) => rom.writeUInt16LE(0x4700 | register << 3, address - CARTRIDGE));
  Buffer.from(STEPS).copy(rom, NAMED.get('gSteps') - CARTRIDGE);
  return rom;
}

