// Runs the twins of the GameCube's function check (twin.mjs) in a thread of its own, as a twin that never comes back
// can't be stopped from inside: the check stops the whole thread and starts another. It holds the module the twins were
// built to, with every address folded to its low 28 bits and every number outside the module's own stretch kept with
// its highest byte first (../lib/wasm-fold.mjs), so the console's memory is at 0 and the hardware's registers at
// 0x0C000000, each in the console's byte order, and compares what a twin leaves there with what the original's function
// left, so the whole memory never crosses between threads. It's told what to do in messages, as the Nintendo 64's is
// (../n64/twin-worker.mjs):
//
//   { set: image }      the memory every call starts from, as original.mjs lays it out. Answers { done: true }.
//   { types: name, count }
//                       the compiler's word on each of a twin's types, as wrapOf gives it. Answers { types }.
//   { call: name, args, changes, chunks, skip }
//                       puts the image back with `changes`, each [address, bytes, value] in the console's byte order,
//                       calls the function with `args`, each 64 bits, and compares what it left with the image the
//                       original left, the image with `changes` and the original's `chunks` laid over it, but in the
//                       `skip` stretches of the image, each [from, to]. Answers { gave, differs }, or { stopped: why }.

import { parentPort, workerData } from 'node:worker_threads';
import { IMAGE, inImage, REGIONS } from './original.mjs';

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
const memory = new Uint8Array(exports.memory.buffer);
// each memory of the image where the folded module has it
const regions = REGIONS.map(region => ({ ...region, folded: (region.address & MASK) >>> 0 }));
if (regions.some(({ folded, bytes }) => folded + bytes > memory.length)) throw new Error('The twins\' memory doesn\'t reach the console\'s hardware, as folded.');
const stack = exports.__stack_pointer?.value;
// the module's own values as they were before any call, put back before each, as each call of the original starts
// afresh
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
if (own && regions.some(({ folded, bytes }) => folded < own.to && folded + bytes > own.from)) throw new Error('The twins\' own values are where the console\'s memory is, as folded.');
const before = own && memory.slice(own.from, own.to);
// the image every call starts from, and what a call has to leave: the image with the changes the call is given and what
// the original wrote, which is kept up to date a stretch at a time rather than copied whole for every call, as the
// module's memory is
let image = new Uint8Array(IMAGE), expected = new Uint8Array(IMAGE);
const folded = at => {
  const region = regions.findLast(r => at >= r.at);
  return region.folded + at - region.at;
};

function give() {
  for (const { at, folded: to, bytes } of regions) memory.set(image.subarray(at, at + bytes), to);
  expected.set(image);
}

// the stretches of the image a call touched, [from, to), put back as the image has them, in the module's memory and in
// what a call has to leave
function putBack(stretches) {
  for (const [from, to] of stretches) {
    const part = image.subarray(from, to);
    expected.set(part, from);
    for (const { at, folded: into, bytes } of regions) {
      const start = Math.max(from, at), end = Math.min(to, at + bytes);
      if (start < end) memory.set(image.subarray(start, end), into + start - at);
    }
  }
}

// the first place the module's memory differs from what the call has to leave, outside `skip`, whose stretches are
// taken as the twin left them, so each memory is compared whole in one go
function firstDifference(skip) {
  for (const [start, end] of skip) {
    for (const { at, folded: from, bytes } of regions) {
      const first = Math.max(start, at), last = Math.min(end, at + bytes);
      if (first < last) expected.set(memory.subarray(from + first - at, from + last - at), first);
    }
  }
  for (const { at, folded: from, bytes } of regions) {
    const ours = memory.subarray(from, from + bytes), theirs = expected.subarray(at, at + bytes);
    if (Buffer.compare(ours, theirs) === 0) continue;
    for (let i = 0; i < bytes; i++) {
      if (ours[i] === theirs[i] || skip.some(([start, end]) => at + i >= start && at + i < end)) continue;
      return { at: at + i, ours: ours[i], theirs: theirs[i] };
    }
  }
  return null;
}

parentPort.on('message', message => {
  if (message.set) {
    image = message.set;
    expected = Uint8Array.from(image);
    give();
    parentPort.postMessage({ done: true });
    return;
  }
  if (message.types) {
    parentPort.postMessage({ types: Array.from({ length: message.count }, (_, k) => exports[message.types](k) >>> 0) });
    return;
  }
  if (own) memory.set(before, own.from);
  if (stack !== undefined) exports.__stack_pointer.value = stack;
  // the changes, in the module's memory and in what the call has to leave, and what the original wrote in the latter
  const touched = [...message.skip];
  for (const [where, bytes, value] of message.changes) {
    const at = inImage(where);
    if (at < 0 || at + bytes > IMAGE) continue;
    for (let i = 0; i < bytes; i++) {
      const byte = (value >>> (8 * (bytes - 1 - i))) & 0xFF;
      expected[at + i] = byte;
      memory[folded(at + i)] = byte;
    }
    touched.push([at, at + bytes]);
  }
  for (const chunk of message.chunks) {
    expected.set(chunk.bytes, chunk.at);
    touched.push([chunk.at, chunk.at + chunk.bytes.length]);
  }
  let gave;
  try {
    gave = BigInt.asUintN(64, exports[message.call](...message.args.map(value => BigInt.asUintN(64, BigInt(value)))));
  } catch (error) {
    give();
    if (error instanceof Unbuilt) parentPort.postMessage({ stopped: 'unbuilt', unbuilt: error.message });
    else if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) parentPort.postMessage({ stopped: 'mismatch' });
    else parentPort.postMessage({ stopped: String(error.message ?? error) });
    return;
  }
  const differs = firstDifference(message.skip);
  // where the twin left what the original did, it wrote nowhere but there and the skipped stretches, which are all put
  // back; anywhere else, the whole memory is
  if (differs) give();
  else putBack(touched);
  parentPort.postMessage({ gave, differs });
});
parentPort.postMessage({ ready: true });
