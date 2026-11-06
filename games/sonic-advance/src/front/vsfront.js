// The VS menus on one page: one GBA's game for each player, each on its own screen from power-on, all stepped together a
// frame at a time and joined by a link cable (engine/link.js), as the multiplayer round is (multiplayer.js). Every GBA
// goes through the logos, the title screen and the main menu by itself, and the players choose VS on each; the VS menus
// then talk over the link (modeselect.js and the screens after it) until they have chosen the round, which `onRound`
// starts. The first two players share the keyboard, the others play with controllers.

import { createLink } from '../engine/link.js';
import { createInput, PLAYER_KEYS, playerPads } from '../engine/input.js';
import { openSave } from '../engine/save.js';
import { createFrontEnd } from './front.js';
import { createClock, GBA_FRAME_MS } from '../../../../kit/gba/clock.js';
import { proof } from '../../../../kit/gba/proof.js';

/**
 * Starts `count` GBAs on `container`, a screen for each. `save` is the first player's (kept in the browser); the others
 * play with saves kept nowhere, or, with `resume`, the ones the GBAs had ({ saves, gbas: [{ vsLink, gameMode, seed }] }) as a round
 * ends, the front ends starting at the continue screen. `onRound(round)` is called once, between frames, when the menus have chosen the round,
 * with what they chose and what to resume from. Returns { gbas, link, stop }.
 */
export function startVsFront({ container, rom, offsets, count, sound, save, onRound, softReset, resume = null }) {
  const link = createLink(count);
  const gbas = [];
  let chosen = null, frame = 0, stopped = false;
  container.replaceChildren();
  container.dataset.players = String(count);
  for (let id = 0; id < count; id++) {
    const canvas = document.createElement('canvas');
    canvas.className = 'screen';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `Player ${id + 1}'s screen`);
    container.append(canvas);
    const input = createInput({ keys: PLAYER_KEYS[id], pads: playerPads(id, count) });
    proof?.watch(canvas, input, id);
    const vs = { round: settings => { chosen ??= settings; } };
    const mine = resume ? resume.saves[id] : id === 0 ? save : openSave(null);
    const front = createFrontEnd(canvas, rom, offsets, input, sound.forGba(id), mine, () => {}, { link, id, count, driven: true, courseSelect: false, softReset, vs, resume: resume?.gbas[id] });
    gbas.push({ id, canvas, input, front, save: mine });
  }

  const clock = createClock(GBA_FRAME_MS);
  function loop(now) {
    if (stopped) return;
    const n = clock.steps(now);
    for (let i = 0; i < n && !chosen; i++) {
      for (const g of gbas) g.front.step();
      link.endFrame();
    }
    if (n) for (const g of gbas) g.front.draw();
    if (chosen) {
      // the stage is read from the ROM now: black, as the original's screens are while its stage loads
      for (const g of gbas) { const c = g.canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, g.canvas.width, g.canvas.height); }
      stop();
      onRound({ ...chosen, resume: { saves: gbas.map(g => g.save), gbas: gbas.map(g => ({ vsLink: g.front.ctx.vsLink, gameMode: g.front.ctx.gameMode, seed: g.front.ctx.seed })) } });
      return;
    }
    frame = requestAnimationFrame(loop);
  }
  function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    for (const g of gbas) g.front.stop();
  }
  clock.reset();
  frame = requestAnimationFrame(loop);
  gbas[0].canvas.focus();
  return { gbas, link, stop };
}
