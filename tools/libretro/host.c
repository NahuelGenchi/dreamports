// Plays the original of any console with a libretro core: the core is a small emulator with one way of being driven, so
// this one program drives them all, and writes what tools/gba/original.c writes, for the same tools.
//
// host CORE ROM FRAMES BUTTONS - PICTURES SOUND SETS - WIDTH HEIGHT [KEY=VALUE…]
// host CORE ROM live WIDTH HEIGHT [KEY=VALUE…]
//
// BUTTONS holds each frame's buttons, 32 bits each, PICTURES the frames whose picture is wanted, SETS the values to write
// to the console's work memory ({ frame, address, bytes, value }, 32 bits each) and KEY=VALUE the core's settings. For
// each frame it writes to stdout: a hash of the picture (FNV-1a over each pixel's 15-bit colour, as lib/in-page.js hashes
// the Dreamport's), its one colour if it has only one or else -1, a 0, as no functions are seen through a core, and the
// picture if it's wanted, WIDTH x HEIGHT, cut or filled with black when the core's screen is another size. To SOUND it
// writes each frame's sample count and its samples, left and right, in the same 10-bit units as the Game Boy Advance's.
// `live` plays along with a person: each frame's buttons come in on stdin, and out goes its picture, its sample count
// and its samples. Its last line on stderr says what the core runs at, as JSON. What the core prints goes nowhere.
//
// On a console whose games choose their own sound's rate, as a Nintendo 64's do, the core says when it changes, and the
// environment's DP_SOUND_RATE gives the one rate the tools hear it at.

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#define dlopen(path, flags) LoadLibraryA(path)
#define dlsym(lib, name) ((void*) GetProcAddress((HMODULE) (lib), name))
#define dup _dup
#define dup2 _dup2
#define NULL_FILE "NUL"
#else
#include <dlfcn.h>
#include <unistd.h>
#define NULL_FILE "/dev/null"
#endif

// what's used of libretro's interface (libretro.h, MIT licence), which every core keeps the same
#define ENV_GET_CAN_DUPE 3
#define ENV_SHUTDOWN 7
#define ENV_GET_SYSTEM_DIRECTORY 9
#define ENV_SET_PIXEL_FORMAT 10
#define ENV_SET_HW_RENDER 14
#define ENV_GET_VARIABLE 15
#define ENV_SET_VARIABLES 16
#define ENV_GET_VARIABLE_UPDATE 17
#define ENV_GET_LOG_INTERFACE 27
#define ENV_GET_SAVE_DIRECTORY 31
#define ENV_SET_SYSTEM_AV_INFO 32
#define ENV_SET_GEOMETRY 37
#define ENV_GET_INPUT_BITMASKS 51
#define ENV_GET_CORE_OPTIONS_VERSION 52
#define DEVICE_JOYPAD 1
#define DEVICE_ANALOG 5
#define JOYPAD_MASK 256
#define MEMORY_SYSTEM_RAM 2
#define HW_FRAME ((const void*) -1)

struct game_info { const char* path; const void* data; size_t size; const char* meta; };
struct system_info { const char* name; const char* version; const char* extensions; bool needsPath; bool blockExtract; };
struct av_info { unsigned baseWidth, baseHeight, maxWidth, maxHeight; float aspect; double fps, sampleRate; };
struct variable { const char* key; const char* value; };
struct log_callback { void (*log)(int level, const char* format, ...); };

typedef bool (*environment_t)(unsigned, void*);
static void (*retro_init)(void);
static void (*retro_get_system_info)(struct system_info*);
static void (*retro_get_system_av_info)(struct av_info*);
static void (*retro_set_environment)(environment_t);
static void (*retro_set_video_refresh)(void (*)(const void*, unsigned, unsigned, size_t));
static void (*retro_set_audio_sample)(void (*)(int16_t, int16_t));
static void (*retro_set_audio_sample_batch)(size_t (*)(const int16_t*, size_t));
static void (*retro_set_input_poll)(void (*)(void));
static void (*retro_set_input_state)(int16_t (*)(unsigned, unsigned, unsigned, unsigned));
static void (*retro_set_controller_port_device)(unsigned, unsigned);
static bool (*retro_load_game)(const struct game_info*);
static void (*retro_run)(void);
static void* (*retro_get_memory_data)(unsigned);
static size_t (*retro_get_memory_size)(unsigned);

