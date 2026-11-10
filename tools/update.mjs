// npm run dp -- update <game> [--base <branch>]: brings a branch up to date with main, for a pull request about to go
// out or one that conflicts. It merges main, settles conflicts in the files the tools write by itself, runs `ready`
// on what comes out, and commits it, so nothing that isn't proven goes on the branch. A merge is held to what both
// sides had: the check and the build pass, and no frame that matched in either side's last commit differs now, so a
// version that doesn't match every recording yet, such as one in C behind its JavaScript, can be brought up to date too. Conflicts in anything else stop
// it, with the merge left open: settle those, `git add` them and run it again. Pushing stays with whoever runs it.
// A branch built on a pull request in review (docs/TEAMS.md, Building on a piece in review) first gets that pull
// request's newest commits the same way, while it's open and once more after it has merged: a branch left behind what
// it stands on conflicts with main in every file the two share. Once that pull request is in main, main comes in as a
// commit that says it holds it (holding, in tools/lib/merge-main.mjs), as a squashed merge shares no commits with the
// branch, and git would otherwise find a conflict in every line the branch changed on top of it.
//   Exit 0: up to date, or merged and ready. Exit 2: conflicts it can't settle. Exit 1: anything else.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { head, remotes } from './lib/preview.mjs';
import { REPO } from './lib/paths.mjs';
import { UPSTREAM, api } from './lib/github.mjs';
import { builtOn, finishMerge, holding, isHolding, keepMainsTable, merging, newGames, provedOnBothSides, startMerge } from './lib/merge-main.mjs';

// a new process each, as the merge may have just changed the tools themselves
const tool = (...args) => spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, stdio: 'inherit' }).status === 0;

/** The game and the branch to merge, from the command's words. */
export function optionsOf(args) {
  const at = args.indexOf('--base');
  const words = at < 0 ? args : args.filter((_, index) => index !== at && index !== at + 1);
  return { game: words.find(word => !word.startsWith('--')), base: at < 0 ? 'main' : args[at + 1] };
}

export async function run(args) {
  const { game, base } = optionsOf(args);
  if (!game || !base) throw new Error('Usage: npm run dp -- update <game> [--base <branch>]');

  const names = remotes().map(remote => remote.name);
  const remote = names.includes('upstream') ? 'upstream' : 'origin';
  const fetched = spawnSync('git', ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${base}:refs/remotes/${remote}/${base}`], { cwd: REPO, encoding: 'utf8' });
  if (fetched.status !== 0) throw new Error(`Couldn't fetch ${base} from ${remote}:\n${fetched.stderr}`);
  const main = `${remote}/${base}`;
  const git = args => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });

  // Brings one commit in, as the start of this file says: nothing when the branch has it, or how it stopped.
  const bring = (target, name, message = `Merge ${name}`) => {
    const { upToDate, conflicts } = startMerge(REPO, target);
    if (upToDate) return null;
    if (conflicts.length) {
      console.log(`The merge of ${name} is open, as these need a person or an agent, who reads both sides. Settle them, git add them, and run update again:\n${conflicts.map(file => `  ${file}`).join('\n')}`);
      return 2;
    }
    const games = [...new Set([game, ...provedOnBothSides(REPO)])];
    const added = newGames(REPO);
    for (const each of games) {
      if (!tool('ready', each, '--no-worse')) {
        console.log(`Not committed, and the merge of ${name} is still open: fix what ${each} found, and run update again.`);
        return 1;
      }
    }
    if (added.length && !tool('readme')) return 1;
    keepMainsTable(REPO, added);
    finishMerge(REPO, games, message);
    console.log(`Merged ${name}, and ready.`);
    return 0;
  };

  // what the branch is built on, which comes in before main. Without GitHub to ask, main comes in as it always did
  const has = (commit, other) => git(['merge-base', '--is-ancestor', commit, other]).status === 0;
  let below = [];
  try {
    const { branch } = head();
    // the branch's own pull request, for the lines that say what it builds on
    const own = (api(`repos/${UPSTREAM}/pulls?state=open&per_page=100`) ?? []).find(pull => pull.head.ref === branch && has(pull.head.sha, 'HEAD'));
    below = builtOn(REPO, main, branch, {
      // GitHub has no answer for a commit that was never pushed, which belongs to no pull request
      pullsWith: commit => {
        try {
          return (api(`repos/${UPSTREAM}/commits/${commit}/pulls`) ?? []).map(pull => pull.number);
        } catch (error) {
          if (error.status === 422) return [];
          throw error;
        }
      },
      pullOf: number => {
        const pull = api(`repos/${UPSTREAM}/pulls/${number}`);
        return pull && { branch: pull.head.ref, open: pull.state === 'open', merged: Boolean(pull.merged_at), mergedAs: pull.merged_at ? pull.merge_commit_sha : null };
      },
      fetchHead: number => (git(['fetch', '--quiet', '--no-tags', remote, `pull/${number}/head`]).status === 0 ? git(['rev-parse', 'FETCH_HEAD']).stdout.trim() : null),
      stated: [...String(own?.body ?? '').matchAll(/^\s*builds on #(\d+)\b/gim)].map(found => Number(found[1])),
    });
  } catch (error) {
    console.log(`GitHub couldn't say which pull requests this branch is built on, so only ${main} comes in: ${error.message.split('\n')[0]}`);
  }
  const numbers = pulls => pulls.map(pull => `#${pull.number}`).join(' and ');
  // a pull request under the branch, as bring takes it: its merge is named so that builtOn knows it again
  const under = pull => [pull.head, `#${pull.number}`, `Merge #${pull.number}, which this branch is built on`];
  let merged = false;
  // each in turn, stopping at the first that can't be finished: null when all of them are in
  const all = targets => {
    for (const each of targets) {
      const stopped = bring(...each);
      if (stopped) return stopped;
      merged ||= stopped === 0;
    }
    return null;
  };
  // a merge left open by the run before goes on first, whichever it was
  const open = merging(REPO) ? git(['rev-parse', 'MERGE_HEAD']).stdout.trim() : null;
  const openPull = below.find(pull => pull.head === open);
  const opened = !open ? [] : openPull ? [under(openPull)] : [[open, has(open, main) || isHolding(REPO, open, main) ? main : 'what was being merged']];
  // main last, saying which of those it holds, as by then the branch has all of each
  const held = below.filter(pull => pull.inMain);
  const mainNow = () => (has(main, 'HEAD') ? main : holding(REPO, main, held.map(pull => pull.head), `${base}, which holds ${numbers(held)}`));
  const behind = below.filter(pull => !pull.has);
  if (behind.length) console.log(`This branch is built on ${numbers(below)}, so the newest commits of ${numbers(behind)} come in first, and then ${main}.`);
  const stopped = all([...opened, ...behind.map(under)]) ?? all([[mainNow(), main]]);
  if (stopped) return stopped;
  console.log(merged ? 'Push the branch.' : `Already up to date with ${main}${below.length ? `, and with ${numbers(below)}, which it's built on` : ''}.`);
  return 0;
}
