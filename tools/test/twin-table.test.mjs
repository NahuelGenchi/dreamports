// What a game made the stricter way calls through a pointer (lib/c.mjs, twinsHeader's TWIN_TABLE, and
// lib/wasm-addresses.mjs): an address of the original, which kit_twin turns into the twin's number in the module's
// table, whatever the addresses of its twins are (#1952). Twins sitting evenly apart once came out of clang's
// optimizer as a table in the module's data, which the build gave the original's addresses, and the game stopped with
// "table index is out of bounds" as it started.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWasm, twinsHeader } from '../lib/c.mjs';
import { LOCAL } from '../lib/paths.mjs';

const work = join(LOCAL, 'tmp', 'twin-table-test');
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');

// twelve made-up twins, each giving back its own number, at `address(i)`, and a function that calls through an
// address kept as a value, as a game calls a task's function
async function built(name, address) {
  const folder = join(work, name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const twins = Array.from({ length: 12 }, (_, i) => ({ name: `Twin${i}`, address: address(i), own: false }));
  writeFileSync(join(folder, 'twins.h'), twinsHeader(twins));
  writeFileSync(join(folder, 'game.c'), [
    '#include "twins.h"',
    ...twins.map((twin, i) => `/** ${twin.name}, 0x${hex8(twin.address)} */\nint ${twin.name}(void) { return ${i + 100}; }`),
    '__attribute__((export_name("call"))) int call(uint32_t address) { int (*f)(void) = (int (*)(void))(uintptr_t)address; return f(); }',
    'TWIN_TABLE',
    '',
  ].join('\n'));
  const codes = new Map(twins.map(twin => [twin.name, twin.address | 1]));
  const out = join(folder, 'game.wasm');
  // as a game's build of twins asks for it (lib/c.mjs): kit_twin exported, for the calls through a pointer to go by
  await buildWasm([join(folder, 'game.c')], out, { folders: [folder], flags: ['-O2', '-Wl,--export-if-defined=kit_twin'], addressOf: () => null, codeOf: each => codes.get(each) ?? null });
  const { instance } = await WebAssembly.instantiate(readFileSync(out), {});
  return { call: instance.exports.call, twins };
}

test('a call through an address of the original reaches its twin, with the twins evenly apart', async () => {
  const { call, twins } = await built('even', i => 0x08000100 + i * 0x40);
  assert.deepEqual(twins.map(twin => call(twin.address | 1)), twins.map((_, i) => i + 100));
});

test('and with the twins wherever they are', async () => {
  const { call, twins } = await built('uneven', i => 0x08000100 + i * i * 0x34 + (i % 3) * 0x10);
  assert.deepEqual(twins.map(twin => call(twin.address | 1)), twins.map((_, i) => i + 100));
  rmSync(work, { recursive: true, force: true });
});
