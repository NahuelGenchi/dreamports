// Sonic Advance 3 Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on the Game Boy
// Advance kit (kit/gba/).

import '../../../kit/gba/canvas.js';
import { createRomSetup } from '../../../kit/gba/ui/rom-setup.js';
import { createRomStore } from '../../../kit/gba/rom/store.js';
import { Rom } from '../../../kit/gba/rom/rom.js';
import { identify, namesGame } from '../../../kit/gba/rom/identify.js';
import { createVideo, SCREEN_W, SCREEN_H } from '../../../kit/gba/video.js';
import { createClock, GBA_FRAME_MS } from '../../../kit/gba/clock.js';
import { createInput } from '../../../kit/gba/input.js';
import { proof } from '../../../kit/gba/proof.js';
import { createSettings } from '../../../kit/gba/ui/settings.js';
import { createTouch } from '../../../kit/gba/ui/touch.js';
import { createSound } from '../../../kit/gba/sound/audio.js';
import { createCore, KEY } from './core.js';
import { languageScreen } from './language.js';
import { soundLayout } from './sound.js';
import { startStage } from './stage/stage.js';
import { placeCharacters } from './stage/player.js';

// the game as its cartridge's header names it, and the version the Dreamport is built from
const GAME = { name: 'Sonic Advance 3', title: 'SONICADVANC3', codes: { B3SE: 'USA' }, versions: [{ sha1: '30db467effa5014806d42db57e2299398a51355b' }] };

// the player's buttons: the console's own, the keys that press them, and the controller's buttons by their
// numbers in the standard layout (0 A, 1 B, 4 LB, 5 RB, 8 View, 9 Menu, 12 to 15 the d-pad)
const LAYOUT = {
  buttons: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'],
  gba: { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', a: 'A', b: 'B', l: 'L', r: 'R', start: 'START', select: 'SELECT' },
  keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', KeyA: 'l', KeyS: 'r', Enter: 'start', Backspace: 'select' },
  pad: { a: [0], b: [1], l: [4], r: [5], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] },
};

// the frames an act's start point stays white, the last of those between the warp's fade and the act, by the song and the
// first picture lining up with the original's (a note in notes/ says how)
const FIRST_ACT = 3, WHITE_BEFORE_AN_ACT = 2;
// the frames &x=<n>&y=<n> runs a stage for with nothing to show: its title card has gone and a player can move
const FRAMES_BEFORE_A_PLACE = 330;

const picker = document.getElementById('picker');
const stage = document.getElementById('stage');
const screen = document.getElementById('screen');
const input = createInput(LAYOUT);
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives
const touch = createTouch(stage, input, { screen, key: 'sonic-advance-3' });
createSettings(stage, input, { touch });
let rom = null, romBuffer = null;
// the game's sound (sound.js): the engine the kit runs, on the player's copy
const sound = createSound();

createRomSetup(picker, {
  brand: 'Sonic Advance 3 Dreamport',
  home: 'https://dreamports.net/dreamports/sonic-advance-3-dreamport/',
  roms: createRomStore('sonic-advance-3'),
  heading: 'Insert cartridge',
  intro: 'Your ROM stays on this device.',
  slots: [{
    key: 'game', store: 'rom', title: GAME.name, required: true, accept: '.gba',
    claims: buffer => namesGame(buffer, GAME.title),
    async read(buffer) {
      const { region, known } = await identify(new Rom(buffer), GAME);
      rom = new Rom(buffer);
      romBuffer = buffer;
      return `${region} · ${known ? 'tested version' : 'untested version'}`;
    },
    unload() { rom = null; romBuffer = null; },
  }],
  onPlay: start,
});

// The game so far: the language screen and the name entry, then Route 99's overworld, as what comes between them isn't ported yet, and act 1's
// opening, which only a start point reaches so far.
function createGame(video, rom, sound) {
  const core = createCore(video, rom, sound);
  // ?level=<n> opens a stage straight away, which recordings use as their start point, and ?seed=<n> sets the game's
  // numbers that look random, as the recording's `sets` does for the original, and &x=<n>&y=<n> puts the characters and the
  // camera somewhere in a stage as its opening ends, as those recordings' values do in the original, with &jump=<n> the
  // button held for that many frames before it, so the character is put there on its way up
  const params = new URLSearchParams(location.search), level = params.get('level');
  core.seed = Number(params.get('seed')) | 0;
  core.main = level === null ? languageScreen : c => startStage(c, Number(level));
  if (Number(level) >= FIRST_ACT) core.startUp = WHITE_BEFORE_AN_ACT;
  if (params.has('x')) {
    const jump = Number(params.get('jump'));
    for (let i = 0; i < FRAMES_BEFORE_A_PLACE; i++) {
      if (i === FRAMES_BEFORE_A_PLACE - 1) placeCharacters(core.stage, Number(params.get('x')), Number(params.get('y')));
      core.step(i >= FRAMES_BEFORE_A_PLACE - jump ? KEY.A : 0);
      core.runSound();
    }
  }
  return { step(keys) { core.step(keys); }, hblank: core.hblank };
}

function start() {
  picker.hidden = true;
  stage.hidden = false;
  // the sound engine, started on the player's copy as the original's start-up does. The kit's proof tool waits for it,
  // so every frame has its sound.
  sound.load(romBuffer, soundLayout(rom));
  const video = createVideo(), game = createGame(video, rom, sound);
  const out = screen.getContext('2d', { alpha: false });
  screen.width = SCREEN_W;
  screen.height = SCREEN_H;
  const image = out.createImageData(SCREEN_W, SCREEN_H), pixels = new Uint32Array(image.data.buffer);
  // at the console's own rate: each of the display's frames runs the game's frames that are due, then draws
  const clock = createClock(GBA_FRAME_MS);
  clock.reset();
  input.enabled = true;
  requestAnimationFrame(function loop(now) {
    let ran = false;
    for (let n = clock.steps(now); n > 0; n--) {
      input.poll();
      game.step(input.gbaKeys());
      ran = true;
    }
    if (ran) {
      video.drawFrame(pixels, game.hblank);
      out.putImageData(image, 0, 0);
    }
    requestAnimationFrame(loop);
  });
  screen.focus();
}
