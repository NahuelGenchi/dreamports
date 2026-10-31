// The Dreamports bot's acting job (docs/MODERATION.md). It takes the judging job's verdicts only if they fit the fixed
// schema, reads each post again from GitHub, and carries out the fixed plan for its verdict, made of hiding,
// replying, closing, locking and labelling, with the workflow's write permissions. It also keeps the log, and lists
// the posts that wait for a model on the alert issue. Nothing it writes quotes a post.
import { appendFileSync, readFileSync } from 'node:fs';
import { accounts, checkVerdicts, isClaimsCommand, isTrusted, logLine, markFor, planFor, postLink, replyFor } from './verdicts.mjs';
import { BOT, alertIssues, api, fetchItems, graphql, repository, waitingEntries } from './github.mjs';

const DAY = 86400000;
const sweep = ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME);
const docs = {
  moderation: `https://github.com/${repository}/blob/HEAD/docs/MODERATION.md`,
  clips: `https://github.com/${repository}/blob/HEAD/docs/STANDARD.md#clips`,
  rights: `https://github.com/${repository}/blob/HEAD/docs/RIGHTS.md`
};
const LABELS = {
  spam: ['b60205', 'The Dreamports bot closed this as spam'],
  'rights-notice': ['5319e7', 'A notice from a rights holder (docs/RIGHTS.md)'],
  'moderation-waiting': ['fbca04', 'The Dreamports bot checks a post here once a model answers'],
  'moderation-log': ['c5def5', 'The Dreamports bot\'s log of what it does'],
  'moderation-alert': ['d93f0b', 'The Dreamports bot can\'t judge some posts for now']
};
const MUTATIONS = {
  hide: 'mutation($id: ID!, $as: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $id, classifier: $as }) { clientMutationId } }',
  lock: 'mutation($id: ID!, $as: LockReason) { lockLockable(input: { lockableId: $id, lockReason: $as }) { clientMutationId } }',
  comment: 'mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { clientMutationId } }',
  discussionComment: `mutation($id: ID!, $replyTo: ID, $body: String!) {
    addDiscussionComment(input: { discussionId: $id, replyToId: $replyTo, body: $body }) { clientMutationId } }`,
  issue: 'mutation($id: ID!) { closeIssue(input: { issueId: $id, stateReason: NOT_PLANNED }) { clientMutationId } }',
  'pull-request': 'mutation($id: ID!) { closePullRequest(input: { pullRequestId: $id }) { clientMutationId } }',
  discussion: 'mutation($id: ID!) { closeDiscussion(input: { discussionId: $id, reason: OUTDATED }) { clientMutationId } }',
  label: 'mutation($id: ID!, $labels: [ID!]!) { addLabelsToLabelable(input: { labelableId: $id, labelIds: $labels }) { clientMutationId } }',
  unlabel: 'mutation($id: ID!, $labels: [ID!]!) { removeLabelsFromLabelable(input: { labelableId: $id, labelIds: $labels }) { clientMutationId } }'
};
const summary = [];

// the label's node id, making the label the first time it's needed
const labelIds = new Map();
async function labelId(label) {
  if (!labelIds.has(label)) {
    const path = `/labels/${encodeURIComponent(label)}`;
    let found = await api(path);
    if (!found) {
      try {
        found = await api('/labels', 'POST', { name: label, color: LABELS[label][0], description: LABELS[label][1] });
      } catch (error) {
        if (error.status !== 422) throw error;
        found = await api(path);
      }
    }
    labelIds.set(label, found.node_id);
  }
  return labelIds.get(label);
}

// the bot's own issues with this label, oldest first
const ownIssues = async (label, state) => ((await api(`/issues?labels=${label}&state=${state}&sort=created&direction=asc&per_page=30`)) ?? [])
  .filter(issue => !issue.pull_request && issue.user?.login === BOT);

