// npm run dp -- reports [--site <address>] [--no-replay]: fetches the reports players sent from a Dreamport's settings
// since the last time (docs/REPORTS.md), writes each as a recording in .dreamports/reports/<game>/, on this computer,
// and plays each next to the original by itself, saying the frame where the Dreamport and the original part ways, or
// that they never do. A report is the buttons a player held, the reason they chose and the save their game started from
// when it had one, which is written beside the recording as <name>.<key>.sav and named in its "saves": the save
// memory's bytes, as a cartridge holds them where the Dreamport saves as its cartridge does (docs/STANDARD.md#saves),
// so both games start from it. Nothing of who sent it beyond what that save holds, and none of it leaves this
// computer. Only the owner's key reads the reports: it's kept in .dreamports/reports.key, which never goes in a commit,
// and the site holds the same key as its secret REPORTS_KEY.
//
// npm run dp -- reports --replay [name…] fetches nothing and plays the reports kept here again, all of them or those
// named, as after a fix. Playing one needs your copy of its game (npm run dp -- rom).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { LOCAL, REPO, resultFolder } from './lib/paths.mjs';
import { writeRecording } from './lib/recording.mjs';
import { proofVersions } from './lib/proof-files.mjs';
import { REASONS, readReport, unpackHeld, unpackSave } from '../kit/gba/report.js';

const SITE = 'https://dreamports.net';
const FOLDER = join(LOCAL, 'reports'), KEY = join(LOCAL, 'reports.key'), SEEN = join(FOLDER, 'seen.json');

/**
 * A report as the site gives it, as the recording it is: { name, version, recording, saves }, or null when it isn't
 * one. `saves` are the saves its game began from, each { key, packed }.
 */
