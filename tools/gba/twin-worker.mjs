// Runs the twins for the function check (twin.mjs), in a thread of its own: a twin that never comes back can't be
// stopped from inside, so the check stops the whole thread and starts another. It holds the module the twins were
// built to, with the console's memory at the console's addresses, the kit's colours, video memory and sprites among it,
// and the contributor's copy where the cartridge is. The kit is told the copy is the cartridge. It is told what to do
// in messages:
//
//   { set: image }                        puts the image, the console's five memories one after another (call.c), in
//                                         the module's memory. Answers { done: true }.
//   { call: name, args, changes }         changes those values, each [address, bytes, value], where the image's are,
//                                         calls the function and
//                                         answers { gave, image }, what it gave back and the image it left, or
//                                         { stopped: why } when it stopped: on its own, because it called something
//                                         that nothing built is the twin of ('unbuilt', with which as `unbuilt`), or
//                                         because it called through a pointer a function of another kind ('mismatch').

import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { CARTRIDGE, IMAGE, REGIONS } from './twin-memory.mjs';

// what a twin calls and nothing built defines: the call ends there, and the check is told which it was
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
let memory = new Uint8Array(exports.memory.buffer), view = new DataView(exports.memory.buffer);
// the views again after a call made the module's memory grow, as one through the C library's allocator does, which
// leaves the old ones on nothing
function fresh() {
  if (memory.buffer === exports.memory.buffer) return;
  memory = new Uint8Array(exports.memory.buffer);
  view = new DataView(exports.memory.buffer);
}
// the cartridge, where the console has it: a twin reads its data from there
const rom = readFileSync(workerData.copy);
if (CARTRIDGE + rom.length > memory.length) throw new Error('The twins\' memory doesn\'t reach the end of the cartridge.');
memory.set(rom, CARTRIDGE);
// the kit's copy of the game is the cartridge, for a twin that reads its data through the kit
if (exports.kit_copy && exports.kit_copy_size) {
  view.setUint32(exports.kit_copy.value, CARTRIDGE, true);
  view.setUint32(exports.kit_copy_size.value, rom.length, true);
}
// where the module's own stack starts, to put it back after a twin stopped partway
const stack = exports.__stack_pointer?.value;
// The module's own values, as they were before any call: what the kit keeps, such as its registers, and what the
// version's hardware keeps, such as a DMA channel's state. The original's hardware is as it was before each call, so
// these are put back before each call too. The memories of the image, which the check gives, are all below them.
const own = exports.__data_end ? { from: exports.__global_base?.value ?? 0, to: exports.__data_end.value } : null;
const before = own && memory.slice(own.from, own.to);
if (own && REGIONS.some(({ address, bytes }) => address + bytes > own.from)) throw new Error('The twins\' own values start inside the console\'s memory.');
// A version that keeps the console's registers itself, as a same-memory version does in its console_io, is given the
// original's as each call starts, as the original's own are as they were before each call (#1527). The kit's display
// registers are the kit's, and stay as the module starts them.
const registers = exports.console_io && workerData.registers ? new Uint8Array(workerData.registers) : null;
function putBack() {
  if (own) memory.set(before, own.from);
  if (registers) memory.set(registers, exports.console_io.value);
}

function give(image) {
  for (const { at, address, bytes } of REGIONS) memory.set(image.subarray(at, at + bytes), address);
}

parentPort.on('message', message => {
  fresh();
  if (message.set) {
    give(message.set);
    parentPort.postMessage({ done: true });
    return;
  }
  putBack();
  for (const [where, bytes, value] of message.changes) {
    // a hardware register, as the display's status a call starts outside the V-blank with, goes where the version
    // keeps the console's registers, or nowhere for one that doesn't
    if (where >= 0x04000000 && where < 0x05000000) {
      if (registers && where - 0x04000000 + 2 <= registers.length) view.setUint16(exports.console_io.value + where - 0x04000000, value, true);
      continue;
    }
    if (bytes === 1) view.setUint8(where, value);
    else if (bytes === 2) view.setUint16(where, value, true);
    else view.setUint32(where, value, true);
  }
  let gave;
  try {
    gave = exports[message.call](...message.args) >>> 0;
  } catch (error) {
    if (stack !== undefined) exports.__stack_pointer.value = stack;
    // WebAssembly stops a call through a pointer to a function that takes or gives something else, where the console
    // just runs it: that says nothing of the twin, only that the check gave it such a pointer
    if (error instanceof Unbuilt) parentPort.postMessage({ stopped: 'unbuilt', unbuilt: error.message });
    else if (error instanceof WebAssembly.RuntimeError && /signature mismatch/.test(error.message)) parentPort.postMessage({ stopped: 'mismatch' });
    else parentPort.postMessage({ stopped: String(error.message ?? error) });
    return;
  }
  fresh();
  const image = new Uint8Array(IMAGE);
  for (const { at, address, bytes } of REGIONS) image.set(memory.subarray(address, address + bytes), at);
  parentPort.postMessage({ gave, image }, [image.buffer]);
});
parentPort.postMessage({ ready: true });
