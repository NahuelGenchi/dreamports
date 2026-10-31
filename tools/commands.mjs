// npm run dp -- commands [--check]: writes the /dreamport commands, each written once in tools/commands/<name>.md, in
// the form each coding agent reads: .claude/skills/ for Claude Code, .agents/skills/ for Codex (which Cursor and
// Antigravity CLI read too) and .gemini/commands/ for Gemini CLI. Every copy runs only when the person types it, and
// starts by saying so, for the agents that might load it by themselves. With --check it changes nothing and fails
// when a copy differs from its source, which `npm run check` uses.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { REPO } from './lib/paths.mjs';

const SOURCES = join(REPO, 'tools', 'commands');
const NAME = /^dreamport(?:-[a-z]+)*$/;

export async function run(args) {
  const check = args.includes('--check');
  const commands = readCommands();
  const wanted = new Map(commands.flatMap(copiesOf).map(({ path, text }) => [path, text]));
  const stale = existing().filter(path => !wanted.has(path));
  const changed = [...wanted].filter(([path, text]) => !existsSync(join(REPO, path)) || readFileSync(join(REPO, path), 'utf8') !== text).map(([path]) => path);

  if (check) {
    if (changed.length || stale.length) {
      throw new Error(`The /dreamport commands' copies don't match tools/commands/: npm run dp -- commands writes them again.\n${[...changed, ...stale].map(p => `  ${p}`).join('\n')}`);
    }
    console.log(`The ${commands.length} /dreamport commands' copies match tools/commands/.`);
    return 0;
  }
  for (const path of changed) {
    mkdirSync(dirname(join(REPO, path)), { recursive: true });
    writeFileSync(join(REPO, path), wanted.get(path));
  }
  // a command's copies go when its source does
  for (const path of stale) rmSync(join(REPO, path));
  for (const folder of [join(REPO, '.claude', 'skills'), join(REPO, '.agents', 'skills')]) {
    for (const name of listed(folder)) removeIfEmpty(join(folder, name));
  }
  console.log(changed.length || stale.length
    ? `Written: ${changed.length} ${changed.length === 1 ? 'copy' : 'copies'} of the ${commands.length} /dreamport commands${stale.length ? `, and ${stale.length} old ${stale.length === 1 ? 'one' : 'ones'} removed` : ''}.`
    : `The ${commands.length} /dreamport commands' copies were already up to date.`);
  return 0;
}

/** Each source in tools/commands/: { name, description, argument, body }. */
function readCommands() {
  return listed(SOURCES).filter(f => f.endsWith('.md')).sort().map(file => {
    const where = `tools/commands/${file}`;
    const text = readFileSync(join(SOURCES, file), 'utf8');
    const found = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text);
    if (!found) throw new Error(`${where} needs its name and description between two --- lines at its top.`);
    const { name, description, argument, ...other } = parse(found[1]) ?? {};
    const body = found[2].trimEnd();
    if (Object.keys(other).length) throw new Error(`${where} has fields commands doesn't know: ${Object.keys(other).join(', ')}.`);
    if (name !== file.slice(0, -3) || !NAME.test(name)) throw new Error(`${where}'s name has to be its file's name, starting with dreamport, such as dreamport-play.`);
    if (typeof description !== 'string' || !description.trim() || description.length > 200) throw new Error(`${where} needs a description of one short sentence.`);
    // Gemini CLI reads {{…}}, !{…} and @{…} in a prompt as its own, and its prompt is a ''' string
    if (/\{\{|[!@]\{|'''/.test(body)) throw new Error(`${where} can't hold {{, !{, @{ or ''', which Gemini CLI would read as its own.`);
    if (/\u2014/.test(text)) throw new Error(`${where} has an em dash: the repository's writing doesn't use them.`);
    return { name, description: description.trim(), argument, body };
  });
}

/** What every copy says first: that it runs only when typed, and what was typed after it. */
function opening(name, typed, after, codex = false) {
  return [
    `<!-- Written by npm run dp -- commands from tools/commands/${name}.md: change that file, not this one. -->`,
    '',
    `Only do this if the person typed ${typed} in their message. If you're reading it because of something they said in their own words, such as "send it" or "put it online", stop here and do none of it: tell them in one sentence what \`/${name}\` does, and wait for them to type it.`,
    '',
    after,
    '',
    'Work in the Dreamports repository\'s folder, as its `AGENTS.md` says under Working on a Dreamport. The person may never have written code: speak plainly, one step at a time, and ask only what they have to decide.'
      + (codex ? ' In Codex the commands start with `$` instead of `/`, such as `$dreamport-play`.' : ''),
    '',
    '',
  ].join('\n');
}

function frontmatter(fields) {
  return `---\n${stringify(fields, { lineWidth: 0 })}---\n\n`;
}

/** The files one command becomes: [{ path, text }], with paths from the repository's folder. */
function copiesOf({ name, description, argument, body }) {
  const after = placeholder => `What they typed after the command, if anything: ${placeholder}`;
  return [
    {
      path: `.claude/skills/${name}/SKILL.md`,
      text: frontmatter({ name, description, ...(argument ? { 'argument-hint': argument } : {}), 'disable-model-invocation': true })
        + opening(name, `\`/${name}\``, after('$ARGUMENTS')) + body + '\n',
    },
    {
      // Codex reads only name and description; Cursor, which reads this folder too, honours disable-model-invocation
      path: `.agents/skills/${name}/SKILL.md`,
      text: frontmatter({ name, description, 'disable-model-invocation': true })
        + opening(name, `\`/${name}\`, or \`$${name}\` in Codex,`, 'What they typed after the command, if anything, is in their message.', true) + body + '\n',
    },
    {
      path: `.agents/skills/${name}/agents/openai.yaml`,
      text: `# Written by npm run dp -- commands from tools/commands/${name}.md. Codex runs the command only when it's typed.\npolicy:\n  allow_implicit_invocation: false\n`,
    },
    {
      path: `.gemini/commands/${name}.toml`,
      text: `# Written by npm run dp -- commands from tools/commands/${name}.md: change that file, not this one.\n`
        + `description = ${JSON.stringify(description)}\n`
        + `prompt = '''\n${opening(name, `\`/${name}\``, after('{{args}}')).replace(/^<!--.*-->\n\n/, '')}${body}\n'''\n`,
    },
  ];
}

/** The copies already there, of any /dreamport command: paths from the repository's folder. */
function existing() {
  const found = [];
  for (const top of ['.claude/skills', '.agents/skills']) {
    for (const name of listed(join(REPO, top)).filter(n => NAME.test(n))) found.push(...filesIn(join(REPO, top, name)));
  }
  found.push(...listed(join(REPO, '.gemini', 'commands')).filter(f => NAME.test(f.replace(/\.toml$/, ''))).map(f => join(REPO, '.gemini', 'commands', f)));
  return found.map(path => relative(REPO, path).split('\\').join('/'));
}

function filesIn(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(folder, e.name)) : [join(folder, e.name)]);
}

function listed(folder) {
  return existsSync(folder) ? readdirSync(folder) : [];
}

function removeIfEmpty(folder) {
  if (!existsSync(folder) || !readdirSync(folder, { withFileTypes: true }).every(e => e.isDirectory())) return;
  for (const name of readdirSync(folder)) removeIfEmpty(join(folder, name));
  if (!readdirSync(folder).length) rmSync(folder, { recursive: true });
}
