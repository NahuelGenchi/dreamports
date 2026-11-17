// A small NES program with nothing from any game in it, written here, for a real emulator to run in the tools' tests
// (real-console.mjs). A background of four tiles scrolls a pixel a frame, Select holds it still, the arrows move a sprite,
// Start turns the backdrop red, A plays a pulse wave and B a triangle wave. It does all this when the console's V-blank
// starts: first it shows what the last frame worked out, then it reads the buttons and works out the next. It keeps what
// it works out in its work memory, at the addresses in RAM, which a recording's start point can set.

import { createHash } from 'node:crypto';

/** Where the program keeps what it works out, in the console's work memory. */
export const RAM = { scroll: 0x10, buttons: 0x11, x: 0x12, y: 0x13, backdrop: 0x14 };
/** What it starts with, and the sound's two timers: pulse 1789773 / (16 * (t + 1)), triangle 1789773 / (32 * (t + 1)). */
export const START = { scroll: 0, x: 120, y: 100, backdrop: 0x21, pressedBackdrop: 0x16, sprite: 4 };
export const TIMER = 253;
/** Its colours, in the console's numbers: the backdrop and three of each background palette, then the sprite's. */
export const PALETTE = [0x21, 0x16, 0x27, 0x18, 0x21, 0x1A, 0x2A, 0x0A, 0x21, 0x12, 0x22, 0x32, 0x21, 0x04, 0x14, 0x24, 0x21, 0x30, 0x0F, 0x16, 0x21, 0x30, 0x0F, 0x16, 0x21, 0x30, 0x0F, 0x16, 0x21, 0x30, 0x0F, 0x16];
/** Its five tiles, each as eight rows of its two bit planes. */
export const TILES = [
  { plane0: [0, 0, 0, 0, 0, 0, 0, 0], plane1: [0, 0, 0, 0, 0, 0, 0, 0] },
  { plane0: [255, 255, 255, 255, 255, 255, 255, 255], plane1: [0, 0, 0, 0, 0, 0, 0, 0] },
  { plane0: [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55], plane1: [255, 255, 255, 255, 255, 255, 255, 255] },
  { plane0: [0xF0, 0xF0, 0xF0, 0xF0, 0x0F, 0x0F, 0x0F, 0x0F], plane1: [0x0F, 0x0F, 0x0F, 0x0F, 0xF0, 0xF0, 0xF0, 0xF0] },
  { plane0: [255, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 255], plane1: [0, 0x7E, 0x42, 0x42, 0x42, 0x42, 0x7E, 0] },
];
/** Where a copy holds its tiles and its colours. */
export const CHR_AT = 16 + 0x4000, PALETTE_AT = 16 + 0x3000;

// the 6502's instructions the program uses
const word = a => [a & 255, a >> 8];
const lda = v => [0xA9, v], ldx = v => [0xA2, v], ldy = v => [0xA0, v];
const load = a => [0xA5, a], save = a => [0x85, a], put = a => [0x8D, ...word(a)], putX = a => [0x9D, ...word(a)];
const SEI = 0x78, CLD = 0xD8, TXS = 0x9A, INX = 0xE8, INY = 0xC8, DEX = 0xCA, TXA = 0x8A, CLC = 0x18, LSR = 0x4A, RTI = 0x40;
const stx = a => [0x8E, ...word(a)], bit = a => [0x2C, ...word(a)], inc = a => [0xE6, a], dec = a => [0xC6, a], rol = a => [0x26, a];
const and = v => [0x29, v], cpx = v => [0xE0, v], cpy = v => [0xC0, v], adc = a => [0x65, a];
const here = name => ({ here: name }), branch = (op, name) => ({ op, name }), jmp = name => ({ jump: name });
const bpl = name => branch(0x10, name), bne = name => branch(0xD0, name), beq = name => branch(0xF0, name);
const table = name => ({ table: name });

const waitForVBlank = name => [here(name), bit(0x2002), bpl(name)];

