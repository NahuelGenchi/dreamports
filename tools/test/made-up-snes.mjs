// A small Super Nintendo cartridge with nothing from any game in it, written here, for the tools' tests of the Super
// Nintendo: 32 KB of LoROM with 2 KB of save memory, a header the console reads, and functions that each do one
// thing the tools have to see. Its instructions are written as their bytes, by the few lines below, so the tests need
// no assembler.
//
// Its functions, in order, from where its ROM is seen at $00:8000:
//   start      the console's start: into the processor's own mode, a stack, main, the interrupt at each frame's end,
//              and waits for ever
//   main       calls sum, fill, twice, lookup, leaves8 and pick, the first function in its table, through a pointer,
//              and hidden, through a pointer it makes in the work memory
//   sum        A + X, through the direct page, with A and X of 16 bits
//   fill       writes Y bytes of A, of 8 bits, from X in the data bank, in a loop
//   lookup     the Xth word of its table of values, read with a long address, called with JSL and back with RTL
//   twice      sum(A, A), through a call
//   leaves8    comes back with A of 8 bits, as a function can
//   forever    a loop that never ends
//   wait       waits for an interrupt
//   halt       stops the processor
//   hardware   turns the screen on, and multiplies 6 by 7 with the console's own unit
//   port       writes two bytes through the work memory's port
//   nowhere    reads where the console has nothing
//   romwrite   writes to the ROM
//   jumpout    jumps to the hardware's registers, where no code can be
//   bank       reads $1234 of the data bank
//   direct     reads $10 of the direct page
//   move       moves 4 bytes in the work memory with MVN
//   save       writes the save memory
//   tick       an interrupt's handler, back with RTI
//   pick       a switch on X, through a table of its cases, with JMP (table,X)
//   nmi        the interrupt at each frame's end
// and after the values:
//   shine      reached only through the table of functions
//   hidden     reached only through a pointer made as main runs, with A, X and Y of 8 bits, which only play finds

/** Where the ROM is seen, and the stack main is given. */
export const ORIGIN = 0x008000;
export const STACK = 0x1FFF;
export const SRAM = 2048;
export const VALUES = [0x1111, 0x2222, 0x3333, 0x4444];

// what needs to know where things are: a branch to a label, a 16-bit address of one, and a 24-bit one
const rel = label => ({ size: 1, at: (labels, pc) => [(labels[label] - (pc + 1)) & 0xFF] });
const abs = label => ({ size: 2, at: labels => [labels[label] & 0xFF, (labels[label] >> 8) & 0xFF] });
const long = label => ({ size: 3, at: labels => [labels[label] & 0xFF, (labels[label] >> 8) & 0xFF, (labels[label] >> 16) & 0xFF] });
const here = name => ({ name });
const low = label => ({ size: 1, at: labels => [labels[label] & 0xFF] });
const high = label => ({ size: 1, at: labels => [(labels[label] >> 8) & 0xFF] });
const w = n => [n & 0xFF, (n >> 8) & 0xFF];
const l = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF];

const PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x38, 0xA2, ...w(STACK), 0x9A, 0x22, long('main'),
  0xE2, 0x20, 0xA9, 0x81, 0x8D, ...w(0x4200), 0xC2, 0x20, here('spin'), 0x80, rel('spin'),
  // main, with A, X and Y of 16 bits
  here('main'), 0xA9, ...w(2), 0xA2, ...w(3), 0x20, abs('sum'),
  0xE2, 0x20, 0xA9, 0x5A, 0xA2, ...w(0x0200), 0xA0, ...w(4), 0x20, abs('fill'), 0xC2, 0x20,
  0xA9, ...w(21), 0x20, abs('twice'), 0xA2, ...w(1), 0x22, long('lookup'),
  0xA2, ...w(0), 0xFC, abs('functions'), 0x20, abs('leaves8'), 0xC2, 0x20, 0xA2, ...w(4), 0x20, abs('pick'),
  0xE2, 0x30, 0xA9, low('hidden'), 0x85, 0x10, 0xA9, high('hidden'), 0x85, 0x11, 0xA2, 0x00, 0xFC, ...w(0x0010), 0xC2, 0x30, 0x6B,
  here('sum'), 0x86, 0x00, 0x18, 0x65, 0x00, 0x60,
  here('fill'), here('fill_loop'), 0xC0, ...w(0), 0xF0, rel('fill_done'), 0x9D, ...w(0), 0xE8, 0x88, 0x80, rel('fill_loop'), here('fill_done'), 0x60,
  here('lookup'), 0x8A, 0x0A, 0xAA, 0xBF, long('values'), 0x6B,
  here('twice'), 0xAA, 0x20, abs('sum'), 0x60,
  here('leaves8'), 0xE2, 0x20, 0x60,
  here('forever'), 0x80, rel('forever'),
  here('wait'), 0xCB, 0x60,
  here('halt'), 0xDB,
  here('hardware'), 0xA9, 0x0F, 0x8D, ...w(0x2100), 0xA9, 0x06, 0x8D, ...w(0x4202), 0xA9, 0x07, 0x8D, ...w(0x4203), 0xEA, 0xEA, 0xEA, 0xEA, 0xAD, ...w(0x4216), 0x60,
  here('port'), 0xA9, 0x00, 0x8D, ...w(0x2181), 0xA9, 0x01, 0x8D, ...w(0x2182), 0x9C, ...w(0x2183), 0xA9, 0xAB, 0x8D, ...w(0x2180), 0x8D, ...w(0x2180), 0x60,
  here('nowhere'), 0xAD, ...w(0x2200), 0x60,
  here('romwrite'), 0x8D, ...w(0x8000), 0x60,
  here('jumpout'), 0x4C, ...w(0x2100),
  here('bank'), 0xAD, ...w(0x1234), 0x60,
  here('direct'), 0xA5, 0x10, 0x60,
  here('move'), 0xA9, ...w(3), 0xA2, ...w(0x2000), 0xA0, ...w(0x3000), 0x54, 0x7E, 0x7E, 0x60,
  here('save'), 0xA9, 0x5A, 0x8F, ...l(0x700010), 0x60,
  here('tick'), 0xE6, 0x20, 0x40,
  here('pick'), 0x7C, abs('cases'),
  here('pick_0'), 0xA9, ...w(10), 0x60,
  here('pick_1'), 0xA9, ...w(20), 0x60,
  here('pick_2'), 0xA9, ...w(30), 0x60,
  here('nmi'), 0x08, 0xE2, 0x20, 0xAD, ...w(0x4210), 0xEE, ...w(0x0030), 0x28, 0x40,
  here('values'), ...VALUES.flatMap(w),
  here('functions'), abs('shine'), abs('sum'),
  here('cases'), abs('pick_0'), abs('pick_1'), abs('pick_2'),
  here('shine'), 0xA9, ...w(1), 0x60,
  here('hidden'), 0xA9, 0x12, 0x8D, ...w(0x0400), 0x60,
];

// the functions, by where each starts and ends: the values and tables between pick_2 and shine aren't any
/**
 * A program's 32 KB of LoROM, seen at $00:8000, with its header: { rom, labels, end }. `program` is its pieces: bytes,
 * names where they are, and what needs to know where things are; `title` its name, `sram` whether it has 2 KB of save
 * memory with a battery, and `nmi` and `irq` the names of the native mode's two interrupts' handlers. Every other
 * vector is its start.
 */
function assemble(program, { title, sram = false, nmi = 'start', irq = 'start' }) {
  const labels = {};
  let pc = ORIGIN;
  for (const piece of program) {
    if (typeof piece === 'number') pc++;
    else if (piece.name) labels[piece.name] = pc;
    else pc += piece.size;
  }
  const end = pc;
  const rom = new Uint8Array(0x8000);
  pc = ORIGIN;
  for (const piece of program) {
    if (typeof piece === 'number') rom[pc++ - ORIGIN] = piece;
    else if (!piece.name) for (const byte of piece.at(labels, pc)) rom[pc++ - ORIGIN] = byte;
  }
  // the header, at $FFC0 of bank $00: a title, LoROM, ROM, with save memory and a battery or not, 32 KB of ROM and 2 KB
  // of save memory or none, and the vectors
  const header = 0x7FC0;
  rom.set([...title.padEnd(21)].map(c => c.charCodeAt(0)), header);
  rom[header + 0x15] = 0x20;
  rom[header + 0x16] = sram ? 0x02 : 0x00;
  rom[header + 0x17] = 0x05;
  rom[header + 0x18] = sram ? 0x01 : 0x00;
  for (let v = 0x24; v < 0x40; v += 2) rom.set(w(labels.start), header + v);
  rom.set(w(labels[nmi]), header + 0x2A);
  rom.set(w(labels[irq]), header + 0x2E);
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom, labels, end };
}

/** The program a made-up cartridge gives the sound processor, and where it runs: a value to the first port, a call
 *  that adds one, and a loop that never ends. */
export const SOUND_AT = 0x0400;
export const SOUND_PROGRAM = [0xE8, 0x12, 0xC4, 0xF4, 0xCD, 0x34, 0x3F, 0x0B, 0x04, 0x2F, 0xFE, 0xBC, 0x6F];

// the 65816's side: the sound processor's start-up program, in its own ROM, waits for $AA and $BB on the first two
// ports; then the address to $2142, a 1 to $2141 and $CC to $2140, and each byte to $2141 with its count to $2140,
// each once the sound processor has said the count back; and last the address to run, a 0 to $2141 and the count two
// past the last, which sends the sound processor there. With A of 8 bits and X and Y of 16
const UPLOADER = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A,
  here('ready'), 0xAE, ...w(0x2140), 0xE0, ...w(0xBBAA), 0xD0, rel('ready'),
  0xA2, ...w(SOUND_AT), 0x8E, ...w(0x2142), 0xA9, 0x01, 0x8D, ...w(0x2141), 0xA9, 0xCC, 0x8D, ...w(0x2140),
  here('begun'), 0xCD, ...w(0x2140), 0xD0, rel('begun'),
  0xA0, ...w(0),
  here('send'), 0xB9, abs('program'), 0x8D, ...w(0x2141), 0x98, 0x8D, ...w(0x2140),
  here('said'), 0xCD, ...w(0x2140), 0xD0, rel('said'), 0xC8, 0xC0, ...w(SOUND_PROGRAM.length), 0xD0, rel('send'),
  0xA2, ...w(SOUND_AT), 0x8E, ...w(0x2142), 0x9C, ...w(0x2141), 0x98, 0x1A, 0x8D, ...w(0x2140),
  here('spin'), 0x80, rel('spin'),
  here('program'), ...SOUND_PROGRAM,
];