// The bot's own issue with this label, opened the first time it's needed. When two runs open one at the same time,
// the older stays and the other is closed.
async function ownIssue(label, title, body, { state, lock = false }) {
  const find = () => ownIssues(label, state);
  const found = await find();
  if (found.length) return found[0].number;
  await labelId(label);
  const issue = await api('/issues', 'POST', { title, body, labels: [label] });
  if (lock) await graphql(MUTATIONS.lock, { id: issue.node_id, as: null });
  const first = (await find())[0];
  if (first && first.number !== issue.number) {
    await api(`/issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'not_planned' });
    return first.number;
  }
  return issue.number;
}

// the log: one comment for each thing the bot does or flags, a flag ending with its mark
let logNumber;
async function log(line, mark = '') {
  summary.push(`- ${line}`);
  logNumber ??= await ownIssue('moderation-log', 'Moderation log', [
    'The Dreamports bot writes a comment here for each thing it does: each post it hides, answers, closes, locks or labels, and each post it only flags, with a link, the reason, and whether the plain rules or a model decided. It never quotes a post. This issue is locked, so only the bot and the Dreamports team write here.',
    '', `[How moderation works](${docs.moderation})`
  ].join('\n'), { state: 'all', lock: true });
  await api(`/issues/${logNumber}/comments`, 'POST', { body: mark ? `${line}\n\n${mark}` : line });
}

// the alert issue, while some posts wait for a model
const alertBody = tried => [
  'The Dreamports bot can\'t judge the posts listed below for now, since none of its models answered. Until it can, it does nothing to them, and each keeps the `moderation-waiting` label on its issue, pull request or thread. It tries again every hour, and closes this issue once nothing waits. A post that still waits after a week is left as it is.',
  '',
  `Models asked: ${tried.length ? tried.map(model => `\`${model}\``).join(', ') : 'none could be asked'}.`,
  `Last tried: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
  '', `[How moderation works](${docs.moderation})`
].join('\n');
let entries;
const waiting = async () => (entries ??= await waitingEntries());
const waitMark = (state, node, parent) => `<!-- dreamports-moderation: ${state}=${node} parent=${parent} -->`;

async function markWaiting(item, tried) {
  const all = await waiting();
  if (!all.some(entry => !entry.settled && entry.open && entry.node === item.node)) {
    const alert = await ownIssue('moderation-alert', 'The Dreamports bot can\'t judge some posts', alertBody(tried), { state: 'open' });
    const comment = await api(`/issues/${alert}/comments`, 'POST', {
      body: `${postLink(item)} waits for a model.\n\n${waitMark('waiting', item.node, item.parent.node)}`
    });
    all.push({ alert, open: true, comment: comment.id, since: comment.created_at, settled: false, node: item.node, parent: item.parent.node });
  }
  if (!item.parent.labels.includes('moderation-waiting')) {
    await graphql(MUTATIONS.label, { id: item.parent.node, labels: [await labelId('moderation-waiting')] });
  }
  summary.push(`- ${postLink(item)} waits for a model.`);
}

// a post that no longer waits: its entry says so, and its issue, pull request or thread loses the label once
// nothing in it waits
async function settle(node, item, how) {
  const all = await waiting();
  const mine = all.filter(entry => !entry.settled && entry.node === node);
  for (const entry of mine) {
    await api(`/issues/comments/${entry.comment}`, 'PATCH', {
      body: `${item ? postLink(item) : 'A post'} waited for a model, and ${how}.\n\n${waitMark('settled', node, entry.parent)}`
    });
    entry.settled = true;
  }
  const parent = mine[0]?.parent;
  if (parent && !all.some(entry => !entry.settled && entry.parent === parent)) {
    await graphql(MUTATIONS.unlabel, { id: parent, labels: [await labelId('moderation-waiting')] }, { missing: true });
  }
}

// whether the bot already wrote a comment ending with this mark, among the last ones of this issue, pull request or
// thread
async function wrote(id, mark) {
  const fields = 'body author { login __typename }';
  const { node } = await graphql(`query($id: ID!) { node(id: $id) {
    ... on Issue { comments(last: 100) { nodes { ${fields} } } }
    ... on PullRequest { comments(last: 100) { nodes { ${fields} } } }
    ... on Discussion { comments(last: 100) { nodes { ${fields} replies(last: 50) { nodes { ${fields} } } } } } } }`, { id });
  return (node?.comments?.nodes ?? []).flatMap(comment => [comment, ...(comment.replies?.nodes ?? [])])
    .some(comment => comment.author?.__typename === 'Bot' && comment.author.login === 'github-actions' && comment.body?.includes(mark));
}

// whether the bot already answered this post with this verdict, or flagged it for this reason in the log, as when two
// hourly runs both check a review
const replied = (item, key) => wrote(item.parent.node, markFor(item.node, key));
async function flaggedBefore(item, key) {
  const [issue] = await ownIssues('moderation-log', 'all');
  return Boolean(issue) && wrote(issue.node_id, markFor(item.node, key, 'flagged'));
}

// a reply in the post's issue, pull request or thread. In Discussions it goes under the post's own comment, or at
// the end of the thread when GitHub refuses that, as it does under a hidden comment.
async function reply(item, body) {
  if (item.parent.kind !== 'discussion') return graphql(MUTATIONS.comment, { id: item.parent.node, body });
  if (item.replyTo) {
    try {
      return await graphql(MUTATIONS.discussionComment, { id: item.parent.node, replyTo: item.replyTo, body });
    } catch (error) {
      console.log(`The reply goes at the end of the thread, since GitHub refused it under the comment: ${error.message}`);
    }
  }
  return graphql(MUTATIONS.discussionComment, { id: item.parent.node, replyTo: null, body });
}

// The fixed plan for the verdict, each step done only if it isn't already, and logged even if a later one fails. A
// post by the repository's own people, or a claims command, is only flagged in the log.
async function act(result, item) {
  const plan = planFor(result.key, item);
  if (!plan.length) return;
  const entry = { item, key: result.key, by: result.by, model: result.model };
  const flagged = isClaimsCommand(item) ? 'claims' : isTrusted(item, treatAsPublic) ? 'trusted' : null;
  if (flagged) {
    if (!await flaggedBefore(item, result.key)) await log(logLine({ ...entry, flagged }), markFor(item.node, result.key, 'flagged'));
    return;
  }
  const did = [];
  try {
    for (const step of plan) {
      if (step.do === 'hide' && !item.minimized) {
        await graphql(MUTATIONS.hide, { id: item.node, as: step.as });
        did.push('hid');
      } else if (step.do === 'reply' && !await replied(item, result.key)) {
        await reply(item, replyFor(result.key, item, docs));
        did.push('replied');
      } else if (step.do === 'close' && !item.parent.closed) {
        await graphql(MUTATIONS[item.parent.kind], { id: item.parent.node });
        did.push('closed');
      } else if (step.do === 'lock' && !item.parent.locked) {
        await graphql(MUTATIONS.lock, { id: item.parent.node, as: step.as });
        did.push('locked');
      } else if (step.do === 'label' && !item.parent.labels.includes(step.name)) {
        await graphql(MUTATIONS.label, { id: item.parent.node, labels: [await labelId(step.name)] });
        did.push('labelled');
      }
    }
  } finally {
    if (did.length) await log(logLine({ ...entry, did }));
  }
}

const treatAsPublic = accounts(process.env.MODERATION_TREAT_AS_PUBLIC);
const verdicts = checkVerdicts(process.env.VERDICTS ?? '');
if (!verdicts) console.log(`No verdicts to act on: the judging job ended with "${process.env.JUDGED}".`);
let results = verdicts?.results ?? [], gone = verdicts?.gone ?? [];
if (!sweep) {
  // an event acts only on its own post, which waits when the judging job couldn't judge it
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const node = (event.comment ?? event.review ?? event.pull_request ?? event.issue ?? event.discussion)?.node_id;
  results = verdicts ? results.filter(result => result.node === node) : node ? [{ kind: null, node, key: 'wait', by: 'none' }] : [];
  gone = [];
}
const tried = verdicts?.model.tried ?? [];
let failed = false;
const items = new Map((await fetchItems(results.map(result => result.node))).map(item => [item.node, item]));
for (const result of results) {
  const item = items.get(result.node);
  if (!item || item.repository !== repository || item.bot || (result.kind && result.kind !== item.kind) || result.key === 'skip') continue;
  try {
    if (result.key === 'wait') await markWaiting(item, tried);
    else {
      await act(result, item);
      if (sweep || item.parent.labels.includes('moderation-waiting')) await settle(item.node, item, 'is checked now');
    }
  } catch (error) {
    failed = true;
    console.log(`Couldn't finish with ${item.url}: ${error.message}`);
  }
}

if (sweep) {
  try {
    for (const node of gone) if (!(await fetchItems([node])).length) await settle(node, null, 'is gone now');
    // a post that has waited a week is left as it is
    for (const entry of (await waiting()).filter(entry => !entry.settled && Date.now() - Date.parse(entry.since) > 7 * DAY)) {
      const [item] = await fetchItems([entry.node]);
      await settle(entry.node, item, 'no model could judge it for a week, so the bot left it as it is');
      if (item) await log(`Left ${postLink(item)} as it is: no model could judge it for a week.`);
    }
    // the alert closes once nothing waits, read again in case a post started waiting meanwhile
    const open = (await alertIssues('open')).sort((a, b) => a.number - b.number);
    if (open.length) {
      entries = undefined;
      if ((await waiting()).every(entry => entry.settled)) {
        for (const alert of open) {
          await api(`/issues/${alert.number}/comments`, 'POST', { body: 'Nothing waits for a model any more, so I\'m closing this.' });
          await api(`/issues/${alert.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
        }
        summary.push('- Nothing waits for a model any more, so the alert issue is closed.');
      } else await api(`/issues/${open[0].number}`, 'PATCH', { body: alertBody(tried) });
    }
  } catch (error) {
    failed = true;
    console.log(`Couldn't finish the hourly run: ${error.message}`);
  }
}

appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## What the bot did\n\n${summary.length ? summary.join('\n') : 'Nothing.'}\n`);
if (failed) process.exitCode = 1;