static FILE* out;
static FILE* err;
static int format = 0;   // 0RGB1555, as a core has until it asks for another
static uint32_t held;
static uint16_t* screen;
static unsigned screenW, screenH, wantedW, wantedH;
static int16_t* samples;
static size_t sampleCount, sampleRoom;
static uint16_t* picture;
static const char** settings;
static int settingCount;
static struct variable* variables;
static size_t variableCount;
static const char* systemFolder;
static const char* saveFolder;
static bool needsGraphics;
static struct av_info av;   // what the core runs at, the last it said
static double wantedRate, soundAt;   // the rate the tools hear at, or 0 for the core's own, and how far between two samples
static int16_t soundBefore[2];

static void* readAll(const char* path, size_t* size) {
	*size = 0;
	FILE* file = fopen(path, "rb");
	if (!file) return NULL;
	fseek(file, 0, SEEK_END);
	long length = ftell(file);
	fseek(file, 0, SEEK_SET);
	void* bytes = malloc(length ? length : 1);
	if (fread(bytes, 1, length, file) != (size_t) length) exit(1);
	fclose(file);
	*size = length;
	return bytes;
}

static void quiet(int level, const char* text, ...) {
	(void) level;
	(void) text;
}

static bool environment(unsigned command, void* data) {
	switch (command & 0xFFFF) {
	case ENV_GET_CAN_DUPE: *(bool*) data = true; return true;
	case ENV_GET_SYSTEM_DIRECTORY: *(const char**) data = systemFolder; return true;
	case ENV_GET_SAVE_DIRECTORY: *(const char**) data = saveFolder; return true;
	case ENV_SET_PIXEL_FORMAT: format = *(int*) data; return true;
	case ENV_GET_LOG_INTERFACE: ((struct log_callback*) data)->log = quiet; return true;
	case ENV_GET_VARIABLE_UPDATE: *(bool*) data = false; return true;
	case ENV_GET_INPUT_BITMASKS: return true;
	case ENV_GET_CORE_OPTIONS_VERSION: *(unsigned*) data = 0; return true;
	case ENV_SET_VARIABLES: {
		const struct variable* list = data;
		variableCount = 0;
		while (list[variableCount].key) variableCount++;
		variables = malloc(sizeof(struct variable) * (variableCount + 1));
		for (size_t i = 0; i < variableCount; i++) {
			// "What it does; first|second": the first is its default
			const char* choices = strchr(list[i].value, ';');
			choices = choices ? choices + 1 : list[i].value;
			while (*choices == ' ') choices++;
			const char* end = strchr(choices, '|');
			size_t length = end ? (size_t) (end - choices) : strlen(choices);
			char* first = malloc(length + 1);
			memcpy(first, choices, length);
			first[length] = 0;
			variables[i].key = list[i].key;
			variables[i].value = first;
		}
		return true;
	}
	case ENV_GET_VARIABLE: {
		struct variable* wanted = data;
		wanted->value = NULL;
		size_t length = strlen(wanted->key);
		for (int i = 0; i < settingCount; i++) {
			if (!strncmp(settings[i], wanted->key, length) && settings[i][length] == '=') {
				wanted->value = settings[i] + length + 1;
				return true;
			}
		}
		for (size_t i = 0; i < variableCount; i++) {
			if (!strcmp(variables[i].key, wanted->key)) {
				wanted->value = variables[i].value;
				return true;
			}
		}
		return false;
	}
	case ENV_SET_HW_RENDER: needsGraphics = true; return false;
	case ENV_SET_SYSTEM_AV_INFO: av = *(struct av_info*) data; return true;
	case ENV_SET_GEOMETRY: return true;
	default: return false;
	}
}

// the frame in 15-bit colour, red in its low bits, as the browser's pixels reduce to
static void videoRefresh(const void* data, unsigned width, unsigned height, size_t pitch) {
	if (!data || data == HW_FRAME) return;
	if (width * height > screenW * screenH || !screen) screen = realloc(screen, width * height * 2);
	screenW = width;
	screenH = height;
	for (unsigned y = 0; y < height; y++) {
		const uint8_t* row = (const uint8_t*) data + y * pitch;
		uint16_t* to = screen + y * width;
		if (format == 1) {
			const uint32_t* from = (const uint32_t*) row;
			for (unsigned x = 0; x < width; x++) to[x] = (from[x] >> 19 & 31) | (from[x] >> 11 & 31) << 5 | (from[x] >> 3 & 31) << 10;
		} else if (format == 2) {
			const uint16_t* from = (const uint16_t*) row;
			for (unsigned x = 0; x < width; x++) to[x] = (from[x] >> 11 & 31) | (from[x] >> 6 & 31) << 5 | (from[x] & 31) << 10;
		} else {
			const uint16_t* from = (const uint16_t*) row;
			for (unsigned x = 0; x < width; x++) to[x] = (from[x] >> 10 & 31) | (from[x] >> 5 & 31) << 5 | (from[x] & 31) << 10;
		}
	}
}

