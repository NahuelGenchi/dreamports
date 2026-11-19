// npm run dp -- route <game> <name> --goal <goal> [--from <recording>[:<frame>]]: finds the presses that take the
// original from where a recording leaves it to a goal, and writes them as games/<game>/proof/recordings/<name>.json,
// ready for prove. It's how a recording of a whole act is made when nobody plays: the search runs on the original
// itself, in the reference emulator, so it needs none of the Dreamport's code, and it keeps a copy of the console's
// state at every place the game reaches, so no try starts from the beginning (lib/explore.h has how it searches).
//
// The way to the part comes from a recording: <name> itself, when it's there, which then grows from its last frame, or
// another's with --from, up to a frame or to its end, as play --record takes one. The goal is one the game names in
// its proof/route.json, or a condition written out, such as "x>=9000" (lib/route.mjs). What the search needs of a game
// is in that file: where its original keeps the character's place and the like.
//
// It prints how far it has got every few seconds, keeps what it found in .dreamports/routes/<game>/<name>/, and goes
// on from there when it's run again. It stops by itself: at the goal, where it plays the presses once more from
// power-on to be sure of them and writes the recording, or when nothing new has turned up for a long while or its time
// is over, where it says how far it got, with a map of every place it reached and pictures of where it stopped, which
// stay on this computer. --minutes says how long it may take (10), --cells changes the grid ("x:16,y:16"), --apart what
// tells a place's states apart and --wait how it keeps states from later on ("90:3"), --lost adds play that can't go on
// ("frames>5300"), --at-once says how many consoles
// search at the same time, --then adds frames with nothing held after the goal, --seed changes its dice, --fresh
// forgets what it found before and --replace writes over a recording that's there.
//
// npm run dp -- route <game> <recording> --at <frames> [--memory <from>-<to>[:<bytes>]] searches for nothing: it prints
// what the original holds at those frames of a recording, the game's values as route.json has them, or with --memory
// every value in that stretch of the work memory that isn't the same at all of them. That's how a game's route.json is
// checked, and how the place of a value that changes when something happens is found.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import os from 'node:os';
import { LOCAL, REPO, sharedProofFolder } from './lib/paths.mjs';
import { readCodeMap, readOriginal, readRecordings } from './lib/proof-files.mjs';
import { NOT_TAKEN, RAN, TAKEN, provenUnits, ranIn, untouchedOf } from './lib/played.mjs';
import { copyWith } from './lib/copies.mjs';
import { compress, expand, originalPlay, writeRecording } from './lib/recording.mjs';
import { referenceOf } from './lib/reference.mjs';
import { fromColours, png } from './lib/png.mjs';
import { checkWait, defaultButtons, holds, namesOf, parseCondition, placesOf, readArchive, readRoute, searchFingerprint, specText } from './lib/route.mjs';
import { versionOf } from '../src/lib/languages.mjs';
import { testedValues, whyOf } from './untouched.mjs';
import { hex } from './lib/proof-files.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USAGE = 'Usage: npm run dp -- route <game> <name> --goal <goal> [--from <recording>[:<frame>]] [--minutes <how long>] [--cells <value>:<size>,…] [--apart <value>:<size>,…] [--wait <frames>:<states>] [--lost <condition>] [--then <frames>] [--seed <number>] [--at-once <how many>] [--fresh] [--replace]\n       npm run dp -- route <game> <recording> --at <frames> [--memory <from>-<to>[:<bytes>]]';
const FLAGS = ['--lost', '--goal', '--from', '--minutes', '--cells', '--apart', '--wait', '--then', '--seed', '--at-once', '--at', '--memory'];
const count = n => n.toLocaleString('en');
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export async function run(args) {
  const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? '' : null);
  const [game, name] = args.filter((a, i) => !a.startsWith('--') && !FLAGS.includes(args[i - 1]));
  const goalText = value('--goal'), from = value('--from');
  if (game && name && value('--at') && !goalText) return look(game, name, value('--at'), value('--memory'));
  if (!game || !name || !goalText || FLAGS.some(flag => value(flag) === '')) throw new Error(USAGE);
  if (!NAME.test(name)) throw new Error('A recording\'s name is lowercase letters, numbers and single dashes, such as act-1.');
  const minutes = Number(value('--minutes') ?? 10), then = Number(value('--then') ?? 0), seed = Number(value('--seed') ?? 1);
  if (!(minutes > 0) || !Number.isInteger(then) || then < 0 || !Number.isInteger(seed)) throw new Error(USAGE);
  const threads = consolesAtOnce(value('--at-once'));
  // a goal that comes after another is two searches, the second from where the first ended
  const goals = readRoute(game)?.goals ?? {}, stages = [goalText];
  while (goals[stages[0]]?.after) {
    if (stages.includes(goals[stages[0]].after)) throw new Error(`The goal "${stages[0]}" comes after itself.`);
    stages.unshift(goals[stages[0]].after);
  }
  for (const [at, stage] of stages.entries()) {
    const last = at === stages.length - 1;
    const result = await search({ args, value, game, name, goalText: stage, from: at ? null : from, minutes, then: last ? then : 0, seed, threads });
    if (result) return result;
  }
  return 0;
}

