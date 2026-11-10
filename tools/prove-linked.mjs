// The proof of a recording with `players` (lib/recording.mjs): two to four GBAs on one link, each with its own buttons,
// from power-on, in the original (in the reference emulator, tools/gba/linked.mjs) and in the Dreamport (in a headless
// browser, the page's own GBAs on its own link). Every player's picture is compared at every frame. Nothing is traced,
// so these recordings prove the gameplay they show and add no functions to the code ported.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, resultFolder } from './lib/paths.mjs';
import { expand } from './lib/recording.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { runLinked } from './gba/linked.mjs';
import { png, fromColours } from './lib/png.mjs';
import { mp4 } from './lib/mp4.mjs';
import { CLIP_FRAMES, recordingHash, firstChanged, newFramesIn, clipProblems, changedText } from './lib/clips.mjs';

const BATCH = 60;
const CLIP_LIMIT = 2_000_000, CLIP_TARGET = 1_700_000, CLIP_RATE = 2_000_000;
const FRAME = [280896, 16777216];   // a Game Boy Advance frame, in ticks of its clock
const IN_PAGE = readFileSync(new URL('./lib/in-page-linked.js', import.meta.url), 'utf8');
const KEYS = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };

/** Every player's held lists, the first's from `held`, the others' from `others`. */
export const heldOf = recording => [recording.held, ...(recording.others ?? [])];

