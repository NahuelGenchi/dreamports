// A Super Nintendo cartridge as its console sees it: what its header says, and where each address of the console's
// 24 bits is, in the cartridge's ROM, its save memory, the console's 128 KB of work memory or its hardware's
// registers, laid out 4 KB at a time the way the reference emulator lays it out (Snes9x's memmap.cpp), so the tools'
// own stand-in for the console (call.cpp) sees what the reference does. The plain cartridges are laid out: LoROM, whose
// ROM is seen 32 KB to a bank, at $8000 and up; HiROM, 64 KB to a bank; and ExHiROM, HiROM past 4 MB. A cartridge with
// a chip of its own beside the ROM, such as the Super FX or the SA-1, which have maps and processors of their own,
// isn't yet.

/** What each 4 KB of the map is, as call.cpp numbers them. */
export const NOTHING = 0, WORK = 1, HARDWARE = 2, ROM = 3, SAVE = 4;
export const BLOCKS = 0x1000;
export const WRAM = 0x20000;

// the header's place in the ROM, for each layout, and the layout its map mode byte names
const HEADERS = [{ mapping: 'lorom', at: 0x7FC0 }, { mapping: 'hirom', at: 0xFFC0 }, { mapping: 'exhirom', at: 0x40FFC0 }];
const MODES = { 0x20: 'lorom', 0x21: 'hirom', 0x22: 'lorom', 0x23: 'sa1', 0x25: 'exhirom', 0x2A: 'spc7110' };
// what the cartridge's type byte says is beside its ROM, from the fourth value on
const CHIPS = [[0x03, 0x05, 'a DSP'], [0x13, 0x1A, 'the Super FX'], [0x25, 0x25, 'the OBC1'], [0x32, 0x36, 'the SA-1'], [0x43, 0x45, 'the S-DD1'], [0x55, 0x55, 'the S-RTC'], [0xE3, 0xE5, 'a Game Boy'], [0xF3, 0xF3, 'the Cx4'], [0xF5, 0xF9, 'the SPC7110 or a Seta chip']];

const word = (bytes, at) => bytes[at] | bytes[at + 1] << 8;

/** How well a place in the ROM looks like the header of the layout it's for: the higher the likelier. */
function score(rom, { mapping, at }) {
  if (at + 0x40 > rom.length) return -1;
  let points = 0;
  if ((word(rom, at + 0x1C) + word(rom, at + 0x1E)) === 0xFFFF) points += 4;
  if (MODES[rom[at + 0x15] & 0xEF] === mapping) points += 3;
  if (word(rom, at + 0x3C) >= 0x8000) points += 2;
  if (rom[at + 0x17] >= 7 && rom[at + 0x17] <= 13) points += 1;
  if (rom[at + 0x18] <= 7) points += 1;
  // a title of letters and spaces, as games give one
  if ([...rom.subarray(at, at + 21)].every(b => b >= 0x20 && b < 0x7F)) points += 1;
  return points;
}

/** Where address `pos` of a ROM of `size` bytes is, when the ROM is seen again past its end (Snes9x's map_mirror). */
export function mirror(size, pos) {
  if (size === 0) return 0;
  if (pos < size) return pos;
  let mask = 2 ** 31;
  while (!(pos & mask)) mask /= 2;
  return size <= (pos & mask) ? mirror(size, pos - mask) : mask + mirror(size - mask, pos - mask);
}

/**
 * A cartridge's ROM, as a copy of it holds it, read: { rom, mapping, sram, title, speed, chip, header, reset, nmi,
 * irq }. `rom` is the ROM without a copier's header, made up to the next 8 KB as the reference emulator does,
 * `mapping` 'lorom', 'hirom' or 'exhirom', `sram` how many bytes of save memory it has, `speed` 'fast' when its map
 * mode says its ROM is fast, `chip` what's beside its ROM, in words, or null, and the vectors where the console starts
 * it and runs its interrupts.
 */
