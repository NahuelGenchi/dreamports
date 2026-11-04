// Sonic Battle Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on
// the Game Boy Advance kit (kit/gba/).

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
import { cartridgeSave } from '../../../kit/gba/save.js';
import { createCore, step } from './core.js';
import { logos } from './logos.js';
import { intro } from './intro.js';
import { keptName } from './name-entry.js';
import { skills } from './skills.js';
import { soundLayout } from './sound.js';
import { startFight } from './fight.js';

// the game as its cartridge's header names it, and the version the Dreamport is built from: the USA one, whose
// addresses the code reads at
const GAME = {
  name: 'Sonic Battle', title: 'SONICBATTLE', codes: { BSBE: 'USA', BSBP: 'Europe', BSBJ: 'Japan' },
  versions: [{ sha1: '8cf4fbbe73f6b1907ab9997caab4c4e7d9708937' }],
};

// the player's buttons: the console's own, the keys that press them, and the controller's buttons by their
// numbers in the standard layout (0 A, 1 B, 4 LB, 5 RB, 8 View, 9 Menu, 12 to 15 the d-pad)
const LAYOUT = {
  buttons: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'],
  gba: { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', a: 'A', b: 'B', l: 'L', r: 'R', start: 'START', select: 'SELECT' },
  keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', KeyA: 'l', KeyS: 'r', Enter: 'start', Backspace: 'select' },
  pad: { a: [0], b: [1], l: [4], r: [5], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] },
};

const picker = document.getElementById('picker');
const stage = document.getElementById('stage');
const screen = document.getElementById('screen');
const input = createInput(LAYOUT);
// the game's sound (sound.js): the engine the kit runs, on the player's copy
const sound = createSound();
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives and what a button does so far
const touch = createTouch(stage, input, { screen, key: 'sonic-battle' });
createSettings(stage, input, { what: {
  a: 'A: adds a letter to your name, and chooses on the main menu',
  b: 'B: takes the last letter off your name',
  start: 'Start: skips the SEGA and Sonic Team logos and the intro, leaves the title screen, and keeps your name',
}, touch });
let rom = null, romBuffer = null;

createRomSetup(picker, {
  brand: 'Sonic Battle Dreamport',
  home: 'https://dreamports.net/dreamports/sonic-battle-dreamport/',
  roms: createRomStore('sonic-battle'),
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

// The game so far: the logos, the intro, the title screen, the name entry and the main menu, with Emerl's screen's
// menu and a fight's opening from start points. What the menu's choices lead to isn't ported yet, so the screen stays
// black there. The proof tools keep no name between runs, as a new cartridge wouldn't have one, and `name` in the
// address is what a recording's start point gives the game for a saved one.
function createGame(video, rom, sound) {
  const core = createCore(video, rom, sound);
  core.nameSave = cartridgeSave('sonic-battle-name', proof ? null : undefined);
  keptName(core);
  const saved = new URLSearchParams(location.search).get('name');
  if (saved !== null) core.name[0] = Number(saved) & 0xFFFF;
  core.main = c => logos(c, intro);
  // a recording's start point, as nothing leads to Emerl's screen yet: `skills` in the address opens it (skills.js)
  if (new URLSearchParams(location.search).has('skills')) {
    core.startUp = 1;
    core.main = skills;
  }
  // a recording's start point, as nothing leads to a fight yet: fight=training&vblanks=<count> opens one (fight.js)
  const asked = new URLSearchParams(location.search);
  if (asked.get('fight') === 'training') {
    core.startUp = 1;
    core.main = c => startFight(c, Number(asked.get('vblanks')));
  }
  return { step(keys) { step(core, keys); } };
}

function start() {
  picker.hidden = true;
  stage.hidden = false;
  // the sound engine, started on the player's copy as the original's start-up does (0x0801f5ec): its tables and
  // mode are this game's (sound.js). The kit's proof tool waits for it, so every frame has its sound.
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
      video.drawFrame(pixels);
      out.putImageData(image, 0, 0);
    }
    requestAnimationFrame(loop);
  });
  screen.focus();
}
