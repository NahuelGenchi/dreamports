// The options screen, chosen last on the main menu (the decompilation's src/unknown_08037148.cpp: the first frame
// 0x08037d44, its wrapper 0x080380e4, the interrupts' 0x080380f4 and 0x080381e4, the handlers 0x08038448 and 0x08038698,
// the bars' 0x08037b10, 0x080382bc and 0x08038360, the texts' 0x08037148 and 0x080375d8, and the moves' 0x08038724,
// 0x0803876c, 0x0803878c, 0x080387b4 and 0x080387dc). Four choices: the language, a music test, a sound test and
// deleting the save, which asks first.
//
// The chosen row stands out by its bar, which a layer of the map draws, and by a copy of its text in the sprites' tiles,
// which sits a few pixels up and to the right of it, and slides there and back as the choice moves.

import { KEY, colours, copyTileBlock, decompress, fadeToBlack, fadeToward, hideSpriteBuffer, queueDecompress, queueRegister } from './core.js';
import { displayOn as menuDisplayOn, addNode, draw, drawOnly, frame, menu, place, scroll, startFrame, writeRegisters } from './menu.js';
import { putGlyph, textInto } from './mini-games.js';
import { record } from './name-entry.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000;
const DISPCNT = 0x00, BG1CNT = 0x0A, BG2CNT = 0x0C;

// the cartridge's table of the display registers the first frame writes, and how many
const REGISTERS = 0x08158674, REGISTER_COUNT = 16;
// gUnknown_081586b4: each label's x, y, text and alignment, four bytes each, and which is which
const LABELS = 0x081586B4;
const HEADINGS = 3, LANGUAGE_ROW = 3, MUSIC_ROW = 4, SOUND_ROW = 5, DELETE_ROW = 6, LANGUAGE_NAMES = 8, DELETE_ASK = 14, DELETE_NO = 15, DELETE_YES = 16;
// gUnknown_08edced0: the texts' list for each language
const TEXTS = 0x08EDCED0;
// gUnknown_08071460 and gUnknown_080714ae: the songs and sounds the two tests play, and their last numbers
const MUSIC = 0x08071460, SOUNDS = 0x080714AE, LAST_MUSIC = 38, LAST_SOUND = 197, LAST_LANGUAGE = 5;
// the digits' first letter in the font, and the end of a text
const DIGITS = 128, END = 0xFFFE;
const WIDTHS = 0x0807173C;

// the stretches of VRAM the rows' texts and the chosen one's copy are drawn into, and what's in each row
const ROWS_TILES = 0x06008020, ROWS_WIDTH = 24, ROWS_HEIGHT = 18, ROW_STRIDE = 576;
const CHOSEN_TILES = 0x06017A00, CHOSEN_BYTES = 0x600, CHOSEN_HEIGHT = 2;
const ROW_STARTS = [0x06008078, 0x060080F8, 0x06008138, 0x060081B8];
const VALUE_X = 160, TEXT_COLOUR = 2;

// the bars' pieces of map, each unpacked to a row of it at the next V-blank: unlit and lit, the top and the bottom
const BAR_OFF_TOP = 0x081589B4, BAR_OFF_BOTTOM = 0x08158A14, BAR_OFF_NEXT = 0x08158A44, BAR_OFF_END = 0x081589E8;
const BAR_ON_TOP = 0x08158958, BAR_ON_BOTTOM = 0x08158904, BAR_ON_NEXT = 0x08158930, BAR_ON_END = 0x081588EC;

// the two sprites at the top, the cursor's parts and the chosen text's, which is a copy kept so its place can change
const RECORDS = 0x08EDCD0C, RECORD_BYTES = 16;
const CURSOR_PARTS = 0x08159FD4, CHOSEN_PARTS = 0x08159FC4, CHOSEN_PARTS_BYTES = 16, CHOSEN_TILE = 96;
// gUnknown_08edcee8 and gUnknown_08edcef4: where the cursor and the chosen text sit on each row
const CURSOR_Y = 0x08EDCEE8, CHOSEN_Y = 0x08EDCEF4, CURSOR_X = 120, CHOSEN_X = 207, CHOSEN_MOVING_X = 199;
// gUnknown_08edcd2c: the display status each row's frame gives for the second interrupt, whose line is its top byte
const LINES = 0x08EDCD2C;

