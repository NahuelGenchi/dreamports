// Reporting a problem, a view of the settings (sheet.js): a player who saw something wrong picks what it was and
// presses Send report, and the site gets the buttons they held since the game started, which is all it takes to play
// it again next to the original (../session.js, ../report.js). Nothing is typed, and nothing else is sent: no save, no
// copy of the game and nothing of who played. Cloudflare's Turnstile checks, out of sight, that a person is sending
// it, and shows itself only when it has to. Where the site takes no reports, such as a copy of a Dreamport somewhere
// else, the same button saves the presses as a file.

import { REASONS, FEWEST_FRAMES, packHeld } from '../report.js';
import { recordingText } from '../session.js';

const pixels = (w, h, d) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
const FLAG = pixels(9, 9, 'M1 0h1v9H1zM2 1h6v1H2zM2 2h5v1H2zM2 3h6v1H2zM2 4h5v1H2z');
const SEND = pixels(9, 9, 'M0 4h6v1H0zM4 2h1v1H4zM5 3h1v1H5zM4 6h1v1H4zM5 5h1v1H5zM6 4h3v1H6z');
const CHEVRON = '<svg class="chev" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1H2v1H1v1H0z"/></svg>';
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const PROMISE = 'Sends only the buttons you pressed. No save, no game files, nothing about you.';

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

/** What a session sends as its report (../report.js), with the reason the player chose. */
export function reportOf(session, reason, { path = location.pathname, query = location.search } = {}) {
  const recording = session.recording('', query);
  return { game: gameOf(path), reason, start: recording.start ?? '', keptSave: recording.keptSave === true, frames: recording.frames, ...packHeld(recording.held) };
}

// Turnstile's script, asked for once, the first time the view opens
let turnstile = null;
const loadTurnstile = () => (turnstile ??= new Promise((resolve, reject) => {
  const script = Object.assign(document.createElement('script'), { src: TURNSTILE, async: true });
  script.onload = () => resolve(globalThis.turnstile);
  script.onerror = () => { turnstile = null; reject(new Error('Turnstile didn\'t load')); };
  document.head.append(script);
}));

/**
 * Adds the view to `sheet` as 'report', for the player whose buttons `input` reads, and makes the row reportRow gives,
 * in `root`, go to it.
 */
export function createReportView(sheet, root, input) {
  const { el, body } = sheet.view('report', {
    title: 'Report a problem',
    show() { opened(); },
    first: () => el.querySelector('[role="radio"][aria-checked="true"]'),
  });
  body.classList.add('settings-body', 'report-body');
  body.innerHTML = `
    <div class="settings-col sheet-rise">
      <p class="report-note" id="report-note">Saw something wrong? Send us what you just played, so we can see exactly what happened.</p>
      <ul class="rows" role="radiogroup" aria-label="What went wrong">
        ${Object.entries(REASONS).map(([key, words], i) => `<li><button type="button" class="row" role="radio" aria-checked="${i === 0}" data-reason="${key}">
          <span class="dot" aria-hidden="true"></span><span class="row-text">${words}</span>
        </button></li>`).join('')}
      </ul>
      <button type="button" class="resume" data-send aria-describedby="report-promise">${SEND}Send report</button>
      <p class="report-promise" id="report-promise">${PROMISE}</p>
      <div class="report-check" data-check></div>
      <p class="report-status" data-status role="status" aria-live="polite"></p>
    </div>`;
  const send = el.querySelector('[data-send]'), status = el.querySelector('[data-status]'), check = el.querySelector('[data-check]');
  const reasons = [...el.querySelectorAll('[role="radio"]')];
  for (const button of reasons) {
    button.addEventListener('click', () => reasons.forEach(each => each.setAttribute('aria-checked', String(each === button))));
  }
  root.querySelector('[data-report]')?.addEventListener('click', () => sheet.go('report'));

  // what the site says of reports: its Turnstile key and whether it still takes them today, or null where it takes none
  let site = null, widget = null, token = null, waiting = null;
  async function opened() {
    status.textContent = '';
    send.disabled = false;
    send.lastChild.textContent = 'Send report';
    try {
      const answer = await fetch('/api/reports/open', { cache: 'no-store' });
      site = answer.ok ? await answer.json() : null;
    } catch {
      site = null;
    }
    if (!site) send.lastChild.textContent = 'Save what I played';
    else if (!site.open) { status.textContent = 'We\'ve had all the reports we can take today. Try again tomorrow.'; send.disabled = true; }
    if (site?.sitekey && widget === null) {
      try {
        const api = await loadTurnstile();
        widget = api.render(check, {
          sitekey: site.sitekey, appearance: 'interaction-only', execution: 'execute',
          callback(value) { token = value; waiting?.(value); },
          'error-callback'() { waiting?.(null); return true; },
        });
      } catch {
        widget = null;   // the check didn't load: sending says so
      }
    }
  }

  // Turnstile's word that a person is sending, asked for as the report goes, as it's good for one request
  const checked = () => new Promise(resolve => {
    if (!site.sitekey) return resolve('');
    if (widget === null) return resolve(null);
    token = null;
    waiting = value => { waiting = null; resolve(value); };
    globalThis.turnstile.reset(widget);
    globalThis.turnstile.execute(check);
    setTimeout(() => waiting?.(null), 30000);
  });

  send.addEventListener('click', async () => {
    const reason = reasons.find(each => each.getAttribute('aria-checked') === 'true').dataset.reason;
    if (input.session.frames < FEWEST_FRAMES) { status.textContent = 'There\'s nothing to send yet: play a little first.'; return; }
    // a site that takes no reports: the presses as a file, to send whoever runs it
    if (!site) {
      const recording = input.session.recording(`A player's session, saved from the game's settings (${REASONS[reason]}): say what it plays.`, location.search);
      const name = `${gameOf(location.pathname).replace('/', '-') || 'game'}-session.json`;
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new File([recordingText(recording)], name, { type: 'application/json' })), download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      status.textContent = 'Saved as a file.';
      return;
    }
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const word = await checked();
      if (word === null) throw new Error('That couldn\'t be checked. Try again.');
      const answer = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: reportOf(input.session, reason), token: word }) });
      if (!answer.ok) throw new Error((await answer.json().catch(() => null))?.error ?? 'That didn\'t go through. Try again in a moment.');
      status.textContent = 'Sent. Thank you!';
    } catch (error) {
      status.textContent = error instanceof TypeError ? 'That didn\'t go through. Check your connection and try again.' : error.message;
      send.disabled = false;
    }
  });
}
