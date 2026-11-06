// The character select (SAT-R decompilation, src/game/sa1/ui/character_select.c: CreateCharacterSelectionScreen and
// its tasks), from the main menu's Game Start. It fades in from black over 16 frames to its music: a backdrop on the
// second layer, and after it the title and its scrolling strip dropping in from the top, the character's name
// and the two bars around it sliding up, the characters coming in from the right, and the arrows on both sides.
//
// From the 34th frame Left and Right turn the row, with the key repeat the main menu set, 16 frames a turn. A picks
// the character in the middle: it strikes its pose, the others leave and the screen fades to black, and the act
// starts, or the course select (courseselect.js) once the character has cleared a level. B fades the screen out and
// goes back to the main menu.
//
// CheckCPUPartnerUnlock watches the keys throughout: Up on Sonic, then Right, Down, Right, L, Right, R, Right and A,
// and the ring sound plays as the screen ends, and Tails comes along as the CPU's partner (gTailsEnabled).
//
// The original's own use of this screen in Time Attack and in multiplayer isn't built yet.

import { createSprite, updateSprite, displaySprite, displaySpriteBackground } from '../gba/sprite.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { SINE } from '../engine/trig.js';
import { createUiTask, uiGfxStackInit, uiGraphics, loadUiGfx, drawUiText, drawUiGlyphs, glyphs, createFade, fadeStep } from './ui.js';
import { createMainMenu } from './title.js';
import { createTimeAttackMenu } from './timeattack.js';
import { createCourseSelect } from './courseselect.js';

const OBJ_VRAM = 0x10000;
const ANIM_CHARACTERS = 722, ANIM_BACKDROP = 723, ANIM_BLOCK = 730;
// the backdrop's variant by how far the row has turned, in quarters of a turn (gUnknown_08688578)
const BACKDROP_VARIANTS = [3, 0, 2, 1];
const LEFT = 0, MIDDLE = 1, RIGHT = 2, BLOCK = 3;
// the UI graphics table's entries: the bars, the arrows, the name's letters, the title, its strip, the strip after a pick
const GFX_BARS = 0x27, GFX_ARROWS = 0x28, GFX_NAME = 0x29, GFX_STRIP = 0x2A, GFX_TITLE = 0x2B, GFX_STRIP_PICKED = 0x2C;
// where the name starts, by character (gUnknown_08688570), and how far it shakes as the row turns
const NAME_X = [25, 25, 24, 20];
const NAME_SHAKE = [-31, 27, -23, 19, -15, 11, -7, 3, -3, 7, -11, 15, -19, 23, -27, 31];
const ARROW_X = [16, 12, 8, 4, 8, 12, 0, 194, 198, 202, 206, 202, 198, 0];
// which character is in each place at the row's halfway point: turning right and turning left
const ROW_AFTER = [[0, 1, 3], [1, 2, 0]];
// the frames after a pick before the fade out starts (Task_805AAF8's array, 38 for each character)
const PICK_WAIT = 38, PICK_END = 0x38, BACK_CLEAR = 0x10;
const READY = 0x21;
const SINGLE_PLAYER = 0, TIME_ATTACK = 1;   // gGameMode
const PARTNER_READY = 8, NO_CODE = 0xFF;
// CheckCPUPartnerUnlock's keys, after Up on Sonic
const PARTNER_KEYS = [KEY.RIGHT, KEY.DOWN, KEY.RIGHT, KEY.L, KEY.RIGHT, KEY.R, KEY.RIGHT, KEY.A, 0, 0];
const TEXT_ROW = ' !"#$%&\'', STRIP_ROW = TEXT_ROW.repeat(3), STRIP_PICKED_ROW = ' !'.repeat(12);
const TITLE_ROW = ' '.repeat(8), BAR_TOP = '!'.repeat(8), BAR_BOTTOM = ' '.repeat(8);
const s8 = v => (v << 24) >> 24, s16 = v => (v << 16) >> 16;
const div = (a, b) => Math.trunc(a / b);   // the BIOS division the original calls (Div)
const win = (a, b) => (a << 8) | b;

