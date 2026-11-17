// Reporting a problem, a view of the settings (sheet.js): a player who saw something wrong picks what it was and
// presses Send report, and the site gets the buttons they held since the game started, which is all it takes to play
// it again next to the original (../session.js, ../report.js), with the save the game started from when it had one,
// as the same presses play something else from another save. Nothing is typed, and nothing else is sent: no copy of
// the game and nothing of who played beyond what that save holds, their progress and the name they typed in the game. Cloudflare's Turnstile checks, out of sight, that a person is sending
// it, and shows itself only when it has to. Where the site takes no reports, such as a copy of a Dreamport somewhere
// else, the same button saves the presses as a file.
//
// The view is two panels in one place, so its size never jumps: the form, and what became of the report. Pressing Send
// report fades the form out and the second panel in, which shows the report going, a ring of squares with a light
// running round it, and then how it ended: the ring fills and a tick draws itself, or it dims under a cross, with the
// reason the player picked and what to do next. Someone who asked for less motion gets the same panels with no
// movement.
//
// Where the site can't take the report at that moment, as when it has had too many or the connection is down, the
// report is kept on the player's device and sent for them the next time a Dreamport opens (../report-outbox.js): the
// view says Report saved, and nobody is asked to wait or to come back.

import { REASONS, FEWEST_FRAMES, packHeld, packSaves } from '../report.js';
import { recordingText, savesAtStart } from '../session.js';
import { keepReport, outcomeOf, sendWaitingReports, waitingReports } from '../report-outbox.js';

const pixels = (w, h, d) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
const FLAG = pixels(9, 9, 'M1 0h1v9H1zM2 1h6v1H2zM2 2h5v1H2zM2 3h6v1H2zM2 4h5v1H2z');
const SEND = pixels(9, 9, 'M0 4h7v1H0zM5 2h1v1H5zM6 3h1v1H6zM7 4h1v1H7zM6 5h1v1H6zM5 6h1v1H5z');
const PLAY = pixels(4, 7, 'M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z');
const AGAIN = pixels(9, 9, 'M2 1h5v1H2zM1 2h1v5H1zM7 2h1v2H7zM2 7h5v1H2zM7 6h1v1H7zM5 3h3v1H5zM7 4h1v1H7z');
// the ring's eight squares, round from the top, and the tick and the cross that end it, on a grid of 13
const RING = [[6, 0], [10, 2], [12, 6], [10, 10], [6, 12], [2, 10], [0, 6], [2, 2]];
const TICK = pixels(13, 13, 'M3 6h1v1H3zM4 7h1v1H4zM5 8h1v1H5zM6 7h1v1H6zM7 6h1v1H7zM8 5h1v1H8zM9 4h1v1H9z');
const TRAY = pixels(13, 13, 'M6 2h1v5H6zM4 4h1v1H4zM5 5h1v1H5zM7 5h1v1H7zM8 4h1v1H8zM4 8h1v2H4zM8 8h1v2H8zM4 10h5v1H4z');
const CROSS = pixels(13, 13, 'M4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM7 7h1v1H7zM8 8h1v1H8zM8 4h1v1H8zM7 5h1v1H7zM5 7h1v1H5zM4 8h1v1H4z');
// how long the report is shown going at least, so the panel never flashes past
const SHOWN_GOING = 900;
const CHEVRON = '<svg class="chev" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1H2v1H1v1H0z"/></svg>';
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const PROMISE = 'Sends the buttons you pressed and your save in this game, with the name you typed in it. Nothing else about you.';

/** The settings' row that opens the view, for a list of rows; createReportView makes it work. */
export function reportRow() {
  return `<li><button type="button" class="row" data-report>
                  ${FLAG}
                  <span class="row-text">Report a problem</span>
                  ${CHEVRON}
                </button></li>`;
}

// the game and its version, as the page's address has them: sonic-advance, or sonic-advance/c
const gameOf = path => path.split('/').filter(part => part && !['play', 'games'].includes(part) && /^[a-z0-9-]+$/.test(part)).slice(0, 2).join('/');

/**
 * What a session sends as its report (../report.js), with the reason the player chose and the saves the visit began
 * from, `saves` (../session.js).
 */
export async function reportOf(session, reason, { path = location.pathname, query = location.search, saves = savesAtStart() } = {}) {
  const recording = session.recording('', query);
  return { game: gameOf(path), reason, start: recording.start ?? '', keptSave: saves.length > 0, saves: await packSaves(saves), frames: recording.frames, ...packHeld(recording.held) };
}

// Turnstile's script, asked for once, the first time the view opens
let turnstile = null;
const loadTurnstile = () => (turnstile ??= new Promise((resolve, reject) => {
  const script = Object.assign(document.createElement('script'), { src: TURNSTILE, async: true });
  script.onload = () => resolve(globalThis.turnstile);
  script.onerror = () => { turnstile = null; reject(new Error('Turnstile didn\'t load')); };
  document.head.append(script);
}));

