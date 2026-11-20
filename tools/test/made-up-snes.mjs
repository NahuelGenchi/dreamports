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