export function recordingOf(row) {
  const report = readReport({ game: row.game, reason: row.reason, start: row.start, keptSave: row.kept_save === 1, saves: row.saves ?? [], frames: row.frames, buttons: String(row.buttons ?? '').split(' ').filter(Boolean), held: row.held });
  if (typeof report === 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(String(row.id))) return null;
  const day = new Date(Number(row.created)).toISOString().slice(0, 10);
  return {
    name: `report-${day}-${String(row.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    version: report.game,
    saves: report.saves,
    recording: {
      about: `A player's report of ${report.game}, sent from its settings on ${day}: ${REASONS[report.reason].toLowerCase()}. Say what it plays once it's been looked at.`,
      ...(report.start ? { start: report.start } : {}),
      frames: report.frames,
      held: unpackHeld(report.buttons, report.held),
      keptSave: report.keptSave,
    },
  };
}

/**
 * What playing a report found, in a line: `found` is one of prove's (proveReports), { result } or { error }, and
 * `picture` where the first frame that differs is shown. The first frame that differs is where the two part ways.
 */
export function partingLine(name, { result, error }, picture = '') {
  if (error) return `${name}: couldn't be played. ${error.replace(`${name}: `, '')}`;
  const first = result.differs[0]?.[0] ?? -1;
  if (first < 0) return `${name}: the Dreamport and the original stay the same for all ${result.frames} frames, so what the player saw is what the cartridge does.`;
  const sound = result.soundDiffers?.[0]?.[0] === first && !picture;
  return `${name}: the Dreamport and the original part ways at frame ${first} of ${result.frames}, ${Math.round(first / 60)} seconds in, in ${sound ? 'their sound' : 'what they show'}${picture ? `: ${picture}` : ''}.`;
}

// the version a folder of reports is of: its name with the slash of a version in another language as a hyphen
const versionOfFolder = folder => proofVersions().find(version => version.replace('/', '-') === folder) ?? null;

/** Plays reports next to the original, each { version, file }, a version's together, and says where each parts ways. */
async function replay(reports) {
  if (!reports.length) return;
  // prove is only needed, with all it brings, when there's something to play
  const { proveReports } = await import('./prove.mjs');
  console.log('\nPlayed next to the original, each from the save it began from when it carries one:');
  const versions = [...new Set(reports.map(report => report.version))];
  for (const version of versions) {
    const files = reports.filter(report => report.version === version).map(report => report.file);
    if (!proofVersions().includes(version)) {
      for (const file of files) console.log(`  ${basename(file, '.json')}: ${version} isn't a Dreamport in games/, so it wasn't played.`);
      continue;
    }
    const say = text => process.stdout.isTTY && process.stdout.write(text ? `\r${`${version}: ${text}`.padEnd(70)}` : `\r${''.padEnd(70)}\r`);
    // a picture from the last time it was played isn't this time's
    for (const file of files) rmSync(join(resultFolder(version, basename(file, '.json')), 'first-difference.png'), { force: true });
    let found;
    try {
      found = await proveReports(version, files, { say });
    } catch (error) {
      found = files.map(file => ({ file, error: error.message }));
    }
    say('');
    for (const each of found) {
      const name = basename(each.file, '.json'), picture = join(resultFolder(version, name), 'first-difference.png');
      console.log(`  ${version}, ${partingLine(name, each, existsSync(picture) ? relative(REPO, picture).replaceAll('\\', '/') : '')}`);
    }
  }
  console.log('The pictures stay on this computer. A report that parts ways shows a bug worth an issue: say what it plays, never what its save holds.');
}

export async function run(args) {
  const usage = 'Usage: npm run dp -- reports [--site <address>] [--no-replay], or npm run dp -- reports --replay [name…]';
  if (args.includes('--replay')) {
    const names = args.filter(arg => !arg.startsWith('--'));
    const kept = !existsSync(FOLDER) ? [] : readdirSync(FOLDER, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      const version = versionOfFolder(entry.name);
      return readdirSync(join(FOLDER, entry.name)).filter(file => file.endsWith('.json')).map(file => ({ version: version ?? entry.name, file: join(FOLDER, entry.name, file) }));
    }).filter(report => !names.length || names.includes(basename(report.file, '.json')));
    const missing = names.filter(name => !kept.some(report => basename(report.file, '.json') === name));
    if (missing.length) throw new Error(`.dreamports/reports/ has no report called ${missing.join(', ')}.`);
    if (!kept.length) {
      console.log('No reports are kept on this computer yet: npm run dp -- reports fetches them.');
      return 0;
    }
    await replay(kept);
    return 0;
  }
  const site = (args.includes('--site') ? args[args.indexOf('--site') + 1] : SITE)?.replace(/\/$/, '');
  if (!site || !/^https?:\/\//.test(site)) throw new Error(usage);
  if (!existsSync(KEY)) throw new Error('.dreamports/reports.key isn\'t there: it holds the key the site keeps as REPORTS_KEY, and only the site\'s owner has it.');
  const key = readFileSync(KEY, 'utf8').trim();
  const seen = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : {};
  let after = Number(seen[site] ?? 0), found = 0;
  const kept = [], written = [];
  for (;;) {
    const answer = await fetch(`${site}/api/reports?after=${after}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!answer.ok) throw new Error(`${site} didn't give its reports (${answer.status}): the key in .dreamports/reports.key has to be the site's REPORTS_KEY.`);
    const { reports } = await answer.json();
    if (!Array.isArray(reports) || !reports.length) break;
    for (const row of reports) {
      after = Math.max(after, Number(row.created) || 0);
      found++;
      // what the site sends is checked again here, as a report is only ever presses and a save
      const read = recordingOf(row);
      if (!read) continue;
      const folder = join(FOLDER, read.version.replace('/', '-'));
      mkdirSync(folder, { recursive: true });
      // the saves it began from, beside it, and named in it for prove to start from: what isn't a save is left out
      const saves = {};
      for (const { key: saveKey, packed } of read.saves) {
        const bytes = await unpackSave(packed);
        if (!bytes) continue;
        saves[saveKey] = `${read.name}.${saveKey}.sav`;
        writeFileSync(join(folder, saves[saveKey]), bytes);
      }
      const { keptSave, ...recording } = read.recording;
      const file = join(folder, `${read.name}.json`);
      writeRecording(file, { ...recording, saves });
      written.push({ version: read.version, file });
      kept.push(`${read.version}: ${read.name}, ${Math.round(recording.frames / 60)} seconds${Object.keys(saves).length ? ', with the save it began from' : keptSave ? ', from a game with a save it doesn\'t carry, so it may differ from where the game first reads it' : ''}`);
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
  if (args.includes('--no-replay')) console.log('None was played: npm run dp -- reports --replay plays them next to the original.');
  else await replay(written);
  return 0;
}
