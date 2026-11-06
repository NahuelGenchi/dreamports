// The Time Attack result (SAT-R decompilation, src/game/sa1/ui/time_attack_results.c: CreateTimeAttackResult and its
// task), put up over the act when Sonic reaches the goal: bands of the act's colours sliding in, the time of the run
// in the UI font, TIME, and, once the run is the best on the course, NEW RECORD with its own jingle. It lasts 330
// frames (600 with a record), the last 60 of them fading the screen out, and then the game goes on to the lobby.
//
// The original draws all this as sprites on top of the act, which the act's own engine here doesn't carry, so it
// runs in an engine of the front end's kind, drawn over the act's picture (video.underlay) and so given the same
// colour effects the screen has.

import { createVideo } from '../../../../kit/gba/video.js';
import { createEngine } from '../gba/engine.js';
import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { spriteTables } from '../rom/sprites.js';
import { createUiTask, uiGraphics, loadUiGfx, drawUiText, createFade, fadeStep } from './ui.js';
import { timeCodes } from './timeattackcard.js';

const OBJ_VRAM = 0x10000;
const UIGFX_TIMER_DIGITS = 32, UIGFX_BAND = 16, UIGFX_LEVEL_TEXT = 34, UIGFX_CHARACTER = 11;
// by the act's number: tiles of the level text's graphics to skip (the boss's, 80 tiles in, for the second act)
const BOSS_TEXT_TILES = 80, TILE_SIZE = 32;
// the animation of the two sprites (the USA ROM numbers it two lower than the decompilation's European one), with
// NEW RECORD and TIME as its variants
const ANIM_RESULT = 882, NEW_RECORD = 4, TIME = 3;
const SONG_NEW_RECORD = 0x131, SONG_RESULT = 0x132;
const FRAMES = 330, FADE_FROM = 270, RECORD_FRAMES = 600, RECORD_FADE_FROM = 540, SHOW_FROM = 60;
// the band's tiles and its pattern, in the glyphs of the level text's font
const PATTERN = [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x00];
const BLANK_BAND = () => 0x20;
const s16 = v => (v << 16) >> 16;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, ...fields });

// sub_8069994: the digits' tiles at `vram`, the band's, the level text's and the character's
function loadGraphics(ctx, vram) {
  const e = ctx.engine, rom = e.rom, table = ctx.offsets.uiGraphics;
  const load = (id, slot, fields) => {
    const gfx = uiGraphics(rom, table, id);
    loadUiGfx(e, { uiGfxID: id, unk2B: slot, unk0: gfx.unk0, tiles: gfx.tiles, palette: gfx.palette, unk2A: 13, ...fields });
  };
  load(UIGFX_TIMER_DIGITS, 15, { tilesSize: 0x580, paletteSize: 0x20, unk28: 6, vramC: vram });
  load(UIGFX_BAND, 16, { tilesSize: 0x200, paletteSize: 0x20, unk28: 12, vramC: OBJ_VRAM + 0x1000 });
  const text = uiGraphics(rom, table, UIGFX_LEVEL_TEXT);
  load(UIGFX_LEVEL_TEXT, 2, { tiles: text.tiles + (ctx.level & 1 ? BOSS_TEXT_TILES * TILE_SIZE : 0), tilesSize: 0xA00, paletteSize: 0x20, unk28: 11, vramC: OBJ_VRAM + 0x1800 });
  load(UIGFX_CHARACTER + ctx.character, 2, { tilesSize: 0x600, paletteSize: 0xC, unk28: 11, vramC: OBJ_VRAM + 0x1200 });
}

/**
 * CreateTimeAttackResult for a run of `record` frames on `ctx.level` as `ctx.character`; `ctx` has the engine, the
 * sprite tables, the save and the ROM's offsets. `done()` is called when the screen is over (GoToNextLevel).
 */
export function createTimeAttackResult(ctx, record, done) {
  const e = ctx.engine;
  createUiTask(e);
  const vram = e.vramMalloc(44);
  loadGraphics(ctx, vram);
  const best = ctx.save.registerTimeRecord(ctx.character, ctx.level, record);
  e.playSong(best ? SONG_NEW_RECORD : SONG_RESULT);
  const result = {
    ctx, vram, done, best, frame: 0, scroll: 0,   // unkBC, unkC0
    time: timeCodes(record),
    fade: createFade(0, 1, 1, 0, 0x100, 0x10),
    bands: { unk8: 0x18, unkA: 0xF0, unkC: 0x8C, unkE: 8, unk10: 0x10, unk12: 0xC, unk16: 1 },
    pattern: { unk8: 0, unkA: 0xF0, unkC: 0x8C, unkE: 9, unk10: 2, unk12: 0xB, unk16: 1 },
    digits: { unk8: 0, unkA: 0x50, unkC: 0x50, unkE: 7, unk10: 0xF, unk12: 6, unk16: 1 },
    record: sprite(ANIM_RESULT, e.vramMalloc(24), { variant: NEW_RECORD, x: 120, y: 120, oamFlags: 0, frameFlags: 0 }),
    label: sprite(ANIM_RESULT, e.vramMalloc(8), { variant: TIME, x: 40, y: 88, oamFlags: 0x480, frameFlags: 0x2000 }),
  };
  e.createTask(run, result, 0x2000, 0, destroyed);
  updateSprite(e, ctx.sprites, result.record);
  updateSprite(e, ctx.sprites, result.label);
}

