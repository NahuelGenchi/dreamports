// A small Nintendo DS program with nothing from any game in it, written here, for the tools' tests of the console: a
// cartridge the console could start, with a program for each of its two processors, as every game has.
//
// The ARM9's program turns both screens on and, once a frame, as the V-blank starts, colours the upper screen from a
// count of frames and the ten buttons it reads itself, and the lower one from what the ARM7 left it in the memory the
// two share: where the screen is touched, or X and Y when it isn't. The ARM7's program reads X, Y and the pen from its
// own register, the touch's place from the touch screen's chip over the serial bus, as only it can, and plays a square
// wave on the sound's ninth channel while A is held.
//
// The header has no logo, as the logo is Nintendo's: the console's own start-up would refuse the cartridge for that,
// and the tools' emulator starts a program directly, as a flash cartridge does.

import { createHash } from 'node:crypto';
import { assemble } from '../gba/thumb.mjs';

/** Where each program is in the cartridge and in memory, and the words the two share, in the console's main memory. */
export const ARM9 = { offset: 0x8000, address: 0x02000000 };
export const ARM7 = { offset: 0xC000, address: 0x02380000 };
export const SHARED = { keys: 0x02200000, x: 0x02200004, y: 0x02200008, frames: 0x0220000C };
/** The square wave: its timer's value, and so its pitch, with the console's clock. */
export const TIMER = 0xED68, CLOCK = 33513982;
export const PITCH = CLOCK / 2 / (0x10000 - TIMER) / 8;

const ARM9_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r0, .Lpowcnt
	ldr r1, .Lpowcnt_value
	strh r1, [r0]
	ldr r0, .Ldispcnt_a
	ldr r1, .Lscreen_on
	str r1, [r0]
	ldr r0, .Ldispcnt_b
	str r1, [r0]
	mov r7, #0
.Lframe:
	ldr r0, .Ldispstat
	mov r2, #1
.Lin_blank:
	ldrh r1, [r0]
	tst r1, r2
	bne .Lin_blank
