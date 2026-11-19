// The PlayStation's function finder (tools/ps1/functions.mjs) on the made-up program of the tools' tests
// (made-up-ps1.mjs), with nothing from any game in it, given alone and on a made-up disc that boots it, written here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { exeOf, findFunctions, isInstruction, ps1Program, startsInData } from '../ps1/functions.mjs';
import { madeUpExe } from './made-up-ps1.mjs';

const SECTOR = 2048;

// A disc of 2 KB sectors, as an ISO file is, with each of `files` in the top folder or in a folder of its own, and the
// name a PlayStation's disc has, so it reads as one.
function madeUpDisc(files) {
  const entry = (name, sector, size, folder) => {
    const named = Buffer.from(name, 'latin1'), length = 33 + named.length + (named.length % 2 ? 0 : 1);
    const bytes = Buffer.alloc(length);
    bytes[0] = length;
    bytes.writeUInt32LE(sector, 2);
    bytes.writeUInt32BE(sector, 6);
    bytes.writeUInt32LE(size, 10);
    bytes.writeUInt32BE(size, 14);
    bytes[25] = folder ? 2 : 0;
    bytes[32] = named.length;
    named.copy(bytes, 33);
    return bytes;
  };
  const folders = [...new Set(Object.keys(files).filter(path => path.includes('\\')).map(path => path.split('\\')[0]))];
  let next = 18 + 1 + folders.length;
  const placed = Object.entries(files).map(([path, bytes]) => {
    const at = next;
    next += Math.ceil(bytes.length / SECTOR) || 1;
    return { path, bytes, at };
  });
  const folderOf = (name, sector, parent, inside) => Buffer.concat([entry('\0', sector, SECTOR, true), entry('\x01', parent, SECTOR, true), ...inside]);
  const root = folderOf('', 18, 18, [
    ...folders.map((name, n) => entry(name, 19 + n, SECTOR, true)),
    ...placed.filter(file => !file.path.includes('\\')).map(file => entry(`${file.path};1`, file.at, file.bytes.length, false)),
  ]);
  const disc = Buffer.alloc(next * SECTOR);
  const volume = disc.subarray(16 * SECTOR);
  volume[0] = 1;
  volume.write('CD001', 1, 'latin1');
  volume[6] = 1;
  volume.write('PLAYSTATION'.padEnd(32), 8, 'latin1');
  volume.write('MADE_UP'.padEnd(32), 40, 'latin1');
  entry('\0', 18, SECTOR, true).copy(volume, 156);
  disc[17 * SECTOR] = 255;
  disc.write('CD001', 17 * SECTOR + 1, 'latin1');
  root.copy(disc, 18 * SECTOR);
  folders.forEach((name, n) => folderOf(name, 19 + n, 18, placed.filter(file => file.path.startsWith(`${name}\\`)).map(file => entry(`${file.path.split('\\')[1]};1`, file.at, file.bytes.length, false))).copy(disc, (19 + n) * SECTOR));
  for (const file of placed) file.bytes.copy(disc, file.at * SECTOR);
  return disc;
}

test('finds every function of the made-up program, each with its size', () => {
  const { exe, functions } = madeUpExe();
  assert.deepEqual(findFunctions(exe), functions.map(({ address, size }) => ({ address, size })));
});

test('each way a function is found', () => {
  const { exe, labels } = madeUpExe();
  const found = program => findFunctions(program).map(f => f.address);
  const without = (label, word = 0) => {
    const copy = Buffer.from(exe);
    copy.writeUInt32LE(word, 0x800 + labels[label] - exeOf(exe).load);
    return copy;
  };
  // shine is after the program's values, so only the table's pointer to its opening finds it
  assert.ok(found(exe).includes(labels.shine));
  assert.ok(!found(without('functions')).includes(labels.shine), 'with no pointer to it, nothing finds shine');
  // sum is found by the calls to it, and with none it's still code after a return, which ends as a function does
  assert.ok(found(exe).includes(labels.sum));
  // a switch's jump through its table doesn't end the function: its cases are pick's own
  assert.ok(!found(exe).includes(labels.pick_0) && !found(exe).includes(labels.pick_else));
  // the program's values aren't a function, as the fourth isn't an instruction
  assert.ok(!found(exe).some(address => address >= labels.values && address < labels.shine));
  assert.ok(!isInstruction(0x44444444) && isInstruction(0x03E00008) && isInstruction(0) && !isInstruction(0x00000005));
});

test('a function a list names outside the program is in its data', () => {
  const { exe, labels } = madeUpExe();
  assert.deepEqual(startsInData(exe, [{ address: labels.sum, size: 8 }, { address: 0x80200000, size: 4 }]), [{ address: 0x80200000, size: 4 }]);
});

test('reads the program a made-up disc boots, in a folder, or PSX.EXE when the disc names none', async () => {
  const work = join(LOCAL, 'tmp', 'ps1-functions-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const { exe } = madeUpExe();
    const disc = join(work, 'made-up.iso');
    writeFileSync(disc, madeUpDisc({ 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\GAME\\MADE_UP.EXE;1\r\nTCB = 4\r\n'), 'GAME\\MADE_UP.EXE': exe }));
    assert.equal((await readAnyCopy(disc))?.console, 'ps1');
    assert.deepEqual(await ps1Program(disc), exe);
    const plain = join(work, 'plain.iso');
    writeFileSync(plain, madeUpDisc({ 'PSX.EXE': exe }));
    assert.deepEqual(await ps1Program(plain), exe);
    const missing = join(work, 'missing.iso');
    writeFileSync(missing, madeUpDisc({ 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\NOWHERE.EXE;1\r\n') }));
    await assert.rejects(ps1Program(missing), /couldn't find the program .* boots: its SYSTEM.CNF names NOWHERE.EXE/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('says when a file isn\'t a PlayStation program', () => {
  assert.throws(() => findFunctions(Buffer.alloc(4096)), /no PS-X EXE header/);
});
