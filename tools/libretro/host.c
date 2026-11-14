// Plays the original of any console with a libretro core: the core is a small emulator with one way of being driven, so
// this one program drives them all, and writes what tools/gba/original.c writes, for the same tools.
//
// host CORE ROM FRAMES BUTTONS - PICTURES SOUND SETS - WIDTH HEIGHT [KEY=VALUE…]
// host CORE ROM live WIDTH HEIGHT [KEY=VALUE…]
// host CORE ROM route SPEC [KEY=VALUE…]
//
// BUTTONS holds each frame's buttons, 32 bits each, PICTURES the frames whose picture is wanted, SETS the values to write
// to the console's work memory ({ frame, address, bytes, value }, 32 bits each) and KEY=VALUE the core's settings. For
// each frame it writes to stdout: a hash of the picture (FNV-1a over each pixel's 15-bit colour, then its width and height,
// as lib/in-page.js hashes the Dreamport's), its one colour if it has only one or else -1, a 0, as no functions are seen
// through a core, and the picture if it's wanted, WIDTH x HEIGHT, cut or filled with black when the core's screen is another
// size. To SOUND it writes each frame's sample count and its samples, left and right, in the same 10-bit units as the Game
// Boy Advance's. `live` plays along with a person: each frame's buttons come in on stdin, and out goes its picture, the size
// the core's picture really has, its sample count and its samples. Its last line on stderr says what the core runs at and
// each size its picture had, from which frame, as JSON. What the core prints goes nowhere.
//
// The environment's DP_READS, when it's set, names a file of values to read from the console's work memory as a frame
// ends, in the order of their frames: each its frame, its address and how many bytes (32 bits each), little-endian. The
// JSON on stderr then has them, in that order, under "reads", which is how the tools learn what the original holds.
//
// `route` finds the buttons that take the game to a goal, for the route finder (tools/route.mjs): SPEC is a file that says
// what to search for, as lib/explore.h reads it, and it prints how far it has got. It needs a core that can copy its state
// out and bring it back, as nearly all can, and searches with one console, as a core is one console.
//
// On a console whose games choose their own sound's rate, as a Nintendo 64's do, the core says when it changes, and the
// environment's DP_SOUND_RATE gives the one rate the tools hear it at.
//
// A core that draws with OpenGL, as the PlayStation 2's does, gets a graphics context with no window, from EGL, on Mesa's
// llvmpipe, which draws on the processor, so a picture doesn't depend on the computer's graphics card. It stops with a
// sentence on a computer that can't give one, which so far is any but Linux.

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

#include "explore.h"

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

#define CONTEXT_OPENGL 1
#define CONTEXT_OPENGLES2 2
#define CONTEXT_OPENGL_CORE 3
#define CONTEXT_OPENGLES3 4
#define CONTEXT_OPENGLES_VERSION 5

struct game_info { const char* path; const void* data; size_t size; const char* meta; };
struct hw_render {
	int contextType;
	void (*contextReset)(void);
	uintptr_t (*currentFramebuffer)(void);
	void* (*procAddress)(const char*);
	bool depth, stencil, bottomLeftOrigin;
	unsigned major, minor;
	bool cacheContext;
	void (*contextDestroy)(void);
	bool debugContext;
};
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
static size_t (*retro_serialize_size)(void);
static bool (*retro_serialize)(void*, size_t);
static bool (*retro_unserialize)(const void*, size_t);

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
static struct hw_render* graphics;   // the core's, once it has asked for a graphics context the tools can give
static struct av_info av;   // what the core runs at, the last it said
static double wantedRate, soundAt;   // the rate the tools hear at, or 0 for the core's own, and how far between two samples
static int16_t soundBefore[2];
static uint32_t* sizes;   // each size the picture had: the frame it started at, its width and its height
static size_t sizeCount, sizeRoom;

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

