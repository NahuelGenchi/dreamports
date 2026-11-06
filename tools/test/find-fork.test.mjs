// Tests of how share, team and capture find the contributor's fork (findFork), on a made-up GitHub.
// npm run check runs them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFork, UPSTREAM } from '../lib/github.mjs';

const upstream = { full_name: UPSTREAM, name: 'dreamports', fork: false, owner: { login: 'NahuelGenchi' } };
const forkBy = (owner, push = true) => ({
  full_name: `${owner}/dreamports`, name: 'dreamports', fork: true, parent: { full_name: UPSTREAM },
  owner: { login: owner }, permissions: { push }, clone_url: `https://github.com/${owner}/dreamports.git`,
});
const remote = (name, repository) => ({ name, url: `https://github.com/${repository}.git` });

/** A made-up GitHub with these repositories, the upstream's forks and who is signed in, keeping the remotes added. */
function github({ repositories = [], forks = [], login = 'someone', canPush = false } = {}) {
  const all = new Map([[UPSTREAM.toLowerCase(), { ...upstream, permissions: { push: canPush } }], ...repositories.map(r => [r.full_name.toLowerCase(), r])]);
  const added = [];
  return {
    added,
    repository: name => all.get(name.toLowerCase()) ?? null,
    forks: () => forks,
    login: () => login,
    addRemote: (name, url) => added.push({ name, url }),
  };
}

test('a remote that is the fork is found as before, and nothing is added', () => {
  const mine = forkBy('someone');
  const gh = github({ repositories: [mine], forks: [mine] });
  const found = findFork([remote('origin', UPSTREAM), remote('fork', mine.full_name)], undefined, gh);
  assert.deepEqual(found, { remote: 'fork', repository: 'someone/dreamports', owner: 'someone', name: 'dreamports' });
  assert.deepEqual(gh.added, []);
});

test('a folder whose only remote is the repository itself finds an organization fork on GitHub and adds it', () => {
  const org = forkBy('dreamports');
  const gh = github({ forks: [org], login: 'NahuelGenchi', canPush: true });
  const found = findFork([remote('origin', UPSTREAM)], undefined, gh);
  assert.equal(found.repository, 'dreamports/dreamports');
  assert.equal(found.remote, 'fork');
  assert.deepEqual(gh.added, [{ name: 'fork', url: 'https://github.com/dreamports/dreamports.git' }]);
});

test('their own fork comes before an organization one, and forks they can only read are left out', () => {
  const gh = github({ forks: [forkBy('stranger'), forkBy('a-team', false), forkBy('an-org'), forkBy('someone')] });
  assert.equal(findFork([remote('origin', UPSTREAM)], undefined, gh).repository, 'someone/dreamports');
});

test('the remote it adds takes a name no remote has', () => {
  const gh = github({ forks: [forkBy('someone')] });
  const found = findFork([remote('origin', UPSTREAM), remote('fork', 'someone-else/other'), remote('fork-2', 'x/y')], undefined, gh);
  assert.equal(found.remote, 'fork-3');
  assert.equal(gh.added[0].name, 'fork-3');
});

test('a fork named with --fork is found on GitHub too', () => {
  const gh = github({ forks: [forkBy('someone'), forkBy('an-org')] });
  assert.equal(findFork([remote('origin', UPSTREAM)], 'an-org/dreamports', gh).repository, 'an-org/dreamports');
  assert.throws(() => findFork([remote('origin', UPSTREAM)], 'nobody/dreamports', github()), /nobody\/dreamports isn't a fork/);
});

test('with no fork anywhere, the message says what to run: a fork for anyone, an organization fork for who can push to the repository', () => {
  assert.throws(() => findFork([remote('origin', UPSTREAM)], undefined, github()), /gh repo fork --remote,/);
  assert.throws(() => findFork([remote('origin', UPSTREAM)], undefined, github({ canPush: true })), /only lets you fork it to an organization.*--org/);
});
