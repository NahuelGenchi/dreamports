// The text of a step's pull request, with everything the tools already know filled in: its tracking lines, its clips,
// its two numbers before and after, the notes it adds and its preview (tools/share.mjs). What only whoever made the
// step can say stays as the template's own words in <angle brackets>, and `share --check` refuses a text that still
// has any, so a pull request never goes out half filled in.

import { execFileSync } from 'node:child_process';
import { proofOf, percentText } from '../../src/lib/entries.mjs';
import { LANGUAGES, versionOf } from '../../src/lib/languages.mjs';
import { notesIn } from '../../src/lib/notes.mjs';
import { UPSTREAM, api, signedInAs } from './github.mjs';
import { REPO } from './paths.mjs';

/** The issue a branch is for, from its name, as in feat/741-ice-mountain-act-2, or null. */
export const issueOfBranch = branch => Number(/^[a-z]+\/(\d+)-/.exec(branch ?? '')?.[1]) || null;

/**
 * A game's or a version's proof as a commit has it, measured as the site measures it (src/lib/entries.mjs), or null
 * when the commit has none that adds up. `read(path)` gives a file of that commit as text, or null, and `list(folder)`
 * the names of the files in one of its folders.
 */
export function proofAt(game, read, list) {
  const own = `games/${game}/proof`, shared = `games/${versionOf(game).game}/proof`;
  const json = path => {
    const text = read(path);
    return text === null ? undefined : JSON.parse(text);
  };
  try {
    const recordings = Object.fromEntries(list(`${shared}/recordings`).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), json(`${shared}/recordings/${name}`)]));
    return proofOf(game, {
      original: json(`${shared}/original.json`), map: json(`${shared}/code-map.json`), progress: json(`${own}/progress.json`),
      portMap: json(`${own}/port-map.json`), parts: json(`${shared}/parts.json`), recordings,
    });
  } catch {
    return null;
  }
}

// one side of a number's line, as find and the game's page show the number
const ported = proof => (proof?.ported ? percentText(proof.ported.percent) : 'not measured yet');
const gameplay = proof => (proof?.gameplay ? `${percentText(proof.gameplay.percent)}, ${proof.gameplay.proven} of ${proof.gameplay.total} parts` : 'not measured yet');

/**
 * The two lines of numbers, before, as main has them where the branch started, and after, as the commit shared has
 * them, with the parts the step adds: { ported, gameplay }.
 */
export function numberLines(game, before, after) {
  const { language } = versionOf(game), named = language === 'js' ? '' : ` in ${LANGUAGES[language].name}`;
  const proven = proof => new Set((proof?.gameplay?.parts ?? []).filter(part => part.proven).map(part => part.name));
  const had = proven(before), added = [...proven(after)].filter(name => !had.has(name));
  return {
    ported: `Code ported${named}: ${ported(before)} → ${ported(after)}`,
    gameplay: `Gameplay proven${named}: ${gameplay(before)} → ${gameplay(after)}${added.length ? `, adding ${added.join(', ')}` : ''}`,
  };
}

