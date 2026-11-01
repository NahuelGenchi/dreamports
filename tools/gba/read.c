// Prints the original's instructions, ARM or Thumb, on the contributor's computer only, for `npm run dp -- read`
// (read.mjs). mGBA's own decoder reads them, so each line is the one mGBA's debugger shows for the same address:
// `npm run dp -- setup` builds this against mGBA's library and against its src/arm/decoder.c with the part that
// writes instructions as text, which the library leaves out (build.mjs).
//
// read ROM FRAMES MODE ADDRESS BYTES < FUNCTIONS
//   ROM        the contributor's copy, only ever read
//   FRAMES     how many frames to run the game from power-on first, for code it copies into the console's memory, or 0
//   MODE       arm or thumb
//   ADDRESS    where to start, in hexadecimal
//   BYTES      how many bytes to read
//   FUNCTIONS  on stdin, a line for each function of the code map, its address in hexadecimal, its size, and 1 if it's ARM or else 0, or nothing
//
// It writes a line to stdout for each instruction, as mGBA's debugger does for `disassemble/a` and `disassemble/t`:
// its address, its opcode, and the instruction, which a Thumb BL's two halves make together. The words the code
// loads with LDR from beside itself, its literal pool, are data, and are written as `.word`, with a Thumb pool's
// padding before them as `.hword`, and so are a switch's jump table, the addresses of its cases, which a word of the
// pool points at. Code that changes from Thumb to ARM or back partway has a line starting with @ where it does.
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
static uint32_t start, end;   // what to print
static uint32_t low, high;    // the code to follow to find out what it is: all of the code map's, or else just that
static uint8_t* pool;   // a byte for each halfword from low to high: not 0 where a word of data starts: POOL_THUMB or POOL_ARM by the mode of what loads it, or DATA if it's no table's address
static uint8_t* seen;   // and THUMB or ARM where an instruction the code reaches starts
static uint32_t* work;  // where code the program reaches starts, still to be followed, with 1 added for Thumb
static uint32_t* later; // the same for what comes after a call, followed only when nothing else is left: a compiler also uses a call as a far jump, with data behind it
static uint32_t* fresh; // words of the pool still to look at as a table's address
static size_t waiting, waitingLater, freshWords, room;
enum { THUMB = 1, ARM = 2 };
enum { POOL_THUMB = 1, DATA = 2, POOL_ARM = 3 };

static void follow(uint32_t address, int arm) {
	if (address >= low && address < high && waiting < room) work[waiting++] = arm ? address : address | 1;
}

