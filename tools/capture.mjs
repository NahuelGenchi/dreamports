// npm run dp -- capture <game> [--choose]: a real moment of the game for its card in the launcher. It opens a window
// where the person plays their own copy of the original, on this computer, from power-on. When they finish it shows the
// best moments of what they played, moving, and they press the one they want, which is written as public/media/
// <game>-dreamport.h264.mp4, .av1.mp4, -still.webp and -share.png and named in the game's entry. Their presses stay in
// .dreamports/captures/<game>/, so that --choose can show the same moments again with no more playing, or if the window
// closed before they chose. Nothing is sent anywhere.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder } from './lib/paths.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { copyOf } from './lib/copies.mjs';
import { serveRepository } from './lib/server.mjs';
import { go, openChrome } from './lib/chrome.mjs';
import { WINDOW, loopOf, measure, shortlist } from './lib/moments.mjs';
import { av1Configuration, av1Frame, mp4 } from './lib/mp4.mjs';
import { plainWebp, withCapture } from './lib/new-game.mjs';
import { ensureOriginal, playOriginal, runOriginal } from './gba/original.mjs';

const CLIP_LIMIT = 1.4e6, CLIP_TARGET = 1.2e6;   // a clip's bytes: visitors download it when they select the game
const FRAME_SECONDS = 280896 / 16777216;

const json = (response, value) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

/** Names the capture in the game's entry, in place of any it had. */
function nameInEntry(game) {
  const file = join(gameFolder(game), 'entry.md');
  writeFileSync(file, withCapture(readFileSync(file, 'utf8'), game));
}