// one search, to one goal: 0 when the recording now reaches it, 1 when it stopped short
async function search({ args, value, game, name, goalText, from, minutes, then, seed, threads }) {
  let provenFile = null, target = null;
  const steering = {};   // the values an aimed search adds to its grid, with their sizes
  let ownLost = null;    // where an aimed search stops counting play, when it works that out
  const original = readOriginal(game), base = versionOf(game).game;
  const reference = await referenceOf(original);
  const { KEY, machine } = reference;
  if (!reference.searchOriginal) throw new Error(`The route finder can't search ${machine.name}'s games yet.`);
  const route = readRoute(game, KEY);
  if (!route) {
    throw new Error(`games/${base}/proof/route.json isn't there yet: it says where the original keeps the few values the search reads, such as the character's place (npm run dp -- help finding a route).`);
  }
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The search runs on ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);

  // the way there: this recording as it is, or another's presses up to a frame
  const file = join(sharedProofFolder(game), 'recordings', `${name}.json`), written = `games/${base}/proof/recordings/${name}.json`;
  if (from === null && !existsSync(file)) throw new Error(`${written} isn't there, so the search has nowhere to start: --from <recording>[:<frame>] names the recording that leads to the part.`);
  if (from !== null && existsSync(file) && !args.includes('--replace')) throw new Error(`${written} is already there: leave --from out to go on from its end, choose another name, or add --replace.`);
  const [sourceName, cutText] = (from ?? name).split(':');
  const [source] = readRecordings(game, [sourceName]);
  if (source.players) throw new Error('The route finder searches with one console, and this recording links several.');
  const cut = cutText === undefined ? source.frames : Number(cutText);
  if (!Number.isInteger(cut) || cut < 1 || cut > source.frames) throw new Error(`--from ${sourceName}:<frame> takes ${sourceName} up to a frame from 1 to ${source.frames}, its length.`);

  // what to search for: `untouched` is anything of the cartridge's code this version hasn't played in a matching frame,
  // which the program counts each frame as a value of its own (gba/original.c, DP_PROVEN)
  // `untouched:<address>` is one thing alone: the branch there going the way nobody has played, or an instruction
  // that never ran running, in the cartridge or in code the game runs from its work RAM
  // `frames`, how long the console has played, is a value any search can spread over, for a part with no place values
  if (reference.searchesWhatRan === true) route.values = { ...route.values, frames: { address: 'FFFF0004', bytes: 4 } };
  const untouched = /^untouched(?::[0-9A-Fa-f]{7,8})?$/.test(goalText);
  if (untouched) {
    const codeMap = readCodeMap(game);
    if (reference.searchesWhatRan !== true || !codeMap) throw new Error("--goal untouched needs a code map and a console whose search counts what hasn't been played, which is the Game Boy Advance so far.");
    route.values = { ...route.values, untouched: { address: 'FFFF0000', bytes: 4 } };
    route.goals = { ...route.goals, [goalText]: 'untouched>0' };
    provenFile = Buffer.from(provenUnits(game, codeMap).buffer);
    if (goalText.includes(':')) {
      const address = parseInt(goalText.split(':')[1], 16);
      const f = untouchedOf(game, codeMap).functions.find(each => address >= each.address && address < each.address + each.size);
      if (!f) throw new Error(`Nothing is left to play at ${goalText.split(':')[1]}, or it's in no function of the code map: npm run dp -- untouched ${game} --all lists what is.`);
      const way = f.ways.find(([at]) => at === address)?.[1];
      target = `${address.toString(16)} ${way === 'taken' ? TAKEN : way === 'not taken' ? NOT_TAKEN : RAN}`;
      // what the branch tests, from a recording that ran it: the search spreads over those values too, so it keeps each
      // step towards the other way (untouched.mjs)
      if (way) {
        // in the recording the search starts from when that one ran the branch, as its frames are then the search's own
        const inSource = ranIn(game, codeMap, address).some(each => each.name === sourceName);
        const { name: asked, records } = await whyOf(game, { original, codeMap, copy, address, asked: inSource ? sourceName : null, log: console.log });
        const after = inSource && value('--lost') === null ? lostAfter(records, cut) : null;
        if (after !== null) {
          ownLost = `frames>${after}`;
          console.log(`The branch ran only at set moments in ${sourceName}, the last in frame ${after - 120}, so play past frame ${after} doesn't count: --lost says otherwise.`);
        }
        testedValues(records, original.console).forEach((tested, i) => {
          const key = `tested${i + 1}`;
          route.values[key] = { address: hex(tested.address), bytes: tested.bytes };
          steering[key] = Math.max(1, Math.ceil(Math.abs(tested.held - tested.against) / 16));
          console.log(`The branch tests the ${tested.bytes === 1 ? 'byte' : tested.bytes === 2 ? 'halfword' : 'word'} at ${hex(tested.address)}, which held ${tested.held} against ${tested.against} in ${asked}: the search spreads over it too, as ${key}.`);
        });
        if (asked && !Object.keys(steering).length) console.log(`What the branch tests in ${asked} isn't one value of the work memory, so the search has nothing more to steer by: npm run dp -- untouched ${game} --why ${hex(address)} says what it is.`);
      }
    }
  }
  // a goal the game names, which may have a grid of its own, or a condition written out
  const named = route.goals?.[goalText], ownGoal = named && typeof named === 'object' ? named : { when: named ?? goalText };
  const goal = [parseCondition(ownGoal.when, route.values, named ? `the goal "${goalText}"` : `--goal, which isn't one of the game's (${Object.keys(route.goals ?? {}).join(', ') || 'it names none'}), read as a condition`)];
  const sidesOf = (flag, own) => {
    const text = value(flag);
    const sides = text === null ? own ?? {} : Object.fromEntries(text.split(',').filter(Boolean).map(part => part.split(':')).map(([n, size]) => [n.trim(), Number(size)]));
    for (const [n, size] of Object.entries(sides)) if (!(n in route.values) || !(size > 0)) throw new Error(`${flag} takes values and sizes, such as x:16,y:16, and the values are ${Object.keys(route.values).join(', ')}.`);
    return sides;
  };
  let ownCells = ownGoal.cells ?? route.cells, ownApart = ownGoal.apart ?? route.apart;
  // a search for untouched code in a part where the game's place values don't move, such as a special stage, spreads
  // over time: the frames played, two seconds to a cell
  if (untouched && value('--cells') === null) {
    const rows = Object.keys(ownCells ?? {}).map(n => route.values[n]).filter(v => v?.address).map(v => ({ address: parseInt(v.address, 16), bytes: v.bytes }));
    const frames = framesFrom(cut, source.frames);
    // a recording that ends where the search starts shows nothing of the part, so its grid stays the game's
    if (rows.length === Object.keys(ownCells ?? {}).length && rows.length && frames.length > 1) {
      const read = await readAt({ original, reference, copy, recording: source, frames, rows });
      if (rows.every((_, i) => frames.every((__, k) => read[k * rows.length + i] === read[i]))) {
        console.log(`${Object.keys(ownCells).join(' and ')} don't change from frame ${cut} of ${sourceName}, so the search spreads over the frames played: --cells says otherwise.`);
        ownCells = { frames: 120 };
        if (value('--apart') === null) ownApart = {};
      }
    }
  }
  const cells = { ...sidesOf('--cells', ownCells), ...steering }, apart = sidesOf('--apart', ownApart);
  if (!Object.keys(cells).length || Object.keys(cells).length + Object.keys(apart).length > 6) throw new Error('--cells and --apart take up to six values between them, and --cells at least one.');
  const [waitFrames, waitStates] = (value('--wait') ?? '').split(':').map(Number);
  const wait = value('--wait') === null ? ownGoal.wait ?? route.wait : { frames: waitFrames, states: waitStates };
  if (checkWait(wait)) throw new Error(`--wait takes how many frames apart and how many states, such as 90:3. ${checkWait(wait)}`);
  // play that can't go on: what the game says, and what --lost adds, such as "frames>5300" for a search that has a frame to be there by
  const lostTexts = [...(route.lost ?? []), ...(value('--lost') ? [value('--lost')] : ownLost ? [ownLost] : [])];
  const lost = lostTexts.map(text => parseCondition(text, route.values, '"lost"'));
  const buttons = route.buttons ?? defaultButtons(KEY);

  // the original's side of the way there, as prove gives it
  const keysLate = original.keysAfterVBlank === true;
  const way = originalPlay(source, { frames: cut, keysLate });
  const masks = way.originalHeld.map(list => list.reduce((mask, b) => mask | (KEY[b] ?? 0), 0));
  if (keysLate) masks.unshift(0);
  const searching_ = () => ({ ...reference.searchOriginal({ copy: copy.path, spec: 'spec.txt' }), ...(provenFile ? { env: { DP_PROVEN: 'proven.bin', ...(target ? { DP_TARGET: target } : {}) } } : {}) });
  const searcher = searching_();
  const pack = list => Buffer.from((searcher.buttonBytes === 4 ? Uint32Array : Uint16Array).from(list).buffer);
  const prefix = pack(masks), sets = Buffer.from(Uint32Array.from(way.sets.flatMap(({ frame, address, bytes, value: v }) => [frame, address, bytes, v])).buffer);

  // where it keeps what it finds, which it goes on from when nothing it starts from has changed
  const folder = join(LOCAL, 'routes', base, name);
  const fingerprint = searchFingerprint({ original: original.sha1, prefix, sets, route, cells, apart, wait, lost: lostTexts, buttons });
  const kept = join(folder, 'search.json'), archiveFile = join(folder, 'archive.bin');
  const before = existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : null;
  if (args.includes('--fresh') || before?.fingerprint !== fingerprint) rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const spent = existsSync(archiveFile) ? before?.seconds ?? 0 : 0;
  const files = { prefix: 'prefix.bin', sets: way.sets.length ? 'sets.bin' : '-', archive: 'archive.bin', out: 'route.bin' };
  writeFileSync(join(folder, 'prefix.bin'), prefix);
  if (provenFile) writeFileSync(join(folder, 'proven.bin'), provenFile);
  writeFileSync(join(folder, 'sets.bin'), sets);
  rmSync(join(folder, 'route.bin'), { force: true });
  writeFileSync(join(folder, 'spec.txt'), specText({ route, goal, lost, cells, apart, wait, buttons, KEY, files, seed, seconds: Math.round(minutes * 60), stale: STALE, megabytes: roomForStates(), threads }));
  reference.ensureOriginal(console.log);

  const shown = held => Object.keys(cells).map(n => `${n} ${count(Math.floor(held[n] / (route.values[n].per ?? 1)))}`).join(', ');
  console.log(`${spent ? 'Going on with the search' : 'Searching'} for the presses from frame ${cut} of ${sourceName} to ${goalText}, on ${original.name}, with ${threads} ${threads === 1 ? 'console' : 'consoles'} at once, for up to ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}${spent ? `, after the ${clock(spent)} it has already searched` : ''}.`);
  const started = Date.now();
  const names = Object.keys(route.values);
  let said = 0, last = null;
  const outcome = await searching(searcher, folder, line => {
    const words = line.split(' ');
    if (words[0] === 'resumed') console.log(`It has the ${count(Number(words[2]))} places it found before again.`);
    if (words[0] !== 'at') return;
    last = { tries: Number(words[3]), frames: Number(words[5]), places: Number(words[7]), states: Number(words[9]), megabytes: Number(words[11]), newest: Object.fromEntries(names.map((n, i) => [n, Number(words[13 + i])])) };
    const elapsed = (Date.now() - started) / 1000;
    if (elapsed - said < 15) return;
    said = elapsed;
    console.log(`${clock(spent + elapsed)}  ${count(last.places)} places from ${count(last.tries)} tries. The newest: ${shown(last.newest)}.`);
  });
  const seconds = (Date.now() - started) / 1000;
  writeFileSync(kept, `${JSON.stringify({ fingerprint, seconds: Math.round(spent + seconds), goal: goalText, from: `${sourceName}:${cut}` }, null, 2)}\n`);
  const took = `${clock(seconds)}${spent ? ` now, ${clock(spent + seconds)} in all` : ''}`;
  const speed = last && seconds > 1 ? `, ${count(Math.round(last.frames / seconds))} frames a second` : '';
  const room = last ? ` It kept ${count(last.states)} states of ${count(last.places)} places, in ${count(last.megabytes)} MB.` : '';

  if (outcome.word === 'there') {
    console.log(`${sourceName} already reaches ${goalText} by frame ${cut}, so there's nothing to find.`);
    return 0;
  }
  if (outcome.word === 'goal') {
    // the presses from the search's start to the goal, then the whole way once more from power-on, straight through
    const found = readFileSync(join(folder, 'route.bin'));
    const moves = Array.from(new Uint32Array(found.buffer.slice(found.byteOffset, found.byteOffset + found.length)));
    if (moves.length !== outcome.number) throw new Error('The search wrote another route than it said.');
    const check = join(folder, 'check');
    rmSync(check, { recursive: true, force: true });
    mkdirSync(check);
    writeFileSync(join(check, 'prefix.bin'), pack([...masks, ...moves]));
    writeFileSync(join(check, 'sets.bin'), sets);
    writeFileSync(join(check, 'spec.txt'), specText({ route, goal, lost, cells, apart, wait, buttons, KEY, files, seed, seconds: 1, stale: 1, megabytes: 100 }));
    if (provenFile) writeFileSync(join(check, 'proven.bin'), provenFile);
    const again = await searching(searching_(), check, () => {});
    rmSync(check, { recursive: true, force: true });
    if (again.word !== 'there') {
      throw new Error(`The search reached ${goalText} after ${count(moves.length)} frames, but played again from power-on the same presses didn't, so nothing was written. That's the tools' fault, not the game's: say so in an issue, with this line.`);
    }
    const held = [...expand(source.held, cut), ...moves.map(mask => namesOf(mask, KEY)), ...Array.from({ length: then }, () => [])];
    const about = from === null ? source.about : `Plays ${sourceName}'s presses up to frame ${cut}, then the presses the route finder found from there to ${goalText}: say what it plays.`;
    mkdirSync(join(sharedProofFolder(game), 'recordings'), { recursive: true });
    writeRecording(file, { about, frames: held.length, held: compress(held), onlyInOriginal: source.onlyInOriginal.filter(gap => gap.at <= cut),
      sets: (source.sets ?? []).filter(set => set.frame < cut), start: source.start });
    console.log(`Found in ${took}${speed}: ${count(moves.length)} frames of presses from frame ${cut} reach ${goalText}, and played again from power-on they still do.${room}`);
    console.log(`Written: ${written}, ${count(held.length)} frames${then ? `, the last ${then} with nothing held` : ''}. Say what it plays in its "about", then npm run dp -- prove ${game} ${name} compares it with the Dreamport.`);
    return 0;
  }

  // not there: how far it got, and what it leaves to look at
  const why = { seconds: `its ${minutes} ${minutes === 1 ? 'minute is' : 'minutes are'} over`, stale: 'nothing new turned up in its last tries, so it can\'t get further as it is', megabytes: 'its copies of the console\'s state take all the memory it may use' }[outcome.word] ?? 'the search ended';
  console.log(`Not found, after ${took}${speed}: ${why}.${room}`);
  const archive = readArchive(readFileSync(archiveFile), names);
  const places = [...placesOf(archive, cells, route.values).values()];
  const sides = Object.keys(cells);
  const least = n => places.reduce((a, b) => (archive.nodes[b].values[n] < archive.nodes[a].values[n] ? b : a));
  const most = n => places.reduce((a, b) => (archive.nodes[b].values[n] > archive.nodes[a].values[n] ? b : a));
  console.log(`It reached ${count(places.length)} places. ${sides.map(n => `${n} from ${count(Math.floor(archive.nodes[least(n)].values[n] / (route.values[n].per ?? 1)))} to ${count(Math.floor(archive.nodes[most(n)].values[n] / (route.values[n].per ?? 1)))}`).join(', ')}.`);
  const newest = places.reduce((a, b) => (b > a ? b : a));
  const ends = [['newest', newest], ...(sides.length ? [[`most-${sides[0]}`, most(sides[0])], [`least-${sides[0]}`, least(sides[0])]] : [])];
  const looked = [];
  for (const [what, node] of ends) {
    if (looked.some(([, other]) => other === node)) continue;
    looked.push([what, node]);
    const moves = archive.route(node), all = [...masks, ...moves];
    const played = await reference.runOriginal({ copy: copy.path, frames: all.length + 1, buttons: all, sets: way.sets, pictures: [all.length] });
    const picture = played.pictures.get(all.length);
    if (picture) writeFileSync(join(folder, `${what}.png`), png(machine.screen[0], machine.screen[1], fromColours(picture)));
    console.log(`  ${what.replace('-', ' ')}: ${shown(archive.nodes[node].values)}, ${count(moves.length)} frames from the search's start${picture ? `, pictured in ${what}.png` : ''}.`);
  }
  if (sides.length >= 2) writeFileSync(join(folder, 'map.png'), mapOf(archive, places, sides, cells, route.values));
  const place = relative(REPO, folder).replaceAll('\\', '/');
  console.log(`${sides.length >= 2 ? `A map of every place it reached is ${place}/map.png, ${sides[0]} across and ${sides[1]} down, blue where it got to first and red last, and the` : 'The'} pictures are beside it. They show the game, so they stay on this computer.`);
  console.log(`The same command goes on from here, and --minutes gives it longer. A --goal that names a place it reached, such as "${sides.map(n => `${n}>=${Math.floor(archive.nodes[newest].values[n] / (route.values[n].per ?? 1))}`).join(',')}", writes the recording that gets there, to look at with prove's --stills or to go on from another way.`);
  return 1;
}

