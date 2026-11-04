// The main menu, after the title screen (the decompilation's src/unknown_08039dd8.cpp: the initializer 0x08039e20,
// its frame wrapper 0x08039fd0 and the handlers 0x08039fe0, 0x0803a3b8, 0x0803a428, 0x0803a0f8, 0x0803a478 and
// 0x0803a260, with the arrows' 0x08028238, 0x08028270, 0x08028388, 0x080283c0, 0x08027fb8 and 0x08028038). It shows
// the mode select: a background of layers, the preview of each mode's picture fading in over them, the animated
// picture, and the two arrows that move the choice.
//
// The original runs this screen as a list of nodes, each a callback called once a frame in the list's order
// (0x0801f7d0 adds one at the end, 0x0801f89c walks them), and a node added on the way runs in that same frame.
//
// The name entry between the title screen and this one isn't ported: the title's Start hands over here, the way the
// original goes for a player with a saved name, which is the way the recording that proves this part goes.

import { KEY, colours, decompress, copyTileBlock, fadeToward, fadeToBlack, hideSpriteBuffer, queueCopy, queueRegister } from './core.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000, SINE = 0x0804DF7C;

// the cartridge's table of the display registers the initializer writes, and how many
const REGISTERS = 0x0815F02C, REGISTER_COUNT = 16;
const DISPCNT = 0x00, BG3VOFS = 0x1E, BLDCNT = 0x50, BLDALPHA = 0x52;

// the language the save keeps (gUnknown_03002110[119]), which picks the pictures: English in the USA copy
const LANGUAGE = 1;
// gUnknown_08edd314 and gUnknown_08edd32c: the sprites' tiles and the previews' pictures, by language
const SPRITE_PICTURES = [0x0815FAFC, 0x08160244, 0x08160244, 0x08160244, 0x08160244, 0x08160244];
const PREVIEW_PICTURES = [0x081609E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4];
const PREVIEW_PALETTES = 0x0816E9E4;

// the palette each of the four fades steps toward, and where it is
const FADES = [
  [PALETTE, 0x0815F7F8], [0x050001C0, 0x0815E67C], [0x050001E0, 0x081326F4], [0x05000200, 0x081609C4],
];

// the animated picture: eight frames of 12 by 17 entries from 0x0815e69c
const ANIMATION = 0x0815E69C, ANIMATION_WORDS = 12 * 17;
// the sprites' parts, each eight bytes: the main sprite's and the arrows'
const PARTS = 0x0816EACC, PARTS_ARROWS = 0x0816EAC4;

const SONG = 1, SOUND_MOVE = 401, SOUND_MADE = 404;
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
const SONG_TABLE = 0x08BF7244;
// how many frames of the song's fade make a step: 0x0801f718(1, 120) keeps 120 >> 4
const SONG_FADE_STEP = 120 >> 4;
const CHOICES = 7;

/** A sprite's place (the first 16 bytes of a node's allocation): the parts it's made of, where, and what they add. */
const place = (parts, x, y, tile, attr2 = 0) => ({ parts, x, y, tile, attr0: 0, attr1: 0, attr2, state: 0 });

/** 0x0801f7d0: a node added at the end of the list. */
function addNode(c, run, position = null, extra = {}) {
  const node = { run, position, ...extra };
  c.menu.nodes.push(node);
  return node;
}

/** 0x0801fed8: a sprite asks to be drawn this frame. */
function draw(c, position) {
  c.menu.drawn[(position.attr2 & 0x0C) >> 2].push(position);
}

/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
function startFrame(c) {
  c.menu.drawn = [[], [], [], []];
  c.menu.matrices = 0;
}

/** 0x08030d20: the scrolling layer, a line every other frame. */
function scroll(c, node) {
  node.count = (node.count - 1) | 0;
  queueRegister(c, BG3VOFS, (node.count & 0x1FE) >> 1);
}

/** 0x08039dd8: the animated picture's block of the map, a new picture of the eight every four frames. */
function animate(c, node) {
  node.timer++;
  if (node.timer > 23) node.timer = 0;
  copyTileBlock(c, node.to, ANIMATION + ((node.timer >> 2) & 7) * ANIMATION_WORDS * 2, 12, 17, node.tile);
}

/** 0x0801f9d8: a sprite that only asks to be drawn. */
function drawOnly(c, node) {
  draw(c, node.position);
}

/** 0x08039fe0: the four palettes fade in, and once they have, the arrows come and the choice's preview loads. */
function fadeIn(c, node) {
  const arrived = FADES.map(([first, from]) => fadeToward(c, first, from, 16));
  if (!arrived.every(Boolean)) return;
  node.left = addNode(c, arrowStart, place(PARTS_ARROWS, 0, 0, 0, 4), { baseX: 64, baseY: 146 });
  node.right = addNode(c, arrowStart, place(PARTS_ARROWS, 0, 0, 64, 4), { baseX: 176, baseY: 118 });
  c.menu.selection = c.menuChoice;
  node.run = loadPreview;
}

