// A small Game Boy program with nothing from any game in it, written here, for the real emulator to run in the tools'
// tests (real-gb.mjs), and the same program for the Game Boy Color: only its header and what it does with colours
// differ. A background of four tiles scrolls, a window covers the bottom two rows of tiles, the arrows move a sprite,
// and a second one changes its tile from a byte each of the cartridge's banks holds. A makes a tone that slides, B one
// whose pitch the timer's interrupt changes, Select a burst of noise, and Start turns the wave channel on or off and
// changes the colours. Halfway down the screen an interrupt scrolls the rest the other way: two lines before, the same
// interrupt switches the timer's off, so the timer's code is never running when the line comes, and the scroll is
// always written before the line is drawn. It keeps what it works out in its work memory, at the addresses in RAM,
// which a recording's start point can set.
//
// Its code is written out an instruction at a time, with how many of the processor's cycles each takes, so its
// Dreamport in C (made-up-gb.c) can say when each of its writes happens: the program's `times` holds the cycles from one
// mark to the next. At power-on that is exactly what the processor takes, with every loop's turns counted, on a Game Boy
// or on a Game Boy Color. In the interrupts' code, where the buttons decide the way, it is the cycles along the way the
// code falls through, and a jump taken is 4 more than one that isn't.

import { createHash } from 'node:crypto';

/** Where the program keeps what it works out, as addresses of the console's memory. */
export const RAM = { scroll: 0xC000, buttons: 0xC001, before: 0xC002, x: 0xC003, y: 0xC004, ticks: 0xC005, colour: 0xC006, flipped: 0xC007, frame: 0xC008, banked: 0xC009, saved: 0xC00A, wave: 0xC00B, other: 0xC00C, split: 0xC00D, next: 0xC00E, stage: 0xC00F, oam: 0xC100 };
/** What it starts with. */
export const START = { x: 80, y: 72, otherX: 100, otherY: 60, lyc: 70, splitAt: 72, wy: 128, tma: 0xC0, bgp: 0xE4, obp0: 0xD2, obp1: 0x27 };
/** The byte each of its four banks holds at $7FF0, the second sprite's tile, and the timer's four pitches. */
export const BANKED = [5, 6, 7, 6], PITCHES = [0x06, 0x83, 0xC4, 0x21];
export const BANKED_AT = 0x3FF0;
// where the first bank holds the timer's pitches and the routine that copies the sprites
export const PITCHES_AT = 0x3F00, DMA_AT = 0x3F10;

// its eight tiles, each row as its two bit planes
const rows = (low, high) => low.flatMap((byte, row) => [byte, high[row]]);
const all = byte => Array(8).fill(byte);
export const TILES = [
  rows(all(0), all(0)),
  rows(all(0xFF), all(0)),
  rows([0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55], all(0xFF)),
  rows([0xF0, 0xF0, 0xF0, 0xF0, 0x0F, 0x0F, 0x0F, 0x0F], [0x0F, 0x0F, 0x0F, 0x0F, 0xF0, 0xF0, 0xF0, 0xF0]),
  rows([0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00], [0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF]),
  rows([0xFF, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xFF], [0x00, 0x7E, 0x42, 0x42, 0x42, 0x42, 0x7E, 0x00]),
  rows([0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18], [0x00, 0x18, 0x3C, 0x7E, 0x7E, 0x3C, 0x18, 0x00]),
  rows([0x80, 0xC0, 0xE0, 0xF0, 0xF8, 0xFC, 0xFE, 0xFF], [0xFF, 0x7F, 0x3F, 0x1F, 0x0F, 0x07, 0x03, 0x01]),
];
// the Game Boy Color's colours, 15 bits each, eight palettes of four for the background and eight for the sprites
const colour = (palette, number, sprites) => ((palette * 5 + number * 9 + (sprites ? 7 : 0)) & 31) | ((palette * 3 + number * 7 + 2) & 31) << 5 | ((31 - palette * 4 - number * 3 + (sprites ? 11 : 0)) & 31) << 10;
const palettes = sprites => Array.from({ length: 32 }, (_, i) => colour(i >> 2, i & 3, sprites)).flatMap(c => [c & 255, c >> 8]);
export const BG_COLOURS = palettes(false), SPRITE_COLOURS = palettes(true);
/** The colour Start gives the first background palette's first colour, and takes away again. */
export const FLIPPED_COLOUR = 0x2D5F;
export const WAVE = [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10];

