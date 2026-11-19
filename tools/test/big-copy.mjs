// npm run test:big-copy: a copy too large for a browser's memory (#615), played on a Dreamport's page. A made-up
// PlayStation 2 disc of 5 GB, of the project's own (made-up-disc.mjs), marks four sectors with a colour, one past 4 GB
// in, one near its end, and a Dreamport in C on the PlayStation 2's kit (big-copy.c) paints each frame the colour of
// one of them, read from the disc through kit/c/disc.h. The page is given the disc as the player gives it, through the
// start screen's file input, in Chrome, in Firefox and in WebKit, Safari's engine, where WebKitGTK is installed, and the test checks, frame by frame with the proof tools'
// stepping, that each frame shows its sector's colour, that the page's processes stay far smaller than the disc, and
// that the version check, which reads the whole disc on a thread of its own, says the version is tested. The disc
// takes no room on the computer, as the file system keeps its gaps as nothing, and everything it makes is removed.
//
// Then the same in a CSO and a CHD of a smaller made-up disc, so the page's own decoders are tried in each browser.
//
// It runs on Linux, where it reads each browser's memory from /proc, and isn't run on every pull request.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { buildGame } from '../lib/c.mjs';
import { serveRepository } from '../lib/server.mjs';
import { giveFile, go, openChrome, until } from '../lib/chrome.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { madeUpPs2Disc, writeChd, writeCso } from './made-up-disc.mjs';

const GAME = 'test-big-copy';
const WORK = join(LOCAL, 'test-big-copy');
const SECTORS = 2_500_000;
// the marked sectors, each with its colour: near the start, at 2 GB, just past 4 GB and near the end
const MARKS = [[30, 0x2040E0], [1_048_576, 0xE04020], [2_097_200, 0x20C040], [2_499_990, 0xC0C020]];
// and a smaller disc's, kept as a CSO and a CHD
const SMALL = [[30, 0x2040E0], [500, 0xE04020], [1200, 0x20C040], [1990, 0xC0C020]];
const FRAMES = 12;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

function tidy() {
  for (const path of [gameFolder(GAME), WORK]) rmSync(path, { recursive: true, force: true });
}

// the disc, its marks placed past its first files, as a sparse file of 5 GB
function makeDisc(path, sectors = SECTORS, marks = MARKS) {
  const disc = madeUpPs2Disc({ dvd: true, sectors, path });
  for (const [lba, colour] of marks) {
    const sector = Buffer.alloc(2048, 0x55);
    sector.writeUIntLE(colour, 0, 3);
    disc.place(lba, sector);
  }
  return disc;
}

async function setUp() {
  mkdirSync(WORK, { recursive: true });
  const path = join(WORK, 'big.iso');
  makeDisc(path);
  const copy = await readAnyCopy(path);
  check(copy?.console === 'ps2' && copy.code === 'SLUS_999.99', `rom tells the 5 GB disc as a PlayStation 2 game's, in pieces: ${copy?.code}`);
  const original = { console: 'ps2', name: 'Test Big Copy (World)', title: 'TEST BIG COPY', code: 'SLUS_999.99', sha1: copy.sha1 };
  mkdirSync(proofFolder(GAME), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  const folder = join(gameFolder(GAME), 'c');
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(folder, file, '..'), { recursive: true });
    writeFileSync(join(folder, file), text);
  }
  writeFileSync(join(folder, 'src', 'main.c'), readFileSync(join(REPO, 'tools', 'test', 'big-copy.c')));
  await buildGame(folder);
  // a smaller disc with its marks near each other, as a CSO and a CHD
  const smallPath = join(WORK, 'small.iso');
  makeDisc(smallPath, 2000, SMALL);
  const iso = readFileSync(smallPath);
  writeFileSync(join(WORK, 'small.cso'), writeCso(iso, { version: 2 }));
  writeFileSync(join(WORK, 'small.chd'), writeChd(iso, { hunkBytes: 8192, unitBytes: 2048, codecs: ['lzma', 'zlib', 'huff'], metadata: [['DVD ', '']] }));
  return { path, sha1: copy.sha1 };
}

// the memory, in MB, of every process whose command line holds `profile`, from /proc
function memoryOf(profile) {
  let kb = 0;
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(profile)) continue;
      kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
    } catch { /* gone */ }
  }
  return Math.round(kb / 1024);
}

