// The name entry, at the first start, between the title screen and the main menu (the decompilation's
// src/unknown_08036350.cpp, 0x08036560 and the functions after it). A grid of letters scrolls behind a cursor over
// six rows of a list of 35. A adds the letter under the cursor to a name of up to five, B takes the last one off, and
// Start keeps the name and goes on to the main menu, which is where the next start goes straight to.
//
// The original draws its letters into VRAM's tiles a pixel row at a time: the grid into one stretch that a block of
// the map shows, the name into another, and the letter under the cursor into one of the sprites' slots.
//
// The same screen also takes codes, when another screen enters it with gUnknown_03005380 set. Nothing reaches that yet,
// so it isn't here.

import { KEY, colours, copyTileBlock, decompress, fadeToBlack, fadeToward, hideSpriteBuffer, queueRegister } from './core.js';
import { addNode, beforeMenu, draw, drawOnly, frame, menu, place, removeNode, scroll, startFrame, writeRegisters } from './menu.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000;
const DISPCNT = 0x00;

// the cartridge's table of the display registers the first frame writes, and how many
const REGISTERS = 0x08156C70, REGISTER_COUNT = 16;

// the font: 32 bytes of pixels for each letter, each one's width, and for each byte of pixels, what it keeps of a
// word of VRAM and which of its nibbles it sets
const GLYPHS = 0x08071B7C, WIDTHS = 0x0807173C, KEEP = 0x0807A37C, SPREAD = 0x0807A77C;
const TEXT_COLOUR = 2, LETTER_ROOM = 16;

// gUnknown_08edcc3c: the list of 35 rows of ten letters, as addresses, and how many letters that makes
const ROWS = 0x08EDCC3C, ROW_COUNT = 35, LETTER_COUNT = 350;
const END = 0xFFFE;
const NAME_ROOM = 5;

// where the letters go: the grid, the name and the slots of the letters under the cursor, and gUnknown_0807163c,
// the bit each slot has in a one-byte list, so the slots past the eighth are never marked as taken
const GRID_TILES = 0x06000800, NAME_TILES = 0x06002600, SLOT_TILES = 0x06017800, SLOT_BITS = 0x0807163C, SLOTS = 16;

// the sprites' records: the cursor's light, the letter over it, the heading and the mark beside the name
const CURSOR_LIGHT = 0x08EDCBEC, CURSOR_LETTER = 0x08EDCBFC, HEADING = 0x08EDCC0C, NAME_MARK = 0x08EDCC1C;
const SQUARE = 0x081581F4;

const SONG = 4, SOUND_MOVE = 401, SOUND_LETTER = 402, SOUND_BACK = 403, SOUND_MADE = 404, SOUND_REFUSED = 419;
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
const SONG_TABLE = 0x08BF7244;
// how many frames of the song's fade make a step: 0x0801f718(4, 120) keeps 120 >> 4
const SONG_FADE_STEP = 120 >> 4;

/**
 * What the original takes to write the save to its flash (0x080217d0), once the screen is black, and which shows only
 * in how long it takes, as mGBA measures it.
 */
const SAVING_FRAMES = 20;

/** A sprite's record in the cartridge, as a place (menu.js) of its own. */
export function record(c, at) {
  const { rom } = c, from = at - CARTRIDGE;
  return {
    parts: rom.u32(from), x: rom.s16(from + 4), y: rom.s16(from + 6), tile: rom.u16(from + 8),
    attr0: rom.bytes[from + 10], attr1: rom.bytes[from + 11], attr2: rom.bytes[from + 12], player: rom.bytes[from + 13], state: 0,
  };
}

/** 0x08020ecc: the stretch of VRAM at `to`, `width` by `height` tiles, that the next letters go into. */
function textInto(c, to, width, height) {
  c.text = { to: to - VRAM, end: to - VRAM + width * height * 32, stride: height * 8, rows: height * 8, block: height * 16 };
}

