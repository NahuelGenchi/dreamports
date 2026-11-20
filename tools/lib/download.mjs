// What the tools fetch from the web at a fixed version, such as a compiler's source: checked against the SHA-256 the
// tools pin, from its own address or, when that one fails, from the next, a copy of it elsewhere, each tried a few
// times with a short wait between, as a runner's network drops a request now and then (#1558).

import { createHash } from 'node:crypto';

const TRIES = 3;
// the wait before the second try, and twice that before the third
const WAIT = 3000;
// how long one try may take, as a server that stops answering would hold the tools for ever
const TIMEOUT = 300_000;

const pause = ms => new Promise(done => setTimeout(done, ms));

/** Why a fetch failed, in words: what the network said, which Node.js keeps in the error's cause, or in each of the
 *  errors of one that gathers them, as a failed connection to each of a server's addresses. */
export function whyFailed(error) {
  const said = [];
  for (let each = error, depth = 0; each && depth < 4; each = each.cause, depth++) {
    for (const one of each.errors ?? [each]) {
      const words = [one.code, one.message].filter(Boolean).join(' ');
      if (words && words !== 'fetch failed' && !said.includes(words)) said.push(words);
    }
  }
  return said.join(': ') || (error?.name === 'TimeoutError' ? `no answer in ${TIMEOUT / 1000} seconds` : 'the network gave no reason');
}

/**
 * The bytes of `what`, from the first of `urls` that gives them: one address, or a list of them, the file's own and
 * then copies of it, each tried up to three times, with three and then six seconds between. Bytes whose SHA-256 isn't
 * `sha256` are never used. An address that answers that it hasn't the file, or gives other bytes, isn't asked again.
 * `log`, if given, hears of each try that failed. When none gives them, the error says, for each address, why.
 */
export async function fetchChecked(urls, sha256, what, { log = null, tries = TRIES, wait = WAIT } = {}) {
  const failed = [];
  for (const url of [urls].flat()) {
    const reasons = [];
    for (let attempt = 1; attempt <= tries; attempt++) {
      let response, bytes;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
        if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        reasons.push(whyFailed(error));
      }
      if (bytes) {
        if (createHash('sha256').update(bytes).digest('hex') === sha256) return bytes;
        reasons.push(`it gave other bytes than ${what} as the tools know it`);
        break;
      }
      if (response && !response.ok) {
        reasons.push(`it answered ${response.status}`);
        // an address that says it hasn't the file won't have it a moment later, while one that's busy may
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) break;
      }
      if (attempt < tries) {
        log?.(`${url} failed (${reasons.at(-1)}), so it's asked again in ${(wait * attempt) / 1000} seconds…`);
        await pause(wait * attempt);
      }
    }
    const tried = reasons.length > 1 ? `, ${reasons.length} times` : '';
    failed.push(`${url}${tried}: ${[...new Set(reasons)].join('; ')}`);
  }
  throw new Error(`${what[0].toUpperCase()}${what.slice(1)} couldn't be got. ${failed.join('. ')}.`);
}