// The graphics context: what's used of EGL and OpenGL (Khronos's headers, MIT licence), found when a core asks for one, so
// the host needs neither to build, and a framebuffer of the largest picture the core says it shows, which it draws into.
#define EGL_PLATFORM_SURFACELESS_MESA 0x31DD
#define EGL_SURFACE_TYPE 0x3033
#define EGL_PBUFFER_BIT 0x0001
#define EGL_RENDERABLE_TYPE 0x3040
#define EGL_OPENGL_ES3_BIT 0x0040
#define EGL_OPENGL_BIT 0x0008
#define EGL_NONE 0x3038
#define EGL_OPENGL_ES_API 0x30A0
#define EGL_OPENGL_API 0x30A2
#define EGL_CONTEXT_MAJOR_VERSION 0x3098
#define EGL_CONTEXT_MINOR_VERSION 0x30FB
#define EGL_CONTEXT_OPENGL_PROFILE_MASK 0x30FD
#define GL_FRAMEBUFFER 0x8D40
#define GL_READ_FRAMEBUFFER 0x8CA8
#define GL_RENDERBUFFER 0x8D41
#define GL_RGBA8 0x8058
#define GL_DEPTH24_STENCIL8 0x88F0
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_DEPTH_STENCIL_ATTACHMENT 0x821A
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_RGBA 0x1908
#define GL_UNSIGNED_BYTE 0x1401
#define GL_RENDERER 0x1F01
#define GL_PACK_ALIGNMENT 0x0D05

static void* (*eglGetProcAddress)(const char*);
static unsigned framebuffer;
static uint8_t* readBack;

static uintptr_t currentFramebuffer(void) {
	return framebuffer;
}

static void* procAddress(const char* name) {
	return eglGetProcAddress(name);
}

// why there's no context, or NULL once there is one, current on this thread, with the core's framebuffer bound
static const char* makeGraphics(unsigned width, unsigned height) {
#ifdef _WIN32
	(void) width;
	(void) height;
	return "which the tools offer only on Linux so far";
#else
	// Mesa's drawing on the processor, whatever graphics card the computer has, so every computer draws the same
	setenv("LIBGL_ALWAYS_SOFTWARE", "1", 1);
	setenv("GALLIUM_DRIVER", "llvmpipe", 1);
	setenv("MESA_SHADER_CACHE_DISABLE", "true", 1);
	void* egl = dlopen("libEGL.so.1", RTLD_NOW | RTLD_LOCAL);
	if (!egl) return "which needs EGL, from Mesa, and this computer has none";
	eglGetProcAddress = (void* (*)(const char*)) dlsym(egl, "eglGetProcAddress");
	void* (*getPlatformDisplay)(unsigned, void*, const intptr_t*) = eglGetProcAddress("eglGetPlatformDisplay");
	unsigned (*initialize)(void*, int*, int*) = eglGetProcAddress("eglInitialize");
	unsigned (*bindApi)(unsigned) = eglGetProcAddress("eglBindAPI");
	unsigned (*chooseConfig)(void*, const int*, void**, int, int*) = eglGetProcAddress("eglChooseConfig");
	void* (*createContext)(void*, void*, void*, const int*) = eglGetProcAddress("eglCreateContext");
	unsigned (*makeCurrent)(void*, void*, void*, void*) = eglGetProcAddress("eglMakeCurrent");
	if (!getPlatformDisplay || !initialize || !bindApi || !chooseConfig || !createContext || !makeCurrent) return "which needs EGL 1.5, and this computer's is older";
	void* display = getPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, NULL, NULL);
	int major, minor, count;
	if (!display || !initialize(display, &major, &minor)) return "which needs Mesa's EGL with no window, and this computer's wouldn't start";
	bool es = graphics->contextType == CONTEXT_OPENGLES2 || graphics->contextType == CONTEXT_OPENGLES3 || graphics->contextType == CONTEXT_OPENGLES_VERSION;
	bindApi(es ? EGL_OPENGL_ES_API : EGL_OPENGL_API);
	// with no window, a config for off-screen surfaces, though it draws into its own framebuffer
	const int wanted[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, es ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_BIT, EGL_NONE };
	void* config;
	if (!chooseConfig(display, wanted, &config, 1, &count) || !count) return "which this computer's EGL has none of";
	unsigned askedMajor = graphics->major ? graphics->major : graphics->contextType == CONTEXT_OPENGLES2 ? 2 : 3;
	// a core profile only when asked for, as OpenGL ES has no profiles
	int version[] = { EGL_CONTEXT_MAJOR_VERSION, askedMajor, EGL_CONTEXT_MINOR_VERSION, graphics->minor, EGL_NONE, 1, EGL_NONE };
	if (graphics->contextType == CONTEXT_OPENGL_CORE) version[4] = EGL_CONTEXT_OPENGL_PROFILE_MASK;
	void* context = createContext(display, config, NULL, version);
	if (!context || !makeCurrent(display, NULL, NULL, context)) return "of a version this computer's EGL can't make";

	const char* (*getString)(unsigned) = eglGetProcAddress("glGetString");
	const char* renderer = getString(GL_RENDERER);
	if (!renderer || !strstr(renderer, "llvmpipe")) return "and this computer's draws on its graphics card, not with Mesa's llvmpipe, so its pictures could differ from everyone else's";
	void (*genFramebuffers)(int, unsigned*) = eglGetProcAddress("glGenFramebuffers");
	void (*bindFramebuffer)(unsigned, unsigned) = eglGetProcAddress("glBindFramebuffer");
	void (*genRenderbuffers)(int, unsigned*) = eglGetProcAddress("glGenRenderbuffers");
	void (*bindRenderbuffer)(unsigned, unsigned) = eglGetProcAddress("glBindRenderbuffer");
	void (*renderbufferStorage)(unsigned, unsigned, int, int) = eglGetProcAddress("glRenderbufferStorage");
	void (*framebufferRenderbuffer)(unsigned, unsigned, unsigned, unsigned) = eglGetProcAddress("glFramebufferRenderbuffer");
	unsigned (*checkFramebuffer)(unsigned) = eglGetProcAddress("glCheckFramebufferStatus");
	unsigned buffers[2];
	genFramebuffers(1, &framebuffer);
	bindFramebuffer(GL_FRAMEBUFFER, framebuffer);
	genRenderbuffers(2, buffers);
	bindRenderbuffer(GL_RENDERBUFFER, buffers[0]);
	renderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, width, height);
	framebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, buffers[0]);
	if (graphics->depth || graphics->stencil) {
		bindRenderbuffer(GL_RENDERBUFFER, buffers[1]);
		renderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height);
		framebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, buffers[1]);
	}
	if (checkFramebuffer(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) return "and its framebuffer wouldn't be made";
	readBack = malloc((size_t) width * height * 4);
	return NULL;
#endif
}

