// Small PlayStation 2 programs that call the IOP's RPC servers, with nothing from any game in them, written here, for
// the console's real emulator to run in the tools' checks of the servers the kit answers as the emulator does: the
// disc drive's (ps2-disc.mjs) and the memory cards' (ps2-cards.mjs).
//
// A program is a list of calls. As it starts it tells the IOP where its replies go, binds each server it names, and
// makes its first calls, waiting for each reply in its memory, as a game's own SIF library does through the console's
// system calls (made-up-ps2-iop.mjs). Then each V-blank it makes its frame's calls, a call's argument able to follow
// the frame's number, and draws the flat program's picture. Whatever it's asked to keep of a call, words of what came
// back, of its own arguments or of a buffer the server filled, it puts in GS LABEL writes, which change nothing drawn,
// so its draw list carries them, every frame.
//
// rpcProgram gives the program as an ELF file and what its Dreamport in C needs to do the same from the program's own
// bytes: where each bind's and each call's transfers are, and where each thing it keeps is read from (made-up-ps2-rpc.c).

import { LOAD_AT, lw, sw, addiu, andi, li, here, bne, j, SYSCALL, NOP, setUp, waitForVBlank, send, elfOf, PACKET } from './made-up-ps2.mjs';

const ZERO = 0, V0 = 2, V1 = 3, A0 = 4, A1 = 5, T1 = 9, T2 = 10, S2 = 18, S3 = 19, S5 = 21;
const addu = (rd, rs, rt) => (rs << 21 | rt << 16 | rd << 11 | 0x21) >>> 0;
const GIF_DMA = 0x1000A000;
const SIF_INIT = 0x80000002, SIF_REND = 0x80000008, SIF_BIND = 0x80000009, SIF_CALL = 0x8000000A;
// the place a call's arguments are sent to, and how a bind's answer names its server
const RPC_ARGUMENTS = 0xDEADBEF0, SERVER_XOR = 0xACACACAC;

/** Text as the words of a zero-ended string, for a call's arguments. */
export function textWords(text, bytes) {
  const buffer = Buffer.alloc(bytes);
  buffer.write(text, 'latin1');
  return Array.from({ length: bytes / 4 }, (_, i) => buffer.readUInt32LE(i * 4));
}

/**
 * The program. `servers` are the RPC servers it binds, by number. `buffers` names stretches of its memory, each its
 * size in bytes or the bytes it starts with. `start` and `frame` are its calls, each { server, number, args, send,
 * receive, follows, keep }: `args` its arguments as words, one of them able to be { buffer } for a buffer's address;
 * `send` and `receive` how many bytes go and come back, `send` by default all of `args`; `follows`, { word, base, mask },
 * the argument that is base + (the frame's number & mask) on each frame; and `keep` what goes in LABEL writes after the
 * call, each { of: 'received' | 'args' | a buffer's name, word, label }.
 * Returns { elf, sha1, labels, forC }: the labels' names in order, and the tables its Dreamport is filled in with.
 */
