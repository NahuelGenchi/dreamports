// Reports that couldn't go yet (ui/report-view.js): where the site can't take a player's report at that moment, as when
// it has had too many or the connection is down, the report is kept here, in the browser's own storage on the player's
// device, and sent for them the next time a Dreamport opens. The player isn't asked to wait or to come back: the
// report already holds what they played, from the moment it happened. A few are kept at most, and none for longer
// than a week, so nothing piles up, and nothing leaves the device until it's sent.

import { browserStorage } from './save.js';
import { readReport } from './report.js';

const KEY = 'dreamports.reports';
/** How many reports wait at most, and for how many days. */
export const WAITING_MOST = 3;
export const WAITING_DAYS = 7;
const DAY = 86_400_000;

/** The reports waiting in `storage`, oldest first, each { report, kept }: those still reports, and kept within a week. */
export function waitingReports(storage = browserStorage(), now = Date.now()) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(each => each && typeof each.kept === 'number' && now - each.kept < WAITING_DAYS * DAY && now >= each.kept && typeof readReport(each.report) === 'object')
      .map(each => ({ report: readReport(each.report), kept: each.kept })).slice(-WAITING_MOST);
  } catch {
    return [];   // storage blocked, or not what this keeps
  }
}

/** Keeps the waiting reports as `list` has them; returns whether they were kept. */
export function setWaitingReports(list, storage = browserStorage()) {
  try {
    if (!storage) return false;
    if (list.length) storage.setItem(KEY, JSON.stringify(list.slice(-WAITING_MOST)));
    else storage.removeItem(KEY);
    return true;
  } catch {
    return false;   // storage blocked or full
  }
}

/** Keeps `report` to send later, the newest of at most WAITING_MOST; returns whether it was kept. */
export function keepReport(report, storage = browserStorage(), now = Date.now()) {
  // as the site would read it, so the same report twice is one, and what isn't a report isn't kept
  const read = readReport(report);
  if (typeof read !== 'object') return false;
  const same = JSON.stringify(read);
  const others = waitingReports(storage, now).filter(each => JSON.stringify(each.report) !== same);
  return setWaitingReports([...others, { report: read, kept: now }], storage);
}

/**
 * What became of a report the site was sent, from its answer's status (0 when it never got there): 'sent', 'later'
 * when sending again another time can work, as with a limit, a check that didn't pass or trouble on the way, or
 * 'refused' when the site says it isn't a report, which no other time changes.
 */
export function outcomeOf(status) {
  if (status >= 200 && status < 300) return 'sent';
  return status === 400 || status === 413 ? 'refused' : 'later';
}

/**
 * Sends the waiting reports, each with `send(report)`, which resolves to an answer's status, or 0. Those sent or
 * refused go, and the rest wait on. It stops at the first that has to wait, as the others would too. Returns how many
 * were sent.
 */
export async function sendWaitingReports(send, storage = browserStorage(), now = Date.now()) {
  const list = waitingReports(storage, now);
  let sent = 0;
  while (list.length) {
    const outcome = outcomeOf(await send(list[0].report));
    if (outcome === 'later') break;
    if (outcome === 'sent') sent++;
    list.shift();
    setWaitingReports(list, storage);
  }
  return sent;
}
