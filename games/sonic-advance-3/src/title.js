// The title screen (CreateTitleScreen, from 0x08089ED4), which comes after the intro, or after Start skips it. The screen
// goes black for a frame, then "Sonic Advance" fades in from white over a ring of squares that moves in from the left,
// the "3" drops onto it from a size four times its own and shakes it, a flash of white shows the whole logo with the
// announcer's voice, and "Press Start" blinks under it with the copyright lines along the bottom. Start makes the
// button flash for 25 frames, fades to black and leaves for the main menu, which isn't ported yet, so for now the game goes
// straight to Route 99's overworld.
// Not ported yet: R changing the colour setting, and the demo that plays after ten seconds with nothing pressed.

import { KEY, FLAGS } from './core.js';
import { createSprite, updateSprite, displaySprite } from './sprite.js';
import { drawBackground } from './background.js';
import { SINE } from './stage/trig.js';
import { startStage } from './stage/stage.js';
import { REG } from '../../../kit/gba/video.js';

const OBJ_VRAM = 0x10000;
const MUS_TITLE_SCREEN = 1, SE_SELECT = 0x6A, ANNOUNCER = 0x1F4;
const JAPANESE = 0;
// the fade the screen comes in with: from white (2), from the colours the screen had (0), or none (1)
const FADE_FROM_COLOURS = 0, NO_FADE = 1, FADE_IN = 2, FADING = 3;
// the tables of this screen in the ROM (0x0808A050 and the functions after it load them): each sprite's animation, variant
// and tiles by language (and by colour setting for the corner one), the layers' tilemaps four to a language, the alpha
// each step of the "3"'s landing blends with, and how far each of the shake's ten frames moves the logo
const PRESS_START = 0xD650C, COPYRIGHT = 0xD653C, CORNER = 0xD64CC, TILEMAPS = 0xD6544, ALPHAS = 0xD6554, SHAKE_X = 0xD65C0, SHAKE_Y = 0xD65CA;
const SHAKE_FRAMES = 10;
// the tilemap of the ring of squares, by its number
const RINGS = 292;
// from the start of the screen to the first fade, the 3's size as it lands and the one it ends on, in 1/256ths
const FIRST_SCALE = 0x40000, LAST_SCALE = 0x10000, LANDING_SPEED = 0x2000;
const PRESS_START_BLINK = 0x5A, PRESS_START_ON_AT = 0x1D, FLASH_BLINK = 7, FLASH_ON_AT = 1;
const WAIT_FOR_START = 25, ANNOUNCER_WAIT = 0x3C;
const s8 = v => (v << 24) >> 24;
const s16 = v => (v << 16) >> 16;
const u16 = v => v & 0xFFFF;
const index = s => (s.language === JAPANESE ? 0 : 1);

/**
 * 0x0808AAC4, sub_808ADF0: the way to the title screen from another one, with `fade` as it is made: the tasks end, the
 * screen's colour is set to black and a task that waits a frame, then makes the screen (0x08001D58).
 */
export function leaveForTheTitle(c, fade = FADE_IN) {
  c.tasks.length = 0;
  c.dispCnt &= 0xFF;
  c.bgPalette[0] = 0;
  c.flags |= FLAGS.UPDATE_BG_PALETTES;
  c.createTask(blackFrame, { c, fade }, 0x1000);
}

// 0x08000918: a frame with the screen black and every layer off, between one screen and the next
function blackFrame(t) {
  const { c } = t.data;
  c.dispCnt = 0x40;
  c.bgCnt.set([0x700, 0xF04, 0x1708, 0x1F0C]);
  c.bldCnt = 0;
  c.bldAlpha = 0;
  c.bldY = 0;
  t.main = makeTheScreen;
}

// 0x08001FB0: the next frame makes the screen, and ends
function makeTheScreen(t) {
  const { c, fade } = t.data;
  c.destroyTask(t);
  createTitleScreen(c, fade);
}

