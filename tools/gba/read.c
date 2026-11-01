// Prints the original's instructions, ARM or Thumb, on the contributor's computer only, for `npm run dp -- read`
// (read.mjs). mGBA's own decoder reads them, so each line is the one mGBA's debugger shows for the same address:
// `npm run dp -- setup` builds this against mGBA's library and against its src/arm/decoder.c with the part that
// writes instructions as text, which the library leaves out (build.mjs).
//
// read ROM FRAMES MODE ADDRESS BYTES
//   ROM      the contributor's copy, only ever read
//   FRAMES   how many frames to run the game from power-on first, for code it copies into the console's memory, or 0
//   MODE     arm or thumb
//   ADDRESS  where to start, in hexadecimal
//   BYTES    how many bytes to read
//
// It writes a line to stdout for each instruction, as mGBA's debugger does for `disassemble/a` and `disassemble/t`:
// its address, its opcode, and the instruction, which a Thumb BL's two halves make together. The words the code
// loads with LDR from beside itself, its literal pool, are data, and are written as `.word`, with a Thumb pool's
// padding before them as `.hword`, and so are a switch's jump table, the addresses of its cases, which a word of the
// pool points at.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/decoder.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// decoder.c's text, which decoder.h only declares for a build with mGBA's debugger
struct mDebuggerSymbols;
int ARMDisassemble(const struct ARMInstructionInfo* info, struct ARMCore* core, const struct mDebuggerSymbols* symbols, uint32_t pc, char* buffer, int blen);
// the debugger's names for addresses, which decoder.c looks up only when it's given some, and read gives it none
const char* mDebuggerSymbolReverseLookup(const struct mDebuggerSymbols* symbols, int32_t value, int segment) {
	(void) symbols; (void) value; (void) segment;
	return NULL;
}

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

static struct mCore* core;
static uint32_t start, end;
static uint8_t* pool;   // a byte for each halfword from start to end: 1 where a word of data starts
static uint8_t* seen;   // and 1 where an instruction the code reaches starts
static uint32_t* work;  // where code the function reaches starts, still to be followed
static size_t waiting, room;

static void follow(uint32_t address) {
	if (address >= start && address < end && waiting < room) work[waiting++] = address;
}

static int isPool(uint32_t address) {
	return address >= start && address < end && pool[(address - start) / 2];
}

// the instruction at an address, a Thumb BL's two halves together unless the second is in the pool, and its length
static int decode(uint32_t address, int arm, struct ARMInstructionInfo* info, uint32_t* opcode, uint32_t* opcode2) {
	if (arm) {
		*opcode = core->busRead32(core, address);
		ARMDecodeARM(*opcode, info);
		return 4;
	}
	struct ARMInstructionInfo first, second;
	*opcode = core->busRead16(core, address);
	*opcode2 = core->busRead16(core, address + 2);
	ARMDecodeThumb(*opcode, &first);
	ARMDecodeThumb(*opcode2, &second);
	if (!isPool(address + 2) && ARMDecodeThumbCombine(&first, &second, info)) return 4;
	*info = first;
	return 2;
}

