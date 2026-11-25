// A GameCube disc (disc.js), as the console itself reads it: its header, with the game's code, the program it boots (the
// DOL), the small program that loads it (the apploader), and its own file system (the FST), which isn't ISO 9660. Every
// number on it is kept with its highest byte first, as the console keeps them. A program alone, a .dol file, is read by
// the same dolOf.

const DATA = 2048;
/** The word every GameCube disc has 0x1C bytes in. */
export const GCM_MAGIC = 0xC2339F3D;
const u32 = (b, at) => (b[at] * 2 ** 24 + (b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3])) >>> 0;
const text = (bytes, at, length) => {
  let words = '';
  for (let i = at; i < at + length && i < bytes.length && bytes[i]; i++) words += String.fromCharCode(bytes[i]);
  return words.trim();
};
// the fourth letter of a game's code says where it was sold
const REGIONS = { E: 'USA', J: 'Japan', P: 'Europe', D: 'Europe', F: 'Europe', I: 'Europe', S: 'Europe', X: 'Europe', Y: 'Europe', U: 'Europe', K: 'Korea' };
// how many sections of code and of values a DOL can have, and where its header ends
const TEXTS = 7, SECTIONS = 18, DOL_HEADER = 0x100;
// where a program can be in the console's memory, 24 MB from 0x80000000, past what the console keeps for itself
const LOWEST = 0x80003100, HIGHEST = 0x81800000;

/** Whether these first bytes of a file are a GameCube disc's. */
export const isGcm = head => head.length >= 0x20 && u32(head, 0x1C) === GCM_MAGIC;

/** `length` bytes of a disc from byte `at`, read by its sectors. */
export async function bytesOn(disc, at, length) {
  if (length <= 0) return new Uint8Array(0);
  const first = Math.floor(at / DATA), count = Math.ceil((at % DATA + length) / DATA);
  const sectors = await disc.data(first, count);
  return sectors.subarray(at % DATA, at % DATA + length);
}

/**
 * A GameCube disc's header: { code, game, maker, disc, version, region, title, dol, fst: { at, size }, apploader: {
 * date, entry, size, trailer, at } }, or null when the disc isn't one. `code` is the six letters that name the game and
 * who published it, `dol` where its boot program starts, and `apploader.at` where the apploader's own code starts.
 */
export async function headerOf(disc) {
  const head = await bytesOn(disc, 0, 0x2460);
  if (head.length < 0x2460 || !isGcm(head)) return null;
  const code = text(head, 0, 6);
  return {
    code, game: code.slice(0, 4), maker: code.slice(4, 6), disc: head[6], version: head[7], region: REGIONS[code[3]] ?? null,
    title: text(head, 0x20, 0x3E0), dol: u32(head, 0x420), fst: { at: u32(head, 0x424), size: u32(head, 0x428) },
    apploader: { date: text(head, 0x2440, 16), entry: u32(head, 0x2450), size: u32(head, 0x2454), trailer: u32(head, 0x2458), at: 0x2460 },
  };
}

/**
 * What a DOL's header says, from its first 0x100 bytes: { sections: [{ kind, at, address, size }], bss: { address, size
 * }, entry, size }, or null when they can't be one. `kind` is 'text' for code and 'data' for values, `at` where the
 * section is in the file, `address` where it goes in the console's memory, and `size` the whole file's length. A DOL has
 * no word that says it's one, so every section must fit the console's memory, none may lie on another, and the program
 * must start in its code.
 */
export function dolHeader(bytes) {
  if (bytes.length < DOL_HEADER) return null;
  const sections = [];
  for (let n = 0; n < SECTIONS; n++) {
    const at = u32(bytes, n * 4), address = u32(bytes, 0x48 + n * 4), size = u32(bytes, 0x90 + n * 4);
    if (!size) continue;
    if (at < DOL_HEADER || address < LOWEST || address + size > HIGHEST || (address & 3) || (at & 3)) return null;
    sections.push({ kind: n < TEXTS ? 'text' : 'data', at, address, size });
  }
  const bss = { address: u32(bytes, 0xD8), size: u32(bytes, 0xDC) }, entry = u32(bytes, 0xE0);
  if (!sections.some(({ kind, address, size }) => kind === 'text' && entry >= address && entry < address + size) || (entry & 3)) return null;
  if (bss.size && (bss.address < LOWEST || bss.address + bss.size > HIGHEST)) return null;
  for (let i = 0x100 - 0x1C; i < 0x100; i++) if (bytes[i]) return null;
  const byPlace = [...sections].sort((a, b) => a.at - b.at), byAddress = [...sections].sort((a, b) => a.address - b.address);
  for (let n = 1; n < sections.length; n++) {
    if (byPlace[n].at < byPlace[n - 1].at + byPlace[n - 1].size || byAddress[n].address < byAddress[n - 1].address + byAddress[n - 1].size) return null;
  }
  return { sections, bss, entry, size: Math.max(DOL_HEADER, ...sections.map(({ at, size }) => at + size)) };
}

/** The program a disc boots: dolHeader's fields, with `at`, where it starts on the disc, and `bytes`, the whole of it; or null. */
export async function dolOf(disc) {
  const header = await headerOf(disc);
  if (!header) return null;
  const dol = dolHeader(await bytesOn(disc, header.dol, DOL_HEADER));
  return dol && { ...dol, at: header.dol, bytes: await bytesOn(disc, header.dol, dol.size) };
}

/**
 * Every file on a GameCube disc, as its file system lists them: [{ name, at, size }], `name` with the folders it's in,
 * as audio/title.bin, and `at` the byte of the disc it starts at; or null when the disc isn't one.
 */
export async function filesOf(disc) {
  const header = await headerOf(disc);
  if (!header || header.fst.size < 12) return null;
  const fst = await bytesOn(disc, header.fst.at, header.fst.size);
  const count = u32(fst, 8), names = count * 12;
  if (!(fst[0] & 1) || names > fst.length) return null;
  const files = [];
  // each folder's entries go on to the entry its own says is the next past it
  const ends = [count], folders = [''];
  for (let n = 1; n < count; n++) {
    while (n >= ends.at(-1)) { ends.pop(); folders.pop(); }
    const at = n * 12, name = text(fst, names + (u32(fst, at) & 0xFFFFFF), 256);
    if (fst[at] & 1) {
      const end = u32(fst, at + 8);
      if (end <= n || end > ends.at(-1)) return null;
      ends.push(end);
      folders.push(`${folders.at(-1)}${name}/`);
    } else files.push({ name: `${folders.at(-1)}${name}`, at: u32(fst, at + 4), size: u32(fst, at + 8) });
  }
  return files;
}

/** A file's bytes, by its name with its folders, in any case, the first `limit` of them, or null when there's none. */
export async function readGcmFile(disc, path, limit = Infinity) {
  const wanted = path.split(/[\\/]/).filter(Boolean).join('/').toUpperCase();
  const file = (await filesOf(disc))?.find(({ name }) => name.toUpperCase() === wanted);
  return file ? bytesOn(disc, file.at, Math.min(file.size, limit)) : null;
}

/** Which console a disc with no ISO 9660 volume is for: { console: 'gamecube', title, code, region }, or null. */
export async function whatGcm(disc) {
  const header = await headerOf(disc);
  return header && { console: 'gamecube', title: header.title, code: header.code, region: header.region };
}
