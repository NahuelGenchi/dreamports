// The Mini-games screen, chosen on the main menu (the decompilation's src/unknown_080315bc.cpp: the first frame
// 0x080315bc, its wrapper 0x0803186c, the handlers 0x08032724, 0x0803187c, 0x08031e68, 0x0803256c, 0x080325f0 and
// 0x08032594, and the rows' 0x08032790, 0x080327bc and 0x080327ec, with the arrows' 0x080281c8, 0x08028200,
// 0x08027eb8, 0x08027f38, 0x08028318 and 0x08028350). Four rows of a list of five, a picture and a caption for the one
// chosen, and a frame around it. An entry the save hasn't opened shows as question marks and can't be chosen.
//
// The rows' names and the caption are drawn into VRAM's tiles, a row in each of six slots (0x080211d8), over a copy of
// the blank row the sprites' tiles hold, so a row that scrolls off gives its slot to the next.

import { KEY, colours, copyTileBlock, decompress, fadeToBlack, fadeToWhite, fadeToward, hideSpriteBuffer, queueRegister, unpackCycles } from './core.js';
import { displayOn as menuDisplayOn, fadeSongOut, addNode, draw, drawOnly, frame, menu, place, removeNode, startFrame, takeMatrix, writeRegisters } from './menu.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000;
const DISPCNT = 0, BG3VOFS = 0x1E;

// the cartridge's table of the display registers the first frame writes, and how many
const REGISTERS = 0x08132394, REGISTER_COUNT = 16;

// gUnknown_08edc2d4: the sprites' records, 16 bytes each, and which is which
const RECORDS = 0x08EDC2D4;
const HEADING = 0, HEADING_END = 1, ROWS = 2, ROW_ABOVE = 6, ROW_BELOW = 7, FRAME = 8, PICTURE = 9, CAPTION = 10;
// gUnknown_08edc494 and gUnknown_08edb84c: the frame's four pictures, and which shows at each step of its pulse
const FRAME_PARTS = 0x08EDC494, FRAME_STEPS = 0x08EDB84C;
// gUnknown_08edc4a4: where each of the four rows goes on the screen
const ROW_Y = 0x08EDC4A4;
const ROW_X = 104, FRAME_Y = 12;
// gUnknown_08edb93c: the arrows' parts, and where they sit, off the screen when there's no more list that way
const ARROW_PARTS = 0x08EDB93C, ARROW_X = 168, ARROW_ATTR2 = 240;
const ARROW_UP_Y = 16, ARROW_UP_GONE = -16, ARROW_DOWN_Y = 144, ARROW_DOWN_GONE = 176;

// gUnknown_08edc384 and gUnknown_08edc3a0: each entry's picture and palette, and those of an entry that isn't open
const PICTURES = 0x08EDC384, PICTURE_PALETTES = 0x08EDC3A0, LOCKED = 6;
// gUnknown_030052fc, which the first frame points at gUnknown_08edc3e0 for English: the entries' names, the name of an
// entry that isn't open, and the two captions, the third entry's and the others'
const NAMES = [0x08EDC3BC, 0x08EDC3E0, 0x08EDC404, 0x08EDC428, 0x08EDC44C, 0x08EDC470];
const LOCKED_NAME = 6, CAPTION_OWN = 7, CAPTION_MULTI = 8, OWN_ENTRY = 2;
// the tiles the first frame unpacks those names' sprites from, by language
const SPRITE_WORDS = [0x08133118, 0x081334D8, 0x081334D8, 0x081334D8, 0x081334D8, 0x081334D8];
// gUnknown_0807163c: the bit of the save's list that opens each entry
const ENTRY_BITS = 0x0807163C;
const ENTRIES = 5;

// the font: 32 bytes of pixels for each letter, each one's width, and for each byte of pixels, what it keeps of a
// word of VRAM and which of its nibbles it sets
const GLYPHS = 0x08071B7C, WIDTHS = 0x0807173C, KEEP = 0x0807A37C, SPREAD = 0x0807A77C;
const TEXT_COLOUR = 8, TEXT_SHADOW = 9;
const NEW_LINE = 0xFFFD, NOTHING = 0xFFFC, COLOUR = 0xFFFB, SKIP_ONE = 0xFFFA, SKIP_TWO = 0xFFF9, NO_WIDTH = 0xFFF8, NO_WIDTH_TWO = 0xFFF7, END = 0xFFFE;

