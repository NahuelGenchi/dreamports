// npm run test:ps2-flow [-- --safari]: what /dreamport does with a new PlayStation 2 game, in its order, on a small 3D
// program written here (made-up-ps2.mjs), in a folder of its own that it removes after, so no game's copy is needed:
// `rom` takes the copy, `codemap` maps its one function, `new <game>/c` writes the game's first files in C for the lead
// a stand-in for GitHub's issues names (stand-in/github.mjs), so nothing is sent anywhere, `capture --from` plays the
// original with presses and keeps a moment for its card, and `prove` runs the original and the version `new` wrote side
// by side and says where they first differ, as nothing of the game is in it yet.
//
// With --safari it opens that version's page in Safari too, on a Mac, through Apple's safaridriver, which has to be
// switched on once (`safaridriver --enable`), and plays the same frames there and in Chrome: every picture and every
// draw list has to be the same in both. It isn't run on every pull request, as the emulator takes minutes to build, and
// runs on Linux and macOS alone, where the tools give the emulator a graphics context (docs/CONSOLES.md). The Mac
// workflow runs it on GitHub's Mac with Apple's chip.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { serveRepository } from '../lib/server.mjs';
import { go, openChrome } from '../lib/chrome.mjs';
import { buildIfC } from '../lib/dreamport.mjs';
import { GH, newSite } from './stand-in/github.mjs';
import { LOAD_AT, madeUpPs2In3d } from './made-up-ps2.mjs';

