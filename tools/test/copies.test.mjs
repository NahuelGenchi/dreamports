// What the tools tell about a copy of a game on each console, from made-up headers with nothing from any game in them.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { looksLikeAnyCopy, readAnyCopy } from '../lib/read-copy.mjs';

const folder = mkdtempSync(join(tmpdir(), 'dp-copies-'));
after(() => rmSync(folder, { recursive: true, force: true }));

const write = (name, bytes) => {
  const path = join(folder, name);
  writeFileSync(path, bytes);
  return path;
};
const text = (bytes, at, words) => bytes.write(words, at, 'latin1');

function gameBoy(colour) {
  const rom = Buffer.alloc(0x8000);
  text(rom, 0x134, 'MADE UP');
  if (colour) rom[0x143] = 0x80;
  let sum = 0;
  for (let i = 0x134; i <= 0x14C; i++) sum = (sum - rom[i] - 1) & 0xFF;
  rom[0x14D] = sum;
  return rom;
}

function superNintendo(base = 0x7FC0, copier = 0) {
  const rom = Buffer.alloc(0x10000 + copier);
  text(rom, copier + base, 'MADE UP');
  rom[copier + base + 0x19] = 1;
  rom.writeUInt16LE(0x1234, copier + base + 0x1E);
  rom.writeUInt16LE(0x1234 ^ 0xFFFF, copier + base + 0x1C);
  return rom;
}

function nintendo64(order) {
  const rom = Buffer.alloc(0x1000);
  rom.writeUInt32BE(0x80371240, 0);
  text(rom, 0x20, 'MADE UP');
  text(rom, 0x3B, 'NMUE');
  for (let i = 0; i < rom.length; i += 4) {
    if (order === 'little') rom.subarray(i, i + 4).reverse();
    if (order === 'swapped') { rom.subarray(i, i + 2).reverse(); rom.subarray(i + 2, i + 4).reverse(); }
  }
  return rom;
}

function megaDrive() {
  const rom = Buffer.alloc(0x400);
  text(rom, 0x100, 'SEGA MEGA DRIVE');
  text(rom, 0x150, 'MADE UP');
  text(rom, 0x180, 'GM 00000000-00');
  return rom;
}

// a disc with one folder's worth of files, in 2048-byte or raw sectors
function disc({ system, title, files, sector = 2048, data = 0 }) {
  const sectors = 26, image = Buffer.alloc(sectors * sector);
  const at = n => n * sector + data;
  const volume = Buffer.alloc(2048);
  volume[0] = 1;
  text(volume, 1, 'CD001');
  text(volume, 8, system.padEnd(32));
  text(volume, 40, title.padEnd(32));
  volume.writeUInt32LE(20, 158);
  volume.copy(image, at(16));
  const folderBytes = Buffer.alloc(2048);
  let write = 0, next = 21;
  for (const [name, contents] of Object.entries(files)) {
    const length = 33 + name.length + (name.length % 2 ? 0 : 1);
    folderBytes[write] = length;
    folderBytes.writeUInt32LE(next, write + 2);
    folderBytes.writeUInt32LE(contents.length, write + 10);
    folderBytes[write + 32] = name.length;
    text(folderBytes, write + 33, name);
    image.write(contents, at(next), 'latin1');
    write += length;
    next++;
  }
  folderBytes.copy(image, at(20));
  return image;
}