int main(int argc, char** argv) {
	if (argc != 6) {
		fprintf(stderr, "Usage: read ROM FRAMES MODE ADDRESS BYTES\n");
		return 2;
	}
	long frames = atol(argv[2]);
	int arm = !strcmp(argv[3], "arm");
	start = strtoul(argv[4], NULL, 16) & (arm ? ~3u : ~1u);
	end = start + strtoul(argv[5], NULL, 10);

	mLogSetDefaultLogger(&logger);
	core = GBACoreCreate();
	core->init(core);
	// no configuration from the computer: no BIOS file and default settings, as original.c has it
	mCoreInitConfig(core, NULL);
	static uint32_t video[240 * 160];
	core->setVideoBuffer(core, (color_t*) video, 240);
	if (!mCoreLoadFile(core, argv[1])) {
		fprintf(stderr, "mGBA can't open the copy\n");
		return 1;
	}
	core->reset(core);
	for (long frame = 0; frame < frames; frame++) core->runFrame(core);

	// first the literal pool: every word an LDR loads from beside the code, as the PC is when it runs, in the code the
	// function reaches from its start by its branches, so that no data read as code adds to it
	size_t halves = (end - start) / 2 + 1;
	pool = calloc(halves, 1);
	seen = calloc(halves, 1);
	room = halves * 4;
	work = malloc(room * sizeof(uint32_t));
	follow(start);
	struct ARMInstructionInfo info;
	uint32_t opcode, opcode2;
	while (waiting) {
		while (waiting) {
			uint32_t address = work[--waiting];
			while (address >= start && address < end && !seen[(address - start) / 2] && !isPool(address)) {
				seen[(address - start) / 2] = 1;
				int length = decode(address, arm, &info, &opcode, &opcode2);
				uint32_t pc = address + (arm ? 8 : 4);
				struct ARMMemoryAccess memory = info.memory;
				if (info.mnemonic == ARM_MN_LDR && (info.operandFormat & ARM_OPERAND_MEMORY_2) && (memory.width & 7) == 4
				    && (memory.format & ARM_MEMORY_REGISTER_BASE) && memory.baseReg == ARM_PC && (memory.format & ARM_MEMORY_IMMEDIATE_OFFSET)) {
					uint32_t word = memory.format & ARM_MEMORY_OFFSET_SUBTRACT ? (pc & ~3u) - memory.offset.immediate : (pc & ~3u) + memory.offset.immediate;
					if (word >= start && word + 4 <= end) pool[(word - start) / 2] = 1;
				}
				// a branch goes on there too, and one always taken, a return or a jump goes on only there; a BL to inside
				// the function is a jump too far for a branch, as compilers write one, and goes on there as well
				if (info.branchType == ARM_BRANCH || info.branchType == ARM_BRANCH_LINKED) follow(pc + info.op1.immediate);
				if ((info.branchType == ARM_BRANCH || info.branchType == ARM_BRANCH_INDIRECT) && info.condition == ARM_CONDITION_AL) break;
				address += length;
			}
		}
		// then the jump tables: a word of the pool that is an address inside the function, where the addresses of a
		// switch's cases follow one another, up to the first case, whose code is followed in turn
		for (uint32_t word = start; word < end; word += 2) {
			if (!pool[(word - start) / 2] || pool[(word - start) / 2] == 2) continue;
			pool[(word - start) / 2] = 2;
			uint32_t table = core->busRead32(core, word), first = end;
			if (table < start || table >= end || table % 4) continue;
			for (uint32_t entry = table; entry + 4 <= end && entry < first && !seen[(entry - start) / 2]; entry += 4) {
				uint32_t to = core->busRead32(core, entry);
				if (to < start || to >= end || to % 2) break;
				if (!pool[(entry - start) / 2]) pool[(entry - start) / 2] = 1;
				if (to < first) first = to;
				follow(to);
			}
		}
	}

	// then each instruction, as mGBA's debugger writes it, and each word of the pool
	char text[128];
	for (uint32_t address = start; address < end;) {
		if (isPool(address)) {
			uint32_t word = core->busRead32(core, address);
			printf("%08X:  %08X\t.word 0x%08X\n", address, word, word);
			address += 4;
			continue;
		}
		int length = decode(address, arm, &info, &opcode, &opcode2);
		if (!arm && opcode == 0 && address % 4 == 2 && isPool(address + 2)) {
			printf("%08X:  %04X     \t.hword 0x0000\n", address, opcode);
		} else {
			ARMDisassemble(&info, core->cpu, NULL, address + (arm ? 8 : 4), text, sizeof text);
			if (arm) printf("%08X:  %08X\t%s\n", address, opcode, text);
			else if (length == 4) printf("%08X:  %04X %04X\t%s\n", address, opcode, opcode2, text);
			else printf("%08X:  %04X     \t%s\n", address, opcode, text);
		}
		address += length;
	}
	fflush(stdout);
	core->deinit(core);
	return 0;
}
