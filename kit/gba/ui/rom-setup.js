// The game page's start: a row for each ROM the game reads, the one it runs on and any its optional extras take
// from, with the switches for those extras under it. A ROM is chosen on its row or dropped on it, or dropped
// anywhere on the page, where it goes to the row of the game its header names. Each is read as soon as it is
// chosen, and kept in this browser if the player wants, so Play starts the game straight away.
// It is drawn like the dreamports.net launcher the game is opened from, light or dark as the launcher is. While the
// game runs, its rows are lent to the settings' Your ROMs (sheet.js), where they work the same.

import { bindController } from './setup-controller.js';
import { acceptRoms } from './rom-types.js';
import { darkDevice, pickedTheme, isDark } from './theme.js';

const GBA_BYTES = 32 * 1024 * 1024;   // the largest Game Boy Advance cartridge

// pixel art on the grid of the page's font, Monocraft: a unit is one of its pixels, 2 px at its 18 px size
const pixels = (name, width, height, path) =>
  `<svg class="${name}" viewBox="0 0 ${width} ${height}" width="${width * 2}" height="${height * 2}" shape-rendering="crispEdges" aria-hidden="true"><path d="${path}" fill="currentColor" fill-rule="evenodd"/></svg>`;
const ICONS = {
  reading: pixels('mark-reading', 7, 7, 'M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2z'),
  ready: pixels('mark-ready', 7, 7, 'M5 1h2v1H5zM4 2h2v1H4zM0 3h2v1H0zM3 3h2v1H3zM1 4h3v1H1zM2 5h1v1H2z'),
  play: pixels('play-icon', 4, 7, 'M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z'),
  drop: pixels('drop-icon', 7, 7, 'M3 0h1v5H3zM1 2h1v1H1zM5 2h1v1H5zM2 3h1v1H2zM4 3h1v1H4zM0 5h1v1H0zM6 5h1v1H6zM0 6h7v1H0z'),
  back: pixels('back-icon', 7, 7, 'M3 0h1v1H3zM2 1h1v1H2zM1 2h1v1H1zM0 3h7v1H0zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3z'),
  add: pixels('add-icon', 5, 5, 'M2 0h1v2H2zM0 2h5v1H0zM2 3h1v2H2z'),
};

// whether the page before this one is the dreamports.net menu: a page of the same site outside the games, which
// are under /play/
function cameFromMenu() {
  if (history.length < 2 || !location.pathname.startsWith('/play/')) return false;
  try {
    const from = new URL(document.referrer);
    return from.origin === location.origin && !from.pathname.startsWith('/play/');
  } catch {
    return false;
  }
}

const escape = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// the word Dreamport in the game's name as a tag, as dreamports.net shows it
export const brandTag = html => html.replace(/\bDreamport\b/, '<span class="dp-tag">$&</span>');
// "A", "A or B", "A, B or C"
const either = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? '');
// waits for the page to draw what was just set, or a moment when it isn't drawing (a hidden tab)
const drawn = () => new Promise(resolve => { requestAnimationFrame(() => setTimeout(resolve)); setTimeout(resolve, 100); });

/**
 * Renders the screen into `host`, under the game's name, `brand`, with its way back to `home`, the game's own page
 * on dreamports.net, where it goes when the player didn't come from its menu. The ROMs are kept in `roms`
 * (rom/store.js). Each of `slots` is { key, store, title, required, accept, claims(buffer), read(buffer, progress),
 * unload(), extras, console, maxBytes }: `store` is its key in `roms`; `claims` says whether a file's header names
 * this game; `console` is the one the ROM is for and `maxBytes` the largest it can be (a Game Boy Advance one, 32
 * MB, unless they say otherwise); `read` reads the ROM and resolves to a line about it (its region), or throws
 * with a message for the player, keeping the ROM it had; `unload` lets go of that one; `extras` (none by default)
 * are its options, each { label, hint, keys, key, get(), set(on), auto }, where `hint` says what it does, `keys`
 * (if any) the keys that use it, shown only to a keyboard, `key` is the key that switches it in the game and
 * `auto` turns it on when the ROM is chosen. `onPlay()` starts the game once every required ROM is read, and
 * `onChange()` is told whenever a ROM comes in or goes.
 */