const DELETE = 3, DELETE_ASKING = 4;
const SOUND_MOVE = 401, SOUND_ASK = 402, SOUND_MADE = 404, SOUND_BACK = 405, SONG = 1;

// how many letters a frame's handler draws before its sound starts late, as mGBA measures it: English's language row is
// 30, and the numbers' rows 12
const LETTERS_BEFORE_THE_LIBRARY = 24;

// how many letters of the screen's first frame take it past a second V-blank, as mGBA measures it: English has about
// 90 and Japanese about 60
const LETTERS_PAST_A_FRAME = 75;

// the time 0x080217d0 takes to write the save, with the screen black, as mGBA measures it
const SAVING_FRAMES = 18;
// the time 0x08021980 takes to read it back and find nothing has changed
const READING_FRAMES = 3;

const u8 = value => value & 0xFF;

/** Where a label says it goes, and its text in the language the screen opened with. */
function label(c, number) {
  const { bytes } = c.rom, at = LABELS - CARTRIDGE + number * 4;
  return { x: bytes[at], y: bytes[at + 1], text: c.rom.u32(c.menu.texts + bytes[at + 2] * 4 - CARTRIDGE), alignment: bytes[at + 3] };
}

/** 0x08020ad0, for a text that has only letters: how wide it is, from `first`. */
function width(c, letters, first = 0) {
  let total = 0;
  for (let i = first; letters[i] !== END; i++) total += c.rom.bytes[WIDTHS - CARTRIDGE + (letters[i] & 0x7FFF)];
  return total;
}

/** A text as a list of its letters, up to its end. */
function letters(c, text) {
  const out = [];
  for (let at = text - CARTRIDGE, letter = c.rom.u16(at); letter !== END; at += 2, letter = c.rom.u16(at)) out.push(letter);
  out.push(END);
  return out;
}

/** The letters from `x` and `y`, each a byte further along by its width, as 0x08038204 and the texts' own loops do. */
function putLetters(c, x, y, text) {
  let left = u8(x);
  for (let i = 0; text[i] !== END; i++) {
    left = u8(left + putGlyph(c, left, y, text[i], TEXT_COLOUR));
    c.menu.letters++;
  }
}

/** A label's text, moved left by its width or half of it as the label says, with `y` in place of the label's when given. */
function putLabel(c, number, y) {
  const at = label(c, number), text = letters(c, at.text);
  let { x } = at;
  if (at.alignment === 1) x -= width(c, text);
  else if (at.alignment === 2) x -= width(c, text) >> 1;
  putLetters(c, x, y ?? at.y, text);
  return text;
}

/** A number as its digits, with the first of them blanked while they're zero, and how many were. */
function digits(number, count) {
  const out = [];
  for (let unit = 10 ** (count - 1); unit >= 1; unit = Math.trunc(unit / 10)) out.push(u8(Math.trunc(number / unit) % 10) + DIGITS);
  let skip = 0;
  while (skip < count - 1 && out[skip] === DIGITS) {
    out[skip] = 0;
    skip++;
  }
  out.push(END);
  return { letters: out, skip };
}

/** A row's number, right up against the column its values end at. */
function putNumber(c, number, count, y) {
  const value = digits(number, count);
  putLetters(c, VALUE_X - width(c, value.letters), y, value.letters);
  return width(c, value.letters, value.skip);
}

