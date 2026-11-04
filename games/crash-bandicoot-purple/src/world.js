// A world's map: its four layers of 16 by 16 blocks, the tiles they draw with and the camera that moves over them,
// rewritten from how the original does it, from its own instructions. Each function is named by its address in the USA
// copy.

import { REG } from '../../../kit/gba/video.js';
import { unpack } from './movie.js';

const CARTRIDGE = 0x08000000, FREE = 0x1000, VRAM_PAGE = 0x4000, MAP_PAGE = 0x800;

// 0x08036ABC, 0x08036A80: the tiles a layer can use, which come into video memory as a block on screen asks for them, and
// go once nothing does: which of them holds each of the cartridge's tiles, how many blocks use it, and which are free
function createTiles(video, rom, page, count, size, from) {
  const held = new Uint16Array(4096).fill(FREE), uses = new Uint16Array(count), free = new Uint16Array(count);
  const tiles = { held, uses, free, nextFree: 0 };
  const start = page * VRAM_PAGE;
  // 0x080368CC: a block's tile as a layer's map holds it: a place in video memory for its number, and its flips and
  // colours as they are
  tiles.use = entry => {
    const number = entry & 0xFFF;
    let place = held[number];
    if (place === FREE) {
      place = free[tiles.nextFree++];
      held[number] = place;
      // 0x0803695C
      video.vram.set(rom.bytes.subarray(from + number * size, from + (number + 1) * size), start + place * size);
    }
    uses[place]++;
    return place | (((entry >> 12) & 3) << 10) | (((entry >> 14) & 3) << 12);
  };
  // 0x0803698C: a block's tile no longer on screen
  tiles.drop = entry => {
    const number = entry & 0xFFF, place = held[number];
    if (--uses[place] === 0) {
      free[--tiles.nextFree] = place;
      held[number] = FREE;
    }
  };
  // 0x080369CC with 0x0802F2E0's 0x080368CC: all free, with the first one first, and the cartridge's tile 0 in the first
  tiles.reset = () => {
    held.fill(FREE);
    uses.fill(0);
    for (let i = 0; i < count; i++) free[i] = i;
    tiles.nextFree = 0;
    tiles.use(0);
  };
  tiles.reset();
  return tiles;
}

// 0x03000000: a column of a layer's map, which is packed in runs: a word's top two bits say 2 for one value many times,
// or 3 for that many values as they are, and the rest how many
function readColumn(rom, grid, column, height) {
  const out = new Uint16Array(height);
  let at = grid.data + rom.u32(grid.at + 4 + column * 4) * 2, to = 0;
  while (to < height) {
    const word = rom.u16(at), count = word & 0x3FFF, kind = word >> 14;
    at += 2;
    if (kind === 2) {
      out.fill(rom.u16(at), to, to + count);
      at += 2;
      to += count;
    } else if (kind === 3) {
      for (let n = 0; n < count; n++, at += 2) out[to + n] = rom.u16(at);
      to += count;
    }
  }
  return out;
}

// A layer (0x0801AF2C, 0x08002160): the blocks of the map it has on screen, and where on the screen's own map of 32 by 32
// tiles each goes. `x0` to `x1` and `y0` to `y1` are the blocks it has, as [8], [12], [0] and [4] keep them
function createLayer(video, rom, number, tiles, def, screen) {
  const at = def - CARTRIDGE, blocksAt = rom.u32(at) - CARTRIDGE, gridAt = rom.u32(at + 4) - CARTRIDGE;
  const width = rom.u16(gridAt), height = rom.u16(gridAt + 2);
  const layer = {
    video, rom, number, tiles,
    blocks: unpack(rom.bytes, blocksAt),
    grid: { at: gridAt, data: gridAt + 4 + width * 4 },
    width, height, columns: new Map(),
    parallaxX: rom.u32(at + 12), parallaxY: rom.u32(at + 16),
    wrapX: rom.u8(at + 20) !== 0, wrapY: rom.u8(at + 21) !== 0,
    map: screen * MAP_PAGE,
    // 0x0801AB30, with 0x0801A9A4's size in the eighth of a pixel it keeps: half the screen or half the layer
    halfW: 0, halfH: 0, maxX: 0, maxY: 0,
    x: 0, y: 0, x0: 0, x1: 0, y0: 0, y1: 0,
    // [112], the columns it keeps past each side of the screen, for lines the H-blank moves (0x08002158)
    margin: 0,
  };
  const pixelsW = width << 12, pixelsH = height << 12;
  layer.halfW = Math.min(pixelsW >> 1, 0x7800);
  layer.halfH = Math.min(pixelsH >> 1, 0x5000);
  layer.maxX = pixelsW - layer.halfW;
  layer.maxY = pixelsH - layer.halfH;
  return layer;
}