const nothing = () => {};
// a line of text (GameOverB), one glyph after another in slot `unk10`
const line = (unkA, unkC, unkE, unk10, unk12, unk8) => ({ unkA, unkC, unkE, unk10, unk12, unk16: 1, unk8 });

/**
 * CreateCharacterSelectionScreen. `ctx` has the engine, the sprite tables, the save, the ROM's offsets (`uiGraphics`)
 * and what leads on from it: `toCourseSelect()`, `play()`, and `character` and `partner` set to what's chosen. `selected`
 * is the character the row starts on.
 */
export function createCharacterSelect(ctx, selected = 0) {
  const e = ctx.engine, gfx = id => uiGraphics(e.rom, ctx.offsets.uiGraphics, id);
  const shared = { engine: e, offsets: ctx.offsets };
  createUiTask(e);
  uiGfxStackInit(e);
  e.dispCnt = 0x1240;
  e.bgCnt[1] = 0x1907;
  e.bgScroll.fill(0, 2, 6);

  const screen = {
    ctx, fade: createFade(0, 0, 2, 0, 0x200, 1),
    turn: s16(0x2000 + ((selected & 3) << 8)),   // unk28: the row's angle, a quarter of a turn every 0x100
    shown: 0x20 + (selected & 3), wanted: 0x20 + (selected & 3),   // unk2A, unk2B
    turning: 0, wasTurning: 0, turnFrames: 0,   // unk2C (1 to the right, 2 to the left), unk2D, unk2E
    frames: 0, code: NO_CODE,   // unk24, unk39
  };
  e.createTask(fadeIn, screen, 0x2000);
  screen.name = e.createTask(nothing, { ...shared, o: line(0, 0x54, 6, 2, 0, 0x14), frames: 0, angle: 0, shake: 0 }, 0x2030);
  screen.bars = e.createTask(nothing, { ...shared, o: line(0x100, 0x40, 8, 0, 0xF, 0x5A), frames: 0, angle: screen.turn & 0xFFFF, shake: screen.turn }, 0x2030);
  screen.arrows = e.createTask(nothing, { ...shared, o: line(0x100, 0x28, 1, 1, 0, 0), frames: 0 }, 0x2040);
  screen.title = e.createTask(nothing, {
    ...shared, o: line(0, 0x38, 8, 3, 0, 0x78), strip: line(0x118, 0x3A, 9, 4, 0, 0x64),
    frames: 0, cursor: 0, x: 0x4600, speed: 0,   // unk38, unk30, unk3C, unk40
  }, 0x2030);

  const backdrop = createSprite({ graphics: { src: 0, dest: 0x4040, size: 0, anim: ANIM_BACKDROP }, frameFlags: 0x8000, prevVariant: 0xFF, animSpeed: 0x10 });
  screen.backdrop = e.createTask(showBackdrop, { s: backdrop, angle: 0, ctx }, 0x2020);
  updateSprite(e, ctx.sprites, backdrop, true);
  displaySpriteBackground(e, ctx.sprites, backdrop);

  const load = (id, slot, tiles, tilesSize, vram, unk2A, palette, paletteSize = 0x20, unk28 = 0) => {
    const g = gfx(id);
    loadUiGfx(e, { tiles: g.tiles + tiles, tilesSize, palette: g.palette + palette, paletteSize, unk28, vramC: OBJ_VRAM + vram, unk2A, unk2B: slot, unk0: g.unk0 });
  };
  load(GFX_BARS, 0, 0, 0x400, 0x20, 0xD, (selected & 3) * 6, 8, 0xF);
  load(GFX_ARROWS, 1, 0, 0x400, 0x420, 0xD, 0);
  load(GFX_NAME, 2, (selected & 3) * 0xC00, 0xC00, 0x1120, 9, 0);
  load(GFX_TITLE, 3, 0, 0x100, 0x820, 9, 0);
  load(GFX_STRIP, 4, 0, 0x800, 0x920, 9, 0);

  const character = (dest, x, variant, oamFlags = 0x7C0, anim = ANIM_CHARACTERS) => createSprite({
    graphics: { src: 0, dest: OBJ_VRAM + dest, size: 0, anim }, x, y: 110, oamFlags, prevVariant: 0xFF, animSpeed: 0x10, variant,
  });
  const sprites = [];
  sprites[MIDDLE] = character(0x2520, 280, 0);
  sprites[LEFT] = character(0x3920, -50, 6);
  sprites[RIGHT] = character(0x4D20, 290, 2);
  sprites[BLOCK] = character(0x6120, 290, 0, 0x700, ANIM_BLOCK);
  updateSprite(e, ctx.sprites, sprites[BLOCK]);
  screen.characters = e.createTask(nothing, { ctx, sprites, frames: 0, angle: 0, turning: 0 }, 0x2010);

  e.mapFill[1].value = 0;
  e.mapFill[1].rect.set([0, 0, 0xFF, 0x20]);
  e.playSongOrContinue(SONG.CHARACTER_SELECTION);   // m4aSongNumStartOrContinue: nothing plays as the main menu leaves, and the song of the Time Attack menu goes on
  fadeStep(e, screen.fade);
}

