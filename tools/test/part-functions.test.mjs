// A game's parts as the tasks of a version made a function at a time (lib/part-functions.mjs, #1871).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatPartFunctions, leftOf, parsePartFunctions, partGroups, partsRanIn } from '../lib/part-functions.mjs';
import { finderOf } from '../lib/played.mjs';
import { aloneLines } from '../proofs.mjs';
import { groupNamed } from '../lib/proofs.mjs';
import { functionTasks, homesOf, PART_LISTS, partTaskText } from '../tasks.mjs';
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

test('on a PlayStation 2 disc a part\'s functions go a program at a time, the one it boots first, each in its own order', () => {
  // the program the disc boots, a module for its second processor, another program for the EE and two vector unit
  // programs, one in the boot program and one in a file of data, as ps2/functions.mjs keys them
  const keys = ['00100000', '00100040', '00100080', '00000000@SOUND.IRX', '00000120@SOUND.IRX', '00000090@IOPRP254.IMG:CDVDFSV', '00300000@OTHER.ELF', '00100400~vu', '00000048@DATA/MODELS.BIN~vu'];
  const disc = { console: 'ps2', functions: keys.map(key => ({ key, address: parseInt(key, 16), size: 16, ...(/@(.+?)(~vu)?$/.exec(key) ? { program: /@(.+?)(~vu)?$/.exec(key)[1] } : {}), ...(key.endsWith('~vu') ? { vu: true } : {}) })) };
  // as prove writes a part's line: every key in the order text sorts them, which is no program's order
  const first = ['00000120@SOUND.IRX', '00100000', '00100080', '00100400~vu'].sort();
  const second = [...keys].sort();
  const text = formatPartFunctions({ original: SHA1, parts: new Map([['A menu', first], ['A level', second]]) });
  const read = parsePartFunctions(text);
  assert.deepEqual([...read.parts.get('A menu')], first, 'each kind of key is read back as it was written');
  const groups = partGroups([{ name: 'A menu' }, { name: 'A level' }], read.parts, disc);
  assert.deepEqual(groups[0].functions.map(f => f.key), ['00100000', '00100080', '00000120@SOUND.IRX', '00100400~vu']);
  assert.equal(groups[0].first, '00100000');
  // the second part has what the first hasn't, in the order a group of functions has them (groupsOf): the boot
  // program's, then each other program's by its name, a vector unit's program in a file among them
  assert.deepEqual(groups[1].functions.map(f => f.key), ['00100040', '00000048@DATA/MODELS.BIN~vu', '00000090@IOPRP254.IMG:CDVDFSV', '00300000@OTHER.ELF', '00000000@SOUND.IRX']);
  // what no part runs comes after, a program at a time too: none here, as the two parts run them all
  assert.equal(groups.length, 2);
  // a part is named by any of its functions' keys' addresses
  assert.equal(groupNamed(groups, '0x00100040').name, 'A level');
});

test('a recording that links several consoles gives each of its parts the functions that started in its frames and the frame after', () => {
  // what ran, as the linked program writes it: an instruction's address, +1 for Thumb, its bytes, 0 for "it ran", and
  // the first and last frame of a stretch of frames that each had it
  const ran = (address, from, to) => [address + 1, 0x4770, 0, from, to];
  const at = i => functions[i + 2].address;
  const records = Uint32Array.from([
    ...ran(at(0), 0, 0),          // once, as the game starts
    ...ran(at(1), 0, 59),         // every frame
    ...ran(at(2), 10, 12),        // in the first part alone
    ...ran(at(3), 20, 20),        // the frame after the first part's last
    ...ran(at(4), 21, 21),        // and the one after that, which is the second part's alone
    ...ran(at(5) + 4, 5, 30),     // an instruction inside a function that started before the recording: it never starts
    ...ran(at(6), 41, 41),        // the frame after the second part's last
    ...ran(at(7), 42, 59),        // after every part
  ]);
  const find = finderOf(codeMap, () => Buffer.alloc(4), new Map());
  const found = partsRanIn([{ name: 'The logos', frames: [0, 19] }, { name: 'The main menu', frames: [20, 40] }], 60, codeMap, records, find);
  assert.deepEqual(found, [['The logos', [key(0), key(1), key(2), key(3)]], ['The main menu', [key(1), key(3), key(4), key(6)]]]);
  // and prove keeps them as it keeps a one-console recording's
  assert.deepEqual(Object.keys(JSON.parse(formatPartFunctions({ original: SHA1, parts: new Map(found) })).parts), ['The logos', 'The main menu']);
});

test('a part\'s task says what its list leaves out, and a function no task has yet says where it stands', () => {
  const ran = new Map([['The logos', [key(0), key(1)]]]);
  const groups = partGroups(parts, ran, codeMap), states = proven([key(0)]);
  assert.match(field(partTaskText('made-up/c', groups[0], states), 'What it is'), /A function its code only names, as an address it keeps or hands on, or calls on a path the recording never takes, isn't in it: .* `npm run dp -- proofs made-up\/c <address>` says where any function stands\./);
  // by its address, a function of a part is its task's, and one no recording runs so far is said to be in none yet
  assert.equal(aloneLines('made-up/c', `0x${key(1)}`, codeMap, states, groups), null);
  const alone = aloneLines('made-up/c', `0x${key(7)}`, codeMap, states, groups);
  assert.match(alone[0], new RegExp(`^0x${key(7)} of made-up/c is in no task yet, as no part's recording runs it so far, and 2 parts of the game have no recording of the original yet\.`));
  assert.match(alone[1], new RegExp(`0x${key(7)} +16 bytes  `));
  assert.match(alone.at(-1), /Its twin can be written and proven now all the same/);
  // the cartridge's start is in no task either, and for another reason
  const withStart = new Map([...states, ['080000C0', { key: '080000C0', kind: null, beyond: 'start', why: 'no twin' }]]);
  assert.match(aloneLines('made-up/c', '080000C0', codeMap, withStart, groups)[0], /is in no task yet, which neither proof reaches yet:/);
  // once every part has its list, it's in a group by address, and that group answers for it
  const all = partGroups(parts, new Map([['The logos', [key(0)]], ['The main menu', [key(1)]], ['A level in C', [key(2)]]]), codeMap);
  assert.equal(aloneLines('made-up/c', `0x${key(7)}`, codeMap, states, all), null);
  assert.match(groupNamed(all, `0x${key(7)}`).name, /^Functions /);
});

test('tasks says where each kind of task goes: a part\'s under the version\'s issue, a group of functions under its stretch\'s', () => {
  const part = { part: true }, group = {};
  assert.equal(homesOf([part], '#900', 'the stretches'), '#900');
  assert.equal(homesOf([group], '#900', 'the stretches'), 'the stretches');
  assert.equal(homesOf([part, group], '#900', 'the stretches'), '#900 for the game\'s parts, and the stretches for the groups of functions');
});
