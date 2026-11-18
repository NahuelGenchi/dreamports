// A stand-in for GitHub's issues, for tests of where a game's tasks go (docs/TEAMS.md): it keeps issues in a plain
// object, answers the REST calls the tools, the claims workflow and the site make, and keeps the limits GitHub has on
// issues under issues, as they were checked on GitHub itself in #1473: 100 under one, closed ones too, one parent
// each, and eight levels, the top issue and seven layers under it. A call it has no answer for throws, so a test never passes on a guess. `runClaims` runs the
// claims workflow's own script against it, as GitHub starts it for a new issue or a comment, and `GH` is a program
// named gh for the tools, which keeps the same issues in a file. Nothing here reaches GitHub.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const BOT = 'github-actions[bot]';
/** GitHub's limits on issues under issues. */
export const MOST_UNDER = 100, MOST_LEVELS = 8;

/** A place to keep issues: `issues` each { number, title, body, … }, with `parent` the number of the issue it's under. */
export const newSite = (issues = [], repository = 'stand-in/dreamports') => ({
  repository, next: Math.max(0, ...issues.map(issue => issue.number)) + 1, log: [], refused: [], comments: 0,
  issues: issues.map(issue => ({ state: 'open', assignees: [], labels: [], comments: [], user: { login: 'someone' }, milestone: null, parent: null, ...issue })),
});

/** The files of the default branch as they are in this folder, for the workflow's reads: a path's text, the names in a
 *  folder, or null. */
export function filesHere(path) {
  const at = join(REPO, path);
  if (!existsSync(at)) return null;
  return statSync(at).isDirectory() ? readdirSync(at, { withFileTypes: true }).map(each => ({ name: each.name, type: each.isDirectory() ? 'dir' : 'file' })) : readFileSync(at, 'utf8');
}

/** The same from a list of made-up files, { path: text }. */
export const filesOf = files => path => {
  if (Object.hasOwn(files, path)) return files[path];
  const inside = [...new Set(Object.keys(files).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1).split('/')[0]))];
  return inside.length ? inside.map(name => ({ name, type: Object.keys(files).some(file => file.startsWith(`${path}/${name}/`)) ? 'dir' : 'file' })) : null;
};

/**
 * What answers for a `site` as `repository`'s API: request(method, path, body, who) gives { status, body }, with
 * `path` as it comes after repos/<repository>, its query included, and `who` the account that asks.
 */
