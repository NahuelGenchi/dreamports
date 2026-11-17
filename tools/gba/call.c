// Calls single functions of the original in the reference emulator, on the contributor's computer only, for the
// function check, `npm run dp -- twin` (twin.mjs): each call starts from the memory the one before left, with the
// values the check changed, and what comes back is what the call changed, so the twin's call can be compared with it
// byte for byte. `npm run dp -- setup` builds this against mGBA's library (build.mjs).
//
// call ROM
//   ROM  the contributor's copy, only ever read
//
// It's told what to do on stdin and answers on stdout, in 32-bit numbers, low byte first. The memory it speaks of is
// the console's five memories one after another, the image: the 256 KB of work memory at 0x02000000, the 32 KB at
// 0x03000000, the palette at 0x05000000, the 96 KB of video memory at 0x06000000 and the sprites' list at 0x07000000.
//
//   'f' frames          plays that many frames from where the game is. Answers 0.
//   'i'                 answers where the stack of a call starts and how long the cartridge is.
//   'm'                 answers the image.
//   's' image           puts the image in the console's memory. Answers 0.
//   'u'                 takes the last call back, with what was changed for it. Answers 0.
//   'c' address r0 r1 r2 r3 limit onStack [words] changes [address bytes value]
//                       changes those values, then calls the function at the address, odd for Thumb code, with its
//                       first four arguments in the registers and the rest on the stack, and lets it run up to `limit`
//                       instructions. Answers:
//                         how it ended: 0 it came back, 1 it didn't within the limit, 2 it left what a twin can follow
//                         what it gave back, in r0, and how many instructions it ran
//                         the first address of the hardware's registers it used, or 0
//                         the address it left for, when it ended with 2
//                         how many values it read, how many numbers it loaded from the cartridge, how many times it
//                         compared two values, how many stretches of the image it changed
//                         each value read, its address and bytes; each number; the two values of each comparison;
//                         each stretch, where in the image, how long, and its bytes
//                       A call that didn't come back is taken back at once, and changes nothing.
//   't' top             the stack the calls after it start on: an address, or 0 for the game's own. Answers 0.
//   'w' count [address] the functions to see start in play, each by its address. Answers 0.
//   'p' frames [buttons] sets [frame address bytes value]
//                       starts the console again and plays that many frames from power-on, as the proof tools play a
//                       recording (original.c): the buttons held at each frame, a bit a button as KEYINPUT has them,
//                       and values written to the work memory as a frame starts, in the order of their frames. Each
//                       time the processor reaches a function of 'w', it counts, and at its 1st, 3rd, 9th time and so
//                       on, by threes, it answers a memory of play: which function, the frame, how many times it
//                       had started, what r0 to r3 and the stack held, and the image as it was just then. After the
//                       last frame it answers 0xFFFFFFFF and how many frames it played. The save memory is as the
//                       plays before left it, so the check plays each recording in a program of its own.
//
// A memory of play is what a function was really given: the image it started from, its arguments in the registers
// and, in the image, on the stack, which is why 't' lets a call start on the stack the game had then. They are the
// game's own memory, from the contributor's copy, and the check keeps them on this computer only (twin-memories.mjs).
//
// What a twin can follow is the image, the cartridge read and the hardware's registers. A call that reads or writes
// anywhere else, such as the BIOS, the save memory, a copy of the work memory at another address or nothing at all, that
// reads or writes a halfword or a word at an address none starts at, which the console moves and C doesn't, or
// that runs code from outside the cartridge and the work memory, or whose stack goes 8 KB deep, ends with 2. The stack
// a call uses isn't the twin's, so what the call leaves there is put back as it was and isn't among the stretches.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <mgba/internal/gba/gba.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "on-windows.h"