const blockOf = v => { let n = v >> 8; n &= ~15; if (n < 0) n += 15; return n >> 4; };

// 0x0801ABD4: how far a layer moves for how far the camera does
function parallax(layer, point) {
  point.x = layer.halfW + ((Math.imul(layer.parallaxX, point.x - layer.halfW)) >> 8);
  point.y = layer.halfH + ((Math.imul(layer.parallaxY, point.y - layer.halfH)) >> 8);
}

// 0x0801AB70: on the whole pixel, and within the layer unless it wraps
function clamp(layer, point) {
  point.x &= ~0xFF;
  point.y &= ~0xFF;
  if (!layer.wrapX) point.x = Math.min(Math.max(point.x, layer.halfW), layer.maxX);
  if (!layer.wrapY) point.y = Math.min(Math.max(point.y, layer.halfH), layer.maxY);
}

// 0x0801AC0C, for a layer's column on the map, as its own cache of them would have it
function columnAt(layer, x) {
  const c = layer.wrapX ? ((x % layer.width) + layer.width) % layer.width : x;
  let column = layer.columns.get(c);
  if (!column) layer.columns.set(c, column = readColumn(layer.rom, layer.grid, c, layer.height));
  return column;
}

const blockAt = (layer, x, y) => columnAt(layer, x)[layer.wrapY ? ((y % layer.height) + layer.height) % layer.height : y];

// 0x08001F40: a column of blocks on the screen's map, and 0x0800201C a row of them
function setBlock(layer, x, y) {
  const { video, tiles } = layer, map = new Uint16Array(video.vram.buffer, layer.map, 1024);
  const col = (x * 2) & 31, row = (y * 2) & 31, right = (col + 1) & 31, down = (row + 1) & 31;
  // the layer keeps as many columns as the screen's map has blocks across, each at its number's remainder (0x0801AC0C), so the column
  // before the first reads the same as the last one kept, which is what brings that column's tiles in first
  const block = blockAt(layer, x < 0 ? x + 16 : x, y);
  if (block === 0) {
    map[row * 32 + col] = map[row * 32 + right] = map[down * 32 + col] = map[down * 32 + right] = 0;
    return;
  }
  const b = layer.blocks, at = block * 8, entry = i => b[at + i] | (b[at + i + 1] << 8);
  map[row * 32 + col] = tiles.use(entry(0));
  map[row * 32 + right] = tiles.use(entry(2));
  map[down * 32 + col] = tiles.use(entry(4));
  map[down * 32 + right] = tiles.use(entry(6));
}

// 0x0801ACA0: a block no longer on screen gives up its tiles
function dropBlock(layer, x, y) {
  const block = blockAt(layer, x, y);
  if (block === 0) return;
  const b = layer.blocks, at = block * 8;
  for (let i = 0; i < 8; i += 2) layer.tiles.drop(b[at + i] | (b[at + i + 1] << 8));
}

const drawColumn = (layer, x) => { for (let y = layer.y0; y <= layer.y1; y++) setBlock(layer, x, y); };
const drawRow = (layer, y) => { for (let x = layer.x0; x <= layer.x1; x++) setBlock(layer, x, y); };

function writeScroll(layer) {
  const { video, number } = layer;
  video.write(REG.BG0HOFS + number * 4, ((layer.x - layer.halfW) >> 8) & 0x1FF);
  video.write(REG.BG0HOFS + 2 + number * 4, ((layer.y - layer.halfH) >> 8) & 0x1FF);
}

// 0x0801AE74 with 0x080020DC: the layer's first picture at a place, with all of the screen's blocks drawn
function placeLayer(layer, camera) {
  const point = { x: camera.x, y: camera.y };
  parallax(layer, point);
  clamp(layer, point);
  layer.x = point.x;
  layer.y = point.y;
  writeScroll(layer);
  layer.x0 = blockOf(layer.x - layer.halfW);
  layer.x1 = blockOf(layer.x + layer.halfW - 1);
  layer.y0 = blockOf(layer.y - layer.halfH);
  layer.y1 = blockOf(layer.y + layer.halfH - 1);
  for (let x = layer.x0 - layer.margin; x <= layer.x1 + layer.margin; x++) drawColumn(layer, x);
}