/** A second made-up cartridge, which gives the sound processor its program as games do: { rom, labels }. */
export function madeUpSoundCartridge() {
  const { rom, labels } = assemble(UPLOADER, { title: 'DREAMPORTS SOUND' });
  return { rom, labels };
}

const FUNCTIONS = ['start', 'main', 'sum', 'fill', 'lookup', 'twice', 'leaves8', 'forever', 'wait', 'halt', 'hardware', 'port', 'nowhere', 'romwrite', 'jumpout', 'bank', 'direct', 'move', 'save', 'tick', 'pick', 'nmi', 'shine', 'hidden'];
const ENDS = { pick: 'nmi', nmi: 'values' };

/**
 * The made-up cartridge: { rom, labels, functions }, `rom` 32 KB with its header, `labels` each name's address as the
 * console sees it, and `functions` each of the list above, { name, address, size }.
 */
export function madeUpCartridge() {
  const { rom, labels, end } = assemble(PROGRAM, { title: 'DREAMPORTS MADE UP', sram: true, nmi: 'nmi', irq: 'tick' });
  const functions = FUNCTIONS.map((name, i) => {
    const next = name in ENDS ? ENDS[name] : FUNCTIONS[i + 1];
    return { name, address: labels[name], size: (next ? labels[next] : end) - labels[name] };
  });
  return { rom, labels, functions };
}

// The parts program, for the test of a game whose tasks are its parts (snes-parts.mjs): a start that turns the screen
// on, with no layer on it, and lets the V-blank's interrupt in, and that interrupt's handler, which reads $4210, calls
// count, which adds one to the frame's count, a word at $00 of the direct page, and then red while the count is under
// 60 and blue from then on. Each gives colour 0, the backdrop, a level from the count's low five bits: red in the
// colour's low byte, blue in its high one. With A of 8 bits and X and Y of 16
const PARTS_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  0xA9, 0x0F, 0x8D, ...w(0x2100), 0xA9, 0x80, 0x8D, ...w(0x4200),
  here('spin'), 0x80, rel('spin'),
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210), 0x20, abs('count'), 0xA5, 0x00, 0xC9, 60, 0xB0, rel('later'), 0x20, abs('red'), 0x40,
  here('later'), 0x20, abs('blue'), 0x40,
  here('count'), 0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x60,
  here('red'), 0xA5, 0x00, 0x29, 0x1F, 0x9C, ...w(0x2121), 0x8D, ...w(0x2122), 0x9C, ...w(0x2122), 0x60,
  here('blue'), 0xA5, 0x00, 0x29, 0x1F, 0x0A, 0x0A, 0x9C, ...w(0x2121), 0x9C, ...w(0x2122), 0x8D, ...w(0x2122), 0x60,
];

/** The parts program's cartridge: { rom, labels }, `labels` the address of start, nmi, count, red and blue. */
export function madeUpPartsCartridge() {
  const { rom, labels } = assemble(PARTS_PROGRAM, { title: 'DREAMPORTS PARTS', nmi: 'nmi' });
  return { rom, labels };
}

// The picture program, for the kit's test (snes-kit.mjs): it fills video memory, the colours and two backgrounds'
// maps by DMA, with the screen off, and then at each frame's V-blank scrolls the two backgrounds, the first across
// and down, the third the other way, and sets the screen's brightness, which steps down from 15 to 0 every 8 frames.
// Mode 1: the first background of 4-bit tiles, 8 by 8, the third of 2-bit tiles, in front at its high priority.
export const PICTURE = { TILES: 0x8400, TILES_BYTES: 32 * 16, SMALL: 0x8600, SMALL_BYTES: 16 * 8, MAP: 0x8800, SMALL_MAP: 0x9000, PALETTE: 0x9800 };
const pictureData = () => {
  // 16 tiles of 4 bits, each a pattern of its own, as planes: rows 0-7 of planes 0 and 1, then of 2 and 3
  const tiles = [];
  for (let t = 0; t < 16; t++) {
    const pixel = (x, y) => ((x * (t + 1) + y * (t >> 1) + t) ^ (y << 1)) & 15;
    const planes = (p, y) => Array.from({ length: 8 }, (_, x) => (pixel(x, y) >> p & 1) << (7 - x)).reduce((a, b) => a | b, 0);
    for (let y = 0; y < 8; y++) tiles.push(planes(0, y), planes(1, y));
    for (let y = 0; y < 8; y++) tiles.push(planes(2, y), planes(3, y));
  }
  // 8 tiles of 2 bits for the third background, with gaps it shows the first through
  const small = [];
  for (let t = 0; t < 8; t++) {
    const pixel = (x, y) => ((x + t) % 4 === 0 || (y + t) % 5 === 0 ? 1 + ((x + y + t) % 3) : 0);
    for (let y = 0; y < 8; y++) {
      small.push(Array.from({ length: 8 }, (_, x) => (pixel(x, y) & 1) << (7 - x)).reduce((a, b) => a | b, 0));
      small.push(Array.from({ length: 8 }, (_, x) => (pixel(x, y) >> 1 & 1) << (7 - x)).reduce((a, b) => a | b, 0));
    }
  }
  // each map's 32 by 32 entries: a tile, a palette, a priority and its flips
  const entry = (tile, palette, priority, h, v) => tile | palette << 10 | priority << 13 | h << 14 | v << 15;
  const map = [], smallMap = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      map.push(...w(entry((x + y * 3) & 15, (x >> 2) & 7, (y >> 3) & 1, x & 1, (y >> 1) & 1)));
      smallMap.push(...w(entry((x * 5 + y) & 7, (y >> 2) & 7, (x >> 3) & 1, y & 1, x & 1)));
    }
  }
  // 256 colours of 15 bits
  const palette = Array.from({ length: 256 }, (_, i) => (i === 0 ? 0x1084 : (i * 0x0A3B + 0x1234) & 0x7FFF)).flatMap(w);
  return { tiles, small, map, smallMap, palette };
};

// a DMA of `bytes` from `from`, in bank $00, on channel 0, with $4300 `mode` and $4301 `to`; A of 8 bits, X of 16
const dma = (mode, to, from, bytes) => [0xA9, mode, 0x8D, ...w(0x4300), 0xA9, to, 0x8D, ...w(0x4301), 0xA2, ...w(from), 0x8E, ...w(0x4302), 0x9C, ...w(0x4304), 0xA2, ...w(bytes), 0x8E, ...w(0x4305), 0xA9, 0x01, 0x8D, ...w(0x420B)];
const store = (value, at) => [0xA9, value, 0x8D, ...w(at)];

const PICTURE_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  // the tiles at word $0000, the small ones at $1000, the maps at $0400 and $0C00
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, PICTURE.TILES, PICTURE.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, PICTURE.SMALL, PICTURE.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, PICTURE.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, PICTURE.SMALL_MAP, 0x800),
  // every colour
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, PICTURE.PALETTE, 0x200),
  // mode 1 with the third background in front, its maps and tiles, and the main screen showing both
  ...store(0x09, 0x2105), ...store(0x04, 0x2107), ...store(0x0C, 0x2109), ...store(0x00, 0x210B), ...store(0x01, 0x210C), ...store(0x05, 0x212C),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the scroll from the frame's count, the brightness, and the count moved on
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xA5, 0x00, 0x8D, ...w(0x210D), 0xA5, 0x01, 0x8D, ...w(0x210D),
  0xA5, 0x00, 0x4A, 0x8D, ...w(0x210E), 0x9C, ...w(0x210E),
  0xA5, 0x00, 0x49, 0xFF, 0x8D, ...w(0x2111), 0xA9, 0x03, 0x8D, ...w(0x2111),
  0xA5, 0x00, 0x0A, 0x8D, ...w(0x2112), 0x9C, ...w(0x2112),
  0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x29, 0x0F, 0x49, 0x0F, 0x8D, ...w(0x2100),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The picture program's cartridge: { rom }, with its data where PICTURE says. */
