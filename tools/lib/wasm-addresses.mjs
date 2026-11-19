// Gives a WebAssembly module built from a twin's C the console's own addresses, the way a linker would if
// WebAssembly's had the option: every value the C names and doesn't define sits at its address in the console's
// memory, a function's address kept as a value is its address in the original, and a call through such a value
// finds the twin. So the same C the console's compiler builds needs nothing added to keep the console's memory byte
// for byte: no macro around a value, a function's name or a call through a pointer.
//
// It works on what wasm-ld writes with --emit-relocs and --allow-undefined: the module still says each place an
// address was filled in (its "reloc." sections) and which name it was for (its "linking" section), which are the
// places this fills in again. A call through a pointer is `call_indirect`, which takes a number in the module's own
// table of functions, so before each one this adds a call to the module's function that turns an address of the
// original into that number. It reads only what clang writes for C, and stops with what it met on anything else,
// never a guess.

const utf8 = new TextDecoder();

/** A reader over `bytes` from `at`: unsigned and signed LEB128 numbers, bytes and names. */
export function reader(bytes, at = 0) {
  const r = {
    at,
    byte: () => bytes[r.at++],
    u32() {
      let value = 0, shift = 0, byte;
      do {
        byte = bytes[r.at++];
        value += (byte & 0x7F) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
      return value;
    },
    s32() {
      let value = 0, shift = 0, byte;
      do {
        byte = bytes[r.at++];
        value += (byte & 0x7F) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
      return byte & 0x40 ? value - 2 ** shift : value;
    },
    // a number of any length, passed over
    skip() {
      while (bytes[r.at++] & 0x80);
    },
    name() {
      const length = r.u32();
      r.at += length;
      return utf8.decode(bytes.subarray(r.at - length, r.at));
    },
  };
  return r;
}

/** `value` as an unsigned LEB128 number, in as few bytes as it takes. */
export function leb(value) {
  const out = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    out.push(value ? byte | 0x80 : byte);
  } while (value);
  return out;
}

// a number in the five bytes a linker leaves for one, unsigned or signed
function writePadded(bytes, at, value, signed) {
  let v = signed ? value | 0 : value >>> 0;
  for (let i = 0; i < 5; i++) {
    bytes[at + i] = (v & 0x7F) | (i < 4 ? 0x80 : 0);
    v = signed ? v >> 7 : v >>> 7;
  }
  if (signed) bytes[at + 4] &= 0x7F;
}

/** A module's sections, each { id, name (a custom section's), start, from, to }: it starts at `start` and its content is bytes[from..to]. */
export function sectionsOf(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6D) throw new Error('That isn\'t a WebAssembly module.');
  const sections = [];
  const r = reader(bytes, 8);
  while (r.at < bytes.length) {
    const start = r.at, id = r.byte(), size = r.u32(), from = r.at;
    const section = { id, start, from, to: from + size };
    if (id === 0) {
      section.name = r.name();
      section.content = r.at;
    }
    sections.push(section);
    r.at = from + size;
  }
  return sections;
}

const CUSTOM = 0, IMPORT = 2, EXPORT = 7, CODE = 10, DATA = 11;
const SYMBOL_TABLE = 8, LOCAL = 0x02, UNDEFINED = 0x10, EXPLICIT_NAME = 0x40;
const FUNCTION = 0, DATA_SYMBOL = 1, SECTION_SYMBOL = 3;
// the kinds of place a linker fills in: a function's number in the table, as a signed number or as four bytes, and an
// address in memory, as an unsigned or a signed number or as four bytes
const TABLE_INDEX_SLEB = 1, TABLE_INDEX_I32 = 2, MEMORY_ADDR_LEB = 3, MEMORY_ADDR_SLEB = 4, MEMORY_ADDR_I32 = 5, TYPE_INDEX_LEB = 6;
// the kinds that carry a number to add
const WITH_ADDEND = new Set([3, 4, 5, 8, 9, 11, 14, 15, 16, 17, 21, 22, 23, 25]);

// the functions a module takes from outside, in order, and the functions it gives out by name
function importsAndExports(bytes, sections) {
  const imported = [], exported = new Map();
  const imports = sections.find(s => s.id === IMPORT);
  if (imports) {
    const r = reader(bytes, imports.from);
    for (let n = r.u32(); n; n--) {
      r.name();
      const name = r.name(), kind = r.byte();
      if (kind === 0) {
        r.skip();
        imported.push(name);
      } else if (kind === 1) {
        r.byte();
        if (r.byte() & 1) r.skip();
        r.skip();
      } else if (kind === 2) {
        if (r.byte() & 1) r.skip();
        r.skip();
      } else if (kind === 3) r.at += 2;
      else throw new Error(`The module takes something from outside this can't read (kind ${kind}).`);
    }
  }
  const exports = sections.find(s => s.id === EXPORT);
  if (exports) {
    const r = reader(bytes, exports.from);
    for (let n = r.u32(); n; n--) {
      const name = r.name(), kind = r.byte(), index = r.u32();
      if (kind === 0) exported.set(name, index);
    }
  }
  return { imported, exported };
}

