// The asset viewer: what the game decodes from the player's ROM, in parts the game makes (such as the ROM's facts,
// the sprites and the levels), drawn like the dreamports.net launcher, light or dark as it is. A page of its own
// shows it, every part one under the other, where its back arrow, Esc or B on a controller goes back; the game's
// settings show it as one of their views (sheet.js), its parts listed on the left and the one picked on the right.
//
// The game's `parts(assets, fileName)` makes them from what it decoded, `assets`, and returns { parts, stop() }:
// each part { title, el }, `el` a section made with assetPart(), and `stop` ending whatever they animate.

import { connectedPads } from '../input.js';
import { padsHeld } from './pad-nav.js';
import { pickedTheme, isDark } from './theme.js';
import { brandTag } from './rom-setup.js';

const escape = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const BACK = '<svg viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true"><path d="M3 0h1v1H3zM2 1h1v1H2zM1 2h1v1H1zM0 3h7v1H0zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3z" fill="currentColor"/></svg>';
const SCROLL = 60;   // px a step of the d-pad scrolls
const CHEVRON = '<svg class="chev" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1H2v1H1v1H0z"/></svg>';

/** A part of the viewer: a section headed `title`, holding the HTML `inner`. */
export function assetPart(title, inner = '') {
  const el = document.createElement('section');
  el.className = 'assets-part';
  el.innerHTML = `<h2>${escape(title)}</h2>${inner}`;
  return el;
}

/** A canvas showing `source` (a canvas or an image) `scale` times its size, its pixels kept sharp. */
export function scaled(source, scale) {
  const c = document.createElement('canvas');
  c.width = source.width * scale; c.height = source.height * scale;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/**
 * Renders the viewer into `host`, under the game's name, `brand`, its back arrow a link to `back.href` named
 * `back.label`; `rom` is the name of the game whose ROM it reads, and `parts` makes its parts. Returns
 * { show(assets, fileName), ask(message, onFile), clear() }: `show` draws what `assets` hold, `ask` asks for the
 * ROM with a button and a drop on the page, and `clear` lets go of it all.
 */
export function createAssetsView(host, { back, brand, rom, parts }) {
  host.innerHTML = `
    <div class="assets-page">
      <div class="setup-bar">
        <a class="setup-back" href="${back.href}" aria-label="${back.label}" title="${back.label}">${BACK}</a>
      </div>
      <div class="setup-scroll">
        <div class="setup-page">
          <header class="setup-head">
            <p class="setup-brand">${brandTag(escape(brand))}</p>
            <h1>Asset viewer</h1>
            <p class="setup-intro">Decoded in this browser from your ROM.</p>
          </header>
          <div class="assets-body"></div>
        </div>
      </div>
    </div>`;
  const body = host.querySelector('.assets-body'), backEl = host.querySelector('.setup-back'), scroller = host.querySelector('.setup-scroll');

  // the launcher's look, picked in its settings or else the device's
  function paint() {
    const theme = pickedTheme();
    if (theme) host.dataset.theme = theme;
    else delete host.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#050a24' : '#ffffff');
  }

  // Esc, or B on a controller, goes back; the d-pad or the left stick scrolls
  addEventListener('keydown', e => { if (e.code === 'Escape' && !host.hidden) backEl.click(); });
  const held = new Set();
  let showing = false;
  (function read() {
    requestAnimationFrame(read);
    const pads = connectedPads();
    if (host.hidden || !pads.length) { showing = false; return; }
    const now = padsHeld(pads);
    if (showing) {
      if (now.has('b') && !held.has('b')) backEl.click();
      if (now.has('up')) scroller.scrollBy({ top: -SCROLL / 4 });
      if (now.has('down')) scroller.scrollBy({ top: SCROLL / 4 });
    }
    showing = true;
    held.clear();
    now.forEach(b => held.add(b));
  })();

  let stop = () => {};
  const part = (title, inner) => body.appendChild(assetPart(title, inner));

  function show(assets, fileName) {
    clear();
    paint();
    const shown = parts(assets, fileName);
    stop = shown.stop;
    body.append(...shown.parts.map(p => p.el));
  }

  function ask(message, onFile) {
    clear();
    paint();
    const el = part('Your ROM', `
      <p class="assets-note">${escape(message)}</p>
      <p class="assets-status" role="status" aria-live="polite"></p>
      <button type="button" class="assets-choose">Choose your ${escape(rom)} ROM</button>
      <input type="file" accept=".gba,.agb,.bin" hidden>`);
    const input = el.querySelector('input'), status = el.querySelector('.assets-status');
    const use = async file => {
      if (!file) return;
      try { await onFile(await file.arrayBuffer(), file.name, text => { status.textContent = text; }); }
      catch (err) { status.textContent = err.message || String(err); }
    };
    el.querySelector('.assets-choose').addEventListener('click', () => input.click());
    input.addEventListener('change', () => use(input.files[0]));
    host.ondragover = e => e.preventDefault();
    host.ondrop = e => { e.preventDefault(); use(e.dataTransfer.files[0]); };
  }

  function clear() {
    stop();
    host.ondragover = host.ondrop = null;
    body.replaceChildren();
  }

  return { show, ask, clear };
}

/**
 * Adds the viewer to the game's settings, `sheet`, as its view 'assets': the parts `parts` makes of what `assets()`
 * gives, such as the level being played, decoded as the view comes in and let go as it goes. `rom` is the name of
 * the game whose ROM it reads.
 */
export function createAssetsSheetView(sheet, assets, { rom, parts }) {
  const note = `Decoded in this browser from your ${rom} ROM.`;
  let shown = null, at = 0;
  const { el, body } = sheet.view('assets', {
    title: 'Asset viewer',
    show() {
      const from = assets();
      shown = from ? parts(from) : null;
      at = 0;
      navs.innerHTML = (shown?.parts ?? []).map((p, i) => `<li><button type="button" class="nav" data-part="${i}" aria-current="false">${escape(p.title)}${CHEVRON}</button></li>`).join('');
      pick(0);
    },
    hide() { shown?.stop(); shown = null; navs.replaceChildren(); main.replaceChildren(); },
    first: () => el.querySelector('[data-back]'),
    tabs: () => [...el.querySelectorAll('[data-part]')],
  });
  body.innerHTML = `
    <div class="split">
      <aside class="side sheet-rise">
        <p class="side-note">${escape(note)}</p>
        <ul class="navs"></ul>
      </aside>
      <section class="main"></section>
    </div>`;
  const navs = el.querySelector('.navs'), main = el.querySelector('.main');
  const mainNote = Object.assign(document.createElement('p'), { className: 'main-note', textContent: note });
  function pick(i) {
    at = i;
    for (const b of navs.querySelectorAll('[data-part]')) b.setAttribute('aria-current', String(+b.dataset.part === at));
    const part = shown?.parts[at]?.el;
    if (!part) { main.innerHTML = `<p class="assets-empty">Add your ${escape(rom)} ROM to see what it holds.</p>`; return; }
    main.replaceChildren(part, mainNote);
    main.scrollTop = 0;
  }
  navs.addEventListener('click', e => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    pick(+b.dataset.part);
    el.querySelector('.split').scrollTop = 0;
    main.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}