export function madeUpPictureCartridge() {
  const { rom } = assemble(PICTURE_PROGRAM, { title: 'DREAMPORTS PICTURE', nmi: 'nmi' });
  const { tiles, small, map, smallMap, palette } = pictureData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(PICTURE.TILES));
  rom.set(small, at(PICTURE.SMALL));
  rom.set(map, at(PICTURE.MAP));
  rom.set(smallMap, at(PICTURE.SMALL_MAP));
  rom.set(palette, at(PICTURE.PALETTE));
  // the checksum again, over the data
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The sprite program, for the kit's test too: 128 sprites from a table of the project's own, with tiles in both of
// their tables, every size $2101 can choose in turn every 16 frames and its second table's gap every 128, flips, the
// four priorities between the first background's two, more than 32 sprites on some lines and more than 34 of their
// tiles on others; and at each V-blank the first 8 moved, their high bits and sizes changed, the background scrolled,
// and every 64 frames the sprites' first moved by $2103's priority bit, from an odd address in the frames between.
export const SPRITES = { TILES: 0x8400, TILES_BYTES: 0x800, BG_TILES: 0x8C00, MAP: 0x8E00, PALETTE: 0x9600, OAM: 0x9800 };
const spriteData = () => {
  const { tiles: bgTiles, map: bgMap, palette } = pictureData();
  const tiles = [];
  for (let t = 0; t < 64; t++) {
    const pixel = (x, y) => ((x === 0 || y === 0 || x === 7 || y === 7) ? 1 + (t & 7) : (x * y + t) % 3 === 0 ? 0 : 8 + ((x + y + t) & 7));
    const planes = (p, y) => Array.from({ length: 8 }, (_, x) => (pixel(x, y) >> p & 1) << (7 - x)).reduce((a, b) => a | b, 0);
    for (let y = 0; y < 8; y++) tiles.push(planes(0, y), planes(1, y));
    for (let y = 0; y < 8; y++) tiles.push(planes(2, y), planes(3, y));
  }
  const oam = new Uint8Array(544);
  for (let s = 0; s < 128; s++) {
    let x, y;
    if (s < 8) [x, y] = [s * 30, 20 + s * 10];
    else if (s < 48) [x, y] = [(s * 7) & 0xFF, 100 + (s & 3)];
    else if (s < 64) [x, y] = [(s * 37) & 0x1FF, 150];
    else [x, y] = [(s * 53) & 0x1FF, (s * 29) & 0xFF];
    oam[s * 4] = x & 0xFF;
    oam[s * 4 + 1] = y;
    oam[s * 4 + 2] = (s * 5) & 0xFF;
    oam[s * 4 + 3] = (s & 1) | (s % 8) << 1 | (s >> 3 & 3) << 4 | (s >> 1 & 1) << 6 | (s >> 2 & 1) << 7;
    oam[0x200 + (s >> 2)] |= ((x >> 8 & 1) | (s >> 4 & 1) << 1) << ((s & 3) * 2);
  }
  return { tiles, bgTiles: bgTiles.slice(0, 512), bgMap, palette, oam: [...oam] };
};

const SPRITE_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200), ...store(0x80, 0x2115),
  // the 64 sprite tiles again and again, to fill both of their tables from word $0000 to $2FFF
  ...Array.from({ length: 12 }, (_, i) => [0xA2, ...w(i * 0x400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, SPRITES.TILES, SPRITES.TILES_BYTES)]).flat(),
  // the background's tiles at word $4000 and its map at $3C00, every colour, and the sprites' table
  0xA2, ...w(0x4000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, SPRITES.BG_TILES, 0x200),
  0xA2, ...w(0x3C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, SPRITES.MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, SPRITES.PALETTE, 0x200),
  0x9C, ...w(0x2102), 0x9C, ...w(0x2103), ...dma(0x00, 0x04, SPRITES.OAM, 544),
  ...store(0x01, 0x2105), ...store(0x3C, 0x2107), ...store(0x04, 0x210B), ...store(0x11, 0x212C),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  // $2101: the sizes from bits 4 to 6 of the frame's count, the second table's gap from bit 7
  0xA5, 0x00, 0x29, 0x70, 0x0A, 0x85, 0x02, 0xA5, 0x00, 0x29, 0x80, 0x4A, 0x4A, 0x4A, 0x4A, 0x05, 0x02, 0x8D, ...w(0x2101),
  // the first 8 sprites: x, y, tile and attributes, from the count
  0x9C, ...w(0x2102), 0x9C, ...w(0x2103), 0xA2, ...w(0x0000),
  here('move'), 0x8A, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 0x00, 0x8D, ...w(0x2104),
  0x8A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 0x00, 0x4A, 0x8D, ...w(0x2104),
  0x8A, 0x18, 0x65, 0x00, 0x8D, ...w(0x2104), 0x8A, 0x45, 0x00, 0x8D, ...w(0x2104),
  0xE8, 0xE0, ...w(8), 0xD0, rel('move'),
  // their high bits and sizes, two bytes of the high table
  ...store(0x00, 0x2102), ...store(0x01, 0x2103), 0xA5, 0x00, 0x8D, ...w(0x2104), 0x49, 0xFF, 0x8D, ...w(0x2104),
  // every 64 frames the first sprite by $2103's priority bit, half of those from an odd address with a byte written
  0xA5, 0x00, 0x29, 0x40, 0xF0, rel('plain'),
  0xA5, 0x00, 0x0A, 0x8D, ...w(0x2102), 0xA9, 0x80, 0x8D, ...w(0x2103),
  0xA5, 0x00, 0x29, 0x20, 0xF0, rel('scroll'),
  0xA5, 0x00, 0x0A, 0x09, 0x01, 0x8D, ...w(0x2102), 0xA9, 0x80, 0x8D, ...w(0x2103), 0x9C, ...w(0x2104),
  0x80, rel('scroll'),
  here('plain'), 0x9C, ...w(0x2102), 0x9C, ...w(0x2103),
  here('scroll'), 0xA5, 0x00, 0x8D, ...w(0x210D), 0xA5, 0x01, 0x8D, ...w(0x210D), 0xA5, 0x00, 0x8D, ...w(0x210E), 0x9C, ...w(0x210E),
  ...store(0x0F, 0x2100),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The sprite program's cartridge: { rom }, with its data where SPRITES says. */
export function madeUpSpriteCartridge() {
  const { rom } = assemble(SPRITE_PROGRAM, { title: 'DREAMPORTS SPRITES', nmi: 'nmi' });
  const { tiles, bgTiles, bgMap, palette, oam } = spriteData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(SPRITES.TILES));
  rom.set(bgTiles, at(SPRITES.BG_TILES));
  rom.set(bgMap, at(SPRITES.MAP));
  rom.set(palette, at(SPRITES.PALETTE));
  rom.set(oam, at(SPRITES.OAM));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The music program, for the kit's test of the sound side: the main program sends the sound processor a program of
// the project's own, with a table for the sound chip and two samples, through the console's start-up program, waits
// for its first answer, and then gives it the frame's count on the first port at each V-blank. The sound program sets the sound chip from its
// table: a square wave on voice 0, loud, through an envelope of attack, decay and sustain; a ramp of three blocks, each
// with another of BRR's filters, on voice 1, low, its pitch bent by voice 0's output, through GAIN's two-slope rise, and
// into the echo, which is most of what's heard of it, with its filter of eight steps and its feedback; and noise on
// voice 2, high and quiet. So each voice is most of what's heard in pitches of its own. Then at each count of its first timer,
// every 4 ms, it sets voice 0's pitch from the main program's count, the noise's rate from its own, which writes the
// echo too, keys voice 0 off at the 32nd count of every 64 and on again at the 64th, and says its count on the second
// port.
const spcLayout = (program, origin) => {
  const labels = {};
  let pc = origin;
  for (const piece of program) {
    if (typeof piece === 'number') pc++;
    else if (piece.name) labels[piece.name] = pc;
    else pc += piece.size;
  }
  const bytes = [];
  pc = origin;
  for (const piece of program) {
    if (typeof piece === 'number') bytes.push(piece), pc++;
    else if (!piece.name) for (const byte of piece.at(labels, pc)) bytes.push(byte), pc++;
  }
  return { bytes, labels };
};
// the sound chip's registers as the table sets them, each a register and its value, and the end, a byte with its top
// bit set
const DSP_TABLE = [
  [0x6C, 0x20], [0x0C, 0x30], [0x1C, 0x28], [0x2C, 0x7F], [0x3C, 0x70], [0x5D, 0x02], [0x6D, 0x80], [0x7D, 0x02], [0x0D, 0x50],
  [0x0F, 0x40], [0x1F, 0x20], [0x2F, 0x10], [0x3F, 0x08], [0x4F, 0x04], [0x5F, 0x02], [0x6F, 0x01], [0x7F, 0x00],
  [0x4D, 0x02], [0x2D, 0x02], [0x3D, 0x04],
  [0x00, 0x7F], [0x01, 0x70], [0x02, 0x00], [0x03, 0x08], [0x04, 0x00], [0x05, 0x9A], [0x06, 0xA9], [0x07, 0x00],
  [0x10, 0x40], [0x11, 0x48], [0x12, 0x80], [0x13, 0x00], [0x14, 0x01], [0x15, 0x00], [0x16, 0x00], [0x17, 0xE8],
  [0x20, 0x50], [0x21, 0x50], [0x22, 0x00], [0x23, 0x10], [0x24, 0x00], [0x25, 0x00], [0x26, 0x00], [0x27, 0x50],
  [0x5C, 0x00], [0x4C, 0x07],
].flat();
const SOUND_START = 0x0200;
const SOUND_PROGRAM_BYTES = spcLayout([
  // the samples' directory, at the page the table gives the sound chip: each sample's start and where it loops
  here('directory'), abs('square'), abs('square'), abs('ramp'), abs('loop'),
  // a square wave, two blocks of 16 samples, looping
  here('square'), 0xB0, ...Array(8).fill(0x55), 0xB3, ...Array(8).fill(0xBB),
  // a ramp, three blocks with filters 1, 2 and 3, looping from the second
  here('ramp'), 0x94, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
  here('loop'), 0x98, 0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10, 0x9F, 0x11, 0x22, 0x33, 0x44, 0xCC, 0xDD, 0xEE, 0xFF,
  here('table'), ...DSP_TABLE, 0xFF,
  // the program: the table into the sound chip, through $F2 and $F3
  here('init'), 0xCD, 0x00,
  here('next'), 0xF5, abs('table'), 0x30, rel('done'), 0xC4, 0xF2, 0x3D, 0xF5, abs('table'), 0xC4, 0xF3, 0x3D, 0x2F, rel('next'),
  // the first timer every 32 steps of 8 kHz
  here('done'), 0x8F, 0x20, 0xFA, 0x8F, 0x01, 0xF1,
  // each count: the count at $10 on by one, voice 0's pitch from the main program's count
  here('tick'), 0xE4, 0xFD, 0xF0, rel('tick'), 0xAB, 0x10,
  0xE4, 0xF4, 0x5C, 0x5C, 0x5C, 0x5C, 0x08, 0x08, 0x8F, 0x03, 0xF2, 0xC4, 0xF3,
  // the noise's rate from its own count, with the echo written
  0xE4, 0x10, 0x5C, 0x28, 0x1F, 0x08, 0x1C, 0x8F, 0x6C, 0xF2, 0xC4, 0xF3,
  // voice 0 keyed on again at every 64th count, and off at the 32nd between
  0xE4, 0x10, 0x28, 0x3F, 0xD0, rel('off'), 0x8F, 0x5C, 0xF2, 0x8F, 0x00, 0xF3, 0x8F, 0x4C, 0xF2, 0x8F, 0x01, 0xF3,
  here('off'), 0x68, 0x20, 0xD0, rel('say'), 0x8F, 0x5C, 0xF2, 0x8F, 0x01, 0xF3,
  // its count on the second port
  here('say'), 0xFA, 0x10, 0xF5, 0x2F, rel('tick'),
], SOUND_START);

