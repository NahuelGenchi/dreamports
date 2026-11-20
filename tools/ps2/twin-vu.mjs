// The function check for a PlayStation 2 game's vector unit programs (twin.mjs): a microprogram the game uploads to
// vector unit 1, run by itself in Play!'s vector unit from the unit's memory and registers to its E bit (call.cpp,
// original.mjs), and its twin, the program written again in C on the kit's unit (kit/ps2/c/ps2.h, vu_program), are
// started from the same registers and data memory, and what each leaves is compared: every register, VF, ACC, VI, Q, I,
// P and R, the status, MAC and clip flags, the data memory byte for byte, each packet sent to the GS with XGKICK, in
// order, and where the program stopped, which the twin gives back.
//
// A twin names its program by the code map's key, the EE address of the upload's first pair in the program the disc
// boots, or its place in a file, with ~vu: /** 0x00340010~vu: what it does */. It takes nothing, as a microprogram is
// given everything in the unit's registers and memory, and gives back the address in the unit's code memory after its
// last pair.
//
// The unit's own memory is read and written directly in the emulator, so the original doesn't say what it read: every
// call starts from any registers, and from the data memory with a few words changed, mostly where the unit's whole
// numbers point, as a program reaches its memory through them. A packet is compared as the bytes the GS is sent, from
// the tag XGKICK names to the tag that ends it, read by one rule on both sides (packetOf), so neither side's GIF
// decides it.

import { CAME_BACK, ELSEWHERE, EXCEPTION, imageAfter, OUT_OF_STEPS, VU_REGISTERS, endText } from './original.mjs';

const V = VU_REGISTERS, DATA = 0x4000;
// how many calls may be made for each one that has to be compared
const TRIES = 4;
/** How many of a call's packets the twin's side keeps whole. */
export const KICKS = 16;

/**
 * The check's own C in a build of a unit's twins: it keeps each packet a program in C sends, in place of the kit's
 * own vu_kicked, which does nothing: how many, where each starts, and the unit's data memory as each was sent.
 */
export const KICKS_CODE = `
static unsigned __twin_kick_list[1 + ${KICKS}];
static unsigned char __twin_kick_memory[${KICKS} * ${DATA}];
void vu_kicked(const unsigned char *memory, unsigned size, unsigned at) {
  unsigned n = __twin_kick_list[0]++;
  if (n >= ${KICKS} || size != ${DATA}) return;
  __twin_kick_list[1 + n] = at;
  __builtin_memcpy(__twin_kick_memory + n * ${DATA}, memory, ${DATA});
}
__attribute__((export_name("__twin_kicks"))) unsigned *__twin_kicks(void) { return __twin_kick_list; }
__attribute__((export_name("__twin_kicked"))) unsigned char *__twin_kicked(void) { return __twin_kick_memory; }
`;

/** The status flag as a unit's program and the EE read it, from how Play! keeps it: the MAC flag's four fields of
 *  each kind, their sticky bits, and the division's two with theirs, which it keeps where the flag has them. */
export function statusOf(mac, sticky, divide) {
  return [0x000F, 0x00F0, 0x0F00, 0xF000].reduce((status, fields, bit) => status | (mac & fields ? 1 << bit : 0) | (sticky & fields ? 0x40 << bit : 0), divide >>> 0) >>> 0;
}

/** A unit's registers as the kit's vu_registers has them, from the words the original's side gives and leaves
 *  (VU_REGISTERS): VF0 and VI0 as they always read, the whole numbers' 16 bits, and the status flag as one word. */
export function unitWords(raw) {
  const words = raw.map(word => word >>> 0);
  words[V.vf] = words[V.vf + 1] = words[V.vf + 2] = 0;
  words[V.vf + 3] = 0x3F800000;
  words[V.vi] = 0;
  for (let n = 1; n < 16; n++) words[V.vi + n] &= 0xFFFF;
  words[V.status] = statusOf(raw[V.mac], raw[V.status], raw[V.divide]);
  words[V.divide] = 0;
  return words;
}

/** A word of a unit's registers by its name, as a line says it. */
export function unitRegister(k) {
  const field = 'xyzw'[k & 3];
  if (k < V.acc) return `VF${k >> 2}.${field}`;
  if (k < V.vi) return `ACC.${field}`;
  if (k < V.q) return `VI${k - V.vi}`;
  return { [V.q]: 'Q', [V.i]: 'I', [V.p]: 'P', [V.r]: 'R', [V.status]: 'status flag', [V.mac]: 'MAC flag', [V.clip]: 'clip flag', [V.top]: 'TOP', [V.itop]: 'ITOP' }[k] ?? `word ${k}`;
}

/** The packet XGKICK sends from `at` in a unit's data memory: the bytes from that quadword, tag after tag, to the
 *  tag that ends the packet, going round to the memory's start past its end, and no more than the memory holds. */
export function packetOf(memory, at) {
  const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength), bytes = [];
  for (at &= DATA - 16; ;) {
    const low = view.getUint32(at, true), high = view.getUint32(at + 4, true);
    const loops = low & 0x7FFF, last = low >>> 15 & 1, registers = (high >>> 28) || 16, format = high >>> 26 & 3;
    const quadwords = 1 + (format === 0 ? loops * registers : format === 1 ? (loops * registers + 1) >> 1 : loops);
    for (let q = 0; q < quadwords; q++) {
      for (let n = 0; n < 16; n++) bytes.push(memory[at + n]);
      at = (at + 16) & (DATA - 1);
    }
    if (last || bytes.length >= DATA) break;
  }
  return Uint8Array.from(bytes);
}

