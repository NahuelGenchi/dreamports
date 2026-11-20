// node --test tools/test/download.test.mjs: what the tools fetch at a fixed version (../lib/download.mjs), from a
// server of the test's own on this computer: a busy answer asked again, an address without the file left for the next,
// bytes of another hash never used, and an error that says which address failed and why.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fetchChecked } from '../lib/download.mjs';

const FILE = Buffer.from('the file the tools pin\n'), SHA256 = createHash('sha256').update(FILE).digest('hex');
let server, base;
const asked = new Map();

before(async () => {
  server = createServer((request, response) => {
    const times = (asked.get(request.url) ?? 0) + 1;
    asked.set(request.url, times);
    if (request.url === '/file') return response.end(FILE);
    // busy twice, then the file
    if (request.url === '/busy') return times < 3 ? (response.statusCode = 503, response.end()) : response.end(FILE);
    if (request.url === '/other') return response.end('other bytes\n');
    response.statusCode = 404;
    response.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const quick = { wait: 1 };

test('a busy address is asked again, and gives the file on its third try', async () => {
  const said = [];
  assert.deepEqual(await fetchChecked(`${base}/busy`, SHA256, 'the file', { ...quick, log: line => said.push(line) }), FILE);
  assert.equal(asked.get('/busy'), 3);
  assert.equal(said.length, 2);
  assert.match(said[0], /\/busy failed \(it answered 503\)/);
});

test('an address without the file is asked once, and the next one gives it', async () => {
  assert.deepEqual(await fetchChecked([`${base}/gone`, `${base}/file`], SHA256, 'the file', quick), FILE);
  assert.equal(asked.get('/gone'), 1);
});

test('bytes of another hash are never used, and the next address is asked', async () => {
  assert.deepEqual(await fetchChecked([`${base}/other`, `${base}/file`], SHA256, 'the file', quick), FILE);
  assert.equal(asked.get('/other'), 1);
});

test('when no address gives it, the error says which failed and why', async () => {
  // a port nothing listens on any more
  const gone = createServer();
  await new Promise(done => gone.listen(0, '127.0.0.1', done));
  const closed = `http://127.0.0.1:${gone.address().port}/file`;
  await new Promise(done => gone.close(done));
  await assert.rejects(fetchChecked([`${base}/missing`, `${base}/other`, closed], SHA256, 'the file', quick), error => {
    assert.match(error.message, /^The file couldn't be got\./);
    assert.match(error.message, /\/missing: it answered 404/);
    assert.match(error.message, /\/other: it gave other bytes than the file as the tools know it/);
    assert.match(error.message, new RegExp(`${closed.replace(/[./]/g, '\\$&')}, 3 times: ECONNREFUSED`));
    return true;
  });
});
