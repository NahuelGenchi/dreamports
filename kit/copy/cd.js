// A CD's sectors as its drive reads them, 2352 bytes each: what a copy that keeps only a sector's data, as an ISO or a
// compressed disc does, leaves out, made again as the disc holds it (ECMA-130). A data sector starts with 12 bytes of
// sync and 4 of header, its address as minutes, seconds and frames in BCD and its mode, and ends with an error detection
// code (EDC) and, but for Mode 2 Form 2, two layers of error correction (ECC P and Q), which are worked out from the
// rest. Sector 0 of a disc, as its drive counts them (LBA), is at 00:02:00.

/** A CD sector's size, as a drive reads it whole. */
export const RAW = 2352;
/** A data sector's data, in Mode 1 and Mode 2 Form 1. */
export const DATA = 2048;
/** How many sectors a disc's first track starts after 00:00:00: two seconds' worth. */
export const LEAD = 150;

const SYNC = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00];
const bcd = n => ((n / 10) | 0) << 4 | n % 10;

/** A sector's address as minutes, seconds and frames, 75 frames a second, in BCD as its header holds it. */
export function msf(lba) {
  const at = lba + LEAD;
  return [bcd(Math.floor(at / 4500)), bcd(Math.floor(at / 75) % 60), bcd(at % 75)];
}

// the EDC's table: a CRC of 32 bits, its polynomial reversed
const EDC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let edc = i;
  for (let bit = 0; bit < 8; bit++) edc = (edc >>> 1) ^ (edc & 1 ? 0xD8018001 : 0);
  EDC[i] = edc >>> 0;
}
function edcOf(sector, from, to) {
  let edc = 0;
  for (let i = from; i < to; i++) edc = (edc >>> 8) ^ EDC[(edc ^ sector[i]) & 0xFF];
  return edc >>> 0;
}
function putEdc(sector, from, to, at) {
  const edc = edcOf(sector, from, to);
  sector[at] = edc;
  sector[at + 1] = edc >>> 8;
  sector[at + 2] = edc >>> 16;
  sector[at + 3] = edc >>> 24;
}

// the ECC's two tables, sums in the field of 256 the code works in
const ECC_F = new Uint8Array(256), ECC_B = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const j = (i << 1) ^ (i & 0x80 ? 0x11D : 0);
  ECC_F[i] = j;
  ECC_B[i ^ j] = i;
}
// one layer of ECC over the 2340 bytes after the sync (`base` is where they start), into `at`: P is 86 columns of 24, Q
// 52 diagonals of 43
function eccLayer(sector, base, majors, minors, majorStep, minorStep, at) {
  const size = majors * minors;
  for (let major = 0; major < majors; major++) {
    let index = (major >> 1) * majorStep + (major & 1), a = 0, b = 0;
    for (let minor = 0; minor < minors; minor++) {
      const byte = sector[base + index];
      index += minorStep;
      if (index >= size) index -= size;
      a ^= byte;
      b ^= byte;
      a = ECC_F[a];
    }
    a = ECC_B[ECC_F[a] ^ b];
    sector[at + major] = a;
    sector[at + major + majors] = a ^ b;
  }
}
function putEcc(sector) {
  eccLayer(sector, 12, 86, 24, 2, 86, 0x81C);
  eccLayer(sector, 12, 52, 43, 86, 88, 0x8C8);
}

/**
 * Makes the parts of data sector `lba`, in `sector` (2352 bytes from `at`), that a copy keeping only its data leaves out:
 * its sync, its header, a Mode 2 sector's subheader (`subheader`, 4 bytes, given twice; data of Form 1 unless said), its
 * EDC and its ECC. `mode` is 1 or 2; `form` 1 or 2 for Mode 2. The data is already in place: from byte 16 in Mode 1, from
 * byte 24 in Mode 2.
 */
export function makeSector(sector, lba, mode, { form = 1, subheader = [0, 0, form === 2 ? 0x28 : 0x08, 0], at = 0 } = {}) {
  const s = at ? sector.subarray(at, at + RAW) : sector;
  s.set(SYNC, 0);
  const [m, sec, f] = msf(lba);
  s[12] = m;
  s[13] = sec;
  s[14] = f;
  s[15] = mode;
  if (mode === 1) {
    putEdc(s, 0, 0x810, 0x810);
    s.fill(0, 0x814, 0x81C);
    putEcc(s);
    return;
  }
  s.set(subheader, 16);
  s.set(subheader, 20);
  if (form === 2) {
    putEdc(s, 16, 0x92C, 0x92C);
    return;
  }
  putEdc(s, 16, 0x818, 0x818);
  // Mode 2's ECC is worked out with the header as zeros, as the header isn't part of what it guards
  const header = Uint8Array.from(s.subarray(12, 16));
  s.fill(0, 12, 16);
  putEcc(s);
  s.set(header, 12);
}

/** Puts back a whole sector's sync and its ECC, as a compressed CD in a CHD leaves them out where they could be made
 *  again from the rest (the CD codecs' flags). */
export function makeSyncAndEcc(sector, at = 0) {
  const s = at ? sector.subarray(at, at + RAW) : sector;
  s.set(SYNC, 0);
  if (s[15] === 2) {
    const header = Uint8Array.from(s.subarray(12, 16));
    s.fill(0, 12, 16);
    putEcc(s);
    s.set(header, 12);
  } else putEcc(s);
}

/** Whether `sector` (2352 bytes from `at`) starts with a data sector's sync. */
export function hasSync(sector, at = 0) {
  for (let i = 0; i < 12; i++) if (sector[at + i] !== SYNC[i]) return false;
  return true;
}