const BLANK_ROW = 0x06010420, ROW_TILES = 0x06015000, ROW_BYTES = 0x800, CAPTION_TILES = 0x06013E00, CAPTION_BYTES = 0x200;
const PICTURE_TILES = 0x06014000, PICTURE_COLOURS = 0x05000200;
const SLOTS = 6, ROW_TILE = 640, ROW_TILE_STEP = 64;

// the line the screen has reached as the first picture's tiles finish unpacking with only the first entry open, which
// shows only in how far down that frame they reach, as mGBA measures it; other letters finish below the picture
const PICTURE_DONE_LINE = 108, PICTURE_DONE_LATER = 159;

const SOUND_MOVE = 401, SOUND_MADE = 404, SOUND_BACK = 405, SOUND_REFUSED = 419;
const SONG = 1, SONG_FADE = 60;

/** A sprite's record in the cartridge, as a place (menu.js) of its own. */
function record(c, number) {
  const { rom } = c, from = RECORDS - CARTRIDGE + number * 16;
  return {
    parts: rom.u32(from), x: rom.s16(from + 4), y: rom.s16(from + 6), tile: rom.u16(from + 8),
    attr0: rom.bytes[from + 10], attr1: rom.bytes[from + 11], attr2: rom.bytes[from + 12], player: rom.bytes[from + 13], state: 0,
  };
}

/** 0x08020ecc: the stretch of VRAM at `to`, `width` by `height` tiles, that the next letters go into. */
export function textInto(c, to, width, height) {
  c.text = { to: to - VRAM, end: to - VRAM + width * height * 32, stride: height * 8, rows: height * 8, block: height * 16 };
}

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

/** 0x08020978: a letter into the stretch, at `x` and `y` in pixels, over as many as three columns of tiles. Its width. */
export function putGlyph(c, x, y, glyph, colour) {
  const { to, stride, rows, block } = c.text, { bytes } = c.rom;
  const shift = x & 7, source = GLYPHS - CARTRIDGE + ((glyph & 0x7FFF) << 5);
  const count = rows <= y ? 0 : Math.min(rows - y, 16);
  c.textCycles += 173;
  for (let i = 0; i < count; i++) {
    const at = to + ((x >> 3) * stride + y + i) * 4, first = bytes[source + i * 2], second = bytes[source + i * 2 + 1];
    // this row's turn of the loop, and each stretch of pixels it writes, as mGBA counts 0x08020978's instructions
    c.textCycles += 122 + ((first << shift) & 0xFF ? 62 : 0) + (((first >> (8 - shift)) | (second << shift)) & 0xFF ? 68 : 0) + ((second >> (8 - shift)) & 0xFF ? 68 : 0);
    putPixels(c, at, (first << shift) & 0xFF, colour);
    putPixels(c, at + stride * 4, ((first >> (8 - shift)) | (second << shift)) & 0xFF, colour);
    putPixels(c, at + block * 4, (second >> (8 - shift)) & 0xFF, colour);
  }
  return bytes[WIDTHS - CARTRIDGE + (glyph & 0x7FFF)];
}

/** 0x08020ad0: how wide a text is, in pixels, the width of its last line. */
function textWidth(c, text) {
  let width = 0;
  for (let at = text - CARTRIDGE, token = c.rom.u16(at); token !== END; at += 2, token = c.rom.u16(at)) {
    if (token === NEW_LINE) width = 0;
    else if (token === COLOUR || token === SKIP_ONE || token === SKIP_TWO) at += 2;
    else if (token !== NOTHING && token !== NO_WIDTH && token !== NO_WIDTH_TWO) width += c.rom.bytes[WIDTHS - CARTRIDGE + (token & 0x7FFF)];
  }
  return width;
}

/** 0x08020b74: a text into the stretch from `x` and `y`, each letter over its shadow. */
function putText(c, x, y, text) {
  let colour = TEXT_COLOUR, at = text - CARTRIDGE, left = x, top = y;
  for (let token = c.rom.u16(at); token !== END; at += 2, token = c.rom.u16(at)) {
    if (token === NEW_LINE) { left = 0; top += 16; }
    else if (token === COLOUR) { at += 2; colour = c.rom.u16(at); }
    else if (token === SKIP_ONE || token === SKIP_TWO) at += 2;
    else if (token !== NOTHING && token !== NO_WIDTH && token !== NO_WIDTH_TWO) {
      putGlyph(c, left + 1, top + 1, token, TEXT_SHADOW);
      left += putGlyph(c, left, top, token, colour);
    }
  }
}

