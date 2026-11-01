// Chrome (or another Chromium browser) on the contributor's computer, opened with a profile folder of its own in
// .dreamports/ and driven over the DevTools protocol: headless for prove, in a window for play.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The browser to use: $CHROME, or Chrome, Chromium or Edge where they usually are. */
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  if (process.platform !== 'win32') {
    for (const name of names) {
      const found = spawnSync('which', [name], { encoding: 'utf8' });
      if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
    }
  }
  const paths = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    win32: [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(root => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]),
  }[process.platform] ?? [];
  const found = paths.find(p => existsSync(p));
  if (found) return found;
  throw new Error('No Chrome, Chromium or Edge found. Install Chrome, or set CHROME to the browser\'s program.');
}

// keeps the computer's controllers away from the page, so only the recorded buttons play
const NO_CONTROLLERS = `Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [] });
  for (const type of ['gamepadconnected', 'gamepaddisconnected']) addEventListener(type, e => e.stopImmediatePropagation(), true);`;

/**
 * Opens the browser. `profile` is its own folder, emptied first when `fresh`. Resolves to a page to drive:
 * { send, evaluate, once, errors, closed, close }.
 */
export async function openChrome({ profile, headless = true, fresh = true, controllers = !headless }) {
  // the last browser's helpers may still be writing their cache as they quit, so emptying it tries again for a moment
  if (fresh) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  mkdirSync(profile, { recursive: true });
  const portFile = join(profile, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const args = [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    ...(headless ? ['--headless=new', '--hide-scrollbars', '--mute-audio'] : []),
    'about:blank',
  ];
  const chrome = spawn(findChrome(), args, { stdio: 'ignore' });
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  let port;
  for (let i = 0; i < 300 && !port; i++) {
    if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0];
    else await wait(100);
  }
  if (!port) {
    chrome.kill();
    throw new Error('The browser didn\'t start.');
  }
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
    } catch {
      // not answering yet
    }
    if (!target) await wait(100);
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map(), listeners = new Set(), errors = [];
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    const p = message.params;
    if (message.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map(a => a.value ?? a.description).join(' '));
    for (const listener of [...listeners]) listener(message);
  });
  closed.then(() => {
    for (const { reject } of pending.values()) reject(new Error('The browser closed.'));
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) return reject(new Error('The browser closed.'));
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const once = method => new Promise(resolve => {
    const listener = message => {
      if (message.method !== method) return;
      listeners.delete(listener);
      resolve(message.params);
    };
    listeners.add(listener);
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  if (!controllers) await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_CONTROLLERS });
  const close = async () => {
    await Promise.race([send('Browser.close').catch(() => {}), wait(3000)]);
    socket.close();
    chrome.kill();
    await Promise.race([exited, wait(5000)]);
  };
  return { send, evaluate, once, errors, closed: Promise.race([closed, exited]), close };
}

/** Goes to an address and waits for the page to load. */
export async function go(page, url) {
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await loaded;
}

/** Waits until an expression in the page is true. */
export async function until(page, expression, what, limit = 60000) {
  const start = Date.now();
  while (!(await page.evaluate(expression))) {
    if (Date.now() - start > limit) throw new Error(`Timed out waiting for ${what}.`);
    await wait(100);
  }
}

/** Gives a file to the first file input that matches a selector, as if the contributor picked it. */
export async function giveFile(page, selector, path) {
  const { root } = await page.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`The page has no ${selector}.`);
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}
