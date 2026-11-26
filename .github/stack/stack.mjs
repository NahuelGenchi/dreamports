// A stack of pull requests merges through its top one: each piece's pull request is on main and says "Builds on #<number>"
// for the one below it, whose commits it carries, and when the top merges GitHub marks each one below merged too, as its
// commits are in the top's. So only the top's tree reaches main and only the top's tests decide anything, and every push
// to a stack ran each heavy workflow on every lower pull request as well, which kept the top's waiting for a computer
// (#2034).
//
// node .github/stack/stack.mjs is the first job of each heavy workflow, Stack (in Clips, its first step). It fails a pull
// request that one above carries and names the one at the top to merge it through, so the jobs after it never start and
// its Check and Clips never pass on their own. One above carries it when it's open, from this repository and not a fork,
// on the same base, says "Builds on #<this one>", and its head has this one's head and more, so its run tests every
// commit of this one and nobody else's pull request can switch this one's tests off. Anything less, as when the one above
// is closed without merging or its line is taken out, or when GitHub doesn't answer, and it runs in full.
//
// node .github/stack/stack.mjs --stop runs on a pull request's own events (.github/workflows/stack.yml). For each pull
// request its Builds on lines name, now or before the edit, that it carries, it stops the heavy runs whose Stack already
// let them through, and runs them and any that passed again so Stack says why; for one that nothing carries any more, it
// runs again in full the runs Stack stopped. It reads only pull requests and runs through the API, and runs nothing from
// them.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// the pull requests a text names in lines "Builds on #<number>", read as the Builds on check reads them
export function namedBelow(text) {
  return new Set([...String(text ?? '').matchAll(/^\s*builds on #(\d+)\b/gim)].map(([, number]) => Number(number)));
}

// the line of a workflow that runs the gate, as its Stack job or step
export const GATE = /^\s*run: node \.github\/stack\/stack\.mjs\s*$/m;

// the workflows in a folder that run the gate, as a run's path names them
export function gatedWorkflows(folder = '.github/workflows') {
  return new Set(readdirSync(folder).filter(name => /\.ya?ml$/.test(name) && GATE.test(readFileSync(join(folder, name), 'utf8'))).map(name => `.github/workflows/${name}`));
}

// what GitHub's REST API answers, for one repository
export function github({ repository, token, fetch = globalThis.fetch }) {
  const root = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function call(method, path) {
    const response = await fetch(root + path, { method, headers, signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  return {
    repository,
    get: path => call('GET', path),
    post: path => call('POST', path),
    async list(path) {
      const result = [];
      for (let page = 1; ; page++) {
        const batch = await call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? [];
        result.push(...batch);
        if (batch.length < 100) return result;
      }
    },
  };
}

// whether upper carries lower at its commit sha: open, from this repository, on the same base, naming lower in a Builds on
// line, with a head that has sha and more. A head that is sha itself carries nothing more, so two can't carry each other.
export async function carries(gh, upper, lower, sha) {
  if (upper.number === lower.number || upper.state !== 'open') return false;
  if (upper.head?.repo?.full_name !== gh.repository || upper.base?.ref !== lower.base?.ref) return false;
  if (!namedBelow(upper.body).has(lower.number)) return false;
  const compared = await gh.get(`/compare/${sha}...${upper.head.sha}?per_page=1`);
  return compared?.status === 'ahead';
}

// the open pull requests at the top of every stack that carries pull at its commit sha, going up one that carries it at a
// time, or none
export async function topsOf(gh, pull, sha = pull.head.sha) {
  const open = await gh.list('/pulls?state=open');
  const tops = new Map();
  const seen = new Set([pull.number]);
  let level = [[pull, sha]];
  while (level.length) {
    const next = [];
    for (const [lower, at] of level) {
      const above = [];
      for (const upper of open) if (await carries(gh, upper, lower, at)) above.push(upper);
      if (!above.length && lower.number !== pull.number) tops.set(lower.number, lower);
      for (const upper of above) {
        if (seen.has(upper.number)) continue;
        seen.add(upper.number);
        next.push([upper, upper.head.sha]);
      }
    }
    level = next;
  }
  return [...tops.values()].sort((a, b) => a.number - b.number);
}

// what a lower pull request's Stack and Check say, with no comma, which an annotation's title can't hold
export function saying(tops) {
  const above = tops.map(top => `#${top.number}`).join(' or ');
  if (tops.length === 1) {
    return { above, message: `This pull request is tested through ${above}, which carries its commits at the top of its stack. Merge it through ${above}.` };
  }
  return { above, message: `This pull request is tested through ${above}, which each carry its commits at the top of a stack. Merge it through one of them.` };
}

// the gate: what Stack says of a run, or null when it runs in full
export async function gate({ gh, eventName, event, log = console.log }) {
  const pull = event?.pull_request;
  if (!String(eventName).startsWith('pull_request') || !pull) {
    log(`A run on ${eventName}, not on a pull request: it runs in full.`);
    return null;
  }
  let tops;
  try {
    tops = await topsOf(gh, pull);
  } catch (error) {
    log(`::warning title=Stack::GitHub didn't say whether a pull request above carries this one, so it runs in full. ${error.message.replace(/\s+/g, ' ').slice(0, 300)}`);
    return null;
  }
  if (!tops.length) {
    log(`No open pull request above carries #${pull.number} at ${pull.head.sha.slice(0, 8)}: it runs in full.`);
    return null;
  }
  return saying(tops);
}

// a run's Stack, its job or Clips' step, as GitHub lists its jobs, or null when it lists none of them yet
export function stackOf(jobs) {
  return jobs.find(job => job.name === 'Stack') ?? jobs.flatMap(job => job.steps ?? []).find(step => step.name === 'Stack') ?? null;
}

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// the runs of a pull request's heavy workflows at its head, newest first
async function heavyRuns(gh, pull, gated) {
  const runs = (await gh.get(`/actions/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=100`))?.workflow_runs ?? [];
  return runs
    .filter(run => gated.has(run.path) && (!run.pull_requests?.length || run.pull_requests.some(each => each.number === pull.number)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

const jobsOf = async (gh, run) => (await gh.get(`/actions/runs/${run.id}/jobs?per_page=100`))?.jobs ?? [];

// whether a running run is better left alone: its Stack hasn't started, so it reads GitHub as it is now, or Stack failed
// and has stopped the run already. A run with no job started yet hasn't, as Clips lists its steps only once it starts.
function leftAlone(jobs) {
  const stack = stackOf(jobs);
  if (!stack) return jobs.every(job => job.status === 'queued');
  if (stack.status === 'completed') return stack.conclusion !== 'success';
  return stack.status !== 'in_progress';
}

// on a pull request's own event: stop the heavy runs of the ones below that it carries, and run again in full those of
// one that nothing carries any more
export async function stop({ gh, event, gated, log = console.log, wait = sleep, every = 5000, tries = 36 }) {
  const payload = event.pull_request;
  if (event.action === 'closed' && payload.merged) {
    log(`#${payload.number} merged, and the pull requests below it with it.`);
    return;
  }
  if (payload.head?.repo?.full_name !== gh.repository) {
    log(`#${payload.number} is from a fork, so it carries no other pull request's tests.`);
    return;
  }
  const upper = (await gh.get(`/pulls/${payload.number}`)) ?? payload;
  const numbers = new Set([...namedBelow(upper.body), ...namedBelow(payload.body), ...namedBelow(event.changes?.body?.from)]);
  numbers.delete(upper.number);
  const stopped = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const lower = await gh.get(`/pulls/${number}`);
    if (!lower || lower.state !== 'open') {
      log(`#${number} isn't an open pull request.`);
      continue;
    }
    // each heavy workflow's newest run at its head
    const latest = new Map();
    for (const run of await heavyRuns(gh, lower, gated)) if (!latest.has(run.workflow_id)) latest.set(run.workflow_id, run);
    if (await carries(gh, upper, lower, lower.head.sha)) {
      log(`#${upper.number} carries #${number} at ${lower.head.sha.slice(0, 8)}: its runs that Stack let through stop.`);
      for (const run of latest.values()) {
        const jobs = await jobsOf(gh, run);
        // one that passed in full before #upper carried it runs again too, so it never looks ready to merge on its own
        if (run.status === 'completed') {
          if (run.conclusion !== 'success' || stackOf(jobs)?.conclusion !== 'success') continue;
          await gh.post(`/actions/runs/${run.id}/rerun`);
          log(`Ran ${run.name} on #${number} again (${run.html_url}), which passed before #${upper.number} carried it, for Stack to say which pull request carries it.`);
          continue;
        }
        if (leftAlone(jobs)) continue;
        await gh.post(`/actions/runs/${run.id}/cancel`);
        log(`Stopped ${run.name} on #${number} (${run.html_url}), as #${upper.number} carries it.`);
        stopped.push({ run, again: Boolean(stackOf(jobs)) });
      }
    } else if ((await topsOf(gh, lower)).length) {
      log(`#${upper.number} doesn't carry #${number} at ${lower.head.sha.slice(0, 8)}, but another pull request above does.`);
    } else {
      log(`Nothing above carries #${number} at ${lower.head.sha.slice(0, 8)}: the runs Stack stopped run again in full.`);
      for (const run of latest.values()) {
        if (run.status !== 'completed') continue;
        const stack = stackOf(await jobsOf(gh, run));
        if (run.conclusion !== 'cancelled' && stack?.conclusion !== 'failure') continue;
        await gh.post(`/actions/runs/${run.id}/rerun`);
        log(`Ran ${run.name} on #${number} again in full (${run.html_url}), as nothing above carries it now.`);
      }
    }
  }
  // a stopped run starts again once it has ended, and Stack then says which pull request carries it
  for (const { run, again } of stopped) {
    if (!again) {
      log(`::warning title=Stack::${run.name} on ${run.html_url} has no Stack in its workflow, so it stays stopped until its pull request is pushed again.`);
      continue;
    }
    let ended = false;
    for (let attempt = 0; attempt < tries && !ended; attempt++) {
      ended = (await gh.get(`/actions/runs/${run.id}`))?.status === 'completed';
      if (!ended) await wait(every);
    }
    if (!ended) {
      log(`::warning title=Stack::${run.name} on ${run.html_url} hasn't stopped yet, so it stays stopped without saying why.`);
      continue;
    }
    await gh.post(`/actions/runs/${run.id}/rerun`);
    log(`Ran ${run.name} again (${run.html_url}), for Stack to say which pull request carries it.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const gh = github({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
  if (process.argv[2] === '--stop') {
    await stop({ gh, event, gated: gatedWorkflows() });
  } else {
    const said = await gate({ gh, eventName: process.env.GITHUB_EVENT_NAME, event });
    if (said) {
      appendFileSync(process.env.GITHUB_OUTPUT, `above=${said.above}\nmessage=${said.message}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${said.message}\n`);
      console.log(`::error title=Tested through ${said.above}::${said.message}`);
      process.exitCode = 1;
    }
  }
}