// The processor's instructions the program uses, each { b: its bytes, t: its cycles }. A jump or a call to a name is
// { to, b, t }, and a relative jump { near, b, t }, taken or not: `t` is what it takes when the code falls through it.
const word = n => [n & 255, n >> 8 & 255];
const op = (t, ...b) => ({ b: b.flat(), t });
const REG = { b: 0, c: 1, d: 2, e: 3, h: 4, l: 5, a: 7 };
const PAIR = { bc: 0, de: 1, hl: 2, sp: 3 };
const ld = (r, n) => op(8, 0x06 | REG[r] << 3, n);
const mv = (to, from) => op(4, 0x40 | REG[to] << 3 | REG[from]);
const ldw = (rr, nn) => op(12, 0x01 | PAIR[rr] << 4, word(nn));
const lda = nn => op(16, 0xFA, word(nn)), sta = nn => op(16, 0xEA, word(nn));
const ldh = n => op(12, 0xF0, n & 255), sth = n => op(12, 0xE0, n & 255);
const LDI = op(8, 0x2A), STI = op(8, 0x22), LD_HL = op(8, 0x7E), ST_HL = op(8, 0x77), LD_DE = op(8, 0x1A);
const inc = r => op(4, 0x04 | REG[r] << 3), dec = r => op(4, 0x05 | REG[r] << 3);
const incw = rr => op(8, 0x03 | PAIR[rr] << 4), decw = rr => op(8, 0x0B | PAIR[rr] << 4);
const add = r => op(4, 0x80 | REG[r]), or = r => op(4, 0xB0 | REG[r]), xor = r => op(4, 0xA8 | REG[r]), andr = r => op(4, 0xA0 | REG[r]);
const and = n => op(8, 0xE6, n), cp = n => op(8, 0xFE, n), addn = n => op(8, 0xC6, n), xorn = n => op(8, 0xEE, n);
const CPL = op(4, 0x2F), SWAP = op(8, 0xCB, 0x37), DI = op(4, 0xF3), EI = op(4, 0xFB), HALT = op(4, 0x76), NOP = op(4, 0x00);
const RET = op(16, 0xC9), RETI = op(16, 0xD9), PUSH_AF = op(16, 0xF5), POP_AF = op(12, 0xF1), PUSH_HL = op(16, 0xE5), POP_HL = op(12, 0xE1);
const jp = to => ({ to, b: [0xC3], t: 16 }), call = to => ({ to, b: [0xCD], t: 24 });
const jr = near => ({ near, b: [0x18], t: 12 }), jrnz = near => ({ near, b: [0x20], t: 8 }), jrz = near => ({ near, b: [0x28], t: 8 });
// at power-on the way is known: a jump that's taken on one console, code only one console runs, a loop's turns, each 4
// more than the last as its jump back is taken, and a routine's time
const takenOn = (jump, on) => ({ ...jump, takenOn: on });
const only = (on, body) => ({ only: on, body });
const turns = (count, body) => ({ turns: count, body });
const lasts = cycles => ({ lasts: cycles });
const COLOUR = variant => variant.colour, GREY = variant => !variant.colour;
const here = name => ({ here: name });
/** A mark: TIMES[name] is the cycles from the mark before it to `plus` cycles into the instruction after this one,
 *  which for a store is when the processor writes: 8 into a store to $FFxx, 12 into one to a whole address, and 4 into
 *  one through HL. */
const mark = (name, plus = 0) => ({ mark: name, plus });
const HIGH = 8, WHOLE = 12;

const IO = { p1: 0x00, if: 0x0F, tma: 0x06, tac: 0x07, nr10: 0x10, nr11: 0x11, nr12: 0x12, nr13: 0x13, nr14: 0x14, nr21: 0x16, nr22: 0x17, nr23: 0x18, nr24: 0x19, nr30: 0x1A, nr32: 0x1C, nr33: 0x1D, nr34: 0x1E, nr41: 0x20, nr42: 0x21, nr43: 0x22, nr44: 0x23, nr50: 0x24, nr51: 0x25, nr52: 0x26, wave: 0x30, lcdc: 0x40, stat: 0x41, scy: 0x42, scx: 0x43, lyc: 0x45, dma: 0x46, bgp: 0x47, obp0: 0x48, obp1: 0x49, wy: 0x4A, wx: 0x4B, vbk: 0x4F, bcps: 0x68, bcpd: 0x69, ocps: 0x6A, ocpd: 0x6B, ie: 0xFF };
export { IO };
/** The screen's settings once it's on: the background and the sprites, the window with its own map, tiles from $8000. */
export const LCDC = 0xF3;

// copies BC bytes from HL to DE, and fills BC bytes from HL with D
const COPY = [here('copy'), LDI, op(8, 0x12), incw('de'), decw('bc'), mv('a', 'b'), or('c'), jrnz('copy'), RET];
const FILL = [here('fill'), mv('a', 'd'), STI, decw('bc'), mv('a', 'b'), or('c'), jrnz('fill'), RET];
// what a turn of each routine's loop takes, and the routine with its return: its last turn's jump isn't taken
const COPY_TURN = 8 + 8 + 8 + 8 + 4 + 4 + 12, FILL_TURN = 4 + 8 + 8 + 4 + 4 + 12;
const copies = count => [call('copy'), lasts(count * COPY_TURN - 4 + 16)], fills = count => [call('fill'), lasts(count * FILL_TURN - 4 + 16)];

// the routine that copies the sprites, which runs from $FF80 as the cartridge can't be read meanwhile
const DMA = [ld('a', RAM.oam >> 8), 0xE0, IO.dma, ld('a', 0x28), 0x3D, 0x20, 0xFD, 0xC9].flatMap(item => (typeof item === 'number' ? [item] : item.b));

