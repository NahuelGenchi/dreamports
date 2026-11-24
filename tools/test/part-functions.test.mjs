// A game's parts as the tasks of a version made a function at a time (lib/part-functions.mjs, #1871).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatPartFunctions, leftOf, parsePartFunctions, partGroups } from '../lib/part-functions.mjs';
import { groupNamed } from '../lib/proofs.mjs';
import { functionTasks, PART_LISTS, partTaskText } from '../tasks.mjs';
import { field } from '../lib/claims.mjs';

const SHA1 = 'a'.repeat(40);
const hex = n => n.toString(16).toUpperCase().padStart(8, '0');
// a made-up cartridge: forty functions of 16 bytes, one after another, the first two its start, which no proof reaches
const functions = [{ key: '08000000', address: 0x08000000, size: 4 }, { key: '080000C0', address: 0x080000C0, size: 60 },
  ...Array.from({ length: 40 }, (_, i) => ({ key: hex(0x08000100 + i * 16), address: 0x08000100 + i * 16, size: 16 }))];
const codeMap = { console: 'gba', functions };
const key = i => functions[i + 2].key;
const parts = [{ name: 'The logos' }, { name: 'The main menu' }, { name: 'A level in C' }];
const proven = keys => new Map(functions.map(f => [f.key, { key: f.key, kind: keys.includes(f.key) ? 'bytes' : null }]));

test('a part has the functions it runs that no part before it has, and never the cartridge\'s start', () => {
  const ran = new Map([['The logos', ['08000000', '080000C0', key(0), key(1), key(2)]], ['The main menu', [key(1), key(2), key(3), key(4)]]]);
  const groups = partGroups(parts, ran, codeMap);
  assert.deepEqual(groups.map(group => [group.name, group.recorded, group.first, group.functions.map(f => f.key)]), [
    ['The logos', true, key(0), [key(0), key(1), key(2)]],
    ['The main menu', true, key(3), [key(3), key(4)]],
    ['A level in C', false, null, []],
  ]);
  assert.ok(groups.every(group => group.part));
});

test('once every part has its functions, what no part runs comes after, in groups by address', () => {
  const ran = new Map([['The logos', [key(0)]], ['The main menu', [key(1)]], ['A level in C', [key(39)]]]);
  const groups = partGroups(parts, ran, codeMap);
  const after = groups.slice(3);
  assert.equal(groups.length > 3 && after.every(group => !group.part && /^Functions? /.test(group.name)), true);
  assert.deepEqual(after.flatMap(group => group.functions.map(f => f.key)), Array.from({ length: 37 }, (_, i) => key(i + 2)));
  // a function the code map no longer has, or a part parts.json no longer lists, is left out
  assert.deepEqual(partGroups(parts.slice(0, 1), new Map([['The logos', ['0BADF00D', key(0)]], ['Gone', [key(5)]]]), codeMap)[0].functions.map(f => f.key), [key(0)]);
});

test('a part is done with its recording, each function\'s proof, and its frames the same', () => {
  const ran = new Map([['The logos', [key(0), key(1)]]]);
  const [logos, menu] = partGroups(parts, ran, codeMap);
  assert.equal(leftOf(menu, proven([])), 'recording');
  assert.equal(leftOf(logos, proven([key(0)])), 'functions');
  assert.equal(leftOf(logos, proven([key(0), key(1)])), null, 'where nobody asked of its frames');
  assert.equal(leftOf(logos, proven([key(0), key(1)]), new Set()), 'frames');
  assert.equal(leftOf(logos, proven([key(0), key(1)]), new Set(['The logos'])), null);
  // a group of functions has only its proofs
  assert.equal(leftOf({ name: 'Functions', functions: [functions[2]] }, proven([]), new Set()), 'functions');
  assert.equal(leftOf({ name: 'Functions', functions: [functions[2]] }, proven([key(0)]), new Set()), null);
});

