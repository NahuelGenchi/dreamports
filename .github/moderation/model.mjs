// The Dreamports bot's model (docs/MODERATION.md): OpenCode's free models, asked through a pinned OpenCode run in a
// process of its own, with an empty home, no token and every tool refused. Each gets the post as data between
// markers, and an answer counts only if it's one key from the fixed list. Nothing here logs a post or an answer.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAnswer } from './verdicts.mjs';

export const PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');
export const DEFAULT_MODELS = 'deepseek-v4.1-flash-free,glm-5.3-flash-free';

// OpenCode 2.0.29 for Linux on x64, from npm, which runs only if its archive has this SHA-256
const OPENCODE = {
  version: '2.0.29',
  archive: 'https://registry.npmjs.org/@opencode/cli-linux-x64/-/cli-linux-x64-2.0.29.tgz',
  sha256: '14b5a6638a1a093ac9d484599c844b10c29b445d04844b682ccc668ce26530a2'
};
// OpenCode's config: no sharing, no updates, no snapshots, and one agent with the rules as its only instructions and
// every tool refused. read is set to ask rather than refused, since OpenCode's free models refuse a request that
// offers no tool at all, and a run with nobody to ask refuses every read before it happens. Two steps leave room for
// an answer after a refused read; with one, OpenCode adds a note about its last step that confuses some models.
const permission = { '*': 'deny', read: 'ask' };
export const CONFIG = {
  share: 'disabled', update: 'disable', snapshots: false, permission,
  agent: { judge: { mode: 'primary', description: 'Checks one post against the Dreamports rules', steps: 2, prompt: PROMPT, permission } }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MINUTE = 60000;
const LIMIT = 16000;
const KIND_WORDS = {
  issue: 'a new issue', 'pull-request': 'a pull request\'s title and description', 'issue-comment': 'a comment',
  'review-comment': 'a comment on a pull request\'s code', review: 'a review of a pull request', discussion: 'a new thread',
  'discussion-comment': 'a comment'
};
const WHERE_WORDS = {
  issue: 'an issue', 'pull-request': 'a pull request, where clips of the original may appear', discussion: 'Discussions',
  'progress-thread': 'a game\'s Progress thread, where clips of the original may appear'
};
const HINT_WORDS = {
  attachment: 'an attached file', 'picture-and-original': 'a picture or video and the word original',
  'spam-words': 'words spam uses', mentions: 'many people mentioned', 'getting-games': 'words about getting games',
  'file-hosts': 'a file-sharing site or a torrent', piracy: 'words about piracy', abuse: 'insulting words',
  'talks-to-the-bot': 'words that talk to the bot', 'private-details': 'words about private details',
  secret: 'something like a password', rights: 'words about rights or taking something down'
};
const hintWords = hint => hint.startsWith('link:') ? `a link to ${hint.slice(5)}`
  : hint.startsWith('rom-path:') ? `a link about ROMs on ${hint.slice(9)}` : HINT_WORDS[hint] ?? hint;

// What a model gets: what and where the post is, what the plain rules noticed, and the post between markers, cut to
// its start and end when it's long, with each @ written another way, since OpenCode reads @ as a file to attach.
export function messageFor(post) {
  let text = String(post.text ?? '');
  if (text.length > LIMIT) text = `${text.slice(0, 12000)}\n[...]\n${text.slice(-4000)}`;
  text = text.replace(/<<<POST|POST>>>/g, '').replace(/@/g, '＠');
  return [
    'Check this post against the rules, and answer with one key alone.',
    `It's ${KIND_WORDS[post.kind] ?? 'a post'}, in ${WHERE_WORDS[post.where] ?? 'the repository'}.`,
    `Its author's own previews are at ${String(post.author).toLowerCase()}.github.io.`,
    `The plain rules noticed: ${(post.hints ?? []).map(hintWords).join('; ') || 'nothing'}.`,
    '<<<POST', text, 'POST>>>'
  ].join('\n');
}

// the free models to ask, in order: those of the setting, MODERATION_MODELS, that OpenCode lists now, and never one
// whose id doesn't end in -free. If the list can't be read, they're tried anyway.
export async function openCodeModels(setting) {
  const wanted = String(setting || DEFAULT_MODELS).split(/[\s,]+/).filter(Boolean);
  for (const id of wanted.filter(id => !/^[a-z0-9][a-z0-9._-]*-free$/.test(id))) console.log(`Refused the model "${id}": only OpenCode's free models, whose ids end in -free, are used.`);
  const free = wanted.filter(id => /^[a-z0-9][a-z0-9._-]*-free$/.test(id));
  try {
    const response = await fetch('https://opencode.ai/zen/v1/models', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const listed = new Set((await response.json()).data.map(model => model.id));
    for (const id of free.filter(id => !listed.has(id))) console.log(`OpenCode doesn't list ${id} now.`);
    return free.filter(id => listed.has(id));
  } catch (error) {
    console.log(`OpenCode's list of models couldn't be read (${error.message}), so each is tried anyway.`);
    return free;
  }
}

// OpenCode itself, downloaded once per job and checked against its SHA-256 before it runs
async function install() {
  const folder = join(process.env.RUNNER_TEMP ?? tmpdir(), `opencode-${OPENCODE.version}`);
  const bin = join(folder, 'package', 'bin', 'opencode');
  if (existsSync(bin)) return bin;
  const response = await fetch(OPENCODE.archive, { signal: AbortSignal.timeout(5 * MINUTE) });
  if (!response.ok) throw new Error(`OpenCode's archive: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(archive).digest('hex');
  if (sha256 !== OPENCODE.sha256) throw new Error(`OpenCode's archive has the SHA-256 ${sha256}, not ${OPENCODE.sha256}, so it isn't run.`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'opencode.tgz'), archive);
  execFileSync('tar', ['-xzf', join(folder, 'opencode.tgz'), '-C', folder, 'package/bin/opencode']);
  return bin;
}

// One run of OpenCode, in an empty folder of its own, with a home of its own and only the variables it needs, none of
// them a token. Its input is closed, since OpenCode waits for its input to end, and the whole process group stops
// when it's done or after the timeout.
function runOpenCode(bin, model, message, timeout) {
  const folder = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'opencode-run-'));
  const at = (...path) => join(folder, ...path);
  for (const path of ['home', 'work', 'tmp', 'config']) mkdirSync(at(path));
  writeFileSync(at('config', 'opencode.json'), JSON.stringify(CONFIG));
  const env = {
    HOME: at('home'), XDG_CONFIG_HOME: at('home', '.config'), XDG_DATA_HOME: at('home', '.local', 'share'),
    XDG_CACHE_HOME: at('home', '.cache'), XDG_STATE_HOME: at('home', '.local', 'state'), TMPDIR: at('tmp'),
    PATH: '/usr/bin:/bin', OPENCODE_CONFIG: at('config', 'opencode.json')
  };
  return new Promise(resolve => {
    let out = '', err = '', timedOut = false, finished = false;
    const child = spawn(bin, ['run', '--standalone', '--agent', 'judge', '-m', `opencode/${model}`, '--format', 'json', message], {
      cwd: at('work'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true
    });
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    child.stdout.on('data', chunk => { if (out.length < 1000000) out += chunk; });
    child.stderr.on('data', chunk => { if (err.length < 1000000) err += chunk; });
    const done = code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stop();
      rmSync(folder, { recursive: true, force: true });
      resolve({ code, out, err, timedOut });
    };
    child.on('error', () => done(null));
    child.on('close', done);
  });
}

// the text OpenCode answered with, from its JSON events, or null when it answered nothing
function textOf(out) {
  const texts = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && typeof event.part?.text === 'string') texts.push(event.part.text);
    } catch {
      // not an event
    }
  }
  return texts.length ? texts.join('\n') : null;
}
// errors worth one more try after a pause, and OpenCode's "Free usage limit reached", which isn't: its free models
// answer that to a request they refuse, such as one that offers no tool
const RETRY = /unavailable|overloaded|timed? ?out|ECONNRESET|fetch failed|"status":\s*(?:50[234]|529)\b/i;
const QUOTA = /FreeUsageLimitError|"type":\s*"provider\.quota"/;

// Asks OpenCode's free models in order, each twice when it fails for a moment. Once every model fails without any
// answer, it stops asking for the rest of the job, and so it does after the time it's given.
export function openCodeAsker(setting, { timeout = 90000, budget = 15 * MINUTE } = {}) {
  const started = Date.now();
  const tried = new Set();
  let models, bin, down = false;
  return {
    tried,
    async ask(post) {
      if (down || Date.now() - started > budget) return null;
      models ??= await openCodeModels(setting);
      try {
        bin ??= await install();
      } catch (error) {
        console.log(`OpenCode couldn't be installed: ${error.message}`);
        down = true;
      }
      if (down || !models.length) {
        down = true;
        return null;
      }
      const message = messageFor(post);
      let silent = 0;
      for (const model of models) {
        tried.add(`opencode/${model}`);
        for (let attempt = 1; attempt <= 2; attempt++) {
          const run = await runOpenCode(bin, model, message, timeout);
          const text = textOf(run.out);
          const key = parseAnswer(text);
          if (key) return { key, model: `opencode/${model}` };
          const why = run.timedOut ? 'it timed out' : text !== null ? 'its answer wasn\'t a key'
            : QUOTA.test(run.out) ? 'OpenCode refused it with "Free usage limit reached"' : `it answered nothing (exit code ${run.code})`;
          console.log(`opencode/${model}: no verdict, since ${why}.`);
          if (text !== null) break;
          if (attempt === 2 || QUOTA.test(run.out) || !(run.timedOut || RETRY.test(run.out + run.err))) {
            silent++;
            break;
          }
          await sleep(10000);
        }
      }
      if (silent === models.length) down = true;
      return null;
    }
  };
}
