// npm run test:game: tries a new game's page in a real browser, with a made-up cartridge (made-up-game.mjs) and a
// stand-in controller, so a change that breaks what every new Dreamport starts with is seen before it reaches anyone:
// the start screen and its way back to the launcher, the game's frames, keys, a controller, the settings and the
// touch screen. It tries the page `npm run dp -- new` writes, in a folder of its own that it removes after, the same page
// with the game's code in C (kit/gba/c/), the page in C it writes for a game on every other console in kit/consoles.js
// (kit/c/), and every game in games/ that is still only that. It needs nothing from any game and no account, so it runs on any pull request.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOCAL, REPO, gameFolder } from '../lib/paths.mjs';
import { serveRepository } from '../lib/server.mjs';
import { openChrome, go, until } from '../lib/chrome.mjs';
import { openDreamport } from '../lib/dreamport.mjs';
import { startingFiles } from '../lib/new-game.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { buildGame } from '../lib/c.mjs';
import { CONSOLES } from '../../kit/consoles.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const BLUE = 'blue', GREEN = 'green';

// a controller nobody holds, whose buttons the test presses. It takes the place of any on this computer
const STAND_IN = `
  window.__pad = { id: 'Stand-in', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__padOn = true;
  Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => (window.__padOn ? [window.__pad] : []), configurable: true });
  window.__press = (i, on) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; };
`;
// the screen's first pixel, as the game's backdrop is all that a new game draws
const COLOUR = `(() => { const [r, g, b] = document.getElementById('screen').getContext('2d').getImageData(0, 0, 1, 1).data; return g > b ? 'green' : b > g ? 'blue' : 'neither'; })()`;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

