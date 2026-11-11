// npm run dp -- capture <game> [--choose | --open | --pick | --from <file>] [--yes] [--repo <owner/name>]: a real moment
// of the game for its card in the launcher. It opens a window where the person plays their own copy of the original, on
// this computer, from power-on. When they finish it shows the best moments of what they played, moving, and they press
// the one they want, which is written as public/media/<game>-dreamport.h264.mp4, .av1.mp4, -still.webp and -share.png and
// named in the game's entry. Their presses stay in .dreamports/captures/<game>/, so that --choose can show the same
// moments again with no more playing, or if the window closed before they chose.
//
// Making a Dreamport never waits for any of this. --open starts the window and returns at once. --pick, when the work is
// done, closes it once nobody is using it and, if they played and didn't choose, takes the moment that ranks first.
// --from plays a list of presses, as a recording writes them, when nobody played at all, and takes the moment that ranks
// first of those, or says in numbers what the presses led to. Neither shows anyone a picture.
//
// --yes is the person's yes to sending what's kept, as a pull request of its own, the game's card
// (docs/TEAMS.md#a-games-first-files-and-its-card), once the game's first files are on main, where `new` sent them.
// Nothing else is sent anywhere, and --repo sends it to another copy of the repository, such as a fork that tries the
// first entry workflow.

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LOCAL, REPO, gameFolder } from './lib/paths.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { copyOf } from './lib/copies.mjs';
import { serveRepository } from './lib/server.mjs';
import { go, openChrome, until } from './lib/chrome.mjs';
import { UPSTREAM, api } from './lib/github.mjs';
import { captureBranch as branchFor, mediaPath, sendCard } from './lib/send.mjs';
import { FEW_COLOURS, WINDOW, forConsole, loopOf, measure, shortlist, stretches } from './lib/moments.mjs';
import { av1Configuration, av1Frame, mp4 } from './lib/mp4.mjs';
import { namesOf, plainWebp, withCapture } from './lib/new-game.mjs';
import { originalButtons, readRecording } from './lib/recording.mjs';
import { referenceOf } from './lib/reference.mjs';
import { roomFor } from './lib/screens.mjs';

const USAGE = 'Usage: npm run dp -- capture <game> [--choose | --open | --pick | --from <file>] [--yes] [--repo <owner/name>]';
const CLIP_LIMIT = 1.4e6, CLIP_TARGET = 1.2e6;   // a clip's bytes: visitors download it when they select the game
// what plays the original, for the game's console
let machine, KEY, ensureOriginal, playOriginal, runOriginal, FRAME_SECONDS;
const IDLE_MS = 120_000;                         // this long since their last press, and they aren't using the window
const LONGEST_WAIT_MS = 900_000, WINDOW_MS = 60_000, CLOSING_MS = 300_000;
const MOST_FRAMES = 216_000;                     // an hour of play is more than a list of presses needs

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (response, value) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

const entryPath = game => join(gameFolder(game), 'entry.md');
const entryOf = game => readFileSync(entryPath(game), 'utf8');
const issueOf = game => Number(/^issue: (\d+)$/m.exec(entryOf(game))?.[1]);
const hasCapture = game => /^screen:/m.test(entryOf(game));
const captureBranch = game => branchFor(issueOf(game));
const keptIn = game => join(LOCAL, 'captures', game);
const windowFile = game => join(keptIn(game), 'window.json');

/** Names the capture in the game's entry, in place of any it had. */
function nameInEntry(game) {
  writeFileSync(entryPath(game), withCapture(entryOf(game), game));
}