/** 0x0803a3b8: the choice's picture and palette, copied after the next V-blank, and the blend that shows them. */
function loadPreview(c, node) {
  queueCopy(c, 0x06007000, PREVIEW_PICTURES[LANGUAGE] + (c.menu.selection << 12), 0x1000);
  queueCopy(c, 0x050001A0, PREVIEW_PALETTES + (c.menu.selection << 5), 0x20);
  queueRegister(c, BLDCNT, 0x3F41);
  queueRegister(c, BLDALPHA, 0x1000);
  node.run = previewIn;
}

const previewBlend = state => (0x1000 - (state << 8)) | state;

/** 0x0803a428: the preview fades in, a step a frame, and the choice can be moved from its first step on. */
function previewIn(c, node) {
  const position = node.position;
  position.state++;
  if (position.state <= 15) queueRegister(c, BLDALPHA, previewBlend(position.state));
  else {
    position.state = 16;
    queueRegister(c, BLDALPHA, 16);
    node.run = choosing;
  }
  choosing(c, node);
}

/** 0x0803a0f8: A chooses, and left and right move the choice round the seven, the arrow they go past sliding. */
function choosing(c, node) {
  const pressed = c.keys.pressed;
  if (pressed & KEY.A) {
    c.menuChoice = c.menu.selection;
    node.run = leaving;
    c.sound?.fadeOut(c.rom.bytes[SONG_TABLE - CARTRIDGE + SONG * 8 + 4], SONG_FADE_STEP);
    c.sound?.play(SOUND_MADE);
  } else if (pressed & KEY.LEFT) {
    c.menu.selection = (c.menu.selection + CHOICES - 1) % CHOICES;
    node.run = previewOut;
    node.left.run = arrowSlideLeft;
    node.left.position.state = 0;
    c.sound?.play(SOUND_MOVE);
  } else if (pressed & KEY.RIGHT) {
    c.menu.selection = (c.menu.selection + 1) % CHOICES;
    node.run = previewOut;
    node.right.run = arrowSlideRight;
    node.right.position.state = 0;
    c.sound?.play(SOUND_MOVE);
  }
}

/** 0x0803a478: the preview fades out, and then the new one loads. */
function previewOut(c, node) {
  const position = node.position;
  if (position.state) {
    position.state--;
    queueRegister(c, BLDALPHA, previewBlend(position.state));
  } else {
    queueRegister(c, BLDALPHA, 0x1000);
    node.run = loadPreview;
  }
}

/** 0x0803a260: every colour fades to black, and then the chosen mode's screen starts; none is ported, so it stops. */
function leaving(c, node) {
  if (fadeToBlack(c, PALETTE, 512)) node.run = () => {};
}

/** 0x08028238 and 0x08028270: an arrow takes its place, and draws from the next frame on. */
function arrowStart(c, node) {
  arrowSettle(node);
  node.run = arrowSettled;
}

function arrowSettle(node) {
  const { position } = node;
  position.x = node.baseX - 32;
  position.y = node.baseY - 32;
  position.attr0 = 0;
  position.attr1 = 0;
}

/** 0x08028388 and 0x080283c0: an arrow at rest. */
function arrowSettled(c, node) {
  arrowSettle(node);
  draw(c, node.position);
  node.position.state = (node.position.state + 4) & 0xFF;
}

/**
 * 0x0801fd18, with no turn: a sprite matrix that scales by 256 over `scale`, and its number. It writes where the
 * original does, whose matrix after the first lands two bytes along from the one before and not in its own sprites'.
 */
function takeMatrix(c, scale) {
  const number = c.menu.matrices;
  if (number > 31) return 0xFF;
  const cosine = Math.trunc((c.rom.s16(SINE - CARTRIDGE + 0x800 * 2) << 3) / scale);
  const sine = Math.trunc((c.rom.s16(SINE - CARTRIDGE) << 3) / scale);
  const out = c.oamBuffer;
  out[number + 3] = cosine;
  out[number + 7] = sine;
  out[number + 11] = -sine;
  out[number + 15] = cosine;
  c.menu.matrices++;
  return number;
}

/** 0x08027fb8 and 0x08028038's shared steps: the arrow grows for four frames and shrinks back in steps of three. */
function arrowSlide(c, node, settled, xOf) {
  const { position } = node;
  let value;
  if (position.state > 15) {
    node.run = settled;
    value = 0;
  } else if (position.state > 3) value = 4 - Math.trunc((position.state - 4) / 3);
  else value = position.state;
  position.x = xOf(value);
  position.y = node.baseY - 64;
  position.attr0 = 3;
  position.attr1 = takeMatrix(c, value * 16 + 256) * 2;
  draw(c, position);
  position.state = (position.state + 1) & 0xFF;
}