/** 0x08089ED4, CreateTitleScreen. */
export function createTitleScreen(c, fade) {
  c.dispCnt = 0x1041;
  const s = {
    c, fade, language: c.save.language, qUnkE: fade === FADE_IN ? 0x40 : 0x100,
    unk1: 0, unk4: 0xB4, unk6: 0, unk8: 0, unkA: 0, unk10: 0, unk1E: 0x1E, unk24: 0,
    x: 0x7800, y: 0x6400, cornerX: 0xF000, cornerY: 0x700, copyrightX: 0, copyrightY: 0x8200,
    tiles: OBJ_VRAM,
  };
  const t = c.createTask(withFade, s, 0x100);
  if (fade === FADE_FROM_COLOURS || fade === FADE_IN) c.bldCnt = 0x3FBF;
  else if (fade === NO_FADE) c.bldCnt = 0x3FFF;
  c.bldY = 0xF;
  // the intro's H-blank copies end, so the V-blank copies layer 2's registers again, which are the identity until the
  // screen's first frame sets them
  c.bgAffine = { pa: 0x100, pb: 0, pc: 0, pd: 0x100, x: 0, y: 0 };
  // the first 0x40 bytes of layer 2's tiles cleared, and the maps of layers 0 to 2
  const at = ((c.bgCnt[2] >> 2) & 3) << 14;
  c.video.vram.fill(0, at, at + 0x40);
  for (let bg = 0; bg < 3; bg++) {
    c.mapFill[bg].value = 0;
    c.mapFill[bg].rect.set([0, 0, 0xFF, 0x20]);
  }
  layers(c, s);
  sprites(c, s);
  c.playSong(MUS_TITLE_SCREEN);
  return t;
}

// 0x0808A3D8: the three sprites, one after the other in the tiles: "Press Start", the copyright lines and the corner's
function sprites(c, s) {
  const { rom } = c;
  const make = (at, x, y, count) => {
    const sprite = createSprite({ tiles: s.tiles, anim: rom.u16(at), variant: rom.u8(at + 2), x: x >> 8, y: y >> 8, oamFlags: 0, palId: 0, frameFlags: 0x1000 });
    s.tiles += count * 32;
    updateSprite(c, sprite);
    return sprite;
  };
  const press = PRESS_START + s.language * 8;
  s.pressStart = make(press, s.x, s.y, rom.u32(press + 4));
  s.copyright = make(COPYRIGHT, s.copyrightX, s.copyrightY, rom.u32(COPYRIGHT + 4));
  s.corner = make(CORNER + index(s) * 0x20, s.cornerX, s.cornerY, 14);
}

// 0x0808A4EC: the ring of squares, the logo, and the "3" on a rotating layer
function layers(c, s) {
  const { rom } = c, tilemap = k => rom.u16(TILEMAPS + (index(s) * 4 + k) * 2);
  c.dispCnt |= 0x100;
  c.bgCnt[0] = 0x1783;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  drawBackground(c, { id: RINGS, dest: 0, layoutVram: 0xB800, targetTilesX: 30, targetTilesY: 20, flags: 4 | 0 });
  c.dispCnt |= 0x200;
  c.bgCnt[1] = 0x1F8A;
  c.bgScroll[2] = -20;
  c.bgScroll[3] = -8;
  drawBackground(c, { id: tilemap(0), dest: 0x8000, layoutVram: 0xF800, targetTilesX: 25, targetTilesY: 10, flags: 4 | 1 });
  // layer 2 is the rotating one in mode 1
  c.dispCnt |= 0x400;
  c.bgCnt[2] = 0x5D8D;
  c.bgScroll[4] = 0;
  c.bgScroll[5] = 0;
  drawBackground(c, { id: tilemap(1), dest: 0xC000, layoutVram: 0xE800, targetTilesX: 8, targetTilesY: 10, flags: 4 | 2 });
}

// 0x080BE844 (sa2__sub_8003EE4): a rotating layer's registers for an angle, the map drawn at scaleX / 256 and scaleY / 256
// times its size, so that its point (x, y) shows at (cx, cy) on the screen
function transformBackground(c, angle, scaleX, scaleY, x, y, cx, cy) {
  const cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  const kx = s16(Math.trunc(0x10000 / scaleX)), ky = s16(Math.trunc(0x10000 / scaleY));
  const a = c.bgAffine;
  a.pa = s16((cos * kx) >> 8);
  a.pb = s16((sin * kx) >> 8);
  a.pc = s16(((-SINE[angle] >> 6) * ky) >> 8);
  a.pd = s16((cos * ky) >> 8);
  a.x = (a.pa * s16(-cx) + a.pb * s16(-cy) + x * 256) | 0;
  a.y = (a.pc * s16(-cx) + a.pd * s16(-cy) + y * 256) | 0;
}

// 0x0808AEA4, 0x0808AEC0: "Press Start" and the copyright lines, as they are this frame
function showPressStart(c, s) {
  s.pressStart.x = s.x >> 8;
  s.pressStart.y = s.y >> 8;
  displaySprite(c, s.pressStart);
}
function showCopyright(c, s) {
  s.copyright.x = s.copyrightX >> 8;
  s.copyright.y = s.copyrightY >> 8;
  displaySprite(c, s.copyright);
}
// 0x0808AEDC: the "3" at the size it has
function placeThree(c, s) {
  const scale = s.unk24 >> 8;
  transformBackground(c, 0, scale, scale, 0x20, 0x28, 0xB4, 0x30);
}

