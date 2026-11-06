// Sonic Advance Dreamport: the player's copy, checked and kept in this browser, then the game a frame at a time, with its
// sound, on the Game Boy Advance kit (kit/gba/). The game's own code is in C, in main.c, which runs here built to
// WebAssembly (game.wasm), on the kit in C (kit/gba/c/).
//
// `?vs=N` starts the game as N linked GBAs, 2 to 4, each on its own screen from power-on, as the JavaScript version's
// front/vsfront.js does: every GBA is a WebAssembly of its own, all are stepped together a frame at a time, and the page is
// the link cable between them (link.c). The first two players share the keyboard, the others play with controllers, and
// only the first GBA's sound is heard. Once the VS menus have chosen the round, which isn't in C yet, the screens go black,
// as the original's are while its stage loads. It names no dreamportsProof.neverInPlay: the GBAs start from power-on,
// and every frame of the menus is one a player sees.

import '../../../../kit/gba/canvas.js';
import { createRomSetup } from '../../../../kit/gba/ui/rom-setup.js';
import { createRomStore } from '../../../../kit/gba/rom/store.js';
import { Rom } from '../../../../kit/gba/rom/rom.js';
import { identify, namesGame } from '../../../../kit/gba/rom/identify.js';
import { SCREEN_W, SCREEN_H } from '../../../../kit/gba/video.js';
import { loadGame } from '../../../../kit/gba/c/game.js';
import { createClock, GBA_FRAME_MS } from '../../../../kit/gba/clock.js';
import { createInput, playerPads } from '../../../../kit/gba/input.js';
import { proof } from '../../../../kit/gba/proof.js';
import { createSettings } from '../../../../kit/gba/ui/settings.js';
import { createTouch } from '../../../../kit/gba/ui/touch.js';

// the game as its cartridge's header names it, and the version the Dreamport is built from
const GAME = { name: 'Sonic Advance', title: 'SONICADVANCE', codes: { ASOE: 'USA' }, versions: [{ sha1: 'd842afa7dd1e84de08addb94a51506f1bcafd551' }] };

// the player's buttons: the console's own, the keys that press them, and the controller's buttons by their
// numbers in the standard layout (0 A, 1 B, 4 LB, 5 RB, 8 View, 9 Menu, 12 to 15 the d-pad)
const LAYOUT = {
  buttons: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'],
  gba: { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', a: 'A', b: 'B', l: 'L', r: 'R', start: 'START', select: 'SELECT' },
  keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', KeyA: 'l', KeyS: 'r', Enter: 'start', Backspace: 'select' },
  pad: { a: [0], b: [1], l: [4], r: [5], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] },
};

// the keys of each player on a page of linked GBAs: the first two share the keyboard, the others play with controllers
const PLAYER_KEYS = [
  { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyF: 'a', KeyG: 'b', KeyE: 'start', KeyQ: 'select' },
  { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Period: 'a', Slash: 'b', Enter: 'start', Backspace: 'select' },
  {}, {},
];
// the cable's bytes in each GBA's memory (link.c): its own packet and whether it is on, then every GBA's at the frame's end
const PACKET = 20, CABLE_ON = 20, CABLE_FRAME = 24, CABLE_FRAME_ON = CABLE_FRAME + 4 * PACKET;

const params = new URLSearchParams(location.search);
const vsCount = params.has('vs') ? Math.min(4, Math.max(2, Number(params.get('vs')) | 0)) : 0;

const picker = document.getElementById('picker');
const stage = document.getElementById('stage');
const screen = document.getElementById('screen');
const screens = document.getElementById('screens');
// each player's buttons and screen: one, or with ?vs one for each GBA
const players = Array.from({ length: Math.max(1, vsCount) }, (_, id) => {
  const canvas = vsCount ? document.createElement('canvas') : screen;
  if (vsCount) {
    canvas.className = 'screen';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `Player ${id + 1}'s screen`);
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    screens.append(canvas);
  }
  const input = vsCount ? createInput(LAYOUT, { keys: PLAYER_KEYS[id], pads: playerPads(id, vsCount) }) : createInput(LAYOUT);
  proof?.watch(canvas, input, id);   // for the proof tools: ?proof plays recorded buttons, ?proof=record keeps them
  return { id, canvas, input };
});
const input = players[0].input;
// on touch screens the controller drawn around the game, with the screen sized among its buttons, and the settings,
// with the controls the layout gives
const touch = createTouch(stage, input, { screen, key: 'sonic-advance' });
const sheet = createSettings(stage, input, { touch });
let rom = null;

// The players (1 to 4): 2 to 4 start the game again as that many linked GBAs (?vs=N), whose main menus' VS joins them
stage.querySelector('.sheet .rows').insertAdjacentHTML('beforeend', `
  <li><button type="button" class="row" id="players" aria-label="Players">
    <svg viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 0h2v2H1zM6 0h2v2H6zM0 3h4v1H0zM5 3h4v1H5zM1 5h2v4H1zM6 5h2v4H6z"/></svg>
    <span class="row-text">Players<span class="row-hint">Linked screens for VS. Restarts the game</span></span>
    <span class="row-end"><b class="players-count" aria-hidden="true">${Math.max(1, vsCount)}</b><kbd class="key">P</kbd></span>
  </button></li>`);
