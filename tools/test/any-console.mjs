// npm run test:consoles: everything the proof tools do on a console that isn't the Game Boy Advance, from showing them a
// copy to keeping a game's capture. It runs on a console that was never made, with a small emulator of it written here
// (made-up-core.c) that the tools drive as they drive any libretro core, and a game made for it in a folder of its own
// that it removes after, so it needs nothing from any game and nothing from anyone else, and runs on any pull request.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { createHash } from 'node:crypto';

const GAME = 'test-made-up';
const WORK = join(LOCAL, 'test-consoles');
const RESULTS = join(LOCAL, 'results', GAME);
const CAPTURES = join(LOCAL, 'captures', GAME);
const COPIES = join(LOCAL, 'copies.json');
const README = join(REPO, 'README.md');
const MAP = join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`);
const MEDIA = join(REPO, 'public', 'media');

// what its cartridge holds: a colour for no button, A, B and Start, then its bar's
const COLOURS = [0x001F, 0x07E0, 0xF800, 0xFFFF, 0x0000, 0, 0, 0];

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
const lastLine = ({ out }) => out.trim().split('\n').at(-1);

// the game's own code, which does what the made-up console's cartridge says, as a Dreamport does what its original does.
// `change` makes a game that differs from it somewhere
const GAME_CODE = ({ colourB = 'colours[2]', loud = '0.5' } = {}) => `function createGame() {
  const colours = Array.from(new Uint16Array(rom.buffer.slice(6, 22)));
  let frame = Number(new URLSearchParams(location.search).get('later')), pressed = -1, phase = 0;
  proof?.listen((left, right) => {
    for (let i = 0; i < left.length; i++, phase++) left[i] = right[i] = pressed < 0 ? 0 : Math.floor(phase * 880 / 44100) % 2 ? ${loud} : -(${loud});
  }, 44100, 1 / 50);
  const paint = colour => 0xFF000000 | (colour & 31) << 19 | (colour >> 6 & 31) << 11 | (colour >> 11 & 31) << 3;
  return {
    step() { pressed = input.a ? 1 : input.b ? 2 : input.start ? 3 : -1; },
    draw(pixels) {
      const bar = paint(colours[4]);
      const shown = pressed === 2 ? ${colourB} : colours[pressed < 0 ? 0 : pressed];
      for (let y = 0; y < 48; y++) pixels.fill(paint(shown ^ y % 12), y * 64, (y + 1) * 64);
      for (let y = 0; y < 48; y++) pixels[y * 64 + frame % 64] = bar;
      frame++;
    },
  };
}`;

function writeGame(code) {
  const path = join(gameFolder(GAME), 'src', 'main.js');
  const text = readFileSync(path, 'utf8').replace(/function createGame\(\) \{[^]*?\n\}\n/, `${code}\n`);
  writeFileSync(path, text);
}

const browserLeft = () => spawnSync('ps', ['-Awwo', 'args='], { encoding: 'utf8' }).stdout.includes(`--user-data-dir=${join(LOCAL, 'chrome', 'prove')} `);
// starts prove on a recording long enough to be stopped, and stops it once its browser is up, and gives it a moment to go
async function stopPartway(signal) {
  const tool = spawn(process.execPath, [join(REPO, 'tools', 'dp.mjs'), 'prove', GAME, 'buttons'], { cwd: REPO, stdio: 'ignore' });
  const ended = new Promise(resolve => tool.once('exit', resolve));
  while (!browserLeft()) await new Promise(resolve => setTimeout(resolve, 20));
  tool.kill(signal);
  await ended;
  await new Promise(resolve => setTimeout(resolve, 1000));
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  for (const path of [gameFolder(GAME), WORK, RESULTS, CAPTURES, MAP, ...kept]) rmSync(path, { recursive: true, force: true });
}

async function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });
  const cartridge = Buffer.concat([Buffer.from('MADEUP'), Buffer.from(new Uint16Array(COLOURS).buffer)]);
  const sha1 = createHash('sha1').update(cartridge).digest('hex');
  const copy = join(WORK, 'game.mu');
  writeFileSync(copy, cartridge);

  console.log('A game on a console that was never made');
  const original = { console: 'made-up', name: 'Test Made Up (World)', title: 'MADEUP', code: 'MU', sha1 };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);

  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the copy by what it holds, with no word about its console: ${run.out.trim().split('\n')[0]}`);
  run = dp('codemap', GAME);
  check(run.status !== 0 && run.out.includes('--from'), 'codemap asks for a list of functions, as it can only find them in Game Boy Advance code');
  const list = join(WORK, 'functions.csv');
  writeFileSync(list, 'Address,Size\n0x1000,64\n0x1040,32\n');
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0 && run.out.includes('2 functions'), `codemap takes a list: ${lastLine(run)}`);
  run = dp('read', GAME, '0x1000');
  check(run.status !== 0 && run.out.includes('disassembler'), 'read says it only knows the Game Boy Advance\'s instructions');

  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  const held = [[0, []], [60, ['A']], [80, []], [120, ['B']], [140, []], [180, ['START']], [200, []]];
  const recording = { about: 'Each button, then none.', frames: 260, held };
  writeFileSync(join(proofFolder(GAME), 'recordings', 'buttons.json'), `${JSON.stringify(recording, null, 2)}\n`);
  writeFileSync(join(proofFolder(GAME), 'recordings', 'later.json'), `${JSON.stringify({ about: 'From later on.', start: 'later=501', frames: 40, held: [[0, []]], onlyInOriginal: [{ at: 0, frames: 1, held: [[0, []]], sets: [{ frame: 0, address: '00000000', bytes: 4, value: 500 }] }] }, null, 2)}\n`);
  writeFileSync(join(proofFolder(GAME), 'parts.json'), `${JSON.stringify({ about: 'The game\'s one part.', parts: [{ name: 'All of it', recording: 'buttons', frames: [0, 259] }] }, null, 2)}\n`);

  check(files['src/main.js'].includes(`/dreamports/${GAME}-dreamport/`), 'what new writes links to the game\'s page');
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference?.frame === 0, `what new writes opens and plays, and differs at once, being only one colour: ${JSON.stringify(report('buttons').firstDifference)}`);

  writeGame(GAME_CODE());
  run = dp('prove', GAME, 'buttons');
  const same = report('buttons');
  check(run.status === 0 && same.matched === 260 && same.sound.heard, `every frame of the picture and the sound matches at another screen, rate and frame time: ${same.matched} of ${same.frames}`);
  if (run.status) console.log(run.out);
  const progress = JSON.parse(readFileSync(join(proofFolder(GAME), 'progress.json'), 'utf8'));
  check(progress.recordings?.buttons?.frames === 260 || !!progress.parts, 'prove keeps what it found in progress.json');
  run = dp('prove', GAME, 'later');
  check(run.status === 0 && report('later').matched === 40, `a start point writes to the core's work memory, and matches from there: ${report('later').matched} of ${report('later').frames}`);
  if (run.status) console.log(run.out);
  run = dpWith({ DISPLAY: ':99', WAYLAND_DISPLAY: 'nowhere' }, 'prove', GAME, 'later', '--quick');
  check(run.status === 0, `a browser nobody sees doesn't mind a screen it can't reach: ${lastLine(run)}`);
  if (process.platform !== 'win32') {
    await stopPartway('SIGTERM');
    check(!browserLeft(), 'a tool that\'s stopped takes its browser with it');
    await stopPartway('SIGKILL');
    run = dp('prove', GAME, 'later', '--quick');
    check(run.status === 0 && !browserLeft(), `one stopped so it can't is ended by the next run: ${lastLine(run)}`);
  }

  writeGame(GAME_CODE({ colourB: '0x001F' }));
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference?.frame === 120, `a wrong colour is found where it first shows, at frame 120: ${report('buttons').firstDifference?.frame}`);

  writeGame(GAME_CODE({ loud: '0' }));
  run = dp('prove', GAME, 'buttons');
  const silent = report('buttons');
  check(run.status !== 0 && !silent.firstPictureDifference && Math.abs(silent.sound.firstDifference?.frame - 60) <= 16, `a wrong sound with the right picture is found near frame 60: ${silent.sound.firstDifference?.frame}`);

  writeGame(GAME_CODE({ colourB: '0x001F' }));
  const before = readFileSync(join(proofFolder(GAME), 'progress.json'));
  run = dp('prove', GAME, 'buttons', '--quick');
  check(run.status !== 0 && /120/.test(run.out) && before.equals(readFileSync(join(proofFolder(GAME), 'progress.json'))), `--quick stops at it and changes nothing: ${lastLine(run)}`);

  run = dp('prove', GAME, 'buttons', '--quick', '--stills', '200');
  check(run.status !== 0 && existsSync(join(resultFolder(GAME, 'buttons'), 'stills', 'frame-200.png')), '--quick still goes on to a frame asked for, past the first that differs');

  writeGame(GAME_CODE());
  const presses = join(WORK, 'presses.json');
  writeFileSync(presses, `${JSON.stringify({ frames: 500, held: [[0, []], [30, ['A']]] }, null, 2)}\n`);
  run = dp('capture', GAME, '--from', presses);
  check(run.status === 0 && existsSync(join(MEDIA, `${GAME}-dreamport-still.webp`)), `capture keeps a moment of it from presses: ${lastLine(run)}`);
  if (run.status) console.log(run.out);
  check(readFileSync(join(gameFolder(GAME), 'entry.md'), 'utf8').includes(`/media/${GAME}-dreamport`), 'its entry names the capture');
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
