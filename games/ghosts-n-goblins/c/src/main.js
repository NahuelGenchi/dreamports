// Ghosts'n Goblins Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on what the kits
// share (kit/gba/, docs/CONSOLES.md), at the game's screen and the console's own rate and buttons (kit/consoles.js). The
// game's own code is in C, in main.c and the files beside it, which run here built to WebAssembly (game.wasm), on the kit in C (kit/c/).

import '../../../../kit/gba/canvas.js';
import { createRomSetup } from '../../../../kit/gba/ui/rom-setup.js';
import { createRomStore } from '../../../../kit/gba/rom/store.js';
import { sha1Hex } from '../../../../kit/gba/rom/identify.js';
import { createClock } from '../../../../kit/gba/clock.js';
import { createInput } from '../../../../kit/gba/input.js';
import { proof } from '../../../../kit/gba/proof.js';
import { createSettings } from '../../../../kit/gba/ui/settings.js';
import { createTouch } from '../../../../kit/gba/ui/touch.js';
import { CONSOLES, layoutOf } from '../../../../kit/consoles.js';
import { buttonsOf, loadGame } from '../../../../kit/c/game.js';

const MACHINE = CONSOLES['nes'];
const GAME = { name: 'Ghosts\'n Goblins', versions: [{ sha1: '3430811ecc007fa469f5b74db277f872679266dd' }] };

const picker = document.getElementById('picker');
const stage = document.getElementById('stage');
const screen = document.getElementById('screen');
const input = createInput(layoutOf('nes'));
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
const touch = createTouch(stage, input, { screen, key: 'ghosts-n-goblins' });
createSettings(stage, input, { touch });
let rom = null;

createRomSetup(picker, {
  brand: 'Ghosts\'n Goblins Dreamport',
  home: 'https://dreamports.net/dreamports/ghosts-n-goblins-dreamport/',
  roms: createRomStore('ghosts-n-goblins'),
  heading: 'Insert your copy',
  intro: 'Your copy stays on this device.',
  slots: [{
    key: 'game', store: 'rom', title: GAME.name, required: true, accept: MACHINE.files.join(','), console: MACHINE.name, maxBytes: MACHINE.largest,
    claims: () => true,
    async read(buffer) {
      const sha1 = await sha1Hex(buffer);
      rom = new Uint8Array(buffer);
      return GAME.versions.some(version => version.sha1 === sha1) ? 'tested version' : 'untested version';
    },
    unload() { rom = null; },
  }],
  onPlay: start,
});

async function start() {
  // the game's own code (main.c), with its save memory kept in this browser
  const game = await loadGame(new URL('./game.wasm', import.meta.url), rom, { console: 'nes', save: 'ghosts-n-goblins-c-save' });
  picker.hidden = true;
  stage.hidden = false;
  const out = screen.getContext('2d', { alpha: false });
  let image, pixels;
  const sizeTo = ([width, height]) => {
    if (image && width === screen.width && height === screen.height) return;
    [screen.width, screen.height] = [width, height];
    image = out.createImageData(width, height);
    pixels = new Uint32Array(image.data.buffer);
  };
  sizeTo([256,240]);
  // at the console's own rate: each of the display's frames runs the game's frames that are due, then draws the last,
  // at the size the game shows now
  const clock = createClock(1000 * MACHINE.frame[0] / MACHINE.frame[1]);
  clock.reset();
  input.enabled = true;
  requestAnimationFrame(function loop(now) {
    let ran = false;
    for (let n = clock.steps(now); n > 0; n--) {
      input.poll();
      game.step(buttonsOf(input, 'nes'));
      ran = true;
    }
    if (ran) {
      const frame = game.draw();
      if (frame.width && frame.height) {
        sizeTo([frame.width, frame.height]);
        pixels.set(frame.pixels);
        out.putImageData(image, 0, 0);
      }
    }
    requestAnimationFrame(loop);
  });
  screen.focus();
}
