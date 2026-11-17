// The console's memory as the function check compares it (twin.mjs): five memories one after another, the image, laid
// out as the program that calls the original lays it out (call.c).

export const CARTRIDGE = 0x08000000;

/** Each memory: where it is in the image, where the console has it, how long it is and what it is. One with `kit` is
 *  the hardware's, which a twin reaches through the kit: for twins built on the kit it's the kit's memory of that name,
 *  wherever the module keeps it, that is given and compared, and not the console's address (kit/gba/c/gba.h). */
export const REGIONS = [
  { at: 0, address: 0x02000000, bytes: 0x40000, name: 'the work memory' },
  { at: 0x40000, address: 0x03000000, bytes: 0x8000, name: 'the work memory' },
  { at: 0x48000, address: 0x05000000, bytes: 0x400, name: 'the palette', kit: 'gba_pal' },
  { at: 0x48400, address: 0x06000000, bytes: 0x18000, name: 'the video memory', kit: 'gba_vram' },
  { at: 0x60400, address: 0x07000000, bytes: 0x400, name: 'the sprites\' list', kit: 'gba_oam' },
];

export const IMAGE = 0x60800;

/** Where an address is in the image, or -1. */
export function inImage(address) {
  for (const region of REGIONS) if (address >= region.address && address < region.address + region.bytes) return region.at + address - region.address;
  return -1;
}

/** The address of a place in the image, and which memory it's in. */
export function addressAt(at) {
  const region = REGIONS.findLast(r => at >= r.at);
  return { address: region.address + at - region.at, name: region.name };
}