// the names a module's places are filled in for, as its "linking" section lists them
function symbolsOf(bytes, sections, imported) {
  const linking = sections.find(s => s.id === CUSTOM && s.name === 'linking');
  if (!linking) throw new Error('The module doesn\'t say which names its addresses are for: it has to be linked with --emit-relocs.');
  const r = reader(bytes, linking.content);
  r.u32();
  while (r.at < linking.to) {
    const type = r.byte(), size = r.u32(), end = r.at + size;
    if (type !== SYMBOL_TABLE) {
      r.at = end;
      continue;
    }
    const symbols = [];
    for (let n = r.u32(); n; n--) {
      const kind = r.byte(), flags = r.u32(), undefined_ = (flags & UNDEFINED) !== 0;
      if (kind === DATA_SYMBOL) {
        const name = r.name();
        if (!undefined_) {
          r.skip();
          r.skip();
          r.skip();
        }
        symbols.push({ kind, name, undefined: undefined_, local: (flags & LOCAL) !== 0 });
      } else if (kind === SECTION_SYMBOL) {
        r.skip();
        symbols.push({ kind });
      } else {
        const index = r.u32();
        const name = !undefined_ || flags & EXPLICIT_NAME ? r.name() : kind === FUNCTION ? imported[index] : null;
        symbols.push({ kind, name, index, undefined: undefined_, local: (flags & LOCAL) !== 0, asked: (flags & EXPLICIT_NAME) !== 0 });
      }
    }
    return symbols;
  }
  return [];
}

// Where each `call_indirect` of a function's body is, from `from` to `to`. Every instruction clang writes for C is
// read, since a byte of a number can look like any instruction.
function callsThroughPointers(bytes, from, to) {
  const r = reader(bytes, from), found = [];
  for (let groups = r.u32(); groups; groups--) {
    r.skip();
    r.byte();
  }
  while (r.at < to) {
    const at = r.at, op = r.byte();
    if (op === 0x11) {
      found.push(at);
      r.skip();
      r.skip();
    } else if (op === 0x02 || op === 0x03 || op === 0x04 || op === 0x0C || op === 0x0D || op === 0x10 || (op >= 0x20 && op <= 0x26) || op === 0x41 || op === 0x42 || op === 0x3F || op === 0x40 || op === 0xD2) r.skip();
    else if (op === 0x0E) for (let targets = r.u32() + 1; targets; targets--) r.skip();
    else if (op >= 0x28 && op <= 0x3E) {
      r.skip();
      r.skip();
    } else if (op === 0x43) r.at += 4;
    else if (op === 0x44) r.at += 8;
    else if (op === 0x1C) r.at += r.u32();
    else if (op === 0xD0) r.byte();
    else if (op === 0xFC) {
      const sub = r.u32();
      if (sub <= 7) continue;
      if (sub === 8 || sub === 10 || sub === 12 || sub === 14) {
        r.skip();
        r.skip();
      } else if (sub <= 17) r.skip();
      else throw new Error(`The module has an instruction this can't read (0xFC ${sub}).`);
    } else if (!(op <= 0x01 || op === 0x05 || op === 0x0B || op === 0x0F || op === 0x1A || op === 0x1B || (op >= 0x45 && op <= 0xC4) || op === 0xD1)) {
      throw new Error(`The module has an instruction this can't read (0x${op.toString(16)}).`);
    }
  }
  if (r.at !== to) throw new Error('A function of the module doesn\'t end where it says.');
  return found;
}

/**
 * What a file of C built by itself, an object as the compiler writes one, gives the files it's linked with and asks
 * of them, by name: the functions and the values it `defines`, but its own static ones, and the `functions` and
 * `values` it names and doesn't define. A function the C itself says comes from outside, as the kit's page does, isn't
 * asked of anyone.
 */
export function namesOf(object) {
  const bytes = Uint8Array.from(object);
  const sections = sectionsOf(bytes);
  const { imported } = importsAndExports(bytes, sections);
  const defines = new Set(), functions = new Set(), values = new Set();
  for (const symbol of symbolsOf(bytes, sections, imported)) {
    if ((symbol.kind !== FUNCTION && symbol.kind !== DATA_SYMBOL) || symbol.name === null) continue;
    if (!symbol.undefined) {
      if (!symbol.local) defines.add(symbol.name);
    } else if (symbol.kind === DATA_SYMBOL) values.add(symbol.name);
    else if (!symbol.asked) functions.add(symbol.name);
  }
  return { defines, functions: [...functions].filter(name => !defines.has(name)), values: [...values].filter(name => !defines.has(name)) };
}

