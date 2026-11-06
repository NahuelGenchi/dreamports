// npm run test:consoles: everything the proof tools do on a console that isn't the Game Boy Advance, from showing them a
// copy to keeping a game's capture, with the game in JavaScript and in C (kit/c/). It runs on a console that was never
// made, with a small emulator of it written here (made-up-core.c) that the tools drive as they drive any libretro core,
// and a game made for it in a folder of its own that it removes after, so it needs nothing from any game and nothing
// from anyone else, and runs on any pull request.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { fileAt, makePreview } from '../lib/preview.mjs';
import { serveRepository } from '../lib/server.mjs';
import { giveFile, go, openChrome, until } from '../lib/chrome.mjs';
import { createHash } from 'node:crypto';

const GAME = 'test-made-up';
const WORK = join(LOCAL, 'test-consoles');
const RESULTS = join(LOCAL, 'results', GAME);
const CAPTURES = join(LOCAL, 'captures', GAME);
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
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
const report = (recording, game = GAME) => JSON.parse(readFileSync(join(resultFolder(game, recording), 'report.json'), 'utf8'));
const lastLine = ({ out }) => out.trim().split('\n').at(-1);

// the game's own code, which does what the made-up console's cartridge says, as a Dreamport does what its original does.
// `change` makes a game that differs from it somewhere. `size` is the screen it works out, and `shape` the size it says that
// picture has, when it says another. `upAndDown` changes the screen as the cartridge's Up and Down do
const GAME_CODE = ({ colourB = 'colours[2]', loud = '0.5', unseen = false, size = [64, 48], shape = null, upAndDown = false } = {}) => `function createGame() {
  const colours = Array.from(new Uint16Array(rom.buffer.slice(6, 22)));
  let frame = Number(new URLSearchParams(location.search).get('later')), pressed = -1, phase = 0, [width, height] = ${JSON.stringify(size)};
  proof?.listen((left, right) => {
    for (let i = 0; i < left.length; i++, phase++) left[i] = right[i] = pressed < 0 ? 0 : Math.floor(phase * 880 / 44100) % 2 ? ${loud} : -(${loud});
  }, 44100, 1 / 50);
  const paint = colour => 0xFF000000 | (colour & 31) << 19 | (colour >> 6 & 31) << 11 | (colour >> 11 & 31) << 3;
  return {
    size: ${JSON.stringify(shape ?? size)},
    step() {
      pressed = input.a ? 1 : input.b ? 2 : input.start ? 3 : -1;${unseen ? " if (globalThis.dreamportsProof) dreamportsProof.neverInPlay = 'it says so';" : ''}
      ${upAndDown ? `if (input.up) [width, height] = [64, 48]; else if (input.down) [width, height] = ${JSON.stringify(size)};
      this.size = [width, height];` : ''}
    },
    draw(pixels) {
      const bar = paint(colours[4]);
      const shown = pressed === 2 ? ${colourB} : colours[pressed < 0 ? 0 : pressed];
      for (let y = 0; y < height; y++) pixels.fill(paint(shown ^ y % 12), y * width, (y + 1) * width);
      for (let y = 0; y < height; y++) pixels[y * width + frame % width] = bar;
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

// the game's preview as share makes it, from a commit no branch holds. Nothing is sent anywhere
function makeGamePreview() {
  // share's own commit needs a name, which GitHub's machines don't have
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' });
  const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: join(WORK, 'index') } }).trim();
  git('read-tree', 'HEAD');
  git('add', '--', `games/${GAME}`);
  const commit = git('commit-tree', git('write-tree'), '-p', 'HEAD', '-m', 'The test\'s game');
  return makePreview({ tip: null, commit, branch: 'test', game: GAME, title: GAME, name: 'a-preview', author: 'nobody', repository: 'nobody/dreamports', url: 'https://nobody.github.io/dreamports/', about: '', guide: '' });
}

// with only what the preview holds to load, it opens, takes the copy and starts, at the console's own screen
async function startPreview(copy) {
  const preview = makeGamePreview();
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  const server = await serveRepository({
    answer(request, response, path) {
      const file = path.endsWith('/') ? `${path}index.html` : path;
      const bytes = fileAt(preview.commit, file.slice(1));
      response.writeHead(bytes ? 200 : 404, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
      return true;
    },
  });
  const page = await openChrome({ profile: join(WORK, 'chrome') });
  try {
    await go(page, `${server.url}/a-preview/play/${GAME}/`);
    await until(page, `!!document.querySelector('.rom input[type=file]')`, 'the start screen', 10000);
    await giveFile(page, '.rom input[type=file]', copy);
    await until(page, `!document.querySelector('.play').disabled`, 'Play to be ready', 10000);
    await page.evaluate(`document.querySelector('.play').click()`);
    await until(page, `document.getElementById('screen').width === 64`, 'the game to start', 10000);
    return '';
  } catch (error) {
    return error.message;
  } finally {
    await page.close();
    await server.close();
  }
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
  writeFileSync(join(proofFolder(GAME), 'recordings', 'rates.json'), `${JSON.stringify({ about: 'The game chooses another sound rate, and back.', frames: 120, held: [[0, []], [10, ['RIGHT']], [11, []], [20, ['A']], [60, []], [70, ['LEFT']], [71, []], [80, ['A']], [110, []]] }, null, 2)}\n`);
  run = dp('prove', GAME, 'rates');
  check(run.status === 0 && report('rates').matched === 120 && report('rates').sound.heard, `a game that chooses its own sound rate is heard at the one the tools compare at: ${report('rates').matched} of ${report('rates').frames}`);
  if (run.status) console.log(run.out);
  await inC(original);
  run = dpWith({ DISPLAY: ':99', WAYLAND_DISPLAY: 'nowhere' }, 'prove', GAME, 'later', '--quick');
  check(run.status === 0, `a browser nobody sees doesn't mind a screen it can't reach: ${lastLine(run)}`);
  if (process.platform !== 'win32') {
    await stopPartway('SIGTERM');
    check(!browserLeft(), 'a tool that\'s stopped takes its browser with it');
    await stopPartway('SIGKILL');
    run = dp('prove', GAME, 'later', '--quick');
    check(run.status === 0 && !browserLeft(), `one stopped so it can't is ended by the next run: ${lastLine(run)}`);
  }

  writeGame(GAME_CODE({ unseen: true }));
  run = dp('prove', GAME, 'later');
  check(run.status !== 0 && report('later').matched === 40 && run.out.includes('No player could ever see'), 'a recording fails when the game says no player could see it, however its frames compare');
  run = dp('prove', GAME, 'later', '--quick');
  check(run.status !== 0 && run.out.includes('No player could ever see'), '--quick says so too');

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

  const stopped = await startPreview(copy);
  check(!stopped, `its preview opens with what it holds, takes the copy and starts${stopped && `: ${stopped}`}`);

  // a disc split into tracks, the second of which says nothing of what it is, so only what rom remembers can tell
  writeFileSync(join(WORK, 'one.bin'), cartridge.subarray(0, 8));
  writeFileSync(join(WORK, 'two.bin'), cartridge.subarray(8));
  writeFileSync(join(WORK, 'disc.cue'), 'FILE "one.bin" BINARY\nFILE "two.bin" BINARY\n');
  run = dp('rom', join(WORK, 'disc.cue'));
  check(run.status === 0 && run.out.includes(GAME), `rom knows a disc by all its tracks: ${run.out.trim().split('\n')[1]}`);
  writeFileSync(join(gameFolder(GAME), 'music.dat'), cartridge.subarray(8));
  let refused = '';
  try {
    makeGamePreview();
  } catch (error) {
    refused = error.message;
  }
  check(refused.includes('music.dat: this is a copy of a game'), `share won't publish one of its tracks under another name: ${refused || 'it would'}`);

  await ownScreen(cartridge);
}

