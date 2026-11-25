// The Nintendo DS's function finder (../nds/functions.mjs) on a made-up cartridge written here, with nothing from any
// game in it: an ARM9 program in ARM and Thumb code that copies a stretch of itself elsewhere as it starts, an ARM7
// program, and an overlay packed from the end backwards, as the console's makers' tools pack one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc16 } from '../nds/header.mjs';
import { findFunctions, ndsCartridgeOf, unpackBackwards } from '../nds/functions.mjs';
import { formatCodeMap, parseCodeMap } from '../lib/proof-files.mjs';

// instructions as their words, with the few lines that make them, so the test needs no assembler
const arm = word => ({ size: 4, at: () => word >>> 0 });
const armTo = (top, label) => ({ size: 4, at: (labels, pc) => (top | ((labels[label] - pc - 8) >> 2 & 0xFFFFFF)) >>> 0 });
const bl = label => armTo(0xEB000000, label), b = label => armTo(0xEA000000, label);
const blxThumb = label => ({ size: 4, at: (labels, pc) => { const off = labels[label] - pc - 8; return (0xFA000000 | (off >> 1 & 1) << 24 | (off >> 2 & 0xFFFFFF)) >>> 0; } });
const ldrBeside = (register, label) => ({ size: 4, at: (labels, pc) => (0xE59F0000 | register << 12 | (labels[label] - pc - 8)) >>> 0 });
const word = value => ({ size: 4, at: labels => (typeof value === 'function' ? value(labels) : value) >>> 0 });
const thumb = op => ({ size: 2, at: () => op });
const thumbPair = (second, round) => label => ({ size: 4, at: (labels, pc) => { const off = labels[label] - (round ? (pc + 4) & ~3 : pc + 4); return (0xF000 | (off >> 12 & 0x7FF)) | (second | (off >> 1 & 0x7FF)) << 16; } });
const tbl = thumbPair(0xF800, false), tblx = thumbPair(0xE800, true);
const here = name => ({ name, size: 0 });
const align = { size: 0, align: 4 };

function assemble(items, base) {
  const labels = {};
  let pc = base;
  for (const item of items) {
    if (item.align) pc = (pc + 3) & ~3;
    if (item.name) labels[item.name] = pc;
    pc += item.size;
  }
  const bytes = Buffer.alloc(pc - base);
  pc = base;
  for (const item of items) {
    if (item.align) pc = (pc + 3) & ~3;
    if (item.size === 4) bytes.writeUInt32LE(item.at(labels, pc) >>> 0, pc - base);
    if (item.size === 2) bytes.writeUInt16LE(item.at(labels, pc), pc - base);
    pc += item.size;
  }
  return { bytes, labels };
}

const PUSH_R4_LR = 0xE92D4010, POP_R4_PC = 0xE8BD8010, PUSH_LR = 0xE92D4000, POP_PC = 0xE8BD8000, BX_LR = 0xE12FFF1E, ADD = 0xE0800001;
const ARM9_AT = 0x02000000, FAST_AT = 0x01FF8000, ARM7_AT = 0x02380000, OVERLAY_AT = 0x02100000;

// the stretch the program copies to its fast memory as it starts: one function, which nothing in the program calls by address
const FAST = assemble([here('fast'), arm(PUSH_LR), arm(0xE3A00007), arm(POP_PC)], FAST_AT);

