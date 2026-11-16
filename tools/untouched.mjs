// npm run dp -- untouched <version> [--all]: what gameplay proven still leaves untouched in a version, from its
// proof/played.json (lib/played.mjs), so the next thing to port or to record comes from the original and not from
// anyone's memory (docs/STANDARD.md#how-progress-is-measured): the functions of the code map that never ran in a frame
// that matched, those that ran with branches gone only one way, each with the address of the branch and the way nobody
// has played, and the stretches of the cartridge's data never used. It prints the biggest of each; --all prints every
// one. `npm run dp -- untouched <version> --sort` sorts every branch gone one way only by what it tests, each recording
// played once for all the branches it ran: those that compared something that changed while they ran, something that differs
// from one recording to another, something that was the same everywhere, and numbers the code set on the way there, with the
// values most branches wait on. `npm run dp -- untouched <version> --decided` lists the branches the code itself
// decides, worked out from the cartridge alone (lib/decided.mjs), one way of which can't happen, and with --write
// puts them in the game's unreachable.json, for a person to read before they go in. `npm run dp -- untouched <version> --why <address> [--in <recording>]` says what the branch at an address went
// by in a recording that ran it: what the original compared, where each side came from in its memory, and what it
// held each time, so that what has to be different for the other way is known before anyone looks for it: a value the
// buttons change is found by playing or by `route`, and one they don't, such as the character or a setting, by a
// recording that starts differently. `npm run dp -- route <version> <name> --from <recording> --goal untouched` then finds presses that reach code
// not played yet, and `npm run dp -- read <game> <address>` prints the code at an address.

import { readCodeMap, readOriginal, readRecordings, cartridgeOf, hex, proofVersions } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { referenceOf } from './lib/reference.mjs';
import { NOT_TAKEN, TAKEN, ranBy, ranIn, readPlayed, untouchedOf } from './lib/played.mjs';
import os from 'node:os';
import { decidedBranches } from './lib/decided.mjs';
import { versionOf } from '../src/lib/languages.mjs';
import { originalPlay } from './lib/recording.mjs';
import { LOCAL, sharedProofFolder } from './lib/paths.mjs';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const count = n => n.toLocaleString('en');

export async function run(args) {
  const flagged = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? '' : null);
  const all = args.includes('--all'), [game] = args.filter((a, i) => !a.startsWith('--') && !['--why', '--in', '--at-once'].includes(args[i - 1]));
  if (!game || flagged('--why') === '' || flagged('--in') === '') throw new Error('Usage: npm run dp -- untouched <version> [--all]\n       npm run dp -- untouched <version> --why <address> [--in <recording>]\n       npm run dp -- untouched <version> --sort [--all] [--at-once <how many>]\n       npm run dp -- untouched <version> --decided [--write]');
  const original = readOriginal(game), codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${game.split('/')[0]}/proof/ has no code map yet: npm run dp -- codemap ${game.split('/')[0]} makes one.`);
  if ((await referenceOf(original)).seesInstructions !== true) throw new Error("The tools don't see this console's instructions run yet, so they can't say what's untouched.");
  if (!readPlayed(game).places) throw new Error(`games/${game}/proof/played.json isn't there yet: npm run dp -- prove ${game} writes it.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`It reads ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if (args.includes('--decided')) return decided(game, { original, codeMap, copy, write: args.includes('--write') });
  if (args.includes('--sort')) return sort(game, { original, codeMap, copy, all, atOnce: Number(flagged('--at-once') ?? 0) });
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
  if (from === 3) return `${number(value)}, from the ${sized(kind >> 8 & 0xFF)} of the cartridge's data at ${hex(address)}${changed}`;
  return `${number(value)}, worked out from more than one thing`;
}

/**
 * What each of the branches at `addresses` went by in one play of the recording `name` (gba/original.c, DP_WHY): a Map
 * from each address that ran to its records, { pc, a, b, fromA, kindA, fromB, kindB, went, times, frame, more }, the
 * most frequent first. A record with `more` counts the times the branch went a way with values past those it keeps.
 */
