// Runs the original game in mGBA, the reference the proof tools compare a Dreamport against, on the contributor's
// computer only. It plays the buttons it is given, one set per frame, and writes what each frame shows, what it
// sounds like and which of the game's functions ran in it. `npm run dp -- setup` builds it against mGBA's library
// (build.mjs).
//
// original ROM FRAMES BUTTONS FUNCTIONS PICTURES SOUND SETS STATES
//   ROM        the contributor's copy, only ever read
//   FRAMES     how many frames to run
//   BUTTONS    a file with the buttons held at each frame: 16 bits each, a bit per button as KEYINPUT has them
//   FUNCTIONS  a file with where the code map's functions run, or -: each its address, its size, its place in the code
//              map, whether to check its bytes (1) or not (0), and its first 8 bytes (32 bits each, 6 in all). A function
//              runs when the processor reaches its address, and one whose bytes are checked only when they're there, as
//              in the work RAM, where a game can put other code at the same address at another time
//   PICTURES   a file with the frames whose whole picture to write (32 bits each, in order), or -
//   SOUND      a file to write each frame's sound to, or -
//   SETS       a file with values to write to the work RAM as each frame starts, in the order of their frames, or -: each
//              its frame, its address, how many bytes and its value (32 bits each)
//   STATES     a file with the frames whose state to write (32 bits each, in order), or -
//
// The environment's DP_READS, when it's set, names a file of values to read from the work RAM as a frame ends, in the
// order of their frames: each its frame, its address and how many bytes (32 bits each). The JSON on stderr then has
// them, in that order, under "reads", which is how the tools learn what the original holds, such as who is playing.
//
// The environment's DP_MEMORY, when it's set, names a file of stretches of the work RAM to compare with a Dreamport's
// that keeps its memory at the console's addresses (lib/memory.mjs): the frame whose bytes to write as well, or
// 0xFFFFFFFF for none, then each stretch's address and how many bytes (32 bits each). It writes "<that file>.out": a
// hash of all the stretches' bytes as each frame ends (32 bits, FNV-1a, as the pictures are hashed), then the bytes
// themselves as they were at the frame asked for, when the run reaches it.
//
// The environment's DP_RAM_CODE, when it's set, names a file to write the code that runs in the work RAM to, for the
// code map (codemap.mjs): each time an instruction runs at an address there with other bytes than the last time,
// its frame, its address (+1 for Thumb) and its bytes (32 bits each).
//
// The environment's DP_PLAYED, when it's set, names a file to write what ran to, for gameplay proven (lib/played.mjs):
// every instruction that ran, in the cartridge or the work RAM, and for a conditional branch each of its two ways, taken
// and not, each with the stretches of frames it happened in. A record is five 32-bit words: the instruction's address
// (+1 for Thumb), its bytes, what happened (0 it ran, 1 its branch was taken, 2 it wasn't), and the first and the last
// frame of a stretch of frames that each had it. An address of the work RAM that later holds other bytes starts anew.
// DP_PLAYED_CODE, with it, names a file for the functions the game makes in its work RAM, which only the console's
// memory holds: the first time one runs, its place in the code map, its address, its size, and its bytes, to a whole
// word (the tools count its instructions and branches from them, and keep none: lib/played.mjs).
//
// DP_WHY, when it's set, is two files, such as "branches.bin why.bin": the addresses of conditional branches, a 32-bit
// word each, and where to write what each went by, each time it ran (npm run dp -- untouched <version> --why
// <address>, and --sort for many at once). The program follows where each register's value came from, a place in
// memory or a number in the code, and at a branch says what the last instruction that set the flags compared. A record
// is twelve 32-bit words: the comparing instruction's address, its two values, where each came from (an address, or 0)
// and what kind that is (0 worked out, 1 read from memory, 2 a number in the code, 3 read from the cartridge's data,
// +4 when changed since, and the bytes read in the next byte), the way the branch went (1 taken, 2 not), how many times it went so with those, the first
// frame it did, the branch's address, and 0. One record for each different set, up to WHY_EACH for a branch: the times
// it went a way with any other set come in a last record for that way, whose twelfth word is 1 and whose values are 0.
//
// DP_CONTENT, when it's set, names a file to write the cartridge's data the game used to, for gameplay proven too: the
// cartridge in cells of 32 bytes, each with the stretches of frames something of it was used in. A record is three
// 32-bit words: the cell's number, and the first and last frame of a stretch. Data is used when the game reads it and
// does anything with it but copy it into its work RAM; what it copies there, or has the BIOS unpack there, is followed,
// and counts where it came from in the cartridge once it's read from the work RAM and used (a byte the BIOS unpacked
// counts as the place as far through the packed data as it is through what came out). Data a game unpacks with code
// of its own counts as it's read, as unpacking it is using it.
//
// DP_SAVES, when it's set, names a file to write the cartridge's save memory to each time it changes, so the tools can
// compare what a Dreamport saves with it (lib/saves.mjs): for each frame that ends with other bytes in it than the
// frame before, the frame, how many bytes the memory has, and the bytes, to a whole word. The file stays on the
// contributor's computer, and goes when it's been read.
//
// DP_SAVE_START, when it's set, names a file with the cartridge's save memory as the game starts, in place of one
// never written: a player's report carries the save their game began from, and the same presses play something else
// from another (docs/REPORTS.md). The file is read and never written. What DP_SAVES writes is then what changed since.
//
// For each frame it writes to stdout: a hash of the picture (FNV-1a over each pixel's 15-bit colour, as the
// console has it), the picture's one colour if every pixel has it or else 0xFFFFFFFF, the number of functions that
// ran in the frame and their places in the code map (32 bits each), then the picture itself if PICTURES names the
// frame (240 x 160 pixels of 16 bits, the console's 15-bit colour), then what the console held as it drew the frame if
// STATES names it: the display registers (0x58 bytes), the colours (0x400), the sprites (0x400) and the video memory
// (0x18000), as lib/state.mjs reads them.
// For each frame it writes to SOUND how many samples of the console's sound the frame made, then each sample, left
// and right (16 bits each): the mix of the four Game Boy channels and the two DirectSound FIFOs, as offsets around the
// bias in the console's 10-bit units, 65536 a second (every 256 cycles), the rate the sound library sets as it
// starts. Before that the console mixes every 512 cycles, and each of those samples is written twice.
// At the end it writes to stderr, as JSON, how many instructions ran outside every function of the code map: in the
// cartridge, and in the work RAM games copy code into, and the values DP_READS asked for.
//
// original ROM route SPEC
//   Finds the buttons that take the game to a goal, for the route finder (tools/route.mjs): SPEC is a file that says
//   what to search for, as lib/explore.h reads it. Nothing is drawn as it searches, which changes nothing the game
//   can see, and it prints how far it has got.
//
//   With DP_PROVEN in the environment, a file of what's been played of the cartridge's code already (32 bits each: an
//   instruction's place, its offset in the cartridge in halfwords, times four, plus 0 when it has run, 1 when its
//   branch has been taken and 2 when it hasn't been), the search can look for anything else: the value at 0xFFFF0000,
//   which no console has, is then how many things not in the file happened in the frame just played. With DP_TARGET
//   too, "ADDRESS WHAT" (the address in hexadecimal, and 0, 1 or 2 as above), it counts that one thing alone, at an
//   address of the cartridge or of the work RAM: an instruction running, or its branch going one way.
//
// original ROM live
//   Plays along with a person, for capture: for each frame it reads the buttons held from stdin (16 bits, as in
//   BUTTONS), runs the frame just as above, and writes to stdout its picture, how many samples of sound it made, then
//   each sample, as SOUND has them. It ends when stdin does.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/decoder.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/savedata.h>
#include <mgba-util/vfs.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "on-windows.h"
#include "explore.h"
#include "ran.h"
#include "used.h"

