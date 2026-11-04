// Crash Bandicoot Purple: Ripto's Rampage Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on the Game Boy
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
import { createCore, step } from './core.js';

// the game as its cartridge's header names it, and the version the Dreamport is built from
const GAME = { name: 'Crash Bandicoot Purple: Ripto\'s Rampage', title: 'CRASH PURPLE', codes: { BD4E: 'USA' }, versions: [{ sha1: '35d1c8c90890bf7ce66306e6c06a3676a723dcf3' }] };

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
// the game's sound, its own engine on the player's copy (sound/gax.js), and the calls the game makes on it
const sound = createSound({
  worklet: new URL('./sound/worklet.js', import.meta.url),
  calls: call => ({
    startSong(address, ahead = 0) { call('startSong', address, ahead); },
    playEffect(address) { call('playEffect', address); },
  }),
});
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives
const touch = createTouch(stage, input, { screen, key: 'crash-bandicoot-purple' });
createSettings(stage, input, { touch });
let rom = null, romBuffer = null;

createRomSetup(picker, {
  brand: 'Crash Bandicoot Purple: Ripto\'s Rampage Dreamport',
  home: 'https://dreamports.net/dreamports/crash-bandicoot-purple-dreamport/',
  roms: createRomStore('crash-bandicoot-purple'),
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

// The game so far: the copyright screen and the logos. What comes after them, the title screen, isn't ported yet, so
// the screen stays black there.
function createGame(video, rom, sound) {
  // a start point (tools/README.md), which the game's own path doesn't reach yet: ?hub opens in the first world's hub
  const core = createCore(video, rom, sound, new URLSearchParams(location.search).has('hub') ? 'hub' : null);
  return { step(keys) { step(core, keys); } };
}

function start() {
  picker.hidden = true;
  stage.hidden = false;
  // the sound engine, on the player's copy. The kit's proof tool waits for it, so every frame has its sound, and its
  // layout is empty as this engine doesn't read the kit's song table
  sound.load(romBuffer, { songs: 0, songTable: 0 });
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
