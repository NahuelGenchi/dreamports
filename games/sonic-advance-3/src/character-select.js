// The character select (CreateCharacterSelect, 0x08097F68 in the code map), which the main menu opens for a new story. The
// screen fades in on a header, the name of the character chosen turning behind it, with that character beside its name tag
// at the bottom. Left and Right slide the next character in, and A chooses one, who slides to the left while the partner's
// choice comes from the right. A on the partner shows the pair under a team description with both names, then a fade to
// white as the announcer says the pair's names.
// This is the story's, for one player. The multiplayer versions of this screen, the time attack's, B on the partner's
// choice and the screen's way out (the new story's opening, or the main menu on B) aren't ported yet, so the screen stops
// on its white fade.

import { KEY } from './core.js';
import { createSprite, updateSprite, displaySprite, SPRITE } from './sprite.js';
import { drawBackground } from './background.js';
import { SINE } from './stage/trig.js';
import { DISPLAY_ORDER, GREY, GREY_PALETTE, UNLOCKED_MASKS, CREAM, CHEESE, entry, picturesOf } from './intro.js';

const OBJ_VRAM = 0x10000;
const TILE_4BPP = 32;
const MUS_CHARACTER_SELECT = 3, SE_CHARSELECT_SLIDE = 0x67, SE_ABORT = 0x6B, VOICE_ANNOUNCER_AND = 0x1FF;

const s16 = v => (v << 16) >> 16;
const u8 = v => v & 0xFF;
const u16 = v => v & 0xFFFF;
const I = v => v >> 8;
const Q = v => Math.round(v * 256);

// the screen's tables in the ROM, by their offsets: the tilemaps' numbers, the header's and the team descriptions' pictures,
// the names (a row of seven for each of Japanese and the others), the name tags' backdrops, the arrow, where the pair's
// tags sit on the screen that follows, the announcer's voices and the characters' colours
const TILEMAPS = 0xD8950;
const HEADER = 0xD8974, TEAM_TEXT = 0xD897C, NAMES = 0xD8AF4, TAG_BACK = 0xD8B6C, TAG_BACK_PAIR = 0xD8B74, ARROW = 0xD8B7C;
const TAGS_JAPANESE = 0xD8B91, TAGS_OTHER = 0xD8C09;
const ANNOUNCER_FIRST = 0xD8C82, ANNOUNCER_SECOND = 0xD8C8C, VOICES = 0xD8C96;
const PALETTES = 0xE2EAD4, LOCKED_PALETTE = 0xE2EB74;
// the tilemaps' places in their table: the backdrop, the names that turn, the names as text, "OK" and "???"
const T_BACKDROP = 0, T_TURNING = 5, T_NAMES = 10, T_OK = 15, T_LOCKED = 16;
// the pictures of the pairs' poses: where each is listed, and how many each has
const TEAM_LISTS = 0xD9078, TEAM_COUNTS_SONIC = 0xD90B2, TEAM_COUNTS_OTHERS = 0xD90B5, TEAM_COUNTS_CREAM = 0xD90B8;
// WININ and WINOUT as the screen sets them each time it fades
const FADE_IN = 0x3FFF, FADE_OUT_AFTER = 0x3FBF;

/** 0x08097F68, CreateCharacterSelect: the screen's task, its layers and sprites, and its music. */
export function createCharacterSelect(c) {
  c.dispCnt = 0x1541;
  const cs = { c, language: c.save.language, players: [0, 0] };
  setUpPositions(cs);
  const at = ((c.bgCnt[2] >> 2) & 3) << 14;
  c.video.vram.fill(0, at, at + 0x40);
  clearMaps(c);
  c.createTask(init, cs, 0x100);
  setUpBackgrounds(cs);
  setUpSprites(cs);
  c.stopAllSongs();
  c.playSong(MUS_CHARACTER_SELECT);
  whiteOut(c);
  c.bldY = 0x10;
  return cs;
}

// the maps of layers 0 to 2 to be cleared
function clearMaps(c) {
  for (let bg = 0; bg < 3; bg++) {
    c.mapFill[bg].value = 0;
    c.mapFill[bg].rect.set([0, 0, 0xFF, 0x40]);
  }
}

// the window over the whole screen, and the blend that fades the picture to white
function whiteOut(c, blend = FADE_IN) {
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x3F;
  c.winRegs[5] |= 0x1F;
  c.bldCnt = blend;
}

// 0x08098024, SetupPositions: where everything starts, in 1/256ths of a pixel
function setUpPositions(cs) {
  Object.assign(cs, {
    unk2: 0, shown: 0, target: 0, listIndex: [0, 2], unkB: 0, unkE: 1, wait: 0, fade: 0, spin: 0, slide: 0, sideways: 0,
    titleScale: Q(16), teamTextX: Q(120), teamTextY: Q(17), headerX: Q(120), headerY: Q(17), scrollX: 0, scrollY: 0,
    nameX: Q(120), nameY: Q(85), backdropX: Q(201), backdropY: Q(22), charX: Q(120), charY: Q(80),
    chosenX: Q(120), chosenY: Q(80), tagPos: [{ x: Q(120), y: Q(145) }, { x: Q(300), y: Q(145) }],
    arrowX: 0, arrowY: 0, tiles: [null, null],
  });
  cs.c.bgAffine ??= { pa: 0x100, pb: 0, pc: 0, pd: 0x100, x: 0, y: 0 };
}