const MUSIC_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00,
  // the backdrop's colour, and the screen on
  ...store(0x00, 0x2121), ...store(0x6B, 0x2122), ...store(0x2D, 0x2122), ...store(0x0F, 0x2100),
  // the sound processor's program and what it plays, sent as the console's start-up program takes them
  here('ready'), 0xAE, ...w(0x2140), 0xE0, ...w(0xBBAA), 0xD0, rel('ready'),
  0xA2, ...w(SOUND_START), 0x8E, ...w(0x2142), 0xA9, 0x01, 0x8D, ...w(0x2141), 0xA9, 0xCC, 0x8D, ...w(0x2140),
  here('begun'), 0xCD, ...w(0x2140), 0xD0, rel('begun'),
  0xA0, ...w(0),
  here('send'), 0xB9, abs('sound'), 0x8D, ...w(0x2141), 0x98, 0x8D, ...w(0x2140),
  here('said'), 0xCD, ...w(0x2140), 0xD0, rel('said'), 0xC8, 0xC0, ...w(SOUND_PROGRAM_BYTES.bytes.length), 0xD0, rel('send'),
  0xA2, ...w(SOUND_PROGRAM_BYTES.labels.init), 0x8E, ...w(0x2142), 0x9C, ...w(0x2141), 0x98, 0x1A, 0x8D, ...w(0x2140),
  // and waits for its first answer, its count on the second port, where the start-up program left $BB, reading both
  // ports as a word
  here('answer'), 0xC2, 0x20, 0xAD, ...w(0x2140), 0x29, ...w(0xFF00), 0xC9, ...w(0xBB00), 0xE2, 0x20, 0xF0, rel('answer'),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the frame's count to the first port, and on by one
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210), 0xA5, 0x00, 0x8D, ...w(0x2140), 0xE6, 0x00, 0x40,
  here('sound'), ...SOUND_PROGRAM_BYTES.bytes,
];
const music = assemble(MUSIC_PROGRAM, { title: 'DREAMPORTS MUSIC', nmi: 'nmi' });

/** Where the music program keeps what its Dreamport needs: the sound processor's program in the ROM and how long it
 *  is, where it goes and where it starts in the sound processor's memory, and where the sound chip's table is there. */
export const MUSIC = {
  SOUND: music.labels.sound, SOUND_BYTES: SOUND_PROGRAM_BYTES.bytes.length, SOUND_START,
  SOUND_INIT: SOUND_PROGRAM_BYTES.labels.init, TABLE: SOUND_PROGRAM_BYTES.labels.table,
};

/** The music program's cartridge: { rom }. */
export function madeUpMusicCartridge() {
  return { rom: music.rom };
}

// The colour program, for the kit's test of windows and colour maths: the picture program's backgrounds, BG2 too, and
// 40 small sprites, two of each palette, and at each V-blank the two windows moved, the fixed colour changed, the
// backgrounds scrolled, and every 16 frames another of 16 settings of the windows, the screens and the maths: none;
// adding the fixed colour; adding, halving and taking away the sub screen or the fixed colour; windows hiding layers
// on the main screen and the sub screen, alone and combined; the colour window turning the screen black and keeping
// maths off, inside and outside; and adding at brightnesses below 15.
export const COLOUR = { ...PICTURE, OAM: 0x9A00, SETTINGS: 0x9C40 };
// each setting's registers, in the order the program writes them
export const COLOUR_REGISTERS = [0x2123, 0x2124, 0x2125, 0x212A, 0x212B, 0x212C, 0x212D, 0x212E, 0x212F, 0x2130, 0x2131, 0x2100];
const COLOUR_SETTINGS = [
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x02, 0x00, 0x00, 0x00, 0x21, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x02, 0x00, 0x00, 0x02, 0x31, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x12, 0x00, 0x00, 0x02, 0x71, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x02, 0x00, 0x00, 0x02, 0xB1, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x12, 0x00, 0x00, 0x02, 0xF1, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x00, 0xA3, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x00, 0xE3, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x00, 0x63, 0x0F],
  [0xC2, 0x00, 0x00, 0x00, 0x00, 0x15, 0x02, 0x01, 0x02, 0x02, 0x31, 0x0F],
  [0x00, 0x00, 0xA0, 0x00, 0x00, 0x15, 0x02, 0x00, 0x00, 0x92, 0x31, 0x0F],
  [0x00, 0x00, 0xA0, 0x00, 0x08, 0x17, 0x02, 0x00, 0x00, 0x62, 0x73, 0x0F],
  [0x00, 0x08, 0x03, 0x20, 0x00, 0x15, 0x00, 0x14, 0x00, 0x00, 0x70, 0x0F],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x02, 0x00, 0x00, 0x02, 0x31, 0x0B],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x15, 0x12, 0x00, 0x00, 0x02, 0x73, 0x07],
  [0x0A, 0x00, 0xB0, 0x01, 0x0C, 0x15, 0x02, 0x01, 0x00, 0xC2, 0x3F, 0x0F],
];
const colourOam = () => {
  const oam = new Uint8Array(544);
  for (let i = 0; i < 128; i++) {
    const shown = i < 40;
    oam.set([(i * 6 + 3) & 0xFF, shown ? 20 + (i % 10) * 18 : 240, i & 15, ((i & 7) << 1) | ((i >> 3 & 3) << 4)], i * 4);
  }
  return oam;
};
const COLOUR_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, COLOUR.TILES, COLOUR.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, COLOUR.SMALL, COLOUR.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, COLOUR.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, COLOUR.SMALL_MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, COLOUR.PALETTE, 0x200),
  // the sprites' table, through its port
  0x9C, ...w(0x2102), 0x9C, ...w(0x2103), ...dma(0x00, 0x04, COLOUR.OAM, 544),
  // mode 1 with the third background in front, BG1 and BG2 on one map, BG3 on its own, small sprites of 8 pixels
  ...store(0x09, 0x2105), ...store(0x04, 0x2107), ...store(0x04, 0x2108), ...store(0x0C, 0x2109), ...store(0x00, 0x210B), ...store(0x01, 0x210C), ...store(0x00, 0x2101),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the setting for the frame's count over 16, its 12 registers
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x4A, 0x29, ...w(0x000F), 0x0A, 0x0A, 0x85, 0x04, 0x0A, 0x18, 0x65, 0x04, 0xAA, 0xE2, 0x20,
  ...COLOUR_REGISTERS.flatMap((register, i) => [0xBD, ...w(COLOUR.SETTINGS + i), 0x8D, ...w(register)]),
  // window 1 from three times the count, 70 pixels wide, and window 2 from $C0 less it, 40 and more wide, each empty
  // when its right edge comes round past its left
  0xA5, 0x00, 0x85, 0x06, 0x0A, 0x18, 0x65, 0x06, 0x8D, ...w(0x2126), 0x18, 0x69, 70, 0x8D, ...w(0x2127),
  0xA9, 0xC0, 0x38, 0xE5, 0x00, 0x8D, ...w(0x2128), 0x85, 0x06, 0xA5, 0x00, 0x29, 0x1F, 0x18, 0x69, 40, 0x18, 0x65, 0x06, 0x8D, ...w(0x2129),
  // the fixed colour's red, green and blue from the count
  0xA5, 0x00, 0x29, 0x1F, 0x09, 0x20, 0x8D, ...w(0x2132),
  0xA5, 0x00, 0x4A, 0x29, 0x1F, 0x09, 0x40, 0x8D, ...w(0x2132),
  0xA5, 0x00, 0x29, 0x1F, 0x49, 0x1F, 0x09, 0x80, 0x8D, ...w(0x2132),
  // BG1 across, BG2 down, BG3 across twice as fast
  0xA5, 0x00, 0x8D, ...w(0x210D), 0x9C, ...w(0x210D),
  0xA5, 0x00, 0x4A, 0x8D, ...w(0x2110), 0x9C, ...w(0x2110),
  0xA5, 0x00, 0x0A, 0x8D, ...w(0x2111), 0x9C, ...w(0x2111),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The colour program's cartridge: { rom }, with its data where COLOUR says. */
export function madeUpColourCartridge() {
  const { rom, end } = assemble(COLOUR_PROGRAM, { title: 'DREAMPORTS COLOUR', nmi: 'nmi' });
  if (end > COLOUR.TILES) throw new Error('The colour program runs into its data.');
  const { tiles, small, map, smallMap, palette } = pictureData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(COLOUR.TILES));
  rom.set(small, at(COLOUR.SMALL));
  rom.set(map, at(COLOUR.MAP));
  rom.set(smallMap, at(COLOUR.SMALL_MAP));
  rom.set(palette, at(COLOUR.PALETTE));
  rom.set(colourOam(), at(COLOUR.OAM));
  rom.set(COLOUR_SETTINGS.flat(), at(COLOUR.SETTINGS));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The modes program, for the kit's test of the backgrounds of modes 0 to 4: tiles of 2, 4 and 8 bits, one map for BG1,
