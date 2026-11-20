// What a Super Nintendo twin is given and gives back: its contract. A function of the original takes and gives values
// in the 65816's registers and flags, A, X, Y, the direct page D, the data bank DB, the stack S, and N, V, Z and C, and
// nothing in C says which, so each twin has a line beside it, in a comment, as the NES's have (../nes/twin.mjs):
//
//   // dp:twin sub_808060 a16i16 sum(&A, X)
//   // dp:twin sub_808066 a8i16 fill(A, &X, &Y, DB) if Y < 0x400
//   // dp:twin sub_808080 a16i16>a8i16 leaves8()
//   // dp:twin sub_808073 a16i16 lookup(X) -> A
//
// After `dp:twin` comes the original's function, named as a game's code names one, a word and its address in six
// hexadecimal digits (functions.mjs), then the processor's mode it starts in, as the code map writes modes, and after
// a `>` the mode it leaves, when the function changes it, as one can and its caller relies on; with no mode the code
// map's. Then the call of the twin, in C, with the registers and flags it's given written as themselves, each a whole
// number: A and the rest of 16 bits, DB of 8, a flag 0 or 1. A register or flag given with `&` is one the twin changes,
// and it's compared with the original's afterwards, all its bits. After `->` comes what the twin's result has to
// equal, in C, of the original's registers and flags once it has come back. After `if` comes what the game gives it,
// of the registers and flags: the check calls it with nothing else. A register the contract doesn't name gets any
// value, so a function that reads one the contract leaves out differs; the decimal flag, BCD, is clear unless the
// contract names it, as games keep it clear. The line is C, so the compiler reads it against the twin as it's
// declared.

import { MODES } from './65816.mjs';

/** The registers and flags a contract can name, as C's own variables in it, and those it can mark with `&`. */
export const NAMES = ['A', 'X', 'Y', 'S', 'D', 'DB', 'N', 'V', 'Z', 'C', 'I', 'BCD'];
const CHANGED = /&\s*(A|X|Y|S|DB|D|N|V|Z|C|I|BCD)\b/g;

/**
 * The contracts in a file of a game's C: { contracts, errors }. Each contract is { label, address, line, text, call,
 * name, mode, leaves, back, given, changed }: `address` the one in its label, as the original's code runs at it,
 * `name` the C function its call calls, `mode` and `leaves` null where the line names none, and `changed` the names
 * marked with `&`. `errors` are what couldn't be read, each with its line.
 */
export function contractsIn(text) {
  const contracts = [], errors = [];
  text.split('\n').forEach((whole, i) => {
    const line = i + 1;
    const found = whole.match(/\bdp:twin\s+(\S+)\s*(.*)$/);
    if (!found) return;
    const label = found[1].match(/^[A-Za-z][A-Za-z0-9]*_([0-9A-Fa-f]{6})$/);
    if (!label) return errors.push({ line, error: `"${found[1]}" isn't a function as a game's code names one, a word and its address, such as sub_808123` });
    let rest = found[2].replace(/\*\/\s*$/, '').trim(), mode = null, leaves = null, given = null, back = null;
    const modes = rest.match(/^([a-z0-9]+)(?:>([a-z0-9]+))?\s+/);
    if (modes && (MODES.includes(modes[1]) || modes[2])) {
      if (!MODES.includes(modes[1]) || (modes[2] && !MODES.includes(modes[2]))) return errors.push({ line, error: `a mode is one of ${MODES.join(', ')}, and "${modes[0].trim()}" isn't` });
      mode = modes[1];
      leaves = modes[2] ?? null;
      rest = rest.slice(modes[0].length);
    }
    const condition = rest.match(/\sif\s(.*)$/);
    if (condition) {
      given = condition[1].trim();
      rest = rest.slice(0, condition.index);
    }
    const gives = rest.match(/\s->\s(.*)$/);
    if (gives) {
      back = gives[1].trim();
      rest = rest.slice(0, gives.index);
    }
    const call = rest.trim(), name = call.match(/^([A-Za-z_]\w*)\s*\(.*\)$/)?.[1];
    if (!name) return errors.push({ line, error: `after ${found[1]} comes the call of its twin, as sum(&A, X), and "${call}" isn't one` });
    if (back === '' || given === '') return errors.push({ line, error: 'nothing comes after its -> or its if' });
    const changed = [...new Set([...call.matchAll(CHANGED)].map(([, register]) => register))];
    contracts.push({ label: found[1], address: parseInt(label[1], 16), line, text: found[2].replace(/\*\/\s*$/, '').trim(), call, name, mode, leaves, back, given, changed });
  });
  return { contracts, errors };
}

/** A file's contracts as the twins the tools find in a file of C (../gba/match.mjs twinsIn): { name, address, line,
 *  own, code, contract }, `name` the C function each calls. */
export const snesTwinsIn = text => contractsIn(text).contracts.map(contract => ({ name: contract.name, address: contract.address, line: contract.line, own: false, code: contract.text, unaligned: false, contract }));