function arrowSlideLeft(c, node) { arrowSlide(c, node, arrowSettled, value => node.baseX - (value + 64)); }
function arrowSlideRight(c, node) { arrowSlide(c, node, arrowSettled, value => node.baseX + (value - 64)); }

/** 0x0801fda0: the sprites that asked, highest priority first and the newest first within one, into the buffer, with
 *  every sprite after them hidden, for the next V-blank to copy. */
function drawSprites(c) {
  const out = c.oamBuffer, s8 = v => (v << 24) >> 24;
  let count = 0;
  for (const group of c.menu.drawn) {
    for (let i = group.length - 1; i >= 0; i--) {
      const position = group[i];
      for (let p = position.parts - CARTRIDGE; count < 128; p += 8) {
        const bytes = c.rom.bytes;
        out[count * 4] = (((bytes[p + 2] + position.attr0) << 8) | ((s8(bytes[p + 6]) + position.y) & 0xFF)) & 0xFFFF;
        out[count * 4 + 1] = (((bytes[p + 3] + position.attr1) << 8) | ((s8(bytes[p + 5]) + position.x) & 0x1FF)) & 0xFFFF;
        out[count * 4 + 2] = (((bytes[p + 4] + position.attr2) << 8) | (position.tile + c.rom.u16(p))) & 0xFFFF;
        count++;
        if (!bytes[p + 7]) break;
      }
    }
  }
  for (; count < 128; count++) out[count * 4] = 0x200;
  c.oamBufferFull = 1;
}

/** 0x08039fd0: the frame wrapper. Every node, a node added on the way too, and then the sprites they asked for. */
function frame(c) {
  const { nodes } = c.menu;
  for (let i = 0; i < nodes.length; i++) nodes[i].run(c, nodes[i]);
  drawSprites(c);
}

/** What the original takes before the menu's first frame: the name entry's frame, going straight on with a saved name,
 *  and 0x08039e20's decompressing, which runs past a V-blank. None of it shows, as the screen is black; only how long
 *  it takes does. */
const FRAMES_BEFORE = 2;

/** 0x0801fbfc: display registers from the cartridge's table at `from`, each its offset in 0x04000000 and its value. */
function writeRegisters(c, from, count) {
  const at = from - CARTRIDGE;
  for (let i = 0; i < count; i++) c.video.write(c.rom.u16(at + i * 4), c.rom.u16(at + i * 4 + 2));
}

/** The title screen's Start hands over here, and the menu starts when that time is up. */
export function beforeMenu(c) {
  c.menuWait = (c.menuWait ?? 0) + 1;
  if (c.menuWait > FRAMES_BEFORE) {
    c.menuWait = 0;
    menu(c);
  }
}

/**
 * 0x08039e20: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures and maps,
 * the list's nodes, and the display queued on for the next V-blank.
 */
function menu(c) {
  const { video } = c;
  c.menu = { nodes: [], drawn: [[], [], [], []], matrices: 0, selection: 0 };
  writeRegisters(c, REGISTERS, REGISTER_COUNT);
  c.queue.length = 0;              // 0x0801fb94
  hideSpriteBuffer(c);             // 0x0801ff30
  colours(c).fill(0);
  decompress(c, 0x0815F06C, VRAM);
  decompress(c, 0x0815C4B4, 0x06008000);
  decompress(c, 0x08132544, 0x0600D240);
  decompress(c, SPRITE_PICTURES[LANGUAGE], 0x06010000);
  video.vram.fill(0, 0x0600F800 - VRAM, 0x0600F800 - VRAM + 0x800);
  copyTileBlock(c, 0x0600FA06, 0x0816EAEC, 16, 8, 0xD380);
  video.vram.fill(0, 0x0600F000 - VRAM, 0x0600F000 - VRAM + 0x800);
  decompress(c, 0x0815F818, 0x0600E800);
  let to = 0x0600E000;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      copyTileBlock(c, to, 0x081327D4, 8, 8, 0xF292);
      to += 0x10;
    }
    to += 0x1C0;
  }
  addNode(c, startFrame);
  addNode(c, scroll, null, { count: 0 });
  addNode(c, animate, null, { to: 0x0600F0A6, tile: 0xE000, timer: 0 });
  addNode(c, drawOnly, place(PARTS, 64, 32, 128));
  addNode(c, fadeIn, place(0, 0, 0, 0));
  c.sound?.play(SONG);
  c.callback = displayOn;
}

/** 0x08039e20's last step, a frame behind its song: it runs past a V-blank, and the display is queued for the next. */
function displayOn(c) {
  queueRegister(c, DISPCNT, 0x1F40);
  c.callback = frame;
}
