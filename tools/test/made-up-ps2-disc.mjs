// A made-up PlayStation 2 disc for the tests of `read`, the instruction tables and the function finder on the console
// (ps2-read.test.mjs), with nothing from any game in it: every program on it is written here, in the tables' own text,
// assembled by them (tools/ps2/ee.mjs, tools/ps2/vu.mjs), so the tests also show the tables write what they read.
//
// It boots MADE_UP.ELF, whose EE code has two functions using the EE's own instructions, and whose .vutext holds two
// uploads of a vector unit program, each after the VIF's MPG command. Beside it are an IOP module, MADE_UP.IRX, an
// IOPRP image holding another, IOPRP.IMG, a second EE program, OTHER.ELF, and a file of data, DATA/MODELS.BIN, with
// an upload and a program inside it among bytes that are neither.

import { encode } from '../ps2/ee.mjs';
import { encodePair } from '../ps2/vu.mjs';

const SECTOR = 2048;
/** Where the boot program is loaded, and where its parts start. */
export const BOOT = { text: 0x00100000, vutext: 0x00100200, data: 0x00100300 };

// instructions written as the table reads them, from `at`, with labels as `name:` lines and branches to them
function assemble(lines, at) {
  const labels = {};
  let address = at;
  for (const line of lines) if (line.endsWith(':')) labels[line.slice(0, -1)] = address; else address += 4;
  const words = [];
  address = at;
  for (const line of lines) {
    if (line.endsWith(':')) continue;
    const text = line.replace(/\b([a-z_]+)\b(?=$)/, name => (name in labels ? `0x${labels[name].toString(16)}` : name));
    words.push(encode(text, address));
    address += 4;
  }
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
  return { bytes, labels };
}

// an upload of a vector unit program: the VIF's NOP and MPG commands, then the pairs, the lower word first
function upload(pairs, vuAddress) {
  const bytes = Buffer.alloc(8 + pairs.length * 8);
  bytes.writeUInt32LE((0x4A << 24 | (pairs.length & 0xFF) << 16 | vuAddress / 8) >>> 0, 4);
  pairs.forEach((text, i) => {
    const [lower, upper] = encodePair(text, vuAddress + i * 8);
    bytes.writeUInt32LE(lower, 8 + i * 8);
    bytes.writeUInt32LE(upper, 12 + i * 8);
  });
  return bytes;
}

/** The boot program's two functions, as the tables write them. */
export const MAIN = [
  'main:',
  'addiu $sp, $sp, -16',
  'sd $ra, 0($sp)',
  'jal sum',
  'nop',
  'lui $a0, 0x10',
  'addiu $a0, $a0, 768',
  'ld $ra, 0($sp)',
  'jr $ra',
  'addiu $sp, $sp, 16',
  'sum:',
  'addiu $sp, $sp, -32',
  'sq $s0, 0($sp)',
  'paddw $v0, $a0, $a1',
  'pextlw $v1, $a0, $a1',
  'beql $a0, $zero, done',
  'mult1 $v0, $a0, $a1',
  'lqc2 $vf1, 16($a0)',
  'vadd.xyzw $vf2xyzw, $vf1xyzw, $vf1xyzw',
  'qmfc2 $v0, $vf2',
  'add.s $f0, $f12, $f13',
  'done:',
  'lq $s0, 0($sp)',
  'jr $ra',
  'addiu $sp, $sp, 32',
];
/** The two vector unit programs the boot program sends, and where the unit keeps each. */
export const VU_PROGRAMS = [
  { vuAddress: 0, pairs: ['nop iaddiu vi01, vi00, 0x10', 'mulax.xyzw ACC, vf04, vf03x lqi.xyzw vf05, (vi01++)', 'add.xyzw vf06, vf05, vf04 ibne vi01, vi02, 0x8', 'nop[e] nop'] },
  { vuAddress: 0x80, pairs: ['addi.xyzw vf01, vf00, I loi 1.5', 'nop[e] xgkick vi01'] },
];
/** The IOP module's code: two functions, from 0, as the IOP's code is the same as the EE's in these instructions. */
export const MODULE = ['start:', 'addiu $sp, $sp, -8', 'sw $ra, 4($sp)', 'jal helper', 'nop', 'lw $ra, 4($sp)', 'jr $ra', 'addiu $sp, $sp, 8', 'helper:', 'jr $ra', 'li $v0, 1'];

