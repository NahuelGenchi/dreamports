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
// original ROM live
//   Plays along with a person, for capture: for each frame it reads the buttons held from stdin (16 bits, as in
//   BUTTONS), runs the frame just as above, and writes to stdout its picture, how many samples of sound it made, then
//   each sample, as SOUND has them. It ends when stdin does.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "on-windows.h"
#include "explore.h"

#define WIDTH 240
#define HEIGHT 160

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

// The parts of the console's memory code can run from: the cartridge (ROM), and the work RAM games copy code into.
struct region { uint32_t base, size; uint32_t* first; uint8_t* inside; uint8_t* outside; long seen; uint32_t* lastCode; uint8_t* ranCode; uint32_t* played; };
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

// What ran, for DP_PLAYED: an instruction, with the stretch of frames each thing that can happen at it is in the middle of
enum { RAN, TAKEN, NOT_TAKEN, HAPPENINGS };
struct played { uint32_t address, code, start[HAPPENINGS]; long last[HAPPENINGS]; };
static struct { FILE* file; struct played* list; size_t count, capacity; } played;

static void writeStretch(const struct played* p, int what) {
	uint32_t record[5] = { p->address, p->code, (uint32_t) what, p->start[what], (uint32_t) p->last[what] };
	fwrite(record, 4, 5, played.file);
}

// an instruction's stretches so far, written and begun again, as when its address holds other bytes
static void endStretches(struct played* p) {
	for (int what = 0; what < HAPPENINGS; what++) {
		if (p->last[what] >= 0) writeStretch(p, what);
		p->last[what] = -1;
	}
}

static void happened(struct played* p, int what, long frame) {
	if (p->last[what] == frame) return;
	if (p->last[what] != frame - 1) {
		if (p->last[what] >= 0) writeStretch(p, what);
		p->start[what] = (uint32_t) frame;
	}
	p->last[what] = frame;
}

// the instruction at `pc`, as the list has it: new the first time it runs, and begun again with other bytes there
static struct played* playedAt(struct mCore* core, struct region* region, uint32_t pc, int thumb) {
	uint32_t* at = &region->played[(pc - region->base) / 2];
	int ram = region->base != 0x08000000;
	if (*at && !ram) return &played.list[*at - 1];
	uint32_t code = thumb ? core->rawRead16(core, pc, -1) : core->rawRead32(core, pc, -1);
	if (*at) {
		struct played* p = &played.list[*at - 1];
		if (p->code == code && p->address == (pc | (uint32_t) thumb)) return p;
		endStretches(p);
		p->address = pc | (uint32_t) thumb;
		p->code = code;
		return p;
	}
	if (played.count == played.capacity) {
		played.capacity = played.capacity ? played.capacity * 2 : 1 << 16;
		played.list = realloc(played.list, played.capacity * sizeof(struct played));
	}
	struct played* p = &played.list[played.count++];
	p->address = pc | (uint32_t) thumb;
	p->code = code;
	for (int what = 0; what < HAPPENINGS; what++) p->last[what] = -1;
	*at = (uint32_t) played.count;
	return p;
}

// whether an instruction is a conditional branch: Thumb's B<cond>, or ARM's B or BL with a condition
static int branches(uint32_t code, int thumb) {
	if (thumb) return (code & 0xF000) == 0xD000 && (code >> 8 & 0xF) < 0xE;
	return (code & 0x0E000000) == 0x0A000000 && code >> 28 < 0xE;
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

// what the search needs of a console (lib/explore.h), for each one it runs
static void searchFrame(void* console, uint32_t buttons) {
	struct mCore* core = console;
	struct ARMCore* cpu = core->cpu;
	struct GBA* gba = core->board;
	core->setKeys(core, buttons);
	// an instruction at a time, as main plays every frame
	int32_t frameCounter = gba->video.frameCounter;
	while (gba->video.frameCounter == frameCounter) {
		while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
		ARMRun(cpu);
	}
}
static void searchSave(void* console, void* to) { ((struct mCore*) console)->saveState(console, to); }
static void searchLoad(void* console, const void* from) { ((struct mCore*) console)->loadState(console, from); }
static int searchRead(void* console, uint32_t address, uint32_t bytes, uint32_t* value) {
	struct mCore* core = console;
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

	// the code that runs in the work RAM, for the code map, and what last ran at each of its addresses
	FILE* ramCode = getenv("DP_RAM_CODE") ? fopen(getenv("DP_RAM_CODE"), "wb") : NULL;
	if (getenv("DP_RAM_CODE") && !ramCode) { fprintf(stderr, "Can't write %s\n", getenv("DP_RAM_CODE")); exit(2); }

	played.file = getenv("DP_PLAYED") ? fopen(getenv("DP_PLAYED"), "wb") : NULL;
	if (getenv("DP_PLAYED") && !played.file) { fprintf(stderr, "Can't write %s\n", getenv("DP_PLAYED")); exit(2); }

	FILE* playedCode = played.file && getenv("DP_PLAYED_CODE") ? fopen(getenv("DP_PLAYED_CODE"), "wb") : NULL;
	uint8_t* codeWritten = calloc(functionsSize / 24 + 1, 1);

	// where each function starts, as the first of the functions there (its place in FUNCTIONS + 1) and the next after
	// each, which addresses are inside one, and code seen outside them all
	for (size_t i = 0; i < REGIONS; i++) {
		regions[i].first = calloc(regions[i].size / 2, sizeof(uint32_t));
		regions[i].inside = calloc(regions[i].size / 2, 1);
		regions[i].outside = calloc(regions[i].size / 2, 1);
		if (played.file) regions[i].played = calloc(regions[i].size / 2, sizeof(uint32_t));
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

	for (long frame = 0; frame < frames; frame++) {
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
				if (played.file) {
					now = playedAt(core, region, pc, thumb);
					happened(now, RAN, frame);
					next = branches(now->code, thumb) ? pc + (thumb ? WORD_SIZE_THUMB : WORD_SIZE_ARM) : 0;
					if (!next) now = NULL;
				}
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
			ARMRun(cpu);
			// a conditional branch went one of its two ways
			if (now) {
				uint32_t pc = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
				happened(now, pc == next ? NOT_TAKEN : TAKEN, frame);
			}
		}
		for (; nextRead < readCount && reads[nextRead * 3] == (uint32_t) frame; nextRead++) {
			readValues[nextRead] = readValue(core, reads[nextRead * 3 + 1], reads[nextRead * 3 + 2]);
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
	if (played.file) {
		for (size_t i = 0; i < played.count; i++) endStretches(&played.list[i]);
		fclose(played.file);
		if (playedCode) fclose(playedCode);
	}
	fprintf(stderr, "{\"cartridge\":%ld,\"memory\":%ld,\"reads\":[", regions[0].seen, regions[1].seen + regions[2].seen);
	for (size_t i = 0; i < readCount; i++) fprintf(stderr, "%s%u", i ? "," : "", readValues[i]);
	fprintf(stderr, "]}\n");
	core->deinit(core);
	return 0;
}
