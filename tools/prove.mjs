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
// original's own memory says it doesn't show as it ends (src/lib/shows.mjs), and when a part of it names what it reaches
// and the original doesn't get there within the part's frames (src/lib/reaches.mjs). With --quick it stops at the first frame that differs, and says what differs
// there, with no clip and nothing written to progress.json: a round of work, with the plain prove to finish it. The
// pictures and the clips stay in .dreamports/results/ on this computer: they show the game, so they never go in a commit.
// Several recordings play at the same time, each in a page of the browser and a thread of this tool of its own, as many
// as the computer has room for as it starts (lib/at-once.mjs), or as --at-once says. Each still prints everything it
// found in one piece, in the usual order. A whole game's proof sums up, in a line or two, the recordings that came out
// as when last proven and that this step changed nothing in, as nothing about them is news, and --all prints each of
// those in full too, as naming a recording does.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { REPO, LOCAL, resultFolder } from './lib/paths.mjs';
import { readOriginal, readRecordings, readCodeMap, readProgress, writeProgress, readParts, hex } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { originalPlay, namesNeverInPlay } from './lib/recording.mjs';
import { serveRepository } from './lib/server.mjs';
import { joinChrome, openChrome } from './lib/chrome.mjs';
import { buildIfC, openDreamport } from './lib/dreamport.mjs';
import { atOnce } from './lib/at-once.mjs';
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
import { reachedAt, whyUnreached } from '../src/lib/reaches.mjs';
import { goalsNamed, heldOver, readRoute } from './lib/route.mjs';
import { recordingHash, mainProof, firstChanged, clipWindow, newFramesIn, clipProblems, changedText } from './lib/clips.mjs';
import { keepRecord, recordOf } from './lib/same-proof.mjs';
import { DIFFERS_AS_BEFORE, provenBefore, worseThan } from './lib/as-before.mjs';

const BATCH = 120;
const STILLS = 600, STATES = 20;
// a goal that comes and goes more often than this in one recording is no goal
const GOAL_STRETCHES = 64;
// a clip stays under 2 MB: encoded again at a lower rate while it's over, as the encoder can overshoot its target.
// A calm clip stops well short of its rate, which only decides what fast play gets
const CLIP_LIMIT = 2_000_000, CLIP_TARGET = 1_700_000, CLIP_RATE = 2_000_000;
const IN_PAGE = readFileSync(new URL('./lib/in-page.js', import.meta.url), 'utf8');

