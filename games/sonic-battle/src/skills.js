// Emerl's screen, which the story map opens with R, by way of the initializer 0x08021b0c. It shows Emerl and a menu of
// five: Edit skills, Change memory, Skill list, Exchange skills and Return to game. What the first four open isn't
// ported, so A does nothing on them yet, and neither is the story map that Return to game goes back to, so the screen
// stays black there. Nothing leads here yet either: `skills` in the address is a recording's start point.
//
// It's built from the same list of nodes as the main menu (menu.js).

import { KEY, colours, decompress, fadeToward, fadeToBlack, hideSpriteBuffer, queueCopy, queueRegister } from './core.js';
import { addNode, draw, frame, place, removeNode, startFrame, writeRegisters } from './menu.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000;
const SPRITE_PALETTE = 0x05000200;

// the cartridge's table of the display registers the initializer writes, and how many
const REGISTERS = 0x0810C074, REGISTER_COUNT = 16;
const DISPCNT = 0x00;

// the colours the screen fades in to
const BACKGROUND_COLOURS = 0x0810C0B4, SPRITE_COLOURS = 0x0810C2B4;

// the five choices' pictures, one after another in the USA copy, each taken to a slot of sprite tiles as it's needed
const CHOICES = 5, LAST = CHOICES - 1, CHOICE_BYTES = 1152;
const CHOICE_PICTURES = 0x080B3D98, CHOICE_TILES = 0x06015300, CHOICE_FIRST_TILE = 664, CHOICE_SLOT_TILES = 36;
// the parts of a choice's sprite and of the cursor's eight frames, and which of them each of its eight steps shows
const PARTS_CHOICE = 0x08EDB498, PARTS_CURSOR = 0x08EDB740, CURSOR_STEPS = 0x08EDB84C;
const CURSOR_TILE = 336;
// where the choices rest, and how far apart
const REST_X = 120, FIRST_Y = 16, ROW = 24, ENTER_X = 256;

const SONG = 31, SOUND_MOVE = 417, SOUND_MADE = 405;
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
const SONG_TABLE = 0x08BF7244;
// how many frames of the song's fade make a step: 0x0801f718(31, 60) keeps 60 >> 4
const SONG_FADE_STEP = 60 >> 4;

// Edit skills, the first of the four choices (0x080221e0): the MOVE category's five rows at a time, the category's
// tab, the memory used, and the picture of the skill in each row. A player moves through the rows. The other
// categories, and the skills that can go in a row, come later.
const EDIT = {
  // each category's first picture and how many rows it has, in gUnknown_08edb828, and the row pictures themselves
  ROWS: 0x08EDB828, PICTURES: 0x080AAD98, TILES: 0x06015300, PICTURE_BYTES: 1152,
  // the four category tabs' pictures and parts, in the English copy, and the two layers' map
  TAB_PICTURES: [0x0807C29C, 0x0807C370, 0x0807C458, 0x0807C540],
  TAB_PARTS: [0x08EDB638, 0x08EDB648, 0x08EDB658, 0x08EDB668],
  TAB_MAP: 0x0807BF98,
  // the header's place and the rows' places, and the cursor's parts and frames
  HEADER_X: 104, HEADER_Y: 8, ROW_X: 120, FIRST_ROW_Y: 36, ROW_STEP: 24,
  ROW_PARTS: 0x08EDB498, FIRST_ROW_TILE: 664, ROW_TILE_STEP: 36,
  CURSOR_PARTS: 0x08EDB740, CURSOR_STEPS: 0x08EDB84C, CURSOR_TILE: 336,
  // how many rows of the category fit at once, and how many sprites the screen may have at once
  VISIBLE: 5, SLOTS: 10,
  SOUND_ENTER: 416,
};

/** A value halfway to `target`, rounded toward the target, as 0x0801f92c and 0x0801f9a8 step a sprite. */
const halfway = (value, target) => target + Math.trunc((value - target) / 2);

/** 0x08022f40: both palettes fade in, and then the menu comes. */
function fadeIn(c, node) {
  const background = fadeToward(c, PALETTE, BACKGROUND_COLOURS, 256);
  const sprites = fadeToward(c, SPRITE_PALETTE, SPRITE_COLOURS, 256);
  if (background && sprites) node.run = menuStart;
}

/** 0x08021f34: each choice's picture copied to its slot of tiles after the next V-blank, and its sprite added. The
 *  allocator (0x080211d8, 0x080211f0) has ten slots, all free here, so the five take the first five. */
