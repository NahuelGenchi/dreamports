// Keeps dreamports.net up to date with main (docs/LIVE-SITE.md). Cloudflare builds the site on every push to main, but
// a build can fail before it starts, and then the site stays behind with nothing to say so. This reads the live site:
// which commit it was built from and what each Dreamport's cards show. While it's behind, it asks Cloudflare for
// another build through the Deploy Hook. When that doesn't bring it up to date, it says so to the workflow,
// .github/workflows/live-site.yml, which puts main live itself if it can, and then runs this again with --last, which
// opens an issue if the site is still behind, and closes it once the site has caught up.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { problemsWith } from '../../src/lib/cards.mjs';
import { dreamports } from '../../tools/readme.mjs';

export const SITE = 'https://dreamports.net';
export const TITLE = 'fix: dreamports.net is behind main';
const MINUTE = 60_000;
// how long a build gets before another is asked for: one that fails to start takes about nine minutes to say so
const BUILD = 10;
// how long after a commit Cloudflare's builds get to bring the site up to date, how long a later run gives them, and how
// long the last look waits for what the workflow put live to show
const LONGEST = 20, LATER = 10, LAST = 3;
const POLL = 0.5;

/**
 * Looks at the site until it's up to date or its time is up, and gives what it last found wrong, nothing when it's up
 * to date. A run right after a push gives that push's own build time before it asks for another, a run that finds the
 * site long behind asks at once, and the last look asks for nothing.
 */
export async function watch({ problems, ask, committed, last = false, now = Date.now, sleep, minute = MINUTE }) {
  const end = last ? now() + LAST * minute : Math.max(now() + LATER * minute, committed + LONGEST * minute);
  let asked = committed;
  for (;;) {
    const found = await problems();
    if (!found.length || now() >= end) return found;
    if (!last && now() - asked >= BUILD * minute) {
      await ask(found);
      asked = now();
    }
    await sleep(POLL * minute);
  }
}

const short = commit => (commit ? commit.slice(0, 7) : null);

/** What's wrong with the live site, from its address: nothing to say when it's up to date with `head`. */
export async function liveProblems(site, head, list) {
  const read = async (path) => {
    try {
      const response = await fetch(new URL(path, site), { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };
  const built = await read('/build.json');
  let from = null;
  try {
    from = JSON.parse(built ?? '{}').commit ?? null;
  } catch { /* a page that isn't the build's says nothing about it */ }
  if (from !== head) return [`The site was built from ${short(from) ?? 'a commit it doesn\'t name'}, and main is at ${short(head)}.`];
  return problemsWith(list, read);
}

// the issue that says so, in the repository the run is in, found by its title among the open bugs
function alerts({ repository = process.env.GITHUB_REPOSITORY, api = process.env.GITHUB_API_URL ?? 'https://api.github.com', token = process.env.GH_TOKEN, run } = {}) {
  const github = async (path, method = 'GET', body) => {
    const response = await fetch(`${api}/repos/${repository}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const open = async () => (await github('/issues?state=open&labels=bug&per_page=100')).find(issue => issue.title === TITLE);
  return {
    // whether this is what first says so
    raise: async (found) => {
      if (await open()) return false;
      const issue = await github('/issues', 'POST', {
        title: TITLE,
        labels: ['bug'],
        body: [
          'Milestone: M4 — Sonic Advance Dreamport on dreamports.net',
          '',
          'dreamports.net doesn\'t show what\'s in `main`, and asking Cloudflare for more builds hasn\'t fixed it. The Live site workflow keeps trying every half hour, and closes this issue by itself once the site is up to date.',
          '',
          '## What it found',
          '',
          ...found.map(problem => `- ${problem}`),
          '',
          '## What to do',
          '',
          'Look at [Cloudflare\'s status page](https://www.cloudflarestatus.com/), then at the `dreamports` Worker\'s latest builds in its dashboard. [docs/LIVE-SITE.md](../blob/main/docs/LIVE-SITE.md#when-its-issue-opens) says what to do.',
          ...(run ? ['', `[The run that opened this](${run})`] : []),
        ].join('\n'),
      });
      // so its owner hears of it, on its own, since nothing about this may stop the issue opening
      await github(`/issues/${issue.number}/assignees`, 'POST', { assignees: [repository.split('/')[0]] }).catch(() => {});
      return true;
    },
    clear: async () => {
      const issue = await open();
      if (!issue) return false;
      await github(`/issues/${issue.number}/comments`, 'POST', { body: 'dreamports.net is up to date with `main` again.' });
      await github(`/issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
      return true;
    },
  };
}

/**
 * A whole run, with its parts given by the workflow's environment: false only when it's what first says the site is
 * behind, so that the runs after it send no more mail. Without `last`, it leaves saying so to the last look, and tells
 * the workflow, which may put main live itself first.
 */
export async function run({
  last = false,
  site = SITE,
  hook = process.env.DEPLOY_HOOK,
  head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  committed = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim()) * 1000,
  list = dreamports(),
  minute = MINUTE,
  github = {},
  log = console.log,
  behind = () => appendFileSync(process.env.GITHUB_OUTPUT, 'behind=true\n'),
} = {}) {
  const { raise, clear } = alerts(github);
  const found = await watch({
    problems: () => liveProblems(site, head, list),
    minute,
    committed,
    last,
    sleep: time => new Promise(resolve => setTimeout(resolve, time)),
    ask: async (now) => {
      log(now.join('\n'));
      if (!hook) return log('::warning::This repository has no CLOUDFLARE_DEPLOY_HOOK secret, so no build can be asked for.');
      try {
        const response = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(30_000) });
        log(response.ok ? 'Asked Cloudflare for another build.' : `::warning::Cloudflare answered the request for a build with HTTP ${response.status}.`);
      } catch {
        log('::warning::Cloudflare didn\'t answer the request for a build.');
      }
    },
  });
  if (!found.length) {
    if (await clear()) log('Closed the issue that said the site was behind.');
    log(`dreamports.net is up to date with ${short(head)}, and every Dreamport's cards show its proof's numbers.`);
    return true;
  }
  if (!last) {
    log(`Cloudflare's builds haven't brought dreamports.net up to date. ${found.join(' ')}`);
    behind();
    return true;
  }
  const opened = await raise(found);
  log(`::${opened ? 'error' : 'warning'}::dreamports.net is behind main. ${found.join(' ')}`);
  return !opened;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = process.env.GITHUB_SERVER_URL, repository = process.env.GITHUB_REPOSITORY, id = process.env.GITHUB_RUN_ID;
  const fine = await run({
    last: process.argv.includes('--last'),
    github: { run: server && repository && id ? `${server}/${repository}/actions/runs/${id}` : undefined },
  });
  process.exit(fine ? 0 : 1);
}
