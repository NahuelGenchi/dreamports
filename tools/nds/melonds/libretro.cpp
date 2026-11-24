// The tools' own front for melonDS, the Nintendo DS's reference emulator (docs/CONSOLES.md): melonDS's console, built
// from its makers' source, driven the one way tools/libretro/host.c drives every emulator. It has no settings, no window,
// no threads and no files of its own, so a frame is the same on every computer.
//
// The console starts as its makers' own front starts one with no BIOS and no firmware of a person's: melonDS's free
// BIOS, the firmware it writes itself, and the program started directly, as the console's firmware would have left it.
// Its clock starts at midnight on 1 January 2000 and goes on only as the console runs.
//
// A frame's picture is the two screens, 256 by 192 each, the upper one above the lower, with nothing between them.
// Its sound is what the console's mixer made that frame, a pair of samples for every 1,024 ticks of its 33,513,982 Hz
// clock, 32,728.498046875 pairs a second, as the mixer leaves them, cut to the 10 bits the console's speakers get, with
// none of the emulator's own resampling for a computer's speakers (../../libretro/melonds.patch).
// Its buttons are libretro's pad, and a touch is libretro's pointer, which here says the lower screen's pixel, 0 to 255
// across and 0 to 191 down, as host.c gives it. The microphone hears nothing and the lid stays open.
//
// What ran: host.c gives the code map's functions (dreamports_functions), each with the processor it's for and its
// first bytes, and after each frame asks which of them ran in it (dreamports_ran_in_frame). A function ran when its
// processor was sent to its address, by a call, a branch or a return, which melonDS tells this of with the tools'
// patch, while the memory there held the function's first bytes: a Nintendo DS game's code is all in memory, where an
// overlay's place holds whichever overlay the game last loaded.
//
// This file is built into the emulator on the contributor's computer and is never published as a program. melonDS is
// under the GNU General Public License, version 3 or later, and so is what's built from it.

#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "Args.h"
#include "GPU.h"
#include "NDS.h"
#include "NDSCart.h"
#include "Platform.h"
#include "SPU.h"
#include "Savestate.h"

#if defined(_WIN32)
#define EXPORT extern "C" __declspec(dllexport)
#else
#define EXPORT extern "C" __attribute__((visibility("default")))
#endif

using namespace melonDS;

// what's used of libretro's interface (libretro.h, MIT licence)
struct retro_game_info { const char* path; const void* data; size_t size; const char* meta; };
struct retro_system_info { const char* library_name; const char* library_version; const char* valid_extensions; bool need_fullpath; bool block_extract; };
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { retro_game_geometry geometry; retro_system_timing timing; };
typedef bool (*retro_environment_t)(unsigned, void*);
typedef void (*retro_video_refresh_t)(const void*, unsigned, unsigned, size_t);
typedef void (*retro_audio_sample_t)(int16_t, int16_t);
typedef size_t (*retro_audio_sample_batch_t)(const int16_t*, size_t);
typedef void (*retro_input_poll_t)(void);
typedef int16_t (*retro_input_state_t)(unsigned, unsigned, unsigned, unsigned);
enum { RETRO_ENVIRONMENT_SET_PIXEL_FORMAT = 10, RETRO_PIXEL_FORMAT_XRGB8888 = 1, RETRO_DEVICE_JOYPAD = 1, RETRO_DEVICE_POINTER = 6, RETRO_MEMORY_SAVE_RAM = 0, RETRO_MEMORY_SYSTEM_RAM = 2 };
enum { POINTER_X = 0, POINTER_Y = 1, POINTER_PRESSED = 2 };

static const int WIDTH = 256, HEIGHT = 192;
// the console's clock, a frame's ticks, and how many of them the mixer takes for a pair of samples
static const double CLOCK = 33513982.0, FRAME_TICKS = 560190.0, MIX_TICKS = 1024.0;

static retro_environment_t environment;
static retro_video_refresh_t videoRefresh;
static retro_audio_sample_batch_t audioBatch;
static retro_input_poll_t inputPoll;
static retro_input_state_t inputState;

static std::unique_ptr<NDS> console;
static std::vector<int16_t> mixed;
static uint32_t picture[WIDTH * HEIGHT * 2];

// each pair of samples as the console's mixer leaves it, which melonDS tells this of with the tools' patch
namespace melonDS { extern void (*DreamportsMixed)(const s16* pair); }
static void keepMixed(const s16* pair) {
	mixed.push_back(pair[0]);
	mixed.push_back(pair[1]);
}

