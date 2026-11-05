// The intro, which comes after the SEGA and Sonic Team logos (opening.c): the five characters coming across a white screen,
// each with their name, Eggman and the emerald, and the game's logo, until the title screen. The addresses named here are
// those of the USA copy, as `npm run dp -- read` prints them; the decompilation's labels are 0x388 past them for code and
// 0x38C for the tables.
//
// Nothing here needs `dreamportsProof.neverInPlay`: the intro takes no character from a start point, and all it plays is
// the same from power-on.

import { createSprite, updateSprite, displaySprite } from './sprite.js';
import { drawBackground } from './background.js';
import { KEY } from './core.js';
import { introFinale } from './finale.js';
import { leaveForTheTitle } from './title.js';

const OBJ_VRAM = 0x10000;
const s32 = v => v | 0;
const I = v => v >> 8;

// the tables the characters' pictures come from, by their ROM offsets: the order the characters come in, how many pictures
// each pose has and where they are listed (two poses of six lists each, one for each character and one for Cheese), the
// name tags, and the picture that a locked character is greyed to
const DISPLAY_ORDER = 0xD8B8C, PICTURES_A = 0xD90A6, PICTURES_B = 0xD90AC, LISTS_A = 0xD9048, LISTS_B = 0xD9060;
const EGGMAN = 0xD95F4, NAME_TAGS = 0xD961C, GREY = 0xD90BC, GREY_PALETTE = 0xD90DC, UNLOCKED_MASKS = 0xD90E1;
const CREAM = 1, CHEESE = 5;
// the characters' poses, as the character select names them by number: coming in, stopping, and going off
const COMING_IN = 0x19, STOPPED = 0x1B, GOING = 0x1D;

// a name tag's or a character's picture from its list's entry: its animation, its variant and how many tiles it takes
const entry = (rom, list, i) => ({ anim: rom.u16(list + i * 8), variant: rom.u8(list + i * 8 + 2), numTiles: rom.u32(list + i * 8 + 4) });
const sprite = (c, e, tiles, x, y, oamFlags) => createSprite({ tiles, anim: e.anim, variant: e.variant, prevVariant: 0xFF, x, y, oamFlags });

/** 0x080A3B90, CreateOpeningStrc94_B: the characters' name tags, one after the other. */
export function openingCharacters(c) {
  c.dispCnt = 0x1040;
  const s = {
    c, windowBottom: 0x5000, windowTop: 0, tagX: 0x12C00, tagY: 0x5000, x: -0x7800, y: 0x5000,
    speed: 4, direction: 1, tagIndex: 0, pose: COMING_IN, started: false, count: 0, tag: null,
  };
  tag(s);
  c.bgPalette[0] = 0x7FFF;
  c.flags |= 0x1;
  c.mapFill[0].value = 0;
  c.mapFill[0].rect.set([0, 0, 0xFF, 0x40]);
  c.winRegs[2] = windowRows(s);
  c.createTask(opening, s, 0x100);
}

// 0x080A3C54: the tag's sprite, and the layer behind it
function tag(s) {
  const { c } = s, e = entry(c.rom, NAME_TAGS, s.tagIndex);
  s.charactersAt = OBJ_VRAM + 0x680;
  s.tag = sprite(c, e, OBJ_VRAM, I(s.tagX), I(s.tagY), 0x280);
  updateSprite(c, s.tag);
  c.dispCnt |= 0x100;
  c.bgCnt[0] = 0x5888;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0x6E;
  drawBackground(c, { id: 303, dest: 0x8000, layoutVram: 0xC000, targetTilesX: 32, targetTilesY: 32, flags: 4 });
}

// WIN0V: the window's bottom row twice over, for the first, and its top row added to it, as the original writes it
const windowRows = s => I(s.windowBottom) * 0x101 + I(s.windowTop);

// 0x080A4210: the tag shown where it is
function showTag(s) {
  s.tag.x = I(s.tagX);
  s.tag.y = I(s.tagY);
  displaySprite(s.c, s.tag);
}