#define EWRAM_AT 0
#define EWRAM_BYTES 0x40000
#define IWRAM_AT 0x40000
#define IWRAM_BYTES 0x8000
#define PALETTE_AT 0x48000
#define PALETTE_BYTES 0x400
#define VRAM_AT 0x48400
#define VRAM_BYTES 0x18000
#define OAM_AT 0x60400
#define OAM_BYTES 0x400
#define IMAGE 0x60800
#define IO_BYTES 0x400
#define CARTRIDGE 0x08000000u
// where a call comes back to: no code is there, and the call ends as it gets there
#define RETURN_TO 0x09FFFFF0u
#define NOTED 4096
// how far down a call's stack may go, more than any game's has room for
#define STACK_ROOM 0x2000

enum { CAME_BACK = 0, DID_NOT = 1, LEFT = 2 };

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

static struct mCore* core;
static struct ARMCore* cpu;
static struct GBA* gba;
static uint32_t romSize;
static struct ARMMemory memory;   // the emulator's own reads and writes
static uint8_t undo[IMAGE], before[IMAGE], after[IMAGE];

// what a call did
static int watching;
static uint32_t hardware, leftFor, stackLow, stackHigh;
static int left;
static uint8_t wasRead[IMAGE];
static uint32_t reads[NOTED][2], numbers[NOTED], pairs[NOTED][2];
static size_t readCount, numberCount, pairCount;

// where an address is in the image, or -1
static long inImage(uint32_t address) {
	if (address >= 0x02000000u && address < 0x02000000u + EWRAM_BYTES) return EWRAM_AT + (address - 0x02000000u);
	if (address >= 0x03000000u && address < 0x03000000u + IWRAM_BYTES) return IWRAM_AT + (address - 0x03000000u);
	if (address >= 0x05000000u && address < 0x05000000u + PALETTE_BYTES) return PALETTE_AT + (address - 0x05000000u);
	if (address >= 0x06000000u && address < 0x06000000u + VRAM_BYTES) return VRAM_AT + (address - 0x06000000u);
	if (address >= 0x07000000u && address < 0x07000000u + OAM_BYTES) return OAM_AT + (address - 0x07000000u);
	return -1;
}

static void takeImage(uint8_t* image) {
	memcpy(image + EWRAM_AT, gba->memory.wram, EWRAM_BYTES);
	memcpy(image + IWRAM_AT, gba->memory.iwram, IWRAM_BYTES);
	memcpy(image + PALETTE_AT, gba->video.palette, PALETTE_BYTES);
	memcpy(image + VRAM_AT, gba->video.vram, VRAM_BYTES);
	memcpy(image + OAM_AT, gba->video.oam.raw, OAM_BYTES);
}

static void giveImage(const uint8_t* image) {
	memcpy(gba->memory.wram, image + EWRAM_AT, EWRAM_BYTES);
	memcpy(gba->memory.iwram, image + IWRAM_AT, IWRAM_BYTES);
	memcpy(gba->video.palette, image + PALETTE_AT, PALETTE_BYTES);
	memcpy(gba->video.vram, image + VRAM_AT, VRAM_BYTES);
	memcpy(gba->video.oam.raw, image + OAM_AT, OAM_BYTES);
}

static void number(uint32_t value) {
	if (numberCount < NOTED) numbers[numberCount++] = value;
}

// two values the function compared
static void pair(uint32_t one, uint32_t other) {
	if (pairCount < NOTED) {
		pairs[pairCount][0] = one;
		pairs[pairCount++][1] = other;
	}
}

// every read and write the processor, the BIOS and DMA make comes through here
static void touched(uint32_t address, int bytes, int write) {
	if (!watching) return;
	long at = inImage(address);
	if (at >= 0 && inImage(address + bytes - 1) >= 0) {
		// a value the function read from memory, and not from its own stack, is one the check can change
		if (!write && !(address >= stackLow && address < stackHigh) && !wasRead[at] && readCount < NOTED) {
			wasRead[at] = 1;
			reads[readCount][0] = address;
			reads[readCount++][1] = (uint32_t) bytes;
		}
		return;
	}
	if (address >= 0x04000000u && address < 0x04000000u + IO_BYTES) {
		if (!hardware) hardware = address;
		return;
	}
	if (!write && address >= CARTRIDGE && address - CARTRIDGE + bytes <= romSize) return;
	if (!left) {
		left = 1;
		leftFor = address;
	}
}

