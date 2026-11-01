// The Dreamports bot's judging job (docs/MODERATION.md), one step of the workflow each:
//   fetch  reads the posts to check, with the workflow's read-only token
//   judge  applies the plain rules, asks OpenCode about what they leave, and writes the verdicts, which hold no text
//          from any post, in a step with no token at all
// An event checks its own post. The hourly run checks the posts waiting for a model, and the reviews and comments on
// pull requests' code since its last run, since those events come without write access from forks. A pull request is
// checked with the notes it adds or changes (docs/NOTES.md), since other people's coding agents will read them.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesFor } from './notes.mjs';
import { accounts, isClaimsCommand, isTrusted, planFor } from './verdicts.mjs';
import { api, fetchItems, graphql, list, notesOf, repository, waitingEntries } from './github.mjs';
import { LIMIT, openCodeAsker } from './model.mjs';

const MINUTE = 60000, HOUR = 60 * MINUTE;
const folder = join(process.env.RUNNER_TEMP, 'moderation');
const posts = join(folder, 'posts.json');
const sweep = ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME);
const read = file => JSON.parse(readFileSync(file, 'utf8'));

// when the last hourly run that went well started, less ten minutes, and never more than a day ago
async function lastSweep() {
  const now = Date.now();
  let since = now - 2 * HOUR;
  const workflow = /\.github\/workflows\/([^@/]+)@/.exec(process.env.GITHUB_WORKFLOW_REF ?? '')?.[1];
  if (workflow) {
    const runs = (await api(`/actions/workflows/${workflow}/runs?status=success&per_page=30`))?.workflow_runs ?? [];
    const last = runs.find(run => ['schedule', 'workflow_dispatch'].includes(run.event) && String(run.id) !== process.env.GITHUB_RUN_ID);
    if (last) since = Date.parse(last.run_started_at) - 10 * MINUTE;
  }
  return new Date(Math.max(since, now - 24 * HOUR)).toISOString();
}

// the comments on pull requests' code, and the reviews with something written in them, added or edited since then
async function reviewsSince(since) {
  const ids = (await list(`/pulls/comments?sort=updated&direction=desc&since=${since}`, 500)).map(comment => comment.node_id);
  const { search } = await graphql(`query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes {
    ... on PullRequest { reviews(last: 50) { nodes { id body updatedAt } } } } } }`,
  { q: `repo:${repository} is:pr updated:>=${since.slice(0, 19)}+00:00` });
  for (const pull of search.nodes) {
    for (const review of pull.reviews?.nodes ?? []) if (review.body?.trim() && Date.parse(review.updatedAt) >= Date.parse(since)) ids.push(review.id);
  }
  return ids;
}

async function readPosts() {
  const ids = [];
  let since = null, pushed = false;
  if (sweep) {
    for (const entry of await waitingEntries()) if (!entry.settled) ids.push(entry.node);
    since = await lastSweep();
    ids.push(...await reviewsSince(since));
  } else {
    const event = read(process.env.GITHUB_EVENT_PATH);
    const subject = event.comment ?? event.review ?? event.pull_request ?? event.issue ?? event.discussion;
    if (subject?.node_id) ids.push(subject.node_id);
    pushed = ['synchronize', 'reopened'].includes(event.action);
  }
  const wanted = [...new Set(ids)].slice(0, 300);
  const treatAsPublic = accounts(process.env.MODERATION_TREAT_AS_PUBLIC);
  const items = (await fetchItems(wanted)).filter(item => item.repository === repository)
    .map(item => ({ ...item, trusted: isTrusted(item, treatAsPublic), claims: isClaimsCommand(item) }));
  for (const item of items.filter(found => found.kind === 'pull-request')) {
    try {
      item.notes = await notesOf(item.parent.number);
    } catch (error) {
      // it waits, as a post no model answers for does, and the other posts are still checked
      console.log(`The notes of ${item.url} couldn't be read: ${error.message}`);
      item.unread = true;
    }
  }
  const gone = wanted.filter(id => !items.some(item => item.node === id));
  // a push, or a pull request opened again, changes only what it holds, so it's checked again only for its notes
  const checked = pushed ? items.filter(item => item.notes?.length || item.unread) : items;
  mkdirSync(folder, { recursive: true });
  writeFileSync(posts, JSON.stringify({ since, items: checked, gone }));
  console.log(`Read ${checked.length} of ${wanted.length} posts${since ? `, with the comments on code and reviews since ${since}` : ''}.`);
}

