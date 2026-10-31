// Which game a Game Boy Advance copy is: its cartridge's header names the game and its region, and the SHA-1 of the
// whole file tells its versions apart, as the kit's kit/gba/rom/identify.js does in the browser.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// the last letter of a game code: the region the cartridge was made for
const REGIONS = { J: 'Japan', E: 'USA', P: 'Europe', D: 'Germany', F: 'France', I: 'Italy', S: 'Spain', K: 'Korea', C: 'China', X: 'Europe', Y: 'Europe' };

/** Reads a copy: { title, code, region, revision, size, sha1 }, or null when it isn't a Game Boy Advance ROM. */
export async function readCopy(path) {
  const bytes = await readFile(path);
  // the fixed value every cartridge header has at 0xB2
  if (bytes.length < 0x200 || bytes[0xB2] !== 0x96) return null;
  const ascii = (at, length) => bytes.toString('latin1', at, at + length).replace(/\0+$/, '');
  const code = ascii(0xAC, 4);
  return {
    title: ascii(0xA0, 12),
    code,
    region: REGIONS[code[3]] ?? null,
    revision: bytes[0xBC],
    size: bytes.length,
    sha1: createHash('sha1').update(bytes).digest('hex'),
  };
}