// The console reads and writes a halfword or a word only where one starts, whatever the address says, and turns what
// it read round to make up for it. C has no such thing, so a call that does it is one a twin can't follow.
static void aligned(uint32_t address, uint32_t bytes) {
	if (watching && (address & (bytes - 1)) && !left) {
		left = 1;
		leftFor = address;
	}
}

static uint32_t load32(struct ARMCore* c, uint32_t address, int* cycles) {
	aligned(address, 4);
	touched(address & ~3u, 4, 0);
	uint32_t value = memory.load32(c, address, cycles);
	// a number the code keeps beside itself
	if (watching && address >= CARTRIDGE) number(value);
	return value;
}
static uint32_t load16(struct ARMCore* c, uint32_t address, int* cycles) { aligned(address, 2); touched(address & ~1u, 2, 0); return memory.load16(c, address, cycles); }
static uint32_t load8(struct ARMCore* c, uint32_t address, int* cycles) { touched(address, 1, 0); return memory.load8(c, address, cycles); }
static void store32(struct ARMCore* c, uint32_t address, int32_t value, int* cycles) { aligned(address, 4); touched(address & ~3u, 4, 1); memory.store32(c, address, value, cycles); }
static void store16(struct ARMCore* c, uint32_t address, int16_t value, int* cycles) { aligned(address, 2); touched(address & ~1u, 2, 1); memory.store16(c, address, value, cycles); }
static void store8(struct ARMCore* c, uint32_t address, int8_t value, int* cycles) { touched(address, 1, 1); memory.store8(c, address, value, cycles); }

// the words a push, a pop or a block move reaches
static void touchedMany(uint32_t base, int mask, enum LSMDirection direction, int write) {
	int words = 0;
	for (int i = 0; i < 16; i++) words += mask >> i & 1;
	if (!words) words = 16;
	base &= ~3u;
	uint32_t first = base;
	if (direction == LSM_IB) first = base + 4;
	else if (direction == LSM_DA) first = base - 4 * words + 4;
	else if (direction == LSM_DB) first = base - 4 * words;
	// a push lowers the stack before what it wrote is counted
	if (write && first < stackLow && first >= stackLow - 0x400) stackLow = first;
	for (int i = 0; i < words; i++) touched(first + 4 * i, 4, write);
}
static uint32_t loadMultiple(struct ARMCore* c, uint32_t base, int mask, enum LSMDirection direction, int* cycles) {
	touchedMany(base, mask, direction, 0);
	return memory.loadMultiple(c, base, mask, direction, cycles);
}
static uint32_t storeMultiple(struct ARMCore* c, uint32_t base, int mask, enum LSMDirection direction, int* cycles) {
	touchedMany(base, mask, direction, 1);
	return memory.storeMultiple(c, base, mask, direction, cycles);
}

static uint32_t in32(void) {
	uint8_t b[4];
	if (fread(b, 1, 4, stdin) != 4) exit(0);
	return b[0] | b[1] << 8 | b[2] << 16 | (uint32_t) b[3] << 24;
}

static uint8_t* reply;
static size_t replied, replyRoom;
static void out(const void* bytes, size_t count) {
	if (replied + count > replyRoom) {
		replyRoom = (replied + count) * 2;
		reply = realloc(reply, replyRoom);
		if (!reply) exit(1);
	}
	memcpy(reply + replied, bytes, count);
	replied += count;
}
static void out32(uint32_t value) {
	uint8_t b[4] = { value & 0xFF, value >> 8 & 0xFF, value >> 16 & 0xFF, value >> 24 };
	out(b, 4);
}
static void send(void) {
	fwrite(reply, 1, replied, stdout);
	fflush(stdout);
	replied = 0;
}

// the stack the check asked for, or 0
static uint32_t askedTop;

