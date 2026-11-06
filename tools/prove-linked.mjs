// The proof of a recording with `players` (lib/recording.mjs): two to four GBAs on one link, each with its own buttons,
// from power-on, in the original (in the reference emulator, tools/gba/linked.mjs) and in the Dreamport (in a headless
// browser, the page's own GBAs on its own link). Every player's picture is compared at every frame. Nothing is traced,
// so these recordings prove the gameplay they show and add no functions to the code ported.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resultFolder } from './lib/paths.mjs';
import { expand } from './lib/recording.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { runLinked } from './gba/linked.mjs';
import { png, fromColours } from './lib/png.mjs';

const BATCH = 60;
const IN_PAGE = readFileSync(new URL('./lib/in-page-linked.js', import.meta.url), 'utf8');
const KEYS = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const NAMES = { jump: 'A', attack: 'B', start: 'START', select: 'SELECT', right: 'RIGHT', left: 'LEFT', up: 'UP', down: 'DOWN', r: 'R', l: 'L' };

/** Every player's held lists, the first's from `held`, the others' from `others`. */
export const heldOf = recording => [recording.held, ...(recording.others ?? [])];

/** Plays a recording with players. Resolves like prove's: { frames, matched, differs, functions, ... }. */
export async function proveLinked({ page, game, recording, copy, server, quick, asked = [] }) {
  const { name, frames, players } = recording;
  const out = resultFolder(game, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const say = text => process.stdout.isTTY && process.stdout.write(`\r${`${name}: ${text}`.padEnd(70)}`);
  const lists = heldOf(recording).map(list => expand(list, frames));
  const bits = lists.map(frames => frames.map(list => list.reduce((mask, b) => mask | (KEYS[b] ?? 0), 0)));
  const unknown = [...new Set(lists.flat(2))].filter(b => !(b in KEYS));
  if (unknown.length) throw new Error(`${name}: holds ${unknown.join(', ')}, which the Game Boy Advance doesn't have.`);

  say('playing the original…');
  // the page's frame f is the original's frame f + 1: what a frame shows is what the one before worked out (prove.mjs)
  const keepAt = [...new Set(asked)].filter(f => f >= 0 && f < frames);
  const first = await runLinked({ copy, players, frames: frames + 1, buttons: bits, pictures: keepAt.map(f => f + 1) });
  const expected = Array.from({ length: frames }, (_, f) => Array.from({ length: players }, (_, p) => first.hashes[(f + 1) * players + p]));

  say('starting the Dreamport…');
  await openDreamport(page, server, game, copy, { query: `?proof&${recording.start ?? `vs=${players}`}` });
  await page.evaluate(IN_PAGE);
  const buttonsOf = list => list.map(b => NAMES_BY_KEY[b]);
  const hashes = [], differ = [];
  let firstDifference = -1;
  for (let from = 0; from < frames && !(quick && firstDifference >= 0 && from > Math.max(-1, ...keepAt)); from += BATCH) {
    const count = Math.min(BATCH, frames - from);
    say(`frame ${from + count} of ${frames}`);
    const batch = Array.from({ length: count }, (_, i) => ({ players: lists.map(list => ({ held: buttonsOf(list[from + i]), ...(from + i + 1 < frames ? { next: buttonsOf(list[from + i + 1]) } : {}) })) }));
    const wanted = keepAt.filter(f => f >= from && f < from + count);
    const played = await page.evaluate(`__linked.run(${from}, ${JSON.stringify(batch)}, ${JSON.stringify(expected.slice(from, from + count))}, ${JSON.stringify(wanted)})`);
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
    sheet(pictures, Array.from({ length: players }, (_, p) => first.pictures.get(`${+frame + 1}:${p}`)), `frame-${frame}.png`);
  }
  // the original's alone, at the first difference, when it wasn't asked for
  if (kept && !first.pictures.has(`${kept.frame + 1}:0`)) {
    const again = await runLinked({ copy, players, frames: kept.frame + 2, buttons: bits.map(b => b.slice(0, kept.frame + 1)), pictures: [kept.frame + 1] });
    sheet(kept.pictures, Array.from({ length: players }, (_, p) => again.pictures.get(`${kept.frame + 1}:${p}`)), `first-difference-${kept.frame}.png`);
  }

  writeFileSync(join(out, 'hashes.json'), JSON.stringify({ ours: hashes, original: expected.slice(0, hashes.length) }));
  const matched = hashes.length - differ.length;
  const stretches = [];
  for (const f of differ) {
    const last = stretches.at(-1);
    if (last && last[1] === f - 1) last[1] = f;
    else stretches.push([f, f]);
  }
  const per = Array.from({ length: players }, (_, p) => hashes.filter((h, f) => h[p] !== expected[f][p]).length);
  console.log(`\n${name}: ${players} players, ${matched} of ${hashes.length} frames played match${firstDifference >= 0 ? `; the first that differs is ${firstDifference}, and each player differs in ${per.join(', ')} frames` : ''}. Pictures: ${out}`);
  return { frames, matched: quick ? matched : matched, differs: stretches, soundDiffers: [], neverInPlay: [], functions: [] };
}

const NAMES_BY_KEY = Object.fromEntries(Object.entries(NAMES).map(([game, key]) => [key, game]));