// the same game written in C, on the base every console's kit in C shares (kit/c/), built to WebAssembly by the tools
// and proved as the JavaScript one is: every frame, picture and sound, from power-on and from a start point
async function inC(original) {
  console.log('The same game in C');
  const C = `${GAME}/c`;
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(C), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(C), file), text);
  }
  let run = dp('prove', C, 'buttons');
  check(run.status !== 0 && report('buttons', C).firstDifference?.frame === 0, `what new writes in C builds, opens and plays, and differs at once, being only one colour: ${JSON.stringify(report('buttons', C).firstDifference)}`);
  const main = join(gameFolder(C), 'src', 'main.c'), game = readFileSync(join(REPO, 'tools', 'test', 'made-up-game.c'), 'utf8');
  writeFileSync(main, game);
  run = dp('prove', C, 'buttons');
  const same = report('buttons', C);
  check(run.status === 0 && same.matched === 260 && same.sound.heard, `in C, every frame of the picture and the sound matches: ${same.matched} of ${same.frames}`);
  if (run.status) console.log(run.out);
  run = dp('prove', C, 'later');
  check(run.status === 0 && report('later', C).matched === 40, `in C, a start point's words reach the game, and it matches from there: ${report('later', C).matched} of ${report('later', C).frames}`);
  if (run.status) console.log(run.out);
  run = dp('prove', C, 'rates');
  check(run.status === 0 && report('rates', C).matched === 120 && report('rates', C).sound.heard, `in C, its sound is heard at the console's rate while the original chooses another: ${report('rates', C).matched} of ${report('rates', C).frames}`);
  if (run.status) console.log(run.out);
  writeFileSync(main, game.replace('? 0.5f : -0.5f', '? 0.0f : -0.0f'));
  run = dp('prove', C, 'buttons');
  const silent = report('buttons', C);
  check(run.status !== 0 && !silent.firstPictureDifference && Math.abs(silent.sound.firstDifference?.frame - 60) <= 16, `in C, a wrong sound with the right picture is found near frame 60: ${silent.sound.firstDifference?.frame}`);
  writeFileSync(main, game.replace('colours[pressed < 0 ? 0 : pressed]', '(pressed == 2 ? 0x001F : colours[pressed < 0 ? 0 : pressed])'));
  run = dp('prove', C, 'buttons');
  check(run.status !== 0 && report('buttons', C).firstDifference?.frame === 120, `in C, a wrong colour is found where it first shows, at frame 120: ${report('buttons', C).firstDifference?.frame}`);
  rmSync(gameFolder(C), { recursive: true, force: true });
}