// a report on its way to the site, with Turnstile's word: the answer's status, or 0 when it never got there
async function postReport(report, token) {
  try {
    return (await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, token }) })).status;
  } catch {
    return 0;
  }
}

// Turnstile's word with nothing shown, for a report sent while the player plays: null where it would have to ask them
// something, or doesn't answer, so the report waits on
async function quietCheck(sitekey) {
  if (!sitekey) return '';
  let api;
  try { api = await loadTurnstile(); } catch { return null; }
  const place = Object.assign(document.createElement('div'), { hidden: true });
  document.body.append(place);
  return new Promise(resolve => {
    let id = null;
    const end = value => { try { if (id !== null) api.remove(id); } catch { /* gone already */ } place.remove(); resolve(value); };
    try {
      id = api.render(place, { sitekey, appearance: 'interaction-only', callback: end, 'error-callback'() { end(null); return true; }, 'before-interactive-callback'() { end(null); } });
    } catch {
      end(null);
    }
    setTimeout(() => end(null), 20000);
  });
}

/** Sends the reports that waited on this device, out of sight, when the site takes them (../report-outbox.js). */
export async function sendWaiting() {
  if (!waitingReports().length) return 0;
  let site;
  try {
    const answer = await fetch('/api/reports/open', { cache: 'no-store' });
    site = answer.ok ? await answer.json() : null;
  } catch {
    return 0;
  }
  if (!site?.open) return 0;
  return sendWaitingReports(async report => {
    const word = await quietCheck(site.sitekey);
    return word === null ? 403 : postReport(report, word);
  });
}

/**
 * Adds the view to `sheet` as 'report', for the player whose buttons `input` reads, and makes the row reportRow gives,
 * in `root`, go to it.
 */