async function tryGame(page, server, game, rom, machine = 'gba') {
  console.log(`games/${game}/${machine === 'gba' ? '' : ` (${CONSOLES[machine].name})`}`);
  // each time as a new visitor, as a copy the browser has kept would stand in for the one given
  const start = async () => {
    await go(page, `${server.url}/favicon.svg`);
    await page.evaluate(`(async () => { for (const { name } of await indexedDB.databases()) await new Promise(done => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = done; }); localStorage.clear(); })()`);
    await openDreamport(page, server, game, rom, { start: false });
  };
  const brand = () => page.evaluate(`document.querySelector('.setup-brand')?.textContent ?? ''`);
  const colour = wanted => until(page, `${COLOUR} === '${wanted}'`, `the screen to turn ${wanted}`, 5000).then(() => true, () => false);
  const key = async (type, code, name = code) => page.send('Input.dispatchKeyEvent', { type, code, key: name });

  await start();
  check((await brand()).endsWith('Dreamport'), 'the start screen names the game');
  check(await page.evaluate(`!document.querySelector('.play').disabled`), 'it takes the player\'s copy, and Play can be pressed');
  await openDreamport(page, server, game, rom, { start: false }).then(() => check(true, 'it takes the copy again over the one it kept'), error => check(false, error.message));
  // a Game Boy Advance copy says which game it is in its header. On another console a copy is known only by its SHA-1,
  // and one the game wasn't tested with still plays
  if (machine === 'gba') {
    const other = join(dirname(rom), 'other.gba');
    writeFileSync(other, madeUpGame({ title: 'SOMETHING', code: 'ELSE' }).rom);
    const refused = await openDreamport(page, server, game, other, { start: false }).then(() => '', error => error.message);
    check(refused.startsWith('The game didn\'t take the copy'), `another game's copy is refused, and it says so`);
    rmSync(other, { force: true });
  }
  await start();

  await page.evaluate(`document.querySelector('.play').click()`);
  await until(page, `!document.getElementById('stage').hidden`, 'the game to start', 5000);
  check(await colour(BLUE), 'the game runs: its screen shows the backdrop');

  await key('rawKeyDown', 'KeyZ');
  check(await colour(GREEN), 'a key presses a button');
  await key('keyUp', 'KeyZ');
  check(await colour(BLUE), 'and lets it go');

  await page.evaluate(`__press(0, true)`);
  check(await colour(GREEN), 'a controller presses a button');
  await page.evaluate(`__press(0, false)`);
  check(await colour(BLUE), 'and lets it go');

  const open = `!document.getElementById('sheet-wrap').hidden`;
  await page.evaluate(`document.querySelector('.settings-open').click()`);
  check(await until(page, open, 'the settings', 5000).then(() => true, () => false), 'the settings button opens the settings');
  // held until the settings have read it, two frames on
  await page.evaluate(`__press(0, true); new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`);
  await wait(200);
  check(await page.evaluate(`${COLOUR} === 'blue'`), 'the game waits while they\'re open');
  // A acts as it's let go, on what's picked, and the settings open with Back to the game picked
  await page.evaluate(`__press(0, false)`);
  check(await until(page, `!(${open})`, 'the settings to close', 5000).then(() => true, () => false), 'letting go of A presses Back to the game');
  await page.evaluate(`document.querySelector('.settings-open').click()`);
  await until(page, open, 'the settings', 5000);
  await page.evaluate(`document.querySelector('[data-controls]').click()`);
  await until(page, `[...document.querySelectorAll('.view')].some(v => !v.hidden && /Controls/.test(v.textContent) && /The console's Start/.test(v.textContent) && !/\\b(start|select|cross|circle|square|triangle|mode)\\b/.test(v.textContent))`, 'the controls', 5000);
  check(true, 'the settings list the game\'s controls');
  await page.evaluate(`document.querySelector('.view:not([hidden]) [data-back]')?.click()`);
  await wait(500);
  await page.evaluate(`document.querySelector('[data-close]').click()`);
  check(await until(page, `!(${open})`, 'the settings to close', 5000).then(() => true, () => false), 'and go back to the game');

  await page.evaluate(`__press(8, true); __press(9, true)`);
  check(await until(page, open, 'the settings', 5000).then(() => true, () => false), 'View and Menu together open them on a controller');
  await page.evaluate(`__press(8, false); __press(9, false)`);
  await wait(200);
  await page.evaluate(`__press(8, true); __press(9, true)`);
  check(await until(page, `!(${open})`, 'the settings to close', 5000).then(() => true, () => false), 'and close them');
  await page.evaluate(`__press(8, false); __press(9, false)`);

  // what a press leads to, the game's page in the launcher. That address is answered here, and never reached
  // a version in another language leads back to its game's page
  const home = `https://dreamports.net/dreamports/${game.split('/')[0]}-dreamport/`;
  const leadsHome = async press => {
    await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://dreamports.net/*', requestStage: 'Request' }] });
    const paused = page.once('Fetch.requestPaused');
    await page.evaluate(press);
    const request = await Promise.race([paused, wait(5000).then(() => null)]);
    if (request) await page.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200, body: '' });
    await page.send('Fetch.disable');
    return request?.request.url === home;
  };

  // the way out from the settings: the question first, in the same sheet
  const viewIs = name => `document.querySelector('.sheet').dataset.view === '${name}'`;
  await page.evaluate(`document.querySelector('.settings-open').click()`);
  await until(page, open, 'the settings', 5000);
  check(await page.evaluate(`document.querySelector('[data-quit]').previousElementSibling.matches('.resume')`), 'Quit the game stands under Back to the game');
  await page.evaluate(`document.querySelector('[data-quit]').click()`);
  check(await until(page, viewIs('quit'), 'the question', 5000).then(() => true, () => false), 'Quit the game asks first, in the settings');
  await wait(800);
  check(await page.evaluate(`document.activeElement.matches('.resume') && !!document.activeElement.closest('.view').querySelector('.quit-note')`), 'and Back to the game is picked');
  await page.evaluate(`document.querySelector('.view:not([hidden]) [data-back]').click()`);
  check(await until(page, viewIs('settings'), 'the settings', 5000).then(() => true, () => false), 'its way back returns to the settings');
  await wait(800);
  await page.evaluate(`document.querySelector('[data-quit]').click()`);
  await until(page, viewIs('quit'), 'the question', 5000);
  await wait(800);
  check(await leadsHome(`document.querySelector('[data-leave]').click()`), `Quit leads to the game's page in the launcher`);

  // the way back to the launcher, on the start screen
  await start();
  check(await leadsHome(`sessionStorage.clear(); document.querySelector('.setup-back').click()`), `the way back leads to the game's page in the launcher`);

  // a phone, with no controller: the controller drawn around the game presses its buttons
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
  await start();
  await page.evaluate(`window.__padOn = false; document.querySelector('.play').click()`);
  await until(page, `!document.getElementById('stage').hidden`, 'the game to start', 5000);
  await colour(BLUE);
  const a = await page.evaluate(`(() => { const e = document.querySelector('[data-pad-button="0"]'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
  check(!!a, 'a touch screen shows a controller around the game');
  if (a) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    check(await colour(GREEN), 'and a finger on it presses the button');
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(await colour(BLUE), 'and lets it go');
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  if (page.errors.length) check(false, `the page reported no errors: ${page.errors.join(' | ')}`);
  else check(true, 'the page reported no errors');
  page.errors.length = 0;
}

const TEST = 'made-up-game', TEST_C = 'made-up-game/c';
// a game in C on each of the other consoles, each in a folder of its own
const OTHERS = Object.keys(CONSOLES).filter(id => id !== 'gba').map(id => ({ id, game: `made-up-c-${id}` }));
const folder = gameFolder(TEST), folderC = gameFolder(TEST_C);
const temporary = join(LOCAL, 'tmp', 'test-game');
mkdirSync(temporary, { recursive: true });
for (const game of [TEST, ...OTHERS.map(other => other.game)]) {
  if (existsSync(gameFolder(game))) throw new Error(`games/${game}/ is already there, and this test makes and removes a folder of that name.`);
}
const write = (place, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(place, file)), { recursive: true });
    writeFileSync(join(place, file), text);
  }
};
const server = await serveRepository();
let page;
try {
  const { rom, sha1 } = madeUpGame();
  const original = { console: 'gba', name: 'Made Up Game (USA)', title: 'MADE UP GAME', code: 'MADE', sha1 };
  // the game's proof/original.json, which says its console, and so the kit in C it's built on
  write(folder, { 'proof/original.json': JSON.stringify(original) });
  write(folder, startingFiles(TEST, original));
  write(folderC, startingFiles(TEST, original, { language: 'c' }));
  await buildGame(folderC);
  writeFileSync(join(temporary, 'made-up.gba'), rom);
  for (const { id, game } of OTHERS) {
    const theirs = { console: id, name: 'Made Up Game (World)', title: 'MADE UP GAME', code: 'MADE', sha1 };
    write(gameFolder(game), { 'proof/original.json': JSON.stringify(theirs) });
    write(gameFolder(`${game}/c`), startingFiles(game, theirs, { language: 'c' }));
    writeFileSync(join(temporary, `made-up-${id}${CONSOLES[id].files[0]}`), rom);
  }
  page = await openChrome({ profile: join(LOCAL, 'chrome', 'test-game'), headless: true, controllers: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STAND_IN });
  await tryGame(page, server, TEST, join(temporary, 'made-up.gba'));
  await tryGame(page, server, TEST_C, join(temporary, 'made-up.gba'));
  for (const { id, game } of OTHERS) await tryGame(page, server, `${game}/c`, join(temporary, `made-up-${id}${CONSOLES[id].files[0]}`), id);

  // the games that are still only what new wrote
  for (const game of readdirSync(join(REPO, 'games'))) {
    const file = join(REPO, 'games', game, 'proof', 'original.json');
    if (game === TEST || game === TEST_C || !existsSync(file)) continue;
    const theirs = JSON.parse(readFileSync(file, 'utf8'));
    const same = Object.entries(startingFiles(game, theirs)).every(([path, text]) => existsSync(join(REPO, 'games', game, path)) && readFileSync(join(REPO, 'games', game, path), 'utf8') === text);
    if (!same) continue;
    const made = madeUpGame({ title: theirs.title, code: theirs.code });
    writeFileSync(join(temporary, `${game}.gba`), made.rom);
    await tryGame(page, server, game, join(temporary, `${game}.gba`));
  }
} finally {
  await page?.close();
  await server.close();
  rmSync(folder, { recursive: true, force: true });
  for (const { game } of OTHERS) rmSync(gameFolder(game), { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`);
  process.exitCode = 1;
} else console.log('\nEvery check passed.');
