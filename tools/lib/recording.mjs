// Recorded play: the buttons held at each frame, from power-on, kept in the game's folder as
// games/<game>/proof/recordings/<name>.json. It holds nothing from the game, only button names and frame numbers.
//
// {
//   "about": what it plays, in a sentence or two,
//   "frames": how many frames it runs,
//   "held": [[frame, [buttons]], ...]: from each of these frames on, the buttons held, until the next change. A button
//     the console has goes by the console's name (on the Game Boy Advance: A, B, SELECT, START, RIGHT, LEFT, UP,
//     DOWN, R and L); one only the Dreamport has, such as an extra's, by the game's name for it.
//   "onlyInOriginal": optional, screens the Dreamport doesn't have yet: [{ "at", "frames", "held", "sets", "about" }].
//     Before the Dreamport's frame `at`, the original runs `frames` frames of its own, with `held` counted from the first
//     of them. Those frames aren't compared, and the code that runs in them doesn't count towards the %. `sets`, also
//     optional, writes values to the original's work RAM as those frames run, which is how it gets to a part with no
//     need to play everything before it: [{ "frame", "address", "bytes", "value", "about" }], with `frame` counted the
//     same way, `address` in hexadecimal as the code map has it, and `bytes` 1, 2 or 4.
//   "start": optional, a start point: what the Dreamport's address adds, such as "level=2&character=1", so it opens at
//     the part this recording plays. tools/README.md, Start points.
//   "players": optional, 2 to 4: the recording is of that many GBAs on one link, each from power-on with the Dreamport's page at
//     "start" (default vs=<players>); "held" is the first player's, and "others" the rest's, a list of such lists.
//   "clip": optional, the frames the clip shows: { "at", "frames" }, with at least 300 frames, five seconds, or all of
//     a shorter recording's, which share refuses until it runs on further. Without one, prove's clip starts a second
//     before the first frame the step changed (lib/clips.mjs)
// }

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIP_FRAMES } from './clips.mjs';

const isFrame = n => Number.isInteger(n) && n >= 0;

/** Checks the changes of a `held` list and throws with what is wrong. */
function checkHeld(held, frames, where) {
  if (!Array.isArray(held)) throw new Error(`${where}: "held" is a list of [frame, [buttons]]`);
  let last = -1;
  for (const change of held) {
    const [frame, buttons] = Array.isArray(change) ? change : [];
    if (!isFrame(frame) || frame <= last || frame >= frames || !Array.isArray(buttons) || !buttons.every(b => typeof b === 'string')) {
      throw new Error(`${where}: ${JSON.stringify(change)} isn't a frame after the one before and inside the recording, with a list of buttons`);
    }
    last = frame;
  }
}

// what a start point can add to the Dreamport's address: words and values with nothing the address would read as more
const START = /^[a-z][a-z0-9-]*=[A-Za-z0-9._-]+(?:&[a-z][a-z0-9-]*=[A-Za-z0-9._-]+)*$/;

/** Checks a start point, what the Dreamport's address adds, and throws with what is wrong. */
/** Whether a game's code names neverInPlay in any of its files, in the line that says what no player could see or in a comment saying why it needs none (tools/README.md, Start points). */
export const namesNeverInPlay = folder => readdirSync(folder, { recursive: true })
  .some(file => /\.m?js$/.test(file) && readFileSync(join(folder, file), 'utf8').includes('neverInPlay'));

export function checkStart(start, where) {
  if (typeof start !== 'string' || !START.test(start) || start.split('&').some(pair => pair.startsWith('proof='))) {
    throw new Error(`${where}: a start point is what the Dreamport's address adds, as words and values such as level=2&character=1, and not proof`);
  }
}

/** Checks the values a stretch only the original has writes to its memory, and throws with what is wrong. */
function checkSets(sets, frames, where) {
  if (!Array.isArray(sets)) throw new Error(`${where}: "sets" is a list of { frame, address, bytes, value }`);
  for (const set of sets) {
    const { frame, address, bytes, value } = set ?? {};
    const aligned = typeof address === 'string' && /^[0-9A-Fa-f]{8}$/.test(address) && parseInt(address, 16) % bytes === 0;
    const fits = Number.isInteger(value) && value >= 0 && value < 2 ** (8 * bytes);
    if (!isFrame(frame) || frame >= frames || ![1, 2, 4].includes(bytes) || !aligned || !fits) {
      throw new Error(`${where}: ${JSON.stringify(set)} isn't a frame of the stretch, an address of eight hexadecimal digits at a multiple of its bytes, 1, 2 or 4 of them, and a value that fits them`);
    }
  }
}