static void keepSamples(const int16_t* data, size_t frames) {
	if (sampleCount + frames * 2 > sampleRoom) {
		sampleRoom = (sampleCount + frames * 2) * 2;
		samples = realloc(samples, sampleRoom * 2);
	}
	// 10-bit units, 512 being as loud as the mix goes, so that "quieter than one step" means the same on every console
	for (size_t i = 0; i < frames * 2; i++) samples[sampleCount + i] = data[i] >> 6;
	sampleCount += frames * 2;
}

static size_t audioBatch(const int16_t* data, size_t frames) {
	if (!wantedRate || av.sampleRate == wantedRate) {
		keepSamples(data, frames);
	} else {
		// at the rate the tools hear at, on a straight line between each two of the core's samples
		double step = av.sampleRate / wantedRate;
		for (size_t i = 0; i < frames; i++) {
			const int16_t* now = data + i * 2;
			for (; soundAt < 1; soundAt += step) {
				int16_t pair[2] = { soundBefore[0] + (now[0] - soundBefore[0]) * soundAt, soundBefore[1] + (now[1] - soundBefore[1]) * soundAt };
				keepSamples(pair, 1);
			}
			soundAt -= 1;
			memcpy(soundBefore, now, sizeof soundBefore);
		}
	}
	return frames;
}

static void audioSample(int16_t left, int16_t right) {
	int16_t pair[2] = { left, right };
	audioBatch(pair, 1);
}

static void inputPoll(void) {}

static int16_t inputState(unsigned port, unsigned device, unsigned index, unsigned id) {
	if (port) return 0;
	if (device == DEVICE_JOYPAD) {
		if (id == JOYPAD_MASK) return held & 0xFFFF;
		return id < 16 ? (held >> id) & 1 : 0;
	}
	if (device == DEVICE_ANALOG && index < 2 && id < 2) {
		// the sticks' directions, all the way over: the bits after the 16 buttons, left, right, up, down for each stick
		uint32_t bits = held >> (16 + index * 4 + id * 2);
		return (bits & 2 ? 0x7FFF : 0) + (bits & 1 ? -0x7FFF : 0);
	}
	return 0;
}

static void hashOf(uint32_t* hash, uint32_t* plain) {
	*hash = 0x811C9DC5;
	uint32_t pixels = screenW * screenH;
	*plain = pixels ? screen[0] : 0xFFFFFFFF;
	for (uint32_t p = 0; p < pixels; p++) {
		*hash = (*hash ^ screen[p]) * 0x01000193;
		if (screen[p] != *plain) *plain = 0xFFFFFFFF;
	}
}

// the picture at the console's size, whatever size the core's is
static void writePicture(void) {
	for (unsigned y = 0; y < wantedH; y++) {
		for (unsigned x = 0; x < wantedW; x++) picture[y * wantedW + x] = x < screenW && y < screenH ? screen[y * screenW + x] : 0;
	}
	fwrite(picture, 2, wantedW * wantedH, out);
}

static void* find(void* library, const char* name) {
	void* found = dlsym(library, name);
	if (!found) {
		fprintf(err, "The core has no %s.\n", name);
		exit(2);
	}
	return found;
}