/** 0x08037148: a row of the screen's text, cleared and drawn again, and how wide its value is, for the chosen text's place. */
function drawRow(c, row) {
  const { vram } = c.video, list = c.menu;
  textInto(c, ROWS_TILES, ROWS_WIDTH, ROWS_HEIGHT);
  for (let y = 0, at = ROW_STARTS[row] - VRAM; y < ROWS_WIDTH; y++, at += ROW_STRIDE) vram.fill(0, at, at + 64);
  if (row === 0) {
    putLabel(c, LANGUAGE_ROW);
    const name = LANGUAGE_NAMES + c.language;
    list.valueWidth[0] = width(c, putLabel(c, name));
  } else if (row === 1) {
    putLabel(c, MUSIC_ROW);
    list.valueWidth[1] = putNumber(c, list.music, 2, label(c, MUSIC_ROW).y);
  } else if (row === 2) {
    putLabel(c, SOUND_ROW);
    list.valueWidth[2] = putNumber(c, list.sound, 3, label(c, SOUND_ROW).y);
  } else {
    putLabel(c, DELETE_ROW);
    list.valueWidth[3] = 0;
  }
}

/** 0x080375d8: the chosen row's text again, in the sprites' tiles. */
function drawChosen(c, row) {
  const { vram } = c.video, list = c.menu;
  textInto(c, CHOSEN_TILES, ROWS_WIDTH, CHOSEN_HEIGHT);
  vram.fill(0, CHOSEN_TILES - VRAM, CHOSEN_TILES - VRAM + CHOSEN_BYTES);
  if (row === 0) {
    putLabel(c, LANGUAGE_ROW, 0);
    putLabel(c, LANGUAGE_NAMES + c.language, 0);
  } else if (row === 1) {
    putLabel(c, MUSIC_ROW, 0);
    putNumber(c, list.music, 2, 0);
  } else if (row === 2) {
    putLabel(c, SOUND_ROW, 0);
    putNumber(c, list.sound, 3, 0);
  } else if (row === DELETE) {
    putLabel(c, DELETE_ROW, 0);
  } else {
    putLabel(c, DELETE_ASK, 0);
    list.valueWidth[DELETE_ASKING] = width(c, putLabel(c, list.deleting ? DELETE_YES : DELETE_NO, 0));
  }
}

// each row's two pieces of the bar's map, as 0x08037b10, 0x080382bc, 0x08038360 and 0x08037c30 give them
const BAR_PLACES = [[0x0600E980, 0x0600EA00], [0x0600EA80, 0x0600EB00], [0x0600EB00, 0x0600EB80], [0x0600EC00, 0x0600EC80]];
const BAR_OFF = [[BAR_OFF_TOP, BAR_OFF_BOTTOM], [BAR_OFF_TOP, BAR_OFF_NEXT], [BAR_OFF_NEXT, BAR_OFF_BOTTOM], [BAR_OFF_TOP, BAR_OFF_END]];
const BAR_ON = [[BAR_ON_TOP, BAR_ON_BOTTOM], [BAR_ON_TOP, BAR_ON_NEXT], [BAR_OFF_END, BAR_ON_BOTTOM], [BAR_ON_TOP, BAR_ON_END]];

/** 0x080382bc and 0x08038360: a row's bar goes off or on, at the next V-blank. */
function bar(c, row, pieces) {
  BAR_PLACES[row].forEach((to, i) => queueDecompress(c, to, pieces[row][i]));
}

/** 0x08037b10: the screen opens with the first row's bar on and the second's off. */
function firstBars(c) {
  bar(c, 0, BAR_ON);
  bar(c, 1, BAR_OFF);
}

/** 0x080388a0: the palettes fade in, and then the choice can be moved. */
function fadeIn(c, node) {
  const backgrounds = fadeToward(c, PALETTE, 0x08158B94, 80);
  const layer = fadeToward(c, 0x050001E0, 0x081327B4, 16);
  const sprites = fadeToward(c, 0x05000200, 0x08159770, 80);
  if (backgrounds && layer && sprites) node.run = choosing;
}

