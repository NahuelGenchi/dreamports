// What the Dreamports bot says on a new game's first files and on its card (docs/TEAMS.md): only these words, with the
// checked name of the game and the addresses of its files, and nothing else from the pull request.

// the line that marks the bot's comment, with what it checked
export const markOf = sha => `<!-- first-entry ${sha} -->`;
export const MARK = /^<!-- first-entry ([0-9a-f]{40})? ?-->/;

/** Why a new game's first files, or its card, take a normal review. */
export const REASONS = {
  files: 'it holds other files than those, or lacks some of them',
  template: 'its page, its code or its license aren\'t what `npm run dp -- new` writes',
  entry: 'its entry isn\'t what `npm run dp -- new` and `npm run dp -- capture` write',
  proof: 'its `original.json` or code map aren\'t as the proof tools write them',
  capture: 'its capture isn\'t as `npm run dp -- capture` writes it',
  readme: 'its port map, progress map or row in the table in `docs/STATUS.md` aren\'t what the proof tools write',
  claim: 'its author isn\'t the lead of the New Dreamport issue that claims this game',
  game: 'this game is already on `main`',
  card: 'this game isn\'t on `main` yet, or has its card already',
  words: 'the game\'s name or the code map\'s source breaks the rules on what can be written here',
  closes: 'it would close an issue on merging, when a game\'s issue stays open: use `Refs #<number>` instead of `Closes`',
};

/** What a pull request can be for the bot: a new game's first files, or a game's card. */
export const KINDS = {
  files: { looks: 'a new game\'s first files', again: ' Asking your coding agent to write its first files again, on the latest `main`, makes a pull request that needs no review.' },
  card: { looks: 'a game\'s card', again: ' Asking your coding agent for the game\'s capture again, on the latest `main`, makes one that only needs a look at its picture.' },
};

const file = ({ head, sha }, path) => `https://raw.githubusercontent.com/${head}/${sha}/${path}`;

/** The comment on first files that passed: nothing to ask, as they hold no picture, and what happens next. */
export const comingFor = plan => `${markOf(plan.sha)}
These are only a new game's first files: the start every new game has, unchanged, with the map of the original's code. The Dreamports bot wrote every file again and compared them, so nothing here needs a review.

It merges them by itself once this pull request's checks have passed. Then ${plan.name}'s issue shows its progress map.

Its card comes in a pull request of its own, with a real capture of the game that someone who runs this repository looks at.`;

/** The comment that asks for the one thing only a person can check, on a game's card. */
export function askFor(plan) {
  const media = `public/media/${plan.game}-dreamport`;
  return `${markOf(plan.sha)}
This is only a game's card: a capture of ${plan.name} for the launcher, and its entry naming it. The Dreamports bot checked that nothing else comes with it, so none of it needs a review of its code.

The capture is what only a person can check, as nobody's copy of the game is here to compare it with.

![A still of the capture](${file(plan, `${media}-still.webp`)})

[Its clip, which downloads](${file(plan, `${media}.h264.mp4`)}) and [its share picture](${file(plan, `${media}-share.png`)}).

- [ ] This is real play of ${plan.name}, short and silent, with no logos. Merge it.

Only someone who runs this repository can tick this, and a new push clears it.`;
}

/** The comment when it can't come in this way. */
export const normalReview = (why, what = 'files') => `${markOf('')}
This looks like ${KINDS[what].looks}, but it takes a normal review, as ${REASONS[why]}. It can still come in that way, and the Dreamports team will look at it.${KINDS[what].again}`;

/** The comment when the tick came too soon, or GitHub wouldn't merge. */
export const notYet = (plan, line, what = 'card') => `${what === 'card' ? askFor(plan) : comingFor(plan)}

${line}`;
export const WAITING = 'The Dreamports bot hasn\'t finished reading this pull request, so nothing was merged. Tick it again in a few minutes.';
export const NOT_MERGED = 'GitHub wouldn\'t merge it, usually since it conflicts with `main`, or its Check or Clips check hasn\'t passed. Nothing was merged. Once that\'s sorted, a new push asks again.';
export const NOT_MERGED_FILES = 'GitHub wouldn\'t merge it, usually since it conflicts with `main`. Nothing was merged. Once that\'s sorted, a new push tries again.';

/** The comment once it's merged. */
export const merged = (name, what = 'card') => `${markOf('')}
${what === 'card'
    ? `Merged after the Dreamports team looked at its capture: ${name} now has its place in the Make row. It joins the Dreamports row with its first reviewed step that has code of the original's.`
    : `Merged, as it's only what every new game starts with: ${name} is in the repository, and its issue shows its progress map. It gets its place in the Make row with its card, and joins the Dreamports row with its first reviewed step that has code of the original's.`}`;