export async function run(args) {
  const game = args.find(a => !a.startsWith('--'));
  const again = args.includes('--choose');
  if (!game) throw new Error('Usage: npm run dp -- capture <game> [--choose]');
  const original = readOriginal(game);
  const copy = copyOf(game, original.sha1);
  if (!copy) throw new Error(`Show the tools your copy of ${original.name} first: npm run dp -- rom <file>.`);
  if (!existsSync(join(gameFolder(game), 'entry.md'))) throw new Error(`games/${game}/ has no entry.md yet, which the capture is named in.`);
  ensureOriginal(console.log);

  const kept = join(LOCAL, 'captures', game);
  const playFile = join(kept, 'play.json');
  const buttons = [];       // the buttons held at each frame, as KEY bits
  const frames = [];        // what measure says of each frame
  let moments = [];         // { from, to, pictures }: the frames to choose among, the last of them not shown
  let last = null;          // the frame before, to see what moved
  let live = null;
  let choose;
  const chosen = new Promise(resolve => { choose = resolve; });

  // the presses as a list of changes, which is all that has to be kept to see the same frames again
  const keepPlay = () => {
    const held = [];
    buttons.forEach((mask, frame) => { if (!frame || mask !== buttons[frame - 1]) held.push([frame, mask]); });
    mkdirSync(kept, { recursive: true });
    writeFileSync(playFile, `${JSON.stringify({ sha1: copy.sha1, frames: buttons.length, held, moments: moments.map(({ from, to }) => ({ from, to })) })}\n`);
  };

  // the moments' pictures, which the original draws again from the presses, and a check that they're what was played
  const picturesOf = async wanted => {
    const list = [...new Set(wanted.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i)))].sort((a, b) => a - b);
    const { hashes, pictures } = await runOriginal({ copy: copy.path, frames: list[list.length - 1] + 1, buttons, pictures: list });
    frames.forEach((f, frame) => {
      if (frame < hashes.length && f.hash !== hashes[frame]) throw new Error(`The original didn't draw frame ${frame} the same way again, so these moments can't be trusted.`);
    });
    return pictures;
  };

  const findMoments = async () => {
    const starts = shortlist(frames, buttons);
    moments = [];
    if (starts.length) {
      const pictures = await picturesOf(starts.map(from => ({ from, to: from + WINDOW - 1 })));
      moments = starts.map(start => {
        const { from, to } = loopOf(frame => pictures.get(frame), start);
        return { from, to, pictures: Array.from({ length: to - from }, (_, i) => pictures.get(from + i)) };
      });
    }
    keepPlay();
  };

  const answer = async (request, response, path) => {
    if (!path.startsWith('/capture/')) return false;
    const step = path.slice('/capture/'.length);
    if (step === 'about') {
      json(response, { name: original.name, choosing: again });
    } else if (step === 'frame') {
      const mask = Number(new URL(request.url, 'http://localhost').searchParams.get('buttons')) & 0x3FF;
      try {
        const { picture, sound } = await live.frame(mask);
        buttons.push(mask);
        frames.push(measure(picture, last));
        last = picture;
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(Buffer.concat([Buffer.from(picture.buffer), sound]));
      } catch (error) {
        response.writeHead(500);
        response.end(error.message);
      }
    } else if (step === 'finish') {
      await findMoments();
      json(response, moments.map(m => m.pictures.length));
    } else if (step === 'moments') {
      json(response, moments.map(m => m.pictures.length));
    } else if (step.startsWith('moment/')) {
      const moment = moments[Number(step.slice('moment/'.length))];
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      for (const picture of moment.pictures) response.write(Buffer.from(picture.buffer));
      response.end();
    } else if (step.startsWith('choose/')) {
      json(response, true);
      choose(Number(step.slice('choose/'.length)));
    } else {
      return false;
    }
    return true;
  };

  if (again) {
    if (!existsSync(playFile)) throw new Error(`Nothing played yet: npm run dp -- capture ${game} plays it first.`);
    const play = JSON.parse(readFileSync(playFile, 'utf8'));
    if (play.sha1 !== copy.sha1) throw new Error(`What was played used another copy of the game, so its moments can't be drawn again: npm run dp -- capture ${game} plays it again.`);
    let at = 0, mask = 0;
    for (let frame = 0; frame < play.frames; frame++) {
      if (play.held[at]?.[0] === frame) mask = play.held[at++][1];
      buttons.push(mask);
    }
    if (!play.moments.length) throw new Error(`What was played has no moments to choose from: npm run dp -- capture ${game} plays it again.`);
    const pictures = await picturesOf(play.moments);
    moments = play.moments.map(({ from, to }) => ({ from, to, pictures: Array.from({ length: to - from }, (_, i) => pictures.get(from + i)) }));
  } else {
    live = playOriginal(copy.path);
  }

  const server = await serveRepository({ answer });
  let page, choice = null;
  try {
    page = await openChrome({ profile: join(LOCAL, 'chrome', 'capture'), headless: false, controllers: true });
    await go(page, `${server.url}/tools/capture/index.html`);
    console.log(again ? 'Choose the moment you want in the browser window.'
      : `Play ${original.name} in the browser window, then press Finish. The best moments come up for you to choose from. No picture leaves this computer unless you send it.`);
    choice = await Promise.race([chosen, page.closed.then(() => null)]);
    if (choice === null) {
      if (!again && buttons.length) {
        await findMoments();
        console.log(moments.length ? `The window closed before you chose. npm run dp -- capture ${game} --choose shows the same moments again.`
          : `The window closed with no moments to choose from yet. Move around more next time, for at least ${Math.ceil(WINDOW / 60)} seconds of play.`);
      } else console.log('The window closed before you chose, so nothing changed.');
      return 0;
    }
    const moment = moments[choice];
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
          timescale: 16777216, duration: 280896,
        });
        if (file.length <= CLIP_LIMIT) break;
        bitrate = Math.round(bitrate * CLIP_TARGET / file.length);
      }
      return file;
    };
    const out = name => join(REPO, 'public', 'media', `${game}-dreamport${name}`);
    const h264 = await encode('h264'), av1 = await encode('av1');
    const still = plainWebp(Buffer.from(await page.evaluate(`__capture.still(${choice})`), 'base64'));
    const share = Buffer.from(await page.evaluate(`__capture.share(${choice})`), 'base64');
    writeFileSync(out('.h264.mp4'), h264);
    writeFileSync(out('.av1.mp4'), av1);
    writeFileSync(out('-still.webp'), still);
    writeFileSync(out('-share.png'), share);
    nameInEntry(game);
    console.log(`Kept ${(moment.pictures.length * FRAME_SECONDS).toFixed(1)} seconds, ${(h264.length / 1e6).toFixed(2)} MB, in public/media/${game}-dreamport.*, and games/${game}/entry.md names it.`);
    await page.evaluate('__capture.kept()');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return 0;
  } finally {
    live?.end();
    await page?.close();
    await server.close();
  }
}