/** A song or sound played alone, as the tests and the moves do: 0x0801f638 stops all the others. */
function playAlone(c, song) {
  c.sound?.stopAll();
  c.sound?.play(song);
}

/** Left or right on a row with a value: it goes round, the row and its copy are drawn again, and a sound says so. */
function change(c, row, by) {
  const list = c.menu;
  if (row === 0) c.language = wrap(c.language + by, LAST_LANGUAGE);
  else if (row === 1) list.music = wrap(list.music + by, LAST_MUSIC);
  else if (row === 2) list.sound = wrap(list.sound + by, LAST_SOUND);
  if (row <= 2) {
    list.letters = 0;
    drawRow(c, row);
    drawChosen(c, row);
    // with this many letters to draw, the sound's start comes after the sound library's run in this frame, at the
    // first line, as mGBA measures it, so it starts in the next (notes/a-long-row-starts-its-sound-a-frame-late.md)
    if (list.letters > LETTERS_BEFORE_THE_LIBRARY) list.lateSound = SOUND_MOVE;
    else c.sound?.play(SOUND_MOVE);
  }
}

const wrap = (value, last) => (value < 0 ? last : value > last ? 0 : value);

/** 0x08038448: B or Start leaves, A does what the row does, up and down move the choice, left and right its value. */
function choosing(c, node) {
  const { pressed } = c.keys, list = c.menu;
  if (pressed & (KEY.B | KEY.START)) {
    node.run = leaveToMenu;
    playAlone(c, SOUND_BACK);
  } else if (pressed & KEY.A) {
    if (list.selection === 1) playAlone(c, c.rom.u16(MUSIC - CARTRIDGE + list.music * 2));
    else if (list.selection === 2) playAlone(c, c.rom.u16(SOUNDS - CARTRIDGE + list.sound * 2));
    else if (list.selection === DELETE) {
      list.selection = DELETE_ASKING;
      list.deleting = 0;
      drawChosen(c, DELETE_ASKING);
      node.run = asking;
      c.sound?.play(SOUND_ASK);
    }
  }
  const { repeated } = c.keys;
  if (repeated & KEY.UP) {
    node.run = moveUp;
    playAlone(c, SOUND_MOVE);
  } else if (repeated & KEY.DOWN) {
    node.run = moveDown;
    playAlone(c, SOUND_MOVE);
  }
  if (repeated & KEY.LEFT) change(c, list.selection, -1);
  else if (repeated & KEY.RIGHT) change(c, list.selection, 1);
}

/** 0x08038698: are you sure. A on yes deletes, A on no or B goes back to the row, and left and right change the answer. */
function asking(c, node) {
  const { pressed } = c.keys, list = c.menu;
  if ((pressed & KEY.B) || ((pressed & KEY.A) && !list.deleting)) {
    list.selection = DELETE;
    drawChosen(c, DELETE);
    node.run = choosing;
    c.sound?.play(SOUND_BACK);
  } else if (pressed & KEY.A) {
    node.run = leaveDeleting;
    c.sound?.play(SOUND_MADE);
  } else if (pressed & (KEY.LEFT | KEY.RIGHT)) {
    list.deleting ^= 1;
    drawChosen(c, DELETE_ASKING);
    c.sound?.play(SOUND_MOVE);
  }
}

/** 0x08038724: the chosen text slides down onto its row, the bar goes off, and the choice goes up, round to the last. */
function moveUp(c, node) {
  const list = c.menu;
  if (list.shift > 1) {
    list.shift--;
    return;
  }
  list.shift = 0;
  bar(c, list.selection, BAR_OFF);
  list.selection = list.selection === 0 ? DELETE : list.selection - 1;
  node.run = moved;
}

/** 0x080387dc: the same going down, round to the first, which leaves the slide a step from its end. */
function moveDown(c, node) {
  const list = c.menu;
  if (list.shift > 1) {
    list.shift--;
    return;
  }
  bar(c, list.selection, BAR_OFF);
  list.selection = list.selection >= DELETE ? 0 : list.selection + 1;
  node.run = moved;
}