// 0x080A3D18: the window opening, with the screen black but for it
function opening(t) {
  const s = t.data, { c } = s;
  let done = 0;
  if (!s.started) {
    c.bldCnt = 0x3FFF;
    c.dispCnt |= 0x6000;
    c.winRegs[0] = 0xFF;
    c.winRegs[1] = 0xFF;
    c.winRegs[3] = 0xFF;
    c.winRegs[4] = 0x1011;
    c.winRegs[5] = 0;
    c.bldY = 0x10;
    s.started = true;
    createCharacters(s);
  }
  if (s.windowBottom >= 0x4000) {
    s.windowBottom -= 0x100;
    if (s.windowBottom <= 0x4000) {
      s.windowBottom = 0x4000;
      done = 1;
    }
  }
  if (s.windowTop <= 0x2000) {
    s.windowTop += 0x200;
    if (s.windowTop >= 0x2000) {
      s.windowTop = 0x2000;
      done++;
    }
  }
  c.winRegs[2] = windowRows(s);
  if (done !== 2) return;
  c.bldCnt = 0x3FFF;
  c.winRegs[4] = 0x1011;
  c.bldAlpha = 0;
  c.bldY = 0x10;
  s.started = false;
  t.main = comingIn;
}

// Start leaves for the title, with the character's task as well as the tag's, which would go on drawing them
function skipped(t) {
  const s = t.data, { c } = s;
  if (!(c.pressed & KEY.START)) return false;
  if (c.tasks.includes(s.characterTask)) c.destroyTask(s.characterTask);
  c.destroyTask(t);
  leaveForTheTitle(c);
  return true;
}

// 0x080A3E24: a tag coming in, with its character on the move once it has begun
function comingIn(t) {
  const s = t.data, { c } = s;
  showTag(s);
  c.winRegs[2] = windowRows(s);
  moveIn(s);
  if (s.count > 0x2C) {
    s.count = 0;
    t.main = stopping;
    return;
  }
  if (skipped(t)) return;
  s.count++;
}

// 0x080A3EA0
function stopping(t) {
  const s = t.data, { c } = s;
  showTag(s);
  if (tagStops(s)) s.pose = STOPPED;
  moveAcross(s);
  if (s.count > 0x77) {
    s.count = 0;
    t.main = next;
    return;
  }
  if (skipped(t)) return;
  s.count++;
}

// 0x080A3F14: the character leaves and the next one's tag begins from the side the last one went to
function next(t) {
  const s = t.data, { c } = s;
  s.x = 0x13600;
  s.pose = GOING;
  if (++s.tagIndex > 4) {
    s.count = 0;
    c.bldCnt = 0xA0;
    c.winRegs[4] = 0x3000;
    c.winRegs[5] = 0;
    c.bldY = 0x10;
    c.bgPalette[0] = 0;
    c.flags |= 0x1;
    t.main = goneDark;
    return;
  }
  s.pose = COMING_IN;
  s.direction = s.direction > 0 ? -1 : 1;
  if (s.direction > 0) {
    s.x = -0x7800;
    s.tagX = 0x12C00;
  } else {
    s.x = 0x16800;
    s.tagX = -0x3C00;
  }
  const e = entry(c.rom, NAME_TAGS, s.tagIndex);
  s.tag.anim = e.anim;
  s.tag.variant = e.variant;
  s.tag.prevVariant = 0xFF;
  updateSprite(c, s.tag);
  t.main = comingIn;
}

// 0x080A3FFC: the screen dark for a few frames, then on to Eggman
function goneDark(t) {
  const s = t.data, { c } = s;
  c.bldCnt = 0xA0;
  c.winRegs[4] = 0x3000;
  c.winRegs[5] = 0;
  c.bldY = 0x10;
  // the palette itself, which the original writes to directly
  c.video.pal[0] = 0;
  c.video.pal[1] = 0;
  if (s.count > 2) {
    c.destroyTask(t);
    eggmanScene(c);
    return;
  }
  s.count++;
}

// 0x080A4058: the character moving in once the tag has been there a little
function moveIn(s) {
  if (s.count <= 0xE) return false;
  if (s.direction > 0) {
    if (s.x <= 0x9600) {
      s.x += s.speed << 9;
      if (s.x >= 0x9600) {
        s.x = 0x9600;
        return true;
      }
    }
  } else if (s.x >= 0x5A00) {
    s.x -= s.speed << 9;
    if (s.x <= 0x5A00) {
      s.x = 0x5A00;
      return true;
    }
  }
  return false;
}