test('each part with something left gets a task, by its own name, and an open one is found again', () => {
  const ran = new Map([['The logos', [key(0), key(1)]], ['The main menu', [key(2)]]]);
  const groups = partGroups(parts, ran, codeMap), states = proven([key(0), key(1)]);
  // the logos' functions are proven and its frames aren't the same yet; the level has no recording
  assert.deepEqual(functionTasks(groups, states, [], 'c', 20, new Set()).wanted.map(group => group.name), ['The logos', 'The main menu', 'A level in C']);
  assert.deepEqual(functionTasks(groups, states, [], 'c', 20, new Set(['The logos'])).wanted.map(group => group.name), ['The main menu', 'A level in C']);
  const open = [{ title: 'Task: The main menu in C', state: 'open' }, { title: 'Task: A level in C in C', state: 'open' }];
  const found = functionTasks(groups, states, open, 'c', 20, new Set());
  assert.deepEqual([found.open.map(group => group.name), found.wanted.map(group => group.name)], [['The main menu', 'A level in C'], ['The logos']]);
  // by its name, with its language or without, and by the address of one of its functions
  assert.equal(groupNamed(groups, 'Task: A level in C in C').name, 'A level in C');
  assert.equal(groupNamed(groups, 'a level in c').name, 'A level in C');
  assert.equal(groupNamed(groups, 'The main menu').name, 'The main menu');
  assert.equal(groupNamed(groups, `0x${key(2)}`).name, 'The main menu');
});

test('a part\'s task lists what\'s left of it, and one with no recording says where it starts', () => {
  const many = Array.from({ length: 40 }, (_, i) => key(i));
  const [logos, menu] = partGroups(parts, new Map([['The logos', many]]), codeMap);
  const text = partTaskText('made-up/c', logos, proven([key(0)]));
  assert.equal(field(text, 'Game folder'), 'made-up');
  assert.match(field(text, 'What it is'), /runs 40 functions in it that no part before it runs, from its recording, and 39 have no proof yet/);
  assert.equal(text.includes(`\`${key(0)}\``), false, 'a proven one isn\'t listed');
  assert.equal(text.includes(`\`${key(39)}\``), true);
  assert.match(field(text, 'Done when'), /ready made-up\/c --task "The logos"` says each .* and the part is proven/);
  assert.match(text, /- \[ \] I'm taking this task myself\./);
  const none = partTaskText('made-up/c', menu, proven([]));
  assert.match(field(none, 'What it is'), /no recording of the original yet, which is where its task starts/);
  assert.equal(PART_LISTS >= 40, true);
});

test('the file is a part to a line, each part\'s functions in order, and only as prove writes it', () => {
  const text = formatPartFunctions({ original: SHA1, parts: new Map([['The main menu', [key(3), key(1), key(1)]], ['The logos', [key(0)]]]) }, ['The logos', 'The main menu', 'A level in C']);
  assert.deepEqual(Object.entries(JSON.parse(text).parts), [['The logos', [key(0)]], ['The main menu', [key(1), key(3)]]]);
  assert.deepEqual([...parsePartFunctions(text).parts.keys()], ['The logos', 'The main menu']);
  assert.equal(text.split('\n').length, 9);
  for (const wrong of ['[]', '{}', `{"original":"${SHA1}","parts":[]}`, `{"original":"${SHA1}","parts":{"The logos":["${key(1)}","${key(0)}"]}}`, `{"original":"${SHA1}","parts":{"The logos":["words here"]}}`]) {
    assert.throws(() => parsePartFunctions(wrong), /isn't as npm run dp -- prove writes it/, wrong);
  }
  // a PlayStation 2's functions of another program, and a vector unit's
  assert.ok(parsePartFunctions(`{"original":"${SHA1}","parts":{"The logos":["00000000@IOPRP254.IMG:CDVDFSV","00100008","003599B8~vu"]}}`));
});
