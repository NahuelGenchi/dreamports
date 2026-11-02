// The Dreamports bot's acting on a game's first entry (docs/TEAMS.md): it checks the plan read.mjs made against a fixed
// shape, then says one of the fixed things in text.mjs, or merges that very commit. It runs nothing else.
import { api } from '../moderation/github.mjs';
import { NOT_MERGED, REASONS, WAITING, askFor, merged, normalReview, notYet } from './text.mjs';

const plan = JSON.parse(process.env.PLAN);
const COUNT = value => Number.isInteger(value) && value > 0;
const shape = {
  pr: COUNT,
  comment: value => value === null || COUNT(value),
  why: value => Object.hasOwn(REASONS, value),
  game: value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
  sha: value => /^[0-9a-f]{40}$/.test(value),
  head: value => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value),
  name: value => /^[A-Za-z0-9][A-Za-z0-9 '!&.:,+-]{0,60}$/.test(value),
  issue: COUNT,
  milestone: value => value === null || COUNT(value),
};
const FIELDS = {
  say: ['pr', 'comment', 'why'],
  ask: ['pr', 'comment', 'game', 'sha', 'head', 'name'],
  wait: ['pr', 'comment', 'game', 'sha', 'head', 'name'],
  merge: ['pr', 'comment', 'game', 'sha', 'head', 'name', 'issue', 'milestone'],
};
const wanted = FIELDS[plan.kind];
if (!wanted || Object.keys(plan).length !== wanted.length + 1 || !wanted.every(key => shape[key](plan[key]))) throw new Error('The plan isn\'t one of the fixed shapes.');

const say = body => (plan.comment
  ? api(`/issues/comments/${plan.comment}`, 'PATCH', { body })
  : api(`/issues/${plan.pr}/comments`, 'POST', { body }));

if (plan.kind === 'say') await say(normalReview(plan.why));
if (plan.kind === 'ask') await say(askFor(plan));
if (plan.kind === 'wait') await say(notYet(plan, WAITING));
if (plan.kind === 'merge') {
  try {
    if (plan.milestone) await api(`/issues/${plan.pr}`, 'PATCH', { milestone: plan.milestone });
    await api(`/pulls/${plan.pr}/merge`, 'PUT', { sha: plan.sha, merge_method: 'squash', commit_title: `feat: ${plan.name} Dreamport's first entry (#${plan.issue}) (#${plan.pr})`, commit_message: 'What npm run dp -- new and npm run dp -- capture write, with its capture looked at by the Dreamports team (docs/TEAMS.md).' });
  } catch (error) {
    console.error(error.message);
    await say(notYet(plan, NOT_MERGED));
    process.exit(0);
  }
  await say(merged(plan.name));
}