/**
 * Fills a module in with the console's addresses.
 *   module: what wasm-ld wrote, with --emit-relocs and --allow-undefined
 *   addressOf(name): where the console keeps the value of that name, or null
 *   codeOf(name): the address in the original of the function a function of the module is the twin of, as code keeps
 *     it (odd for Thumb), or null for one that's the module's own
 *   translate: the name of the module's exported function that turns an address of the original into the function's
 *     number in the module's table, which every call through a pointer then goes through
 *   own(name): whether a function keeps the table's numbers as they are, as the one that does the turning has to
 * Answers { module, missing, imports }: the module as a browser or Node.js runs it, the names of values with no
 * address, which were left at 0, and the functions the module takes from outside.
 */
export function placeAddresses({ module, addressOf, codeOf = () => null, translate = null, own = () => false }) {
  const bytes = Uint8Array.from(module);
  const sections = sectionsOf(bytes);
  const { imported, exported } = importsAndExports(bytes, sections);
  const symbols = symbolsOf(bytes, sections, imported);
  const code = sections.find(s => s.id === CODE);

  // each function's body: where it is and whose it is
  const bodies = [];
  if (code) {
    const r = reader(bytes, code.from);
    for (let n = r.u32(); n; n--) {
      const size = r.u32();
      bodies.push({ from: r.at, to: r.at + size });
      r.at += size;
    }
    for (const symbol of symbols) {
      if (symbol.kind === FUNCTION && !symbol.undefined && bodies[symbol.index - imported.length]) bodies[symbol.index - imported.length].name ??= symbol.name;
    }
  }
  const kept = at => {
    const body = bodies.find(b => at >= b.from && at < b.to);
    return body ? own(body.name ?? '') : false;
  };

  const missing = new Set();
  for (const section of sections) {
    if (section.id !== CUSTOM || !section.name.startsWith('reloc.')) continue;
    const r = reader(bytes, section.content);
    const target = sections[r.u32()];
    if (!target || (target.id !== CODE && target.id !== DATA)) continue;
    for (let n = r.u32(); n; n--) {
      const type = r.byte(), at = target.from + r.u32(), index = r.u32();
      const addend = WITH_ADDEND.has(type) ? r.s32() : 0;
      // a function type's place, as a call through a pointer names it, is a type and not a symbol
      if (type === TYPE_INDEX_LEB) continue;
      const symbol = symbols[index];
      if (!symbol) throw new Error('The module names a place for something it doesn\'t list.');
      if (symbol.kind === DATA_SYMBOL && symbol.undefined) {
        const address = addressOf(symbol.name);
        if (address === null) {
          missing.add(symbol.name);
          continue;
        }
        if (type === MEMORY_ADDR_LEB) writePadded(bytes, at, address + addend, false);
        else if (type === MEMORY_ADDR_SLEB) writePadded(bytes, at, address + addend, true);
        else if (type === MEMORY_ADDR_I32) new DataView(bytes.buffer).setUint32(at, address + addend, true);
        else throw new Error(`The module keeps the address of ${symbol.name} in a way this can't fill in (kind ${type}).`);
      } else if (symbol.kind === FUNCTION && (type === TABLE_INDEX_SLEB || type === TABLE_INDEX_I32)) {
        const address = symbol.name === null ? null : codeOf(symbol.name);
        if (address === null || kept(at)) continue;
        if (type === TABLE_INDEX_SLEB) writePadded(bytes, at, address, true);
        else new DataView(bytes.buffer).setUint32(at, address, true);
      }
    }
  }

  // the module again, without what only a linker reads, and with each call through a pointer turned first
  const turn = translate === null ? null : exported.get(translate);
  if (translate !== null && turn === undefined) throw new Error(`The module has no function called ${translate} to turn the original's addresses into its own functions.`);
  const out = [bytes.subarray(0, 8)];
  for (const section of sections) {
    if (section.id === CUSTOM) continue;
    if (section.id !== CODE || turn === undefined || turn === null) {
      out.push(bytes.subarray(section.start, section.to));
      continue;
    }
    const parts = [Uint8Array.from(leb(bodies.length))];
    const call = Uint8Array.from([0x10, ...leb(turn)]);
    for (const body of bodies) {
      const calls = own(body.name ?? '') ? [] : callsThroughPointers(bytes, body.from, body.to);
      parts.push(Uint8Array.from(leb(body.to - body.from + calls.length * call.length)));
      let at = body.from;
      for (const where of calls) {
        parts.push(bytes.subarray(at, where), call);
        at = where;
      }
      parts.push(bytes.subarray(at, body.to));
    }
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    out.push(Uint8Array.from([CODE, ...leb(size)]), ...parts);
  }
  const made = new Uint8Array(out.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of out) {
    made.set(part, at);
    at += part.length;
  }
  return { module: made, missing: [...missing], imports: imported };
}
