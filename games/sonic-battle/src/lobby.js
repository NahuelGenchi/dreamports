// The Mini-games mode's waiting screen, the first frame 0x080284b4: the Sonic Battle link screen that an entry on the
// Mini-games screen leads to before its game, with the four player places, the pulsing "WAIT!" and the B back to the
// Mini-games screen. The decompilation's src/unknown_080283f8.cpp is the guide: the initializer 0x080284b4, its frame
// wrapper 0x08028760, the screen at 0x08028770, the fade at 0x08028814, the input at 0x080288b4, the leave at
// 0x08028ed8, the player marks at 0x08028f98 and 0x08029014, the wait sprite at 0x080290b4 and 0x08029060, and the
// scrolling layer at 0x08030d3c.
//
// The original starts its multiboot link here. With no link its player count is one, so only the first place is ready
// and the others wait, which is what this port shows. The link's own screens are not ported.

import { KEY, colours, copyTileBlock, decompress, fadeToBlack, fadeToward, hideSpriteBuffer, queueRegister } from './core.js';
import { addNode, animate, draw, fadeSongOut, frame, place, startFrame, takeMatrix, writeRegisters } from './menu.js';
import { miniGames } from './mini-games.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000, SINE = 0x0804DF7C;

// the cartridge's table of the display registers the first frame writes, and how many
const REGISTERS = 0x0810C5B4, REGISTER_COUNT = 16;

// the pictures the screen unpacks: the backgrounds' tiles, the map, the sprites' tiles and the waiting word
const BACKGROUND_TILES = 0x0815C4B4, SECOND_TILES = 0x081323D4, THIRD_TILES = 0x0810CD78;
const FIRST_MAP = 0x0810D13C, SECOND_MAP = 0x0810D20C;
const SPRITE_TILES = 0x0810D250, WAIT_WORD = 0x0810D784, WAIT_WORD_OTHER = 0x0810D928;
const BLOCK_TILE = 0x081327D4;

// the stretch the screen's blank rows are copied from
const BLANK_ROW = 0x0600DFC0, TEXT_TILES = 0x0600DA80, TEXT_COLUMNS = 21, TEXT_ROWS = 2;
const MAP = 0x0600FC42, MAP_ROW = 32, MAP_TILES = 0x52D4;

// the four player places and the waiting sprite: their parts and where they sit, waiting and ready
const MARKER_WAITING = 0x08EDB97C, MARKER_READY = 0x08EDB984, WAIT_MULTI = 0x08EDB94C, WAIT_ONE = 0x08EDB974;
const PLACES = 0x08EDB98C;
const CHILD_X = 214, CHILD_Y = 145;

// the colours the screen fades in to: backgrounds 4, then the sprites' three sets
const FADES = [
  [0x05000080, 0x0810C5F4, 32], [0x050001C0, 0x0815E67C, 16],
  [0x050001E0, 0x081326F4, 16], [0x05000200, 0x0810C634, 64],
];

const SONG = 2, SOUND_MADE = 404, SOUND_BACK = 405, SONG_BACK = 120;

/** A word of VRAM at `at` (an address in 0x06000000). */
const readVram = (c, at) => {
  const i = at - VRAM;
  return c.video.vram[i] | (c.video.vram[i + 1] << 8);
};

/** A word written to VRAM at `at`. */
function writeVram(c, at, value) {
  const i = at - VRAM;
  c.video.vram[i] = value & 0xFF;
  c.video.vram[i + 1] = (value >>> 8) & 0xFF;
}

/** 0x08020ecc: the stretch of VRAM at `to`, `width` by `height` tiles, that the screen's letters go into. */
function textInto(c, to, width, height) {
  c.text = { to: to - VRAM, end: to - VRAM + width * height * 32, stride: height * 8, rows: height * 8, block: height * 16 };
}

/** 0x080283f8 with no words: every row of the stretch keeps the blank row's tiles. The copy is sixteen words, the
 *  row's two tiles, and each row starts sixty-four bytes after the one before. */
function clearWords(c) {
  const from = BLANK_ROW - VRAM, to = TEXT_TILES - VRAM;
  for (let row = 0; row < TEXT_COLUMNS; row++) c.video.vram.copyWithin(to + row * 64, from, from + 64);
}

/** 0x080284b4: the screen's first frame. The registers, the palette black, the pictures, the map, the list's nodes,
 *  the display on, and the song. */
export function lobby(c) {
  const { video } = c;
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  c.menu = { nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0, slots: 0 };   // 0x0801f780, 0x080210d8, 0x0802110c
  colours(c).fill(0);
  video.vram.fill(0, 0, 0x40);
  decompress(c, BACKGROUND_TILES, 0x06000040);
  decompress(c, SECOND_TILES, 0x06005280);
  decompress(c, THIRD_TILES, 0x06008000);
  video.vram.fill(0, 0x0600F800 - VRAM, 0x0600F800 - VRAM + 0x800);
  decompress(c, FIRST_MAP, 0x0600F800);
  decompress(c, SECOND_MAP, 0x0600FC00);
  const tile = readVram(c, MAP);
  const blank = ((tile & 0x3FF) + 0x400) * 32;
  textInto(c, TEXT_TILES, TEXT_COLUMNS, TEXT_ROWS);
  video.vram.copyWithin(BLANK_ROW - VRAM, blank, blank + 32);
  video.vram.copyWithin(BLANK_ROW - VRAM + 32, blank, blank + 32);
  clearWords(c);
  let next = MAP_TILES;
  for (let i = 0; i <= 20; i++) {
    writeVram(c, MAP + i * 2, next++);
    writeVram(c, MAP + MAP_ROW * 2 + i * 2, next++);
  }
  video.vram.fill(0, 0x0600F000 - VRAM, 0x0600F000 - VRAM + 0x800);
  video.vram.fill(0, 0x0600E800 - VRAM, 0x0600E800 - VRAM + 0x800);
  let to = 0x0600E000;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      copyTileBlock(c, to, BLOCK_TILE, 8, 8, 0xF294);
      to += 0x10;
    }
    to += 0x1C0;
  }
  decompress(c, SPRITE_TILES, 0x06010000);
  decompress(c, c.language === 0 ? WAIT_WORD : WAIT_WORD_OTHER, 0x06010E00);
  addNode(c, startFrame);
  addNode(c, comeIn, null, { phase: 0, child: null });
  addNode(c, scroll, null, { count: 0 });
  addNode(c, animate, null, { to: 0x0600F092, tile: 0xE002, timer: 0 });
  queueRegister(c, 0, 0x1F40);     // 0x0801fba0(0, 8000), the display on
  c.lobby = { count: 0 };
  c.sound?.play(SONG);             // 0x0801f618(2)
  c.callback = frame;              // 0x08028760
}