/** 0x08020f64: a letter's width. */
const glyphWidth = (c, glyph) => c.rom.bytes[WIDTHS - CARTRIDGE + (glyph & 0x7FFF)];

/** A byte of a letter's pixels into a word of VRAM, with `colour` where the byte's bits are set. */
function putPixels(c, at, pixels, colour) {
  if (!pixels || at >= c.text.end) return;
  const { vram } = c.video, { rom } = c;
  const word = (vram[at] | (vram[at + 1] << 8) | (vram[at + 2] << 16) | (vram[at + 3] << 24)) >>> 0;
  const out = ((word & rom.u32(KEEP - CARTRIDGE + pixels * 4)) | (rom.u32(SPREAD - CARTRIDGE + pixels * 4) * colour)) >>> 0;
  vram[at] = out & 0xFF;
  vram[at + 1] = (out >>> 8) & 0xFF;
  vram[at + 2] = (out >>> 16) & 0xFF;
  vram[at + 3] = out >>> 24;
}

/** 0x08020978: a letter into the stretch, at `x` and `y` in pixels, over as many as three columns of tiles. */
function putGlyph(c, x, y, glyph, colour) {
  const { to, stride, rows, block } = c.text, { bytes } = c.rom;
  const shift = x & 7, source = GLYPHS - CARTRIDGE + ((glyph & 0x7FFF) << 5);
  const count = rows <= y ? 0 : Math.min(rows - y, 16);
  for (let i = 0; i < count; i++) {
    const at = to + ((x >> 3) * stride + y + i) * 4, first = bytes[source + i * 2], second = bytes[source + i * 2 + 1];
    putPixels(c, at, (first << shift) & 0xFF, colour);
    putPixels(c, at + stride * 4, ((first >> (8 - shift)) | (second << shift)) & 0xFF, colour);
    putPixels(c, at + block * 4, (second >> (8 - shift)) & 0xFF, colour);
  }
}

/** A letter in the middle of the 16 pixels it has. */
const putCentred = (c, x, y, glyph) => putGlyph(c, x + 8 - (glyphWidth(c, glyph) >> 1), y, glyph, TEXT_COLOUR);

/** A row of the list's address in the cartridge. */
const rowAt = (c, row) => c.rom.u32(ROWS - CARTRIDGE + row * 4) - CARTRIDGE;

/** The letter at `index` in the list, counted from the first row and wrapping past the last. */
function letterAt(c, index) {
  const at = index > LETTER_COUNT - 1 ? index - LETTER_COUNT : index;
  return c.rom.u16(rowAt(c, Math.trunc(at / 10)) + (at % 10) * 2);
}

/** 0x08036350: the six rows of the grid, from the row the list is scrolled to. */
function drawGrid(c) {
  c.video.vram.fill(0, GRID_TILES - VRAM, GRID_TILES - VRAM + 0x1E00);
  textInto(c, GRID_TILES, 20, 12);
  let row = Math.trunc(c.entry.scroll / 10);
  for (let y = 0; y < 96; y += 16) {
    let at = rowAt(c, row);
    for (let x = 0; c.rom.u16(at) !== END; x += LETTER_ROOM, at += 2) putCentred(c, x, y, c.rom.u16(at));
    if (++row > ROW_COUNT - 1) row = 0;
  }
}

/** 0x080364d8: the name as it stands, with the places not chosen yet drawn as what they hold. */
function drawName(c) {
  const { name } = c.entry;
  c.video.vram.fill(0, NAME_TILES - VRAM, NAME_TILES - VRAM + 0x300);
  textInto(c, NAME_TILES, 12, 2);
  name[5] = END;
  for (let i = 0, x = 0; name[i] !== END; i++, x += LETTER_ROOM) putCentred(c, x, 0, name[i]);
}

const slotBit = (c, slot) => c.rom.u32(SLOT_BITS - CARTRIDGE + slot * 4);