// a sprite set up from a table entry, as each of the functions below does it before its first UpdateSpriteAnimation
function setUp(c, s, e, tiles, x, y, oamFlags) {
  Object.assign(s, {
    tiles, anim: e.anim, variant: e.variant, prevVariant: 0xFF, x, y, oamFlags, animCursor: 0, qAnimDelay: 0, animSpeed: 0x10,
    palId: 0, frameFlags: 0,
  });
  updateSprite(c, s);
}

const nameEntry = (cs, who) => entry(cs.c.rom, NAMES, who + (cs.language === 0 ? 0 : 1) * 8);

// 0x08098220, InitSprites
function setUpSprites(cs) {
  const { c } = cs, { rom } = c;
  let vram = OBJ_VRAM;
  const next = tiles => { const at = vram; vram += tiles * TILE_4BPP; return at; };
  cs.header = createSprite({});
  setUp(c, cs.header, entry(rom, HEADER, 0), next(45), I(cs.headerX), I(cs.headerY), 0x40);
  cs.team = createSprite({});
  setUp(c, cs.team, entry(rom, TEAM_TEXT, cs.language * 8), next(50), I(cs.teamTextX), I(cs.teamTextY), 0);
  cs.and = createSprite({});
  setUp(c, cs.and, entry(rom, NAMES, 5), next(4), 120, I(cs.tagPos[0].y), 0);
  cs.arrow = createSprite({});
  setUp(c, cs.arrow, entry(rom, ARROW, 0), next(16), I(cs.arrowX), I(cs.arrowY), 0xFFC0);
  const who = rom.u8(DISPLAY_ORDER + cs.listIndex[0]);
  cs.name = createSprite({});
  setUp(c, cs.name, nameEntry(cs, who), next(14), I(cs.tagPos[0].x), I(cs.tagPos[0].y), 0);
  cs.partnerName = createSprite({});
  setUp(c, cs.partnerName, nameEntry(cs, who), next(14), I(cs.tagPos[1].x), I(cs.tagPos[1].y), 0);
  cs.tagBack = createSprite({});
  setUp(c, cs.tagBack, entry(rom, TAG_BACK, 0), next(24), I(cs.tagPos[0].x), I(cs.tagPos[0].y), 0x40);
  cs.tiles[0] = vram;
}

const tilemap = (c, i) => c.rom.u16(TILEMAPS + i * 2);

// 0x080985C0, InitBackgrounds: the backdrop, the name of the character as text and the same name turning
function setUpBackgrounds(cs) {
  const { c } = cs;
  c.bgCnt[0] = 0x4E07;
  c.bgScroll[0] = c.bgScroll[1] = 0;
  drawBackground(c, { id: tilemap(c, T_BACKDROP), dest: 0x4000, layoutVram: 0x7000, targetTilesX: 45, targetTilesY: 20, flags: 0 });
  c.bgCnt[1] = 0x30E;
  c.bgScroll[2] = c.bgScroll[3] = 0;
  drawBackground(c, { id: tilemap(c, T_NAMES + CREAM), dest: 0xC000, layoutVram: 0x1800, targetTilesX: 16, targetTilesY: 16, flags: 1 });
  c.bgCnt[2] = 0x1B89;
  c.bgScroll[4] = c.bgScroll[5] = 0;
  drawBackground(c, { id: tilemap(c, T_TURNING + cs.listIndex[0]), dest: 0x8000, layoutVram: 0xD800, targetTilesX: 16, targetTilesY: 16, flags: 6 });
}

// the layer for the name of a character, turning, or "???" if the character is not unlocked
function drawTurningName(cs, character) {
  const { c } = cs;
  drawBackground(c, {
    id: tilemap(c, isLocked(c, character) ? T_LOCKED : T_TURNING + character), dest: 0x8000, layoutVram: 0xD800,
    targetTilesX: 16, targetTilesY: 16, flags: 6,
  });
}

const isLocked = (c, character) => !(c.save.unlockedCharacters & c.rom.u8(UNLOCKED_MASKS + character));
const displayed = (c, listIndex) => c.rom.u8(DISPLAY_ORDER + listIndex);

// a character's colours (or the locked ones) into the sprites' palette at a place
function colour(c, at, character) {
  const from = isLocked(c, character) ? LOCKED_PALETTE : PALETTES + character * 32;
  for (let i = 0; i < 16; i++) c.objPalette[at + i] = c.rom.u16(from + i * 2);
  c.flags |= 0x2;
}

function init(t) {
  const cs = t.data;
  cs.tiles[1] = createCharacterTask(cs, { who: () => cs.shown, x: 'charX', y: 'charY' }, cs.tiles[0]);
  t.main = fadeIn;
}

// 0x0809B13C: the name behind turns
const turn = cs => { cs.spin = u16(cs.spin + 0xC0); };