const store = (name, value, io) => [ld('a', value), mark(name, HIGH), sth(io)];

// what it does at power-on, with the screen off: its tiles, its two maps, its colours, the sound, the timer, and its
// work memory. Then the screen on, and it only waits for its interrupts.
const reset = () => [
  here('reset'), DI, ldw('sp', 0xE000), mv('d', 'a'), xor('a'), mark('screenOff', HIGH), sth(IO.lcdc),
  mv('e', 'd'), ldw('hl', 0xC000), ldw('bc', 0x0200), ld('d', 0), fills(0x0200),
  // whether it's a Game Boy Color: A held $11 at power-on
  mv('a', 'e'), cp(0x11), ld('a', 0), takenOn(jrnz('grey'), GREY), only(COLOUR, inc('a')), here('grey'), sta(RAM.colour),
  ldw('hl', DMA_AT), ldw('de', 0xFF80), ldw('bc', DMA.length), copies(DMA.length),
  ld('a', 2), mark('bank2', WHOLE), sta(0x2000),
  ldw('hl', 0x4000), ldw('de', 0x8000), ldw('bc', TILES.length * 16), copies(TILES.length * 16),
  // the background: rows of the four tiles, each shifted one from the last
  ldw('hl', 0x9800), ld('c', 0),
  here('mapRow'), turns(32, [ld('b', 0), here('map'), turns(32, [mv('a', 'b'), add('c'), and(3), STI, inc('b'), mv('a', 'b'), cp(32), jrnz('map')]), inc('c'), mv('a', 'c'), cp(32), jrnz('mapRow')]),
  ldw('hl', 0x9C00), ldw('bc', 0x0400), ld('d', 4), fills(0x0400),
  ld('a', 3), mark('bank3', WHOLE), sta(0x2000),
  lda(RAM.colour), or('a'), takenOn(jrz('shades'), GREY),
  // on a Game Boy Color: each tile's palette in the second bank of its picture memory, and the 64 colours
  only(COLOUR, [
    ld('a', 1), sth(IO.vbk),
    ldw('hl', 0x9800), ld('c', 0),
    here('attrRow'), turns(32, [ld('b', 0), here('attr'), turns(32, [mv('a', 'b'), add('c'), and(7), STI, inc('b'), mv('a', 'b'), cp(32), jrnz('attr')]), inc('c'), mv('a', 'c'), cp(32), jrnz('attrRow')]),
    ldw('hl', 0x9C00), ldw('bc', 0x0400), ld('d', 7), fills(0x0400),
    xor('a'), sth(IO.vbk),
    ld('a', 0x80), sth(IO.bcps), ldw('hl', 0x4000), ld('b', 64), here('bgColours'), turns(64, [LDI, sth(IO.bcpd), dec('b'), jrnz('bgColours')]),
    ld('a', 0x80), sth(IO.ocps), ld('b', 64), here('spriteColours'), turns(64, [LDI, sth(IO.ocpd), dec('b'), jrnz('spriteColours')]),
    jr('coloured'),
  ]),
  only(GREY, [here('shades'), ld('a', START.bgp), sth(IO.bgp), ld('a', START.obp0), sth(IO.obp0), ld('a', START.obp1), sth(IO.obp1)]),
  here('coloured'),
  mark('soundOn'),
  store('nr52', 0x80, IO.nr52), store('nr50', 0x77, IO.nr50), store('nr51', 0xFF, IO.nr51),
  ldw('hl', 0x4080), ldw('de', 0xFF30), ldw('bc', 16), copies(16),
  // the cartridge's own memory, which a battery keeps: how many times the console was switched on
  ld('a', 0x0A), sta(0x0000), lda(0xA000), inc('a'), sta(0xA000), sta(RAM.saved),
  ld('a', START.x), sta(RAM.x), ld('a', START.y), sta(RAM.y),
  ldw('hl', RAM.oam), ld('a', START.y + 16), STI, ld('a', START.x + 8), STI, ld('a', 5), STI, xor('a'), STI,
  ld('a', START.otherY + 16), STI, ld('a', START.otherX + 8), STI, ld('a', 6), STI, ld('a', 0xB1), STI,
  xor('a'), sth(IO.scx), sth(IO.scy), ld('a', START.wy), sth(IO.wy), ld('a', 7), sth(IO.wx),
  ld('a', START.lyc), sth(IO.lyc), ld('a', 0x40), sth(IO.stat),
  mark('timerOn'),
  store('tma', START.tma, IO.tma), store('tac', 0x04, IO.tac),
  xor('a'), sth(IO.if), ld('a', 0x07), mark('interruptsOn', HIGH), sth(IO.ie),
  ld('a', LCDC), mark('screenOn', HIGH), sth(IO.lcdc),
  EI, mark('waits'),
  here('wait'), HALT, jr('wait'),
];

