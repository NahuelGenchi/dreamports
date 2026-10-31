// The Dreamports bot's judging job (docs/MODERATION.md), one step of the workflow each:
//   fetch  reads the posts to check, with the workflow's read-only token
//   judge  applies the plain rules, asks OpenCode about what they leave, and writes the verdicts, which hold no text
//          from any post, in a step with no token at all
// An event checks its own post. The hourly run checks the posts waiting for a model, and the reviews and comments on
// pull requests' code since its last run, since those events come without write access from forks.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRules } from './rules.mjs';
import { accounts, isClaimsCommand, isTrusted } from './verdicts.mjs';
import { api, fetchItems, graphql, list, repository, waitingEntries } from './github.mjs';
import { openCodeAsker } from './model.mjs';

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
  let since = null;
  if (sweep) {
    for (const entry of await waitingEntries()) if (!entry.settled) ids.push(entry.node);
    since = await lastSweep();
    ids.push(...await reviewsSince(since));
  } else {
    const event = read(process.env.GITHUB_EVENT_PATH);
    const subject = event.comment ?? event.review ?? event.pull_request ?? event.issue ?? event.discussion;
    if (subject?.node_id) ids.push(subject.node_id);
  }
  const wanted = [...new Set(ids)].slice(0, 300);
  const treatAsPublic = accounts(process.env.MODERATION_TREAT_AS_PUBLIC);
  const items = (await fetchItems(wanted)).filter(item => item.repository === repository)
    .map(item => ({ ...item, trusted: isTrusted(item, treatAsPublic), claims: isClaimsCommand(item) }));
  mkdirSync(folder, { recursive: true });
  writeFileSync(posts, JSON.stringify({ since, items, gone: wanted.filter(id => !items.some(item => item.node === id)) }));
  console.log(`Read ${items.length} of ${wanted.length} posts${since ? `, with the comments on code and reviews since ${since}` : ''}.`);
}

// The plain rules first. The repository's own people and claims commands get the rules alone, without the spam rule,
// since the bot only flags them. Whatever has nothing the rules notice is allowed, and the rest goes to OpenCode. A
// post no model answers for waits.
async function judgePosts() {
  const data = read(posts);
  const opencode = openCodeAsker(process.env.MODERATION_MODELS);
  for (const item of data.items) {
    if (item.bot) {
      item.verdict = { key: 'skip', by: 'none' };
      continue;
    }
    const own = item.trusted || item.claims;
    const rules = checkRules(item.text, { author: item.author, where: item.where, spam: !own });
    if (rules.key) item.verdict = { key: rules.key, by: 'rules', rule: rules.rule };
    else if (own || !rules.hints.length) item.verdict = { key: 'allow', by: 'rules' };
    else {
      const answer = await opencode.ask({ ...item, hints: rules.hints });
      item.verdict = answer ? { key: answer.key, by: 'model', model: answer.model } : { key: 'wait', by: 'none' };
    }
  }
  const results = data.items.map(item => ({ kind: item.kind, node: item.node, ...item.verdict }));
  const verdicts = {
    version: 1, mode: sweep ? 'sweep' : 'event', results, gone: data.gone,
    model: {
      answered: results.some(result => result.by === 'model'), failed: results.some(result => result.key === 'wait'),
      tried: [...opencode.tried]
    }
  };
  appendFileSync(process.env.GITHUB_OUTPUT, `verdicts=${JSON.stringify(verdicts)}\n`);

  // the job's summary: each post checked, with its verdict and what decided it, and never its text
  const decided = item => item.verdict.by === 'rules' ? 'the plain rules' : item.verdict.model ? `\`${item.verdict.model}\`` : 'nothing yet';
  const lines = [`## Posts checked${data.since ? ` (the hourly run, since ${data.since})` : ''}`, ''];
  if (!data.items.length) lines.push('None.');
  else {
    lines.push('| Post | By | Verdict | Decided by |', '| :--- | :--- | :--- | :--- |');
    for (const item of data.items) lines.push(`| [${KIND_WORDS[item.kind]}](${item.url}) | \`${item.author}\` | ${item.verdict.key} | ${decided(item)} |`);
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