/** The text at `number` of the list the language gives. */
const nameAt = (c, number) => c.rom.u32(NAMES[c.language] - CARTRIDGE + number * 4);

/** Whether the save has opened an entry. */
const isOpen = (c, entry) => (c.miniGamesOpen & c.rom.u32(ENTRY_BITS - CARTRIDGE + entry * 4)) !== 0;

/** 0x080211f0: the first of the six slots nobody has, or six when they're all taken. */
function takeSlot(c) {
  const list = c.menu;
  for (let slot = 0; slot < SLOTS; slot++) {
    if (!(list.slots & (1 << slot))) {
      list.slots |= 1 << slot;
      return slot;
    }
  }
  return SLOTS;
}

/** 0x08021244: a slot given back. */
const giveSlot = (c, slot) => { c.menu.slots &= ~(1 << slot); };

/** 0x08032618, as the first frame and the scrolling each write it: a blank row in a new slot with the entry's name. */
function addRow(c, recordNumber, entry) {
  const position = record(c, recordNumber);
  const node = addNode(c, row, position);
  position.state = takeSlot(c);
  position.tile = position.state * ROW_TILE_STEP + ROW_TILE;
  const { vram } = c.video, to = ROW_TILES + (position.state << 11);
  vram.copyWithin(to - VRAM, BLANK_ROW - VRAM, BLANK_ROW - VRAM + ROW_BYTES);
  const text = nameAt(c, isOpen(c, entry) ? entry : LOCKED_NAME);
  textInto(c, to, 16, 4);
  putText(c, 64 - (textWidth(c, text) >> 1), 2, text);
  return node;
}

/** The tiles and the palette of the entry chosen's picture, each as the cartridge's table has it. */
function showPictureTiles(c, entry) {
  decompress(c, c.rom.u32(PICTURES - CARTRIDGE + (isOpen(c, entry) ? entry : LOCKED) * 4), PICTURE_TILES);
}
function showPictureColours(c, entry) {
  decompress(c, c.rom.u32(PICTURE_PALETTES - CARTRIDGE + (isOpen(c, entry) ? entry : LOCKED) * 4), PICTURE_COLOURS);
}

// Unpacking a long picture on a move takes past the interrupt at line 1 (0x08018654), so SoundMain takes the console's
// cycles first, and the colours land that much later: the lines drawn by then keep the old ones, which shows when the
// frame's long enough to reach the picture, at line 49. These are the cycles from the V-blank's start, as mGBA measures
// them: to the tiles' unpacking, which going down takes longer to reach, from it to the colours' unpacking, to line 0's
// being drawn, and when the sound chip's DMA takes its turn, the same in every frame.
const BEFORE_TILES_UP = 2169, BEFORE_TILES_DOWN = 2189, TILES_TO_COLOURS = 250, LINE_ONE = 85000;
const LINE_ZERO_DRAWN = 84777, LINE_CYCLES = 1232;
const DMA_FIRST = 775, DMA_EVERY = 25536, DMA_CYCLES = 18;
// A move can take past the next V-blank too, with the picture's unpacking, SoundMain and the new letters added up. Past
// the first of these cycles a frame of the list is lost, as mGBA measures it, past the second the frame's sprites miss
// that V-blank too, so they take the frame after, and past the third, with less left to do by then, its scroll does.
const FRAME_PASSES_V_BLANK = 245000, SPRITES_PASS_V_BLANK = 246600, SCROLL_PASSES_V_BLANK = 267500;

/** The cycles the sound chip's DMA has added by the time this much work is done. */
function withDma(work) {
  let at = work;
  for (let last = -1; at !== last;) {
    last = at;
    at = work + DMA_CYCLES * (Math.floor((last - DMA_FIRST) / DMA_EVERY) + 1);
  }
  return at;
}

