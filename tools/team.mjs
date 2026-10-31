// npm run dp -- team <game> <start|join|send|add> …: the game's team build, team/<game>, a branch of the lead's fork
// that gathers the team's finished pieces before the Dreamports team reviews them (docs/TEAMS.md). Its preview is the
// game's team preview.
//   start [--fork <owner/name>]: the lead makes it in their fork, from the commit they're on.
//   join <branch> [--team <owner/name>]: a member starts a branch of their own from it, for their piece.
//   send [--title "<what it is>"] [--task <number>] [--as <preview>] [--fork <owner/name>] [--team <owner/name>] [--yes]:
//     a member sends the piece on their branch to the lead, as a pull request from their fork to the team build.
//   add <pull request> [--fork <owner/name>] [--all] [--yes]: the lead takes a piece in. It merges it into the team
//     build and runs prove, and only if nothing that matched the original before differs now, it pushes the team
//     build, which closes the pull request as merged, and updates the team preview with share.
// The tools run on the lead's computer, so add stops before a piece that changes anything outside its game's folder,
// the kits and the README's table, until the lead has read it and passes --all. Members' code only runs in the
// browser prove opens. --team names the fork with the lead's team build when it isn't the lead's own, such as one of
// an organisation's. send and add ask first; --yes answers yes, once the person has said yes.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { REPO } from './lib/paths.mjs';
import { head, remotes } from './lib/preview.mjs';
import { UPSTREAM, api, signedInAs, findFork, pagesOf } from './lib/github.mjs';
import { readClaims, leadOf, teamBuildOf, teamBranch } from './lib/claims.mjs';
import { readProgress, readCodeMap } from './lib/proof-files.mjs';
import { percentText } from '../src/lib/entries.mjs';
import { dreamports, readProof } from './readme.mjs';
// loaded now, before a piece is merged, so add runs the lead's own tools whatever the piece holds
import { run as prove } from './prove.mjs';
import { run as portmap } from './portmap.mjs';
import { run as share } from './share.mjs';

const USAGE = `Usage:
  npm run dp -- team <game> start [--fork <owner/name>]
  npm run dp -- team <game> join <branch> [--team <owner/name>]
  npm run dp -- team <game> send [--title "<what it is>"] [--task <number>] [--as <preview>] [--fork <owner/name>] [--team <owner/name>] [--yes]
  npm run dp -- team <game> add <pull request> [--fork <owner/name>] [--all] [--yes]`;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function run(args) {
  const { rest: [game, step, ...rest], ...opts } = options(args);
  if (!game || !NAME.test(game) || !STEPS[step]) throw new Error(USAGE);
  return STEPS[step](game, rest, opts);
}

const STEPS = { start, join, send, add };

function options(args) {
  const found = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--fork', '--team', '--title', '--task', '--as'].includes(arg)) {
      if (args[i + 1] === undefined) throw new Error(`${arg} needs a value.\n${USAGE}`);
      found[arg.slice(2)] = args[++i];
    } else if (arg === '--yes' || arg === '--all') found[arg.slice(2)] = true;
    else if (arg.startsWith('--')) throw new Error(`team has no ${arg}.\n${USAGE}`);
    else found.rest.push(arg);
  }
  return found;
}

function git(args, { quiet = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
  } catch (error) {
    if (quiet) return null;
    throw new Error(`git ${args.join(' ')}: ${(error.stderr || error.message).trim()}`);
  }
}

