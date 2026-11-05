// npm run dp -- update <game> [--base <branch>]: brings a branch up to date with main, for a pull request about to go
// out or one that conflicts. It merges main, settles conflicts in the files the tools write by itself, runs `ready`
// on what comes out, and commits it, so nothing that isn't proven goes on the branch. Conflicts in anything else stop
// it, with the merge left open: settle those, `git add` them and run it again. Pushing stays with whoever runs it.
//   Exit 0: up to date, or merged and ready. Exit 2: conflicts it can't settle. Exit 1: anything else.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { remotes } from './lib/preview.mjs';
import { REPO } from './lib/paths.mjs';
import { finishMerge, keepMainsTable, newGames, provedOnBothSides, startMerge } from './lib/merge-main.mjs';

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

  const { upToDate, conflicts } = startMerge(REPO, main);
  if (upToDate) {
    console.log(`Already up to date with ${main}.`);
    return 0;
  }
  if (conflicts.length) {
    console.log(`The merge of ${main} is open, as these need a person or an agent, who reads both sides. Settle them, git add them, and run update again:\n${conflicts.map(file => `  ${file}`).join('\n')}`);
    return 2;
  }

  const games = [...new Set([game, ...provedOnBothSides(REPO)])];
  const added = newGames(REPO);
  for (const each of games) {
    if (!tool('ready', each)) {
      console.log(`Not committed, and the merge of ${main} is still open: fix what ${each} found, and run update again.`);
      return 1;
    }
  }
  if (added.length && !tool('readme')) return 1;
  keepMainsTable(REPO, added);
  finishMerge(REPO, games, `Merge ${main}`);
  console.log(`Merged ${main}, and ready. Push the branch.`);
  return 0;
}