// 0x080A40B8: the character moving across on the way out of the screen's middle
function moveAcross(s) {
  if (s.direction > 0) {
    if (s.x <= 0xF000) {
      s.x += s.speed << 5;
      if (s.x >= 0xF000) {
        s.x = 0xF000;
        return true;
      }
    }
  } else if (s.x >= 0x100) {
    s.x -= s.speed << 5;
    if (s.x <= 0x100) {
      s.x = 0x100;
      return true;
    }
  }
  return false;
}

// 0x080A41B4: the tag moving to where it stops
function tagStops(s) {
  if (s.direction > 0) {
    if (s.tagX >= 0xA00) {
      s.tagX -= s.speed << 11;
      if (s.tagX <= 0xA00) {
        s.tagX = 0xA00;
        return true;
      }
    }
  } else if (s.tagX <= 0xE600) {
    s.tagX += s.speed << 11;
    if (s.tagX >= 0xE600) {
      s.tagX = 0xE600;
      return true;
    }
  }
  return false;
}

// 0x0809BBB4, CreateSomeTask_809BF3C: the character, with its pictures' tiles after the tag's
function createCharacters(s) {
  const { c } = s;
  s.vram = s.charactersAt;
  s.stopped = false;
  s.groups = [[], []];
  loadCharacters(s);
  s.characterTask = c.createTask(characterTask, s, 0xFF);
}

// a pose's lists: how many pictures each character has and where they are, of the character coming in or the one stopped
const picturesOf = (rom, stopped, character) => {
  const counts = stopped ? PICTURES_B : PICTURES_A, lists = stopped ? LISTS_B : LISTS_A;
  return { count: rom.u8(counts + character), list: rom.u32(lists + character * 4) - 0x08000000 };
};

// 0x0809B3E8, LoadCharacterSelectSprites: the character's pictures, then Cheese's, in tiles one after the other
function loadCharacters(s) {
  const { c } = s, { rom } = c, character = rom.u8(DISPLAY_ORDER + s.tagIndex);
  let tiles = s.vram;
  s.groups = [character, CHEESE].map(who => {
    const { count, list } = picturesOf(rom, s.pose > 0x15, who);
    return Array.from({ length: count }, (_, i) => {
      const e = entry(rom, list, i), picture = sprite(c, e, tiles, I(s.x), I(s.y), 0x40);
      tiles += e.numTiles * 32;
      updateSprite(c, picture);
      return picture;
    });
  });
  s.vram += 0xD40;
}

// 0x0809B540, Task_270_809B8C8: the character, until it has gone off the screen
function characterTask(t) {
  const s = t.data;
  showCharacter(s);
  if (s.x + 0x3C00 > 0x16800 && s.pose === GOING) s.c.destroyTask(t);
}

// 0x0809B6D0, sub_809BA58: the character's pictures where it is, each frame, with the list of its pose. The poses here are
// coming in, stopped and going; the character select's others aren't ported.
function showCharacter(s) {
  const { c } = s, { rom } = c, character = rom.u8(DISPLAY_ORDER + s.tagIndex);
  if (s.pose === STOPPED) s.stopped = true;
  else if (s.pose === COMING_IN) s.stopped = false;
  let tiles = s.groups[0][0].tiles;
  const draw = who => {
    const { count, list } = picturesOf(rom, s.stopped, who);
    for (let i = 0; i < count; i++) {
      const e = entry(rom, list, i), group = s.groups[who === CHEESE ? 1 : 0], picture = group[i] ??= createSprite({});
      Object.assign(picture, { tiles, anim: e.anim, variant: e.variant, prevVariant: 0xFF, x: I(s.x), y: I(s.y), oamFlags: character === 0 ? 0x40 : 0x80, animCursor: 0, qAnimDelay: 0, animSpeed: 0x10, palId: 0, frameFlags: 0 });
      tiles += e.numTiles * 32;
      updateSprite(c, picture);
      displaySprite(c, picture);
    }
  };
  draw(character);
  if (character === CREAM) draw(CHEESE);
  // a character who isn't unlocked yet is greyed, but not as it comes in and stops
  const locked = !(c.save.unlockedCharacters & rom.u8(UNLOCKED_MASKS + character)) && (s.pose < COMING_IN || s.pose > STOPPED);
  const grey = at => {
    for (let i = 0; i < 16; i++) c.objPalette[at * 16 + i] = rom.u16(GREY + i * 2);
    c.flags |= 0x2;
  };
  if (locked && character === CREAM) grey(5);
  if (locked) grey(rom.u8(GREY_PALETTE + character));
}

