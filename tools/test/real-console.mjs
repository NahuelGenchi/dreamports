// npm run test:real-console: the proof tools on a real emulator of a console that isn't the Game Boy Advance, FCEUmm for
// the NES, built as it's built on a contributor's computer, at the commit tools/consoles.mjs fixes. It runs a small program
// written here (made-up-nes.mjs), with a Dreamport of that program in a folder of its own that it removes after, so no
// game's copy is needed. What any-console.mjs can't show, as its emulator was written for it, is shown here: a real console's
// power-on, timing, picture and sound, the settings that keep them the same for everyone, and `play`.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { connect, findChrome, until } from '../lib/chrome.mjs';
import { CHR_AT, PALETTE, PALETTE_AT, RAM, START, TIMER, madeUpNes } from './made-up-nes.mjs';

const GAME = 'test-real-nes';
const WORK = join(LOCAL, 'test-real-console');
const RESULTS = join(LOCAL, 'results', GAME);
const CAPTURES = join(LOCAL, 'captures', GAME);
const COPIES = join(LOCAL, 'copies.json');
const README = join(REPO, 'README.md');
const MAP = join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`);
const MEDIA = join(REPO, 'public', 'media');
const PROGRESS = join(proofFolder(GAME), 'progress.json');

// the emulator's colours for those the program uses, in the console's numbers, as the tools read them: red in the low bits
const SHOWN = { 0x00: 0x39CE, 0x04: 0x3811, 0x0A: 0x0140, 0x0F: 0x0000, 0x12: 0x74E4, 0x14: 0x5C17, 0x16: 0x00BB, 0x18: 0x01D1, 0x1A: 0x02A0, 0x21: 0x7EE7, 0x22: 0x7E4B, 0x24: 0x7DFE, 0x27: 0x1E7F, 0x2A: 0x2769, 0x30: 0x7FFF, 0x32: 0x7F58 };
// how long the console takes from power-on: its first frames are grey, then it shows its backdrop, then its background, then the sprite
const GREY_UNTIL = 2, BACKGROUND_AT = 3, SPRITE_AT = 4, PLAYS_FROM = 5;
// how far each wave swings, as the emulator mixes them with its settings, a step of the triangle's being one of 15
const PULSE = 0.215, TRIANGLE = 0.023;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

const dpWith = (env, ...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26, env: { ...process.env, ...env } });
  return { status, out: stdout + stderr };
};
const dp = (...args) => dpWith({}, ...args);
const report = recording => JSON.parse(readFileSync(join(resultFolder(GAME, recording), 'report.json'), 'utf8'));
// a report by what it says: not how long it took, how large the browser's clip came out, or what changed since the last run
const meaning = recording => {
  const { seconds, sinceLastProven, clip: { bytes, bitrate, dreamport, ...clip }, ...rest } = report(recording);
  return JSON.stringify({ ...rest, clip });
};
const lastLine = ({ out }) => out.trim().split('\n').at(-1);

// a Dreamport of the program, as one is written: what it does each frame, and its picture and sound, with the tiles and colours
// read from the player's copy. `moved` and `loud` make one that differs from it somewhere
const GAME_CODE = ({ moved = 1, loud = 1 } = {}) => `function createGame() {
  const SHOWN = ${JSON.stringify(SHOWN)};
  const paint = number => { const c = SHOWN[number]; return (0xFF000000 | (c >> 10 & 31) << 19 | (c >> 5 & 31) << 11 | (c & 31) << 3) >>> 0; };
  const tiles = rom.subarray(${CHR_AT}), palette = rom.subarray(${PALETTE_AT}, ${PALETTE_AT + PALETTE.length});
  const later = new URLSearchParams(location.search).get('scroll');
  let frame = later === null ? 0 : ${PLAYS_FROM}, scroll = Number(later), x = ${START.x}, y = ${START.y}, backdrop = ${START.backdrop}, a = false, b = false;
  // the two waves as the console mixes them, only ever above zero, and the emulator's filter that takes away what's left at zero
  // over the next fraction of a second, so a note that stops thumps
  let up = 0, along = 0, slow = 15 * ${TRIANGLE}, slower = 0;
  proof?.listen((left, right) => {
    for (let i = 0; i < left.length; i++) {
      up = (up + 1789773 / (16 * ${TIMER + 1}) / 48000) % 1;
      if (b) along = (along + 1789773 / (32 * ${TIMER + 1}) / 48000) % 1;
      const step = Math.floor(along * 32);
      const level = (a && up < 0.5 ? ${PULSE} * ${loud} : 0) + ${TRIANGLE} * (step < 16 ? 15 - step : step - 16);
      slow += (level - slow) * 94 / 48000;
      slower += (level - slow - slower) * 24 / 48000;
      left[i] = right[i] = slow - level + slower;
    }
  }, 48000, 89342 / 5369318);
  return {
    step() {
      if (frame < ${PLAYS_FROM}) return;
      if (input.right) x = (x + ${moved}) & 255;
      if (input.left) x = (x - 1) & 255;
      if (input.down) y = (y + 1) & 255;
      if (input.up) y = (y - 1) & 255;
      backdrop = input.start ? ${START.pressedBackdrop} : ${START.backdrop};
      if (!input.select) scroll = (scroll + 1) & 255;
      a = input.a;
      b = input.b;
    },
    draw(pixels) {
      if (frame < ${BACKGROUND_AT}) pixels.fill(paint(frame < ${GREY_UNTIL} ? 0 : backdrop));
      else {
        for (let line = 0; line < 240; line++) {
          const row = line >> 3;
          for (let column = 0; column < 256; column++) {
            const along = (column + scroll) & 255, at = (((along >> 3) + row) & 3) * 16 + (line & 7), bit = 7 - (along & 7);
            const colour = (tiles[at] >> bit & 1) | (tiles[at + 8] >> bit & 1) << 1;
            pixels[line * 256 + column] = paint(colour ? palette[((along >> 4 & 1) | (row >> 1 & 1) << 1) * 4 + colour] : backdrop);
          }
        }
      }
      if (frame >= ${SPRITE_AT}) {
        for (let row = 0; row < 8; row++) {
          for (let column = 0; column < 8; column++) {
            const line = y + 1 + row, bit = 7 - column, at = ${START.sprite} * 16 + row;
            const colour = (tiles[at] >> bit & 1) | (tiles[at + 8] >> bit & 1) << 1;
            if (colour && line < 240 && x + column < 256) pixels[line * 256 + x + column] = paint(palette[16 + colour]);
          }
        }
      }
      frame++;
    },
  };
}`;

function writeGame(code) {
  const path = join(gameFolder(GAME), 'src', 'main.js');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/function createGame\(\) \{[^]*?\n\}\n/, `${code}\n`));
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  for (const path of [gameFolder(GAME), WORK, RESULTS, CAPTURES, MAP, ...kept]) rmSync(path, { recursive: true, force: true });
}

const pressKey = (page, code, type) => page.send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: 0 });

// `play --record` as a person uses it, in a browser with no window to show: it presses Play, holds some keys, and closes it
async function playAndRecord(name) {
  const wrapper = join(WORK, 'chrome-with-no-window.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${findChrome()}" --headless=new --mute-audio --disable-gpu "$@"\n`, { mode: 0o755 });
  const tool = spawn(process.execPath, [join(REPO, 'tools', 'dp.mjs'), 'play', GAME, '--record', name], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CHROME: wrapper, DISPLAY: process.env.DISPLAY ?? ':99' } });
  let said = '';
  tool.stdout.on('data', chunk => { said += chunk; });
  tool.stderr.on('data', chunk => { said += chunk; });
  const ended = new Promise(resolve => tool.once('close', resolve));
  const portFile = join(LOCAL, 'chrome', 'record', 'DevToolsActivePort');
  const give = Date.now() + 60000;
  let page = null, port = null;
  while (!page && Date.now() < give) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      [port] = readFileSync(portFile, 'utf8').split('\n');
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { headers: { connection: 'close' } })).json()).find(t => t.type === 'page' && t.url.includes(`/games/${GAME}/`));
      if (target) page = await connect(target.webSocketDebuggerUrl);
    } catch {
      // not there yet
    }
  }
  if (!page) return { ok: false, said: `${said}No browser.` };
  await page.send('Runtime.enable');
  await until(page, `document.querySelector('.play') && !document.querySelector('.play').disabled`, 'Play to be ready');
  await page.evaluate(`document.querySelector('.play').click()`);
  const reached = frames => until(page, `dreamportsProof.frames.length >= ${frames}`, `frame ${frames}`, 30000);
  await reached(30);
  await pressKey(page, 'ArrowRight', 'rawKeyDown');
  await reached(50);
  await pressKey(page, 'ArrowRight', 'keyUp');
  await pressKey(page, 'KeyZ', 'rawKeyDown');
  await reached(70);
  await pressKey(page, 'KeyZ', 'keyUp');
  await reached(90);
  // the tool reads the page a few times a second, and what it hasn't read when the window closes is gone
  await new Promise(resolve => setTimeout(resolve, 600));
  const browser = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`, { headers: { connection: 'close' } })).json()).webSocketDebuggerUrl);
  await browser.send('Browser.close').catch(() => {});
  await ended;
  return { ok: tool.exitCode === 0, said };
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });
  const { rom, sha1 } = madeUpNes();
  const copy = join(WORK, 'program.nes');
  writeFileSync(copy, rom);

  console.log('A small program on the NES\'s real emulator');
  const original = { console: 'nes', name: 'Test Real NES (World)', title: 'program', code: '', sha1 };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the copy by its header: ${run.out.trim().split('\n')[1]?.trim()}`);

  const list = join(WORK, 'functions.csv');
  writeFileSync(list, 'Address,Size\n0xC000,64\n0xC040,32\n');
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0 && run.out.includes('2 functions'), `codemap takes a list: ${lastLine(run)}`);

  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  const recording = (name, value) => writeFileSync(join(proofFolder(GAME), 'recordings', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  const held = [[0, []], [60, ['A']], [80, []], [100, ['B']], [120, []], [140, ['RIGHT']], [150, ['DOWN']], [160, ['LEFT']], [165, ['UP']], [170, ['START']], [180, ['SELECT']], [190, []]];
  recording('buttons', { about: 'Each button, then none.', frames: 240, held });
  // the program's scroll, set in its work memory as the console has just started playing, and the Dreamport starts there
  recording('later', { about: 'From later on.', start: 'scroll=50', frames: 60, held: [[0, []]], onlyInOriginal: [{ at: 0, frames: PLAYS_FROM + 1, held: [[0, []]], sets: [{ frame: PLAYS_FROM, address: RAM.scroll.toString(16).padStart(8, '0'), bytes: 1, value: 49 }] }] });

  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference?.frame === 0, `what new writes opens and plays at the console's screen, and differs at once, being only one colour: ${JSON.stringify(report('buttons').firstDifference)}`);

  writeGame(GAME_CODE());
  run = dp('prove', GAME, 'buttons');
  const same = report('buttons');
  check(run.status === 0 && same.matched === 240 && same.sound.heard, `every frame of the picture and the sound matches: ${same.matched} of ${same.frames}, ${JSON.stringify(same.firstDifference)}, ${JSON.stringify(same.sound.firstDifference)}`);
  if (run.status) console.log(run.out);
  const said = meaning('buttons'), progress = readFileSync(PROGRESS);
  run = dp('prove', GAME, 'buttons');
  check(run.status === 0 && meaning('buttons') === said && progress.equals(readFileSync(PROGRESS)), 'the same recording gives the same result again, in its report and in progress.json');

  run = dp('prove', GAME, 'later');
  check(run.status === 0 && report('later').matched === 60, `a start point writes to the console's work memory, and matches from there: ${report('later').matched} of ${report('later').frames}`);
  if (run.status) console.log(run.out);

  run = dp('prove', GAME, 'later', '--quick', '--state', '10');
  check(run.status === 0 && run.out.includes("can't be compared"), 'prove --state says it can\'t compare what this console holds, and still compares the rest');

  writeGame(GAME_CODE({ moved: 2 }));
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').firstPictureDifference === undefined && report('buttons').firstDifference?.frame === 140, `a sprite that moves too far is found where it first shows, at frame 140: ${JSON.stringify(report('buttons').firstDifference)}`);
  writeGame(GAME_CODE({ loud: 0 }));
  run = dp('prove', GAME, 'buttons');
  const silent = report('buttons');
  check(run.status !== 0 && !silent.firstPictureDifference && Math.abs(silent.sound.firstDifference?.frame - 60) <= 16, `a sound that's missing, with the right picture, is found near frame 60: ${silent.sound.firstDifference?.frame}`);
  writeGame(GAME_CODE({ loud: 8 }));
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').sound.firstDifference?.dB > 10, `one far too loud is found too: ${report('buttons').sound.firstDifference?.dB} dB`);
  writeGame(GAME_CODE());

  const presses = join(WORK, 'presses.json');
  const holding = Array.from({ length: 30 }, (_, i) => [i * 30, i % 2 ? [] : [['RIGHT'], ['DOWN'], ['LEFT'], ['UP']][(i >> 1) % 4]]);
  writeFileSync(presses, `${JSON.stringify({ frames: 900, held: holding }, null, 2)}\n`);
  run = dp('capture', GAME, '--from', presses);
  check(run.status === 0, `capture plays presses along with the emulator: ${lastLine(run)}`);
  if (run.status) console.log(run.out);

  if (process.platform !== 'win32') {
    const played = await playAndRecord('played');
    const written = join(proofFolder(GAME), 'recordings', 'played.json');
    check(played.ok && existsSync(written), `play --record writes what the keys held: ${lastLine({ out: played.said })}`);
    if (existsSync(written)) {
      const { frames, held: kept } = JSON.parse(readFileSync(written, 'utf8'));
      const buttons = new Set(kept.flatMap(([, list]) => list));
      check(frames >= 90 && buttons.has('RIGHT') && buttons.has('A'), `by the console's names, over ${frames} frames: ${[...buttons].join(', ')}`);
      run = dp('prove', GAME, 'played');
      const proven = report('played');
      check(run.status === 0 && proven.matched === frames, `and that recording matches in the emulator: ${proven.matched} of ${frames}`);
      if (run.status) console.log(run.out);
      const first = meaning('played');
      run = dp('prove', GAME, 'played');
      check(run.status === 0 && meaning('played') === first, 'the same again');
    }
  }

  // the same copy under a name that means something to the emulator, in a folder that does too
  const named = join(WORK, 'Games (a)', 'program (E).nes');
  mkdirSync(join(named, '..'), { recursive: true });
  writeFileSync(named, rom);
  dp('rom', named);
  run = dp('prove', GAME, 'buttons');
  check(run.status === 0 && meaning('buttons') === said, `what the copy's file is called changes nothing, though the emulator looks in it: ${report('buttons').matched} of ${report('buttons').frames}`);

  const european = join(WORK, 'european.nes'), pal = madeUpNes({ pal: true });
  writeFileSync(european, pal.rom);
  rmSync(join(proofFolder(GAME), 'code-map.json'));
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, sha1: pal.sha1 }, null, 2)}\n`);
  dp('rom', european);
  run = dp('prove', GAME, 'later', '--quick');
  check(run.status !== 0 && /frames a second/.test(run.out), `a European copy, which runs at another speed, is told apart: ${run.out.trim().split('\n').find(line => line.includes('frames a second'))?.trim()}`);
}

const kept = { readme: readFileSync(README), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'README.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  await main();
} finally {
  tidy();
  writeFileSync(README, kept.readme);
  if (kept.copies) writeFileSync(COPIES, kept.copies);
  else rmSync(COPIES, { force: true });
}
check(untouched() === dirtyBefore, 'nothing is left behind');

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
