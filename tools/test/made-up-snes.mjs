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
