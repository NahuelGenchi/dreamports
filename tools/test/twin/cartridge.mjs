// The made-up cartridge the function check's tests call (../twin.mjs, ../function-tasks.mjs): program.c built by
// the console's own compiler, each function at the address its comment names, with nothing from any game in it, and
// the same cartridge with a game to play, for the check's memories of play.

import { assemble } from '../../gba/thumb.mjs';
import { madeUpGame } from '../made-up-game.mjs';

export const compiler = { name: 'agbcc', flags: ['-mthumb-interwork', '-O2', '-fprologue-bugfix'] };
export const CARTRIDGE = 0x08000000;
// a function that reads video memory, in a file of its own (video.c)
export const VIDEO = { Look: 0x080005C0 };
// where the made-up cartridge has each function, as the program's comments say, and each value the program names
export const FUNCTIONS = { Fall: 0x08000200, Scale: 0x08000240, Sum: 0x08000280, Paint: 0x080002C0, Step: 0x08000300, Skip: 0x08000320, Choose: 0x08000340, Run: 0x08000380 };
export const NAMED = new Map([['gBall', 0x03000100], ['gFrame', 0x03000020], ['gHandler', 0x03000040], ['gSteps', 0x08000600]]);
// what the compiler calls to call through a pointer: one instruction each, which the test puts in the cartridge itself
export const VIA = { _call_via_r0: 0x08000500, _call_via_r1: 0x08000504, _call_via_r2: 0x08000508, _call_via_r3: 0x0800050C };
export const STEPS = [1, 2, 5, 9];
// a function with a branch made-up calls almost never take, in a file of its own (aim.c)
export const AIMED = { Unlock: 0x080006C0 };
// the BIOS's division, as a game calls it: a stub of its own in the cartridge, swi 6 and back
export const BIOS = { Div: 0x08000510 };
// and the function that calls it, in a file of its own (bios.c)
export const DIVIDES = { Share: 0x08000540 };
// a function that reads a register of the hardware and writes it changed, and one that waits for a DMA the V-blank
// starts, in a file of their own (register.c)
export const REGISTER = { Shift: 0x080005E0, Await: 0x08000620 };
// what only play reaches, in a file of its own (play.c): a function that reads what play makes, the game itself,
// which the cartridge starts, and the value play keeps the stage in
export const PLAYED = { Shine: 0x08000400, Play: 0x08000440 };
NAMED.set('gStage', 0x03000060);
// a function that gives back what its caller keeps, and that caller, in a file of their own (gives.c)
export const GIVES = { Count: 0x08000580, Keep: 0x080005A0 };

// The made-up cartridge, from the assembly the compiler wrote: a header and a loop that does nothing, each function's
// bytes where FUNCTIONS says, with each place the assembler left filled in, and the few bytes the program doesn't define.
export function cartridge(assembly) {
  const { rom } = madeUpGame({ size: 0x1000 });
  place(rom, assembly, FUNCTIONS);
  // bx r0 to bx r3
  Object.values(VIA).forEach((address, register) => rom.writeUInt16LE(0x4700 | register << 3, address - CARTRIDGE));
  // swi 6, bx lr
  rom.writeUInt16LE(0xDF06, BIOS.Div - CARTRIDGE);
  rom.writeUInt16LE(0x4770, BIOS.Div - CARTRIDGE + 2);
  Buffer.from(STEPS).copy(rom, NAMED.get('gSteps') - CARTRIDGE);
  return rom;
}

// The same cartridge with the function of twin/video.c, which reads video memory.
export function withVideo(rom, assembly) {
  const looked = Buffer.from(rom);
  place(looked, assembly, VIDEO);
  return looked;
}

// one file's functions, from the assembly the compiler wrote, each where `where` says in the cartridge, and each value it
// names where `names` says, or else where the program's are
export function place(rom, assembly, where, names = new Map()) {
  const { sections, symbols, relocations } = assemble(assembly);
  const text = Buffer.from(sections['.text'].bytes);
  const all = [...symbols].filter(([, symbol]) => symbol.function).map(([name, symbol]) => ({ name, at: symbol.at })).sort((a, b) => a.at - b.at);
  all.forEach((f, i) => { f.until = all[i + 1]?.at ?? text.length; });
  const around = at => all.find(f => at >= f.at && at < f.until);
  const moved = at => { const f = around(at); return where[f.name] + at - f.at; };
  for (const { at, kind, name, addend } of relocations) {
    const symbol = symbols.get(name);
    const target = symbol?.section === '.text' ? moved(symbol.at) + addend + (symbol.function ? 1 : 0) : (names.get(name) ?? NAMED.get(name) ?? VIA[name] ?? BIOS[name]) + addend;
    if (kind === 'word') text.writeUInt32LE(target, at);
    else {
      const jump = (target & ~1) - (moved(at) + 4);
      text.writeUInt16LE(0xF000 | ((jump >> 12) & 0x7FF), at);
      text.writeUInt16LE(0xF800 | ((jump >> 1) & 0x7FF), at + 2);
    }
  }
  for (const f of all) text.copy(rom, where[f.name] - CARTRIDGE, f.at, f.until);
}

// The same cartridge with the function of twin/register.c, which changes a register of the hardware.
export function withRegister(rom, assembly) {
  const shifted = Buffer.from(rom);
  place(shifted, assembly, REGISTER);
  return shifted;
}

// The same cartridge with the function of twin/bios.c, which divides through the BIOS.
export function withDivision(rom, assembly) {
  const divided = Buffer.from(rom);
  place(divided, assembly, DIVIDES);
  return divided;
}

// The same cartridge with the function of twin/aim.c, whose rare branch the check has to aim at.
export function withAimed(rom, assembly) {
  const aimed = Buffer.from(rom);
  place(aimed, assembly, AIMED);
  return aimed;
}

// The same cartridge with a game to play: the functions of twin/play.c, and a start that goes to Play in place of
// the loop that does nothing.
export function withPlay(rom, assembly) {
  const played = Buffer.from(rom);
  place(played, assembly, PLAYED);
  played.writeUInt32LE(0xE59F0000, 0xC0);         // ldr r0, [pc]: the word two after this one
  played.writeUInt32LE(0xE12FFF10, 0xC4);         // bx r0
  played.writeUInt32LE(PLAYED.Play | 1, 0xC8);
  return played;
}

// The same cartridge with the functions of twin/gives.c: one that gives back a value, and its caller, which uses it.
export function withGives(rom, assembly) {
  const given = Buffer.from(rom);
  place(given, assembly, GIVES);
  return given;
}
