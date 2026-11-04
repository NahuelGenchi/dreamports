// The title screen's demos (SAT-R decompilation, src/game/shared/stage/demo_manager.c and src/input_recorder.c, and
// Task_SwitchToDemoInit in src/game/sa1/menus/title_screen.c). Left on the title screen for 900 frames, the game plays
// one of four acts by itself, in turn, from a list of presses in the ROM, with DEMO PLAY and a blinking PRESS START
// over it. After 1800 frames of the stage clock it fades to white and goes back to the SEGA logo; a real Start, held
// or pressed, does the same at once and goes back to the title screen with its music.

import { KEY } from '../../../../kit/gba/input.js';
import { lz10 } from '../rom/nds.js';
import { makeSprite, animate } from './objects.js';

// gUnknown_080BB323 and gUnknown_080BB327: Sonic in Neo Green Hill, Tails in Secret Base, Amy in Casino Paradise and
// Knuckles in Ice Mountain, each in act 1
export const DEMOS = [{ level: 0, character: 0 }, { level: 2, character: 1 }, { level: 4, character: 3 }, { level: 6, character: 2 }];

export const DEMO_MANAGER = 1;   // its task's priority, before all of the act's
const PLAYBACK_TIME = 1800;      // DEMO_PLAYBACK_TIME: TIME(0, 30)
const ORDER = 15, PRIO = 1;      // DEMO_OAM_ORDER, DEMO_SPRITE_PRIO
const CENTER_X = 120, CENTER_Y = 80;
const FADE_STEP = 0x40, FADE_END = 0x1000;   // Q(0.25) a frame, up to Q(16)
const WHITE_FRAMES = 48;
const PLAYERS = 4, FADE_SPEED = 4;           // m4aMPlayFadeOut on the music player and the three of the sound effects

/** gDemoRecordings[n] from the ROM's table at `table`: the buttons held on each frame, as KEY has them. */
export function readDemoTape(rom, table, n) {
  const bytes = lz10(rom.bytes, rom.requirePtr(table + n * 4, 'a demo\'s presses'));
  return new Uint16Array(bytes.buffer, 0, bytes.length >> 1);
}

/**
 * InputRecorderRead: the buttons the act reads while a demo plays, from `tape`, one frame's at each poll and none past
 * its end. `start` in what comes back is the tape's; `physical()` is what `buttons`, the player's own, hold now
 * (gPhysicalInput), of which only Start is read.
 */
export function createDemoInput(buttons, tape) {
  const { layout } = buttons;
  let head = -1;   // the act's first step is the frame that made it, which read its buttons before the tape was in
  const input = {
    layout,
    get enabled() { return buttons.enabled; },
    set enabled(on) { buttons.enabled = on; },
    physicalStart: () => buttons.start,
    release: () => buttons.release(),
    poll() {
      buttons.poll?.();
      const word = head >= 0 && head < tape.length ? tape[head] : 0;
      head++;
      for (const b of layout.buttons) {
        const down = !!(word & KEY[layout.gba[b]]);
        if (layout.edges.includes(b)) input[`${b}Pressed`] ||= down && !input[b];
        input[b] = down;
      }
    },
  };
  for (const b of layout.buttons) input[b] = false;
  for (const b of layout.edges) input[`${b}Pressed`] = false;
  return input;
}

/**
 * CreateDemoManager's task, with the act's `state`, `anims` and `sound`, the save's `language`, whether the act `snows`,
 * `physicalStart()` as createDemoInput has it, and `end(pressedStart)`, called as the white has lasted.
 */
export function createDemoManager({ state, anims, sound, language, snows, physicalStart, end }) {
  const pressStart = makeSprite(language === 0 ? 'demoPressStartJapanese' : 'demoPressStartEnglish', { order: ORDER, prio: PRIO });
  const demoPlay = makeSprite('demoPlay', { order: ORDER, prio: PRIO });
  animate(pressStart, anims);
  animate(demoPlay, anims);
  let blend = 0, white = 0, pressedStart = false, step = main, noFade = false, hadCard = false;
  // spotlights, which set the blend each frame after this task and clear it as they go, or the snow, which sets it each
  // frame, leave nothing of the fade to see, nor does a title card once it has ended, which clears it. A card holding
  // leaves it alone, and while the card fades it sets its own.
  const spoilsFade = () => snows || !!state.spotlights?.blend;

  function fadeOut() {
    state.effects2d = { fade: 0, overCard: true };
    noFade = spoilsFade();
    hadCard = !!state.card;
    sound.musicOff();
    for (let p = 0; p < PLAYERS; p++) sound.fadeOut?.(p, FADE_SPEED);
    step = fading;
  }
  // Task_DemoManagerMain
  function main(ctx) {
    if (physicalStart()) {
      ctx.player.ignoreInput = true;
      ctx.player.heldInput = null;
      if (state.spotlights) state.spotlights.destroy = true;   // gDestroySpotlights
      pressedStart = true;
      fadeOut();
    } else if (state.checkpointTime > PLAYBACK_TIME) fadeOut();
    // semi-transparent while the screen is faded, which keeps them out of the fade (and then in front of all but the
    // title card): the title card's fade or the spotlights', as the frame before left them
    const shown = state.checkpointTime & 0x20 ? [[pressStart, CENTER_Y + 33], [demoPlay, CENTER_Y]] : [[demoPlay, CENTER_Y]];
    if (state.card?.fade.bldY || state.spotlights?.blend?.bldY) {
      state.demoSign = shown.map(([s, y]) => ({ frame: s.frame, x: CENTER_X, y, flipX: false, flipY: false, order: s.order, prio: s.prio, screen: true }));
    } else for (const [s, y] of shown) ctx.drawOnScreen(s, CENTER_X, y);
  }
  // Task_DemoManagerFadeout
  function fading() {
    blend += FADE_STEP;
    noFade ||= spoilsFade() || (hadCard && !state.card);
    state.effects2d.fade = noFade || state.card?.fade.bldY ? 0 : blend >> 8;
    if (blend >= FADE_END) step = whiteOut;
  }
  // Task_DemoManagerEndFadeout
  function whiteOut() {
    if (++white >= WHITE_FRAMES) end(pressedStart);
  }
  return { run(ctx) { step(ctx); return true; } };
}
