// npm run dp -- untouched <version> [--all]: what gameplay proven still leaves untouched in a version, from its
// proof/played.json (lib/played.mjs), so the next thing to port or to record comes from the original and not from
// anyone's memory (docs/STANDARD.md#how-progress-is-measured): the functions of the code map that never ran in a frame
// that matched, those that ran with branches gone only one way, each with the address of the branch and the way nobody
// has played, and the stretches of the cartridge's data never used. It prints the biggest of each; --all prints every
// one. `npm run dp -- untouched <version> --why <address> [--in <recording>]` says what the branch at an address went
// by in a recording that ran it: what the original compared, where each side came from in its memory, and what it
// held each time, so that what has to be different for the other way is known before anyone looks for it: a value the
// buttons change is found by playing or by `route`, and one they don't, such as the character or a setting, by a
// recording that starts differently. `npm run dp -- route <version> <name> --from <recording> --goal untouched` then finds presses that reach code
// not played yet, and `npm run dp -- read <game> <address>` prints the code at an address.

import { readCodeMap, readOriginal, cartridgeOf, hex } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { referenceOf } from './lib/reference.mjs';
import { NOT_TAKEN, TAKEN, ranIn, readPlayed, untouchedOf } from './lib/played.mjs';
import { originalPlay } from './lib/recording.mjs';
import { readRecordings } from './lib/proof-files.mjs';
import { LOCAL } from './lib/paths.mjs';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const count = n => n.toLocaleString('en');

export async function run(args) {
  const flagged = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? '' : null);
  const all = args.includes('--all'), [game] = args.filter((a, i) => !a.startsWith('--') && !['--why', '--in'].includes(args[i - 1]));
  if (!game || flagged('--why') === '' || flagged('--in') === '') throw new Error('Usage: npm run dp -- untouched <version> [--all]\n       npm run dp -- untouched <version> --why <address> [--in <recording>]');
  const original = readOriginal(game), codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${game.split('/')[0]}/proof/ has no code map yet: npm run dp -- codemap ${game.split('/')[0]} makes one.`);
  if ((await referenceOf(original)).seesInstructions !== true) throw new Error("The tools don't see this console's instructions run yet, so they can't say what's untouched.");
  if (!readPlayed(game).places) throw new Error(`games/${game}/proof/played.json isn't there yet: npm run dp -- prove ${game} writes it.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`It reads ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if (flagged('--why') !== null) return why(game, { original, codeMap, copy, address: flagged('--why'), asked: flagged('--in') });
  const { functions, content } = untouchedOf(game, codeMap, cartridgeOf(copy.path));
  const never = functions.filter(f => f.never), partly = functions.filter(f => !f.never);
  const most = list => (all ? list : list.slice(0, 20));
  const more = list => (!all && list.length > 20 ? [`  and ${count(list.length - 20)} more: --all prints them.`] : []);

  console.log(`Functions that never ran in a frame that matched: ${count(never.length)}, with ${count(never.reduce((sum, f) => sum + f.total, 0))} instructions and branch ways.`);
  never.sort((a, b) => b.total - a.total || a.address - b.address);
  for (const f of most(never)) console.log(`  ${f.key}, ${count(f.total)}`);
  for (const line of more(never)) console.log(line);

  console.log(`\nFunctions played in part: ${count(partly.length)}, with ${count(partly.reduce((sum, f) => sum + f.total - f.played, 0))} instructions and branch ways still to play.`);
  partly.sort((a, b) => (b.total - b.played) - (a.total - a.played) || a.address - b.address);
  for (const f of most(partly)) {
    const ways = f.ways.slice(0, all ? Infinity : 6).map(([at, way]) => `${hex(at)} ${way}`).join(', ');
    console.log(`  ${f.key}, ${count(f.total - f.played)} of ${count(f.total)} to play${f.ways.length ? `. Branches gone one way only, with the way to play: ${ways}${!all && f.ways.length > 6 ? `, and ${f.ways.length - 6} more` : ''}` : ''}`);
  }
  for (const line of more(partly)) console.log(line);

  console.log(`\nStretches of the cartridge's data never used: ${count(content.length)}, ${count(content.reduce((sum, [from, to]) => sum + to - from + 1, 0))} bytes.`);
  for (const [from, to] of most(content)) console.log(`  ${hex(from)} to ${hex(to)}, ${count(to - from + 1)} bytes`);
  for (const line of more(content)) console.log(line);
  return 0;
}

// what a value is, by the bytes read
const sized = bytes => (bytes === 1 ? 'byte' : bytes === 2 ? 'halfword' : 'word');
const times = n => (n === 1 ? 'once' : n ? `${n.toLocaleString('en')} times` : 'never');
const number = value => (value > 0xFFFF ? `0x${hex(value)}` : String(value));

