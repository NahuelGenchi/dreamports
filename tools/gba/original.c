// Runs the original game in mGBA, the reference the proof tools compare a Dreamport against, on the contributor's
// computer only. It plays the buttons it is given, one set per frame, and writes what each frame shows, what it
// sounds like and which of the game's functions ran in it. `npm run dp -- setup` builds it against mGBA's library
// (build.mjs).
//
// original ROM FRAMES BUTTONS FUNCTIONS PICTURES SOUND
//   ROM        the contributor's copy, only ever read
//   FRAMES     how many frames to run
//   BUTTONS    a file with the buttons held at each frame: 16 bits each, a bit per button as KEYINPUT has them
//   FUNCTIONS  a file with the code map's functions, each its address and its size (32 bits each), or -
//   PICTURES   a file with the frames whose whole picture to write (32 bits each, in order), or -
//   SOUND      a file to write each frame's sound to, or -
//
// For each frame it writes to stdout: a hash of the picture (FNV-1a over each pixel's 15-bit colour, as the
// console has it), the picture's one colour if every pixel has it or else 0xFFFFFFFF, the number of functions that
// ran in the frame and their places in FUNCTIONS (32 bits each), then the picture itself if PICTURES names the
// frame (240 x 160 pixels of 16 bits, the console's 15-bit colour).
// For each frame it writes to SOUND how many samples of the console's sound the frame made, then each sample, left
// and right (16 bits each): the mix of the four Game Boy channels and the two DirectSound FIFOs, as offsets around the
// bias in the console's 10-bit units, 65536 a second (every 256 cycles), the rate the sound library sets as it
// starts. Before that the console mixes every 512 cycles, and each of those samples is written twice.
// At the end it writes to stderr, as JSON, how many instructions ran outside every function of the code map: in the
// cartridge, and in the work RAM games copy code into.
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WIDTH 240
#define HEIGHT 160

static void quiet(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quiet };

// The parts of the console's memory code can run from: the cartridge (ROM), and the work RAM games copy code into.
struct region { uint32_t base, size; uint32_t* first; uint8_t* inside; uint8_t* outside; long seen; };
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

int main(int argc, char** argv) {
	if (argc != 7) {
		fprintf(stderr, "Usage: original ROM FRAMES BUTTONS FUNCTIONS PICTURES SOUND\n");
		return 2;
	}
	long frames = atol(argv[2]);
	size_t buttonsSize, functionsSize, picturesSize;
	uint16_t* buttons = readAll(argv[3], &buttonsSize);
	uint32_t* functions = readAll(argv[4], &functionsSize);
	uint32_t* pictures = readAll(argv[5], &picturesSize);
	size_t functionCount = functionsSize / 8, pictureCount = picturesSize / 4, nextPicture = 0;

	// where each function starts (its place + 1), which addresses are inside one, and code seen outside them all
	for (size_t i = 0; i < REGIONS; i++) {
		regions[i].first = calloc(regions[i].size / 2, sizeof(uint32_t));
		regions[i].inside = calloc(regions[i].size / 2, 1);
		regions[i].outside = calloc(regions[i].size / 2, 1);
	}
	for (size_t i = 0; i < functionCount; i++) {
		uint32_t start = functions[i * 2] & ~1u, size = functions[i * 2 + 1];
		struct region* region = regionOf(start);
		if (!region) continue;
		region->first[(start - region->base) / 2] = i + 1;
		for (uint32_t at = start; at < start + size && at - region->base < region->size; at += 2) {
			region->inside[(at - region->base) / 2] = 1;
		}
	}
	long* lastRan = calloc(functionCount ? functionCount : 1, sizeof(long));
	uint32_t* ran = malloc((functionCount ? functionCount : 1) * sizeof(uint32_t));
	for (size_t i = 0; i < functionCount; i++) lastRan[i] = -1;

	mLogSetDefaultLogger(&logger);
	struct mCore* core = GBACoreCreate();
	core->init(core);
	// no configuration from the computer: no BIOS file and default settings, the same on every computer
	mCoreInitConfig(core, NULL);
	static uint32_t video[WIDTH * HEIGHT];
	core->setVideoBuffer(core, (color_t*) video, WIDTH);
	if (!mCoreLoadFile(core, argv[1])) {
		fprintf(stderr, "mGBA can't open the copy\n");
		return 1;
	}
	FILE* soundFile = NULL;
	static struct sound sound;
	if (strcmp(argv[6], "-")) {
		soundFile = fopen(argv[6], "wb");
		if (!soundFile) { fprintf(stderr, "Can't write %s\n", argv[6]); exit(2); }
		sound.stream.postAudioFrame = heard;
		sound.gba = core->board;
		core->setAVStream(core, &sound.stream);
	}
	core->reset(core);
	struct ARMCore* cpu = core->cpu;
	static uint16_t picture[WIDTH * HEIGHT];

	for (long frame = 0; frame < frames; frame++) {
		core->setKeys(core, (size_t) frame < buttonsSize / 2 ? buttons[frame] : 0);
		uint32_t count = 0;
		uint32_t frameCounter = core->frameCounter(core);
		// one instruction at a time, to see each function start
		while (core->frameCounter(core) == frameCounter) {
			while (cpu->cycles >= cpu->nextEvent) cpu->irqh.processEvents(cpu);
			uint32_t pc = cpu->gprs[ARM_PC] - (cpu->executionMode == MODE_THUMB ? WORD_SIZE_THUMB : WORD_SIZE_ARM);
			struct region* region = regionOf(pc);
			if (region) {
				uint32_t slot = (pc - region->base) / 2, function = region->first[slot];
				if (function && lastRan[function - 1] != frame) {
					lastRan[function - 1] = frame;
					ran[count++] = function - 1;
				}
				if (!region->inside[slot] && !region->outside[slot]) {
					region->outside[slot] = 1;
					region->seen++;
				}
			}
			core->step(core);
		}
		uint32_t hash = 0x811C9DC5, plain = 0;
		for (int i = 0; i < WIDTH * HEIGHT; i++) {
			uint32_t pixel = video[i];
			uint16_t colour = ((pixel >> 3) & 0x1F) | (((pixel >> 11) & 0x1F) << 5) | (((pixel >> 19) & 0x1F) << 10);
			picture[i] = colour;
			hash = (hash ^ colour) * 0x01000193;
			if (!i) plain = colour;
			else if (colour != plain) plain = 0xFFFFFFFF;
		}
		fwrite(&hash, 4, 1, stdout);
		fwrite(&plain, 4, 1, stdout);
		fwrite(&count, 4, 1, stdout);
		fwrite(ran, 4, count, stdout);
		while (nextPicture < pictureCount && pictures[nextPicture] < (uint32_t) frame) nextPicture++;
		if (nextPicture < pictureCount && pictures[nextPicture] == (uint32_t) frame) fwrite(picture, 2, WIDTH * HEIGHT, stdout);
		if (soundFile) {
			uint32_t samples = sound.count / 2;
			fwrite(&samples, 4, 1, soundFile);
			fwrite(sound.samples, 2, sound.count, soundFile);
			sound.count = 0;
		}
	}
	fflush(stdout);
	if (soundFile) fclose(soundFile);
	fprintf(stderr, "{\"cartridge\":%ld,\"memory\":%ld}\n", regions[0].seen, regions[1].seen + regions[2].seen);
	core->deinit(core);
	return 0;
}