export function github(site, { repository = site.repository, files = filesHere } = {}) {
  const root = `https://api.github.com/repos/${repository}`;
  const numbered = number => site.issues.find(issue => issue.number === Number(number));
  const under = issue => site.issues.filter(each => each.parent === issue.number);
  // how many levels an issue is from the top, itself the first, and how many are under it, itself included
  const level = issue => (issue.parent ? level(numbered(issue.parent)) + 1 : 1);
  const depth = issue => 1 + Math.max(0, ...under(issue).map(depth));
  const shown = issue => ({
    id: 5000 + issue.number, number: issue.number, url: `${root}/issues/${issue.number}`, repository_url: root,
    html_url: `https://github.test/${repository}/issues/${issue.number}`, title: issue.title, body: issue.body, state: issue.state,
    assignees: issue.assignees, labels: issue.labels, milestone: issue.milestone, user: issue.user,
    created_at: issue.created_at ?? '2026-01-01T00:00:00Z', updated_at: issue.updated_at ?? '2026-01-01T00:00:00Z',
    ...(issue.parent ? { parent_issue_url: `${root}/issues/${issue.parent}` } : {}),
    sub_issues_summary: { total: under(issue).length, completed: under(issue).filter(each => each.state !== 'open').length },
  });
  const refuse = (path, why) => {
    site.refused.push(`${path}: ${why}`);
    return { status: 422, body: { message: why } };
  };
  function request(method, asked, sent, who = 'someone') {
    const { pathname: path, searchParams: query } = new URL(asked, 'https://stand-in.test');
    site.log.push(`${method} ${path}`);
    const page = list => {
      const size = Number(query.get('per_page') ?? 30), at = Number(query.get('page') ?? 1);
      return { status: 200, body: list.slice((at - 1) * size, at * size) };
    };
    const found = /^\/issues\/(\d+)(?:\/(\w+))?$/.exec(path), issue = found && numbered(found[1]), part = found?.[2];
    if (found && !issue) return { status: 404, body: { message: 'Not Found' } };
    if (method === 'GET') {
      if (path === '/issues') {
        const label = query.get('labels'), state = query.get('state') ?? 'open';
        return page(site.issues.filter(each => (state === 'all' || each.state === state) && (!label || each.labels.some(l => l.name === label)))
          .sort((a, b) => (query.get('direction') === 'desc' || !query.get('direction') ? b.number - a.number : a.number - b.number)).map(shown));
      }
      if (issue && !part) return { status: 200, body: shown(issue) };
      if (part === 'sub_issues') return page(under(issue).map(shown));
      if (part === 'comments') return page(issue.comments);
      if (part === 'timeline') return page([]);
      if (path === '/pulls' || path === '/forks' || path === '/milestones') return page([]);
      if (path.startsWith('/labels/')) return { status: 200, body: { name: decodeURIComponent(path.slice(8)), description: `in games/${decodeURIComponent(path.slice(8))}/` } };
      if (path.startsWith('/branches/')) return { status: 404, body: { message: 'Not Found' } };
      if (path.startsWith('/contents/')) {
        const file = files(decodeURIComponent(path.slice('/contents/'.length)));
        if (file === null) return { status: 404, body: { message: 'Not Found' } };
        return { status: 200, body: Array.isArray(file) ? file : { content: Buffer.from(file).toString('base64') } };
      }
    }
    if (method === 'POST' && path === '/issues') {
      const made = { ...newSite([{ number: site.next++, title: sent.title, body: sent.body ?? '', user: { login: who, type: who === BOT ? 'Bot' : 'User' } }]).issues[0],
        labels: (sent.labels ?? []).map(name => ({ name })), milestone: sent.milestone ? { number: sent.milestone, title: 'A milestone' } : null };
      site.issues.push(made);
      return { status: 201, body: shown(made) };
    }
    if (method === 'POST' && path === '/milestones') return { status: 201, body: { number: 1, title: sent.title } };
    if (method === 'POST' && path === '/labels') return { status: 201, body: sent };
    if (method === 'PATCH' && issue && !part) {
      if (sent.milestone !== undefined) issue.milestone = { number: sent.milestone, title: 'A milestone' };
      for (const key of ['title', 'body', 'state']) if (sent[key] !== undefined) issue[key] = sent[key];
      return { status: 200, body: shown(issue) };
    }
    if (method === 'POST' && part === 'sub_issues') {
      const child = site.issues.find(each => 5000 + each.number === sent.sub_issue_id);
      if (!child) return { status: 404, body: { message: 'Not Found' } };
      // GitHub's own words for each, as it answered on 17 November 2026 (#1473)
      if (child.parent) return refuse(path, 'An error occurred while adding the sub-issue to the parent issue. Sub issue may only have one parent');
      if (under(issue).length >= MOST_UNDER) return refuse(path, `An error occurred while adding the sub-issue to the parent issue. Parent cannot have more than ${MOST_UNDER} sub-issues`);
      if (level(issue) + depth(child) > MOST_LEVELS) return refuse(path, `You can’t add more than ${MOST_LEVELS - 1} layers of sub-issues. To add a sub-issue, remove a parent issue at any level.`);
      child.parent = issue.number;
      return { status: 201, body: shown(issue) };
    }
    if (method === 'POST' && part === 'labels') {
      issue.labels.push(...sent.labels.filter(name => !issue.labels.some(l => l.name === name)).map(name => ({ name })));
      return { status: 200, body: issue.labels };
    }
    if (part === 'assignees' && (method === 'POST' || method === 'DELETE')) {
      const named = sent.assignees.map(login => login.toLowerCase());
      issue.assignees = method === 'POST' ? [...issue.assignees, ...sent.assignees.filter(login => !issue.assignees.some(a => a.login.toLowerCase() === login.toLowerCase())).map(login => ({ login }))]
        : issue.assignees.filter(a => !named.includes(a.login.toLowerCase()));
      return { status: method === 'POST' ? 201 : 200, body: shown(issue) };
    }
    if (method === 'POST' && part === 'comments') {
      const comment = { id: 9000 + ++site.comments, body: sent.body, user: { login: who, type: who === BOT ? 'Bot' : 'User' }, created_at: '2026-01-02T00:00:00Z' };
      issue.comments.push(comment);
      return { status: 201, body: comment };
    }
    throw new Error(`The stand-in for GitHub has no answer for ${method} ${path}.`);
  }
  return {
    repository, root, request,
    /** The same as fetch gives it, for the claims workflow and the site, who ask as `who`. */
    fetchAs: who => async (url, { method = 'GET', body } = {}) => {
      if (!String(url).startsWith(root)) throw new Error(`The stand-in for GitHub was asked for ${url}, which isn't ${repository}.`);
      const { status, body: answer } = request(method, String(url).slice(root.length), body ? JSON.parse(body) : undefined, who);
      return new Response(JSON.stringify(answer), { status });
    },
  };
}

