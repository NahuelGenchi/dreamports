// npm run dp -- ready <game>: everything a step has to pass before it goes out, in one go: the port map, every
// recording, `npm run check` and `npm run build`. It prints what prove found and, of the rest, only what's wrong, with
// the whole of it kept in .dreamports/ready/, as their full output costs an agent thousands of tokens on every request after it.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, LOCAL } from './lib/paths.mjs';

const KEPT_LINES = 30;

const npm = script => (process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath, 'run', script]] : ['npm', ['run', script], { shell: process.platform === 'win32' }]);
const tool = (...args) => [process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args]];

export async function run(args) {
  const [game] = args;
  if (!game) throw new Error('Usage: npm run dp -- ready <game>');
  const folder = join(LOCAL, 'ready');
  mkdirSync(folder, { recursive: true });
  const failed = [];
  const step = (name, [program, list, options = {}]) => {
    const { status, stdout, stderr } = spawnSync(program, list, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28, ...options });
    const log = join(folder, `${name.replaceAll(' ', '-')}.log`);
    writeFileSync(log, `${stdout}\n${stderr}`);
    if (status === 0) return console.log(`${name}: passed.`);
    failed.push(name);
    const lines = `${stdout}\n${stderr}`.trimEnd().split('\n');
    console.log(`${name}: failed. Its last ${Math.min(lines.length, KEPT_LINES)} lines, of ${lines.length} kept in .dreamports/ready/:\n${lines.slice(-KEPT_LINES).join('\n')}`);
  };
  step('port map', tool('portmap', game));
  // what every recording did is the point, so it shows in full, and frames that differ fail the step
  const proved = spawnSync(...tool('prove', game), { cwd: REPO, stdio: 'inherit' });
  if (proved.status !== 0) failed.push('prove');
  step('check', npm('check'));
  step('build', npm('build'));
  console.log(failed.length ? `Not ready: ${failed.join(', ')}.` : 'Ready.');
  return failed.length ? 1 : 0;
}
