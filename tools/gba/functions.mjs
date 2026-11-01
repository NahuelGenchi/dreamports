// Finds the functions in a Game Boy Advance game's code, for its code map: where each one starts and how many bytes
// it takes, and nothing of the code itself. Like a disassembler, it follows the code from the cartridge's entry
// point through every call, every branch and every function address the code loads, and it also takes the
// function addresses in the game's tables. It reads only the cartridge: code the game copies into the console's
// memory to run there isn't found, so a decompilation's list (codemap --from) is better where there is one. Such a
// list can still stop short, so this follows the functions it lists too, and fillFunctions adds what it finds beyond
// them. It can also name data as a function, which startsInData tells. Last, it looks in what's left between the
// functions for those nothing calls or points at.

const BASE = 0x08000000;
const HEADER = 0xC0;
// how far past the code that's called a function only data points at can be: further than this, it's data that
// happens to look like code
const NEAR_CODE = 0x10000;

// Thumb instructions the console's processor doesn't have: data read as code soon meets one
const invalid = op => (op & 0xFF00) === 0xDE00 || (op & 0xF800) === 0xE800 || (op & 0xF800) === 0xF800
  || (op & 0xFF00) === 0xB100 || (op & 0xFE00) === 0xB200 || (op & 0xFE00) === 0xB600 || (op & 0xFC00) === 0xB800 || (op & 0xFE00) === 0xBE00;
// a return: POP {…, pc} or BX
const returns = op => (op & 0xFF00) === 0xBD00 || (op & 0xFF87) === 0x4700;

/** Whether the first words of some code look like ARM instructions: nearly all of those run always, so they start
 *  with E, which in Thumb code would take a branch every other instruction. */
export function looksLikeArm(words) {
  return words.length >= 4 && words.filter(word => word >>> 28 === 0xE).length >= 3;
}

/** Each function found, as { address, size, thumb }, sorted by address. `listed` are functions a list already knows,
 *  as { address, size }: their code is followed too, as nothing else may lead to it. `pool` collects the data the
 *  code uses: the words it loads, which are never code, as after a BL used as a long jump, and its jump tables. */
