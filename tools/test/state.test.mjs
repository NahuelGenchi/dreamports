// What prove says about what the console holds, in the original and in a Dreamport (lib/state.mjs).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { STATE_BYTES, compareState, describeState } from '../lib/state.mjs';

const COLOURS = 0x58, SPRITES = COLOURS + 0x400, VRAM = SPRITES + 0x400;

// a state with a layer showing: BG0, tiles at the start of video memory and a small map at 0xF800
function state(change) {
  const bytes = Buffer.alloc(STATE_BYTES);
  bytes.writeUInt16LE(0x1100, 0);        // DISPCNT: mode 0, BG0 and the sprites
  bytes.writeUInt16LE(0x1F00, 0x08);     // BG0CNT
  for (let i = 0; i < 128; i++) bytes.writeUInt16LE(0x0200, SPRITES + i * 8);   // every sprite hidden
  change?.(bytes);
  return bytes;
}

test('two states that are the same have nothing to say', () => {
  const found = compareState(state(), state());
  assert.deepEqual(found.registers, []);
  assert.deepEqual(found.colours, []);
  assert.deepEqual(found.sprites, []);
  assert.deepEqual(found.videoMemory, { bytes: 0, stretches: [], unused: 0 });
  assert.deepEqual(describeState(5, found, false), ['Frame 5, what the console holds as it draws it: the same in both.']);
});

test('a picture that differs from a state that doesn\'t is down to how it\'s drawn', () => {
  assert.match(describeState(5, compareState(state(), state()), true)[0], /how it's drawn/);
});

test('it names a register that differs, as its scroll or its value', () => {
  const found = compareState(state(b => b.writeUInt16LE(255, 0x12)), state(b => b.writeUInt16LE(0x1F40, 0x50)));
  assert.deepEqual(found.registers.map(r => [r.name, r.original, r.dreamport]), [['BG0VOFS', 255, 0], ['BLDCNT', 0, 0x1F40]]);
  assert.match(describeState(5, found, true)[1], /BG0VOFS is 255 in the original, 0 in the Dreamport; BLDCNT is 0x0000 in the original, 0x1F40 in the Dreamport/);
});

test('a register of what shows in neither doesn\'t count', () => {
  const hidden = b => {
    b.writeUInt16LE(11, 0x14);   // BG1HOFS, and BG1 doesn't show
    b.writeUInt16LE(11, 0x20);   // BG2PA, and nothing rotates in mode 0
    b.writeUInt16LE(11, 0x40);   // WIN0H, and no window is on
  };
  assert.deepEqual(compareState(state(hidden), state()).registers, []);
});

test('it says which palette a colour is in', () => {
  const found = compareState(state(b => b.writeUInt16LE(0x7FFF, COLOURS + 0x202)), state());
  assert.deepEqual(found.colours.map(c => [c.address, c.of, c.palette, c.colour]), [['0x05000202', 'sprites', 0, 1]]);
  assert.match(describeState(5, found, true)[1], /the sprites' palette 0, colour 1, is #ffffff in the original, #000000 in the Dreamport/);
});

test('it reads a sprite that differs, and leaves out those hidden in both', () => {
  const sprite = b => {
    b.writeUInt16LE(0x4014, SPRITES + 24);   // sprite 3: y 20, a wide shape
    b.writeUInt16LE(0x4028, SPRITES + 26);   // x 40, that shape's second size
    b.writeUInt16LE(0x2505, SPRITES + 28);   // tile 261, priority 1, palette 2
    b.writeUInt16LE(9, SPRITES + 42);        // sprite 5, still hidden, with something else different
  };
  const found = compareState(state(sprite), state());
  assert.deepEqual(found.sprites.map(s => s.sprite), [3]);
  assert.equal(found.sprites[0].dreamport, null);
  assert.deepEqual([found.sprites[0].original.x, found.sprites[0].original.y, found.sprites[0].original.tile, found.sprites[0].original.width, found.sprites[0].original.height, found.sprites[0].original.palette, found.sprites[0].original.priority], [40, 20, 261, 32, 8, 2, 1]);
  assert.match(describeState(5, found, true)[1], /sprite 3 is x 40, y 20, tile 261, 32 x 8, palette 2, priority 1 in the original, hidden in the Dreamport/);
});

test('video memory says what uses it, and only how a map starts, never a tile', () => {
  const memory = b => {
    b[VRAM + 0x40] = 0xAB;            // BG0's tiles
    b.writeUInt16LE(0xF292, VRAM + 0xF80C);   // BG0's map
    b[VRAM + 0x10000] = 0xCD;         // the sprites' tiles
    b[VRAM + 0xC000] = 0xEF;          // nothing on screen
  };
  const { videoMemory, ...rest } = compareState(state(memory), state());
  assert.deepEqual(videoMemory.stretches.map(s => [s.from, s.uses, s.original]), [
    ['0x06000040', ["BG0's tiles"], undefined],
    ['0x0600F80C', ["BG0's map"], 0xF292],
    ['0x06010000', ["the sprites' tiles"], undefined],
  ]);
  assert.equal(videoMemory.unused, 1);
  const lines = describeState(5, { videoMemory, ...rest }, true).join('\n');
  assert.match(lines, /0x0600F80C to 0x0600F80D, BG0's map, 2 bytes, starting 0xF292 in the original, 0x0000 in the Dreamport/);
  assert.doesNotMatch(lines, /0xAB|0xCD|0xEF/);
  assert.match(lines, /doesn't use, 1 byte,/);
});

test('stretches close together are one', () => {
  const memory = b => { b[VRAM + 0x40] = 1; b[VRAM + 0x50] = 1; b[VRAM + 0x100] = 1; };
  const { stretches } = compareState(state(memory), state()).videoMemory;
  assert.deepEqual(stretches.map(s => [s.from, s.to, s.bytes]), [['0x06000040', '0x06000050', 2], ['0x06000100', '0x06000100', 1]]);
});
