// Tests of what can come in as a game's first entry (docs/TEAMS.md), with each way of bringing something else along.
// npm run check runs them. The game, its copy and its pictures are made up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { mp4 } from '../../tools/lib/mp4.mjs';
import { captureMessage, firstFiles, firstFilesMessage, plainWebp, startingEntry, startingFiles, withCapture } from '../../tools/lib/new-game.mjs';
import { checkFirstEntry, gameOf, isClip, isShare, isStill, pathsOf, plainHistory, readCodeMap, readOriginal } from './rules.mjs';
import { MARK, REASONS, askFor, markOf, normalReview } from './text.mjs';

const GAME = 'made-up', SHA1 = 'a'.repeat(40), LEAD = 'someone';
const original = { console: 'gba', name: 'Made Up (USA)', title: 'MADEUP', code: 'MADE', sha1: SHA1 };
const ROW = '| **[Made Up Dreamport](../games/made-up/)** | The row. |';
const today = new Date('2026-11-02T12:00:00Z');
const media = `public/media/${GAME}-dreamport`;

const clip = (frames = 300, av1 = false) => mp4({
  width: 480, height: 320, description: Buffer.from([1, 2, 3]), timescale: 16777216, duration: 280896, av1,
  frames: Array.from({ length: frames }, (_, i) => ({ data: Buffer.from([i & 255, 1, 2, 3]), key: i === 0 })),
});
const png = (...extra) => {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1200);
  header.writeUInt32BE(630, 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10]), chunk('IHDR', header), ...extra.map(([type, body]) => chunk(type, body)), chunk('IDAT', deflateSync(Buffer.alloc(9))), chunk('IEND', Buffer.alloc(0))]);
};
const webp = (type = 'VP8 ') => {
  const body = Buffer.alloc(8 + 10);
  body.write(type, 0, 'latin1');
  body.writeUInt32LE(10, 4);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
};

// a first entry as the tools write it, in JavaScript or with `language` 'c', in C, which each test changes in one way
function entry(change = () => {}, language = 'js') {
  const code = language === 'js' ? startingFiles(GAME, original) : firstFiles(GAME, original, { language, issue: 7, lead: LEAD, added: '2026-11-02' });
  const bytes = new Map(Object.entries(code).filter(([file]) => file !== 'entry.md').map(([file, text]) => [`games/${GAME}/${file}`, Buffer.from(text)]));
  bytes.set(`games/${GAME}/entry.md`, Buffer.from(withCapture(startingEntry(GAME, original, { issue: 7, lead: LEAD, added: '2026-11-02' }), GAME)));
  bytes.set(`games/${GAME}/proof/original.json`, Buffer.from(`${JSON.stringify(original, null, 2)}\n`));
  bytes.set(`games/${GAME}/proof/code-map.json`, Buffer.from(`{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/gba/functions.mjs)","functions":[["08000000",4],["080000C0",200]]}\n`));
  bytes.set(`games/${GAME}/${language === 'js' ? '' : 'c/'}proof/port-map.json`, Buffer.from('{}\n'));
  bytes.set(`${media}.h264.mp4`, clip());
  bytes.set(`${media}.av1.mp4`, clip(300, true));
  bytes.set(`${media}-still.webp`, webp());
  bytes.set(`${media}-share.png`, png());
  bytes.set(`.github/readme/progress/${GAME}${language === 'js' ? '' : '-c'}.svg`, Buffer.from('<svg/>'));
  const state = {
    bytes, game: GAME, today, author: LEAD, onSite: false,
    claim: { number: 7, lead: LEAD, game: 'Made Up' },
    files: [...bytes.keys()].map(filename => ({ filename, status: 'added' })).concat({ filename: 'docs/STATUS.md', status: 'modified', additions: 1, deletions: 0, patch: `@@ -1 +1,2 @@\n context\n+${ROW}` }),
    modes: new Map([...bytes.keys(), 'docs/STATUS.md'].map(path => [path, '100644'])),
  };
  change(state);
  return checkFirstEntry({ ...state, read: path => state.bytes.get(path) });
}
const edit = (path, fn) => ({ bytes }) => bytes.set(path, Buffer.from(fn(bytes.get(path).toString('utf8'))));
const file = name => `games/${GAME}/${name}`;

test('what the tools write comes in', () => {
  const verdict = entry();
  assert.equal(verdict.why, undefined);
  assert.equal(verdict.name, 'Made Up');
  assert.equal(verdict.row, ROW);
});

