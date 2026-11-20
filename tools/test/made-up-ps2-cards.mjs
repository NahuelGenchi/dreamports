// The memory card program of the tools' check of the PlayStation 2 kit's memory cards (ps2-cards.mjs): a disc of the
// project's own whose program, through the memory cards' RPC server (made-up-ps2-rpc.mjs), sets the server up, asks
// about the card in the first port twice, makes a folder and goes into it, makes a file, writes it, moves in it, reads
// it back and closes it, makes a file whose name the emulator can't keep as it is, lists the folder a few entries at a
// time, gives a file another name, tries to delete what it can't, and asks what the server doesn't know. Then each
// frame it writes the frame's number over a file's first bytes and lists the folder again, so the file's time is seen
// to move with the console's clock. What comes back goes in its draw list, and the cards themselves are compared.

import { rpcProgram, textWords } from './made-up-ps2-rpc.mjs';
import { madeUpPs2Iso, systemCnf } from './made-up-ps2-iso.mjs';

const CARDS = 0x80000400;
const CREATE = 0x203, FOLDER = 0x40, ENTRY = 64;

// a call that names something: the port, the slot, its flags, how many entries, a table, and the name
const named = (number, name, { flags = 0, most = 0, table = 0, port = 0, keep = [] } = {}) =>
  ({ server: CARDS, number, args: [port, 0, flags, most, table, ...textWords(name, 0x400)], receive: 4, keep });
// a call on an open file: its handle, how many bytes, where to, from where, a buffer, the two words read with it, and
// the bytes that go with the call
const onFile = (number, handle, { size = 0, offset = 0, origin = 0, buffer = 0, param = 0, data = [0, 0, 0, 0], keep = [], follows } = {}) =>
  ({ server: CARDS, number, args: [handle, 0, 0, size, offset, origin, buffer, param, ...data], receive: 4, keep, ...(follows ? { follows } : {}) });
const result = label => ({ of: 'received', word: 0, label });
// an entry of a listing: the words of its two times, its size and attributes, and its name's first word
const entry = (table, n, label) => [2, 3, 4, 5, 8].map(word => ({ of: table, word: n * ENTRY / 4 + word, label: `${label} ${word}` }));

