// A visit's presses, for the settings' "Save this session's presses" (ui/settings.js): what the game read at every
// frame since it started, kept as a list of changes, which is all a recording is (tools/README.md, Recording play).
// A player who sees something wrong saves them as a file and sends it in, and `npm run dp -- prove` then plays it next
// to the original like any recording. It holds the buttons held and nothing else: no copy of the game and nothing of
// who played. It's kept in memory only, for as long as the page is open, and written only when the player asks.

// The save memory the browser kept as the game started (save.js), by its key, as the text storage held: the game
// writes over it as it plays, so what a visit began from is known only if it's kept from the start. A recording holds
// no save, so one that began from a save says so, and a report carries these with it (report.js), as the original,
// played from power-on with nothing saved, won't have them.
const startSaves = new Map();
/** Notes what storage kept under `key` as the game started: the first time for a key is the one that counts. */
export function noteStartSave(key, text) {
  if (!startSaves.has(key)) startSaves.set(key, typeof text === 'string' && text ? text : null);
}
/** The saves the visit began from, each { key, bytes }: only keys that held one, and only what reads as a save. */
export function savesAtStart() {
  const saves = [];
  for (const [key, text] of startSaves) {
    if (text === null) continue;
    try { saves.push({ key, bytes: Uint8Array.from(atob(text), c => c.charCodeAt(0)) }); } catch { /* not what save.js keeps */ }
  }
  return saves;
}

/**
 * A session of one player's `layout` (input.js): { read(frame), frames, recording(about) }. `read` takes what the game
 * read at a frame, { held, pressed }, as input.js gives it to a proof tool. `recording` gives the session so far as a
 * recording, with `query`, the page's address after its question mark, kept as its start point when it has one.
 */
export function createSession(layout) {
  // the console's name for each of the game's buttons that is one of the console's own, as a recording names them
  const names = new Map((layout.buttons ?? []).map(b => [b, layout.console?.[b] ?? layout.gba?.[b] ?? b]));
  const held = [];
  let frames = 0, last = null, pressedBefore = [];
  return {
    get frames() { return frames; },
    read({ held: holding, pressed = [] }) {
      // a press shorter than a frame is held for one: "just pressed" stays set until the game clears it, so only its
      // first frame counts (tools/play.mjs does the same)
      const now = [...new Set([...holding, ...pressed.filter(b => !pressedBefore.includes(b))])].map(b => names.get(b) ?? b).sort();
      const key = now.join(' ');
      if (key !== last) held.push([frames, now]);
      last = key;
      pressedBefore = pressed;
      frames++;
    },
    recording(about, query = '') {
      const start = startOf(query);
      return { about, ...(start ? { start } : {}), ...(savesAtStart().length ? { keptSave: true } : {}), frames, held: held.map(([frame, buttons]) => [frame, [...buttons]]) };
    },
  };
}

/** What a page's address adds that a recording keeps as its start point: everything but the proof tools' own word. */
export function startOf(query) {
  return String(query).replace(/^\?/, '').split('&').filter(part => part && !/^proof(?:=|$)/.test(part)).join('&');
}

/** A recording as the file a player saves: a change of buttons to a line, as the tools write one. */
export function recordingText({ about, start, keptSave: kept, frames, held }) {
  const parts = [`  "about": ${JSON.stringify(about)}`, ...(start ? [`  "start": ${JSON.stringify(start)}`] : []), ...(kept ? ['  "keptSave": true'] : []),
    `  "frames": ${frames}`, `  "held": [\n${held.map(change => `    ${JSON.stringify(change)}`).join(',\n')}\n  ]`];
  return `{\n${parts.join(',\n')}\n}\n`;
}