function menuStart(c, node) {
  node.choices = [];
  for (let i = 0; i < CHOICES; i++) {
    const slot = takeEditSlot(c);
    queueCopy(c, CHOICE_TILES + slot * CHOICE_BYTES, CHOICE_PICTURES + i * CHOICE_BYTES, CHOICE_BYTES);
    const choice = addNode(c, choiceStart, place(0, 0, 0, slot * CHOICE_SLOT_TILES + CHOICE_FIRST_TILE), { row: i });
    choice.slot = slot;
    node.choices.push(choice);
  }
  node.run = slideIn;
}

/** 0x0802446c: a choice takes its place off the right of the screen, and draws from the next frame on. */
function choiceStart(c, node) {
  const { position } = node;
  position.parts = PARTS_CHOICE;
  position.x = ENTER_X;
  position.y = node.row * ROW + FIRST_Y;
  position.attr2 = 12;
  node.run = choiceRest;
}

/** 0x080244ac: a choice at rest. */
function choiceRest(c, node) {
  draw(c, node.position);
}

/** 0x08022004: the choices slide in, halving the distance each frame, and then the cursor comes. */
function slideIn(c, node) {
  let arrived = 0;
  for (const { position, row } of node.choices) {
    const y = row * ROW + FIRST_Y;
    position.y = halfway(position.y, y);
    position.x = halfway(position.x, REST_X);
    if (position.x === REST_X && position.y === y) arrived++;
  }
  if (arrived > 3) {
    node.cursor = addNode(c, cursorStart, place(0, 0, 0, CURSOR_TILE), { row: c.menu.selection });
    node.run = choosing;
  }
}

/** 0x08024b90: the cursor takes its place on its row, and draws from the next frame on. */
function cursorStart(c, node) {
  const { position } = node;
  position.parts = c.rom.u32(PARTS_CURSOR - CARTRIDGE);
  position.x = REST_X;
  position.y = node.row * ROW + FIRST_Y;
  position.attr2 = 8;
  node.run = cursor;
}

/** 0x08024994, with 0x0801f9a8: the cursor's frame from the screen's count of frames, and halfway to its row. */
function cursor(c, node) {
  const { position } = node;
  const step = c.rom.bytes[CURSOR_STEPS - CARTRIDGE + ((c.menu.frames & 28) >> 2)];
  position.parts = c.rom.u32(PARTS_CURSOR - CARTRIDGE + step * 4);
  position.y = halfway(position.y, node.row * ROW + FIRST_Y);
  draw(c, position);
}

/** 0x080220a4: down and up move the cursor round the five, repeating while held, B goes to Return to game, and A on
 *  that leaves. */
function choosing(c, node) {
  const { repeated, pressed } = c.keys, { cursor: moving } = node;
  if (repeated & KEY.DOWN) {
    moving.row = moving.row === LAST ? 0 : moving.row + 1;
    c.sound?.play(SOUND_MOVE);
  } else if (repeated & KEY.UP) {
    moving.row = moving.row === 0 ? LAST : moving.row - 1;
    c.sound?.play(SOUND_MOVE);
  } else if (pressed & KEY.A) {
    if (moving.row === LAST) {
      node.run = leaving;
      c.sound?.fadeOut(c.rom.bytes[SONG_TABLE - CARTRIDGE + SONG * 8 + 4], SONG_FADE_STEP);
      c.sound?.play(SOUND_MADE);
    } else if (moving.row === 0) {
      removeNode(c, moving);
      const chosen = node.choices[moving.row];
      for (const choice of node.choices) choice.run = choice === chosen ? choiceChosen : choiceAway;
      node.reused = chosen;
      node.run = editEntry;
      c.sound?.play(EDIT.SOUND_ENTER);
    }
  } else if ((pressed & KEY.B) && moving.row !== LAST) {
    moving.row = LAST;
    c.sound?.play(SOUND_MOVE);
  }
}

/** 0x08023038: every colour fades to black, and then the story map comes back, which isn't ported, so it stops. */
function leaving(c, node) {
  if (fadeToBlack(c, PALETTE, 512)) node.run = () => {};
}

// Edit skills (0x080221e0 onwards). The screen is the same list of nodes as the main menu: a header for the
// category, five rows, and a cursor. The rows' pictures are copied into ten sprite slots, five at a time, and the
// whole screen slides in from the right.
//
// The category's first row and how many it has are a table of two bytes each (0x08edb828); each row's picture is
// 1,152 bytes, taken from the English copy's table (0x080aad98). The header's picture and parts change with the
// category, and its map (0x0807bf98) is the same for all four.

/** 0x080211f0: the first of the ten slots nobody has, or ten when they're all taken. */
function takeEditSlot(c) {
  for (let slot = 0; slot < EDIT.SLOTS; slot++) {
    if (!(c.menu.slots & (1 << slot))) {
      c.menu.slots |= 1 << slot;
      return slot;
    }
  }
  return EDIT.SLOTS;
}

/** 0x08021244: a slot given back. */
const giveEditSlot = (c, slot) => { c.menu.slots &= ~(1 << slot); };

