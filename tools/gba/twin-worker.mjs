// Runs the twins for the function check (twin.mjs), in a thread of its own: a twin that never comes back can't be
// stopped from inside, so the check stops the whole thread and starts another. It holds the module the twins were
// built to, with the console's memory at the console's addresses and the contributor's copy where the cartridge is.
// Twins built on the kit keep the video memory, the colours and the sprites where the kit does, so that is where those
// parts of the image go and come from, and the kit is told the copy is the cartridge. It is told what to do in messages:
//
//   { set: image }                        puts the image, the console's five memories one after another (call.c), in
//                                         the module's memory. Answers { done: true }.
//   { call: name, args, changes }         changes those values, each [address, bytes, value], calls the function and
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
const memory = new Uint8Array(exports.memory.buffer), view = new DataView(exports.memory.buffer);
// the cartridge, where the console has it: a twin reads its data from there
const rom = readFileSync(workerData.copy);
if (CARTRIDGE + rom.length > memory.length) throw new Error('The twins\' memory doesn\'t reach the end of the cartridge.');
memory.set(rom, CARTRIDGE);
// each memory of the image where this module has it: the kit's own, for the ones the kit keeps
const regions = REGIONS.map(region => ({ ...region, address: exports[region.kit]?.value ?? region.address }));
// the kit's copy of the game is the cartridge, for a twin that reads its data through the kit
if (exports.kit_copy && exports.kit_copy_size) {
  view.setUint32(exports.kit_copy.value, CARTRIDGE, true);
  view.setUint32(exports.kit_copy_size.value, rom.length, true);
}
// where the module's own stack starts, to put it back after a twin stopped partway
const stack = exports.__stack_pointer?.value;

function give(image) {
  for (const { at, address, bytes } of regions) memory.set(image.subarray(at, at + bytes), address);
}

parentPort.on('message', message => {
  if (message.set) {
    give(message.set);
    parentPort.postMessage({ done: true });
    return;
  }
  for (const [address, bytes, value] of message.changes) {
    if (bytes === 1) view.setUint8(address, value);
    else if (bytes === 2) view.setUint16(address, value, true);
    else view.setUint32(address, value, true);
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
  const image = new Uint8Array(IMAGE);
  for (const { at, address, bytes } of regions) image.set(memory.subarray(address, address + bytes), at);
  parentPort.postMessage({ gave, image }, [image.buffer]);
});
parentPort.postMessage({ ready: true });