.Lshowing:
	ldrh r1, [r0]
	tst r1, r2
	beq .Lshowing
	add r7, #1
	ldr r0, .Lkeyinput
	ldrh r1, [r0]
	mvn r1, r1
	lsl r1, r1, #22
	lsr r1, r1, #22
	lsl r1, r1, #5
	mov r2, #31
	mov r3, r7
	and r3, r2
	orr r1, r3
	ldr r0, .Lpalette_a
	strh r1, [r0]
	ldr r4, .Lshared
	ldr r1, [r4]
	mov r2, #64
	tst r1, r2
	bne .Lno_touch
	ldr r2, [r4, #4]
	lsr r2, r2, #7
	ldr r3, [r4, #8]
	lsr r3, r3, #7
	lsl r3, r3, #5
	orr r2, r3
	ldr r3, .Ltouched
	orr r2, r3
	b .Lshow_b
.Lno_touch:
	mvn r2, r1
	mov r3, #3
	and r2, r3
	lsl r2, r2, #10
.Lshow_b:
	ldr r0, .Lpalette_b
	strh r2, [r0]
	str r7, [r4, #12]
	b .Lframe
	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Ldispstat: .word 0x04000004
.Lkeyinput: .word 0x04000130
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lshared: .word ${SHARED.keys}
.Ltouched: .word 0x4000
`;

const ARM7_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r0, .Lpowcnt
	mov r1, #1
	strh r1, [r0]
	ldr r0, .Lsoundcnt
	ldr r1, .Lsoundcnt_value
	strh r1, [r0]
	ldr r0, .Lsoundbias
	ldr r1, .Lsoundbias_value
	strh r1, [r0]
	ldr r0, .Ltimer
	ldr r1, .Ltimer_value
	strh r1, [r0]
	ldr r4, .Lshared
.Lframe:
	ldr r0, .Ldispstat
	mov r2, #1
.Lin_blank:
	ldrh r1, [r0]
	tst r1, r2
	bne .Lin_blank
.Lshowing:
	ldrh r1, [r0]
	tst r1, r2
	beq .Lshowing
	ldr r0, .Lextkeyin
	ldrh r5, [r0]
	mov r2, #64
	tst r5, r2
	bne .Lno_touch
	mov r0, #0xD0
	bl touch
	str r0, [r4, #4]
	mov r0, #0x90
	bl touch
	str r0, [r4, #8]
.Lno_touch:
	str r5, [r4]
	ldr r0, .Lkeyinput
	ldrh r1, [r0]
	mov r2, #1
	ldr r0, .Lchannel
	tst r1, r2
	bne .Lquiet
	ldr r1, .Lchannel_on
	str r1, [r0]
	b .Lframe
.Lquiet:
	mov r1, #0
	str r1, [r0]
	b .Lframe
	.thumb_func
touch:
	push {lr}
	ldr r2, .Lspicnt
	ldr r1, .Lspi_hold
	strh r1, [r2]
	strh r0, [r2, #2]
	bl spiwait
	mov r1, #0
	strh r1, [r2, #2]
	bl spiwait
	ldrh r3, [r2, #2]
	ldr r1, .Lspi_last
	strh r1, [r2]
	mov r1, #0
	strh r1, [r2, #2]
	bl spiwait
	ldrh r1, [r2, #2]
	lsl r3, r3, #8
	orr r3, r1
	lsl r3, r3, #17
	lsr r0, r3, #20
	pop {pc}
	.thumb_func
spiwait:
	ldrh r1, [r2]
	mov r6, #128
	tst r1, r6
	bne spiwait
	bx lr
	.align 2
.Lpowcnt: .word 0x04000304
.Lsoundcnt: .word 0x04000500
.Lsoundcnt_value: .word 0x807F
.Lsoundbias: .word 0x04000504
.Lsoundbias_value: .word 0x200
.Ltimer: .word 0x04000488
.Ltimer_value: .word ${TIMER}
.Lshared: .word ${SHARED.keys}
.Ldispstat: .word 0x04000004
.Lextkeyin: .word 0x04000136
.Lkeyinput: .word 0x04000130
.Lchannel: .word 0x04000480
.Lchannel_on: .word 0xE340007F
.Lspicnt: .word 0x040001C0
.Lspi_hold: .word 0x8A01
.Lspi_last: .word 0x8201
`;

// a program as the console starts it, in ARM code, which goes straight to the program in Thumb: ldr r0, [pc]; bx r0
function programOf(text, address) {
  return programWithNames(text, address).bytes;
}

/** A program as programOf makes it, with where each of its names is in memory: { bytes, at: { name: address } }. */
export function programWithNames(text, address) {
  const { sections, symbols, relocations } = assemble(text);
  const code = Buffer.from(sections['.text'].bytes), start = Buffer.alloc(12);
  // the assembler links nothing, so each call to a function of the program is filled in here: Thumb's bl, in two halves
  for (const { at, kind, name } of relocations) {
    const target = symbols.get(name);
    if (kind !== 'call' || !target) throw new Error(`the made-up program names something it doesn't have: ${name}`);
    const offset = target.at - (at + 4);
    code.writeUInt16LE(0xF000 | ((offset >> 12) & 0x7FF), at);
    code.writeUInt16LE(0xF800 | ((offset >> 1) & 0x7FF), at + 2);
  }
  [0xE59F0000, 0xE12FFF10, address + 12 + 1].forEach((word, i) => start.writeUInt32LE(word >>> 0, 4 * i));
  const program = Buffer.concat([start, code]);
  const at = Object.fromEntries([...symbols].map(([name, { at: offset }]) => [name, address + 12 + offset]));
  return { bytes: Buffer.concat([program, Buffer.alloc(-program.length & 3)]), at };
}

/** The checksum a Nintendo DS header keeps of itself: CRC-16 as Modbus has it. */
export function crc16(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
  }
  return crc;
}

/** The cartridge's bytes, with the title and code in its header, and its SHA-1, as original.json would have it. */
export function madeUpNds({ title = 'MADE UP DS', code = 'MDUE' } = {}) {
  return cartridgeWith({ title, code, arm9: programOf(ARM9_PROGRAM, ARM9.address), arm7: programOf(ARM7_PROGRAM, ARM7.address) });
}

/** A cartridge with these two programs, each as programOf makes it, at the places ARM9 and ARM7 say, with its SHA-1. */
export function cartridgeWith({ title, code, arm9, arm7 }) {
  const rom = Buffer.alloc(0x10000);
  rom.write(title.slice(0, 12), 0, 'latin1');
  rom.write(code.slice(0, 4), 0xC, 'latin1');
  rom.write('00', 0x10, 'latin1');
  rom[0x14] = 0;                                   // 128 KB, the smallest a cartridge says
  [[0x20, ARM9, arm9], [0x30, ARM7, arm7]].forEach(([at, { offset, address }, program]) => {
    rom.writeUInt32LE(offset, at);
    rom.writeUInt32LE(address, at + 4);            // where it starts
    rom.writeUInt32LE(address, at + 8);            // where it's loaded
    rom.writeUInt32LE(program.length, at + 12);
    program.copy(rom, offset);
  });
  rom.writeUInt32LE(rom.length, 0x80);
  rom.writeUInt32LE(0x4000, 0x84);
  rom.writeUInt16LE(crc16(rom.subarray(0, 0x15E)), 0x15E);
  return { rom, sha1: createHash('sha1').update(rom).digest('hex') };
}
