// Which game and which version a player's ROM is: the cartridge header names the game, and the SHA-1 of the
// whole ROM tells its versions apart.

import { Rom } from './rom.js';

export class RomError extends Error {}

/** SHA-1 of the whole ROM as lowercase hex, or null when the browser has no Web Crypto (non-secure contexts). */
export async function sha1Hex(buffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buffer));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Reads the GBA cartridge header (title at 0xA0, game code at 0xAC, version at 0xBC). */
export function readHeader(rom) {
  return { title: rom.ascii(0xA0, 12), code: rom.ascii(0xAC, 4), maker: rom.ascii(0xB0, 2), revision: rom.u8(0xBC) };
}

/** Whether the header of `buffer` names the game whose header title is `title`, before the full check: which game a file is. */
export function namesGame(buffer, title) {
  const rom = new Rom(buffer);
  return rom.size >= 0x200 && rom.u8(0xB2) === 0x96 && readHeader(rom).title === title;
}

/**
 * Checks that `rom` is the game `game` describes and matches it against the versions the game knows: its name
 * for the player, `name`; its header's `title`; its game `codes`, each with its region ({ AXXE: 'USA' }); and
 * `versions`, each with the `sha1` of its whole ROM. Resolves to { header, region, sha1, known }, `known` being
 * the version it is or null. Throws RomError with a message meant for the player when it is not that game.
 */
export async function identify(rom, { name, title, codes, versions = [] }) {
  if (rom.size < 0x200 || rom.u8(0xB2) !== 0x96) {
    throw new RomError('This file is not a Game Boy Advance ROM.');
  }
  const header = readHeader(rom);
  if (header.title !== title || !(header.code in codes)) {
    throw new RomError(`This is a Game Boy Advance ROM, but not ${name} (its header says "${header.title}", ${header.code}).`);
  }
  const sha1 = await sha1Hex(rom.buffer);
  const known = versions.find(v => v.sha1 === sha1) ?? null;
  return { header, region: codes[header.code], sha1, known };
}