export function findFunctions(bytes, listed = [], pool = new Set()) {
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
  function readsAsCode(at, limit = Infinity) {
    for (let i = 0; i < 48 && at < limit && inRom(at + 1); i++, at += 2) {
      const op = u16(at);
      if (returns(op) || (op & 0xF800) === 0xE000) return true;
      if (invalid(op)) return false;
      if ((op & 0xF800) === 0xF000) at += 2;
    }
    return false;
  }
  // a list doesn't say which of its functions are ARM, and what's left between the functions doesn't either
  const startsArm = at => at % 4 === 0 && u32(at) >>> 28 === 0xE && looksLikeArm([0, 4, 8, 12].map(i => u32(at + i)));
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
      while (inRom(pc) && pc + 2 <= BASE + size && !seen.has(pc) && (pc === start || (!found.has(pc) && !pool.has(pc)))) {
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
        if (returns(op)) {
          // BX just after ADD Rn, pc: on to ARM code, which is a function of its own
          const before = u16(pc - 2);
          if ((op & 0xFF80) === 0x4700 && (before & 0xF800) === 0xA000 && (before >> 8 & 7) === (op >> 3 & 15) && seen.has(pc - 2)) {
            calls.push([(pc + 2 & ~3) + (before & 0xFF) * 4, false]);
          }
          break;
        }
        if ((op & 0xFF87) === 0x4687 || (op & 0xFF87) === 0x4487) {
          // MOV pc or ADD pc: a jump table, at the address last loaded from the pool, as long as the CMP before it says,
          // or else, in a switch too big for a CMP to say, up to the first case after it
          const table = loaded.at(-1);
          if (table !== undefined && inRom(table)) {
            const count = casesBefore(seen, pc) ?? Infinity;
            let first = Infinity;
            for (let i = 0; i < count; i++) {
              const entry = table + i * 4;
              if (entry >= first || !inRom(entry + 3)) break;
              const to = u32(entry);
              if (to & 1 || !inRom(to) || to < start || to > start + 0x4000) break;
              if (to > entry) first = Math.min(first, to);
              pool.add(entry).add(entry + 2);
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
            pool.add(at).add(at + 2);
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

  function follow() {
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
    const lastCalled = Math.max(BASE, ...[...found].filter(([, f]) => f.called).map(([address]) => address));
    for (const [address, f] of found) if (!f.called && address > lastCalled + NEAR_CODE) found.delete(address);
  }
  // twice: a word is only known as part of the pool once what loads it has been followed, which may come after
  // something has run into it, read it as code and taken it for a call
  for (let pass = 0; pass < 2; pass++) {
    found.clear();
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
    for (const { address } of listed) add(address, !startsArm(address), false);
    follow();
    // what nothing calls or points at: what's left between the functions, past any zeros and NOPs, which only pad, that
    // starts as a function does or reads as code up to a return before the next one
    const tried = new Set();
    for (let more = true; more;) {
      more = false;
      const spans = [...found].map(([address, f]) => [address, f.end]);
      for (const f of listed) if (inRom(f.address)) spans.push([f.address, f.address + f.size]);
      spans.sort((a, b) => a[0] - b[0]);
      let furthest = BASE + HEADER;
      spans.forEach(([, end], i) => {
        furthest = Math.max(furthest, end);
        const to = spans[i + 1]?.[0];
        let at = furthest;
        while (at < to && (u16(at) === 0 || u16(at) === 0x46C0)) at += 2;
        // ARM code may come after a word of data, and the address that leads to it has no mark to tell it from data's
        if (at < to && !startsFunction(at) && !readsAsCode(at, to)) {
          for (let arm = at + 3 & ~3; arm < to; arm += 4) {
            if (startsArm(arm)) {
              at = arm;
              break;
            }
          }
        }
        if (at < to && !tried.has(at) && (startsArm(at) || startsFunction(at) || readsAsCode(at, to))) {
          tried.add(at);
          add(at, !startsArm(at), false);
          more = true;
        }
      });
      follow();
    }
  }
  // each function ends where the next one starts, at the latest, and what's left of a function that runs on past
  // the ones starting inside it goes to the last of them
  const list = [...found].map(([address, f]) => ({ address, end: f.end, thumb: f.thumb })).sort((a, b) => a.address - b.address);
  let furthest = 0;
  return list.map((f, i) => {
    furthest = Math.max(furthest, f.end);
    return { address: f.address, size: Math.min(furthest, list[i + 1]?.address ?? Infinity) - f.address, thumb: f.thumb };
  });
}

/** Those of a list's functions that start in the data of the code before them, as a disassembler's list can: on a
 *  word the code uses, on half of one, or on the zero that pads before one. Nothing the tools find leads to them. */
export function startsInData(bytes, listed) {
  const pool = new Set();
  const functions = new Set(findFunctions(bytes, [], pool).map(f => f.address));
  const padding = address => pool.has(address + 2) && address % 4 === 2 && !bytes[address - BASE] && !bytes[address - BASE + 1];
  return listed.filter(({ address }) => !functions.has(address) && (pool.has(address) || padding(address)));
}

/** A list of functions with what following the code found beyond it, sorted by address, none overlapping. A listed
 *  function keeps its start and its name. Where one found runs on from a listed one, what's beyond is that function's
 *  own code, cut short, as a list that didn't follow a switch does, so the listed one grows over it, up to the next
 *  one listed. Whatever else is found is a function of its own. */
export function fillFunctions(listed, found) {
  const functions = listed.map(f => ({ ...f })).sort((a, b) => a.address - b.address);
  const added = [];
  let next = 0;
  for (const f of found) {
    const end = f.address + f.size;
    for (let at = f.address; at < end;) {
      while (next < functions.length && functions[next].address <= at) next++;
      const before = functions[next - 1];
      const beforeEnd = before ? before.address + before.size : 0;
      if (at < beforeEnd) {
        at = beforeEnd;
        continue;
      }
      const to = Math.min(end, functions[next]?.address ?? Infinity);
      if (beforeEnd > f.address) before.size = to - before.address;
      else added.push({ address: at, size: to - at });
      at = to;
    }
  }
  return [...functions, ...added].sort((a, b) => a.address - b.address);
}
