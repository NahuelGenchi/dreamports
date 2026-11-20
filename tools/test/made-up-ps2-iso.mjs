// A PlayStation 2 disc with nothing from any game on it, written here, for the tools' checks on the console's real
// emulator: an ISO file of 2048-byte sectors whose SYSTEM.CNF boots one of the made-up programs (made-up-ps2.mjs), with
// any other files beside it, all in the top folder. The emulator finds a file through the volume's path table, so the
// disc has one, as every real disc does.

export const SECTOR = 2048;
// where the volume's parts are: its descriptor and the end of the descriptors, then the path table and the top folder
const VOLUME = 16, END = 17, PATHS = 18, ROOT = 19;

// a number both ways round, as ISO 9660 keeps most of them
const both32 = (bytes, at, value) => { bytes.writeUInt32LE(value, at); bytes.writeUInt32BE(value, at + 4); };
const both16 = (bytes, at, value) => { bytes.writeUInt16LE(value, at); bytes.writeUInt16BE(value, at + 2); };

function entry(name, sector, size, folder) {
  const named = Buffer.from(name, 'latin1'), length = 33 + named.length + (named.length % 2 ? 0 : 1);
  const bytes = Buffer.alloc(length);
  bytes[0] = length;
  both32(bytes, 2, sector);
  both32(bytes, 10, size);
  bytes[25] = folder ? 2 : 0;
  both16(bytes, 28, 1);
  bytes[32] = named.length;
  named.copy(bytes, 33);
  return bytes;
}

/**
 * The disc, as bytes, and where each file is on it: `files` maps each file's name in the top folder to its bytes, in the
 * order they go on the disc. Returns { disc, sectors }, `sectors` each file's first sector and how many it takes, by name.
 */
export function madeUpPs2Iso(files) {
  let next = ROOT + 1;
  const placed = Object.entries(files).map(([name, bytes]) => {
    const at = next, count = Math.max(1, Math.ceil(bytes.length / SECTOR));
    next += count;
    return { name, bytes, at, count };
  });
  const disc = Buffer.alloc(next * SECTOR);
  const volume = disc.subarray(VOLUME * SECTOR, (VOLUME + 1) * SECTOR);
  volume[0] = 1;
  volume.write('CD001', 1, 'latin1');
  volume[6] = 1;
  volume.write('PLAYSTATION'.padEnd(32), 8, 'latin1');
  volume.write('MADE_UP'.padEnd(32), 40, 'latin1');
  both32(volume, 80, next);
  both16(volume, 120, 1);
  both16(volume, 124, 1);
  both16(volume, 128, SECTOR);
  // the path table, with the top folder alone: its name's length, where it is, and its parent, itself
  const paths = Buffer.from([1, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  paths.writeUInt32LE(ROOT, 2);
  both32(volume, 132, paths.length);
  volume.writeUInt32LE(PATHS, 140);
  volume.writeUInt32BE(PATHS, 148);
  entry('\0', ROOT, SECTOR, true).copy(volume, 156);
  volume[881] = 1;
  disc[END * SECTOR] = 255;
  disc.write('CD001', END * SECTOR + 1, 'latin1');
  disc[END * SECTOR + 6] = 1;
  paths.copy(disc, PATHS * SECTOR);
  Buffer.concat([entry('\0', ROOT, SECTOR, true), entry('\x01', ROOT, SECTOR, true), ...placed.map(file => entry(`${file.name};1`, file.at, file.bytes.length, false))]).copy(disc, ROOT * SECTOR);
  for (const file of placed) file.bytes.copy(disc, file.at * SECTOR);
  return { disc, sectors: Object.fromEntries(placed.map(file => [file.name, { at: file.at, count: file.count }])) };
}

/** What SYSTEM.CNF says to boot a program called `name` in the top folder. */
export const systemCnf = name => Buffer.from(`BOOT2 = cdrom0:\\${name};1\r\nVER = 1.00\r\nVMODE = NTSC\r\n`, 'latin1');
