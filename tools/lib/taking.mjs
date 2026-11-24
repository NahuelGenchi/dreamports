// Which session on this computer makes which task, and in which folder (#1863). Claims tell people apart, not
// sessions: someone who starts /dreamport twice at once is one GitHub user both times, so `find --take` handed both
// the same task, the bot told each it was theirs, and in one folder they wrote the same files on the same branch.
//
// So `find --take` leaves a note for the folder it runs in, in git's own folder, which every worktree of a clone
// shares and no commit takes: the task it handed out, and the processes above it, of which the first still running
// is the session's. A note counts while that process runs, while the tools have run in its folder within the hour
// (tools/dp.mjs marks each run), and until its task is in review or closed. Where the processes can't be listed, or
// none above a session outlives its commands, no note counts and the tools answer as they did before.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { LOCAL, REPO } from './paths.mjs';

/** How long a note counts with no tool run in its folder, in milliseconds. */
export const QUIET = 60 * 60 * 1000;

/** Every process on this computer: a Map from its number to { parent, started }, empty when they can't be listed. */
export function processes() {
  const all = new Map(), windows = process.platform === 'win32';
  try {
    const out = windows
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToUniversalTime().Ticks)" }'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 })
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, env: { ...process.env, LC_ALL: 'C' } });
    for (const line of out.split('\n')) {
      const found = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
      if (!found) continue;
      // .NET counts in ticks of 100 nanoseconds from the year 1, past what a number holds exactly
      const started = windows ? (/^\d+$/.test(found[3]) ? Number((BigInt(found[3]) - 621355968000000000n) / 10000n) : NaN) : Date.parse(found[3]);
      if (Number.isFinite(started)) all.set(Number(found[1]), { parent: Number(found[2]), started });
    }
  } catch {
    // none listed: no note counts
  }
  return all;
}

/** The processes above `pid`, nearest first, each { pid, started }. */
export function chainOf(all, pid) {
  const chain = [], seen = new Set([pid]);
  for (let at = all.get(pid); at && all.has(at.parent) && !seen.has(at.parent);) {
    const parent = all.get(at.parent);
    // a parent's number that a younger process has since been given isn't its parent
    if (parent.started > at.started + 1000) break;
    chain.push({ pid: at.parent, started: parent.started });
    seen.add(at.parent);
    at = parent;
  }
  return chain;
}

/**
 * The processes above this one, with the session's own when the agent `named` it and the chain doesn't reach it:
 * Claude Code gives its number in CLAUDE_PID, and in Git Bash on Windows a wrapper such as `timeout` runs a command
 * under a process that has ended by the time it's looked for, which cuts the chain short.
 */
export function above(all, pid = process.pid, named = Number(process.env.CLAUDE_PID)) {
  const chain = chainOf(all, pid);
  if (!all.has(named) || chain.some(process => process.pid === named)) return chain;
  return [...chain, { pid: named, started: all.get(named).started }, ...chainOf(all, named)];
}

/**
 * Whose a note is: 'mine' when the first process of its chain still running is above this one too, 'other' when it
 * isn't, and 'gone' when the note no longer counts.
 */
export function whose(note, { all, mine, now = Date.now(), over = () => false }) {
  if (now - note.at > QUIET || over(note.repository, note.number)) return 'gone';
  const running = (note.chain ?? []).find(above => all.get(above.pid)?.started === above.started);
  if (!running) return 'gone';
  return mine.some(above => above.pid === running.pid && above.started === running.started) ? 'mine' : 'other';
}

// where the notes are kept: git's own folder, which a clone's worktrees share
function notesFolder() {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return join(isAbsolute(dir) ? dir : resolve(REPO, dir), 'dreamports-taking');
  } catch {
    return join(LOCAL, 'taking');
  }
}

const sameFolder = folder => (process.platform === 'win32' ? resolve(folder).toLowerCase() : resolve(folder));
const folderFile = (dir, folder) => join(dir, `folder-${createHash('sha1').update(sameFolder(folder)).digest('hex').slice(0, 16)}.json`);
const taskFile = (dir, repository, number) => join(dir, `task-${repository.replace(/[^\w.-]+/g, '-')}-${number}.json`);
const read = file => {
  try {
    return { ...JSON.parse(readFileSync(file, 'utf8')), at: statSync(file).mtimeMs };
  } catch {
    return null;
  }
};
// written only if no file is there, so of two that write at once one is told
const writeNew = (file, value) => {
  try {
    writeFileSync(file, JSON.stringify(value), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
};

/**
 * The sessions making tasks on this computer, as the one in `folder` sees them. `over(repository, number)` says a
 * task is in review or closed, so its note no longer counts.
 *
 * Returns { here, busy, take }: `here()` is the task number another live session makes in this very folder, or null;
 * `busy(repository)` the numbers other live sessions make; and `take(repository, number)` leaves this session's note
 * for a task, or answers false when another session got there first.
 */
export function sessions({ dir = notesFolder(), folder = REPO, all = processes(), mine = above(all), now, over } = {}) {
  const how = { all, mine, now, over };
  const notes = () => (existsSync(dir) ? readdirSync(dir) : []).filter(name => name.startsWith('folder-')).map(name => read(join(dir, name))).filter(Boolean);
  const others = () => notes().filter(note => whose(note, how) === 'other');
  const own = folderFile(dir, folder);
  const inFolder = () => {
    const note = read(own);
    return note && whose(note, how) === 'other' ? note : null;
  };
  return {
    here: () => inFolder()?.number ?? null,
    busy: repository => new Set(others().filter(note => note.repository === repository).map(note => note.number)),
    take(repository, number) {
      // without the session's process a note would count for nobody, so none is left
      if (!mine.length) return true;
      mkdirSync(dir, { recursive: true });
      // the task first: of two sessions handed it at once, one writes its file
      const file = taskFile(dir, repository, number), holder = read(file);
      const theirs = holder && others().find(note => sameFolder(note.folder) === sameFolder(holder.folder) && note.repository === repository && note.number === number);
      if (theirs && sameFolder(theirs.folder) !== sameFolder(folder)) return false;
      if (holder) rmSync(file, { force: true });
      if (!writeNew(file, { folder })) return false;
      // then the folder, which holds one session at a time
      if (inFolder()) return false;
      rmSync(own, { force: true });
      if (!writeNew(own, { folder, repository, number, chain: mine })) return false;
      // task files nobody's note names any more
      const named = new Set(notes().map(note => taskFile(dir, note.repository, note.number)));
      for (const name of readdirSync(dir)) if (name.startsWith('task-') && !named.has(join(dir, name))) rmSync(join(dir, name), { force: true });
      return true;
    },
  };
}

/** Marks that the tools ran in this folder now, which keeps its session's note counting. */
export function stillHere() {
  try {
    const file = folderFile(notesFolder(), REPO);
    if (existsSync(file)) utimesSync(file, new Date(), new Date());
  } catch {
    // nothing to mark
  }
}
