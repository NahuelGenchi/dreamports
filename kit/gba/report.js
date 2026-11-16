// A player's report of something a Dreamport got wrong (docs/REPORTS.md): the buttons they held since the game
// started, which is all a recording is, and one of a few reasons. Nothing else is taken, and nothing is typed, so a
// report can't carry anything but presses. The game's settings write one (kit/gba/ui/report-view.js), the site's
// Worker checks and keeps it (worker/index.ts), and the tools read it back as a recording (tools/reports.mjs). This
// file is what all three agree on, in the kit as the games' pages are served nothing else.

/** The reasons a player can give, by what the Worker keeps and what the settings say. */
export const REASONS = { looked: 'It looked wrong', sounded: 'It sounded wrong', stopped: 'It froze or stopped', other: 'Something else' };

/** How many days the site keeps a report. */
export const KEPT_DAYS = 90;
/** The most a report's presses can take once packed: about two hours of play. */
export const MOST_PACKED = 60_000;
/** The fewest frames worth sending, five seconds, and the most, twelve hours. */
export const FEWEST_FRAMES = 300;
export const MOST_FRAMES = 60 * 60 * 60 * 12;
const MOST_BUTTONS = 24;
const BUTTON = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const VERSION = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+)?$/;
const START = /^[A-Za-z0-9_=&.-]{0,200}$/;

/**
 * @typedef {object} Report
 * @property {string} game the game and its version, as the address has them: sonic-advance, or sonic-advance/c
 * @property {'looked' | 'sounded' | 'stopped' | 'other'} reason
 * @property {string} start what the page's address added, a recording's start point, or ''
 * @property {boolean} keptSave whether the game began from a save, which a recording doesn't hold
 * @property {number} frames
 * @property {string[]} buttons the names of the buttons held at some frame, each a bit of a change's number
 * @property {string} held the changes, packed: for each, the frames since the one before and the buttons held, in
 *   base 36, as "1e.3"
 */

/** Packs a recording's changes, [frame, names], as a report keeps them: { buttons, held }. */
/** @param {[number, string[]][]} changes */
export function packHeld(changes) {
  /** @type {string[]} */
  const buttons = [];
  let last = 0;
  const held = changes.map(([frame, names]) => {
    let mask = 0;
    for (const name of names) {
      let at = buttons.indexOf(name);
      if (at < 0) at = buttons.push(name) - 1;
      mask += 2 ** at;
    }
    const text = `${(frame - last).toString(36)}.${mask.toString(36)}`;
    last = frame;
    return text;
  }).join(',');
  return { buttons, held };
}

/** A report's changes again, as a recording has them: [frame, names]. */
/** @param {string[]} buttons @param {string} held @returns {[number, string[]][]} */
export function unpackHeld(buttons, held) {
  let frame = 0;
  return held === '' ? [] : held.split(',').map((text) => {
    const [gap, mask] = text.split('.').map((part) => parseInt(part, 36));
    frame += gap;
    return [frame, buttons.filter((_, at) => Math.floor(mask / 2 ** at) % 2 === 1)];
  });
}

/**
 * Checks what was sent as a report and gives it back with nothing but what a report holds, or says in a few words
 * why it isn't one. Every change has to come after the one before, within the frames played, and hold only buttons
 * the report names.
 */
/** @param {unknown} sent @returns {Report | string} */
export function readReport(sent) {
  if (!sent || typeof sent !== 'object') return 'It isn’t a report.';
  const { game, reason, start = '', keptSave = false, frames, buttons, held } = /** @type {Record<string, unknown>} */ (sent);
  if (typeof game !== 'string' || game.length > 80 || !VERSION.test(game)) return 'It names no game.';
  if (typeof reason !== 'string' || !(reason in REASONS)) return 'It gives no reason.';
  if (typeof start !== 'string' || !START.test(start)) return 'Its start point isn’t one.';
  if (typeof keptSave !== 'boolean') return 'It isn’t a report.';
  if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < FEWEST_FRAMES) return 'It’s too short to show anything: play a little longer first.';
  if (frames > MOST_FRAMES) return 'It’s too long to send.';
  if (!Array.isArray(buttons) || buttons.length > MOST_BUTTONS || !buttons.every((b) => typeof b === 'string' && BUTTON.test(b)) || new Set(buttons).size !== buttons.length) {
    return 'Its buttons aren’t buttons.';
  }
  if (typeof held !== 'string' || held.length > MOST_PACKED) return 'It’s too long to send.';
  if (held !== '' && !/^[0-9a-z]{1,7}\.[0-9a-z]{1,6}(?:,[0-9a-z]{1,7}\.[0-9a-z]{1,6})*$/.test(held)) return 'Its presses aren’t presses.';
  let frame = 0, first = true;
  const limit = 2 ** buttons.length;
  for (const text of held === '' ? [] : held.split(',')) {
    const [gap, mask] = text.split('.').map((part) => parseInt(part, 36));
    if (!first && gap < 1) return 'Its presses aren’t in order.';
    frame += gap;
    if (frame >= frames || mask >= limit) return 'Its presses don’t fit the game it played.';
    first = false;
  }
  return { game, reason: /** @type {Report['reason']} */ (reason), start, keptSave, frames, buttons, held };
}