async function ask(question, yes) {
  if (yes) {
    console.log(`${question} Yes (--yes).`);
    return true;
  }
  if (!process.stdin.isTTY) throw new Error('team asks before it sends or adds anything: run it in a terminal, or add --yes once you have said yes.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

// the game, its lead and its name, from the claims and from games/ in this folder
function gameOf(game) {
  const local = dreamports().find(d => d.game === game);
  const claims = readClaims();
  if (!local && !claims.leads.has(game)) throw new Error(`Nobody makes a Dreamport of ${game}: npm run dp -- find lists the games, and the New Dreamport form claims a new one.`);
  const title = local?.entry.title ?? `${claims.nameOf(game) ?? game} Dreamport`;
  return { title, lead: leadOf(game, claims, local?.entry) };
}

function needsClean() {
  const changed = git(['status', '--porcelain', '--untracked-files=no']);
  if (changed) throw new Error(`Commit or put aside your changes first, as team switches branches and merges:\n${changed.split('\n').slice(0, 6).map(l => `  ${l}`).join('\n')}`);
}

function needsLead(game, login) {
  const { title, lead } = gameOf(game);
  if (!lead) throw new Error(`Nobody leads ${title} now: /claim on its New Dreamport issue makes you its lead.`);
  if (lead.toLowerCase() !== login.toLowerCase()) throw new Error(`@${lead} leads ${title}, so the team build is theirs: npm run dp -- team ${game} join <branch> starts your piece from it.`);
  return title;
}

// the lead makes the team build in their fork, from the commit they're on
async function start(game, rest, { fork: wanted }) {
  if (rest.length) throw new Error(USAGE);
  const login = signedInAs();
  const title = needsLead(game, login);
  const fork = findFork(remotes(), wanted);
  const branch = teamBranch(game);
  if (git(['ls-remote', '--heads', fork.remote, branch])) throw new Error(`${fork.repository} already has ${branch}: npm run dp -- team ${game} add <pull request> takes pieces into it.`);
  const { commit } = head();
  git(['push', '--quiet', fork.remote, `${commit}:refs/heads/${branch}`]);
  if (!git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { quiet: true })) git(['branch', branch, commit]);
  git(['fetch', '--quiet', '--no-tags', fork.remote, `refs/heads/${branch}:refs/remotes/${fork.remote}/${branch}`]);
  git(['branch', `--set-upstream-to=${fork.remote}/${branch}`, branch]);
  console.log(`${title}'s team build is ${branch} in ${fork.repository}, from commit ${commit.slice(0, 7)}: https://github.com/${fork.repository}/tree/${branch}`);
  console.log(`\nMembers start their pieces from it with npm run dp -- team ${game} join <branch>, and send them to you with npm run dp -- team ${game} send.`);
  console.log(`Each comes as a pull request to ${branch}, which npm run dp -- team ${game} add <number> proves and takes in.`);
  console.log(`Its preview is the team preview: npm run dp -- share ${game}, run on ${branch}, puts it online, and the entry's preview field links it.`);
  return 0;
}

// a member's branch, from the lead's team build
async function join(game, rest, { team }) {
  const [branch] = rest;
  if (!branch || rest.length > 1 || git(['check-ref-format', '--branch', branch], { quiet: true }) === null) throw new Error(`team ${game} join needs a name for your branch, such as ${game}-knuckles.\n${USAGE}`);
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { quiet: true })) throw new Error(`You already have a branch called ${branch}: pick another name.`);
  needsClean();
  const { title, lead } = gameOf(game);
  if (!lead) throw new Error(`Nobody leads ${title} now, so it has no team build to start from.`);
  const build = teamBuildOf(lead, game, team);
  if (!build) throw new Error(`@${lead} hasn't made ${title}'s team build yet. Until then, a piece can start from main.`);
  git(['fetch', '--quiet', '--no-tags', `https://github.com/${build.repository}.git`, `refs/heads/${build.branch}`]);
  const commit = git(['rev-parse', 'FETCH_HEAD']);
  git(['switch', '--quiet', '-c', branch, commit]);
  console.log(`You're on ${branch}, made from @${lead}'s team build of ${title} as it is now, commit ${commit.slice(0, 7)}: ${build.url}`);
  console.log(`\nWhen your piece is done and npm run dp -- prove ${game} shows it, npm run dp -- team ${game} send sends it to @${lead}.`);
  return 0;
}

