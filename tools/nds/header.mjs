// A Nintendo DS cartridge's header, its first 0x160 bytes: what the game is called, and where its programs and its
// files are in the copy. Everything is read from the copy on this computer and stays here.
//
// The console has two processors, each with a program of its own: the ARM9's, which is most of a game, and the ARM7's,
// which reads the touch screen and plays the sound. The header says where each is in the cartridge, where the console
// loads it in memory and where it starts. A game can load more code as it plays, its overlays, listed in a table of
// their own for each processor, and keeps its other files in a file system, a table of names and a table of where each
// file is.

/** The checksum a header keeps of its first 0x15E bytes, at 0x15E: CRC-16 as Modbus has it. */
export function crc16(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
  }
  return crc;
}

const HEADER = 0x160;
const ascii = (bytes, at, length) => bytes.toString('latin1', at, at + length).replace(/[\0\s]+$/, '').trim();
// the last letter of a game's code is where it was sold
const REGIONS = { J: 'Japan', E: 'USA', P: 'Europe', K: 'Korea', U: 'Australia', C: 'China' };

/** Whether these bytes start as a Nintendo DS cartridge does: a header whose checksum adds up, with its ARM9 program past it. */
export function isNdsHeader(bytes) {
  if (bytes.length < HEADER) return false;
  const arm9 = bytes.readUInt32LE(0x20), entry = bytes.readUInt32LE(0x24);
  return bytes.readUInt16LE(0x15E) === crc16(bytes.subarray(0, 0x15E)) && arm9 >= 0x200 && entry >>> 24 === 0x02;
}

// a program as the header has it: where it is in the copy, where it starts, where it's loaded and how long it is
const programAt = (bytes, at) => ({ offset: bytes.readUInt32LE(at), entry: bytes.readUInt32LE(at + 4), address: bytes.readUInt32LE(at + 8), size: bytes.readUInt32LE(at + 12) });
// a table as the header has it: where it is in the copy and how long it is
const tableAt = (bytes, at) => ({ offset: bytes.readUInt32LE(at), size: bytes.readUInt32LE(at + 4) });

/**
 * What a copy's header says: { title, code, maker, region, revision, arm9, arm7, each { offset, entry, address, size },
 * files: { names, places }, the file system's two tables, overlays: { arm9, arm7 }, each processor's table of overlays,
 * each { offset, size }, banner, where its icon and titles are, and size, how much of the cartridge is used }.
 */
export function readNdsHeader(bytes) {
  if (!isNdsHeader(bytes)) throw new Error('This isn\'t a Nintendo DS cartridge: its header\'s checksum doesn\'t add up.');
  const code = ascii(bytes, 0xC, 4);
  return {
    title: ascii(bytes, 0, 12), code, maker: ascii(bytes, 0x10, 2), region: REGIONS[code[3]] ?? null, revision: bytes[0x1E],
    arm9: programAt(bytes, 0x20), arm7: programAt(bytes, 0x30),
    files: { names: tableAt(bytes, 0x40), places: tableAt(bytes, 0x48) },
    overlays: { arm9: tableAt(bytes, 0x50), arm7: tableAt(bytes, 0x58) },
    banner: bytes.readUInt32LE(0x68), size: bytes.readUInt32LE(0x80),
  };
}