// the picture the core drew into the framebuffer, read back, as one it had handed over: 32-bit, its top line first
static const void* drawnPicture(unsigned width, unsigned height, size_t* pitch) {
	static void (*bindFramebuffer)(unsigned, unsigned), (*pixelStore)(unsigned, int), (*readPixels)(int, int, int, int, unsigned, unsigned, void*);
	if (!readPixels) {
		bindFramebuffer = eglGetProcAddress("glBindFramebuffer");
		pixelStore = eglGetProcAddress("glPixelStorei");
		readPixels = eglGetProcAddress("glReadPixels");
	}
	bindFramebuffer(GL_READ_FRAMEBUFFER, framebuffer);
	pixelStore(GL_PACK_ALIGNMENT, 1);
	readPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, readBack);
	// in OpenGL's order, red first in memory and the bottom line first unless the core drew it upside down
	uint32_t* rows = (uint32_t*) readBack;
	if (graphics->bottomLeftOrigin) {
		for (unsigned y = 0; y < height / 2; y++) {
			uint32_t* top = rows + y * width;
			uint32_t* bottom = rows + (height - 1 - y) * width;
			for (unsigned x = 0; x < width; x++) {
				uint32_t kept = top[x];
				top[x] = bottom[x];
				bottom[x] = kept;
			}
		}
	}
	for (size_t p = 0; p < (size_t) width * height; p++) {
		const uint8_t* bytes = readBack + p * 4;
		rows[p] = (uint32_t) bytes[0] << 16 | bytes[1] << 8 | bytes[2];
	}
	*pitch = width * 4;
	return readBack;
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
	case ENV_SET_HW_RENDER: {
		// OpenGL of any kind, which the tools make once the game has loaded. Anything else, such as Vulkan, they can't give
		needsGraphics = true;
		struct hw_render* asked = data;
		if (asked->contextType < CONTEXT_OPENGL || asked->contextType > CONTEXT_OPENGLES_VERSION) return false;
		asked->currentFramebuffer = currentFramebuffer;
		asked->procAddress = procAddress;
		graphics = asked;
		return true;
	}
	case ENV_SET_SYSTEM_AV_INFO: av = *(struct av_info*) data; return true;
	case ENV_SET_GEOMETRY: return true;
	default: return false;
	}
}