// what was played: the buttons held at each frame as KEY bits, what `measure` says of each, and the moments found in them
function playedFor({ game, copy }) {
  const playFile = join(keptIn(game), 'play.json');
  const play = {
    buttons: [], frames: [],
    moments: [],            // { from, to, size, pictures }: the frames to choose among, the last of them not shown, and the size they show
    chosen: null,           // which of them the person pressed, if they did
    // the presses as a list of changes, which is all that has to be kept to see the same frames again
    keep() {
      const held = [];
      play.buttons.forEach((mask, frame) => { if (!frame || mask !== play.buttons[frame - 1]) held.push([frame, mask]); });
      mkdirSync(keptIn(game), { recursive: true });
      writeFileSync(playFile, `${JSON.stringify({ sha1: copy.sha1, frames: play.buttons.length, held, moments: play.moments.map(({ from, to }) => ({ from, to })), chosen: play.chosen })}\n`);
    },
    // the moments' pictures, which the original draws again from the presses, and a check that they're what was played
    async picturesOf(wanted) {
      const list = [...new Set(wanted.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i)))].sort((a, b) => a - b);
      const { pictures, outside } = await runOriginal({ copy: copy.path, frames: list[list.length - 1] + 1, buttons: play.buttons, pictures: list });
      play.sizes = outside.sizes ?? null;
      for (const frame of list) {
        if (play.frames[frame]?.hash !== measure(pictures.get(frame), null).hash) throw new Error(`The original didn't draw frame ${frame} the same way again, so these moments can't be trusted.`);
      }
      return pictures;
    },
    // a moment as it's kept, at the size it shows: a game that lists a larger size for another part keeps its pictures with
    // room for that one, and no band of black reaches its card
    momentOf({ from, to }, pictures) {
      return { from, to, size: (play.sizes && roomFor(play.sizes, from, to)) ?? machine.screen, pictures: Array.from({ length: to - from }, (_, i) => pictures.get(from + i)) };
    },
    async find() {
      const starts = shortlist(play.frames, play.buttons);
      play.moments = [];
      if (starts.length) {
        const pictures = await play.picturesOf(starts.map(from => ({ from, to: from + WINDOW - 1 })));
        play.moments = starts.map(start => play.momentOf(loopOf(frame => pictures.get(frame), start), pictures));
      }
      play.keep();
    },
    /** Reads what was kept and draws its moments again, and says whether there's anything to choose from. */
    async read() {
      if (!existsSync(playFile)) return false;
      const kept = JSON.parse(readFileSync(playFile, 'utf8'));
      if (kept.sha1 !== copy.sha1 || !kept.moments.length) return false;
      let at = 0, mask = 0;
      for (let frame = 0; frame < kept.frames; frame++) {
        if (kept.held[at]?.[0] === frame) mask = kept.held[at++][1];
        play.buttons.push(mask);
      }
      const pictures = await play.picturesOf(kept.moments);
      play.moments = kept.moments.map(moment => play.momentOf(moment, pictures));
      play.chosen = kept.chosen ?? null;
      return true;
    },
  };
  return play;
}

// the moment encoded and written where the site reads it, by the page that holds its pictures
async function keepMoment(page, game, moment, choice) {
  const encode = async codec => {
    const seconds = moment.pictures.length * FRAME_SECONDS;
    let bitrate = Math.round(Math.min(1_800_000, CLIP_TARGET * 8 / seconds) * (codec === 'av1' ? 0.75 : 1)), file;
    for (let tries = 0; tries < 4; tries++) {
      const video = await page.evaluate(`__capture.encode(${choice}, '${codec}', ${bitrate})`);
      const chunks = video.frames.map(f => ({ key: f.key, data: Buffer.from(f.data, 'base64') }));
      const description = codec === 'h264' ? Buffer.from(video.description, 'base64')
        : video.description ? Buffer.from(video.description, 'base64') : av1Configuration(chunks[0].data);
      file = mp4({
        width: video.width, height: video.height, description, av1: codec === 'av1',
        frames: codec === 'av1' ? chunks.map(c => ({ key: c.key, data: av1Frame(c.data) })) : chunks,
        timescale: machine.frame[1], duration: machine.frame[0],
      });
      if (file.length <= CLIP_LIMIT) break;
      bitrate = Math.round(bitrate * CLIP_TARGET / file.length);
    }
    return file;
  };
  const out = name => join(REPO, mediaPath(game, name));
  const h264 = await encode('h264'), av1 = await encode('av1');
  const still = plainWebp(Buffer.from(await page.evaluate(`__capture.still(${choice})`), 'base64'));
  const share = Buffer.from(await page.evaluate(`__capture.share(${choice})`), 'base64');
  writeFileSync(out('.h264.mp4'), h264);
  writeFileSync(out('.av1.mp4'), av1);
  writeFileSync(out('-still.webp'), still);
  writeFileSync(out('-share.png'), share);
  nameInEntry(game);
  console.log(`Kept ${(moment.pictures.length * FRAME_SECONDS).toFixed(1)} seconds, ${(h264.length / 1e6).toFixed(2)} MB, in public/media/${game}-dreamport.*, and games/${game}/entry.md names it.`);
}