// 0x080A3010, CreateIntroEggmanCutscene: Eggman at his machine, behind a window that opens on a white screen
function eggmanScene(c) {
  c.dispCnt = 0x7140;
  const e = {
    c, window: 0x4000, windowTop: 0x2000, scrollY: s32(0xFFFF9C00), fade: 0, count: 0, started: false,
    x: 0xE600, y: 0x8200, handX: 0xB400, handY: 0xA000,
  };
  c.video.vram.fill(0, ((c.bgCnt[0] >> 2) & 3) << 14, (((c.bgCnt[0] >> 2) & 3) << 14) + 0x40);
  for (const bg of [1, 2]) {
    c.mapFill[bg].value = 0;
    c.mapFill[bg].rect.set([0, 0, 0xFF, 0x40]);
  }
  eggmanLayers(c);
  c.winRegs[2] = eggmanRows(e);
  c.bgPalette[0] = 0x7FFF;
  c.flags |= 0x1;
  c.createTask(eggmanOpening, e, 0x100);
}

const eggmanRows = e => I(e.window) * 0x101 + I(e.windowTop);

// 0x080A3354: the machine's layer in front of the room's
function eggmanLayers(c) {
  c.dispCnt |= 0x400;
  c.bgCnt[2] = 0x5888;
  c.bgScroll[4] = 0;
  c.bgScroll[5] = 0xFF9C;
  drawBackground(c, { id: 300, dest: 0x8000, layoutVram: 0xC000, targetTilesX: 32, targetTilesY: 32, flags: 4 | 2 });
  c.dispCnt |= 0x200;
  c.bgCnt[1] = 0x681;
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0;
  drawBackground(c, { id: 299, dest: 0, layoutVram: 0x3000, targetTilesX: 32, targetTilesY: 32, flags: 4 | 1 });
}

// 0x080A3228: Eggman, then the two pictures of his hand and the two of the button, with their tiles one after the other
function eggmanSprites(e) {
  const { c } = e, { rom } = c;
  let tiles = OBJ_VRAM;
  const make = (i, x, y, oamFlags) => {
    const t = entry(rom, EGGMAN, i), picture = sprite(c, t, tiles, I(x), I(y), oamFlags);
    tiles += t.numTiles * 32;
    updateSprite(c, picture);
    return picture;
  };
  e.eggman = make(0, e.x, e.y, 0);
  e.hand = [1, 2].map(i => make(i, e.handX, e.handY, 0x40));
  e.button = [3, 4].map(i => make(i, e.handX, e.handY, 0x40));
}

const eggmanWindow = e => { e.c.winRegs[2] = eggmanRows(e); };
const eggmanScroll = e => { e.c.bgScroll[4] = I(e.scrollX ?? 0); e.c.bgScroll[5] = I(e.scrollY); };

// the keys Start leaves with, in all the scene's tasks
function eggmanSkipped(t) {
  const { c } = t.data;
  if (!(c.pressed & KEY.START)) return false;
  c.destroyTask(t);
  leaveForTheTitle(c);
  return true;
}

// 0x080A3444: the window opening up and the white fading away
function eggmanOpening(t) {
  const e = t.data, { c } = e;
  let done = 0;
  if (!e.started) {
    c.bldCnt = 0xC2;
    c.dispCnt |= 0x6000;
    c.winRegs[0] = 0xFF;
    c.winRegs[1] = 0xFF;
    c.winRegs[3] = 0xFF;
    c.winRegs[4] = 0x1137;
    c.winRegs[5] = 0;
    c.bldY = 0x10;
    e.fade = 0x1000;
    e.started = true;
    eggmanSprites(e);
    c.dispCnt &= 0xFEFF;
  }
  if (e.window >= 0x3000) {
    e.window -= 0x100;
    if (e.window <= 0x3000) {
      e.window = 0x3000;
      done++;
    }
  }
  if (e.windowTop <= 0x4000) {
    e.windowTop += 0x200;
    if (e.windowTop >= 0x4000) {
      e.windowTop = 0x4000;
      done++;
    }
  }
  if (c.bldY !== 0) {
    c.bldY = (e.fade & 0xFFFF) >> 8;
    e.fade = (e.fade - 0x100) & 0xFFFF;
  } else {
    done++;
  }
  eggmanWindow(e);
  if (done !== 3) return;
  c.bldCnt = 0xF0;
  c.winRegs[4] = 0x3017;
  c.bldAlpha = 0x1F;
  c.bldY = 0;
  e.started = false;
  e.fade = 0;
  t.main = eggmanAppears;
}

