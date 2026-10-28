// The launcher: one row of games to move through with the arrow keys, L and R, a swipe, a click
// or a game controller, and cards that open over it. Each card keeps the address of the page it
// stands for, so links can be shared and the browser's back button closes it. Everything here is
// added on top of plain pages: without this script, the row is a list of links.

type Input = 'keys' | 'pad' | 'touch';
type Motion = 'auto' | 'full' | 'calm';
type Theme = 'light' | 'dark';
type Address = 'push' | 'replace' | 'none';

const $ = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T => {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`launcher: ${selector} is missing`);
  return el;
};
const $$ = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T[] => [
  ...scope.querySelectorAll<T>(selector),
];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const root = document.documentElement;
const found = document.querySelector<HTMLElement>('#launcher');

try {
  if (found) start(found);
} catch (error) {
  // If something here breaks, the page falls back to its plain links instead of an empty screen.
  root.classList.remove('js');
  console.error(error);
}

function start(launcher: HTMLElement) {
  const LIGHT_BAR = '#ffffff';
  const DARK_BAR = '#050a24';

  // ---------- What the browser remembers ----------

  const store = {
    get(key: string) {
      try {
        return localStorage.getItem('dreamports:' + key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        localStorage.setItem('dreamports:' + key, value);
      } catch {}
    },
    del(key: string) {
      try {
        localStorage.removeItem('dreamports:' + key);
      } catch {}
    },
  };
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const sheetMQ = matchMedia('(max-width: 640px)');

  const storedTheme = store.get('theme');
  const storedMotion = store.get('motion');

  // ---------- Elements ----------

  const stage = $('#stage', launcher);
  const rowEl = $('#row', launcher);
  const plate = $('#nameplate', launcher);
  const plateName = $('#np-name', launcher);
  const plateDetail = $('#np-detail', launcher);
  const cursor = $('#cursor', launcher);
  const target = $('#target', launcher);
  const btnInspect = $<HTMLAnchorElement>('#btn-inspect', launcher);
  const blackout = $('#blackout');
  const boBack = $<HTMLButtonElement>('#bo-back');
  const live = $('#live');
  const settingsCard = $<HTMLDialogElement>('#card-settings');
  const aboutCard = $<HTMLDialogElement>('#card-about');
  const aboutText = $('.about-text', aboutCard);
  const cards = $$<HTMLDialogElement>('dialog.card');
  const inspectCards = new Map($$<HTMLDialogElement>('dialog[data-card="inspect"]').map((d) => [d.dataset.game!, d]));
  const gateCards = new Map($$<HTMLDialogElement>('dialog[data-card="gate"]').map((d) => [d.dataset.game!, d]));

  // The filters, from their tabs. Each one's row of slots waits in a template.
  const FILTERS = $$<HTMLAnchorElement>('.tab', launcher).map((tab) => {
    const key = tab.dataset.filter!;
    const template = $<HTMLTemplateElement>(`#slots-${key}`);
    return {
      key,
      tab,
      template,
      label: tab.textContent!.trim(),
      path: tab.getAttribute('href')!,
      paths: (tab.dataset.paths ?? '').split(' '),
      title: tab.dataset.title!,
      count: template.content.querySelectorAll('.slot[data-game]').length,
    };
  });

  const state = {
    filter: Math.max(0, FILTERS.findIndex((f) => f.key === launcher.dataset.filter)),
    sel: FILTERS.map(() => 0),
    input: (root.dataset.input as Input) || 'keys',
    open: null as HTMLDialogElement | null,
    opener: null as HTMLElement | null,
    launching: false,
    ready: false,
    sound: store.get('sound') === 'on',
    motion: (storedMotion === 'full' || storedMotion === 'calm' ? storedMotion : 'auto') as Motion,
    theme: (storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null) as Theme | null,
    aboutSec: 'dreamport',
  };
  state.sel[state.filter] = Number(launcher.dataset.sel) || 0;

  const calm = () => state.motion === 'calm' || (state.motion === 'auto' && reducedMQ.matches);
  const isDark = () => (state.theme ? state.theme === 'dark' : darkMQ.matches);

  function applyTheme() {
    if (state.theme) root.dataset.theme = state.theme;
    else delete root.dataset.theme;
    // the browser's own bars follow the page: the device's setting, or the visitor's pick
    for (const meta of $$('meta[name="theme-color"]')) {
      const light = (meta.getAttribute('media') ?? '').includes('light');
      const dark = state.theme ? state.theme === 'dark' : !light;
      meta.setAttribute('content', dark ? DARK_BAR : LIGHT_BAR);
    }
  }
  function applyMotion() {
    root.dataset.motion = calm() ? 'calm' : 'full';
  }
  function setInput(mode: Input) {
    if (state.input === mode) return;
    state.input = mode;
    root.dataset.input = mode;
  }

  function announce(text: string) {
    live.textContent = '';
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  }

  // ---------- The row ----------

  let slots: HTMLElement[] = [];
  let S = 300;
  let TH = 200;
  let D1 = 300;
  let DN = 200;
  let RISE = 6;
  let W = 0;
  let H = 0;
  const K = 0.6;
  const sel = () => state.sel[state.filter];
  const gameAt = (i: number) => slots[i]?.dataset.game ?? null;

  function buildRow() {
    sleepRow();
    const f = FILTERS[state.filter];
    rowEl.replaceChildren(f.template.content.cloneNode(true));
    slots = $$('.slot', rowEl);
    slots.forEach((el, i) => {
      el.id = `slot-${i}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-posinset', String(i + 1));
      el.setAttribute('aria-setsize', String(slots.length));
      el.setAttribute('aria-label', el.dataset.game ? `${el.dataset.title}, ${el.dataset.detail}` : 'empty slot');
      el.tabIndex = -1;
    });
    rowEl.setAttribute('aria-label', 'games: ' + f.label);
    rowEl.classList.add('no-anim');
    applySel(false);
    void rowEl.offsetWidth;
    rowEl.classList.remove('no-anim');
  }

  function slotX(d: number) {
    const a = Math.abs(d);
    const s = Math.sign(d);
    return a <= 1 ? s * a * D1 : s * (D1 + (a - 1) * DN);
  }

  function place(frac: number) {
    slots.forEach((el, i) => {
      const d = i - frac;
      const a = Math.abs(d);
      const k = 1 - (1 - K) * Math.min(a, 1);
      const y = -RISE * Math.max(0, 1 - a);
      el.style.transform = `translate3d(${slotX(d).toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
      el.style.zIndex = String(100 - Math.round(a * 10));
    });
  }

  // tiles are little screens: a 16:10 picture inside a white frame
  const bezel = (s: number) => Math.max(4, Math.round(s * 0.028));
  const tileH = (s: number) => Math.round((s - bezel(s) * 2) * 0.625 + bezel(s) * 2);

  function layout() {
    const box = launcher.getBoundingClientRect();
    W = box.width;
    H = box.height;
    const narrow = W < 560;
    const phone = W < 640;
    const topH = narrow ? 50 : 56;
    const botH = narrow ? 60 : 68;
    const stageH = H - topH - botH;
    let s = W * (phone ? 0.68 : 0.34);
    while (s > 120 && tileH(s) > stageH - 110) s -= 4;
    S = Math.round(clamp(s, 120, 560));
    TH = tileH(S);
    const cg = Math.max(8, Math.round(S * 0.03));
    RISE = Math.round(S * 0.02);
    D1 = S / 2 + cg + Math.max(18, S * 0.06) + (K * S) / 2;
    DN = K * S + Math.max(14, S * 0.05);
    // the cursor, the tile and the label under it, centred between the bars
    const block = TH + cg * 2 + 16 + 42;
    const rowY = Math.round(topH + (stageH - block) / 2 + cg + TH / 2 + RISE);
    const st = launcher.style;
    st.setProperty('--s', S + 'px');
    st.setProperty('--th', TH + 'px');
    st.setProperty('--bz', bezel(S) + 'px');
    st.setProperty('--cg', cg + 'px');
    st.setProperty('--ca', Math.max(12, Math.round(S * 0.07)) + 'px');
    st.setProperty('--rise', RISE + 'px');
    st.setProperty('--row-y', rowY + 'px');
    st.setProperty('--top-h', topH + 'px');
    st.setProperty('--bot-h', botH + 'px');
    st.setProperty('--cell', Math.max(3, Math.round(S / 52)) + 'px');
    rowEl.classList.add('no-anim');
    place(sel());
    void rowEl.offsetWidth;
    rowEl.classList.remove('no-anim');
    moveTabMark(false);
  }

  function applySel(focus: boolean) {
    const i = sel();
    slots.forEach((el, j) => {
      const on = j === i;
      el.classList.toggle('is-sel', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.tabIndex = on ? 0 : -1;
    });
    place(i);
    updatePlate();
    updateCorners();
    wakeRow();
    if (focus) slots[i].focus({ preventScroll: true });
  }

  function select(i: number, withSound = true) {
    const max = slots.length - 1;
    if (i < 0 || i > max) {
      bump(i < 0 ? -1 : 1);
      return;
    }
    if (i === sel()) return;
    state.sel[state.filter] = i;
    applySel(rowEl.contains(document.activeElement));
    grab();
    if (withSound) sound.play('move', i);
    if (!rowEl.contains(document.activeElement)) announce(slots[i].dataset.title ?? 'empty slot');
  }

  let switching = false;
  let popping = false;
  let drag: null | {
    id: number;
    x0: number;
    y0: number;
    start: number;
    frac: number;
    moved: boolean;
    lastX: number;
    lastT: number;
    v: number;
    near: number;
  } = null;
  const busy = () => !!state.open || state.launching || switching || popping || !!drag;
  function move(dir: number) {
    if (!busy()) select(sel() + dir);
  }

  function bump(dir: number) {
    sound.play('edge');
    if (calm()) return;
    rowEl.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${(-dir * S * 0.07).toFixed(1)}px)` }, { transform: 'translateX(0)' }],
      { duration: 360, easing: 'cubic-bezier(.3,.7,.3,1)' },
    );
  }

  function updatePlate() {
    const slot = slots[sel()];
    const game = slot?.dataset.game;
    const text = game ? slot.dataset.title! : 'empty slot';
    if (plateName.textContent === text) return;
    const w0 = plate.getBoundingClientRect().width;
    plateName.textContent = text;
    plateDetail.textContent = game ? slot.dataset.detail! : '';
    plate.classList.toggle('is-empty', !game);
    if (calm() || !w0 || !state.ready) return;
    const w1 = plate.getBoundingClientRect().width;
    plate.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
    $('.np-text', plate).animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
      duration: 240,
      easing: 'ease-out',
    });
  }

  // the cursor's corners pinch in and spring back out as it takes hold of the next slot
  function grab() {
    if (calm() || !state.ready) return;
    const k = Math.max(4, Math.round(S * 0.035));
    for (const el of $$('i', cursor)) {
      const dx = Number(el.dataset.dx) * k;
      const dy = Number(el.dataset.dy) * k;
      el.animate([{ transform: `translate(${-dx}px, ${-dy}px)` }, { transform: 'none' }], {
        duration: 380,
        easing: 'cubic-bezier(.25,1.6,.5,1)',
      });
    }
  }

  function updateCorners() {
    const slot = slots[sel()];
    const game = slot?.dataset.game;
    btnInspect.setAttribute('aria-disabled', String(!game));
    btnInspect.href = game ? slot.getAttribute('href')! : FILTERS[state.filter].path;
  }

  // ---------- The selected game wakes up: its recording plays from its still ----------

  const clips = new Map<string, Promise<Blob | null>>();
  function clipBlob(url: string) {
    let blob = clips.get(url);
    if (!blob) {
      blob = fetch(url)
        .then((res) => (res.ok ? res.blob() : null))
        .catch(() => null);
      clips.set(url, blob);
    }
    return blob;
  }
  function setClip(img: HTMLImageElement, src: string | null) {
    const old = img.getAttribute('src');
    if (src) img.src = src;
    else img.removeAttribute('src');
    if (old && old !== src && old.startsWith('blob:')) URL.revokeObjectURL(old);
  }
  async function play(scr: HTMLElement) {
    const url = scr.dataset.clip!;
    const blob = await clipBlob(url);
    const img = $<HTMLImageElement>('.clip', scr);
    // a fresh address every time, so the recording always starts on the still it fades in over
    const src = blob ? URL.createObjectURL(blob) : url;
    setClip(img, src);
    try {
      await img.decode();
    } catch {}
    return src;
  }
  // a wake that was overtaken leaves the screen as the newer one wants it
  function drop(scr: HTMLElement, src: string) {
    const img = $<HTMLImageElement>('.clip', scr);
    if (img.getAttribute('src') === src && !scr.classList.contains('is-awake')) setClip(img, null);
  }
  function stop(scr: HTMLElement | null) {
    if (!scr) return;
    scr.classList.remove('is-awake');
    const img = scr.querySelector<HTMLImageElement>('.clip');
    const src = img?.getAttribute('src');
    if (!img || !src) return;
    // let it fade out first; then the still shows again, and the recording stops decoding
    setTimeout(() => {
      if (!scr.classList.contains('is-awake') && img.getAttribute('src') === src) setClip(img, null);
    }, 240);
  }
  function scan(scr: HTMLElement) {
    if (calm()) return;
    $('.scan', scr).animate(
      [
        { opacity: 1, transform: 'translateY(-100%)' },
        { opacity: 1, transform: 'translateY(420%)', offset: 0.82 },
        { opacity: 0, transform: 'translateY(455%)' },
      ],
      { duration: 540, easing: 'cubic-bezier(.4,0,.3,1)' },
    );
  }

  let awake: HTMLElement | null = null;
  let wakeTimer = 0;
  let wakeRun = 0;
  function sleepRow() {
    clearTimeout(wakeTimer);
    wakeRun++;
    if (awake) {
      stop(awake);
      awake = null;
    }
  }
  // a moment after the row settles on a game, its screen wakes up; calm motion keeps it still
  function wakeRow(delay = 150) {
    sleepRow();
    if (calm() || state.open || state.launching || !state.ready) return;
    const scr = slots[sel()]?.querySelector<HTMLElement>('.screen[data-clip]');
    if (!scr) return;
    const run = wakeRun;
    wakeTimer = window.setTimeout(async () => {
      const src = await play(scr);
      if (run !== wakeRun) {
        drop(scr, src);
        return;
      }
      awake = scr;
      scr.classList.add('is-awake');
      scan(scr);
    }, delay);
  }

  // ---------- Filters ----------

  function setFilter(f: number, dir: number) {
    if (f === state.filter || switching || busy()) return;
    switching = true;
    state.filter = f;
    updateTabs(true);
    sound.play('filter', dir);
    const outCls = dir > 0 ? 'out-l' : 'out-r';
    const inCls = dir > 0 ? 'in-r' : 'in-l';
    const swap = () => {
      const hadFocus = rowEl.contains(document.activeElement);
      rowEl.classList.remove(outCls);
      rowEl.classList.add(inCls);
      buildRow();
      void rowEl.offsetWidth;
      rowEl.classList.remove(inCls);
      if (hadFocus) slots[sel()].focus({ preventScroll: true });
      switching = false;
      const n = FILTERS[f].count;
      announce(`${FILTERS[f].label}: ${n} ${n === 1 ? 'game' : 'games'} and ${slots.length - n} empty slots`);
    };
    history.replaceState(history.state, '', FILTERS[f].path);
    document.title = FILTERS[f].title;
    if (calm()) {
      swap();
      return;
    }
    rowEl.classList.add(outCls);
    setTimeout(swap, 170);
  }
  const nextFilter = () => {
    press('#btn-r');
    setFilter((state.filter + 1) % FILTERS.length, 1);
  };
  const prevFilter = () => {
    press('#btn-l');
    setFilter((state.filter - 1 + FILTERS.length) % FILTERS.length, -1);
  };
  function press(selector: string) {
    const b = $(selector, launcher);
    b.classList.add('is-pressed');
    setTimeout(() => b.classList.remove('is-pressed'), 130);
  }

  function updateTabs(anim: boolean) {
    FILTERS.forEach((f, i) => {
      const on = i === state.filter;
      f.tab.setAttribute('aria-selected', String(on));
      f.tab.tabIndex = on ? 0 : -1;
    });
    moveTabMark(anim);
  }
  function moveTabMark(anim: boolean) {
    const t = FILTERS[state.filter].tab;
    const mark = $('#tab-mark', launcher);
    const pad = parseFloat(getComputedStyle(t).paddingLeft) || 0;
    mark.style.transition = anim ? '' : 'none';
    mark.style.left = t.offsetLeft + pad + 'px';
    mark.style.width = Math.max(0, t.offsetWidth - pad * 2) + 'px';
  }

  // ---------- Swipe, drag, click and wheel ----------

  let dragEnded = -Infinity;
  stage.addEventListener('pointerdown', (e) => {
    if (busy() || e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: sel(), frac: sel(), moved: false, lastX: e.clientX, lastT: e.timeStamp, v: 0, near: sel() };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      drag.moved = true;
      rowEl.classList.add('is-dragging');
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {}
    }
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = 0.75 * drag.v + 0.25 * ((e.clientX - drag.lastX) / dt);
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    const max = slots.length - 1;
    let frac = drag.start - dx / (S * 0.8);
    if (frac < 0) frac *= 0.3;
    if (frac > max) frac = max + (frac - max) * 0.3;
    drag.frac = frac;
    place(frac);
    const near = clamp(Math.round(frac), 0, max);
    if (near !== drag.near) {
      drag.near = near;
      state.sel[state.filter] = near;
      slots.forEach((el, j) => {
        el.classList.toggle('is-sel', j === near);
        el.setAttribute('aria-selected', String(j === near));
        el.tabIndex = j === near ? 0 : -1;
      });
      updatePlate();
      updateCorners();
      wakeRow(320);
      sound.play('move', near);
    }
  });
  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    rowEl.classList.remove('is-dragging');
    if (!d.moved) return;
    dragEnded = performance.now();
    const max = slots.length - 1;
    const fling = clamp((-d.v * 260) / (S * 0.8), -3, 3);
    const goal = clamp(Math.round(d.frac + fling), 0, max);
    if (goal !== sel()) {
      state.sel[state.filter] = goal;
      sound.play('move', goal);
    }
    applySel(false);
    if (goal !== d.start) grab();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  const plainClick = (e: MouseEvent) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

  // a click (or a tap, or a screen reader's activation) picks a slot, or plays the one already picked
  stage.addEventListener('click', (e) => {
    const el = e.target as Element;
    const slotEl = el.closest<HTMLElement>('.slot');
    // a game opened in a new tab goes to its own page, the browser's usual way
    if (slotEl && !plainClick(e)) return;
    e.preventDefault();
    if (performance.now() - dragEnded < 250 || busy()) return;
    if (el.closest('.nameplate')) {
      primary();
      return;
    }
    if (!slotEl) return;
    const i = Number(slotEl.dataset.index);
    if (i === sel()) primary();
    else select(i);
  });

  let wheelAcc = 0;
  let wheelT = -Infinity;
  let wheelIdle = 0;
  stage.addEventListener(
    'wheel',
    (e) => {
      if (busy()) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelAcc += d;
      clearTimeout(wheelIdle);
      wheelIdle = window.setTimeout(() => {
        wheelAcc = 0;
      }, 180);
      const now = performance.now();
      if (Math.abs(wheelAcc) > 45 && now - wheelT > 130) {
        move(Math.sign(wheelAcc));
        wheelAcc = 0;
        wheelT = now;
      }
    },
    { passive: false },
  );

  // ---------- Actions ----------

  function primary() {
    if (busy()) return;
    const game = gameAt(sel());
    const gate = game && gateCards.get(game);
    if (!gate) {
      nope();
      return;
    }
    openCard(gate);
  }
  function nope() {
    sound.play('empty');
    if (calm()) return;
    const shake = [
      { transform: 'translateX(0)' },
      { transform: `translateX(${(-S * 0.03).toFixed(1)}px)` },
      { transform: `translateX(${(S * 0.03).toFixed(1)}px)` },
      { transform: 'translateX(0)' },
    ];
    for (const el of [$('.lift', slots[sel()]), cursor]) el.animate(shake, { duration: 300, easing: 'ease-in-out' });
  }
  function inspect(opener?: HTMLElement) {
    if (busy()) return;
    const game = gameAt(sel());
    const card = game && inspectCards.get(game);
    if (!card) {
      nope();
      return;
    }
    openCard(card, { opener });
  }

  // ---------- Cards ----------

  // Cards move only by transform and opacity, so the browser can run them off the main thread.
  // On a computer a card grows out of the button that opened it; on a phone it slides up as a sheet.
  function cardIn(dlg: HTMLDialogElement, opener: HTMLElement | null) {
    if (calm()) return dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    if (sheetMQ.matches) return dlg.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 440, easing: 'cubic-bezier(.32,.72,0,1)' });
    const b = dlg.getBoundingClientRect();
    let ox = b.width / 2;
    let oy = b.height / 2;
    const from = opener && opener.isConnected && launcher.contains(opener) ? opener.getBoundingClientRect() : null;
    if (from && from.width) {
      ox = clamp(from.left + from.width / 2 - b.left, 0, b.width);
      oy = clamp(from.top + from.height / 2 - b.top, 0, b.height);
    }
    dlg.style.transformOrigin = `${ox.toFixed(0)}px ${oy.toFixed(0)}px`;
    return dlg.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, offset: 0.4 }, { transform: 'none' }], {
      duration: 320,
      easing: 'cubic-bezier(.2,.9,.25,1)',
    });
  }
  function cardOut(dlg: HTMLDialogElement) {
    if (calm()) return dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    if (sheetMQ.matches) return dlg.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    return dlg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], {
      duration: 170,
      easing: 'cubic-bezier(.4,0,1,1)',
      fill: 'forwards',
    });
  }

  // Each card has the address of the page it stands for. Opening one from the menu adds a step
  // to the browser's history, so the back button closes it again.
  function addressOf(dlg: HTMLDialogElement) {
    if (dlg === aboutCard) return '/about/' + (state.aboutSec === 'dreamport' ? '' : '#' + state.aboutSec);
    return dlg.dataset.path ?? location.pathname;
  }
  function enterAddress(dlg: HTMLDialogElement, how: Address) {
    if (how === 'push') history.pushState({ card: true }, '', addressOf(dlg));
    else if (how === 'replace') history.replaceState(history.state, '', addressOf(dlg));
    if (dlg.dataset.title) document.title = dlg.dataset.title;
  }
  let popGuard = 0;
  function leaveAddress() {
    const f = FILTERS[state.filter];
    document.title = f.title;
    if (history.state && history.state.card) {
      popping = true;
      clearTimeout(popGuard);
      popGuard = window.setTimeout(() => {
        popping = false;
      }, 800);
      history.back();
    } else {
      history.replaceState(null, '', f.path);
    }
  }

  interface OpenOptions {
    opener?: HTMLElement | null;
    address?: Address;
    instant?: boolean;
    section?: string;
  }
  function openCard(dlg: HTMLDialogElement, opts: OpenOptions = {}) {
    if (state.launching || state.open === dlg) return;
    let opener = opts.opener ?? (document.activeElement as HTMLElement | null);
    const replacing = !!state.open;
    if (state.open) {
      opener = state.opener;
      closeCard({ instant: true, quiet: true, keepFocus: true, address: false });
    }
    if (dlg === settingsCard) syncSettings();
    state.open = dlg;
    state.opener = opener;
    // nothing behind the card moves while it is open
    sleepRow();
    launcher.classList.add('is-covered');
    for (const a of dlg.getAnimations()) a.cancel();
    // a card that opens at once gets its tint at once, without fading it in
    if (opts.instant) dlg.classList.add('is-in');
    // a card the page opened by itself becomes a proper card over the menu
    if (dlg.open) dlg.close();
    dlg.showModal();
    // one layout pass now, so the card and its tint both start from their hidden look
    dlg.getBoundingClientRect();
    if (!opts.instant) cardIn(dlg, opener);
    dlg.classList.add('is-in');
    // the card's own address comes last, below, as a step of its own
    if (dlg === aboutCard) jumpAbout(opts.section ?? 'dreamport', true, false);
    if (dlg.dataset.card === 'inspect') {
      $('.ins-text', dlg).scrollTop = 0;
      startShow(dlg, !opts.instant);
    }
    focusStart(dlg)?.focus({ preventScroll: true });
    if (!opts.instant) sound.play('open');
    enterAddress(dlg, opts.address ?? (replacing ? 'replace' : 'push'));
  }

  // where focus starts in a card: about's current section, the box to tick (or, once it is
  // ticked, the button it unlocked), or the control the card marks with autofocus
  function focusStart(dlg: HTMLDialogElement) {
    if (dlg === aboutCard) return aboutLinks.find((a) => a.getAttribute('aria-current') === 'true') ?? null;
    if (dlg.dataset.card === 'gate' && $<HTMLInputElement>('input[type="checkbox"]', dlg).checked) return $('.gate-buttons .btn', dlg);
    return dlg.querySelector<HTMLElement>('[autofocus]');
  }

  interface CloseOptions {
    instant?: boolean;
    quiet?: boolean;
    keepFocus?: boolean;
    // false when the address has already moved on, by the back button or another card
    address?: boolean;
  }
  function closeCard(opts: CloseOptions = {}) {
    const dlg = state.open;
    if (!dlg) return;
    state.open = null;
    dlg.classList.remove('is-in');
    if (!opts.quiet) sound.play('close');
    if (dlg.dataset.card === 'inspect') {
      stop(showScr);
      showScr = null;
    }
    const opener = state.opener;
    const finish = () => {
      if (state.open === dlg) return;
      if (dlg.open) dlg.close();
      if (state.open || state.launching) return;
      launcher.classList.remove('is-covered');
      if (!opts.keepFocus) {
        const back = opener && opener.isConnected && launcher.contains(opener) ? opener : null;
        (back ?? slots[sel()]).focus({ preventScroll: true });
      }
      wakeRow();
    };
    for (const a of dlg.getAnimations()) a.cancel();
    if (opts.address !== false) leaveAddress();
    if (opts.instant) {
      finish();
      return;
    }
    // the card finishes leaving before it closes, so it never cuts out halfway
    const out = cardOut(dlg);
    out.finished.then(
      () => {
        finish();
        out.cancel();
      },
      () => {},
    );
  }

  for (const dlg of cards) {
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeCard();
    });
    // if the browser closes a card by itself, catch up. The event comes a moment late, so a card
    // that has been shown again since then stays open.
    dlg.addEventListener('close', () => {
      if (state.open === dlg && !dlg.open) closeCard({ instant: true, quiet: true });
    });
    dlg.addEventListener('click', (e) => {
      const el = e.target as Element;
      if (el.closest('[data-close]')) {
        e.preventDefault();
        closeCard();
        return;
      }
      const link = el.closest<HTMLAnchorElement>('a[href]');
      if (link && plainClick(e)) {
        const href = link.getAttribute('href')!;
        // "before you play", from a game's card or its text
        if (link.hasAttribute('data-gate') || href === '#play') {
          e.preventDefault();
          const gate = gateCards.get(dlg.dataset.game ?? '');
          if (gate) openCard(gate);
          return;
        }
        if (link.dataset.sec) {
          e.preventDefault();
          jumpAbout(link.dataset.sec);
          sound.play('tick');
          return;
        }
        if (link.id === 'btn-privacy') {
          e.preventDefault();
          openCard(aboutCard, { section: 'privacy' });
          return;
        }
      }
      if (e.target !== dlg) return;
      // a click on the tint around the card closes it
      const b = dlg.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeCard();
    });
  }

  // settings
  const sndSwitch = $('#snd-switch', settingsCard);
  function syncSettings() {
    sndSwitch.setAttribute('aria-checked', String(state.sound));
    $('#snd-state', settingsCard).textContent = state.sound ? 'on' : 'off';
    $<HTMLInputElement>('#theme-light', settingsCard).checked = !isDark();
    $<HTMLInputElement>('#theme-dark', settingsCard).checked = isDark();
    $('#theme-desc', settingsCard).textContent = state.theme
      ? 'light, or dark for the evening.'
      : 'light, or dark for the evening. it follows your device until you pick one.';
    $<HTMLInputElement>('#motion-full', settingsCard).checked = !calm();
    $<HTMLInputElement>('#motion-calm', settingsCard).checked = calm();
    $('#motion-desc', settingsCard).textContent =
      state.motion === 'auto'
        ? reducedMQ.matches
          ? 'calm, because your device asks for less motion. calm keeps the games still and swaps the slides for fades.'
          : 'calm keeps the games still and swaps the slides for fades. it follows your device until you pick one.'
        : 'calm keeps the games still and swaps the slides for fades.';
    const kept: string[] = [];
    if (store.get('sound')) kept.push('menu sounds on');
    if (store.get('theme')) kept.push(store.get('theme') + ' look');
    if (store.get('motion')) kept.push(store.get('motion') + ' motion');
    $('#memory-note', settingsCard).textContent = kept.length
      ? `this browser remembers: ${kept.join(', ')}. it never leaves your device.`
      : 'the menu remembers nothing yet. what you change here stays in this browser.';
    $('#forget-wrap', settingsCard).hidden = !kept.length;
  }
  sndSwitch.addEventListener('click', () => {
    if (state.sound) {
      sound.play('off');
      state.sound = false;
      store.del('sound');
    } else {
      state.sound = true;
      store.set('sound', 'on');
      sound.play('on');
    }
    syncSettings();
    updateStatus();
  });
  for (const input of $$<HTMLInputElement>('input[name="theme"]', settingsCard)) {
    input.addEventListener('change', () => {
      state.theme = input.value as Theme;
      store.set('theme', input.value);
      applyTheme();
      syncSettings();
      sound.play('tick');
    });
  }
  for (const input of $$<HTMLInputElement>('input[name="motion"]', settingsCard)) {
    input.addEventListener('change', () => {
      state.motion = input.value as Motion;
      store.set('motion', input.value);
      applyMotion();
      wakeRow();
      syncSettings();
      sound.play('tick');
    });
  }
  $('#btn-forget', settingsCard).addEventListener('click', () => {
    for (const key of ['sound', 'theme', 'motion']) store.del(key);
    state.sound = false;
    state.theme = null;
    state.motion = 'auto';
    applyTheme();
    applyMotion();
    syncSettings();
    updateStatus();
    sndSwitch.focus();
  });

  // about
  const aboutLinks = $$<HTMLAnchorElement>('.about-nav a', aboutCard);
  let spyHold = 0;
  function jumpAbout(sec: string, instant = false, address = true) {
    const section = aboutText.querySelector<HTMLElement>(`section#${CSS.escape(sec)}`);
    if (!section) return;
    state.aboutSec = sec;
    markAbout(sec);
    spyHold = performance.now() + (instant ? 100 : 1000);
    aboutText.scrollTo({ top: Math.max(0, section.offsetTop - 16), behavior: instant || calm() ? 'auto' : 'smooth' });
    if (address && state.open === aboutCard) history.replaceState(history.state, '', addressOf(aboutCard));
  }
  function markAbout(sec: string) {
    for (const a of aboutLinks) {
      const on = a.dataset.sec === sec;
      a.setAttribute('aria-current', String(on));
      // on phones the list scrolls sideways, so keep the current section in view
      const nav = a.parentElement!;
      if (on && nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: calm() ? 'auto' : 'smooth' });
      }
    }
  }
  aboutText.addEventListener(
    'scroll',
    () => {
      if (performance.now() < spyHold) return;
      let cur = 'dreamport';
      for (const s of $$('section', aboutText)) {
        if (s.offsetTop - aboutText.scrollTop <= 60) cur = s.id;
      }
      if (aboutText.scrollTop + aboutText.clientHeight >= aboutText.scrollHeight - 4) cur = 'contact';
      if (cur !== state.aboutSec) {
        state.aboutSec = cur;
        markAbout(cur);
        if (state.open === aboutCard) history.replaceState(history.state, '', addressOf(aboutCard));
      }
    },
    { passive: true },
  );

  // inspect: the game's screen grows out of the row and wakes up
  let showScr: HTMLElement | null = null;
  function startShow(dlg: HTMLDialogElement, animate: boolean) {
    const showTile = $('.show-tile', dlg);
    const scr = showTile.querySelector<HTMLElement>('.screen[data-clip]');
    if (scr && !calm()) {
      showScr = scr;
      play(scr).then((src) => {
        if (showScr === scr && state.open === dlg) {
          scr.classList.add('is-awake');
          scan(scr);
        } else drop(scr, src);
      });
    }
    if (calm() || !animate) return;
    const tile = slots[sel()]?.querySelector('.tile');
    if (!tile || slots[sel()].dataset.game !== dlg.dataset.game) return;
    const from = tile.getBoundingClientRect();
    const to = showTile.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    showTile.animate(
      [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(from.width / to.width).toFixed(3)})` }, { transform: 'none' }],
      { duration: 560, easing: 'cubic-bezier(.2,.9,.3,1)' },
    );
  }

  // before you play: the links stay locked until the box is ticked, and the tick lasts
  // until the tab is closed
  for (const [game, dlg] of gateCards) {
    const form = $<HTMLFormElement>('form', dlg);
    const box = $<HTMLInputElement>('input[type="checkbox"]', form);
    const label = $('.check', form);
    const buttons = $$<HTMLButtonElement>('button[type="submit"]', form);
    const lockedNote = $('.note-locked', form);
    const key = `dreamports:own:${game}`;
    const sync = () => {
      for (const button of buttons) button.setAttribute('aria-disabled', String(!box.checked));
      try {
        if (box.checked) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
      } catch {}
    };
    try {
      if (sessionStorage.getItem(key) === '1') box.checked = true;
    } catch {}
    sync();
    box.addEventListener('change', () => {
      lockedNote.textContent = form.dataset.lockedNote ?? '';
      sync();
      sound.play(box.checked ? 'on' : 'tick');
    });
    box.addEventListener('invalid', (e) => {
      e.preventDefault();
      lockedNote.textContent = form.dataset.nudgeNote ?? '';
      label.classList.remove('gate-nudge');
      void label.offsetWidth;
      if (!calm()) label.classList.add('gate-nudge');
      box.focus();
      sound.play('empty');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!box.checked) return;
      const button = e.submitter instanceof HTMLButtonElement ? e.submitter : buttons[0];
      const href = button.formAction;
      if (button.dataset.icon === 'play') launch(dlg, href);
      else window.location.assign(href);
    });
  }

  // ---------- The launch ----------

  let irisAnim: Animation | null = null;
  function irisCenter() {
    const mouth = $('.t-door-mouth', target).getBoundingClientRect();
    const b = launcher.getBoundingClientRect();
    return { x: mouth.left + mouth.width / 2 - b.left, y: mouth.top + mouth.height / 2 - b.top };
  }
  function iris(closing: boolean, c: { x: number; y: number }) {
    const rad = Math.hypot(Math.max(c.x, W - c.x), Math.max(c.y, H - c.y)) + 4;
    const a = closing ? rad : 0;
    const b = closing ? 0 : rad;
    const old = irisAnim;
    irisAnim = launcher.animate(
      [
        { clipPath: `circle(${a.toFixed(1)}px at ${c.x.toFixed(1)}px ${c.y.toFixed(1)}px)` },
        { clipPath: `circle(${b.toFixed(1)}px at ${c.x.toFixed(1)}px ${c.y.toFixed(1)}px)` },
      ],
      { duration: closing ? 430 : 560, easing: closing ? 'cubic-bezier(.55,.06,.85,.3)' : 'cubic-bezier(.16,.8,.3,1)', fill: 'forwards' },
    );
    if (old) old.cancel();
    return irisAnim.finished;
  }

  // the selected game rises, drops through the doorway, and the screen closes into it
  let launchRun = 0;
  let leaving = false;
  async function launch(gate: HTMLDialogElement, href: string) {
    if (state.launching) return;
    const slotEl = slots[sel()];
    if (!slotEl || slotEl.dataset.game !== gate.dataset.game) {
      window.location.assign(href);
      return;
    }
    state.launching = true;
    // going back to the menu part way through stops the launch
    const run = ++launchRun;
    const still = () => run === launchRun;
    closeCard({ instant: true, quiet: true, keepFocus: true });
    const title = slotEl.dataset.title ?? '';
    $('#bo-name', blackout).textContent = title;
    announce('opening ' + title);
    launcher.classList.add('is-launching');
    launcher.inert = true;
    const lift = $('.lift', slotEl);
    if (calm()) {
      sound.play('iris');
      await launcher.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' }).finished.catch(() => {});
      if (still()) showBlackout(href);
      return;
    }
    sound.play('launch');
    const up = `translateY(${(-S * 0.1).toFixed(1)}px) scale(1.06)`;
    target.classList.add('is-up');
    await lift
      .animate([{ transform: 'none' }, { transform: up }], { duration: 320, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' })
      .finished.catch(() => {});
    // the doorway has finished rising by now, so its opening can be measured
    await wait(150);
    if (!still()) return;
    const mouth = $('.t-door-mouth', target).getBoundingClientRect();
    const box = slotEl.getBoundingClientRect();
    const dx = mouth.left + mouth.width / 2 - (box.left + box.width / 2);
    const dy = mouth.top + mouth.height / 2 - (box.top + box.height / 2);
    const k = (mouth.width / S) * 0.95;
    const dropEnd = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(k * 0.05).toFixed(4)})`;
    await lift.animate(
      [
        { transform: up, opacity: 1 },
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(4)})`, opacity: 1, offset: 0.68 },
        { transform: dropEnd, opacity: 0 },
      ],
      { duration: 680, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' },
    ).finished.catch(() => {});
    if (!still()) return;
    sound.play('insert');
    target.classList.add('is-flash');
    await wait(110);
    if (!still()) return;
    sound.play('iris');
    await iris(true, irisCenter()).catch(() => {});
    if (still()) showBlackout(href);
  }

  let blackTimer = 0;
  function showBlackout(href: string) {
    sleepRow();
    blackout.hidden = false;
    boBack.hidden = true;
    leaving = true;
    window.location.assign(href);
    // if the game takes long to open, offer a way back
    clearTimeout(blackTimer);
    blackTimer = window.setTimeout(() => {
      boBack.hidden = false;
      boBack.focus({ preventScroll: true });
    }, 6000);
  }

  let returning = false;
  async function back() {
    if (!state.launching || returning) return;
    returning = true;
    launchRun++;
    // if the game's page is still on its way, stop it
    if (leaving) {
      leaving = false;
      window.stop();
    }
    clearTimeout(blackTimer);
    blackout.hidden = true;
    boBack.hidden = true;
    const slotEl = slots[sel()];
    const lift = $('.lift', slotEl);
    // the game comes back up from wherever the launch left it
    const left = getComputedStyle(lift);
    const from = { transform: left.transform, opacity: left.opacity };
    target.classList.remove('is-flash');
    launcher.classList.remove('is-launching', 'is-covered');
    launcher.inert = false;
    for (const a of lift.getAnimations()) a.cancel();
    for (const a of launcher.getAnimations()) if (a !== irisAnim) a.cancel();
    sound.play('return');
    if (calm()) {
      target.classList.remove('is-up');
      irisAnim?.cancel();
      irisAnim = null;
      await launcher.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280 }).finished.catch(() => {});
    } else {
      // the screen opens again only if it had closed
      const closed = !!irisAnim;
      const rise = lift.animate([from, { transform: 'none', opacity: 1 }], {
        duration: 700,
        delay: closed ? 120 : 0,
        easing: 'cubic-bezier(.2,.9,.3,1.12)',
        fill: 'backwards',
      });
      if (closed) {
        await iris(false, irisCenter()).catch(() => {});
        irisAnim?.cancel();
        irisAnim = null;
      }
      target.classList.remove('is-up');
      await rise.finished.catch(() => {});
    }
    state.launching = false;
    returning = false;
    slotEl.focus({ preventScroll: true });
    wakeRow();
  }
  boBack.addEventListener('click', () => back());
  // coming back from the game with the browser's back button finds the menu as it was left
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !state.launching) return;
    leaving = false;
    back();
  });

  // ---------- Sounds, made in the browser and off until switched on ----------

  type Tone = { f?: number; f2?: number; type?: OscillatorType; t?: number; d?: number; g?: number; lp?: number };
  type Noise = { t?: number; d?: number; g?: number; f1?: number; f2?: number; q?: number };
  const sound = {
    ctx: null as AudioContext | null,
    out: null as GainNode | null,
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      }
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 4;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(comp).connect(this.ctx.destination);
      return true;
    },
    tone({ f = 440, f2 = 0, type = 'triangle', t = 0, d = 0.1, g = 0.1, lp = 0 }: Tone) {
      const c = this.ctx!;
      const at = c.currentTime + t + 0.005;
      const o = c.createOscillator();
      const v = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + d);
      v.gain.setValueAtTime(0.0001, at);
      v.gain.exponentialRampToValueAtTime(g, at + 0.006);
      v.gain.exponentialRampToValueAtTime(0.0001, at + d);
      let node: AudioNode = o;
      if (lp) {
        const fl = c.createBiquadFilter();
        fl.type = 'lowpass';
        fl.frequency.value = lp;
        o.connect(fl);
        node = fl;
      }
      node.connect(v).connect(this.out!);
      o.start(at);
      o.stop(at + d + 0.05);
    },
    noise({ t = 0, d = 0.3, g = 0.06, f1 = 400, f2 = 3000, q = 1.2 }: Noise) {
      const c = this.ctx!;
      const at = c.currentTime + t + 0.005;
      const len = Math.ceil(c.sampleRate * d);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(f1, at);
      bp.frequency.exponentialRampToValueAtTime(f2, at + d);
      const v = c.createGain();
      v.gain.setValueAtTime(0.0001, at);
      v.gain.exponentialRampToValueAtTime(g, at + d * 0.6);
      v.gain.exponentialRampToValueAtTime(0.0001, at + d);
      src.connect(bp).connect(v).connect(this.out!);
      src.start(at);
      src.stop(at + d + 0.05);
    },
    play(name: string, arg = 0) {
      if (!state.sound || !this.init()) return;
      // each slot has its own note, so moving along the row plays a little scale
      const N = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];
      switch (name) {
        case 'move':
          this.tone({ f: N[arg % N.length], d: 0.11, g: 0.09 });
          this.tone({ f: N[arg % N.length] * 2, type: 'sine', d: 0.06, g: 0.025 });
          break;
        case 'edge':
          this.tone({ f: 150, f2: 92, type: 'sine', d: 0.14, g: 0.2 });
          break;
        case 'empty':
          this.tone({ f: 196, f2: 130, type: 'square', d: 0.11, g: 0.05, lp: 900 });
          break;
        case 'filter':
          if (arg > 0) {
            this.tone({ f: 659.25, d: 0.07, g: 0.06, type: 'square', lp: 2400 });
            this.tone({ f: 987.77, t: 0.055, d: 0.09, g: 0.06, type: 'square', lp: 2400 });
          } else {
            this.tone({ f: 987.77, d: 0.07, g: 0.06, type: 'square', lp: 2400 });
            this.tone({ f: 659.25, t: 0.055, d: 0.09, g: 0.06, type: 'square', lp: 2400 });
          }
          break;
        case 'open':
          this.tone({ f: 659.25, d: 0.12, g: 0.07 });
          this.tone({ f: 987.77, t: 0.06, d: 0.16, g: 0.07 });
          break;
        case 'close':
          this.tone({ f: 987.77, d: 0.09, g: 0.06 });
          this.tone({ f: 659.25, t: 0.05, d: 0.13, g: 0.06 });
          break;
        case 'tick':
          this.tone({ f: 1318.51, d: 0.04, g: 0.035, type: 'square', lp: 3000 });
          break;
        case 'on':
          [523.25, 659.25, 783.99].forEach((f, i) => this.tone({ f, t: i * 0.06, d: 0.15, g: 0.08 }));
          break;
        case 'off':
          [783.99, 523.25].forEach((f, i) => this.tone({ f, t: i * 0.06, d: 0.13, g: 0.07 }));
          break;
        case 'launch':
          this.noise({ d: 0.5, g: 0.05, f1: 300, f2: 2600 });
          this.tone({ f: 392, f2: 784, d: 0.34, g: 0.05 });
          break;
        case 'insert':
          this.tone({ f: 190, f2: 58, type: 'sine', d: 0.18, g: 0.24 });
          this.noise({ d: 0.07, g: 0.05, f1: 2200, f2: 900, q: 0.8 });
          break;
        case 'iris':
          this.tone({ f: 523.25, f2: 110, type: 'sine', d: 0.44, g: 0.07 });
          break;
        case 'return':
          [392, 523.25, 659.25, 1046.5].forEach((f, i) => this.tone({ f, t: i * 0.055, d: 0.18, g: 0.06 }));
          break;
      }
    },
  };

  // ---------- Status icons ----------

  const r = (x: number, y: number, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  const ICON_SOUND_ON = r(0, 3, 2, 3) + r(2, 2, 1, 5) + r(3, 1, 1, 7) + r(4, 0, 1, 9) + r(6, 3, 1, 3) + r(8, 1, 1, 7);
  const ICON_SOUND_OFF =
    r(0, 3, 2, 3) + r(2, 2, 1, 5) + r(3, 1, 1, 7) + r(4, 0, 1, 9) + r(6, 2) + r(10, 2) + r(7, 3) + r(9, 3) + r(8, 4) + r(7, 5) + r(9, 5) + r(6, 6) + r(10, 6);
  const ICON_PAD =
    r(2, 0, 9, 1) + r(1, 1, 11, 1) + r(0, 2, 13, 4) + r(0, 6, 4, 1) + r(9, 6, 4, 1) + r(0, 7, 3, 1) + r(10, 7, 3, 1) +
    `<g class="hole">${r(2, 3, 3, 1)}${r(3, 2, 1, 3)}${r(9, 2)}${r(10, 4)}</g>`;

  let padConnected = false;
  function updateStatus() {
    const snd = $('#ico-sound', launcher);
    const pad = $('#ico-pad', launcher);
    snd.innerHTML = state.sound ? ICON_SOUND_ON : ICON_SOUND_OFF;
    snd.classList.toggle('is-off', !state.sound);
    pad.innerHTML = ICON_PAD;
    pad.classList.toggle('is-off', !padConnected);
    $('#status', launcher).setAttribute(
      'aria-label',
      `settings. menu sounds ${state.sound ? 'on' : 'off'}. ${padConnected ? 'a controller is connected.' : 'no controller connected.'}`,
    );
  }

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as Element;
    setInput('keys');
    // only escape goes back: a held enter key must not undo the launch it started
    if (state.launching) {
      if (e.key === 'Escape' && !e.repeat) {
        e.preventDefault();
        back();
      }
      return;
    }
    if (state.open) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const onTab = !!t.closest?.('[role="tablist"]');
    const onSlot = !!t.closest?.('.slot');
    const onControl = !!t.closest?.('button, a, input');
    switch (k) {
      case 'ArrowLeft':
        e.preventDefault();
        if (onTab) {
          prevFilter();
          FILTERS[state.filter].tab.focus();
        } else move(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (onTab) {
          nextFilter();
          FILTERS[state.filter].tab.focus();
        } else move(1);
        break;
      case 'Home':
        e.preventDefault();
        if (!busy()) select(0);
        break;
      case 'End':
        e.preventDefault();
        if (!busy()) select(slots.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (onControl && !onSlot) return;
        e.preventDefault();
        primary();
        break;
      case 'l':
      case 'q':
      case '[':
      case 'PageUp':
        e.preventDefault();
        prevFilter();
        break;
      case 'r':
      case 'e':
      case ']':
      case 'PageDown':
        e.preventDefault();
        nextFilter();
        break;
      case 'i':
        e.preventDefault();
        inspect();
        break;
      case 's':
        e.preventDefault();
        if (!busy()) openCard(settingsCard);
        break;
      case 'a':
        e.preventDefault();
        if (!busy()) openCard(aboutCard);
        break;
    }
  });

  // ---------- Game controllers ----------

  const pad = { prev: [] as boolean[], dir: 0, next: 0 };
  function focusables(scope: ParentNode) {
    return $$('button:not([hidden]), a[href], input:not([type="radio"]), input[type="radio"]:checked, [tabindex="0"]', scope).filter(
      (el) => !el.closest('[hidden]') && el.getClientRects().length,
    );
  }
  function pollPads(now: number) {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    } catch {
      return;
    }
    const gp = pads.find((p): p is Gamepad => !!p && p.connected);
    if (!!gp !== padConnected) {
      padConnected = !!gp;
      updateStatus();
    }
    if (!gp) return;
    const down = (i: number) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edges: number[] = [];
    for (let i = 0; i < gp.buttons.length; i++) {
      const d = down(i);
      if (d && !pad.prev[i]) edges.push(i);
      pad.prev[i] = d;
    }
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const ry = gp.axes[3] || 0;
    // the right stick scrolls the open card's text
    if (state.open && Math.abs(ry) > 0.2) {
      const area = $$('.about-text, .ins-text, .card-body', state.open).find((el) => el.scrollHeight > el.clientHeight + 2);
      if (area) area.scrollTop += ry * 16;
    }
    let dir = 0;
    if (down(15) || ax > 0.55) dir = 1;
    else if (down(14) || ax < -0.55) dir = -1;
    else if (down(13) || ay > 0.55) dir = 2;
    else if (down(12) || ay < -0.55) dir = -2;
    let step = 0;
    if (dir !== pad.dir) {
      pad.dir = dir;
      pad.next = now + 380;
      step = dir;
    } else if (dir && now >= pad.next) {
      pad.next = now + 120;
      step = dir;
    }
    if (!edges.length && !step) return;
    setInput('pad');
    if (state.launching) {
      if (edges.includes(1)) back();
      return;
    }
    if (state.open) {
      const dlg = state.open;
      if (edges.includes(1)) {
        closeCard();
        return;
      }
      const here = document.activeElement as HTMLInputElement | null;
      if ((step === 1 || step === -1) && here && here.type === 'radio') {
        // left and right switch between a setting's choices
        const group = $$<HTMLInputElement>(`input[name="${here.name}"]`, dlg);
        const other = group[clamp(group.indexOf(here) + step, 0, group.length - 1)];
        if (other && other !== here) {
          other.focus();
          other.click();
        }
      } else if (step) {
        const list = focusables(dlg);
        const at = list.indexOf(document.activeElement as HTMLElement);
        const nextEl = list[clamp(at + (step > 0 ? 1 : -1), 0, list.length - 1)];
        if (nextEl) {
          nextEl.focus();
          nextEl.scrollIntoView({ block: 'nearest' });
        }
      }
      if (edges.includes(0) && document.activeElement && dlg.contains(document.activeElement)) (document.activeElement as HTMLElement).click();
      return;
    }
    if (step === 1 || step === -1) move(step);
    if (edges.includes(0)) primary();
    if (edges.includes(2)) inspect();
    if (edges.includes(3) && !busy()) openCard(aboutCard);
    if (edges.includes(9) && !busy()) openCard(settingsCard);
    if (edges.includes(4)) prevFilter();
    if (edges.includes(5)) nextFilter();
  }
  // controllers are read once a frame, and only while one is connected
  let padLoop = 0;
  function padTick(now: number) {
    pollPads(now);
    padLoop = padConnected ? requestAnimationFrame(padTick) : 0;
  }
  function startPads() {
    if (!padLoop) padLoop = requestAnimationFrame(padTick);
  }
  window.addEventListener('gamepadconnected', () => {
    padConnected = true;
    updateStatus();
    startPads();
  });
  window.addEventListener('gamepaddisconnected', () => {
    padConnected = false;
    updateStatus();
  });

  // ---------- Pointer and touch hints ----------

  window.addEventListener(
    'pointerdown',
    (e) => {
      setInput(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'keys');
    },
    true,
  );

  // ---------- Buttons and links ----------

  $('#btn-l', launcher).addEventListener('click', prevFilter);
  $('#btn-r', launcher).addEventListener('click', nextFilter);
  FILTERS.forEach((f, i) =>
    f.tab.addEventListener('click', (e) => {
      if (!plainClick(e)) return;
      e.preventDefault();
      setFilter(i, i > state.filter ? 1 : -1);
    }),
  );
  $('#btn-settings', launcher).addEventListener('click', (e) => {
    if (!busy()) openCard(settingsCard, { opener: e.currentTarget as HTMLElement });
  });
  $('#status', launcher).addEventListener('click', (e) => {
    if (!busy()) openCard(settingsCard, { opener: e.currentTarget as HTMLElement });
  });
  $('#btn-about', launcher).addEventListener('click', (e) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    if (!busy()) openCard(aboutCard, { opener: e.currentTarget as HTMLElement });
  });
  btnInspect.addEventListener('click', (e) => {
    if (!plainClick(e) && btnInspect.getAttribute('aria-disabled') !== 'true') return;
    e.preventDefault();
    inspect(btnInspect);
  });

  // ---------- The address ----------

  // the browser's back and forward buttons open and close cards, and switch filters
  function followAddress(first: boolean) {
    if (state.launching) return;
    const path = location.pathname;
    let card: HTMLDialogElement | null = null;
    let game: string | null = null;
    if (path === '/about/') card = aboutCard;
    for (const ins of inspectCards.values()) {
      if (ins.dataset.path === path) {
        game = ins.dataset.game!;
        card = location.hash === '#play' ? (gateCards.get(game) ?? ins) : ins;
      }
    }
    // the filter that shows this address, and the game it is about
    let f = FILTERS.findIndex((filter) => filter.paths.includes(path));
    if (game) f = FILTERS.findIndex((filter) => !!filter.template.content.querySelector(`.slot[data-game="${CSS.escape(game!)}"]`));
    if (f >= 0 && f !== state.filter) {
      state.filter = f;
      updateTabs(false);
      buildRow();
    }
    if (game) {
      const i = slots.findIndex((el) => el.dataset.game === game);
      if (i >= 0 && i !== sel()) {
        state.sel[state.filter] = i;
        rowEl.classList.add('no-anim');
        applySel(false);
        void rowEl.offsetWidth;
        rowEl.classList.remove('no-anim');
      }
    }
    if (card) {
      // a card that is open in the page's HTML gives way to the one the address asks for
      for (const d of cards) if (d.open && d !== card && d !== state.open) d.close();
      const section = card === aboutCard ? location.hash.slice(1) || 'dreamport' : undefined;
      if (state.open !== card) openCard(card, { address: 'none', instant: first, section });
      else if (section) jumpAbout(section, true);
      if (card.dataset.title) document.title = card.dataset.title;
    } else {
      if (state.open) closeCard({ address: false });
      document.title = FILTERS[state.filter].title;
    }
  }
  window.addEventListener('popstate', () => {
    if (popping) {
      popping = false;
      clearTimeout(popGuard);
      return;
    }
    followAddress(false);
  });

  // ---------- Clock ----------

  const clock = $('#clock', launcher);
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  function tick() {
    clock.textContent = fmt.format(new Date()).replace(/[  ]/g, ' ').toLowerCase();
  }

  // ---------- Start ----------

  rowEl.setAttribute('role', 'listbox');
  rowEl.setAttribute('aria-orientation', 'horizontal');
  applyTheme();
  applyMotion();
  root.dataset.input = state.input;
  reducedMQ.addEventListener('change', () => {
    applyMotion();
    wakeRow();
    if (state.open === settingsCard) syncSettings();
  });
  darkMQ.addEventListener('change', () => {
    if (state.open === settingsCard) syncSettings();
  });
  updateStatus();
  tick();
  setInterval(tick, 10000);
  buildRow();
  layout();
  updateTabs(false);
  launcher.classList.add('is-laid');
  // the page's own card, if it has one, opens over the menu
  followAddress(true);
  // when the address ends in a #, the browser moves focus to what it points at once the page has
  // loaded (or drops it), so focus goes back to the open card's first control
  if (location.hash) {
    window.addEventListener(
      'load',
      () =>
        requestAnimationFrame(() =>
          setTimeout(() => {
            const dlg = state.open;
            const at = document.activeElement;
            if (dlg && (!at || at === dlg || at === document.body)) focusStart(dlg)?.focus({ preventScroll: true });
          }),
        ),
      { once: true },
    );
  }
  new ResizeObserver(() => layout()).observe(launcher);
  document.fonts?.ready.then(() => layout());
  try {
    if (navigator.getGamepads && [...navigator.getGamepads()].some((p) => p && p.connected)) startPads();
  } catch {}
  requestAnimationFrame(() => {
    state.ready = true;
    wakeRow(400);
  });
  // get the cards' text face ready while nothing is happening, so the first card opens without a hitch
  const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 600));
  idle(() => {
    for (const font of ['400 17px "Newsreader Variable"', 'italic 400 17px "Newsreader Variable"', '700 15px Monocraft']) {
      document.fonts?.load(font).catch(() => {});
    }
  });
}