/** 0x0801f92c: a sprite half way to `x` and `y`. True once it's there. */
function editMoveTo(position, x, y) {
  position.x = halfway(position.x, x);
  position.y = halfway(position.y, y);
  return position.x === x && position.y === y;
}

/** 0x0801f978: a sprite half way to `x`. True once it's there. */
function editMoveX(position, x) {
  position.x = halfway(position.x, x);
  return position.x === x;
}

/** The category's first picture and how many rows it has. */
function editCategory(c) {
  const at = EDIT.ROWS - CARTRIDGE + c.menu.category * 2;
  return { first: c.rom.bytes[at], count: c.rom.bytes[at + 1] };
}

/** 0x08024708: the category's tab, off the right of the screen until the screen slides in. */
function editHeaderStart(c, node) {
  const { position } = node;
  position.tile = 0;
  position.x = 360;
  position.y = EDIT.HEADER_Y;
  position.attr2 = 12;
  node.run = editHeader;
}

/** 0x080245ec: the tab at the screen's x, drawn from the next frame on. */
function editHeader(c, node) {
  node.position.x = c.menu.x + EDIT.HEADER_X;
  draw(c, node.position);
}

/** 0x0802460c: a row off the right of the screen, its own picture in its own slot of tiles. */
function editRowStart(c, node) {
  node.position.parts = EDIT.ROW_PARTS;
  node.run = editRow;
}

/** 0x080245a0: a row at the screen's x, half way to its place. */
function editRow(c, node) {
  const { position } = node;
  position.x = c.menu.x + EDIT.ROW_X;
  position.y = halfway(position.y, node.row * EDIT.ROW_STEP + EDIT.FIRST_ROW_Y);
  draw(c, position);
}

/** 0x08024bd8: the cursor on its row, drawn from the next frame on. */
function editCursorStart(c, node) {
  const { position } = node;
  position.parts = c.rom.u32(EDIT.CURSOR_PARTS - CARTRIDGE);
  position.x = EDIT.ROW_X;
  position.y = node.row * EDIT.ROW_STEP + EDIT.FIRST_ROW_Y;
  position.attr2 = 8;
  node.run = editCursor;
}

/** 0x080249e4, with 0x0801f9a8: the cursor's frame from the screen's count of frames, and halfway to its row. */
function editCursor(c, node) {
  const { position } = node;
  const step = c.rom.bytes[EDIT.CURSOR_STEPS - CARTRIDGE + ((c.menu.frames & 28) >> 2)];
  position.parts = c.rom.u32(EDIT.CURSOR_PARTS - CARTRIDGE + step * 4);
  position.y = halfway(position.y, node.row * EDIT.ROW_STEP + EDIT.FIRST_ROW_Y);
  draw(c, position);
}

/** 0x080221e0: the first frame of the screen, after the main menu's A. The category's tab and map, then the rows. */
function editEntry(c, node) {
  const category = c.menu.category;
  node.header = addNode(c, editHeaderStart, place(EDIT.TAB_PARTS[category], 360, EDIT.HEADER_Y, 0, 12));
  decompress(c, EDIT.TAB_PICTURES[category], 0x0600F000);
  decompress(c, EDIT.TAB_MAP, 0x0600E000);
  c.menu.x = 256;
  node.run = editBuild;
}

/** 0x080222c4: five rows, each its picture taken to a slot of sprite tiles. */
function editBuildRows(c, node) {
  const { first, count } = editCategory(c);
  const page = 0;
  node.rows = [];
  for (let i = 0; i < EDIT.VISIBLE; i++) {
    const slot = takeEditSlot(c);
    if (slot >= EDIT.SLOTS) {
      for (const row of node.rows) giveEditSlot(c, row.slot);
      return false;
    }
    let index = first + page + i;
    if (index >= first + count) index = first;
    queueCopy(c, EDIT.TILES + slot * EDIT.PICTURE_BYTES, EDIT.PICTURES + index * EDIT.PICTURE_BYTES, EDIT.PICTURE_BYTES);
    const row = addNode(c, editRowStart, place(EDIT.ROW_PARTS, 256, i * EDIT.ROW_STEP + EDIT.FIRST_ROW_Y,
      slot * EDIT.ROW_TILE_STEP + EDIT.FIRST_ROW_TILE, 12), { row: i, slot, index });
    node.rows.push(row);
  }
  return true;
}

/** 0x080222c4: the five rows of the category, which the screen slides in with. */
function editBuild(c, node) {
  if (editBuildRows(c, node)) node.run = editSlideIn;
}

