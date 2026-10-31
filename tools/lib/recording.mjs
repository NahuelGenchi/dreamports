// Recorded play: the buttons held at each frame, from power-on, kept in the game's folder as
// games/<game>/proof/recordings/<name>.json. It holds nothing from the game, only button names and frame numbers.
//
// {
//   "about": what it plays, in a sentence or two,
//   "frames": how many frames it runs,
//   "held": [[frame, [buttons]], ...]: from each of these frames on, the buttons held, until the next change. A button
//     the console has goes by the console's name (on the Game Boy Advance: A, B, SELECT, START, RIGHT, LEFT, UP,
//     DOWN, R and L); one only the Dreamport has, such as an extra's, by the game's name for it.
//   "onlyInOriginal": optional, screens the Dreamport doesn't have yet: [{ "at", "frames", "held", "about" }]. Before
//     the Dreamport's frame `at`, the original runs `frames` frames of its own, with `held` counted from the first
//     of them. Those frames aren't compared, and the code that runs in them doesn't count towards the %.
//   "clip": optional, the frames the clip shows: { "at", "frames" }
// }

import { readFileSync, writeFileSync } from 'node:fs';

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

/** Reads and checks a recording. */
export function readRecording(file) {
  const recording = JSON.parse(readFileSync(file, 'utf8'));
  const { frames, held, onlyInOriginal = [], clip } = recording;
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`${file}: "frames" is how many frames it runs`);
  checkHeld(held, frames, file);
  let last = -1;
  for (const gap of onlyInOriginal) {
    if (!isFrame(gap.at) || gap.at < last || gap.at > frames || !Number.isInteger(gap.frames) || gap.frames < 1) {
      throw new Error(`${file}: each of "onlyInOriginal" has "at", a frame from 0 to ${frames} after the one before, and "frames", one or more`);
    }
    checkHeld(gap.held ?? [], gap.frames, `${file}, "onlyInOriginal" at ${gap.at}`);
    last = gap.at;
  }
  if (clip && (!isFrame(clip.at) || !Number.isInteger(clip.frames) || clip.frames < 1 || clip.at + clip.frames > frames)) {
    throw new Error(`${file}: "clip" is { "at", "frames" } inside the recording`);
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
export function writeRecording(file, { about, frames, held, onlyInOriginal = [], clip }) {
  const lines = held.map(change => '    ' + JSON.stringify(change));
  const parts = [`  "about": ${JSON.stringify(about)}`, `  "frames": ${frames}`, `  "held": [\n${lines.join(',\n')}\n  ]`];
  if (onlyInOriginal.length) parts.push(`  "onlyInOriginal": ${JSON.stringify(onlyInOriginal)}`);
  if (clip) parts.push(`  "clip": ${JSON.stringify(clip)}`);
  writeFileSync(file, `{\n${parts.join(',\n')}\n}\n`);
}