// BG2 and BG4 and a table of offsets as BG3's, and every 16 frames another of 16 settings: mode 2, with each column's
// scroll from the table, its tiles of 8 or 16 pixels and the table's too; mode 0; mode 3 and mode 4 with 256-colour
// tiles, through the palette and as direct colours; mode 4's one offset a column, across or down by its top bit;
// mosaic of 3, 4 and 16 pixels; windows hiding a background with offsets, and the colour window cutting its line into
// spans, as Snes9x reads the offsets again at each; and direct colours in colour maths. Each frame the backgrounds
// scroll, BG3 too, which moves the table's offsets, and window 1 moves.
export const MODES = { TILES: 0x8400, TILES_BYTES: 512, SMALL: 0x8600, SMALL_BYTES: 128, BIG: 0x8800, BIG_BYTES: 1024, MAP: 0x9000, OFFSETS: 0x9800, PALETTE: 0xA000, SETTINGS: 0xA200 };
export const MODES_REGISTERS = [0x2105, 0x2106, 0x210B, 0x2123, 0x2125, 0x212C, 0x212D, 0x212E, 0x2130, 0x2131];
const MODES_SETTINGS = [
  [0x02, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00, 0x00, 0x00],
  [0x12, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x42, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x03, 0x00, 0x02, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x03, 0x00, 0x02, 0x00, 0x00, 0x03, 0x00, 0x00, 0x01, 0x00],
  [0x04, 0x00, 0x12, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x24, 0x00, 0x12, 0x00, 0x00, 0x03, 0x00, 0x00, 0x01, 0x00],
  [0x09, 0x33, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00],
  [0x01, 0xF7, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00],
  [0x10, 0x25, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00, 0x00, 0x00],
  [0x02, 0x00, 0x00, 0x20, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00],
  [0x02, 0x00, 0x00, 0x00, 0x20, 0x03, 0x00, 0x00, 0x40, 0x00],
  [0x04, 0x00, 0x12, 0x03, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00],
  [0x03, 0x00, 0x02, 0x00, 0x00, 0x01, 0x02, 0x00, 0x03, 0x41],
  [0x52, 0x00, 0x00, 0x02, 0x20, 0x03, 0x00, 0x01, 0x80, 0x23],
];
const modesData = () => {
  // 16 tiles of 8 bits, as four pairs of planes, with gaps
  const big = [];
  for (let t = 0; t < 16; t++) {
    const pixel = (x, y) => ((x + y + t) % 7 === 0 ? 0 : (x * 17 + y * 29 + t * 41 + (x ^ y) * 5) & 0xFF);
    for (let pair = 0; pair < 4; pair++) {
      for (let y = 0; y < 8; y++) {
        for (const plane of [pair * 2, pair * 2 + 1]) big.push(Array.from({ length: 8 }, (_, x) => (pixel(x, y) >> plane & 1) << (7 - x)).reduce((a, b) => a | b, 0));
      }
    }
  }
  // the table of offsets: each word an offset in its low ten bits, BG1's and BG2's bits that turn it on, and in some
  // the top bit, which in mode 4 makes it one down
  const offsets = [];
  for (let r = 0; r < 32; r++) {
    for (let c = 0; c < 32; c++) {
      const value = ((c * 37 + r * 11) * 8 & 0x3F8) | (c * 5 + r) % 8 | (c % 3 === 0 ? 0x2000 : 0) | (c % 4 !== 1 ? 0x4000 : 0) | ((r + c) % 3 === 1 ? 0x8000 : 0);
      offsets.push(...w(value));
    }
  }
  return { big, offsets };
};
const MODES_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  // tiles of 4 bits at word $0000, of 2 at $1000 and of 8 at $2000, the map at $0400 and the offsets at $0C00
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, MODES.TILES, MODES.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, MODES.SMALL, MODES.SMALL_BYTES),
  0xA2, ...w(0x2000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, MODES.BIG, MODES.BIG_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, MODES.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, MODES.OFFSETS, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, MODES.PALETTE, 0x200),
  ...store(0x04, 0x2107), ...store(0x04, 0x2108), ...store(0x0C, 0x2109), ...store(0x04, 0x210A), ...store(0x11, 0x210C),
  ...store(0x2A, 0x2132), ...store(0x4C, 0x2132), ...store(0x91, 0x2132), ...store(0x0F, 0x2100),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the setting for the frame's count over 16, its 10 registers
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x4A, 0x29, ...w(0x000F), 0x0A, 0x85, 0x04, 0x0A, 0x0A, 0x18, 0x65, 0x04, 0xAA, 0xE2, 0x20,
  ...MODES_REGISTERS.flatMap((register, i) => [0xBD, ...w(MODES.SETTINGS + i), 0x8D, ...w(register)]),
  // window 1 from five times the count, 100 pixels wide
  0xA5, 0x00, 0x0A, 0x0A, 0x18, 0x65, 0x00, 0x8D, ...w(0x2126), 0x18, 0x69, 100, 0x8D, ...w(0x2127),
  // BG1 across and down, BG2 back across and down, BG3 across three times as fast and down slowly
  0xA5, 0x00, 0x8D, ...w(0x210D), 0x9C, ...w(0x210D),
  0xA5, 0x00, 0x4A, 0x8D, ...w(0x210E), 0x9C, ...w(0x210E),
  0xA5, 0x00, 0x49, 0xFF, 0x8D, ...w(0x210F), 0x9C, ...w(0x210F),
  0xA5, 0x00, 0x4A, 0x4A, 0x8D, ...w(0x2110), 0x9C, ...w(0x2110),
  0xA5, 0x00, 0x0A, 0x18, 0x65, 0x00, 0x8D, ...w(0x2111), 0x9C, ...w(0x2111),
  0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x8D, ...w(0x2112), 0x9C, ...w(0x2112),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The modes program's cartridge: { rom }, with its data where MODES says. */
export function madeUpModesCartridge() {
  const { rom, end } = assemble(MODES_PROGRAM, { title: 'DREAMPORTS MODES', nmi: 'nmi' });
  if (end > MODES.TILES) throw new Error('The modes program runs into its data.');
  const { tiles, small, map, palette } = pictureData(), { big, offsets } = modesData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(MODES.TILES));
  rom.set(small, at(MODES.SMALL));
  rom.set(big, at(MODES.BIG));
  rom.set(map, at(MODES.MAP));
  rom.set(offsets, at(MODES.OFFSETS));
  rom.set(palette, at(MODES.PALETTE));
  rom.set(MODES_SETTINGS.flat(), at(MODES.SETTINGS));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The mode 7 program, for the kit's test of mode 7: a map of 16 rows of the 128 and 16 tiles of 8 bits, into the
// video memory's even and odd bytes, turned a step each frame by its matrix, from a table of cosines, and scrolled; the
// product of the matrix's A and B's top byte read back at $2134 and $2135 each frame as the backdrop's colour; and
// every 16 frames another of 16 settings: wrapped, nothing or tile 0 outside the field, flipped either way, mosaic,
// the second background of 7 bits and a priority, direct colours, window 1 over a flipped field, and colour maths.
export const MODE7 = { COSINES: 0x8400, MAP: 0x8600, TILES: 0x8E00, PALETTE: 0x9200, SETTINGS: 0x9400 };
export const MODE7_REGISTERS = [0x211A, 0x2106, 0x2133, 0x212C, 0x212D, 0x2130, 0x2131, 0x2123, 0x212E];
const MODE7_SETTINGS = [
  [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x80, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0xC0, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x82, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x03, 0x31, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x00, 0xF1, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x00, 0x00, 0x40, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x80, 0x33, 0x40, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00],
  [0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x01],
  [0x80, 0x00, 0x00, 0x01, 0x00, 0x00, 0x21, 0x00, 0x00],
  [0xC1, 0x00, 0x40, 0x01, 0x02, 0x02, 0x41, 0x00, 0x00],
  [0x80, 0x21, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x02, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x83, 0x12, 0x40, 0x03, 0x00, 0x01, 0x00, 0x03, 0x01],
];
const mode7Data = () => {
  const cosines = [];
  for (let i = 0; i < 256; i++) cosines.push(...w(Math.round(Math.cos(2 * Math.PI * i / 256) * 300) & 0xFFFF));
  const map = [];
  for (let r = 0; r < 16; r++) for (let c = 0; c < 128; c++) map.push((r * 5 + c * 3 + (c >> 3)) & 15);
  const tiles = [];
  for (let t = 0; t < 16; t++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tiles.push((x + y + t) % 5 === 0 ? 0 : ((x * (t + 1) + y * 3 + t * 7) ^ (x + y) * 9) & 0xFF);
  return { cosines, map, tiles };
};
const MODE7_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  // the map into the even bytes, the tiles into the odd ones, and the colours
  0x9C, ...w(0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x00, 0x18, MODE7.MAP, 0x800),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x00, 0x19, MODE7.TILES, 0x400),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, MODE7.PALETTE, 0x200),
  // mode 7, its centre, and the fixed colour
  ...store(0x07, 0x2105), ...store(0x80, 0x211F), ...store(0x00, 0x211F), ...store(0x70, 0x2120), ...store(0x00, 0x2120),
  ...store(0x2A, 0x2132), ...store(0x4C, 0x2132), ...store(0x91, 0x2132), ...store(0x0F, 0x2100),
  ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the setting for the frame's count over 16, its 9 registers
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x4A, 0x29, ...w(0x000F), 0x85, 0x04, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 0x04, 0xAA, 0xE2, 0x20,
  ...MODE7_REGISTERS.flatMap((register, i) => [0xBD, ...w(MODE7.SETTINGS + i), 0x8D, ...w(register)]),
  // the matrix from the count as an angle: A and D its cosine, B its sine, C the sine taken away from nothing
  0xC2, 0x20, 0xA5, 0x00, 0x29, ...w(0x00FF), 0x0A, 0xAA, 0xBD, ...w(MODE7.COSINES), 0x85, 0x04,
  0x8A, 0x38, 0xE9, ...w(0x0080), 0x29, ...w(0x01FE), 0xAA, 0xBD, ...w(MODE7.COSINES), 0x85, 0x06, 0x49, ...w(0xFFFF), 0x1A, 0x85, 0x08, 0xE2, 0x20,
  0xA5, 0x04, 0x8D, ...w(0x211B), 0xA5, 0x05, 0x8D, ...w(0x211B),
  0xA5, 0x06, 0x8D, ...w(0x211C), 0xA5, 0x07, 0x8D, ...w(0x211C),
  0xA5, 0x08, 0x8D, ...w(0x211D), 0xA5, 0x09, 0x8D, ...w(0x211D),
  0xA5, 0x04, 0x8D, ...w(0x211E), 0xA5, 0x05, 0x8D, ...w(0x211E),
  // the product back as the backdrop's colour
  0x9C, ...w(0x2121), 0xAD, ...w(0x2134), 0x8D, ...w(0x2122), 0xAD, ...w(0x2135), 0x29, 0x7F, 0x8D, ...w(0x2122),
  // window 1 from five times the count, 100 pixels wide, and the field scrolled across and down
  0xA5, 0x00, 0x0A, 0x0A, 0x18, 0x65, 0x00, 0x8D, ...w(0x2126), 0x18, 0x69, 100, 0x8D, ...w(0x2127),
  0xA5, 0x00, 0x0A, 0x8D, ...w(0x210D), 0x9C, ...w(0x210D),
  0xA5, 0x00, 0x8D, ...w(0x210E), 0x9C, ...w(0x210E),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The mode 7 program's cartridge: { rom }, with its data where MODE7 says. */