// 0x0808A2D4, Task_TitleScreenMainWithFade: the screen fading in from white, with the "3" large
function withFade(t) {
  const s = t.data, { c } = s;
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] = 0x22;
  c.winRegs[5] = 0;
  if (s.fade === FADE_FROM_COLOURS || s.fade === FADE_IN || s.fade === NO_FADE) {
    c.bldCnt = s.fade === NO_FADE ? 0x3FFF : 0x3FBF;
    c.bldY = 0x10;
    s.fade = FADING;
    s.unkA = 0x1000;
    s.unk24 = FIRST_SCALE;
  }
  placeThree(c, s);
  if (c.bldY) {
    c.bldY = s.unkA >> 8;
    s.unkA = u16(s.unkA - s.qUnkE);
    if (c.pressed & KEY.START) {
      c.bldY = 0;
      s.qUnkE = 0x100;
      t.main = fadeless;
    }
  } else {
    c.bldY = 0;
    if (s.qUnkE > 0xFF) t.main = idle;
    else {
      c.winRegs[4] = 0x26;
      c.bldCnt = 0x2244;
      s.unk10 = 0;
      c.bldAlpha = c.rom.u16(ALPHAS);
      t.main = landing;
    }
  }
}

// 0x0808A4CC, Task_808A854: the "3" coming down to its size as the alpha steps along, until both have finished
function landing(t) {
  const s = t.data, { c } = s;
  let done = 0;
  s.unk24 -= LANDING_SPEED;
  if (s.unk24 < LAST_SCALE) {
    s.unk24 = LAST_SCALE;
    done = 1;
  }
  if ((s.unk10 >> 8) > 0xF) {
    s.unk10 = 0x1000;
    done++;
  } else {
    s.unk10 += 0x100;
    if ((s.unk10 >> 8) > 0x10) {
      s.unk10 = 0x1000;
      done++;
    }
  }
  c.bldAlpha = c.rom.u16(ALPHAS + (s.unk10 >> 8) * 2);
  placeThree(c, s);
  if (done > 1) {
    s.unk1 = 0;
    t.main = shake;
  }
}

// 0x0808A55C, Task_808A8E4: the logo and the "3" moved together for ten frames
function shake(t) {
  const s = t.data, { c } = s, { rom } = c;
  const x = s8(rom.u8(SHAKE_X + s.unk1)), y = s8(rom.u8(SHAKE_Y + s.unk1));
  c.bgScroll[2] = u16(-20 - x);
  c.bgScroll[3] = u16(-8 - y);
  const scale = s16((s.unk24 << 8) >> 16);
  transformBackground(c, 0, scale, scale, 0x20, 0x28, s16(x + 0xB4), s16(y + 0x30));
  if (++s.unk1 > SHAKE_FRAMES - 1) {
    c.dispCnt |= 0x2000;
    c.winRegs[0] = 240;
    c.winRegs[2] = 160;
    c.winRegs[4] |= 0x26;
    c.bldCnt = 0x3FBF;
    c.bldY = 0;
    s.fade = FADING;
    s.unkA = 0;
    s.qUnkE = 0x200;
    t.main = flash;
  }
}

// 0x0808A650, Task_808A9D8: the screen goes white
function flash(t) {
  const s = t.data, { c } = s;
  placeThree(c, s);
  if (c.bldY <= 0xE) {
    c.bldY = s.unkA >> 8;
    s.unkA = u16(s.unkA + s.qUnkE);
    return;
  }
  c.bldY = 0xF;
  s.unkA = 0xF00;
  c.winRegs[4] |= 0x33;
  t.main = fadeless;
}

// 0x0808A6AC, Task_TitleScreenMainFadeless: the "3" layer goes, and the logo with the 3 in it takes the first layer's place
function fadeless(t) {
  const s = t.data, { c } = s;
  c.dispCnt &= ~0x400;
  c.dispCnt |= 0x200;
  c.bgCnt[1] = 0x1F8A;
  c.bgScroll[2] = u16(-0x14);
  c.bgScroll[3] = u16(-8);
  drawBackground(c, { id: c.rom.u16(TILEMAPS + (index(s) * 4 + 2) * 2), dest: 0x8000, layoutVram: 0xF800, targetTilesX: 25, targetTilesY: 10, flags: 5 });
  c.dispCnt |= 0x2000;
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x26;
  c.bldCnt = 0x3FBF;
  c.bldY = 0xF;
  s.unkA = 0xF00;
  c.winRegs[4] |= 0x33;
  t.main = announcer;
}

