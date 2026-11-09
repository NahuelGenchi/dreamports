// npm run dp -- prove <game> [recording…]: plays each recording, from power-on, in the original (in the reference
// emulator) and in the Dreamport (in a headless browser), compares every frame, its picture and its sound
// (lib/sound.mjs), notes which of the original's functions ran in the frames that matched, updates the game's progress.json, which its code ported and its gameplay
// proven are measured with (docs/STANDARD.md#how-progress-is-measured),
// and makes a clip and stills of both side by side, with a clip and a still of the
// Dreamport on its own. To help find where each of the game's parts starts and ends, it lists the frames where the
// original's screen is one colour, as between one screen and the next, and with --stills <frames> keeps pictures of
// those frames, as it does of each part's first and last, and it names any notes people left on what differs
// (docs/NOTES.md). At the first picture that differs, and with --state <frames> at others, it says what the console
// holds that differs (lib/state.mjs). A recording fails if the game says no player could ever see a frame of it
// (tools/README.md, Start points), and it reminds a game whose code never can say so when a start point plays. A
// recording also fails when its name names a character, or anything else original.json lists under `shows`, that the
// original's own memory says it doesn't show as it ends (src/lib/shows.mjs). With --quick it stops at the first frame that differs, and says what differs
// there, with no clip and nothing written to progress.json: a round of work, with the plain prove to finish it. The
// pictures and the clips stay in .dreamports/results/ on this computer: they show the game, so they never go in a commit.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, LOCAL, resultFolder } from './lib/paths.mjs';
import { readOriginal, readRecordings, readCodeMap, readProgress, writeProgress, readParts, hex } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { expand, namesNeverInPlay } from './lib/recording.mjs';
import { serveRepository } from './lib/server.mjs';
import { openChrome } from './lib/chrome.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { mp4 } from './lib/mp4.mjs';
import { makeFilter, soundOf, NEAR } from './lib/sound.mjs';
import { compareState, describeState } from './lib/state.mjs';
import { fromStartPoint, measure, percentText } from '../src/lib/entries.mjs';
import { readProof } from './readme.mjs';
import { referenceOf } from './lib/reference.mjs';
import { checkSizes, firstOtherSize } from './lib/screens.mjs';
import { notesAbout } from './notes.mjs';
import { proveLinked } from './prove-linked.mjs';
import { versionOf } from '../src/lib/languages.mjs';
import { kindsOf, shownOf, showsProblems } from '../src/lib/shows.mjs';
import { recordingHash, mainProof, firstChanged, clipWindow, newFramesIn, clipProblems, changedText } from './lib/clips.mjs';

const BATCH = 120;
const STILLS = 600, STATES = 20;
// a clip stays under 2 MB: encoded again at a lower rate while it's over, as the encoder can overshoot its target.
// A calm clip stops well short of its rate, which only decides what fast play gets
const CLIP_LIMIT = 2_000_000, CLIP_TARGET = 1_700_000, CLIP_RATE = 2_000_000;
const IN_PAGE = readFileSync(new URL('./lib/in-page.js', import.meta.url), 'utf8');