// 0x080A3564: the machine's layer coming down while the scene fades in
function eggmanAppears(t) {
  const e = t.data, { c } = e;
  if (e.scrollY < 0) {
    e.scrollY += 1 << 8;
    if (e.scrollY >= 0) e.scrollY = 0;
  }
  if (c.bldY < 0x10) {
    e.fade += 0x80;
    c.bldY = I(e.fade);
  } else {
    c.bgPalette[0] = 0;
    c.flags |= 0x1;
  }
  e.count++;
  if (e.count > 150) {
    e.fade = 0x1000;
    e.count = 0;
    c.bldCnt = 0xD0;
    c.winRegs[4] = 0x3017;
    c.bldAlpha = 0x1F;
    c.bldY = 0x10;
    c.bgPalette[0] = 0;
    c.flags |= 0x1;
    t.main = eggmanFades;
    return;
  }
  eggmanWindow(e);
  eggmanScroll(e);
  eggmanSkipped(t);
}

// 0x080A3E90: Eggman himself, where he is
function showEggman(e) {
  e.eggman.x = I(e.x);
  e.eggman.y = I(e.y);
  displaySprite(e.c, e.eggman);
}

// 0x080A3664: the scene darkening again with Eggman shown
function eggmanFades(t) {
  const e = t.data, { c } = e;
  showEggman(e);
  if (c.bldY === 0) {
    e.count++;
    if (e.count > 60) {
      e.count = 0;
      e.fade = 0;
      t.main = eggmanBrightens;
      return;
    }
  } else {
    e.fade = (e.fade - 0x100) & 0xFFFF;
    c.bldY = I(e.fade);
  }
  eggmanWindow(e);
  eggmanScroll(e);
  eggmanSkipped(t);
}

// 0x080A3710
function eggmanBrightens(t) {
  const e = t.data, { c } = e;
  showEggman(e);
  if (c.bldY >= 0x10) {
    c.bldY = 0x10;
    c.winRegs[4] = 0x2017;
    e.count = 0;
    t.main = eggmanReaches;
    return;
  }
  e.fade += 0x100;
  c.bldY = I(e.fade);
  eggmanWindow(e);
  eggmanScroll(e);
  eggmanSkipped(t);
}

// 0x080A37B8: his hand and the button coming up
function eggmanReaches(t) {
  const e = t.data;
  for (const picture of e.hand) {
    picture.x = I(e.handX);
    picture.y = I(e.handY);
    displaySprite(e.c, picture);
  }
  if (e.handY >= 0x7000) {
    e.handY -= 0x80;
    e.handY -= 1 << 7;
    if (e.handY <= 0x7000) {
      e.handY = 0x7000;
      if (++e.count > 60) {
        e.count = 0;
        t.main = eggmanPresses;
        return;
      }
    }
  }
  eggmanWindow(e);
  eggmanScroll(e);
  eggmanSkipped(t);
}

// 0x080A3844: the button, until it has been pressed
function eggmanPresses(t) {
  const e = t.data;
  for (const picture of e.button) {
    picture.x = I(e.handX);
    picture.y = I(e.handY);
    displaySprite(e.c, picture);
  }
  if (e.count > 0x13) {
    e.c.destroyTask(t);
    emeraldScene(e.c);
    return;
  }
  e.count++;
  eggmanWindow(e);
  eggmanScroll(e);
  eggmanSkipped(t);
}

// the window the last scenes share, opened to rows 0x30 to 0x40
const windowOf = w => I(w.bottom) * 0x101 + I(w.top);

// clears the first tiles of the characters' layer and the maps of the layers the scene draws, as each scene begins
function clearLayers(c) {
  c.video.vram.fill(0, ((c.bgCnt[0] >> 2) & 3) << 14, (((c.bgCnt[0] >> 2) & 3) << 14) + 0x40);
  for (const bg of [1, 2]) {
    c.mapFill[bg].value = 0;
    c.mapFill[bg].rect.set([0, 0, 0xFF, 0x40]);
  }
}