#define WIDTH 240
#define HEIGHT 160

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

// The parts of the console's memory code can run from: the cartridge (ROM), and the work RAM games copy code into.
struct region { uint32_t base, size; uint32_t* first; uint8_t* inside; uint8_t* outside; long seen; uint32_t* lastCode; uint8_t* ranCode; };
static struct region regions[] = {
	{ 0x08000000, 0x02000000 },  // the cartridge
	{ 0x03000000, 0x00008000 },  // internal work RAM
	{ 0x02000000, 0x00040000 },  // external work RAM
};
#define REGIONS (sizeof regions / sizeof regions[0])

static struct region* regionOf(uint32_t address) {
	for (size_t i = 0; i < REGIONS; i++) {
		if (address - regions[i].base < regions[i].size) return &regions[i];
	}
	return NULL;
}


// The console's sound as mGBA mixes it: each sample comes through its audio stream, scaled by mGBA's master volume
// (3/16 of 256, so 48 for each of the console's 10-bit steps), and stretched or thinned to one every 256 cycles.
#define SOUND_STEP 256
struct sound { struct mAVStream stream; struct GBA* gba; int16_t* samples; size_t count, capacity; int32_t cycles; };

static void heard(struct mAVStream* stream, int16_t left, int16_t right) {
	struct sound* sound = (struct sound*) stream;
	for (sound->cycles += sound->gba->audio.sampleInterval; sound->cycles >= SOUND_STEP; sound->cycles -= SOUND_STEP) {
		if (sound->count + 2 > sound->capacity) {
			sound->capacity = sound->capacity ? sound->capacity * 2 : 4096;
			sound->samples = realloc(sound->samples, sound->capacity * sizeof(int16_t));
		}
		sound->samples[sound->count++] = left / 48;
		sound->samples[sound->count++] = right / 48;
	}
}

// a value a recording writes to the work RAM, the only memory it can reach, as a recording can't change the game itself
static void setValue(struct mCore* core, uint32_t address, uint32_t bytes, uint32_t value) {
	struct region* region = regionOf(address);
	if (!region || region == &regions[0] || address - region->base + bytes > region->size) {
		fprintf(stderr, "A recording can only write to the work RAM, and 0x%08X isn't in it\n", address);
		exit(2);
	}
	if (bytes == 1) core->rawWrite8(core, address, -1, value);
	else if (bytes == 2) core->rawWrite16(core, address, -1, value);
	else core->rawWrite32(core, address, -1, value);
}

// a value the tools read from the work RAM, and only from there, so nothing of the cartridge comes out
static uint32_t readValue(struct mCore* core, uint32_t address, uint32_t bytes) {
	struct region* region = regionOf(address);
	if (!region || region == &regions[0] || address - region->base + bytes > region->size) {
		fprintf(stderr, "The tools can only read the work RAM, and 0x%08X isn't in it\n", address);
		exit(2);
	}
	if (bytes == 1) return core->rawRead8(core, address, -1);
	if (bytes == 2) return core->rawRead16(core, address, -1);
	return core->rawRead32(core, address, -1);
}

