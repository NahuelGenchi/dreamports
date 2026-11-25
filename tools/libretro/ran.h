// What ran of the original, on a console whose emulator tells the tools of every instruction: the NES, in FCEUmm with
// the tools' change to it (fceumm.patch), the Super Nintendo, in Snes9x with theirs (snes9x.patch), and the Game Boy
// and the Game Boy Color, in Gambatte with theirs (gambatte.patch), where a place is in the program as on the NES
// (../gbc/functions.mjs), a call is a CALL or an RST, a jump through a pointer a JP (HL), a return a RET or a RETI, and
// a branch any JR, JP, CALL or RET with a condition. The program
// that drives the emulators includes this (host.c), and writes what the Game Boy Advance's writes (../gba/original.c,
// ../gba/ran.h), for the same tools.
//
// A place is where an instruction is in the cartridge's program, as an offset from its first byte, whatever bank is
// switched in at its address: what a code map calls an address on the NES (../nes/functions.mjs), and on the Super
// Nintendo, where it's in the ROM, whichever bank shows it (../snes/functions.mjs). The Super Nintendo's 65816 runs
// each instruction in a mode, A and X of 8 bits or 16 or the 6502's mode, which says how long it is: three bits, X of
// 8 bits, A of 8 bits and the 6502's mode, from the lowest, which a record below says as its processor, and the same
// place run in two modes has a record for each.
//
// FUNCTIONS, a file, lists where the code map's functions are: each its place, its size, its number in the code map,
// and three words more that a Game Boy Advance's work RAM needs and nothing here reads (32 bits each, 6 in all). A
// function runs when the processor reaches its place, and ranInFrame gives those that ran in the frame just played.
//
// The environment's DP_PLAYED, when it's set, names a file to write what ran to, for gameplay proven (lib/played.mjs):
// every instruction of the program that ran, and for a conditional branch each of its two ways, taken and not, each
// with the stretches of frames it happened in. A record is five 32-bit words: the instruction's place, its first byte,
// what happened (0 it ran, 1 its branch was taken, 2 it wasn't), and the first and the last frame of a stretch of
// frames that each had it. The way a branch goes is read from the flags it tests, before it runs. On the Super Nintendo
// the third word has the mode's three bits above the lowest byte.
//
// DP_ENTRIES, when it's set, names a file for where the processor was sent in ways only play shows, for the code map
// (codemap.mjs): a record of three 32-bit words the first time each happens at a place, the place, how it got there
// (1 called, by a JSR; 2 jumped to through a pointer, by a JMP ($xxxx); 3 returned to, by an RTS), and the frame. An
// interrupt between the two instructions isn't one of them: it leaves three more bytes on the stack. On the Super
// Nintendo a call is also a JSL or a JSR ($xxxx,X), a jump a JMP ($xxxx,X) or a JML [$xxxx], and a return an RTL, and
// the second word has the mode the processor was in there above its lowest byte: a record for each way and mode.
//
// DP_REGISTERS, when it's set, names a file for what the processor held as each function of FUNCTIONS started, which
// the function check can try a twin with: three 32-bit words each, the function's number in the code map, A, X, Y and
// the stack pointer, a byte each from the lowest, and the flags in the lowest byte with the frame above them. Up to
// REGISTERS_EACH for a function, each different from the others. They stay on the contributor's computer. The Super
// Nintendo's aren't written yet.
//
// The program that includes this has `err`, where it says what went wrong.

#ifndef DP_LIBRETRO_RAN_H
#define DP_LIBRETRO_RAN_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { RAN, TAKEN, NOT_TAKEN, HAPPENINGS };
enum { CALLED = 1, JUMPED = 2, RETURNED = 3 };
#define RAN_NOWHERE 0xFFFFFFFF
#define REGISTERS_EACH 16
#define JSR 0x20
#define RTS 0x60
#define JMP_POINTER 0x6C

// `other` is the next record of the same place in another mode, plus one, or 0
struct ranPlayed { uint32_t place, code, processor, other, start[HAPPENINGS]; long last[HAPPENINGS]; };
// `word`, with `hasWord`, is the first word a function only counts with (ran-ps2.h)
struct ranFunction { uint32_t index; int inFrame, held, hasWord; uint32_t word; uint32_t (*registers)[2]; };

