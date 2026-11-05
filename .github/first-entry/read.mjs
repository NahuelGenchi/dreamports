// The Dreamports bot's reading of a game's first entry (docs/TEAMS.md), with a token that can only read. It answers with
// a plan for act.mjs, on GITHUB_OUTPUT: nothing, what to say, or to merge, once someone who runs the repository has
// ticked the bot's question about the capture on the very commit it checked. It reads the pull request's files through
// the API as data, and writes in this throwaway checkout only what passed its checks, to run this repository's own
// tools on them, with no token.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { field, readClaims } from '../../tools/lib/claims.mjs';
import { BOT, api, graphql, list, name, owner, repository } from '../moderation/github.mjs';
import { checkFirstEntry, gameOf, mostFor, pathsOf, plainHistory } from './rules.mjs';
import { MARK } from './text.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const number = event.pull_request?.number ?? event.issue?.number;

function answer(plan) {
  console.log(`Plan: ${JSON.stringify(plan)}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
}

// a file of a commit, through the API
async function readFile(head, sha, path) {
  const response = await fetch(`https://api.github.com/repos/${head}/contents/${path}?ref=${sha}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw+json' }, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${path}`);
  return Buffer.from(await response.arrayBuffer());
}

// its head's files through the API, each no bigger than it can be: their modes and sizes, and their bytes
async function readHead(head, sha, paths) {
  const tree = await api(`https://api.github.com/repos/${head}/git/trees/${sha}?recursive=1`);
  if (!tree || tree.truncated) return null;
  const inTree = new Map(tree.tree.map(item => [item.path, item]));
  const modes = new Map(), bytes = new Map();
  for (const path of paths) {
    const item = inTree.get(path);
    if (!item) continue;
    modes.set(path, item.mode);
    if (path === 'docs/STATUS.md') continue;
    if (item.size > mostFor(path)) return null;
    bytes.set(path, await readFile(head, sha, path));
  }
  return { modes, bytes };
}

// whether its commits can go on main as they are, or it's squashed (rules.mjs)
async function howToMerge({ head, game, verdict, issue, author }) {
  const commits = await list(`/pulls/${number}/commits`, 3);
  if (commits.length !== 2) return 'squash';
  const compared = await api(`https://api.github.com/repos/${head}/compare/${commits[0].sha}...${commits[1].sha}`);
  const path = `games/${game}/entry.md`;
  const firstEntry = (await readFile(head, commits[0].sha, path)).toString('utf8');
  return plainHistory({ commits, between: compared?.files ?? [], firstEntry, game, original: verdict.original, issue, author, added: verdict.added }) ? 'merge' : 'squash';
}

// this repository's own tools write the port map, the progress map and the row in docs/STATUS.md from what passed, to compare
function writtenAgain(game, bytes) {
  for (const path of [`games/${game}/proof/original.json`, `games/${game}/proof/code-map.json`, `games/${game}/entry.md`, `games/${game}/index.html`, `games/${game}/src/main.js`, `games/${game}/LICENSE`]) {
    mkdirSync(dirname(join(REPO, path)), { recursive: true });
    writeFileSync(join(REPO, path), bytes.get(path));
  }
  const { GITHUB_TOKEN, GH_TOKEN, ...env } = process.env;
  execFileSync('node', ['tools/dp.mjs', 'portmap', game], { cwd: REPO, env, stdio: 'inherit' });
  execFileSync('node', ['tools/dp.mjs', 'readme'], { cwd: REPO, env, stdio: 'inherit' });
  return {
    portMap: readFileSync(join(REPO, `games/${game}/proof/port-map.json`)),
    map: readFileSync(join(REPO, `.github/readme/progress/${game}.svg`)),
    row: readFileSync(join(REPO, 'docs/STATUS.md'), 'utf8').split('\n').find(line => line.includes(`(../games/${game}/)`)),
  };
}

async function moderationDone(pr, sha) {
  const { check_runs: runs } = await api(`/commits/${sha}/check-runs?per_page=100`);
  const latest = wanted => runs.filter(run => run.name === wanted).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  return [latest('Judge'), latest('Act')].every(run => run?.conclusion === 'success') && !pr.labels.some(label => label.name === 'moderation-waiting');
}

async function closesAnIssue() {
  const query = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { closingIssuesReferences(first: 1) { totalCount } } } }';
  const data = await graphql(query, { owner, name, number });
  return data.repository.pullRequest.closingIssuesReferences.totalCount > 0;
}

const pr = await api(`/pulls/${number}`);
const comments = pr ? await list(`/issues/${number}/comments`) : [];
const asked = comments.find(comment => comment.user?.login === BOT && MARK.test(comment.body ?? ''));
const common = { pr: number, comment: asked?.id ?? null };
const files = pr?.state === 'open' && !pr.draft && pr.head.repo && pr.base.ref === pr.base.repo.default_branch ? await list(`/pulls/${number}/files`, 101) : null;
const game = files && files.length <= 100 ? gameOf(files) : null;

if (!game) {
  // what it asked about before is no longer a first entry
  answer(files && asked ? { kind: 'say', why: 'files', ...common } : { kind: 'none' });
} else {
  const sha = pr.head.sha, head = pr.head.repo.full_name;
  const paths = [...pathsOf(game), 'docs/STATUS.md'];
  const found = paths.every(path => files.some(f => f.filename === path)) && files.length === paths.length ? await readHead(head, sha, paths) : null;
  let claim = null;
  const issue = readClaims(repository).leads.get(game);
  if (issue) claim = { number: issue.number, lead: issue.assignees?.[0]?.login ?? issue.user.login, game: field(issue.body, 'Game') ?? '' };
  let verdict = !found ? { why: 'files' } : checkFirstEntry({
    game, files, modes: found.modes, read: path => found.bytes.get(path), claim, author: pr.user.login, onSite: existsSync(join(REPO, 'games', game)),
  });
  if (!verdict.why) {
    let same = false;
    try {
      const again = writtenAgain(game, found.bytes);
      same = again.portMap.equals(found.bytes.get(`games/${game}/proof/port-map.json`)) && again.map.equals(found.bytes.get(`.github/readme/progress/${game}.svg`)) && again.row === verdict.row;
    } catch (error) {
      console.error(error.message);
    }
    if (!same) verdict = { why: 'readme' };
    else if (await closesAnIssue()) verdict = { why: 'closes' };
  }
  const plan = { game, sha, head, name: verdict.name ?? '', ...common };
  if (verdict.why) {
    answer({ kind: 'say', why: verdict.why, ...common });
  } else if (!event.comment) {
    answer({ kind: 'ask', ...plan });
  } else {
    // a tick: on the bot's own comment, by someone who runs the repository, on the very commit it asked about
    const fresh = await api(`/issues/comments/${event.comment.id}`);
    const who = await api(`/collaborators/${encodeURIComponent(event.sender.login)}/permission`);
    const ticked = fresh?.user?.login === BOT && MARK.exec(fresh.body ?? '')?.[1] === sha && /^- \[[xX]\] /m.test(fresh.body);
    if (!ticked || who?.permission !== 'admin') answer({ kind: 'none' });
    else if (!(await moderationDone(pr, sha))) answer({ kind: 'wait', ...plan });
    else answer({ kind: 'merge', issue: issue.number, milestone: issue.milestone?.number ?? null, method: await howToMerge({ head, game, verdict, issue: issue.number, author: pr.user.login }), ...plan });
  }
}
