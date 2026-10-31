// A preview of a game, made from a commit: the next commit of the previews branch on the contributor's fork, which
// GitHub Pages serves. The game's folder goes to <preview>/play/<game>/ and the kits to <preview>/kit/<console>/,
// the way dreamports.net serves them, so the game loads its kit with the same addresses. The site's own files its
// pages load, such as /dreamports.js, come along too: dreamports.js as a preview's stand-in that saves nothing to
// a profile and says the preview hasn't been reviewed. It's all made with git in an index of its own, so the
// contributor's folder, branch and staged changes stay as they are, and it only takes files from the commit, so
// nothing that was never committed, such as a copy of a game, can get in.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, LOCAL } from './paths.mjs';
import { rememberedCopies } from './copies.mjs';
import { looksLikeCopy } from '../gba/header.mjs';

/** The fork's branch GitHub Pages serves the previews from. */
export const BRANCH = 'dreamports-previews';
/** Where the clips posted in progress threads go on the previews site, apart from the previews. */
export const CLIPS = 'clips';

const TEMPLATES = new URL('../preview/', import.meta.url);
const template = name => readFileSync(new URL(name, TEMPLATES), 'utf8');

function git(args, { input, env, buffer = false } = {}) {
  return execFileSync('git', args, {
    cwd: REPO, input: typeof input === 'string' ? Buffer.from(input) : input, env: env && { ...process.env, ...env }, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** The commit a preview is made from, and its branch. */
export function head() {
  return { commit: git(['rev-parse', 'HEAD']).trim(), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() };
}

/** Changes not committed yet in what a preview of the game holds, which it leaves out. */
export function uncommitted(game) {
  return git(['status', '--porcelain', '--', `games/${game}`, 'kit', 'public']).split('\n').filter(Boolean);
}

/** This folder's remotes: [{ name, url }]. */
export function remotes() {
  return git(['remote']).split('\n').filter(Boolean).map(name => ({ name, url: git(['remote', 'get-url', name]).trim() }));
}

/** A file in a commit, or null. */
export function fileAt(commit, path) {
  try {
    return git(['show', `${commit}:${path}`], { buffer: true });
  } catch {
    return null;
  }
}

/** The previews branch's last commit on the fork, fetched here; or null before the first preview. */
export function fetchPreviews(remote) {
  const found = git(['ls-remote', remote, `refs/heads/${BRANCH}`]).trim();
  if (!found) return null;
  git(['fetch', '--no-tags', '--quiet', remote, `refs/heads/${BRANCH}`]);
  return found.split(/\s/)[0];
}

/** Sends the new commit of the previews branch to the fork. */
export function pushPreviews(remote, commit) {
  git(['push', '--quiet', remote, `${commit}:refs/heads/${BRANCH}`]);
}

// every file under these paths in a commit: [{ mode, sha, path }]
function filesAt(commit, ...paths) {
  if (!commit) return [];
  return git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]).split('\0').filter(Boolean).map(line => {
    const [info, path] = line.split('\t');
    const [mode, , sha] = info.split(' ');
    return { mode, sha, path };
  });
}

// the contents of these files, by their git ids
function contentsOf(shas) {
  const contents = new Map();
  const wanted = [...new Set(shas)];
  if (!wanted.length) return contents;
  const out = git(['cat-file', '--batch'], { input: wanted.join('\n') + '\n', buffer: true });
  let at = 0;
  for (const sha of wanted) {
    const end = out.indexOf(0x0A, at);
    const size = Number(out.toString('latin1', at, end).split(' ')[2]);
    contents.set(sha, out.subarray(end + 1, end + 1 + size));
    at = end + 1 + size + 1;
  }
  return contents;
}

const store = bytes => git(['hash-object', '-w', '--stdin'], { input: bytes }).trim();
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
const hidden = path => path.split('/').some(part => part.startsWith('.'));

// what a preview must never hold: files the ignore rules keep out of the repository, such as ROMs and saves, and
// any file that is a copy of a game, by its checksum or its cartridge header
function gameDataIn(files, contents) {
  const problems = [];
  let ignored = [];
  try {
    // the repository's own rules, not the contributor's personal ones
    ignored = git(['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '-z', '--stdin'], { input: files.map(f => f.from).join('\0') + '\0' }).split('\0').filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;   // 1: none of them
  }
  for (const path of ignored) problems.push(`${path}: the ignore rules keep this kind of file out of the repository.`);
  const copies = new Set(Object.keys(rememberedCopies()));
  for (const file of files) {
    const bytes = contents.get(file.sha);
    if (copies.has(createHash('sha1').update(bytes).digest('hex')) || looksLikeCopy(bytes)) problems.push(`${file.from}: this is a copy of a game.`);
  }
  return problems;
}

/**
 * Makes the next commit of the previews branch, from `tip` (or none yet), with the game as it is in `commit`, as
 * the preview `name`, and any `clips` ([{ path, file }]) under clips/. `about` is what changed, or ''. Resolves to
 * { commit, files, bytes, made } for the preview, or throws with every problem found.
 */
export function makePreview({ tip, commit, branch, game, title, name, author, repository, url, about, guide, clips = [] }) {
  const problems = [];
  const files = [];
  for (const file of filesAt(commit, `games/${game}`, 'kit')) {
    if (hidden(file.path)) continue;
    const [top, folder, ...rest] = file.path.split('/');
    if (top === 'kit' && !rest.length) continue;   // kit/README.md: only the kits' folders go on the site
    if (file.mode === '120000' || file.mode === '160000') {
      problems.push(`${file.path}: every file has to be a plain file in the folder, not a link.`);
      continue;
    }
    const to = top === 'games' ? `${name}/play/${game}/${rest.join('/')}` : `${name}/kit/${folder}/${rest.join('/')}`;
    files.push({ ...file, from: file.path, to });
  }
  if (!files.some(f => f.to === `${name}/play/${game}/index.html`)) throw new Error(`games/${game}/index.html isn't in commit ${commit.slice(0, 7)}: a preview is made from your last commit.`);

  // the site's own files, which pages load from the site's root
  const site = new Map(filesAt(commit, 'public').map(f => [f.path.slice('public/'.length), f]));
  const contents = contentsOf(files.map(f => f.sha));
  const extra = new Map();
  for (const file of files.filter(f => f.to.endsWith('.html'))) {
    const depth = file.to.split('/').length - 2;
    const html = contents.get(file.sha).toString('utf8')
      // addresses from the site's root: its own files come along, anything else points at dreamports.net
      .replace(/(\s(?:src|href)\s*=\s*)(["'])\/(?!\/)([^"']*)\2/gi, (_, attribute, quote, address) => {
        const path = address.replace(/[?#].*$/, '');
        const own = path === 'dreamports.js' || (site.has(path) && !hidden(path) && !path.split('/').includes('..'));
        if (own && path !== 'dreamports.js') extra.set(path, site.get(path));
        return `${attribute}${quote}${own ? '../'.repeat(depth) + address : `https://dreamports.net/${address}`}${quote}`;
      })
      // a preview stays out of search engines
      .replace(/<head(\s[^>]*)?>/i, found => `${found}\n<meta name="robots" content="noindex">`);
    file.sha = store(html);
    contents.set(file.sha, Buffer.from(html));
  }
  for (const [path, file] of extra) files.push({ ...file, from: file.path, to: `${name}/${path}` });
  for (const [sha, bytes] of contentsOf([...extra.values()].map(f => f.sha))) contents.set(sha, bytes);
  problems.push(...gameDataIn(files, contents));
  if (problems.length) throw new Error(`The preview can't be published:\n${problems.map(p => `- ${p}`).join('\n')}`);

  const made = new Date().toISOString();
  const info = { game, title, author, repository, branch, commit, made, about };
  const generated = [
    [`${name}/preview.json`, JSON.stringify(info, null, 2) + '\n'],
    [`${name}/dreamports.js`, template('dreamports.js').replace('const PREVIEW = {};', `const PREVIEW = ${JSON.stringify({ author, page: `${url}${name}/` })};`)],
    [`${name}/index.html`, fill(template('preview.html'), {
      title: escape(title), author: escape(author), authorUrl: escape(`https://github.com/${author}`), origin: escape(new URL(url).host),
      branch: escape(branch), commit: escape(commit.slice(0, 7)), commitUrl: escape(`https://github.com/${repository}/commit/${commit}`),
      made: escape(made.slice(0, 10)), play: escape(`play/${game}/`), guide: escape(guide),
      about: about ? `<section class="about"><h2>What changed</h2><p>${escape(about)}</p></section>` : '',
    })],
  ];

  // the previews already there, but for this one and the pages that list them; the clips stay
  const kept = filesAt(tip).filter(f => !f.path.startsWith(`${name}/`) && f.path.includes('/'));
  const previews = [info];
  for (const file of kept.filter(f => /^[^/]+\/preview\.json$/.test(f.path))) {
    try {
      previews.push({ name: file.path.split('/')[0], ...JSON.parse(contentsOf([file.sha]).get(file.sha).toString('utf8')) });
    } catch {
      // not a preview share made
    }
  }
  info.name = name;
  previews.sort((a, b) => String(b.made).localeCompare(String(a.made)));
  const owner = repository.split('/')[0];
  generated.push(['.nojekyll', ''], ['index.html', fill(template('previews.html'), {
    owner: escape(owner), guide: escape(guide),
    list: previews.map(p => `<li><a href="${escape(p.name)}/">${escape(p.title ?? p.game)}</a><span>${escape(p.name)}, from ${escape(p.branch ?? '?')}, ${escape(String(p.made ?? '').slice(0, 10))}</span></li>`).join('\n'),
  })]);

  const entries = [
    ...kept.map(f => ({ mode: f.mode, sha: f.sha, path: f.path })),
    ...files.map(f => ({ mode: '100644', sha: f.sha, path: f.to })),
    ...generated.map(([path, text]) => ({ mode: '100644', sha: store(text), path })),
    ...clips.map(c => ({ mode: '100644', sha: store(readFileSync(c.file)), path: c.path })),
  ];
  const index = join(LOCAL, 'share', 'index');
  mkdirSync(join(LOCAL, 'share'), { recursive: true });
  rmSync(index, { force: true });
  const env = { GIT_INDEX_FILE: index };
  git(['update-index', '-z', '--add', '--index-info'], { env, input: entries.map(e => `${e.mode} ${e.sha}\t${e.path}\0`).join('') });
  const tree = git(['write-tree'], { env }).trim();
  rmSync(index, { force: true });
  const next = git(['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', `Preview ${name}: ${game} at ${commit.slice(0, 7)} (${branch})`]).trim();
  const bytes = files.reduce((sum, f) => sum + (contents.get(f.sha)?.length ?? 0), 0);
  return { commit: next, files: files.length + generated.length, bytes, made };
}