// the frame in 15-bit colour, red in its low bits, as the browser's pixels reduce to
static void videoRefresh(const void* data, unsigned width, unsigned height, size_t pitch) {
	int pixels = format;
	if (data == HW_FRAME && graphics) {
		data = drawnPicture(width, height, &pitch);
		pixels = 1;
	}
	if (!data || data == HW_FRAME) return;
	if (width * height > screenW * screenH || !screen) screen = realloc(screen, width * height * 2);
	screenW = width;
	screenH = height;
	for (unsigned y = 0; y < height; y++) {
		const uint8_t* row = (const uint8_t*) data + y * pitch;
		uint16_t* to = screen + y * width;
		if (pixels == 1) {
			const uint32_t* from = (const uint32_t*) row;
			for (unsigned x = 0; x < width; x++) to[x] = (from[x] >> 19 & 31) | (from[x] >> 11 & 31) << 5 | (from[x] >> 3 & 31) << 10;
		} else if (pixels == 2) {
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
	// the same pixels in another shape are another picture
	*hash = (*hash ^ screenW) * 0x01000193;
	*hash = (*hash ^ screenH) * 0x01000193;
}

// keeps the picture's size if it has just changed
static void noteSize(long frame) {
	if (sizeCount && sizes[(sizeCount - 1) * 3 + 1] == screenW && sizes[(sizeCount - 1) * 3 + 2] == screenH) return;
	if (!sizeCount && !screenW) return;   // nothing shown yet
	if (sizeCount == sizeRoom) {
		sizeRoom = sizeRoom ? sizeRoom * 2 : 16;
		sizes = realloc(sizes, sizeRoom * 3 * 4);
	}
	sizes[sizeCount * 3] = frame;
	sizes[sizeCount * 3 + 1] = screenW;
	sizes[sizeCount * 3 + 2] = screenH;
	sizeCount++;
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

// what the search needs of the console (lib/explore.h): the one core this program runs
static size_t searchSize;
static void searchFrame(void* console, uint32_t buttons) {
	(void) console;
	held = buttons;
	sampleCount = 0;
	retro_run();
}
static void searchSave(void* console, void* to) {
	(void) console;
	if (!retro_serialize(to, searchSize)) {
		fprintf(err, "The core wouldn't copy its state out.\n");
		exit(2);
	}
}
static void searchLoad(void* console, const void* from) {
	(void) console;
	if (!retro_unserialize(from, searchSize)) {
		fprintf(err, "The core wouldn't take its state back.\n");
		exit(2);
	}
}
static int searchRead(void* console, uint32_t address, uint32_t bytes, uint32_t* value) {
	(void) console;
	uint8_t* memory = retro_get_memory_data(MEMORY_SYSTEM_RAM);
	if (!memory || (size_t) address + bytes > retro_get_memory_size(MEMORY_SYSTEM_RAM)) return 0;
	*value = 0;
	for (uint32_t i = 0; i < bytes; i++) *value |= (uint32_t) memory[address + i] << (i * 8);
	return 1;
}
static void searchSet(void* console, uint32_t address, uint32_t bytes, uint32_t value) {
	(void) console;
	uint8_t* memory = retro_get_memory_data(MEMORY_SYSTEM_RAM);
	size_t size = retro_get_memory_size(MEMORY_SYSTEM_RAM);
	for (uint32_t i = 0; i < bytes && memory && address + i < size; i++) memory[address + i] = value >> (i * 8);
}

int main(int argc, char** argv) {
	bool live = argc >= 6 && !strcmp(argv[3], "live"), route = argc >= 5 && !strcmp(argv[3], "route");
	if (argc < (live ? 6 : route ? 5 : 12)) {
		fprintf(stderr, "Usage: host CORE ROM FRAMES BUTTONS - PICTURES SOUND SETS - WIDTH HEIGHT [KEY=VALUE…]\n       host CORE ROM live WIDTH HEIGHT [KEY=VALUE…]\n       host CORE ROM route SPEC [KEY=VALUE…]\n");
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

	// a search shows no picture, so it's given no size for one
	int at = live ? 4 : route ? 3 : 10;
	wantedW = route ? 0 : atoi(argv[at]);
	wantedH = route ? 0 : atoi(argv[at + 1]);
	settings = (const char**) argv + at + 2;
	settingCount = argc - at - 2;
	picture = malloc(wantedW * wantedH * 2 + 2);
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
	if (route) {
		retro_serialize_size = find(library, "retro_serialize_size");
		retro_serialize = find(library, "retro_serialize");
		retro_unserialize = find(library, "retro_unserialize");
	}

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
		fprintf(err, needsGraphics && !graphics ? "The core needs a kind of graphics context the tools don't offer.\n" : "The core wouldn't load this copy, or needs a system file of the console's that isn't there.\n");
		return 2;
	}
	retro_set_controller_port_device(0, DEVICE_JOYPAD);
	retro_get_system_av_info(&av);
	if (graphics) {
		const char* why = makeGraphics(av.maxWidth, av.maxHeight);
		if (why) {
			fprintf(err, "The core needs a graphics context, %s.\n", why);
			return 2;
		}
		graphics->contextReset();
	}
	wantedRate = getenv("DP_SOUND_RATE") ? atof(getenv("DP_SOUND_RATE")) : 0;

	if (route) {
		// what the search says goes where the tools read it, which the core's own words never reach
		exSaid = out;
		exErrors = err;
		searchSize = retro_serialize_size();
		if (!searchSize) {
			fprintf(err, "The core can't copy its state out, which the search needs.\n");
			return 2;
		}
		struct ex_machine machine = { NULL, searchFrame, searchSize, searchSave, searchLoad, searchRead, searchSet };
		return exploreRoute(machine, NULL, argv[4], 4);
	}

	if (live) {
		uint32_t buttons;
		while (fread(&buttons, 4, 1, stdin) == 1) {
			held = buttons;
			sampleCount = 0;
			retro_run();
			writePicture();
			uint32_t size[2] = { screenW, screenH };
			fwrite(size, 4, 2, out);
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
	size_t readsSize = 0;
	uint32_t* reads = getenv("DP_READS") ? readAll(getenv("DP_READS"), &readsSize) : NULL;
	size_t readCount = readsSize / 12, nextRead = 0;
	uint32_t* readValues = calloc(readCount ? readCount : 1, sizeof(uint32_t));

	for (long frame = 0; frame < frames; frame++) {
		held = (size_t) frame < buttonsSize / 4 ? buttons[frame] : 0;
		for (; nextSet < setCount && sets[nextSet * 4] == (uint32_t) frame; nextSet++) {
			uint32_t address = sets[nextSet * 4 + 1], bytes = sets[nextSet * 4 + 2], value = sets[nextSet * 4 + 3];
			for (uint32_t i = 0; i < bytes && memory && address + i < memorySize; i++) memory[address + i] = value >> (i * 8);
		}
		sampleCount = 0;
		retro_run();
		noteSize(frame);
		for (; nextRead < readCount && reads[nextRead * 3] == (uint32_t) frame; nextRead++) {
			uint32_t address = reads[nextRead * 3 + 1], bytes = reads[nextRead * 3 + 2], value = 0;
			if (!memory || address + bytes > memorySize) {
				fprintf(err, "The tools can only read the console's work memory, and 0x%X isn't in it\n", address);
				return 2;
			}
			for (uint32_t i = 0; i < bytes; i++) value |= (uint32_t) memory[address + i] << (i * 8);
			readValues[nextRead] = value;
		}
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
	fprintf(err, "{\"cartridge\":0,\"memory\":0,\"rate\":%g,\"fps\":%g,\"sizes\":[", wantedRate ? wantedRate : av.sampleRate, av.fps);
	for (size_t i = 0; i < sizeCount; i++) fprintf(err, "%s[%u,%u,%u]", i ? "," : "", sizes[i * 3], sizes[i * 3 + 1], sizes[i * 3 + 2]);
	fprintf(err, "],\"reads\":[");
	for (size_t i = 0; i < readCount; i++) fprintf(err, "%s%u", i ? "," : "", readValues[i]);
	fprintf(err, "]}\n");
	fflush(err);
	return 0;
}
