// npm run dp -- claim <issue's number> [--for <comment's id>|issue] [--repo <owner/name>]: claims a task with a
// `/claim` comment on its issue, as whoever is signed in to the GitHub CLI, waits for the claims bot's answer to that
// comment, and says whether the task is theirs or someone was faster (#1869). The bot is a workflow, which answers when
// GitHub starts it, in half a minute or in five, so the tool waits for the answer marked with the comment's id
// (lib/claim-answer.mjs) and not for a length of time. One run waits a minute and a half, under what coding agents
// give a command, and then prints the command that waits on without claiming again: --for with the comment's id. A
// claim waits ten minutes in all. --for issue waits for the answer to the issue itself, which is how a New Dreamport
// issue claims its game. --repo claims in another copy of the repository, such as a fork that tries the workflow.

import { UPSTREAM, api } from './lib/github.mjs';
import { LIMIT, claim } from './lib/claim-answer.mjs';

const USAGE = 'Usage: npm run dp -- claim <issue\'s number> [--for <comment\'s id>|issue] [--repo <owner/name>]';

export async function run(args) {
  let number = null, about = null, repository = UPSTREAM;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--for' || arg === '--repo') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === '--repo') repository = value;
      else about = value;
    } else if (/^#?\d+$/.test(arg) && number === null) number = Number(arg.replace('#', ''));
    else throw new Error(USAGE);
  }
  if (number === null || (about !== null && !/^(issue|\d+)$/.test(about))) throw new Error(USAGE);

  const started = Date.now();
  const found = await claim({ repository, number, about }, { api, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) });
  const again = `npm run dp -- claim ${number} --for ${found.about}${repository === UPSTREAM ? '' : ` --repo ${repository}`}`;
  // the bot's own first lines, which say what the task waits on or who has it, without its list of what else is free
  const said = found.text?.split(/\n\s*\n/)[0].replace(/\s+/g, ' ');
  if (found.state === 'theirs') {
    console.log(`#${number} is yours: the claims bot answered ${about === 'issue' ? 'the issue' : 'the claim'}.`);
    console.log(`  It said: ${said}`);
    return 0;
  }
  if (found.state === 'taken') {
    console.log(`#${number} isn't yours${found.holders.length ? `: it's @${found.holders.join(', @')}'s` : ''}.`);
    console.log(`  The claims bot said: ${said}`);
    return 0;
  }
  if (found.state === 'waiting') {
    console.log(`The claims bot hasn't answered yet, ${Math.round((Date.now() - started) / 1000)} seconds on. It can take minutes, so nothing is settled: #${number} isn't yours until it says so.`);
    console.log(`  Run this now, which waits on without claiming again: ${again}`);
    return 0;
  }
  console.log(`The claims bot hasn't answered in ${LIMIT / 60_000} minutes, so the claim on #${number} isn't settled, and it isn't yours.`);
  console.log(`  Its runs are at https://github.com/${repository}/actions/workflows/claims.yml. This reads its answer if it comes later: ${again}`);
  return 1;
}