/** 0x08028770: the four player places and the waiting sprite, which draw from this frame on. */
function comeIn(c, node) {
  node.phase = 1;
  node.markers = [0, 1, 2, 3].map(index => {
    const marker = addNode(c, markerStart, place(MARKER_WAITING, 0, 0, 0));
    marker.position.index = index;
    return marker;
  });
  node.child = addNode(c, childStart, place(WAIT_MULTI, CHILD_X, CHILD_Y, 0));
  clearWords(c);
  node.run = fadeIn;
}

/** 0x08028814: the screen's colours step toward theirs, and once they're there the input starts. */
function fadeIn(c, node) {
  const arrived = FADES.map(([first, from, count]) => fadeToward(c, first, from, count));
  if (arrived.every(Boolean)) node.run = input;
}

/** 0x080288b4: no link means one player, so A does nothing and B goes back to the Mini-games screen. */
function input(c, node) {
  const count = 1;                 // 0x08021484 with no link: the player alone
  if (c.lobby.count !== count) {
    c.lobby.count = count;
    node.phase = count;
    clearWords(c);
  }
  const { repeated } = c.keys;
  if (repeated & KEY.A) {
    if (c.lobby.count > 1) {
      node.run = () => {};         // the link's transfer screens aren't ported
      c.sound?.play(SOUND_MADE);
      fadeSongOut(c, SONG, 60);
    }
  } else if (repeated & KEY.B) {
    node.run = leave;
    c.sound?.play(SOUND_BACK);
    fadeSongOut(c, SONG, SONG_BACK);
  }
  childParts(c, node);
}

/** The waiting sprite says "wait" while one player is here, and something else when more have joined. */
function childParts(c, node) {
  if (!node.child) return;
  node.child.position.parts = c.lobby.count <= 1 ? WAIT_ONE : WAIT_MULTI;
}

/** 0x08028ed8: every colour fades to black, and the Mini-games screen starts again. */
function leave(c) {
  if (fadeToBlack(c, PALETTE, 512)) c.callback = miniGames;
}

/** 0x08030d3c: the moving layer, a line every frame. */
function scroll(c, node) {
  node.count = (node.count - 1) | 0;
  queueRegister(c, 0x1C, (node.count & 0x1FE) >> 1);
}

/** 0x08029014: a player's place, waiting where it starts, drawn from the next frame on. */
function markerStart(c, node) {
  const { position } = node;
  position.parts = MARKER_WAITING;
  position.tile = 0;
  position.x = c.rom.u16(PLACES - CARTRIDGE + position.index * 8);
  position.y = c.rom.u16(PLACES - CARTRIDGE + position.index * 8 + 2);
  position.attr0 = 0;
  position.attr1 = 0;
  position.attr2 = 0;
  node.run = placeDraw;
}

/** 0x08028f98: a place moves to the ready spot when its player is here, and to the waiting one when not. */
function placeDraw(c, node) {
  const { position } = node;
  const ready = c.lobby.count >= position.index + 1;
  const at = position.index * 8 + (ready ? 4 : 0);
  position.parts = MARKER_WAITING;
  if (moveTo(c, position, c.rom.u16(PLACES - CARTRIDGE + at), c.rom.u16(PLACES - CARTRIDGE + at + 2)) && ready) {
    position.parts = MARKER_READY;
  }
  draw(c, position);
}

/** 0x0801f92c: half way to a place, rounded toward it. True once it's there. */
function moveTo(c, position, x = position.x, y = position.y) {
  position.x = x + Math.trunc((position.x - x) / 2);
  position.y = y + Math.trunc((position.y - y) / 2);
  return position.x === x && position.y === y;
}

/** The waiting sprite's place and its pulse. */
function childStart(c, node) {
  const { position } = node;
  position.parts = WAIT_MULTI;
  position.tile = 0;
  position.x = CHILD_X;
  position.y = CHILD_Y;
  position.attr0 = 0;
  position.attr1 = 0;
  position.attr2 = 0;
  position.timer = 0;
  node.run = childDraw;
}

/** 0x08029060: the waiting sprite breathes, a quarter turn of the table every frame. */
function childDraw(c, node) {
  const { position } = node;
  const value = ((c.rom.u16(SINE - CARTRIDGE + position.timer * 64) >>> 8) << 24) >> 24;
  position.attr0 = 1;
  position.attr1 = (position.attr1 & 0xC1) | (takeMatrix(c, value + 256) * 2);
  draw(c, position);
  position.timer = (position.timer + 4) & 0xFF;
}
