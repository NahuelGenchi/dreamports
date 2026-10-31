// npm run dp -- prove <game> [recording…]: plays each recording, from power-on, in the original (in the reference
// emulator) and in the Dreamport (in a headless browser), compares every frame, notes which of the original's
// functions ran in the frames that matched, updates the game's progress.json, which its code ported and its gameplay
// proven are measured with (docs/STANDARD.md#how-progress-is-measured), and the README's table of Dreamports with it
// (readme.mjs), and makes a clip and stills of both side by side, with a clip and a still of the
// Dreamport on its own. To help find where each of the game's parts starts and ends, it lists the frames where the
// original's screen is one colour, as between one screen and the next, and with --stills <frames> keeps pictures of
// those frames, as it does of each part's first and last. The pictures and the clips stay in .dreamports/results/
// on this computer: they show the game, so they never go in a commit.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, LOCAL, resultFolder } from './lib/paths.mjs';
import { readOriginal, readRecordings, readCodeMap, readProgress, writeProgress, readParts, hex } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { expand } from './lib/recording.mjs';
import { serveRepository } from './lib/server.mjs';
import { openChrome } from './lib/chrome.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { mp4 } from './lib/mp4.mjs';
import { measure, percentText } from '../src/lib/entries.mjs';
import { writeReadme, readProof } from './readme.mjs';
import { KEY, ensureOriginal, runOriginal } from './gba/original.mjs';

const BATCH = 120;
const STILLS = 600;
// a clip stays under 2 MB: encoded again at a lower rate while it's over, as the encoder can overshoot its target
const CLIP_LIMIT = 2_000_000, CLIP_TARGET = 1_700_000;
const IN_PAGE = readFileSync(new URL('./lib/in-page.js', import.meta.url), 'utf8');

export async function run(args) {
  const stillsAt = args.indexOf('--stills');
  const asked = stillsAt >= 0 ? framesIn(args[stillsAt + 1]) : [];
  const [game, ...names] = args.filter((a, i) => !a.startsWith('--') && (stillsAt < 0 || i !== stillsAt + 1));
  if (!game) throw new Error('Usage: npm run dp -- prove <game> [recording…] [--stills <frames>]');
  const original = readOriginal(game);
  if (original.console !== 'gba') throw new Error(`The proof tools run Game Boy Advance games; ${original.console} isn't one yet.`);
  const recordings = readRecordings(game, names);
  if (!recordings.length) throw new Error(`games/${game}/proof/recordings/ has no recordings yet: make one with npm run dp -- play ${game} --record <name>.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The proof uses ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const codeMap = readCodeMap(game);
  if (codeMap && codeMap.original !== original.sha1) throw new Error(`games/${game}/proof/code-map.json is for another copy than original.json names.`);
  ensureOriginal(console.log);

  const progress = readProgress(game), parts = readParts(game);
  const server = await serveRepository();
  let failed = false;
  try {
    for (const recording of recordings) {
      const own = parts.filter(p => p.recording === recording.name && Array.isArray(p.frames) && p.frames.length === 2 && p.frames.every(Number.isInteger));
      const result = await prove({ game, recording, copy: copy.path, server, codeMap, before: progress.recordings[recording.name], asked, parts: own, keysLate: original.keysAfterVBlank === true });
      failed ||= result.matched < result.frames;
      progress.recordings[recording.name] = {
        frames: result.frames,
        matched: result.matched,
        differs: result.differs,
        ...(result.onlyInOriginal ? { onlyInOriginal: result.onlyInOriginal } : {}),
        functions: result.functions,
      };
    }
  } finally {
    await server.close();
  }

  // the code that ran in matching play, from every recording there is, the ones not played now as they were last proven
  const all = new Set(readRecordings(game).map(r => r.name));
  for (const name of Object.keys(progress.recordings)) if (!all.has(name)) delete progress.recordings[name];
  const totals = { original: original.sha1 };
  if (codeMap) {
    const proven = new Set(Object.values(progress.recordings).flatMap(r => r.functions));
    Object.assign(totals, measure(codeMap.functions.map(f => ({ address: hex(f.address), size: f.size })), proven));
    console.log(`\n${totals.percent}% of ${original.name}'s code ran in frames where both played the same: ${totals.proven.functions} of ${totals.codeMap.functions} functions, ${totals.proven.bytes.toLocaleString('en')} of ${totals.codeMap.bytes.toLocaleString('en')} bytes. Code ported counts them all.`);
  } else {
    console.log(`\nNo code map yet, so no code ported: npm run dp -- codemap ${game} makes one.`);
  }
  writeProgress(game, { ...totals, recordings: progress.recordings });
  console.log(`Written: games/${game}/proof/progress.json`);
  // the README's table of Dreamports shows the new numbers
  try {
    if (writeReadme().changed) console.log('Written: README.md\'s table of Dreamports and the progress maps, with the new numbers.');
  } catch (error) {
    console.log(`README.md's table of Dreamports wasn't written: ${error.message}`);
  }
  // the two numbers the game shows now
  try {
    const { ported, gameplay } = readProof(game) ?? {};
    if (ported) console.log(`Code ported: ${percentText(ported.percent)}.`);
    if (gameplay) console.log(`Gameplay proven: ${percentText(gameplay.percent)}, ${gameplay.proven} of ${gameplay.total} parts.`);
  } catch (error) {
    console.log(error.message);
  }
  return failed ? 1 : 0;
}