// the characters' sprites, as a frame of the row shows them
function showCharacters(e, tables, sprites) {
  for (const i of [LEFT, MIDDLE, RIGHT]) {
    updateSprite(e, tables, sprites[i]);
    displaySprite(e, tables, sprites[i]);
  }
}

// Task_8059F9C: once it has faded in, the two windows at the sides that the blend makes darker, and everything starts
function fadeIn(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if (!fadeStep(e, screen.fade)) return;
  screen.fade = createFade(0, 1, 1, 0, 0x200, 1);
  e.dispCnt |= 0x6000;
  e.winRegs[0] = win(0, 40);
  e.winRegs[2] = win(0, 240);
  e.winRegs[1] = win(200, 240);
  e.winRegs[3] = win(0, 240);
  e.winRegs[4] = 0x3F3F;
  e.winRegs[5] = 0x1F;
  e.bldCnt = 0x1290;
  e.bldAlpha = 0x10;
  e.bldY = 8;
  screen.characters.main = charactersIn;
  screen.bars.main = barsIn;
  screen.arrows.main = showArrows;
  screen.name.main = nameIn;
  screen.title.main = titleIn;
  t.main = choose;
}

// CheckCPUPartnerUnlock
function watchCode(screen, pressed) {
  if (!pressed) return;
  if (pressed & KEY.UP && ((screen.turn & 0x300) >> 8) === 0) { screen.code = 0; return; }
  if (screen.code === NO_CODE) return;
  screen.code = pressed & PARTNER_KEYS[screen.code] ? screen.code + 1 : NO_CODE;
}

