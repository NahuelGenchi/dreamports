// Nothing public here credits a coding agent (AGENTS.md), and an issue and its comments are public too. The Check
// workflow reads a pull request's title, description and commits (credit.mjs) and fails it. An issue has nothing to
// fail, so the Credit workflow runs this on an issue or a comment that was opened or edited: it reads the issue's
// title and text and every comment on it, and where a line credits an agent it leaves one comment that names each
// line, written again when the lines change and taken away once they're gone. On a pull request it reads only the
// comments, as Check reads the rest. It reads text and runs nothing from it (#2084).
//
// node .github/credit/issue.mjs, with GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GH_TOKEN as a workflow gives them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creditProblems } from './credit.mjs';

// what marks the check's own comment, so it's found again
export const MARK = '<!-- credit-check -->';

/**
 * Each line of an issue that credits a coding agent, as sentences. `issue` is { title, body, pullRequest }, and
 * `comments` are { author, body, own }, all of them. The check's own comment, `own`, quotes the lines it found, so it's
 * left out: by who wrote it, never by its mark, which anyone can type.
 */
export function issueCredits(issue, comments = []) {
  const texts = issue.pullRequest ? [] : [{ where: 'The title', text: issue.title }, { where: 'The description', text: issue.body }];
  for (const comment of comments) {
    if (!comment.own) texts.push({ where: `A comment by ${comment.author}`, text: comment.body });
  }
  return creditProblems(texts);
}

/** The check's comment for these lines. */
export function noteFor(problems) {
  return `${MARK}\nNothing public here credits a coding agent: anyone may use one, and what they post is theirs alone. `
    + `Please edit ${problems.length === 1 ? 'this line' : 'these lines'} out:\n\n${problems.map(problem => `> ${problem}`).join('\n')}\n\n`
    + 'This comment goes away by itself once they are gone.';
}

/** What to do with the check's comment: 'post', 'update', 'delete' or 'nothing', from what's found and what's there. */
export function whatToDo(problems, kept) {
  if (!problems.length) return kept ? 'delete' : 'nothing';
  if (!kept) return 'post';
  return kept.body === noteFor(problems) ? 'nothing' : 'update';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const root = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(root + path, {
      method, signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const number = event.issue.number;
  // the issue as it is now, as the event may be older than its last edit
  const issue = await api(`/issues/${number}`);
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/issues/${number}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const kept = comments.find(comment => comment.body?.includes(MARK) && comment.user?.type === 'Bot') ?? null;
  const problems = issueCredits({ title: issue.title, body: issue.body, pullRequest: Boolean(issue.pull_request) }, comments.map(comment => ({ author: comment.user?.login ?? 'someone', body: comment.body, own: comment.id === kept?.id })));
  const doing = whatToDo(problems, kept);
  if (doing === 'post') await api(`/issues/${number}/comments`, 'POST', { body: noteFor(problems) });
  if (doing === 'update') await api(`/issues/comments/${kept.id}`, 'PATCH', { body: noteFor(problems) });
  if (doing === 'delete') await api(`/issues/comments/${kept.id}`, 'DELETE');
  console.log(problems.length ? `#${number} credits a coding agent in ${problems.length === 1 ? 'a line' : `${problems.length} lines`}: ${doing}.\n${problems.join('\n')}` : `Nothing in #${number} credits a coding agent${doing === 'delete' ? ', so the comment that said so is gone' : ''}.`);
}