// the frames --stills names: numbers and stretches, such as 249,250 or 900-905
function framesIn(text) {
  const frames = new Set();
  for (const part of (text ?? '').split(',')) {
    const [, a, b = a] = /^(\d+)(?:-(\d+))?$/.exec(part.trim()) ?? [];
    if (a === undefined || +b < +a) throw new Error('--stills takes the frames to keep pictures of, such as 249,250 or 900-905.');
    for (let f = +a; f <= +b && frames.size <= STILLS; f++) frames.add(f);
  }
  if (frames.size > STILLS) throw new Error(`--stills keeps up to ${STILLS} pictures at a time.`);
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

async function prove({ game, recording, copy, server, codeMap, before, asked, parts, keysLate }) {
  const { name, frames } = recording;
  const out = resultFolder(game, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // what it's doing, on one line that changes in a terminal
  const say = text => (process.stdout.isTTY ? process.stdout.write(`\r${`${name}: ${text}`.padEnd(70)}`) : text.startsWith('frame') || console.log(`${name}: ${text}`));

  // which of the original's frames is each of the Dreamport's: the same, but for the frames only the original has
  const held = expand(recording.held, frames);
  const originalOf = new Int32Array(frames), originalHeld = [];
  let gap = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (; gap < recording.onlyInOriginal.length && recording.onlyInOriginal[gap].at === frame; gap++) {
      const { frames: count, held: own } = recording.onlyInOriginal[gap];
      originalHeld.push(...expand(own, count));
    }
    originalOf[frame] = originalHeld.length;
    originalHeld.push(held[frame]);
  }
  for (; gap < recording.onlyInOriginal.length; gap++) originalHeld.push(...expand(recording.onlyInOriginal[gap].held, recording.onlyInOriginal[gap].frames));
  const onlyInOriginal = originalHeld.length - frames;

  const page = await openChrome({ profile: join(LOCAL, 'chrome', 'prove'), headless: true });
  try {
    say('starting the Dreamport…');
    await openDreamport(page, server, game, copy, { query: '?proof' });
    await page.evaluate(IN_PAGE);
    const buttons = await page.evaluate('dreamportsProof.buttons');
    // the recording's buttons as the Dreamport names them, and as the console's buttons for the original
    const named = new Map();
    for (const b of buttons) {
      if (b.gba && !named.has(b.gba)) named.set(b.gba, b.name);
      if (!b.gba) named.set(b.name, b.name);
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
    // buttons, and the Dreamport's frame f is the original's frame originalOf[f] + 1
    say('playing the original…');
    const functions = codeMap?.functions ?? [];
    const first = await runOriginal({ copy, frames: originalHeld.length + 1, buttons: masks, functions });
    const expected = Array.from(originalOf, g => first.hashes[g + 1]);

    // the Dreamport, a batch of frames at a time, keeping the pictures the results show: the clip's, and the
    // first frame that differs, with the first that differs where it matched when last proven
    const wasDifferent = before?.frames === frames ? inStretches(before.differs) : null;
    const wanted = new Set();
    const clipAt = recording.clip ? [recording.clip.at, recording.clip.at + recording.clip.frames - 1] : null;
    if (clipAt) for (let f = clipAt[0]; f <= clipAt[1]; f++) wanted.add(f);
    // the stills asked for, and each part's first and last frames with the one before and the one after
    const boundaries = parts.flatMap(({ frames: [a, b] }) => [a - 1, a, b, b + 1]);
    const stills = [...new Set([...asked, ...boundaries])].filter(f => f >= 0 && f < frames).sort((a, b) => a - b);
    for (const f of stills) wanted.add(f);
    const hashes = [], keptFrames = new Set();
    let firstDifference = -1, firstNew = -1;
    const started = Date.now();
    for (let from = 0; from < frames; from += BATCH) {
      const count = Math.min(BATCH, frames - from);
      say(`frame ${from + count} of ${frames}`);
      const batch = held.slice(from, from + count).map(list => list.map(b => named.get(b)));
      hashes.push(...await page.evaluate(`__proof.run(${from}, ${JSON.stringify(batch)})`));
      for (let f = from; f < from + count; f++) {
        if (hashes[f] === expected[f]) continue;
        if (firstDifference < 0) {
          firstDifference = f;
          wanted.add(f);
          // without a clip in the recording, the clip shows the four seconds before it and one after
          if (!clipAt) for (let g = Math.max(0, f - 240); g < Math.min(frames, f + 60); g++) wanted.add(g);
        }
        if (firstNew < 0 && wasDifferent && !wasDifferent.has(f)) {
          firstNew = f;
          wanted.add(f);
        }
      }
      const keep = [...wanted].filter(f => f < from + count && !keptFrames.has(f));
      for (const f of await page.evaluate(`__proof.keep(${JSON.stringify(keep)})`)) keptFrames.add(f);
    }
    const seconds = (Date.now() - started) / 1000;

    // what matched, and the functions that ran in those frames
    let matched = 0;
    const proven = new Set(), different = [];
    for (let frame = 0; frame < frames; frame++) {
      if (hashes[frame] !== expected[frame]) {
        different.push(frame);
        continue;
      }
      matched++;
      for (const f of first.ran[originalOf[frame]]) proven.add(f);
    }
    const differs = stretchesOf(different);
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
      const differing = different.find(f => f >= a && f <= b);
      const gap = recording.onlyInOriginal.find(g => g.at > a && g.at <= b);
      return {
        name: part, frames: [a, b], proven: b < frames && differing === undefined && !gap,
        ...(b >= frames ? { past: frames - 1 } : {}), ...(differing !== undefined ? { differs: differing } : {}), ...(gap ? { gap: gap.at } : {}),
      };
    });
    const newly = wasDifferent ? stretchesOf(different.filter(f => !wasDifferent.has(f))) : [];
    const fixed = wasDifferent ? stretchesOf([...wasDifferent].filter(f => f < frames && hashes[f] === expected[f]).sort((a, b) => a - b)) : [];

    // the clip: the recording's, or around the first difference, or else the last five seconds
    const clip = clipAt ?? (firstDifference >= 0 ? [Math.max(0, firstDifference - 240), Math.min(frames - 1, firstDifference + 59)] : [Math.max(0, frames - 300), frames - 1]);
    if (!clipAt && firstDifference < 0) {
      const last = [];
      for (let f = clip[0]; f <= clip[1]; f++) last.push(f);
      for (const f of await page.evaluate(`__proof.keep(${JSON.stringify(last)})`)) keptFrames.add(f);
    }
    const clipFrames = [];
    for (let f = clip[0]; f <= clip[1]; f++) clipFrames.push(f);

    // the original's pictures of those frames, then the stills and the clip
    say('making the pictures and the clip…');
    const kept = [...keptFrames].sort((a, b) => a - b);
    const shown = await runOriginal({ copy, frames: originalHeld.length + 1, buttons: masks, pictures: kept.map(f => originalOf[f] + 1) });
    for (let i = 0; i < kept.length; i += 20) {
      const sends = kept.slice(i, i + 20).map(f => `__proof.original(${f}, '${Buffer.from(shown.pictures.get(originalOf[f] + 1).buffer).toString('base64')}')`);
      await page.evaluate(sends.join(';'));
    }
    const still = async (frame, file, difference) => {
      const s = await page.evaluate(`__proof.still(${frame}, ${difference})`);
      writeFileSync(join(out, file), Buffer.from(s.png, 'base64'));
      return { frame, pixels: s.pixels, box: s.box };
    };
    const difference = firstDifference >= 0 ? await still(firstDifference, 'first-difference.png', true) : null;
    const newDifference = firstNew >= 0 ? await still(firstNew, 'first-new-difference.png', true) : null;
    if (stills.length) mkdirSync(join(out, 'stills'));
    for (const f of stills) await still(f, join('stills', `frame-${f}.png`), hashes[f] !== expected[f]);
    await still(clip[0], 'clip-start.png', false);
    await still(clipFrames[clipFrames.length >> 1], 'clip-middle.png', false);
    await still(clip[1], 'clip-end.png', false);
    const length = clipFrames.length * 280896 / 16777216;
    const encode = async alone => {
      let bitrate = Math.round(Math.min(1_800_000, CLIP_TARGET * 8 / length) / (alone ? 2 : 1)), file;
      for (let tries = 0; tries < 4; tries++) {
        const video = await page.evaluate(`__proof.video(${JSON.stringify(clipFrames)}, { bitrate: ${bitrate}, alone: ${alone} })`);
        file = mp4({
          width: video.width, height: video.height, description: Buffer.from(video.description, 'base64'),
          frames: video.frames.map(f => ({ key: f.key, data: Buffer.from(f.data, 'base64') })),
          timescale: 16777216, duration: 280896,
        });
        if (file.length <= CLIP_LIMIT) break;
        bitrate = Math.round(bitrate * CLIP_TARGET / file.length);
      }
      return { file, bitrate };
    };
    const { file, bitrate } = await encode(false);
    writeFileSync(join(out, 'clip.mp4'), file);
    // the Dreamport on its own, with nothing of the original: the clip share can post (tools/share.mjs)
    const own = await encode(true);
    writeFileSync(join(out, 'dreamport.mp4'), own.file);
    writeFileSync(join(out, 'dreamport.png'), Buffer.from((await page.evaluate(`__proof.still(${clipFrames[clipFrames.length >> 1]}, false, true)`)).png, 'base64'));

    const outside = first.outside;
    const report = {
      recording: name, frames, matched, differs, firstDifference: difference, onlyInOriginal, oneColour, parts: partsFound, stills,
      ...(wasDifferent ? { sinceLastProven: { differs: newly, firstDifference: newDifference, matches: fixed } } : {}),
      clip: { from: clip[0], to: clip[1], frames: clipFrames.length, bytes: file.length, bitrate, dreamport: { bytes: own.file.length, bitrate: own.bitrate } },
      seconds, errors: page.errors,
      ...(codeMap ? { functions: proven.size, outsideCodeMap: outside } : {}),
    };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

    if (process.stdout.isTTY) process.stdout.write(`\r${''.padEnd(70)}\r`);
    const where = relative(REPO, out);
    const at = d => `frame ${d.frame}: ${d.pixels} pixels${d.box ? `, from ${d.box[0]},${d.box[1]} to ${d.box[2]},${d.box[3]}` : ''}`;
    if (firstDifference < 0) console.log(`${name}: all ${frames} frames the same in both${onlyInOriginal ? ` (and ${onlyInOriginal} only the original has)` : ''}.`);
    else {
      console.log(`${name}: ${matched} of ${frames} frames the same. The first that differs is ${at(difference)}.`);
      console.log(`  Frames that differ: ${listed(differs)}.`);
    }
    if (newly.length) console.log(`  Differs where it matched when last proven: ${listed(newly)}. The first is ${at(newDifference)}.`);
    if (oneColour.length) {
      const shown = oneColour.slice(0, 12).map(({ from, to, colour }) => `${from === to ? from : `${from} to ${to}`} (${colour})`).join(', ');
      console.log(`  The original's screen is one colour, as between screens, at frames ${shown}${oneColour.length > 12 ? `, and ${oneColour.length - 12} more in report.json` : ''}.`);
    }
    for (const part of partsFound) {
      const state = part.past !== undefined ? `ends past the recording's last frame, ${part.past}`
        : part.differs !== undefined ? `not proven, as frame ${part.differs} differs`
          : part.gap !== undefined ? `not proven, as the original has frames of its own before frame ${part.gap}`
            : 'proven, every frame the same';
      console.log(`  ${part.name}, frames ${part.frames[0]} to ${part.frames[1]}: ${state}.`);
    }
    const outOfReach = asked.filter(f => f >= frames);
    if (outOfReach.length) console.log(`  --stills names frames past the recording's last, ${frames - 1}: ${outOfReach.slice(0, 8).join(', ')}${outOfReach.length > 8 ? '…' : ''}.`);
    if (stills.length) console.log(`  Stills of ${asked.length ? 'the frames asked for' : ''}${asked.length && parts.length ? ', and of ' : ''}${parts.length ? 'each part\'s first and last frames, with the one before and the one after' : ''}: ${where}/stills/`);
    if (fixed.length) console.log(`  Matches where it differed when last proven: ${listed(fixed)}.`);
    if (page.errors.length) console.log(`  The page reported ${page.errors.length} errors; ${where}/report.json lists them.`);
    if (codeMap && (outside.cartridge || outside.memory)) {
      console.log(`  Instructions that ran outside every function of the code map: ${outside.cartridge} in the cartridge, ${outside.memory} copied into the console's memory.`);
    }
    console.log(`  Clip, ${(file.length / 1e6).toFixed(2)} MB, frames ${clip[0]} to ${clip[1]}, the Dreamport's on its own, ${(own.file.length / 1e6).toFixed(2)} MB, and stills: ${where}/`);
    if (file.length > CLIP_LIMIT) console.log('  The clip is still over 2 MB: a shorter "clip" in the recording makes it lighter.');
    return { frames, matched, differs, onlyInOriginal, functions: [...proven].sort((a, b) => a - b).map(i => hex(codeMap.functions[i].address)) };
  } finally {
    await page.close();
  }
}
