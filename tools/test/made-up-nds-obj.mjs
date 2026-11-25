// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// sprites (nds-kit.mjs). What it sets up is one list of writes, made here, which the program copies into the hardware
// as it starts and the test's Dreamport writes the same (setupInC): the video memory's banks, the colours, a background,
// the sprites' tiles and the sprites. Then once a frame, as the V-blank starts, it moves some of them.
//
// Engine A, on the upper screen, has a checkered background at priority 1, its tiles mapped one way (1D), and four
// sprites: a 16 by 16 of 16 colours at priority 0 in the second bank of colours, moving right a dot a frame from 400, so
// it comes in from the left, the edge a sprite's place wraps round from; a 32 by 8 flipped across at priority 2, behind the background,
// moving down a dot a frame, so it leaves by the bottom and comes back from the top; an 8 by 8 of 256 colours flipped
// down, at the background's priority, so in front of it, gone while A is held; and a 16 by 16 under the first, which the
// first, being earlier in the list, is drawn over. Engine B, on the lower, has its tiles mapped the other way (2D): a 16
// by 16 of 16 colours moving right, flipped across while Right is held, and a 16 by 8 of 256 colours. The others of both
// engines' 128 are turned off. The ARM7's program waits.

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

const halves = bytes => Array.from({ length: bytes.length / 2 }, (_, i) => bytes[2 * i] | bytes[2 * i + 1] << 8);
// a tile of 16 colours, 32 bytes, from a colour for each of its 64 dots, two to a byte
const tile16 = colour => halves(Array.from({ length: 32 }, (_, i) => colour(i * 2 % 8, i * 2 >> 3) | colour(i * 2 % 8 + 1, i * 2 >> 3) << 4));
// a tile of 256 colours, 64 bytes
const tile256 = colour => halves(Array.from({ length: 64 }, (_, i) => colour(i % 8, i >> 3)));
const off = Array.from({ length: 4 }, (_, i) => (i === 0 ? 0x0200 : 0));

/** The writes the program makes as it starts, each { address, halves }, in order. */
export const SETUP = (() => {
  const writes = [];
  const write = (address, values) => writes.push({ address, halves: values });
  // banks A for engine A's backgrounds, B for its sprites, D for engine B's sprites: two bytes of the control registers
  // at a time, the halfword after A's being B's
  write(0x04000240, [0x8281]);
  write(0x04000242, [0x8400]);
  write(0x04000304, [0x8203]);
  // engine A's background: its colours, a tile of one colour and a map of every other tile
  write(0x05000000, [0x2108, 0x0210]);
  write(0x06004020, tile16(() => 1));
  write(0x06000000, Array.from({ length: 1024 }, (_, i) => ((i ^ i >> 5) & 1)));
  write(0x04000008, [0x0005]);
  // the sprites' colours: engine A's 16 of each of two banks and 64 for 256-colour tiles, and engine B's
  write(0x05000200, Array.from({ length: 64 }, (_, i) => (i * 0x0863 + 0x0421) & 0x7FFF));
  write(0x05000600, Array.from({ length: 64 }, (_, i) => (i * 0x1085 + 0x0C63) & 0x7FFF));
  // engine A's sprite tiles, one way: tiles 0 to 3 of 16 colours, each its own pattern with dots left out, and tiles 8
  // and on of 256 colours
  for (let n = 0; n < 4; n++) write(0x06400000 + n * 32, tile16((x, y) => ((x + y) % 5 === 0 ? 0 : (x + 2 * y + n) % 15 + 1)));
  write(0x06400000 + 8 * 32, tile256((x, y) => ((x * y) % 7 === 0 ? 0 : x + 8 * y + 1)));
  // engine B's, the other way: 32 tiles to a row, so a 16 by 16 is tiles 0, 1, 32 and 33, and one of 256 colours takes
  // two of a row's numbers
  for (const n of [0, 1, 32, 33]) write(0x06600000 + n * 32, tile16((x, y) => ((x ^ y) & 3 ? (x + y + n) % 15 + 1 : 0)));
  for (const n of [4, 6]) write(0x06600000 + n * 32, tile256((x, y) => (x === y ? 0 : 8 * x + y + n)));
  // the sprites: their three halfwords, then the fourth, which holds no sprite's
  const sprites = (base, list) => write(base, [...list.flatMap(s => [...s, 0]), ...Array.from({ length: 128 - list.length }, () => off).flat()]);
  sprites(0x07000000, [
    [40, 0x4000 | 400, 0x1000],                      // 16 by 16, priority 0, bank 1, tile 0, off the left edge
    [100 | 0x4000, 0x4000 | 0x1000 | 60, 0x0801],    // 32 by 8, flipped across, priority 2, tile 1
    [120 | 0x2000, 0x2000 | 90, 0x0400 | 8],         // 8 by 8 of 256 colours, flipped down, priority 1, tile 8
    [44, 0x4000 | 204, 0x0002],                      // 16 by 16 under the first, priority 0, tile 2
  ]);
  sprites(0x07000400, [
    [60, 0x4000 | 30, 0x0000],                       // 16 by 16, tiles 0, 1, 32 and 33
    [140 | 0x6000, 70, 0x0004],                      // 16 by 8 of 256 colours, tile 4
  ]);
  write(0x04000000, [0x1110, 0x0001]);
  write(0x04001000, [0x1000, 0x0001]);
  return writes;
})();