export function madeUpMode7Cartridge() {
  const { rom, end } = assemble(MODE7_PROGRAM, { title: 'DREAMPORTS MODE 7', nmi: 'nmi' });
  if (end > MODE7.COSINES) throw new Error('The mode 7 program runs into its data.');
  const { palette } = pictureData(), { cosines, map, tiles } = mode7Data();
  const at = address => address - ORIGIN;
  rom.set(cosines, at(MODE7.COSINES));
  rom.set(map, at(MODE7.MAP));
  rom.set(tiles, at(MODE7.TILES));
  rom.set(palette, at(MODE7.PALETTE));
  rom.set(MODE7_SETTINGS.flat(), at(MODE7.SETTINGS));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The HDMA program, for the kit's test of HDMA: the picture program's backgrounds, and seven HDMA channels at once,
// each with a table of its own: BG1's scroll across on every line, two bytes to one register; the brightness from an
// indirect table, once each 32 lines; window 1's edges from a table the program copies into the work memory by DMA
// through its port, two registers, whose first count it changes each frame; colour 0, the backdrop, on every line, two
// bytes to $2121 and two to $2122; mosaic, switched on and off partway down; the fixed colour on every line; and the
// mode, from 1 to 0 halfway down. Each frame channel 3 is turned off or on by the count, and BG2 scrolls.
export const HDMA = { ...PICTURE, SCROLLS: 0x9A00, BRIGHT: 0x9C00, SKY: 0x9C40, MOSAIC: 0xA000, FIXED: 0xA010, MODE: 0xA100, WINDOW: 0xA110, WINDOW_BYTES: 451 };
const hdmaData = () => {
  const block = (lines, each) => [0x80 | lines, ...Array.from({ length: lines }, (_, i) => each(i)).flat()];
  const scrolls = [...block(112, i => w(Math.round(10 * Math.sin(i * 2 * Math.PI / 56)) & 0xFFFF)), ...block(112, i => w(Math.round(10 * Math.sin((i + 112) * 2 * Math.PI / 56)) & 0xFFFF)), 0];
  const levels = [15, 13, 11, 9, 11, 13, 15];
  const bright = [...levels.flatMap((_, k) => [32, ...w(HDMA.BRIGHT + 0x20 + k)]), 0];
  const colour = i => ((i >> 3) & 31) | (((i >> 2) & 31) << 5) | ((31 - (i >> 3)) << 10);
  const sky = [...block(112, i => [0, 0, ...w(colour(i))]), ...block(112, i => [0, 0, ...w(colour(i + 112))]), 0];
  const mosaic = [0x40, 0x00, 0x30, 0x31, 0x30, 0xF4, 0x01, 0x00, 0x00];
  const fixed = [...block(112, i => [0x20 | (i & 31)]), ...block(112, i => [0x80 | ((i >> 1) & 31)]), 0];
  const mode = [0x70, 0x09, 0x70, 0x00, 0x00];
  const edge = i => 64 + Math.round(40 * Math.sin(i / 10));
  const window = [...block(112, i => [edge(i), edge(i) + 80 + (i & 15)]), ...block(112, i => [edge(i + 112), edge(i + 112) + 80 + (i & 15)]), 0];
  return { scrolls, bright, levels, sky, mosaic, fixed, mode, window };
};
// a channel's registers: its control, its register, and its table's address and bank
const hdmaChannel = (c, control, register, table, bank) => [...store(control, 0x4300 + c * 16), ...store(register, 0x4301 + c * 16), ...store(table & 0xFF, 0x4302 + c * 16), ...store(table >> 8, 0x4303 + c * 16), ...store(bank, 0x4304 + c * 16)];
const HDMA_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HDMA.TILES, HDMA.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HDMA.SMALL, HDMA.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HDMA.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HDMA.SMALL_MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, HDMA.PALETTE, 0x200),
  // the window's table into the work memory at $7E2000, through its port
  0xA2, ...w(0x2000), 0x8E, ...w(0x2181), 0x9C, ...w(0x2183), ...dma(0x00, 0x80, HDMA.WINDOW, HDMA.WINDOW_BYTES),
  ...store(0x09, 0x2105), ...store(0x04, 0x2107), ...store(0x04, 0x2108), ...store(0x0C, 0x2109), ...store(0x00, 0x210B), ...store(0x01, 0x210C), ...store(0x07, 0x212C),
  ...store(0x02, 0x2124), ...store(0x04, 0x212E), ...store(0x00, 0x2130), ...store(0x21, 0x2131),
  // the seven channels, and the brightness's indirect bank
  ...hdmaChannel(0, 0x02, 0x0D, HDMA.SCROLLS, 0x00), ...hdmaChannel(1, 0x40, 0x00, HDMA.BRIGHT, 0x00), ...store(0x00, 0x4317),
  ...hdmaChannel(2, 0x01, 0x26, 0x2000, 0x7E), ...hdmaChannel(3, 0x03, 0x21, HDMA.SKY, 0x00), ...hdmaChannel(4, 0x00, 0x06, HDMA.MOSAIC, 0x00),
  ...hdmaChannel(5, 0x00, 0x32, HDMA.FIXED, 0x00), ...hdmaChannel(6, 0x00, 0x05, HDMA.MODE, 0x00),
  ...store(0x0F, 0x2100), ...store(0x80, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the window table's first count from the frame's, channel 3 off in every other 32 frames, BG2 across
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xA5, 0x00, 0x29, 0x3F, 0x09, 0x80, 0x8F, ...l(0x7E2000),
  0xA5, 0x00, 0x29, 0x20, 0x4A, 0x4A, 0x49, 0x7F, 0x8D, ...w(0x420C),
  0xA5, 0x00, 0x8D, ...w(0x210F), 0x9C, ...w(0x210F),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
];

/** The HDMA program's cartridge: { rom }, with its data where HDMA says. */
export function madeUpHdmaCartridge() {
  const { rom, end } = assemble(HDMA_PROGRAM, { title: 'DREAMPORTS HDMA', nmi: 'nmi' });
  if (end > HDMA.TILES) throw new Error('The HDMA program runs into its data.');
  const { tiles, small, map, smallMap, palette } = pictureData(), data = hdmaData();
  if (data.window.length !== HDMA.WINDOW_BYTES) throw new Error('The window table is another size.');
  const at = address => address - ORIGIN;
  rom.set(tiles, at(HDMA.TILES));
  rom.set(small, at(HDMA.SMALL));
  rom.set(map, at(HDMA.MAP));
  rom.set(smallMap, at(HDMA.SMALL_MAP));
  rom.set(palette, at(HDMA.PALETTE));
  rom.set(data.scrolls, at(HDMA.SCROLLS));
  rom.set(data.bright, at(HDMA.BRIGHT));
  rom.set(data.levels, at(HDMA.BRIGHT + 0x20));
  rom.set(data.sky, at(HDMA.SKY));
  rom.set(data.mosaic, at(HDMA.MOSAIC));
  rom.set(data.fixed, at(HDMA.FIXED));
  rom.set(data.mode, at(HDMA.MODE));
  rom.set(data.window, at(HDMA.WINDOW));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The raster program, for the kit's test of the main processor's own writes partway down the frame: the picture
// program's backgrounds, and an IRQ handler the timers call three ways in each frame. At line 40, by the V timer alone,
// it switches mode 1 to mode 0 and scrolls BG3, and sets the H and V timers for dot 180 of line 100; there it halves
// the brightness, turns mosaic on and leaves the H timer alone, which calls it at dot 180 of each line after, where it
// writes the backdrop's colour, 40 lines of it, with what $4212 says there, and then turns the timers off. The
// V-blank's handler puts it all back, scrolls BG1, and scrolls BG2 by what $4212 says as V-blank starts.
export const RASTER = { ...PICTURE };
const RASTER_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01, 0x64, 0x10, 0x64, 0x11,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, RASTER.TILES, RASTER.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, RASTER.SMALL, RASTER.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, RASTER.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, RASTER.SMALL_MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, RASTER.PALETTE, 0x200),
  ...store(0x09, 0x2105), ...store(0x04, 0x2107), ...store(0x04, 0x2108), ...store(0x0C, 0x2109), ...store(0x00, 0x210B), ...store(0x01, 0x210C), ...store(0x07, 0x212C),
  // the H timer at dot 180, IRQs let in, and the NMI on, whose handler turns the V timer's IRQ on for each frame
  ...store(0xB4, 0x4207), 0x9C, ...w(0x4208), 0x58,
  ...store(0x0F, 0x2100), ...store(0x81, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: stage 0, mode 1, full brightness, no mosaic, BG1 across, and the V timer's IRQ at line 40 again
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210), 0x64, 0x10,
  ...store(0x09, 0x2105), ...store(0x0F, 0x2100), 0x9C, ...w(0x2106),
  0xA5, 0x00, 0x8D, ...w(0x210D), 0x9C, ...w(0x210D),
  // $4212 as V-blank starts, its defined bits, as BG2's scroll across
  0xAD, ...w(0x4212), 0x29, 0xC1, 0x8D, ...w(0x210F), 0x9C, ...w(0x210F),
  ...store(0x28, 0x4209), 0x9C, ...w(0x420A), ...store(0xA1, 0x4200),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
  // the timers' IRQ, by the stage at $10
  here('irq'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4211), 0xA5, 0x10, 0xF0, rel('first'), 0xC9, 0x01, 0xF0, rel('second'),
  // each line from 101: the backdrop's colour from the line's count at $11 and $4212's defined bits, and after 40
  // lines the timers off
  0xAD, ...w(0x4212), 0x29, 0xC1, 0x85, 0x12,
  0x9C, ...w(0x2121), 0xA5, 0x11, 0x0A, 0x0A, 0x8D, ...w(0x2122), 0xA5, 0x11, 0x4A, 0x05, 0x12, 0x8D, ...w(0x2122),
  0xE6, 0x11, 0xA5, 0x11, 0xC9, 0x28, 0xD0, rel('done'), ...store(0x81, 0x4200), 0xE6, 0x10,
  here('done'), 0x40,
  // line 40: mode 0, BG3 down by half the frame's count, and the H and V timers for dot 180 of line 100
  here('first'), 0x9C, ...w(0x2105), 0xA5, 0x00, 0x4A, 0x8D, ...w(0x2112), 0x9C, ...w(0x2112),
  ...store(0x64, 0x4209), 0x9C, ...w(0x420A), ...store(0xB1, 0x4200), 0xE6, 0x10, 0x40,
  // line 100: half brightness, mosaic of 4 on BG1, and the H timer alone, on each line after
  here('second'), ...store(0x08, 0x2100), ...store(0x31, 0x2106), ...store(0x91, 0x4200), 0x64, 0x11, 0xE6, 0x10, 0x40,
];

