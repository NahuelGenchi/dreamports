// The launcher: one row of games to move through with the arrow keys, L and R, a swipe, a click
// or a game controller, and cards that take its place as full screens: a game's page, a Dreamport's
// page in the Make row, about, settings, the player's profile and other players' public ones (filled by profile.ts). Each card keeps the address of the page it stands for, so links can be shared and the
// browser's back button closes it. Everything here is
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

  const storedTheme = store.get('theme');
  const storedMotion = store.get('motion');

  // ---------- Elements ----------

  const stage = $('#stage', launcher);
  const rowEl = $('#row', launcher);
  const corners = $('.corners', launcher);
  const padHint = $('#pad-hint', launcher);
  const plate = $('#nameplate', launcher);
  const plateName = $('#np-name', launcher);
  const plateDetail = $('#np-detail', launcher);
  const plateNumbers = $('#np-numbers', launcher);
  const plateHelp = $('#np-help', launcher);
  const rowLead = $('#row-lead', launcher);
  const cursor = $('#cursor', launcher);
  const target = $('#target', launcher);
  const btnSearch = $<HTMLButtonElement>('#btn-search', launcher);
  const searchBox = $('#search', launcher);
  const searchInput = $<HTMLInputElement>('#search-input', searchBox);
  const blackout = $('#blackout');
  const boBack = $<HTMLButtonElement>('#bo-back');
  const live = $('#live');
  const settingsCard = $<HTMLDialogElement>('#card-settings');
  const aboutCard = $<HTMLDialogElement>('#card-about');
  const aboutText = $('.about-text', aboutCard);
  const profileCard = $<HTMLDialogElement>('#card-profile');
  const playerCard = $<HTMLDialogElement>('#card-player');
  const cards = $$<HTMLDialogElement>('dialog.card');
  const inspectCards = new Map($$<HTMLDialogElement>('dialog[data-card="inspect"]').map((d) => [d.dataset.game!, d]));
  const makeCards = $$<HTMLDialogElement>('dialog[data-card="make"]');
  // a game's page and a Dreamport's page in the Make row both show the game's picture, which grows out of its place in
  // the row as the page opens and flies back as it closes
  const hasHero = (dlg: HTMLDialogElement | null) => dlg?.dataset.card === 'inspect' || dlg?.dataset.card === 'make';

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
      lead: tab.dataset.lead ?? '',
      count: template.content.querySelectorAll('.slot[data-game]').length,
    };
  });

  const state = {
    filter: Math.max(0, FILTERS.findIndex((f) => f.key === launcher.dataset.filter)),
    sel: FILTERS.map(() => 0),
    input: (root.dataset.input as Input) || 'keys',
    open: null as HTMLDialogElement | null,
    opener: null as HTMLElement | null,
    // the card that has the menu's place: a game's page, about or settings
    view: null as HTMLDialogElement | null,
    launching: false,
    ready: false,
    sound: store.get('sound') === 'on',
    motion: (storedMotion === 'full' || storedMotion === 'calm' ? storedMotion : 'auto') as Motion,
    theme: (storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null) as Theme | null,
    aboutSec: 'dreamport',
    // what the search field holds while a search is on
    search: null as string | null,
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

  // keep: the game to stay on, where the new row has it, or else the first place
  function buildRow(keep?: string | null) {
    sleepRow();
    const f = FILTERS[state.filter];
    rowEl.replaceChildren(f.template.content.cloneNode(true));
    const words = searchWords();
    if (words.length) narrow(words);
    slots = $$('.slot', rowEl);
    if (keep !== undefined) state.sel[state.filter] = Math.max(0, slots.findIndex((el) => el.dataset.game === keep));
    state.sel[state.filter] = Math.min(sel(), slots.length - 1);
    slots.forEach((el, i) => {
      el.id = `slot-${i}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-posinset', String(i + 1));
      el.setAttribute('aria-setsize', String(slots.length));
      const numbers = el.dataset.numbers ? `. ${el.dataset.numbers}` : '';
      const detail = el.dataset.detail ? `, ${el.dataset.detail}` : '';
      const help = el.dataset.help ? `. ${el.dataset.help}` : '';
      el.setAttribute('aria-label', el.dataset.title ? `${el.dataset.title}${detail}${numbers}${help}` : (el.dataset.note ?? 'Empty slot'));
      el.tabIndex = -1;
    });
    rowEl.setAttribute('aria-label', 'Games: ' + f.label + (words.length ? `, matching ${state.search}` : ''));
    for (const el of [searchInput, btnSearch]) el.setAttribute('aria-label', 'Search ' + f.label);
    searchInput.placeholder = 'Search ' + f.label;
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
    // the bottom bar sits above the strip a phone keeps for its home bar
    const homeBar = parseFloat(getComputedStyle(corners).marginBottom) || 0;
    const stageH = H - topH - botH - homeBar;
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
    placeLead();
    placePadHint(topH, rowY - RISE - TH / 2 - cg);
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
    if (withSound) sound.play('move');
    if (!rowEl.contains(document.activeElement)) announce(slots[i].dataset.title ?? 'Empty slot');
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
    // a game, or the Make row's way to start a Dreamport
    const named = slot?.dataset.title;
    const text = named ?? slot?.dataset.note ?? 'Empty slot';
    if (plateName.textContent === text) return;
    const w0 = plate.getBoundingClientRect().width;
    plateName.textContent = text;
    plateDetail.textContent = (named && slot.dataset.detail) || '';
    // a Dreamport's two numbers, code ported and gameplay proven, each kept whole when they need two lines
    const numbers = named && slot.dataset.numbers ? slot.dataset.numbers.split(' · ') : [];
    plateNumbers.replaceChildren(...numbers.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
    plateHelp.textContent = (named && slot.dataset.help) || '';
    plate.classList.toggle('is-empty', !named);
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

  // ---------- The selected game wakes up: its recording plays from its still ----------

  // A recording is a short silent video at 60 frames a second, kept in two forms: AV1, the
  // smaller, for a device that decodes it in hardware, and H.264 for every other, since every
  // phone and computer decodes that in hardware. Each is fetched whole before it plays, so it
  // never stops to load.
  let clipEnd: Promise<string> | null = null;
  function clipFile(base: string) {
    clipEnd ??= (async () => {
      try {
        const info = await navigator.mediaCapabilities.decodingInfo({
          type: 'file',
          video: { contentType: 'video/mp4; codecs="av01.0.04M.08"', width: 736, height: 416, bitrate: 1_500_000, framerate: 60 },
        });
        if (info.supported && info.smooth && info.powerEfficient) return '.av1.mp4';
      } catch {}
      return '.h264.mp4';
    })();
    return clipEnd.then((end) => base + end);
  }
  const clips = new Map<string, Promise<Blob | null>>();
  function clipBlob(url: string, priority: 'auto' | 'low' = 'auto') {
    let blob = clips.get(url);
    if (!blob) {
      blob = fetch(url, { priority } as RequestInit)
        .then((res) => (res.ok ? res.blob() : null))
        .catch(() => null);
      clips.set(url, blob);
    }
    return blob;
  }
  // fetches a recording before it is needed, behind everything else
  function prefetch(base: string | undefined) {
    if (base && !calm()) clipFile(base).then((url) => clipBlob(url, 'low'));
  }
  function setClip(vid: HTMLVideoElement, src: string | null) {
    const old = vid.getAttribute('src');
    if (src) vid.src = src;
    else {
      // an empty video stops decoding and lets its memory go
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    }
    if (old && old !== src && old.startsWith('blob:')) URL.revokeObjectURL(old);
  }
  // once the first frame is on the screen, so the video fades in over its still without a gap
  function firstFrame(vid: HTMLVideoElement) {
    return new Promise<void>((done) => {
      const late = setTimeout(done, 600);
      const go = () => {
        clearTimeout(late);
        done();
      };
      const v = vid as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(go);
      else vid.addEventListener('playing', go, { once: true });
    });
  }
  async function play(scr: HTMLElement) {
    const url = await clipFile(scr.dataset.clip!);
    const blob = await clipBlob(url);
    const vid = $<HTMLVideoElement>('.clip', scr);
    // a fresh address every time, so the recording always starts on the still it fades in over
    const src = blob ? URL.createObjectURL(blob) : url;
    setClip(vid, src);
    vid.muted = true;
    try {
      await vid.play();
      await firstFrame(vid);
    } catch {}
    return src;
  }
  // a wake that was overtaken leaves the screen as the newer one wants it
  function drop(scr: HTMLElement, src: string) {
    const vid = $<HTMLVideoElement>('.clip', scr);
    if (vid.getAttribute('src') === src && !scr.classList.contains('is-awake')) setClip(vid, null);
  }
  function stop(scr: HTMLElement | null) {
    if (!scr) return;
    scr.classList.remove('is-awake');
    const vid = scr.querySelector<HTMLVideoElement>('.clip');
    const src = vid?.getAttribute('src');
    if (!vid || !src) return;
    // let it fade out first; then the still shows again, and the recording stops
    setTimeout(() => {
      if (!scr.classList.contains('is-awake') && vid.getAttribute('src') === src) setClip(vid, null);
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
      setLead();
      buildRow();
      void rowEl.offsetWidth;
      rowEl.classList.remove(inCls);
      if (hadFocus) slots[sel()].focus({ preventScroll: true });
      switching = false;
      announce(rowNews());
    };
    history.replaceState(history.state, '', FILTERS[f].path);
    document.title = FILTERS[f].title;
    if (calm()) {
      swap();
      return;
    }
    rowEl.classList.add(outCls);
    rowLead.classList.add('is-out');
    setTimeout(swap, 170);
  }
  // the line over a row that needs saying what it is, such as Make's, between the top bar and the row
  function setLead() {
    const lead = FILTERS[state.filter].lead;
    rowLead.textContent = lead;
    rowLead.hidden = !lead;
    rowLead.classList.remove('is-out');
    placeLead();
  }
  function placeLead() {
    if (rowLead.hidden) return;
    const top = parseFloat(launcher.style.getPropertyValue('--top-h')) || 56;
    const rowTop = parseFloat(launcher.style.getPropertyValue('--row-y')) - RISE - TH / 2 - parseFloat(launcher.style.getPropertyValue('--cg') || '8');
    const room = rowTop - top;
    // where there's no room for it, as on a phone held sideways, the row goes without it
    rowLead.classList.toggle('no-room', room < rowLead.offsetHeight + 24);
    rowLead.style.top = Math.round(top + Math.max(8, (room - rowLead.offsetHeight) / 2)) + 'px';
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

  // ---------- Search ----------

  // The search field takes the filters' place, and the row keeps only the games whose titles
  // have every word typed. L and R still switch rows, and the search goes along. What is typed
  // stays on the page.

  // capitals, accents and punctuation don't count, so "kirbys" finds "Kirby’s Dead Land"
  const plain = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/['’‘`]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const searchWords = () => (state.search ? plain(state.search).split(' ').filter(Boolean) : []);

  function narrow(words: string[]) {
    let n = 0;
    for (const el of $$('.slot', rowEl)) {
      const title = el.dataset.title;
      if (title && words.every((w) => plain(title).includes(w))) el.dataset.index = String(n++);
      else el.remove();
    }
    if (n) return;
    // with nothing to show, one empty place says so
    const none = document.createElement('div');
    none.className = 'slot';
    none.dataset.index = '0';
    none.dataset.empty = '';
    none.dataset.note = 'Nothing matches';
    none.innerHTML = '<span class="lift"><span class="hollow"></span></span>';
    rowEl.append(none);
  }

  // what a screen reader hears about the row: its games and empty slots, or what the search found
  function rowNews() {
    const f = FILTERS[state.filter];
    if (searchWords().length) {
      const n = slots.filter((el) => el.dataset.game).length;
      return n ? `${f.label}: ${n} ${n === 1 ? 'game matches' : 'games match'}` : `${f.label}: nothing matches`;
    }
    const n = f.count;
    const empty = slots.filter((el) => el.dataset.empty !== undefined).length;
    // the Make row's way to start a Dreamport, by its name
    const others = slots.filter((el) => !el.dataset.game && el.dataset.title).map((el) => el.dataset.title);
    const games = `${n} ${n === 1 ? 'game' : 'games'}`;
    return `${f.label}: ${[games, ...others].join(', ')}${empty ? ` and ${empty} empty slots` : ''}`;
  }

  // where each row was when the search started, for when it ends without a game picked
  let searchSel: number[] = [];
  function startSearch() {
    if (busy()) return;
    if (state.search === null) {
      searchSel = [...state.sel];
      state.search = '';
      searchInput.value = '';
      searchBox.hidden = false;
      launcher.classList.add('is-searching');
      btnSearch.setAttribute('aria-expanded', 'true');
      sound.play('open');
    }
    searchInput.focus({ preventScroll: true });
  }
  // the whole row comes back, on the game the search was on
  function endSearch() {
    if (state.search === null) return;
    const game = gameAt(sel());
    const hadFocus = searchBox.contains(document.activeElement) || rowEl.contains(document.activeElement);
    state.search = null;
    state.sel = searchSel;
    searchBox.hidden = true;
    launcher.classList.remove('is-searching');
    btnSearch.setAttribute('aria-expanded', 'false');
    buildRow(game ?? undefined);
    if (hadFocus) slots[sel()].focus({ preventScroll: true });
    sound.play('close');
    announce(rowNews());
  }
  const toResults = () => slots[sel()].focus({ preventScroll: true });

  searchInput.addEventListener('input', () => {
    if (state.search === null) return;
    state.search = searchInput.value;
    buildRow(gameAt(sel()));
    if (searchWords().length) announce(rowNews());
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      endSearch();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // the keyboard's search key on a phone, too: it goes to the results and puts the keyboard away
      e.preventDefault();
      toResults();
    }
  });

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
      wakeRow(320);
      sound.play('move');
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
      sound.play('move');
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

  // a game's page, or a Dreamport's page in the Make row, takes the menu's place; a game's button leads on to before you
  // play, and the Make row's way to start a Dreamport leads to the README's steps
  function primary() {
    inspect(slots[sel()]);
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
    const slot = slots[sel()];
    const id = slot?.dataset.card;
    const card = id ? document.getElementById(id) : null;
    if (card instanceof HTMLDialogElement) openCard(card, { opener });
    else if (slot?.dataset.href) window.location.assign(slot.dataset.href);
    else nope();
  }

  // ---------- Cards ----------

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
  // back to the menu's address
  function leaveAddress() {
    document.title = FILTERS[state.filter].title;
    if (history.state && history.state.card) {
      popping = true;
      clearTimeout(popGuard);
      popGuard = window.setTimeout(() => {
        popping = false;
      }, 800);
      history.back();
    } else {
      history.replaceState(null, '', FILTERS[state.filter].path);
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
    openView(dlg, opts);
  }

  // a card takes the menu's place: the row steps aside and the card's parts come in. A card that
  // is up gives way at once.
  function openView(dlg: HTMLDialogElement, opts: OpenOptions) {
    let opener = opts.opener ?? (document.activeElement as HTMLElement | null);
    const replacing = !!state.view;
    if (state.view) {
      opener = state.opener;
      closeView({ instant: true, quiet: true, keepFocus: true, address: false, swap: true });
    }
    if (dlg === settingsCard) syncSettings();
    state.view = state.open = dlg;
    state.opener = opener;
    sleepRow();
    for (const a of dlg.getAnimations({ subtree: true })) a.cancel();
    launcher.dataset.view = dlg.dataset.card;
    if (dlg.open) dlg.close();
    dlg.show();
    // a card that fills itself, such as the profile, starts now
    dlg.dispatchEvent(new Event('view-open'));
    dlg.getBoundingClientRect();
    if (dlg === aboutCard) jumpAbout(opts.section ?? 'dreamport', true, false);
    if (hasHero(dlg)) {
      $('.ins-text', dlg).scrollTop = 0;
      $('.inspect', dlg).scrollTop = 0;
      resetExtras(dlg);
      resetParts(dlg);
      startShow(dlg, !opts.instant && !replacing);
    }
    if (!opts.instant) viewIn(dlg);
    focusStart(dlg)?.focus({ preventScroll: true });
    if (!opts.instant) sound.play('open');
    enterAddress(dlg, opts.address ?? (replacing ? 'replace' : 'push'));
  }

  // where focus starts in a card: about's current section, a game's box to tick (or, once it is
  // ticked, the button it unlocked), or the control the card marks with autofocus
  function focusStart(dlg: HTMLDialogElement) {
    if (dlg === aboutCard) return aboutLinks.find((a) => a.getAttribute('aria-current') === 'true') ?? null;
    const box = dlg.querySelector<HTMLInputElement>('.gate-form .check input');
    if (box) return box.checked ? $('.gate-buttons .btn', dlg) : box;
    return $$('[autofocus]', dlg).find((el) => !el.closest('[hidden]')) ?? null;
  }

  interface CloseOptions {
    instant?: boolean;
    quiet?: boolean;
    keepFocus?: boolean;
    // false when the address has already moved on, by the back button or another card
    address?: boolean;
    // true when another view takes this one's place
    swap?: boolean;
  }
  function closeCard(opts: CloseOptions = {}) {
    if (state.open) closeView(opts);
  }

  // the view's parts go, a game's picture flies back to its place in the row, and the row returns
  function closeView(opts: CloseOptions = {}) {
    const dlg = state.view;
    if (!dlg) return;
    state.view = null;
    state.open = null;
    if (!opts.quiet) sound.play('close');
    if (hasHero(dlg)) {
      stop(showScr);
      showScr = null;
    }
    const opener = state.opener;
    if (opts.address !== false) leaveAddress();
    const finish = () => {
      if (state.view === dlg) return;
      if (dlg.open) dlg.close();
      for (const a of dlg.getAnimations({ subtree: true })) a.cancel();
      if (opts.swap || state.view || state.launching) return;
      delete launcher.dataset.view;
      if (!opts.keepFocus) {
        const back = opener && opener.isConnected && launcher.contains(opener) && !opener.closest('dialog') ? opener : null;
        (back ?? slots[sel()]).focus({ preventScroll: true });
      }
      wakeRow();
    };
    if (opts.instant) {
      finish();
      return;
    }
    viewOut(dlg).then(finish);
  }

  // what comes in when a view opens, in order. A game's picture flies in from the row instead.
  function viewParts(dlg: HTMLDialogElement) {
    const kind = dlg.dataset.card;
    const parts =
      kind === 'inspect'
        ? ['.ins-text', '.ins-show .gate-form']
        : kind === 'make'
          ? ['.ins-text', '.ins-show .mk-play']
          : kind === 'about'
          ? ['.about-nav', '.about-text']
          : kind === 'profile' || kind === 'player'
            ? ['.card-title', '.pf-body']
            : ['.card-title', '.set-list', '.card-note'];
    return [...parts.map((part) => $(part, dlg)), $('.view-bar', dlg)];
  }
  function viewIn(dlg: HTMLDialogElement) {
    if (calm()) {
      dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    const d = Math.round(clamp(Math.min(W, H) * 0.04, 12, 32));
    viewParts(dlg).forEach((el, i) => {
      const from = el.matches('.ins-text') ? `translateX(${d * 2}px)` : `translateY(${d}px)`;
      el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], {
        duration: 480,
        delay: 60 + i * 60,
        easing: 'cubic-bezier(.2,.9,.25,1)',
        fill: 'backwards',
      });
    });
  }
  function viewOut(dlg: HTMLDialogElement) {
    if (calm()) return dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.catch(() => {});
    const d = Math.round(clamp(Math.min(W, H) * 0.02, 6, 16));
    const runs: Promise<unknown>[] = viewParts(dlg).map(
      (el) =>
        el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${d}px)` }], {
          duration: 160,
          easing: 'cubic-bezier(.4,0,1,1)',
          fill: 'forwards',
        }).finished,
    );
    if (hasHero(dlg)) runs.push(heroBack(dlg));
    return Promise.all(runs).catch(() => {});
  }
  // a game's picture flies back to its place in the row, or fades if the row has moved on
  function heroBack(dlg: HTMLDialogElement) {
    const hero = $('.show-wrap', dlg);
    for (const a of hero.getAnimations()) a.cancel();
    const slotEl = slots[sel()];
    const tile = slotEl && slotEl.dataset.game === dlg.dataset.game ? slotEl.querySelector('.tile') : null;
    const from = hero.getBoundingClientRect();
    const to = tile?.getBoundingClientRect();
    if (!to || !to.width || !from.width) return hero.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    return hero.animate(
      [{ transform: 'none' }, { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(to.width / from.width).toFixed(3)})` }],
      { duration: 380, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' },
    ).finished;
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
        // a link to the box to tick, from the game's text
        if (href === '#play') {
          e.preventDefault();
          const box = dlg.querySelector<HTMLInputElement>('.gate-form .check input');
          box?.focus({ preventScroll: true });
          box?.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
          return;
        }
        if (link.dataset.sec) {
          e.preventDefault();
          jumpAbout(link.dataset.sec);
          sound.play('tick');
          return;
        }
        if (href === '/about/#privacy') {
          e.preventDefault();
          openCard(aboutCard, { section: 'privacy' });
          return;
        }
        // another page of the launcher's, such as a game's page from its page in the Make row, takes this one's place
        const page = [...inspectCards.values(), ...makeCards].find((d) => d !== dlg && d.dataset.path === href);
        if (page) {
          e.preventDefault();
          openCard(page);
          return;
        }
        // a player's public profile, from the player's own
        if (link.dataset.player !== undefined) {
          e.preventDefault();
          playerCard.dataset.path = href;
          openCard(playerCard);
          return;
        }
      }
    });
  }

  // settings
  const sndSwitch = $('#snd-switch', settingsCard);
  function syncSettings() {
    sndSwitch.setAttribute('aria-checked', String(state.sound));
    $<HTMLInputElement>('#theme-light', settingsCard).checked = !isDark();
    $<HTMLInputElement>('#theme-dark', settingsCard).checked = isDark();
    $('#theme-desc', settingsCard).textContent = state.theme
      ? 'Light, or dark for the evening.'
      : 'Light, or dark for the evening. It follows your device until you pick one.';
    $<HTMLInputElement>('#motion-full', settingsCard).checked = !calm();
    $<HTMLInputElement>('#motion-calm', settingsCard).checked = calm();
    $('#motion-desc', settingsCard).textContent =
      state.motion === 'auto'
        ? reducedMQ.matches
          ? 'Calm, because your device asks for less motion. Calm keeps the games still and swaps the slides for fades.'
          : 'Calm keeps the games still and swaps the slides for fades. It follows your device until you pick one.'
        : 'Calm keeps the games still and swaps the slides for fades.';
    const kept: string[] = [];
    if (store.get('sound')) kept.push('menu sounds on');
    if (store.get('theme')) kept.push(store.get('theme') + ' look');
    if (store.get('motion')) kept.push(store.get('motion') + ' motion');
    $('#memory-note', settingsCard).textContent = kept.length
      ? `This browser remembers: ${kept.join(', ')}. It never leaves your device.`
      : 'The menu remembers nothing yet. What you change here stays in this browser.';
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
    const hero = $('.show-wrap', dlg);
    const from = tile.getBoundingClientRect();
    const to = hero.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    hero.animate(
      [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(from.width / to.width).toFixed(3)})` }, { transform: 'none' }],
      { duration: 560, easing: 'cubic-bezier(.2,.9,.3,1)' },
    );
  }

  // before you play: the links stay locked until the box is ticked, and the tick lasts
  // until the tab is closed
  for (const [game, dlg] of inspectCards) {
    const form = dlg.querySelector<HTMLFormElement>('form.gate-form');
    if (!form) continue;
    const box = $<HTMLInputElement>('input[type="checkbox"]', form);
    const label = $('.check', form);
    const buttons = $$<HTMLButtonElement>('button[type="submit"]', form);
    const lockedNote = $('.note-locked', form);
    const openNote = $('.note-open', form);
    const openText = openNote.textContent ?? '';
    // the download whose new tab the browser just blocked; pressing it again opens it here
    let blocked = '';
    const unblock = () => {
      blocked = '';
      openNote.textContent = openText;
    };
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
      // the nudge goes once the box is used
      lockedNote.textContent = '';
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
      if (button.dataset.icon === 'play') {
        launch(dlg, href);
        return;
      }
      // downloads open in a new tab, so the menu stays as it was. If the browser blocks the
      // new tab, the menu stays and says so, and a second press opens the download here.
      if (blocked === href) {
        window.location.assign(href);
        return;
      }
      const tab = window.open(href, '_blank');
      if (tab) {
        tab.opener = null;
        unblock();
        return;
      }
      blocked = href;
      openNote.textContent = 'Your browser blocked the new tab. Press the same download again to open it here.';
      sound.play('empty');
    });
    dlg.addEventListener('close', unblock);
  }

  // a game's extras: a square each, with the text of the picked one below, while the game's
  // picture shows it at work. Moving onto a square picks it, by the arrow keys, a controller or a
  // tap, and each page opens on the first.
  function pickExtra(tab: HTMLElement, quiet = false) {
    if (tab.getAttribute('aria-selected') === 'true') return;
    let panel: HTMLElement | null = null;
    const tabs = $$('[role="tab"]', tab.parentElement!);
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('is-sel', on);
      if (on) t.removeAttribute('tabindex');
      else t.tabIndex = -1;
      const p = document.getElementById(t.getAttribute('aria-controls')!);
      p?.classList.toggle('is-sel', on);
      if (on) panel = p;
    }
    if (quiet) return;
    sound.play('tick');
    showExtra(tab, true);
    const at = tabs.indexOf(tab);
    prefetch(tabs[at - 1]?.dataset.clip);
    prefetch(tabs[at + 1]?.dataset.clip);
    if (panel && !calm()) {
      (panel as HTMLElement).animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 220,
        easing: 'cubic-bezier(.2,.9,.3,1)',
      });
    }
  }
  // the picture changes to the picked extra's recording, or the game's own: the old one fades
  // out over the new one's still, and the new one fades in once its first frame is up
  let extraRun = 0;
  function showExtra(tab: HTMLElement, wake: boolean) {
    const dlg = tab.closest('dialog')!;
    const scr = dlg.querySelector<HTMLElement>('.show-tile .screen[data-clip]');
    const base = tab.dataset.clip;
    if (!scr || !base || scr.dataset.clip === base) return;
    const run = ++extraRun;
    scr.dataset.clip = base;
    $<HTMLImageElement>('.still', scr).src = tab.dataset.still!;
    if (!wake || calm() || state.open !== dlg || showScr !== scr) return;
    scr.classList.remove('is-awake');
    setTimeout(async () => {
      if (run !== extraRun || state.open !== dlg) return;
      const src = await play(scr);
      if (run !== extraRun || state.open !== dlg || scr.dataset.clip !== base) {
        drop(scr, src);
        return;
      }
      scr.classList.add('is-awake');
    }, 180);
  }
  function resetExtras(dlg: HTMLElement) {
    const first = dlg.querySelector<HTMLElement>('.x-row [role="tab"]');
    if (!first) return;
    pickExtra(first, true);
    showExtra(first, false);
    prefetch((first.nextElementSibling as HTMLElement | null)?.dataset.clip);
  }
  for (const row of $$('.x-row', launcher)) {
    const tabs = $$<HTMLElement>('[role="tab"]', row);
    const tabOf = (e: Event) => (e.target as Element).closest<HTMLElement>('[role="tab"]');
    row.addEventListener('click', (e) => {
      const tab = tabOf(e);
      if (tab) pickExtra(tab);
    });
    row.addEventListener('focusin', (e) => {
      const tab = tabOf(e);
      if (tab) pickExtra(tab);
    });
    // a pointer on its way to a square starts fetching its recording
    row.addEventListener('pointerover', (e) => prefetch(tabOf(e)?.dataset.clip));
    row.addEventListener('keydown', (e) => {
      const at = tabs.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      tabs[clamp(to, 0, tabs.length - 1)].focus();
    });
  }

  // a Dreamport's parts, on its page in the Make row: a block each, and under them one line on where the game stands,
  // or on the picked part. Moving onto a block picks it, by the arrow keys or a controller; a click or a tap picks it
  // or lets it go, and so does leaving the blocks. The blocks take one place in the keyboard's order.
  function resetParts(dlg: HTMLElement) {
    const row = dlg.querySelector<HTMLElement>('.mk-parts');
    if (!row) return;
    pickPart(row, null);
    $$('.mk-part', row).forEach((block, i) => (block.tabIndex = i === 0 ? 0 : -1));
  }
  function pickPart(row: HTMLElement, block: HTMLElement | null) {
    const caption = $('.mk-caption', row.parentElement!);
    for (const b of $$('.mk-part', row)) b.setAttribute('aria-pressed', String(b === block));
    caption.textContent = block?.dataset.caption ?? caption.dataset.summary ?? '';
  }
  for (const row of $$('.mk-parts', launcher)) {
    const blocks = $$<HTMLElement>('.mk-part', row);
    const blockOf = (e: Event) => (e.target as Element).closest<HTMLElement>('.mk-part');
    // a press focuses the block before its click, which then decides
    let pressed = -Infinity;
    row.addEventListener('pointerdown', () => (pressed = performance.now()));
    row.addEventListener('click', (e) => {
      const block = blockOf(e);
      if (!block) return;
      pickPart(row, block.getAttribute('aria-pressed') === 'true' ? null : block);
      sound.play('tick');
    });
    row.addEventListener('focusin', (e) => {
      const block = blockOf(e);
      if (!block) return;
      for (const b of blocks) b.tabIndex = b === block ? 0 : -1;
      if (performance.now() - pressed > 500 && block.getAttribute('aria-pressed') !== 'true') {
        pickPart(row, block);
        sound.play('tick');
      }
    });
    row.addEventListener('focusout', (e) => {
      if (!row.contains(e.relatedTarget as Node | null)) pickPart(row, null);
    });
    row.addEventListener('keydown', (e) => {
      const at = blocks.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: blocks.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      blocks[clamp(to, 0, blocks.length - 1)].focus();
    });
  }

  // the sentence on a Dreamport's page in the Make row copies when pressed, and its icon turns into a tick for a moment
  for (const button of $$<HTMLButtonElement>('.mk-copy', launcher)) {
    const text = button.dataset.copy!;
    let done = 0;
    button.addEventListener('click', async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // where the clipboard can't be written to directly, the older way
        const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
        area.style.cssText = 'position: fixed; opacity: 0';
        document.body.append(area);
        area.select();
        try {
          copied = document.execCommand('copy');
        } catch {}
        area.remove();
        button.focus({ preventScroll: true });
      }
      if (!copied) {
        sound.play('empty');
        announce('This browser didn’t let the page copy it.');
        return;
      }
      button.classList.add('is-copied');
      button.setAttribute('aria-label', `Copied: ${text}`);
      sound.play('on');
      announce('Copied');
      clearTimeout(done);
      done = window.setTimeout(() => {
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', `Copy: ${text}`);
      }, 2000);
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
  // what goes through the doorway: the game in the row, or the picture on the game's page
  let flyer: HTMLElement | null = null;
  async function launch(dlg: HTMLDialogElement, href: string) {
    if (state.launching) return;
    const slotEl = slots[sel()];
    if (!slotEl || slotEl.dataset.game !== dlg.dataset.game) {
      window.location.assign(href);
      return;
    }
    state.launching = true;
    // going back to the menu part way through stops the launch
    const run = ++launchRun;
    const still = () => run === launchRun;
    const title = slotEl.dataset.title ?? '';
    $('#bo-name', blackout).textContent = title;
    announce('Opening ' + title);
    launcher.classList.add('is-launching');
    launcher.inert = true;
    const view = state.view?.dataset.card === 'inspect' ? state.view : null;
    const lift = view ? $('.show-wrap', view) : $('.lift', slotEl);
    for (const a of lift.getAnimations()) a.cancel();
    flyer = lift;
    const box = lift.getBoundingClientRect();
    const size = box.width || S;
    if (calm()) {
      sound.play('iris');
      await launcher.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' }).finished.catch(() => {});
      if (still()) showBlackout(href);
      return;
    }
    sound.play('launch');
    const up = `translateY(${(-size * 0.1).toFixed(1)}px) scale(1.06)`;
    target.classList.add('is-up');
    await lift
      .animate([{ transform: 'none' }, { transform: up }], { duration: 320, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' })
      .finished.catch(() => {});
    // the doorway has finished rising by now, so its opening can be measured
    await wait(150);
    if (!still()) return;
    const mouth = $('.t-door-mouth', target).getBoundingClientRect();
    const dx = mouth.left + mouth.width / 2 - (box.left + box.width / 2);
    const dy = mouth.top + mouth.height / 2 - (box.top + box.height / 2);
    const k = (mouth.width / size) * 0.95;
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
    const lift = flyer ?? $('.lift', slotEl);
    // the game comes back up from wherever the launch left it
    const left = getComputedStyle(lift);
    const from = { transform: left.transform, opacity: left.opacity };
    target.classList.remove('is-flash');
    launcher.classList.remove('is-launching');
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
    flyer = null;
    (state.view ? focusStart(state.view) : slotEl)?.focus({ preventScroll: true });
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
      switch (name) {
        case 'move':
          // the same note for every move, wherever it lands
          this.tone({ f: 659.25, d: 0.11, g: 0.09 });
          this.tone({ f: 1318.51, type: 'sine', d: 0.06, g: 0.025 });
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
      `Settings. Menu sounds ${state.sound ? 'on' : 'off'}. ${padConnected ? 'A controller is connected.' : 'No controller connected.'}`,
    );
    if (padConnected) padHint.hidden = true;
  }

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as Element;
    // letters type into the search field and the profile's name, and a phone's own keyboard keeps
    // the touch hints
    if (t === searchInput) return;
    if (!(t instanceof HTMLInputElement && t.type === 'text')) setInput('keys');
    // only escape goes back: a held enter key must not undo the launch it started
    if (state.launching) {
      if (e.key === 'Escape' && !e.repeat) {
        e.preventDefault();
        back();
      }
      return;
    }
    if (state.open) {
      // escape goes back to the menu
      if (e.key === 'Escape' && !e.repeat) {
        e.preventDefault();
        closeCard();
      }
      return;
    }
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
      case 'ArrowUp':
        // from the results back up to the search field
        if (state.search === null || !onSlot) break;
        e.preventDefault();
        searchInput.focus({ preventScroll: true });
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
      case 's':
        e.preventDefault();
        if (!busy()) openCard(settingsCard);
        break;
      case 'a':
        e.preventDefault();
        if (!busy()) openCard(aboutCard);
        break;
      case 'p':
        e.preventDefault();
        if (!busy()) openCard(profileCard);
        break;
      case '/':
        e.preventDefault();
        startSearch();
        break;
      case 'Escape':
        if (state.search === null) break;
        e.preventDefault();
        endSearch();
        break;
    }
  });

  // ---------- Game controllers ----------

  const pad = { prev: [] as boolean[], dir: 0, next: 0 };
  function focusables(scope: ParentNode) {
    return $$('button:not([hidden]), a[href], summary, input:not([type="radio"]), input[type="radio"]:checked, [tabindex="0"]', scope).filter(
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
      const area = $$('.about-text, .ins-text, .inspect, .card-body', state.open).find((el) => el.scrollHeight > el.clientHeight + 2);
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
        // left and right go along a row of blocks, such as a Dreamport's parts; up and down step over it, and into it
        // at the block that has the keyboard's place
        const group = here?.closest('[data-roving]');
        const list = focusables(dlg).filter((el) => {
          const own = el.closest('[data-roving]');
          if (!own || el === here) return true;
          return own === group ? step === 1 || step === -1 : el.tabIndex >= 0;
        });
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
    // select opens the search, down and up go between its field and the results, and B ends it
    if (edges.includes(8)) startSearch();
    if (step === 2 && document.activeElement === searchInput) toResults();
    if (step === -2 && state.search !== null) searchInput.focus({ preventScroll: true });
    if (edges.includes(1)) endSearch();
    if (edges.includes(0)) primary();
    if (edges.includes(2) && !busy()) openCard(profileCard);
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

  // iOS sends a controller's input only to the page it treats as in use. A page in Safari is, but
  // a web app opened from the Home Screen only becomes one once the screen is tapped, and no
  // browser shows a page a controller before one of its buttons is pressed. So in the Home Screen
  // app on an iPhone or iPad, a line says what to do, until a tap, a key or a controller.
  const homeScreenApp = (navigator as Navigator & { standalone?: boolean }).standalone === true && navigator.maxTouchPoints > 0;
  padHint.hidden = !homeScreenApp || !navigator.getGamepads;
  $('svg', padHint).innerHTML = ICON_PAD;
  let tapFrom: { x: number; y: number } | null = null;
  window.addEventListener('pointerdown', (e) => (tapFrom = { x: e.clientX, y: e.clientY }), true);
  window.addEventListener(
    'pointerup',
    (e) => {
      // a tap counts, not a swipe
      if (tapFrom && Math.hypot(e.clientX - tapFrom.x, e.clientY - tapFrom.y) < 10) padHint.hidden = true;
      tapFrom = null;
    },
    true,
  );
  // a page that gets keys is the one in use already
  window.addEventListener('keydown', () => (padHint.hidden = true), true);
  // held upright, the line sits between the top bar and the row. Where that leaves too little
  // room, as on a phone held sideways, it goes between the bottom buttons.
  function placePadHint(topH: number, rowTop: number) {
    if (padHint.hidden) return;
    const st = padHint.style;
    const text = $('span', padHint);
    st.left = st.maxWidth = text.style.width = '';
    const box = launcher.getBoundingClientRect();
    const bar = corners.getBoundingClientRect();
    const [a, b] = $$('.corner-group', corners).map((g) => g.getBoundingClientRect());
    const room = b.left - a.right - 24;
    if (rowTop - topH >= padHint.offsetHeight + 24 || room < 160) {
      st.top = Math.round(topH + Math.max(8, Math.min(24, (rowTop - topH - padHint.offsetHeight) / 2))) + 'px';
    } else {
      st.maxWidth = room + 'px';
      st.left = Math.round((a.right + b.left) / 2 - box.left) + 'px';
      st.top = Math.round(bar.top - box.top + (bar.height - padHint.offsetHeight) / 2) + 'px';
    }
    // the box then hugs its longest line, instead of keeping all the width it was allowed
    const range = document.createRange();
    range.selectNodeContents(text);
    text.style.width = Math.ceil(Math.max(...[...range.getClientRects()].map((r) => r.width))) + 'px';
  }

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
    if (!busy() || (state.open && !state.launching)) openCard(settingsCard, { opener: e.currentTarget as HTMLElement });
  });
  $('#btn-about', launcher).addEventListener('click', (e) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    if (!busy()) openCard(aboutCard, { opener: e.currentTarget as HTMLElement });
  });
  $('#btn-profile', launcher).addEventListener('click', (e) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    if (!busy()) openCard(profileCard, { opener: e.currentTarget as HTMLElement });
  });
  btnSearch.addEventListener('click', startSearch);
  $('#search-end', searchBox).addEventListener('click', endSearch);

  // ---------- The address ----------

  // the browser's back and forward buttons open and close cards, and switch filters
  function followAddress(first: boolean) {
    if (state.launching) return;
    const path = location.pathname;
    let card: HTMLDialogElement | null = null;
    let game: string | null = null;
    if (path === '/about/') card = aboutCard;
    if (path === '/profile/') card = profileCard;
    if (/^\/players\/[^/]+\/$/.test(path)) {
      card = playerCard;
      // another player's profile, from the browser's back or forward button, loads in its place
      const moved = state.open === card && card.dataset.path !== path;
      card.dataset.path = path;
      if (moved) card.dispatchEvent(new Event('view-open'));
    }
    for (const page of [...inspectCards.values(), ...makeCards]) {
      if (page.dataset.path === path) {
        game = page.dataset.game!;
        card = page;
      }
    }
    // the filter that shows this address, and the game it is about
    let f = FILTERS.findIndex((filter) => filter.paths.includes(path));
    if (game) f = FILTERS.findIndex((filter) => filter.key === card!.dataset.filter);
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

  // always 24-hour time, such as 09:05 or 21:00, whatever the device's region
  const clock = $('#clock', launcher);
  function tick() {
    const now = new Date();
    clock.textContent = [now.getHours(), now.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
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
  // get the font's weights ready while nothing is happening, so the first card opens without a hitch
  const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 600));
  idle(() => {
    for (const font of ['400 15px Monocraft', '700 15px Monocraft']) {
      document.fonts?.load(font).catch(() => {});
    }
  });
}