// whether the 8 bytes at `address` are a function's first, as FUNCTIONS has them
static int sameBytes(struct mCore* core, uint32_t address, uint32_t low, uint32_t high) {
	return core->rawRead16(core, address, -1) == (low & 0xFFFF) && core->rawRead16(core, address + 2, -1) == low >> 16
		&& core->rawRead16(core, address + 4, -1) == (high & 0xFFFF) && core->rawRead16(core, address + 6, -1) == high >> 16;
}

static void* readAll(const char* path, size_t* size) {
	*size = 0;
	if (!strcmp(path, "-")) return NULL;
	FILE* file = fopen(path, "rb");
	if (!file) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fseek(file, 0, SEEK_END);
	long length = ftell(file);
	fseek(file, 0, SEEK_SET);
	void* data = malloc(length ? length : 1);
	if (length && fread(data, 1, length, file) != (size_t) length) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fclose(file);
	*size = length;
	return data;
}

static uint32_t video[WIDTH * HEIGHT];
static uint16_t picture[WIDTH * HEIGHT];
static struct sound sound;

// no configuration from the computer: no BIOS file and default settings, the same on every computer
// the save memory the game starts from (DP_SAVE_START), kept to tell what the game writes from what it began with
static uint8_t* startSave;
static size_t startSaveSize;

// gives the emulator a copy of the file's bytes as the cartridge's save memory, so the file itself is never written
static void loadStartSave(struct mCore* core) {
	const char* path = getenv("DP_SAVE_START");
	if (!path) return;
	FILE* file = fopen(path, "rb");
	if (!file) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fseek(file, 0, SEEK_END);
	long size = ftell(file);
	fseek(file, 0, SEEK_SET);
	if (size < 1 || size > 0x20000) { fprintf(stderr, "%s isn't a cartridge's save memory\n", path); exit(2); }
	startSave = malloc((size_t) size);
	if (fread(startSave, 1, (size_t) size, file) != (size_t) size) { fprintf(stderr, "Can't read %s\n", path); exit(2); }
	fclose(file);
	startSaveSize = (size_t) size;
	if (!core->loadSave(core, VFileMemChunk(startSave, startSaveSize))) { fprintf(stderr, "mGBA can't take the save\n"); exit(2); }
}

static struct mCore* openCopy(const char* path) {
	mLogSetDefaultLogger(&logger);
	struct mCore* core = GBACoreCreate();
	core->init(core);
	mCoreInitConfig(core, NULL);
	core->setVideoBuffer(core, (color_t*) video, WIDTH);
	if (!mCoreLoadFile(core, path)) {
		fprintf(stderr, "mGBA can't open the copy\n");
		exit(1);
	}
	loadStartSave(core);
	return core;
}

static void hearSound(struct mCore* core) {
	sound.stream.postAudioFrame = heard;
	sound.gba = core->board;
	core->setAVStream(core, &sound.stream);
}

// the frame's picture in the console's 15-bit colour, and its hash and its one colour, if it has only one
static void draw(uint32_t* hash, uint32_t* plain) {
	*hash = 0x811C9DC5;
	for (int i = 0; i < WIDTH * HEIGHT; i++) {
		uint32_t pixel = video[i];
		uint16_t colour = ((pixel >> 3) & 0x1F) | (((pixel >> 11) & 0x1F) << 5) | (((pixel >> 19) & 0x1F) << 10);
		picture[i] = colour;
		*hash = (*hash ^ colour) * 0x01000193;
		if (!i) *plain = colour;
		else if (colour != *plain) *plain = 0xFFFFFFFF;
	}
}

// the bytes of a stretch of the work RAM, as the console holds them now: only ever one that is all inside it
static const uint8_t* workMemory(struct GBA* gba, uint32_t address, uint32_t bytes) {
	if (address >= BASE_WORKING_RAM && address - BASE_WORKING_RAM <= SIZE_WORKING_RAM && bytes <= SIZE_WORKING_RAM - (address - BASE_WORKING_RAM)) {
		return (const uint8_t*) gba->memory.wram + (address - BASE_WORKING_RAM);
	}
	if (address >= BASE_WORKING_IRAM && address - BASE_WORKING_IRAM <= SIZE_WORKING_IRAM && bytes <= SIZE_WORKING_IRAM - (address - BASE_WORKING_IRAM)) {
		return (const uint8_t*) gba->memory.iwram + (address - BASE_WORKING_IRAM);
	}
	fprintf(stderr, "The tools can only compare the work RAM, and the %u bytes from 0x%08X aren't all in it\n", bytes, address);
	exit(2);
}

// what the console holds as a frame ends, before its V-blank starts: what it has just drawn the frame from
static void writeState(struct GBA* gba) {
	fwrite(gba->memory.io, 1, 0x58, stdout);
	fwrite(gba->video.palette, 1, 0x400, stdout);
	fwrite(gba->video.oam.raw, 1, 0x400, stdout);
	fwrite(gba->video.vram, 1, 0x18000, stdout);
}