/** 0x0803876c: the new row's copy. */
function moved(c, node) {
  drawChosen(c, c.menu.selection);
  node.run = barOn;
}

/** 0x0803878c: the new row's bar. */
function barOn(c, node) {
  bar(c, c.menu.selection, BAR_ON);
  c.menu.shift = 1;
  node.run = slideOut;
}

/** 0x080387b4: the chosen text slides back up off its row, and then the choice can move again. */
function slideOut(c, node) {
  const list = c.menu;
  if (list.shift <= 3) list.shift++;
  else {
    list.shift = 4;
    node.run = choosing;
  }
}

/** 0x08038820: every colour fades to black, the language is kept, and the main menu starts again. */
function leaveToMenu(c) {
  if (!fadeToBlack(c, PALETTE, 512)) return;
  leaveInterrupts(c);
  // 0x08021980 reads the save back, and 0x080217d0 only writes it when it has changed
  if (c.language !== c.savedLanguage) {
    c.savedLanguage = c.language;
    c.languageSave?.write(Uint8Array.of(c.language));
    c.savingFrames = SAVING_FRAMES;
  } else c.savingFrames = READING_FRAMES;
  c.callback = saving;
}

/** The time 0x080217d0 takes, and then the main menu (0x08039e20), whose song comes with its display, as mGBA measures it. */
function saving(c) {
  if (--c.savingFrames > 0) return;
  menu(c, false);
  c.callback = () => {
    c.sound?.play(SONG);
    menuDisplayOn(c);
  };
}

/**
 * 0x08038850: every colour fades to black, and then the save goes (0x0802188c clears the flash, and 0x080215a8 writes a
 * new save's values, of which the Dreamport has the name, the language and the open mini-games), and the game starts
 * again from its first callback (0x08000210).
 */
function leaveDeleting(c) {
  if (!fadeToBlack(c, PALETTE, 512)) return;
  leaveInterrupts(c);
  c.name.fill(0);
  c.nameSave?.erase();
  c.language = 1;
  c.savedLanguage = 1;
  c.languageSave?.erase();
  c.miniGamesOpen = 1;
  c.frames = 1;
  c.savingFrames = SAVING_FRAMES;
  c.callback = restarting;
}

function restarting(c) {
  if (--c.savingFrames > 0) return;
  c.callback = c.main;
  c.callback(c);
}

/** 0x080380b0: the interrupts as the other screens have them. */
function leaveInterrupts(c) {
  c.vblankWork = null;
  c.lineWork = null;
}

/** 0x08038918 and 0x0803895c: the cursor, off the row's end by as far as the slide has gone, and nothing once it's back. */
function cursorStart(c, node) {
  const { position } = node;
  position.parts = CURSOR_PARTS;
  position.tile = 0;
  position.attr2 = 8;
  node.run = cursor;
}

function cursor(c, node) {
  const { position } = node, { selection, shift } = c.menu;
  position.x = shift + CURSOR_X;
  position.y = c.rom.u16(CURSOR_Y - CARTRIDGE + selection * 2) - shift;
  if (shift !== 0) draw(c, position);
}

/** 0x080389a8: the chosen text's own parts, a copy with its place for the value's width, and then it draws (0x08038a20). */
function chosenStart(c, node) {
  const { position } = node, parts = c.rom.bytes.slice(CHOSEN_PARTS - CARTRIDGE, CHOSEN_PARTS - CARTRIDGE + CHOSEN_PARTS_BYTES);
  position.ownParts = parts;
  parts[5] = -(c.menu.valueWidth[c.menu.selection] + 12);
  position.tile = CHOSEN_TILE;
  position.x = CHOSEN_X;
  position.y = c.rom.u16(CHOSEN_Y - CARTRIDGE + c.menu.selection * 2);
  position.attr2 = 4;
  node.run = chosen;
}