// the page's side, the same in both browsers: `evaluate(expression)` resolves to the value of an expression in the page
const PICK = `document.querySelector('.setup')?.dataset.restored === 'true' && !!document.querySelector('.rom input[type=file]')`;
const READY = `!document.querySelector('.play').disabled`;
const STEP = `(async () => { const picture = await dreamportsProof.step({ held: [] }); const at = (picture.width * (picture.height >> 1) + (picture.width >> 1)) * 4; return [...picture.data.subarray(at, at + 3)].map(x => x.toString(16).padStart(2, '0')).join(''); })()`;
const colourOf = colour => [colour & 0xFF, (colour >> 8) & 0xFF, colour >> 16].map(x => x.toString(16).padStart(2, '0')).join('');

// the page's address for a disc: the proof tools' mode, and the sectors it marks, which the game reads (big-copy.c)
const addressOf = (server, marks) => `${server.url}/games/${GAME}/c/?proof&marks=${marks.map(([lba]) => lba).join(',')}`;

async function playOn(browser, page, server, file, marks, { memory, sha1 } = {}) {
  await page.go(addressOf(server, marks));
  await page.until(PICK, 'the start screen');
  // nothing is kept with the proof modes, as the tools give it (lib/dreamport.mjs)
  await page.evaluate(`{ const keep = document.querySelector('.remember input'); if (keep) keep.checked = false; true; }`);
  const before = memory?.();
  await page.give(file);
  await page.until(`${READY} || !!document.querySelector('[data-kind="error"]')`, 'the page to read the disc');
  const refused = await page.evaluate(`document.querySelector('[data-kind="error"]')?.textContent.trim() ?? ''`);
  if (refused) throw new Error(`The page didn't take the disc: ${refused}`);
  await page.evaluate(`document.querySelector('.play').click(); true`);
  await page.evaluate('dreamportsProof.ready.then(() => true)');
  const shown = [];
  for (let frame = 0; frame < FRAMES; frame++) shown.push(await page.evaluate(STEP));
  const wanted = Array.from({ length: FRAMES }, (_, f) => colourOf(marks[f % marks.length][1]));
  check(shown.join() === wanted.join(), `${browser}, ${file.split('/').pop()}: each of ${FRAMES} frames shows its sector's colour${shown.join() === wanted.join() ? '' : `: ${shown.join(' ')} where ${wanted.join(' ')}`}`);
  if (sha1) {
    await page.until(`/tested version|untested version/.test(document.querySelector('.rom-detail')?.textContent ?? '')`, 'the version check', 240000);
    const line = await page.evaluate(`document.querySelector('.rom-detail').textContent`);
    check(line === 'tested version', `${browser}: the version check read the whole 5 GB disc on its own thread: "${line}"`);
  }
  if (memory) {
    const after = memory();
    check(after < 1500, `${browser}: its processes took ${before} MB before the disc and ${after} MB after it, far below the disc's 5,120 MB`);
  }
}

async function inChrome(server, discs) {
  const profile = join(WORK, 'chrome');
  const chrome = await openChrome({ profile });
  const page = {
    go: url => go(chrome, url),
    until: (expression, what, limit) => until(chrome, expression, what, limit),
    give: path => giveFile(chrome, '.rom input[type=file]', path),
    evaluate: expression => chrome.evaluate(expression),
  };
  try {
    for (const disc of discs) await playOn('Chrome', page, server, disc.path, disc.marks, { ...disc, memory: disc.sha1 && (() => memoryOf(profile)) });
  } finally {
    await chrome.close();
  }
}

