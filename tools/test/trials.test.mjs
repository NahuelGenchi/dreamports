// node --test tools/test/trials.test.mjs: a trial, a second version of a game in a language it already has one in
// (src/lib/languages.mjs), is known to the tools by its name and is in no list of a game's versions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { LANGUAGES, OTHER_LANGUAGES, TRIALS, languageOf, mainLanguage, playOrder, versionName, versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { codeFiles } from '../portmap.mjs';

test('a trial is no language, so no list of a game\'s versions has it', () => {
  assert.ok(Object.keys(TRIALS).length > 0);
  for (const [key, trial] of Object.entries(TRIALS)) {
    assert.ok(!(key in LANGUAGES));
    assert.ok(trial.folder && !Object.values(LANGUAGES).some(language => language.folder === trial.folder));
    // what it's written in is a language with versions of its own
    assert.ok(trial.written in LANGUAGES);
    assert.equal(writtenIn(key), trial.written);
    assert.equal(languageOf(key), trial);
  }
  assert.deepEqual(Object.keys(LANGUAGES), ['js', 'c']);
  assert.deepEqual(OTHER_LANGUAGES, ['c']);
  assert.deepEqual(playOrder(Object.keys(LANGUAGES)), ['c', 'js']);
  for (const language of Object.keys(LANGUAGES)) assert.equal(writtenIn(language), language);
});

test('the tools know a trial by its name', () => {
  assert.deepEqual(versionOf('sonic-advance/strict'), { game: 'sonic-advance', language: 'strict' });
  assert.equal(versionName('sonic-advance', 'strict'), 'sonic-advance/strict');
  assert.equal(writtenIn('strict'), 'c');
  assert.deepEqual(versionOf('sonic-advance/c'), { game: 'sonic-advance', language: 'c' });
  assert.equal(versionName('sonic-advance', 'js'), 'sonic-advance');
  assert.throws(() => versionOf('sonic-advance/other'), /isn't a game or a version/);
});

test('a game with a trial has the main version it had', () => {
  assert.equal(mainLanguage(['js', 'c']), 'js');
  assert.equal(mainLanguage(['c']), 'c');
});

test('a game\'s own code leaves out its trials\' folders, as it does its other versions\'', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dp-trial-'));
  try {
    for (const each of ['src', 'c/src', 'strict/src']) mkdirSync(join(folder, each), { recursive: true });
    for (const each of ['src/main.js', 'c/src/main.js', 'c/src/main.c', 'strict/src/main.js', 'strict/src/main.c']) writeFileSync(join(folder, each), '');
    const found = (from, language) => codeFiles(from, language).map(file => relative(folder, file).split('\\').join('/'));
    assert.deepEqual(found(folder, 'js'), ['src/main.js']);
    assert.deepEqual(found(join(folder, 'strict'), writtenIn('strict')), ['strict/src/main.c']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a trial is built on its game\'s console, though its own original.json names none', async () => {
  const { consoleOfFolder } = await import('../lib/c.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'dp-trial-console-'));
  try {
    mkdirSync(join(folder, 'proof'), { recursive: true });
    mkdirSync(join(folder, 'strict', 'proof'), { recursive: true });
    writeFileSync(join(folder, 'proof', 'original.json'), JSON.stringify({ console: 'gba' }));
    writeFileSync(join(folder, 'strict', 'proof', 'original.json'), JSON.stringify({ workMemory: [{ address: '03000000', bytes: 32256 }] }));
    assert.equal(consoleOfFolder(join(folder, 'strict')), 'gba');
    assert.equal(consoleOfFolder(folder), 'gba');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
