// A small Nintendo DS cartridge with nothing from any game in it, written here, for the test of the console's function
// check (nds-twin.mjs): a program for each of its two processors, as every game has, whose functions are each small
// enough to say in a line of C, which the test's twins do (nds-twin/game.c).
//
// The ARM9's program starts in ARM code, calls each of its functions in ARM code, and goes on to its main in Thumb
// code, which calls each of those in Thumb code, so the function finder finds every one from where the program starts
// (../nds/functions.mjs). The ARM7's does the same with its two. The ARM code is written as the words it is, each with
// what it says beside it, and the Thumb code with the tools' own assembler (../gba/thumb.mjs), whose calls are filled
// in here. Neither program does anything worth playing: each ends in a loop.
//
// The header has no logo, as the logo is Nintendo's (made-up-nds.mjs).

import { createHash } from 'node:crypto';
import { assemble } from '../gba/thumb.mjs';
import { crc16 } from './made-up-nds.mjs';

/** Where each program is in the cartridge and in memory. */
export const ARM9 = { offset: 0x8000, address: 0x02000000 };
export const ARM7 = { offset: 0xC000, address: 0x02380000 };
/** The four numbers arm_lookup gives back, and a place in the main memory seen through its second mirror. */
export const VALUES = [0x00000011, 0x00002200, 0x00330000, 0x44000000];
export const MIRRORED = 0x027FFC00;

// A word the assembler leaves as 0 for programOf to fill in, under a name of its own so its place is known: ARM's bl
// to a function, the address of one of the program's names, and main's address as Thumb code has it, odd.
let fills = [];
const fill = (kind, name) => {
  fills.push({ label: `.Lfill${fills.length}`, kind, name });
  return `${fills.at(-1).label}: .word 0`;
};
const CALL = name => fill('call', name), ADDRESS = name => fill('address', name), THUMB = name => fill('thumb', name);
const written = text => {
  const program = { text, fills };
  fills = [];
  return program;
};

const ARM9_PROGRAM = written(`
	.text
	.code 16
start:
	${CALL('arm_sum')}
	${CALL('arm_clamp')}
	${CALL('arm_fill')}
	${CALL('arm_lookup')}
	${CALL('arm_io')}
	${CALL('arm_control')}
	.word 0xE59F0000 @ ldr r0, [pc]
	.word 0xE12FFF10 @ bx r0
	${THUMB('main')}
arm_sum:
	.word 0xE0800001 @ add r0, r0, r1
	.word 0xE12FFF1E @ bx lr
arm_clamp:
	.word 0xE3500064 @ cmp r0, #100
	.word 0xC3A00064 @ movgt r0, #100
	.word 0xE3500000 @ cmp r0, #0
	.word 0xB3A00000 @ movlt r0, #0
	.word 0xE12FFF1E @ bx lr
arm_fill:
	.word 0xE3510000 @ cmp r1, #0
	.word 0x012FFF1E @ bxeq lr
	.word 0xE4C02001 @ strb r2, [r0], #1
	.word 0xE2511001 @ subs r1, r1, #1
	.word 0x1AFFFFFC @ bne to the strb
	.word 0xE12FFF1E @ bx lr
arm_lookup:
	.word 0xE2000003 @ and r0, r0, #3
	.word 0xE59F1004 @ ldr r1, [pc, #4]
	.word 0xE7910100 @ ldr r0, [r1, r0, lsl #2]
	.word 0xE12FFF1E @ bx lr
	${ADDRESS('values')}
arm_io:
	.word 0xE59F1004 @ ldr r1, [pc, #4]
	.word 0xE5810000 @ str r0, [r1]
	.word 0xE12FFF1E @ bx lr
	.word 0x04000208 @ the register that turns interrupts on
arm_control:
	.word 0xEE110F10 @ mrc p15, 0, r0, c1, c0, 0
	.word 0xE12FFF1E @ bx lr
	.thumb_func
main:
	mov r0, #1
	mov r1, #2
	bl thumb_max
	bl thumb_twice
	ldr r0, .Lbuffer
	bl thumb_store
	bl thumb_path
	bl thumb_mirror
	bl thumb_bios
.Lforever:
	b .Lforever
	.align 2
.Lbuffer:
	${ADDRESS('buffer')}
	.thumb_func
thumb_max:
	cmp r0, r1
	bge .Lmax
	mov r0, r1
.Lmax:
	bx lr
	.thumb_func
thumb_add:
	add r0, r0, r1
	bx lr
	.thumb_func
thumb_twice:
	push {lr}
	mov r1, r0
	bl thumb_add
	pop {pc}
	.thumb_func
thumb_store:
	strh r1, [r0]
	str r1, [r0, #4]
	bx lr
	.thumb_func
thumb_path:
	mov r1, #0
	cmp r1, #1
	beq .Lrare
	add r0, #1
	bx lr
.Lrare:
	mov r0, #0
	bx lr
	.thumb_func
thumb_mirror:
	ldr r1, .Lmirrored
	ldr r0, [r1]
	bx lr
	.align 2
.Lmirrored: .word ${MIRRORED}
	.thumb_func
thumb_bios:
	swi 3
	bx lr
	.align 2
values:
	.word ${VALUES.join(', ')}
buffer:
	.space 16
`);