function chosen(c, node) {
  const { position } = node, { selection, shift, valueWidth } = c.menu;
  position.ownParts[5] = -(valueWidth[selection] + 12);
  position.x = shift + CHOSEN_MOVING_X;
  position.y = c.rom.u16(CHOSEN_Y - CARTRIDGE + selection * 2) + 8 - shift;
  if (selection !== DELETE) draw(c, position);
}

/** 0x080380f4 and 0x080381a8: the V-blank's two layers low, and the line that lifts them, under the chosen row. */
function vblankWork(c) {
  if (c.menu.lateSound) {
    c.sound?.play(c.menu.lateSound);
    c.menu.lateSound = 0;
  }
  c.video.write(BG1CNT, 0x1E0A);
  c.video.write(BG2CNT, 0x1D02);
  const line = c.rom.u16(LINES - CARTRIDGE + c.menu.selection * 2) >> 8;
  c.lineWork = { line: line - 1, run: liftLayers };
}

/** 0x080381e4: the two layers lifted, from that line down. */
function liftLayers(c) {
  c.video.write(BG1CNT, 0x1E09);
  c.video.write(BG2CNT, 0x1D01);
}

/**
 * 0x08037d44: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures, the maps, the
 * screen's text, the list's nodes, and the display queued on for the next V-blank. The song the main menu started goes
 * on fading out behind it.
 */
export function options(c) {
  const { video } = c;
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  c.menu = {
    nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0, shift: 4, music: 0, sound: 0, deleting: 0, letters: 0, lateSound: 0,
    valueWidth: [0, 0, 0, 0, 0], texts: c.rom.u32(TEXTS - CARTRIDGE + c.language * 4),
  };
  colours(c).fill(0);
  decompress(c, 0x081586F8, VRAM);
  decompress(c, 0x08132544, 0x06004000);
  decompress(c, 0x08158BF4, 0x06010000);
  decompress(c, c.language === 0 ? 0x08158E1C : 0x08159314, 0x06010C80);
  video.vram.fill(0, 0x0600F800 - VRAM, 0x0600F800 - VRAM + 0x800);
  decompress(c, 0x08158A70, 0x0600F800);
  video.vram.fill(0, 0x0600F000 - VRAM, 0x0600F000 - VRAM + 0x800);
  video.vram.fill(0, 0x06008000 - VRAM, 0x06008000 - VRAM + 0x3620);
  for (let x = 0, tile = 0x2001; x < ROWS_WIDTH; x++) {
    for (let y = 0, at = 0x0600F10A - VRAM + x * 2; y < ROWS_HEIGHT; y++, at += 64, tile++) {
      video.vram[at] = tile & 0xFF;
      video.vram[at + 1] = tile >> 8;
    }
  }
  textInto(c, ROWS_TILES, ROWS_WIDTH, ROWS_HEIGHT);
  for (let number = 0; number < HEADINGS; number++) putLabel(c, number);
  for (let row = 0; row < 4; row++) drawRow(c, row);
  video.vram.fill(0, 0x0600E800 - VRAM, 0x0600E800 - VRAM + 0x800);
  decompress(c, 0x08158AD0, 0x0600E900);
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
  addNode(c, cursorStart, place(0, 0, 0, 0));
  drawChosen(c, 0);
  addNode(c, drawOnly, record(c, RECORDS));
  addNode(c, drawOnly, record(c, RECORDS + RECORD_BYTES));
  addNode(c, chosenStart, place(0, 0, 0, 0));
  c.callback = c.menu.letters > LETTERS_PAST_A_FRAME ? () => { c.callback = displayOn; } : displayOn;
}

/** 0x08037d44's last steps, a frame or two on: its unpacking and letters run past a V-blank or two, as mGBA measures it, and the bars and the display are queued for the next. */
function displayOn(c) {
  firstBars(c);
  queueRegister(c, DISPCNT, 0x1F40);
  c.callback = frame;              // 0x080380e4
  c.vblankWork = vblankWork;
}
