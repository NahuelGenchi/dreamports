// A stage's layers, as the engine keeps them: the two map layers built from metatiles (each metatile a block of tiles,
// its index read from the map), and the backgrounds behind them. Rewritten from 0x080BCFFC, DrawBackground, and the
// level-map side of what the V-blank copies (sa2__sub_8002B20).

const TILEMAPS = 0xD0624;
export const FLAG = { DISABLE_TILESET: 0x8, DISABLE_PALETTE: 0x10, SCROLLS: 0x20, LEVEL_MAP: 0x40 };

/** A background as gStageCameraBgTemplates has it, at `at` in the ROM. */
export function backgroundFrom(rom, at) {
  return {
    dest: rom.u32(at + 4) - 0x06000000, layoutVram: rom.u32(at + 0xC) - 0x06000000, layout: 0, xTiles: 0, yTiles: 0, tilemapId: 0,
    targetTilesX: rom.u16(at + 0x26), targetTilesY: rom.u16(at + 0x28), paletteOffset: 0, animFrameCounter: 0, animDelayCounter: 0,
    flags: rom.u16(at + 0x2E), scrollX: 0, scrollY: 0, prevScrollX: rom.u16(at + 0x34), prevScrollY: rom.u16(at + 0x36), map: 0, mapWidth: 0, mapHeight: 0,
  };
}

/** 0x080BCFFC, DrawBackground: its tiles and colours the first time, and the layer into the queue the V-blank copies. */
export function drawStageBackground(c, bg) {
  const { rom } = c, at = rom.u32(TILEMAPS + bg.tilemapId * 4) - 0x08000000;
  bg.xTiles = rom.u16(at);
  bg.yTiles = rom.u16(at + 2);
  if (!(bg.flags & FLAG.DISABLE_TILESET)) {
    c.queueGraphics(rom.u32(at + 8) - 0x08000000, bg.dest, rom.u32(at + 12) & 0xFFFF);
    bg.flags ^= FLAG.DISABLE_TILESET;
  }
  bg.paletteOffset = rom.u16(at + 20);
  if (!(bg.flags & FLAG.DISABLE_PALETTE)) {
    const palette = rom.u32(at + 16) - 0x08000000, count = rom.u16(at + 22);
    for (let i = 0; i < count; i++) c.bgPalette[(bg.paletteOffset + i) & 0xFF] = rom.u16(palette + i * 2);
    c.flags |= 1;
    bg.flags ^= FLAG.DISABLE_PALETTE;
  }
  bg.layout = rom.u32(at + 24) - 0x08000000;
  if (bg.flags & FLAG.LEVEL_MAP) {
    bg.map = rom.u32(at + 0x1C) - 0x08000000;
    bg.mapWidth = rom.u16(at + 0x20);
    bg.mapHeight = rom.u16(at + 0x22);
  }
  c.queueLayer(bg);
}

/** UpdateBgAnimationTiles: the next frame of a layer's animated tiles, when it's due. */
export function animateTiles(c, bg) {
  const { rom } = c, at = rom.u32(TILEMAPS + bg.tilemapId * 4) - 0x08000000;
  const frames = rom.u8(at + 6);
  if (frames === 0) return;
  bg.animDelayCounter = (bg.animDelayCounter + 1) & 0xFF;
  if (rom.u8(at + 7) > bg.animDelayCounter) return;
  bg.animDelayCounter = 0;
  bg.animFrameCounter = (bg.animFrameCounter + 1) & 0xFF;
  if (frames <= bg.animFrameCounter) bg.animFrameCounter = 0;
  const size = rom.u16(at + 4), tiles = rom.u32(at + 8) - 0x08000000;
  const from = bg.animFrameCounter === 0 ? tiles : tiles + rom.u32(at + 12) + (bg.animFrameCounter - 1) * size;
  c.queueGraphics(from, bg.dest, size);
}

/** sa2__sub_8002B20, for one queued layer: the tiles that show, into the layer's map in VRAM, once it has scrolled a tile. */
export function copyLayer(c, bg) {
  const { rom, video } = c;
  const scrolls = bg.flags & FLAG.SCROLLS;
  if (scrolls && bg.scrollX === bg.prevScrollX && bg.scrollY === bg.prevScrollY) return;
  if (scrolls && (bg.prevScrollX >> 3) === (bg.scrollX >> 3) && (bg.prevScrollY >> 3) === (bg.scrollY >> 3)) {
    bg.prevScrollX = bg.scrollX;
    bg.prevScrollY = bg.scrollY;
    return;
  }
  const firstX = scrolls ? bg.scrollX >> 3 : 0, firstY = scrolls ? bg.scrollY >> 3 : 0;
  if (bg.flags & FLAG.LEVEL_MAP) {
    for (let i = 0; i < bg.targetTilesX;) {
      const x = firstX + i, mapX = Math.trunc(x / bg.xTiles), inX = x - mapX * bg.xTiles;
      const run = Math.min(bg.xTiles - inX, bg.targetTilesX - i);
      for (let j = 0; j < bg.targetTilesY;) {
        const y = firstY + j, mapY = Math.trunc(y / bg.yTiles), inY = y - mapY * bg.yTiles;
        const rows = bg.yTiles - inY;
        const metatile = rom.u16(bg.map + (mapY * bg.mapWidth + mapX) * 2);
        let src = bg.layout + (metatile * bg.xTiles * bg.yTiles + inY * bg.xTiles + inX) * 2;
        for (let r = 0, n = Math.min(rows, bg.targetTilesY - j); r < n; r++) {
          video.vram.set(rom.bytes.subarray(src, src + run * 2), bg.layoutVram + (j + r) * 64 + i * 2);
          src += bg.xTiles * 2;
        }
        j += rows;
      }
      i += run;
    }
  } else {
    const nextBlock = (c.bgCnt[bg.flags & 3] >> 14) & 1 ? 0x800 : 0;
    let src = bg.layout, dest = bg.layoutVram;
    for (let row = 0; row < bg.targetTilesY; row++) {
      // on a layer two blocks wide the rest of a row goes to the next block, and on any other it runs on over the next
      // row, which that row then writes over
      const left = nextBlock ? Math.min(bg.targetTilesX, 32) : bg.targetTilesX;
      video.vram.set(rom.bytes.subarray(src, src + left * 2), dest);
      if (nextBlock && bg.targetTilesX > 32) video.vram.set(rom.bytes.subarray(src + left * 2, src + bg.targetTilesX * 2), dest + nextBlock);
      dest += 64;
      src += bg.xTiles * 2;
    }
  }
  bg.prevScrollX = bg.scrollX;
  bg.prevScrollY = bg.scrollY;
}