function program() {
  const renamed = Buffer.alloc(ENTRY);
  renamed.write('RENAMED', 32, 'latin1');
  return rpcProgram({
    servers: [CARDS],
    buffers: { info: 0x100, folder: 0x100, written: Buffer.from('The made-up save'), read: 16, param: 16, first: ENTRY * 2, rest: ENTRY * 8, renamed, each: ENTRY * 8 },
    start: [
      { server: CARDS, number: 0xFE, args: Array(12).fill(0), receive: 12, keep: [0, 1, 2].map(word => ({ of: 'received', word, label: `set up ${word}` })) },
      { server: CARDS, number: 0x01, args: [0, 0, 0, 1, 1, 1, 0, { buffer: 'info' }], receive: 4,
        keep: [result('a new card'), { of: 'info', word: 0, label: 'kind' }, { of: 'info', word: 1, label: 'free' }, { of: 'info', word: 0x24, label: 'formatted' }] },
      { server: CARDS, number: 0x01, args: [0, 0, 0, 0, 0, 0, 0, { buffer: 'info' }], receive: 4, keep: [result('the same card')] },
      { server: CARDS, number: 0x01, args: [0, 2, 0, 0, 0, 0, 0, { buffer: 'info' }], receive: 4, keep: [result('no third port')] },
      named(0x02, '/MADEUP', { flags: FOLDER, keep: [result('folder made')] }),
      named(0x02, '/MADEUP', { flags: FOLDER, keep: [result('folder made twice')] }),
      named(0x02, '/NONE/DEEP', { flags: FOLDER, keep: [result('folder in none')] }),
      named(0x0C, '/NONE', { table: { buffer: 'folder' }, keep: [result('into none'), { of: 'folder', word: 0, label: 'was at the top' }] }),
      named(0x0C, '/MADEUP', { keep: [result('into the folder')] }),
      named(0x0C, '..', { table: { buffer: 'folder' }, keep: [result('up'), { of: 'folder', word: 0, label: 'was in 0' }, { of: 'folder', word: 1, label: 'was in 1' }] }),
      named(0x0C, 'MADEUP', { keep: [result('into the folder again')] }),
      named(0x02, 'MISSING', { flags: 1, keep: [result('no such file')] }),
      named(0x02, 'SAVE', { flags: CREATE, keep: [result('file made')] }),
      onFile(0x06, 0, { size: 16, origin: 4, buffer: { buffer: 'written' }, data: [0x44434241, 0, 0, 0], keep: [result('written')] }),
      onFile(0x04, 0, { offset: 2, origin: 0, keep: [result('moved')] }),
      onFile(0x04, 0, { offset: -1 >>> 0, origin: 2, keep: [result('moved from the end')] }),
      onFile(0x04, 0, { offset: -17 >>> 0, origin: 1, keep: [result('moved back')] }),
      onFile(0x05, 0, { size: 16, buffer: { buffer: 'read' }, param: { buffer: 'param' }, keep: [result('read'), ...[0, 1, 2, 3].map(word => ({ of: 'read', word, label: `read ${word}` }))] }),
      onFile(0x05, 0, { size: 16, buffer: { buffer: 'read' }, keep: [result('read the end')] }),
      onFile(0x05, 0, { size: 16, buffer: { buffer: 'read' }, keep: [result('read past the end')] }),
      onFile(0x0A, 0, { keep: [result('flushed')] }),
      onFile(0x03, 0, { keep: [result('closed')] }),
      onFile(0x03, 0, { keep: [result('closed twice')] }),
      onFile(0x05, 3, { size: 16, buffer: { buffer: 'read' }, keep: [result('read with no file')] }),
      named(0x02, 'A:B', { flags: CREATE, keep: [result('odd name made')] }),
      onFile(0x1B, 0, { size: 8, buffer: { buffer: 'written' }, keep: [result('written fast')] }),
      onFile(0x03, 0, { keep: [result('odd name closed')] }),
      named(0x02, 'EACH', { flags: CREATE, keep: [result('each made')] }),
      onFile(0x03, 0, { keep: [result('each closed')] }),
      named(0x02, 'INSIDE', { flags: FOLDER, keep: [result('folder inside')] }),
      named(0x02, 'INSIDE/DEEP', { flags: CREATE, keep: [result('deep made')] }),
      onFile(0x03, 0, { keep: [result('deep closed')] }),
      named(0x0D, '/MADEUP/*', { most: 2, table: { buffer: 'first' }, keep: [result('listed first'), { of: 'first', word: 8, label: 'here' }, { of: 'first', word: ENTRY / 4 + 8, label: 'above' }, { of: 'first', word: 5, label: 'here is a folder' }] }),
      named(0x0D, '/MADEUP/*', { flags: 1, most: 8, table: { buffer: 'rest' }, keep: [result('listed the rest'), ...entry('rest', 0, 'odd name'), { of: 'rest', word: ENTRY * 2 / 4 + 4, label: 'folder holds' }] }),
      named(0x0D, '/MADEUP/*', { flags: 1, most: 8, table: { buffer: 'rest' }, keep: [result('listed no more')] }),
      named(0x0D, '/*', { most: 8, table: { buffer: 'rest' }, keep: [result('listed the top'), ...entry('rest', 2, 'top')] }),
      named(0x0D, '/NONE/*', { most: 8, table: { buffer: 'rest' }, keep: [result('listed none')] }),
      named(0x0D, 'S?VE*', { most: 8, table: { buffer: 'rest' }, keep: [result('listed by a pattern'), ...entry('rest', 0, 'pattern')] }),
      named(0x0E, 'SAVE', { flags: 0x10, table: { buffer: 'renamed' }, keep: [result('renamed')] }),
      named(0x0E, 'SAVE', { flags: 0x10, table: { buffer: 'renamed' }, keep: [result('renamed none')] }),
      named(0x0F, '/MADEUP', { keep: [result('folder not empty')] }),
      named(0x0F, 'A:B', { keep: [result('odd name not found')] }),
      named(0x0F, 'INSIDE/DEEP', { keep: [result('deep deleted')] }),
      named(0x0F, 'INSIDE', { keep: [result('inside deleted')] }),
      named(0x12, '/MADEUP', { keep: [result('room in the folder')] }),
      named(0x12, '/NONE', { keep: [result('room in none')] }),
      named(0x14, '', { keep: [result('priority')] }),
      named(0x15, '', { keep: [result('slots')] }),
    ],
    frame: [
      named(0x02, '/MADEUP/EACH', { flags: CREATE, keep: [result('each opened')] }),
      onFile(0x06, 0, { origin: 4, follows: { word: 8, base: 0x1000, mask: 0xFF }, keep: [result('each written')] }),
      onFile(0x03, 0, { keep: [result('each closed again')] }),
      named(0x0D, '/MADEUP/*', { most: 8, table: { buffer: 'each' }, keep: [result('each listed'), ...entry('each', 3, 'each')] }),
    ],
  });
}

/** The disc, as an ISO file, with the program it boots, { disc, elf, sha1, labels, forC, sectors }. */
export function madeUpPs2Cards() {
  const made = program();
  return { ...made, ...madeUpPs2Iso({ 'SYSTEM.CNF': systemCnf('MADE_UP.ELF'), 'MADE_UP.ELF': made.elf }) };
}
