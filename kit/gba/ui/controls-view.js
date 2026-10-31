// The controls, a view of the settings (sheet.js): every key with a keyboard, or every button with a controller,
// and what it does, in kinds listed on the left, the one picked on the right. A controller connected, or a touch
// screen with an Xbox controller's buttons drawn around the game, starts on the controller's.

import { connectedPads } from '../input.js';
import { keyHtml } from './keys.js';

const escape = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const CHEVRON = '<svg class="chev" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1H2v1H1v1H0z"/></svg>';

// the settings' own keys and buttons (sheet.js), which a game's list of controls takes in where it wants them
export const SETTINGS_CONTROLS = { name: 'Settings', rows: [
  { keys: ['H'], pad: ['View', '+', 'Menu'], what: 'Open or close the settings, which hold the game' },
  { keys: ['↑↓←→'], pad: ['D-pad', 'L stick'], what: 'Move between the buttons' },
  { keys: ['Z'], pad: ['A'], what: 'Press the button picked' },
  { keys: ['Esc', 'X'], pad: ['B'], what: 'Back a step, or close the settings' },
  { keys: ['Q', 'E'], pad: ['LB', 'RB'], what: 'The previous or the next tab' },
  { keys: ['↑', '↓'], pad: ['R stick'], what: 'Scroll a list or a picture once it is picked' },
] };

/**
 * Adds the game's controls to `sheet` as its view 'controls': `controls`, the kinds of control, each { name, rows },
 * and under them `note`. Each row has its keys, its controller's buttons (`pad`: the same as the keys when left
 * out, or null when a controller has it only in the settings) and what it does (`what`), or is a heading over the
 * rows after it (`group`). A key written {name} in a row is the keys or the buttons `tokens` gives for it, for a
 * keyboard (`tokens.keys`) and for a controller (`tokens.pad`).
 */
export function createControlsView(sheet, { controls, tokens = { keys: {}, pad: {} }, note = '' }) {
  let mode = null, at = 0;   // 'keys' or 'pad', null until the player picks one; the kind of control shown
  const { el, body } = sheet.view('controls', {
    title: 'Controls',
    show() {
      at = 0;
      fill(mode ?? (connectedPads().length || matchMedia('(pointer: coarse)').matches ? 'pad' : 'keys'));
      main.scrollTop = 0;
    },
    first: () => el.querySelector('[data-back]'),
    tabs: () => [...el.querySelectorAll('[data-part]')],
  });
  body.innerHTML = `
    <div class="split">
      <aside class="side sheet-rise">
        <div class="modes" role="group" aria-label="Show the controls of">
          <button type="button" class="chip" data-mode="keys" aria-pressed="true">Keyboard</button>
          <button type="button" class="chip" data-mode="pad" aria-pressed="false">Controller</button>
        </div>
        <ul class="navs">${controls.map((c, i) => `<li><button type="button" class="nav" data-part="${i}" aria-current="false">${c.name}${CHEVRON}</button></li>`).join('')}</ul>
        <p class="side-note">${note}</p>
      </aside>
      <section class="main">
        <div class="controls-part">
          <h3></h3>
          <ul class="ctl-list sheet-rise"></ul>
        </div>
        <p class="main-note">${note}</p>
      </section>
    </div>`;
  const main = el.querySelector('.main'), list = el.querySelector('.ctl-list');
  let shownMode = 'keys';

  // a key, or what a {token} stands for, for the input shown
  const expand = keys => keys.flatMap(k => { const t = k.match(/^\{(\w+)\}$/); return t ? tokens[shownMode][t[1]] : [k]; });
  const keysHtml = keys => keys.map(k => (k === '+' || k === '/' ? `<span>${k}</span>` : keyHtml(k, shownMode === 'pad'))).join('');

  function fill(how) {
    shownMode = how;
    for (const b of el.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === how));
    for (const b of el.querySelectorAll('[data-part]')) b.setAttribute('aria-current', String(+b.dataset.part === at));
    const part = controls[at];
    el.querySelector('.controls-part h3').textContent = part.name;
    // each row can be picked with the arrows or a controller, so a long list scrolls to it
    list.innerHTML = part.rows.map(r => {
      if (r.group) return `<li class="ctl-group">${r.group}</li>`;
      const keys = how === 'pad' && r.pad !== undefined ? r.pad : r.keys;
      const shown = keys === null ? '<span class="ctl-none">In the settings</span>' : keysHtml(expand(keys));
      const what = escape(r.what).replace(/\{(\w+)\}/g, (_, t) => tokens[how][t].map(k => keyHtml(k, how === 'pad')).join(''));
      return `<li class="ctl" data-nav tabindex="-1"><span class="ctl-keys">${shown}</span><span class="ctl-what">${what}</span></li>`;
    }).join('');
  }

  el.addEventListener('click', e => {
    const part = e.target.closest('[data-part]'), how = e.target.closest('[data-mode]');
    if (!part && !how) return;
    if (part) { at = +part.dataset.part; main.scrollTop = 0; el.querySelector('.split').scrollTop = 0; }
    if (how) mode = how.dataset.mode;
    fill(mode ?? shownMode);
    list.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}