/** The entry's picture on a move, with its colours landing at once if the tiles are done before line 1. */
function showPicture(c, entry, beforeTiles) {
  const table = at => c.rom.u32(at - CARTRIDGE + (isOpen(c, entry) ? entry : LOCKED) * 4);
  const sound = c.sound?.frameCycles();
  const tiles = unpackCycles(c, table(PICTURES));
  const toColours = beforeTiles + tiles + TILES_TO_COLOURS;
  const line = sound == null || toColours < LINE_ONE ? -1 : Math.floor((withDma(toColours + sound) - LINE_ZERO_DRAWN) / LINE_CYCLES);
  c.moveCycles = tiles + unpackCycles(c, table(PICTURE_PALETTES)) + (sound ?? 0);
  showPictureTiles(c, entry);
  if (line < 0) showPictureColours(c, entry);
  else c.lineWork = { line, run: () => { showPictureColours(c, entry); c.video.updateColors(); } };
}

/** What a move's cycles leave of the frame's sprites and scroll for the next V-blank. */
function moveDone(c) {
  const cycles = c.moveCycles + c.textCycles;
  if (cycles >= SPRITES_PASS_V_BLANK) c.menu.spritesLate = true;
  else if (cycles >= FRAME_PASSES_V_BLANK) c.menu.frameLost = true;
  if (cycles >= SCROLL_PASSES_V_BLANK) c.holdQueue = true;
}

/** 0x0803268c: the caption under the picture, which an entry that isn't open doesn't have. */
function showCaption(c, entry) {
  c.video.vram.fill(0, CAPTION_TILES - VRAM, CAPTION_TILES - VRAM + CAPTION_BYTES);
  if (!isOpen(c, entry)) return;
  const text = nameAt(c, entry === OWN_ENTRY ? CAPTION_OWN : CAPTION_MULTI);
  textInto(c, CAPTION_TILES, 8, 2);
  putText(c, 32 - (textWidth(c, text) >> 1), 0, text);
}

/** 0x08032778: the moving layer, a line every frame. */
function scroll(c, node) {
  queueRegister(c, BG3VOFS, node.count & 0xFF);
  node.count = (node.count - 1) | 0;
}

/** 0x08032724: the first palette and the sprites' last fade in, and once they have, the rest of the screen comes. */
function fadeIn(c, node) {
  const backgrounds = fadeToward(c, PALETTE, 0x08132774, 16);
  const sprites = fadeToward(c, 0x050003A0, 0x081329B4, 48);
  if (backgrounds && sprites) node.run = comeIn;
}

/**
 * 0x0803187c: the four rows, the two arrows, and the first entry's picture and caption. Its letters and unpacking run
 * past a V-blank, as mGBA measures it: the picture's tiles finish as the screen is drawn, and its colours and the
 * caption after it, along with the rest of the frame's list.
 */
function comeIn(c, node) {
  c.menu.slots = 0;                // 0x080211d8
  node.selected = 0;
  node.top = 0;
  node.rows = [0, 1, 2, 3].map(entry => addRow(c, ROWS + entry, entry));
  node.arrowUp = addNode(c, arrowStart, place(ARROW_PARTS, 0, 0, 0, ARROW_ATTR2), { baseX: ARROW_X, baseY: ARROW_UP_Y });
  node.arrowDown = addNode(c, arrowStart, place(ARROW_PARTS, 0, 0, 16, ARROW_ATTR2), { baseX: ARROW_X, baseY: ARROW_DOWN_Y });
  c.lineWork = { line: c.miniGamesOpen === 1 ? PICTURE_DONE_LINE : PICTURE_DONE_LATER, run: () => showPictureTiles(c, 0) };
  node.run = comeInRest;
  c.menu.paused = true;
}

function comeInRest(c, node) {
  showPictureColours(c, 0);
  showCaption(c, 0);
  node.position = record(c, FRAME);
  node.run = choosing;
}

/** Up: the choice moves up the list, and the list with it when it reaches the top row. */
function moveUp(c, node) {
  c.moveCycles = 0;
  c.textCycles = 0;
  if (node.selected !== 0) {
    node.selected--;
    showPicture(c, node.selected, BEFORE_TILES_UP);
    showCaption(c, node.selected);
    c.sound?.play(SOUND_MOVE);
  }
  if (node.selected < node.top + 1 && node.top !== 0) {
    node.top--;
    node.rows[3].run = rowOutBelow;
    node.rows[2].position.player = 3;
    node.rows[1].position.player = 2;
    node.rows[0].position.player = 1;
    node.rows = [addRow(c, ROW_ABOVE, node.top), node.rows[0], node.rows[1], node.rows[2]];
  }
  node.arrowUp.run = arrowSlideUp;
  node.arrowUp.position.state = 0;
  moveDone(c);
}

