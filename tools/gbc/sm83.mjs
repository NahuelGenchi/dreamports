// The Game Boy's processor's instructions, the Game Boy Color's too: what each one is called, how long it is, where it
// can send the processor, and how many cycles it takes, read from its bytes. The function finder follows a game's code
// with it (functions.mjs), and the function check runs a function with it (twin.mjs). It is written from how the
// processor is documented, and holds nothing of any game.
//
// An instruction's first byte splits into three fields, as the processor's own decoding does: its top two bits, the
// next three and the last three. The CB prefix has 256 more, all two bytes long.

const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const PAIR = ['BC', 'DE', 'HL', 'SP'], STACKED = ['BC', 'DE', 'HL', 'AF'];
const WHEN = ['NZ', 'Z', 'NC', 'C'];
const SUMS = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
const TURNS = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
const SHIFTS = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL'];
/** The bytes that are no instruction: the processor locks up on one. */
export const NONE = new Set([0xD3, 0xDB, 0xDD, 0xE3, 0xE4, 0xEB, 0xEC, 0xED, 0xF4, 0xFC, 0xFD]);

const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0'), hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * The instruction at `at` of `bytes`, as the processor at address `pc` would run it, or null where the byte is none:
 * { name, length, cycles, taken, flow, to, when }. `cycles` is what it takes, and `taken` what a jump, call or return
 * with a condition takes when it goes. `flow` says where it can send the processor: 'jump' and 'call' to `to`, 'near'
 * for a relative jump, also to `to`, 'rst' to one of the eight fixed places, 'return', 'reti', 'jumpHL' through HL,
 * 'halt' and 'stop', or undefined for one that goes on to the next. `when` is its condition's place in NZ, Z, NC, C,
 * or undefined for one that always goes.
 */
export function decode(bytes, at, pc = at) {
  const op = bytes[at];
  if (op === undefined || NONE.has(op)) return null;
  const x = op >> 6, y = op >> 3 & 7, z = op & 7, p = y >> 1, q = y & 1;
  const n = bytes[at + 1] ?? 0, nn = n | (bytes[at + 2] ?? 0) << 8, near = pc + 2 + (n << 24 >> 24) & 0xFFFF;
  const one = (name, cycles, more) => ({ name, length: 1, cycles, ...more });
  const two = (name, cycles, more) => ({ name, length: 2, cycles, ...more });
  const three = (name, cycles, more) => ({ name, length: 3, cycles, ...more });
  if (x === 1) return op === 0x76 ? one('HALT', 4, { flow: 'halt' }) : one(`LD ${R[y]},${R[z]}`, y === 6 || z === 6 ? 8 : 4);
  if (x === 2) return one(`${SUMS[y]}${R[z]}`, z === 6 ? 8 : 4);
  if (x === 0) {
    switch (z) {
      case 0:
        if (y === 0) return one('NOP', 4);
        if (y === 1) return three(`LD ($${hex4(nn)}),SP`, 20);
        if (y === 2) return two('STOP', 4, { flow: 'stop' });
        if (y === 3) return two(`JR $${hex4(near)}`, 12, { flow: 'near', to: near });
        return two(`JR ${WHEN[y - 4]},$${hex4(near)}`, 8, { taken: 12, flow: 'near', to: near, when: y - 4 });
      case 1: return q ? one(`ADD HL,${PAIR[p]}`, 8) : three(`LD ${PAIR[p]},$${hex4(nn)}`, 12);
      case 2: {
        const where = ['(BC)', '(DE)', '(HL+)', '(HL-)'][p];
        return one(q ? `LD A,${where}` : `LD ${where},A`, 8);
      }
      case 3: return one(`${q ? 'DEC' : 'INC'} ${PAIR[p]}`, 8);
      case 4: return one(`INC ${R[y]}`, y === 6 ? 12 : 4);
      case 5: return one(`DEC ${R[y]}`, y === 6 ? 12 : 4);
      case 6: return two(`LD ${R[y]},$${hex2(n)}`, y === 6 ? 12 : 8);
      default: return one(TURNS[y], 4);
    }
  }
  switch (z) {
    case 0:
      if (y < 4) return one(`RET ${WHEN[y]}`, 8, { taken: 20, flow: 'return', when: y });
      if (y === 4) return two(`LDH ($FF${hex2(n)}),A`, 12);
      if (y === 5) return two(`ADD SP,$${hex2(n)}`, 16);
      if (y === 6) return two(`LDH A,($FF${hex2(n)})`, 12);
      return two(`LD HL,SP+$${hex2(n)}`, 12);
    case 1:
      if (!q) return one(`POP ${STACKED[p]}`, 12);
      if (p === 0) return one('RET', 16, { flow: 'return' });
      if (p === 1) return one('RETI', 16, { flow: 'reti' });
      if (p === 2) return one('JP (HL)', 4, { flow: 'jumpHL' });
      return one('LD SP,HL', 8);
    case 2:
      if (y < 4) return three(`JP ${WHEN[y]},$${hex4(nn)}`, 12, { taken: 16, flow: 'jump', to: nn, when: y });
      if (y === 4) return one('LD (C),A', 8);
      if (y === 5) return three(`LD ($${hex4(nn)}),A`, 16);
      if (y === 6) return one('LD A,(C)', 8);
      return three(`LD A,($${hex4(nn)})`, 16);
    case 3:
      if (y === 0) return three(`JP $${hex4(nn)}`, 16, { flow: 'jump', to: nn });
      if (y === 1) {
        const cx = n >> 6, cy = n >> 3 & 7, cz = n & 7, memory = cz === 6;
        if (cx === 0) return two(`${SHIFTS[cy]} ${R[cz]}`, memory ? 16 : 8, { prefixed: true });
        return two(`${['', 'BIT', 'RES', 'SET'][cx]} ${cy},${R[cz]}`, memory ? (cx === 1 ? 12 : 16) : 8, { prefixed: true });
      }
      return one(y === 6 ? 'DI' : 'EI', 4);
    case 4: return three(`CALL ${WHEN[y]},$${hex4(nn)}`, 12, { taken: 24, flow: 'call', to: nn, when: y });
    case 5:
      if (!q) return one(`PUSH ${STACKED[p]}`, 16);
      return three(`CALL $${hex4(nn)}`, 24, { flow: 'call', to: nn });
    case 6: return two(`${SUMS[y]}$${hex2(n)}`, 8);
    default: return one(`RST $${hex2(y * 8)}`, 16, { flow: 'rst', to: y * 8 });
  }
}