// 0x0809B6C0: the turning name's layer, turned and scaled round the name's place
function transformBackground(cs) {
  const { c } = cs, angle = u16(cs.spin) >> 6, scaleX = s16(cs.titleScale) >> 4, scaleY = 0x100;
  const cx = (cs.nameX << 8) >> 16, cy = (cs.nameY << 8) >> 16;
  const cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  const kx = s16(Math.trunc(0x10000 / scaleX)), ky = s16(Math.trunc(0x10000 / scaleY));
  const a = c.bgAffine;
  a.pa = s16((cos * kx) >> 8);
  a.pb = s16((sin * kx) >> 8);
  a.pc = s16(((-SINE[angle] >> 6) * ky) >> 8);
  a.pd = s16((cos * ky) >> 8);
  a.x = (a.pa * s16(-cx) + a.pb * s16(-cy) + 0x40 * 256) | 0;
  a.y = (a.pc * s16(-cx) + a.pd * s16(-cy) + 0x40 * 256) | 0;
}

// 0x0809B69C: the backdrop's and the text name's scrolls
function scrollLayers(cs) {
  const { c } = cs;
  c.bgScroll[0] = I(cs.scrollX);
  c.bgScroll[1] = I(cs.scrollY);
  c.bgScroll[2] = I(cs.backdropX);
  c.bgScroll[3] = -I(cs.backdropY);
}

// 0x0809B094: the same, with the turning name's scroll
function scrollAllLayers(cs) {
  const { c } = cs;
  scrollLayers(cs);
  c.bgScroll[4] = I(cs.nameX);
  c.bgScroll[5] = -I(cs.nameY);
}

// 0x0809AD74: the two arrows at the sides, which move in and out
function showArrows(cs) {
  const s = cs.arrow, middle = cs.unkB > 13 ? 180 : 120;
  for (let i = 0; i < 2; i++) {
    s.x = i !== 0 ? -40 + middle - I(cs.slide) : 40 + middle + I(cs.slide);
    s.y = I(cs.arrowY);
    s.frameFlags = i !== 0 ? s.frameFlags | SPRITE.X_FLIP : s.frameFlags & ~SPRITE.X_FLIP;
    displaySprite(cs.c, s);
  }
}

// 0x0809B284: the arrows' movement
function moveArrows(cs) {
  cs.slide = cs.slide < Q(5) ? cs.slide + Q(0.25) : 0;
  cs.arrowY = Q(90);
}

// 0x0809ADF0: the header, drawn twice, mirrored, and the description under it
function showHeader(cs) {
  const { c } = cs, s = cs.header;
  for (let i = 0; i < 2; i++) {
    s.x = I(cs.headerX);
    s.y = I(cs.headerY);
    s.frameFlags = i !== 0 ? s.frameFlags & ~SPRITE.X_FLIP : s.frameFlags | SPRITE.X_FLIP;
    displaySprite(c, s);
  }
  cs.team.x = I(cs.teamTextX);
  cs.team.y = I(cs.teamTextY);
  displaySprite(c, cs.team);
}

// a name tag: its backdrop drawn twice, mirrored, and the name on it, "???" if the character isn't unlocked
function showTag(cs, which, name, palId) {
  const { c } = cs, back = cs.tagBack, pos = cs.tagPos[which];
  for (let i = 0; i < 2; i++) {
    back.x = I(pos.x);
    back.y = I(pos.y);
    back.palId = palId;
    back.frameFlags = i !== 0 ? back.frameFlags | SPRITE.X_FLIP : back.frameFlags & ~SPRITE.X_FLIP;
    displaySprite(c, back);
  }
  const character = displayed(c, cs.listIndex[which]);
  const e = nameEntry(cs, isLocked(c, character) ? 6 : character);
  name.anim = e.anim;
  name.variant = e.variant;
  name.x = I(pos.x);
  name.y = I(pos.y);
  updateSprite(c, name);
  displaySprite(c, name);
}

// 0x0809AE50 and 0x0809AF08: the name tag of the main character and the partner's
const showTagOfMain = cs => showTag(cs, 0, cs.name, 0);
const showTagOfPartner = cs => showTag(cs, 1, cs.partnerName, 1);

// 0x0809AFC0: the two tags together, with "and" between, as the pair's screen shows them
function showPair(cs) {
  const { c } = cs, { rom } = c, back = cs.tagBack;
  const row = (cs.listIndex[0] * 8 + cs.listIndex[1]) * 3 + (cs.language !== 0 ? TAGS_OTHER : TAGS_JAPANESE);
  for (let i = 0; i < 2; i++) {
    back.x = 120;
    back.y = I(cs.tagPos[0].y);
    back.frameFlags = i !== 0 ? back.frameFlags | SPRITE.X_FLIP : back.frameFlags & ~SPRITE.X_FLIP;
    displaySprite(c, back);
  }
  const place = (s, x, y) => { s.x = rom.u8(row + x); s.y = I(y); updateSprite(c, s); displaySprite(c, s); };
  place(cs.name, 0, cs.tagPos[0].y);
  place(cs.and, 1, cs.tagPos[0].y);
  place(cs.partnerName, 2, cs.tagPos[1].y);
}

// 0x0809B148: the character sliding to the middle, 1 once there
function slideInCharacter(cs) {
  if (cs.sideways === 0) {
    cs.charX -= Q(14);
    if (cs.charX <= Q(120)) { cs.charX = Q(120); return true; }
  } else {
    cs.charX += Q(14);
    if (cs.charX >= Q(120)) { cs.charX = Q(120); return true; }
  }
  return false;
}