test('a game that starts in C comes in with its version in C, as the tools write it, and nothing else', () => {
  const verdict = entry(() => {}, 'c');
  assert.equal(verdict.why, undefined);
  assert.equal(verdict.language, 'c');
  assert.equal(pathsOf(GAME, 'c').length, 13);
  assert.ok(pathsOf(GAME, 'c').includes(file('c/src/main.c')) && !pathsOf(GAME, 'c').includes(file('index.html')));
  for (const name of ['c/index.html', 'c/src/main.c', 'c/src/main.js', 'LICENSE']) {
    assert.equal(entry(edit(file(name), text => `${text} `), 'c').why, 'template', name);
  }
  assert.equal(entry(s => s.files.push({ filename: file('index.html'), status: 'added' }), 'c').why, 'files');
  assert.equal(entry(s => s.files.push({ filename: file('c/src/more.c'), status: 'added' }), 'c').why, 'files');
  assert.equal(entry(edit(file('entry.md'), text => `${text}\nMore words here.\n`), 'c').why, 'entry');
});

test('it is only a first entry with one new entry, in a plain folder', () => {
  const added = filename => ({ filename, status: 'added' });
  assert.equal(gameOf([added('games/made-up/entry.md')]), 'made-up');
  assert.equal(gameOf([{ filename: 'games/made-up/entry.md', status: 'modified' }]), null);
  assert.equal(gameOf([added('games/a/entry.md'), added('games/b/entry.md')]), null);
  assert.equal(gameOf([added('games/Made-Up/entry.md')]), null);
  assert.equal(gameOf([added('games/made_up/entry.md')]), null);
  assert.equal(gameOf([added('games/a/b/entry.md')]), null);
  assert.equal(gameOf([added('src/lib/site.ts')]), null);
  assert.equal(pathsOf(GAME).length, 12);
});

test('no other file, and no file missing or changed in another way', () => {
  for (const extra of ['src/lib/site.ts', '.github/workflows/x.yml', file('src/more.js'), file('notes/a.md'), file('proof/names.json'), 'public/_redirects', 'public/media/other.webp']) {
    assert.equal(entry(s => s.files.push({ filename: extra, status: 'added' })).why, 'files', extra);
  }
  assert.equal(entry(s => { s.files = s.files.filter(f => f.filename !== `${media}.av1.mp4`); }).why, 'files');
  assert.equal(entry(s => { s.files.find(f => f.filename === file('index.html')).status = 'modified'; }).why, 'files');
  assert.equal(entry(s => { s.files.find(f => f.filename === 'docs/STATUS.md').status = 'added'; }).why, 'files');
  assert.equal(entry(s => s.modes.set(`${media}-still.webp`, '120000')).why, 'files', 'a link to another file');
  assert.equal(entry(s => s.modes.set(file('src/main.js'), '100755')).why, 'files');
});

test('the page, the code and the license are the template\'s, to the byte', () => {
  for (const name of ['index.html', 'src/main.js', 'LICENSE']) {
    assert.equal(entry(edit(file(name), text => `${text} `)).why, 'template', name);
  }
  assert.equal(entry(edit(file('src/main.js'), text => `${text}\nfetch('/api/me');\n`)).why, 'template');
  assert.equal(entry(edit(file('index.html'), text => text.replace('<head>', '<head><script src="https://example.com/x.js"></script>'))).why, 'template');
});

