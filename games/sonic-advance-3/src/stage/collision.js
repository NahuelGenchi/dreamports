// The ground under the characters, rewritten from the original's terrain_collision: every level has a collision map of
// metatiles of 12 by 12 tiles, each tile with a height for each of its 8 columns and rows. The
// finders look along a line, a tile at a time, for how far away the ground is, and the angle of what they find.

let map = null;

/** gRefCollision, from gCollisionTable at 0x080D0D78, for level `level`. */
export function useCollision(rom, level) {
  const at = rom.u32(0xD0D78 + level * 4) - 0x08000000;
  const ptr = o => rom.u32(at + o) - 0x08000000;
  map = {
    rom, heightMap: ptr(0), rotation: ptr(4), metatiles: ptr(8), layers: [ptr(12), ptr(16)], flags: ptr(20),
    levelX: rom.u16(at + 24), levelY: rom.u16(at + 26), pxWidth: rom.u32(at + 28), pxHeight: rom.u32(at + 32),
  };
}

const clamp = (v, max) => (v < 0 ? 0 : v > max - 1 ? max - 1 : v);
const s8 = v => (v << 24) >> 24;

// 0x080522A8: the tile at (x, y) of a layer: its number, and whether it's flipped
function tileAt(x, y, layer) {
  const { rom } = map;
  const tx = x >> 3, ty = y >> 3, mx = Math.trunc(tx / 12), my = Math.trunc(ty / 12);
  const metatile = rom.u16(map.layers[layer] + (my * map.levelX + mx) * 2);
  return rom.u16(map.metatiles + metatile * 288 + ((ty - my * 12) * 12 + (tx - mx * 12)) * 2);
}

const unflip = v => (v === 8 || v === 0 ? v : v > 0 ? v - 8 : v + 8);

// 0x08052038: along x; how far into its tile the ground starts, and its angle in out[0]
export function acrossX(p0, p1, layer, out) {
  const { rom } = map;
  p0 = clamp(p0, map.pxWidth);
  p1 = clamp(p1, map.pxHeight);
  const res = tileAt(p0, p1, layer & 1), index = res & 0x3FF;
  let row = p1 % 8;
  if (res & 0x800) row = 7 - row;
  let h = rom.u8(map.heightMap + index * 8 + row) & 0xF;
  if ((h & 8) === 8) h |= ~0xF;
  if (h === -8) h = 8;
  if (layer & 0x80 && (rom.u16(map.flags + (index >> 3) * 2) >> ((index % 8) * 2)) & 1) h = 0;
  if (res & 0x400) h = unflip(h);
  let rotation = rom.u8(map.rotation + index);
  if (res & 0x800) rotation = (-0x80 - rotation) & 0xFF;
  if (res & 0x400 && h !== 0) rotation = -rotation & 0xFF;
  out[0] = rotation;
  return h;
}

// 0x08052178: along y
export function acrossY(p0, p1, layer, out) {
  const { rom } = map;
  p1 = clamp(p1, map.pxWidth);
  p0 = clamp(p0, map.pxHeight);
  const res = tileAt(p1, p0, layer & 1), index = res & 0x3FF;
  let column = p1 & 7;
  if (res & 0x400) column = 7 - column;
  let h = s8(rom.u8(map.heightMap + index * 8 + column)) >> 4;
  if (h === -8) h = 8;
  if (layer & 0x80 && (rom.u16(map.flags + (index >> 3) * 2) >> ((index & 7) * 2)) & 1) h = 0;
  if (res & 0x800) h = unflip(h);
  let rotation = rom.u8(map.rotation + index);
  if (res & 0x400) rotation = -rotation & 0xFF;
  if (res & 0x800 && h !== 0) rotation = (-0x80 - rotation) & 0xFF;
  out[0] = rotation;
  return h;
}

const fromP3 = (p0, p3, i) => (p3 > 0 ? ~(p0 & 7) + i * 8 : (p0 & 7) + (i - 1) * 8);
const fromRes = (p0, res, i) => (res > 0 ? res - 1 - (p0 & 7) + i * 8 : res + (p0 & 7) + i * 8);
const missed = (p0, p3, i) => (p3 > 0 ? (i + 1) * 8 - (p0 & 7) : (p0 & 7) + i * 8 + 1);
const invNot = (p0, p3, i) => (p3 > 0 ? ~(p0 & 7) - i * 8 : (p0 & 7) - (i + 1) * 8);
const missedNeg = (p0, p3, i) => (p3 > 0 ? -((i - 1) * 8 + 1) - (p0 & 7) : (p0 & 7) - i * 8);

/**
 * 0x080519E8 and 0x080517F8: from p0, in steps of p3, a tile at a time, how far the ground is along that line, negative
 * if it's inside it. `steps` is how many tiles it looks ahead, 2 or 5. out[0] gets its angle.
 */
export function findGround(steps, p0, p1, layer, p3, out, across) {
  const data = [0];
  let res = across(p0, p1, layer, data);
  if (res === 0) {
    for (let i = 1; i <= steps; i++) {
      res = across(p0 + p3 * i, p1, layer, data);
      if (res === 0) {
        if (i === steps) return missed(p0, p3, steps);
        continue;
      }
      if (out) out[0] = data[0];
      return res === 8 ? fromP3(p0, p3, i) : fromRes(p0, res, i);
    }
  }
  if (res === 8) {
    if (out) out[0] = data[0];
    let it = -p3;
    res = across(p0 + it, p1, layer, data);
    if (res === 8) {
      if (out) out[0] = data[0];
      it -= p3;
      res = across(p0 + it, p1, layer, data);
      if (res === 8) {
        if (out) out[0] = data[0];
        return invNot(p0, p3, 2);
      }
      if (res === 0) return missedNeg(p0, p3, 2);
      if (out) out[0] = data[0];
      return fromRes(p0, res, -2);
    }
    if (res === 0) return fromP3(p0, p3, 0);
    if (out) out[0] = data[0];
    return fromRes(p0, res, -1);
  }
  if (out) out[0] = data[0];
  return res <= 0 ? res + (p0 & 7) : res - 1 - (p0 & 7);
}
