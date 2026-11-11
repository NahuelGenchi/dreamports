// What a game's first two pull requests may hold to come in with no review of their code (docs/TEAMS.md): its first
// files, only what `npm run dp -- new` writes for a game someone has claimed, and then its card, only what
// `npm run dp -- capture` writes for a game that has none. Everything is written again here and compared byte by byte,
// and what can't be, its proof files and capture, is checked against the strict shapes the tools write, so that no words
// and no code of anyone's can come along. First files hold no picture, so nothing in them needs a person, and they merge
// by themselves; a card waits for someone to look at it. It reads the files as data and runs none of them.
import { CONSOLES } from '../../kit/consoles.js';
import { checkRules } from '../moderation/rules.mjs';
import { firstFiles, firstFilesMessage, namesOf, startingEntry, withCapture } from '../../tools/lib/new-game.mjs';
import { sizesIn } from '../../tools/lib/screens.mjs';

const GAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 '!&.:,+-]{0,60}(?: \([A-Za-z, ]{1,30}\))?$/;   // a copy's name, with its region in brackets
const PERSON = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]{0,59}$/u;   // a person's name on a commit, which has room for no link
const MOST_CLIP = 1_468_006, MOST_STILL = 262_144, MOST_SHARE = 1_048_576, MOST_MAP = 4_194_304;

/** The most each file can be, by where it is, for reading no more than that. */
export const mostFor = path => (path.endsWith('.mp4') ? MOST_CLIP : path.endsWith('.webp') ? MOST_STILL : path.endsWith('.png') ? MOST_SHARE : MOST_MAP);

/** The game whose first files a pull request's seem to be, or null: one new entry and no other. */
export function gameOf(files) {
  const found = files.flatMap(f => (f.status === 'added' ? /^games\/([^/]+)\/entry\.md$/.exec(f.filename)?.[1] ?? [] : []));
  return found.length === 1 && GAME.test(found[0]) ? found[0] : null;
}

/** A capture's four files, for a game's card: its clip twice, its still and its share picture. */
export const mediaOf = game => ['.h264.mp4', '.av1.mp4', '-still.webp', '-share.png'].map(end => `public/media/${game}-dreamport${end}`);

/** The game whose card a pull request's files are, or null: a capture's four new files and the game's entry changed, and nothing else. */
export function cardOf(files) {
  const game = files.length === 5 ? files.map(f => (f.status === 'modified' ? /^games\/([^/]+)\/entry\.md$/.exec(f.filename)?.[1] : null)).find(Boolean) : null;
  return game && GAME.test(game) && mediaOf(game).every(path => files.some(f => f.filename === path && f.status === 'added')) ? game : null;
}

/** The language a new game starts in, from its first files: C when it brings games/<game>/c/index.html, as new
 *  games start in C, or else JavaScript (src/lib/languages.mjs). */
export const languageOf = (game, files) => (files.some(f => f.filename === `games/${game}/c/index.html`) ? 'c' : 'js');

/** Where a new game's version is, in its game's folder: '' for JavaScript, 'c/' for C. */
const versionAt = language => (language === 'js' ? '' : `${language}/`);

/** Every one of a game's first files, but docs/STATUS.md, which they change: in JavaScript, or with `language` 'c', in C. */
export function pathsOf(game, language = 'js') {
  const code = language === 'js' ? ['index.html', 'src/main.js'] : ['c/index.html', 'c/src/main.c', 'c/src/main.js'];
  return [
    ...['LICENSE', ...code, 'entry.md', 'proof/original.json', 'proof/code-map.json', `${versionAt(language)}proof/port-map.json`].map(f => `games/${game}/${f}`),
    `.github/readme/progress/${game}${language === 'js' ? '' : `-${language}`}.svg`,
  ];
}

const letters = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const near = (a, b) => !!letters(a) && !!letters(b) && (letters(a).includes(letters(b)) || letters(b).includes(letters(a)));

