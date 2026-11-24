// Which session on this computer makes which task (lib/taking.mjs), with made-up processes and folders.
// Run with: node --test tools/test/taking.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { LOCAL } from '../lib/paths.mjs';
import { QUIET, above, chainOf, processes, sessions, whose } from '../lib/taking.mjs';
import { whatToTake } from '../lib/take.mjs';

const REPOSITORY = 'someone/dreamports';
// an app with two sessions, each with a shell that runs one tool, as a coding agent's app has them
const computer = () => new Map([
  [1, { parent: 0, started: 1000 }], [10, { parent: 1, started: 2000 }],
  [20, { parent: 10, started: 3000 }], [21, { parent: 20, started: 4000 }], [22, { parent: 21, started: 5000 }],
  [30, { parent: 10, started: 3500 }], [31, { parent: 30, started: 4500 }], [32, { parent: 31, started: 5500 }],
]);
// the same computer once a tool and its shell have ended, and a session has started another
const later = (all, ended, started) => {
  const next = new Map(all);
  for (const pid of ended) next.delete(pid);
  for (const [pid, parent] of started) next.set(pid, { parent, started: 9000 + pid });
  return next;
};
const folders = () => {
  mkdirSync(join(LOCAL, 'tmp'), { recursive: true });
  const root = mkdtempSync(join(LOCAL, 'tmp', 'taking-'));
  return { root, dir: join(root, 'notes'), one: join(root, 'one'), two: join(root, 'two') };
};
const seen = (all, pid, dir, folder, more = {}) => sessions({ dir, folder, all, mine: chainOf(all, pid), ...more });

test('the processes above one, nearest first, and never a younger one with its parent\'s number', () => {
  const all = computer();
  assert.deepEqual(chainOf(all, 22).map(above => above.pid), [21, 20, 10, 1]);
  all.set(21, { parent: 20, started: 99999 });
  assert.deepEqual(chainOf(all, 22), []);
});

test('a chain cut short still reaches the session the agent named', () => {
  const all = computer();
  assert.deepEqual(above(all, 22, 20).map(process => process.pid), [21, 20, 10, 1]);
  // the tool's parent has ended, as under Git Bash's timeout
  all.delete(21);
  assert.deepEqual(above(all, 22, NaN), []);
  assert.deepEqual(above(all, 22, 20).map(process => process.pid), [20, 10, 1]);
  assert.deepEqual(above(all, 22, 777), []);
});

test('this computer\'s processes can be listed, with this one\'s parent', () => {
  const all = processes();
  assert.ok(all.has(process.pid) && chainOf(all, process.pid).some(above => above.pid === process.ppid));
});