static struct {
	long frame;
	// for each byte of the program: its instruction in `played`, plus one, the function of `functions` that starts
	// there, plus one, and whether a function holds it (1) and how the processor has been sent there (2 << the way)
	uint32_t* played;
	uint32_t* starts;
	uint8_t* marks;
	uint8_t* modes;      // on the Super Nintendo, the modes a place has been sent to in, a bit each
	size_t size;
	struct ranPlayed* list;
	size_t count, room;
	struct ranFunction* functions;
	size_t functionCount;
	uint32_t* inFrame;   // the numbers in the code map of those that ran in this frame, and which of `functions` they are
	struct ranFunction** inFrameOf;
	size_t inFrameCount;
	uint32_t outside, elsewhere;   // instructions that ran in the program outside every function, and outside the program
	FILE* playedFile;
	FILE* entriesFile;
	FILE* registersFile;
	int beforeOp, beforeS;   // the instruction before this one, and the stack pointer it started with, or -1
} ran = { .beforeOp = -1 };

static void ranCant(const char* path) {
	fprintf(err, "Can't write %s\n", path);
	exit(2);
}

// room for every byte of the program up to `place`
static void ranReach(uint32_t place) {
	if (place < ran.size) return;
	size_t size = ((size_t) place / 0x10000 + 1) * 0x10000;
	ran.played = realloc(ran.played, size * sizeof(uint32_t));
	ran.starts = realloc(ran.starts, size * sizeof(uint32_t));
	ran.marks = realloc(ran.marks, size);
	ran.modes = realloc(ran.modes, size);
	memset(ran.played + ran.size, 0, (size - ran.size) * sizeof(uint32_t));
	memset(ran.starts + ran.size, 0, (size - ran.size) * sizeof(uint32_t));
	memset(ran.marks + ran.size, 0, size - ran.size);
	memset(ran.modes + ran.size, 0, size - ran.size);
	ran.size = size;
}

/** Starts it: `functions` is FUNCTIONS as read, `words` how many 32-bit words it has, and `byPlace` whether its
 *  functions go to their places here, as the NES's do, rather than in ran-ps2.h. Whether anything was asked for. */
static int ranOpen(const uint32_t* functions, size_t words, int byPlace) {
	ran.functionCount = words / 6;
	ran.functions = calloc(ran.functionCount ? ran.functionCount : 1, sizeof(struct ranFunction));
	ran.inFrame = malloc((ran.functionCount ? ran.functionCount : 1) * sizeof(uint32_t));
	ran.inFrameOf = malloc((ran.functionCount ? ran.functionCount : 1) * sizeof(struct ranFunction*));
	for (size_t i = 0; i < ran.functionCount; i++) {
		uint32_t place = functions[i * 6], size = functions[i * 6 + 1];
		// a Nintendo 64 function's address is where its processor sees the console's memory, at 0x80000000 or at
		// 0xA0000000, and its place is where that is in the memory, as its emulator says an instruction's
		if (place >= 0x80000000 && place < 0xC0000000) place &= 0x1FFFFFFF;
		ran.functions[i].index = functions[i * 6 + 2];
		if (!byPlace || !size || place + size < place) continue;
		ranReach(place + size - 1);
		ran.starts[place] = (uint32_t) i + 1;
		memset(ran.marks + place, 1, size);
	}
	const char* played = getenv("DP_PLAYED");
	const char* entries = getenv("DP_ENTRIES");
	const char* registers = getenv("DP_REGISTERS");
	if (played && !(ran.playedFile = fopen(played, "wb"))) ranCant(played);
	if (entries && !(ran.entriesFile = fopen(entries, "wb"))) ranCant(entries);
	if (registers && !(ran.registersFile = fopen(registers, "wb"))) ranCant(registers);
	// what only a Game Boy Advance's program writes, empty, for the tools that read both (lib/run-reference.mjs)
	for (const char** also = (const char*[]) { "DP_PLAYED_CODE", "DP_CONTENT", NULL }; *also; also++) {
		if (!played || !getenv(*also)) continue;
		FILE* empty = fopen(getenv(*also), "wb");
		if (!empty) ranCant(getenv(*also));
		fclose(empty);
	}
	return ran.functionCount || ran.playedFile || ran.entriesFile;
}

static void ranStretch(const struct ranPlayed* p, int what) {
	uint32_t record[5] = { p->place, p->code, (uint32_t) what | p->processor << 8, p->start[what], (uint32_t) p->last[what] };
	fwrite(record, 4, 5, ran.playedFile);
}

// a stretch begins when nothing came before it, which is -1, and so is the frame before frame 0: so a first one at frame
// 0 begins too, and its first frame isn't left as the memory happened to hold it
static void ranHappened(struct ranPlayed* p, int what) {
	if (p->last[what] == ran.frame) return;
	if (p->last[what] < 0 || p->last[what] != ran.frame - 1) {
		if (p->last[what] >= 0) ranStretch(p, what);
		p->start[what] = (uint32_t) ran.frame;
	}
	p->last[what] = ran.frame;
}

