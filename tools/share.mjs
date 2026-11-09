// npm run dp -- share <game> [--as <preview>] [--about "<what changed>"] [--clip <file>] [--fork <owner/name>] [--yes]:
// publishes a preview of the game as it is in the last commit, on GitHub Pages from the contributor's own fork, at
// <owner>.github.io/<fork>/<preview>/. A preview holds only code: the player gives it their own copy, as on
// dreamports.net. Beside it, apart from it, go the clips prove made of the original next to the Dreamport that show
// what this step changed and keep every rule of docs/STANDARD.md#clips, which only the step's pull request shows: every
// such clip, or the one --clip names, each with its measures beside it for the pull request's check
// (tools/clips-check.mjs). A step that changes the game's code or recordings has at least one, or share refuses it
// (#1030). share prints the lines for them, a frame that links the video and a link, and keeps every
// clip's lines for the branch in .dreamports/share/clips.md, to paste as they are, before it waits for Pages.
// share asks before it publishes and before it switches Pages on; --yes answers yes, once the contributor has said yes.
// npm run dp -- share --check <file>: refuses the pull request's text in <file> when a clip's frame or link is missing,
// or when it links a clip share didn't make for the branch, or has none when the branch changes a game's code or
// recordings.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename, dirname, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { LOCAL, gameFolder } from './lib/paths.mjs';
import { versionOf, versionTitle } from '../src/lib/languages.mjs';
import { head, uncommitted, remotes, fileAt, fetchPreviews, pushPreviews, makePreview, BRANCH, CLIPS } from './lib/preview.mjs';
import { clipProblems, staleness, mainBase, clipLinks, reportOf, gamesToShow, SHOW_IT } from './lib/clips.mjs';
import { UPSTREAM, api, signedInAs, findFork, hasCommit, pagesOf, turnOnPages, lastBuild, buildPages } from './lib/github.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// what the standard asks of a clip: an MP4 video, under about 2 MB
const CLIP_LIMIT = 2_000_000;
const GUIDE = `https://github.com/${UPSTREAM}/blob/main/docs/PREVIEWS.md`;
const USAGE = 'Usage: npm run dp -- share <game> [--as <preview>] [--about "<what changed>"] [--clip <file>] [--fork <owner/name>] [--yes]\n'
  + '       npm run dp -- share --check <the pull request\'s text>';
// every clip shared from the branch, with its lines for the pull request: { branch, clips: [{ key, lines }] }
const SAVED = join(LOCAL, 'share', 'clips.json');
const SAVED_LINES = join(LOCAL, 'share', 'clips.md');

