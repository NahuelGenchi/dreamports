// A player's report of something a Dreamport got wrong (docs/REPORTS.md): the buttons they held since the game
// started, which is all a recording is, one of a few reasons, and the save the game started from when it had one, as
// the same presses play something else from another save. Nothing else is taken, and nothing is typed, so a report
// can't carry anything but presses and a save. The game's settings write one (kit/gba/ui/report-view.js), the site's
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
/** The most a report's saves can take once packed, all together: several times what a full save of the games here
 *  comes to. And the most one holds unpacked, the biggest save memory a cartridge has, 128 KB. */
export const MOST_SAVES_PACKED = 24_000;
export const MOST_SAVE_BYTES = 0x20000;
const MOST_SAVES = 4;
const MOST_BUTTONS = 24;
const SAVE_KEY = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BUTTON = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const VERSION = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+)?$/;
const START = /^[A-Za-z0-9_=&.-]{0,200}$/;

/**
 * @typedef {object} Report
 * @property {string} game the game and its version, as the address has them: sonic-advance, or sonic-advance/c
 * @property {'looked' | 'sounded' | 'stopped' | 'other'} reason
 * @property {string} start what the page's address added, a recording's start point, or ''
 * @property {boolean} keptSave whether the game began from a save, which a recording doesn't hold
 * @property {{ key: string, packed: string }[]} saves the save memory the game began from, by the key the browser
 *   keeps it under, each packed (packSave); none where there was no save, or where it couldn't be packed
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

// bytes through a stream that packs or unpacks them: what came out, or null past `most` bytes
/** @param {{ readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array> }} stream @param {Uint8Array} bytes @param {number} most */
async function through(stream, bytes, most) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > most) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.length; }
  return all;
}

/**
 * A save memory's bytes as a report keeps them: deflated, as base64. A cartridge's save memory is mostly bytes never
 * written, so 64 KB comes to a few thousand characters. Null where the browser can't pack, or there's nothing to.
 */
/** @param {Uint8Array} bytes @returns {Promise<string | null>} */
export async function packSave(bytes) {
  try {
    if (!bytes.length || bytes.length > MOST_SAVE_BYTES) return null;
    const packed = await through(new CompressionStream('deflate-raw'), bytes, MOST_SAVE_BYTES * 2);
    if (!packed) return null;
    let text = '';
    for (let i = 0; i < packed.length; i += 0x8000) text += String.fromCharCode(...packed.subarray(i, i + 0x8000));
    return btoa(text);
  } catch {
    return null;
  }
}

/** A packed save's bytes again, or null when it isn't one: not deflated bytes, empty, or more than a save memory holds. */
/** @param {string} packed @returns {Promise<Uint8Array | null>} */
export async function unpackSave(packed) {
  try {
    const bytes = await through(new DecompressionStream('deflate-raw'), Uint8Array.from(atob(packed), (c) => c.charCodeAt(0)), MOST_SAVE_BYTES);
    return bytes?.length ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The saves a visit began from, each { key, bytes } (session.js), as a report carries them: [{ key, packed }]. None
 * where one can't be packed or they come to more than a report may take: the report then only says it began from a
 * save, as it's worth more sent without one than not sent.
 */
/** @param {{ key: string, bytes: Uint8Array }[]} saves */
export async function packSaves(saves) {
  const packed = [];
  for (const { key, bytes } of saves.slice(0, MOST_SAVES)) {
    const text = await packSave(bytes);
    if (text === null || !SAVE_KEY.test(key)) return [];
    packed.push({ key, packed: text });
  }
  return saves.length > MOST_SAVES || packed.reduce((sum, each) => sum + each.packed.length, 0) > MOST_SAVES_PACKED ? [] : packed;
}

/** Whether every save a report carries unpacks to a save memory's bytes: readReport checks their form alone. */
/** @param {Report} report */
export async function savesUnpack(report) {
  for (const { packed } of report.saves) {
    if (!(await unpackSave(packed))) return false;
  }
  return true;
}

/**
 * Checks what was sent as a report and gives it back with nothing but what a report holds, or says in a few words
 * why it isn't one. Every change has to come after the one before, within the frames played, and hold only buttons
 * the report names. A save has to be packed bytes under a key, of which savesUnpack checks the rest.
 */
/** @param {unknown} sent @returns {Report | string} */
export function readReport(sent) {
  if (!sent || typeof sent !== 'object') return 'It isn’t a report.';
  const { game, reason, start = '', keptSave = false, saves = [], frames, buttons, held } = /** @type {Record<string, unknown>} */ (sent);
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
  if (!Array.isArray(saves) || saves.length > MOST_SAVES) return 'Its save isn’t a save.';
  /** @type {Report['saves']} */
  const kept = [];
  for (const save of saves) {
    const { key, packed } = save && typeof save === 'object' ? save : {};
    if (typeof key !== 'string' || !SAVE_KEY.test(key) || kept.some((each) => each.key === key)) return 'Its save isn’t a save.';
    if (typeof packed !== 'string' || !packed || packed.length > MOST_SAVES_PACKED || !BASE64.test(packed)) return 'Its save isn’t a save.';
    kept.push({ key, packed });
  }
  if (kept.reduce((sum, each) => sum + each.packed.length, 0) > MOST_SAVES_PACKED) return 'Its save is too big to send.';
  // a report that carries a save began from one
  return { game, reason: /** @type {Report['reason']} */ (reason), start, keptSave: keptSave || kept.length > 0, saves: kept, frames, buttons, held };
}