// 0x0809B184 and 0x0809B1B4: the tags rising to their row
function raiseTag(cs, which) {
  const pos = cs.tagPos[which];
  if (pos.y <= Q(145)) { pos.y = Q(145); return true; }
  pos.y -= Q(6);
  if (pos.y < Q(145)) pos.y = Q(145);
  return false;
}

// 0x0809B1E4: the character sliding off, 1 once gone, and set at the far side to come in
function slideOutCharacter(cs) {
  if (cs.sideways === 0) {
    cs.charX -= Q(14);
    if (cs.charX <= -Q(90)) { cs.charX = Q(300); return true; }
  } else {
    cs.charX += Q(14);
    if (cs.charX >= Q(330)) { cs.charX = -Q(60); return true; }
  }
  return false;
}

// 0x0809B234 and 0x0809B25C: the tags sinking
function lowerTag(cs, which) {
  const pos = cs.tagPos[which];
  if (pos.y < Q(180)) { pos.y += Q(6); return false; }
  pos.y = Q(180);
  return true;
}

// 0x0809B2AC: the turning name sliding to the middle
function slideInName(cs) {
  if (cs.sideways === 0) {
    cs.nameX -= Q(14);
    if (cs.nameX <= Q(120)) cs.nameX = Q(120);
  } else {
    cs.nameX += Q(14);
    if (cs.nameX >= Q(120)) cs.nameX = Q(120);
  }
}

// 0x0809B2E4: the turning name sliding off, and set at the far side to come in
function slideOutName(cs) {
  if (cs.sideways === 0) {
    cs.nameX -= Q(14);
    if (cs.nameX <= -Q(90)) cs.nameX = Q(300);
  } else {
    cs.nameX += Q(14);
    if (cs.nameX >= Q(330)) cs.nameX = -Q(60);
  }
}

// 0x0809B32C: the partner's character, and the turning name, sliding in from the right to their places (to the side if
// `away`), 1 once there
function slidePartnerIn(cs, away) {
  if (away) {
    if (cs.charX >= Q(300)) { cs.charX = Q(300); return true; }
    cs.charX += Q(5) + Q(3.75);
    if (cs.charX > Q(300)) cs.charX = Q(300);
    cs.nameX += Q(8.25);
    if (cs.nameX > Q(300)) cs.nameX = Q(300);
  } else {
    if (cs.charX <= Q(180)) { cs.charX = Q(180); return true; }
    cs.charX -= Q(8.75);
    if (cs.charX < Q(180)) cs.charX = Q(180);
    cs.nameX -= Q(8.25);
    if (cs.nameX < Q(110)) cs.nameX = Q(110);
  }
  return false;
}

// 0x0809B3C4: the main character's tag moving along
function moveTag(cs) {
  const pos = cs.tagPos[0];
  if (pos.x > Q(60)) { pos.x -= Q(6.0625); return false; }
  pos.x = Q(60);
  return true;
}

// 0x0809B41C: the partner's tag following the partner
function followPartner(cs) {
  cs.tagPos[1].x = cs.charX;
}

// 0x0809AC44: the main character, after choosing, moving to the left
function moveChosen(cs) {
  let count = 0;
  if (I(cs.chosenX) > 60) {
    cs.chosenX -= Q(6);
    cs.backdropX += Q(6);
  } else {
    cs.chosenX = Q(60);
    cs.backdropX = Q(261);
    count++;
  }
  if (cs.scrollX < Q(120)) {
    cs.scrollX += Q(7.875);
    if (cs.scrollX > Q(120)) cs.scrollX = Q(120);
  } else {
    cs.scrollX = Q(120);
    count++;
  }
  return count === 2;
}

// the four movements of the pair's screen coming in (0x0809B424, 0x0809B470, 0x0809B4BC and 0x0809B548)
function slideChosenIn(cs) {
  if (cs.chosenX < Q(90)) { cs.chosenX += Q(3); return false; }
  cs.chosenX = Q(90);
  return true;
}
function slidePartnerAcross(cs) {
  if (cs.charX > Q(150)) { cs.charX -= Q(3); return false; }
  cs.charX = Q(150);
  return true;
}
function slideTagAcross(cs) {
  let count = 0;
  const pos = cs.tagPos[0];
  if (pos.x < Q(95)) pos.x += Q(3);
  else { pos.x = Q(95); count = 1; }
  if (cs.backdropX > Q(201)) cs.backdropX -= Q(3);
  else { cs.backdropX = Q(201); count++; }
  return count === 2;
}
function slidePartnerTagAcross(cs) {
  let count = 0;
  const pos = cs.tagPos[1];
  if (pos.x > Q(145)) pos.x -= Q(3);
  else { pos.x = Q(145); count++; }
  if (cs.nameX >= Q(201)) { cs.nameX = Q(201); count++; } else cs.nameX += Q(3);
  return count === 2;
}

// 0x0809B5D0: the chosen character's name as text, in front
function showChosenName(cs, character) {
  const { c } = cs;
  c.dispCnt |= 0x200;
  drawBackground(c, { id: tilemap(c, T_NAMES + character), dest: 0xC000, layoutVram: 0x1800, targetTilesX: 16, targetTilesY: 16, flags: 1 });
  cs.unkB = 3;
}

