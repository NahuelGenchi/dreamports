// What `npm run dp -- read` prints for an NES game (read.mjs): one of the original's functions as 6502 instructions,
// read from the contributor's own copy by the tools' own decoder (6502.mjs), laid out as the Game Boy Advance's are.
// Each line is an address, the bytes there and the instruction they make, with the code map's name of what a JSR or a
// JMP goes to after a semicolon.
//
// The function finder (functions.mjs) says what the instructions alone don't. An address at $8000-$BFFF means
// nothing until the bank is known (docs/CONSOLES.md): a function in a switched bank is read from that bank, and its
// calls there are to its own bank, while a call there from the last bank is named by the bank the finder followed it
// into, or else by every bank with a function at that address, and says so. The tables of addresses the finder
// follows are written as data, `.word` for a whole address and `.byte` for a table of low or high bytes, and a JMP
// through a pointer or an RTS that jumps is given where the finder followed it to. Bytes no code reaches are written
// as instructions when they read as documented ones up to the next thing known, and as `.byte` when they don't.

import { decode } from './6502.mjs';
import { findFunctions, followsBanks, nesName, nesNames, nesProgram, programOffset } from './functions.mjs';
import { hex } from '../lib/proof-files.mjs';

const BANK = 0x4000;
// how much is read when neither the code map nor the finder has the function, unless --bytes says
const SOME_BYTES = 256;
// how many bytes a line of data holds, and how many of the places a jump was followed to are named
const ROW = 8, NAMED = 6;
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const ENDS = new Set(['RTS', 'RTI', 'JMP', 'BRK', 'JAM']);

/**
 * What the tools know of an NES copy's program for reading it: where each offset is seen by the console, the code
 * map's functions and their names, and what the finder found by following the code. `functions` is the code map's
 * list, as readCodeMap gives it.
 */
export function nesReader(bytes, functions) {
  const program = nesProgram(bytes);
  if (!program) throw new Error("That copy isn't an NES game's.");
  const { prg, banks, mapper } = program;
  if (!followsBanks(mapper)) throw new Error(`read can't tell which bank is where on an NES cartridge of mapper ${mapper} yet (docs/CONSOLES.md).`);
  const last = banks <= 2 ? null : banks - 1;
  // a program of one bank is seen twice, at $8000 and at $C000: it's shown where its reset vector says it starts
  const low = banks === 1 && prg[prg.length - 3] >= 0xC0 ? 0xC000 : 0x8000;
  const bankOf = offset => Math.floor(offset / BANK);
  const seenAt = offset => (banks <= 2 ? low + offset : (bankOf(offset) === last ? 0xC000 : 0x8000) + offset % BANK);
  const where = offset => (banks <= 2 || bankOf(offset) === last ? '' : `${hex2(bankOf(offset))}:`) + hex4(seenAt(offset));
  const starts = new Map(functions.map(f => [f.address, f]));
  const functionAt = offset => starts.get(offset) ?? functions.find(f => offset >= f.address && offset < f.address + f.size);
  const nameOf = offset => starts.get(offset)?.name ?? (banks <= 2 ? `sub_${hex4(seenAt(offset))}` : nesName(offset, banks));
  const pool = new Set(), words = new Set(), leads = new Map(), walked = new Map();
  const found = findFunctions(bytes, functions.filter(f => !f.bytes), pool, { words, leads, walked });
  return { prg, banks, mapper, last, bankOf, seenAt, where, functionAt, nameOf, starts, pool, words, leads, walked, found };
}

/**
 * The offset in the program a function is given by: a name in the code map, a bank and an address as `04:923F`, a
 * label as a game's code names it, `sub_04_923F` or `sub_C39C`, an address the console sees, or an offset in the
 * program as the code map numbers it.
 */