export async function run(args) {
  const stillsAt = args.indexOf('--stills'), stateAt = args.indexOf('--state');
  const askedState = stateAt >= 0 ? framesIn(args[stateAt + 1], '--state', STATES) : [];
  // a frame whose state is asked for gets its picture too
  const asked = [...new Set([...(stillsAt >= 0 ? framesIn(args[stillsAt + 1], '--stills', STILLS) : []), ...askedState])].sort((x, y) => x - y);
  const atOnceAt = args.indexOf('--at-once');
  const [game, ...names] = args.filter((a, i) => !a.startsWith('--') && [stillsAt, stateAt, atOnceAt].every(at => at < 0 || i !== at + 1));
  if (!game) throw new Error('Usage: npm run dp -- prove <game> [recording…] [--quick] [--stills <frames>] [--state <frames>] [--all] [--at-once <how many>]');
  const quick = args.includes('--quick');
  const original = readOriginal(game);
  const reference = await referenceOf(original);
  const recordings = readRecordings(game, names);
  if (!recordings.length) throw new Error(`games/${game}/proof/recordings/ has no recordings yet: make one with npm run dp -- play ${game} --record <name>.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The proof uses ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const codeMap = readCodeMap(game);
  if (codeMap && codeMap.original !== original.sha1) throw new Error(`games/${game}/proof/code-map.json is for another copy than original.json names.`);
  reference.ensureOriginal(console.log);

  const progress = readProgress(game);
  // a whole game's plain proof says in full only what's news: the recordings that came out as when last proven, and
  // that this step changed nothing in, are summed up at the end
  const summing = !names.length && !quick && !asked.length && !args.includes('--all');
  const asBefore = (result, name) => !result.changed && !result.wrong && !result.neverInPlay.length && !result.unreached?.length && JSON.stringify(keptOf(result)) === JSON.stringify(progress.recordings[name]);
  // what every lane plays with: what was asked, and what each recording found when last proven
  const paced = args.includes('--paced');
  const setup = { game, quick, paced, asked, askedState, before: progress.recordings };
  // how many play at the same time. One held to the console's speed plays alone, as its page does the timing
  const lanes = atOnce({ wanted: recordings.length, asked: paced ? 1 : atOnceAt >= 0 ? args[atOnceAt + 1] : undefined });
  // each recording's result, kept with what it said until every one before it has ended, so they print and are
  // written in the usual order whichever ends first
  const results = new Array(recordings.length), said = recordings.map(() => []), quiet = [];
  let browser = null, printed = 0;
  const status = text => lanes > 1 && process.stdout.isTTY && process.stdout.write(`\r${text.padEnd(70)}${text ? '' : '\r'}`);
  const ended = (at, result, lines = []) => {
    results[at] = result;
    said[at] = lines;
    if (summing && asBefore(result, recordings[at].name)) {
      quiet.push(at);
      said[at] = [];
    }
    status('');
    for (; printed < recordings.length && results[printed]; printed++) for (const line of said[printed]) console.log(line);
    const count = results.filter(Boolean).length;
    if (count < recordings.length) status(`${count} of ${recordings.length} recordings played…`);
  };
  const threads = [];
  try {
    // the game's C is built before anything plays, so every page finds it built (lib/c.mjs)
    await buildIfC(game);
    // one browser for all of them, with each recording's page starting from nothing
    browser = await openChrome({ profile: join(LOCAL, 'chrome', 'prove'), headless: true });
    const waiting = recordings.map((_, at) => at);
    if (lanes === 1) {
      // alone, each line shows as it's found, with what it's doing on a line that changes in a terminal
      const lane = await laneFor(setup);
      try {
        for (let page = browser; waiting.length; page = waiting.length ? await page.another() : page) {
          const at = waiting.shift(), { name } = recordings[at];
          const say = text => process.stdout.isTTY && process.stdout.write(text ? `\r${`${name}: ${text}`.padEnd(70)}` : `\r${''.padEnd(70)}\r`);
          // a recording that may be summed up says nothing until it ends
          const lines = [];
          ended(at, await lane.play(name, page, { log: summing ? line => lines.push(line) : console.log, say }), lines);
        }
      } finally {
        await lane.close();
      }
    } else {
      // the longest first, so the last to end isn't a long one that started late
      const length = recording => recording.frames + recording.onlyInOriginal.reduce((sum, stretch) => sum + stretch.frames, 0);
      waiting.sort((a, b) => length(recordings[b]) - length(recordings[a]) || a - b);
      // a thread each, which asks for its next recording as it ends one (the end of this file)
      await Promise.all(Array.from({ length: lanes }, () => new Promise((resolve, reject) => {
        const thread = new Worker(new URL(import.meta.url), { workerData: { lane: setup, port: browser.port } });
        threads.push(thread);
        thread.on('message', ({ at, result, lines, error }) => {
          if (error) return reject(new Error(error));
          if (result) ended(at, result, lines);
          if (!waiting.length) return resolve();
          const next = waiting.shift();
          thread.postMessage({ at: next, name: recordings[next].name });
        });
        thread.on('error', reject);
        thread.on('exit', () => reject(new Error('A thread playing a recording ended before its time.')));
      })));
    }
  } finally {
    status('');
    await Promise.all(threads.map(thread => thread.terminate()));
    await browser?.close();
  }
  const failed = results.some(result => result.matched < result.frames || result.neverInPlay.length > 0 || result.wrong > 0 || result.unreached?.length > 0);
  if (quiet.length) for (const line of summed(quiet.sort((a, b) => a - b).map(at => ({ name: recordings[at].name, ...results[at] })), recordings.length)) console.log(line);
  if (!quick) recordings.forEach((recording, at) => { progress.recordings[recording.name] = keptOf(results[at]); });

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
  // what a whole proof found, which share can show in place of a clip when the step changed no frame (lib/same-proof.mjs)
  if (!names.length) {
    const file = `games/${game}/proof/progress.json`;
    keepRecord(recordOf(game, { recordings: recordings.length, progress: readFileSync(join(REPO, file), 'utf8'), mains: mainProof(game)?.files(file) ?? null }));
  }
  // the two numbers the game shows now
  try {
    const { ported, gameplay } = readProof(game) ?? {};
    console.log([ported && `Code ported: ${percentText(ported.percent)}${totals.proven ? `, ${totals.proven.functions} of ${totals.codeMap.functions} functions` : ''}.`,
      gameplay && `Gameplay proven: ${percentText(gameplay.percent)}, ${gameplay.proven} of ${gameplay.total} parts.`].filter(Boolean).join(' '));
  } catch (error) {
    console.log(error.message);
  }
  if (!failed) return 0;
  // frames differ: a step back, when one that matched in the last commit differs now, or as things were (lib/as-before.mjs)
  const worse = worseThan(provenBefore(game), recordings.map((recording, at) => ({ name: recording.name, row: keptOf(results[at]), wrong: results[at].wrong, unreached: results[at].unreached })));
  if (!worse.length) {
    console.log('No frame that matched in the last commit differs.');
    return DIFFERS_AS_BEFORE;
  }
  console.log(`Worse than the last commit has ${worse.length === 1 ? 'it' : 'them'}: ${worse.slice(0, 6).map(each => `${each.name}, as ${each.why}`).join('; ')}${worse.length > 6 ? `; and ${worse.length - 6} more` : ''}.`);
  return 1;
}

/** What progress.json keeps of what a recording found. */
const keptOf = result => ({
  frames: result.frames,
  matched: result.matched,
  differs: result.differs,
  ...(result.soundDiffers.length ? { soundDiffers: result.soundDiffers } : {}),
  ...(result.onlyInOriginal ? { onlyInOriginal: result.onlyInOriginal } : {}),
  ...(result.neverInPlay.length ? { neverInPlay: result.neverInPlay } : {}),
  ...(result.shows ? { shows: result.shows } : {}),
  ...(result.reached ? { reached: result.reached } : {}),
  functions: result.functions,
});

/**
 * The lines that sum up the recordings a whole game's proof found as when last proven, with nothing this step changed
 * in them: `found` holds each one's { name, frames, matched, differs }, in order, of `all` recordings played.
 */
export function summed(found, all) {
  const same = found.filter(r => r.matched === r.frames), differing = found.filter(r => r.matched < r.frames);
  return [
    `\n${found.length} of ${all} recordings came out as when last proven, and this step changed nothing in them. --all prints each one in full.`,
    ...(same.length ? [`  Every frame the same, ${same.length}: ${same.map(r => r.name).join(', ')}.`] : []),
    ...(differing.length ? [`  Differing from the same frame as before, ${differing.length}: ${differing.map(r => `${r.name} from ${r.differs[0]?.[0] ?? r.matched}`).join(', ')}.`] : []),
  ];
}

/**
 * What prove says of a recording that matches on every frame while no part names it, in a game whose parts don't all
 * have a recording yet: one made for a foundation may play a whole part by now, which counts only once parts.json
 * names it. `parts` is the game's, as parts.json lists them. Null when a part names the recording or every part has one.
 */
export function partsItCouldProve(name, parts) {
  if (parts.some(part => part.recording === name)) return null;
  const waiting = parts.filter(part => !part.recording).map(part => part.name);
  if (!waiting.length) return null;
  const shown = `${waiting.slice(0, 4).join(', ')}${waiting.length > 4 ? `, and ${waiting.length - 4} more` : ''}`;
  return `No part names this recording, and ${waiting.length === 1 ? 'one of the game\'s parts has' : `${waiting.length} of the game's parts have`} no recording yet: ${shown}. `
    + 'If it plays one of them whole, from its first frame to its last, the part counts as proven once parts.json names this recording and those frames: npm run dp -- help proving a part.';
}

/**
 * What plays recordings one after another, one at a time: it reads what they all need once, serves the repository to their pages, and
 * `play(name, page, { log, say })` resolves to what the recording called `name` found, as `run` keeps it, with
 * `wrong`, how many things its name says that the original doesn't show. `log` takes each line it has to say, and
 * `say` what it's doing now. `close()` ends it.
 */
async function laneFor({ game, quick, paced, asked, askedState, before }) {
  const original = readOriginal(game);
  // what main's proof had, which tells the frames this step changed, where each clip starts (lib/clips.mjs)
  const main = quick ? null : mainProof(game);
  const kinds = kindsOf(original, `games/${versionOf(game).game}/proof/original.json`);
  const reference = await referenceOf(original), copy = copyWith(original.sha1).path, codeMap = readCodeMap(game), parts = readParts(game);
  // what the game says of its original, for the parts that name what they reach (src/lib/reaches.mjs)
  const route = parts.some(part => part.reaches !== undefined) ? readRoute(game, reference.KEY) : null;
  const server = await serveRepository();
  return {
    close: () => server.close(),
    async play(name, page, { log, say }) {
      const [recording] = readRecordings(game, [name]);
      const own = parts.filter(p => p.recording === name && Array.isArray(p.frames) && p.frames.length === 2 && p.frames.every(Number.isInteger));
      try {
        if (recording.players && own.some(part => part.reaches !== undefined)) throw new Error('A recording that links several consoles can\'t prove a part that names what it reaches yet, as only one console\'s memory is read.');
        const result = recording.players ? await proveLinked({ page, game, recording, copy, server, main, quick, asked, log, say })
          : await prove({ page, reference, game, recording, copy, server, codeMap, main, before: before[name], asked, askedState, parts: own, couldProve: partsItCouldProve(name, parts), kinds, route, keysLate: original.keysAfterVBlank === true, paced, quick, log, say });
        // what the original shows is checked however the frames compare, and a linked recording, played by more than one
        // console, isn't read
        const wrong = showsProblems(name, result.shows, recording.players ? [] : kinds);
        for (const problem of wrong) log(`  ${problem}`);
        return { ...result, wrong: wrong.length };
      } catch (error) {
        // which recording it was, as several may be playing
        throw error.message.startsWith(`${name}:`) ? error : new Error(`${name}: ${error.message}`, { cause: error });
      }
    },
  };
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

async function prove({ page, reference, game, recording, copy, server, codeMap, main, before, asked, askedState, parts, couldProve, kinds, route, keysLate, paced, quick, log, say }) {
  const { name, frames } = recording;
  const { machine, KEY, runOriginal } = reference;
  const out = resultFolder(game, name);
  if (!quick) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // which of the original's frames is each of the Dreamport's: the same, but for the frames only the original has
  const { held, originalOf, originalHeld, sets } = originalPlay(recording, { keysLate });
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
    if (ownButtons.length) log(`\n${name}: holds ${ownButtons.join(', ')}, which only the Dreamport has, so the frames after can't match the original.`);
    const masks = originalHeld.map(list => list.reduce((mask, b) => mask | (KEY[b] ?? 0), 0));
    // a game that reads its buttons just after the V-blank, rather than before it, reads each frame's in the
    // frame the tools count as the next one, so the original gets them a frame later (original.json)
    if (keysLate) masks.unshift(0);

    // the original: every frame's picture shows what the frame before worked out, so one more frame than the
    // buttons, and the Dreamport's frame f is the original's frame originalOf[f] + 1. Its sound lines up the same way
    say('playing the original…');
    const functions = codeMap?.functions ?? [];
    // what its parts say they reach, read as each of the recording's frames ends (src/lib/reaches.mjs), and what it
    // holds of each kind original.json lists under `shows`, such as who is playing, as its last frame ends
    const aims = goalsNamed(parts, route, `games/${versionOf(game).game}/proof/`);
    const reads = [
      ...Array.from(originalOf, at => aims.values.map(({ address, bytes }) => ({ frame: at + (keysLate ? 1 : 0), address, bytes }))).flat(),
      ...kinds.map(({ address, bytes }) => ({ frame: originalHeld.length, address, bytes })),
    ];
    // its pictures that are sure to be wanted come from this run too, so the original isn't played again for them:
    // the stills, and the clip a recording shows when the step changed nothing in it, its own or its last five seconds
    const clipAt = recording.clip && !quick ? [recording.clip.at, recording.clip.at + recording.clip.frames - 1] : null;
    // the stills asked for, and each part's first and last frames with the one before and the one after
    const boundaries = parts.flatMap(({ frames: [a, b] }) => [a - 1, a, b, b + 1]);
    const stills = [...new Set([...asked, ...(quick ? [] : boundaries)])].filter(f => f >= 0 && f < frames).sort((a, b) => a - b);
    const sure = new Set(stills);
    if (!quick) for (let [f, last] = clipAt ?? clipWindow({ frames, changed: null, firstDifference: -1 }); f <= last && f < frames; f++) if (f >= 0) sure.add(f);
    const first = await runOriginal({ copy, frames: originalHeld.length + 1, buttons: masks, functions, sound: true, sets, reads, pictures: [...sure].sort((a, b) => a - b).map(f => originalOf[f] + 1) });
    if (reads.length && first.outside.reads?.length !== reads.length) throw new Error("The program that runs the original read nothing of its memory: npm run dp -- setup builds it again.");
    const showing = kinds.length ? shownOf(kinds, first.outside.reads.slice(reads.length - kinds.length)) : null;
    // the frames over which each goal held, and the parts whose goal doesn't come true within their own
    const goalsHeld = aims.goals.length ? heldOver(aims, first.outside.reads, frames, route) : null;
    for (const [goal, stretches] of Object.entries(goalsHeld ?? {})) {
      if (stretches.length > GOAL_STRETCHES) throw new Error(`The goal "${goal}" comes and goes ${stretches.length} times in this recording, which is no goal: one holds from when the game gets there.`);
    }
    const unreached = parts.filter(part => part.reaches !== undefined && reachedAt(goalsHeld[part.reaches], part.frames) === null)
      .map(part => ({ name: part.name, goal: part.reaches, frames: part.frames, why: whyUnreached(part.reaches, goalsHeld[part.reaches], part.frames) }));
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
    const planned = clipAt ?? (guessed ? clipWindow({ frames, changed: guessed, firstDifference: -1 }) : null);
    if (planned) for (let f = planned[0]; f <= planned[1]; f++) wanted.add(f);
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
      const short = unreached.find(each => each.name === part);
      return {
        name: part, frames: [a, b], proven: b < frames && first === undefined && !gap && !never && !short, fromStart: fromStartPoint(recording, a),
        ...(short ? { unreached: short.goal } : {}),
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
    // the original again only for what its first run didn't bring, such as the pictures around the first frame that
    // differs, and only as far as the last frame wanted, as nothing else comes of the rest
    const missing = kept.filter(f => !first.pictures.has(originalOf[f] + 1));
    const statesWanted = statesOf.filter(f => f < reached);
    const wantedOriginal = [...missing, ...statesWanted].map(f => originalOf[f] + 1);
    const shown = !wantedOriginal.length ? null : await runOriginal({ copy, frames: Math.max(...wantedOriginal) + 1, buttons: masks, pictures: missing.map(f => originalOf[f] + 1), sets, states: statesWanted.map(f => originalOf[f] + 1) });
    // they reach the page as they are, from this computer's own server, with no copies along the way
    if (kept.length) {
      server.serve('/proof/originals', Buffer.concat(kept.map(f => {
        const picture = first.pictures.get(originalOf[f] + 1) ?? shown.pictures.get(originalOf[f] + 1);
        return Buffer.from(picture.buffer, picture.byteOffset, picture.byteLength);
      })));
      await page.evaluate(`__proof.originals(${JSON.stringify(kept)}, '/proof/originals')`);
      server.serve('/proof/originals', null);
      first.pictures.clear();
      shown?.pictures.clear();
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
      sound: { heard: madeSound, differs: soundDiffers, firstDifference: firstSound, ...(unheard.size ? { notCompared: stretchesOf([...unheard].sort((a, b) => a - b)) } : {}), ...(compareSound.dips.length ? { dips: stretchesOf(compareSound.dips) } : {}) },
      ...(wasDifferent ? { sinceLastProven: { differs: newly, firstDifference: newDifference, matches: fixed } } : {}),
      clip: {
        from: clip[0], to: clip[1], frames: clipFrames.length, seconds: Math.round(length * 100) / 100, apart, differing: clipDiffering, oneColour: plainFrames, same,
        changed, newFrames: newFramesIn(clipFrames, changed), base: main?.base ?? null, bytes: file.length, bitrate, dreamport: { bytes: own.file.length, bitrate: own.bitrate },
      },
      ...(showing ? { shows: showing } : {}),
      ...(goalsHeld ? { reached: goalsHeld } : {}),
      seconds, errors: page.errors,
      ...(codeMap ? { functions: proven.size, outsideCodeMap: outside } : {}),
    };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return finish({ file, own, problems: clipProblems(report, recordingText, { base: main?.base ?? null }) });

    function finish({ file, own, problems = [] }) {
    first.sound.close();
    say('');
    const where = relative(REPO, out);
    const at = d => (stopped && d.frame >= stopped.frame ? `frame ${d.frame}, where the Dreamport stopped`
      : d.pixels || hashes[d.frame] !== expected[d.frame]
      ? `frame ${d.frame}: ${d.pixels} pixels${d.box ? `, from ${d.box[0]},${d.box[1]} to ${d.box[2]},${d.box[3]}` : ''}`
      : `frame ${d.frame}, by its sound`);
    if (firstDifference < 0) log(`${name}: all ${frames} frames the same in both, pictures and sound${onlyInOriginal ? ` (and ${onlyInOriginal} only the original has)` : ''}.`);
    else if (quick) {
      const picture = pictureDifference ? `, and the first picture that differs is ${at(pictureDifference)}` : '';
      log(`${name}: the first of ${frames} frames that differs is ${at(difference)}${picture}.`);
    } else {
      const picture = pictureDifference ? `, and the first picture that differs is ${at(pictureDifference)}` : firstPicture < 0 ? ', and every picture is the same' : '';
      log(`${name}: ${matched} of ${frames} frames the same, pictures and sound. The first that differs is ${at(difference)}${picture}.`);
      log(`  Frames that differ: ${listed(differing)}.`);
    }
    if (stopped) log(`  The Dreamport stopped at frame ${stopped.frame}, throwing ${stopped.error}, so it and every frame after differ. A path the game hasn't ported yet says so this way.`);
    for (const { from, to, why } of neverSeen) {
      log(`  No player could ever see frames ${listed([[from, to]])}: ${why}. So this recording fails, however its frames compare: a start point only skips the way there, as tools/README.md says under Start points.`);
    }
    for (const { name: part, goal, frames: [a, b], why } of unreached) {
      log(`  ${part}, frames ${a} to ${b}, says it reaches ${goal}, and ${why}. So it isn't proven, however its frames compare: the recording has to get there within the part's frames, as tools/README.md says under What a part reaches.`);
    }
    for (const line of states.flatMap(({ frame, ...found }) => describeState(frame, found, hashes[frame] !== expected[frame]))) log(`  ${line}`);
    if (notDrawn.length) log(`  What the console holds can't be compared at frame${notDrawn.length > 1 ? 's' : ''} ${notDrawn.join(', ')}, as the Dreamport doesn't draw ${notDrawn.length > 1 ? 'them' : 'it'} with the kit's video (kit/gba/video.js).`);
    const askedPixels = stillsFound.filter(s => asked.includes(s.frame));
    if (askedPixels.length) {
      log(`  Pixels that differ in the frames asked for: ${askedPixels.slice(0, 12).map(s => `${s.frame}, ${s.pixels ? `${s.pixels.toLocaleString('en')}, from ${s.box[0]},${s.box[1]} to ${s.box[2]},${s.box[3]}` : 'none'}`).join('; ')}${askedPixels.length > 12 ? `; and ${askedPixels.length - 12} more in report.json` : ''}.`);
    }
    if (pictureDifferent.length && soundDifferent.length) log(`  Frames whose picture differs: ${listed(stretchesOf(pictureDifferent))}.`);
    // a picture of another size can't match, whatever its pixels are
    const otherSize = first.outside.sizes && firstOtherSize(first.outside.sizes, ownSizes, hashes.length, f => originalOf[f] + 1);
    if (otherSize) log(`  At frame ${otherSize.frame} the original's picture is ${otherSize.original.join(' by ')} and the Dreamport's ${otherSize.dreamport.join(' by ')}, so they can't match.`);
    if (soundDifferent.length) {
      const { frame, side, band, original: theirs, dreamport: ours, dB, silent } = firstSound;
      const where = `around ${band.toLocaleString('en')} Hz, on the ${side}`;
      log(`  Frames whose sound differs: ${listed(soundDiffers)}.${madeSound ? '' : ' The Dreamport makes no sound yet.'}`);
      log(`  The first is frame ${frame}: ${silent === 'dreamport' ? `the Dreamport is silent, and the original ${theirs} steps loud ${where}`
        : silent === 'original' ? `the original is silent, and the Dreamport ${ours} steps loud ${where}`
          : `${where}, the original is ${theirs} steps loud and the Dreamport ${ours}, ${dB} dB apart`}.`);
    }
    if (unheard.size) log(`  The sound of frames ${listed(stretchesOf([...unheard].sort((a, b) => a - b)))} isn't compared, next to the frames only the original has.`);
    if (compareSound.dips.length) log(`  Frames where one band of the sound dips for a moment, as two voices on one note cancel, which counts as the same: ${listed(stretchesOf(compareSound.dips))}.`);
    if (newly.length) log(`  Differs where it matched when last proven: ${listed(newly)}. The first is ${at(newDifference)}.`);
    if (oneColour.length && !quick && (asked.length || !parts.length)) {
      const shown = oneColour.slice(0, 12).map(({ from, to, colour }) => `${from === to ? from : `${from} to ${to}`} (${colour})`).join(', ');
      log(`  The original's screen is one colour, as between screens, at frames ${shown}${oneColour.length > 12 ? `, and ${oneColour.length - 12} more in report.json` : ''}.`);
    }
    // a recording this step changed that matches all through, as one made for a foundation does, may play a whole part
    if (couldProve && changed && firstDifference < 0 && !neverSeen.length) log(`  ${couldProve}`);
    const provenParts = partsFound.filter(part => part.proven && !part.fromStart);
    if (provenParts.length && !quick) log(`  Proven, every frame the same: ${provenParts.map(part => `${part.name}, frames ${part.frames[0]} to ${part.frames[1]}`).join('; ')}.`);
    for (const part of quick ? [] : partsFound.filter(part => !provenParts.includes(part))) {
      const state = part.past !== undefined ? `ends past the recording's last frame, ${part.past}`
        : part.differs !== undefined ? `not proven, as ${part.soundOnly ? 'the sound of ' : ''}frame ${part.differs} differs`
          : part.neverInPlay !== undefined ? `not proven, as no player could ever see frame ${part.neverInPlay}`
          : part.gap !== undefined ? `not proven, as the original has frames of its own before frame ${part.gap}`
            : part.unreached !== undefined ? `not proven, though every frame is the same, as it doesn't get to ${part.unreached}`
            : 'proven from a start point, every frame the same. Prove it again from power-on once the game reaches it';
      log(`  ${part.name}, frames ${part.frames[0]} to ${part.frames[1]}: ${state}.`);
    }
    // what people already found about what differs here (docs/NOTES.md)
    const unproven = partsFound.filter(part => !part.proven).map(part => part.name);
    for (const note of notesAbout(versionOf(game).game, about => unproven.includes(about) || (firstDifference >= 0 && about === name))) {
      log(`  A note on this: ${note.title} npm run dp -- notes ${versionOf(game).game} ${note.name} prints it.`);
    }
    const outOfReach = asked.filter(f => f >= frames);
    if (outOfReach.length) log(`  --stills names frames past the recording's last, ${frames - 1}: ${outOfReach.slice(0, 8).join(', ')}${outOfReach.length > 8 ? '…' : ''}.`);
    if (stills.length && (asked.length || firstDifference >= 0)) log(`  Stills of ${asked.length ? 'the frames asked for' : ''}${asked.length && parts.length && !quick ? ', and of ' : ''}${parts.length && !quick ? 'each part\'s first and last frames, with the one before and the one after' : ''}: ${where}/stills/`);
    if (fixed.length) log(`  Matches where it differed when last proven: ${listed(fixed)}.`);
    if (page.errors.length) log(`  The page reported ${page.errors.length} errors; ${where}/report.json lists them.`);
    if (codeMap && first.outside.cartridge) {
      log(`  Instructions that ran in the cartridge outside every function of the code map: ${first.outside.cartridge}. npm run dp -- codemap ${versionOf(game).game} --fill adds what the map is missing.`);
    }
    if (!quick) log(`  Clip, ${(file.length / 1e6).toFixed(2)} MB, frames ${clip[0]} to ${clip[1]}: ${where}/clip.mp4`);
    if (!quick && file.length > CLIP_LIMIT) log('  The clip is still over 2 MB: a shorter "clip" in the recording makes it lighter.');
    // where this step's change starts, and what share would refuse, said now, while the recording can still change
    // a recording the step changed nothing in has nothing to say about its clip, which share leaves out
    if (!quick) log(`  What this step changed: ${changedText(changed)}${changed ? '' : ', so share leaves this clip out'}.`);
    if (changed) for (const problem of problems) log(`  share won't put this clip in a pull request: ${problem}`);
    if (showing) log(`  What the original shows as it ends: ${Object.entries(showing).map(([kind, value]) => `its ${kind} is ${typeof value === 'number' ? `${value}, which original.json gives no name` : value}`).join('; ')}.`);
    return { frames, matched: quick && firstDifference >= 0 ? hashes.length - 1 : matched, differs: differing, soundDiffers, onlyInOriginal, neverInPlay: neverSeen, ...(showing ? { shows: showing } : {}), ...(goalsHeld ? { reached: goalsHeld } : {}), unreached, changed: !!changed, functions: [...proven].sort((a, b) => a - b).map(i => hex(codeMap.functions[i].address)) };
    }
  }
}

// A thread of its own for each of the recordings played at once: `run` starts it with what a lane needs and the
// browser's port, and it plays the recording it's sent, each in a new page of that browser, and sends back what it
// found and said, or the error that stopped it. The first message says it's ready.
if (!isMainThread && workerData?.lane) {
  const lane = await laneFor(workerData.lane);
  let page = null;
  parentPort.on('message', async ({ at, name }) => {
    try {
      page = page ? await page.another() : await joinChrome(workerData.port);
      const lines = [];
      const result = await lane.play(name, page, { log: line => lines.push(line), say: () => {} });
      parentPort.postMessage({ at, result, lines });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  });
  parentPort.postMessage({});
}
