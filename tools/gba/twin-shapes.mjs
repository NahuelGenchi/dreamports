// Structs made up for the function check (twin.mjs), laid out as the version's C has them. A function that follows a
// pointer to a struct reads the struct where it points, and where the game kept no such struct there, as where a list
// of the game's things is empty and its pointers are 0, a call that follows one leaves for what a twin can't follow and
// can't be compared: whatever paths need such a struct are left out. The version's own C says which values are pointers
// to which structs and how each struct is laid out, as the console's compiler lays it out: agbcc's debugging records of
// the file, read by stack-map.mjs, never anything of the game's. So when a call leaves through a pointer the C says
// points to a struct, the check calls again from the same memory, a few times, each time with a struct of that kind
// made up for it in a stretch of the work memory that holds nothing. A struct is made up as one the game keeps of that
// kind in the memory, where a pointer of the C points to one, with one to three of its values made up, or else with
// each value made up, as a value its type can hold, and a pointer in it to another struct one more made up the same
// way, so the call can go on through it. A call the game never makes is a fair input for the same memory
// (docs/STANDARD.md): the original and the twin are given the same struct. A pointer the game keeps to one of its own
// tables in the cartridge leads only to what that table has, which no change to the work memory varies, so a call that
// read one is made again with the table made up in the work memory, as the cartridge's own with a few of its values
// made up, and its lists of numbers or pointers made up too (#1759).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { compilerPath } from './agbcc.mjs';
import { preprocess } from './match.mjs';
import { typesOf } from './stack-map.mjs';
import { inImage } from './twin-memory.mjs';

// the work memory a made-up struct can go in: the 256 KB at 0x02000000, and the 32 KB at 0x03000000 below the stack
const ROOM = [{ from: 0x02000000, to: 0x02040000 }, { from: 0x03000000, to: 0x03007000 }];
// how much of a stretch with nothing in it a call's made-up structs share, and how deep a struct made up for a pointer
// in one made up goes
const STRETCH = 0x400, DEPTH = 3;
// how far past its start a declared array of no length is taken to go, at most, when no other value of the C is after it
const UNSAID = 0x400;
// how many values a pointer the C says leads to values that aren't a struct, as to a list of numbers or of pointers, is
// made up to lead to: as many as the small numbers the check makes up, 0 to 16, can count into, as an index does
const ITEMS = 17;
// where the cartridge is, whose structs no change to the work memory can vary
const CARTRIDGE = { from: 0x08000000, to: 0x0E000000 };
// how many structs in the work memory a call's reads led to are looked in for more pointers, at most
const INSIDE = 64;
const read = (bytes, at, size) => (size === 1 ? bytes[at] : size === 2 ? bytes.readUInt16LE(at) : bytes.readUInt32LE(at));

/** The version's types in `file`'s C, as agbcc lays them out ({ values, structs }, stack-map.mjs typesOf), or { error }.
 *  `root` and `includes` are as the version's build has them, `compiler` { name, flags } and `work` where its files go. */
export async function typesOfFile({ file, root, includes, compiler, work }) {
  mkdirSync(dirname(work), { recursive: true });
  let preprocessed;
  try {
    preprocessed = await preprocess(file, root, includes, { lines: true });
  } catch (error) {
    return { error: error.message };
  }
  writeFileSync(`${work}.i`, preprocessed);
  const cc = spawnSync(compilerPath(compiler.name), [...compiler.flags, '-g', '-fhex-asm', '-o', `${work}.s`, `${work}.i`], { encoding: 'utf8' });
  if (cc.error || cc.status !== 0) return { error: `${compiler.name} didn't build ${basename(file)} with its debugging records.` };
  return typesOf(readFileSync(`${work}.s`, 'utf8'));
}

/**
 * What makes structs up for one file's calls: `types` as typesOfFile gives them and `addressOf(name)` where the console
 * keeps a value of the C, or null. Answers null when no value of the file is in the work memory, or { leftThrough,
 * makeUp }, below.
 */
