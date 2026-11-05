// What `npm run dp -- new` writes for a new Dreamport: the kit's start, filled in with the game's name and copy from
// proof/original.json and its folder. The same folder and original.json always give the same bytes, so that the bot that
// reads a game's first pull request can write them again and compare (docs/TEAMS.md), and so these files hold nothing a
// person typed but what's in original.json.

import { readFileSync } from 'node:fs';
import { CONSOLES } from '../../kit/consoles.js';
import { sizesIn } from './screens.mjs';

const kit = name => new URL(`../gba/new-game/${name}`, import.meta.url);
const otherKit = name => new URL(`../libretro/new-game/${name}`, import.meta.url);
const js = text => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The game's name in its copy's, such as Sonic Battle from Sonic Battle (USA), and the region in brackets. */
export function namesOf(original) {
  const found = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(original.name);
  return { name: found ? found[1] : original.name, region: found ? found[2] : 'Unknown' };
}

/** The commit message of a new game's first files, with nothing of anyone's but the game's name (`.github/first-entry/rules.mjs`). */
export const firstFilesMessage = (name, issue) => `feat: ${name} Dreamport's first files (#${issue})`;

/** The commit message of a game's capture, which goes on those first files. */
export const captureMessage = (name, issue) => `feat: ${name} Dreamport's capture (#${issue})`;

/** The files of a new game, by their paths in its folder. */
export function startingFiles(game, original) {
  const { name, region } = namesOf(original);
  const title = `${name} Dreamport`;
  const fill = (text, values) => text.replace(/@([A-Z0-9_]+)@/g, (_, key) => values[key]);
  return {
    'LICENSE': readFileSync(new URL('../../kit/gba/LICENSE', import.meta.url), 'utf8'),
    'index.html': fill(readFileSync(kit('index.html.template'), 'utf8'), { NAME: html(name), TITLE: html(title) }),
    'src/main.js': original.console !== 'gba' ? fill(readFileSync(otherKit('main.js.template'), 'utf8'), {
      TITLE_JS: title, NAME_JS: js(name), CONSOLE_JS: js(original.console), SHA1_JS: js(original.sha1), FOLDER_JS: js(game), TITLE_QUOTED: js(title), HOME_JS: js(`https://dreamports.net/dreamports/${game}-dreamport/`),
      SCREEN_JS: JSON.stringify(sizesIn(original.screen)?.[0] ?? CONSOLES[original.console].screen),
    }) : fill(readFileSync(kit('main.js.template'), 'utf8'), {
      TITLE_JS: title, NAME_JS: js(name), HEADER_JS: js(original.title), CODE_JS: /^[A-Z0-9]+$/.test(original.code) ? original.code : js(original.code), REGION_JS: js(region),
      SHA1_JS: js(original.sha1), FOLDER_JS: js(game), TITLE_QUOTED: js(title), HOME_JS: js(`https://dreamports.net/dreamports/${game}-dreamport/`),
    }),
  };
}

/** A WebP with only its picture, in the one part that holds it. A browser's canvas adds a colour profile, room a first entry's check couldn't read (.github/first-entry/rules.mjs). */
export function plainWebp(bytes) {
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4), end = at + 8 + size + (size & 1);
    if (['VP8 ', 'VP8L'].includes(bytes.toString('latin1', at, at + 4))) {
      const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
      head.writeUInt32LE(4 + end - at, 4);
      return Buffer.concat([head, bytes.subarray(at, end)]);
    }
    at = end;
  }
  throw new Error('The browser made a still with no picture in it.');
}

/** An entry with its capture named in it, as `npm run dp -- capture` writes it. */
export function withCapture(entry, game) {
  const [, head, rest] = entry.match(/^---\r?\n([^]*?)\r?\n---\r?\n([^]*)$/);
  const lines = [];
  let dropping = false;
  for (const line of head.split(/\r?\n/)) {
    if (/^(screen|share):/.test(line)) dropping = true;
    else if (!/^\s/.test(line)) dropping = false;
    if (!dropping) lines.push(line);
  }
  const base = `/media/${game}-dreamport`;
  lines.push('screen:', `  clip: ${base}`, `  still: ${base}-still.webp`, '  pixelated: true', `share: ${base}-share.png`);
  return `---\n${lines.join('\n')}\n---\n${rest}`;
}

const yaml = text => JSON.stringify(text);

/** The game's entry, which says the same for now whoever writes it, and which its lead fills in as the game grows. */
export function startingEntry(game, original, { issue, lead, added }) {
  const { name } = namesOf(original);
  return `---
# ${name} Dreamport's entry. games/README.md explains every field, and its two numbers come from proof/.
title: ${yaml(`${name} Dreamport`)}
platform: ${CONSOLES[original.console].name}
added: ${added}
summary: ${yaml('Plays in your browser. No emulator, nothing to install.')}
needs: ${yaml(`A ${original.name} ${original.console === 'gba' ? 'ROM (.gba)' : `copy (${CONSOLES[original.console].files.join(', ')})`}`)}
controls: [keyboard, controller, touch]
issue: ${issue}
lead: ${lead}
kit: gba
ownCopy:
  confirm: ${yaml(`I own ${name}`)}
  links:
    - label: Play
      href: https://dreamports.net/play/${game}/
      icon: play
---

## Credits

Made by ${lead}.
`;
}