// one of the buttons' two halves: chosen, read twice as the lines take a moment to settle, and its low four bits kept, a
// 1 for each button held
const half = choose => [ld('a', choose), sth(IO.p1), ldh(IO.p1), ldh(IO.p1), CPL, and(0x0F)];
// what to do when a button has just been pressed: `mask` in the buttons now and not in those before, which B holds
const pressed = (mask, name, action) => [mark(`${name}Asked`), mv('a', 'b'), and(mask), jrz(name), action, here(name), mark(`${name}Done`)];
const held = (mask, name, action) => [mark(`${name}Asked`), lda(RAM.buttons), and(mask), jrz(name), action, here(name), mark(`${name}Done`)];

// what it does as each picture ends: the sprites, the scroll, the buttons, and what the buttons change
const vblank = () => [
  here('vblank'), mark('vblankAt'), PUSH_AF, PUSH_HL, op(16, 0xC5),
  mark('dma'), call(0xFF80), mark('dmaDone'),
  lda(RAM.scroll), sta(RAM.next), mark('scx', HIGH), sth(IO.scx), op(8, 0xCB, 0x3F), mark('scy', HIGH), sth(IO.scy),
  mark('statRead', HIGH), ldh(IO.stat), sta(RAM.other),
  // the arrows in the high four bits, Right, Left, Up, Down from the lowest, and A, B, Select, Start in the low four
  mark('pad'), half(0x20), SWAP, mv('b', 'a'), half(0x10), or('b'), mv('c', 'a'), ld('a', 0x30), sth(IO.p1),
  // B: the buttons pressed since the last picture
  lda(RAM.buttons), sta(RAM.before), CPL, andr('c'), mv('b', 'a'), mv('a', 'c'), sta(RAM.buttons),
  held(0x10, 'right', [lda(RAM.x), inc('a'), sta(RAM.x)]),
  held(0x20, 'left', [lda(RAM.x), dec('a'), sta(RAM.x)]),
  held(0x40, 'up', [lda(RAM.y), dec('a'), sta(RAM.y)]),
  held(0x80, 'down', [lda(RAM.y), inc('a'), sta(RAM.y)]),
  lda(RAM.y), addn(16), sta(RAM.oam), lda(RAM.x), addn(8), sta(RAM.oam + 1),
  // the second sprite's tile, from the bank the frame's number chooses
  lda(RAM.frame), inc('a'), sta(RAM.frame), SWAP, and(3), mark('bank', WHOLE), sta(0x2000), lda(0x4000 + BANKED_AT), sta(RAM.banked), sta(RAM.oam + 6),
  lda(RAM.scroll), inc('a'), sta(RAM.scroll), CPL, inc('a'), sta(RAM.split),
  pressed(0x01, 'a', [store('nr10', 0x16, IO.nr10), store('nr11', 0x80, IO.nr11), store('nr12', 0xF3, IO.nr12), store('nr13', 0x83, IO.nr13), store('nr14', 0x86, IO.nr14)]),
  pressed(0x02, 'b', [store('nr21', 0x70, IO.nr21), store('nr22', 0xA4, IO.nr22), store('nr23', 0x06, IO.nr23), store('nr24', 0xC7, IO.nr24)]),
  pressed(0x04, 'select', [store('nr41', 0x00, IO.nr41), store('nr42', 0xF2, IO.nr42), store('nr43', 0x53, IO.nr43), store('nr44', 0x80, IO.nr44)]),
  pressed(0x08, 'start', [
    lda(RAM.flipped), xorn(1), sta(RAM.flipped),
    lda(RAM.wave), xorn(1), sta(RAM.wave), mark('waveAsked'), jrz('waveOff'),
    store('nr30', 0x80, IO.nr30), store('nr32', 0x20, IO.nr32), store('nr33', 0xD6, IO.nr33), store('nr34', 0x86, IO.nr34), mark('waveOnEnds'), jr('waveDone'),
    here('waveOff'), mark('waveOffAt'), store('nr30off', 0x00, IO.nr30),
    here('waveDone'), mark('waveDone'),
    lda(RAM.colour), or('a'), mark('coloursAsked'), jrz('shadesFlip'),
    ld('a', 0x80), mark('bcps', HIGH), sth(IO.bcps),
    lda(RAM.flipped), or('a'), mark('whichColour'), jrz('plain'),
    ld('a', FLIPPED_COLOUR & 255), mark('flipLow', HIGH), sth(IO.bcpd), ld('a', FLIPPED_COLOUR >> 8), mark('flipHigh', HIGH), sth(IO.bcpd), mark('flipEnds'), jr('flipDone'),
    here('plain'), mark('plainAt'), ld('a', BG_COLOURS[0]), mark('plainLow', HIGH), sth(IO.bcpd), ld('a', BG_COLOURS[1]), mark('plainHigh', HIGH), sth(IO.bcpd), mark('plainEnds'), jr('flipDone'),
    here('shadesFlip'), mark('shadesAt'), ldh(IO.bgp), CPL, mark('bgp', HIGH), sth(IO.bgp),
    here('flipDone'), mark('flipDone'),
  ]),
  mark('vblankEnds'), op(12, 0xC1), POP_HL, POP_AF, RETI, mark('vblankEnded'),
];