/**
 * What the original holds at `frames` of a recording, each frame as the search sees it, once it has run that frame's
 * buttons: for each frame in turn, the value of each of `rows` ({ address, bytes }).
 */
async function readAt({ original, reference, copy, recording, frames, rows }) {
  const keysLate = original.keysAfterVBlank === true;
  const way = originalPlay(recording, { keysLate });
  const masks = way.originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
  if (keysLate) masks.unshift(0);
  reference.ensureOriginal(console.log);
  const reads = frames.flatMap(f => rows.map(({ address, bytes }) => ({ frame: way.originalOf[f] + (keysLate ? 1 : 0), address, bytes })));
  const played = await reference.runOriginal({ copy: copy.path, frames: masks.length + 1, buttons: masks, sets: way.sets, reads });
  const read = played.outside.reads ?? [];
  if (read.length !== reads.length) throw new Error('The program that runs the original read nothing of its memory: npm run dp -- setup builds it again.');
  return read;
}

/** The frames of a recording of `length` frames to look at from `cut` on, for whether a part's place values move: up
 *  to sixteen, to the recording's end or thirty seconds on. */
export function framesFrom(cut, length) {
  const first = Math.min(cut, length - 1), last = Math.min(length - 1, cut + 1800);
  const frames = new Set(Array.from({ length: 16 }, (_, i) => Math.round(first + (last - first) * i / 15)));
  return [...frames].sort((a, b) => a - b);
}