// Task_8069E50
function run(t) {
  const result = t.data, { ctx } = result, e = ctx.engine;
  result.frame++;
  const [last, fadeFrom] = result.best ? [RECORD_FRAMES, RECORD_FADE_FROM] : [FRAMES, FADE_FROM];
  if (result.frame > last) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.destroyTask(t);
    result.done();
    return;
  }
  let fading = false;
  if (result.frame > fadeFrom) {
    fadeStep(e, result.fade);
    fading = true;
  }
  slide(result);
  show(result, fading);
}

// sub_8069FDC: the band comes in from the right, then drops up to its place
function slide(result) {
  const o = result.bands, frame = result.frame;
  if (frame > 30 && frame < 40) {
    o.unkC -= 0xC;
    if (o.unkC <= 0x13) o.unkC = 0x14;
  } else if (frame < 21 && frame > 10) {
    o.unkA -= 0x18;
    if (s16(o.unkA) < 0) o.unkA = 0;
  }
}

// sub_8069EE4: the sprites and the lines of text, semi-transparent (and so darkened with the rest) while it fades
function show(result, fading) {
  const { ctx } = result, e = ctx.engine, solid = !fading;
  if (result.frame > SHOW_FROM) {
    if (result.best) displaySprite(e, ctx.sprites, result.record);
    displaySprite(e, ctx.sprites, result.label);
    drawUiText(e, i => result.time[i], result.digits, solid);
  }
  const y = result.bands.unkC & 0xFFFF;
  drawUiText(e, BLANK_BAND, result.bands, solid);
  const o = result.pattern;
  o.unkC = y + 2;
  o.unkA = s16(o.unkA - 2);
  if (o.unkA < -0x1F) {
    o.unkA += 0x20;
    result.scroll = (result.scroll + 1) % 8;
  }
  drawUiText(e, i => PATTERN[result.scroll + i], o, solid);
}

// TaskDestructor_806A124
function destroyed(t) {
  const result = t.data, e = result.ctx.engine;
  e.vramFree(result.record.graphics.dest);
  e.vramFree(result.label.graphics.dest);
  e.vramFree(result.vram);
}

/**
 * The screen over the act: `step()` runs a frame of it, `draw(g, w, h)` draws it over the act's picture, which the 2D
 * context `g` of a canvas `w` × `h` (the original screen, or the widescreen view around it) holds. `save` has the
 * records; `done()` is called when the result is over.
 */
export function createTimeAttackOverlay({ rom, offsets, sound, save, character, level, record, done }) {
  const video = createVideo();
  const engine = createEngine(video, rom, sound);
  const ctx = { engine, sprites: spriteTables(rom, offsets.spriteTables), offsets, save, character, level };
  engine.dispCnt = 0x1840;   // sprites, in one dimension, over the act's picture (BG3's place)
  createTimeAttackResult(ctx, record, done);
  const pixels = new Uint32Array(240 * 160);
  const image = new ImageData(new Uint8ClampedArray(pixels.buffer), 240, 160);
  return {
    step() { engine.run(); },
    draw(g, w, h) {
      const ox = (w - 240) >> 1, oy = (h - 160) >> 1;
      const under = g.getImageData(ox, oy, 240, 160);
      video.underlay = new Uint32Array(under.data.buffer);
      engine.draw(pixels, null, null);
      g.putImageData(image, ox, oy);
      // the view around the screen is darkened as the screen is, by the brightness decrease that fades it out
      if (engine.bldY > 0 && (w > 240 || h > 160)) {
        g.fillStyle = `rgb(0 0 0 / ${engine.bldY / 16})`;
        for (const [x, y, rw, rh] of [[0, 0, w, oy], [0, oy + 160, w, h - oy - 160], [0, oy, ox, 160], [ox + 240, oy, w - ox - 240, 160]]) {
          if (rw > 0 && rh > 0) g.fillRect(x, y, rw, rh);
        }
      }
    },
  };
}