export function createRomSetup(host, { brand, home, roms, heading, intro, slots, onPlay, onChange = () => {} }) {
  slots = slots.map(slot => ({ ...slot, extras: slot.extras ?? [] }));
  const maxBytes = Math.max(...slots.map(s => s.maxBytes ?? GBA_BYTES));
  const consoles = [...new Set(slots.map(s => s.console ?? 'Game Boy Advance'))];
  host.innerHTML = `
    <div class="setup">
      <div class="setup-bar">
        <button type="button" class="setup-back" aria-label="Back to Dreamports" title="Back to Dreamports">${ICONS.back}</button>
        <div class="pad" data-state="gone"><span class="pad-icon" aria-hidden="true"></span><span class="pad-note" role="status" aria-live="polite"></span></div>
      </div>
      <div class="setup-scroll">
        <div class="setup-page">
          <header class="setup-head">
            <p class="setup-brand">${brandTag(escape(brand))}</p>
            <h1>${heading}</h1>
            <p class="setup-intro">${intro}</p>
          </header>
          <ul class="roms" aria-label="Your ROMs">${slots.map(row).join('')}</ul>
          <div class="setup-play">
            <button type="button" class="play" disabled><kbd>Enter</kbd>${ICONS.play}<span class="play-label">Play</span></button>
            <p class="play-note" aria-live="polite"></p>
          </div>
          <footer class="setup-foot">
            <label class="remember"><input type="checkbox" checked> Remember on this device</label>
            <button type="button" class="link forget" hidden>Forget the saved ROMs</button>
          </footer>
        </div>
      </div>
      <div class="setup-drag" aria-hidden="true"><div>${ICONS.drop}<span>Drop your ROMs</span><small>Each one goes to its own game</small></div></div>
    </div>`;

  function row(s) {
    const id = `rom-${s.key}`;
    return `
      <li class="rom" data-slot="${s.key}" data-state="empty">
        <div class="rom-main">
          <span class="rom-mark">${ICONS.reading}${ICONS.ready}</span>
          <div class="rom-text">
            <h2 id="${id}-title">${s.title}</h2>
            <p class="rom-detail" id="${id}-detail"></p>
          </div>
          <button type="button" class="rom-add${s.required ? ' needed' : ''}" data-file aria-describedby="${id}-title ${id}-detail">${ICONS.add}<span>Add</span></button>
          <div class="rom-actions">
            <button type="button" class="rom-change" data-file aria-describedby="${id}-title">Change</button>
            <button type="button" class="rom-remove" aria-label="Remove ${s.title}" title="Remove">×</button>
          </div>
          <span class="rom-bar" role="progressbar" aria-label="Reading ${s.title}"><span></span></span>
        </div>
        <p class="rom-status" role="status" aria-live="polite"></p>
        ${s.extras.length ? `<ul class="rom-extras">${s.extras.map((e, i) => `
          <li><label class="switch">
            <span class="switch-text"><span class="switch-label">${e.label}</span><span class="switch-hint">${e.hint}${e.keys ? `<span class="switch-keys">, ${e.keys}</span>` : ''}</span></span>
            <kbd title="${e.key} switches it in the game">${e.key}</kbd>
            <input type="checkbox" role="switch" data-extra="${i}">
            <span class="switch-track" aria-hidden="true"><span></span></span>
          </label></li>`).join('')}</ul>` : ''}
        <input type="file" multiple hidden>
      </li>`;
  }

  const $ = sel => host.querySelector(sel);
  const play = $('.play'), list = $('.roms'), foot = $('.setup-foot');
  let note = $('.play-note');
  let lent = null;   // where the rows are lent: { list, foot, note, drop } in the settings, or null
  const remember = $('.remember input'), forget = $('.forget');
  const rows = Object.fromEntries(slots.map(s => {
    const el = host.querySelector(`.rom[data-slot="${s.key}"]`);
    const q = sel => el.querySelector(sel);
    acceptRoms(q('input[type=file]'), s.accept);
    return [s.key, {
      slot: s, el, token: 0, saved: false, about: '',
      input: q('input[type=file]'), status: q('.rom-status'), text: q('.rom-text'), detail: q('.rom-detail'),
      extras: [...el.querySelectorAll('[data-extra]')],
    }];
  }));

  // the launcher's look: the one picked in its settings, read again when the page comes back from the browser's
  // history, else the device's. The browser's bar takes the page's colour while the screen shows, and the game's
  // night blue again while the game does.
  const barColour = document.querySelector('meta[name="theme-color"]'), gameColour = barColour?.content;
  function paint() {
    const theme = pickedTheme();
    if (theme) host.dataset.theme = theme;
    else delete host.dataset.theme;
    barColour?.setAttribute('content', host.hidden ? gameColour : isDark() ? '#050a24' : '#ffffff');
  }
  paint();
  addEventListener('pageshow', paint);
  darkDevice.addEventListener('change', paint);
  new MutationObserver(paint).observe(host, { attributes: true, attributeFilter: ['hidden'] });

  // back to dreamports.net: from its menu, back in the browser's history, so the menu comes back as it was left
  $('.setup-back').addEventListener('click', () => {
    if (cameFromMenu()) history.back();
    else location.href = home;
  });

  // the line under a ROM's name: while it's missing, whether the game needs it, where it has others to tell it from,
  // or else the extras it brings (which show once it's in); once it's in, what was read (while it's being read, the
  // reading's progress). It wraps after a dot or a comma, never before one or inside an extra's name.
  function setState(c, state) {
    c.el.dataset.state = state;
    const ready = state === 'ready';
    const line = parts => parts.filter(Boolean).join(' · ').replaceAll(' · ', '\u00a0· ');
    // a name kept on one line: no break at its spaces, or after its hyphens (a word joiner, as the fonts have no
    // hyphen that doesn't break)
    const whole = name => name.replaceAll(' ', '\u00a0').replaceAll('-', '-\u2060');
    if (ready) c.detail.textContent = c.about;
    else if (state === 'empty') {
      c.detail.textContent = c.slot.required ? (slots.length > 1 ? 'Required' : '')
        : line(['Optional', c.slot.extras.map(e => whole(e.label)).join(', ')]);
    }
    c.extras.forEach((box, i) => { box.disabled = !ready; box.checked = ready && c.slot.extras[i].get(); });
    update();
  }

  function say(c, text, kind = 'info') {
    c.status.textContent = text;
    c.status.dataset.kind = kind;
  }

  // the Play button, and the line under it while a ROM is being read
  function update() {
    const all = Object.values(rows);
    const missing = all.filter(c => c.slot.required && c.el.dataset.state !== 'ready');
    const reading = all.some(c => c.el.dataset.state === 'reading');
    play.disabled = missing.length > 0 || reading;
    forget.hidden = !all.some(c => c.saved);
    note.textContent = reading ? 'Reading…' : '';
    onChange();
  }

  // reads `buffer` into the row's game, resolving to null or what's wrong with it; `store` keeps it in this
  // browser, `auto` turns its extras on. A ROM it can't read leaves the one it had.
  async function load(c, buffer, name, { store = false, auto = false, saved = false } = {}) {
    const token = ++c.token, had = c.el.dataset.state === 'ready';
    say(c, '');
    c.detail.textContent = 'Reading…';
    setState(c, 'reading');
    await drawn();
    try {
      const detail = await c.slot.read(buffer, async text => {
        if (token === c.token) c.detail.textContent = text;
        await drawn();
      });
      if (token !== c.token) return null;
      c.text.title = name;
      c.about = detail;
      c.saved = saved || (store && await roms.remember(name, buffer, c.slot.store));
      if (auto) c.slot.extras.forEach(e => { if (e.auto) e.set(true); });
      setState(c, 'ready');
      return null;
    } catch (error) {
      const message = error.message || String(error);
      if (token !== c.token) return message;
      setState(c, had ? 'ready' : 'empty');
      say(c, message, 'error');
      return message;
    }
  }

  // a chosen or dropped file: to the row of the game its header names, else to `target` (whose check then says
  // what's wrong with it). Resolves to { key, error }: the game it went to and, when it couldn't be read, why.
  async function addFile(file, target, auto, alone) {
    const into = target && rows[target];
    const fail = error => { if (into) say(into, error, 'error'); else showNote(error); return { key: null, error }; };
    if (file.size > maxBytes) return fail(`${file.name} is too large to be a ${either(consoles)} ROM.`);
    const buffer = await file.arrayBuffer();
    const c = Object.values(rows).find(c => c.slot.claims(buffer)) ?? into;
    if (!c) return fail(`${file.name} isn't ${either(slots.map(s => s.title))}.`);
    const error = await load(c, buffer, file.name, { store: remember.checked, auto });
    if (!error && alone && into && into !== c) say(into, `That was ${c.slot.title}, so it went to its own row.`);
    return { key: c.slot.key, error };
  }
  function showNote(text) {
    const el = note;
    el.textContent = text;
    el.dataset.kind = 'error';
    setTimeout(() => { delete el.dataset.kind; update(); }, 5000);
  }

  /**
   * Adds `files`, each to its game's row (`target`'s when its header names none); `auto` turns their extras on.
   * Resolves to { key, error } for each: the game it went to, and why it couldn't be read when it couldn't.
   */
  async function add(files, target = null, { auto = true } = {}) {
    const results = [];
    for (const file of files) results.push(await addFile(file, target, auto, files.length === 1));
    return results;
  }

  for (const c of Object.values(rows)) {
    const pick = () => c.input.click();
    c.el.querySelector('.rom-add').addEventListener('click', pick);
    c.el.querySelector('.rom-change').addEventListener('click', pick);
    c.el.querySelector('.rom-main').addEventListener('click', e => {
      if (c.el.dataset.state === 'empty' && !e.target.closest('button')) pick();
    });
    c.input.addEventListener('change', () => { const files = [...c.input.files]; c.input.value = ''; add(files, c.slot.key); });
    c.el.querySelector('.rom-remove').addEventListener('click', async () => {
      c.token++;
      c.slot.unload();
      c.slot.extras.forEach(e => e.set(false));
      await roms.forget(c.slot.store);
      c.saved = false;
      c.about = '';
      c.text.removeAttribute('title');
      setState(c, 'empty');
      say(c, `${c.slot.title} was removed${c.slot.required ? '' : '; its extras are off'}.`);
      c.el.querySelector('.rom-add').focus();
    });
    c.extras.forEach((box, i) => box.addEventListener('change', () => c.slot.extras[i].set(box.checked)));
    c.el.addEventListener('dragover', e => { e.preventDefault(); c.el.classList.add('over'); });
    c.el.addEventListener('dragleave', e => { if (!c.el.contains(e.relatedTarget)) c.el.classList.remove('over'); });
  }

  // files dragged over the page: the overlay (or, lent, the settings' place to drop them), and on a drop each file
  // to its game's row
  let depth = 0;
  const showing = () => !!lent || !host.hidden;
  const dragging = on => (lent ? lent.drop?.classList.toggle('over', on) : host.classList.toggle('dragging', on));
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  addEventListener('dragenter', e => { if (!showing() || !hasFiles(e)) return; depth++; dragging(true); });
  addEventListener('dragleave', () => { if (depth && --depth === 0) dragging(false); });
  addEventListener('dragover', e => { if (showing() && hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!showing() || !hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dragging(false);
    list.querySelectorAll('.rom.over').forEach(el => el.classList.remove('over'));
    add([...e.dataTransfer.files], e.target.closest?.('.rom')?.dataset.slot ?? null);
  });

  play.addEventListener('click', () => { if (!play.disabled) onPlay(); });
  host.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !play.disabled && !e.target.closest('button, input, label, a')) { e.preventDefault(); onPlay(); }
  });
  forget.addEventListener('click', async () => {
    for (const c of Object.values(rows)) {
      await roms.forget(c.slot.store);
      c.saved = false;
    }
    update();
    note.textContent = 'The saved ROMs were removed from this browser. The ones above stay until you leave the page.';
  });

  // a controller's A on a button that opens the file list, which browsers open only from the mouse or the keyboard
  const blocked = el => say(rows[el.closest('.rom').dataset.slot], 'Your browser opens the file list only from the mouse or the keyboard. You can also drop the file here.');
  bindController(host, { blocked });

  for (const c of Object.values(rows)) setState(c, 'empty');
  // the ROMs kept from an earlier visit, each read again
  const restored = Promise.all(Object.values(rows).map(async c => {
    const saved = await roms.load(c.slot.store);
    if (saved && c.el.dataset.state === 'empty') await load(c, saved.buffer, saved.name, { saved: true });
  })).then(() => { if (!play.disabled) play.focus({ preventScroll: true }); });

  return {
    add, restored,
    /** Shows the extras as they are now (they can also be changed in the game). */
    refresh() { for (const c of Object.values(rows)) setState(c, c.el.dataset.state); },
    blocked,
    /** How many of the ROMs are in, and how many there are. */
    count: () => ({ ready: Object.values(rows).filter(c => c.el.dataset.state === 'ready').length, all: slots.length }),
    /**
     * Lends the rows to the settings: into `to.list`, with the box to remember them into `to.foot`, what's said
     * about them in `to.note`, and `to.drop` lit while a file is dragged over the page. `null` takes them back.
     */
    lend(to) {
      lent = to;
      depth = 0;
      host.classList.remove('dragging');
      if (to) { to.list.append(list); to.foot.append(foot); } else { $('.setup-play').before(list); $('.setup-play').after(foot); }
      note = to?.note ?? $('.play-note');
      delete note.dataset.kind;
      update();
    },
    focus() { (play.disabled ? host.querySelector('.rom[data-state="empty"] .rom-add') : play)?.focus(); },
  };
}