// a picture's size, from its file: a PNG's, or a WebP's as a browser writes one, lossy or not
const sizeOfPng = bytes => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
function sizeOfWebp(bytes) {
  if (bytes.toString('latin1', 12, 16) === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3FFF, bytes.readUInt16LE(28) & 0x3FFF];
  const bits = bytes.readUInt32LE(21);
  return [(bits & 0x3FFF) + 1, (bits >> 14 & 0x3FFF) + 1];
}

// a game that chooses its own screen, from the cartridge's first frame and then partway through
async function ownScreen(cartridge) {
  console.log('A game that chooses its own screen, on a console that has one size');
  const chosen = Buffer.concat([cartridge, Buffer.from(new Uint16Array([40, 30]).buffer)]);
  const copy = join(WORK, 'chooses.mu');
  writeFileSync(copy, chosen);
  const original = { console: 'made-up', name: 'Test Made Up (World)', title: 'MADEUP', code: 'MU', sha1: createHash('sha1').update(chosen).digest('hex') };
  const said = screen => writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ ...original, ...(screen ? { screen } : {}) }, null, 2)}\n`);
  const PROGRESS = join(proofFolder(GAME), 'progress.json');
  rmSync(proofFolder(GAME), { recursive: true, force: true });
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  said(null);
  writeFileSync(join(proofFolder(GAME), 'recordings', 'buttons.json'), `${JSON.stringify({ about: 'Each button, then none.', frames: 100, held: [[0, []], [30, ['A']], [50, []]] }, null, 2)}\n`);
  writeFileSync(join(proofFolder(GAME), 'recordings', 'changes.json'), `${JSON.stringify({ about: 'The game changes its screen, and back.', frames: 100, held: [[0, []], [20, ['UP']], [21, []], [60, ['DOWN']], [61, []]] }, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), 'rom knows the copy');

  // a game that doesn't say so
  writeGame(GAME_CODE({ size: [40, 30] }));
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && run.out.includes('"screen": [40,30]') && !existsSync(PROGRESS), `a game that doesn't say the size it shows fails, however its frames compare, and is told what to write: ${lastLine(run)}`);
  said([64, 48]);
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && run.out.includes('its original.json says 64 by 48') && run.out.includes('"screen": [40,30]'), 'nor does saying the wrong one pass');
  said([40]);
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && run.out.includes('"screen" in original.json is a width and a height'), `a size that isn't one is refused: ${lastLine(run)}`);

  // what new writes
  said([40, 30]);
  const files = startingFiles(GAME, { ...original, screen: [40, 30] });
  check(files['src/main.js'].includes('sizeTo([40,30])'), 'what new writes starts at the size the game says');
  check(startingFiles(GAME, { ...original, screen: [[40, 30], [64, 48]] })['src/main.js'].includes('sizeTo([40,30])'), 'and at the first it lists');
  check(startingFiles(GAME, original)['src/main.js'].includes('sizeTo([64,48])'), 'and at the console\'s when it says none');
  writeFileSync(join(gameFolder(GAME), 'src', 'main.js'), files['src/main.js']);

  // the game at its size
  writeGame(GAME_CODE({ size: [40, 30] }));
  run = dp('prove', GAME, 'buttons');
  const same = report('buttons');
  check(run.status === 0 && same.matched === 100 && same.sound.heard, `every frame of a game at the size it says matches: ${same.matched} of ${same.frames}`);
  if (run.status) console.log(run.out);
  const still = sizeOfPng(readFileSync(join(resultFolder(GAME, 'buttons'), 'dreamport.png')));
  check(still[0] === 80 && still[1] === 80, `its stills are its size, twice over, under the bar: ${still.join(' by ')}`);

  // a Dreamport that doesn't draw it
  writeGame(GAME_CODE());
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').firstDifference?.frame === 0 && run.out.includes("At frame 0 the original's picture is 40 by 30 and the Dreamport's 64 by 48"), 'a Dreamport at another size differs at once, and prove says that\'s why');
  writeGame(GAME_CODE({ size: [40, 30], shape: [30, 40] }));
  run = dp('prove', GAME, 'buttons');
  check(run.status !== 0 && report('buttons').matched === 0 && run.out.includes("the Dreamport's 30 by 40"), `the same pixels in another shape don't match: ${report('buttons').matched} of 100`);

  // a screen that changes partway
  writeGame(GAME_CODE({ size: [40, 30], upAndDown: true }));
  run = dp('prove', GAME, 'changes');
  check(run.status !== 0 && run.out.includes('64 by 48 at frame 20') && run.out.includes('"screen": [[40,30],[64,48]]'), `a game that changes to a size it doesn't list fails, and is told what to write: ${lastLine(run)}`);
  said([[40, 30], [64, 48]]);
  run = dp('prove', GAME, 'changes');
  const changing = report('changes');
  check(run.status === 0 && changing.matched === 100, `a game that lists both matches through the change and back: ${changing.matched} of ${changing.frames}`);
  if (run.status) console.log(run.out);
  const roomy = sizeOfPng(readFileSync(join(resultFolder(GAME, 'changes'), 'dreamport.png')));
  check(roomy[0] === 128 && roomy[1] === 116, `its stills have room for the larger: ${roomy.join(' by ')}`);
  run = dp('prove', GAME, 'buttons');
  check(run.status === 0 && report('buttons').matched === 100, 'a recording that shows only one of them matches too');
  writeGame(GAME_CODE({ size: [40, 30] }));
  run = dp('prove', GAME, 'changes');
  check(run.status !== 0 && report('changes').firstDifference?.frame === 20 && run.out.includes("At frame 20 the original's picture is 64 by 48 and the Dreamport's 40 by 30"), 'a Dreamport that doesn\'t change with it differs where it changes');
  writeFileSync(join(proofFolder(GAME), 'recordings', 'skips.json'), `${JSON.stringify({ about: 'The original alone shows the other size, on its way to where this starts.', frames: 60, held: [[0, []]], onlyInOriginal: [{ at: 0, frames: 30, held: [[0, ['UP']], [1, []], [20, ['DOWN']], [21, []]] }], start: 'later=30' }, null, 2)}\n`);
  said([40, 30]);
  run = dp('prove', GAME, 'skips');
  check(run.status === 0, `a size only in the frames only the original has needs no saying, as they aren't compared: ${lastLine(run)}`);
  if (run.status) console.log(run.out);

  // its capture, on its card at the size that moment shows, whatever else the game lists
  const clipSize = () => {
    const file = readFileSync(join(MEDIA, `${GAME}-dreamport.h264.mp4`)), at = file.indexOf('tkhd');
    return [file.readUInt32BE(at + 80) >> 16, file.readUInt32BE(at + 84) >> 16];
  };
  const cardSize = () => [sizeOfWebp(readFileSync(join(MEDIA, `${GAME}-dreamport-still.webp`))).join(' by '), clipSize().join(' by ')].join(', ');
  const capture = (presses, name = 'chooses-presses') => {
    const file = join(WORK, `${name}.json`);
    writeFileSync(file, `${JSON.stringify({ frames: 500, held: presses }, null, 2)}\n`);
    return dp('capture', GAME, '--from', file);
  };
  const playing = [[0, []], [30, ['A']]];
  said([40, 30]);
  run = capture(playing);
  check(run.status === 0 && cardSize() === '80 by 60, 80 by 60', `capture keeps it at its size: ${cardSize()}`);
  if (run.status) console.log(run.out);
  said([[64, 48], [40, 30]]);
  run = capture(playing);
  check(run.status === 0 && cardSize() === '80 by 60, 80 by 60', `a moment at the smaller of the sizes a game lists has no band of black: ${cardSize()}`);
  if (run.status) console.log(run.out);
  run = capture([[0, []], [5, ['UP']], [6, []], [30, ['A']]]);
  check(run.status === 0 && cardSize() === '128 by 96, 128 by 96', `and one at the larger is that size: ${cardSize()}`);
  if (run.status) console.log(run.out);
  said(null);
  run = capture(playing);
  check(run.status === 0 && cardSize() === '80 by 60, 80 by 60', `a game that hasn't said its size yet can still be played for its card, as the picture fits: ${cardSize()}`);
  if (run.status) console.log(run.out);
  said([32, 24]);
  run = capture(playing);
  check(run.status !== 0 && run.out.includes('"screen": [40,30]'), 'a picture too large for the size it says stops at once, as it would lose its edges');
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  await main();
} finally {
  tidy();
  writeFileSync(STATUS, kept.status);
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