export async function wentBy(game, { original, copy, name, addresses, log = () => {} }) {
  const reference = await referenceOf(original);
  const [recording] = readRecordings(game, [name]);
  if (recording.players) throw new Error('What a branch went by is read from one console, and this recording links several.');
  const keysLate = original.keysAfterVBlank === true;
  const way = originalPlay(recording, { frames: recording.frames, keysLate });
  const masks = way.originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
  if (keysLate) masks.unshift(0);
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `why-${process.pid}-${++plays}.bin`), list = join(folder, `why-${process.pid}-${plays}-branches.bin`);
  writeFileSync(list, new Uint8Array(Uint32Array.from(addresses).buffer));
  reference.ensureOriginal(log);
  let words;
  try {
    await reference.runOriginal({ copy: copy.path, frames: masks.length, buttons: masks, sets: way.sets, env: { DP_WHY: `${list} ${file}` } });
    words = new Uint32Array(new Uint8Array(readFileSync(file)).buffer);
  } finally {
    rmSync(file, { force: true });
    rmSync(list, { force: true });
  }
  const found = new Map();
  for (let i = 0; i + 12 <= words.length; i += 12) {
    const [pc, a, b, fromA, kindA, fromB, kindB, went, times, frame, address, more] = words.subarray(i, i + 12);
    if (!found.has(address)) found.set(address, []);
    found.get(address).push({ pc, a, b, fromA, kindA, fromB, kindB, went, times, frame, more: more === 1 });
  }
  for (const records of found.values()) records.sort((x, y) => Number(x.more) - Number(y.more) || y.times - x.times);
  return found;
}
let plays = 0;

/**
 * What the branch at `address` went by in a recording that ran it, `asked` or the first that did: { name, ran,
 * records }, as wentBy gives a branch's records. `name` is null when no recording has run it.
 */
export async function whyOf(game, { original, codeMap, copy, address, asked = null, log = () => {} }) {
  const ran = ranIn(game, codeMap, address);
  const name = asked ?? ran[0]?.name ?? null;
  if (!name) return { name, ran, records: [] };
  const records = (await wentBy(game, { original, copy, name, addresses: [address], log })).get(address) ?? [];
  return { name, ran, records };
}

/**
 * The values of the original's memory a branch tests, for a search to spread over (route.mjs): from what it went by
 * most often, each side that came from the work memory, as { address, bytes, held, against }, `against` being what
 * the other side held.
 */
export function testedValues(records) {
  const [most] = records.filter(r => !r.more);
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
  const kept = records.filter(r => !r.more), past = records.filter(r => r.more).reduce((sum, r) => sum + r.times, 0);
  for (const r of kept.slice(0, 12)) {
    console.log(`  ${r.went === TAKEN ? 'Taken' : 'Not taken'} ${times(r.times)}, first in frame ${r.frame}: at ${hex(r.pc)}, ${sideText(r.a, r.fromA, r.kindA)}, against ${sideText(r.b, r.fromB, r.kindB)}.`);
  }
  if (kept.length > 12 || past) console.log(`  and ${kept.length > 12 ? `${kept.length - 12} more sets of values` : ''}${kept.length > 12 && past ? ', and ' : ''}${past ? `${times(past)} with values past those it keeps` : ''}.`);
  if (others.length) console.log(`These recordings ran it too: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ` and ${others.length - 12} more` : ''}. --in <recording> asks one of them.`);
  console.log(`npm run dp -- read ${game.split('/')[0]} ${hex(address)} prints the code around it, and npm run dp -- route ${game.split('/')[0]} <recording> --at <frame> --memory <from>-<to> what the memory there holds.`);
  return 0;
}

/** What a branch's records say of each side that came from the work memory: a Map from the side's address to
 *  { bytes, held: Set, against: Set }, what it held and what the other side held. */