static int playAlong(const char* path) {
	struct mCore* core = openCopy(path);
	hearSound(core);
	core->reset(core);
	struct ARMCore* cpu = core->cpu;
	uint16_t keys;
	while (fread(&keys, 2, 1, stdin) == 1) {
		core->setKeys(core, keys);
		uint32_t frameCounter = core->frameCounter(core);
		while (core->frameCounter(core) == frameCounter) {
			while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
			core->step(core);
		}
		uint32_t hash, plain;
		draw(&hash, &plain);
		uint32_t samples = sound.count / 2;
		fwrite(picture, 2, WIDTH * HEIGHT, stdout);
		fwrite(&samples, 4, 1, stdout);
		fwrite(sound.samples, 2, sound.count, stdout);
		fflush(stdout);
		sound.count = 0;
	}
	core->deinit(core);
	return 0;
}

// What a branch went by, for DP_WHY: where each register's value came from, the last comparison, and what the branch
// at the target did with it
#define WHY_EACH 24
#define WHY_SLOTS (1u << 18)
#define FROM_MEMORY 1
#define FROM_CODE 2
#define FROM_DATA 3
#define CHANGED_SINCE 4
struct came { uint32_t address; uint32_t kind; };
static struct {
	FILE* file;
	uint32_t* targets;         // the branches asked about, in order
	size_t targetCount;
	uint8_t* sets;             // how many different sets each has so far
	uint32_t (*more)[3];       // and the times it went each way with a set past WHY_EACH, with the first frame
	struct came from[16];
	struct { uint32_t pc, a, b; struct came fromA, fromB; } compared;
	uint32_t loaded, loadedBytes;
	int didLoad;
	struct ARMMemory memory;
	uint32_t (*records)[12];   // a hash table of WHY_SLOTS, a record's ninth word 0 where there's none
	size_t count;
} why;

static uint32_t whyLoad32(struct ARMCore* cpu, uint32_t address, int* cycles) { why.loaded = address & ~3u; why.loadedBytes = 4; why.didLoad = 1; return why.memory.load32(cpu, address, cycles); }
static uint32_t whyLoad16(struct ARMCore* cpu, uint32_t address, int* cycles) { why.loaded = address & ~1u; why.loadedBytes = 2; why.didLoad = 1; return why.memory.load16(cpu, address, cycles); }
static uint32_t whyLoad8(struct ARMCore* cpu, uint32_t address, int* cycles) { why.loaded = address; why.loadedBytes = 1; why.didLoad = 1; return why.memory.load8(cpu, address, cycles); }

static int byAddress(const void* a, const void* b) { return (*(const uint32_t*) a > *(const uint32_t*) b) - (*(const uint32_t*) a < *(const uint32_t*) b); }

static void watchWhy(struct ARMCore* cpu, const char* asked) {
	char list[4096], path[4096];
	size_t size;
	if (sscanf(asked, "%4095s %4095[^\n]", list, path) != 2 || !(why.file = fopen(path, "wb"))) { fprintf(stderr, "DP_WHY takes a file of branches and a file to write\n"); exit(2); }
	why.targets = readAll(list, &size);
	why.targetCount = size / 4;
	for (size_t i = 0; i < why.targetCount; i++) why.targets[i] &= ~1u;
	qsort(why.targets, why.targetCount, 4, byAddress);
	why.sets = calloc(why.targetCount + 1, 1);
	why.more = calloc(why.targetCount + 1, sizeof(*why.more));
	why.records = calloc(WHY_SLOTS, sizeof(*why.records));
	why.memory = cpu->memory;
	cpu->memory.load32 = whyLoad32;
	cpu->memory.load16 = whyLoad16;
	cpu->memory.load8 = whyLoad8;
}