// a member's piece goes to the lead, as a pull request from their fork to the team build
async function send(game, rest, { fork: wanted, team, title: named, task, as, yes = false }) {
  if (rest.length) throw new Error(USAGE);
  if (task !== undefined && !/^[1-9]\d*$/.test(task)) throw new Error('--task is the number of the task\'s issue, such as 90.');
  const login = signedInAs();
  const fork = findFork(remotes(), wanted);
  const { commit, branch } = head();
  if (branch === 'HEAD' || branch === 'main' || branch === teamBranch(game)) throw new Error(`You're on ${branch}: send sends the branch with your piece, which npm run dp -- team ${game} join makes.`);
  const { title, lead } = gameOf(game);
  if (!lead) throw new Error(`Nobody leads ${title} now, so there's no team build to send to.`);
  const build = teamBuildOf(lead, game, team);
  if (!build) throw new Error(`@${lead} hasn't made ${title}'s team build yet.`);
  const left = git(['status', '--porcelain', '--untracked-files=no']);
  if (left) console.log(`Changes that aren't committed stay here and aren't sent:\n${left.split('\n').slice(0, 6).map(l => `  ${l}`).join('\n')}\n`);
  git(['fetch', '--quiet', '--no-tags', `https://github.com/${build.repository}.git`, `refs/heads/${build.branch}`]);
  if (git(['merge-base', '--is-ancestor', 'FETCH_HEAD', commit], { quiet: true }) === null) {
    console.log(`The team build has moved on since your branch started. That's fine: @${lead} merges your piece with it when it's added.\n`);
  }

  const what = named ?? git(['log', '-1', '--format=%s', commit]);
  const proof = readProof(game);
  const site = as ? pagesOf(fork.repository)?.url : null;
  if (as && !site) throw new Error(`--as names your preview, and ${fork.repository} has none yet: npm run dp -- share ${game} --as ${as} makes it.`);
  const body = [
    `A piece of ${title} for @${lead}'s team build, from @${login}'s fork.`,
    '',
    ...(task ? [`**Task:** ${UPSTREAM}#${task}`] : []),
    `**Code ported:** ${proof?.ported ? percentText(proof.ported.percent) : 'not measured'}`,
    `**Gameplay proven:** ${proof?.gameplay ? `${percentText(proof.gameplay.percent)}, ${proof.gameplay.proven} of ${proof.gameplay.total} parts` : 'not measured'}`,
    ...(site ? [`**Preview:** ${site}${as}/ (not reviewed by the Dreamports team)`] : []),
    '',
    `The numbers are this branch's, as its proof files give them. The lead takes it in with \`npm run dp -- team ${game} add <this pull request's number>\`, which proves it again first.`,
  ].join('\n');
  console.log(`To @${lead}'s team build of ${title}, ${build.url}, as a pull request in ${build.repository}:\n`);
  console.log(`  ${what}\n${body.replace(/^/gm, '  | ')}\n`);
  if (!(await ask(`Push ${branch} to ${fork.repository} and send it?`, yes))) {
    console.log('Nothing was sent.');
    return 0;
  }
  git(['push', '--quiet', '--set-upstream', fork.remote, branch]);
  const headRef = `${fork.owner}:${branch}`;
  let pull;
  try {
    pull = api(`repos/${build.repository}/pulls`, { method: 'POST', body: { title: what, head: headRef, base: build.branch, body, maintainer_can_modify: true } });
  } catch (error) {
    if (!/already exists/i.test(error.message)) throw error;
    pull = api(`repos/${build.repository}/pulls?state=open&head=${encodeURIComponent(headRef)}`)?.[0];
    if (!pull) throw error;
    console.log(`${branch} was already sent, and the pull request now has its new commits too.`);
  }
  console.log(`Sent: ${pull.html_url}\n@${lead} takes it in with npm run dp -- team ${game} add ${pull.number}.`);
  return 0;
}