const ARM9 = assemble([
  here('start'), bl('main'), here('spin'), b('spin'),
  here('main'), arm(PUSH_R4_LR), bl('sum'), blxThumb('twice'), bl('pick'), ldrBeside(0, 'shine_at'), ldrBeside(1, 'glow_at'), arm(POP_R4_PC),
  here('shine_at'), word(labels => labels.shine + 1), here('glow_at'), word(labels => labels.glow),
  here('sum'), arm(ADD), arm(BX_LR),
  // a switch: a jump into the branches after it
  here('pick'), arm(0xE3500002), arm(0x908FF100), b('other'), b('case0'), b('case1'), b('case2'),
  here('case0'), arm(0xE3A00001), arm(BX_LR), here('case1'), arm(0xE3A00002), arm(BX_LR), here('case2'), arm(0xE3A00003), arm(BX_LR), here('other'), arm(0xE3A00000), arm(BX_LR),
  here('twice'), thumb(0xB500), tbl('sum_thumb'), tblx('sum'), thumb(0xBD00),
  here('sum_thumb'), thumb(0x1840), thumb(0x4770),
  // reached only through an address the program loads
  here('shine'), thumb(0xB510), thumb(0x2001), thumb(0xBD10), align,
  here('glow'), arm(PUSH_LR), arm(0xE3A00000), arm(POP_PC),
  // nothing leads to it
  here('alone'), arm(PUSH_R4_LR), arm(ADD), arm(POP_R4_PC),
  // values, which aren't code
  here('values'), word(0x11111111), word(0x22222222), word(0x00000003),
  // what the start-up code needs to know: the list of stretches to copy, its end, where their bytes are, and nothing packed
  word(labels => labels.list), word(labels => labels.list + 12), word(labels => labels.copied), word(0), word(0), word(0), word(0),
  word(0x2106C0DE), word(0xDEC00621),
  here('list'), word(FAST_AT), word(FAST.bytes.length), word(0),
  here('copied'), ...Array.from({ length: FAST.bytes.length / 4 }, (_, i) => word(FAST.bytes.readUInt32LE(i * 4))),
], ARM9_AT);

const ARM7 = assemble([here('start'), bl('wait'), here('spin'), b('spin'), here('wait'), arm(BX_LR)], ARM7_AT);

// an overlay: one function its list of what to run as it's loaded names, in Thumb, and one that only opens as a function does
const OVERLAY = assemble([
  here('first'), thumb(0xB500), thumb(0x2005), thumb(0xBD00), align,
  here('second'), arm(PUSH_R4_LR), ...Array.from({ length: 12 }, () => arm(ADD)), arm(POP_R4_PC),
  here('inits'), word(labels => labels.first + 1), here('inits_end'),
], OVERLAY_AT);

// packs bytes from the end backwards as the console's makers' tools do, the first `keep` of them left as they are
function packBackwards(bytes, keep = 0) {
  const stream = [];
  let to = bytes.length;
  while (to > keep) {
    let flags = 0;
    const group = [];
    for (let bit = 7; bit >= 0 && to > keep; bit--) {
      let best = 0, bestBack = 0;
      for (let back = 3; back <= 0x1002 && to - 1 + back < bytes.length; back++) {
        let length = 0;
        while (length < 18 && to - 1 - length >= keep && bytes[to - 1 - length] === bytes[to - 1 - length + back]) length++;
        if (length > best) { best = length; bestBack = back; }
      }
      if (best >= 3) {
        flags |= 1 << bit;
        const token = (best - 3) << 12 | (bestBack - 3);
        group.push(token >> 8, token & 0xFF);
        to -= best;
      } else {
        group.push(bytes[--to]);
      }
    }
    stream.push(flags, ...group);
  }
  const packed = Buffer.from(stream.reverse()), pad = Buffer.alloc(-(keep + packed.length) & 3, 0xFF), footer = Buffer.alloc(8);
  footer.writeUInt32LE((packed.length + pad.length + 8) | (8 + pad.length) << 24, 0);
  const whole = keep + packed.length + pad.length + 8;
  footer.writeUInt32LE(bytes.length - whole, 4);
  return Buffer.concat([bytes.subarray(0, keep), packed, pad, footer]);
}