export function nesResolve(reader, functions, what, game) {
  const { prg, banks, last } = reader;
  const inProgram = offset => {
    if (offset === null || offset >= prg.length) throw new Error(`${what} isn't in the game's program, which has ${banks} bank${banks === 1 ? '' : 's'} of 16 KB.`);
    return { offset };
  };
  const named = functions.find(f => f.name === what) ?? functions.find(f => f.name && f.name.toLowerCase() === what.toLowerCase());
  if (named) return { offset: named.address };
  const banked = what.match(/^([0-9a-f]{1,2}):\$?([89a-f][0-9a-f]{3})$/i);
  if (banked) {
    const bank = parseInt(banked[1], 16), address = parseInt(banked[2], 16);
    if (banks > 2 && (bank >= banks || (address >= 0xC000) !== (bank === last))) throw new Error(`${what}: the last bank, ${hex2(last)}, is the one at $C000-$FFFF, and the others are seen at $8000-$BFFF.`);
    return inProgram(programOffset(address, bank, banks));
  }
  const label = nesNames(what, banks)[0];
  if (label && label[0] === what) return inProgram(label[1]);
  const address = what.match(/^(?:\$|0x)?([89a-f][0-9a-f]{3})$/i) ?? what.match(/^[A-Za-z][A-Za-z0-9]*_([89a-f][0-9a-f]{3})$/i);
  if (address) {
    const at = parseInt(address[1], 16);
    const offset = programOffset(at, null, banks);
    if (offset !== null) return inProgram(offset);
    // an address in a switched bank with no bank said: the one bank where the code map has a function there
    const fits = Array.from({ length: last }, (_, bank) => programOffset(at, bank, banks)).filter(o => reader.functionAt(o));
    if (fits.length === 1) return { offset: fits[0], said: `$${hex4(at)} is in a bank the cartridge switches in, and bank ${hex2(reader.bankOf(fits[0]))} is the only one where the code map has a function there.` };
    throw new Error(`$${hex4(at)} is in a bank the cartridge switches in, and ${fits.length ? `banks ${fits.map(o => hex2(reader.bankOf(o))).join(', ')} each have a function there` : 'the code map has no function there in any'}: say which, as ${hex2(fits.length ? reader.bankOf(fits[0]) : 0)}:${hex4(at)}.`);
  }
  const offset = what.match(/^(?:0x)?([0-9a-f]{5,8})$/i);
  if (offset) return inProgram(parseInt(offset[1], 16));
  throw new Error(`"${what}" isn't a bank and an address, such as 04:923F, a label, such as sub_04_923F or sub_C39C, an address in the last bank, such as $C39C, an offset in the program as games/${game}/proof/code-map.json numbers it, such as 0001123F, or a name in it.`);
}

/**
 * Where an address a line of code at `from` names leads in the program: { offsets, how }, with `how` 'sure' when the
 * address means one place, 'followed' when it's in a switched bank and the finder followed the instruction at `site`
 * there, and 'unknown' for every bank with a function at that address, when nothing says which is switched in.
 */
export function leadsTo(reader, address, from, site) {
  const { banks, last, bankOf, seenAt, leads, functionAt } = reader;
  if (address < 0x8000) return { offsets: [], how: 'sure' };
  const own = banks <= 2 || bankOf(from) === last ? null : bankOf(from);
  const sure = programOffset(address, own, banks);
  if (sure !== null) return { offsets: [sure], how: 'sure' };
  const followed = [...leads.get(site) ?? []].filter(to => seenAt(to) === address && bankOf(to) !== last).sort((a, b) => a - b);
  if (followed.length) return { offsets: followed, how: 'followed' };
  return { offsets: Array.from({ length: last }, (_, bank) => programOffset(address, bank, banks)).filter(o => functionAt(o)), how: 'unknown' };
}

