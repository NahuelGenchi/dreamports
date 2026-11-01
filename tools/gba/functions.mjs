// Finds the functions in a Game Boy Advance game's code, for its code map: where each one starts and how many bytes
// it takes, and nothing of the code itself. Like a disassembler, it follows the code from the cartridge's entry
// point through every call, every branch and every function address the code loads, and it also takes the
// function addresses in the game's tables. It reads only the cartridge: code the game copies into the console's
// memory to run there isn't found, so a decompilation's list (codemap --from) is better where there is one.

const BASE = 0x08000000;

// Thumb instructions the console's processor doesn't have: data read as code soon meets one
const invalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800 || (op & 0xF800) === 0xF800
  || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200 || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800 || (op & 0xFE00) === 0xBE00;
// a return: POP {…, pc} or BX
const returns = op => (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700;

/** Each function found, as { address, size, thumb }, sorted by address. */
export function findFunctions(bytes) {
  const size = bytes.length;
  const inRom = address => address >= BASE && address < BASE + size;
  const u16 = address => bytes[address - BASE] | bytes[address - BASE + 1] << 8;
  const u32 = address => (bytes[address - BASE] | bytes[address - BASE + 1] << 8 | bytes[address - BASE + 2] << 16 | bytes[address - BASE + 3] << 24) >>> 0;
  const found = new Map();   // address → { thumb, end, called }: `called` when code calls it, not only points at it
  const queue = [];
  const add = (address, thumb, called) => {
    if (!inRom(address) || address % (thumb ? 2 : 4)) return;
    const known = found.get(address);
    if (known) {
      known.called ||= called;
      return;
    }
    found.set(address, { thumb, end: address, called });
    queue.push(address);
  };
  const isPointer = value => value & 1 && inRom(value - 1);
  // where a function address leads: code that starts as functions do, saving registers with PUSH or returning at
  // once, or else, when the address is likely one, code that reaches a return or a jump soon
  const startsFunction = at => (u16(at) & 0xFE00) === 0xB400 || u16(at) === 0x4770;
  function readsAsCode(at) {
    for (let i = 0; i < 48 && inRom(at + 1); i++, at += 2) {
      const op = u16(at);
      if (returns(op) || (op & 0xF800) === 0xE000) return true;
      if (invalid(op)) return false;
      if ((op & 0xF800) === 0xF000) at += 2;
    }
    return false;
  }
  const pointer = (value, likely, pointers) => {
    if (isPointer(value) && (startsFunction(value - 1) || (likely && readsAsCode(value - 1)))) pointers.push(value - 1);
  };

  // follows a Thumb function's code: its end, the functions it calls and those whose addresses it loads, and
  // whether it met an instruction the processor doesn't have, as data read as code does
  function traceThumb(start) {
    const seen = new Set(), work = [start], calls = [], pointers = [];
    let end = start + 2, bad = false;
    const reach = to => { end = Math.max(end, to); };
    while (work.length) {
      let pc = work.pop(), called = false;
      const loaded = [];   // the pool values loaded since the last branch, for a jump table
      while (inRom(pc) && pc + 2 <= BASE + size && !seen.has(pc) && (pc === start || !found.has(pc))) {
        seen.add(pc);
        const op = u16(pc);
        reach(pc + 2);
        if ((op & 0xF800) === 0xF000 && pc + 4 <= BASE + size && (u16(pc + 2) & 0xF800) === 0xF800) {
          // BL: a call, or a long jump, with no code after it
          calls.push(pc + 4 + ((op & 0x7FF) << 21 >> 9 | (u16(pc + 2) & 0x7FF) << 1));
          seen.add(pc + 2);
          reach(pc + 4);
          pc += 4;
          called = true;
          continue;
        }
        if (invalid(op)) {
          // data read as code; after a BL, only the data after a long jump
          bad ||= !called;
          break;
        }
        if ((op & 0xF000) === 0xD000) {
          // a conditional branch, or SWI
          if ((op & 0xFF00) !== 0xDF00) work.push(pc + 4 + ((op & 0xFF) << 24 >> 23));
          pc += 2;
          called = false;
          continue;
        }
        if ((op & 0xF800) === 0xE000) {
          // B: on within the function, or on to another one
          const target = pc + 4 + ((op & 0x7FF) << 21 >> 20);
          if (found.has(target) && target !== start) break;
          pc = target;
          continue;
        }
        if (returns(op)) break;
        if ((op & 0xFF87) === 0x4687 || (op & 0xFF87) === 0x4487) {
          // MOV pc or ADD pc: a jump table, at the address last loaded from the pool
          const table = loaded.at(-1);
          if (table !== undefined && inRom(table)) {
            const count = casesBefore(seen, pc) ?? 256;
            for (let i = 0; i < count; i++) {
              const entry = table + i * 4;
              if (!inRom(entry + 3)) break;
              const to = u32(entry);
              if (to & 1 || !inRom(to) || to < start || to > start + 0x4000) break;
              reach(entry + 4);
              work.push(to);
            }
          }
          break;
        }
        if ((op & 0xF800) === 0x4800) {
          // LDR from the literal pool after the code
          const at = (pc + 4 & ~3) + (op & 0xFF) * 4;
          if (inRom(at + 3)) {
            const value = u32(at);
            loaded.push(value);
            pointer(value, true, pointers);
            if (at > start) reach(at + 4);
          }
        }
        pc += 2;
      }
    }
    return { end, calls, pointers, bad };
  }

  // the number of cases in a switch: the CMP Rn, #n before its jump table, plus one
  function casesBefore(seen, pc) {
    for (let at = pc - 2; at > pc - 24 && seen.has(at); at -= 2) {
      const op = u16(at);
      if ((op & 0xF800) === 0x2800) return (op & 0xFF) + 1;
    }
    return null;
  }

  function traceArm(start) {
    const seen = new Set(), work = [start], calls = [], pointers = [];
    let end = start + 4;
    while (work.length) {
      let pc = work.pop();
      while (inRom(pc) && pc + 4 <= BASE + size && !seen.has(pc) && (pc === start || !found.has(pc))) {
        seen.add(pc);
        const op = u32(pc), always = op >>> 28 === 0xE;
        end = Math.max(end, pc + 4);
        if ((op & 0x0E000000) === 0x0A000000) {
          const target = pc + 8 + ((op & 0xFFFFFF) << 8 >> 6);
          if (op & 0x01000000) calls.push(target);   // BL
          else if (always) {
            if (found.has(target) && target !== start) break;
            pc = target;
            continue;
          } else work.push(target);
          pc += 4;
          continue;
        }
        if ((op & 0x0FFFFFF0) === 0x012FFF10 && always) break;   // BX
        if ((op & 0x0E108000) === 0x08108000 && always) break;   // LDM with pc
        if ((op & 0x0C10F000) === 0x0410F000 && always) break;   // LDR pc
        if ((op & 0x0C00F000) === 0x0000F000 && (op & 0x01900000) !== 0x01000000 && always) break;   // MOV, ADD… to pc, but not MSR
        if ((op & 0x0F7F0000) === 0x051F0000) {
          // LDR from the literal pool
          const at = pc + 8 + (op & 0x00800000 ? 1 : -1) * (op & 0xFFF);
          if (inRom(at + 3)) {
            pointer(u32(at), true, pointers);
            if (at > start) end = Math.max(end, at + 4);
          }
        }
        pc += 4;
      }
    }
    return { end, calls: calls.map(to => [to, false]), pointers, bad: false };
  }

  // the cartridge starts with a branch over its header, to the ARM code that starts the game
  if (size >= 4 && (u32(BASE) & 0x0F000000) === 0x0A000000) {
    found.set(BASE, { thumb: false, end: BASE + 4, called: true });
    add(BASE + 8 + ((u32(BASE) & 0xFFFFFF) << 8 >> 6), false, true);
  }
  // the function addresses in the game's tables: those that start as functions do, and, in a table that has one of
  // those, the others that read as code
  for (let at = BASE; at + 4 <= BASE + size;) {
    if (!isPointer(u32(at))) {
      at += 4;
      continue;
    }
    let next = at;
    while (next + 4 <= BASE + size && isPointer(u32(next))) next += 4;
    const table = [];
    for (let entry = at; entry < next; entry += 4) table.push(u32(entry) - 1);
    const sure = table.some(startsFunction);
    for (const to of table) {
      if (startsFunction(to) || (sure && table.length > 1 && readsAsCode(to))) add(to, true, false);
    }
    at = next;
  }
  while (queue.length) {
    const address = queue.shift();
    const f = found.get(address);
    if (!f) continue;
    const traced = f.thumb ? traceThumb(address) : traceArm(address);
    // a function address that led to data, not code: forgotten, with what it seemed to call
    if (traced.bad && !f.called) {
      found.delete(address);
      continue;
    }
    f.end = traced.end;
    for (const to of traced.calls) add(Array.isArray(to) ? to[0] : to, Array.isArray(to) ? to[1] : true, true);
    for (const to of traced.pointers) add(to, true, false);
  }
  // each function ends where the next one starts, at the latest
  const list = [...found].map(([address, f]) => ({ address, end: f.end, thumb: f.thumb })).sort((a, b) => a.address - b.address);
  return list.map((f, i) => ({ address: f.address, size: Math.min(f.end, list[i + 1]?.address ?? Infinity) - f.address, thumb: f.thumb }));
}