// a function started: it ran in this frame
static void ranInThisFrame(struct ranFunction* f) {
	if (f->inFrame) return;
	f->inFrame = 1;
	ran.inFrameOf[ran.inFrameCount] = f;
	ran.inFrame[ran.inFrameCount++] = f->index;
}

// a function started: it ran in this frame, with these registers
static void ranStarted(struct ranFunction* f, uint32_t axys, uint32_t p) {
	ranInThisFrame(f);
	if (!ran.registersFile || f->held == REGISTERS_EACH) return;
	for (int i = 0; i < f->held; i++) if (f->registers[i][0] == axys && (f->registers[i][1] & 0xFF) == p) return;
	if (!f->registers) f->registers = malloc(sizeof(uint32_t[2]) * REGISTERS_EACH);
	f->registers[f->held][0] = axys;
	f->registers[f->held][1] = p | (uint32_t) ran.frame << 8;
	f->held++;
}

/** A place the PlayStation's processor is at, for a core that tells only where it's about to run, as PCSX ReARMed does
 *  with the tools' change to it (pcsx.patch, dreamports_watch_pc): its address in the console's 2 MB, which the
 *  console sees again at 0x80000000 and 0xA0000000, or RAN_NOWHERE outside it, as in the BIOS. */
static uint32_t ranPlaystationPlace(uint32_t address) {
	return (address & 0x1FFFFFFF) < 0x200000 ? address & 0x1FFFFF : RAN_NOWHERE;
}

/** What such a core calls as the processor is about to run the instruction at `pc`: a function of FUNCTIONS whose
 *  first instruction it is ran in this frame. Nothing more is told of it, so nothing is written for DP_PLAYED. */
static void ranReachedPc(uint32_t pc) {
	uint32_t place = ranPlaystationPlace(pc);
	if (place >= ran.size || !ran.starts[place]) return;
	ranInThisFrame(&ran.functions[ran.starts[place] - 1]);
}

/** What the emulator calls between reading an instruction and running it: its address, its place in the program or
 *  RAN_NOWHERE, its first byte, A, X, Y and the stack pointer, a byte each from the lowest, and the flags. */
static void ranInstruction(uint32_t pc, uint32_t place, uint32_t op, uint32_t axys, uint32_t p) {
	(void) pc;
	int s = axys >> 24, way = 0;
	if (ran.beforeOp == JSR && s == ((ran.beforeS - 2) & 0xFF)) way = CALLED;
	else if (ran.beforeOp == JMP_POINTER && s == ran.beforeS) way = JUMPED;
	else if (ran.beforeOp == RTS && s == ((ran.beforeS + 2) & 0xFF)) way = RETURNED;
	ran.beforeOp = (int) op;
	ran.beforeS = s;
	if (place == RAN_NOWHERE) {
		ran.elsewhere++;
		return;
	}
	ranReach(place);
	if (way && ran.entriesFile && !(ran.marks[place] & 2 << way)) {
		ran.marks[place] |= 2 << way;
		uint32_t record[3] = { place, (uint32_t) way, (uint32_t) ran.frame };
		fwrite(record, 4, 3, ran.entriesFile);
	}
	if (ran.starts[place]) ranStarted(&ran.functions[ran.starts[place] - 1], axys, p);
	if (!(ran.marks[place] & 1)) ran.outside++;
	if (!ran.playedFile) return;
	if (!ran.played[place]) {
		if (ran.count == ran.room) {
			ran.room = ran.room ? ran.room * 2 : 1 << 14;
			ran.list = realloc(ran.list, ran.room * sizeof(struct ranPlayed));
		}
		struct ranPlayed* new = &ran.list[ran.count++];
		new->place = place;
		new->code = op;
		new->processor = 0;
		new->other = 0;
		for (int what = 0; what < HAPPENINGS; what++) new->last[what] = -1;
		ran.played[place] = (uint32_t) ran.count;
	}
	struct ranPlayed* now = &ran.list[ran.played[place] - 1];
	ranHappened(now, RAN);
	// the eight conditional branches: bits 6 and 7 say which flag, negative, overflow, carry or zero, and bit 5 what
	// it has to be for the branch to be taken
	if ((op & 0x1F) == 0x10) {
		static const uint32_t FLAG[4] = { 0x80, 0x40, 0x01, 0x02 };
		ranHappened(now, !(p & FLAG[op >> 6]) == !(op & 0x20) ? TAKEN : NOT_TAKEN);
	}
}