/**
 * Where an aimed search stops counting play, from what its branch went by in the recording it starts from (records as
 * untouched.mjs's whyOf gives them): a branch that ran three times or fewer is tested at set moments, so play two
 * seconds past the last of them is lost. Null for a branch that runs all the time, or one that last ran before `cut`.
 */
export function lostAfter(records, cut) {
  const times = records.reduce((sum, r) => sum + r.times, 0), last = Math.max(-1, ...records.map(r => r.frame));
  return times && times <= 3 && last >= cut ? last + 120 : null;
}

// What the original holds at frames of a recording: the game's values, or a stretch of its work memory where it changes.
async function look(game, name, framesText, memory) {
  const original = readOriginal(game), reference = await referenceOf(original);
  const [recording] = readRecordings(game, [name]);
  if (recording.players) throw new Error('This looks at one console, and this recording links several.');
  const frames = framesText.split(',').map(Number);
  if (!frames.length || frames.length > 16 || frames.some(f => !Number.isInteger(f) || f < 0 || f >= recording.frames) || frames.some((f, i) => i && f <= frames[i - 1])) {
    throw new Error(`--at takes up to 16 frames of ${name}, from 0 to ${recording.frames - 1}, in order, with commas between.`);
  }
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`Show the tools your copy of ${original.name} first: npm run dp -- rom <file>.`);
  // what to read at each frame: each its name, address and bytes
  let rows;
  if (memory) {
    const [, a, b, size = '4'] = /^([0-9A-Fa-f]{1,8})-([0-9A-Fa-f]{1,8})(?::([124]))?$/.exec(memory) ?? [];
    const first = parseInt(a, 16), end = parseInt(b, 16), bytes = Number(size);
    if (a === undefined || end <= first || (end - first) / bytes > 16384) throw new Error('--memory takes a stretch of the work memory in hexadecimal, such as 03005000-03005100, with :1, :2 or :4 for the bytes of each value, up to 16,384 values.');
    rows = Array.from({ length: Math.ceil((end - first) / bytes) }, (_, i) => ({ name: (first + i * bytes).toString(16).toUpperCase().padStart(8, '0'), address: first + i * bytes, bytes }));
  } else {
    const route = readRoute(game, reference.KEY);
    if (!route) throw new Error(`games/${versionOf(game).game}/proof/route.json isn't there yet, so there are no values to print: --memory <from>-<to> looks at the work memory itself.`);
    rows = Object.entries(route.values).filter(([, v]) => v.address).map(([n, v]) => ({ name: n, address: parseInt(v.address, 16), bytes: v.bytes, signed: v.signed, per: v.per ?? 1 }));
    const found = Object.entries(route.values).filter(([, v]) => v.found).map(([n]) => n);
    if (found.length) console.log(`Not shown, as only the search finds where they are: ${found.join(', ')}.`);
  }
  const read = await readAt({ original, reference, copy, recording, frames, rows });
  const lines = rows.map((row, i) => {
    const held = frames.map((_, k) => read[k * rows.length + i]);
    if (memory && held.every(v => v === held[0])) return null;
    const text = held.map(v => {
      if (memory || row.per === 1 && !row.signed) return `0x${v.toString(16).toUpperCase()}`;
      const signed = row.signed && v >= 2 ** (row.bytes * 8 - 1) ? v - 2 ** (row.bytes * 8) : v;
      return count(Math.floor(signed / row.per));
    });
    return [row.name, ...text];
  }).filter(Boolean);
  const table = [[memory ? 'address' : 'value', ...frames.map(f => `frame ${f}`)], ...lines.slice(0, 400)];
  const widths = table[0].map((_, column) => Math.max(...table.map(line => line[column].length)));
  for (const line of table) console.log(line.map((cell, column) => (column ? cell.padStart(widths[column]) : cell.padEnd(widths[0]))).join('  '));
  if (memory) console.log(lines.length > 400 ? `And ${count(lines.length - 400)} more that change: a shorter stretch, or frames closer together, shows fewer.` : `${count(lines.length)} of ${count(rows.length)} values change between these frames.`);
  return 0;
}

