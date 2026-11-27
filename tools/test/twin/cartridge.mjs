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
// a function whose last branch goes by a value it keeps on its own stack, in a file of its own (kept.c)
export const KEPT = { Stash: 0x08000780 };
// the BIOS's division, as a game calls it: a stub of its own in the cartridge, swi 6 and back
export const BIOS = { Div: 0x08000510 };
// and the function that calls it, in a file of its own (bios.c)
export const DIVIDES = { Share: 0x08000540 };
// a function that reads a register of the hardware and writes it changed, one that waits for a DMA the V-blank
// starts, one that reads a register through its twin's own register file, one whose DMA copies from the BIOS, and
// one that reads the display's control through the kit's display registers, one whose DMA runs into its own frame
// from below it and one whose DMA copies into a local of its own, in a file of their own (register.c)
export const REGISTER = { Shift: 0x080005E0, Await: 0x08000620, Bias: 0x08000680, Sweep: 0x08000700, Into: 0x08000740, Fetch: 0x08000940, Ready: 0x08000980, Mode: 0x08000A60, Picture: 0x08000AC0 };
// what only play reaches, in a file of its own (play.c): a function that reads what play makes, the game itself,
// which the cartridge starts, one that runs code play put in the work memory, and the value play keeps the stage in
// (Play, which grew with Spare, after every other function, where it has room)
export const PLAYED = { Shine: 0x08000400, Play: 0x08000B00, Glow: 0x08000800, Spare: 0x08000880 };
NAMED.set('gStage', 0x03000060);
// a function that gives back what its caller keeps, and that caller, in a file of their own (gives.c)
export const GIVES = { Count: 0x08000580, Keep: 0x080005A0 };
// a function of ARM code written by hand, which reads a word where none starts (withTurn, turn.c): 16 bytes of code
// and the number it loads beside them
export const TURN = { Turn: 0x08000900 };
export const TURN_LENGTH = 16;
// a function of ARM code written by hand, which reads what the link port received and compares it with a mark
// (withLinked, link.c): 44 bytes of code and the address it loads beside them
export const LINKED = { Linked: 0x08000D80 };
export const LINKED_LENGTH = 44;
// a Thumb start that goes on into ARM code, as a library's veneer does, with its ARM part an entry of its own as a code
// map has it (withTwice, twice.c): 4 bytes of Thumb, then 20 of ARM and the address it loads
export const TWICE = { Twice: 0x08000A80 };
export const TWICE_PIECES = [{ address: 0x08000A80, size: 4 }, { address: 0x08000A84, size: 24 }];
// a function that goes through a list of pointers to structs, empty in the memory it's called from, and the list, its
// count and the total it adds to, in a file of their own (through.c)
export const THROUGH = { Tally: 0x08000E00 };
NAMED.set('gShapes', 0x030000A0).set('gShapeCount', 0x030000B0).set('gTotal', 0x030000B4);
// a function that reads through a pointer the game keeps to a table in the cartridge, a list of pointers to numbers,
// and the pointer, the kind it reads and the width it adds to, in a file of their own (table.c); the table, its list
// and the numbers, where the cartridge has them, none with its top two bits set
export const TABLE = { Measure: 0x08000E80 };
NAMED.set('gTable', 0x030000C0).set('gKind', 0x030000C4).set('gWide', 0x030000C8);
export const KINDS = 0x08000F00, PIECES = [[0x0001, 0x4002, 0x8003, 0x0004], [0x4000, 0x0005], [0x8001, 0x2000, 0x0007], [0x7FFF]];
// a function that writes through a pointer in the struct it's given, which one of its paths needs to point into that
// struct, and the pointer to it, 0 in the memory the test calls from, and what it adds to, in a file of their own
// (inside.c)
export const INSIDE = { Pour: 0x08000F80 };
NAMED.set('gStrip', 0x030000D0).set('gSpilled', 0x030000D4);

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
// The same cartridge with Turn, in ARM: ldr r1, =gFrame + 2   ldr r2, [r1]   str r2, [r1, #2]   bx lr. The word at
// gFrame + 2 doesn't start a word, so the processor reads the one at gFrame, turned by half, and keeps it at gFrame + 4.
export function withTurn(rom) {
  const turned = Buffer.from(rom);
  [0xE59F1008, 0xE5912000, 0xE5812002, 0xE12FFF1E, NAMED.get('gFrame') + 2].forEach((word, i) => turned.writeUInt32LE(word, TURN.Turn - CARTRIDGE + 4 * i));
  return turned;
}

// a routine written by hand that takes an address in r2 and gives back in r3, as no C function does, and one that
// takes a place in gBall in r4 and a byte in r5 and gives nothing back (withPeek, peek.c)
export const PEEK = { Peek: 0x08000A40, Spill: 0x08000A48 };
export const PEEK_LENGTH = 6;
export const SPILL_LENGTH = 16;