// what it does at power-on, each step as a real game's does it, and then only waits
const RESET = [
  SEI, CLD, ldx(0x40), stx(0x4017), ldx(0xFF), TXS, INX, stx(0x2000), stx(0x2001), stx(0x4010), bit(0x2002),
  waitForVBlank('warm'),
  here('clear'), lda(0), [0x95, 0x00], lda(0xFF), putX(0x0200), INX, bne('clear'),
  waitForVBlank('warmer'),
  lda(0x3F), put(0x2006), lda(0), put(0x2006), ldx(0),
  here('colours'), table('palette'), put(0x2007), INX, cpx(32), bne('colours'),
  // its background: rows of the four tiles, each shifted one from the last, with all four palettes in each attribute
  lda(0x20), put(0x2006), lda(0), put(0x2006), ldy(0),
  here('row'), [0x84, 0x00], ldx(0), here('column'), TXA, CLC, adc(0x00), and(3), put(0x2007), INX, cpx(32), bne('column'), INY, cpy(30), bne('row'),
  lda(0xE4), ldx(64), here('attributes'), put(0x2007), DEX, bne('attributes'),
  lda(START.x), save(RAM.x), lda(START.y), save(RAM.y), lda(START.backdrop), save(RAM.backdrop),
  lda(START.y), put(0x0200), lda(START.sprite), put(0x0201), lda(0), put(0x0202), lda(START.x), put(0x0203),
  // the two sound channels, always running, silent until a button sets their volume
  lda(0x05), put(0x4015), lda(0xB0), put(0x4000), lda(0x08), put(0x4001), lda(TIMER), put(0x4002), lda(0), put(0x4003),
  lda(0x80), put(0x4008), lda(TIMER), put(0x400A), lda(0), put(0x400B),
  waitForVBlank('ready'),
  lda(0), put(0x2005), put(0x2005), lda(0x80), put(0x2000), lda(0x1E), put(0x2001),
  here('wait'), jmp('wait'),
];

const ifHeld = (mask, name, action) => [load(RAM.buttons), and(mask), beq(name), action, here(name)];

// what it does at every V-blank: shows what the last frame worked out, reads the buttons, and works out the next
const NMI = [
  lda(2), put(0x4014),
  lda(0x3F), put(0x2006), lda(0), put(0x2006), load(RAM.backdrop), put(0x2007),
  lda(0x80), put(0x2000), load(RAM.scroll), put(0x2005), lda(0), put(0x2005),
  lda(1), put(0x4016), lda(0), put(0x4016), ldx(8), here('read'), [0xAD, ...word(0x4016)], LSR, rol(RAM.buttons), DEX, bne('read'),
  // A B Select Start Up Down Left Right, from the highest bit
  ifHeld(0x01, 'right', inc(RAM.x)), ifHeld(0x02, 'left', dec(RAM.x)), ifHeld(0x04, 'down', inc(RAM.y)), ifHeld(0x08, 'up', dec(RAM.y)),
  load(RAM.y), put(0x0200), load(RAM.x), put(0x0203),
  lda(START.backdrop), save(RAM.backdrop), ifHeld(0x10, 'start', [lda(START.pressedBackdrop), save(RAM.backdrop)]),
  load(RAM.buttons), and(0x20), bne('still'), inc(RAM.scroll), here('still'),
  lda(0xB0), put(0x4000), ifHeld(0x80, 'a', [lda(0xBF), put(0x4000)]),
  lda(0x80), put(0x4008), ifHeld(0x40, 'b', [lda(0xFF), put(0x4008)]),
  RTI,
];

// lays out a list of instructions at an address, with its names, in two rounds: the first finds where each name is
function assemble(list, origin, tables) {
  const flat = list.flat(Infinity), names = {};
  const place = () => {
    const bytes = [];
    for (const item of flat) {
      const at = origin + bytes.length;
      if (typeof item === 'number') bytes.push(item);
      else if (item.here) names[item.here] = at;
      else if (item.op) bytes.push(item.op, ((names[item.name] ?? at) - at - 2) & 255);
      else if (item.jump) bytes.push(0x4C, ...word(names[item.jump] ?? 0));
      else if (item.table) bytes.push(0xBD, ...word(tables[item.table]));
    }
    return bytes;
  };
  place();
  return { bytes: place(), names };
}