// a search gives up after this many tries in a row that found nothing new, and 60 more for each place it has reached
const STALE = 20000;
// the most consoles searching at once: past it they mostly try the same places
const MOST = 12;

/** How many consoles search at the same time: as many as the computer has idle cores as it starts, up to MOST, or what --at-once says. */
export function consolesAtOnce(asked, { cores = os.availableParallelism(), load = os.loadavg()[0] } = {}) {
  if (asked !== null && asked !== undefined) {
    if (!/^[1-9]\d*$/.test(String(asked)) || Number(asked) > 32) throw new Error('--at-once takes how many consoles search at the same time, 1 to 32.');
    return Number(asked);
  }
  return Math.max(1, Math.min(MOST, Math.floor(cores - load)));
}

// how many megabytes the search's copies of the console's state may take: half of what's free, up to 4,000
const roomForStates = () => Math.max(200, Math.min(4000, Math.floor(os.freemem() / 2 / 1048576)));

// runs the search in its folder, giving each line it prints, and resolves to how it ended: { word, number }
function searching({ program, args, env, done }, folder, line) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    // a tool that's stopped takes its search with it, which would otherwise search on for its whole time
    const stop = () => child.kill();
    const stopped = signal => { stop(); process.exit(signal === 'SIGINT' ? 130 : 143); };
    process.once('exit', stop);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stopped);
    child.once('close', () => {
      process.off('exit', stop);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stopped);
    });
    let text = '', error = '', ended = null;
    child.stdout.on('data', chunk => {
      text += chunk;
      const lines = text.split('\n');
      text = lines.pop();
      for (const each of lines) {
        const [word, number] = each.split(' ');
        if (word === 'goal') ended = { word, number: Number(number) };
        else if (word === 'stopped') ended = { word: number };
        else line(each);
      }
    });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) return reject(new Error(`The search stopped partway, with ${signal}.`));
      if (code !== 0 || !ended) return reject(new Error(`The search didn't run: ${error.trim() || 'it said nothing'}`));
      resolve(ended);
    });
  }).finally(() => done?.());
}

// every place the search reached, a square each, by the grid's first two values: blue where it got to first, red last
function mapOf(archive, places, [across, down], cells, values) {
  const at = (node, n) => Math.floor(archive.nodes[node].values[n] / (cells[n] * (values[n].per ?? 1)));
  const xs = places.map(node => at(node, across)), ys = places.map(node => at(node, down));
  const left = Math.min(...xs), top = Math.min(...ys), wide = Math.max(...xs) - left + 1, tall = Math.max(...ys) - top + 1;
  const scale = Math.max(1, Math.min(8, Math.floor(1600 / Math.max(wide, tall))));
  const width = wide * scale, height = tall * scale, rgba = new Uint8Array(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const longest = Math.max(1, ...places.map(node => archive.nodes[node].frames));
  places.forEach((node, i) => {
    const t = archive.nodes[node].frames / longest;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const p = (((ys[i] - top) * scale + y) * width + (xs[i] - left) * scale + x) * 4;
      rgba[p] = Math.round(60 + 195 * t);
      rgba[p + 1] = Math.round(200 - 120 * Math.abs(t - 0.5) * 2);
      rgba[p + 2] = Math.round(255 - 195 * t);
    }
  });
  return png(width, height, rgba);
}