export function readCartridge(copy) {
  let bytes = copy instanceof Uint8Array ? copy : new Uint8Array(copy);
  // a copier's header, 512 bytes before the ROM, which old copies kept
  if (bytes.length % 1024 === 512) bytes = bytes.subarray(512);
  const size = Math.ceil(bytes.length / 0x2000) * 0x2000;
  const rom = new Uint8Array(size);
  rom.set(bytes);
  const best = HEADERS.map(header => ({ ...header, points: score(rom, header) })).reduce((a, b) => (b.points > a.points ? b : a));
  const at = best.at, type = rom[at + 0x16];
  const chipRange = type >= 3 ? CHIPS.find(([low, high]) => (type & 0xFF) >= low && (type & 0xFF) <= high) : null;
  const mode = MODES[rom[at + 0x15] & 0xEF];
  const chip = chipRange ? chipRange[2] : mode === 'sa1' ? 'the SA-1' : mode === 'spc7110' ? 'the SPC7110' : null;
  const sramSize = rom[at + 0x18];
  return {
    rom,
    mapping: best.mapping,
    sram: sramSize > 0 && sramSize <= 9 ? 1024 << sramSize : 0,
    sramSize,
    romSize: rom[at + 0x17],
    title: String.fromCharCode(...rom.subarray(at, at + 21)).trim(),
    speed: rom[at + 0x15] & 0x10 ? 'fast' : 'slow',
    chip,
    header: at,
    reset: word(rom, at + 0x3C),
    nmi: word(rom, at + 0x2A),
    irq: word(rom, at + 0x2E),
  };
}

/**
 * The map of a cartridge as the reference emulator lays it out: for each 4 KB of the console's 16 MB, three numbers,
 * what it is (NOTHING, WORK, HARDWARE, ROM or SAVE), where its first byte is in what it is, and a mask the place is
 * kept within, as a Uint32Array of 4096 times three.
 */
export function mapOf({ rom, mapping, sram, sramSize = 0, romSize = 0, chip }) {
  if (chip) throw new Error(`This cartridge has ${chip} beside its ROM, which the tools don't lay out yet: only a plain LoROM, HiROM or ExHiROM.`);
  const map = new Uint32Array(BLOCKS * 3);
  const set = (bank, address, what, base, mask) => {
    const block = (bank << 4) | (address >> 12);
    map[block * 3] = what;
    map[block * 3 + 1] = base >>> 0;
    map[block * 3 + 2] = mask >>> 0;
  };
  const each = (banks, from, to, fill) => {
    for (let bank = banks[0]; bank <= banks[1]; bank++) for (let address = from; address <= to; address += 0x1000) fill(bank, address);
  };
  const size = rom.length;
  // the console's own: its work memory's first 8 KB and its hardware, in the banks that have them
  for (const banks of [[0x00, 0x3F], [0x80, 0xBF]]) {
    each(banks, 0x0000, 0x1FFF, (bank, address) => set(bank, address, WORK, address, WRAM - 1));
    each(banks, 0x2000, 0x5FFF, (bank, address) => set(bank, address, HARDWARE, 0, 0xFFFF));
  }
  if (mapping === 'lorom') {
    const lorom = (banks, from, to) => each(banks, from, to, (bank, address) => set(bank, address, ROM, mirror(size, (bank & 0x7F) * 0x8000) + (address & 0x7FFF), 0xFFFFFFFF));
    lorom([0x00, 0x3F], 0x8000, 0xFFFF);
    lorom([0x40, 0x7F], 0x0000, 0xFFFF);
    lorom([0x80, 0xBF], 0x8000, 0xFFFF);
    lorom([0xC0, 0xFF], 0x0000, 0xFFFF);
    // the save memory, in banks $70 to $7D, and $F0 to $FF when there's some, a bank's lower half or all of it
    const high = romSize > 11 || sramSize > 5 ? 0x7FFF : 0xFFFF;
    const save = (bank, address) => set(bank, address, sram ? SAVE : NOTHING, (bank << 15) | (address & 0x7FFF), sram - 1);
    each([0x70, 0x7D], 0x0000, high, save);
    if (sram) each([0xF0, 0xFF], 0x0000, high, save);
  } else if (mapping === 'hirom' || mapping === 'exhirom') {
    const hirom = (banks, from, to, length, offset) => each(banks, from, to, (bank, address) => set(bank, address, ROM, offset + mirror(length, (mapping === 'hirom' ? bank : bank - banks[0]) << 16) + address, 0xFFFFFFFF));
    if (mapping === 'hirom') {
      for (const [banks, from] of [[[0x00, 0x3F], 0x8000], [[0x40, 0x7F], 0x0000], [[0x80, 0xBF], 0x8000], [[0xC0, 0xFF], 0x0000]]) hirom(banks, from, 0xFFFF, size, 0);
    } else {
      hirom([0x00, 0x3F], 0x8000, 0xFFFF, size - 0x400000, 0x400000);
      hirom([0x40, 0x7F], 0x0000, 0xFFFF, size - 0x400000, 0x400000);
      hirom([0x80, 0xBF], 0x8000, 0xFFFF, 0x400000, 0);
      hirom([0xC0, 0xFF], 0x0000, 0xFFFF, 0x400000, 0);
    }
    // the save memory, at $6000 to $7FFF of banks $20 to $3F and $A0 to $BF
    const save = (bank, address) => set(bank, address, sram ? SAVE : NOTHING, (address & 0x7FFF) - 0x6000 + ((bank & 0x1F) << 13), sram - 1);
    each([0x20, 0x3F], 0x6000, 0x7FFF, save);
    each([0xA0, 0xBF], 0x6000, 0x7FFF, save);
  } else {
    throw new Error(`The tools don't lay out a cartridge mapped as ${mapping}.`);
  }
  // the work memory, all of it, in banks $7E and $7F
  each([0x7E, 0x7F], 0x0000, 0xFFFF, (bank, address) => set(bank, address, WORK, ((bank & 1) << 16) | address, WRAM - 1));
  return map;
}

