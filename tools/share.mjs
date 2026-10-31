// npm run dp -- share <game> [--as <preview>] [--post --about "<what changed>"] [--clip <file>] [--fork <owner/name>]
// [--yes]: publishes a preview of the game as it is in the last commit, on GitHub Pages from the contributor's own
// fork, at <owner>.github.io/<fork>/<preview>/. With --post it also posts in the game's progress thread, in the
// repository's Discussions, from the contributor's own account: what changed, a clip of the Dreamport next to the original, its two numbers,
// its progress map as it is in that commit, and the preview's link. A preview holds only code: the player gives it their own copy, as on dreamports.net. share
// asks before it publishes, before it switches Pages on and before it posts; --yes answers yes, once the
// contributor has said yes.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename, dirname, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { LOCAL } from './lib/paths.mjs';
import { head, uncommitted, remotes, fileAt, filesAt, fetchPreviews, pushPreviews, makePreview, BRANCH, CLIPS } from './lib/preview.mjs';
import { percentText, proofOf } from '../src/lib/entries.mjs';
import { progressMap } from '../src/lib/progress-map.mjs';
import {
  UPSTREAM, api, signedInAs, findFork, pagesOf, turnOnPages, lastBuild, buildPages, progressCategory, threadOf, openThread, postIn,
} from './lib/github.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// what the standard asks of a clip: an MP4 video or a PNG picture, under about 2 MB
const CLIP_LIMIT = 2_000_000;
const GUIDE = `https://github.com/${UPSTREAM}/blob/main/docs/PREVIEWS.md`;
const USAGE = 'Usage: npm run dp -- share <game> [--as <preview>] [--post --about "<what changed>"] [--clip <file>] [--fork <owner/name>] [--yes]';