static int isPool(uint32_t address) {
	return address >= low && address < high && pool[(address - low) / 2];
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
		fprintf(stderr, "Usage: read ROM FRAMES MODE ADDRESS BYTES < FUNCTIONS\n");
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

	// which functions there are, to follow the code from all of them: an entry of the code map may start partway into
	// a real function, with its code reached only from the entry before it
	size_t count = 0, most = 1 << 20;
	uint32_t* functions = malloc(most * 3 * sizeof(uint32_t));
	while (count < most && fscanf(stdin, "%x %u %u", &functions[count * 3], &functions[count * 3 + 1], &functions[count * 3 + 2]) == 3) count++;
	low = start;
	high = end;
	for (size_t i = 0; i < count; i++) {
		if (functions[i * 3] < low) low = functions[i * 3];
		if (functions[i * 3] + functions[i * 3 + 1] > high) high = functions[i * 3] + functions[i * 3 + 1];
	}

	size_t halves = (high - low) / 2 + 1;
	pool = calloc(halves, 1);
	seen = calloc(halves, 1);
	room = halves + count + 1;
	work = malloc(room * sizeof(uint32_t));
	later = malloc(room * sizeof(uint32_t));
	fresh = malloc(room * sizeof(uint32_t));
	for (size_t i = count; i-- > 0;) follow(functions[i * 3], functions[i * 3 + 2]);
	follow(start, arm);
	struct ARMInstructionInfo info;
	uint32_t opcode, opcode2;
	for (;;) {
		// the literal pool: every word an LDR loads from beside the code, as the PC is when it runs, in the code the
		// program reaches by its branches, so that no data read as code adds to it
		while (waiting) {
			uint32_t next = work[--waiting], address = next & ~1u;
			int mode = !(next & 1);
			// what the registers hold on this path, for code that changes mode through one
			uint32_t known[16];
			uint16_t held = 0;
			int calling = 0;
			while (address >= low && address < high && !seen[(address - low) / 2] && !isPool(address)) {
				int length = decode(address, mode, &info, &opcode, &opcode2);
				// padding, or the second half of a Thumb BL with no first: no code goes on through that
				if (opcode == 0 || (!mode && (opcode >> 11) == 0x1F)) break;
				seen[(address - low) / 2] = mode ? ARM : THUMB;
				uint32_t pc = address + (mode ? 8 : 4);
				struct ARMMemoryAccess memory = info.memory;
				if (info.mnemonic == ARM_MN_LDR && (info.operandFormat & ARM_OPERAND_MEMORY_2) && (memory.width & 7) == 4
				    && (memory.format & ARM_MEMORY_REGISTER_BASE) && memory.baseReg == ARM_PC && (memory.format & ARM_MEMORY_IMMEDIATE_OFFSET)) {
					uint32_t word = memory.format & ARM_MEMORY_OFFSET_SUBTRACT ? (pc & ~3u) - memory.offset.immediate : (pc & ~3u) + memory.offset.immediate;
					if (word >= low && word + 4 <= high && !pool[(word - low) / 2]) {
						pool[(word - low) / 2] = mode ? POOL_ARM : POOL_THUMB;
						if (freshWords < room) fresh[freshWords++] = word;
					}
					known[info.op1.reg & 15] = core->busRead32(core, word);
					held |= 1 << info.op1.reg;
				} else if (info.mnemonic == ARM_MN_ADD && (info.operandFormat & ARM_OPERAND_IMMEDIATE_3) && (info.op2.reg == ARM_PC || (held & (1 << info.op2.reg)))) {
					known[info.op1.reg & 15] = (info.op2.reg == ARM_PC ? (mode ? pc : pc & ~3u) : known[info.op2.reg & 15]) + info.op3.immediate;
					held |= 1 << info.op1.reg;
				} else if (info.mnemonic == ARM_MN_ADD && (info.operandFormat & ARM_OPERAND_IMMEDIATE_2) && (held & (1 << info.op1.reg))) {
					known[info.op1.reg & 15] += info.op2.immediate;
				} else if (info.mnemonic == ARM_MN_LDM) {
					held = 0;
				} else if (info.operandFormat & ARM_OPERAND_AFFECTED_1) {
					held &= ~(1 << info.op1.reg);
				}
				// BX goes on where the number says, in the mode its lowest bit says, or through BX PC just ahead, in ARM.
				// ARM code calls through a register that way, after setting LR to come back
				if (info.mnemonic == ARM_MN_BX && info.condition == ARM_CONDITION_AL) {
					if (info.op1.reg == ARM_PC) follow(pc & ~3u, 1);
					else if (held & (1 << info.op1.reg)) follow(known[info.op1.reg] & (known[info.op1.reg] & 1 ? ~1u : ~3u), !(known[info.op1.reg] & 1));
					if (!calling) break;
					calling = 0;
					address += length;
					continue;
				}
				calling = (info.mnemonic == ARM_MN_MOV || info.mnemonic == ARM_MN_ADD) && (info.operandFormat & ARM_OPERAND_REGISTER_2) && info.op1.reg == ARM_LR && info.op2.reg == ARM_PC;
				// a branch goes on there too, and one always taken or a return goes on only there. A BL goes on there, and
				// after it only once nothing else is left
				if (info.branchType == ARM_BRANCH || info.branchType == ARM_BRANCH_LINKED) follow(pc + info.op1.immediate, mode);
				if (info.branchType == ARM_BRANCH_LINKED) {
					if (waitingLater < room) later[waitingLater++] = mode ? address + length : (address + length) | 1;
					break;
				}
				if ((info.branchType == ARM_BRANCH || info.branchType == ARM_BRANCH_INDIRECT) && info.condition == ARM_CONDITION_AL) break;
				address += length;
			}
		}
		// a word of the pool that's the address of Thumb code, from the lowest bit it has for that, or an address in the
		// code where the addresses of a switch's cases follow one another, up to the first case after them, a jump table.
		// The code they name is followed in turn
		while (freshWords) {
			uint32_t word = fresh[--freshWords], table = core->busRead32(core, word), first = high;
			int kind = pool[(word - low) / 2];
			if (table & 1) follow(table & ~1u, 0);
			if (table < low || table >= high || table % 4) continue;
			for (uint32_t entry = table; entry + 4 <= high && entry < first; entry += 4) {
				uint32_t to = core->busRead32(core, entry);
				if (to < low || to >= high || to % 2) break;
				if (!pool[(entry - low) / 2]) pool[(entry - low) / 2] = DATA;
				if (to > entry && to < first) first = to;
				follow(to, kind == POOL_ARM);
			}
		}
		if (waiting) continue;
		if (!waitingLater) break;
		uint32_t next = later[--waitingLater];
		if (next >= low && next < high) work[waiting++] = next;
	}

	// then each instruction, as mGBA's debugger writes it, in the mode the code reached it in, and each word of the pool
	char text[128];
	for (uint32_t address = start, printed = arm; address < end;) {
		int mode = seen[(address - low) / 2] ? seen[(address - low) / 2] == ARM : printed;
		if (mode && address % 4) mode = 0;
		if (mode != (int) printed) printf("@ %s from here\n", mode ? "ARM" : "Thumb");
		printed = mode;
		if (isPool(address)) {
			uint32_t word = core->busRead32(core, address);
			printf("%08X:  %08X\t.word 0x%08X\n", address, word, word);
			address += 4;
			continue;
		}
		int length = decode(address, mode, &info, &opcode, &opcode2);
		// padding before a pool or ARM, or the second half of a word of data, for an entry of the code map that starts there
		if (!mode && address % 4 == 2 && ((opcode == 0 && (isPool(address + 2) || (address + 2 < high && seen[(address + 2 - low) / 2] == ARM))) || (address > low && isPool(address - 2)))) {
			printf("%08X:  %04X     \t.hword 0x%04X\n", address, opcode, opcode);
			address += 2;
			continue;
		}
		ARMDisassemble(&info, core->cpu, NULL, address + (mode ? 8 : 4), text, sizeof text);
		if (mode) printf("%08X:  %08X\t%s\n", address, opcode, text);
		else if (length == 4) printf("%08X:  %04X %04X\t%s\n", address, opcode, opcode2, text);
		else printf("%08X:  %04X     \t%s\n", address, opcode, text);
		address += length;
	}
	fflush(stdout);
	core->deinit(core);
	return 0;
}