/**
 * `length` bytes of the program from `start`, as lines: { offset, bytes, text, kind, size, instruction, goes }.
 * `kind` is 'code' for an instruction the code reaches, 'inner' for one it reaches inside the instruction on the line
 * before, which takes no bytes of its own, 'data' for a table the finder follows, and 'loose' for bytes no code
 * reaches, an instruction if they read as documented ones and bytes if not. `instruction` is what the decoder made
 * of a line, `goes` where a JSR, a JMP or a table's address leads (leadsTo), `followed` where the finder followed a
 * JMP through a pointer or an RTS, and `past` how many of an instruction's bytes are past the end.
 */
export function listing(reader, start, length, entries = [start]) {
  const { prg, seenAt, pool, words, leads, starts, walked } = reader;
  const end = Math.min(start + length, (Math.floor(start / BANK) + 1) * BANK, prg.length);
  const inside = offset => offset >= start && offset < end;
  const offsetOf = (address, from) => {
    const to = leadsTo(reader, address, from, from);
    return to.how === 'sure' ? to.offsets[0] : undefined;
  };

  // the instructions the code reaches: those the finder reached by following the whole program's code, which knows
  // of jumps into here from other functions, and then what follows from each entry and from every function of the
  // code map that starts in here. A branch can land inside an instruction already read, which is then read both ways
  const reached = new Map(), within = new Set();
  for (const [pc, size] of walked) {
    if (!inside(pc) || pool.has(pc)) continue;
    reached.set(pc, decode(prg, pc, seenAt(pc)));
    for (let i = 1; i < size; i++) within.add(pc + i);
  }
  // a start of the code map's inside an instruction the finder reached is no surer than that instruction
  const work = [...entries, ...[...starts.keys()].filter(at => inside(at) && !within.has(at))];
  // where a branch or a jump goes on to in here, which the finder doesn't read again when it lands inside an
  // instruction it has read
  const onward = (pc, { name, mode, operand }) => {
    if (mode !== 'rel' && !(name === 'JMP' && mode === 'abs')) return;
    const to = offsetOf(operand, pc);
    if (to !== undefined && inside(to)) work.push(to);
  };
  for (const [pc, instruction] of reached) onward(pc, instruction);
  while (work.length) {
    let pc = work.pop();
    while (inside(pc) && !reached.has(pc)) {
      const instruction = decode(prg, pc, seenAt(pc));
      if (!instruction || pc + instruction.length > end) break;
      if (Array.from({ length: instruction.length }, (_, i) => pc + i).some(at => pool.has(at))) break;
      reached.set(pc, instruction);
      onward(pc, instruction);
      if (ENDS.has(instruction.name)) break;
      pc += instruction.length;
    }
  }

  const lines = [];
  const bytesAt = (at, count) => [...prg.subarray(at, at + count)];
  const data = (at, count, kind) => {
    const bytes = bytesAt(at, count);
    lines.push({ offset: at, bytes: [], text: `.byte ${bytes.map(b => `$${hex2(b)}`).join(', ')}`, kind, size: count });
  };
  const code = (at, instruction, kind) => {
    const { name, mode, operand, length: size } = instruction;
    const line = { offset: at, bytes: bytesAt(at, size), text: instruction.text, kind, size, instruction };
    if ((name === 'JSR' || name === 'JMP') && mode === 'abs') line.goes = leadsTo(reader, operand, at, at);
    else if (name === 'JMP' || name === 'RTS') line.followed = [...leads.get(at) ?? []].sort((a, b) => a - b);
    return line;
  };
  for (let at = start; at < end;) {
    const instruction = reached.get(at);
    if (instruction) {
      const size = instruction.length;
      lines.push(code(at, instruction, 'code'));
      // an instruction the code also reaches inside this one, as when a BIT hides the instruction a branch lands on
      for (let inner = at + 1; inner < at + size; inner++) {
        if (reached.has(inner)) lines.push({ ...code(inner, reached.get(inner), 'inner'), size: 0 });
      }
      if (at + size > end) lines.at(-1).past = at + size - end;
      at += size;
    } else if (pool.has(at)) {
      if (words.has(at) && at + 1 < end && !reached.has(at + 1)) {
        const address = prg[at] | prg[at + 1] << 8;
        // a table's addresses were followed from the instruction that reads it, so only one that means one place is named
        lines.push({ offset: at, bytes: bytesAt(at, 2), text: `.word $${hex4(address)}`, kind: 'data', size: 2, goes: leadsTo(reader, address, at, -1) });
        at += 2;
      } else {
        let count = 1;
        while (count < ROW && at + count < end && pool.has(at + count) && !words.has(at + count) && !reached.has(at + count)) count++;
        data(at, count, 'data');
        at += count;
      }
    } else {
      // what no code reaches: instructions, if it reads as documented ones up to the next thing known, or else bytes
      let stop = at;
      while (stop < end && !reached.has(stop) && !pool.has(stop)) stop++;
      const loose = [], first = lines.length;
      for (let pc = at; pc < stop;) {
        const next = decode(prg, pc, seenAt(pc));
        if (!next || next.undocumented || next.name === 'BRK' || pc + next.length > stop) break;
        loose.push({ offset: pc, bytes: bytesAt(pc, next.length), text: next.text, kind: 'loose', size: next.length, instruction: next });
        pc += next.length;
      }
      if (loose.reduce((sum, line) => sum + line.size, 0) === stop - at) lines.push(...loose);
      else for (let pc = at; pc < stop; pc += ROW) data(pc, Math.min(ROW, stop - pc), 'loose');
      lines[first].first = true;
      at = stop;
    }
  }
  return lines;
}