const ARM9_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r6, .Lsetup
.Lnext:
	ldr r0, [r6]
	cmp r0, #0
	beq .Lready
	ldr r2, [r6, #4]
	add r6, #8
.Lcopy:
	ldrh r1, [r6]
	strh r1, [r0]
	add r0, #2
	add r6, #2
	sub r2, #1
	bne .Lcopy
	add r6, #3
	lsr r6, r6, #2
	lsl r6, r6, #2
	b .Lnext
.Lready:
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
	ldrh r5, [r0]
	ldr r4, .Loam_a
	ldr r1, .Lstart_x
	add r1, r7
	ldr r2, .Lnine_bits
	and r1, r2
	ldr r3, .Lsize_16
	orr r1, r3
	strh r1, [r4, #2]
	mov r1, #100
	add r1, r7
	mov r2, #0xFF
	and r1, r2
	ldr r3, .Lshape_wide
	orr r1, r3
	strh r1, [r4, #8]
	ldr r1, .Lsprite2
	mov r2, #1
	tst r5, r2
	bne .Lshown
	ldr r3, .Loff
	orr r1, r3
.Lshown:
	strh r1, [r4, #16]
	ldr r4, .Loam_b
	mov r1, r7
	ldr r2, .Lnine_bits
	and r1, r2
	ldr r3, .Lsize_16
	orr r1, r3
	mov r2, #16
	tst r5, r2
	bne .Lunflipped
	ldr r3, .Lflip
	orr r1, r3
.Lunflipped:
	strh r1, [r4, #2]
	b .Lframe
	.align 2
.Lsetup: .word setup
.Ldispstat: .word 0x04000004
.Lkeyinput: .word 0x04000130
.Loam_a: .word 0x07000000
.Loam_b: .word 0x07000400
.Lnine_bits: .word 0x1FF
.Lstart_x: .word 400
.Lsize_16: .word 0x4000
.Lshape_wide: .word 0x4000
.Lsprite2: .word ${120 | 0x2000}
.Loff: .word 0x0200
.Lflip: .word 0x1000
	.align 2
setup:
${SETUP.map(({ address, halves: values }) => `	.word ${address}, ${values.length}\n${chunks(values).map(line => `	.hword ${line.join(', ')}`).join('\n')}\n	.align 2`).join('\n')}
	.word 0
`;

function chunks(values) {
  const lines = [];
  for (let i = 0; i < values.length; i += 16) lines.push(values.slice(i, i + 16));
  return lines;
}

const ARM7_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	mov r0, r0
.Lforever:
	b .Lforever
`;

/** The cartridge's bytes and SHA-1. */
export function madeUpNdsSprites({ title = 'MADE UP OBJS', code = 'MDOE' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}

/** The same writes as C, for the test's Dreamport: a table of each write's address, how many halfwords, and them. */
export function setupInC() {
  const words = SETUP.flatMap(({ address, halves: values }) => [address, values.length, ...values]);
  return `static const uint32_t SETUP[] = {\n${chunks(words.map(n => `0x${n.toString(16)}`)).map(line => `  ${line.join(', ')},`).join('\n')}\n  0,\n};`;
}