// Task_805A060, as one player has it
function choose(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  let wanted = screen.wanted;
  const ready = screen.frames >>> 0 > READY;
  const startTurn = way => {
    if (screen.turning) return;
    screen.turning = way;
    screen.turnFrames = 0x10;
    e.playSong(SONG.SHIFT);
  };
  watchCode(screen, e.pressed);
  if (e.repeated & KEY.B && ready && wanted === screen.shown) {
    e.playSong(SONG.RETURN);
    // sub_805B858
    screen.frames = 0;
    e.bldY = 0;
    t.main = goBack;
  } else if (e.repeated & KEY.A && wanted === screen.shown && ready) {
    e.playSong(SONG.SELECT);
    pick(t);
  } else if (e.repeated & KEY.LEFT && ready) {
    wanted--;
    startTurn(2);
  } else if (e.repeated & KEY.RIGHT && ready) {
    wanted++;
    startTurn(1);
  } else if (wanted > screen.shown) startTurn(1);
  else if (wanted < screen.shown) startTurn(2);

  screen.wasTurning = screen.turning;
  if (screen.turning && screen.turnFrames) {
    screen.turn = s16(screen.turn + (screen.turning & 1 ? 0x10 : -0x10));
    if (--screen.turnFrames === 0) screen.turning = 0;
  }
  screen.turn &= 0x3FFF;
  screen.wanted = s8(wanted & 0x3F);
  if (screen.shown <= screen.wanted) screen.shown = s8(screen.turn >> 8);
  else screen.shown = s8((screen.turn >> 8) + (screen.turn & 0xFF ? 1 : 0));
  screen.shown &= 0x3F;
  if (screen.shown > 0x24 && screen.wanted > 0x24 && screen.turn > 0x2400) {
    while (screen.shown > 0x24) screen.shown -= 4;
    while (screen.wanted > 0x24) screen.wanted -= 4;
    while (screen.turn > 0x2400) screen.turn -= 0x400;
  } else if (screen.shown < 0x1C && screen.wanted < 0x1C && screen.turn < 0x1C00) {
    while (screen.shown < 0x1C) screen.shown += 4;
    while (screen.wanted < 0x1C) screen.wanted += 4;
    while (screen.turn < 0x1C00) screen.turn += 0x400;
  }
  const angle = screen.turn & 0x3FF;
  screen.name.data.angle = angle;
  screen.bars.data.angle = angle;
  screen.characters.data.angle = angle;
  screen.characters.data.turning = screen.turning;
  if (screen.backdrop.data) screen.backdrop.data.angle = angle;   // gone after a pick
  screen.title.data.frames = ++screen.frames;
}

// sub_805A9A4: the character is picked. Its pose takes the middle, the arrows and the backdrop's task go, and the strip
// changes to the picked one's
function pick(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.picked = (screen.turn & 0x300) >> 8;
  screen.characters.data.sprites[MIDDLE].variant = ((screen.turn & 0x300) >> 7) + 1;
  screen.title.main = titlePicked;
  screen.characters.main = charactersLeave;
  screen.name.main = namePicked;
  screen.bars.main = barsPicked;
  e.destroyTask(screen.arrows);
  e.destroyTask(screen.backdrop);
  screen.frames = 0;
  screen.title.data.speed = 0xB4;
  e.bldY = 0;
  const g = uiGraphics(e.rom, ctx.offsets.uiGraphics, GFX_STRIP_PICKED);
  loadUiGfx(e, { tiles: g.tiles, tilesSize: 0x200, palette: g.palette, paletteSize: 0x20, unk28: 0, vramC: OBJ_VRAM + 0x920, unk2A: 9, unk2B: 4, unk0: g.unk0 });
  t.main = leave;
}

// Task_805AAF8: after a while the screen fades to black, and then the act, or the course select. The code's last key brings
// the partner
function leave(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if (++screen.frames > PICK_END) {
    // the code's partner is for the single-player game only (gGameMode)
    const partner = ctx.gameMode === SINGLE_PLAYER && screen.code === PARTNER_READY;
    e.destroyTask(screen.name);
    e.destroyTask(screen.bars);
    e.destroyTask(screen.characters);
    e.destroyTask(screen.title);
    if (partner) e.playSong(SONG.RING);
    ctx.character = screen.picked;
    ctx.partner = partner;
    if (ctx.toCourseSelect()) {
      e.destroyTask(t);
      e.dispCnt &= 0xFFF;
      e.bldCnt = 0;
      e.bldY = 0;
      createCourseSelect(ctx);
      return;
    }
    // Loading the act takes the GBA (mGBA) past the next V-blank, so it starts a frame later, and the windows and the
    // blend the original turns off here never reach the screen, which stays black.
    t.main = () => { e.destroyTask(t); ctx.play(); };
  } else if (screen.frames > PICK_WAIT) fadeStep(e, screen.fade);
}