test('a second session in another folder is handed the next task, and the first gets its own back', () => {
  const { root, dir, one, two } = folders();
  try {
    const all = computer();
    const first = seen(all, 22, dir, one);
    assert.equal(first.here(), null);
    assert.deepEqual([...first.busy(REPOSITORY)], []);
    assert.equal(first.take(REPOSITORY, 7), true);

    const second = seen(all, 32, dir, two);
    assert.equal(second.here(), null);
    assert.deepEqual([...second.busy(REPOSITORY)], [7]);
    assert.equal(second.take(REPOSITORY, 7), false, 'handed the same one at once, it is told');
    assert.equal(second.take(REPOSITORY, 8), true);
    assert.deepEqual([...second.busy('another/copy')], []);

    // the first session's tool and shell have ended, and it asks again from a new one
    const now = later(all, [22, 21, 32, 31], [[41, 20], [42, 41]]);
    const again = seen(now, 42, dir, one);
    assert.equal(again.here(), null);
    assert.deepEqual([...again.busy(REPOSITORY)], [8]);
    assert.equal(again.take(REPOSITORY, 7), true);
    assert.equal(readdirSync(dir).filter(name => name.startsWith('task-')).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second session in the same folder is told the folder is in use, and takes nothing', () => {
  const { root, dir, one } = folders();
  try {
    const all = computer();
    assert.equal(seen(all, 22, dir, one).take(REPOSITORY, 7), true);
    const second = seen(all, 32, dir, one);
    assert.equal(second.here(), 7);
    assert.equal(second.take(REPOSITORY, 8), false);
    assert.equal(second.here(), 7);
    assert.equal(seen(all, 22, dir, one).here(), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a note stops counting when its session ends, goes quiet for an hour, or its task is in review', () => {
  const { root, dir, one, two } = folders();
  try {
    const all = computer();
    assert.equal(seen(all, 22, dir, one).take(REPOSITORY, 7), true);
    // ended: what's left of its chain is the app, which is above every session
    const ended = later(all, [22, 21, 20], []);
    assert.deepEqual([...seen(ended, 32, dir, two).busy(REPOSITORY)], []);
    assert.equal(seen(ended, 32, dir, one).here(), null);
    assert.equal(seen(ended, 32, dir, two).take(REPOSITORY, 7), true);

    // in review or closed
    assert.deepEqual([...seen(all, 22, dir, one, { over: (repository, number) => repository === REPOSITORY && number === 7 }).busy(REPOSITORY)], []);

    // quiet
    const other = seen(all, 22, dir, one);
    assert.deepEqual([...other.busy(REPOSITORY)], [7]);
    assert.deepEqual([...seen(all, 22, dir, one, { now: Date.now() + QUIET + 1000 }).busy(REPOSITORY)], []);
    const old = new Date(Date.now() - QUIET - 1000);
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old);
    assert.deepEqual([...other.busy(REPOSITORY)], []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// a stand-in for a session: a process that stays until told to end, and runs each line it's given as a tool of its
// own, which asks for a task and prints what it was told
const SESSION = `
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  if (line === 'end') break;
  console.log(spawnSync(process.execPath, ['--input-type=module', '-e', TOOL, line], { encoding: 'utf8' }).stdout.trim());
}
process.exit();
`;
const TOOL = `
import { sessions } from ${JSON.stringify(new URL('../lib/taking.mjs', import.meta.url).href)};
const [dir, folder, number] = JSON.parse(process.argv[1]);
const seen = sessions({ dir, folder });
console.log(JSON.stringify({ here: seen.here(), busy: [...seen.busy('${REPOSITORY}')].sort(), took: seen.take('${REPOSITORY}', number) }));
`;
const session = () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', SESSION.replace('TOOL', JSON.stringify(TOOL))], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    ask: async (...given) => {
      child.stdin.write(`${JSON.stringify(given)}\n`);
      return JSON.parse((await lines.next()).value);
    },
    end: () => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.stdin.end('end\n');
    }),
  };
};

test('two real sessions on this computer, each a process of its own', async () => {
  const { root, dir, one, two } = folders();
  const first = session(), second = session(), third = session();
  try {
    assert.deepEqual(await first.ask(dir, one, 7), { here: null, busy: [], took: true });
    assert.deepEqual(await second.ask(dir, two, 7), { here: null, busy: [7], took: false });
    assert.deepEqual(await second.ask(dir, two, 8), { here: null, busy: [7], took: true });
    assert.deepEqual(await third.ask(dir, one, 9), { here: 7, busy: [7, 8], took: false });
    assert.deepEqual(await first.ask(dir, one, 7), { here: null, busy: [8], took: true });
    await first.end();
    assert.deepEqual(await third.ask(dir, one, 7), { here: null, busy: [8], took: true });
  } finally {
    await Promise.all([first.end(), second.end(), third.end()]);
    rmSync(root, { recursive: true, force: true });
  }
});

test('where no process above a session can be told, nothing is kept and nothing counts', () => {
  const { root, dir, one, two } = folders();
  try {
    const none = sessions({ dir, folder: one, all: new Map(), mine: [] });
    assert.equal(none.take(REPOSITORY, 7), true);
    assert.deepEqual([...sessions({ dir, folder: two, all: new Map(), mine: [] }).busy(REPOSITORY)], []);
    assert.equal(whose({ at: Date.now(), chain: [{ pid: 20, started: 3000 }] }, { all: new Map(), mine: [] }), 'gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a task another session makes is neither theirs nor free, whatever its claim says', () => {
  const task = (number, name, by = []) => ({ number, title: `Task: ${name} in C`, state: 'open', assignees: by.map(login => ({ login })) });
  const mine = task(7, 'The logos', ['sam']), free = task(8, 'Title screen'), next = task(9, 'The Options menu');
  const ask = (busy, more = {}) => whatToTake({ pieces: [mine, free, next], free: [free, next], waiting: [], reviewing: new Map(), login: 'sam', language: 'c', has: () => true, missing: () => 0, busy, ...more });
  assert.deepEqual([ask(new Set()).do, ask(new Set()).piece], ['carry-on', mine]);
  const found = ask(new Set([7, 8]));
  assert.deepEqual([found.do, found.piece], ['take', next]);
  assert.match(found.notes[0], /#7 .*, #8 .* are being made by another session on this computer/);
  const named = ask(new Set([7]), { named: '#7' });
  assert.deepEqual([named.do, named.piece], ['take', free]);
  assert.equal(ask(new Set([7, 8, 9])).do, 'stop');
});
