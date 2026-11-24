// Runs the twins of the PlayStation Portable's function check (twin.mjs) in a thread of its own, as a twin that never
// comes back can't be stopped from inside: the check stops the whole thread and starts another. It holds the module the
// twins were built to, which keeps the console's memory at the console's own addresses, as the console's kit in C lays
// it out (kit/psp/c/memory.c), with every address folded by a table into where the console has it, through its
// mirrors too (twin.mjs, foldTable), and compares what a twin leaves there with what the original's function left, so the
// whole memory never crosses between threads. It's told what to do in messages, as the PlayStation's is
// (../ps1/twin-worker.mjs):
//
//   { set: image, regions }   the memory every call starts from, and where each of its places is. Answers { done }.
//   { call: name, args, changes, chunks, skip }
//                             lays `changes` over the image, calls the function with `args`, and compares what it left
//                             with the image the original left, the image with `changes` and the original's `chunks`
//                             laid over it, but in the `skip` stretches of the image. Answers { gave, differs }, or
//                             { stopped: why }. Then the memory is the image again.
//
// The console's memory is tens of megabytes, so it's compared and put back 64 KB at a time, and a block a call didn't
// touch is neither read byte by byte nor copied.

import { parentPort, workerData } from 'node:worker_threads';
import { inImage } from './original.mjs';

class Unbuilt extends Error {}
const BLOCK = 65536, CHUNK = 256;

const module = new WebAssembly.Module(workerData.module);
const imports = {};
for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
  if (kind !== 'function') throw new Error(`The twins' module takes ${name} from outside, which isn't a function.`);
  (imports[from] ??= {})[name] = name === workerData.noCode
    ? address => { throw new Unbuilt(`0x${(address >>> 0).toString(16).toUpperCase().padStart(8, '0')}`); }
    : () => { throw new Unbuilt(name); };
}
const { exports } = new WebAssembly.Instance(module, imports);
const memory = new Uint8Array(exports.memory.buffer), view = new DataView(exports.memory.buffer);
const stack = exports.__stack_pointer?.value;
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
const before = own && memory.slice(own.from, own.to);
// the table the module's addresses are folded by (twin.mjs, foldTable), where the module reads it
memory.set(new Uint8Array(Uint32Array.from(workerData.table).buffer), workerData.tableAt);
let image = null, regions = [];

// where a place of the image is in the module's memory
const placeOf = at => {
  const region = regions.findLast(r => at >= r.at);
  return region.address + at - region.at;
};

// What the original left, where it differs from the image: the bytes of the `chunks` it wrote and of the `changes`
// the call was given, by their place in the image.
function overlayOf(changes, chunks) {
  const bytes = new Map();
  for (const [where, size, value] of changes) {
    const at = inImage(regions, where);
    if (at < 0) continue;
    for (let i = 0; i < size; i++) bytes.set(at + i, (value >>> (i * 8)) & 0xFF);
  }
  for (const chunk of chunks) for (let i = 0; i < CHUNK; i++) bytes.set(chunk.at + i, chunk.bytes[i]);
  return bytes;
}

// The first place the module's memory differs from what the original left, outside `skip`, and every block put back
// as the image has it.
function compareAndPutBack(overlay, skip) {
  // the blocks the original wrote in, each by where it starts in the image, as the loop below takes them
  const touched = new Set([...overlay.keys()].map(place => {
    const region = regions.findLast(r => place >= r.at);
    return region.at + Math.floor((place - region.at) / BLOCK) * BLOCK;
  }));
  let first = null;
  for (const { at, address, bytes } of regions) {
    for (let block = 0; block < bytes; block += BLOCK) {
      const size = Math.min(BLOCK, bytes - block), from = at + block;
      const ours = memory.subarray(address + block, address + block + size), theirs = image.subarray(from, from + size);
      const same = Buffer.compare(ours, theirs) === 0;
      if (same && !touched.has(from)) continue;
      if (!first) {
        for (let i = 0; i < size; i++) {
          const place = from + i, expected = overlay.get(place) ?? theirs[i];
          if (ours[i] === expected || skip.some(([low, high]) => place >= low && place < high)) continue;
          first = { at: place, ours: ours[i], theirs: expected };
          break;
        }
      }
      if (!same) ours.set(theirs);
    }
  }
  return first;
}

parentPort.on('message', message => {
  if (message.set) {
    image = message.set;
    regions = message.regions;
    if (regions.some(({ address, bytes }) => address + bytes > memory.length)) throw new Error('The twins\' memory doesn\'t reach the console\'s.');
    for (const { at, address, bytes } of regions) memory.set(image.subarray(at, at + bytes), address);
    parentPort.postMessage({ done: true });
    return;
  }
  if (own) memory.set(before, own.from);
  if (stack !== undefined) exports.__stack_pointer.value = stack;
  for (const [where, bytes, value] of message.changes) {
    const at = inImage(regions, where);
    if (at < 0) continue;
    const address = placeOf(at);
    if (bytes === 1) view.setUint8(address, value);
    else if (bytes === 2) view.setUint16(address, value, true);
    else view.setUint32(address, value, true);
  }
  let gave = null, stopped = null;
  try {
    gave = exports[message.call](...message.args) >>> 0;
  } catch (error) {
    if (error instanceof Unbuilt) stopped = { stopped: 'unbuilt', unbuilt: error.message };
    else if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) stopped = { stopped: 'mismatch' };
    else stopped = { stopped: String(error.message ?? error) };
  }
  const differs = compareAndPutBack(overlayOf(message.changes, message.chunks), message.skip);
  parentPort.postMessage(stopped ?? { gave, differs });
});
parentPort.postMessage({ ready: true });