/** The program as a copy of an NES game: { rom, sha1 }, one 16 KB block of code and one 8 KB block of tiles. With `pal`, its header says it's for a European console, in the header's newer form. */
export function madeUpNes({ pal = false } = {}) {
  const PRG = 0xC000, palette = PRG + PALETTE_AT - 16;
  const reset = assemble(RESET, PRG, { palette });
  const nmiAt = PRG + reset.bytes.length;
  const nmi = assemble(NMI, nmiAt, {});
  const prg = Buffer.alloc(0x4000, 0xFF);
  Buffer.from(reset.bytes).copy(prg, 0);
  Buffer.from(nmi.bytes).copy(prg, nmiAt - PRG);
  Buffer.from(PALETTE).copy(prg, palette - PRG);
  prg.writeUInt16LE(nmiAt, 0x3FFA);
  prg.writeUInt16LE(PRG, 0x3FFC);
  prg.writeUInt16LE(nmiAt + nmi.bytes.length - 1, 0x3FFE);
  const chr = Buffer.alloc(0x2000);
  TILES.forEach(({ plane0, plane1 }, tile) => {
    Buffer.from(plane0).copy(chr, tile * 16);
    Buffer.from(plane1).copy(chr, tile * 16 + 8);
  });
  const header = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 1, 1, 0, pal ? 0x08 : 0, 0, 0, 0, 0, pal ? 1 : 0, 0, 0, 0]);
  const rom = Buffer.concat([header, prg, chr]);
  return { rom, sha1: createHash('sha1').update(rom).digest('hex') };
}

/** A second program, for the tools that read a game's code and never run it (nes-functions.test.mjs, nes-read.test.mjs):
 *  a 64 KB UNROM copy of four banks, the last at $C000, with code in two switched banks, a bank switch through a
 *  routine, and three kinds of table the function finder follows. Its bytes are written out, with nothing from any game. */
export function madeUpUnrom() {
  const BANK = 0x4000;
  const prg = Buffer.alloc(4 * BANK, 0xFF);
  const at = (address, bank = 3) => bank * BANK + (address & 0x3FFF);
  const put = (address, bytes, bank) => Buffer.from(bytes).copy(prg, at(address, bank));
  // the reset: bank 1 by a write the bus agrees with, a call there, bank 2 by the routine at $C090, a call there, then
  // a jump through a table of whole addresses
  put(0xC000, [0x78, 0xA9, 0x01, 0xAA, 0x9D, 0x00, 0xC1, 0x20, 0x00, 0x80, 0xA9, 0x02, 0x20, 0x90, 0xC0, 0x20, 0x10, 0x80,
    0xA2, 0x00, 0xBD, 0x20, 0xC1, 0x85, 0x00, 0xBD, 0x21, 0xC1, 0x85, 0x01, 0x6C, 0x00, 0x00]);
  // the V-blank interrupt: an address from two tables of low and high bytes, pushed for an RTS
  put(0xC040, [0xA2, 0x00, 0xBD, 0x42, 0xC1, 0x48, 0xBD, 0x40, 0xC1, 0x48, 0x60]);
  // the other interrupt: a call to a routine that reads the list of addresses after it
  put(0xC060, [0x20, 0x70, 0xC0, ...word(0xC240), ...word(0xC250), 0x00, 0x00]);
  put(0xC070, [0x0A, 0xA8, 0x68, 0x85, 0x02, 0x68, 0x85, 0x03, 0xC8, 0xB1, 0x02, 0x85, 0x04, 0xC8, 0xB1, 0x02, 0x85, 0x05, 0x6C, 0x04, 0x00]);
  // switches to the bank in A
  put(0xC090, [0x85, 0x10, 0xAA, 0x9D, 0x00, 0xC1, 0x60]);
  put(0xC100, [0, 1, 2, 3]);
  put(0xC120, [...word(0xC200), ...word(0xC210)]);
  put(0xC140, [0x1F, 0x2F, 0xC2, 0xC2]);
  for (const a of [0xC200, 0xC210, 0xC220, 0xC230, 0xC240, 0xC250]) put(a, [0x60]);
  // code nothing leads to, between the others
  put(0xC300, [0xAD, 0x00, 0x03, 0x8D, 0x07, 0x20, 0xE8, 0x60]);
  put(0x8000, [0xA9, 0x00, 0x60], 1);
  put(0x8010, [0xA2, 0x01, 0x60], 2);
  // the same at $8010 in bank 0, which nothing switches in
  put(0x8010, [0xA2, 0x01, 0x60], 0);
  prg.writeUInt16LE(0xC040, at(0xFFFA));
  prg.writeUInt16LE(0xC000, at(0xFFFC));
  prg.writeUInt16LE(0xC060, at(0xFFFE));
  const header = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 4, 0, 0x21, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, prg]);
}
