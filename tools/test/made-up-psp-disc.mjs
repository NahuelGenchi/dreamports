// A PlayStation Portable disc with nothing from any game on it, written here, for the tools' checks: an ISO file of
// 2048-byte sectors, as a UMD is kept, with the folders a game's disc has. Its program is PSP_GAME/SYSDIR/EBOOT.BIN, and
// UMD_DATA.BIN in the top folder holds its code, which is how the tools know a disc is the console's.

export const SECTOR = 2048;
const VOLUME = 16, END = 17, ROOT = 20;

const both32 = (bytes, at, value) => { bytes.writeUInt32LE(value, at); bytes.writeUInt32BE(value, at + 4); };
const both16 = (bytes, at, value) => { bytes.writeUInt16LE(value, at); bytes.writeUInt16BE(value, at + 2); };

// a folder's entry for a file or a folder
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
 * The disc, as bytes: `files` maps each file's path, its folders named with /, to its bytes, as
 * { 'PSP_GAME/SYSDIR/EBOOT.BIN': program }. UMD_DATA.BIN is added, with `code` as the disc's.
 */
export function madeUpPspDisc(files, { code = 'TEST-00001' } = {}) {
  const all = { 'UMD_DATA.BIN': Buffer.from(`${code}|0000000000000000|0001|G`), ...files };
  // every folder, each a sector, the top one first
  const folders = new Map([['', { sector: ROOT, entries: [] }]]);
  let next = ROOT + 1;
  const folderOf = path => {
    if (!folders.has(path)) {
      const made = { sector: next++, entries: [] };
      folders.set(path, made);
      const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      folderOf(up).entries.push({ name: path.slice(path.lastIndexOf('/') + 1), folder: made });
    }
    return folders.get(path);
  };
  for (const path of Object.keys(all)) folderOf(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const placed = [];
  for (const [path, bytes] of Object.entries(all)) {
    const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    folders.get(up).entries.push({ name: `${path.slice(path.lastIndexOf('/') + 1)};1`, sector: next, size: bytes.length });
    placed.push([next, bytes]);
    next += Math.max(1, Math.ceil(bytes.length / SECTOR));
  }
  const disc = Buffer.alloc(next * SECTOR);
  const volume = disc.subarray(VOLUME * SECTOR, (VOLUME + 1) * SECTOR);
  volume[0] = 1;
  volume.write('CD001', 1, 'latin1');
  volume[6] = 1;
  volume.write('PSP GAME'.padEnd(32), 8, 'latin1');
  volume.write('MADE UP DISC'.padEnd(32), 40, 'latin1');
  both32(volume, 80, next);
  both16(volume, 128, SECTOR);
  entry('\0', ROOT, SECTOR, true).copy(volume, 156);
  disc[END * SECTOR] = 255;
  disc.write('CD001', END * SECTOR + 1, 'latin1');
  for (const [path, { sector, entries }] of folders) {
    const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const list = [entry('\0', sector, SECTOR, true), entry('\x01', folders.get(path ? up : '').sector, SECTOR, true),
      ...entries.map(each => (each.folder ? entry(each.name, each.folder.sector, SECTOR, true) : entry(each.name, each.sector, each.size, false)))];
    Buffer.concat(list).copy(disc, sector * SECTOR);
  }
  for (const [sector, bytes] of placed) bytes.copy(disc, sector * SECTOR);
  return disc;
}