// one instruction with DP_WHY: it runs, and what it wrote to a register is traced to where that came from
static void runWhy(struct ARMCore* cpu, long frame) {
	int thumb = cpu->executionMode == MODE_THUMB;
	uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	struct ARMInstructionInfo info;
	if (thumb) ARMDecodeThumb((uint16_t) cpu->prefetch[0], &info);
	else ARMDecodeARM(cpu->prefetch[0], &info);
	uint32_t before[16];
	memcpy(before, cpu->gprs, sizeof(before));
	why.didLoad = 0;
	ARMRun(cpu);
	int format = info.operandFormat, mnemonic = info.mnemonic;
	int to = format & ARM_OPERAND_REGISTER_1 ? info.op1.reg & 15 : -1;
	struct came result = { 0, 0 };
	int known = 0;
	if (mnemonic == ARM_MN_LDR && to >= 0 && why.didLoad) {
		// read from memory, or from the numbers the code keeps beside itself
		// the numbers a function keeps beside itself are read by where the code is; anything else of the cartridge is its data
		int cartridge = why.loaded >> 24 == 8 || why.loaded >> 24 == 9;
		result = (struct came) { why.loaded, (!cartridge ? FROM_MEMORY : info.memory.baseReg == ARM_PC ? FROM_CODE : FROM_DATA) | why.loadedBytes << 8 };
		known = 1;
	} else if (to >= 0 && format & ARM_OPERAND_AFFECTED_1 && mnemonic != ARM_MN_LDM && mnemonic != ARM_MN_BL && mnemonic != ARM_MN_BX && !why.didLoad) {
		// worked out from registers and numbers: it keeps where one came from when nothing else from memory went in
		struct came sources[3];
		int count = 0, numbers = 0;
		if (format & ARM_OPERAND_REGISTER_2) sources[count++] = why.from[info.op2.reg & 15];
		else if (format & ARM_OPERAND_IMMEDIATE_2) numbers++;
		if (format & ARM_OPERAND_REGISTER_3) sources[count++] = why.from[info.op3.reg & 15];
		else if (format & ARM_OPERAND_IMMEDIATE_3) numbers++;
		// with two operands and no move, the first is worked on too
		int moves = mnemonic == ARM_MN_MOV || mnemonic == ARM_MN_MVN || mnemonic == ARM_MN_NEG;
		if (!(format & ARM_OPERAND_3) && !moves) sources[count++] = why.from[to];
		int fromMemory = 0, unknown = 0;
		for (int i = 0; i < count; i++) {
			if ((sources[i].kind & 3) == FROM_MEMORY || (sources[i].kind & 3) == FROM_DATA) { fromMemory++; result = sources[i]; }
			else if (!(sources[i].kind & 3)) unknown++;
		}
		if (unknown || fromMemory > 1) result = (struct came) { 0, 0 };
		else if (fromMemory == 1) { if (!(moves && count == 1)) result.kind |= CHANGED_SINCE; }
		else result = (struct came) { 0, FROM_CODE };
		known = 1;
	}
	// any other register an instruction changed, such as those a call or a pop leaves, came from nowhere that's followed
	for (int reg = 0; reg < 15; reg++) {
		if (reg == to && known) why.from[reg] = result;
		else if (cpu->gprs[reg] != before[reg]) why.from[reg] = (struct came) { 0, 0 };
	}
	// what set the flags: a comparison's two sides, or what an instruction left, against nothing
	if (mnemonic == ARM_MN_CMP || mnemonic == ARM_MN_CMN || mnemonic == ARM_MN_TST || mnemonic == ARM_MN_TEQ) {
		why.compared.pc = pc;
		why.compared.a = before[info.op1.reg & 15];
		why.compared.fromA = why.from[info.op1.reg & 15];
		if (format & ARM_OPERAND_REGISTER_2) { why.compared.b = before[info.op2.reg & 15]; why.compared.fromB = why.from[info.op2.reg & 15]; }
		else { why.compared.b = (uint32_t) info.op2.immediate; why.compared.fromB = (struct came) { 0, FROM_CODE }; }
	} else if (info.affectsCPSR && to >= 0 && format & ARM_OPERAND_AFFECTED_1) {
		why.compared.pc = pc;
		why.compared.a = cpu->gprs[to];
		why.compared.fromA = why.from[to];
		why.compared.b = 0;
		why.compared.fromB = (struct came) { 0, FROM_CODE };
	}
	if (!branches(info.opcode, thumb)) return;
	uint32_t* asked = bsearch(&pc, why.targets, why.targetCount, 4, byAddress);
	if (!asked) return;
	size_t which = (size_t) (asked - why.targets);
	uint32_t after = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
	uint32_t way = after == pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM) ? NOT_TAKEN : TAKEN;
	uint32_t record[12] = { why.compared.pc, why.compared.a, why.compared.b, why.compared.fromA.address, why.compared.fromA.kind, why.compared.fromB.address, why.compared.fromB.kind, way, 1, (uint32_t) frame, pc, 0 };
	uint32_t hash = pc * 2654435761u;
	for (int i = 0; i < 8; i++) hash = (hash ^ record[i]) * 16777619u;
	for (uint32_t slot = hash & (WHY_SLOTS - 1), tried = 0; tried < WHY_SLOTS; slot = (slot + 1) & (WHY_SLOTS - 1), tried++) {
		uint32_t* held = why.records[slot];
		if (held[8] && held[10] == pc && !memcmp(held, record, 8 * sizeof(uint32_t))) { held[8]++; return; }
		if (held[8]) continue;
		if (why.sets[which] < WHY_EACH && why.count < WHY_SLOTS / 2) {
			memcpy(held, record, sizeof(record));
			why.sets[which]++;
			why.count++;
			return;
		}
		break;
	}
	// one set too many for this branch: counted, without its values
	if (!why.more[which][0] && !why.more[which][1]) why.more[which][2] = (uint32_t) frame;
	why.more[which][way == TAKEN ? 0 : 1]++;
}

// what the search needs of a console (lib/explore.h), for each one it runs
// What's been played of the cartridge's code, for a search for what hasn't (DP_PROVEN): a bit for each thing that can
// happen at each halfword, and for each halfword whether it's a conditional branch, found the first time it runs
#define UNTOUCHED 0xFFFF0000u
#define FRAMES 0xFFFF0004u
static struct { uint8_t* played; uint8_t* kind; uint32_t slots; int aimed; uint32_t target; int what; } proven;
static _Thread_local uint32_t untouched;   // how many things not played yet happened in this console's last frame

static void readProven(const char* path) {
	size_t size;
	uint32_t* list = readAll(path, &size);
	proven.slots = regions[0].size / 2;
	proven.played = calloc(proven.slots, 1);
	proven.kind = calloc(proven.slots, 1);
	for (size_t i = 0; i < size / 4; i++) if (list[i] / 4 < proven.slots) proven.played[list[i] / 4] |= (uint8_t) (1 << (list[i] & 3));
	free(list);
	unsigned target, what;
	if (getenv("DP_TARGET") && sscanf(getenv("DP_TARGET"), "%x %u", &target, &what) == 2 && what < HAPPENINGS) {
		proven.aimed = 1;
		proven.target = target & ~1u;
		proven.what = (int) what;
	}
}

