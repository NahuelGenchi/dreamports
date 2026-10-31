// The Dreamports bot's verdicts (docs/MODERATION.md): the fixed list of keys a post can get, the model's answer read
// as one of them, the schema the acting job checks the judging job's verdicts against, and the fixed plan, reply and
// log entry for each key. Nothing here ever quotes a post.

// what a post can get, from the plain rules or the model
export const KEYS = ['allow', 'game-files', 'rom-site', 'asks-for-games', 'clip-of-original', 'personal-data', 'credential', 'abuse', 'spam', 'rights-notice'];
// and what the judging job says when there's no verdict: skip a post it leaves alone, or wait for a model
const OUTCOMES = [...KEYS, 'skip', 'wait'];
export const KINDS = ['issue', 'pull-request', 'issue-comment', 'review-comment', 'review', 'discussion', 'discussion-comment'];
const BY = ['rules', 'model', 'none'];
const RULES = ['credential', 'game-file', 'rom-site', 'spam', 'email', 'phone'];
const NODE = /^[A-Za-z0-9_=+/-]{4,120}$/;
const MODEL = /^[a-z0-9][\w.-]{0,80}(?:\/[\w.-]{1,80}){1,2}$/;

// the repository's owner, members and collaborators, whose posts are only flagged, unless the repository variable
// MODERATION_TREAT_AS_PUBLIC lists them, for tests
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const accounts = setting => new Set(String(setting ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean));
export const isTrusted = (item, treatAsPublic) => TRUSTED.has(item.association) && !treatAsPublic.has(item.author.toLowerCase());
// a comment for the claims workflow (docs/TEAMS.md), which the bot leaves to it
export const isClaimsCommand = item => !['issue', 'pull-request', 'discussion'].includes(item.kind) && /^\s*\/(?:claim|release)\b/i.test(item.text ?? '');

// The model's answer: one key alone on its last line, which may be wrapped in quotes, backticks or bold, or follow
// "Answer:". Anything else isn't an answer.
export function parseAnswer(text) {
  const last = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean).at(-1) ?? '';
  const key = last.replace(/^[\s`'"*_]+|[\s`'"*_.!]+$/g, '').replace(/^(?:answer|key|verdict)\s*[:=-]\s*[`'"*_]*/i, '').toLowerCase();
  return KEYS.includes(key) ? key : null;
}

// The judging job's verdicts, as the acting job takes them: only the fields and values this schema allows, and null
// when they aren't verdicts at all. A verdict that doesn't fit is dropped, so it does nothing.
export function checkVerdicts(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || !['event', 'sweep'].includes(data.mode) || !Array.isArray(data.results)) return null;
  const node = value => typeof value === 'string' && NODE.test(value);
  const results = [];
  for (const r of data.results.slice(0, 500)) {
    if (!r || !KINDS.includes(r.kind) || !node(r.node) || !OUTCOMES.includes(r.key) || !BY.includes(r.by)) continue;
    if (r.model != null && !(typeof r.model === 'string' && MODEL.test(r.model))) continue;
    results.push({ kind: r.kind, node: r.node, key: r.key, by: r.by, model: r.model ?? null, rule: RULES.includes(r.rule) ? r.rule : null });
  }
  const gone = (Array.isArray(data.gone) ? data.gone : []).filter(node).slice(0, 500);
  const tried = (Array.isArray(data.model?.tried) ? data.model.tried : []).filter(t => typeof t === 'string' && MODEL.test(t)).slice(0, 20);
  return { mode: data.mode, results, gone, model: { answered: data.model?.answered === true, failed: data.model?.failed === true, tried } };
}

// how the bot treats each kind of post: a comment can be hidden, an issue or thread closed and locked, and a pull
// request only answered, since the Dreamports team reviews it before anything is merged
const shapeOf = item => ({ issue: 'post', discussion: 'post', 'pull-request': 'pull' })[item.kind] ?? 'comment';

// The fixed plan for a verdict: the steps that carry it out, from hide, reply, close, lock and label. Clips of the
// original belong in pull requests and progress posts, so a post there never gets that verdict's plan.
export function planFor(key, item) {
  if (!KEYS.includes(key) || key === 'allow') return [];
  if (key === 'clip-of-original' && ['pull-request', 'progress-thread'].includes(item.where)) return [];
  const shape = shapeOf(item);
  if (key === 'spam') return shape === 'comment' ? [{ do: 'hide', as: 'SPAM' }] : [{ do: 'label', name: 'spam' }, { do: 'close' }, { do: 'lock', as: 'SPAM' }];
  if (key === 'abuse') return shape === 'comment' ? [{ do: 'hide', as: 'ABUSE' }] : [{ do: 'close' }, { do: 'lock', as: 'TOO_HEATED' }];
  if (key === 'rights-notice') return [{ do: 'label', name: 'rights-notice' }, { do: 'reply' }];
  if (key === 'asks-for-games') return shape === 'post' ? [{ do: 'reply' }, { do: 'close' }] : [{ do: 'reply' }];
  if (shape === 'comment') return [{ do: 'hide', as: 'OFF_TOPIC' }, { do: 'reply' }];
  if (shape === 'post' && ['game-files', 'rom-site', 'clip-of-original'].includes(key)) return [{ do: 'reply' }, { do: 'close' }, { do: 'lock', as: 'OFF_TOPIC' }];
  return [{ do: 'reply' }];
}

