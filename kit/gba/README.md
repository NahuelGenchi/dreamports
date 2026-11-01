# Game Boy Advance kit

[Back to README](../../README.md) · [Games](../../games/README.md) · [The Dreamport standard](../../docs/STANDARD.md) · [Written in: #76](https://github.com/NahuelGenchi/dreamports/issues/76)

This folder holds what every Game Boy Advance Dreamport shares, so a new one starts with the console already working: reading and checking the player's copy, drawing and sound that work the way the console did, keyboard, controller and touch, settings and saves, achievements, the asset viewer, and what the proof tools need. It came out of [Sonic Advance Dreamport](../../games/sonic-advance/README.md), which runs on it.

The kit is plain JavaScript that the browser runs as it is, with no build step, under [GPL-3.0-or-later](LICENSE). Nothing from any game is in it, and nothing only one game needs: that stays in the game's own folder. The site serves it at `dreamports.net/kit/gba/`, as [games/README.md](../../games/README.md#the-kits-games-start-from) explains.

## What's in it

| Part | Files | What it does |
| :--- | :--- | :--- |
| The player's copy | `rom/rom.js`, `rom/identify.js`, `rom/store.js` | Reads a ROM, checks its header and its SHA-1 against the versions a game supports, and keeps it in the browser |
| Drawing | `video.js`, `canvas.js` | The video hardware: VRAM, palettes, sprites and registers, drawn a line at a time the way mGBA draws them |
| Sound | `sound/` | Nintendo's sound engine (MusicPlayer2000, or "m4a") and the sound hardware, on an audio thread of their own |
| Frames | `clock.js` | How many of the game's frames each of the display's frames runs |
| Buttons | `input.js` | Keyboard, controller and the controller drawn on touch screens, as the game's own buttons |
| Saves | `save.js` | The bytes a cartridge's save memory holds, kept in the browser |
| Screens | `ui/` | The start screen with the player's ROMs, the settings, the list of controls and the asset viewer |
| Achievements | `achievements/` | The game's achievements, kept in the browser and on the player's profile, with their popup and their list |
| Look | `styles/` | The pages' look, light or dark like the dreamports.net launcher, with its font and icon |
| Proof | `proof.js` | Runs the game a frame at a time from recorded button presses, for the proof tools |

## Start a new game

A new Game Boy Advance Dreamport is a folder in [`games/`](../../games/README.md), such as `games/my-game/`, with three files to begin with:

- `LICENSE`, a copy of [the kit's](LICENSE), as Dreamports use GPL-3.0-or-later.
- `index.html`, the page, which loads the kit's look and the game.
- `src/main.js`, the game.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>My Game Dreamport</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../../kit/gba/styles/kit.css">
</head>
<body>
<main>
  <section class="picker" id="picker" aria-label="Your ROMs"></section>
  <section class="stage" id="stage" hidden>
    <canvas id="screen" tabindex="0" aria-label="My Game"></canvas>
  </section>
</main>
<script type="module" src="src/main.js"></script>
</body>
</html>
```

`src/main.js` asks for the player's copy and checks it, then runs the game a frame at a time. The game's own code goes in `createGame`. Here it only paints the screen's backdrop, blue, and green while a button is held, which is enough to see that the frames, the drawing and the buttons work. `GAME` and `LAYOUT` are the parts to fill in: the game's header, from the player's copy, and its buttons. `createTouch()` draws a controller around the game on touch screens, and sizes the screen among its buttons. `createSettings()` gives the page its settings, with the game's controls listed from `LAYOUT`, so the first piece already shows how to play it, on a computer or a phone.

```js
// My Game Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, on the
// Game Boy Advance kit (kit/gba/).

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

// the game as its cartridge's header names it: the title, the game code of each region, and the SHA-1 of each
// version the Dreamport supports, { sha1 }
const GAME = { name: 'My Game', title: 'MY GAME', codes: { AXXE: 'USA' }, versions: [] };

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
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives
const touch = createTouch(stage, input, { screen, key: 'my-game' });
createSettings(stage, input, { brand: 'My Game Dreamport', touch });
let rom = null;

createRomSetup(picker, {
  brand: 'My Game Dreamport',
  home: 'https://dreamports.net/dreamports/my-game-dreamport/',
  roms: createRomStore('my-game'),
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

// the game's own code: what the original does each frame, writing the video hardware's registers, VRAM, palettes
// and sprites as it does. To begin with, the screen's backdrop: blue, and green while a button is held.
function createGame(video, rom) {
  return {
    step(keys) { video.pal[0] = keys ? 0x03E0 : 0x7C00; },
  };
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
  screen.focus();
}
```

The settings open over the game with the settings button in the top-left corner, <kbd>H</kbd>, or View and Menu together on a controller, and the game waits while they're open. Their Controls list every key and controller button `LAYOUT` gives, and the console's button each presses. Once a button does something in the game, `what` says so, by the button's name in `LAYOUT`, and `dpad` for the d-pad, as Sonic Battle Dreamport's [`src/main.js`](../../games/sonic-battle/src/main.js) does for Start: `createSettings(stage, input, { brand: 'My Game Dreamport', what: { start: 'Start: skips the logos' } })`. That list is what a player and `/dreamport-play` go by to play the game.

On a phone or a tablet, `createTouch()` draws the same controller for every game, as Sonic Advance Dreamport has it: an Xbox controller's d-pad, LB, LT, RB, RT, A, B, X, Y, Select and Start, with Select and Start for View and Menu. Each does what the controller's button does in `LAYOUT`'s `pad`, so they match the settings' Controls, and a button the game gives nothing does nothing yet. They step aside while a real controller is connected, and the settings' Button opacity sets how solid they are, kept in the browser under the game's `key`. The screen is sized among them, upright or sideways, so the game doesn't size it itself. Once touch works, the entry's `controls` lists `touch` too.

To try it, serve the repository's folder with any static file server, such as `python -m http.server 8000` run in it, and open `http://localhost:8000/games/my-game/`. The server runs in the repository's folder, not the game's, because the game loads the kit from `kit/gba/`, the way dreamports.net serves it from `/kit/gba/`.

From there the game grows the way [the standard](../../docs/STANDARD.md#always-playable-always-proven) asks: the original's code rewritten piece by piece in `src/`, in the order a player meets it, every piece playable.

## The rest of the page

Sonic Advance Dreamport's [`index.html`](../../games/sonic-advance/index.html) and [`src/main.js`](../../games/sonic-advance/src/main.js) use every part of the kit, and are the place to copy from.

- **Settings.** A game with settings of its own, such as extras to turn on, writes them in its page and makes the sheet itself, instead of `createSettings()`: `ui/sheet.js` opens it over the game with the settings button, <kbd>H</kbd>, or View and Menu together on a controller. While it's open the game waits: `holdClocks()` in `clock.js` holds every clock, and the sound's `held` stops it where it is.
- **Controls.** `ui/controls-view.js` lists every key and controller button in the settings, from a list the game gives it, like Sonic Advance Dreamport's [`src/ui/controls.js`](../../games/sonic-advance/src/ui/controls.js). `layoutControls()` in `ui/settings.js` makes that list's first part from the game's `LAYOUT`, for a game that writes the rest itself.
- **Touch.** `createTouch()` in `ui/touch.js` draws the controller and sizes a game of one screen among its buttons, and `bindSlider()` on what it returns makes a game's own Button opacity slider set how solid they are. A game with views of its own, such as Sonic Advance Dreamport's widescreen view and its players' screens side by side, writes the page's `touch` part itself, and `input.bindTouch()` makes its buttons press the game's.
- **Saves.** `cartridgeSave()` in `save.js` keeps what the cartridge's save memory holds. What its bytes mean is the game's own.
- **Sound.** `soundLayout()` in `sound/tables.js` finds the sound engine's tables in the player's copy and takes the game's sound mode, from its decompilation's `DEFAULT_SOUND_MODE`. `createSound()` in `sound/audio.js` plays it. A game with sounds of its own makes its own audio thread from `sound/processor.js`, like Sonic Advance Dreamport's [`src/sound/worklet.js`](../../games/sonic-advance/src/sound/worklet.js).
- **Achievements.** `openAchievements()` in `achievements/store.js` keeps the achievements the game lists in its own `src/achievements/list.js`, and the page loads `/dreamports.js` to send them to the player's profile. The game is also added to the site's lists, as [Profiles and achievements](../../docs/ACCOUNTS.md#for-a-game-dreamportsjs) explains.
- **Asset viewer.** `ui/assets-view.js` shows what the game reads from the player's copy, in parts the game makes, like Sonic Advance Dreamport's [`src/ui/assets.js`](../../games/sonic-advance/src/ui/assets.js).

## For the proof tools

The [proof tools](../../tools/README.md) play the same button presses in the original and in the Dreamport, and compare every frame. The kit gives them what they need from any game whose page calls `proof?.watch(screen, input)` with its screen and its player's buttons, as the example above does:

- With `?proof` in the page's address, the game keeps no time of its own. It runs a frame only when a tool asks for one, with the buttons the tool gives, and hands over the picture it drew.
- With `?proof=record`, it plays as usual and keeps the buttons it read at each frame. A tool can give it frames to play first, such as another recording's, and the player's buttons take over after them.

A tool reaches it on the page as `dreamportsProof`. Its `buttons` names the game's buttons, `ready` resolves once the game runs, `step({ held, pressed })` runs one frame and resolves to its picture as `ImageData`, and `frames` holds what was recorded, ready to give back to `step()`. In record mode, `replay(frames)` gives it the frames to play first, each `{ held }` with the console's names for its buttons, before the game starts, and `replaying` says how many are still to run. Games with more than one player on a page aren't supported yet.

The tools start the game the way a player does, on the kit's start screen: they give the copy to the first file input in its `.rom` part, wait for `.play` to be ready, and press it. While they play, the picture `step()` hands over has to be the console's 240 by 160 pixels.

## Thanks

- [mGBA](https://mgba.io), the emulator the original games are recorded in, whose software renderer the drawing follows pixel for pixel.
- The [SAT-R](https://github.com/SAT-R) decompilation of Sonic Advance, the reference the sound engine's port follows. None of its code or data is copied here.
- GBATEK and the Pan Docs, the references for the sound hardware.
- [Monocraft](https://github.com/IdreesInc/Monocraft) by Idrees Hassan, the pixel font of the pages. A subset of it is bundled under the SIL Open Font License 1.1 ([styles/fonts/Monocraft-OFL.txt](styles/fonts/Monocraft-OFL.txt)).
- [Pixelarticons](https://github.com/halfmage/pixelarticons) by Gerrit Halfmann, whose gamepad icon is the start screen's controller badge, under the MIT License ([styles/icons/pixelarticons-LICENSE.txt](styles/icons/pixelarticons-LICENSE.txt)).
- Palmaris, the Dreamports team's RetroAchievements project for the Nintendo DSi, whose trophy and 5×7 pixel font the achievement popup uses, and RetroArch, whose achievement popup's movement it follows.