// a post's text and its notes, each after its file's path, as many at a time as a model reads whole
function piecesOf(item) {
  const pieces = [item.text];
  for (const note of item.notes ?? []) {
    const text = `${note.path}\n${note.text}`;
    if (pieces.at(-1).length + text.length > LIMIT) pieces.push(text);
    else pieces[pieces.length - 1] += `\n\n${text}`;
  }
  return pieces;
}

// What OpenCode says of the whole post, piece by piece: the first answer the post has a plan for, or else the last,
// and nothing when any piece gets no answer. An answer with no plan, such as a clip of the original in a pull request,
// doesn't stop the rest from being read.
async function askAbout(opencode, item, hints) {
  let answer = null;
  for (const text of piecesOf(item)) {
    answer = await opencode.ask({ ...item, text, hints });
    if (!answer || planFor(answer.key, item, 'model').length) return answer;
  }
  return answer;
}

// The plain rules first, on the post and on its notes, and then the rules for notes. The repository's own people and
// claims commands get the rules alone, without the spam rule, since the bot only flags them. Whatever has nothing the
// rules notice and no notes is allowed, and the rest goes to OpenCode. A post no model answers for waits, and so does
// a pull request whose notes couldn't be read.
async function judgePosts() {
  const data = read(posts);
  const opencode = openCodeAsker(process.env.MODERATION_MODELS);
  for (const item of data.items) {
    const notes = item.notes ?? [];
    if (item.unread) {
      item.verdicts = [{ key: 'wait', by: 'none' }];
      continue;
    }
    if (item.bot && !notes.length) {
      item.verdicts = [{ key: 'skip', by: 'none' }];
      continue;
    }
    const own = item.trusted || item.claims;
    const { verdicts, hints } = rulesFor(item, { spam: !own });
    if (verdicts.length) item.verdicts = verdicts;
    else if (own || (!hints.length && !notes.length)) item.verdicts = [{ key: 'allow', by: 'rules' }];
    else {
      const answer = await askAbout(opencode, item, notes.length ? [...hints, 'notes'] : hints);
      item.verdicts = [answer ? { key: answer.key, by: 'model', model: answer.model } : { key: 'wait', by: 'none' }];
    }
  }
  const results = data.items.flatMap(item => item.verdicts.map(verdict => ({ kind: item.kind, node: item.node, ...verdict })));
  const verdicts = {
    version: 1, mode: sweep ? 'sweep' : 'event', results, gone: data.gone,
    model: {
      answered: results.some(result => result.by === 'model'), failed: results.some(result => result.key === 'wait'),
      tried: [...opencode.tried]
    }
  };
  appendFileSync(process.env.GITHUB_OUTPUT, `verdicts=${JSON.stringify(verdicts)}\n`);

  // the job's summary: each post checked, with its verdict and what decided it, and never its text
  const decided = verdict => verdict.key === 'skip' ? 'nothing: a bot wrote it' : verdict.by === 'rules' ? 'the plain rules'
    : verdict.model ? `\`${verdict.model}\`` : 'nothing yet: no model answered';
  const lines = [`## Posts checked${data.since ? ` (the hourly run, since ${data.since})` : ''}`, ''];
  if (!data.items.length) lines.push('None.');
  else {
    lines.push('| Post | By | Verdict | Decided by |', '| :--- | :--- | :--- | :--- |');
    for (const item of data.items) for (const verdict of item.verdicts) lines.push(`| [${KIND_WORDS[item.kind]}](${item.url}) | \`${item.author}\` | ${verdict.key} | ${decided(verdict)} |`);
  }
  if (verdicts.model.tried.length) lines.push('', `Models asked: ${verdicts.model.tried.map(model => `\`${model}\``).join(', ')}.`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

const KIND_WORDS = {
  issue: 'Issue', 'pull-request': 'Pull request', discussion: 'Thread', 'issue-comment': 'Comment', 'review-comment': 'Comment on code',
  review: 'Review', 'discussion-comment': 'Comment in Discussions'
};

const steps = { fetch: readPosts, judge: judgePosts };
if (!steps[process.argv[2]]) throw new Error(`judge.mjs runs one step: ${Object.keys(steps).join(', ')}.`);
await steps[process.argv[2]]();
