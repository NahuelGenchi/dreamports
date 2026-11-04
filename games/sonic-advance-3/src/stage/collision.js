// The ground under the characters, written from how the original measures it (0x08052038, 0x08052178, 0x080522A8,
// 0x080517F8 and 0x080519E8). Every level has a map of metatiles of 12 by 12 tiles for each of its two layers, and each
// tile says how tall its ground is at each of its 8 columns, and how deep at each of its 8 rows, with the angle of its surface.

const TILE = 8, METATILE_TILES = 12, FULL = 8, ONE_WAY = 0x80;
const X_FLIP = 0x400, Y_FLIP = 0x800;

let ground = null;

/** The level's collision, from the table at 0x080D0D78. */
export function useCollision(rom, level) {
  const at = rom.u32(0xD0D78 + level * 4) - 0x08000000;
  const pointer = offset => rom.u32(at + offset) - 0x08000000;
  ground = {
    rom, heights: pointer(0), angles: pointer(4), metatiles: pointer(8), layers: [pointer(12), pointer(16)], oneWay: pointer(20),
    metatilesWide: rom.u16(at + 24), width: rom.u32(at + 28), height: rom.u32(at + 32),
  };
}

const inside = (v, size) => Math.max(0, Math.min(size - 1, v));
const mirrorHeight = h => (h === FULL || h === 0 ? h : h > 0 ? h - FULL : h + FULL);
const flipAngleX = a => -a & 0xFF, flipAngleY = a => (-0x80 - a) & 0xFF;

function tileAt(x, y, layer) {
  const { rom } = ground, column = x >> 3, row = y >> 3;
  const blockX = Math.floor(column / METATILE_TILES), blockY = Math.floor(row / METATILE_TILES);
  const block = rom.u16(ground.layers[layer] + (blockY * ground.metatilesWide + blockX) * 2);
  return rom.u16(ground.metatiles + block * METATILE_TILES * METATILE_TILES * 2 + ((row - blockY * METATILE_TILES) * METATILE_TILES + column - blockX * METATILE_TILES) * 2);
}

// How much ground the tile at (x, y) has along the way a line runs through it, up and down when `vertical`, side to
// side when not: 0 for none, FULL for all of it, and otherwise how far from an edge it starts. `angle[0]` gets its surface's.
function tileGround(x, y, layer, vertical, angle) {
  const { rom } = ground;
  const tile = tileAt(inside(x, ground.width), inside(y, ground.height), layer & 1), index = tile & 0x3FF;
  const flipAcross = tile & (vertical ? X_FLIP : Y_FLIP), flipAlong = tile & (vertical ? Y_FLIP : X_FLIP);
  const place = (vertical ? inside(x, ground.width) : inside(y, ground.height)) & 7;
  const packed = rom.u8(ground.heights + index * TILE + (flipAcross ? 7 - place : place));
  const nibble = vertical ? packed >> 4 : packed & 0xF;
  let height = nibble >= FULL ? nibble - 16 : nibble;
  if (height === -FULL) height = FULL;
  if (layer & ONE_WAY && (rom.u16(ground.oneWay + (index >> 3) * 2) >> ((index & 7) * 2)) & 1) height = 0;
  if (flipAlong) height = mirrorHeight(height);
  let surface = rom.u8(ground.angles + index);
  if (flipAcross) surface = vertical ? flipAngleX(surface) : flipAngleY(surface);
  if (flipAlong && height !== 0) surface = vertical ? flipAngleY(surface) : flipAngleX(surface);
  angle[0] = surface;
  return height;
}

// How far the ground is from `start`, along a line looking the way `stride` points, a tile at a time: positive when it's
// ahead, negative when `start` is inside it. It looks `reach` tiles ahead when `start` is clear of the ground, and up to
// two tiles back when it's in solid ground, for where that ground ends. `angle[0]`, if given, gets its surface's angle.
function distanceToGround(start, across, layer, stride, reach, angle, vertical) {
  const pixel = start & 7, ahead = stride > 0, seen = [0];
  const read = tiles => (vertical ? tileGround(across, start + stride * tiles, layer, true, seen) : tileGround(start + stride * tiles, across, layer, false, seen));
  const keep = () => { if (angle) angle[0] = seen[0]; };
  const solidEdge = tiles => (ahead ? -1 - pixel : pixel - TILE) + tiles * TILE;
  const slopeEdge = (height, tiles) => (height > 0 ? height - 1 - pixel : height + pixel) + tiles * TILE;

  let height = read(0);
  if (height === FULL) {
    keep();
    for (let back = 1; back <= 2; back++) {
      height = read(-back);
      if (height === 0) return solidEdge(1 - back);
      keep();
      if (height !== FULL) return slopeEdge(height, -back);
    }
    return solidEdge(-2);
  }
  for (let tiles = 0; tiles <= reach; tiles++) {
    if (tiles > 0) height = read(tiles);
    if (height !== 0) {
      keep();
      return height === FULL ? solidEdge(tiles) : slopeEdge(height, tiles);
    }
  }
  return ahead ? (reach + 1) * TILE - pixel : pixel + reach * TILE + 1;
}

/** The ground above or below (`stride` -8 or 8) the point (x, fromY). */
export const groundUpDown = (fromY, x, layer, stride, angle = null, reach = 2) => distanceToGround(fromY, x, layer, stride, reach, angle, true);
/** The ground to the left or right (`stride` -8 or 8) of the point (fromX, y). */
export const groundSideways = (fromX, y, layer, stride, angle = null, reach = 2) => distanceToGround(fromX, y, layer, stride, reach, angle, false);

// 0x08052178 and 0x08051F50: how far the ground is, looking only at the tile the point is in, as enemies and scattered
// rings do
function inOneTile(height, start, stride) {
  const pixel = start & 7;
  if (height === 0) return stride > 0 ? TILE - pixel : pixel + 1;
  if (height === FULL) return stride > 0 ? ~pixel : -TILE | start;
  return height > 0 ? height - 1 - pixel : height + pixel;
}
/** The ground above or below (`stride` -8 or 8) the point (x, y), in its tile. */
export const tileUpDown = (y, x, layer, stride) => inOneTile(tileGround(x, y, layer, true, [0]), y, stride);
/** The ground to the left or right (`stride` -8 or 8) of the point (x, y), in its tile. */
export const tileSideways = (x, y, layer, stride) => inOneTile(tileGround(x, y, layer, false, [0]), x, stride);
