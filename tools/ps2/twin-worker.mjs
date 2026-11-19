// Runs the twins of the PlayStation 2's function check (twin.mjs) in a thread of its own, as a twin that never comes
// back can't be stopped from inside: the check stops the whole thread and starts another. It holds the module the twins
// were built to, with every address folded by its top byte (../lib/wasm-fold.mjs), so each of the console's memories is
// where original.mjs lays it in the image, and compares what a twin leaves there with what the original's function left,
// so the whole memory never crosses between threads. It's told what to do in messages:
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
//
// Besides the image there's a stretch where the table sends every address the console has nothing at, `nowhere`, which
// a twin must leave as it was given, empty, as the original would have stopped had it gone there. The module marks each
// 4 KB it writes in a map (../lib/wasm-fold.mjs), so a call's memory is compared, and put back, only where the twin or
// the original wrote, rather than all 34 MB after every call.

import { parentPort, workerData } from 'node:worker_threads';

const { table, tableAt, written, nowhere, image: size } = workerData;
// the map of pages a call wrote, a byte each, and the byte after it, set when a copy or a fill reached too many to mark
const PAGE = 4096, PAGES = 0x10000;
class Unbuilt extends Error {}

const module = new WebAssembly.Module(workerData.module);
const imports = {};
for (const { module: from, name, kind: what } of WebAssembly.Module.imports(module)) {
  if (what !== 'function') throw new Error(`The twins' module takes ${name} from outside, which isn't a function.`);
  (imports[from] ??= {})[name] = name === workerData.noCode
    ? address => { throw new Unbuilt(`0x${(address >>> 0).toString(16).toUpperCase().padStart(8, '0')}`); }
    : () => { throw new Unbuilt(name); };
}
const { exports } = new WebAssembly.Instance(module, imports);
// the memory's views, taken again whenever a call has made it grow
let memory, view;
const views = () => {
  if (memory?.buffer !== exports.memory.buffer) {
    memory = new Uint8Array(exports.memory.buffer);
    view = new DataView(exports.memory.buffer);
  }
};
views();
if (size > nowhere.at || nowhere.at + nowhere.bytes > tableAt || tableAt + table.length * 4 > written || written + PAGES + 1 > memory.length) throw new Error('The twins\' memory doesn\'t hold the console\'s memories as folded.');
memory.set(new Uint8Array(Uint32Array.from(table).buffer), tableAt);
const stack = exports.__stack_pointer?.value;
// the module's own values as they were before any call, put back before each, as each call of the original starts
// afresh
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
const before = own && memory.slice(own.from, own.to);
let image = new Uint8Array(size);
// where the last call left the memory other than the image, which is put back before the next
let touched = [];
const zeros = new Uint8Array(nowhere.bytes);

// where an address folds to, as the module folds it
const fold = address => ((address & table[(address >>> 24) * 2]) >>> 0) + table[(address >>> 24) * 2 + 1];
// what the image and `nowhere` hold from `from` to `to`, where they're one or the other
const given = (from, to) => (from >= nowhere.at ? zeros.subarray(from - nowhere.at, to - nowhere.at) : image.subarray(from, to));

// the first place the twin's bytes differ from the original's, both at `at` in the image
function firstDifference(ours, theirs, at) {
  if (Buffer.compare(ours, theirs) === 0) return null;
  const i = ours.findIndex((byte, n) => byte !== theirs[n]);
  return { at: at + i, ours: ours[i], theirs: theirs[i] };
}

// The stretches of the image and of `nowhere` a call may have left other than they were: the pages the map says it
// wrote, joined where they touch, or all of both when it wrote too many to say.
function writtenPages() {
  const map = memory.subarray(written, written + PAGES + 1);
  if (map[PAGES]) return [[0, size], [nowhere.at, nowhere.at + nowhere.bytes]];
  const pages = [];
  for (const [from, to] of [[0, size], [nowhere.at, nowhere.at + nowhere.bytes]]) {
    for (let page = Math.floor(from / PAGE); page * PAGE < to; page++) {
      if (!map[page]) continue;
      const start = Math.max(from, page * PAGE), end = Math.min(to, (page + 1) * PAGE);
      if (pages.length && pages.at(-1)[1] === start) pages.at(-1)[1] = end;
      else pages.push([start, end]);
    }
  }
  return pages;
}

parentPort.on('message', message => {
  if (message.set) {
    image = message.set;
    views();
    memory.set(image, 0);
    memory.fill(0, nowhere.at, nowhere.at + nowhere.bytes);
    memory.fill(0, written, written + PAGES + 1);
    touched = [];
    parentPort.postMessage({ done: true });
    return;
  }
  views();
  // the image back as it was where the last call left it otherwise, the module's own values and its stack
  for (const [from, to] of touched) memory.set(given(from, to), from);
  memory.fill(0, written, written + PAGES + 1);
  if (own) memory.set(before, own.from);
  if (stack !== undefined) exports.__stack_pointer.value = stack;
  // the changes, and what the original left: the image with them and what it wrote laid over it
  const laid = [];
  for (const [where, bytes, value] of message.changes) {
    const at = fold(where >>> 0);
    if (at + bytes > size) continue;
    if (bytes === 1) view.setUint8(at, value);
    else if (bytes === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    laid.push([at, at + bytes, Uint8Array.from({ length: bytes }, (_, i) => (value >>> (8 * i)) & 0xFF)]);
  }
  for (const chunk of message.chunks) laid.push([chunk.at, chunk.at + chunk.bytes.length, chunk.bytes]);
  touched = laid.map(([from, to]) => [from, to]);
  let gave;
  try {
    gave = exports[message.call](...message.args);
    gave = typeof gave === 'bigint' ? BigInt.asUintN(64, gave) : gave >>> 0;
  } catch (error) {
    views();
    touched.push([0, size], [nowhere.at, nowhere.at + nowhere.bytes]);
    if (error instanceof Unbuilt) parentPort.postMessage({ stopped: 'unbuilt', unbuilt: error.message });
    else if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) parentPort.postMessage({ stopped: 'mismatch' });
    else parentPort.postMessage({ stopped: String(error.message ?? error) });
    return;
  }
  views();
  // what may differ: what the twin wrote and what the original wrote, a stretch at a time between their edges, each the
  // original's where it wrote there, the later over the earlier, but the stretches left out
  const pages = writtenPages();
  touched.push(...pages);
  const compared = [...pages, ...laid.map(([from, to]) => [from, to])];
  const marks = [...new Set([...compared.flat(), ...message.skip.flat()])].sort((x, y) => x - y);
  let differs = null;
  for (let k = 0; k + 1 < marks.length && !differs; k++) {
    const from = marks[k], to = marks[k + 1];
    if (!compared.some(([start, end]) => start <= from && end >= to) || message.skip.some(([start, end]) => start <= from && end >= to)) continue;
    const covering = laid.filter(([start, end]) => start <= from && end >= to);
    let theirs = given(from, to);
    if (covering.length) {
      theirs = Uint8Array.from(theirs);
      for (const [start, , bytes] of covering) theirs.set(bytes.subarray(from - start, to - start));
    }
    differs = firstDifference(memory.subarray(from, to), theirs, from);
  }
  parentPort.postMessage({ gave, differs });
});
parentPort.postMessage({ ready: true });