// 0x08098BC8, Task_CharSelect_FadeIn: the screen coming out of white
function fadeIn(t) {
  const cs = t.data, { c } = cs;
  if (cs.unkE) {
    whiteOut(c);
    c.bldY = 0x10;
    cs.fade = Q(16);
    cs.unkE = 0;
  }
  turn(cs);
  moveArrows(cs);
  showArrows(cs);
  showHeader(cs);
  showTagOfMain(cs);
  scrollLayers(cs);
  transformBackground(cs);
  if (c.bldY !== 0) {
    c.bldY = I(cs.fade);
    cs.fade -= Q(1);
  } else {
    cs.unkE = 1;
    c.bldY = 0;
    t.main = choosing;
  }
}

// 0x08098CAC, Task_CharSelect_FadeOut: the screen going to white. `unk2` says where it goes after: 2 is on with the story,
// 3 back to the main menu.
function fadeOut(t) {
  const cs = t.data, { c } = cs;
  if (cs.unkE) {
    whiteOut(c);
    cs.unkE = 0;
    cs.fade = 0;
  }
  showHeader(cs);
  transformBackground(cs);
  if (cs.unkB > 19) showPair(cs);
  else showTagOfMain(cs);
  if (cs.unkB === 1) showArrows(cs);
  if (cs.unkB === 5) { lowerTag(cs, 0); slideOutCharacter(cs); }
  else if (cs.unkB === 8) { raiseTag(cs, 0); slideInCharacter(cs); }
  if (c.bldY < 16) {
    c.bldY = I(cs.fade);
    cs.fade += Q(1);
  } else {
    c.bldY = 0x10;
    cs.charX = cs.chosenX = Q(310);
    cs.unkB = 29;
    // the way on from here isn't ported: the screen stays white
    t.main = leaving;
  }
}

function leaving() { }

// 0x08098DE4, Task_8098DE4: waiting for the main character's choice
function choosing(t) {
  const cs = t.data, { c } = cs;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  scrollLayers(cs);
  transformBackground(cs);
  moveArrows(cs);
  showArrows(cs);
  c.dispCnt &= ~0x200;
  if (c.pressed & KEY.B) {
    c.playSong(SE_ABORT);
    cs.unk2 = 3;
    cs.unkB = 2;
    t.main = fadeOut;
  } else if (c.repeated & (KEY.LEFT | KEY.RIGHT)) {
    c.playSong(SE_CHARSELECT_SLIDE);
    chooseNext(cs, false);
    t.main = sliding;
  } else if (c.pressed & KEY.A) {
    const character = displayed(c, cs.listIndex[0]);
    if (!isLocked(c, character)) {
      c.playSong(c.rom.u16(VOICES + cs.listIndex[0] * 2));
      showChosenName(cs, character);
      t.main = chosen;
    }
  }
}

// 0x080992A8 and 0x08099C34: the next character on the list, to the right or the left, skipping the main character's for
// the partner
function chooseNext(cs, partner) {
  const { c } = cs, skip = partner ? cs.listIndex[0] : -1;
  cs.target = cs.shown;
  if (c.repeated & KEY.RIGHT) {
    do cs.target = cs.target >= 4 ? 0 : cs.target + 1; while (cs.target === skip);
    cs.sideways = 0;
    cs.unkB = partner ? 15 : 6;
  }
  if (c.repeated & KEY.LEFT) {
    do cs.target = cs.target === 0 ? 4 : cs.target - 1; while (cs.target === skip);
    cs.sideways = 1;
    cs.unkB = partner ? 16 : 7;
  }
}

// 0x08098FF0, Task_8098FF0: the character sliding out and the next sliding in
function sliding(t) {
  const cs = t.data;
  let done = false;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  scrollLayers(cs);
  transformBackground(cs);
  lowerTag(cs, 0);
  slideOutName(cs);
  if (cs.charX === Q(330) && cs.sideways === 0 || cs.charX === -Q(90) && cs.sideways === 1) done = true;
  else if (slideOutCharacter(cs)) {
    cs.shown = cs.target;
    done = true;
    cs.charX = cs.sideways === 0 ? Q(330) : -Q(90);
    cs.listIndex[0] = cs.shown;
  }
  if (done) {
    cs.unkB = 4;
    const character = displayed(cs.c, cs.listIndex[0]);
    drawTurningName(cs, character);
    cs.charY = Q(80);
    colour(cs.c, 0x60, character);
    t.main = arriving;
  }
}

// 0x08099200, Task_8099200: the next character coming in
function arriving(t) {
  const cs = t.data;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  scrollLayers(cs);
  transformBackground(cs);
  slideInName(cs);
  if (slideInCharacter(cs) && raiseTag(cs, 0)) {
    cs.slide = 0;
    t.main = choosing;
  }
}

// 0x08099300, Task_8099300: the choice made: the character stays on the left, and the partner's choice begins
function chosen(t) {
  const cs = t.data, { c } = cs;
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  if (cs.unkB < 13) {
    c.dispCnt |= 0x200;
    if (cs.unkB <= 12) {
      cs.unkB = 12;
      cs.chosenX = cs.charX;
      cs.chosenY = cs.charY;
      cs.listIndex[0] = cs.shown;
      createCharacterTask(cs, { who: () => cs.listIndex[0], x: 'chosenX', y: 'chosenY' }, cs.tiles[1]);
      cs.nameX = Q(300);
    }
  }
  const e = entry(c.rom, TEAM_TEXT, u8(cs.unkB - 11) + cs.language * 8);
  cs.team.anim = e.anim;
  cs.team.variant = e.variant;
  updateSprite(c, cs.team);
  cs.players[0] = displayed(c, cs.listIndex[0]);
  t.main = partnerSetUp;
}