// 0x080A3830, CreateOpeningStrc94_A: the room darkened, then the emerald's layer in front of it
function emeraldScene(c) {
  c.dispCnt = 0x1040;
  const w = { c, bottom: 0x3000, top: 0x4000, count: 0, started: false, fade: 0 };
  clearLayers(c);
  c.dispCnt |= 0x200;
  c.bgCnt[1] = 0xD81;
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0;
  drawBackground(c, { id: 302, dest: 0, layoutVram: 0x6800, targetTilesX: 32, targetTilesY: 32, flags: 4 | 1 });
  c.bgPalette[0] = 0;
  c.flags |= 0x1;
  c.createTask(emeraldStarts, w, 0x100);
}

// 0x080A39FC
function emeraldStarts(t) {
  const w = t.data, { c } = w;
  c.bldCnt = 0x3FFF;
  c.dispCnt |= 0x6000;
  c.winRegs[0] = 0xFF;
  c.winRegs[1] = 0xFF;
  c.winRegs[3] = 0xFF;
  c.winRegs[4] = 0x3117;
  c.winRegs[5] = 0;
  w.fade = 0x1000;
  w.started = true;
  c.winRegs[2] = windowOf(w);
  c.bldAlpha = 0x1F;
  c.bldY = 0x10;
  t.main = emeraldLayers;
}

// 0x080A3A7C: the second layer, a few frames later
function emeraldLayers(t) {
  const w = t.data, { c } = w;
  c.winRegs[2] = windowOf(w);
  w.count++;
  if (w.count === 4) c.dispCnt |= 0x400;
  if (w.count === 5) {
    c.bgCnt[2] = 0x5D88;
    c.bgScroll[4] = 0;
    c.bgScroll[5] = 0;
    drawBackground(c, { id: 304, dest: 0x8000, layoutVram: 0xE800, targetTilesX: 32, targetTilesY: 32, flags: 6 });
  }
  if (w.count > 0xA) {
    w.started = false;
    t.main = emeraldFades;
    return;
  }
  if (c.pressed & KEY.START) {
    c.destroyTask(t);
    leaveForTheTitle(c);
  }
}

// 0x080A3B64: the emerald's scene brightening into the next
function emeraldFades(t) {
  const w = t.data, { c } = w;
  c.winRegs[2] = windowOf(w);
  if (!w.started) {
    c.bldCnt = 0x3FBF;
    c.dispCnt |= 0x6000;
    c.winRegs[0] = 0xFF;
    c.winRegs[1] = 0xFF;
    c.winRegs[3] = 0xFF;
    c.winRegs[4] = 0x24;
    c.winRegs[5] = 0;
    w.fade = 0;
    w.started = true;
    c.bldY = 0;
  }
  if (c.bldY <= 0xE) {
    w.fade += 0x30;
    c.bldY = I(w.fade);
    return;
  }
  c.destroyTask(t);
  logoScene(c);
}

// 0x080A3C84, CreateOpeningStrc54: the logo's layer, the screen brightening onto it
function logoScene(c) {
  c.dispCnt = 0x7040;
  const w = { c, bottom: 0x3000, top: 0x4000, count: 0, fade: 0 };
  clearLayers(c);
  c.dispCnt |= 0x100;
  c.bgCnt[0] = 0x5888;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  drawBackground(c, { id: 303, dest: 0x8000, layoutVram: 0xC000, targetTilesX: 32, targetTilesY: 32, flags: 4 });
  c.bgPalette[0] = 0;
  c.flags |= 0x1;
  c.createTask(logoStarts, w, 0x100);
}

// 0x080A3D3C
function logoStarts(t) {
  const w = t.data, { c } = w;
  c.bldCnt = 0x3FBF;
  c.dispCnt |= 0x6000;
  c.winRegs[0] = 0xFF;
  c.winRegs[1] = 0xFF;
  c.winRegs[3] = 0xFF;
  c.winRegs[4] = 0x21;
  c.winRegs[5] = 0;
  c.bldY = 0;
  w.fade = 0;
  c.winRegs[2] = windowOf(w);
  t.main = logoFades;
}

// 0x080A3DAC
function logoFades(t) {
  const w = t.data, { c } = w;
  c.winRegs[2] = windowOf(w);
  if (c.bldY <= 0xE) {
    w.fade += 0x30;
    c.bldY = I(w.fade);
  } else {
    c.destroyTask(t);
    introFinale(c);
    return;
  }
  if (c.pressed & KEY.START) {
    c.destroyTask(t);
    leaveForTheTitle(c);
  }
}