/** What an address is in a map, and where: { what, at }, `at` in the ROM or in what it is. */
export function placeIn(map, address) {
  const block = ((address >>> 0) & 0xFFFFFF) >>> 12;
  const what = map[block * 3];
  return { what, at: ((map[block * 3 + 1] + (address & 0xFFF)) & map[block * 3 + 2]) >>> 0 };
}

/** How a cartridge is laid out, as its code map keeps it (../lib/proof-files.mjs), so a tool with no copy of the game
 *  can say where an address of the console is in its ROM: what mapOf reads of a cartridge, and its ROM's speed, which
 *  says the bank its code is most often run from, and where the console starts it, its reset vector. Nothing of the
 *  game's code or data is in it. */
export const layoutOf = ({ rom, mapping, sram, sramSize, romSize, speed, reset }) => ({ mapping, rom: rom.length, sram, sramSize, romSize, speed, reset });

const isLayout = layout => layout && typeof layout === 'object' && ['lorom', 'hirom', 'exhirom'].includes(layout.mapping)
  && ['rom', 'sram', 'sramSize', 'romSize', 'reset'].every(key => Number.isInteger(layout[key]) && layout[key] >= 0) && layout.rom > 0 && ['fast', 'slow'].includes(layout.speed);

/** A cartridge as readCartridge gives one, from the layout a code map keeps, with no byte of its ROM: what mapOf and
 *  the address a function runs at need of it (functions.mjs). Throws on one that isn't as layoutOf writes it. */
export function cartOfLayout(layout) {
  if (!isLayout(layout)) throw new Error('The code map doesn\'t say how the cartridge is laid out, as codemap writes it for a Super Nintendo game: npm run dp -- codemap <game> writes it again.');
  const { mapping, rom, sram, sramSize, romSize, speed, reset } = layout;
  return { rom: { length: rom }, mapping, sram, sramSize, romSize, speed, reset, chip: null };
}
