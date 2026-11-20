// The PlayStation 2's float rules are one file, used twice: by the kit's EE and vector units (kit/ps2/c/floats.c and
// floats.h), and by the console's emulator in the proof tools, which the tools' patch gives a copy of it
// (tools/libretro/play.patch). A proof compares a Dreamport with the emulator, so the two copies have to be the same,
// word for word. Run by `npm run check`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

// a file the patch adds, from the lines it adds
function addedBy(patch, name) {
  const start = patch.indexOf(`+++ b/${name}\n`);
  assert.notEqual(start, -1, `the patch adds ${name}`);
  const lines = patch.slice(start).split('\n').slice(1), text = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) break;
    if (line.startsWith('+')) text.push(line.slice(1));
  }
  return `${text.join('\n')}\n`;
}

test('the emulator is given the kit\'s float rules, word for word', () => {
  const patch = read('tools/libretro/play.patch');
  assert.equal(addedBy(patch, 'Source/ee/dreamports/floats.h'), read('kit/ps2/c/floats.h'));
  assert.equal(addedBy(patch, 'Source/ee/dreamports/floats.cpp'), read('kit/ps2/c/floats.c'));
});