export function withPeek(rom) {
  const peeked = Buffer.from(rom);
  // ldrb r3, [r2, #0], add r3, #1, bx lr
  [0x7813, 0x3301, 0x4770].forEach((op, i) => peeked.writeUInt16LE(op, PEEK.Peek - CARTRIDGE + 2 * i));
  // ldr r0, =gBall, mov r1, #7, and r1, r4, strb r5, [r0, r1], bx lr, and the word ldr loads
  [0x4802, 0x2107, 0x4021, 0x5445, 0x4770, 0x0000].forEach((op, i) => peeked.writeUInt16LE(op, PEEK.Spill - CARTRIDGE + 2 * i));
  peeked.writeUInt32LE(NAMED.get('gBall'), PEEK.Spill - CARTRIDGE + 12);
  return peeked;
}

// The same cartridge with Linked, in ARM: mov r12, #0x04000000   add r12, r12, #0x120   ldrh r0, [r12]
// ldr r1, =gFrame   mov r2, #0xFE   add r2, r2, #0xFE00   cmp r0, r2   bne past the next two   mov r0, #1
// str r0, [r1]   bx lr. The mark, 0xFEFE, is made of two numbers and named only by the cmp.
export function withLinked(rom) {
  const linked = Buffer.from(rom), at = LINKED.Linked - CARTRIDGE;
  if (!linked.subarray(at, at + LINKED_LENGTH + 4).every(byte => byte === linked[at])) throw new Error('Linked has no room in the made-up cartridge.');
  [0xE3A0C301, 0xE28CCE12, 0xE1DC00B0, 0xE59F1018, 0xE3A020FE, 0xE2822CFE, 0xE1500002, 0x1A000001, 0xE3A00001, 0xE5810000, 0xE12FFF1E, NAMED.get('gFrame')].forEach((word, i) => linked.writeUInt32LE(word, at + 4 * i));
  return linked;
}

export function withTwice(rom) {
  const twice = Buffer.from(rom);
  // add r2, pc, #0 and bx r2: on into the ARM code after it
  twice.writeUInt32LE(0x4710A200, TWICE.Twice - CARTRIDGE);
  // ldr r1, [pc, #12], ldr r2, [r1, #4], lsl r2, r2, #1, str r2, [r1, #8], bx lr, and gFrame
  [0xE59F100C, 0xE5912004, 0xE1A02082, 0xE5812008, 0xE12FFF1E, NAMED.get('gFrame')].forEach((word, i) => twice.writeUInt32LE(word, TWICE.Twice + 4 - CARTRIDGE + 4 * i));
  return twice;
}

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

// The same cartridge with the function of twin/kept.c, whose last branch goes by a value it keeps on its stack.
export function withKept(rom, assembly) {
  const kept = Buffer.from(rom);
  place(kept, assembly, KEPT);
  return kept;
}

// The same cartridge with the function of twin/aim.c, whose rare branch the check has to aim at.
export function withAimed(rom, assembly) {
  const aimed = Buffer.from(rom);
  place(aimed, assembly, AIMED);
  return aimed;
}

// The same cartridge with the function of twin/through.c, which goes through a list of pointers to structs.
export function withThrough(rom, assembly) {
  const through = Buffer.from(rom);
  place(through, assembly, THROUGH);
  return through;
}

// The same cartridge with the function of twin/inside.c, which writes through a pointer in the struct it's given.
export function withInside(rom, assembly) {
  const inside = Buffer.from(rom);
  place(inside, assembly, INSIDE);
  return inside;
}

// The same cartridge with the function of twin/table.c, the table it reads in the cartridge, its list of 4 kinds and
// each kind's numbers, and a start that points gTable to the table before the loop that does nothing, as a game sets
// a pointer to one of its own tables: ldr r0, =gTable   ldr r1, =table   str r1, [r0]   b .
export function withTable(rom, assembly) {
  const tabled = Buffer.from(rom);
  place(tabled, assembly, TABLE);
  const list = KINDS + 0x10, numbers = list + 4 * PIECES.length;
  tabled.writeUInt32LE(list, KINDS - CARTRIDGE);
  tabled.writeUInt16LE(PIECES.length, KINDS + 4 - CARTRIDGE);
  let at = numbers;
  PIECES.forEach((piece, kind) => {
    tabled.writeUInt32LE(at, list + 4 * kind - CARTRIDGE);
    piece.forEach(value => { tabled.writeUInt16LE(value, at - CARTRIDGE); at += 2; });
  });
  [0xE59F0008, 0xE59F1008, 0xE5801000, 0xEAFFFFFE, NAMED.get('gTable'), KINDS].forEach((word, i) => tabled.writeUInt32LE(word, 0xC0 + 4 * i));
  return tabled;
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