const GAME = 'test-ps2-flow', VERSION = `${GAME}/c`, ISSUE = 7;
const WORK = join(LOCAL, 'test-ps2-flow');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300, IN_SAFARI = 120;
const SAFARI = process.argv.includes('--safari');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// the tools as a person's agent runs them, with the stand-in's gh first on the PATH
const bin = join(WORK, 'bin'), site = join(WORK, 'github.json');
const dp = (...args) => {
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, STAND_IN_GITHUB: site, STAND_IN_LOGIN: 'sam', STAND_IN_WORK: WORK };
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26, env });
  return { status, out: stdout + stderr };
};
const lastLine = ({ out }) => out.trim().split('\n').at(-1);
const report = recording => {
  const file = join(resultFolder(VERSION, recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  const made = [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'results', GAME.concat('-c')), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`), join(REPO, '.github', 'readme', 'progress', `${GAME}-c.svg`)];
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// For Safari, a version with more to it than one sprite, a game of the test's own: a triangle shaded between its corners
// that turns with the EE's float sums over a still one, both tested for depth, and its colours swapped while a button is held
const TURNING = `#include "ps2.h"
#define ONE 0x3F800000ull
#define XYZ(x, y, z) ((uint64_t)(uint32_t)((x) << 4 | (y) << 20) | (uint64_t)(z) << 32)
static float x = 150, y = 0;
static uint64_t corner(float across, float down, uint32_t depth) {
  return (uint64_t)((uint32_t)(ee_to_int(across) & 0xFFFF) | (uint32_t)ee_to_int(down) << 16) | (uint64_t)depth << 32;
}
void game_start(void) {
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_DISPFB1, (SCREEN_W / 64) << 9);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);
}
void game_step(uint32_t buttons) {
  const uint32_t colours[3] = { 0x802020F0, 0x8020F020, 0x80F02020 };
  const float cosine = ee_from_int(4995), sine = ee_from_int(250), scale = ee_div(1, ee_from_int(5000));
  float xs = ee_mul(x, 16), ys = ee_mul(y, 16), middle_x = 320 * 16, middle_y = 224 * 16;
  uint64_t corners[3] = { corner(ee_add(middle_x, xs), ee_add(middle_y, ys), 100), corner(ee_sub(middle_x, ys), ee_add(middle_y, xs), 300), corner(ee_sub(middle_x, xs), ee_sub(middle_y, ys), 200) };
  gs_write(GS_FRAME_1, (uint64_t)(SCREEN_W / 64) << 16);
  gs_write(GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
  gs_write(GS_XYOFFSET_1, 0);
  gs_write(GS_ZBUF_1, (SCREEN_W * SCREEN_H * 4 + 8191) / 8192);
  gs_write(GS_PRMODECONT, 1);
  gs_write(GS_TEST_1, 0x30000);
  gs_write(GS_PRIM, 6);
  gs_write(GS_RGBAQ, 0x80301008 | ONE << 32);
  gs_write(GS_XYZ2, XYZ(0, 0, 0));
  gs_write(GS_XYZ2, XYZ(SCREEN_W, SCREEN_H, 0));
  gs_write(GS_TEST_1, 0x50000);
  gs_write(GS_PRIM, 0xB);
  gs_write(GS_RGBAQ, 0x80E0E0E0 | ONE << 32);
  gs_write(GS_XYZ2, XYZ(170, 104, 200));
  gs_write(GS_XYZ2, XYZ(470, 104, 200));
  gs_write(GS_RGBAQ, 0x80404040 | ONE << 32);
  gs_write(GS_XYZ2, XYZ(320, 400, 200));
  for (int i = 0; i < 3; i++) {
    gs_write(GS_RGBAQ, colours[buttons ? 2 - i : i] | ONE << 32);
    gs_write(GS_XYZ2, corners[i]);
  }
  float turned = ee_sub(ee_mul(x, ee_mul(cosine, scale)), ee_mul(y, ee_mul(sine, scale)));
  y = ee_add(ee_mul(x, ee_mul(sine, scale)), ee_mul(y, ee_mul(cosine, scale)));
  x = turned;
}
void game_draw(void) { gs_show(); }
void game_sound(float *left, float *right, int count) {}
`;

// what the page does for a person, then the frames prove plays, each picture hashed as the tools hash them byte by byte,
// with each frame's draw list: the same script in Chrome and in Safari
const PLAY = frames => `(async () => {
  const until = (test, what) => new Promise((resolve, reject) => {
    const start = Date.now();
    const look = () => { let ok = false; try { ok = test(); } catch {} if (ok) resolve(); else if (Date.now() - start > 60000) reject(new Error('It waited for ' + what + ' in vain.')); else setTimeout(look, 50); };
    look();
  });
  await until(() => document.querySelector('.setup')?.dataset.restored === 'true' && document.querySelector('.rom input[type=file]'), 'the start screen');
  const keep = document.querySelector('.remember input');
  if (keep) keep.checked = false;
  const bytes = new Uint8Array(await (await fetch('/the-copy')).arrayBuffer());
  const input = document.querySelector('.rom input[type=file]'), given = new DataTransfer();
  given.items.add(new File([bytes], 'program.elf'));
  input.files = given.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => !document.querySelector('.play').disabled, 'Play to be ready');
  document.querySelector('.play').click();
  await dreamportsProof.ready;
  const pictures = [], lists = [];
  for (let frame = 0; frame < ${frames}; frame++) {
    const { data } = await dreamportsProof.step({ held: frame % 20 < 10 ? [] : [dreamportsProof.buttons[0].name] });
    let hash = 0x811C9DC5;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 0x01000193);
    pictures.push(hash >>> 0);
    lists.push(dreamportsProof.drawList ?? null);
  }
  return { pictures, lists };
})()`;

// Safari, through the W3C WebDriver protocol Apple's safaridriver speaks, on a port of its own
async function inSafari(url, script) {
  const port = 4444 + Math.floor(Math.random() * 1000);
  const driver = spawn('safaridriver', ['-p', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let said = '', missing = null;
  driver.stderr.on('data', data => { said += data; });
  driver.on('error', error => { missing = error; });
  const ask = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const { value } = await response.json();
    if (value?.error) throw new Error(`Safari: ${value.error}: ${value.message}`);
    return value;
  };
  let session = null;
  try {
    for (let tries = 0; ; tries++) {
      try {
        await ask('GET', '/status');
        break;
      } catch (error) {
        if (missing) throw new Error(`Safari's safaridriver isn't here, as it's only on a Mac: ${missing.message}`);
        if (tries > 50 || driver.exitCode !== null) throw new Error(`safaridriver didn't start: ${said.trim() || error.message}`);
        await wait(200);
      }
    }
    session = (await ask('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
    await ask('POST', `/session/${session}/timeouts`, { script: 300000, pageLoad: 60000 });
    await ask('POST', `/session/${session}/url`, { url });
    const version = await ask('POST', `/session/${session}/execute/sync`, { script: 'return navigator.userAgent;', args: [] });
    const result = await ask('POST', `/session/${session}/execute/async`, {
      script: `const done = arguments[arguments.length - 1]; Promise.resolve(${script}).then(done, error => done({ failed: String(error?.message ?? error) }));`, args: [],
    });
    return { ...result, version };
  } finally {
    if (session) await ask('DELETE', `/session/${session}`).catch(() => {});
    if (driver.pid && driver.exitCode === null) process.kill(driver.pid);
  }
}