// Twice a picture, at the line LYC names. Each time it writes the scroll it was left, first thing. Two lines before
// the split that is the scroll the screen already has, and it leaves the split's for next time, switches the timer's
// interrupt off and names the split's line. At the split it switches the timer's back on and names the first line.
const stat = () => [
  here('stat'), mark('statAt'), lda(RAM.next), mark('split', HIGH), sth(IO.scx),
  lda(RAM.stage), or('a'), mark('stageAsked'), jrnz('second'),
  ld('a', 1), sta(RAM.stage), lda(RAM.split), sta(RAM.next),
  ld('a', 0x03), mark('timerOff', HIGH), sth(IO.ie), ld('a', START.splitAt), mark('lycSplit', HIGH), sth(IO.lyc), mark('firstEnds'), RETI,
  here('second'), mark('secondAt'), xor('a'), sta(RAM.stage),
  ld('a', 0x07), mark('timerBack', HIGH), sth(IO.ie), ld('a', START.lyc), mark('lycFirst', HIGH), sth(IO.lyc), mark('secondEnds'), RETI, mark('statEnded'),
];

// the timer: it counts, and while B is held it gives the second channel the next of four pitches
const timer = () => [
  here('timer'), mark('timerAt'), PUSH_AF, PUSH_HL, lda(RAM.ticks), inc('a'), sta(RAM.ticks),
  mark('timerAsked'), lda(RAM.buttons), and(0x02), jrz('quiet'),
  lda(RAM.ticks), and(3), mv('l', 'a'), ld('h', PITCHES_AT >> 8), LD_HL, mark('pitch', HIGH), sth(IO.nr23),
  here('quiet'), mark('timerEnds'), POP_HL, POP_AF, RETI, mark('timerEnded'),
];

// lays the code out at an address, in two rounds: the first finds where each name is. Returns its bytes, its names, and
// the cycles from each mark to the next, on the console `variant` says
function assemble(list, origin, variant, names = {}) {
  const times = {};
  let bytes = [];
  for (let round = 0; round < 2; round++) {
    bytes = [];
    let clock = 0, last = 0;
    const lay = (item, counted) => {
      if (Array.isArray(item)) return item.forEach(inner => lay(inner, counted));
      const at = origin + bytes.length;
      if (item.here) names[item.here] = at;
      else if (item.mark) {
        times[item.mark] = clock + item.plus - last;
        last = clock + item.plus;
      } else if (item.only) lay(item.body, counted && item.only(variant));
      else if (item.turns) {
        const before = clock;
        lay(item.body, counted);
        if (counted) clock += (item.turns - 1) * (clock - before + 4);
      } else if (item.lasts) clock += counted ? item.lasts : 0;
      else {
        if (item.to !== undefined) bytes.push(...item.b, ...word(typeof item.to === 'number' ? item.to : names[item.to] ?? 0));
        else if (item.near) bytes.push(...item.b, ((names[item.near] ?? at) - at - 2) & 255);
        else bytes.push(...item.b);
        if (counted) clock += item.takenOn?.(variant) ? item.t + 4 : item.t;
      }
      return undefined;
    };
    lay(list, true);
  }
  return { bytes, names, times };
}

/** What the program's Dreamport in C (made-up-gb.c) is filled in with: the cycles between its marks on that console, as
 *  T_ and the mark's name, and its numbers. `moved` is how far Right moves the sprite, 1 unless it's made wrong on purpose. */
export function numbersFor({ colour = false, moved = 1, playsFrom = 0 } = {}) {
  const { times } = madeUpGb({ colour });
  const numbers = {
    ...Object.fromEntries(Object.entries(times).map(([name, cycles]) => [`T_${name}`, cycles])),
    ...Object.fromEntries(Object.entries(RAM).map(([name, address]) => [name.toUpperCase(), address])),
    START_X: START.x, START_Y: START.y, START_OTHER_X: START.otherX, START_OTHER_Y: START.otherY, START_LYC: START.lyc, SPLIT_AT: START.splitAt, START_WY: START.wy, START_TMA: START.tma,
    START_BGP: START.bgp, START_OBP0: START.obp0, START_OBP1: START.obp1, LCDC, DMA_AT, DMA_SIZE: DMA.length, PITCHES_AT, BANKED_AT, TILES_SIZE: TILES.length * 16,
    FLIPPED_COLOUR, PLAIN_COLOUR: BG_COLOURS[0] | BG_COLOURS[1] << 8, PLAYS_FROM: playsFrom,
  };
  return { NUMBERS: Object.entries(numbers).map(([name, value]) => `#define ${name} ${value}`).join('\n'), MOVED: moved };
}

/**
 * The program as a copy of a Game Boy game, or with `colour` of a Game Boy Color one: { rom, sha1, at, times }. A cartridge of
 * four banks of 16 KB that switches them, with 8 KB of memory of its own and a battery: its code in the first bank, its
 * tiles in the third, and its colours and its wave in the fourth. `at` says where each of its routines is.
 */