test('a cartridge says which console it is for', async () => {
  const cases = [
    ['nes', 'a.nes', Buffer.concat([Buffer.from('NES\x1A', 'latin1'), Buffer.alloc(0x400)])],
    ['gb', 'a.gb', gameBoy(false)],
    ['gbc', 'a.gbc', gameBoy(true)],
    ['snes', 'a.sfc', superNintendo()],
    ['snes', 'b.sfc', superNintendo(0xFFC0 - 0x8000)],
    ['snes', 'c.smc', superNintendo(0x7FC0, 0x200)],
    ['n64', 'a.z64', nintendo64()],
    ['n64', 'a.n64', nintendo64('little')],
    ['n64', 'a.v64', nintendo64('swapped')],
    ['md', 'a.md', megaDrive()],
    ['ps1', 'a.exe', Buffer.concat([Buffer.from('PS-X EXE'), Buffer.alloc(0x800)])],
    ['made-up', 'a.mu', Buffer.concat([Buffer.from('MADEUP'), Buffer.alloc(16)])],
  ];
  for (const [id, name, bytes] of cases) {
    const copy = await readAnyCopy(write(name, bytes));
    assert.equal(copy?.console, id, name);
    assert.equal(copy.sha1, createHash('sha1').update(bytes).digest('hex'), name);
    assert.equal(copy.size, bytes.length, name);
    assert.equal(looksLikeAnyCopy(bytes), true, name);
  }
  assert.equal((await readAnyCopy(join(folder, 'a.z64'))).title, 'MADE UP');
  assert.equal((await readAnyCopy(join(folder, 'a.v64'))).code, 'NMUE');
  assert.equal((await readAnyCopy(join(folder, 'a.n64'))).title, 'MADE UP');
  assert.equal((await readAnyCopy(join(folder, 'a.sfc'))).region, 'USA');
});

test('a disc says which console it is for, in either kind of sector', async () => {
  const ps1 = { system: 'PLAYSTATION', title: 'MADE UP', files: { 'SYSTEM.CNF;1': 'BOOT = cdrom:\\SLUS_000.01;1\r\n' } };
  const ps2 = { system: 'PLAYSTATION', title: 'MADE UP', files: { 'SYSTEM.CNF;1': 'BOOT2 = cdrom0:\\SLUS_200.02;1\r\n' } };
  const psp = { system: 'PSP GAME', title: 'MADE UP', files: { 'UMD_DATA.BIN;1': 'ULUS00001|0000000000000000|0001|G' } };
  assert.deepEqual(await pick('one.iso', disc(ps1)), ['ps1', 'SLUS_000.01']);
  assert.deepEqual(await pick('raw.bin', disc({ ...ps1, sector: 2352, data: 24 })), ['ps1', 'SLUS_000.01']);
  assert.deepEqual(await pick('two.iso', disc(ps2)), ['ps2', 'SLUS_200.02']);
  assert.deepEqual(await pick('psp.iso', disc(psp)), ['psp', 'ULUS00001']);

  async function pick(name, bytes) {
    const { console: id, code } = await readAnyCopy(write(name, bytes));
    return [id, code];
  }
});

test('a .cue reads the file it names, for its console and its SHA-1', async () => {
  const bytes = disc({ system: 'PLAYSTATION', title: 'MADE UP', files: { 'SYSTEM.CNF;1': 'BOOT = cdrom:\\SLUS_000.01;1\r\n' }, sector: 2352, data: 24 });
  write('track.bin', bytes);
  const copy = await readAnyCopy(write('game.cue', 'FILE "track.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n'));
  assert.equal(copy.console, 'ps1');
  assert.equal(copy.sha1, createHash('sha1').update(bytes).digest('hex'));
});

test('a kind of file that says nothing needs its console said', async () => {
  const path = write('game.chd', Buffer.alloc(0x400));
  assert.equal(await readAnyCopy(path), null);
  assert.equal((await readAnyCopy(path, 'ps2')).console, 'ps2');
});

test('what is not a game is not taken for one', async () => {
  for (const [name, bytes] of [['note.txt', Buffer.from('some words\n')], ['empty.bin', Buffer.alloc(0)], ['zeros.bin', Buffer.alloc(0x20000)]]) {
    assert.equal(await readAnyCopy(write(name, bytes)), null, name);
    assert.equal(looksLikeAnyCopy(bytes), false, name);
  }
});

test('a Game Boy Advance game is known by its header, whatever its file is called, and a file of another console is not', async () => {
  const header = Buffer.alloc(0x200);
  header[0xB2] = 0x96;
  text(header, 0xA0, 'MADE UP');
  text(header, 0xAC, 'ABCE');
  assert.equal((await readAnyCopy(write('a.rom', header))).console, 'gba');
  assert.equal(await readAnyCopy(write('a.nes', header)), null);
});

test('a .cue whose track has gone is no copy, and stops nothing', async () => {
  assert.equal(await readAnyCopy(write('gone.cue', 'FILE "not-here.bin" BINARY\n  TRACK 01 MODE1/2352\n')), null);
});