// `team`, from team.mjs only, is a team build's preview, which shows its pieces, each with the clips of its own pull
// request, so it doesn't need one of its own
export async function run(args, { team = false } = {}) {
  const { game, as: name = game, about = '', clip: clipFile, fork: wanted, yes = false, check } = options(args);
  if (check) return checkText(check);
  if (!game) throw new Error(USAGE);
  if (!NAME.test(name) || name === CLIPS) throw new Error(`A preview's name is lowercase letters, numbers and single dashes, such as ${game}-springs, and isn't "${CLIPS}".`);

  // the commit and the game in it
  const { commit, branch } = head();
  if (!fileAt(commit, `games/${game}/index.html`)) throw new Error(`games/${game}/index.html isn't in your last commit: a preview is made from it.`);
  // a version in another language, such as sonic-battle/c, has the game's entry, and its title names the language
  const { game: own, language } = versionOf(game);
  const title = versionTitle(titleOf(commit, own), language);
  const left = uncommitted(game);
  if (left.length) console.log(`${left.length} changes in games/${game}/, kit/ or public/ aren't committed, so the preview leaves them out:\n${left.slice(0, 6).map(l => `  ${l}`).join('\n')}${left.length > 6 ? '\n  …' : ''}\n`);
  const built = await builtFrom(game, left);

  // the fork, and the address its Pages site has or will have
  const login = signedInAs();
  const fork = findFork(remotes(), wanted);
  let pages = pagesOf(fork.repository);
  if (pages && (pages.type !== 'legacy' || pages.branch !== BRANCH || pages.path !== '/')) {
    throw new Error(`${fork.repository}'s GitHub Pages already publishes something else (${pages.type === 'legacy' ? `the ${pages.branch} branch` : 'with a workflow'}), `
      + `and share needs it to publish the ${BRANCH} branch. Change it in the fork's Settings, under Pages, if you want previews there.`);
  }
  const url = pages?.url ?? predictedAddress(fork);
  const address = `${url}${name}/`;
  // the commit is linked only once GitHub has it, which it doesn't until the work is pushed, as /dreamport does
  const linked = hasCommit(fork.repository, commit);

  // the clips for the step's pull request, each with a frame of it and its measures: only clips prove made, of what
  // this step changed, five seconds or more, that move, of both in the same place when side by side, from a recording
  // that's committed as it was proven, against main as the branch starts from it (lib/clips.mjs)
  const base = mainBase();
  const chosen = chooseClips(game, clipFile, commit, base, { team });
  const shared = chosen.map(clip => ({ clip, files: clipFiles(game, commit, clip, undefined, base) }));
  const clips = shared.flatMap(s => s.files);

  const tip = fetchPreviews(fork.remote);
  const preview = makePreview({ tip, commit, branch, game, title, name, author: login, repository: fork.repository, linked, url, about, guide: GUIDE, clips, built });

  console.log(`A preview of ${title}, from commit ${commit.slice(0, 7)} on ${branch}:\n  ${address}`);
  console.log(`It holds ${preview.files} files, ${(preview.bytes / 1e6).toFixed(1)} MB, and only code: the game, its console's kit and the preview's own pages.`);
  console.log(`Anyone with the link can open it, on ${fork.repository}'s GitHub Pages. It says it hasn't been reviewed, and the player gives it their own copy.`);
  if (shared.length) console.log(`${shared.length === 1 ? 'The clip' : `${shared.length} clips`} for the pull request ${shared.length === 1 ? 'goes' : 'go'} on the same site, apart from the preview, for only the pull request to show: ${shared.map(s => `${url}${s.files[0].path}`).join(', ')}.`);
  if (!linked) console.log(`Commit ${commit.slice(0, 7)} isn't on GitHub yet, so the preview names it without a link.`);
  const turnOn = !pages;
  if (!(await ask(turnOn
    ? `\nGitHub Pages is off for ${fork.repository}. Switch it on, publishing the ${BRANCH} branch, and publish the preview?`
    : '\nPublish it?', yes))) {
    console.log('Nothing was published.');
    return 0;
  }

  pushPreviews(fork.remote, preview.commit);
  if (turnOn) {
    pages = turnOnPages(fork.repository, BRANCH);
    console.log(`GitHub Pages is on for ${fork.repository}.`);
  }
  const siteUrl = pages?.url ?? url;
  // the clips' lines are kept as soon as they're pushed, as their addresses are known, so a slow Pages build never
  // leaves a pull request to write them by hand. A clip kept from before that breaks a rule now goes, and a share with
  // no clip still says so for the branch, which --check reads
  let saved = stillGood(readSaved(), branch, commit, base);
  for (const { clip, files } of shared) saved = keepClip(saved, branch, clip.recording, clipLines(title, clip, files, siteUrl), measuresOf(clip, commit, base));
  if (!shared.length) saved = keepNone(saved, branch);
  mkdirSync(dirname(SAVED), { recursive: true });
  writeFileSync(SAVED, `${JSON.stringify(saved, null, 2)}\n`);
  writeFileSync(SAVED_LINES, `${savedLines(saved)}\n`);
  if (shared.length) {
    console.log(`\nFor the step's pull request, under Clips:\n\n${saved.clips.filter(c => shared.some(s => s.clip.recording === c.key)).map(c => c.lines).join('\n\n').replace(/^/gm, '  ')}`);
    console.log(`\n${saved.clips.length === 1 ? 'Its lines are' : `The lines of all ${saved.clips.length} clips shared from ${branch} are`} in .dreamports/share/clips.md. `
      + 'Paste that file under Clips as it is, frames and links, and check the text with npm run dp -- share --check <the filled-in template> '
      + 'before the pull request goes out or its text changes. Never write a clip\'s lines by hand.');
  }
  await waitUntilOnline(fork.repository, preview.commit, `${siteUrl}${name}/preview.json`, preview.made);
  console.log(`\nOnline: ${siteUrl}${name}/`);
  return 0;
}