export function madeUpGb({ colour = false } = {}) {
  const BANK = 0x4000, rom = Buffer.alloc(4 * BANK, 0xFF);
  const names = {};
  const { bytes, times } = assemble([reset(), vblank(), stat(), timer(), COPY, FILL], 0x150, { colour }, names);
  Buffer.from(bytes).copy(rom, 0x150);
  Buffer.from(PITCHES).copy(rom, PITCHES_AT);
  Buffer.from(DMA).copy(rom, DMA_AT);
  // the interrupts' three places, and where the console starts
  const jump = (at, to) => Buffer.from([0xC3, ...word(names[to])]).copy(rom, at);
  jump(0x40, 'vblank');
  jump(0x48, 'stat');
  jump(0x50, 'timer');
  Buffer.from([0x00, 0xC3, ...word(names.reset)]).copy(rom, 0x100);
  // its header: no logo, a name, whether it's for the Game Boy Color, its kind of cartridge and its sizes
  rom.fill(0, 0x104, 0x150);
  rom.write(colour ? 'MADEUP GBC' : 'MADEUP GB', 0x134, 'ascii');
  rom[0x143] = colour ? 0x80 : 0x00;
  rom[0x147] = 0x1B;
  rom[0x148] = 0x01;
  rom[0x149] = 0x02;
  rom[0x14A] = 0x01;
  rom[0x14D] = rom.subarray(0x134, 0x14D).reduce((sum, byte) => (sum - byte - 1) & 255, 0);
  Buffer.from(TILES.flat()).copy(rom, 2 * BANK);
  Buffer.from([...BG_COLOURS, ...SPRITE_COLOURS, ...WAVE]).copy(rom, 3 * BANK);
  BANKED.forEach((tile, bank) => { rom[bank * BANK + BANKED_AT] = tile; });
  const sum = rom.reduce((total, byte, at) => (at === 0x14E || at === 0x14F ? total : (total + byte) & 0xFFFF), 0);
  rom[0x14E] = sum >> 8;
  rom[0x14F] = sum & 255;
  return { rom, sha1: createHash('sha1').update(rom).digest('hex'), at: { ...names }, times };
}

/** A second program, for the tools that read a game's code and never run it (gb-functions.test.mjs): a 64 KB copy of
 *  four banks, with code in each, a bank switched in by a write and by a routine, a table a JP (HL) jumps through, and
 *  a list of addresses after an RST that a routine reads. Its bytes are written out, with nothing from any game. */
export function madeUpBanks() {
  const BANK = 0x4000, rom = Buffer.alloc(4 * BANK, 0xFF);
  const put = (address, bytes, bank = 0) => Buffer.from(bytes).copy(rom, bank ? bank * BANK + (address & 0x3FFF) : address);
  // RST $08: reads the list after it, POP HL, twice A added to it, the address there into HL, and JP (HL)
  put(0x0008, [0xE1, 0x87, 0x85, 0x6F, 0x30, 0x01, 0x24, 0x2A, 0x66, 0x6F, 0xE9]);
  // the V-blank interrupt jumps to its code, and the screen's other interrupt only returns
  put(0x0040, [0xC3, ...word(0x0240)]);
  put(0x0048, [0xD9]);
  put(0x0100, [0x00, 0xC3, ...word(0x0150)]);
  // where the game starts: bank 1 by a write, a call there, bank 2 by the routine at $0200, a call there, bank 3 by a
  // write, a call there, then a jump through the table at $0300
  put(0x0150, [0x3E, 0x01, 0xEA, ...word(0x2000), 0xCD, ...word(0x4000), 0x3E, 0x02, 0xCD, ...word(0x0200), 0xCD, ...word(0x4010),
    0x3E, 0x03, 0xEA, ...word(0x2000), 0xCD, ...word(0x4000),
    0x21, ...word(0x0300), 0xFA, ...word(0xC000), 0x87, 0x5F, 0x16, 0x00, 0x19, 0x2A, 0x66, 0x6F, 0xE9]);
  // switches to the bank in A
  put(0x0200, [0xEA, ...word(0x2100), 0xC9]);
  // the V-blank's code: an RST with its list after it
  put(0x0240, [0xCF, ...word(0x0340), ...word(0x0350)]);
  put(0x0300, [...word(0x0320), ...word(0x0330)]);
  // a call to $4020 with no bank known: only bank 3 has code there
  put(0x0320, [0xCD, ...word(0x4020), 0xC9]);
  for (const address of [0x0330, 0x0340, 0x0350]) put(address, [0xC9]);
  // code nothing leads to
  put(0x0360, [0xFA, ...word(0xC000), 0x3C, 0xC9]);
  // bank 1: a call inside its own bank
  put(0x4000, [0xCD, ...word(0x4008), 0xC9], 1);
  put(0x4008, [0xC9], 1);
  put(0x4010, [0x06, 0x01, 0xC9], 2);
  put(0x4000, [0xC9], 3);
  put(0x4020, [0x3E, 0x03, 0xC9], 3);
  rom.fill(0, 0x104, 0x150);
  rom.write('MADEUP BANKS', 0x134, 'ascii');
  rom[0x147] = 0x19;
  rom[0x148] = 0x01;
  rom[0x14D] = rom.subarray(0x134, 0x14D).reduce((sum, byte) => (sum - byte - 1) & 255, 0);
  return rom;
}