/** A listing's lines as text: the address, the bytes, the instruction, and after a semicolon what the tools know of it. */
export function written(reader, lines) {
  const { where, nameOf, functionAt, bankOf } = reader;
  // a function's name, or how far into one an address is
  const place = offset => {
    const f = functionAt(offset);
    return !f ? null : f.address === offset ? nameOf(offset) : `${nameOf(f.address)} + ${offset - f.address}`;
  };
  const some = (offsets, word) => {
    const names = offsets.map(place).filter(Boolean);
    return names.slice(0, NAMED).join(names.length > NAMED ? ', ' : ` ${word} `) + (names.length > NAMED ? ` and ${names.length - NAMED} more` : '');
  };
  return lines.map(line => {
    const notes = [];
    if (line.goes?.offsets.length) {
      const { offsets, how } = line.goes;
      const names = some(offsets, 'or');
      if (how === 'sure' && names) notes.push(names);
      else if (how === 'followed') notes.push(names ? `${names}, in bank ${offsets.map(o => hex2(bankOf(o))).join(' or ')}, where the tools followed it` : `bank ${offsets.map(o => hex2(bankOf(o))).join(' or ')}, where the tools followed it`);
      else if (how === 'unknown') notes.push(`in whichever bank is switched in, where the code map has ${names}`);
    } else if (line.goes?.how === 'unknown') notes.push('in whichever bank is switched in, where the code map has no function');
    if (line.followed?.length) {
      const names = some(line.followed, 'or');
      if (names) notes.push(`the tools followed it to ${names}`);
    }
    if (line.instruction?.undocumented) notes.push('undocumented');
    if (line.kind === 'inner') notes.push('inside the instruction above, where the code also lands');
    if (line.past) notes.push(`its last ${line.past === 1 ? 'byte is' : `${line.past} bytes are`} past the end, where the next function starts`);
    if (line.kind === 'loose' && line.first) notes.push('no code the tools followed reaches this');
    const bytes = line.bytes.map(hex2).join(' ').padEnd(8);
    return `${where(line.offset)}:  ${bytes}  ${line.text}${notes.length ? `  ; ${notes.join('; ')}` : ''}`;
  });
}

/**
 * What read prints for an NES game: { start, length, key, text, has }, with `start` the offset in the program it
 * starts at, `key` that offset as the code map writes it, and `has` whether something a note is about is in there.
 */