// what a copy's header says, as `rom` reads it: on the Game Boy Advance a title of up to 12 letters and a code of 4, and
// its code at 08000000 or 09000000. Another console's games say less or nothing, so their title has more room, and is
// the game's name or part of it, as `rom` takes it from the copy's own name when its header has none
const HEADER = {
  gba: { title: /^[A-Za-z0-9 _.!&'-]{1,12}$/, code: /^[A-Z0-9]{4}$/, address: /^0[89]/, named: () => true },
  other: { title: /^[A-Za-z0-9][A-Za-z0-9 _.!&',:+()-]{0,59}$/, code: /^[A-Z0-9 -]{0,16}$/, address: /^/, named: found => near(namesOf(found).name, found.title) },
};
const headerOf = console => HEADER[console] ?? HEADER.other;

/** proof/original.json as an object, when it's plain and has only what the tools read, or else null. */
export function readOriginal(text) {
  let found;
  try { found = JSON.parse(text); } catch { return null; }
  if (!found || typeof found !== 'object' || Array.isArray(found)) return null;
  if (`${JSON.stringify(found, null, 2)}\n` !== text.replace(/\s*$/, '\n')) return null;
  const allowed = ['console', 'name', 'title', 'code', 'sha1', 'keysAfterVBlank'];
  if (Object.keys(found).some(key => !allowed.includes(key))) return null;
  // any console the kits know (kit/consoles.js), as a game on each starts with the same files (tools/lib/new-game.mjs)
  const good = typeof found.console === 'string' && Object.hasOwn(CONSOLES, found.console)
    && NAME.test(found.name ?? '')
    && headerOf(found.console).title.test(found.title ?? '')
    && headerOf(found.console).code.test(found.code ?? '')
    && headerOf(found.console).named(found)
    && /^[0-9a-f]{40}$/.test(found.sha1 ?? '')
    && [undefined, true, false].includes(found.keysAfterVBlank);
  return good ? found : null;
}

const CODE_MAP = /^\{\s*"original":\s*"([0-9a-f]{40})",\s*"from":\s*"([A-Za-z0-9 _.,:()/'-]{1,200})",\s*"functions":\s*\[\s*(?:\["[0-9A-F]{8}",\s*[1-9][0-9]{0,8}\](?:,\s*)?)+\s*\]\s*\}\s*$/;

/** The code map's source, when the code map has only functions in order, of this copy, where its console's code is, or else null. */
export function readCodeMap(text, sha1, console = 'gba') {
  const found = CODE_MAP.exec(text);
  if (!found || found[1] !== sha1) return null;
  const { functions } = JSON.parse(text);
  const inOrder = functions.every(([address], i) => i === 0 || functions[i - 1][0] < address);
  return inOrder && functions.every(([address]) => headerOf(console).address.test(address)) ? found[2] : null;
}

/** The sizes a game's capture can be: twice a width and a height its screen has, its console's (kit/consoles.js) or those its original.json says. */
export function clipSizes(original) {
  const said = sizesIn(original.screen) ?? [CONSOLES[original.console].screen];
  return said.flatMap(([width]) => said.map(([, height]) => [width * 2, height * 2]));
}

// a game's original.json as main has it, which came in checked or reviewed, so only what's read from it here is looked at
function originalOnMain(text) {
  try {
    const found = JSON.parse(text);
    return typeof found?.console === 'string' && Object.hasOwn(CONSOLES, found.console) && NAME.test(found.name ?? '') && clipSizes(found).length ? found : null;
  } catch {
    return null;
  }
}

function boxesIn(bytes, start, end) {
  const boxes = {};
  let at = start;
  while (at + 8 <= end) {
    const size = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (size < 8 || at + size > end) return null;
    (boxes[type] ??= []).push({ start: at + 8, end: at + size });
    at += size;
  }
  return at === end ? boxes : null;
}
const only = (boxes, ...types) => !!boxes && Object.keys(boxes).sort().join() === [...types].sort().join() && types.every(type => boxes[type].length === 1);

/** Whether a clip is what `capture` makes: one silent picture track of `codec`, of one of `sizes`, 480 by 320 on the Game Boy Advance, of 2 to 7 seconds, and nothing else. */
export function isClip(bytes, codec, sizes = [[480, 320]]) {
  if (bytes.length > MOST_CLIP) return false;
  const top = boxesIn(bytes, 0, bytes.length);
  if (!only(top, 'ftyp', 'moov', 'mdat')) return false;
  const inside = (box, ...types) => { const boxes = boxesIn(bytes, box.start, box.end); return only(boxes, ...types) ? boxes : null; };
  const moov = inside(top.moov[0], 'mvhd', 'trak');
  const trak = moov && inside(moov.trak[0], 'tkhd', 'mdia');
  const mdia = trak && inside(trak.mdia[0], 'mdhd', 'hdlr', 'minf');
  const minf = mdia && inside(mdia.minf[0], 'vmhd', 'dinf', 'stbl');
  if (!minf || bytes.toString('latin1', mdia.hdlr[0].start + 8, mdia.hdlr[0].start + 12) !== 'vide') return false;
  const stbl = boxesIn(bytes, minf.stbl[0].start, minf.stbl[0].end);
  if (!stbl?.stsd || bytes.toString('latin1', stbl.stsd[0].start + 12, stbl.stsd[0].start + 16) !== codec) return false;
  const { start: mvhd } = moov.mvhd[0], tkhd = trak.tkhd[0];
  const seconds = bytes.readUInt32BE(mvhd + 16) / bytes.readUInt32BE(mvhd + 12);
  return bytes[mvhd] === 0 && bytes[tkhd.start] === 0 && seconds >= 2 && seconds <= 7
    && sizes.some(([width, height]) => bytes.readUInt32BE(tkhd.end - 8) === width << 16 && bytes.readUInt32BE(tkhd.end - 4) === height << 16);
}

/** Whether a still is a WebP with only a picture in it. */
export function isStill(bytes) {
  if (bytes.length > MOST_STILL || bytes.length < 20) return false;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  const size = bytes.readUInt32LE(16);
  return ['VP8 ', 'VP8L'].includes(bytes.toString('latin1', 12, 16)) && 20 + size + (size & 1) === bytes.length;
}

/** Whether a share picture is a PNG of 1200 by 630 with only a picture in it. */
export function isShare(bytes) {
  if (bytes.length > MOST_SHARE || bytes.length < 33 || bytes.toString('latin1', 1, 4) !== 'PNG') return false;
  if (bytes.readUInt32BE(16) !== 1200 || bytes.readUInt32BE(20) !== 630) return false;
  let at = 8, ended = false;
  while (at + 12 <= bytes.length && !ended) {
    const size = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (!['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'pHYs', 'cHRM'].includes(type)) return false;
    ended = type === 'IEND';
    at += 12 + size;
  }
  return ended && at === bytes.length;
}

/**
 * Whether first files that passed can keep their commit, which is what leaves the pull request of the game's first task
 * clean once they merge, as that task's branch starts from the same commit. Merging puts it on main for good, so it has
 * to be the one the tools make, in the tools' words and nobody else's, on a commit of main's, since `checkFirstFiles`
 * has seen what it holds. `commits` are as GitHub lists them. Anything else is squashed, which keeps nothing but what
 * was checked.
 */
export function plainHistory({ commits, original, issue }) {
  if (commits.length !== 1 || commits[0].parents.length !== 1) return false;
  const [{ commit }] = commits;
  if (commit.message.replace(/\n+$/, '') !== firstFilesMessage(namesOf(original).name, issue)) return false;
  return [commit.author?.name, commit.committer?.name].every(person => typeof person === 'string' && PERSON.test(person) && !checkRules(person, { spam: false }).rule);
}

/**
 * Checks a pull request's files as a new game's first files. `files` are as GitHub lists them, `modes` each file's mode
 * and `read(path)` its bytes; `claim` is what the game's New Dreamport issue says, { number, lead, game }, or null; and
 * `author` wrote the pull request. Answers { why }, a key of REASONS, or { original, name, added, row }, with the
 * new row in docs/STATUS.md, which only the tools can write again (`read.mjs`).
 */
export function checkFirstFiles({ game, files, modes, read, claim, author, onSite, today = new Date() }) {
  const language = languageOf(game, files);
  const paths = pathsOf(game, language);
  const changed = new Map(files.map(f => [f.filename, f]));
  const readme = changed.get('docs/STATUS.md');
  if (changed.size !== paths.length + 1 || !paths.every(path => changed.get(path)?.status === 'added') || readme?.status !== 'modified') return { why: 'files' };
  if (![...paths, 'docs/STATUS.md'].every(path => modes.get(path) === '100644')) return { why: 'files' };
  if (onSite) return { why: 'game' };
  if (!claim || claim.lead !== author) return { why: 'claim' };

  const text = path => read(path).toString('utf8');
  const original = readOriginal(text(`games/${game}/proof/original.json`));
  const from = original && readCodeMap(text(`games/${game}/proof/code-map.json`), original.sha1, original.console);
  if (!from) return { why: 'proof' };
  const { name } = namesOf(original);
  if (checkRules(`${original.name}\n${from}`, { spam: false }).rule) return { why: 'words' };
  if (!near(claim.game, name)) return { why: 'claim' };

  const entry = text(`games/${game}/entry.md`);
  const added = /^added: (\d{4}-\d{2}-\d{2})$/m.exec(entry)?.[1];
  // its code and license as `new` writes them; the entry is compared just below
  for (const [file, expected] of Object.entries(firstFiles(game, original, { language, issue: claim.number, lead: author, added }))) {
    if (file !== 'entry.md' && text(`games/${game}/${file}`) !== expected) return { why: 'template' };
  }
  const age = added ? (today - new Date(`${added}T00:00:00Z`)) / 86_400_000 : NaN;
  if (!(age >= -1 && age <= 365) || entry !== startingEntry(game, original, { issue: claim.number, lead: author, added })) return { why: 'entry' };

  const row = (readme.patch ?? '').split('\n').filter(line => /^[-+]/.test(line) && !/^(---|\+\+\+) /.test(line));
  if (readme.additions !== 1 || readme.deletions !== 0 || row.length !== 1 || !row[0].startsWith('+')) return { why: 'readme' };
  return { original, name, added, language, row: row[0].slice(1) };
}

/**
 * Checks a pull request's files as a game's card: its capture and its entry naming it, for a game on main that has
 * none. `files`, `modes` and `read` are the pull request's, as for first files; `onMain` is the game's entry and
 * original.json as main has them, or null for each it lacks; `claim` what the game's issue says, { number, lead }, or
 * null; and `author` wrote the pull request. Answers { why }, a key of REASONS, or { original, name }.
 */
export function checkCard({ game, files, modes, read, onMain, claim, author }) {
  const paths = [...mediaOf(game), `games/${game}/entry.md`];
  if (cardOf(files) !== game || !paths.every(path => modes.get(path) === '100644')) return { why: 'files' };
  const original = onMain.original && originalOnMain(onMain.original);
  if (!onMain.entry || !original || /^(screen|share):/m.test(onMain.entry)) return { why: 'card' };
  if (!claim || claim.lead !== author) return { why: 'claim' };
  const [h264, av1, still, share] = mediaOf(game).map(read);
  const sizes = clipSizes(original);
  if (!isClip(h264, 'avc1', sizes) || !isClip(av1, 'av01', sizes) || !isStill(still) || !isShare(share)) return { why: 'capture' };
  if (read(`games/${game}/entry.md`).toString('utf8') !== withCapture(onMain.entry, game)) return { why: 'entry' };
  return { original, name: namesOf(original).name };
}