/**
 * Calls one microprogram of the original and its twin until `options.calls` calls were compared. `f` is { name, call,
 * address, size }, `address` where the program starts in the unit's code memory, and `image` the unit's image, its
 * data memory and then its code memory with the program in it. Answers { compared, aside, ran, result }, as the EE's
 * check does (twin.mjs, checkFunction).
 */
export async function checkProgram({ f, original, runner, options, choose, image }) {
  const ran = new Map(), aside = {};
  let compared = 0, number = 0;
  while (compared < options.calls && number < options.calls * TRIES) {
    number++;
    // any registers, as the unit holds them: the flags as Play! keeps them, the status flag's sticky bits a field
    // of the MAC flag each, and its division bits where the flag has them
    const registers = Array.from({ length: V.words }, () => choose.next());
    registers[V.vf] = registers[V.vf + 1] = registers[V.vf + 2] = 0;
    registers[V.vf + 3] = 0x3F800000;
    registers[V.vi] = 0;
    for (let n = 1; n < 16; n++) registers[V.vi + n] = choose.below(3) ? choose.below(0x400) : registers[V.vi + n] & 0xFFFF;
    registers[V.r] = (registers[V.r] & 0x007FFFFF) | 0x3F800000;
    registers[V.mac] &= 0xFFFF;
    registers[V.status] = [0x000F, 0x00F0, 0x0F00, 0xF000].reduce((sticky, fields) => sticky | (choose.below(2) ? fields : 0), 0);
    registers[V.clip] &= 0xFFFFFF;
    registers[V.divide] &= 0xC30;
    registers[V.top] = choose.below(0x400);
    registers[V.itop] = choose.below(0x400);
    // a few words of the data memory changed: near its start, or where one of the unit's whole numbers points
    const changes = [];
    for (let k = choose.below(4); k; k--) {
      const at = choose.below(2) ? choose.below(0x100) * 4 : (registers[V.vi + 1 + choose.below(15)] * 16 + choose.below(8) * 4) & (DATA - 4);
      changes.push([at, 4, choose.sized(4, [])]);
    }
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, registers, changes });
    const reason = answer.end === CAME_BACK ? null : answer.end === ELSEWHERE ? 'elsewhere' : answer.end === EXCEPTION ? 'exception' : answer.end === OUT_OF_STEPS ? 'steps' : 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    // a program that writes its own code memory is none a twin in C can follow
    if (answer.chunks.some(chunk => chunk.at >= DATA)) {
      aside.code = (aside.code ?? 0) + 1;
      continue;
    }
    const before = imageAfter(image, changes, [], 'vu1').subarray(0, DATA), after = imageAfter(image, changes, answer.chunks, 'vu1').subarray(0, DATA);
    const twin = await runner.call(f.call, [], [], [], [], { number: 1, words: unitWords(registers), memory: before });
    const call = { number, args: [], changes, hardware: 0 };
    if (twin.never) return { compared, aside, ran, result: { kind: 'never', ...call } };
    if (twin.stopped === 'unbuilt') {
      aside.unbuilt = (aside.unbuilt ?? 0) + 1;
      aside.unbuiltText ??= twin.unbuilt;
      continue;
    }
    if (twin.stopped) return { compared, aside, ran, result: { kind: 'stopped', why: twin.stopped, ...call } };
    const differs = what => ({ compared, aside, ran, result: { kind: 'differs', ...what, ...call } });
    // where it stopped, its registers, its data memory, and its packets
    const stopped = Number(BigInt.asUintN(32, BigInt(twin.gave)));
    if (stopped !== answer.pc >>> 0) return differs({ gave: { ours: BigInt(stopped), theirs: BigInt(answer.pc >>> 0), float: false, digits: 8, stop: true } });
    const theirs = unitWords(answer.registers), k = theirs.findIndex((word, n) => word !== twin.unit[n] >>> 0);
    if (k >= 0) return differs({ register: { unit: 1, name: unitRegister(k), ours: twin.unit[k] >>> 0, theirs: theirs[k] } });
    const byte = after.findIndex((value, n) => value !== twin.memory[n]);
    if (byte >= 0) return differs({ memory: { address: byte, name: 'vector unit 1\'s data memory', ours: twin.memory[byte], theirs: after[byte] } });
    if (twin.kicks.length !== answer.kicks.length && (twin.kicks.length < KICKS || answer.kicks.length < KICKS)) return differs({ packet: { count: { ours: twin.kicks.length, theirs: answer.kicks.length } } });
    for (let n = 0; n < Math.min(twin.kicks.length, answer.kicks.length, KICKS); n++) {
      const ours = packetOf(twin.kicks[n].memory, twin.kicks[n].at), sent = answer.kicks[n];
      if (twin.kicks[n].at !== sent.at) return differs({ packet: { number: n + 1, at: { ours: twin.kicks[n].at, theirs: sent.at } } });
      const at = ours.length !== sent.bytes.length ? Math.min(ours.length, sent.bytes.length) : ours.findIndex((value, m) => value !== sent.bytes[m]);
      if (at >= 0) return differs({ packet: { number: n + 1, byte: at, ours: ours[at] ?? null, theirs: sent.bytes[at] ?? null } });
    }
    compared++;
    answer.ran.forEach((ways, i) => { if (ways) ran.set(f.address + i * 8, (ran.get(f.address + i * 8) ?? 0) | ways); });
  }
  return { compared, aside, ran, result: null };
}