// the Super Nintendo's 65816 (snes9x.patch): where a call, a jump through a pointer and a return send it, as the change
// in the stack pointer after it says, 2 bytes or 3, in page 1 only in the 6502's mode
enum { JSR65816 = 0x20, JSL = 0x22, JSR_TABLE = 0xFC, JMP_POINTER65816 = 0x6C, JMP_TABLE = 0x7C, JML_POINTER = 0xDC, RTS65816 = 0x60, RTL = 0x6B };

/** What Snes9x calls between reading an instruction and running it: its address, its place in the ROM or RAN_NOWHERE,
 *  its first byte, and the registers A, X, Y, S, D, DB, P and E. */
static void ranInstruction65816(uint32_t pc, uint32_t place, uint32_t op, const uint32_t* r) {
	(void) pc;
	uint32_t p = r[6], e = r[7] & 1, s = r[3], mask = e ? 0xFF : 0xFFFF;
	uint32_t mode = (p & 0x10 ? 1 : 0) | (p & 0x20 ? 2 : 0) | e << 2;
	int way = 0;
	uint32_t moved = (s - (uint32_t) ran.beforeS) & mask;
	if ((ran.beforeOp == JSR65816 || ran.beforeOp == JSR_TABLE) && moved == (-2u & mask)) way = CALLED;
	else if (ran.beforeOp == JSL && moved == (-3u & mask)) way = CALLED;
	else if ((ran.beforeOp == JMP_POINTER65816 || ran.beforeOp == JMP_TABLE || ran.beforeOp == JML_POINTER) && moved == 0) way = JUMPED;
	else if (ran.beforeOp == RTS65816 && moved == 2) way = RETURNED;
	else if (ran.beforeOp == RTL && moved == 3) way = RETURNED;
	ran.beforeOp = (int) op;
	ran.beforeS = (int) s;
	if (place == RAN_NOWHERE) {
		ran.elsewhere++;
		return;
	}
	ranReach(place);
	if (way && ran.entriesFile && (!(ran.marks[place] & 2 << way) || !(ran.modes[place] & 1 << mode))) {
		ran.marks[place] |= 2 << way;
		ran.modes[place] |= 1 << mode;
		uint32_t record[3] = { place, (uint32_t) way | mode << 8, (uint32_t) ran.frame };
		fwrite(record, 4, 3, ran.entriesFile);
	}
	if (ran.starts[place]) ranInThisFrame(&ran.functions[ran.starts[place] - 1]);
	if (!(ran.marks[place] & 1)) ran.outside++;
	if (!ran.playedFile) return;
	// the record of this place in this mode, or a new one, after any of it in other modes
	uint32_t* link = &ran.played[place];
	while (*link && ran.list[*link - 1].processor != mode) link = &ran.list[*link - 1].other;
	if (!*link) {
		if (ran.count == ran.room) {
			ran.room = ran.room ? ran.room * 2 : 1 << 14;
			ran.list = realloc(ran.list, ran.room * sizeof(struct ranPlayed));
			link = &ran.played[place];
			while (*link && ran.list[*link - 1].processor != mode) link = &ran.list[*link - 1].other;
		}
		struct ranPlayed* new = &ran.list[ran.count++];
		new->place = place;
		new->code = op;
		new->processor = mode;
		new->other = 0;
		for (int what = 0; what < HAPPENINGS; what++) new->last[what] = -1;
		*link = (uint32_t) ran.count;
	}
	struct ranPlayed* now = &ran.list[*link - 1];
	ranHappened(now, RAN);
	// the eight conditional branches, as the 6502's: bits 6 and 7 say which flag, and bit 5 what it has to be
	if ((op & 0x1F) == 0x10) {
		static const uint32_t FLAG[4] = { 0x80, 0x40, 0x01, 0x02 };
		ranHappened(now, !(p & FLAG[op >> 6]) == !(op & 0x20) ? TAKEN : NOT_TAKEN);
	}
}

// the Game Boy's processor (gambatte.patch): where a CALL or an RST, a JP (HL) and a RET or a RETI send it, as the change
// in the stack pointer after it says, and which way a JR, JP, CALL or RET with a condition goes
static int ranSm83Calls(int op) { return op == 0xCD || (op & 0xE7) == 0xC4 || (op & 0xC7) == 0xC7; }
static int ranSm83Returns(int op) { return op == 0xC9 || op == 0xD9 || (op & 0xE7) == 0xC0; }
static int ranSm83TwoWays(int op) { return (op & 0xE7) == 0x20 || (op & 0xE7) == 0xC2 || (op & 0xE7) == 0xC4 || (op & 0xE7) == 0xC0; }

