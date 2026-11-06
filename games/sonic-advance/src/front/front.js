// The game's start before the act, as Sonic Advance has it: the SEGA and Sonic Team logos, the intro, the title
// screen and the main menu, run on the GBA engine (gba/engine.js) at the GBA's own frame rate and drawn into the
// game's canvas. The act starts after the character select (charselect.js), which Game Start on the main menu opens, and
// once the character has progress the course select (courseselect.js) and the act chosen there.
//
// A new game, with no save yet, starts with the language screen (language.js), which writes the save; with a save,
// the game starts with the logos. The Options menu (options.js) changes the save and writes it.

import { createVideo, REG, SCREEN_W, SCREEN_H } from '../../../../kit/gba/video.js';
import { createEngine, KEY } from '../gba/engine.js';
import { spriteTables } from '../rom/sprites.js';
import { createSegaLogo } from './logos.js';
import { createLanguageScreen, hasLanguageScreen } from './language.js';
import { createIntro } from './intro.js';
import { createTitleScreen } from './title.js';
import { createCourseSelect } from './courseselect.js';
import { createTimeAttackLobby } from './timeattacklobby.js';
import { createClock, GBA_FRAME_MS } from '../../../../kit/gba/clock.js';

/**
 * The frames after power-on before the game starts: the GBA (mGBA) is still starting up, the screen white (forced
 * blank), and gFrameCount isn't counted yet (VBlankIntr, which counts it, starts with GameInit).
 */
export const STARTUP_FRAMES = 6;

// what the player holds (engine/input.js), as the GBA's buttons
// or, with `held`, a set of the game's button names (input.nextHeld), what it holds then
export function keysOf(input, held = null) {
  const has = name => (held ? held.has(name) : input[name]);
  return (has('jump') ? KEY.A : 0) | (has('attack') ? KEY.B : 0) | (has('start') ? KEY.START : 0) | (has('select') ? KEY.SELECT : 0)
    | (has('right') ? KEY.RIGHT : 0) | (has('left') ? KEY.LEFT : 0) | (has('up') ? KEY.UP : 0) | (has('down') ? KEY.DOWN : 0)
    | (has('r') ? KEY.R : 0) | (has('l') ? KEY.L : 0);
}

/**
 * The frames from the soft reset's V-blank to the first screen: the BIOS forces the screen blank at once, and the
 * game's start (EngineInit, GameInit) runs before the next frames show anything.
 */
export const RESET_FRAMES = 6;

/**
 * GameInit: the language screen when there is no save (a new game), else the logos, or, after a soft reset, which
 * sets FLAGS_SKIP_INTRO, the title screen with its music.
 */
export function powerOn(ctx, skipIntro = false) {
  if (!ctx.save.exists && hasLanguageScreen(ctx.offsets)) createLanguageScreen(ctx, true);
  else if (skipIntro) ctx.title(true);
  else createSegaLogo(ctx);
}

/**
 * Starts the front end on `canvas`, from power-on. `rom` is the ROM (rom.js), `offsets` where its tables are
 * (locate.js), `input` the player's buttons, `sound` the sound engine (audio.js) and `save` the save
 * (engine/save.js), which the language screen and the Options menu change. `play(level, frameCount, { character, partner })` is called
 * once the act is to start: `level` is the course select's choice, or undefined with no choice made, `frameCount` the
 * engine's gFrameCount, and the last what the character select chose. `character` is who the character select's row starts on, and `levels()` gives the level last played and the one
 * the course select last started, as { current, started }. Without `courseSelect`, as when the address names a level,
 * the character select goes straight to the act; without
 * `select`, a start point for the proof tools, Game Start goes where the character select would. A little before a demo
 * starts `prepareDemo()` is called, and as it starts `play`, with `demo` set in its last argument and its video memory in
 * `vram`. `back`, { title, lobby, frameCount, white, vram }, starts it as a demo leaves it,
 * with no start-up: at the title screen with its music if `title`, at the Time Attack lobby for `lobby` ({ character, level }), else at the SEGA logo, with gFrameCount at `frameCount` and video memory as the screens before left it.
 * `softReset()` is called when A, B, Start and Select are held together (VBlankIntr), and `afterReset` starts the
 * front end as the game starts again from that: the screen blank and then the title screen, with no logos.
 * Returns { stop, step, draw, setView }: setView(w, h) draws a widescreen view of w × h from then on (the
 * original 240 × 160 is the default); step() and draw() are for checking, a frame at a time.
 */