static void searchFrame(void* console, uint32_t buttons) {
	struct mCore* core = console;
	struct ARMCore* cpu = core->cpu;
	struct GBA* gba = core->board;
	core->setKeys(core, buttons);
	untouched = 0;
	// an instruction at a time, as main plays every frame
	int32_t frameCounter = gba->video.frameCounter;
	while (gba->video.frameCounter == frameCounter) {
		while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
		int thumb = cpu->executionMode == MODE_THUMB;
		uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM), slot = (pc - regions[0].base) / 2;
		if (proven.aimed) {
			// one thing alone: the instruction at the target running, or its branch going the way that's wanted
			ARMRun(cpu);
			if (pc != proven.target) continue;
			uint32_t after = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			int straight = after == pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			if (proven.what == RAN || (proven.what == NOT_TAKEN) == straight) untouched++;
			continue;
		}
		if (!proven.played || slot >= proven.slots) {
			ARMRun(cpu);
			continue;
		}
		if (!proven.kind[slot]) proven.kind[slot] = branches(thumb ? core->rawRead16(core, pc, -1) : core->rawRead32(core, pc, -1), thumb) ? 2 : 1;
		if (!(proven.played[slot] & 1 << RAN)) untouched++;
		ARMRun(cpu);
		if (proven.kind[slot] == 2) {
			uint32_t after = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			if (!(proven.played[slot] & 1 << (after == pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM) ? NOT_TAKEN : TAKEN))) untouched++;
		}
	}
}
static void searchSave(void* console, void* to) { ((struct mCore*) console)->saveState(console, to); }
static void searchLoad(void* console, const void* from) { ((struct mCore*) console)->loadState(console, from); }
static int searchRead(void* console, uint32_t address, uint32_t bytes, uint32_t* value) {
	struct mCore* core = console;
	if (address == UNTOUCHED && proven.played) {
		*value = untouched;
		return 1;
	}
	if (address == FRAMES) {
		// how long the console has played, for a part of a game with no place to spread over
		*value = (uint32_t) ((struct GBA*) core->board)->video.frameCounter;
		return 1;
	}
	struct region* region = regionOf(address);
	if (!region || region == &regions[0] || address - region->base + bytes > region->size) return 0;
	*value = bytes == 1 ? core->rawRead8(core, address, -1) : bytes == 2 ? core->rawRead16(core, address, -1) : core->rawRead32(core, address, -1);
	return 1;
}
static void searchSet(void* console, uint32_t address, uint32_t bytes, uint32_t value) { setValue(console, address, bytes, value); }

// a console for the search, switched on, each with a picture of its own to draw to
static const char* searchedCopy;
static struct ex_machine searchConsole(void) {
	struct mCore* core = GBACoreCreate();
	core->init(core);
	mCoreInitConfig(core, NULL);
	core->setVideoBuffer(core, malloc(WIDTH * HEIGHT * sizeof(color_t)), WIDTH);
	if (!mCoreLoadFile(core, searchedCopy)) {
		fprintf(stderr, "mGBA can't open the copy\n");
		exit(1);
	}
	core->reset(core);
	// no frame is drawn, which only the picture would show: the game runs the same, and about half as fast again
	struct GBA* gba = core->board;
	gba->video.frameskip = gba->video.frameskipCounter = 1 << 30;
	return (struct ex_machine) { core, searchFrame, core->stateSize(core), searchSave, searchLoad, searchRead, searchSet };
}

static int findRoute(const char* path, const char* spec) {
	mLogSetDefaultLogger(&logger);
	searchedCopy = path;
	if (getenv("DP_PROVEN")) readProven(getenv("DP_PROVEN"));
	return exploreRoute(searchConsole(), searchConsole, spec, 2);
}