// the functions to watch, by processor and address: each one's number in the code map and its first bytes
struct Watched { uint32_t index; uint8_t bytes[8]; uint32_t count; bool ran; };
static std::unordered_multimap<uint64_t, Watched> watched;
static std::vector<uint32_t> ranNow;
static std::vector<Watched*> ranOnes;
namespace melonDS { extern void (*DreamportsJumped)(u32 processor, u32 addr); }

// a byte of what a processor would run at an address, read with no time spent and nothing else changed
static uint8_t codeAt(uint32_t processor, uint32_t address) {
	if (processor) return console->ARM7Read8(address);
	if (address < console->ARM9.ITCMSize) return console->ARM9.ITCM[address & (ITCMPhysicalSize - 1)];
	return console->ARM9Read8(address);
}

static void jumped(u32 processor, u32 address) {
	auto found = watched.equal_range((uint64_t) processor << 32 | address);
	for (auto each = found.first; each != found.second; ++each) {
		Watched& function = each->second;
		if (function.ran) continue;
		bool there = true;
		for (uint32_t i = 0; i < function.count && there; i++) there = codeAt(processor, address + i) == function.bytes[i];
		if (!there) continue;
		function.ran = true;
		ranNow.push_back(function.index);
		ranOnes.push_back(&function);
	}
}

// `list` is host.c's FUNCTIONS: for each function its address, its size, its number in the code map, 1 with 2 added
// for one the ARM7 runs, and its first 8 bytes as two words
EXPORT void dreamports_functions(const uint32_t* list, size_t count) {
	watched.clear();
	for (size_t i = 0; i < count; i++) {
		const uint32_t* f = list + i * 6;
		Watched function = { f[2], {}, f[1] < 8 ? f[1] : 8, false };
		memcpy(function.bytes, f + 4, 8);
		watched.emplace((uint64_t) (f[3] >> 1 & 1) << 32 | f[0], function);
	}
	DreamportsJumped = count ? jumped : nullptr;
}

// the numbers in the code map of the functions that ran since the last call, in the order they first ran
EXPORT const uint32_t* dreamports_ran_in_frame(uint32_t* count) {
	static std::vector<uint32_t> given;
	given = ranNow;
	for (Watched* function : ranOnes) function->ran = false;
	ranNow.clear();
	ranOnes.clear();
	*count = (uint32_t) given.size();
	return given.data();
}

EXPORT unsigned retro_api_version(void) { return 1; }
EXPORT void retro_set_environment(retro_environment_t callback) { environment = callback; }
EXPORT void retro_set_video_refresh(retro_video_refresh_t callback) { videoRefresh = callback; }
EXPORT void retro_set_audio_sample(retro_audio_sample_t) {}
EXPORT void retro_set_audio_sample_batch(retro_audio_sample_batch_t callback) { audioBatch = callback; }
EXPORT void retro_set_input_poll(retro_input_poll_t callback) { inputPoll = callback; }
EXPORT void retro_set_input_state(retro_input_state_t callback) { inputState = callback; }
EXPORT void retro_set_controller_port_device(unsigned, unsigned) {}
EXPORT void retro_init(void) {}
EXPORT void retro_deinit(void) { console.reset(); }
EXPORT void retro_reset(void) {}

EXPORT void retro_get_system_info(retro_system_info* info) {
	*info = { "melonDS, with the tools' front", "dreamports", "nds|srl", false, false };
}

EXPORT void retro_get_system_av_info(retro_system_av_info* info) {
	info->geometry = { WIDTH, HEIGHT * 2, WIDTH, HEIGHT * 2, (float) WIDTH / (HEIGHT * 2) };
	info->timing = { CLOCK / FRAME_TICKS, CLOCK / MIX_TICKS };
}