test('the entry is what the tools write, with nothing added', () => {
  assert.equal(entry(edit(file('entry.md'), text => text.replace('kit: gba', 'kit: gba\npreview: https://example.com'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('summary: "', 'summary: "Buy now. '))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => `${text}\nMore words here.\n`)).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('play/made-up/', 'play/sonic-advance/'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('issue: 7', 'issue: 8'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace(`lead: ${LEAD}`, 'lead: other'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('still: /media/made-up', 'still: /media/sonic-advance'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('added: 2026-11-02', 'added: 2027-11-02'))).why, 'entry', 'to come first in the row');
  assert.equal(entry(edit(file('entry.md'), text => text.replace('added: 2026-11-02', 'added: 2020-01-01'))).why, 'entry');
  assert.equal(entry(edit(file('entry.md'), text => text.replace(/^added: .*$/m, ''))).why, 'entry');
});

test('only the lead of the claim, on a game not on the site', () => {
  assert.equal(entry(s => { s.author = 'other'; }).why, 'claim');
  assert.equal(entry(s => { s.claim = null; }).why, 'claim');
  assert.equal(entry(s => { s.claim.game = 'Another Game'; }).why, 'claim');
  assert.equal(entry(s => { s.onSite = true; }).why, 'game');
});

test('original.json holds nothing but what the tools read', () => {
  const plain = value => `${JSON.stringify({ ...original, ...value }, null, 2)}\n`;
  assert.deepEqual(readOriginal(plain({})), original);
  assert.ok(readOriginal(plain({ keysAfterVBlank: true })));
  assert.ok(readOriginal(plain({ name: 'Mario & Luigi: Superstar Saga (USA, Europe)' })));
  for (const [what, text] of Object.entries({
    markup: plain({ name: '<script>alert(1)</script> (USA)' }),
    mention: plain({ name: '@someone (USA)' }),
    link: plain({ name: 'See https://example.com (USA)' }),
    region: plain({ name: 'Made Up (<b>USA</b>)' }),
    extra: plain({ note: 'words' }),
    console: plain({ console: 'snes' }),
    title: plain({ title: "';alert(1);//" }),
    code: plain({ code: 'MADE;' }),
    sha1: plain({ sha1: 'not one' }),
    twice: `{"name":"<b>hidden</b> (USA)",${JSON.stringify(original).slice(1)}`,
    list: '[]',
    words: '// words\n{}',
  })) assert.equal(readOriginal(text), null, what);
});

test('the code map holds only functions in order, of this copy', () => {
  const map = (from, functions, sha1 = SHA1) => `{"original":"${sha1}","from":"${from}","functions":${JSON.stringify(functions)}}\n`;
  const good = [['08000000', 4], ['080000C0', 200]];
  assert.equal(readCodeMap(map('The tools', good), SHA1), 'The tools');
  assert.equal(readCodeMap(`{\n  "original": "${SHA1}",\n  "from": "The tools",\n  "functions": [\n    ["08000000",4],\n    ["080000C0",200]\n  ]\n}\n`, SHA1), 'The tools');
  assert.equal(readCodeMap(map('The tools', good, 'b'.repeat(40)), SHA1), null);
  assert.equal(readCodeMap(map('<b>hi</b>', good), SHA1), null);
  assert.equal(readCodeMap(map('The tools', [['080000C0', 200], ['08000000', 4]]), SHA1), null);
  assert.equal(readCodeMap(map('The tools', [['02000000', 4]]), SHA1), null);
  assert.equal(readCodeMap(map('The tools', []), SHA1), null);
  assert.equal(readCodeMap(`{"note":"words",${map('The tools', good).slice(1)}`, SHA1), null);
  assert.equal(readCodeMap(`${map('The tools', good)}// words`, SHA1), null);
  assert.equal(entry(edit(file('proof/code-map.json'), () => map('The tools', good, 'b'.repeat(40)))).why, 'proof');
});

test('the game\'s name and the code map\'s source keep the rules', () => {
  assert.equal(entry(edit(file('proof/code-map.json'), () => `{"original":"${SHA1}","from":"https://romsite.example/game.gba","functions":[["08000000",4]]}\n`)).why, 'words');
});

test('a capture is a silent clip, a still and a share picture, with nothing else in them', () => {
  assert.ok(isClip(clip(), 'avc1'));
  assert.ok(isClip(clip(300, true), 'av01'));
  assert.ok(isStill(webp()));
  assert.ok(isShare(png()));
  assert.equal(isClip(clip(), 'av01'), false);
  assert.equal(isClip(clip(30), 'avc1'), false, 'too short');
  assert.equal(isClip(clip(600), 'avc1'), false, 'too long');
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
  assert.equal(isClip(Buffer.concat([clip(), box('free', Buffer.from('words'))]), 'avc1'), false, 'words after it');
  assert.equal(isClip(Buffer.from('<html>'), 'avc1'), false);
  assert.equal(isClip(Buffer.concat([clip(), Buffer.alloc(1_500_000)]), 'avc1'), false);
  assert.equal(isStill(webp('EXIF')), false, 'words in a still');
  const profiled = Buffer.concat([webp('ICCP'), webp().subarray(12)]);
  profiled.writeUInt32LE(profiled.length - 8, 4);
  assert.equal(isStill(profiled), false, 'room for words beside a still');
  assert.ok(isStill(plainWebp(profiled)), 'what capture writes from a browser\'s still');
  assert.equal(isStill(Buffer.from('<svg onload="alert(1)"></svg>')), false);
  assert.equal(isShare(png(['tEXt', Buffer.from('words')])), false, 'words in a picture');
  assert.equal(isShare(Buffer.concat([png(), Buffer.from('words')])), false);
  assert.equal(isShare(webp()), false);
  assert.equal(entry(({ bytes }) => bytes.set(`${media}-still.webp`, Buffer.from('<svg/>'))).why, 'capture');
  assert.equal(entry(({ bytes }) => bytes.set(`${media}.h264.mp4`, bytes.get(`${media}.av1.mp4`))).why, 'capture');
});

test('the status table gains one row and loses nothing', () => {
  const readme = (patch, additions, deletions) => s => Object.assign(s.files.find(f => f.filename === 'docs/STATUS.md'), { patch, additions, deletions });
  assert.equal(entry(readme(`+${ROW}\n+| more |`, 2, 0)).why, 'readme');
  assert.equal(entry(readme(`-| a row |\n+${ROW}`, 1, 1)).why, 'readme');
  assert.equal(entry(readme(undefined, 1, 0)).why, 'readme');
});

test('the bot says only its own words, and its mark names what it checked', () => {
  const plan = { game: GAME, sha: SHA1, head: 'someone/dreamports', name: 'Made Up', pr: 1, comment: null };
  assert.equal(MARK.exec(askFor(plan))[1], SHA1);
  assert.ok(MARK.test(normalReview('files')));
  assert.equal(MARK.exec(normalReview('files'))[1], undefined);
  assert.equal(markOf(SHA1), `<!-- first-entry ${SHA1} -->`);
  assert.match(askFor(plan), /^- \[ \] This is real play of Made Up, /m);
  for (const why of Object.keys(REASONS)) assert.ok(normalReview(why).includes(REASONS[why]));
});

test('a first entry keeps its commits only when they are the two the tools make', () => {
  const issue = 7, added = '2026-11-02';
  const person = { name: 'Someone' };
  const commit = (sha, parent, message, who = person) => ({ sha, parents: [{ sha: parent }], commit: { message, author: who, committer: who } });
  const history = (changes = {}) => {
    const state = {
      commits: [commit('b1', 'a0', firstFilesMessage('Made Up', issue)), commit('c2', 'b1', `${captureMessage('Made Up', issue)}\n`)],
      between: [...['.h264.mp4', '.av1.mp4', '-still.webp', '-share.png'].map(end => ({ filename: `${media}${end}`, status: 'added' })), { filename: file('entry.md'), status: 'modified' }],
      firstEntry: startingEntry(GAME, original, { issue, lead: LEAD, added }),
      game: GAME, original, issue, author: LEAD, added,
      ...changes,
    };
    return plainHistory(state);
  };
  assert.equal(history(), true);
  const [first, second] = [commit('b1', 'a0', firstFilesMessage('Made Up', issue)), commit('c2', 'b1', captureMessage('Made Up', issue))];
  assert.equal(history({ commits: [second] }), false, 'one commit, which has nothing to keep');
  assert.equal(history({ commits: [first, commit('x', 'b1', 'more'), second] }), false, 'one more, which could have held anything');
  assert.equal(history({ commits: [first, commit('c2', 'a0', captureMessage('Made Up', issue))] }), false, 'not one on the other');
  assert.equal(history({ commits: [{ ...first, parents: [{ sha: 'a0' }, { sha: 'elsewhere' }] }, second] }), false, 'a merge of something else');
  assert.equal(history({ commits: [commit('b1', 'a0', 'feat: buy my thing (#7)'), second] }), false, 'words of their own');
  assert.equal(history({ commits: [first, commit('c2', 'b1', captureMessage('Made Up', issue), { name: 'Buy Bitcoin now https://example.com' })] }), false, 'words in a name');
  assert.equal(history({ between: [{ filename: file('entry.md'), status: 'modified' }] }), false, 'what the first holds has to be all but the capture');
  assert.equal(history({ between: [{ filename: 'docs/STATUS.md', status: 'modified' }, ...['.h264.mp4', '.av1.mp4', '-still.webp', '-share.png'].map(end => ({ filename: `${media}${end}`, status: 'added' }))] }), false, 'another file changed between them');
  assert.equal(history({ firstEntry: startingEntry(GAME, original, { issue, lead: 'somebody-else', added }) }), false, 'an entry the tools wouldn\'t write');
});