export function createFrontEnd(canvas, rom, offsets, input, sound, save, play, { character = 0, levels = () => ({ current: 0, started: 0 }), courseSelect = true, select = true, onGameStart, prepareDemo = () => {}, back = null, softReset, afterReset = false } = {}) {
  const video = createVideo();
  const engine = createEngine(video, rom, sound);
  video.write(REG.DISPCNT, 0x80);   // forced blank, until the game starts
  let done = false, resetting = false, chosen, demo = false, startingUp = back ? 0 : afterReset ? RESET_FRAMES : STARTUP_FRAMES;
  engine.onSoftReset = softReset && (() => { resetting = true; });
  const ctx = {
    engine, tilemaps: offsets.tilemaps, sprites: spriteTables(rom, offsets.spriteTables), offsets, save, character, partner: false, gameMode: 0, level: 0, levels, select,
    introGraphics: offsets.introGraphics, introTables: offsets.introTables,
    afterReset,
    intro: () => createIntro(ctx),
    title: playMusic => createTitleScreen(ctx, playMusic),
    play: level => { done = true; chosen = level; },
    startDemo: () => { done = true; demo = true; },
    prepareDemo,
    // Task_805AAF8: whether the act comes next, with nothing cleared yet, or the course select, which only the versions
    // with a known place for its picture have
    onGameStart,
    toCourseSelect: () => courseSelect && (ctx.gameMode === 1 || save.unlockedLevel(ctx.character) !== 0) && !!offsets.courseSelectBackground,
    startGame: () => { if (ctx.toCourseSelect()) createCourseSelect(ctx); else ctx.play(); },
  };

  if (back) {
    engine.frameCount = back.frameCount;
    if (back.vram) video.vram.set(back.vram);
    if (back.lobby) {
      // a Time Attack run is over: the lobby, for the character and the act that was played
      ctx.gameMode = 1;
      ctx.character = back.lobby.character;
      ctx.level = back.lobby.level;
      createTimeAttackLobby(ctx);
    } else if (back.title) ctx.title(true);
    else createSegaLogo(ctx);
  }

  const out = canvas.getContext('2d', { alpha: false });
  let image, pixels, view = null, drawn = false;
  // the size the screens are drawn at: the original screen, or a widescreen view around it (video.js)
  function setView(w = SCREEN_W, h = SCREEN_H) {
    if (image && w === image.width && h === image.height) return;
    canvas.width = w; canvas.height = h;
    image = out.createImageData(w, h);
    pixels = new Uint32Array(image.data.buffer);
    view = w === SCREEN_W && h === SCREEN_H ? null : { w, h };
    if (drawn) draw();   // at once, as resizing the canvas clears it
  }
  setView();
  // the frame a demo ends on makes the next screen, whose first picture is white, from the title screen's fade or the
  // demo's, or else black
  if (back) { out.fillStyle = back.white ? '#FFF' : '#000'; out.fillRect(0, 0, canvas.width, canvas.height); }

  function step() {
    input.poll?.();
    if (startingUp > 0) {
      if (--startingUp === 0) powerOn(ctx, afterReset);
      return;
    }
    engine.keys = keysOf(input);
    engine.nextKeys = keysOf(input, input.nextHeld());
    engine.run();
  }
  function draw() {
    engine.draw(pixels, null, view);
    out.putImageData(image, 0, 0);
    drawn = true;
  }

  // on the GBA's own frame rate, which the music keeps to (clock.js)
  let frame = 0;
  const clock = createClock(GBA_FRAME_MS);
  clock.reset();
  function loop(now) {
    let ran = false;
    for (let n = clock.steps(now); n > 0 && !done && !resetting; n--) { step(); ran = true; }
    if (resetting) { stop(); softReset(); return; }   // the frame the reset is in is drawn by the game that starts again
    if (ran) draw();   // a frame is drawn once, from the H-blank effects its V-blank set up
    if (done) {
      // what's still sounding plays on, as the original stops nothing here: the act's music takes the place of the screen's
      // a demo's act shows black until its first picture, which can take a moment to read from the ROM
      if (demo || chosen !== undefined) { out.fillStyle = '#000'; out.fillRect(0, 0, canvas.width, canvas.height); }
      if (chosen === undefined && !select && !demo) stop();
      else { cancelAnimationFrame(frame); input.release(); }
      play(chosen, engine.frameCount + 1, { character: ctx.character, partner: ctx.partner, demo, vram: video.vram, timeAttack: ctx.gameMode === 1 });
      return;
    }
    frame = requestAnimationFrame(loop);
  }
  function stop() { cancelAnimationFrame(frame); input.release(); sound.stopAll(); }

  input.enabled = true;
  if (afterReset) draw();   // the screen the BIOS blanked, white
  frame = requestAnimationFrame(loop);
  return { stop, step, draw, setView, engine };
}