// 0x0808A7BC, Task_TitleAnnouncer: the white clearing, then the announcer says the name
function announcer(t) {
  const s = t.data, { c } = s;
  if (s.qUnkE > 0xFF) showCopyright(c, s);
  if (c.bldY === 0) {
    s.unk8 = ANNOUNCER_WAIT;
    s.fade = FADE_FROM_COLOURS;
    t.main = waitForTheName;
    c.playSong(ANNOUNCER);
    return;
  }
  c.bldY = s.unkA >> 8;
  s.unkA = u16(s.unkA - s.qUnkE);
  if (s.unkA > 0xF00) s.unkA = 0;
  if (c.pressed & KEY.START) {
    s.unk8 = ANNOUNCER_WAIT;
    s.fade = FADE_FROM_COLOURS;
    t.main = waitForTheName;
  }
}

// 0x0808A468, Task_808A7F0: a second with only the copyright lines, and the rest of a fade that Start cut short
function waitForTheName(t) {
  const s = t.data, { c } = s;
  showCopyright(c, s);
  if (s.fade === FADE_FROM_COLOURS && c.bldY !== 0) {
    c.bldY = s.unkA >> 8;
    s.unkA = u16(s.unkA - 0x100);
  }
  if (s.unk8 !== 0) {
    s.unk8 = u16(s.unk8 - 1);
    return;
  }
  t.main = idle;
}

// 0x0808A848, Task_808ABD0: the screen waiting, "Press Start" blinking
function idle(t) {
  const s = t.data, { c } = s;
  showCopyright(c, s);
  if (s16(s.unk1E) > PRESS_START_BLINK) s.unk1E = 0;
  if (s16(s.unk1E) > PRESS_START_ON_AT) showPressStart(c, s);
  showCopyright(c, s);
  if (c.pressed & KEY.START) {
    c.playSong(SE_SELECT);
    s.unk6 = WAIT_FOR_START;
    s.unk1E = 2;
    t.main = flashing;
    return;
  }
  if (s.unk4 <= 0xB3) {
    showCorner(c, s);
    s.unk4++;
  }
  s.unk6++;
  s.unk1E++;
}

// 0x0808A938, sub_808ACC0: the corner's sprite, which shows for the first 180 frames
function showCorner(c, s) {
  const sprite = s.corner;
  sprite.x = s.cornerX >> 8;
  sprite.y = s.cornerY >> 8;
  updateSprite(c, sprite);
  displaySprite(c, sprite);
}

// 0x0808AAC4, Task_808AE4C: "Press Start" flashing quickly once Start is pressed
function flashing(t) {
  const s = t.data, { c } = s;
  showCopyright(c, s);
  if (s16(s.unk1E) > FLASH_BLINK) s.unk1E = 0;
  if (s16(s.unk1E) > FLASH_ON_AT) showPressStart(c, s);
  s.unk6 = u16(s.unk6 - 1);
  s.unk1E = u16(s.unk1E + 1);
  if (s.unk6 === 0) {
    s.fade = FADE_FROM_COLOURS;
    t.main = fadeOut;
  }
}

// 0x0808A3E0, Task_808A768: the screen fades to white, and the main menu comes
function fadeOut(t) {
  const s = t.data, { c } = s;
  c.bldCnt = 0x3FFF;
  if (s.fade === FADE_FROM_COLOURS) {
    c.bldY = 0;
    s.fade = FADE_IN;
    s.unkA = 0;
  }
  if (s16(s.unk1E) > FLASH_BLINK) s.unk1E = 0;
  if (s16(s.unk1E) > FLASH_ON_AT) showPressStart(c, s);
  showCopyright(c, s);
  s.unk8 = u16(s.unk8 - 1);
  s.unk1E = u16(s.unk1E + 1);
  if (c.bldY < 0xF) {
    c.bldY = s.unkA >> 8;
    s.unkA = u16(s.unkA + 0x100);
  } else {
    c.destroyTask(t);
    // LaunchChaoMenu makes the menu's task, which first runs in the next frame, with the screen faded all the way, as the
    // menu starts
    c.bldY = 0x10;
    c.createTask(leaveForTheMainMenu, { c }, 0);
  }
}

// What comes next, the main menu (CreateMainMenu), isn't ported yet, so the game goes straight to Route 99's overworld.
function leaveForTheMainMenu(t) {
  const { c } = t.data;
  c.destroyTask(t);
  c.bgAffine = null;
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
  c.lineRegister = REG.BG0HOFS + 12;
  c.dispCnt = 0x80;
  c.bgCnt.fill(0);
  c.bgScroll.fill(0);
  c.winRegs.fill(0);
  c.bldCnt = 0;
  c.bldY = 0;
  startStage(c, 2);
}