// the stack a call starts on: the one asked for, or the game's own, a little under where the game has it now
static uint32_t stackTop(void* state) {
	if (askedTop && inImage(askedTop) >= 0 && inImage(askedTop - 0x400) >= 0) return askedTop;
	core->saveState(core, state);
	ARMSetPrivilegeMode(cpu, MODE_SYSTEM);
	uint32_t sp = (cpu->gprs[ARM_SP] & ~7u) - 0x40;
	core->loadState(core, state);
	if (inImage(sp) < 0 || inImage(sp - 0x400) < 0) sp = 0x03007E00;
	return sp;
}

static void call(void* state) {
	uint32_t address = in32(), r[4];
	for (int i = 0; i < 4; i++) r[i] = in32();
	uint32_t limit = in32(), onStack = in32(), words[16] = { 0 };
	for (uint32_t i = 0; i < onStack; i++) {
		uint32_t word = in32();
		if (i < 16) words[i] = word;
	}
	if (onStack > 16) onStack = 16;
	takeImage(undo);
	memcpy(before, undo, IMAGE);
	for (uint32_t changes = in32(); changes; changes--) {
		uint32_t where = in32(), bytes = in32(), value = in32();
		long at = inImage(where);
		if (at < 0 || bytes > 4 || inImage(where + bytes - 1) < 0) continue;
		for (uint32_t i = 0; i < bytes; i++) before[at + i] = value >> 8 * i & 0xFF;
	}
	uint32_t top = stackTop(state);
	giveImage(before);
	core->saveState(core, state);

	int thumb = address & 1;
	ARMSetPrivilegeMode(cpu, MODE_SYSTEM);
	cpu->cpsr.priv = MODE_SYSTEM;
	cpu->halted = 0;
	cpu->cpsr.i = 1;                      // no interrupt runs in the middle of the function
	cpu->cpsr.t = thumb;
	cpu->executionMode = thumb ? MODE_THUMB : MODE_ARM;
	for (int i = 0; i < 4; i++) cpu->gprs[i] = r[i];
	cpu->gprs[ARM_SP] = top;
	for (uint32_t i = 0; i < onStack; i++) core->rawWrite32(core, top + 4 * i, -1, words[i]);
	cpu->gprs[ARM_LR] = RETURN_TO | 1;
	cpu->gprs[ARM_PC] = address & ~1u;
	if (thumb) ThumbWritePC(cpu); else ARMWritePC(cpu);

	hardware = 0; left = 0; leftFor = 0; readCount = 0; numberCount = 0; pairCount = 0;
	stackLow = top; stackHigh = top + 4 * onStack;
	watching = 1;
	uint32_t steps = 0;
	int ended = DID_NOT;
	while (steps < limit) {
		int inThumb = cpu->executionMode == MODE_THUMB;
		uint32_t pc = cpu->gprs[ARM_PC] - (inThumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
		if (pc == RETURN_TO) { ended = CAME_BACK; break; }
		// code runs from the cartridge, or from the work memory, where games copy some
		if (!((pc >= CARTRIDGE && pc - CARTRIDGE < romSize) || pc >> 24 == 2 || pc >> 24 == 3)) {
			if (!left) { left = 1; leftFor = pc; }
		}
		if (left) { ended = LEFT; break; }
		if (inThumb) {
			// what a function compares, a value with a number or with another value, says which numbers are worth giving it
			uint32_t opcode;
			LOAD_16(opcode, pc & cpu->memory.activeMask, cpu->memory.activeRegion);
			if ((opcode & 0xF800) == 0x2800) pair(cpu->gprs[opcode >> 8 & 7], opcode & 0xFF);
			else if ((opcode & 0xFFC0) == 0x4280) pair(cpu->gprs[opcode & 7], cpu->gprs[opcode >> 3 & 7]);
			else if ((opcode & 0xFF00) == 0x4500) pair(cpu->gprs[(opcode & 7) | (opcode >> 4 & 8)], cpu->gprs[opcode >> 3 & 15]);
		}
		ARMRun(cpu);
		steps++;
		uint32_t sp = cpu->gprs[ARM_SP];
		if (sp < stackLow && sp >= top - STACK_ROOM) stackLow = sp;
		// a stack that deep is a function calling itself for ever, over the rest of the memory
		else if (sp < top - STACK_ROOM && !left) { left = 1; leftFor = sp; }
	}
	if (left) ended = LEFT;
	watching = 0;
	uint32_t gave = cpu->gprs[0];
	for (size_t i = 0; i < readCount; i++) wasRead[inImage(reads[i][0])] = 0;

	takeImage(after);
	core->loadState(core, state);
	// the stack is the original's own business
	for (uint32_t a = stackLow & ~3u; a < stackHigh; a++) {
		long at = inImage(a);
		if (at >= 0) after[at] = before[at];
	}
	giveImage(ended == CAME_BACK ? after : undo);

	out32((uint32_t) ended); out32(gave); out32(steps); out32(hardware); out32(leftFor);
	size_t runsAt = replied + 12, runs = 0;
	out32((uint32_t) readCount); out32((uint32_t) numberCount); out32((uint32_t) pairCount); out32(0);
	for (size_t i = 0; i < readCount; i++) { out32(reads[i][0]); out32(reads[i][1]); }
	for (size_t i = 0; i < numberCount; i++) out32(numbers[i]);
	for (size_t i = 0; i < pairCount; i++) { out32(pairs[i][0]); out32(pairs[i][1]); }
	if (ended == CAME_BACK) {
		for (size_t i = 0; i < IMAGE; i++) {
			if (before[i] == after[i]) continue;
			size_t end = i + 1;
			while (end < IMAGE && before[end] != after[end]) end++;
			out32((uint32_t) i); out32((uint32_t) (end - i));
			out(after + i, end - i);
			runs++;
			i = end;
		}
	}
	uint8_t count[4] = { runs & 0xFF, runs >> 8 & 0xFF, runs >> 16 & 0xFF, runs >> 24 & 0xFF };
	memcpy(reply + runsAt, count, 4);
	send();
}

// the processor's reads and writes come through here, to see what a call does
static void watchMemory(void) {
	cpu->memory.load32 = load32;
	cpu->memory.load16 = load16;
	cpu->memory.load8 = load8;
	cpu->memory.store32 = store32;
	cpu->memory.store16 = store16;
	cpu->memory.store8 = store8;
	cpu->memory.loadMultiple = loadMultiple;
	cpu->memory.storeMultiple = storeMultiple;
}

// The functions to see start in play: for every two bytes code can run from, which of them starts there, counted
// from 1, and how many times each has started.
static struct { uint32_t base, size; uint32_t* starts; } places[] = {
	{ 0x08000000, 0, NULL },
	{ 0x03000000, IWRAM_BYTES, NULL },
	{ 0x02000000, EWRAM_BYTES, NULL },
};
#define PLACES_SEEN (sizeof places / sizeof places[0])
static uint32_t* started;
static uint32_t* nextTime;

static void watchFunctions(void) {
	uint32_t count = in32();
	places[0].size = romSize;
	for (size_t i = 0; i < PLACES_SEEN; i++) {
		free(places[i].starts);
		places[i].starts = calloc(places[i].size / 2 + 1, sizeof(uint32_t));
		if (!places[i].starts) exit(1);
	}
	free(started);
	free(nextTime);
	started = calloc(count + 1, sizeof(uint32_t));
	nextTime = calloc(count + 1, sizeof(uint32_t));
	if (!started || !nextTime) exit(1);
	for (uint32_t which = 0; which < count; which++) {
		uint32_t address = in32() & ~1u;
		nextTime[which] = 1;
		for (size_t i = 0; i < PLACES_SEEN; i++) {
			if (address - places[i].base < places[i].size) places[i].starts[(address - places[i].base) / 2] = which + 1;
		}
	}
	out32(0);
	send();
}

static void play(void) {
	uint32_t frames = in32();
	uint16_t* buttons = malloc((frames + 1) * sizeof(uint16_t));
	if (!buttons) exit(1);
	for (uint32_t i = 0; i < frames; i++) buttons[i] = (uint16_t) in32();
	uint32_t setCount = in32();
	uint32_t* sets = malloc((setCount + 1) * 4 * sizeof(uint32_t));
	if (!sets) exit(1);
	for (uint32_t i = 0; i < setCount * 4; i++) sets[i] = in32();

	core->reset(core);
	watchMemory();
	// no frame is drawn, which only the picture would show: the game runs the same
	gba->video.frameskip = gba->video.frameskipCounter = 1 << 30;
	uint32_t nextSet = 0;
	for (uint32_t which = 0; started && nextTime[which]; which++) {
		started[which] = 0;
		nextTime[which] = 1;
	}
	for (uint32_t frame = 0; frame < frames; frame++) {
		core->setKeys(core, buttons[frame]);
		for (; nextSet < setCount && sets[nextSet * 4] == frame; nextSet++) {
			// a recording writes to the work memory only
			uint32_t address = sets[nextSet * 4 + 1], bytes = sets[nextSet * 4 + 2], value = sets[nextSet * 4 + 3];
			if (address >> 24 != 2 && address >> 24 != 3) continue;
			if (bytes == 1) core->rawWrite8(core, address, -1, value);
			else if (bytes == 2) core->rawWrite16(core, address, -1, value);
			else core->rawWrite32(core, address, -1, value);
		}
		int32_t frameCounter = gba->video.frameCounter;
		// an instruction at a time, as the proof tools play every frame (original.c)
		while (gba->video.frameCounter == frameCounter) {
			while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
			uint32_t pc = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			for (size_t i = 0; started && i < PLACES_SEEN; i++) {
				if (pc - places[i].base >= places[i].size) continue;
				uint32_t which = places[i].starts[(pc - places[i].base) / 2];
				if (which && ++started[which - 1] == nextTime[which - 1]) {
					nextTime[which - 1] *= 3;
					out32(which - 1); out32(frame); out32(started[which - 1]);
					for (int r = 0; r < 4; r++) out32((uint32_t) cpu->gprs[r]);
					out32((uint32_t) cpu->gprs[ARM_SP]);
					takeImage(after);
					out(after, IMAGE);
					send();
				}
				break;
			}
			ARMRun(cpu);
		}
	}
	free(buttons);
	free(sets);
	out32(0xFFFFFFFFu);
	out32(frames);
	send();
}

int main(int argc, char** argv) {
	onWindows(&argv);
	if (argc < 2) {
		fprintf(stderr, "call ROM\n");
		return 2;
	}
	mLogSetDefaultLogger(&logger);
	core = GBACoreCreate();
	core->init(core);
	mCoreInitConfig(core, NULL);
	static color_t video[240 * 160];
	core->setVideoBuffer(core, video, 240);
	if (!mCoreLoadFile(core, argv[1])) {
		fprintf(stderr, "mGBA can't open the copy\n");
		return 1;
	}
	core->reset(core);
	cpu = core->cpu;
	gba = core->board;
	romSize = (uint32_t) gba->memory.romSize;
	memory = cpu->memory;
	watchMemory();
	void* state = malloc(core->stateSize(core));
	if (!state) return 1;

	for (;;) {
		int command = getchar();
		if (command == EOF) break;
		if (command == 'f') {
			for (uint32_t frames = in32(); frames; frames--) core->runFrame(core);
			out32(0);
			send();
		} else if (command == 'i') {
			out32(stackTop(state));
			out32(romSize);
			send();
		} else if (command == 'm') {
			takeImage(after);
			out(after, IMAGE);
			send();
		} else if (command == 's') {
			if (fread(after, 1, IMAGE, stdin) != IMAGE) return 1;
			giveImage(after);
			out32(0);
			send();
		} else if (command == 'u') {
			giveImage(undo);
			out32(0);
			send();
		} else if (command == 'c') {
			call(state);
		} else if (command == 't') {
			askedTop = in32() & ~3u;
			out32(0);
			send();
		} else if (command == 'w') {
			watchFunctions();
		} else if (command == 'p') {
			play();
		} else {
			fprintf(stderr, "call doesn't know '%c'\n", command);
			return 2;
		}
	}
	return 0;
}
