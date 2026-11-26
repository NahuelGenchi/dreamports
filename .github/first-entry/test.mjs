// Tests of what can come in as a new game's first files and as its card (docs/TEAMS.md), with each way of bringing
// something else along. npm run check runs them. The games, their copies and their pictures are made up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { mp4 } from '../../tools/lib/mp4.mjs';
import { firstFiles, firstFilesMessage, plainWebp, startingEntry, startingFiles, withCapture } from '../../tools/lib/new-game.mjs';
import { cardOf, checkCard, checkFirstFiles, clipSizes, gameOf, isClip, isShare, isStill, mediaOf, pathsOf, plainHistory, readCodeMap, readOriginal } from './rules.mjs';
import { KINDS, MARK, REASONS, askFor, comingFor, markOf, merged, normalReview } from './text.mjs';

const GAME = 'made-up', SHA1 = 'a'.repeat(40), LEAD = 'someone';
const original = { console: 'gba', name: 'Made Up (USA)', title: 'MADEUP', code: 'MADE', sha1: SHA1 };
const ROW = '| **[Made Up Dreamport](../games/made-up/)** | The row. |';
const today = new Date('2026-11-02T12:00:00Z');
const media = `public/media/${GAME}-dreamport`;

const clip = (frames = 300, av1 = false, [width, height] = [480, 320]) => mp4({
  width, height, description: Buffer.from([1, 2, 3]), timescale: 16777216, duration: 280896, av1,
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

// a new game's first files as the tools write them, in JavaScript or with `language` 'c', in C, of `copy`, which each
// test changes in one way
function entry(change = () => {}, language = 'js', copy = original) {
  const code = language === 'js' ? startingFiles(GAME, copy) : firstFiles(GAME, copy, { language, issue: 7, lead: LEAD, added: '2026-11-02' });
  const bytes = new Map(Object.entries(code).filter(([file]) => file !== 'entry.md').map(([file, text]) => [`games/${GAME}/${file}`, Buffer.from(text)]));
  bytes.set(`games/${GAME}/entry.md`, Buffer.from(startingEntry(GAME, copy, { issue: 7, lead: LEAD, added: '2026-11-02' })));
  bytes.set(`games/${GAME}/proof/original.json`, Buffer.from(`${JSON.stringify(copy, null, 2)}\n`));
  bytes.set(`games/${GAME}/proof/code-map.json`, Buffer.from(`{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/gba/functions.mjs)","functions":[["08000000",4],["080000C0",200]]}\n`));
  bytes.set(`games/${GAME}/${language === 'js' ? '' : 'c/'}proof/port-map.json`, Buffer.from('{}\n'));
  bytes.set(`.github/readme/progress/${GAME}${language === 'js' ? '' : '-c'}.svg`, Buffer.from('<svg/>'));
  const state = {
    bytes, game: GAME, today, author: LEAD, onSite: false,
    claim: { number: 7, lead: LEAD, game: 'Made Up' },
    files: [...bytes.keys()].map(filename => ({ filename, status: 'added' })).concat({ filename: 'docs/STATUS.md', status: 'modified', additions: 1, deletions: 0, patch: `@@ -1 +1,2 @@\n context\n+${ROW}` }),
    modes: new Map([...bytes.keys(), 'docs/STATUS.md'].map(path => [path, '100644'])),
  };
  change(state);
  return checkFirstFiles({ ...state, read: path => state.bytes.get(path) });
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
  assert.equal(pathsOf(GAME, 'c').length, 9);
  assert.ok(pathsOf(GAME, 'c').includes(file('c/src/main.c')) && !pathsOf(GAME, 'c').includes(file('index.html')));
  for (const name of ['c/index.html', 'c/src/main.c', 'c/src/main.js', 'LICENSE']) {
    assert.equal(entry(edit(file(name), text => `${text} `), 'c').why, 'template', name);
  }
  assert.equal(entry(s => s.files.push({ filename: file('index.html'), status: 'added' }), 'c').why, 'files');
  assert.equal(entry(s => s.files.push({ filename: file('c/src/more.c'), status: 'added' }), 'c').why, 'files');
  assert.equal(entry(edit(file('entry.md'), text => `${text}\nMore words here.\n`), 'c').why, 'entry');
});

test('they are only first files with one new entry, in a plain folder', () => {
  const added = filename => ({ filename, status: 'added' });
  assert.equal(gameOf([added('games/made-up/entry.md')]), 'made-up');
  assert.equal(gameOf([{ filename: 'games/made-up/entry.md', status: 'modified' }]), null);
  assert.equal(gameOf([added('games/a/entry.md'), added('games/b/entry.md')]), null);
  assert.equal(gameOf([added('games/Made-Up/entry.md')]), null);
  assert.equal(gameOf([added('games/made_up/entry.md')]), null);
  assert.equal(gameOf([added('games/a/b/entry.md')]), null);
  assert.equal(gameOf([added('src/lib/site.ts')]), null);
  assert.equal(pathsOf(GAME).length, 8);
});

test('no other file, and no file missing or changed in another way', () => {
  for (const extra of ['src/lib/site.ts', '.github/workflows/x.yml', file('src/more.js'), file('notes/a.md'), file('proof/names.json'), 'public/_redirects', 'public/media/other.webp']) {
    assert.equal(entry(s => s.files.push({ filename: extra, status: 'added' })).why, 'files', extra);
  }
  assert.equal(entry(s => { s.files = s.files.filter(f => f.filename !== file('proof/code-map.json')); }).why, 'files');
  for (const picture of mediaOf(GAME)) assert.equal(entry(s => s.files.push({ filename: picture, status: 'added' })).why, 'files', 'a picture, which is the card\'s');
  assert.equal(entry(s => { s.files.find(f => f.filename === file('index.html')).status = 'modified'; }).why, 'files');
  assert.equal(entry(s => { s.files.find(f => f.filename === 'docs/STATUS.md').status = 'added'; }).why, 'files');
  assert.equal(entry(s => s.modes.set(file('LICENSE'), '120000')).why, 'files', 'a link to another file');
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
  assert.equal(entry(edit(file('entry.md'), text => withCapture(text, GAME))).why, 'entry', 'a capture named, which is the card\'s');
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
    console: plain({ console: 'made-up-console' }),
    header: plain({ title: 'A title longer than a cartridge has' }),
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
  // what the game makes in its work RAM, by its bytes, and where it copies the cartridge's code
  const withRam = [['02000000/E92D4000E3A00001', 8], ['08000000', 4], ['080000C0', 200]];
  assert.equal(readCodeMap(map('The tools', withRam), SHA1), 'The tools');
  assert.equal(readCodeMap(`${map('The tools', good).slice(0, -2)},"copies":[["03000000","080000C0",64]]}\n`, SHA1), 'The tools');
  assert.equal(readCodeMap(map('The tools', [['02000000/E92D4000', 8]]), SHA1), null);
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
});

test('the status table gains one row and loses nothing', () => {
  const readme = (patch, additions, deletions) => s => Object.assign(s.files.find(f => f.filename === 'docs/STATUS.md'), { patch, additions, deletions });
  assert.equal(entry(readme(`+${ROW}\n+| more |`, 2, 0)).why, 'readme');
  assert.equal(entry(readme(`-| a row |\n+${ROW}`, 1, 1)).why, 'readme');
  assert.equal(entry(readme(undefined, 1, 0)).why, 'readme');
});

test('a game on another console comes in the same way, as its copy\'s header says less', () => {
  const nes = { console: 'nes', name: 'Made Up (USA)', title: 'Made Up', code: '', sha1: SHA1 };
  const map = functions => edit(file('proof/code-map.json'), () => `{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/nes/functions.mjs)","functions":${JSON.stringify(functions)}}\n`);
  const verdict = entry(map([['00004450', 139], ['0001FFBE', 42]]), 'c', nes);
  assert.equal(verdict.why, undefined);
  assert.equal(verdict.name, 'Made Up');
  assert.deepEqual(readOriginal(`${JSON.stringify(nes, null, 2)}\n`), nes);
  assert.equal(readOriginal(`${JSON.stringify({ ...nes, title: '<b>Made Up</b>' }, null, 2)}\n`), null);
  assert.equal(readOriginal(`${JSON.stringify({ ...nes, code: 'see https://example.com' }, null, 2)}\n`), null);
  // a Game Boy Advance game's code is where its cartridge is, and its header is its own
  assert.equal(entry(map([['00004450', 139]]), 'c').why, 'proof');
  assert.equal(readOriginal(`${JSON.stringify({ ...original, code: '' }, null, 2)}\n`), null);
  assert.equal(entry(edit(file('c/src/main.c'), text => `${text} `), 'c', nes).why, 'template');
  assert.equal(readOriginal(`${JSON.stringify({ ...nes, title: 'Buy at romsite.example' }, null, 2)}\n`), null, 'a title that isn\'t the game\'s name');
  assert.ok(readOriginal(`${JSON.stringify({ ...nes, title: 'MADE UP' }, null, 2)}\n`));
  assert.ok(readOriginal(`${JSON.stringify({ ...nes, title: 'Made Up (USA)' }, null, 2)}\n`), 'the copy\'s own name');
  // a Game Boy game's header names it in its own words, as a Game Boy Advance's does, and its code is in its program
  const gb = { console: 'gb', name: 'Made Up (World)', title: 'MADEUP TITLE', code: '', sha1: SHA1 };
  assert.deepEqual(readOriginal(`${JSON.stringify(gb, null, 2)}\n`), gb);
  assert.ok(readOriginal(`${JSON.stringify({ ...gb, console: 'gbc', title: 'MADEUP GBC', code: 'AXYE' }, null, 2)}\n`));
  assert.equal(readOriginal(`${JSON.stringify({ ...gb, code: 'AXYE' }, null, 2)}\n`), null, 'only a Game Boy Color copy has a code');
  assert.equal(readOriginal(`${JSON.stringify({ ...gb, title: 'Buy at romsite.example' }, null, 2)}\n`), null, 'too long for its header, and not the game\'s name');
  assert.equal(entry(edit(file('proof/code-map.json'), () => `{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/gbc/functions.mjs)","functions":[["00000040",3],["00000100",388],["00008123",12]]}\n`), 'c', gb).why, undefined);
  assert.equal(entry(map([['00000100', 388], ['08000000', 4]]), 'c', gb).why, 'proof', 'past the largest cartridge');
  // a PlayStation 2 game's code is the name of the program its disc boots, and its functions are in more places than
  // one: the program, the vector units' code, and the disc's other programs and modules, each in order (#1859)
  const ps2 = { ...nes, console: 'ps2', code: 'SLUS_200.02' };
  const disc = [['00100008', 232], ['001000F0', 8], ['003599B8~vu', 2048], ['0035A1C0~vu', 2048], ['00000000@IOPRP254.IMG:CDVDFSV', 216], ['000000D8@IOPRP254.IMG:CDVDFSV', 268], ['00000000@MODULES/PADMAN.IRX', 8], ['00000040@DATA/GAME.ARC:0x1000', 12], ['00000000@DATA/GAME.ARC:0x1000~vu', 64]];
  assert.equal(entry(map(disc), 'c', ps2).why, undefined);
  assert.deepEqual(readOriginal(`${JSON.stringify(ps2, null, 2)}\n`), ps2);
  assert.ok(readOriginal(`${JSON.stringify({ ...ps2, code: '' }, null, 2)}\n`), 'a program with no disc');
  for (const code of ['SLUS_200.02 ', 'ROMS.EXAMPLE', 'SLUS-20002', 'slus_200.02', 'SLUS_200.02;1']) {
    assert.equal(readOriginal(`${JSON.stringify({ ...ps2, code }, null, 2)}\n`), null, code);
  }
  assert.equal(readOriginal(`${JSON.stringify({ ...nes, code: 'SLUS_200.02' }, null, 2)}\n`), null, 'only a PlayStation 2 game\'s');
  for (const [what, functions] of Object.entries({
    'a place out of order': [['001000F0', 8], ['00100008', 232]],
    'a module out of order': [['00100008', 232], ['000000D8@PADMAN.IRX', 8], ['00000000@PADMAN.IRX', 8]],
    'a place in two parts': [['00100008', 232], ['003599B8~vu', 2048], ['001000F0', 8]],
    'a place twice': [['00000000@PADMAN.IRX', 8], ['00000000@PADMAN.IRX', 8]],
    'words for a place': [['00100008@see https://example.com', 232]],
    'a place of another form': [['00100008@<b>', 232]],
    'a mark of another form': [['00100008~words', 232]],
    'bytes, as only the Game Boy Advance has': [['00100008/E92D4000E3A00001', 232]],
  })) assert.equal(entry(map(functions), 'c', ps2).why, 'proof', what);
  assert.equal(entry(map([['00004450', 139], ['00000000@PADMAN.IRX', 8]]), 'c', nes).why, 'proof', 'places, on a console with one');
  assert.equal(entry(map([['00004450', 139], ['00004500~vu', 8]]), 'c', nes).why, 'proof');
  assert.equal(readCodeMap(`{"original":"${SHA1}","from":"The tools","functions":[["08000000",4],["080000C0@PADMAN.IRX",200]]}\n`, SHA1), null);
  // a PlayStation Portable game's code is its UMD's, or none, and its functions are in the console's memory for games
  const psp = { ...nes, console: 'psp', code: 'ULUS-10041' };
  assert.equal(entry(map([['08804000', 1104], ['08804450', 60], ['0BFFFF00', 8]]), 'c', psp).why, undefined);
  assert.deepEqual(readOriginal(`${JSON.stringify(psp, null, 2)}\n`), psp);
  assert.ok(readOriginal(`${JSON.stringify({ ...psp, code: '' }, null, 2)}\n`), 'a program or a download');
  assert.ok(readOriginal(`${JSON.stringify({ ...psp, code: 'NPJH50001', keysAfterVBlank: true }, null, 2)}\n`));
  for (const code of ['ULUS-10041|', 'ulus-10041', 'ROMS EXAMPLE', 'SLUS_200.02']) assert.equal(readOriginal(`${JSON.stringify({ ...psp, code }, null, 2)}\n`), null, code);
  // its code map says where the program starts, a function no call can prove
  const started = text => edit(file('proof/code-map.json'), () => `{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/psp/functions.mjs)","functions":[["08804000",140],["0880408C",24]],${text}}\n`);
  assert.equal(entry(started('"start":"08804000"'), 'c', psp).why, undefined);
  assert.equal(entry(started('"start":"see example.com"'), 'c', psp).why, 'proof');
  for (const [what, functions] of Object.entries({
    'the kernel\'s memory': [['88000000', 8]],
    'below a game\'s memory': [['08000000', 8]],
    'past the console\'s memory': [['0C000000', 8]],
    'a place, as only a PlayStation 2 disc has': [['08804000@PADMAN.IRX', 8]],
    'bytes, as only the Game Boy Advance has': [['08804000/E92D4000E3A00001', 232]],
  })) assert.equal(entry(map(functions), 'c', psp).why, 'proof', what);
  // a GameCube game's code is its disc's six letters, its program's functions are in the console's 24 MB, and its
  // modules' are each in a place of their own, by the module's file, whose name can have small letters (#1944)
  const gamecube = { ...nes, console: 'gamecube', code: 'GMUE00' };
  const cube = [['80003100', 72], ['80003148', 168], ['00000058@stage/first.rel', 36], ['0000007C@stage/first.rel', 8], ['00000040@Menu.rel', 12]];
  assert.equal(entry(map(cube), 'c', gamecube).why, undefined);
  assert.deepEqual(readOriginal(`${JSON.stringify(gamecube, null, 2)}\n`), gamecube);
  assert.ok(readOriginal(`${JSON.stringify({ ...gamecube, code: '' }, null, 2)}\n`), 'a program with no disc');
  for (const code of ['GMUE0', 'GMUE000', 'gmue00', 'GMUE 0', 'SLUS_200.02']) {
    assert.equal(readOriginal(`${JSON.stringify({ ...gamecube, code }, null, 2)}\n`), null, code);
  }
  for (const [what, functions] of Object.entries({
    'a function outside the console\'s memory': [['81800000', 72]],
    'a function where the Game Boy Advance\'s cartridge is': [['08000100', 72]],
    'a module out of order': [['80003100', 72], ['0000007C@stage/first.rel', 8], ['00000058@stage/first.rel', 36]],
    'words for a module': [['80003100', 72], ['00000058@see https://example.com', 36]],
    'a vector unit\'s program, which only the PlayStation 2 has': [['80003100~vu', 72]],
  })) assert.equal(entry(map(functions), 'c', gamecube).why, 'proof', what);
  // a Nintendo DS game's code is in its ARM9 program, its ARM7 program and its overlays, each a place, and its map
  // says which functions are Thumb code
  const nds = { ...original, console: 'nds', title: 'MADE UP DS', code: 'MDUE' };
  assert.deepEqual(readOriginal(`${JSON.stringify(nds, null, 2)}\n`), nds);
  const ndsMap = (functions, modes = '') => `{"original":"${SHA1}","from":"The tools","functions":[${functions.map(f => JSON.stringify(f)).join(',')}]${modes}}\n`;
  const cartridge = [['01FF8000', 12], ['02000000', 8], ['02000800', 40], ['02380000@ARM7', 8], ['02100000@OVERLAY9_0003', 6], ['02100000@OVERLAY9_0004', 20]];
  assert.ok(readCodeMap(ndsMap(cartridge, ',"modes":{"02000800":"thumb","02100000@OVERLAY9_0003":"thumb"}'), SHA1, 'nds'));
  assert.ok(readCodeMap(ndsMap(cartridge), SHA1, 'nds'));
  assert.equal(readCodeMap(ndsMap([['08000000', 8]]), SHA1, 'nds'), null, 'not where a Nintendo DS game\'s code is');
  assert.equal(readCodeMap(ndsMap([['02000000', 8], ['02380000@ARM7', 8], ['02000800', 40]]), SHA1, 'nds'), null, 'a place in two parts');
  assert.equal(readCodeMap(ndsMap(cartridge, ',"modes":{"02000800":"see https://example.com"}'), SHA1, 'nds'), null, 'words for a mode');
  assert.equal(readOriginal(`${JSON.stringify({ ...nds, code: 'MADE UP' }, null, 2)}\n`), null);
  // a Super Nintendo game's map says the mode each function starts in, and nothing else
  const snes = { ...nes, console: 'snes' };
  const modes = text => edit(file('proof/code-map.json'), () => `{"original":"${SHA1}","from":"Found in the copy by the proof tools (tools/snes/functions.mjs)","functions":[["00000000",24],["00000018",72]],"modes":${text}}\n`);
  assert.equal(entry(modes('{"00000000":"e","00000018":"a16i16"}'), 'c', snes).why, undefined);
  assert.equal(entry(modes('{"00000018":"a16i32"}'), 'c', snes).why, 'proof');
  assert.equal(entry(modes('{"00000018":"see https://example.com"}'), 'c', snes).why, 'proof');
});

// a game's card as `capture` writes it, for a game on main, which each test changes in one way
function card(change = () => {}, copy = original, size = [480, 320]) {
  const before = startingEntry(GAME, copy, { issue: 7, lead: LEAD, added: '2026-11-02' });
  const [h264, av1, still, share] = mediaOf(GAME);
  const bytes = new Map([[h264, clip(300, false, size)], [av1, clip(300, true, size)], [still, webp()], [share, png()], [file('entry.md'), Buffer.from(withCapture(before, GAME))]]);
  const state = {
    bytes, game: GAME, author: LEAD, claim: { number: 7, lead: LEAD },
    onMain: { entry: before, original: `${JSON.stringify(copy, null, 2)}\n` },
    files: [...bytes.keys()].map(filename => ({ filename, status: filename.endsWith('entry.md') ? 'modified' : 'added' })),
    modes: new Map([...bytes.keys()].map(path => [path, '100644'])),
  };
  change(state);
  return checkCard({ ...state, read: path => state.bytes.get(path) });
}

test('a game\'s card comes in by itself: its capture and its entry naming it, for a game on main with none', () => {
  const verdict = card();
  assert.equal(verdict.why, undefined);
  assert.equal(verdict.name, 'Made Up');
  const files = [...mediaOf(GAME).map(filename => ({ filename, status: 'added' })), { filename: file('entry.md'), status: 'modified' }];
  assert.equal(cardOf(files), GAME);
  assert.equal(cardOf([...files, { filename: file('src/more.js'), status: 'added' }]), null, 'with anything else it\'s a step, which is reviewed');
  assert.equal(cardOf(files.slice(1)), null);
  assert.equal(cardOf(files.map(f => ({ ...f, status: 'modified' }))), null, 'another capture for a game that has one');
  assert.equal(cardOf([...mediaOf('other').map(filename => ({ filename, status: 'added' })), files[4]]), null, 'another game\'s pictures');
  assert.equal(gameOf(files), null);
});

test('a card brings nothing else along', () => {
  const [h264, av1, still] = mediaOf(GAME);
  assert.equal(card(s => s.files.push({ filename: 'src/lib/site.ts', status: 'added' })).why, 'files');
  assert.equal(card(s => s.modes.set(still, '120000')).why, 'files', 'a link to another file');
  assert.equal(card(s => { s.onMain.entry = null; }).why, 'card', 'a game that isn\'t on main');
  assert.equal(card(s => { s.onMain.entry = withCapture(s.onMain.entry, GAME); }).why, 'card', 'a game with its card already');
  assert.equal(card(s => { s.author = 'other'; }).why, 'claim');
  assert.equal(card(s => { s.claim = null; }).why, 'claim');
  assert.equal(card(({ bytes }) => bytes.set(still, Buffer.from('<svg/>'))).why, 'capture');
  assert.equal(card(({ bytes }) => bytes.set(h264, bytes.get(av1))).why, 'capture');
  assert.equal(card(edit(file('entry.md'), text => text.replace('summary: "', 'summary: "Buy now. '))).why, 'entry');
  assert.equal(card(edit(file('entry.md'), text => text.replace('still: /media/made-up', 'still: /media/sonic-advance'))).why, 'entry');
  assert.equal(card(edit(file('entry.md'), text => `${text}\nMore words here.\n`)).why, 'entry');
  // the entry main has is the one it's compared with, whatever was merged into it since the game's first files
  const grown = text => text.replace('## Credits', 'It has a story mode.\n\n## Credits');
  assert.equal(card(s => { s.onMain.entry = grown(s.onMain.entry); s.bytes.set(file('entry.md'), Buffer.from(withCapture(s.onMain.entry, GAME))); }).why, undefined);
});

test('a capture is as big as the game\'s screen, twice over', () => {
  const nes = { console: 'nes', name: 'Made Up (USA)', title: 'Made Up', code: '', sha1: SHA1 };
  assert.deepEqual(clipSizes(original), [[480, 320]]);
  assert.deepEqual(clipSizes(nes), [[512, 480]]);
  assert.deepEqual(clipSizes({ ...nes, console: 'md', screen: [[320, 224], [256, 224]] }), [[640, 448], [640, 448], [512, 448], [512, 448]]);
  assert.equal(card(() => {}, nes, [512, 480]).why, undefined);
  assert.equal(card(() => {}, nes).why, 'capture', 'a Game Boy Advance\'s size for an NES game');
  assert.equal(card(() => {}, original, [512, 480]).why, 'capture');
});

test('the bot says only its own words, and its mark names what it checked', () => {
  const plan = { game: GAME, sha: SHA1, head: 'someone/dreamports', name: 'Made Up', pr: 1, comment: null };
  assert.equal(MARK.exec(askFor(plan))[1], SHA1);
  assert.equal(MARK.exec(comingFor(plan))[1], SHA1);
  assert.ok(MARK.test(normalReview('files')));
  assert.equal(MARK.exec(normalReview('files'))[1], undefined);
  assert.equal(markOf(SHA1), `<!-- first-entry ${SHA1} -->`);
  assert.match(askFor(plan), /^- \[ \] This is real play of Made Up, /m);
  assert.doesNotMatch(comingFor(plan), /- \[ \]/, 'first files have nothing to tick');
  for (const what of Object.keys(KINDS)) {
    for (const why of Object.keys(REASONS)) assert.ok(normalReview(why, what).includes(REASONS[why]) && normalReview(why, what).includes(KINDS[what].looks));
    assert.ok(MARK.test(merged('Made Up', what)));
  }
  // read.mjs tells a card's comment from first files' by these words
  for (const text of [askFor(plan), normalReview('files', 'card')]) assert.match(text, /a game's card/);
  for (const text of [comingFor(plan), normalReview('files', 'files')]) assert.doesNotMatch(text, /a game's card/);
});

test('first files keep their commit only when it is the one the tools make', () => {
  const issue = 7;
  const person = { name: 'Someone' };
  const commit = (sha, parents, message, who = person) => ({ sha, parents: parents.map(parent => ({ sha: parent })), commit: { message, author: who, committer: who } });
  const first = commit('b1', ['a0'], `${firstFilesMessage('Made Up', issue)}\n`);
  const history = commits => plainHistory({ commits, original, issue });
  assert.equal(history([first]), true);
  assert.equal(history([first, commit('c2', ['b1'], 'more')]), false, 'one more, which could have held anything');
  assert.equal(history([]), false);
  assert.equal(history([commit('b1', ['a0', 'elsewhere'], firstFilesMessage('Made Up', issue))]), false, 'a merge of something else');
  assert.equal(history([commit('b1', ['a0'], 'feat: buy my thing (#7)')]), false, 'words of their own');
  assert.equal(history([commit('b1', ['a0'], firstFilesMessage('Made Up', 8))]), false, 'another game\'s issue');
  assert.equal(history([commit('b1', ['a0'], firstFilesMessage('Made Up', issue), { name: 'Buy Bitcoin now https://example.com' })]), false, 'words in a name');
});