export function readNes({ game, what, original, codeMap, bytes, flags }) {
  for (const flag of ['arm', 'thumb', 'frame']) {
    if (flags[flag] !== undefined) throw new Error(`--${flag} is for a Game Boy Advance game: on the NES, read takes --bytes <n>.`);
  }
  const functions = codeMap.functions;
  const reader = nesReader(bytes, functions);
  const { banks, last, bankOf, where, nameOf, functionAt } = reader;
  const { offset, said } = nesResolve(reader, functions, what, game);
  const mapped = functionAt(offset);
  const traced = reader.found.find(f => offset >= f.address && offset < f.address + f.size);

  let start = offset, length, extent;
  if (flags.bytes) {
    length = Math.min(flags.bytes, (bankOf(offset) + 1) * BANK - offset);
    extent = `${length} bytes from there, ${length < flags.bytes ? 'up to the end of its bank' : 'as --bytes asks'}`;
  } else if (mapped) {
    [start, length] = [mapped.address, mapped.size];
    extent = `the whole function, ${length} bytes, as the code map has it`;
  } else if (traced) {
    [start, length] = [traced.address, traced.size];
    extent = `${length} bytes, as far as the tools can follow its code, since the code map doesn't list it`;
  } else {
    length = Math.min(SOME_BYTES, (bankOf(offset) + 1) * BANK - offset);
    extent = `its first ${length} bytes, since the code map doesn't list it: --bytes <n> reads more`;
  }
  const lines = listing(reader, start, length, [start, offset]);
  const bank = bankOf(start);
  const name = !mapped ? `$${where(start)}` : mapped.address === start ? `${nameOf(start)}, at $${where(start)},` : `$${where(start)}, inside ${nameOf(mapped.address)},`;
  const whichBank = banks <= 2
    ? `The program has ${banks === 1 ? 'one bank of 16 KB' : 'two banks of 16 KB'} and never switches, so every address means one place.`
    : bank === last
      ? `It's in bank ${hex2(bank)}, the last, which is always at $C000-$FFFF. An address at $8000-$BFFF is in whichever of the other ${last} is switched in then, which the instructions alone don't say.`
      : `It's in bank ${hex2(bank)}, which the cartridge switches in at $8000-$BFFF, so the addresses it names there are its own, and those at $C000-$FFFF are in bank ${hex2(last)}, the last.`;
  const unknown = lines.some(line => line.goes && line.goes.how !== 'sure');
  const head = [
    ...(mapped?.address === offset && !reader.walked.has(offset) ? [`Careful: following the game's code, the tools never get to ${nameOf(offset)}, so it may be data the code map took for a function.`] : []),
    `${name} in ${original.name}: ${extent}.`,
    ...(said ? [said] : []),
    ...(offset !== start ? [`$${where(offset)} is inside it.`] : []),
    `Offset ${hex(start)} in the program, as games/${game}/proof/code-map.json numbers it.`,
    whichBank,
    ...(unknown ? ['Where a call from here goes into a switched bank, the line names the bank the tools followed it into when they found the functions, or else every bank with a function at that address.'] : []),
    ...(lines.some(line => line.kind === 'data') ? ['A .word or a .byte is a table of addresses the tools saw the code jump with, which is data and not instructions.'] : []),
    ...(lines.some(line => line.kind === 'loose') ? ['Some of it no code the tools followed reaches, and the line where that starts says so: it may be data, or code only a table the tools don\'t follow leads to.'] : []),
    `Each line is an address as the console sees it${banks > 2 && bank !== last ? ', after its bank' : ''}, the bytes there and the 6502 instruction they make, as the tools' own decoder reads it (tools/nes/6502.mjs). After a semicolon comes the code map's name of what it calls or jumps to. tools/README.md, Reading the original's instructions, explains them.`,
  ];
  const text = [...head, '', ...written(reader, lines), ''].join('\n');
  const has = about => {
    try {
      const at = nesResolve(reader, functions, about, game).offset;
      return at >= start && at < start + length;
    } catch {
      return false;
    }
  };
  return { start, length, key: hex(start), text, has };
}
