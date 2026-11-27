// A claim and the claims bot's answer to it, as `npm run dp -- claim` waits for it (#1869). The bot is a workflow
// (.github/workflows/claims.yml), so it answers when GitHub starts it, half a minute later or five, and each of its
// answers ends with a marker that names what it answers: a comment's id, or the issue itself. Waiting for that marker,
// and not for a length of time, is what tells an answer to this claim from an older one to someone else's.

/** The account the claims workflow answers as. */
export const BOT = 'github-actions[bot]';
// as the workflow's own MARK has it
const MARK = /<!-- dreamports-claims: answers=(\S+)(?: (granted|released)=(\S+))? -->/;

/** How long a claim waits for its answer in all, how long one run of the tool waits, kept under the two minutes many
 *  coding agents give a command, and how often it asks GitHub. */
export const LIMIT = 10 * 60_000, RUN = 115_000, EVERY = 5_000;

/**
 * The bot's answer to `about`, a comment's id or 'issue', among an issue's `comments`: { text, did, who }, its words
 * without the marker, and 'granted' or 'released' with whom, or null for an answer that did neither. null when it
 * hasn't answered. A comment by anyone else that carries the marker isn't one.
 */
export function answerTo(comments, about) {
  for (const comment of [...comments].reverse()) {
    const found = comment.user?.login === BOT && MARK.exec(comment.body ?? '');
    if (found && found[1] === String(about)) return { text: comment.body.replace(MARK, '').trim(), did: found[2] ?? null, who: found[3] ?? null };
  }
  return null;
}

/**
 * Claims issue `number` of `repository` with a `/claim` comment, and waits for the bot's answer to that comment. With
 * `about`, it claims nothing and waits for the answer to that: a comment's id, of a claim made before, or 'issue', for
 * a New Dreamport issue, which claims its game by being opened.
 *
 * `api(path, { method, body })` is GitHub's REST API (lib/github.mjs), `sleep(ms)` waits, and `now()` is the time.
 * One call waits `run` at most, and a claim `limit` in all, counted from when it was made.
 *
 * Returns { state, about, who, text, holders }: 'theirs' or 'taken' once the bot answered, by whom the issue is
 * assigned to then, with the bot's words; 'waiting' when this call's wait ran out first, to be called again with
 * `about`; and 'unanswered' when the claim's limit did.
 */
export async function claim({ repository, number, about = null }, { api, sleep, now = Date.now, run = RUN, limit = LIMIT, every = EVERY }) {
  const at = `repos/${repository}/issues/${number}`;
  const comments = () => {
    const all = [];
    for (let page = 1; ; page++) {
      const batch = api(`${at}/comments?per_page=100&page=${page}`) ?? [];
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  };
  // what the bot answers: the claim just made, one made before, or the issue
  let asked, started;
  if (about === null) {
    asked = api(`${at}/comments`, { method: 'POST', body: { body: '/claim' } });
    if (!asked) throw new Error(`${repository} has no issue #${number} to claim.`);
    started = now();
  } else {
    asked = about === 'issue' ? api(at) : comments().find(comment => String(comment.id) === String(about));
    if (!asked) throw new Error(about === 'issue' ? `${repository} has no issue #${number}.` : `#${number} of ${repository} has no comment ${about}.`);
    started = Date.parse(asked.created_at);
  }
  const who = asked.user.login, key = about === null ? String(asked.id) : String(about);
  const until = Math.min(now() + run, started + limit);
  for (;;) {
    const answer = answerTo(comments(), key);
    if (answer) {
      const holders = (api(at)?.assignees ?? []).map(person => person.login);
      const theirs = holders.some(holder => holder.toLowerCase() === who.toLowerCase());
      return { state: theirs ? 'theirs' : 'taken', about: key, who, text: answer.text, holders };
    }
    if (now() >= until) break;
    await sleep(Math.min(every, until - now()));
  }
  return { state: now() >= started + limit ? 'unanswered' : 'waiting', about: key, who, text: null, holders: [] };
}