/** One side of a comparison, as words: what it held and where it came from (gba/original.c, DP_WHY). */
export function sideText(value, address, kind) {
  const from = kind & 3, changed = kind & 4 ? ', changed on the way' : '';
  if (from === 1) return `${number(value)}, from the ${sized(kind >> 8 & 0xFF)} at ${hex(address)}${changed}`;
  if (from === 2) return `${number(value)}, a number in the code`;
  return `${number(value)}, worked out from more than one thing`;
}

/**
 * What the branch at `address` went by in a recording that ran it, `asked` or the first that did (gba/original.c,
 * DP_WHY): { name, ran, records }, each record { pc, a, b, fromA, kindA, fromB, kindB, went, times, frame }, the most
 * frequent first. `name` is null when no recording has run it.
 */
export async function whyOf(game, { original, codeMap, copy, address, asked = null, log = () => {} }) {
  const ran = ranIn(game, codeMap, address);
  const reference = await referenceOf(original);
  const name = asked ?? ran[0]?.name ?? null;
  if (!name) return { name, ran, records: [] };
  const [recording] = readRecordings(game, [name]);
  if (recording.players) throw new Error('What a branch went by is read from one console, and this recording links several.');
  const keysLate = original.keysAfterVBlank === true;
  const way = originalPlay(recording, { frames: recording.frames, keysLate });
  const masks = way.originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
  if (keysLate) masks.unshift(0);
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `why-${process.pid}.bin`);
  reference.ensureOriginal(log);
  let words;
  try {
    await reference.runOriginal({ copy: copy.path, frames: masks.length, buttons: masks, sets: way.sets, env: { DP_WHY: `${hex(address)} ${file}` } });
    words = new Uint32Array(new Uint8Array(readFileSync(file)).buffer);
  } finally {
    rmSync(file, { force: true });
  }
  const records = [];
  for (let i = 0; i + 12 <= words.length; i += 12) {
    const [pc, a, b, fromA, kindA, fromB, kindB, went, times, frame] = words.subarray(i, i + 12);
    records.push({ pc, a, b, fromA, kindA, fromB, kindB, went, times, frame });
  }
  records.sort((x, y) => y.times - x.times);
  return { name, ran, records };
}

/**
 * The values of the original's memory a branch tests, for a search to spread over (route.mjs): from what it went by
 * most often, each side that came from the work memory, as { address, bytes, held, against }, `against` being what
 * the other side held.
 */
export function testedValues(records) {
  const [most] = records;
  if (!most) return [];
  const side = (value, address, kind, against) => ((kind & 3) === 1 && [2, 3].includes(address >>> 24) ? [{ address, bytes: kind >> 8 & 0xFF, held: value, against }] : []);
  return [...side(most.a, most.fromA, most.kindA, most.b), ...side(most.b, most.fromB, most.kindB, most.a)];
}

// what the branch at an address went by, in a recording that ran it
async function why(game, { original, codeMap, copy, address: text, asked }) {
  if (!/^(?:0x)?[0-9A-Fa-f]{7,8}$/.test(text)) throw new Error('--why takes the address of a branch, such as 0802C48A, as npm run dp -- untouched lists them.');
  const address = parseInt(text, 16) & ~1;
  const { name, ran, records } = await whyOf(game, { original, codeMap, copy, address, asked, log: console.log });
  if (!name) throw new Error(`No recording of ${game} has run ${hex(address)} in a frame that matched, so there's nothing to say of it yet: --in <recording> names one of the game's that gets there anyway.`);
  const others = ran.filter(each => each.name !== name).map(each => each.name);
  if (!records.length) {
    console.log(`${hex(address)} didn't run as a conditional branch in ${name}${others.length ? `. These ran it too: ${others.slice(0, 8).join(', ')}` : ''}.`);
    return 1;
  }
  const count = went => records.filter(r => r.went === went).reduce((sum, r) => sum + r.times, 0);
  console.log(`The branch at ${hex(address)} in ${name}: taken ${times(count(TAKEN))}, not taken ${times(count(NOT_TAKEN))}. It went by what the instruction before it left, each time one of these:`);
  for (const r of records.slice(0, 12)) {
    console.log(`  ${r.went === TAKEN ? 'Taken' : 'Not taken'} ${times(r.times)}, first in frame ${r.frame}: at ${hex(r.pc)}, ${sideText(r.a, r.fromA, r.kindA)}, against ${sideText(r.b, r.fromB, r.kindB)}.`);
  }
  if (records.length > 12) console.log(`  and ${records.length - 12} more sets of values.`);
  if (others.length) console.log(`These recordings ran it too: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ` and ${others.length - 12} more` : ''}. --in <recording> asks one of them.`);
  console.log(`npm run dp -- read ${game.split('/')[0]} ${hex(address)} prints the code around it, and npm run dp -- route ${game.split('/')[0]} <recording> --at <frame> --memory <from>-<to> what the memory there holds.`);
  return 0;
}