int main(int argc, char** argv) {
	onWindows(&argv);
	if (argc == 3 && !strcmp(argv[2], "live")) return playAlong(argv[1]);
	if (argc == 4 && !strcmp(argv[2], "route")) return findRoute(argv[1], argv[3]);
	if (argc != 9) {
		fprintf(stderr, "Usage: original ROM FRAMES BUTTONS FUNCTIONS PICTURES SOUND SETS STATES\n       original ROM live\n       original ROM route SPEC\n");
		return 2;
	}
	long frames = atol(argv[2]);
	size_t buttonsSize, functionsSize, picturesSize, setsSize, statesSize;
	uint16_t* buttons = readAll(argv[3], &buttonsSize);
	uint32_t* functions = readAll(argv[4], &functionsSize);
	uint32_t* pictures = readAll(argv[5], &picturesSize);
	uint32_t* sets = readAll(argv[7], &setsSize);
	uint32_t* states = readAll(argv[8], &statesSize);
	size_t functionCount = functionsSize / 24, pictureCount = picturesSize / 4, nextPicture = 0, setCount = setsSize / 16, nextSet = 0;
	size_t stateCount = statesSize / 4, nextState = 0;
	size_t readsSize = 0;
	uint32_t* reads = getenv("DP_READS") ? readAll(getenv("DP_READS"), &readsSize) : NULL;
	size_t readCount = readsSize / 12, nextRead = 0;
	uint32_t* readValues = calloc(readCount ? readCount : 1, sizeof(uint32_t));

	// the stretches of the work RAM whose hash to write as each frame ends, and the frame whose bytes to write too
	size_t memorySize = 0;
	uint32_t* memory = getenv("DP_MEMORY") ? readAll(getenv("DP_MEMORY"), &memorySize) : NULL;
	size_t stretchCount = memorySize >= 4 ? (memorySize - 4) / 8 : 0, memoryBytes = 0;
	FILE* memoryOut = NULL;
	uint8_t* memoryKept = NULL;
	if (memory) {
		char name[1024];
		snprintf(name, sizeof name, "%s.out", getenv("DP_MEMORY"));
		memoryOut = fopen(name, "wb");
		if (!memoryOut) { fprintf(stderr, "Can't write %s\n", name); exit(2); }
		for (size_t i = 0; i < stretchCount; i++) memoryBytes += memory[2 + i * 2];
		memoryKept = malloc(memoryBytes ? memoryBytes : 1);
	}

	// the code that runs in the work RAM, for the code map, and what last ran at each of its addresses
	FILE* ramCode = getenv("DP_RAM_CODE") ? fopen(getenv("DP_RAM_CODE"), "wb") : NULL;
	if (getenv("DP_RAM_CODE") && !ramCode) { fprintf(stderr, "Can't write %s\n", getenv("DP_RAM_CODE")); exit(2); }

	if (getenv("DP_PLAYED")) ranOpen(getenv("DP_PLAYED"));

	FILE* playedCode = played.file && getenv("DP_PLAYED_CODE") ? fopen(getenv("DP_PLAYED_CODE"), "wb") : NULL;
	uint8_t* codeWritten = calloc(functionsSize / 24 + 1, 1);

	// where each function starts, as the first of the functions there (its place in FUNCTIONS + 1) and the next after
	// each, which addresses are inside one, and code seen outside them all
	for (size_t i = 0; i < REGIONS; i++) {
		regions[i].first = calloc(regions[i].size / 2, sizeof(uint32_t));
		regions[i].inside = calloc(regions[i].size / 2, 1);
		regions[i].outside = calloc(regions[i].size / 2, 1);
		if (ramCode && i) {
			regions[i].lastCode = calloc(regions[i].size / 2, sizeof(uint32_t));
			regions[i].ranCode = calloc(regions[i].size / 2, 1);
		}
	}
	uint32_t* nextThere = calloc(functionCount ? functionCount : 1, sizeof(uint32_t));
	size_t places = 1;
	for (size_t i = 0; i < functionCount; i++) {
		uint32_t start = functions[i * 6] & ~1u, size = functions[i * 6 + 1];
		if (functions[i * 6 + 2] + 1 > places) places = functions[i * 6 + 2] + 1;
		struct region* region = regionOf(start);
		if (!region) continue;
		uint32_t* there = &region->first[(start - region->base) / 2];
		nextThere[i] = *there;
		*there = i + 1;
		for (uint32_t at = start; at < start + size && at - region->base < region->size; at += 2) {
			region->inside[(at - region->base) / 2] = 1;
		}
	}
	long* lastRan = calloc(places, sizeof(long));
	uint32_t* ran = malloc(places * sizeof(uint32_t));
	for (size_t i = 0; i < places; i++) lastRan[i] = -1;

	struct mCore* core = openCopy(argv[1]);
	FILE* soundFile = NULL;
	if (strcmp(argv[6], "-")) {
		soundFile = fopen(argv[6], "wb");
		if (!soundFile) { fprintf(stderr, "Can't write %s\n", argv[6]); exit(2); }
		hearSound(core);
	}
	core->reset(core);
	struct ARMCore* cpu = core->cpu;
	struct GBA* gba = core->board;

	if (getenv("DP_CONTENT")) {
		usedOpen(getenv("DP_CONTENT"), (uint32_t) gba->memory.romSize);
		usedWatch(cpu);
	}
	if (getenv("DP_WHY")) watchWhy(cpu, getenv("DP_WHY"));
	// the save memory as the last frame left it
	FILE* saves = getenv("DP_SAVES") ? fopen(getenv("DP_SAVES"), "wb") : NULL;
	if (getenv("DP_SAVES") && !saves) { fprintf(stderr, "Can't write %s\n", getenv("DP_SAVES")); exit(2); }
	uint8_t* saved = NULL;
	size_t savedSize = 0;

	for (long frame = 0; frame < frames; frame++) {
		usedFrame(frame);
		core->setKeys(core, (size_t) frame < buttonsSize / 2 ? buttons[frame] : 0);
		for (; nextSet < setCount && sets[nextSet * 4] == (uint32_t) frame; nextSet++) {
			setValue(core, sets[nextSet * 4 + 1], sets[nextSet * 4 + 2], sets[nextSet * 4 + 3]);
		}
		uint32_t count = 0;
		int32_t frameCounter = gba->video.frameCounter;
		// one instruction at a time, to see each function start. A run with none to see keeps to the same steps, as the
		// emulator's own loop ends a frame an instruction sooner, and the game's frames then come out differently
		while (gba->video.frameCounter == frameCounter) {
			while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
			struct played* now = NULL;
			uint32_t next = 0;
			struct region* region = functionCount || ramCode || played.file ? regionOf(cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM)) : NULL;
			if (region) {
				int thumb = cpu->executionMode == MODE_THUMB;
				uint32_t pc = cpu->gprs[ARM_PC] - (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
				uint32_t slot = (pc - region->base) / 2;
				// the first function starting here whose bytes are those it was found with
				for (uint32_t there = region->first[slot]; there; there = nextThere[there - 1]) {
					const uint32_t* watched = &functions[(there - 1) * 6];
					if (watched[3] & 1 && !sameBytes(core, pc, watched[4], watched[5])) continue;
					if (playedCode && watched[3] & 1 && !codeWritten[there - 1]) {
						codeWritten[there - 1] = 1;
						uint32_t head[3] = { watched[2], pc, watched[1] };
						fwrite(head, 4, 3, playedCode);
						for (uint32_t at = 0; at < watched[1]; at += 4) {
							uint32_t word = core->rawRead32(core, pc + at, -1);
							fwrite(&word, 4, 1, playedCode);
						}
					}
					if (lastRan[watched[2]] != frame) {
						lastRan[watched[2]] = frame;
						ran[count++] = watched[2];
					}
					break;
				}
				if (!region->inside[slot] && !region->outside[slot]) {
					region->outside[slot] = 1;
					region->seen++;
				}
				if (played.file) now = ranBefore(core, frame, &next);
				if (region->lastCode) {
					uint32_t code = thumb ? core->rawRead16(core, pc, -1) : core->rawRead32(core, pc, -1);
					if (!region->ranCode[slot] || region->lastCode[slot] != code) {
						region->ranCode[slot] = 1;
						region->lastCode[slot] = code;
						uint32_t record[3] = { (uint32_t) frame, pc | (uint32_t) thumb, code };
						fwrite(record, 4, 3, ramCode);
					}
				}
			}
			if (why.file) runWhy(cpu, frame);
			else ARMRun(cpu);
			ranAfter(cpu, now, next, frame);
		}
		usedEndFrame();
		if (saves) {
			// the game's first use of its save memory tells the emulator what kind it is, and so how big
			size_t size = gba->memory.savedata.data ? GBASavedataSize(&gba->memory.savedata) : 0;
			if (size != savedSize) {
				saved = realloc(saved, size ? size : 1);
				memset(saved, 0xFF, size);
				// a game that started from a save has that in it before it writes anything
				if (startSave) memcpy(saved, startSave, startSaveSize < size ? startSaveSize : size);
				savedSize = size;
			}
			if (size && memcmp(saved, gba->memory.savedata.data, size)) {
				memcpy(saved, gba->memory.savedata.data, size);
				uint32_t head[2] = { (uint32_t) frame, (uint32_t) size }, none = 0;
				fwrite(head, 4, 2, saves);
				fwrite(saved, 1, size, saves);
				if (size % 4) fwrite(&none, 1, 4 - size % 4, saves);
			}
		}
		for (; nextRead < readCount && reads[nextRead * 3] == (uint32_t) frame; nextRead++) {
			readValues[nextRead] = readValue(core, reads[nextRead * 3 + 1], reads[nextRead * 3 + 2]);
		}
		if (memoryOut) {
			uint32_t held = 0x811C9DC5;
			size_t kept = 0;
			for (size_t i = 0; i < stretchCount; i++) {
				uint32_t length = memory[2 + i * 2];
				const uint8_t* bytes = workMemory(gba, memory[1 + i * 2], length);
				for (uint32_t at = 0; at < length; at++) held = (held ^ bytes[at]) * 0x01000193;
				if (memory[0] == (uint32_t) frame) memcpy(memoryKept + kept, bytes, length);
				kept += length;
			}
			fwrite(&held, 4, 1, memoryOut);
		}
		uint32_t hash, plain;
		draw(&hash, &plain);
		fwrite(&hash, 4, 1, stdout);
		fwrite(&plain, 4, 1, stdout);
		fwrite(&count, 4, 1, stdout);
		fwrite(ran, 4, count, stdout);
		while (nextPicture < pictureCount && pictures[nextPicture] < (uint32_t) frame) nextPicture++;
		if (nextPicture < pictureCount && pictures[nextPicture] == (uint32_t) frame) fwrite(picture, 2, WIDTH * HEIGHT, stdout);
		while (nextState < stateCount && states[nextState] < (uint32_t) frame) nextState++;
		if (nextState < stateCount && states[nextState] == (uint32_t) frame) writeState(core->board);
		if (soundFile) {
			uint32_t samples = sound.count / 2;
			fwrite(&samples, 4, 1, soundFile);
			fwrite(sound.samples, 2, sound.count, soundFile);
			sound.count = 0;
		}
	}
	fflush(stdout);
	if (soundFile) fclose(soundFile);
	if (ramCode) fclose(ramCode);
	if (saves) fclose(saves);
	if (memoryOut) {
		if (memory[0] < (uint32_t) frames) fwrite(memoryKept, 1, memoryBytes, memoryOut);
		fclose(memoryOut);
	}
	usedClose();
	ranClose();
	if (playedCode) fclose(playedCode);
	fprintf(stderr, "{\"cartridge\":%ld,\"memory\":%ld,\"reads\":[", regions[0].seen, regions[1].seen + regions[2].seen);
	for (size_t i = 0; i < readCount; i++) fprintf(stderr, "%s%u", i ? "," : "", readValues[i]);
	fprintf(stderr, "]}\n");
	if (why.file) {
		for (uint32_t slot = 0; slot < WHY_SLOTS; slot++) if (why.records[slot][8]) fwrite(why.records[slot], 4, 12, why.file);
		for (size_t i = 0; i < why.targetCount; i++) {
			for (int way = 0; way < 2; way++) {
				uint32_t record[12] = { 0, 0, 0, 0, 0, 0, 0, way ? NOT_TAKEN : TAKEN, why.more[i][way], why.more[i][2], why.targets[i], 1 };
				if (why.more[i][way]) fwrite(record, 4, 12, why.file);
			}
		}
		fclose(why.file);
	}
	core->deinit(core);
	return 0;
}
