// The Dreamports bot's reading of a new game's first files and of its card (docs/TEAMS.md), with a token that can only
// read. It answers with a plan for act.mjs, on GITHUB_OUTPUT: nothing, what to say, or to merge. First files, which
// hold no picture, merge once the pull request's checks have passed on the very commit it checked, which the run that
// follows the Check workflow sees. A card merges once someone who runs the repository has ticked the bot's question
// about its capture on that commit. It reads the pull request's files through the API as data, and writes in this
// throwaway checkout only what passed its checks, to run this repository's own tools on them, with no token.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { field, readClaims } from '../../tools/lib/claims.mjs';
import { BOT, api, graphql, list, name, owner, repository } from '../moderation/github.mjs';
import { cardOf, checkCard, checkFirstFiles, gameOf, languageOf, mediaOf, mostFor, pathsOf, plainHistory } from './rules.mjs';
import { MARK } from './text.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const WAIT_MS = 20_000, WAITS = 12;   // how long a run that follows the checks waits for the moderation bot's reading

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

// whether first files' commit can go on main as it is, or it's squashed (rules.mjs)
async function howToMerge({ verdict, issue }) {
  const commits = await list(`/pulls/${number}/commits`, 2);
  return plainHistory({ commits, original: verdict.original, issue }) ? 'merge' : 'squash';
}

// this repository's own tools write the port map, the progress map and the row in docs/STATUS.md from what passed, to
// compare: of its version in JavaScript, or in C in a game that starts in C (src/lib/languages.mjs)
function writtenAgain(game, language, bytes) {
  const [portMap, map] = pathsOf(game, language).filter(path => path.endsWith('port-map.json') || path.endsWith('.svg'));
  for (const path of pathsOf(game, language).filter(path => path.startsWith('games/') && path !== portMap)) {
    mkdirSync(dirname(join(REPO, path)), { recursive: true });
    writeFileSync(join(REPO, path), bytes.get(path));
  }
  const version = language === 'js' ? game : `${game}/${language}`;
  const { GITHUB_TOKEN, GH_TOKEN, ...env } = process.env;
  execFileSync('node', ['tools/dp.mjs', 'portmap', version], { cwd: REPO, env, stdio: 'inherit' });
  execFileSync('node', ['tools/dp.mjs', 'readme'], { cwd: REPO, env, stdio: 'inherit' });
  return {
    portMap: readFileSync(join(REPO, portMap)), map: readFileSync(join(REPO, map)), mapAt: map, portMapAt: portMap,
    row: readFileSync(join(REPO, 'docs/STATUS.md'), 'utf8').split('\n').find(line => line.includes(`(../games/${version}/)`)),
  };
}

// what the moderation bot and, with `all`, the checks main asks for say of a commit: every one passed
async function checksDone(pr, sha, all) {
  const { check_runs: runs } = await api(`/commits/${sha}/check-runs?per_page=100`);
  const latest = wanted => runs.filter(run => run.name === wanted).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  return ['Judge', 'Act', ...(all ? ['Check', 'Clips'] : [])].every(name => latest(name)?.conclusion === 'success') && !pr.labels.some(label => label.name === 'moderation-waiting');
}
const moderationDone = (pr, sha) => checksDone(pr, sha, false);

// first files' checks, all passed: a run that follows them gives the moderation bot a few minutes to finish its reading
async function passed(sha) {
  for (let tries = 0; ; tries++) {
    const now = await api(`/pulls/${number}`);
    if (now?.state !== 'open' || now.head.sha !== sha) return false;
    if (await checksDone(now, sha, true)) return true;
    if (!event.workflow_run || tries >= WAITS) return false;
    await new Promise(resolve => setTimeout(resolve, WAIT_MS));
  }
}

// the pull request this run is about: the event's own, the one a ticked comment is on, or the open one whose checks
// just finished, found by its commit, as GitHub names no pull request for a run on a fork's
async function numberOf() {
  if (!event.workflow_run) return event.pull_request?.number ?? event.issue?.number ?? null;
  const pulls = await list('/pulls?state=open&sort=updated&direction=desc', 300);
  return pulls.find(pull => pull.head.sha === event.workflow_run.head_sha)?.number ?? null;
}

async function closesAnIssue() {
  const query = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { closingIssuesReferences(first: 1) { totalCount } } } }';
  const data = await graphql(query, { owner, name, number });
  return data.repository.pullRequest.closingIssuesReferences.totalCount > 0;
}