function setPlayers(count) {
  const url = new URL(location.href);
  if (count > 1) url.searchParams.set('vs', String(count)); else url.searchParams.delete('vs');
  location.href = url.href;
}
const nextPlayers = () => setPlayers(Math.max(1, vsCount) % 4 + 1);
document.getElementById('players').addEventListener('click', nextPlayers);
addEventListener('keydown', e => { if (e.code === 'KeyP' && !stage.hidden && !e.repeat) nextPlayers(); });

createRomSetup(picker, {
  brand: 'Sonic Advance Dreamport',
  home: 'https://dreamports.net/dreamports/sonic-advance-dreamport/',
  // the JavaScript version's ROM store and save, under the names it has always had (src/ui/roms.js, engine/save.js), so
  // a player moves between the two with the copy they added and their save
  roms: createRomStore('onsoku-advance'),
  heading: 'Insert cartridge',
  intro: 'Your ROM stays on this device.',
  slots: [{
    key: 'game', store: 'current', title: GAME.name, required: true, accept: '.gba',
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

async function start() {
  // the game's own code (main.c), with its save memory kept in this browser: with ?vs the first GBA's, the others
  // playing with saves kept nowhere and no sound
  const url = new URL('./game.wasm', import.meta.url);
  const games = await Promise.all(players.map(p => loadGame(url, rom, { save: p.id === 0 ? 'onsoku.save' : null, heard: p.id === 0 })));
  picker.hidden = true;
  stage.hidden = false;
  stage.classList.toggle('multi', !!vsCount);   // its players play with keyboards and controllers
  screen.hidden = !!vsCount;
  screens.hidden = !vsCount;
  const shown = players.map((p, i) => {
    const out = p.canvas.getContext('2d', { alpha: false });
    p.canvas.width = SCREEN_W;
    p.canvas.height = SCREEN_H;
    const image = out.createImageData(SCREEN_W, SCREEN_H);
    return { ...p, game: games[i], out, image, pixels: new Uint32Array(image.data.buffer) };
  });
  // with ?vs, every GBA on the cable, and the cable's bytes in each one's memory, found again whenever it grows
  const cables = vsCount ? games.map((g, id) => g.game.dp_link_join(vsCount, id)) : [];
  const cable = id => new Uint8Array(games[id].game.memory.buffer, cables[id], CABLE_FRAME_ON + 4);
  function carry() {
    const all = cables.map((_, id) => cable(id));
    for (const to of all) {
      all.forEach((from, id) => {
        to.set(from.subarray(0, PACKET), CABLE_FRAME + id * PACKET);
        to[CABLE_FRAME_ON + id] = from[CABLE_ON];
      });
    }
    for (const g of games) g.game.dp_link_end_frame();
  }
  let chosen = false;
  fitScreens();
  // at the console's own rate: each of the display's frames runs the game's frames that are due, then draws
  const clock = createClock(GBA_FRAME_MS);
  clock.reset();
  for (const p of players) p.input.enabled = true;
  requestAnimationFrame(function loop(now) {
    // while the settings are open the game waits (clock.js), and its sound stops where it is
    games[0].sound.held = sheet.isOpen;
    const n = clock.steps(now);
    for (let i = 0; i < n && !chosen; i++) {
      for (const p of shown) {
        p.input.poll();
        p.game.step(p.input.gbaKeys());
      }
      if (vsCount) {
        carry();
        chosen = games.some(g => g.game.dp_vs_round());
      }
    }
    if (n) {
      for (const p of shown) {
        p.game.video.drawFrame(p.pixels);
        p.out.putImageData(p.image, 0, 0);
        // the round isn't in C yet: black, as the original's screens are while its stage loads
        if (chosen) { p.out.fillStyle = '#000'; p.out.fillRect(0, 0, SCREEN_W, SCREEN_H); }
      }
    }
    requestAnimationFrame(loop);
  });
  players[0].canvas.focus();
}

// the largest scale that is a whole number of the screen's own pixels, so every pixel of the game stays square and sharp
function pixelScale(fit) {
  const dpr = devicePixelRatio || 1;
  return fit * dpr >= 1 ? Math.floor(fit * dpr) / dpr : Math.max(fit, 0.25);
}
// the players' screens, side by side or one above the other, whichever fits them larger; four in two rows
function fitScreens() {
  if (!vsCount) return;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, gap = 8;
  const layouts = vsCount === 2 ? [[2, 1], [1, 2]] : [[2, 2], [vsCount, 1]];
  let best = null;
  for (const [cols, rows] of layouts) {
    const scale = pixelScale(Math.min((vw - gap * (cols - 1)) / (cols * SCREEN_W), (vh - gap * (rows - 1)) / (rows * SCREEN_H)));
    if (!best || scale > best.scale) best = { cols, scale };
  }
  screens.style.gridTemplateColumns = `repeat(${best.cols}, auto)`;
  for (const c of screens.children) {
    c.style.width = `${SCREEN_W * best.scale}px`;
    c.style.height = `${SCREEN_H * best.scale}px`;
  }
}
addEventListener('resize', fitScreens);
