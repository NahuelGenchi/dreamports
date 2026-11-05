// The checks a label goes through before the site shows it (src/lib/labels.mjs, docs/LABELS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { endOf, pictureProblem, problemsWith, showing } from '../../src/lib/labels.mjs';

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

// a real PNG of one colour, with an animation's chunk when asked
function png(width, height, { animated = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a still PNG of exactly 240 x 60 pixels is a label', () => {
  assert.equal(pictureProblem(png(240, 60)), null);
});

test('any other picture is not', () => {
  assert.match(pictureProblem(png(241, 60)), /241 x 60/);
  assert.match(pictureProblem(png(240, 61)), /240 x 61/);
  assert.match(pictureProblem(png(240, 60, { animated: true })), /moves/);
  assert.match(pictureProblem(Buffer.from('GIF89a, not a PNG at all, and long enough to read')), /not a PNG/);
  const big = Buffer.concat([png(240, 60), Buffer.alloc(70 * 1024)]);
  assert.match(pictureProblem(big), /at most 64 KB/);
});

test('a label shows for 30 days from its start', () => {
  const start = Date.parse('2026-11-05T00:00:00Z');
  assert.equal(endOf('2026-11-05'), start + 30 * 24 * 60 * 60 * 1000);
  assert.ok(Number.isNaN(endOf('2026-02-30')));
  assert.ok(Number.isNaN(endOf('5 November')));
  const list = [
    { file: 'ended.png', start: '2026-09-01' },
    { file: 'showing.png', start: '2026-11-05' },
    { file: 'later.png', start: '2026-12-01' },
  ];
  // the day before its 30 days end, and the moment they do
  assert.deepEqual(showing(list, Date.parse('2026-12-04T23:59:59Z')).map((l) => l.src), ['/labels/showing.png', '/labels/later.png']);
  assert.deepEqual(showing(list, Date.parse('2026-12-05T00:00:00Z')).map((l) => l.src), ['/labels/later.png']);
});

test('the list says what is wrong with each label', () => {
  const files = { 'good.png': png(240, 60), 'wide.png': png(480, 60) };
  const read = (file) => files[file] ?? null;
  assert.deepEqual(problemsWith([{ file: 'good.png', start: '2026-11-05' }], read), []);
  assert.deepEqual(problemsWith([], read), []);
  const problems = problemsWith(
    [
      { file: 'good.png', start: '2026-11-05' },
      { file: 'good.png', start: '2026-11-06' },
      { file: 'wide.png', start: '2026-11-05' },
      { file: 'gone.png', start: '2026-11-05' },
      { file: 'Bad Name.PNG', start: '2026-11-05' },
      { file: 'good.png', start: 'soon', link: 'https://example.com' },
    ],
    read,
  );
  assert.equal(problems.length, 7);
  assert.ok(problems.some((p) => /good\.png is listed twice/.test(p)));
  assert.ok(problems.some((p) => /wide\.png is 480 x 60/.test(p)));
  assert.ok(problems.some((p) => /gone\.png is listed, and there's no such file/.test(p)));
  assert.ok(problems.some((p) => /Bad Name\.PNG's file must be/.test(p)));
  assert.ok(problems.some((p) => /has link/.test(p)));
  assert.ok(problems.some((p) => /start must be a real date/.test(p)));
  assert.deepEqual(problemsWith({}, read), ['labels.json is not a list']);
});