/** The raster program's cartridge: { rom }, with its data where RASTER says. */
export function madeUpRasterCartridge() {
  const { rom, end } = assemble(RASTER_PROGRAM, { title: 'DREAMPORTS RASTER', nmi: 'nmi', irq: 'irq' });
  if (end > RASTER.TILES) throw new Error('The raster program runs into its data.');
  const { tiles, small, map, smallMap, palette } = pictureData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(RASTER.TILES));
  rom.set(small, at(RASTER.SMALL));
  rom.set(map, at(RASTER.MAP));
  rom.set(smallMap, at(RASTER.SMALL_MAP));
  rom.set(palette, at(RASTER.PALETTE));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The high-resolution program, for the kit's test of modes 5 and 6, pseudo high resolution and interlace: the colour
// program's tiles, maps and 40 small sprites, BG2 on the small tiles, and every 16 frames another of 16 settings: mode
// 1, switched to mode 5 by an IRQ at line 100, so Snes9x widens the lines above; mode 5 with the sub screen's backdrop,
// then its BG2, BG1's tiles 16 tall, and mosaic of 1 and of 4; mode 6, with an offset for each column; mode 1 with
// pseudo high resolution from line 100, and from the top adding the sub screen; mode 5 halving the sub screen inside
// the colour window, black and with no maths outside it; mode 5 interlaced, alone and with mosaic; mode 1 switched to
// mode 5 interlaced at line 100, so Snes9x moves the lines above apart; a window hiding BG1 in mode 5; and the sprites
// interlaced too, in modes 1 and 5. Each frame BG1 scrolls across and BG2 down.
export const HIRES = { ...COLOUR };
// each setting's registers, in the order the program writes them, and then what its IRQ at line 100 writes to $2105,
// none when 0, and to $2133
export const HIRES_REGISTERS = [0x2105, 0x2133, 0x2106, 0x212C, 0x212D, 0x2130, 0x2131, 0x2123, 0x2125, 0x212E, 0x2100];
const HIRES_SETTINGS = [
  [0x01, 0x00, 0x00, 0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x05, 0x00],
  [0x05, 0x00, 0x00, 0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x00, 0x00, 0x11, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x15, 0x00, 0x00, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x00, 0x01, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x00, 0x33, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x06, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x01, 0x00, 0x00, 0x11, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x01, 0x08],
  [0x01, 0x08, 0x00, 0x11, 0x02, 0x02, 0x21, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x00, 0x00, 0x11, 0x02, 0x52, 0x63, 0x00, 0x20, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x01, 0x00, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x01, 0x00, 0x00, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x05, 0x01],
  [0x05, 0x01, 0x31, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x00, 0x00, 0x13, 0x02, 0x00, 0x00, 0x02, 0x00, 0x01, 0x0F, 0x00, 0x00],
  [0x01, 0x03, 0x00, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00],
  [0x05, 0x03, 0x00, 0x13, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00],
];
const HIRES_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01, 0x64, 0x12, 0x64, 0x13,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HIRES.TILES, HIRES.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HIRES.SMALL, HIRES.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HIRES.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, HIRES.SMALL_MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, HIRES.PALETTE, 0x200),
  0x9C, ...w(0x2102), 0x9C, ...w(0x2103), ...dma(0x00, 0x04, HIRES.OAM, 544),
  // BG1's map at $0400 and its tiles at $0000, BG2's and BG3's map at $0C00 and their tiles at $1000, small sprites,
  // window 1 from 48 to 176, and the fixed colour
  ...store(0x04, 0x2107), ...store(0x0C, 0x2108), ...store(0x0C, 0x2109), ...store(0x10, 0x210B), ...store(0x01, 0x210C), ...store(0x00, 0x2101),
  ...store(0x30, 0x2126), ...store(0xB0, 0x2127), ...store(0x2A, 0x2132), ...store(0x4C, 0x2132), ...store(0x91, 0x2132),
  // IRQs let in, and the NMI on
  0x58, ...store(0x81, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the setting for the frame's count over 16, 13 bytes each, its 11 registers, what its IRQ writes, kept
  // at $12 and $13, and the V timer's IRQ at line 100 when it has a mode to write
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x4A, 0x29, ...w(0x000F), 0x85, 0x06, 0x0A, 0x0A, 0x85, 0x04, 0x0A, 0x18, 0x65, 0x04, 0x18, 0x65, 0x06, 0xAA, 0xE2, 0x20,
  ...HIRES_REGISTERS.flatMap((register, i) => [0xBD, ...w(HIRES.SETTINGS + i), 0x8D, ...w(register)]),
  0xBD, ...w(HIRES.SETTINGS + HIRES_REGISTERS.length + 1), 0x85, 0x13, 0xBD, ...w(HIRES.SETTINGS + HIRES_REGISTERS.length), 0x85, 0x12, 0xF0, rel('none'),
  ...store(100, 0x4209), 0x9C, ...w(0x420A), ...store(0xA1, 0x4200), 0x80, rel('scroll'),
  here('none'), ...store(0x81, 0x4200),
  // BG1 across and BG2 down
  here('scroll'), 0xA5, 0x00, 0x8D, ...w(0x210D), 0x9C, ...w(0x210D), 0xA5, 0x00, 0x4A, 0x8D, ...w(0x2110), 0x9C, ...w(0x2110),
  0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
  // the IRQ at line 100: the mode at $12 and $2133 at $13
  here('irq'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4211), 0xA5, 0x12, 0x8D, ...w(0x2105), 0xA5, 0x13, 0x8D, ...w(0x2133), 0x40,
];

/** The high-resolution program's cartridge: { rom }, with its data where HIRES says. */
export function madeUpHiresCartridge() {
  const { rom, end } = assemble(HIRES_PROGRAM, { title: 'DREAMPORTS HIRES', nmi: 'nmi', irq: 'irq' });
  if (end > HIRES.TILES) throw new Error('The high-resolution program runs into its data.');
  const { tiles, small, map, smallMap, palette } = pictureData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(HIRES.TILES));
  rom.set(small, at(HIRES.SMALL));
  rom.set(map, at(HIRES.MAP));
  rom.set(smallMap, at(HIRES.SMALL_MAP));
  rom.set(palette, at(HIRES.PALETTE));
  rom.set(colourOam(), at(HIRES.OAM));
  rom.set(HIRES_SETTINGS.flat(), at(HIRES.SETTINGS));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}