/** What Gambatte calls between reading an instruction and running it: its address, its place in the cartridge's
 *  program or RAN_NOWHERE, its first byte, and the flags, A and the stack pointer, from the lowest byte. */
static void ranInstructionSm83(uint32_t pc, uint32_t place, uint32_t op, uint32_t fasp) {
	(void) pc;
	int sp = (int) (fasp >> 16), way = 0;
	uint32_t f = fasp & 0xFF;
	if (ranSm83Calls(ran.beforeOp) && sp == ((ran.beforeS - 2) & 0xFFFF)) way = CALLED;
	else if (ran.beforeOp == 0xE9 && sp == ran.beforeS) way = JUMPED;
	else if (ranSm83Returns(ran.beforeOp) && sp == ((ran.beforeS + 2) & 0xFFFF)) way = RETURNED;
	ran.beforeOp = (int) op;
	ran.beforeS = sp;
	if (place == RAN_NOWHERE) {
		ran.elsewhere++;
		return;
	}
	ranReach(place);
	if (way && ran.entriesFile && !(ran.marks[place] & 2 << way)) {
		ran.marks[place] |= 2 << way;
		uint32_t record[3] = { place, (uint32_t) way, (uint32_t) ran.frame };
		fwrite(record, 4, 3, ran.entriesFile);
	}
	if (ran.starts[place]) ranInThisFrame(&ran.functions[ran.starts[place] - 1]);
	if (!(ran.marks[place] & 1)) ran.outside++;
	if (!ran.playedFile) return;
	if (!ran.played[place]) {
		if (ran.count == ran.room) {
			ran.room = ran.room ? ran.room * 2 : 1 << 14;
			ran.list = realloc(ran.list, ran.room * sizeof(struct ranPlayed));
		}
		struct ranPlayed* new = &ran.list[ran.count++];
		new->place = place;
		new->code = op;
		new->processor = 0;
		new->other = 0;
		for (int what = 0; what < HAPPENINGS; what++) new->last[what] = -1;
		ran.played[place] = (uint32_t) ran.count;
	}
	struct ranPlayed* now = &ran.list[ran.played[place] - 1];
	ranHappened(now, RAN);
	// a condition's two bits say NZ, Z, NC or C: the zero flag is bit 7 of F and the carry bit 4
	if (ranSm83TwoWays((int) op)) {
		int when = (int) (op >> 3) & 3, set = (int) (f & (when < 2 ? 0x80 : 0x10)) != 0;
		ranHappened(now, set == (when & 1) ? TAKEN : NOT_TAKEN);
	}
}

/** What Parallel N64 calls before each instruction its cached interpreter runs (parallel-n64.patch): its address, and
 *  its place in the console's memory, or RAN_NOWHERE. It says where the processor is and nothing of the instruction,
 *  so which functions ran in each frame is all that's kept of it: nothing is written for DP_PLAYED, DP_ENTRIES or
 *  DP_REGISTERS, which the tools don't ask of this console (reference.mjs). */
static void ranAt(uint32_t pc, uint32_t place) {
	(void) pc;
	if (place == RAN_NOWHERE) {
		ran.elsewhere++;
		return;
	}
	ranReach(place);
	if (ran.starts[place]) ranInThisFrame(&ran.functions[ran.starts[place] - 1]);
	if (!(ran.marks[place] & 1)) ran.outside++;
}

/** The functions that ran in the frame just played, by their numbers in the code map, and how many: begun again for the next. */
static const uint32_t* ranInFrame(uint32_t* count) {
	*count = (uint32_t) ran.inFrameCount;
	for (size_t i = 0; i < ran.inFrameCount; i++) ran.inFrameOf[i]->inFrame = 0;
	ran.inFrameCount = 0;
	return ran.inFrame;
}

static void ranClose(void) {
	if (ran.playedFile) {
		for (size_t i = 0; i < ran.count; i++) {
			for (int what = 0; what < HAPPENINGS; what++) if (ran.list[i].last[what] >= 0) ranStretch(&ran.list[i], what);
		}
		fclose(ran.playedFile);
	}
	if (ran.entriesFile) fclose(ran.entriesFile);
	if (ran.registersFile) {
		for (size_t i = 0; i < ran.functionCount; i++) {
			for (int held = 0; held < ran.functions[i].held; held++) {
				uint32_t record[3] = { ran.functions[i].index, ran.functions[i].registers[held][0], ran.functions[i].registers[held][1] };
				fwrite(record, 4, 3, ran.registersFile);
			}
		}
		fclose(ran.registersFile);
	}
}

#endif