/** A third program, for the function check (../gbc/twin.mjs, gb-twin.mjs): a 64 KB copy of four banks with a few small
 *  functions, each written out here with what it does, and the twins of them in gb-twin/game.c. `TWIN` says where
 *  each is and what its tables hold. */
export const TWIN = {
  // adds A to the 16-bit number at $C020 and $C021, counts the call at $C022, and leaves the carry of the low byte's sum
  add: 0x0500,
  // the byte at $0600 + 4 * B of a table, to $C030 and in A: the processor's place in the table is 8 bits, so it wraps round at 256
  pick: 0x0520,
  // reads the hardware's $FF44 to $C031, writes A to $FF47, and leaves C one higher
  send: 0x0540,
  // the byte at $5000 + E of the bank that's switched in, to $C033
  look: 0x0560,
  // switches to the bank in A, and keeps its number at $C010
  switchTo: 0x0580,
  // zeros B bytes from HL, 256 for 0, and leaves HL after them
  clear: 0x05A0,
  // in bank 1: the byte at $5000 + D of its own bank, to $C032
  own: 0x4100,
  // the game keeps the bank it switched in at $C010
  bank: 0xC010,
  /** The byte at `at` of the table every bank has at $5000, and of the table at $0600. */
  inBank: (bank, at) => (at * 7 + bank * 31 + 5) & 0xFF,
  inTable: at => (at * 13 + 3) & 0xFF,
};
export function madeUpTwins() {
  const BANK = 0x4000, rom = Buffer.alloc(4 * BANK, 0xFF);
  const put = (address, bytes, bank = 0) => Buffer.from(bytes).copy(rom, bank ? bank * BANK + (address & 0x3FFF) : address);
  put(0x0100, [0x00, 0xC3, ...word(0x0150)]);
  // where the game starts: a call of each, bank 1 switched in for the one that's there, and then nothing for ever
  put(0x0150, [0xCD, ...word(TWIN.add), 0xCD, ...word(TWIN.pick), 0xCD, ...word(TWIN.send), 0xCD, ...word(TWIN.look), 0xCD, ...word(TWIN.switchTo), 0xCD, ...word(TWIN.clear),
    0x3E, 0x01, 0xEA, ...word(0x2000), 0xCD, ...word(TWIN.own), 0x18, 0xFE]);
  // LD HL,$C020, ADD A,(HL), LD (HL+),A, JR NC past the next, INC (HL), LD A,($C022), INC A, LD ($C022),A, RET
  put(TWIN.add, [0x21, ...word(0xC020), 0x86, 0x22, 0x30, 0x01, 0x34, 0xFA, ...word(0xC022), 0x3C, 0xEA, ...word(0xC022), 0xC9]);
  // LD A,B, ADD A,A, ADD A,A, LD L,A, LD H,$06, LD A,(HL), LD ($C030),A, RET
  put(TWIN.pick, [0x78, 0x87, 0x87, 0x6F, 0x26, 0x06, 0x7E, 0xEA, ...word(0xC030), 0xC9]);
  // PUSH AF, LDH A,($44), LD ($C031),A, POP AF, LDH ($47),A, INC C, RET
  put(TWIN.send, [0xF5, 0xF0, 0x44, 0xEA, ...word(0xC031), 0xF1, 0xE0, 0x47, 0x0C, 0xC9]);
  // LD H,$50, LD L,E, LD A,(HL), LD ($C033),A, RET
  put(TWIN.look, [0x26, 0x50, 0x6B, 0x7E, 0xEA, ...word(0xC033), 0xC9]);
  // LD ($C010),A, LD ($2000),A, RET
  put(TWIN.switchTo, [0xEA, ...word(TWIN.bank), 0xEA, ...word(0x2000), 0xC9]);
  // XOR A, LD (HL+),A, DEC B, JR NZ back to the store, RET
  put(TWIN.clear, [0xAF, 0x22, 0x05, 0x20, 0xFC, 0xC9]);
  // LD H,$50, LD L,D, LD A,(HL), LD ($C032),A, RET
  put(TWIN.own, [0x26, 0x50, 0x6A, 0x7E, 0xEA, ...word(0xC032), 0xC9], 1);
  put(0x0600, Array.from({ length: 0x100 }, (_, at) => TWIN.inTable(at)));
  // each bank's table at $5000: the first bank's is what the console sees there when the chip switches bank 0 in
  for (let bank = 0; bank < 4; bank++) Buffer.from(Array.from({ length: 0x100 }, (_, at) => TWIN.inBank(bank, at))).copy(rom, bank * BANK + 0x1000);
  rom.fill(0, 0x104, 0x150);
  rom.write('MADEUP TWINS', 0x134, 'ascii');
  rom[0x147] = 0x19;
  rom[0x148] = 0x01;
  rom[0x14A] = 0x01;
  rom[0x14D] = rom.subarray(0x134, 0x14D).reduce((sum, byte) => (sum - byte - 1) & 255, 0);
  return rom;
}