/**
 * An ELF file with these sections, each { name, type, flags, address, bytes }, and a segment holding those loaded:
 * an EE program by default, or an IOP module with `type` 0xFF80.
 */
export function elfWith({ type = 2, entry = 0, flags = 0x20924001, sections }) {
  const names = ['', ...sections.map(s => s.name), '.shstrtab'];
  const strings = Buffer.from(names.join('\0') + '\0', 'latin1');
  const nameAt = n => names.slice(0, n).reduce((sum, name) => sum + name.length + 1, 0);
  let offset = 0x80;
  const placed = sections.map(s => {
    const at = offset;
    offset = (offset + s.bytes.length + 15) & ~15;
    return { ...s, offset: at };
  });
  const stringsAt = offset, tableAt = (stringsAt + strings.length + 15) & ~15;
  const file = Buffer.alloc(tableAt + names.length * 40);
  file.set([0x7F, 0x45, 0x4C, 0x46, 1, 1, 1], 0);
  file.writeUInt16LE(type, 16);
  file.writeUInt16LE(8, 18);
  file.writeUInt32LE(1, 20);
  file.writeUInt32LE(entry, 24);
  file.writeUInt32LE(52, 28);
  file.writeUInt32LE(tableAt, 32);
  file.writeUInt32LE(flags, 36);
  file.writeUInt16LE(52, 40);
  file.writeUInt16LE(32, 42);
  file.writeUInt16LE(1, 44);
  file.writeUInt16LE(40, 46);
  file.writeUInt16LE(names.length, 48);
  file.writeUInt16LE(names.length - 1, 50);
  // the segment: from the first loaded section to the last
  const loaded = placed.filter(s => s.flags & 2);
  const first = loaded[0], last = loaded[loaded.length - 1];
  file.writeUInt32LE(1, 52);
  file.writeUInt32LE(first.offset, 56);
  file.writeUInt32LE(first.address, 60);
  file.writeUInt32LE(first.address, 64);
  file.writeUInt32LE(last.offset + last.bytes.length - first.offset, 68);
  file.writeUInt32LE(last.address + last.bytes.length - first.address, 72);
  file.writeUInt32LE(7, 76);
  for (const s of placed) s.bytes.copy(file, s.offset);
  strings.copy(file, stringsAt);
  [...placed, { name: '.shstrtab', type: 3, flags: 0, address: 0, offset: stringsAt, bytes: strings }].forEach((s, i) => {
    const o = tableAt + (i + 1) * 40;
    file.writeUInt32LE(nameAt(i + 1), o);
    file.writeUInt32LE(s.type, o + 4);
    file.writeUInt32LE(s.flags, o + 8);
    file.writeUInt32LE(s.address, o + 12);
    file.writeUInt32LE(s.offset, o + 16);
    file.writeUInt32LE(s.bytes.length, o + 20);
  });
  return file;
}

/** The boot program, its labels and where its uploads' instructions start. */
export function bootProgram() {
  const { bytes: text, labels } = assemble(MAIN, BOOT.text);
  const uploads = VU_PROGRAMS.map(p => upload(p.pairs, p.vuAddress));
  const vutext = Buffer.concat(uploads);
  const data = Buffer.alloc(16);
  data.writeUInt32LE(labels.sum, 0);
  const elf = elfWith({ entry: BOOT.text, sections: [
    { name: '.text', type: 1, flags: 6, address: BOOT.text, bytes: text },
    { name: '.vutext', type: 1, flags: 6, address: BOOT.vutext, bytes: vutext },
    { name: '.data', type: 1, flags: 3, address: BOOT.data, bytes: data },
  ] });
  const starts = [BOOT.vutext + 8, BOOT.vutext + uploads[0].length + 8];
  return { elf, labels, uploads: starts.map((at, i) => ({ at, size: VU_PROGRAMS[i].pairs.length * 8, vuAddress: VU_PROGRAMS[i].vuAddress })) };
}

/** An IOP module whose code is `lines`, from 0, starting at its first. */
export function iopModule(lines) {
  const { bytes, labels } = assemble(lines, 0);
  const iopmod = Buffer.alloc(32);
  iopmod.writeUInt32LE(0xFFFFFFFF, 0);
  iopmod.writeUInt32LE(0, 4);
  iopmod.writeUInt32LE(bytes.length, 12);
  const elf = elfWith({ type: 0xFF80, flags: 1, entry: 0, sections: [
    { name: '.iopmod', type: 0x70000080, flags: 0, address: 0, bytes: iopmod },
    { name: '.text', type: 1, flags: 6, address: 0, bytes },
  ] });
  return { elf, labels, size: bytes.length };
}