export function createReportView(sheet, root, input) {
  const { el, body } = sheet.view('report', {
    title: 'Report a problem',
    show() { opened(); },
    first: () => (stack.dataset.state === 'form' ? el.querySelector('[role="radio"][aria-checked="true"]') : el.querySelector('.report-state :is(button:not([hidden]), [tabindex])')),
  });
  body.classList.add('settings-body', 'report-body');
  body.innerHTML = `
    <div class="report-stack" data-state="form">
      <div class="report-form settings-col sheet-rise">
        <p class="report-note" id="report-note">Saw something wrong? Send us what you just played, so we can see exactly what happened.</p>
        <ul class="rows" role="radiogroup" aria-label="What went wrong">
          ${Object.entries(REASONS).map(([key, words], i) => `<li><button type="button" class="row" role="radio" aria-checked="${i === 0}" data-reason="${key}">
            <span class="dot" aria-hidden="true"></span><span class="row-text">${words}</span>
          </button></li>`).join('')}
        </ul>
        <button type="button" class="resume" data-send aria-describedby="report-promise">${SEND}Send report</button>
        <p class="report-promise" id="report-promise">${PROMISE}</p>
      </div>
      <div class="report-state" inert>
        <div class="report-mark" aria-hidden="true">
          ${RING.map(([x, y], i) => `<i style="--x:${x};--y:${y};--i:${i}"></i>`).join('')}
          <span class="report-tick">${TICK}</span><span class="report-tray">${TRAY}</span><span class="report-cross">${CROSS}</span>
        </div>
        <div class="report-words" role="status" aria-live="polite">
          <h3 class="report-head" data-head tabindex="-1"></h3>
          <p class="report-reason" data-said></p>
          <p class="report-detail" data-detail></p>
        </div>
        <div class="report-check" data-check></div>
        <div class="report-actions">
          <button type="button" class="resume" data-again hidden>${AGAIN}Try again</button>
          <button type="button" class="resume" data-done hidden>${PLAY}Back to the game</button>
        </div>
      </div>
    </div>`;
  const stack = el.querySelector('.report-stack'), form = el.querySelector('.report-form'), state = el.querySelector('.report-state');
  const send = el.querySelector('[data-send]'), check = el.querySelector('[data-check]');
  const head = el.querySelector('[data-head]'), said = el.querySelector('[data-said]'), detail = el.querySelector('[data-detail]');
  const again = el.querySelector('[data-again]'), done = el.querySelector('[data-done]');
  const reasons = [...el.querySelectorAll('[role="radio"]')];
  for (const button of reasons) {
    button.addEventListener('click', () => reasons.forEach(each => each.setAttribute('aria-checked', String(each === button))));
  }
  root.querySelector('[data-report]')?.addEventListener('click', () => sheet.go('report'));
  done.addEventListener('click', () => sheet.close());
  again.addEventListener('click', () => go());

  /**
   * Shows one of the view's panels: the form, or what became of the report, 'going', 'sent', 'kept' or 'failed', with
   * its words. The panel coming in takes the keys, and the one going out can't be reached.
   */
  function show(name, { title = '', reason = '', more = '', retry = false } = {}) {
    stack.dataset.state = name;
    form.inert = name !== 'form';
    state.inert = name === 'form';
    if (name === 'form') return;
    head.textContent = title;
    said.textContent = reason;
    detail.textContent = more;
    again.hidden = !retry;
    done.hidden = name === 'going';
    // once it has ended the keys go to what to do next, and while it goes, to its words
    (name === 'going' ? head : retry ? again : done).focus({ preventScroll: true });
  }

  // what the site says of reports: its Turnstile key and whether it still takes them today, or null where it takes
  // none; `reached` is whether it answered at all, as a site out of reach isn't one that takes none
  let site = null, reached = false, widget = null, token = null, waiting = null;
  async function opened() {
    show('form');
    send.disabled = false;
    send.lastChild.textContent = 'Send report';
    try {
      const answer = await fetch('/api/reports/open', { cache: 'no-store' });
      reached = true;
      site = answer.ok ? await answer.json() : null;
    } catch {
      reached = false;
      site = null;
    }
    if (!site && reached) send.lastChild.textContent = 'Save what I played';
    if (site?.sitekey && widget === null) {
      try {
        const api = await loadTurnstile();
        widget = api.render(check, {
          sitekey: site.sitekey, appearance: 'interaction-only', execution: 'execute',
          callback(value) { token = value; waiting?.(value); },
          'error-callback'() { waiting?.(null); return true; },
          // where Cloudflare has to ask, its box shows under the words, which say what to do
          'before-interactive-callback'() { detail.textContent = 'One quick check first: tick the box below.'; },
          'after-interactive-callback'() { detail.textContent = ''; },
        });
      } catch {
        widget = null;   // the check didn't load: sending says so
      }
    }
  }

  // Turnstile's word that a person is sending, asked for as the report goes, as it's good for one request
  const checked = () => new Promise(resolve => {
    if (!site?.sitekey) return resolve(site ? '' : null);
    if (widget === null) return resolve(null);
    token = null;
    waiting = value => { waiting = null; resolve(value); };
    globalThis.turnstile.reset(widget);
    globalThis.turnstile.execute(check);
    setTimeout(() => waiting?.(null), 30000);
  });

  // a report that can't go now is kept on this device and sent the next time a Dreamport opens
  const KEPT = { state: 'kept', title: 'Report saved', more: 'We\'ll send it for you the next time you play.' };
  const kept = report => (keepReport(report) ? KEPT : { state: 'failed', title: 'It didn\'t go through', more: 'It couldn\'t be saved on this device either.', retry: true });

  // the report on its way, and how it ended: { state, title, more, retry }
  async function deliver(reason) {
    if (input.session.frames < FEWEST_FRAMES) return { state: 'failed', title: 'Nothing to send yet', more: 'Play for a few seconds first, then report it.' };
    // a site that takes no reports: the presses as a file, to send whoever runs it
    if (!site && reached) {
      const recording = input.session.recording(`A player's session, saved from the game's settings (${REASONS[reason]}): say what it plays.`, location.search);
      const name = `${gameOf(location.pathname).replace('/', '-') || 'game'}-session.json`;
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new File([recordingText(recording)], name, { type: 'application/json' })), download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      return { state: 'sent', title: 'Saved as a file', more: 'This copy of the game takes no reports. Send the file to whoever runs it.' };
    }
    const report = await reportOf(input.session, reason);
    // out of reach, or full for today: it waits
    if (!site?.open) return kept(report);
    const word = await checked();
    if (word === null) return kept(report);
    const outcome = outcomeOf(await postReport(report, word));
    if (outcome === 'sent') return { state: 'sent', title: 'Report sent', more: 'Thank you. We\'ll play it again to find what went wrong.' };
    if (outcome === 'later') return kept(report);
    return { state: 'failed', title: 'It didn\'t go through', more: 'Something about it wasn\'t right, so it can\'t be sent.' };
  }

  async function go() {
    const reason = reasons.find(each => each.getAttribute('aria-checked') === 'true').dataset.reason;
    const told = `You told us: ${REASONS[reason].toLowerCase()}`;
    show('going', { title: site || !reached ? 'Sending your report' : 'Saving what you played', reason: told });
    // it's shown going for a moment at least, however fast it went
    const [ended] = await Promise.all([deliver(reason), new Promise(resolve => setTimeout(resolve, SHOWN_GOING))]);
    if (stack.dataset.state !== 'going') return;   // the player went back meanwhile
    show(ended.state, { title: ended.title, reason: told, more: ended.more, retry: ended.retry === true });
  }
  send.addEventListener('click', () => go());
  // the reports that waited go out of sight, a little after the game's page opens
  setTimeout(() => { sendWaiting().catch(() => {}); }, 4000);
}
