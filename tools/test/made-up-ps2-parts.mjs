// A made-up PlayStation 2 disc whose functions each first run in a frame the test knows, with nothing from any game in
// it, for the check of what `prove` says each part of a game runs (ps2-part-functions.mjs). A function is found
// running on the console in three ways, and the disc has one of each, beside those that run from the start:
//
// - in the program the disc boots, `always`, which the frame loop calls every frame, and `later`, which it calls from
//   frame LATER_FROM of its own count on;
// - in a vector unit's program, which the EE uploads to vector unit 1 and starts from frame UNIT_FROM on: the
//   counter of the function check's own file of programs (ps2-twin/module.mjs), which the disc has as UNIT.BIN, so the
//   code map knows it by its place in that file. The two programs beside it in the file are never uploaded;
// - in a module for the IOP, the sound program's own (made-up-ps2-iop.mjs), which the disc has as SOUND.IRX: it starts
//   as the program does, and its server's function runs only when the EE calls the server, from frame SERVE_FROM on.
//
// The program is the sound program with those added, so it draws what that draws.

import { T1, T2, addiu, lw, sw, li, here, imm, jal, bne, JR_RA, NOP, send, VIF1_DMA, ZERO } from './made-up-ps2.mjs';
import { madeUpPs2Sound, moduleData, soundIrx } from './made-up-ps2-iop.mjs';
import { madeUpPs2Iso, systemCnf } from './made-up-ps2-iso.mjs';
import { madeUpUnit } from './ps2-twin/module.mjs';

/** The frames, of the program's own count from its first V-blank, each thing first runs in. */
export const LATER_FROM = 20, UNIT_FROM = 40, SERVE_FROM = 60;
const slti = (rt, rs, value) => imm(0x0A, rs, rt, value);

/**
 * The disc: { disc, sha1 of the program, boot, unit, module }, with `unit` the vector unit program it runs, { key,
 * word }, its key in the code map and its first pair's lower word, `others` the keys of the two it never uploads,
 * and `module` the module's functions by name, each its place from the module's start.
 */
export function madeUpPs2Parts() {
  const file = madeUpUnit(), counter = file.programs.find(program => program.name === 'counter');
  // the upload as the VIF takes it, from the file's own bytes: its NOP and MPG, the pairs, then MSCAL to where the
  // unit keeps them and FLUSH, to a whole quadword
  const upload = file.bytes.subarray(counter.at - 8, counter.at + counter.size);
  const words = [...Array.from({ length: upload.length / 4 }, (_, i) => upload.readUInt32LE(i * 4)), (0x14000000 | counter.unit / 8) >>> 0, 0x11000000];
  while (words.length % 4) words.push(0);
  const skip = (register, from, name, code) => [slti(T2, register, from), bne(T2, ZERO, name), NOP, ...code, here(name)];
  const counted = (name, at) => [here(name), ...li(T1, at), lw(T2, 0, T1), addiu(T2, T2, 1), sw(T2, 0, T1), JR_RA, NOP];
  const made = madeUpPs2Sound({
    serveFrom: SERVE_FROM,
    more: {
      data(put) {
        put('counts', [0, 0, 0, 0]);
        put('upload', words);
      },
      frame: ({ at, frame }) => [
        jal('always'), NOP,
        ...skip(frame, LATER_FROM, 'notLater', [jal('later'), NOP]),
        ...skip(frame, UNIT_FROM, 'noUnit', [...li(T2, at('upload')), ...send(words, VIF1_DMA, T2, 'unit')]),
      ],
      after: ({ at }) => [...counted('always', at('counts')), ...counted('later', at('counts') + 4)],
    },
  });
  const hex = number => number.toString(16).toUpperCase().padStart(8, '0');
  const { disc, sectors } = madeUpPs2Iso({ 'SYSTEM.CNF': systemCnf('MADE_UP.ELF'), 'MADE_UP.ELF': made.elf, 'SOUND.IRX': soundIrx(), 'UNIT.BIN': file.bytes });
  return {
    disc, sectors, elf: made.elf,
    unit: { key: `${hex(counter.at)}@UNIT.BIN~vu`, word: file.bytes.readUInt32LE(counter.at), at: counter.unit },
    others: file.programs.filter(program => program !== counter).map(program => `${hex(program.at)}@UNIT.BIN~vu`),
    module: moduleData(),
  };
}
