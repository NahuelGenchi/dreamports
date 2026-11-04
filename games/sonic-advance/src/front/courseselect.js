// The course select (SAT-R decompilation, src/game/sa1/ui/course_select.c), after Game Start once the character has
// progress in the save: its acts down the left, as far as they have got, and the zones they belong to down the
// right, over a picture. The screen fades in from black over 16 frames to its own song while both lists slide in
// from below, the picture's bands with them, 63 frames in all, which A cuts short. Up and Down choose an act, with
// the key repeat, and don't wrap round; the lists scroll two rows at a time to keep it in view. A fades out with the
// choice blinking and starts that act, and B goes back.
//
// With the address's start point, which leaves out the character select, B goes to the main menu, where the character
// select would go back to (CreateMainMenu(1)). Time Attack's and the link play's ways through this screen aren't built
// yet (their own tasks; arg0 and the multiplayer checks).

import { createSprite, updateSprite, displaySprite, SPRITE } from '../gba/sprite.js';
import { KEY } from '../gba/engine.js';
import { REG } from '../../../../kit/gba/video.js';
import { SONG } from '../sound/songs.js';
import { theMoonOpens } from '../engine/unlock.js';
import { createUiTask, uiGfxStackInit, uiGraphics, loadUiGfx, createFade, fadeStep } from './ui.js';
import { createMainMenu } from './title.js';
import { createCharacterSelect } from './charselect.js';
import { put16 } from '../gba/lines.js';

const OBJ_VRAM = 0x10000;
const ANIM_ACTS = 724, ANIM_ARROW_UP = 745, ANIM_VS_MENU_WAIT = 905;
const ACT_TILES_AT = 0x20, ACT_TILES = 0x3C0;   // gUnknown_0868B10C: the acts' 15 sets of tiles, in sprite VRAM
const ZONES = [725, 726, 727, 742, 743, 744, 729, 728];   // gUnknown_0868B1C0's animations: the zones' names
const ZONE_TILES_AT = 0x3860, ZONE_TILES = 0x480;
const ARROW_TILES_AT = 0x6400, WAIT_TILES_AT = ARROW_TILES_AT + 0xC0;
// the scroll at which the last row is in view, by how many rows there are (gUnknown_0868B220)
const LAST_SCROLL = [20, 20, 20, 20, 20, 20, 20, 36, 60, 84, 108, 132, 156, 180, 204, 228];
// the picture, one thing after the other (offsets.courseSelectBackground, sub_8061894): the front layer's tiles and
// map, the colours, then the back layer's tiles and map
const BACKGROUND = {
  frontTiles: 0, frontTilesSize: 0xE00, frontLayout: 0xD40, frontLayoutSize: 0x500,
  palette: 0x1240, paletteSize: 0x200,
  tiles: 0x1440, tilesSize: 0x1180, layout: 0x25C0, layoutSize: 0x1000,
};
// the colours of the UI graphics entry the screen loads over sprite palette row 3 as it starts
const ROW_3_GFX = 62;
const SLIDE_END = 0x3F;   // the slide's last frame, when the picture's map doubles to its full height
const CHOSEN = 1, BACK = 2;   // unk57
const s16 = v => (v << 16) >> 16;
const div = (a, b) => Math.trunc(a / b);

// a sprite of the screen's: its animation from the start, at normal speed
const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, ...fields });

// how many rows the character has (the first of them is never shown, so one more than they can choose)
function courseRows(save, character) {
  const unlocked = save.unlockedLevel(character);
  let rows = (unlocked + 2) & 0xFF;
  if (rows === 0) rows = 1;
  if (character === 0) {
    if (rows > 15) rows = 15;
    else if (unlocked === 13) rows = 14;
  } else if (rows > 14) rows = 14;
  return rows;
}