// the hidden note each reply ends with, which says which post it answers, so none is answered twice
export const MARK = /<!-- dreamports-moderation: about=(\S+) key=(\S+) -->/;
export const markFor = (node, key) => `<!-- dreamports-moderation: about=${node} key=${key} -->`;

const nouns = { issue: 'this issue', 'pull-request': 'this pull request', discussion: 'this thread', review: 'your review' };

// The fixed reply for a verdict, which never quotes the post. docs gives the addresses of the pages it links.
export function replyFor(key, item, docs) {
  const shape = shapeOf(item);
  const who = `@${item.author}`;
  const yours = `[${nouns[item.kind] ?? 'your comment'}](${item.url})`;
  const own = 'everyone plays with their own copy, made from their own cartridge or disc';
  const again = shape === 'post' ? ' You\'re welcome to open a new one without it.' : '';
  const hidOrClosed = shape === 'post' ? 'I closed this' : `I hid ${yours}`;
  const text = {
    'game-files': shape === 'pull'
      ? `${who}, this pull request's description shares or links a game file. Dreamports never shares games or anything taken from them, so please edit it out: a pull request with game files is never merged.`
      : `${who}, ${hidOrClosed} because it shares or links a game file. Dreamports never shares games or anything taken from them, not even to test: ${own}.${again}`,
    'rom-site': shape === 'pull'
      ? `${who}, this pull request's description links a site that shares game files. Dreamports never links to them, so please edit the link out.`
      : `${who}, ${hidOrClosed} because it links a site that shares game files. Dreamports never links to them: ${own}.${again}`,
    'asks-for-games': `${who}, Dreamports can't help anyone get a game. Every Dreamport plays with the player's own copy, made from their own cartridge or disc, and nobody here shares one or says where to find one.${shape === 'post' ? ' So I closed this.' : ''}`,
    'clip-of-original': `${who}, ${hidOrClosed} because it seems to show the original game. Clips and pictures of the original may only appear in pull requests and progress posts, where they show a Dreamport matching it, as [Clips](${docs.clips}) says. Clips of a Dreamport itself are welcome anywhere.${again}`,
    'personal-data': shape === 'comment'
      ? `${who}, I hid ${yours} because it seems to include private details, such as an email address or a phone number. Everything here is public, so please post it again without them.`
      : `${who}, this seems to include private details, such as an email address or a phone number. Everything here is public, so please edit them out.`,
    credential: shape === 'comment'
      ? `${who}, I hid ${yours} because it seems to include a key, token or password. A hidden post can still be opened, so please revoke it now and make a new one: anyone may have copied it already.`
      : `${who}, this seems to include a key, token or password. Please revoke it now and make a new one, then edit it out: anyone may have copied it already, and GitHub keeps every earlier version of a post.`,
    'rights-notice': `Thank you for writing. The Dreamports team handles notices from rights holders quickly, usually within one business day, as [Notices from rights holders](${docs.rights}) explains. You can also write to hello@dreamports.net.`
  }[key];
  if (!text) return null;
  return `${text}\n\n<sub>I'm the Dreamports bot, and I check posts here against the project's rules: [how moderation works](${docs.moderation}).</sub>\n\n${markFor(item.node, key)}`;
}

const kindWords = {
  issue: 'an issue', 'pull-request': 'a pull request', 'issue-comment': 'a comment', 'review-comment': 'a comment on code',
  review: 'a review', discussion: 'a thread', 'discussion-comment': 'a comment'
};
// A post as the log and the alert issue name it: a link, and its author as code, so nobody is notified. The link
// leaves out https://github.com, since GitHub notes a full link to an issue in that issue's own timeline, as
// "mentioned this", which would mark every post the bot checks.
export const postLink = item => `[${kindWords[item.kind] ?? 'a post'}](${String(item.url).replace(/^https:\/\/github\.com(?=\/)/, '')}) by \`${item.author}\``;
const reasons = {
  'game-files': 'it shares or links a game file', 'rom-site': 'it links a site that shares game files',
  'asks-for-games': 'it asks where to get a game', 'clip-of-original': 'it seems to show the original game',
  'personal-data': 'it seems to include private details', credential: 'it seems to include a key, token or password',
  abuse: 'it seems abusive', spam: 'it\'s spam', 'rights-notice': 'it\'s a notice from a rights holder'
};
const verbs = { hid: 'Hid', replied: 'Replied to', closed: 'Closed', locked: 'Locked', labelled: 'Labelled' };

// One entry of the log: what the bot did, or why it only flagged a post, with a link, the reason and who decided. It
// names people as code, so nobody is notified, and never quotes the post.
export function logLine({ item, key, by, model, did = [], flagged = null }) {
  const post = postLink(item);
  const reason = reasons[key] ?? key;
  const decided = by === 'rules' ? 'the plain rules' : model ? `\`${model}\`` : 'the model';
  if (flagged) {
    const why = flagged === 'claims' ? 'it\'s a claims command, which the claims workflow handles' : `\`${item.author}\` is one of the repository's own people`;
    return `Flagged ${post}: ${reason}. I left it alone, since ${why}. Decided by ${decided}.`;
  }
  const actions = did.map((d, i) => (i ? (verbs[d] ?? d).toLowerCase() : verbs[d] ?? d)).join(', ');
  return `${actions} ${post}: ${reason}. Decided by ${decided}.`;
}