// Task_805AC00: B fades it out, the tasks ending partway through with the layers' maps cleared, and the main menu comes
function goBack(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.frames++;
  screen.fade.unk8 = 0x180;
  screen.fade.unkA = 0x10;
  if (fadeStep(e, screen.fade)) {
    e.stopSong(SONG.CHARACTER_SELECTION);
    e.dispCnt &= 0xFFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.destroyTask(t);
    if (ctx.gameMode === TIME_ATTACK) createTimeAttackMenu(ctx);
    else createMainMenu(ctx, true);
  } else if (screen.frames === BACK_CLEAR) {
    for (const task of [screen.name, screen.bars, screen.characters, screen.title, screen.arrows, screen.backdrop]) e.destroyTask(task);
    for (const bg of [0, 1, 2]) {
      e.mapFill[bg].value = 0;
      e.mapFill[bg].rect.set([0, 0, 0xFF, 0x14]);
    }
  }
}

// Task_805ACD8: the title comes in from the right and drops to its place, its strip scrolling under it
function titleIn(t) {
  const d = t.data, f = s16(d.frames);
  if (f > 0x20) {
    d.o.unkC = 6;
    d.frames = 0;
    d.x -= 0xB4;
    t.main = titleStays;
  } else if (f > 0xC) {
    const i = f - 0xD;
    d.o.unkC = (0x38 - (SINE[i * (div(i, 10) + 0x11)] >> 8)) & 0xFFFF;
    d.x -= 0xB4;
  } else if (f > 9) {
    d.o.unkA = 0;
    d.x -= 0xB4;
  } else {
    d.o.unkA = 0x100 - div(f << 8, 10);
    d.x -= 0x640;
  }
  const e = d.engine;
  drawUiText(e, glyphs(TITLE_ROW), d.o);
  d.strip.unkE = d.x > 0 ? (9 - div(d.x >> 6, 32)) & 0xFFFF : 9;
  if (d.x > 0x3C00) d.strip.unkE = 0;
  if (d.x < -1984) {
    d.x += 0x800;
    d.cursor = (d.cursor + 1) & 7;
  }
  d.strip.unkA = (d.x >> 6) & 0xFFFF;
  d.strip.unkC = d.o.unkC;
  drawUiText(e, glyphs(STRIP_ROW, d.cursor), d.strip);
}

// sub_805ADF0: the title in its place
function titleStays(t) {
  const d = t.data, e = d.engine;
  d.o.unkA = 0;
  drawUiText(e, glyphs(TITLE_ROW), d.o);
  d.strip.unkC = 6;
  d.x -= 0xB4;
  d.strip.unkE = d.x > 0 ? (9 - div(d.x >> 6, 32)) & 0xFFFF : 9;
  if (d.x < -1984) {
    d.x += 0x800;
    d.cursor = (d.cursor + 1) & 7;
  }
  d.strip.unkA = (d.x >> 6) & 0xFFFF;
  drawUiText(e, glyphs(STRIP_ROW, d.cursor), d.strip);
}

// Task_805AE84: after a pick, solid, its strip coming to a stop
function titlePicked(t) {
  const d = t.data, e = d.engine;
  d.o.unkA = 0;
  drawUiGlyphs(e, glyphs(TITLE_ROW), d.o);
  d.strip.unkC = 6;
  d.x -= d.speed;
  for (let i = 0; i < 3; i++) if (d.speed) d.speed--;
  if (d.x < -1984) {
    d.x += 0x800;
    d.cursor = (d.cursor + 1) & 7;
  }
  d.strip.unkA = (d.x >> 6) & 0xFFFF;
  drawUiGlyphs(e, glyphs(STRIP_PICKED_ROW, d.cursor), d.strip);
}

// Task_805AF24: the name comes in from the right and slides up to its place
function nameIn(t) {
  const d = t.data, e = d.engine, f = ++d.frames;
  if (f > 0x21) {
    d.o.unkC = 0x84;
    d.frames = 0;
    t.main = nameShows;
  } else if (f > 13) d.o.unkC = (SINE[(div(f * 103, 110) - 10) * 17] >> 8) + 0x54;
  else if (f > 0xA) d.o.unkA = NAME_X[0];
  else d.o.unkA = 0x100 - div(f << 8, 0xA) + NAME_X[0];
  drawUiText(e, glyphs(TEXT_ROW), d.o);
}