// sub_8061894: the picture's two layers, from the screen's own stack
function loadBackground(e, at) {
  uiGfxStackInit(e);
  const noLayout = { unk4: 0, unk8: 0, unk9: 0, unkA: 0, unkB: 0 }, b = BACKGROUND;
  loadUiGfx(e, {
    uiGfxID: 0x80, unk2B: 1, unk0: noLayout, unk29: 1, unk2A: 0x11,
    tiles: at + b.frontTiles, tilesSize: b.frontTilesSize, layout: at + b.frontLayout, layoutSize: b.frontLayoutSize,
  });
  loadUiGfx(e, {
    uiGfxID: 0x80, unk2B: 0, unk0: noLayout, unk28: 0, unk29: 0, unk2A: 0x15,
    tiles: at + b.tiles, tilesSize: b.tilesSize, palette: at + b.palette, paletteSize: b.paletteSize, layout: at + b.layout, layoutSize: b.layoutSize,
  });
}

// the colours of sprite palette row 3 (0x08061E50 for its first frames, CreateCourseSelect for Time Attack)
function loadRow3(e, offsets) {
  const gfx = uiGraphics(e.rom, offsets.uiGraphics, ROW_3_GFX);
  loadUiGfx(e, { uiGfxID: ROW_3_GFX, unk2B: 0, unk0: gfx.unk0, unk28: 3, unk2A: 0xC, vramC: OBJ_VRAM + 0x20, tiles: gfx.tiles, tilesSize: 0x20, palette: gfx.palette, paletteSize: 0x20 });
}

/**
 * CreateCourseSelect, 0x08061914. `ctx` has the engine, the sprite tables, the save, the ROM's offsets, the character
 * being played, `play(level)`, which starts an act, and `levels()`, the level last played (gCurrentLevel) and the one
 * the course select last started (gMultiplayerCurrentLevel).
 */
export function createCourseSelect(ctx) {
  const e = ctx.engine, rows = courseRows(ctx.save, ctx.character);
  e.playSong(SONG.COURSE_SELECTION);
  createUiTask(e);
  uiGfxStackInit(e);
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  e.bgScroll.fill(0, 0, 4);
  e.wideBars = true;
  loadBackground(e, ctx.offsets.courseSelectBackground);

  // `ending` is unk57, and `shown` what the acts' list has of it, as it hears a frame later
  const state = {
    ctx, rows, frame: 0, ending: 0, shown: 0, scroll: 0x14, scrollTo: 0x14, level: 1,   // unk4C, unk50, unk52
    fade: createFade(0, 1, 2, 0, 0x200, 1),
  };
  e.createTask(slideIn, state, 0x2000);
  const arrow = sprite(ANIM_ARROW_UP, OBJ_VRAM + ARROW_TILES_AT, { oamFlags: 0 });
  state.tasks = [e.createTask(showArrows, state, 0x2030)];
  updateSprite(e, ctx.sprites, arrow);
  // only link play shows it, but its first frame's tiles and colours load all the same
  updateSprite(e, ctx.sprites, sprite(ANIM_VS_MENU_WAIT, OBJ_VRAM + WAIT_TILES_AT, { x: 120, y: 80, oamFlags: 0x80, frameFlags: 0x2000 }));
  state.arrow = arrow;
  state.acts = [];
  for (let i = 0; i < rows; i++) {
    state.acts[i] = sprite(ANIM_ACTS, OBJ_VRAM + ACT_TILES_AT + i * ACT_TILES, { variant: i, oamFlags: 0x480, frameFlags: 0x2000 });
    updateSprite(e, ctx.sprites, state.acts[i]);
  }
  state.tasks.push(e.createTask(slideActs, state, 0x2030));
  state.zones = ZONES.map((anim, i) => {
    const s = sprite(anim, OBJ_VRAM + ZONE_TILES_AT + i * ZONE_TILES, { oamFlags: 0x480, frameFlags: 0x2000 });
    updateSprite(e, ctx.sprites, s);
    return s;
  });
  state.tasks.push(e.createTask(slideZones, state, 0x2030));
  fadeStep(e, state.fade);
}

// the scroll a step nearer what it's going to, a fifth of the way
function moveScroll(state) { state.scroll = (state.scroll + div((state.scrollTo - state.scroll) * 2, 10)) & 0xFFFF; }