const ARM7_PROGRAM = written(`
	.text
	.code 16
start:
	.word 0xE59F000C @ ldr r0, [pc, #12]
	${CALL('seven_count')}
	.word 0xE59F0008 @ ldr r0, [pc, #8]
	.word 0xE12FFF10 @ bx r0
	.word 0
	${ADDRESS('counter')}
	${THUMB('main')}
seven_count:
	.word 0xE5901000 @ ldr r1, [r0]
	.word 0xE2811001 @ add r1, r1, #1
	.word 0xE5801000 @ str r1, [r0]
	.word 0xE1A00001 @ mov r0, r1
	.word 0xE12FFF1E @ bx lr
	.thumb_func
main:
	mov r0, #1
	mov r1, #2
	bl seven_mix
.Lforever:
	b .Lforever
	.thumb_func
seven_mix:
	eor r0, r1
	lsl r0, r0, #1
	bx lr
	.align 2
counter:
	.word 0
`);

// A program's bytes and where each of its names is. The assembler links nothing, so each call is filled in here:
// Thumb's bl, in two halves, and each word left for it, ARM's bl among them.
function programOf({ text, fills: left }, address) {
  const { sections, symbols, relocations } = assemble(text.replace(/@[^\n]*/g, ''));
  const code = Buffer.from(sections['.text'].bytes);
  const at = name => {
    if (!symbols.has(name)) throw new Error(`the made-up program names something it doesn't have: ${name}`);
    return symbols.get(name).at;
  };
  for (const { at: place, kind, name } of relocations) {
    if (kind !== 'call') throw new Error(`the made-up program names ${name} in a way this doesn't fill in`);
    const offset = at(name) - (place + 4);
    code.writeUInt16LE(0xF000 | ((offset >> 12) & 0x7FF), place);
    code.writeUInt16LE(0xF800 | ((offset >> 1) & 0x7FF), place + 2);
  }
  for (const { label, kind, name } of left) {
    const place = at(label);
    if (kind === 'call') code.writeUInt32LE((0xEB000000 | (((at(name) - (place + 8)) >> 2) & 0xFFFFFF)) >>> 0, place);
    else code.writeUInt32LE(address + at(name) + (kind === 'thumb' ? 1 : 0), place);
  }
  const labels = Object.fromEntries([...symbols].filter(([name]) => !name.startsWith('.L')).map(([name, symbol]) => [name, address + symbol.at]));
  return { bytes: Buffer.concat([code, Buffer.alloc(-code.length & 3)]), labels };
}

/**
 * The cartridge: { rom, sha1, labels, functions }, `labels` where each name of the two programs is in memory, the
 * ARM7's under `labels.arm7`, and `functions` each function the test checks, { name, address, mode, program }, `mode`
 * 'thumb' or undefined and `program` 'ARM7' or undefined, as a code map has them.
 */
export function madeUpNdsTwin({ title = 'MADE UP TWIN', code = 'MDTE' } = {}) {
  const rom = Buffer.alloc(0x10000), arm9 = programOf(ARM9_PROGRAM, ARM9.address), arm7 = programOf(ARM7_PROGRAM, ARM7.address);
  rom.write(title.slice(0, 12), 0, 'latin1');
  rom.write(code.slice(0, 4), 0xC, 'latin1');
  rom.write('00', 0x10, 'latin1');
  rom[0x14] = 0;                                   // 128 KB, the smallest a cartridge says
  [[0x20, ARM9, arm9.bytes], [0x30, ARM7, arm7.bytes]].forEach(([at, { offset, address }, program]) => {
    rom.writeUInt32LE(offset, at);
    rom.writeUInt32LE(address, at + 4);            // where it starts
    rom.writeUInt32LE(address, at + 8);            // where it's loaded
    rom.writeUInt32LE(program.length, at + 12);
    program.copy(rom, offset);
  });
  rom.writeUInt32LE(rom.length, 0x80);
  rom.writeUInt32LE(0x4000, 0x84);
  rom.writeUInt16LE(crc16(rom.subarray(0, 0x15E)), 0x15E);
  const thumb = name => name.startsWith('thumb_') || name === 'seven_mix' || name === 'main';
  const functions = [
    ...Object.entries(arm9.labels).filter(([name]) => /^(arm|thumb)_/.test(name)).map(([name, address]) => ({ name, address, ...(thumb(name) ? { mode: 'thumb' } : {}) })),
    ...Object.entries(arm7.labels).filter(([name]) => /^seven_/.test(name)).map(([name, address]) => ({ name, address, ...(thumb(name) ? { mode: 'thumb' } : {}), program: 'ARM7' })),
  ];
  return { rom, sha1: createHash('sha1').update(rom).digest('hex'), labels: { ...arm9.labels, arm7: arm7.labels }, functions };
}