export async function run(args) {
  const stillsAt = args.indexOf('--stills'), stateAt = args.indexOf('--state');
  const askedState = stateAt >= 0 ? framesIn(args[stateAt + 1], '--state', STATES) : [];
  // a frame whose state is asked for gets its picture too
  const asked = [...new Set([...(stillsAt >= 0 ? framesIn(args[stillsAt + 1], '--stills', STILLS) : []), ...askedState])].sort((x, y) => x - y);
  const [game, ...names] = args.filter((a, i) => !a.startsWith('--') && (stillsAt < 0 || i !== stillsAt + 1) && (stateAt < 0 || i !== stateAt + 1));
  if (!game) throw new Error('Usage: npm run dp -- prove <game> [recording…] [--quick] [--stills <frames>] [--state <frames>]');
  const quick = args.includes('--quick');
  const original = readOriginal(game);
  const kinds = kindsOf(original, `games/${versionOf(game).game}/proof/original.json`);
  const reference = await referenceOf(original);
  const recordings = readRecordings(game, names);
  if (!recordings.length) throw new Error(`games/${game}/proof/recordings/ has no recordings yet: make one with npm run dp -- play ${game} --record <name>.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The proof uses ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const codeMap = readCodeMap(game);
  if (codeMap && codeMap.original !== original.sha1) throw new Error(`games/${game}/proof/code-map.json is for another copy than original.json names.`);
  reference.ensureOriginal(console.log);

  const progress = readProgress(game), parts = readParts(game);
  // what main's proof had, which tells the frames this step changed, where each clip starts (lib/clips.mjs)
  const main = quick ? null : mainProof(game);
  const server = await serveRepository();
  let failed = false, page = null;
  try {
    for (const recording of recordings) {
      const own = parts.filter(p => p.recording === recording.name && Array.isArray(p.frames) && p.frames.length === 2 && p.frames.every(Number.isInteger));
      // one browser for all of them, with each recording's page starting from nothing
      page = page ? await page.another() : await openChrome({ profile: join(LOCAL, 'chrome', 'prove'), headless: true });
      const result = recording.players ? await proveLinked({ page, game, recording, copy: copy.path, server, main, quick, asked }) : await prove({ page, reference, game, recording, copy: copy.path, server, codeMap, main, before: progress.recordings[recording.name], asked, askedState, parts: own, kinds, keysLate: original.keysAfterVBlank === true, paced: args.includes('--paced'), quick });
      // what the original shows is checked however the frames compare, and a linked recording, played by more than one
      // console, isn't read
      const wrong = showsProblems(recording.name, result.shows, recording.players ? [] : kinds);
      for (const problem of wrong) console.log(`  ${problem}`);
      failed ||= result.matched < result.frames || result.neverInPlay.length > 0 || wrong.length > 0;
      if (quick) continue;
      progress.recordings[recording.name] = {
        frames: result.frames,
        matched: result.matched,
        differs: result.differs,
        ...(result.soundDiffers.length ? { soundDiffers: result.soundDiffers } : {}),
        ...(result.onlyInOriginal ? { onlyInOriginal: result.onlyInOriginal } : {}),
        ...(result.neverInPlay.length ? { neverInPlay: result.neverInPlay } : {}),
        ...(result.shows ? { shows: result.shows } : {}),
        functions: result.functions,
      };
    }
  } finally {
    await page?.close();
    await server.close();
  }

  // only a game's own code knows what its opening does, so the tools can only remind it
  if (recordings.some(recording => fromStartPoint(recording, Infinity)) && !namesNeverInPlay(join(REPO, 'games', game, 'src'))) {
    console.log("\nA start point played here, and this game's code never names dreamportsProof.neverInPlay. If the game's opening holds its character, such as a countdown, add the line that makes prove stop a recording no player could ever see (npm run dp -- help start points). If it has no such opening, a comment naming neverInPlay that says why ends this reminder.");
  }

  if (quick) return failed ? 1 : 0;

  // the code that ran in matching play, from every recording there is, the ones not played now as they were last proven
  const all = new Set(readRecordings(game).map(r => r.name));
  for (const name of Object.keys(progress.recordings)) if (!all.has(name)) delete progress.recordings[name];
  const totals = { original: original.sha1 };
  if (codeMap) {
    const proven = new Set(Object.values(progress.recordings).flatMap(r => r.functions));
    Object.assign(totals, measure(codeMap.functions.map(f => ({ address: hex(f.address), size: f.size })), proven));
  } else {
    console.log(`\nNo code map yet, so no code ported: npm run dp -- codemap ${game} makes one.`);
  }
  writeProgress(game, { ...totals, recordings: progress.recordings });
  // the two numbers the game shows now
  try {
    const { ported, gameplay } = readProof(game) ?? {};
    console.log([ported && `Code ported: ${percentText(ported.percent)}${totals.proven ? `, ${totals.proven.functions} of ${totals.codeMap.functions} functions` : ''}.`,
      gameplay && `Gameplay proven: ${percentText(gameplay.percent)}, ${gameplay.proven} of ${gameplay.total} parts.`].filter(Boolean).join(' '));
  } catch (error) {
    console.log(error.message);
  }
  return failed ? 1 : 0;
}

// the frames --stills or --state names: numbers and stretches, such as 249,250 or 900-905
function framesIn(text, flag, limit) {
  const frames = new Set();
  for (const part of (text ?? '').split(',')) {
    const [, a, b = a] = /^(\d+)(?:-(\d+))?$/.exec(part.trim()) ?? [];
    if (a === undefined || +b < +a) throw new Error(`${flag} takes frames, such as 249,250 or 900-905.`);
    for (let f = +a; f <= +b && frames.size <= limit; f++) frames.add(f);
  }
  if (frames.size > limit) throw new Error(`${flag} takes up to ${limit} frames at a time.`);
  return [...frames].sort((x, y) => x - y);
}

// a colour of the console's, as people write one
const colourName = c => {
  if (c === 0) return 'black';
  if (c === 0x7FFF) return 'white';
  return '#' + [c & 31, c >> 5 & 31, c >> 10 & 31].map(v => (v << 3 | v >> 2).toString(16).padStart(2, '0')).join('');
};

// the frames in a list of stretches, [[first, last], …]
const inStretches = stretches => {
  const frames = new Set();
  for (const [a, b] of stretches ?? []) for (let f = a; f <= b; f++) frames.add(f);
  return frames;
};
const stretchesOf = frames => {
  const stretches = [];
  for (const f of frames) {
    const last = stretches.at(-1);
    if (last && last[1] === f - 1) last[1] = f;
    else stretches.push([f, f]);
  }
  return stretches;
};
const listed = stretches => stretches.slice(0, 8).map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(', ')
  + (stretches.length > 8 ? `, and ${stretches.length - 8} more stretches` : '');

async function prove({ page, reference, game, recording, copy, server, codeMap, main, before, asked, askedState, parts, kinds, keysLate, paced, quick }) {
  const { name, frames } = recording;
  const { machine, KEY, runOriginal } = reference;
  const out = resultFolder(game, name);
  if (!quick) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // what it's doing, on one line that changes in a terminal: anything else reads only what it found
  const say = text => process.stdout.isTTY && process.stdout.write(`\r${`${name}: ${text}`.padEnd(70)}`);

  // which of the original's frames is each of the Dreamport's: the same, but for the frames only the original has
  const held = expand(recording.held, frames);
  const originalOf = new Int32Array(frames), originalHeld = [], sets = [];
  // a stretch only the original has: its buttons, and the values it writes to its memory, at frames counted the same way
  const addStretch = ({ frames: count, held: own, sets: values = [] }) => {
    for (const set of values) sets.push({ ...set, frame: originalHeld.length + set.frame + (keysLate ? 1 : 0), address: parseInt(set.address, 16) });
    originalHeld.push(...expand(own, count));
  };
  let gap = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (; gap < recording.onlyInOriginal.length && recording.onlyInOriginal[gap].at === frame; gap++) addStretch(recording.onlyInOriginal[gap]);
    originalOf[frame] = originalHeld.length;
    originalHeld.push(held[frame]);
  }
  for (; gap < recording.onlyInOriginal.length; gap++) addStretch(recording.onlyInOriginal[gap]);
  sets.sort((a, b) => a.frame - b.frame);
  const onlyInOriginal = originalHeld.length - frames;

  say('starting the Dreamport…');
  {
    await openDreamport(page, server, game, copy, { query: `?proof${recording.start ? `&${recording.start}` : ''}` });
    await page.evaluate(`window.__makeFilter = ${makeFilter}`);
    await page.evaluate(`window.__quick = ${quick && !asked.length}; window.__paced = ${paced}; window.__console = ${JSON.stringify({ id: machine.id, screen: machine.screen, frame: machine.frame, sound: machine.sound })};`);
    await page.evaluate(IN_PAGE);
    const buttons = await page.evaluate('dreamportsProof.buttons');
    // the recording's buttons as the Dreamport names them, and as the console's buttons for the original
    const named = new Map();
    for (const b of buttons) {
      const own = b.console ?? b.gba;
      if (own && !named.has(own)) named.set(own, b.name);
      if (!own) named.set(b.name, b.name);
    }
    const unknown = [...new Set(held.flat())].filter(b => !named.has(b));
    if (unknown.length) throw new Error(`The recording holds ${unknown.join(', ')}, which the game doesn't have: it has ${[...named.keys()].join(', ')}.`);
    const ownButtons = [...new Set(held.flat())].filter(b => !(b in KEY));
    if (ownButtons.length) console.log(`\n${name}: holds ${ownButtons.join(', ')}, which only the Dreamport has, so the frames after can't match the original.`);
    const masks = originalHeld.map(list => list.reduce((mask, b) => mask | (KEY[b] ?? 0), 0));
    // a game that reads its buttons just after the V-blank, rather than before it, reads each frame's in the
    // frame the tools count as the next one, so the original gets them a frame later (original.json)
    if (keysLate) masks.unshift(0);

    // the original: every frame's picture shows what the frame before worked out, so one more frame than the
    // buttons, and the Dreamport's frame f is the original's frame originalOf[f] + 1. Its sound lines up the same way
    say('playing the original…');
    const functions = codeMap?.functions ?? [];
    // and what it holds of each kind original.json lists under `shows`, such as who is playing, as its last frame ends
    const reads = kinds.map(({ address, bytes }) => ({ frame: originalHeld.length, address, bytes }));
    const first = await runOriginal({ copy, frames: originalHeld.length + 1, buttons: masks, functions, sound: true, sets, reads });
    if (kinds.length && first.outside.reads?.length !== kinds.length) throw new Error("The program that runs the original read nothing of its memory: npm run dp -- setup builds it again.");
    const showing = kinds.length ? shownOf(kinds, first.outside.reads) : null;
    checkSizes(first.outside.sizes, machine, Array.from(originalOf, g => g + 1), (_, frame) => frame);
    const expected = Array.from(originalOf, g => first.hashes[g + 1]);
    // where this step's change starts, as main's proof tells it, for the clip to start a second before (lib/clips.mjs):
    // a guess now, from main alone, and known once the Dreamport has played
    const recordingText = readFileSync(recording.file, 'utf8'), recordingFile = relative(REPO, recording.file).replaceAll('\\', '/');
    // (a frame's list comes as a Uint32Array, whose own map would turn the addresses back into numbers)
    const ranAt = codeMap && first.ran ? f => Array.from(first.ran[originalOf[f]] ?? [], i => hex(codeMap.functions[i].address)) : null;
    const changeOf = differs => firstChanged({ main, name, file: recordingFile, text: recordingText, frames, ran: ranAt, differs });
    const guessed = quick ? null : changeOf(null);
    const compareSound = soundOf(first.sound, machine), heardOf = Array.from(originalOf, g => g + 1);
    // the frames next to a stretch only the original has, whose sound isn't compared: the original's runs into or out
    // of the screen the Dreamport skips
    const unheard = new Set(recording.onlyInOriginal.flatMap(({ at }) => Array.from({ length: 2 * NEAR }, (_, i) => at - NEAR + i)).filter(f => f >= 0 && f < frames));

    // the Dreamport, a batch of frames at a time, keeping the pictures the results show: the clip's, and the
    // first frame that differs, with the first that differs where it matched when last proven
    const wasDifferent = !quick && before?.frames === frames ? inStretches(before.differs) : null;
    const wanted = new Set();
    const clipAt = recording.clip && !quick ? [recording.clip.at, recording.clip.at + recording.clip.frames - 1] : null;
    const planned = clipAt ?? (guessed ? clipWindow({ frames, changed: guessed, firstDifference: -1 }) : null);
    if (planned) for (let f = planned[0]; f <= planned[1]; f++) wanted.add(f);
    // the stills asked for, and each part's first and last frames with the one before and the one after
    const boundaries = parts.flatMap(({ frames: [a, b] }) => [a - 1, a, b, b + 1]);
    const stills = [...new Set([...asked, ...(quick ? [] : boundaries)])].filter(f => f >= 0 && f < frames).sort((a, b) => a - b);
    for (const f of stills) wanted.add(f);
    // --quick goes on no further than the first difference and what's asked for
    const lastAsked = Math.max(-1, ...asked, ...askedState);
    // each frame's picture hash, and how its sound differs, or null when it's the same
    const hashes = [], heard = [], sounds = [], keptFrames = new Set(), neverInPlay = [], ownSizes = [];
    const differs = f => hashes[f] !== expected[f] || sounds[f] !== null;
    let firstDifference = -1, firstNew = -1, firstPicture = -1, stopped = null;
    // the frames whose state to compare: those asked for, and the first picture that differs
    const stateFrames = new Set(askedState);
    await page.evaluate(`__proof.wantStates(${JSON.stringify(askedState)})`);
    const started = Date.now();
    for (let from = 0; from < frames && !(quick && firstDifference >= 0 && from > lastAsked); from += BATCH) {
      const count = Math.min(BATCH, frames - from);
      say(`frame ${from + count} of ${frames}`);
      const batch = held.slice(from, from + count).map(list => list.map(b => named.get(b)));
      const after = from + count < frames ? held[from + count].map(b => named.get(b)) : null;
      const played = await page.evaluate(`__proof.run(${from}, ${JSON.stringify(batch)}, ${JSON.stringify(expected.slice(from, from + count))}, ${quick ? lastAsked : Infinity}, ${JSON.stringify(after)})`);
      hashes.push(...played.hashes);
      heard.push(...played.sound);
      neverInPlay.push(...played.neverInPlay);
      ownSizes.push(...played.sizes);
      if (played.stopped) stopped = { frame: hashes.length, error: played.stopped };
      // a frame's sound is measured with the frame after it, so the batch's last waits for the next batch, unless it's the last
      const known = from + count === frames || played.hashes.length < count ? hashes.length : from + count - 1;
      for (let f = sounds.length; f < known; f++) sounds.push(unheard.has(f) ? null : compareSound(heard, heardOf, f));
      for (let f = Math.max(0, from - 1); f < known; f++) {
        // a sound that differs first doesn't hide the first picture that does
        if (firstPicture < 0 && hashes[f] !== expected[f]) {
          firstPicture = f;
          wanted.add(f);
          stateFrames.add(f);
        }
        if (!differs(f)) continue;
        if (firstDifference < 0) {
          firstDifference = f;
          wanted.add(f);
          // without a clip in the recording, the clip shows the four seconds before it and one after
          if (!clipAt && !quick) for (let g = Math.max(0, f - 240); g < Math.min(frames, f + 60); g++) wanted.add(g);
        }
        if (firstNew < 0 && wasDifferent && !wasDifferent.has(f)) {
          firstNew = f;
          wanted.add(f);
        }
      }
      const keep = [...wanted].filter(f => f < known && !keptFrames.has(f));
      for (const f of await page.evaluate(`__proof.keep(${JSON.stringify(keep)})`)) keptFrames.add(f);
      if (stopped) break;
    }
    // a game that stopped drew nothing more: the frame it stopped at and every one after differ
    const reached = hashes.length;
    if (stopped) {
      for (let f = reached; f < frames; f++) { hashes.push(null); sounds.push(null); }
      if (firstPicture < 0) firstPicture = stopped.frame;
      if (firstDifference < 0) {
        firstDifference = stopped.frame;
        // the clip shows the four seconds before it, as the game drew nothing more
        if (!clipAt && !quick) {
          const before = [];
          for (let f = Math.max(0, reached - 240); f < reached; f++) before.push(f);
          for (const f of await page.evaluate(`__proof.keep(${JSON.stringify(before)})`)) keptFrames.add(f);
        }
      }
      if (firstNew < 0 && wasDifferent && !wasDifferent.has(stopped.frame)) firstNew = stopped.frame;
    }
    const seconds = (Date.now() - started) / 1000;

    // what matched, picture and sound, and the functions that ran in those frames
    let matched = 0;
    const proven = new Set(), different = [], soundDifferent = [], pictureDifferent = [];
    for (let frame = 0; frame < hashes.length; frame++) {
      if (sounds[frame]) soundDifferent.push(frame);
      if (hashes[frame] !== expected[frame]) pictureDifferent.push(frame);
      if (differs(frame)) {
        different.push(frame);
        continue;
      }
      matched++;
      for (const f of first.ran[originalOf[frame]]) proven.add(f);
    }
    const differing = stretchesOf(different), soundDiffers = stretchesOf(soundDifferent);
    // the frames the game says no player could ever see, which fail however they compare: { from, to, why }
    const neverSeen = [];
    for (const { frame, why } of neverInPlay) {
      const last = neverSeen.at(-1);
      if (last?.why === why && last.to === frame - 1) last.to = frame;
      else neverSeen.push({ from: frame, to: frame, why });
    }
    const madeSound = await page.evaluate('__proof.heard');
    // where the original's screen is one colour, as it is between one screen and the next: { from, to, colour }
    const plain = [];
    for (let frame = 0; frame < frames; frame++) {
      const colour = first.plain[originalOf[frame] + 1], last = plain.at(-1);
      if (colour < 0) continue;
      if (last?.to === frame - 1 && last.value === colour) last.to = frame;
      else plain.push({ from: frame, to: frame, value: colour });
    }
    const oneColour = plain.map(({ from, to, value }) => ({ from, to, colour: colourName(value) }));
    // each part this recording proves, as the site will count it (src/lib/entries.mjs)
    const partsFound = parts.map(({ name: part, frames: [a, b] }) => {
      const first = different.find(f => f >= a && f <= b);
      const gap = recording.onlyInOriginal.find(g => g.at > a && g.at <= b);
      const never = neverSeen.find(({ from, to }) => from <= b && to >= a);
      return {
        name: part, frames: [a, b], proven: b < frames && first === undefined && !gap && !never, fromStart: fromStartPoint(recording, a),
        ...(b >= frames ? { past: frames - 1 } : {}),
        ...(first !== undefined ? { differs: first, ...(hashes[first] === expected[first] ? { soundOnly: true } : {}) } : {}),
        ...(gap ? { gap: gap.at } : {}),
        ...(never ? { neverInPlay: never.from } : {}),
      };
    });
    const newly = wasDifferent ? stretchesOf(different.filter(f => !wasDifferent.has(f))) : [];
    const fixed = wasDifferent ? stretchesOf([...wasDifferent].filter(f => f < frames && !differs(f)).sort((a, b) => a - b)) : [];

    // the clip: the recording's, or five seconds from a second before what this step changed, ending before the first
    // frame that differs, or else the last five seconds (lib/clips.mjs)
    const changed = quick ? null : changeOf(differing);
    const clip = clipAt ?? clipWindow({ frames, changed, firstDifference });
    if (!quick && !clipAt) {
      const wantedNow = [];
      for (let f = clip[0]; f <= clip[1]; f++) if (!keptFrames.has(f)) wantedNow.push(f);
      for (const f of await page.evaluate(`__proof.keep(${JSON.stringify(wantedNow)})`)) keptFrames.add(f);
    }
    // all of the clip that's kept: a console with a large screen keeps fewer pictures
    const clipFrames = [];
    if (!quick) for (let f = clip[0]; f <= clip[1]; f++) if (keptFrames.has(f)) clipFrames.push(f);

    // the original's pictures of those frames, then the stills and the clip, which mark the frames whose sound differs
    say('making the pictures and the clip…');
    await page.evaluate(`__proof.soundDiffers(${JSON.stringify(soundDifferent)})`);
    const kept = [...keptFrames].sort((a, b) => a - b);
    const statesOf = [...stateFrames].filter(f => f < frames).sort((a, b) => a - b);
    // the original only as far as the last frame wanted, as nothing else comes of the rest
    const wantedOriginal = [...kept, ...statesOf.filter(f => f < reached)].map(f => originalOf[f] + 1);
    const statesWanted = statesOf.filter(f => f < reached);
    const shown = !wantedOriginal.length ? null : await runOriginal({ copy, frames: Math.max(...wantedOriginal) + 1, buttons: masks, pictures: kept.map(f => originalOf[f] + 1), sets, states: statesWanted.map(f => originalOf[f] + 1) });
    // they reach the page as they are, from this computer's own server, with no copies along the way
    if (kept.length) {
      server.serve('/proof/originals', Buffer.concat(kept.map(f => {
        const picture = shown.pictures.get(originalOf[f] + 1);
        return Buffer.from(picture.buffer, picture.byteOffset, picture.byteLength);
      })));
      await page.evaluate(`__proof.originals(${JSON.stringify(kept)}, '/proof/originals')`);
      server.serve('/proof/originals', null);
      shown.pictures.clear();
    }
    const still = async (frame, file, difference) => {
      // --quick keeps no picture of a frame that differs only by its sound
      if (!keptFrames.has(frame)) return { frame, pixels: 0, box: null };
      const s = await page.evaluate(`__proof.still(${frame}, ${difference})`);
      writeFileSync(join(out, file), Buffer.from(s.png, 'base64'));
      return { frame, pixels: s.pixels, box: s.box };
    };
    const difference = firstDifference >= 0 ? await still(firstDifference, 'first-difference.png', true) : null;
    const newDifference = firstNew >= 0 ? await still(firstNew, 'first-new-difference.png', true) : null;
    const pictureDifference = firstPicture >= 0 && firstPicture !== firstDifference ? await still(firstPicture, 'first-picture-difference.png', true) : null;
    if (stills.length) mkdirSync(join(out, 'stills'), { recursive: true });
    const stillsFound = [];
    for (const f of stills.filter(f => f < reached)) stillsFound.push(await still(f, join('stills', `frame-${f}.png`), hashes[f] !== expected[f]));
    // what the console held, in the original and the Dreamport
    const states = [], notDrawn = [];
    for (const frame of statesWanted) {
      const ours = await page.evaluate(`__proof.state(${frame})`);
      if (ours === null) {
        if (machine.id === 'gba' || askedState.includes(frame)) notDrawn.push(frame);
      }
      else states.push({ frame, ...compareState(shown.states.get(originalOf[frame] + 1), Buffer.from(ours, 'base64')) });
    }
    // where the first frame whose sound differs is furthest from the original's
    const firstSound = soundDifferent.length ? { frame: soundDifferent[0], ...sounds[soundDifferent[0]] } : null;
    if (quick) return finish({});
    await still(clipFrames[0], 'clip-start.png', false);
    await still(clipFrames[clipFrames.length >> 1], 'clip-middle.png', false);
    await still(clipFrames.at(-1), 'clip-end.png', false);
    const length = clipFrames.length * machine.frame[0] / machine.frame[1];
    // the clip's frames whose halves are in two different places, those that differ from the original's at all, in
    // picture or sound, and those whose Dreamport is one colour or the same picture as the frame before, which share
    // won't let a pull request show (lib/clips.mjs)
    const apart = (await page.evaluate(`__proof.apart(${JSON.stringify(clipFrames)})`)).length;
    const clipDiffering = clipFrames.filter(f => differs(f)).length;
    const { oneColour: plainFrames, same } = await page.evaluate(`__proof.plainness(${JSON.stringify(clipFrames)})`);
    const encode = async alone => {
      let bitrate = Math.round(Math.min(CLIP_RATE, CLIP_TARGET * 8 / length) / (alone ? 2 : 1)), file;
      for (let tries = 0; tries < 5; tries++) {
        // the encoder's mode for screens has a size it won't go under, whatever the rate, so the last tries leave it
        const video = await page.evaluate(`__proof.video(${JSON.stringify(clipFrames)}, { bitrate: ${bitrate}, alone: ${alone}, screen: ${tries < 2} })`);
        file = mp4({
          width: video.width, height: video.height, description: Buffer.from(video.description, 'base64'),
          frames: video.frames.map(f => ({ key: f.key, data: Buffer.from(f.data, 'base64') })),
          timescale: machine.frame[1], duration: machine.frame[0],
        });
        if (file.length <= CLIP_LIMIT) break;
        bitrate = Math.round(bitrate * CLIP_TARGET / file.length);
      }
      return { file, bitrate };
    };
    const { file, bitrate } = await encode(false);
    writeFileSync(join(out, 'clip.mp4'), file);
    // the Dreamport on its own, with nothing of the original, which may go anywhere: share --clip takes it
    const own = await encode(true);
    writeFileSync(join(out, 'dreamport.mp4'), own.file);
    writeFileSync(join(out, 'dreamport.png'), Buffer.from((await page.evaluate(`__proof.still(${clipFrames[clipFrames.length >> 1]}, false, true)`)).png, 'base64'));

    const outside = first.outside;
    const report = {
      recording: name, recordingFile, recordingSha1: recordingHash(recordingText), frames, matched, ...(stopped ? { stopped } : {}), differs: differing, neverInPlay: neverSeen, firstDifference: difference, ...(pictureDifference ? { firstPictureDifference: pictureDifference } : {}), onlyInOriginal, oneColour, parts: partsFound, stills, pixels: stillsFound, states,
      sound: { heard: madeSound, differs: soundDiffers, firstDifference: firstSound, ...(unheard.size ? { notCompared: stretchesOf([...unheard].sort((a, b) => a - b)) } : {}) },
      ...(wasDifferent ? { sinceLastProven: { differs: newly, firstDifference: newDifference, matches: fixed } } : {}),
      clip: {
        from: clip[0], to: clip[1], frames: clipFrames.length, seconds: Math.round(length * 100) / 100, apart, differing: clipDiffering, oneColour: plainFrames, same,
        changed, newFrames: newFramesIn(clipFrames, changed), base: main?.base ?? null, bytes: file.length, bitrate, dreamport: { bytes: own.file.length, bitrate: own.bitrate },
      },
      ...(showing ? { shows: showing } : {}),
      seconds, errors: page.errors,
      ...(codeMap ? { functions: proven.size, outsideCodeMap: outside } : {}),
    };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return finish({ file, own, problems: clipProblems(report, recordingText, { base: main?.base ?? null }) });

    function finish({ file, own, problems = [] }) {
    first.sound.close();
    if (process.stdout.isTTY) process.stdout.write(`\r${''.padEnd(70)}\r`);
    const where = relative(REPO, out);
    const at = d => (stopped && d.frame >= stopped.frame ? `frame ${d.frame}, where the Dreamport stopped`
      : d.pixels || hashes[d.frame] !== expected[d.frame]
      ? `frame ${d.frame}: ${d.pixels} pixels${d.box ? `, from ${d.box[0]},${d.box[1]} to ${d.box[2]},${d.box[3]}` : ''}`
      : `frame ${d.frame}, by its sound`);
    if (firstDifference < 0) console.log(`${name}: all ${frames} frames the same in both, pictures and sound${onlyInOriginal ? ` (and ${onlyInOriginal} only the original has)` : ''}.`);
    else if (quick) {
      const picture = pictureDifference ? `, and the first picture that differs is ${at(pictureDifference)}` : '';
      console.log(`${name}: the first of ${frames} frames that differs is ${at(difference)}${picture}.`);
    } else {
      const picture = pictureDifference ? `, and the first picture that differs is ${at(pictureDifference)}` : firstPicture < 0 ? ', and every picture is the same' : '';
      console.log(`${name}: ${matched} of ${frames} frames the same, pictures and sound. The first that differs is ${at(difference)}${picture}.`);
      console.log(`  Frames that differ: ${listed(differing)}.`);
    }
    if (stopped) console.log(`  The Dreamport stopped at frame ${stopped.frame}, throwing ${stopped.error}, so it and every frame after differ. A path the game hasn't ported yet says so this way.`);
    for (const { from, to, why } of neverSeen) {
      console.log(`  No player could ever see frames ${listed([[from, to]])}: ${why}. So this recording fails, however its frames compare: a start point only skips the way there, as tools/README.md says under Start points.`);
    }
    for (const line of states.flatMap(({ frame, ...found }) => describeState(frame, found, hashes[frame] !== expected[frame]))) console.log(`  ${line}`);
    if (notDrawn.length) console.log(`  What the console holds can't be compared at frame${notDrawn.length > 1 ? 's' : ''} ${notDrawn.join(', ')}, as the Dreamport doesn't draw ${notDrawn.length > 1 ? 'them' : 'it'} with the kit's video (kit/gba/video.js).`);
    const askedPixels = stillsFound.filter(s => asked.includes(s.frame));
    if (askedPixels.length) {
      console.log(`  Pixels that differ in the frames asked for: ${askedPixels.slice(0, 12).map(s => `${s.frame}, ${s.pixels ? `${s.pixels.toLocaleString('en')}, from ${s.box[0]},${s.box[1]} to ${s.box[2]},${s.box[3]}` : 'none'}`).join('; ')}${askedPixels.length > 12 ? `; and ${askedPixels.length - 12} more in report.json` : ''}.`);
    }
    if (pictureDifferent.length && soundDifferent.length) console.log(`  Frames whose picture differs: ${listed(stretchesOf(pictureDifferent))}.`);
    // a picture of another size can't match, whatever its pixels are
    const otherSize = first.outside.sizes && firstOtherSize(first.outside.sizes, ownSizes, hashes.length, f => originalOf[f] + 1);
    if (otherSize) console.log(`  At frame ${otherSize.frame} the original's picture is ${otherSize.original.join(' by ')} and the Dreamport's ${otherSize.dreamport.join(' by ')}, so they can't match.`);
    if (soundDifferent.length) {
      const { frame, side, band, original: theirs, dreamport: ours, dB, silent } = firstSound;
      const where = `around ${band.toLocaleString('en')} Hz, on the ${side}`;
      console.log(`  Frames whose sound differs: ${listed(soundDiffers)}.${madeSound ? '' : ' The Dreamport makes no sound yet.'}`);
      console.log(`  The first is frame ${frame}: ${silent === 'dreamport' ? `the Dreamport is silent, and the original ${theirs} steps loud ${where}`
        : silent === 'original' ? `the original is silent, and the Dreamport ${ours} steps loud ${where}`
          : `${where}, the original is ${theirs} steps loud and the Dreamport ${ours}, ${dB} dB apart`}.`);
    }
    if (unheard.size) console.log(`  The sound of frames ${listed(stretchesOf([...unheard].sort((a, b) => a - b)))} isn't compared, next to the frames only the original has.`);
    if (newly.length) console.log(`  Differs where it matched when last proven: ${listed(newly)}. The first is ${at(newDifference)}.`);
    if (oneColour.length && !quick && (asked.length || !parts.length)) {
      const shown = oneColour.slice(0, 12).map(({ from, to, colour }) => `${from === to ? from : `${from} to ${to}`} (${colour})`).join(', ');
      console.log(`  The original's screen is one colour, as between screens, at frames ${shown}${oneColour.length > 12 ? `, and ${oneColour.length - 12} more in report.json` : ''}.`);
    }
    const provenParts = partsFound.filter(part => part.proven && !part.fromStart);
    if (provenParts.length && !quick) console.log(`  Proven, every frame the same: ${provenParts.map(part => `${part.name}, frames ${part.frames[0]} to ${part.frames[1]}`).join('; ')}.`);
    for (const part of quick ? [] : partsFound.filter(part => !provenParts.includes(part))) {
      const state = part.past !== undefined ? `ends past the recording's last frame, ${part.past}`
        : part.differs !== undefined ? `not proven, as ${part.soundOnly ? 'the sound of ' : ''}frame ${part.differs} differs`
          : part.neverInPlay !== undefined ? `not proven, as no player could ever see frame ${part.neverInPlay}`
          : part.gap !== undefined ? `not proven, as the original has frames of its own before frame ${part.gap}`
            : 'proven from a start point, every frame the same. Prove it again from power-on once the game reaches it';
      console.log(`  ${part.name}, frames ${part.frames[0]} to ${part.frames[1]}: ${state}.`);
    }
    // what people already found about what differs here (docs/NOTES.md)
    const unproven = partsFound.filter(part => !part.proven).map(part => part.name);
    for (const note of notesAbout(versionOf(game).game, about => unproven.includes(about) || (firstDifference >= 0 && about === name))) {
      console.log(`  A note on this: ${note.title} npm run dp -- notes ${versionOf(game).game} ${note.name} prints it.`);
    }
    const outOfReach = asked.filter(f => f >= frames);
    if (outOfReach.length) console.log(`  --stills names frames past the recording's last, ${frames - 1}: ${outOfReach.slice(0, 8).join(', ')}${outOfReach.length > 8 ? '…' : ''}.`);
    if (stills.length && (asked.length || firstDifference >= 0)) console.log(`  Stills of ${asked.length ? 'the frames asked for' : ''}${asked.length && parts.length && !quick ? ', and of ' : ''}${parts.length && !quick ? 'each part\'s first and last frames, with the one before and the one after' : ''}: ${where}/stills/`);
    if (fixed.length) console.log(`  Matches where it differed when last proven: ${listed(fixed)}.`);
    if (page.errors.length) console.log(`  The page reported ${page.errors.length} errors; ${where}/report.json lists them.`);
    if (codeMap && first.outside.cartridge) {
      console.log(`  Instructions that ran in the cartridge outside every function of the code map: ${first.outside.cartridge}. npm run dp -- codemap ${versionOf(game).game} --fill adds what the map is missing.`);
    }
    if (!quick) console.log(`  Clip, ${(file.length / 1e6).toFixed(2)} MB, frames ${clip[0]} to ${clip[1]}: ${where}/clip.mp4`);
    if (!quick && file.length > CLIP_LIMIT) console.log('  The clip is still over 2 MB: a shorter "clip" in the recording makes it lighter.');
    // where this step's change starts, and what share would refuse, said now, while the recording can still change
    // a recording the step changed nothing in has nothing to say about its clip, which share leaves out
    if (!quick) console.log(`  What this step changed: ${changedText(changed)}${changed ? '' : ', so share leaves this clip out'}.`);
    if (changed) for (const problem of problems) console.log(`  share won't put this clip in a pull request: ${problem}`);
    if (showing) console.log(`  What the original shows as it ends: ${Object.entries(showing).map(([kind, value]) => `its ${kind} is ${typeof value === 'number' ? `${value}, which original.json gives no name` : value}`).join('; ')}.`);
    return { frames, matched: quick && firstDifference >= 0 ? hashes.length - 1 : matched, differs: differing, soundDiffers, onlyInOriginal, neverInPlay: neverSeen, ...(showing ? { shows: showing } : {}), functions: [...proven].sort((a, b) => a - b).map(i => hex(codeMap.functions[i].address)) };
    }
  }
}
