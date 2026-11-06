// A made-up Game Boy Advance cartridge with nothing from any game in it, to try the tools and a game's page without
// anyone's copy of anything: only a header and a loop that does nothing.

import { createHash } from 'node:crypto';

/** The cartridge's bytes, with the title and code in its header, and its SHA-1, as original.json would have it: `size` bytes, the rest of them 0. */
export function madeUpGame({ title = 'MADE UP GAME', code = 'MADE', size = 0x400 } = {}) {
  const rom = Buffer.alloc(size);
  rom.writeUInt32LE(0xEA00002E, 0);    // b 0xC0
  rom.write(title.slice(0, 12), 0xA0, 'latin1');
  rom.write(code.slice(0, 4), 0xAC, 'latin1');
  rom.write('00', 0xB0, 'latin1');
  rom[0xB2] = 0x96;
  let sum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) sum = (sum - rom[i]) & 0xFF;
  rom[0xBD] = (sum - 0x19) & 0xFF;
  rom.writeUInt32LE(0xEAFFFFFE, 0xC0); // b .
  return { rom, sha1: createHash('sha1').update(rom).digest('hex') };
}