/** Plays a recording with players. Resolves like prove's: { frames, matched, differs, functions, ... }. */
export async function proveLinked({ page, game, recording, copy, server, main = null, quick, asked = [], log = console.log, say = () => {} }) {
  const { name, frames, players } = recording;
  const out = resultFolder(game, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const lists = heldOf(recording).map(list => expand(list, frames));
  const bits = lists.map(frames => frames.map(list => list.reduce((mask, b) => mask | (KEYS[b] ?? 0), 0)));
  const unknown = [...new Set(lists.flat(2))].filter(b => !(b in KEYS));
  if (unknown.length) throw new Error(`${name}: holds ${unknown.join(', ')}, which the Game Boy Advance doesn't have.`);

  say('playing the original…');
  // the page's frame f is the original's frame f + 1: what a frame shows is what the one before worked out (prove.mjs)
  const keepAt = [...new Set(asked)].filter(f => f >= 0 && f < frames);
  // the clip: the recording's, or the last five seconds, with the Dreamport's screens above and the original's below
  const clipAt = quick ? [] : Array.from({ length: Math.min(frames, recording.clip?.frames ?? CLIP_FRAMES) }, (_, i) => (recording.clip?.at ?? Math.max(0, frames - CLIP_FRAMES)) + i).filter(f => f < frames);
  const first = await runLinked({ copy, players, frames: frames + 1, buttons: bits, pictures: [...new Set([...keepAt, ...clipAt])].map(f => f + 1) });
  const expected = Array.from({ length: frames }, (_, f) => Array.from({ length: players }, (_, p) => first.hashes[(f + 1) * players + p]));

  say('starting the Dreamport…');
  await openDreamport(page, server, game, copy, { query: `?proof&${recording.start ?? `vs=${players}`}` });
  await page.evaluate(IN_PAGE);
  // the recording's buttons as the Dreamport names them: the first of its buttons that is each of the console's (prove.mjs)
  const named = new Map();
  for (const b of await page.evaluate('dreamportsProof.buttons')) {
    const own = b.console ?? b.gba;
    if (own && !named.has(own)) named.set(own, b.name);
  }
  const missing = Object.keys(KEYS).filter(k => lists.flat(2).includes(k) && !named.has(k));
  if (missing.length) throw new Error(`${name}: holds ${missing.join(', ')}, which the Dreamport has no button for.`);
  const buttonsOf = list => list.map(b => named.get(b));
  const hashes = [], differ = [];
  let firstDifference = -1;
  for (let from = 0; from < frames && !(quick && firstDifference >= 0 && from > Math.max(-1, ...keepAt)); from += BATCH) {
    const count = Math.min(BATCH, frames - from);
    say(`frame ${from + count} of ${frames}`);
    const batch = Array.from({ length: count }, (_, i) => ({ players: lists.map(list => ({ held: buttonsOf(list[from + i]), ...(from + i + 1 < frames ? { next: buttonsOf(list[from + i + 1]) } : {}) })) }));
    const wanted = keepAt.filter(f => f >= from && f < from + count);
    const played = await page.evaluate(`__linked.run(${from}, ${JSON.stringify(batch)}, ${JSON.stringify(expected.slice(from, from + count))}, ${JSON.stringify(wanted)}, ${JSON.stringify(clipAt.filter(f => f >= from && f < from + count))})`);
    for (let i = 0; i < played.length; i++) {
      const f = from + i;
      hashes.push(played[i]);
      const which = played[i].map((h, p) => (h !== expected[f][p] ? p : -1)).filter(p => p >= 0);
      if (which.length) {
        differ.push(f);
        if (firstDifference < 0) firstDifference = f;
      }
    }
  }

  // the first frame that differs, every player's picture of the Dreamport and the original's, side by side
  const kept = await page.evaluate('__linked.first');
  const shown = await page.evaluate('__linked.shown');
  const sheet = (ours, theirs, label) => {
    const W = 240, H = 160, rows = theirs ? 2 : 1, pixels = new Uint8Array(W * players * H * rows * 4);
    const put = (colours, row, p) => {
      const rgba = fromColours(colours);
      for (let y = 0; y < H; y++) pixels.set(rgba.subarray(y * W * 4, (y + 1) * W * 4), (((row * H + y) * players + p) * W) * 4);
    };
    ours.forEach((colours, p) => put(colours, 0, p));
    theirs?.forEach((colours, p) => colours && put(colours, 1, p));
    writeFileSync(join(out, label), png(W * players, H * rows, pixels));
  };
  if (kept) {
    sheet(kept.pictures, first.pictures.has(`${kept.frame + 1}:0`) ? Array.from({ length: players }, (_, p) => first.pictures.get(`${kept.frame + 1}:${p}`)) : null, `first-difference-${kept.frame}.png`);
  }
  for (const [frame, pictures] of Object.entries(shown)) {
    if (!keepAt.includes(+frame)) continue;
    sheet(pictures, Array.from({ length: players }, (_, p) => first.pictures.get(`${+frame + 1}:${p}`)), `frame-${frame}.png`);
  }
  // the original's alone, at the first difference, when it wasn't asked for
  if (kept && !first.pictures.has(`${kept.frame + 1}:0`)) {
    const again = await runLinked({ copy, players, frames: kept.frame + 2, buttons: bits.map(b => b.slice(0, kept.frame + 1)), pictures: [kept.frame + 1] });
    sheet(kept.pictures, Array.from({ length: players }, (_, p) => again.pictures.get(`${kept.frame + 1}:${p}`)), `first-difference-${kept.frame}.png`);
  }

  const stretches = [];
  for (const f of differ) {
    const last = stretches.at(-1);
    if (last && last[1] === f - 1) last[1] = f;
    else stretches.push([f, f]);
  }
  let clipFile = null, apart = 0, problems = [], changed = null;
  if (clipAt.length && hashes.length >= frames) {
    say('making the clip…');
    const all = new Uint16Array(clipAt.length * players * 240 * 160);
    clipAt.forEach((f, i) => { for (let p = 0; p < players; p++) all.set(first.pictures.get(`${f + 1}:${p}`), (i * players + p) * 240 * 160); });
    server.serve('/proof/originals', Buffer.from(all.buffer));
    const length = clipAt.length * FRAME[0] / FRAME[1];
    let bitrate = Math.round(Math.min(CLIP_RATE, CLIP_TARGET * 8 / length));
    for (let tries = 0; tries < 5; tries++) {
      const video = await page.evaluate(`__linked.video(${JSON.stringify(clipAt)}, '/proof/originals', ${bitrate})`);
      clipFile = mp4({ width: video.width, height: video.height, description: Buffer.from(video.description, 'base64'), frames: video.frames.map(f => ({ key: f.key, data: Buffer.from(f.data, 'base64') })), timescale: FRAME[1], duration: FRAME[0] });
      apart = video.apart;
      if (clipFile.length <= CLIP_LIMIT) break;
      bitrate = Math.round(bitrate * CLIP_TARGET / clipFile.length);
    }
    server.serve('/proof/originals', null);
    writeFileSync(join(out, 'clip.mp4'), clipFile);
    // what share checks before a pull request shows the clip (lib/clips.mjs): what this step changed, from main's
    // proof, as nothing here says which code ran, and how many pictures are one colour or the same as the one before,
    // from the original's, as the Dreamport's are the same where it matters, which `apart` measures
    const text = readFileSync(recording.file, 'utf8'), recordingFile = relative(REPO, recording.file).replaceAll('\\', '/');
    changed = firstChanged({ main, name, file: recordingFile, text, frames, differs: stretches });
    const pictures = clipAt.map(f => Array.from({ length: players }, (_, p) => first.pictures.get(`${f + 1}:${p}`)));
    const oneColour = pictures.filter(([own]) => own.every(c => c === own[0])).length;
    const same = pictures.filter((now, i) => i > 0 && clipAt[i - 1] === clipAt[i] - 1 && now.every((own, p) => own.every((c, at) => c === pictures[i - 1][p][at]))).length;
    // the clip's frames that differ from the original's, which share won't let a pull request show
    const differing = new Set(differ);
    const clip = { from: clipAt[0], to: clipAt.at(-1), frames: clipAt.length, seconds: Math.round(length * 100) / 100, apart, differing: clipAt.filter(f => differing.has(f)).length, oneColour, same, changed, newFrames: newFramesIn(clipAt, changed), base: main?.base ?? null, bytes: clipFile.length };
    const report = { recording: name, recordingFile, recordingSha1: recordingHash(text), frames, players, clip };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    problems = clipProblems(report, text);
  }
  writeFileSync(join(out, 'hashes.json'), JSON.stringify({ ours: hashes, original: expected.slice(0, hashes.length) }));
  const matched = hashes.length - differ.length;
  const per = Array.from({ length: players }, (_, p) => hashes.filter((h, f) => h[p] !== expected[f][p]).length);
  log(`\n${name}: ${players} players, ${matched} of ${hashes.length} frames played match${firstDifference >= 0 ? `; the first that differs is ${firstDifference}, and each player differs in ${per.join(', ')} frames` : ''}. Pictures: ${out}`);
  if (clipFile) log(`  Clip, ${(clipFile.length / 1e6).toFixed(2)} MB, frames ${clipAt[0]} to ${clipAt.at(-1)}: ${out}/clip.mp4 (the Dreamport's screens above, the original's below)`);
  if (clipFile) log(`  What this step changed: ${changedText(changed)}${changed ? '' : ', so share leaves this clip out'}.`);
  if (changed) for (const problem of problems) log(`  share won't put this clip in a pull request: ${problem}`);
  say('');
  return { frames, matched: quick ? matched : matched, differs: stretches, soundDiffers: [], neverInPlay: [], functions: [] };
}