const HOW = {
  chose: 'A person played their own copy of the original and chose this moment.',
  played: 'A person played their own copy of the original and didn\'t choose, so this is the moment the tool ranked first of what they played. Nobody has seen it yet.',
  agent: 'Nobody played, so a coding agent wrote the presses, and this is the moment the tool ranked first of what they led to. Nobody has seen it yet.',
};

// the capture as a pull request of its own, the game's card (lib/send.mjs)
function sendCapture({ game, original, repository }, how) {
  console.log(sendCard({ game, name: namesOf(original).name, issue: issueOf(game), repository, how: HOW[how], index: join(keptIn(game), 'send.index') }));
}

// a pull request with this game's capture that's waiting already, which means there's nothing more to do for it here
function waitingPull({ game, repository }) {
  try {
    return (api(`repos/${repository}/pulls?state=open&per_page=100`) ?? []).find(pull => pull.head.ref === captureBranch(game))?.html_url ?? null;
  } catch {
    return null;
  }
}

// what the window answers, if it's open
async function windowState(game) {
  if (!existsSync(windowFile(game))) return null;
  try {
    const { url } = JSON.parse(readFileSync(windowFile(game), 'utf8'));
    const response = await fetch(`${url}/capture/state`, { signal: AbortSignal.timeout(5000) });
    return response.ok ? { url, ...(await response.json()) } : null;
  } catch {
    return null;
  }
}

// the window in a process of its own, so that whoever started it goes on with their work
async function openWindow(session) {
  const { game, yes, repository } = session;
  if (hasCapture(game)) {
    console.log(`${game} has its capture already.`);
    return 0;
  }
  const waiting = waitingPull(session);
  if (waiting) {
    console.log(`${game}'s capture is waiting for its review: ${waiting}`);
    return 0;
  }
  if (await windowState(game)) {
    console.log('The window is open already.');
    return 0;
  }
  mkdirSync(keptIn(game), { recursive: true });
  const logFile = join(keptIn(game), 'window.log'), log = openSync(logFile, 'w');
  const child = spawn(process.execPath, [join(REPO, 'tools', 'dp.mjs'), 'capture', game, ...(yes ? ['--yes'] : []), ...(repository === UPSTREAM ? [] : ['--repo', repository])], {
    cwd: REPO, detached: true, stdio: ['ignore', log, log], windowsHide: true,
  });
  closeSync(log);
  let ended = false;
  child.once('exit', () => { ended = true; });
  child.unref();
  for (const giveUp = Date.now() + WINDOW_MS; Date.now() < giveUp && !ended; await wait(250)) {
    if (await windowState(game)) {
      console.log(`The window is open, and nothing waits for it. npm run dp -- capture ${game} --pick${yes ? ' --yes' : ''} ends it when the work is done.`);
      return 0;
    }
  }
  const why = readFileSync(logFile, 'utf8').trim().split('\n').pop();
  console.log(`No window could open here, which is fine: carry on. ${why}`);
  return 0;
}

