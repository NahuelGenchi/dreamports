// Runs the twins of the Super Nintendo's function check (twin.mjs) in a thread of its own, as a twin that never comes
// back can't be stopped from inside: the check stops the whole thread and starts another. It holds the module the
// twins were built to, with every address folded by its 4 KB through a table in the module's memory
// (../lib/wasm-fold.mjs), so each memory of the console is where one address of it is, the work memory at $7E0000,
// its registers at $2100 and $4000 of bank $00, the save memory and the ROM where the cartridge's map first has them,
// and compares what a twin leaves there with what the original's function left, so the whole memory never crosses
// between threads. It's told what to do in messages:
//
//   { set: image }   the memory every call starts from, as original.mjs lays it out. Answers { done: true }.
//   { given: name, registers, changes }
//                    puts the image back with `changes`, each [place in the image, value], gives the contract the
//                    registers, and answers { given }, whether its `if` holds.
//   { call: name, registers, changes, chunks, skip, theirs, hardware, changed }
//                    the same, then calls the twin, and compares what it left with the image the original left, the
//                    image with `changes` and the original's `chunks` laid over it, but in the `skip` stretches of the
//                    image, each [from, to]; each read and write of the hardware with the original's, in order; each
//                    register of `changed` with the original's, `theirs`; and what it gave back with what the
//                    contract's `->` makes of the original's. Answers { differs } or { stopped }, as the check reads
//                    them.

import { parentPort, workerData } from 'node:worker_threads';

class Unbuilt extends Error {}
// a contract's place for its registers, each a whole word: what the call is given, what the twin left, what the
// original left, and what the twin gave back (twin.mjs, wrapOf)
const GIVEN = 0, LEFT = 12, THEIRS = 24, GAVE = 36;
const NAMES = ['A', 'X', 'Y', 'S', 'D', 'DB', 'N', 'V', 'Z', 'C', 'I', 'BCD'];

const module = new WebAssembly.Module(workerData.module);
const imports = {};
for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
  if (kind !== 'function') throw new Error(`The twins' module takes ${name} from outside, which isn't a function.`);
  (imports[from] ??= {})[name] = name === workerData.noCode
    ? address => { throw new Unbuilt(`$${(address >>> 0).toString(16).toUpperCase().padStart(6, '0')}`); }
    : () => { throw new Unbuilt(name); };
}
const { exports } = new WebAssembly.Instance(module, imports);
const memory = new Uint8Array(exports.memory.buffer), words = new Uint32Array(exports.memory.buffer);
// the fold's table, and the cartridge's ROM where the map first shows each 4 KB of it, once
memory.set(new Uint8Array(workerData.table.buffer, workerData.table.byteOffset, workerData.table.byteLength), workerData.tableAt);
for (const { address, bytes } of workerData.rom) memory.set(bytes, address);
const regions = workerData.regions;
if (regions.some(({ address, bytes }) => address + bytes > memory.length)) throw new Error('The twins\' memory doesn\'t reach every memory of the console, as folded.');
const stack = exports.__stack_pointer?.value;
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
const before = own && memory.slice(own.from, own.to);
const list = exports.snes_check_list ? exports.snes_check_list() >>> 2 : null;
const places = new Map();
let image = null;

// the image laid where the module has each of its memories, with a call's changes
function give(changes) {
  for (const { at, address, bytes } of regions) memory.set(image.subarray(at, at + bytes), address);
  for (const [at, value] of changes) {
    const region = regions.find(r => at >= r.at && at < r.at + r.bytes);
    if (region) memory[region.address + at - region.at] = value;
  }
  if (own) memory.set(before, own.from);
  if (stack !== undefined) exports.__stack_pointer.value = stack;
  if (list !== null) words[list] = 0;
}

// a contract's own place, asked of it once
const placeOf = name => {
  if (!places.has(name)) places.set(name, exports[name](3) >>> 2);
  return places.get(name);
};
const setRegisters = (at, registers) => NAMES.forEach((name, i) => { words[at + i] = registers[name] >>> 0; });

// the first place the module's memory differs from `expected`, outside `skip`
function firstDifference(expected, skip) {
  for (const { at, address, bytes } of regions) {
    const ours = memory.subarray(address, address + bytes), theirs = expected.subarray(at, at + bytes);
    if (Buffer.compare(ours, theirs) === 0) continue;
    for (let i = 0; i < bytes; i++) {
      if (ours[i] === theirs[i] || skip.some(([from, to]) => at + i >= from && at + i < to)) continue;
      return { at: at + i, ours: ours[i], theirs: theirs[i] };
    }
  }
  return null;
}

const failed = error => {
  if (error instanceof Unbuilt) return { stopped: 'unbuilt', unbuilt: error.message };
  if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) return { stopped: 'mismatch' };
  return { stopped: String(error.message ?? error) };
};

parentPort.on('message', message => {
  if (message.set) {
    image = message.set;
    parentPort.postMessage({ done: true });
    return;
  }
  const name = message.given ?? message.call;
  give(message.changes);
  const at = placeOf(name);
  setRegisters(at + GIVEN, message.registers);
  if (message.given) {
    try {
      parentPort.postMessage({ given: exports[name](2) !== 0 });
    } catch (error) {
      parentPort.postMessage(failed(error));
    }
    return;
  }
  let gave, back;
  try {
    exports[name](0);
    gave = words[at + GAVE] >>> 0;
    setRegisters(at + THEIRS, message.theirs);
    back = exports[name](1) >>> 0;
  } catch (error) {
    parentPort.postMessage(failed(error));
    return;
  }
  // what the twin left in the registers the contract marks, against the original's
  const left = Object.fromEntries(NAMES.map((register, i) => [register, words[at + LEFT + i] >>> 0]));
  const register = message.changed.find(changed => left[changed] !== (message.theirs[changed] >>> 0));
  const hardware = list === null ? [] : Array.from({ length: Math.min(words[list], 4096) }, (_, i) => ({ register: words[list + 1 + i * 3], value: words[list + 2 + i * 3], write: words[list + 3 + i * 3] === 1 }));
  const touched = hardware.findIndex((h, i) => !message.hardware[i] || h.register !== message.hardware[i].register || h.value !== message.hardware[i].value || h.write !== message.hardware[i].write);
  const missing = touched < 0 && hardware.length < message.hardware.length ? hardware.length : -1;
  const expected = Uint8Array.from(image);
  for (const [place, value] of message.changes) expected[place] = value;
  for (const chunk of message.chunks) expected.set(chunk.bytes, chunk.at);
  parentPort.postMessage({
    gave, back,
    register: register ? { name: register, ours: left[register], theirs: message.theirs[register] >>> 0 } : null,
    hardware: touched >= 0 || missing >= 0 ? { at: touched >= 0 ? touched : missing, ours: hardware[touched >= 0 ? touched : missing] ?? null, theirs: message.hardware[touched >= 0 ? touched : missing] ?? null } : null,
    differs: firstDifference(expected, message.skip),
  });
});
parentPort.postMessage({ ready: true });
