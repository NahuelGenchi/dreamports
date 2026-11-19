// Runs the twins of the PlayStation's function check (twin.mjs) in a thread of its own, as a twin that never comes back
// can't be stopped from inside: the check stops the whole thread and starts another. It holds the module the twins
// were built to, with every address folded to its low 26 bits (../lib/wasm-fold.mjs), so the console's memory is at 0,
// its scratchpad at 0x03800000 and its hardware's registers at 0x03801000, and compares what a twin leaves there with
// what the original's function left, so the whole memory never crosses between threads. It's told what to do in
// messages:
//
//   { set: image }      the memory every call starts from, as original.mjs lays it out. Answers { done: true }.
//   { call: name, args, changes, chunks, skip }
//                       puts the image back with `changes`, each [address, bytes, value], calls the function with
//                       `args`, and compares what it left with the image the original left, the image with `changes`
//                       and the original's `chunks` laid over it, but in the `skip` stretches of the image, each
//                       [from, to]. Answers { gave, differs }, what it gave back and the first place that differs,
//                       { at, ours, theirs } or null, or { stopped: why } when it stopped: on its own, because it
//                       called something nothing built is the twin of ('unbuilt', with which as `unbuilt`), or because
//                       it called through a pointer a function of another kind ('mismatch').

import { parentPort, workerData } from 'node:worker_threads';
import { IMAGE, imageAfter, inImage, REGIONS } from './original.mjs';

const MASK = workerData.mask;
class Unbuilt extends Error {}

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
// each memory of the image where the folded module has it
const regions = REGIONS.map(region => ({ ...region, folded: (region.address & MASK) >>> 0 }));
if (regions.some(({ folded, bytes }) => folded + bytes > memory.length)) throw new Error('The twins\' memory doesn\'t reach the console\'s scratchpad and hardware, as folded.');
const stack = exports.__stack_pointer?.value;
// the module's own values as they were before any call, put back before each, as each call of the original starts
// afresh
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
const before = own && memory.slice(own.from, own.to);
let image = new Uint8Array(IMAGE);

function give(from) {
  for (const { at, folded, bytes } of regions) memory.set(from.subarray(at, at + bytes), folded);
}

// the first place the module's memory differs from `expected`, outside `skip`
function firstDifference(expected, skip) {
  for (const { at, folded, bytes } of regions) {
    const ours = memory.subarray(folded, folded + bytes), theirs = expected.subarray(at, at + bytes);
    if (Buffer.compare(ours, theirs) === 0) continue;
    for (let i = 0; i < bytes; i++) {
      if (ours[i] === theirs[i] || skip.some(([from, to]) => at + i >= from && at + i < to)) continue;
      return { at: at + i, ours: ours[i], theirs: theirs[i] };
    }
  }
  return null;
}

parentPort.on('message', message => {
  if (message.set) {
    image = message.set;
    parentPort.postMessage({ done: true });
    return;
  }
  give(image);
  if (own) memory.set(before, own.from);
  if (stack !== undefined) exports.__stack_pointer.value = stack;
  for (const [where, bytes, value] of message.changes) {
    if (inImage(where) < 0) continue;
    const address = (where & MASK) >>> 0;
    if (bytes === 1) view.setUint8(address, value);
    else if (bytes === 2) view.setUint16(address, value, true);
    else view.setUint32(address, value, true);
  }
  let gave;
  try {
    gave = exports[message.call](...message.args) >>> 0;
  } catch (error) {
    if (error instanceof Unbuilt) parentPort.postMessage({ stopped: 'unbuilt', unbuilt: error.message });
    else if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) parentPort.postMessage({ stopped: 'mismatch' });
    else parentPort.postMessage({ stopped: String(error.message ?? error) });
    return;
  }
  parentPort.postMessage({ gave, differs: firstDifference(imageAfter(image, message.changes, message.chunks), message.skip) });
});
parentPort.postMessage({ ready: true });