// 0x0801A894: the layer at the camera's new place, with what leaves the screen given up (0x0801ADFC, 0x0801AE38)
function moveLayer(layer, camera) {
  const point = { x: camera.x, y: camera.y };
  parallax(layer, point);
  clamp(layer, point);
  layer.x = point.x;
  layer.y = point.y;
  const x0 = blockOf(layer.x - layer.halfW), x1 = blockOf(layer.x + layer.halfW - 1);
  const y0 = blockOf(layer.y - layer.halfH), y1 = blockOf(layer.y + layer.halfH - 1);
  for (; layer.x0 < x0; layer.x0++) for (let y = layer.y0; y <= layer.y1; y++) dropBlock(layer, layer.x0, y);
  for (; layer.x1 > x1; layer.x1--) for (let y = layer.y0; y <= layer.y1; y++) dropBlock(layer, layer.x1, y);
  for (; layer.y0 < y0; layer.y0++) for (let x = layer.x0; x <= layer.x1; x++) dropBlock(layer, x, layer.y0);
  for (; layer.y1 > y1; layer.y1--) for (let x = layer.x0; x <= layer.x1; x++) dropBlock(layer, x, layer.y1);
  layer.next = { x0, x1, y0, y1 };
}

// 0x0801A940, at the V-blank: the scroll, then what comes on screen (0x0801AD78, 0x0801ADBC)
function showLayer(layer) {
  writeScroll(layer);
  const { x0, x1, y0, y1 } = layer.next ?? layer;
  while (layer.y0 > y0) drawRow(layer, --layer.y0);
  while (layer.y1 < y1) drawRow(layer, ++layer.y1);
  while (layer.x0 > x0) drawColumn(layer, --layer.x0);
  while (layer.x1 < x1) drawColumn(layer, ++layer.x1);
}

/** A level's map from its definition in the cartridge: 0x0802F460 with 0x0802F2E0, in mode 0. */
export function createWorld(video, rom, def) {
  const at = def - CARTRIDGE, tileSets = rom.u32(at + 28) - CARTRIDGE;
  const big = createTiles(video, rom, 0, 512, 64, rom.u32(tileSets) - CARTRIDGE + 4);
  const small = createTiles(video, rom, 2, 752, 32, rom.u32(tileSets + 4) - CARTRIDGE + 4);
  const world = { layers: [], camera: { x: 0, y: 0 }, tiles: [big, small] };
  for (let n = 0; n < 4; n++) {
    const layerDef = rom.u32(at + 4 + n * 4);
    world.layers[n] = null;
    if (!layerDef) continue;   // 0x0802F460: a level needn't use all four
    const usesBig = rom.u8(layerDef - CARTRIDGE + 22) !== 0;
    world.layers[n] = createLayer(video, rom, n, usesBig ? big : small, layerDef, 28 + n);
    const priority = rom.u32(layerDef - CARTRIDGE + 8) & 3;
    video.write(REG.BG0CNT + n * 2, priority | ((usesBig ? 0 : 2) << 2) | ((usesBig ? 1 : 0) << 7) | ((28 + n) << 8));
  }
  return world;
}

/** 0x0802F8D0: the camera at a place, within the layer that decides how far it goes, which is the last (0x0802F374). */
export function aimCamera(world, x, y) {
  const last = world.layers[3];
  world.camera.x = Math.min(Math.max(x, last.halfW), last.maxX);
  world.camera.y = Math.min(Math.max(y, last.halfH), last.maxY);
}

// the order 0x0802F2E0 and 0x0802F374 go in: the last layer at the camera, then the others at where it ended up
const ORDER = [3, 0, 1, 2];

/** 0x0802F2E0: every layer's first picture. */
export function showWorld(world, margin = 0) {
  const last = world.layers[3];
  const place = () => {
    placeLayer(last, world.camera);
    for (const n of ORDER.slice(1)) if (world.layers[n]) placeLayer(world.layers[n], last);
  };
  place();
  // 0x0802F8A0, for the first layer: a column more on each side, and every layer's picture again from no tiles, which leaves the first
  // picture's tiles in video memory past those the second one uses
  if (margin) {
    world.layers[0].margin = margin;
    for (const tiles of world.tiles) tiles.reset();
    place();
  }
}

/** 0x0802F374: every layer at the camera's place, before the V-blank. */
export function moveWorld(world) {
  const last = world.layers[3];
  moveLayer(last, world.camera);
  for (const n of ORDER.slice(1)) if (world.layers[n]) moveLayer(world.layers[n], last);
}

/** 0x0802F90C: every layer's picture, at the V-blank. */
export function drawWorld(world) { for (const layer of world.layers) if (layer) showLayer(layer); }

/** 0x0802F7F0 and 0x0802F7DC: the screen's left and top on the map, in eighths of a pixel. */
export const screenLeft = world => world.layers[3].x - 0x7800;
export const screenTop = world => world.layers[3].y - 0x5000;