/** 0x08036428's first half: the first free slot, or the first slot when none is free and nothing's to be drawn. */
function takeSlot(c) {
  const { entry } = c;
  let slot = 0;
  while (slot < SLOTS && (entry.slots & slotBit(c, slot))) slot++;
  if (slot >= SLOTS) return -1;
  entry.slots = (entry.slots | slotBit(c, slot)) & 0xFF;
  return slot;
}

/** 0x08036428's second half: a letter drawn into its slot. */
function drawSlot(c, slot, glyph) {
  const to = SLOT_TILES + slot * 128;
  c.video.vram.fill(0, to - VRAM, to - VRAM + 128);
  textInto(c, to, 2, 2);
  putCentred(c, 0, 0, glyph);
}

/** 0x080368c0: a slot given back. */
function freeSlot(c, slot) {
  c.entry.slots = c.entry.slots & ~slotBit(c, slot) & 0xFF;
}

/** The map's entries from `to`, one after another down each of `columns` columns of `rows`, from tile `tile` on. */
function mapDownColumns(c, to, columns, rows, tile) {
  const { vram } = c.video;
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < rows; y++, tile++) {
      const at = to - VRAM + x * 2 + y * 64;
      vram[at] = tile & 0xFF;
      vram[at + 1] = tile >> 8;
    }
  }
}

/** The name kept from an earlier visit, which the original reads from its flash at power-on. */
export function keptName(c) {
  const kept = c.nameSave?.read();
  if (kept?.length === c.name.byteLength) c.name.set(new Uint16Array(kept.buffer));
}

/**
 * 0x08036560: the screen's first frame, or, with a name saved, straight on to the main menu. Everything's reset, the
 * palette black, the pictures, the maps and the grid drawn, the list's nodes added, and its song started.
 */
export function nameEntry(c) {
  if (c.name[0] !== 0) {
    c.callback = beforeMenu;
    beforeMenu(c);
    return;
  }
  // all of what follows takes the console past the next V-blank, so it shows that much later
  c.callback = setUp;
}

function setUp(c) {
  const { video } = c;
  c.entry = { name: new Uint16Array(6), length: 0, cursor: 0, scroll: 0, slots: 0 };
  c.entry.name[5] = END;
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  c.menu = { nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0 };
  colours(c).fill(0);
  decompress(c, 0x08156D10, VRAM);
  decompress(c, 0x08132544, 0x0600C000);
  decompress(c, 0x08156F08, 0x06010000);
  // the language the save keeps picks the heading's picture and the row of the list the grid starts on
  decompress(c, c.language === 0 ? 0x0815711C : 0x08157934, 0x06010C00);
  if (c.language !== 0) c.entry.scroll = 200;
  video.vram.fill(0, 0x0600F800 - VRAM, 0x0600F800 - VRAM + 0x800);
  decompress(c, 0x08156EA8, 0x0600F800);
  video.vram.fill(0, 0x0600F000 - VRAM, 0x0600F000 - VRAM + 0x800);
  mapDownColumns(c, 0x0600F1CA, 20, 12, 0x1040);
  mapDownColumns(c, 0x0600F114, 10, 2, 0x1130);
  drawGrid(c);
  video.vram.fill(0, 0x0600E800 - VRAM, 0x0600E800 - VRAM + 0x800);
  decompress(c, 0x08156DF0, 0x0600E8C0);
  let to = 0x0600E000;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      copyTileBlock(c, to, 0x081327D4, 8, 8, 0xF200);
      to += 0x10;
    }
    to += 0x1C0;
  }
  addNode(c, startFrame);
  addNode(c, scroll, null, { count: 0 });
  addNode(c, fadeIn);
  for (let row = 0, last = 9; row < 6; row++, last += 10) {
    for (let column = 0; column < 10; column++) {
      addNode(c, squareStart, { ...place(SQUARE, 0, 0, 0, 12), player: last - column }, { light: null, letter: null, scrolled: 0 });
    }
  }
  for (let i = 4; i >= 0; i--) addNode(c, nameSquareStart, { ...place(SQUARE, 0, 0, 0, 12), player: i });
  drawName(c);
  addNode(c, drawOnly, record(c, HEADING));
  addNode(c, markIfNamed, record(c, NAME_MARK));
  c.callback = displayOn;
}