// sub_805AFC4: the name of the character in the middle, which shakes as the row turns, and changes halfway through
function nameShows(t) {
  const d = t.data, e = d.engine, low = d.angle % 256;
  if (low !== 0) {
    let who = (d.angle & 0x300) >> 8;
    const shake = low < 0x7F ? (0x7F - low) >> 1 : (low - 0x7F) >> 1;
    if (d.shake === 0) {
      who = (who + (low > 128 ? 1 : 0)) & 3;
      uiGfxStackInit(e);
      const g = uiGraphics(e.rom, d.offsets.uiGraphics, GFX_NAME);
      loadUiGfx(e, { tiles: g.tiles + who * 0xC00, tilesSize: 0xC00, palette: g.palette, vramC: OBJ_VRAM + 0x1120, unk2A: 9, unk2B: 2, unk0: g.unk0 });
    }
    d.shake = shake;
    d.o.unkA = (NAME_X[who] + NAME_SHAKE[low >> 4]) & 0xFFFF;
  } else d.o.unkA = NAME_X[(d.angle & 0x300) >> 8];
  drawUiText(e, glyphs(TEXT_ROW), d.o);
}

// Task_805B880: after a pick, solid
function namePicked(t) {
  const d = t.data, e = d.engine;
  d.frames++;
  drawUiGlyphs(e, glyphs(TEXT_ROW), d.o);
  d.o.unkA = NAME_X[(d.angle & 0x300) >> 8];
}

// Task_805B11C: the arrows: they meet from the sides, then bob
function showArrows(t) {
  const d = t.data, e = d.engine, was = d.frames, now = ++d.frames;
  if (now > 0x26) {
    if (now > 0x62) d.frames = was - 0x3B;
    const at = div(now % 0x3C, 10);
    d.o.unkA = ARROW_X[at];
    drawUiText(e, glyphs(' '), d.o);
    d.o.unkA = ARROW_X[7 + at];
    drawUiText(e, glyphs('!'), d.o);
  } else if (now > 30) {
    d.o.unkA = s16((was - 0x1D) * 6 - 0x24);
    drawUiText(e, glyphs(' '), d.o);
    d.o.unkA = s16(0xF0 - (now - 0x1E) * 6);
    drawUiText(e, glyphs('!'), d.o);
  }
}

// Task_805B1E0: the characters come in from the sides, the window at the right opening as they do
function charactersIn(t) {
  const d = t.data, { ctx, sprites } = d, e = ctx.engine, who = (d.angle & 0x300) >> 8;
  const was = d.frames++;
  if (d.frames > 0x11) {
    const f = was - 0x10;
    sprites[MIDDLE].x = 256 - div(f << 7, 11);
    sprites[RIGHT].x = 284 - div(f << 5, 11);
    sprites[LEFT].x = div(f << 5, 11) - 32;
    sprites[MIDDLE].y = 110;
    e.winRegs[1] = f <= 4 ? win(240, 240) : ((240 - (was - 0x15) * 5) << 8) + 240;
  }
  if (d.frames > 28) {
    d.frames = 0;
    e.winRegs[1] = win(200, 240);
    t.main = turnCharacters;
  }
  sprites[MIDDLE].variant = who * 2;
  sprites[RIGHT].variant = ((who + 1) & 3) * 2;
  sprites[LEFT].variant = ((who + 3) & 3) * 2;
  showCharacters(e, ctx.sprites, sprites);
}