const number = await numberOf();
const pr = number ? await api(`/pulls/${number}`) : null;
const comments = pr ? await list(`/issues/${number}/comments`) : [];
const asked = comments.find(comment => comment.user?.login === BOT && MARK.test(comment.body ?? ''));
const common = { pr: number, comment: asked?.id ?? null };
const files = pr?.state === 'open' && !pr.draft && pr.head.repo && pr.base.ref === pr.base.repo.default_branch ? await list(`/pulls/${number}/files`, 101) : null;
const game = files && files.length <= 100 ? gameOf(files) : null;
const card = files && !game ? cardOf(files) : null;
const sha = pr?.head.sha, head = pr?.head.repo?.full_name;
// the game's open New Dreamport issue, which names its lead
const claimOf = (name, issue = readClaims(repository).leads.get(name)) => (issue ? { issue, number: issue.number, lead: issue.assignees?.[0]?.login ?? issue.user.login, game: field(issue.body, 'Game') ?? '' } : null);

if (game) {
  // a new game's first files
  const paths = [...pathsOf(game, languageOf(game, files)), 'docs/STATUS.md'];
  const found = paths.every(path => files.some(f => f.filename === path)) && files.length === paths.length ? await readHead(head, sha, paths) : null;
  const claim = claimOf(game);
  let verdict = !found ? { why: 'files' } : checkFirstFiles({
    game, files, modes: found.modes, read: path => found.bytes.get(path), claim, author: pr.user.login, onSite: existsSync(join(REPO, 'games', game)),
  });
  if (!verdict.why) {
    let same = false;
    try {
      const again = writtenAgain(game, verdict.language, found.bytes);
      same = again.portMap.equals(found.bytes.get(again.portMapAt)) && again.map.equals(found.bytes.get(again.mapAt)) && again.row === verdict.row;
    } catch (error) {
      console.error(error.message);
    }
    if (!same) verdict = { why: 'readme' };
    else if (await closesAnIssue()) verdict = { why: 'closes' };
  }
  const plan = { game, sha, head, name: verdict.name ?? '', ...common };
  // a run that follows the checks, or an edited comment, only ever merges: what there is to say was said when it was pushed
  if (verdict.why) answer(event.pull_request ? { kind: 'say', why: verdict.why, what: 'files', ...common } : { kind: 'none' });
  else if (event.comment) answer({ kind: 'none' });
  else if (await passed(sha)) answer({ kind: 'merge', issue: claim.number, milestone: claim.issue.milestone?.number ?? null, method: await howToMerge({ verdict, issue: claim.number }), what: 'files', ...plan });
  else answer(event.pull_request ? { kind: 'coming', ...plan } : { kind: 'none' });
} else if (card && !event.workflow_run) {
  // a game's card
  const paths = [...mediaOf(card), `games/${card}/entry.md`];
  const found = await readHead(head, sha, paths);
  const onMain = Object.fromEntries([['entry', 'entry.md'], ['original', 'proof/original.json']].map(([key, name]) => {
    const path = join(REPO, 'games', card, name);
    return [key, existsSync(path) ? readFileSync(path, 'utf8') : null];
  }));
  const claim = claimOf(card);
  let verdict = !found || !paths.every(path => found.bytes.has(path)) ? { why: 'files' }
    : checkCard({ game: card, files, modes: found.modes, read: path => found.bytes.get(path), onMain, claim, author: pr.user.login });
  if (!verdict.why && await closesAnIssue()) verdict = { why: 'closes' };
  const plan = { game: card, sha, head, name: verdict.name ?? '', ...common };
  if (verdict.why) {
    answer({ kind: 'say', why: verdict.why, what: 'card', ...common });
  } else if (!event.comment) {
    answer({ kind: 'ask', ...plan });
  } else {
    // a tick: on the bot's own comment, by someone who runs the repository, on the very commit it asked about
    const fresh = await api(`/issues/comments/${event.comment.id}`);
    const who = await api(`/collaborators/${encodeURIComponent(event.sender.login)}/permission`);
    const ticked = fresh?.user?.login === BOT && MARK.exec(fresh.body ?? '')?.[1] === sha && /^- \[[xX]\] /m.test(fresh.body);
    if (!ticked || who?.permission !== 'admin') answer({ kind: 'none' });
    else if (!(await moderationDone(pr, sha))) answer({ kind: 'wait', ...plan });
    else answer({ kind: 'merge', issue: claim.number, milestone: claim.issue.milestone?.number ?? null, method: 'squash', what: 'card', ...plan });
  }
} else {
  // what it spoke about before is no longer a game's first files or its card
  const what = /a game's card/.test(asked?.body ?? '') ? 'card' : 'files';
  answer(files && asked && event.pull_request ? { kind: 'say', why: 'files', what, ...common } : { kind: 'none' });
}