/** 0x08036560's last step: it runs past a V-blank, and the display and the song come as it ends. */
function displayOn(c) {
  queueRegister(c, DISPCNT, 8000);
  c.sound?.call('waveAt', c.restarted ? 136311 : 163059);   // where the song's start comes in its frame, as mGBA measures it
  c.sound?.play(SONG);
  c.callback = frame;               // 0x08036888
}

/** 0x08036898: the mark beside the name, once it has a letter. */
function markIfNamed(c, node) {
  if (c.entry.length) draw(c, node.position);
}

/** 0x08036d90: the palettes fade in, and then the player can start. */
function fadeIn(c, node) {
  const arrived = [fadeToward(c, PALETTE, 0x08156CD0, 32), fadeToward(c, 0x050001E0, 0x08132754, 16), fadeToward(c, 0x05000200, 0x08158194, 48)];
  if (arrived.every(Boolean)) node.run = entering;
}

/** 0x080368dc: one key a frame, Start first: Start keeps the name, A and B change it, and the arrows move the cursor. */
function entering(c, node) {
  const { pressed, repeated } = c.keys, { entry } = c;
  const row = () => Math.trunc(entry.cursor / 10);
  if (pressed & KEY.START) {
    if (!entry.length) {
      c.sound?.play(SOUND_REFUSED);
      return;
    }
    c.name.fill(END);
    c.name.set(entry.name.subarray(0, entry.length));
    node.run = fadeOut;
    c.sound?.fadeOut(c.rom.bytes[SONG_TABLE - CARTRIDGE + SONG * 8 + 4], SONG_FADE_STEP);
    c.sound?.play(SOUND_MADE);
  } else if (pressed & KEY.A) {
    if (entry.length > NAME_ROOM - 1) entry.length = NAME_ROOM - 1;
    const letter = letterAt(c, entry.scroll + entry.cursor);
    if (entry.name[entry.length] !== letter) {
      entry.name[entry.length] = letter;
      c.sound?.play(SOUND_LETTER);
    }
    entry.length++;
    drawName(c);
  } else if (pressed & KEY.B) {
    if (entry.length) {
      entry.name[--entry.length] = 0;
      drawName(c);
      c.sound?.play(SOUND_BACK);
    }
  } else if (repeated & KEY.UP) {
    if (entry.cursor > 19) { entry.cursor -= 10; c.sound?.call('beforeSoundMain', SOUND_MOVE); }
    else {
      entry.scroll = entry.scroll > 9 ? entry.scroll - 10 : entry.scroll + LETTER_COUNT - 10;
      drawGrid(c);
    }
    c.sound?.play(SOUND_MOVE);
  } else if (repeated & KEY.DOWN) {
    if (entry.cursor < 40) { entry.cursor += 10; c.sound?.call('beforeSoundMain', SOUND_MOVE); }
    else {
      entry.scroll += 10;
      if (entry.scroll > LETTER_COUNT - 1) entry.scroll -= LETTER_COUNT;
      drawGrid(c);
    }
    c.sound?.play(SOUND_MOVE);
  } else if (repeated & KEY.LEFT) {
    const before = row();
    entry.cursor = (entry.cursor - 1) & 0xFFFF;
    if (row() !== before) entry.cursor = (entry.cursor + 10) & 0xFFFF;
    c.sound?.call('beforeSoundMain', SOUND_MOVE);
    c.sound?.play(SOUND_MOVE);
  } else if (repeated & KEY.RIGHT) {
    const before = row();
    entry.cursor++;
    if (row() !== before) entry.cursor -= 10;
    c.sound?.call('beforeSoundMain', SOUND_MOVE);
    c.sound?.play(SOUND_MOVE);
  }
}