/** Down: the choice moves down the list, and the list with it, the once it can, when it passes the second row. */
function moveDown(c, node) {
  c.moveCycles = 0;
  c.textCycles = 0;
  if (node.selected + 1 > ENTRIES - 1) node.selected = ENTRIES - 1;
  else {
    node.selected++;
    showPicture(c, node.selected, BEFORE_TILES_DOWN);
    showCaption(c, node.selected);
    c.sound?.play(SOUND_MOVE);
  }
  if (node.selected > node.top + 1 && node.top === 0) {
    node.top = 1;
    node.rows[0].run = rowOutAbove;
    node.rows[1].position.player = 0;
    node.rows[2].position.player = 1;
    node.rows[3].position.player = 2;
    node.rows = [node.rows[1], node.rows[2], node.rows[3], addRow(c, ROW_BELOW, node.top + 3)];
  }
  node.arrowDown.run = arrowSlideDown;
  node.arrowDown.position.state = 0;
  moveDone(c);
}

/** 0x08031e68: A chooses an entry that's open, B goes back and up and down move the choice, with the frame pulsing. */
function choosing(c, node) {
  const { pressed } = c.keys;
  if (pressed & KEY.A) {
    if (isOpen(c, node.selected)) {
      node.run = node.selected === OWN_ENTRY ? leaveToItsProgram : leaveToEntry;
      c.miniGame = node.selected;
      c.sound?.play(SOUND_MADE);
      fadeSongOut(c, SONG, SONG_FADE);
    } else c.sound?.play(SOUND_REFUSED);
  } else if (pressed & KEY.B) {
    node.run = leaveToMenu;
    c.sound?.play(SOUND_BACK);
  } else if (pressed & KEY.UP) moveUp(c, node);
  else if (pressed & KEY.DOWN) moveDown(c, node);
  const { position } = node;
  moveToward(position, c.rom.s16(ROW_Y - CARTRIDGE + (node.selected - node.top) * 2) + FRAME_Y);
  position.parts = c.rom.u32(FRAME_PARTS - CARTRIDGE + c.rom.bytes[FRAME_STEPS - CARTRIDGE + ((position.state & 28) >> 2)] * 4);
  draw(c, position);
  position.state = (position.state + 1) & 0xFF;
  node.arrowUp.baseY = halfway(node.selected !== 0 ? ARROW_UP_Y : ARROW_UP_GONE, node.arrowUp.baseY);
  node.arrowDown.baseY = halfway(node.selected <= 3 ? ARROW_DOWN_Y : ARROW_DOWN_GONE, node.arrowDown.baseY);
}

/** 0x0803256c: every colour fades to black, and the main menu starts again, on the choice it made. */
function leaveToMenu(c) {
  if (fadeToBlack(c, PALETTE, 512)) c.callback = menuAfterFade;
}

/**
 * The main menu again (0x08039e20), two frames on, as what it unpacks takes as long here as the name entry's frame and
 * its own do from the title. Its song comes with its display here, not a frame before, as mGBA measures it.
 */
function menuAfterFade(c) {
  c.callback = () => { c.callback = menuAgain; };
}

function menuAgain(c) {
  menu(c, false);
  c.callback = () => {
    c.sound?.call('waveAt', 39422);   // where the song's start comes in its frame, as mGBA measures it after the menu's fade
    c.sound?.play(SONG);
    menuDisplayOn(c);
  };
}

/** 0x080325f0: every colour fades to black, and then 0x080284b4 starts the entry, which isn't ported, so it stops. */
function leaveToEntry(c, node) {
  if (fadeToBlack(c, PALETTE, 512)) node.run = () => {};
}

/**
 * 0x08032594, for the third entry: every colour fades to white, and then the original unpacks a program from the
 * cartridge into work RAM for another console and restarts into it, which isn't ported, so it stops.
 */
function leaveToItsProgram(c, node) {
  if (fadeToWhite(c, PALETTE, 512)) node.run = () => {};
}

/** 0x0801f914: half way from where it is to where it's going, rounded toward where it's going. */
const halfway = (target, now) => target + Math.trunc((now - target) / 2);