export function shapesOf(types, addressOf) {
  const whole = type => (type && (type.kind === 'struct' || type.kind === 'union') && type.size === null && type.name ? types.structs.get(type.name) ?? type : type);
  const sizeOf = type => {
    type = whole(type);
    if (!type) return null;
    if (type.kind === 'pointer') return 4;
    if (type.kind === 'array') {
      const each = sizeOf(type.of);
      return each === null || type.count === null ? null : each * type.count;
    }
    return type.size ?? null;
  };
  // the struct a pointer points to, when it is one with a size
  const structOf = pointer => {
    const to = whole(pointer?.to);
    return to && (to.kind === 'struct' || to.kind === 'union') && to.size > 0 ? to : null;
  };
  // what a pointer that doesn't point to a struct leads to, made up: as many values of what it points to as ITEMS says,
  // when that has a size, as a number or a pointer has, as an array of them laid out one after another; or null
  const itemsOf = pointer => {
    const to = whole(pointer?.to);
    if (!to || structOf(pointer) || !['base', 'enum', 'pointer', 'array'].includes(to.kind)) return null;
    const each = sizeOf(to);
    return each ? { kind: 'array', of: to, count: ITEMS, size: each * ITEMS } : null;
  };
  // the pointer a value of `type` has `offset` bytes in, or null
  const pointerIn = (type, offset) => {
    type = whole(type);
    if (!type) return null;
    if (type.kind === 'pointer') return offset === 0 ? type : null;
    if (type.kind === 'array') {
      const each = sizeOf(type.of);
      if (!each || (type.count !== null && offset >= each * type.count)) return null;
      return pointerIn(type.of, offset % each);
    }
    if (type.kind !== 'struct' && type.kind !== 'union') return null;
    for (const field of type.fields) {
      const size = sizeOf(field.type);
      if (field.bits || size === null || offset < field.offset || offset >= field.offset + size) continue;
      const found = pointerIn(field.type, offset - field.offset);
      if (found) return found;
    }
    return null;
  };

  // each value of the C in the work memory, where it is and how long: a declared array of no length up to the next
  const placed = [...types.values].map(([name, type]) => ({ at: addressOf(name), type }))
    .filter(({ at }) => typeof at === 'number' && ROOM.some(room => at >= room.from && at < room.to))
    .sort((a, b) => a.at - b.at);
  if (!placed.length) return null;
  const regions = placed.map(({ at, type }, i) => ({ at, type, size: sizeOf(type) ?? Math.min(UNSAID, (placed[i + 1]?.at ?? at + UNSAID) - at) }));

  // every pointer to a struct in a value of `type` at `at`, as { address, to }, an array of no length as long as `size`
  const slotsIn = (type, at, size, found = []) => {
    type = whole(type);
    if (!type || found.length > 4096) return found;
    if (type.kind === 'pointer') {
      const to = structOf(type);
      if (to) found.push({ address: at, to });
    } else if (type.kind === 'array') {
      const each = sizeOf(type.of);
      for (let n = 0; each && n < (type.count ?? Math.floor(size / each)); n++) slotsIn(type.of, at + n * each, each, found);
    } else if (type.kind === 'struct') for (const field of type.fields) if (!field.bits) slotsIn(field.type, at + field.offset, sizeOf(field.type) ?? 0, found);
    return found;
  };
  // each value a struct of `type` is made of, a field or an element of a field, as { offset, size, type }, and each
  // bit-field's storage once, typed as an unsigned number of its size
  const leavesOf = (type, offset = 0, found = []) => {
    type = whole(type);
    if (!type) return found;
    if (type.kind === 'base' || type.kind === 'enum') {
      for (let n = 0; n < (type.size === 8 ? 2 : 1); n++) if ([1, 2, 4, 8].includes(type.size)) found.push({ offset: offset + 4 * n, size: Math.min(type.size, 4), type });
    } else if (type.kind === 'pointer') found.push({ offset, size: 4, type });
    else if (type.kind === 'array') {
      const each = sizeOf(type.of);
      for (let n = 0; each && n < (type.count ?? 0); n++) leavesOf(type.of, offset + n * each, found);
    } else if (type.kind === 'struct') {
      for (const field of type.fields) {
        if (!field.bits) leavesOf(field.type, offset + field.offset, found);
        else if ([1, 2, 4].includes(field.size) && !found.some(leaf => leaf.offset === offset + field.offset)) found.push({ offset: offset + field.offset, size: field.size, type: { kind: 'base', size: field.size, signed: false } });
      }
    } else if (type.kind === 'union' && type.fields.length) leavesOf(type.fields[0].type, offset + type.fields[0].offset, found);
    return found;
  };

  // A stretch of the work memory `bytes` long with nothing in it in `image`, none of whose words are in `avoid`, from
  // the top of each memory down, so far from where the game keeps most: its address, or null.
  const freeIn = (image, bytes, avoid) => {
    for (const { from, to } of ROOM) {
      let run = 0;
      for (let address = to - 4; address >= from; address -= 4) {
        run = image.readUInt32LE(inImage(address)) === 0 && !avoid.has(address) ? run + 4 : 0;
        if (run >= bytes) return address;
      }
    }
    return null;
  };

  // the structs of `to`'s kind the game keeps in `image`, where a pointer of the C's values points to one
  const keptIn = (to, image) => {
    const found = new Set();
    for (const region of regions) {
      for (const slot of slotsIn(region.type, region.at, region.size)) {
        if (whole(slot.to) !== to || inImage(slot.address) < 0) continue;
        const value = image.readUInt32LE(inImage(slot.address));
        if (inImage(value) >= 0 && inImage(value + to.size - 1) >= 0 && value % 2 === 0) found.add(value);
      }
    }
    return [...found];
  };

  // A struct of `to`'s kind at `at`: as one the game keeps, when `image` has one, or as `held` reads one, the struct
  // in the cartridge the pointer held, with one to three of its values made up, or else each value made up, as
  // `choose` makes them up (`code` the functions' addresses), and a pointer to a struct another struct made up the
  // same way most times, in the room `take(bytes)` gives. With `lists`, for a struct made up in place of one of the
  // cartridge's, whose lists no change to the work memory varies either, a pointer to values that aren't a struct
  // leads most times to as many of them made up too; elsewhere it's a number, as a list in the work memory as short as
  // that has a copy through it run past its end. Its changes, as [address, bytes, value].
  const makeUp = (to, at, depth, image, take, choose, code, changes = [], held = null, lists = false) => {
    const leaves = leavesOf(to), kept = held ? [] : keptIn(to, image);
    const fromImage = base => (offset, bytes) => read(image, inImage(base + offset), bytes);
    const model = held ? (choose.below(4) ? held : null) : kept.length && choose.below(4) ? fromImage(choose.from(kept)) : null;
    const made = new Set();
    if (model !== null) for (let n = 1 + choose.below(3); n; n--) made.add(choose.below(leaves.length));
    leaves.forEach((leaf, i) => {
      const address = at + leaf.offset;
      if (model !== null && !made.has(i)) {
        changes.push([address, leaf.size, model(leaf.offset, leaf.size)]);
        return;
      }
      if (leaf.type.kind !== 'pointer') {
        changes.push([address, leaf.size, choose.value({ bits: leaf.size * 8, signed: leaf.type.signed === true }, code)]);
        return;
      }
      const inner = structOf(leaf.type) ?? (lists ? itemsOf(leaf.type) : null), room = inner && depth < DEPTH && choose.below(4) ? take(inner.size) : null;
      if (room !== null) makeUp(inner, room, depth + 1, image, take, choose, code, changes, null, lists);
      changes.push([address, 4, room ?? choose.value({ bits: 32, signed: false, pointer: true }, code)]);
    });
    return changes;
  };

  let pointers = null;
  return {
    /**
     * For a call that left for `leftFor`, which a twin can't follow, after it read `reads` ([address, bytes]) from
     * `image`, the memory it started from with what was changed for it: the pointer it left through, when it read one
     * the C says points to a struct and then left for an address within that struct's length past it, as
     * { address, to }, or null.
     */
    leftThrough({ reads, image, leftFor }) {
      const known = [...regions];
      let left = null;
      for (const [address, bytes] of reads) {
        if (bytes !== 4 || address & 3 || inImage(address) < 0) continue;
        const region = known.findLast(each => address >= each.at && address < each.at + each.size);
        const to = region ? structOf(pointerIn(region.type, address - region.at)) : null;
        if (!to) continue;
        const value = image.readUInt32LE(inImage(address));
        if ((leftFor - value) >>> 0 < to.size) left = { address, to };
        // a struct it points to in the memory is one the call can go on through, with its own pointers
        else if (inImage(value) >= 0 && inImage(value + to.size - 1) >= 0) known.push({ at: value, type: to, size: to.size });
      }
      return left;
    },

    /**
     * For a call that came back, after it read `reads` ([address, bytes]) from `image`, the memory it started from with
     * what was changed for it: each pointer it read that the C says points to a struct and that held an address in the
     * cartridge, as a pointer to one of the game's own tables does, which no change to the work memory can vary, as
     * { address, to, held }.
     */
    readThrough({ reads, image }) {
      // the C's own values' pointers to structs by their addresses, found once, and the structs in the work memory
      // the call's reads led to so far, which a few calls read many of: what a call reads is looked up in them alone
      if (!pointers) {
        pointers = new Map();
        for (const region of regions) for (const slot of slotsIn(region.type, region.at, region.size)) if (!pointers.has(slot.address)) pointers.set(slot.address, slot.to);
      }
      const inside = [], found = [];
      for (const [address, bytes] of reads) {
        if (bytes !== 4 || address & 3 || inImage(address) < 0) continue;
        let to = pointers.get(address);
        if (!to) {
          const struct = inside.findLast(each => address >= each.at && address < each.at + each.size);
          to = struct ? structOf(pointerIn(struct.type, address - struct.at)) : null;
        }
        if (!to) continue;
        const value = image.readUInt32LE(inImage(address));
        if (inImage(value) >= 0 && inImage(value + to.size - 1) >= 0) {
          if (inside.length < INSIDE) inside.push({ at: value, type: to, size: to.size });
        } else if (value >= CARTRIDGE.from && value + to.size <= CARTRIDGE.to && !found.some(slot => slot.address === address)) found.push({ address, to, held: value });
      }
      return found;
    },

    /**
     * A struct made up for `slot`, in `image`, the memory a call starts from with what was changed for it: in a
     * stretch of the work memory that holds nothing and none of whose words are in `avoid` (a Set), with each value as
     * makeUp above makes it up, from the struct in the cartridge the slot held, read with `cartridge(address, bytes)`,
     * when readThrough found it. Its changes, the pointer's first, as [address, bytes, value], or null with no room,
     * as for a struct longer than a stretch.
     */
    makeUp(slot, { image, avoid = new Set(), choose, code, cartridge = null }) {
      const at = slot.to.size <= STRETCH ? freeIn(image, STRETCH, avoid) : null;
      if (at === null) return null;
      let used = 0;
      const take = bytes => {
        const room = (bytes + 3) & ~3;
        if (used + room > STRETCH) return null;
        used += room;
        return at + used - room;
      };
      const room = take(slot.to.size);
      // the cartridge's struct, when the copy has all of it
      const held = slot.held !== undefined && cartridge?.(slot.held, slot.to.size).length === slot.to.size ? (offset, bytes) => read(cartridge(slot.held + offset, bytes), 0, bytes) : null;
      return [[slot.address, 4, room], ...makeUp(slot.to, room, 1, image, take, choose, code, [], held, slot.held !== undefined)];
    },
  };
}