function sidesOf(records) {
  const sides = new Map();
  const add = (address, kind, value, other) => {
    if ((kind & 3) !== 1 || ![2, 3].includes(address >>> 24)) return;
    if (!sides.has(address)) sides.set(address, { bytes: kind >> 8 & 0xFF, held: new Set(), against: new Set() });
    sides.get(address).held.add(value);
    sides.get(address).against.add(other);
  };
  for (const r of records) {
    if (r.more) continue;
    add(r.fromA, r.kindA, r.a, r.b);
    add(r.fromB, r.kindB, r.b, r.a);
  }
  return sides;
}

/**
 * Sorts a branch by what it compared in each recording that ran it (`byRecording`, a Map from a recording's name to
 * the branch's records there): { kind, sides, held }. What it compared is the pair of values, whatever they were worked
 * out from, so a place plus a size sorts as well as a value read straight from memory. `kind` is "moves" when the pair
 * was more than one thing within one recording, so it changes as the game is played; "differs" when it was one thing
 * in each recording but not the same in all, which is how a choice made before the part looks, and also what play left
 * at a moment tested once; "path" when it was the same everywhere and both sides were numbers the code had set on the way there,
 * such as a flag set earlier or what a function gave back, so the way it goes depends on the path that led to it; "same" when it was the same everywhere otherwise, so
 * nothing has ever shown another; and "unseen" when it didn't run as a conditional branch. `sides` is each value of
 * the work memory a side came straight from, with its address, bytes, and what it held and was against anywhere, and
 * `held` the pairs seen, as [a, b].
 */
export function sortBranch(byRecording) {
  const all = new Map(), pairs = new Map();
  let moves = false, ran = false, code = true;
  for (const records of byRecording.values()) {
    const own = new Set();
    for (const r of records) {
      ran = true;
      if (r.more) { moves = true; continue; }
      own.add(`${r.a} ${r.b}`);
      pairs.set(`${r.a} ${r.b}`, [r.a, r.b]);
      if ((r.kindA & 3) !== 2 || (r.kindB & 3) !== 2) code = false;
    }
    if (own.size > 1) moves = true;
    for (const [address, side] of sidesOf(records)) {
      if (!all.has(address)) all.set(address, { bytes: side.bytes, held: new Set(), against: new Set() });
      for (const v of side.held) all.get(address).held.add(v);
      for (const v of side.against) all.get(address).against.add(v);
    }
  }
  const sides = [...all].map(([address, side]) => ({ address, bytes: side.bytes, held: [...side.held].sort((a, b) => a - b), against: [...side.against].sort((a, b) => a - b) }));
  const kind = !ran ? 'unseen' : moves ? 'moves' : pairs.size > 1 ? 'differs' : code ? 'path' : 'same';
  return { kind, sides, held: [...pairs.values()] };
}

const some = (values, most = 6) => `${values.slice(0, most).map(number).join(', ')}${values.length > most ? ` and ${values.length - most} more` : ''}`;