// 0x08099344, Task_SetupPartnerCharIndices: the partner's choice begins on the first character who isn't the main one
function partnerSetUp(t) {
  const cs = t.data, { c } = cs;
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  cs.shown = 0;
  for (let i = 0; i < 4; i++) {
    if (cs.shown !== cs.listIndex[0]) {
      if (cs.shown < 5) break;
    } else cs.shown++;
  }
  cs.target = cs.shown;
  cs.listIndex[1] = cs.shown;
  const character = displayed(c, cs.listIndex[1]);
  cs.charX = Q(310);
  cs.charY = Q(80);
  colour(c, 0x70, character);
  cs.partnerName.prevVariant = 0xFF;
  drawTurningName(cs, character);
  t.main = partnerComes;
}

// 0x08099680, Task_8099680: the main character moving to the left and the partner's choice coming in from the right
function partnerComes(t) {
  const cs = t.data;
  let count = 0;
  cs.unkB = 12;
  if (moveChosen(cs)) count++;
  if (slidePartnerIn(cs, false)) count++;
  if (moveTag(cs)) count++;
  followPartner(cs);
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  if (count === 3) {
    cs.unkB = 14;
    t.main = choosingPartner;
  }
}

// 0x08099758, Task_8099758: waiting for the partner's choice. B, which goes back to the main character's, isn't ported.
function choosingPartner(t) {
  const cs = t.data, { c } = cs;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  moveArrows(cs);
  showArrows(cs);
  if (c.repeated & (KEY.LEFT | KEY.RIGHT)) {
    c.playSong(SE_CHARSELECT_SLIDE);
    chooseNext(cs, true);
    t.main = partnerSliding;
  } else if (c.pressed & KEY.A) {
    const character = displayed(c, cs.listIndex[1]);
    if (!isLocked(c, character)) {
      c.playSong(c.rom.u16(VOICES + cs.listIndex[1] * 2));
      cs.unkB = 20;
      t.main = pairShown;
    }
  }
}

// 0x08099968, Task_8099968: the partner sliding out of sight, and the next one set to come in
function partnerSliding(t) {
  const cs = t.data, { c } = cs;
  let count = 0;
  if (slidePartnerIn(cs, true)) count++;
  if (lowerTag(cs, 1)) count++;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  if (count === 2) {
    cs.shown = cs.target;
    cs.charX = Q(330);
    cs.listIndex[1] = cs.shown;
    cs.charY = Q(80);
    cs.unkB = 4;
    cs.nameX = Q(320);
    const character = displayed(c, cs.listIndex[1]);
    colour(c, 0x70, character);
    cs.unkB = 14;
    drawTurningName(cs, character);
    t.main = partnerArriving;
  }
}

// 0x08099B78, Task_8099B78: the next partner coming in
function partnerArriving(t) {
  const cs = t.data;
  let count = 0;
  if (slidePartnerIn(cs, false)) count++;
  if (raiseTag(cs, 1)) count++;
  turn(cs);
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollLayers(cs);
  transformBackground(cs);
  if (count === 2) {
    cs.slide = 0;
    cs.unkB = 14;
    t.main = choosingPartner;
  }
}

// 0x08099C9C, Task_8099C9C: the pair chosen: the partner's name becomes the text layer, and the screen is set up to bring
// the pair together
function pairShown(t) {
  const cs = t.data, { c } = cs;
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  c.mapFill[2].value = 0;
  c.mapFill[2].rect.set([0, 0, 0xFF, 0x40]);
  cs.nameX = Q(142);
  cs.nameY = Q(22);
  c.bgScroll[4] = 142;
  c.bgScroll[5] = u16(-22);
  c.dispCnt = 0x1740;
  c.bgCnt[2] = 0x1B09;
  drawBackground(c, {
    id: tilemap(c, T_NAMES + displayed(c, cs.listIndex[1])), dest: 0x8000, layoutVram: 0xD800, targetTilesX: 16, targetTilesY: 16, flags: 2,
  });
  scrollLayers(cs);
  transformBackground(cs);
  cs.players[1] = displayed(c, cs.listIndex[1]);
  t.main = pairComesIn;
}

// 0x08099EC8, Task_8099EC8: the two characters and their tags moving in beside each other, as the screen fades
function pairComesIn(t) {
  const cs = t.data, { c } = cs;
  if (cs.unkE) {
    whiteOut(c, FADE_OUT_AFTER);
    cs.fade = 0;
    cs.unkE = 0;
  }
  let count = 0;
  if (slideChosenIn(cs)) count++;
  if (slidePartnerAcross(cs)) count++;
  if (slideTagAcross(cs)) count++;
  if (slidePartnerTagAcross(cs)) count++;
  showHeader(cs);
  showTagOfMain(cs);
  showTagOfPartner(cs);
  scrollAllLayers(cs);
  if (c.bldY < 0x10) {
    c.bldY = I(cs.fade);
    cs.fade += Q(1);
  } else if (count === 4) {
    c.bldY = 0x10;
    cs.unkB = 22;
    showOk(cs);
    describePair(cs);
    cs.backdropY = 0xE00;
    t.main = pairFadesIn;
  }
}