/** An IOPRP image holding these modules, as { name: bytes }: its ROMDIR, then each file from a 16-byte boundary. */
export function iopImage(modules) {
  const entries = [['RESET', 0], ['ROMDIR', 0], ['EXTINFO', 0], ...Object.entries(modules).map(([name, bytes]) => [name, bytes.length])];
  const directory = Buffer.alloc((entries.length + 1) * 16);
  entries[1][1] = directory.length;
  entries.forEach(([name, size], i) => {
    directory.write(name, i * 16, 'latin1');
    directory.writeUInt32LE(size, i * 16 + 12);
  });
  return Buffer.concat([directory, ...Object.values(modules).map(bytes => Buffer.concat([bytes, Buffer.alloc((16 - bytes.length % 16) % 16)]))]);
}

/** A file of data with an upload of 8 pairs at `uploadAt` and an EE program at `programAt`. */
export function dataFile() {
  const pairs = Array.from({ length: 8 }, (_, i) => (i === 7 ? 'nop[e] nop' : `mul.xyzw vf0${i + 1}, vf01, vf02 iaddi vi01, vi01, 1`));
  const program = elfWith({ entry: 0x00200000, sections: [{ name: '.text', type: 1, flags: 6, address: 0x00200000, bytes: assemble(['jr $ra', 'nop'], 0x00200000).bytes }] });
  // bytes that are neither code nor a header: a run of numbers
  const filler = length => Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) & 0xFF));
  const parts = [filler(64), upload(pairs, 0x100), filler(60), program, filler(100)];
  const bytes = Buffer.concat(parts);
  return { bytes, uploadAt: 64 + 8, uploadSize: 64, programAt: 64 + 8 + 64 + 60, programSize: program.length };
}

/** A disc of 2 KB sectors, as an ISO file is, with each of `files` in the top folder or a folder of its own, named as
 *  a PlayStation disc's is. */
export function isoOf(files) {
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
  const folders = [...new Set(Object.keys(files).filter(path => path.includes('/')).map(path => path.split('/')[0]))];
  let next = 19 + folders.length;
  const placed = Object.entries(files).map(([path, bytes]) => {
    const at = next;
    next += Math.ceil(bytes.length / SECTOR) || 1;
    return { path, bytes, at };
  });
  const folderOf = (sector, parent, inside) => Buffer.concat([entry('\0', sector, SECTOR, true), entry('\x01', parent, SECTOR, true), ...inside]);
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
  folderOf(18, 18, [
    ...folders.map((name, n) => entry(name, 19 + n, SECTOR, true)),
    ...placed.filter(file => !file.path.includes('/')).map(file => entry(`${file.path};1`, file.at, file.bytes.length, false)),
  ]).copy(disc, 18 * SECTOR);
  folders.forEach((name, n) => folderOf(19 + n, 18, placed.filter(file => file.path.startsWith(`${name}/`)).map(file => entry(`${file.path.split('/')[1]};1`, file.at, file.bytes.length, false))).copy(disc, (19 + n) * SECTOR));
  for (const file of placed) file.bytes.copy(disc, file.at * SECTOR);
  return disc;
}

/** The whole made-up disc, and what's on it. */
export function madeUpPs2Disc() {
  const boot = bootProgram(), module = iopModule(MODULE), second = iopModule(['jr $ra', 'nop']), data = dataFile();
  const other = elfWith({ entry: 0x00300000, sections: [{ name: '.text', type: 1, flags: 6, address: 0x00300000, bytes: assemble(['other:', 'addiu $sp, $sp, -16', 'jr $ra', 'addiu $sp, $sp, 16'], 0x00300000).bytes }] });
  const disc = isoOf({
    'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\MADE_UP.ELF;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n'),
    'MADE_UP.ELF': boot.elf,
    'MADE_UP.IRX': module.elf,
    'IOPRP.IMG': iopImage({ SECOND: second.elf }),
    'OTHER.ELF': other,
    'DATA/MODELS.BIN': data.bytes,
  });
  return { disc, boot, module, second, data };
}
