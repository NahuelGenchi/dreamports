// Made Up Game Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on what the kits
// share (kit/gba/, docs/CONSOLES.md), at the game's screen and the console's own rate and buttons (kit/consoles.js). The
// game's own code is in C, in main.c, which runs here built to WebAssembly (game.wasm), on the kit in C (kit/c/).

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
import { openCopy, sha1Of } from '../../../../kit/copy/page.js';

const MACHINE = CONSOLES['nds'];
const GAME = { name: 'Made Up Game', versions: [{ sha1: 'ed1626e429549211aa957e24ca03afcedd683b5c' }] };

const picker = document.getElementById('picker');
const stage = document.getElementById('stage');
const screen = document.getElementById('screen');
const input = createInput(layoutOf('nds'));
proof?.watch(screen, input);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
const touch = createTouch(stage, input, { screen, key: 'made-up-c-nds', size: () => [screen.width, screen.height] });
// on a console with a screen that's touched, a finger or the mouse on it touches the game's
if (MACHINE.touch !== undefined) input.bindScreen(screen, MACHINE.screens[MACHINE.touch]);
createSettings(stage, input, { touch });
// the player's copy: a cartridge's bytes, or a disc, read a few sectors at a time as the game asks for them
let rom = null, disc = null;

createRomSetup(picker, {
  brand: 'Made Up Game Dreamport',
  home: 'https://dreamports.net/dreamports/made-up-c-nds-dreamport/',
  roms: createRomStore('made-up-c-nds'),
  heading: 'Insert your copy',
  intro: 'Your copy stays on this device.',
  slots: [{
    key: 'game', store: 'rom', title: GAME.name, required: true, accept: MACHINE.files.join(','), console: MACHINE.name, maxBytes: MACHINE.largest,
    pieces: !!MACHINE.disc,
    claims: () => true,
    async read(copy, progress, { others = [] } = {}) {
      const version = sha1 => (GAME.versions.some(each => each.sha1 === sha1) ? 'tested version' : 'untested version');
      // a disc is read a few sectors at a time, as the game asks; anything else, such as a program, whole
      const opened = MACHINE.disc ? await openCopy(copy, others) : null;
      if (!opened) {
        const bytes = copy instanceof ArrayBuffer ? copy : await copy.arrayBuffer();
        rom = new Uint8Array(bytes);
        disc = null;
        return version(await sha1Hex(bytes));
      }
      rom = null;
      if (opened.what?.console && opened.what.console !== 'nds') throw new Error(`${copy.name} is a disc for ${CONSOLES[opened.what.console]?.name ?? 'another console'}.`);
      disc = opened.disc;
      // which version it is takes the whole disc, so it comes after, while the game can already start
      return { about: 'checking its version…', later: sha1Of(opened.files).then(version) };
    },
    unload() { rom = null; disc = null; },
  }],
  onPlay: start,
});

async function start() {
  // the game's own code (main.c), with its save memory kept in this browser
  const game = await loadGame(new URL('./game.wasm', import.meta.url), rom, { console: 'nds', save: 'made-up-c-nds-c-save', disc });
  picker.hidden = true;
  stage.hidden = false;
  const out = screen.getContext('2d', { alpha: false });
  let image, pixels;
  const sizeTo = ([width, height]) => {
    if (image && width === screen.width && height === screen.height) return;
    [screen.width, screen.height] = [width, height];
    image = out.createImageData(width, height);
    pixels = new Uint32Array(image.data.buffer);
    touch.fit();
  };
  sizeTo([256,384]);
  const show = () => {
    const frame = game.draw();
    if (frame.width && frame.height) {
      sizeTo([frame.width, frame.height]);
      pixels.set(frame.pixels);
      out.putImageData(image, 0, 0);
    }
  };
  // at the console's own rate: each of the display's frames runs the game's frames that are due, then draws the last,
  // at the size the game shows now. A frame that waits for its disc's sectors ends, and is drawn, once they're here,
  // and no other runs until then
  const clock = createClock(1000 * MACHINE.frame[0] / MACHINE.frame[1]);
  clock.reset();
  input.enabled = true;
  let waiting = null;
  requestAnimationFrame(function loop(now) {
    let ran = false;
    for (let n = waiting ? 0 : clock.steps(now); n > 0 && !waiting; n--) {
      input.poll();
      const later = game.step(buttonsOf(input, 'nds'), input.touch);
      ran = true;
      if (later) {
        waiting = later.then(show).finally(() => { waiting = null; });
        proof?.hold(waiting);
      }
    }
    if (ran && !waiting) show();
    requestAnimationFrame(loop);
  });
  screen.focus();
}