/** Reads and checks a recording. */
export function readRecording(file) {
  const recording = JSON.parse(readFileSync(file, 'utf8'));
  const { frames, held, onlyInOriginal = [], clip, start } = recording;
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`${file}: "frames" is how many frames it runs`);
  if (start !== undefined) checkStart(start, file);
  checkHeld(held, frames, file);
  if (recording.players !== undefined) {
    const { players, others } = recording;
    if (![2, 3, 4].includes(players) || !Array.isArray(others) || others.length !== players - 1) throw new Error(`${file}: "players" is 2 to 4, and "others" the held lists of the players after the first`);
    others.forEach(list => checkHeld(list, frames, `${file}, "others"`));
  }
  let last = -1;
  for (const gap of onlyInOriginal) {
    if (!isFrame(gap.at) || gap.at < last || gap.at > frames || !Number.isInteger(gap.frames) || gap.frames < 1) {
      throw new Error(`${file}: each of "onlyInOriginal" has "at", a frame from 0 to ${frames} after the one before, and "frames", one or more`);
    }
    checkHeld(gap.held ?? [], gap.frames, `${file}, "onlyInOriginal" at ${gap.at}`);
    if (gap.sets !== undefined) checkSets(gap.sets, gap.frames, `${file}, "onlyInOriginal" at ${gap.at}`);
    last = gap.at;
  }
  if (clip && (!isFrame(clip.at) || !Number.isInteger(clip.frames) || clip.frames < 1 || clip.at + clip.frames > frames)) {
    throw new Error(`${file}: "clip" is { "at", "frames" } inside the recording`);
  }
  // a recording shorter than that can't have a longer clip, and share refuses its clip until it runs on further
  if (clip && clip.frames < Math.min(CLIP_FRAMES, frames)) {
    throw new Error(`${file}: "clip" has ${clip.frames} frames, and a clip lasts at least ${CLIP_FRAMES}, five seconds, of what the step changed: a recording that proves only a few frames runs on further in the place it proves`);
  }
  return { ...recording, onlyInOriginal };
}

/** The buttons held at every frame, from a list of changes. */
export function expand(held = [], frames) {
  const out = new Array(frames);
  let now = [], next = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (next < held.length && held[next][0] === frame) now = held[next++][1];
    out[frame] = now;
  }
  return out;
}

/**
 * The buttons the original is given at every frame, with the stretches only it has in their places, for what a list of
 * presses leads to. It's for real play, so it stops at values written to the original's memory.
 */
export function originalButtons({ frames, held, onlyInOriginal = [] }) {
  const out = [], own = expand(held, frames);
  let gap = 0;
  const addStretches = frame => {
    for (; gap < onlyInOriginal.length && onlyInOriginal[gap].at === frame; gap++) {
      if (onlyInOriginal[gap].sets?.length) throw new Error('This list of presses writes values to the original\'s memory, and a game\'s card shows only real play.');
      out.push(...expand(onlyInOriginal[gap].held, onlyInOriginal[gap].frames));
    }
  };
  for (let frame = 0; frame < frames; frame++) {
    addStretches(frame);
    out.push(own[frame]);
  }
  addStretches(frames);
  return out;
}

/**
 * How the original plays a recording's first `frames` frames, all of them unless told: `originalHeld`, the buttons it
 * holds at each of its own frames, with the stretches only it has in their places, `originalOf`, which of its frames
 * each of the recording's is, and `sets`, the values those stretches write to its memory, each at the original's frame,
 * in the order of their frames. `keysLate` is for a game that reads its buttons just after the V-blank, whose values
 * are then written a frame later, as its buttons are given (original.json's keysAfterVBlank).
 */
export function originalPlay(recording, { frames = recording.frames, keysLate = false } = {}) {
  const held = expand(recording.held, frames), stretches = recording.onlyInOriginal ?? [];
  const originalOf = new Int32Array(frames), originalHeld = [], sets = [];
  const addStretch = ({ frames: count, held: own, sets: values = [] }) => {
    for (const set of values) sets.push({ ...set, frame: originalHeld.length + set.frame + (keysLate ? 1 : 0), address: parseInt(set.address, 16) });
    originalHeld.push(...expand(own, count));
  };
  let gap = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (; gap < stretches.length && stretches[gap].at === frame; gap++) addStretch(stretches[gap]);
    originalOf[frame] = originalHeld.length;
    originalHeld.push(held[frame]);
  }
  for (; gap < stretches.length && stretches[gap].at <= frames; gap++) addStretch(stretches[gap]);
  sets.sort((a, b) => a.frame - b.frame);
  return { held, originalOf, originalHeld, sets };
}

/** The list of changes for the buttons held at every frame. */
export function compress(perFrame) {
  const held = [];
  let last = null;
  perFrame.forEach((buttons, frame) => {
    const key = [...buttons].sort().join(' ');
    if (key !== last) held.push([frame, [...buttons].sort()]);
    last = key;
  });
  return held;
}

/** Writes a recording, a change of buttons to a line, so a change to it reads well in a diff. */
export function writeRecording(file, { about, frames, held, onlyInOriginal = [], clip, start }) {
  const lines = held.map(change => '    ' + JSON.stringify(change));
  const parts = [`  "about": ${JSON.stringify(about)}`, ...(start ? [`  "start": ${JSON.stringify(start)}`] : []), `  "frames": ${frames}`, `  "held": [\n${lines.join(',\n')}\n  ]`];
  if (onlyInOriginal.length) parts.push(`  "onlyInOriginal": ${JSON.stringify(onlyInOriginal)}`);
  if (clip) parts.push(`  "clip": ${JSON.stringify(clip)}`);
  writeFileSync(file, `{\n${parts.join(',\n')}\n}\n`);
}
