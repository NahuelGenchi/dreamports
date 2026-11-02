// Opens a Dreamport's page in the browser with the contributor's copy, as a player would: the kit's start screen
// takes the copy, and Play starts the game. With ?proof in the address, the kit's proof mode then waits for a tool
// to run each frame (kit/gba/proof.js).

import { go, until, giveFile } from './chrome.mjs';

/** Loads games/<game>/ with `query`, gives it the copy and, when `start`, presses Play and waits for the game. */
export async function openDreamport(page, server, game, copy, { query = '', start = true } = {}) {
  await go(page, `${server.url}/games/${game}/${query}`);
  await until(page, `document.querySelector('.setup')?.dataset.restored === 'true' && !!document.querySelector('.rom input[type=file]')`, 'the game\'s start screen, where it takes the copy');
  // what it says about this copy: a page that kept one from last time has read that by now, and has Play ready before it starts reading this
  await page.evaluate(`window.__copyRead = false; new MutationObserver(records => { if (records.some(r => r.target.matches('.rom') && r.target.dataset.state !== 'reading')) window.__copyRead = true; }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] })`);
  await giveFile(page, '.rom input[type=file]', copy);
  const wrong = `document.querySelector('[data-kind="error"]')?.textContent.trim()`;
  await until(page, `window.__copyRead || !!${wrong}`, 'the game to read the copy');
  const refused = await page.evaluate(wrong);
  if (refused) throw new Error(`The game didn't take the copy: ${refused}`);
  await until(page, `!document.querySelector('.play').disabled`, 'Play to be ready', 5000);
  if (!start) return;
  if (!(await page.evaluate(`typeof dreamportsProof === 'object'`)) && query.includes('proof')) {
    throw new Error(`games/${game}/ has no proof mode: its page calls proof?.watch(screen, input) from the kit (kit/gba/README.md).`);
  }
  await page.evaluate(`document.querySelector('.play').click()`);
  if (query.includes('proof')) await page.evaluate(`Promise.race([dreamportsProof.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('The game didn\\'t start.')), 60000))])`);
}
