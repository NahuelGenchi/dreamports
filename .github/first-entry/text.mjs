// What the Dreamports bot says on a game's first entry (docs/TEAMS.md): only these words, with the checked name of the
// game and the addresses of its files, and nothing else from the pull request.

// the line that marks the bot's comment, with what it checked
export const markOf = sha => `<!-- first-entry ${sha} -->`;
export const MARK = /^<!-- first-entry ([0-9a-f]{40})? ?-->/;

/** Why a first entry takes a normal review. */
export const REASONS = {
  files: 'it holds other files than a first entry has, or lacks some of them',
  template: 'its page, its code or its license aren\'t what `npm run dp -- new` writes',
  entry: 'its entry isn\'t what `npm run dp -- new` and `npm run dp -- capture` write',
  proof: 'its `original.json` or code map aren\'t as the proof tools write them',
  capture: 'its capture isn\'t as `npm run dp -- capture` writes it',
  readme: 'its port map, progress map or row in the README\'s table aren\'t what the proof tools write',
  claim: 'its author isn\'t the lead of the open New Dreamport issue that claims this game',
  game: 'this game is already on the site',
  words: 'the game\'s name or the code map\'s source breaks the rules on what can be written here',
  closes: 'it would close an issue on merging, when a game\'s issue stays open: use `Refs #<number>` instead of `Closes`',
};

const file = ({ head, sha }, path) => `https://raw.githubusercontent.com/${head}/${sha}/${path}`;

/** The comment that asks for the one thing only a person can check. */
export function askFor(plan) {
  const media = `public/media/${plan.game}-dreamport`;
  return `${markOf(plan.sha)}
This is only a new game's first entry: the start every new game has, unchanged, and a capture for its card. The Dreamports bot wrote every file again and compared them, so none of it needs a review of its code.

The capture is what only a person can check, as nobody's copy of the game is here to compare it with.

![A still of the capture](${file(plan, `${media}-still.webp`)})

[Its clip, which downloads](${file(plan, `${media}.h264.mp4`)}) and [its share picture](${file(plan, `${media}-share.png`)}).

- [ ] This is real play of ${plan.name}, short and silent, with no logos. Merge it.

Only someone who runs this repository can tick this, and a new push clears it.`;
}

/** The comment when it can't come in this way. */
export const normalReview = why => `${markOf('')}
This looks like a new game's first entry, but it takes a normal review, as ${REASONS[why]}. It can still come in that way, and the Dreamports team will look at it. Asking your coding agent to write its first files and its capture again, on the latest \`main\`, makes a first entry that needs no review of its code.`;

/** The comment when the tick came too soon, or GitHub wouldn't merge. */
export const notYet = (plan, line) => `${askFor(plan)}

${line}`;
export const WAITING = 'The Dreamports bot hasn\'t finished reading this pull request, so nothing was merged. Tick it again in a few minutes.';
export const NOT_MERGED = 'GitHub wouldn\'t merge it, usually since it conflicts with `main`. Nothing was merged. Once that\'s sorted, a new push asks again.';
export const merged = name => `${markOf('')}
Merged after the Dreamports team looked at its capture: ${name} now has its place in the Make row. It joins the Dreamports row with its first reviewed step that has code of the original's.`;
