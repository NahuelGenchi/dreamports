// The controller drawn around the game on touch screens, made from the game's layout alone: the Xbox controller's
// buttons the layout gives (input.js), drawn like the settings button and see-through as the settings' Button
// opacity says (kit.css), until a real controller is connected. With them, the game's screen as large as it fits at
// a whole number of the display's pixels: in the whole window, or on a touch screen held upright in what's between
// the settings button and the buttons below it; buttons that cover part of it are more see-through. Sonic Advance
// Dreamport draws its own in its page, for its widescreen view and its players' screens side by side.

import { connectedPads } from '../input.js';
import { SCREEN_W, SCREEN_H } from '../video.js';

const ARROW = '<svg viewBox="0 0 5 3" shape-rendering="crispEdges"><path d="M2 0h1v1H2zM1 1h3v1H1zM0 2h5v1H0z"/></svg>';
// the controller's buttons by their numbers in the standard layout, as they're drawn: Select and Start for View and
// Menu, as the console names them
const pill = (i, name, kind = '') => `<button type="button" class="pill${kind}" data-pad-button="${i}" tabindex="-1">${name}</button>`;
const round = (i, name) => `<button type="button" class="round ${name.toLowerCase()}" data-pad-button="${i}" tabindex="-1">${name}</button>`;
// how solid the drawn buttons can be, in %: the settings' Button opacity, 60 at first
const OPACITY = { min: 20, max: 100, step: 5, start: 60 };

/**
 * Draws the controller in `stage`, the game's part of the page, for the player whose buttons `input` reads
 * (input.js), and keeps `screen`, the game's canvas, sized among its buttons. `key` names the game in this browser's
 * storage, where the buttons' opacity is kept. Returns { el, opacity, setOpacity(value), bindSlider(slider) }.
 */
export function createTouch(stage, input, { screen = stage.querySelector('canvas'), key }) {
  // the controller's buttons the layout gives, with those its extras bring
  const { pad, extras = {} } = input.layout;
  const used = new Set([pad, ...Object.values(extras).map(e => e.pad ?? {})].flatMap(p => Object.values(p).flat()));
  const has = (...ids) => ids.filter(i => used.has(i));
  const shoulders = (side, ids, names) => (ids.length ? `<div class="shoulders ${side}">${ids.map(i => pill(i, names[i])).join('')}</div>` : '');
  const face = has(3, 2, 1, 0);
  stage.insertAdjacentHTML('beforeend', `
    <div class="touch" aria-hidden="true">
      ${has(12, 13, 14, 15).length ? `<div class="dpad" data-pad>${['up', 'right', 'down', 'left'].map(d => `<span class="arm" data-dir="${d}">${ARROW}</span>`).join('')}</div>` : ''}
      ${shoulders('left', has(6, 4), { 6: 'LT', 4: 'LB' })}
      ${shoulders('right', has(5, 7), { 5: 'RB', 7: 'RT' })}
      ${has(8).length ? pill(8, 'Select', ' select') : ''}
      ${has(9).length ? pill(9, 'Start', ' start') : ''}
      ${face.length ? `<div class="face">${face.map(i => round(i, 'ABXY'[i])).join('')}</div>` : ''}
    </div>`);
  const el = stage.lastElementChild;
  input.bindTouch(el);
  // touches on the game are cancelled, but in the settings, so iOS doesn't bring up its magnifier on a finger held
  // down or scroll the page under it
  stage.addEventListener('touchstart', e => { if (!stage.classList.contains('sheet-open')) e.preventDefault(); }, { passive: false });

  // the drawn buttons step aside while a controller is connected, looked for each frame as browsers don't all say
  // when one comes (and show one only once a button on it is pressed); the settings button stays
  requestAnimationFrame(function watchPads() {
    const on = connectedPads().length > 0;
    if (on !== el.hidden) { el.hidden = on; fit(); }
    requestAnimationFrame(watchPads);
  });

  // the room the game has: the whole window, or on a touch screen held upright what's between the settings button
  // (the stage's padding, kit.css) and the highest of the buttons below the game, with how much is left under it
  const portrait = matchMedia('(pointer: coarse) and (orientation: portrait)');
  function room() {
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    if (!portrait.matches || el.hidden || !el.children.length) return { width, height, below: 0 };
    const top = parseFloat(getComputedStyle(stage).paddingTop) || 0;
    const bottom = Math.min(...[...el.children].map(c => c.getBoundingClientRect().top)) - 16;
    return { width, height: Math.max(SCREEN_H, bottom - top), below: Math.max(0, height - bottom) };
  }
  // the screen at the largest scale that is a whole number of the display's pixels, so they stay square and sharp,
  // in the middle of its room; a tiny window shrinks it instead
  function fit() {
    if (stage.hidden) return;
    const { width, height, below } = room();
    stage.style.paddingBottom = below ? `${below}px` : '';
    const dpr = devicePixelRatio || 1, fits = Math.min(width / SCREEN_W, height / SCREEN_H);
    const scale = fits * dpr >= 1 ? Math.floor(fits * dpr) / dpr : fits;
    screen.style.width = `${SCREEN_W * scale}px`;
    screen.style.height = `${SCREEN_H * scale}px`;
    // on a screen too wide or too square for the buttons to fit beside the game, those that cover part of it are
    // more see-through
    const view = screen.getBoundingClientRect();
    for (const group of el.children) {
      const r = group.getBoundingClientRect();
      group.classList.toggle('covers', r.width > 0 && r.left < view.right && r.right > view.left && r.top < view.bottom && r.bottom > view.top);
    }
  }
  // as the page shows the game, and as the window turns or changes size (the stage's whole box, which the padding
  // fit() gives it doesn't change)
  new ResizeObserver(fit).observe(stage, { box: 'border-box' });

  // how solid the buttons are, kept in this browser; the settings button and the buttons that cover the game are a
  // step fainter (kit.css)
  const KEPT = `${key}.touchOpacity`;
  let opacity = OPACITY.start;
  try {
    const kept = Number(localStorage.getItem(KEPT) ?? NaN);
    if (kept >= OPACITY.min && kept <= OPACITY.max) opacity = kept;
  } catch { /* storage blocked: the first opacity stands */ }
  const sliders = new Set();
  function show() {
    stage.style.setProperty('--t-opacity', String(opacity / 100));
    for (const s of sliders) s.value = String(opacity);
  }
  show();
  function setOpacity(value) {
    opacity = Math.min(OPACITY.max, Math.max(OPACITY.min, value));
    show();
    try { localStorage.setItem(KEPT, String(opacity)); } catch { /* not remembered */ }
  }

  /** Makes `slider`, a range input such as the settings' Button opacity, set how solid the buttons are. */
  function bindSlider(slider) {
    sliders.add(slider);
    Object.assign(slider, { min: OPACITY.min, max: OPACITY.max, step: OPACITY.step, value: opacity });
    slider.addEventListener('input', () => setOpacity(Number(slider.value)));
    // a finger anywhere along it moves it, where iOS only moves a slider by its knob
    slider.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    const slideTo = e => {
      const r = slider.getBoundingClientRect(), at = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      setOpacity(OPACITY.min + Math.round(at * (OPACITY.max - OPACITY.min) / OPACITY.step) * OPACITY.step);
    };
    slider.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      slider.setPointerCapture(e.pointerId);
      slideTo(e);
    });
    slider.addEventListener('pointermove', e => { if (e.pointerType === 'touch' && slider.hasPointerCapture(e.pointerId)) slideTo(e); });
  }

  return { el, get opacity() { return opacity; }, setOpacity, bindSlider };
}