/** 0x080223d8: the screen slides in from the right, and then the cursor comes. */
function editSlideIn(c, node) {
  c.menu.x = halfway(c.menu.x, 0);
  queueRegister(c, 16, (-c.menu.x) & 0x1FF);
  queueRegister(c, 20, (-c.menu.x) & 0x1FF);
  if (c.menu.x !== 0) return;
  node.cursor = addNode(c, editCursorStart, place(0, 0, 0, EDIT.CURSOR_TILE), { row: 0, page: 0 });
  node.run = editChoosing;
}

/** 0x080244bc: the choice the player picked moves to the top left, behind the screen that comes. */
function choiceChosen(c, node) {
  editMoveTo(node.position, 4, 4);
  draw(c, node.position);
}

/** 0x08024540: a choice slides off the right, and gives its slot back. */
function choiceAway(c, node) {
  if (editMoveX(node.position, 256)) {
    giveEditSlot(c, node.slot);
    removeNode(c, node);
  } else draw(c, node.position);
}

/** 0x08022464: down and up move the cursor and scroll the five rows, left and right change the category, B goes
 *  back to the menu, and A on a row opens its skills. */
function editChoosing(c, node) {
  const { repeated, pressed } = c.keys, { cursor } = node;
  const { first, count } = editCategory(c);
  if (repeated & KEY.DOWN) {
    if (cursor.row <= 2) cursor.row++;
    else if (cursor.page + 5 >= count) {
      if (cursor.row <= 3) cursor.row++;
      else return;
    } else {
      const going = node.rows[0];
      for (let i = 0; i < 4; i++) {
        node.rows[i] = node.rows[i + 1];
        node.rows[i].row = i;
      }
      node.rows[4] = going;
      going.row = 4;
      going.position.y = 160;
      cursor.page++;
      if (cursor.page >= count) cursor.page = 0;
      let index = cursor.page + 4;
      if (index >= count) index -= count;
      index += first;
      going.index = index;
      queueCopy(c, EDIT.TILES + going.slot * EDIT.PICTURE_BYTES, EDIT.PICTURES + index * EDIT.PICTURE_BYTES, EDIT.PICTURE_BYTES);
    }
  } else if (repeated & KEY.UP) {
    if (cursor.row > 1) cursor.row--;
    else if (cursor.page === 0) {
      if (cursor.row === 0) return;
      cursor.row--;
    } else {
      const going = node.rows[4];
      for (let i = 4; i > 0; i--) {
        node.rows[i] = node.rows[i - 1];
        node.rows[i].row = i;
      }
      node.rows[0] = going;
      going.row = 0;
      going.position.y = 0;
      cursor.page = (cursor.page === 0 ? count : cursor.page) - 1;
      const index = first + cursor.page;
      going.index = index;
      queueCopy(c, EDIT.TILES + going.slot * EDIT.PICTURE_BYTES, EDIT.PICTURES + index * EDIT.PICTURE_BYTES, EDIT.PICTURE_BYTES);
    }
  } else if (pressed & KEY.B) {
    removeNode(c, cursor);
    node.run = editLeave;
    c.sound?.play(EDIT.SOUND_ENTER);
    return;
  } else {
    return;
  }
  c.sound?.play(SOUND_MOVE);
}

/** 0x080227ec: the screen slides off to the right, and the menu behind it comes next, which isn't part of this piece. */
function editLeave(c, node) {
  c.menu.x = 256 - Math.trunc((256 - c.menu.x) / 2);
  queueRegister(c, 16, (-c.menu.x) & 0x1FF);
  queueRegister(c, 20, (-c.menu.x) & 0x1FF);
  if (c.menu.x > 255) node.run = () => {};
}

/** 0x08021f04: the frame wrapper, the screen's own count of frames and then the list. */
function skillsFrame(c) {
  c.menu.frames++;
  frame(c);
}

/** 0x08021b0c: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures and maps,
 *  the list's first node, and the display queued on for the next V-blank. What it reads from the save is for the screens
 *  behind the first four choices, so it comes with them. */
export function skills(c) {
  const { video } = c;
  c.menu = {
    nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0, frames: 0,
    slots: 0, category: 0, x: 0,
  };
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  colours(c).fill(0);
  decompress(c, 0x0810A3BC, VRAM);
  decompress(c, 0x08109EA8, 0x06004000);
  decompress(c, 0x0807BC80, 0x06008000);
  decompress(c, 0x0810A27C, 0x0600D000);
  decompress(c, 0x0810B114, 0x0600D800);
  video.vram.fill(0, 0x0600E000 - VRAM, 0x06010000 - VRAM);
  decompress(c, 0x080BAE18, 0x06010000);
  decompress(c, 0x080BBD68, 0x06012C20);
  addNode(c, startFrame);
  addNode(c, fadeIn);
  c.sound?.play(SONG);
  queueRegister(c, DISPCNT, 0x1F40);
  c.callback = skillsFrame;
}