// the claims workflow's script: what its step gives node, between the two NODE lines, without the step's indent
function claimsScript() {
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'claims.yml'), 'utf8').split('\n');
  const first = workflow.findIndex(line => line.trim() === 'node --input-type=module <<\'NODE\'');
  const last = workflow.findIndex((line, index) => index > first && line.trim() === 'NODE');
  const indent = workflow[first].length - workflow[first].trimStart().length;
  return workflow.slice(first + 1, last).map(line => line.slice(indent)).join('\n');
}

let runs = 0;
/**
 * One run of the claims workflow on issue `number` of a `site`, as GitHub starts it for a new issue or a comment
 * there, with this folder's src/lib as the default branch's: the script in .github/workflows/claims.yml itself, with
 * its files in `folder`. Answers what it said it did.
 */
export async function runClaims(site, number, folder, options = {}) {
  const { repository, fetchAs } = github(site, options);
  mkdirSync(folder, { recursive: true });
  const file = name => join(folder, `${process.pid}-${runs}-${name}`);
  runs += 1;
  writeFileSync(file('event.json'), JSON.stringify({ issue: { number } }));
  writeFileSync(file('claims.mjs'), claimsScript());
  writeFileSync(file('summary.md'), '');
  Object.assign(process.env, {
    GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: file('event.json'), GITHUB_WORKSPACE: pathToFileURL(REPO).href.replace(/\/$/, ''), GH_TOKEN: 'none', DAYS: '14',
    GITHUB_STEP_SUMMARY: file('summary.md'), GITHUB_OUTPUT: file('output'),
  });
  const real = globalThis.fetch;
  globalThis.fetch = fetchAs(BOT);
  try {
    await import(pathToFileURL(file('claims.mjs')).href);
  } finally {
    globalThis.fetch = real;
  }
  return readFileSync(file('summary.md'), 'utf8');
}

/**
 * A program named gh, for the tools: `gh api …` as tools/lib/github.mjs calls it, answered from the site kept in the
 * file STAND_IN_GITHUB names, as the account STAND_IN_LOGIN. A new issue of a game, and a comment that claims or
 * releases, start the claims workflow at once, as they do on GitHub, so the issue is where the workflow puts it by the
 * time the tool looks.
 */
export const GH = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { github, runClaims } from ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};
const file = process.env.STAND_IN_GITHUB, who = process.env.STAND_IN_LOGIN ?? 'sam', site = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const asked = args.find(arg => /^(repos\\/|user$)/.test(arg)), method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
const save = () => writeFileSync(file, JSON.stringify(site));
if (asked === 'user') { process.stdout.write(who + '\\n'); process.exit(0); }
const [, owner, name, ...rest] = asked.split('/');
const repository = owner + '/' + name, path = '/' + rest.join('/');
if (repository !== site.repository) {
  // another repository, such as the one a team build is looked for in: nothing is there
  site.log.push(method + ' elsewhere: ' + asked);
  save();
  if (/\\/forks(\\?|$)/.test(asked)) { process.stdout.write('[]'); process.exit(0); }
  process.stderr.write('gh: Not Found (HTTP 404)\\n');
  process.exit(1);
}
const sent = args.includes('--input') ? JSON.parse(readFileSync(0, 'utf8')) : undefined;
const { status, body } = github(site, { repository }).request(method, path, sent, who);
if (status >= 400) { save(); process.stderr.write('gh: ' + body.message + ' (HTTP ' + status + ')\\n'); process.exit(1); }
const started = method === 'POST' && (path === '/issues' ? /^### Game folder/m.test(sent.body ?? '') && body.number : /^\\/issues\\/\\d+\\/comments$/.test(path) && /^\\/(claim|release)/.test(sent.body) && Number(path.split('/')[2]));
if (started) await runClaims(site, started, process.env.STAND_IN_WORK, { repository });
save();
process.stdout.write(JSON.stringify(body));
`;