int main(int argc, char** argv) {
	bool live = argc >= 6 && !strcmp(argv[3], "live");
	if (argc < (live ? 6 : 12)) {
		fprintf(stderr, "Usage: host CORE ROM FRAMES BUTTONS - PICTURES SOUND SETS - WIDTH HEIGHT [KEY=VALUE…]\n       host CORE ROM live WIDTH HEIGHT [KEY=VALUE…]\n");
		return 2;
	}
	// what the core prints goes nowhere: stdout is for the tools alone
	out = fdopen(dup(1), "wb");
	err = fdopen(dup(2), "w");
#ifdef _WIN32
	_setmode(_fileno(out), _O_BINARY);
	_setmode(_fileno(stdin), _O_BINARY);
#endif
	FILE* nothing = fopen(NULL_FILE, "w");
	dup2(fileno(nothing), 1);
	dup2(fileno(nothing), 2);
	static char outBuffer[1 << 16];
	setvbuf(out, outBuffer, _IOFBF, sizeof outBuffer);

	int at = live ? 4 : 10;
	wantedW = atoi(argv[at]);
	wantedH = atoi(argv[at + 1]);
	settings = (const char**) argv + at + 2;
	settingCount = argc - at - 2;
	picture = malloc(wantedW * wantedH * 2);
	systemFolder = getenv("DP_SYSTEM") ? getenv("DP_SYSTEM") : ".";
	saveFolder = getenv("DP_SAVES") ? getenv("DP_SAVES") : ".";

	void* library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
	if (!library) {
		fprintf(err, "The core wouldn't load.\n");
		return 2;
	}
	retro_init = find(library, "retro_init");
	retro_get_system_info = find(library, "retro_get_system_info");
	retro_get_system_av_info = find(library, "retro_get_system_av_info");
	retro_set_environment = find(library, "retro_set_environment");
	retro_set_video_refresh = find(library, "retro_set_video_refresh");
	retro_set_audio_sample = find(library, "retro_set_audio_sample");
	retro_set_audio_sample_batch = find(library, "retro_set_audio_sample_batch");
	retro_set_input_poll = find(library, "retro_set_input_poll");
	retro_set_input_state = find(library, "retro_set_input_state");
	retro_set_controller_port_device = find(library, "retro_set_controller_port_device");
	retro_load_game = find(library, "retro_load_game");
	retro_run = find(library, "retro_run");
	retro_get_memory_data = find(library, "retro_get_memory_data");
	retro_get_memory_size = find(library, "retro_get_memory_size");

	retro_set_environment(environment);
	retro_set_video_refresh(videoRefresh);
	retro_set_audio_sample(audioSample);
	retro_set_audio_sample_batch(audioBatch);
	retro_set_input_poll(inputPoll);
	retro_set_input_state(inputState);
	retro_init();

	struct system_info info = { 0 };
	retro_get_system_info(&info);
	struct game_info game = { .path = argv[2] };
	size_t size = 0;
	if (!info.needsPath) {
		game.data = readAll(argv[2], &size);
		game.size = size;
	}
	if (!retro_load_game(&game)) {
		fprintf(err, needsGraphics ? "The core needs a graphics context, which the tools don't offer yet.\n" : "The core wouldn't load this copy, or needs a system file of the console's that isn't there.\n");
		return 2;
	}
	retro_set_controller_port_device(0, DEVICE_JOYPAD);
	retro_get_system_av_info(&av);
	wantedRate = getenv("DP_SOUND_RATE") ? atof(getenv("DP_SOUND_RATE")) : 0;

	if (live) {
		uint32_t buttons;
		while (fread(&buttons, 4, 1, stdin) == 1) {
			held = buttons;
			sampleCount = 0;
			retro_run();
			writePicture();
			uint32_t count = sampleCount / 2;
			fwrite(&count, 4, 1, out);
			fwrite(samples, 2, sampleCount, out);
			fflush(out);
		}
		return 0;
	}

	long frames = atol(argv[3]);
	size_t buttonsSize, picturesSize, setsSize;
	uint32_t* buttons = readAll(argv[4], &buttonsSize);
	uint32_t* pictures = readAll(argv[6], &picturesSize);
	uint32_t* sets = readAll(argv[8], &setsSize);
	size_t pictureCount = picturesSize / 4, nextPicture = 0, setCount = setsSize / 16, nextSet = 0;
	FILE* soundFile = strcmp(argv[7], "-") ? fopen(argv[7], "wb") : NULL;
	uint8_t* memory = retro_get_memory_data(MEMORY_SYSTEM_RAM);
	size_t memorySize = retro_get_memory_size(MEMORY_SYSTEM_RAM);

	for (long frame = 0; frame < frames; frame++) {
		held = (size_t) frame < buttonsSize / 4 ? buttons[frame] : 0;
		for (; nextSet < setCount && sets[nextSet * 4] == (uint32_t) frame; nextSet++) {
			uint32_t address = sets[nextSet * 4 + 1], bytes = sets[nextSet * 4 + 2], value = sets[nextSet * 4 + 3];
			for (uint32_t i = 0; i < bytes && memory && address + i < memorySize; i++) memory[address + i] = value >> (i * 8);
		}
		sampleCount = 0;
		retro_run();
		uint32_t hash, plain, none = 0;
		hashOf(&hash, &plain);
		fwrite(&hash, 4, 1, out);
		fwrite(&plain, 4, 1, out);
		fwrite(&none, 4, 1, out);
		if (nextPicture < pictureCount && pictures[nextPicture] == (uint32_t) frame) {
			writePicture();
			nextPicture++;
		}
		if (soundFile) {
			uint32_t count = sampleCount / 2;
			fwrite(&count, 4, 1, soundFile);
			fwrite(samples, 2, sampleCount, soundFile);
		}
	}
	if (soundFile) fclose(soundFile);
	fflush(out);
	fprintf(err, "{\"cartridge\":0,\"memory\":0,\"rate\":%g,\"fps\":%g,\"width\":%u,\"height\":%u}\n", wantedRate ? wantedRate : av.sampleRate, av.fps, screenW, screenH);
	fflush(err);
	return 0;
}
