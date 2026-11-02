// What a game's first pull request may hold to come in with no review of its code (docs/TEAMS.md): only what
// `npm run dp -- new` and `npm run dp -- capture` write for a game someone has claimed. Everything is written again here
// and compared byte by byte, and what can't be, its proof files and capture, is checked against the strict shapes the
// tools write, so that no words and no code of anyone's can come along. It reads the files as data and runs none of them.
import { checkRules } from '../moderation/rules.mjs';
import { namesOf, startingEntry, startingFiles, withCapture } from '../../tools/lib/new-game.mjs';

const GAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MOST_CLIP = 1_468_006, MOST_STILL = 262_144, MOST_SHARE = 1_048_576, MOST_MAP = 4_194_304;

/** The most each file can be, by where it is, for reading no more than that. */
export const mostFor = path => (path.endsWith('.mp4') ? MOST_CLIP : path.endsWith('.webp') ? MOST_STILL : path.endsWith('.png') ? MOST_SHARE : MOST_MAP);

/** The game whose first entry a pull request's files seem to be, or null: one new entry and no other. */
export function gameOf(files) {
  const found = files.flatMap(f => (f.status === 'added' ? /^games\/([^/]+)\/entry\.md$/.exec(f.filename)?.[1] ?? [] : []));
  return found.length === 1 && GAME.test(found[0]) ? found[0] : null;
}

/** Every file of a game's first entry, but README.md, which it changes. */
export function pathsOf(game) {
  const media = `public/media/${game}-dreamport`;
  return [
    ...['LICENSE', 'index.html', 'src/main.js', 'entry.md', 'proof/original.json', 'proof/code-map.json', 'proof/port-map.json'].map(f => `games/${game}/${f}`),
    `${media}.h264.mp4`, `${media}.av1.mp4`, `${media}-still.webp`, `${media}-share.png`, `.github/readme/progress/${game}.svg`,
  ];
}

/** proof/original.json as an object, when it's plain and has only what the tools read, or else null. */
export function readOriginal(text) {
  let found;
  try { found = JSON.parse(text); } catch { return null; }
  if (!found || typeof found !== 'object' || Array.isArray(found)) return null;
  if (`${JSON.stringify(found, null, 2)}\n` !== text.replace(/\s*$/, '\n')) return null;
  const allowed = ['console', 'name', 'title', 'code', 'sha1', 'keysAfterVBlank'];
  if (Object.keys(found).some(key => !allowed.includes(key))) return null;
  const good = found.console === 'gba'
    && /^[A-Za-z0-9][A-Za-z0-9 '!&.:,+-]{0,60}(?: \([A-Za-z, ]{1,30}\))?$/.test(found.name ?? '')
    && /^[A-Za-z0-9 _.!&'-]{1,12}$/.test(found.title ?? '')
    && /^[A-Z0-9]{4}$/.test(found.code ?? '')
    && /^[0-9a-f]{40}$/.test(found.sha1 ?? '')
    && [undefined, true, false].includes(found.keysAfterVBlank);
  return good ? found : null;
}

const CODE_MAP = /^\{\s*"original":\s*"([0-9a-f]{40})",\s*"from":\s*"([A-Za-z0-9 _.,:()/'-]{1,200})",\s*"functions":\s*\[\s*(?:\["[0-9A-F]{8}",\s*[1-9][0-9]{0,8}\](?:,\s*)?)+\s*\]\s*\}\s*$/;

/** The code map's source, when the code map has only functions in order, of this copy, or else null. */
export function readCodeMap(text, sha1) {
  const found = CODE_MAP.exec(text);
  if (!found || found[1] !== sha1) return null;
  const { functions } = JSON.parse(text);
  const inOrder = functions.every(([address], i) => i === 0 || functions[i - 1][0] < address);
  return inOrder && functions.every(([address]) => address.startsWith('08') || address.startsWith('09')) ? found[2] : null;
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

/** Whether a clip is what `capture` makes: one silent picture track of `codec`, 480 by 320, of 2 to 7 seconds, and nothing else. */
export function isClip(bytes, codec) {
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
    && bytes.readUInt32BE(tkhd.end - 8) === 480 << 16 && bytes.readUInt32BE(tkhd.end - 4) === 320 << 16;
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

const letters = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Checks a pull request's files as a game's first entry. `files` are as GitHub lists them, `modes` each file's mode and
 * `read(path)` its bytes; `claim` is what the game's New Dreamport issue says, { number, lead, game }, or null; and
 * `author` wrote the pull request. Answers { why }, a key of REASONS, or { original, name, added, row }, with the
 * README's new row, which only the tools can write again (`read.mjs`).
 */
export function checkFirstEntry({ game, files, modes, read, claim, author, onSite, today = new Date() }) {
  const paths = pathsOf(game);
  const changed = new Map(files.map(f => [f.filename, f]));
  const readme = changed.get('README.md');
  if (changed.size !== paths.length + 1 || !paths.every(path => changed.get(path)?.status === 'added') || readme?.status !== 'modified') return { why: 'files' };
  if (![...paths, 'README.md'].every(path => modes.get(path) === '100644')) return { why: 'files' };
  if (onSite) return { why: 'game' };
  if (!claim || claim.lead !== author) return { why: 'claim' };

  const text = path => read(path).toString('utf8');
  const original = readOriginal(text(`games/${game}/proof/original.json`));
  const from = original && readCodeMap(text(`games/${game}/proof/code-map.json`), original.sha1);
  if (!from) return { why: 'proof' };
  const { name } = namesOf(original);
  if (checkRules(`${original.name}\n${from}`, { spam: false }).rule) return { why: 'words' };
  if (!letters(claim.game).includes(letters(name)) && !letters(name).includes(letters(claim.game))) return { why: 'claim' };

  const media = `public/media/${game}-dreamport`;
  if (!isClip(read(`${media}.h264.mp4`), 'avc1') || !isClip(read(`${media}.av1.mp4`), 'av01')
    || !isStill(read(`${media}-still.webp`)) || !isShare(read(`${media}-share.png`))) return { why: 'capture' };

  for (const [file, expected] of Object.entries(startingFiles(game, original))) {
    if (text(`games/${game}/${file}`) !== expected) return { why: 'template' };
  }
  const entry = text(`games/${game}/entry.md`);
  const added = /^added: (\d{4}-\d{2}-\d{2})$/m.exec(entry)?.[1];
  const age = added ? (today - new Date(`${added}T00:00:00Z`)) / 86_400_000 : NaN;
  if (!(age >= -1 && age <= 365) || entry !== withCapture(startingEntry(game, original, { issue: claim.number, lead: author, added }), game)) return { why: 'entry' };

  const row = (readme.patch ?? '').split('\n').filter(line => /^[-+]/.test(line) && !/^(---|\+\+\+) /.test(line));
  if (readme.additions !== 1 || readme.deletions !== 0 || row.length !== 1 || !row[0].startsWith('+')) return { why: 'readme' };
  return { original, name, added, row: row[0].slice(1) };
}
