// The disc program of the tools' check of the PlayStation 2 kit's disc drive (ps2-disc.mjs): a disc of the project's own
// whose program, through the IOP's RPC servers (made-up-ps2-rpc.mjs), sets the drive up, asks the kind of disc, the
// clock, whether the disc has two layers and whether it's ready, searches for a file by its path, and then each frame
// reads one of the file's sectors, a different one each frame, and the clock, keeping what comes back in its draw list.

import { rpcProgram, textWords } from './made-up-ps2-rpc.mjs';
import { SECTOR, madeUpPs2Iso, systemCnf } from './made-up-ps2-iso.mjs';

const INIT = 0x80000592, DRIVE = 0x80000593, READ = 0x80000595, SEARCH = 0x80000597, READY = 0x8000059C;
/** The file the program reads, DATA.BIN: how many sectors it has, and its bytes, which say which sector they're in. */
export const DATA_SECTORS = 8;
export const dataFile = () => Buffer.from(Array.from({ length: DATA_SECTORS * SECTOR }, (_, i) => (i * 7 + (i >> 11) * 31 + (i >> 3)) & 0xFF));

function program(dataAt) {
  const search = [...Array(9).fill(0), ...textWords('\\DATA.BIN;1', 0x128 - 0x24)];
  return rpcProgram({
    servers: [INIT, DRIVE, READ, SEARCH, READY],
    buffers: { sector: SECTOR },
    start: [
      { server: INIT, number: 0, args: [0], receive: 16, keep: [{ of: 'received', word: 3, label: 'init' }] },
      { server: DRIVE, number: 0x03, args: [0], receive: 4, keep: [{ of: 'received', word: 0, label: 'disc type' }] },
      { server: DRIVE, number: 0x01, args: [0], receive: 12, keep: [0, 1, 2].map(word => ({ of: 'received', word, label: `clock ${word}` })) },
      { server: DRIVE, number: 0x27, args: [0], receive: 12, keep: [0, 1, 2].map(word => ({ of: 'received', word, label: `layers ${word}` })) },
      { server: DRIVE, number: 0x0C, args: [0], receive: 4, keep: [{ of: 'received', word: 0, label: 'status' }] },
      { server: READY, number: 0, args: [0], receive: 4, keep: [{ of: 'received', word: 0, label: 'ready' }] },
      { server: SEARCH, number: 0, args: search, receive: 4, keep: [{ of: 'received', word: 0, label: 'found' }, { of: 'args', word: 0, label: 'file sector' }, { of: 'args', word: 1, label: 'file size' }] },
      { server: SEARCH, number: 0, args: [...Array(9).fill(0), ...textWords('\\NONE.BIN;1', 0x128 - 0x24)], receive: 4, keep: [{ of: 'received', word: 0, label: 'not found' }] },
    ],
    frame: [
      { server: READ, number: 0x01, args: [0, 1, { buffer: 'sector' }, 0], receive: 4, follows: { word: 0, base: dataAt, mask: DATA_SECTORS - 1 },
        keep: [{ of: 'received', word: 0, label: 'read' }, { of: 'sector', word: 0, label: 'sector first' }, { of: 'sector', word: SECTOR / 4 - 1, label: 'sector last' }] },
      { server: DRIVE, number: 0x01, args: [0], receive: 12, keep: [{ of: 'received', word: 1, label: 'clock now' }] },
    ],
  });
}

/** The disc, as an ISO file, with the program it boots, { disc, elf, sha1, labels, forC, sectors }. */
export function madeUpPs2Reads() {
  const files = made => ({ 'SYSTEM.CNF': systemCnf('MADE_UP.ELF'), 'MADE_UP.ELF': made.elf, 'DATA.BIN': dataFile() });
  // where the file lands doesn't depend on what the program holds, only on how long it is
  const { sectors } = madeUpPs2Iso(files(program(0)));
  const made = program(sectors['DATA.BIN'].at);
  return { ...made, ...madeUpPs2Iso(files(made)) };
}