// Task_CourseSelectInit, 0x08061E50: the colours, and the picture's bands apart by what's left of the slide: 12 lines
// at the scroll, and then bands of 24 lines, each below a gap of 64 - frame lines that show the map's first rows
function slideIn(t) {
  const state = t.data, { ctx } = state, e = ctx.engine;
  const frame = state.frame + 1;
  state.scrollTo = frame === SLIDE_END && state.rows === 1 ? 0 : 0x14;
  state.scroll = 0x14;
  if (frame <= 10) loadRow3(e, ctx.offsets);
  state.frame = frame;
  moveScroll(state);
  fadeStep(e, state.fade);
  e.setHBlankCopy(REG.BG0HOFS, 4);
  let line = 0;
  const put = v => {
    put16(e, e.primary + line * 4, 0);
    put16(e, e.primary + line * 4 + 2, v);
    line++;
  };
  for (let i = 0; i < 12; i++) put(0x14);
  for (let band = 0; line < 160; band++) {
    for (let i = 0; i < 64 - frame && line < 160; i++) put(-line & 0x1FF);
    const y = (band * 24 - line + 32) & 0xFF;
    for (let i = 0; i < 24 && line < 160; i++) put(y);
  }
  if (frame === SLIDE_END || e.pressed & KEY.A) {
    e.bgScroll[1] = 0x14;
    state.frame = SLIDE_END;
    e.bgCnt[0] = 0x9D83;
    e.flags &= ~0x4;
    t.main = chooseAct;
  }
}

// Task_8062140: Up and Down choose, and the lists scroll two rows at a time to keep the choice in view. A on the
// first frame after the slide only stops the song.
function chooseAct(t) {
  const state = t.data, { ctx } = state, e = ctx.engine, { rows, fade } = state;
  const frame = state.frame + 1;
  if (rows > 1) {
    if (e.repeated & KEY.DOWN) {
      if (state.level < rows - 1) { e.playSong(SONG.MENU_CURSOR); state.level++; }
    } else if (e.repeated & KEY.UP) {
      if (state.level > 1) { e.playSong(SONG.MENU_CURSOR); state.level--; }
    }
  }
  if (state.level > div(state.scrollTo, 24) + 5) {
    const { save, character } = ctx, { current, started } = ctx.levels();
    const moon = theMoonOpens({ character, level: current, emeralds: save.chaosEmeralds, unlockedLevels: [0, 1, 2, 3].map(c => save.unlockedLevel(c)), courseSelectLevel: started });
    // the last row before the Moon Zone's stops short, as nothing comes after it unless the Moon has opened
    if (!moon && rows > 13 && state.level === 13) state.scrollTo = (state.level - 5) * 24 - 8;
    else state.scrollTo = (((state.level - 5) & 0x1E) + 1) * 24 - 8;
  } else if (state.level <= div(state.scrollTo, 24)) {
    const to = state.level * 24 - 8;
    state.scrollTo = to > 16 ? ((state.level & ~1) - 1) * 24 - 8 : to;
  }
  state.frame = frame;
  moveScroll(state);
  state.shown = state.ending;
  fadeStep(e, fade);
  if (fade.unk6 > 0x1800 && fade.unk4 === 2) {
    if (e.pressed & KEY.A) {
      e.stopSong(SONG.COURSE_SELECTION);
      if (frame > 64) leave(t, CHOSEN, SONG.SELECT);
    } else if (e.pressed & KEY.B) {
      e.stopSong(SONG.COURSE_SELECTION);
      leave(t, BACK, SONG.RETURN);
    }
  }
  e.bgScroll[1] = state.scroll;
}

// the fade turned round from where it is
function leave(t, ending, song) {
  const state = t.data;
  state.ending = ending;
  t.main = fadeOut;
  state.ctx.engine.playSong(song);
  state.fade.unk4 = 1;
  state.fade.unk6 = 0x2000 - state.fade.unk6;
}

// Task_8062540: out to black; then the act chosen, whose level is one less than its row, or back
function fadeOut(t) {
  const state = t.data, { ctx, fade } = state, e = ctx.engine;
  state.frame++;
  if (state.rows === 1) state.scrollTo = 0;
  moveScroll(state);
  state.shown = state.ending;
  fadeStep(e, fade);
  if (fade.unk6 > 0x1800 && fade.unk4 === 1) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.bgCnt[0] = 0x9D03;
    e.bgCnt[1] = 0x1806;
    for (const task of state.tasks) e.destroyTask(task);
    e.destroyTask(t);
    if (state.ending === CHOSEN) ctx.play(state.level - 1);
    else if (ctx.select) createCharacterSelect(ctx);
    else createMainMenu(ctx, true);
    return;
  }
  e.bgScroll[1] = state.scroll;
}