EXPORT bool retro_load_game(const retro_game_info* game) {
	if (!game) return false;
	int format = RETRO_PIXEL_FORMAT_XRGB8888;
	if (!environment(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &format)) return false;
	std::vector<uint8_t> bytes;
	if (game->data) {
		bytes.assign((const uint8_t*) game->data, (const uint8_t*) game->data + game->size);
	} else {
		FILE* file = game->path ? fopen(game->path, "rb") : nullptr;
		if (!file) return false;
		uint8_t block[65536];
		size_t got;
		while ((got = fread(block, 1, sizeof block, file)) > 0) bytes.insert(bytes.end(), block, block + got);
		fclose(file);
	}
	auto cartridge = NDSCart::ParseROM(bytes.data(), (u32) bytes.size(), nullptr, std::nullopt);
	if (!cartridge) return false;

	NDSArgs args;
	// the interpreter, as a recompiler's blocks would change when the console's interrupts land
	args.JIT = std::nullopt;
	console = std::make_unique<NDS>(std::move(args), nullptr);
	DreamportsMixed = keepMixed;
	console->Reset();
	console->SetNDSCart(std::move(cartridge));
	console->SetupDirectBoot("program.nds");
	console->Start();
	return true;
}

EXPORT bool retro_load_game_special(unsigned, const retro_game_info*, size_t) { return false; }
EXPORT void retro_unload_game(void) { console.reset(); }
EXPORT unsigned retro_get_region(void) { return 0; }

EXPORT void retro_run(void) {
	inputPoll();
	// libretro's buttons, in its order, as the bit each has in the console's own two registers, where a 0 is a press:
	// A, B, Select, Start, Right, Left, Up, Down, R, L, then X and Y
	static const int BIT[12] = { 1, 11, 2, 3, 6, 7, 5, 4, 0, 10, 9, 8 };
	u32 keys = 0xFFF;
	for (unsigned id = 0; id < 12; id++) {
		if (inputState(0, RETRO_DEVICE_JOYPAD, 0, id)) keys &= ~(1u << BIT[id]);
	}
	console->SetKeyMask(keys);
	if (inputState(0, RETRO_DEVICE_POINTER, 0, POINTER_PRESSED)) {
		console->TouchScreen((u16) inputState(0, RETRO_DEVICE_POINTER, 0, POINTER_X), (u16) inputState(0, RETRO_DEVICE_POINTER, 0, POINTER_Y));
	} else {
		console->ReleaseScreen();
	}

	mixed.clear();
	console->RunFrame();

	void* top = nullptr;
	void* bottom = nullptr;
	if (console->GPU.GetFramebuffers(&top, &bottom) && top && bottom) {
		memcpy(picture, top, sizeof(uint32_t) * WIDTH * HEIGHT);
		memcpy(picture + WIDTH * HEIGHT, bottom, sizeof(uint32_t) * WIDTH * HEIGHT);
	}
	videoRefresh(picture, WIDTH, HEIGHT * 2, WIDTH * sizeof(uint32_t));
	if (!mixed.empty()) audioBatch(mixed.data(), mixed.size() / 2);
}

EXPORT size_t retro_serialize_size(void) {
	if (!console) return 0;
	Savestate state;
	console->DoSavestate(&state);
	// room for a state that grows a little as the console plays, such as its queues
	return state.Length() + 65536;
}

EXPORT bool retro_serialize(void* data, size_t size) {
	if (!console) return false;
	Savestate state;
	if (!console->DoSavestate(&state) || state.Error || state.Length() + 4 > size) return false;
	uint32_t length = state.Length();
	memcpy(data, &length, 4);
	memcpy((uint8_t*) data + 4, state.Buffer(), length);
	return true;
}

EXPORT bool retro_unserialize(const void* data, size_t size) {
	if (!console || size < 4) return false;
	uint32_t length;
	memcpy(&length, data, 4);
	if (length + 4 > size) return false;
	Savestate state((uint8_t*) data + 4, length, false);
	return console->DoSavestate(&state) && !state.Error;
}

EXPORT void retro_cheat_reset(void) {}
EXPORT void retro_cheat_set(unsigned, bool, const char*) {}

// where the console's main memory starts, which host.c counts an address from
EXPORT uint32_t dreamports_memory_base(void) { return 0x02000000; }

// the console's main memory, 4 MB at 0x02000000, and its cartridge's save memory
EXPORT void* retro_get_memory_data(unsigned id) {
	if (!console) return nullptr;
	if (id == RETRO_MEMORY_SYSTEM_RAM) return console->MainRAM;
	if (id == RETRO_MEMORY_SAVE_RAM) return console->GetNDSSave();
	return nullptr;
}

EXPORT size_t retro_get_memory_size(unsigned id) {
	if (!console) return 0;
	if (id == RETRO_MEMORY_SYSTEM_RAM) return 0x400000;
	if (id == RETRO_MEMORY_SAVE_RAM) return console->GetNDSSaveLength();
	return 0;
}

// what melonDS asks of the computer it runs on
#include "computer.h"