/** 0x0801f9a8: a sprite half way down to `y`. True once it's there. */
function moveToward(position, y) {
  position.y = halfway(y, position.y);
  return position.y === y;
}

/** 0x08032790: a row half way to its place, drawn. */
function row(c, node) {
  const { position } = node;
  position.x = halfway(ROW_X, position.x);
  moveToward(position, c.rom.s16(ROW_Y - CARTRIDGE + position.player * 2));
  draw(c, position);
}

/** 0x080327bc and 0x080327ec: a row leaving the top or the bottom of the screen, which gives up its slot when it's gone. */
function rowOut(c, node, y) {
  if (moveToward(node.position, y)) {
    giveSlot(c, node.position.state);
    removeNode(c, node);
  } else draw(c, node.position);
}
function rowOutAbove(c, node) { rowOut(c, node, -16); }
function rowOutBelow(c, node) { rowOut(c, node, 160); }

/** 0x080281c8 and 0x08028200: an arrow takes its place, and draws from the next frame on. */
function arrowStart(c, node) {
  arrowSettle(node);
  node.run = arrowSettled;
}

function arrowSettle(node) {
  const { position } = node;
  position.x = node.baseX - 16;
  position.y = node.baseY - 16;
  position.attr0 = 0;
  position.attr1 = 0;
}

/** 0x08028318 and 0x08028350: an arrow at rest. */
function arrowSettled(c, node) {
  arrowSettle(node);
  draw(c, node.position);
  node.position.state = (node.position.state + 4) & 0xFF;
}

/** 0x08027eb8 and 0x08027f38's shared steps: the arrow grows for four frames and shrinks back in steps of three. */
function arrowSlide(c, node, yOf) {
  const { position } = node;
  let value;
  if (position.state > 15) {
    node.run = arrowSettled;
    value = 0;
  } else if (position.state > 3) value = 4 - Math.trunc((position.state - 4) / 3);
  else value = position.state;
  position.x = node.baseX - 32;
  position.y = yOf(value);
  position.attr0 = 3;
  position.attr1 = takeMatrix(c, value * 16 + 256) * 2;
  draw(c, position);
  position.state = (position.state + 1) & 0xFF;
}

function arrowSlideUp(c, node) { arrowSlide(c, node, value => node.baseY - (value + 32)); }
function arrowSlideDown(c, node) { arrowSlide(c, node, value => node.baseY + (value - 32)); }

/** A sprite that only asks to be drawn, from its record. */
const addRecord = (c, number) => addNode(c, drawOnly, record(c, number));

/**
 * 0x080315bc: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures, the list's
 * nodes, and the display queued on for the next V-blank.
 */
export function miniGames(c) {
  const { video } = c;
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  c.menu = { nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0, slots: 0 };   // 0x0801f780, 0x080210d8, 0x0802110c
  colours(c).fill(0);
  video.vram.fill(0, 0, 0x20);
  video.vram.fill(0, 0x06013E00 - VRAM, 0x06013E00 - VRAM + 0x200);
  video.vram.fill(0, 0x06014000 - VRAM, 0x06014000 - VRAM + 0x1000);
  decompress(c, 0x08132544, 0x06000020);
  decompress(c, 0x08132A14, 0x06010000);
  decompress(c, SPRITE_WORDS[c.language], 0x06012420);
  video.vram.fill(0, 0x0600F800 - VRAM, 0x0600F800 - VRAM + 0x800);
  video.vram.fill(0, 0x0600F000 - VRAM, 0x0600F000 - VRAM + 0x800);
  video.vram.fill(0, 0x0600E800 - VRAM, 0x0600E800 - VRAM + 0x800);
  let to = 0x0600E000;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      copyTileBlock(c, to, 0x081327D4, 8, 8, 1);
      to += 0x10;
    }
    to += 0x1C0;
  }
  addNode(c, startFrame);
  addNode(c, fadeIn, place(0, 0, 0, 0));
  addNode(c, scroll, null, { count: 0 });
  for (const number of [HEADING, HEADING_END, PICTURE, CAPTION]) addRecord(c, number);
  c.sound?.play(SONG);
  c.callback = displayOn;
}

/** 0x080315bc's last step, a frame behind its song: it runs past a V-blank, and the display is queued for the next. */
function displayOn(c) {
  queueRegister(c, DISPCNT, 0x1F40);
  c.callback = frame;              // 0x0803186c
}