// what stands under two headings the template leaves empty, until someone writes there
const CHANGES = '<what changed, in plain words, and any decision that matters>';
const LIMITS = '<what still differs, what wasn\'t checked and what follows, or None when that\'s true>';
const withoutComments = template => template.replace(/<!--[\s\S]*?-->\n?/g, '');
// the label a line starts with, as in "Sources: …", without the language a number's line names, as in "Code ported in C: …"
const labelOf = line => /^([A-Z][A-Za-z/ ]*?)(?: in [A-Z][A-Za-z+#]*)?:/.exec(line)?.[1] ?? null;

/**
 * The pull request's text from the repository's `template`, with what `known` holds filled in: `issue` and its
 * `milestone`, the `branch`, `buildsOn`, the numbers of the pull requests in review the branch starts on top of,
 * `about`, what changed in a sentence or two, `lead`, the game's lead when it's someone else, `clips`, their lines as
 * share keeps them, or '' when it shared none,
 * `numbers` (numberLines), `notes`, the titles of the notes the step adds or changes, and `preview`, its address.
 * Anything not known keeps the template's own words. With `earlier`, a text made before for the same branch, everything
 * someone wrote in it stays, and only the lines the tools know better now are written again: the clips, the numbers,
 * the notes and the preview.
 */
export function pullRequestText(template, known, earlier = null) {
  const { issue, milestone, branch, buildsOn = [], about, lead, clips, numbers, notes, preview } = known;
  // each line the tools write, by the label it starts with
  const own = {
    Clips: clips === undefined ? undefined : clips ? `Clips:\n\n${clips}\n` : 'Clips: none',
    'Code ported': numbers?.ported,
    'Gameplay proven': numbers?.gameplay,
    Notes: notes ? `Notes: ${notes.length ? notes.map(title => `"${title}"`).join(', ') : 'none'}` : undefined,
    Preview: preview ? `Preview: ${preview}` : undefined,
  };
  const once = {
    Milestone: milestone ? `Milestone: ${milestone}` : undefined,
    Branch: branch ? `Branch: ${branch}, new from the latest main and used only for this issue` : undefined,
  };
  const lines = (earlier ?? withoutComments(template)).split('\n'), out = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at], label = labelOf(line);
    if (label === 'Clips' && own.Clips !== undefined) {
      out.push(own.Clips);
      // an earlier text holds the clips' own lines under it, up to the numbers
      while (at + 1 < lines.length && labelOf(lines[at + 1]) === null && !lines[at + 1].startsWith('## ')) at++;
    } else if (own[label] !== undefined) out.push(own[label]);
    else if (earlier) out.push(line);
    else if (once[label] !== undefined) out.push(once[label]);
    else if (line.trim() === 'Closes #<issue-number>' && issue) out.push(`Closes #${issue}`, ...buildsOn.map(number => `Builds on #${number}`));
    else if (line.trim() === '## Changes') out.push(line, '', about || CHANGES, ...(lead ? ['', `The game's lead is @${lead}.`] : []));
    else if (line.trim() === '## Limitations and follow-up') out.push(line, '', LIMITS);
    else out.push(line);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * The lines of a pull request's text that nobody has filled in yet: those that still hold the `template`'s own words,
 * in angle brackets. Only the template's words count, so angle brackets someone wrote, as in a command or a tag, don't.
 */
export function unfilled(text, template) {
  const own = withoutComments(template).split('\n').map(line => line.trim()).filter(line => /<[^<>]+>/.test(line));
  // a long one anywhere in a line, and a short one, such as an issue's number, only in the template's own line
  const long = [CHANGES, LIMITS, ...own.flatMap(line => line.match(/<[^<>]+>/g)).filter(words => words.length >= 14)];
  return text.split('\n').map(line => line.trim()).filter(line => own.includes(line) || long.some(words => line.includes(words)));
}

/**
 * What the tools know of a step for its pull request's text, as pullRequestText takes it, read from the repository and
 * from GitHub: `game` is the version shared, `commit` what was shared from `branch`, `base` where the branch started
 * on main, or null, and `about`, `preview` and `clips` what share was told and made. What GitHub can't say now is
 * left out, and stays in the text to fill in.
 */
export function knownOf({ game, branch, commit, base, about, preview, clips }) {
  const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28, stdio: ['ignore', 'pipe', 'ignore'] });
  const has = args => {
    try {
      git(args);
      return true;
    } catch {
      return false;
    }
  };
  // a commit's files, as proofAt reads them
  const at = wanted => [path => (has(['cat-file', '-e', `${wanted}:${path}`]) ? git(['show', `${wanted}:${path}`]) : null),
    folder => (has(['cat-file', '-e', `${wanted}:${folder}`]) ? git(['ls-tree', '--name-only', `${wanted}:${folder}/`]).split('\n').filter(Boolean).map(path => path.split('/').pop()) : [])];
  const issue = issueOfBranch(branch);
  // the game's lead, when it's someone else than whoever is signed in: whoever its game's issue is assigned to, or else
  // its entry's lead
  const entry = at(commit)[0](`games/${versionOf(game).game}/entry.md`) ?? '';
  const home = Number(/^issue:\s*(\d+)/m.exec(entry)?.[1]) || null;
  let milestone = null, buildsOn = [], lead = /^lead:\s*['"]?([\w-]+)/m.exec(entry)?.[1] ?? null;
  try {
    milestone = issue ? api(`repos/${UPSTREAM}/issues/${issue}`)?.milestone?.title ?? null : null;
    lead = (home ? api(`repos/${UPSTREAM}/issues/${home}`)?.assignees?.[0]?.login : null) ?? lead;
    if (lead?.toLowerCase() === signedInAs().toLowerCase()) lead = null;
    // the pull requests in review whose commits the branch carries and main doesn't have, as a piece on top of one starts from it
    const carried = sha => has(['merge-base', '--is-ancestor', sha, commit]) && !(base && has(['merge-base', '--is-ancestor', sha, base]));
    buildsOn = (api(`repos/${UPSTREAM}/pulls?state=open&per_page=100`) ?? []).filter(pull => !pull.draft && pull.head.ref !== branch && carried(pull.head.sha)).map(pull => pull.number);
  } catch {
    // GitHub can't be read now
  }
  // the notes the step adds or changes, by their titles
  const changed = base ? git(['diff', '--name-only', '--diff-filter=d', base, commit, '--', 'games/*/notes/*.md', 'kit/*/notes/*.md']).split('\n').filter(Boolean) : [];
  const notes = changed.map(path => {
    const [top, name] = path.split('/');
    return notesIn(REPO, top, name).find(note => note.path === path)?.title;
  }).filter(Boolean);
  return { issue, milestone, branch, buildsOn, about, lead, clips, numbers: numberLines(game, base ? proofAt(game, ...at(base)) : null, proofAt(game, ...at(commit))), notes, preview };
}
