// Chrome (or another Chromium browser) on the contributor's computer, opened with a profile folder of its own in
// .dreamports/ and driven over the DevTools protocol: headless for prove, in a window for play.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// whether any process of the browser with this profile is still running: its helpers have the folder in their command lines too
const running = profile => spawnSync('ps', ['-Awwo', 'args='], { encoding: 'utf8' }).stdout?.replaceAll('\n', ' ').includes(`--user-data-dir=${profile} `);

// the browser left behind by a run that was stopped partway, on Windows, where nothing else can find it
const stopBrowserOf = profile => spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command',
  'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:DREAMPORTS_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'],
{ env: { ...process.env, DREAMPORTS_PROFILE: `--user-data-dir=${profile}` }, stdio: 'ignore' });

// one nobody sees, left behind the same way elsewhere: it would go on working for nobody, and each close would wait for it.
// A profile belongs to one folder's copy of one tool, and two runs of that can't share it anyway
const stopUnseenBrowserOf = profile => {
  for (const line of spawnSync('ps', ['-Awwo', 'pid=,args='], { encoding: 'utf8' }).stdout?.split('\n') ?? []) {
    if (!line.includes(`--user-data-dir=${profile} `)) continue;
    try {
      process.kill(parseInt(line), 'SIGKILL');
    } catch {
      // gone already
    }
  }
};

// a browser that has just quit can hold files in its profile for a moment, which Windows won't delete, and one left
// behind by a run that was stopped partway holds them until it's stopped
async function emptied(profile) {
  for (let tries = 100; ; tries--) {
    try {
      return rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      if (!tries) throw error;
      if (tries === 50 && process.platform === 'win32') stopBrowserOf(profile);
      await wait(100);
    }
  }
}

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

// Nothing it would fetch or start for itself, in a window or not (--optimize-for-size: the page's memory falls by more than a
// third, and a frame takes no longer; the on-device model's helper starts about three minutes in, and holds 40 MB)
const QUIET = ['--js-flags=--optimize-for-size', '--disable-extensions', '--disable-component-update', '--disable-background-networking', '--disable-sync', '--no-pings', '--disable-default-apps',
  '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--disable-breakpad', '--metrics-recording-only',
  '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,AutofillServerCommunication,OptimizationGuideOnDeviceModel,OnDeviceModelPerformanceParams'];
// A browser nobody sees needs no graphics chip. A window keeps it, as a person sees it stutter without: drawing it on the
// processor saves little power, and it was 5 times as often late. Graphics in the browser's own process (--in-process-gpu)
// would save 18 MB, and end the browser wherever they can't start, such as on GitHub's machines or with a dead DISPLAY
const UNSEEN = ['--headless=new', '--hide-scrollbars', '--mute-audio', '--disable-gpu', '--window-size=320,240', ...QUIET];

/**
 * Opens the browser. `profile` is its own folder, emptied first when `fresh`. Resolves to a page to drive:
 * { send, evaluate, once, errors, closed, close }, with `another()`, which closes this page and resolves to a new one
 * with nothing of its own saved, in the same browser, so the next recording needn't start a browser again.
 */
export async function openChrome({ profile, headless = true, fresh = true, controllers = !headless }) {
  if (headless) stopUnseenBrowserOf(profile);
  if (fresh) await emptied(profile);
  mkdirSync(profile, { recursive: true });
  const portFile = join(profile, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const args = [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    ...(headless ? UNSEEN : QUIET),
    'about:blank',
  ];
  const chrome = spawn(findChrome(), args, { stdio: 'ignore' });
  // a tool that's stopped, or ends on an error, takes with it a browser nobody could close by hand
  if (headless) {
    process.once('exit', () => chrome.kill('SIGKILL'));
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => process.exit(1));
  }
  try {
    return await drive(chrome, portFile, profile, headless, controllers);
  } catch (error) {
    // nothing else would close it, and the tools wouldn't end while it's open
    chrome.kill();
    throw error;
  }
}

async function drive(chrome, portFile, profile, headless, controllers) {
  let ended = false;
  const exited = new Promise(resolve => chrome.once('exit', () => {
    ended = true;
    resolve();
  }));
  // a browser's first start on a computer can be slow, and one that has ended won't start any more
  const giveUp = Date.now() + 120000;
  let port;
  while (Date.now() < giveUp && !ended && !port) {
    try {
      // it holds its port on the first line, and the file's done once there's a second
      const [first, second] = readFileSync(portFile, 'utf8').split('\n');
      if (second !== undefined) port = first;
    } catch {
      // not there yet, or on Windows still being written
    }
    if (!port) await wait(100);
  }
  if (!port) {
    // a window needs a screen, which a terminal on a server or in an old WSL doesn't have
    const noScreen = !headless && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    throw new Error(noScreen ? 'The browser\'s window can\'t open, since this terminal has no screen to show it on. In WSL on Windows, run wsl --update in a Windows terminal, then open WSL again.' : 'The browser didn\'t start.');
  }
  let target;
  while (Date.now() < giveUp && !ended && !target) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { headers: { connection: 'close' } })).json()).find(t => t.type === 'page');
    } catch {
      // not answering yet
    }
    if (!target) await wait(100);
  }
  if (!target) throw new Error('The browser didn\'t start.');
  const close = async () => {
    await Promise.race([first.send('Browser.close').catch(() => {}), wait(3000)]);
    first.disconnect();
    chrome.kill();
    await Promise.race([exited, wait(5000)]);
    // its helpers outlive it for a moment, and the network service writes to the profile as it quits, so the folder
    // can't be emptied for the next browser until they've gone
    for (let i = 0; i < 100 && running(profile); i++) await wait(50);
  };
  // the page it opened with, then each of the others, in a context of its own with nothing saved. `close` ends the browser
  const another = async old => {
    const socket = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`, { headers: { connection: 'close' } })).json()).webSocketDebuggerUrl);
    if (old.context) await socket.send('Target.disposeBrowserContext', { browserContextId: old.context });
    const { browserContextId } = await socket.send('Target.createBrowserContext');
    const { targetId } = await socket.send('Target.createTarget', { url: 'about:blank', browserContextId });
    // the browser's first page goes only once there's another, as a browser with no page may end
    if (!old.context) await socket.send('Target.closeTarget', { targetId: old.targetId });
    old.disconnect();
    socket.disconnect();
    return page(await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`), { targetId, context: browserContextId });
  };
  const page = async (driver, ids) => {
    const me = { ...driver, ...ids, close, closed: Promise.race([driver.closed, exited]), another: () => another(me) };
    await driver.send('Page.enable');
    await driver.send('Runtime.enable');
    await driver.send('DOM.enable');
    if (!controllers) await driver.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_CONTROLLERS });
    first = me;
    return me;
  };
  let first = null;
  return page(await connect(target.webSocketDebuggerUrl), { targetId: target.id });
}

/** Talks to a page or the browser over the DevTools protocol. */
async function connect(url) {
  const socket = new WebSocket(url);
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
  return { send, evaluate, once, errors, closed, disconnect: () => socket.close() };
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