export function rpcProgram({ servers, buffers = {}, start = [], frame = [] }) {
  const calls = [...start.map(call => ({ ...call, each: false })), ...frame.map(call => ({ ...call, each: true }))];
  const labels = calls.flatMap(call => (call.keep ?? []).map(kept => kept.label));
  if (new Set(labels).size !== labels.length) throw new Error('Two things kept under one label.');
  // everything after the GS's packet, each on a 16-byte boundary: its place from the start of the data, and its words,
  // which can need the data's own place
  const parts = [];
  let size = PACKET.length * 4;
  const part = (name, bytes, words) => {
    size = Math.ceil(size / 16) * 16;
    parts.push({ name, at: size, words });
    size += bytes;
  };
  const at = (packetAt, name) => packetAt + parts.find(p => p.name === name).at;
  const header = (bytes, command) => [bytes, 0, command, 0];
  part('reply', 64, () => Array(16).fill(0));
  part('init', 32, packetAt => [...header(20, SIF_INIT), at(packetAt, 'reply')]);
  part('initTransfers', 16, packetAt => [at(packetAt, 'init'), 0, 32, 0]);
  for (const [name, value] of Object.entries(buffers)) {
    const bytes = typeof value === 'number' ? Buffer.alloc(value) : Buffer.concat([Buffer.from(value), Buffer.alloc((4 - value.length % 4) % 4)]);
    part(`buffer ${name}`, bytes.length, () => Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4)));
  }
  servers.forEach((server, n) => {
    part(`client ${n}`, 64, () => Array(16).fill(0));
    part(`bind ${n}`, 48, packetAt => [...header(36, SIF_BIND), n, at(packetAt, `client ${n}`), n, at(packetAt, `client ${n}`), server]);
    part(`bindTransfers ${n}`, 16, packetAt => [at(packetAt, `bind ${n}`), 0, 48, 0]);
  });
  calls.forEach((call, n) => {
    const client = servers.indexOf(call.server);
    if (client < 0) throw new Error(`A call to a server the program doesn't bind: 0x${call.server.toString(16)}.`);
    const sent = call.send ?? call.args.length * 4, id = 0x100 + n;
    part(`args ${n}`, Math.max(16, Math.ceil(call.args.length / 4) * 16), packetAt => call.args.map(word => typeof word === 'object' ? at(packetAt, `buffer ${word.buffer}`) : word >>> 0));
    part(`received ${n}`, Math.max(16, Math.ceil((call.receive ?? 0) / 16) * 16), () => []);
    part(`call ${n}`, 64, packetAt => [...header(56, SIF_CALL), id, at(packetAt, `client ${client}`), id, at(packetAt, `client ${client}`), call.number, sent, at(packetAt, `received ${n}`), call.receive ?? 0, 0, (call.server ^ SERVER_XOR) >>> 0]);
    part(`callTransfers ${n}`, 32, packetAt => [at(packetAt, `args ${n}`), RPC_ARGUMENTS, Math.ceil(sent / 16) * 16, 0, at(packetAt, `call ${n}`), 0, 64, 0]);
  });
  part('labels', 16 + labels.length * 16, () => [labels.length | 0x8000, 0x10000000, 0xE, 0, ...labels.flatMap(() => [0, 0, 0x62, 0])]);
  const dataOf = packetAt => {
    const words = [...PACKET, ...Array(Math.ceil(size / 4) - PACKET.length).fill(0)];
    for (const { at: place, words: made } of parts) made(packetAt).forEach((word, i) => { words[place / 4 + i] = word; });
    return words;
  };
  // where a thing kept is read from
  const keptAt = (packetAt, n, kept) => at(packetAt, kept.of === 'received' ? `received ${n}` : kept.of === 'args' ? `args ${n}` : `buffer ${kept.of}`) + kept.word * 4;
  const labelAt = (packetAt, name) => at(packetAt, 'labels') + 16 + labels.indexOf(name) * 16;

  const program = packetAt => {
    const system = (number, a0, a1) => [addiu(V1, ZERO, number), ...li(A0, a0), addiu(A1, ZERO, a1), SYSCALL, NOP];
    // SifSetDma(transfers, count), the transfer to the IOP's command buffer given its place first
    const sendTo = (transfers, count) => [...li(T1, at(packetAt, transfers) + (count - 1) * 16 + 4), sw(S2, 0, T1), ...system(0x77, at(packetAt, transfers), count)];
    // waiting for the IOP's reply, then saying it's been taken, as the SIF's interrupt handler does
    const waitFor = name => [
      ...li(T1, at(packetAt, 'reply')), ...li(T2, SIF_REND),
      here(`waiting ${name}`), lw(V0, 8, T1), bne(V0, T2, `waiting ${name}`), NOP,
      sw(ZERO, 8, T1),
      addiu(V1, ZERO, -0x78), SYSCALL, NOP,
    ];
    const made = (call, n) => [
      ...(call.follows ? [andi(T2, S5, call.follows.mask), ...li(T1, call.follows.base), addu(T2, T2, T1), ...li(T1, at(packetAt, `args ${n}`) + call.follows.word * 4), sw(T2, 0, T1)] : []),
      ...sendTo(`callTransfers ${n}`, 2), ...waitFor(`call ${n}`),
      ...(call.keep ?? []).flatMap(kept => [...li(T1, keptAt(packetAt, n, kept)), lw(V0, 0, T1), ...li(T1, labelAt(packetAt, kept.label)), sw(V0, 0, T1)]),
    ];
    return [
      ...setUp(packetAt),
      // the IOP's command buffer, from SifGetReg(2), kept in S2
      addiu(V1, ZERO, 0x7A), addiu(A0, ZERO, 2), SYSCALL, NOP, addiu(S2, V0, 0),
      ...sendTo('initTransfers', 1),
      ...servers.flatMap((_, n) => [...sendTo(`bindTransfers ${n}`, 1), ...waitFor(`bind ${n}`)]),
      ...calls.flatMap((call, n) => call.each ? [] : made(call, n)),
      ...li(S3, at(packetAt, 'labels')), addiu(S5, ZERO, 0),
      here('frame'),
      ...waitForVBlank,
      ...calls.flatMap((call, n) => call.each ? made(call, n) : []),
      addiu(S5, S5, 1),
      ...send(PACKET),
      ...send({ length: 4 + labels.length * 4 }, GIF_DMA, S3, 'labels'),
      j('frame'), NOP,
    ];
  };
  // the code's size doesn't depend on where its data is
  const codeWords = program(0).filter(item => !item.here).length, packetAt = LOAD_AT + Math.ceil(codeWords * 4 / 16) * 16;
  const hex = value => `0x${(value >>> 0).toString(16).toUpperCase()}`;
  const forC = {
    REPLY: hex(at(packetAt, 'reply')), INIT_TRANSFERS: hex(at(packetAt, 'initTransfers')), LABELS: labels.length || 1,
    BINDS: `{ ${servers.map((_, n) => hex(at(packetAt, `bindTransfers ${n}`))).join(', ')} }`,
    CALLS: `{ ${calls.map((call, n) => `{ ${call.each ? 1 : 0}, ${hex(at(packetAt, `callTransfers ${n}`))}, ${call.follows ? hex(at(packetAt, `args ${n}`) + call.follows.word * 4) : 0}, ${hex(call.follows?.base ?? 0)}, ${hex(call.follows?.mask ?? 0)}, ${(call.keep ?? []).length}, { ${(call.keep ?? []).map(kept => `{ ${hex(keptAt(packetAt, n, kept))}, ${labels.indexOf(kept.label)} }`).join(', ') || '{ 0, 0 }'} } }`).join(', ')} }`,
  };
  return { ...elfOf(program, dataOf(packetAt)), labels, forC };
}
