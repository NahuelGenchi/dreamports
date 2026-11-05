// Emerl's screen, which the story map opens with R, by way of the initializer 0x08021b0c. It shows Emerl and a menu of
// five: Edit skills, Change memory, Skill list, Exchange skills and Return to game. What the first four open isn't
// ported, so A does nothing on them yet, and neither is the story map that Return to game goes back to, so the screen
// stays black there. Nothing leads here yet either: `skills` in the address is a recording's start point.
//
// It's built from the same list of nodes as the main menu (menu.js).

import { KEY, colours, decompress, fadeToward, fadeToBlack, hideSpriteBuffer, queueCopy, queueRegister } from './core.js';
import { addNode, draw, frame, place, startFrame, writeRegisters } from './menu.js';

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
    queueCopy(c, CHOICE_TILES + i * CHOICE_BYTES, CHOICE_PICTURES + i * CHOICE_BYTES, CHOICE_BYTES);
    const choice = addNode(c, choiceStart, place(0, 0, 0, i * CHOICE_SLOT_TILES + CHOICE_FIRST_TILE), { row: i });
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
  c.menu = { nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0, frames: 0 };
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
