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
import { createCore, hblank, step } from './core.js';
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
const sound = createSound({ countCycles: true });
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives and what a button does so far
const touch = createTouch(stage, input, { screen, key: 'sonic-battle' });
createSettings(stage, input, { what: {
  a: 'A: adds a letter to your name, chooses on the main menu and the Mini-games screen, and plays a song or sound in the options',
  b: 'B: takes the last letter off your name, and goes back from the Mini-games screen and the options',
  start: 'Start: skips the SEGA and Sonic Team logos and the intro, leaves the title screen, keeps your name, and goes back from the options',
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

// The game so far: the logos, the intro, the title screen, the name entry, the main menu, the Mini-games screen and the options,
// with Emerl's screen's menu and a fight's opening from start points. What the rest of their choices lead to isn't ported
// yet, so the screen stays black there. The proof tools keep no name between runs, as a new cartridge wouldn't have one,
// and `name` in the address is what a recording's start point gives the game for a saved one, and `open` for the entries
// a save has opened on the Mini-games screen.
function createGame(video, rom, sound) {
  const core = createCore(video, rom, sound);
  core.nameSave = cartridgeSave('sonic-battle-name', proof ? null : undefined);
  keptName(core);
  core.languageSave = cartridgeSave('sonic-battle-language', proof ? null : undefined);
  core.language = core.savedLanguage = core.languageSave.read()?.[0] ?? core.language;
  const saved = new URLSearchParams(location.search).get('name');
  if (saved !== null) core.name[0] = Number(saved) & 0xFFFF;
  // a recording's start point for a saved language: the original is given it 40 frames in, past where it reads its save, and plays those alone
  const language = new URLSearchParams(location.search).get('language');
  if (language !== null) {
    core.language = core.savedLanguage = Number(language) & 0xFF;
    core.startUp -= 40;
  }
  const open = new URLSearchParams(location.search).get('open');
  if (open !== null) core.miniGamesOpen = Number(open) & 0xFF;
  core.main = c => logos(c, intro);
  // a recording's start point, as nothing leads to Emerl's screen yet: `skills` in the address opens it (skills.js)
  if (new URLSearchParams(location.search).has('skills')) {
    core.startUp = 1;
    core.main = skills;
  }
  // a recording's start point, as nothing leads to a fight yet: fight=training&vblanks=<count> opens one (fight.js),
  // with &action=<n> for the Rival's Action Training's screen offers, 0 (Do Nothing) unless it says,
  // &character=<n> for the player's fighter, Sonic (0) unless it says, and &arena=<n> for the Training map, Emerald
  // Beach (0) unless it says. It places no fighter: the fight's own opening drops them in, and it's what's proven,
  // so no neverInPlay is needed.
  const asked = new URLSearchParams(location.search);
  if (asked.get('fight') === 'training') {
    core.startUp = 1;
    core.main = c => startFight(c, Number(asked.get('vblanks')), Number(asked.get('action') ?? 0) & 0xFF,
      Number(asked.get('character') ?? 0) & 0xFF, Number(asked.get('arena') ?? 0) & 0xFF);
  }
  return {
    step(keys) {
      step(core, keys);
      sound.frameDone();
    },
    hblank(line) { hblank(core, line); },
  };
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
      video.drawFrame(pixels, game.hblank);
      out.putImageData(image, 0, 0);
    }
    requestAnimationFrame(loop);
  });
  screen.focus();
}
