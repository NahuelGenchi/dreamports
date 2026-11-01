// npm run dp -- play <game> [--record <name> [--from <recording>[:<frame>]]]: opens the game in a browser window, from
// this repository and with the contributor's copy, ready to press Play. With --record, the game starts from power-on
// with nothing saved, keeps the buttons held at every frame (the kit's ?proof=record), and when the window closes
// they're written as games/<game>/proof/recordings/<name>.json, ready for prove. With --from, it first plays another
// recording's presses, up to the frame named or to its end, and the player takes over from there, so a part later in
// the game can be recorded without playing everything before it again; the new recording keeps those presses, and
// the stretches only the original has among them. The copy stays where it is.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, proofFolder } from './lib/paths.mjs';
import { readOriginal, readRecordings } from './lib/proof-files.mjs';
import { copyOf } from './lib/copies.mjs';
import { compress, expand, writeRecording } from './lib/recording.mjs';
import { serveRepository } from './lib/server.mjs';
import { openChrome } from './lib/chrome.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { KEY } from './gba/original.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function run(args) {
  const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? '' : null);
  const game = args.find((a, i) => !a.startsWith('--') && !['--record', '--from'].includes(args[i - 1]));
  const name = value('--record'), from = value('--from');
  if (!game || name === '' || from === '' || (from !== null && name === null)) {
    throw new Error('Usage: npm run dp -- play <game> [--record <name> [--from <recording>[:<frame>]]]');
  }
  if (name && !NAME.test(name)) throw new Error(`A recording's name is lowercase letters, numbers and single dashes, such as act-1.`);
  const original = readOriginal(game);
  const copy = copyOf(game, original.sha1);
  if (!copy) throw new Error(`Show the tools your copy of ${original.name} first: npm run dp -- rom <file>.`);
  const file = name && join(proofFolder(game), 'recordings', `${name}.json`);
  if (file && existsSync(file)) throw new Error(`games/${game}/proof/recordings/${name}.json is already there: choose another name, or delete it first.`);
  if (name && copy.sha1 !== original.sha1) console.log(`This copy isn't ${original.name}, the one prove compares against: the recording may not play the same there.`);
  // the presses to play first, with --from: another recording's, up to a frame or to its end
  let start = null;
  if (from) {
    const [source, cut] = from.split(':');
    const [recording] = readRecordings(game, [source]);
    const until = cut === undefined ? recording.frames : Number(cut);
    if (!Number.isInteger(until) || until < 1 || until > recording.frames) {
      throw new Error(`--from ${source}:<frame> plays ${source} up to a frame from 1 to ${recording.frames}, its length.`);
    }
    start = {
      source, until, held: expand(recording.held, until),
      // the stretches only the original has before the player takes over, which the new recording needs too
      onlyInOriginal: recording.onlyInOriginal.filter(gap => gap.at <= until),
    };
  }

  const server = await serveRepository();
  // its own profile, kept between plays; a recording starts from a new one, with nothing saved
  const page = await openChrome({ profile: join(LOCAL, 'chrome', name ? 'record' : `play-${game}`), headless: false, fresh: !!name, controllers: true });
  const frames = [];
  let buttons = [];
  try {
    await openDreamport(page, server, game, copy.path, { query: name ? '?proof=record' : '', start: false });
    // the presses to play first go in before the game starts, and again after a reload
    const giveStart = async () => {
      if (!(await page.evaluate(`typeof dreamportsProof?.replay === 'function'`))) {
        throw new Error(`games/${game}/ has no proof mode that replays presses: its page calls proof?.watch(screen, input) from the kit (kit/gba/README.md).`);
      }
      await page.evaluate(`dreamportsProof.replay(${JSON.stringify(start.held.map(held => ({ held })))})`);
    };
    if (start) await giveStart();
    console.log(!name ? 'Ready: press Play. Close the browser window when you\'re done.'
      : start ? `Recording: press Play, and the game first plays ${start.source}'s presses up to frame ${start.until}, about ${Math.ceil(start.until / 60)} seconds, with your buttons doing nothing. Then it's your turn. Close the browser window to stop, and the recording is written to games/${game}/proof/recordings/${name}.json.`
        : `Recording: press Play and play. Close the browser window to stop, and the recording is written to games/${game}/proof/recordings/${name}.json.`);
    let handedOver = false;
    while (name) {
      // what the game read since last time, as it plays; a reload starts the recording again
      const update = await Promise.race([
        page.evaluate(`globalThis.dreamportsProof ? { total: dreamportsProof.frames.length, replaying: dreamportsProof.replaying ?? 0, buttons: dreamportsProof.buttons, frames: dreamportsProof.frames.slice(${frames.length}) } : null`).catch(() => null),
        page.closed.then(() => null),
      ]);
      if (!update) break;
      if (update.total < frames.length) {
        frames.length = 0;
        handedOver = false;
      }
      if (start && !update.total && !update.replaying) await giveStart().catch(() => {});
      frames.push(...update.frames);
      if (update.buttons.length) buttons = update.buttons;
      if (start && !handedOver && frames.length >= start.until) {
        handedOver = true;
        console.log(`Your turn: ${start.source}'s presses are over, from frame ${start.until} on the game takes yours.`);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await page.closed;
  } finally {
    await page.close();
    await server.close();
  }
  if (!name) return 0;
  if (!frames.length) throw new Error('Nothing was recorded: the game has to be started with Play.');
  // each button by the console's name where it is one of the console's, and a press shorter than a frame held for one
  const consoleName = new Map(buttons.filter(b => b.gba in KEY).map(b => [b.name, b.gba]));
  const held = frames.map(f => [...new Set([...f.held, ...(f.pressed ?? [])])].map(b => consoleName.get(b) ?? b));
  if (start) {
    // the game held the other recording's buttons at each of its frames, and the new one keeps them as they were
    const same = (a, b) => [...a].sort().join(' ') === [...b].sort().join(' ');
    const wrong = start.held.findIndex((list, frame) => !frames[frame] || !same(list, frames[frame].held.map(b => consoleName.get(b) ?? b)));
    if (wrong >= 0) {
      throw new Error(frames.length < start.until
        ? `The window closed at frame ${frames.length}, before ${start.source}'s presses were over at frame ${start.until}, so nothing was written.`
        : `The game didn't play ${start.source}'s presses at frame ${wrong}, so nothing was written: start again, and press Play once the window is ready.`);
    }
    held.splice(0, start.until, ...start.held);
  }
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeRecording(file, {
    about: start ? `Plays ${start.source}'s presses up to frame ${start.until}, then: what this recording plays, in a sentence or two.` : 'What this recording plays, in a sentence or two.',
    frames: held.length, held: compress(held), onlyInOriginal: start?.onlyInOriginal ?? [],
  });
  console.log(`Written: games/${game}/proof/recordings/${name}.json, ${held.length} frames. Say what it plays in its "about", then run npm run dp -- prove ${game} ${name}.`);
  return 0;
}