// the lead takes a piece into the team build, if prove finds nothing worse
async function add(game, rest, { fork: wanted, all = false, yes = false }) {
  const [number] = rest;
  if (!/^[1-9]\d*$/.test(number ?? '') || rest.length > 1) throw new Error(`team ${game} add needs the number of the piece's pull request.\n${USAGE}`);
  const login = signedInAs();
  const title = needsLead(game, login);
  const fork = findFork(remotes(), wanted);
  const branch = teamBranch(game), tracking = `${fork.remote}/${branch}`;
  needsClean();

  // the team build as it is on the fork, here
  if (!git(['ls-remote', '--heads', fork.remote, branch])) throw new Error(`${fork.repository} has no ${branch} yet: npm run dp -- team ${game} start makes it.`);
  git(['fetch', '--quiet', '--no-tags', fork.remote, `refs/heads/${branch}:refs/remotes/${tracking}`]);
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { quiet: true })) {
    git(['switch', '--quiet', branch]);
    if (git(['merge', '--ff-only', '--quiet', tracking], { quiet: true }) === null) {
      throw new Error(`Your ${branch} and the one on ${fork.repository} have both moved on: bring them together first, with git pull ${fork.remote} ${branch}.`);
    }
  } else git(['switch', '--quiet', '-c', branch, '--track', tracking]);

  // the piece
  const pull = api(`repos/${fork.repository}/pulls/${number}`);
  if (!pull) throw new Error(`${fork.repository} has no pull request ${number}.`);
  if (pull.state !== 'open') throw new Error(`${pull.html_url} is ${pull.merged_at ? 'already merged' : 'closed'}.`);
  if (pull.base.ref !== branch) throw new Error(`${pull.html_url} is for ${pull.base.ref}, not the team build, ${branch}.`);
  git(['fetch', '--quiet', '--no-tags', fork.remote, `refs/pull/${number}/head`]);
  const piece = git(['rev-parse', 'FETCH_HEAD']);
  const changed = git(['diff', '--name-only', `HEAD...${piece}`]).split('\n').filter(Boolean);
  if (!changed.length) throw new Error(`${pull.html_url} changes nothing the team build doesn't have already.`);
  const outside = changed.filter(p => !p.startsWith(`games/${game}/`) && !p.startsWith('kit/') && p !== 'README.md');
  if (outside.length && !all) {
    throw new Error(`${pull.html_url} also changes files outside games/${game}/ and the kits:\n${outside.slice(0, 12).map(p => `  ${p}`).join('\n')}${outside.length > 12 ? `\n  and ${outside.length - 12} more` : ''}\n`
      + 'add runs the tools on your computer, so read those changes first. If they belong in the piece, run it again with --all.');
  }
  console.log(`#${number}, "${pull.title}", from @${pull.user.login} (${pull.head.repo?.full_name ?? 'a deleted fork'}, ${pull.head.ref}): ${changed.length} files changed, commit ${piece.slice(0, 7)}.`);
  if (!(await ask(`\nMerge it into ${title}'s team build, prove it, and if nothing that matched the original before differs now, push the team build to ${fork.repository} and update the team preview?`, yes))) {
    console.log('Nothing was added.');
    return 0;
  }

  const before = { proof: readProof(game), progress: readProgress(game) };
  const generated = new Set([`games/${game}/proof/progress.json`, `games/${game}/proof/port-map.json`, 'README.md']);
  if (git(['merge', '--no-ff', '--no-commit', piece], { quiet: true }) === null) {
    const clashes = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    const real = clashes.filter(f => !generated.has(f));
    if (real.length || !clashes.length) {
      git(['merge', '--abort'], { quiet: true });
      throw new Error(`#${number} clashes with the team build in:\n${real.map(f => `  ${f}`).join('\n')}\nMerge it by hand (git merge ${piece.slice(0, 7)}), or ask @${pull.user.login} in ${pull.html_url} to bring the branch up to date.`);
    }
    // the proof files and the README's table are written again below, so the team build's stand for now
    for (const file of clashes) git(['checkout', '--ours', '--', file]);
    git(['add', '--', ...clashes]);
  }
  let after, worse;
  try {
    if (readCodeMap(game)) await portmap([game]);
    console.log('');
    await prove([game]);
    after = { proof: readProof(game), progress: readProgress(game) };
    worse = worseThan(before, after);
  } catch (error) {
    git(['merge', '--abort'], { quiet: true });
    throw new Error(`${error.message}\nNothing was added: the team build is as it was.`);
  }
  if (worse.length) {
    git(['merge', '--abort']);
    console.log(`\nNothing was added: with #${number}, ${worse.join('; ')}. The team build is as it was. The pull request is where to say so: ${pull.html_url}`);
    return 1;
  }

  git(['add', '--update']);
  for (const file of generated) if (existsSync(resolve(REPO, file))) git(['add', '--', file]);
  git(['commit', '--quiet', '--no-edit', '-m', `Add #${number} from @${pull.user.login}: ${pull.title}`]);
  git(['push', '--quiet', fork.remote, branch]);
  const merged = await mergedSoon(fork.repository, number);
  console.log(`\nAdded to ${branch} on ${fork.repository}: ${merged ? `${pull.html_url} shows as merged` : `${pull.html_url} should show as merged in a moment`}.`);
  const ported = p => (p?.ported ? percentText(p.ported.percent) : 'not measured');
  const parts = p => (p?.gameplay ? `${p.gameplay.proven} of ${p.gameplay.total} parts` : 'not measured');
  console.log(`Code ported: ${ported(before.proof)} before, ${ported(after.proof)} now. Gameplay proven: ${parts(before.proof)} before, ${parts(after.proof)} now.\n`);

  // the team preview is the team build's
  await share([game, '--fork', fork.repository, '--yes']);
  return 0;
}

// what's worse with the piece than in the team build: frames that matched and differ now, parts no longer proven, code
// no longer ported, recordings no longer proven
function worseThan(before, after) {
  const frames = stretches => {
    const found = new Set();
    for (const [a, b] of stretches ?? []) for (let f = a; f <= b; f++) found.add(f);
    return found;
  };
  const worse = [];
  for (const [name, was] of Object.entries(before.progress.recordings ?? {})) {
    const now = after.progress.recordings?.[name];
    if (!now) worse.push(`the recording ${name} isn't proven any more`);
    else if (now.frames === was.frames) {
      const differed = frames(was.differs);
      const newly = [...frames(now.differs)].filter(f => !differed.has(f));
      if (newly.length) worse.push(`${newly.length} frames of ${name} that matched the original differ now, the first at frame ${Math.min(...newly)}`);
    } else if (now.matched < was.matched) worse.push(`${now.matched} frames of ${name} match the original, against ${was.matched} before`);
  }
  const parts = p => p?.gameplay?.proven ?? 0, ported = p => p?.ported?.percent ?? 0;
  if (parts(after.proof) < parts(before.proof)) worse.push(`${parts(after.proof)} parts are proven, against ${parts(before.proof)} before`);
  if (ported(after.proof) < ported(before.proof)) worse.push(`code ported is ${percentText(ported(after.proof))}, against ${percentText(ported(before.proof))} before`);
  return worse;
}

// GitHub marks a pull request merged once the branch it's for holds its commits, a few seconds after the push
async function mergedSoon(repository, number) {
  for (let i = 0; i < 10; i++) {
    if (api(`repos/${repository}/pulls/${number}`)?.merged_at) return true;
    await new Promise(done => setTimeout(done, 3000));
  }
  return false;
}