// ends the window once nobody is using it
async function closeWindow(game) {
  let state = await windowState(game);
  if (!state) return;
  const giveUp = Date.now() + LONGEST_WAIT_MS;
  let said = false;
  while (state && state.idle < IDLE_MS && Date.now() < giveUp) {
    if (!said) console.log(`The window is open, so this waits until nobody has pressed anything for ${IDLE_MS / 60000} minutes.`);
    said = true;
    await wait(5000);
    state = await windowState(game);
  }
  if (!state) return;
  await fetch(`${state.url}/capture/stop`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  const closed = Date.now() + CLOSING_MS;
  while (existsSync(windowFile(game)) && Date.now() < closed) await wait(500);
}

// the first moment kept in a browser nobody sees, which has what encoding needs, and then sent
async function keepRanked(session, play, how) {
  const { game } = session;
  const choice = play.chosen ?? 0;
  const server = await serveRepository({ answer: answerer(session, play, { choosing: true }) });
  let page;
  try {
    page = await openChrome({ profile: join(LOCAL, 'chrome', 'capture-hidden'), headless: true });
    await go(page, `${server.url}/tools/capture/index.html`);
    await until(page, 'window.__capture?.loaded === true', 'the moments', 180_000);
    await keepMoment(page, game, play.moments[choice], choice);
  } finally {
    await page?.close();
    await server.close();
  }
  if (session.yes) sendCapture(session, how);
}

// when the work is done: what the person chose, or else the moment that ranks first of what they played
async function pick(session) {
  const { game } = session;
  await closeWindow(game);
  if (hasCapture(game)) {
    console.log(`${game} has its capture, as files in this folder until they're committed: public/media/${game}-dreamport.* and games/${game}/entry.md.`);
    return 0;
  }
  const waiting = waitingPull(session);
  if (waiting) {
    console.log(`${game}'s capture is waiting for its review: ${waiting}`);
    return 0;
  }
  const play = playedFor(session);
  if (!(await play.read())) {
    console.log(`Nobody played, or not enough to show, so there's nothing to pick from. Write presses that reach real play to ${relative(REPO, join(keptIn(game), 'presses.json'))}, as a recording has them, and run npm run dp -- capture ${game} --from that file.`);
    return 0;
  }
  await keepRanked(session, play, play.chosen === null ? 'played' : 'chose');
  return 0;
}

// when nobody played: the moment that ranks first of what a list of presses leads to, or that in numbers
async function fromPresses(session, file) {
  const { game, copy } = session;
  if (await windowState(game)) throw new Error(`The window is still open: npm run dp -- capture ${game} --pick ends it, and keeps what was played there.`);
  const recording = readRecording(file);
  const held = originalButtons(recording);
  if (held.length > MOST_FRAMES) throw new Error(`${file}: that's ${held.length} frames, and a few minutes of play is enough.`);
  const masks = held.map(names => names.reduce((mask, button) => {
    if (!KEY[button]) throw new Error(`${file}: "${button}" isn't one of the console's buttons, which are ${Object.keys(KEY).join(', ')}.`);
    return mask | KEY[button];
  }, 0));
  const play = playedFor(session), live = playOriginal(copy.path);
  try {
    let last = null;
    for (const mask of masks) {
      const { picture } = await live.frame(mask);
      play.buttons.push(mask);
      play.frames.push(measure(picture, last));
      last = picture;
    }
  } finally {
    live.end();
  }
  await play.find();
  if (!play.moments.length) {
    console.log(`Those ${masks.length} frames have no moment to show. One needs ${Math.ceil(WINDOW / 60)} seconds of play with buttons held at least a fifth of the time, something moving, ${FEW_COLOURS} colours or more, and no fade or change of screen. What they led to:`);
    for (const { from, moved, colours, held: share } of stretches(play.frames, play.buttons)) {
      console.log(`  from frame ${from}: ${(moved * 100).toFixed(1)}% of the screen moving, ${Math.round(colours)} colours, buttons held ${Math.round(share * 100)}% of the time`);
    }
    return 0;
  }
  await keepRanked(session, play, 'agent');
  return 0;
}

// what the page asks of the tool
function answerer({ original }, play, { live = null, choosing = false, touch = () => {}, idle = () => 0, choose = () => {}, stop = () => {} }) {
  let last = null;          // the frame before, to see what moved
  const allButtons = Object.values(KEY).reduce((all, bit) => all | bit, 0);
  return async (request, response, path) => {
    if (!path.startsWith('/capture/')) return false;
    const step = path.slice('/capture/'.length);
    if (step === 'console') {
      json(response, { id: machine.id, screen: machine.screen, frame: machine.frame, sound: machine.sound, keys: KEY });
    } else if (step === 'about') {
      json(response, { name: original.name, choosing });
    } else if (step === 'state') {
      json(response, { idle: idle() });
    } else if (step === 'stop') {
      json(response, true);
      stop();
    } else if (step === 'frame') {
      const mask = Number(new URL(request.url, 'http://localhost').searchParams.get('buttons')) & allButtons;
      try {
        const { picture, sound } = await live.frame(mask);
        if (mask !== (play.buttons[play.buttons.length - 1] ?? 0)) touch();
        play.buttons.push(mask);
        play.frames.push(measure(picture, last));
        last = picture;
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(Buffer.concat([Buffer.from(picture.buffer), sound]));
      } catch (error) {
        response.writeHead(500);
        response.end(error.message);
      }
    } else if (step === 'finish') {
      touch();
      await play.find();
      json(response, play.moments.map(m => ({ frames: m.pictures.length, size: m.size })));
    } else if (step === 'moments') {
      json(response, play.moments.map(m => ({ frames: m.pictures.length, size: m.size })));
    } else if (step.startsWith('moment/')) {
      const moment = play.moments[Number(step.slice('moment/'.length))];
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      for (const picture of moment.pictures) response.write(Buffer.from(picture.buffer, picture.byteOffset, picture.byteLength));
      response.end();
    } else if (step.startsWith('choose/')) {
      json(response, true);
      choose(Number(step.slice('choose/'.length)));
    } else {
      return false;
    }
    return true;
  };
}

// the window: the person plays and chooses, or with --choose only chooses
async function inWindow(session, again) {
  const { game, copy, original, yes } = session;
  const play = playedFor(session);
  if (again && !(await play.read())) throw new Error(`Nothing played yet to choose from: npm run dp -- capture ${game} plays it first.`);
  const live = again ? null : playOriginal(copy.path);
  let touched = Date.now(), choose, stop;
  const chosen = new Promise(resolve => { choose = resolve; });
  const stopped = new Promise(resolve => { stop = () => resolve(null); });
  const server = await serveRepository({
    answer: answerer(session, play, { live, choosing: again, choose, stop, touch: () => { touched = Date.now(); }, idle: () => Date.now() - touched }),
  });
  let page;
  try {
    page = await openChrome({ profile: join(LOCAL, 'chrome', 'capture'), headless: false, controllers: true });
    await go(page, `${server.url}/tools/capture/index.html`);
    mkdirSync(keptIn(game), { recursive: true });
    writeFileSync(windowFile(game), `${JSON.stringify({ url: server.url })}\n`);
    console.log(again ? 'Choose the moment you want in the browser window.'
      : `Play ${original.name} in the browser window, then press Finish. The best moments come up for you to choose from. No picture leaves this computer unless you send it.`);
    const choice = await Promise.race([chosen, page.closed.then(() => null), stopped]);
    if (choice === null) {
      await page.close();
      if (!again && play.buttons.length) {
        await play.find();
        console.log(play.moments.length ? `The window closed before you chose. npm run dp -- capture ${game} --choose shows the same moments again.`
          : `The window closed with no moments to choose from yet. Move around more next time, for at least ${Math.ceil(WINDOW / 60)} seconds of play.`);
      } else console.log('The window closed before you chose, so nothing changed.');
      return 0;
    }
    play.chosen = choice;
    play.keep();
    await keepMoment(page, game, play.moments[choice], choice);
    await page.evaluate('__capture.kept()');
    await wait(1500);
    if (yes) sendCapture(session, 'chose');
    return 0;
  } finally {
    rmSync(windowFile(game), { force: true });
    live?.end();
    await page?.close();
    await server.close();
  }
}

function options(args) {
  const found = { repository: UPSTREAM, yes: false, mode: 'window', file: null, game: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo') found.repository = args[++i];
    else if (arg === '--from') { found.mode = 'from'; found.file = args[++i]; }
    else if (arg === '--yes') found.yes = true;
    else if (arg === '--choose' || arg === '--open' || arg === '--pick') found.mode = arg.slice(2);
    else if (arg.startsWith('--') || found.game) throw new Error(USAGE);
    else found.game = arg;
  }
  if (!found.game || !found.repository || (found.mode === 'from' && !found.file)) throw new Error(USAGE);
  return found;
}

export async function run(args) {
  const { game, mode, file, yes, repository } = options(args);
  const original = readOriginal(game);
  ({ machine, KEY, ensureOriginal, playOriginal, runOriginal } = await referenceOf(original));
  FRAME_SECONDS = machine.frame[0] / machine.frame[1];
  forConsole({ screen: machine.screen, keys: machine.keys });
  const copy = copyOf(game, original.sha1);
  if (!copy) throw new Error(`Show the tools your copy of ${original.name} first: npm run dp -- rom <file>.`);
  if (!existsSync(entryPath(game))) throw new Error(`games/${game}/ has no entry.md yet, which the capture is named in.`);
  ensureOriginal(console.log);
  const session = { game, original, copy, yes, repository };
  if (mode === 'open') return openWindow(session);
  if (mode === 'pick') return pick(session);
  if (mode === 'from') return fromPresses(session, file);
  return inWindow(session, mode === 'choose');
}
