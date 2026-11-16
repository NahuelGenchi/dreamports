// npm run dp -- reports [--site <address>]: fetches the reports players sent from a Dreamport's settings since the last
// time (docs/REPORTS.md), and writes each as a recording in .dreamports/reports/<game>/, on this computer, ready to be
// played next to the original. A report is the buttons a player held and the reason they chose, and nothing of who
// sent it. Only the owner's key reads them: it's kept in .dreamports/reports.key, which never goes in a commit, and
// the site holds the same key as its secret REPORTS_KEY.
//
// To try one, copy its file into the game's proof/recordings/ under a name of its own and run
// npm run dp -- prove <version> <name> --quick: where every frame matches, the Dreamport did what the cartridge does.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from './lib/paths.mjs';
import { writeRecording } from './lib/recording.mjs';
import { REASONS, readReport, unpackHeld } from '../kit/gba/report.js';

const SITE = 'https://dreamports.net';
const FOLDER = join(LOCAL, 'reports'), KEY = join(LOCAL, 'reports.key'), SEEN = join(FOLDER, 'seen.json');

/** A report as the site gives it, as the recording it is: { name, version, recording }, or null when it isn't one. */
export function recordingOf(row) {
  const report = readReport({ game: row.game, reason: row.reason, start: row.start, keptSave: row.kept_save === 1, frames: row.frames, buttons: String(row.buttons ?? '').split(' ').filter(Boolean), held: row.held });
  if (typeof report === 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(String(row.id))) return null;
  const day = new Date(Number(row.created)).toISOString().slice(0, 10);
  return {
    name: `report-${day}-${String(row.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    version: report.game,
    recording: {
      about: `A player's report of ${report.game}, sent from its settings on ${day}: ${REASONS[report.reason].toLowerCase()}. Say what it plays once it's been looked at.`,
      ...(report.start ? { start: report.start } : {}),
      frames: report.frames,
      held: unpackHeld(report.buttons, report.held),
      keptSave: report.keptSave,
    },
  };
}

export async function run(args) {
  const site = (args.includes('--site') ? args[args.indexOf('--site') + 1] : SITE)?.replace(/\/$/, '');
  if (!site || !/^https?:\/\//.test(site)) throw new Error('Usage: npm run dp -- reports [--site <address>]');
  if (!existsSync(KEY)) throw new Error('.dreamports/reports.key isn\'t there: it holds the key the site keeps as REPORTS_KEY, and only the site\'s owner has it.');
  const key = readFileSync(KEY, 'utf8').trim();
  const seen = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : {};
  let after = Number(seen[site] ?? 0), found = 0;
  const kept = [];
  for (;;) {
    const answer = await fetch(`${site}/api/reports?after=${after}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!answer.ok) throw new Error(`${site} didn't give its reports (${answer.status}): the key in .dreamports/reports.key has to be the site's REPORTS_KEY.`);
    const { reports } = await answer.json();
    if (!Array.isArray(reports) || !reports.length) break;
    for (const row of reports) {
      after = Math.max(after, Number(row.created) || 0);
      found++;
      // what the site sends is checked again here, as a report is only ever presses
      const read = recordingOf(row);
      if (!read) continue;
      const folder = join(FOLDER, read.version.replace('/', '-'));
      mkdirSync(folder, { recursive: true });
      const { keptSave, ...recording } = read.recording;
      writeRecording(join(folder, `${read.name}.json`), recording);
      kept.push(`${read.version}: ${read.name}, ${Math.round(recording.frames / 60)} seconds${keptSave ? ', from a game with a save' : ''}`);
    }
    if (reports.length < 50) break;
  }
  mkdirSync(FOLDER, { recursive: true });
  writeFileSync(SEEN, `${JSON.stringify({ ...seen, [site]: after }, null, 2)}\n`);
  if (!found) {
    console.log(`No new reports at ${site}.`);
    return 0;
  }
  console.log(`${kept.length} new report${kept.length === 1 ? '' : 's'} from ${site}, each a recording in .dreamports/reports/, on this computer:`);
  for (const line of kept) console.log(`  ${line}`);
  if (kept.length < found) console.log(`${found - kept.length} more weren't reports, and were left out.`);
  console.log('To try one, copy its file into the game\'s proof/recordings/ and prove it with --quick. One from a game with a save may differ from where the game first reads it.');
  return 0;
}