async function main() {
  tidy();
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  // the game's New Dreamport issue, which claims it for its lead
  const body = ['### Game', '', 'Test PS2 Flow', '', '### Game folder', '', GAME, '', '### Console', '', 'PlayStation 2', '', '### Where it starts', '', 'A triangle turning.'].join('\n');
  writeFileSync(site, JSON.stringify(newSite([{ number: ISSUE, title: 'Dreamport: Test PS2 Flow', body, assignees: [{ login: 'sam' }] }])));

  console.log('A new PlayStation 2 game, as /dreamport starts one');
  const { elf, sha1 } = madeUpPs2In3d(), copy = join(WORK, 'program.elf');
  writeFileSync(copy, elf);
  let run = dp('rom', copy);
  check(/a PlayStation 2 game \(console ps2\)/.test(run.out) && run.out.includes(sha1), `rom says what the copy is, a program for the PlayStation 2: ${run.out.trim().split('\n').slice(0, 2).join(' ')}`);
  // its original.json, from what rom said
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify({ console: 'ps2', name: 'Test PS2 Flow (World)', title: GAME, code: '', sha1 }, null, 2)}\n`);
  run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `and knows it as ${GAME}'s copy once its original.json names it`);
  const list = join(WORK, 'functions.csv');
  writeFileSync(list, `Address,Size\n${LOAD_AT.toString(16)},${elf.length - 0x80}\n`);
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0 && existsSync(join(proofFolder(GAME), 'code-map.json')), `codemap maps its one function from a list: ${lastLine(run)}`);

  run = dp('new', VERSION, '--repo', 'stand-in/dreamports');
  check(run.status === 0 && existsSync(join(gameFolder(GAME), 'entry.md')) && existsSync(join(gameFolder(VERSION), 'src', 'main.c')), `new writes its first files in C, for the lead its issue names: ${lastLine(run)}`);
  if (run.status) console.log(run.out);

  const presses = join(WORK, 'presses.json');
  const held = Array.from({ length: 30 }, (_, i) => [i * 30, i % 2 ? [] : [['CROSS'], ['RIGHT'], ['CIRCLE'], ['LEFT']][(i >> 1) % 4]]);
  writeFileSync(presses, `${JSON.stringify({ frames: 900, held }, null, 2)}\n`);
  run = dp('capture', GAME, '--from', presses);
  const media = readdirSync(MEDIA).filter(file => file.startsWith(`${GAME}-dreamport`));
  check(run.status === 0 && media.length > 0 && readFileSync(join(gameFolder(GAME), 'entry.md'), 'utf8').includes(`${GAME}-dreamport`), `capture plays presses along with the emulator and keeps a moment for the card: ${media.join(', ') || lastLine(run)}`);
  if (run.status || !media.length) console.log(run.out);

  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
  run = dp('prove', VERSION, 'still');
  const found = report('still');
  check(run.status !== 0 && found.frames === FRAMES && found.firstDifference?.frame === 0, `prove runs the original and the version new wrote, which has nothing of the game yet, and they differ at once: ${JSON.stringify(found.firstDifference)} of ${found.frames} frames`);
  if (!found.frames) console.log(run.out);

  if (!SAFARI) return;
  console.log('Its page in Safari and in Chrome, the same frames');
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), TURNING);
  await buildIfC(VERSION);
  const server = await serveRepository();
  server.serve('/the-copy', elf);
  const url = `${server.url}/games/${VERSION}/?proof`;
  let chrome = null, safari = null;
  try {
    const page = await openChrome({ profile: join(WORK, 'chrome') });
    try {
      await go(page, url);
      chrome = await page.evaluate(PLAY(IN_SAFARI));
    } finally {
      await page.close();
    }
    console.log(`  found: in Chrome, ${chrome.pictures.length} frames, ${new Set(chrome.pictures).size} different pictures, ${new Set(chrome.lists).size} different draw lists`);
    safari = await inSafari(url, PLAY(IN_SAFARI));
  } catch (error) {
    check(false, `the page runs in both: ${error.message}`);
    return;
  } finally {
    await server.close();
  }
  console.log(`  found: ${safari.version}`);
  check(!safari.failed && safari.pictures?.length === IN_SAFARI, `the page starts in Safari and plays ${IN_SAFARI} frames of a triangle turning with the EE's sums, a button held every other ten: ${safari.failed ?? safari.pictures?.length}`);
  const picture = safari.pictures?.findIndex((hash, frame) => hash !== chrome.pictures[frame]) ?? 0;
  check(!safari.failed && picture < 0, picture < 0 ? 'every picture is the same as in Chrome' : `every picture is the same as in Chrome: frame ${picture} differs`);
  const drawList = safari.lists?.findIndex((hash, frame) => hash !== chrome.lists[frame]) ?? 0;
  check(!safari.failed && drawList < 0 && chrome.lists.every(hash => hash !== null), drawList < 0 ? 'and every draw list' : `and every draw list: frame ${drawList} differs`);
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  await main();
} catch (error) {
  check(false, error.message);
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