/** 0x08036ce4: every colour fades to black, and then the name is kept and the main menu starts. */
function fadeOut(c) {
  if (!fadeToBlack(c, PALETTE, 512)) return;
  c.nameSave?.write(new Uint8Array(c.name.buffer));
  c.savingFrames = SAVING_FRAMES;
  c.callback = saving;
}

/** The time 0x080217d0 takes, with the screen black. */
function saving(c) {
  if (--c.savingFrames <= 0) menu(c);
}

const squareX = position => (position.player % 10) * 16;
const squareY = position => Math.trunc(position.player / 10) * 16;

/** 0x08036e08: a square of the grid takes its place, and draws from the next frame on. */
function squareStart(c, node) {
  const { position } = node;
  position.x = squareX(position) + 40;
  position.y = squareY(position) + 56;
  node.run = square;
}

/**
 * 0x08036e64: a square of the grid. The one under the cursor rises over four frames, and while it's up, the light and
 * the letter sit on it, in sprites of their own, whose letter changes when the list scrolls.
 */
function square(c, node) {
  const { position } = node, { entry } = c;
  if (node.lateLetter) {
    node.lateLetter();
    node.lateLetter = null;
  }
  if (position.player === entry.cursor) {
    if (++position.state > 3) position.state = 4;
  } else if (position.state) position.state--;
  if (position.state) {
    position.tile = 80;
    position.x = squareX(position) + position.state + 40;
    position.y = squareY(position) - (position.state - 56);
    if (!node.light) {
      node.scrolled = entry.scroll;
      node.light = addNode(c, drawOnly, record(c, CURSOR_LIGHT));
      node.letter = addNode(c, drawLetter, record(c, CURSOR_LETTER));
      showLetter(c, node);
    } else if (node.scrolled !== entry.scroll) {
      node.scrolled = entry.scroll;
      freeSlot(c, node.letter.position.player);
      showLetter(c, node, true);
    }
    node.light.position.tile = position.state * 16;
    for (const { position: over } of [node.light, node.letter]) {
      over.x = position.x;
      over.y = position.y;
    }
  } else {
    position.tile = 0;
    position.x = squareX(position) + 40;
    position.y = squareY(position) + 56;
    if (node.light) {
      removeNode(c, node.light);
      freeSlot(c, node.letter.position.player);
      removeNode(c, node.letter);
      node.light = null;
      node.letter = null;
    }
  }
  draw(c, position);
}

/**
 * The letter under the cursor into a slot, and the sprite over the square showing it. When the list has just scrolled
 * (`afterTheDisplay`), the frame's time has gone on redrawing the grid and on the sound engine, which runs from the
 * display's second line, so the original draws the letter after the display has passed this square, and it shows from
 * the next frame. How long all that takes depends on what the song is playing, so the original can also draw the letter
 * in time, or partly, or lose a frame, on a scroll down from the last row above all, and none of that is here.
 */
function showLetter(c, node, afterTheDisplay = false) {
  const glyph = letterAt(c, c.entry.scroll + c.entry.cursor), slot = takeSlot(c);
  node.letter.position.player = Math.max(slot, 0);
  node.letter.position.tile = Math.max(slot, 0) * 4;
  if (slot < 0) return;
  if (afterTheDisplay) node.lateLetter = () => drawSlot(c, slot, glyph);
  else drawSlot(c, slot, glyph);
}

/** 0x08037100: the letter's sprite. */
function drawLetter(c, node) {
  draw(c, node.position);
}

/** 0x08037110: a square under the name takes its place, and draws from the next frame on. */
function nameSquareStart(c, node) {
  const { position } = node;
  position.x = position.player * 16 + 80;
  position.y = 32;
  node.run = nameSquare;
}

/** 0x080370b8: a square under the name, lit where the next letter goes. */
function nameSquare(c, node) {
  const { position } = node;
  position.tile = position.player === Math.min(c.entry.length, 4) ? 80 : 0;
  position.x = position.player * 16 + 80;
  position.y = 32;
  draw(c, position);
}
