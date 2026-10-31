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
import { createCore, step } from './core.js';
import { logos } from './logos.js';

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
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
let rom = null;

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
      return `${region} · ${known ? 'tested version' : 'untested version'}`;
    },
    unload() { rom = null; },
  }],
  onPlay: start,
});

// The game so far: the logos. What comes after them, the intro (0x0803d748), isn't ported yet, so the screen
// stays black there.
function createGame(video, rom) {
  const core = createCore(video, rom);
  core.main = c => logos(c, () => {});
  return { step(keys) { step(core, keys); } };
}

function start() {
  picker.hidden = true;
  stage.hidden = false;
  const video = createVideo(), game = createGame(video, rom);
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
  fit();
  screen.focus();
}

// the screen as large as it fits at a whole number of the display's pixels, so they stay square and sharp
function fit() {
  const dpr = devicePixelRatio || 1, room = Math.min(innerWidth / SCREEN_W, innerHeight / SCREEN_H);
  const scale = room * dpr >= 1 ? Math.floor(room * dpr) / dpr : room;
  screen.style.width = `${SCREEN_W * scale}px`;
  screen.style.height = `${SCREEN_H * scale}px`;
}
addEventListener('resize', fit);