// 0x0809A9A0: "OK" turning behind the pair
function showOk(cs) {
  const { c } = cs;
  c.dispCnt = 0x1541;
  c.bgCnt[2] = 0x1B89;
  c.bgScroll[4] = c.bgScroll[5] = 0;
  cs.nameX = Q(120);
  cs.nameY = Q(85);
  drawBackground(c, { id: tilemap(c, T_OK), dest: 0x8000, layoutVram: 0xD800, targetTilesX: 16, targetTilesY: 16, flags: 6 });
}

// 0x0809A808: the description of the pair, and the one backdrop for both their tags
function describePair(cs) {
  const { c } = cs, a = displayed(c, cs.listIndex[0]), b = displayed(c, cs.listIndex[1]);
  let which;
  if (a === 0 || b === 0) {
    if (a === 2 || b === 2) which = 4;
    else if (a === 3 || b === 3) which = 6;
    else if (a === 4 || b === 4) which = 3;
    else which = 2;
  } else if ((a === 4 && b === 1) || (a === 1 && b === 4)) which = 5;
  else which = 2;
  const e = entry(c.rom, TEAM_TEXT, which + cs.language * 8);
  cs.team.anim = e.anim;
  cs.team.variant = e.variant;
  updateSprite(c, cs.team);
  setUp(c, cs.tagBack, entry(c.rom, TAG_BACK_PAIR, 0), cs.tagBack.tiles, I(cs.tagPos[0].x), I(cs.tagPos[0].y), 0x40);
}

// 0x0809A018, Task_809A018: the pair coming out of white
function pairFadesIn(t) {
  const cs = t.data, { c } = cs;
  if (cs.unkE) {
    whiteOut(c, FADE_OUT_AFTER);
    c.bldY = 0x10;
    cs.fade = Q(16);
    cs.unkE = 0;
  }
  turn(cs);
  showHeader(cs);
  showPair(cs);
  transformBackground(cs);
  scrollLayers(cs);
  if (c.bldY !== 0) {
    c.bldY = I(cs.fade);
    cs.fade -= Q(1);
  } else {
    cs.unkE = 1;
    c.bldY = 0;
    t.main = announcing;
  }
}

// 0x0809A1C4, Task_809A1C4: the announcer says the pair's names, and a press or two seconds go on
function announcing(t) {
  const cs = t.data, { c } = cs, { rom } = c;
  turn(cs);
  showHeader(cs);
  showPair(cs);
  transformBackground(cs);
  scrollLayers(cs);
  if (cs.wait === 0) c.playSong(rom.u16(ANNOUNCER_FIRST + cs.listIndex[0] * 2));
  else if (cs.wait === 60) c.playSong(VOICE_ANNOUNCER_AND);
  else if (cs.wait === 90) c.playSong(rom.u16(ANNOUNCER_SECOND + cs.listIndex[1] * 2));
  cs.wait++;
  if (c.pressed & (KEY.A | KEY.START) || cs.wait > 120) {
    cs.unk2 = 2;
    cs.unkB = 23;
    t.main = fadeOut;
  }
}

// The characters, which slide across the screen on a task of their own (CreateSomeTask_809BF3C, 0x0809BF3C): their pictures
// by the pose `unkB` names. `refs` says which of the screen's values are this one's character, place across and place down.
function createCharacterTask(cs, refs, tiles) {
  const k = { cs, c: cs.c, refs, tiles, unk9: 0, first: [], cheese: [] };
  loadCharacters(k);
  k.task = cs.c.createTask(characterMain, k, 0xFF);
  return k.tiles;
}

const characterOf = k => displayed(k.c, k.refs.who());

// 0x0809B3E8, LoadCharacterSelectSprites: the pictures of the character and of Cheese in the tiles one after another
function loadCharacters(k) {
  const { c, cs } = k, { rom } = c, stopped = cs.unkB > 0x15;
  let tiles = k.tiles;
  const load = (sprites, who) => {
    const { count, list } = picturesOf(rom, stopped, who);
    for (let i = 0; i < count; i++) {
      const e = entry(rom, list, i), s = sprites[i] ??= createSprite({});
      setUp(c, s, e, tiles, I(cs[k.refs.x]), I(cs[k.refs.y]), 0x40);
      tiles += e.numTiles * TILE_4BPP;
    }
  };
  load(k.first, characterOf(k));
  load(k.cheese, CHEESE);
  k.tiles += 0xD40;
}

// 0x0809B540, Task_270_809B8C8: the character's pictures, and when it has gone off to the right, what comes next
function characterMain(t) {
  const k = t.data, { cs } = k;
  showCharacter(k);
  if (cs.unkB >= 22 && cs.unkB <= 28) choosePose(k);
  if (((cs[k.refs.x] + 0x3C00) >>> 0) > 0x16800) {
    switch (cs.unkB) {
      case 29: cs.unkB = 36; k.c.destroyTask(t); return;
      case 36: cs.unkB = 37; k.c.destroyTask(t); return;
      case 4: t.main = arrived; return;
    }
  }
}