// Firefox, driven through WebDriver BiDi, as it speaks it on its own port
async function openFirefox(profile) {
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);\nuser_pref("remote.prefs.recommended", true);\n');
  const firefox = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port=0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  process.once('exit', () => firefox.kill('SIGKILL'));
  const address = await new Promise((resolve, reject) => {
    let said = '';
    firefox.stderr.on('data', bytes => {
      said += bytes;
      const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(said);
      if (found) resolve(found[1]);
    });
    firefox.once('exit', () => reject(new Error(`Firefox ended: ${said.trim().split('\n').at(-1)}`)));
    setTimeout(() => reject(new Error('Firefox didn\'t start.')), 60000);
  });
  const socket = new WebSocket(`${address}/session`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.type === 'error') reject(new Error(`${message.error}: ${message.message}`));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('session.new', { capabilities: {} });
  const { context } = await send('browsingContext.create', { type: 'tab' });
  const evaluate = async expression => {
    const { result, exceptionDetails, type } = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (type === 'exception') throw new Error(exceptionDetails?.text ?? 'An error in the page.');
    return result?.type === 'array' ? result.value.map(each => each.value) : result?.value;
  };
  return {
    go: url => send('browsingContext.navigate', { context, url, wait: 'complete' }),
    async until(expression, what, limit = 60000) {
      const giveUp = Date.now() + limit;
      while (!(await evaluate(expression))) {
        if (Date.now() > giveUp) throw new Error(`Timed out waiting for ${what}.`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
    async give(path) {
      const { result } = await send('script.evaluate', { expression: `document.querySelector('.rom input[type=file]')`, target: { context }, awaitPromise: false, resultOwnership: 'root' });
      await send('input.setFiles', { context, element: { sharedId: result.sharedId }, files: [path] });
    },
    evaluate,
    async close() {
      try { await send('session.end'); } catch { /* ending anyway */ }
      socket.close();
      firefox.kill();
      await new Promise(resolve => (firefox.exitCode !== null ? resolve() : firefox.once('exit', resolve)));
    },
  };
}

async function inFirefox(server, discs) {
  const profile = join(WORK, 'firefox');
  const firefox = await openFirefox(profile);
  try {
    for (const disc of discs) await playOn('Firefox', firefox, server, disc.path, disc.marks, { ...disc, memory: disc.sha1 && (() => memoryOf(profile)) });
  } finally {
    await firefox.close();
  }
}

// WebKit, the engine Safari is built on, through WebKitGTK from Python (big-copy-webkit.py), where it's installed
async function inWebKit(server, discs) {
  const python = spawnSync('python3', ['-c', "import gi; gi.require_version('WebKit2', '4.1')"], { stdio: 'ignore' });
  if (python.status !== 0) return console.log('  not tried: this computer has no WebKitGTK for Python');
  for (const disc of discs) {
    // on its own process, as the page's server is this one's
    const webkit = spawn('python3', [join(REPO, 'tools', 'test', 'big-copy-webkit.py'), addressOf(server, disc.marks), disc.path, String(FRAMES), disc.sha1 ? '1' : '0'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GDK_BACKEND: 'x11', WEBKIT_DISABLE_COMPOSITING_MODE: '1', WEBKIT_DISABLE_DMABUF_RENDERER: '1', NO_AT_BRIDGE: '1' },
    });
    let out = '';
    webkit.stdout.on('data', bytes => { out += bytes; });
    await new Promise(resolve => webkit.once('exit', resolve));
    const said = out.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    const error = said.find(each => each.event === 'error');
    const shown = said.filter(each => each.event === 'frame').map(each => each.colour);
    const wanted = Array.from({ length: FRAMES }, (_, f) => colourOf(disc.marks[f % disc.marks.length][1]));
    check(!error && shown.join() === wanted.join(), `WebKit, ${disc.path.split('/').pop()}: each of ${FRAMES} frames shows its sector's colour${error ? `: ${error.message}` : shown.join() === wanted.join() ? '' : `: ${shown.join(' ')} where ${wanted.join(' ')}`}`);
    const version = said.find(each => each.event === 'version');
    if (disc.sha1) check(version?.line === 'tested version', `WebKit: the version check read the whole 5 GB disc on its own thread: "${version?.line}"`);
  }
}

async function main() {
  if (process.platform !== 'linux') throw new Error('test:big-copy reads the browsers\' memory from /proc, so it runs on Linux.');
  tidy();
  try {
    const big = await setUp();
    const discs = [{ path: big.path, marks: MARKS, sha1: big.sha1 }, { path: join(WORK, 'small.cso'), marks: SMALL }, { path: join(WORK, 'small.chd'), marks: SMALL }];
    const server = await serveRepository();
    try {
      for (const [name, run] of [['Chrome', inChrome], ['Firefox', inFirefox], ['WebKit', inWebKit]]) {
        console.log(name);
        try {
          await run(server, discs);
        } catch (error) {
          check(false, `${name}: ${error.message}`);
        }
      }
    } finally {
      await server.close();
    }
  } finally {
    tidy();
  }
  if (existsSync(gameFolder(GAME))) failures.push('the test game was left behind');
  console.log(failures.length ? `\n${failures.length} failed.` : '\nAll passed.');
  process.exitCode = failures.length ? 1 : 0;
}

await main();
