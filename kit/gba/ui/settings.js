// The settings every Game Boy Advance Dreamport starts with, made from its layout of keys and buttons alone: the
// settings button in the top-left corner, as on dreamports.net, and the sheet it opens over the game (sheet.js),
// with the way back to the game and the controls (controls-view.js), which list every key and controller button
// the layout gives, the console's button each presses, and what it does where the game says. H, or View + Menu on
// a controller, opens and closes them too, and while they're open the game waits. With the controller drawn on
// touch screens (touch.js), they have its Button opacity too. A game with settings of its own writes them in its
// page and makes the sheet itself, as Sonic Advance Dreamport does.

import { holdClocks } from '../clock.js';
import { createSheet } from './sheet.js';
import { createControlsView, SETTINGS_CONTROLS } from './controls-view.js';

const pixels = (w, h, d) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
const SLIDERS = pixels(9, 9, 'M0 1h9v1H0zM5 0h2v3H5zM0 4h9v1H0zM1 3h2v3H1zM0 7h9v1H0zM4 6h2v3H4z');
const PAUSED = pixels(7, 9, 'M0 0h2v9H0zM5 0h2v9H5z');
const PLAY = pixels(4, 7, 'M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z');
const PAD = '<svg viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true"><path fill-rule="evenodd" d="M0 1h9v7H0zM1 2v5h7V2z"/><path d="M2 3h1v1H2zM4 3h1v1H4zM6 3h1v1H6zM3 5h3v1H3z"/></svg>';
const CHEVRON = pixels(3, 5, 'M0 0h1v1h1v1h1v1H2v1H1v1H0z');
const escape = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * Adds the settings to `stage`, the game's part of the page, for the player whose buttons `input` reads
 * (input.js): `brand` names the game over them, `what` says what a button does, by its name in the layout, and
 * `dpad` what the d-pad does, and `note` goes under the controls. `touch`, the controller drawn on touch screens
 * (touch.js), adds how solid its buttons are. Returns the sheet (sheet.js).
 */
export function createSettings(stage, input, { brand, what = {}, note = '', touch = null }) {
  stage.insertAdjacentHTML('beforeend', `
    <button type="button" class="settings-open" aria-label="Settings" aria-controls="sheet-wrap" aria-expanded="false">${SLIDERS}</button>
    <div class="sheet-wrap" id="sheet-wrap" hidden>
      <div class="sheet-veil"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <section class="view" aria-labelledby="settings-title">
          <header class="sheet-head">
            <div class="sheet-title"><p class="sheet-crumb">${escape(brand)}</p><h2 id="settings-title">Settings</h2></div>
            <span class="sheet-paused">${PAUSED}Paused</span>
            <button type="button" class="sheet-close" data-close aria-label="Close" title="Close">×</button>
          </header>
          <div class="sheet-body settings-body single">
            <div class="settings-col sheet-rise">
              <button type="button" class="resume" data-close>${PLAY}Back to the game<kbd class="key">H</kbd></button>
              <ul class="rows">
                <li><button type="button" class="row" data-controls>
                  ${PAD}
                  <span class="row-text">Controls<span class="row-hint">Keys and controller</span></span>
                  ${CHEVRON.replace('<svg', '<svg class="chev"')}
                </button></li>
                ${touch ? `<li class="opacity-row"><label class="row" for="button-opacity">
                  <span class="row-text">Button opacity<span class="row-hint">The buttons drawn around the game</span></span>
                  <input type="range" id="button-opacity">
                </label></li>` : ''}
              </ul>
            </div>
          </div>
          <footer class="sheet-foot" aria-hidden="true"></footer>
        </section>
      </div>
    </div>`);
  const button = stage.querySelector('.settings-open'), wrap = stage.querySelector('.sheet-wrap');
  const settings = wrap.querySelector('.view');

  // while they're open the game waits: its clocks hold (clock.js) and what was held is let go, so it goes on from
  // the same frame once they close, and its keys wait too, so the settings take them
  let keysWere = false;
  function hold(on) {
    holdClocks(on);
    input.release();
    if (on) { keysWere = input.enabled; input.enabled = false; } else input.enabled = keysWere;
  }
  const sheet = createSheet(stage, wrap, {
    onOpen() { button.setAttribute('aria-expanded', 'true'); hold(true); },
    onClose() { button.setAttribute('aria-expanded', 'false'); hold(false); if (!stage.hidden) stage.querySelector('canvas')?.focus(); },
    canOpen: () => !stage.hidden,
  });
  sheet.view('settings', { el: settings, first: () => settings.querySelector('.resume') });
  createControlsView(sheet, { controls: [layoutControls(input.layout, what), SETTINGS_CONTROLS], note });
  settings.querySelector('[data-controls]').addEventListener('click', () => sheet.go('controls'));
  if (touch) touch.bindSlider(settings.querySelector('#button-opacity'));

  // a finger opens them as it lifts, so iOS doesn't bring up its magnifier on one held down; the mouse and the
  // keyboard click
  let tappedAt = -Infinity;
  button.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch') return;
    tappedAt = e.timeStamp;
    sheet.open();
  });
  button.addEventListener('click', e => { if (e.timeStamp - tappedAt > 800) sheet.open(); });
  addEventListener('keydown', e => {
    if (e.code !== 'KeyH' || stage.hidden || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (sheet.isOpen) sheet.close(); else sheet.open();
  });
  return sheet;
}

// a key as the settings name it, by its KeyboardEvent.code
const ARROWS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
const KEYS = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Escape: 'Esc', Tab: 'Tab',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-',
  Equal: '=', Backquote: '`', Backslash: '\\',
};
const keyName = code => ARROWS[code] ?? KEYS[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
// a controller's button as the settings name it, by its number in the standard layout
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L stick', 'R stick', '↑', '↓', '←', '→'];
// the console's buttons, by their names in input.js's KEY
const CONSOLE = {
  A: 'A button', B: 'B button', L: 'L button', R: 'R button', START: 'Start', SELECT: 'Select',
  UP: 'd-pad up', DOWN: 'd-pad down', LEFT: 'd-pad left', RIGHT: 'd-pad right',
};
const DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * The game's buttons as a kind of control for the controls view (controls-view.js), from its `layout` (input.js):
 * each with the keys and the controller's buttons that press it, and what it does, as `what` says by its name, or
 * else the console's button it presses. The d-pad is one row while the arrow keys and the controller's d-pad press
 * it, which the left stick does too, and `what.dpad` says what it does.
 */
export function layoutControls(layout, what = {}) {
  const keysOf = button => Object.entries(layout.keys)
    .filter(([, b]) => (Array.isArray(b) ? b.includes(button) : b === button)).map(([code]) => keyName(code));
  const padOf = button => (layout.pad[button] ?? []).map(i => PAD_NAMES[i] ?? `Button ${i}`);
  const dpad = DIRECTIONS.every((b, i) => layout.gba?.[b] === b.toUpperCase() && keysOf(b).join() === '↑↓←→'[i]
    && padOf(b).join() === PAD_NAMES[12 + i]);
  const rows = [];
  for (const b of layout.buttons) {
    if (dpad && DIRECTIONS.includes(b)) {
      if (!rows.some(r => r.dpad)) rows.push({ dpad: true, keys: ['↑↓←→'], pad: ['D-pad', 'L stick'], what: what.dpad ?? "The console's d-pad" });
      continue;
    }
    const gba = layout.gba?.[b];
    rows.push({ keys: keysOf(b), pad: padOf(b), what: what[b] ?? (gba ? `The console's ${CONSOLE[gba]}` : b) });
  }
  return { name: 'Buttons', rows };
}
