// The Dreamports bot's acting on a new game's first files and on its card (docs/TEAMS.md): it checks the plan read.mjs
// made against a fixed shape, then says one of the fixed things in text.mjs, or merges that very commit. After first
// files, it starts the workflow that puts the game's progress map in its issue, as a merge made here starts no run of
// it. It runs nothing else.
import { api } from '../moderation/github.mjs';
import { KINDS, NOT_MERGED, NOT_MERGED_FILES, REASONS, WAITING, askFor, comingFor, merged, normalReview, notYet } from './text.mjs';

const plan = JSON.parse(process.env.PLAN);
const COUNT = value => Number.isInteger(value) && value > 0;
const shape = {
  pr: COUNT,
  comment: value => value === null || COUNT(value),
  why: value => Object.hasOwn(REASONS, value),
  what: value => Object.hasOwn(KINDS, value),
  game: value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
  sha: value => /^[0-9a-f]{40}$/.test(value),
  head: value => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value),
  name: value => /^[A-Za-z0-9][A-Za-z0-9 '!&.:,+-]{0,60}$/.test(value),
  issue: COUNT,
  milestone: value => value === null || COUNT(value),
  method: value => value === 'merge' || value === 'squash',
};
const FIELDS = {
  say: ['pr', 'comment', 'why', 'what'],
  coming: ['pr', 'comment', 'game', 'sha', 'head', 'name'],
  ask: ['pr', 'comment', 'game', 'sha', 'head', 'name'],
  wait: ['pr', 'comment', 'game', 'sha', 'head', 'name'],
  merge: ['pr', 'comment', 'game', 'sha', 'head', 'name', 'issue', 'milestone', 'method', 'what'],
};
const wanted = FIELDS[plan.kind];
if (!wanted || Object.keys(plan).length !== wanted.length + 1 || !wanted.every(key => shape[key](plan[key]))) throw new Error('The plan isn\'t one of the fixed shapes.');

const say = body => (plan.comment
  ? api(`/issues/comments/${plan.comment}`, 'PATCH', { body })
  : api(`/issues/${plan.pr}/comments`, 'POST', { body }));

// how each kind goes on main: first files as what the tools wrote, a card after someone looked at it
const MERGES = {
  files: { title: 'first files', message: 'What npm run dp -- new writes, which the Dreamports bot wrote again and compared (docs/TEAMS.md).', refused: NOT_MERGED_FILES },
  card: { title: 'capture', message: 'What npm run dp -- capture writes, with its capture looked at by the Dreamports team (docs/TEAMS.md).', refused: NOT_MERGED },
};

if (plan.kind === 'say') await say(normalReview(plan.why, plan.what));
if (plan.kind === 'coming') await say(comingFor(plan));
if (plan.kind === 'ask') await say(askFor(plan));
if (plan.kind === 'wait') await say(notYet(plan, WAITING));
if (plan.kind === 'merge') {
  const { title, message, refused } = MERGES[plan.what];
  try {
    if (plan.milestone) await api(`/issues/${plan.pr}`, 'PATCH', { milestone: plan.milestone });
    await api(`/pulls/${plan.pr}/merge`, 'PUT', { sha: plan.sha, merge_method: plan.method, commit_title: `feat: ${plan.name} Dreamport's ${title} (#${plan.issue}) (#${plan.pr})`, commit_message: message });
  } catch (error) {
    console.error(error.message);
    await say(notYet(plan, refused, plan.what));
    process.exit(0);
  }
  await say(merged(plan.name, plan.what));
  if (plan.what === 'files') {
    try {
      await api('/actions/workflows/issue-maps.yml/dispatches', 'POST', { ref: process.env.DEFAULT_BRANCH });
    } catch (error) {
      // its hourly run puts the map there all the same
      console.error(error.message);
    }
  }
}