export async function run(args) {
  const { game, as: name = game, about = '', post = false, clip: clipFile, fork: wanted, yes = false } = options(args);
  if (!game) throw new Error(USAGE);
  if (!NAME.test(name) || name === CLIPS) throw new Error(`A preview's name is lowercase letters, numbers and single dashes, such as ${game}-springs, and isn't "${CLIPS}".`);
  if (post && !about.trim()) throw new Error('A post says what changed: add --about "<what changed>".');

  // the commit and the game in it
  const { commit, branch } = head();
  if (!fileAt(commit, `games/${game}/index.html`)) throw new Error(`games/${game}/index.html isn't in your last commit: a preview is made from it.`);
  const title = titleOf(commit, game);
  const left = uncommitted(game);
  if (left.length) console.log(`${left.length} changes in games/${game}/, kit/ or public/ aren't committed, so the preview leaves them out:\n${left.slice(0, 6).map(l => `  ${l}`).join('\n')}${left.length > 6 ? '\n  …' : ''}\n`);

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

  // what the post says, and the clip that goes with it
  const clip = post ? chooseClip(game, clipFile) : null;
  const stamp = `${new Date().toISOString().slice(0, 10)}-${commit.slice(0, 7)}`;
  const clips = clip ? [
    { path: `${CLIPS}/${game}/${stamp}${extname(clip.file)}`, file: clip.file },
    ...(clip.still ? [{ path: `${CLIPS}/${game}/${stamp}-still.png`, file: clip.still }] : []),
  ] : [];
  const map = post ? mapAt(commit, game, title, stamp) : null;
  let thread = null, category = null;
  if (post) {
    category = progressCategory();
    thread = threadOf(category.categoryId, game);
  }
  const postText = siteUrl => postBody({ about, title, clip, clips, map, siteUrl, numbers: numbersAt(commit, game), address: `${siteUrl}${name}/`, fork, commit, branch });

  const tip = fetchPreviews(fork.remote);
  const preview = makePreview({ tip, commit, branch, game, title, name, author: login, repository: fork.repository, url, about, guide: GUIDE, clips: [...clips, ...(map ? [map] : [])] });

  console.log(`A preview of ${title}, from commit ${commit.slice(0, 7)} on ${branch}:\n  ${address}`);
  console.log(`It holds ${preview.files} files, ${(preview.bytes / 1e6).toFixed(1)} MB, and only code: the game, its console's kit and the preview's own pages.`);
  console.log(`Anyone with the link can open it, on ${fork.repository}'s GitHub Pages. It says it hasn't been reviewed, and the player gives it their own copy.`);
  if (clips.length) console.log(`The clip for the post goes on the same site, apart from the preview: ${clips.map(c => `${url}${c.path}`).join(' and ')}.`);
  const turnOn = !pages;
  if (!(await ask(turnOn
    ? `\nGitHub Pages is off for ${fork.repository}. Switch it on, publishing the ${BRANCH} branch, and publish the preview?`
    : '\nPublish it?', yes))) {
    console.log('Nothing was published.');
    return 0;
  }
  let posting = false;
  if (post) {
    console.log(`\nThe post, from your account (${login}), in ${thread ? `${thread.title}: ${thread.url}` : `a new thread for ${title} in the Progress category of ${UPSTREAM}'s Discussions`}:\n`);
    console.log(postText(url).replace(/^/gm, '  | '));
    posting = await ask('\nPost it once the preview is online?', yes);
    if (!posting) console.log('It won\'t be posted.');
  }

  pushPreviews(fork.remote, preview.commit);
  if (turnOn) {
    pages = turnOnPages(fork.repository, BRANCH);
    console.log(`GitHub Pages is on for ${fork.repository}.`);
  }
  const siteUrl = pages?.url ?? url;
  await waitUntilOnline(fork.repository, preview.commit, `${siteUrl}${name}/preview.json`, preview.made);
  console.log(`\nOnline: ${siteUrl}${name}/`);

  if (posting) {
    if (!thread) {
      thread = openThread(category, game, title, `${title}, made in games/${game}/. One post per step: what changed, a clip, its two numbers and a preview.`);
      console.log(`Opened ${title}'s progress thread: ${thread.url}\nAdd it to games/${game}/entry.md as \`thread: ${thread.url}\`, so the game's page links it.`);
    }
    console.log(`Posted: ${postIn(thread.id, postText(siteUrl))}`);
  }
  return 0;
}

function options(args) {
  const found = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--as', '--about', '--clip', '--fork'].includes(arg)) {
      if (args[i + 1] === undefined) throw new Error(`${arg} needs a value.\n${USAGE}`);
      found[arg.slice(2)] = args[++i];
    } else if (arg === '--post' || arg === '--yes') found[arg.slice(2)] = true;
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
  if (!process.stdin.isTTY) throw new Error('share asks before it publishes or posts anything: run it in a terminal, or add --yes once you have said yes.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
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

// the clip for the post: the one named, or the newest clip prove made of the original and the Dreamport side by
// side, which progress posts may show (docs/STANDARD.md#clips)
function chooseClip(game, file) {
  const results = join(LOCAL, 'results', game);
  if (!file) {
    const made = existsSync(results)
      ? readdirSync(results).map(r => join(results, r, 'clip.mp4')).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      : [];
    if (!made.length) {
      console.log(`No clip: npm run dp -- prove ${game} makes one of the Dreamport, and --clip <file> picks another.\n`);
      return null;
    }
    file = made[0];
  }
  file = resolve(file);
  if (!existsSync(file)) throw new Error(`${file} isn't there.`);
  if (!['.mp4', '.png'].includes(extname(file).toLowerCase())) throw new Error('A clip is an MP4 video or a PNG picture, as the standard asks.');
  const bytes = statSync(file).size;
  if (bytes > CLIP_LIMIT) throw new Error(`${basename(file)} is ${(bytes / 1e6).toFixed(1)} MB, and a clip stays under 2 MB: a shorter one is lighter.`);
  // a frame for the post: prove keeps dreamport.png beside dreamport.mp4, and clip-middle.png beside clip.mp4
  const base = extname(file) === '.mp4' ? join(dirname(file), basename(file, '.mp4')) : null;
  const still = base && [`${base}.png`, `${base}-middle.png`].find(existsSync);
  const sideBySide = file.startsWith(join(LOCAL, 'results') + sep) && /^clip(-[a-z]+)?\.(mp4|png)$/.test(basename(file));
  return { file, bytes, still: still ?? null, sideBySide };
}

// the game's proof files in the last commit, as proofOf takes them
function proofFilesAt(commit, game) {
  const folder = `games/${game}/proof`;
  const read = path => {
    const file = fileAt(commit, `${folder}/${path}`);
    return file ? JSON.parse(file.toString('utf8')) : undefined;
  };
  const recordings = Object.fromEntries(filesAt(commit, `${folder}/recordings`).filter(f => f.path.endsWith('.json'))
    .map(f => [basename(f.path, '.json'), read(`recordings/${basename(f.path)}`)]));
  return {
    original: read('original.json'), map: read('code-map.json'), progress: read('progress.json'),
    portMap: read('port-map.json'), parts: read('parts.json'), recordings,
  };
}

// the game's progress map in the last commit, for the post: written to .dreamports/ and put next to the clips under a
// name of its own, so each post keeps the map as it was then. Null when it can't be drawn.
function mapAt(commit, game, title, stamp) {
  try {
    const map = progressMap(game, proofFilesAt(commit, game), title);
    if (!map) return null;
    const file = join(LOCAL, 'maps', game, `${stamp}.svg`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, map.svg);
    return { path: `${CLIPS}/${game}/${stamp}-progress.svg`, file, alt: map.alt };
  } catch {
    return null;
  }
}

// the game's two numbers in the last commit, as the post writes them, or null when its proof doesn't add up
function numbersAt(commit, game) {
  try {
    const proof = proofOf(game, proofFilesAt(commit, game));
    const { ported, gameplay } = proof ?? {};
    return [
      ported ? `${percentText(ported.percent)} of the original's code` : 'not measured yet: the game needs a code map',
      gameplay ? `${percentText(gameplay.percent)} of the game, ${gameplay.proven} of its ${gameplay.total} parts` : 'not measured yet: the game needs a list of its parts',
    ];
  } catch {
    return null;
  }
}

function postBody({ about, title, clip, clips, map, siteUrl, numbers, address, fork, commit, branch }) {
  const lines = [`**What changed:** ${about.trim()}`, ''];
  if (clip) {
    const video = `${siteUrl}${clips[0].path}`;
    const kind = extname(clip.file) === '.png' ? 'PNG' : 'MP4';
    if (clips[1]) lines.push(`[![${title}: a frame of the clip](${siteUrl}${clips[1].path})](${video})`, '');
    const what = clip.sideBySide ? ', the original on the left and the Dreamport on the right, with the same button presses' : '';
    lines.push(kind === 'PNG' ? `![${title}${what}](${video})` : `[Watch the clip](${video}) (MP4, ${(clip.bytes / 1e6).toFixed(1)} MB${what})`, '');
  }
  lines.push(
    ...(numbers
      ? [`**Code ported:** ${numbers[0]}`, `**Gameplay proven:** ${numbers[1]}`]
      : ['**Progress:** not measured: the game\'s proof files don\'t add up, and npm run check says why']),
    ...(map ? ['', `![${map.alt}](${siteUrl}${map.path})`, ''] : []),
    `**Preview:** ${address} (not reviewed by the Dreamports team: play it only if you trust its author)`,
    `**Code:** [${fork.repository}@${commit.slice(0, 7)}](https://github.com/${fork.repository}/commit/${commit}) on \`${branch}\``,
  );
  return lines.join('\n');
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
