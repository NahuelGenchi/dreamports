// npm run dp -- play <game> [--record <name>]: opens the game in a browser window, from this repository and with the
// contributor's copy, ready to press Play. With --record, the game starts from power-on with nothing saved, keeps
// the buttons held at every frame (the kit's ?proof=record), and when the window closes they're written as
// games/<game>/proof/recordings/<name>.json, ready for prove. The copy stays where it is.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, proofFolder } from './lib/paths.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { copyOf } from './lib/copies.mjs';
import { compress, writeRecording } from './lib/recording.mjs';
import { serveRepository } from './lib/server.mjs';
import { openChrome } from './lib/chrome.mjs';
import { openDreamport } from './lib/dreamport.mjs';
import { KEY } from './gba/original.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function run(args) {
  const game = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--record');
  const recordAt = args.indexOf('--record');
  const name = recordAt >= 0 ? args[recordAt + 1] : null;
  if (!game || (recordAt >= 0 && !name)) throw new Error('Usage: npm run dp -- play <game> [--record <name>]');
  if (name && !NAME.test(name)) throw new Error(`A recording's name is lowercase letters, numbers and single dashes, such as act-1.`);
  const original = readOriginal(game);
  const copy = copyOf(game, original.sha1);
  if (!copy) throw new Error(`Show the tools your copy of ${original.name} first: npm run dp -- rom <file>.`);
  const file = name && join(proofFolder(game), 'recordings', `${name}.json`);
  if (file && existsSync(file)) throw new Error(`games/${game}/proof/recordings/${name}.json is already there: choose another name, or delete it first.`);
  if (name && copy.sha1 !== original.sha1) console.log(`This copy isn't ${original.name}, the one prove compares against: the recording may not play the same there.`);

  const server = await serveRepository();
  // its own profile, kept between plays; a recording starts from a new one, with nothing saved
  const page = await openChrome({ profile: join(LOCAL, 'chrome', name ? 'record' : `play-${game}`), headless: false, fresh: !!name, controllers: true });
  const frames = [];
  let buttons = [];
  try {
    await openDreamport(page, server, game, copy.path, { query: name ? '?proof=record' : '', start: false });
    console.log(name
      ? `Recording: press Play and play. Close the browser window to stop, and the recording is written to games/${game}/proof/recordings/${name}.json.`
      : 'Ready: press Play. Close the browser window when you\'re done.');
    while (name) {
      // what the game read since last time, as it plays; a reload starts the recording again
      const update = await Promise.race([
        page.evaluate(`globalThis.dreamportsProof ? { total: dreamportsProof.frames.length, buttons: dreamportsProof.buttons, frames: dreamportsProof.frames.slice(${frames.length}) } : null`).catch(() => null),
        page.closed.then(() => null),
      ]);
      if (!update) break;
      if (update.total < frames.length) frames.length = 0;
      frames.push(...update.frames);
      if (update.buttons.length) buttons = update.buttons;
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
  mkdirSync(join(proofFolder(game), 'recordings'), { recursive: true });
  writeRecording(file, { about: 'What this recording plays, in a sentence or two.', frames: held.length, held: compress(held) });
  console.log(`Written: games/${game}/proof/recordings/${name}.json, ${held.length} frames. Say what it plays in its "about", then run npm run dp -- prove ${game} ${name}.`);
  return 0;
}