function cartridge() {
  const rom = Buffer.alloc(0x20000), packed = packBackwards(OVERLAY.bytes);
  const put = (at, { offset, address, entry, bytes }) => { rom.writeUInt32LE(offset, at); rom.writeUInt32LE(entry, at + 4); rom.writeUInt32LE(address, at + 8); rom.writeUInt32LE(bytes.length, at + 12); bytes.copy(rom, offset); };
  rom.write('MADE UP FNS', 0, 'latin1');
  rom.write('MFNE', 0xC, 'latin1');
  put(0x20, { offset: 0x8000, address: ARM9_AT, entry: ARM9.labels.start, bytes: ARM9.bytes });
  put(0x30, { offset: 0xC000, address: ARM7_AT, entry: ARM7.labels.start, bytes: ARM7.bytes });
  // the table of where each file is, with the overlay's file its only one, and the ARM9's table of overlays
  const PLACES = 0xD000, TABLE = 0xD100, FILE = 0xE000;
  rom.writeUInt32LE(PLACES, 0x48); rom.writeUInt32LE(8, 0x4C);
  rom.writeUInt32LE(FILE, PLACES); rom.writeUInt32LE(FILE + packed.length, PLACES + 4);
  rom.writeUInt32LE(TABLE, 0x50); rom.writeUInt32LE(32, 0x54);
  [3, OVERLAY_AT, OVERLAY.bytes.length, 0, OVERLAY.labels.inits, OVERLAY.labels.inits_end, 0, (packed.length | 1 << 24) >>> 0].forEach((value, i) => rom.writeUInt32LE(value >>> 0, TABLE + i * 4));
  packed.copy(rom, FILE);
  rom.writeUInt32LE(rom.length, 0x80);
  rom.writeUInt32LE(0x4000, 0x84);
  rom.writeUInt16LE(crc16(rom.subarray(0, 0x15E)), 0x15E);
  return rom;
}

test('unpacks what is packed from the end backwards, with what comes before left as it is', () => {
  const bytes = Buffer.from('a head kept as it is, then: ABCABCABCDEF and the same again, ABCABCABCDEF, to the end');
  for (const keep of [0, 5, 20]) {
    const packed = packBackwards(bytes, keep);
    assert.deepEqual(unpackBackwards(packed), bytes);
    assert.ok(keep || packed.length < bytes.length, 'the repeats made it shorter');
  }
  assert.throws(() => unpackBackwards(Buffer.from([1, 2, 3, 4, 0xFF, 0xFF, 0xFF, 1, 0, 0, 0, 0])), /isn't packed/);
});

test('finds every function of a made-up cartridge, in each program, with its size and its kind of code', () => {
  const code = ndsCartridgeOf(cartridge());
  assert.deepEqual(code.programs.map(p => p.name), [null, 'ARM7', 'OVERLAY9_0003']);
  const found = findFunctions(code);
  const at = (labels, name, size, mode, program) => ({ address: labels[name], size, ...(mode === 'thumb' ? { mode } : {}), ...(program ? { program } : {}) });
  const L = ARM9.labels;
  assert.deepEqual(found, [
    at(FAST.labels, 'fast', 12, 'arm'),
    at(L, 'start', 8, 'arm'),
    at(L, 'main', L.shine_at - L.main, 'arm'),
    at(L, 'sum', 8, 'arm'),
    at(L, 'pick', L.twice - L.pick, 'arm'),
    at(L, 'twice', 12, 'thumb'),
    at(L, 'sum_thumb', 4, 'thumb'),
    at(L, 'shine', 6, 'thumb'),
    at(L, 'glow', 12, 'arm'),
    at(L, 'alone', 12, 'arm'),
    at(ARM7.labels, 'start', 8, 'arm', 'ARM7'),
    at(ARM7.labels, 'wait', 4, 'arm', 'ARM7'),
    at(OVERLAY.labels, 'first', 6, 'thumb', 'OVERLAY9_0003'),
    at(OVERLAY.labels, 'second', 56, 'arm', 'OVERLAY9_0003'),
  ]);
});

test('a code map keeps which program each function is in and its kind of code, and a list\'s functions keep their names', () => {
  const code = ndsCartridgeOf(cartridge()), found = findFunctions(code);
  const read = parseCodeMap(JSON.parse(formatCodeMap({ original: 'x', from: 'y', functions: found })));
  assert.equal(read.functions.find(f => f.program === 'OVERLAY9_0003' && f.address === OVERLAY.labels.first).mode, 'thumb');
  assert.equal(read.functions.find(f => f.key === `${ARM7.labels.wait.toString(16).toUpperCase().padStart(8, '0')}@ARM7`).mode, undefined);
  const listed = [{ address: ARM9.labels.sum, size: 8, name: 'Sum' }];
  const again = findFunctions(code, listed);
  assert.equal(again.length, found.length);
  assert.equal(again.find(f => f.address === ARM9.labels.sum && !f.program).name, 'Sum');
});