// every branch still to play, sorted by what it tests: each recording played once for all the branches it ran
async function sort(game, { original, codeMap, copy, all, atOnce }) {
  const { functions } = untouchedOf(game, codeMap, cartridgeOf(copy.path));
  const branches = functions.filter(f => !f.never).flatMap(f => f.ways.map(([address, way]) => ({ address, way, key: f.key })));
  const never = functions.filter(f => f.never);
  const by = ranBy(game, codeMap, branches.map(b => b.address));
  const names = [...by.keys()], threads = atOnce > 0 ? atOnce : Math.max(1, Math.floor(os.availableParallelism() / 2));
  console.log(`${count(branches.length)} branches of ${game} have gone one way only. Playing the ${names.length} recordings that ran any of them, ${threads} at once, to see what each went by…`);
  (await referenceOf(original)).ensureOriginal(console.log);
  const went = new Map(branches.map(b => [b.address, new Map()]));
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(threads, names.length) }, async () => {
    while (next < names.length) {
      const name = names[next++];
      const found = await wentBy(game, { original, copy, name, addresses: by.get(name) });
      for (const [address, records] of found) went.get(address)?.set(name, records);
      if (++done % 10 === 0 || done === names.length) console.log(`  ${done} of ${names.length} recordings played.`);
    }
  }));
  const sorted = branches.map(b => ({ ...b, ...sortBranch(went.get(b.address)), recordings: [...went.get(b.address).keys()] }));
  const of = kind => sorted.filter(b => b.kind === kind);
  const words = {
    moves: 'compare something that changed while the branch ran in one recording, so playing differently, or a search, can reach the other way',
    differs: 'compare something that was one thing in each recording but not the same in all: a choice made before the part, such as the character, or what play had left at a moment tested once',
    same: 'compare something that was the same in every recording that ran them, so no recording has ever shown another: often the mode or a setting, which a recording that starts differently changes',
    path: 'compare numbers the code had set on the way there, the same every time, such as a flag set earlier or what a function gave back: the way they go depends on the path that led to them, so another path has to be played first',
    unseen: "didn't run as a conditional branch when played again",
  };
  console.log(`\nOf the ${count(sorted.length)} branches:`);
  for (const kind of ['moves', 'differs', 'same', 'path', 'unseen']) if (of(kind).length || kind !== 'unseen') console.log(`  ${count(of(kind).length)} ${words[kind]}.`);
  console.log(`And ${count(never.length)} functions never ran at all, so nothing says what their branches test: something has to call them first.`);

  // the values most branches test without ever seeing another: one recording that changes one of them opens many
  for (const kind of ['same', 'differs']) {
    const groups = new Map();
    for (const b of of(kind)) {
      for (const side of b.sides) {
        if (!groups.has(side.address)) groups.set(side.address, { bytes: side.bytes, held: new Set(), against: new Set(), branches: [] });
        const g = groups.get(side.address);
        side.held.forEach(v => g.held.add(v));
        side.against.forEach(v => g.against.add(v));
        g.branches.push(b);
      }
    }
    const list = [...groups].sort((x, y) => y[1].branches.length - x[1].branches.length);
    const named = of(kind).filter(b => b.sides.length).length;
    console.log(`\nOf the ${count(of(kind).length)} that ${kind === 'same' ? 'were the same everywhere' : 'differ by recording'}, ${count(named)} compare a value read straight from the work memory. Those values, by how many branches test each:`);
    for (const [address, g] of list.slice(0, all ? Infinity : 15)) {
      const held = [...g.held].sort((a, b) => a - b), against = [...g.against].sort((a, b) => a - b);
      console.log(`  the ${sized(g.bytes)} at ${hex(address)}: ${count(g.branches.length)} branches. Between them it held ${some(held)}, against ${some(against)}.${all ? ` Branches: ${g.branches.map(b => hex(b.address)).join(', ')}.` : ''}`);
    }
    if (!all && list.length > 15) console.log(`  and ${count(list.length - 15)} more values: --all prints them, with each one's branches.`);
  }
  if (all) {
    for (const kind of ['moves', 'path']) {
      console.log(`\nThe ${count(of(kind).length)} that ${kind === 'moves' ? 'changed while they ran' : 'compare numbers set on the way there'}: ${of(kind).map(b => `${hex(b.address)} ${b.way}`).join(', ')}.`);
    }
  }
  const folder = join(LOCAL, 'untouched');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${game.replace('/', '-')}.json`);
  writeFileSync(file, `${JSON.stringify({ version: game, original: original.sha1, branches: sorted.map(b => ({ address: hex(b.address), way: b.way, function: b.key, kind: b.kind, recordings: b.recordings, held: b.held.slice(0, 8), sides: b.sides.map(s => ({ ...s, address: hex(s.address) })) })) })}\n`);
  console.log(`\nEvery branch with its kind, its values and the recordings that ran it is in .dreamports/untouched/${game.replace('/', '-')}.json, on this computer. npm run dp -- untouched ${game} --why <address> says more of one.`);
  return 0;
}

/** Why a branch the code decides can't go its other way, for the game's unreachable.json. */
export function decidedWhy({ address, way, from, by }) {
  return `The branch at ${hex(address)} goes by the flags the instruction at ${hex(by)} sets from numbers in the code alone, in the run of instructions from ${hex(from)}, which no instruction of the cartridge branches or calls into and no word of the cartridge points into, so it's never ${way}.`;
}