function options(args) {
  const found = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--as', '--about', '--clip', '--fork', '--check'].includes(arg)) {
      if (args[i + 1] === undefined) throw new Error(`${arg} needs a value.\n${USAGE}`);
      found[arg.slice(2)] = args[++i];
    } else if (arg === '--yes') found.yes = true;
    else if (arg.startsWith('--')) throw new Error(`share has no ${arg}.\n${USAGE}`);
    else found.rest.push(arg);
  }
  if (found.rest.length > 1) throw new Error(USAGE);
  return { ...found, game: found.rest[0] };
}

async function ask(question, yes) {
  if (yes) {
    console.log(`${question} Yes (--yes).`);
    return true;
  }
  if (!process.stdin.isTTY) throw new Error('share asks before it publishes anything: run it in a terminal, or add --yes once you have said yes.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

// A game in C runs as WebAssembly, which the site builds from its C and no commit holds (kit/c/README.md), so a
// preview of one is built here, from the C as it is in the commit: [{ path, bytes }], or [] for a game in JavaScript.
async function builtFrom(game, left) {
  const src = join(gameFolder(game), 'src');
  if (!existsSync(src) || !readdirSync(src).some(name => name.endsWith('.c'))) return [];
  const { buildGame, consoleOfFolder, kitPaths } = await import('./lib/c.mjs');
  // the game's C, and its console's kit in C (kit/c/, with kit/gba/c/ on the Game Boy Advance and kit/nes/c/ on the NES)
  const kits = kitPaths(consoleOfFolder(gameFolder(game)));
  const changed = left.map(line => line.slice(3)).filter(path => path.startsWith(`games/${game}/src/`) || kits.some(kit => path.startsWith(kit)) || path === 'kit/consoles.js');
  if (changed.length) throw new Error(`Commit the C first, as the preview's game is built from it: ${changed.slice(0, 4).join(', ')}${changed.length > 4 ? ', …' : ''}.`);
  mkdirSync(join(LOCAL, 'share'), { recursive: true });
  const out = join(LOCAL, 'share', 'game.wasm');
  await buildGame(gameFolder(game), out);
  return [{ path: 'src/game.wasm', bytes: readFileSync(out) }];
}

// the game's name on the site: the title in its entry, games/<game>/entry.md
function titleOf(commit, game) {
  const text = fileAt(commit, `games/${game}/entry.md`)?.toString('utf8') ?? '';
  return /^title:\s*(.+)$/m.exec(text)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? game;
}

// where GitHub Pages will put the fork's site: <owner>.github.io/<fork>/, or the owner's own domain if they have one
function predictedAddress(fork) {
  const own = api(`repos/${fork.owner}/${fork.owner}.github.io/pages`);
  const host = own?.cname || `${fork.owner.toLowerCase()}.github.io`;
  return `https://${host}/${fork.name}/`;
}

// the clips for the pull request, which only pull requests may show (docs/STANDARD.md#clips): the one --clip names, or
// every clip prove made that keeps the rules, as a step that changed more than one recording shows each. Only prove's
// own side by side clips, from .dreamports/results/, can go, as clip.mp4: never the Dreamport's alone, dreamport.mp4,
// which shows nothing of whether it does what the original does (#1039).
// A recording that shows nothing this step changed is left out, and a clip of what it changed that breaks a rule stops
// share, as the pull request needs it. A step that changes the game's code or recordings with no clip to show stops it
// too (#1030), unless main doesn't have the game yet, as in its first entry (#1032). [{ file, bytes, still, sideBySide, recording, shows, report }]
export function chooseClips(game, file, commit, base, { team = false } = {}) {
  const results = join(LOCAL, 'results', game);
  const mustShow = !team && (gamesToShow(base, commit) ?? []).includes(game.split('/')[0]);
  const problemsOf = clip => clipProblems(clip.report, clip.report?.recordingFile ? fileAt(commit, clip.report.recordingFile) : null, { sideBySide: clip.sideBySide, base });
  if (file) {
    const clip = proveClip(results, resolve(file));
    const problems = problemsOf(clip);
    if (problems.length) throw new Error(`${clip.file} can't go in the pull request, so nothing was published:\n${problems.map(p => `  ${p}`).join('\n')}`);
    return [clip];
  }
  const made = existsSync(results) ? readdirSync(results).map(r => join(results, r, 'clip.mp4')).filter(existsSync).sort() : [];
  if (!made.length) {
    if (mustShow) throw new Error(`This step changes ${game.split('/')[0]}'s code or recordings, and prove has made no clip yet, so nothing was published: ${SHOW_IT}.`);
    console.log(`No clip: npm run dp -- prove ${game} makes them.\n`);
    return [];
  }
  const found = made.map(f => {
    const clip = proveClip(results, f);
    const committed = clip.report?.recordingFile ? fileAt(commit, clip.report.recordingFile) : null;
    return { clip, stale: staleness(clip.report, committed, { base }), problems: problemsOf(clip) };
  });
  const good = found.filter(f => !f.problems.length).map(f => f.clip);
  // only clips of what the step changed matter: one of a recording that shows nothing new isn't missing, and one prove
  // made before the last commit or merge of main, such as of a recording a step before this one played, says nothing
  const stale = found.filter(f => f.stale);
  const unchanged = found.filter(f => !f.stale && f.clip.report.clip.changed === null);
  const broken = found.filter(f => f.problems.length && !f.stale && !unchanged.includes(f));
  if (unchanged.length) console.log(`Left out, as they show nothing this step changed: ${unchanged.map(f => f.clip.recording).join(', ')}.`);
  if (stale.length) console.log(`Left out, as prove made them before the last commit or merge of main changed them: ${stale.map(f => f.clip.recording).join(', ')}. Prove them again if they show this step.`);
  if (broken.length && !good.length) {
    throw new Error(`No clip of what this step changed keeps the rules, so nothing was published:\n${broken.map(f => `  ${f.clip.recording}:\n${f.problems.map(p => `    ${p}`).join('\n')}`).join('\n')}`);
  }
  if (broken.length) console.log(`Left out, as they break a rule, though the clips that keep them go:\n${broken.map(f => `  ${f.clip.recording}: ${f.problems.join(' ')}`).join('\n')}\n`);
  if (!good.length && stale.length && !unchanged.length) {
    throw new Error('Every clip prove made is from before the last commit or merge of main changed its recording, so nothing was published: run npm run dp -- prove with every recording, then share again.');
  }
  if (!good.length && mustShow) {
    throw new Error(`This step changes ${game.split('/')[0]}'s code or recordings, but no recording shows anything it changed, so there's no clip of it, and nothing was published: ${SHOW_IT}.`);
  }
  if (!good.length) console.log('No recording shows anything this step changed, and it changes no game\'s code or recordings, so the preview goes without a clip.\n');
  return good;
}

// a clip prove made, from its folder in .dreamports/results/<game>/, with its frame and its report
function proveClip(results, file) {
  if (basename(file) === 'dreamport.mp4') {
    throw new Error(`${file} is the Dreamport on its own, and a pull request's clip shows the original next to it, every frame matching: share takes clip.mp4, beside it. `
      + 'If that one breaks a rule, port what its frames need and prove it again.');
  }
  if (!file.startsWith(results + sep) || basename(file) !== 'clip.mp4' || dirname(dirname(file)) !== results) {
    throw new Error(`${file} isn't a clip prove made. share takes only prove's own, as .dreamports/results/<game>/<recording>/clip.mp4, which it measured: `
      + 'never a video made another way.');
  }
  if (!existsSync(file)) throw new Error(`${file} isn't there: npm run dp -- prove makes it.`);
  const bytes = statSync(file).size;
  if (bytes > CLIP_LIMIT) throw new Error(`${basename(file)} is ${(bytes / 1e6).toFixed(1)} MB, and a clip stays under 2 MB: a shorter one is lighter.`);
  // a frame for the pull request: prove keeps dreamport.png beside dreamport.mp4, and clip-middle.png beside clip.mp4
  const base = join(dirname(file), basename(file, '.mp4'));
  const still = [`${base}.png`, `${base}-middle.png`].find(existsSync);
  if (!still) throw new Error(`${basename(file)} has no frame beside it, ${basename(base)}.png or ${basename(base)}-middle.png: prove the recording again.`);
  const recording = basename(dirname(file));
  // and who the original's own memory says it plays, which a reviewer who doesn't see the pictures can read
  // (src/lib/shows.mjs)
  let report = null;
  try {
    report = JSON.parse(readFileSync(join(dirname(file), 'report.json'), 'utf8'));
  } catch { /* prove didn't finish it */ }
  return { file, bytes, still, sideBySide: basename(file) === 'clip.mp4', recording, shows: report?.shows ?? null, report };
}

// what the pull request's check reads of a clip, published beside it: the measures prove made, and what they belong to
function measuresOf(clip, commit, base) {
  const { recording, recordingFile, recordingSha1, clip: measured } = clip.report;
  const { bytes, bitrate, dreamport, ...rest } = measured;
  return {
    clip: 'dreamports', recording, recordingFile, recordingSha1, commit, base, sideBySide: clip.sideBySide,
    video: createHash('sha1').update(readFileSync(clip.file)).digest('hex'), measures: rest,
  };
}

// where a clip, its frame and its measures go on the previews site. What's in the clip names it too, so a step's
// second clip, from the same commit, has an address of its own and leaves the first where its pull request shows it
export function clipFiles(game, commit, clip, day = new Date().toISOString().slice(0, 10), base = null) {
  const stamp = `${day}-${commit.slice(0, 7)}-${createHash('sha1').update(readFileSync(clip.file)).digest('hex').slice(0, 7)}`;
  return [
    { path: `${CLIPS}/${game}/${stamp}${extname(clip.file)}`, file: clip.file },
    ...(clip.still ? [{ path: `${CLIPS}/${game}/${stamp}-still.png`, file: clip.still }] : []),
    ...(clip.report ? [{ path: `${CLIPS}/${game}/${stamp}.json`, bytes: Buffer.from(`${JSON.stringify(measuresOf(clip, commit, base), null, 2)}\n`) }] : []),
  ];
}

// the clip as the pull request shows it: a frame that links the video
export function clipLines(title, clip, clips, siteUrl) {
  const video = `${siteUrl}${clips[0].path}`;
  const who = Object.entries(clip.shows ?? {}).map(([kind, value]) => `, and the original's ${kind} is ${typeof value === 'number' ? `${value}, which its original.json gives no name` : value}`).join('');
  const what = clip.sideBySide ? `, the original on the left and the Dreamport on the right, with the same button presses${who}` : '';
  const name = clip.recording ? `${title}, ${clip.recording}` : title;
  return [
    ...(clips[1] ? [`[![${name}: a frame of the clip](${siteUrl}${clips[1].path})](${video})`, ''] : []),
    `[Watch the clip${clip.recording ? ` of ${clip.recording}` : ''}](${video}) (MP4, ${(clip.bytes / 1e6).toFixed(1)} MB${what})`,
  ].join('\n');
}

function readSaved() {
  try {
    return JSON.parse(readFileSync(SAVED, 'utf8'));
  } catch {
    return null;
  }
}

// the branch's clips with this one added, or put in place of the one that played the same recording; another
// branch's clips are another step's, and are left out
export function keepClip(saved, branch, key, lines, measures) {
  const clips = saved?.branch === branch ? saved.clips.filter(c => c.key !== key) : [];
  return { branch, clips: [...clips, { key, lines, ...(measures ? { measures } : {}) }] };
}

// the branch's clips that still keep the rules, as the commit and main are now: one shared by mistake, or before the
// rules, or whose recording changed since, goes, rather than staying one the pull request has to show
export function stillGood(saved, branch, commit, base, read = fileAt) {
  if (saved?.branch !== branch) return saved;
  const clips = saved.clips.filter(c => {
    const problems = c.measures ? clipProblems(reportOf(c.measures), read(commit, c.measures.recordingFile), { sideBySide: c.measures.sideBySide, base }) : ['it was shared before share kept its measures'];
    if (problems.length) console.log(`The clip of ${c.key} shared from ${branch} before goes, as ${problems[0].replace(/^./, l => l.toLowerCase())}`);
    return !problems.length;
  });
  return { ...saved, clips };
}

export function keepNone(saved, branch) {
  return saved?.branch === branch ? saved : { branch, clips: [] };
}

export function savedLines(saved) {
  return saved.clips.map(c => c.lines).join('\n\n');
}

// the clip addresses in the text that no saved clip's lines hold
export function foreignLinks(text, saved) {
  const ours = new Set((saved?.clips ?? []).flatMap(c => clipLinks(c.lines)));
  return [...new Set(clipLinks(text))].filter(link => !ours.has(link));
}

// the lines of each saved clip the text leaves out: [{ key, lines: [the lines missing] }]
export function missingLines(text, saved) {
  const has = new Set(text.split('\n').map(line => line.trim()).filter(Boolean));
  return saved.clips
    .map(c => ({ key: c.key, lines: c.lines.split('\n').map(line => line.trim()).filter(line => line && !has.has(line)) }))
    .filter(c => c.lines.length);
}

// share --check: the pull request's text has every clip shared from this branch, each with its frame and link
function checkText(file) {
  if (!existsSync(file)) throw new Error(`${file} isn't there: give the pull request's text, filled in from .github/pull_request_template.md.`);
  const { branch, commit } = head();
  const saved = readSaved();
  if (saved?.branch !== branch) throw new Error(`Nothing has been shared from ${branch} yet, and a Dreamport's pull request shows its clips: run npm run dp -- share <game> first.`);
  // a clip shared before that no longer keeps the rules, such as after a merge of main, is shared again, not shown
  if (stillGood(saved, branch, commit, mainBase()).clips.length < saved.clips.length) {
    throw new Error(`A clip shared from ${branch} no longer keeps the rules, as it says above: prove its recording again and run npm run dp -- share <game> again.`);
  }
  if (!saved.clips.length) {
    if (clipLinks(readFileSync(file, 'utf8')).length) throw new Error(`share published no clip from ${branch}, so the text can't link one: take the clips' links out.`);
    const games = gamesToShow(mainBase(), commit) ?? [];
    if (games.length) throw new Error(`${branch} changes ${games.join(' and ')}'s code or recordings, and share published no clip of it: ${SHOW_IT}.`);
    console.log(`share found no clip to publish from ${branch}, so the text has none to show.`);
    return 0;
  }
  const text = readFileSync(file, 'utf8');
  // a clip share didn't make for this branch, such as one written by hand or kept from another step, never goes
  const foreign = foreignLinks(text, saved);
  if (foreign.length) {
    throw new Error(`The text links ${foreign.length === 1 ? 'a clip' : `${foreign.length} clips`} share didn't make for ${branch}: ${foreign.join(', ')}. `
      + 'Take them out, and paste .dreamports/share/clips.md under Clips as it is.');
  }
  const missing = missingLines(text, saved);
  if (missing.length) {
    throw new Error(`The text leaves out ${missing.length === 1 ? 'a clip\'s lines' : `${missing.length} clips' lines`}. Paste .dreamports/share/clips.md under Clips as it is, `
      + `or put these clips' lines there in place of theirs:\n\n${saved.clips.filter(c => missing.some(m => m.key === c.key)).map(c => c.lines).join('\n\n')}`);
  }
  console.log(`All ${saved.clips.length === 1 ? 'the clip\'s lines are' : `${saved.clips.length} clips' lines are`} in it, each frame with its link.`);
  return 0;
}

// waits for GitHub to build the Pages site with the new commit, then for the preview's address to serve it
async function waitUntilOnline(repository, pushed, probe, made) {
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const started = Date.now();
  let asked = false;
  process.stdout.write('Waiting for GitHub Pages to build it, usually a minute or two');
  for (;;) {
    const build = lastBuild(repository);
    if (build?.commit === pushed && build.status === 'errored') throw new Error(`\nGitHub couldn't build the Pages site: ${build.error ?? 'it gave no reason'}.`);
    if (build?.commit === pushed && build.status === 'built') break;
    // a site switched on with the branch already there may need asking once
    if (!asked && Date.now() - started > 60_000) {
      buildPages(repository);
      asked = true;
    }
    if (Date.now() - started > 10 * 60_000) {
      throw new Error(`\nGitHub hasn't built ${repository}'s Pages site after 10 minutes. Its Actions tab shows the build, called pages-build-deployment, `
        + 'and why it waits.');
    }
    process.stdout.write('.');
    await wait(5000);
  }
  for (const until = Date.now() + 5 * 60_000; Date.now() < until; await wait(5000)) {
    try {
      const served = await (await fetch(`${probe}?${Date.now()}`, { cache: 'no-store' })).json();
      if (served.made === made) {
        process.stdout.write('\n');
        return;
      }
    } catch {
      // not there yet
    }
    process.stdout.write('.');
  }
  throw new Error(`\nThe site was built, but ${probe} doesn't show the new preview yet: try the address again in a few minutes.`);
}