// sub_805B324: the row turning: out of the screen on one side, in on the other, in eight frames of the turn's sixteen
function turnCharacters(t) {
  const d = t.data, { ctx, sprites } = d, e = ctx.engine, who = (d.angle & 0x300) >> 8;
  let step = (d.angle & 0xFF) >> 4;
  if (d.turning === 0) {
    sprites[LEFT].x = -8;
    sprites[MIDDLE].x = 120;
    sprites[RIGHT].x = 248;
  } else {
    const right = d.turning & 1, way = right ? -1 : 1;
    if (!right) step = 0x10 - step;
    const after = ROW_AFTER[right];
    if (step === 4) {
      sprites[MIDDLE].variant = ((after[0] + who) & 3) * 2;
      sprites[RIGHT].variant = ((after[1] + who) & 3) * 2;
      sprites[LEFT].variant = ((after[2] + who) & 3) * 2;
      for (const i of [LEFT, MIDDLE, RIGHT]) sprites[i].x -= way * 128;
    }
    if (step <= 8) for (const i of [LEFT, MIDDLE, RIGHT]) sprites[i].x += way * 16;
  }
  showCharacters(e, ctx.sprites, sprites);
}

// Task_805B8C0: after a pick, the two at the sides leave
function charactersLeave(t) {
  const d = t.data, { ctx, sprites } = d;
  if (d.frames < 5) {
    sprites[LEFT].x -= 0x14;
    sprites[RIGHT].x += 0x14;
  }
  d.frames++;
  showCharacters(ctx.engine, ctx.sprites, sprites);
}

function drawBars(t, draw) {
  const d = t.data;
  draw(d.engine, glyphs(BAR_TOP), d.o);
  d.o.unkC += 0x20;
  draw(d.engine, glyphs(BAR_BOTTOM), d.o);
  d.o.unkC -= 0x20;
}

// the colours of the character in the middle, for the bars
function loadBarColours(d, who) {
  const g = uiGraphics(d.engine.rom, d.offsets.uiGraphics, GFX_BARS);
  loadUiGfx(d.engine, { palette: g.palette + who * 6, paletteSize: 8, unk28: 0xF, vramC: OBJ_VRAM + 0x20, unk2A: 0xC, unk2B: 0, unk0: g.unk0 });
}

// Task_805B52C: the two bars come in from the right and slide up to their place
function barsIn(t) {
  const d = t.data, f = ++d.frames;
  if (f > 0x21) {
    d.frames = 0;
    d.o.unkC = 0x70;
    t.main = barsShow;
  } else if (f > 0xD) d.o.unkC = (SINE[(div(f * 0x67, 0x6E) - 0xA) * 0x11] >> 8) + 0x40;
  else if (f > 0xA) d.o.unkA = 0;
  else {
    d.o.unkA = (0x100 - div(f << 8, 0xA)) & 0xFFFF;
    if (f === 1) loadBarColours(d, (d.angle & 0x300) >> 8);
  }
  drawBars(t, drawUiText);
}

// sub_805B694: the bars close up as the row turns, and take the new character's colours halfway through
function barsShow(t) {
  const d = t.data, low = d.angle & 0xFF;
  d.o.unkA = 0;
  if (low !== 0) {
    const shake = (low < 0x7F ? 0x7F - low : low - 0x7F) >> 1;
    d.o.unkC = 168 - shake;
    if (d.shake === 0) loadBarColours(d, (((d.angle & 0x300) >> 8) + (low > 0x80 ? 1 : 0)) & 3);
    d.shake = shake;
  } else d.o.unkC = 0x70;
  if (d.o.unkC < 0x70) d.o.unkC = 0x70;
  drawBars(t, drawUiText);
}

// Task_805B930: after a pick, solid
function barsPicked(t) {
  const d = t.data;
  d.frames++;
  d.o.unkA = 0;
  drawBars(t, drawUiGlyphs);
}

// Task_805B984: the backdrop's frame for how far the row has turned, its tiles copied anew each frame
function showBackdrop(t) {
  const { s, angle, ctx } = t.data, e = ctx.engine;
  s.prevVariant = 0xFF;
  s.graphics.anim = ANIM_BACKDROP;
  s.variant = BACKDROP_VARIANTS[(angle & 0xFF) >> 6];
  updateSprite(e, ctx.sprites, s, true);
  displaySpriteBackground(e, ctx.sprites, s);
}