// 0x0809BF9C, Task_270_809BF9C: a character who has come in from the right takes the pose of arriving (8) for the main
// character, or of waiting (14) for the partner
function arrived(t) {
  const k = t.data, { cs } = k;
  if (cs.unkB === 4) cs.unkB = 8;
  else cs.unkB = 14;
  showCharacter(k);
  t.main = characterMain;
}

// 0x0809B970: the pose of the pair by who they are, once they are chosen: 1 for any, 2 to 4 for Sonic with Tails, Knuckles
// or Amy, and 5 for Cream with Amy
function choosePose(k) {
  const [a, b] = k.cs.players;
  let pose;
  if (a === 0 || b === 0) {
    if (a === 2 || b === 2) pose = 2;
    else if (a === 3 || b === 3) pose = 3;
    else if (a === 4 || b === 4) pose = 4;
    else pose = 1;
  } else if ((a === 4 && b === 1) || (a === 1 && b === 4)) pose = 5;
  else pose = 1;
  k.unk9 = pose;
}

// 0x0809BA58, sub_809BA58: the character's pictures where it is, each frame, for the list of its pose, turned to face the
// middle when it is on the right of it or is the partner
function showCharacter(k) {
  const { c, cs } = k, { rom } = c, who = characterOf(k), pose = cs.unkB;
  let flip = false, count = 0, cheeseCount = 0, list = 0, cheeseList = 0;
  if ((u8(pose - 0xC) < 8 && I(cs[k.refs.x]) > 0x78) || (pose > 0x13 && pose !== 0x1C && who !== cs.players[0])) flip = true;
  const lists = i => rom.u32(TEAM_LISTS + i * 4) - 0x08000000;
  const middle = () => { cs[k.refs.x] = Q(120); cs[k.refs.y] = Q(80); };
  const own = stopped => {
    const a = picturesOf(rom, stopped, who), b = picturesOf(rom, stopped, CHEESE);
    count = a.count;
    list = a.list;
    cheeseCount = b.count;
    cheeseList = b.list;
  };
  if (pose >= 0x16 && pose <= 0x1C) {
    if (!(pose >= 0x19 && pose <= 0x1B)) {
      if (k.unk9 !== 1) {
        switch (k.unk9) {
          case 2:
            count = rom.u8((who === 0 ? TEAM_COUNTS_SONIC : TEAM_COUNTS_OTHERS) + 0);
            list = lists(who === 0 ? 0 : 1);
            middle();
            break;
          case 3:
            count = rom.u8((who === 0 ? TEAM_COUNTS_SONIC : TEAM_COUNTS_OTHERS) + 1);
            list = lists(who === 0 ? 4 : 5);
            middle();
            break;
          case 4:
            count = rom.u8((who === 0 ? TEAM_COUNTS_SONIC : TEAM_COUNTS_OTHERS) + 2);
            list = lists(who === 0 ? 2 : 3);
            middle();
            break;
          case 5:
            if (who === CREAM) {
              count = rom.u8(TEAM_COUNTS_CREAM);
              cheeseCount = rom.u8(TEAM_COUNTS_CREAM + 2);
              list = lists(7);
              cheeseList = lists(8);
            } else {
              count = rom.u8(TEAM_COUNTS_CREAM + 1);
              list = lists(6);
            }
            middle();
            break;
        }
      } else own(true);
    } else {
      flip = false;
      k.unk9 = pose === 0x1B ? 1 : 0;
      own(k.unk9 === 1);
    }
  } else if (pose >= 0x19 && pose <= 0x1B) {
    flip = false;
    k.unk9 = pose === 0x1B ? 1 : 0;
    own(k.unk9 === 1);
  } else {
    if (pose === 0x1C) { flip = false; k.unk9 = 1; }
    if (k.unk9 === 1) own(true);
    else { own(false); k.unk9 = 0; }
  }
  let tiles = k.first[0].tiles;
  const order = who !== cs.players[0] ? 0x80 : 0x40;
  const draw = (sprites, n, from) => {
    for (let i = 0; i < n; i++) {
      const e = entry(rom, from, i), s = sprites[i] ??= createSprite({});
      Object.assign(s, {
        tiles, anim: e.anim, variant: e.variant, prevVariant: 0xFF, x: I(cs[k.refs.x]), y: I(cs[k.refs.y]), oamFlags: order,
        animCursor: 0, qAnimDelay: 0, animSpeed: 0x10, palId: 0, frameFlags: flip ? SPRITE.X_FLIP : 0,
      });
      tiles += e.numTiles * TILE_4BPP;
      updateSprite(c, s);
      displaySprite(c, s);
    }
  };
  draw(k.first, count, list);
  const locked = isLocked(c, who) && u8(pose - 0x19) > 2;
  if (who === CREAM) {
    draw(k.cheese, cheeseCount, cheeseList);
    if (locked) grey(c, 5);
  }
  if (locked) grey(c, rom.u8(GREY_PALETTE + who));
}

// the colours a character who isn't unlocked has, over the palette at `at`
function grey(c, at) {
  for (let i = 0; i < 16; i++) c.objPalette[at * 16 + i] = c.rom.u16(GREY + i * 2);
  c.flags |= 0x2;
}
