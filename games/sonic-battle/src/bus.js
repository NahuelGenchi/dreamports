// The console's memory as the original's code sees it, for the fight, whose functions share their state through the
// work RAM at fixed addresses and copy between the cartridge, the work RAM and the video hardware with the same calls.
// Each function that uses it keeps the original's addresses, so what one sets the next reads, as in the original.

const EWRAM = 0x02000000, IWRAM = 0x03000000, IO = 0x04000000, PALETTE = 0x05000000, VRAM = 0x06000000, OAM = 0x07000000, CARTRIDGE = 0x08000000;

/** The work RAM, both parts of it, on the core `c` as `c.ram`, cleared as 0x08017c74 clears them. */
export function createRam() {
  return { ewram: new Uint8Array(0x40000), iwram: new Uint8Array(0x8000) };
}

// VRAM's top 32 KB mirrors its 16 KB of sprite tiles above 0x06018000
const vramAt = address => {
  const at = (address - VRAM) & 0x1FFFF;
  return at >= 0x18000 ? at - 0x8000 : at;
};

/** The byte at `address`, wherever it is. */
export function read8(c, address) {
  const page = address >>> 24;
  if (page === 3) return c.ram.iwram[address & 0x7FFF];
  if (page === 2) return c.ram.ewram[address & 0x3FFFF];
  if (page >= 8) return c.rom.bytes[address - CARTRIDGE];
  if (page === 6) return c.video.vram[vramAt(address)];
  if (page === 5) return (c.video.pal[(address & 0x3FF) >> 1] >> ((address & 1) * 8)) & 0xFF;
  if (page === 7) return (c.video.oam[(address & 0x3FF) >> 1] >> ((address & 1) * 8)) & 0xFF;
  throw new Error(`Nothing is read at 0x${address.toString(16)} yet.`);
}
export const read16 = (c, address) => read8(c, address) | (read8(c, address + 1) << 8);
export const read32 = (c, address) => (read16(c, address) | (read16(c, address + 2) << 16)) >>> 0;
export const reads8 = (c, address) => (read8(c, address) << 24) >> 24;
export const reads16 = (c, address) => (read16(c, address) << 16) >> 16;
export const reads32 = (c, address) => read32(c, address) | 0;

/** The byte at `address` written: in work RAM. The video hardware takes 16 bits at a time, through write16. */
export function write8(c, address, value) {
  const page = address >>> 24;
  if (page === 3) c.ram.iwram[address & 0x7FFF] = value;
  else if (page === 2) c.ram.ewram[address & 0x3FFFF] = value;
  else throw new Error(`No byte is written at 0x${address.toString(16)}.`);
}
export function write16(c, address, value) {
  const page = address >>> 24;
  value &= 0xFFFF;
  if (page === 3 || page === 2) { write8(c, address, value & 0xFF); write8(c, address + 1, value >> 8); }
  else if (page === 6) { const at = vramAt(address); c.video.vram[at] = value & 0xFF; c.video.vram[at + 1] = value >> 8; }
  else if (page === 5) c.video.pal[(address & 0x3FF) >> 1] = value;
  else if (page === 7) c.video.oam[(address & 0x3FF) >> 1] = value;
  else if (page === 4) c.video.write(address - IO, value);
  else throw new Error(`Nothing is written at 0x${address.toString(16)}.`);
}
export function write32(c, address, value) {
  write16(c, address, value & 0xFFFF);
  write16(c, address + 2, value >>> 16);
}

/** A DMA or CpuSet of `count` 16-bit words. */
export function copy16(c, from, to, count) {
  for (let i = 0; i < count; i++) write16(c, to + i * 2, read16(c, from + i * 2));
}
/** A DMA, CpuSet or CpuFastSet of `count` 32-bit words. */
export function copy32(c, from, to, count) {
  for (let i = 0; i < count; i++) write32(c, to + i * 4, read32(c, from + i * 4));
}
/** A DMA or CpuSet filling `count` 16-bit words with `value`. */
export function fill16(c, to, value, count) {
  for (let i = 0; i < count; i++) write16(c, to + i * 2, value);
}
/** A DMA, CpuSet or CpuFastSet filling `count` 32-bit words with `value`. */
export function fill32(c, to, value, count) {
  for (let i = 0; i < count; i++) write32(c, to + i * 4, value);
}

export const u8 = v => v & 0xFF;
export const u16 = v => v & 0xFFFF;
export const s8 = v => (v << 24) >> 24;
export const s16 = v => (v << 16) >> 16;
/** The BIOS's division (DivArm, 0x0804a5a0): the numerator over the denominator, rounded toward zero, as a 32-bit number. */
export function divArm(denominator, numerator) {
  clock.cycles += 76 + 13 * Math.max(1, Math.clz32(denominator) - Math.clz32(numerator));
  return Math.trunc(numerator / denominator) | 0;
}

/**
 * How many of the console's cycles the part of a frame being counted has taken, as mGBA counts its instructions with
 * WAITCNT at 0x4014: arena.js says what it's for. A division is the BIOS's, by way of mGBA's swi: what the swi itself
 * takes, and 13 for each bit the quotient can have.
 */
export const clock = { cycles: 0, counting: false };