// Task_8062E18: the arrow at the top, once the list has scrolled, and flipped at the bottom while there's more below
function showArrows(t) {
  const state = t.data, { ctx, rows, scroll } = state, e = ctx.engine, s = state.arrow;
  const flipped = () => { s.frameFlags |= SPRITE.Y_FLIP; s.x = 48; s.y = 136; };
  if (scroll !== 0x14) {
    s.frameFlags &= ~SPRITE.Y_FLIP;
    s.x = 48;
    s.y = 24;
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
    if (rows > 6 && scroll < LAST_SCROLL[rows - 1]) {
      flipped();
      displaySprite(e, ctx.sprites, s);
    }
  } else if (rows > 7 && scroll < LAST_SCROLL[rows - 1]) {
    flipped();
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
}

// Task_8062A80: the acts, each further apart by what's left of the slide
function slideActs(t) {
  const state = t.data, { ctx, rows, frame, level } = state, e = ctx.engine;
  for (let i = 1; i < rows; i++) {
    const s = state.acts[i];
    s.palId = i === level ? 1 : 0;
    s.x = i === level ? 0x4C : 0x48;
    s.y = (i - 1) * 24 + i * (64 - frame) + 16;
    s.frameFlags |= SPRITE.KEEP_PALETTE;
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
  if (frame === SLIDE_END) t.main = showActs;
}

// Task_8062B38: the eight rows in view, the chosen one further right in its lit colours, blinking once chosen
function showActs(t) {
  const state = t.data, { ctx, rows, frame, level, scroll, shown } = state, e = ctx.engine;
  let i = (div(scroll, 24) - 1) & 0xFF;
  for (let n = 0; n < 8; n++, i = (i + 1) & 0xFF) {
    if (i === 0 || i > rows - 1) continue;
    const s = state.acts[i];
    if (i === level) {
      s.palId = shown === CHOSEN ? frame & 1 : 1;
      s.x = 0x4C;
    } else {
      s.x = 0x48;
      s.palId = 0;
    }
    s.y = s16(i * 24 - (scroll - 12));
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
}

// Task_8062C28: the zones' names, further apart by twice what's left of the slide, each once its first act is there
function slideZones(t) {
  const state = t.data, { ctx, rows, frame } = state, e = ctx.engine;
  for (let i = 1; i < 6; i++) {
    const s = state.zones[i - 1];
    s.palId = 0;
    s.x = 212;
    s.y = (i - 1) * 48 + i * ((64 - frame) << 1) + 0x21;
    if (rows > (i - 1) * 2 + 1) {
      updateSprite(e, ctx.sprites, s);
      displaySprite(e, ctx.sprites, s);
    }
  }
  if (frame === SLIDE_END) t.main = showZones;
}

// Task_8062CB4: the zones in view; the last two, a row each, sit closer, and the Moon Zone's shows beside the
// fifteenth row alone
function showZones(t) {
  const state = t.data, { ctx, rows, scroll } = state, e = ctx.engine;
  const scrolled = scroll > 0x2F;
  let i = ((div(scroll, 48) - (scrolled ? 1 : 0))) & 0xFF;
  for (let n = 0; n < (scrolled ? 6 : 5); n++, i = (i + 1) & 0xFF) {
    if (i >= 8) continue;
    const s = state.zones[i];
    s.x = 212;
    s.palId = 0;
    let y = i * 0x30 - (scroll - 0x37);
    if (i === 6) y -= 12;
    if (i === 7) y -= 36;
    s.y = s16(y);
    if (rows > i * 2 + 1 || (i === 7 && ctx.character === 0 && rows === 15)) {
      updateSprite(e, ctx.sprites, s);
      displaySprite(e, ctx.sprites, s);
    }
  }
}