// The status program, for the kit's test of the picture unit's last pieces: the colour program's tiles and maps, 40
// small sprites on the same 8 lines and 20 large ones on others, so a line has more than 32 sprites or more than 34 of
// their tiles, and every 16 frames another of 16 settings: mode 1 at two sizes of sprites; mosaic in modes 2, 4 and 6,
// whose backgrounds have offsets, on one background and two, with windows, 16-pixel tiles and BG3's own; and overscan,
// in modes 1 and 2 and in mode 5 interlaced. At each V-blank it reads back the counters, the two status bytes, two
// sprites from the sprites' table, video memory and a colour, and shows what it reads as scrolls and colours; its IRQ
// at line 100 reads the counters and the status again, for the next V-blank to show, and writes to video memory, which
// Snes9x drops while the screen's lines are drawn. BG3 scrolls across by the frame's count, as far as its scroll goes.
export const STATUS = { ...COLOUR };
// each setting's registers, in the order the program writes them
export const STATUS_REGISTERS = [0x2105, 0x2106, 0x2133, 0x212C, 0x2123, 0x212E, 0x2101, 0x2115];
const STATUS_SETTINGS = [
  [0x09, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x80],
  [0x09, 0x00, 0x00, 0x17, 0x00, 0x00, 0xA0, 0x00],
  [0x02, 0x31, 0x00, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x12, 0x31, 0x00, 0x13, 0x00, 0x00, 0x00, 0x81],
  [0x02, 0x33, 0x00, 0x13, 0x22, 0x03, 0x00, 0x84],
  [0x04, 0x21, 0x00, 0x13, 0x00, 0x00, 0x00, 0x88],
  [0x06, 0x31, 0x00, 0x11, 0x00, 0x00, 0x00, 0x8C],
  [0x06, 0x01, 0x00, 0x11, 0x00, 0x00, 0x00, 0x80],
  [0x09, 0x00, 0x04, 0x17, 0x00, 0x00, 0x00, 0x80],
  [0x02, 0x31, 0x04, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x05, 0x00, 0x05, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x42, 0x31, 0x00, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x09, 0x00, 0x00, 0x17, 0x00, 0x00, 0x60, 0x80],
  [0x04, 0x31, 0x00, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x12, 0x33, 0x00, 0x13, 0x00, 0x00, 0x00, 0x80],
  [0x09, 0x00, 0x00, 0x17, 0x00, 0x00, 0x00, 0x80],
];
// the status byte in A kept at $29, or 0 there before frame 2; A ends as $29
let firsts = 0;
const first = () => {
  const n = firsts++;
  return [0x85, 0x29, 0xA5, 0x01, 0xD0, rel(`use${n}`), 0xA5, 0x00, 0xC9, 0x02, 0xB0, rel(`use${n}`), 0x64, 0x29, here(`use${n}`), 0xA5, 0x29];
};
// 40 small sprites at line 60 and 20 large ones at line 150, the rest out of sight to the left
const statusOam = () => {
  const oam = new Uint8Array(544);
  for (let i = 0; i < 128; i++) {
    const small = i < 40, large = i >= 40 && i < 60;
    const x = small ? i * 6 : large ? (i - 40) * 12 : 0x180;
    oam.set([x & 0xFF, small ? 60 : large ? 150 : 240, i & 15, ((i & 7) << 1) | ((i >> 3 & 3) << 4)], i * 4);
    oam[0x200 + (i >> 2)] |= ((x >> 8 & 1) | (large ? 2 : 0)) << ((i & 3) * 2);
  }
  return oam;
};
const STATUS_PROGRAM = [
  here('start'), 0x78, 0x18, 0xFB, 0xC2, 0x10, 0xE2, 0x20, 0xA2, ...w(STACK), 0x9A, 0x64, 0x00, 0x64, 0x01, 0x64, 0x13,
  ...store(0x80, 0x2100), 0x9C, ...w(0x4200),
  ...store(0x80, 0x2115), 0xA2, ...w(0x0000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, STATUS.TILES, STATUS.TILES_BYTES),
  0xA2, ...w(0x1000), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, STATUS.SMALL, STATUS.SMALL_BYTES),
  0xA2, ...w(0x0400), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, STATUS.MAP, 0x800),
  0xA2, ...w(0x0C00), 0x8E, ...w(0x2116), ...dma(0x01, 0x18, STATUS.SMALL_MAP, 0x800),
  0x9C, ...w(0x2121), ...dma(0x00, 0x22, STATUS.PALETTE, 0x200),
  0x9C, ...w(0x2102), 0x9C, ...w(0x2103), ...dma(0x00, 0x04, STATUS.OAM, 544),
  // BG1's and BG2's map at $0400, BG3's at $0C00 and 64 tiles across, BG1's tiles at $0000 and the others' at $1000,
  // window 1 from 48 to 176, the V timer at line 100, and the screen on
  ...store(0x04, 0x2107), ...store(0x04, 0x2108), ...store(0x0D, 0x2109), ...store(0x10, 0x210B), ...store(0x01, 0x210C),
  ...store(0x30, 0x2126), ...store(0xB0, 0x2127), ...store(100, 0x4209), 0x9C, ...w(0x420A), ...store(0x0F, 0x2100),
  // IRQs let in, and the NMI on, whose handler turns the V timer's IRQ on for each frame
  0x58, ...store(0x81, 0x4200),
  here('spin'), 0x80, rel('spin'),
  // the V-blank: the setting for the frame's count over 16, 8 bytes each. When it turns overscan on, only that, kept at
  // $13, as Snes9x then draws on to line 239 before V-blank starts again, and this handler's other writes would come
  // partway through line 225, which it draws
  here('nmi'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4210),
  0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x29, ...w(0x0078), 0xAA, 0xE2, 0x20,
  0xBD, ...w(STATUS.SETTINGS + 2), 0x29, 0x04, 0xF0, rel('setting'), 0xA5, 0x13, 0x29, 0x04, 0xD0, rel('setting'),
  0xBD, ...w(STATUS.SETTINGS + 2), 0x8D, ...w(0x2133), 0x85, 0x13, 0x40,
  here('setting'), ...STATUS_REGISTERS.flatMap((register, i) => [0xBD, ...w(STATUS.SETTINGS + i), 0x8D, ...w(register)]),
  0xBD, ...w(STATUS.SETTINGS + 2), 0x85, 0x13,
  // the counters latched, and the line as BG2's scroll across
  0xAD, ...w(0x2137), 0xAD, ...w(0x213D), 0x8D, ...w(0x210F), 0xAD, ...w(0x213D), 0x8D, ...w(0x210F),
  // the second status byte as BG2's scroll down, the first as BG3's, from frame 2, as before then it holds what the
  // start-up frame's sprites left, which the kit doesn't draw
  0xAD, ...w(0x213F), 0x8D, ...w(0x2110), 0x9C, ...w(0x2110), 0xAD, ...w(0x213E), ...first(), 0x8D, ...w(0x2112), 0x9C, ...w(0x2112),
  // BG3 across by the frame's count, its top bits from the count over 64
  0xA5, 0x00, 0x8D, ...w(0x2111), 0xC2, 0x20, 0xA5, 0x00, 0x4A, 0x4A, 0x4A, 0x4A, 0x4A, 0x4A, 0xE2, 0x20, 0x29, 0x03, 0x8D, ...w(0x2111),
  // the first word of sprite (count & 63) as BG1's scroll across, the second kept at $20; and a word of the high table
  0xA5, 0x00, 0x29, 0x3F, 0x8D, ...w(0x2102), 0x9C, ...w(0x2103),
  0xAD, ...w(0x2138), 0x8D, ...w(0x210D), 0xAD, ...w(0x2138), 0x8D, ...w(0x210D), 0xAD, ...w(0x2138), 0x85, 0x20, 0xAD, ...w(0x2138), 0x85, 0x21,
  0xA5, 0x00, 0x29, 0x0F, 0x8D, ...w(0x2102), ...store(0x01, 0x2103), 0xAD, ...w(0x2138), 0x85, 0x22, 0xAD, ...w(0x2138), 0x85, 0x23,
  // video memory at four times the count: a word as BG1's scroll down, the next kept at $24
  0xC2, 0x20, 0xA5, 0x00, 0x0A, 0x0A, 0x8D, ...w(0x2116), 0xE2, 0x20,
  0xAD, ...w(0x2139), 0x8D, ...w(0x210E), 0xAD, ...w(0x213A), 0x8D, ...w(0x210E), 0xAD, ...w(0x2139), 0x85, 0x24, 0xAD, ...w(0x213A), 0x85, 0x25,
  // colour (count & 255), and a byte of the next, kept at $26
  0xA5, 0x00, 0x8D, ...w(0x2121), 0xAD, ...w(0x213B), 0x85, 0x26, 0xAD, ...w(0x213B), 0x85, 0x27, 0xAD, ...w(0x213B), 0x85, 0x28,
  // what it read, and what the IRQ read, as colours 0 to 5
  0x9C, ...w(0x2121), ...[0x26, 0x27, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x2A, 0x2B, 0x2C].flatMap(at => [0xA5, at, 0x8D, ...w(0x2122)]),
  // the V timer's IRQ on, and the count on by one
  ...store(0xA1, 0x4200), 0xC2, 0x20, 0xE6, 0x00, 0xE2, 0x20, 0x40,
  // the IRQ at line 100: the counters latched again, the line and the first status byte kept at $2A to $2C for the
  // V-blank to show, as a write here would show from a line that depends on the handler's cycles, and a tile written
  // to BG1's map, which Snes9x drops
  here('irq'), 0xE2, 0x20, 0xC2, 0x10, 0xAD, ...w(0x4211),
  0xAD, ...w(0x2137), 0xAD, ...w(0x213D), 0x85, 0x2A, 0xAD, ...w(0x213D), 0x85, 0x2B,
  0xAD, ...w(0x213E), ...first(), 0x85, 0x2C,
  ...store(0xC2, 0x2116), ...store(0x05, 0x2117), ...store(0x07, 0x2118), ...store(0x1C, 0x2119), 0x40,
];

/** The status program's cartridge: { rom }, with its data where STATUS says. */
export function madeUpStatusCartridge() {
  const { rom, end } = assemble(STATUS_PROGRAM, { title: 'DREAMPORTS STATUS', nmi: 'nmi', irq: 'irq' });
  if (end > STATUS.TILES) throw new Error('The status program runs into its data.');
  const { tiles, small, map, smallMap, palette } = pictureData();
  const at = address => address - ORIGIN;
  rom.set(tiles, at(STATUS.TILES));
  rom.set(small, at(STATUS.SMALL));
  rom.set(map, at(STATUS.MAP));
  rom.set(smallMap, at(STATUS.SMALL_MAP));
  rom.set(palette, at(STATUS.PALETTE));
  rom.set(statusOam(), at(STATUS.OAM));
  rom.set(STATUS_SETTINGS.flat(), at(STATUS.SETTINGS));
  const header = 0x7FC0;
  rom.set([0, 0, 0, 0], header + 0x1C);
  const sum = rom.reduce((total, byte) => total + byte, 0) + 0x1FE;
  rom.set(w(~sum & 0xFFFF), header + 0x1C);
  rom.set(w(sum & 0xFFFF), header + 0x1E);
  return { rom };
}