// the branches the code itself decides, worked out from the cartridge alone, and with `write` put in the game's list
async function decided(game, { original, codeMap, copy, write }) {
  const base = versionOf(game).game;
  const found = decidedBranches(new Uint8Array(readFileSync(copy.path)), codeMap.functions);
  // nothing of it may ever have been played: a way that happened in any version's recordings can't be one that can't
  const versions = proofVersions().filter(version => versionOf(version).game === base && readCodeMap(version));
  const played = found.filter(d => versions.some(version => ranIn(version, readCodeMap(version), d.address).some(each => (d.way === 'taken' ? each.taken : each.notTaken))));
  if (played.length) throw new Error(`The tools worked out that ${played.map(d => `${hex(d.address)} is never ${d.way}`).join(', ')}, and a recording has played it so: that's the tools' fault, so nothing was written. Say so in an issue, with this line.`);
  console.log(`${count(found.length)} conditional branches of ${base} are decided by the code itself, worked out from the cartridge alone, and none has gone its other way in any recording of ${versions.join(', ')}:`);
  for (const d of found) console.log(`  ${hex(d.address)} is never ${d.way}: the flags come from ${hex(d.by)}, in the run from ${hex(d.from)}.`);
  if (!write) {
    console.log(`--write puts them in games/${base}/proof/unreachable.json, where a person reads each before it goes in.`);
    return 0;
  }
  const file = join(sharedProofFolder(game), 'unreachable.json');
  const listed = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { about: `What of ${original.name}'s cartridge nothing can reach, each with why (docs/STANDARD.md#done)` };
  const others = (listed.ways ?? []).filter(([address]) => !found.some(d => hex(d.address) === address));
  listed.code ??= [];
  listed.content ??= [];
  listed.ways = [...others, ...found.map(d => [hex(d.address), d.way, decidedWhy(d)])].sort((a, b) => a[0].localeCompare(b[0]));
  writeFileSync(file, `${JSON.stringify(listed, null, 2)}\n`);
  console.log(`Written: games/${base}/proof/unreachable.json, ${listed.ways.length} ways. npm run dp -- prove <version> counts them out of gameplay proven.`);
  return 0;
}

/**
 * What untouched --sort last found of a version's branches, from .dreamports/untouched/ on this computer: a Map from a
 * branch's address to { kind, sides, held }, or null when it hasn't been run for this copy of the original.
 */
export function readSorted(version, sha1) {
  const file = join(LOCAL, 'untouched', `${version.replace('/', '-')}.json`);
  if (!existsSync(file)) return null;
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  if (kept.original !== sha1) return null;
  return new Map(kept.branches.map(b => [parseInt(b.address, 16), { kind: b.kind, held: b.held ?? [], sides: b.sides.map(side => ({ ...side, address: parseInt(side.address, 16) })) }]));
}

/** A sorted branch in a few words, for a task: its kind, and the value of the work memory it tests, when it has one. */
export function kindText(sorted) {
  const words = { moves: 'changes in play', differs: 'differs by recording', same: 'never differed', path: 'by the path', unseen: 'not seen again' };
  const [side] = sorted.sides;
  const tested = side && sorted.kind !== 'moves' ? `: the ${sized(side.bytes)} at \`${hex(side.address)}\` held ${some(side.held, 3)} against ${some(side.against, 3)}` : '';
  return `${words[sorted.kind] ?? sorted.kind}${tested}`;
}