/** A fourth program, for the test of a game whose tasks are its parts (part-tasks/gb.mjs): it turns the screen off,
 *  fills the background with a tile striped in its first two shades, or on a Game Boy Color colours, and turns the
 *  screen on, and then only waits for the V-blank interrupt, whose code counts the pictures and scrolls the background
 *  as far, and from the PARTS.from'th picture on gives the background's shades from the count, or on a Game Boy Color
 *  its first colour. So it has two parts, the first with the stripes scrolling and the second with the shades given
 *  too, which the first never runs the function for. When the count comes round to 0, after 256 pictures, a fifth
 *  function gives the first shades back, which no part's 40 frames reach. `PARTS` says where each function is; their
 *  twins are in part-tasks/gb/twins.c. */
export const PARTS = { atVblank: 0x0040, start: 0x0100, vblank: 0x0200, tick: 0x0220, paint: 0x0240, secret: 0x0260, count: 0xC000, from: 50, shades: 0x03, dark: 0x0842, light: 0x5EF7, stripe: 0xF0 };
const jrc = near => ({ near, b: [0x38], t: 8 });
const callz = to => ({ to, b: [0xCC], t: 12 });
const RLCA = op(4, 0x07), INC_AT_HL = op(12, 0x34);
export function madeUpParts({ colour = false } = {}) {
  const rom = Buffer.alloc(0x8000, 0xFF), times = {};
  const lay = (address, list) => {
    const laid = assemble(list, address, { colour });
    Buffer.from(laid.bytes).copy(rom, address);
    Object.assign(times, laid.times);
  };
  lay(PARTS.atVblank, [jp(PARTS.vblank)]);
  lay(PARTS.start, [NOP, jp(0x0150)]);
  lay(0x0150, [
    DI, ldw('sp', 0xE000), xor('a'), mark('screenOff', HIGH), sth(IO.lcdc),
    ldw('hl', 0x9800), ldw('bc', 0x0400),
    here('clear'), turns(0x400, [xor('a'), STI, decw('bc'), mv('a', 'b'), or('c'), jrnz('clear')]),
    // the first tile: each row's first byte the stripe, its second 0, so its left half is the second shade
    ldw('hl', 0x8000), ld('b', 8),
    here('tile'), turns(8, [ld('a', PARTS.stripe), STI, xor('a'), STI, dec('b'), jrnz('tile')]),
    colour
      ? [ld('a', 0x80), mark('bcps', HIGH), sth(IO.bcps), ld('a', PARTS.dark & 255), mark('low', HIGH), sth(IO.bcpd), ld('a', PARTS.dark >> 8), mark('high', HIGH), sth(IO.bcpd),
        ld('a', PARTS.light & 255), mark('low1', HIGH), sth(IO.bcpd), ld('a', PARTS.light >> 8), mark('high1', HIGH), sth(IO.bcpd)]
      : [ld('a', PARTS.shades), mark('bgp', HIGH), sth(IO.bgp)],
    xor('a'), sta(PARTS.count), sth(IO.if),
    ld('a', 0x01), mark('ie', HIGH), sth(IO.ie),
    ld('a', 0x91), mark('screenOn', HIGH), sth(IO.lcdc),
    EI, mark('waits'),
    here('wait'), HALT, jr('wait'),
  ]);
  lay(PARTS.vblank, [call(PARTS.tick), lda(PARTS.count), cp(PARTS.from), jrc('skip'), call(PARTS.paint), here('skip'), lda(PARTS.count), or('a'), callz(PARTS.secret), RETI]);
  lay(PARTS.tick, [ldw('hl', PARTS.count), INC_AT_HL, LD_HL, sth(IO.scx), RET]);
  lay(PARTS.paint, colour
    ? [ld('a', 0x80), sth(IO.bcps), lda(PARTS.count), sth(IO.bcpd), sth(IO.bcpd), RET]
    : [lda(PARTS.count), RLCA, RLCA, sth(IO.bgp), RET]);
  lay(PARTS.secret, colour
    ? [ld('a', 0x80), sth(IO.bcps), ld('a', PARTS.dark & 255), sth(IO.bcpd), ld('a', PARTS.dark >> 8), sth(IO.bcpd), RET]
    : [ld('a', PARTS.shades), sth(IO.bgp), RET]);
  rom.fill(0, 0x104, 0x150);
  rom.write(colour ? 'PARTS GBC' : 'MADEUP PARTS', 0x134, 'ascii');
  rom[0x143] = colour ? 0x80 : 0x00;
  rom[0x147] = 0x00;
  rom[0x148] = 0x00;
  rom[0x14A] = 0x01;
  rom[0x14D] = rom.subarray(0x134, 0x14D).reduce((sum, byte) => (sum - byte - 1) & 255, 0);
  const numbers = { ...Object.fromEntries(Object.entries(times).map(([name, cycles]) => [`T_${name}`, cycles])), FROM: PARTS.from, START_SHADES: PARTS.shades, DARK: PARTS.dark, LIGHT: PARTS.light, STRIPE: PARTS.stripe, COUNT: PARTS.count, COLOUR: colour ? 1 : 0 };
  return { rom, sha1: createHash('sha1').update(rom).digest('hex'), times, NUMBERS: Object.entries(numbers).map(([name, value]) => `#define ${name} ${value}`).join('\n') };
}
