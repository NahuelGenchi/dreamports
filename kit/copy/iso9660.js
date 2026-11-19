// The files on a disc (disc.js), as its ISO 9660 volume lists them: what the disc says it is, and a file by its name,
// read a sector at a time. Every PlayStation, PlayStation 2 and PlayStation Portable disc has one.

const text = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length)).replace(/[\0\s]+$/, '').trim();
const u32 = (b, at) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;
// a folder is read whole up to this size, far more than any game's has
const FOLDER = 0x10000;

/** The disc's volume: { system, title, root: { lba, size } }, or null when it has none. */
export async function volumeOf(disc) {
  if (disc.sectors <= 16) return null;
  const volume = await disc.data(16, 1);
  if (text(volume, 1, 5) !== 'CD001') return null;
  return { system: text(volume, 8, 32), title: text(volume, 40, 32), root: { lba: u32(volume, 158), size: u32(volume, 166) } };
}

/**
 * Where a file is, by its name in the disc's top folder, such as SYSTEM.CNF, or with the folders it's in before it, as
 * GAME\MAIN.EXE, in any case: { lba, size, folder }, or null when there's none of that name.
 */
export async function fileOn(disc, path) {
  const volume = await volumeOf(disc);
  if (!volume) return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return null;
  let place = volume.root;
  for (const [n, part] of parts.entries()) {
    // a folder takes a sector at least, whatever its size says
    const size = Math.max(2048, Math.min(place.size, FOLDER)), folder = await disc.data(place.lba, Math.ceil(size / 2048));
    let found = null;
    // each sector holds whole entries, and zeros after the last
    for (let at = 0; at + 33 < size;) {
      if (!folder[at]) { at = (Math.floor(at / 2048) + 1) * 2048; continue; }
      if (text(folder, at + 33, folder[at + 32]).replace(/;\d+$/, '').toUpperCase() === part.toUpperCase()) {
        found = { lba: u32(folder, at + 2), size: u32(folder, at + 10), folder: (folder[at + 25] & 2) !== 0 };
        break;
      }
      at += folder[at];
    }
    if (!found || found.folder !== (n < parts.length - 1)) return null;
    place = found;
  }
  return place;
}

/** A file's bytes, by its name as fileOn takes it, the first `limit` of them, or null when there's none. */
export async function readFileOn(disc, path, limit = Infinity) {
  const file = await fileOn(disc, path);
  if (!file) return null;
  const size = Math.min(file.size, limit);
  return (await disc.data(file.lba, Math.ceil(size / 2048))).subarray(0, size);
}

/**
 * Which console a disc is for, and what it names: { console, title, code }. A PlayStation 2 disc's SYSTEM.CNF names
 * the program it boots with BOOT2, a PlayStation's with BOOT, and a PlayStation Portable's UMD_DATA.BIN its code. A disc
 * of anything else has `console` null.
 */
export async function whatDisc(disc) {
  const volume = await volumeOf(disc);
  if (!volume) return null;
  const { system, title } = volume;
  if (system.startsWith('PSP')) {
    const data = await readFileOn(disc, 'UMD_DATA.BIN', 2048);
    return { console: 'psp', title, code: data ? text(data, 0, 10).split('|')[0] : '' };
  }
  if (system.startsWith('PLAYSTATION')) {
    const boot = await readFileOn(disc, 'SYSTEM.CNF', 2048);
    const found = boot && /BOOT(2?)\s*=\s*[^\\:]*:\\?([^;\s]+)/i.exec(new TextDecoder('latin1').decode(boot));
    return { console: found?.[1] === '2' ? 'ps2' : 'ps1', title, code: found?.[2].replace('\\', '') ?? '' };
  }
  return { console: null, title, code: '' };
}

/** The name of the program a PlayStation 2 disc boots, as its SYSTEM.CNF says, such as SLUS_205.73, or null. */
export async function bootOf(disc) {
  const boot = await readFileOn(disc, 'SYSTEM.CNF', 2048);
  return (boot && /BOOT2\s*=\s*[^\\:]*:\\?([^;\s]+)/i.exec(new TextDecoder('latin1').decode(boot))?.[1]) ?? null;
}
